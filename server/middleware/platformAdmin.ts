import type { Response, NextFunction } from 'express'
import type { AuthRequest } from './auth.js'
import { isPlatformAdminEmail } from '../services/platformAdmin.js'

export type PlatformAdminRequest = AuthRequest

export function requirePlatformAdmin(req: PlatformAdminRequest, res: Response, next: NextFunction) {
  if (!req.user || !isPlatformAdminEmail(req.user.email)) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }
  next()
}
