import fs from 'fs'
import { db } from '../db.js'
import { cleanupJobFiles } from './downloader.js'
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
