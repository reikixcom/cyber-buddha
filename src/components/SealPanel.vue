<script setup>
import { ref, computed, watch } from 'vue'
import { verifySeal, verifyChain, packLedger, unpackLedger } from '../temple/seal.js'
import { nameOf } from '../temple/ledger.js'
import { snapshotPractice, sanitizePracticeSave, STORE_KEY } from '../temple/save.js'
import {
  fetchDayBeacon, checkSealBeacon, beaconPublicUrl,
  utcDayKey, cacheBeacon, BEACON_RELAYS
} from '../temple/beacon.js'

const props = defineProps({
  p: { type: Object, required: true },
  l: { type: Object, required: true }
})

const tab = ref('seals')
const note = ref('')
const verifyInput = ref('')
const verifyResult = ref(null)
const beaconCheck = ref(null)
const beaconBusy = ref(false)
const exportText = ref('')
const importText = ref('')
const ledgerPreview = ref(null)
const ledgerError = ref('')
const armed = ref(false)

/* ---------------- 功德票 ---------------- */
const chargeFor = ref('')
const chargeTo = ref('')
const chargeNote = ref('')
const flowNote = ref('')
const flowExport = ref('')
const flowInput = ref('')
const idText = ref('')
const idBusy = ref(false)

const myNotes = computed(() => props.l.myTickets)
const incomingNotes = computed(() => props.l.receivable)
const conflicts = computed(() => props.l.audit?.conflicts || [])
const conflictTickets = computed(() => new Set(conflicts.value.map((c) => c.ticket)))
const soldAll = computed(() => props.l.records.some((t) => String(t).startsWith('CTX1.')))
const KIND_NAME = {
  'double-spend': '双花',
  'claim-conflict': '重复认领',
  'not-holder': '越权转让',
  orphan: '孤链',
  'broken-link': '链断裂'
}
const kindName = (k) => KIND_NAME[k] || k
const holderName = (pub) => nameOf(pub)

function openCharge(short) {
  chargeFor.value = chargeFor.value === short ? '' : short
  chargeTo.value = ''
  chargeNote.value = ''
  flowNote.value = ''
}

async function doCharge() {
  if (idBusy.value) return
  idBusy.value = true
  try {
    const r = await props.l.transfer(chargeFor.value, chargeTo.value, chargeNote.value)
    if (!r.ok) { flowNote.value = r.reason; return }
    flowNote.value = r.published
      ? '已转出并广播到公共公告板'
      : `已转出，但没广播：${r.publishReason}（流水在本机，可整包导出给对方）`
    chargeFor.value = ''
    chargeTo.value = ''
    chargeNote.value = ''
  } finally {
    idBusy.value = false
  }
}

async function doRedeem(short) {
  if (idBusy.value) return
  idBusy.value = true
  try {
    const r = await props.l.redeem(short)
    flowNote.value = r.ok ? `凭票入账 +${r.amount} $G` : r.reason
  } finally {
    idBusy.value = false
  }
}

async function doPull() {
  if (idBusy.value) return
  idBusy.value = true
  try {
    const r = await props.l.pull()
    if (!r.ok) { flowNote.value = r.reason; return }
    flowNote.value = `公共流水已同步 · 新增 ${r.added} 条${r.junk ? ` · 忽略 ${r.junk} 条无关消息` : ''}`
  } finally {
    idBusy.value = false
  }
}

async function doImportFlow() {
  if (idBusy.value) return
  idBusy.value = true
  try {
    const r = await props.l.importFlow(flowInput.value)
    flowNote.value = r.ok
      ? (r.added ? `已导入 ${r.added} 条流水，重新审计完成` : `这些流水本来就有（共 ${r.total} 条），没有新增`)
      : r.reason
  } finally {
    idBusy.value = false
  }
}

function doExportFlow() {
  flowExport.value = props.l.exportBundle()
  flash('整本流水已打包 · 复制给对方就能对账')
}

