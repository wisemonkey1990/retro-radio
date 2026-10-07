// Radio engine: owns the AudioContext, the radio chain, the stream / house-band / local
// sources, sleep timer, and the reactive state the UI renders.

import { reactive, watch } from 'vue'
import { connectWithBackup } from './connectionRace'
import { DEFAULT_FX, createAmRadio, type AmRadio, type RadioFx, type RadioMode } from './audio/amRadio'
import { startGenerative, type Generative } from './audio/generative'
import { FREQ_MAX, FREQ_MIN, LOCK_WINDOW, PRESETS, SLEEP_STEPS, THEMES, type Lang, type PresetId, type Theme } from './data'
import { curatedFor, lastStation, loadDirectory, readyStations, rememberStation, type Station } from './stations'

const STORE_KEY = 'ai-radio:v1'
const STREAM_TIMEOUT_MS = 4500
const CONNECT_BUDGET_MS = 20_000
const CURATED_BUDGET_MS = 6000
const PROBE_BATCH = 4
const STALL_TIMEOUT_MS = 12000
const MAX_ATTEMPTS = 10

interface Saved {
  preset: PresetId
  freq: number
  mode: RadioMode
  lang: Lang
  mains: 50 | 60
  fx: RadioFx
  theme: Theme
}

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

const saved = load()

function initialFreq() {
  const preset = PRESETS.find((p) => p.id === saved.preset) ?? PRESETS[0]
  const f = saved.freq
  if (typeof f !== 'number' || f < FREQ_MIN || f > FREQ_MAX) return preset.freq
  // channels were re-spaced when the eighth was added: a saved dial position that isn't on any channel
  // any more starts on the saved channel instead of between stations
  return PRESETS.some((p) => Math.abs(p.freq - f) <= LOCK_WINDOW) ? Math.round(f * 10) / 10 : preset.freq
}

export const state = reactive({
  preset: (PRESETS.some((p) => p.id === saved.preset) ? saved.preset : 'mood') as PresetId,
  freq: initialFreq(),
  locked: false,
  mode: (['clean', 'mw', 'tube'].includes(saved.mode as string) ? saved.mode : 'mw') as RadioMode,
  lang: (saved.lang === 'en' ? 'en' : 'zh') as Lang,
  mains: (saved.mains === 60 ? 60 : 50) as 50 | 60,
  /** adjustable character of the radio, see RadioFx */
  fx: { ...DEFAULT_FX, ...saved.fx } as RadioFx,
  theme: (THEMES.some((t) => t.id === saved.theme) ? saved.theme : 'dark') as Theme,

  playing: false,
  /** true from tuning until the first sound of the new station arrives */
  tuning: false,
  /** 'static' = the dial is between stations: only radio noise */
  source: '' as '' | 'stream' | 'house' | 'local' | 'static',
  /** name of the station currently on the air (stream source) */
  station: '',
  note: '',
  /** 1..5 bars */
  signal: 5,
  elapsed: 0,
  sleepMin: 0,
  sleepLeft: 0,
  /** recent audio events, shown in Settings → 诊断信息 to help debug device-specific problems */
  log: [] as string[],
})

{
  const hit = PRESETS.find((p) => Math.abs(p.freq - state.freq) <= LOCK_WINDOW)
  if (hit) {
    state.freq = hit.freq
    state.preset = hit.id
    state.locked = true
  }
}

watch(
  () => [state.preset, state.freq, state.mode, state.lang, state.mains, state.fx, state.theme],
  () => {
    const out: Saved = {
      preset: state.preset,
      freq: state.freq,
      mode: state.mode,
      lang: state.lang,
      mains: state.mains,
      fx: state.fx,
      theme: state.theme,
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out))
    } catch {
      /* storage unavailable */
    }
  },
  { deep: true },
)

// ------------------------------------------------------------------ theme
/** Apply the theme before the first paint (this module is imported before the app mounts). */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES.find((t) => t.id === theme)?.color ?? '#1b1b1b')
}
applyTheme(state.theme)
watch(() => state.theme, applyTheme)

export function setTheme(theme: Theme) {
  state.theme = theme
}

