import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Settings, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function FacebookByocPage() {
  const toast = useToast()
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState('http://localhost:5173/facebook/callback')
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.byoc.get>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.byoc.get('facebook').then((data) => {
      setInfo(data)
      if (data.appId) setAppId(data.appId)
      if (data.redirectUri) setRedirectUri(data.redirectUri)
    }).finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.byoc.save('facebook', { appId, appSecret, redirectUri })
      const updated = await api.byoc.get('facebook')
      setInfo(updated)
      toast.success('Facebook BYOC credentials saved')
      setAppSecret('')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">Facebook BYOC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring Your Own Connection — use your Meta Developer app for OAuth and publishing.
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
              <ShieldCheck className={`h-4 w-4 ${info?.configured ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="font-medium">
                {info?.configured ? 'OAuth configured' : 'Not configured'}
              </span>
            </div>
            {info?.usingEnvFallback && (
              <p className="mt-2 text-xs text-muted-foreground">Using server .env credentials as fallback.</p>
            )}
            {info?.appId && <p className="mt-1 text-xs text-muted-foreground">App ID: {info.appId}</p>}
          </div>

          <form onSubmit={handleSubmit} className="marketing-card space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">App ID</label>
              <input
                required
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="Your Meta App ID"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">App Secret</label>
              <input
                required={!info?.hasByoc}
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={info?.hasByoc ? '•••••••• (leave blank to keep)' : 'App Secret'}
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
              <p className="text-xs text-muted-foreground">Add this exact URI in Meta Developer → Facebook Login → Valid OAuth Redirect URIs</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save credentials'}
            </button>
          </form>

          <p className="text-sm text-muted-foreground">
            After saving, connect pages via{' '}
            <Link to="/facebook/accounts" className="text-primary hover:underline">Facebook Accounts</Link>.
          </p>
        </>
      )}
    </div>
  )
}
