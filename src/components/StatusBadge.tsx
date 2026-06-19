export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'border-primary/25 bg-primary/10 text-primary',
    paused: 'border-border bg-muted text-muted-foreground',
    completed: 'border-primary/25 bg-primary/10 text-primary',
    upcoming: 'border-blue-200 bg-blue-50 text-blue-700',
    pending: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    downloading: 'border-blue-200 bg-blue-50 text-blue-700',
    publishing: 'border-purple-200 bg-purple-50 text-purple-700',
    published: 'border-primary/25 bg-primary/10 text-primary',
    failed: 'border-red-200 bg-red-50 text-red-700',
  }

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status] ?? styles.paused}`}>
      {status}
    </span>
  )
}
