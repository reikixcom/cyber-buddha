/**
 * 公共公告板 —— 功德票流水的「公告栏」，不归项目方管。
 *
 * 用 ntfy.sh 的公开 topic：不需要账号、不需要密钥、浏览器直连（CORS 全开），
 * 任何人可读、任何人可写。它只负责广播，不做裁决 —— 一条流水合法不合法，
 * 完全由客户端按 ledger.js 的规则自己验。
 *
 * 为什么不做成「自己的服务器」：项目的前提是没有项目方。只要写入口在某个
 * 域名后面，那个域名的主人就能审查、能改、能关。挂在公共公告板上，
 * 最坏情况是消息被删或过期，而不是账本被单方面改写；而且谁都能把整本
 * 流水导出成 CTB1 文本自己镜像。
 *
 * 诚实的限制：
 *  - 免费公告板的消息只保留有限时间（实测约 12 小时），过期就没了。
 *    所以它适合「最近一笔转让」的即时广播，长期账本要靠导出/互相镜像。
 *  - 任何人都能往同一个 topic 发垃圾，客户端会逐条按规则过滤，坏的一条都不收。
 *  - 单一公告板可以被审查（删消息）。删得掉「看见」，删不掉「你手里那份」。
 */
export const BULLETIN_TOPIC = 'cyberbuddha-merit-v1'
export const BULLETIN_BASE = 'https://ntfy.sh'
export const BULLETIN_HOST = 'ntfy.sh'

function timed(ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, ms))
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

/** 发一条流水。返回 ok 才代表真的上了公告板，其余情况一律如实报原因 */
export async function publishRecord(text, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    topic = BULLETIN_TOPIC,
    base = BULLETIN_BASE,
    timeoutMs = 9000
  } = opts
  const body = typeof text === 'string' ? text.trim() : ''
  if (!body) return { ok: false, reason: '没有可发布的内容' }
  if (body.length > 3800) return { ok: false, reason: '这条流水太长，公告板单条上限 4KB' }
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '当前环境不支持网络请求' }

  const t = timed(timeoutMs)
  try {
    const res = await fetchImpl(`${base}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
      signal: t.signal
    })
    if (!res.ok) {
      const hint = res.status === 429 ? '发布太快，等十几秒再试' : `公告板拒绝（HTTP ${res.status}）`
      return { ok: false, reason: hint, status: res.status }
    }
    const json = await res.json().catch(() => null)
    return { ok: true, id: typeof json?.id === 'string' ? json.id : '', at: Number(json?.time) || 0 }
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? '公告板响应超时' : '连不上公告板' }
  } finally {
    t.done()
  }
}

/** 拉最近的消息。只取 text 消息，解析交给上层按流水规则过滤 */
export async function pullRecords(opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    topic = BULLETIN_TOPIC,
    base = BULLETIN_BASE,
    since = '24h',
    timeoutMs = 9000
  } = opts
  if (typeof fetchImpl !== 'function') return { ok: false, reason: '当前环境不支持网络请求', messages: [] }

  const t = timed(timeoutMs)
  try {
    const url = `${base}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`
    const res = await fetchImpl(url, { signal: t.signal })
    if (!res.ok) return { ok: false, reason: `公告板拒绝（HTTP ${res.status}）`, messages: [] }
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
    return { ok: true, messages, count: messages.length, host: BULLETIN_HOST }
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? '公告板响应超时' : '连不上公告板', messages: [] }
  } finally {
    t.done()
  }
}
