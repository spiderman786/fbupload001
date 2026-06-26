const MAX_CONCURRENT = Math.min(20, Math.max(1, Number(process.env.NEWS_COMPOSITOR_CONCURRENCY ?? 8)))

let active = 0
const waitQueue: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      active++
      resolve()
    })
  })
}

function release() {
  active = Math.max(0, active - 1)
  const next = waitQueue.shift()
  if (next) next()
}

export async function runCompositorJob<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

export function getCompositorQueueStats() {
  return { active, waiting: waitQueue.length, maxConcurrent: MAX_CONCURRENT }
}
