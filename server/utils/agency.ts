import { v4 as uuid } from 'uuid'
import type { Response } from 'express'
import { db } from '../db.js'
import { sanitizeUser, type AuthRequest } from '../middleware/auth.js'

export type AgencyRole = 'owner' | 'admin' | 'staff'

export type AgencySession = {
  id: string
  name: string
  role: AgencyRole
  tokenBalance: number
  whatsappNumber: string | null
  subdomain: string | null
}

export type AgencyMembership = AgencySession

export const AGENCY_COOKIE = 'agency_id'

export const COOKIE_AGENCY_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
}

export type AgencyRequest = AuthRequest & { agency?: AgencySession }

export function canManageTeam(role: AgencyRole): boolean {
  return role === 'owner'
}

export function canInvite(role: AgencyRole): boolean {
  return role === 'owner' || role === 'admin'
}

export function canWriteResources(role: AgencyRole): boolean {
  return role === 'owner' || role === 'admin'
}

export function canRunAutomation(role: AgencyRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'staff'
}

export function getMemberships(userId: string): AgencyMembership[] {
  const rows = db
    .prepare(`
      SELECT a.id, a.name, a.token_balance, a.whatsapp_number, a.subdomain, m.role
      FROM agency_members m
      JOIN agencies a ON a.id = m.agency_id
      WHERE m.user_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, a.name
    `)
    .all(userId) as {
    id: string
    name: string
    token_balance: number
    whatsapp_number: string | null
    subdomain: string | null
    role: AgencyRole
  }[]

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    tokenBalance: r.token_balance,
    whatsappNumber: r.whatsapp_number,
    subdomain: r.subdomain,
  }))
}

export function normalizeSubdomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/** Subdomain from signup full name, e.g. "Ahmed Khan" → "ahmed-khan", "Beeni Bangash" → "beeni-bangash". */
export function subdomainFromSignupName(fullName: string, email?: string): string {
  const fromName = normalizeSubdomain(fullName.trim())
  if (fromName) return fromName.slice(0, 40)
  const emailLocal = email?.split('@')[0] ?? ''
  const fromEmail = normalizeSubdomain(emailLocal)
  return (fromEmail || 'agency').slice(0, 40)
}

function makeSubdomainBase(name: string, email?: string): string {
  const candidate = subdomainFromSignupName(name, email)
  return candidate || 'agency'
}

function ensureUniqueSubdomain(base: string): string {
  const normalizedBase = normalizeSubdomain(base) || 'agency'
  let attempt = normalizedBase
  let i = 2
  while (true) {
    const exists = db.prepare('SELECT id FROM agencies WHERE subdomain = ? LIMIT 1').get(attempt) as { id: string } | undefined
    if (!exists) return attempt
    attempt = `${normalizedBase}-${i}`.slice(0, 50)
    i += 1
  }
}

export function resolveAgency(userId: string, agencyIdHint?: string | null): AgencySession | null {
  const memberships = getMemberships(userId)
  if (!memberships.length) return null

  if (agencyIdHint) {
    const match = memberships.find((m) => m.id === agencyIdHint)
    if (match) return match
  }

  return memberships[0]!
}

export function createAgencyForUser(
  userId: string,
  name: string,
  initialTokens = 0,
  preferredSubdomain?: string,
): { agencyId: string; subdomain: string } {
  const agencyId = uuid()
  const subdomain = ensureUniqueSubdomain(preferredSubdomain ?? makeSubdomainBase(name))
  db.prepare('INSERT INTO agencies (id, name, token_balance, whatsapp_number, subdomain) VALUES (?, ?, ?, ?, ?)').run(
    agencyId,
    name,
    initialTokens,
    null,
    subdomain,
  )
  db.prepare('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)').run(
    uuid(),
    agencyId,
    userId,
    'owner',
  )
  return { agencyId, subdomain }
}

export function getAgencySubdomainUrl(subdomain: string): string | null {
  const baseDomain = process.env.APP_BASE_DOMAIN?.trim() || process.env.PUBLIC_APP_BASE_DOMAIN?.trim()
  if (!baseDomain) return null
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return `${protocol}://${subdomain}.${baseDomain}/agency`
}

export function buildSessionPayload(userId: string, agencyIdHint?: string | null) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as import('../db.js').UserRow
  const agency = resolveAgency(userId, agencyIdHint)
  const agencies = getMemberships(userId)

  return {
    user: sanitizeUser(user, agency?.tokenBalance ?? 0),
    agency,
    agencies,
  }
}

export function setAgencyCookie(res: Response, agencyId: string) {
  res.cookie(AGENCY_COOKIE, agencyId, COOKIE_AGENCY_OPTIONS)
}

export function clearAgencyCookie(res: Response) {
  res.clearCookie(AGENCY_COOKIE, { path: '/' })
}

export function assertAgencyMember(userId: string, agencyId: string): AgencySession | null {
  const row = db
    .prepare(`
      SELECT a.id, a.name, a.token_balance, a.whatsapp_number, a.subdomain, m.role
      FROM agency_members m
      JOIN agencies a ON a.id = m.agency_id
      WHERE m.user_id = ? AND m.agency_id = ?
    `)
    .get(userId, agencyId) as
    | { id: string; name: string; token_balance: number; whatsapp_number: string | null; subdomain: string | null; role: AgencyRole }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tokenBalance: row.token_balance,
    whatsappNumber: row.whatsapp_number,
    subdomain: row.subdomain,
  }
}

export function assertAgencySubdomainMember(userId: string, subdomain: string): AgencySession | null {
  const row = db
    .prepare(`
      SELECT a.id, a.name, a.token_balance, a.whatsapp_number, a.subdomain, m.role
      FROM agency_members m
      JOIN agencies a ON a.id = m.agency_id
      WHERE m.user_id = ? AND lower(a.subdomain) = lower(?)
      LIMIT 1
    `)
    .get(userId, subdomain) as
    | { id: string; name: string; token_balance: number; whatsapp_number: string | null; subdomain: string | null; role: AgencyRole }
    | undefined

  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tokenBalance: row.token_balance,
    whatsappNumber: row.whatsapp_number,
    subdomain: row.subdomain,
  }
}

export function backfillAgencyForUser(userId: string): string {
  const existing = db
    .prepare('SELECT agency_id FROM agency_members WHERE user_id = ? LIMIT 1')
    .get(userId) as { agency_id: string } | undefined
  if (existing) return existing.agency_id

  const user = db.prepare('SELECT full_name, token_balance FROM users WHERE id = ?').get(userId) as {
    full_name: string
    token_balance: number
  }

  const agencyId = createAgencyForUser(userId, `${user.full_name}'s Agency`, user.token_balance).agencyId

  const tables = [
    'facebook_accounts',
    'facebook_pages',
    'source_accounts',
    'schedule_slots',
    'reel_jobs',
    'token_transactions',
    'page_source_assignments',
  ] as const

  for (const table of tables) {
    db.prepare(`UPDATE ${table} SET agency_id = ? WHERE user_id = ? AND (agency_id IS NULL OR agency_id = '')`).run(
      agencyId,
      userId,
    )
  }

  db.prepare(`
    UPDATE byoc_credentials SET agency_id = ?
    WHERE user_id = ? AND (agency_id IS NULL OR agency_id = '')
  `).run(agencyId, userId)

  return agencyId
}
