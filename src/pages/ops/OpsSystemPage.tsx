import { useCallback, useEffect, useState } from 'react'
import { api, type OpsAlert, type OpsSystemInfo } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function OpsSystemPage() {
  const [system, setSystem] = useState<OpsSystemInfo | null>(null)
  const [alerts, setAlerts] = useState<OpsAlert[]>([])
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.ops.system(), api.ops.alerts()])
      setSystem(s)
      setAlerts(a.alerts)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load system info'))
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  async function runChecks() {
    try {
      const r = await api.ops.runAlertChecks()
      setAlerts(r.alerts)
      toast.success('Alert checks completed')
    } catch (err) {
      toast.error(getApiError(err, 'Alert check failed'))
    }
  }

  if (!system) return <p className="text-slate-400">Loading system status…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">System</h1>
        <button type="button" onClick={runChecks} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">
          Run alert checks
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Worker</h2>
          {system.worker?.stale ? (
            <p className="mt-2 text-amber-400">Stale — worker may be down</p>
          ) : (
            <p className="mt-2 text-emerald-400">Healthy · {system.worker?.lastBeat ?? 'unknown'}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Proxy pool</h2>
          <p className="mt-2 text-slate-300">
            {system.proxy.enabled
              ? `${system.proxy.availableNow} / ${system.proxy.poolSize} available`
              : 'Disabled'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Database</h2>
          <p className="mt-2 text-sm text-slate-400 font-mono truncate">{system.dbPath}</p>
          <p className="mt-1 text-slate-300">{formatBytes(system.dbSizeBytes)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Runtime</h2>
          <p className="mt-2 text-slate-300">Node {system.nodeVersion}</p>
          <p className="text-slate-400">Uptime {Math.floor(system.uptimeSec / 60)} min</p>
        </div>
      </div>

      {system.oldestPendingJob && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-amber-300">
            Oldest pending job since {new Date(system.oldestPendingJob.created_at).toLocaleString()}
          </p>
          <p className="font-mono text-xs text-slate-500">{system.oldestPendingJob.id}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 font-medium">Recent alerts</h2>
        <ul className="space-y-2 text-sm">
          {alerts.map((a) => (
            <li key={a.id} className="rounded-lg bg-slate-950/50 p-3">
              <span className="text-amber-400">{a.alertType}</span>
              <p className="mt-1 text-slate-300">{a.message}</p>
              <p className="mt-1 text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</p>
            </li>
          ))}
          {!alerts.length && <p className="text-slate-500">No recent alerts</p>}
        </ul>
      </div>
    </div>
  )
}
