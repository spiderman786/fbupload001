import fs from 'fs'
import path from 'path'
import sharp, { type OverlayOptions } from 'sharp'
import { downloadImageBuffer, upgradeImageUrl } from './rssFetcher.js'
import { parseBrandType, parseColors, parseFonts, parseImageCrop, type NewsBrandType, type NewsColors, type NewsFonts, type NewsImageCrop } from './types.js'

const CANVAS_W = 1080
const CANVAS_H = 1350
const HERO_H = 880
const INSET_SIZE = 168
const INSET_X = 36
const BRAND_BADGE_R = 54
const FONT_STACK = "Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"

function insetOuterSize(size: number): { border: number; outer: number } {
  const border = Math.max(4, Math.round(size * 0.035))
  return { border, outer: size + border * 2 }
}

function popcornInsetTop(barTop: number): number {
  const { outer } = insetOuterSize(INSET_SIZE)
  return barTop - Math.round(outer * 0.52)
}

function normalizeLayoutPreset(layoutPreset: string): string {
  if (layoutPreset === 'minimal' || layoutPreset === 'tech_pulse') return 'popcorn'
  return layoutPreset
}

function isPopcornLayout(layoutPreset: string): boolean {
  const normalized = normalizeLayoutPreset(layoutPreset)
  return normalized === 'popcorn' || normalized === 'popcorn_hero'
}

function showInsetForLayout(layoutPreset: string): boolean {
  return normalizeLayoutPreset(layoutPreset) !== 'popcorn_hero'
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HEADLINE_PAD = 120
const IMPACT_CHAR_WIDTH = 0.68
const MAX_HEADLINE_LINES = 4
const MAX_HEADLINE_WORDS = 8

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * IMPACT_CHAR_WIDTH
}

function lineFitsCanvas(line: string, fontSize: number): boolean {
  return estimateTextWidth(line, fontSize) <= CANVAS_W - HEADLINE_PAD
}

function wrapHeadlineBalanced(
  words: string[],
  fontSize: number,
  maxLines: number,
): { lines: string[]; complete: boolean } {
  const maxWidth = CANVAS_W - HEADLINE_PAD
  const lines: string[] = []
  let i = 0

  while (i < words.length && lines.length < maxLines) {
    let line = words[i]!
    i += 1
    while (i < words.length) {
      const candidate = `${line} ${words[i]}`
      if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
        line = candidate
        i += 1
      } else {
        break
      }
    }
    lines.push(line)
  }

  return { lines, complete: i >= words.length }
}

function fitHeadlineLines(headline: string, baseFontSize: number): { lines: string[]; fontSize: number } {
  let words = normalizeHeadlineText(headline).toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { lines: [], fontSize: baseFontSize }
  if (words.length > MAX_HEADLINE_WORDS) words = words.slice(0, MAX_HEADLINE_WORDS)

  let fontSize = Math.min(baseFontSize, 58)
  for (let attempt = 0; attempt < 12; attempt++) {
    const { lines, complete } = wrapHeadlineBalanced(words, fontSize, MAX_HEADLINE_LINES)
    if (
      complete &&
      lines.length <= MAX_HEADLINE_LINES &&
      lines.every((line) => lineFitsCanvas(line, fontSize))
    ) {
      return { lines, fontSize }
    }
    fontSize = Math.max(26, fontSize - 3)
  }

  let trimmed = [...words]
  while (trimmed.length > 4) {
    const { lines, complete } = wrapHeadlineBalanced(trimmed, 26, MAX_HEADLINE_LINES)
    if (
      complete &&
      lines.length <= MAX_HEADLINE_LINES &&
      lines.every((line) => lineFitsCanvas(line, 26))
    ) {
      return { lines, fontSize: 26 }
    }
    trimmed = trimmed.slice(0, -1)
  }

  const { lines } = wrapHeadlineBalanced(trimmed, 26, MAX_HEADLINE_LINES)
  return { lines: lines.slice(0, MAX_HEADLINE_LINES), fontSize: 26 }
}

