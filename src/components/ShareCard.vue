<script setup>
/**
 * 战绩分享卡弹层。
 * 触发点就是原来那个「分享」按钮：与其只复制一个链接，不如给一张能直接发出去的图。
 * 图里带法号与禅印短码 —— 别人可以拿短码回站里复算，截图造不了假。
 */
import { ref, onMounted, watch, computed } from 'vue'
import { buildShareData, drawShareCard, buildPostText, CARD_W, CARD_H } from '../temple/sharecard.js'
import { verifySeal } from '../temple/seal.js'
import { makeDuel, duelUrl } from '../temple/duel.js'

const props = defineProps({
  merit: { type: Number, default: 0 },
  bestCombo: { type: Number, default: 0 },
  knockCount: { type: Number, default: 0 },
  sealCount: { type: Number, default: 0 },
  lastSeal: { type: Object, default: null },
  seals: { type: Array, default: () => [] },
  identity: { type: Object, default: null },
  online: { type: Number, default: 0 },
  streakDays: { type: Number, default: 0 },
  boardRank: { type: Number, default: 0 },
  duelResult: { type: Object, default: null }
})
const emit = defineEmits(['close'])

const canvas = ref(null)
const note = ref('')
const busy = ref(false)

/**
 * 最近一炷：内存里有结论就直接用；刷新后只留下回执文本，就现场复算一遍。
 * （存档里存的是文本而非对象，不解析的话刷新后卡片会一直说「还没有禅印」。）
 */
const last = computed(() => {
  if (props.lastSeal) return props.lastSeal
  const list = props.seals
  if (!Array.isArray(list) || !list.length) return null
  const v = verifySeal(list[list.length - 1])
  return v?.ok ? v.seal : null
})

const data = computed(() => buildShareData({
  merit: props.merit,
  bestCombo: props.bestCombo,
  knockCount: props.knockCount,
  sealCount: Math.max(props.sealCount || 0, props.seals.length),
  lastSeal: last.value,
  identity: props.identity,
  online: props.online,
  streakDays: props.streakDays,
  boardRank: props.boardRank,
  duelResult: props.duelResult
}))

function paint() {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  el.width = CARD_W
  el.height = CARD_H
  drawShareCard(ctx, data.value)
}

onMounted(paint)
watch(data, paint, { deep: true })

function toBlob() {
  return new Promise((resolve) => {
    if (!canvas.value) return resolve(null)
    canvas.value.toBlob((b) => resolve(b), 'image/png')
  })
}

async function download() {
  busy.value = true
  note.value = ''
  try {
    const blob = await toBlob()
    if (!blob) { note.value = '浏览器没能生成图片，试试截图保存'; return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cyber-temple-${data.value.name.replace('#', '') || 'record'}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    note.value = '已保存到下载目录'
  } finally { busy.value = false }
}

async function shareImage() {
  busy.value = true
  note.value = ''
  try {
    const blob = await toBlob()
    if (!blob) { note.value = '浏览器没能生成图片，试试截图保存'; return }
    const file = new File([blob], 'cyber-temple.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '赛博禅寺 · 修行记录', text: '我的禅印，谁都能复算。' })
      return
    }
    await download()
    note.value = '当前浏览器不支持分享图片，已改为保存'
  } catch (err) {
    if (err?.name !== 'AbortError') note.value = '分享被拦下了，可以改用保存图片'
  } finally { busy.value = false }
}

async function copyLink() {
  const url = (typeof location !== 'undefined' ? location.origin : 'https://cyberbuddha.ai') + '/'
  try {
    await navigator.clipboard.writeText(url)
    note.value = '链接已复制'
  } catch {
    note.value = url
  }
}

/** 复制一段能直接发的文案：多数人不是不想发，是不知道写什么 */
async function copyPost() {
  const origin = (typeof location !== 'undefined' ? location.origin : 'https://cyberbuddha.ai') + '/'
  const text = buildPostText(data.value, { url: origin })
  try {
    await navigator.clipboard.writeText(text)
    note.value = '文案已复制 · 粘到微博 / X / 群里就能发'
  } catch {
    note.value = text
  }
}

/**
 * 下战帖：把最近一炷回执打包成一条链接。
 * 回执里写死了「第几炷 + 当日种子」，节拍表是纯函数算的 —— 对方点开就是同一张
 * 六十四拍，不需要房间、配对或服务器。战帖比分享图强的地方就在这里：图只能看，
 * 链接能按。
 */
async function copyDuel() {
  const s = last.value
  if (!s?.text) {
    note.value = '先敲满一炷，才有能被复算的回执'
    return
  }
  const d = makeDuel({ sealText: s.text, name: data.value.name })
  if (!d) {
    note.value = '战帖生成失败：这张回执可能不完整，再敲一炷试试'
    return
  }
  const origin = typeof location !== 'undefined' ? location.origin : 'https://cyberbuddha.ai'
  const url = duelUrl(d.text, origin)
  const text = `我在赛博禅寺第 ${s.round} 炷敲出 ${Math.round(s.accuracy * 100)}% 合拍率。同一张六十四拍，点开就是同一炷，成绩当场能复算：${url}`
  try {
    await navigator.clipboard.writeText(text)
    note.value = '战帖已复制 · 贴到群里就是一条可点的链接'
  } catch {
    note.value = url
  }
}
</script>

<template>
  <div class="sc-mask" @click.self="emit('close')">
    <div class="sc-modal">
      <div class="sc-head">
        <span class="panel-title">SHARE · 修行记录</span>
        <button class="sc-x clickable" @click="emit('close')">✕</button>
      </div>

      <div class="sc-stage">
        <canvas ref="canvas" class="sc-canvas"></canvas>
      </div>

      <div class="sc-actions">
        <button class="seal-primary clickable" :disabled="busy" @click="shareImage">分享图片</button>
        <button class="sc-duel clickable" :disabled="busy" @click="copyDuel">下战帖 · 同一炷</button>
        <button class="seal-ghost clickable" :disabled="busy" @click="download">保存图片</button>
        <button class="seal-ghost clickable" @click="copyPost">复制文案</button>
        <button class="seal-ghost clickable" @click="copyLink">复制链接</button>
      </div>

      <p class="sc-note">
        战帖这条链接里装着最近一炷的回执：第几炷、当日种子、六十四拍判定。
        对方点开就重建同一张节拍表 —— 一题两答，谁也没法事后改分数。
        卡上只有法号、功德与禅印短码，不含私钥。
      </p>
      <p v-if="note" class="sc-flash">{{ note }}</p>
    </div>
  </div>
</template>
