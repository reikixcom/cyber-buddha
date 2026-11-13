/**
 * 法会与连修的规则锁。
 *
 * 这两样东西是「让人第二天回来」的机制，最怕的是悄悄算错：
 * 法会窗口差一分钟，玩家会以为被骗；连修差一天，玩家会以为被清空。
 * 所以边界时间全部写成断言 —— 05:59:59 / 06:00:00 / 06:11:59 / 06:12:00。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSEMBLIES, ASSEMBLY_MINUTES, ASSEMBLY_MULT,
  assemblyAt, fmtCountdown, fmtClock, assemblyText,
  dayDiff, freshStreak, normalizeStreak, streakUpdate, streakMark, STREAK_MARKS,
  verseOfDay, DAILY_VERSES
} from '../src/temple/dharma.js'

/** 本地时间的构造器：断言依赖当地 0 点，不能用 UTC 字符串 */
const at = (h, m = 0, s = 0, d = 13) => new Date(2026, 10, d, h, m, s, 0)

// ---------------------------------------------------------------- 法会

test('三场法会：晨课 6 点、午课 12 点、晚课 21 点，每场 12 分钟', () => {
  assert.deepEqual(ASSEMBLIES.map((a) => [a.label, a.hour, a.minute]), [
    ['晨课', 6, 0], ['午课', 12, 0], ['晚课', 21, 0]
  ])
  assert.equal(ASSEMBLY_MINUTES, 12)
  assert.equal(ASSEMBLY_MULT, 2)
})

test('开场整点就算在法会里，不是差一秒', () => {
  const a = assemblyAt(at(6, 0, 0))
  assert.equal(a.active, true)
  assert.equal(a.label, '晨课')
  assert.equal(a.mult, 2)
  assert.equal(a.msLeft, 12 * 60 * 1000)
})

test('开场前一秒还在场外，且倒计时指向这一场', () => {
  const a = assemblyAt(at(5, 59, 59))
  assert.equal(a.active, false)
  assert.equal(a.mult, 1)
  assert.equal(a.nextLabel, '晨课')
  assert.equal(a.msToNext, 1000)
  assert.equal(a.nextTomorrow, false)
})

test('结束那一秒已经散场，下一场顶上来', () => {
  const last = assemblyAt(at(6, 11, 59))
  assert.equal(last.active, true)
  assert.equal(last.msLeft, 1000)

  const after = assemblyAt(at(6, 12, 0))
  assert.equal(after.active, false)
  assert.equal(after.nextLabel, '午课')
  assert.equal(after.msToNext, (12 - 6) * 60 * 60 * 1000 - 12 * 60 * 1000)
})

test('晚课之后只报明日晨课，不会算出 30 点', () => {
  const a = assemblyAt(at(23, 59, 0))
  assert.equal(a.active, false)
  assert.equal(a.nextLabel, '晨课')
  assert.equal(a.nextTomorrow, true)
  // 23:59 → 次日 06:00 是 6 小时 1 分
  assert.equal(a.msToNext, 6 * 60 * 60 * 1000 + 60 * 1000)
})

test('法会中的下一场指向明天，倒计时为正', () => {
  const a = assemblyAt(at(21, 5, 0))
  assert.equal(a.active, true)
  assert.equal(a.label, '晚课')
  assert.equal(a.msLeft, 7 * 60 * 1000)
  assert.equal(a.nextTomorrow, true)
  assert.ok(a.msToNext > a.msLeft)
})

test('倒计时只到分钟秒，不出现负数', () => {
  assert.equal(fmtCountdown(0), '00:00')
  assert.equal(fmtCountdown(999), '00:01')
  assert.equal(fmtCountdown(12 * 60 * 1000), '12:00')
  assert.equal(fmtCountdown(-5000), '00:00')
  assert.equal(fmtCountdown(undefined), '00:00')
  assert.equal(fmtClock(at(21, 0).getTime()), '21:00')
})

test('文案：进行中说 ×2 和剩余，未开始说几点开', () => {
  const on = assemblyText(assemblyAt(at(6, 3, 0)))
  assert.match(on, /晨课进行中/)
  assert.match(on, /×2/)
  assert.match(on, /09:00/)

  const off = assemblyText(assemblyAt(at(9, 0, 0)))
  assert.match(off, /午课 12:00/)
  assert.doesNotMatch(off, /进行中/)

  const night = assemblyText(assemblyAt(at(23, 0, 0)))
  assert.match(night, /明日晨课 06:00/)
})

test('传入时间戳与 Date 等价', () => {
  const d = at(12, 1)
  assert.deepEqual(assemblyAt(d.getTime()), assemblyAt(d))
})

