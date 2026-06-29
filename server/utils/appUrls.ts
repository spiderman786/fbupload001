/** Shared app URL helpers for agency subdomains and OAuth callbacks. */

export function getAppBaseDomain(): string | null {
  return process.env.APP_BASE_DOMAIN?.trim() || process.env.PUBLIC_APP_BASE_DOMAIN?.trim() || null
}

export function cookieDomain(): string | undefined {
  const base = getAppBaseDomain()
  if (process.env.NODE_ENV === 'production' && base) return `.${base}`
  return undefined
}

export function clientBaseUrl(): string {
  return (process.env.CLIENT_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

export function buildAgencyOAuthCallbackUrl(subdomain: string): string | null {
  const base = getAppBaseDomain()
  if (!base || !subdomain.trim()) return null
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return `${protocol}://${subdomain.trim().toLowerCase()}.${base}/facebook/callback`
}

export function buildAppOAuthCallbackUrl(): string {
  const base = getAppBaseDomain()
  if (base) return `https://app.${base}/facebook/callback`
  return `${clientBaseUrl()}/facebook/callback`
}

export function buildMagicConnectUrls(
  token: string,
  agencySubdomain: string | null,
): {
  url: string
  appUrl: string
  agencyCallbackUrl: string | null
  appCallbackUrl: string
  agencySubdomain: string | null
} {
  const appUrl = `${clientBaseUrl()}/facebook/connect/${token}`
  const appCallbackUrl = buildAppOAuthCallbackUrl()
  const agencyCallbackUrl = agencySubdomain ? buildAgencyOAuthCallbackUrl(agencySubdomain) : null

  let url = appUrl
  if (agencySubdomain && agencyCallbackUrl) {
    url = agencyCallbackUrl.replace('/facebook/callback', `/facebook/connect/${token}`)
  }

  return {
    url,
    appUrl,
    agencyCallbackUrl,
    appCallbackUrl,
    agencySubdomain: agencySubdomain?.trim().toLowerCase() ?? null,
  }
}
