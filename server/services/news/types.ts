export type NewsColors = {
  accent: string
  text: string
  barBg: string
  cta: string
  insetBorder: string
}

export type NewsFonts = {
  headlineSize: number
  textSize?: number
  ctaSize: number
  pageNameSize?: number
}

export type NewsBrandType = 'page_picture' | 'page_name' | 'logo' | 'none'

export type NewsTemplate = {
  id: string
  agency_id: string
  name: string
  layout_preset: string
  colors_json: string
  fonts_json: string
  logo_path: string | null
  cta_text: string
  default_hashtags_json: string
  ai_tone_prompt: string
}

export type PageNewsSettings = {
  page_id: string
  agency_id: string
  template_id: string | null
  auto_publish: number
  posts_per_day: number
  schedule_times: string
  timezone: string
  comment_link_enabled: number
  include_link_in_caption: number
  ai_rewrite_enabled: number
  default_hashtags_json: string
  schedule_offset_minutes: number
  is_active: number
}

export type FormattedNewsContent = {
  headline: string
  accent_words: string[]
  post_title: string
  post_description: string
  hashtags: string[]
}

export const DEFAULT_COLORS: NewsColors = {
  accent: '#00D4FF',
  text: '#FFFFFF',
  barBg: '#000000',
  cta: '#AAAAAA',
  insetBorder: '#00D4FF',
}

export const DEFAULT_FONTS: NewsFonts = {
  headlineSize: 50,
  textSize: 50,
  ctaSize: 20,
  pageNameSize: 15,
}

export const TEXT_SIZE_MIN = 1
export const TEXT_SIZE_MAX = 100
export const HEADLINE_PX_MIN = 28
export const HEADLINE_PX_MAX = 72

export function clampTextSize(value: number): number {
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(value)))
}

export function textSizeToHeadlinePx(textSize: number): number {
  const scale = clampTextSize(textSize)
  return Math.round(HEADLINE_PX_MIN + ((scale - TEXT_SIZE_MIN) / (TEXT_SIZE_MAX - TEXT_SIZE_MIN)) * (HEADLINE_PX_MAX - HEADLINE_PX_MIN))
}

export function headlinePxToTextSize(headlineSize: number): number {
  const px = Math.min(HEADLINE_PX_MAX, Math.max(HEADLINE_PX_MIN, Math.round(headlineSize)))
  return clampTextSize(
    TEXT_SIZE_MIN +
      ((px - HEADLINE_PX_MIN) / (HEADLINE_PX_MAX - HEADLINE_PX_MIN)) * (TEXT_SIZE_MAX - TEXT_SIZE_MIN),
  )
}

export function resolveFonts(raw: Partial<NewsFonts> | null | undefined): NewsFonts {
  const base = { ...DEFAULT_FONTS, ...raw }
  const textSize =
    typeof base.textSize === 'number'
      ? clampTextSize(base.textSize)
      : headlinePxToTextSize(base.headlineSize ?? DEFAULT_FONTS.headlineSize)
  const headlineSize = textSizeToHeadlinePx(textSize)
  return { ...base, textSize, headlineSize }
}

export function parseJsonArray(raw: string | null, fallback: string[] = []): string[] {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : fallback
  } catch {
    return fallback
  }
}

export function parseColors(raw: string | null): NewsColors {
  if (!raw) return DEFAULT_COLORS
  try {
    const parsed = JSON.parse(raw) as Partial<NewsColors>
    return { ...DEFAULT_COLORS, ...parsed }
  } catch {
    return DEFAULT_COLORS
  }
}

export function parseFonts(raw: string | null): NewsFonts {
  if (!raw) return resolveFonts(null)
  try {
    const parsed = JSON.parse(raw) as Partial<NewsFonts>
    return resolveFonts(parsed)
  } catch {
    return resolveFonts(null)
  }
}

export function parseBrandType(raw: string | null | undefined): NewsBrandType {
  if (raw === 'page_name' || raw === 'logo' || raw === 'none') return raw
  return 'page_picture'
}

export type NewsImageCrop = {
  heroFocusX: number
  heroFocusY: number
  heroZoom: number
  insetFocusX: number
  insetFocusY: number
  insetZoom: number
}

export const DEFAULT_NEWS_IMAGE_CROP: NewsImageCrop = {
  heroFocusX: 50,
  heroFocusY: 50,
  heroZoom: 1,
  insetFocusX: 50,
  insetFocusY: 50,
  insetZoom: 1,
}

function clampPercent(value: number, fallback = 50): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

function clampZoom(value: number, fallback = 1): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(3, Math.max(1, n))
}

export function parseImageCrop(raw: string | null | undefined): NewsImageCrop {
  if (!raw) return { ...DEFAULT_NEWS_IMAGE_CROP }
  try {
    const parsed = JSON.parse(raw) as Partial<NewsImageCrop>
    return {
      heroFocusX: clampPercent(parsed.heroFocusX ?? 50),
      heroFocusY: clampPercent(parsed.heroFocusY ?? 50),
      heroZoom: clampZoom(parsed.heroZoom ?? 1),
      insetFocusX: clampPercent(parsed.insetFocusX ?? 50),
      insetFocusY: clampPercent(parsed.insetFocusY ?? 50),
      insetZoom: clampZoom(parsed.insetZoom ?? 1),
    }
  } catch {
    return { ...DEFAULT_NEWS_IMAGE_CROP }
  }
}

export function normalizeArticleUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    u.hash = ''
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid'].forEach((k) =>
      u.searchParams.delete(k),
    )
    return u.toString()
  } catch {
    return url.trim()
  }
}
