import fs from 'fs'
import path from 'path'
import sharp, { type OverlayOptions } from 'sharp'
import { downloadImageBuffer } from './rssFetcher.js'
import { parseBrandType, parseColors, parseFonts, type NewsBrandType, type NewsColors, type NewsFonts } from './types.js'

const CANVAS_W = 1080
const CANVAS_H = 1350
const HERO_H = 880
const INSET_SIZE = 168
const INSET_X = 36
const BRAND_BADGE_R = 54
const FONT_STACK = "Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapHeadlineWords(headline: string, maxCharsPerLine = 26): string[] {
  const words = headline.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 4)
}

function splitBrandLines(label: string): [string, string] {
  const parts = label.toUpperCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ['', '']
  if (parts.length === 1) return [parts[0]!, '']
  if (parts.length === 2) return [parts[0]!, parts[1]!]
  const mid = Math.ceil(parts.length / 2)
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')]
}

function buildBrandBadgeSvg(pageName: string, colors: NewsColors, fonts: NewsFonts, barTop: number): string {
  const label = pageName.trim()
  if (!label) return ''

  const [line1, line2] = splitBrandLines(label)
  const cx = CANVAS_W / 2
  const cy = barTop
  const fs = fonts.pageNameSize ?? 15
  const line2Offset = line2 ? 8 : 0

  return `
    <circle cx="${cx}" cy="${cy}" r="${BRAND_BADGE_R}" fill="${colors.barBg}" stroke="${colors.text}" stroke-width="3"/>
    <text x="${cx}" y="${cy - line2Offset}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fs}" font-weight="900" fill="${colors.text}">${escapeXml(line1)}</text>
    ${line2 ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fs}" font-weight="900" fill="${colors.text}">${escapeXml(line2)}</text>` : ''}
  `
}

function estimateWordWidth(word: string, fontSize: number): number {
  return word.length * (fontSize * 0.58) + 14
}

function buildHeadlineSvg(
  headline: string,
  accentWords: string[],
  colors: NewsColors,
  fonts: NewsFonts,
  barTop: number,
): string {
  const lines = wrapHeadlineWords(headline)
  const accentSet = new Set(accentWords.map((w) => w.toUpperCase()))
  const lineHeight = fonts.headlineSize + 10
  const textBlockHeight = lines.length * lineHeight
  const textAreaHeight = CANVAS_H - barTop
  const brandClearance = BRAND_BADGE_R + 36
  const startY =
    barTop + brandClearance + fonts.headlineSize + Math.max(24, (textAreaHeight - brandClearance - textBlockHeight) / 2)

  let svg = ''
  lines.forEach((line, lineIdx) => {
    const words = line.split(/\s+/).filter(Boolean)
    const widths = words.map((word) => estimateWordWidth(word, fonts.headlineSize))
    const totalWidth = widths.reduce((sum, w) => sum + w, 0)
    let x = (CANVAS_W - totalWidth) / 2
    const y = startY + lineIdx * lineHeight

    words.forEach((word, wordIdx) => {
      const clean = word.replace(/[^A-Za-z0-9']/g, '')
      const isAccent = accentSet.has(clean.toUpperCase()) || accentSet.has(word.toUpperCase())
      const fill = isAccent ? colors.accent : colors.text
      svg += `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${fonts.headlineSize}" font-weight="900" letter-spacing="0.5" fill="${fill}">${escapeXml(word)}</text>`
      x += widths[wordIdx]!
    })
  })

  return svg
}

async function circleInset(input: Buffer, size: number, borderColor: string): Promise<Buffer> {
  const inner = await sharp(input)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
  )

  const rounded = await sharp(inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()

  const border = Math.max(4, Math.round(size * 0.035))
  const outer = size + border * 2
  const ring = Buffer.from(
    `<svg width="${outer}" height="${outer}"><circle cx="${outer / 2}" cy="${outer / 2}" r="${size / 2 + border}" fill="${borderColor}"/></svg>`,
  )

  return sharp(ring)
    .composite([{ input: rounded, top: border, left: border }])
    .png()
    .toBuffer()
}

export const TEMPLATE_PREVIEW_HEADLINE = 'ATMOSPHERIC THRILLER RETURNS WITH DEEPER MYSTERIES AND HIDDEN TRUTHS'
export const TEMPLATE_PREVIEW_ACCENT_WORDS = ['ATMOSPHERIC', 'THRILLER', 'TRUTHS']

