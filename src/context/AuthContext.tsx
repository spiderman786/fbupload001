import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, type AgencyInfo, type SessionResponse, type User } from '../api/client'

type AuthContextValue = {
  user: User | null
  agency: AgencyInfo | null
  agencies: AgencyInfo[]
  role: AgencyInfo['role'] | null
  platformAdmin: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<SessionResponse>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  switchAgency: (agencyId: string) => Promise<void>
  setSession: (session: SessionResponse) => void
  /** @deprecated use setSession */
  setUser: (user: User | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function applySession(setters: {
  setUser: (u: User | null) => void
  setAgency: (a: AgencyInfo | null) => void
  setAgencies: (a: AgencyInfo[]) => void
  setPlatformAdmin: (v: boolean) => void
}, session: SessionResponse | null) {
  if (!session) {
    setters.setUser(null)
    setters.setAgency(null)
    setters.setAgencies([])
    setters.setPlatformAdmin(false)
    return
  }
  setters.setUser(session.user)
  setters.setAgency(session.agency)
  setters.setAgencies(session.agencies)
  setters.setPlatformAdmin(Boolean(session.platformAdmin))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [agency, setAgency] = useState<AgencyInfo | null>(null)
  const [agencies, setAgencies] = useState<AgencyInfo[]>([])
  const [platformAdmin, setPlatformAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const setSession = useCallback((session: SessionResponse) => {
    applySession({ setUser, setAgency, setAgencies, setPlatformAdmin }, session)
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const session = await api.auth.session()
      setSession(session)
    } catch {
      applySession({ setUser, setAgency, setAgencies, setPlatformAdmin }, null)
    }
  }, [setSession])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))
  }, [refreshUser])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      applySession({ setUser, setAgency, setAgencies, setPlatformAdmin }, null)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.auth.login({ email, password })
    setSession(session)
    return session
  }, [setSession])

  const logout = useCallback(async () => {
    await api.auth.logout()
    applySession({ setUser, setAgency, setAgencies, setPlatformAdmin }, null)
  }, [])

  const switchAgency = async (agencyId: string) => {
    const session = await api.agencies.switch(agencyId)
    setSession(session)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        agency,
        agencies,
        role: agency?.role ?? null,
        platformAdmin,
        loading,
        login,
        logout,
        refreshUser,
        switchAgency,
        setSession,
        setUser: (u) => setUser(u),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useAgencyRole() {
  const { role, agency } = useAuth()
  const isOwner = role === 'owner'
  const isAdmin = isOwner || role === 'admin'
  return {
    role,
    agency,
    isOwner,
    isAdmin,
    isStaff: role === 'staff',
    canWrite: isOwner || role === 'admin',
    canManageProxyPool: isOwner,
    canCreditTokens: isOwner,
    canRequestTokens: isOwner || role === 'admin',
  }
}
