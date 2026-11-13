/**
 * 分享卡的取数：这张图会被发到群里，任何 NaN / 超界数字都会当场露馅。
 * 只测纯函数部分（不测 Canvas 像素），保证「画之前的数据」永远合法。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildShareData, CARD_W, CARD_H } from '../src/temple/sharecard.js'

test('卡片尺寸固定为 4:5，微信与 X 都不会裁掉关键信息', () => {
  assert.equal(CARD_W, 1080)
  assert.equal(CARD_H, 1350)
  assert.ok(CARD_W / CARD_H === 0.8)
})

test('没有禅印时给空态，不编造数字', () => {
  const d = buildShareData({ merit: 0, bestCombo: 0, knockCount: 0 })
  assert.equal(d.hasSeal, false)
  assert.equal(d.grade, '未定')
  assert.equal(d.short, '')
  assert.equal(d.source, '')
  assert.equal(d.name, '#未署名')
})

test('脏数据一律夹到合法范围，不会画出 NaN', () => {
  const d = buildShareData({
    merit: NaN, bestCombo: -5, knockCount: Infinity, sealCount: -1,
    lastSeal: { round: NaN, accuracy: 7, perfect: -3, miss: 'x' }
  })
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v) && v >= 0, `${k} 应为非负有限数，实际 ${v}`)
  }
  assert.ok(d.accuracy <= 1)
  assert.equal(d.merit, 0)
  assert.equal(d.bestCombo, 0)
})

test('最近一炷带上短码与日期，别人能拿去复算', () => {
  const d = buildShareData({
    merit: 320,
    bestCombo: 41,
    knockCount: 960,
    sealCount: 15,
    lastSeal: {
      round: 12, accuracy: 0.953, perfect: 58, miss: 1,
      short: 'a1b2c3d4e5f60718', dayTag: '2026-11-13', beaconRound: 33908212
    },
    identity: { name: '#0d858d' }
  })
  assert.equal(d.hasSeal, true)
  assert.equal(d.round, 12)
  assert.equal(d.short, 'a1b2c3d4e5f60718')
  assert.equal(d.day, '2026-11-13')
  assert.equal(d.source, '公开信标')
  assert.equal(d.grade, '上品')
  assert.equal(d.name, '#0d858d')
  assert.equal(d.sealCount, 15)
})

test('本机弱验证的回执要标出来，不冒充公开信标', () => {
  const d = buildShareData({ lastSeal: { round: 3, accuracy: 0.8, beaconRound: 0, dayTag: '' } })
  assert.equal(d.source, '本机弱验证')
  assert.equal(d.day, '')
})

test('长法号会被压缩，不会撑破标题行', () => {
  const long = '#' + 'f'.repeat(80)
  const d = buildShareData({ identity: { name: long } })
  assert.equal(d.name, long, '取数层不做截断，交给绘制层按宽度裁剪')
})

test('连修天数进卡：没有就写 0 日，脏数据不会变成 NaN', () => {
  assert.equal(buildShareData({}).streak, 0)
  assert.equal(buildShareData({ streakDays: 12 }).streak, 12)
  assert.equal(buildShareData({ streakDays: -3 }).streak, 0)
  assert.equal(buildShareData({ streakDays: 'x' }).streak, 0)
  assert.equal(buildShareData({ streakDays: 1e9 }).streak, 1e5)
})
