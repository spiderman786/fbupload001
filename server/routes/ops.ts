import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import fs from 'fs'
import path from 'path'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { requirePlatformAdmin, type PlatformAdminRequest } from '../middleware/platformAdmin.js'
import { isPlatformAdmin, isPlatformAdminStrictMode } from '../services/platformAdmin.js'
import { getJobLogs } from '../services/jobLog.js'
import { writeOpsAudit, listOpsAudit } from '../services/opsAudit.js'
import { listRecentAlerts, runOpsAlertChecks } from '../services/opsAlerts.js'
import { getProxyPoolStats } from '../services/proxyPool.js'
import { readWorkerHeartbeat } from '../services/workerHeartbeat.js'
import { enqueueJob } from '../services/jobQueue.js'
import { setAgencyCookie, buildSessionPayload } from '../utils/agency.js'
import { deleteAgency, pauseAllAgencyPages } from '../services/deleteAgency.js'
import { getAgencyHealthScores, globalOpsSearch, getJobErrorGroups } from '../services/agencyHealth.js'
import { getAllPlatformSettings, setPlatformSetting, setAgencyMaintenance, type PlatformFlag } from '../services/platformSettings.js'
import { pollLiveEvents } from '../services/opsLiveFeed.js'
import { explainJobFailure } from '../services/jobExplain.js'
import { getSmtpConfigStatus, testSmtpConnection } from '../services/email.js'

import { routeParam } from '../utils/routeParam.js'

function opsRead(handler: (req: import('express').Request, res: import('express').Response) => void): import('express').RequestHandler {
  return (req, res) => {
    try {
      handler(req, res)
    } catch (error) {
      console.error(`[ops] ${req.method} ${req.path}`, error)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    }
  }
}

function opsWrite(
  handler: (req: import('express').Request, res: import('express').Response) => void | Promise<void>,
): import('express').RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error(`[ops] ${req.method} ${req.path}`, error)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
      else next(error)
    })
  }
}

export const opsRouter = Router()

const guard = [authMiddleware, requireVerified, requirePlatformAdmin] as const

opsRouter.get('/me', authMiddleware, requireVerified, (req: PlatformAdminRequest, res) => {
  const allowed = Boolean(req.user && isPlatformAdmin(req.user.id, req.user.email))
  res.json({
    platformAdmin: allowed,
    signedInAs: req.user?.email ?? null,
    strictMode: isPlatformAdminStrictMode(),
  })
})

opsRouter.get('/overview', ...guard, opsRead((_req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const agencies = db.prepare('SELECT COUNT(*) as c FROM agencies').get() as { c: number }
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  const pages = db.prepare('SELECT COUNT(*) as c FROM facebook_pages').get() as { c: number }
  const activePages = db
    .prepare("SELECT COUNT(*) as c FROM facebook_pages WHERE status = 'active'")
    .get() as { c: number }
  const pendingJobs = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status IN ('pending','downloading','publishing')")
    .get() as { c: number }
  const publishedToday = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status = 'published' AND date(completed_at) = date(?)")
    .get(today) as { c: number }
  const failedToday = db
    .prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE status = 'failed' AND date(completed_at) = date(?)")
    .get(today) as { c: number }
  const tokensSold = db
    .prepare("SELECT COALESCE(SUM(amount),0) as t FROM token_transactions WHERE amount > 0")
    .get() as { t: number }
  const tokensUsed = db
    .prepare("SELECT COALESCE(SUM(ABS(amount)),0) as t FROM token_transactions WHERE type = 'publish_debit'")
    .get() as { t: number }

  res.json({
    agencies: agencies.c,
    users: users.c,
    pages: pages.c,
    activePages: activePages.c,
    pendingJobs: pendingJobs.c,
    publishedToday: publishedToday.c,
    failedToday: failedToday.c,
    tokensSold: tokensSold.t,
    tokensUsed: tokensUsed.t,
    proxy: getProxyPoolStats(),
    worker: readWorkerHeartbeat(),
  })
}))

