import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import {
  authMiddleware,
  COOKIE_OPTIONS,
  requireVerified,
  sanitizeUser,
  signToken,
  type AuthRequest,
} from '../middleware/auth.js'
import { generateVerificationCode, isGmail } from '../utils/helpers.js'
import { sendVerificationEmail, sendPasswordResetEmail, userFacingEmailError } from '../services/email.js'
import {
  buildSessionPayload,
  assertAgencySubdomainMember,
  clearAgencyCookie,
  createAgencyForUser,
  deleteUnverifiedSignup,
  getAgencySubdomainUrl,
  resolveAgency,
  setAgencyCookie,
  subdomainFromSignupName,
} from '../utils/agency.js'

export const authRouter = Router()

function getRequestSubdomainHost(req: { headers: Record<string, unknown> & { host?: string } }): string | null {
  const forwarded = req.headers['x-forwarded-host'] as string | string[] | undefined
  const hostHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const raw = (hostHeader ?? (req.headers.host as string | undefined) ?? '').split(',')[0]!.trim().toLowerCase()
  const host = raw.replace(/:\d+$/, '')
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host)) return null

  const baseDomain = process.env.APP_BASE_DOMAIN?.trim().toLowerCase()
  if (baseDomain) {
    if (host === baseDomain) return null
    const suffix = `.${baseDomain}`
    if (host.endsWith(suffix)) {
      const sub = host.slice(0, -suffix.length).trim()
      return sub && !['www', 'app'].includes(sub) ? sub : null
    }
    return null
  }

  const parts = host.split('.')
  if (parts.length < 3) return null
  const sub = parts[0]!
  return ['www', 'app'].includes(sub) ? null : sub
}

authRouter.get('/session', authMiddleware, (req: AuthRequest, res) => {
  const subdomain = getRequestSubdomainHost(req)
  const fromSubdomain = subdomain ? assertAgencySubdomainMember(req.user!.id, subdomain) : null
  if (fromSubdomain) {
    setAgencyCookie(res, fromSubdomain.id)
    res.json(buildSessionPayload(req.user!.id, fromSubdomain.id))
    return
  }
  const agencyId = req.cookies?.agency_id as string | undefined
  res.json(buildSessionPayload(req.user!.id, agencyId))
})

authRouter.post('/signup', async (req, res) => {
  const { fullName, email, password, phoneCountryCode, phoneNumber, agencyName } = req.body ?? {}

  if (!fullName || !email || !password || !phoneNumber) {
    res.status(400).json({ error: 'All fields are required' })
    return
  }
  if (!isGmail(email)) {
    res.status(400).json({ error: 'Only @gmail.com addresses are accepted' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }

  const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email.toLowerCase()) as
    | { id: string; email_verified: number }
    | undefined
  if (existing) {
    if (existing.email_verified) {
      res.status(409).json({ error: 'An account with this email already exists' })
      return
    }
    deleteUnverifiedSignup(existing.id)
  }

  const code = generateVerificationCode()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const id = uuid()
  const hash = await bcrypt.hash(password, 10)

  db.prepare(`
    INSERT INTO users (id, email, full_name, password_hash, phone_country_code, phone_number, verification_code, verification_expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), fullName, hash, phoneCountryCode ?? '+92', phoneNumber, code, expires)

  const whatsapp = `${phoneCountryCode ?? '+92'}${phoneNumber}`.replace(/\s+/g, '')
  const createdAgency = createAgencyForUser(
    id,
    (agencyName?.trim() || `${fullName}'s Agency`),
    0,
    subdomainFromSignupName(fullName, email),
    whatsapp,
  )

  try {
    await sendVerificationEmail(email, code)
  } catch (error) {
    deleteUnverifiedSignup(id)
    res.status(502).json({ error: userFacingEmailError(error) })
    return
  }

  res.status(201).json({
    message: 'Verification code sent to your Gmail',
    userId: id,
    agencySubdomain: createdAgency.subdomain,
    agencyUrl: getAgencySubdomainUrl(createdAgency.subdomain),
  })
})

authRouter.post('/verify', (req, res) => {
  const { email, code } = req.body ?? {}
  if (!email || !code) {
    res.status(400).json({ error: 'Email and code are required' })
    return
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | import('../db.js').UserRow
    | undefined

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (user.email_verified) {
    res.json({ message: 'Email already verified' })
    return
  }
  if (user.verification_code !== code) {
    res.status(400).json({ error: 'Invalid verification code' })
    return
  }
  if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
    res.status(400).json({ error: 'Verification code expired' })
    return
  }

  db.prepare(`
    UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL
    WHERE id = ?
  `).run(user.id)

  const agency = resolveAgency(user.id)
  if (agency) {
    db.prepare('UPDATE agencies SET token_balance = token_balance + 50 WHERE id = ?').run(agency.id)
    db.prepare(`
      INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
      VALUES (?, ?, ?, 50, 'signup_bonus', 'Welcome bonus tokens')
    `).run(uuid(), user.id, agency.id)
  }

  const token = signToken(user.id)
  res.cookie('token', token, COOKIE_OPTIONS)
  if (agency) setAgencyCookie(res, agency.id)
  res.json({ message: 'Email verified successfully', ...buildSessionPayload(user.id, agency?.id) })
})

authRouter.post('/send-verification', async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | import('../db.js').UserRow
    | undefined

  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (user.email_verified) {
    res.status(400).json({ error: 'Email already verified' })
    return
  }

  const code = generateVerificationCode()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?').run(
    code,
    expires,
    user.id,
  )
  try {
    await sendVerificationEmail(email, code)
    res.json({ message: 'Verification code resent' })
  } catch (error) {
    res.status(502).json({ error: userFacingEmailError(error) })
  }
})

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | import('../db.js').UserRow
    | undefined

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }
  if (!user.email_verified) {
    res.status(403).json({ error: 'Email not verified', needsVerification: true, email: user.email })
    return
  }

  const token = signToken(user.id)
  res.cookie('token', token, COOKIE_OPTIONS)
  const subdomain = getRequestSubdomainHost(req)
  const agency = (subdomain ? assertAgencySubdomainMember(user.id, subdomain) : null) ?? resolveAgency(user.id, req.cookies?.agency_id)
  if (agency) setAgencyCookie(res, agency.id)
  res.json(buildSessionPayload(user.id, agency?.id))
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' })
  clearAgencyCookie(res)
  res.json({ message: 'Logged out' })
})

