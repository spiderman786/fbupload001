export function buildAgencyWorkspaceUrl(subdomain: string | null | undefined, path = '/agency'): string | null {
  const cleanSubdomain = subdomain?.trim().toLowerCase()
  if (!cleanSubdomain || typeof window === 'undefined') return null

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const host = window.location.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1') return normalizedPath

  const parts = host.split('.')
  const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : host
  const targetHost = `${cleanSubdomain}.${baseDomain}`

  if (host === targetHost) return normalizedPath
  return `${window.location.protocol}//${targetHost}${normalizedPath}`
}

export function goToAgencyWorkspace(subdomain: string | null | undefined, fallbackPath = '/agency') {
  const target = buildAgencyWorkspaceUrl(subdomain, fallbackPath)
  if (!target) {
    window.location.assign(fallbackPath)
    return
  }

  if (target.startsWith('/')) {
    window.location.assign(target)
    return
  }

  window.location.assign(target)
}
