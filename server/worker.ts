import 'dotenv/config'
import { initDb } from './db.js'
import { startJobQueue } from './services/jobQueue.js'
import { startScheduler } from './services/scheduler.js'

initDb()
startJobQueue()
startScheduler()

console.log('[worker] Production worker running (queue + scheduler + cleanup)')

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
