import { useEffect, useState, type FormEvent } from 'react'
import { Users, Mail, Trash2, UserMinus } from 'lucide-react'
import { api, type AgencyRole } from '../../api/client'
import { useAgencyRole, useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function TeamPage() {
  const toast = useToast()
  const { agency, user, setSession } = useAuth()
  const { isOwner, isAdmin } = useAgencyRole()
  const [members, setMembers] = useState<Awaited<ReturnType<typeof api.agencies.members>>['members']>([])
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof api.agencies.invites>>['invites']>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'staff'>('staff')
  const [inviting, setInviting] = useState(false)
  const [lastAcceptUrl, setLastAcceptUrl] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [m, i] = await Promise.all([api.agencies.members(), isAdmin ? api.agencies.invites() : Promise.resolve({ invites: [] })])
      setMembers(m.members)
      setInvites(i.invites)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load team'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    setWhatsappNumber(agency?.whatsappNumber ?? '')
  }, [agency?.whatsappNumber])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      const res = await api.agencies.invite(inviteEmail, inviteRole)
      setLastAcceptUrl(res.invite.acceptUrl)
      setInviteEmail('')
      toast.success('Invite created — share the link with your team member')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to invite'))
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm('Remove this team member?')) return
    try {
      await api.agencies.removeMember(userId)
      toast.success('Member removed')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to remove member'))
    }
  }

  async function handleRoleChange(userId: string, role: AgencyRole) {
    if (role === 'owner') return
    try {
      await api.agencies.updateMemberRole(userId, role as 'admin' | 'staff')
      toast.success('Role updated')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update role'))
    }
  }

  async function handleRevokeInvite(id: string) {
    try {
      await api.agencies.revokeInvite(id)
      toast.success('Invite revoked')
      await load()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to revoke invite'))
    }
  }

  async function handleSaveAgencySettings(e: FormEvent) {
    e.preventDefault()
    setSettingsSaving(true)
    try {
      const session = await api.agencies.updateSettings({ whatsappNumber })
      setSession(session)
      toast.success('Token request WhatsApp number updated')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to update agency settings'))
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage who can access <span className="font-medium text-foreground">{agency?.name}</span> and its shared pages.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-medium">Roles</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li><span className="font-medium text-foreground">Owner</span> — full access, billing, team management</li>
          <li><span className="font-medium text-foreground">Admin</span> — pages, sources, BYOC, schedules, invites staff</li>
          <li><span className="font-medium text-foreground">Staff</span> — run automation, view jobs & dashboard</li>
        </ul>
      </div>

      {isAdmin && (
        <form onSubmit={handleSaveAgencySettings} className="rounded-xl border border-border bg-card p-4 text-sm space-y-3">
          <p className="font-medium">Tokenization settings</p>
          <p className="text-xs text-muted-foreground">
            Set your agency WhatsApp number for token purchase requests. Leave blank to use platform default.
          </p>
          <input
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="+923001234567"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            type="submit"
            disabled={settingsSaving}
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {settingsSaving ? 'Saving...' : 'Save WhatsApp number'}
          </button>
        </form>
      )}

      {isAdmin && (
        <form onSubmit={handleInvite} className="marketing-card space-y-4">
          <h2 className="text-sm font-semibold">Invite team member</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">Gmail address</label>
              <input
                required
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@gmail.com"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'staff')}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="staff">Staff</option>
                {isOwner && <option value="admin">Admin</option>}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Mail className="h-4 w-4" />
            {inviting ? 'Sending...' : 'Create invite link'}
          </button>
          {lastAcceptUrl && (
            <p className="break-all text-xs text-muted-foreground">
              Share link: <span className="text-primary">{lastAcceptUrl}</span>
            </p>
          )}
        </form>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="marketing-card space-y-3">
            <h2 className="text-sm font-semibold">Members ({members.length})</h2>
            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{m.fullName}{m.id === user?.id ? ' (you)' : ''}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && m.role !== 'owner' && m.id !== user?.id ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value as AgencyRole)}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{m.role}</span>
                  )}
                  {isAdmin && m.role !== 'owner' && m.id !== user?.id && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove member"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isAdmin && invites.length > 0 && (
            <div className="marketing-card space-y-3">
              <h2 className="text-sm font-semibold">Pending invites</h2>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{inv.email}</p>
                    <p className="text-xs text-muted-foreground capitalize">{inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
