import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { api, type ReelJob } from '../../api/client'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

type Filter = 'all' | 'failed' | 'active' | 'published'

export function ReelsPage() {
  const toast = useToast()
  const [jobs, setJobs] = useState<ReelJob[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const { jobs: j } = await api.reels.list()
      setJobs(j)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load jobs')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const filtered = jobs.filter((job) => {
    if (filter === 'all') return true
    if (filter === 'failed') return job.status === 'failed'
    if (filter === 'published') return job.status === 'published'
    return ['pending', 'downloading', 'publishing'].includes(job.status)
  })

  const failedCount = jobs.filter((j) => j.status === 'failed').length
  const activeCount = jobs.filter((j) => ['pending', 'downloading', 'publishing'].includes(j.status)).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Reel Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track publish status and errors for automated reel workflows.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {failedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{failedCount} failed job{failedCount !== 1 ? 's' : ''} need attention</p>
            <p className="mt-0.5 text-red-700">
              Check errors below. Common fixes: reconnect Facebook pages, verify tokens, or ensure source accounts are active.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', `All (${jobs.length})`],
            ['active', `In progress (${activeCount})`],
            ['failed', `Failed (${failedCount})`],
            ['published', 'Published'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="marketing-card py-12 text-center">
          <p className="text-muted-foreground">
            {filter === 'all'
              ? 'No reel jobs yet. Connect pages, add sources, and set a schedule to start automation.'
              : `No ${filter} jobs.`}
          </p>
          {filter === 'all' && (
            <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm">
              <Link to="/facebook/accounts" className="text-primary hover:underline">Connect pages</Link>
              <Link to="/facebook/auto-download-upload" className="text-primary hover:underline">Add sources</Link>
              <Link to="/facebook/direct-schedule" className="text-primary hover:underline">Set schedule</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <div key={job.id} className="marketing-card space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={job.status} />
                    {job.jobType && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{job.jobType}</span>
                    )}
                    {job.metadataStripped && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">metadata stripped</span>
                    )}
                    {job.tokensCharged > 0 && (
                      <span className="text-xs text-muted-foreground">{job.tokensCharged} token(s) charged</span>
                    )}
                  </div>
                  <p className="text-sm font-medium">
                    {job.pageName ?? 'Unknown page'}
                    {job.sourceUsername ? ` ← @${job.sourceUsername}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(job.createdAt).toLocaleString()}
                    {job.completedAt && ` · Completed ${new Date(job.completedAt).toLocaleString()}`}
                  </p>
                </div>
              </div>

              {job.status === 'failed' && job.errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="text-xs font-semibold tracking-wide uppercase">Error</p>
                  <p className="mt-1">{job.errorMessage}</p>
                </div>
              )}

              {job.metaPostId && (
                <p className="text-xs text-muted-foreground">Post ID: {job.metaPostId}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
