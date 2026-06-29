import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { getOAuthUrl } from './facebook.js'
import { buildMagicConnectUrls } from '../utils/appUrls.js'

const MAGIC_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000

export type MagicLinkRow = {
  id: string
  agency_id: string
  user_id: string
  byoc_credential_id: string | null
  label: string | null
  expires_at: string
  created_at: string
}

function getAgencySubdomain(agencyId: string): string | null {
  const row = db.prepare('SELECT subdomain FROM agencies WHERE id = ?').get(agencyId) as
    | { subdomain: string | null }
    | undefined
  return row?.subdomain?.trim() || null
}

function purgeExpired() {
  const now = new Date().toISOString()
  db.prepare('DELETE FROM facebook_oauth_states WHERE expires_at < ?').run(now)
  db.prepare('DELETE FROM facebook_oauth_magic_links WHERE expires_at < ?').run(now)
}

function findActiveMagicLink(agencyId: string, byocCredentialId: string | null): MagicLinkRow | undefined {
  purgeExpired()
  if (byocCredentialId) {
    return db
      .prepare(`
        SELECT * FROM facebook_oauth_magic_links
        WHERE agency_id = ? AND byoc_credential_id = ? AND expires_at >= datetime('now')
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(agencyId, byocCredentialId) as MagicLinkRow | undefined
  }
  return db
    .prepare(`
      SELECT * FROM facebook_oauth_magic_links
      WHERE agency_id = ? AND byoc_credential_id IS NULL AND expires_at >= datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(agencyId) as MagicLinkRow | undefined
}

export type MagicLinkResponse = {
  id: string
  url: string
  appUrl: string
  agencyCallbackUrl: string | null
  appCallbackUrl: string
  agencySubdomain: string | null
  expiresAt: string
  byocCredentialId: string | null
}

function toMagicLinkResponse(
  id: string,
  expiresAt: string,
  byocCredentialId: string | null,
  agencySubdomain: string | null,
): MagicLinkResponse {
  const urls = buildMagicConnectUrls(id, agencySubdomain)
  return {
    id,
    expiresAt,
    byocCredentialId,
    ...urls,
  }
}

export function getOrCreateMagicLink(
  agencyId: string,
  userId: string,
  byocCredentialId: string | null,
  options?: { regenerate?: boolean; label?: string },
): MagicLinkResponse {
  purgeExpired()
  const agencySubdomain = getAgencySubdomain(agencyId)

  if (!options?.regenerate) {
    const existing = findActiveMagicLink(agencyId, byocCredentialId)
    if (existing) {
      return toMagicLinkResponse(existing.id, existing.expires_at, existing.byoc_credential_id, agencySubdomain)
    }
  } else if (byocCredentialId) {
    db.prepare('DELETE FROM facebook_oauth_magic_links WHERE agency_id = ? AND byoc_credential_id = ?').run(
      agencyId,
      byocCredentialId,
    )
  } else {
    db.prepare('DELETE FROM facebook_oauth_magic_links WHERE agency_id = ? AND byoc_credential_id IS NULL').run(agencyId)
  }

  const id = uuid()
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString()
  db.prepare(`
    INSERT INTO facebook_oauth_magic_links (id, agency_id, user_id, byoc_credential_id, label, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, agencyId, userId, byocCredentialId, options?.label ?? null, expiresAt)

  return toMagicLinkResponse(id, expiresAt, byocCredentialId, agencySubdomain)
}

export function getMagicLink(token: string): MagicLinkRow | undefined {
  purgeExpired()
  return db
    .prepare(`SELECT * FROM facebook_oauth_magic_links WHERE id = ? AND expires_at >= datetime('now')`)
    .get(token) as MagicLinkRow | undefined
}

export function saveOAuthState(input: {
  state: string
  userId: string
  agencyId: string
  byocCredentialId: string | null
  magicLinkId?: string | null
}) {
  purgeExpired()
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  db.prepare(`
    INSERT INTO facebook_oauth_states (state, user_id, agency_id, byoc_credential_id, magic_link_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.state,
    input.userId,
    input.agencyId,
    input.byocCredentialId,
    input.magicLinkId ?? null,
    expiresAt,
  )
}

export function consumeOAuthState(
  state: string,
  userId: string,
  agencyId: string,
): { byocCredentialId: string | null; magicLinkId: string | null } | null {
  purgeExpired()
  const row = db
    .prepare(`SELECT * FROM facebook_oauth_states WHERE state = ? AND expires_at >= datetime('now')`)
    .get(state) as
    | {
        user_id: string
        agency_id: string
        byoc_credential_id: string | null
        magic_link_id: string | null
      }
    | undefined

  if (!row || row.user_id !== userId || row.agency_id !== agencyId) return null

  db.prepare('DELETE FROM facebook_oauth_states WHERE state = ?').run(state)
  return { byocCredentialId: row.byoc_credential_id, magicLinkId: row.magic_link_id }
}

export function startMagicLinkOAuth(
  token: string,
  userId: string,
  agencyId: string,
): { url: string; state: string } {
  const link = getMagicLink(token)
  if (!link) throw new Error('Connect link expired or invalid. Generate a new one from Facebook BYOC settings.')
  if (link.agency_id !== agencyId) throw new Error('This connect link belongs to a different agency workspace.')

  const state = uuid()
  saveOAuthState({
    state,
    userId,
    agencyId,
    byocCredentialId: link.byoc_credential_id,
    magicLinkId: link.id,
  })

  return {
    state,
    url: getOAuthUrl(agencyId, state, link.byoc_credential_id),
  }
}
