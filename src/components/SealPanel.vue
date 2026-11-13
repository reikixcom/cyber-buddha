<script setup>
import { ref, computed, watch } from 'vue'
import { verifySeal, verifyChain, packLedger, unpackLedger } from '../temple/seal.js'
import { snapshotPractice, sanitizePracticeSave, STORE_KEY } from '../temple/save.js'
import {
  fetchDayBeacon, checkSealBeacon, beaconPublicUrl,
  utcDayKey, cacheBeacon, BEACON_RELAYS
} from '../temple/beacon.js'

const props = defineProps({ p: { type: Object, required: true } })

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
