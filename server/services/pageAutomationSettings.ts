import { db } from '../db.js'

export type PageAutomationSettings = {
  postsPerDay: number
  postingLogic: string
  timezone: string
  scheduleTimes: string[]
  hashtags: string[]
}

const DEFAULT_TIMES = ['03:14', '09:43', '16:23']
const DEFAULT_TAGS = ['#reels', '#viral', '#trending', '#foryou', '#shorts']

function parseJsonArray(raw: string | null, fallback: string[]): string[] {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : fallback
  } catch {
    return fallback
  }
}

export function getPageAutomationSettings(pageId: string): PageAutomationSettings {
  const row = db.prepare('SELECT * FROM page_automation_settings WHERE page_id = ?').get(pageId) as
    | Record<string, unknown>
    | undefined

  if (!row) {
    return {
      postsPerDay: 3,
      postingLogic: 'dailyrandom',
      timezone: 'America/New_York',
      scheduleTimes: DEFAULT_TIMES,
      hashtags: DEFAULT_TAGS,
    }
  }

  return {
    postsPerDay: Number(row.posts_per_day ?? 3),
    postingLogic: String(row.posting_logic ?? 'dailyrandom'),
    timezone: String(row.timezone ?? 'America/New_York'),
    scheduleTimes: parseJsonArray(row.schedule_times as string, DEFAULT_TIMES),
    hashtags: parseJsonArray(row.hashtags as string, DEFAULT_TAGS),
  }
}

export function upsertPageAutomationSettings(pageId: string, input: Partial<PageAutomationSettings>) {
  const current = getPageAutomationSettings(pageId)
  const next = { ...current, ...input }

  db.prepare(`
    INSERT INTO page_automation_settings (page_id, posts_per_day, posting_logic, timezone, schedule_times, hashtags, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(page_id) DO UPDATE SET
      posts_per_day = excluded.posts_per_day,
      posting_logic = excluded.posting_logic,
      timezone = excluded.timezone,
      schedule_times = excluded.schedule_times,
      hashtags = excluded.hashtags,
      updated_at = excluded.updated_at
  `).run(
    pageId,
    next.postsPerDay,
    next.postingLogic,
    next.timezone,
    JSON.stringify(next.scheduleTimes),
    JSON.stringify(next.hashtags),
  )

  if (input.postsPerDay !== undefined) {
    db.prepare('UPDATE facebook_pages SET daily_reel_limit = ? WHERE id = ?').run(next.postsPerDay, pageId)
  }

  return next
}

export function ensurePageAutomationSettings(pageId: string) {
  const existing = db.prepare('SELECT page_id FROM page_automation_settings WHERE page_id = ?').get(pageId)
  if (!existing) {
    const page = db.prepare('SELECT daily_reel_limit FROM facebook_pages WHERE id = ?').get(pageId) as
      | { daily_reel_limit: number }
      | undefined
    upsertPageAutomationSettings(pageId, {
      postsPerDay: page?.daily_reel_limit ?? 3,
    })
  }
}
