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
import {
  consumeOAuthState,
  getOrCreateMagicLink,
  saveOAuthState,
  startMagicLinkOAuth,
} from '../services/facebookOAuthLinks.js'

import { routeParam } from '../utils/routeParam.js'
export const facebookRouter = Router()

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

facebookRouter.get('/magic-link', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const byocCredentialId =
      typeof req.query.byocCredentialId === 'string' ? req.query.byocCredentialId : null
    const resolvedId = byocCredentialId ? resolveByocCredentialId(req.agency!.id, byocCredentialId) : resolveByocCredentialId(req.agency!.id, null)
    const link = getOrCreateMagicLink(req.agency!.id, req.user!.id, resolvedId)
    res.json(link)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create connect link' })
  }
})

facebookRouter.post('/magic-link', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const byocCredentialId =
      typeof req.body?.byocCredentialId === 'string' ? req.body.byocCredentialId : null
    const resolvedId = byocCredentialId ? resolveByocCredentialId(req.agency!.id, byocCredentialId) : resolveByocCredentialId(req.agency!.id, null)
    const link = getOrCreateMagicLink(req.agency!.id, req.user!.id, resolvedId, {
      regenerate: Boolean(req.body?.regenerate),
      label: typeof req.body?.label === 'string' ? req.body.label : undefined,
    })
    res.json(link)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create connect link' })
  }
})

facebookRouter.get('/magic-link/:token/start', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const result = startMagicLinkOAuth(routeParam(req.params.token), req.user!.id, req.agency!.id)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid connect link' })
  }
})

facebookRouter.get('/oauth', authMiddleware, requireVerified, agencyMiddleware, requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  try {
    const byocCredentialId =
      typeof req.query.byocCredentialId === 'string' ? req.query.byocCredentialId : null
    const resolvedId = resolveByocCredentialId(req.agency!.id, byocCredentialId)
    const state = uuid()
    saveOAuthState({
      state,
      userId: req.user!.id,
      agencyId: req.agency!.id,
      byocCredentialId: resolvedId,
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
    const stored = consumeOAuthState(state, userId, agencyId)
    if (!stored) {
      res.status(400).json({ error: 'Invalid or expired OAuth state' })
      return
    }
    byocCredentialId = stored.byocCredentialId
  } else if (process.env.NODE_ENV === 'production') {
    res.status(400).json({ error: 'Missing OAuth state' })
    return
  }

  try {
    const { accessToken, metaUserId, displayName } = await exchangeCodeForToken(agencyId, code ?? 'mock_code', byocCredentialId)
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken, byocCredentialId, displayName)
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
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    const userId = req.user!.id
    const agencyId = req.agency!.id
    const byocCredentialId =
      typeof req.body?.byocCredentialId === 'string' ? resolveByocCredentialId(agencyId, req.body.byocCredentialId) : null
    const { accessToken, metaUserId, displayName } = await exchangeCodeForToken(agencyId, 'mock_code', byocCredentialId)
    const accountId = saveFacebookAccount(agencyId, userId, metaUserId, accessToken, byocCredentialId, displayName)
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
        fa.display_name,
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
    .get(routeParam(req.params.accountId), req.agency!.id) as { id: string; access_token: string } | undefined

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
      .get(routeParam(req.params.accountId), req.agency!.id) as { id: string; access_token: string } | undefined

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
    assertOwnerUnlimitedPages(req.agency!.role, currentCount.count)

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

      const connectedPages =
        connected.length > 0
          ? (db
              .prepare(
                `SELECT id, meta_page_id as metaPageId FROM facebook_pages WHERE id IN (${connected.map(() => '?').join(',')})`,
              )
              .all(...connected) as { id: string; metaPageId: string }[])
          : []

      res.json({
        message: 'Pages added to automation',
        pagesConnected: connected.length,
        skipped,
        ids: connected,
        connectedPages,
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
