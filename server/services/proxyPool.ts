import fs from 'fs'
import path from 'path'
import { db, getDatabaseKind } from '../db.js'
import { getLegacySingleProxyUrl } from '../utils/ytdlpProxy.js'
import { testProxyUrls, type ProxyHealthResult } from './proxyHealth.js'

const PROXY_POOL_DB_KEY = 'download_proxy_pool'

export type ProxyPoolEntry = {
  id: string
  url: string
  label: string
  failures: number
  successes: number
  strikes: number
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

export type ProxyPruneResult = {
  kept: number
  removed: number
  aborted: boolean
  results: ProxyHealthResult[]
  stats: ProxyPoolStats
}

const entries: ProxyPoolEntry[] = []
let roundRobinIndex = 0
let initialized = false
let loadedFileMtime = 0
let loadedDbUpdatedAt = 0
let pruneInFlight: Promise<ProxyPruneResult> | null = null

function isPostgresBacked(): boolean {
  return getDatabaseKind() === 'postgres'
}

function readProxyPoolContentFromDb(): { content: string; updatedAtMs: number } | null {
  if (!isPostgresBacked()) return null
  const row = db
    .prepare('SELECT value, updated_at FROM platform_settings WHERE key = ?')
    .get(PROXY_POOL_DB_KEY) as { value: string; updated_at: string } | undefined
  if (!row?.value?.trim()) return null
  const updatedAtMs = Date.parse(row.updated_at)
  return {
    content: row.value,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  }
}

function writeProxyPoolContentToDb(content: string): void {
  if (!isPostgresBacked()) return
  db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(PROXY_POOL_DB_KEY, content)
  const row = db
    .prepare('SELECT updated_at FROM platform_settings WHERE key = ?')
    .get(PROXY_POOL_DB_KEY) as { updated_at: string } | undefined
  const updatedAtMs = row?.updated_at ? Date.parse(row.updated_at) : Date.now()
  loadedDbUpdatedAt = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now()
}

function readProxyPoolFileContent(): string | null {
  const filePath = getManagedProxyPoolPath()
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

function syncProxyPoolContentToDb(content: string): void {
  writeProxyPoolContentToDb(content)
}

function maybeMigrateProxyPoolFileToDb(fileContent: string | null): void {
  if (!isPostgresBacked() || !fileContent?.trim()) return
  if (readProxyPoolContentFromDb()?.content?.trim()) return
  syncProxyPoolContentToDb(fileContent.endsWith('\n') ? fileContent : `${fileContent.trimEnd()}\n`)
}

function strikesMetaPath(): string {
  return `${getManagedProxyPoolPath()}.strikes.json`
}

function loadStrikeCounts(): Record<string, number> {
  const filePath = strikesMetaPath()
  if (!fs.existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveStrikeCounts(strikes: Record<string, number>): void {
  const filePath = strikesMetaPath()
  const cleaned = Object.fromEntries(Object.entries(strikes).filter(([, count]) => count > 0))
  if (!Object.keys(cleaned).length) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8')
}

function removeStrike(url: string): void {
  const strikes = loadStrikeCounts()
  if (!(url in strikes)) return
  delete strikes[url]
  saveStrikeCounts(strikes)
}

export function isAutoPruneEnabled(): boolean {
  return process.env.PROXY_AUTO_PRUNE !== 'false'
}

function removeAfterStrikes(): number {
  return Number(process.env.PROXY_REMOVE_AFTER_STRIKES ?? 3)
}

function writeProxyPoolUrls(urls: string[]): void {
  const content = urls.length ? `${urls.join('\n')}\n` : ''
  const filePath = getManagedProxyPoolPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  process.env.PROXY_POOL_FILE = filePath
  loadedFileMtime = fs.statSync(filePath).mtimeMs
  syncProxyPoolContentToDb(content)
}

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

  const fileContent = readProxyPoolFileContent()
  maybeMigrateProxyPoolFileToDb(fileContent)

  const dbContent = readProxyPoolContentFromDb()?.content ?? null
  const pooledContent = fileContent?.trim() ? fileContent : dbContent
  if (pooledContent?.trim()) {
    for (const url of parseProxyList(pooledContent)) urls.add(url)
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

/** Reload when proxy-pool.txt or Postgres copy changes (split web/worker on Railway). */
export function reloadProxyPoolIfNeeded(): void {
  const fileMtime = readManagedFileMtime()
  const dbUpdatedAt = readProxyPoolContentFromDb()?.updatedAtMs ?? 0
  if (fileMtime !== loadedFileMtime || dbUpdatedAt !== loadedDbUpdatedAt) {
    reloadProxyPool()
  }
}

export function reloadProxyPool(): void {
  initialized = false
  roundRobinIndex = 0
  loadedDbUpdatedAt = readProxyPoolContentFromDb()?.updatedAtMs ?? 0
  initProxyPool()
}

export function initProxyPool(): void {
  if (initialized) return
  initialized = true
  loadedFileMtime = readManagedFileMtime()
  loadedDbUpdatedAt = readProxyPoolContentFromDb()?.updatedAtMs ?? 0

  const urls = loadProxyUrlsFromEnv()
  const strikes = loadStrikeCounts()
  entries.length = 0

  urls.forEach((url, index) => {
    entries.push({
      id: String(index),
      url,
      label: proxyLabel(url),
      failures: 0,
      successes: 0,
      strikes: strikes[url] ?? 0,
      cooldownUntil: 0,
      lastUsedAt: 0,
    })
  })

  if (entries.length) {
    const source = readProxyPoolFileContent()?.trim()
      ? getManagedProxyPoolPath()
      : isPostgresBacked()
        ? 'platform_settings.download_proxy_pool'
        : getManagedProxyPoolPath()
    console.log(`[proxy-pool] loaded ${entries.length} proxy/proxies from ${source}`)
  }
}

export function removeProxyFromPool(url: string, reason?: string): boolean {
  reloadProxyPoolIfNeeded()
  initProxyPool()
  const remaining = entries.map((entry) => entry.url).filter((entryUrl) => entryUrl !== url)
  if (remaining.length === entries.length) return false

  writeProxyPoolUrls(remaining)
  removeStrike(url)
  reloadProxyPool()
  console.warn(`[proxy-pool] removed dead proxy ${proxyLabel(url)}${reason ? ` (${reason})` : ''}`)
  return true
}

export async function pruneDeadProxies(): Promise<ProxyPruneResult> {
  if (pruneInFlight) return pruneInFlight

  pruneInFlight = (async () => {
    reloadProxyPoolIfNeeded()
    initProxyPool()

    const urls = entries.map((entry) => entry.url)
    if (!urls.length) {
      return { kept: 0, removed: 0, aborted: false, results: [], stats: getProxyPoolStats() }
    }

    const results = await testProxyUrls(urls)
    const working = results.filter((result) => result.ok).map((result) => result.url)

    if (!working.length) {
      console.warn('[proxy-pool] health check failed for all proxies — keeping list unchanged')
      return {
        kept: urls.length,
        removed: 0,
        aborted: true,
        results,
        stats: getProxyPoolStats(),
      }
    }

    const removed = urls.length - working.length
    if (removed > 0) {
      writeProxyPoolUrls(working)
      for (const result of results) {
        if (!result.ok) removeStrike(result.url)
      }
      reloadProxyPool()
      console.log(`[proxy-pool] auto-prune kept ${working.length}, removed ${removed}`)
    }

    return {
      kept: working.length,
      removed,
      aborted: false,
      results,
      stats: getProxyPoolStats(),
    }
  })().finally(() => {
    pruneInFlight = null
  })

  return pruneInFlight
}

export function saveProxyPoolFromUpload(rawContent: string): ProxyUploadResult {
  const { urls, invalid, duplicates } = parseAndNormalizeProxyContent(rawContent)
  if (!urls.length) {
    throw new Error('No valid proxy lines found. Use http://user:pass@host:port or host:port:user:pass per line.')
  }

  writeProxyPoolUrls(urls)
  reloadProxyPool()

  return {
    count: urls.length,
    invalid,
    duplicates,
    filePath: getManagedProxyPoolPath(),
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
  entry.strikes = 0
  entry.cooldownUntil = 0
  entry.lastUsedAt = Date.now()
  removeStrike(entry.url)
}

function maybeAutoRemoveProxy(entry: ProxyPoolEntry): void {
  if (!isAutoPruneEnabled()) return
  if (entry.strikes < removeAfterStrikes()) return
  if (entries.length <= 1) return
  removeProxyFromPool(entry.url, `${entry.strikes} download failures`)
}

export function markProxyFailure(entryId: string): void {
  const entry = entries.find((e) => e.id === entryId)
  if (!entry) return
  entry.failures++
  entry.lastUsedAt = Date.now()
  if (entry.failures >= maxFailuresBeforeCooldown()) {
    entry.cooldownUntil = Date.now() + cooldownMs()
    entry.failures = 0
    entry.strikes++
    const strikes = loadStrikeCounts()
    strikes[entry.url] = entry.strikes
    saveStrikeCounts(strikes)
    console.warn(`[proxy-pool] ${entry.label} cooling down for ${cooldownMs()}ms (strike ${entry.strikes})`)
    maybeAutoRemoveProxy(entry)
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
