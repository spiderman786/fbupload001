import { execFile } from 'child_process'
import { promisify } from 'util'
import { getYtDlpProxyArgs, isProxyConfigured } from './ytdlpProxy.js'

const execFileAsync = promisify(execFile)

type ExecOptions = Parameters<typeof execFileAsync>[2]

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Run yt-dlp direct first; if it fails and Webshare/proxy env is set, retry with proxy.
 */
export async function execYtDlpWithProxyFallback(
  args: string[],
  options?: ExecOptions,
): Promise<{ stdout: string; stderr: string; usedProxy: boolean }> {
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', args, options)
    return { stdout: String(stdout), stderr: String(stderr), usedProxy: false }
  } catch (directErr) {
    if (!isProxyConfigured()) throw directErr

    const proxyArgs = getYtDlpProxyArgs()
    if (!proxyArgs.length) throw directErr

    console.warn('[yt-dlp] direct request failed, retrying with proxy:', errorMessage(directErr))

    const { stdout, stderr } = await execFileAsync('yt-dlp', [...args, ...proxyArgs], options)
    return { stdout: String(stdout), stderr: String(stderr), usedProxy: true }
  }
}
