import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { tokensForPlatform } from '../utils/helpers.js'
import type { AgencyRequest } from '../utils/agency.js'

export const sourcesRouter = Router()
sourcesRouter.use(authMiddleware, requireVerified, agencyMiddleware)

const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook']

function mapSource(row: Record<string, unknown>) {
  return {
    id: row.id,
    platform: row.platform,
    username: row.username,
    tokensPerReel: row.tokens_per_reel,
    isActive: Boolean(row.is_active),
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

  const normalized = username.startsWith('@') ? username : `@${username.replace(/^@/, '')}`
  const id = uuid()

  db.prepare(`
    INSERT INTO source_accounts (id, user_id, agency_id, platform, username, tokens_per_reel)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, req.agency!.id, platform, normalized, tokensForPlatform(platform))

  const source = db.prepare('SELECT * FROM source_accounts WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ source: mapSource(source) })
})

sourcesRouter.patch('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { isActive } = req.body ?? {}
  const existing = db
    .prepare('SELECT * FROM source_accounts WHERE id = ? AND agency_id = ?')
    .get(req.params.id, req.agency!.id)

  if (!existing) {
    res.status(404).json({ error: 'Source not found' })
    return
  }

  if (typeof isActive === 'boolean') {
    db.prepare('UPDATE source_accounts SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, req.params.id)
  }

  const updated = db.prepare('SELECT * FROM source_accounts WHERE id = ?').get(req.params.id) as Record<string, unknown>
  res.json({ source: mapSource(updated) })
})

sourcesRouter.delete('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const result = db
    .prepare('DELETE FROM source_accounts WHERE id = ? AND agency_id = ?')
    .run(req.params.id, req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Source not found' })
    return
  }
  res.json({ message: 'Source removed' })
})
