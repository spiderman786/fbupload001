import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

export function FacebookCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting Facebook account...')

  useEffect(() => {
    const code = params.get('code')
    const state = params.get('state') ?? undefined

    if (!code) {
      setStatus('Missing OAuth code. Redirecting...')
      setTimeout(() => navigate('/pages'), 2000)
      return
    }

    api.facebook
      .callback(code, state)
      .then((res) => {
        setStatus(`Connected! ${res.pagesConnected} page(s) added. Redirecting...`)
        setTimeout(() => navigate('/pages'), 1500)
      })
      .catch((err) => {
        setStatus((err as { error?: string }).error ?? 'Connection failed')
        setTimeout(() => navigate('/pages'), 3000)
      })
  }, [params, navigate])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </div>
  )
}
