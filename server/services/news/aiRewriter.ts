import { pickAccentWords } from './contentFormatter.js'
import { fitHeadlineToTemplate, normalizeHeadlineText, precheckHeadlineForTemplate } from './imageCompositor.js'
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

export type AiProviderTestResult = {
  provider: 'gemini' | 'openai'
  ok: boolean
  model?: string
  headline?: string
  error?: string
}

export type AiConnectionTestResult = {
  ok: boolean
  results: AiProviderTestResult[]
  sampleHeadline?: string
}

function hasAiConfigured(agencyId?: string): boolean {
  const { geminiKey, openaiKey } = resolveAiCredentials(agencyId)
  return Boolean(geminiKey || openaiKey)
}

function geminiModels(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim()
  const defaults = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']
  if (primary) return [primary, ...defaults.filter((m) => m !== primary)]
  return defaults
}

function isQuotaError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('quota') || lower.includes('rate limit') || lower.includes('resource exhausted')
}

async function callGeminiJsonDetailed(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<{ ok: true; data: Record<string, unknown>; model: string } | { ok: false; error: string; model?: string }> {
  let lastError = 'Gemini request failed'

  for (const model of geminiModels()) {
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
        error?: { message?: string; status?: string }
      }

      if (!res.ok) {
        lastError = data.error?.message ?? `HTTP ${res.status}`
        console.warn(`[news] Gemini request failed (${model}):`, lastError)
        if (!isQuotaError(lastError)) {
          return { ok: false, error: lastError, model }
        }
        continue
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!raw) {
        lastError = 'Gemini returned an empty response'
        continue
      }

      return { ok: true, data: JSON.parse(raw) as Record<string, unknown>, model }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[news] Gemini request error (${model}):`, lastError)
    }
  }

  return { ok: false, error: lastError }
}

async function callGeminiJson(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await callGeminiJsonDetailed(prompt, system, apiKey)
  return result.ok ? result.data : null
}

async function callOpenAiJsonDetailed(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<{ ok: true; data: Record<string, unknown>; model: string } | { ok: false; error: string; model?: string }> {
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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
      const error = data.error?.message ?? `HTTP ${res.status}`
      console.warn('[news] OpenAI request failed:', error)
      return { ok: false, error, model }
    }

    const raw = data.choices?.[0]?.message?.content
    if (!raw) return { ok: false, error: 'OpenAI returned an empty response', model }
    return { ok: true, data: JSON.parse(raw) as Record<string, unknown>, model }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[news] OpenAI request error:', error)
    return { ok: false, error }
  }
}

async function callOpenAiJson(
  prompt: string,
  system: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await callOpenAiJsonDetailed(prompt, system, apiKey)
  return result.ok ? result.data : null
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
  fontsJson?: string | null
}): Promise<ImageHeadlineResult | null> {
  if (!hasAiConfigured(input.agencyId)) return null

  const tone = input.aiTonePrompt?.trim() || 'dramatic, punchy tabloid style for Facebook'
  const buildPrompt = (extra = '') => `Rewrite this news title for a Facebook image graphic overlay.
Tone: ${tone}

Rules for headline:
- ALL CAPS, single line (spaces only — NO line breaks)
- Maximum 60 characters total
- Short, scannable, no filler (remove "who was", "what to know", etc. when possible)
- Must fit on 3–4 lines on a 1080px-wide phone graphic
- Keep names, show titles, and key facts
${extra}

Return JSON only:
{
  "headline": "SHORT ALL CAPS HEADLINE",
  "accent_words": ["WORD1", "WORD2"]
}
accent_words: 2–3 important words from the headline to highlight in color (nouns/verbs, not THE/AND/WAS).

RSS title: ${input.rssTitle.slice(0, 300)}
RSS description: ${(input.rssDescription ?? '').slice(0, 400)}`

  let parsed = await callAiJson(buildPrompt(), 'You write ultra-short Facebook news graphic headlines. JSON only.', input.agencyId)
  if (!parsed) return null

  let headline = normalizeHeadlineText(String(parsed.headline ?? input.rssTitle)).toUpperCase().slice(0, 80)
  let check = precheckHeadlineForTemplate(headline, input.fontsJson)

  if (!check.fits) {
    parsed = await callAiJson(
      buildPrompt(`Previous headline "${headline}" was too long (${check.lineCount} lines). Rewrite shorter — max 50 characters.`),
      'You write ultra-short Facebook news graphic headlines. JSON only.',
      input.agencyId,
    )
    if (parsed) {
      headline = normalizeHeadlineText(String(parsed.headline ?? headline)).toUpperCase().slice(0, 80)
      check = precheckHeadlineForTemplate(headline, input.fontsJson)
    }
  }

  if (!check.fits) {
    headline = fitHeadlineToTemplate(headline, input.fontsJson)
    check = precheckHeadlineForTemplate(headline, input.fontsJson)
  }

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

const TEST_PROMPT = `Rewrite this news title for a Facebook image graphic overlay.
Return JSON only: {"headline":"SHORT ALL CAPS HEADLINE","accent_words":["WORD1","WORD2"]}
Rules: ALL CAPS, max 70 characters, punchy tabloid style.

RSS title: Celebrity Couple Shocks Fans With Surprise Breakup After Three Years Together`
const TEST_SYSTEM = 'You write ultra-short Facebook news graphic headlines. JSON only.'

export async function testNewsAiConnection(agencyId: string): Promise<AiConnectionTestResult> {
  const { provider, geminiKey, openaiKey } = resolveAiCredentials(agencyId)
  const order = providerOrder(provider, geminiKey, openaiKey)
  const results: AiProviderTestResult[] = []

  if (order.length === 0) {
    return {
      ok: false,
      results: [{ provider: 'gemini', ok: false, error: 'No API key configured — add a Gemini or OpenAI key above.' }],
    }
  }

  for (const backend of order) {
    if (backend === 'gemini' && geminiKey) {
      const res = await callGeminiJsonDetailed(TEST_PROMPT, TEST_SYSTEM, geminiKey)
      if (!res.ok) {
        const fail = res as Extract<typeof res, { ok: false }>
        results.push({ provider: 'gemini', ok: false, model: fail.model, error: fail.error })
        continue
      }
      const headline = String(res.data.headline ?? '').toUpperCase().slice(0, 80)
      results.push({ provider: 'gemini', ok: true, model: res.model, headline })
      return { ok: true, results, sampleHeadline: headline }
    }

    if (backend === 'openai' && openaiKey) {
      const res = await callOpenAiJsonDetailed(TEST_PROMPT, TEST_SYSTEM, openaiKey)
      if (!res.ok) {
        const fail = res as Extract<typeof res, { ok: false }>
        results.push({ provider: 'openai', ok: false, model: fail.model, error: fail.error })
        continue
      }
      const headline = String(res.data.headline ?? '').toUpperCase().slice(0, 80)
      results.push({ provider: 'openai', ok: true, model: res.model, headline })
      return { ok: true, results, sampleHeadline: headline }
    }
  }

  return { ok: false, results }
}
