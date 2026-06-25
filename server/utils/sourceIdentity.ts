/** Normalize @handles for matching source accounts within an agency. */
export function normalizeSourceHandle(username: string): string {
  return username.replace(/^@/, '').trim().toLowerCase()
}

export function normalizeSourceUsername(username: string): string {
  const handle = username.replace(/^@/, '').trim()
  return handle ? `@${handle}` : ''
}
