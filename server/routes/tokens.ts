import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { TOKEN_COST_PKR } from '../utils/helpers.js'
import type { AgencyRequest } from '../utils/agency.js'

export const tokensRouter = Router()
tokensRouter.use(authMiddleware, requireVerified, agencyMiddleware)

function getAgencyOwnerEmail(agencyId: string): string | null {
  const row = db
    .prepare(`
      SELECT u.email
      FROM users u
      JOIN agency_members m ON m.user_id = u.id
      WHERE m.agency_id = ? AND m.role = 'owner'
      LIMIT 1
    `)
    .get(agencyId) as { email: string } | undefined
  return row?.email ?? null
}

tokensRouter.get('/balance', (req: AgencyRequest, res) => {
  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(req.agency!.id) as {
    token_balance: number
  }
  const role = req.agency!.role
  res.json({
    balance: agency.token_balance,
    costPerToken: TOKEN_COST_PKR,
    canCredit: role === 'owner',
    canRequest: role === 'owner' || role === 'admin',
    ownerEmail: getAgencyOwnerEmail(req.agency!.id),
  })
})

tokensRouter.get('/', (req: AgencyRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM token_transactions WHERE agency_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.agency!.id) as Record<string, unknown>[]

  res.json({
    transactions: rows.map((t) => ({
      id: t.id,
      amount: t.amount,
      type: t.type,
      note: t.note,
      reelJobId: t.reel_job_id,
      createdAt: t.created_at,
    })),
  })
})

tokensRouter.post('/request', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { amount, note } = req.body ?? {}
  if (!amount || amount < 1) {
    res.status(400).json({ error: 'Amount must be at least 1' })
    return
  }

  const user = req.user!
  const role = req.agency!.role
  const ownerEmail = getAgencyOwnerEmail(req.agency!.id)
  const totalPkr = amount * TOKEN_COST_PKR
  const whatsapp = (req.agency?.whatsappNumber ?? process.env.WHATSAPP_NUMBER ?? '923080752936').replace(/\D+/g, '')

  const requestLine =
    role === 'admin'
      ? `Hi, I'm ${user.email} (agency admin). Requesting ${amount} tokens (Rs ${totalPkr}) for agency "${req.agency!.name}".${ownerEmail ? ` Agency owner: ${ownerEmail}.` : ''} Please approve this purchase.${note ? ` Note: ${note}` : ''}`
      : `Hi, I'd like to purchase ${amount} tokens (Rs ${totalPkr}) for agency "${req.agency!.name}" (${user.email}). ${note ?? ''}`

  const message = encodeURIComponent(requestLine.trim())

  res.json({
    message:
      role === 'admin'
        ? 'Token request ready. Send via WhatsApp — only the agency owner or platform support can credit tokens after payment.'
        : 'Token purchase request created. Contact support via WhatsApp to complete payment.',
    whatsappUrl: `https://wa.me/${whatsapp}?text=${message}`,
    amount,
    totalPkr,
    ownerEmail,
  })
})

tokensRouter.post('/credit', requireRole('owner'), (req: AgencyRequest, res) => {
  const { amount, note } = req.body ?? {}
  if (!amount || amount < 1) {
    res.status(400).json({ error: 'Amount must be at least 1' })
    return
  }

  const agencyId = req.agency!.id
  db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(amount, agencyId)
  db.prepare(`
    INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
    VALUES (?, ?, ?, ?, 'purchase', ?)
  `).run(uuid(), req.user!.id, agencyId, amount, note ?? 'Token top-up')

  const balance = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as {
    token_balance: number
  }
  res.json({ balance: balance.token_balance, message: 'Tokens credited' })
})

tokensRouter.post('/credit-member', requireRole('owner'), (req: AgencyRequest, res) => {
  const { amount, memberEmail, note } = req.body ?? {}
  if (!amount || amount < 1) {
    res.status(400).json({ error: 'Amount must be at least 1' })
    return
  }
  if (!memberEmail || typeof memberEmail !== 'string') {
    res.status(400).json({ error: 'Member email is required' })
    return
  }

  const agencyId = req.agency!.id
  const member = db
    .prepare(
      `
      SELECT u.id, u.email, u.full_name
      FROM users u
      JOIN agency_members am ON am.user_id = u.id
      WHERE am.agency_id = ? AND lower(u.email) = lower(?)
      LIMIT 1
    `,
    )
    .get(agencyId, memberEmail.trim()) as
    | { id: string; email: string; full_name: string }
    | undefined

  if (!member) {
    res.status(404).json({ error: 'Member not found in this agency' })
    return
  }

  db.prepare('UPDATE agencies SET token_balance = token_balance + ? WHERE id = ?').run(amount, agencyId)
  const actor = req.user!.email
  const details = note ? ` (${note})` : ''
  db.prepare(`
    INSERT INTO token_transactions (id, user_id, agency_id, amount, type, note)
    VALUES (?, ?, ?, ?, 'purchase', ?)
  `).run(uuid(), member.id, agencyId, amount, `Manual credit to ${member.email} by ${actor}${details}`)

  const balance = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(agencyId) as {
    token_balance: number
  }
  res.json({
    balance: balance.token_balance,
    message: `Credited ${amount} tokens to ${member.email}`,
    member: { id: member.id, email: member.email, fullName: member.full_name },
  })
})
