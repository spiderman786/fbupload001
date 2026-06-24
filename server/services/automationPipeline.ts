import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { downloadReelFromUrl, stripVideoMetadata, cleanupJobFiles, fetchReelMetadata, downloadThumbnail, extractVideoThumbnail } from './downloader.js'
import { getPageAccessToken, publishReelVideo } from './publisher.js'
import { isFacebookConfiguredForAgency } from './byoc.js'
import { discoverNextReel } from './reelDiscovery.js'
import { recordPostedReel } from './dedup.js'
import { canPagePostToday, refreshPagePostedToday } from './pageQuota.js'
import { markPageHealthCompleted } from './pageHealth.js'
import { appendJobLog } from './jobLog.js'
import { maybeAutoRetryJob } from './autoRetry.js'
import { applySelfHealingOnJobFailure, resetPageFailureStreak, resetSourceFailureStreak } from './selfHealing.js'
import { isPlatformFlagEnabled, isAgencyInMaintenance } from './platformSettings.js'
import {
  handlePrefillDiscoveryFailure,
  handlePrefillSuccess,
  markScrapeIdle,
} from './scrapeStatus.js'

async function triggerPrefillRefill() {
  try {
    const { tickPrefillQueue } = await import('./prefillScheduler.js')
    tickPrefillQueue()
  } catch {
    /* worker-only */
  }
}

export type JobType = 'direct' | 'inapp' | 'scheduled' | 'prefill'

type JobRow = Record<string, unknown>

function loadJob(jobId: string): JobRow {
  const job = db.prepare('SELECT * FROM reel_jobs WHERE id = ?').get(jobId) as JobRow | undefined
  if (!job) throw new Error('Job not found')
  return job
}

function resolveSourceId(job: JobRow, pageId: string): string {
  let sourceId = job.source_account_id as string | null
  if (!sourceId) {
    const assignment = db
      .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?')
      .get(pageId) as { source_account_id: string } | undefined
    if (!assignment) throw new Error('No source assigned to this page')
    sourceId = assignment.source_account_id
    db.prepare('UPDATE reel_jobs SET source_account_id = ? WHERE id = ?').run(sourceId, job.id)
  }
  return sourceId
}

function validateJobContext(job: JobRow, options?: { skipQuota?: boolean }) {
  const userId = job.user_id as string
  const agencyId = (job.agency_id as string | null) ?? userId
  const pageId = job.target_page_id as string

  if (!isPlatformFlagEnabled('publishing_enabled')) throw new Error('Publishing disabled platform-wide')
  if (!isPlatformFlagEnabled('downloads_enabled')) throw new Error('Downloads disabled platform-wide')
  if (isAgencyInMaintenance(agencyId)) throw new Error('Agency is in maintenance mode')

  const page = db.prepare('SELECT * FROM facebook_pages WHERE id = ? AND agency_id = ?').get(pageId, agencyId) as
    | JobRow
    | undefined
  if (!page) throw new Error('Target page not found')
  if (page.status !== 'active') throw new Error('Target page is paused')
  if (page.health_status !== 'completed') throw new Error(`Page health: ${page.health_status}`)
  if (!options?.skipQuota && !canPagePostToday(pageId)) throw new Error('Daily reel limit reached for this page')

  const sourceId = resolveSourceId(job, pageId)
  const source = db.prepare('SELECT * FROM source_accounts WHERE id = ? AND agency_id = ?').get(sourceId, agencyId) as
    | JobRow
    | undefined
  if (!source || !source.is_active) throw new Error('Source account inactive')

  return { userId, agencyId, pageId, page, sourceId, source }
}

