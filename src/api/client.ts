const BASE = '/api'

type ApiError = { error: string; needsVerification?: boolean; email?: string }

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
  } catch {
    throw {
      error:
        'Could not reach the server. Check your internet connection. If you are on an office network, try mobile data or ask IT to allow app.fbuploadplus.com.',
    } as ApiError
  }

  const data = await res.json().catch(() => ({} as Partial<ApiError>))
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      unauthorizedHandler?.()
    }
    const message =
      typeof data.error === 'string' && data.error.trim()
        ? data.error
        : `Request failed (${res.status}). Please try again.`
    throw { ...data, error: message } as ApiError
  }
  return data as T
}

export const api = {
  auth: {
    session: () => request<SessionResponse>('/auth/session'),
    signup: (body: SignupBody) =>
      request<{ message: string; userId: string; agencySubdomain?: string; agencyUrl?: string | null }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    signupStatus: () => request<{ enabled: boolean }>('/auth/signup-status'),
    verify: (body: { email: string; code: string }) =>
      request<SessionResponse & { message: string }>('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),
    resendVerification: (email: string) =>
      request<{ message: string }>('/auth/send-verification', { method: 'POST', body: JSON.stringify({ email }) }),
    login: (body: { email: string; password: string }) =>
      request<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    forgotPassword: (email: string) =>
      request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (body: { email: string; code: string; password: string }) =>
      request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
    me: () => request<{ user: User }>('/auth/me'),
    updateProfile: (body: Partial<SignupBody & { currentPassword?: string; newPassword?: string }>) =>
      request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  pages: {
    list: () => request<{ pages: FacebookPage[] }>('/pages'),
    hub: (params?: { search?: string; status?: string; sort?: string; page?: number; perPage?: number }) => {
      const q = new URLSearchParams()
      if (params?.search) q.set('search', params.search)
      if (params?.status) q.set('status', params.status)
      if (params?.sort) q.set('sort', params.sort)
      if (params?.page) q.set('page', String(params.page))
      if (params?.perPage) q.set('perPage', String(params.perPage))
      const qs = q.toString()
      return request<{
        stats: {
          totalPages: number
          followersGained: number
          totalFollowers: number
          totalFollowersLabel: string
          lastFollowersSyncAt: string | null
        }
        pages: AutomationPage[]
        pagination: { page: number; perPage: number; totalCount: number; totalPages: number }
      }>(`/pages/hub${qs ? `?${qs}` : ''}`)
    },
    syncFollowers: () =>
      request<{
        message: string
        synced: number
        failed: number
        errors: string[]
        lastFollowersSyncAt: string | null
      }>('/pages/sync-followers', { method: 'POST' }),
    update: (id: string, body: { status?: string; dailyReelLimit?: number }) =>
      request<{ page: FacebookPage }>(`/pages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => request<{ message: string }>(`/pages/${id}`, { method: 'DELETE' }),
    connectDemo: () => request<{ page: FacebookPage }>('/pages/demo', { method: 'POST' }),
    detail: (id: string) => request<PageDetail>(`/pages/${id}/detail`),
    insights: (id: string, days = 28) =>
      request<{ insights: PageInsightsPayload }>(`/pages/${id}/insights?days=${days}`),
    queue: (id: string) => request<{ queue: PageQueueItem[] }>(`/pages/${id}/queue`),
    failedPosts: (id: string) =>
      request<{ posts: PageFailedPost[]; reasons: PageFailedReason[] }>(`/pages/${id}/failed-posts`),
    reels: (id: string) =>
      request<{ queue: PageQueueItem[]; history: PageReelHistoryItem[] }>(`/pages/${id}/reels`),
    queuePreviewUrl: (pageId: string, jobId: string, kind: 'video' | 'thumb' = 'video', version = 0) =>
      `${BASE}/pages/${pageId}/queue/${jobId}/preview?${kind === 'thumb' ? 'type=thumb&' : ''}v=${version}`,
    updateQueueCaption: (pageId: string, jobId: string, caption: string) =>
      request<{ caption: string }>(`/pages/${pageId}/queue/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption }),
      }),
    skipQueueItem: (pageId: string, jobId: string) =>
      request<{ message: string }>(`/pages/${pageId}/queue/${jobId}/skip`, { method: 'POST' }),
    deleteQueueItem: (pageId: string, jobId: string) =>
      request<{ message: string }>(`/pages/${pageId}/queue/${jobId}`, { method: 'DELETE' }),
    refreshQueueItem: (pageId: string, jobId: string) =>
      request<{ jobId: string; hasPreview: boolean; hasThumbnail: boolean; refreshed: string }>(
        `/pages/${pageId}/queue/${jobId}/refresh`,
        { method: 'POST' },
      ),
    refreshMissingQueuePreviews: (pageId: string) =>
      request<{
        attempted: number
        refreshed: number
        failed: number
        purged?: number
        background?: boolean
        alreadyRunning?: boolean
        results: { jobId: string; ok: boolean; error?: string }[]
      }>(`/pages/${pageId}/queue/refresh-missing`, { method: 'POST' }),
    dedupeQueue: (pageId: string) =>
      request<{ message: string; removed: number; kept: number }>(`/pages/${pageId}/queue/dedupe`, {
        method: 'POST',
      }),
    retryScrape: (pageId: string) =>
      request<{ message: string; created: number; target: number }>(`/pages/${pageId}/retry-scrape`, {
        method: 'POST',
      }),
    updateAutomationSettings: (
      id: string,
      body: {
        postsPerDay?: number
        postingLogic?: string
        timezone?: string
        scheduleTimes?: string[]
        hashtags?: string[]
        regenerateRandomTimes?: boolean
      },
    ) =>
      request<{
        settings: PageAutomationSettings
        queueSync?: { trimmed: number; created: number; target: number } | null
      }>(`/pages/${id}/automation-settings`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
  sources: {
    list: () => request<{ sources: SourceAccount[] }>('/sources'),
    create: (body: { platform: string; username: string }) =>
      request<{ source: SourceAccount }>('/sources', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { isActive?: boolean }) =>
      request<{ source: SourceAccount }>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => request<{ message: string }>(`/sources/${id}`, { method: 'DELETE' }),
  },
  schedule: {
    presets: () =>
      request<{
        timezone: string
        currentTime: string
        presets: EngagementPreset[]
      }>('/schedule/presets'),
    list: (mode?: 'direct' | 'inapp') =>
      request<{
        timezone: string
        currentTime: string
        slots: ScheduleSlot[]
      }>(`/schedule${mode ? `?mode=${mode}` : ''}`),
    applyPreset: (body: { presetId: string; publishMode?: 'direct' | 'inapp'; pageIds?: string[]; replace?: boolean }) =>
      request<{ message: string; preset: { id: string; name: string; reelsPerDay: number }; slots: ScheduleSlot[] }>(
        '/schedule/apply-preset',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    create: (body: { time: string; pageIds?: string[]; publishMode?: 'direct' | 'inapp'; timezone?: string }) =>
      request<{ slot: ScheduleSlot }>('/schedule', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { time?: string; pageIds?: string[]; timezone?: string }) =>
      request<{ slot: ScheduleSlot }>(`/schedule/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => request<{ message: string }>(`/schedule/${id}`, { method: 'DELETE' }),
  },
  tokens: {
    balance: () =>
      request<{
        balance: number
        costPerToken: number
        canCredit?: boolean
        canRequest?: boolean
        ownerEmail?: string | null
      }>('/tokens/balance'),
    transactions: () => request<{ transactions: TokenTransaction[] }>('/tokens'),
    request: (amount: number, note?: string) =>
      request<{ whatsappUrl: string; amount: number; totalPkr: number; message: string; ownerEmail?: string | null }>(
        '/tokens/request',
        {
          method: 'POST',
          body: JSON.stringify({ amount, note }),
        },
      ),
  },
  facebook: {
    status: () => request<{ configured: boolean; mockMode: boolean }>('/facebook/status'),
    oauthUrl: (byocCredentialId?: string) => {
      const q = byocCredentialId ? `?byocCredentialId=${encodeURIComponent(byocCredentialId)}` : ''
      return request<{ url: string; byocCredentialId?: string | null }>(`/facebook/oauth${q}`)
    },
    getMagicLink: (byocCredentialId?: string) => {
      const q = byocCredentialId ? `?byocCredentialId=${encodeURIComponent(byocCredentialId)}` : ''
      return request<{
        id: string
        url: string
        appUrl: string
        agencyCallbackUrl: string | null
        appCallbackUrl: string
        agencySubdomain: string | null
        expiresAt: string
        byocCredentialId: string | null
      }>(`/facebook/magic-link${q}`)
    },
    createMagicLink: (byocCredentialId?: string, options?: { regenerate?: boolean; label?: string }) =>
      request<{
        id: string
        url: string
        appUrl: string
        agencyCallbackUrl: string | null
        appCallbackUrl: string
        agencySubdomain: string | null
        expiresAt: string
        byocCredentialId: string | null
      }>(
        '/facebook/magic-link',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(byocCredentialId ? { byocCredentialId } : {}),
            ...(options?.regenerate ? { regenerate: true } : {}),
            ...(options?.label ? { label: options.label } : {}),
          }),
        },
      ),
    startMagicLink: (token: string) =>
      request<{ url: string; state: string }>(`/facebook/magic-link/${encodeURIComponent(token)}/start`),
    callback: (code: string, state?: string) =>
      request<{ message: string; pagesConnected: number }>('/facebook/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }),
    connectMock: (byocCredentialId?: string) =>
      request<{ message: string; pagesConnected: number }>('/facebook/connect-mock', {
        method: 'POST',
        body: JSON.stringify(byocCredentialId ? { byocCredentialId } : {}),
      }),
    accounts: () =>
      request<{
        accounts: {
          id: string
          meta_user_id: string
          display_name: string | null
          connected_at: string
          byoc_credential_id: string | null
          byoc_label: string | null
          byoc_app_id: string | null
        }[]
      }>('/facebook/accounts'),
    accountPages: (accountId: string) =>
      request<{ pages: { id: string; name: string; followers?: string; fanCount: number }[] }>(
        `/facebook/accounts/${accountId}/pages`,
      ),
    connectPages: (accountId: string, pageIds: string[]) =>
      request<{
        message: string
        pagesConnected: number
        skipped?: number
        ids: string[]
        connectedPages?: { id: string; metaPageId: string }[]
      }>(`/facebook/accounts/${accountId}/connect-pages`, {
        method: 'POST',
        body: JSON.stringify({ pageIds }),
      }),
  },
  reels: {
    list: () => request<{ jobs: ReelJob[] }>('/reels'),
    stats: () =>
      request<{
        tokenBalance: number
        activePages: number
        sourceAccounts: number
        reelsPostedToday: number
      }>('/reels/stats'),
  },
  dashboard: {
    stats: () =>
      request<{
        tokenBalance: number
        connectedPages: number
        activePages: number
        followersGained: number
        inAppPending: number
        directScheduled: number
        needsAttention: number
        updatedAt: string
      }>('/dashboard/stats'),
    attention: (params?: { filter?: string; search?: string }) => {
      const q = new URLSearchParams()
      if (params?.filter) q.set('filter', params.filter)
      if (params?.search) q.set('search', params.search)
      const qs = q.toString()
      return request<{ pages: AttentionPage[] }>(`/dashboard/attention${qs ? `?${qs}` : ''}`)
    },
    onboarding: () =>
      request<{
        steps: {
          tokenBalanceReady: boolean
          byocConnected: boolean
          facebookAccountAdded: boolean
          aduPageAdded: boolean
        }
        complete: boolean
        completedCount: number
        totalSteps: number
      }>('/dashboard/onboarding'),
  },
  automation: {
    assignments: () =>
      request<{
        assignments: { pageId: string; sourceId: string; pageName: string; sourceUsername: string; platform: string }[]
      }>('/automation/assignments'),
    assignSource: (pageId: string, sourceId: string) =>
      request<{ message: string }>(`/automation/assignments/${pageId}`, {
        method: 'PUT',
        body: JSON.stringify({ sourceId }),
      }),
    directPost: (pageId: string, sourceId?: string) =>
      request<{ message: string; jobId: string }>('/automation/direct-post', {
        method: 'POST',
        body: JSON.stringify({ pageId, sourceId }),
      }),
    listPosts: (pageId: string) =>
      request<{ posts: { id: string; message?: string; created_time: string; permalink_url?: string }[]; mockMode?: boolean }>(
        `/automation/posts/${pageId}`,
      ),
    bulkDelete: (body: { pageId: string; postIds?: string[]; deleteAll?: boolean }) =>
      request<{ deleted: string[]; failed: { id: string; error: string }[]; mockMode?: boolean }>(
        '/automation/bulk-delete',
        { method: 'POST', body: JSON.stringify(body) },
      ),
    aiPost: (body: { pageId: string; prompt: string; postType?: 'text' | 'image' }) =>
      request<{ message: string; jobId?: string }>('/automation/ai-post', { method: 'POST', body: JSON.stringify(body) }),
    payout: (body: { pageId: string; amount: number; recipientId?: string }) =>
      request<{ message: string }>('/automation/payout', { method: 'POST', body: JSON.stringify(body) }),
  },
  news: {
    overview: () => request<NewsOverview>('/news/overview'),
    getAiSettings: () => request<{ aiSettings: NewsAiSettings }>('/news/ai-settings'),
    saveAiSettings: (body: {
      provider?: NewsAiProvider
      geminiApiKey?: string
      openaiApiKey?: string
    }) => request<{ message: string; aiSettings: NewsAiSettings }>('/news/ai-settings', { method: 'PUT', body: JSON.stringify(body) }),
    testAiConnection: () => request<NewsAiConnectionTest>('/news/ai-settings/test', { method: 'POST' }),
    createTemplate: (body: {
      name: string
      layoutPreset?: string
      colors?: NewsTemplateColors
      fonts?: NewsTemplateFonts
      logoPath?: string | null
      brandType?: NewsBrandType
      ctaText?: string
      defaultHashtags?: string[]
      aiTonePrompt?: string
    }) => request<{ template: NewsTemplateRow }>('/news/templates', { method: 'POST', body: JSON.stringify(body) }),
    previewTemplate: async (body: {
      colors?: NewsTemplateColors
      fonts?: NewsTemplateFonts
      ctaText?: string
      headline?: string
      accentWords?: string[]
      logoPath?: string | null
      brandType?: NewsBrandType
      pageId?: string
      pageName?: string
      layoutPreset?: string
    }) => {
      const res = await fetch(`${BASE}/news/templates/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Partial<ApiError>
        throw { error: data.error?.trim() || `Preview failed (${res.status})` } as ApiError
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('image/')) {
        throw { error: 'Preview returned an invalid response' } as ApiError
      }
      return res.blob()
    },
    updateTemplate: (
      id: string,
      body: Partial<{
        name: string
        layoutPreset: string
        colors: NewsTemplateColors
        fonts: NewsTemplateFonts
        logoPath: string | null
        brandType: NewsBrandType
        ctaText: string
        defaultHashtags: string[]
        aiTonePrompt: string
      }>,
    ) => request<{ template: NewsTemplateRow }>(`/news/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    uploadLogo: (body: { dataUrl: string; fileName?: string }) =>
      request<{ logoPath: string }>('/news/templates/logo', { method: 'POST', body: JSON.stringify(body) }),
    duplicateTemplate: (id: string, name?: string) =>
      request<{ template: NewsTemplateRow }>(`/news/templates/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    bulkSetup: (body: NewsBulkSetupBody) =>
      request<{ message: string; updated: number }>('/news/bulk-setup', { method: 'POST', body: JSON.stringify(body) }),
    createFeed: (body: { name: string; url: string; pageId: string; templateId?: string }) =>
      request<{ feed: NewsFeedRow }>('/news/feeds', { method: 'POST', body: JSON.stringify(body) }),
    updateFeed: (id: string, body: { pageId: string }) =>
      request<{ feed: NewsFeedRow }>(`/news/feeds/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteFeed: (id: string) => request<{ message: string }>(`/news/feeds/${id}`, { method: 'DELETE' }),
    savePageSettings: (pageId: string, body: Partial<NewsPageSettingsBody>) =>
      request<{ message: string }>(`/news/page-settings/${pageId}`, { method: 'PUT', body: JSON.stringify(body) }),
    pollAll: () => request<{ message: string; feeds: number; created: number }>('/news/poll', { method: 'POST' }),
    pollFeed: (id: string) => request<{ message: string; created: number }>(`/news/feeds/${id}/poll`, { method: 'POST' }),
    publishItem: (id: string) => request<{ message: string; postId: string }>(`/news/items/${id}/publish`, { method: 'POST' }),
    skipItem: (id: string) => request<{ message: string }>(`/news/items/${id}/skip`, { method: 'POST' }),
    regenerateItemImage: (
      id: string,
      body?: { aiInstruction?: string; rewriteCaption?: boolean },
    ) =>
      request<{ message: string; item: NewsItemRow }>(`/news/items/${id}/regenerate-image`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    refreshAllLayouts: () =>
      request<{ message: string; count: number; failed?: { id: string; error: string }[] }>(
        '/news/items/refresh-layouts',
        { method: 'POST' },
      ),
    deleteItem: (id: string) => request<{ message: string }>(`/news/items/${id}`, { method: 'DELETE' }),
    updateItem: (
      id: string,
      body: {
        headline?: string
        postTitle?: string
        postDescription?: string
        accentWords?: string[]
        heroImageUrl?: string
        insetImageUrl?: string
        heroImageDataUrl?: string
        insetImageDataUrl?: string
        imageCrop?: NewsImageCrop
      },
    ) =>
      request<{ message: string; item: NewsItemRow }>(`/news/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    testFetch: (url: string) =>
      request<{ count: number; articles: { title: string; link: string; imageUrl: string | null }[] }>('/news/test-fetch', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    previewUrl: (itemId: string) => `/api/news/items/${itemId}/preview`,
  },
  byoc: {
    listApps: (platform: string) =>
      request<{
        apps: ByocApp[]
        envFallback: boolean
        configured: boolean
      }>(`/byoc/${platform}/apps`),
    createApp: (
      platform: string,
      body: { label: string; appId: string; appSecret: string; redirectUri?: string },
    ) => request<{ message: string; app: ByocApp }>(`/byoc/${platform}/apps`, { method: 'POST', body: JSON.stringify(body) }),
    updateApp: (
      platform: string,
      id: string,
      body: { label?: string; appId?: string; appSecret?: string; redirectUri?: string },
    ) =>
      request<{ message: string; app: ByocApp }>(`/byoc/${platform}/apps/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteApp: (platform: string, id: string) =>
      request<{ message: string }>(`/byoc/${platform}/apps/${id}`, { method: 'DELETE' }),
    get: (platform: string) =>
      request<{
        configured: boolean
        hasByoc: boolean
        appCount: number
        apps: ByocApp[]
        appId: string | null
        redirectUri: string | null
        updatedAt: string | null
        usingEnvFallback: boolean
      }>(`/byoc/${platform}`),
    save: (platform: string, body: { appId: string; appSecret: string; redirectUri?: string; label?: string }) =>
      request<{ message: string }>(`/byoc/${platform}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (platform: string) =>
      request<{ message: string }>(`/byoc/${platform}`, { method: 'DELETE' }),
  },
  proxyPool: {
    stats: () =>
      request<{
        enabled: boolean
        poolSize: number
        availableNow: number
        directFirst: boolean
        maxAttemptsPerJob: number
        cooldownMs: number
        filePath: string
        fileExists: boolean
        fileLastModified: string | null
        proxies: {
          id: string
          label: string
          failures: number
          successes: number
          available: boolean
          cooldownUntil: string | null
          lastUsedAt: string | null
        }[]
      }>('/proxy-pool/stats'),
    fileInfo: () =>
      request<{
        filePath: string
        exists: boolean
        proxyCount: number
        invalidLines: number
        lastModified: string | null
        fileSize: number
      }>('/proxy-pool/file-info'),
    upload: (content: string) =>
      request<{
        count: number
        invalid: number
        duplicates: number
        filePath: string
        stats: {
          enabled: boolean
          poolSize: number
          availableNow: number
          directFirst: boolean
          maxAttemptsPerJob: number
          cooldownMs: number
          filePath: string
          fileExists: boolean
          fileLastModified: string | null
          proxies: {
            id: string
            label: string
            failures: number
            successes: number
            available: boolean
            cooldownUntil: string | null
            lastUsedAt: string | null
          }[]
        }
      }>('/proxy-pool/upload', { method: 'POST', body: JSON.stringify({ content }) }),
    reload: () =>
      request<{
        stats: {
          enabled: boolean
          poolSize: number
          availableNow: number
          directFirst: boolean
          maxAttemptsPerJob: number
          cooldownMs: number
          filePath: string
          fileExists: boolean
          fileLastModified: string | null
          proxies: {
            id: string
            label: string
            failures: number
            successes: number
            available: boolean
            cooldownUntil: string | null
            lastUsedAt: string | null
          }[]
        }
      }>('/proxy-pool/reload', { method: 'POST' }),
  },
  agencies: {
    switch: (agencyId: string) =>
      request<SessionResponse>('/agencies/switch', { method: 'POST', body: JSON.stringify({ agencyId }) }),
    updateSettings: (body: { name?: string; whatsappNumber?: string }) =>
      request<SessionResponse>('/agencies/current', { method: 'PATCH', body: JSON.stringify(body) }),
    members: () =>
      request<{
        members: { id: string; email: string; fullName: string; role: AgencyRole; joinedAt: string }[]
      }>('/agencies/members'),
    invites: () =>
      request<{
        invites: { id: string; email: string; role: AgencyRole; expiresAt: string; createdAt: string; invitedByName: string }[]
      }>('/agencies/invites'),
    invite: (email: string, role: 'admin' | 'staff') =>
      request<{ message: string; invite: { acceptUrl: string; email: string; role: string } }>('/agencies/invites', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
    revokeInvite: (id: string) => request<{ message: string }>(`/agencies/invites/${id}`, { method: 'DELETE' }),
    updateMemberRole: (userId: string, role: 'admin' | 'staff') =>
      request<{ message: string }>(`/agencies/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (userId: string) =>
      request<{ message: string }>(`/agencies/members/${userId}`, { method: 'DELETE' }),
    leave: () => request<SessionResponse>('/agencies/leave', { method: 'POST' }),
    previewInvite: (token: string) =>
      request<{ email: string; role: string; agencyName: string; expiresAt: string; expired: boolean }>(
        `/agencies/invites/preview?token=${encodeURIComponent(token)}`,
      ),
    acceptInvite: (token: string) =>
      request<SessionResponse>('/agencies/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }),
  },
  ops: {
    me: () => request<{ platformAdmin: boolean }>('/ops/me'),
    overview: () => request<OpsOverview>('/ops/overview'),
    agencies: () => request<{ agencies: OpsAgency[] }>('/ops/agencies'),
    agency: (id: string) =>
      request<{ agency: OpsAgency; pages: unknown[]; sources: unknown[]; members: OpsMember[]; notes: OpsNote[] }>(
        `/ops/agencies/${id}`,
      ),
    creditTokens: (id: string, amount: number) =>
      request<{ tokenBalance: number }>(`/ops/agencies/${id}/credit-tokens`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    deleteAgency: (id: string, confirmName: string) =>
      request<{ ok: boolean }>(`/ops/agencies/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmName }),
      }),
    pauseAllPages: (id: string) =>
      request<{ paused: number }>(`/ops/agencies/${id}/pause-pages`, { method: 'POST' }),
    setParentAgency: (id: string, parentAgencyId: string | null) =>
      request<{ ok: boolean }>(`/ops/agencies/${id}/parent`, {
        method: 'PATCH',
        body: JSON.stringify({ parentAgencyId }),
      }),
    setAgencyMaintenance: (id: string, enabled: boolean) =>
      request<{ maintenance: boolean }>(`/ops/agencies/${id}/maintenance`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    bulkCredit: (agencyIds: string[], amount: number) =>
      request<{ credited: number }>('/ops/agencies/bulk-credit', {
        method: 'POST',
        body: JSON.stringify({ agencyIds, amount }),
      }),
    addNote: (id: string, note: string) =>
      request<{ id: string; note: string }>(`/ops/agencies/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    setMemberRole: (agencyId: string, userId: string, role: 'owner' | 'admin' | 'staff') =>
      request<{ message: string; role: string }>(`/ops/agencies/${agencyId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    pages: (params?: { status?: string; health?: string }) => {
      const q = new URLSearchParams()
      if (params?.status) q.set('status', params.status)
      if (params?.health) q.set('health', params.health)
      const qs = q.toString()
      return request<{ pages: OpsPage[] }>(`/ops/pages${qs ? `?${qs}` : ''}`)
    },
    updatePage: (id: string, status: 'active' | 'paused') =>
      request<{ ok: boolean }>(`/ops/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    jobs: (params?: { status?: string; agencyId?: string; limit?: number }) => {
      const q = new URLSearchParams()
      if (params?.status) q.set('status', params.status)
      if (params?.agencyId) q.set('agencyId', params.agencyId)
      if (params?.limit) q.set('limit', String(params.limit))
      const qs = q.toString()
      return request<{ jobs: OpsJob[] }>(`/ops/jobs${qs ? `?${qs}` : ''}`)
    },
    job: (id: string) => request<{ job: OpsJob; logs: OpsJobLog[] }>(`/ops/jobs/${id}`),
    retryJob: (id: string) => request<{ ok: boolean }>(`/ops/jobs/${id}/retry`, { method: 'POST' }),
    errorGroups: (days?: number) =>
      request<{ groups: OpsErrorGroup[]; days: number }>(`/ops/jobs/error-groups${days ? `?days=${days}` : ''}`),
    bulkRetry: (body: { errorMessage?: string; jobIds?: string[] }) =>
      request<{ retried: number }>('/ops/jobs/bulk-retry', { method: 'POST', body: JSON.stringify(body) }),
    explainJob: (id: string) => request<{ explanation: JobExplanation }>(`/ops/jobs/${id}/explain`),
    analytics: (days?: number) =>
      request<OpsAnalytics>(`/ops/analytics${days ? `?days=${days}` : ''}`),
    audit: (limit?: number) =>
      request<{ audit: OpsAuditEntry[] }>(`/ops/audit${limit ? `?limit=${limit}` : ''}`),
    alerts: () => request<{ alerts: OpsAlert[] }>('/ops/alerts'),
    runAlertChecks: () =>
      request<{ ok: boolean; alerts: OpsAlert[] }>('/ops/alerts/run-checks', { method: 'POST' }),
    system: () => request<OpsSystemInfo>('/ops/system'),
    impersonate: (agencyId: string) =>
      request<SessionResponse>(`/ops/impersonate/${agencyId}`, { method: 'POST' }),
    search: (q: string) => request<OpsSearchResults>(`/ops/search?q=${encodeURIComponent(q)}`),
    health: () => request<{ agencies: AgencyHealth[] }>('/ops/health'),
    settings: () => request<{ settings: Record<string, string>; alertConfig: OpsAlertConfig[] }>('/ops/settings'),
    updateSettings: (body: { settings?: Record<string, string>; alertConfig?: OpsAlertConfig[] }) =>
      request<{ settings: Record<string, string> }>('/ops/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    exportJobsUrl: (status = 'failed') => `/api/ops/export/jobs?status=${encodeURIComponent(status)}`,
    liveStreamUrl: () => '/api/ops/live/stream',
  },
}

export type ByocApp = {
  id: string
  label: string
  appId: string
  redirectUri: string
  updatedAt: string
  linkedAccounts: number
}

export type AgencyRole = 'owner' | 'admin' | 'staff'

export type AgencyInfo = {
  id: string
  name: string
  role: AgencyRole
  tokenBalance: number
  whatsappNumber: string | null
  subdomain: string | null
}

export type SessionResponse = {
  user: User
  agency: AgencyInfo | null
  agencies: AgencyInfo[]
  platformAdmin?: boolean
}

export type User = {
  id: string
  email: string
  fullName: string
  phoneCountryCode: string
  phoneNumber: string
  tokenBalance: number
  emailVerified: boolean
  createdAt: string
}

export type SignupBody = {
  fullName: string
  email: string
  password: string
  phoneCountryCode: string
  phoneNumber: string
  agencyName?: string
}

export type FacebookPage = {
  id: string
  metaPageId: string
  name: string
  followers: string
  status: 'active' | 'paused'
  healthStatus?: string
  followersGained?: number
  reelsPostedToday: number
  dailyReelLimit?: number
  reelsRemainingToday?: number
  lastPublishedAt: string | null
  createdAt: string
  lastFollowersSyncAt?: string | null
}

export type PageJobStats = {
  total: { posted: number; pending: number; failed: number }
  today: { pending: number; posted: number; failed: number }
}

export type AutomationPage = FacebookPage & {
  sourceUsername: string | null
  sourcePlatform: string | null
  facebookAccountName: string | null
  reelsStarted: number
  followersNumeric: number
  stats: PageJobStats
  scrape?: PageScrapeInfo
}

export type PageAutomationSettings = {
  postsPerDay: number
  postingLogic: string
  timezone: string
  scheduleTimes: string[]
  hashtags: string[]
}

export type PageScrapeInfo = {
  status: 'none' | 'scraping_pending' | 'pending_scrap' | 'scraping_error' | 'idle'
  label: string
  totalScraped: number
  catalogTotal: number | null
  errorMessage: string | null
  inflightDownloads: number
}

export type PageDetail = {
  page: AutomationPage
  source: {
    id: string
    username: string
    platform: string
    isActive: boolean
    scrapeStatus?: string
    scrapeLabel?: string
    scrapeError?: string | null
  } | null
  scrape: PageScrapeInfo
  facebookIdentity: { name: string; uid: string; connectedAt: string } | null
  settings: PageAutomationSettings
  stats: {
    total: { reelsReady: number; successfulAutomations: number; requireAttention: number; netGrowth: number; totalScraped: number }
    today: { remainingScheduled: number; publishedToday: number; errorsToday: number }
  }
}

export type PageInsightsPayload = {
  source: 'graph' | 'estimated' | 'mixed'
  graphLive?: boolean
  days: number
  summary: { totalAudience: number; pageReach: number; totalEngagements: number; videoViews3s: number }
  demographics: {
    countries: { name: string; count: number; pct: number }[]
    cities: { name: string; count: number; pct: number }[]
  }
  reachSeries: { day: string; profileViews: number; uniqueReach: number }[]
  followerGrowth: { day: string; gained: number; lost: number }[]
  videoPerformance: { day: string; views3s: number; views30s: number }[]
  engagementBreakdown: { day: string; likes: number; loves: number; hahas: number; wows: number; sads: number; angers: number }[]
  hashtags: string[]
}

export type PageQueueItem = {
  id: string
  status: string
  sourceUrl: string | null
  sourceReelId?: string | null
  sourceUsername: string | null
  sourcePlatform?: string | null
  caption?: string | null
  createdAt: string
  hasPreview?: boolean
  hasThumbnail?: boolean
  /** Cloudflare R2 signed URL when R2 buffer is configured (Pro-style) */
  previewVideoUrl?: string | null
  previewThumbUrl?: string | null
}

export type PageFailedPost = {
  id: string
  errorMessage: string | null
  completedAt: string | null
  retryCount: number
}

export type PageFailedReason = {
  errorMessage: string
  count: number
  lastAt: string
}

export type PageReelHistoryItem = {
  id: string
  status: string
  sourceUrl: string | null
  completedAt: string | null
}

export type AttentionPage = {
  id: string
  name: string
  healthStatus: string
  status: string
  followers: string
  followersGained?: number
}

export type SourceAccount = {
  id: string
  platform: string
  username: string
  tokensPerReel: number
  isActive: boolean
  autoDisabled?: boolean
  createdAt: string
}

export type ScheduleSlot = {
  id: string
  time: string
  timezone?: string
  engagementLabel?: string | null
  status: 'upcoming' | 'completed'
  publishMode?: 'direct' | 'inapp'
  pageIds: string[]
  pageCount: number
  lastRunAt: string | null
  createdAt: string
}

export type EngagementPreset = {
  id: string
  name: string
  description: string
  reelsPerDay: number
  timezone: string
  timezoneLabel: string
  slots: { time: string; label: string; peak: string }[]
}

export type TokenTransaction = {
  id: string
  amount: number
  type: string
  note: string | null
  reelJobId: string | null
  createdAt: string
}

export type ReelJob = {
  id: string
  sourceAccountId: string | null
  targetPageId: string | null
  status: string
  sourceUrl: string | null
  metaPostId: string | null
  tokensCharged: number
  errorMessage: string | null
  scheduledFor: string | null
  completedAt: string | null
  createdAt: string
  pageName: string | null
  sourceUsername: string | null
  jobType?: string
  sourceReelId?: string | null
  metadataStripped?: boolean
}

export type OpsOverview = {
  agencies: number
  users: number
  pages: number
  activePages: number
  pendingJobs: number
  publishedToday: number
  failedToday: number
  tokensSold: number
  tokensUsed: number
  proxy: {
    enabled: boolean
    poolSize: number
    availableNow: number
  }
  worker: { lastBeat: string; stale: boolean; activeJobs?: number; pid?: number } | null
}

export type OpsAgency = {
  id: string
  name: string
  token_balance: number
  created_at: string
  page_count?: number
  member_count?: number
  owner_email?: string
  parent_agency_id?: string | null
  parent_name?: string | null
  maintenance_mode?: number
  healthScore?: number | null
  healthStatus?: 'healthy' | 'warning' | 'critical' | null
}

export type OpsMember = { user_id: string; email: string; full_name: string; role: string; created_at: string }
export type OpsNote = { id: string; note: string; admin_email: string; created_at: string }

export type OpsPage = {
  id: string
  name: string
  agency_name: string
  status: string
  health_status: string | null
  followers: string
  last_published_at: string | null
}

export type OpsJob = {
  id: string
  status: string
  error_message: string | null
  agency_name: string | null
  page_name: string | null
  source_username: string | null
  source_url: string | null
  retry_count?: number
  created_at: string
  completed_at: string | null
}

export type OpsJobLog = {
  id: string
  step: string
  message: string
  level: string
  meta: Record<string, unknown> | null
  createdAt: string
}

export type OpsAnalytics = {
  daily: { day: string; published: number; failed: number }[]
  byPlatform: { platform: string; jobs: number; published: number; failed: number }[]
  topErrors: { error_message: string; count: number }[]
  agencyActivity: { name: string; token_balance: number; published_7d: number }[]
  days: number
}

export type OpsAuditEntry = {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, unknown> | null
  adminEmail: string
  adminName?: string
  createdAt: string
}

export type OpsAlert = {
  id: string
  alertType: string
  message: string
  sentTo: string
  createdAt: string
}

export type OpsSystemInfo = {
  worker: OpsOverview['worker']
  proxy: OpsOverview['proxy'] & Record<string, unknown>
  dbPath: string
  dbSizeBytes: number
  oldestPendingJob: { id: string; created_at: string } | null
  nodeVersion: string
  uptimeSec: number
}

export type OpsErrorGroup = { errorMessage: string; count: number; jobIds: string[] }

export type JobExplanation = {
  summary: string
  category: string
  likelyCause: string
  suggestedActions: string[]
  confidence: 'high' | 'medium' | 'low'
}

export type AgencyHealth = {
  agencyId: string
  name: string
  score: number
  status: 'healthy' | 'warning' | 'critical'
  reasons: string[]
  tokenBalance: number
  failed7d: number
  published7d: number
  activePages: number
}

export type OpsSearchResults = {
  query: string
  agencies: { id: string; name: string; token_balance: number; owner_email?: string }[]
  pages: { id: string; name: string; status: string; agency_name: string }[]
  jobs: { id: string; status: string; error_message: string | null; agency_name: string | null; page_name: string | null }[]
}

export type OpsAlertConfig = {
  alertType: string
  enabled?: boolean
  threshold?: number
  webhookUrl?: string
}

export type OpsLiveEvent = {
  type: 'job' | 'log' | 'connected'
  id: string
  jobId?: string
  status?: string
  step?: string
  message?: string
  level?: string
  agencyName?: string | null
  pageName?: string | null
  at: string
}

export type NewsTemplateColors = {
  accent: string
  text: string
  barBg: string
  cta: string
  insetBorder: string
}

export type NewsTemplateFonts = {
  headlineSize?: number
  textSize?: number
  ctaSize?: number
  pageNameSize?: number
}

export type NewsBrandType = 'page_picture' | 'page_name' | 'logo' | 'none'

export type NewsTemplateRow = {
  id: string
  name: string
  layoutPreset: string
  colors: NewsTemplateColors
  fonts: NewsTemplateFonts
  logoPath: string | null
  brandType: NewsBrandType
  ctaText: string
  defaultHashtags: string[]
  aiTonePrompt: string
  createdAt: string
  updatedAt: string
}

export type NewsFeedRow = {
  id: string
  name: string
  url: string
  pageId: string | null
  pageName?: string | null
  isMockPage?: boolean
  templateId: string | null
  isActive: boolean
  lastPolledAt: string | null
  lastError: string | null
  createdAt: string
}

export type NewsImageCrop = {
  heroFocusX: number
  heroFocusY: number
  heroZoom: number
  insetFocusX: number
  insetFocusY: number
  insetZoom: number
}

export const DEFAULT_NEWS_IMAGE_CROP: NewsImageCrop = {
  heroFocusX: 50,
  heroFocusY: 50,
  heroZoom: 1,
  insetFocusX: 50,
  insetFocusY: 50,
  insetZoom: 1,
}

export type NewsItemRow = {
  id: string
  feedId: string | null
  pageId: string | null
  templateId: string | null
  articleUrl: string
  headline: string | null
  postTitle: string | null
  postDescription: string | null
  accentWords: string[]
  hashtags: string[]
  heroImageUrl: string | null
  insetImageUrl: string | null
  imageCrop: NewsImageCrop
  generatedImagePath: string | null
  fbPostId: string | null
  status: string
  errorMessage: string | null
  postedAt: string | null
  createdAt: string
}

export type NewsPageRow = {
  id: string
  name: string
  metaPageId: string
  isMockPage?: boolean
  newsActive: boolean
  templateId: string | null
  autoPublish: boolean
  postsPerDay: number
  scheduleTimes: string[]
  timezone: string
  commentLinkEnabled: boolean
  includeLinkInCaption: boolean
  aiRewriteEnabled: boolean
  defaultHashtags: string[]
  scheduleOffsetMinutes: number
}

export type NewsBulkSetupBody = {
  pageIds: string[]
  templateId?: string | null
  copyFromPageId?: string
  autoPublish?: boolean
  postsPerDay?: number
  scheduleTimes?: string[]
  timezone?: string
  scheduleOffsetMinutes?: number
  commentLinkEnabled?: boolean
  includeLinkInCaption?: boolean
  aiRewriteEnabled?: boolean
  defaultHashtags?: string[]
  rssFeedUrl?: string
  rssFeedName?: string
}

export type NewsPageSettingsBody = {
  templateId?: string | null
  autoPublish?: boolean
  postsPerDay?: number
  scheduleTimes?: string[]
  timezone?: string
  commentLinkEnabled?: boolean
  includeLinkInCaption?: boolean
  aiRewriteEnabled?: boolean
  defaultHashtags?: string[]
  isActive?: boolean
  scheduleOffsetMinutes?: number
}

export type NewsAiProvider = 'gemini' | 'openai' | 'auto'

export type NewsAiSettings = {
  provider: NewsAiProvider
  geminiConfigured: boolean
  openaiConfigured: boolean
  aiAvailable: boolean
  envGemini: boolean
  envOpenai: boolean
}

export type NewsAiProviderTestResult = {
  provider: 'gemini' | 'openai'
  ok: boolean
  model?: string
  headline?: string
  error?: string
}

export type NewsAiConnectionTest = {
  ok: boolean
  results: NewsAiProviderTestResult[]
  sampleHeadline?: string
  error?: string
}

export type NewsOverview = {
  templates: NewsTemplateRow[]
  feeds: NewsFeedRow[]
  pages: NewsPageRow[]
  items: NewsItemRow[]
  stats: { ready: number; posted: number; failed: number }
  aiSettings?: NewsAiSettings
}
