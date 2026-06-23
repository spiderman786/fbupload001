export const DEFAULT_SCHEDULE_TIMEZONE = process.env.SCHEDULE_TIMEZONE ?? 'America/New_York'

export function getCurrentTimeHHMM(timezone: string = DEFAULT_SCHEDULE_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
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
