import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { db } from '../db.js'
import { authMiddleware, requireVerified } from '../middleware/auth.js'
import { agencyMiddleware, requireRole } from '../middleware/agency.js'
import type { AgencyRequest } from '../utils/agency.js'
import { composeTemplatePreview } from '../services/news/imageCompositor.js'
import { getAgencyAiSettingsPublic, saveAgencyAiSettings, type AiProvider } from '../services/news/aiSettings.js'
import { getCompositorQueueStats } from '../services/news/compositorQueue.js'
import { testNewsAiConnection } from '../services/news/aiRewriter.js'
import { pollFeedsForAgency, pollFeed, publishNewsItem, regenerateNewsItemImage, updateNewsItemContent, deleteNewsItem } from '../services/news/newsPipeline.js'
import { parseImageCrop } from '../services/news/types.js'
import { fetchRssFeed } from '../services/news/rssFetcher.js'
import { DEFAULT_COLORS, parseBrandType, parseJsonArray, resolveFonts, type NewsFonts } from '../services/news/types.js'
import { isMockMetaPageId } from '../services/facebook.js'
import { assertPublishableFacebookPage } from '../services/pageTokens.js'

import { routeParam } from '../utils/routeParam.js'
const newsLogosDir = path.join(process.cwd(), 'data', 'news-logos')

function ensureNewsLogosDir(agencyId: string) {
  const dir = path.join(newsLogosDir, agencyId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const newsRouter = Router()

newsRouter.use(authMiddleware, requireVerified, agencyMiddleware, requireRole('owner'))

function mapTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    layoutPreset: row.layout_preset,
    colors: JSON.parse(String(row.colors_json)),
    fonts: resolveFonts(JSON.parse(String(row.fonts_json)) as Partial<NewsFonts>),
    logoPath: row.logo_path ?? null,
    brandType: parseBrandType(row.brand_type as string | undefined),
    ctaText: row.cta_text ?? '',
    defaultHashtags: parseJsonArray(row.default_hashtags_json as string),
    aiTonePrompt: row.ai_tone_prompt ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapFeed(row: Record<string, unknown>, pageLookup?: Map<string, { name: string; isMockPage: boolean }>) {
  const pageId = row.page_id as string | null
  const pageInfo = pageId && pageLookup?.get(pageId)
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    pageId,
    pageName: pageInfo?.name ?? null,
    isMockPage: pageInfo?.isMockPage ?? false,
    templateId: row.template_id ?? null,
    isActive: !!row.is_active,
    lastPolledAt: row.last_polled_at ?? null,
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
  }
}

function mapItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    feedId: row.feed_id ?? null,
    pageId: row.page_id ?? null,
    templateId: row.template_id ?? null,
    articleUrl: row.article_url,
    headline: row.headline ?? null,
    postTitle: row.post_title ?? null,
    postDescription: row.post_description ?? null,
    hashtags: parseJsonArray(row.hashtags_json as string),
    heroImageUrl: row.hero_image_url ?? null,
    insetImageUrl: row.inset_image_url ?? null,
    accentWords: parseJsonArray(row.accent_words_json as string),
    imageCrop: parseImageCrop(row.image_crop_json as string | null),
    generatedImagePath: row.generated_image_path ?? null,
    fbPostId: row.fb_post_id ?? null,
    status: row.status,
    errorMessage: row.error_message ?? null,
    postedAt: row.posted_at ?? null,
    createdAt: row.created_at,
  }
}

newsRouter.get('/ai-settings', (req: AgencyRequest, res) => {
  res.json({ aiSettings: getAgencyAiSettingsPublic(req.agency!.id) })
})

newsRouter.put('/ai-settings', (req: AgencyRequest, res) => {
  const { provider, geminiApiKey, openaiApiKey } = req.body ?? {}
  const normalizedProvider: AiProvider | undefined =
    provider === 'gemini' || provider === 'openai' || provider === 'auto' ? provider : undefined

  const aiSettings = saveAgencyAiSettings(req.agency!.id, {
    provider: normalizedProvider,
    geminiApiKey: geminiApiKey === '' ? null : geminiApiKey,
    openaiApiKey: openaiApiKey === '' ? null : openaiApiKey,
  })
  res.json({ message: 'AI settings saved', aiSettings })
})

