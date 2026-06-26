import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import type { AgencyRequest } from '../utils/agency.js'
import { DEFAULT_SCHEDULE_TIMEZONE, getCurrentTimeHHMM } from '../utils/timezone.js'
import { USA_ENGAGEMENT_PRESETS, getEngagementLabel, getEngagementPreset } from '../config/usaEngagementTimes.js'

import { routeParam } from '../utils/routeParam.js'
export const scheduleRouter = Router()
scheduleRouter.use(authMiddleware, requireVerified, agencyMiddleware)

function mapSlot(row: Record<string, unknown>, pageIds: string[]) {
  const time = row.time as string
  return {
    id: row.id,
    time,
    timezone: (row.timezone as string) ?? DEFAULT_SCHEDULE_TIMEZONE,
    engagementLabel: getEngagementLabel(time),
    status: row.status,
    publishMode: row.publish_mode ?? 'direct',
    pageIds,
    pageCount: pageIds.length,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  }
}

scheduleRouter.get('/presets', (_req, res) => {
  res.json({
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    currentTime: getCurrentTimeHHMM(DEFAULT_SCHEDULE_TIMEZONE),
    presets: USA_ENGAGEMENT_PRESETS,
  })
})

scheduleRouter.get('/', (req: AgencyRequest, res) => {
  const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined
  let query = 'SELECT * FROM schedule_slots WHERE agency_id = ?'
  const params: unknown[] = [req.agency!.id]
  if (mode) {
    query += ' AND publish_mode = ?'
    params.push(mode)
  }
  query += ' ORDER BY time ASC'

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]

  res.json({
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    currentTime: getCurrentTimeHHMM(DEFAULT_SCHEDULE_TIMEZONE),
    slots: rows.map((row) => mapSlot(row, getSlotPageIds(row.id as string))),
  })
})

scheduleRouter.post('/apply-preset', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { presetId, publishMode, pageIds, replace = true } = req.body ?? {}

  const preset = getEngagementPreset(presetId)
  if (!preset) {
    res.status(400).json({ error: 'Unknown preset' })
    return
  }

  const mode = publishMode === 'inapp' ? 'inapp' : 'direct'
  const validPageIds = ((pageIds ?? []) as string[]).filter((pageId) =>
    Boolean(
      db.prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?').get(pageId, req.agency!.id),
    ),
  )

  const created = db.transaction(() => {
    if (replace) {
      const existing = db
        .prepare('SELECT id FROM schedule_slots WHERE agency_id = ? AND publish_mode = ?')
        .all(req.agency!.id, mode) as { id: string }[]
      for (const row of existing) {
        db.prepare('DELETE FROM schedule_slots WHERE id = ?').run(row.id)
      }
    }

    const insertSlot = db.prepare(
      'INSERT INTO schedule_slots (id, user_id, agency_id, time, publish_mode, timezone) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertPage = db.prepare('INSERT INTO schedule_slot_pages (slot_id, page_id) VALUES (?, ?)')
    const slots: ReturnType<typeof mapSlot>[] = []

    for (const slot of preset.slots) {
      const id = uuid()
      insertSlot.run(id, req.user!.id, req.agency!.id, slot.time, mode, preset.timezone)
      for (const pageId of validPageIds) {
        insertPage.run(id, pageId)
      }
      const row = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(id) as Record<string, unknown>
      slots.push(mapSlot(row, validPageIds))
    }

    return slots
  })()

  res.status(201).json({
    message: `Applied ${preset.name} (${created.length} slots, ${preset.timezoneLabel})`,
    preset: { id: preset.id, name: preset.name, reelsPerDay: preset.reelsPerDay },
    slots: created,
  })
})

scheduleRouter.post('/', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { time, pageIds, publishMode, timezone } = req.body ?? {}

  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    res.status(400).json({ error: 'Valid time (HH:MM) is required' })
    return
  }

  const mode = publishMode === 'inapp' ? 'inapp' : 'direct'
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : DEFAULT_SCHEDULE_TIMEZONE
  const id = uuid()
  db.prepare(
    'INSERT INTO schedule_slots (id, user_id, agency_id, time, publish_mode, timezone) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, req.user!.id, req.agency!.id, time, mode, tz)

  const validPageIds = (pageIds ?? []) as string[]
  const insertPage = db.prepare('INSERT INTO schedule_slot_pages (slot_id, page_id) VALUES (?, ?)')

  for (const pageId of validPageIds) {
    const page = db
      .prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?')
      .get(pageId, req.agency!.id)
    if (page) insertPage.run(id, pageId)
  }

  const slot = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ slot: mapSlot(slot, getSlotPageIds(id)) })
})

scheduleRouter.patch('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { time, pageIds, timezone } = req.body ?? {}
  const existing = db
    .prepare('SELECT * FROM schedule_slots WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)

  if (!existing) {
    res.status(404).json({ error: 'Schedule slot not found' })
    return
  }

  if (time) {
    db.prepare('UPDATE schedule_slots SET time = ? WHERE id = ?').run(time, routeParam(req.params.id))
  }

  if (timezone) {
    db.prepare('UPDATE schedule_slots SET timezone = ? WHERE id = ?').run(timezone, routeParam(req.params.id))
  }

  if (Array.isArray(pageIds)) {
    db.prepare('DELETE FROM schedule_slot_pages WHERE slot_id = ?').run(routeParam(req.params.id))
    const insertPage = db.prepare('INSERT INTO schedule_slot_pages (slot_id, page_id) VALUES (?, ?)')
    for (const pageId of pageIds) {
      const page = db
        .prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?')
        .get(pageId, req.agency!.id)
      if (page) insertPage.run(routeParam(req.params.id), pageId)
    }
  }

  const slot = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(routeParam(req.params.id)) as Record<string, unknown>
  res.json({ slot: mapSlot(slot, getSlotPageIds(routeParam(req.params.id))) })
})

scheduleRouter.delete('/:id', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const result = db
    .prepare('DELETE FROM schedule_slots WHERE id = ? AND agency_id = ?')
    .run(routeParam(req.params.id), req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Schedule slot not found' })
    return
  }
  res.json({ message: 'Schedule slot removed' })
})

function getSlotPageIds(slotId: string): string[] {
  const rows = db
    .prepare('SELECT page_id FROM schedule_slot_pages WHERE slot_id = ?')
    .all(slotId) as { page_id: string }[]
  return rows.map((r) => r.page_id)
}
