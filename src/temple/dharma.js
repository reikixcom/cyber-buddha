/**
 * 法会与连修 —— 纯函数，时间一律从参数进，方便测试，也方便离线。
 *
 * 为什么需要这一层：这座寺没有服务器，也就没有「每日活动」这种运营位。
 * 但活动恰恰是让人第二天回来的东西。解法是把活动写进规则里，而不是写进
 * 后台配置里 —— 每天三场法会，本地时间固定，谁都能提前算出下一场几点开：
 *
 *   晨课 06:00 · 午课 12:00 · 晚课 21:00   每场 12 分钟，期间修行功德 ×2
 *
 * 同一个时间窗口对所有人成立，不需要任何人去「开启」它，也不需要谁批准。
 * 这比后台开关更硬：只要前端代码没改，法会就一定开。
 *
 * 连修同理。断一天归零，是损失厌恶；但这里不给额外功德 —— 连修只是
 * 身份，不给钱。给了钱就得有人印发，而这套账里没有印发者。
 */

import { dayKey } from './economy.js'

/** 每场法会持续多久（分钟） */
export const ASSEMBLY_MINUTES = 12
/** 法会期间修行功德的倍数 */
export const ASSEMBLY_MULT = 2

/**
 * 三场法会。hour/minute 是本地时间，刻意选在通勤、午休、睡前三个真实空档，
 * 而不是「全天开放」—— 限时才有人愿意专门来一趟。
 */
export const ASSEMBLIES = [
  { id: 'morning', label: '晨课', hour: 6, minute: 0 },
  { id: 'noon', label: '午课', hour: 12, minute: 0 },
  { id: 'evening', label: '晚课', hour: 21, minute: 0 }
]

const MIN_MS = 60 * 1000
/** 一天 24 小时的毫秒数：算「明日晨课」用 */
const DAY_MS = 24 * 60 * MIN_MS

function toTime(now) {
  if (now instanceof Date) return now.getTime()
  const n = Number(now)
  return Number.isFinite(n) ? n : Date.now()
}

function startOfDay(ts) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 某一日某场法会的起止时间戳；dayStart 必须是当地 0 点 */
function slotAt(slot, dayStart) {
  const start = dayStart + (slot.hour * 60 + slot.minute) * MIN_MS
  return { ...slot, start, end: start + ASSEMBLY_MINUTES * MIN_MS }
}

/**
 * 当前处在哪一场法会里，或者下一场什么时候开。
 * 返回扁平结构，模板里直接取字段，不用再判空。
 */
export function assemblyAt(now = new Date()) {
  const t = toTime(now)
  const dayStart = startOfDay(t)

  let active = null
  let next = null
  for (const slot of ASSEMBLIES) {
    const s = slotAt(slot, dayStart)
    if (t >= s.start && t < s.end) active = s
    else if (s.start > t && !next) next = s
  }

  // 今天已经没有下一场了（晚课之后），下一场是明日晨课
  let tomorrow = false
  if (!next) {
    next = slotAt(ASSEMBLIES[0], dayStart + DAY_MS)
    tomorrow = true
  }

  if (active) {
    return {
      active: true,
      id: active.id,
      label: active.label,
      mult: ASSEMBLY_MULT,
      msLeft: active.end - t,
      nextId: next.id,
      nextLabel: next.label,
      nextAt: next.start,
      msToNext: next.start - t,
      nextTomorrow: tomorrow
    }
  }

  return {
    active: false,
    id: '',
    label: '',
    mult: 1,
    msLeft: 0,
    nextId: next.id,
    nextLabel: next.label,
    nextAt: next.start,
    msToNext: next.start - t,
    nextTomorrow: tomorrow
  }
}

