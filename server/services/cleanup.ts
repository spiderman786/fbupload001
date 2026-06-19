import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '../db.js'
import { purgePostedReelsOlderThanDays } from './dedup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'downloads')

const RETAIN_DAYS = Number(process.env.JOB_LOG_RETAIN_DAYS ?? 7)

export function cleanupStaleDownloadDirs() {
  if (!fs.existsSync(DOWNLOADS_DIR)) return

  const cutoff = Date.now() - 48 * 60 * 60 * 1000

  for (const tenant of fs.readdirSync(DOWNLOADS_DIR)) {
    const tenantPath = path.join(DOWNLOADS_DIR, tenant)
    if (!fs.statSync(tenantPath).isDirectory()) continue

    for (const jobDir of fs.readdirSync(tenantPath)) {
      const full = path.join(tenantPath, jobDir)
      try {
        const stat = fs.statSync(full)
        if (stat.mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

export function purgeOldJobLogs() {
  db.prepare(`
    DELETE FROM reel_jobs
    WHERE completed_at IS NOT NULL
      AND completed_at < datetime('now', ?)
      AND status IN ('published', 'failed')
  `).run(`-${RETAIN_DAYS} days`)

  purgePostedReelsOlderThanDays(RETAIN_DAYS)
}

export function runMaintenance() {
  cleanupStaleDownloadDirs()
  purgeOldJobLogs()
  console.log(`[cleanup] Maintenance done (retain ${RETAIN_DAYS} days)`)
}
