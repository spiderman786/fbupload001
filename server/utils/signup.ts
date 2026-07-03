import { db } from '../db.js'
import { getPlatformAdminEmailsFromEnv } from '../services/platformAdmin.js'

/** Public self-signup on by default; set PUBLIC_SIGNUP_ENABLED=false to close. */
export function isPublicSignupEnabled(): boolean {
  const flag = process.env.PUBLIC_SIGNUP_ENABLED?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'no') return false
  return true
}

export type PublicSignupAgency = {
  id: string
  name: string
  subdomain: string | null
}

/** Agency new public signups join as admin. Env override, else platform admin owner's primary agency. */
export function resolvePublicSignupAgency(): PublicSignupAgency | null {
  const byId = process.env.PUBLIC_SIGNUP_AGENCY_ID?.trim()
  if (byId) {
    const row = db
      .prepare('SELECT id, name, subdomain FROM agencies WHERE id = ?')
      .get(byId) as PublicSignupAgency | undefined
    if (row) return row
  }

  const bySub = process.env.PUBLIC_SIGNUP_AGENCY_SUBDOMAIN?.trim()
  if (bySub) {
    const row = db
      .prepare('SELECT id, name, subdomain FROM agencies WHERE lower(subdomain) = lower(?)')
      .get(bySub) as PublicSignupAgency | undefined
    if (row) return row
  }

  const ownerEmail = trimEnv(process.env.PUBLIC_SIGNUP_OWNER_EMAIL)?.toLowerCase()
  if (ownerEmail) {
    const row = db
      .prepare(`
        SELECT a.id, a.name, a.subdomain
        FROM agencies a
        JOIN agency_members m ON m.agency_id = a.id AND m.role = 'owner'
        JOIN users u ON u.id = m.user_id
        WHERE lower(u.email) = ?
        ORDER BY a.created_at ASC
        LIMIT 1
      `)
      .get(ownerEmail) as PublicSignupAgency | undefined
    if (row) return row
  }

  const adminEmails = getPlatformAdminEmailsFromEnv()
  if (adminEmails.length) {
    const placeholders = adminEmails.map(() => '?').join(', ')
    const row = db
      .prepare(`
        SELECT a.id, a.name, a.subdomain
        FROM agencies a
        JOIN agency_members m ON m.agency_id = a.id AND m.role = 'owner'
        JOIN users u ON u.id = m.user_id
        WHERE lower(u.email) IN (${placeholders})
        ORDER BY a.created_at ASC
        LIMIT 1
      `)
      .get(...adminEmails) as PublicSignupAgency | undefined
    if (row) return row
  }

  return resolvePublicSignupAgencyFallback()
}

function trimEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const v = value.trim().replace(/^["']|["']$/g, '')
  return v || undefined
}

/** Last-resort when env/platform admin lookup is missing on Railway. */
function resolvePublicSignupAgencyFallback(): PublicSignupAgency | null {
  const branded = db
    .prepare(`
      SELECT id, name, subdomain FROM agencies
      WHERE lower(name) LIKE '%fbupload%'
      ORDER BY created_at ASC
      LIMIT 1
    `)
    .get() as PublicSignupAgency | undefined
  if (branded) return branded

  const { count } = db.prepare('SELECT COUNT(*) as count FROM agencies').get() as { count: number }
  if (count === 1) {
    const sole = db
      .prepare('SELECT id, name, subdomain FROM agencies ORDER BY created_at ASC LIMIT 1')
      .get() as PublicSignupAgency | undefined
    if (sole) return sole
  }

  const primary = db
    .prepare(`
      SELECT a.id, a.name, a.subdomain
      FROM agencies a
      JOIN agency_members m ON m.agency_id = a.id AND m.role = 'owner'
      WHERE a.subdomain IS NOT NULL AND trim(a.subdomain) != ''
      ORDER BY a.created_at ASC
      LIMIT 1
    `)
    .get() as PublicSignupAgency | undefined
  if (primary) return primary

  const oldest = db
    .prepare(`
      SELECT a.id, a.name, a.subdomain
      FROM agencies a
      JOIN agency_members m ON m.agency_id = a.id AND m.role = 'owner'
      ORDER BY a.created_at ASC
      LIMIT 1
    `)
    .get() as PublicSignupAgency | undefined
  if (oldest) return oldest

  return null
}

export function isPublicSignupAgencyReady(): boolean {
  return resolvePublicSignupAgency() !== null
}
