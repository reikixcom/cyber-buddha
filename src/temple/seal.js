/**
 * 禅印（Zen Seal）—— 一炷香一张回执，任何人都能独立复算。
 *
 * 这是「敲木鱼就是出块」从文案落到机制的地方：
 * 每炷香结束时，把「第几炷 / 当日种子 / 64 拍判定 / 在场人数 / 结算结果 /
 * 上一张回执的短码」串成一条链，算出一个校验码。
 * 别人拿到这串文本，用同一份开源规则重算节拍表与结算，就能验证
 * 「按寺规，这串敲击记录确实该得这些功德」，以及链有没有被改过。
 *
 * 边界说清楚：这是本地原型的弱验证。它防的是回执在粘贴、转发、存档中
 * 被改动，不证明「真人真的敲了」——没有服务端与可信时钟，本机数据本来
 * 就能自己造。正式版把 daySeed 换成公开随机信标即可，判定与结算不用改。
 *
 * 纯函数：不依赖 Vue / DOM / Web Crypto，Node 与浏览器算出的结果完全一致，
 * 所以规则可以直接用 node --test 对拍。
 */
import { seedFrom, makePattern, settle, BEATS_PER_STICK } from './rhythm.js'

export const SEAL_PREFIX = 'CT1'
export const LEDGER_PREFIX = 'CTL1'
export const SEAL_SHORT_LEN = 16

/* ------------------------------------------------------------------ *
 * 同步 SHA-256。回执规范串只含 ASCII，但这里仍按 UTF-8 编码，
 * 保证任何输入下浏览器与 Node 的结果一致。
 * ------------------------------------------------------------------ */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])

function utf8Bytes(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i)
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

export function sha256Hex(msg) {
  const bytes = utf8Bytes(String(msg))
  const hi = Math.floor(bytes.length / 0x20000000)
  const lo = (bytes.length * 8) >>> 0
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255)
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255)

  const H = H0.slice()
  const w = new Uint32Array(64)
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3]
    let e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('')
}

/* ------------------------------------------------------------------ *
 * 紧凑编码：base64url，无 padding。回执规范串全是 ASCII，
 * 解码时直接按字节还原字符即可，不需要平台相关的 atob / Buffer。
 * ------------------------------------------------------------------ */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function b64encode(str) {
  const bytes = utf8Bytes(str)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += B64[c & 63]
  }
  return out
}

function b64decode(s) {
  const bytes = []
  let acc = 0, bits = 0
  for (const ch of s) {
    const v = B64.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
  }
  return String.fromCharCode(...bytes)
}

/** 带校验码的打包 / 拆包；hash 覆盖规范串本身，改一个字符就会露馅 */
function pack(prefix, body) {
  const canonical = `${prefix}.${body}`
  return `${canonical}.${sha256Hex(canonical).slice(0, SEAL_SHORT_LEN)}`
}
function unpack(text, prefix) {
  if (typeof text !== 'string') return null
  const s = text.trim()
  if (!s.startsWith(prefix + '.')) return null
  const parts = s.split('.')
  if (parts.length !== 3 || !/^[0-9a-f]{16}$/.test(parts[2])) return null
  if (sha256Hex(`${parts[0]}.${parts[1]}`).slice(0, SEAL_SHORT_LEN) !== parts[2]) return null
  return { body: parts[1], short: parts[2], decoded: b64decode(parts[1]) }
}

/* ------------------------------------------------------------------ *
 * 回执
 * ------------------------------------------------------------------ */
/** 64 拍判定压成 64 个字符：P=perfect, G=good, M=miss（含自动漏拍） */
export function encodeMarks(pattern, marks) {
  let out = ''
  for (const b of pattern.beats) {
    const g = marks[b.index]
    out += g === 'perfect' ? 'P' : g === 'good' ? 'G' : 'M'
  }
  return out
}
function decodeMarks(m) {
  const marks = {}
  for (let i = 0; i < m.length; i++) {
    marks[i] = m[i] === 'P' ? 'perfect' : m[i] === 'G' ? 'good' : 'miss'
  }
  return marks
}

const round4 = (n) => Math.round(n * 10000) / 10000
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max

/**
 * 造一张回执。prev 传上一张的短码，串成一条链。
 * payload 用定长数组而非对象，是为了让回执短到能直接贴进聊天框。
 * [版本, 第几炷, 日种子, 节拍种子, 64拍, 乱敲数, 在场人数, 合拍率, 功德, 前序短码, 时间戳秒]
 */
