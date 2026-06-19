export function getApiError(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object' && 'error' in err && typeof (err as { error: unknown }).error === 'string') {
    return (err as { error: string }).error
  }
  return fallback
}
