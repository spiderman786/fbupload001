export const TOKEN_COST_PKR = 0.5

export const PLATFORM_TOKEN_RATES: Record<string, number> = {
  instagram: 1,
  tiktok: 2,
  youtube: 2,
  facebook: 2,
}

export function tokensForPlatform(platform: string): number {
  return PLATFORM_TOKEN_RATES[platform] ?? 2
}

export function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function isGmail(email: string): boolean {
  return /@gmail\.com$/i.test(email.trim())
}
