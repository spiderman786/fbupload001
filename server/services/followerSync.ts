import { db } from '../db.js'
import { formatFollowersCount, parseFollowers } from '../utils/followers.js'
import { isFacebookConfigured } from './facebook.js'

type PageRow = {
  id: string
  user_id: string
  agency_id?: string | null
  meta_page_id: string
  page_access_token: string | null
  followers_count: number | null
  followers: string
}

export function applyFollowerCount(pageId: string, count: number) {
  const row = db.prepare('SELECT followers_baseline FROM facebook_pages WHERE id = ?').get(pageId) as
    | { followers_baseline: number | null }
    | undefined

  const baseline = row?.followers_baseline ?? count
  const gained = count - baseline

  db.prepare(`
    UPDATE facebook_pages SET
      followers = ?,
      followers_count = ?,
      followers_baseline = ?,
      followers_gained = ?,
      last_followers_sync_at = datetime('now')
    WHERE id = ?
  `).run(formatFollowersCount(count), count, baseline, gained, pageId)
}

export async function fetchPageFanCount(
  agencyId: string,
  metaPageId: string,
  pageAccessToken: string | null,
  stored?: { followers_count: number | null; followers: string },
): Promise<number> {
  const isMock = !isFacebookConfigured(agencyId) || pageAccessToken?.startsWith('mock_')

  if (isMock) {
    const current =
      stored?.followers_count ?? parseFollowers(stored?.followers ?? '0') ?? Math.floor(Math.random() * 20_000 + 1000)
    const delta = Math.floor(Math.random() * 200) - 40
    return Math.max(0, current + delta)
  }

  if (!pageAccessToken) {
    throw new Error('Page access token missing — reconnect Facebook account')
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${metaPageId}?fields=fan_count&access_token=${encodeURIComponent(pageAccessToken)}`,
  )
  const data = (await res.json()) as { fan_count?: number; error?: { message: string } }
  if (data.error) throw new Error(data.error.message)
  return data.fan_count ?? 0
}

export async function syncPageFollowers(page: PageRow): Promise<{ ok: boolean; error?: string }> {
  try {
    const agencyId =
      page.agency_id ??
      (db.prepare('SELECT agency_id FROM facebook_pages WHERE id = ?').get(page.id) as { agency_id: string } | undefined)
        ?.agency_id ??
      page.user_id

    const count = await fetchPageFanCount(agencyId, page.meta_page_id, page.page_access_token, {
      followers_count: page.followers_count,
      followers: page.followers,
    })
    applyFollowerCount(page.id, count)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Sync failed' }
  }
}

import { FOLLOWER_SYNC_BATCH_SIZE } from '../utils/pagination.js'

export async function syncAgencyFollowers(agencyId: string, options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? FOLLOWER_SYNC_BATCH_SIZE
  const offset = options?.offset ?? 0

  const pages = db
    .prepare(`
      SELECT id, user_id, agency_id, meta_page_id, page_access_token, followers_count, followers
      FROM facebook_pages WHERE agency_id = ?
      ORDER BY id
      LIMIT ? OFFSET ?
    `)
    .all(agencyId, limit, offset) as PageRow[]

  const total = db
    .prepare('SELECT COUNT(*) as count FROM facebook_pages WHERE agency_id = ?')
    .get(agencyId) as { count: number }

  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const page of pages) {
    const result = await syncPageFollowers(page)
    if (result.ok) synced++
    else {
      failed++
      if (result.error && !errors.includes(result.error)) errors.push(result.error)
    }
  }

  const lastSync = db
    .prepare('SELECT MAX(last_followers_sync_at) as t FROM facebook_pages WHERE agency_id = ?')
    .get(agencyId) as { t: string | null }

  return {
    synced,
    failed,
    errors,
    lastFollowersSyncAt: lastSync?.t ?? null,
    totalPages: total.count,
    batchOffset: offset,
    hasMore: offset + pages.length < total.count,
  }
}

/** @deprecated */
export async function syncUserFollowers(userId: string) {
  const agency = db
    .prepare("SELECT agency_id FROM agency_members WHERE user_id = ? AND role = 'owner' LIMIT 1")
    .get(userId) as { agency_id: string } | undefined
  if (!agency) return { synced: 0, failed: 0, errors: [] as string[], lastFollowersSyncAt: null }
  return syncAgencyFollowers(agency.agency_id)
}

export async function syncAllUsersFollowers() {
  const agencies = db.prepare('SELECT DISTINCT agency_id FROM facebook_pages WHERE agency_id IS NOT NULL').all() as {
    agency_id: string
  }[]
  for (const { agency_id } of agencies) {
    await syncAgencyFollowers(agency_id)
  }
}

export function seedFollowerBaseline(pageId: string, count: number) {
  db.prepare(`
    UPDATE facebook_pages SET
      followers_count = ?,
      followers_baseline = ?,
      followers_gained = 0,
      followers = ?,
      last_followers_sync_at = datetime('now')
    WHERE id = ?
  `).run(count, count, formatFollowersCount(count), pageId)
}
