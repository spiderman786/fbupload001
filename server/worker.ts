import 'dotenv/config'
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

const role = (process.env.PROCESS_ROLE ?? 'all').toLowerCase()
const runWorker = role === 'all' || role === 'worker'

await initDb()
backfillNextPublishAtIndex()
await seedPlatformAdmin()
logPlatformAdminMode()
initProxyPool()

if (runWorker) {
  startJobQueue()
  startScheduler()
  startPrefillScheduler()
  startNewsScheduler()

  startProxyPoolPruneScheduler()

  const alertIntervalMs = Number(process.env.OPS_ALERT_INTERVAL_MS ?? 15 * 60 * 1000)
  setInterval(() => {
    void runOpsAlertChecks()
  }, alertIntervalMs)

  console.log(`[worker] Running (role=${role}, db=${getDatabaseKind()}, queue + scheduler + ops alerts)`)
  console.log(`[worker] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)
} else {
  console.log(`[worker] Skipped — PROCESS_ROLE=${role} (web-only node)`)
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
