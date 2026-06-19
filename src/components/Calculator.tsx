import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'

type Platform = 'instagram' | 'tiktok' | 'youtube' | 'facebook'

const PLATFORMS: { value: Platform; label: string; tokensPerReel: number }[] = [
  { value: 'instagram', label: 'Instagram', tokensPerReel: 1 },
  { value: 'tiktok', label: 'TikTok', tokensPerReel: 2 },
  { value: 'youtube', label: 'YouTube', tokensPerReel: 2 },
  { value: 'facebook', label: 'Facebook', tokensPerReel: 2 },
]

const TOKEN_COST_PKR = 0.5
const DAYS_PER_MONTH = 30

export function Calculator() {
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [reelsPerDay, setReelsPerDay] = useState(2)
  const [pages, setPages] = useState(10)

  const estimate = useMemo(() => {
    const tokenRate = PLATFORMS.find((p) => p.value === platform)?.tokensPerReel ?? 1
    const monthlyReelsPerPage = reelsPerDay * DAYS_PER_MONTH
    const totalMonthlyReels = monthlyReelsPerPage * pages
    const totalTokens = totalMonthlyReels * tokenRate
    const totalCost = totalTokens * TOKEN_COST_PKR

    return {
      tokenRate,
      monthlyReelsPerPage,
      totalMonthlyReels,
      totalTokens,
      totalCost,
    }
  }, [platform, reelsPerDay, pages])

  return (
    <div id="monthly-calculator" className="w-full">
      <div className="mb-6 max-w-none text-center lg:text-left">
        <span className="mb-4 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          Monthly Cost Calculator
        </span>
        <h3 className="mb-4 text-2xl font-bold tracking-tight md:text-4xl">
          Estimate your monthly automation cost
        </h3>
        <p className="text-base leading-relaxed text-muted-foreground md:text-lg">
          Select a source platform, set daily reels and page count, and get an instant monthly
          estimate.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
        <div className="p-6 md:p-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <div className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="source-platform" className="text-sm font-medium">
                  Source platform
                </label>
                <div className="relative">
                  <select
                    id="source-platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as Platform)}
                    className="h-9 w-full appearance-none rounded-md border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="reels-per-day" className="text-sm font-medium">
                  Reels per day (per page)
                </label>
                <input
                  id="reels-per-day"
                  type="number"
                  min={0}
                  value={reelsPerDay}
                  onChange={(e) => setReelsPerDay(Math.max(0, Number(e.target.value)))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="pages-count" className="text-sm font-medium">
                  Number of pages
                </label>
                <input
                  id="pages-count"
                  type="number"
                  min={0}
                  value={pages}
                  onChange={(e) => setPages(Math.max(0, Number(e.target.value)))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
                />
              </div>

              <p id="calculator-assumptions" className="text-xs text-muted-foreground">
                Assumptions: 30 days/month, Instagram uses 1 token per reel, TikTok/YouTube/Facebook
                use 2 tokens per reel, and each token costs PKR 0.5.
              </p>
            </div>

            <div
              className="space-y-4 rounded-2xl border border-border bg-background p-6 md:p-8"
              role="status"
              aria-live="polite"
              aria-describedby="calculator-assumptions"
            >
              <h4 className="text-xl font-semibold">Estimated monthly total</h4>
              <p className="font-display text-4xl font-bold text-primary">
                Rs {estimate.totalCost.toLocaleString()}
              </p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Monthly reels per page:{' '}
                  <span className="font-semibold text-foreground">
                    {estimate.monthlyReelsPerPage}
                  </span>
                </p>
                <p>
                  Total monthly reels:{' '}
                  <span className="font-semibold text-foreground">
                    {estimate.totalMonthlyReels}
                  </span>
                </p>
                <p>
                  Token rate for selected source:{' '}
                  <span className="font-semibold text-foreground">{estimate.tokenRate}</span>{' '}
                  token(s)/reel
                </p>
                <p>
                  Total monthly tokens:{' '}
                  <span className="font-semibold text-foreground">{estimate.totalTokens}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
