const { parentPort, workerData } = require('node:worker_threads')
const pg = require('pg')

const pool = new pg.Pool({
  connectionString: workerData.databaseUrl,
  max: workerData.poolMax,
  idleTimeoutMillis: workerData.idleTimeoutMs,
  ssl: workerData.ssl ? { rejectUnauthorized: false } : false,
})

let txClient = null

function reply(id, payload) {
  parentPort.postMessage({ id, ...payload })
}

async function releaseTxClient() {
  if (!txClient) return
  try {
    txClient.release()
  } catch {
    /* ignore */
  }
  txClient = null
}

parentPort.on('message', (msg) => {
  void (async () => {
    try {
      if (msg.type === 'query') {
        // Always use the shared pool — never the transaction client.
        // Routing normal requests through txClient poisoned auth under concurrency.
        const result = await pool.query(msg.sql, msg.params ?? [])
        reply(msg.id, { ok: true, rows: result.rows, rowCount: result.rowCount })
        return
      }

      if (msg.type === 'txQuery') {
        if (!txClient) throw new Error('No transaction client')
        const result = await txClient.query(msg.sql, msg.params ?? [])
        reply(msg.id, { ok: true, rows: result.rows, rowCount: result.rowCount })
        return
      }

      if (msg.type === 'connect') {
        await releaseTxClient()
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
        await releaseTxClient()
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'rollback') {
        if (!txClient) throw new Error('No transaction client')
        try {
          await txClient.query('ROLLBACK')
        } finally {
          await releaseTxClient()
        }
        reply(msg.id, { ok: true })
        return
      }

      if (msg.type === 'close') {
        await releaseTxClient()
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

parentPort.postMessage({ type: 'boot', ok: true })
