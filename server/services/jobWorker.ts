import { createAutomationJob } from './automationPipeline.js'
import { enqueueJob } from './jobQueue.js'
import { pageHasInflightPublishJob } from './reelQueue.js'
import { canPagePostToday } from './pageQuota.js'

export function enqueueDirectJob(agencyId: string, userId: string, pageId: string, sourceId?: string): string {
  if (pageHasInflightPublishJob(pageId)) {
    throw new Error('A publish is already in progress for this page — wait for it to finish')
  }
  if (!canPagePostToday(pageId)) {
    throw new Error('Daily post limit reached for this page — try again tomorrow or raise posts/day in Settings')
  }

  const id = createAutomationJob(agencyId, userId, pageId, 'direct', sourceId)
  enqueueJob(id)
  return id
}
