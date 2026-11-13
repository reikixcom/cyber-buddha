/**
 * 功德票与公共流水 —— 让「一炷香的功德」可以转给别人，且任何人都能查。
 *
 * 为什么要有这一层：
 * 禅印证明「这串敲击记录按寺规该得这些功德」，但它是你自己的浏览器写的，
 * 而且功德一旦转手，就可能被同一张票花两次。这一层把每张禅印当成一张
 * 「票面固定」的功德票，用两件事来防：
 *
 *   1. 归属声明 CTK1 —— 出印时用它署名认领，票从此绑定到一个法号（公钥）。
 *   2. 转让单 CTX1 —— 持有人签名把整张票转给别人，每张票自己的流转用
 *      前序短码串成一条链，分叉就是双花，谁都能当场指出来。
 *
 * 每条流水都自带票根（完整禅印回执），所以别人拿到一行文本就能独立验证：
 * 回执能不能复算 → 票面额对不对 → 签名是不是持有人签的 → 链有没有分叉。
 * 不需要问服务器，也不需要相信项目方。
 *
 * 边界说清楚（这些是设计上就做不到的，不是没做完）：
 *  - 没有共识，只能「事后发现」双花，不能「事前阻止」。你把同一张票同时
 *    转给两个人，两边各自看都合法，只有把两边的流水合到一起才会露馅。
 *  - 不防冒名：谁都可以声称替别人背书，但签名一验就露。
 *  - 公钥、用途、时间都会公开；不想公开就别发布，只在私下传转让单。
 *
 * 纯函数：不依赖 Vue / DOM / Web Crypto。签名验证由上层注入 verify，
 * 所以同一份规则在 Node 与浏览器里能用 node --test 对拍。
 */
import {
  verifySeal, shortOf, sha256Hex,
  packRecord, unpackRecord, b64urlEncode, b64urlDecode
} from './seal.js'

export const CLAIM_PREFIX = 'CTK1'
export const TRANSFER_PREFIX = 'CTX1'
export const CARD_PREFIX = 'CTP1'
export const BUNDLE_PREFIX = 'CTB1'
export const NOTE_VERSION = 1
export const MAX_PURPOSE = 18
export const MAX_BUNDLE_RECORDS = 400

/** P-256 未压缩公钥 65 字节 → base64url 87 字符；签名 r||s 64 字节 → 86 字符 */
const PUB_RE = /^[A-Za-z0-9_-]{40,120}$/
const SIG_RE = /^[A-Za-z0-9_-]{80,120}$/
const TICKET_RE = /^[0-9a-f]{16}$/
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max

/** 法号：公钥指纹，短到能在列表里一眼区分，又不泄露完整公钥的排版噪音 */
export function nameOf(pub) {
  return typeof pub === 'string' && pub ? '#' + sha256Hex('ct-name|' + pub).slice(0, 6) : '#不明'
}

