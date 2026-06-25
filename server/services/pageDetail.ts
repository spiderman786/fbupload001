import { db } from '../db.js'
import { getPageAutomationSettings, ensurePageAutomationSettings } from './pageAutomationSettings.js'
import { getPageScrapeInfo } from './scrapeStatus.js'
import { queueItemHasPreview } from './queueActions.js'
import { getPageTodayStats, syncPagePostedToday } from '../utils/pageDayStats.js'
import { getSignedPreviewUrl, isR2Enabled } from './r2Storage.js'

export function getAgencyPage(pageId: string, agencyId: string) {
  return db.prepare('SELECT * FROM facebook_pages WHERE id = ? AND agency_id = ?').get(pageId, agencyId) as
    | Record<string, unknown>
    | undefined
}

export function getPageDetail(pageId: string, agencyId: string) {
  const page = getAgencyPage(pageId, agencyId)
  if (!page) return null

  ensurePageAutomationSettings(pageId)
  const settings = getPageAutomationSettings(pageId)

  const assignment = db
    .prepare(`
      SELECT s.id, s.username, s.platform, s.is_active
      FROM page_source_assignments a
      JOIN source_accounts s ON s.id = a.source_account_id
      WHERE a.page_id = ?
    `)
    .get(pageId) as { id: string; username: string; platform: string; is_active: number } | undefined

  const fbAccount = page.facebook_account_id
    ? (db
        .prepare(`
          SELECT fa.id, fa.meta_user_id, fa.connected_at, u.full_name
          FROM facebook_accounts fa
          LEFT JOIN users u ON u.id = fa.user_id
          WHERE fa.id = ?
        `)
        .get(page.facebook_account_id) as
        | { id: string; meta_user_id: string; connected_at: string; full_name: string | null }
        | undefined)
    : undefined

  const reelsReady = (
    db.prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ? AND status = 'queued'").get(pageId) as {
      c: number
    }
  ).c

  const successful = (
    db.prepare("SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ? AND status = 'published'").get(pageId) as {
      c: number
    }
  ).c

  const requireAttention =
    page.health_status !== 'completed' || page.status !== 'active'
      ? 1
      : (
          db
            .prepare(`
              SELECT COUNT(*) as c FROM reel_jobs
              WHERE target_page_id = ? AND status = 'failed'
                AND created_at >= datetime('now', '-7 days')
            `)
            .get(pageId) as { c: number }
        ).c

  const dailyLimit = Number(page.daily_reel_limit ?? settings.postsPerDay)
  const todayStats = getPageTodayStats(pageId)
  syncPagePostedToday(pageId)
  const postedToday = todayStats.publishedToday
  const errorsToday = todayStats.errorsToday
  const publishedToday = todayStats.publishedToday

  const reelsStarted = (
    db.prepare('SELECT COUNT(*) as c FROM reel_jobs WHERE target_page_id = ?').get(pageId) as { c: number }
  ).c

  const scrape = getPageScrapeInfo(pageId)

  return {
    page: {
      id: page.id,
      metaPageId: page.meta_page_id,
      name: page.name,
      followers: page.followers,
      followersGained: page.followers_gained ?? 0,
      status: page.status,
      healthStatus: page.health_status ?? 'completed',
      reelsPostedToday: postedToday,
      dailyReelLimit: dailyLimit,
      reelsRemainingToday: Math.max(0, dailyLimit - postedToday),
      lastPublishedAt: page.last_published_at,
      createdAt: page.created_at,
      reelsStarted,
    },
    source: assignment
      ? {
          id: assignment.id,
          username: assignment.username,
          platform: assignment.platform,
          isActive: Boolean(assignment.is_active),
          scrapeStatus: scrape?.status ?? 'none',
          scrapeLabel: scrape?.label ?? 'No source',
          scrapeError: scrape?.errorMessage ?? null,
        }
      : null,
    scrape: scrape ?? {
      status: 'none' as const,
      label: 'No source',
      totalScraped: 0,
      catalogTotal: null,
      errorMessage: null,
      inflightDownloads: 0,
    },
    facebookIdentity: fbAccount
      ? { name: fbAccount.full_name ?? fbAccount.meta_user_id, uid: fbAccount.meta_user_id, connectedAt: fbAccount.connected_at }
      : null,
    settings,
    stats: {
      total: {
        reelsReady,
        successfulAutomations: successful,
        requireAttention,
        netGrowth: Number(page.followers_gained ?? 0),
        totalScraped: scrape?.totalScraped ?? 0,
      },
      today: {
        remainingScheduled: Math.max(0, dailyLimit - postedToday),
        publishedToday,
        errorsToday,
      },
    },
  }
}

