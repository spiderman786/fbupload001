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

  const slot = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + 60_000
  while (!settled) {
    if (Date.now() > deadline) throw new Error('Database query timed out after 60s')
    Atomics.wait(slot, 0, 0, 4)
  }

  if (error) throw error
  return value
}