// ------------------------------------------------------------------ audio graph (lazy: needs a user gesture)
let ctx: AudioContext | null = null
let radio: AmRadio | null = null
let musicGain: GainNode
let analyser: AnalyserNode
let audioEl: HTMLAudioElement
interface AudioDeck { element: HTMLAudioElement; gain: GainNode; owner: number; station?: Station; preset?: PresetId }
const decks: AudioDeck[] = []
let keepAlive: HTMLAudioElement
let house: Generative | null = null
let streamToken = 0
let streamController: AbortController | null = null
let localQueue: File[] = []
let localIndex = 0

/**
 * A second, inaudible <audio> element that is NOT routed through Web Audio. Android browsers give
 * background priority (a media notification, a foreground service) to pages that are visibly playing
 * media, and an element whose sound goes into an AudioContext doesn't count. Its content is a
 * 1-LSB dither, effectively silence but not digital zero, so it isn't treated as muted.
 */
function createKeepAlive() {
  const rate = 8000
  const samples = rate * 2
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, Math.random() < 0.5 ? -1 : 1, true)
  const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })))
  el.loop = true
  // Not treated as a stop request: browsers also pause media in the background, which must not end the
  // broadcast. The notification's pause/stop buttons arrive through the Media Session handlers instead.
  el.addEventListener('pause', () => log('keep-alive paused'))
  return el
}

/**
 * Page lifecycle and network events, logged for the diagnostics. With the screen locked, Android may
 * freeze the page or cut the network; seeing which of these happened (and when) tells us what to fix.
 */
function watchLifecycle() {
  document.addEventListener('freeze', () => log('页面被系统冻结 (freeze)'))
  document.addEventListener('resume', () => log('页面解冻 (resume)'))
  window.addEventListener('pagehide', () => log('pagehide'))
  window.addEventListener('pageshow', () => log('pageshow'))
  window.addEventListener('online', () => log('网络恢复 (online)'))
  window.addEventListener('offline', () => log('网络断开 (offline)'))
  const conn = (navigator as unknown as { connection?: EventTarget & { effectiveType?: string; type?: string } }).connection
  conn?.addEventListener('change', () => log(`网络类型变化 ${conn.type ?? ''} ${conn.effectiveType ?? ''}`))
}

function ensureAudio() {
  if (ctx) return ctx
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new AC({ latencyHint: 'playback' })
  // Safari 16.4+: treat this page as media playback, so audio keeps going in the background / with the screen
  // locked and ignores the silent switch (the default session type "auto" lets the system stop Web Audio)
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'playback'
  radio = createAmRadio(ctx, { mode: state.mode, mainsHz: state.mains, fx: { ...state.fx } })
  radio.setEco(document.hidden)

  musicGain = ctx.createGain()
  musicGain.connect(radio.input)

  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  radio.output.connect(analyser)
  analyser.connect(ctx.destination)

  // Keep one audible deck and two silent connection lanes. All elements are unlocked together
  // inside the initial user gesture so Safari can also start the backup after an async lookup.
  for (let i = 0; i < 3; i++) {
    const element = new Audio()
    element.crossOrigin = 'anonymous'
    element.preload = 'none'
    const gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(element).connect(gain)
    gain.connect(musicGain)
    decks.push({ element, gain, owner: 0 })
    for (const type of ['playing', 'pause', 'waiting', 'stalled', 'error', 'ended', 'emptied']) {
      element.addEventListener(type, () => {
        if (element !== audioEl) return
        const code = type === 'error' ? ` code=${element.error?.code}` : ''
        log(`stream ${type}${code} t=${element.currentTime.toFixed(1)} ready=${element.readyState}`)
      })
    }
    element.addEventListener('playing', () => {
      // An old stream resuming during handover must not dismiss the new stream's loading state.
      if (element === audioEl && state.source === 'local') state.tuning = false
    })
    element.addEventListener('ended', () => {
      if (element === audioEl && state.source === 'local') nextLocal()
    })
  }
  audioEl = decks[0].element
  ctx.addEventListener('statechange', () => log(`audio context ${ctx?.state}`))
  keepAlive = createKeepAlive()
  document.addEventListener('visibilitychange', onVisibility)
  watchLifecycle()
  return ctx
}

