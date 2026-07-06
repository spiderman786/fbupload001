import deasync from 'deasync'

/** Block until a promise settles while yielding to the Node event loop (pg compat for sync call sites). */
export function runSync<T>(promise: Promise<T>): T {
  let settled = false
  let value!: T
  let error: unknown

  void promise.then(
    (v) => {
      value = v
      settled = true
    },
    (e) => {
      error = e
      settled = true
    },
  )

  deasync.loopWhile(() => !settled)

  if (error) throw error
  return value
}
