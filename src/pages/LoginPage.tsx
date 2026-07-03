import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { buildAgencyWorkspaceUrl } from '../lib/agencyWorkspaceUrl'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const from =
    (location.state as { from?: string; redirect?: string; message?: string })?.redirect ??
    (location.state as { from?: string; message?: string })?.from ??
    '/agency'
  const hasExplicitRedirect = Boolean(
    (location.state as { from?: string; redirect?: string; message?: string } | null)?.redirect ??
      (location.state as { from?: string; message?: string } | null)?.from,
  )
  const successMessage = (location.state as { message?: string })?.message ?? ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(searchParams.get('error') ?? '')
  const [loading, setLoading] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)

  useEffect(() => {
    api.auth.signupStatus().then((r) => setSignupOpen(r.enabled)).catch(() => setSignupOpen(false))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const session = await login(email, password)
      if (session.platformAdmin && !hasExplicitRedirect) {
        navigate('/ops')
        return
      }

      if (!hasExplicitRedirect && !session.platformAdmin) {
        const workspaceUrl = buildAgencyWorkspaceUrl(session.agency?.subdomain, '/agency')
        if (workspaceUrl) {
          if (workspaceUrl.startsWith('/')) navigate(workspaceUrl)
          else window.location.assign(workspaceUrl)
          return
        }
      }

      navigate(from)
    } catch (err) {
      const data = err as { error?: string; needsVerification?: boolean; email?: string }
      if (data.needsVerification && data.email) {
        navigate(`/verify-email?email=${encodeURIComponent(data.email)}`, { state: { email: data.email } })
        return
      }
      setError(data.error ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function handleGoogleLogin() {
    window.location.assign(api.auth.googleUrl('login'))
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and password to access your dashboard.
        </p>
      </div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        className="mb-4 flex h-11 w-full items-center justify-center rounded-lg border border-border bg-background text-sm font-semibold text-foreground shadow-xs transition-all hover:bg-muted"
      >
        Continue with Google
      </button>

      <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>or sign in with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <input
            id="email"
            type="email"
            required
            placeholder="m@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        {successMessage && (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{successMessage}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      {signupOpen && (
        <p className="mt-6 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="font-semibold text-primary hover:underline">Create account</Link>
        </p>
      )}
    </AuthLayout>
  )
}
