import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { migrateSqliteToPostgresIfNeeded } from '../server/db/migrateSqliteToPostgres.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultSqlite = path.join(__dirname, '..', 'data', 'fbuploadpro.db')
const sqlitePath = process.env.DATABASE_PATH ?? defaultSqlite

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found: ${sqlitePath}`)
  process.exit(1)
}

process.env.FORCE_SQLITE_MIGRATION = '1'

migrateSqliteToPostgresIfNeeded()
  .then(() => {
    console.log('Migration script finished.')
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
