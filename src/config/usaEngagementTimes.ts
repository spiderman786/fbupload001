export type EngagementSlot = {
  time: string
  label: string
  peak: 'morning' | 'midday' | 'afternoon' | 'evening' | 'prime'
}

export type EngagementPreset = {
  id: string
  name: string
  description: string
  reelsPerDay: number
  timezone: string
  timezoneLabel: string
  slots: EngagementSlot[]
}

export const USA_TIMEZONE = 'America/New_York'
export const USA_TIMEZONE_LABEL = 'US Eastern (ET)'

export const USA_ENGAGEMENT_PRESETS: EngagementPreset[] = [
  {
    id: 'usa-6',
    name: '6 reels/day — USA peaks',
    description: 'Morning commute, lunch, afternoon, after work, and prime evening (ET). Matches default 6/day limit.',
    reelsPerDay: 6,
    timezone: USA_TIMEZONE,
    timezoneLabel: USA_TIMEZONE_LABEL,
    slots: [
      { time: '07:30', label: 'Early morning scroll', peak: 'morning' },
      { time: '09:00', label: 'Morning peak', peak: 'morning' },
      { time: '12:00', label: 'Lunch break', peak: 'midday' },
      { time: '15:00', label: 'Afternoon break', peak: 'afternoon' },
      { time: '18:30', label: 'After work / commute', peak: 'evening' },
      { time: '21:00', label: 'Prime evening Reels', peak: 'prime' },
    ],
  },
  {
    id: 'usa-12',
    name: '12 reels/day — USA peaks',
    description: 'Twelve slots spread across full US waking hours for max reach (ET).',
    reelsPerDay: 12,
    timezone: USA_TIMEZONE,
    timezoneLabel: USA_TIMEZONE_LABEL,
    slots: [
      { time: '07:00', label: 'Early birds', peak: 'morning' },
      { time: '08:30', label: 'Morning commute', peak: 'morning' },
      { time: '10:00', label: 'Mid-morning', peak: 'morning' },
      { time: '11:30', label: 'Pre-lunch', peak: 'midday' },
      { time: '13:00', label: 'Lunch hour', peak: 'midday' },
      { time: '14:30', label: 'Afternoon lull', peak: 'afternoon' },
      { time: '16:00', label: 'School / work break', peak: 'afternoon' },
      { time: '17:30', label: 'Commute home', peak: 'evening' },
      { time: '19:00', label: 'Dinner scroll', peak: 'evening' },
      { time: '20:00', label: 'Prime time start', peak: 'prime' },
      { time: '21:30', label: 'Peak Reels hour', peak: 'prime' },
      { time: '22:30', label: 'Late night wind-down', peak: 'prime' },
    ],
  },
]

const PEAK_COLORS: Record<EngagementSlot['peak'], string> = {
  morning: 'bg-amber-100 text-amber-800',
  midday: 'bg-sky-100 text-sky-800',
  afternoon: 'bg-violet-100 text-violet-800',
  evening: 'bg-orange-100 text-orange-800',
  prime: 'bg-rose-100 text-rose-800',
}

export function getEngagementLabel(time: string): string | null {
  for (const preset of USA_ENGAGEMENT_PRESETS) {
    const slot = preset.slots.find((s) => s.time === time)
    if (slot) return slot.label
  }
  return null
}

export function getEngagementPeak(time: string): EngagementSlot['peak'] | null {
  for (const preset of USA_ENGAGEMENT_PRESETS) {
    const slot = preset.slots.find((s) => s.time === time)
    if (slot) return slot.peak
  }
  return null
}

export function getPeakBadgeClass(peak: EngagementSlot['peak']): string {
  return PEAK_COLORS[peak]
}

export function getCurrentUsEasternTime(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: USA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}
