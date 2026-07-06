import { parentPort, workerData } from 'node:worker_threads'
import pg from 'pg'

const { Pool } = pg

type WorkerRequest = {
  id: number
  type: string
  sql?: string
  params?: unknown[]
}

const pool = new Pool({
  connectionString: workerData.databaseUrl as string,
  max: workerData.poolMax as number,
  idleTimeoutMillis: workerData.idleTimeoutMs as number,
  ssl: workerData.ssl ? { rejectUnauthorized: false } : false,
})

let txClient: pg.PoolClient | null = null

function reply(id: number, payload: Record<string, unknown>) {
  parentPort!.postMessage({ id, ...payload })
}

parentPort!.on('message', (msg: WorkerRequest) => {
  void (async () => {
    try {
      if (msg.type === 'query') {
        const target = txClient ?? pool
        const result = await target.query(msg.sql!, msg.params ?? [])
        reply(msg.id, { ok: true, rows: result.rows, rowCount: result.rowCount })
        return
      }

      if (msg.type === 'connect') {
        if (txClient) {
          txClient.release()
          txClient = null
        }
        txClient = await pool.connect()
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'begin') {
        if (!txClient) throw new Error('No transaction client')
        await txClient.query('BEGIN')
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'commit') {
        if (!txClient) throw new Error('No transaction client')
        await txClient.query('COMMIT')
        txClient.release()
        txClient = null
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'rollback') {
        if (!txClient) throw new Error('No transaction client')
        await txClient.query('ROLLBACK')
        txClient.release()
        txClient = null
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'close') {
        if (txClient) {
          txClient.release()
          txClient = null
        }
        await pool.end()
        reply(msg.id, { ok: true })
        return
      }

      throw new Error(`Unknown worker message type: ${msg.type}`)
    } catch (err) {
      reply(msg.id, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })()
})
