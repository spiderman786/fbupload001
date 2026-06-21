import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

export function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformAdminEmail(email: string): boolean {
  const admins = getPlatformAdminEmails()
  if (!admins.length) return false
  return admins.includes(email.trim().toLowerCase())
}

export async function seedPlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_SEED_EMAIL?.trim().toLowerCase()
  const password = process.env.PLATFORM_ADMIN_SEED_PASSWORD
  if (!email || !password) return

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
