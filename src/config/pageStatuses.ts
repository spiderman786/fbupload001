export type PageStatusFilter =
  | 'all'
  | 'active'
  | 'inactive'
  | 'verification_required'
  | 'rate_limited'
  | 'page_not_accessible'
  | 'invalid_token'
  | 'invalid_username'
  | 'creator_suspended'
  | 'completed'
  | 'twofa_required_bm'
  | 'check_dev_app'
  | 'account_suspended'

export const PAGE_STATUS_FILTERS: { value: PageStatusFilter; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'verification_required', label: 'Verification Req.' },
  { value: 'rate_limited', label: 'Rate Limited' },
  { value: 'page_not_accessible', label: 'Page Not Accessible' },
  { value: 'invalid_token', label: 'Invalid Token' },
  { value: 'invalid_username', label: 'Invalid Username' },
  { value: 'creator_suspended', label: 'Creator Suspended' },
  { value: 'completed', label: 'Completed' },
  { value: 'twofa_required_bm', label: '2FA Req. on BM' },
  { value: 'check_dev_app', label: 'Check Dev App' },
  { value: 'account_suspended', label: 'Account Suspended' },
]

export const HEALTH_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  verification_required: 'Verification Req.',
  rate_limited: 'Rate Limited',
  page_not_accessible: 'Page Not Accessible',
  invalid_token: 'Invalid Token',
  invalid_username: 'Invalid Username',
  creator_suspended: 'Creator Suspended',
  twofa_required_bm: '2FA Req. on BM',
  check_dev_app: 'Check Dev App',
  account_suspended: 'Account Suspended',
  needs_fix: 'Needs Fix',
}

export const PAGE_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'followers', label: 'Most Followers' },
  { value: 'gained', label: 'Most Gained' },
] as const

export type PageSort = (typeof PAGE_SORT_OPTIONS)[number]['value']
