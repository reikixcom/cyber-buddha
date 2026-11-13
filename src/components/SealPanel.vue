<script setup>
import { ref, computed, watch } from 'vue'
import { verifySeal, verifyChain, packLedger, unpackLedger } from '../temple/seal.js'
import { snapshotPractice, sanitizePracticeSave, STORE_KEY } from '../temple/save.js'

const props = defineProps({ p: { type: Object, required: true } })

const tab = ref('seals')
const note = ref('')
const verifyInput = ref('')
const verifyResult = ref(null)
const exportText = ref('')
const importText = ref('')
const ledgerPreview = ref(null)
const ledgerError = ref('')
const armed = ref(false)

const seals = computed(() => props.p.seals
  .map((t) => verifySeal(t))
  .filter((v) => v.ok)
  .map((v) => v.seal)
  .reverse()
)
// 本机只留最近 24 张，第一张的前序已被裁掉，跳过它的 prev 检查即可
const chainState = computed(() => verifyChain(props.p.seals, { ignoreFirstPrev: true }))

const fmtDay = (d) => String(d).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
function fmtTime(sec) {
  const d = new Date(sec * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function flash(msg) {
  note.value = msg
  setTimeout(() => { if (note.value === msg) note.value = '' }, 2200)
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { /* 不支持就让用户手动选 */ }
  document.body.removeChild(ta)
  return ok
}
async function copy(text, label) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else if (!fallbackCopy(text)) throw new Error('no clipboard')
    flash(`${label} · 已复制`)
  } catch {
    flash(fallbackCopy(text) ? `${label} · 已复制` : '复制失败，请手动全选文本框')
  }
}

function runVerify() {
  const lines = verifyInput.value.split(/\s+/).map((s) => s.trim()).filter(Boolean)
  if (!lines.length) {
    verifyResult.value = { ok: false, reason: '先把一张禅印回执粘进来', count: 0, seal: null }
    return
  }
  if (lines.length === 1) {
    const v = verifySeal(lines[0])
    verifyResult.value = { ...v, count: 1, last: v.seal }
    return
  }
  const c = verifyChain(lines)
  verifyResult.value = {
    ok: c.ok, reason: c.reason, count: c.items.length,
    seal: c.items[0] || null, last: c.items[c.items.length - 1] || null
  }
}

function makeLedger() {
  let raw = {}
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {} } catch { raw = {} }
  // 存档可能落后几秒，导出前用当前状态刷新一次共修快照
  raw.practice = snapshotPractice(props.p)
  exportText.value = packLedger(raw)
  flash('账本已生成 · 复制后可在另一台设备导入')
}

function checkLedger() {
  armed.value = false
  ledgerPreview.value = null
  const obj = unpackLedger(importText.value)
  if (!obj) { ledgerError.value = '校验码不符或格式不对 —— 文本可能被截断或改动'; return }
  if (typeof obj.merit !== 'number' || !Number.isFinite(obj.merit) || obj.merit < 0) {
    ledgerError.value = '账本里的功德余额不是合法数值'; return
  }
  const clean = obj.practice ? sanitizePracticeSave(obj.practice) : null
  ledgerError.value = ''
  ledgerPreview.value = {
    obj, clean,
    merit: Math.round(obj.merit),
    wishes: clean ? clean.wishes.length : 0,
    sealCount: clean ? clean.seals.length : 0,
    day: typeof obj.daily?.day === 'string' ? obj.daily.day : '—'
  }
}

function applyLedger() {
  if (!ledgerPreview.value) return
  if (!armed.value) { armed.value = true; flash('再点一次确认覆盖本机账本'); return }
  const next = { ...ledgerPreview.value.obj, practice: ledgerPreview.value.clean }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch {
    ledgerError.value = '本机存储不可用，无法导入'; return
  }
  location.reload()
}

watch(importText, () => { armed.value = false; ledgerPreview.value = null; ledgerError.value = '' })
</script>

