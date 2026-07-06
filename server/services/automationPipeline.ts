import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { downloadReelFromUrl, stripVideoMetadata, cleanupJobFiles, fetchReelMetadata, downloadThumbnail, extractVideoThumbnail } from './downloader.js'
import { getPageAccessToken, publishReelVideo } from './publisher.js'
import { isFacebookConfiguredForAgency } from './byoc.js'
import { isMockMetaPageId } from './facebook.js'
import { discoverNextReel } from './reelDiscovery.js'
import { isPublishDuplicateOnPage, recordPostedReel, recordSkippedReel, resolvePublishReelIdentity } from './dedup.js'
import { canPagePostToday, refreshPagePostedToday } from './pageQuota.js'
import { markPageHealthCompleted } from './pageHealth.js'
import { appendJobLog } from './jobLog.js'
import { maybeAutoRetryJob } from './autoRetry.js'
import { applySelfHealingOnJobFailure, resetPageFailureStreak, resetSourceFailureStreak } from './selfHealing.js'
import { isPlatformFlagEnabled, isAgencyInMaintenance } from './platformSettings.js'
import { resolvePublishVideoPath } from './queueActions.js'
import { deleteQueueR2Media, syncQueueMediaToR2 } from './queueMediaSync.js'
import { isSourceActiveFlag } from '../utils/sourceActive.js'
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

function resolveAgencyId(job: JobRow): string {
  const explicit = job.agency_id as string | null
  if (explicit) return explicit

  const pageId = job.target_page_id as string
  const page = db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(pageId) as
    | { agency_id: string }
    | undefined
  if (!page?.agency_id) throw new Error('Target page not found')

  db.prepare('UPDATE reel_jobs SET agency_id = ? WHERE id = ?').run(page.agency_id, job.id as string)
  return page.agency_id
}

function validateJobContext(job: JobRow, options?: { skipQuota?: boolean }) {
  const userId = job.user_id as string
  const agencyId = resolveAgencyId(job)
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
  if (!source || !isSourceActiveFlag(source.is_active)) throw new Error('Source account inactive')

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
    jobId,
  })

  appendJobLog(jobId, 'discover', `Found reel ${discovered.reelId}`, 'info', { url: discovered.sourceUrl, mock: discovered.mock })

  appendJobLog(jobId, 'download', 'Downloading video')
  const download = await downloadReelFromUrl(
    agencyId,
    jobId,
    discovered.sourceUrl,
    discovered.reelId,
    discovered.mock,
    source.platform as string,
  )
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

type PublishClaim = 'proceed' | 'already_published' | 'contended'

/** Ensure only one worker uploads to Facebook for a given job (multi-instance safe). */
function tryClaimPublishJob(jobId: string): PublishClaim {
  return db.transaction(() => {
    const row = db
      .prepare('SELECT status, meta_post_id, target_page_id FROM reel_jobs WHERE id = ?')
      .get(jobId) as { status: string; meta_post_id: string | null; target_page_id: string } | undefined
    if (!row) throw new Error('Job not found')
    if (row.meta_post_id) return 'already_published'

    const peer = db
      .prepare(`
        SELECT id FROM reel_jobs
        WHERE target_page_id = ?
          AND id != ?
          AND status IN ('downloading', 'publishing')
          AND job_type != 'prefill'
          AND (meta_post_id IS NULL OR meta_post_id = '')
        LIMIT 1
      `)
      .get(row.target_page_id, jobId)
    if (peer) return 'contended'

    const claimed = db
      .prepare(`
        UPDATE reel_jobs SET status = 'publishing'
        WHERE id = ?
          AND meta_post_id IS NULL
          AND status IN ('queued', 'downloading', 'publishing', 'pending')
      `)
      .run(jobId)

    if (claimed.changes > 0) return 'proceed'

    const again = db
      .prepare('SELECT meta_post_id FROM reel_jobs WHERE id = ?')
      .get(jobId) as { meta_post_id: string | null } | undefined
    if (again?.meta_post_id) return 'already_published'
    return 'contended'
  })()
}

