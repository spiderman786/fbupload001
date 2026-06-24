import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { api, type FacebookPage } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function PayoutPage() {
  const toast = useToast()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [pageId, setPageId] = useState('')
  const [amount, setAmount] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.pages
      .list()
      .then((res) => setPages(res.pages))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pageId || !amount) return
    setSubmitting(true)
    try {
      const res = await api.automation.payout({ pageId, amount: Number(amount), recipientId: recipientId || undefined })
      toast.success(res.message)
    } catch (err) {
      toast.error(getApiError(err, 'Payout request failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">Payout Transfer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Transfer monetization payouts from connected Facebook pages. Requires Meta Monetization API access.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="marketing-card space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Monetized page</label>
            <select required value={pageId} onChange={(e) => setPageId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
              <option value="">Select page…</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount (USD)</label>
            <input required type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Recipient ID (optional)</label>
            <input value={recipientId} onChange={(e) => setRecipientId(e.target.value)} placeholder="Meta payout recipient ID" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
          </div>
          <button type="submit" disabled={submitting || !pages.length} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Request payout transfer'}
          </button>
          {!pages.length ? (
            <p className="text-xs text-muted-foreground">
              <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a page</Link> first.
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}
