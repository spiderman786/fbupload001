import type { Response, NextFunction } from 'express'
import {
  assertAgencyMember,
  backfillAgencyForUser,
  type AgencyRequest,
  type AgencyRole,
} from '../utils/agency.js'

export function agencyMiddleware(req: AgencyRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  backfillAgencyForUser(req.user.id)

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