export async function getPageQueue(pageId: string) {
  const rows = db
    .prepare(`
      SELECT r.id, r.status, r.source_url, r.source_reel_id, r.created_at, r.caption,
        r.thumbnail_path, r.cleaned_file_path, r.r2_video_key, r.r2_thumb_key,
        s.username as source_username, s.platform as source_platform
      FROM reel_jobs r
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.target_page_id = ? AND r.status = 'queued'
      ORDER BY r.created_at ASC
      LIMIT 100
    `)
    .all(pageId)

  return Promise.all(
    rows.map(async (row) => {
      const r = row as Record<string, unknown>
      const preview = queueItemHasPreview(
        r.cleaned_file_path,
        r.thumbnail_path,
        r.r2_video_key,
        r.r2_thumb_key,
      )

      let previewVideoUrl: string | null = null
      let previewThumbUrl: string | null = null
      if (isR2Enabled()) {
        if (typeof r.r2_video_key === 'string' && r.r2_video_key) {
          previewVideoUrl = await getSignedPreviewUrl(r.r2_video_key)
        }
        if (typeof r.r2_thumb_key === 'string' && r.r2_thumb_key) {
          previewThumbUrl = await getSignedPreviewUrl(r.r2_thumb_key)
        }
      }

      return {
        id: r.id,
        status: r.status,
        sourceUrl: r.source_url,
        sourceReelId: r.source_reel_id,
        sourceUsername: r.source_username,
        sourcePlatform: r.source_platform ?? 'instagram',
        caption: r.caption,
        createdAt: r.created_at,
        hasPreview: preview.hasPreview,
        hasThumbnail: preview.hasThumbnail,
        previewVideoUrl,
        previewThumbUrl,
      }
    }),
  )
}

export function getPageFailedPosts(pageId: string, limit = 50) {
  return db
    .prepare(`
      SELECT r.id, r.error_message, r.completed_at, r.created_at, r.retry_count, s.username as source_username
      FROM reel_jobs r
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.target_page_id = ? AND r.status = 'failed'
      ORDER BY r.completed_at DESC
      LIMIT ?
    `)
    .all(pageId, limit)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id,
        errorMessage: r.error_message,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        retryCount: r.retry_count,
        sourceUsername: r.source_username,
      }
    })
}

export function getPageFailedReasons(pageId: string) {
  return db
    .prepare(`
      SELECT error_message, COUNT(*) as count, MAX(completed_at) as last_at
      FROM reel_jobs
      WHERE target_page_id = ? AND status = 'failed' AND error_message IS NOT NULL
      GROUP BY error_message
      ORDER BY count DESC
      LIMIT 25
    `)
    .all(pageId)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        errorMessage: r.error_message,
        count: r.count,
        lastAt: r.last_at,
      }
    })
}

export function getPageReelsHistory(pageId: string, limit = 50) {
  return db
    .prepare(`
      SELECT r.id, r.status, r.source_url, r.meta_post_id, r.completed_at, r.created_at, s.username as source_username
      FROM reel_jobs r
      LEFT JOIN source_accounts s ON s.id = r.source_account_id
      WHERE r.target_page_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?
    `)
    .all(pageId, limit)
    .map((row) => {
      const r = row as Record<string, unknown>
      return {
        id: r.id,
        status: r.status,
        sourceUrl: r.source_url,
        metaPostId: r.meta_post_id,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        sourceUsername: r.source_username,
      }
    })
}
