import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import { enqueueDirectJob } from '../services/jobWorker.js'
import { bulkDeletePosts, listPagePosts } from '../services/publisher.js'
import { isFacebookConfiguredForAgency } from '../services/byoc.js'
import { purgeQueuedJobsForPage } from '../services/queueActions.js'
import { tickPrefillQueue, tickPrefillQueueForPage } from '../services/prefillScheduler.js'
import { markSourceScrapingPending, reactivateSourceForRescrape } from '../services/scrapeStatus.js'
import { probeSourceCatalog } from '../services/reelDiscovery.js'
import type { AgencyRequest } from '../utils/agency.js'

export const automationRouter = Router()
automationRouter.use(authMiddleware, requireVerified, agencyMiddleware)

automationRouter.get('/assignments', (req: AgencyRequest, res) => {
  const rows = db.prepare(`
    SELECT a.page_id, a.source_account_id, p.name AS page_name, s.username AS source_username, s.platform
    FROM page_source_assignments a
    JOIN facebook_pages p ON p.id = a.page_id
    JOIN source_accounts s ON s.id = a.source_account_id
    WHERE a.agency_id = ?
  `).all(req.agency!.id) as Record<string, unknown>[]

  res.json({
    assignments: rows.map((r) => ({
      pageId: r.page_id,
      sourceId: r.source_account_id,
      pageName: r.page_name,
      sourceUsername: r.source_username,
      platform: r.platform,
    })),
  })
})

automationRouter.put('/assignments/:pageId', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const { sourceId } = req.body ?? {}
  if (!sourceId || typeof sourceId !== 'string') {
    res.status(400).json({ error: 'sourceId is required' })
    return
  }
  const page = db
    .prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(req.params.pageId, req.agency!.id)
  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  const source = db
    .prepare('SELECT id FROM source_accounts WHERE id = ? AND agency_id = ?')
    .get(sourceId, req.agency!.id)
  if (!source) {
    res.status(404).json({ error: 'Source not found' })
    return
  }

  const previous = db
    .prepare('SELECT source_account_id FROM page_source_assignments WHERE page_id = ? AND agency_id = ?')
    .get(req.params.pageId, req.agency!.id) as { source_account_id: string } | undefined

  db.prepare(`
    INSERT INTO page_source_assignments (page_id, source_account_id, user_id, agency_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET source_account_id = excluded.source_account_id, agency_id = excluded.agency_id
  `).run(req.params.pageId, sourceId, req.user!.id, req.agency!.id)

  if (previous && previous.source_account_id === sourceId) {
    const pageHealth = db
      .prepare('SELECT health_status FROM facebook_pages WHERE id = ?')
      .get(req.params.pageId) as { health_status: string } | undefined
    if (pageHealth?.health_status === 'source_exhausted') {
      reactivateSourceForRescrape(req.params.pageId)
      void tickPrefillQueue()
      res.json({ message: 'Source re-sync started — scraping creator again' })
      return
    }
  }

  if (!previous || previous.source_account_id !== sourceId) {
    await purgeQueuedJobsForPage(req.params.pageId, req.agency!.id)
    markSourceScrapingPending(req.params.pageId)
    db.prepare('UPDATE page_source_assignments SET catalog_total = NULL WHERE page_id = ?').run(req.params.pageId)
    void probeSourceCatalog(req.params.pageId).catch((err) =>
      console.warn('[catalog] probe failed:', err instanceof Error ? err.message : err),
    )
    tickPrefillQueueForPage(req.params.pageId, req.agency!.id)
  } else {
    void tickPrefillQueue()
  }

  res.json({ message: 'Source assigned to page' })
})

automationRouter.delete('/assignments/:pageId', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  db.prepare('DELETE FROM page_source_assignments WHERE page_id = ? AND agency_id = ?').run(
    req.params.pageId,
    req.agency!.id,
  )
  res.json({ message: 'Assignment removed' })
})