async function waitForPeerPublish(jobId: string, attempts = 8): Promise<PublishClaim> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const row = db
      .prepare('SELECT meta_post_id, status FROM reel_jobs WHERE id = ?')
      .get(jobId) as { meta_post_id: string | null; status: string } | undefined
    if (row?.meta_post_id || row?.status === 'published') return 'already_published'
  }
  return 'contended'
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
  const platform = source.platform as string
  const duplicateCheck = isPublishDuplicateOnPage(
    pageId,
    jobId,
    platform,
    discovered.reelId,
    downloadSourceUrl || discovered.sourceUrl,
  )

  if (duplicateCheck.blocked) {
    appendJobLog(
      jobId,
      'publish',
      `Reel ${duplicateCheck.reelId} already on page — skipping duplicate upload`,
      'warn',
      { sourceUrl: duplicateCheck.sourceUrl },
    )
    recordSkippedReel({
      agencyId,
      pageId,
      sourceAccountId: sourceId,
      sourceReelId: duplicateCheck.reelId,
      sourceUrl: duplicateCheck.sourceUrl,
      jobId,
    })
    db.prepare(`
      UPDATE reel_jobs
      SET status = 'failed', error_message = 'Duplicate reel — already published to this page', completed_at = datetime('now')
      WHERE id = ? AND status != 'published'
    `).run(jobId)
    return
  }

  const publishIdentity = duplicateCheck

  if (!canPagePostToday(pageId)) {
    const job = loadJob(jobId)
    if (job.cleaned_file_path) {
      db.prepare("UPDATE reel_jobs SET status = 'queued' WHERE id = ? AND status != 'published'").run(jobId)
      appendJobLog(jobId, 'publish', 'Daily post limit reached — returned to queue for a later slot', 'warn')
      return
    }
    throw new Error('Daily post limit reached for this page')
  }

  let claim = tryClaimPublishJob(jobId)
  if (claim === 'contended') claim = await waitForPeerPublish(jobId)
  if (claim === 'already_published') {
    appendJobLog(jobId, 'publish', 'Already published — skipping duplicate upload', 'warn')
    return
  }
  if (claim === 'contended') {
    throw new Error('Publish already in progress for this job')
  }

  const account = page.facebook_account_id
    ? (db.prepare('SELECT access_token FROM facebook_accounts WHERE id = ?').get(page.facebook_account_id) as
        | { access_token: string }
        | undefined)
    : undefined

  const pageToken =
    (page.page_access_token as string | null) ??
    (account ? await getPageAccessToken(page.meta_page_id as string, account.access_token) : null)

  const metaPageId = String(page.meta_page_id ?? '')
  const fbConfigured = isFacebookConfiguredForAgency(agencyId)

  if (fbConfigured) {
    if (isMockMetaPageId(metaPageId)) {
      throw new Error('Demo pages cannot publish reels — connect a real Facebook page under Facebook → Accounts')
    }
    if (!pageToken) {
      throw new Error('Page token not available — reconnect Facebook under Facebook → Accounts')
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Facebook BYOC is not configured — complete setup under Settings → Facebook BYOC')
  } else if (!pageToken) {
    const postId = `mock_reel_${Date.now()}`
    appendJobLog(jobId, 'publish', 'Dev mock publish (no FB token, no token charge)', 'warn')
    db.prepare(`
      UPDATE reel_jobs
      SET status = 'published', meta_post_id = ?, tokens_charged = 0, completed_at = datetime('now')
      WHERE id = ? AND meta_post_id IS NULL
    `).run(postId, jobId)
    db.prepare(`
      UPDATE facebook_pages SET reels_posted_today = reels_posted_today + 1, last_published_at = datetime('now')
      WHERE id = ?
    `).run(pageId)
    recordPostedReel({
      agencyId,
      pageId,
      sourceAccountId: sourceId,
      sourceReelId: publishIdentity.reelId,
      sourceUrl: publishIdentity.sourceUrl,
      metaPostId: postId,
      jobId,
    })
    refreshPagePostedToday(pageId)
    markPageHealthCompleted(pageId)
    appendJobLog(jobId, 'complete', 'Dev mock job finished (no token charge)')
    resetPageFailureStreak(pageId)
    resetSourceFailureStreak(sourceId)
    await deleteQueueR2Media(loadJob(jobId))
    cleanupJobFiles(agencyId, jobId)
    void triggerPrefillRefill()
    return
  }

  const debited = db.transaction(() => {
    const result = db
      .prepare('UPDATE agencies SET token_balance = token_balance - ? WHERE id = ? AND token_balance >= ?')
      .run(tokenCost, agencyId, tokenCost)
    return result.changes > 0
  })()

  if (!debited) throw new Error('Insufficient token balance')

  appendJobLog(jobId, 'publish', 'Uploading to Facebook')

  let postId: string
  try {
    const result = await publishReelVideo(
      page.meta_page_id as string,
      pageToken!,
      cleanedPath,
      (loadJob(jobId).caption as string | null) || `Reel from ${source.username}`,
    )
    postId = result.postId
    appendJobLog(jobId, 'publish', `Published ${postId}`)
  } catch (err) {
    db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(tokenCost, agencyId)
    throw err
  }

  const recorded = db.transaction(() => {
    const reserved = db
      .prepare(`
        UPDATE reel_jobs
        SET status = 'published', meta_post_id = ?, tokens_charged = ?, completed_at = datetime('now')
        WHERE id = ? AND meta_post_id IS NULL
      `)
      .run(postId, tokenCost, jobId)
    if (reserved.changes === 0) return false

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
      sourceReelId: publishIdentity.reelId,
      sourceUrl: publishIdentity.sourceUrl,
      metaPostId: postId,
      jobId,
    })
    return true
  })()

  if (!recorded) {
    db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(tokenCost, agencyId)
    appendJobLog(jobId, 'publish', 'Peer worker recorded publish first — refunded duplicate token debit', 'warn')
    return
  }

  refreshPagePostedToday(pageId)
  markPageHealthCompleted(pageId)

  appendJobLog(jobId, 'complete', 'Job finished successfully')
  resetPageFailureStreak(pageId)
  resetSourceFailureStreak(sourceId)
  await deleteQueueR2Media(loadJob(jobId))
  cleanupJobFiles(agencyId, jobId)

  void triggerPrefillRefill()
}

