import { Router } from 'express'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { saveByocCredentials, getByocPublic, deleteByocCredentials } from '../services/byoc.js'
import type { AgencyRequest } from '../utils/agency.js'

export const byocRouter = Router()
byocRouter.use(authMiddleware, requireVerified, agencyMiddleware)

byocRouter.get('/:platform', (req: AgencyRequest, res) => {
  res.json(getByocPublic(req.agency!.id, req.params.platform))
})

byocRouter.put('/:platform', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { appId, appSecret, redirectUri } = req.body ?? {}
  if (!appId) {
    res.status(400).json({ error: 'App ID is required' })
    return
  }

  const existing = db
    .prepare('SELECT app_secret FROM byoc_credentials WHERE agency_id = ? AND platform = ?')
    .get(req.agency!.id, req.params.platform) as { app_secret: string } | undefined

  const secret = appSecret || existing?.app_secret
  if (!secret) {
    res.status(400).json({ error: 'App Secret is required' })
    return
  }

  saveByocCredentials(
    req.agency!.id,
    req.params.platform,
    appId,
    secret,
    redirectUri ?? process.env.FACEBOOK_REDIRECT_URI ?? 'http://localhost:5173/facebook/callback',
  )

  res.json({ message: 'Credentials saved', ...getByocPublic(req.agency!.id, req.params.platform) })
})

byocRouter.delete('/:platform', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  deleteByocCredentials(req.agency!.id, req.params.platform)
  res.json({ message: 'Credentials removed' })
})
