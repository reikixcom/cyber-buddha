/**
 * 香火账本规则 —— 纯函数，不依赖 Vue / DOM。
 *
 * 核心区分（这是整个经济不塌的关键）：
 *   · 增发型 emit     ：四法器、共修结算、开光奖池 —— 凭空产生新币，必须受每日额度约束
 *   · 转移型 transfer ：挂单托管、代诵领赏、随喜加香、流单退还 —— 玩家之间转手，不增发，不占额度
 *
 * 若把两边混在一起，双边市场会被每日额度卡死；若增发不设上限，
 * 四法器连点就能无限刷，后面所有数值都失去意义。
 */

/** 四法器：单次基础功德、单日次数上限、同一法器冷却 */
export const RITUALS = {
  incense: { label: '上香', base: 10, cap: 8, cooldownMs: 6000 },
  bow: { label: '叩拜', base: 20, cap: 6, cooldownMs: 6000 },
  fish: { label: '木鱼', base: 1, cap: 20, cooldownMs: 2500 },
  bell: { label: '晨钟', base: 5, cap: 6, cooldownMs: 8000 }
}

/** 每日增发软上限：额度内全额，之后分三档衰减，两倍额度后归零 */
export const DAILY_CAP = 600
/** 同一法器重复修行的收益递减下限 */
const MIN_REPEAT = 0.35

/** 本地日期键，跨天自动重置当日额度 */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function freshDaily() {
  return { day: dayKey(), earned: 0, used: {}, last: {} }
}

export function normalizeDaily(raw) {
  const base = freshDaily()
  if (!raw || raw.day !== base.day) return base
  return {
    day: base.day,
    earned: Number(raw.earned) || 0,
    used: raw.used && typeof raw.used === 'object' ? raw.used : {},
    last: raw.last && typeof raw.last === 'object' ? raw.last : {}
  }
}

/** 增发系数：1 → 0.5 → 0.2 → 0 */
export function emitFactor(earned) {
  if (earned < DAILY_CAP) return 1
  if (earned < DAILY_CAP * 1.5) return 0.5
  if (earned < DAILY_CAP * 2) return 0.2
  return 0
}

export function emitCredit(earned, amount) {
  return Math.max(0, Math.round(amount * emitFactor(earned)))
}

/**
 * 判定一次四法器修行能否计功德。
 * 冷却与上限只挡「计数」，不挡 3D 动画与音效，避免玩家以为点坏了。
 */
export function ritualCheck(type, daily, now = Date.now()) {
  const def = RITUALS[type]
  if (!def) return { ok: false, reason: 'unknown' }
  const used = daily.used[type] || 0
  if (used >= def.cap) return { ok: false, reason: 'cap', used, cap: def.cap }
  const last = daily.last[type] || 0
  const wait = def.cooldownMs - (now - last)
  if (wait > 0) return { ok: false, reason: 'cooldown', wait: Math.ceil(wait / 1000) }
  const factor = emitFactor(daily.earned)
  if (factor <= 0) return { ok: false, reason: 'daily' }
  const repeat = Math.max(MIN_REPEAT, 1 - 0.12 * used)
  return { ok: true, amount: Math.max(1, Math.round(def.base * repeat * factor)), used, cap: def.cap, factor }
}

/** 记账：成功后调用，更新次数、冷却时间与当日增发量 */
export function applyRitual(daily, type, amount, now = Date.now()) {
  daily.used[type] = (daily.used[type] || 0) + 1
  daily.last[type] = now
  daily.earned += amount
  return amount
}

/** 心愿悬赏：功德量由挂单人自己定，同时决定代诵需要敲多少下 */
export const BOUNTY_MIN = 10
export const BOUNTY_MAX = 500
export const BOUNTY_TIERS = [20, 50, 100, 200]
export const HITS_PER_G = 6
/** 六炷香无人接单即流单，托管原额退还 */
export const WISH_STICK_LIMIT = 6

export function needFor(bounty) {
  return Math.min(3000, Math.max(60, Math.round(bounty * HITS_PER_G)))
}

export function clampBounty(n) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return BOUNTY_MIN
  return Math.min(BOUNTY_MAX, Math.max(BOUNTY_MIN, v))
}

/**
 * 多人共诵：悬赏不是「谁抢到谁独得」，而是按有效击数分。
 * 人越多送达越快，人均越少 —— 与「一炷香人越多人均越少」同一条规矩。
 */
export function shareOf(bounty, myHits, totalHits) {
  if (!myHits || !totalHits) return 0
  return Math.min(Math.max(0, Math.floor(bounty)), Math.floor(bounty * myHits / totalHits))
}

/** 六炷未诵满：只按已诵比例结算给共修者，余款退还挂单人，钱不会凭空消失 */
export function earnedPart(bounty, progress, need) {
  if (!need) return 0
  return Math.min(Math.max(0, Math.floor(bounty)), Math.floor(bounty * Math.min(progress, need) / need))
}

/** 常住共修愿：寺院公愿，永远有人一起敲 */
export const TEMPLE_NEED = 360
export const TEMPLE_POOL_BASE = 30
export const TEMPLE_POOL_PER_OPENING = 10
