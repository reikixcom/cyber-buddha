/**
 * $GONGDE 的发行台账与持仓快照。
 *
 * 这座寺不发币，也不打算由「项目方」发币。但「币」这个词要站得住，
 * 至少得能回答三个问题：一共发了多少、还剩多少、凭什么说这个数是真的。
 *
 * 前两个问题本地就能答（每一笔入账都过 addBalance，有累计器）。
 * 第三个问题是这一层真正的价值：把一本账打包成一条 CTA1 文本，
 * 里面每个数字都能顺着禅印与签到流水回查。谁要发币、做空投、做映射，
 * 名单只能照这个来 —— 改一个数就对不上摘要。
 *
 * 所以这里不承诺任何价值，只提供「可核对的持仓」。边界照旧：
 *  - 余额是本机的，签名只能证明「这个法号声称自己有这么多」；
 *  - 真正防伪要靠禅印本身（票根可复算）+ 社区互相镜像对账；
 *  - 合并多份快照时同一法号取最新一份，重复导出不会把总量灌水。
 *
 * 纯函数：不依赖 Vue / DOM / Web Crypto，Node 可测。
 */
import { sha256Hex, packRecord, unpackRecord, b64urlEncode, b64urlDecode } from './seal.js'

export const TOKEN = {
  symbol: 'GONGDE',
  ticker: '$G',
  /** 协议层写入的总量上限：2100 万，致敬那个「谁都改不了」的数字。 */
  cap: 21_000_000,
  decimals: 0
}

export const SNAP_PREFIX = 'CTA1'
export const SNAP_VERSION = 1
export const MAX_SNAP_TICKETS = 120
export const MAX_SNAP_BALANCE = 1e9

const PUB_RE = /^[A-Za-z0-9_-]{40,120}$/
const TICKET_RE = /^[0-9a-f]{16}$/
const NAME_RE = /^#[0-9a-f]{6}$/

const num = (v, cap = MAX_SNAP_BALANCE) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(cap, Math.round(n))) : 0
}

/**
 * 发行台账。三个数字构成一条完整的生命线：
 *   修行所得（issued）→ 当前余额（balance）→ 亲手转出（sent）
 * 差额里还包含「心愿托管中」的部分，那是被锁住但没消失的币，所以不叫亏损。
 */
export function bookOf({ issued = 0, balance = 0, sent = 0, received = 0, tickets = 0, seals = 0 } = {}) {
  const is = num(issued, 1e12)
  const bal = num(balance)
  const se = num(sent, 1e12)
  const re = num(received, 1e12)
  const cap = TOKEN.cap
  return {
    issued: is,
    balance: bal,
    sent: se,
    received: re,
    tickets: num(tickets, 1e6),
    seals: num(seals, 1e6),
    cap,
    /** 个人余额占协议上限的比例：小到看不见才正常，它说明「没人能印」 */
    pctOfCap: cap > 0 ? Math.min(1, bal / cap) : 0,
    perSeal: num(seals) > 0 ? Math.round(is / num(seals)) : 0,
    /** 只用来展示「币有没有落到别人手里」 */
    givenAway: se > 0 ? Math.min(1, se / Math.max(1, is)) : 0
  }
}

/**
 * 把一本账打成一条可核对的持仓快照。
 * 票只带票号与面额 —— 票根那种长文本留给禅印面板，快照要短到能贴进群里。
 */
export function packSnapshot({ pub, name = '', balance = 0, issued = 0, sent = 0, received = 0, tickets = [], at = Date.now() } = {}) {
  if (!PUB_RE.test(String(pub))) return null
  const list = (Array.isArray(tickets) ? tickets : [])
    .map((t) => (typeof t === 'string' ? { t, a: 0 } : t))
    .filter((t) => t && TICKET_RE.test(String(t.t)))
    .map((t) => ({ t: String(t.t), a: num(t.a, 10000) }))
    .slice(0, MAX_SNAP_TICKETS)
  const payload = {
    v: SNAP_VERSION,
    p: String(pub),
    n: NAME_RE.test(String(name)) ? String(name) : '',
    b: num(balance),
    i: num(issued, 1e12),
    s: num(sent, 1e12),
    r: num(received, 1e12),
    t: list,
    // 毫秒时间戳本身超过 1e12，不能走 num() 的上限夹取，否则所有快照都挤在同一秒
    at: Math.max(0, Math.min(1e12, Math.floor((Number(at) || 0) / 1000)))
  }
  const text = packRecord(SNAP_PREFIX, b64urlEncode(JSON.stringify(payload)))
  return {
    text,
    short: text.slice(-16),
    pub: payload.p,
    name: payload.n,
    balance: payload.b,
    issued: payload.i,
    tickets: list.length,
    at: payload.at
  }
}

