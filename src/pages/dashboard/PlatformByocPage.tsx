import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, Plus, Settings, Trash2 } from 'lucide-react'
import { api, type ByocApp } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'
import { primaryOAuthRedirectUri } from '../../lib/byocUrls'

type Platform = 'youtube' | 'instagram'

const META: Record<Platform, { title: string; description: string; connectHint: string }> = {
  youtube: {
    title: 'YouTube BYOC',
    description: 'Store YouTube Data API credentials for future channel connect and upload features.',
    connectHint: 'YouTube channels can already be used as reel download sources in Auto Download/Upload.',
  },
  instagram: {
    title: 'Instagram BYOC',
    description: 'Store Instagram Graph API credentials for future account connect and publish features.',
    connectHint: 'Instagram creators can already be used as reel download sources in Auto Download/Upload.',
  },
}

export function PlatformByocPage({ platform }: { platform: Platform }) {
  const meta = META[platform]
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
      const data = await api.byoc.listApps(platform)
      setApps(data.apps)
      setEnvFallback(data.envFallback)
    } catch (err) {
      toast.error(getApiError(err, `Failed to load ${platform} apps`))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [platform])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.byoc.createApp(platform, { label, appId, appSecret, redirectUri })
      toast.success('Developer app saved')
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
      await api.byoc.deleteApp(platform, app.id)
      toast.success('App removed')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove app'))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">{meta.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <p>{meta.connectHint}</p>
            <p className="mt-2">
              <Link to="/facebook/auto-download-upload" className="text-primary hover:underline">
                Open Auto Download/Upload
              </Link>{' '}
              to assign {platform === 'youtube' ? 'YouTube' : 'Instagram'} creators as sources.
            </p>
            {envFallback ? (
              <p className="mt-2 text-xs text-muted-foreground">Platform .env fallback is available when no BYOC apps are configured.</p>
            ) : null}
          </div>

          <div className="space-y-4">
            {apps.map((app) => (
              <div key={app.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{app.label}</h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">App ID: {app.appId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(app)}
                    disabled={app.linkedAccounts > 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {!apps.length && !showForm ? (
              <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                No apps configured yet.
              </div>
            ) : null}
          </div>

          {showForm ? (
            <form onSubmit={handleAdd} className="marketing-card space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">App label</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Client ID / App ID</label>
                <input required value={appId} onChange={(e) => setAppId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Client Secret</label>
                <div className="relative">
                  <input
                    required
                    type={showSecret ? 'text' : 'password'}
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm"
                  />
                  <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground">
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save app'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
              <Plus className="h-4 w-4" />
              Add developer app
            </button>
          )}
        </>
      )}
    </div>
  )
}
