/**
 * Webshare / rotating proxy for yt-dlp (reel discovery + download).
 * Used as fallback after a direct request fails — see ytdlpRunner.ts.
 */

export function isProxyConfigured(): boolean {
  if (process.env.WEBSHARE_PROXY_ENABLED === 'false') return false
  return getYtDlpProxyUrl() !== null
}

export function getYtDlpProxyUrl(): string | null {
  const direct = process.env.DOWNLOAD_PROXY_URL?.trim() || process.env.WEBSHARE_PROXY_URL?.trim()
  if (direct) return direct

  const host = process.env.WEBSHARE_PROXY_HOST?.trim()
  const port = process.env.WEBSHARE_PROXY_PORT?.trim() ?? '80'
  const user = process.env.WEBSHARE_PROXY_USERNAME?.trim()
  const pass = process.env.WEBSHARE_PROXY_PASSWORD?.trim()

  if (!host || !user || !pass) return null

  const encodedUser = encodeURIComponent(user)
  const encodedPass = encodeURIComponent(pass)
  return `http://${encodedUser}:${encodedPass}@${host}:${port}`
}

export function getYtDlpProxyArgs(): string[] {
  const url = getYtDlpProxyUrl()
  return url ? ['--proxy', url] : []
}
