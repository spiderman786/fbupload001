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
  Radio,
  Server,
  Settings,
  Shield,
} from 'lucide-react'
import { OpsGlobalSearch } from './OpsGlobalSearch'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'
import { api } from '../../api/client'

const NAV = [
  { to: '/ops', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ops/live', label: 'Live Feed', icon: Radio },
  { to: '/ops/agencies', label: 'Agencies', icon: Building2 },
  { to: '/ops/pages', label: 'All Pages', icon: Globe },
  { to: '/ops/jobs', label: 'Jobs & Errors', icon: ListChecks },
  { to: '/ops/analytics', label: 'Analytics', icon: Activity },
  { to: '/ops/settings', label: 'Settings', icon: Settings },
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
        <OpsGlobalSearch />
        <Outlet />
      </main>
    </div>
  )
}

export function OpsGate({ children }: { children: React.ReactNode }) {
  const { user, loading, platformAdmin } = useAuth()
  const [checked, setChecked] = React.useState(false)
  const [allowed, setAllowed] = React.useState(false)

  React.useEffect(() => {
    if (!user) {
      setAllowed(false)
      setChecked(true)
      return
    }
    if (platformAdmin) {
      setAllowed(true)
      setChecked(true)
      return
    }
    api.ops
      .me()
      .then((r) => setAllowed(r.platformAdmin))
      .catch(() => setAllowed(false))
      .finally(() => setChecked(true))
  }, [user, platformAdmin])

  if (loading || !checked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!allowed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
          <Shield className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="mt-4 text-lg font-semibold">Platform Ops access denied</h1>
          <p className="mt-2 text-sm text-slate-400">
            Platform Ops is not available to agency admins or staff. Set{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">PLATFORM_ADMIN_EMAILS</code> on Railway to your
            Gmail, or use an account with the agency <strong>owner</strong> role.
          </p>
          <p className="mt-3 text-xs text-slate-500">Signed in as {user.email}</p>
          <Link to="/dashboard" className="mt-5 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
            Back to agency dashboard
          </Link>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
