import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'

function testTimeoutMs(): number {
  return Number(process.env.PROXY_TEST_TIMEOUT_MS ?? 12_000)
}

function testUrl(): string {
  return process.env.PROXY_TEST_URL?.trim() || DEFAULT_TEST_URL
}

function curlBinary(): string {
  return process.platform === 'win32' ? 'curl.exe' : 'curl'
}

export type ProxyHealthResult = {
  url: string
  label: string
  ok: boolean
  latencyMs: number | null
  error?: string
}

export async function testProxyUrl(url: string): Promise<ProxyHealthResult> {
  const label = proxyLabelFromUrl(url)
  const started = Date.now()
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'

  try {
    const { stdout } = await execFileAsync(
      curlBinary(),
      [
        '-x',
        url,
        '-sS',
        '-o',
        nullDevice,
        '-w',
        '%{http_code}',
        '--max-time',
        String(Math.max(5, Math.ceil(testTimeoutMs() / 1000))),
        testUrl(),
      ],
      { timeout: testTimeoutMs() + 3000, windowsHide: true },
    )
    const status = Number(String(stdout).trim())
    const ok = Number.isFinite(status) && status >= 200 && status < 400
    return {
      url,
      label,
      ok,
      latencyMs: Date.now() - started,
      error: ok ? undefined : `HTTP ${status || 'error'}`,
    }
  } catch (err) {
    return {
      url,
      label,
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function proxyLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return 'proxy'
  }
}

export async function testProxyUrls(
  urls: string[],
  concurrency = Number(process.env.PROXY_TEST_CONCURRENCY ?? 5),
): Promise<ProxyHealthResult[]> {
  const results: ProxyHealthResult[] = new Array(urls.length)
  let next = 0
  const workers = Math.max(1, Math.min(concurrency, urls.length || 1))

  async function worker(): Promise<void> {
    while (next < urls.length) {
      const index = next++
      results[index] = await testProxyUrl(urls[index]!)
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