function log(message: string) {
  const t = new Date().toTimeString().slice(0, 8)
  state.log.push(`${t} ${document.hidden ? '[后台] ' : ''}${message}`)
  if (state.log.length > 120) state.log.splice(0, state.log.length - 120)
}

const preset = () => PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]

// ------------------------------------------------------------------ sources
function clearDeck(deck: AudioDeck) {
  const el = deck.element
  deck.owner = 0
  deck.station = undefined
  deck.preset = undefined
  el.onerror = el.onended = el.onwaiting = el.onplaying = null
  deck.gain.gain.cancelScheduledValues(ctx!.currentTime)
  deck.gain.gain.setValueAtTime(0, ctx!.currentTime)
  el.pause()
  el.removeAttribute('src')
  el.load()
}

function activateDeck(deck: AudioDeck) {
  // Only the winner becomes audible; no double playback while two URLs race.
  audioEl = deck.element
  for (const other of decks) if (other !== deck) clearDeck(other)
  house?.stop()
  house = null
  deck.gain.gain.setValueAtTime(1, ctx!.currentTime)
}

function stopSources() {
  streamToken++
  streamController?.abort()
  streamController = null
  clearTimeout(stallTimer)
  decks.forEach(clearDeck)
  house?.stop()
  house = null
}

function startHouse(why = '') {
  if (!ctx) return
  house?.stop()
  house = startGenerative(ctx, musicGain, state.preset)
  state.source = 'house'
  state.station = ''
  state.tuning = false
  state.note = `${why ? why + '，' : ''}先由内置乐队演奏 · 点「换台」重试`
}

// Stations already tried (played or failed) per preset, so "next station" keeps moving through the pool.
const seen = new Map<PresetId, Set<string>>()
let stallTimer = 0

function playUrl(deck: AudioDeck, url: string, token: number, signal: AbortSignal): Promise<boolean> {
  if (token !== streamToken || signal.aborted) return Promise.resolve(false)
  const element = deck.element
  deck.owner = token
  return new Promise((resolve) => {
    let timer = 0
    let finished = false
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      element.removeEventListener('playing', onPlaying)
      element.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (!ok && deck.owner === token) clearDeck(deck)
      resolve(ok)
    }
    const onPlaying = () => finish(token === streamToken && !signal.aborted)
    const onError = () => finish(false)
    const onAbort = () => finish(false)
    if (token !== streamToken || signal.aborted) return finish(false)
    element.addEventListener('playing', onPlaying)
    element.addEventListener('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    timer = window.setTimeout(() => finish(false), STREAM_TIMEOUT_MS)
    element.src = url
    element.play().catch(() => finish(false))
  })
}

