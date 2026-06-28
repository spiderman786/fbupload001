import { db } from '../db.js'
import { isFacebookConfiguredForAgency } from './byoc.js'
import { isMockMetaPageId } from './facebook.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

export function isOAuthTokenError(message: string): boolean {
  return /invalid.*token|190\b|oauth|session.*expired|access token|token.*expired|error validating access token|cannot parse access token/i.test(
    message,
  )
}

type PageTokenRow = {
  meta_page_id: string
  page_access_token: string | null
  facebook_account_id: string | null
  agency_id: string
  status: string
}

function loadPageRow(pageId: string): PageTokenRow | null {
  return (
    db
      .prepare(`
        SELECT meta_page_id, page_access_token, facebook_account_id, agency_id, status
        FROM facebook_pages WHERE id = ?
      `)
      .get(pageId) as PageTokenRow | undefined
  ) ?? null
}

function loadUserAccessToken(facebookAccountId: string | null): string | null {
  if (!facebookAccountId) return null
  const account = db
    .prepare('SELECT access_token FROM facebook_accounts WHERE id = ?')
    .get(facebookAccountId) as { access_token: string } | undefined
  const token = account?.access_token?.trim()
  return token || null
}

async function fetchPageTokenFromGraph(metaPageId: string, userAccessToken: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${metaPageId}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`,
  )
  const data = (await res.json()) as { access_token?: string; error?: { message: string } }
  if (!data.access_token) throw new Error(data.error?.message ?? 'Could not get page access token')
  return data.access_token.trim()
}

/** Block RSS/reel publish when a demo page is used with a real Facebook app configured. */
export function assertPublishableFacebookPage(
  pageId: string,
  agencyId: string,
): { metaPageId: string; name: string } {
  const row = db
    .prepare('SELECT meta_page_id, name FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(pageId, agencyId) as { meta_page_id: string; name: string } | undefined
  if (!row) throw new Error('Facebook page not found')

  if (isFacebookConfiguredForAgency(agencyId) && isMockMetaPageId(row.meta_page_id)) {
    throw new Error(
      `"${row.name}" is a demo page and cannot publish to Facebook. Reassign the RSS feed to a real page connected under Facebook → Accounts (for example SonaBilal00012345678908 or Fiaz malik 1).`,
    )
  }

  return { metaPageId: row.meta_page_id, name: row.name }
}

/** Resolve a page token for Graph API calls; optionally force refresh from the linked Facebook account. */
export async function resolvePageAccessToken(
  pageId: string,
  options?: { agencyId?: string; refresh?: boolean },
): Promise<{ metaPageId: string; token: string } | null> {
  const row = loadPageRow(pageId)
  if (!row || row.status !== 'active') return null
  if (options?.agencyId && row.agency_id !== options.agencyId) return null

  const stored = row.page_access_token?.trim()
  if (stored && !options?.refresh && stored.length > 20 && !stored.startsWith('mock_')) {
    return { metaPageId: row.meta_page_id, token: stored }
  }

  return refreshPageAccessToken(pageId, options?.agencyId)
}

/** Fetch a fresh page access token from Meta and persist it on the page row. */
export async function refreshPageAccessToken(
  pageId: string,
  agencyId?: string,
): Promise<{ metaPageId: string; token: string } | null> {
  const row = loadPageRow(pageId)
  if (!row || row.status !== 'active') return null
  if (agencyId && row.agency_id !== agencyId) return null
  if (isFacebookConfiguredForAgency(row.agency_id) && isMockMetaPageId(row.meta_page_id)) return null

  const userToken = loadUserAccessToken(row.facebook_account_id)
  if (!userToken) return null

  if (userToken === 'mock_token') {
    const mock = `mock_page_token_${row.meta_page_id}`
    db.prepare('UPDATE facebook_pages SET page_access_token = ? WHERE id = ?').run(mock, pageId)
    return { metaPageId: row.meta_page_id, token: mock }
  }

  try {
    const token = await fetchPageTokenFromGraph(row.meta_page_id, userToken)
    db.prepare(`
      UPDATE facebook_pages SET page_access_token = ?, health_status = 'completed' WHERE id = ?
    `).run(token, pageId)
    return { metaPageId: row.meta_page_id, token }
  } catch {
    return null
  }
}
