import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import {
  connectPagesForAgency,
  connectSpecificPagesForAgency,
  exchangeCodeForToken,
  getOAuthUrl,
  isFacebookConfigured,
  saveFacebookAccount,
} from '../services/facebook.js'
import { isFacebookConfiguredForAgency } from '../services/byoc.js'
import type { AgencyRequest } from '../utils/agency.js'

export const facebookRouter = Router()

const oauthStates = new Map<string, { userId: string; agencyId: string; expires: number }>()

facebookRouter.get('/status', authMiddleware, requireVerified, agencyMiddleware, (req: AgencyRequest, res) => {
  const configured = isFacebookConfiguredForAgency(req.agency!.id)
  res.json({ configured, mockMode: !configured })
})

facebookRouter.get('/oauth', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const state = uuid()
    oauthStates.set(state, { userId: req.user!.id, agencyId: req.agency!.id, expires: Date.now() + 10 * 60 * 1000 })
    res.json({ url: getOAuthUrl(req.agency!.id, state) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'OAuth not configured' })
  }
})

facebookRouter.post('/callback', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const { code, state } = req.body ?? {}
  const userId = req.user!.id
  const agencyId = req.agency!.id

  if (state) {
    const stored = oauthStates.get(state)
    if (!stored || stored.expires < Date.now() || stored.userId !== userId || stored.agencyId !== agencyId) {
      res.status(400).json({ error: 'Invalid or expired OAuth state' })
      return
    }
    oauthStates.delete(state)
  }

  try {
    const { accessToken, metaUserId } = await exchangeCodeForToken(agencyId, code ?? 'mock_code')
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken)
    const pageIds = await connectPagesForAgency(agencyId, userId, accountId, accessToken)

    res.json({
      message: 'Facebook account connected',
      accountId,
      pagesConnected: pageIds.length,
      mockMode: !isFacebookConfigured(agencyId),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'OAuth failed' })
  }
})

facebookRouter.post('/connect-mock', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  try {
    const userId = req.user!.id
    const agencyId = req.agency!.id
    const { accessToken, metaUserId } = await exchangeCodeForToken(agencyId, 'mock_code')
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken)
    const pageIds = await connectPagesForAgency(agencyId, userId, accountId, accessToken)
    res.json({ message: 'Demo pages connected', pagesConnected: pageIds.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Connect failed' })
  }
})

facebookRouter.get('/accounts', authMiddleware, requireVerified, agencyMiddleware, (req: AgencyRequest, res) => {
  const accounts = db
    .prepare('SELECT id, meta_user_id, connected_at FROM facebook_accounts WHERE agency_id = ? ORDER BY connected_at DESC')
    .all(req.agency!.id)
  res.json({ accounts })
})

facebookRouter.get('/accounts/:accountId/pages', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const account = db
    .prepare('SELECT id, access_token FROM facebook_accounts WHERE id = ? AND agency_id = ?')
    .get(req.params.accountId, req.agency!.id) as { id: string; access_token: string } | undefined

  if (!account) {
    res.status(404).json({ error: 'Facebook account not found' })
    return
  }

  try {
    const { fetchUserPages } = await import('../services/facebook.js')
    const pages = await fetchUserPages(req.agency!.id, account.access_token)
    res.json({ pages })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch pages' })
  }
})

facebookRouter.post(
  '/accounts/:accountId/connect-pages',
  authMiddleware,
  requireVerified,
  agencyMiddleware,
  requireRole('owner', 'admin'),
  async (req: AgencyRequest, res) => {
    const account = db
      .prepare('SELECT id, access_token FROM facebook_accounts WHERE id = ? AND agency_id = ?')
      .get(req.params.accountId, req.agency!.id) as { id: string; access_token: string } | undefined

    if (!account) {
      res.status(404).json({ error: 'Facebook account not found' })
      return
    }

    const pageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds : []
    if (!pageIds.length) {
      res.status(400).json({ error: 'Select at least one page' })
      return
    }

    try {
      const connected = await connectSpecificPagesForAgency(
        req.agency!.id,
        req.user!.id,
        account.id,
        account.access_token,
        pageIds,
      )
      res.json({ message: 'Pages added to automation', pagesConnected: connected.length, ids: connected })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add pages' })
    }
  },
)

facebookRouter.get('/pages', authMiddleware, requireVerified, agencyMiddleware, async (req: AgencyRequest, res) => {
  const account = db
    .prepare('SELECT access_token FROM facebook_accounts WHERE agency_id = ? ORDER BY connected_at DESC LIMIT 1')
    .get(req.agency!.id) as { access_token: string } | undefined

  if (!account) {
    res.json({ pages: [] })
    return
  }

  const { fetchUserPages } = await import('../services/facebook.js')
  const pages = await fetchUserPages(req.agency!.id, account.access_token)
  res.json({ pages })
})
