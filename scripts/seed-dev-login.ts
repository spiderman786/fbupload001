import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { initDb, db } from '../server/db.ts'

const EMAIL = process.env.PLATFORM_ADMIN_SEED_EMAIL?.trim().toLowerCase() ?? 'dev@gmail.com'
const PASSWORD = process.env.PLATFORM_ADMIN_SEED_PASSWORD ?? 'dev123456'

async function main() {
  initDb()
  const hash = await bcrypt.hash(PASSWORD, 10)
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE users SET password_hash = ?, email_verified = 1, full_name = COALESCE(NULLIF(full_name, ''), 'Dev Owner')
      WHERE id = ?
    `).run(hash, existing.id)
    console.log(`Updated dev login: ${EMAIL}`)
  } else {
    const id = uuid()
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, phone_country_code, phone_number, email_verified)
      VALUES (?, ?, 'Dev Owner', ?, '+1', '0000000000', 1)
    `).run(id, EMAIL, hash)

    const agencyId = uuid()
    db.prepare('INSERT INTO agencies (id, name, token_balance) VALUES (?, ?, 100)').run(agencyId, 'Dev Agency')
    db.prepare('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)').run(
      uuid(),
      agencyId,
      id,
      'owner',
    )
    console.log(`Created dev login: ${EMAIL}`)
  }

  console.log(`Password: ${PASSWORD}`)
  console.log('Sign in at http://localhost:5173/login')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