async function downloadAndClean(
  agencyId: string,
  jobId: string,
  source: JobRow,
  pageId: string,
  sourceId: string,
) {
  appendJobLog(jobId, 'discover', `Finding reel from ${source.username} (${source.platform})`)

  const discovered = await discoverNextReel({
    pageId,
    sourceAccountId: sourceId,
    platform: source.platform as string,
    username: source.username as string,
  })

  db.prepare('UPDATE reel_jobs SET source_reel_id = ? WHERE id = ?').run(discovered.reelId, jobId)
  appendJobLog(jobId, 'discover', `Found reel ${discovered.reelId}`, 'info', { url: discovered.sourceUrl, mock: discovered.mock })

  appendJobLog(jobId, 'download', 'Downloading video')
  const download = await downloadReelFromUrl(agencyId, jobId, discovered.sourceUrl, discovered.reelId, discovered.mock)
  appendJobLog(jobId, 'download', 'Download complete', 'info', { mock: download.mock })

  db.prepare('UPDATE reel_jobs SET source_url = ?, local_file_path = ? WHERE id = ?').run(
    download.sourceUrl,
    download.filePath,
    jobId,
  )

  const cleanedPath = path.join(path.dirname(download.filePath), 'clean.mp4')
  appendJobLog(jobId, 'ffmpeg', 'Stripping metadata')
  const { stripped } = await stripVideoMetadata(download.filePath, cleanedPath)
  appendJobLog(jobId, 'ffmpeg', stripped ? 'Metadata stripped' : 'Metadata strip skipped (copy fallback)')

  db.prepare('UPDATE reel_jobs SET cleaned_file_path = ?, metadata_stripped = ? WHERE id = ?').run(
    cleanedPath,
    stripped ? 1 : 0,
    jobId,
  )

  try {
    if (fs.existsSync(download.filePath)) fs.unlinkSync(download.filePath)
  } catch {
    /* ignore */
  }

  return { discovered, download, cleanedPath }
}

