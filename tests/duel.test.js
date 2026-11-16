import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makeDuel, parseDuel, duelSetup, compareDuel,
  duelVerdictLine, duelInvite, duelPath, duelUrl,
  cleanLine, DUEL_PREFIX, MAX_NOTE
} from '../src/temple/duel.js'
import { makeSeal, verifySeal } from '../src/temple/seal.js'
import { makePattern, seedFrom, settle } from '../src/temple/rhythm.js'

const DAY = 20261113
const ONLINE = 1480
const AT = 1763000000000

/** 造一张真回执：perfectEvery 越小，成绩越好 */
function sealOf(round = 7, { perfectEvery = 2, missEvery = 11, prev = '', beacon = null } = {}) {
  const seed = seedFrom(round, DAY)
  const pattern = makePattern(seed)
  const marks = {}
  pattern.beats.forEach((b, i) => {
    marks[b.index] = i % missEvery === 0 ? 'miss' : i % perfectEvery === 0 ? 'perfect' : 'good'
  })
  const result = settle(pattern, marks, ONLINE)
  return makeSeal({
    round, daySeed: DAY, pattern, marks, wild: 1,
    online: ONLINE, result, prev, at: AT, beacon
  })
}

/** 直接把同一张回执的判定改好一点，再造一张（模拟「更强的对手」） */
function betterSeal(round = 7, prev = '') {
  return sealOf(round, { perfectEvery: 1, missEvery: 97, prev })
}

test('战帖从真回执生成，能原路解析回来', () => {
  const s = sealOf()
  const d = makeDuel({ sealText: s.text, name: '#a3f2c1', note: '来对一炷' })
  assert.ok(d.text.startsWith(DUEL_PREFIX + '.'))
  assert.equal(d.short.length, 16)

  const back = parseDuel(d.text)
  assert.ok(back?.ok)
  assert.equal(back.short, d.short)
  assert.equal(back.name, '#a3f2c1')
  assert.equal(back.note, '来对一炷')
  assert.equal(back.seal.round, 7)
  assert.equal(back.seal.accuracy, s.accuracy)
})

test('假回执造不出战帖：改一个字、截断、乱写都不行', () => {
  const s = sealOf()
  assert.equal(makeDuel({ sealText: 'CT1.abc.def' }), null)
  assert.equal(makeDuel({ sealText: s.text.slice(0, -1) + (s.text.endsWith('0') ? '1' : '0') }), null)
  assert.equal(makeDuel({}), null)
  assert.equal(makeDuel({ sealText: s.text.replace('CT1.', 'CT9.') }), null)
})

test('战帖自带校验码：改动正文立刻解析失败', () => {
  const d = makeDuel({ sealText: sealOf().text, name: '#me' })
  const parts = d.text.split('.')
  assert.equal(parseDuel(d.text)?.ok, true)
  // 换掉校验码最后一位
  const bad = [parts[0], parts[1], parts[2].slice(0, -1) + (parts[2].endsWith('0') ? '1' : '0')].join('.')
  assert.equal(parseDuel(bad), null)
  // 前缀换成别的协议
  assert.equal(parseDuel('CTX1.' + parts[1] + '.' + parts[2]), null)
  // 空串 / 非字符串
  assert.equal(parseDuel(''), null)
  assert.equal(parseDuel(null), null)
})

test('应战参数就是同一道题：round + daySeed + seed 完全一致', () => {
  const s = sealOf(7)
  const d = parseDuel(makeDuel({ sealText: s.text }).text)
  const setup = duelSetup(d)
  assert.equal(setup.round, 7)
  assert.equal(setup.daySeed, DAY)
  assert.equal(setup.seed, s.seed)
  assert.equal(seedFrom(setup.round, setup.daySeed), s.seed, '重建出来的节拍种子必须一样')
  assert.equal(setup.beacon, null, 'v1 回执没有信标，别硬编一个')
})

