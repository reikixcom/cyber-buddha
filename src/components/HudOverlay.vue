<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { emitFactor } from '../temple/economy.js'
import { fmtCountdown, fmtClock } from '../temple/dharma.js'

const props = defineProps({
  merit: { type: Number, required: true },
  rank: { type: String, required: true },
  progress: { type: Number, required: true },
  daily: { type: Object, required: true },
  dailyCap: { type: Number, required: true },
  combo: { type: Number, default: 0 },
  tasks: { type: Array, required: true },
  logs: { type: Array, required: true },
  hovered: { type: Object, default: null },
  activeId: { type: String, default: '' },
  muted: { type: Boolean, default: false },
  quality: { type: String, default: 'high' },
  lampPct: { type: Number, default: 0 },
  openings: { type: Number, default: 0 },
  templePool: { type: Number, default: 0 },
  streak: { type: Object, default: () => ({ days: 0, best: 0 }) },
  assembly: { type: Object, default: () => ({ active: false, mult: 1, msLeft: 0, nextAt: 0 }) }
})
const emit = defineEmits(['toggle-mute', 'toggle-quality', 'select', 'reset-view'])

const emitNow = computed(() => emitFactor(props.daily.earned))
const dailyPct = computed(() => Math.min(100, (props.daily.earned / props.dailyCap) * 100))

/** 窄屏只有 122px 宽，这里只能放得下「晨课 ×2 07:12」这种六七个字的短句 */
const asmShort = computed(() => {
  const a = props.assembly
  if (!a) return ''
  if (a.active) return `${a.label} ×${a.mult} ${fmtCountdown(a.msLeft)}`
  const soon = a.msToNext > 0 && a.msToNext < 10 * 60 * 1000
  return `${soon ? '将开' : '法会'} ${fmtClock(a.nextAt)}`
})
const streakHot = computed(() => (props.streak?.days || 0) >= 3)

/** 开光瞬间给长明灯一次明确的视觉反馈，否则「灯油满了」毫无存在感 */
const lampFlash = ref(false)
let flashTimer = 0
watch(() => props.openings, (n, o) => {
  if (n <= o) return
  lampFlash.value = false
  requestAnimationFrame(() => { lampFlash.value = true })
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { lampFlash.value = false }, 1200)
})
onBeforeUnmount(() => clearTimeout(flashTimer))

const ACTIONS = [
  { id: 'incense', key: '1', name: '上香', color: '#ffcc66' },
  { id: 'bow', key: '2', name: '叩拜', color: '#ffcc66' },
  { id: 'fish', key: '3', name: '敲木鱼', color: '#ff2d95' },
  { id: 'bell', key: '4', name: '撞钟', color: '#00f0ff' }
]
</script>

