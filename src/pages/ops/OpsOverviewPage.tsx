import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, CheckCircle2, Clock, Coins, Globe, Server } from 'lucide-react'
import { api, type OpsOverview } from '../../api/client'
import { getApiError } from '../../lib/apiError'

function StatCard({ label, value, icon: Icon, warn }: { label: string; value: string | number; icon: React.ElementType; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${warn ? 'text-amber-400' : 'text-emerald-400'}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

export function OpsOverviewPage() {
  const [data, setData] = useState<OpsOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api.ops.overview())
    } catch (err) {
      setError(getApiError(err, 'Failed to load overview'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  if (loading && !data) {
    return <p className="text-slate-400">Loading platform overview…</p>
  }
  if (error && !data) {
    return <p className="text-red-400">{error}</p>
  }
  if (!data) return null

  const workerStale = data.worker?.stale ?? true

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform Overview</h1>
          <p className="text-sm text-slate-400">Global health across all agencies</p>
        </div>
        <button type="button" onClick={load} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Agencies" value={data.agencies} icon={Building2} />
        <StatCard label="Connected pages" value={`${data.activePages}/${data.pages}`} icon={Globe} />
        <StatCard label="Published today" value={data.publishedToday} icon={CheckCircle2} />
        <StatCard label="Failed today" value={data.failedToday} icon={AlertTriangle} warn={data.failedToday > 0} />
        <StatCard label="Pending jobs" value={data.pendingJobs} icon={Clock} warn={data.pendingJobs > 50} />
        <StatCard label="Tokens sold" value={data.tokensSold.toLocaleString()} icon={Coins} />
        <StatCard label="Tokens used" value={data.tokensUsed.toLocaleString()} icon={Coins} />
        <StatCard label="Users" value={data.users} icon={Building2} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 font-medium">
            <Server className="h-4 w-4 text-emerald-400" />
            Worker
          </div>
          {workerStale ? (
            <p className="mt-2 text-amber-400">Worker heartbeat stale — check Railway worker service</p>
          ) : (
            <p className="mt-2 text-emerald-400">Worker active · last seen {data.worker?.lastBeat ?? '—'}</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center gap-2 font-medium">Proxy pool</div>
          <p className="mt-2 text-slate-300">
            {data.proxy.enabled
              ? `${data.proxy.availableNow} / ${data.proxy.poolSize} proxies available`
              : 'Proxy pool disabled'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/ops/jobs?status=failed" className="rounded-lg bg-red-500/15 px-4 py-2 text-sm text-red-300 hover:bg-red-500/25">
          View failed jobs
        </Link>
        <Link to="/ops/agencies" className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
          All agencies
        </Link>
        <Link to="/ops/live" className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
          Live feed
        </Link>
        <Link to="/ops/settings" className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
          Settings
        </Link>
      </div>
    </div>
  )
}