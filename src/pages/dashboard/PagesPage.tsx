import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Globe, Link2, Pause, Play, Trash2 } from 'lucide-react'
import { api, type ByocApp, type FacebookPage } from '../../api/client'
import { ByocOAuthGuide } from '../../components/ByocOAuthGuide'
import { MagicConnectLink } from '../../components/MagicConnectLink'
import { StatusBadge } from '../../components/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function PagesPage() {
  const toast = useToast()
  const { agency } = useAuth()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [byocApps, setByocApps] = useState<ByocApp[]>([])
  const [selectedAppId, setSelectedAppId] = useState('')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [mockMode, setMockMode] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const [{ pages: p }, status, byoc] = await Promise.all([
        api.pages.list(),
        api.facebook.status(),
        api.byoc.listApps('facebook'),
      ])
      setPages(p)
      setMockMode(status.mockMode)
      setByocApps(byoc.apps)
      if (byoc.apps.length === 1) setSelectedAppId(byoc.apps[0].id)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load pages')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleConnect() {
    if (!mockMode && byocApps.length > 1 && !selectedAppId) {
      toast.error('Select which Facebook Developer app to use')
      return
    }

    setConnecting(true)
    setError('')
    try {
      if (mockMode) {
        const res = await api.facebook.connectMock(selectedAppId || undefined)
        toast.success(res.message || `Connected ${res.pagesConnected} page(s)`)
      } else {
        const { url } = await api.facebook.oauthUrl(selectedAppId || undefined)
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

  const selectedApp = byocApps.find((a) => a.id === selectedAppId)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Facebook Pages</h1>
          <p className="text-sm text-muted-foreground">
            Connect Facebook accounts to this agency. Add as many BYOC apps as you need — each supports ~50 test users in Development mode.
            {mockMode && ' (Demo mode — add BYOC apps in Settings for real OAuth)'}
          </p>
        </div>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Link2 className="h-4 w-4" />
          {connecting ? 'Connecting...' : 'Connect Account'}
        </button>
      </div>

      {byocApps.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <label className="text-sm font-medium">Facebook Developer App</label>
          <select
            value={selectedAppId}
            onChange={(e) => setSelectedAppId(e.target.value)}
            className="h-10 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
          >
            {byocApps.length > 1 && <option value="">Select an app...</option>}
            {byocApps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.label} ({app.linkedAccounts}/50 accounts)
              </option>
            ))}
          </select>
          {selectedApp && selectedApp.linkedAccounts >= 45 && (
            <p className="text-xs text-orange-600">
              This app is near the Development mode limit.{' '}
              <Link to="/settings/facebook-byoc" className="underline">
                Add another app
              </Link>{' '}
              to connect more accounts.
            </p>
          )}
          {!mockMode && selectedAppId && (
            <MagicConnectLink byocCredentialId={selectedAppId} appLabel={selectedApp?.label} compact />
          )}
          <p className="text-xs text-muted-foreground">
            Manage apps in{' '}
            <Link to="/settings/facebook-byoc" className="text-primary hover:underline">
              Facebook BYOC Settings
            </Link>
          </p>
        </div>
      )}

      {!byocApps.length && !mockMode && (
        <div className="space-y-3">
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">
            Add at least one Facebook Developer app before connecting accounts.
          </p>
          <ByocOAuthGuide subdomain={agency?.subdomain} compact />
          <p className="text-sm text-muted-foreground">
            Then save credentials in{' '}
            <Link to="/settings/facebook-byoc" className="text-primary hover:underline">
              Facebook BYOC Settings
            </Link>
          </p>
        </div>
      )}

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
                  <p className="text-sm text-muted-foreground">
                    {page.followers} followers · {page.reelsPostedToday} reels today
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={page.status} />
                <button
                  onClick={() => toggleStatus(page)}
                  className="rounded-lg border border-border p-2 hover:bg-muted"
                  title={page.status === 'active' ? 'Pause' : 'Activate'}
                >
                  {page.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleDelete(page.id)}
                  className="rounded-lg border border-border p-2 text-red-600 hover:bg-red-50"
                >
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
