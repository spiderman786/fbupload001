import { db } from '../db.js'

export type AgencyHealth = {
  agencyId: string
  name: string
  score: number
  status: 'healthy' | 'warning' | 'critical'
  reasons: string[]
  tokenBalance: number
  failed7d: number
  published7d: number
  activePages: number
}

export function getAgencyHealthScores(): AgencyHealth[] {
  const agencies = db
    .prepare(`
      SELECT a.id, a.name, a.token_balance,
        (SELECT COUNT(*) FROM facebook_pages p WHERE p.agency_id = a.id AND p.status = 'active') as active_pages,
        (SELECT COUNT(*) FROM reel_jobs j WHERE j.agency_id = a.id AND j.status = 'failed' AND j.created_at >= datetime('now', '-7 days')) as failed_7d,
        (SELECT COUNT(*) FROM reel_jobs j WHERE j.agency_id = a.id AND j.status = 'published' AND j.created_at >= datetime('now', '-7 days')) as published_7d
      FROM agencies a
      WHERE a.name != 'Platform Ops'
      ORDER BY a.name ASC
    `)
    .all() as {
    id: string
    name: string
    token_balance: number
    active_pages: number
    failed_7d: number
    published_7d: number
  }[]

  return agencies.map((a) => {
    const reasons: string[] = []
    let score = 100

    if (a.token_balance <= 0 && a.active_pages > 0) {
      score -= 40
      reasons.push('Zero tokens with active pages')
    } else if (a.token_balance < 100 && a.active_pages > 0) {
      score -= 15
      reasons.push('Low token balance')
    }

    const total7d = a.failed_7d + a.published_7d
    if (total7d >= 5) {
      const failRate = a.failed_7d / total7d
      if (failRate > 0.3) {
        score -= 35
        reasons.push(`High fail rate (${Math.round(failRate * 100)}% last 7d)`)
      } else if (failRate > 0.15) {
        score -= 15
        reasons.push(`Elevated fail rate (${Math.round(failRate * 100)}%)`)
      }
    }

    if (a.active_pages === 0 && a.published_7d === 0) {
      score -= 10
      reasons.push('No active pages')
    }

    score = Math.max(0, Math.min(100, score))
    const status: AgencyHealth['status'] = score >= 75 ? 'healthy' : score >= 45 ? 'warning' : 'critical'

    return {
      agencyId: a.id,
      name: a.name,
      score,
      status,
      reasons,
      tokenBalance: a.token_balance,
      failed7d: a.failed_7d,
      published7d: a.published_7d,
      activePages: a.active_pages,
    }
  })
}

export function globalOpsSearch(query: string, limit = 30) {
  const q = query.trim()
  if (q.length < 2) return { agencies: [], pages: [], jobs: [], query: q }

  const like = `%${q}%`

  const agencies = db
    .prepare(`
      SELECT a.id, a.name, a.token_balance,
        (SELECT email FROM users u JOIN agency_members m ON m.user_id = u.id WHERE m.agency_id = a.id AND m.role = 'owner' LIMIT 1) as owner_email
      FROM agencies a
      WHERE a.name LIKE ? OR a.id LIKE ? OR a.subdomain LIKE ?
      LIMIT ?
    `)
    .all(like, like, like, limit)

  const pages = db
    .prepare(`
      SELECT p.id, p.name, p.status, a.name as agency_name
      FROM facebook_pages p
      JOIN agencies a ON a.id = p.agency_id
      WHERE p.name LIKE ? OR p.id LIKE ? OR p.meta_page_id LIKE ?
      LIMIT ?
    `)
    .all(like, like, like, limit)

  const jobs = db
    .prepare(`
      SELECT r.id, r.status, r.error_message, a.name as agency_name, p.name as page_name
      FROM reel_jobs r
      LEFT JOIN agencies a ON a.id = r.agency_id
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      WHERE r.id LIKE ? OR r.error_message LIKE ? OR r.source_url LIKE ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `)
    .all(like, like, like, limit)

  return { agencies, pages, jobs, query: q }
}

export function getJobErrorGroups(days = 7) {
  return db
    .prepare(`
      SELECT error_message, COUNT(*) as count,
        GROUP_CONCAT(id) as job_ids
      FROM reel_jobs
      WHERE status = 'failed' AND error_message IS NOT NULL
        AND created_at >= datetime('now', ?)
      GROUP BY error_message
      ORDER BY count DESC
      LIMIT 25
    `)
    .all(`-${days} days`)
    .map((row) => {
      const r = row as { error_message: string; count: number; job_ids: string }
      return {
        errorMessage: r.error_message,
        count: r.count,
        jobIds: r.job_ids.split(',').slice(0, 100),
      }
    })
}
