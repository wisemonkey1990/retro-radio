<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
const content = ref<HTMLElement>()
const dragY = ref(0)
const dragging = ref(false)
const hasDragged = ref(false)
const closing = ref(false)
const previous = document.activeElement as HTMLElement | null
let overflow = ''
let startX = 0
let startY = 0
let startedAt = 0
let canDrag = false
let blockClick = false
let closeTimer: ReturnType<typeof setTimeout> | undefined

function begin(x: number, y: number) {
  startX = x
  startY = y
  startedAt = performance.now()
  blockClick = false
  canDrag = true
}
function update(x: number, y: number, preventDefault: () => void) {
  if (!canDrag) return
  const dx = x - startX
  const dy = y - startY
  if (!dragging.value) {
    if (dy < -8 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { canDrag = false; return }
    // Claim a downward touch before Android's native scroller latches onto it.
    if (dy > 0 && dy > Math.abs(dx)) preventDefault()
    if (dy < 8 || dy < Math.abs(dx) * 1.2) return
    dragging.value = true
    hasDragged.value = true
  }
  preventDefault()
  dragY.value = Math.max(0, dy)
}
function resetDrag() {
  canDrag = false
  dragging.value = false
  dragY.value = 0
}
function finish() {
  canDrag = false
  if (!dragging.value) return
  blockClick = true
  const threshold = Math.min(96, (panel.value?.clientHeight ?? 480) * .2)
  const flick = dragY.value > 40 && performance.now() - startedAt < 300
  dragging.value = false
  if (dragY.value >= threshold || flick) {
    closing.value = true
    dragY.value = (panel.value?.clientHeight ?? 480) + 24
    closeTimer = setTimeout(() => emit('close'), 200)
  } else dragY.value = 0
}
function pointerDown(e: PointerEvent) {
  if (closing.value || !e.isPrimary || e.button !== 0 || (e.target as Element).closest('button')) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  begin(e.clientX, e.clientY)
}
function pointerMove(e: PointerEvent) {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) update(e.clientX, e.clientY, () => e.preventDefault())
}
function pointerEnd(e: PointerEvent) {
  const target = e.currentTarget as HTMLElement
  if (!target.hasPointerCapture(e.pointerId)) return
  if (e.type === 'pointercancel') resetDrag()
  else finish()
  target.releasePointerCapture(e.pointerId)
}
function touchStart(e: TouchEvent) {
  canDrag = false
  blockClick = false
  if (closing.value || e.touches.length !== 1 || (content.value?.scrollTop ?? 0) > 0) return
  if ((e.target as Element).closest('input, select, textarea, label, [role="slider"], [contenteditable]')) return
  begin(e.touches[0].clientX, e.touches[0].clientY)
}
function touchMove(e: TouchEvent) {
  if (!canDrag) return
  if (e.touches.length !== 1) { resetDrag(); return }
  if (!dragging.value && (content.value?.scrollTop ?? 0) > 0) { canDrag = false; return }
  update(e.touches[0].clientX, e.touches[0].clientY, () => { if (e.cancelable) e.preventDefault() })
}
function touchEnd(e: TouchEvent) {
  if (dragging.value && e.cancelable) e.preventDefault()
  finish()
}
function click(e: MouseEvent) {
  if (blockClick) { e.preventDefault(); e.stopPropagation(); blockClick = false }
}
function key(e: KeyboardEvent) {
  blockClick = false
  if (e.key === 'Escape') { e.preventDefault(); emit('close') }
  if (e.key !== 'Tab') return
  const elements = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), summary, a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length)
  const first = elements[0], last = elements[elements.length - 1]
  if (!first) { e.preventDefault(); panel.value?.focus(); return }
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { e.preventDefault(); last?.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
onMounted(() => {
  overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  panel.value?.focus()
  document.addEventListener('keydown', key)
  content.value?.addEventListener('touchmove', touchMove, { passive: false })
})
onBeforeUnmount(() => {
  clearTimeout(closeTimer)
  document.body.style.overflow = overflow
  document.removeEventListener('keydown', key)
  content.value?.removeEventListener('touchmove', touchMove)
  previous?.focus()
})
</script>
<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('close')">
      <section ref="panel" class="sheet" :class="{ 'is-dragging': dragging, 'has-dragged': hasDragged }" :style="{ transform: `translateY(${dragY}px)` }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @pointerdown.capture="blockClick = false" @click.capture="click">
        <div class="sheet-head" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="!closing && resetDrag()">
          <div class="sheet-grip" aria-hidden="true"><div class="sheet-handle" /></div>
          <header><h2>{{ title }}</h2><button class="sheet-close" aria-label="关闭" @pointerdown="blockClick = false" @click="emit('close')">×</button></header>
        </div>
        <div ref="content" class="sheet-content" @touchstart="touchStart" @touchend="touchEnd" @touchcancel="resetDrag"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>
