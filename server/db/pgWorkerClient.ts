import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type WorkerResponse = {
  id?: number
  type?: string
  ok: boolean
  rows?: unknown[]
  rowCount?: number | null
  error?: string
}

type Pending = {
  slot: Int32Array
  response?: WorkerResponse
}

let worker: Worker | null = null
let workerBooted = false
let nextId = 0
const pending = new Map<number, Pending>()

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

  const bootSlot = new Int32Array(new SharedArrayBuffer(4))

  worker.on('message', (msg: WorkerResponse) => {
    if (msg.type === 'boot') {
      workerBooted = true
      Atomics.store(bootSlot, 0, 1)
      Atomics.notify(bootSlot, 0)
      return
    }

    if (!msg.id) return
    const entry = pending.get(msg.id)
    if (!entry) return
    entry.response = msg
    Atomics.store(entry.slot, 0, 1)
    Atomics.notify(entry.slot, 0)
  })

  worker.on('error', (err) => {
    console.error('[pg-worker] fatal:', err)
  })

  worker.stderr?.on('data', (chunk: Buffer) => {
    console.error('[pg-worker]', chunk.toString().trim())
  })

  const bootDeadline = Date.now() + 10_000
  while (!workerBooted) {
    if (Date.now() > bootDeadline) {
      throw new Error('PostgreSQL worker failed to start within 10s')
    }
    Atomics.wait(bootSlot, 0, 0, 250)
  }

  return worker
}

function send(type: string, extra: Record<string, unknown> = {}) {
  const id = ++nextId
  const slot = new Int32Array(new SharedArrayBuffer(4))
  pending.set(id, { slot })
  getWorker().postMessage({ id, type, ...extra })

  const deadline = Date.now() + 60_000
  while (Atomics.load(slot, 0) === 0) {
    if (Date.now() > deadline) {
      pending.delete(id)
      throw new Error(`Database query timed out after 60s (${type})`)
    }
    Atomics.wait(slot, 0, 0, 250)
  }

  const entry = pending.get(id)
  pending.delete(id)
  const response = entry?.response
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Database worker query failed')
  }
  return response
}

export function workerQuery(sql: string, params: unknown[] = []) {
  return send('query', { sql, params })
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