<template>
  <Transition name="fade">
    <div v-if="p.showSeals" class="rules-backdrop clickable" @click.self="p.showSeals = false">
      <div class="seal-card panel">
        <div class="rules-head">
          <div>
            <div class="panel-title">ZEN SEAL · 禅印</div>
            <h2>一炷香，一张可复算的回执</h2>
          </div>
          <button class="rules-close clickable" @click="p.showSeals = false">×</button>
        </div>

        <p class="seal-intro">
          敲完一炷香就出一张回执：第几炷、六十四拍的判定、在场人数、该得多少功德，
          加上一张短码。短码像页码 —— 后一张写着前一张的短码，改中间任何一张，后面就接不上。
          别人把回执贴进「验签」，用同一份开源寺规重算节拍表和结算，对不上会直接指出哪里不对。
        </p>

        <div class="seal-tabs">
          <button class="seal-tab clickable" :class="{ on: tab === 'seals' }" @click="tab = 'seals'">本机回执 · {{ seals.length }}</button>
          <button class="seal-tab clickable" :class="{ on: tab === 'verify' }" @click="tab = 'verify'">验签</button>
          <button class="seal-tab clickable" :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">账本搬家</button>
        </div>

        <!-- 本机回执 -->
        <div v-if="tab === 'seals'" class="seal-body">
          <div v-if="seals.length" class="seal-chain" :class="{ bad: !chainState.ok }">
            <span class="chain-dot"></span>{{ chainState.ok ? chainState.reason : chainState.reason }}
            <em>本机只留最近 24 张，更早的短码会写在新回执里但不单独保留</em>
          </div>
          <div class="seal-list">
            <div v-for="s in seals" :key="s.short" class="seal-row">
              <div class="seal-row-main">
                <span class="seal-round">第 {{ s.round }} 炷</span>
                <span class="seal-acc">{{ Math.round(s.accuracy * 100) }}%</span>
                <span class="seal-reward">+{{ s.reward }} $G</span>
                <span class="seal-pg">{{ s.perfect }}P / {{ s.good }}G / {{ s.miss }}M</span>
                <span class="seal-time">{{ fmtTime(s.at) }}</span>
              </div>
              <div class="seal-row-sub">
                <span class="seal-short">{{ s.short }}</span>
                <span v-if="s.prev" class="seal-prev">← {{ s.prev }}</span>
                <span v-else class="seal-prev">链头</span>
                <button class="seal-copy clickable" @click="copy(s.text, `第 ${s.round} 炷回执`)">复制回执</button>
              </div>
            </div>
          </div>
          <div v-if="!seals.length" class="seal-empty">
            还没有回执。敲完第一炷香（约 25 秒）就会出第一张 —— 想验别人的，直接切到「验签」。
          </div>
        </div>

        <!-- 验签 -->
        <div v-if="tab === 'verify'" class="seal-body">
          <textarea
            v-model="verifyInput" class="seal-textarea clickable" rows="4"
            placeholder="粘贴一张禅印回执（CT1. 开头）… 多行可一次验一条链"
          ></textarea>
          <div class="seal-actions">
            <button class="seal-primary clickable" @click="runVerify">按寺规复算</button>
            <span class="seal-hint">不需要联网，规则就在这份前端里</span>
          </div>
          <div v-if="verifyResult" class="seal-result" :class="verifyResult.ok ? 'ok' : 'bad'">
            <div class="seal-result-title">
              {{ verifyResult.ok ? '✓ ' : '✕ ' }}{{ verifyResult.reason }}
            </div>
            <div v-if="verifyResult.last" class="seal-detail">
              <span>第 <b>{{ verifyResult.last.round }}</b> 炷</span>
              <span>日期 <b>{{ fmtDay(verifyResult.last.daySeed) }}</b></span>
              <span>合拍率 <b>{{ Math.round(verifyResult.last.accuracy * 100) }}%</b></span>
              <span>PERFECT <b>{{ verifyResult.last.perfect }}</b></span>
              <span>GOOD <b>{{ verifyResult.last.good }}</b></span>
              <span>MISS <b>{{ verifyResult.last.miss }}</b></span>
              <span>乱敲 <b>{{ verifyResult.last.wild }}</b></span>
              <span>在场 <b>{{ verifyResult.last.online }}</b></span>
              <span>应得 <b>{{ verifyResult.last.reward }} $G</b></span>
              <span>短码 <b>{{ verifyResult.last.short }}</b></span>
            </div>
            <div v-if="verifyResult.count > 1" class="seal-hint">
              共 {{ verifyResult.count }} 张 · 上面显示的是最后一张的复算结果
            </div>
          </div>
          <div class="seal-note">
            边界说清楚：验证的是「这串敲击记录按寺规该得这些功德」，不证明「真人真的敲了」——
            本地原型没有服务端和可信时钟。当前日期种子由本机生成，正式版换成公开随机信标即可，
            判定与结算逻辑一行都不用改。
          </div>
        </div>

        <!-- 账本 -->
        <div v-if="tab === 'ledger'" class="seal-body">
          <div class="seal-section-title">导出 · 换设备续修</div>
          <div class="seal-actions">
            <button class="seal-primary clickable" @click="makeLedger">生成本机账本</button>
            <button v-if="exportText" class="seal-ghost clickable" @click="copy(exportText, '账本')">复制账本</button>
            <span class="seal-hint">含余额、心愿托管、共诵击数与全部回执</span>
          </div>
          <textarea
            v-if="exportText" class="seal-textarea clickable mono" rows="3" readonly
            :value="exportText" @focus="$event.target.select()"
          ></textarea>

          <div class="seal-section-title">导入 · 覆盖这台设备的账本</div>
          <textarea
            v-model="importText" class="seal-textarea clickable" rows="3"
            placeholder="把另一台设备导出的账本（CTL1. 开头）贴进来"
          ></textarea>
          <div class="seal-actions">
            <button class="seal-ghost clickable" data-act="check-ledger" @click="checkLedger">校验账本</button>
            <button
              v-if="ledgerPreview" class="seal-primary clickable" :class="{ danger: armed }"
              data-act="apply-ledger" @click="applyLedger"
            >{{ armed ? '确认覆盖并重载' : '导入账本' }}</button>
          </div>
          <div v-if="ledgerError" class="seal-result bad"><div class="seal-result-title">✕ {{ ledgerError }}</div></div>
          <div v-if="ledgerPreview" class="seal-result ok">
            <div class="seal-result-title">✓ 账本校验通过 · 覆盖后页面会重新载入</div>
            <div class="seal-detail">
              <span>余额 <b>{{ ledgerPreview.merit }} $G</b></span>
              <span>心愿 <b>{{ ledgerPreview.wishes }}</b> 条</span>
              <span>回执 <b>{{ ledgerPreview.sealCount }}</b> 张</span>
              <span>账本日期 <b>{{ ledgerPreview.day }}</b></span>
            </div>
          </div>
          <div class="seal-note">
            校验码只防粘贴、转发、存档时把文本弄坏，不防自己改存档 —— 原型没有服务端，
            账本本来就存在你自己的浏览器里。导入会覆盖本机现有余额与心愿，先导出备份再操作。
          </div>
        </div>

        <div class="seal-foot">
          <span v-if="note" class="seal-flash">{{ note }}</span>
          <span v-else>敲木鱼就是出块 · 规则写在开源代码里，任何人可复算</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
