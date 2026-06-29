import jwt from 'jsonwebtoken'
import { cookieDomain } from '../utils/appUrls.js'
import type { Request, Response, NextFunction } from 'express'
import { db, type UserRow } from '../db.js'

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production')
  }
  return secret ?? 'dev-secret-change-in-production'
}

const JWT_SECRET = resolveJwtSecret()

export type AuthRequest = Request & { user?: UserRow }

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string }
  } catch {
    return null
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token =
    req.cookies?.token ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null)

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const payload = verifyToken(token)
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined
  if (!user) {
    res.status(401).json({ error: 'User not found' })
    return
  }

  req.user = user
  next()
}

export function requireVerified(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user?.email_verified) {
    res.status(403).json({ error: 'Email not verified' })
    return
  }
  next()
}

export function sanitizeUser(user: UserRow, tokenBalance?: number) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phoneCountryCode: user.phone_country_code,
    phoneNumber: user.phone_number,
    tokenBalance: tokenBalance ?? user.token_balance,
    emailVerified: Boolean(user.email_verified),
    createdAt: user.created_at,
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
  ...(cookieDomain() ? { domain: cookieDomain() } : {}),
}
