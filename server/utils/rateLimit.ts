import type { Request, Response, NextFunction } from 'express'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const raw = typeof forwarded === 'string' ? forwarded.split(',')[0]!.trim() : req.ip ?? 'unknown'
  return raw || 'unknown'
}

function take(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  return bucket.count <= max
}

export function rateLimit(options: {
  windowMs: number
  max: number
  key: (req: Request) => string
  message?: string
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.key(req)
    if (take(key, options.windowMs, options.max)) {
      next()
      return
    }
    res.status(429).json({ error: options.message ?? 'Too many requests. Try again later.' })
  }
}

export function rateLimitByIp(windowMs: number, max: number, message?: string) {
  return rateLimit({
    windowMs,
    max,
    message,
    key: (req) => `ip:${clientIp(req)}`,
  })
}

export function rateLimitByIpAndBodyField(field: string, windowMs: number, max: number, message?: string) {
  return rateLimit({
    windowMs,
    max,
    message,
    key: (req) => {
      const value = String((req.body ?? {})[field] ?? '').trim().toLowerCase()
      return `ip:${clientIp(req)}:${field}:${value || '_'}`
    },
  })
}
