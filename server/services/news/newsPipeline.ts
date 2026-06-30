import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db } from '../../db.js'
import { publishPhotoPost, postComment } from '../publisher.js'
import { isOAuthTokenError, refreshPageAccessToken, resolvePageAccessToken, assertPublishableFacebookPage } from '../pageTokens.js'
import { adaptHeadlineForImageGraphic, maybeRewriteNewsContent } from './aiRewriter.js'
import { runCompositorJob } from './compositorQueue.js'
import { formatNewsContent, mergeHashtags, headlineToPostTitle, pickAccentWords } from './contentFormatter.js'
import { composeNewsImage, fitHeadlineToTemplate, normalizeHeadlineText, ensureSpacedHeadline, repairHeadlineSpacing } from './imageCompositor.js'
import { fetchRssFeed, scrapeArticleImages, selectBestHeroAndInset, hasDistinctInsetImage } from './rssFetcher.js'
import { normalizeArticleUrl, parseBrandType, parseJsonArray, parseImageCrop, type NewsImageCrop } from './types.js'
import { resolvePageProfilePictureBuffer } from '../pagePicture.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const newsImagesDir = path.join(__dirname, '..', '..', '..', 'data', 'news-images')

function isDuplicate(pageId: string, articleUrl: string): boolean {
  const row = db
    .prepare('SELECT id FROM posted_articles WHERE page_id = ? AND article_url = ? LIMIT 1')
    .get(pageId, articleUrl) as { id: string } | undefined
  return !!row
}

function isAlreadyQueued(pageId: string, articleUrl: string): boolean {
  const row = db
    .prepare(`
      SELECT id FROM news_items
      WHERE page_id = ? AND article_url = ? AND status IN ('ready', 'failed')
      LIMIT 1
    `)
    .get(pageId, articleUrl) as { id: string } | undefined
  return !!row
}

async function buildNewsContent(input: {
  agencyId: string
  rssTitle: string
  rssDescription: string
  defaultHashtags: string[]
  aiRewriteEnabled?: boolean
  aiTonePrompt?: string | null
  templateFontsJson?: string | null
  aiInstruction?: string | null
  forceCaptionRewrite?: boolean
}) {
  let content = formatNewsContent({
    rssTitle: input.rssTitle,
    rssDescription: input.rssDescription,
    defaultHashtags: input.defaultHashtags,
  })

  const imageHeadline = await adaptHeadlineForImageGraphic({
    agencyId: input.agencyId,
    rssTitle: input.rssTitle,
    rssDescription: input.rssDescription,
    aiTonePrompt: input.aiTonePrompt ?? undefined,
    aiInstruction: input.aiInstruction ?? undefined,
    fontsJson: input.templateFontsJson,
  })
  if (imageHeadline) {
    content = { ...content, headline: imageHeadline.headline, accent_words: imageHeadline.accent_words }
    if (!input.aiRewriteEnabled) {
      content.post_title = input.rssTitle.trim()
    }
  } else {
    content.headline = fitHeadlineToTemplate(
      repairHeadlineSpacing(content.headline, input.rssTitle),
      input.templateFontsJson,
    )
  }

  content.headline = fitHeadlineToTemplate(
    ensureSpacedHeadline(content.headline, input.rssTitle),
    input.templateFontsJson,
  )

  if (input.aiRewriteEnabled || input.forceCaptionRewrite) {
    const rewritten = await maybeRewriteNewsContent({
      agencyId: input.agencyId,
      rssTitle: input.rssTitle,
      rssDescription: input.rssDescription,
      aiTonePrompt: input.aiTonePrompt ?? undefined,
      aiInstruction: input.aiInstruction ?? undefined,
    })
    if (rewritten) {
      content = {
        ...content,
        headline: imageHeadline?.headline ?? rewritten.headline,
        accent_words: imageHeadline?.accent_words ?? rewritten.accent_words,
        post_title: rewritten.post_title,
        post_description: rewritten.post_description,
      }
    }
  }

  return content
}

