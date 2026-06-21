import { db } from '../db.js'
import { getJobLogs } from './jobLog.js'

export type JobExplanation = {
  summary: string
  category: string
  likelyCause: string
  suggestedActions: string[]
  confidence: 'high' | 'medium' | 'low'
}

export function explainJobFailure(jobId: string): JobExplanation | null {
  const job = db.prepare('SELECT status, error_message, retry_count FROM reel_jobs WHERE id = ?').get(jobId) as
    | { status: string; error_message: string | null; retry_count: number }
    | undefined
  if (!job || job.status !== 'failed') return null

  const error = (job.error_message ?? '').toLowerCase()
  const logs = getJobLogs(jobId)
  const logText = logs.map((l) => l.message.toLowerCase()).join(' ')

  if (/insufficient token|token balance/.test(error)) {
    return {
      summary: 'Agency ran out of tokens',
      category: 'billing',
      likelyCause: 'Token balance is too low to publish another reel.',
      suggestedActions: ['Credit tokens from Ops → Agencies', 'Pause pages until agency purchases tokens'],
      confidence: 'high',
    }
  }

  if (/download|proxy|yt-dlp|timeout|429|403|blocked|econn/.test(error + logText)) {
    return {
      summary: 'Video download failed',
      category: 'download',
      likelyCause: 'Proxy pool exhausted, source blocked the IP, or yt-dlp could not fetch the reel.',
      suggestedActions: [
        'Check proxy pool availability in System',
        'Upload fresh proxies if available count is low',
        'Retry job — auto-retry may already have queued it',
        'Verify source account is public and not rate-limited',
      ],
      confidence: 'high',
    }
  }

  if (/403|401|oauth|token|permission|meta api|facebook|page health/.test(error + logText)) {
    return {
      summary: 'Facebook / Meta publishing error',
      category: 'facebook',
      likelyCause: 'Expired page token, missing permissions, or Meta API restriction on the page.',
      suggestedActions: [
        'Have agency reconnect Facebook in Settings',
        'Check BYOC app is in Live mode with correct permissions',
        'Review page health status — may need re-authorization',
        'Self-healing may auto-pause page after repeated Meta errors',
      ],
      confidence: 'high',
    }
  }

  if (/paused|daily reel limit|health/.test(error)) {
    return {
      summary: 'Page or schedule constraint',
      category: 'configuration',
      likelyCause: error,
      suggestedActions: ['Activate the page in Ops → Pages', 'Check daily reel limit and page health'],
      confidence: 'medium',
    }
  }

  if (/maintenance|disabled platform/.test(error)) {
    return {
      summary: 'Platform or agency maintenance',
      category: 'maintenance',
      likelyCause: 'Publishing or downloads are disabled by ops settings.',
      suggestedActions: ['Check Ops → Settings feature flags', 'Disable agency maintenance mode if set'],
      confidence: 'high',
    }
  }

  return {
    summary: job.error_message?.slice(0, 120) ?? 'Unknown failure',
    category: 'unknown',
    likelyCause: job.error_message ?? 'No detailed error recorded.',
    suggestedActions: [
      'Review step-by-step job logs',
      `Job was retried ${job.retry_count} time(s) automatically`,
      'Retry manually if error looks transient',
    ],
    confidence: 'low',
  }
}
