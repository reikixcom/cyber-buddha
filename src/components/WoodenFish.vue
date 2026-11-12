<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  /** 只在玩家真的敲下去时自增；自动漏拍不会让木鱼自己动 */
  hitKey: { type: Number, default: 0 },
  grade: { type: String, default: '' },
  chain: { type: Number, default: 0 },
  size: { type: String, default: 'large' } // large 放在节奏台旁 / mini 塞进敲按钮
})

const tone = computed(() => ({ perfect: 'perfect', good: 'good', wild: 'wild' }[props.grade] || 'idle'))
const heat = computed(() => Math.min(1, props.chain / 32))
const bump = ref(false)
let timer = 0

watch(() => props.hitKey, (v) => {
  if (!v) return
  bump.value = false
  requestAnimationFrame(() => { bump.value = true })
  clearTimeout(timer)
  timer = setTimeout(() => { bump.value = false }, 190)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div
    class="woodfish" :class="[size, tone, { bump }]"
    :style="{ '--heat': (0.4 + heat * 0.6).toFixed(2) }"
    aria-hidden="true"
  >
    <div class="wf-halo"></div>

    <svg class="wf-body" viewBox="0 0 120 92" xmlns="http://www.w3.org/2000/svg">
      <!-- 木鱼主体：略扁的团子，顶部有一道提梁 -->
      <path class="wf-shell" d="M60 12 C88 12 106 28 106 48 C106 68 86 78 60 78 C34 78 14 68 14 48 C14 28 32 12 60 12 Z" />
      <path class="wf-sheen" d="M28 29 Q60 17 92 29" />
      <path class="wf-line" d="M46 13 Q60 3 74 13" />
      <!-- 木鱼开口 -->
      <path class="wf-slot" d="M22 50 Q60 68 98 50 Q60 60 22 50 Z" />
      <path class="wf-line strong" d="M22 50 Q60 68 98 50" />
      <!-- 电路刻线 -->
      <path class="wf-line" d="M32 30 H48 M72 30 H88 M60 20 V38 M38 40 H50 M70 40 H82" />
      <circle class="wf-dot" cx="60" cy="30" r="3.4" />
      <circle class="wf-dot small" cx="34" cy="44" r="1.8" />
      <circle class="wf-dot small" cx="86" cy="44" r="1.8" />
    </svg>

    <!-- 每次敲击用 hitKey 重挂载，动画自然从头播放 -->
    <div v-if="hitKey > 0" :key="hitKey" class="wf-hit">
      <!--
        木槌：支点设在「握柄末端」(52,7)，槌头在左下 (19,67)。
        旋转时是槌头划弧落到木鱼顶面，而不是整根柄扫过去。
        preserveAspectRatio="none" 让 CSS 里的 transform-origin 与 viewBox 坐标一一对应。
      -->
      <svg class="wf-mallet" viewBox="0 0 64 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="52" y1="7" x2="23" y2="56" stroke="#6d4423" stroke-width="10" stroke-linecap="round" />
        <line x1="52" y1="7" x2="23" y2="56" stroke="#d3a066" stroke-width="6.5" stroke-linecap="round" />
        <line x1="49" y1="11" x2="26" y2="52" stroke="#ffe6b8" stroke-width="1.8" stroke-linecap="round" opacity=".7" />
        <!-- 握柄末端的缠绳 -->
        <line x1="47" y1="15" x2="52" y2="8" stroke="#ffe6b8" stroke-width="2" opacity=".55" />
        <!-- 槌头：真正砸在木鱼上的部分 -->
        <circle cx="19" cy="67" r="14" fill="#e9bb7c" stroke="currentColor" stroke-width="2.2" />
        <circle cx="19" cy="67" r="14" fill="none" stroke="#805026" stroke-width="5" opacity=".3" />
        <path d="M9 61 Q15 55 23 57" fill="none" stroke="#fff3d6" stroke-width="2.4" stroke-linecap="round" opacity=".75" />
        <circle cx="14.5" cy="63" r="3.2" fill="#fff6de" opacity=".6" />
      </svg>
      <span class="wf-spark"></span>
      <span class="wf-flash"></span>
      <span class="wf-ripple"></span>
      <span class="wf-ripple second"></span>
    </div>

    <div v-if="size === 'large'" class="wf-caption">
      <span>电子木鱼</span><b>× {{ chain }}</b>
    </div>
  </div>
</template>
