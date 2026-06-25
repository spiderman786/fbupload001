import fs from 'fs'
import path from 'path'
import { db } from '../db.js'
import {
  buildQueueThumbKey,
  buildQueueVideoKey,
  deleteQueueObjects,
  isR2Enabled,
  uploadQueueFile,
} from './r2Storage.js'

export async function syncQueueThumbToR2(pageId: string, jobId: string, thumbPath: string): Promise<string | null> {
  if (!isR2Enabled() || !thumbPath || !fs.existsSync(thumbPath)) return null

  const ext = path.extname(thumbPath).replace('.', '') || 'jpg'
  const thumbKey = buildQueueThumbKey(pageId, jobId, ext)
  const contentType = ext === 'webp' ? 'image/webp' : 'image/jpeg'
  await uploadQueueFile(thumbPath, thumbKey, contentType)

  db.prepare('UPDATE reel_jobs SET r2_thumb_key = ?, thumbnail_path = NULL WHERE id = ?').run(thumbKey, jobId)

  try {
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath)
  } catch {
    /* ignore */
  }

  return thumbKey
}

/** Upload local queue media to R2 and clear local copies (Pro-style CDN buffer). */
export async function syncQueueMediaToR2(
  pageId: string,
  jobId: string,
  videoPath: string,
  thumbPath: string | null,
): Promise<{ videoKey: string | null; thumbKey: string | null }> {
  if (!isR2Enabled()) return { videoKey: null, thumbKey: null }
  if (!videoPath || !fs.existsSync(videoPath)) return { videoKey: null, thumbKey: null }

  const videoKey = buildQueueVideoKey(pageId, jobId)
  await uploadQueueFile(videoPath, videoKey, 'video/mp4')

  let thumbKey: string | null = null
  if (thumbPath && fs.existsSync(thumbPath)) {
    const ext = path.extname(thumbPath).replace('.', '') || 'jpg'
    thumbKey = buildQueueThumbKey(pageId, jobId, ext)
    const contentType = ext === 'webp' ? 'image/webp' : 'image/jpeg'
    await uploadQueueFile(thumbPath, thumbKey, contentType)
  }

  db.prepare(`
    UPDATE reel_jobs SET r2_video_key = ?, r2_thumb_key = ?, cleaned_file_path = NULL, thumbnail_path = NULL
    WHERE id = ?
  `).run(videoKey, thumbKey, jobId)

  try {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath)
    if (thumbPath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath)
  } catch {
    /* ignore */
  }

  return { videoKey, thumbKey }
}

export async function deleteQueueR2Media(job: Record<string, unknown>) {
  await deleteQueueObjects([
    job.r2_video_key as string | null,
    job.r2_thumb_key as string | null,
  ])
}