async function composeItemImage(options: {
  agencyId: string
  pageId: string
  template: Record<string, unknown> | undefined
  heroUrl: string
  insetUrl?: string | null
  headline: string
  accentWords: string[]
  outputPath: string
  heroLocalPath?: string
  insetLocalPath?: string
  rssTitle?: string
  imageCrop?: NewsImageCrop | null
}) {
  const pageRow = db
    .prepare('SELECT name FROM facebook_pages WHERE id = ?')
    .get(options.pageId) as { name: string } | undefined

  const brandType = parseBrandType(options.template?.brand_type as string | undefined)
  const layoutPreset = (options.template?.layout_preset as string) ?? 'popcorn'
  const pagePictureBuf =
    brandType === 'page_picture' ? await resolvePageProfilePictureBuffer(options.pageId) : null

  await runCompositorJob(() =>
    composeNewsImage({
      heroUrl: options.heroUrl,
      insetUrl: options.insetUrl,
      headline: options.headline,
      accentWords: options.accentWords,
      colorsJson: (options.template?.colors_json as string) ?? null,
      fontsJson: (options.template?.fonts_json as string) ?? null,
      brandType,
      pageName: pageRow?.name ?? null,
      logoPath: (options.template?.logo_path as string) ?? null,
      pagePictureBuf,
      layoutPreset,
      ctaText: (options.template?.cta_text as string) ?? '',
      outputPath: options.outputPath,
      heroLocalPath: options.heroLocalPath,
      insetLocalPath: options.insetLocalPath,
      rssTitle: options.rssTitle,
      imageCrop: options.imageCrop,
    }),
  )
}

function heroImageKey(url: string): string {
  return url.split('?')[0]!.toLowerCase()
}

function getRecentHeroKeysForFeed(feedId: string, limit = 30): Set<string> {
  const rows = db
    .prepare(`
      SELECT hero_image_url FROM news_items
      WHERE feed_id = ? AND hero_image_url IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(feedId, limit) as { hero_image_url: string }[]
  return new Set(rows.map((r) => heroImageKey(String(r.hero_image_url))))
}

async function resolveArticleImages(input: {
  articleUrl: string
  feedId: string
  rssImageUrl: string | null
  excludeItemId?: string
}): Promise<{ hero: string; inset: string | null } | null> {
  const scraped = await scrapeArticleImages(input.articleUrl)
  const avoid = getRecentHeroKeysForFeed(input.feedId)
  if (input.excludeItemId) {
    const self = db
      .prepare('SELECT hero_image_url FROM news_items WHERE id = ?')
      .get(input.excludeItemId) as { hero_image_url: string | null } | undefined
    if (self?.hero_image_url) avoid.delete(heroImageKey(self.hero_image_url))
  }

  if (scraped.length > 0) {
    const picked = await selectBestHeroAndInset(scraped, avoid)
    if (picked.hero) {
      return {
        hero: picked.hero,
        inset: picked.inset && hasDistinctInsetImage(picked.hero, picked.inset) ? picked.inset : null,
      }
    }
  }

  if (input.rssImageUrl) {
    const picked = await selectBestHeroAndInset([input.rssImageUrl], avoid)
    if (picked.hero) return { hero: picked.hero, inset: null }
  }

  return null
}

function saveUploadedNewsImage(agencyId: string, itemId: string, dataUrl: string, suffix: string): string {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image upload — use JPG or PNG')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]!
  const buffer = Buffer.from(match[2]!, 'base64')
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Image must be under 8MB')
  const dir = path.join(newsImagesDir, agencyId, 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${itemId}-${suffix}.${ext}`)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

export async function updateNewsItemContent(
  itemId: string,
  agencyId: string,
  input: {
    headline?: string
    postTitle?: string
    postDescription?: string
    accentWords?: string[]
    heroImageUrl?: string
    insetImageUrl?: string
    heroImageDataUrl?: string
    insetImageDataUrl?: string
    imageCrop?: NewsImageCrop
  },
): Promise<void> {
  const item = db.prepare('SELECT * FROM news_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined
  if (!item) throw new Error('News item not found')
  if (String(item.agency_id) !== agencyId) throw new Error('News item not found')
  if (item.status !== 'ready') throw new Error('Can only edit ready items')

  const pageId = String(item.page_id)
  const templateId = item.template_id as string | null
  const template = templateId
    ? (db.prepare('SELECT * FROM news_templates WHERE id = ?').get(templateId) as Record<string, unknown> | undefined)
    : undefined
  const fontsJson = (template?.fonts_json as string) ?? null

  let headline = ensureSpacedHeadline(
    normalizeHeadlineText(String(input.headline ?? item.headline ?? item.rss_title ?? '')).toUpperCase(),
    String(item.rss_title ?? ''),
  )
  if (!headline.trim()) throw new Error('Headline on image is required')
  headline = fitHeadlineToTemplate(headline, fontsJson)

  const postTitle = String(input.postTitle ?? item.post_title ?? headlineToPostTitle(headline)).trim()
  const postDescription = String(input.postDescription ?? item.post_description ?? '').trim().slice(0, 500)
  const accentWords =
    input.accentWords?.length
      ? input.accentWords.map((w) => w.toUpperCase().trim()).filter(Boolean).slice(0, 4)
      : parseJsonArray(item.accent_words_json as string).length
        ? parseJsonArray(item.accent_words_json as string)
        : pickAccentWords(headline)

  let hero = String(input.heroImageUrl ?? item.hero_image_url ?? '').trim()
  let inset: string | null =
    input.insetImageUrl !== undefined
      ? input.insetImageUrl?.trim() || null
      : ((item.inset_image_url as string | null) ?? null)
  let heroLocalPath: string | undefined
  let insetLocalPath: string | undefined

  if (input.heroImageDataUrl) {
    heroLocalPath = saveUploadedNewsImage(agencyId, itemId, input.heroImageDataUrl, 'hero')
    hero = heroLocalPath
  }
  if (input.insetImageDataUrl) {
    insetLocalPath = saveUploadedNewsImage(agencyId, itemId, input.insetImageDataUrl, 'inset')
    inset = insetLocalPath
  } else if (input.heroImageDataUrl && !input.insetImageDataUrl && input.insetImageUrl === undefined) {
    inset = null
  }

  if (!hero) throw new Error('Hero image is required — paste a URL or upload a picture')
  if (inset && !insetLocalPath && !hasDistinctInsetImage(hero, inset)) inset = null

  heroLocalPath = heroLocalPath ?? (path.isAbsolute(hero) && fs.existsSync(hero) ? hero : undefined)
  insetLocalPath = insetLocalPath ?? (inset && path.isAbsolute(inset) && fs.existsSync(inset) ? inset : undefined)

  let imagePath = String(item.generated_image_path ?? '')
  if (!imagePath) {
    imagePath = path.join(newsImagesDir, agencyId, `${itemId}.png`)
  }
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })

  const imageCrop = input.imageCrop ?? parseImageCrop(item.image_crop_json as string | null)

  await composeItemImage({
    agencyId,
    pageId,
    template,
    heroUrl: hero,
    insetUrl: inset,
    headline,
    accentWords,
    outputPath: imagePath,
    heroLocalPath,
    insetLocalPath,
    rssTitle: String(item.rss_title ?? ''),
    imageCrop,
  })

  const storedHero = input.heroImageUrl?.trim() || hero
  const storedInset = inset && hasDistinctInsetImage(storedHero, inset) ? inset : null
  const cropJson = JSON.stringify(imageCrop)

  db.prepare(`
    UPDATE news_items SET
      headline = ?,
      accent_words_json = ?,
      post_title = ?,
      post_description = ?,
      hero_image_url = ?,
      inset_image_url = ?,
      generated_image_path = ?,
      image_crop_json = ?,
      error_message = NULL
    WHERE id = ?
  `).run(
    headline,
    JSON.stringify(accentWords),
    postTitle,
    postDescription,
    storedHero,
    storedInset,
    imagePath,
    cropJson,
    itemId,
  )
}

