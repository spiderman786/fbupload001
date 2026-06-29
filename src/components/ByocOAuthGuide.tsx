import { Check, Copy } from 'lucide-react'
import { getAgencyOAuthRedirectUris, resolveAppBaseDomain } from '../lib/byocUrls'
import { useToast } from '../context/ToastContext'

type Props = {
  subdomain?: string | null
  compact?: boolean
  verified?: boolean
}

function CopyField({ label, value }: { label: string; value: string }) {
  const toast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
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
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
    </div>
  )
}

export function ByocOAuthGuide({ subdomain, compact, verified }: Props) {
  const uris = getAgencyOAuthRedirectUris(subdomain)
  const [primary, secondary] = uris

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      {verified && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">App credentials verified</p>
            <p className="text-xs text-primary/80">Your agency is ready to connect Facebook accounts.</p>
          </div>
        </div>
      )}

      {!compact && (
        <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
          <li>Create an app at Meta Developer (developers.facebook.com)</li>
          <li>Add the <strong className="text-foreground">Facebook Login</strong> product</li>
          <li>Paste the redirect URI(s) below under Facebook Login → Settings → Valid OAuth Redirect URIs</li>
          <li>Copy App ID + App Secret into the form below, then save</li>
        </ol>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">OAuth redirect URIs</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Add {uris.length > 1 ? 'both URLs' : 'this URL'} under{' '}
          <strong className="text-foreground">Facebook Login → Settings</strong> as{' '}
          <strong className="text-foreground">Valid OAuth Redirect URIs</strong>.
        </p>
        <div className="space-y-3">
          {secondary ? (
            <>
              <CopyField label={`Agency callback (${subdomain})`} value={primary} />
              <CopyField label="App callback (fallback)" value={secondary} />
            </>
          ) : (
            <CopyField label="OAuth callback" value={primary} />
          )}
        </div>
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground">
          Privacy policy for Live mode:{' '}
          <span className="font-mono text-foreground">{`https://app.${resolveAppBaseDomain()}/privacy`}</span>
        </p>
      )}
    </div>
  )
}
