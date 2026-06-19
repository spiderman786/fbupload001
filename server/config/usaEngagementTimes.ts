import { DEFAULT_SCHEDULE_TIMEZONE } from '../utils/timezone.js'

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

/** USA peak engagement windows (Eastern Time) — aligned with Facebook / Reels best-practice research. */
export const USA_ENGAGEMENT_PRESETS: EngagementPreset[] = [
  {
    id: 'usa-6',
    name: '6 reels/day — USA peaks',
    description: 'Morning commute, lunch, afternoon, after work, and prime evening (ET). Matches default 6/day limit.',
    reelsPerDay: 6,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    timezoneLabel: 'US Eastern (ET)',
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
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    timezoneLabel: 'US Eastern (ET)',
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

export function getEngagementPreset(id: string): EngagementPreset | undefined {
  return USA_ENGAGEMENT_PRESETS.find((p) => p.id === id)
}

export function getEngagementLabel(time: string): string | null {
  for (const preset of USA_ENGAGEMENT_PRESETS) {
    const slot = preset.slots.find((s) => s.time === time)
    if (slot) return slot.label
  }
  return null
}
