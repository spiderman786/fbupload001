import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { fileURLToPath } from 'url'
import { execYtDlpWithProxyFallback } from '../utils/ytdlpRunner.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'downloads')

export type DownloadResult = {
  filePath: string
  sourceUrl: string
  sourceReelId: string
  mock: boolean
}

export type ReelMetadata = {
  title: string
  description: string
  thumbnailUrl: string
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function platformUrl(platform: string, username: string): string {
  const handle = username.replace(/^@/, '')
  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/reels/`
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`
    case 'youtube':
      return handle.startsWith('@') ? `https://www.youtube.com/${handle}/shorts` : `https://www.youtube.com/@${handle}/shorts`
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

function cleanupPartialRawFiles(dir: string) {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('raw.')) fs.unlinkSync(path.join(dir, f))
  }
}

async function downloadWithYtDlp(url: string, outPath: string): Promise<void> {
  const dir = path.dirname(outPath)
  const template = path.join(dir, 'raw.%(ext)s')
  cleanupPartialRawFiles(dir)

  const baseArgs = [url, '-f', 'best[ext=mp4]/best', '--no-playlist', '-o', template, '--no-warnings']
  const { usedProxy, proxyLabel } = await execYtDlpWithProxyFallback(baseArgs, { timeout: 180_000 })

  if (usedProxy) console.log(`[downloader] downloaded via proxy ${proxyLabel ?? 'pool'}`)

  const files = fs.readdirSync(dir).filter((f) => f.startsWith('raw.'))
  if (!files.length) throw new Error('yt-dlp did not produce a file')
  const downloaded = path.join(dir, files[0]!)
  if (downloaded !== outPath) fs.renameSync(downloaded, outPath)
}

function writeMockVideo(outPath: string) {
  const buf = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
  ])
  fs.writeFileSync(outPath, buf)
}

export async function downloadReelFromUrl(
  tenantId: string,
  jobId: string,
  sourceUrl: string,
  sourceReelId: string,
  mock: boolean,
): Promise<DownloadResult> {
  ensureDir(DOWNLOADS_DIR)
  const jobDir = path.join(DOWNLOADS_DIR, tenantId, jobId)
  ensureDir(jobDir)
  const outPath = path.join(jobDir, 'raw.mp4')

  if (!mock && (await hasYtDlp()) && !sourceUrl.startsWith('mock://')) {
    try {
      await downloadWithYtDlp(sourceUrl, outPath)
      return { filePath: outPath, sourceUrl, sourceReelId, mock: false }
    } catch (err) {
      console.warn('[downloader] yt-dlp download failed:', err)
    }
  }

  writeMockVideo(outPath)
  return { filePath: outPath, sourceUrl, sourceReelId, mock: true }
}

/** Fetch title, description, and thumbnail URL via yt-dlp. */
export async function fetchReelMetadata(sourceUrl: string): Promise<ReelMetadata | null> {
  if (sourceUrl.startsWith('mock://')) return null
  if (!(await hasYtDlp())) return null

  try {
    const baseArgs = [sourceUrl, '--dump-single-json', '--no-playlist', '--no-warnings']
    const { stdout } = await execYtDlpWithProxyFallback(baseArgs, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
    const data = JSON.parse(stdout) as {
      title?: string
      description?: string
      thumbnail?: string
      thumbnails?: { url?: string }[]
    }
    const thumbnailUrl = data.thumbnail ?? data.thumbnails?.at(-1)?.url ?? ''
    return {
      title: data.title?.trim() ?? '',
      description: (data.description ?? data.title ?? '').trim(),
      thumbnailUrl,
    }
  } catch (err) {
    console.warn('[downloader] metadata fetch failed:', err)
    return null
  }
}

export async function downloadThumbnail(thumbnailUrl: string, jobDir: string): Promise<string | null> {
  if (!thumbnailUrl) return null
  try {
    ensureDir(jobDir)
    const res = await fetch(thumbnailUrl)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ext = thumbnailUrl.includes('.webp') ? 'webp' : 'jpg'
    const outPath = path.join(jobDir, `thumb.${ext}`)
    fs.writeFileSync(outPath, buf)
    return outPath
  } catch {
    return null
  }
}

/** Extract a poster frame from a local video when yt-dlp thumbnail is unavailable. */
export async function extractVideoThumbnail(videoPath: string, jobDir: string): Promise<string | null> {
  if (!fs.existsSync(videoPath)) return null
  try {
    ensureDir(jobDir)
    const outPath = path.join(jobDir, 'thumb.jpg')
    await execFileAsync(
      'ffmpeg',
      ['-y', '-ss', '00:00:01', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath],
      { timeout: 30_000 },
    )
    return fs.existsSync(outPath) ? outPath : null
  } catch {
    return null
  }
}

/** @deprecated use discoverNextReel + downloadReelFromUrl */
export async function downloadReelFromSource(
  tenantId: string,
  jobId: string,
  platform: string,
  username: string,
): Promise<DownloadResult> {
  const sourceUrl = platformUrl(platform, username)
  return downloadReelFromUrl(tenantId, jobId, sourceUrl, `legacy_${Date.now()}`, true)
}

export async function stripVideoMetadata(inputPath: string, outputPath: string): Promise<{ stripped: boolean }> {
  ensureDir(path.dirname(outputPath))

  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', inputPath, '-c', 'copy', '-map_metadata', '-1', '-fflags', '+bitexact', outputPath],
      { timeout: 60_000 },
    )
    return { stripped: true }
  } catch {
    fs.copyFileSync(inputPath, outputPath)
    return { stripped: false }
  }
}

export function cleanupJobFiles(tenantId: string, jobId: string) {
  const jobDir = path.join(DOWNLOADS_DIR, tenantId, jobId)
  if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true })
}
