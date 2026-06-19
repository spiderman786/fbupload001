export function formatDurationSince(dateStr: string): string {
  const start = new Date(dateStr)
  if (Number.isNaN(start.getTime())) return '—'

  const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`

  const months = Math.floor(days / 30)
  const rem = days % 30
  const monthPart = `${months} month${months !== 1 ? 's' : ''}`
  if (rem === 0) return monthPart
  return `${monthPart} ${rem} day${rem !== 1 ? 's' : ''}`
}

export function formatAddedDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
