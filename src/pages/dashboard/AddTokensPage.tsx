import { useState, type FormEvent } from 'react'
import { Coins, ExternalLink } from 'lucide-react'
import { api } from '../../api/client'
import { useAgencyRole, useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function AddTokensPage() {
  const { user, refreshUser } = useAuth()
  const { isAdmin } = useAgencyRole()
  const toast = useToast()
  const [amount, setAmount] = useState(100)
  const [note, setNote] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [whatsappUrl, setWhatsappUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [devLoading, setDevLoading] = useState(false)
  const [memberLoading, setMemberLoading] = useState(false)
  const [message, setMessage] = useState('')

  const totalPkr = amount * 0.5

  async function handleRequest(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const res = await api.tokens.request(amount, note)
      setWhatsappUrl(res.whatsappUrl)
      setMessage(res.message)
      toast.success('WhatsApp request ready — complete payment to receive tokens')
    } catch (err) {
      const msg = getApiError(err, 'Request failed')
      setMessage(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleDevCredit() {
    setDevLoading(true)
    try {
      const res = await api.tokens.credit(amount, 'Dev credit')
      setMessage(`Credited ${amount} tokens. New balance: ${res.balance}`)
      await refreshUser()
      toast.success(`Credited ${amount} tokens`)
    } catch (err) {
      const msg = getApiError(err, 'Credit failed')
      setMessage(msg)
      toast.error(msg)
    } finally {
      setDevLoading(false)
    }
  }

  async function handleCreditMember(e: FormEvent) {
    e.preventDefault()
    setMemberLoading(true)
    try {
      const res = await api.tokens.creditMember({ amount, memberEmail, note })
      setMessage(`${res.message}. New agency balance: ${res.balance}`)
      setMemberEmail('')
      await refreshUser()
      toast.success(res.message)
    } catch (err) {
      const msg = getApiError(err, 'Credit failed')
      setMessage(msg)
      toast.error(msg)
    } finally {
      setMemberLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Add Tokens</h1>
        <p className="text-sm text-muted-foreground">
          Top up your account via WhatsApp. Current balance: <strong>{user?.tokenBalance ?? 0}</strong> tokens.
        </p>
      </div>

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
          {loading ? 'Processing...' : 'Request via WhatsApp'}
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

      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Dev mode</p>
        <p className="mb-3 text-sm text-muted-foreground">Instantly credit tokens without WhatsApp (for testing).</p>
        <button
          onClick={handleDevCredit}
          disabled={devLoading}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {devLoading ? 'Crediting...' : `Credit ${amount} tokens`}
        </button>
      </div>

      {isAdmin && (
        <form onSubmit={handleCreditMember} className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Owner/Admin</p>
          <p className="text-sm text-muted-foreground">Credit tokens directly to an agency member by email.</p>
          <input
            type="email"
            required
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            placeholder="member@gmail.com"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            type="submit"
            disabled={memberLoading}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {memberLoading ? 'Crediting member...' : `Credit ${amount} tokens to member`}
          </button>
        </form>
      )}
    </div>
  )
}
