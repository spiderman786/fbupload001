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
import { getByocCredentialById, isFacebookConfiguredForAgency, listByocApps } from '../services/byoc.js'
import { CONNECT_PAGES_BATCH_SIZE, assertOwnerUnlimitedPages } from '../utils/pagination.js'
import type { AgencyRequest } from '../utils/agency.js'

export const facebookRouter = Router()

const oauthStates = new Map<
  string,
  { userId: string; agencyId: string; byocCredentialId: string | null; expires: number }
>()

function resolveByocCredentialId(agencyId: string, byocCredentialId?: string | null): string | null {
  if (byocCredentialId) {
    const creds = getByocCredentialById(agencyId, byocCredentialId)
    if (!creds) throw new Error('Selected Facebook app not found')
    return byocCredentialId
  }
  const apps = listByocApps(agencyId, 'facebook')
  if (apps.length === 1) return apps[0].id
  if (apps.length > 1) throw new Error('Select which Facebook Developer app to use before connecting')
  return null
}

facebookRouter.get('/status', authMiddleware, requireVerified, agencyMiddleware, (req: AgencyRequest, res) => {
  const configured = isFacebookConfiguredForAgency(req.agency!.id)
  const apps = listByocApps(req.agency!.id, 'facebook')
  res.json({ configured, mockMode: !configured, appCount: apps.length })
})

facebookRouter.get('/oauth', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const byocCredentialId =
      typeof req.query.byocCredentialId === 'string' ? req.query.byocCredentialId : null
    const resolvedId = resolveByocCredentialId(req.agency!.id, byocCredentialId)
    const state = uuid()
    oauthStates.set(state, {
      userId: req.user!.id,
      agencyId: req.agency!.id,
      byocCredentialId: resolvedId,
      expires: Date.now() + 10 * 60 * 1000,
    })
    res.json({ url: getOAuthUrl(req.agency!.id, state, resolvedId), byocCredentialId: resolvedId })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'OAuth not configured' })
  }
})

facebookRouter.post('/callback', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const { code, state } = req.body ?? {}
  const userId = req.user!.id
  const agencyId = req.agency!.id
  let byocCredentialId: string | null = null

  if (state) {
    const stored = oauthStates.get(state)
    if (!stored || stored.expires < Date.now() || stored.userId !== userId || stored.agencyId !== agencyId) {
      res.status(400).json({ error: 'Invalid or expired OAuth state' })
      return
    }
    byocCredentialId = stored.byocCredentialId
    oauthStates.delete(state)
  }

  try {
    const { accessToken, metaUserId } = await exchangeCodeForToken(agencyId, code ?? 'mock_code', byocCredentialId)
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken, byocCredentialId)
    const pageIds = await connectPagesForAgency(agencyId, userId, accountId, accessToken)

    res.json({
      message: 'Facebook account connected',
      accountId,
      pagesConnected: pageIds.length,
      mockMode: !isFacebookConfigured(agencyId),
      byocCredentialId,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'OAuth failed' })
  }
})

facebookRouter.post('/connect-mock', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  try {
    const userId = req.user!.id
    const agencyId = req.agency!.id
    const byocCredentialId =
      typeof req.body?.byocCredentialId === 'string' ? resolveByocCredentialId(agencyId, req.body.byocCredentialId) : null
    const { accessToken, metaUserId } = await exchangeCodeForToken(agencyId, 'mock_code', byocCredentialId)
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken, byocCredentialId)
    const pageIds = await connectPagesForAgency(agencyId, userId, accountId, accessToken)
    res.json({ message: 'Demo pages connected', pagesConnected: pageIds.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Connect failed' })
  }
})

facebookRouter.get('/accounts', authMiddleware, requireVerified, agencyMiddleware, (req: AgencyRequest, res) => {
  const accounts = db
    .prepare(`
      SELECT
        fa.id,
        fa.meta_user_id,
        fa.connected_at,
        fa.byoc_credential_id,
        b.label AS byoc_label,
        b.app_id AS byoc_app_id
      FROM facebook_accounts fa
      LEFT JOIN byoc_credentials b ON b.id = fa.byoc_credential_id
      WHERE fa.agency_id = ?
      ORDER BY fa.connected_at DESC
    `)
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

    const pageIds = Array.isArray(req.body?.pageIds)
      ? req.body.pageIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : []
    if (!pageIds.length) {
      res.status(400).json({ error: 'Select at least one page' })
      return
    }

    const currentCount = db
      .prepare('SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ?')
      .get(req.agency!.id) as { count: number }
    assertOwnerUnlimitedPages(req.agency!.role, currentCount.count, pageIds.length)

    try {
      const connected: string[] = []
      let skipped = 0
      const bulkConnect = pageIds.length > 50

      for (let i = 0; i < pageIds.length; i += CONNECT_PAGES_BATCH_SIZE) {
        const batch = pageIds.slice(i, i + CONNECT_PAGES_BATCH_SIZE)
        const ids = await connectSpecificPagesForAgency(
          req.agency!.id,
          req.user!.id,
          account.id,
          account.access_token,
          batch,
          { skipFollowerSync: bulkConnect },
        )
        connected.push(...ids)
        skipped += batch.length - ids.length
      }

      res.json({
        message: 'Pages added to automation',
        pagesConnected: connected.length,
        skipped,
        ids: connected,
      })
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
