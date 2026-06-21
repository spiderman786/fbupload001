import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { getProxyPoolStats } from './proxyPool.js'
import { readWorkerHeartbeat } from './workerHeartbeat.js'
import { sendOpsAlertEmail } from './email.js'

const COOLDOWN_MS = Number(process.env.OPS_ALERT_COOLDOWN_MS ?? 30 * 60 * 1000)

function recentAlertSent(alertType: string): boolean {
  const row = db
    .prepare(`
      SELECT id FROM ops_alert_log
      WHERE alert_type = ? AND created_at >= datetime('now', ?)
      LIMIT 1
    `)
    .get(alertType, `-${Math.ceil(COOLDOWN_MS / 1000)} seconds`) as { id: string } | undefined
  return Boolean(row)
}

async function fireAlert(alertType: string, message: string) {
  if (recentAlertSent(alertType)) return

  const recipients = (process.env.OPS_ALERT_EMAILS ?? process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)

  db.prepare('INSERT INTO ops_alert_log (id, alert_type, message, sent_to) VALUES (?, ?, ?, ?)').run(
    uuid(),
    alertType,
    message,
    recipients.join(', ') || 'console',
  )

  if (recipients.length) {
    try {
      await sendOpsAlertEmail(recipients, alertType, message)
    } catch (err) {
      console.warn('[ops-alerts] email failed:', err)
    }
  } else {
    console.warn(`[ops-alert] ${alertType}: ${message}`)
  }
}

export async function runOpsAlertChecks() {
  const hourAgo = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published
      FROM reel_jobs
      WHERE created_at >= datetime('now', '-1 hour')
    `)
    .get() as { failed: number | null; published: number | null }

  const failed = hourAgo.failed ?? 0
  const published = hourAgo.published ?? 0
  const total = failed + published
  if (total >= 5 && failed / total > 0.2) {
    await fireAlert('high_fail_rate', `Fail rate ${Math.round((failed / total) * 100)}% (${failed}/${total} jobs in last hour)`)
  }

  const hb = readWorkerHeartbeat()
  if (!hb || hb.stale) {
    await fireAlert('worker_stale', hb ? `Worker heartbeat ${Math.round(hb.ageMs / 1000)}s old` : 'Worker heartbeat missing')
  }

  const proxy = getProxyPoolStats()
  if (proxy.poolSize > 0 && proxy.availableNow < Math.max(3, Math.floor(proxy.poolSize * 0.1))) {
    await fireAlert('proxy_pool_low', `Only ${proxy.availableNow}/${proxy.poolSize} proxies available`)
  }

  const zeroTokenAgencies = db
    .prepare(`
      SELECT COUNT(DISTINCT a.id) as count
      FROM agencies a
      JOIN facebook_pages p ON p.agency_id = a.id AND p.status = 'active'
      WHERE a.token_balance <= 0
    `)
    .get() as { count: number }

  if (zeroTokenAgencies.count > 0) {
    await fireAlert('agencies_zero_tokens', `${zeroTokenAgencies.count} agencies with active pages have 0 tokens`)
  }
}

export function listRecentAlerts(limit = 50) {
  return db
    .prepare('SELECT * FROM ops_alert_log ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id,
        alertType: r.alert_type,
        message: r.message,
        sentTo: r.sent_to,
        createdAt: r.created_at,
      }
    })
}
