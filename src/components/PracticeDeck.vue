<script setup>
import { computed } from 'vue'
import WoodenFish from './WoodenFish.vue'

const props = defineProps({ p: { type: Object, required: true } })
const emit = defineEmits(['knock', 'toggle'])

const GRADES = {
  perfect: { text: 'PERFECT', color: '#00f0ff' },
  good: { text: 'GOOD', color: '#ffcc66' },
  wild: { text: '乱敲不计', color: '#ff2d95' }
}
const grade = computed(() => GRADES[props.p.lastGrade] || null)
const acc = computed(() => Math.round(props.p.accuracyNow * 100))
const paused = computed(() => props.p.phase === 'paused')
const vowPct = computed(() => {
  const w = props.p.activeWish
  return w ? Math.min(100, (w.progress / w.need) * 100) : 0
})
// 一炷 64 拍，按每拍约 2.5 击估算剩余炷数，长线单才有目标感
const vowLeft = computed(() => {
  const w = props.p.activeWish
  return w ? Math.max(1, Math.ceil((w.need - w.progress) / 160)) : 0
})
const vowCrowd = computed(() => Object.keys(props.p.activeWish?.contributors || {}).length)
const myHits = computed(() => props.p.activeWish?.contributors?.['你'] || 0)
const myShare = computed(() => {
  const w = props.p.activeWish
  return w ? props.p.shareOf(w.bounty, myHits.value, Math.max(1, w.need)) : 0
})

// 触屏走 pointerdown 立即响应（零延迟），浏览器随后补发的 click 属于同一次交互，跳过；
// 没有 pointerdown 的 click（键盘、辅助技术、程序化调用）照常生效。
// 这样既能极快连敲，也不会一指敲两下。
// 初值必须为 -Infinity：页面刚加载时 performance.now() 很小，
// 若用 0，首屏 700ms 内的第一次纯 click 会被误判成「pointerdown 的补发」而吞掉
let knockPointerAt = -Infinity
function tapKnock(e) {
  if (e?.type === 'pointerdown') {
    e.preventDefault()
    knockPointerAt = performance.now()
  } else if (performance.now() - knockPointerAt < 700) {
    return
  }
  if (e?.currentTarget?.blur) e.currentTarget.blur()
  emit('knock')
}
let togglePointerAt = -Infinity
function tapToggle(e) {
  if (e?.type === 'pointerdown') {
    e.preventDefault()
    togglePointerAt = performance.now()
  } else if (performance.now() - togglePointerAt < 700) {
    return
  }
  if (e?.currentTarget?.blur) e.currentTarget.blur()
  emit('toggle')
}
</script>

