import 'dotenv/config'
import { initDb } from './db.js'
import { startJobQueue } from './services/jobQueue.js'
import { startScheduler } from './services/scheduler.js'
import { startPrefillScheduler } from './services/prefillScheduler.js'
import { initProxyPool, getProxyPoolStats } from './services/proxyPool.js'
import { runOpsAlertChecks } from './services/opsAlerts.js'
import { seedPlatformAdmin } from './services/platformAdmin.js'

initDb()
await seedPlatformAdmin()
initProxyPool()
startJobQueue()
startScheduler()
startPrefillScheduler()

const alertIntervalMs = Number(process.env.OPS_ALERT_INTERVAL_MS ?? 15 * 60 * 1000)
setInterval(() => {
  void runOpsAlertChecks()
}, alertIntervalMs)

console.log('[worker] Production worker running (queue + scheduler + ops alerts)')
console.log(`[worker] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