function showBackup() {
  idText.value = props.l.myBackup()
  flowNote.value = '这串含私钥，别贴到群里；只在自己设备间搬运用'
}

async function restoreId() {
  if (idBusy.value) return
  idBusy.value = true
  try {
    const r = await props.l.restoreIdentity(idText.value)
    flowNote.value = r.ok ? `法号已恢复 · ${r.name}` : r.reason
  } finally {
    idBusy.value = false
  }
}

const seals = computed(() => props.p.seals
  .map((t) => verifySeal(t))
  .filter((v) => v.ok)
  .map((v) => v.seal)
  .reverse()
)
// 本机只留最近 24 张，第一张的前序已被裁掉，跳过它的 prev 检查即可
const chainState = computed(() => verifyChain(props.p.seals, { ignoreFirstPrev: true }))
const beacon = computed(() => props.p.beacon || null)
const beaconSeedHex = computed(() => (beacon.value?.seed ?? 0).toString(16).padStart(8, '0'))
const beaconLabel = computed(() => {
  const b = beacon.value
  if (!b) return '本机弱验证'
  if (b.status === 'public') return `${b.sources.length} 个独立端点一致`
  if (b.status === 'cached') return '本机缓存 · 待联网核对'
  return '本机弱验证'
})

const fmtDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))
  ? String(d)
  : String(d).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
const srcName = (s) => s === 'public' ? '信标' : s === 'local' ? '本机' : '旧版'
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
  beaconCheck.value = null
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

/** 手动重新同步当日信标：断网恢复后不用刷新整页 */
async function resync() {
  if (beaconBusy.value) return
  beaconBusy.value = true
  try {
    const b = await fetchDayBeacon(utcDayKey())
    if (b) {
      cacheBeacon(b)
      props.p.applyBeacon(b)
      flash(`公开信标已同步 · ${b.sources.length} 源一致`)
    } else {
      flash('仍未连通 · 本日保持本机弱验证')
    }
  } catch {
    flash('仍未连通 · 本日保持本机弱验证')
  } finally {
    beaconBusy.value = false
  }
}

