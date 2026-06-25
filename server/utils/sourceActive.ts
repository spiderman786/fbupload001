/** SQLite is_active can arrive as 0/1 or occasionally string — normalize once. */
export function isSourceActiveFlag(value: unknown): boolean {
  return Number(value) === 1
}