export async function processRssArticle(input: {
  agencyId: string
  feedId: string
  pageId: string
  templateId: string | null
  article: { title: string; description: string; link: string; imageUrl: string | null }
  defaultHashtagsJson?: string | null
  aiRewriteEnabled?: boolean
  aiTonePrompt?: string | null
}): Promise<string | null> {
  const articleUrl = normalizeArticleUrl(input.article.link)
  if (isDuplicate(input.pageId, articleUrl) || isAlreadyQueued(input.pageId, articleUrl)) return null

  const template = input.templateId
    ? (db.prepare('SELECT * FROM news_templates WHERE id = ?').get(input.templateId) as Record<string, unknown> | undefined)
    : undefined

  const scraped = await resolveArticleImages({
    articleUrl,
    feedId: input.feedId,
    rssImageUrl: input.article.imageUrl,
  })
  if (!scraped) {
    console.warn(`[news] No images for ${articleUrl}`)
    return null
  }
  const { hero, inset } = scraped

  const hashtags = mergeHashtags(input.defaultHashtagsJson ?? (template?.default_hashtags_json as string), [])
  const content = await buildNewsContent({
    agencyId: input.agencyId,
    rssTitle: input.article.title,
    rssDescription: input.article.description,
    defaultHashtags: hashtags,
    aiRewriteEnabled: input.aiRewriteEnabled,
    aiTonePrompt: input.aiTonePrompt ?? (template?.ai_tone_prompt as string) ?? null,
    templateFontsJson: (template?.fonts_json as string) ?? null,
  })

  const itemId = uuid()
  const imagePath = path.join(newsImagesDir, input.agencyId, `${itemId}.png`)

  await composeItemImage({
    agencyId: input.agencyId,
    pageId: input.pageId,
    template,
    heroUrl: hero,
    insetUrl: inset,
    headline: content.headline,
    accentWords: content.accent_words,
    outputPath: imagePath,
    rssTitle: input.article.title,
  })

  db.prepare(`
    INSERT INTO news_items (
      id, agency_id, feed_id, page_id, template_id, article_url,
      rss_title, rss_description, headline, accent_words_json,
      post_title, post_description, hashtags_json,
      hero_image_url, inset_image_url, generated_image_path, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
  `).run(
    itemId,
    input.agencyId,
    input.feedId,
    input.pageId,
    input.templateId,
    articleUrl,
    input.article.title,
    input.article.description,
    content.headline,
    JSON.stringify(content.accent_words),
    content.post_title,
    content.post_description,
    JSON.stringify(content.hashtags),
    hero,
    inset,
    imagePath,
  )

  return itemId
}