authRouter.get('/me', authMiddleware, requireVerified, (req: AuthRequest, res) => {
  res.json({ user: sanitizeUser(req.user!) })
})

authRouter.patch('/me', authMiddleware, requireVerified, async (req: AuthRequest, res) => {
  const { fullName, phoneCountryCode, phoneNumber, currentPassword, newPassword } = req.body ?? {}
  const user = req.user!

  if (newPassword) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      res.status(400).json({ error: 'Current password is incorrect' })
      return
    }
    const hash = await bcrypt.hash(newPassword, 10)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  }

  if (fullName || phoneCountryCode || phoneNumber) {
    db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        phone_country_code = COALESCE(?, phone_country_code),
        phone_number = COALESCE(?, phone_number)
      WHERE id = ?
    `).run(fullName ?? null, phoneCountryCode ?? null, phoneNumber ?? null, user.id)
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as import('../db.js').UserRow
  res.json({ user: sanitizeUser(updated) })
})

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }

  const normalized = email.trim().toLowerCase()
  const user = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(normalized) as
    | { id: string; email_verified: number }
    | undefined

  if (user) {
    const code = generateVerificationCode()
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    db.prepare(`
      UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?
    `).run(code, expires, user.id)

    try {
      await sendPasswordResetEmail(normalized, code)
    } catch (err) {
      console.error('[auth] password reset email failed:', err)
      res.status(503).json({ error: userFacingEmailError(err) })
      return
    }
  }

  // Always return success to prevent email enumeration
  res.json({ message: 'If an account exists, a reset code has been sent to your email.' })
})

authRouter.post('/reset-password', async (req, res) => {
  const { email, code, password } = req.body ?? {}
  if (!email || !code || !password) {
    res.status(400).json({ error: 'Email, code, and new password are required' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
    | import('../db.js').UserRow
    | undefined

  if (!user || user.password_reset_token !== String(code).trim()) {
    res.status(400).json({ error: 'Invalid or expired reset code' })
    return
  }
  if (user.password_reset_expires && new Date(user.password_reset_expires) < new Date()) {
    res.status(400).json({ error: 'Reset code has expired. Request a new one.' })
    return
  }

  const hash = await bcrypt.hash(password, 10)
  db.prepare(`
    UPDATE users
    SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL
    WHERE id = ?
  `).run(hash, user.id)

  res.json({ message: 'Password updated. You can sign in now.' })
})
