import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [phoneCountryCode, setPhoneCountryCode] = useState(user?.phoneCountryCode ?? '+92')
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')
    try {
      await api.auth.updateProfile({
        fullName,
        phoneCountryCode,
        phoneNumber,
        ...(newPassword ? { currentPassword, newPassword } : {}),
      })
      setMessage('Settings saved successfully')
      setCurrentPassword('')
      setNewPassword('')
      await refreshUser()
      toast.success('Settings saved successfully')
    } catch (err) {
      const msg = getApiError(err, 'Failed to save')
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account profile and password.</p>
      </div>

      <form onSubmit={handleSubmit} className="marketing-card space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <input disabled value={user?.email ?? ''} className="h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Full name</label>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Country code</label>
            <input
              value={phoneCountryCode}
              onChange={(e) => setPhoneCountryCode(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
          <div className="col-span-2 space-y-2">
            <label className="text-sm font-medium">WhatsApp number</label>
            <input
              required
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>
        </div>

        <hr className="border-border" />

        <p className="text-sm font-medium">Change password</p>
        <div className="space-y-2">
          <label className="text-sm font-medium">Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-primary">{message}</p>}

        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}
