import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type OpsAgency, type OpsMember, type OpsNote } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function OpsAgenciesPage() {
  const [agencies, setAgencies] = useState<OpsAgency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.ops
      .agencies()
      .then((r) => setAgencies(r.agencies as OpsAgency[]))
      .catch((err) => setError(getApiError(err, 'Failed to load agencies')))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-slate-400">Loading agencies…</p>
  if (error) return <p className="text-red-400">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Agencies</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a) => (
              <tr key={a.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
                <td className="px-4 py-3">
                  <Link to={`/ops/agencies/${a.id}`} className="font-medium text-emerald-400 hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300">{a.owner_email ?? '—'}</td>
                <td className="px-4 py-3">{a.page_count ?? 0}</td>
                <td className="px-4 py-3">{a.member_count ?? 0}</td>
                <td className="px-4 py-3">{a.token_balance?.toLocaleString() ?? 0}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(a.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function OpsAgencyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const toast = useToast()
  const [agency, setAgency] = useState<OpsAgency | null>(null)
  const [members, setMembers] = useState<OpsMember[]>([])
  const [notes, setNotes] = useState<OpsNote[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [creditAmount, setCreditAmount] = useState('1000')
  const [noteText, setNoteText] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const r = await api.ops.agency(id)
      setAgency(r.agency as OpsAgency)
      setMembers(r.members)
      setNotes(r.notes)
      setPageCount(r.pages.length)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load agency'))
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    load()
  }, [load])

  async function handleCredit() {
    if (!id) return
    const amount = Number(creditAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      const r = await api.ops.creditTokens(id, amount)
      toast.success(`Credited ${amount} tokens (balance: ${r.tokenBalance})`)
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Credit failed'))
    }
  }

  async function handleNote() {
    if (!id || !noteText.trim()) return
    try {
      await api.ops.addNote(id, noteText.trim())
      setNoteText('')
      toast.success('Note saved')
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to save note'))
    }
  }

  async function handleImpersonate() {
    if (!id) return
    try {
      const session = await api.ops.impersonate(id)
      setSession(session)
      toast.success('Switched to agency context')
      navigate('/dashboard')
    } catch (err) {
      toast.error(getApiError(err, 'Impersonation failed'))
    }
  }

  if (loading) return <p className="text-slate-400">Loading…</p>
  if (!agency) return <p className="text-red-400">Agency not found</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/ops/agencies" className="text-sm text-slate-400 hover:text-slate-200">
            ← Agencies
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{agency.name}</h1>
          <p className="text-sm text-slate-400">{pageCount} pages · {agency.token_balance?.toLocaleString()} tokens</p>
        </div>
        <button
          type="button"
          onClick={handleImpersonate}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
        >
          Open as agency
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Credit tokens</h2>
          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button type="button" onClick={handleCredit} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">
              Credit
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Members</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.email} className="text-slate-300">
                {m.email} <span className="text-slate-500">({m.role})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-medium">Ops notes</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Internal note about this agency…"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <button type="button" onClick={handleNote} className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800">
            Add
          </button>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-slate-950/50 p-3">
              <p>{n.note}</p>
              <p className="mt-1 text-xs text-slate-500">
                {n.admin_email} · {new Date(n.created_at).toLocaleString()}
              </p>
            </li>
          ))}
          {!notes.length && <p className="text-slate-500">No notes yet</p>}
        </ul>
      </div>
    </div>
  )
}
