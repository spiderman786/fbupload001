import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { parseFollowers } from './utils/followers.js'
import { v4 as uuid } from 'uuid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, 'fbuploadpro.db')
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      phone_country_code TEXT NOT NULL DEFAULT '+92',
      phone_number TEXT NOT NULL,
      token_balance INTEGER NOT NULL DEFAULT 0,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_code TEXT,
      verification_expires TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS facebook_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      meta_user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_expiry TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS facebook_pages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      facebook_account_id TEXT REFERENCES facebook_accounts(id) ON DELETE SET NULL,
      meta_page_id TEXT NOT NULL,
      name TEXT NOT NULL,
      followers TEXT DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
      reels_posted_today INTEGER NOT NULL DEFAULT 0,
      last_published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('instagram', 'tiktok', 'youtube', 'facebook')),
      username TEXT NOT NULL,
      tokens_per_reel INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'completed')),
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_slot_pages (
      slot_id TEXT NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
      PRIMARY KEY (slot_id, page_id)
    );

    CREATE TABLE IF NOT EXISTS reel_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_account_id TEXT REFERENCES source_accounts(id) ON DELETE SET NULL,
      target_page_id TEXT REFERENCES facebook_pages(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'publishing', 'published', 'failed')),
      source_url TEXT,
      meta_post_id TEXT,
      tokens_charged INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      scheduled_for TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('purchase', 'publish_debit', 'refund', 'signup_bonus')),
      reel_job_id TEXT REFERENCES reel_jobs(id) ON DELETE SET NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pages_user ON facebook_pages(user_id);
    CREATE INDEX IF NOT EXISTS idx_sources_user ON source_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_slots_user ON schedule_slots(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON reel_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON reel_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON token_transactions(user_id);
  `)

  migrate()
}

function addAgencyIdColumn(table: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'agency_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE`)
  }
}

