import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

type FeaturePageProps = {
  title: string
  description: string
  icon?: LucideIcon
  actionTo?: string
  actionLabel?: string
}

export function FeaturePage({ title, description, icon: Icon, actionTo, actionLabel }: FeaturePageProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        {Icon && (
          <div className="mb-4 inline-flex rounded-xl border border-primary/15 bg-primary/5 p-3">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        )}
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          This module is connected to the backend API. Full workflow UI coming soon.
        </p>
        {actionTo && actionLabel && (
          <Link
            to={actionTo}
            className="mt-4 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  )
}
