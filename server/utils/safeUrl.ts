/** Block SSRF to localhost and private networks for user-supplied fetch URLs. */
export function assertSafeExternalUrl(urlString: string): URL {
  let parsed: URL
  try {
    parsed = new URL(urlString.trim())
  } catch {
    throw new Error('Invalid URL')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed')
  }

  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    host === '::1'
  ) {
    throw new Error('Internal URLs are not allowed')
  }

  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    throw new Error('Internal URLs are not allowed')
  }

  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Internal URLs are not allowed')
  }

  return parsed
}
