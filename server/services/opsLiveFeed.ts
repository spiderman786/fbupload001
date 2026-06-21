import { db } from '../db.js'

export type LiveEvent = {
  type: 'job' | 'log'
  id: string
  jobId?: string
  status?: string
  step?: string
  message?: string
  level?: string
  agencyName?: string | null
  pageName?: string | null
  at: string
}

export function pollLiveEvents(sinceIso: string, limit = 50): LiveEvent[] {
  const events: LiveEvent[] = []

  const jobs = db
    .prepare(`
      SELECT r.id, r.status, r.error_message, r.created_at, r.completed_at,
        a.name as agency_name, p.name as page_name
      FROM reel_jobs r
      LEFT JOIN agencies a ON a.id = r.agency_id
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      WHERE COALESCE(r.completed_at, r.created_at) > ?
      ORDER BY COALESCE(r.completed_at, r.created_at) DESC
      LIMIT ?
    `)
    .all(sinceIso, limit) as Record<string, unknown>[]

  for (const j of jobs) {
    events.push({
      type: 'job',
      id: String(j.id),
      status: String(j.status),
      message: j.error_message ? String(j.error_message) : undefined,
      agencyName: j.agency_name as string | null,
      pageName: j.page_name as string | null,
      at: String(j.completed_at ?? j.created_at),
    })
  }

  const logs = db
    .prepare(`
      SELECT l.id, l.job_id, l.step, l.message, l.level, l.created_at,
        a.name as agency_name, p.name as page_name
      FROM job_logs l
      JOIN reel_jobs r ON r.id = l.job_id
      LEFT JOIN agencies a ON a.id = r.agency_id
      LEFT JOIN facebook_pages p ON p.id = r.target_page_id
      WHERE l.created_at > ?
      ORDER BY l.created_at DESC
      LIMIT ?
    `)
    .all(sinceIso, limit) as Record<string, unknown>[]

  for (const l of logs) {
    events.push({
      type: 'log',
      id: String(l.id),
      jobId: String(l.job_id),
      step: String(l.step),
      message: String(l.message),
      level: String(l.level),
      agencyName: l.agency_name as string | null,
      pageName: l.page_name as string | null,
      at: String(l.created_at),
    })
  }

  return events.sort((a, b) => (a.at > b.at ? -1 : 1)).slice(0, limit)
}
