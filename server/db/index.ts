import type Database from 'better-sqlite3'
import { createPostgresDatabase, initPostgresDatabase, isPostgresEnabled } from './postgres.js'
import { workerQuery } from './pgWorkerClient.js'
import { initDb as initSqliteDb, db as sqliteDb, type UserRow } from '../db.sqlite.js'

export type { UserRow }

export const db: Database.Database = (isPostgresEnabled()
  ? (createPostgresDatabase() as unknown as Database.Database)
  : sqliteDb)

export async function initDb() {
  if (isPostgresEnabled()) {
    await initPostgresDatabase()
    workerQuery('SELECT 1')
  } else {
    initSqliteDb()
  }
}

export function getDatabaseKind(): 'postgres' | 'sqlite' {
  return isPostgresEnabled() ? 'postgres' : 'sqlite'
}
