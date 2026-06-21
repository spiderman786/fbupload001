import type { Response, NextFunction } from 'express'
import {
  assertAgencyMember,
  assertAgencySubdomainMember,
  backfillAgencyForUser,
  setAgencyCookie,
  type AgencyRequest,
  type AgencyRole,
} from '../utils/agency.js'

function getForwardedHost(req: AgencyRequest): string {
  const forwarded = req.headers['x-forwarded-host']
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? ''
  return raw.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '')
}

function extractTenantSubdomain(req: AgencyRequest): string | null {
  const host = getForwardedHost(req)
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

export function agencyMiddleware(req: AgencyRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  backfillAgencyForUser(req.user.id)

  const subdomain = extractTenantSubdomain(req)
  if (subdomain) {
    const fromSubdomain = assertAgencySubdomainMember(req.user.id, subdomain)
    if (fromSubdomain) {
      req.agency = fromSubdomain
      setAgencyCookie(res, fromSubdomain.id)
      next()
      return
    }
  }

  const agencyIdHint = req.cookies?.agency_id as string | undefined
  const agency = assertAgencyMember(req.user.id, agencyIdHint ?? '') ?? assertAgencyMember(
    req.user.id,
    backfillAgencyForUser(req.user.id),
  )

  if (!agency) {
    res.status(403).json({ error: 'No agency membership found' })
    return
  }

  req.agency = agency
  next()
}

export function requireRole(...roles: AgencyRole[]) {
  return (req: AgencyRequest, res: Response, next: NextFunction) => {
    if (!req.agency || !roles.includes(req.agency.role)) {
      res.status(403).json({ error: 'Insufficient permissions for this action' })
      return
    }
    next()
  }
}
