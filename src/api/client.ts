const BASE = '/api'

type ApiError = { error: string; needsVerification?: boolean; email?: string }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw data as ApiError
  return data as T
}

export const api = {
  auth: {
    session: () => request<SessionResponse>('/auth/session'),
    signup: (body: SignupBody) =>
      request<{ message: string; userId: string }>('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
    verify: (body: { email: string; code: string }) =>
      request<SessionResponse & { message: string }>('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),
    resendVerification: (email: string) =>
      request<{ message: string }>('/auth/send-verification', { method: 'POST', body: JSON.stringify({ email }) }),
    login: (body: { email: string; password: string }) =>
      request<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
    me: () => request<{ user: User }>('/auth/me'),
    updateProfile: (body: Partial<SignupBody & { currentPassword?: string; newPassword?: string }>) =>
      request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  pages: {
    list: () => request<{ pages: FacebookPage[] }>('/pages'),
    hub: (params?: { search?: string; status?: string; sort?: string }) => {
      const q = new URLSearchParams()
      if (params?.search) q.set('search', params.search)
      if (params?.status) q.set('status', params.status)
      if (params?.sort) q.set('sort', params.sort)
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
    balance: () => request<{ balance: number; costPerToken: number }>('/tokens/balance'),
    transactions: () => request<{ transactions: TokenTransaction[] }>('/tokens'),
    request: (amount: number, note?: string) =>
      request<{ whatsappUrl: string; amount: number; totalPkr: number; message: string }>('/tokens/request', {
        method: 'POST',
        body: JSON.stringify({ amount, note }),
      }),
    credit: (amount: number, note?: string) =>
      request<{ balance: number; message: string }>('/tokens/credit', {
        method: 'POST',
        body: JSON.stringify({ amount, note }),
      }),
  },
  facebook: {
    status: () => request<{ configured: boolean; mockMode: boolean }>('/facebook/status'),
    oauthUrl: () => request<{ url: string }>('/facebook/oauth'),
    callback: (code: string, state?: string) =>
      request<{ message: string; pagesConnected: number }>('/facebook/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }),
    connectMock: () =>
      request<{ message: string; pagesConnected: number }>('/facebook/connect-mock', { method: 'POST' }),
    accounts: () => request<{ accounts: { id: string; meta_user_id: string; connected_at: string }[] }>('/facebook/accounts'),
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
  },
  byoc: {
    get: (platform: string) =>
      request<{
        configured: boolean
        hasByoc: boolean
        appId: string | null
        redirectUri: string | null
        updatedAt: string | null
        usingEnvFallback: boolean
      }>(`/byoc/${platform}`),
    save: (platform: string, body: { appId: string; appSecret: string; redirectUri?: string }) =>
      request<{ message: string }>(`/byoc/${platform}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (platform: string) =>
      request<{ message: string }>(`/byoc/${platform}`, { method: 'DELETE' }),
  },
  agencies: {
    switch: (agencyId: string) =>
      request<SessionResponse>('/agencies/switch', { method: 'POST', body: JSON.stringify({ agencyId }) }),
    updateName: (name: string) =>
      request<SessionResponse>('/agencies/current', { method: 'PATCH', body: JSON.stringify({ name }) }),
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
}

export type AgencyRole = 'owner' | 'admin' | 'staff'

export type AgencyInfo = {
  id: string
  name: string
  role: AgencyRole
  tokenBalance: number
}

export type SessionResponse = {
  user: User
  agency: AgencyInfo | null
  agencies: AgencyInfo[]
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

export type AutomationPage = FacebookPage & {
  sourceUsername: string | null
  reelsStarted: number
  followersNumeric: number
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
