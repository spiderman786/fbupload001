import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type JobExplanation, type OpsErrorGroup, type OpsJob, type OpsJobLog } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const STATUSES = ['', 'pending', 'downloading', 'publishing', 'published', 'failed']

function statusColor(status: string) {
  if (status === 'published') return 'text-emerald-400'
  if (status === 'failed') return 'text-red-400'
  if (status === 'pending') return 'text-amber-400'
  return 'text-slate-300'
}

export function OpsJobsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') ?? ''
  const [jobs, setJobs] = useState<OpsJob[]>([])
  const [groups, setGroups] = useState<OpsErrorGroup[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<OpsJobLog[]>([])
  const [explanation, setExplanation] = useState<JobExplanation | null>(null)
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const [j, g] = await Promise.all([
        api.ops.jobs({ status: status || undefined, limit: 200 }),
        api.ops.errorGroups(7),
      ])
      setJobs(j.jobs)
      setGroups(g.groups)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load jobs'))
    } finally {
      setLoading(false)
    }
  }, [status, toast])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  async function openJob(id: string) {
    setSelectedId(id)
    setExplanation(null)
    try {
      const r = await api.ops.job(id)
      setLogs(r.logs)
      if (r.job.status === 'failed') {
        api.ops.explainJob(id).then((e) => setExplanation(e.explanation)).catch(() => {})
      }
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load job'))
    }
  }

  async function retryJob(id: string) {
    try {
      await api.ops.retryJob(id)
      toast.success('Job queued for retry')
      loadJobs()
      if (selectedId === id) openJob(id)
    } catch (err) {
      toast.error(getApiError(err, 'Retry failed'))
    }
  }

  async function bulkRetry(errorMessage: string) {
    try {
      const r = await api.ops.bulkRetry({ errorMessage })
      toast.success(`Retried ${r.retried} jobs`)
      loadJobs()
    } catch (err) {
      toast.error(getApiError(err, 'Bulk retry failed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Jobs &amp; Errors</h1>
          <p className="text-sm text-slate-400">Error groups, bulk retry, AI explain (v2.4 / v3.1)</p>
        </div>
        <div className="flex gap-2">
          <a
            href={api.ops.exportJobsUrl(status || 'failed')}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Export CSV
          </a>
          <select
            value={status}
            onChange={(e) => setSearchParams(e.target.value ? { status: e.target.value } : {})}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-slate-400">Error groups (7d)</h2>
          <ul className="mt-2 space-y-2">
            {groups.slice(0, 8).map((g) => (
              <li key={g.errorMessage} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-red-400/90">
                  {g.count}× {g.errorMessage.slice(0, 100)}
                </span>
                <button
                  type="button"
                  onClick={() => bulkRetry(g.errorMessage)}
                  className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-xs hover:bg-emerald-500"
                >
                  Retry all
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <p className="p-4 text-slate-400">Loading…</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-800 bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Agency</th>
                  <th className="px-3 py-2">Page</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    onClick={() => openJob(j.id)}
                    className={`cursor-pointer border-b border-slate-800/60 hover:bg-slate-900/50 ${selectedId === j.id ? 'bg-slate-800/50' : ''}`}
                  >
                    <td className={`px-3 py-2 ${statusColor(j.status)}`}>{j.status}</td>
                    <td className="px-3 py-2 text-slate-300">{j.agency_name ?? '—'}</td>
                    <td className="px-3 py-2">{j.page_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 max-h-[65vh] overflow-y-auto">
          {!selectedId ? (
            <p className="text-slate-500">Select a job for logs and AI diagnosis</p>
          ) : (
            <>
              {(() => {
                const job = jobs.find((j) => j.id === selectedId)
                if (!job) return null
                return (
                  <div className="mb-4 space-y-2 border-b border-slate-800 pb-4">
                    <p className="font-mono text-xs text-slate-500">{job.id}</p>
                    <p className={statusColor(job.status)}>{job.status}</p>
                    {job.error_message && <p className="text-sm text-red-400">{job.error_message}</p>}
                    {job.status === 'failed' && (
                      <button type="button" onClick={() => retryJob(job.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500">
                        Retry job
                      </button>
                    )}
                  </div>
                )
              })()}

              {explanation && (
                <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
                  <p className="font-medium text-emerald-300">AI diagnosis · {explanation.category}</p>
                  <p className="mt-1 text-slate-300">{explanation.summary}</p>
                  <p className="mt-2 text-slate-400">{explanation.likelyCause}</p>
                  <ul className="mt-2 list-inside list-disc text-slate-400">
                    {explanation.suggestedActions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              <h3 className="mb-2 text-sm font-medium text-slate-400">Job trail</h3>
              <ul className="space-y-2 text-sm">
                {logs.map((log) => (
                  <li key={log.id} className="rounded-lg bg-slate-950/60 p-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-emerald-400/80">{log.step}</span>
                      <span className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-0.5 text-slate-300">{log.message}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <Link to="/ops/live" className="text-sm text-emerald-400 hover:underline">
        Open live feed →
      </Link>
    </div>
  )
}
