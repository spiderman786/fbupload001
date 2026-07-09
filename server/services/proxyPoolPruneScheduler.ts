import cron from 'node-cron'
import { isAutoPruneEnabled, pruneDeadProxies } from './proxyPool.js'

let started = false

export function startProxyPoolPruneScheduler(): void {
  if (started || !isAutoPruneEnabled()) return
  started = true

  const cronExpr = process.env.PROXY_AUTO_PRUNE_CRON ?? '0 */6 * * *'
  cron.schedule(cronExpr, () => {
    void pruneDeadProxies()
      .then((result) => {
        if (result.removed > 0) {
          console.log(`[proxy-pool] scheduled prune kept ${result.kept}, removed ${result.removed}`)
        }
      })
      .catch((err) => {
        console.error('[proxy-pool] scheduled prune failed:', err instanceof Error ? err.message : err)
      })
  })

  console.log(`[proxy-pool] auto-prune scheduler started (${cronExpr})`)
}
