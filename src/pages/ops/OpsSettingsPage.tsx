import { useCallback, useEffect, useState } from 'react'
import { api, type OpsAlertConfig } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

const FLAG_LABELS: Record<string, string> = {
  downloads_enabled: 'Allow video downloads',
  publishing_enabled: 'Allow Facebook publishing',
  auto_retry_enabled: 'Auto-retry failed download jobs',
  maintenance_mode: 'Global maintenance (blocks all publishing)',
  self_healing_enabled: 'Self-healing (auto-pause pages / disable sources)',
}

const DEFAULT_ALERTS: OpsAlertConfig[] = [
  { alertType: 'high_fail_rate', enabled: true, threshold: 0.2 },
  { alertType: 'worker_stale', enabled: true },
  { alertType: 'proxy_pool_low', enabled: true },
  { alertType: 'agencies_zero_tokens', enabled: true },
]

export function OpsSettingsPage() {
  const toast = useToast()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [alertConfig, setAlertConfig] = useState<OpsAlertConfig[]>(DEFAULT_ALERTS)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.ops.settings()
      setSettings(r.settings)
      if (r.alertConfig.length) setAlertConfig(r.alertConfig)
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load settings'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    try {
      await api.ops.updateSettings({ settings, alertConfig })
      toast.success('Settings saved')
    } catch (err) {
      toast.error(getApiError(err, 'Save failed'))
    }
  }

  function toggleFlag(key: string) {
    setSettings((s) => ({ ...s, [key]: s[key] === 'false' ? 'true' : 'false' }))
  }

  if (loading) return <p className="text-slate-400">Loading settings…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Platform Settings</h1>
          <p className="text-sm text-slate-400">Feature flags, maintenance, and alert configuration (v2.4)</p>
        </div>
        <button type="button" onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm hover:bg-emerald-500">
          Save changes
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-medium">Feature flags</h2>
        <ul className="mt-4 space-y-3">
          {Object.entries(FLAG_LABELS).map(([key, label]) => (
            <li key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-300">{label}</span>
              <button
                type="button"
                onClick={() => toggleFlag(key)}
                className={`relative h-6 w-11 rounded-full transition ${settings[key] !== 'false' ? 'bg-emerald-600' : 'bg-slate-700'}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${settings[key] !== 'false' ? 'left-5' : 'left-0.5'}`}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-medium">Alert rules</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {alertConfig.map((row, i) => (
            <li key={row.alertType} className="grid gap-2 rounded-lg bg-slate-950/50 p-3 sm:grid-cols-3">
              <span className="font-mono text-emerald-400/80">{row.alertType}</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.enabled !== false}
                  onChange={(e) => {
                    const next = [...alertConfig]
                    next[i] = { ...row, enabled: e.target.checked }
                    setAlertConfig(next)
                  }}
                />
                Enabled
              </label>
              <input
                placeholder="Webhook URL (optional)"
                value={row.webhookUrl ?? ''}
                onChange={(e) => {
                  const next = [...alertConfig]
                  next[i] = { ...row, webhookUrl: e.target.value }
                  setAlertConfig(next)
                }}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
