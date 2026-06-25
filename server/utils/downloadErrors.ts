/** Turn yt-dlp stderr into plain language — never mention browser cookies to users. */

export function userFacingDownloadError(message: string, platform = ''): string {
  const lower = message.toLowerCase()
  const p = platform.toLowerCase()

  if (
    /login|log in|cookie|session|sign in|authentication required|checkpoint|consent/i.test(lower)
  ) {
    return `Add download proxies under Settings → Download Proxies (paste your list and upload). That is all you need for ${p || 'Instagram'} — no browser setup.`
  }

  if (/rate limit|429|too many requests|blocked|forbidden|403|ip ban/i.test(lower)) {
    return `Download blocked from this server IP — upload fresh proxies under Settings → Download Proxies, then click Enable & retry on this page.`
  }

  if (/proxy|all proxies failed/i.test(lower)) {
    return `Proxies could not reach ${p || 'the source'} — check Settings → Download Proxies (valid http://user:pass@host:port lines).`
  }

  if (/yt-dlp is not available|enoent.*yt-dlp/i.test(lower)) {
    return 'Video downloader is not running on the server — contact support.'
  }

  const trimmed = message.replace(/\s+/g, ' ').trim()
  if (trimmed.length > 220) return `${trimmed.slice(0, 220)}…`
  return trimmed || 'Could not download reel from source'
}

export function needsDownloadProxies(message: string): boolean {
  const lower = message.toLowerCase()
  return /login|cookie|session|blocked|403|429|proxy|forbidden|rate limit/i.test(lower)
}
