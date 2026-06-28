import { pickAccentWords } from './contentFormatter.js'
import { resolveAiCredentials, type AiProvider } from './aiSettings.js'

export type AiRewriteResult = {
  headline: string
  accent_words: string[]
  post_title: string
  post_description: string
}

export type ImageHeadlineResult = {
  headline: string
  accent_words: string[]
}

function hasAiConfigured(agencyId?: string): boolean {
  const { geminiKey, openaiKey } = resolveAiCredentials(agencyId)
  return Boolean(geminiKey || openaiKey)
}

async function callGeminiJson(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    })

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      error?: { message?: string }
    }
    if (!res.ok) {
      console.warn('[news] Gemini request failed:', data.error?.message ?? res.status)
      return null
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    console.warn('[news] Gemini request error:', err instanceof Error ? err.message : err)
    return null
  }
}

async function callOpenAiJson(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }
    if (!res.ok) {
      console.warn('[news] OpenAI request failed:', data.error?.message ?? res.status)
      return null
    }

    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null
    return JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    console.warn('[news] OpenAI request error:', err instanceof Error ? err.message : err)
    return null
  }
}

function providerOrder(provider: AiProvider, geminiKey: string | null, openaiKey: string | null): ('gemini' | 'openai')[] {
  const available: ('gemini' | 'openai')[] = []
  if (geminiKey) available.push('gemini')
  if (openaiKey) available.push('openai')
  if (available.length === 0) return []

  if (provider === 'gemini') {
    return geminiKey ? ['gemini', ...(openaiKey ? ['openai' as const] : [])] : ['openai']
  }
  if (provider === 'openai') {
    return openaiKey ? ['openai', ...(geminiKey ? ['gemini' as const] : [])] : ['gemini']
  }
  // auto — prefer Gemini (free/cheap tier)
  return geminiKey ? ['gemini', ...(openaiKey ? ['openai' as const] : [])] : ['openai']
}

async function callAiJson(prompt: string, system: string, agencyId?: string): Promise<Record<string, unknown> | null> {
  const { provider, geminiKey, openaiKey } = resolveAiCredentials(agencyId)
  const order = providerOrder(provider, geminiKey, openaiKey)

  for (const backend of order) {
    const parsed =
      backend === 'gemini' && geminiKey
        ? await callGeminiJson(prompt, system, geminiKey)
        : backend === 'openai' && openaiKey
          ? await callOpenAiJson(prompt, system, openaiKey)
          : null
    if (parsed) return parsed
  }

  return null
}

/** Short punchy ALL CAPS headline sized for the on-image template (3–4 lines max). */
export async function adaptHeadlineForImageGraphic(input: {
  rssTitle: string
  rssDescription?: string
  aiTonePrompt?: string
  agencyId?: string
}): Promise<ImageHeadlineResult | null> {
  if (!hasAiConfigured(input.agencyId)) return null

  const tone = input.aiTonePrompt?.trim() || 'dramatic, punchy tabloid style for Facebook'
  const prompt = `Rewrite this news title for a Facebook image graphic overlay.
Tone: ${tone}

Rules for headline:
- ALL CAPS
- Maximum 70 characters total
- Short, scannable, no filler (remove "who was", "what to know", etc. when possible)
- Must read well split across 3–4 lines on a phone screen
- Keep names, show titles, and key facts

Return JSON only:
{
  "headline": "SHORT ALL CAPS HEADLINE",
  "accent_words": ["WORD1", "WORD2"]
}
accent_words: 2–3 important words from the headline to highlight in color (nouns/verbs, not THE/AND/WAS).

RSS title: ${input.rssTitle.slice(0, 300)}
RSS description: ${(input.rssDescription ?? '').slice(0, 400)}`

  const parsed = await callAiJson(prompt, 'You write ultra-short Facebook news graphic headlines. JSON only.', input.agencyId)
  if (!parsed) return null

  const headline = String(parsed.headline ?? input.rssTitle).toUpperCase().slice(0, 80)
  const accent_words =
    Array.isArray(parsed.accent_words) && parsed.accent_words.length
      ? parsed.accent_words.map((w) => String(w).toUpperCase()).slice(0, 4)
      : pickAccentWords(headline)

  return { headline, accent_words }
}

export async function maybeRewriteNewsContent(input: {
  rssTitle: string
  rssDescription: string
  aiTonePrompt?: string
  agencyId?: string
}): Promise<AiRewriteResult | null> {
  if (!hasAiConfigured(input.agencyId)) return null

  const tone = input.aiTonePrompt?.trim() || 'dramatic and engaging for social media'
  const prompt = `Rewrite this RSS article for a Facebook news post.
Tone: ${tone}
Return JSON only with keys: headline (ALL CAPS, max 80 chars, short for image overlay), post_title (sentence case, engaging), post_description (max 500 chars, no HTML), accent_words (array of 2-3 uppercase words from headline to highlight).

RSS title: ${input.rssTitle.slice(0, 300)}
RSS description: ${input.rssDescription.slice(0, 800)}`

  const parsed = await callAiJson(prompt, 'You write punchy Facebook news headlines. Respond with valid JSON only.', input.agencyId)
  if (!parsed) return null

  const headline = String(parsed.headline ?? input.rssTitle).toUpperCase().slice(0, 80)
  const accent_words =
    Array.isArray(parsed.accent_words) && parsed.accent_words.length
      ? parsed.accent_words.map((w) => String(w).toUpperCase()).slice(0, 4)
      : pickAccentWords(headline)

  return {
    headline,
    accent_words,
    post_title: String(parsed.post_title ?? input.rssTitle).trim().slice(0, 300),
    post_description: String(parsed.post_description ?? input.rssDescription).trim().slice(0, 500),
  }
}