/** Keep the old station audible while two silent lanes race to produce playable audio. */
async function startStream(fresh = true) {
  streamController?.abort()
  const controller = new AbortController()
  streamController = controller
  const signal = controller.signal
  const token = ++streamToken
  const started = performance.now()
  const deadline = window.setTimeout(() => controller.abort(), CONNECT_BUDGET_MS)
  clearTimeout(stallTimer)
  audioEl.onerror = audioEl.onended = audioEl.onwaiting = audioEl.onplaying = null
  const previousDeck = decks.find(deck => deck.element === audioEl)!
  const hadStream = !!previousDeck.station && previousDeck.gain.gain.value > 0 && !audioEl.paused && audioEl.readyState >= 3
  const preset = state.preset
  const tried = seen.get(preset) ?? new Set<string>()
  seen.set(preset, tried)
  if (fresh) tried.clear()
  state.source = 'stream'
  if (!hadStream) state.station = ''
  state.note = hadStream ? '正在换台，连接期间继续收听…' : '正在连接电台…'
  const last = lastStation(preset)
  const stationKey = (station: Station) => [...station.urls].sort()[0]
  const candidates = (...lists: Station[][]) => {
    const unique = new Map<string, Station>()
    for (const station of lists.flat()) {
      const key = stationKey(station)
      if (!unique.has(key)) unique.set(key, station)
    }
    return [...unique.values()].filter(station => !tried.has(stationKey(station)))
  }
  const directoryPromise = loadDirectory(preset, state.lang)
  let attempts = 0
  type Candidate = { station: Station; url: string }
  const lanes = decks.filter(deck => deck.element !== audioEl)
  const race = async (list: AsyncIterable<Candidate> | Iterable<Candidate> | ((signal: AbortSignal) => AsyncIterable<Candidate>), phaseSignal: AbortSignal, attemptLimit = MAX_ATTEMPTS) => {
    const result = await connectWithBackup(list, async ({ station, url }, lane, attemptSignal) => {
      if (phaseSignal.aborted || token !== streamToken || attempts >= attemptLimit) return false
      attempts++
      tried.add(stationKey(station))
      return playUrl(lanes[lane], url, token, attemptSignal)
    }, phaseSignal)
    if (!result || signal.aborted || token !== streamToken) {
      if (token === streamToken) lanes.forEach(clearDeck)
      return false
    }
    const { station, url } = result.candidate
    const winner = lanes[result.lane]
    activateDeck(winner)
    winner.station = station
    winner.preset = preset
    state.station = station.name
    state.tuning = false
    state.note = station.country ? `${station.name} · ${station.country}` : station.name
    rememberStation(preset, station, url)
    log(`已连接 ${station.name} · ${Math.round(performance.now() - started)}ms · 尝试 ${attempts} 次 · 并行换台`)
    updateMediaSession(station.name)
    watchStream(token)
    return true
  }
  function* direct(list: Station[]): Generator<Candidate> {
    // Give the first station a backup on another host, then alternate stations before retrying mirrors.
    const first = list[0]
    if (first) for (const url of first.urls.slice(0, 2)) yield { station: first, url }
    for (let mirror = 0; mirror < 3; mirror++) {
      for (const station of list) {
        if (station === first && mirror < 2) continue
        const url = station.urls[mirror]
        if (url) yield { station, url }
      }
    }
  }
  async function* directoryCandidates(list: Station[], probeSignal: AbortSignal): AsyncGenerator<Candidate> {
    for (let i = 0; i < list.length && !probeSignal.aborted && token === streamToken && attempts < MAX_ATTEMPTS; i += PROBE_BATCH) {
      yield* readyStations(list.slice(i, i + PROBE_BATCH), probeSignal)
    }
  }
  try {
    const preferred = candidates(last ? [last] : [], curatedFor(preset, state.lang))
    const phase = new AbortController()
    const cancelPhase = () => phase.abort()
    signal.addEventListener('abort', cancelPhase, { once: true })
    const phaseTimer = window.setTimeout(cancelPhase, CURATED_BUDGET_MS)
    try {
      if (await race(direct(preferred), phase.signal, 6)) return
    } finally {
      clearTimeout(phaseTimer)
      phase.abort()
      signal.removeEventListener('abort', cancelPhase)
    }
    if (signal.aborted || token !== streamToken) return
    const directory = candidates(await directoryPromise)
    if (await race(probeSignal => directoryCandidates(directory, probeSignal), signal)) return
  } finally {
    clearTimeout(deadline)
    if (token === streamToken && state.tuning && state.playing) {
      tried.clear()
      lanes.forEach(clearDeck)
      if (hadStream && !audioEl.paused && !audioEl.ended) {
        state.source = 'stream'
        state.tuning = false
        if (previousDeck.preset) {
          state.preset = previousDeck.preset
          state.freq = PRESETS.find(p => p.id === previousDeck.preset)!.freq
          state.locked = true
          tunedPreset = previousDeck.preset
        }
        state.station = previousDeck.station!.name
        state.note = '新电台暂时连不上，继续收听当前电台 · 点「换台」重试'
        watchStream(token)
      } else {
        decks.forEach(clearDeck)
        startHouse(signal.aborted ? '连接超时' : '暂时没有可播放的电台')
      }
      log(`网络电台连接失败 · ${Math.round(performance.now() - started)}ms · 尝试 ${attempts} 次`)
    }
  }
}

