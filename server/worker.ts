import 'dotenv/config'
import express from 'express'
import { initDb, getDatabaseKind } from './db.js'
import { db } from './db.js'
import { startJobQueue, stopJobQueue, getActiveJobCount } from './services/jobQueue.js'
import { startScheduler } from './services/scheduler.js'
import { startPrefillScheduler } from './services/prefillScheduler.js'
import { initProxyPool, getProxyPoolStats } from './services/proxyPool.js'
import { startProxyPoolPruneScheduler } from './services/proxyPoolPruneScheduler.js'
import { runOpsAlertChecks } from './services/opsAlerts.js'
import { startNewsScheduler } from './services/news/newsScheduler.js'
import { seedPlatformAdmin, logPlatformAdminMode } from './services/platformAdmin.js'
import { backfillNextPublishAtIndex } from './services/scheduleBackfill.js'
import { pruneStaleWorkerHeartbeats, removeWorkerHeartbeat, touchWorkerHeartbeat } from './services/workerHeartbeat.js'
import { runIfWorkerLeaderAsync } from './services/workerLeader.js'
import {
  resolveWorkerConcurrency,
  resolveWorkerPollMs,
  resolvePrefillStartupDelayMs,
} from './utils/workerRuntime.js'

const role = (process.env.PROCESS_ROLE ?? 'all').toLowerCase()
const embeddedWorker =
  process.env.EMBEDDED_WORKER === 'true' || process.env.EMBEDDED_WORKER === '1'
/** Standalone worker service, or single-box start:production (EMBEDDED_WORKER=true). */
const runWorker = role === 'all' || role === 'worker' || embeddedWorker
const standaloneWorker = role === 'worker' && !embeddedWorker

if (process.argv[1]?.includes('worker') && role === 'web' && !embeddedWorker) {
  console.error(
    '[worker] PROCESS_ROLE=web disables worker tasks — set PROCESS_ROLE=worker on a dedicated worker service, or use npm run start:production',
  )
  process.exit(1)
}

let workerReady = false
let databaseKind: ReturnType<typeof getDatabaseKind> | null = null

function pingDatabase(): boolean {
  try {
    db.prepare('SELECT 1 AS ok').get()
    return true
  } catch {
    return false
  }
}

function startWorkerHealthServer() {
  const app = express()
  const port = Number(process.env.PORT ?? 3001)
  app.get('/api/health', (_req, res) => {
    const dbOk = pingDatabase()
    const ready = workerReady && dbOk
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : workerReady ? 'degraded' : 'starting',
      role: 'worker',
      timestamp: new Date().toISOString(),
      gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? null,
      database: databaseKind,
      dbOk,
      replicaId: process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? null,
      region: process.env.RAILWAY_REPLICA_REGION ?? null,
    })
  })
  app.listen(port, '0.0.0.0', () => {
    console.log(`[worker] Health endpoint on :${port}`)
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason)
  if (process.env.NODE_ENV === 'production') process.exit(1)
})

process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err)
  process.exit(1)
})

function shutdown() {
  stopJobQueue()
  try {
    removeWorkerHeartbeat()
  } catch {
    /* ignore */
  }
  process.exit(0)
}

// Only bind /api/health when this process owns PORT (dedicated worker service).
// Embedded workers share the container with web, which already serves health.
if (standaloneWorker) {
  startWorkerHealthServer()
}

await initDb()
databaseKind = getDatabaseKind()
backfillNextPublishAtIndex()
await seedPlatformAdmin()
logPlatformAdminMode()
initProxyPool()

if (runWorker) {
  console.log(
    `[worker] Runtime limits: concurrency=${resolveWorkerConcurrency()}, poll=${resolveWorkerPollMs()}ms, prefillDelay=${resolvePrefillStartupDelayMs()}ms`,
  )

  startJobQueue()
  startScheduler()
  startPrefillScheduler()
  startNewsScheduler()
  startProxyPoolPruneScheduler()

  setInterval(() => {
    touchWorkerHeartbeat(getActiveJobCount())
  }, 30_000)

  const alertIntervalMs = Number(process.env.OPS_ALERT_INTERVAL_MS ?? 15 * 60 * 1000)
  setInterval(() => {
    void runIfWorkerLeaderAsync(() => runOpsAlertChecks())
  }, alertIntervalMs)

  setInterval(() => {
    pruneStaleWorkerHeartbeats()
  }, 60 * 60 * 1000)

  workerReady = true

  console.log(`[worker] Running (role=${role}, embedded=${embeddedWorker}, db=${databaseKind}, queue + scheduler + ops alerts)`)
  console.log(`[worker] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)
} else {
  console.log(`[worker] Skipped — PROCESS_ROLE=${role} (web-only node)`)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
