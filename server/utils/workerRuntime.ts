const role = (process.env.PROCESS_ROLE ?? 'all').toLowerCase()

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function isProductionWorker(): boolean {
  return process.env.NODE_ENV === 'production' && (role === 'worker' || role === 'all')
}

export function resolveWorkerConcurrency(): number {
  if (process.env.WORKER_CONCURRENCY !== undefined && process.env.WORKER_CONCURRENCY !== '') {
    return parsePositiveInt(process.env.WORKER_CONCURRENCY, 3)
  }
  if (isProductionWorker()) return role === 'worker' ? 2 : 4
  return 20
}

export function resolveWorkerPollMs(): number {
  if (process.env.WORKER_POLL_MS !== undefined && process.env.WORKER_POLL_MS !== '') {
    return parsePositiveInt(process.env.WORKER_POLL_MS, 2000)
  }
  if (isProductionWorker()) return 2000
  return 1000
}

export function resolvePrefillStartupDelayMs(): number {
  if (process.env.PREFILL_STARTUP_DELAY_MS !== undefined && process.env.PREFILL_STARTUP_DELAY_MS !== '') {
    return parsePositiveInt(process.env.PREFILL_STARTUP_DELAY_MS, 45_000)
  }
  if (isProductionWorker()) return 45_000
  return 5_000
}

export function resolvePgPoolMax(): number {
  if (process.env.PG_POOL_MAX !== undefined && process.env.PG_POOL_MAX !== '') {
    return parsePositiveInt(process.env.PG_POOL_MAX, 10)
  }
  if (role === 'worker') return 5
  if (role === 'web') return 15
  return 10
}