export async function regenerateNewsItemImage(
  itemId: string,
  agencyId?: string,
  options?: { aiInstruction?: string; rewriteCaption?: boolean },
): Promise<void> {
  const item = db.prepare('SELECT * FROM news_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined
  if (!item) throw new Error('News item not found')
  if (agencyId && String(item.agency_id) !== agencyId) throw new Error('News item not found')
  if (item.status !== 'ready') throw new Error('Can only regenerate ready items')

  const pageId = String(item.page_id)
  const templateId = item.template_id as string | null
  const template = templateId
    ? (db.prepare('SELECT * FROM news_templates WHERE id = ?').get(templateId) as Record<string, unknown> | undefined)
    : undefined

  const settings = db.prepare('SELECT * FROM page_news_settings WHERE page_id = ?').get(pageId) as
    | Record<string, unknown>
    | undefined

  const resolvedImages = await resolveArticleImages({
    articleUrl: String(item.article_url ?? ''),
    feedId: String(item.feed_id ?? ''),
    rssImageUrl: (item.hero_image_url as string | null) ?? null,
    excludeItemId: itemId,
  })
  const hero = resolvedImages?.hero ?? String(item.hero_image_url ?? '')
  const fallbackInset = (item.inset_image_url as string | null) ?? null
  const inset = resolvedImages
    ? resolvedImages.inset
    : hasDistinctInsetImage(hero, fallbackInset)
      ? fallbackInset
      : null
  if (!hero) throw new Error('Hero image URL missing')

  const content = await buildNewsContent({
    agencyId: String(item.agency_id),
    rssTitle: String(item.rss_title ?? item.headline ?? ''),
    rssDescription: String(item.rss_description ?? ''),
    defaultHashtags: parseJsonArray(item.hashtags_json as string),
    aiRewriteEnabled: !!settings?.ai_rewrite_enabled,
    aiTonePrompt: (template?.ai_tone_prompt as string) ?? null,
    templateFontsJson: (template?.fonts_json as string) ?? null,
    aiInstruction: options?.aiInstruction?.trim() || null,
    forceCaptionRewrite: !!options?.rewriteCaption,
  })

  let imagePath = String(item.generated_image_path ?? '')
  if (!imagePath) {
    imagePath = path.join(newsImagesDir, String(item.agency_id), `${itemId}.png`)
  }
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })

  const imageCrop = parseImageCrop(item.image_crop_json as string | null)

  await composeItemImage({
    agencyId: String(item.agency_id),
    pageId,
    template,
    heroUrl: hero,
    insetUrl: inset,
    headline: content.headline,
    accentWords: content.accent_words,
    outputPath: imagePath,
    rssTitle: String(item.rss_title ?? ''),
    imageCrop,
  })

  db.prepare(`
    UPDATE news_items SET
      headline = ?,
      accent_words_json = ?,
      post_title = ?,
      post_description = ?,
      hero_image_url = ?,
      inset_image_url = ?,
      generated_image_path = ?,
      error_message = NULL
    WHERE id = ?
  `).run(
    content.headline,
    JSON.stringify(content.accent_words),
    content.post_title,
    content.post_description,
    hero,
    inset,
    imagePath,
    itemId,
  )
}