newsRouter.post('/ai-settings/test', async (req: AgencyRequest, res) => {
  try {
    const test = await testNewsAiConnection(req.agency!.id)
    res.json(test)
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'AI test failed', results: [] })
  }
})

newsRouter.get('/overview', (req: AgencyRequest, res) => {
  const agencyId = req.agency!.id

  const templates = (
    db.prepare('SELECT * FROM news_templates WHERE agency_id = ? ORDER BY name').all(agencyId) as Record<string, unknown>[]
  ).map(mapTemplate)

  const pages = db
    .prepare(`
      SELECT fp.id, fp.name, fp.meta_page_id, pns.template_id, pns.auto_publish, pns.posts_per_day,
             pns.schedule_times, pns.timezone, pns.comment_link_enabled, pns.ai_rewrite_enabled,
             pns.default_hashtags_json, pns.is_active AS news_active, pns.schedule_offset_minutes,
             pns.include_link_in_caption
      FROM facebook_pages fp
      LEFT JOIN page_news_settings pns ON pns.page_id = fp.id
      WHERE fp.agency_id = ? AND fp.status = 'active'
      ORDER BY fp.name
    `)
    .all(agencyId) as Record<string, unknown>[]

  const pageLookup = new Map(
    pages.map((p) => [
      String(p.id),
      { name: String(p.name), isMockPage: isMockMetaPageId(String(p.meta_page_id)) },
    ]),
  )

  const feeds = (
    db.prepare('SELECT * FROM rss_feeds WHERE agency_id = ? ORDER BY created_at DESC').all(agencyId) as Record<
      string,
      unknown
    >[]
  ).map((row) => mapFeed(row, pageLookup))

  const items = (
    db
      .prepare('SELECT * FROM news_items WHERE agency_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(agencyId) as Record<string, unknown>[]
  ).map(mapItem)

  const statsRow = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
        COALESCE(SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END), 0) AS posted,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
      FROM news_items WHERE agency_id = ?
    `)
    .get(agencyId) as { ready: number; posted: number; failed: number } | undefined

  res.json({
    templates,
    feeds,
    aiSettings: getAgencyAiSettingsPublic(agencyId),
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      metaPageId: p.meta_page_id,
      isMockPage: isMockMetaPageId(String(p.meta_page_id)),
      newsActive: !!p.news_active,
      templateId: p.template_id ?? null,
      autoPublish: p.auto_publish == null ? true : !!p.auto_publish,
      postsPerDay: Number(p.posts_per_day ?? 4),
      scheduleTimes: parseJsonArray(p.schedule_times as string, ['07:30', '10:00', '13:00', '16:00']),
      timezone: p.timezone ?? 'America/New_York',
      commentLinkEnabled: !!p.comment_link_enabled,
      includeLinkInCaption: !!p.include_link_in_caption,
      aiRewriteEnabled: !!p.ai_rewrite_enabled,
      defaultHashtags: parseJsonArray(p.default_hashtags_json as string),
      scheduleOffsetMinutes: Number(p.schedule_offset_minutes ?? 0),
    })),
    items,
    stats: {
      ready: Number(statsRow?.ready ?? 0),
      posted: Number(statsRow?.posted ?? 0),
      failed: Number(statsRow?.failed ?? 0),
    },
  })
})

newsRouter.post('/templates/preview', async (req: AgencyRequest, res) => {
  const { colors, fonts, ctaText, headline, pageId, pageName } = req.body ?? {}
  try {
    let resolvedPageName = pageName?.trim() || null
    if (!resolvedPageName && pageId) {
      const page = db
        .prepare('SELECT name FROM facebook_pages WHERE id = ? AND agency_id = ?')
        .get(pageId, req.agency!.id) as { name: string } | undefined
      resolvedPageName = page?.name ?? null
    }

    const png = await composeTemplatePreview({
      colorsJson: JSON.stringify({ ...DEFAULT_COLORS, ...(colors ?? {}) }),
      fontsJson: fonts ? JSON.stringify(resolveFonts(fonts)) : null,
      ctaText: ctaText ?? '',
      headline: headline?.trim() || undefined,
      logoPath: null,
      brandType: 'page_name',
      pageName: resolvedPageName,
    })
    res.type('png').send(png)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' })
  }
})

newsRouter.post('/templates/logo', (req: AgencyRequest, res) => {
  const { dataUrl, fileName } = req.body ?? {}
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'dataUrl must be a base64 image data URL' })
    return
  }

  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) {
    res.status(400).json({ error: 'Invalid image data URL' })
    return
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]!
  const buffer = Buffer.from(match[2]!, 'base64')
  if (buffer.length > 5 * 1024 * 1024) {
    res.status(400).json({ error: 'Logo must be under 5MB' })
    return
  }

  const dir = ensureNewsLogosDir(req.agency!.id)
  const safeName = String(fileName ?? 'logo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80)
  const logoPath = path.join(dir, `${uuid()}-${safeName || 'logo'}.${ext}`)
  fs.writeFileSync(logoPath, buffer)
  res.json({ logoPath })
})

newsRouter.post('/templates/:id/duplicate', (req: AgencyRequest, res) => {
  const row = db
    .prepare('SELECT * FROM news_templates WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  const { name } = req.body ?? {}
  const id = uuid()
  db.prepare(`
    INSERT INTO news_templates (
      id, agency_id, name, layout_preset, colors_json, fonts_json, logo_path,
      cta_text, default_hashtags_json, ai_tone_prompt, brand_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.agency!.id,
    String(name ?? `${row.name} Copy`).trim(),
    row.layout_preset,
    row.colors_json,
    row.fonts_json,
    row.logo_path,
    row.cta_text,
    row.default_hashtags_json,
    row.ai_tone_prompt,
    row.brand_type ?? 'page_name',
  )

  const created = db.prepare('SELECT * FROM news_templates WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ template: mapTemplate(created) })
})

newsRouter.post('/bulk-setup', (req: AgencyRequest, res) => {
  const {
    pageIds,
    templateId,
    copyFromPageId,
    autoPublish,
    postsPerDay,
    scheduleTimes,
    timezone,
    scheduleOffsetMinutes,
    commentLinkEnabled,
    includeLinkInCaption,
    aiRewriteEnabled,
    defaultHashtags,
    rssFeedUrl,
    rssFeedName,
  } = req.body ?? {}

  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    res.status(400).json({ error: 'pageIds array is required' })
    return
  }

  const agencyId = req.agency!.id
  let sourceSettings: Record<string, unknown> | undefined
  if (copyFromPageId) {
    sourceSettings = db
      .prepare('SELECT * FROM page_news_settings WHERE page_id = ? AND agency_id = ?')
      .get(copyFromPageId, agencyId) as Record<string, unknown> | undefined
  }

  let updated = 0
  for (let i = 0; i < pageIds.length; i++) {
    const pageId = String(pageIds[i])
    const page = db.prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?').get(pageId, agencyId)
    if (!page) continue

    const offset = scheduleOffsetMinutes ?? (sourceSettings?.schedule_offset_minutes as number) ?? i * 5
    const resolvedTemplateId =
      templateId ?? (sourceSettings?.template_id as string) ?? null

    db.prepare(`
      INSERT INTO page_news_settings (
        page_id, agency_id, template_id, auto_publish, posts_per_day, schedule_times, timezone,
        comment_link_enabled, include_link_in_caption, ai_rewrite_enabled, default_hashtags_json,
        schedule_offset_minutes, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(page_id) DO UPDATE SET
        template_id = COALESCE(excluded.template_id, page_news_settings.template_id),
        auto_publish = excluded.auto_publish,
        posts_per_day = excluded.posts_per_day,
        schedule_times = excluded.schedule_times,
        timezone = excluded.timezone,
        comment_link_enabled = excluded.comment_link_enabled,
        include_link_in_caption = excluded.include_link_in_caption,
        ai_rewrite_enabled = excluded.ai_rewrite_enabled,
        default_hashtags_json = excluded.default_hashtags_json,
        schedule_offset_minutes = excluded.schedule_offset_minutes,
        is_active = 1,
        updated_at = datetime('now')
    `).run(
      pageId,
      agencyId,
      resolvedTemplateId,
      autoPublish !== undefined ? (autoPublish ? 1 : 0) : (sourceSettings?.auto_publish ?? 1),
      postsPerDay ?? sourceSettings?.posts_per_day ?? 4,
      scheduleTimes
        ? JSON.stringify(scheduleTimes)
        : (sourceSettings?.schedule_times ?? JSON.stringify(['07:30', '10:00', '13:00', '16:00'])),
      timezone ?? sourceSettings?.timezone ?? 'America/New_York',
      commentLinkEnabled !== undefined ? (commentLinkEnabled ? 1 : 0) : (sourceSettings?.comment_link_enabled ?? 0),
      includeLinkInCaption !== undefined
        ? (includeLinkInCaption ? 1 : 0)
        : (sourceSettings?.include_link_in_caption ?? 0),
      aiRewriteEnabled !== undefined ? (aiRewriteEnabled ? 1 : 0) : (sourceSettings?.ai_rewrite_enabled ?? 0),
      defaultHashtags
        ? JSON.stringify(defaultHashtags)
        : (sourceSettings?.default_hashtags_json ?? '[]'),
      offset,
    )

    if (copyFromPageId && !rssFeedUrl) {
      const sourceFeeds = db
        .prepare('SELECT name, url, template_id FROM rss_feeds WHERE page_id = ? AND agency_id = ? AND is_active = 1')
        .all(copyFromPageId, agencyId) as { name: string; url: string; template_id: string | null }[]
      for (const sf of sourceFeeds) {
        db.prepare(`
          INSERT INTO rss_feeds (id, agency_id, page_id, name, url, template_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(uuid(), agencyId, pageId, sf.name, sf.url, sf.template_id ?? resolvedTemplateId)
      }
    } else if (rssFeedUrl?.trim()) {
      db.prepare(`
        INSERT INTO rss_feeds (id, agency_id, page_id, name, url, template_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        uuid(),
        agencyId,
        pageId,
        String(rssFeedName ?? 'RSS Feed').trim(),
        String(rssFeedUrl).trim(),
        resolvedTemplateId,
      )
    }

    updated++
  }

  res.json({ message: `Configured ${updated} page(s)`, updated })
})

newsRouter.get('/queue-stats', (_req: AgencyRequest, res) => {
  res.json(getCompositorQueueStats())
})

newsRouter.post('/templates', (req: AgencyRequest, res) => {
  const { name, colors, fonts, logoPath, ctaText, defaultHashtags, brandType, layoutPreset, aiTonePrompt } = req.body ?? {}
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const id = uuid()
  db.prepare(`
    INSERT INTO news_templates (id, agency_id, name, layout_preset, colors_json, fonts_json, logo_path, cta_text, default_hashtags_json, brand_type, ai_tone_prompt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.agency!.id,
    String(name).trim(),
    layoutPreset ?? 'popcorn',
    JSON.stringify(colors ?? DEFAULT_COLORS),
    JSON.stringify(resolveFonts(fonts)),
    logoPath ?? null,
    ctaText ?? '',
    JSON.stringify(defaultHashtags ?? []),
    parseBrandType(brandType),
    aiTonePrompt ?? '',
  )

  const row = db.prepare('SELECT * FROM news_templates WHERE id = ?').get(id) as Record<string, unknown>
  res.status(201).json({ template: mapTemplate(row) })
})

newsRouter.patch('/templates/:id', (req: AgencyRequest, res) => {
  const row = db
    .prepare('SELECT * FROM news_templates WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  const { name, colors, fonts, logoPath, ctaText, defaultHashtags, brandType, layoutPreset, aiTonePrompt } = req.body ?? {}
  db.prepare(`
    UPDATE news_templates SET
      name = COALESCE(?, name),
      layout_preset = COALESCE(?, layout_preset),
      colors_json = COALESCE(?, colors_json),
      fonts_json = COALESCE(?, fonts_json),
      logo_path = COALESCE(?, logo_path),
      cta_text = COALESCE(?, cta_text),
      default_hashtags_json = COALESCE(?, default_hashtags_json),
      brand_type = COALESCE(?, brand_type),
      ai_tone_prompt = COALESCE(?, ai_tone_prompt),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name?.trim() ?? null,
    layoutPreset ?? null,
    colors ? JSON.stringify(colors) : null,
    fonts ? JSON.stringify(resolveFonts(fonts)) : null,
    logoPath ?? null,
    ctaText ?? null,
    defaultHashtags ? JSON.stringify(defaultHashtags) : null,
    brandType ? parseBrandType(brandType) : null,
    aiTonePrompt ?? null,
    routeParam(req.params.id),
  )

  const updated = db.prepare('SELECT * FROM news_templates WHERE id = ?').get(routeParam(req.params.id)) as Record<string, unknown>
  res.json({ template: mapTemplate(updated) })
})

newsRouter.post('/feeds', (req: AgencyRequest, res) => {
  const { name, url, pageId, templateId } = req.body ?? {}
  if (!name?.trim() || !url?.trim() || !pageId) {
    res.status(400).json({ error: 'name, url, and pageId are required' })
    return
  }

  const page = db
    .prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(pageId, req.agency!.id)
  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  try {
    assertPublishableFacebookPage(String(pageId), req.agency!.id)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid page' })
    return
  }

  const id = uuid()
  db.prepare(`
    INSERT INTO rss_feeds (id, agency_id, page_id, name, url, template_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.agency!.id, pageId, String(name).trim(), String(url).trim(), templateId ?? null)

  db.prepare(`
    INSERT INTO page_news_settings (page_id, agency_id, template_id, is_active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(page_id) DO UPDATE SET template_id = COALESCE(excluded.template_id, page_news_settings.template_id), is_active = 1, updated_at = datetime('now')
  `).run(pageId, req.agency!.id, templateId ?? null)

  const row = db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(id) as Record<string, unknown>
  const pageRow = db
    .prepare('SELECT name, meta_page_id FROM facebook_pages WHERE id = ?')
    .get(pageId) as { name: string; meta_page_id: string } | undefined
  const pageLookup = new Map([
    [
      String(pageId),
      {
        name: String(pageRow?.name ?? ''),
        isMockPage: isMockMetaPageId(String(pageRow?.meta_page_id ?? '')),
      },
    ],
  ])
  res.status(201).json({ feed: mapFeed(row, pageLookup) })
})

newsRouter.patch('/feeds/:id', (req: AgencyRequest, res) => {
  const { pageId } = req.body ?? {}
  if (!pageId) {
    res.status(400).json({ error: 'pageId is required' })
    return
  }

  const feed = db
    .prepare('SELECT * FROM rss_feeds WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id) as Record<string, unknown> | undefined
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }

  const page = db
    .prepare('SELECT id, name, meta_page_id FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(pageId, req.agency!.id)
  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  try {
    assertPublishableFacebookPage(String(pageId), req.agency!.id)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid page' })
    return
  }

  db.prepare('UPDATE rss_feeds SET page_id = ? WHERE id = ?').run(pageId, routeParam(req.params.id))
  db.prepare(`
    UPDATE news_items SET page_id = ? WHERE feed_id = ? AND agency_id = ? AND status = 'ready'
  `).run(pageId, routeParam(req.params.id), req.agency!.id)

  const row = db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(routeParam(req.params.id)) as Record<string, unknown>
  const pageRow = db
    .prepare('SELECT name, meta_page_id FROM facebook_pages WHERE id = ?')
    .get(pageId) as { name: string; meta_page_id: string } | undefined
  const pageLookup = new Map([
    [
      String(pageId),
      {
        name: String(pageRow?.name ?? ''),
        isMockPage: isMockMetaPageId(String(pageRow?.meta_page_id ?? '')),
      },
    ],
  ])
  res.json({ feed: mapFeed(row, pageLookup) })
})

newsRouter.delete('/feeds/:id', (req: AgencyRequest, res) => {
  const result = db
    .prepare('DELETE FROM rss_feeds WHERE id = ? AND agency_id = ?')
    .run(routeParam(req.params.id), req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }
  res.json({ message: 'Feed deleted' })
})

newsRouter.put('/page-settings/:pageId', (req: AgencyRequest, res) => {
  const page = db
    .prepare('SELECT id FROM facebook_pages WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.pageId), req.agency!.id)
  if (!page) {
    res.status(404).json({ error: 'Page not found' })
    return
  }

  const existing = db.prepare('SELECT * FROM page_news_settings WHERE page_id = ?').get(routeParam(req.params.pageId)) as
    | Record<string, unknown>
    | undefined

  const body = req.body ?? {}
  const merged = {
    templateId: body.templateId !== undefined ? body.templateId : (existing?.template_id ?? null),
    autoPublish: body.autoPublish !== undefined ? (body.autoPublish ? 1 : 0) : (existing?.auto_publish ?? 1),
    postsPerDay: body.postsPerDay ?? existing?.posts_per_day ?? 4,
    scheduleTimes: body.scheduleTimes
      ? JSON.stringify(body.scheduleTimes)
      : (existing?.schedule_times ?? JSON.stringify(['07:30', '10:00', '13:00', '16:00'])),
    timezone: body.timezone ?? existing?.timezone ?? 'America/New_York',
    commentLinkEnabled:
      body.commentLinkEnabled !== undefined ? (body.commentLinkEnabled ? 1 : 0) : (existing?.comment_link_enabled ?? 0),
    includeLinkInCaption:
      body.includeLinkInCaption !== undefined ? (body.includeLinkInCaption ? 1 : 0) : (existing?.include_link_in_caption ?? 0),
    aiRewriteEnabled:
      body.aiRewriteEnabled !== undefined ? (body.aiRewriteEnabled ? 1 : 0) : (existing?.ai_rewrite_enabled ?? 0),
    defaultHashtagsJson: body.defaultHashtags
      ? JSON.stringify(body.defaultHashtags)
      : (existing?.default_hashtags_json ?? '[]'),
    scheduleOffsetMinutes: body.scheduleOffsetMinutes ?? existing?.schedule_offset_minutes ?? 0,
    isActive: body.isActive !== undefined ? (body.isActive ? 1 : 0) : (existing?.is_active ?? 1),
  }

  db.prepare(`
    INSERT INTO page_news_settings (
      page_id, agency_id, template_id, auto_publish, posts_per_day, schedule_times, timezone,
      comment_link_enabled, include_link_in_caption, ai_rewrite_enabled, default_hashtags_json,
      schedule_offset_minutes, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(page_id) DO UPDATE SET
      template_id = excluded.template_id,
      auto_publish = excluded.auto_publish,
      posts_per_day = excluded.posts_per_day,
      schedule_times = excluded.schedule_times,
      timezone = excluded.timezone,
      comment_link_enabled = excluded.comment_link_enabled,
      include_link_in_caption = excluded.include_link_in_caption,
      ai_rewrite_enabled = excluded.ai_rewrite_enabled,
      default_hashtags_json = excluded.default_hashtags_json,
      schedule_offset_minutes = excluded.schedule_offset_minutes,
      is_active = excluded.is_active,
      updated_at = datetime('now')
  `).run(
    routeParam(req.params.pageId),
    req.agency!.id,
    merged.templateId,
    merged.autoPublish,
    merged.postsPerDay,
    merged.scheduleTimes,
    merged.timezone,
    merged.commentLinkEnabled,
    merged.includeLinkInCaption,
    merged.aiRewriteEnabled,
    merged.defaultHashtagsJson,
    merged.scheduleOffsetMinutes,
    merged.isActive,
  )

  res.json({ message: 'Page news settings saved' })
})

newsRouter.post('/poll', async (req: AgencyRequest, res) => {
  try {
    const result = await pollFeedsForAgency(req.agency!.id)
    res.json({ message: `Polled ${result.feeds} feeds`, ...result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Poll failed' })
  }
})

newsRouter.post('/feeds/:id/poll', async (req: AgencyRequest, res) => {
  const feed = db
    .prepare('SELECT id FROM rss_feeds WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)
  if (!feed) {
    res.status(404).json({ error: 'Feed not found' })
    return
  }
  try {
    const created = await pollFeed(routeParam(req.params.id))
    res.json({ message: `Created ${created} items`, created })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Poll failed' })
  }
})

newsRouter.patch('/items/:id', async (req: AgencyRequest, res) => {
  const item = db
    .prepare('SELECT id FROM news_items WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)
  if (!item) {
    res.status(404).json({ error: 'Item not found' })
    return
  }

  const {
    headline,
    postTitle,
    postDescription,
    accentWords,
    heroImageUrl,
    insetImageUrl,
    heroImageDataUrl,
    insetImageDataUrl,
    imageCrop,
  } = req.body ?? {}

  try {
    await updateNewsItemContent(routeParam(req.params.id), req.agency!.id, {
      headline,
      postTitle,
      postDescription,
      accentWords: Array.isArray(accentWords) ? accentWords.map(String) : undefined,
      heroImageUrl,
      insetImageUrl,
      heroImageDataUrl,
      insetImageDataUrl,
      imageCrop: imageCrop && typeof imageCrop === 'object' ? imageCrop : undefined,
    })
    const updated = db
      .prepare('SELECT * FROM news_items WHERE id = ?')
      .get(routeParam(req.params.id)) as Record<string, unknown>
    res.json({ message: 'Item updated and image regenerated', item: mapItem(updated) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed' })
  }
})

newsRouter.delete('/items/:id', (req: AgencyRequest, res) => {
  try {
    deleteNewsItem(routeParam(req.params.id), req.agency!.id)
    res.json({ message: 'Queue item deleted' })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
})

newsRouter.post('/items/:id/regenerate-image', async (req: AgencyRequest, res) => {
  const item = db
    .prepare('SELECT id FROM news_items WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)
  if (!item) {
    res.status(404).json({ error: 'Item not found' })
    return
  }
  try {
    await regenerateNewsItemImage(routeParam(req.params.id), req.agency!.id)
    const updated = db
      .prepare('SELECT * FROM news_items WHERE id = ?')
      .get(routeParam(req.params.id)) as Record<string, unknown>
    res.json({ message: 'Image regenerated', item: mapItem(updated) })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Regenerate failed' })
  }
})

newsRouter.post('/items/:id/publish', async (req: AgencyRequest, res) => {
  const item = db
    .prepare('SELECT id FROM news_items WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id)
  if (!item) {
    res.status(404).json({ error: 'Item not found' })
    return
  }
  try {
    const result = await publishNewsItem(routeParam(req.params.id))
    res.json({ message: 'Published', ...result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Publish failed' })
  }
})

newsRouter.post('/items/:id/skip', (req: AgencyRequest, res) => {
  const result = db
    .prepare(`UPDATE news_items SET status = 'skipped' WHERE id = ? AND agency_id = ? AND status = 'ready'`)
    .run(routeParam(req.params.id), req.agency!.id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Item not found or not skippable' })
    return
  }
  res.json({ message: 'Item skipped' })
})

newsRouter.get('/items/:id/preview', (req: AgencyRequest, res) => {
  const item = db
    .prepare('SELECT generated_image_path FROM news_items WHERE id = ? AND agency_id = ?')
    .get(routeParam(req.params.id), req.agency!.id) as { generated_image_path: string | null } | undefined
  if (!item?.generated_image_path || !fs.existsSync(item.generated_image_path)) {
    res.status(404).json({ error: 'Preview not found' })
    return
  }
  res.sendFile(path.resolve(item.generated_image_path))
})

newsRouter.post('/test-fetch', async (req: AgencyRequest, res) => {
  const { url } = req.body ?? {}
  if (!url?.trim()) {
    res.status(400).json({ error: 'url is required' })
    return
  }
  try {
    const articles = await fetchRssFeed(String(url).trim())
    res.json({ count: articles.length, articles: articles.slice(0, 5) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Fetch failed' })
  }
})
