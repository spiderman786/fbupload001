import { db } from '../db.js'

export type ByocCredentials = {
  appId: string
  appSecret: string
  redirectUri: string
  source: 'byoc' | 'env'
}

export function getByocCredentials(agencyId: string, platform: string): ByocCredentials | null {
  const row = db
    .prepare('SELECT app_id, app_secret, redirect_uri FROM byoc_credentials WHERE agency_id = ? AND platform = ?')
    .get(agencyId, platform) as { app_id: string; app_secret: string; redirect_uri: string } | undefined

  if (row?.app_id && row?.app_secret) {
    return {
      appId: row.app_id,
      appSecret: row.app_secret,
      redirectUri: row.redirect_uri || process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:5173/facebook/callback',
      source: 'byoc',
    }
  }

  if (platform === 'facebook' && process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    return {
      appId: process.env.FACEBOOK_APP_ID,
      appSecret: process.env.FACEBOOK_APP_SECRET,
      redirectUri: process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:5173/facebook/callback',
      source: 'env',
    }
  }

  return null
}

export function isFacebookConfiguredForAgency(agencyId: string): boolean {
  return getByocCredentials(agencyId, 'facebook') !== null
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

export function saveByocCredentials(
  agencyId: string,
  platform: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
) {
  const ownerUserId = getAgencyOwnerUserId(agencyId)
  const existing = db
    .prepare('SELECT user_id FROM byoc_credentials WHERE agency_id = ? AND platform = ?')
    .get(agencyId, platform) as { user_id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE byoc_credentials SET app_id = ?, app_secret = ?, redirect_uri = ?, updated_at = datetime('now')
      WHERE agency_id = ? AND platform = ?
    `).run(appId, appSecret, redirectUri, agencyId, platform)
    return
  }

  db.prepare(`
    INSERT INTO byoc_credentials (user_id, agency_id, platform, app_id, app_secret, redirect_uri, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(ownerUserId, agencyId, platform, appId, appSecret, redirectUri)
}

export function getByocPublic(agencyId: string, platform: string) {
  const row = db
    .prepare('SELECT app_id, redirect_uri, updated_at FROM byoc_credentials WHERE agency_id = ? AND platform = ?')
    .get(agencyId, platform) as { app_id: string; redirect_uri: string; updated_at: string } | undefined

  const env = platform === 'facebook' && process.env.FACEBOOK_APP_ID

  return {
    configured: Boolean(row?.app_id || env),
    hasByoc: Boolean(row?.app_id),
    appId: row?.app_id ?? (env ? process.env.FACEBOOK_APP_ID : null),
    redirectUri: row?.redirect_uri ?? process.env.FACEBOOK_REDIRECT_URI ?? null,
    updatedAt: row?.updated_at ?? null,
    usingEnvFallback: !row?.app_id && Boolean(env),
  }
}

export function deleteByocCredentials(agencyId: string, platform: string) {
  db.prepare('DELETE FROM byoc_credentials WHERE agency_id = ? AND platform = ?').run(agencyId, platform)
}
