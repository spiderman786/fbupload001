import { useEffect, useState } from 'react'
import { api, type OpsAuditEntry } from '../../api/client'
import { getApiError } from '../../lib/apiError'

export function OpsAuditPage() {
  const [audit, setAudit] = useState<OpsAuditEntry[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api.ops
      .audit(200)
      .then((r) => setAudit(r.audit))
      .catch((err) => setError(getApiError(err, 'Failed to load audit log')))
  }, [])

  if (error) return <p className="text-red-400">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <p className="text-sm text-slate-400">Platform admin actions across all agencies</p>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id} className="border-b border-slate-800/60">
                <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">{a.adminEmail}</td>
                <td className="px-4 py-3 text-emerald-400">{a.action}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {a.targetType}:{a.targetId?.slice(0, 8) ?? '—'}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!audit.length && <p className="p-4 text-slate-500">No audit entries yet</p>}
      </div>
    </div>
  )
}
