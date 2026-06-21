import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { downloadReelFromUrl, stripVideoMetadata, cleanupJobFiles } from './downloader.js'
import { getPageAccessToken, publishReelVideo } from './publisher.js'
import { isFacebookConfiguredForAgency } from './byoc.js'
import { discoverNextReel } from './reelDiscovery.js'
import { recordPostedReel } from './dedup.js'
import { canPagePostToday } from './pageQuota.js'
import { appendJobLog } from './jobLog.js'
import { maybeAutoRetryJob } from './autoRetry.js'
import { applySelfHealingOnJobFailure, resetPageFailureStreak, resetSourceFailureStreak } from './selfHealing.js'
import { isPlatformFlagEnabled, isAgencyInMaintenance } from './platformSettings.js'

export type JobType = 'direct' | 'inapp' | 'scheduled'

export async function runAutomationJob(jobId: string): Promise<void> {
  appendJobLog(jobId, 'start', 'Job started')

  const job = db.prepare('SELECT * FROM reel_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined
  if (!job) throw new Error('Job not found')

  const userId = job.user_id as string
  const agencyId = (job.agency_id as string | null) ?? userId

  if (!isPlatformFlagEnabled('publishing_enabled')) throw new Error('Publishing disabled platform-wide')
  if (!isPlatformFlagEnabled('downloads_enabled')) throw new Error('Downloads disabled platform-wide')
  if (isAgencyInMaintenance(agencyId)) throw new Error('Agency is in maintenance mode')

  let sourceId = job.source_account_id as string | null
  const pageId = job.target_page_id as string

  const page = db.prepare('SELECT * FROM facebook_pages WHERE id = ? AND agency_id = ?').get(pageId, agencyId) as
    | Record<string, unknown>
    | undefined
  if (!page) throw new Error('Target page not found')
  if (page.status !== 'active') throw new Error('Target page is paused')
  if (page.health_status !== 'completed') throw new Error(`Page health: ${page.health_status}`)
  if (!canPagePostToday(pageId)) throw new Error('Daily reel limit reached for this page')

  if (!sourceId) {
    const assignment = db
      .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ?')
      .get(pageId) as { source_account_id: string } | undefined
    if (!assignment) throw new Error('No source assigned to this page')
    sourceId = assignment.source_account_id
    db.prepare('UPDATE reel_jobs SET source_account_id = ? WHERE id = ?').run(sourceId, jobId)
  }

  const source = db.prepare('SELECT * FROM source_accounts WHERE id = ? AND agency_id = ?').get(sourceId, agencyId) as
    | Record<string, unknown>
    | undefined
  if (!source || !source.is_active) throw new Error('Source account inactive')

  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as { token_balance: number }
  const tokenCost = source.tokens_per_reel as number
  if (agency.token_balance < tokenCost) throw new Error('Insufficient token balance')

  db.prepare("UPDATE reel_jobs SET status = 'downloading' WHERE id = ?").run(jobId)
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
  const download = await downloadReelFromUrl(
    agencyId,
    jobId,
    discovered.sourceUrl,
    discovered.reelId,
    discovered.mock,
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

  db.prepare("UPDATE reel_jobs SET status = 'publishing' WHERE id = ?").run(jobId)
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
      `Reel from ${source.username}`,
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
      sourceAccountId: sourceId!,
      sourceReelId: discovered.reelId,
      sourceUrl: download.sourceUrl,
      metaPostId: postId,
      jobId,
    })
  })()

  appendJobLog(jobId, 'complete', 'Job finished successfully')
  resetPageFailureStreak(pageId)
  if (sourceId) resetSourceFailureStreak(sourceId)
  cleanupJobFiles(agencyId, jobId)
}

export function failAutomationJob(jobId: string, message: string) {
  appendJobLog(jobId, 'failed', message, 'error')
  applySelfHealingOnJobFailure(jobId, message)
  if (maybeAutoRetryJob(jobId, message)) return

  const job = db.prepare('SELECT user_id, agency_id FROM reel_jobs WHERE id = ?').get(jobId) as
    | { user_id: string; agency_id: string | null }
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
