import fs from 'fs'
import path from 'path'
import { db } from '../db.js'
import {
  cleanupJobFiles,
  downloadReelFromUrl,
  downloadThumbnail,
  extractVideoThumbnail,
  fetchReelMetadata,
  stripVideoMetadata,
} from './downloader.js'
import { getAgencyPage } from './pageDetail.js'
import { isR2Enabled, downloadQueueFile } from './r2Storage.js'
import { deleteQueueR2Media, syncQueueMediaToR2, syncQueueThumbToR2 } from './queueMediaSync.js'
import { recordSkippedReel } from './dedup.js'

export function getQueuedJobForPage(jobId: string, pageId: string, agencyId: string) {
  const page = getAgencyPage(pageId, agencyId)
  if (!page) return null

  return db
    .prepare(`
      SELECT * FROM reel_jobs
      WHERE id = ? AND target_page_id = ? AND agency_id = ? AND status = 'queued'
    `)
    .get(jobId, pageId, agencyId) as Record<string, unknown> | undefined
}

export function updateQueuedCaption(jobId: string, pageId: string, agencyId: string, caption: string) {
  const job = getQueuedJobForPage(jobId, pageId, agencyId)
  if (!job) throw new Error('Queued reel not found')
  db.prepare('UPDATE reel_jobs SET caption = ? WHERE id = ?').run(caption.trim(), jobId)
  return caption.trim()
}

export async function removeQueuedJob(
  jobId: string,
  pageId: string,
  agencyId: string,
  options?: { recordSkip?: boolean },
) {
  const job = getQueuedJobForPage(jobId, pageId, agencyId)
  if (!job) throw new Error('Queued reel not found')

  const sourceReelId = job.source_reel_id as string | null
  if (sourceReelId && options?.recordSkip !== false) {
    recordSkippedReel({
      agencyId,
      pageId,
      sourceAccountId: (job.source_account_id as string | null) ?? null,
      sourceReelId,
      sourceUrl: (job.source_url as string | null) ?? null,
      jobId,
    })
  }

  await deleteQueueR2Media(job)
  cleanupJobFiles(agencyId, jobId)
  db.prepare('DELETE FROM reel_jobs WHERE id = ?').run(jobId)
}

/** Remove duplicate queued reels — keeps the oldest copy per source reel / URL. */
export async function dedupeQueuedJobsForPage(pageId: string, agencyId: string) {
  const jobs = db
    .prepare(`
      SELECT id, source_reel_id, source_url
      FROM reel_jobs
      WHERE target_page_id = ? AND agency_id = ? AND status = 'queued'
      ORDER BY created_at ASC
    `)
    .all(pageId, agencyId) as {
      id: string
      source_reel_id: string | null
      source_url: string | null
    }[]

  const seenReelIds = new Set<string>()
  const seenUrls = new Set<string>()
  const toRemove: string[] = []

  for (const job of jobs) {
    const reelId = job.source_reel_id?.trim()
    const url = job.source_url?.trim()

    if (reelId) {
      if (seenReelIds.has(reelId)) {
        toRemove.push(job.id)
        continue
      }
      seenReelIds.add(reelId)
    }

    if (url && !url.startsWith('mock://')) {
      if (seenUrls.has(url)) {
        toRemove.push(job.id)
        continue
      }
      seenUrls.add(url)
    }
  }

  const mockJobs = jobs.filter((job) => job.source_url?.startsWith('mock://'))
  if (mockJobs.length > 1 && mockJobs.length === jobs.length) {
    for (const job of mockJobs.slice(1)) {
      if (!toRemove.includes(job.id)) toRemove.push(job.id)
    }
  }

  for (const id of toRemove) {
    await removeQueuedJob(id, pageId, agencyId, { recordSkip: false })
  }

  return { removed: toRemove.length, kept: jobs.length - toRemove.length }
}