opsRouter.get('/agencies', ...guard, opsRead((_req, res) => {
  const healthMap = new Map(getAgencyHealthScores().map((h) => [h.agencyId, h]))
  const rows = db
    .prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM facebook_pages p WHERE p.agency_id = a.id) as page_count,
        (SELECT COUNT(*) FROM agency_members m WHERE m.agency_id = a.id) as member_count,
        (SELECT email FROM users u JOIN agency_members m ON m.user_id = u.id WHERE m.agency_id = a.id AND m.role = 'owner' LIMIT 1) as owner_email,
        (SELECT name FROM agencies pa WHERE pa.id = a.parent_agency_id) as parent_name
      FROM agencies a
      ORDER BY a.created_at DESC
    `)
    .all()
    .map((row) => {
      const r = row as Record<string, unknown>
      const health = healthMap.get(String(r.id))
      return { ...r, healthScore: health?.score ?? null, healthStatus: health?.status ?? null }
    })
  res.json({ agencies: rows })
}))

opsRouter.get('/agencies/:id', ...guard, opsRead((req, res) => {
  const agency = db.prepare('SELECT * FROM agencies WHERE id = ?').get(routeParam(req.params.id))
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  const pages = db.prepare('SELECT * FROM facebook_pages WHERE agency_id = ?').all(routeParam(req.params.id))
  const sources = db.prepare('SELECT * FROM source_accounts WHERE agency_id = ?').all(routeParam(req.params.id))
  const members = db
    .prepare(`
      SELECT u.id as user_id, u.email, u.full_name, m.role, m.created_at
      FROM agency_members m JOIN users u ON u.id = m.user_id
      WHERE m.agency_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email
    `)
    .all(routeParam(req.params.id))
  const notes = db
    .prepare(`
      SELECT n.*, u.email as admin_email FROM agency_ops_notes n
      JOIN users u ON u.id = n.admin_user_id
      WHERE n.agency_id = ? ORDER BY n.created_at DESC LIMIT 20
    `)
    .all(routeParam(req.params.id))
  res.json({ agency, pages, sources, members, notes })
}))

opsRouter.patch('/agencies/:id/members/:userId', ...guard, (req: PlatformAdminRequest, res) => {
  const { role } = req.body ?? {}
  if (!role || !['owner', 'admin', 'staff'].includes(role)) {
    res.status(400).json({ error: 'Role must be owner, admin, or staff' })
    return
  }

  const member = db
    .prepare('SELECT role FROM agency_members WHERE agency_id = ? AND user_id = ?')
    .get(routeParam(req.params.id), routeParam(req.params.userId)) as { role: string } | undefined

  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  if (member.role === role) {
    res.json({ message: 'Role unchanged', role })
    return
  }

  db.prepare('UPDATE agency_members SET role = ? WHERE agency_id = ? AND user_id = ?').run(
    role,
    routeParam(req.params.id),
    routeParam(req.params.userId),
  )

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(routeParam(req.params.userId)) as { email: string }
  writeOpsAudit(req.user!.id, 'change_member_role', 'agency_member', routeParam(req.params.userId), {
    agencyId: routeParam(req.params.id),
    email: user.email,
    from: member.role,
    to: role,
  })

  res.json({ message: 'Role updated', role })
})

opsRouter.post('/agencies/:id/notes', ...guard, (req: PlatformAdminRequest, res) => {
  const note = String(req.body?.note ?? '').trim()
  if (!note) {
    res.status(400).json({ error: 'Note required' })
    return
  }
  const id = uuid()
  db.prepare('INSERT INTO agency_ops_notes (id, agency_id, admin_user_id, note) VALUES (?, ?, ?, ?)').run(
    id,
    routeParam(req.params.id),
    req.user!.id,
    note,
  )
  writeOpsAudit(req.user!.id, 'agency_note', 'agency', routeParam(req.params.id), { note })
  res.json({ id, note })
})

opsRouter.post('/agencies/:id/credit-tokens', ...guard, (req: PlatformAdminRequest, res) => {
  const amount = Number(req.body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' })
    return
  }
  const agency = db.prepare('SELECT id, token_balance FROM agencies WHERE id = ?').get(routeParam(req.params.id)) as
    | { id: string; token_balance: number }
    | undefined
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(amount, routeParam(req.params.id))
  const owner = db
    .prepare("SELECT user_id FROM agency_members WHERE agency_id = ? AND role = 'owner' LIMIT 1")
    .get(routeParam(req.params.id)) as { user_id: string } | undefined
  if (owner) {
    db.prepare(`
      INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
      VALUES (?, ?, ?, ?, 'purchase', ?)
    `).run(uuid(), owner.user_id, routeParam(req.params.id), amount, `Ops credit by ${req.user!.email}`)
  }
  writeOpsAudit(req.user!.id, 'credit_tokens', 'agency', routeParam(req.params.id), { amount })
  res.json({ tokenBalance: agency.token_balance + amount })
})

opsRouter.delete('/agencies/bulk', ...guard, (req: PlatformAdminRequest, res) => {
  const agencyIds = req.body?.agencyIds as string[] | undefined
  const confirmText = String(req.body?.confirmText ?? '').trim()
  if (!Array.isArray(agencyIds) || !agencyIds.length) {
    res.status(400).json({ error: 'agencyIds required' })
    return
  }
  if (confirmText !== 'DELETE SELECTED AGENCIES') {
    res.status(400).json({ error: 'Confirmation text must be DELETE SELECTED AGENCIES' })
    return
  }

  const deleted: string[] = []
  const failed: { id: string; name?: string; error: string }[] = []

  for (const agencyId of agencyIds.slice(0, 50)) {
    const agency = db.prepare('SELECT id, name FROM agencies WHERE id = ?').get(agencyId) as
      | { id: string; name: string }
      | undefined
    if (!agency) {
      failed.push({ id: agencyId, error: 'Agency not found' })
      continue
    }

    try {
      deleteAgency(agency.id, agency.name)
      writeOpsAudit(req.user!.id, 'delete_agency', 'agency', agency.id, { bulk: true, confirmText })
      deleted.push(agency.id)
    } catch (err) {
      failed.push({ id: agency.id, name: agency.name, error: err instanceof Error ? err.message : 'Delete failed' })
    }
  }

  res.json({ deleted, failed })
})

opsRouter.delete('/agencies/:id', ...guard, (req: PlatformAdminRequest, res) => {
  const confirmName = String(req.body?.confirmName ?? '').trim()
  if (!confirmName) {
    res.status(400).json({ error: 'confirmName required' })
    return
  }
  try {
    deleteAgency(routeParam(req.params.id), confirmName)
    writeOpsAudit(req.user!.id, 'delete_agency', 'agency', routeParam(req.params.id), { confirmName })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
})

opsRouter.post('/agencies/:id/pause-pages', ...guard, (req: PlatformAdminRequest, res) => {
  const count = pauseAllAgencyPages(routeParam(req.params.id))
  writeOpsAudit(req.user!.id, 'pause_all_pages', 'agency', routeParam(req.params.id), { count })
  res.json({ paused: count })
})

opsRouter.patch('/agencies/:id/parent', ...guard, (req: PlatformAdminRequest, res) => {
  const parentAgencyId = req.body?.parentAgencyId as string | null | undefined
  if (parentAgencyId === routeParam(req.params.id)) {
    res.status(400).json({ error: 'Agency cannot be its own parent' })
    return
  }
  if (parentAgencyId) {
    const parent = db.prepare('SELECT id FROM agencies WHERE id = ?').get(parentAgencyId)
    if (!parent) {
      res.status(404).json({ error: 'Parent agency not found' })
      return
    }
  }
  db.prepare('UPDATE agencies SET parent_agency_id = ? WHERE id = ?').run(parentAgencyId ?? null, routeParam(req.params.id))
  writeOpsAudit(req.user!.id, 'set_parent_agency', 'agency', routeParam(req.params.id), { parentAgencyId: parentAgencyId ?? null })
  res.json({ ok: true })
})

opsRouter.patch('/agencies/:id/maintenance', ...guard, (req: PlatformAdminRequest, res) => {
  const enabled = Boolean(req.body?.enabled)
  setAgencyMaintenance(routeParam(req.params.id), enabled)
  writeOpsAudit(req.user!.id, 'agency_maintenance', 'agency', routeParam(req.params.id), { enabled })
  res.json({ maintenance: enabled })
})

opsRouter.post('/agencies/bulk-credit', ...guard, (req: PlatformAdminRequest, res) => {
  const agencyIds = req.body?.agencyIds as string[] | undefined
  const amount = Number(req.body?.amount)
  if (!Array.isArray(agencyIds) || !agencyIds.length) {
    res.status(400).json({ error: 'agencyIds required' })
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' })
    return
  }
  let credited = 0
  for (const agencyId of agencyIds.slice(0, 50)) {
    const agency = db.prepare('SELECT id, token_balance FROM agencies WHERE id = ?').get(agencyId) as
      | { id: string; token_balance: number }
      | undefined
    if (!agency) continue
    db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(amount, agencyId)
    const owner = db
      .prepare("SELECT user_id FROM agency_members WHERE agency_id = ? AND role = 'owner' LIMIT 1")
      .get(agencyId) as { user_id: string } | undefined
    if (owner) {
      db.prepare(`
        INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
        VALUES (?, ?, ?, ?, 'purchase', ?)
      `).run(uuid(), owner.user_id, agencyId, amount, `Ops bulk credit by ${req.user!.email}`)
    }
    credited++
  }
  writeOpsAudit(req.user!.id, 'bulk_credit_tokens', 'agency', agencyIds.join(','), { amount, credited })
  res.json({ credited })
})

opsRouter.get('/pages', ...guard, opsRead((req, res) => {
  const { status, health } = req.query
  let sql = `
    SELECT p.*, a.name as agency_name
    FROM facebook_pages p
    JOIN agencies a ON a.id = p.agency_id
    WHERE 1=1
  `
  const params: unknown[] = []
  if (status) {
    sql += ' AND p.status = ?'
    params.push(status)
  }
  if (health) {
    sql += ' AND p.health_status = ?'
    params.push(health)
  }
  sql += ' ORDER BY (p.last_published_at IS NULL), p.last_published_at DESC LIMIT 200'
  res.json({ pages: db.prepare(sql).all(...params) })
}))

opsRouter.patch('/pages/:id', ...guard, (req: PlatformAdminRequest, res) => {
  const status = req.body?.status as string | undefined
  if (status && !['active', 'paused'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }
  if (status) db.prepare('UPDATE facebook_pages SET status = ? WHERE id = ?').run(status, routeParam(req.params.id))
  writeOpsAudit(req.user!.id, 'update_page', 'page', routeParam(req.params.id), { status })
  res.json({ ok: true })
})

opsRouter.get('/jobs', ...guard, opsRead((req, res) => {
  const { status, agencyId, limit = '100' } = req.query
  let sql = `
    SELECT r.*, p.name as page_name, s.username as source_username, a.name as agency_name
    FROM reel_jobs r
    LEFT JOIN facebook_pages p ON p.id = r.target_page_id
    LEFT JOIN source_accounts s ON s.id = r.source_account_id
    LEFT JOIN agencies a ON a.id = r.agency_id
    WHERE 1=1
  `
  const params: unknown[] = []
  if (status) {
    sql += ' AND r.status = ?'
    params.push(status)
  }
  if (agencyId) {
    sql += ' AND r.agency_id = ?'
    params.push(agencyId)
  }
  sql += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(Math.min(500, Number(limit) || 100))
  res.json({ jobs: db.prepare(sql).all(...params) })
}))

opsRouter.get('/jobs/error-groups', ...guard, opsRead((req, res) => {
  const days = Math.min(30, Number(req.query.days) || 7)
  res.json({ groups: getJobErrorGroups(days), days })
}))

opsRouter.post('/jobs/bulk-retry', ...guard, (req: PlatformAdminRequest, res) => {
  const errorMessage = req.body?.errorMessage as string | undefined
  const jobIds = req.body?.jobIds as string[] | undefined

  const ids: string[] = Array.isArray(jobIds) && jobIds.length
    ? jobIds.slice(0, 200)
    : errorMessage
      ? (
          db
            .prepare(`
              SELECT id FROM reel_jobs
              WHERE status = 'failed' AND error_message = ?
              ORDER BY created_at DESC LIMIT 200
            `)
            .all(errorMessage) as { id: string }[]
        ).map((r) => r.id)
      : []

  if (!ids.length) {
    res.status(400).json({ error: 'jobIds or errorMessage required' })
    return
  }

  let retried = 0
  for (const id of ids) {
    const result = db.prepare(`
      UPDATE reel_jobs SET status = 'pending', error_message = NULL, completed_at = NULL WHERE id = ? AND status = 'failed'
    `).run(id)
    if (result.changes > 0) {
      enqueueJob(id)
      retried++
    }
  }
  writeOpsAudit(req.user!.id, 'bulk_retry_jobs', 'job', ids[0] ?? '', { count: retried, errorMessage })
  res.json({ retried })
})

opsRouter.get('/jobs/:id', ...guard, (req, res) => {
  const job = db
    .prepare(`
      SELECT r.*, p.name as page_name, s.username as source_username, a.name as agency_name
      FROM reel_jobs r
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      LEFT JOIN agencies a ON a.id = r.agency_id
      WHERE r.id = ?
    `)
    .get(routeParam(req.params.id))
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json({ job, logs: getJobLogs(routeParam(req.params.id)) })
})

opsRouter.post('/jobs/:id/retry', ...guard, (req: PlatformAdminRequest, res) => {
  const job = db.prepare('SELECT id, status FROM reel_jobs WHERE id = ?').get(routeParam(req.params.id)) as
    | { id: string; status: string }
    | undefined
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  if (job.status !== 'failed') {
    res.status(400).json({ error: 'Only failed jobs can be retried' })
    return
  }
  db.prepare(`
    UPDATE reel_jobs SET status = 'pending', error_message = NULL, completed_at = NULL WHERE id = ? AND status = 'failed'
  `).run(routeParam(req.params.id))
  enqueueJob(routeParam(req.params.id))
  writeOpsAudit(req.user!.id, 'retry_job', 'job', routeParam(req.params.id))
  res.json({ ok: true })
})

opsRouter.get('/jobs/:id/explain', ...guard, (req, res) => {
  const explanation = explainJobFailure(routeParam(req.params.id))
  if (!explanation) {
    res.status(404).json({ error: 'Job not failed or not found' })
    return
  }
  res.json({ explanation })
})

opsRouter.get('/analytics', ...guard, opsRead((req, res) => {
  const days = Math.min(30, Number(req.query.days) || 14)
  const daily = db
    .prepare(`
      SELECT date(completed_at) as day,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM reel_jobs
      WHERE completed_at >= datetime('now', ?)
      GROUP BY date(completed_at)
      ORDER BY day ASC
    `)
    .all(`-${days} days`)

  const byPlatform = db
    .prepare(`
      SELECT s.platform, COUNT(*) as jobs,
        SUM(CASE WHEN r.status = 'published' THEN 1 ELSE 0 END) as published,
        SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM reel_jobs r
      JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.created_at >= datetime('now', '-14 days')
      GROUP BY s.platform
    `)
    .all()

  const topErrors = db
    .prepare(`
      SELECT error_message, COUNT(*) as count FROM reel_jobs
      WHERE status = 'failed' AND error_message IS NOT NULL
        AND created_at >= datetime('now', '-7 days')
      GROUP BY error_message ORDER BY count DESC LIMIT 10
    `)
    .all()

  const agencyActivity = db
    .prepare(`
      SELECT a.name, a.token_balance,
        (SELECT COUNT(*) FROM reel_jobs j WHERE j.agency_id = a.id AND j.status = 'published' AND j.created_at >= datetime('now', '-7 days')) as published_7d
      FROM agencies a ORDER BY published_7d DESC LIMIT 15
    `)
    .all()

  res.json({ daily, byPlatform, topErrors, agencyActivity, days })
}))

opsRouter.get('/audit', ...guard, opsRead((req, res) => {
  res.json({ audit: listOpsAudit(Number(req.query.limit) || 100) })
}))

opsRouter.get('/alerts', ...guard, opsRead((_req, res) => {
  res.json({ alerts: listRecentAlerts() })
}))

opsRouter.post('/alerts/run-checks', ...guard, opsWrite(async (_req, res) => {
  await runOpsAlertChecks()
  res.json({ ok: true, alerts: listRecentAlerts(10) })
}))

opsRouter.get('/system', ...guard, opsRead((_req, res) => {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'fbuploadpro.db')
  let dbSize = 0
  try {
    dbSize = fs.statSync(dbPath).size
  } catch {
    /* ignore */
  }
  const oldestPending = db
    .prepare(`
      SELECT id, created_at FROM reel_jobs WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 1
    `)
    .get() as { id: string; created_at: string } | undefined

  res.json({
    worker: readWorkerHeartbeat(),
    proxy: getProxyPoolStats(),
    smtp: getSmtpConfigStatus(),
    dbPath,
    dbSizeBytes: dbSize,
    oldestPendingJob: oldestPending ?? null,
    nodeVersion: process.version,
    uptimeSec: Math.floor(process.uptime()),
  })
}))

opsRouter.post('/impersonate/:agencyId', ...guard, (req: PlatformAdminRequest, res) => {
  const agency = db.prepare('SELECT id FROM agencies WHERE id = ?').get(routeParam(req.params.agencyId))
  if (!agency) {
    res.status(404).json({ error: 'Agency not found' })
    return
  }
  writeOpsAudit(req.user!.id, 'impersonate', 'agency', routeParam(req.params.agencyId))
  setAgencyCookie(res, routeParam(req.params.agencyId))
  res.json(buildSessionPayload(req.user!.id, routeParam(req.params.agencyId)))
})

opsRouter.get('/search', ...guard, opsRead((req, res) => {
  const q = String(req.query.q ?? '')
  res.json(globalOpsSearch(q))
}))

opsRouter.post('/smtp-test', ...guard, opsWrite(async (_req, res) => {
  const status = getSmtpConfigStatus()
  const result = await testSmtpConnection()
  res.json({ status, result })
}))

opsRouter.get('/health', ...guard, opsRead((_req, res) => {
  res.json({ agencies: getAgencyHealthScores() })
}))

opsRouter.get('/settings', ...guard, opsRead((_req, res) => {
  const alertConfig = db.prepare('SELECT * FROM ops_alert_config').all().map((row) => {
    const r = row as Record<string, unknown>
    return {
      alertType: r.alert_type,
      enabled: Boolean(r.enabled),
      threshold: r.threshold,
      webhookUrl: r.webhook_url,
    }
  })
  res.json({ settings: getAllPlatformSettings(), alertConfig })
}))

opsRouter.patch('/settings', ...guard, (req: PlatformAdminRequest, res) => {
  const settings = req.body?.settings as Record<string, string> | undefined
  if (settings) {
    const allowed: PlatformFlag[] = [
      'downloads_enabled',
      'publishing_enabled',
      'auto_retry_enabled',
      'maintenance_mode',
      'self_healing_enabled',
    ]
    for (const key of allowed) {
      if (settings[key] !== undefined) setPlatformSetting(key, String(settings[key]))
    }
  }
  const alertConfig = req.body?.alertConfig as
    | { alertType: string; enabled?: boolean; threshold?: number; webhookUrl?: string }[]
    | undefined
  if (Array.isArray(alertConfig)) {
    for (const row of alertConfig.slice(0, 20)) {
      db.prepare(`
        INSERT INTO ops_alert_config (alert_type, enabled, threshold, webhook_url, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(alert_type) DO UPDATE SET
          enabled = excluded.enabled,
          threshold = excluded.threshold,
          webhook_url = excluded.webhook_url,
          updated_at = excluded.updated_at
      `).run(
        row.alertType,
        row.enabled === false ? 0 : 1,
        row.threshold ?? null,
        row.webhookUrl ?? null,
      )
    }
  }
  writeOpsAudit(req.user!.id, 'update_settings', 'platform', 'settings')
  res.json({ settings: getAllPlatformSettings() })
})

opsRouter.get('/live/stream', ...guard, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let since = new Date(Date.now() - 60_000).toISOString()
  res.write(`data: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`)

  const interval = setInterval(() => {
    try {
      const events = pollLiveEvents(since)
      if (events.length) {
        since = events[0].at
        for (const event of events.reverse()) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } else {
        res.write(`: ping\n\n`)
      }
    } catch {
      /* ignore poll errors */
    }
  }, 2000)

  req.on('close', () => clearInterval(interval))
})

opsRouter.get('/export/jobs', ...guard, (req, res) => {
  const status = String(req.query.status ?? 'failed')
  const rows = db
    .prepare(`
      SELECT r.id, r.status, r.error_message, r.created_at, r.completed_at, r.retry_count,
        a.name as agency_name, p.name as page_name, s.username as source_username
      FROM reel_jobs r
      LEFT JOIN agencies a ON a.id = r.agency_id
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.status = ?
      ORDER BY r.created_at DESC LIMIT 500
    `)
    .all(status) as Record<string, unknown>[]

  const header = 'id,status,agency,page,source,error,created_at,completed_at,retry_count\n'
  const csv =
    header +
    rows
      .map((r) =>
        [
          r.id,
          r.status,
          r.agency_name,
          r.page_name,
          r.source_username,
          JSON.stringify(String(r.error_message ?? '')),
          r.created_at,
          r.completed_at,
          r.retry_count,
        ].join(','),
      )
      .join('\n')

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="jobs-${status}.csv"`)
  res.send(csv)
})
