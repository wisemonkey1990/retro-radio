<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SettingsSheet from './components/SettingsSheet.vue'
import BottomSheet from './components/BottomSheet.vue'
import TuningWindow from './components/TuningWindow.vue'
import { MODES, PRESETS, SLEEP_STEPS, dialText } from './data'
import { appUpdate } from './pwaUpdates'
import { nextStation, setFrequency, setSleep, state, togglePlay, tune } from './engine'
const settings = ref(false)
const sleep = ref(false)
const initialSection = ref<'general' | 'sound'>('general')
const current = computed(() => PRESETS.find(p => p.id === state.preset) ?? PRESETS[0])
const mode = computed(() => MODES.find(m => m.id === state.mode) ?? MODES[1])
const dial = computed(() => dialText(state.freq, state.mode))
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const status = computed(() => {
  if (!state.playing) return '准备就绪，按下播放开始收听'
  if (state.tuning) return state.note.startsWith('正在换台') ? '正在换台 · 继续收听当前电台' : '正在连接电台…'
  if (state.note.startsWith('新电台暂时连不上')) return '换台未成功 · 继续收听当前电台'
  if (state.source === 'house') return '正在播放 · 内置乐队'
  if (state.source === 'static') return '未锁定频道 · 电波沙沙声'
  return '正在播放'
})
const station = computed(() => state.source === 'local' ? '本地音乐' : state.station || (state.source === 'house' ? '内置乐队' : state.locked ? current.value.tagline : '左右滑动，寻找一个频道'))
const canSwap = computed(() => state.playing && !state.tuning && state.locked && state.source !== 'local' && state.source !== 'static')
function openSettings(section: 'general' | 'sound') { initialSection.value = section; settings.value = true }
function onKey(e: KeyboardEvent) {
  if (settings.value || sleep.value || e.repeat) return
  if (e.code === 'Space' && !(e.target as HTMLElement).closest('button, input, summary, [role="slider"], [contenteditable]')) { e.preventDefault(); void togglePlay() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>
<template>
  <main class="radio" :class="{ on: state.playing }" :inert="settings || sleep">
    <header class="top">
      <div class="brand"><h1>复古电台</h1><span>RETRO RADIO</span></div>
      <button class="gear" aria-label="设置" @click="openSettings('general')"><svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-2 3 1 3-3-1-3 2-2-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3.5"/></svg></button>
    </header>
    <div v-if="appUpdate.available" class="update-notice" role="status"><span>新版本已就绪</span><button @click="appUpdate.apply()">暂停并更新</button></div>
    <section class="readout" aria-label="当前频道">
      <span class="band">{{ dial.band }}</span>
      <div class="frequency"><span>{{ dial.value }}</span><small>{{ dial.unit }}</small></div>
      <h2>{{ state.source === 'local' ? '自带唱片' : state.locked ? current.name : '无信号' }}</h2>
      <p class="station">{{ station }}</p>
      <p class="play-status" role="status" :class="{ busy: state.tuning }"><i class="led" :class="{ dim: !state.playing }" />{{ status }}</p>
    </section>
    <TuningWindow :model-value="state.freq" :mode="state.mode" :tuning="state.tuning" @update:model-value="setFrequency" />
    <section class="channels" aria-labelledby="channels-heading">
      <h2 id="channels-heading" class="section-title">场景频道</h2>
      <div class="presets"><button v-for="p in PRESETS" :key="p.id" class="preset" :class="{ active: state.locked && p.id === state.preset }" :aria-pressed="state.locked && p.id === state.preset" @click="tune(p.id)"><i v-if="state.locked && p.id === state.preset" class="led" />{{ p.name }}</button></div>
    </section>
    <div class="shortcuts">
      <button @click="openSettings('sound')"><span aria-hidden="true">≋</span>音色 · {{ mode.label }}<span class="chevron" aria-hidden="true">›</span></button>
      <button @click="sleep = true"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>定时 · {{ state.sleepMin ? `${state.sleepMin}分` : '关闭' }}<span class="chevron" aria-hidden="true">›</span></button>
    </div>
    <footer class="playback">
      <div class="elapsed playback-control" role="timer" aria-label="已播放时间"><time>{{ mmss(state.elapsed) }}</time></div>
      <button class="play-button playback-control" :aria-label="state.playing ? '暂停' : '播放'" :aria-pressed="state.playing" @click="togglePlay()"><svg viewBox="0 0 32 32" width="32" height="32" fill="currentColor" aria-hidden="true"><template v-if="state.playing"><rect x="8" y="6" width="5" height="20" rx="1"/><rect x="19" y="6" width="5" height="20" rx="1"/></template><path v-else d="M11 5 27 16 11 27Z"/></svg></button>
      <button class="swap playback-control" aria-label="换台" :disabled="!canSwap" @click="nextStation()"><svg aria-hidden="true" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.4 5.7"/></svg></button>
      <small v-if="state.sleepMin" class="sleep-countdown">{{ mmss(state.sleepLeft) }} 后暂停</small>
    </footer>
  </main>
  <SettingsSheet v-if="settings" :initial-section="initialSection" @close="settings = false" />
  <BottomSheet v-if="sleep" title="定时暂停" @close="sleep = false">
    <p class="hint">选一个时间，让音乐陪你慢慢入睡。</p>
    <div class="sleep-options" role="group" aria-label="定时时长"><button v-for="minutes in SLEEP_STEPS" :key="minutes" :class="{ selected: state.sleepMin === minutes }" :aria-pressed="state.sleepMin === minutes" @click="setSleep(minutes)">{{ minutes ? `${minutes} 分钟` : '关闭' }}</button></div>
    <p class="hint" role="status">{{ state.sleepMin ? `剩余 ${mmss(state.sleepLeft)}，到点自动暂停。` : '持续收听，不自动暂停。' }}</p>
  </BottomSheet>
</template>
