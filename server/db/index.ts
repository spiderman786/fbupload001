import type Database from 'better-sqlite3'
import { createPostgresDatabase, initPostgresDatabase, isPostgresEnabled } from './postgres.js'
import { migrateSqliteToPostgresIfNeeded } from './migrateSqliteToPostgres.js'
import { initDb as initSqliteDb, db as sqliteDb, type UserRow } from '../db.sqlite.js'

export type { UserRow }

export const db: Database.Database = (isPostgresEnabled()
  ? (createPostgresDatabase() as unknown as Database.Database)
  : sqliteDb)

export async function initDb() {
  if (isPostgresEnabled()) {
    await initPostgresDatabase()
    try {
      await migrateSqliteToPostgresIfNeeded()
    } catch (err) {
      console.error('[migrate] SQLite copy failed (app will continue):', err)
    }
  } else {
    initSqliteDb()
  }
}

export function getDatabaseKind(): 'postgres' | 'sqlite' {
  return isPostgresEnabled() ? 'postgres' : 'sqlite'
}
