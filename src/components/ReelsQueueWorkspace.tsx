import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Film,
  Heart,
  MessageCircle,
  RefreshCw,
  Save,
  Share2,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
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
  /** Pro-style inline workspace on Reels tab; modal popup on Overview */
  layout?: 'workspace' | 'modal'
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

function useAuthenticatedPreview(
  pageId: string,
  jobId: string,
  kind: 'video' | 'thumb',
  enabled: boolean,
  version: number,
) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setUrl(null)
      setFailed(false)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false
    setFailed(false)

    fetch(api.pages.queuePreviewUrl(pageId, jobId, kind, version), { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null)
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [pageId, jobId, kind, enabled, version])

  return { url, failed }
}

function useQueueMediaUrl(
  pageId: string,
  item: PageQueueItem,
  kind: 'video' | 'thumb',
  enabled: boolean,
  version: number,
) {
  const cdnUrl = kind === 'video' ? item.previewVideoUrl : item.previewThumbUrl
  const [cdnFailed, setCdnFailed] = useState(false)

  useEffect(() => {
    setCdnFailed(false)
  }, [cdnUrl, item.id, kind, version])

  const useAuth = enabled && (!cdnUrl || cdnFailed)
  const auth = useAuthenticatedPreview(pageId, item.id, kind, useAuth, version)

  return {
    url: cdnUrl && !cdnFailed ? cdnUrl : auth.url,
    failed: Boolean(cdnUrl && cdnFailed && auth.failed),
    onCdnError: () => setCdnFailed(true),
  }
}

function ReelGridMedia({
  item,
  pageId,
  gridVersion,
  playVideo,
}: {
  item: PageQueueItem
  pageId: string
  gridVersion: number
  playVideo: boolean
}) {
  const tryMedia = Boolean(item.hasPreview || item.hasThumbnail)
  const { url: videoUrl, onCdnError: onVideoCdnError } = useQueueMediaUrl(
    pageId,
    item,
    'video',
    tryMedia && playVideo,
    gridVersion,
  )
  const { url: thumbUrl, onCdnError: onThumbCdnError } = useQueueMediaUrl(
    pageId,
    item,
    'thumb',
    tryMedia,
    gridVersion,
  )
  const authThumbUrl = api.pages.queuePreviewUrl(pageId, item.id, 'thumb', gridVersion)

  if (playVideo && videoUrl) {
    return (
      <video
        key={videoUrl}
        src={videoUrl}
        poster={thumbUrl ?? authThumbUrl}
        className="h-full w-full object-cover"
        playsInline
        autoPlay
        muted
        loop
        onError={onVideoCdnError}
      />
    )
  }

  const displayThumb = thumbUrl ?? (item.hasThumbnail ? authThumbUrl : null)

  if (displayThumb) {
    return (
      <img
        key={`${item.id}-${gridVersion}-${displayThumb}`}
        src={displayThumb}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={onThumbCdnError}
      />
    )
  }

  if (item.hasPreview) {
    return (
      <img
        key={`${item.id}-${gridVersion}`}
        src={authThumbUrl}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
      />
    )
  }

  return null
}

