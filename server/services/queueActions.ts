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

export function removeQueuedJob(jobId: string, pageId: string, agencyId: string) {
  const job = getQueuedJobForPage(jobId, pageId, agencyId)
  if (!job) throw new Error('Queued reel not found')
  cleanupJobFiles(agencyId, jobId)
  db.prepare('DELETE FROM reel_jobs WHERE id = ?').run(jobId)
}

export function purgeQueuedJobsForPage(pageId: string, agencyId: string) {
  const jobs = db
    .prepare(`
      SELECT id FROM reel_jobs
      WHERE target_page_id = ? AND agency_id = ? AND status = 'queued'
    `)
    .all(pageId, agencyId) as { id: string }[]

  for (const job of jobs) {
    removeQueuedJob(job.id, pageId, agencyId)
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

export function queueItemHasPreview(cleanedPath: unknown, thumbnailPath: unknown): { hasPreview: boolean; hasThumbnail: boolean } {
  const video = typeof cleanedPath === 'string' && cleanedPath && fs.existsSync(cleanedPath)
  const thumb = typeof thumbnailPath === 'string' && thumbnailPath && fs.existsSync(thumbnailPath)
  return { hasPreview: video, hasThumbnail: thumb || video }
}

async function persistQueueMedia(
  jobId: string,
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

  return queueItemHasPreview(cleanedPath, thumbPath)
}

/** Re-download video or regenerate thumbnail for a queued reel. */
export async function refreshQueueItemMedia(jobId: string, pageId: string, agencyId: string) {
  const job = getQueuedJobForPage(jobId, pageId, agencyId)
  if (!job) throw new Error('Queued reel not found')

  const preview = queueItemHasPreview(job.cleaned_file_path, job.thumbnail_path)
  const sourceUrl = job.source_url as string | null
  const sourceReelId = (job.source_reel_id as string) || jobId

  if (!preview.hasPreview) {
    if (!sourceUrl) throw new Error('No source URL — skip this reel to fetch a new one')
    const next = await persistQueueMedia(jobId, agencyId, sourceUrl, sourceReelId, job.caption as string | null)
    return { jobId, ...next, refreshed: 'video' as const }
  }

  if (!preview.hasThumbnail) {
    const thumb = await ensureQueueThumbnail(job, jobId)
    if (thumb) return { jobId, hasPreview: true, hasThumbnail: true, refreshed: 'thumbnail' as const }
    if (sourceUrl) {
      const next = await persistQueueMedia(jobId, agencyId, sourceUrl, sourceReelId, job.caption as string | null)
      return { jobId, ...next, refreshed: 'video' as const }
    }
    throw new Error('Could not generate thumbnail')
  }

  return { jobId, ...preview, refreshed: 'none' as const }
}

export async function refreshMissingQueuePreviews(pageId: string, agencyId: string) {
  const rows = db
    .prepare(`
      SELECT id, cleaned_file_path, thumbnail_path, source_url
      FROM reel_jobs
      WHERE target_page_id = ? AND agency_id = ? AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 100
    `)
    .all(pageId, agencyId) as {
      id: string
      cleaned_file_path: string | null
      thumbnail_path: string | null
      source_url: string | null
    }[]

  const missing = rows.filter((row) => {
    const preview = queueItemHasPreview(row.cleaned_file_path, row.thumbnail_path)
    return !preview.hasPreview || !preview.hasThumbnail
  })
  const results: { jobId: string; ok: boolean; error?: string }[] = []

  for (const item of missing) {
    try {
      await refreshQueueItemMedia(item.id, pageId, agencyId)
      results.push({ jobId: item.id, ok: true })
    } catch (err) {
      results.push({ jobId: item.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    attempted: missing.length,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}
