import { CircleCheck, Coins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Calculator } from './Calculator'

const features = [
  'Non-expiring tokens - Use them whenever you need',
  "Tokens are only used for published reels; failed reels or other issues don't cost you tokens",
  'No minimum limit on the number of pages you can manage or the tokens you can have',
  'Direct founder support via WhatsApp',
]

export function Pricing() {
  return (
    <section
      id="pricing"
      className="relative overflow-hidden border-t border-border bg-secondary/35 py-20 sm:py-24"
    >
      <div className="section-blob -left-14 top-1/4 h-60 w-60 animate-pulse-slow" />
      <div className="section-blob -right-12 bottom-1/3 h-52 w-52 animate-mist-drift bg-primary/[0.06]" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <span className="mb-4 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            Simple Pricing
          </span>
          <h2 className="mb-6 text-3xl font-bold tracking-tight md:text-5xl">
            Pay as you grow with
            <span className="text-primary"> no fixed plan lock-in.</span>
          </h2>
          <p className="text-lg leading-relaxed text-muted-foreground">
            Our dynamic pricing model means you only pay for what you use. Top up your account with
            tokens and distribute content across your entire agency portfolio.
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12">
          <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
            <div className="space-y-8 p-6 sm:p-8">
              <div className="space-y-4">
                <h3 className="flex items-center gap-3 text-2xl font-bold">
                  <span className="inline-flex rounded-lg bg-primary/5 p-2">
                    <Coins className="h-5 w-5 text-primary" />
                  </span>
                  Unified Token System
                </h3>
                <ul className="space-y-4 text-sm text-muted-foreground">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-6 rounded-xl border border-border bg-background p-6 shadow-sm">
                <div className="space-y-1">
                  <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
                    Free account creation
                  </p>
                  <h4 className="text-2xl font-bold sm:text-3xl">Start Building</h4>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Just go to the sign up page and create an account to start adding pages. You
                  aren&apos;t charged for Facebook accounts or pages.
                </p>
                <Link
                  to="/signup"
                  className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98]"
                >
                  Sign Up Now
                </Link>
              </div>
            </div>
          </div>

          <Calculator />
        </div>
      </div>
    </section>
  )
}
