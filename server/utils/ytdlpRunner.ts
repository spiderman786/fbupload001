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

async function runYtDlp(args: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('yt-dlp', args, options)
  return { stdout: String(stdout), stderr: String(stderr) }
}

/**
 * Run yt-dlp with optional direct-first, then rotate through residential proxy pool.
 * Tries up to PROXY_MAX_ATTEMPTS_PER_JOB proxies (default 50) per call.
 */
export async function execYtDlpWithProxyFallback(
  args: string[],
  options?: ExecOptions,
): Promise<YtDlpRunResult> {
  let lastErr: unknown

  if (isDirectFirst()) {
    try {
      const { stdout, stderr } = await runYtDlp(args, options)
      return { stdout, stderr, usedProxy: false }
    } catch (directErr) {
      lastErr = directErr
      if (!isProxyPoolEnabled()) {
        const legacy = getLegacySingleProxyUrl()
        if (legacy) {
          try {
            const { stdout, stderr } = await runYtDlp([...args, ...proxyArgsForUrl(legacy)], options)
            return { stdout, stderr, usedProxy: true, proxyLabel: 'legacy' }
          } catch (legacyErr) {
            throw legacyErr
          }
        }
      }
      console.warn('[yt-dlp] direct request failed, trying proxy pool:', errorMessage(directErr))
    }
  }

  if (!isProxyPoolEnabled()) {
    if (lastErr) throw lastErr
    const { stdout, stderr } = await runYtDlp(args, options)
    return { stdout, stderr, usedProxy: false }
  }

  const proxies = getProxiesForJob(maxAttemptsPerJob())
  if (!proxies.length) {
    if (lastErr) throw lastErr
    const { stdout, stderr } = await runYtDlp(args, options)
    return { stdout, stderr, usedProxy: false }
  }

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

  throw lastErr ?? new Error('All proxies failed for yt-dlp request')
}
