import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { db } from '../../db.js'
import { publishPhotoPost, postComment } from '../publisher.js'
import { isOAuthTokenError, refreshPageAccessToken, resolvePageAccessToken, assertPublishableFacebookPage } from '../pageTokens.js'
import { maybeRewriteNewsContent } from './aiRewriter.js'
import { runCompositorJob } from './compositorQueue.js'
import { formatNewsContent, mergeHashtags } from './contentFormatter.js'
import { composeNewsImage } from './imageCompositor.js'
import { fetchRssFeed, scrapeArticleImages, selectBestHeroAndInset } from './rssFetcher.js'
import { normalizeArticleUrl, parseBrandType, parseJsonArray } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const newsImagesDir = path.join(__dirname, '..', '..', '..', 'data', 'news-images')

function isDuplicate(pageId: string, articleUrl: string): boolean {
  const row = db
    .prepare('SELECT id FROM posted_articles WHERE page_id = ? AND article_url = ? LIMIT 1')
    .get(pageId, articleUrl) as { id: string } | undefined
  return !!row
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
  if (isDuplicate(input.pageId, articleUrl)) return null

  const template = input.templateId
    ? (db.prepare('SELECT * FROM news_templates WHERE id = ?').get(input.templateId) as Record<string, unknown> | undefined)
    : undefined

  const pageRow = db
    .prepare('SELECT name FROM facebook_pages WHERE id = ?')
    .get(input.pageId) as { name: string } | undefined

  const scraped = await scrapeArticleImages(articleUrl)
  const imageList = [...scraped, input.article.imageUrl].filter(Boolean) as string[]
  const { hero, inset } = await selectBestHeroAndInset(imageList)
  if (!hero) {
    console.warn(`[news] No images for ${articleUrl}`)
    return null
  }

  const hashtags = mergeHashtags(input.defaultHashtagsJson ?? (template?.default_hashtags_json as string), [])
  let content = formatNewsContent({
    rssTitle: input.article.title,
    rssDescription: input.article.description,
    defaultHashtags: hashtags,
  })

  if (input.aiRewriteEnabled) {
    const rewritten = await maybeRewriteNewsContent({
      rssTitle: input.article.title,
      rssDescription: input.article.description,
      aiTonePrompt: input.aiTonePrompt ?? (template?.ai_tone_prompt as string) ?? undefined,
    })
    if (rewritten) {
      content = { ...content, ...rewritten, hashtags }
    }
  }

  const itemId = uuid()
  const imagePath = path.join(newsImagesDir, input.agencyId, `${itemId}.png`)

  await runCompositorJob(() =>
    composeNewsImage({
      heroUrl: hero,
      insetUrl: inset ?? hero,
      headline: content.headline,
      accentWords: content.accent_words,
      colorsJson: (template?.colors_json as string) ?? null,
      fontsJson: (template?.fonts_json as string) ?? null,
      brandType: parseBrandType(template?.brand_type as string | undefined),
      pageName: pageRow?.name ?? null,
      logoPath: (template?.logo_path as string) ?? null,
      ctaText: (template?.cta_text as string) ?? '',
      outputPath: imagePath,
    }),
  )

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
      throw new Error('Facebook session expired — reconnect your account under Facebook → Accounts')
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
    const jobs = articles.slice(0, 5).map((article) =>
      processRssArticle({
        agencyId: String(feed.agency_id),
        feedId: String(feed.id),
        pageId,
        templateId: (settings?.template_id as string) ?? (feed.template_id as string) ?? null,
        article,
        defaultHashtagsJson: (settings?.default_hashtags_json as string) ?? null,
        aiRewriteEnabled: !!settings?.ai_rewrite_enabled,
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