async function createSampleHeroBuffer(_accentColor: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${HERO_H}">
    <defs>
      <linearGradient id="hero" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2a2a3a"/>
        <stop offset="100%" stop-color="#1a1a24"/>
      </linearGradient>
    </defs>
    <rect width="${CANVAS_W}" height="${HERO_H}" fill="url(#hero)"/>
    <rect x="0" y="${HERO_H - 120}" width="${CANVAS_W}" height="120" fill="url(#fade)" opacity="0.35"/>
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="1"/>
      </linearGradient>
    </defs>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function renderNewsCanvas(options: {
  heroBuf: Buffer
  insetBuf: Buffer
  headline: string
  accentWords: string[]
  colorsJson: string | null
  fontsJson: string | null
  brandType?: NewsBrandType
  pageName?: string | null
  logoPath?: string | null
  ctaText?: string
}): Promise<Buffer> {
  const colors = parseColors(options.colorsJson)
  const fonts = parseFonts(options.fontsJson)
  const brandType = options.brandType ?? 'page_name'

  const heroLayer = await sharp(options.heroBuf)
    .resize(CANVAS_W, HERO_H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  const insetLayer = await circleInset(options.insetBuf, INSET_SIZE, colors.insetBorder)
  const insetY = HERO_H - INSET_SIZE - 48

  const barTop = HERO_H
  const dividerLine = `<line x1="0" y1="${barTop}" x2="${CANVAS_W}" y2="${barTop}" stroke="${colors.text}" stroke-width="3"/>`
  const brandSvg =
    brandType === 'page_name' ? buildBrandBadgeSvg(options.pageName ?? '', colors, fonts, barTop) : ''
  const headlineSvg = buildHeadlineSvg(options.headline, options.accentWords, colors, fonts, barTop)
  const cta = options.ctaText?.trim() ?? ''

  const overlaySvg = Buffer.from(`<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${barTop}" width="${CANVAS_W}" height="${CANVAS_H - barTop}" fill="${colors.barBg}"/>
    ${dividerLine}
    ${brandSvg}
    ${headlineSvg}
    ${cta ? `<text x="${CANVAS_W / 2}" y="${CANVAS_H - 36}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fonts.ctaSize}" font-weight="700" fill="${colors.cta}">${escapeXml(cta.toUpperCase())}</text>` : ''}
  </svg>`)

  const composites: OverlayOptions[] = [
    { input: heroLayer, top: 0, left: 0 },
    { input: insetLayer, top: insetY, left: INSET_X },
    { input: overlaySvg, top: 0, left: 0 },
  ]

  if (brandType === 'logo' && options.logoPath && fs.existsSync(options.logoPath)) {
    const logoSize = BRAND_BADGE_R * 2
    const logoBuf = await sharp(options.logoPath)
      .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    composites.push({
      input: logoBuf,
      top: barTop - logoSize / 2,
      left: Math.floor(CANVAS_W / 2 - logoSize / 2),
    })
  }

  return sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 3,
      background: colors.barBg,
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}

export async function composeTemplatePreview(options: {
  colorsJson: string | null
  fontsJson: string | null
  headline?: string
  accentWords?: string[]
  brandType?: NewsBrandType
  pageName?: string | null
  logoPath?: string | null
  ctaText?: string
}): Promise<Buffer> {
  const headline = (options.headline?.trim() || TEMPLATE_PREVIEW_HEADLINE).toUpperCase()
  const accentWords = options.accentWords?.length ? options.accentWords : TEMPLATE_PREVIEW_ACCENT_WORDS

  const heroBuf = await createSampleHeroBuffer(parseColors(options.colorsJson).accent)
  const insetBuf = await sharp(heroBuf).extract({ left: 120, top: HERO_H - 420, width: 400, height: 400 }).toBuffer()

  return renderNewsCanvas({
    heroBuf,
    insetBuf,
    headline,
    accentWords,
    colorsJson: options.colorsJson,
    fontsJson: options.fontsJson,
    brandType: parseBrandType(options.brandType),
    pageName: options.pageName ?? 'POPCORN FEED',
    logoPath: options.logoPath,
    ctaText: options.ctaText ?? '',
  })
}

export async function composeNewsImage(options: {
  heroUrl: string
  insetUrl: string
  headline: string
  accentWords: string[]
  colorsJson: string | null
  fontsJson: string | null
  brandType?: NewsBrandType
  pageName?: string | null
  logoPath?: string | null
  ctaText?: string
  outputPath: string
}): Promise<string> {
  const heroBuf = await downloadImageBuffer(options.heroUrl)
  if (!heroBuf) throw new Error('Could not download hero image')

  let insetBuf = options.insetUrl === options.heroUrl
    ? await sharp(heroBuf).extract({ left: 80, top: 80, width: 400, height: 400 }).toBuffer()
    : await downloadImageBuffer(options.insetUrl)

  if (!insetBuf) insetBuf = heroBuf

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })

  const png = await renderNewsCanvas({
    heroBuf,
    insetBuf,
    headline: options.headline,
    accentWords: options.accentWords,
    colorsJson: options.colorsJson,
    fontsJson: options.fontsJson,
    brandType: options.brandType,
    pageName: options.pageName,
    logoPath: options.logoPath,
    ctaText: options.ctaText,
  })

  await fs.promises.writeFile(options.outputPath, png)
  return options.outputPath
}
