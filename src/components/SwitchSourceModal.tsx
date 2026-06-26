import { useEffect, useState } from 'react'
import { Music2, Share2, TvMinimalPlay, X } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'facebook', label: 'Facebook' },
] as const

type Platform = (typeof PLATFORMS)[number]['value']

function switchPlatformTitle(platform: string) {
  const p = platform.toLowerCase()
  if (p === 'tiktok') return 'Tiktok'
  if (p === 'youtube') return 'YouTube'
  if (p === 'facebook') return 'Facebook'
  if (p === 'instagram') return 'Instagram'
  return platform
}

function PlatformInputIcon({ platform, className }: { platform: string; className?: string }) {
  const p = platform.toLowerCase()
  if (p === 'tiktok') return <Music2 className={className} />
  if (p === 'youtube') return <TvMinimalPlay className={className} />
  return <Share2 className={className} />
}

function normalizeUsername(value: string) {
  return value.replace(/^@/, '').trim().toLowerCase()
}

type Props = {
  open: boolean
  pageId: string
  currentSource: { platform: string; username: string } | null | undefined
  onClose: () => void
  onComplete: () => void
}

export function SwitchSourceModal({ open, pageId, currentSource, onClose, onComplete }: Props) {
  const toast = useToast()
  const [platform, setPlatform] = useState<Platform>('tiktok')
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setPlatform((currentSource?.platform as Platform) ?? 'tiktok')
    setUsername(currentSource?.username?.replace(/^@/, '') ?? '')
  }, [open, currentSource?.platform, currentSource?.username])

  async function ensureSource(targetPlatform: string, rawUsername: string) {
    const clean = rawUsername.replace(/^@/, '').trim()
    if (!clean) throw new Error('Username is required')
    const existing = (await api.sources.list()).sources.find(
      (s) => s.platform === targetPlatform && normalizeUsername(s.username) === normalizeUsername(clean),
    )
    if (existing) return existing.id
    const { source } = await api.sources.create({ platform: targetPlatform, username: clean })
    return source.id
  }

  async function handleConfirm() {
    setSubmitting(true)
    try {
      const sourceId = await ensureSource(platform, username)
      await api.automation.assignSource(pageId, sourceId)
      toast.success('Source updated — queue will re-sync with new content')
      onComplete()
      onClose()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to switch source'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h3 className="font-display text-xl font-bold">Switch {switchPlatformTitle(platform)} Source</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Update the target source identity to re-sync the automation queue with new content.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm">
            <span className="font-medium">Source Platform</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium">New Target Identity</span>
            <div className="relative mt-1.5">
              <PlatformInputIcon platform={platform} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm"
              />
            </div>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !username.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Transitioning…' : 'Confirm Transition'}
          </button>
        </div>
      </div>
    </div>
  )
}
