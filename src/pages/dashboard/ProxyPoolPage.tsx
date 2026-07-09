import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Server, Sparkles } from 'lucide-react'
import { ProxyPoolUploadPanel } from '../../components/ProxyPoolUploadPanel'
import { api } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

type ProxyStats = Awaited<ReturnType<typeof api.proxyPool.stats>>

export function ProxyPoolPage() {
  const toast = useToast()
  const { platformAdmin } = useAuth()
  const [stats, setStats] = useState<ProxyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [pruning, setPruning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStats(await api.proxyPool.stats())
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load proxy pool'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const runAutoPrune = useCallback(async () => {
    if (!platformAdmin) return
    setPruning(true)
    try {
      const result = await api.proxyPool.prune()
      setStats(result.stats)
      if (result.aborted) {
        toast.error('Every proxy failed the health check — nothing was removed')
      } else if (result.removed > 0) {
        toast.success(`Kept ${result.kept} working proxies, removed ${result.removed} dead`)
      } else {
        toast.success(`All ${result.kept} proxies passed the health check`)
      }
    } catch (err) {
      toast.error(getApiError(err, 'Proxy health check failed'))
    } finally {
      setPruning(false)
    }
  }, [platformAdmin, toast])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
            <Server className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Download Proxy Pool</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One-time setup for Instagram, TikTok, and YouTube. Paste your proxy list and upload — no browser cookies or
            technical config needed.
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

      <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-5">
        <h2 className="mb-3 text-lg font-semibold">Step 1 — Upload your proxy list</h2>
        {platformAdmin ? (
          <ProxyPoolUploadPanel
            onUploaded={async () => {
              await load()
              await runAutoPrune()
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Proxy uploads are managed by your platform administrator. Contact support if downloads fail due to missing
            proxies.
          </p>
        )}
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

          <div className="rounded-xl border border-border bg-card p-4 text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">Status:</span>{' '}
              {stats.enabled ? 'Enabled' : 'Waiting for upload — use the blue button above'}
            </p>
            <p>
              <span className="text-muted-foreground">Saved to:</span>{' '}
              <code className="rounded bg-muted px-1 text-xs">{stats.filePath}</code>
            </p>
            {platformAdmin ? (
              <p className="text-muted-foreground">
                Auto-clean is on: dead proxies are removed after upload, every 6 hours, and after repeated download
                failures.
              </p>
            ) : null}
          </div>

          {platformAdmin && stats.proxies.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAutoPrune()}
                disabled={pruning || loading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Sparkles className={`h-4 w-4 ${pruning ? 'animate-pulse' : ''}`} />
                {pruning ? 'Testing proxies…' : 'Test & remove dead proxies'}
              </button>
            </div>
          ) : null}

          {stats.proxies.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Proxy IP</th>
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
                      <td className="px-4 py-2">{p.available ? 'Ready' : 'Cooldown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Also on <Link to="/dashboard" className="text-primary hover:underline">Dashboard home</Link> (top card).
      </p>
    </div>
  )
}
