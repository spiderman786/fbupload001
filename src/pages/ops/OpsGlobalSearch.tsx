import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api, type OpsSearchResults } from '../../api/client'

export function OpsGlobalSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OpsSearchResults | null>(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      api.ops.search(q.trim()).then(setResults).catch(() => setResults(null))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search agencies, pages, jobs, errors…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
        />
      </div>
      {open && results && q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {!results.agencies.length && !results.pages.length && !results.jobs.length && (
            <p className="p-3 text-sm text-slate-500">No results</p>
          )}
          {results.agencies.length > 0 && (
            <div className="border-b border-slate-800 p-2">
              <p className="px-2 py-1 text-xs font-medium text-slate-500">Agencies</p>
              {results.agencies.map((a) => (
                <Link
                  key={a.id}
                  to={`/ops/agencies/${a.id}`}
                  onClick={() => setOpen(false)}
                  className="block rounded px-2 py-1.5 text-sm hover:bg-slate-800"
                >
                  {a.name} <span className="text-slate-500">· {a.token_balance} tokens</span>
                </Link>
              ))}
            </div>
          )}
          {results.pages.length > 0 && (
            <div className="border-b border-slate-800 p-2">
              <p className="px-2 py-1 text-xs font-medium text-slate-500">Pages</p>
              {results.pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate('/ops/pages')
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                >
                  {p.name} <span className="text-slate-500">· {p.agency_name}</span>
                </button>
              ))}
            </div>
          )}
          {results.jobs.length > 0 && (
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-medium text-slate-500">Jobs</p>
              {results.jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    navigate('/ops/jobs')
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                >
                  <span className="font-mono text-xs text-slate-500">{j.id.slice(0, 8)}</span>{' '}
                  {j.status} · {j.agency_name ?? '—'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
