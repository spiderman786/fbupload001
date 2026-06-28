import fs from 'fs'
import path from 'path'
import sharp, { type OverlayOptions } from 'sharp'
import { downloadImageBuffer, upgradeImageUrl } from './rssFetcher.js'
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

function wrapHeadlineWords(headline: string, maxCharsPerLine: number): string[] {
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
  return lines
}

function maxCharsForFontSize(fontSize: number): number {
  return Math.max(14, Math.floor((CANVAS_W - 100) / (fontSize * 0.52)))
}

function fitHeadlineLines(headline: string, baseFontSize: number): { lines: string[]; fontSize: number } {
  let fontSize = baseFontSize
  for (let attempt = 0; attempt < 5; attempt++) {
    const lines = wrapHeadlineWords(headline, maxCharsForFontSize(fontSize))
    if (lines.length <= 4) return { lines, fontSize }
    fontSize = Math.max(32, fontSize - 6)
  }
  const lines = wrapHeadlineWords(headline, maxCharsForFontSize(32)).slice(0, 4)
  return { lines, fontSize: 32 }
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

function buildHeadlineLineSvg(
  line: string,
  y: number,
  accentWords: string[],
  colors: NewsColors,
  fontSize: number,
): string {
  const accentSet = new Set(accentWords.map((w) => w.toUpperCase()))
  const words = line.split(/\s+/).filter(Boolean)
  const hasAccent = words.some((word) => {
    const clean = word.replace(/[^A-Za-z0-9']/g, '').toUpperCase()
    return accentSet.has(clean) || accentSet.has(word.toUpperCase())
  })

  if (!hasAccent) {
    return `<text x="${CANVAS_W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="900" fill="${colors.text}">${escapeXml(line)}</text>`
  }

  let inner = ''
  words.forEach((word, idx) => {
    const clean = word.replace(/[^A-Za-z0-9']/g, '').toUpperCase()
    const isAccent = accentSet.has(clean) || accentSet.has(word.toUpperCase())
    const fill = isAccent ? colors.accent : colors.text
    const text = (idx > 0 ? ' ' : '') + word
    inner += `<tspan fill="${fill}">${escapeXml(text)}</tspan>`
  })

  return `<text x="${CANVAS_W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="900">${inner}</text>`
}

function buildHeadlineSvg(
  headline: string,
  accentWords: string[],
  colors: NewsColors,
  fonts: NewsFonts,
  barTop: number,
): string {
  const { lines, fontSize } = fitHeadlineLines(headline, fonts.headlineSize)
  const lineHeight = Math.round(fontSize * 1.18)
  const textBlockHeight = lines.length * lineHeight
  const textAreaHeight = CANVAS_H - barTop
  const brandClearance = BRAND_BADGE_R + 36
  const startY =
    barTop + brandClearance + fontSize + Math.max(24, (textAreaHeight - brandClearance - textBlockHeight) / 2)

  return lines
    .map((line, lineIdx) => buildHeadlineLineSvg(line, startY + lineIdx * lineHeight, accentWords, colors, fontSize))
    .join('\n')
}

async function circleInset(input: Buffer, size: number, borderColor: string): Promise<Buffer> {
  const inner = await sharp(input)
    .resize(size, size, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.6, m1: 0.8, m2: 0.3 })
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
    .resize(CANVAS_W, HERO_H, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.8, m1: 1.0, m2: 0.4 })
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
  const heroBuf = await downloadImageBuffer(upgradeImageUrl(options.heroUrl))
  if (!heroBuf) throw new Error('Could not download hero image')

  let insetBuf = options.insetUrl === options.heroUrl
    ? await sharp(heroBuf).extract({ left: 80, top: 80, width: 400, height: 400 }).toBuffer()
    : await downloadImageBuffer(upgradeImageUrl(options.insetUrl))

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
