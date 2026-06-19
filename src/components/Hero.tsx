import { ArrowRight, ServerCog, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Hero() {
  return (
    <section className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
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
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/35 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <ServerCog className="h-3.5 w-3.5 shrink-0 text-primary" />
                    Live
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="rounded-xl border border-border bg-muted/25 p-4 shadow-sm transition-shadow hover:shadow-md">
                    <p className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums">
                      7000+
                    </p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">
                      Facebook pages running automated workflows
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/25 p-4 shadow-sm transition-shadow hover:shadow-md">
                    <p className="font-mono text-3xl font-bold tracking-tight text-foreground tabular-nums">
                      200+
                    </p>
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">
                      Users scaling posting operations daily
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
