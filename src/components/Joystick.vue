<script setup>
/**
 * 窄屏虚拟摇杆：输出 -1~1 的归一化方向，由 TempleEngine 与 WASD 合并。
 * 只用 pointer 事件 + setPointerCapture，手指滑出底盘也不会丢失控制。
 */
import { ref } from 'vue'

const emit = defineEmits(['move'])
const base = ref(null)
const knob = ref({ x: 0, y: 0 })
const active = ref(false)
const RADIUS = 34
let pid = null

function update(e) {
  const r = base.value.getBoundingClientRect()
  let dx = e.clientX - (r.left + r.width / 2)
  let dy = e.clientY - (r.top + r.height / 2)
  const len = Math.hypot(dx, dy)
  if (len > RADIUS) { dx = dx / len * RADIUS; dy = dy / len * RADIUS }
  knob.value = { x: dx, y: dy }
  emit('move', { x: dx / RADIUS, y: dy / RADIUS })
}

function down(e) {
  e.preventDefault()
  pid = e.pointerId
  active.value = true
  base.value.setPointerCapture?.(pid)
  update(e)
}

function move(e) {
  if (pid !== e.pointerId) return
  e.preventDefault()
  update(e)
}

function up(e) {
  if (pid !== e.pointerId) return
  pid = null
  active.value = false
  knob.value = { x: 0, y: 0 }
  emit('move', { x: 0, y: 0 })
}
</script>

<template>
  <div class="joy-wrap">
    <div
      ref="base" class="joy-base" :class="{ active }"
      @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"
    >
      <span class="joy-arrow up">▲</span>
      <span class="joy-arrow down">▼</span>
      <span class="joy-arrow left">◀</span>
      <span class="joy-arrow right">▶</span>
      <i class="joy-knob" :style="{ transform: `translate(${knob.x}px, ${knob.y}px)` }"></i>
    </div>
    <div class="joy-label">摇杆走动 · 点图标瞬移</div>
  </div>
</template>
