import { Router } from 'express'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import {
  getProxyPoolFileInfo,
  getProxyPoolStats,
  reloadProxyPool,
  saveProxyPoolFromUpload,
} from '../services/proxyPool.js'

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

proxyPoolRouter.get(
  '/file-info',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner', 'admin'),
  (_req, res) => {
    res.json(getProxyPoolFileInfo())
  },
)

proxyPoolRouter.post(
  '/upload',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner', 'admin'),
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
  agencyMiddleware,
  requireRole('owner', 'admin'),
  (_req, res) => {
    reloadProxyPool()
    res.json({ stats: getProxyPoolStats() })
  },
)
