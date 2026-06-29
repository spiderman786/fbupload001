import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

type Props = {
  byocCredentialId?: string
  appLabel?: string
  compact?: boolean
}

export function MagicConnectLink({ byocCredentialId, appLabel, compact }: Props) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  const load = useCallback(
    async (regenerate = false) => {
      if (regenerate) setRegenerating(true)
      else setLoading(true)
      try {
        const data = regenerate
          ? await api.facebook.createMagicLink(byocCredentialId, { regenerate: true })
          : await api.facebook.getMagicLink(byocCredentialId)
        setUrl(data.url)
        setExpiresAt(data.expiresAt)
      } catch (err) {
        toast.error(getApiError(err, 'Failed to load connect link'))
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [byocCredentialId, toast],
  )

  useEffect(() => {
    load()
  }, [load])

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Connect link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading connect link…</p>
  }

  if (!url) return null

  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {compact ? 'Magic connect link' : `Magic connect link${appLabel ? ` — ${appLabel}` : ''}`}
          </p>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground">
              Copy this link, open it in a browser where you&apos;re signed into FBupload Plus, then log into each
              Facebook profile to authorize. Reuse the same link for every profile — valid until {expiresLabel}.
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={regenerating}
          title="Generate a new link (invalidates the old one)"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          New
        </button>
      </div>

      {compact && (
        <p className="text-xs text-muted-foreground">
          Open while signed into FBupload Plus → authorize each FB profile. Expires {expiresLabel}.
        </p>
      )}
    </div>
  )
}
