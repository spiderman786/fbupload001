import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Newspaper, RefreshCw, Rss, Send, SkipForward } from 'lucide-react'
import { api, type NewsBrandType, type NewsOverview, type NewsTemplateColors } from '../../api/client'
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

  const [templateName, setTemplateName] = useState('Default News')
  const [layoutPreset, setLayoutPreset] = useState('popcorn')
  const [accentColor, setAccentColor] = useState(DEFAULT_COLORS.accent)
  const [barBg, setBarBg] = useState(DEFAULT_COLORS.barBg)
  const [ctaText, setCtaText] = useState('READ MORE INFO IN THE COMMENT')
  const [defaultHashtagsStr, setDefaultHashtagsStr] = useState('#News')
  const [aiTonePrompt, setAiTonePrompt] = useState('')
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [editTemplateId, setEditTemplateId] = useState('')
  const [brandType, setBrandType] = useState<NewsBrandType>('page_name')
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
    setLogoPath(t.logoPath)
    setBrandType(t.brandType)
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
      })
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
        brandType,
        ctaText,
        logoPath,
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
      brandType,
      ctaText,
      defaultHashtags: parseHashtags(defaultHashtagsStr),
      aiTonePrompt,
      logoPath,
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

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Read failed'))
        reader.readAsDataURL(file)
      })
      const res = await api.news.uploadLogo({ dataUrl, fileName: file.name })
      setLogoPath(res.logoPath)
      toast.success('Logo uploaded')
    } catch (err) {
      toast.error(getApiError(err, 'Logo upload failed'))
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
                <label className="text-sm font-medium">Brand display</label>
                <select
                  value={brandType}
                  onChange={(e) => setBrandType(e.target.value as NewsBrandType)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="page_name">Page name (default)</option>
                  <option value="logo">Logo image</option>
                  <option value="none">None</option>
                </select>
              </div>
              {brandType === 'page_name' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Preview page</label>
                  {data.pages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a Facebook page</Link> to preview its name.
                    </p>
                  ) : (
                    <select
                      value={previewPageId}
                      onChange={(e) => setPreviewPageId(e.target.value)}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      {data.pages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
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
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Logo PNG</label>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-sm" />
                {logoPath && <p className="text-xs text-muted-foreground truncate">Saved: {logoPath}</p>}
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
                  AI rewrite headlines (requires OPENAI_API_KEY)
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
                    <span className="text-xs text-muted-foreground">{f.lastPolledAt ? `Polled ${f.lastPolledAt}` : 'Not polled yet'}</span>
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
                      <img
                        src={api.news.previewUrl(item.id)}
                        alt=""
                        className="h-40 w-32 shrink-0 rounded-md object-cover bg-muted"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium line-clamp-2">{item.postTitle ?? item.headline}</p>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.postDescription}</p>
                      <p className="mt-2 text-xs">
                        <span className="rounded bg-muted px-2 py-0.5">{item.status}</span>
                        {item.errorMessage && <span className="ml-2 text-destructive">{item.errorMessage}</span>}
                      </p>
                    </div>
                    {item.status === 'ready' && (
                      <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={() => handlePublish(item.id)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                          <Send className="h-3.5 w-3.5" />
                          Publish
                        </button>
                        <button type="button" onClick={() => handleSkip(item.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs">
                          <SkipForward className="h-3.5 w-3.5" />
                          Skip
                        </button>
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
    </div>
  )
}
