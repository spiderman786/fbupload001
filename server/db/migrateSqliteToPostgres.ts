import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import pg from 'pg'

const { Pool } = pg

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

export async function migrateSqliteToPostgresIfNeeded(): Promise<void> {
  const pgUrl = process.env.DATABASE_URL
  if (!pgUrl) return

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const defaultSqlite = path.join(__dirname, '..', '..', 'data', 'fbuploadpro.db')
  const sqlitePath = process.env.DATABASE_PATH ?? defaultSqlite

  if (!fs.existsSync(sqlitePath)) {
    console.log('[migrate] SQLite file not found, skipping data copy')
    return
  }

  const pool = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } })
  const sqlite = new Database(sqlitePath, { readonly: true })

  try {
    const client = await pool.connect()
    try {
      await client.query('SELECT pg_advisory_lock(92002)')

      const countResult = await client.query('SELECT COUNT(*)::int AS n FROM users')
      const pgUsers = Number(countResult.rows[0]?.n ?? 0)
      const sqliteUsers = (
        sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='users'").get() as
          | { n: number }
          | undefined
      )
        ? (sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
        : 0

      if (pgUsers >= sqliteUsers && process.env.FORCE_SQLITE_MIGRATION !== '1') {
        console.log(`[migrate] Postgres already has ${pgUsers}/${sqliteUsers} users, skipping SQLite copy`)
        return
      }

      if (sqliteUsers === 0) {
        console.log('[migrate] SQLite has no users, skipping data copy')
        return
      }

      console.log(`[migrate] Copying SQLite data (${sqliteUsers} users) into Postgres...`)

      const schemaPath = path.join(__dirname, 'schema.postgres.sql')
      const schema = fs.readFileSync(schemaPath, 'utf8')

      await execSchema(client, schema)
      await client.query('BEGIN')
      await client.query("SET session_replication_role = 'replica'")

      let copied = 0
      for (const table of TABLES) {
        const exists = sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table) as { name: string } | undefined
        if (!exists) continue

        const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
        if (!rows.length) continue

        const pgCols = await getPgColumns(client, table)
        if (!pgCols.size) continue

        const cols = Object.keys(rows[0]!).filter((c) => pgCols.has(c))
        if (!cols.length) continue

        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

        let inserted = 0
        let skippedRows = 0
        for (const row of rows) {
          try {
            await client.query('SAVEPOINT migrate_row')
            const result = await client.query(
              sql,
              cols.map((c) => row[c] ?? null),
            )
            await client.query('RELEASE SAVEPOINT migrate_row')
            inserted += result.rowCount ?? 0
          } catch (err) {
            await client.query('ROLLBACK TO SAVEPOINT migrate_row')
            skippedRows++
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[migrate] skip ${table} row: ${msg}`)
          }
        }
        if (inserted > 0 || skippedRows > 0) {
          console.log(`[migrate] ${table}: ${inserted}/${rows.length} inserted, ${skippedRows} skipped`)
          if (inserted > 0) copied++
        }
      }

      await client.query("SET session_replication_role = 'origin'")
      await client.query('COMMIT')
      console.log(`[migrate] Complete (${copied} tables with data copied)`)
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(92002)')
      } catch {
        /* ignore */
      }
      client.release()
    }
  } finally {
    sqlite.close()
    await pool.end()
  }
}
