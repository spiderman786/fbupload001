import fs from 'fs'
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

const entries: ProxyPoolEntry[] = []
let roundRobinIndex = 0
let initialized = false

function parseProxyList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function loadProxyUrlsFromEnv(): string[] {
  const urls = new Set<string>()

  const pool = process.env.DOWNLOAD_PROXY_POOL?.trim()
  if (pool) {
    for (const url of parseProxyList(pool)) urls.add(url)
  }

  const filePath = process.env.PROXY_POOL_FILE?.trim()
  if (filePath && fs.existsSync(filePath)) {
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

export function initProxyPool(): void {
  if (initialized) return
  initialized = true

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
    console.log(`[proxy-pool] loaded ${entries.length} proxy/proxies`)
  }
}

function isAvailable(entry: ProxyPoolEntry, now: number): boolean {
  return entry.cooldownUntil <= now
}

/** Round-robin list of proxies to try for one yt-dlp job. */
export function getProxiesForJob(limit = maxAttemptsPerJob()): ProxyPoolEntry[] {
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
  initProxyPool()
  const now = Date.now()
  const availableNow = entries.filter((e) => isAvailable(e, now)).length

  return {
    enabled: entries.length > 0 && process.env.PROXY_POOL_ENABLED !== 'false',
    poolSize: entries.length,
    availableNow,
    directFirst: isDirectFirst(),
    maxAttemptsPerJob: maxAttemptsPerJob(),
    cooldownMs: cooldownMs(),
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
