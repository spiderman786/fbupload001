import { Router } from 'express'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import {
  createByocApp,
  updateByocApp,
  deleteByocApp,
  getByocPublic,
  listByocApps,
  saveByocCredentials,
} from '../services/byoc.js'
import type { AgencyRequest } from '../utils/agency.js'

import { routeParam } from '../utils/routeParam.js'
export const byocRouter = Router()
byocRouter.use(authMiddleware, requireVerified, agencyMiddleware)

byocRouter.get('/:platform/apps', (req: AgencyRequest, res) => {
  const apps = listByocApps(req.agency!.id, routeParam(req.params.platform))
  const summary = getByocPublic(req.agency!.id, routeParam(req.params.platform))
  res.json({
    apps,
    envFallback: summary.usingEnvFallback,
    configured: summary.configured,
  })
})

byocRouter.post('/:platform/apps', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { label, appId, appSecret, redirectUri } = req.body ?? {}
  if (!appId || !appSecret) {
    res.status(400).json({ error: 'App ID and App Secret are required' })
    return
  }

  try {
    const id = createByocApp(
      req.agency!.id,
      routeParam(req.params.platform),
      label ?? '',
      appId,
      appSecret,
      redirectUri ?? process.env.FACEBOOK_REDIRECT_URI ?? 'http://localhost:5173/facebook/callback',
    )
    const apps = listByocApps(req.agency!.id, routeParam(req.params.platform))
    const app = apps.find((a) => a.id === id)
    res.status(201).json({ message: 'Facebook app added', app })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add app' })
  }
})

byocRouter.put('/:platform/apps/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { label, appId, appSecret, redirectUri } = req.body ?? {}
  try {
    updateByocApp(req.agency!.id, routeParam(req.params.id), { label, appId, appSecret, redirectUri })
    const app = listByocApps(req.agency!.id, routeParam(req.params.platform)).find((a) => a.id === routeParam(req.params.id))
    res.json({ message: 'App updated', app })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update app' })
  }
})

byocRouter.delete('/:platform/apps/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    deleteByocApp(req.agency!.id, routeParam(req.params.id))
    res.json({ message: 'App removed' })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to remove app' })
  }
})

byocRouter.get('/:platform', (req: AgencyRequest, res) => {
  res.json(getByocPublic(req.agency!.id, routeParam(req.params.platform)))
})

byocRouter.put('/:platform', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { appId, appSecret, redirectUri, label } = req.body ?? {}
  if (!appId) {
    res.status(400).json({ error: 'App ID is required' })
    return
  }

  const apps = listByocApps(req.agency!.id, routeParam(req.params.platform))
  const existing = apps[0]

  if (existing && !appSecret) {
    updateByocApp(req.agency!.id, existing.id, { label, appId, redirectUri })
  } else if (!appSecret) {
    res.status(400).json({ error: 'App Secret is required' })
    return
  } else {
    saveByocCredentials(
      req.agency!.id,
      routeParam(req.params.platform),
      appId,
      appSecret,
      redirectUri ?? process.env.FACEBOOK_REDIRECT_URI ?? 'http://localhost:5173/facebook/callback',
    )
    if (label && existing) updateByocApp(req.agency!.id, existing.id, { label })
  }

  res.json({ message: 'Credentials saved', ...getByocPublic(req.agency!.id, routeParam(req.params.platform)) })
})

byocRouter.delete('/:platform', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const apps = listByocApps(req.agency!.id, routeParam(req.params.platform))
  const blocked = apps.filter((a) => a.linkedAccounts > 0)
  if (blocked.length) {
    res.status(400).json({
      error: `${blocked.length} app(s) still have linked Facebook accounts. Remove accounts first or delete apps individually.`,
    })
    return
  }
  for (const app of apps) deleteByocApp(req.agency!.id, app.id)
  res.json({ message: 'All app credentials removed' })
})
