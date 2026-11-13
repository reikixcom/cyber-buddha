/**
 * 公开随机信标 —— 让「今天用哪套节拍」不再由本机说了算。
 *
 * 取 drand quicknet（League of Entropy 的阈值签名网络）每天 UTC 00:00
 * 那一轮的公开随机值，派生出当日种子。任何人拿着回执里的日期与轮次，
 * 都能到任意公开端点查回同一个值，确认项目方既没提前挑过、也没事后改过。
 *
 * 安全边界（务必如实说）：
 *  - 本项目前端不做 BLS 阈值签名验签，代价是「相信至少两个独立中继没串通」。
 *    它比本机日期强得多，但仍不是密码学上的免信任；官方 CLI / 客户端可以
 *    用链公钥对签名做完整验签，UI 里给了直达该轮的链接方便人工复核。
 *  - 连不上信标时明确降级为「本机日期种子」，并在回执里标记为弱验证，
 *    绝不拿本机值伪装成公开随机值。
 *
 * 纯函数与网络层分开：所有规则计算都能在 node --test 里对拍。
 */
import { sha256BytesHex } from './seal.js'

/** quicknet：3 秒一轮，unchained G1 签名，创世时间由 /info 实测确认 */
export const BEACON_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971'
export const BEACON_GENESIS = 1692803367
export const BEACON_PERIOD = 3
export const BEACON_MIN_SOURCES = 2
export const BEACON_CACHE_KEY = 'cyber-temple-beacon-v1'

/** 四个彼此独立的中继，取自 drand 官方与 Cloudflare 运营的节点 */
export const BEACON_RELAYS = [
  { id: 'drand 主网', url: 'https://api.drand.sh' },
  { id: 'drand 欧洲', url: 'https://api2.drand.sh' },
  { id: 'drand 亚洲', url: 'https://api3.drand.sh' },
  { id: 'Cloudflare', url: 'https://drand.cloudflare.com' }
]

/** 按 UTC 换日：全球同一天用同一套功课，别人复算才没有时区歧义 */
export function utcDayKey(d = new Date()) {
  return d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
}

export function isDayTag(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
}

/** round = floor((时刻 - 创世) / 周期) + 1；取当日 UTC 00:00 已发布的那一轮 */
export function beaconRoundForDay(dayTag) {
  if (!isDayTag(dayTag)) return 0
  const t = Date.parse(`${dayTag}T00:00:00Z`) / 1000
  return Math.floor((t - BEACON_GENESIS) / BEACON_PERIOD) + 1
}

/** 当日种子 = 公开随机值前 32 bit。seedFrom / makePattern / settle 一行都不用改 */
export function beaconSeedFromRandomness(hex) {
  return typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)
    ? (parseInt(hex.slice(0, 8), 16) >>> 0)
    : null
}

/** 离线降级：退回本机日期整数，与 v1 回执同口径，回执里显式标记 */
export function fallbackDaySeed(dayTag) {
  return Number(dayTag.replace(/-/g, ''))
}

export function beaconUrl(relay, round) {
  return `${relay.replace(/\/$/, '')}/${BEACON_CHAIN}/public/${round}`
}

/** 任何人点开就能看到该轮官方返回值，也可自行用 drand CLI 验签 */
export function beaconPublicUrl(round) {
  return beaconUrl(BEACON_RELAYS[0].url, round)
}