/** 在线对账：拿验签结果里的日期与轮次，去多个独立中继查回同一个公开随机值 */
async function checkOnline() {
  const seal = verifyResult.value?.last
  if (!seal || beaconBusy.value) return
  beaconBusy.value = true
  beaconCheck.value = { pending: true, ok: false, reason: '正在向多个独立端点核对…' }
  try {
    beaconCheck.value = await checkSealBeacon(seal)
  } catch {
    beaconCheck.value = { ok: false, reason: '核对失败，请稍后重试' }
  } finally {
    beaconBusy.value = false
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

watch(verifyInput, () => { beaconCheck.value = null })
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
          敲完一炷香就出一张回执：第几炷、六十四拍判定、在场人数、该得多少功德，
          加一张短码串成链，改中间任何一张后面就接不上。当日功课种子取自 drand quicknet
          公开随机信标：别人贴进「验签」，既能离线按开源寺规重算，也能联网到官方端点对账。
        </p>

        <div class="seal-beacon" :class="beacon?.status === 'public' ? 'ok' : 'weak'">
          <span class="beacon-dot"></span>
          <div class="beacon-main">
            <b>当日功课种子 · {{ beacon?.status === 'public' ? 'drand quicknet 公开信标' : '本机弱验证' }}</b>
            <span v-if="beacon?.round">
              UTC {{ beacon.day }} · 第 {{ beacon.round }} 轮 · 种子 {{ beaconSeedHex }} · {{ beaconLabel }}
            </span>
            <span v-else>
              UTC {{ utcDayKey() }} · 连不上信标，回执会明确标注「本机」，绝不冒充公开随机值
            </span>
          </div>
          <button class="seal-ghost clickable" :disabled="beaconBusy" @click="resync">
            {{ beaconBusy ? '核对中…' : '重新同步' }}
          </button>
          <a v-if="beacon?.round" class="beacon-link" :href="beaconPublicUrl(beacon.round)" target="_blank" rel="noopener noreferrer">查该轮 ↗</a>
        </div>

        <div class="seal-tabs">
          <button class="seal-tab clickable" :class="{ on: tab === 'seals' }" @click="tab = 'seals'">本机回执 · {{ seals.length }}</button>
          <button class="seal-tab clickable" :class="{ on: tab === 'verify' }" @click="tab = 'verify'">验签</button>
          <button class="seal-tab clickable" :class="{ on: tab === 'notes' }" @click="tab = 'notes'">功德票 · {{ myNotes.length }}</button>
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
                <span class="seal-src" :class="s.source">{{ srcName(s.source) }}</span>
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
            <span class="seal-hint">第一层 · 离线可用，规则就在这份前端里</span>
          </div>
          <div v-if="verifyResult" class="seal-result" :class="verifyResult.ok ? 'ok' : 'bad'">
            <div class="seal-result-title">
              {{ verifyResult.ok ? '✓ ' : '✕ ' }}{{ verifyResult.reason }}
            </div>
            <div v-if="verifyResult.last" class="seal-detail">
              <span>第 <b>{{ verifyResult.last.round }}</b> 炷</span>
              <span>功课日 <b>{{ fmtDay(verifyResult.last.dayTag || verifyResult.last.daySeed) }}<template v-if="verifyResult.last.version === 2"> UTC</template></b></span>
              <span>合拍率 <b>{{ Math.round(verifyResult.last.accuracy * 100) }}%</b></span>
              <span>PERFECT <b>{{ verifyResult.last.perfect }}</b></span>
              <span>GOOD <b>{{ verifyResult.last.good }}</b></span>
              <span>MISS <b>{{ verifyResult.last.miss }}</b></span>
              <span>乱敲 <b>{{ verifyResult.last.wild }}</b></span>
              <span>在场 <b>{{ verifyResult.last.online }}</b></span>
              <span>应得 <b>{{ verifyResult.last.reward }} $G</b></span>
              <span>种子来源 <b>{{ srcName(verifyResult.last.source) }}</b></span>
              <span v-if="verifyResult.last.beaconRound">信标轮次 <b>{{ verifyResult.last.beaconRound }}</b></span>
              <span>短码 <b>{{ verifyResult.last.short }}</b></span>
            </div>
            <div v-if="verifyResult.count > 1" class="seal-hint">
              共 {{ verifyResult.count }} 张 · 上面显示的是最后一张的复算结果
            </div>
          </div>

          <div v-if="verifyResult?.last?.source === 'public'" class="seal-actions">
            <button class="seal-ghost clickable" :disabled="beaconBusy" @click="checkOnline">
              {{ beaconBusy ? '核对中…' : '核对公开信标' }}
            </button>
            <span class="seal-hint">第二层 · 需联网，并发查 {{ BEACON_RELAYS.length }} 个独立中继，至少 2 源一致才采信</span>
          </div>
          <div v-if="beaconCheck" class="seal-result" :class="beaconCheck.pending ? 'pending' : (beaconCheck.ok ? 'ok' : 'bad')">
            <div class="seal-result-title">
              {{ beaconCheck.pending ? '… ' : (beaconCheck.ok ? '✓ ' : '✕ ') }}{{ beaconCheck.reason }}
            </div>
            <div v-if="beaconCheck.ok" class="seal-detail">
              <span class="beacon-sources">采信端点 <b>{{ beaconCheck.beacon.sources.join(' / ') }}</b></span>
              <span>该轮随机值 <b>{{ beaconCheck.beacon.randomness.slice(0, 16) }}…</b></span>
            </div>
            <div v-if="beaconCheck.ok" class="seal-hint beacon-hint">
              <a class="beacon-link" :href="beaconPublicUrl(beaconCheck.beacon.round)" target="_blank" rel="noopener noreferrer">打开官方端点自行复核该轮签名 ↗</a>
            </div>
          </div>

          <div class="seal-note">
            边界说清楚：离线复算证明「这串记录按寺规该得这些功德」，在线对账证明「当日种子确实来自那一轮公开随机值」；
            两者都不证明「真人真的敲了」—— 原型没有服务端和可信时钟。前端不做 BLS 阈值签名验签，
            采信的是「至少两个独立中继一致」，需要免信任可用 drand 官方工具对签名完整验签。
            信标连不上时会明确降级并在回执里标「本机」，不冒充。
          </div>
        </div>

        <!-- 功德票 -->
        <div v-if="tab === 'notes'" class="seal-body">
          <div class="seal-beacon ok">
            <span class="beacon-dot"></span>
            <div class="beacon-main">
              <b>我的法号 · {{ l.identity?.name || '正在本机生成…' }}</b>
              <span>私钥只在这台设备上，转账靠它签名。换设备要用下面那串身份备份，别贴到群里。</span>
            </div>
            <button class="seal-ghost clickable" :disabled="!l.card" @click="copy(l.card, '收款码')">复制收款码</button>
            <button class="seal-ghost clickable" :disabled="!l.ready" @click="showBackup">身份备份</button>
          </div>

          <div class="seal-section-title">
            我的票 · {{ myNotes.length }} 张
            <span class="seal-hint">一张禅印 = 一张票，票面额固定，只能整张转</span>
          </div>
          <div v-if="myNotes.length" class="seal-list">
            <div v-for="t in myNotes" :key="t.short" class="seal-row">
              <div class="seal-row-main">
                <span class="seal-round">第 {{ t.round }} 炷</span>
                <span class="seal-reward">+{{ t.reward }} $G</span>
                <span class="seal-src" :class="t.source">{{ srcName(t.source) }}</span>
                <span v-if="t.implicit" class="note-chip">未认领</span>
                <span v-if="conflictTickets.has(t.short)" class="note-chip bad">有冲突</span>
                <span class="seal-time">{{ fmtTime(t.claimedAt) }}</span>
              </div>
              <div class="seal-row-sub">
                <span class="seal-short">{{ t.short }}</span>
                <span class="seal-prev">{{ t.history.length > 1 ? `已流转 ${t.history.length - 1} 次` : '在手，未转过' }}</span>
                <button class="seal-copy clickable" @click="openCharge(t.short)">{{ chargeFor === t.short ? '收起' : '转出这张' }}</button>
              </div>
              <div v-if="chargeFor === t.short" class="note-charge">
                <textarea
                  v-model="chargeTo" class="seal-textarea clickable" rows="2" data-role="charge-to"
                  placeholder="粘贴对方的收款码（CTP1. 开头，对方在「功德票」里复制）"
                ></textarea>
                <div class="note-charge-row">
                  <input v-model="chargeNote" class="note-input clickable" maxlength="18" placeholder="用途（可选，会公开）" />
                  <button class="seal-primary clickable" :disabled="idBusy" @click="doCharge">
                    签名转出 {{ t.reward }} $G
                  </button>
                </div>
                <div class="seal-hint">转出会从你的余额扣掉票面额，并广播一条带签名的转让单</div>
              </div>
            </div>
          </div>
          <div v-else class="seal-empty">
            {{ soldAll ? '名下的票都转出去了。再敲一炷，新票会自动认领。' : '还没有票。敲完一炷香会自动认领 —— 认领之后，这张票就能转给别人。' }}
          </div>

          <template v-if="incomingNotes.length">
            <div class="seal-section-title">待入账 · {{ incomingNotes.length }} 张</div>
            <div class="seal-list">
              <div v-for="t in incomingNotes" :key="t.short" class="seal-row">
                <div class="seal-row-main">
                  <span class="seal-round">第 {{ t.round }} 炷</span>
                  <span class="seal-reward">+{{ t.reward }} $G</span>
                  <span class="seal-pg">来自 {{ holderName(t.history[t.history.length - 1]?.from) }}</span>
                </div>
                <div class="seal-row-sub">
                  <span class="seal-short">{{ t.short }}</span>
                  <button class="seal-primary clickable" :disabled="idBusy" @click="doRedeem(t.short)">凭票入账</button>
                </div>
              </div>
            </div>
          </template>

          <div class="seal-section-title">公共流水 · 谁都能读，谁都能发</div>
          <div class="seal-actions">
            <button class="seal-ghost clickable" :disabled="idBusy" @click="doPull">
              {{ idBusy && l.busyText ? l.busyText : '拉取最近 24 小时' }}
            </button>
            <span class="seal-hint">ntfy.sh 公开公告板 · 免账号 · 拉到本地逐条验签</span>
          </div>
          <div class="seal-detail">
            <span>合并流水 <b>{{ l.records.length + l.incoming.length }}</b> 条</span>
            <span>有效票 <b>{{ l.stats.own + l.stats.receivable }}</b> 张</span>
            <span>冲突 <b>{{ conflicts.length }}</b> 处</span>
            <span>丢弃 <b>{{ l.stats.rejected }}</b> 条</span>
            <span v-if="l.lastPull">上次同步 <b>{{ l.lastPull }}</b></span>
          </div>

          <div v-if="conflicts.length" class="seal-result bad">
            <div class="seal-result-title">✕ 对账发现 {{ conflicts.length }} 处问题</div>
            <div v-for="c in conflicts.slice(0, 4)" :key="c.ticket + c.kind" class="seal-detail note-conflict">
              <span>票 <b>{{ c.ticket.slice(0, 8) }}…</b> · {{ kindName(c.kind) }}</span>
              <span>{{ c.detail }}</span>
            </div>
            <div class="seal-hint">同一张票被转给多个人，只有把两边的流水合到一起才看得出来 —— 这就是没有共识时要付的代价。</div>
          </div>
          <div v-if="flowNote" class="seal-flash note-flash">{{ flowNote }}</div>

          <div class="seal-section-title">整本流水 · 换设备，或给对方对账</div>
          <div class="seal-actions">
            <button class="seal-primary clickable" @click="doExportFlow">生成整包</button>
            <button v-if="flowExport" class="seal-ghost clickable" @click="copy(flowExport, '流水包')">复制流水包</button>
          </div>
          <textarea
            v-if="flowExport" class="seal-textarea clickable mono" rows="3" readonly
            :value="flowExport" @focus="$event.target.select()"
          ></textarea>
          <textarea
            v-model="flowInput" class="seal-textarea clickable" rows="3" data-role="flow-input"
            placeholder="粘贴对方的流水包（CTB1.）或几行 CTK1 / CTX1 流水"
          ></textarea>
          <div class="seal-actions">
            <button class="seal-ghost clickable" :disabled="idBusy" @click="doImportFlow">导入并重新审计</button>
            <span class="seal-hint">导入只合并流水，不会动你的余额</span>
          </div>

          <div v-if="idText" class="seal-section-title">身份备份 · 含私钥</div>
          <textarea v-if="idText" v-model="idText" class="seal-textarea clickable mono" rows="3"></textarea>
          <div v-if="idText" class="seal-actions">
            <button class="seal-ghost clickable" @click="copy(idText, '身份备份')">复制备份</button>
            <button class="seal-ghost clickable" :disabled="idBusy" @click="restoreId">用这串恢复法号</button>
          </div>

          <div class="seal-note">
            一张禅印就是一张票：票面额由寺规算出来，转手靠你的私钥签名。别人把流水贴进来，
            能验证票真不真、面额对不对、签名是不是本人；同一张票转给两个人，两边的流水一合并就会报双花。
            做不到的也讲清楚 —— 没有共识，只能事后发现、不能事前阻止；公告板的消息只留约 12 小时，
            长期的账本要靠大家互相导出镜像。
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
            <br />
            <b class="note-warn">功德票要另外搬：</b>「功德票 → 整本流水」的流水包 + 「身份备份」两样一起带走，
            才算把票也搬过去；只搬这份账本，票的归属会跟着旧法号留在旧设备上。
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
