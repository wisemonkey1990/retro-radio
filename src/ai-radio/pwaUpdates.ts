import { reactive } from 'vue'

export const appUpdate = reactive({ available: false, apply: () => {} })

interface UpdateOptions {
  serviceWorker: ServiceWorkerContainer
  scope: string
  isPlaying: () => boolean
  reload: () => void
  notify: () => void
}

/** A newly activated worker replaces cached files, but does not replace a page's loaded Vue bundle. */
export function observePwaUpdates({ serviceWorker, scope, isPlaying, reload, notify }: UpdateOptions) {
  let hadController = !!serviceWorker.controller
  let pending = false
  let reloading = false
  let registration: ServiceWorkerRegistration | undefined
  const apply = () => {
    if (!pending || reloading) return
    reloading = true
    reload()
  }
  const whenPaused = () => { if (pending && !isPlaying()) apply() }
  serviceWorker.addEventListener('controllerchange', () => {
    if (!serviceWorker.controller) return
    if (!hadController) { hadController = true; return } // first install needs no reload
    pending = true
    notify()
    whenPaused()
  })
  const check = async () => {
    if (!registration) return
    try { await registration.update() } catch { /* remain usable offline */ }
  }
  const ready = serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: 'none' })
    .then(async value => { registration = value; await check() })
    .catch(() => { /* unsupported/private browsing or offline: keep the app usable */ })
  return { ready, check, apply, whenPaused }
}