export async function purgeQueuedJobsForPage(pageId: string, agencyId: string) {
  const jobs = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND agency_id = ? AND status = 'queued'
    `)
    .all(pageId, agencyId) as { id: string }[]

  for (const job of jobs) {
    await removeQueuedJob(job.id, pageId, agencyId)
  }
  return jobs.length
}

export function resolveQueueMediaPath(
  job: Record<string, unknown>,
  kind: 'video' | 'thumbnail',
): string | null {
  if (kind === 'video') {
    const p = job.cleaned_file_path as string | null
    return p && fs.existsSync(p) ? p : null
  }
  const p = job.thumbnail_path as string | null
  return p && fs.existsSync(p) ? p : null
}

/** Rebuild a download URL when older queue rows lost source_url but still have source_reel_id. */
export function resolveQueueSourceUrl(job: Record<string, unknown>): string | null {
  const existing = job.source_url as string | null
  if (existing?.trim() && !existing.startsWith('mock://')) return existing.trim()

  const reelId = job.source_reel_id as string | null
  if (!reelId?.trim()) return null

  const posted = db
    .prepare(`
      SELECT source_url FROM posted_reels
      WHERE source_reel_id = ? AND source_url IS NOT NULL AND source_url != ''
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(reelId) as { source_url: string } | undefined
  if (posted?.source_url && !posted.source_url.startsWith('mock://')) {
    return posted.source_url
  }

  let platform = job.source_platform as string | null
  let username = job.source_username as string | null
  if ((!platform || !username) && job.source_account_id) {
    const source = db
      .prepare('SELECT platform, username FROM source_accounts WHERE id = ?')
      .get(job.source_account_id as string) as { platform: string; username: string } | undefined
    platform = platform ?? source?.platform ?? null
    username = username ?? source?.username ?? null
  }

  const handle = username?.replace(/^@/, '')
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return `https://www.instagram.com/reel/${reelId}/`
    case 'youtube':
      return `https://www.youtube.com/shorts/${reelId}`
    case 'facebook':
      return `https://www.facebook.com/reel/${reelId}`
    case 'tiktok':
      if (handle) return `https://www.tiktok.com/@${handle}/video/${reelId}`
      return `https://www.tiktok.com/video/${reelId}`
    default:
      return null
  }
}

function persistResolvedSourceUrl(jobId: string, job: Record<string, unknown>, sourceUrl: string) {
  const existing = job.source_url as string | null
  if (!existing?.trim()) {
    db.prepare('UPDATE reel_jobs SET source_url = ? WHERE id = ?').run(sourceUrl, jobId)
  }
}

/** Resolve a local video path for publishing — downloads from R2 when local file was cleared. */
export async function resolvePublishVideoPath(
  job: Record<string, unknown>,
  agencyId: string,
): Promise<string> {
  const local = resolveQueueMediaPath(job, 'video')
  if (local) return local

  const r2Key = job.r2_video_key as string | null
  if (r2Key && isR2Enabled()) {
    const jobId = job.id as string
    const jobDir = path.join(process.cwd(), 'data', 'downloads', agencyId, jobId)
    const tempPath = path.join(jobDir, 'publish.mp4')
    await downloadQueueFile(r2Key, tempPath)
    return tempPath
  }

  throw new Error('Queued video file missing — re-download required')
}

/** Generate thumbnail from video on demand and persist path for older queue rows. */
export async function ensureQueueThumbnail(job: Record<string, unknown>, jobId: string): Promise<string | null> {
  const existing = resolveQueueMediaPath(job, 'thumbnail')
  if (existing) return existing

  const video = job.cleaned_file_path as string | null
  if (!video || !fs.existsSync(video)) return null

  const generated = await extractVideoThumbnail(video, path.dirname(video))
  if (!generated) return null

  db.prepare('UPDATE reel_jobs SET thumbnail_path = ? WHERE id = ?').run(generated, jobId)
  return generated
}

export function queueItemHasPreview(
  cleanedPath: unknown,
  thumbnailPath: unknown,
  r2VideoKey?: unknown,
  r2ThumbKey?: unknown,
): { hasPreview: boolean; hasThumbnail: boolean } {
  const r2Video = isR2Enabled() && typeof r2VideoKey === 'string' && r2VideoKey.length > 0
  const r2Thumb = isR2Enabled() && typeof r2ThumbKey === 'string' && r2ThumbKey.length > 0
  const video = r2Video || (typeof cleanedPath === 'string' && cleanedPath && fs.existsSync(cleanedPath))
  const thumb =
    r2Thumb ||
    (typeof thumbnailPath === 'string' && thumbnailPath && fs.existsSync(thumbnailPath)) ||
    video
  return { hasPreview: Boolean(video), hasThumbnail: Boolean(thumb) }
}

async function persistQueueMedia(
  jobId: string,
  pageId: string,
  agencyId: string,
  sourceUrl: string,
  sourceReelId: string,
  existingCaption: string | null,
) {
  const download = await downloadReelFromUrl(agencyId, jobId, sourceUrl, sourceReelId, false)
  const cleanedPath = path.join(path.dirname(download.filePath), 'clean.mp4')
  await stripVideoMetadata(download.filePath, cleanedPath)

  try {
    if (fs.existsSync(download.filePath)) fs.unlinkSync(download.filePath)
  } catch {
    /* ignore */
  }

  const meta = await fetchReelMetadata(sourceUrl)
  let thumbPath = meta?.thumbnailUrl ? await downloadThumbnail(meta.thumbnailUrl, path.dirname(cleanedPath)) : null
  if (!thumbPath) thumbPath = await extractVideoThumbnail(cleanedPath, path.dirname(cleanedPath))

  const caption =
    existingCaption?.trim() ||
    meta?.description ||
    meta?.title ||
    null

  db.prepare(`
    UPDATE reel_jobs SET cleaned_file_path = ?, thumbnail_path = ?, local_file_path = NULL, caption = COALESCE(?, caption)
    WHERE id = ?
  `).run(cleanedPath, thumbPath, caption, jobId)

  try {
    await syncQueueMediaToR2(pageId, jobId, cleanedPath, thumbPath)
  } catch (err) {
    console.warn('[queue] R2 sync failed, local copy kept:', jobId, err instanceof Error ? err.message : err)
  }

  const row = db.prepare('SELECT cleaned_file_path, thumbnail_path, r2_video_key, r2_thumb_key FROM reel_jobs WHERE id = ?').get(jobId) as Record<string, unknown>
  return queueItemHasPreview(row.cleaned_file_path, row.thumbnail_path, row.r2_video_key, row.r2_thumb_key)
}

