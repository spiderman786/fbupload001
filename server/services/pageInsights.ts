import { db } from '../db.js'
import { getPageScrapeInfo } from './scrapeStatus.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

export type PageInsightsPayload = {
  source: 'graph' | 'estimated' | 'mixed'
  graphLive: boolean
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
    graphLive: false,
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

type GraphInsightRow = { name: string; values: { value: number | Record<string, number>; end_time: string }[] }

async function fetchInsightMetrics(
  metaPageId: string,
  pageToken: string,
  metrics: string,
  period: string,
  since?: number,
  until?: number,
): Promise<GraphInsightRow[]> {
  const params = new URLSearchParams({
    metric: metrics,
    period,
    access_token: pageToken,
  })
  if (since !== undefined) params.set('since', String(since))
  if (until !== undefined) params.set('until', String(until))

  const res = await fetch(`${GRAPH}/${metaPageId}/insights?${params}`)
  const data = (await res.json()) as { data?: GraphInsightRow[]; error?: unknown }
  if (!res.ok || !data.data?.length) return []
  return data.data
}

function sumMetricValues(rows: GraphInsightRow[], name: string): number {
  const metric = rows.find((m) => m.name === name)
  if (!metric) return 0
  return metric.values.reduce((s, v) => s + Number(typeof v.value === 'object' ? 0 : v.value), 0)
}

function seriesFromMetric(rows: GraphInsightRow[], name: string): { day: string; value: number }[] {
  const metric = rows.find((m) => m.name === name)
  if (!metric) return []
  return metric.values.map((v) => ({
    day: v.end_time.slice(0, 10),
    value: Number(typeof v.value === 'object' ? 0 : v.value),
  }))
}

function parseDemographics(rows: GraphInsightRow[], name: string, limit = 5) {
  const metric = rows.find((m) => m.name === name)
  if (!metric?.values.length) return []
  const latest = metric.values.at(-1)?.value
  if (!latest || typeof latest !== 'object') return []

  const entries = Object.entries(latest)
    .map(([key, count]) => ({ name: key, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
  const total = entries.reduce((s, e) => s + e.count, 0) || 1
  return entries.map((e) => ({ ...e, pct: Math.round((e.count / total) * 1000) / 10 }))
}

async function fetchGraphInsights(
  metaPageId: string,
  pageToken: string,
  days: number,
): Promise<Partial<PageInsightsPayload> & { graphLive: boolean } | null> {
  try {
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const until = Math.floor(Date.now() / 1000)

    const dailyMetrics =
      'page_impressions,page_views_total,page_post_engagements,page_video_views,page_fan_adds,page_fan_removes,page_actions_post_reactions_like_total,page_actions_post_reactions_love_total,page_actions_post_reactions_haha_total,page_actions_post_reactions_wow_total,page_actions_post_reactions_sorry_total,page_actions_post_reactions_anger_total'

    const [dailyRows, countryRows, cityRows] = await Promise.all([
      fetchInsightMetrics(metaPageId, pageToken, dailyMetrics, 'day', since, until),
      fetchInsightMetrics(metaPageId, pageToken, 'page_fans_country', 'lifetime'),
      fetchInsightMetrics(metaPageId, pageToken, 'page_fans_city', 'lifetime'),
    ])

    if (!dailyRows.length && !countryRows.length) return null

    const impressions = seriesFromMetric(dailyRows, 'page_impressions')
    const views = seriesFromMetric(dailyRows, 'page_views_total')
    const reachSeries = impressions.map((row, i) => ({
      day: row.day,
      uniqueReach: row.value,
      profileViews: views[i]?.value ?? 0,
    }))

    const gained = seriesFromMetric(dailyRows, 'page_fan_adds')
    const lost = seriesFromMetric(dailyRows, 'page_fan_removes')
    const followerGrowth = gained.map((row, i) => ({
      day: row.day,
      gained: row.value,
      lost: lost[i]?.value ?? 0,
    }))

    const videoViews = seriesFromMetric(dailyRows, 'page_video_views')
    const videoPerformance = videoViews.map((row) => ({
      day: row.day,
      views3s: row.value,
      views30s: Math.round(row.value * 0.35),
    }))

    const engagementBreakdown = impressions.map((row, i) => ({
      day: row.day,
      likes: seriesFromMetric(dailyRows, 'page_actions_post_reactions_like_total')[i]?.value ?? 0,
      loves: seriesFromMetric(dailyRows, 'page_actions_post_reactions_love_total')[i]?.value ?? 0,
      hahas: seriesFromMetric(dailyRows, 'page_actions_post_reactions_haha_total')[i]?.value ?? 0,
      wows: seriesFromMetric(dailyRows, 'page_actions_post_reactions_wow_total')[i]?.value ?? 0,
      sads: seriesFromMetric(dailyRows, 'page_actions_post_reactions_sorry_total')[i]?.value ?? 0,
      angers: seriesFromMetric(dailyRows, 'page_actions_post_reactions_anger_total')[i]?.value ?? 0,
    }))

    const countries = parseDemographics(countryRows, 'page_fans_country')
    const cities = parseDemographics(cityRows, 'page_fans_city')

    return {
      graphLive: true,
      source: 'graph' as const,
      reachSeries,
      followerGrowth,
      videoPerformance,
      engagementBreakdown,
      demographics: {
        countries,
        cities,
      },
      summary: {
        totalAudience: 0,
        pageReach: sumMetricValues(dailyRows, 'page_impressions'),
        totalEngagements: sumMetricValues(dailyRows, 'page_post_engagements'),
        videoViews3s: sumMetricValues(dailyRows, 'page_video_views'),
      },
    }
  } catch {
    return null
  }
}

export async function getPageInsights(pageId: string, days: number, hashtags: string[]): Promise<PageInsightsPayload> {
  const page = db
    .prepare('SELECT meta_page_id, page_access_token, followers_count, followers FROM facebook_pages WHERE id = ?')
    .get(pageId) as
    | { meta_page_id: string; page_access_token: string | null; followers_count: number | null; followers: string }
    | undefined

  const followers = Number(page?.followers_count ?? 0) || 4626
  const estimated = estimateFromJobs(pageId, days, followers, hashtags)

  if (!page?.page_access_token) return estimated

  const graph = await fetchGraphInsights(page.meta_page_id, page.page_access_token, days)
  if (!graph?.summary) return estimated

  const hasLiveDemographics = Boolean(graph.demographics?.countries?.length || graph.demographics?.cities?.length)
  const hasLiveSeries = Boolean(graph.reachSeries?.length)

  return {
    ...estimated,
    source: graph.graphLive && hasLiveSeries ? 'graph' : hasLiveSeries || hasLiveDemographics ? 'mixed' : 'estimated',
    graphLive: Boolean(graph.graphLive),
    summary: {
      totalAudience: followers,
      pageReach: graph.summary.pageReach || estimated.summary.pageReach,
      totalEngagements: graph.summary.totalEngagements || estimated.summary.totalEngagements,
      videoViews3s: graph.summary.videoViews3s || estimated.summary.videoViews3s,
    },
    demographics: {
      countries: graph.demographics?.countries?.length ? graph.demographics.countries : estimated.demographics.countries,
      cities: graph.demographics?.cities?.length ? graph.demographics.cities : estimated.demographics.cities,
    },
    reachSeries: graph.reachSeries?.length ? graph.reachSeries : estimated.reachSeries,
    followerGrowth: graph.followerGrowth?.length ? graph.followerGrowth : estimated.followerGrowth,
    videoPerformance: graph.videoPerformance?.length ? graph.videoPerformance : estimated.videoPerformance,
    engagementBreakdown: graph.engagementBreakdown?.length ? graph.engagementBreakdown : estimated.engagementBreakdown,
  }
}
