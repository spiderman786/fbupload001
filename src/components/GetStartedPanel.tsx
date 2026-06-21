import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Download } from 'lucide-react'

export type OnboardingSteps = {
  tokenBalanceReady: boolean
  byocConnected: boolean
  facebookAccountAdded: boolean
  aduPageAdded: boolean
}

const STEP_ITEMS: {
  key: keyof OnboardingSteps
  label: string
  to: string
}[] = [
  { key: 'tokenBalanceReady', label: 'Token balance ready', to: '/add-tokens' },
  { key: 'byocConnected', label: 'Connect Facebook app (BYOC)', to: '/settings/facebook-byoc' },
  { key: 'facebookAccountAdded', label: 'Add a Facebook account', to: '/facebook/accounts' },
  { key: 'aduPageAdded', label: 'Add your first ADU page', to: '/facebook/auto-download-upload' },
]

type Props = {
  steps: OnboardingSteps
  loading?: boolean
}

export function GetStartedPanel({ steps, loading }: Props) {
  const complete = STEP_ITEMS.every((s) => steps[s.key])
  if (complete && !loading) return null

  const showFirstPageHero = !steps.aduPageAdded

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Get started</h2>
        <ul className="mt-4 space-y-3">
          {STEP_ITEMS.map((item) => {
            const done = steps[item.key]
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className={`flex items-center gap-3 text-sm transition hover:opacity-80 ${done ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-hidden />
                  )}
                  <span className={done ? 'font-medium' : ''}>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {showFirstPageHero && (
        <section className="rounded-xl border border-border bg-card px-6 py-14 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Download className="h-7 w-7 text-primary" />
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Add your first page</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Connect Facebook BYOC, link an account, then add an Auto Download/Upload page to start automation.
          </p>
          <Link
            to="/facebook/auto-download-upload"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Go to Auto Download/Upload
          </Link>
        </section>
      )}
    </div>
  )
}
