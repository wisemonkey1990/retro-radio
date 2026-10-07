<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
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
let closeTimer: ReturnType<typeof setTimeout> | undefined

function touchStart(e: TouchEvent) {
  canDrag = false
  if (closing.value || e.touches.length !== 1) return
  const target = e.target as HTMLElement
  if (target.closest('button, input, select, textarea, label, summary, a, [role="slider"], [contenteditable]')) return
  if ((panel.value?.scrollTop ?? 0) > 0 && !target.closest('[data-sheet-drag]')) return
  startX = e.touches[0].clientX
  startY = e.touches[0].clientY
  startedAt = performance.now()
  canDrag = true
}
function touchMove(e: TouchEvent) {
  if (!canDrag) return
  if (e.touches.length !== 1) { resetDrag(); return }
  const dx = e.touches[0].clientX - startX
  const dy = e.touches[0].clientY - startY
  if (!dragging.value) {
    if (dy < -8 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { canDrag = false; return }
    if (dy < 8 || dy < Math.abs(dx) * 1.2) return
    dragging.value = true
    hasDragged.value = true
  }
  if (e.cancelable) e.preventDefault()
  dragY.value = Math.max(0, dy)
}
function resetDrag() {
  canDrag = false
  dragging.value = false
  dragY.value = 0
}
function touchEnd(e: TouchEvent) {
  canDrag = false
  if (!dragging.value) return
  if (e.cancelable) e.preventDefault()
  const threshold = Math.min(110, (panel.value?.clientHeight ?? 550) * .2)
  const flick = dragY.value > 40 && performance.now() - startedAt < 300
  dragging.value = false
  if (dragY.value >= threshold || flick) {
    closing.value = true
    dragY.value = (panel.value?.clientHeight ?? 550) + 24
    closeTimer = setTimeout(() => emit('close'), 200)
  } else dragY.value = 0
}
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close') }
  if (e.key !== 'Tab') return
  const elements = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), summary, a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length)
  const first = elements[0], last = elements[elements.length - 1]
  if (!first) { e.preventDefault(); panel.value?.focus(); return }
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { e.preventDefault(); last?.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
onMounted(() => { overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; panel.value?.focus(); document.addEventListener('keydown', key) })
onBeforeUnmount(() => { clearTimeout(closeTimer); document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus() })
</script>
<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('close')">
      <section ref="panel" class="sheet" :class="{ 'is-dragging': dragging, 'has-dragged': hasDragged }" :style="{ transform: `translateY(${dragY}px)` }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1"
        @touchstart="touchStart" @touchmove="touchMove" @touchend="touchEnd" @touchcancel="resetDrag">
        <div class="sheet-handle" data-sheet-drag aria-hidden="true" />
        <header data-sheet-drag><h2>{{ title }}</h2><button class="sheet-close" aria-label="关闭" @click="emit('close')">×</button></header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
