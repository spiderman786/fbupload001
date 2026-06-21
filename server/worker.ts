import 'dotenv/config'
import { initDb } from './db.js'
import { startJobQueue } from './services/jobQueue.js'
import { startScheduler } from './services/scheduler.js'
import { initProxyPool, getProxyPoolStats } from './services/proxyPool.js'

initDb()
initProxyPool()
startJobQueue()
startScheduler()

console.log('[worker] Production worker running (queue + scheduler + cleanup)')
console.log(`[worker] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
