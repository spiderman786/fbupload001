import { Navbar } from '../components/Navbar'
import { Hero } from '../components/Hero'
import { HowItWorks } from '../components/HowItWorks'
import { Pricing } from '../components/Pricing'
import { Footer } from '../components/Footer'

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 z-[60] rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        Skip to main content
      </a>

      <Navbar />

      <main id="main-content" className="relative flex-1">
        <Hero />
        <HowItWorks />
        <Pricing />
      </main>

      <Footer />
    </div>
  )
}
