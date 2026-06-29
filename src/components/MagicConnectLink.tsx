import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, Link2, RefreshCw } from 'lucide-react'
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

type LinkOption = {
  id: string
  label: string
  value: string
  hint?: string
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

function buildLinkOptions(data: MagicLinkData): LinkOption[] {
  const hasAgency = Boolean(data.agencySubdomain && data.agencyCallbackUrl)
  if (hasAgency) {
    return [
      {
        id: 'connect',
        label: `Connect link (${data.agencySubdomain})`,
        value: data.url,
        hint: 'Open while signed in to connect Facebook profiles',
      },
      {
        id: 'callback',
        label: `OAuth callback for Meta (${data.agencySubdomain})`,
        value: data.agencyCallbackUrl!,
        hint: 'Paste in Meta → Facebook Login → Valid OAuth Redirect URIs',
      },
      {
        id: 'fallback',
        label: 'App connect link (fallback)',
        value: data.appUrl,
        hint: 'Use if agency subdomain is unavailable',
      },
    ]
  }
  return [
    {
      id: 'connect',
      label: 'Connect link',
      value: data.url,
      hint: 'Open while signed in to connect Facebook profiles',
    },
  ]
}

export function MagicConnectLink({ byocCredentialId, appLabel, compact }: Props) {
  const toast = useToast()
  const [data, setData] = useState<MagicLinkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [selectedLinkId, setSelectedLinkId] = useState('connect')

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

  const linkOptions = useMemo(() => (data ? buildLinkOptions(data) : []), [data])
  const selectedLink = linkOptions.find((o) => o.id === selectedLinkId) ?? linkOptions[0]
  const hasAgency = Boolean(data?.agencySubdomain && data?.agencyCallbackUrl)

  async function copySelected() {
    if (!selectedLink) return
    try {
      await navigator.clipboard.writeText(selectedLink.value)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading connect link…</p>
  }

  if (!data?.url) return null

  const expiresLabel = data.expiresAt
    ? new Date(data.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  if (compact) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold text-foreground">Magic connect link</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => load(true)}
              disabled={regenerating}
              title="Generate a new link"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
              New
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <select
              value={selectedLink?.id ?? 'connect'}
              onChange={(e) => setSelectedLinkId(e.target.value)}
              className="h-9 w-full appearance-none rounded-md border border-border bg-background py-0 pr-8 pl-3 text-xs font-medium"
            >
              {linkOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button
            type="button"
            onClick={copySelected}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </button>
        </div>

        {selectedLink?.hint && <p className="text-xs text-muted-foreground">{selectedLink.hint}</p>}

        <p className="text-xs text-muted-foreground">
          {hasAgency ? `Agency workspace · expires ${expiresLabel}` : `Expires ${expiresLabel}`}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {`Magic connect link${appLabel ? ` — ${appLabel}` : ''}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasAgency
              ? `Uses your agency workspace (${data.agencySubdomain}.fbuploadplus.com). Copy the connect link, open it while signed in, then authorize each Facebook profile. Valid until ${expiresLabel}.`
              : `Copy the link, open while signed into FBupload Plus, then authorize each Facebook profile. Valid until ${expiresLabel}.`}
          </p>
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

      <CopyRow
        label={hasAgency ? `Connect link (${data.agencySubdomain})` : 'Connect link'}
        value={data.url}
      />

      {hasAgency && (
        <details className="group rounded-md border border-border/60 bg-background/50">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              Meta setup links (OAuth callback &amp; fallback)
            </span>
          </summary>
          <div className="space-y-3 border-t border-border/60 px-3 pt-3 pb-3">
            <CopyRow label={`OAuth callback for Meta (${data.agencySubdomain})`} value={data.agencyCallbackUrl!} />
            <CopyRow label="App connect link (fallback)" value={data.appUrl} />
          </div>
        </details>
      )}
    </div>
  )
}