/** Re-download video or regenerate thumbnail for a queued reel. */
export async function refreshQueueItemMedia(jobId: string, pageId: string, agencyId: string) {
  const job = getQueuedJobForPage(jobId, pageId, agencyId)
  if (!job) throw new Error('Queued reel not found')

  const preview = queueItemHasPreview(
    job.cleaned_file_path,
    job.thumbnail_path,
    job.r2_video_key,
    job.r2_thumb_key,
  )
  const sourceUrl = resolveQueueSourceUrl(job)
  const sourceReelId = (job.source_reel_id as string) || jobId

  if (!preview.hasPreview) {
    if (!sourceUrl) throw new Error('No source URL — skip this reel to fetch a new one')
    persistResolvedSourceUrl(jobId, job, sourceUrl)
    const next = await persistQueueMedia(jobId, pageId, agencyId, sourceUrl, sourceReelId, job.caption as string | null)
    return { jobId, ...next, refreshed: 'video' as const }
  }

  if (!preview.hasThumbnail) {
    let videoPath = resolveQueueMediaPath(job, 'video')
    if (!videoPath && job.r2_video_key && isR2Enabled()) {
      const jobDir = path.join(process.cwd(), 'data', 'downloads', agencyId, jobId)
      videoPath = path.join(jobDir, 'process.mp4')
      await downloadQueueFile(job.r2_video_key as string, videoPath)
    }
    if (videoPath) {
      const jobWithVideo = { ...job, cleaned_file_path: videoPath }
      const thumb = await ensureQueueThumbnail(jobWithVideo, jobId)
      if (thumb) {
        if (job.r2_video_key && !resolveQueueMediaPath(job, 'video')) {
          await syncQueueThumbToR2(pageId, jobId, thumb)
        } else {
          await syncQueueMediaToR2(pageId, jobId, videoPath, thumb)
        }
        return { jobId, hasPreview: true, hasThumbnail: true, refreshed: 'thumbnail' as const }
      }
    }
    if (sourceUrl) {
      const next = await persistQueueMedia(jobId, pageId, agencyId, sourceUrl, sourceReelId, job.caption as string | null)
      return { jobId, ...next, refreshed: 'video' as const }
    }
    throw new Error('Could not generate thumbnail')
  }

  return { jobId, ...preview, refreshed: 'none' as const }
}

const refreshInFlight = new Set<string>()

async function processMissingQueuePreviews(
  pageId: string,
  agencyId: string,
  missing: { id: string }[],
) {
  for (const item of missing) {
    try {
      await refreshQueueItemMedia(item.id, pageId, agencyId)
    } catch (err) {
      console.warn('[queue] preview refresh failed:', item.id, err instanceof Error ? err.message : err)
    }
  }
}

export async function refreshMissingQueuePreviews(pageId: string, agencyId: string) {
  const rows = db
    .prepare(`
      SELECT r.id, r.cleaned_file_path, r.thumbnail_path, r.r2_video_key, r.r2_thumb_key,
        r.source_url, r.source_reel_id, r.source_account_id,
        s.platform as source_platform, s.username as source_username
      FROM reel_jobs r
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.target_page_id = ? AND r.agency_id = ? AND r.status = 'queued'
      ORDER BY r.created_at ASC
      LIMIT 100
    `)
    .all(pageId, agencyId) as Record<string, unknown>[]

  const missing = rows.filter((row) => {
    const preview = queueItemHasPreview(
      row.cleaned_file_path,
      row.thumbnail_path,
      row.r2_video_key,
      row.r2_thumb_key,
    )
    return !preview.hasPreview || !preview.hasThumbnail
  })

  const alreadyRunning = refreshInFlight.has(pageId)
  if (missing.length && !alreadyRunning) {
    refreshInFlight.add(pageId)
    void processMissingQueuePreviews(pageId, agencyId, missing as { id: string }[]).finally(() => {
      refreshInFlight.delete(pageId)
    })
  }

  return {
    attempted: missing.length,
    refreshed: 0,
    failed: 0,
    background: missing.length > 0,
    alreadyRunning: alreadyRunning && missing.length > 0,
    results: [] as { jobId: string; ok: boolean; error?: string }[],
  }
}
