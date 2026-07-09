import { Router } from 'express'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { requirePlatformAdmin } from '../middleware/platformAdmin.js'
import {
  getProxyPoolFileInfo,
  getProxyPoolStats,
  isAutoPruneEnabled,
  pruneDeadProxies,
  reloadProxyPool,
  saveProxyPoolFromUpload,
} from '../services/proxyPool.js'

export const proxyPoolRouter = Router()

proxyPoolRouter.get(
  '/stats',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner'),
  (_req, res) => {
    res.json(getProxyPoolStats())
  },
)

proxyPoolRouter.get(
  '/file-info',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner'),
  (_req, res) => {
    res.json(getProxyPoolFileInfo())
  },
)

/** Global proxy pool — platform admin only (shared across all tenants). */
proxyPoolRouter.post(
  '/upload',
  authMiddleware,
  requireVerified,
  requirePlatformAdmin,
  (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    if (!content.trim()) {
      res.status(400).json({ error: 'Upload content is empty' })
      return
    }

    try {
      const result = saveProxyPoolFromUpload(content)
      res.json(result)
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid proxy file' })
    }
  },
)

proxyPoolRouter.post(
  '/reload',
  authMiddleware,
  requireVerified,
  requirePlatformAdmin,
  (_req, res) => {
    reloadProxyPool()
    res.json({ stats: getProxyPoolStats() })
  },
)

/** Test each proxy and remove dead entries from the saved pool file. */
proxyPoolRouter.post(
  '/prune',
  authMiddleware,
  requireVerified,
  requirePlatformAdmin,
  async (_req, res) => {
    try {
      const result = await pruneDeadProxies()
      res.json({
        ...result,
        autoPruneEnabled: isAutoPruneEnabled(),
      })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Proxy health check failed' })
    }
  },
)
