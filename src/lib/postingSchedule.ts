import { USA_ENGAGEMENT_PRESETS } from '../config/usaEngagementTimes'

export type PostingScheduleMode = 'dailyrandom' | 'global' | 'fixed'

export const POSTING_SCHEDULE_OPTIONS: { id: PostingScheduleMode; label: string; hint: string }[] = [
  {
    id: 'global',
    label: 'Global best times',
    hint: 'Peak Reels windows — morning, lunch, and evening in your timezone',
  },
  {
    id: 'dailyrandom',
    label: 'Random daily',
    hint: 'New random publish times each day',
  },
  {
    id: 'fixed',
    label: 'Custom fixed',
    hint: 'Set exact local times yourself',
  },
]

/** Global engagement windows scaled to posts-per-day (1–12). */
export function globalBestScheduleTimes(count: number): string[] {
  const n = Math.max(1, Math.min(12, Math.floor(count)))
  const usa6 = USA_ENGAGEMENT_PRESETS.find((p) => p.id === 'usa-6')!.slots.map((s) => s.time)
  const usa12 = USA_ENGAGEMENT_PRESETS.find((p) => p.id === 'usa-12')!.slots.map((s) => s.time)

  if (n === 6) return [...usa6]
  if (n === 12) return [...usa12]
  if (n <= usa6.length) {
    const picks = [0, 1, 2, 3, 4, 5].slice(0, n)
    if (n === 1) return [usa6[2]!]
    if (n === 2) return [usa6[0]!, usa6[5]!]
    if (n === 3) return [usa6[0]!, usa6[2]!, usa6[5]!]
    if (n === 4) return [usa6[0]!, usa6[2]!, usa6[4]!, usa6[5]!]
    if (n === 5) return [usa6[0]!, usa6[1]!, usa6[2]!, usa6[4]!, usa6[5]!]
    return picks.map((i) => usa6[i]!)
  }

  return usa12.slice(0, n)
}

export function parseScheduleTimesInput(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export function formatScheduleTimes(times: string[]): string {
  return times.join(', ')
}

export function postingScheduleLabel(mode: PostingScheduleMode): string {
  return POSTING_SCHEDULE_OPTIONS.find((o) => o.id === mode)?.label ?? mode
}

export function resolveScheduleTimesForSave(
  mode: PostingScheduleMode,
  postsPerDay: number,
  customTimesText: string,
): { postingLogic: 'dailyrandom' | 'fixed'; scheduleTimes?: string[]; regenerateRandomTimes?: boolean } {
  if (mode === 'dailyrandom') {
    return { postingLogic: 'dailyrandom', regenerateRandomTimes: true }
  }
  if (mode === 'global') {
    return { postingLogic: 'fixed', scheduleTimes: globalBestScheduleTimes(postsPerDay) }
  }
  return { postingLogic: 'fixed', scheduleTimes: parseScheduleTimesInput(customTimesText) }
}

export function activeSchedulePreview(
  mode: PostingScheduleMode,
  postsPerDay: number,
  customTimesText: string,
): string[] {
  if (mode === 'global') return globalBestScheduleTimes(postsPerDay)
  if (mode === 'fixed') return parseScheduleTimesInput(customTimesText)
  return globalBestScheduleTimes(postsPerDay)
}
