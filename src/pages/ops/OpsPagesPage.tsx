import { useCallback, useEffect, useState } from 'react'
import { api, type OpsPage } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function OpsPagesPage() {
  const [pages, setPages] = useState<OpsPage[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.ops.pages({ status: statusFilter || undefined })
      setPages(r.pages)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load pages'))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, toast])

  useEffect(() => {
    load()
  }, [load])

  async function togglePause(page: OpsPage) {
    const next = page.status === 'active' ? 'paused' : 'active'
    try {
      await api.ops.updatePage(page.id, next)
      toast.success(`Page ${next === 'paused' ? 'paused' : 'activated'}`)
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Update failed'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">All Pages</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Page</th>
                <th className="px-4 py-3">Agency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Health</th>
                <th className="px-4 py-3">Last published</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/60">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-slate-300">{p.agency_name}</td>
                  <td className="px-4 py-3">{p.status}</td>
                  <td className="px-4 py-3">{p.health_status ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {p.last_published_at ? new Date(p.last_published_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => togglePause(p)}
                      className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                    >
                      {p.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
