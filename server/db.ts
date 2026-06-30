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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'publishing', 'published', 'failed', 'queued')),
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
      subdomain TEXT,
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
  if (!agencyCols.some((c) => c.name === 'subdomain')) {
    db.exec(`ALTER TABLE agencies ADD COLUMN subdomain TEXT`)
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agencies_subdomain_unique ON agencies(subdomain) WHERE subdomain IS NOT NULL`)

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
      db.prepare('INSERT INTO agencies (id, name, token_balance, whatsapp_number, subdomain) VALUES (?, ?, ?, ?, ?)').run(
        agencyId,
        `${user.full_name}'s Agency`,
        user.token_balance,
        null,
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
    ['caption', 'TEXT'],
    ['thumbnail_path', 'TEXT'],
    ['r2_video_key', 'TEXT'],
    ['r2_thumb_key', 'TEXT'],
  ]
  for (const [col, type] of jobMigrations) {
    if (!jobNames.has(col)) db.exec(`ALTER TABLE reel_jobs ADD COLUMN ${col} ${type}`)
  }
  if (!jobNames.has('created_at')) {
    db.exec(`ALTER TABLE reel_jobs ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`)
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
  migrateMultiByoc()
  migrateOps()
  migratePasswordReset()
  migrateFacebookOAuth()
}

