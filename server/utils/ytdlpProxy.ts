/**
 * Legacy single-proxy config (Webshare) — also folded into proxy pool when set.
 */

export function isLegacyProxyConfigured(): boolean {
  if (process.env.WEBSHARE_PROXY_ENABLED === 'false') return false
  return getLegacySingleProxyUrl() !== null
}

/** @deprecated use proxy pool — kept for backwards compatibility */
export function isProxyConfigured(): boolean {
  return isLegacyProxyConfigured()
}

export function getLegacySingleProxyUrl(): string | null {
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

export function proxyArgsForUrl(url: string): string[] {
  return url ? ['--proxy', url] : []
}

/** @deprecated */
export function getYtDlpProxyArgs(): string[] {
  const url = getLegacySingleProxyUrl()
  return proxyArgsForUrl(url ?? '')
}
