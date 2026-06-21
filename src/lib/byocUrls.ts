const DEFAULT_BASE_DOMAIN = 'fbuploadplus.com'

export function resolveAppBaseDomain(): string {
  if (typeof window === 'undefined') return DEFAULT_BASE_DOMAIN
  const host = window.location.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1') return DEFAULT_BASE_DOMAIN
  const parts = host.split('.')
  if (parts.length >= 2) return parts.slice(-2).join('.')
  return DEFAULT_BASE_DOMAIN
}

/** OAuth callback URLs this agency must whitelist in Meta Developer. */
export function getAgencyOAuthRedirectUris(subdomain?: string | null): string[] {
  const base = resolveAppBaseDomain()
  const uris = [`https://app.${base}/facebook/callback`]
  if (subdomain?.trim()) {
    uris.push(`https://${subdomain.trim().toLowerCase()}.${base}/facebook/callback`)
  }
  return [...new Set(uris)]
}

export function primaryOAuthRedirectUri(subdomain?: string | null): string {
  const uris = getAgencyOAuthRedirectUris(subdomain)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase()
    const match = uris.find((u) => {
      try {
        return new URL(u).hostname === host
      } catch {
        return false
      }
    })
    if (match) return match
  }
  return uris[0]
}