export function unpackSnapshot(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s.startsWith(SNAP_PREFIX + '.')) return null
  const u = unpackRecord(s, SNAP_PREFIX)
  if (!u || u.decoded === null) return null
  let o
  try { o = JSON.parse(u.decoded) } catch { return null }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  if (o.v !== SNAP_VERSION || !PUB_RE.test(String(o.p))) return null
  const tickets = (Array.isArray(o.t) ? o.t : [])
    .filter((x) => x && TICKET_RE.test(String(x.t)))
    .map((x) => ({ t: String(x.t), a: num(x.a, 10000) }))
    .slice(0, MAX_SNAP_TICKETS)
  return {
    ok: true,
    text: s,
    short: u.short,
    pub: o.p,
    name: NAME_RE.test(String(o.n)) ? String(o.n) : '',
    balance: num(o.b),
    issued: num(o.i, 1e12),
    sent: num(o.s, 1e12),
    received: num(o.r, 1e12),
    tickets,
    at: num(o.at, 1e12)
  }
}

/**
 * 合并一堆快照。同一法号只算最新的一份 —— 反复导出、换设备重导都不会被
 * 拿来重复计算；这也是「空投名单」最容易被灌水的地方，先把口子堵上。
 */
export function mergeSnapshots(list) {
  const byPub = new Map()
  let bad = 0
  let repeats = 0
  for (const raw of Array.isArray(list) ? list : []) {
    const s = typeof raw === 'string' ? unpackSnapshot(raw) : (raw && raw.pub ? raw : null)
    if (!s || !s.pub) { if (raw) bad += 1; continue }
    const prev = byPub.get(s.pub)
    if (!prev) { byPub.set(s.pub, s); continue }
    repeats += 1
    const newer = (s.at || 0) > (prev.at || 0) ? s : prev
    const older = newer === s ? prev : s
    byPub.set(s.pub, {
      ...newer,
      // 同号多份：取最新余额，票取并集（同一张票不该被两份快照各算一次）
      tickets: mergeTickets(newer.tickets, older.tickets)
    })
  }
  const holders = [...byPub.values()].sort((a, b) => b.balance - a.balance)
  const totalBalance = holders.reduce((n, h) => n + h.balance, 0)
  const totalTickets = holders.reduce((n, h) => n + h.tickets.length, 0)
  const digest = holders.length
    ? sha256Hex(holders.map((h) => `${h.pub}:${h.balance}:${h.tickets.map((t) => t.t).sort().join(',')}`).join('|')).slice(0, 32)
    : ''
  return {
    ok: holders.length > 0,
    holders,
    totalBalance,
    totalTickets,
    digest,
    bad,
    repeats,
    count: holders.length
  }
}

function mergeTickets(a = [], b = []) {
  const map = new Map()
  for (const t of [...a, ...b]) {
    if (!t || !TICKET_RE.test(String(t.t))) continue
    const prev = map.get(t.t)
    if (!prev || (t.a || 0) > (prev.a || 0)) map.set(t.t, { t: t.t, a: num(t.a, 10000) })
  }
  return [...map.values()].slice(0, MAX_SNAP_TICKETS)
}

/** 一句话把合并结果说清楚，别让人对着数字猜 */
export function mergeLine(m) {
  if (!m?.ok) return '没有可用的快照'
  const parts = [`${m.count} 个法号`, `合计 ${m.totalBalance} $G`, `${m.totalTickets} 张票`]
  if (m.repeats) parts.push(`${m.repeats} 份重复已按最新覆盖`)
  if (m.bad) parts.push(`${m.bad} 条无效已丢弃`)
  return parts.join(' · ')
}

/** 代币规则文案：面板里要能读到「凭什么」，不然「无预挖」就是一句口号 */
export const TOKEN_RULES = [
  '总量 21,000,000 $G，写死在前端常量里。没有预挖、没有团队份额、没有私募额度 —— 因为根本没有「方」可以预留。',
  '唯一的增发口是修行：四法器、共修一炷、长明灯开光。每笔入账都要过同一个函数，受每日 600 $G 额度约束。',
  '玩家之间的托管、领赏、随喜、退还是转移，不增发。所以币的总量只跟「有人敲了多少」有关，不跟「有人充了多少钱」有关。',
  '一炷香一张禅印，票面额由寺规算出、固定不变，整张可转。票根带 64 拍判定，任何人可复算 —— 这是余额唯一的来源凭证。',
  '持仓快照 CTA1 只包含法号指纹、余额与票号，不含私钥。合并多份快照时同一法号取最新一份，重复导出不会灌水。谁要发币或做映射，名单只能照这个摘要来。',
  '当前未上链、不对应任何链上资产、不承诺任何收益。这里提供的是「可核对的账」，不是「可交易的价格」。'
]