test('带公开信标的回执：应战时要连信标一起复刻，否则回执验不过', () => {
  const daySeed = 0x1234abcd
  const pattern = makePattern(seedFrom(4, daySeed))
  const marks = {}
  pattern.beats.forEach((b, i) => { marks[b.index] = i % 3 ? 'good' : 'perfect' })
  const result = settle(pattern, marks, ONLINE)
  const v2 = makeSeal({
    round: 4, daySeed, pattern, marks, wild: 0, online: ONLINE, result, at: AT,
    beacon: { day: '2026-11-13', round: 12345 }
  })
  const d = parseDuel(makeDuel({ sealText: v2.text }).text)
  const setup = duelSetup(d)
  assert.equal(setup.beacon.day, '2026-11-13')
  assert.equal(setup.beacon.round, 12345)
  assert.equal(setup.seed, v2.seed)
  assert.equal(setup.date, '2026-11-13')
})

test('对比：按合拍率判胜负，功德只列出来不参与判定', () => {
  const weak = sealOf(7, { perfectEvery: 5, missEvery: 3 })
  const strong = betterSeal(7)
  const a = verifySeal(weak.text).seal
  const b = verifySeal(strong.text).seal

  const win = compareDuel(a, b)
  assert.equal(win.verdict, 'win')
  assert.equal(win.same, true)
  assert.ok(win.gap > 0)
  assert.match(win.label, /胜/)

  const lose = compareDuel(b, a)
  assert.equal(lose.verdict, 'lose')
  assert.match(lose.label, /惜败|落败/)
  assert.equal(lose.gap, -win.gap)

  // 不同 round 就不是同一题：仍然给对比，但明确标出来
  const other = compareDuel(verifySeal(sealOf(9).text).seal, b)
  assert.equal(other.same, false)
  assert.ok(other.gap >= -1 && other.gap <= 1)
})

test('对比：分数一样是平手，不给「险胜」这种自欺文案', () => {
  const s = verifySeal(sealOf(3).text).seal
  const cmp = compareDuel(s, s)
  assert.equal(cmp.verdict, 'tie')
  assert.equal(cmp.gap, 0)
  assert.match(duelVerdictLine(cmp), /平手/)
})

test('对比：输入缺失或脏数据不炸，也不给出假胜负', () => {
  assert.equal(compareDuel(null, null).ok, false)
  assert.equal(duelVerdictLine(null), '')
  const s = verifySeal(sealOf(3).text).seal
  const cmp = compareDuel(s, null)
  assert.equal(cmp.ok, false)
  // 越界精度被夹到 [0,1]，不会出现 300% 合拍率
  const wild = compareDuel({ accuracy: 3, reward: -5, round: 1 }, { accuracy: 99, reward: NaN })
  assert.ok(wild.mineAccuracy <= 1 && wild.theirsAccuracy <= 1)
  assert.ok(wild.mineReward >= 0 && wild.theirsReward >= 0)
})

test('挑战语与链接：能直接贴进群里，且指向同一炷', () => {
  const s = verifySeal(sealOf(7).text).seal
  const cmp = compareDuel(s, s)
  const invite = duelInvite(cmp, '#a3f2c1')
  assert.match(invite, /#a3f2c1/)
  assert.match(invite, /第 7 炷/)

  const d = makeDuel({ sealText: sealOf(7).text })
  const path = duelPath(d.text)
  assert.ok(path.startsWith('?duel='))
  const url = duelUrl(d.text, 'https://cyberbuddha.ai/')
  assert.equal(url, 'https://cyberbuddha.ai/?duel=' + encodeURIComponent(d.text))
  // 链接里取出来的还是原来那张战帖
  assert.ok(parseDuel(decodeURIComponent(url.split('duel=')[1]))?.ok)
})

test('文案清洗：竖线与换行会毁掉规范串，必须清掉', () => {
  assert.equal(cleanLine('a|b\r\nc', 20), 'a b c')
  assert.equal(cleanLine('  前后有空格  ', 20), '前后有空格')
  assert.equal(cleanLine('x'.repeat(80), MAX_NOTE).length, MAX_NOTE)
  assert.equal(cleanLine(null, 10), '')
})
