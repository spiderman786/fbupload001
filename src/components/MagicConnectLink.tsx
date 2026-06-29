import { useCallback, useEffect, useState } from 'react'
import { Copy, Link2, RefreshCw } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

type MagicLinkData = {
  url: string
  appUrl: string
  agencyCallbackUrl: string | null
  appCallbackUrl: string
  agencySubdomain: string | null
  expiresAt: string
}

type Props = {
  byocCredentialId?: string
  appLabel?: string
  compact?: boolean
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
    </div>
  )
}

export function MagicConnectLink({ byocCredentialId, appLabel, compact }: Props) {
  const toast = useToast()
  const [data, setData] = useState<MagicLinkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  const load = useCallback(
    async (regenerate = false) => {
      if (regenerate) setRegenerating(true)
      else setLoading(true)
      try {
        const res = regenerate
          ? await api.facebook.createMagicLink(byocCredentialId, { regenerate: true })
          : await api.facebook.getMagicLink(byocCredentialId)
        setData(res)
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

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading connect link…</p>
  }

  if (!data?.url) return null

  const expiresLabel = data.expiresAt
    ? new Date(data.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  const hasAgency = Boolean(data.agencySubdomain && data.agencyCallbackUrl)

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {compact ? 'Magic connect link' : `Magic connect link${appLabel ? ` — ${appLabel}` : ''}`}
          </p>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground">
              {hasAgency
                ? `Uses your agency workspace (${data.agencySubdomain}.fbuploadplus.com). Copy the connect link, open it while signed in, then authorize each Facebook profile. Valid until ${expiresLabel}.`
                : `Copy the link, open while signed into FBupload Plus, then authorize each Facebook profile. Valid until ${expiresLabel}.`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={regenerating}
          title="Generate a new link"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          New
        </button>
      </div>

      {hasAgency ? (
        <>
          <CopyRow label={`Connect link (${data.agencySubdomain})`} value={data.url} />
          <CopyRow label={`OAuth callback for Meta (${data.agencySubdomain})`} value={data.agencyCallbackUrl!} />
          <CopyRow label="App connect link (fallback)" value={data.appUrl} />
        </>
      ) : (
        <CopyRow label="Connect link" value={data.url} />
      )}

      {compact && (
        <p className="text-xs text-muted-foreground">
          {hasAgency
            ? `Agency workspace link · expires ${expiresLabel}`
            : `Open while signed in · expires ${expiresLabel}`}
        </p>
      )}
    </div>
  )
}
