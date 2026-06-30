import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, ImagePlus, Newspaper, Pencil, RefreshCw, Rss, Send, SkipForward, Trash2 } from 'lucide-react'
import { api, type NewsAiConnectionTest, type NewsAiProvider, type NewsImageCrop, type NewsOverview, type NewsTemplateColors, DEFAULT_NEWS_IMAGE_CROP } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const DEFAULT_COLORS: NewsTemplateColors = {
  accent: '#00D4FF',
  text: '#FFFFFF',
  barBg: '#000000',
  cta: '#AAAAAA',
  insetBorder: '#00D4FF',
}

export function NewsFeedPage() {
  const toast = useToast()
  const [data, setData] = useState<NewsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [previewCacheBust, setPreviewCacheBust] = useState<Record<string, number>>({})

  const [aiProvider, setAiProvider] = useState<NewsAiProvider>('gemini')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [savingAiSettings, setSavingAiSettings] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<NewsAiConnectionTest | null>(null)
  const [viewItemId, setViewItemId] = useState<string | null>(null)
  const [editHeadline, setEditHeadline] = useState('')
  const [editPostTitle, setEditPostTitle] = useState('')
  const [editPostDescription, setEditPostDescription] = useState('')
  const [editAccentWords, setEditAccentWords] = useState('')
  const [editHeroUrl, setEditHeroUrl] = useState('')
  const [editInsetUrl, setEditInsetUrl] = useState('')
  const [heroUploadDataUrl, setHeroUploadDataUrl] = useState<string | null>(null)
  const [insetUploadDataUrl, setInsetUploadDataUrl] = useState<string | null>(null)
  const [heroUploadName, setHeroUploadName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editImageCrop, setEditImageCrop] = useState<NewsImageCrop>({ ...DEFAULT_NEWS_IMAGE_CROP })
  const [pollingFeedId, setPollingFeedId] = useState<string | null>(null)
  const [deletingFeedId, setDeletingFeedId] = useState<string | null>(null)
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)

  const [templateName, setTemplateName] = useState('Default News')
  const [layoutPreset, setLayoutPreset] = useState('popcorn')
  const [accentColor, setAccentColor] = useState(DEFAULT_COLORS.accent)
  const [barBg, setBarBg] = useState(DEFAULT_COLORS.barBg)
  const [ctaText, setCtaText] = useState('READ MORE INFO IN THE COMMENT')
  const [defaultHashtagsStr, setDefaultHashtagsStr] = useState('#News')
  const [aiTonePrompt, setAiTonePrompt] = useState('')
  const [editTemplateId, setEditTemplateId] = useState('')
  const [textSize, setTextSize] = useState(50)
  const [previewPageId, setPreviewPageId] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const [settingsPageId, setSettingsPageId] = useState('')
  const [autoPublish, setAutoPublish] = useState(true)
  const [postsPerDay, setPostsPerDay] = useState(4)
  const [scheduleTimesStr, setScheduleTimesStr] = useState('07:30, 10:00, 13:00, 16:00')
  const [timezone, setTimezone] = useState('America/New_York')
  const [scheduleOffset, setScheduleOffset] = useState(0)
  const [commentLinkEnabled, setCommentLinkEnabled] = useState(false)
  const [includeLinkInCaption, setIncludeLinkInCaption] = useState(false)
  const [aiRewriteEnabled, setAiRewriteEnabled] = useState(false)
  const [pageHashtagsStr, setPageHashtagsStr] = useState('')
  const [pageTemplateId, setPageTemplateId] = useState('')

  const [bulkPageIds, setBulkPageIds] = useState<string[]>([])
  const [bulkTemplateId, setBulkTemplateId] = useState('')
  const [bulkCopyFromPageId, setBulkCopyFromPageId] = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)

  const templateColors = { ...DEFAULT_COLORS, accent: accentColor, barBg, insetBorder: accentColor }
  const templateFonts = { textSize }

  function parseHashtags(raw: string): string[] {
    return raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
  }

  function loadPageSettings(pageId: string, pages: NewsOverview['pages']) {
    const p = pages.find((x) => x.id === pageId)
    if (!p) return
    setAutoPublish(p.autoPublish)
    setPostsPerDay(p.postsPerDay)
    setScheduleTimesStr(p.scheduleTimes.join(', '))
    setTimezone(p.timezone)
    setScheduleOffset(p.scheduleOffsetMinutes)
    setCommentLinkEnabled(p.commentLinkEnabled)
    setIncludeLinkInCaption(p.includeLinkInCaption)
    setAiRewriteEnabled(p.aiRewriteEnabled)
    setPageHashtagsStr(p.defaultHashtags.join(' '))
    setPageTemplateId(p.templateId ?? '')
  }

  function loadTemplateForEdit(templateId: string, templates: NewsOverview['templates']) {
    const t = templates.find((x) => x.id === templateId)
    if (!t) return
    setTemplateName(t.name)
    setLayoutPreset(t.layoutPreset)
    setAccentColor(t.colors.accent)
    setBarBg(t.colors.barBg)
    setCtaText(t.ctaText || 'READ MORE INFO IN THE COMMENT')
    setDefaultHashtagsStr(t.defaultHashtags.join(' '))
    setAiTonePrompt(t.aiTonePrompt)
    setTextSize(t.fonts.textSize ?? 50)
  }

  const [feedName, setFeedName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [feedPageId, setFeedPageId] = useState('')
  const [feedTemplateId, setFeedTemplateId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const overview = await api.news.overview()
      if (!Array.isArray(overview.pages) || !Array.isArray(overview.templates)) {
        throw new Error('News feed API returned an invalid response. Restart the dev server and try again.')
      }
      setData({
        ...overview,
        pages: overview.pages,
        templates: overview.templates,
        feeds: overview.feeds ?? [],
        items: overview.items ?? [],
        stats: overview.stats ?? { ready: 0, posted: 0, failed: 0 },
        aiSettings: overview.aiSettings,
      })
      if (overview.aiSettings) {
        setAiProvider(overview.aiSettings.provider)
      }
      const realPages = overview.pages.filter((p) => !p.isMockPage)
      const defaultPageId = realPages[0]?.id || overview.pages[0]?.id || ''
      setFeedPageId((prev) => (prev && realPages.some((p) => p.id === prev) ? prev : defaultPageId))
      setFeedTemplateId((prev) => prev || overview.templates[0]?.id || '')
      setPreviewPageId((prev) => prev || overview.pages[0]?.id || '')
      setSettingsPageId((prev) => prev || overview.pages[0]?.id || '')
      if (!settingsPageId && overview.pages[0]) loadPageSettings(overview.pages[0].id, overview.pages)
    } catch (err) {
      setData(null)
      toast.error(getApiError(err, 'Failed to load news feed'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (data && settingsPageId) loadPageSettings(settingsPageId, data.pages)
  }, [settingsPageId, data])

  useEffect(() => {
    if (data && editTemplateId) loadTemplateForEdit(editTemplateId, data.templates)
  }, [editTemplateId, data])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!viewItemId || !data) return
    const item = data.items.find((i) => i.id === viewItemId)
    if (!item) return
    setEditHeadline(item.headline ?? '')
    setEditPostTitle(item.postTitle ?? '')
    setEditPostDescription(item.postDescription ?? '')
    setEditAccentWords(item.accentWords?.join(', ') ?? '')
    setEditHeroUrl(item.heroImageUrl?.startsWith('http') ? item.heroImageUrl : '')
    setEditInsetUrl(item.insetImageUrl?.startsWith('http') ? item.insetImageUrl : '')
    setHeroUploadDataUrl(null)
    setInsetUploadDataUrl(null)
    setHeroUploadName('')
    setEditImageCrop(item.imageCrop ?? { ...DEFAULT_NEWS_IMAGE_CROP })
  }, [viewItemId, data])

  useEffect(() => {
    if (!viewItemId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewItemId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewItemId])

  async function readImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read image file'))
      reader.readAsDataURL(file)
    })
  }

  async function handleHeroFileChange(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose a JPG or PNG image')
      return
    }
    setHeroUploadDataUrl(await readImageFile(file))
    setHeroUploadName(file.name)
  }

  async function handleInsetFileChange(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose a JPG or PNG image')
      return
    }
    setInsetUploadDataUrl(await readImageFile(file))
  }

  async function handleSaveItemEdit() {
    if (!viewItemId) return
    setSavingEdit(true)
    try {
      const accentWords = editAccentWords
        .split(/[\s,]+/)
        .map((w) => w.trim().toUpperCase())
        .filter(Boolean)
      const res = await api.news.updateItem(viewItemId, {
        headline: editHeadline.trim(),
        postTitle: editPostTitle.trim(),
        postDescription: editPostDescription.trim(),
        accentWords: accentWords.length ? accentWords : undefined,
        heroImageUrl: editHeroUrl.trim() || undefined,
        insetImageUrl: editInsetUrl.trim() || undefined,
        heroImageDataUrl: heroUploadDataUrl ?? undefined,
        insetImageDataUrl: insetUploadDataUrl ?? undefined,
        imageCrop: editImageCrop,
      })
      setPreviewCacheBust((prev) => ({ ...prev, [viewItemId]: Date.now() }))
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === viewItemId ? res.item : i)) } : prev,
      )
      toast.success('Graphic updated with your edits')
    } catch (err) {
      toast.error(getApiError(err, 'Save failed'))
    } finally {
      setSavingEdit(false)
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handlePreviewTemplate() {
    setPreviewing(true)
    try {
      const blob = await api.news.previewTemplate({
        colors: templateColors,
        fonts: templateFonts,
        brandType: 'page_name',
        ctaText,
        pageId: previewPageId || undefined,
      })
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
    } catch (err) {
      toast.error(getApiError(err, 'Preview failed'))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleCreateTemplate(e: FormEvent) {
    e.preventDefault()
    const body = {
      name: templateName.trim(),
      layoutPreset,
      colors: templateColors,
      fonts: templateFonts,
      brandType: 'page_name' as const,
      ctaText,
      defaultHashtags: parseHashtags(defaultHashtagsStr),
      aiTonePrompt,
      logoPath: null,
    }
    try {
      if (editTemplateId) {
        await api.news.updateTemplate(editTemplateId, body)
        toast.success('Template updated')
      } else {
        await api.news.createTemplate(body)
        toast.success('Template created')
      }
      await load()
    } catch (err) {
      toast.error(getApiError(err, editTemplateId ? 'Update template failed' : 'Create template failed'))
    }
  }

  async function handleSaveAiSettings(e: FormEvent) {
    e.preventDefault()
    setSavingAiSettings(true)
    try {
      const res = await api.news.saveAiSettings({
        provider: aiProvider,
        ...(geminiApiKey.trim() ? { geminiApiKey: geminiApiKey.trim() } : {}),
        ...(openaiApiKey.trim() ? { openaiApiKey: openaiApiKey.trim() } : {}),
      })
      setGeminiApiKey('')
      setOpenaiApiKey('')
      toast.success(res.message)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Save AI settings failed'))
    } finally {
      setSavingAiSettings(false)
    }
  }

  async function handleTestAiConnection() {
    setTestingAi(true)
    setAiTestResult(null)
    try {
      const result = await api.news.testAiConnection()
      setAiTestResult(result)
      if (result.ok) {
        toast.success(`AI connected — sample: ${result.sampleHeadline ?? 'OK'}`)
      } else {
        const err = result.results.find((r) => !r.ok)?.error ?? 'AI test failed'
        toast.error(err.slice(0, 180))
      }
    } catch (err) {
      toast.error(getApiError(err, 'AI test failed'))
    } finally {
      setTestingAi(false)
    }
  }

  async function handleClearGeminiKey() {
    setSavingAiSettings(true)
    try {
      await api.news.saveAiSettings({ provider: aiProvider, geminiApiKey: '' })
      setGeminiApiKey('')
      toast.success('Gemini key removed')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Remove key failed'))
    } finally {
      setSavingAiSettings(false)
    }
  }

  async function handleSavePageSettings(e: FormEvent) {
    e.preventDefault()
    if (!settingsPageId) return
    try {
      await api.news.savePageSettings(settingsPageId, {
        templateId: pageTemplateId || null,
        autoPublish,
        postsPerDay,
        scheduleTimes: scheduleTimesStr.split(/[\s,]+/).filter(Boolean),
        timezone,
        scheduleOffsetMinutes: scheduleOffset,
        commentLinkEnabled,
        includeLinkInCaption,
        aiRewriteEnabled,
        defaultHashtags: parseHashtags(pageHashtagsStr),
      })
      toast.success('Page settings saved')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Save settings failed'))
    }
  }

  async function handleBulkSetup(e: FormEvent) {
    e.preventDefault()
    if (bulkPageIds.length === 0) {
      toast.error('Select at least one page')
      return
    }
    setBulkApplying(true)
    try {
      const res = await api.news.bulkSetup({
        pageIds: bulkPageIds,
        templateId: bulkTemplateId || undefined,
        copyFromPageId: bulkCopyFromPageId || undefined,
      })
      toast.success(res.message)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Bulk setup failed'))
    } finally {
      setBulkApplying(false)
    }
  }

  async function handleDuplicateTemplate() {
    if (!editTemplateId) return
    try {
      const res = await api.news.duplicateTemplate(editTemplateId, `${templateName} Copy`)
      toast.success('Template duplicated')
      setEditTemplateId(res.template.id)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Duplicate failed'))
    }
  }

  async function handleCreateFeed(e: FormEvent) {
    e.preventDefault()
    if (!feedName.trim() || !feedUrl.trim() || !feedPageId) return
    try {
      await api.news.createFeed({
        name: feedName.trim(),
        url: feedUrl.trim(),
        pageId: feedPageId,
        templateId: feedTemplateId || undefined,
      })
      toast.success('RSS feed added')
      setFeedName('')
      setFeedUrl('')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Add feed failed'))
    }
  }

  function itemPreviewSrc(itemId: string): string {
    return `${api.news.previewUrl(itemId)}${previewCacheBust[itemId] ? `?t=${previewCacheBust[itemId]}` : ''}`
  }

  async function handlePollAll() {
    setPolling(true)
    try {
      const res = await api.news.pollAll()
      toast.success(res.message)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Poll failed'))
    } finally {
      setPolling(false)
    }
  }

  async function handlePublish(itemId: string) {
    try {
      await api.news.publishItem(itemId)
      toast.success('Published to Facebook')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Publish failed'))
    }
  }

  async function handleRegenerateImage(itemId: string) {
    setRegeneratingId(itemId)
    try {
      await api.news.regenerateItemImage(itemId)
      setPreviewCacheBust((prev) => ({ ...prev, [itemId]: Date.now() }))
      toast.success('Image regenerated with AI headline')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Regenerate failed'))
    } finally {
      setRegeneratingId(null)
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('Delete this queue item permanently?')) return
    setDeletingItemId(itemId)
    try {
      await api.news.deleteItem(itemId)
      if (viewItemId === itemId) setViewItemId(null)
      toast.success('Item deleted')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Delete failed'))
    } finally {
      setDeletingItemId(null)
    }
  }

  async function handlePollFeed(feedId: string) {
    setPollingFeedId(feedId)
    try {
      const res = await api.news.pollFeed(feedId)
      toast.success(res.message)
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Poll failed'))
    } finally {
      setPollingFeedId(null)
    }
  }

  async function handleDeleteFeed(feedId: string, feedName: string) {
    if (!confirm(`Delete RSS feed "${feedName}"? Existing queue items stay but no new polls will run for this feed.`)) return
    setDeletingFeedId(feedId)
    try {
      await api.news.deleteFeed(feedId)
      toast.success('Feed deleted')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Delete feed failed'))
    } finally {
      setDeletingFeedId(null)
    }
  }

  function updateCrop(patch: Partial<NewsImageCrop>) {
    setEditImageCrop((prev) => ({ ...prev, ...patch }))
  }

  async function handleSkip(itemId: string) {
    try {
      await api.news.skipItem(itemId)
      toast.success('Skipped')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Skip failed'))
    }
  }

  async function handleReassignFeed(feedId: string, pageId: string) {
    try {
      await api.news.updateFeed(feedId, { pageId })
      toast.success('Feed reassigned — try Publish again')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Reassign failed'))
    }
  }

  const publishablePages = data?.pages.filter((p) => !p.isMockPage) ?? []
  const mockFeedAssigned = data?.feeds.some((f) => f.isMockPage) ?? false
  const viewingItem = viewItemId ? data?.items.find((i) => i.id === viewItemId) : undefined
  const canEditViewingItem = viewingItem?.status === 'ready'
  const heroCropPreviewSrc =
    heroUploadDataUrl ||
    (editHeroUrl.startsWith('http') ? editHeroUrl : '') ||
    (viewingItem?.heroImageUrl?.startsWith('http') ? viewingItem.heroImageUrl : '')

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
            <Newspaper className="h-5 w-5 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">RSS News Feed</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Automate RSS → branded image → Facebook caption posts. One template layout, custom colors per page. Owner only.
          </p>
        </div>
        <button
          type="button"
          onClick={handlePollAll}
          disabled={polling || loading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${polling ? 'animate-spin' : ''}`} />
          Poll all feeds
        </button>
      </div>

      {loading && !data ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Ready to post', value: data.stats?.ready ?? 0 },
              { label: 'Posted', value: data.stats?.posted ?? 0 },
              { label: 'Failed', value: data.stats?.failed ?? 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.label}</p>
                <p className="font-display mt-2 text-2xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>

          <form onSubmit={handleSaveAiSettings} className="marketing-card space-y-4">
            <h2 className="font-semibold">AI headline settings</h2>
            <p className="text-xs text-muted-foreground">
              Google Gemini free tier is recommended — get a key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Google AI Studio
              </a>
              . Used to shorten titles for the image template and optionally rewrite captions.
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 ${data.aiSettings?.aiAvailable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {data.aiSettings?.aiAvailable ? 'AI ready' : 'No API key configured'}
              </span>
              {data.aiSettings?.geminiConfigured && (
                <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">Gemini {data.aiSettings.envGemini ? '(server)' : '(saved)'}</span>
              )}
              {data.aiSettings?.openaiConfigured && (
                <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">OpenAI {data.aiSettings.envOpenai ? '(server)' : '(saved)'}</span>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Preferred provider</label>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as NewsAiProvider)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="gemini">Google Gemini (recommended, free tier)</option>
                <option value="auto">Auto — Gemini first, then OpenAI</option>
                <option value="openai">OpenAI only</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Gemini API key</label>
              <div className="relative">
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={data.aiSettings?.geminiConfigured ? '•••••••• (leave blank to keep current)' : 'AIza...'}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showGeminiKey ? 'Hide key' : 'Show key'}
                >
                  {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">OpenAI API key (optional fallback)</label>
              <div className="relative">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder={data.aiSettings?.openaiConfigured ? '•••••••• (leave blank to keep current)' : 'sk-...'}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showOpenaiKey ? 'Hide key' : 'Show key'}
                >
                  {showOpenaiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={savingAiSettings}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {savingAiSettings ? 'Saving…' : 'Save AI settings'}
              </button>
              <button
                type="button"
                disabled={testingAi || !data.aiSettings?.aiAvailable}
                onClick={() => void handleTestAiConnection()}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${testingAi ? 'animate-spin' : ''}`} />
                {testingAi ? 'Testing…' : 'Test AI connection'}
              </button>
              {data.aiSettings?.geminiConfigured && !data.aiSettings.envGemini && (
                <button
                  type="button"
                  disabled={savingAiSettings}
                  onClick={() => void handleClearGeminiKey()}
                  className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
                >
                  Remove Gemini key
                </button>
              )}
            </div>
            {aiTestResult && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${aiTestResult.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                {aiTestResult.ok ? (
                  <p className="text-emerald-800 dark:text-emerald-300">
                    Connected via {aiTestResult.results.find((r) => r.ok)?.provider ?? 'AI'}
                    {aiTestResult.results.find((r) => r.ok)?.model ? ` (${aiTestResult.results.find((r) => r.ok)?.model})` : ''}.
                    Sample headline: <span className="font-semibold">{aiTestResult.sampleHeadline}</span>
                  </p>
                ) : (
                  <ul className="space-y-1 text-destructive">
                    {aiTestResult.results.map((r) => (
                      <li key={r.provider}>
                        <span className="font-semibold uppercase">{r.provider}</span>
                        {r.model ? ` (${r.model})` : ''}: {r.error ?? 'Failed'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </form>

          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={handleCreateTemplate} className="marketing-card space-y-4">
              <h2 className="font-semibold">Template editor</h2>
              {data.templates.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Edit existing template</label>
                  <select
                    value={editTemplateId}
                    onChange={(e) => setEditTemplateId(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">New template</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Layout preset</label>
                <select value={layoutPreset} onChange={(e) => setLayoutPreset(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                  <option value="popcorn">Popcorn (hero + inset + text bar)</option>
                  <option value="minimal">Minimal (same engine, popcorn layout)</option>
                  <option value="tech_pulse">Tech Pulse (same engine, popcorn layout)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Accent color</label>
                  <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 w-full cursor-pointer rounded-md border border-border" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bar background</label>
                  <input type="color" value={barBg} onChange={(e) => setBarBg(e.target.value)} className="h-10 w-full cursor-pointer rounded-md border border-border" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium">Headline text size</label>
                  <span className="text-sm tabular-nums text-muted-foreground">{textSize}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={textSize}
                  onChange={(e) => setTextSize(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-xs text-muted-foreground">1 = smallest · 100 = largest</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Page name on image</label>
                {data.pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a Facebook page</Link> to show its name on each graphic.
                  </p>
                ) : (
                  <>
                    <select
                      value={previewPageId}
                      onChange={(e) => setPreviewPageId(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      {data.pages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">Each published graphic uses the assigned page&apos;s Facebook name (not a logo).</p>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">CTA text on image</label>
                <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="READ MORE INFO IN THE COMMENT" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Default hashtags</label>
                <input value={defaultHashtagsStr} onChange={(e) => setDefaultHashtagsStr(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="#News #BritishTV" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">AI tone prompt (optional)</label>
                <input value={aiTonePrompt} onChange={(e) => setAiTonePrompt(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="dramatic and emotional" />
                <p className="text-xs text-muted-foreground">Used to shorten and style headlines for the on-image overlay. Headlines are pre-checked against your template (max 4 lines) before the image is generated.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handlePreviewTemplate}
                  disabled={previewing}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  <Eye className={`h-4 w-4 ${previewing ? 'animate-pulse' : ''}`} />
                  {previewing ? 'Generating…' : 'Preview template'}
                </button>
                <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                  {editTemplateId ? 'Update template' : 'Save template'}
                </button>
                {editTemplateId && (
                  <button type="button" onClick={handleDuplicateTemplate} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">
                    Duplicate
                  </button>
                )}
              </div>
              {previewUrl && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Sample post preview (1080×1350)</p>
                  <img src={previewUrl} alt="Template preview" className="w-full max-w-xs rounded-lg border border-border shadow-sm" />
                </div>
              )}
            </form>

            <form onSubmit={handleCreateFeed} className="marketing-card space-y-4">
              <h2 className="font-semibold">Add RSS feed</h2>
              {data.pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a Facebook page</Link> first.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Feed name</label>
                    <input value={feedName} onChange={(e) => setFeedName(e.target.value)} required className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="BBC Entertainment" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">RSS URL</label>
                    <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} required className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="https://..." />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Facebook page</label>
                    {publishablePages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No real Facebook pages found.{' '}
                        <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a real page</Link>{' '}
                        (demo pages like Adam Sullivan cannot publish).
                      </p>
                    ) : (
                      <select value={feedPageId} onChange={(e) => setFeedPageId(e.target.value)} required className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                        {publishablePages.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Template</label>
                    <select value={feedTemplateId} onChange={(e) => setFeedTemplateId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                      <option value="">Default colors</option>
                      {data.templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={publishablePages.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                    <Rss className="h-4 w-4" />
                    Add feed
                  </button>
                </>
              )}
            </form>
          </div>

          {data.pages.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <form onSubmit={handleSavePageSettings} className="marketing-card space-y-4">
                <h2 className="font-semibold">Page automation</h2>
                <p className="text-xs text-muted-foreground">Assign template, schedule, and publish options per Facebook page.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Facebook page</label>
                  <select value={settingsPageId} onChange={(e) => setSettingsPageId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                    {data.pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template</label>
                  <select value={pageTemplateId} onChange={(e) => setPageTemplateId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                    <option value="">Default</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />
                  Auto-publish on schedule (off = review queue)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Posts per day</label>
                    <input type="number" min={1} max={24} value={postsPerDay} onChange={(e) => setPostsPerDay(Number(e.target.value))} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Schedule offset (min)</label>
                    <input type="number" min={0} max={59} value={scheduleOffset} onChange={(e) => setScheduleOffset(Number(e.target.value))} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Schedule times</label>
                  <input value={scheduleTimesStr} onChange={(e) => setScheduleTimesStr(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" placeholder="07:30, 10:00, 13:00, 16:00" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Timezone</label>
                  <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Page hashtags</label>
                  <input value={pageHashtagsStr} onChange={(e) => setPageHashtagsStr(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={commentLinkEnabled} onChange={(e) => setCommentLinkEnabled(e.target.checked)} />
                  Post article link in first comment
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeLinkInCaption} onChange={(e) => setIncludeLinkInCaption(e.target.checked)} />
                  Include link in caption
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={aiRewriteEnabled} onChange={(e) => setAiRewriteEnabled(e.target.checked)} />
                  AI rewrite full caption (requires AI key above; image headlines always use AI when configured)
                </label>
                <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Save page settings</button>
              </form>

              <form onSubmit={handleBulkSetup} className="marketing-card space-y-4">
                <h2 className="font-semibold">Bulk page setup</h2>
                <p className="text-xs text-muted-foreground">Apply template and copy feeds/settings to many pages. Each page gets +5 min schedule offset by default.</p>
                <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border border-border p-2">
                  {data.pages.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={bulkPageIds.includes(p.id)}
                        onChange={(e) => {
                          setBulkPageIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                          )
                        }}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template to assign</label>
                  <select value={bulkTemplateId} onChange={(e) => setBulkTemplateId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                    <option value="">Keep existing / use copy source</option>
                    {data.templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Copy config from page</label>
                  <select value={bulkCopyFromPageId} onChange={(e) => setBulkCopyFromPageId(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
                    <option value="">None</option>
                    {data.pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={bulkApplying} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {bulkApplying ? 'Applying…' : 'Apply to selected pages'}
                </button>
              </form>
            </div>
          )}

          {data.feeds.length > 0 && (
            <div className="marketing-card">
              <h2 className="mb-3 font-semibold">Active feeds</h2>
              <ul className="space-y-2 text-sm">
                {data.feeds.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{f.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-md">{f.url}</p>
                      <p className="text-xs text-muted-foreground">
                        Page: {f.pageName ?? 'Unknown'}
                        {f.isMockPage && <span className="ml-2 font-medium text-destructive">Demo page — cannot publish</span>}
                      </p>
                      {f.lastError && <p className="text-xs text-destructive">{f.lastError}</p>}
                      {f.isMockPage && publishablePages.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="text-xs text-muted-foreground">Reassign to:</label>
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) void handleReassignFeed(f.id, e.target.value)
                            }}
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                          >
                            <option value="">Select real page…</option>
                            {publishablePages.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="text-xs text-muted-foreground">{f.lastPolledAt ? `Polled ${f.lastPolledAt}` : 'Not polled yet'}</span>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={pollingFeedId === f.id}
                          onClick={() => void handlePollFeed(f.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3 w-3 ${pollingFeedId === f.id ? 'animate-spin' : ''}`} />
                          Poll
                        </button>
                        <button
                          type="button"
                          disabled={deletingFeedId === f.id}
                          onClick={() => void handleDeleteFeed(f.id, f.name)}
                          className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2 py-1 text-xs text-destructive disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="marketing-card">
            <h2 className="mb-3 font-semibold">Queue</h2>
            {mockFeedAssigned && (
              <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Your RSS feed is assigned to a demo page (AI Baby Magic / Adam Sullivan / Adin Ross). Meta rejects those with
                &quot;Invalid OAuth access token&quot;. Reassign the feed to a real page under Active feeds below, then click Publish again.
              </p>
            )}
            {data.pages.some((p) => !p.autoPublish) && (
              <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
                Review mode: pages with auto-publish off require manual Publish. Native photo posts qualify for Facebook Content Monetization.
              </p>
            )}
            {data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet. Add a feed and poll.</p>
            ) : (
              <ul className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row">
                    {item.status === 'ready' || item.status === 'posted' ? (
                      <button
                        type="button"
                        onClick={() => setViewItemId(item.id)}
                        className="group relative h-40 w-32 shrink-0 overflow-hidden rounded-md bg-muted"
                        title="View full image"
                      >
                        <img
                          src={itemPreviewSrc(item.id)}
                          alt=""
                          className="h-full w-full object-cover transition group-hover:opacity-80"
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px] font-semibold text-white">
                          {item.status === 'ready' ? 'Edit' : 'View'}
                        </span>
                      </button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      {item.headline && item.postTitle && item.headline.replace(/\s+/g, ' ').toUpperCase() !== item.postTitle.replace(/\s+/g, ' ').toUpperCase() ? (
                        <>
                          <p className="text-xs font-medium text-primary line-clamp-2">On image: {item.headline.replace(/\n+/g, ' ')}</p>
                          <p className="mt-1 font-medium line-clamp-2">Caption: {item.postTitle}</p>
                        </>
                      ) : (
                        <p className="font-medium line-clamp-2">{item.postTitle ?? item.headline}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.postDescription}</p>
                      <p className="mt-2 text-xs">
                        <span className="rounded bg-muted px-2 py-0.5">{item.status}</span>
                        {item.errorMessage && <span className="ml-2 text-destructive">{item.errorMessage}</span>}
                      </p>
                    </div>
                    {(item.status === 'ready' || item.status === 'posted') && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setViewItemId(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
                        >
                          {item.status === 'ready' ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {item.status === 'ready' ? 'Edit' : 'View image'}
                        </button>
                        {item.status === 'ready' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRegenerateImage(item.id)}
                              disabled={regeneratingId === item.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${regeneratingId === item.id ? 'animate-spin' : ''}`} />
                              {regeneratingId === item.id ? 'Regenerating…' : 'Regenerate'}
                            </button>
                            <button type="button" onClick={() => handlePublish(item.id)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                              <Send className="h-3.5 w-3.5" />
                              Publish
                            </button>
                            <button type="button" onClick={() => handleSkip(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs">
                              <SkipForward className="h-3.5 w-3.5" />
                              Skip
                            </button>
                            <button
                              type="button"
                              disabled={deletingItemId === item.id}
                              onClick={() => void handleDeleteItem(item.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="marketing-card text-sm text-muted-foreground">
          Could not load news feed data. If you just added this feature, restart the dev server (<code className="text-xs">npm run dev</code>) and refresh.
        </div>
      )}
      {viewItemId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4"
          onClick={() => setViewItemId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Edit news graphic"
        >
          <div
            className="relative my-auto w-full max-w-5xl rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="font-semibold">{canEditViewingItem ? 'Edit graphic & text' : 'Graphic preview'}</h2>
                <p className="text-xs text-muted-foreground">
                  {canEditViewingItem
                    ? 'Fix the headline on the image, caption text, or swap the photo — then save to regenerate.'
                    : 'This item was already posted — preview only.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewItemId(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-4 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Preview (1080×1350)</p>
                <button
                  type="button"
                  onClick={() => canEditViewingItem && document.getElementById('news-hero-upload')?.click()}
                  className={`group relative block w-full overflow-hidden rounded-lg border border-border bg-muted ${canEditViewingItem ? 'cursor-pointer' : 'cursor-default'}`}
                  title={canEditViewingItem ? 'Click to replace hero photo' : undefined}
                >
                  <img
                    src={itemPreviewSrc(viewItemId)}
                    alt="Generated news graphic"
                    className="mx-auto max-h-[70vh] w-full object-contain"
                  />
                  {canEditViewingItem && (
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-2 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
                      <ImagePlus className="h-3.5 w-3.5" />
                      Replace photo
                    </span>
                  )}
                </button>
                {heroUploadName && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">New photo selected: {heroUploadName}</p>
                )}
              </div>

              {canEditViewingItem ? (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSaveItemEdit()
                  }}
                >
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Headline on image</label>
                    <textarea
                      value={editHeadline}
                      onChange={(e) => setEditHeadline(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm uppercase"
                      placeholder="SHORT HEADLINE FOR THE GRAPHIC"
                    />
                    <p className="text-xs text-muted-foreground">This is the big text burned into the picture. Edit it here if AI got it wrong.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Highlighted words (optional)</label>
                    <input
                      value={editAccentWords}
                      onChange={(e) => setEditAccentWords(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm uppercase"
                      placeholder="WORD1, WORD2"
                    />
                    <p className="text-xs text-muted-foreground">Words shown in accent color on the image. Comma-separated.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Caption title</label>
                    <input
                      value={editPostTitle}
                      onChange={(e) => setEditPostTitle(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Caption description</label>
                    <textarea
                      value={editPostDescription}
                      onChange={(e) => setEditPostDescription(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Hero photo URL</label>
                    <input
                      value={editHeroUrl}
                      onChange={(e) => setEditHeroUrl(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                      placeholder="https://..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Upload hero photo</label>
                    <input
                      id="news-hero-upload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => void handleHeroFileChange(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById('news-hero-upload')?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
                    >
                      <ImagePlus className="h-4 w-4" />
                      Choose image file
                    </button>
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <p className="text-sm font-medium">Crop & fit to template</p>
                    <p className="text-xs text-muted-foreground">
                      Adjust how the hero fills the 1080×880 top area and the circular inset. Save to apply to the graphic.
                    </p>
                    {heroCropPreviewSrc ? (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Hero crop preview</p>
                        <div className="relative aspect-[1080/880] w-full overflow-hidden rounded-md border border-border bg-black">
                          <img
                            src={heroCropPreviewSrc}
                            alt=""
                            className="h-full w-full object-cover transition-transform"
                            style={{
                              objectPosition: `${editImageCrop.heroFocusX}% ${editImageCrop.heroFocusY}%`,
                              transform: `scale(${editImageCrop.heroZoom})`,
                              transformOrigin: `${editImageCrop.heroFocusX}% ${editImageCrop.heroFocusY}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-xs">
                        <span className="font-medium">Hero horizontal {editImageCrop.heroFocusX}%</span>
                        <input type="range" min={0} max={100} value={editImageCrop.heroFocusX} onChange={(e) => updateCrop({ heroFocusX: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="font-medium">Hero vertical {editImageCrop.heroFocusY}%</span>
                        <input type="range" min={0} max={100} value={editImageCrop.heroFocusY} onChange={(e) => updateCrop({ heroFocusY: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                      <label className="space-y-1 text-xs sm:col-span-2">
                        <span className="font-medium">Hero zoom {editImageCrop.heroZoom.toFixed(1)}×</span>
                        <input type="range" min={1} max={3} step={0.1} value={editImageCrop.heroZoom} onChange={(e) => updateCrop({ heroZoom: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="font-medium">Inset horizontal {editImageCrop.insetFocusX}%</span>
                        <input type="range" min={0} max={100} value={editImageCrop.insetFocusX} onChange={(e) => updateCrop({ insetFocusX: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="font-medium">Inset vertical {editImageCrop.insetFocusY}%</span>
                        <input type="range" min={0} max={100} value={editImageCrop.insetFocusY} onChange={(e) => updateCrop({ insetFocusY: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                      <label className="space-y-1 text-xs sm:col-span-2">
                        <span className="font-medium">Inset zoom {editImageCrop.insetZoom.toFixed(1)}×</span>
                        <input type="range" min={1} max={3} step={0.1} value={editImageCrop.insetZoom} onChange={(e) => updateCrop({ insetZoom: Number(e.target.value) })} className="w-full accent-primary" />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditImageCrop({ ...DEFAULT_NEWS_IMAGE_CROP })}
                      className="text-xs text-primary hover:underline"
                    >
                      Reset crop to defaults
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Inset photo URL (optional)</label>
                    <input
                      value={editInsetUrl}
                      onChange={(e) => setEditInsetUrl(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                      placeholder="https://... (small square crop)"
                    />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground"
                      onChange={(e) => void handleInsetFileChange(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={savingEdit || !editHeadline.trim()}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      <Pencil className={`h-4 w-4 ${savingEdit ? 'animate-pulse' : ''}`} />
                      {savingEdit ? 'Saving…' : 'Save & update image'}
                    </button>
                    <button
                      type="button"
                      disabled={regeneratingId === viewItemId}
                      onClick={() => void handleRegenerateImage(viewItemId)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      <RefreshCw className={`h-4 w-4 ${regeneratingId === viewItemId ? 'animate-spin' : ''}`} />
                      Re-run AI
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center text-sm text-muted-foreground">
                  Posted items cannot be edited here. Duplicate the RSS item on the next poll or edit before publishing.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
