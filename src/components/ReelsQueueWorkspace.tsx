import { useEffect, useMemo, useState } from 'react'
import { Film, Heart, MessageCircle, RefreshCw, Save, Share2, SkipForward, Trash2, X } from 'lucide-react'
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

function ReelPhonePreview({
  pageId,
  item,
  draftCaption,
}: {
  pageId: string
  item: PageQueueItem
  draftCaption: string
}) {
  const videoUrl = item.hasPreview ? api.pages.queuePreviewUrl(pageId, item.id, 'video') : null
  const thumbUrl = api.pages.queuePreviewUrl(pageId, item.id, 'thumb')
  const username = item.sourceUsername?.replace(/^@/, '') ?? 'creator'

  return (
    <div className="mx-auto w-[280px] rounded-[2.5rem] border-[8px] border-foreground bg-black p-2 shadow-2xl">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-black">
        <div className="relative aspect-[9/16] w-full">
          {videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              poster={thumbUrl}
              className="h-full w-full object-cover"
              controls
              playsInline
              autoPlay
              muted
              loop
            />
          ) : item.hasThumbnail || item.hasPreview ? (
            <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/50">Preview unavailable</div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-16">
            <p className="text-xs font-semibold text-white">@{username}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-white/95">{draftCaption || 'No caption'}</p>
          </div>
          <div className="pointer-events-none absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white">
            <div className="flex flex-col items-center gap-0.5">
              <Heart className="h-5 w-5 fill-red-500 text-red-500" />
              <span className="text-[10px] font-medium">1.2k</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <MessageCircle className="h-5 w-5" />
              <span className="text-[10px] font-medium">48</span>
            </div>
            <Share2 className="h-5 w-5" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ReelCurationModal({
  pageId,
  item,
  canWrite,
  defaultHashtags,
  onClose,
  onRefresh,
}: {
  pageId: string
  item: PageQueueItem
  canWrite: boolean
  defaultHashtags: string[]
  onClose: () => void
  onRefresh: () => void
}) {
  const toast = useToast()
  const [draftCaption, setDraftCaption] = useState(item.caption ?? '')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    setDraftCaption(item.caption ?? '')
  }, [item.id, item.caption])

  const quickTags = defaultHashtags.length
    ? defaultHashtags
    : ['#reels', '#viral', '#trending', '#foryou', '#shorts']

  async function saveCaption() {
    if (!canWrite) return
    setSaving(true)
    try {
      await api.pages.updateQueueCaption(pageId, item.id, draftCaption)
      toast.success('Caption saved')
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to save caption'))
    } finally {
      setSaving(false)
    }
  }

  async function skipReel() {
    if (!canWrite) return
    setActing(true)
    try {
      await api.pages.skipQueueItem(pageId, item.id)
      toast.success('Skipped')
      onRefresh()
      onClose()
    } catch (err) {
      toast.error(getApiError(err, 'Skip failed'))
    } finally {
      setActing(false)
    }
  }

  async function deleteReel() {
    if (!canWrite) return
    if (!window.confirm('Remove this reel from the queue?')) return
    setActing(true)
    try {
      await api.pages.deleteQueueItem(pageId, item.id)
      toast.success('Removed')
      onRefresh()
      onClose()
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Film className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-xl font-bold">Reel Curation</h3>
              <p className="text-sm text-muted-foreground">Preview &amp; Edit Caption</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <ReelPhonePreview pageId={pageId} item={item} draftCaption={draftCaption} />

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold">Caption Editor</h4>
                <p className="text-xs text-muted-foreground">Adjust text and hashtags</p>
              </div>
              <span className="rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {queuePlatformBadgeLabel(item.sourcePlatform)}
              </span>
            </div>
            <textarea
              value={draftCaption}
              onChange={(e) => setDraftCaption(e.target.value)}
              disabled={!canWrite}
              rows={5}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{draftCaption.length} characters</span>
              {item.sourceReelId ? <span className="font-mono">ID: {item.sourceReelId}</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {quickTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => appendHashtag(tag)}
                  className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {tag.startsWith('#') ? tag : `#${tag}`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={saveCaption}
              disabled={!canWrite || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50 sm:col-span-3"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save Caption'}
            </button>
            <button
              type="button"
              onClick={skipReel}
              disabled={!canWrite || acting}
              className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-amber-400 bg-background px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              <SkipForward className="h-4 w-4" />
              Skip
            </button>
            <button
              type="button"
              onClick={deleteReel}
              disabled={!canWrite || acting}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 sm:col-span-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ReelsQueueWorkspace({ pageId, queue, canWrite, defaultHashtags = [], onRefresh, refreshing }: Props) {
  const [modalItemId, setModalItemId] = useState<string | null>(null)

  const modalItem = useMemo(
    () => queue.find((q) => q.id === modalItemId) ?? null,
    [queue, modalItemId],
  )

  useEffect(() => {
    if (modalItemId && !queue.some((q) => q.id === modalItemId)) {
      setModalItemId(null)
    }
  }, [queue, modalItemId])

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

        <div className="mt-5">
          {queue.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {queue.map((item) => {
                const PlatformIcon = queuePlatformIcon(item.sourcePlatform)
                const badge = queuePlatformBadgeLabel(item.sourcePlatform)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setModalItemId(item.id)}
                    className="group relative overflow-hidden rounded-xl border border-border text-left transition hover:border-primary/40 hover:shadow-md"
                  >
                    <div className="relative aspect-[9/16] bg-muted">
                      {item.hasThumbnail || item.hasPreview ? (
                        <img
                          src={api.pages.queuePreviewUrl(pageId, item.id, 'thumb')}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const el = e.currentTarget
                            if (item.hasPreview) {
                              el.style.display = 'none'
                              const vid = el.nextElementSibling as HTMLVideoElement | null
                              if (vid) vid.style.display = 'block'
                            }
                          }}
                        />
                      ) : null}
                      {item.hasPreview ? (
                        <video
                          src={api.pages.queuePreviewUrl(pageId, item.id, 'video')}
                          className={`h-full w-full object-cover ${item.hasThumbnail ? 'hidden' : ''}`}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : null}
                      {!item.hasThumbnail && !item.hasPreview ? (
                        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-xs text-muted-foreground">
                          <span>No preview</span>
                          <span className="text-[10px]">Skip to re-download</span>
                        </div>
                      ) : null}
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        <PlatformIcon className="h-3 w-3" />
                        {badge}
                      </span>
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
      </section>

      {modalItem ? (
        <ReelCurationModal
          pageId={pageId}
          item={modalItem}
          canWrite={canWrite}
          defaultHashtags={defaultHashtags}
          onClose={() => setModalItemId(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </div>
  )
}
