/** Two bounded playback lanes: start the preferred URL now and hedge with a backup shortly after. */
export async function connectWithBackup<T>(
  candidates: AsyncIterable<T> | Iterable<T> | ((signal: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  attempt: (candidate: T, lane: number, signal: AbortSignal) => Promise<boolean>,
  signal: AbortSignal,
  backupDelayMs = 250,
): Promise<{ candidate: T; lane: number } | undefined> {
  if (signal.aborted) return undefined
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const source = typeof candidates === 'function' ? candidates(controller.signal) : candidates
  const iterator: AsyncIterator<T> | Iterator<T> = Symbol.asyncIterator in source
    ? (source as AsyncIterable<T>)[Symbol.asyncIterator]()
    : (source as Iterable<T>)[Symbol.iterator]()
  const waitForBackup = () => new Promise<boolean>(resolve => {
    const stop = () => { clearTimeout(timer); resolve(false) }
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', stop); resolve(true) }, backupDelayMs)
    controller.signal.addEventListener('abort', stop, { once: true })
  })
  const worker = async (lane: number) => {
    if (lane && !await waitForBackup()) return undefined
    while (!controller.signal.aborted) {
      const next = await iterator.next()
      if (next.done || controller.signal.aborted) return undefined
      const ok = await attempt(next.value, lane, controller.signal).catch(() => false)
      if (ok && !controller.signal.aborted) return { candidate: next.value, lane }
    }
    return undefined
  }
  try {
    return await new Promise(resolve => {
      let remaining = 2
      for (const lane of [0, 1]) {
        worker(lane).catch(() => undefined).then(result => {
          if (result) resolve(result)
          if (--remaining === 0) resolve(undefined)
        })
      }
    })
  } finally {
    controller.abort() // release the losing connection, delayed worker and pending probes
    signal.removeEventListener('abort', cancel)
    // Returning an async generator may wait for its pending probe; never delay the winner for that.
    if (iterator.return) void Promise.resolve(iterator.return()).catch(() => undefined)
  }
}