function hexBytes(hex) {
  const out = []
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

/**
 * 校验单条信标响应：轮次对得上、字段格式合法，且
 * randomness 确实是 signature 的 SHA-256（drand 对 unchained 链的定义）。
 */
export function parseBeacon(payload, expectedRound) {
  let j = payload
  if (typeof j === 'string') {
    try { j = JSON.parse(j) } catch { return null }
  }
  if (!j || typeof j !== 'object') return null
  const { round, randomness, signature } = j
  if (round !== expectedRound) return null
  if (typeof randomness !== 'string' || !/^[0-9a-f]{64}$/.test(randomness)) return null
  if (typeof signature !== 'string' || !/^[0-9a-f]{96}$/.test(signature)) return null
  if (sha256BytesHex(hexBytes(signature)) !== randomness) return null
  return { round, randomness, signature, seed: beaconSeedFromRandomness(randomness) }
}

/**
 * 并发查询所有中继，只采信「至少两个独立端点一致」的那个随机值；
 * 只要出现分歧或不足两源，就返回 null，交给调用方降级，不赌单源。
 */
export async function fetchDayBeacon(dayTag, opts = {}) {
  if (!isDayTag(dayTag)) return null
  const {
    fetchImpl = globalThis.fetch,
    relays = BEACON_RELAYS,
    timeoutMs = 7000
  } = opts
  if (typeof fetchImpl !== 'function') return null
  const round = beaconRoundForDay(dayTag)

  const results = await Promise.all(relays.map(async (r) => {
    try {
      const init = { cache: 'no-store' }
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        init.signal = AbortSignal.timeout(timeoutMs)
      }
      const res = await fetchImpl(beaconUrl(r.url, round), init)
      if (!res || !res.ok) return null
      const b = parseBeacon(await res.json(), round)
      return b ? { ...b, source: r.id } : null
    } catch { return null }
  }))

  const groups = new Map()
  for (const b of results.filter(Boolean)) {
    if (!groups.has(b.randomness)) groups.set(b.randomness, [])
    groups.get(b.randomness).push(b)
  }
  if (groups.size !== 1) return null
  const agreed = [...groups.values()][0]
  if (agreed.length < BEACON_MIN_SOURCES) return null
  return {
    day: dayTag,
    round,
    randomness: agreed[0].randomness,
    signature: agreed[0].signature,
    seed: agreed[0].seed,
    sources: agreed.map((g) => g.source),
    status: 'public'
  }
}

/** 把一张回执与公开信标对账：轮次该是哪一轮、当轮随机值能否推出回执里的种子 */
export async function checkSealBeacon(seal, opts = {}) {
  if (!seal || seal.version !== 2 || !seal.beaconRound || !isDayTag(seal.dayTag)) {
    return { ok: false, reason: '这张回执没有公开信标字段（可能是本机弱验证或旧版回执）' }
  }
  const expected = beaconRoundForDay(seal.dayTag)
  if (seal.beaconRound !== expected) {
    return { ok: false, reason: `信标轮次对不上：${seal.dayTag} 应为第 ${expected} 轮，回执写的是第 ${seal.beaconRound} 轮` }
  }
  const b = await fetchDayBeacon(seal.dayTag, opts)
  if (!b) return { ok: false, reason: '暂时连不上公开信标（可稍后重试，或点官方链接人工核对）' }
  const seedHex = (seal.daySeed >>> 0).toString(16).padStart(8, '0')
  if (b.randomness.slice(0, 8) !== seedHex) {
    return { ok: false, reason: `公开随机值推不出这枚种子：官方 ${b.randomness.slice(0, 8)} ≠ 回执 ${seedHex}`, beacon: b }
  }
  return {
    ok: true,
    reason: `${b.sources.length} 个独立端点一致 · 第 ${b.round} 轮公开随机值确实推出这枚当日种子`,
    beacon: b
  }
}

/** 本机缓存只用于「首屏立刻能开局」，不作为验证结论；每天只认当天的 */
export function loadCachedBeacon(dayTag = utcDayKey()) {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = JSON.parse(localStorage.getItem(BEACON_CACHE_KEY) || 'null')
    if (!raw || raw.day !== dayTag || raw.round !== beaconRoundForDay(dayTag)) return null
    if (typeof raw.randomness !== 'string' || !/^[0-9a-f]{64}$/.test(raw.randomness)) return null
    if (beaconSeedFromRandomness(raw.randomness) !== raw.seed) return null
    return { ...raw, sources: Array.isArray(raw.sources) ? raw.sources : [], status: 'cached' }
  } catch { return null }
}

export function cacheBeacon(b) {
  try {
    if (typeof localStorage === 'undefined' || !b || b.status !== 'public') return
    localStorage.setItem(BEACON_CACHE_KEY, JSON.stringify({
      day: b.day, round: b.round, randomness: b.randomness,
      signature: b.signature, seed: b.seed, sources: b.sources
    }))
  } catch { /* 隐私模式下忽略 */ }
}
