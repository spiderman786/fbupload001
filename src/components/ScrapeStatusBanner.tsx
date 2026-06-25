import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PageScrapeInfo } from '../api/client'

type Props = {
  scrape: PageScrapeInfo
  totalScraped?: number
  onRetry?: () => void
  retrying?: boolean
}

export function ScrapeStatusBanner({ scrape, totalScraped, onRetry, retrying }: Props) {
  if (scrape.status === 'none') return null

  const scraped = totalScraped ?? scrape.totalScraped
  const showRetry =
    scrape.status === 'scraping_error' &&
    Boolean(onRetry) &&
    (scrape.errorMessage?.toLowerCase().includes('disabled') ||
      scrape.errorMessage?.toLowerCase().includes('paused') ||
      scrape.errorMessage?.toLowerCase().includes('posts per day'))

  if (scrape.status === 'pending_scrap') {
    const catalogHint =
      scrape.catalogTotal != null && scrape.catalogTotal > 0
        ? ` Catalog: ${scraped} / ${scrape.catalogTotal} reels.`
        : scraped > 0
          ? ` ${scraped} scraped so far.`
          : ''
    return (
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
        <div>
          <p className="font-semibold text-primary">Pending Scrap</p>
          <p className="text-sm text-muted-foreground">
            Downloading reels from the assigned creator.{catalogHint}
          </p>
        </div>
      </div>
    )
  }

  if (scrape.status === 'scraping_pending') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="font-semibold text-amber-900">Scraping Pending</p>
          <p className="text-sm text-amber-800">Source updated — queue will re-sync with new content shortly.</p>
        </div>
      </div>
    )
  }

  if (scrape.status === 'scraping_error') {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold text-red-800">Scraping Error</p>
            <p className="text-sm text-red-700">
              {scrape.errorMessage ??
                'Could not scrape this creator. Check the username or wait — false positives often recover automatically.'}
            </p>
            {scrape.errorMessage?.includes('Download Proxies') ? (
              <Link to="/settings/proxy-pool" className="mt-2 inline-block text-sm font-medium text-red-800 underline">
                Open Download Proxies →
              </Link>
            ) : null}
          </div>
        </div>
        {showRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {retrying ? 'Starting…' : 'Enable & retry'}
          </button>
        ) : null}
      </div>
    )
  }

  if (scraped > 0) {
    const catalogSuffix =
      scrape.catalogTotal != null && scrape.catalogTotal > 0 ? ` of ${scrape.catalogTotal.toLocaleString()} in catalog` : ''
    return (
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
        <span className="font-semibold">{scraped.toLocaleString()}</span>
        <span className="text-muted-foreground">{catalogSuffix} reels scraped from current source</span>
      </div>
    )
  }

  return null
}
