import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { toPgParams, toPostgresSql } from './dialect.js'
import { runSync } from './syncWait.js'

const { Pool } = pg

export type RunResult = { changes: number; lastInsertRowid?: number | bigint }

export type PreparedStatement = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => RunResult
}

export type Database = {
  prepare: (sql: string) => PreparedStatement
  exec: (sql: string) => void
  transaction: <T>(fn: () => T) => T
  pragma: (value: string) => void
}

let pool: pg.Pool | null = null
let txClient: pg.PoolClient | null = null

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for PostgreSQL')
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 30),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  }
  return pool
}

function queryTarget(): pg.Pool | pg.PoolClient {
  return txClient ?? getPool()
}

function runQuery(sql: string, params: unknown[] = []) {
  const text = toPostgresSql(sql)
  const values = toPgParams(params)
  return runSync(queryTarget().query(text, values))
}

function makeStatement(sql: string): PreparedStatement {
  return {
    get(...params: unknown[]) {
      const result = runQuery(sql, params)
      return result.rows[0]
    },
    all(...params: unknown[]) {
      const result = runQuery(sql, params)
      return result.rows
    },
    run(...params: unknown[]) {
      const result = runQuery(sql, params)
      return { changes: result.rowCount ?? 0 }
    },
  }
}

export function isPostgresEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function createPostgresDatabase(): Database {
  return {
    prepare(sql: string) {
      return makeStatement(sql)
    },
    exec(sql: string) {
      const chunks = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const chunk of chunks) {
        if (chunk.startsWith('--') || /^PRAGMA/i.test(chunk)) continue
        runQuery(chunk)
      }
    },
    transaction<T>(fn: () => T): T {
      if (txClient) return fn()
      const client = runSync(getPool().connect())
      txClient = client
      try {
        runSync(client.query('BEGIN'))
        const result = fn()
        runSync(client.query('COMMIT'))
        return result
      } catch (err) {
        runSync(client.query('ROLLBACK'))
        throw err
      } finally {
        txClient = null
        client.release()
      }
    },
    pragma() {
      /* no-op for postgres */
    },
  }
}

export function initPostgresDatabase() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const schemaPath = path.join(__dirname, 'schema.postgres.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')

  const db = createPostgresDatabase()
  db.exec(schema)

  migratePostgresColumns(db)
  console.log('[db] PostgreSQL initialized')
}

function migratePostgresColumns(db: Database) {
  const addColumn = (table: string, column: string, type: string) => {
    db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`)
  }

  addColumn('page_automation_settings', 'last_schedule_fire', 'TEXT')
  addColumn('page_automation_settings', 'next_publish_at', 'TEXT')
  addColumn('users', 'google_id', 'TEXT')
  addColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'password'")
  addColumn('users', 'password_reset_token', 'TEXT')
  addColumn('users', 'password_reset_expires', 'TEXT')
  addColumn('agencies', 'parent_agency_id', 'TEXT')
  addColumn('agencies', 'maintenance_mode', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('agencies', 'whatsapp_number', 'TEXT')
  addColumn('agencies', 'subdomain', 'TEXT')
  addColumn('facebook_pages', 'health_status', "TEXT NOT NULL DEFAULT 'completed'")
  addColumn('facebook_pages', 'page_access_token', 'TEXT')
  addColumn('facebook_pages', 'daily_reel_limit', 'INTEGER NOT NULL DEFAULT 6')
  addColumn('facebook_pages', 'consecutive_failures', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('reel_jobs', 'caption', 'TEXT')
  addColumn('reel_jobs', 'thumbnail_path', 'TEXT')
  addColumn('reel_jobs', 'r2_video_key', 'TEXT')
  addColumn('reel_jobs', 'r2_thumb_key', 'TEXT')
  addColumn('reel_jobs', 'source_reel_id', 'TEXT')
  addColumn('reel_jobs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('reel_jobs', 'agency_id', 'TEXT')
  addColumn('page_source_assignments', 'scrape_status', "TEXT NOT NULL DEFAULT 'idle'")
  addColumn('page_source_assignments', 'scrape_error', 'TEXT')
  addColumn('page_source_assignments', 'catalog_total', 'INTEGER')
  addColumn('page_source_assignments', 'agency_id', 'TEXT')

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pas_next_publish ON page_automation_settings(next_publish_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_page_status ON reel_jobs(target_page_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON reel_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_pages_active ON facebook_pages(status, health_status);
  `)
}

export async function closePostgresPool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
