import sharp from 'sharp'
import { db } from '../db.js'
import { downloadImageBuffer } from './news/rssFetcher.js'
import { isFacebookConfigured, isMockMetaPageId } from './facebook.js'

const CACHE_MS = 24 * 60 * 60 * 1000

type PageRow = {
  id: string
  agency_id: string | null
  meta_page_id: string
  page_access_token: string | null
  name: string
  profile_picture_url: string | null
  profile_picture_synced_at: string | null
}

async function createInitialsAvatar(name: string, size: number): Promise<Buffer> {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials =
    parts.length >= 2
      ? `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
      : (parts[0]?.slice(0, 2).toUpperCase() ?? '?')
  const hue = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="hsl(${hue}, 42%, 32%)"/>
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${Math.round(size * 0.38)}" font-weight="700" fill="#FFFFFF">${initials}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export async function fetchPageProfilePictureUrl(
  agencyId: string,
  metaPageId: string,
  pageAccessToken: string | null,
): Promise<string | null> {
  const isMock =
    isMockMetaPageId(metaPageId) ||
    !isFacebookConfigured(agencyId) ||
    !pageAccessToken ||
    pageAccessToken.startsWith('mock_')

  if (isMock) return null

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${metaPageId}/picture?type=large&redirect=0&access_token=${encodeURIComponent(pageAccessToken)}`,
  )
  const data = (await res.json()) as {
    data?: { url?: string; is_silhouette?: boolean }
    error?: { message: string }
  }
  if (data.error) throw new Error(data.error.message)
  if (!data.data?.url || data.data.is_silhouette) return null
  return data.data.url
}

export async function resolvePageProfilePictureBuffer(pageId: string): Promise<Buffer> {
  const page = db
    .prepare(`
      SELECT id, agency_id, meta_page_id, page_access_token, name,
             profile_picture_url, profile_picture_synced_at
      FROM facebook_pages WHERE id = ?
    `)
    .get(pageId) as PageRow | undefined

  if (!page) {
    return createInitialsAvatar('Page', 256)
  }

  const agencyId = page.agency_id ?? ''
  const syncedAt = page.profile_picture_synced_at ? Date.parse(page.profile_picture_synced_at) : 0
  const cacheValid = Boolean(page.profile_picture_url) && Date.now() - syncedAt < CACHE_MS

  let url = cacheValid ? page.profile_picture_url : null

  if (!url) {
    try {
      url = await fetchPageProfilePictureUrl(agencyId, page.meta_page_id, page.page_access_token)
      if (url) {
        db.prepare(`
          UPDATE facebook_pages
          SET profile_picture_url = ?, profile_picture_synced_at = datetime('now')
          WHERE id = ?
        `).run(url, pageId)
      }
    } catch (err) {
      console.warn(`[pagePicture] Graph fetch failed for page ${pageId}:`, err)
    }
  }

  if (url) {
    const buf = await downloadImageBuffer(url)
    if (buf) return buf
  }

  return createInitialsAvatar(page.name, 256)
}
