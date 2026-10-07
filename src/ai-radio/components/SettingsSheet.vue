<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { LANGS, MODES, THEMES } from '../data'
import type { RadioFx } from '../audio/amRadio'
import BottomSheet from './BottomSheet.vue'
import FxPanel from './FxPanel.vue'
import { diagnostics, playLocalFiles, resetFx, setFx, setLang, setMains, setMode, setTheme, state } from '../engine'
const props = defineProps<{ initialSection?: 'general' | 'sound' }>()
const emit = defineEmits<{ close: [] }>()
const files = ref<HTMLInputElement>()
const soundSection = ref<HTMLElement>()
const changed = computed(() => Object.values(state.fx).some(v => v !== 0.5))
const description = computed(() => state.mode === 'clean' ? '保留原本的声音，音效调节在其他模式下生效。' : state.mode === 'mw' ? '温暖的窄频声音，带一点电波底噪。' : '温润的电子管音色，带一点失真与哼声。')
const sliders: Array<{ key: keyof RadioFx; label: string; hint: string }> = [
  { key: 'box', label: '温暖', hint: '调节小喇叭与机箱的共鸣' },
  { key: 'hiss', label: '底噪', hint: '调节电波的沙沙声' },
  { key: 'drive', label: '失真', hint: '调节谐波失真与过载' },
]
async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  if (list.length) { emit('close'); await playLocalFiles(list) }
}
const diag = ref('')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
function openDiag(e: Event) { if ((e.target as HTMLDetailsElement).open) diag.value = diagnostics() }
async function copyDiag() {
  diag.value = diagnostics()
  try { await navigator.clipboard.writeText(diag.value); copied.value = true; clearTimeout(copiedTimer); copiedTimer = setTimeout(() => copied.value = false, 1500) } catch { copied.value = false }
}
onBeforeUnmount(() => clearTimeout(copiedTimer))
onMounted(() => { if (props.initialSection === 'sound') soundSection.value?.scrollIntoView({ block: 'start' }) })
</script>
<template>
  <BottomSheet title="设置" @close="emit('close')">
    <h3 class="section-title">常用设置</h3>
    <div class="settings-card general-card">
      <div class="setting-row theme-row"><span>外观主题</span><div class="theme-options"><button v-for="t in THEMES" :key="t.id" :aria-pressed="state.theme === t.id" @click="setTheme(t.id)"><span class="theme-swatch" :class="[t.id, { selected: state.theme === t.id }]"><i v-if="state.theme === t.id" class="led" /></span><small>{{ t.label }}</small></button></div></div>
      <div class="setting-row language-row"><div><span>电台语言</span><small>优先收听的音源语言</small></div><div class="seg"><button v-for="l in LANGS" :key="l.id" :class="{ on: state.lang === l.id }" :aria-pressed="state.lang === l.id" @click="setLang(l.id)">{{ l.label }}</button></div></div>
    </div>
    <section ref="soundSection" class="sound-section">
      <div class="section-heading"><h3 class="section-title">音效调节</h3><button class="reset-button" :disabled="!changed" @click="resetFx()">↻ 重置</button></div>
      <div class="settings-card sound-card">
        <div class="seg mode-seg"><button v-for="m in MODES" :key="m.id" :class="{ on: state.mode === m.id }" :aria-pressed="state.mode === m.id" @click="setMode(m.id)">{{ m.label }}</button></div>
        <p class="hint mode-hint">{{ description }}</p>
        <div class="sound-sliders"><div v-for="f in sliders" :key="f.key" class="sound-slider"><label :for="`sound-${f.key}`" :title="f.hint">{{ f.label }}</label><input :id="`sound-${f.key}`" type="range" min="0" max="100" step="1" :value="Math.round(state.fx[f.key] * 100)" :disabled="state.mode === 'clean'" :aria-description="f.hint" :style="{ '--fill': `${state.fx[f.key] * 100}%` }" @input="setFx(f.key, Number(($event.target as HTMLInputElement).value) / 100)"/><output :for="`sound-${f.key}`">{{ Math.round(state.fx[f.key] * 100) }}%</output></div></div>
      </div>
      <details class="advanced-fx settings-card"><summary>更多音效<span class="chevron">›</span></summary><FxPanel /></details>
    </section>
    <h3 class="section-title">本地音乐</h3>
    <button class="settings-card local-button" @click="files?.click()"><span aria-hidden="true">♫</span>选择本地音频</button>
    <input ref="files" type="file" accept="audio/*" multiple hidden @change="pick" />
    <p class="hint local-hint">用自己的音乐试听收音机音色</p>
    <h3 class="section-title">高级设置</h3>
    <div class="settings-card advanced-card">
      <details><summary>市电频率<span class="summary-value">{{ state.mains }} Hz</span><span class="chevron">›</span></summary><div class="detail-content"><p class="hint">交流哼声的基频</p><div class="seg"><button v-for="hz in ([50, 60] as const)" :key="hz" :class="{ on: state.mains === hz }" :aria-pressed="state.mains === hz" @click="setMains(hz)">{{ hz }} Hz</button></div></div></details>
      <details class="diag" @toggle="openDiag"><summary>诊断信息<span class="chevron">›</span></summary><div class="detail-content"><p class="hint">播放遇到问题时，可复制以下信息反馈。</p><pre>{{ diag }}</pre><button class="wide" @click="copyDiag">{{ copied ? '已复制' : '刷新并复制' }}</button></div></details>
    </div>
    <p class="credit">音源：<a href="https://somafm.com" target="_blank" rel="noopener">SomaFM</a> · <a href="https://www.radio-browser.info" target="_blank" rel="noopener">Radio Browser</a></p>
  </BottomSheet>
</template>
