import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified, type AuthRequest } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import {
  assertAgencyMember,
  buildSessionPayload,
  canInvite,
  canManageTeam,
  setAgencyCookie,
  type AgencyRequest,
  type AgencyRole,
} from '../utils/agency.js'

export const agenciesRouter = Router()

// Public invite preview (no auth)
agenciesRouter.get('/invites/preview', (req, res) => {
  const token = req.query.token as string | undefined
  if (!token) {
    res.status(400).json({ error: 'token query param required' })
    return
  }

  const invite = db
    .prepare(`
      SELECT i.email, i.role, i.expires_at, a.name AS agency_name
      FROM agency_invites i
      JOIN agencies a ON a.id = i.agency_id
      WHERE i.token = ?
    `)
    .get(token) as Record<string, unknown> | undefined

  if (!invite) {
    res.status(404).json({ error: 'Invalid invite' })
    return
  }

  res.json({
    email: invite.email,
    role: invite.role,
    agencyName: invite.agency_name,
    expiresAt: invite.expires_at,
    expired: new Date(invite.expires_at as string) < new Date(),
  })
})

// Accept invite — auth only, no active agency required
agenciesRouter.post('/invites/accept', authMiddleware, requireVerified, (req: AuthRequest, res) => {
  const { token } = req.body ?? {}
  if (!token) {
    res.status(400).json({ error: 'Invite token is required' })
    return
  }

  const invite = db
    .prepare('SELECT * FROM agency_invites WHERE token = ?')
    .get(token) as Record<string, unknown> | undefined

  if (!invite) {
    res.status(404).json({ error: 'Invalid invite link' })
    return
  }
  if (new Date(invite.expires_at as string) < new Date()) {
    res.status(400).json({ error: 'Invite has expired' })
    return
  }
  if ((invite.email as string).toLowerCase() !== req.user!.email.toLowerCase()) {
    res.status(403).json({ error: 'This invite was sent to a different email address' })
    return
  }

  const existing = db
    .prepare('SELECT id FROM agency_members WHERE agency_id = ? AND user_id = ?')
    .get(invite.agency_id, req.user!.id)
  if (existing) {
    db.prepare('DELETE FROM agency_invites WHERE id = ?').run(invite.id)
    setAgencyCookie(res, invite.agency_id as string)
    res.json(buildSessionPayload(req.user!.id, invite.agency_id as string))
    return
  }

  db.prepare('INSERT INTO agency_members (id, agency_id, user_id, role) VALUES (?, ?, ?, ?)').run(
    uuid(),
    invite.agency_id,
    req.user!.id,
    invite.role,
  )
  db.prepare('DELETE FROM agency_invites WHERE id = ?').run(invite.id)

  setAgencyCookie(res, invite.agency_id as string)
  res.json(buildSessionPayload(req.user!.id, invite.agency_id as string))
})

agenciesRouter.use(authMiddleware, requireVerified, agencyMiddleware)

agenciesRouter.get('/session', (req: AgencyRequest, res) => {
  res.json(buildSessionPayload(req.user!.id, req.agency!.id))
})

agenciesRouter.post('/switch', (req: AgencyRequest, res) => {
  const { agencyId } = req.body ?? {}
  if (!agencyId) {
    res.status(400).json({ error: 'agencyId is required' })
    return
  }

  const agency = assertAgencyMember(req.user!.id, agencyId)
  if (!agency) {
    res.status(403).json({ error: 'You are not a member of this agency' })
    return
  }

  setAgencyCookie(res, agencyId)
  res.json(buildSessionPayload(req.user!.id, agencyId))
})

