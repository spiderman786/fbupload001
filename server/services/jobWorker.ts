import { createAutomationJob } from './automationPipeline.js'
import { enqueueJob } from './jobQueue.js'
import { claimQueuedJobForPublish } from './reelQueue.js'

export function enqueueDirectJob(agencyId: string, userId: string, pageId: string, sourceId?: string): string {
  const fromQueue = claimQueuedJobForPublish(pageId, 'direct')
  if (fromQueue) {
    enqueueJob(fromQueue)
    return fromQueue
  }

  const id = createAutomationJob(agencyId, userId, pageId, 'direct', sourceId)
  enqueueJob(id)
  return id
}
