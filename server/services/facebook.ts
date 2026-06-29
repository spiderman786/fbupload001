import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { getByocCredentials, isFacebookConfiguredForAgency } from './byoc.js'
import { seedFollowerBaseline, syncPageFollowers } from './followerSync.js'
import { ensurePageAutomationSettings } from './pageAutomationSettings.js'

export function isFacebookConfigured(agencyId?: string): boolean {
  if (agencyId) return isFacebookConfiguredForAgency(agencyId)
  return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)
}

/** Demo pages created via mock connect — cannot call the real Graph API. */
export function isMockMetaPageId(metaPageId: string): boolean {
  return /^mock_page_/i.test(metaPageId.trim())
}

export function isMockAccessToken(token: string): boolean {
  const t = token.trim()
  return t === 'mock_token' || /^mock_/i.test(t)
}

export function getOAuthUrl(agencyId: string, state: string, byocCredentialId?: string | null): string {
  const creds = getByocCredentials(agencyId, 'facebook', byocCredentialId)
  if (!creds) throw new Error('Facebook app not configured. Add BYOC credentials in Settings.')

  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: creds.redirectUri,
    state,
    scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata',
    response_type: 'code',
  })
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`
}

export async function exchangeCodeForToken(
  agencyId: string,
  code: string,
  byocCredentialId?: string | null,
): Promise<{
  accessToken: string
  metaUserId: string
  displayName?: string | null
}> {
  const creds = getByocCredentials(agencyId, 'facebook', byocCredentialId)
  if (!creds) {
    if (code === 'mock_code') {
      return { accessToken: 'mock_token', metaUserId: 'mock_user_' + Date.now(), displayName: 'Demo Facebook User' }
    }
    throw new Error('Facebook app not configured')
  }

  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: creds.appId,
      client_secret: creds.appSecret,
      redirect_uri: creds.redirectUri,
      code,
    })}`,
  )
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: { message: string } }
  if (!tokenData.access_token) {
    throw new Error(tokenData.error?.message ?? 'Failed to exchange OAuth code')
  }

  const meRes = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${tokenData.access_token}`,
  )
  const meData = (await meRes.json()) as { id?: string; name?: string }
  if (!meData.id) throw new Error('Failed to fetch Meta user ID')

  return { accessToken: tokenData.access_token, metaUserId: meData.id, displayName: meData.name ?? null }
}

type FbPageRow = { id: string; name: string; followers?: string; fanCount: number; accessToken?: string }

function mapGraphPage(p: { id: string; name: string; fan_count?: number; access_token?: string }): FbPageRow {
  return {
    id: p.id,
    name: p.name,
    fanCount: p.fan_count ?? 0,
    followers: p.fan_count ? formatFollowers(p.fan_count) : '0',
    accessToken: p.access_token,
  }
}

export async function fetchUserPages(agencyId: string, accessToken: string): Promise<FbPageRow[]> {
  if (!isFacebookConfigured(agencyId) && accessToken === 'mock_token') {
    return [
      { id: 'mock_page_1', name: 'Adam Sullivan', followers: '12.4K', fanCount: 12_400, accessToken: 'mock_page_token_1' },
      { id: 'mock_page_2', name: 'Adin Ross', followers: '8.1K', fanCount: 8_100, accessToken: 'mock_page_token_2' },
      { id: 'mock_page_3', name: 'AI Baby Magic', followers: '5.6K', fanCount: 5_600, accessToken: 'mock_page_token_3' },
    ]
  }

  const pages: FbPageRow[] = []
  let url: string | null =
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,fan_count,access_token&limit=100&access_token=${encodeURIComponent(accessToken)}`

  while (url) {
    const res = await fetch(url)
    const data = (await res.json()) as {
      data?: { id: string; name: string; fan_count?: number; access_token?: string }[]
      paging?: { next?: string }
      error?: { message: string }
    }

    if (data.error) throw new Error(data.error.message)
    for (const p of data.data ?? []) pages.push(mapGraphPage(p))
    url = data.paging?.next ?? null
  }

  return pages
}

