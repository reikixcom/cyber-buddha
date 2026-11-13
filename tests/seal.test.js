import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  sha256Hex, makeSeal, verifySeal, verifyChain, encodeMarks,
  shortOf, packLedger, unpackLedger
} from '../src/temple/seal.js'
import { makePattern, seedFrom, settle, BEATS_PER_STICK, TEMPLE_RULES } from '../src/temple/rhythm.js'
import { snapshotPractice, sanitizePracticeSave, SAVE_VERSION } from '../src/temple/save.js'

const DAY = 20261113
const ONLINE = 1480
const AT = 1763000000000
/** 末位可能本来就是 0，直接写 '0' 会「改了等于没改」 */
const flipLast = (s) => s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0')

function fixture(round = 3, overrides = {}) {
  const seed = seedFrom(round, DAY)
  const pattern = makePattern(seed)
  const marks = {}
  pattern.beats.forEach((b, i) => {
    marks[b.index] = i % 7 === 0 ? 'miss' : i % 3 === 0 ? 'good' : 'perfect'
  })
  const result = settle(pattern, marks, ONLINE)
  return { round, pattern, marks, result, ...overrides }
}

function sealOf(round = 3, prev = '', overrides = {}) {
  const f = fixture(round, overrides)
  return makeSeal({
    round, daySeed: DAY, pattern: f.pattern, marks: f.marks,
    wild: 2, online: ONLINE, result: f.result, prev, at: AT
  })
}

test('同步 SHA-256 与 Node 标准库逐字节一致（含中文与分块边界）', () => {
  for (const s of ['', 'abc', 'CT1.test', '敲木鱼就是出块', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'))
  }
})

test('64 拍判定压成定长 P/G/M 串', () => {
  const { pattern, marks } = fixture()
  const m = encodeMarks(pattern, marks)
  assert.equal(m.length, BEATS_PER_STICK)
  assert.match(m, /^[PGM]+$/)
  assert.equal(m[0], 'M') // 第 0 拍按 fixture 是 miss
})

test('回执自洽：短码、字段、时间都能还原，文本短到可贴进聊天框', () => {
  const s = sealOf()
  assert.ok(s.text.startsWith('CT1.'))
  assert.equal(s.short.length, 16)
  assert.ok(s.text.length < 260, `回执过长：${s.text.length}`)
  const v = verifySeal(s.text)
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.seal.round, 3)
  assert.equal(v.seal.daySeed, DAY)
  assert.equal(v.seal.seed, seedFrom(3, DAY))
  assert.equal(v.seal.reward, s.reward)
  assert.equal(v.seal.perfect + v.seal.good + v.seal.miss, BEATS_PER_STICK)
  assert.equal(shortOf(s.text), s.short)
  assert.equal(shortOf('乱写的'), '')
})

test('改一个字符就露馅：校验码覆盖整个规范串', () => {
  const s = sealOf()
  assert.equal(verifySeal(flipLast(s.text)).ok, false)
  assert.equal(verifySeal(s.text.slice(0, -8)).ok, false)
  const body = s.text.split('.')[1]
  const flipped = body.slice(0, 20) + (body[20] === 'A' ? 'B' : 'A') + body.slice(21)
  assert.equal(verifySeal(`CT1.${flipped}.${s.short}`).ok, false)
  assert.match(verifySeal('这不是回执').reason, /不是有效的禅印回执/)
})

test('伪造结算金额：校验码可以重算，但寺规复算会否决', () => {
  const f = fixture()
  const forged = makeSeal({
    round: 3, daySeed: DAY, pattern: f.pattern, marks: f.marks,
    wild: 0, online: ONLINE,
    result: { ...f.result, reward: f.result.reward + 500 }, at: AT
  })
  const v = verifySeal(forged.text)
  assert.equal(v.ok, false)
  assert.match(v.reason, /按寺规复算不一致/)

  const acc = makeSeal({
    round: 3, daySeed: DAY, pattern: f.pattern, marks: f.marks,
    wild: 0, online: ONLINE,
    result: { ...f.result, accuracy: 1 }, at: AT
  })
  assert.match(verifySeal(acc.text).reason, /按寺规复算不一致/)
})

