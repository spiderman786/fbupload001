const NOW_SQL = "to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')"

function pgIntervalFromNowLiteral(interval: string): string {
  return `to_char((NOW() AT TIME ZONE 'UTC' + INTERVAL '${interval}'), 'YYYY-MM-DD HH24:MI:SS')`
}

/** Adapt SQLite-style SQL for PostgreSQL prepared statements. */
export function toPostgresSql(sql: string): string {
  let out = sql

  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
  if (/INSERT\s+INTO/i.test(out) && !/ON\s+CONFLICT/i.test(out)) {
    const match = out.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i)
    if (match) {
      const table = match[1]
      const cols = match[2].split(',').map((c) => c.trim())
      const pk = inferConflictColumn(table, cols)
      if (pk) {
        out = `${out.trim()} ON CONFLICT (${pk}) DO NOTHING`
      }
    }
  }

  out = out.replace(/GROUP_CONCAT\s*\(\s*([^)]+?)\s*\)/gi, 'STRING_AGG($1::text, \',\')')
  out = out.replace(
    /datetime\s*\(\s*'now'\s*,\s*'(-?\d+\s+(?:day|days|hour|hours|minute|minutes|second|seconds|month|months|year|years))'\s*\)/gi,
    (_match, interval: string) => pgIntervalFromNowLiteral(interval),
  )
  out = out.replace(/datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi, `(NOW() AT TIME ZONE 'UTC' + (?::text)::interval)::text`)
  // Column-vs-now comparisons must run before bare datetime('now') replacement,
  // otherwise Postgres receives datetime(column) which does not exist.
  out = out.replace(
    /datetime\s*\(\s*([a-z_][\w.]*)\s*\)\s*<\s*datetime\s*\(\s*'now'\s*\)/gi,
    "($1::timestamp AT TIME ZONE 'UTC') < (NOW() AT TIME ZONE 'UTC')",
  )
  out = out.replace(
    /datetime\s*\(\s*([a-z_][\w.]*)\s*\)\s*>\s*datetime\s*\(\s*'now'\s*\)/gi,
    "($1::timestamp AT TIME ZONE 'UTC') > (NOW() AT TIME ZONE 'UTC')",
  )
  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, NOW_SQL)
  out = out.replace(/date\(([a-z_][\w.]*)\)/gi, 'LEFT($1, 10)')
  out = out.replace(/date\(\?\)/gi, '?')
  out = out.replace(/PRAGMA\s+\w+\s*=\s*\w+/gi, '-- pragma stripped')

  let index = 0
  out = out.replace(/\?/g, () => `$${++index}`)

  return out
}

function inferConflictColumn(table: string, cols: string[]): string | null {
  const t = table.toLowerCase()
  if (t === 'posted_reels') return cols.includes('page_id') && cols.includes('source_reel_id') ? 'page_id, source_reel_id' : null
  if (t === 'posted_articles') return cols.includes('page_id') && cols.includes('article_url') ? 'page_id, article_url' : null
  if (t === 'platform_settings') return 'key'
  if (t === 'page_automation_settings') return 'page_id'
  if (t === 'page_news_settings') return 'page_id'
  if (t === 'agency_ai_settings') return 'agency_id'
  // agency_members: do not auto-upsert — signup and invites must surface duplicate errors
  if (t === 'byoc_credentials' && cols.includes('user_id') && cols.includes('platform') && !cols.includes('id')) {
    return 'user_id, platform'
  }
  return null
}

export function toPgParams(params: unknown[]): unknown[] {
  return params
}
