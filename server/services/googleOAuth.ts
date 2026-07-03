import { buildGoogleOAuthCallbackUrl } from '../utils/appUrls.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export type GoogleProfile = {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  given_name?: string
  family_name?: string
  picture?: string
}

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
}

function googleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(googleClientId() && googleClientSecret())
}

export function buildGoogleConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: buildGoogleOAuthCallbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: buildGoogleOAuthCallbackUrl(),
      grant_type: 'authorization_code',
    }),
  })

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string }
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || 'Google token exchange failed')
  }

  const profileRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  })
  const profile = (await profileRes.json().catch(() => ({}))) as Partial<GoogleProfile> & { error_description?: string }
  if (!profileRes.ok || !profile.sub || !profile.email) {
    throw new Error(profile.error_description || 'Could not read Google profile')
  }

  return profile as GoogleProfile
}
