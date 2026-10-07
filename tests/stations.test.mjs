import test from 'node:test'
import assert from 'node:assert/strict'
import { probeStream, reachableUrl, readyStations, loadDirectory, rememberStation, lastStation } from '../src/ai-radio/stations.ts'

const forever = new Promise(() => {})
const response = () => new Response('', { headers: { 'content-type': 'audio/mpeg' } })
const station = (name, urls) => ({ name, urls, origin: 'curated' })
function network(t, handler) {
  const calls = [], aborted = []
  t.mock.method(globalThis, 'fetch', (url, options = {}) => {
    calls.push(String(url))
    return new Promise((resolve, reject) => {
      const cancel = () => { aborted.push(String(url)); reject(new DOMException('Aborted', 'AbortError')) }
      if (options.signal?.aborted) return cancel()
      options.signal?.addEventListener('abort', cancel, { once: true })
      Promise.resolve(handler(String(url))).then(resolve, reject)
    })
  })
  return { calls, aborted }
}
function storage(t) {
  const data = new Map()
  t.mock.property(globalThis, 'localStorage', { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) })
}
// Node does not expose browser localStorage unless configured; install only this test stub.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {} })

test('a healthy mirror is returned without waiting for an unresponsive first mirror', { timeout: 1000 }, async t => {
  const urls = ['https://slow-mirror.test/radio', 'https://fast-mirror.test/radio']
  const { aborted } = network(t, url => url === urls[0] ? forever : response())
  assert.equal(await reachableUrl(station('radio', urls)), urls[1])
  assert.ok(aborted.includes(urls[0]), 'cancel the losing mirror')
})

test('a ready station is yielded before a slower station in the same batch', { timeout: 1000 }, async t => {
  const slow = station('slow', ['https://slow-batch.test/radio'])
  const fast = station('fast', ['https://fast-batch.test/radio'])
  const { aborted } = network(t, url => url === slow.urls[0] ? forever : response())
  for await (const ready of readyStations([slow, fast], new AbortController().signal)) {
    assert.equal(ready.station.name, 'fast')
    break
  }
  assert.ok(aborted.includes(slow.urls[0]), 'stop unused batch probes after a winner')
})

test('successful and failed probes are cached, but user cancellation is not cached as failure', async t => {
  const { calls } = network(t, url => url.includes('canceled') ? forever : url.includes('bad') ? new Response('', { status: 503 }) : response())
  const good = 'https://cached-good.test/radio', bad = 'https://cached-bad.test/radio'
  assert.equal(await probeStream(good), true)
  assert.equal(await probeStream(good), true)
  assert.equal(await probeStream(bad), false)
  assert.equal(await probeStream(bad), false)
  assert.equal(calls.filter(url => url === good).length, 1)
  assert.equal(calls.filter(url => url === bad).length, 1)
  const ac = new AbortController(), canceled = 'https://canceled.test/radio'
  const pending = probeStream(canceled, 2500, ac.signal)
  ac.abort()
  assert.equal(await pending, false)
  const retry = new AbortController()
  const again = probeStream(canceled, 2500, retry.signal)
  retry.abort()
  await again
  assert.equal(calls.filter(url => url === canceled).length, 2)
})

test('rapid station change aborts every in-flight probe and yields no stale result', async t => {
  const { calls, aborted } = network(t, () => forever)
  const ac = new AbortController()
  const batch = readyStations([station('old', ['https://cancel-a.test/radio', 'https://cancel-b.test/radio'])], ac.signal)
  const pending = batch.next()
  ac.abort()
  assert.equal((await pending).done, true)
  assert.equal(aborted.length, calls.length)
})

test('a URL that failed actual playback is excluded while its healthy alternate remains eligible', async t => {
  const bad = 'https://playback-failed.test/radio', good = 'https://alternate.test/radio'
  const st = station('same station', [bad, good])
  const { calls } = network(t, response)
  for await (const ready of readyStations([st], new AbortController().signal, new Set([bad]))) {
    assert.equal(ready.station, st, 'preserve station identity and full URL list')
    assert.equal(ready.url, good)
  }
  assert.deepEqual(calls, [good])
})

test('the mirror that actually played is saved first without changing the original station', t => {
  storage(t)
  const st = station('saved', ['https://first.test/radio', 'https://winner.test/radio'])
  rememberStation('mood', st, st.urls[1])
  assert.deepEqual(lastStation('mood').urls, [st.urls[1], st.urls[0]])
  assert.equal(st.urls[0], 'https://first.test/radio')
})

test('global and Chinese directory queries start together and losing mirrors are canceled', { timeout: 1000 }, async t => {
  storage(t)
  const { calls, aborted } = network(t, url => url.startsWith('https://de1.') ? new Response('[]', { headers: { 'content-type': 'application/json' } }) : forever)
  const directory = loadDirectory('mood', 'zh')
  // Chinese queries must be dispatched before the global queries have completed.
  assert.ok(calls.some(url => url.includes('language=chinese')))
  assert.equal(calls.length, 20)
  assert.deepEqual(await directory, [])
  assert.ok(aborted.some(url => url.startsWith('https://de2.')))
})

test('probe timeouts are bounded and unhealthy cache entries expire before healthy ones', async t => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  let unhealthy = true
  const { calls } = network(t, () => unhealthy ? forever : response())
  const url = 'https://timeout-and-recover.test/radio'
  assert.equal(await probeStream(url, 10), false)
  unhealthy = false
  assert.equal(await probeStream(url, 10), false)
  assert.equal(calls.length, 1, 'reuse short-lived failure cache')
  now += 30_001
  assert.equal(await probeStream(url, 10), true)
  now += 30_001
  assert.equal(await probeStream(url, 10), true)
  assert.equal(calls.length, 2, 'healthy probes survive the short failure-cache interval')
  now += 5 * 60_000
  assert.equal(await probeStream(url, 10), true)
  assert.equal(calls.length, 3, 'revalidate old healthy probes')
})
