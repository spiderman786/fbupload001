import 'dotenv/config'
import express from 'express'
import { initDb, getDatabaseKind } from './db.js'
import { startJobQueue } from './services/jobQueue.js'
import { startScheduler } from './services/scheduler.js'
import { startPrefillScheduler } from './services/prefillScheduler.js'
import { initProxyPool, getProxyPoolStats } from './services/proxyPool.js'
import { startProxyPoolPruneScheduler } from './services/proxyPoolPruneScheduler.js'
import { runOpsAlertChecks } from './services/opsAlerts.js'
import { startNewsScheduler } from './services/news/newsScheduler.js'
import { seedPlatformAdmin, logPlatformAdminMode } from './services/platformAdmin.js'
import { backfillNextPublishAtIndex } from './services/scheduleBackfill.js'
import {
  resolveWorkerConcurrency,
  resolveWorkerPollMs,
  resolvePrefillStartupDelayMs,
} from './utils/workerRuntime.js'

const role = (process.env.PROCESS_ROLE ?? 'all').toLowerCase()
const runWorker = role === 'all' || role === 'worker'

let workerReady = false
let databaseKind: ReturnType<typeof getDatabaseKind> | null = null

function startWorkerHealthServer() {
  const app = express()
  const port = Number(process.env.PORT ?? 3001)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: workerReady ? 'ok' : 'starting',
      role: 'worker',
      timestamp: new Date().toISOString(),
      database: databaseKind,
    })
  })
  app.listen(port, '0.0.0.0', () => {
    console.log(`[worker] Health endpoint on :${port}`)
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err)
})

if (runWorker) {
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

  const alertIntervalMs = Number(process.env.OPS_ALERT_INTERVAL_MS ?? 15 * 60 * 1000)
  setInterval(() => {
    void runOpsAlertChecks()
  }, alertIntervalMs)

  workerReady = true

  console.log(`[worker] Running (role=${role}, db=${databaseKind}, queue + scheduler + ops alerts)`)
  console.log(`[worker] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)
} else {
  console.log(`[worker] Skipped — PROCESS_ROLE=${role} (web-only node)`)
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
