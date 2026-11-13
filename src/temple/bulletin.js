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
  for (const r of relays) {
    const out = await postOne(fetchImpl, r.base, topic, body, timeoutMs)
    if (out.ok) return { ...out, relay: r.host, tried: relays.indexOf(r) + 1 }
    last = out
    // 内容本身有问题（4xx 但不是限流）就没必要再换中继
    if (out.status && out.status !== 429 && out.status < 500) break
  }
  return last
}

/**
 * 读最近的的消息：所有中继并行拉一遍，合并去重。
 * 只要有一个中继成功就算成功（局部可用好过整体失败），并报告谁挂了。
 */
export async function pullRecords(opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    topic = BULLETIN_TOPIC,
    relays = RELAYS,
    since = '24h',
    timeoutMs = 9000
  } = opts
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '当前环境不支持网络请求', messages: [] }

  const one = async (base, host) => {
    const t = timed(timeoutMs)
    try {
      const url = `${base}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`
      const res = await fetchImpl(url, { signal: t.signal })
      if (!res.ok) return { host, ok: false, reason: `HTTP ${res.status}`, messages: [] }
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
      return { host, ok: false, reason: err?.name === 'AbortError' ? '超时' : '连不上', messages: [] }
    } finally {
      t.done()
    }
  }

  const results = await Promise.all(relays.map((r) => one(r.base, r.host)))
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
    return { ok: false, reason: first?.reason || '连不上公告板', messages: [], relays: results }
  }
  return {
    ok: true,
    messages,
    count: messages.length,
    host: results.filter((r) => r.ok).map((r) => r.host).join(' / '),
    relays: results
  }
}
