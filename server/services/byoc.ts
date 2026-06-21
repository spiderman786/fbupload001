import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

export type ByocCredentials = {
  id?: string
  label?: string
  appId: string
  appSecret: string
  redirectUri: string
  source: 'byoc' | 'env'
}

type ByocRow = {
  id: string
  user_id: string
  agency_id: string
  platform: string
  label: string
  app_id: string
  app_secret: string
  redirect_uri: string
  updated_at: string
}

function envFacebookCredentials(): ByocCredentials | null {
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) return null
  return {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:5173/facebook/callback',
    source: 'env',
  }
}

function mapRow(row: ByocRow): ByocCredentials {
  return {
    id: row.id,
    label: row.label,
    appId: row.app_id,
    appSecret: row.app_secret,
    redirectUri: row.redirect_uri || process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:5173/facebook/callback',
    source: 'byoc',
  }
}

export function getByocCredentialById(agencyId: string, credentialId: string): ByocCredentials | null {
  const row = db
    .prepare('SELECT * FROM byoc_credentials WHERE id = ? AND agency_id = ?')
    .get(credentialId, agencyId) as ByocRow | undefined
  return row ? mapRow(row) : null
}

export function getByocCredentials(
  agencyId: string,
  platform: string,
  byocCredentialId?: string | null,
): ByocCredentials | null {
  if (byocCredentialId) {
    const row = db
      .prepare('SELECT * FROM byoc_credentials WHERE id = ? AND agency_id = ? AND platform = ?')
      .get(byocCredentialId, agencyId, platform) as ByocRow | undefined
    if (row) return mapRow(row)
  }

  const first = db
    .prepare('SELECT * FROM byoc_credentials WHERE agency_id = ? AND platform = ? ORDER BY updated_at ASC LIMIT 1')
    .get(agencyId, platform) as ByocRow | undefined

  if (first) return mapRow(first)

  if (platform === 'facebook') return envFacebookCredentials()
  return null
}

export function isFacebookConfiguredForAgency(agencyId: string): boolean {
  const count = db
    .prepare("SELECT COUNT(*) as count FROM byoc_credentials WHERE agency_id = ? AND platform = 'facebook'")
    .get(agencyId) as { count: number }
  return count.count > 0 || envFacebookCredentials() !== null
}

/** @deprecated use isFacebookConfiguredForAgency */
export function isFacebookConfiguredForUser(agencyId: string): boolean {
  return isFacebookConfiguredForAgency(agencyId)
}

function getAgencyOwnerUserId(agencyId: string): string {
  const row = db
    .prepare("SELECT user_id FROM agency_members WHERE agency_id = ? AND role = 'owner' LIMIT 1")
    .get(agencyId) as { user_id: string } | undefined
  if (!row) throw new Error('Agency owner not found')
  return row.user_id
}

function countLinkedAccounts(credentialId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as count FROM facebook_accounts WHERE byoc_credential_id = ?')
    .get(credentialId) as { count: number }
  return row.count
}

export function listByocApps(agencyId: string, platform: string) {
  const rows = db
    .prepare('SELECT * FROM byoc_credentials WHERE agency_id = ? AND platform = ? ORDER BY updated_at ASC')
    .all(agencyId, platform) as ByocRow[]

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    appId: row.app_id,
    redirectUri: row.redirect_uri,
    updatedAt: row.updated_at,
    linkedAccounts: countLinkedAccounts(row.id),
  }))
}

export function createByocApp(
  agencyId: string,
  platform: string,
  label: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
) {
  const ownerUserId = getAgencyOwnerUserId(agencyId)
  const id = uuid()
  const trimmedLabel = label.trim() || `App ${listByocApps(agencyId, platform).length + 1}`

  const duplicate = db
    .prepare('SELECT id FROM byoc_credentials WHERE agency_id = ? AND platform = ? AND app_id = ?')
    .get(agencyId, platform, appId) as { id: string } | undefined
  if (duplicate) throw new Error('This App ID is already registered for your agency')

  db.prepare(`
    INSERT INTO byoc_credentials (id, user_id, agency_id, platform, label, app_id, app_secret, redirect_uri, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, ownerUserId, agencyId, platform, trimmedLabel, appId, appSecret, redirectUri)

  return id
}

export function updateByocApp(
  agencyId: string,
  credentialId: string,
  updates: { label?: string; appId?: string; appSecret?: string; redirectUri?: string },
) {
  const existing = db
    .prepare('SELECT * FROM byoc_credentials WHERE id = ? AND agency_id = ?')
    .get(credentialId, agencyId) as ByocRow | undefined
  if (!existing) throw new Error('App credentials not found')

  const appId = updates.appId?.trim() || existing.app_id
  const appSecret = updates.appSecret || existing.app_secret
  const label = updates.label?.trim() || existing.label
  const redirectUri = updates.redirectUri ?? existing.redirect_uri

  if (appId !== existing.app_id) {
    const duplicate = db
      .prepare('SELECT id FROM byoc_credentials WHERE agency_id = ? AND platform = ? AND app_id = ? AND id != ?')
      .get(agencyId, existing.platform, appId, credentialId) as { id: string } | undefined
    if (duplicate) throw new Error('This App ID is already registered for your agency')
  }

  db.prepare(`
    UPDATE byoc_credentials
    SET label = ?, app_id = ?, app_secret = ?, redirect_uri = ?, updated_at = datetime('now')
    WHERE id = ? AND agency_id = ?
  `).run(label, appId, appSecret, redirectUri, credentialId, agencyId)
}

export function deleteByocApp(agencyId: string, credentialId: string) {
  const linked = countLinkedAccounts(credentialId)
  if (linked > 0) {
    throw new Error(`Cannot delete — ${linked} Facebook account(s) still linked to this app. Disconnect them first.`)
  }
  const result = db.prepare('DELETE FROM byoc_credentials WHERE id = ? AND agency_id = ?').run(credentialId, agencyId)
  if (result.changes === 0) throw new Error('App credentials not found')
}

/** @deprecated — use createByocApp */
export function saveByocCredentials(
  agencyId: string,
  platform: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
) {
  const existing = db
    .prepare('SELECT id FROM byoc_credentials WHERE agency_id = ? AND platform = ? ORDER BY updated_at ASC LIMIT 1')
    .get(agencyId, platform) as { id: string } | undefined

  if (existing) {
    updateByocApp(agencyId, existing.id, { appId, appSecret, redirectUri })
    return existing.id
  }

  return createByocApp(agencyId, platform, 'Default App', appId, appSecret, redirectUri)
}

export function getByocPublic(agencyId: string, platform: string) {
  const apps = listByocApps(agencyId, platform)
  const env = platform === 'facebook' ? envFacebookCredentials() : null
  const first = apps[0]

  return {
    configured: apps.length > 0 || Boolean(env),
    hasByoc: apps.length > 0,
    appCount: apps.length,
    apps,
    appId: first?.appId ?? env?.appId ?? null,
    redirectUri: first?.redirectUri ?? env?.redirectUri ?? null,
    updatedAt: first?.updatedAt ?? null,
    usingEnvFallback: apps.length === 0 && Boolean(env),
  }
}

/** @deprecated — use deleteByocApp */
export function deleteByocCredentials(agencyId: string, platform: string) {
  const apps = listByocApps(agencyId, platform)
  for (const app of apps) {
    if (app.linkedAccounts === 0) deleteByocApp(agencyId, app.id)
  }
}
