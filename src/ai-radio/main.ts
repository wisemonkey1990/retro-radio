import { createApp, watch } from 'vue'
import App from './App.vue'
import { debug, pause, state } from './engine'
import { appUpdate, observePwaUpdates } from './pwaUpdates'
import './style.css'

createApp(App).mount('#app')

// `?debug` exposes the engine for poking at it from the console
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __radio: typeof debug }).__radio = debug

// Keep the PWA fresh without interrupting an active broadcast.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const updates = observePwaUpdates({
    serviceWorker: navigator.serviceWorker,
    scope: import.meta.env.BASE_URL,
    isPlaying: () => state.playing,
    reload: () => location.reload(),
    notify: () => { appUpdate.available = true },
  })
  appUpdate.apply = () => { pause(); updates.apply() }
  watch(() => state.playing, () => updates.whenPaused())
  let lastCheck = 0
  const check = () => {
    if (document.hidden || !navigator.onLine || Date.now() - lastCheck < 30_000) return
    lastCheck = Date.now()
    void updates.check()
  }
  window.addEventListener('focus', check)
  window.addEventListener('online', check)
  document.addEventListener('visibilitychange', check)
  window.setInterval(check, 60_000)
}
