/**
 * 共修网络 —— 让「在线多少人」「万佛墙上有哪些愿」不再是本地布景。
 *
 * 三种记录挂在公共公告板上，谁都能读、谁都能发，没有账号也没有服务器：
 *
 *   CTH1 在场心跳：我现在在寺里，正在诵哪条愿，这一炷已敲了多少击
 *   CTW1 愿单    ：愿文、悬赏、需要多少击，由愿主签名（愿 id 由内容派生，改不了）
 *   CTJ1 接单    ：我要替这条愿诵（可多人同时接，不抢单）
 *   CTD1 送达    ：我诵完了，附禅印短码作证
 *
 * 为什么用「心跳里的累计击数」而不是每人上报一条击打记录：
 * 公告板一条消息就是一次 HTTP 请求，敲一下发一条会被限流到不可用。
 * 心跳里带「我给这条愿敲了多少击」，取每个人最后一次的值求和，就得到
 * 这条愿当前的共诵进度 —— 网络开销与击打次数无关。
 *
 * 诚实边界（和禅印一致）：这些都是各人自己上报的数字，客户端只能验签名
 * 「是不是这个法号说的」，不能验「他是不是真的敲了」。真正防作弊要等
 * 公共账本层面的互相监督；这一层的价值是「有别人」，不是「没人能撒谎」。
 * 聚合时宁可少算：同一个人重复上报只取最大值，不累加。
 */

import { packRecord, unpackRecord, b64urlEncode, sha256Hex } from './seal.js'

export const SANGHA_TOPIC = 'cyberbuddha-sangha-v1'

export const P_PRESENCE = 'CTH1'
export const P_WISH = 'CTW1'
export const P_JOIN = 'CTJ1'
export const P_DELIVER = 'CTD1'

/** 心跳间隔与判定为「还在场」的窗口：留两次丢失的余量 */
export const HEARTBEAT_MS = 30000
export const PRESENCE_WINDOW_MS = 85000

export const WISH_TEXT_MAX = 24
export const MAX_HITS = 100000

const PUB_RE = /^[A-Za-z0-9_-]{40,120}$/
const SIG_RE = /^[A-Za-z0-9_-]{60,120}$/
const SHORT_RE = /^[0-9a-f]{16}$/

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

/** 愿 id 由内容派生：改了愿文或悬赏，id 就对不上，冒名与重放都会被看出来 */
export function wishId({ text, bounty, need, at, pub }) {
  return sha256Hex(`ct-wish|${pub}|${text}|${bounty}|${need}|${at}`).slice(0, 12)
}

/** 签名对象。四个函数一一对应，验签方照抄即可 */
export const signText = {
  presence: ({ pub, at, wishId: wid = '', hits = 0, dayHits = 0 }) =>
    `sangha.presence|${pub}|${at}|${wid}|${hits}|${dayHits}`,
  wish: ({ id, wish, bounty, need, at }) =>
    `sangha.wish|${id}|${wish}|${bounty}|${need}|${at}`,
  join: ({ wishId: wid, pub, at }) => `sangha.join|${wid}|${pub}|${at}`,
  deliver: ({ wishId: wid, pub, hits, sealShort, at }) =>
    `sangha.deliver|${wid}|${pub}|${hits}|${sealShort}|${at}`
}

const clampText = (s) => String(s || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, WISH_TEXT_MAX)

/* ------------------------------------------------------------------ *
 * 造记录
 * ------------------------------------------------------------------ */

export function makePresence({ pub, sig, at = Date.now(), wishId: wid = '', hits = 0, dayHits = 0 }) {
  const payload = [1, pub, Math.floor(at / 1000), wid || '', Math.max(0, hits | 0), Math.max(0, dayHits | 0)]
  const text = packRecord(P_PRESENCE, b64urlEncode(JSON.stringify([...payload, sig])))
  return { kind: 'presence', text, pub, at: payload[2], wishId: payload[3], hits: payload[4], dayHits: payload[5], sig }
}

export function makeWish({ pub, sig, text = '', bounty = 20, need = 120, at = Date.now() }) {
  const t = clampText(text)
  const sec = Math.floor(at / 1000)
  const id = wishId({ text: t, bounty, need, at: sec, pub })
  const body = [1, id, t, bounty, need, sec, pub, sig]
  const out = packRecord(P_WISH, b64urlEncode(JSON.stringify(body)))
  return { kind: 'wish', text: out, id, wish: t, bounty, need, at: sec, pub, sig }
}

export function makeJoin({ pub, sig, wishId: wid, at = Date.now() }) {
  const sec = Math.floor(at / 1000)
  const out = packRecord(P_JOIN, b64urlEncode(JSON.stringify([1, wid, pub, sec, sig])))
  return { kind: 'join', text: out, wishId: wid, pub, at: sec, sig }
}

export function makeDeliver({ pub, sig, wishId: wid, hits = 0, sealShort = '', at = Date.now() }) {
  const sec = Math.floor(at / 1000)
  const out = packRecord(P_DELIVER, b64urlEncode(JSON.stringify([1, wid, pub, Math.max(0, hits | 0), sealShort, sec, sig])))
  return { kind: 'deliver', text: out, wishId: wid, pub, hits: Math.max(0, hits | 0), sealShort, at: sec, sig }
}

