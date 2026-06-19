import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

type AuthLayoutProps = {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="absolute -top-32 -left-20 h-80 w-80 animate-pulse-slow rounded-full bg-primary/10 blur-3xl" />
      <div className="animate-mist-drift absolute top-28 right-0 h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex rounded-xl border border-primary/15 bg-primary/5 p-3">
            <img src="/logo.svg" alt="FBupload Pro Logo" className="h-10 w-10" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            FBupload <span className="text-primary">Pro</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Agency automation portal</p>
        </div>

        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Homepage
        </Link>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </div>
  )
}
