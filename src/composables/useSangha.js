/**
 * 共修网络的状态层：负责心跳、拉取、合并、广播，以及诚实的状态标记。
 *
 * 三条原则：
 *  1. 联网成功 = 真实在场 / 真实愿单；连不上 = 明确标「演示」，绝不用模拟数据
 *     冒充「现在有 1480 人在线」。
 *  2. 广播失败不假装成功：发愿、接单、送达都会返回真实结果，UI 照实显示。
 *  3. 心跳只在页面可见时发，切到后台就停 —— 免得白刷公告板限流。
 */
import { reactive, ref, computed, watch } from 'vue'
import { pullRecords, publishRecord } from '../temple/bulletin.js'
import {
  SANGHA_TOPIC, HEARTBEAT_MS, PRESENCE_WINDOW_MS,
  makePresence, makeWish, makeJoin, makeDeliver,
  parseSangha, aggregate, verifySangha, soulName, shortPub, wishId, signText
} from '../temple/sangha.js'
import { signMessage, verifyMessage } from '../temple/identity.js'

export const SANGHA_KEY = 'cyber-temple-sangha-v1'
const POLL_MS = 22000
const KEEP = 600

function loadCache() {
  try {
    const raw = localStorage.getItem(SANGHA_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(-KEEP) : []
  } catch { return [] }
}

function saveCache(texts) {
  try { localStorage.setItem(SANGHA_KEY, JSON.stringify(texts.slice(-KEEP))) } catch { /* 存不下就只留内存 */ }
}

/**
 * @param opts.id      useLedger 实例（要它的 identity 来签名）
 * @param opts.probe   () => ({ wishId, hits })  当前正在诵哪条愿、这炷替它敲了多少
 * @param opts.onEvent (type, payload) 交给上层写日志/提示
 */
export function useSangha({ id, probe, onEvent } = {}) {
  const texts = ref(loadCache())
  /** 'idle' 未联网 | 'live' 已连上真实公告板 | 'offline' 连过但这次失败 */
  const status = ref('idle')
  const statusText = ref('未连接')
  const lastPull = ref(0)
  const lastBeat = ref(0)
  const beats = ref(0)
  const reason = ref('')
  const busy = ref('')
  const known = ref(0)
  /** 被限流后的退避窗口：公告板说了「太快」，就别继续每秒去撞门 */
  const cooldownUntil = ref(0)
  const cooling = ref(false)

  let pollTimer = 0
  let beatTimer = 0
  let stopped = true

  const items = computed(() => texts.value.map(parseSangha).filter(Boolean))
  const selfPub = computed(() => (id?.identity?.pub || ''))

  const agg = computed(() => aggregate(items.value, { selfPub: selfPub.value }))
  const online = computed(() => agg.value.online)
  const souls = computed(() => agg.value.souls)
  const wishes = computed(() => agg.value.wishes)
  const reputation = computed(() => agg.value.reputation)

  const live = computed(() => status.value === 'live')

  function absorb(list) {
    if (!list?.length) return 0
    const have = new Set(texts.value)
    let added = 0
    for (const m of list) {
      const s = String(m || '').trim()
      if (!s || have.has(s)) continue
      if (!parseSangha(s)) continue
      have.add(s)
      texts.value.push(s)
      added += 1
    }
    if (added) {
      if (texts.value.length > KEEP) texts.value = texts.value.slice(-KEEP)
      saveCache(texts.value)
    }
    return added
  }

  async function pull(opts = {}) {
    const quiet = opts.quiet === true
    if (!quiet && Date.now() < cooldownUntil.value) {
      return { ok: false, reason: '公告板限流中，稍后再试', added: 0 }
    }
    const r = await pullRecords({ topic: SANGHA_TOPIC, since: opts.since || '2h' })
    if (!r.ok) {
      const limited = (r.relays || []).some((x) => /429/.test(String(x.reason)))
      if (limited) {
        cooldownUntil.value = Date.now() + 45000
        cooling.value = true
      }
      status.value = 'offline'
      statusText.value = limited ? '公告板限流，稍后自动重试' : (r.reason || '连不上公告板')
      reason.value = r.reason || ''
      return { ok: false, reason: r.reason, added: 0 }
    }
    cooling.value = false
    cooldownUntil.value = 0
    const added = absorb(r.messages)
    status.value = 'live'
    statusText.value = '已接上公共公告板'
    reason.value = ''
    lastPull.value = Date.now()
    known.value = r.count || 0
    if (added && !quiet) onEvent?.('pull', { added })
    return { ok: true, added, total: r.count || 0 }
  }

  async function publish(text, kind) {
    const r = await publishRecord(text, { topic: SANGHA_TOPIC })
    if (r.ok) {
      absorb([text])
      status.value = 'live'
      cooling.value = false
    } else if (r.status === 429) {
      cooldownUntil.value = Date.now() + Math.max(20000, (r.retryAfter || 0) * 1000)
      cooling.value = true
    }
    return { ...r, kind }
  }

  /** 心跳：我在场、我在诵哪条愿、给这条愿敲了多少 */
  async function beat(force = false) {
    const me = id?.identity
    if (!me || !me.priv) return { ok: false, reason: '还没有法号' }
    if (typeof document !== 'undefined' && document.hidden && !force) return { ok: false, reason: '页面在后台，暂不心跳' }
    if (!force && Date.now() < cooldownUntil.value) return { ok: false, reason: '公告板限流中，跳过这次心跳' }
    if (!force && Date.now() - lastBeat.value < HEARTBEAT_MS - 2000) return { ok: false, reason: '太频繁' }

    const f = typeof probe === 'function' ? (probe() || {}) : {}
    const at = Date.now()
    const sec = Math.floor(at / 1000)
    const wid = f.wishId || ''
    const hits = Math.max(0, Math.floor(f.hits || 0))
    const dayHits = Math.max(0, Math.floor(f.dayHits || 0))
    const sig = await signMessage(me.priv, signText.presence({
      pub: me.pub, at: sec, wishId: wid, hits, dayHits
    }))
    if (!sig) return { ok: false, reason: '签名失败' }

    const rec = makePresence({ pub: me.pub, sig, at, wishId: wid, hits, dayHits })
    lastBeat.value = at
    beats.value += 1
    const r = await publish(rec.text, 'presence')
    return r
  }

  async function postWish({ text, bounty, need }) {
    const me = id?.identity
    if (!me?.priv) return { ok: false, reason: '还没有法号' }
    busy.value = 'post'
    try {
      const at = Date.now()
      const sec = Math.floor(at / 1000)
      const wid = wishId({ text, bounty, need, at: sec, pub: me.pub })
      const sig = await signMessage(me.priv, signText.wish({ id: wid, wish: text, bounty, need, at: sec }))
      if (!sig) return { ok: false, reason: '签名失败' }
      const rec = makeWish({ pub: me.pub, sig, text, bounty, need, at })
      const r = await publish(rec.text, 'wish')
      return { ...r, id: rec.id }
    } finally { busy.value = '' }
  }

  async function join(wish) {
    const me = id?.identity
    if (!me?.priv || !wish) return { ok: false, reason: '还没有法号' }
    const at = Date.now()
    const sec = Math.floor(at / 1000)
    const sig = await signMessage(me.priv, signText.join({ wishId: wish.id, pub: me.pub, at: sec }))
    if (!sig) return { ok: false, reason: '签名失败' }
    return publish(makeJoin({ pub: me.pub, sig, wishId: wish.id, at }).text, 'join')
  }

  async function deliver(wish, { hits = 0, sealShort = '' } = {}) {
    const me = id?.identity
    if (!me?.priv || !wish) return { ok: false, reason: '还没有法号' }
    const at = Date.now()
    const sec = Math.floor(at / 1000)
    const sig = await signMessage(me.priv, signText.deliver({
      wishId: wish.id, pub: me.pub, hits, sealShort, at: sec
    }))
    if (!sig) return { ok: false, reason: '签名失败' }
    return publish(makeDeliver({ pub: me.pub, sig, wishId: wish.id, hits, sealShort, at }).text, 'deliver')
  }

  /** 逐张验证公告板上的签名，用来回答「这些人是不是真的存在」 */
  async function audit() {
    const v = await verifySangha(items.value, { verify: verifyMessage })
    return v
  }

  function start() {
    if (!stopped) return
    stopped = false
    const tick = async () => {
      await pull({ quiet: true })
      await beat()
    }
    pollTimer = setInterval(() => { pull({ quiet: true }) }, POLL_MS)
    beatTimer = setInterval(() => { beat() }, HEARTBEAT_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible)
    }
    tick()
  }

  function onVisible() {
    if (!document.hidden) { pull({ quiet: true }); beat() }
  }

  function stop() {
    stopped = true
    clearInterval(pollTimer)
    clearInterval(beatTimer)
    pollTimer = 0
    beatTimer = 0
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }

  function reset() {
    texts.value = []
    saveCache([])
    status.value = 'idle'
    statusText.value = '未连接'
    lastPull.value = 0
    lastBeat.value = 0
    beats.value = 0
  }

  return reactive({
    texts, items, agg, online, souls, wishes, reputation, selfPub,
    status, statusText, live, reason, lastPull, lastBeat, beats, busy, known, cooling,
    pull, beat, postWish, join, deliver, audit, start, stop, reset,
    soulName, shortPub
  })
}
