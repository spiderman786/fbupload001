/**
 * Copy data from local SQLite (DATABASE_PATH) into PostgreSQL (DATABASE_URL).
 * Run once before switching production to DATABASE_URL.
 *
 *   DATABASE_PATH=./data/fbuploadpro.db DATABASE_URL=postgresql://... npm run db:migrate-to-postgres
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import pg from 'pg'

const { Pool } = pg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultSqlite = path.join(__dirname, '..', 'data', 'fbuploadpro.db')
const sqlitePath = process.env.DATABASE_PATH ?? defaultSqlite
const pgUrl = process.env.DATABASE_URL

if (!pgUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sqlite = new Database(sqlitePath, { readonly: true })
const pool = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } })

const TABLES = [
  'users',
  'agencies',
  'agency_members',
  'agency_invites',
  'facebook_accounts',
  'facebook_pages',
  'source_accounts',
  'schedule_slots',
  'schedule_slot_pages',
  'reel_jobs',
  'token_transactions',
  'byoc_credentials',
  'page_source_assignments',
  'posted_reels',
  'page_automation_settings',
  'platform_settings',
  'ops_alert_config',
  'job_logs',
  'ops_audit_log',
  'agency_ops_notes',
  'ops_alert_log',
  'google_oauth_states',
  'facebook_oauth_magic_links',
  'facebook_oauth_states',
]

async function main() {
  const schemaPath = path.join(__dirname, '..', 'server', 'db', 'schema.postgres.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  await pool.query(schema)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const table of TABLES) {
      const exists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | undefined
      if (!exists) {
        console.log(`[skip] ${table} (missing in sqlite)`)
        continue
      }

      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      if (!rows.length) {
        console.log(`[skip] ${table} (empty)`)
        continue
      }

      const cols = Object.keys(rows[0]!)
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`

      for (const row of rows) {
        await client.query(
          sql,
          cols.map((c) => row[c]),
        )
      }
      console.log(`[ok] ${table}: ${rows.length} row(s)`)
    }
    await client.query('COMMIT')
    console.log('Migration complete. Set DATABASE_URL on Railway and redeploy.')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
    sqlite.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
