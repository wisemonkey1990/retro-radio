import test from 'node:test'
import assert from 'node:assert/strict'
import { connectWithBackup } from '../src/ai-radio/connectionRace.ts'

function blocked(signal, aborted, candidate) {
  return new Promise(resolve => signal.addEventListener('abort', () => { aborted.push(candidate); resolve(false) }, { once: true }))
}

test('backup connects before a hanging preferred URL times out, then aborts the loser', { timeout: 1000 }, async () => {
  const attempted = [], aborted = []
  const result = await connectWithBackup(['slow', 'fast'], (candidate, lane, signal) => {
    attempted.push({ candidate, lane })
    return candidate === 'slow' ? blocked(signal, aborted, candidate) : Promise.resolve(true)
  }, new AbortController().signal, 10)
  assert.equal(result.candidate, 'fast')
  assert.deepEqual(attempted.map(x => x.lane), [0, 1])
  assert.deepEqual(aborted, ['slow'])
})

test('a fast preferred URL cancels the backup timer without opening another stream', async () => {
  const attempted = []
  const result = await connectWithBackup(['preferred', 'unused'], async candidate => { attempted.push(candidate); return true }, new AbortController().signal)
  assert.equal(result.candidate, 'preferred')
  assert.deepEqual(attempted, ['preferred'])
})

test('failed URLs advance immediately and no more than two playback attempts are active', async () => {
  let active = 0, peak = 0
  const result = await connectWithBackup(['bad', 'slow', 'good'], async (candidate, _lane, signal) => {
    active++; peak = Math.max(peak, active)
    try {
      if (candidate === 'bad') return false
      if (candidate === 'good') return true
      return await blocked(signal, [], candidate)
    } finally { active-- }
  }, new AbortController().signal, 10)
  assert.equal(result.candidate, 'good')
  assert.equal(peak, 2)
  assert.equal(active, 0)
})

test('canceling a switch stops both pending connections and never returns a stale winner', async () => {
  const ac = new AbortController(), aborted = []
  let opened = 0, bothOpen
  const ready = new Promise(resolve => bothOpen = resolve)
  const pending = connectWithBackup(['a', 'b'], (candidate, _lane, signal) => {
    if (++opened === 2) bothOpen()
    return blocked(signal, aborted, candidate)
  }, ac.signal, 1)
  await ready
  ac.abort()
  assert.equal(await pending, undefined)
  assert.deepEqual(aborted.sort(), ['a', 'b'])
})

test('a fully failed pool terminates without throwing or leaving attempts active', async () => {
  assert.equal(await connectWithBackup(['bad-a', 'bad-b'], async () => false, new AbortController().signal, 1), undefined)
})

test('winning playback cancels pending directory discovery through the candidate source signal', async () => {
  let probing = false, canceled = false
  const source = async function* (signal) {
    yield 'ready'
    probing = true
    await new Promise(resolve => signal.addEventListener('abort', () => { canceled = true; resolve() }, { once: true }))
  }
  const result = await connectWithBackup(source, async () => {
    await new Promise(resolve => setTimeout(resolve, 15))
    return true
  }, new AbortController().signal, 1)
  assert.equal(result.candidate, 'ready')
  assert.equal(probing, true)
  assert.equal(canceled, true)
})
