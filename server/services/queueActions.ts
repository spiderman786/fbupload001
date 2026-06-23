import fs from 'fs'
import path from 'path'
import { db } from '../db.js'
import { cleanupJobFiles, extractVideoThumbnail } from './downloader.js'
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
