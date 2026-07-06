-- PostgreSQL schema for fbuploadpro (10k+ page scale). Timestamps stored as TEXT (UTC) for SQLite parity.

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
  password_reset_token TEXT,
  password_reset_expires TEXT,
  google_id TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'password',
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique ON users(google_id) WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_balance INTEGER NOT NULL DEFAULT 0,
  subdomain TEXT,
  whatsapp_number TEXT,
  parent_agency_id TEXT REFERENCES agencies(id) ON DELETE SET NULL,
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agencies_subdomain_unique ON agencies(subdomain) WHERE subdomain IS NOT NULL;

CREATE TABLE IF NOT EXISTS agency_members (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'staff')),
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')),
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
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS facebook_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  meta_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TEXT,
  byoc_credential_id TEXT,
  display_name TEXT,
  connected_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS facebook_pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  facebook_account_id TEXT REFERENCES facebook_accounts(id) ON DELETE SET NULL,
  meta_page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  followers TEXT DEFAULT '0',
  followers_count INTEGER,
  followers_baseline INTEGER,
  followers_gained INTEGER NOT NULL DEFAULT 0,
  last_followers_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
  health_status TEXT NOT NULL DEFAULT 'completed',
  reels_posted_today INTEGER NOT NULL DEFAULT 0,
  daily_reel_limit INTEGER NOT NULL DEFAULT 6,
  last_published_at TEXT,
  page_access_token TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  profile_picture_url TEXT,
  profile_picture_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS source_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('instagram', 'tiktok', 'youtube', 'facebook')),
  username TEXT NOT NULL,
  tokens_per_reel INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  publish_mode TEXT NOT NULL DEFAULT 'direct',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'completed')),
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS schedule_slot_pages (
  slot_id TEXT NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (slot_id, page_id)
);

CREATE TABLE IF NOT EXISTS reel_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  source_account_id TEXT REFERENCES source_accounts(id) ON DELETE SET NULL,
  target_page_id TEXT REFERENCES facebook_pages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'publishing', 'published', 'failed', 'queued')),
  job_type TEXT NOT NULL DEFAULT 'scheduled',
  source_url TEXT,
  source_reel_id TEXT,
  meta_post_id TEXT,
  tokens_charged INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  scheduled_for TEXT,
  completed_at TEXT,
  local_file_path TEXT,
  cleaned_file_path TEXT,
  metadata_stripped INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  thumbnail_path TEXT,
  r2_video_key TEXT,
  r2_thumb_key TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('purchase', 'publish_debit', 'refund', 'signup_bonus')),
  reel_job_id TEXT REFERENCES reel_jobs(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS byoc_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'youtube', 'instagram', 'tiktok')),
  label TEXT NOT NULL DEFAULT 'App 1',
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  redirect_uri TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS page_source_assignments (
  page_id TEXT PRIMARY KEY REFERENCES facebook_pages(id) ON DELETE CASCADE,
  source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  scrape_status TEXT NOT NULL DEFAULT 'idle',
  scrape_error TEXT,
  source_assigned_at TEXT,
  catalog_total INTEGER,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS posted_reels (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL,
  page_id TEXT NOT NULL REFERENCES facebook_pages(id) ON DELETE CASCADE,
  source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
  source_reel_id TEXT NOT NULL,
  source_url TEXT,
  meta_post_id TEXT,
  job_id TEXT REFERENCES reel_jobs(id) ON DELETE SET NULL,
  posted_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')),
  UNIQUE(page_id, source_reel_id)
);

CREATE TABLE IF NOT EXISTS page_automation_settings (
  page_id TEXT PRIMARY KEY REFERENCES facebook_pages(id) ON DELETE CASCADE,
  posts_per_day INTEGER NOT NULL DEFAULT 3,
  posting_logic TEXT NOT NULL DEFAULT 'dailyrandom',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  schedule_times TEXT NOT NULL DEFAULT '["03:14","09:43","16:23"]',
  hashtags TEXT NOT NULL DEFAULT '["#reels","#viral","#trending","#foryou","#shorts"]',
  last_schedule_fire TEXT,
  next_publish_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS ops_alert_config (
  alert_type TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  threshold REAL,
  webhook_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES reel_jobs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS ops_audit_log (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS agency_ops_notes (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS ops_alert_log (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_to TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS google_oauth_states (
  state TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'login',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS facebook_oauth_magic_links (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  byoc_credential_id TEXT,
  label TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS facebook_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agency_id TEXT NOT NULL,
  byoc_credential_id TEXT,
  magic_link_id TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_agency ON facebook_pages(agency_id);
CREATE INDEX IF NOT EXISTS idx_pages_active ON facebook_pages(status, health_status);
CREATE INDEX IF NOT EXISTS idx_sources_agency ON source_accounts(agency_id);
CREATE INDEX IF NOT EXISTS idx_slots_agency ON schedule_slots(agency_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON reel_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON reel_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_agency ON reel_jobs(agency_id);
CREATE INDEX IF NOT EXISTS idx_jobs_page_status ON reel_jobs(target_page_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON reel_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_agency ON token_transactions(agency_id);
CREATE INDEX IF NOT EXISTS idx_posted_reels_page ON posted_reels(page_id);
CREATE INDEX IF NOT EXISTS idx_posted_reels_source ON posted_reels(source_account_id, source_reel_id);
CREATE INDEX IF NOT EXISTS idx_pas_next_publish ON page_automation_settings(next_publish_at);
CREATE INDEX IF NOT EXISTS idx_agency_members_user ON agency_members(user_id);
CREATE INDEX IF NOT EXISTS idx_agency_members_agency ON agency_members(agency_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