/** Once a stream is playing: a dropped or stalled connection moves on to another station. */
function watchStream(token: number) {
  const next = () => {
    if (token === streamToken && state.playing && state.source === 'stream') {
      // a dropped connection: reconnect (the remembered, i.e. current, station is tried first)
      state.tuning = true
      void startStream(true)
    }
  }
  audioEl.onerror = next
  audioEl.onended = next
  audioEl.onwaiting = () => {
    clearTimeout(stallTimer)
    // In the background the browser is merely re-buffering (phones throttle the network); replacing the
    // element's source there can't be undone on iOS, so leave it to the heartbeat and the foreground check.
    if (document.hidden) return
    stallTimer = window.setTimeout(next, STALL_TIMEOUT_MS)
  }
  audioEl.onplaying = () => clearTimeout(stallTimer)
}

// ------------------------------------------------------------------ heartbeat
// While on air, every few seconds make sure the media element really is playing. The OS can pause it
// (audio focus, lock screen) without telling the page; resuming the same element is allowed where
// starting a new stream is not. A stream that is truly dead is reconnected, later when in the background.
const HEARTBEAT_MS = 4000
const DEAD_FOREGROUND_TICKS = 4
const DEAD_BACKGROUND_TICKS = 15
let heartbeat = 0
let deadTicks = 0
let lastTime = -1

let lastBeat = 0

function beat() {
  const now = Date.now()
  // a long gap between beats means timers were throttled or the page was frozen (screen locked)
  if (lastBeat && now - lastBeat > HEARTBEAT_MS * 2.5) log(`心跳间隔 ${Math.round((now - lastBeat) / 1000)} 秒：页面被限速或冻结`)
  lastBeat = now
  if (!state.playing || !ctx || state.tuning) return
  if (ctx.state !== 'running') void ctx.resume()
  if (keepAlive.paused) keepAlive.play().catch(() => undefined)
  if (state.source !== 'stream' && state.source !== 'local') return
  const stuck = audioEl.paused || audioEl.ended || (audioEl.currentTime === lastTime && audioEl.readyState < 4)
  lastTime = audioEl.currentTime
  if (!stuck) {
    deadTicks = 0
    return
  }
  deadTicks++
  if (audioEl.paused && audioEl.src) {
    log('心跳：播放被暂停，尝试恢复')
    audioEl.play().catch((e) => log(`心跳：恢复失败 ${e?.name}`))
  }
  const limit = document.hidden ? DEAD_BACKGROUND_TICKS : DEAD_FOREGROUND_TICKS
  if (deadTicks >= limit && state.source === 'stream') {
    log(`心跳：流已停止 ${deadTicks} 次检测，重新连接`)
    deadTicks = 0
    state.tuning = true
    void startStream(true)
  }
}

/**
 * Phones suspend or drop media while the page is in the background (and Safari won't start a new
 * stream from there). Coming back, make sure the audio is really playing, otherwise reconnect.
 */
function onVisibility() {
  log(document.hidden ? '页面进入后台' : '页面回到前台')
  if (!ctx) return
  radio?.setEco(document.hidden)
  if (!state.playing) return
  if (document.hidden) {
    return
  }
  void ctx.resume()
  if (state.source === 'local') {
    if (audioEl.paused) audioEl.play().catch(() => undefined)
    return
  }
  if (state.source === 'static') return
  const live = state.source === 'stream' && !audioEl.paused && !audioEl.ended && audioEl.readyState >= 3
  if (state.tuning || live) return
  // stalled stream, or the built-in band standing in while we were away: go back to a real station
  state.tuning = true
  stopSources()
  void startStream(true)
}

function nextLocal() {
  if (!localQueue.length) return
  localIndex = (localIndex + 1) % localQueue.length
  playLocalAt(localIndex)
}

function playLocalAt(i: number) {
  activateDeck(decks.find(deck => deck.element === audioEl)!)
  const f = localQueue[i]
  audioEl.src = URL.createObjectURL(f)
  audioEl.play().catch(() => undefined)
  state.source = 'local'
  state.note = `本地音乐 · ${f.name}`
}

// ------------------------------------------------------------------ clocks (elapsed, sleep, signal bars)
let onAirSince = 0
let sleepEnd = 0
let clock = 0