<template>
  <div class="deck-wrap">
    <!-- 桌面：节奏台左侧常驻的电子木鱼，镜头怎么转都在 -->
    <WoodenFish class="fish-stage" size="large" :hit-key="p.gradeKey" :grade="p.lastGrade" :chain="p.chain" />

    <div class="deck panel" :class="{ 'is-paused': paused }">
      <div class="deck-head">
        <div class="deck-title">
          <span class="panel-title">
            <span class="desktop-only">COMMUNAL PRACTICE · 全网共修一炷香</span>
            <span class="mobile-inline">共修一炷香</span>
          </span>
          <span class="deck-round">第 {{ p.round }} 炷</span>
        </div>
        <div class="deck-meta">
          <span class="meta-extra"><span class="live-dot" :class="{ off: paused }"></span>{{ p.online.toLocaleString() }} 人共修 <span class="deck-sep">/</span></span>
          第 <b class="c-cyan">{{ p.beatDone }}</b>/{{ p.beatsPerStick }} 拍
          <span class="meta-extra"><span class="deck-sep">/</span> 剩余 {{ p.countdown.toFixed(1) }}s</span>
        </div>
      </div>

      <!-- 当前共诵的愿望直接贴在敲击台上：目标、同修人数、我能分多少一眼看全 -->
      <div v-if="p.activeWish" class="vow-strip active" :class="{ 'is-temple': p.activeWish.kind === 'temple' }">
        <span class="vow-tag">{{ p.activeWish.kind === 'temple' ? '常住共修' : '代诵中' }}</span>
        <span class="vow-text">「{{ p.activeWish.text }}」</span>
        <span class="vow-crowd">{{ vowCrowd }} 人同诵 · 你 {{ myHits }} 击</span>
        <span class="vow-num">{{ p.activeWish.progress }}/{{ p.activeWish.need }} 击<span class="vow-eta"> · 约 {{ vowLeft }} 炷</span></span>
        <span class="vow-bounty">{{ myShare > 0 ? '预计 +' + myShare + ' $G' : '按击数分' }}</span>
        <i class="vow-bar" :style="{ width: vowPct + '%' }"></i>
      </div>
      <div v-else class="vow-strip empty">
        <span class="vow-tag idle">未共诵</span>
        <span class="vow-text">万佛墙点「加入共诵」· 别人已经在敲也照样能一起敲</span>
      </div>

      <div class="track" @pointerdown="tapKnock" @click="tapKnock">
        <div class="track-rail"></div>
        <div class="judge-line" :style="{ left: p.judgeX + '%' }"></div>
        <div
          v-for="b in p.beatsOnTrack" :key="b.index"
          class="beat" :class="[b.grade, { accent: b.accent }]"
          :style="{ left: b.left + '%' }"
        ><i></i></div>
        <Transition name="grade-pop">
          <div v-if="grade && p.gradeVisible && !paused" :key="p.gradeKey" class="grade-fly" :style="{ color: grade.color, textShadow: '0 0 14px ' + grade.color }">
            {{ grade.text }}
          </div>
        </Transition>
        <div class="track-label">点轨道或「敲」跟着光点落拍 · 金色为重拍</div>
        <div v-if="paused" class="pause-veil">已暂停 · 点「继续」回到这一拍</div>
      </div>

      <div v-if="p.settlement && !paused" class="settle">
        <div class="settle-title">第 {{ p.settlement.round }} 炷 · 结算</div>
        <div class="settle-row">
          <span>合拍率 <b>{{ Math.round(p.settlement.accuracy * 100) }}%</b></span>
          <span>PERFECT <b class="c-cyan">{{ p.settlement.perfect }}</b></span>
          <span>GOOD <b class="c-gold">{{ p.settlement.good }}</b></span>
          <span>MISS <b>{{ p.settlement.miss }}</b></span>
          <span>乱敲 <b class="c-pink">{{ p.settlement.wild }}</b></span>
        </div>
        <div class="settle-reward">
          +{{ p.settlement.reward }} <small>$GONGDE</small>
          <em>基础 {{ p.baseRelease }} × 合拍率 × 稀释 {{ p.settlement.dilution.toFixed(2) }}（{{ p.settlement.online }} 人在场）</em>
        </div>
      </div>

      <div class="deck-foot">
        <div class="deck-stats">
          <div><span class="label-mono">合拍率</span><b class="c-cyan">{{ acc }}%</b></div>
          <div><span class="label-mono">连击</span><b class="c-gold">× {{ p.chain }}</b></div>
          <div><span class="label-mono">本炷乱敲</span><b class="c-pink">{{ p.wildCount }}</b></div>
        </div>
        <div class="deck-actions">
          <button
            class="btn-knock clickable" :class="{ active: p.phase === 'running' }"
            @pointerdown="tapKnock" @click="tapKnock"
          >
            <!-- 手机：木鱼缩进按钮里，手指就按在木鱼上 -->
            <WoodenFish class="fish-inline" size="mini" :hit-key="p.gradeKey" :grade="p.lastGrade" :chain="p.chain" />
            <span class="knock-glyph">◆</span> 敲 <kbd>SPACE</kbd>
          </button>
          <button
            class="btn-mini clickable" :class="{ paused }"
            @pointerdown="tapToggle" @click="tapToggle"
          >{{ p.running ? '暂停' : (p.round ? '继续' : '开始共修') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
