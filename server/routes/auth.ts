import { Router, type Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'
import { db, type UserRow } from '../db.js'
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
import { buildGoogleConsentUrl, fetchGoogleProfile, isGoogleOAuthConfigured, type GoogleProfile } from '../services/googleOAuth.js'
import {
  buildSessionPayload,
  assertAgencySubdomainMember,
  clearAgencyCookie,
  createClientAgencyForSignup,
  createAgencyForUser,
  safeDeleteUnverifiedSignup,
  getAgencySubdomainUrl,
  resolveAgency,
  setAgencyCookie,
  subdomainFromSignupName,
} from '../utils/agency.js'
import { isPublicSignupEnabled, resolvePublicSignupAgency, resolvePublicSignupOwner } from '../utils/signup.js'
import { cookieDomain, publicAppBaseUrl } from '../utils/appUrls.js'
import { rateLimitByIp, rateLimitByIpAndBodyField } from '../utils/rateLimit.js'
import {
  assertVerificationAttemptsAllowed,
  clearVerificationAttempts,
  recordVerificationFailure,
  VerificationLockedError,
} from '../utils/verifyAttempts.js'

export const authRouter = Router()

const loginLimiter = rateLimitByIp(15 * 60 * 1000, 15)
const signupLimiter = rateLimitByIp(60 * 60 * 1000, 8)
const verifyLimiter = rateLimitByIpAndBodyField('email', 15 * 60 * 1000, 20)
const resendLimiter = rateLimitByIpAndBodyField('email', 60 * 60 * 1000, 5)
const forgotLimiter = rateLimitByIpAndBodyField('email', 60 * 60 * 1000, 8)
const resetLimiter = rateLimitByIpAndBodyField('email', 15 * 60 * 1000, 15)
const googleOAuthLimiter = rateLimitByIp(15 * 60 * 1000, 30)

authRouter.get('/signup-status', (_req, res) => {
  const agency = resolvePublicSignupAgency()
  const owner = resolvePublicSignupOwner()
  res.json({
    enabled: isPublicSignupEnabled(),
    agencyReady: Boolean(owner),
    agencyName: agency?.name ?? null,
  })
})

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

function redirectWithAuthError(res: Response, message: string) {
  const url = new URL('/login', publicAppBaseUrl())
  url.searchParams.set('error', message)
  res.redirect(url.toString())
}

function createGoogleState(mode: string): string {
  const state = crypto.randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  db.prepare("DELETE FROM google_oauth_states WHERE datetime(expires_at) < datetime('now')").run()
  db.prepare('INSERT INTO google_oauth_states (state, mode, expires_at) VALUES (?, ?, ?)').run(state, mode, expires)
  return state
}

function consumeGoogleState(state: string): { mode: string } | null {
  const row = db.prepare('SELECT mode, expires_at FROM google_oauth_states WHERE state = ?').get(state) as
    | { mode: string; expires_at: string }
    | undefined
  db.prepare('DELETE FROM google_oauth_states WHERE state = ?').run(state)
  if (!row || new Date(row.expires_at) < new Date()) return null
  return { mode: row.mode }
}

function googleDisplayName(profile: GoogleProfile): string {
  return profile.name?.trim() || profile.email.split('@')[0] || 'Google User'
}

async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<string> {
  const email = profile.email.trim().toLowerCase()
  if (!profile.email_verified) throw new Error('Google email is not verified')
  if (!isGmail(email)) throw new Error('Only @gmail.com addresses are accepted')

  const existing = db
    .prepare(
      `
        SELECT * FROM users
        WHERE google_id = ? OR email = ?
        ORDER BY CASE WHEN google_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(profile.sub, email, profile.sub) as UserRow | undefined

  if (existing) {
    db.prepare(`
      UPDATE users
      SET google_id = COALESCE(google_id, ?),
          auth_provider = CASE WHEN auth_provider = 'password' THEN 'google' ELSE auth_provider END,
          email_verified = 1,
          verification_code = NULL,
          verification_expires = NULL
      WHERE id = ?
    `).run(profile.sub, existing.id)
    return existing.id
  }

  if (!isPublicSignupEnabled()) {
    throw new Error('Public signup is closed')
  }

  const id = uuid()
  const fullName = googleDisplayName(profile)
  const hash = await bcrypt.hash(uuid(), 10)

  db.prepare(`
    INSERT INTO users (
      id, email, full_name, password_hash, phone_country_code, phone_number,
      email_verified, google_id, auth_provider
    )
    VALUES (?, ?, ?, ?, '+92', '', 1, ?, 'google')
  `).run(id, email, fullName, hash, profile.sub)

  const signupOwner = resolvePublicSignupOwner()
  if (signupOwner) {
    createClientAgencyForSignup({
      userId: id,
      name: `${fullName}'s Agency`,
      preferredSubdomain: subdomainFromSignupName(fullName, email),
      ownerUserId: signupOwner.userId,
      parentAgencyId: signupOwner.agency.id,
    })
  } else if (process.env.NODE_ENV !== 'production') {
    createAgencyForUser(id, `${fullName}'s Agency`, 0, subdomainFromSignupName(fullName, email))
  } else {
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    throw new Error(
      'Signup is not configured. Set PUBLIC_SIGNUP_OWNER_EMAIL, PUBLIC_SIGNUP_AGENCY_SUBDOMAIN, or PLATFORM_ADMIN_EMAILS for the master agency.',
    )
  }

  return id
}

