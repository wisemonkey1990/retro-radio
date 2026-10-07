import test from 'node:test'
import assert from 'node:assert/strict'
import { observePwaUpdates } from '../src/ai-radio/pwaUpdates.ts'
function client(controlled, playing = false) {
  const sw = new EventTarget()
  sw.controller = controlled ? {} : null
  let checks = 0, reloads = 0, notifications = 0, options
  sw.register = async (url, config) => {
    options = { url, ...config }
    return { update: async () => { checks++ } }
  }
  const updates = observePwaUpdates({serviceWorker:sw,scope:'/retro-radio/',isPlaying:()=>playing,reload:()=>reloads++,notify:()=>notifications++})
  return { sw, updates, stats:()=>({checks,reloads,notifications,options}), pause:()=>playing=false }
}
test('first PWA install does not reload or create a reload loop', async () => {
  const c = client(false)
  await c.updates.ready
  c.sw.controller = {}
  c.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(c.stats().reloads,0)
  assert.equal(c.stats().notifications,0)
  assert.deepEqual(c.stats().options,{url:'/retro-radio/sw.js',scope:'/retro-radio/',updateViaCache:'none'})
  assert.equal(c.stats().checks,1)
})
test('a new worker refreshes an idle old UI only once', async () => {
  const c = client(true)
  await c.updates.ready
  c.sw.dispatchEvent(new Event('controllerchange'))
  c.sw.dispatchEvent(new Event('controllerchange'))
  c.updates.whenPaused()
  assert.equal(c.stats().reloads,1)
})
test('a new worker preserves playback and refreshes when the listener pauses', async () => {
  const c = client(true,true)
  await c.updates.ready
  c.sw.dispatchEvent(new Event('controllerchange'))
  assert.equal(c.stats().notifications,1)
  assert.equal(c.stats().reloads,0)
  c.pause()
  c.updates.whenPaused()
  assert.equal(c.stats().reloads,1)
})
test('explicit update refreshes once, while offline update checks do not break the app', async () => {
  const c = client(true,true)
  await c.updates.ready
  c.sw.dispatchEvent(new Event('controllerchange'))
  c.updates.apply()
  c.updates.apply()
  assert.equal(c.stats().reloads,1)
  const sw = new EventTarget()
  sw.controller = null
  sw.register = async () => { throw new Error('offline') }
  const offline = observePwaUpdates({serviceWorker:sw,scope:'/',isPlaying:()=>false,reload:()=>assert.fail('offline reload'),notify:()=>{}})
  await offline.ready
  await offline.check()
})
