/**
 * 公共公告板 —— 功德流水与共修消息的「公告栏」，不归项目方管。
 *
 * 用 ntfy 的公开 topic：不需要账号、不需要密钥、浏览器直连（CORS 全开），
 * 任何人可读、任何人可写。它只负责广播，不做裁决 —— 一条消息合法不合法，
 * 完全由客户端按开源规则自己验。
 *
 * 为什么不做成「自己的服务器」：项目的前提是没有项目方。只要写入口在某个
 * 域名后面，那个域名的主人就能审查、能改、能关。挂在公共公告板上，
 * 最坏情况是消息被删或过期，而不是账本被单方面改写。
 *
 * 为什么要多个中继：单点会限流（免费实例按来访 IP 算配额），也会挂。
 * 发的时候按顺序试，哪个通了算哪个；读的时候全部读一遍再合并去重。
 * 代价是同一条消息可能被重复读到，所以上层一律按内容去重。
 *
 * 诚实的限制：
 *  - 免费公告板的消息只保留有限时间（实测约 12 小时），过期就没了。
 *    所以它适合「最近一笔」的即时广播，长期账本要靠导出/互相镜像。
 *  - 不同中继之间不互通：A 发在 ntfy.sh、B 只读 envs.net，就互相看不见。
 *    所以默认「全都发、全都读」，而不是挑一个。
 *  - 单一中继可以被审查（删消息）。删得掉「看见」，删不掉「你手里那份」。
 */
export const BULLETIN_TOPIC = 'cyberbuddha-merit-v1'

export const RELAYS = [
  { base: 'https://ntfy.sh', host: 'ntfy.sh' },
  { base: 'https://ntfy.envs.net', host: 'ntfy.envs.net' },
  { base: 'https://ntfy.mzte.de', host: 'ntfy.mzte.de' }
]

/** 兼容旧引用 */
export const BULLETIN_BASE = RELAYS[0].base
export const BULLETIN_HOST = RELAYS[0].host

function timed(ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, ms))
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

/* ------------------------------------------------------------------ *
 * 中继健康表：免费公共实例按来访 IP 限流，且「读配额」与「写配额」是分开的
 * （实测 ntfy.sh 会先耗尽当日消息配额，读却照常）。所以读写各记一张表 ——
 * 否则一次成功的读会顺手清掉写的惩罚，导致每次心跳都先撞一次 429 再换家中继。
 *
 * 策略是把请求量压到最低：
 *  - 平时只找第一个健康的中继读一次，成功就停（不再三路并发）
 *  - 只有周期性全量对齐时才读全部（否则别的中继上发的消息永远看不到）
 *  - 429 按 30s 起翻倍退避，成功后清零
 * 这张表只在内存里，刷新即忘 —— 不给用户留「上次被封」的包袱。
 * ------------------------------------------------------------------ */
const health = { read: new Map(), write: new Map() }

function slot(host, kind) {
  const map = health[kind] || health.read
  let h = map.get(host)
  if (!h) {
    h = { host, fails: 0, failUntil: 0, lastOk: 0, lastStatus: 0 }
    map.set(host, h)
  }
  return h
}

function markOk(host, kind) {
  const h = slot(host, kind)
  h.fails = 0
  h.failUntil = 0
  h.lastOk = Date.now()
  h.lastStatus = 200
}

function markBad(host, kind, status) {
  const h = slot(host, kind)
  h.fails += 1
  h.lastStatus = Number(status) || 0
  // 429 是明确的「太快了 / 配额用完」，退避更久；连不上或 5xx 稍短
  const base = Number(status) === 429 ? 30000 : 12000
  const wait = Math.min(base * 2 ** Math.min(4, h.fails - 1), 300000)
  h.failUntil = Date.now() + wait
}

/** 给 UI 用：一次看清每家读写两条线各自的状态 */
export function relayHealth() {
  return RELAYS.map((r) => {
    const rd = slot(r.host, 'read')
    const wr = slot(r.host, 'write')
    return {
      host: r.host,
      readUntil: rd.failUntil, writeUntil: wr.failUntil,
      readFails: rd.fails, writeFails: wr.fails,
      lastOk: Math.max(rd.lastOk, wr.lastOk), lastStatus: wr.lastStatus || rd.lastStatus
    }
  })
}

export function resetRelayHealth() {
  health.read.clear()
  health.write.clear()
}

/** 健康的排前面；全在冷却时按「最早解封」排，避免一次撞三门 */
function orderRelays(relays, kind = 'read') {
  const now = Date.now()
  return relays.slice().sort((a, b) => {
    const ha = slot(a.host, kind)
    const hb = slot(b.host, kind)
    const ca = ha.failUntil > now ? ha.failUntil : 0
    const cb = hb.failUntil > now ? hb.failUntil : 0
    if (ca !== cb) return ca - cb
    return (hb.lastOk || 0) - (ha.lastOk || 0)
  })
}

