<script setup lang="ts">
import { computed, ref } from 'vue'
import { FREQ_MAX, FREQ_MIN, LOCK_WINDOW, PRESETS, dialText } from '../data'
import type { RadioMode } from '../audio/amRadio'

const props = defineProps<{ modelValue: number; mode: RadioMode; tuning: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [freq: number] }>()
const glass = ref<HTMLElement>()
// A wider ruler moves behind a fixed centre needle rather than compressing the entire band.
const STEP = 44
const xOf = (freq: number) => (freq - FREQ_MIN) * STEP
const offset = computed(() => 180 - xOf(props.modelValue))
const dragging = ref(false)
let startX = 0
let startFreq = 0
let pixelsPerMHz = 1
let moved = false
const dial = computed(() => dialText(props.modelValue, props.mode))
const readout = computed(() => `${dial.value.band} ${dial.value.value} ${dial.value.unit}`)
const ticks = Array.from({ length: 83 }, (_, i) => {
  const freq = FREQ_MIN + i * .25
  return { x: xOf(freq), major: Number.isInteger(freq) }
})
const labels = computed(() => Array.from({ length: 11 }, (_, i) => 88 + i * 2).map(freq => ({
  x: xOf(freq), value: dialText(freq, props.mode).value,
})))
function down(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0) return
  glass.value!.setPointerCapture(e.pointerId)
  startX = e.clientX
  startFreq = props.modelValue
  pixelsPerMHz = glass.value!.getBoundingClientRect().width / 360 * STEP
  moved = false
  dragging.value = true
}
function move(e: PointerEvent) {
  if (!glass.value!.hasPointerCapture(e.pointerId)) return
  if (Math.abs(e.clientX - startX) > 4) moved = true
  if (moved) emit('update:modelValue', startFreq - (e.clientX - startX) / pixelsPerMHz)
}
function release(e: PointerEvent) {
  if (!glass.value!.hasPointerCapture(e.pointerId)) return
  if (e.type === 'pointerup' && !moved) {
    const rect = glass.value!.getBoundingClientRect()
    emit('update:modelValue', props.modelValue + (e.clientX - rect.left - rect.width / 2) / pixelsPerMHz)
  }
  glass.value!.releasePointerCapture(e.pointerId)
  dragging.value = false
}
function nudge(delta: number) {
  let freq = props.modelValue + delta
  const preset = PRESETS.find(p => Math.abs(p.freq - props.modelValue) < .05)
  if (preset && Math.abs(freq - preset.freq) <= LOCK_WINDOW) freq = preset.freq + Math.sign(delta) * (LOCK_WINDOW + .1)
  emit('update:modelValue', freq)
}
function wheel(e: WheelEvent) {
  const delta = e.deltaY || e.deltaX
  if (delta) nudge(delta < 0 ? .1 : -.1)
}
</script>

<template>
  <section class="tuning-window" aria-label="调频窗口">
    <div class="tuning-frame">
      <div ref="glass" class="tuning-glass" :class="{ dragging }" tabindex="0" role="slider" aria-label="调频" aria-orientation="horizontal"
        :aria-valuemin="FREQ_MIN" :aria-valuemax="FREQ_MAX" :aria-valuenow="modelValue" :aria-valuetext="readout"
        @pointerdown="down" @pointermove="move" @pointerup="release" @pointercancel="release" @lostpointercapture="dragging = false" @wheel.prevent="wheel"
        @keydown.left.prevent="nudge(-.1)" @keydown.right.prevent="nudge(.1)"
        @keydown.down.prevent="nudge(-.1)" @keydown.up.prevent="nudge(.1)"
        @keydown.page-down.prevent="nudge(-1)" @keydown.page-up.prevent="nudge(1)"
        @keydown.home.prevent="emit('update:modelValue', FREQ_MIN)" @keydown.end.prevent="emit('update:modelValue', FREQ_MAX)">
        <svg viewBox="0 0 360 142" aria-hidden="true">
          <text x="20" y="25" class="window-band">{{ dial.band }}</text>
          <text x="340" y="25" class="window-band" text-anchor="end">{{ dial.unit }}</text>
          <g class="window-ruler" :style="{ transform: `translateX(${offset}px)` }">
            <g class="window-scan" :class="{ searching: tuning && !dragging }">
              <line x1="0" y1="82" :x2="xOf(FREQ_MAX)" y2="82" class="window-baseline" />
              <line v-for="(tick, i) in ticks" :key="i" :x1="tick.x" :x2="tick.x" :y1="tick.major ? 44 : 63" y2="82" class="window-tick" :class="{ major: tick.major }" />
              <text v-for="label in labels" :key="label.x" :x="label.x" y="111" class="window-label" text-anchor="middle">{{ label.value }}</text>
            </g>
          </g>
          <g class="window-needle" transform="translate(180, 0)">
            <path d="M-4 36H4L0 44Z" fill="currentColor" />
            <line x1="0" y1="43" x2="0" y2="128" stroke="currentColor" stroke-width="2" />
          </g>
        </svg>
      </div>
    </div>
    <p class="tuning-hint"><span aria-hidden="true">‹</span>左右滑动调台<span aria-hidden="true">›</span></p>
  </section>
</template>

<style scoped>
.tuning-window { width: 100%; flex: none; margin: 20px 0 0; }
.tuning-frame { padding: 12px; border: 1px solid var(--line); border-radius: 22px; background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(var(--hi), .025) 2px 3px), linear-gradient(145deg, var(--surface-top), var(--well-deep)); box-shadow: 0 8px 18px rgba(var(--sh), .35), inset 0 1px 1px rgba(var(--hi), .18), inset 0 -1px 1px rgba(var(--sh), .6); }
.tuning-glass { position: relative; overflow: hidden; border: 1px solid #a46c39; border-radius: 13px; background: linear-gradient(175deg, #383632, #141414 50%, #272018); box-shadow: inset 0 3px 8px #000c, inset 0 -1px 5px #ff8b3433, 0 0 0 3px #0008; cursor: ew-resize; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.tuning-glass::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; background: linear-gradient(170deg, #ffffff18, transparent 35%), linear-gradient(115deg, transparent 45%, #ffffff04 45% 65%, transparent 65%); box-shadow: inset 0 1px 1px #ffffff40; }
.tuning-glass svg { display: block; width: 100%; height: auto; }
.window-band { fill: #ed9b68; font: 12px var(--mono); }
.window-baseline { stroke: #b69166; stroke-width: .7; }
.window-tick { stroke: #d6bc91; stroke-width: 1.2; }
.window-tick.major { stroke: #f0dfbe; stroke-width: 1.8; }
.window-label { fill: #f0dfbe; font: 16px var(--mono); }
.window-ruler { transition: transform .6s cubic-bezier(.22, 1, .36, 1); }
.dragging .window-ruler { transition: none; }
.window-scan.searching { animation: tuning-scan 1.6s ease-in-out infinite; }
@keyframes tuning-scan { 0%, 100% { transform: translateX(0); } 30% { transform: translateX(-20px); } 70% { transform: translateX(20px); } }
@media (prefers-reduced-motion: reduce) { .window-ruler { transition: none; } .window-scan.searching { animation: none; } }
.window-needle { color: #ff743e; filter: drop-shadow(0 0 4px #ff6d36); }
.tuning-hint { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 10px 0 0; color: var(--text-6); font-size: 12px; }
.tuning-hint span { font-size: 18px; line-height: 1; }
</style>
