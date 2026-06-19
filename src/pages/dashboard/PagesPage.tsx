import { useEffect, useState } from 'react'
import { Globe, Link2, Pause, Play, Trash2 } from 'lucide-react'
import { api, type FacebookPage } from '../../api/client'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function PagesPage() {
  const toast = useToast()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [mockMode, setMockMode] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const [{ pages: p }, status] = await Promise.all([api.pages.list(), api.facebook.status()])
      setPages(p)
      setMockMode(status.mockMode)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load pages')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      if (mockMode) {
        const res = await api.facebook.connectMock()
        toast.success(res.message || `Connected ${res.pagesConnected} page(s)`)
      } else {
        const { url } = await api.facebook.oauthUrl()
        window.location.href = url
        return
      }
      await load()
    } catch (err) {
      const msg = getApiError(err, 'Failed to connect')
      setError(msg)
      toast.error(msg)
    } finally {
      setConnecting(false)
    }
  }

  async function toggleStatus(page: FacebookPage) {
    const newStatus = page.status === 'active' ? 'paused' : 'active'
    try {
      await api.pages.update(page.id, { status: newStatus })
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, status: newStatus as 'active' | 'paused' } : p)))
      toast.success(`Page ${newStatus === 'active' ? 'activated' : 'paused'}`)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update page status'))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this page?')) return
    try {
      await api.pages.delete(id)
      setPages((prev) => prev.filter((p) => p.id !== id))
      toast.success('Page removed')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove page'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Facebook Pages</h1>
          <p className="text-sm text-muted-foreground">
            Connect and manage your Facebook pages for automated publishing.
            {mockMode && ' (Demo mode — set FACEBOOK_APP_ID for real OAuth)'}
          </p>
        </div>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Link2 className="h-4 w-4" />
          {connecting ? 'Connecting...' : 'Connect Page'}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {loadError && !loading && pages.length === 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : pages.length === 0 ? (
        <div className="marketing-card py-12 text-center">
          <Globe className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-muted-foreground">No Facebook pages connected yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((page) => (
            <div key={page.id} className="marketing-card flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{page.name}</p>
                  <p className="text-sm text-muted-foreground">{page.followers} followers · {page.reelsPostedToday} reels today</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={page.status} />
                <button onClick={() => toggleStatus(page)} className="rounded-lg border border-border p-2 hover:bg-muted" title={page.status === 'active' ? 'Pause' : 'Activate'}>
                  {page.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button onClick={() => handleDelete(page.id)} className="rounded-lg border border-border p-2 text-red-600 hover:bg-red-50">
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
