import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { AuthLayout } from '../components/AuthLayout'
import { getApiError } from '../lib/apiError'

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { user, setSession, loading: authLoading } = useAuth()
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.agencies.previewInvite>> | null>(null)
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Missing invite token')
      return
    }
    api.agencies.previewInvite(token).then(setPreview).catch((err) => setError(getApiError(err, 'Invalid invite')))
  }, [token])

  async function handleAccept() {
    if (!user) {
      navigate('/login', { state: { redirect: `/accept-invite?token=${token}` } })
      return
    }
    setAccepting(true)
    setError('')
    try {
      const session = await api.agencies.acceptInvite(token)
      setSession(session)
      navigate('/dashboard')
    } catch (err) {
      setError(getApiError(err, 'Failed to accept invite'))
    } finally {
      setAccepting(false)
    }
  }

  if (authLoading) {
    return (
      <AuthLayout>
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="mx-auto max-w-md space-y-4">
        <div className="inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Team invite</h2>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {preview && !error && (
          <>
            <p className="text-sm text-muted-foreground">
              You&apos;ve been invited to join <span className="font-semibold text-foreground">{preview.agencyName}</span> as{' '}
              <span className="capitalize">{preview.role}</span>.
            </p>
            <p className="text-xs text-muted-foreground">Invite email: {preview.email}</p>
            {preview.expired ? (
              <p className="text-sm text-red-600">This invite has expired. Ask the agency owner for a new link.</p>
            ) : user ? (
              user.email.toLowerCase() !== preview.email.toLowerCase() ? (
                <p className="text-sm text-red-600">
                  You&apos;re signed in as {user.email}. Sign in with {preview.email} to accept.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={accepting}
                  onClick={handleAccept}
                  className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {accepting ? 'Joining...' : 'Accept & join agency'}
                </button>
              )
            ) : (
              <div className="space-y-2">
                <Link
                  to="/login"
                  state={{ redirect: `/accept-invite?token=${token}` }}
                  className="flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Sign in to accept
                </Link>
                <p className="text-center text-xs text-muted-foreground">
                  No account?{' '}
                  <Link to="/signup" className="text-primary hover:underline">
                    Sign up
                  </Link>{' '}
                  with {preview.email}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AuthLayout>
  )
}
