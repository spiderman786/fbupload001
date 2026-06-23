import { useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, Smartphone, Trash2 } from 'lucide-react'
import { api, type PageQueueItem } from '../api/client'
import { queuePlatformBadgeLabel, queuePlatformIcon } from '../lib/platformBadge'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

type Props = {
  pageId: string
  queue: PageQueueItem[]
  canWrite: boolean
  defaultHashtags?: string[]
  onRefresh: () => void
  refreshing?: boolean
}

function formatQueueTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function captionSnippet(caption: string | null | undefined, max = 72) {
  const text = (caption ?? '').trim()
  if (!text) return 'No caption yet'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function ReelsQueueWorkspace({ pageId, queue, canWrite, defaultHashtags = [], onRefresh, refreshing }: Props) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftCaption, setDraftCaption] = useState('')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)

  const selected = useMemo(() => queue.find((q) => q.id === selectedId) ?? queue[0] ?? null, [queue, selectedId])

  useEffect(() => {
    if (!queue.length) {
      setSelectedId(null)
      setDraftCaption('')
      return
    }
    if (!selectedId || !queue.some((q) => q.id === selectedId)) {
      setSelectedId(queue[0].id)
    }
  }, [queue, selectedId])

  useEffect(() => {
    setDraftCaption(selected?.caption ?? '')
  }, [selected?.id, selected?.caption])

  const thumbUrl = selected ? api.pages.queuePreviewUrl(pageId, selected.id, 'thumb') : null
  const videoUrl = selected?.hasPreview ? api.pages.queuePreviewUrl(pageId, selected.id, 'video') : null

  async function saveCaption() {
    if (!selected || !canWrite) return
    setSaving(true)
    try {
      await api.pages.updateQueueCaption(pageId, selected.id, draftCaption)
      toast.success('Caption saved')
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to save caption'))
    } finally {
      setSaving(false)
    }
  }

  async function skipReel() {
    if (!selected || !canWrite) return
    setActing(true)
    try {
      await api.pages.skipQueueItem(pageId, selected.id)
      toast.success('Skipped — next reel will pre-download')
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Skip failed'))
    } finally {
      setActing(false)
    }
  }

  async function deleteReel() {
    if (!selected || !canWrite) return
    if (!window.confirm('Remove this reel from the queue?')) return
    setActing(true)
    try {
      await api.pages.deleteQueueItem(pageId, selected.id)
      toast.success('Removed from queue')
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Delete failed'))
    } finally {
      setActing(false)
    }
  }

  function appendHashtag(tag: string) {
    const normalized = tag.startsWith('#') ? tag : `#${tag}`
    setDraftCaption((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return normalized
      if (trimmed.includes(normalized)) return prev
      return `${trimmed} ${normalized}`
    })
  }

  const quickTags = defaultHashtags.length
    ? defaultHashtags
    : ['#reels', '#viral', '#trending', '#foryou', '#shorts']

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Downloaded Queue</h2>
            <p className="text-sm text-muted-foreground">
              View, edit captions, skip or purge reels from the automatic publication queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            {queue.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {queue.map((item) => {
                  const active = selected?.id === item.id
                  const PlatformIcon = queuePlatformIcon(item.sourcePlatform)
                  const badge = queuePlatformBadgeLabel(item.sourcePlatform)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`group relative overflow-hidden rounded-xl border text-left transition ${
                        active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div className="relative aspect-[9/16] bg-muted">
                        {item.hasThumbnail ? (
                          <img
                            src={api.pages.queuePreviewUrl(pageId, item.id, 'thumb')}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                            No preview
                          </div>
                        )}
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          <PlatformIcon className="h-3 w-3" />
                          {badge}
                        </span>
                        {active ? (
                          <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-white">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8">
                          <p className="line-clamp-2 text-[11px] leading-snug text-white">{captionSnippet(item.caption, 56)}</p>
                          <p className="mt-1 text-[10px] text-white/70">{formatQueueTime(item.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
                <div>
                  <p className="font-medium">Queue is empty</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Reels pre-download in the background when automation is active and a source is assigned.
                  </p>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Smartphone className="h-4 w-4 text-primary" />
                Interactive Workspace
              </div>
              <div className="mx-auto w-[220px] rounded-[2rem] border-[6px] border-foreground/90 bg-black p-2 shadow-lg">
                <div className="overflow-hidden rounded-[1.4rem] bg-black">
                  {selected && videoUrl ? (
                    <video
                      key={videoUrl}
                      src={videoUrl}
                      poster={thumbUrl ?? undefined}
                      className="aspect-[9/16] w-full object-cover"
                      controls
                      playsInline
                      muted
                    />
                  ) : selected && thumbUrl ? (
                    <img src={thumbUrl} alt="" className="aspect-[9/16] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center text-xs text-white/60">Select a reel</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold">Caption Editor</h3>
                {selected ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {queuePlatformBadgeLabel(selected.sourcePlatform)}
                  </span>
                ) : null}
              </div>
              <textarea
                value={draftCaption}
                onChange={(e) => setDraftCaption(e.target.value)}
                disabled={!selected || !canWrite}
                rows={6}
                placeholder="Select a queued reel to edit its caption…"
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              />
              {selected ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{draftCaption.length} characters</span>
                  {selected.sourceReelId ? <span className="font-mono">ID: {selected.sourceReelId}</span> : null}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {quickTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    disabled={!selected || !canWrite}
                    onClick={() => appendHashtag(tag)}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    {tag.startsWith('#') ? tag : `#${tag}`}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveCaption}
                  disabled={!selected || !canWrite || saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Caption'}
                </button>
                <button
                  type="button"
                  onClick={skipReel}
                  disabled={!selected || !canWrite || acting}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={deleteReel}
                  disabled={!selected || !canWrite || acting}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
