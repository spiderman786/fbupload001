import { db } from '../db.js'
import { appendJobLog } from './jobLog.js'
import { isPlatformFlagEnabled } from './platformSettings.js'

const PAGE_FAIL_MAX = Number(process.env.OPS_SELF_HEAL_PAGE_FAIL_MAX ?? 5)
const SOURCE_FAIL_MAX = Number(process.env.OPS_SELF_HEAL_SOURCE_FAIL_MAX ?? 8)

export function applySelfHealingOnJobFailure(jobId: string, errorMessage: string) {
  if (!isPlatformFlagEnabled('self_healing_enabled')) return

  const job = db.prepare('SELECT target_page_id, source_account_id FROM reel_jobs WHERE id = ?').get(jobId) as
    | { target_page_id: string | null; source_account_id: string | null }
    | undefined
  if (!job) return

  const msg = errorMessage.toLowerCase()

  if (job.target_page_id && /403|401|oauth|token|permission|blocked|meta api|facebook/i.test(msg)) {
    const page = db
      .prepare('SELECT id, name, consecutive_failures, status FROM facebook_pages WHERE id = ?')
      .get(job.target_page_id) as
      | { id: string; name: string; consecutive_failures: number; status: string }
      | undefined
    if (page) {
      const failures = page.consecutive_failures + 1
      db.prepare('UPDATE facebook_pages SET consecutive_failures = ? WHERE id = ?').run(failures, page.id)
      if (failures >= PAGE_FAIL_MAX && page.status === 'active') {
        db.prepare("UPDATE facebook_pages SET status = 'paused' WHERE id = ?").run(page.id)
        appendJobLog(jobId, 'self_heal', `Auto-paused page "${page.name}" after ${failures} Meta errors`, 'warn')
      }
    }
  } else if (job.target_page_id) {
    db.prepare('UPDATE facebook_pages SET consecutive_failures = 0 WHERE id = ?').run(job.target_page_id)
  }

  if (job.source_account_id && /download|proxy|yt-dlp|timeout|429|blocked|rate/i.test(msg)) {
    const source = db
      .prepare('SELECT id, username, consecutive_failures, is_active FROM source_accounts WHERE id = ?')
      .get(job.source_account_id) as
      | { id: string; username: string; consecutive_failures: number; is_active: number }
      | undefined
    if (source) {
      const failures = source.consecutive_failures + 1
      db.prepare('UPDATE source_accounts SET consecutive_failures = ? WHERE id = ?').run(failures, source.id)
      if (failures >= SOURCE_FAIL_MAX && source.is_active) {
        db.prepare('UPDATE source_accounts SET is_active = 0 WHERE id = ?').run(source.id)
        appendJobLog(
          jobId,
          'self_heal',
          `Auto-disabled source @${source.username} after ${failures} download failures`,
          'warn',
        )
      }
    }
  }
}

export function resetPageFailureStreak(pageId: string) {
  db.prepare('UPDATE facebook_pages SET consecutive_failures = 0 WHERE id = ?').run(pageId)
}

export function resetSourceFailureStreak(sourceId: string) {
  db.prepare('UPDATE source_accounts SET consecutive_failures = 0 WHERE id = ?').run(sourceId)
}
