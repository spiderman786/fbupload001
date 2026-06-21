import { v4 as uuid } from 'uuid'
import { db } from '../db.js'

export function writeOpsAudit(
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
) {
  db.prepare(`
    INSERT INTO ops_audit_log (id, admin_user_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    adminUserId,
    action,
    targetType ?? null,
    targetId ?? null,
    details ? JSON.stringify(details) : null,
  )
}

export function listOpsAudit(limit = 100) {
  return db
    .prepare(`
      SELECT a.*, u.email as admin_email, u.full_name as admin_name
      FROM ops_audit_log a
      JOIN users u ON u.id = a.admin_user_id
      ORDER BY a.created_at DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        details: r.details ? JSON.parse(String(r.details)) : null,
        adminEmail: r.admin_email,
        adminName: r.admin_name,
        createdAt: r.created_at,
      }
    })
}
