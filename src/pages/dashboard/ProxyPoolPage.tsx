import { useEffect, useState } from 'react'
import { RefreshCw, Server } from 'lucide-react'
import { api } from '../../api/client'
import { useAgencyRole } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function ProxyPoolPage() {
  const toast = useToast()
  const { isAdmin } = useAgencyRole()
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.proxyPool.stats>> | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      setStats(await api.proxyPool.stats())
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load proxy pool'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin])

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Only owners and admins can view proxy pool status.</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Download Proxy Pool</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Residential static proxies rotate per reel download so Instagram/TikTok/YouTube do not block your server IP.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && !stats ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Pool size', value: stats.poolSize },
              { label: 'Available now', value: stats.availableNow },
              { label: 'Max tries / video', value: stats.maxAttemptsPerJob },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{item.label}</p>
                <p className="font-display mt-2 text-2xl font-bold">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p>
              <span className="text-muted-foreground">Status:</span>{' '}
              {stats.enabled ? 'Enabled' : 'Not configured — add proxies on Railway'}
            </p>
            <p className="mt-1">
              <span className="text-muted-foreground">Direct-first:</span> {stats.directFirst ? 'Yes (try server IP, then proxies)' : 'No (always use proxies)'}
            </p>
            <p className="mt-1">
              <span className="text-muted-foreground">Cooldown after failures:</span> {Math.round(stats.cooldownMs / 60000)} min
            </p>
          </div>

          {stats.proxies.length ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Proxy</th>
                    <th className="px-4 py-3">OK</th>
                    <th className="px-4 py-3">Fails</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.proxies.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-2 font-mono text-xs">{p.label}</td>
                      <td className="px-4 py-2">{p.successes}</td>
                      <td className="px-4 py-2">{p.failures}</td>
                      <td className="px-4 py-2">
                        {p.available ? (
                          <span className="text-primary">Ready</span>
                        ) : (
                          <span className="text-orange-600">Cooldown</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              No proxies loaded. Set <code className="rounded bg-muted px-1">DOWNLOAD_PROXY_POOL</code> or{' '}
              <code className="rounded bg-muted px-1">PROXY_POOL_FILE</code> on Railway (Web + Worker services).
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground">Railway setup (50 proxies example)</p>
            <p>Option A — env var (comma or newline separated):</p>
            <pre className="overflow-x-auto rounded bg-background p-2 font-mono">{`DOWNLOAD_PROXY_POOL=http://user:pass@1.2.3.4:8080,http://user:pass@5.6.7.8:8080,...`}</pre>
            <p>Option B — mount a file:</p>
            <pre className="overflow-x-auto rounded bg-background p-2 font-mono">{`PROXY_POOL_FILE=/app/data/proxy-pool.txt\nPROXY_DIRECT_FIRST=false`}</pre>
            <p>Set on both <strong>Web</strong> and <strong>Worker</strong> services. Redeploy after changing.</p>
          </div>
        </>
      ) : null}
    </div>
  )
}
