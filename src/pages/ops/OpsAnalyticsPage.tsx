import { useEffect, useState } from 'react'
import { api, type OpsAnalytics } from '../../api/client'
import { getApiError } from '../../lib/apiError'

export function OpsAnalyticsPage() {
  const [data, setData] = useState<OpsAnalytics | null>(null)
  const [days, setDays] = useState(14)
  const [error, setError] = useState('')

  useEffect(() => {
    api.ops
      .analytics(days)
      .then(setData)
      .catch((err) => setError(getApiError(err, 'Failed to load analytics')))
  }, [days])

  if (error) return <p className="text-red-400">{error}</p>
  if (!data) return <p className="text-slate-400">Loading analytics…</p>

  const maxDaily = Math.max(...data.daily.map((d) => d.published + d.failed), 1)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-4 font-medium">Daily publish vs fail</h2>
        <div className="flex items-end gap-1 h-40">
          {data.daily.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={d.day}>
              <div className="flex w-full flex-col justify-end gap-0.5" style={{ height: '120px' }}>
                <div
                  className="w-full rounded-t bg-emerald-500/70"
                  style={{ height: `${(d.published / maxDaily) * 100}%`, minHeight: d.published ? 2 : 0 }}
                />
                <div
                  className="w-full rounded-t bg-red-500/60"
                  style={{ height: `${(d.failed / maxDaily) * 100}%`, minHeight: d.failed ? 2 : 0 }}
                />
              </div>
              <span className="text-[10px] text-slate-500">{d.day.slice(5)}</span>
            </div>
          ))}
          {!data.daily.length && <p className="text-slate-500">No data in range</p>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-medium">By platform (14d)</h2>
          <ul className="space-y-2 text-sm">
            {data.byPlatform.map((p) => (
              <li key={p.platform} className="flex justify-between">
                <span className="capitalize">{p.platform}</span>
                <span className="text-slate-400">
                  {p.published} ok / {p.failed} fail ({p.jobs} total)
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-medium">Top errors (7d)</h2>
          <ul className="space-y-2 text-sm">
            {data.topErrors.map((e, i) => (
              <li key={i} className="text-slate-300">
                <span className="text-red-400">{e.count}×</span> {e.error_message?.slice(0, 120)}
              </li>
            ))}
            {!data.topErrors.length && <p className="text-slate-500">No failures</p>}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 font-medium">Agency activity (7d publishes)</h2>
        <ul className="space-y-1 text-sm">
          {data.agencyActivity.map((a) => (
            <li key={a.name} className="flex justify-between">
              <span>{a.name}</span>
              <span className="text-slate-400">{a.published_7d} reels · {a.token_balance} tokens</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