/** Re-render PNG with current template layout; keeps headline, photos, and crop. */
export async function refreshNewsItemLayout(itemId: string, agencyId: string): Promise<void> {
  const item = db.prepare('SELECT * FROM news_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined
  if (!item) throw new Error('News item not found')
  if (String(item.agency_id) !== agencyId) throw new Error('News item not found')
  if (item.status !== 'ready') throw new Error('Can only refresh ready items')

  const pageId = String(item.page_id)
  const templateId = item.template_id as string | null
  const template = templateId
    ? (db.prepare('SELECT * FROM news_templates WHERE id = ?').get(templateId) as Record<string, unknown> | undefined)
    : undefined

  const hero = String(item.hero_image_url ?? '')
  if (!hero) throw new Error('Hero image URL missing')
  const rawInset = (item.inset_image_url as string | null) ?? null
  const inset = hasDistinctInsetImage(hero, rawInset) ? rawInset : null
  const headline = String(item.headline ?? '').trim()
  if (!headline) throw new Error('Headline missing')

  let imagePath = String(item.generated_image_path ?? '')
  if (!imagePath) {
    imagePath = path.join(newsImagesDir, agencyId, `${itemId}.png`)
  }
  fs.mkdirSync(path.dirname(imagePath), { recursive: true })

  const heroLocalPath = path.isAbsolute(hero) && fs.existsSync(hero) ? hero : undefined
  const insetLocalPath =
    inset && path.isAbsolute(inset) && fs.existsSync(inset) ? inset : undefined

  await composeItemImage({
    agencyId,
    pageId,
    template,
    heroUrl: hero,
    insetUrl: inset,
    headline,
    accentWords: parseJsonArray(item.accent_words_json as string),
    outputPath: imagePath,
    rssTitle: String(item.rss_title ?? ''),
    imageCrop: parseImageCrop(item.image_crop_json as string | null),
    heroLocalPath,
    insetLocalPath,
  })

  db.prepare('UPDATE news_items SET generated_image_path = ?, error_message = NULL WHERE id = ?').run(imagePath, itemId)
}

export async function refreshAllReadyItemLayouts(agencyId: string): Promise<number> {
  const items = db
    .prepare('SELECT id FROM news_items WHERE agency_id = ? AND status = ? ORDER BY created_at DESC')
    .all(agencyId, 'ready') as { id: string }[]
  for (const { id } of items) {
    await refreshNewsItemLayout(id, agencyId)
  }
  return items.length
}

async function publishPhotoWithTokenRetry(
  pageId: string,
  agencyId: string,
  imagePath: string,
  caption: string,
): Promise<{ postId: string; token: string; metaPageId: string }> {
  assertPublishableFacebookPage(pageId, agencyId)

  const page = await resolvePageAccessToken(pageId, { agencyId })
  if (!page) {
    throw new Error('Page token not available — reconnect Facebook under Facebook → Accounts')
  }

  try {
    const { postId } = await publishPhotoPost(page.metaPageId, page.token, imagePath, caption)
    return { postId, token: page.token, metaPageId: page.metaPageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isOAuthTokenError(msg)) throw err

    const refreshed = await refreshPageAccessToken(pageId, agencyId)
    if (!refreshed) {
      throw new Error('Facebook session expired — reconnect your account under Facebook → Accounts', { cause: err })
    }

    const { postId } = await publishPhotoPost(refreshed.metaPageId, refreshed.token, imagePath, caption)
    return { postId, token: refreshed.token, metaPageId: refreshed.metaPageId }
  }
}

export async function publishNewsItem(itemId: string): Promise<{ postId: string }> {
  const item = db.prepare('SELECT * FROM news_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined
  if (!item) throw new Error('News item not found')
  if (item.status === 'posted') throw new Error('Already posted')

  const pageId = String(item.page_id)
  const agencyId = String(item.agency_id)

  const settings = db.prepare('SELECT * FROM page_news_settings WHERE page_id = ?').get(pageId) as
    | Record<string, unknown>
    | undefined

  const captionParts = [String(item.post_title ?? '')]
  if (item.post_description) captionParts.push('', String(item.post_description))
  const tags = parseJsonArray(item.hashtags_json as string)
  if (tags.length) captionParts.push('', tags.join(' '))

  let caption = captionParts.join('\n').trim()
  if (settings?.include_link_in_caption) {
    caption += `\n\n${String(item.article_url)}`
  }

  const imagePath = String(item.generated_image_path ?? '')
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('Generated image missing')

  const { postId, token } = await publishPhotoWithTokenRetry(pageId, agencyId, imagePath, caption)

  let commentId: string | null = null
  if (settings?.comment_link_enabled) {
    const comment = `📖 ${String(item.post_title ?? 'Read more')}:\n${String(item.article_url)}`
    const result = await postComment(postId, token, comment)
    commentId = result.commentId
  }

  db.prepare(`
    UPDATE news_items SET status = 'posted', fb_post_id = ?, fb_comment_id = ?, posted_at = datetime('now'), error_message = NULL
    WHERE id = ?
  `).run(postId, commentId, itemId)

  db.prepare(`
    INSERT INTO posted_articles (id, agency_id, page_id, article_url, news_item_id, fb_post_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_id, article_url) DO UPDATE SET fb_post_id = excluded.fb_post_id, posted_at = datetime('now')
  `).run(uuid(), item.agency_id, pageId, item.article_url, itemId, postId)

  return { postId }
}

export async function pollFeed(feedId: string): Promise<number> {
  const feed = db.prepare('SELECT * FROM rss_feeds WHERE id = ? AND is_active = 1').get(feedId) as
    | Record<string, unknown>
    | undefined
  if (!feed) return 0

  const pageId = feed.page_id as string | null
  if (!pageId) return 0

  const settings = db.prepare('SELECT * FROM page_news_settings WHERE page_id = ? AND is_active = 1').get(pageId) as
    | Record<string, unknown>
    | undefined

  try {
    const articles = await fetchRssFeed(String(feed.url))
    const templateId = (settings?.template_id as string) ?? (feed.template_id as string) ?? null
    const template = templateId
      ? (db.prepare('SELECT ai_tone_prompt FROM news_templates WHERE id = ?').get(templateId) as
          | { ai_tone_prompt: string | null }
          | undefined)
      : undefined

    const jobs = articles.slice(0, 5).map((article) =>
      processRssArticle({
        agencyId: String(feed.agency_id),
        feedId: String(feed.id),
        pageId,
        templateId,
        article,
        defaultHashtagsJson: (settings?.default_hashtags_json as string) ?? null,
        aiRewriteEnabled: !!settings?.ai_rewrite_enabled,
        aiTonePrompt: template?.ai_tone_prompt ?? null,
      }),
    )
    const results = await Promise.allSettled(jobs)
    const created = results.filter((r) => r.status === 'fulfilled' && r.value).length

    db.prepare(`UPDATE rss_feeds SET last_polled_at = datetime('now'), last_error = NULL WHERE id = ?`).run(feedId)
    return created
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Poll failed'
    db.prepare(`UPDATE rss_feeds SET last_polled_at = datetime('now'), last_error = ? WHERE id = ?`).run(msg, feedId)
    throw err
  }
}

export async function pollFeedsForAgency(agencyId: string): Promise<{ feeds: number; created: number }> {
  const feeds = db
    .prepare('SELECT id FROM rss_feeds WHERE is_active = 1 AND agency_id = ?')
    .all(agencyId) as { id: string }[]
  let created = 0
  for (const feed of feeds) {
    try {
      created += await pollFeed(feed.id)
    } catch (err) {
      console.error(`[news] Feed poll failed ${feed.id}:`, err)
    }
  }
  return { feeds: feeds.length, created }
}

export async function pollAllFeeds(): Promise<{ feeds: number; created: number }> {
  const feeds = db.prepare('SELECT id FROM rss_feeds WHERE is_active = 1').all() as { id: string }[]
  let created = 0
  for (const feed of feeds) {
    try {
      created += await pollFeed(feed.id)
    } catch (err) {
      console.error(`[news] Feed poll failed ${feed.id}:`, err)
    }
  }
  return { feeds: feeds.length, created }
}

export function deleteNewsItem(itemId: string, agencyId: string): void {
  const item = db
    .prepare('SELECT generated_image_path, status FROM news_items WHERE id = ? AND agency_id = ?')
    .get(itemId, agencyId) as { generated_image_path: string | null; status: string } | undefined
  if (!item) throw new Error('News item not found')
  if (item.status === 'posted') throw new Error('Published items cannot be deleted')

  const imagePath = item.generated_image_path
  if (imagePath && fs.existsSync(imagePath)) {
    try {
      fs.unlinkSync(imagePath)
    } catch {
      /* ignore missing file */
    }
  }

  db.prepare('DELETE FROM news_items WHERE id = ? AND agency_id = ?').run(itemId, agencyId)
}
