import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { isSourceActiveFlag } from '../utils/sourceActive.js'
import { findOrCreateSource, relinkAssignmentsToSource } from '../services/sourceAccounts.js'
import { normalizeSourceUsername } from '../utils/sourceIdentity.js'
import { revivePagesForSource } from '../services/scrapeStatus.js'
import type { AgencyRequest } from '../utils/agency.js'

import { routeParam } from '../utils/routeParam.js'
export const sourcesRouter = Router()
sourcesRouter.use(authMiddleware, requireVerified, agencyMiddleware)

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook']

function mapSource(row: Record<string, unknown>) {
  const failures = Number(row.consecutive_failures ?? 0)
  const active = isSourceActiveFlag(row.is_active)
  return {
    id: row.id,
    platform: row.platform,
    username: row.username,
    tokensPerReel: row.tokens_per_reel,
    isActive: active,
    autoDisabled: !active && failures >= Number(process.env.OPS_SELF_HEAL_SOURCE_FAIL_MAX ?? 8),
    createdAt: row.created_at,
  }
}

sourcesRouter.get('/', (req: AgencyRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM source_accounts WHERE agency_id = ? ORDER BY created_at DESC')
    .all(req.agency!.id) as Record<string, unknown>[]
  res.json({ sources: rows.map(mapSource) })
})

sourcesRouter.post('/', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { platform, username } = req.body ?? {}

  if (!platform || !username) {
    res.status(400).json({ error: 'Platform and username are required' })
    return
  }
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: 'Invalid platform' })
    return
  }

  const normalized = normalizeSourceUsername(username)
  const source = findOrCreateSource(req.agency!.id, req.user!.id, platform, normalized)
  res.status(201).json({ source: mapSource(source) })
})

sourcesRouter.patch('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { isActive } = req.body ?? {}
  const existing = db
    .prepare('SELECT * FROM source_accounts WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)

  if (!existing) {
    res.status(404).json({ error: 'Source not found' })
    return
  }

  if (typeof isActive === 'boolean') {
    if (isActive) {
      db.prepare(`
        UPDATE source_accounts SET is_active = 1, consecutive_failures = 0 WHERE id = ?
      `).run(routeParam(req.params.id))
      const relinked = relinkAssignmentsToSource(routeParam(req.params.id), req.agency!.id)
      const revived = revivePagesForSource(routeParam(req.params.id), req.agency!.id)
      if (relinked > 0 || revived > 0) {
        console.log(`[sources] Re-enabled ${routeParam(req.params.id)}: relinked=${relinked}, revived=${revived}`)
      }
    } else {
      db.prepare('UPDATE source_accounts SET is_active = 0 WHERE id = ?').run(routeParam(req.params.id))
    }
  }

  const updated = db.prepare('SELECT * FROM source_accounts WHERE id = ?').get(routeParam(req.params.id)) as Record<string, unknown>
  res.json({ source: mapSource(updated) })
})

sourcesRouter.delete('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const result = db
    .prepare('DELETE FROM source_accounts WHERE id = ? AND agency_id = ?')
    .run(routeParam(req.params.id), req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Source not found' })
    return
  }
  res.json({ message: 'Source removed' })
})