// ---------------------------------------------------------------- 连修

test('第一次来算第 1 天', () => {
  const s = streakUpdate(freshStreak(), '2026-11-13')
  assert.equal(s.days, 1)
  assert.equal(s.best, 1)
  assert.equal(s.last, '2026-11-13')
  assert.equal(s.changed, true)
})

test('同一天反复刷新不叠加', () => {
  const s1 = streakUpdate(freshStreak(), '2026-11-13')
  const s2 = streakUpdate(s1, '2026-11-13')
  const s3 = streakUpdate(s2, '2026-11-13')
  assert.equal(s3.days, 1)
  assert.equal(s3.changed, false)
})

test('连着来就 +1，断一天从 1 重数，但最佳成绩留着', () => {
  let s = streakUpdate(freshStreak(), '2026-11-11')
  s = streakUpdate(s, '2026-11-12')
  s = streakUpdate(s, '2026-11-13')
  assert.equal(s.days, 3)
  assert.equal(s.best, 3)

  const broken = streakUpdate(s, '2026-11-15')
  assert.equal(broken.days, 1)
  assert.equal(broken.best, 3)
})

test('跨月跨年按日历算，不按 30 天估算', () => {
  let s = streakUpdate(freshStreak(), '2026-02-28')
  s = streakUpdate(s, '2026-03-01')
  assert.equal(s.days, 2)

  let t = streakUpdate(freshStreak(), '2026-12-31')
  t = streakUpdate(t, '2027-01-01')
  assert.equal(t.days, 2)
})

test('系统时间被拨回去：不奖励也不清空', () => {
  const s = streakUpdate({ days: 9, best: 9, last: '2026-11-20' }, '2026-11-13')
  assert.equal(s.days, 9)
  assert.equal(s.last, '2026-11-20')
  assert.equal(s.changed, false)
})

test('脏存档一律兜住，不会出现 NaN 天', () => {
  for (const bad of [null, undefined, {}, { days: 'x', best: -5, last: 123 }, { days: 3 }]) {
    const s = streakUpdate(bad, '2026-11-13')
    assert.ok(Number.isInteger(s.days) && s.days >= 1, `days=${s.days}`)
    assert.ok(Number.isInteger(s.best) && s.best >= s.days - 1)
    assert.equal(s.last, '2026-11-13')
  }
})

test('只在这几个节点祝贺，天天弹等于没弹', () => {
  assert.equal(streakMark(3), 3)
  assert.equal(streakMark(7), 7)
  assert.equal(streakMark(4), 0)
  assert.equal(streakMark(0), 0)
  assert.deepEqual(STREAK_MARKS, [3, 7, 30, 100, 365])
})

test('dayDiff：相邻一天为 1，非法输入为 NaN', () => {
  assert.equal(dayDiff('2026-11-12', '2026-11-13'), 1)
  assert.equal(dayDiff('2026-11-13', '2026-11-13'), 0)
  assert.equal(dayDiff('2026-11-13', '2026-11-01'), -12)
  assert.ok(Number.isNaN(dayDiff('2026-13-01', '2026-11-13')))
  assert.ok(Number.isNaN(dayDiff('', '2026-11-13')))
})

// ---------------------------------------------------------------- 偈语

test('每日一偈：同一天同一条，连续 30 天不会只有一句', () => {
  assert.equal(verseOfDay('2026-11-13'), verseOfDay('2026-11-13'))
  assert.ok(DAILY_VERSES.includes(verseOfDay('2026-11-13')))

  const seen = new Set()
  for (let i = 0; i < 30; i++) {
    const d = new Date(2026, 10, 1 + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    seen.add(verseOfDay(key))
  }
  assert.ok(seen.size >= 12, `30 天只出现 ${seen.size} 条偈语`)
})

test('偈语库都够短：HUD 与分享卡都不会被撑破', () => {
  for (const v of DAILY_VERSES) {
    assert.ok(v.length >= 6 && v.length <= 18, `「${v}」长度 ${v.length}`)
  }
  assert.ok(DAILY_VERSES.length >= 12)
})

test('读档只认形状，不推进日期', () => {
  const s = normalizeStreak({ days: 5, best: 9, last: '2026-11-12' })
  assert.deepEqual(s, { days: 5, best: 9, last: '2026-11-12' })

  for (const bad of [null, {}, { days: -2, best: 3 }, { best: 7 }, { days: 4, last: '2026/11/13' }]) {
    const n = normalizeStreak(bad)
    assert.ok(n.days >= 0 && n.best >= n.days)
    assert.match(n.last, /^(\d{4}-\d{2}-\d{2})?$/)
  }
})