<template>
  <div class="hud">
    <!-- 顶部 -->
    <div class="hud-top">
      <div class="brand">
        <div class="brand-mark"><span>禅</span></div>
        <div>
          <div class="brand-name">赛博禅寺</div>
          <div class="brand-sub">CYBER TEMPLE // NODE 001</div>
        </div>
      </div>

      <!-- 右上角：功能按钮一行 / 功德积分一行 / 长明灯一行，互不挤压 -->
      <div class="hud-right">
        <div class="hud-tools">
          <button class="icon-btn clickable" :class="{ 'is-off': muted }" :title="muted ? '开启音效 (M)' : '静音 (M)'" @click="emit('toggle-mute')">
            {{ muted ? '×' : '♫' }}
          </button>
          <button class="icon-btn clickable" :title="'画质：' + (quality === 'high' ? '高' : '省电')" @click="emit('toggle-quality')">
            {{ quality === 'high' ? '◈' : '◇' }}
          </button>
          <button class="icon-btn clickable" title="复位视角 (R)" @click="emit('reset-view')">⟲</button>
          <button class="icon-btn clickable" title="分享给同修" @click="emit('share')">↗</button>
        </div>

        <div class="merit-card panel" :class="{ 'is-assembly': assembly.active }">
          <div class="panel-title">$GONGDE · 功德余额</div>
          <div class="merit-value">{{ merit.toLocaleString() }}<span class="merit-unit">$G</span></div>
          <div class="merit-rank">当前果位 · {{ rank }}</div>
          <div class="merit-bar"><i :style="{ width: progress + '%' }"></i></div>
          <div class="merit-daily">
            今日香火 {{ daily.earned }}/{{ dailyCap }}
            <b v-if="emitNow < 1">· 增发 ×{{ emitNow }}</b>
          </div>
          <div class="daily-bar"><i :style="{ width: dailyPct + '%' }"></i></div>
          <!-- 连修与法会是「明天还来」的两个理由，压成一行放在额度下面 -->
          <div class="merit-day">
            <span class="day-streak" :class="{ hot: streakHot }" :title="`连修 ${streak.days} 日 · 最佳 ${streak.best} 日`">
              <template v-if="streak.days > 0">连修 {{ streak.days }} 日</template>
              <template v-else>未起修</template>
            </span>
            <span class="day-asm" :class="{ on: assembly.active }" :title="assembly.active ? '法会进行中，修行功德翻倍' : '下一场法会的开始时间'">
              {{ asmShort }}
            </span>
          </div>
        </div>

        <div class="lamp-card panel" :class="{ 'is-flaring': lampFlash }">
          <div class="lamp-head">
            <div class="lamp-flame" aria-hidden="true">
              <svg viewBox="0 0 30 38" width="26" height="34">
                <defs>
                  <linearGradient id="ctLampFlame" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stop-color="#ff5a1f" />
                    <stop offset="0.52" stop-color="#ffcc66" />
                    <stop offset="1" stop-color="#fff6d8" />
                  </linearGradient>
                </defs>
                <path class="flame-outer" d="M15 2c6 8 9 12 9 19a9 9 0 0 1-18 0c0-5 3-8 5-12 0 4 2 5 3 5 2 0 2-5 1-12z" fill="url(#ctLampFlame)" />
                <path class="flame-inner" d="M15 18c2 3 3 5 3 8a3 3 0 0 1-6 0c0-3 2-5 3-8z" fill="#fff8e2" opacity="0.9" />
              </svg>
            </div>
            <div class="lamp-info">
              <div class="panel-title">ETERNAL LAMP · 全服长明灯</div>
              <div class="lamp-pct">{{ lampPct.toFixed(0) }}<small>%</small></div>
            </div>
          </div>
          <div class="lamp-fuel"><i :style="{ width: lampPct + '%' }"></i></div>
          <div class="lamp-foot">
            已满即开光 · 已 {{ openings }} 次 · 常住愿池 {{ templePool }} $G
          </div>
          <Transition name="lamp-pop">
            <div v-if="lampFlash" class="lamp-flare">开光 · 全服添灯油</div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- 准星 -->
    <div class="hud-mid"><div class="crosshair"></div></div>

    <!-- 悬停交互提示 -->
    <Transition name="fade">
      <div v-if="hovered" class="hover-card">
        <div class="hover-name">{{ hovered.name }}</div>
        <div class="hover-action">{{ hovered.action }}</div>
        <div class="hover-key">点击 / {{ hovered.key }} 开始</div>
      </div>
    </Transition>

    <!-- 功德飘字已提到 App 层（ToastStack）：首屏未入寺时也要能出提示 -->
    <div v-if="combo >= 3" :key="combo" class="combo-badge">COMBO × {{ combo }}</div>

    <!-- 底部 -->
    <div class="hud-bottom">
      <div class="quest-panel panel">
        <div class="panel-title">TODAY'S PRACTICE · 今日修行</div>
        <ul class="quest-list">
          <li v-for="q in tasks" :key="q.id" class="quest-item" :class="{ done: q.done }">
            <span class="quest-box">{{ q.done ? '✓' : '' }}</span>
            <span class="quest-text">{{ q.label }}</span>
            <span class="quest-progress">{{ q.done ? 'DONE' : 'TODO' }} <em class="q-count">{{ q.used }}/{{ q.cap }}</em></span>
          </li>
        </ul>
      </div>

      <div class="center-bottom">
        <div class="hotbar">
          <button
            v-for="a in ACTIONS" :key="a.id"
            class="hotbar-item clickable"
            :class="{ active: activeId === a.id }"
            @click="emit('select', a.id)"
          >
            <div class="hotbar-key">{{ a.key }}</div>
            <div class="hotbar-name">{{ a.name }}</div>
          </button>
        </div>
        <div class="hint-line">
          <span class="hint-desktop"><b>空格 / 点轨道</b> 落拍共修 &nbsp;·&nbsp; <b>点图标 / 1-4</b> 走到法器 &nbsp;·&nbsp; <b>拖拽</b> 环视 &nbsp;·&nbsp; <b>W A S D</b> 漫游</span>
          <span class="hint-mobile"><b>点轨道</b> 落拍 &nbsp;·&nbsp; <b>点图标</b> 瞬移法器 &nbsp;·&nbsp; <b>摇杆</b> 走动 &nbsp;·&nbsp; <b>拖拽</b> 环视</span>
        </div>
      </div>

      <div class="log-panel panel">
        <div class="panel-title">SYSTEM LOG · 香火链</div>
        <div class="log-list">
          <div v-for="l in logs" :key="l.id" class="log-line" :class="{ hi: l.hi }">
            <span class="t">{{ l.time }}</span>{{ l.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
