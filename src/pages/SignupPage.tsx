import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { AuthLayout } from '../components/AuthLayout'
import { api } from '../api/client'
import { buildAgencyWorkspaceUrl } from '../lib/agencyWorkspaceUrl'

const COUNTRY_CODES = [
  { code: '+92', label: 'Pakistan (+92)' },
  { code: '+1', label: 'United States (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+971', label: 'UAE (+971)' },
]

function previewSubdomain(fullName: string, email: string): string | null {
  const source = fullName.trim() || email.split('@')[0] || ''
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
  return slug || null
}

export function SignupPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [countryCode, setCountryCode] = useState('+92')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null)
  const workspacePreview = useMemo(() => previewSubdomain(fullName, email), [fullName, email])
  const workspacePreviewUrl = useMemo(
    () => (workspacePreview ? buildAgencyWorkspaceUrl(workspacePreview, '/agency') : null),
    [workspacePreview],
  )

  useEffect(() => {
    api.auth.signupStatus().then((r) => setSignupOpen(r.enabled)).catch(() => setSignupOpen(false))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.auth.signup({
        fullName,
        email,
        password,
        phoneCountryCode: countryCode,
        phoneNumber: phone,
      })
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
        state: {
          email,
          agencyName: res.agencyName ?? undefined,
          agencyUrl: res.agencyUrl ?? undefined,
        },
      })
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  if (signupOpen === false) {
    return (
      <AuthLayout>
        <div className="mb-6">
          <h2 className="text-xl font-bold tracking-tight">Signup is closed</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            New accounts are invite-only right now. Ask the agency owner for a team invite link.
          </p>
        </div>
        <Link
          to="/login"
          className="flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Create an account</h2>
        <p className="mt-1 text-sm text-muted-foreground">Registrations use Gmail only (@gmail.com).</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="full-name" className="text-sm font-medium">Full name</label>
          <input id="full-name" type="text" required placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20" />
          {workspacePreview && (
            <p className="text-xs text-muted-foreground">
              Your workspace:{' '}
              <span className="font-medium text-foreground">
                {workspacePreviewUrl ?? `https://${workspacePreview}.fbuploadplus.com/agency`}
              </span>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          We create a separate client workspace for you. You join as{' '}
          <span className="font-medium text-foreground">Admin</span>, and the platform owner assigns tokens after approval.
        </div>

        <div className="space-y-2">
          <label htmlFor="gmail" className="text-sm font-medium">Gmail address</label>
          <input id="gmail" type="email" required placeholder="yourname@gmail.com" pattern=".*@gmail\.com$" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20" />
          <p className="text-xs text-muted-foreground">Only @gmail.com addresses are accepted.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="phone" className="text-sm font-medium">Phone number</label>
          <div className="flex gap-2">
            <div className="relative w-36 shrink-0">
              <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="h-10 w-full appearance-none rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20">
                {COUNTRY_CODES.map((c) => (<option key={c.code} value={c.code}>{c.label}</option>))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 opacity-50" />
            </div>
            <input id="phone" type="tel" required placeholder="3001234567" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20" />
          </div>
          <p className="text-xs text-muted-foreground">Your WhatsApp number for token requests.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="signup-password" className="text-sm font-medium">Password</label>
          <input id="signup-password" type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {loading ? 'Sending...' : 'Send code to Gmail'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        By creating an account, you agree to our{' '}
        <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>{' '}
        and{' '}
        <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
      </p>

      <p className="mt-4 border-t border-border pt-4 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
