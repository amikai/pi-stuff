/** How a settled job reaches the screen: invalidate the component tree cache, then ask pi to paint. */
export type Wake = { requestRender: () => void; onInvalidate?: () => void }

export type Background<V> = {
  /**
   * The settled value for `key`, or undefined while its job is queued or running.
   * The first call for a key starts `run`, or queues it behind `concurrency` running jobs.
   * Pi rebuilds the component on every streamed token, so every call made while the job is unsettled
   * keeps its own `wake.onInvalidate`, not only the first.
   * A hit moves the key to the young end of the LRU.
   */
  get(key: string, run: () => Promise<V>, wake: Wake): V | undefined
  /** Stores an answer known without running anything. */
  put(key: string, value: V): void
  /** Settled values, oldest first. */
  readonly cache: ReadonlyMap<string, V>
  /** Keys queued or running, each with the invalidators collected so far. */
  readonly pending: ReadonlyMap<string, ReadonlySet<() => void>>
  /** Resolves once nothing is queued or running, and rejects after `ms`. */
  idle(ms?: number): Promise<void>
  /** Drops every settled value and forgets pending keys. A job already running still settles into the cleared cache. */
  clear(): void
}

export type BackgroundOptions<V> = {
  /** LRU size in entries. */
  limit: number
  /** Jobs allowed to run at once; the rest wait in first-seen order. */
  concurrency: number
  /** Stored when `run` rejects, so a crash settles like any failure. */
  crashed: V
}

export const background = <V>(options: BackgroundOptions<V>): Background<V> => {
  const cache = new Map<string, V>()
  const pending = new Map<string, Set<() => void>>()
  const queue: Array<() => void> = []
  let waiters: Array<() => void> = []
  let running = 0

  const store = (key: string, value: V): void => {
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > options.limit) cache.delete(cache.keys().next().value!)
  }

  const release = (): void => {
    if (pending.size > 0) return
    const ready = waiters
    waiters = []
    for (const resolve of ready) resolve()
  }

  const pump = (): void => {
    while (running < options.concurrency && queue.length > 0) queue.shift()!()
  }

  return {
    get(key, run, wake) {
      const hit = cache.get(key)
      if (hit !== undefined) {
        cache.delete(key)
        cache.set(key, hit)
        return hit
      }
      if (!pending.has(key)) {
        const invalidators = new Set<() => void>()
        pending.set(key, invalidators)
        queue.push(() => {
          running++
          run()
            .catch(() => options.crashed)
            .then(value => store(key, value))
            .finally(() => {
              if (pending.get(key) === invalidators) pending.delete(key)
              running--
              pump()
              try {
                for (const invalidate of invalidators) invalidate()
                wake.requestRender()
              } finally {
                release()
              }
            })
            .catch(() => {})
        })
        pump()
      }
      if (wake.onInvalidate) pending.get(key)?.add(wake.onInvalidate)
      return undefined
    },
    put: store,
    cache,
    pending,
    idle(ms = 15000) {
      if (pending.size === 0) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`background jobs still pending after ${ms} ms`)), ms)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
    clear() {
      cache.clear()
      pending.clear()
      queue.length = 0
      release()
    },
  }
}
