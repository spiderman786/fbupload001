export type ParsedSource = {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'facebook'
  username: string
  sourceUrl: string
}

const RESERVED_IG = new Set(['reel', 'reels', 'p', 'stories', 'explore', 'tv', 'accounts'])

function normalizeUrlInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^(www\.)?(instagram|tiktok|youtube|facebook|youtu)\./i.test(raw) || raw.includes('.com/')) {
    return `https://${raw.replace(/^\/\//, '')}`
  }
  return null
}

export function looksLikeSourceUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  return /^(www\.)?(instagram|tiktok|youtube|facebook|youtu)\./i.test(trimmed) || /\.com\//i.test(trimmed)
}

/** Extract platform + username from a public profile / channel URL. */
export function parseSourceFromUrl(input: string): ParsedSource | null {
  const urlStr = normalizeUrlInput(input)
  if (!urlStr) return null

  try {
    const url = new URL(urlStr)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const segments = path.split('/').filter(Boolean)

    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      const handle = segments[0]
      if (!handle || RESERVED_IG.has(handle.toLowerCase())) return null
      return { platform: 'instagram', username: handle.replace(/^@/, ''), sourceUrl: urlStr }
    }

    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const at = segments.find((s) => s.startsWith('@'))
      if (at) return { platform: 'tiktok', username: at.replace(/^@/, ''), sourceUrl: urlStr }
      if (segments[0]?.toLowerCase() === 't' && url.searchParams.get('u')) {
        const decoded = decodeURIComponent(url.searchParams.get('u')!)
        const inner = parseSourceFromUrl(decoded)
        if (inner) return inner
      }
      return null
    }

    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
      const handleSeg = segments.find((s) => s.startsWith('@'))
      if (handleSeg) {
        return { platform: 'youtube', username: handleSeg, sourceUrl: urlStr }
      }
      if (segments[0] === 'channel' && segments[1]) {
        return { platform: 'youtube', username: segments[1], sourceUrl: urlStr }
      }
      if ((segments[0] === 'c' || segments[0] === 'user') && segments[1]) {
        return { platform: 'youtube', username: segments[1], sourceUrl: urlStr }
      }
      return null
    }

    if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) {
      if (segments[0] === 'profile.php') {
        const id = url.searchParams.get('id')
        if (id) return { platform: 'facebook', username: id, sourceUrl: urlStr }
        return null
      }
      const handle = segments[0]
      if (!handle || ['watch', 'reel', 'reels', 'share', 'pages', 'groups'].includes(handle.toLowerCase())) {
        return null
      }
      return { platform: 'facebook', username: handle, sourceUrl: urlStr }
    }
  } catch {
    return null
  }

  return null
}

export type CsvSourceMapping = {
  metaPageId: string
  sourceUsername: string
  platform: string
  sourceUrl?: string
}

export function parseCsvSourceMappings(
  csvText: string,
  selectedPages: { metaPageId: string }[],
  defaultPlatform: string,
): { rows: CsvSourceMapping[]; errors: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const mapped: CsvSourceMapping[] = []
  const urlOnly: ParsedSource[] = []
  const errors: string[] = []

  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const metaPageId = parts[0]
      const second = parts[1]
      if (looksLikeSourceUrl(second)) {
        const parsed = parseSourceFromUrl(second)
        if (!parsed) {
          errors.push(`Could not parse source URL on line: ${line}`)
          continue
        }
        mapped.push({
          metaPageId,
          sourceUsername: parsed.username,
          platform: parsed.platform,
          sourceUrl: parsed.sourceUrl,
        })
        continue
      }
      mapped.push({
        metaPageId,
        sourceUsername: second.replace(/^@/, ''),
        platform: (parts[2] ?? defaultPlatform).toLowerCase(),
      })
      continue
    }

    if (parts.length === 1 && looksLikeSourceUrl(parts[0]!)) {
      const parsed = parseSourceFromUrl(parts[0]!)
      if (parsed) urlOnly.push(parsed)
      else errors.push(`Could not parse source URL: ${parts[0]}`)
      continue
    }

    if (parts.length === 1 && parts[0] && !looksLikeSourceUrl(parts[0]!)) {
      errors.push(`Expected a source URL, got: ${parts[0]}`)
    }
  }

  if (mapped.length) return { rows: mapped, errors }

  if (urlOnly.length) {
    if (urlOnly.length > selectedPages.length) {
      errors.push(`Too many source URLs (${urlOnly.length}) for selected pages (${selectedPages.length})`)
    }
    const rows = selectedPages.slice(0, urlOnly.length).map((page, i) => {
      const parsed = urlOnly[i]!
      return {
        metaPageId: page.metaPageId,
        sourceUsername: parsed.username,
        platform: parsed.platform,
        sourceUrl: parsed.sourceUrl,
      }
    })
    return { rows, errors }
  }

  return { rows: [], errors }
}
