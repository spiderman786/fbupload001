import { execFile } from 'child_process'
import crypto from 'crypto'
import { promisify } from 'util'
import { isReelAlreadyPosted } from './dedup.js'
import { execYtDlpWithProxyFallback } from '../utils/ytdlpRunner.js'

const execFileAsync = promisify(execFile)

function platformFeedUrl(platform: string, username: string): string {
  const handle = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/reels/`
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`
    case 'youtube':
      return `https://www.youtube.com/@${handle}/shorts`
    case 'facebook':
      return `https://www.facebook.com/${handle}/reels/`
    default:
      return handle
  }
}

async function hasYtDlp(): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', ['--version'])
    return true
  } catch {
    return false
  }
}

async function listCandidateReels(feedUrl: string, limit = 20): Promise<{ id: string; url: string }[]> {
  const baseArgs = [
    feedUrl,
    '--flat-playlist',
    '--print', '%(id)s',
    '--print', '%(url)s',
    '--playlist-items', `1:${limit}`,
    '--no-warnings',
  ]

  const { stdout, usedProxy, proxyLabel } = await execYtDlpWithProxyFallback(baseArgs, {
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
  })

  if (usedProxy) console.log(`[discovery] listed reels via proxy ${proxyLabel ?? 'pool'}`)

  const lines = stdout.trim().split('\n').filter(Boolean)
  const results: { id: string; url: string }[] = []

  for (let i = 0; i < lines.length; i += 2) {
    const id = lines[i]?.trim()
    const url = lines[i + 1]?.trim()
    if (id && url) results.push({ id, url })
  }

  return results
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
}): Promise<{ reelId: string; sourceUrl: string; mock: boolean }> {
  const feedUrl = platformFeedUrl(params.platform, params.username)

  if (await hasYtDlp()) {
    try {
      const candidates = await listCandidateReels(feedUrl)
      for (const c of candidates) {
        if (!isReelAlreadyPosted(params.pageId, c.id)) {
          return { reelId: c.id, sourceUrl: c.url, mock: false }
        }
      }
      throw new Error('No new reels found on source (all recent items already posted to this page)')
    } catch (err) {
      if (err instanceof Error && err.message.includes('already posted')) throw err
      console.warn('[discovery] yt-dlp listing failed, using mock reel:', err)
    }
  }

  const mock = mockReelForToday(params.pageId, params.sourceAccountId)
  if (isReelAlreadyPosted(params.pageId, mock.id)) {
    throw new Error('Daily mock reel already posted for this page/source')
  }
  return { reelId: mock.id, sourceUrl: mock.url, mock: true }
}
