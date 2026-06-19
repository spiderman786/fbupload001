import { AtSign, CalendarClock, Link2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const steps: { number: string; title: string; description: string; icon: LucideIcon }[] = [
  {
    number: '01',
    title: 'Connect your Facebook pages',
    description: 'Link your account securely and choose the pages you want to publish to.',
    icon: Link2,
  },
  {
    number: '02',
    title: 'Add source usernames',
    description:
      'Provide Instagram/TikTok/YouTube usernames or Facebook page/user IDs and we will download their reels on our server.',
    icon: AtSign,
  },
  {
    number: '03',
    title: 'Run automated publishing',
    description: 'Set the posting times and reels will be posted on those times.',
    icon: CalendarClock,
  },
]

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden border-y border-border bg-muted/40 py-24 sm:py-28"
    >
      <div className="section-blob -left-16 top-1/3 h-64 w-64 animate-pulse-slow" />
      <div className="section-blob -right-10 bottom-1/4 h-56 w-56 animate-mist-drift bg-primary/[0.06]" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-14 max-w-3xl text-center">
          <p className="mb-4 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            How It Works
          </p>
          <h2 className="font-display text-display-md sm:text-display-lg mb-5 text-balance font-bold tracking-tight">
            Launch automation with a simple 3-step flow
          </h2>
          <p className="text-lg leading-relaxed text-muted-foreground">
            Setup takes minutes. After that, your publishing runs automatically on schedule.
          </p>
        </div>

        <ol className="mx-auto max-w-3xl list-none space-y-0 p-0 lg:max-w-5xl">
          {steps.map((step, index) => (
            <li key={step.number} className="flex gap-5 pb-12 last:pb-0 sm:gap-8">
              <div className="flex shrink-0 flex-col items-center pt-1">
                <span className="font-display relative z-[1] flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 bg-secondary text-sm font-bold text-primary shadow-sm ring-4 ring-card">
                  {step.number}
                </span>
                {index < steps.length - 1 && (
                  <div
                    className="mt-2 min-h-10 w-px flex-1 bg-gradient-to-b from-primary/35 via-primary/15 to-border"
                    aria-hidden="true"
                  />
                )}
              </div>

              <article className="marketing-card min-w-0 flex-1">
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-primary">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <h3 className="font-display pt-1.5 text-xl font-semibold tracking-tight sm:text-2xl sm:leading-snug">
                    {step.title}
                  </h3>
                </div>
                <p className="text-base leading-relaxed text-muted-foreground">{step.description}</p>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
