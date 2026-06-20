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
import { sendVerificationEmail } from '../services/email.js'
import {
  buildSessionPayload,
  clearAgencyCookie,
  createAgencyForUser,
  resolveAgency,
  setAgencyCookie,
} from '../utils/agency.js'

export const authRouter = Router()

authRouter.get('/session', authMiddleware, (req: AuthRequest, res) => {
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

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' })
    return
  }

  const code = generateVerificationCode()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const id = uuid()
  const hash = await bcrypt.hash(password, 10)

  db.prepare(`
    INSERT INTO users (id, email, full_name, password_hash, phone_country_code, phone_number, verification_code, verification_expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), fullName, hash, phoneCountryCode ?? '+92', phoneNumber, code, expires)

  createAgencyForUser(id, (agencyName?.trim() || `${fullName}'s Agency`))

  try {
    await sendVerificationEmail(email, code)
  } catch (error) {
    // Avoid trapping users in an unverified account when delivery fails.
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : 'Failed to send verification code. Please check SMTP configuration.'
    res.status(502).json({ error: message })
    return
  }

  res.status(201).json({ message: 'Verification code sent to your Gmail', userId: id })
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
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : 'Failed to resend verification code. Please check SMTP configuration.'
    res.status(502).json({ error: message })
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
  const agency = resolveAgency(user.id, req.cookies?.agency_id)
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

authRouter.post('/forgot-password', (req, res) => {
  const { email } = req.body ?? {}
  if (!email) {
    res.status(400).json({ error: 'Email is required' })
    return
  }
  // Always return success to prevent email enumeration
  res.json({ message: 'If an account exists, a reset link has been sent' })
})