/* ------------------------------------------------------------------ *
 * 解析（只做结构与范围校验，签名另验）
 * ------------------------------------------------------------------ */

function decode(text, prefix, len) {
  const u = unpackRecord(text, prefix)
  if (!u || u.decoded === null) return null
  let a
  try { a = JSON.parse(u.decoded) } catch { return null }
  if (!Array.isArray(a) || a.length !== len || a[0] !== 1) return null
  return { a, body: u.body, short: u.short }
}

/** 任意一条公告板消息 → 归一化记录；不认识的返回 null，由上层静默丢弃 */
export function parseSangha(text) {
  const s = String(text || '').trim()
  if (!s) return null
  if (s.startsWith(P_PRESENCE + '.')) {
    const d = decode(s, P_PRESENCE, 7)
    if (!d) return null
    const [, pub, at, wid, hits, dayHits, sig] = d.a
    if (!PUB_RE.test(String(pub)) || !SIG_RE.test(String(sig))) return null
    if (!isInt(at, 1, 1e11) || !isInt(hits, 0, MAX_HITS) || !isInt(dayHits, 0, 1e9)) return null
    if (wid && !/^[0-9a-f]{12}$/.test(String(wid))) return null
    return { kind: 'presence', text: s, pub, at, wishId: wid || '', hits, dayHits, sig }
  }
  if (s.startsWith(P_WISH + '.')) {
    const d = decode(s, P_WISH, 8)
    if (!d) return null
    const [, id, wtext, bounty, need, at, pub, sig] = d.a
    if (typeof wtext !== 'string' || !wtext || wtext.length > WISH_TEXT_MAX) return null
    if (!isInt(bounty, 1, 5000) || !isInt(need, 1, MAX_HITS)) return null
    if (!isInt(at, 1, 1e11) || !PUB_RE.test(String(pub)) || !SIG_RE.test(String(sig))) return null
    if (typeof id !== 'string' || id !== wishId({ text: wtext, bounty, need, at, pub })) return null
    return { kind: 'wish', text: s, id, wish: wtext, bounty, need, at, pub, sig }
  }
  if (s.startsWith(P_JOIN + '.')) {
    const d = decode(s, P_JOIN, 5)
    if (!d) return null
    const [, wid, pub, at, sig] = d.a
    if (typeof wid !== 'string' || !/^[0-9a-f]{12}$/.test(wid)) return null
    if (!PUB_RE.test(String(pub)) || !SIG_RE.test(String(sig)) || !isInt(at, 1, 1e11)) return null
    return { kind: 'join', text: s, wishId: wid, pub, at, sig }
  }
  if (s.startsWith(P_DELIVER + '.')) {
    const d = decode(s, P_DELIVER, 7)
    if (!d) return null
    const [, wid, pub, hits, sealShort, at, sig] = d.a
    if (typeof wid !== 'string' || !/^[0-9a-f]{12}$/.test(wid)) return null
    if (!PUB_RE.test(String(pub)) || !SIG_RE.test(String(sig))) return null
    if (!isInt(hits, 0, MAX_HITS) || !isInt(at, 1, 1e11)) return null
    if (sealShort && !SHORT_RE.test(String(sealShort))) return null
    return { kind: 'deliver', text: s, wishId: wid, pub, hits, sealShort: sealShort || '', at, sig }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 聚合：把一堆消息算成「现在寺里有什么」
 * ------------------------------------------------------------------ */

const NAMES = ['慧行', '明觉', '净尘', '无相', '守一', '若谷', '空山', '见月', '知白', '如一']

/** 昵称：法号是随机公钥，直接显示像乱码；用确定性的两字名，同一个人每次都一样 */
export function soulName(pub) {
  const h = sha256Hex('ct-soul|' + String(pub))
  const a = parseInt(h.slice(0, 4), 16) % NAMES.length
  const b = parseInt(h.slice(4, 8), 16) % NAMES.length
  return NAMES[a] + (b === a ? NAMES[(b + 3) % NAMES.length] : NAMES[b])
}

export const shortPub = (pub) => '#' + sha256Hex('ct-name|' + String(pub)).slice(0, 6)

/**
 * @param items parseSangha 的输出（可含重复、含自己）
 * @param opts  { now, selfPub }
 */
export function aggregate(items, opts = {}) {
  const now = opts.now ?? Date.now()
  const selfPub = opts.selfPub || ''
  const list = Array.isArray(items) ? items : []

  const presence = new Map()   // pub -> 最新心跳
  const wishes = new Map()     // id -> wish
  const joins = new Map()      // wishId -> Map(pub -> at)
  const delivers = new Map()   // wishId -> Map(pub -> deliver)
  const seenText = new Set()

  for (const r of list) {
    if (!r || !r.kind) continue
    if (r.text && seenText.has(r.text)) continue
    if (r.text) seenText.add(r.text)

    if (r.kind === 'presence') {
      const prev = presence.get(r.pub)
      if (!prev || r.at > prev.at) presence.set(r.pub, r)
    } else if (r.kind === 'wish') {
      if (!wishes.has(r.id)) wishes.set(r.id, r)
    } else if (r.kind === 'join') {
      if (!joins.has(r.wishId)) joins.set(r.wishId, new Map())
      const m = joins.get(r.wishId)
      if (!m.has(r.pub) || r.at > m.get(r.pub)) m.set(r.pub, r.at)
    } else if (r.kind === 'deliver') {
      if (!delivers.has(r.wishId)) delivers.set(r.wishId, new Map())
      const m = delivers.get(r.wishId)
      const prev = m.get(r.pub)
      if (!prev || r.at > prev.at) m.set(r.pub, r)
    }
  }

  // 在场：窗口内取最新一次；自己不在记录里也算在场（刚打开还没发心跳）
  const souls = []
  for (const p of presence.values()) {
    if (now - p.at * 1000 > PRESENCE_WINDOW_MS) continue
    if (p.at * 1000 - now > 120000) continue // 明显是未来的时间戳，不采信
    souls.push({ pub: p.pub, name: soulName(p.pub), at: p.at, wishId: p.wishId, hits: p.hits })
  }
  if (selfPub && !souls.some((s) => s.pub === selfPub)) {
    souls.push({ pub: selfPub, name: soulName(selfPub), at: Math.floor(now / 1000), wishId: '', hits: 0, self: true })
  }

  // 每条愿的进度：每个法号取「心跳累计」与「送达击数」中的最大值，再求和。
  // 只取最大值是为了让重复上报、重发心跳都不会把进度灌水。
  const out = []
  for (const w of wishes.values()) {
    const dj = delivers.get(w.id) || new Map()
    const jn = joins.get(w.id) || new Map()
    const per = new Map()
    for (const s of souls) {
      if (s.wishId !== w.id) continue
      if (!s.pub) continue
      per.set(s.pub, Math.max(per.get(s.pub) || 0, s.hits))
    }
    for (const [pub, d] of dj) {
      per.set(pub, Math.max(per.get(pub) || 0, d.hits))
    }

    let progress = 0
    for (const v of per.values()) progress += v

    const participants = [...new Set([...per.keys(), ...jn.keys()])]
    const done = dj.size > 0 && progress >= w.need
    out.push({
      id: w.id,
      wish: w.wish,
      bounty: w.bounty,
      need: w.need,
      at: w.at,
      owner: w.pub,
      ownerName: shortPub(w.pub),
      progress: Math.min(progress, w.need),
      rawProgress: progress,
      crowd: Math.max(participants.length, done ? 1 : 0),
      participants: participants.map((p) => ({ pub: p, name: soulName(p) })),
      joins: jn.size,
      delivered: dj.size,
      done,
      mine: !!selfPub && w.pub === selfPub,
      text: w.text
    })
  }

  out.sort((a, b) => (Number(b.done) - Number(a.done)) || (b.bounty - a.bounty) || (b.at - a.at))

  // 信誉：挂了几条愿、被送达了几条。这是公开可查的「还愿记录」的一半 ——
  // 另一半（真付了几张票）在公共账本里，两层能对上才算数。
  const rep = new Map()
  const bump = (pub, key) => {
    if (!rep.has(pub)) rep.set(pub, { pub, name: shortPub(pub), posted: 0, deliveredTo: 0, delivered: 0 })
    rep.get(pub)[key] += 1
  }
  for (const r of wishes.values()) bump(r.pub, 'posted')
  for (const m of delivers.values()) for (const d of m.values()) bump(d.pub, 'delivered')
  for (const [wid, m] of delivers) {
    const w = wishes.get(wid)
    if (w && m.size) bump(w.pub, 'deliveredTo')
  }

  const dayHits = souls.reduce((n, s) => n + (presence.get(s.pub)?.dayHits || 0), 0)
  /** 此刻正被诵着的击数：各人在场心跳里上报的累计值之和，实时且真实 */
  const liveHits = souls.reduce((n, s) => n + (presence.get(s.pub)?.hits || 0), 0)

  return {
    online: souls.length,
    souls: souls.sort((a, b) => b.at - a.at),
    wishes: out.filter((w) => w.done || w.progress < w.need),
    all: out,
    reputation: [...rep.values()].sort((a, b) => b.delivered - a.delivered),
    dayHits,
    liveHits
  }
}

/** 逐条验签。签名是真的才算数 —— 聚合本身不做密码学校验，避免卡住主线程 */
export async function verifySangha(items, { verify } = {}) {
  if (typeof verify !== 'function') return { ok: false, reason: '当前环境无法验签', records: [] }
  const records = []
  let bad = 0
  for (const r of items) {
    if (!r || !r.kind) continue
    const msg = signText[r.kind](r)
    let ok = false
    try { ok = await verify(r.pub, msg, r.sig) } catch { ok = false }
    if (ok) records.push(r)
    else bad += 1
  }
  return { ok: true, records, rejected: bad }
}
