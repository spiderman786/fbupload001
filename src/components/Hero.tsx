import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ServerCog, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type PublicLiveEvent, type PublicLiveSnapshot } from '../api/client'

const PAGES_FLOOR = 7000
const USERS_FLOOR = 200
const POLL_MS = 6000

const FALLBACK_SNAPSHOT: PublicLiveSnapshot = {
  pagesAutomated: PAGES_FLOOR,
  activeUsers: USERS_FLOOR,
  publishedLastHour: 0,
  events: [],
  serverTime: new Date(0).toISOString(),
}

function formatCount(n: number): string {
  const rounded = Math.max(0, Math.floor(n))
  if (rounded >= 1000) {
    return `${rounded.toLocaleString('en-US')}+`
  }
  return `${rounded}+`
}

function flooredPages(n: number): number {
  return Math.max(n, PAGES_FLOOR)
}

function flooredUsers(n: number): number {
  return Math.max(n, USERS_FLOOR)
}

function relativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'just now'
  const diffSec = Math.max(0, Math.floor((nowMs - then) / 1000))
  if (diffSec < 15) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export function Hero() {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [snapshot, setSnapshot] = useState<PublicLiveSnapshot>(FALLBACK_SNAPSHOT)
  const [connected, setConnected] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const inViewRef = useRef(true)
  const pageVisibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = () => {
      clearTimer()
      if (cancelled) return
      if (!inViewRef.current || !pageVisibleRef.current) return
      timer = setTimeout(() => {
        void poll()
      }, POLL_MS)
    }

    const poll = async () => {
      if (cancelled) return
      if (!inViewRef.current || !pageVisibleRef.current) {
        schedule()
        return
      }
      try {
        const next = await api.public.liveSnapshot()
        if (cancelled) return
        setSnapshot(next)
        setConnected(true)
        setNowMs(Date.now())
      } catch {
        if (cancelled) return
        setConnected(false)
      } finally {
        if (!cancelled) schedule()
      }
    }

    const onVisibility = () => {
      pageVisibleRef.current = document.visibilityState === 'visible'
      if (pageVisibleRef.current) {
        void poll()
      } else {
        clearTimer()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)

    const node = sectionRef.current
    let observer: IntersectionObserver | null = null
    if (node && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          inViewRef.current = entry?.isIntersecting ?? true
          if (inViewRef.current) {
            void poll()
          } else {
            clearTimer()
          }
        },
        { threshold: 0.15 },
      )
      observer.observe(node)
    }

    void poll()

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }, [])

  const pagesLabel = formatCount(flooredPages(snapshot.pagesAutomated))
  const usersLabel = formatCount(flooredUsers(snapshot.activeUsers))
  const events = snapshot.events.slice(0, 4)

  return (
    <section ref={sectionRef} className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="absolute -top-32 -left-20 h-80 w-80 animate-pulse-slow rounded-full bg-primary/10 blur-3xl" />
      <div className="animate-mist-drift absolute top-28 right-0 h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" />

      <div className="relative flex flex-1 flex-col justify-center px-4 pt-24 pb-12 sm:px-6 sm:pt-28 lg:px-8 lg:pt-32 lg:pb-16">
        <div className="container mx-auto">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 md:grid-cols-[1.1fr_0.9fr] lg:gap-12">
            <div className="max-w-2xl md:pr-2">
              <span className="mb-7 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold tracking-[0.12em] text-primary">
                Facebook Automation Platform
              </span>

              <h1 className="font-display text-display-md sm:text-display-lg lg:text-display-xl mb-6 text-left font-bold tracking-tight text-balance">
                Automate Facebook pages
                <span className="text-primary"> without heavy PC or internet.</span>
              </h1>

              <p className="mb-8 max-w-xl text-left text-lg leading-relaxed text-muted-foreground">
                Use secure API to connect your Facebook accounts and pages without having to use
                passwords.
              </p>

              <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                <a
                  href="#pricing"
                  className="group inline-flex h-12 items-center rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
                >
                  View Pricing
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <Link
                  to="/signup"
                  className="group inline-flex h-12 items-center rounded-full px-8 text-base font-semibold transition-all hover:bg-muted/80 hover:ring-1 hover:ring-border"
                >
                  Sign up
                  <ArrowRight className="ml-2 h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Official API auth
                </span>
              </div>
            </div>

            <div className="automation-snapshot-surface">
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium tracking-[0.12em] text-primary uppercase">
                    Automation snapshot
                  </p>
                  <LiveBadge connected={connected} />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="rounded-xl border border-border bg-muted/25 p-4 shadow-sm transition-shadow hover:shadow-md">
                    <p className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums transition-opacity duration-300">
                      {pagesLabel}
                    </p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">
                      Facebook pages running automated workflows
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/25 p-4 shadow-sm transition-shadow hover:shadow-md">
                    <p className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums transition-opacity duration-300">
                      {usersLabel}
                    </p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">
                      Users scaling posting operations daily
                    </p>
                  </div>
                </div>

                <ActivityStrip events={events} nowMs={nowMs} publishedLastHour={snapshot.publishedLastHour} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function LiveBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
        connected
          ? 'border-border bg-background/90 text-muted-foreground'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {connected ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/35 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </>
        ) : (
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        )}
      </span>
      <ServerCog className={`h-3.5 w-3.5 shrink-0 ${connected ? 'text-primary' : 'text-amber-600'}`} />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  )
}

function ActivityStrip({
  events,
  nowMs,
  publishedLastHour,
}: {
  events: PublicLiveEvent[]
  nowMs: number
  publishedLastHour: number
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/15 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          {publishedLastHour > 0
            ? `${publishedLastHour.toLocaleString('en-US')} reels published in the last hour`
            : 'Waiting for live automation activity…'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2" aria-live="polite">
      {events.map((event) => (
        <div
          key={event.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs"
        >
          <span className="min-w-0 truncate text-foreground/90">{event.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{relativeTime(event.at, nowMs)}</span>
        </div>
      ))}
    </div>
  )
}
