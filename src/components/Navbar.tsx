import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import { api } from '../api/client'

const navLinks = [
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/#monthly-calculator', label: 'Calculator' },
  { href: '/#pricing', label: 'Pricing' },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)

  useEffect(() => {
    api.auth.signupStatus().then((r) => setSignupOpen(r.enabled)).catch(() => setSignupOpen(false))
  }, [])

  return (
    <nav className="fixed top-0 right-0 left-0 z-50 bg-background/80 py-5 backdrop-blur-md">
      <div className="container mx-auto flex items-center justify-between px-4">
        <Link to="/" className="flex items-center space-x-3">
          <img src="/logo.svg" alt="FBupload Plus Logo" className="h-8 w-8" />
          <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
            FBupload Plus
          </span>
        </Link>

        <div className="hidden items-center gap-10 md:flex">
          <div className="flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-muted-foreground transition-colors duration-200 hover:text-primary"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-4">
            <Link
              to="/login"
              className="px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
            >
              Log in
            </Link>
            {signupOpen && (
              <Link
                to="/signup"
                className="group inline-flex items-center rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Sign up
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            )}
          </div>
        </div>

        <button
          className="rounded-md p-2 hover:bg-muted md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-4 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-muted-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/login"
              className="text-left text-sm font-semibold"
              onClick={() => setMobileOpen(false)}
            >
              Log in
            </Link>
            {signupOpen && (
              <Link
                to="/signup"
                className="rounded-full bg-primary px-6 py-2 text-center text-sm font-semibold text-primary-foreground"
                onClick={() => setMobileOpen(false)}
              >
                Sign up
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
