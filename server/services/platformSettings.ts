import { db } from '../db.js'

export type PlatformFlag =
  | 'downloads_enabled'
  | 'publishing_enabled'
  | 'auto_retry_enabled'
  | 'maintenance_mode'
  | 'self_healing_enabled'

const DEFAULTS: Record<PlatformFlag, string> = {
  downloads_enabled: 'true',
  publishing_enabled: 'true',
  auto_retry_enabled: process.env.OPS_AUTO_RETRY_ENABLED ?? 'true',
  maintenance_mode: 'false',
  self_healing_enabled: 'true',
}

export function getPlatformSetting(key: PlatformFlag): string {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? DEFAULTS[key]
}

export function isPlatformFlagEnabled(key: PlatformFlag): boolean {
  return getPlatformSetting(key) !== 'false'
}

export function setPlatformSetting(key: PlatformFlag, value: string) {
  db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

export function getAllPlatformSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM platform_settings').all() as { key: string; value: string }[]
  const out = { ...DEFAULTS } as Record<string, string>
  for (const row of rows) out[row.key] = row.value
  return out
}

export function isAgencyInMaintenance(agencyId: string): boolean {
  if (getPlatformSetting('maintenance_mode') === 'true') return true
  const agency = db.prepare('SELECT maintenance_mode FROM agencies WHERE id = ?').get(agencyId) as
    | { maintenance_mode: number }
    | undefined
  return Boolean(agency?.maintenance_mode)
}

export function setAgencyMaintenance(agencyId: string, enabled: boolean) {
  db.prepare('UPDATE agencies SET maintenance_mode = ? WHERE id = ?').run(enabled ? 1 : 0, agencyId)
}
