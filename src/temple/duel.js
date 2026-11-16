/**
 * 战帖（Duel）—— 让分享从「一张死图」变成「一个能按的按钮」。
 *
 * 为什么这件事成立：一张禅印里已经写死了「第几炷 + 当日种子」，而节拍表
 * 是 `seedFrom(round, daySeed)` 的纯函数。所以别人拿到你的回执，就能重建
 * 与你完全相同的六十四拍 —— 这是真正的一题两答，不是「我玩了你也来玩」。
 *
 * 所以战帖不需要服务器、不需要配对、不需要房间：
 *   你的回执 → 一条链接 → 对方点开就开始同一炷。
 *
 * 为了能贴进聊天框，战帖不再把整条回执当成字符串再编码一遍（那会多出三成长度），
 * 而是直接带字段数组。解析时按同一套规则重建回执，再走一遍 verifySeal 复算 ——
 * 压缩的是体积，不是检验。
 *
 * 边界（和禅印一致，不夸大）：
 *  - 回执里的合拍率是按规则复算出来的，改一个字校验码就崩，截图 P 图没用；
 *  - 但规则是纯函数，谁都能自己算一张合法回执 —— 战帖证明的是
 *    「这张成绩符合寺规」，不证明「他真的用手敲了」。要真防假，得靠公开账本
 *    层面互相监督，这跟现有层面是同一句话。
 *  - 战帖上的法号是自报的（回执里不含公钥），所以只当标签看，不当身份看。
 *    真要认身份，用功德票的签名转让链。
 *
 * 纯函数：不依赖 Vue / DOM / Web Crypto，Node 可测。
 */
import {
  verifySeal, packRecord, unpackRecord, b64urlEncode,
  payloadOf, sealTextFromPayload
} from './seal.js'

export const DUEL_PREFIX = 'CTD2'
export const DUEL_VERSION = 2
export const MAX_NAME = 20
export const MAX_NOTE = 36

const NAME_RE = /^[#\w\u4e00-\u9fa5·\- ]{0,20}$/

const clamp01 = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
}
const round4 = (n) => Math.round(n * 10000) / 10000

