/**
 * 功德票账本 —— 状态层。
 *
 * 把 ledger.js 的纯规则接到玩法上：出印自动认领、选票转让、拉公共流水、
 * 合并后审计、凭「转给我」的票入账。所有验证都在本地完成，不依赖服务端。
 *
 * 记账口径（重要）：出印时功德已经加进余额，所以
 *   转让 = 从我的余额扣掉票面额，并把票的持有人改成对方；
 *   入账 = 对方把票转给我，我把票面额加进余额（一张票只能入账一次）。
 * 这样即使有人绕过界面直接改存档，双花也会在审计里露出来。
 */
import { ref, computed, reactive } from 'vue'
import { verifySeal } from '../temple/seal.js'
import {
  makeClaim, makeTransfer, makeCard, parseCard, parseRecord,
  packBundle, unpackBundle, auditLedger, cleanPurpose, nameOf,
  claimMessage, transferMessage
} from '../temple/ledger.js'
import {
  hasCrypto, loadIdentity, saveIdentity, createIdentity,
  signMessage, verifyMessage, packIdentity, unpackIdentity
} from '../temple/identity.js'
import { publishRecord, pullRecords } from '../temple/bulletin.js'

const FLOW_KEY = 'cyber-temple-merit-flow-v1'
const MAX_OWN = 240
const MAX_INCOMING = 480

const cleanList = (raw, max) => (Array.isArray(raw) ? raw : [])
  .filter((t) => typeof t === 'string' && parseRecord(t))
  .slice(-max)

function loadFlow() {
  try {
    const raw = JSON.parse(localStorage.getItem(FLOW_KEY) || '{}')
    return {
      records: cleanList(raw.records, MAX_OWN),
      incoming: cleanList(raw.incoming, MAX_INCOMING),
      redeemed: Array.isArray(raw.redeemed)
        ? raw.redeemed.filter((s) => /^[0-9a-f]{16}$/.test(s)).slice(-MAX_INCOMING)
        : []
    }
  } catch {
    return { records: [], incoming: [], redeemed: [] }
  }
}

