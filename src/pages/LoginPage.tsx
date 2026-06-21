import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string })?.from ?? '/agency'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(email, password)
      navigate(from)
    } catch (err) {
      const data = err as { error?: string; needsVerification?: boolean; email?: string }
      if (data.needsVerification && data.email) {
        navigate('/verify-email', { state: { email: data.email } })
        return
      }
      setError(data.error ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Sign in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and password to access your dashboard.
        </p>
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
            <a href="#" className="text-sm font-medium text-primary hover:underline">Forgot password?</a>
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 border-t border-border pt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="font-semibold text-primary hover:underline">Sign up as agency</Link>
      </p>
    </AuthLayout>
  )
}