/** 倒计时：法会最多 12 分钟，只用 mm:ss 就够，别在 HUD 里塞小时 */
export function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) / 1000) || 0)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 时刻：21:00 */
export function fmtClock(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 法会结束前的最后几分钟值得单独提醒一次，别让人差 30 秒没赶上 */
export const ASSEMBLY_ALMOST_MS = 2 * MIN_MS

/** 距离开场不足 10 分钟时，值得在界面上提一句「快开始了」 */
export const ASSEMBLY_SOON_MS = 10 * MIN_MS

// ------------------------------------------------------------------ 连修

/** YYYY-MM-DD → UTC 零点毫秒；只用来做天数差，不参与任何展示 */
function keyToUtc(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return NaN
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const ts = Date.UTC(y, mo - 1, d)
  // 2026-13-01 / 2027-02-29 会被 Date 自动进位成别的日子，回读对不上就判非法
  const back = new Date(ts)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN
  return ts
}

/** b - a，单位天；任一不合法返回 NaN */
export function dayDiff(a, b) {
  const x = keyToUtc(a)
  const y = keyToUtc(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN
  return Math.round((y - x) / DAY_MS)
}

export function freshStreak() {
  return { days: 0, best: 0, last: '' }
}

/** 读档用：只收合法形状，不推进日期。推进只发生在 streakUpdate 里 */
export function normalizeStreak(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const days = Math.min(1e5, Math.max(0, Math.floor(Number(src.days) || 0)))
  const best = Math.min(1e5, Math.max(days, Math.floor(Number(src.best) || 0)))
  const last = typeof src.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.last) ? src.last : ''
  return { days, best, last }
}

/**
 * 把「今天来过了」记进连修。
 *
 *   last = 今天      → 不变（同一天反复刷新不该叠加）
 *   last = 昨天      → +1
 *   last 更早 / 无   → 归 1
 *   last 在未来     → 不动（用户把系统时间往回拨了，别借此刷天数）
 *
 * 返回全新对象，不改入参：存档里的东西只在 save() 里落盘。
 */
export function streakUpdate(prev, today = dayKey()) {
  const src = prev && typeof prev === 'object' ? prev : {}
  const days = Math.max(0, Math.floor(Number(src.days) || 0))
  const best = Math.max(0, Math.floor(Number(src.best) || 0))
  const last = typeof src.last === 'string' ? src.last : ''

  if (last === today) return { days, best: Math.max(best, days), last, changed: false }

  const gap = last ? dayDiff(last, today) : NaN
  if (Number.isFinite(gap) && gap <= 0) {
    // 时间被拨回，或存档里是未来日期：保持原样，不奖励也不惩罚
    return { days, best: Math.max(best, days), last, changed: false }
  }

  const nextDays = gap === 1 ? days + 1 : 1
  return { days: nextDays, best: Math.max(best, nextDays), last: today, changed: true }
}

/** 连修到第几天该被祝贺一次 —— 只在这几个节点打断玩家，否则天天弹就等于没弹 */
export const STREAK_MARKS = [3, 7, 30, 100, 365]
export function streakMark(days) {
  return STREAK_MARKS.includes(days) ? days : 0
}

// ------------------------------------------------------------------ 偈语

/**
 * 每日一偈。内容运营的最小形态：不接 CMS，不接后台，
 * 偈语写死在代码里，按日期确定性取一条 —— 同一天谁看都一样。
 */
export const DAILY_VERSES = [
  '色即是空，空即是数据',
  '木鱼一响，BUG 消亡',
  '服务器即道场，日志即经文',
  '万物皆可上链，唯因果不可篡改',
  '香火不问出处，功德只认真心',
  '一念三千线程，弹指八万 Bug',
  '心跳不停，即是无常',
  '代码会腐，钟声不会',
  '求签不如求己，求己不如落拍',
  '万法归一，一归延迟',
  '断网亦是闭关',
  '未有服务器时，谁在敲这一记',
  '缓存会过期，因果不会',
  '众生皆在队列，谁先出队谁说',
  '不必开悟，先把这一炷敲完',
  '空不是没有，是没有依赖',
  '一记木鱼一次提交，禅在 diff 里',
  '备份即是无常观'
]

/** 日期 → 偈语；同一个 dayKey 永远同一条，换日必换（hash 分散得开） */
export function verseOfDay(key = dayKey()) {
  const s = String(key)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return DAILY_VERSES[h % DAILY_VERSES.length]
}

/** 一句能直接贴进 HUD 的法会文案；detail=false 时给窄屏用的短版 */
export function assemblyText(asm, detail = true) {
  if (!asm) return ''
  if (asm.active) {
    return detail
      ? `${asm.label}进行中 · 修行功德 ×${asm.mult} · 剩 ${fmtCountdown(asm.msLeft)}`
      : `${asm.label} ×${asm.mult} · ${fmtCountdown(asm.msLeft)}`
  }
  const when = asm.nextTomorrow ? '明日' : ''
  return detail
    ? `${when}${asm.nextLabel} ${fmtClock(asm.nextAt)} 开 · 修行功德 ×${ASSEMBLY_MULT}`
    : `${when ? when + ' ' : ''}${fmtClock(asm.nextAt)}`
}
