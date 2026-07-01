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

  const adminEmails = getPlatformAdminEmailsFromEnv()
  if (!adminEmails.length) return null

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

  return row ?? null
}