function migrateAgencies() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agencies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_balance INTEGER NOT NULL DEFAULT 0,
      whatsapp_number TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agency_members (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'staff')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agency_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS agency_invites (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      invited_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agency_members_user ON agency_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_agency_members_agency ON agency_members(agency_id);
    CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token);
  `)

  const agencyCols = db.prepare('PRAGMA table_info(agencies)').all() as { name: string }[]
  if (!agencyCols.some((c) => c.name === 'whatsapp_number')) {
    db.exec(`ALTER TABLE agencies ADD COLUMN whatsapp_number TEXT`)
  }

  for (const table of [
    'facebook_accounts',
    'facebook_pages',
    'source_accounts',
    'schedule_slots',
    'reel_jobs',
    'token_transactions',
    'page_source_assignments',
  ]) {
    addAgencyIdColumn(table)
  }

  const byocCols = db.prepare('PRAGMA table_info(byoc_credentials)').all() as { name: string }[]
  if (byocCols.length && !byocCols.some((c) => c.name === 'agency_id')) {
    db.exec(`ALTER TABLE byoc_credentials ADD COLUMN agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE`)
  }

  const users = db.prepare('SELECT id, full_name, token_balance FROM users').all() as {
    id: string
    full_name: string
    token_balance: number
  }[]

  for (const user of users) {
    const member = db
      .prepare('SELECT agency_id FROM agency_members WHERE user_id = ? LIMIT 1')
      .get(user.id) as { agency_id: string } | undefined

    let agencyId = member?.agency_id
    if (!agencyId) {
      agencyId = uuid()
      db.prepare('INSERT INTO agencies (id, name, token_balance, whatsapp_number) VALUES (?, ?, ?, ?)').run(
        agencyId,
        `${user.full_name}'s Agency`,
        user.token_balance,
        null,
      )
      db.prepare('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)').run(
        uuid(),
        agencyId,
        user.id,
        'owner',
      )
    }

    for (const table of [
      'facebook_accounts',
      'facebook_pages',
      'source_accounts',
      'schedule_slots',
      'reel_jobs',
      'token_transactions',
      'page_source_assignments',
    ]) {
      db.prepare(`UPDATE ${table} SET agency_id = ? WHERE user_id = ? AND agency_id IS NULL`).run(agencyId, user.id)
    }

    db.prepare('UPDATE byoc_credentials SET agency_id = ? WHERE user_id = ? AND agency_id IS NULL').run(
      agencyId,
      user.id,
    )
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pages_agency ON facebook_pages(agency_id);
    CREATE INDEX IF NOT EXISTS idx_sources_agency ON source_accounts(agency_id);
    CREATE INDEX IF NOT EXISTS idx_slots_agency ON schedule_slots(agency_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_agency ON reel_jobs(agency_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_agency ON token_transactions(agency_id);
  `)
}

function migrate() {
  const cols = db.prepare("PRAGMA table_info(facebook_pages)").all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('health_status')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN health_status TEXT NOT NULL DEFAULT 'completed'`)
  }
  if (!names.has('followers_gained')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN followers_gained INTEGER NOT NULL DEFAULT 0`)
  }
  if (!names.has('page_access_token')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN page_access_token TEXT`)
  }
  if (!names.has('followers_count')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN followers_count INTEGER`)
  }
  if (!names.has('followers_baseline')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN followers_baseline INTEGER`)
  }
  if (!names.has('last_followers_sync_at')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN last_followers_sync_at TEXT`)
  }
  if (!names.has('daily_reel_limit')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN daily_reel_limit INTEGER NOT NULL DEFAULT 6`)
  }

  const pagesNeedingBackfill = db
    .prepare('SELECT id, followers FROM facebook_pages WHERE followers_count IS NULL')
    .all() as { id: string; followers: string }[]
  for (const p of pagesNeedingBackfill) {
    const count = parseFollowers(p.followers)
    db.prepare(`
      UPDATE facebook_pages SET
        followers_count = ?,
        followers_baseline = COALESCE(followers_baseline, ?),
        followers_gained = COALESCE(followers_gained, 0)
      WHERE id = ?
    `).run(count, count, p.id)
  }

  const jobCols = db.prepare("PRAGMA table_info(reel_jobs)").all() as { name: string }[]
  const jobNames = new Set(jobCols.map((c) => c.name))
  const jobMigrations: [string, string][] = [
    ['local_file_path', 'TEXT'],
    ['cleaned_file_path', 'TEXT'],
    ['metadata_stripped', 'INTEGER NOT NULL DEFAULT 0'],
    ['job_type', "TEXT NOT NULL DEFAULT 'scheduled'"],
    ['source_reel_id', 'TEXT'],
  ]
  for (const [col, type] of jobMigrations) {
    if (!jobNames.has(col)) db.exec(`ALTER TABLE reel_jobs ADD COLUMN ${col} ${type}`)
  }

  const slotCols = db.prepare("PRAGMA table_info(schedule_slots)").all() as { name: string }[]
  const slotNames = new Set(slotCols.map((c) => c.name))
  if (!slotNames.has('publish_mode')) {
    db.exec(`ALTER TABLE schedule_slots ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'direct'`)
  }
  if (!slotNames.has('timezone')) {
    db.exec(`ALTER TABLE schedule_slots ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS byoc_credentials (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('facebook', 'youtube', 'instagram', 'tiktok')),
      app_id TEXT NOT NULL,
      app_secret TEXT NOT NULL,
      redirect_uri TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform)
    );

    CREATE TABLE IF NOT EXISTS page_source_assignments (
      page_id TEXT PRIMARY KEY REFERENCES facebook_pages(id) ON DELETE CASCADE,
      source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_user ON page_source_assignments(user_id);

    CREATE TABLE IF NOT EXISTS posted_reels (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL,
      page_id TEXT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
      source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
      source_reel_id TEXT NOT NULL,
      source_url TEXT,
      meta_post_id TEXT,
      job_id TEXT REFERENCES reel_jobs(id) ON DELETE SET NULL,
      posted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(page_id, source_reel_id)
    );

    CREATE INDEX IF NOT EXISTS idx_posted_reels_page ON posted_reels(page_id);
    CREATE INDEX IF NOT EXISTS idx_posted_reels_source ON posted_reels(source_account_id, source_reel_id);
  `)

  migrateAgencies()
}

export type UserRow = {
  id: string
  email: string
  full_name: string
  password_hash: string
  phone_country_code: string
  phone_number: string
  token_balance: number
  email_verified: number
  verification_code: string | null
  verification_expires: string | null
  created_at: string
}
