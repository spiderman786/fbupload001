import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, type SourceAccount } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', tokens: 1 },
  { value: 'tiktok', label: 'TikTok', tokens: 2 },
  { value: 'youtube', label: 'YouTube', tokens: 2 },
  { value: 'facebook', label: 'Facebook', tokens: 2 },
]

export function SourcesPage({ embedded = false }: { embedded?: boolean }) {
  const toast = useToast()
  const [sources, setSources] = useState<SourceAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [platform, setPlatform] = useState('instagram')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const { sources: s } = await api.sources.list()
      setSources(s)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load sources')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const { source } = await api.sources.create({ platform, username })
      setSources((prev) => [source, ...prev])
      setUsername('')
      setShowForm(false)
      toast.success('Source account added')
    } catch (err) {
      const msg = getApiError(err, 'Failed to add source')
      setError(msg)
      toast.error(msg)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this source?')) return
    try {
      await api.sources.delete(id)
      setSources((prev) => prev.filter((s) => s.id !== id))
      toast.success('Source removed')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove source'))
    }
  }

  async function toggleActive(source: SourceAccount) {
    try {
      const { source: updated } = await api.sources.update(source.id, { isActive: !source.isActive })
      setSources((prev) => prev.map((s) => (s.id === source.id ? updated : s)))
      toast.success(updated.isActive ? 'Source enabled' : 'Source disabled')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update source'))
    }
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">Source Accounts</h1>
            <p className="text-sm text-muted-foreground">
              Add Instagram, TikTok, YouTube, or Facebook usernames to download reels from.
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Source
          </button>
        </div>
      )}

      {embedded && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Source
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="marketing-card space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label} ({p.tokens} token{p.tokens > 1 ? 's' : ''}/reel)</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <input
                required
                placeholder="@username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}

      {loadError && !loading && sources.length === 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : sources.length === 0 ? (
        <div className="marketing-card py-12 text-center text-muted-foreground">No source accounts yet.</div>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <div key={source.id} className="marketing-card flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{source.username}</p>
                <p className="text-sm capitalize text-muted-foreground">{source.platform}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium">
                  {source.tokensPerReel} token{source.tokensPerReel > 1 ? 's' : ''}/reel
                </span>
                <button onClick={() => toggleActive(source)} className="text-sm text-primary hover:underline">
                  {source.isActive ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => handleDelete(source.id)} className="rounded-lg border border-border p-2 text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
