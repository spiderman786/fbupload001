import { Router } from 'express'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { getProxyPoolStats } from '../services/proxyPool.js'

export const proxyPoolRouter = Router()

proxyPoolRouter.get(
  '/stats',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner', 'admin'),
  (_req, res) => {
    res.json(getProxyPoolStats())
  },
)
