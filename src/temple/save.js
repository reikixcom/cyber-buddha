/**
 * 本机存档 —— 纯函数，不依赖 Vue / DOM。
 *
 * 只持久化「不能靠重算拿回来」的东西：玩家挂单托管的功德、心愿的
 * 已诵击数、共诵者贡献、长明灯与常住愿池。节拍表本身由 daySeed +
 * round 确定性生成，不进存档。
 *
 * 存档来自用户自己的 localStorage，也可能被手工改过，所以读取时
 * 一律走 sanitize：数字夹到合法区间、字符串截断、数组限量，
 * 坏档直接返回 null 让上层用默认市场，绝不让脏数据把场景搞崩。
 */

export const SAVE_VERSION = 2

const clampNum = (v, fallback, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
const clampStr = (v, fallback, max) =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : fallback

const MAX_WISHES = 12
const WISH_LIMIT = 6

function sanitizeContributors(raw, ceiling) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [name, hits] of Object.entries(raw).slice(0, 24)) {
    const n = clampNum(hits, 0, 0, ceiling)
    if (n > 0) out[clampStr(name, '共修者', 12)] = n
  }
  return out
}

/** 单条心愿：显式白名单，避免把响应式代理或未知字段写进存档 */
export function sanitizeWish(raw) {
  if (!raw || typeof raw !== 'object') return null
  const temple = raw.kind === 'temple'
  const bounty = clampNum(raw.bounty, 20, 10, 3000) // 随喜加香可超过挂单上限
  const need = clampNum(raw.need, 120, 60, 3000)
  const progress = clampNum(raw.progress, 0, 0, need)
  const contributors = sanitizeContributors(raw.contributors, need)
  const names = Object.keys(contributors)
  const done = !!raw.done
  return {
    id: clampNum(raw.id, 0, 1, 1e9),
    kind: temple ? 'temple' : 'user',
    text: clampStr(raw.text, '愿众生离苦得乐', 24),
    owner: clampStr(raw.owner, '共修者', 16),
    bounty,
    need,
    progress,
    contributors,
    crowd: names.length,
    worker: names.sort((a, b) => contributors[b] - contributors[a])[0] || null,
    mine: !temple && !!raw.mine,
    done,
    expired: !!raw.expired,
    sticks: clampNum(raw.sticks, 0, 0, WISH_LIMIT),
    postedAt: Date.now(), // 离线期间不计时：有效期按在线「炷」算，不按墙钟
    cycle: clampNum(raw.cycle, 1, 1, 9999),
    boosts: clampNum(raw.boosts, 0, 0, 999),
    ...(done ? {
      deliveredAt: Date.now(),
      earned: clampNum(raw.earned, 0, 0, bounty),
      refund: clampNum(raw.refund, 0, 0, bounty)
    } : {})
  }
}

/** 从 reactive 状态取快照；只取白名单字段 */
export function snapshotPractice(p) {
  if (!p || !Array.isArray(p.wishes)) return null
  return {
    v: SAVE_VERSION,
    lamp: clampNum(p.lamp, 55, 0, 100),
    openings: clampNum(p.openings, 0, 0, 9999),
    templePool: clampNum(p.templePool, 30, 0, 99999),
    templeCycles: clampNum(p.templeCycles, 1, 1, 9999),
    activeWishId: clampNum(p.activeWishId, 0, 0, 1e9),
    wishes: p.wishes.slice(0, MAX_WISHES).map(sanitizeWish).filter(Boolean)
  }
}

/**
 * 读档校验。没有常住愿、或结构明显不对时返回 null，
 * 上层保持刚初始化的默认市场，玩家最多损失进度，不会进到坏状态。
 */
export function sanitizePracticeSave(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION) return null
  const wishes = Array.isArray(raw.wishes)
    ? raw.wishes.slice(0, MAX_WISHES).map(sanitizeWish).filter(Boolean)
    : []
  const temples = wishes.filter((w) => w.kind === 'temple')
  if (temples.length !== 1) return null
  const ids = new Set()
  const clean = []
  for (const w of wishes) {
    if (!w.id || ids.has(w.id)) continue
    ids.add(w.id)
    clean.push(w)
  }
  const activeWishId = clean.some((w) => w.id === Number(raw.activeWishId) && !w.done)
    ? Number(raw.activeWishId) : temples[0].id
  return {
    v: SAVE_VERSION,
    lamp: clampNum(raw.lamp, 55, 0, 100),
    openings: clampNum(raw.openings, 0, 0, 9999),
    templePool: clampNum(raw.templePool, 30, 0, 99999),
    templeCycles: clampNum(raw.templeCycles, 1, 1, 9999),
    activeWishId,
    wishes: clean
  }
}
