<script setup lang="ts">
import { computed, ref } from 'vue'
import { FREQ_MAX, FREQ_MIN, LOCK_WINDOW, PRESETS, dialText } from '../data'
import type { RadioMode } from '../audio/amRadio'

const props = defineProps<{ modelValue: number; mode: RadioMode }>()
const emit = defineEmits<{ 'update:modelValue': [freq: number] }>()
const glass = ref<HTMLElement>()
const xOf = (freq: number) => 20 + (freq - FREQ_MIN) / (FREQ_MAX - FREQ_MIN) * 320
const dial = computed(() => dialText(props.modelValue, props.mode))
const readout = computed(() => `${dial.value.band} ${dial.value.value} ${dial.value.unit}`)
const ticks = Array.from({ length: 83 }, (_, i) => {
  const freq = FREQ_MIN + i * .25
  return { x: xOf(freq), major: Number.isInteger(freq) }
})
const labels = computed(() => [FREQ_MIN, 90, 95, 100, 105, FREQ_MAX].map(freq => ({
  x: xOf(freq), value: dialText(freq, props.mode).value,
})))
const needle = computed(() => xOf(props.modelValue))

function seek(e: PointerEvent) {
  const rect = glass.value!.getBoundingClientRect()
  const position = (e.clientX - rect.left) / rect.width * 360
  emit('update:modelValue', FREQ_MIN + (position - 20) / 320 * (FREQ_MAX - FREQ_MIN))
}
function down(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0) return
  glass.value!.setPointerCapture(e.pointerId)
  seek(e)
}
function move(e: PointerEvent) {
  if (glass.value!.hasPointerCapture(e.pointerId)) seek(e)
}
function release(e: PointerEvent) {
  if (glass.value!.hasPointerCapture(e.pointerId)) glass.value!.releasePointerCapture(e.pointerId)
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
      <div ref="glass" class="tuning-glass" tabindex="0" role="slider" aria-label="调频" aria-orientation="horizontal"
        :aria-valuemin="FREQ_MIN" :aria-valuemax="FREQ_MAX" :aria-valuenow="modelValue" :aria-valuetext="readout"
        @pointerdown="down" @pointermove="move" @pointerup="release" @pointercancel="release" @wheel.prevent="wheel"
        @keydown.left.prevent="nudge(-.1)" @keydown.right.prevent="nudge(.1)"
        @keydown.down.prevent="nudge(-.1)" @keydown.up.prevent="nudge(.1)"
        @keydown.page-down.prevent="nudge(-1)" @keydown.page-up.prevent="nudge(1)"
        @keydown.home.prevent="emit('update:modelValue', FREQ_MIN)" @keydown.end.prevent="emit('update:modelValue', FREQ_MAX)">
        <svg viewBox="0 0 360 114" aria-hidden="true">
          <text x="20" y="25" class="window-band">{{ dial.band }}</text>
          <text x="340" y="25" class="window-band" text-anchor="end">{{ dial.unit }}</text>
          <line x1="20" y1="72" x2="340" y2="72" class="window-baseline" />
          <line v-for="(tick, i) in ticks" :key="i" :x1="tick.x" :x2="tick.x" :y1="tick.major ? 50 : 61" y2="72" class="window-tick" :class="{ major: tick.major }" />
          <text v-for="label in labels" :key="label.x" :x="label.x" y="94" class="window-label" text-anchor="middle">{{ label.value }}</text>
          <g class="window-needle" :transform="`translate(${needle}, 0)`">
            <path d="M-4 36H4L0 44Z" fill="currentColor" />
            <line x1="0" y1="43" x2="0" y2="105" stroke="currentColor" stroke-width="1.6" />
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
.window-tick { stroke: #d6bc91; stroke-width: .8; }
.window-tick.major { stroke: #f0dfbe; stroke-width: 1.2; }
.window-label { fill: #f0dfbe; font: 11px var(--mono); }
.window-needle { color: #ff743e; filter: drop-shadow(0 0 4px #ff6d36); }
.tuning-hint { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 10px 0 0; color: var(--text-6); font-size: 12px; }
.tuning-hint span { font-size: 18px; line-height: 1; }
</style>
