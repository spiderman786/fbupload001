import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Coins, LogOut, Menu, X } from 'lucide-react'
import { DASHBOARD_NAV, PLATFORM_ICONS } from '../config/dashboardNav'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

export function DashboardLayout() {
  const { user, agency, agencies, role, logout, switchAgency } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    facebook: true,
    youtube: false,
    instagram: false,
  })

  async function handleLogout() {
    try {
      await logout()
      navigate('/login')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to sign out'))
    }
  }

  function toggle(platform: string) {
    setExpanded((prev) => ({ ...prev, [platform]: !prev[platform] }))
  }

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {sidebarOpen && (
        <button className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <Link to="/dashboard" className="font-display text-lg font-bold tracking-tight">
            Fbupload<span className="text-primary">Plus</span>
          </Link>
          <button className="rounded-md p-1.5 hover:bg-muted lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {DASHBOARD_NAV.map((section, si) => (
            <div key={si} className="mb-2">
              {section.title && (
                <p className="mb-1 px-2 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {section.title}
                </p>
              )}

              {section.platform ? (
                <div>
                  <button
                    onClick={() => toggle(section.platform!)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold capitalize hover:bg-muted"
                  >
                    {expanded[section.platform] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {(() => {
                      const Icon = PLATFORM_ICONS[section.platform!]
                      return Icon ? <Icon className="h-4 w-4 text-primary" /> : null
                    })()}
                    {section.platform}
                  </button>
                  {expanded[section.platform] && (
                    <div className="ml-2 space-y-0.5 border-l border-border pl-2">
                      {section.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={() => setSidebarOpen(false)}
                          className={({ isActive }) =>
                            `block rounded-md px-2 py-1.5 text-sm transition-colors ${
                              isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`
                          }
                        >
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/dashboard'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                          isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`
                      }
                    >
                      {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 rounded-lg bg-muted/40 px-3 py-2.5">
            <p className="truncate text-sm font-semibold">{agency?.name ?? user?.fullName}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="text-xs capitalize text-muted-foreground">{role ?? 'member'}</p>
              {agencies.length > 1 && (
                <select
                  value={agency?.id ?? ''}
                  onChange={async (e) => {
                    try {
                      await switchAgency(e.target.value)
                      window.location.reload()
                    } catch (err) {
                      toast.error(getApiError(err, 'Failed to switch agency'))
                    }
                  }}
                  className="h-6 max-w-[7rem] truncate rounded border border-border bg-background px-1 text-[10px]"
                >
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
              <Coins className="h-3.5 w-3.5" />
              {(agency?.tokenBalance ?? user?.tokenBalance ?? 0).toLocaleString()} tokens
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center border-b border-border bg-card px-4 py-3 lg:hidden">
          <button className="rounded-md p-2 hover:bg-muted" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
