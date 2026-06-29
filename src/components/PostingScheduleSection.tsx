import { useEffect } from 'react'
import { Clock, Globe, Shuffle, SlidersHorizontal } from 'lucide-react'
import { COMMON_TIMEZONES } from '../config/timezones'
import {
  POSTING_SCHEDULE_OPTIONS,
  activeSchedulePreview,
  formatScheduleTimes,
  globalBestScheduleTimes,
  type PostingScheduleMode,
} from '../lib/postingSchedule'

const MODE_ICONS = {
  global: Globe,
  dailyrandom: Shuffle,
  fixed: SlidersHorizontal,
} as const

type Props = {
  postsPerDay: number
  onPostsPerDayChange: (n: number) => void
  scheduleMode: PostingScheduleMode
  onScheduleModeChange: (mode: PostingScheduleMode) => void
  timezone: string
  onTimezoneChange: (tz: string) => void
  customScheduleTimes: string
  onCustomScheduleTimesChange: (value: string) => void
}

export function PostsPerDayGrid({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Posts Per Day</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold uppercase ${
              value === n ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
            }`}
          >
            {n} {n === 1 ? 'post' : 'posts'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Selected: {value} post{value !== 1 ? 's' : ''} per day
      </p>
    </div>
  )
}

export function PostingScheduleSection({
  postsPerDay,
  onPostsPerDayChange,
  scheduleMode,
  onScheduleModeChange,
  timezone,
  onTimezoneChange,
  customScheduleTimes,
  onCustomScheduleTimesChange,
}: Props) {
  const previewTimes = activeSchedulePreview(scheduleMode, postsPerDay, customScheduleTimes)

  useEffect(() => {
    if (scheduleMode === 'fixed' && !customScheduleTimes.trim()) {
      onCustomScheduleTimesChange(formatScheduleTimes(globalBestScheduleTimes(postsPerDay)))
    }
  }, [scheduleMode, postsPerDay, customScheduleTimes, onCustomScheduleTimesChange])

  return (
    <div className="space-y-6">
      <PostsPerDayGrid value={postsPerDay} onChange={onPostsPerDayChange} />

      <div>
        <p className="mb-2 text-sm font-semibold">Posting schedule</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {POSTING_SCHEDULE_OPTIONS.map((option) => {
            const Icon = MODE_ICONS[option.id]
            const selected = scheduleMode === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onScheduleModeChange(option.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>
                    {option.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{option.hint}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Timezone</p>
        <select
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">
            {scheduleMode === 'dailyrandom' ? 'Daily publish windows' : 'Scheduled publish times'}
          </p>
        </div>

        {scheduleMode === 'dailyrandom' ? (
          <p className="text-xs text-muted-foreground">
            Random local times are generated automatically for {postsPerDay} post{postsPerDay !== 1 ? 's' : ''} each
            day. Change schedule mode to Global best times for peak engagement slots.
          </p>
        ) : scheduleMode === 'fixed' ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Enter comma-separated 24h times (e.g. 07:30, 12:00, 19:00). Count should match posts per day.
            </p>
            <input
              value={customScheduleTimes}
              onChange={(e) => onCustomScheduleTimesChange(e.target.value)}
              placeholder="07:30, 12:00, 19:00"
              className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Uses global peak Reels windows — morning, lunch, and evening — adjusted for {postsPerDay} post
            {postsPerDay !== 1 ? 's' : ''} per day in your timezone.
          </p>
        )}

        {scheduleMode !== 'dailyrandom' && previewTimes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {previewTimes.map((time) => (
              <span
                key={time}
                className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-xs font-medium text-primary"
              >
                {time}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
