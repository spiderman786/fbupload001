import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type OpsLiveEvent } from '../../api/client'

function eventLabel(e: OpsLiveEvent) {
  if (e.type === 'connected') return 'Connected to live feed'
  if (e.type === 'job') return `Job ${e.status}${e.message ? `: ${e.message.slice(0, 80)}` : ''}`
  return `${e.step}: ${e.message?.slice(0, 100) ?? ''}`
}

export function OpsLiveFeedPage() {
  const [events, setEvents] = useState<OpsLiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const es = new EventSource(api.ops.liveStreamUrl(), { withCredentials: true })

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as OpsLiveEvent
        setEvents((prev) => [data, ...prev].slice(0, 200))
      } catch {
        /* ignore */
      }
    }

    return () => es.close()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live Feed</h1>
          <p className="text-sm text-slate-400">Real-time jobs and pipeline steps across all agencies</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
          {connected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <ul className="max-h-[70vh] divide-y divide-slate-800 overflow-y-auto">
          {events.map((e, i) => (
            <li key={`${e.id}-${i}`} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={e.type === 'job' && e.status === 'failed' ? 'text-red-400' : 'text-slate-200'}>
                  {eventLabel(e)}
                </span>
                <span className="text-xs text-slate-500">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
              {(e.agencyName || e.pageName) && (
                <p className="mt-1 text-xs text-slate-500">
                  {e.agencyName}{e.pageName ? ` · ${e.pageName}` : ''}
                </p>
              )}
            </li>
          ))}
          {!events.length && <li className="p-6 text-slate-500">Waiting for activity…</li>}
        </ul>
        <div ref={bottomRef} />
      </div>

      <Link to="/ops/jobs?status=failed" className="text-sm text-emerald-400 hover:underline">
        Open failed jobs →
      </Link>
    </div>
  )
}
