import { useEffect, useState, type FormEvent } from 'react'
import { Coins, ExternalLink } from 'lucide-react'
import { api } from '../../api/client'
import { useAgencyRole, useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function AddTokensPage() {
  const { user } = useAuth()
  const { isOwner, canRequestTokens } = useAgencyRole()
  const toast = useToast()
  const [amount, setAmount] = useState(100)
  const [note, setNote] = useState('')
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [whatsappUrl, setWhatsappUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const totalPkr = amount * 0.5

  useEffect(() => {
    api.tokens
      .balance()
      .then((b) => setOwnerEmail(b.ownerEmail ?? null))
      .catch(() => {})
  }, [])

  if (!canRequestTokens) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="font-display text-2xl font-bold">Add Tokens</h1>
        <p className="text-sm text-muted-foreground">Only agency owners and admins can request token purchases.</p>
      </div>
    )
  }

  async function handleRequest(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const res = await api.tokens.request(amount, note)
      setWhatsappUrl(res.whatsappUrl)
      setMessage(res.message)
      if (res.ownerEmail) setOwnerEmail(res.ownerEmail)
      toast.success('WhatsApp request ready — complete payment to receive tokens')
    } catch (err) {
      const msg = getApiError(err, 'Request failed')
      setMessage(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Add Tokens</h1>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? 'Request a token top-up via WhatsApp. Tokens are credited manually after payment is confirmed.'
            : 'Request a token purchase — the agency owner or platform support credits tokens after payment.'}
          {' '}
          Current balance: <strong>{user?.tokenBalance ?? 0}</strong> tokens.
        </p>
      </div>

      {!isOwner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Admin access</p>
          <p className="mt-1 text-amber-800">
            You can request tokens via WhatsApp{ownerEmail ? ` (agency owner: ${ownerEmail})` : ''}. Support credits
            tokens after payment is verified.
          </p>
        </div>
      )}

      <form onSubmit={handleRequest} className="marketing-card space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Number of tokens</label>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <span className="font-display text-2xl font-bold">Rs {totalPkr.toLocaleString()}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">PKR 0.5 per token</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Payment reference or message"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Processing...' : isOwner ? 'Request via WhatsApp' : 'Request tokens from owner'}
        </button>
      </form>

      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10"
        >
          Open WhatsApp to complete purchase
          <ExternalLink className="h-4 w-4" />
        </a>
      )}

      {message && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">{message}</p>}
    </div>
  )
}
