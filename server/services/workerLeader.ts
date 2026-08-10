import { db } from '../db.js'

const LEADER_KEY = 'worker_cron_leader'

function resolveReplicaId(): string {
  return (
    process.env.RAILWAY_REPLICA_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `pid-${process.pid}`
  )
}

/** DB-backed leader lock so only one worker replica runs cron-style work at a time. */
export function tryAcquireWorkerLeaderLock(): boolean {
  const replicaId = resolveReplicaId()
  const now = new Date().toISOString()
  const ttlSec = Number(process.env.WORKER_LEADER_TTL_SEC ?? 90)
  const cutoff = new Date(Date.now() - ttlSec * 1000).toISOString()

  const refreshed = db
    .prepare(`
      UPDATE platform_settings SET updated_at = ?
      WHERE key = ? AND value = ?
    `)
    .run(now, LEADER_KEY, replicaId)
  if (refreshed.changes > 0) return true

  const stolen = db
    .prepare(`
      UPDATE platform_settings SET value = ?, updated_at = ?
      WHERE key = ? AND updated_at <= ?
    `)
    .run(replicaId, now, LEADER_KEY, cutoff)
  if (stolen.changes > 0) return true

  try {
    db.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)`).run(
      LEADER_KEY,
      replicaId,
      now,
    )
    return true
  } catch {
    return false
  }
}

export function runIfWorkerLeader<T>(fn: () => T): T | undefined {
  if (!tryAcquireWorkerLeaderLock()) return undefined
  return fn()
}

export async function runIfWorkerLeaderAsync(fn: () => Promise<void>): Promise<void> {
  if (!tryAcquireWorkerLeaderLock()) return
  await fn()
}
