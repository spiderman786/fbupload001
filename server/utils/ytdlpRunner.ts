import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  getProxiesForJob,
  isDirectFirst,
  isProxyPoolEnabled,
  markProxyFailure,
  markProxySuccess,
  maxAttemptsPerJob,
} from '../services/proxyPool.js'
import { getLegacySingleProxyUrl, proxyArgsForUrl } from './ytdlpProxy.js'

const execFileAsync = promisify(execFile)

type ExecOptions = Parameters<typeof execFileAsync>[2]

export type YtDlpRunResult = {
  stdout: string
  stderr: string
  usedProxy: boolean
  proxyLabel?: string
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function isSocialDownload(args: string[]): boolean {
  return /instagram|tiktok|facebook|youtube|youtu\.be/i.test(args.join(' '))
}

/** Instagram/TikTok/FB: use residential proxies first when a pool exists (no cookies needed). */
function useProxyFirst(args: string[]): boolean {
  if (process.env.SOCIAL_PROXY_FIRST === 'false') return !isDirectFirst()
  if (isSocialDownload(args) && isProxyPoolEnabled()) return true
  return !isDirectFirst()
}

async function runYtDlp(args: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('yt-dlp', args, options)
  return { stdout: String(stdout), stderr: String(stderr) }
}

async function runViaProxyPool(
  args: string[],
  options?: ExecOptions,
): Promise<YtDlpRunResult | null> {
  const proxies = getProxiesForJob(maxAttemptsPerJob())
  if (!proxies.length) return null

  let lastErr: unknown
  for (const proxy of proxies) {
    try {
      const { stdout, stderr } = await runYtDlp([...args, ...proxyArgsForUrl(proxy.url)], options)
      markProxySuccess(proxy.id)
      return { stdout, stderr, usedProxy: true, proxyLabel: proxy.label }
    } catch (err) {
      lastErr = err
      markProxyFailure(proxy.id)
      console.warn(`[yt-dlp] proxy ${proxy.label} failed:`, errorMessage(err))
    }
  }
  if (lastErr) throw lastErr
  return null
}

async function runViaLegacyProxy(args: string[], options?: ExecOptions): Promise<YtDlpRunResult | null> {
  const legacy = getLegacySingleProxyUrl()
  if (!legacy) return null
  const { stdout, stderr } = await runYtDlp([...args, ...proxyArgsForUrl(legacy)], options)
  return { stdout, stderr, usedProxy: true, proxyLabel: 'legacy' }
}

async function runDirect(args: string[], options?: ExecOptions): Promise<YtDlpRunResult> {
  const { stdout, stderr } = await runYtDlp(args, options)
  return { stdout, stderr, usedProxy: false }
}

/**
 * Run yt-dlp — social downloads prefer the proxy pool first (Instagram/TikTok without cookies).
 */
export async function execYtDlpWithProxyFallback(
  args: string[],
  options?: ExecOptions,
): Promise<YtDlpRunResult> {
  const proxyFirst = useProxyFirst(args)
  let lastErr: unknown

  const tryProxy = async (): Promise<YtDlpRunResult | null> => {
    if (isProxyPoolEnabled()) {
      try {
        return await runViaProxyPool(args, options)
      } catch (err) {
        lastErr = err
        console.warn('[yt-dlp] proxy pool failed:', errorMessage(err))
      }
    }
    try {
      return await runViaLegacyProxy(args, options)
    } catch (err) {
      lastErr = err
      return null
    }
  }

  const tryDirect = async (): Promise<YtDlpRunResult | null> => {
    try {
      return await runDirect(args, options)
    } catch (err) {
      lastErr = err
      if (!proxyFirst) {
        console.warn('[yt-dlp] direct request failed, trying proxy pool:', errorMessage(err))
      }
      return null
    }
  }

  if (proxyFirst) {
    const viaProxy = await tryProxy()
    if (viaProxy) return viaProxy
    const viaDirect = await tryDirect()
    if (viaDirect) return viaDirect
  } else {
    const viaDirect = await tryDirect()
    if (viaDirect) return viaDirect
    const viaProxy = await tryProxy()
    if (viaProxy) return viaProxy
  }

  throw lastErr ?? new Error('All download methods failed for yt-dlp request')
}
