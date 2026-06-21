import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const heartbeatPath =
  process.env.WORKER_HEARTBEAT_PATH ??
  path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(__dirname, '..', '..', 'data', 'fbuploadpro.db')), 'worker-heartbeat.json')

export type WorkerHeartbeat = {
  lastBeat: string
  activeJobs: number
  pid: number
}

export function touchWorkerHeartbeat(activeJobs: number) {
  const payload: WorkerHeartbeat = {
    lastBeat: new Date().toISOString(),
    activeJobs,
    pid: process.pid,
  }
  fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true })
  fs.writeFileSync(heartbeatPath, JSON.stringify(payload), 'utf8')
}

export function readWorkerHeartbeat(): (WorkerHeartbeat & { stale: boolean; ageMs: number }) | null {
  try {
    if (!fs.existsSync(heartbeatPath)) return null
    const data = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')) as WorkerHeartbeat
    const ageMs = Date.now() - new Date(data.lastBeat).getTime()
    const staleMs = Number(process.env.WORKER_STALE_MS ?? 120_000)
    return { ...data, stale: ageMs > staleMs, ageMs }
  } catch {
    return null
  }
}