/** Resolve Meta page IDs to page records (supports bulk CSV connect beyond first Graph page batch). */
export async function fetchPagesByMetaIds(
  agencyId: string,
  accessToken: string,
  metaPageIds: string[],
): Promise<FbPageRow[]> {
  if (!metaPageIds.length) return []

  if (!isFacebookConfigured(agencyId) && accessToken === 'mock_token') {
    const all = await fetchUserPages(agencyId, accessToken)
    const wanted = new Set(metaPageIds)
    return all.filter((p) => wanted.has(p.id))
  }

  const results: FbPageRow[] = []
  const chunkSize = 50

  for (let i = 0; i < metaPageIds.length; i += chunkSize) {
    const chunk = metaPageIds.slice(i, i + chunkSize)
    const res = await fetch(
      `https://graph.facebook.com/v21.0/?ids=${chunk.join(',')}&fields=id,name,fan_count,access_token&access_token=${encodeURIComponent(accessToken)}`,
    )
    const data = (await res.json()) as Record<
      string,
      { id: string; name: string; fan_count?: number; access_token?: string; error?: { message: string } }
    > & { error?: { message: string } }

    if (data.error) throw new Error(data.error.message)

    for (const id of chunk) {
      const page = data[id]
      if (!page || page.error) continue
      results.push(mapGraphPage(page))
    }
  }

  return results
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function saveFacebookAccount(
  agencyId: string,
  userId: string,
  metaUserId: string,
  accessToken: string,
  byocCredentialId?: string | null,
  displayName?: string | null,
) {
  const existing = db
    .prepare('SELECT id FROM facebook_accounts WHERE agency_id = ? AND meta_user_id = ?')
    .get(agencyId, metaUserId) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE facebook_accounts
      SET access_token = ?, byoc_credential_id = COALESCE(?, byoc_credential_id),
          display_name = COALESCE(?, display_name), connected_at = datetime('now')
      WHERE id = ?
    `).run(accessToken, byocCredentialId ?? null, displayName ?? null, existing.id)
    return existing.id
  }

  const id = uuid()
  db.prepare(
    'INSERT INTO facebook_accounts (id, user_id, agency_id, meta_user_id, access_token, byoc_credential_id, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, agencyId, metaUserId, accessToken, byocCredentialId ?? null, displayName ?? null)
  return id
}

export async function connectPagesForAgency(
  agencyId: string,
  userId: string,
  accountId: string,
  accessToken: string,
) {
  const pages = await fetchUserPages(agencyId, accessToken)
  return upsertPagesForAgency(agencyId, userId, accountId, pages)
}

export async function connectSpecificPagesForAgency(
  agencyId: string,
  userId: string,
  accountId: string,
  accessToken: string,
  pageIds: string[],
  options?: { skipFollowerSync?: boolean },
) {
  const wanted = [...new Set(pageIds.map((p) => String(p).trim()).filter(Boolean))]
  if (!wanted.length) return []

  const connected: string[] = []
  const needGraph: string[] = []

  for (const metaPageId of wanted) {
    const existing = db
      .prepare(
        'SELECT id FROM facebook_pages WHERE agency_id = ? AND meta_page_id = ? AND facebook_account_id = ?',
      )
      .get(agencyId, metaPageId, accountId) as { id: string } | undefined

    if (existing) {
      ensurePageAutomationSettings(existing.id)
      connected.push(existing.id)
    } else {
      needGraph.push(metaPageId)
    }
  }

  if (needGraph.length > 0) {
    const fromGraph = await fetchPagesByMetaIds(agencyId, accessToken, needGraph)
    if (fromGraph.length > 0) {
      const graphConnected = await upsertPagesForAgency(agencyId, userId, accountId, fromGraph, options)
      connected.push(...graphConnected)
    }
  }

  if (connected.length === 0) {
    for (const metaPageId of wanted) {
      const existing = db
        .prepare('SELECT id FROM facebook_pages WHERE agency_id = ? AND meta_page_id = ?')
        .get(agencyId, metaPageId) as { id: string } | undefined
      if (existing) {
        db.prepare('UPDATE facebook_pages SET facebook_account_id = ? WHERE id = ?').run(accountId, existing.id)
        ensurePageAutomationSettings(existing.id)
        connected.push(existing.id)
      }
    }
  }

  if (connected.length === 0) {
    throw new Error(
      'Could not connect the selected page(s). Re-authorize the Facebook account or confirm the page is still linked in Meta.',
    )
  }

  return [...new Set(connected)]
}

async function upsertPagesForAgency(
  agencyId: string,
  userId: string,
  accountId: string,
  pages: { id: string; name: string; followers?: string; fanCount: number; accessToken?: string }[],
  options?: { skipFollowerSync?: boolean },
) {
  const connected: string[] = []

  for (const page of pages) {
    const existing = db
      .prepare('SELECT id FROM facebook_pages WHERE agency_id = ? AND meta_page_id = ?')
      .get(agencyId, page.id) as { id: string } | undefined

    if (existing) {
      if (page.accessToken) {
        db.prepare('UPDATE facebook_pages SET page_access_token = ?, health_status = ? WHERE id = ?').run(
          page.accessToken,
          'completed',
          existing.id,
        )
      }
      if (!options?.skipFollowerSync) {
        const row = db.prepare(`
          SELECT id, user_id, meta_page_id, page_access_token, followers_count, followers
          FROM facebook_pages WHERE id = ?
        `).get(existing.id) as {
          id: string
          user_id: string
          meta_page_id: string
          page_access_token: string | null
          followers_count: number | null
          followers: string
        }
        if (row) {
          row.page_access_token = page.accessToken ?? row.page_access_token
          await syncPageFollowers(row)
        }
      }
      connected.push(existing.id)
      ensurePageAutomationSettings(existing.id)
      continue
    }

    const id = uuid()
    db.prepare(`
      INSERT INTO facebook_pages (id, user_id, agency_id, facebook_account_id, meta_page_id, name, followers, page_access_token, health_status, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'active')
    `).run(id, userId, agencyId, accountId, page.id, page.name, page.followers ?? '0', page.accessToken ?? null)
    seedFollowerBaseline(id, page.fanCount)
    ensurePageAutomationSettings(id)
    connected.push(id)
  }

  return connected
}

/** @deprecated */
export async function connectPagesForUser(userId: string, accountId: string, accessToken: string) {
  const agency = db
    .prepare("SELECT agency_id FROM agency_members WHERE user_id = ? AND role = 'owner' LIMIT 1")
    .get(userId) as { agency_id: string } | undefined
  if (!agency) throw new Error('No agency found')
  return connectPagesForAgency(agency.agency_id, userId, accountId, accessToken)
}

export async function publishReelToPage(
  pageId: string,
  metaPageId: string,
  accessToken: string,
  sourceUsername: string,
): Promise<{ postId: string }> {
  const { publishReelVideo } = await import('./publisher.js')
  const page = db.prepare('SELECT page_access_token FROM facebook_pages WHERE id = ?').get(pageId) as
    | { page_access_token: string | null }
    | undefined
  const token = page?.page_access_token ?? accessToken
  return publishReelVideo(metaPageId, token, '', `Reel from ${sourceUsername}`)
}
