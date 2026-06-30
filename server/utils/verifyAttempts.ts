type AttemptBucket = { failures: number; lockedUntil: number }

const attempts = new Map<string, AttemptBucket>()

const MAX_FAILURES = 5
const LOCK_MS = 15 * 60 * 1000

function bucketFor(email: string): AttemptBucket {
  const key = email.trim().toLowerCase()
  let bucket = attempts.get(key)
  if (!bucket) {
    bucket = { failures: 0, lockedUntil: 0 }
    attempts.set(key, bucket)
  }
  return bucket
}

export function assertVerificationAttemptsAllowed(email: string): void {
  const bucket = bucketFor(email)
  if (bucket.lockedUntil > Date.now()) {
    throw new VerificationLockedError('Too many failed attempts. Try again in 15 minutes.')
  }
}

export function recordVerificationFailure(email: string): void {
  const bucket = bucketFor(email)
  if (bucket.lockedUntil > Date.now()) return
  bucket.failures += 1
  if (bucket.failures >= MAX_FAILURES) {
    bucket.lockedUntil = Date.now() + LOCK_MS
    bucket.failures = 0
  }
}

export function clearVerificationAttempts(email: string): void {
  attempts.delete(email.trim().toLowerCase())
}

export class VerificationLockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationLockedError'
  }
}
