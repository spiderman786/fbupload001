export function parseFollowers(value: string): number {
  const t = value.trim().toUpperCase().replace(/,/g, '')
  if (!t) return 0
  if (t.endsWith('M')) return Math.round(parseFloat(t) * 1_000_000) || 0
  if (t.endsWith('K')) return Math.round(parseFloat(t) * 1_000) || 0
  return parseInt(t, 10) || 0
}

export function formatFollowersTotal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function formatFollowersCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
