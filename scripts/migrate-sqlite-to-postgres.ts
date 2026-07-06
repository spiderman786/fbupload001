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

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found: ${sqlitePath}`)
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
  'news_templates',
  'rss_feeds',
  'page_news_settings',
  'news_items',
  'posted_articles',
  'agency_ai_settings',
  'platform_settings',
  'ops_alert_config',
  'job_logs',
  'ops_audit_log',
  'agency_ops_notes',
  'ops_alert_log',
  'google_oauth_states',
  'facebook_oauth_magic_links',
  'facebook_oauth_states',
] as const

function stripLeadingComments(sql: string): string {
  let statement = sql.trim()
  while (statement.startsWith('--')) {
    const lineBreak = statement.indexOf('\n')
    if (lineBreak === -1) return ''
    statement = statement.slice(lineBreak + 1).trim()
  }
  return statement
}

async function execSchema(client: pg.PoolClient, schema: string) {
  const chunks = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const chunk of chunks) {
    const statement = stripLeadingComments(chunk)
    if (!statement) continue
    await client.query(statement)
  }
}

async function getPgColumns(client: pg.PoolClient, table: string): Promise<Set<string>> {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return new Set(result.rows.map((r) => r.column_name as string))
}

async function main() {
  const schemaPath = path.join(__dirname, '..', 'server', 'db', 'schema.postgres.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')

  const client = await pool.connect()
  let migrated = 0
  let skipped = 0

  try {
    await execSchema(client, schema)

    await client.query('BEGIN')
    for (const table of TABLES) {
      const exists = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | undefined
      if (!exists) {
        console.log(`[skip] ${table} (missing in sqlite)`)
        skipped++
        continue
      }

      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      if (!rows.length) {
        console.log(`[skip] ${table} (empty)`)
        skipped++
        continue
      }

      const pgCols = await getPgColumns(client, table)
      if (!pgCols.size) {
        console.log(`[skip] ${table} (missing in postgres)`)
        skipped++
        continue
      }

      const cols = Object.keys(rows[0]!).filter((c) => pgCols.has(c))
      if (!cols.length) {
        console.log(`[skip] ${table} (no matching columns)`)
        skipped++
        continue
      }

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

      let inserted = 0
      for (const row of rows) {
        const result = await client.query(
          sql,
          cols.map((c) => row[c] ?? null),
        )
        inserted += result.rowCount ?? 0
      }
      console.log(`[ok] ${table}: ${inserted}/${rows.length} row(s) inserted`)
      migrated++
    }
    await client.query('COMMIT')
    console.log(`Migration complete (${migrated} tables copied, ${skipped} skipped).`)
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