/** 去掉会破坏规范串的字符：竖线是字段分隔符，换行会让整行贴不进聊天框 */
export function cleanLine(s, max) {
  const t = typeof s === 'string' ? s.replace(/[|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return t.slice(0, max)
}

/**
 * 从一张禅印造一张战帖。
 * 只接受能验过的回执 —— 战帖的价值全在「这道题是真的」。
 */
export function makeDuel({ sealText, name = '', note = '', at = Date.now() } = {}) {
  const v = verifySeal(sealText)
  if (!v.ok) return null
  const fields = payloadOf(v.seal.text)
  if (!fields) return null
  const payload = [
    DUEL_VERSION,
    fields,
    cleanLine(name, MAX_NAME),
    cleanLine(note, MAX_NOTE),
    Math.floor(at / 1000)
  ]
  const text = packRecord(DUEL_PREFIX, b64urlEncode(JSON.stringify(payload)))
  return {
    text,
    short: text.slice(-16),
    seal: v.seal,
    name: payload[2],
    note: payload[3],
    at: payload[4]
  }
}

/** 解析战帖：回执仍然要过一遍验签，改过的、过期的、伪造成别的格式的都进不来 */
export function parseDuel(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s.startsWith(DUEL_PREFIX + '.')) return null
  const u = unpackRecord(s, DUEL_PREFIX)
  if (!u || u.decoded === null) return null
  let a
  try { a = JSON.parse(u.decoded) } catch { return null }
  if (!Array.isArray(a) || a.length !== 5 || a[0] !== DUEL_VERSION) return null
  const [, fields, name, note, at] = a
  // 字段数组重建回执：格式不对就造不出文本，再造出来的也要复算通过
  const sealText = sealTextFromPayload(fields)
  if (!sealText) return null
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null
  if (typeof note !== 'string' || note.length > MAX_NOTE) return null
  if (!Number.isInteger(at) || at < 0 || at > 1e12) return null
  const v = verifySeal(sealText)
  if (!v.ok) return null
  return {
    ok: true,
    text: s,
    short: u.short,
    seal: v.seal,
    name: name || '',
    note: note || '',
    at
  }
}

/**
 * 应战需要的参数：重建同一张节拍表的最小集合。
 * beacon 只在回执本身是 v2 时才有；v1 回执按 daySeed 直接算。
 */
export function duelSetup(duel) {
  const s = duel?.seal
  if (!s) return null
  return {
    round: s.round,
    daySeed: s.daySeed,
    seed: s.seed,
    accuracy: s.accuracy,
    reward: s.reward,
    date: s.dayTag || dateOf(s.daySeed),
    beacon: s.version === 2 ? { day: s.dayTag, round: s.beaconRound } : null
  }
}

function dateOf(daySeed) {
  const s = String(daySeed || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/**
 * 两边对比。合拍率才是同题的公平尺度；功德会被「同时在场人数」稀释，
 * 两个人不在同一分钟敲，稀释系数就不同，所以只作参考、不判胜负。
 */
export function compareDuel(theirs, mine) {
  const ta = clamp01(theirs?.accuracy)
  const ma = clamp01(mine?.accuracy)
  const gap = round4(ma - ta)
  const abs = Math.abs(gap)
  const same = !!theirs && !!mine &&
    theirs.daySeed === mine.daySeed && theirs.round === mine.round

  let verdict = 'tie'
  if (gap > 0.005) verdict = 'win'
  else if (gap < -0.005) verdict = 'lose'

  const margin = abs >= 0.15 ? 'big' : abs >= 0.05 ? 'small' : 'hair'
  const label = {
    win: { big: '完胜', small: '小胜', hair: '险胜' },
    lose: { big: '落败', small: '惜败', hair: '一分之差' },
    tie: { big: '平手', small: '平手', hair: '平手' }
  }[verdict][margin]

  return {
    ok: !!theirs && !!mine,
    same,
    gap,
    verdict,
    margin,
    label,
    mineAccuracy: ma,
    theirsAccuracy: ta,
    mineReward: Math.max(0, Math.round(Number(mine?.reward) || 0)),
    theirsReward: Math.max(0, Math.round(Number(theirs?.reward) || 0)),
    round: theirs?.round || mine?.round || 0,
    date: dateOf(theirs?.dayTag || theirs?.daySeed)
  }
}

/** 一眼能读完的战报：贴进群里比「我赢了」有信息量 */
export function duelVerdictLine(cmp) {
  if (!cmp?.ok) return ''
  const pct = (x) => `${Math.round(x * 100)}%`
  if (cmp.verdict === 'tie') {
    return `同一炷打成平手 · ${pct(cmp.mineAccuracy)} 对 ${pct(cmp.theirsAccuracy)}`
  }
  const diff = Math.abs(Math.round(cmp.gap * 100))
  return `${cmp.label} · ${pct(cmp.mineAccuracy)} 对 ${pct(cmp.theirsAccuracy)}（差 ${diff} 个百分点）`
}

/** 挑战语：发出去要像人话，不能像系统通知 */
export function duelInvite(cmp, name = '') {
  const pct = Math.round(clamp01(cmp?.mineAccuracy) * 100)
  const who = name ? `${name} ` : ''
  return `${who}在赛博禅寺第 ${cmp?.round || 0} 炷敲了 ${pct}% 合拍率。同一张节拍表，点开就是同一炷 —— 你敢不敢对一次？`
}

/** 战帖链接：查询串比 hash 更容易被各平台识别成「可点的链接」 */
export function duelPath(code) {
  const c = String(code || '').trim()
  return c ? `?duel=${encodeURIComponent(c)}` : ''
}

export function duelUrl(code, origin = 'https://cyberbuddha.ai') {
  const base = String(origin || '').replace(/\/+$/, '')
  return base + '/' + duelPath(code)
}