export function makeSeal({ round, daySeed, pattern, marks, wild = 0, online, result, prev = '', at = Date.now() }) {
  const payload = [
    1,
    round | 0,
    daySeed | 0,
    pattern.seed >>> 0,
    encodeMarks(pattern, marks),
    Math.max(0, wild | 0),
    Math.max(0, online | 0),
    round4(result.accuracy),
    Math.round(result.reward),
    typeof prev === 'string' ? prev.slice(0, SEAL_SHORT_LEN) : '',
    Math.floor(at / 1000)
  ]
  const text = pack(SEAL_PREFIX, b64encode(JSON.stringify(payload)))
  return {
    text,
    short: text.slice(-SEAL_SHORT_LEN),
    round, daySeed, seed: pattern.seed, marks: payload[4], wild: payload[5],
    online: payload[6], accuracy: payload[7], reward: payload[8], prev: payload[9], at: payload[10],
    perfect: result.perfect, good: result.good, miss: result.miss
  }
}

/** 独立复算：不信任回执里的任何结论，只按种子重建节拍表再跑一次结算 */
export function verifySeal(text) {
  const fail = (reason) => ({ ok: false, reason, seal: null })
  const u = unpack(text, SEAL_PREFIX)
  if (!u) return fail('不是有效的禅印回执，或校验码不符 —— 文本可能被改动、截断')
  let a
  try { a = JSON.parse(u.decoded) } catch { return fail('回执内容无法解析') }
  if (!Array.isArray(a) || a.length !== 11 || a[0] !== 1) return fail('回执版本或字段数不对')

  const [v, round, daySeed, seed, m, wild, online, acc, reward, prev, at] = a
  if (!isInt(round, 1, 1e7) || !isInt(daySeed, 20000101, 99991231) ||
      !isInt(seed, 0, 0xffffffff) || !isInt(wild, 0, 1e5) || !isInt(online, 0, 1e7) ||
      !isInt(reward, 0, 10000) || !isInt(at, 0, 1e12) ||
      typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0 || acc > 1 ||
      typeof prev !== 'string' || (prev !== '' && !/^[0-9a-f]{1,16}$/.test(prev))) {
    return fail('回执字段超出合法范围')
  }
  if (typeof m !== 'string' || m.length !== BEATS_PER_STICK || /[^PGM]/.test(m)) {
    return fail(`敲击记录应为 ${BEATS_PER_STICK} 拍的 P/G/M 串`)
  }
  if (seed !== seedFrom(round, daySeed)) {
    return fail(`第 ${round} 炷在 ${daySeed} 这天的节拍种子对不上`)
  }

  const pattern = makePattern(seed)
  const r = settle(pattern, decodeMarks(m), online)
  if (round4(r.accuracy) !== acc || Math.round(r.reward) !== reward) {
    return fail(`按寺规复算不一致：应为合拍率 ${round4(r.accuracy)} / ${Math.round(r.reward)} $G`)
  }

  return {
    ok: true,
    reason: '校验通过 · 节拍表、判定与功德均可由开源规则复算',
    seal: {
      text: `${SEAL_PREFIX}.${u.body}.${u.short}`,
      short: u.short, round, daySeed, seed, marks: m, wild, online,
      accuracy: acc, reward, prev, at,
      perfect: r.perfect, good: r.good, miss: r.miss
    }
  }
}

/**
 * 逐张验链：每张自身合法，且 prev 必须接上一张的短码。
 * ignoreFirstPrev 用于「本机只留最近 N 张」的展示场景：第一张的前序
 * 已被裁掉，跳过它的 prev 检查，其余各张仍严格串起来。
 */
export function verifyChain(texts, { ignoreFirstPrev = false } = {}) {
  const items = []
  if (!Array.isArray(texts)) return { ok: false, reason: '链不是数组', items, brokenAt: -1 }
  let prev = ignoreFirstPrev ? null : ''
  for (let i = 0; i < texts.length; i++) {
    const v = verifySeal(texts[i])
    if (!v.ok) return { ok: false, reason: `第 ${i + 1} 张：${v.reason}`, items, brokenAt: i }
    if (prev !== null && v.seal.prev !== prev) {
      return { ok: false, reason: `第 ${i + 1} 张的前序短码接不上（链断了）`, items, brokenAt: i }
    }
    items.push(v.seal)
    prev = v.seal.short
  }
  return { ok: true, reason: `${items.length} 张回执连成一条完整的链`, items, brokenAt: -1 }
}

/** 只取短码，用于 UI 列表与链拼接；不合法返回空串 */
export function shortOf(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  const parts = s.split('.')
  return parts.length === 3 && /^[0-9a-f]{16}$/.test(parts[2]) ? parts[2] : ''
}

/* ------------------------------------------------------------------ *
 * 账本：把整份本机存档打包成可复制的一行文本，用于换设备续修。
 * 同样只防传输损坏，不防自己改存档 —— 原型本来就没有服务端。
 * ------------------------------------------------------------------ */
export function packLedger(saveObj) {
  return pack(LEDGER_PREFIX, b64encode(JSON.stringify(saveObj)))
}
export function unpackLedger(text) {
  const u = unpack(text, LEDGER_PREFIX)
  if (!u || u.decoded === null) return null
  try {
    const obj = JSON.parse(u.decoded)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch { return null }
}
