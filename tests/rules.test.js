/**
 * 寺规的可执行版本。
 *
 * 这个项目的核心承诺是「规则写死在开源代码里，任何人可复算」：
 * 给定 round + daySeed，任何人都能算出同一份节拍表，再拿同一份敲击
 * 记录复算同样的功德。以下测试把这个承诺锁住 —— 改规则可以，
 * 但不能悄悄改，改完必须有测试跟着变。
 *
 *   npm test        （Node 22 内置 node:test，不需要额外依赖）
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  seedFrom, makePattern, judge, settle, dueBeats,
  BEATS_PER_STICK, BEATS_PER_PHRASE, WINDOW, WEIGHT,
  BASE_RELEASE, PREP_MS, TEMPLE_RULES
} from '../src/temple/rhythm.js'
import {
  RITUALS, DAILY_CAP, dayKey, freshDaily, normalizeDaily,
  emitFactor, emitCredit, ritualCheck, applyRitual,
  needFor, clampBounty, shareOf, earnedPart, WISH_STICK_LIMIT
} from '../src/temple/economy.js'
import {
  SAVE_VERSION, snapshotPractice, sanitizePracticeSave, sanitizeWish
} from '../src/temple/save.js'

// ---------------------------------------------------------------- 节拍

test('seedFrom 确定性：同输入同结果，换 round 或换日子都会变', () => {
  assert.equal(seedFrom(3, 20261113), seedFrom(3, 20261113))
  assert.notEqual(seedFrom(3, 20261113), seedFrom(4, 20261113))
  assert.notEqual(seedFrom(3, 20261113), seedFrom(3, 20261114))
  const s = seedFrom(99, 20261113)
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff)
})

test('makePattern：64 拍分 8 句，时间严格升序，终点落在 duration 内', () => {
  const p = makePattern(seedFrom(1, 20261113))
  assert.equal(p.beats.length, BEATS_PER_STICK)
  assert.equal(new Set(p.beats.map((b) => b.phrase)).size, BEATS_PER_STICK / BEATS_PER_PHRASE)
  assert.equal(p.beats[0].at, PREP_MS)
  for (let i = 1; i < p.beats.length; i++) {
    assert.ok(p.beats[i].at > p.beats[i - 1].at, `第 ${i} 拍必须晚于前一拍`)
  }
  assert.ok(p.duration > p.beats.at(-1).at)
  assert.deepEqual(makePattern(p.seed), p, '同一 seed 必须生成完全相同的节拍表')
  assert.notDeepEqual(makePattern(p.seed + 1), p)
})

test('判定窗放宽后仍保证每拍够得着：间隔至少是一倍半 GOOD 窗口', () => {
  const p = makePattern(seedFrom(7, 20261113))
  for (let i = 1; i < p.beats.length; i++) {
    const gap = p.beats[i].at - p.beats[i - 1].at
    assert.ok(gap > 1.5 * WINDOW.good, `第 ${i} 拍间隔 ${gap}ms 太密，窗口会吃掉整拍`)
  }
})

test('相邻窗口有重叠时按最近的一拍归属，同一拍不会被判两次', () => {
  const p = makePattern(seedFrom(7, 20261113))
  // 找一对间距小于 2×GOOD 的相邻拍（放宽窗口后必然存在）
  const idx = p.beats.findIndex((b, i) => i > 0 && b.at - p.beats[i - 1].at < 2 * WINDOW.good)
  assert.ok(idx > 0, '这一炷里应有贴得较近的相邻拍')

  const b0 = p.beats[idx - 1]
  const b1 = p.beats[idx]
  const mid = Math.round((b0.at + b1.at) / 2)
  const used = new Set()

  const first = judge(p, mid - 12, used)
  assert.equal(first.beat, idx - 1, '偏前半拍应归前一拍')
  used.add(first.beat)

  const second = judge(p, mid + 12, used)
  assert.equal(second.beat, idx, '偏后半拍应归后一拍')

  // 同一拍再敲一次不能再计权重
  assert.equal(judge(p, b0.at, new Set([idx - 1])).grade, 'wild')
})

test('judge：perfect / good / wild 边界与 used 去重', () => {
  const p = makePattern(seedFrom(2, 20261113))
  const at = p.beats[0].at
  assert.equal(judge(p, at, new Set()).grade, 'perfect')
  assert.equal(judge(p, at + WINDOW.perfect, new Set()).grade, 'perfect')
  assert.equal(judge(p, at + WINDOW.perfect + 1, new Set()).grade, 'good')
  assert.equal(judge(p, at - WINDOW.good - 1, new Set()).grade, 'wild')

  const hit = judge(p, at, new Set())
  assert.equal(hit.beat, 0)
  // 同一拍敲第二次不能重复计权重
  assert.equal(judge(p, at, new Set([0])).grade, 'wild')
})

test('judge 在密集段落命中最近的未判定拍，离所有拍都远才 wild', () => {
  const p = makePattern(seedFrom(11, 20261113))
  const used = new Set([0, 1, 2])
  const target = p.beats[3]
  const r = judge(p, target.at + 20, used)
  assert.equal(r.beat, 3)
  assert.equal(r.grade, 'perfect')

  // 放宽窗口后两拍之间不再有「死区」：落在缝里也归更近的那一拍，不会白敲
  const next = p.beats[4]
  const mid = judge(p, (target.at + next.at) / 2, new Set([0, 1, 2]))
  if (next.at - target.at < 2 * WINDOW.good) assert.notEqual(mid.grade, 'wild')

  // 真正远离所有未判定拍才算乱敲
  assert.equal(judge(p, target.at - WINDOW.good - 40, new Set([0, 1, 2])).grade, 'wild')
})

// ---------------------------------------------------------------- 结算

test('settle：空过零释放，全 PERFECT 合拍率 1，权重按 3/1/0', () => {
  const p = makePattern(seedFrom(5, 20261113))
  const empty = settle(p, {}, 1480)
  assert.equal(empty.reward, 0)
  assert.equal(empty.accuracy, 0)
  assert.equal(empty.miss, BEATS_PER_STICK)

  const perfect = {}
  for (const b of p.beats) perfect[b.index] = 'perfect'
  const full = settle(p, perfect, 1480)
  assert.equal(full.accuracy, 1)
  assert.equal(full.perfect, BEATS_PER_STICK)
  assert.equal(full.reward, Math.round(BASE_RELEASE * full.dilution))

  const mixed = { [p.beats[0].index]: 'perfect', [p.beats[1].index]: 'good' }
  const m = settle(p, mixed, 1480)
  assert.equal(m.accuracy, (WEIGHT.perfect + WEIGHT.good) / (BEATS_PER_STICK * WEIGHT.perfect))
})

test('settle：在场人数越多人均越少，稀释有下限不会归零', () => {
  const p = makePattern(seedFrom(5, 20261113))
  const perfect = Object.fromEntries(p.beats.map((b) => [b.index, 'perfect']))
  const few = settle(p, perfect, 100)
  const many = settle(p, perfect, 3000)
  assert.ok(many.reward < few.reward)
  assert.equal(settle(p, perfect, 999999).dilution, 0.4)
})

// ---------------------------------------------------------------- 账本

test('dayKey 是本地日期，跨天存档自动作废', () => {
  const d = new Date(2026, 10, 13, 9, 30)
  assert.equal(dayKey(d), '2026-11-13')
  const today = freshDaily()
  assert.equal(today.earned, 0)
  assert.equal(normalizeDaily({ ...today, earned: 500 }).earned, 500)
  assert.equal(normalizeDaily({ ...today, day: '2000-01-01', earned: 500 }).earned, 0)
  assert.equal(normalizeDaily(null).day, today.day)
})

test('每日额度：1 → 0.5 → 0.2 → 0 四档边界', () => {
  assert.equal(emitFactor(0), 1)
  assert.equal(emitFactor(DAILY_CAP - 1), 1)
  assert.equal(emitFactor(DAILY_CAP), 0.5)
  assert.equal(emitFactor(DAILY_CAP * 1.5), 0.2)
  assert.equal(emitFactor(DAILY_CAP * 2), 0)
  assert.equal(emitCredit(0, 40), 40)
  assert.equal(emitCredit(DAILY_CAP, 40), 20)
  assert.equal(emitCredit(DAILY_CAP * 2, 40), 0)
})

test('四法器：次数上限、冷却、重复递减与额度用尽各自拦住', () => {
  const daily = freshDaily()
  const now = 1_800_000_000_000
  const first = ritualCheck('incense', daily, now)
  assert.equal(first.ok, true)
  assert.equal(first.amount, RITUALS.incense.base)

  applyRitual(daily, 'incense', first.amount, now)
  assert.equal(ritualCheck('incense', daily, now).reason, 'cooldown')
  assert.equal(ritualCheck('incense', daily, now + RITUALS.incense.cooldownMs).ok, true)

  const capped = { ...freshDaily(), used: { incense: RITUALS.incense.cap } }
  assert.equal(ritualCheck('incense', capped, now).reason, 'cap')

  const drained = { ...freshDaily(), earned: DAILY_CAP * 2 }
  assert.equal(ritualCheck('bow', drained, now).reason, 'daily')

  const repeated = { ...freshDaily(), used: { bow: 5 }, last: { bow: 0 } }
  const r = ritualCheck('bow', repeated, now)
  assert.ok(r.amount < RITUALS.bow.base, '重复修行必须递减')
  assert.equal(ritualCheck('nope', daily, now).ok, false)
})

test('悬赏：1 $G ≈ 6 击，钳制到 10–500，NaN 与越界有兜底', () => {
  assert.equal(needFor(20), 120)
  assert.equal(needFor(500), 3000)
  assert.equal(clampBounty(0), 10)
  assert.equal(clampBounty(99999), 500)
  assert.equal(clampBounty(Number.NaN), 10)
  assert.equal(clampBounty('88'), 88)
})

test('按击数分赏：总和不超悬赏，单人独得全款，零击零收入', () => {
  assert.equal(shareOf(100, 100, 100), 100)
  assert.equal(shareOf(100, 0, 100), 0)
  assert.equal(shareOf(100, 10, 0), 0)
  const total = 120
  const hits = [63, 41, 16]
  const paid = hits.map((h) => shareOf(100, h, total))
  assert.ok(paid.reduce((a, b) => a + b, 0) <= 100, '向下取整不能把悬赏发超')
  assert.ok(paid.reduce((a, b) => a + b, 0) >= 100 - hits.length, '舍入损耗最多每人 1 $G')
})

test('流单结算：按已诵比例给付，进度越界也不超托管额', () => {
  assert.equal(earnedPart(100, 60, 120), 50)
  assert.equal(earnedPart(100, 999, 120), 100)
  assert.equal(earnedPart(100, 0, 120), 0)
  assert.equal(earnedPart(100, 10, 0), 0)
  assert.equal(WISH_STICK_LIMIT, 6)
})

// ---------------------------------------------------------------- 存档

const fakePractice = () => ({
  lamp: 62, openings: 3, templePool: 60, templeCycles: 2, activeWishId: 12,
  wishes: [
    { id: 11, kind: 'temple', text: '愿长明灯不灭', owner: '本寺常住', bounty: 60, need: 360, progress: 90, contributors: { '你': 30, '无量': 60 }, cycle: 2 },
    { id: 12, text: '愿今晚睡个好觉', owner: '你', bounty: 100, need: 600, progress: 45, contributors: { '你': 45 }, mine: true, sticks: 2 },
    { id: 13, text: '愿这只猫找到家', owner: '0xA1…B2', bounty: 50, need: 300, progress: 0, contributors: {}, done: false }
  ]
})

test('存档往返：托管金额、击数、常住愿与开光次数都留得住', () => {
  const snap = snapshotPractice(fakePractice())
  assert.equal(snap.v, SAVE_VERSION)
  const reread = sanitizePracticeSave(JSON.parse(JSON.stringify(snap)))
  assert.equal(reread.openings, 3)
  assert.equal(reread.templePool, 60)
  assert.equal(reread.activeWishId, 12)
  const mine = reread.wishes.find((w) => w.mine)
  assert.equal(mine.bounty, 100)
  assert.equal(mine.progress, 45)
  assert.equal(mine.contributors['你'], 45)
  assert.equal(mine.sticks, 2)
  assert.equal(reread.wishes.find((w) => w.kind === 'temple').progress, 90)
})

test('坏档防御：版本不符 / 无常住愿 / 重复 id / 负数击数都不崩', () => {
  assert.equal(sanitizePracticeSave(null), null)
  assert.equal(sanitizePracticeSave({ ...snapshotPractice(fakePractice()), v: 1 }), null)
  assert.equal(sanitizePracticeSave({ ...snapshotPractice(fakePractice()), wishes: [{ id: 1, kind: 'user' }] }), null)

  const snap = snapshotPractice(fakePractice())
  snap.wishes.push({ ...snap.wishes[2], id: 12 })
  snap.wishes[2].contributors = { 你: -999, 坏人: 'abc', 好人: 999999 }
  snap.activeWishId = 99999
  const clean = sanitizePracticeSave(snap)
  assert.equal(clean.wishes.filter((w) => w.id === 12).length, 1)
  assert.equal(clean.activeWishId, clean.wishes.find((w) => w.kind === 'temple').id)
  assert.ok(!clean.wishes[2].contributors['你'], '负数击数直接丢弃')
  assert.ok(!clean.wishes[2].contributors['坏人'], '非数字击数直接丢弃')
  assert.ok(clean.wishes.every((w) => w.progress <= w.need))
})

test('sanitizeWish 限长限量，字符串与数字不会污染界面', () => {
  const w = sanitizeWish({
    id: 9, kind: 'user', text: '愿'.repeat(200), owner: 'x'.repeat(200),
    bounty: -50, need: 1e9, progress: 1e9, sticks: 1e9,
    contributors: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`n${i}`, i + 1]))
  })
  assert.ok(w.text.length <= 24)
  assert.ok(w.owner.length <= 16)
  assert.equal(w.bounty, 10)
  assert.equal(w.need, 3000)
  assert.equal(w.progress, w.need)
  assert.ok(Object.keys(w.contributors).length <= 24)
  assert.equal(sanitizeWish(null), null)
})

// ---------------------------------------------------------------- 规则文本

test('寺规文本与实际常量保持一致，免责声明永远在最后', () => {
  const all = TEMPLE_RULES.join('\n')
  assert.match(all, /六十四拍/)
  assert.match(all, /每日 600/)
  assert.match(all, new RegExp(`${WISH_STICK_LIMIT} 炷|六炷`))
  // 接入共修网络后不再是「全部本地模拟」，但免责与边界必须仍在最后一条
  assert.match(TEMPLE_RULES.at(-1), /未上链/)
  assert.match(TEMPLE_RULES.at(-1), /不承诺任何收益/)
})

// ---------------------------------------------------------------- 节拍报时

test('dueBeats：只取进入排程窗口的拍，远处的先不响', () => {
  const beats = [{ at: 2200, accent: true }, { at: 2500, accent: false }, { at: 2800, accent: false }]
  // 离第一拍还有 1 秒：什么也不响，游标不动
  assert.deepEqual(dueBeats(beats, 0, 1200, 180), { due: [], next: 0 })
  // 进入拍前 180ms：报第一拍，且带着「还差多少」
  const near = dueBeats(beats, 0, 2020, 180)
  assert.equal(near.due.length, 1)
  assert.equal(near.due[0].index, 0)
  assert.equal(near.due[0].accent, true)
  assert.equal(near.due[0].ahead, 180)
  assert.equal(near.next, 1)
})

test('dueBeats：跳跃式前进时把跳过的拍吞掉，不补响', () => {
  const beats = [{ at: 1000 }, { at: 1200 }, { at: 1400 }, { at: 1600 }]
  // 暂停/卡顿后 elapsed 已经到 1500：1400 那拍过去太久，不补响
  const r = dueBeats(beats, 0, 1500, 180, 60)
  assert.deepEqual(r.due.map((d) => d.index), [3])
  assert.equal(r.next, 4)
})

test('dueBeats：连续密集拍一次取出，不丢拍', () => {
  const beats = [{ at: 1000 }, { at: 1200 }, { at: 1400 }, { at: 1600 }]
  const r = dueBeats(beats, 0, 1240, 180)
  assert.deepEqual(r.due.map((d) => d.index), [1, 2])
  assert.equal(r.next, 3)
  // 下一帧从游标接着取，不会重复报
  const r2 = dueBeats(beats, r.next, 1260, 180)
  assert.deepEqual(r2.due.map((d) => d.index), [])
})
