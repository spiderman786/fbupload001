import { db } from '../../db.js'

export type AiProvider = 'gemini' | 'openai' | 'auto'

export type AgencyAiSettingsPublic = {
  provider: AiProvider
  geminiConfigured: boolean
  openaiConfigured: boolean
  aiAvailable: boolean
  envGemini: boolean
  envOpenai: boolean
}

type AgencyAiRow = {
  agency_id: string
  gemini_api_key: string | null
  openai_api_key: string | null
  ai_provider: string
}

function normalizeProvider(value: string | null | undefined): AiProvider {
  if (value === 'openai' || value === 'gemini' || value === 'auto') return value
  return 'gemini'
}

function maskKeyHint(key: string | null | undefined): boolean {
  return Boolean(key?.trim())
}

export function getAgencyAiSettingsPublic(agencyId: string): AgencyAiSettingsPublic {
  const row = db
    .prepare('SELECT gemini_api_key, openai_api_key, ai_provider FROM agency_ai_settings WHERE agency_id = ?')
    .get(agencyId) as Pick<AgencyAiRow, 'gemini_api_key' | 'openai_api_key' | 'ai_provider'> | undefined

  const envGemini = maskKeyHint(process.env.GEMINI_API_KEY)
  const envOpenai = maskKeyHint(process.env.OPENAI_API_KEY)
  const geminiConfigured = maskKeyHint(row?.gemini_api_key) || envGemini
  const openaiConfigured = maskKeyHint(row?.openai_api_key) || envOpenai
  const provider = normalizeProvider(row?.ai_provider ?? process.env.AI_PROVIDER)

  return {
    provider,
    geminiConfigured,
    openaiConfigured,
    envGemini,
    envOpenai,
    aiAvailable: geminiConfigured || openaiConfigured,
  }
}

export function saveAgencyAiSettings(
  agencyId: string,
  input: {
    provider?: AiProvider
    geminiApiKey?: string | null
    openaiApiKey?: string | null
  },
): AgencyAiSettingsPublic {
  const existing = db
    .prepare('SELECT * FROM agency_ai_settings WHERE agency_id = ?')
    .get(agencyId) as AgencyAiRow | undefined

  const geminiKey =
    input.geminiApiKey === undefined
      ? (existing?.gemini_api_key ?? null)
      : input.geminiApiKey?.trim()
        ? input.geminiApiKey.trim()
        : null

  const openaiKey =
    input.openaiApiKey === undefined
      ? (existing?.openai_api_key ?? null)
      : input.openaiApiKey?.trim()
        ? input.openaiApiKey.trim()
        : null

  const provider = input.provider ?? normalizeProvider(existing?.ai_provider)

  db.prepare(`
    INSERT INTO agency_ai_settings (agency_id, gemini_api_key, openai_api_key, ai_provider, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(agency_id) DO UPDATE SET
      gemini_api_key = excluded.gemini_api_key,
      openai_api_key = excluded.openai_api_key,
      ai_provider = excluded.ai_provider,
      updated_at = datetime('now')
  `).run(agencyId, geminiKey, openaiKey, provider)

  return getAgencyAiSettingsPublic(agencyId)
}

export function resolveAiCredentials(agencyId?: string): {
  provider: AiProvider
  geminiKey: string | null
  openaiKey: string | null
} {
  const row = agencyId
    ? (db
        .prepare('SELECT gemini_api_key, openai_api_key, ai_provider FROM agency_ai_settings WHERE agency_id = ?')
        .get(agencyId) as Pick<AgencyAiRow, 'gemini_api_key' | 'openai_api_key' | 'ai_provider'> | undefined)
    : undefined

  const geminiKey = row?.gemini_api_key?.trim() || process.env.GEMINI_API_KEY?.trim() || null
  const openaiKey = row?.openai_api_key?.trim() || process.env.OPENAI_API_KEY?.trim() || null
  const provider = normalizeProvider(row?.ai_provider ?? process.env.AI_PROVIDER)

  return { provider, geminiKey, openaiKey }
}
