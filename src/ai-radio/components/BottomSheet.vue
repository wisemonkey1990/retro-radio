<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement | null
let overflow = ''
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
onBeforeUnmount(() => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus() })
</script>
<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('close')">
      <section ref="panel" class="sheet" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
        <div class="sheet-handle" aria-hidden="true" />
        <header><h2>{{ title }}</h2><button class="sheet-close" aria-label="关闭" @click="emit('close')">×</button></header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
