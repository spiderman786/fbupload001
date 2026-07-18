import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

export function FacebookCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting Facebook account...')
  const exchangedRef = useRef(false)

  useEffect(() => {
    if (exchangedRef.current) return
    exchangedRef.current = true

    const code = params.get('code')
    const state = params.get('state') ?? undefined
    let redirectTimer: ReturnType<typeof setTimeout> | undefined

    if (!code) {
      setStatus('Missing OAuth code. Redirecting...')
      redirectTimer = setTimeout(() => navigate('/facebook/accounts'), 2000)
      return () => {
        if (redirectTimer) clearTimeout(redirectTimer)
      }
    }

    api.facebook
      .callback(code, state)
      .then((res) => {
        if (res.pagesError) {
          setStatus(
            `Account connected. Pages need to be added manually (${res.pagesError}). Redirecting...`,
          )
        } else if (res.pagesConnected === 0) {
          setStatus('Account connected. No pages were auto-imported — add them next. Redirecting...')
        } else {
          setStatus(`Connected! ${res.pagesConnected} page(s) added. Redirecting...`)
        }
        redirectTimer = setTimeout(() => navigate('/facebook/accounts'), 1500)
      })
      .catch((err) => {
        setStatus((err as { error?: string }).error ?? 'Connection failed')
        redirectTimer = setTimeout(() => navigate('/facebook/accounts'), 3000)
      })

    return () => {
      if (redirectTimer) clearTimeout(redirectTimer)
    }
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
