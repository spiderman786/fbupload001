import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, Plus, Settings, Trash2 } from 'lucide-react'
import { api, type ByocApp } from '../../api/client'
import { ByocOAuthGuide } from '../../components/ByocOAuthGuide'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'
import { primaryOAuthRedirectUri } from '../../lib/byocUrls'

export function FacebookByocPage() {
  const toast = useToast()
  const { agency } = useAuth()
  const [apps, setApps] = useState<ByocApp[]>([])
  const [envFallback, setEnvFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [label, setLabel] = useState('')
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(() => primaryOAuthRedirectUri(agency?.subdomain))

  useEffect(() => {
    setRedirectUri(primaryOAuthRedirectUri(agency?.subdomain))
  }, [agency?.subdomain])

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
      toast.success('Facebook Developer app added — ready to connect accounts')
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
        <h1 className="font-display text-2xl font-bold">Facebook BYOC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add unlimited Meta Developer apps to this agency. Each app supports ~50 test users in Development mode — keep adding App 4, App 5, and so on. All pages and tokens stay on one account.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="font-medium">
              {apps.length} developer app{apps.length !== 1 ? 's' : ''} · {totalLinked} connected account
              {totalLinked !== 1 ? 's' : ''}
            </p>
            {agency?.subdomain && (
              <p className="mt-1 text-xs text-muted-foreground">
                Agency workspace:{' '}
                <span className="font-medium text-foreground">{agency.subdomain}.fbuploadplus.com</span>
              </p>
            )}
            {envFallback && (
              <p className="mt-2 text-xs text-muted-foreground">
                Platform .env fallback is available when no BYOC apps are configured.
              </p>
            )}
          </div>

          <div className="space-y-4">
            {apps.map((app) => (
              <div key={app.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-primary" />
                    <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      BYOC configuration
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(app)}
                    disabled={app.linkedAccounts > 0}
                    title={app.linkedAccounts > 0 ? 'Disconnect accounts first' : 'Remove app'}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>

                <div className="space-y-4 p-4">
                  <div>
                    <h3 className="font-display text-xl font-bold">{app.label}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">App ID: {app.appId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {app.linkedAccounts} account{app.linkedAccounts !== 1 ? 's' : ''} connected
                      {app.linkedAccounts >= 50 && (
                        <span className="ml-1 text-orange-600">· near dev-mode limit — add another app</span>
                      )}
                    </p>
                  </div>

                  <ByocOAuthGuide subdomain={agency?.subdomain} compact verified />

                  <div className="space-y-1">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Redirect URI saved</p>
                    <p className="font-mono text-xs break-all text-foreground">{app.redirectUri}</p>
                  </div>
                </div>
              </div>
            ))}

            {!apps.length && !showForm && (
              <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                No Facebook Developer apps yet. Add your first app below.
              </div>
            )}
          </div>

          {showForm ? (
            <div className="space-y-4">
              <ByocOAuthGuide subdomain={agency?.subdomain} />

              <form onSubmit={handleAdd} className="marketing-card space-y-4">
                <p className="text-sm font-semibold">Step 4 — Enter app credentials</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">App label</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. videos hub, App 2 — Batch B"
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
                  <div className="relative">
                    <input
                      required
                      type={showSecret ? 'text' : 'password'}
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">OAuth redirect URI (must match Meta)</label>
                  <input
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-xs"
                  />
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
                    {saving ? 'Verifying...' : 'Save & verify app'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              {apps.length ? 'Add another Facebook app' : 'Add Facebook Developer app'}
            </button>
          )}

          <p className="text-sm text-muted-foreground">
            After saving, go to{' '}
            <Link to="/facebook/accounts" className="text-primary hover:underline">
              Facebook Accounts
            </Link>{' '}
            — pick which app to use, then connect up to ~50 accounts per app (Development mode).
          </p>
        </>
      )}
    </div>
  )
}
