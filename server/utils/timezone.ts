export const DEFAULT_SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE ?? 'America/New_York'

export function getCurrentTimeHHMM(timezone: string = DEFAULT_SCHEDULE_TIMEZONE): string {
  return normalizeHHMM(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
  )
}

/** Normalize schedule slot strings so "7:30" and "07:30" match reliably. */
export function normalizeHHMM(raw: string): string {
  const parts = raw.trim().split(':')
  if (parts.length < 2) return raw.trim()
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return raw.trim()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function getTodayDateInTimezone(timezone: string = DEFAULT_SCHEDULE_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function formatTimeInTimezone(time: string, timezone: string = DEFAULT_SCHEDULE_TIMEZONE): string {
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m)
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(utc))
  return label
}