function migrateFacebookOAuth() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facebook_oauth_magic_links (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      byoc_credential_id TEXT REFERENCES byoc_credentials(id) ON DELETE SET NULL,
      label TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_facebook_oauth_magic_agency ON facebook_oauth_magic_links(agency_id);
    CREATE INDEX IF NOT EXISTS idx_facebook_oauth_magic_byoc ON facebook_oauth_magic_links(agency_id, byoc_credential_id);

    CREATE TABLE IF NOT EXISTS facebook_oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agency_id TEXT NOT NULL,
      byoc_credential_id TEXT,
      magic_link_id TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facebook_oauth_states_expires ON facebook_oauth_states(expires_at);
  `)
}

function migratePasswordReset() {
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'password_reset_token')) {
    db.exec(`ALTER TABLE users ADD COLUMN password_reset_token TEXT`)
  }
  if (!cols.some((c) => c.name === 'password_reset_expires')) {
    db.exec(`ALTER TABLE users ADD COLUMN password_reset_expires TEXT`)
  }
}

function migrateOps() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES reel_jobs(id) ON DELETE CASCADE,
      step TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
      message TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ops_audit_log (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agency_ops_notes (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      admin_user_id TEXT NOT NULL REFERENCES users(id),
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ops_alert_log (
      id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_ops_audit_created ON ops_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_ops_alerts_type ON ops_alert_log(alert_type, created_at);
  `)

  const jobCols = db.prepare('PRAGMA table_info(reel_jobs)').all() as { name: string }[]
  if (!jobCols.some((c) => c.name === 'retry_count')) {
    db.exec(`ALTER TABLE reel_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`)
  }

  const agencyCols = db.prepare('PRAGMA table_info(agencies)').all() as { name: string }[]
  if (!agencyCols.some((c) => c.name === 'parent_agency_id')) {
    db.exec(`ALTER TABLE agencies ADD COLUMN parent_agency_id TEXT REFERENCES agencies(id) ON DELETE SET NULL`)
  }
  if (!agencyCols.some((c) => c.name === 'maintenance_mode')) {
    db.exec(`ALTER TABLE agencies ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0`)
  }

  const pageCols = db.prepare('PRAGMA table_info(facebook_pages)').all() as { name: string }[]
  if (!pageCols.some((c) => c.name === 'consecutive_failures')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`)
  }
  if (!pageCols.some((c) => c.name === 'profile_picture_url')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN profile_picture_url TEXT`)
  }
  if (!pageCols.some((c) => c.name === 'profile_picture_synced_at')) {
    db.exec(`ALTER TABLE facebook_pages ADD COLUMN profile_picture_synced_at TEXT`)
  }

  const sourceCols = db.prepare('PRAGMA table_info(source_accounts)').all() as { name: string }[]
  if (!sourceCols.some((c) => c.name === 'consecutive_failures')) {
    db.exec(`ALTER TABLE source_accounts ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ops_alert_config (
      alert_type TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      threshold REAL,
      webhook_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS page_automation_settings (
      page_id TEXT PRIMARY KEY REFERENCES facebook_pages(id) ON DELETE CASCADE,
      posts_per_day INTEGER NOT NULL DEFAULT 3,
      posting_logic TEXT NOT NULL DEFAULT 'dailyrandom',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      schedule_times TEXT NOT NULL DEFAULT '["03:14","09:43","16:23"]',
      hashtags TEXT NOT NULL DEFAULT '["#reels","#viral","#trending","#foryou","#shorts"]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateReelJobsQueuedStatus()
  migrateScrapeAndSchedule()
  migrateNews()
}

function migrateNews() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_templates (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      layout_preset TEXT NOT NULL DEFAULT 'popcorn',
      colors_json TEXT NOT NULL DEFAULT '{"accent":"#00D4FF","text":"#FFFFFF","barBg":"#000000","cta":"#AAAAAA","insetBorder":"#00D4FF"}',
      fonts_json TEXT NOT NULL DEFAULT '{"headlineSize":50,"textSize":50,"ctaSize":20,"pageNameSize":15}',
      logo_path TEXT,
      cta_text TEXT NOT NULL DEFAULT '',
      default_hashtags_json TEXT NOT NULL DEFAULT '[]',
      ai_tone_prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rss_feeds (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      page_id TEXT REFERENCES facebook_pages(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      template_id TEXT REFERENCES news_templates(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_polled_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS page_news_settings (
      page_id TEXT PRIMARY KEY REFERENCES facebook_pages(id) ON DELETE CASCADE,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      template_id TEXT REFERENCES news_templates(id) ON DELETE SET NULL,
      auto_publish INTEGER NOT NULL DEFAULT 1,
      posts_per_day INTEGER NOT NULL DEFAULT 4,
      schedule_times TEXT NOT NULL DEFAULT '["07:30","10:00","13:00","16:00"]',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      comment_link_enabled INTEGER NOT NULL DEFAULT 0,
      include_link_in_caption INTEGER NOT NULL DEFAULT 0,
      ai_rewrite_enabled INTEGER NOT NULL DEFAULT 0,
      default_hashtags_json TEXT NOT NULL DEFAULT '[]',
      schedule_offset_minutes INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      feed_id TEXT REFERENCES rss_feeds(id) ON DELETE SET NULL,
      page_id TEXT REFERENCES facebook_pages(id) ON DELETE SET NULL,
      template_id TEXT REFERENCES news_templates(id) ON DELETE SET NULL,
      article_url TEXT NOT NULL,
      rss_title TEXT,
      rss_description TEXT,
      headline TEXT,
      accent_words_json TEXT NOT NULL DEFAULT '[]',
      post_title TEXT,
      post_description TEXT,
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      hero_image_url TEXT,
      inset_image_url TEXT,
      generated_image_path TEXT,
      fb_post_id TEXT,
      fb_comment_id TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','ready','posted','failed','skipped')),
      error_message TEXT,
      scheduled_for TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posted_articles (
      id TEXT PRIMARY KEY,
      agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
      article_url TEXT NOT NULL,
      news_item_id TEXT REFERENCES news_items(id) ON DELETE SET NULL,
      fb_post_id TEXT,
      posted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(page_id, article_url)
    );

    CREATE INDEX IF NOT EXISTS idx_news_templates_agency ON news_templates(agency_id);
    CREATE INDEX IF NOT EXISTS idx_rss_feeds_agency ON rss_feeds(agency_id);
    CREATE INDEX IF NOT EXISTS idx_rss_feeds_page ON rss_feeds(page_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_agency ON news_items(agency_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_status ON news_items(status);
    CREATE INDEX IF NOT EXISTS idx_news_items_page ON news_items(page_id, status);
    CREATE INDEX IF NOT EXISTS idx_posted_articles_page ON posted_articles(page_id);
  `)

  const templateCols = db.prepare('PRAGMA table_info(news_templates)').all() as { name: string }[]
  if (!templateCols.some((c) => c.name === 'brand_type')) {
    db.exec(`ALTER TABLE news_templates ADD COLUMN brand_type TEXT NOT NULL DEFAULT 'page_name'`)
  }
  db.prepare(`UPDATE news_templates SET brand_type = 'page_picture' WHERE brand_type = 'page_name'`).run()

  const newsItemCols = db.prepare('PRAGMA table_info(news_items)').all() as { name: string }[]
  if (!newsItemCols.some((c) => c.name === 'image_crop_json')) {
    db.exec(`ALTER TABLE news_items ADD COLUMN image_crop_json TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS agency_ai_settings (
      agency_id TEXT PRIMARY KEY REFERENCES agencies(id) ON DELETE CASCADE,
      gemini_api_key TEXT,
      openai_api_key TEXT,
      ai_provider TEXT NOT NULL DEFAULT 'gemini',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function migrateScrapeAndSchedule() {
  const assignCols = db.prepare('PRAGMA table_info(page_source_assignments)').all() as { name: string }[]
  const assignNames = new Set(assignCols.map((c) => c.name))
  if (!assignNames.has('scrape_status')) {
    db.exec(`ALTER TABLE page_source_assignments ADD COLUMN scrape_status TEXT NOT NULL DEFAULT 'idle'`)
  }
  if (!assignNames.has('scrape_error')) {
    db.exec(`ALTER TABLE page_source_assignments ADD COLUMN scrape_error TEXT`)
  }
  if (!assignNames.has('source_assigned_at')) {
    db.exec(`ALTER TABLE page_source_assignments ADD COLUMN source_assigned_at TEXT`)
  }
  if (!assignNames.has('catalog_total')) {
    db.exec(`ALTER TABLE page_source_assignments ADD COLUMN catalog_total INTEGER`)
  }

  const pasCols = db.prepare('PRAGMA table_info(page_automation_settings)').all() as { name: string }[]
  const pasNames = new Set(pasCols.map((c) => c.name))
  if (!pasNames.has('last_schedule_fire')) {
    db.exec(`ALTER TABLE page_automation_settings ADD COLUMN last_schedule_fire TEXT`)
  }
}

function migrateReelJobsQueuedStatus() {
  const done = db.prepare("SELECT value FROM platform_settings WHERE key = 'reel_jobs_queued_status'").get() as
    | { value: string }
    | undefined
  if (done?.value === '1') return

  db.exec(`PRAGMA foreign_keys = OFF`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reel_jobs_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
      source_account_id TEXT REFERENCES source_accounts(id) ON DELETE SET NULL,
      target_page_id TEXT REFERENCES facebook_pages(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'publishing', 'published', 'failed', 'queued')),
      source_url TEXT,
      meta_post_id TEXT,
      tokens_charged INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      scheduled_for TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      local_file_path TEXT,
      cleaned_file_path TEXT,
      metadata_stripped INTEGER NOT NULL DEFAULT 0,
      job_type TEXT NOT NULL DEFAULT 'scheduled',
      source_reel_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    );

    INSERT INTO reel_jobs_v2 (
      id, user_id, agency_id, source_account_id, target_page_id, status, source_url, meta_post_id,
      tokens_charged, error_message, scheduled_for, completed_at, created_at, local_file_path,
      cleaned_file_path, metadata_stripped, job_type, source_reel_id, retry_count
    )
    SELECT
      id, user_id, agency_id, source_account_id, target_page_id, status, source_url, meta_post_id,
      tokens_charged, error_message, scheduled_for, completed_at, created_at, local_file_path,
      cleaned_file_path, metadata_stripped, job_type, source_reel_id, retry_count
    FROM reel_jobs;

    DROP TABLE reel_jobs;
    ALTER TABLE reel_jobs_v2 RENAME TO reel_jobs;

    CREATE INDEX IF NOT EXISTS idx_jobs_user ON reel_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON reel_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_agency ON reel_jobs(agency_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_page_status ON reel_jobs(target_page_id, status);
  `)
  db.exec(`PRAGMA foreign_keys = ON`)

  db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at) VALUES ('reel_jobs_queued_status', '1', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run()
}

function migrateMultiByoc() {
  const byocCols = db.prepare('PRAGMA table_info(byoc_credentials)').all() as { name: string }[]
  if (byocCols.length && !byocCols.some((c) => c.name === 'id')) {
    db.exec(`
      CREATE TABLE byoc_credentials_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK(platform IN ('facebook', 'youtube', 'instagram', 'tiktok')),
        label TEXT NOT NULL DEFAULT 'App 1',
        app_id TEXT NOT NULL,
        app_secret TEXT NOT NULL,
        redirect_uri TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const legacy = db.prepare('SELECT * FROM byoc_credentials').all() as {
      user_id: string
      agency_id: string | null
      platform: string
      app_id: string
      app_secret: string
      redirect_uri: string
      updated_at: string
    }[]

    const insert = db.prepare(`
      INSERT INTO byoc_credentials_v2 (id, user_id, agency_id, platform, label, app_id, app_secret, redirect_uri, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const row of legacy) {
      if (!row.agency_id) continue
      insert.run(
        uuid(),
        row.user_id,
        row.agency_id,
        row.platform,
        'Default App',
        row.app_id,
        row.app_secret,
        row.redirect_uri,
        row.updated_at,
      )
    }

    db.exec('DROP TABLE byoc_credentials')
    db.exec('ALTER TABLE byoc_credentials_v2 RENAME TO byoc_credentials')
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_byoc_agency_platform_app ON byoc_credentials(agency_id, platform, app_id);
    CREATE INDEX IF NOT EXISTS idx_byoc_agency_platform ON byoc_credentials(agency_id, platform);
  `)

  const accountCols = db.prepare('PRAGMA table_info(facebook_accounts)').all() as { name: string }[]
  if (!accountCols.some((c) => c.name === 'byoc_credential_id')) {
    db.exec(`ALTER TABLE facebook_accounts ADD COLUMN byoc_credential_id TEXT REFERENCES byoc_credentials(id) ON DELETE SET NULL`)
  }
  if (!accountCols.some((c) => c.name === 'display_name')) {
    db.exec(`ALTER TABLE facebook_accounts ADD COLUMN display_name TEXT`)
  }
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
  password_reset_token: string | null
  password_reset_expires: string | null
  created_at: string
}