test('伪造节拍种子：第 N 炷与日期算不出这个种子', () => {
  const f = fixture(3)
  const wrong = makeSeal({
    round: 3, daySeed: DAY, pattern: makePattern(seedFrom(99, DAY)),
    marks: f.marks, online: ONLINE, result: f.result, at: AT
  })
  assert.match(verifySeal(wrong.text).reason, /节拍种子对不上/)
})

test('回执连成链，插一张假的或调顺序都会断', () => {
  const a = sealOf(3)
  const b = sealOf(4, a.short)
  const c = sealOf(5, b.short)
  const good = verifyChain([a.text, b.text, c.text])
  assert.equal(good.ok, true, good.reason)
  assert.equal(good.items.length, 3)

  const tampered = sealOf(4, a.short, { result: { ...fixture(4).result, reward: 999 } })
  assert.equal(verifyChain([a.text, tampered.text, c.text]).ok, false)
  assert.equal(verifyChain([a.text, c.text, b.text]).ok, false)
  assert.equal(verifyChain([b.text, c.text]).ok, false) // 首张 prev 非空，严格模式不认
  assert.equal(verifyChain([b.text, c.text], { ignoreFirstPrev: true }).ok, true)
  assert.equal(verifyChain([]).ok, true)
})

test('账本打包可还原，截断或改字一律拒绝', () => {
  const save = { merit: 400, daily: { day: '2026-11-13' }, practice: { v: 3, seals: ['CT1.a.b'] } }
  const text = packLedger(save)
  assert.ok(text.startsWith('CTL1.'))
  assert.deepEqual(unpackLedger(text), save)
  assert.equal(unpackLedger(flipLast(text)), null)
  assert.equal(unpackLedger('CT1.abc.0000000000000000'), null)
  assert.equal(unpackLedger('随便一段文字'), null)
  assert.equal(unpackLedger(packLedger([1, 2, 3])), null) // 数组不是账本
})

test('存档 v3 保留能复算的回执，v2 老档平滑升级', () => {
  const a = sealOf(3)
  const b = sealOf(4, a.short)
  const raw = {
    lamp: 40, openings: 2, templePool: 60, templeCycles: 3, activeWishId: 11,
    wishes: [{ id: 11, kind: 'temple', text: '愿长明灯不灭' }],
    seals: [a.text, b.text, 'CT1.被改过.0000000000000000', 123]
  }
  const p = {
    lamp: 40, openings: 2, templePool: 60, templeCycles: 3, activeWishId: 11, round: 9,
    wishes: [{ id: 11, kind: 'temple', text: '愿长明灯不灭', bounty: 60, need: 108, progress: 0, contributors: {}, done: false }],
    seals: raw.seals
  }
  const snap = snapshotPractice(p)
  assert.equal(snap.v, SAVE_VERSION)
  assert.equal(snap.seals.length, 2) // 坏文本被挡在存档外
  assert.equal(snap.round, 9)
  const restored = sanitizePracticeSave(snap)
  assert.equal(restored.seals.length, 2)
  assert.equal(restored.round, 9)
  assert.equal(verifyChain(restored.seals).ok, true)

  const legacy = sanitizePracticeSave({ ...snap, v: 2, seals: undefined })
  assert.ok(legacy)
  assert.deepEqual(legacy.seals, [])
  assert.equal(legacy.round, 0)
  // v2 老档若带着回执，炷号接着回执张数走，不会撞回第 1 炷
  const legacyWithSeals = sanitizePracticeSave({ ...snap, v: 2, round: undefined, seals: [a.text, b.text] })
  assert.equal(legacyWithSeals.round, 2)
  assert.equal(legacyWithSeals.seals.length, 2)
  assert.equal(sanitizePracticeSave({ ...snap, v: 1 }), null)
})

test('寺规把禅印规则与弱验证边界写明白', () => {
  const all = TEMPLE_RULES.join('\n')
  assert.match(all, /禅印/)
  assert.match(all, /验签/)
  assert.match(all, /不证明真人真的敲了/)
  assert.match(all, /公开随机信标/)
  assert.ok(TEMPLE_RULES.length >= 14)
})