function tickClock() {
  const now = Date.now()
  state.elapsed = Math.floor((now - onAirSince) / 1000)
  if (sleepEnd) {
    state.sleepLeft = Math.max(0, Math.ceil((sleepEnd - now) / 1000))
    if (state.sleepLeft === 0) sleepNow()
  }
  const fade = radio && state.mode !== 'clean' ? radio.fadeNow() : 0
  state.signal = Math.max(1, 5 - Math.floor(fade * 4.5))
}

function sleepNow() {
  sleepEnd = 0
  state.sleepMin = 0
  state.sleepLeft = 0
  if (ctx) {
    musicGain.gain.cancelScheduledValues(ctx.currentTime)
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.8)
  }
  window.setTimeout(pause, 3000)
}

// ------------------------------------------------------------------ public API
/** Safari/iOS only lets an element start playing inside a user gesture; a silent clip played here
 *  "unlocks" it, so the real stream can be started later, after the async station search. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export async function play() {
  if (state.playing) return
  const c = ensureAudio()
  const resumed = c.resume()
  for (const deck of decks) {
    deck.element.src = SILENT_WAV
    deck.element.play().catch(() => undefined)
  }
  keepAlive.play().catch((e) => log(`keep-alive play failed: ${e?.name}`))
  await resumed
  if (state.playing) return
  state.playing = true
  state.tuning = true
  onAirSince = Date.now()
  state.elapsed = 0
  clearInterval(clock)
  clock = window.setInterval(tickClock, 250)
  clearInterval(heartbeat)
  deadTicks = 0
  lastBeat = 0
  heartbeat = window.setInterval(beat, HEARTBEAT_MS)
  musicGain.gain.cancelScheduledValues(c.currentTime)
  musicGain.gain.setValueAtTime(1, c.currentTime)
  startSource()
  updateMediaSession()
}

/** The preset whose station is on the air (or being connected). */
let tunedPreset: PresetId | '' = ''

function goStatic() {
  tunedPreset = ''
  state.source = 'static'
  state.station = ''
  state.tuning = false
  state.note = '电台之间只有电波噪声 · 转动旋钮对准一个频道'
}

function startSource() {
  if (!audioEl || audioEl.paused) radio?.tuneSweep()
  if (localQueue.length) return playLocalAt(localIndex)
  if (!state.locked) return goStatic()
  tunedPreset = state.preset
  void startStream()
}

export function pause() {
  if (!state.playing) return
  keepAlive?.pause()
  state.playing = false
  state.tuning = false
  state.source = ''
  clearInterval(clock)
  clearInterval(heartbeat)
  sleepEnd = 0
  state.sleepMin = 0
  state.sleepLeft = 0
  stopSources()
  state.note = ''
  if (ctx) {
    // keep the context alive a moment so the stop doesn't click, then park it
    const c = ctx
    window.setTimeout(() => {
      if (!state.playing) c.suspend()
    }, 300)
  }
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

export function togglePlay() {
  return state.playing ? pause() : play()
}

export async function tune(id: PresetId) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]
  const sameChannel = state.locked && id === state.preset
  state.preset = id
  state.freq = p.freq // the dial jumps to the channel
  state.locked = true
  clearTimeout(settleTimer)
  localQueue = []
  localIndex = 0
  if (!state.playing) return play()
  // Selecting the current channel keeps playback running; the player owns pause.
  if (sameChannel && state.source !== 'local' && state.source !== 'static') return
  state.tuning = true
  startSource()
}

/** Dial on to another station of the current preset. */
export function nextStation() {
  if (!state.playing || state.source === 'local' || state.source === 'static') return
  state.tuning = true
  void startStream(false)
}

let settleTimer = 0

/**
 * The tuning knob. The dial snaps to a channel when it gets close (a detent) and the station is
 * connected once the knob has rested for a moment; anywhere else there is only radio noise.
 */