agenciesRouter.patch('/current', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { name, whatsappNumber } = req.body ?? {}
  const updates: string[] = []
  const params: unknown[] = []

  if (typeof name === 'string') {
    const trimmed = name.trim()
    if (!trimmed) {
      res.status(400).json({ error: 'Agency name cannot be empty' })
      return
    }
    updates.push('name = ?')
    params.push(trimmed)
  }

  if (typeof whatsappNumber === 'string') {
    const normalized = whatsappNumber.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
    if (normalized && !/^\+?\d{8,15}$/.test(normalized)) {
      res.status(400).json({ error: 'Enter a valid WhatsApp number (8-15 digits, optional +)' })
      return
    }
    updates.push('whatsapp_number = ?')
    params.push(normalized || null)
  }

  if (!updates.length) {
    res.status(400).json({ error: 'Provide name and/or WhatsApp number' })
    return
  }

  params.push(req.agency!.id)
  db.prepare(`UPDATE agencies SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  res.json(buildSessionPayload(req.user!.id, req.agency!.id))
})

agenciesRouter.get('/members', (req: AgencyRequest, res) => {
  const rows = db
    .prepare(`
      SELECT u.id, u.email, u.full_name, m.role, m.created_at
      FROM agency_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.agency_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.full_name
    `)
    .all(req.agency!.id) as Record<string, unknown>[]

  res.json({
    members: rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      joinedAt: r.created_at,
    })),
  })
})

agenciesRouter.post('/invites', (req: AgencyRequest, res) => {
  if (!canInvite(req.agency!.role)) {
    res.status(403).json({ error: 'Only owners and admins can invite team members' })
    return
  }

  const { email, role } = req.body ?? {}
  if (!email || !role) {
    res.status(400).json({ error: 'Email and role are required' })
    return
  }
  if (!['admin', 'staff'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin or staff' })
    return
  }
  if (req.agency!.role === 'admin' && role === 'admin') {
    res.status(403).json({ error: 'Only the owner can invite admins' })
    return
  }

  const normalized = email.toLowerCase().trim()
  const existingMember = db
    .prepare(`
      SELECT u.id FROM users u
      JOIN agency_members m ON m.user_id = u.id
      WHERE u.email = ? AND m.agency_id = ?
    `)
    .get(normalized, req.agency!.id)
  if (existingMember) {
    res.status(409).json({ error: 'This user is already a team member' })
    return
  }

  const token = uuid()
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const id = uuid()

  db.prepare(`
    DELETE FROM agency_invites WHERE agency_id = ? AND email = ?
  `).run(req.agency!.id, normalized)

  db.prepare(`
    INSERT INTO agency_invites (id, agency_id, email, role, token, expires_at, invited_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.agency!.id, normalized, role, token, expires, req.user!.id)

  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
  res.status(201).json({
    message: 'Invite created',
    invite: {
      id,
      email: normalized,
      role,
      expiresAt: expires,
      acceptUrl: `${clientUrl}/accept-invite?token=${token}`,
    },
  })
})

agenciesRouter.get('/invites', (req: AgencyRequest, res) => {
  if (!canInvite(req.agency!.role)) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return
  }

  const rows = db
    .prepare(`
      SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.full_name AS invited_by_name
      FROM agency_invites i
      JOIN users u ON u.id = i.invited_by
      WHERE i.agency_id = ?
      ORDER BY i.created_at DESC
    `)
    .all(req.agency!.id) as Record<string, unknown>[]

  res.json({
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      invitedByName: r.invited_by_name,
    })),
  })
})

agenciesRouter.delete('/invites/:id', (req: AgencyRequest, res) => {
  if (!canInvite(req.agency!.role)) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return
  }

  db.prepare('DELETE FROM agency_invites WHERE id = ? AND agency_id = ?').run(req.params.id, req.agency!.id)
  res.json({ message: 'Invite revoked' })
})

agenciesRouter.patch('/members/:userId', (req: AgencyRequest, res) => {
  if (!canManageTeam(req.agency!.role)) {
    res.status(403).json({ error: 'Only the owner can change member roles' })
    return
  }

  const { role } = req.body ?? {}
  if (!role || !['admin', 'staff'].includes(role)) {
    res.status(400).json({ error: 'Role must be admin or staff' })
    return
  }

  const member = db
    .prepare('SELECT role FROM agency_members WHERE agency_id = ? AND user_id = ?')
    .get(req.agency!.id, req.params.userId) as { role: AgencyRole } | undefined

  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  if (member.role === 'owner') {
    res.status(400).json({ error: 'Cannot change owner role' })
    return
  }
  if (req.params.userId === req.user!.id) {
    res.status(400).json({ error: 'Cannot change your own role' })
    return
  }

  db.prepare('UPDATE agency_members SET role = ? WHERE agency_id = ? AND user_id = ?').run(
    role,
    req.agency!.id,
    req.params.userId,
  )

  res.json({ message: 'Role updated' })
})

agenciesRouter.delete('/members/:userId', (req: AgencyRequest, res) => {
  const targetId = req.params.userId

  if (targetId === req.user!.id) {
    res.status(400).json({ error: 'Use leave endpoint to remove yourself' })
    return
  }

  const member = db
    .prepare('SELECT role FROM agency_members WHERE agency_id = ? AND user_id = ?')
    .get(req.agency!.id, targetId) as { role: AgencyRole } | undefined

  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  if (member.role === 'owner') {
    res.status(400).json({ error: 'Cannot remove the agency owner' })
    return
  }

  if (member.role === 'admin' && req.agency!.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can remove admins' })
    return
  }

  if (member.role === 'staff' && !canInvite(req.agency!.role)) {
    res.status(403).json({ error: 'Insufficient permissions' })
    return
  }

  db.prepare('DELETE FROM agency_members WHERE agency_id = ? AND user_id = ?').run(req.agency!.id, targetId)
  res.json({ message: 'Member removed' })
})

agenciesRouter.post('/leave', (req: AgencyRequest, res) => {
  if (req.agency!.role === 'owner') {
    res.status(400).json({ error: 'Owner cannot leave — transfer ownership or delete agency first' })
    return
  }

  db.prepare('DELETE FROM agency_members WHERE agency_id = ? AND user_id = ?').run(req.agency!.id, req.user!.id)
  res.json(buildSessionPayload(req.user!.id))
})
