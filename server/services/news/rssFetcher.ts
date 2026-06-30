import Parser from 'rss-parser'
import sharp from 'sharp'
import { assertSafeExternalUrl } from '../../utils/safeUrl.js'
import { normalizeArticleUrl } from './types.js'

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'FBUploadPro-NewsBot/1.0' },
})

export type RssArticle = {
  title: string
  description: string
  link: string
  pubDate: string | null
  imageUrl: string | null
}

const SKIP_IMAGE_RE = /logo|icon|avatar|sprite|pixel|1x1|badge|emoji|gravatar|placeholder|default-featured|site-logo|favicon/i

function imageUrlKey(url: string): string {
  return url.split('?')[0]!.toLowerCase()
}

function extractMetaImage(html: string, articleUrl: string, property: string): string | null {
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i')
  const re3 = new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  const match = html.match(re1) ?? html.match(re2) ?? html.match(re3)
  return match?.[1] ? resolveUrl(articleUrl, match[1]) : null
}

function pickImage(item: Parser.Item): string | null {
  const enclosure = item.enclosure
  if (enclosure?.url && (enclosure.type?.startsWith('image/') || !enclosure.type)) {
    return enclosure.url
  }

  const media = (item as Record<string, unknown>)['media:content'] as { $?: { url?: string } } | undefined
  if (media?.$?.url) return media.$.url

  const mediaThumb = (item as Record<string, unknown>)['media:thumbnail'] as { $?: { url?: string } } | undefined
  if (mediaThumb?.$?.url) return mediaThumb.$.url

  const content = String(item.content ?? (item as Record<string, unknown>)['content:encoded'] ?? item.summary ?? '')
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (imgMatch?.[1]) return imgMatch[1]

  return null
}

export async function fetchRssFeed(url: string): Promise<RssArticle[]> {
  assertSafeExternalUrl(url)
  const feed = await parser.parseURL(url)
  const articles: RssArticle[] = []

  for (const item of feed.items ?? []) {
    const link = item.link ?? item.guid
    if (!link || !item.title) continue

    articles.push({
      title: item.title.trim(),
      description: (item.contentSnippet ?? item.summary ?? item.content ?? '').trim(),
      link: normalizeArticleUrl(link),
      pubDate: item.isoDate ?? item.pubDate ?? null,
      imageUrl: pickImage(item),
    })
  }

  return articles
}

export async function scrapeArticleImages(articleUrl: string): Promise<string[]> {
  try {
    assertSafeExternalUrl(articleUrl)
    const res = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FBUploadPro-NewsBot/1.0; +https://fbuploadplus.com)',
        Accept: 'text/html,application/xhtml+xml',
        Referer: new URL(articleUrl).origin,
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []

    const html = await res.text()
    const found: string[] = []

    for (const prop of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
      const url = extractMetaImage(html, articleUrl, prop)
      if (url && !SKIP_IMAGE_RE.test(url) && !found.includes(url)) found.push(url)
    }

    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let jsonLd: RegExpExecArray | null
    while ((jsonLd = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(jsonLd[1]!) as { image?: string | { url?: string } | Array<string | { url?: string }> }
        const images = Array.isArray(data.image) ? data.image : data.image ? [data.image] : []
        for (const img of images) {
          const src = typeof img === 'string' ? img : img?.url
          if (src && !SKIP_IMAGE_RE.test(src)) {
            const resolved = resolveUrl(articleUrl, src)
            if (!found.includes(resolved)) found.push(resolved)
          }
        }
      } catch {
        /* ignore malformed JSON-LD */
      }
    }

    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi
    let m: RegExpExecArray | null
    while ((m = imgRegex.exec(html)) !== null) {
      const src = resolveUrl(articleUrl, m[1]!)
      if (!src || SKIP_IMAGE_RE.test(src)) continue
      if (!found.includes(src)) found.push(src)
    }

    return dedupeImages(found).slice(0, 6)
  } catch {
    return []
  }
}

function resolveUrl(base: string, src: string): string {
  try {
    return new URL(src, base).toString()
  } catch {
    return src
  }
}

function dedupeImages(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const key = u.split('?')[0]!
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

export function upgradeImageUrl(url: string): string {
  let upgraded = url.trim()
  try {
    const u = new URL(upgraded)
    for (const key of ['w', 'width', 'h', 'height', 'resize', 'quality']) {
      u.searchParams.delete(key)
    }
    upgraded = u.toString()
  } catch {
    /* keep original */
  }
  return upgraded.replace(/-\d+x\d+(\.(jpe?g|png|webp))/i, '$1')
}

async function imagePixelArea(url: string): Promise<number> {
  const buf = await downloadImageBuffer(upgradeImageUrl(url))
  if (!buf) return 0
  try {
    const meta = await sharp(buf).metadata()
    return (meta.width ?? 0) * (meta.height ?? 0)
  } catch {
    return 0
  }
}

export async function selectBestHeroAndInset(
  imageUrls: string[],
  avoidUrls: Set<string> = new Set(),
): Promise<{ hero: string | null; inset: string | null }> {
  const unique = dedupeImages(imageUrls.filter(Boolean).map(upgradeImageUrl))
  if (unique.length === 0) return { hero: null, inset: null }
  if (unique.length === 1) return { hero: unique[0]!, inset: unique[0]! }

  const ranked = await Promise.all(
    unique.slice(0, 8).map(async (url) => ({ url, area: await imagePixelArea(url), key: imageUrlKey(url) })),
  )
  ranked.sort((a, b) => b.area - a.area)

  const hero =
    ranked.find((r) => !avoidUrls.has(r.key))?.url ??
    ranked.find((r) => r.url !== ranked[0]?.url)?.url ??
    ranked[0]?.url ??
    unique[0]!
  const inset = ranked.find((r) => r.url !== hero)?.url ?? ranked[1]?.url ?? hero
  return { hero, inset }
}

export function selectHeroAndInset(imageUrls: string[]): { hero: string | null; inset: string | null } {
  const unique = dedupeImages(imageUrls.filter(Boolean))
  if (unique.length === 0) return { hero: null, inset: null }
  if (unique.length === 1) return { hero: unique[0]!, inset: unique[0]! }
  return { hero: unique[0]!, inset: unique[1]! }
}

export async function downloadImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FBUploadPro-NewsBot/1.0' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return null
    return buf
  } catch {
    return null
  }
}