/** Download + metadata strip only — stays in queue until schedule publishes. */
async function runPrefillJob(jobId: string) {
  appendJobLog(jobId, 'start', 'Prefill download started')
  const job = loadJob(jobId)
  const pageId = job.target_page_id as string
  let ctx: ReturnType<typeof validateJobContext>

  try {
    ctx = validateJobContext(job, { skipQuota: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const sourceId = (job.source_account_id as string | null) ?? ''
    handlePrefillDiscoveryFailure(pageId, sourceId, message)
    throw err
  }

  const { agencyId, sourceId, source } = ctx

  db.prepare("UPDATE reel_jobs SET status = 'downloading' WHERE id = ?").run(jobId)
  markScrapeIdle(pageId)
  try {
    const { download, cleanedPath } = await downloadAndClean(agencyId, jobId, source, pageId, sourceId)

    const meta = await fetchReelMetadata(download.sourceUrl)
    const defaultCaption = `Reel from @${String(source.username).replace(/^@/, '')}`
    const caption = meta?.description || meta?.title || defaultCaption
    let thumbPath = meta?.thumbnailUrl ? await downloadThumbnail(meta.thumbnailUrl, path.dirname(cleanedPath)) : null
    if (!thumbPath) {
      thumbPath = await extractVideoThumbnail(cleanedPath, path.dirname(cleanedPath))
    }

    db.prepare('UPDATE reel_jobs SET caption = ?, thumbnail_path = ? WHERE id = ?').run(caption, thumbPath, jobId)
    db.prepare("UPDATE reel_jobs SET status = 'queued' WHERE id = ?").run(jobId)
    try {
      await syncQueueMediaToR2(pageId, jobId, cleanedPath, thumbPath)
      appendJobLog(jobId, 'r2', 'Uploaded to CDN buffer')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendJobLog(jobId, 'r2', `CDN upload failed — local copy kept: ${message}`, 'warn')
    }
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
  const { agencyId } = ctx

  const cleanedPath = await resolvePublishVideoPath(job, agencyId)

  const platform = ctx.source.platform as string
  const rawUrl = (job.source_url as string) ?? ''
  const identity = resolvePublishReelIdentity(platform, (job.source_reel_id as string) ?? null, rawUrl)
  const discovered = { reelId: identity.reelId, sourceUrl: identity.sourceUrl }

  await publishCleanedFile(jobId, ctx, cleanedPath, discovered, discovered.sourceUrl || rawUrl)

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

  if (status === 'published' || job.meta_post_id) {
    appendJobLog(jobId, 'start', 'Job already published — skipping', 'warn')
    return
  }

  if (job.cleaned_file_path && status === 'downloading' && jobType !== 'prefill') {
    await runPublishFromQueueJob(jobId)
    return
  }

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

  if (job) {
    void deleteQueueR2Media(job as Record<string, unknown>)
    cleanupJobFiles(job.agency_id ?? job.user_id, jobId)
  }
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
