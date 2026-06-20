import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30 py-20">
      <div className="container mx-auto px-4">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-5">
            <a href="#" className="inline-flex items-center space-x-3">
              <div className="rounded-xl border border-primary/15 bg-primary/5 p-2">
                <img src="/logo.svg" alt="FBupload Plus Logo" className="h-8 w-8" />
              </div>
              <span className="font-display text-xl font-bold tracking-tight">FBupload Plus</span>
            </a>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A reliable distribution platform for agencies running Facebook growth workflows.
            </p>
          </div>

          <div>
            <h4 className="mb-5 text-xs font-semibold tracking-[0.12em] uppercase">Product</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                <a href="#how-it-works" className="transition-colors hover:text-primary">
                  How it works
                </a>
              </li>
              <li>
                <a href="#monthly-calculator" className="transition-colors hover:text-primary">
                  Calculator
                </a>
              </li>
              <li>
                <a href="#pricing" className="transition-colors hover:text-primary">
                  Pricing
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-5 text-xs font-semibold tracking-[0.12em] uppercase">Company</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>
                <Link to="/privacy" className="transition-colors hover:text-primary">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="transition-colors hover:text-primary">
                  Terms of Service
                </Link>
              </li>
              <li>
                <a
                  href="mailto:support@fbuploadplus.com"
                  className="transition-colors hover:text-primary"
                >
                  support@fbuploadplus.com
                </a>
              </li>
              <li>
                <a href="https://wa.me/923080752936" className="transition-colors hover:text-primary">
                  WhatsApp: +92 308 0752936
                </a>
              </li>
              <li>Founder: BTMEDIA</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground md:flex-row">
          <span>© {new Date().getFullYear()} FBupload Plus</span>
          <span>Secure operations • Encrypted workflows • Automated publishing</span>
        </div>
      </div>
    </footer>
  )
}
