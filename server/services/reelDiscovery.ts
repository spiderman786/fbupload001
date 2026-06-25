import { execFile } from 'child_process'
import crypto from 'crypto'
import { promisify } from 'util'
import { db } from '../db.js'
import { isReelConsumedByPage, tryReserveReelForJob } from './dedup.js'
import { execYtDlpWithProxyFallback } from '../utils/ytdlpRunner.js'
import {
  canonicalSourceUrl,
  normalizeSourceReelId,
  ytDlpPlatformArgs,
} from '../utils/reelIdentity.js'

const execFileAsync = promisify(execFile)

export { platformFeedUrl } from '../utils/reelIdentity.js'

async function hasYtDlp(): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', ['--version'])
    return true
  } catch {
    return false
  }
}

export async function listCandidateReels(
  feedUrl: string,
  limit = 20,
  platform = '',
): Promise<{ id: string; url: string }[]> {
  const baseArgs = [
    feedUrl,
    '--flat-playlist',
    '--print', '%(id)s',
    '--print', '%(url)s',
    '--playlist-items', `1:${limit}`,
    '--no-warnings',
    ...ytDlpPlatformArgs(platform, feedUrl),
  ]

  const { stdout, usedProxy, proxyLabel } = await execYtDlpWithProxyFallback(baseArgs, {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })

  if (usedProxy) console.log(`[discovery] listed reels via proxy ${proxyLabel ?? 'pool'}`)

  const lines = stdout.trim().split('\n').filter(Boolean)
  const results: { id: string; url: string }[] = []

  for (let i = 0; i < lines.length; i += 2) {
    const id = lines[i]?.trim()
    const url = lines[i + 1]?.trim()
    if (id && url && !results.some((r) => r.id === id)) results.push({ id, url })
  }

  return results
}

export function catalogProbeLimit(): number {
  return Number(process.env.PREFILL_CATALOG_PROBE_LIMIT ?? 100)
}

/** Count reels visible on a creator feed (up to limit). */
export async function countCatalogReels(platform: string, username: string, limit = catalogProbeLimit()): Promise<number> {
  if (!(await hasYtDlp())) return 0
  try {
    const feedUrl = platformFeedUrl(platform, username)
    const candidates = await listCandidateReels(feedUrl, limit, platform)
    return candidates.length
  } catch (err) {
    console.warn('[catalog] probe failed:', err)
    return 0
  }
}

function mockReelForToday(pageId: string, sourceAccountId: string): { id: string; url: string } {
  const day = new Date().toISOString().slice(0, 10)
  const id = crypto.createHash('sha1').update(`${pageId}:${sourceAccountId}:${day}:${Date.now()}`).digest('hex').slice(0, 16)
  return { id, url: `mock://reel/${id}` }
}

export async function discoverNextReel(params: {
  pageId: string
  sourceAccountId: string
  platform: string
  username: string
  jobId: string
}): Promise<{ reelId: string; sourceUrl: string; mock: boolean }> {
  const feedUrl = platformFeedUrl(params.platform, params.username)
  const listLimit = Number(process.env.PREFILL_DISCOVERY_LIST_LIMIT ?? 50)

  if (await hasYtDlp()) {
    try {
      const candidates = await listCandidateReels(feedUrl, listLimit, params.platform)
      for (const c of candidates) {
        const reelId = normalizeSourceReelId(params.platform, c.id, c.url)
        const sourceUrl = canonicalSourceUrl(params.platform, reelId, c.url)
        if (tryReserveReelForJob(params.pageId, params.jobId, reelId, sourceUrl)) {
          return { reelId, sourceUrl, mock: false }
        }
      }
      throw new Error('No new reels found on source (all recent items already posted to this page)')
    } catch (err) {
      if (err instanceof Error && err.message.includes('already posted')) throw err
      console.warn('[discovery] yt-dlp listing failed, using mock reel:', err)
    }
  }

  const mock = mockReelForToday(params.pageId, params.sourceAccountId)
  if (!tryReserveReelForJob(params.pageId, params.jobId, mock.id)) {
    throw new Error('No new reels available for this page right now')
  }
  return { reelId: mock.id, sourceUrl: mock.url, mock: true }
}

/** Probe creator catalog size and persist on assignment (non-blocking). */
export async function probeSourceCatalog(pageId: string): Promise<number> {
  const row = db
    .prepare(`
      SELECT s.platform, s.username
      FROM page_source_assignments a
      JOIN source_accounts s ON s.id = a.source_account_id
      WHERE a.page_id = ?
    `)
    .get(pageId) as { platform: string; username: string } | undefined

  if (!row) return 0

  const total = await countCatalogReels(row.platform, row.username)
  if (total > 0) {
    db.prepare('UPDATE page_source_assignments SET catalog_total = ? WHERE page_id = ?').run(total, pageId)
    console.log(`[catalog] @${row.username} (${row.platform}): ${total} reels in catalog probe`)
  }
  return total
}
