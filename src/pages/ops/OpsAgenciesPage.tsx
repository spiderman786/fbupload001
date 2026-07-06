import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type OpsAgency, type OpsMember, type OpsNote } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const CREDIT_PRESETS = [500, 1000, 5000, 10000, 50000]

function HealthBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const colors =
    status === 'healthy'
      ? 'bg-emerald-500/15 text-emerald-400'
      : status === 'warning'
        ? 'bg-amber-500/15 text-amber-400'
        : 'bg-red-500/15 text-red-400'
  return <span className={`rounded px-2 py-0.5 text-xs ${colors}`}>{status}</span>
}

export function OpsAgenciesPage() {
  const [agencies, setAgencies] = useState<OpsAgency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creditId, setCreditId] = useState<string | null>(null)
  const [creditAmount, setCreditAmount] = useState('1000')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.ops.agencies()
      const nextAgencies = r.agencies as OpsAgency[]
      setAgencies(nextAgencies)
      setSelectedIds((ids) => ids.filter((id) => nextAgencies.some((a) => a.id === id && a.name !== 'Platform Ops')))
    } catch (err) {
      setError(getApiError(err, 'Failed to load agencies'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function quickCredit(agencyId: string) {
    const amount = Number(creditAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      const r = await api.ops.creditTokens(agencyId, amount)
      toast.success(`Added ${amount} tokens (balance: ${r.tokenBalance})`)
      setCreditId(null)
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Credit failed'))
    }
  }

  function toggleSelected(agencyId: string) {
    setSelectedIds((ids) => (ids.includes(agencyId) ? ids.filter((id) => id !== agencyId) : [...ids, agencyId]))
  }

  async function deleteSingleAgency(agency: OpsAgency) {
    if (agency.name === 'Platform Ops') {
      toast.error('Platform Ops cannot be deleted')
      return
    }

    const confirmName = window.prompt(`Type "${agency.name}" to permanently delete this agency.`)
    if (confirmName === null) return
    if (confirmName.trim() !== agency.name) {
      toast.error('Agency name confirmation did not match')
      return
    }

    setDeletingId(agency.id)
    try {
      await api.ops.deleteAgency(agency.id, confirmName.trim())
      toast.success(`Deleted ${agency.name}`)
      setSelectedIds((ids) => ids.filter((id) => id !== agency.id))
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Delete failed'))
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteSelectedAgencies() {
    const selected = agencies.filter((a) => selectedIds.includes(a.id) && a.name !== 'Platform Ops')
    if (!selected.length) {
      toast.error('Select at least one deletable agency')
      return
    }

    const confirmText = window.prompt(
      `This will permanently delete ${selected.length} agenc${selected.length === 1 ? 'y' : 'ies'}.\nType DELETE SELECTED AGENCIES to confirm.`,
    )
    if (confirmText === null) return
    if (confirmText.trim() !== 'DELETE SELECTED AGENCIES') {
      toast.error('Bulk delete confirmation did not match')
      return
    }

    setBulkDeleting(true)
    try {
      const result = await api.ops.bulkDeleteAgencies(selected.map((a) => a.id), confirmText.trim())
      if (result.deleted.length) {
        toast.success(`Deleted ${result.deleted.length} agenc${result.deleted.length === 1 ? 'y' : 'ies'}`)
      }
      if (result.failed.length) {
        toast.error(`${result.failed.length} failed to delete. Check child agencies or protected records.`)
      }
      setSelectedIds([])
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Bulk delete failed'))
    } finally {
      setBulkDeleting(false)
    }
  }

  if (loading) return <p className="text-slate-400">Loading agencies…</p>
  if (error) return <p className="text-red-400">{error}</p>

  const selectableAgencies = agencies.filter((a) => a.name !== 'Platform Ops')
  const allSelected = selectableAgencies.length > 0 && selectableAgencies.every((a) => selectedIds.includes(a.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agencies</h1>
          <p className="text-sm text-slate-400">Health scores, token credits, reseller hierarchy (v3.1)</p>
        </div>
        <button
          type="button"
          onClick={deleteSelectedAgencies}
          disabled={!selectedIds.length || bulkDeleting}
          className="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {bulkDeleting ? 'Deleting…' : `Delete selected${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelectedIds(e.target.checked ? selectableAgencies.map((a) => a.id) : [])}
                  aria-label="Select all agencies"
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Health</th>
              <th className="px-4 py-3">Client / owner</th>
              <th className="px-4 py-3">Parent</th>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a) => (
              <tr key={a.id} className="border-b border-slate-800/60 hover:bg-slate-900/50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    disabled={a.name === 'Platform Ops'}
                    aria-label={`Select ${a.name}`}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 disabled:opacity-30"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link to={`/ops/agencies/${a.id}`} className="font-medium text-emerald-400 hover:underline">
                    {a.name}
                  </Link>
                  {a.maintenance_mode ? (
                    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-400">maint</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <HealthBadge status={a.healthStatus} />
                  {a.healthScore != null && <span className="ml-1 text-xs text-slate-500">{a.healthScore}</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">{a.owner_email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{a.parent_name ?? '—'}</td>
                <td className="px-4 py-3">{a.page_count ?? 0}</td>
                <td className="px-4 py-3">{a.token_balance?.toLocaleString() ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {creditId === a.id ? (
                      <>
                      <input
                        type="number"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                      />
                      <button type="button" onClick={() => quickCredit(a.id)} className="rounded bg-emerald-600 px-2 py-1 text-xs">
                        Add
                      </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCreditId(a.id)}
                        className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800"
                      >
                        + Tokens
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteSingleAgency(a)}
                      disabled={a.name === 'Platform Ops' || deletingId === a.id}
                      className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === a.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </td>
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
  const [allAgencies, setAllAgencies] = useState<OpsAgency[]>([])
  const [members, setMembers] = useState<OpsMember[]>([])
  const [notes, setNotes] = useState<OpsNote[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [creditAmount, setCreditAmount] = useState('1000')
  const [noteText, setNoteText] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [parentId, setParentId] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [r, list] = await Promise.all([api.ops.agency(id), api.ops.agencies()])
      const ag = r.agency as OpsAgency
      setAgency(ag)
      setMembers(r.members)
      setNotes(r.notes)
      setPageCount(r.pages.length)
      setParentId(ag.parent_agency_id ?? '')
      setAllAgencies(list.agencies.filter((a) => a.id !== id && a.name !== 'Platform Ops'))
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load agency'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function handleCredit(amount?: number) {
    if (!id) return
    const val = amount ?? Number(creditAmount)
    if (!Number.isFinite(val) || val <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      const r = await api.ops.creditTokens(id, val)
      toast.success(`Credited ${val} tokens (balance: ${r.tokenBalance})`)
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

  async function handleDelete() {
    if (!id || !agency) return
    try {
      await api.ops.deleteAgency(id, deleteConfirm)
      toast.success('Agency deleted')
      navigate('/ops/agencies')
    } catch (err) {
      toast.error(getApiError(err, 'Delete failed'))
    }
  }

  async function handleParentSave() {
    if (!id) return
    try {
      await api.ops.setParentAgency(id, parentId || null)
      toast.success('Parent agency updated')
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Update failed'))
    }
  }

  async function toggleMaintenance() {
    if (!id || !agency) return
    try {
      await api.ops.setAgencyMaintenance(id, !agency.maintenance_mode)
      toast.success(agency.maintenance_mode ? 'Maintenance off' : 'Maintenance on')
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Update failed'))
    }
  }

  async function handleMemberRole(userId: string, role: 'owner' | 'admin' | 'staff') {
    if (!id) return
    try {
      await api.ops.setMemberRole(id, userId, role)
      toast.success(`Role updated to ${role}`)
      load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update role'))
    }
  }

  if (loading) return <p className="text-slate-400">Loading…</p>
  if (!agency) return <p className="text-red-400">Agency not found</p>

  const isProtected = agency.name === 'Platform Ops'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/ops/agencies" className="text-sm text-slate-400 hover:text-slate-200">
            ← Agencies
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{agency.name}</h1>
          <p className="text-sm text-slate-400">
            {pageCount} pages · {agency.token_balance?.toLocaleString()} tokens
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleImpersonate} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">
            Open as agency
          </button>
          <button type="button" onClick={toggleMaintenance} className="rounded-lg border border-amber-600/50 px-4 py-2 text-sm text-amber-400 hover:bg-amber-500/10">
            {agency.maintenance_mode ? 'End maintenance' : 'Maintenance mode'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Add tokens</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {CREDIT_PRESETS.map((n) => (
              <button key={n} type="button" onClick={() => handleCredit(n)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800">
                +{n.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="number"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => handleCredit()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">
              Credit custom
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium">Reseller parent (v3.1)</h2>
          <div className="mt-3 flex gap-2">
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">No parent (standalone)</option>
              {allAgencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleParentSave} className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800">
              Save
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-medium">Members</h2>
        <p className="mt-1 text-xs text-slate-500">Change agency access role (e.g. owner → admin).</p>
        <ul className="mt-3 space-y-2 text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-slate-200">{m.email}</p>
                {m.full_name ? <p className="truncate text-xs text-slate-500">{m.full_name}</p> : null}
              </div>
              <select
                value={m.role}
                onChange={(e) => handleMemberRole(m.user_id, e.target.value as 'owner' | 'admin' | 'staff')}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm capitalize"
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-medium">Ops notes</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Internal note…"
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
        </ul>
      </div>

      {!isProtected && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <h2 className="font-medium text-red-400">Delete agency</h2>
          <p className="mt-1 text-sm text-slate-400">Permanently removes agency, pages, jobs, and sources. Type the agency name to confirm.</p>
          <div className="mt-3 flex gap-2">
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={agency.name}
              className="min-w-0 flex-1 rounded-lg border border-red-500/30 bg-slate-950 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteConfirm !== agency.name}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm disabled:opacity-40 hover:bg-red-500"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
