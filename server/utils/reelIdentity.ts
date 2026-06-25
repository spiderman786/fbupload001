/** Shared reel URL / ID normalization for discovery, download, and dedup. */

export function isMockSourceUrl(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith('mock://'))
}

export function facebookFeedUrls(username: string): string[] {
  const handle = username.replace(/^@/, '')
  if (/^\d+$/.test(handle)) {
    return [
      `https://www.facebook.com/profile.php?id=${handle}&sk=reels_tab`,
      `https://www.facebook.com/${handle}/reels/`,
      `https://m.facebook.com/profile.php?id=${handle}&sk=reels_tab`,
    ]
  }
  return [`https://www.facebook.com/${handle}/reels/`]
}

export function platformFeedUrl(platform: string, username: string): string {
  const handle = username.replace(/^@/, '')
  switch (platform.toLowerCase()) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/reels/`
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`
    case 'youtube':
      return `https://www.youtube.com/@${handle}/shorts`
    case 'facebook':
      return facebookFeedUrls(username)[0]!
    default:
      return handle
  }
}

/** All feed URLs to try when listing reels (Facebook often needs alternates). */
export function platformFeedUrls(platform: string, username: string): string[] {
  if (platform.toLowerCase() === 'facebook') return facebookFeedUrls(username)
  return [platformFeedUrl(platform, username)]
}

function extractFromUrl(url: string, pattern: RegExp): string | null {
  const match = url.match(pattern)
  return match?.[1] ?? null
}

export function normalizeSourceReelId(
  platform: string,
  reelId: string,
  sourceUrl?: string | null,
): string {
  const id = reelId.trim()
  const url = sourceUrl?.trim() ?? ''
  const p = platform.toLowerCase()

  if (p === 'facebook') {
    const fromUrl =
      extractFromUrl(url, /facebook\.com\/reel\/(\d+)/i) ??
      extractFromUrl(url, /[?&]v=(\d+)/i) ??
      extractFromUrl(url, /video_id=(\d+)/i) ??
      extractFromUrl(url, /\/(\d{10,})\/?(?:[?#]|$)/i)
    if (fromUrl) return fromUrl
    const fromId = id.match(/(\d{10,})/)?.[1]
    return fromId ?? id
  }

  if (p === 'instagram') {
    return extractFromUrl(url, /instagram\.com\/(?:reel|p)\/([^/?#]+)/i) ?? id
  }

  if (p === 'tiktok') {
    return extractFromUrl(url, /video\/(\d+)/i) ?? id
  }

  if (p === 'youtube') {
    return extractFromUrl(url, /(?:shorts|watch\?v=)\/([^/?#&]+)/i) ?? id
  }

  return id
}

export function canonicalSourceUrl(platform: string, reelId: string, sourceUrl?: string | null): string {
  const url = sourceUrl?.trim()
  if (url && !isMockSourceUrl(url)) return url

  const id = normalizeSourceReelId(platform, reelId, url)
  switch (platform.toLowerCase()) {
    case 'facebook':
      return `https://www.facebook.com/reel/${id}`
    case 'instagram':
      return `https://www.instagram.com/reel/${id}/`
    case 'tiktok':
      return `https://www.tiktok.com/video/${id}`
    case 'youtube':
      return `https://www.youtube.com/shorts/${id}`
    default:
      return url ?? id
  }
}

/** Alternate download URLs to try when the feed listing URL fails (Facebook often needs this). */
export function downloadUrlCandidates(
  platform: string,
  reelId: string,
  sourceUrl?: string | null,
): string[] {
  const primary = canonicalSourceUrl(platform, reelId, sourceUrl)
  const seen = new Set<string>()
  const out: string[] = []

  for (const url of [sourceUrl?.trim(), primary].filter(Boolean) as string[]) {
    if (isMockSourceUrl(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }

  if (platform.toLowerCase() === 'facebook') {
    const id = normalizeSourceReelId(platform, reelId, sourceUrl)
    for (const url of [
      `https://www.facebook.com/reel/${id}`,
      `https://www.facebook.com/watch/?v=${id}`,
      `https://www.facebook.com/video.php?v=${id}`,
    ]) {
      if (!seen.has(url)) {
        seen.add(url)
        out.push(url)
      }
    }
  }

  return out
}

export function ytDlpPlatformArgs(platform: string, url: string): string[] {
  const args: string[] = []
  if (platform.toLowerCase() === 'facebook' || url.includes('facebook.com')) {
    args.push('--add-header', 'Referer:https://www.facebook.com/')
    args.push('--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
  }
  const cookiesFile = process.env.YTDLP_COOKIES_FILE ?? process.env.FACEBOOK_COOKIES_FILE
  if (cookiesFile && (platform.toLowerCase() === 'facebook' || url.includes('facebook.com'))) {
    args.push('--cookies', cookiesFile)
  }
  return args
}