async function publishCleanedFile(
  jobId: string,
  ctx: ReturnType<typeof validateJobContext>,
  cleanedPath: string,
  discovered: { reelId: string; sourceUrl: string },
  downloadSourceUrl: string,
) {
  const { userId, agencyId, pageId, page, sourceId, source } = ctx
  const tokenCost = source.tokens_per_reel as number

  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as { token_balance: number }
  if (agency.token_balance < tokenCost) throw new Error('Insufficient token balance')

  appendJobLog(jobId, 'publish', 'Uploading to Facebook')

  const account = page.facebook_account_id
    ? (db.prepare('SELECT access_token FROM facebook_accounts WHERE id = ?').get(page.facebook_account_id) as
        | { access_token: string }
        | undefined)
    : undefined

  const pageToken =
    (page.page_access_token as string | null) ??
    (account ? await getPageAccessToken(page.meta_page_id as string, account.access_token) : null)

  const mockMode = !isFacebookConfiguredForAgency(agencyId) && !pageToken
  let postId: string

  if (mockMode || !pageToken) {
    await new Promise((r) => setTimeout(r, 400))
    postId = `mock_reel_${Date.now()}`
    appendJobLog(jobId, 'publish', 'Mock publish (no FB token)', 'warn')
  } else {
    const result = await publishReelVideo(
      page.meta_page_id as string,
      pageToken,
      cleanedPath,
      (loadJob(jobId).caption as string | null) || `Reel from ${source.username}`,
    )
    postId = result.postId
    appendJobLog(jobId, 'publish', `Published ${postId}`)
  }

  db.transaction(() => {
    db.prepare('UPDATE agencies SET token_balance = token_balance - ? WHERE id = ? AND token_balance >= ?').run(
      tokenCost,
      agencyId,
      tokenCost,
    )
    db.prepare(`
      UPDATE reel_jobs SET status = 'published', meta_post_id = ?, tokens_charged = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(postId, tokenCost, jobId)
    db.prepare(`
      INSERT INTO token_transactions (id, user_id, agency_id, amount, type, reel_job_id, note)
      VALUES (?, ?, ?, ?, 'publish_debit', ?, ?)
    `).run(uuid(), userId, agencyId, -tokenCost, jobId, `Published reel from ${source.username} → ${page.name}`)
    db.prepare(`
      UPDATE facebook_pages SET reels_posted_today = reels_posted_today + 1, last_published_at = datetime('now')
      WHERE id = ?
    `).run(pageId)

    recordPostedReel({
      agencyId,
      pageId,
      sourceAccountId: sourceId,
      sourceReelId: discovered.reelId,
      sourceUrl: downloadSourceUrl,
      metaPostId: postId,
      jobId,
    })
  })()

  refreshPagePostedToday(pageId)
  markPageHealthCompleted(pageId)

  appendJobLog(jobId, 'complete', 'Job finished successfully')
  resetPageFailureStreak(pageId)
  resetSourceFailureStreak(sourceId)
  cleanupJobFiles(agencyId, jobId)

  void triggerPrefillRefill()
}

/** Download + metadata strip only — stays in queue until schedule publishes. */
async function runPrefillJob(jobId: string) {
  appendJobLog(jobId, 'start', 'Prefill download started')
  const job = loadJob(jobId)
  const ctx = validateJobContext(job, { skipQuota: true })
  const { agencyId, pageId, sourceId, source } = ctx

  db.prepare("UPDATE reel_jobs SET status = 'downloading' WHERE id = ?").run(jobId)
  markScrapeIdle(pageId)
  try {
    const { discovered, download, cleanedPath } = await downloadAndClean(agencyId, jobId, source, pageId, sourceId)

    const meta = await fetchReelMetadata(download.sourceUrl)
    const defaultCaption = `Reel from @${String(source.username).replace(/^@/, '')}`
    const caption = meta?.description || meta?.title || defaultCaption
    let thumbPath = meta?.thumbnailUrl ? await downloadThumbnail(meta.thumbnailUrl, path.dirname(cleanedPath)) : null
    if (!thumbPath) {
      thumbPath = await extractVideoThumbnail(cleanedPath, path.dirname(cleanedPath))
    }

    db.prepare('UPDATE reel_jobs SET caption = ?, thumbnail_path = ? WHERE id = ?').run(caption, thumbPath, jobId)
    db.prepare("UPDATE reel_jobs SET status = 'queued' WHERE id = ?").run(jobId)
    appendJobLog(jobId, 'queued', 'Reel ready in publish queue')
    handlePrefillSuccess(pageId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    handlePrefillDiscoveryFailure(pageId, sourceId, message)
    throw err
  }
}

/** Publish a pre-downloaded queued reel (status already set to publishing). */
async function runPublishFromQueueJob(jobId: string) {
  appendJobLog(jobId, 'start', 'Publishing from pre-download queue')
  const job = loadJob(jobId)
  const ctx = validateJobContext(job)
  const { agencyId, pageId } = ctx

  const cleanedPath = job.cleaned_file_path as string | null
  if (!cleanedPath || !fs.existsSync(cleanedPath)) {
    throw new Error('Queued video file missing — re-download required')
  }

  const discovered = {
    reelId: (job.source_reel_id as string) ?? 'unknown',
    sourceUrl: (job.source_url as string) ?? '',
  }

  await publishCleanedFile(jobId, ctx, cleanedPath, discovered, discovered.sourceUrl)

  void triggerPrefillRefill()
}

/** Full discover → download → publish pipeline (Direct Post fallback). */
async function runFullPipelineJob(jobId: string) {
  appendJobLog(jobId, 'start', 'Job started')
  const job = loadJob(jobId)
  const ctx = validateJobContext(job)
  const { agencyId, pageId, sourceId, source } = ctx

  db.prepare("UPDATE reel_jobs SET status = 'downloading' WHERE id = ?").run(jobId)
  const { discovered, download, cleanedPath } = await downloadAndClean(agencyId, jobId, source, pageId, sourceId)

  db.prepare("UPDATE reel_jobs SET status = 'publishing' WHERE id = ?").run(jobId)
  await publishCleanedFile(jobId, ctx, cleanedPath, discovered, download.sourceUrl)
}

export async function runAutomationJob(jobId: string): Promise<void> {
  const job = loadJob(jobId)
  const jobType = job.job_type as JobType
  const status = job.status as string

  if (status === 'publishing' && job.cleaned_file_path) {
    await runPublishFromQueueJob(jobId)
    return
  }

  if (jobType === 'prefill') {
    await runPrefillJob(jobId)
    return
  }

  await runFullPipelineJob(jobId)
}

export function failAutomationJob(jobId: string, message: string) {
  appendJobLog(jobId, 'failed', message, 'error')
  applySelfHealingOnJobFailure(jobId, message)
  if (maybeAutoRetryJob(jobId, message)) return

  const job = db.prepare('SELECT user_id, agency_id, job_type, status FROM reel_jobs WHERE id = ?').get(jobId) as
    | { user_id: string; agency_id: string | null; job_type: string; status: string }
    | undefined

  db.prepare("UPDATE reel_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?").run(
    message,
    jobId,
  )

  if (job) cleanupJobFiles(job.agency_id ?? job.user_id, jobId)
}

export function createAutomationJob(
  agencyId: string,
  userId: string,
  pageId: string,
  jobType: JobType,
  sourceId?: string,
  scheduledFor?: string,
): string {
  const id = uuid()

  let resolvedSource = sourceId
  if (!resolvedSource) {
    const a = db.prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?').get(pageId) as
      | { source_account_id: string }
      | undefined
    resolvedSource = a?.source_account_id
  }

  db.prepare(`
    INSERT INTO reel_jobs (id, user_id, agency_id, source_account_id, target_page_id, status, job_type, scheduled_for)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, agencyId, resolvedSource ?? null, pageId, jobType, scheduledFor ?? null)

  return id
}
