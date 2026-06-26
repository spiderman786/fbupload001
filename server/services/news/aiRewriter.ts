import { pickAccentWords } from './contentFormatter.js'

export type AiRewriteResult = {
  headline: string
  accent_words: string[]
  post_title: string
  post_description: string
}

export async function maybeRewriteNewsContent(input: {
  rssTitle: string
  rssDescription: string
  aiTonePrompt?: string
}): Promise<AiRewriteResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null

  const tone = input.aiTonePrompt?.trim() || 'dramatic and engaging for social media'
  const prompt = `Rewrite this RSS article for a Facebook news graphic post.
Tone: ${tone}
Return JSON only with keys: headline (ALL CAPS, max 120 chars), post_title (sentence case), post_description (max 500 chars, no HTML), accent_words (array of 2-3 uppercase words from headline to highlight).

RSS title: ${input.rssTitle.slice(0, 300)}
RSS description: ${input.rssDescription.slice(0, 800)}`

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
          { role: 'system', content: 'You write punchy Facebook news headlines. Respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      error?: { message?: string }
    }
    if (!res.ok) {
      console.warn('[news] AI rewrite failed:', data.error?.message ?? res.status)
      return null
    }

    const raw = data.choices?.[0]?.message?.content
    if (!raw) return null

    const parsed = JSON.parse(raw) as {
      headline?: string
      post_title?: string
      post_description?: string
      accent_words?: string[]
    }

    const headline = String(parsed.headline ?? input.rssTitle).toUpperCase().slice(0, 120)
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
  } catch (err) {
    console.warn('[news] AI rewrite error:', err instanceof Error ? err.message : err)
    return null
  }
}
