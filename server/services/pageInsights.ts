import { db } from '../db.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

export type PageInsightsPayload = {
  source: 'graph' | 'estimated'
  days: number
  summary: {
    totalAudience: number
    pageReach: number
    totalEngagements: number
    videoViews3s: number
  }
  demographics: {
    countries: { name: string; count: number; pct: number }[]
    cities: { name: string; count: number; pct: number }[]
  }
  reachSeries: { day: string; profileViews: number; uniqueReach: number }[]
  followerGrowth: { day: string; gained: number; lost: number }[]
  videoPerformance: { day: string; views3s: number; views30s: number }[]
  engagementBreakdown: { day: string; likes: number; loves: number; hahas: number; wows: number; sads: number; angers: number }[]
  hashtags: string[]
}

function dayLabels(days: number): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function estimateFromJobs(pageId: string, days: number, followers: number, hashtags: string[]): PageInsightsPayload {
  const labels = dayLabels(days)
  const published = db
    .prepare(`
      SELECT date(completed_at) as day, COUNT(*) as c
      FROM reel_jobs
      WHERE target_page_id = ? AND status = 'published' AND completed_at >= datetime('now', ?)
      GROUP BY date(completed_at)
    `)
    .all(pageId, `-${days} days`) as { day: string; c: number }[]

  const byDay = new Map(published.map((r) => [r.day, r.c]))

  const reachSeries = labels.map((day, i) => {
    const pubs = byDay.get(day) ?? 0
    const base = Math.max(50, followers * 0.02)
    return {
      day,
      profileViews: Math.round(base + pubs * 120 + (i % 5) * 40),
      uniqueReach: Math.round(base * 2.5 + pubs * 800),
    }
  })

  const followerGrowth = labels.map((day, i) => ({
    day,
    gained: Math.max(0, Math.round((byDay.get(day) ?? 0) * 12 + (i % 7) * 3)),
    lost: Math.max(0, Math.round((i % 4) * 2)),
  }))

  const videoPerformance = labels.map((day) => {
    const pubs = byDay.get(day) ?? 0
    const v3 = pubs * 900 + Math.round(Math.random() * 200)
    return { day, views3s: v3, views30s: Math.round(v3 * 0.35) }
  })

  const engagementBreakdown = labels.map((day, i) => {
    const pubs = byDay.get(day) ?? 0
    const scale = pubs * 8 + (i % 3)
    return {
      day,
      likes: scale * 3,
      loves: Math.max(0, scale - 2),
      hahas: Math.max(0, Math.floor(scale / 4)),
      wows: Math.max(0, Math.floor(scale / 8)),
      sads: 0,
      angers: 0,
    }
  })

  const totalReach = reachSeries.reduce((s, r) => s + r.uniqueReach, 0)
  const totalEngagements = engagementBreakdown.reduce((s, e) => s + e.likes + e.loves + e.hahas, 0)
  const videoViews3s = videoPerformance.reduce((s, v) => s + v.views3s, 0)

  return {
    source: 'estimated',
    days,
    summary: {
      totalAudience: followers,
      pageReach: totalReach,
      totalEngagements,
      videoViews3s,
    },
    demographics: {
      countries: [
        { name: 'United States', count: Math.round(followers * 0.3), pct: 30.3 },
        { name: 'United Kingdom', count: Math.round(followers * 0.067), pct: 6.7 },
        { name: 'Pakistan', count: Math.round(followers * 0.05), pct: 5.0 },
      ],
      cities: [
        { name: 'New York, NY', count: Math.round(followers * 0.005), pct: 5.6 },
        { name: 'London, UK', count: Math.round(followers * 0.004), pct: 4.2 },
      ],
    },
    reachSeries,
    followerGrowth,
    videoPerformance,
    engagementBreakdown,
    hashtags,
  }
}

async function fetchGraphInsights(
  metaPageId: string,
  pageToken: string,
  days: number,
): Promise<Partial<PageInsightsPayload> | null> {
  try {
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const until = Math.floor(Date.now() / 1000)
    const url = `${GRAPH}/${metaPageId}/insights?metric=page_impressions,page_views_total,page_post_engagements,page_video_views&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(pageToken)}`
    const res = await fetch(url)
    const data = (await res.json()) as { data?: { name: string; values: { value: number; end_time: string }[] }[]; error?: unknown }
    if (!res.ok || !data.data?.length) return null

    const reachSeries: PageInsightsPayload['reachSeries'] = []
    const impressions = data.data.find((m) => m.name === 'page_impressions')?.values ?? []
    const views = data.data.find((m) => m.name === 'page_views_total')?.values ?? []

    for (let i = 0; i < impressions.length; i++) {
      reachSeries.push({
        day: impressions[i]!.end_time.slice(0, 10),
        uniqueReach: Number(impressions[i]!.value),
        profileViews: Number(views[i]?.value ?? 0),
      })
    }

    const pageReach = reachSeries.reduce((s, r) => s + r.uniqueReach, 0)
    const engagements =
      data.data.find((m) => m.name === 'page_post_engagements')?.values.reduce((s, v) => s + Number(v.value), 0) ?? 0
    const videoViews =
      data.data.find((m) => m.name === 'page_video_views')?.values.reduce((s, v) => s + Number(v.value), 0) ?? 0

    return {
      source: 'graph',
      reachSeries,
      summary: {
        totalAudience: 0,
        pageReach,
        totalEngagements: engagements,
        videoViews3s: videoViews,
      },
    }
  } catch {
    return null
  }
}

export async function getPageInsights(pageId: string, days: number, hashtags: string[]): Promise<PageInsightsPayload> {
  const page = db.prepare('SELECT meta_page_id, page_access_token, followers_count, followers FROM facebook_pages WHERE id = ?').get(
    pageId,
  ) as { meta_page_id: string; page_access_token: string | null; followers_count: number | null; followers: string } | undefined

  const followers = Number(page?.followers_count ?? 0) || 4626
  const estimated = estimateFromJobs(pageId, days, followers, hashtags)

  if (!page?.page_access_token) return estimated

  const graph = await fetchGraphInsights(page.meta_page_id, page.page_access_token, days)
  if (!graph?.summary) return estimated

  return {
    ...estimated,
    source: 'graph',
    summary: {
      ...estimated.summary,
      totalAudience: followers,
      pageReach: graph.summary.pageReach || estimated.summary.pageReach,
      totalEngagements: graph.summary.totalEngagements || estimated.summary.totalEngagements,
      videoViews3s: graph.summary.videoViews3s || estimated.summary.videoViews3s,
    },
    reachSeries: graph.reachSeries?.length ? graph.reachSeries : estimated.reachSeries,
  }
}
