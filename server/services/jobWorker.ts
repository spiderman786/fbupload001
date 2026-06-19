import { createAutomationJob } from './automationPipeline.js'
import { enqueueJob } from './jobQueue.js'

export function enqueueDirectJob(agencyId: string, userId: string, pageId: string, sourceId?: string): string {
  const id = createAutomationJob(agencyId, userId, pageId, 'direct', sourceId)
  enqueueJob(id)
  return id
}
