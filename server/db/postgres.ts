import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { toPgParams, toPostgresSql } from './dialect.js'
import {
  workerBegin,
  workerCommit,
  workerConnect,
  workerQuery,
  workerRollback,
  closePgWorker,
} from './pgWorkerClient.js'

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

let inTransaction = false

function runQuery(sql: string, params: unknown[] = []) {
  const text = toPostgresSql(sql)
  const values = toPgParams(params)
  return workerQuery(text, values)
}

function makeStatement(sql: string): PreparedStatement {
  return {
    get(...params: unknown[]) {
      const result = runQuery(sql, params)
      return result.rows?.[0]
    },
    all(...params: unknown[]) {
      const result = runQuery(sql, params)
      return result.rows ?? []
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
      if (inTransaction) return fn()
      inTransaction = true
      workerConnect()
      workerBegin()
      try {
        const result = fn()
        workerCommit()
        return result
      } catch (err) {
        workerRollback()
        throw err
      } finally {
        inTransaction = false
      }
    },
    pragma() {
      /* no-op for postgres */
    },
  }
}

function createInitPool() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for PostgreSQL')
  return new pg.Pool({
    connectionString: url,
    max: 2,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
}

async function execSql(pool: pg.Pool, sql: string) {
  const chunks = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const chunk of chunks) {
    if (chunk.startsWith('--') || /^PRAGMA/i.test(chunk)) continue
    await pool.query(toPostgresSql(chunk))
  }
}

export async function initPostgresDatabase() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const schemaPath = path.join(__dirname, 'schema.postgres.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')

  const pool = createInitPool()
  try {
    await execSql(pool, schema)
    await migratePostgresColumnsAsync(pool)
    console.log('[db] PostgreSQL initialized')
  } finally {
    await pool.end()
  }
}

async function migratePostgresColumnsAsync(pool: pg.Pool) {
  const addColumn = async (table: string, column: string, type: string) => {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`)
  }

  await addColumn('page_automation_settings', 'last_schedule_fire', 'TEXT')
  await addColumn('page_automation_settings', 'next_publish_at', 'TEXT')
  await addColumn('users', 'google_id', 'TEXT')
  await addColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'password'")
  await addColumn('users', 'password_reset_token', 'TEXT')
  await addColumn('users', 'password_reset_expires', 'TEXT')
  await addColumn('agencies', 'parent_agency_id', 'TEXT')
  await addColumn('agencies', 'maintenance_mode', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('agencies', 'whatsapp_number', 'TEXT')
  await addColumn('agencies', 'subdomain', 'TEXT')
  await addColumn('facebook_pages', 'health_status', "TEXT NOT NULL DEFAULT 'completed'")
  await addColumn('facebook_pages', 'page_access_token', 'TEXT')
  await addColumn('facebook_pages', 'daily_reel_limit', 'INTEGER NOT NULL DEFAULT 6')
  await addColumn('facebook_pages', 'consecutive_failures', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('reel_jobs', 'caption', 'TEXT')
  await addColumn('reel_jobs', 'thumbnail_path', 'TEXT')
  await addColumn('reel_jobs', 'r2_video_key', 'TEXT')
  await addColumn('reel_jobs', 'r2_thumb_key', 'TEXT')
  await addColumn('reel_jobs', 'source_reel_id', 'TEXT')
  await addColumn('reel_jobs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('reel_jobs', 'agency_id', 'TEXT')
  await addColumn('page_source_assignments', 'scrape_status', "TEXT NOT NULL DEFAULT 'idle'")
  await addColumn('page_source_assignments', 'scrape_error', 'TEXT')
  await addColumn('page_source_assignments', 'catalog_total', 'INTEGER')
  await addColumn('page_source_assignments', 'agency_id', 'TEXT')

  await execSql(
    pool,
    `
    CREATE INDEX IF NOT EXISTS idx_pas_next_publish ON page_automation_settings(next_publish_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_page_status ON reel_jobs(target_page_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON reel_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_pages_active ON facebook_pages(status, health_status);
  `,
  )
}

export async function closePostgresPool() {
  await closePgWorker()
}