function postAuthRedirectUrl(userId: string, agencyId?: string | null): string {
  const session = buildSessionPayload(userId, agencyId)
  if (session.platformAdmin) return `${publicAppBaseUrl()}/ops`

  const agencyUrl = session.agency?.subdomain ? getAgencySubdomainUrl(session.agency.subdomain) : null
  return agencyUrl ?? `${publicAppBaseUrl()}/agency`
}

authRouter.get('/google', googleOAuthLimiter, (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    redirectWithAuthError(res, 'Google signup is not configured yet')
    return
  }

  const mode = req.query.mode === 'signup' ? 'signup' : 'login'
  const state = createGoogleState(mode)
  res.redirect(buildGoogleConsentUrl(state))
})

authRouter.get('/google/callback', googleOAuthLimiter, async (req, res) => {
  const error = typeof req.query.error === 'string' ? req.query.error : ''
  if (error) {
    redirectWithAuthError(res, `Google sign-in cancelled: ${error}`)
    return
  }

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  if (!code || !state || !consumeGoogleState(state)) {
    redirectWithAuthError(res, 'Google sign-in expired. Please try again.')
    return
  }

  try {
    const profile = await fetchGoogleProfile(code)
    const userId = await findOrCreateGoogleUser(profile)
    const agency = resolveAgency(userId)
    const token = signToken(userId)
    res.cookie('token', token, COOKIE_OPTIONS)
    if (agency) setAgencyCookie(res, agency.id)
    res.redirect(postAuthRedirectUrl(userId, agency?.id))
  } catch (err) {
    console.error('[auth] Google OAuth failed:', err)
    redirectWithAuthError(res, err instanceof Error ? err.message : 'Google sign-in failed')
  }
})

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

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|duplicate key|UNIQUE constraint failed/i.test(message)
}

