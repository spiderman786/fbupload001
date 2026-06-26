import Parser from 'rss-parser'
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

const SKIP_IMAGE_RE = /logo|icon|avatar|sprite|pixel|1x1|badge|emoji|gravatar/i

function pickImage(item: Parser.Item): string | null {
  const enclosure = item.enclosure
  if (enclosure?.url && (enclosure.type?.startsWith('image/') || !enclosure.type)) {
    return enclosure.url
  }

  const media = (item as Record<string, unknown>)['media:content'] as { $?: { url?: string } } | undefined
  if (media?.$?.url) return media.$.url

  const mediaThumb = (item as Record<string, unknown>)['media:thumbnail'] as { $?: { url?: string } } | undefined
  if (mediaThumb?.$?.url) return mediaThumb.$.url

  const content = item.content ?? item['content:encoded'] ?? item.summary ?? ''
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (imgMatch?.[1]) return imgMatch[1]

  return null
}

export async function fetchRssFeed(url: string): Promise<RssArticle[]> {
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
    const res = await fetch(articleUrl, {
      headers: { 'User-Agent': 'FBUploadPro-NewsBot/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []

    const html = await res.text()
    const found: string[] = []

    const ogMatch = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)
    if (ogMatch?.[1]) found.push(resolveUrl(articleUrl, ogMatch[1]))

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
