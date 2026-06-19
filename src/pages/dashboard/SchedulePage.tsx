import { useEffect, useState, type FormEvent } from 'react'
import { Clock, Plus, Sparkles, Trash2 } from 'lucide-react'
import { api, type EngagementPreset, type FacebookPage, type ScheduleSlot } from '../../api/client'
import { StatusBadge } from '../../components/StatusBadge'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'
import {
  USA_TIMEZONE_LABEL,
  getCurrentUsEasternTime,
  getEngagementLabel,
  getEngagementPeak,
  getPeakBadgeClass,
} from '../../config/usaEngagementTimes'

export function SchedulePage({
  publishMode = 'direct',
  title = 'Schedule',
  description = 'Set posting times for automated reel publishing across your pages.',
}: {
  publishMode?: 'direct' | 'inapp'
  title?: string
  description?: string
}) {
  const toast = useToast()
  const [slots, setSlots] = useState<ScheduleSlot[]>([])
  const [presets, setPresets] = useState<EngagementPreset[]>([])
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [currentEtTime, setCurrentEtTime] = useState(getCurrentUsEasternTime())
  const [loading, setLoading] = useState(true)
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [time, setTime] = useState('09:00')
  const [selectedPages, setSelectedPages] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const [{ slots: s, currentTime }, { presets: p }, { pages: pg }] = await Promise.all([
        api.schedule.list(publishMode),
        api.schedule.presets(),
        api.pages.list(),
      ])
      setSlots(s)
      setPresets(p)
      setPages(pg)
      setCurrentEtTime(currentTime)
    } catch (err) {
      const msg = getApiError(err, 'Failed to load schedule')
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [publishMode])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentEtTime(getCurrentUsEasternTime()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const { slot } = await api.schedule.create({
        time,
        pageIds: selectedPages,
        publishMode,
        timezone: 'America/New_York',
      })
      setSlots((prev) => [...prev, slot].sort((a, b) => a.time.localeCompare(b.time)))
      setShowForm(false)
      setTime('09:00')
      setSelectedPages([])
      toast.success(`Schedule slot added for ${time} ET`)
    } catch (err) {
      const msg = getApiError(err, 'Failed to add slot')
      setError(msg)
      toast.error(msg)
    }
  }

  async function handleApplyPreset(preset: EngagementPreset) {
    const replace = slots.length === 0 || confirm(`Replace your ${slots.length} existing slot(s) with "${preset.name}"?`)
    if (!replace) return

    setApplyingPreset(preset.id)
    try {
      const res = await api.schedule.applyPreset({
        presetId: preset.id,
        publishMode,
        pageIds: selectedPages.length ? selectedPages : undefined,
        replace: true,
      })
      setSlots(res.slots.sort((a, b) => a.time.localeCompare(b.time)))
      toast.success(res.message)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to apply preset'))
    } finally {
      setApplyingPreset(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this time slot?')) return
    try {
      await api.schedule.delete(id)
      setSlots((prev) => prev.filter((s) => s.id !== id))
      toast.success('Schedule slot removed')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove slot'))
    }
  }

  function togglePage(id: string) {
    setSelectedPages((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {USA_TIMEZONE_LABEL} · now {currentEtTime}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Time Slot
        </button>
      </div>

      <section className="marketing-card space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">USA peak engagement presets</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          One-click schedules tuned for US Facebook / Reels engagement windows ({USA_TIMEZONE_LABEL}). Match preset size
          to your page daily reel limit (6 or 12/day).
        </p>
        {pages.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Assign to pages (optional — all active if none)</label>
            <div className="flex flex-wrap gap-2">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => togglePage(page.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    selectedPages.includes(page.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                  }`}
                >
                  {page.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {presets.map((preset) => (
            <div key={preset.id} className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="font-medium">{preset.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {preset.slots.map((s) => (
                  <span key={s.time} className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {s.time}
                  </span>
                ))}
              </div>
              <button
                type="button"
                disabled={applyingPreset !== null}
                onClick={() => handleApplyPreset(preset)}
                className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {applyingPreset === preset.id ? 'Applying…' : `Apply ${preset.reelsPerDay} slots`}
              </button>
            </div>
          ))}
        </div>
      </section>

      {showForm && (
        <form onSubmit={handleSubmit} className="marketing-card space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Time ({USA_TIMEZONE_LABEL}, 24h)</label>
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          {pages.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Assign pages (optional — all active if none selected)</label>
              <div className="flex flex-wrap gap-2">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => togglePage(page.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      selectedPages.includes(page.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                    }`}
                  >
                    {page.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Save
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadError && !loading && slots.length === 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : slots.length === 0 ? (
        <div className="marketing-card py-12 text-center text-muted-foreground">
          No schedule slots yet. Apply a USA peak preset above or add a custom time.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {slots.map((slot) => {
            const label = slot.engagementLabel ?? getEngagementLabel(slot.time)
            const peak = getEngagementPeak(slot.time)
            return (
              <div key={slot.id} className="marketing-card relative text-center">
                <button
                  onClick={() => handleDelete(slot.id)}
                  className="absolute top-3 right-3 rounded-lg border border-border p-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <p className="font-mono text-2xl font-bold">{slot.time}</p>
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">ET</p>
                {label && (
                  <p className="mt-1 text-xs font-medium text-foreground">{label}</p>
                )}
                {peak && (
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${getPeakBadgeClass(peak)}`}>
                    {peak}
                  </span>
                )}
                <p className="mt-2 text-sm text-muted-foreground">{slot.pageCount} pages</p>
                <div className="mt-3">
                  <StatusBadge status={slot.status} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
