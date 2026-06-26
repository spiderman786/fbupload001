import 'dotenv/config'
import express from 'express'
import { isR2Enabled } from './services/r2Storage.js'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { initDb } from './db.js'
import { authRouter } from './routes/auth.js'
import { pagesRouter } from './routes/pages.js'
import { sourcesRouter } from './routes/sources.js'
import { scheduleRouter } from './routes/schedule.js'
import { tokensRouter } from './routes/tokens.js'
import { facebookRouter } from './routes/facebook.js'
import { reelsRouter } from './routes/reels.js'
import { dashboardRouter } from './routes/dashboard.js'
import { automationRouter } from './routes/automation.js'
import { byocRouter } from './routes/byoc.js'
import { agenciesRouter } from './routes/agencies.js'
import { initProxyPool, getProxyPoolStats } from './services/proxyPool.js'
import { proxyPoolRouter } from './routes/proxyPool.js'
import { opsRouter } from './routes/ops.js'
import { newsRouter } from './routes/news.js'
import { seedPlatformAdmin, logPlatformAdminMode } from './services/platformAdmin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

initDb()
await seedPlatformAdmin()
logPlatformAdminMode()
initProxyPool()

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
)
app.use(express.json())
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    r2: isR2Enabled(),
  })
})

app.use('/api/auth', authRouter)
app.use('/api/pages', pagesRouter)
app.use('/api/sources', sourcesRouter)
app.use('/api/schedule', scheduleRouter)
app.use('/api/tokens', tokensRouter)
app.use('/api/facebook', facebookRouter)
app.use('/api/reels', reelsRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/automation', automationRouter)
app.use('/api/byoc', byocRouter)
app.use('/api/agencies', agenciesRouter)
app.use('/api/proxy-pool', proxyPoolRouter)
app.use('/api/ops', opsRouter)
app.use('/api/news', newsRouter)

// Serve frontend in production (never swallow /api/* — dist/ exists in dev after builds)
const distPath = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Running on http://0.0.0.0:${PORT}`)
  console.log(`[server] Facebook OAuth: ${process.env.FACEBOOK_APP_ID ? 'configured' : 'mock mode'}`)
  console.log(`[server] Proxy pool: ${getProxyPoolStats().poolSize} proxies loaded`)
})
