<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import StartScreen from './components/StartScreen.vue'
import HudOverlay from './components/HudOverlay.vue'
import PracticeDeck from './components/PracticeDeck.vue'
import SanghaPanel from './components/SanghaPanel.vue'
import Joystick from './components/Joystick.vue'
import { TempleEngine } from './temple/TempleEngine.js'
import { usePractice } from './composables/usePractice.js'
import {
  RITUALS, DAILY_CAP, freshDaily, normalizeDaily, dayKey,
  ritualCheck, applyRitual, emitCredit
} from './temple/economy.js'
import { snapshotPractice } from './temple/save.js'

const STORE_KEY = 'cyber-temple-save-v2'
const RANKS = [
  { min: 0, name: '初入山门' },
  { min: 30, name: '电子沙弥' },
  { min: 100, name: '数据居士' },
  { min: 300, name: '赛博护法' },
  { min: 800, name: '量子罗汉' },
  { min: 2000, name: '算法菩萨' },
  { min: 5000, name: '赛博佛陀' }
]
const QUEST_DEFS = [
  { id: 'incense', label: '上一炷量子香' },
  { id: 'bow', label: '向佛祖叩拜一次' },
  { id: 'fish', label: '敲一记电子木鱼' },
  { id: 'bell', label: '撞响赛博晨钟' }
]
const VERSES = [
  '色即是空，空即是数据',
  '木鱼一响，BUG 消亡',
  '服务器即道场，日志即经文',
  '万物皆可上链，唯因果不可篡改',
  '香火不问出处，功德只认真心',
  '一念三千线程，弹指八万 Bug'
]

const canvasRef = ref(null)
const started = ref(false)
const booting = ref(true)
const bootError = ref('')
const merit = ref(0)
const bestCombo = ref(0)
const knockCount = ref(0)
const combo = ref(0)
const muted = ref(false)
const quality = ref('high')
const taskDone = ref({ incense: false, bow: false, fish: false, bell: false })
/** 当日增发额度、各法器次数与冷却；跨天自动重置 */
const daily = ref(freshDaily())
const toasts = ref([])
const logs = ref([])
const hovered = ref(null)
const activeId = ref(null)

let engine = null
let seq = 0
let lastKnock = 0
let activeTimer = null
/** usePractice 在 save() 之后才创建，用函数变量绕开 TDZ */
let getPracticeSnapshot = () => null
let pendingPracticeSave = null
let autoSaveTimer = 0
let dayTimer = 0
/** 拦截提示去重：点击瞬间提示过，动画结束就不重复弹 */
const lastNotify = {}

const tasks = computed(() => QUEST_DEFS.map((q) => ({
  ...q,
  done: !!taskDone.value[q.id],
  used: daily.value.used[q.id] || 0,
  cap: RITUALS[q.id].cap
})))
const rankIdx = computed(() => {
  let i = 0
  RANKS.forEach((r, idx) => { if (merit.value >= r.min) i = idx })
  return i
})
const rank = computed(() => RANKS[rankIdx.value].name)
const progress = computed(() => {
  const cur = RANKS[rankIdx.value]
  const next = RANKS[rankIdx.value + 1]
  if (!next) return 100
  return Math.min(100, ((merit.value - cur.min) / (next.min - cur.min)) * 100)
})

function stamp() {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function pushLog(text, hi = false) {
  logs.value.push({ id: ++seq, time: stamp(), text, hi })
  if (logs.value.length > 6) logs.value.shift()
}

function addToast(text, sub = '') {
  const id = ++seq
  toasts.value.push({ id, text, sub })
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id) }, 1700)
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      merit: merit.value,
      bestCombo: bestCombo.value,
      knockCount: knockCount.value,
      taskDone: taskDone.value,
      daily: daily.value,
      muted: muted.value,
      quality: quality.value,
      // 心愿与托管是真实扣过款的资产，必须和余额一起落盘
      practice: getPracticeSnapshot()
    }))
  } catch { /* 隐私模式下忽略 */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const d = JSON.parse(raw)
    merit.value = Number(d.merit) || 0
    bestCombo.value = Number(d.bestCombo) || 0
    knockCount.value = Number(d.knockCount) || 0
    taskDone.value = { ...taskDone.value, ...(d.taskDone || {}) }
    daily.value = normalizeDaily(d.daily)
    muted.value = !!d.muted
    quality.value = d.quality === 'low' ? 'low' : 'high'
    pendingPracticeSave = d.practice ?? null
  } catch { /* 忽略损坏的存档 */ }
}

