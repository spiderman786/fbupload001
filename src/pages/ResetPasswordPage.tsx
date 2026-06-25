import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { api } from '../api/client'
import { getApiError } from '../lib/apiError'

export function ResetPasswordPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state as { email?: string; message?: string } | null) ?? null
  const [email, setEmail] = useState(state?.email ?? '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [info] = useState(state?.message ?? '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.auth.resetPassword({ email: email.trim().toLowerCase(), code, password })
      navigate('/login', { state: { message: 'Password updated. Sign in with your new password.' } })
    } catch (err) {
      setError(getApiError(err, 'Reset failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Reset password</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-digit code from your email and choose a new password.
        </p>
      </div>

      {info && <p className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">{info}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="code" className="text-sm font-medium">
            Reset code
          </label>
          <input
            id="code"
            required
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-center font-mono text-lg tracking-widest shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className="text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || code.length < 6}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Updating...' : 'Update password'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
          Request a new code
        </Link>
        {' · '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
