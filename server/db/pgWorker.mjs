import { parentPort, workerData } from 'node:worker_threads'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: workerData.databaseUrl,
  max: workerData.poolMax,
  idleTimeoutMillis: workerData.idleTimeoutMs,
  ssl: workerData.ssl ? { rejectUnauthorized: false } : false,
})

let txClient = null

function reply(id, payload) {
  parentPort.postMessage({ id, ...payload })
}

parentPort.on('message', (msg) => {
  void (async () => {
    try {
      if (msg.type === 'query') {
        const target = txClient ?? pool
        const result = await target.query(msg.sql, msg.params ?? [])
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
