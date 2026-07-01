import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function VerifyEmailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setSession } = useAuth()
  const state = (location.state as { email?: string; agencyName?: string; agencyUrl?: string } | null) ?? null
  const email = state?.email ?? searchParams.get('email') ?? ''
  const agencyUrl = state?.agencyUrl
  const agencyName = state?.agencyName
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const session = await api.auth.verify({ email, code })
      setSession(session)
      navigate('/agency')
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    try {
      await api.auth.resendVerification(email)
      setResent(true)
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Failed to resend')
    }
  }

  if (!email) {
    return (
      <AuthLayout>
        <p className="text-center text-sm text-muted-foreground">
          No email provided.{' '}
          <Link to="/signup" className="text-primary hover:underline">Sign up</Link> first, or{' '}
          <Link to="/login" className="text-primary hover:underline">sign in</Link> if you already have an account.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Verify your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the 6-digit code sent to <strong>{email}</strong>
        </p>
        {agencyName && (
          <p className="mt-2 text-xs text-muted-foreground">
            Joining <span className="font-medium text-foreground">{agencyName}</span> as admin.
            {agencyUrl ? (
              <>
                {' '}
                Workspace: <span className="font-medium text-foreground">{agencyUrl}</span>
              </>
            ) : null}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="code" className="text-sm font-medium">Verification code</label>
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

        {error && <p className="text-sm text-red-600">{error}</p>}
        {resent && <p className="text-sm text-primary">Code resent!</p>}

        <button
          type="submit"
          disabled={loading || code.length < 6}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify & continue'}
        </button>
      </form>

      <button onClick={handleResend} className="mt-4 w-full text-sm text-primary hover:underline">
        Resend code
      </button>
    </AuthLayout>
  )
}