export function setFrequency(raw: number) {
  let f = Math.round(Math.min(FREQ_MAX, Math.max(FREQ_MIN, raw)) * 10) / 10
  const hit = PRESETS.find((p) => Math.abs(p.freq - f) <= LOCK_WINDOW)
  if (hit) f = hit.freq
  if (f === state.freq && !!hit === state.locked) return
  if (hit && !state.locked) navigator.vibrate?.(8) // a small click when a channel catches
  state.freq = f
  state.locked = !!hit
  if (hit) state.preset = hit.id
  clearTimeout(settleTimer)
  settleTimer = window.setTimeout(settle, 350)
}

function settle() {
  if (!state.playing) return
  if (state.locked) {
    if (tunedPreset === state.preset && (state.source === 'stream' || state.source === 'house')) return
    localQueue = []
    localIndex = 0
    state.tuning = true
    startSource()
  } else if (state.source !== 'local' && state.source !== 'static') {
    stopSources()
    radio?.tuneSweep()
    goStatic()
  }
}

export function setMode(mode: RadioMode) {
  if (mode === state.mode) return
  state.mode = mode
  radio?.setMode(mode)
  if (state.playing && mode !== 'clean') radio?.tuneSweep()
}

export function setLang(lang: Lang) {
  state.lang = lang
}

export function setSleep(minutes: number) {
  state.sleepMin = SLEEP_STEPS.includes(minutes) ? minutes : 0
  sleepEnd = minutes > 0 ? Date.now() + minutes * 60_000 : 0
  state.sleepLeft = minutes * 60
}

export function setMains(hz: 50 | 60) {
  state.mains = hz
  radio?.setMains(hz)
}

export function setFx(key: keyof RadioFx, value: number) {
  state.fx[key] = value
  radio?.setFx({ [key]: value })
}

export function resetFx() {
  state.fx = { ...DEFAULT_FX }
  radio?.setFx({ ...DEFAULT_FX })
}

export async function playLocalFiles(files: File[]) {
  const list = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name))
  if (!list.length) return
  localQueue = list
  localIndex = 0
  if (state.playing) {
    stopSources()
    state.tuning = true
    startSource()
  } else {
    await play()
  }
}

export function getOutputLevel() {
  if (!analyser) return 0
  const buf = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buf)
  let s = 0
  for (const v of buf) s += v * v
  return Math.sqrt(s / buf.length)
}

export const debug = {
  state,
  get ctx() {
    return ctx
  },
  get audio() {
    return audioEl
  },
  level: getOutputLevel,
}

function updateMediaSession(station = '') {
  if (!('mediaSession' in navigator)) return
  const p = preset()
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station || `${p.name} · FM ${p.freq.toFixed(1)}`,
    artist: station ? `${p.name} · AI 电台` : 'AI 电台',
    album: 'AI Radio',
    artwork: ['192x192', '512x512'].map((size) => ({ src: new URL(`${import.meta.env.BASE_URL}icon-${size}.png`, location.href).href, sizes: size, type: 'image/png' })),
  })
  navigator.mediaSession.playbackState = 'playing'
  navigator.mediaSession.setActionHandler('play', () => void play())
  navigator.mediaSession.setActionHandler('pause', () => pause())
  navigator.mediaSession.setActionHandler('stop', () => pause())
}

/** Environment + recent events as plain text, for the diagnostics section of the settings sheet. */
export function diagnostics(): string {
  const nav = navigator as unknown as { audioSession?: { type: string } }
  const lines = [
    `UA: ${navigator.userAgent}`,
    `安全上下文: ${window.isSecureContext}  可见性: ${document.visibilityState}`,
    `AudioContext: ${ctx ? `${ctx.state} ${ctx.sampleRate}Hz` : '未创建'}  audioSession: ${nav.audioSession ? nav.audioSession.type : '不支持'}`,
    `mediaSession: ${'mediaSession' in navigator}`,
    `网络: ${navigator.onLine ? 'online' : 'offline'} ${(navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection?.type ?? ''} ${(navigator as unknown as { connection?: { effectiveType?: string } }).connection?.effectiveType ?? ''}`,
    `来源: ${state.source || '-'}  电台: ${state.station || '-'}  播放中: ${state.playing}`,
    '--- 最近事件 ---',
    ...state.log,
  ]
  return lines.join('\n')
}