function ReelPhonePreview({
  pageId,
  item,
  draftCaption,
  mediaVersion,
  muted,
  onToggleMute,
}: {
  pageId: string
  item: PageQueueItem
  draftCaption: string
  mediaVersion: number
  muted: boolean
  onToggleMute?: () => void
}) {
  const tryVideo = Boolean(item.hasPreview || item.hasThumbnail)
  const { url: videoUrl, failed: videoFailed, onCdnError: onVideoCdnError } = useQueueMediaUrl(
    pageId,
    item,
    'video',
    tryVideo,
    mediaVersion,
  )
  const { url: thumbUrl, onCdnError: onThumbCdnError } = useQueueMediaUrl(
    pageId,
    item,
    'thumb',
    tryVideo && (!videoUrl || videoFailed),
    mediaVersion,
  )
  const username = item.sourceUsername?.replace(/^@/, '') ?? 'creator'

  return (
    <div className="relative mx-auto w-[280px]">
      {onToggleMute && videoUrl && !videoFailed ? (
        <button
          type="button"
          onClick={onToggleMute}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      ) : null}
      <div className="rounded-[2.5rem] border-[8px] border-foreground bg-black p-2 shadow-2xl">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-black">
          <div className="relative aspect-[9/16] w-full">
            {videoUrl && !videoFailed ? (
              <video
                key={videoUrl}
                src={videoUrl}
                poster={thumbUrl ?? undefined}
                className="h-full w-full object-cover"
                controls
                playsInline
                autoPlay
                muted={muted}
                loop
                onError={onVideoCdnError}
              />
            ) : thumbUrl ? (
              <img src={thumbUrl} alt="" className="h-full w-full object-cover" onError={onThumbCdnError} />
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
    </div>
  )
}

function ReelCurationPanel({
  pageId,
  item,
  canWrite,
  defaultHashtags,
  onRefresh,
  onRemoved,
  layout,
}: {
  pageId: string
  item: PageQueueItem
  canWrite: boolean
  defaultHashtags: string[]
  onRefresh: () => void
  onRemoved?: () => void
  layout: 'workspace' | 'modal'
}) {
  const toast = useToast()
  const [localItem, setLocalItem] = useState(item)
  const [draftCaption, setDraftCaption] = useState(item.caption ?? '')
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)
  const [refreshingPreview, setRefreshingPreview] = useState(false)
  const [mediaVersion, setMediaVersion] = useState(0)
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  const [muted, setMuted] = useState(true)

  const needsPreview = !localItem.hasPreview || !localItem.hasThumbnail

  useEffect(() => {
    setLocalItem(item)
    setDraftCaption(item.caption ?? '')
  }, [item])

  useEffect(() => {
    setMediaVersion((v) => v + 1)
    setAutoRefreshed(false)
    setMuted(true)
  }, [item.id])

  const quickTags = defaultHashtags.length
    ? defaultHashtags
    : ['#reels', '#viral', '#trending', '#foryou', '#shorts']

  async function refreshPreview() {
    if (!canWrite) return
    setRefreshingPreview(true)
    try {
      const result = await api.pages.refreshQueueItem(pageId, localItem.id)
      setLocalItem((prev) => ({
        ...prev,
        hasPreview: result.hasPreview,
        hasThumbnail: result.hasThumbnail,
      }))
      setMediaVersion((v) => v + 1)
      toast.success(result.refreshed === 'none' ? 'Preview is up to date' : 'Preview refreshed')
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Could not refresh preview'))
    } finally {
      setRefreshingPreview(false)
    }
  }

  useEffect(() => {
    if (!canWrite || !needsPreview || autoRefreshed || refreshingPreview) return
    setAutoRefreshed(true)
    void refreshPreview()
  }, [localItem.id, needsPreview, canWrite, autoRefreshed, refreshingPreview])

  async function saveCaption() {
    if (!canWrite) return
    setSaving(true)
    try {
      await api.pages.updateQueueCaption(pageId, localItem.id, draftCaption)
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
      await api.pages.skipQueueItem(pageId, localItem.id)
      toast.success('Skipped')
      onRefresh()
      onRemoved?.()
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
      await api.pages.deleteQueueItem(pageId, localItem.id)
      toast.success('Removed')
      onRefresh()
      onRemoved?.()
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

  const editor = (
    <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="font-semibold">Caption Editor</h4>
            <p className="text-xs text-muted-foreground">Adjust text and hashtags</p>
          </div>
          <span className="rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {queuePlatformBadgeLabel(localItem.sourcePlatform)}
          </span>
        </div>
        <textarea
          value={draftCaption}
          onChange={(e) => setDraftCaption(e.target.value)}
          disabled={!canWrite}
          rows={5}
          placeholder="Type your caption here..."
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{draftCaption.length} characters</span>
          {localItem.sourceReelId ? <span className="font-mono">ID: {localItem.sourceReelId}</span> : null}
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
    </>
  )

  if (layout === 'workspace') {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4">
          <h3 className="font-semibold">Interactive Workspace</h3>
          <p className="text-sm text-muted-foreground">Mobile preview &amp; detailed configuration</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <ReelPhonePreview
              pageId={pageId}
              item={localItem}
              draftCaption={draftCaption}
              mediaVersion={mediaVersion}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
            />
            {needsPreview && canWrite ? (
              <button
                type="button"
                onClick={refreshPreview}
                disabled={refreshingPreview || acting}
                className="mx-auto flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshingPreview ? 'animate-spin' : ''}`} />
                {refreshingPreview ? 'Refreshing preview…' : 'Refresh preview'}
              </button>
            ) : null}
          </div>
          <div className="space-y-4">{editor}</div>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <ReelPhonePreview
        pageId={pageId}
        item={localItem}
        draftCaption={draftCaption}
        mediaVersion={mediaVersion}
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
      />
      {needsPreview && canWrite ? (
        <button
          type="button"
          onClick={refreshPreview}
          disabled={refreshingPreview || acting}
          className="mx-auto flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshingPreview ? 'animate-spin' : ''}`} />
          {refreshingPreview ? 'Refreshing preview…' : 'Refresh preview'}
        </button>
      ) : null}
      {editor}
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
        <div className="p-5">
          <ReelCurationPanel
            pageId={pageId}
            item={item}
            canWrite={canWrite}
            defaultHashtags={defaultHashtags}
            onRefresh={onRefresh}
            onRemoved={onClose}
            layout="modal"
          />
        </div>
      </div>
    </div>
  )
}

export function ReelsQueueWorkspace({
  pageId,
  queue,
  canWrite,
  defaultHashtags = [],
  onRefresh,
  refreshing,
  layout = 'modal',
}: Props) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalItemId, setModalItemId] = useState<string | null>(null)
  const [refreshingMissing, setRefreshingMissing] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [gridVersion, setGridVersion] = useState(0)

  const missingPreviewCount = queue.filter((item) => !item.hasPreview || !item.hasThumbnail).length

  const duplicateCount = useMemo(() => {
    const seenReelIds = new Set<string>()
    const seenUrls = new Set<string>()
    let duplicates = 0

    for (const item of queue) {
      const reelId = item.sourceReelId?.trim()
      const url = item.sourceUrl?.trim()

      if (reelId) {
        if (seenReelIds.has(reelId)) {
          duplicates++
          continue
        }
        seenReelIds.add(reelId)
      }

      if (url && !url.startsWith('mock://')) {
        if (seenUrls.has(url)) {
          duplicates++
          continue
        }
        seenUrls.add(url)
      }
    }

    const mockItems = queue.filter((item) => item.sourceUrl?.startsWith('mock://'))
    if (mockItems.length > 1 && mockItems.length === queue.length) {
      duplicates += mockItems.length - 1
    }

    return duplicates
  }, [queue])

  const activeId = layout === 'workspace' ? selectedId : modalItemId
  const selectedItem = useMemo(
    () => queue.find((q) => q.id === activeId) ?? null,
    [queue, activeId],
  )

  useEffect(() => {
    setGridVersion((v) => v + 1)
  }, [queue])

  useEffect(() => {
    if (layout !== 'workspace') return
    if (!queue.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !queue.some((q) => q.id === selectedId)) {
      setSelectedId(queue[0]!.id)
    }
  }, [layout, queue, selectedId])

  useEffect(() => {
    if (modalItemId && !queue.some((q) => q.id === modalItemId)) {
      setModalItemId(null)
    }
  }, [queue, modalItemId])

  useEffect(() => {
    const hasPending = queue.some((item) => !item.hasPreview || !item.hasThumbnail)
    const intervalMs = hasPending ? 15_000 : 30_000
    const timer = window.setInterval(() => {
      onRefresh()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [queue, onRefresh])

  async function refreshMissingPreviews() {
    if (!canWrite || !missingPreviewCount) return
    setRefreshingMissing(true)
    try {
      const result = await api.pages.refreshMissingQueuePreviews(pageId)
      setGridVersion((v) => v + 1)
      if (result.background) {
        const purgedNote =
          result.purged && result.purged > 0
            ? ` Removed ${result.purged} placeholder reel${result.purged !== 1 ? 's' : ''}.`
            : ''
        toast.success(
          result.alreadyRunning
            ? 'Preview repair already in progress'
            : `Repairing ${result.attempted} preview${result.attempted !== 1 ? 's' : ''} — queue will update automatically.${purgedNote}`,
        )
      } else if (result.purged && result.purged > 0) {
        toast.success(
          `Removed ${result.purged} placeholder reel${result.purged !== 1 ? 's' : ''} and refilling queue`,
        )
      } else {
        toast.success(`Refreshed ${result.refreshed} of ${result.attempted} preview${result.attempted !== 1 ? 's' : ''}`)
      }
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Could not refresh previews'))
    } finally {
      setRefreshingMissing(false)
    }
  }

  async function removeDuplicates() {
    if (!canWrite || !duplicateCount) return
    setDeduping(true)
    try {
      const result = await api.pages.dedupeQueue(pageId)
      setGridVersion((v) => v + 1)
      toast.success(result.message)
      onRefresh()
    } catch (err) {
      toast.error(getApiError(err, 'Could not remove duplicates'))
    } finally {
      setDeduping(false)
    }
  }

  function selectItem(id: string) {
    if (layout === 'workspace') setSelectedId(id)
    else setModalItemId(id)
  }

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
          <div className="flex flex-wrap items-center gap-2">
            {duplicateCount > 0 && canWrite ? (
              <button
                type="button"
                onClick={removeDuplicates}
                disabled={deduping || refreshing || refreshingMissing}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-900 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className={`h-4 w-4 ${deduping ? 'animate-pulse' : ''}`} />
                Remove {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''}
              </button>
            ) : null}
            {missingPreviewCount > 0 && canWrite ? (
              <button
                type="button"
                onClick={refreshMissingPreviews}
                disabled={refreshingMissing || refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshingMissing ? 'animate-spin' : ''}`} />
                Fix {missingPreviewCount} preview{missingPreviewCount !== 1 ? 's' : ''}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing || refreshingMissing}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5">
          {queue.length ? (
            <div
              className={
                layout === 'workspace'
                  ? 'flex gap-3 overflow-x-auto pb-2'
                  : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
              }
            >
              {queue.map((item) => {
                const PlatformIcon = queuePlatformIcon(item.sourcePlatform)
                const badge = queuePlatformBadgeLabel(item.sourcePlatform)
                const isSelected = activeId === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectItem(item.id)}
                    className={`group relative shrink-0 overflow-hidden rounded-xl border text-left transition hover:shadow-md ${
                      layout === 'workspace' ? 'w-[140px] sm:w-[160px]' : ''
                    } ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'}`}
                  >
                    <div className="relative aspect-[9/16] bg-muted">
                      {item.hasThumbnail || item.hasPreview ? (
                        <ReelGridMedia
                          item={item}
                          pageId={pageId}
                          gridVersion={gridVersion}
                          playVideo={layout === 'workspace'}
                        />
                      ) : null}
                      {!item.hasThumbnail && !item.hasPreview ? (
                        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-xs text-muted-foreground">
                          <span>No preview</span>
                          <span className="text-[10px]">Click to fix preview</span>
                        </div>
                      ) : null}
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        <PlatformIcon className="h-3 w-3" />
                        {badge}
                      </span>
                      {isSelected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-emerald-500 p-0.5 text-white shadow">
                          <CheckCircle2 className="h-4 w-4" />
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
      </section>

      {layout === 'workspace' && selectedItem ? (
        <ReelCurationPanel
          pageId={pageId}
          item={selectedItem}
          canWrite={canWrite}
          defaultHashtags={defaultHashtags}
          onRefresh={onRefresh}
          layout="workspace"
        />
      ) : null}

      {layout === 'modal' && modalItemId && selectedItem ? (
        <ReelCurationModal
          pageId={pageId}
          item={selectedItem}
          canWrite={canWrite}
          defaultHashtags={defaultHashtags}
          onClose={() => setModalItemId(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </div>
  )
}