export function normalizeHeadlineText(headline: string): string {
  return headline.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Split glued tokens like "DWTSSTARS" using words from the original RSS title. */
export function repairHeadlineSpacing(headline: string, referenceTitle: string): string {
  const refWords = normalizeHeadlineText(referenceTitle)
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z0-9']/g, ''))
    .filter((w) => w.length >= 2)

  if (!refWords.length) return normalizeHeadlineText(headline).toUpperCase()

  const sortedRef = [...new Set(refWords)].sort((a, b) => b.length - a.length)
  const tokens = normalizeHeadlineText(headline).toUpperCase().split(/\s+/).filter(Boolean)
  const fixed: string[] = []

  for (const token of tokens) {
    const clean = token.replace(/[^A-Z0-9']/g, '')
    if (!clean) continue
    if (refWords.includes(clean)) {
      fixed.push(clean)
      continue
    }
    fixed.push(...decomposeHeadlineToken(clean, sortedRef))
  }

  return fixed.join(' ').replace(/\s+/g, ' ').trim()
}

function decomposeHeadlineToken(token: string, refWords: string[]): string[] {
  if (refWords.includes(token)) return [token]

  const parts: string[] = []
  let pos = 0
  while (pos < token.length) {
    let matched: string | null = null
    for (const word of refWords) {
      if (word.length >= 2 && token.startsWith(word, pos)) {
        matched = word
        break
      }
    }
    if (matched) {
      parts.push(matched)
      pos += matched.length
      continue
    }
    let end = pos + 1
    while (end < token.length && !refWords.some((w) => w.length >= 2 && token.startsWith(w, end))) {
      end++
    }
    parts.push(token.slice(pos, end))
    pos = end
  }

  return parts.filter(Boolean)
}

/** Repair AI headlines that lost spaces between words. */
export function ensureSpacedHeadline(headline: string, fallbackTitle?: string): string {
  let text = normalizeHeadlineText(headline).toUpperCase()
  if (fallbackTitle) {
    text = repairHeadlineSpacing(text, fallbackTitle)
  }
  if (/\s/.test(text)) return text

  if (fallbackTitle) {
    const fromRss = normalizeHeadlineText(fallbackTitle).toUpperCase()
    const rssWords = fromRss.split(/\s+/).filter(Boolean)
    if (rssWords.length > 1) {
      return rssWords.slice(0, MAX_HEADLINE_WORDS).join(' ').slice(0, 42)
    }
  }

  return text.match(/.{1,14}/g)?.join(' ') ?? text
}

/** Check whether a headline fits the 1080×1350 template text area (max 4 lines). */
export function precheckHeadlineForTemplate(
  headline: string,
  fontsJson?: string | null,
): {
  fits: boolean
  lines: string[]
  fontSize: number
  lineCount: number
  normalizedHeadline: string
} {
  const fonts = parseFonts(fontsJson ?? null)
  const normalizedHeadline = normalizeHeadlineText(headline).toUpperCase()
  const baseSize = fonts.headlineSize
  const { lines, fontSize } = fitHeadlineLines(normalizedHeadline, baseSize)
  const fits =
    lines.length <= MAX_HEADLINE_LINES &&
    fontSize >= 26 &&
    lines.every((line) => lineFitsCanvas(line, fontSize)) &&
    normalizedHeadline.split(/\s+/).length <= MAX_HEADLINE_WORDS
  return { fits, lines, fontSize, lineCount: lines.length, normalizedHeadline }
}

/** Shrink an oversized headline until it fits the template. */
export function fitHeadlineToTemplate(headline: string, fontsJson?: string | null): string {
  const check = precheckHeadlineForTemplate(headline, fontsJson)
  if (check.fits) return check.normalizedHeadline

  const words = check.normalizedHeadline.split(/\s+/).filter(Boolean)
  while (words.length > 4) {
    words.pop()
    const candidate = words.join(' ')
    const retry = precheckHeadlineForTemplate(candidate, fontsJson)
    if (retry.fits) return candidate
  }

  return wrapHeadlineBalanced(words, 26, MAX_HEADLINE_LINES).lines.join(' ').slice(0, 42)
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

function buildPagePictureBrandSvg(pageName: string, colors: NewsColors, fonts: NewsFonts, barTop: number): string {
  const label = pageName.trim()
  if (!label) return buildBrandArcsSvg(colors, barTop)

  const cx = CANVAS_W / 2
  const labelY = barTop - BRAND_BADGE_R - 14
  const fs = Math.max(11, (fonts.pageNameSize ?? 15) - 1)

  return `
    ${buildBrandArcsSvg(colors, barTop)}
    <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fs}" font-weight="900" fill="${colors.text}">${escapeXml(label.slice(0, 28).toUpperCase())}</text>
  `
}

function buildBrandArcsSvg(colors: NewsColors, barTop: number): string {
  const cx = CANVAS_W / 2
  const cy = barTop
  const r = BRAND_BADGE_R + 10
  return `
    <path d="M ${cx - r} ${cy - 6} A ${r} ${r} 0 0 1 ${cx + r} ${cy - 6}" fill="none" stroke="${colors.accent}" stroke-width="3"/>
    <path d="M ${cx - r} ${cy + 6} A ${r} ${r} 0 0 0 ${cx + r} ${cy + 6}" fill="none" stroke="${colors.accent}" stroke-width="3"/>
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
  if (words.length === 0) return ''

  const spaceWidth = estimateTextWidth(' ', fontSize)
  const wordWidths = words.map((word) => estimateTextWidth(word, fontSize))
  const totalWidth = wordWidths.reduce((sum, width, idx) => sum + width + (idx > 0 ? spaceWidth : 0), 0)
  const maxWidth = CANVAS_W - HEADLINE_PAD

  if (totalWidth > maxWidth) {
    const scale = maxWidth / totalWidth
    const adjustedSize = Math.max(22, Math.floor(fontSize * scale))
    return `<text x="${CANVAS_W / 2}" y="${y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${adjustedSize}" font-weight="900" fill="${colors.text}">${escapeXml(line)}</text>`
  }

  let x = (CANVAS_W - totalWidth) / 2
  let inner = ''
  words.forEach((word, idx) => {
    if (idx > 0) x += spaceWidth
    const clean = word.replace(/[^A-Za-z0-9']/g, '').toUpperCase()
    const isAccent = accentSet.has(clean) || accentSet.has(word.toUpperCase())
    inner += `<tspan x="${x.toFixed(1)}" fill="${isAccent ? colors.accent : colors.text}">${escapeXml(word)}</tspan>`
    x += wordWidths[idx]!
  })

  return `<text y="${y}" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="900">${inner}</text>`
}

function buildHeadlineSvg(
  headline: string,
  accentWords: string[],
  colors: NewsColors,
  fonts: NewsFonts,
  barTop: number,
): string {
  const cleanHeadline = normalizeHeadlineText(headline).toUpperCase()
  const { lines, fontSize } = fitHeadlineLines(cleanHeadline, fonts.headlineSize)
  const lineHeight = Math.round(fontSize * 1.34)
  const textBlockHeight = lines.length * lineHeight
  const textAreaHeight = CANVAS_H - barTop
  const brandClearance = BRAND_BADGE_R + 40
  const startY =
    barTop + brandClearance + fontSize + Math.max(28, (textAreaHeight - brandClearance - textBlockHeight) / 2)

  return lines
    .slice(0, MAX_HEADLINE_LINES)
    .map((line, lineIdx) => buildHeadlineLineSvg(line, startY + lineIdx * lineHeight, accentWords, colors, fontSize))
    .join('\n')
}

async function fitImageWithCrop(
  buf: Buffer,
  targetW: number,
  targetH: number,
  focusX: number,
  focusY: number,
  zoom: number,
): Promise<Buffer> {
  const meta = await sharp(buf).metadata()
  const iw = meta.width ?? targetW
  const ih = meta.height ?? targetH
  const scale = Math.max(targetW / iw, targetH / ih) * Math.max(1, Math.min(3, zoom))
  const sw = Math.max(targetW, Math.round(iw * scale))
  const sh = Math.max(targetH, Math.round(ih * scale))

  const resized = await sharp(buf).resize(sw, sh, { fit: 'fill' }).png().toBuffer()
  const left = Math.max(0, Math.min(sw - targetW, Math.round((focusX / 100) * (sw - targetW))))
  const top = Math.max(0, Math.min(sh - targetH, Math.round((focusY / 100) * (sh - targetH))))

  return sharp(resized)
    .extract({ left, top, width: targetW, height: targetH })
    .sharpen({ sigma: 0.6, m1: 0.8, m2: 0.3 })
    .png()
    .toBuffer()
}

async function circleProfilePicture(input: Buffer, diameter: number, borderColor: string, bgColor: string): Promise<Buffer> {
  const { border, outer } = insetOuterSize(diameter)
  const inner = await sharp(input)
    .resize(diameter, diameter, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.4, m1: 0.6, m2: 0.2 })
    .png()
    .toBuffer()

  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}" fill="white"/></svg>`,
  )
  const rounded = await sharp(inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()

  const ring = Buffer.from(
    `<svg width="${outer}" height="${outer}"><circle cx="${outer / 2}" cy="${outer / 2}" r="${diameter / 2 + border}" fill="${borderColor}"/><circle cx="${outer / 2}" cy="${outer / 2}" r="${diameter / 2 + border - 1}" fill="none" stroke="${bgColor}" stroke-width="2"/></svg>`,
  )

  return sharp(ring)
    .composite([{ input: rounded, top: border, left: border }])
    .png()
    .toBuffer()
}
async function circleInset(input: Buffer, size: number, borderColor: string, crop?: NewsImageCrop): Promise<Buffer> {
  const insetCrop = crop
    ? await fitImageWithCrop(
        input,
        size,
        size,
        crop.insetFocusX,
        crop.insetFocusY,
        crop.insetZoom,
      )
    : await sharp(input)
        .resize(size, size, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 0.6, m1: 0.8, m2: 0.3 })
        .png()
        .toBuffer()

  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
  )

  const rounded = await sharp(insetCrop).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()

  const { border, outer } = insetOuterSize(size)
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
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5a6f8c"/>
        <stop offset="100%" stop-color="#2a3544"/>
      </linearGradient>
      <linearGradient id="curtain" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#5c1224"/>
        <stop offset="50%" stop-color="#922038"/>
        <stop offset="100%" stop-color="#4a0e1c"/>
      </linearGradient>
      <radialGradient id="spot" cx="50%" cy="35%" r="55%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${CANVAS_W}" height="${HERO_H}" fill="url(#sky)"/>
    <rect x="0" y="0" width="180" height="${HERO_H}" fill="url(#curtain)" opacity="0.85"/>
    <rect x="${CANVAS_W - 180}" y="0" width="180" height="${HERO_H}" fill="url(#curtain)" opacity="0.85"/>
    <rect width="${CANVAS_W}" height="${HERO_H}" fill="url(#spot)"/>
    <ellipse cx="360" cy="560" rx="130" ry="190" fill="#c4a484"/>
    <ellipse cx="360" cy="420" rx="72" ry="88" fill="#e8dcc8"/>
    <ellipse cx="720" cy="550" rx="118" ry="178" fill="#2a3a52"/>
    <ellipse cx="720" cy="410" rx="68" ry="82" fill="#d8cbb8"/>
    <rect x="280" y="680" width="520" height="140" fill="#1a2230" opacity="0.35"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function createSampleInsetBuffer(accentColor: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <defs>
      <linearGradient id="insetBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3d5268"/>
        <stop offset="100%" stop-color="#1a2430"/>
      </linearGradient>
    </defs>
    <rect width="400" height="400" fill="url(#insetBg)"/>
    <ellipse cx="200" cy="175" rx="88" ry="102" fill="#e8dcc8"/>
    <ellipse cx="200" cy="330" rx="120" ry="95" fill="${accentColor}" opacity="0.35"/>
    <ellipse cx="200" cy="330" rx="95" ry="72" fill="#243044"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

function buildHeroFadeOverlay(barTop: number, opacity = 0.5): Buffer {
  return Buffer.from(`<svg width="${CANVAS_W}" height="${barTop}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="50%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="${opacity}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${CANVAS_W}" height="${barTop}" fill="url(#heroFade)"/>
  </svg>`)
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
  pagePictureBuf?: Buffer | null
  layoutPreset?: string
  ctaText?: string
  imageCrop?: NewsImageCrop | null
  heroFadeOpacity?: number
}): Promise<Buffer> {
  const colors = parseColors(options.colorsJson)
  const fonts = parseFonts(options.fontsJson)
  const brandType = options.brandType ?? 'page_picture'
  const layoutPreset = normalizeLayoutPreset(options.layoutPreset ?? 'popcorn')
  const crop = options.imageCrop ?? parseImageCrop(null)

  const heroLayer = await fitImageWithCrop(
    options.heroBuf,
    CANVAS_W,
    HERO_H,
    crop.heroFocusX,
    crop.heroFocusY,
    crop.heroZoom,
  )

  const insetLayer = await circleInset(options.insetBuf, INSET_SIZE, colors.insetBorder, crop)
  const barTop = HERO_H
  const usePopcornLayout = isPopcornLayout(layoutPreset)
  const showInset = showInsetForLayout(layoutPreset)
  const insetY = usePopcornLayout ? popcornInsetTop(barTop) : HERO_H - INSET_SIZE - 48

  const brandSvg =
    brandType === 'page_name'
      ? buildBrandBadgeSvg(options.pageName ?? '', colors, fonts, barTop)
      : brandType === 'page_picture'
        ? buildPagePictureBrandSvg(options.pageName ?? '', colors, fonts, barTop)
        : ''
  const headlineSvg = buildHeadlineSvg(options.headline, options.accentWords, colors, fonts, barTop)
  const cta = options.ctaText?.trim() ?? ''
  const dividerLine = usePopcornLayout
    ? `<line x1="0" y1="${barTop}" x2="${CANVAS_W}" y2="${barTop}" stroke="${colors.text}" stroke-width="2"/>`
    : ''

  const overlaySvg = Buffer.from(`<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${barTop}" width="${CANVAS_W}" height="${CANVAS_H - barTop}" fill="${colors.barBg}"/>
    ${dividerLine}
    ${brandSvg}
    ${headlineSvg}
    ${cta ? `<text x="${CANVAS_W / 2}" y="${CANVAS_H - 36}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${fonts.ctaSize}" font-weight="700" fill="${colors.cta}">${escapeXml(cta.toUpperCase())}</text>` : ''}
  </svg>`)

  const heroFade = usePopcornLayout ? buildHeroFadeOverlay(barTop, options.heroFadeOpacity ?? 0.5) : null

  const composites: OverlayOptions[] = [{ input: heroLayer, top: 0, left: 0 }]
  if (heroFade) composites.push({ input: heroFade, top: 0, left: 0 })
  if (showInset) composites.push({ input: insetLayer, top: insetY, left: INSET_X })
  composites.push({ input: overlaySvg, top: 0, left: 0 })

  if (brandType === 'page_picture' && options.pagePictureBuf) {
    const badgeDiameter = BRAND_BADGE_R * 2
    const profileBadge = await circleProfilePicture(
      options.pagePictureBuf,
      badgeDiameter,
      colors.accent,
      colors.barBg,
    )
    const { outer } = insetOuterSize(badgeDiameter)
    composites.push({
      input: profileBadge,
      top: barTop - Math.round(outer / 2),
      left: Math.floor(CANVAS_W / 2 - outer / 2),
    })
  }

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
  pagePictureBuf?: Buffer | null
  layoutPreset?: string
  ctaText?: string
}): Promise<Buffer> {
  const headline = (options.headline?.trim() || TEMPLATE_PREVIEW_HEADLINE).toUpperCase()
  const accentWords = options.accentWords?.length ? options.accentWords : TEMPLATE_PREVIEW_ACCENT_WORDS

  const heroBuf = await createSampleHeroBuffer(parseColors(options.colorsJson).accent)
  const insetBuf = await createSampleInsetBuffer(parseColors(options.colorsJson).accent)

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
    pagePictureBuf: options.pagePictureBuf ?? null,
    layoutPreset: options.layoutPreset ?? 'popcorn',
    ctaText: options.ctaText ?? '',
    heroFadeOpacity: 0.32,
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
  pagePictureBuf?: Buffer | null
  layoutPreset?: string
  ctaText?: string
  outputPath: string
  heroLocalPath?: string
  insetLocalPath?: string
  rssTitle?: string
  imageCrop?: NewsImageCrop | null
}): Promise<string> {
  const heroBuf = options.heroLocalPath
    ? await fs.promises.readFile(options.heroLocalPath)
    : await downloadImageBuffer(upgradeImageUrl(options.heroUrl))
  if (!heroBuf) throw new Error('Could not download hero image')

  let insetBuf: Buffer
  if (options.insetLocalPath) {
    insetBuf = await fs.promises.readFile(options.insetLocalPath)
  } else if (options.insetUrl === options.heroUrl) {
    insetBuf = await sharp(heroBuf).extract({ left: 80, top: 80, width: 400, height: 400 }).toBuffer()
  } else {
    const downloaded = await downloadImageBuffer(upgradeImageUrl(options.insetUrl))
    insetBuf = downloaded ?? heroBuf
  }

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })

  const png = await renderNewsCanvas({
    heroBuf,
    insetBuf,
    headline: ensureSpacedHeadline(options.headline, options.rssTitle),
    accentWords: options.accentWords,
    colorsJson: options.colorsJson,
    fontsJson: options.fontsJson,
    brandType: parseBrandType(options.brandType),
    pageName: options.pageName,
    logoPath: options.logoPath,
    pagePictureBuf: options.pagePictureBuf ?? null,
    layoutPreset: options.layoutPreset ?? 'popcorn',
    ctaText: options.ctaText,
    imageCrop: options.imageCrop,
  })

  await fs.promises.writeFile(options.outputPath, png)
  return options.outputPath
}