async function postOne(fetchImpl, base, topic, body, timeoutMs) {
  const t = timed(timeoutMs)
  try {
    const res = await fetchImpl(`${base}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: t.signal
    })
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.('retry-after')) || 0
      const hint = res.status === 429 ? '发布太快，等十几秒再试' : `公告板拒绝（HTTP ${res.status}）`
      return { ok: false, reason: hint, status: res.status, retryAfter }
    }
    const json = await res.json().catch(() => null)
    return {
      ok: true,
      id: typeof json?.id === 'string' ? json.id : '',
      at: Number(json?.time) || 0,
      base
    }
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? '公告板响应超时' : '连不上公告板' }
  } finally {
    t.done()
  }
}

/**
 * 发一条消息：依次尝试各中继，第一个成功就返回。
 * 全部失败时如实返回最后一个原因，绝不假装发出去了。
 */
export async function publishRecord(text, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    topic = BULLETIN_TOPIC,
    relays = RELAYS,
    timeoutMs = 9000
  } = opts
  const body = typeof text === 'string' ? text.trim() : ''
  if (!body) return { ok: false, reason: '没有可发布的内容' }
  if (body.length > 3800) return { ok: false, reason: '这条消息太长，公告板单条上限 4KB' }
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '当前环境不支持网络请求' }

  let last = { ok: false, reason: '没有可用的公告板' }
  let tried = 0
  for (const r of orderRelays(relays, 'write')) {
    // 全都在冷却时，只试最早解封的那一个，别一次把三个门都撞一遍
    if (tried >= 1 && relays.every((x) => slot(x.host, 'write').failUntil > Date.now())) break
    tried += 1
    const out = await postOne(fetchImpl, r.base, topic, body, timeoutMs)
    if (out.ok) {
      markOk(r.host, 'write')
      return { ...out, relay: r.host, tried }
    }
    markBad(r.host, 'write', out.status)
    last = { ...out, relay: r.host }
    // 内容本身有问题（4xx 但不是限流）就没必要再换中继
    if (out.status && out.status !== 429 && out.status < 500) break
  }
  return last
}

/**
 * 读最近的的消息。
 *
 * mode = 'fast'（默认）：按中继健康度串行试，第一个通了就收工 —— 一次轮询
 *   只花一个请求，这是把限流风险压下去的关键。
 * mode = 'full'：并行读所有没在冷却的中继，用于周期性对齐（否则发在别的
 *   中继上的消息永远看不到）。少一次请求比多看见一条更重要，所以默认不做。
 *
 * 只要有一个中继成功就算成功（局部可用好过整体失败），并报告谁挂了。
 */
export async function pullRecords(opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    topic = BULLETIN_TOPIC,
    relays = RELAYS,
    since = '24h',
    mode = 'fast',
    timeoutMs = 9000
  } = opts
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '当前环境不支持网络请求', messages: [] }

  const one = async (base, host) => {
    const t = timed(timeoutMs)
    try {
      const url = `${base}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`
      const res = await fetchImpl(url, { signal: t.signal })
      if (!res.ok) {
        markBad(host, 'read', res.status)
        return { host, ok: false, reason: `HTTP ${res.status}`, status: res.status, messages: [] }
      }
      markOk(host, 'read')
      const raw = await res.text()
      const messages = []
      for (const line of raw.split('\n')) {
        const s = line.trim()
        if (!s) continue
        try {
          const m = JSON.parse(s)
          if (m && m.event === 'message' && typeof m.message === 'string') messages.push(m.message)
        } catch { /* 单行坏了就跳过，不整批作废 */ }
      }
      return { host, ok: true, messages }
    } catch (err) {
      markBad(host, 'read', 0)
      return { host, ok: false, reason: err?.name === 'AbortError' ? '超时' : '连不上', messages: [] }
    } finally {
      t.done()
    }
  }

  const ordered = orderRelays(relays, 'read')
  const results = []
  if (mode === 'full') {
    const now = Date.now()
    const ready = ordered.filter((r) => slot(r.host, 'read').failUntil <= now)
    const use = ready.length ? ready : ordered.slice(0, 1)
    results.push(...(await Promise.all(use.map((r) => one(r.base, r.host)))))
  } else {
    for (const r of ordered.slice(0, 2)) {
      const out = await one(r.base, r.host)
      results.push(out)
      if (out.ok) break
    }
  }

  const seen = new Set()
  const messages = []
  for (const r of results) {
    for (const m of r.messages) {
      if (seen.has(m)) continue
      seen.add(m)
      messages.push(m)
    }
  }
  const okCount = results.filter((r) => r.ok).length
  if (!okCount) {
    const first = results.find((r) => !r.ok)
    const limited = results.some((r) => Number(r.status) === 429)
    return {
      ok: false,
      reason: limited ? '公告板限流（429）' : (first?.reason || '连不上公告板'),
      limited,
      messages: [],
      mode,
      relays: results
    }
  }
  return {
    ok: true,
    messages,
    count: messages.length,
    host: results.filter((r) => r.ok).map((r) => r.host).join(' / '),
    mode,
    relays: results
  }
}
