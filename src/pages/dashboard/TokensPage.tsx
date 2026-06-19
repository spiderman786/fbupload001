import { useEffect, useState } from 'react'
import { api, type TokenTransaction } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function TokensPage() {
  const toast = useToast()
  const [balance, setBalance] = useState(0)
  const [costPerToken, setCostPerToken] = useState(0.5)
  const [transactions, setTransactions] = useState<TokenTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([api.tokens.balance(), api.tokens.transactions()])
      .then(([b, t]) => {
        setBalance(b.balance)
        setCostPerToken(b.costPerToken)
        setTransactions(t.transactions)
      })
      .catch((err) => {
        const msg = getApiError(err, 'Failed to load token data')
        setLoadError(msg)
        toast.error(msg)
      })
      .finally(() => setLoading(false))
  }, [toast])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Token Balance</h1>
        <p className="text-sm text-muted-foreground">Non-expiring tokens — charged only on successful publishes.</p>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      <div className="marketing-card max-w-md">
        <p className="text-sm text-muted-foreground">Current balance</p>
        <p className="font-display mt-1 text-4xl font-bold text-primary">{balance}</p>
        <p className="mt-1 text-sm text-muted-foreground">Rs {costPerToken} per token</p>
      </div>

      <section>
        <h2 className="mb-4 font-semibold">Transaction History</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
                <div>
                  <p className="font-medium capitalize">{tx.type.replace('_', ' ')}</p>
                  <p className="text-xs text-muted-foreground">{tx.note ?? new Date(tx.createdAt).toLocaleString()}</p>
                </div>
                <span className={`font-semibold ${tx.amount >= 0 ? 'text-primary' : 'text-red-600'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
