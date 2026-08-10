import { Router } from 'express'
import { getPublicLiveSnapshot } from '../services/publicLiveSnapshot.js'

export const publicRouter = Router()

publicRouter.get('/live-snapshot', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=2')
  res.json(getPublicLiveSnapshot())
})
