import type { FormattedNewsContent } from './types.js'
import { parseJsonArray } from './types.js'

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function pickAccentWords(headline: string, max = 3): string[] {
  const stop = new Set(['THE', 'AND', 'FOR', 'WHO', 'WAS', 'ARE', 'WITH', 'FROM', 'THAT', 'THIS', 'AFTER', 'WHAT'])
  const words = headline
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z0-9']/g, ''))
    .filter((w) => w.length >= 4 && !stop.has(w))

  if (words.length === 0) return []
  if (words.length <= max) return [...new Set(words)]

  const picks = new Set<string>([
    words[0]!,
    words[Math.floor(words.length / 2)]!,
    words[words.length - 1]!,
  ])
  const longest = [...words].sort((a, b) => b.length - a.length)[0]!
  picks.add(longest)

  return [...picks].slice(0, max)
}

export function formatNewsContent(input: {
  rssTitle: string
  rssDescription: string
  defaultHashtags?: string[]
}): FormattedNewsContent {
  const post_title = input.rssTitle.trim()
  const post_description = stripHtml(input.rssDescription).slice(0, 500)
  const headline = post_title.toUpperCase().slice(0, 120)
  const accent_words = pickAccentWords(headline)
  const hashtags = input.defaultHashtags ?? []

  return {
    headline,
    accent_words,
    post_title,
    post_description,
    hashtags,
  }
}

export function buildCaption(content: FormattedNewsContent): string {
  const parts = [content.post_title]
  if (content.post_description) parts.push('', content.post_description)
  if (content.hashtags.length) parts.push('', content.hashtags.join(' '))
  return parts.join('\n').trim()
}

export function mergeHashtags(defaultRaw: string | null, extra: string[]): string[] {
  const base = parseJsonArray(defaultRaw)
  return [...new Set([...base, ...extra])]
}
