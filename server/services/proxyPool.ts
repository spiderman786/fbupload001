import fs from 'fs'
import path from 'path'
import { getLegacySingleProxyUrl } from '../utils/ytdlpProxy.js'

export type ProxyPoolEntry = {
  id: string
  url: string
  label: string
  failures: number
  successes: number
  cooldownUntil: number
  lastUsedAt: number
}

export type ProxyPoolStats = {
  enabled: boolean
  poolSize: number
  availableNow: number
  directFirst: boolean
  maxAttemptsPerJob: number
  cooldownMs: number
  filePath: string
  fileExists: boolean
  fileLastModified: string | null
  proxies: {
    id: string
    label: string
    failures: number
    successes: number
    available: boolean
    cooldownUntil: string | null
    lastUsedAt: string | null
  }[]
}

export type ProxyPoolFileInfo = {
  filePath: string
  exists: boolean
  proxyCount: number
  invalidLines: number
  lastModified: string | null
  fileSize: number
}

export type ProxyUploadResult = {
  count: number
  invalid: number
  duplicates: number
  filePath: string
  stats: ProxyPoolStats
}

const entries: ProxyPoolEntry[] = []
let roundRobinIndex = 0
let initialized = false
let loadedFileMtime = 0

/** Default on-disk pool (same folder as DATABASE_PATH). */
export function getManagedProxyPoolPath(): string {
  const configured = process.env.PROXY_POOL_FILE?.trim()
  if (configured) return configured

  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'fbuploadpro.db')
  return path.join(path.dirname(dbPath), 'proxy-pool.txt')
}

function splitProxyLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/** Accept full URLs, user:pass@host:port, or host:port:user:pass (Webshare export). */
export function normalizeProxyLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  if (/^(https?|socks5):\/\//i.test(trimmed)) {
    try {
      new URL(trimmed)
      return trimmed
    } catch {
      return null
    }
  }

  if (trimmed.includes('@')) {
    const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`
    try {
      new URL(withScheme)
      return withScheme
    } catch {
      return null
    }
  }

  const parts = trimmed.split(':')
  if (parts.length >= 4) {
    const host = parts[0]?.trim()
    const port = parts[1]?.trim()
    const user = parts[2]?.trim()
    const pass = parts.slice(3).join(':').trim()
    if (!host || !port || !user || !pass) return null
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
  }

  return null
}

export function parseAndNormalizeProxyContent(raw: string): { urls: string[]; invalid: number; duplicates: number } {
  const seen = new Set<string>()
  const urls: string[] = []
  let invalid = 0

  for (const line of splitProxyLines(raw)) {
    const normalized = normalizeProxyLine(line)
    if (!normalized) {
      invalid++
      continue
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  const rawLineCount = splitProxyLines(raw).length
  const duplicates = Math.max(0, rawLineCount - invalid - urls.length)

  return { urls, invalid, duplicates }
}

function parseProxyList(raw: string): string[] {
  return parseAndNormalizeProxyContent(raw).urls
}

function loadProxyUrlsFromEnv(): string[] {
  const urls = new Set<string>()

  const pool = process.env.DOWNLOAD_PROXY_POOL?.trim()
  if (pool) {
    for (const url of parseProxyList(pool)) urls.add(url)
  }

  const filePath = getManagedProxyPoolPath()
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const url of parseProxyList(content)) urls.add(url)
  }

  const legacy = getLegacySingleProxyUrl()
  if (legacy) urls.add(legacy)

  return [...urls]
}

function proxyLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return 'proxy'
  }
}

function cooldownMs(): number {
  return Number(process.env.PROXY_COOLDOWN_MS ?? 5 * 60 * 1000)
}

function maxFailuresBeforeCooldown(): number {
  return Number(process.env.PROXY_MAX_FAILURES_BEFORE_COOLDOWN ?? 2)
}

export function isProxyPoolEnabled(): boolean {
  if (process.env.PROXY_POOL_ENABLED === 'false') return false
  initProxyPool()
  return entries.length > 0
}

export function isDirectFirst(): boolean {
  return process.env.PROXY_DIRECT_FIRST !== 'false'
}

export function maxAttemptsPerJob(): number {
  const configured = Number(process.env.PROXY_MAX_ATTEMPTS_PER_JOB ?? 50)
  initProxyPool()
  if (!entries.length) return 0
  return Math.min(Math.max(1, configured), entries.length)
}

function readManagedFileMtime(): number {
  const filePath = getManagedProxyPoolPath()
  if (!fs.existsSync(filePath)) return 0
  return fs.statSync(filePath).mtimeMs
}

/** Reload when proxy-pool.txt changes (Web + Worker share volume on Railway). */
export function reloadProxyPoolIfNeeded(): void {
  const mtime = readManagedFileMtime()
  if (mtime !== loadedFileMtime) {
    reloadProxyPool()
  }
}

export function reloadProxyPool(): void {
  initialized = false
  roundRobinIndex = 0
  initProxyPool()
}

export function initProxyPool(): void {
  if (initialized) return
  initialized = true
  loadedFileMtime = readManagedFileMtime()

  const urls = loadProxyUrlsFromEnv()
  entries.length = 0

  urls.forEach((url, index) => {
    entries.push({
      id: String(index),
      url,
      label: proxyLabel(url),
      failures: 0,
      successes: 0,
      cooldownUntil: 0,
      lastUsedAt: 0,
    })
  })

  if (entries.length) {
    console.log(`[proxy-pool] loaded ${entries.length} proxy/proxies from ${getManagedProxyPoolPath()}`)
  }
}

export function saveProxyPoolFromUpload(rawContent: string): ProxyUploadResult {
  const { urls, invalid, duplicates } = parseAndNormalizeProxyContent(rawContent)
  if (!urls.length) {
    throw new Error('No valid proxy lines found. Use http://user:pass@host:port or host:port:user:pass per line.')
  }

  const filePath = getManagedProxyPoolPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(`${filePath}`, `${urls.join('\n')}\n`, 'utf8')
  process.env.PROXY_POOL_FILE = filePath

  reloadProxyPool()

  return {
    count: urls.length,
    invalid,
    duplicates,
    filePath,
    stats: getProxyPoolStats(),
  }
}

export function getProxyPoolFileInfo(): ProxyPoolFileInfo {
  reloadProxyPoolIfNeeded()
  const filePath = getManagedProxyPoolPath()
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      exists: false,
      proxyCount: entries.length,
      invalidLines: 0,
      lastModified: null,
      fileSize: 0,
    }
  }

  const stat = fs.statSync(filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const parsed = parseAndNormalizeProxyContent(content)

  return {
    filePath,
    exists: true,
    proxyCount: parsed.urls.length,
    invalidLines: parsed.invalid,
    lastModified: stat.mtime.toISOString(),
    fileSize: stat.size,
  }
}

function isAvailable(entry: ProxyPoolEntry, now: number): boolean {
  return entry.cooldownUntil <= now
}

/** Round-robin list of proxies to try for one yt-dlp job. */
export function getProxiesForJob(limit = maxAttemptsPerJob()): ProxyPoolEntry[] {
  reloadProxyPoolIfNeeded()
  initProxyPool()
  if (!entries.length || limit <= 0) return []

  const now = Date.now()
  const available = entries.filter((e) => isAvailable(e, now))
  if (!available.length) {
    // All cooling down — pick least recently cooled as last resort
    return [...entries]
      .sort((a, b) => a.cooldownUntil - b.cooldownUntil)
      .slice(0, limit)
  }

  const start = roundRobinIndex % available.length
  roundRobinIndex = (roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER

  const ordered: ProxyPoolEntry[] = []
  for (let i = 0; i < available.length && ordered.length < limit; i++) {
    ordered.push(available[(start + i) % available.length]!)
  }
  return ordered
}

export function markProxySuccess(entryId: string): void {
  const entry = entries.find((e) => e.id === entryId)
  if (!entry) return
  entry.successes++
  entry.failures = 0
  entry.cooldownUntil = 0
  entry.lastUsedAt = Date.now()
}

export function markProxyFailure(entryId: string): void {
  const entry = entries.find((e) => e.id === entryId)
  if (!entry) return
  entry.failures++
  entry.lastUsedAt = Date.now()
  if (entry.failures >= maxFailuresBeforeCooldown()) {
    entry.cooldownUntil = Date.now() + cooldownMs()
    entry.failures = 0
    console.warn(`[proxy-pool] ${entry.label} cooling down for ${cooldownMs()}ms`)
  }
}

export function getProxyPoolStats(): ProxyPoolStats {
  reloadProxyPoolIfNeeded()
  initProxyPool()
  const now = Date.now()
  const availableNow = entries.filter((e) => isAvailable(e, now)).length
  const filePath = getManagedProxyPoolPath()
  const fileExists = fs.existsSync(filePath)
  const fileLastModified = fileExists ? fs.statSync(filePath).mtime.toISOString() : null

  return {
    enabled: entries.length > 0 && process.env.PROXY_POOL_ENABLED !== 'false',
    poolSize: entries.length,
    availableNow,
    directFirst: isDirectFirst(),
    maxAttemptsPerJob: maxAttemptsPerJob(),
    cooldownMs: cooldownMs(),
    filePath,
    fileExists,
    fileLastModified,
    proxies: entries.map((e) => ({
      id: e.id,
      label: e.label,
      failures: e.failures,
      successes: e.successes,
      available: isAvailable(e, now),
      cooldownUntil: e.cooldownUntil > now ? new Date(e.cooldownUntil).toISOString() : null,
      lastUsedAt: e.lastUsedAt ? new Date(e.lastUsedAt).toISOString() : null,
    })),
  }
}
