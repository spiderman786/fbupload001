import { db } from '../db.js'

const SCRAPE_OWNED = new Set(['invalid_username', 'source_exhausted', 'creator_suspended'])

export function inferHealthStatusFromError(message: string, context: 'publish' | 'download' | 'scrape'): string | null {
  const msg = message.toLowerCase()

  if (context === 'scrape') {
    if (/suspended|banned|disabled.*account|account.*disabled|private.*account/i.test(msg)) return 'creator_suspended'
    if (/invalid username|user not found|does not exist|account not found|http error 404/i.test(msg)) return 'invalid_username'
    if (/rate limit|429|too many requests/i.test(msg)) return 'rate_limited'
    return null
  }

  if (context === 'download') {
    if (/rate limit|429|too many requests|blocked|403 forbidden/i.test(msg)) return 'rate_limited'
    return null
  }

  // publish / Meta Graph API
  if (/rate limit|429|too many calls|(#4\b|error 4\b|error code 4)/i.test(msg)) return 'rate_limited'
  if (/invalid.*token|190\b|oauth|session.*expired|access token|token.*expired|error validating access token/i.test(msg))
    return 'invalid_token'
  if (/verification|confirm your identity|checkpoint/i.test(msg)) return 'verification_required'
  if (/two.?factor|2fa|two-step/i.test(msg)) return 'twofa_required_bm'
  if (/suspended|disabled|restricted.*account|account.*disabled/i.test(msg)) return 'account_suspended'
  if (/page.*not.*access|permission.*page|cannot.*post|not.*authorized.*page|200\b.*permission/i.test(msg))
    return 'page_not_accessible'
  if (/app.*not.*approved|dev.*app|development mode|#10\b|#200.*permission/i.test(msg)) return 'check_dev_app'

  return null
}

export function applyPageHealthFromError(pageId: string, message: string, context: 'publish' | 'download' | 'scrape') {
  const page = db.prepare('SELECT health_status FROM facebook_pages WHERE id = ?').get(pageId) as
    | { health_status: string }
    | undefined
  if (!page) return

  if (context === 'publish' && SCRAPE_OWNED.has(page.health_status)) return

  const next = inferHealthStatusFromError(message, context)
  if (next && next !== page.health_status) {
    db.prepare('UPDATE facebook_pages SET health_status = ? WHERE id = ?').run(next, pageId)
  }
}

export function markPageHealthCompleted(pageId: string) {
  db.prepare("UPDATE facebook_pages SET health_status = 'completed' WHERE id = ?").run(pageId)
}