automationRouter.post('/direct-post', (req: AgencyRequest, res) => {
  const { pageId, sourceId } = req.body ?? {}
  if (!pageId) {
    res.status(400).json({ error: 'pageId is required' })
    return
  }

  try {
    const jobId = enqueueDirectJob(req.agency!.id, req.user!.id, pageId, sourceId)
    res.status(202).json({ message: 'Direct post queued', jobId })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to queue' })
  }
})

automationRouter.get('/posts/:pageId', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  try {
    const page = db
      .prepare('SELECT meta_page_id, page_access_token, facebook_account_id FROM facebook_pages WHERE id = ? AND agency_id = ?')
      .get(req.params.pageId, req.agency!.id) as Record<string, unknown> | undefined

    if (!page) {
      res.status(404).json({ error: 'Page not found' })
      return
    }

    const token = await resolvePageToken(page)
    if (!token && !isFacebookConfiguredForAgency(req.agency!.id)) {
      res.json({ posts: [], mockMode: true })
      return
    }

    const posts = await listPagePosts(page.meta_page_id as string, token!)
    res.json({ posts })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list posts' })
  }
})

automationRouter.post('/bulk-delete', requireRole('owner', 'admin'), async (req: AgencyRequest, res) => {
  const { pageId, postIds, deleteAll } = req.body ?? {}

  if (!pageId) {
    res.status(400).json({ error: 'pageId is required' })
    return
  }

  const page = db
    .prepare('SELECT meta_page_id, page_access_token, facebook_account_id FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(pageId, req.agency!.id) as Record<string, unknown> | undefined

  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  try {
    const token = await resolvePageToken(page)

    if (!token) {
      res.json({ deleted: postIds ?? [], failed: [], mockMode: true, message: 'Mock delete (no real token)' })
      return
    }

    if (deleteAll) {
      const result = await bulkDeletePosts(page.meta_page_id as string, token, 50)
      res.json(result)
      return
    }

    const deleted: string[] = []
    const failed: { id: string; error: string }[] = []

    for (const postId of (postIds as string[]) ?? []) {
      const delRes = await fetch(`https://graph.facebook.com/v21.0/${postId}?access_token=${token}`, { method: 'DELETE' })
      const del = (await delRes.json()) as { success?: boolean; error?: { message: string } }
      if (del.success) deleted.push(postId)
      else failed.push({ id: postId, error: del.error?.message ?? 'Failed' })
    }

    res.json({ deleted, failed })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bulk delete failed' })
  }
})

automationRouter.post('/ai-post', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { pageId, prompt, postType } = req.body ?? {}
  if (!pageId || !prompt) {
    res.status(400).json({ error: 'pageId and prompt are required' })
    return
  }

  const id = uuid()
  db.prepare(`
    INSERT INTO reel_jobs (id, user_id, agency_id, target_page_id, status, job_type, error_message)
    VALUES (?, ?, ?, ?, 'failed', 'direct', ?)
  `).run(id, req.user!.id, req.agency!.id, pageId, `AI ${postType ?? 'text'} post: ${prompt.slice(0, 200)} — requires AI integration`)

  res.status(501).json({
    message: 'AI post generation requires OpenAI/API key configuration',
    jobId: id,
  })
})

automationRouter.post('/payout', requireRole('owner', 'admin'), (req: AgencyRequest, res) => {
  const { pageId, amount, recipientId } = req.body ?? {}
  if (!pageId || !amount) {
    res.status(400).json({ error: 'pageId and amount are required' })
    return
  }
  res.status(501).json({
    message: 'Payout transfer requires Meta Monetization API access',
    request: { pageId, amount, recipientId },
  })
})

async function resolvePageToken(page: Record<string, unknown>): Promise<string | null> {
  if (page.page_access_token) return page.page_access_token as string

  if (page.facebook_account_id) {
    const account = db
      .prepare('SELECT access_token FROM facebook_accounts WHERE id = ?')
      .get(page.facebook_account_id as string) as { access_token: string } | undefined
    return account?.access_token ?? null
  }

  return null
}
