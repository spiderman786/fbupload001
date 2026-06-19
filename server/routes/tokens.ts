import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { TOKEN_COST_PKR } from '../utils/helpers.js'
import type { AgencyRequest } from '../utils/agency.js'

export const tokensRouter = Router()
tokensRouter.use(authMiddleware, requireVerified, agencyMiddleware)

tokensRouter.get('/balance', (req: AgencyRequest, res) => {
  const agency = db.prepare('SELECT token_balance FROM agencies WHERE id = ?').get(req.agency!.id) as {
    token_balance: number
  }
  res.json({ balance: agency.token_balance, costPerToken: TOKEN_COST_PKR })
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
  const totalPkr = amount * TOKEN_COST_PKR
  const whatsapp = process.env.WHATSAPP_NUMBER ?? '923278644204'
  const message = encodeURIComponent(
    `Hi, I'd like to purchase ${amount} tokens (Rs ${totalPkr}) for agency "${req.agency!.name}" (${user.email}). ${note ?? ''}`,
  )

  res.json({
    message: 'Token purchase request created. Contact support via WhatsApp to complete payment.',
    whatsappUrl: `https://wa.me/${whatsapp}?text=${message}`,
    amount,
    totalPkr,
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
