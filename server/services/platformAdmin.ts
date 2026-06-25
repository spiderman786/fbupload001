import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

const PLACEHOLDER_ADMIN_EMAILS = new Set(['admin@fbuploadplus.com', 'admin@example.com'])

export function getPlatformAdminEmailsFromEnv(): string[] {
  const emails = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .filter((e) => !PLACEHOLDER_ADMIN_EMAILS.has(e))

  const seed = process.env.PLATFORM_ADMIN_SEED_EMAIL?.trim().toLowerCase()
  if (seed && !PLACEHOLDER_ADMIN_EMAILS.has(seed) && !emails.includes(seed)) {
    emails.push(seed)
  }

  return emails
}

export function isPlatformAdminStrictMode(): boolean {
  return getPlatformAdminEmailsFromEnv().length > 0
}

function hasAgencyOwnerRole(userId: string): boolean {
  const member = db
    .prepare(`
      SELECT 1 FROM agency_members
      WHERE user_id = ? AND role = 'owner'
      LIMIT 1
    `)
    .get(userId)
  return Boolean(member)
}

/** Platform Ops: allowlisted emails, otherwise agency owners only (never admins/staff). */
export function isPlatformAdmin(userId: string, email: string): boolean {
  const normalized = email.trim().toLowerCase()
  const allowlist = getPlatformAdminEmailsFromEnv()

  if (allowlist.length > 0) {
    return allowlist.includes(normalized)
  }

  return hasAgencyOwnerRole(userId)
}

/** @deprecated use isPlatformAdmin(userId, email) */
export function isPlatformAdminEmail(email: string): boolean {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
    | { id: string }
    | undefined
  if (!user) return false
  return isPlatformAdmin(user.id, email)
}

export async function seedPlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_SEED_EMAIL?.trim().toLowerCase()
  const password = process.env.PLATFORM_ADMIN_SEED_PASSWORD
  if (!email || !password || PLACEHOLDER_ADMIN_EMAILS.has(email)) return

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined
  if (existing) {
    const hash = await bcrypt.hash(password, 10)
    db.prepare(`
      UPDATE users SET password_hash = ?, email_verified = 1, full_name = COALESCE(NULLIF(full_name, ''), 'Platform Admin')
      WHERE id = ?
    `).run(hash, existing.id)
    console.log(`[ops] Platform admin password synced for ${email}`)
    return
  }

  const id = uuid()
  const hash = await bcrypt.hash(password, 10)
  db.prepare(`
    INSERT INTO users (id, email, full_name, password_hash, phone_country_code, phone_number, email_verified)
    VALUES (?, ?, 'Platform Admin', ?, '+92', '0000000000', 1)
  `).run(id, email, hash)

  const agencyId = uuid()
  db.prepare('INSERT INTO agencies (id, name, token_balance) VALUES (?, ?, 0)').run(agencyId, 'Platform Ops')
  db.prepare('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)').run(
    uuid(),
    agencyId,
    id,
    'owner',
  )

  console.log(`[ops] Created platform admin ${email}`)
}

export function logPlatformAdminMode(): void {
  const allowlist = getPlatformAdminEmailsFromEnv()
  if (allowlist.length > 0) {
    console.log(`[ops] Allowlist mode (${allowlist.length} email${allowlist.length === 1 ? '' : 's'})`)
    return
  }
  console.log('[ops] Owner-only mode — set PLATFORM_ADMIN_EMAILS on Railway to lock /ops to your Gmail')
}
