import type Database from 'better-sqlite3'
import { createPostgresDatabase, initPostgresDatabase, isPostgresEnabled } from './postgres.js'
import { initDb as initSqliteDb, db as sqliteDb, type UserRow } from '../db.sqlite.js'

export type { UserRow }

export const db: Database.Database = (isPostgresEnabled()
  ? (createPostgresDatabase() as unknown as Database.Database)
  : sqliteDb)

export async function initDb() {
  if (isPostgresEnabled()) {
    await initPostgresDatabase()
  } else {
    initSqliteDb()
  }
}

export function getDatabaseKind(): 'postgres' | 'sqlite' {
  return isPostgresEnabled() ? 'postgres' : 'sqlite'
}
