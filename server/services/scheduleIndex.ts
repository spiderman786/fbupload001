import { normalizeHHMM } from '../utils/timezone.js'

function parseScheduleTimes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).map(normalizeHHMM) : []
  } catch {
    return []
  }
}

function minuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function utcNowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function formatLocalParts(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: normalizeHHMM(`${parts.hour}:${parts.minute}`),
  }
}

/** UTC TEXT (YYYY-MM-DD HH:MM:SS) for the next scheduled publish in page timezone. */
export function computeNextPublishAt(timezone: string, scheduleTimesJson: string, from = new Date()): string {
  const tz = timezone || 'America/New_York'
  const times = parseScheduleTimes(scheduleTimesJson)
  if (!times.length) return utcNowIso()

  const nowLocal = formatLocalParts(from, tz)
  const nowMin = minuteOfDay(nowLocal.hhmm)
  const sorted = [...times].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))
  const slot = sorted.find((t) => minuteOfDay(t) > nowMin) ?? sorted[0]!

  let targetYmd = nowLocal.ymd
  if (minuteOfDay(slot) <= nowMin) {
    const [y, mo, d] = targetYmd.split('-').map(Number)
    const next = new Date(Date.UTC(y!, mo! - 1, d! + 1))
    targetYmd = next.toISOString().slice(0, 10)
  }

  const start = from.getTime() - 60_000
  const end = from.getTime() + 48 * 60 * 60_000
  for (let t = start; t <= end; t += 60_000) {
    const cand = new Date(t)
    const local = formatLocalParts(cand, tz)
    if (local.ymd === targetYmd && local.hhmm === slot) {
      return cand.toISOString().slice(0, 19).replace('T', ' ')
    }
  }

  return utcNowIso()
}

export function scheduleTimesDueNow(timezone: string, scheduleTimesJson: string, at = new Date()): boolean {
  const local = formatLocalParts(at, timezone || 'America/New_York')
  const times = parseScheduleTimes(scheduleTimesJson)
  return times.includes(local.hhmm)
}

export function utcNowText(): string {
  return utcNowIso()
}

/** After a publish fires, bump next_publish_at to the following slot. */
export function computeNextPublishAfterFire(timezone: string, scheduleTimesJson: string, firedAt = new Date()): string {
  const after = new Date(firedAt.getTime() + 60_000)
  return computeNextPublishAt(timezone, scheduleTimesJson, after)
}
