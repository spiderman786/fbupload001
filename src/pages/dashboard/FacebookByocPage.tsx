import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Settings, ShieldCheck, Trash2 } from 'lucide-react'
import { api, type ByocApp } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const DEFAULT_REDIRECT = 'https://app.fbuploadplus.com/facebook/callback'

export function FacebookByocPage() {
  const toast = useToast()
  const [apps, setApps] = useState<ByocApp[]>([])
  const [envFallback, setEnvFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [label, setLabel] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT)

  async function load() {
    setLoading(true)
    try {
      const data = await api.byoc.listApps('facebook')
      setApps(data.apps)
      setEnvFallback(data.envFallback)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load Facebook apps'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.byoc.createApp('facebook', { label, appId, appSecret, redirectUri })
      toast.success('Facebook Developer app added')
      setLabel('')
      setAppId('')
      setAppSecret('')
      setShowForm(false)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to add app'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(app: ByocApp) {
    if (!confirm(`Remove "${app.label}"?`)) return
    try {
      await api.byoc.deleteApp('facebook', app.id)
      toast.success('App removed')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove app'))
    }
  }

  const totalLinked = apps.reduce((sum, a) => sum + a.linkedAccounts, 0)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">Facebook BYOC Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add multiple Meta Developer apps to one agency. Each app supports ~50 test users in Development mode — add App 2, App 3, etc. to scale without extra signups.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`h-4 w-4 ${apps.length || envFallback ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="font-medium">
                {apps.length} developer app{apps.length !== 1 ? 's' : ''} · {totalLinked} connected account{totalLinked !== 1 ? 's' : ''}
              </span>
            </div>
            {envFallback && (
              <p className="mt-2 text-xs text-muted-foreground">
                Platform .env fallback is available when no BYOC apps are configured.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {apps.map((app) => (
              <div key={app.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{app.label}</p>
                    <p className="text-xs text-muted-foreground">App ID: {app.appId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {app.linkedAccounts} account{app.linkedAccounts !== 1 ? 's' : ''} connected
                      {app.linkedAccounts >= 50 && (
                        <span className="ml-1 text-orange-600">· near dev-mode limit</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(app)}
                    disabled={app.linkedAccounts > 0}
                    title={app.linkedAccounts > 0 ? 'Disconnect accounts first' : 'Remove app'}
                    className="rounded-lg border border-border p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {!apps.length && (
              <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                No Facebook Developer apps yet. Add your first app below.
              </div>
            )}
          </div>

          {showForm ? (
            <form onSubmit={handleAdd} className="marketing-card space-y-4">
              <p className="text-sm font-semibold">Add Facebook Developer App</p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Label</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. App 2 — Client Batch B"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">App ID</label>
                <input
                  required
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="Meta App ID"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">App Secret</label>
                <input
                  required
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">OAuth Redirect URI</label>
                <input
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Add this URI in Meta Developer → Facebook Login → Valid OAuth Redirect URIs
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Add app'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Add another Facebook app
            </button>
          )}

          <p className="text-sm text-muted-foreground">
            When connecting accounts, choose which app to use. All pages stay in this agency with one token balance.{' '}
            <Link to="/facebook/accounts" className="text-primary hover:underline">
              Connect Facebook accounts
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