export function useLedger({ merit, addBalance, pushLog, addToast }) {
  const boot = loadFlow()
  const identity = ref(null)
  const records = ref(boot.records)
  const incoming = ref(boot.incoming)
  const redeemed = ref(boot.redeemed)
  const audit = ref(null)
  const busy = ref(false)
  const busyText = ref('')
  const lastPull = ref('')
  const ready = computed(() => !!identity.value)
  const supported = hasCrypto()

  let idPromise = null

  function persist() {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify({
        v: 1,
        records: records.value.slice(-MAX_OWN),
        incoming: incoming.value.slice(-MAX_INCOMING),
        redeemed: redeemed.value.slice(-MAX_INCOMING)
      }))
    } catch { /* 隐私模式或配额满：内存里照常可用 */ }
  }

  async function refreshAudit() {
    audit.value = await auditLedger([...records.value, ...incoming.value], { verify: verifyMessage })
    return audit.value
  }

  async function ensureIdentity() {
    if (identity.value) return identity.value
    if (!supported) return null
    if (idPromise) return idPromise
    idPromise = (async () => {
      const existing = loadIdentity()
      if (existing) { identity.value = existing; return existing }
      const created = await createIdentity()
      if (created && saveIdentity(created)) {
        identity.value = created
        pushLog(`法号已生成 · ${created.name} 只存在本机`, true)
      }
      return created || null
    })()
    return idPromise
  }

  /** 出印即认领：把这张禅印绑定到本法号，别人才能确认票是谁的 */
  async function claim(sealText) {
    const v = verifySeal(sealText)
    if (!v.ok || v.seal.reward <= 0) return null
    const ticket = v.seal.short
    for (const t of records.value) {
      const r = parseRecord(t)
      if (r && r.kind === 'claim' && r.ticket === ticket) return null
    }
    const id = await ensureIdentity()
    if (!id) return null
    const sig = await signMessage(id.priv, claimMessage(ticket, id.pub))
    if (!sig) return null
    const rec = makeClaim({ pub: id.pub, sig, sealText })
    if (!rec) return null
    records.value = [...records.value, rec.text].slice(-MAX_OWN)
    persist()
    refreshAudit()
    return rec
  }

  const myTickets = computed(() => {
    const me = identity.value?.pub
    if (!me || !audit.value) return []
    return audit.value.tickets.filter((t) => {
      if (t.holder !== me) return false
      // 别人刚转来、还没入账的票只在「待入账」里出现，不在这里重复
      const transferred = t.history.some((h) => h.kind === 'transfer')
      return !transferred || redeemed.value.includes(t.short)
    })
  })

  /** 别人转给我、但还没入账的票 */
  const receivable = computed(() => {
    const me = identity.value?.pub
    if (!me || !audit.value) return []
    return audit.value.tickets.filter((t) =>
      t.holder === me &&
      t.history.some((h) => h.kind === 'transfer') &&
      !redeemed.value.includes(t.short))
  })

  const stats = computed(() => ({
    own: myTickets.value.length,
    receivable: receivable.value.length,
    incoming: incoming.value.length,
    conflicts: audit.value?.conflicts.length || 0,
    rejected: audit.value?.rejected.length || 0
  }))

  const card = computed(() => (identity.value ? makeCard(identity.value.pub) : ''))

  /** 给某张票找到它的票根（第一条认领里带的完整回执） */
  function sealTextOf(ticket) {
    for (const t of [...records.value, ...incoming.value]) {
      const r = parseRecord(t)
      if (r && r.ticket === ticket && r.sealText) return r.sealText
    }
    return ''
  }

  /** 这张票当前链尾的短码，转让时作为前序接上去 */
  function chainTail(ticket) {
    const t = audit.value?.tickets.find((x) => x.short === ticket)
    return t?.history?.length ? t.history[t.history.length - 1].short : ''
  }

  /** 这张票的认领声明：转出时一起带上，接收方只拿到一条转让单也能追溯来源 */
  function claimTextOf(ticket) {
    for (const t of [...records.value, ...incoming.value]) {
      const r = parseRecord(t)
      if (!r || r.ticket !== ticket) continue
      if (r.kind === 'claim') return r.text
      if (r.kind === 'transfer' && r.claimText) return r.claimText
    }
    return ''
  }

  /**
   * 把一张票整张转出去。只有票的当前持有人能转，签名不通过就不出流水。
   * 余额不足时拒绝：功德票不能凭空造，转出去的必须是自己已经拿到的。
   */
  async function transfer(ticket, cardOrPub, purpose = '') {
    if (busy.value) return { ok: false, reason: '上一笔还在处理' }
    const me = identity.value
    if (!me) return { ok: false, reason: '还没有法号，先刷新一次页面' }
    await refreshAudit()
    const row = audit.value?.tickets.find((t) => t.short === ticket)
    if (!row) return { ok: false, reason: '账本里找不到这张票' }
    if (row.holder !== me.pub) return { ok: false, reason: '这张票不在你名下，转不了' }
    const to = parseCard(cardOrPub) || (/^[A-Za-z0-9_-]{40,120}$/.test(String(cardOrPub).trim()) ? String(cardOrPub).trim() : '')
    if (!to) return { ok: false, reason: '收款码不对 —— 让对方在「功德票 → 我的收款码」里复制一整行' }
    if (to === me.pub) return { ok: false, reason: '转给自己不算转' }
    if (merit.value < row.reward) return { ok: false, reason: `余额不足：这张票面额 ${row.reward} $G，你现在只有 ${merit.value}` }

    busy.value = true
    busyText.value = '正在签名…'
    try {
      const sealText = sealTextOf(ticket)
      if (!sealText) return { ok: false, reason: '这张票的票根丢了，无法转让' }
      const prev = chainTail(ticket)
      if (!prev) return { ok: false, reason: '这张票的流转链不完整，先重新核对账本' }
      const at = Date.now()
      const p = cleanPurpose(purpose)
      const msg = transferMessage({ ticket, amount: row.reward, from: me.pub, to, purpose: p, at: Math.floor(at / 1000), prev })
      const sig = await signMessage(me.priv, msg)
      if (!sig) return { ok: false, reason: '签名失败，当前浏览器可能禁用了 Web Crypto' }
      const rec = makeTransfer({
        pub: me.pub, sig, sealText, claimText: claimTextOf(ticket),
        to, purpose: p, prev, at
      })
      if (!rec) return { ok: false, reason: '生成转让单失败' }

      addBalance(-row.reward, 'transfer')
      records.value = [...records.value, rec.text].slice(-MAX_OWN)
      persist()
      await refreshAudit()
      pushLog(`功德票已转出 · ${nameOf(to)} · ${row.reward} $G`, true)

      busyText.value = '正在广播…'
      const sent = await publishRecord(rec.text)
      if (sent.ok) pushLog('转让单已上公共公告板', true)
      else pushLog(`转让单未广播：${sent.reason}（仍在本机，可手动导出）`)
      return { ok: true, text: rec.text, published: sent.ok, publishReason: sent.reason || '' }
    } finally {
      busy.value = false
      busyText.value = ''
    }
  }

  /** 凭「转给我」的票入账；同一张票只能入账一次，重复点会被挡 */
  async function redeem(ticket) {
    if (busy.value) return { ok: false, reason: '上一笔还在处理' }
    const me = identity.value
    if (!me) return { ok: false, reason: '还没有法号' }
    if (redeemed.value.includes(ticket)) return { ok: false, reason: '这张票已经入过账了' }
    await refreshAudit()
    const row = audit.value?.tickets.find((t) => t.short === ticket)
    if (!row) return { ok: false, reason: '账本里找不到这张票' }
    if (row.holder !== me.pub) return { ok: false, reason: '这张票不在你名下' }
    if (!row.history.some((h) => h.kind === 'transfer')) return { ok: false, reason: '这是你自己出的票，不需要入账' }

    addBalance(row.reward, 'transfer')
    redeemed.value = [...redeemed.value, ticket].slice(-MAX_INCOMING)
    persist()
    pushLog(`凭票入账 · ${row.reward} $G · ${ticket}`, true)
    addToast(`功德 +${row.reward}`, `收到一张功德票 · ${ticket.slice(0, 6)}…`)
    return { ok: true, amount: row.reward }
  }

  /** 拉公共公告板，逐条按流水规则过滤，坏的直接丢 */
  async function pull() {
    if (busy.value) return { ok: false, reason: '正在处理' }
    busy.value = true
    busyText.value = '正在拉公共流水…'
    try {
      const res = await pullRecords({ since: '24h' })
      if (!res.ok) {
        pushLog(`公共流水未拉到：${res.reason}`)
        return { ok: false, reason: res.reason, added: 0 }
      }
      const known = new Set([...records.value, ...incoming.value])
      const fresh = []
      let junk = 0
      for (const m of res.messages) {
        const r = parseRecord(m)
        if (!r) { junk++; continue }
        if (known.has(r.text)) continue
        known.add(r.text)
        fresh.push(r.text)
      }
      if (fresh.length) {
        incoming.value = [...incoming.value, ...fresh].slice(-MAX_INCOMING)
        persist()
        await refreshAudit()
      }
      lastPull.value = new Date().toLocaleTimeString()
      pushLog(`公共流水已同步 · 新增 ${fresh.length} 条${junk ? ` · 忽略 ${junk} 条无关消息` : ''}`, fresh.length > 0)
      return { ok: true, added: fresh.length, junk, total: res.count }
    } finally {
      busy.value = false
      busyText.value = ''
    }
  }

  /** 导入别人的流水或整包账本：CTB1 整包、多行流水、单条都认 */
  async function importFlow(text) {
    const raw = String(text || '').trim()
    if (!raw) return { ok: false, reason: '先粘贴流水或账本包' }
    let list = []
    const bundle = unpackBundle(raw)
    if (bundle) list = bundle.records
    else {
      for (const part of raw.split(/\s+/)) {
        const r = parseRecord(part)
        if (r) list.push(r.text)
      }
    }
    if (!list.length) return { ok: false, reason: '没认出任何功德票流水 —— 应当是 CTK1 / CTX1 / CTB1 开头' }
    const known = new Set([...records.value, ...incoming.value])
    const fresh = list.filter((t) => !known.has(t))
    if (!fresh.length) return { ok: true, added: 0, total: list.length }
    incoming.value = [...incoming.value, ...fresh].slice(-MAX_INCOMING)
    persist()
    await refreshAudit()
    pushLog(`已导入 ${fresh.length} 条流水 · 合并后重新审计`, true)
    return { ok: true, added: fresh.length, total: list.length }
  }

  function exportBundle() {
    return packBundle([...records.value, ...incoming.value])
  }

  function myBackup() {
    return identity.value ? packIdentity(identity.value) : ''
  }

  async function restoreIdentity(text) {
    const id = unpackIdentity(text)
    if (!id) return { ok: false, reason: '身份备份格式不对或校验码不符' }
    if (!saveIdentity(id)) return { ok: false, reason: '本机存储不可用' }
    identity.value = id
    await refreshAudit()
    pushLog(`法号已恢复 · ${id.name}`, true)
    return { ok: true, name: id.name }
  }

  async function init() {
    await ensureIdentity()
    await refreshAudit()
    return identity.value
  }

  /** 账本清零：只清流水与入账记录，法号保留 —— 否则清零后旧票全变成别人的 */
  async function reset() {
    records.value = []
    incoming.value = []
    redeemed.value = []
    persist()
    await refreshAudit()
  }

  return reactive({
    identity, ready, supported, busy, busyText, lastPull,
    records, incoming, redeemed, audit, stats,
    myTickets, receivable, card,
    init, claim, transfer, redeem, pull, importFlow, exportBundle,
    myBackup, restoreIdentity, refreshAudit, reset, nameOf
  })
}
