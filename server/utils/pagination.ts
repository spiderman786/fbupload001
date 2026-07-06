export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200
export const CONNECT_PAGES_BATCH_SIZE = 500
export const SCHEDULER_PAGES_BATCH_SIZE = Number(process.env.SCHEDULER_PAGES_BATCH_SIZE ?? 500)
export const PREFILL_PAGES_BATCH_SIZE = Number(process.env.PREFILL_PAGES_BATCH_SIZE ?? 250)
export const FOLLOWER_SYNC_BATCH_SIZE = Number(process.env.FOLLOWER_SYNC_BATCH_SIZE ?? 200)

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const perPage = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.perPage) || DEFAULT_PAGE_SIZE))
  const offset = (page - 1) * perPage
  return { page, perPage, offset }
}

/** Agency admins may connect and automate any number of pages. */
export function assertOwnerUnlimitedPages(role: string, _currentCount: number) {
  if (role === 'owner' || role === 'admin') return
  // No cap for admins — automation scales with tokens and Facebook API limits.
}
