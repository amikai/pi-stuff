export type Wake = { requestRender: () => void; onInvalidate?: () => void }

export type Background<V> = {
  /**
   * Pi rebuilds the component on every streamed token, so every call made while the job is unsettled
   * keeps its own `wake.onInvalidate`, not only the first.
   */
  get(key: string, run: () => Promise<V>, wake: Wake): V | undefined
  put(key: string, value: V): void
  readonly cache: ReadonlyMap<string, V>
  readonly pending: ReadonlyMap<string, ReadonlySet<() => void>>
  idle(ms?: number): Promise<void>
  clear(): void
}

export type BackgroundOptions<V> = {
  limit: number
  concurrency: number
  crashed: V
}

export const background = <V>(options: BackgroundOptions<V>): Background<V> => {
  const cache = new Map<string, V>()
  const pending = new Map<string, Set<() => void>>()
  const queue: Array<() => void> = []
  let waiters: Array<() => void> = []
  let running = 0
  let generation = 0

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
          const started = generation
          run()
            .catch(() => options.crashed)
            .then(value => {
              if (started === generation) store(key, value)
            })
            .finally(() => {
              if (started !== generation) {
                running--
                pump()
                return
              }
              pending.delete(key)
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
      generation++
      cache.clear()
      pending.clear()
      queue.length = 0
      release()
    },
  }
}