/** 用途归一化：去掉会破坏规范串的竖线，压掉首尾空白 */
export function cleanPurpose(s) {
  const t = typeof s === 'string' ? s.replace(/[|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return t.slice(0, MAX_PURPOSE)
}

/* ------------------------------------------------------------------ *
 * 签名规范串 —— 任何语言的实现都必须逐字节一致，否则验不过
 * ------------------------------------------------------------------ */
export function claimMessage(ticket, pub) {
  return `${CLAIM_PREFIX}|${ticket}|${pub}`
}
export function transferMessage(t) {
  return `${TRANSFER_PREFIX}|${t.ticket}|${t.amount}|${t.from}|${t.to}|${t.purpose}|${t.at}|${t.prev}`
}

/* ------------------------------------------------------------------ *
 * 归属声明与转让单
 * ------------------------------------------------------------------ */
export function makeClaim({ pub, sig, sealText, at = Date.now() }) {
  const v = verifySeal(sealText)
  if (!v.ok) return null
  const ticket = v.seal.short
  const payload = [
    NOTE_VERSION, ticket, pub, sig,
    Math.floor(at / 1000), String(sealText).trim()
  ]
  const text = packRecord(CLAIM_PREFIX, b64urlEncode(JSON.stringify(payload)))
  return {
    kind: 'claim', text, short: text.slice(-16), ticket, pub, sig,
    at: payload[4], sealText: payload[5], amount: v.seal.reward, round: v.seal.round
  }
}

export function makeTransfer({ pub, sig, sealText, claimText = '', to, purpose = '', prev = '', at = Date.now() }) {
  const v = verifySeal(sealText)
  if (!v.ok) return null
  const ticket = v.seal.short
  const payload = [
    NOTE_VERSION, ticket, v.seal.reward, pub, to,
    cleanPurpose(purpose), Math.floor(at / 1000), prev, sig,
    String(sealText).trim(), String(claimText || '').trim()
  ]
  const text = packRecord(TRANSFER_PREFIX, b64urlEncode(JSON.stringify(payload)))
  return {
    kind: 'transfer', text, short: text.slice(-16), ticket, amount: payload[2],
    from: pub, to, purpose: payload[5], at: payload[6], prev: payload[7], sig,
    sealText: payload[9], claimText: payload[10]
  }
}

/** 收款码：一行文本把公钥给别人，别人据此把票转给你 */
export function makeCard(pub) {
  if (!PUB_RE.test(String(pub))) return ''
  return packRecord(CARD_PREFIX, String(pub))
}
export function parseCard(text) {
  const u = unpackRecord(text, CARD_PREFIX)
  if (!u || u.decoded === null) return null
  // 名片正文直接放公钥，不额外编码；这里用原始 body 更直观
  const pub = String(text).trim().split('.')[1]
  return PUB_RE.test(pub) ? pub : null
}

/* ------------------------------------------------------------------ *
 * 解析
 * ------------------------------------------------------------------ */
export function parseRecord(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return null

  if (s.startsWith(CLAIM_PREFIX + '.')) {
    const u = unpackRecord(s, CLAIM_PREFIX)
    if (!u || u.decoded === null) return null
    let a
    try { a = JSON.parse(u.decoded) } catch { return null }
    if (!Array.isArray(a) || a.length !== 6 || a[0] !== NOTE_VERSION) return null
    const [, ticket, pub, sig, at, sealText] = a
    if (!TICKET_RE.test(String(ticket)) || !PUB_RE.test(String(pub)) || !SIG_RE.test(String(sig))) return null
    if (!isInt(at, 0, 1e12) || typeof sealText !== 'string' || sealText.length > 480) return null
    return { kind: 'claim', text: s, short: u.short, ticket, pub, sig, at, sealText }
  }

  if (s.startsWith(TRANSFER_PREFIX + '.')) {
    const u = unpackRecord(s, TRANSFER_PREFIX)
    if (!u || u.decoded === null) return null
    let a
    try { a = JSON.parse(u.decoded) } catch { return null }
    // 10 字段是早期流水（不带认领），11 字段起自带票的归属声明
    if (!Array.isArray(a) || a.length < 10 || a.length > 11 || a[0] !== NOTE_VERSION) return null
    const [, ticket, amount, from, to, purpose, at, prev, sig, sealText] = a
    const claimText = a.length === 11 ? a[10] : ''
    if (!TICKET_RE.test(String(ticket)) || !isInt(amount, 0, 10000)) return null
    if (!PUB_RE.test(String(from)) || !PUB_RE.test(String(to))) return null
    if (!SIG_RE.test(String(sig))) return null
    if (typeof purpose !== 'string' || purpose.length > MAX_PURPOSE || purpose.includes('|')) return null
    if (!isInt(at, 0, 1e12) || typeof prev !== 'string' || !/^[0-9a-f]{16}$/.test(prev)) return null
    if (typeof sealText !== 'string' || sealText.length > 480) return null
    if (typeof claimText !== 'string' || claimText.length > 720) return null
    return {
      kind: 'transfer', text: s, short: u.short, ticket, amount,
      from, to, purpose, at, prev, sig, sealText, claimText
    }
  }

  return null
}

/* ------------------------------------------------------------------ *
 * 审计：把一堆流水合成一本账，找出所有能证明的问题
 * ------------------------------------------------------------------ *
 * verify(pub, message, sig) => Promise<boolean>  由上层注入（Web Crypto）
 * 返回的 tickets 每张票一份，holder 是当前持有人；conflicts 非空即有问题。
 * ------------------------------------------------------------------ */
export async function auditLedger(records, { verify } = {}) {
  const conflicts = []
  const rejected = []
  const seen = new Set()
  const sealOf = new Map()
  const claims = new Map()
  const transfers = new Map()

  const readSeal = (sealText) => {
    const v = verifySeal(sealText)
    return v.ok ? v.seal : null
  }

  for (const raw of Array.isArray(records) ? records : []) {
    const r = typeof raw === 'string' ? parseRecord(raw) : raw
    if (!r || (r.kind !== 'claim' && r.kind !== 'transfer')) {
      if (raw) rejected.push({ text: String(raw).slice(0, 48), reason: '不是可解析的功德票流水' })
      continue
    }
    if (seen.has(r.text)) continue
    seen.add(r.text)

    let seal = sealOf.get(r.ticket)
    if (seal === undefined) {
      seal = readSeal(r.sealText)
      sealOf.set(r.ticket, seal)
    }
    if (!seal) {
      rejected.push({ text: r.text.slice(0, 48), reason: '票根不是合法禅印，或与票号对不上' })
      continue
    }
    if (seal.short !== r.ticket) {
      rejected.push({ text: r.text.slice(0, 48), reason: '票号与票根不一致' })
      continue
    }
    if (!(seal.reward > 0)) {
      rejected.push({ text: r.text.slice(0, 48), reason: '这张禅印没有可转的功德' })
      continue
    }

    if (r.kind === 'claim') {
      if (!claims.has(r.ticket)) claims.set(r.ticket, [])
      claims.get(r.ticket).push(r)
      continue
    }

    if (r.amount !== seal.reward) {
      rejected.push({ text: r.text.slice(0, 48), reason: `转让金额 ${r.amount} 与票面 ${seal.reward} 不符` })
      continue
    }
    if (typeof verify === 'function') {
      let ok = false
      try { ok = await verify(r.from, transferMessage(r), r.sig) } catch { ok = false }
      if (!ok) {
        rejected.push({ text: r.text.slice(0, 48), reason: '转让签名不是这个法号签的，已作废' })
        continue
      }
    }
    if (!transfers.has(r.ticket)) transfers.set(r.ticket, [])
    transfers.get(r.ticket).push(r)
  }

  const tickets = []
  const byTime = (a, b) => a.at - b.at || a.short.localeCompare(b.short)
  const ticketIds = [...new Set([...claims.keys(), ...transfers.keys()])].sort()

  for (const ticket of ticketIds) {
    const seal = sealOf.get(ticket)
    if (!seal) continue
    const cs = (claims.get(ticket) || []).slice().sort(byTime)
    const ts = (transfers.get(ticket) || []).slice().sort(byTime)
    const mine = []
    const push = (kind, detail, extra = {}) => {
      const c = { ticket, kind, detail, ...extra }
      conflicts.push(c)
      mine.push(c)
    }

    if (!cs.length && !ts.length) continue

    /**
     * 转让单自带认领：接收方只拿到一条转让单，也能顺着它追到票的原始归属。
     * 这是「公告板上只有一条消息」时还能验证的关键。
     */
    let root = cs[0] || null
    if (!root) {
      for (const t of ts) {
        if (!t.claimText) continue
        const cr = parseRecord(t.claimText)
        if (!cr || cr.kind !== 'claim' || cr.ticket !== ticket) continue
        const cv = verifySeal(cr.sealText)
        if (!cv.ok || cv.seal.short !== ticket) continue
        root = cr
        cs.push(cr)
        break
      }
    }

    const byPrev = new Map()
    for (const t of ts) {
      if (!byPrev.has(t.prev)) byPrev.set(t.prev, [])
      byPrev.get(t.prev).push(t)
    }

    let holder
    let cursor
    let implicit = false
    const path = []

    if (root) {
      const pubs = new Set(cs.map((c) => c.pub))
      if (pubs.size > 1) {
        push('claim-conflict', `同一张票被 ${pubs.size} 个法号认领，只有最早那条算数`)
      }
      holder = root.pub
      cursor = root.short
    } else {
      // 完全找不到认领：只能从「自称链头」的那条转让起步，信任降一档并在票上标明
      const shorts = new Set(ts.map((t) => t.short))
      const heads = ts.filter((t) => !shorts.has(t.prev))
      if (!heads.length) {
        push('broken-link', '这张票的转让接不成链，没人能证明来源')
        continue
      }
      if (heads.length > 1) {
        push('broken-link', `有 ${heads.length} 条转让都自称链头，来源有分歧`, { count: heads.length })
      }
      const head = heads[0]
      // 这条转让已经是「A→B」，持有人直接推进到收款方
      holder = head.to
      cursor = head.short
      path.push(head)
      implicit = true
    }

    while (true) {
      const next = byPrev.get(cursor) || []
      if (next.length === 0) break
      if (next.length > 1) {
        push(
          'double-spend',
          `同一张票从 ${nameOf(holder)} 同时转给了 ${next.length} 个法号`,
          { holders: next.map((t) => nameOf(t.to)) }
        )
        break
      }
      const t = next[0]
      if (t.from !== holder) {
        push('not-holder', `${nameOf(t.from)} 不是这张票当时的持有人，这条转让无效`)
        break
      }
      holder = t.to
      cursor = t.short
      path.push(t)
    }

    const orphan = ts.filter((t) => !path.includes(t) && t.prev !== cursor)
    if (orphan.length) {
      push('orphan', `${orphan.length} 条转让接不到这张票的流转链上，可能被人改过前序`)
    }

    tickets.push({
      short: ticket,
      reward: seal.reward,
      round: seal.round,
      source: seal.source,
      claimedAt: root ? root.at : (path[0]?.at || 0),
      holder,
      holderName: nameOf(holder),
      claimants: cs.length ? new Set(cs.map((c) => c.pub)).size : 0,
      implicit,
      history: [
        ...(root ? [{ kind: 'claim', at: root.at, short: root.short, to: root.pub, toName: nameOf(root.pub) }] : []),
        ...path.map((t) => ({
          kind: 'transfer', at: t.at, short: t.short,
          from: t.from, to: t.to, fromName: nameOf(t.from), toName: nameOf(t.to),
          purpose: t.purpose
        }))
      ],
      conflicts: mine
    })
  }

  return {
    ok: conflicts.length === 0,
    tickets,
    conflicts,
    rejected,
    accepted: tickets.length,
    doubleSpent: conflicts.filter((c) => c.kind === 'double-spend' || c.kind === 'claim-conflict').length
  }
}

/* ------------------------------------------------------------------ *
 * 整包导出 / 导入：一条 CTB1 文本搬走一整本流水
 * ------------------------------------------------------------------ */
export function packBundle(records, { at = Date.now() } = {}) {
  const list = (Array.isArray(records) ? records : [])
    .map((r) => (typeof r === 'string' ? r.trim() : String(r?.text || '').trim()))
    .filter((t) => t && parseRecord(t))
    .slice(0, MAX_BUNDLE_RECORDS)
  return packRecord(BUNDLE_PREFIX, b64urlEncode(JSON.stringify({
    v: NOTE_VERSION, at: Math.floor(at / 1000), records: list
  })))
}

export function unpackBundle(text) {
  const u = unpackRecord(text, BUNDLE_PREFIX)
  if (!u || u.decoded === null) return null
  let obj
  try { obj = JSON.parse(u.decoded) } catch { return null }
  if (!obj || obj.v !== NOTE_VERSION || !Array.isArray(obj.records)) return null
  const records = obj.records
    .filter((t) => typeof t === 'string' && parseRecord(t))
    .slice(0, MAX_BUNDLE_RECORDS)
  return { at: isInt(obj.at, 0, 1e12) ? obj.at : 0, records }
}

/** 只取票号，用于 UI 快速比对；不合法返回空串 */
export const ticketOf = (text) => shortOf(text)
