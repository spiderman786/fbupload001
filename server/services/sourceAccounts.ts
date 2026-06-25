import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { tokensForPlatform } from '../utils/helpers.js'
import { normalizeSourceHandle, normalizeSourceUsername } from '../utils/sourceIdentity.js'
import { isSourceActiveFlag } from '../utils/sourceActive.js'

export function findSourceByHandle(agencyId: string, platform: string, username: string) {
  const handle = normalizeSourceHandle(username)
  return db
    .prepare(`
      SELECT * FROM source_accounts
      WHERE agency_id = ? AND platform = ?
        AND LOWER(REPLACE(username, '@', '')) = ?
      ORDER BY is_active DESC, created_at DESC
      LIMIT 1
    `)
    .get(agencyId, platform.toLowerCase(), handle) as Record<string, unknown> | undefined
}

export function findOrCreateSource(
  agencyId: string,
  userId: string,
  platform: string,
  username: string,
): Record<string, unknown> {
  const existing = findSourceByHandle(agencyId, platform, username)
  if (existing) return existing

  const normalized = normalizeSourceUsername(username)
  const id = uuid()
  db.prepare(`
    INSERT INTO source_accounts (id, user_id, agency_id, platform, username, tokens_per_reel)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, agencyId, platform.toLowerCase(), normalized, tokensForPlatform(platform))

  return db.prepare('SELECT * FROM source_accounts WHERE id = ?').get(id) as Record<string, unknown>
}

/** Point page assignments at the enabled row when duplicate @handles exist. */
export function relinkAssignmentsToSource(sourceId: string, agencyId: string): number {
  const source = db
    .prepare('SELECT platform, username FROM source_accounts WHERE id = ? AND agency_id = ?')
    .get(sourceId, agencyId) as { platform: string; username: string } | undefined
  if (!source) return 0

  const handle = normalizeSourceHandle(source.username)
  const pages = db
    .prepare(`
      SELECT a.page_id, a.source_account_id
      FROM page_source_assignments a
      JOIN source_accounts s ON s.id = a.source_account_id
      WHERE s.agency_id = ? AND s.platform = ?
        AND LOWER(REPLACE(s.username, '@', '')) = ?
    `)
    .all(agencyId, source.platform, handle) as { page_id: string; source_account_id: string }[]

  let relinked = 0
  for (const row of pages) {
    if (row.source_account_id === sourceId) continue
    db.prepare('UPDATE page_source_assignments SET source_account_id = ? WHERE page_id = ?').run(sourceId, row.page_id)
    relinked++
  }
  return relinked
}

/** Prefer the active duplicate when a page still points at a disabled twin. */
export function healSourceAssignment(pageId: string, agencyId: string): string | null {
  const row = db
    .prepare(`
      SELECT a.source_account_id, s.platform, s.username, s.is_active, s.agency_id
      FROM page_source_assignments a
      JOIN source_accounts s ON s.id = a.source_account_id
      WHERE a.page_id = ?
    `)
    .get(pageId) as
    | {
        source_account_id: string
        platform: string
        username: string
        is_active: number
        agency_id: string
      }
    | undefined

  if (!row) return null
  const pageAgencyId = row.agency_id || agencyId

  if (isSourceActiveFlag(row.is_active)) return row.source_account_id

  const active = findSourceByHandle(pageAgencyId, row.platform, row.username)
  if (active && isSourceActiveFlag(active.is_active) && active.id !== row.source_account_id) {
    db.prepare('UPDATE page_source_assignments SET source_account_id = ? WHERE page_id = ?').run(
      active.id,
      pageId,
    )
    return active.id as string
  }

  return row.source_account_id
}
