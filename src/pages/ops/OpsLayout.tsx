import React from 'react'
import { Navigate, Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  Building2,
  FileText,
  Globe,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Server,
  Shield,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'
import { api } from '../../api/client'

const NAV = [
  { to: '/ops', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ops/agencies', label: 'Agencies', icon: Building2 },
  { to: '/ops/pages', label: 'All Pages', icon: Globe },
  { to: '/ops/jobs', label: 'Jobs & Errors', icon: ListChecks },
  { to: '/ops/analytics', label: 'Analytics', icon: Activity },
  { to: '/ops/system', label: 'System', icon: Server },
  { to: '/ops/audit', label: 'Audit Log', icon: FileText },
]

export function OpsLayout() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to sign out'))
    }
  }

  return (
    <div className="flex min-h-dvh bg-slate-950 text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <Shield className="h-5 w-5 text-emerald-400" />
            Platform Ops
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">{user?.email}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-slate-800 p-2">
          <Link to="/dashboard" className="block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800">
            ← Agency dashboard
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

export function OpsGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    if (!user) {
      setAllowed(false)
      return
    }
    api.ops.me().then((r) => setAllowed(r.platformAdmin)).catch(() => setAllowed(false))
  }, [user])

  if (loading || allowed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