/**
 * $GONGDE 余额唯一写入口，返回实际入账金额。
 * kind='emit'     增发型：四法器之外的共修/开光，按当日额度衰减
 * kind='transfer' 转移型：悬赏托管、代诵领赏、随喜、退还，玩家之间转手，不占额度
 */
function addBalance(n, kind = 'transfer') {
  const credited = n > 0 && kind === 'emit' ? emitCredit(daily.value.earned, n) : n
  if (n > 0 && kind === 'emit') daily.value.earned += credited
  merit.value = Math.max(0, merit.value + credited)
  save()
  return credited
}

const practice = usePractice({
  merit,
  addBalance,
  pushLog,
  addToast,
  onKnockVisual: (grade) => {
    engine?.knock(grade)
    // 触屏上给 PERFECT 一点极轻的触觉反馈；不支持的浏览器自动忽略
    if (grade === 'perfect' && typeof navigator.vibrate === 'function') navigator.vibrate(9)
  },
  onCelebrate: () => {
    engine?.celebrate()
    if (typeof navigator.vibrate === 'function') navigator.vibrate([14, 60, 14])
  },
  onPersist: save
})

getPracticeSnapshot = () => snapshotPractice(practice)

if (import.meta.env.DEV) window.__cyberPractice = practice

/** 冷却 / 限次 / 额度用尽时，把原因讲明白；3D 动画照播，只是不计功德 */
function notifyBlock(type, check) {
  if (check.reason === 'cooldown') addToast('香火未冷', `${RITUALS[type].label}还需 ${check.wait}s · 动画照常`)
  else if (check.reason === 'cap') addToast(`今日${RITUALS[type].label}已满`, `${check.used}/${check.cap} 次 · 明日额度重置`)
  else if (check.reason === 'daily') addToast('今日香火已满', '增发额度用尽 · 代诵悬赏仍可领赏')
  lastNotify[type] = Date.now()
}

function onMerit(amount, type) {
  const check = ritualCheck(type, daily.value)
  if (!check.ok) {
    // 点击瞬间已提示过就不再重复；动画被跳过时这里兜底
    if (Date.now() - (lastNotify[type] || 0) > 1800) notifyBlock(type, check)
    return
  }

  applyRitual(daily.value, type, check.amount)
  addBalance(check.amount)
  if (QUEST_DEFS.some((q) => q.id === type)) {
    taskDone.value = { ...taskDone.value, [type]: true }
  }
  const names = { incense: '香火', bow: '叩拜', fish: '木鱼', bell: '晨钟' }
  const note = check.factor < 1 ? ` · 今日增发 ×${check.factor}`
    : check.amount < RITUALS[type].base ? ' · 重复修行递减' : ''
  addToast(`功德 +${check.amount}`, `${names[type] || '修行'} · 今日 ${daily.value.earned}/${DAILY_CAP}${note}`)

  if (type === 'fish') {
    const now = Date.now()
    combo.value = now - lastKnock < 1400 ? combo.value + 1 : 1
    lastKnock = now
    bestCombo.value = Math.max(bestCombo.value, combo.value)
    knockCount.value += 1
    if (knockCount.value % 12 === 0) {
      const verse = VERSES[Math.floor(Math.random() * VERSES.length)]
      pushLog('偶得偈语：' + verse, true)
      addToast('禅意顿悟', verse)
    }
  }
  save()
}

function onHotspot(id, h) {
  activeId.value = id
  clearTimeout(activeTimer)
  activeTimer = setTimeout(() => { activeId.value = null }, 1100)
  pushLog(`定位目标 → ${h.name}`)
  // 预检：点击当场就说清为什么这次不计功德，不等 3D 动画结束
  const pre = ritualCheck(id, daily.value)
  if (!pre.ok) notifyBlock(id, pre)
}

function onGlobalKey(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.code === 'Space' && started.value && !e.repeat) {
    e.preventDefault()
    practice.knock()
  }
}

function enter() {
  started.value = true
  engine?.unlockAudio()
  pushLog('已进入山门 · 共修节点在线', true)
  pushLog('提示：空格跟着光点落拍，乱敲不计功德')
  pushLog('四法器每日有定额，重复修行收益递减')
  practice.start()
}

function toggleMute() {
  muted.value = !muted.value
  engine?.setMuted(muted.value)
  pushLog(muted.value ? '音效已静音' : '音效已开启')
  save()
}

