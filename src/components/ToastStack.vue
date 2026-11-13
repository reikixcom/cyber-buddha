<script setup>
/**
 * 飘字提示：独立于 HUD 渲染，首屏（还没入寺）也能看见「链接已复制」这类反馈。
 * 之前它长在 HudOverlay 里，而 HudOverlay 是 v-if="started"，于是首屏按钮
 * 点了没反应 —— 用户以为坏了。
 */
defineProps({ toasts: { type: Array, required: true } })
</script>

<template>
  <div class="toast-stack">
    <TransitionGroup name="toast-fly">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        {{ t.text }}<small v-if="t.sub">{{ t.sub }}</small>
      </div>
    </TransitionGroup>
  </div>
</template>
