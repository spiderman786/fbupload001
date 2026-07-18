import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import deasync from 'deasync'

type WorkerResponse = {
  id?: number
  type?: string
  ok: boolean
  rows?: unknown[]
  rowCount?: number | null
  error?: string
}

type Pending = {
  done: boolean
  response?: WorkerResponse
}

let worker: Worker | null = null
let workerBooted = false
let nextId = 0
const pending = new Map<number, Pending>()

function waitUntil(predicate: () => boolean, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs
  deasync.loopWhile(() => {
    if (predicate()) return false
    if (Date.now() > deadline) throw new Error(label)
    return true
  })
}

function getWorker(): Worker {
  if (worker) return worker

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL')

  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pgWorker.cjs')
  worker = new Worker(workerPath, {
    workerData: {
      databaseUrl,
      poolMax: Number(process.env.PG_POOL_MAX ?? 30),
      idleTimeoutMs: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
      ssl: process.env.PG_SSL !== 'false',
    },
  })

  worker.on('message', (msg: WorkerResponse) => {
    if (msg.type === 'boot') {
      workerBooted = true
      return
    }

    if (!msg.id) return
    const entry = pending.get(msg.id)
    if (!entry) return
    entry.response = msg
    entry.done = true
  })

  worker.on('error', (err) => {
    console.error('[pg-worker] fatal:', err)
  })

  worker.stderr?.on('data', (chunk: Buffer) => {
    console.error('[pg-worker]', chunk.toString().trim())
  })

  waitUntil(() => workerBooted, 10_000, 'PostgreSQL worker failed to start within 10s')

  return worker
}

function send(type: string, extra: Record<string, unknown> = {}) {
  const id = ++nextId
  const entry: Pending = { done: false }
  pending.set(id, entry)
  getWorker().postMessage({ id, type, ...extra })

  waitUntil(() => entry.done, 60_000, `Database query timed out after 60s (${type})`)

  pending.delete(id)
  const response = entry.response
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Database worker query failed')
  }
  return response
}

export function workerQuery(sql: string, params: unknown[] = [], transactional = false) {
  return send(transactional ? 'txQuery' : 'query', { sql, params })
}

export function workerConnect() {
  send('connect')
}

export function workerBegin() {
  send('begin')
}

export function workerCommit() {
  send('commit')
}

export function workerRollback() {
  send('rollback')
}

export async function closePgWorker() {
  if (!worker) return
  try {
    send('close')
  } catch {
    /* ignore */
  }
  await worker.terminate()
  worker = null
  workerBooted = false
}
