import { db } from '../db.js'
import { pageHasInflightPublishJob } from './reelQueue.js'
import { canPagePostToday } from './pageQuota.js'
import { enqueuePagePublishJob } from './pagePublishScheduler.js'

export function enqueueDirectJob(agencyId: string, userId: string, pageId: string, sourceId?: string): string {
  if (pageHasInflightPublishJob(pageId)) {
    throw new Error('A publish is already in progress for this page — wait for it to finish')
  }
  if (!canPagePostToday(pageId)) {
    throw new Error('Daily post limit reached for this page — try again tomorrow or raise posts/day in Settings')
  }

  const jobId = enqueuePagePublishJob(agencyId, userId, pageId, 'direct')
  if (!jobId) {
    throw new Error('Could not queue publish — another post may already be in progress for this page')
  }

  if (sourceId) {
    db.prepare('UPDATE reel_jobs SET source_account_id = ? WHERE id = ?').run(sourceId, jobId)
  }

  return jobId
}