function toggleQuality() {
  quality.value = quality.value === 'high' ? 'low' : 'high'
  engine?.setQuality(quality.value)
  pushLog(quality.value === 'high' ? '渲染画质：高' : '渲染画质：省电')
  save()
}

function select(id) { engine?.activate(id) }
function resetView() { engine?.resetView() }
function onJoy(v) { engine?.setJoystick(v.x, v.y) }
function resetAll() {
  merit.value = 0
  bestCombo.value = 0
  knockCount.value = 0
  combo.value = 0
  taskDone.value = { incense: false, bow: false, fish: false, bell: false }
  daily.value = freshDaily()
  practice.resetMarket()
  save()
  pushLog('功德账本已清零 · 心愿与长明灯一并归零', true)
  addToast('账本已清零', '放下执念，重新开始')
}

/** 挂机跨过午夜也要重置额度，不能只在 load() 时看一次 */
function checkNewDay() {
  if (daily.value.day === dayKey()) return
  daily.value = freshDaily()
  taskDone.value = { incense: false, bow: false, fish: false, bell: false }
  pushLog('新的一日 · 香火额度与四法器次数已重置', true)
  addToast('新的一日', `每日 ${DAILY_CAP} $G 额度已重置`)
  save()
}
const onPageHide = () => save()
const onVisibility = () => { if (document.hidden) save() }

onMounted(() => {
  load()
  if (practice.restoreMarket(pendingPracticeSave)) {
    pushLog('本机存档已续上 · 心愿与香火进度仍在', true)
  }
  pushLog('共修协议就绪 · 第 1 炷香待燃')
  pushLog('WebGL 场景加载中...')
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)
  autoSaveTimer = setInterval(() => { if (started.value) save() }, 4000)
  dayTimer = setInterval(checkNewDay, 15000)
  try {
    engine = new TempleEngine(canvasRef.value, {
      onReady: () => {
        engine?.setMuted(muted.value)
        if (quality.value === 'low') engine?.setQuality('low')
        setTimeout(() => { booting.value = false }, 650)
        pushLog('大雄宝殿 · 渲染节点就绪')
      },
      onHover: (id, h) => {
        hovered.value = h ? { name: h.name, action: h.action, key: h.key } : null
      },
      onHotspot,
      onMerit,
      onLog: (msg) => pushLog(msg),
      onToggleMute: toggleMute
    })
  } catch (err) {
    console.error('[CyberTemple] 初始化失败', err)
    bootError.value = '场景初始化失败：' + (err?.message || '当前浏览器可能不支持 WebGL')
    booting.value = false
  }
})

onBeforeUnmount(() => {
  clearTimeout(activeTimer)
  clearInterval(autoSaveTimer)
  clearInterval(dayTimer)
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibility)
  engine?.dispose()
})
</script>

<template>
  <div class="app-root">
    <canvas ref="canvasRef" class="scene-canvas"></canvas>

    <div class="fx-layer fx-scanlines"></div>
    <div class="fx-layer fx-noise"></div>
    <div class="fx-layer fx-vignette"></div>
    <div class="fx-layer fx-edge"></div>

    <HudOverlay
      v-if="started"
      :merit="merit"
      :rank="rank"
      :progress="progress"
      :daily="daily"
      :daily-cap="DAILY_CAP"
      :combo="combo"
      :tasks="tasks"
      :logs="logs"
      :hovered="hovered"
      :active-id="activeId"
      :toasts="toasts"
      :muted="muted"
      :quality="quality"
      :lamp-pct="practice.lampPct"
      :openings="practice.openings"
      :temple-pool="practice.templePool"
      @toggle-mute="toggleMute"
      @toggle-quality="toggleQuality"
      @select="select"
      @reset-view="resetView"
    />

    <PracticeDeck
      v-if="started"
      :p="practice"
      @knock="practice.knock()"
      @toggle="practice.toggle()"
    />

    <SanghaPanel v-if="started" :p="practice" />
    <Joystick v-if="started" @move="onJoy" />

    <StartScreen
      v-if="!started && !booting"
      :merit="merit"
      :best-combo="bestCombo"
      @enter="enter"
      @reset="resetAll"
    />

    <Transition name="fade">
      <div v-if="booting" class="boot">
        <div>
          <div class="boot-text">正在构建赛博道场 · LOADING SANCTUARY</div>
          <div class="boot-bar"><i></i></div>
          <div v-if="bootError" class="boot-text" style="margin-top:18px;color:#ff2d95;letter-spacing:0.05em">
            {{ bootError }}
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
