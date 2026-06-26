import fs from 'fs'
import path from 'path'
import { initDb, db } from '../server/db.ts'
import { v4 as uuid } from 'uuid'
import { fetchRssFeed, scrapeArticleImages, selectHeroAndInset } from '../server/services/news/rssFetcher.ts'
import { formatNewsContent, pickAccentWords } from '../server/services/news/contentFormatter.ts'
import { composeNewsImage } from '../server/services/news/imageCompositor.ts'
import { DEFAULT_COLORS } from '../server/services/news/types.ts'

async function main() {
  initDb()
  console.log('[1] DB ok — news_items table exists')

  const feedUrl = 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'
  const articles = await fetchRssFeed(feedUrl)
  if (!articles.length) throw new Error('No RSS articles')
  const article = articles[0]!
  console.log('[2] RSS ok —', article.title.slice(0, 60))

  const content = formatNewsContent({
    rssTitle: article.title,
    rssDescription: article.description,
    defaultHashtags: ['#News', '#Test'],
  })
  console.log('[3] Formatter ok — headline:', content.headline.slice(0, 50))
  console.log('    accent words:', pickAccentWords(content.headline))

  const scraped = await scrapeArticleImages(article.link)
  const imageList = [article.imageUrl, ...scraped].filter(Boolean) as string[]
  const { hero, inset } = selectHeroAndInset(imageList)
  if (!hero) {
    console.log('[4] Skipping compositor — no images found for article')
    return
  }

  const outDir = path.join('data', 'news-images', 'smoke-test')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'sample.png')

  await composeNewsImage({
    heroUrl: hero,
    insetUrl: inset ?? hero,
    headline: content.headline,
    accentWords: content.accent_words,
    colorsJson: JSON.stringify(DEFAULT_COLORS),
    fontsJson: JSON.stringify({ headlineSize: 42, ctaSize: 20 }),
    outputPath: outPath,
  })

  const stat = fs.statSync(outPath)
  console.log('[4] Compositor ok —', outPath, `(${Math.round(stat.size / 1024)} KB)`)

  const agency = db.prepare('SELECT id FROM agencies LIMIT 1').get() as { id: string } | undefined
  if (agency) {
    const tid = uuid()
    db.prepare(`
      INSERT INTO news_templates (id, agency_id, name, colors_json, fonts_json)
      VALUES (?, ?, 'Smoke Test', ?, '{}')
    `).run(tid, agency.id, JSON.stringify(DEFAULT_COLORS))
    console.log('[5] Template insert ok — agency', agency.id)
  }

  console.log('\nAll smoke tests passed.')
}

main().catch((err) => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
