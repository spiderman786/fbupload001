export function generateRandomScheduleTimes(count: number): string[] {
  const times = new Set<string>()
  const target = Math.max(1, Math.min(12, count))
  while (times.size < target) {
    const h = Math.floor(Math.random() * 24)
    const m = Math.floor(Math.random() * 60)
    times.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return Array.from(times).sort()
}
