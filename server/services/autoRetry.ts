import { db } from '../db.js'
import { appendJobLog } from './jobLog.js'
import { isPlatformFlagEnabled } from './platformSettings.js'

const MAX_AUTO_RETRIES = Number(process.env.OPS_AUTO_RETRY_MAX ?? 3)

const RETRYABLE = /download|proxy|yt-dlp|timeout|ECONN|429|403|blocked|rate/i

export function maybeAutoRetryJob(jobId: string, errorMessage: string): boolean {
  if (!isPlatformFlagEnabled('auto_retry_enabled')) return false
  if (process.env.OPS_AUTO_RETRY_ENABLED === 'false') return false
  if (!RETRYABLE.test(errorMessage)) return false

  const job = db.prepare('SELECT retry_count FROM reel_jobs WHERE id = ?').get(jobId) as
    | { retry_count: number }
    | undefined
  if (!job || job.retry_count >= MAX_AUTO_RETRIES) return false

  db.prepare(`
    UPDATE reel_jobs
    SET status = 'pending', retry_count = retry_count + 1, error_message = NULL, completed_at = NULL
    WHERE id = ?
  `).run(jobId)

  appendJobLog(jobId, 'auto_retry', `Scheduled auto-retry ${job.retry_count + 1}/${MAX_AUTO_RETRIES}`, 'warn', {
    error: errorMessage,
  })

  void import('./jobQueue.js').then(({ enqueueJob }) => enqueueJob(jobId))
  return true
}
