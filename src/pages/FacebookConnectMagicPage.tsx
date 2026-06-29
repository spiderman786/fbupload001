import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { AuthLayout } from '../components/AuthLayout'
import { useAuth } from '../context/AuthContext'

export function FacebookConnectMagicPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [status, setStatus] = useState('Preparing Facebook authorization…')
  const startedRef = useRef(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { state: { redirect: `/facebook/connect/${token}` } })
      return
    }
    if (!token || startedRef.current) return
    startedRef.current = true

    api.facebook
      .startMagicLink(token)
      .then(({ url }) => {
        setStatus('Redirecting to Facebook…')
        window.location.href = url
      })
      .catch((err) => {
        setStatus((err as { error?: string }).error ?? 'Could not start Facebook connect')
      })
  }, [authLoading, user, token, navigate])

  return (
    <AuthLayout>
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{status}</p>
        {status.includes('expired') || status.includes('invalid') || status.includes('different agency') ? (
          <p className="mt-4 text-sm">
            <Link to="/settings/facebook-byoc" className="text-primary hover:underline">
              Go to Facebook BYOC
            </Link>{' '}
            to generate a new link.
          </p>
        ) : null}
      </div>
    </AuthLayout>
  )
}
