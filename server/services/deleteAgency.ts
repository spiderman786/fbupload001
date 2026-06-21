import { db } from '../db.js'

const PROTECTED_NAMES = new Set(['Platform Ops'])

export function deleteAgency(agencyId: string, confirmName: string): void {
  const agency = db.prepare('SELECT id, name FROM agencies WHERE id = ?').get(agencyId) as
    | { id: string; name: string }
    | undefined
  if (!agency) throw new Error('Agency not found')
  if (PROTECTED_NAMES.has(agency.name)) throw new Error('This agency cannot be deleted')
  if (confirmName.trim() !== agency.name) throw new Error('Agency name confirmation does not match')

  const childCount = (
    db.prepare('SELECT COUNT(*) as c FROM agencies WHERE parent_agency_id = ?').get(agencyId) as { c: number }
  ).c
  if (childCount > 0) throw new Error('Delete or reassign child agencies first')

  db.transaction(() => {
    db.prepare('DELETE FROM posted_reels WHERE agency_id = ?').run(agencyId)
    db.prepare('DELETE FROM page_source_assignments WHERE agency_id = ?').run(agencyId)
    db.prepare('DELETE FROM agencies WHERE id = ?').run(agencyId)
  })()
}

export function pauseAllAgencyPages(agencyId: string): number {
  const result = db
    .prepare("UPDATE facebook_pages SET status = 'paused' WHERE agency_id = ? AND status = 'active'")
    .run(agencyId)
  return result.changes
}
