import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

export type JobLogLevel = 'info' | 'warn' | 'error'

export function appendJobLog(
  jobId: string,
  step: string,
  message: string,
  level: JobLogLevel = 'info',
  meta?: Record<string, unknown>,
) {
  db.prepare(`
    INSERT INTO job_logs (id, job_id, step, level, message, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), jobId, step, level, message, meta ? JSON.stringify(meta) : null)
}

export function getJobLogs(jobId: string) {
  return db
    .prepare('SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at ASC')
    .all(jobId)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id,
        step: r.step,
        level: r.level,
        message: r.message,
        meta: r.meta ? JSON.parse(String(r.meta)) : null,
        createdAt: r.created_at,
      }
    })
}
