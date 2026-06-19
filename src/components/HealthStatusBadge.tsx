import { HEALTH_STATUS_LABELS } from '../config/pageStatuses'

const STYLES: Record<string, string> = {
  completed: 'border-primary/25 bg-primary/10 text-primary',
  active: 'border-primary/25 bg-primary/10 text-primary',
  inactive: 'border-border bg-muted text-muted-foreground',
  verification_required: 'border-red-200 bg-red-50 text-red-700',
  rate_limited: 'border-orange-200 bg-orange-50 text-orange-700',
  page_not_accessible: 'border-red-200 bg-red-50 text-red-700',
  invalid_token: 'border-red-200 bg-red-50 text-red-700',
  invalid_username: 'border-red-200 bg-red-50 text-red-700',
  creator_suspended: 'border-red-200 bg-red-50 text-red-700',
  twofa_required_bm: 'border-orange-200 bg-orange-50 text-orange-700',
  check_dev_app: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  account_suspended: 'border-red-200 bg-red-50 text-red-700',
  needs_fix: 'border-orange-200 bg-orange-50 text-orange-700',
}

function labelFor(status: string): string {
  return HEALTH_STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
}

export function HealthStatusBadge({ status }: { status: string }) {
  const className = STYLES[status] ?? 'border-border bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {labelFor(status)}
    </span>
  )
}

/** Card badge: Active/Inactive for healthy pages, otherwise health error status. */
export function AutomationStatusBadge({
  status,
  healthStatus,
}: {
  status: string
  healthStatus: string
}) {
  if (healthStatus === 'completed') {
    const isActive = status === 'active'
    return (
      <span
        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
          isActive ? STYLES.active : STYLES.inactive
        }`}
      >
        {isActive ? 'Active' : 'Inactive'}
      </span>
    )
  }
  return <HealthStatusBadge status={healthStatus} />
}
