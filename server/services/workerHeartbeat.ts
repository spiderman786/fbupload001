import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const heartbeatPath =
  process.env.WORKER_HEARTBEAT_PATH ??
  path.join(
    path.dirname(process.env.DATABASE_PATH ?? path.join(__dirname, '..', '..', 'data', 'fbuploadpro.db')),
    'worker-heartbeat.json',
  )

export type WorkerHeartbeat = {
  replicaId: string
  region: string | null
  lastBeat: string
  activeJobs: number
  pid: number
  startedAt: string
}

export type WorkerHeartbeatReplica = WorkerHeartbeat & { stale: boolean; ageMs: number }

export type WorkerHeartbeatSummary = WorkerHeartbeatReplica & {
  replicaCount: number
  healthyReplicas: number
  replicas: WorkerHeartbeatReplica[]
}

function resolveReplicaId(): string {
  return (
    process.env.RAILWAY_REPLICA_ID?.trim() ||
    process.env.HOSTNAME?.trim() ||
    `pid-${process.pid}`
  )
}

function resolveRegion(): string | null {
  const region = process.env.RAILWAY_REPLICA_REGION?.trim()
  return region || null
}

function staleMs(): number {
  return Number(process.env.WORKER_STALE_MS ?? 120_000)
}

function rowToHeartbeat(row: Record<string, unknown>): WorkerHeartbeat {
  return {
    replicaId: String(row.replica_id),
    region: row.region ? String(row.region) : null,
    lastBeat: String(row.last_beat),
    activeJobs: Number(row.active_jobs ?? 0),
    pid: Number(row.pid ?? 0),
    startedAt: String(row.started_at),
  }
}

function withAge(hb: WorkerHeartbeat): WorkerHeartbeatReplica {
  const ageMs = Date.now() - new Date(hb.lastBeat).getTime()
  return { ...hb, ageMs, stale: ageMs > staleMs() }
}

function upsertDbHeartbeat(activeJobs: number) {
  const replicaId = resolveReplicaId()
  const region = resolveRegion()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO worker_heartbeats (replica_id, region, pid, active_jobs, last_beat, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(replica_id) DO UPDATE SET
      region = excluded.region,
      pid = excluded.pid,
      active_jobs = excluded.active_jobs,
      last_beat = excluded.last_beat
  `).run(replicaId, region, process.pid, activeJobs, now, now)
}

function writeLegacyFileHeartbeat(activeJobs: number) {
  const payload = {
    lastBeat: new Date().toISOString(),
    activeJobs,
    pid: process.pid,
    replicaId: resolveReplicaId(),
  }
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true })
  fs.writeFileSync(heartbeatPath, JSON.stringify(payload), 'utf8')
}

export function touchWorkerHeartbeat(activeJobs: number) {
  upsertDbHeartbeat(activeJobs)
  try {
    writeLegacyFileHeartbeat(activeJobs)
  } catch {
    /* optional local file for single-box sqlite */
  }
}

function readLegacyFileHeartbeat(): WorkerHeartbeatReplica | null {
  try {
    if (!fs.existsSync(heartbeatPath)) return null
    const data = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as {
      lastBeat: string
      activeJobs?: number
      pid?: number
      replicaId?: string
    }
    return withAge({
      replicaId: data.replicaId ?? `pid-${data.pid ?? 0}`,
      region: null,
      lastBeat: data.lastBeat,
      activeJobs: data.activeJobs ?? 0,
      pid: data.pid ?? 0,
      startedAt: data.lastBeat,
    })
  } catch {
    return null
  }
}

export function readWorkerHeartbeats(): WorkerHeartbeatReplica[] {
  const rows = db
    .prepare(`
      SELECT replica_id, region, pid, active_jobs, last_beat, started_at
      FROM worker_heartbeats
      ORDER BY last_beat DESC
    `)
    .all() as Record<string, unknown>[]

  if (!rows.length) {
    const legacy = readLegacyFileHeartbeat()
    return legacy ? [legacy] : []
  }

  return rows.map((row) => withAge(rowToHeartbeat(row)))
}

/** Aggregate view for ops dashboards — healthy if any replica is fresh. */
export function readWorkerHeartbeat(): WorkerHeartbeatSummary | null {
  const replicas = readWorkerHeartbeats()
  if (!replicas.length) return null

  const healthy = replicas.filter((r) => !r.stale)
  const freshest = replicas.reduce((best, cur) => (cur.ageMs < best.ageMs ? cur : best), replicas[0]!)
  const activeJobs = replicas.reduce((sum, r) => sum + r.activeJobs, 0)

  return {
    ...freshest,
    activeJobs,
    stale: healthy.length === 0,
    ageMs: freshest.ageMs,
    replicaCount: replicas.length,
    healthyReplicas: healthy.length,
    replicas,
  }
}

export function pruneStaleWorkerHeartbeats(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  db.prepare('DELETE FROM worker_heartbeats WHERE last_beat < ?').run(cutoff)
}

export function removeWorkerHeartbeat() {
  const replicaId = resolveReplicaId()
  db.prepare('DELETE FROM worker_heartbeats WHERE replica_id = ?').run(replicaId)
}