authRouter.post('/signup', signupLimiter, async (req, res) => {
  if (!isPublicSignupEnabled()) {
    res.status(403).json({
      error: 'Public signup is closed. Ask an existing agency owner for a team invite, or contact support.',
    })
    return
  }

  const { fullName, email, password, phoneCountryCode, phoneNumber } = req.body ?? {}

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

  const normalizedEmail = email.toLowerCase()
  let newUserId: string | null = null

  try {
    const existing = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(normalizedEmail) as
      | { id: string; email_verified: number }
      | undefined
    if (existing) {
      if (existing.email_verified) {
        res.status(409).json({ error: 'An account with this email already exists' })
        return
      }
      safeDeleteUnverifiedSignup(existing.id)
    }

    const code = generateVerificationCode()
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const id = uuid()
    newUserId = id
    const hash = await bcrypt.hash(password, 10)

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, phone_country_code, phone_number, verification_code, verification_expires)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, normalizedEmail, fullName, hash, phoneCountryCode ?? '+92', phoneNumber, code, expires)

    const signupOwner = resolvePublicSignupOwner()
    let signupAgency: { subdomain: string | null; name: string | null; role: 'owner' | 'admin' }

    if (signupOwner) {
      const whatsapp = `${phoneCountryCode ?? '+92'}${phoneNumber}`.replace(/\s+/g, '')
      const clientAgency = createClientAgencyForSignup({
        userId: id,
        name: `${fullName}'s Agency`,
        preferredSubdomain: subdomainFromSignupName(fullName, email),
        whatsappNumber: whatsapp,
        ownerUserId: signupOwner.userId,
        parentAgencyId: signupOwner.agency.id,
      })
      signupAgency = { subdomain: clientAgency.subdomain, name: clientAgency.name, role: 'admin' }
    } else if (process.env.NODE_ENV !== 'production') {
      const whatsapp = `${phoneCountryCode ?? '+92'}${phoneNumber}`.replace(/\s+/g, '')
      const createdAgency = createAgencyForUser(
        id,
        `${fullName}'s Agency`,
        0,
        subdomainFromSignupName(fullName, email),
        whatsapp,
      )
      signupAgency = { subdomain: createdAgency.subdomain, name: `${fullName}'s Agency`, role: 'owner' }
    } else {
      res.status(503).json({
        error:
          'Signup is not configured. Set PUBLIC_SIGNUP_OWNER_EMAIL, PUBLIC_SIGNUP_AGENCY_SUBDOMAIN, or PLATFORM_ADMIN_EMAILS for the master agency.',
      })
      return
    }

    await sendVerificationEmail(email, code)

    res.status(201).json({
      message: 'Verification code sent to your Gmail',
      userId: id,
      role: signupAgency.role,
      agencyName: signupAgency.name,
      agencySubdomain: signupAgency.subdomain,
      agencyUrl: signupAgency.subdomain ? getAgencySubdomainUrl(signupAgency.subdomain) : null,
    })
  } catch (error) {
    if (newUserId) safeDeleteUnverifiedSignup(newUserId)

    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'An account with this email already exists. Try signing in or use Forgot password.' })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    if (/violates foreign key constraint/i.test(message)) {
      res.status(503).json({ error: 'Signup is misconfigured on the server. Contact support.' })
      return
    }
    if (/smtp|mail|email delivery|verification code|enotfound|getaddrinfo/i.test(message)) {
      res.status(502).json({ error: userFacingEmailError(error) })
      return
    }

    console.error('[auth] signup failed:', error)
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Signup failed. Please try again in a minute or contact support.'
          : message || 'Signup failed',
    })
  }
})

authRouter.post('/verify', verifyLimiter, (req, res) => {
  const { email, code } = req.body ?? {}
  if (!email || !code) {
    res.status(400).json({ error: 'Email and code are required' })
    return
  }

  const normalizedEmail = email.toLowerCase()
  try {
    assertVerificationAttemptsAllowed(normalizedEmail)
  } catch (err) {
    if (err instanceof VerificationLockedError) {
      res.status(429).json({ error: err.message })
      return
    }
    throw err
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) as
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
  if (user.verification_code !== String(code).trim()) {
    recordVerificationFailure(normalizedEmail)
    res.status(400).json({ error: 'Invalid verification code' })
    return
  }
  if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
    res.status(400).json({ error: 'Verification code expired' })
    return
  }

  clearVerificationAttempts(normalizedEmail)
  db.prepare(`
    UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL
    WHERE id = ?
  `).run(user.id)

  const agency = resolveAgency(user.id)
  if (agency?.role === 'owner') {
    const bonus = Number(process.env.PUBLIC_SIGNUP_BONUS_TOKENS ?? 50)
    if (Number.isFinite(bonus) && bonus > 0) {
      db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(bonus, agency.id)
      db.prepare(`
        INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
        VALUES (?, ?, ?, ?, 'signup_bonus', 'Welcome bonus tokens')
      `).run(uuid(), user.id, agency.id, bonus)
    }
  }

  const token = signToken(user.id)
  res.cookie('token', token, COOKIE_OPTIONS)
  if (agency) setAgencyCookie(res, agency.id)
  res.json({ message: 'Email verified successfully', ...buildSessionPayload(user.id, agency?.id) })
})

authRouter.post('/send-verification', resendLimiter, async (req, res) => {
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

authRouter.post('/login', loginLimiter, async (req, res) => {
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
  res.clearCookie('token', { path: '/', ...(cookieDomain() ? { domain: cookieDomain() } : {}) })
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

authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
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

authRouter.post('/reset-password', resetLimiter, async (req, res) => {
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
