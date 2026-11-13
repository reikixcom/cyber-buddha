import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  utcDayKey, isDayTag, beaconRoundForDay, beaconSeedFromRandomness,
  fallbackDaySeed, beaconUrl, beaconPublicUrl, parseBeacon,
  fetchDayBeacon, checkSealBeacon,
  BEACON_GENESIS, BEACON_PERIOD, BEACON_CHAIN, BEACON_RELAYS
} from '../src/temple/beacon.js'
import { sha256BytesHex, makeSeal, verifySeal, verifyChain } from '../src/temple/seal.js'
import { makePattern, seedFrom, settle } from '../src/temple/rhythm.js'

/** api.drand.sh 实测取回的 quicknet 某轮真实签名 / 随机值，用作固定构造样本 */
const DAY = '2026-11-13'
const SIG = '98d2b371f9011b40d5060d45b59bd11a0dcd8f909a1d676adad2364f67b9bcf05dcb5e024481f82f667b8a4801f17b2c'
const RAND = 'e40adeb0c72cdff8c412bc7dbc90e3225aad03270ffa6bbd4eb554e1ad4a0672'
const ROUND = 33908212
const SEED = 0xe40adeb0
const SIG2 = 'ab'.repeat(48)
const RAND2 = createHash('sha256').update(Buffer.from(SIG2, 'hex')).digest('hex')

const hexBytes = (h) => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16))
const beaconJson = (randomness = RAND, signature = SIG, round = ROUND) => ({ round, randomness, signature })

/** 假 fetch：按 host 返回预设响应，可模拟某源失效或作恶 */
function fakeFetch(byHost) {
  return async (url) => {
    const host = new URL(url).host
    const v = byHost[host]
    if (!v) return { ok: false, status: 503, json: async () => ({}) }
    if (v instanceof Error) throw v
    return { ok: true, status: 200, json: async () => v }
  }
}
const allAgree = () => Object.fromEntries(
  BEACON_RELAYS.map((r) => [new URL(r.url).host, beaconJson()])
)

function fixture(round = 3, daySeed = SEED) {
  const pattern = makePattern(seedFrom(round, daySeed))
  const marks = {}
  pattern.beats.forEach((b, i) => { marks[b.index] = i % 5 === 0 ? 'miss' : 'perfect' })
  return { pattern, marks, result: settle(pattern, marks, 1200) }
}
function v2Seal(round = 3, opts = {}) {
  const daySeed = opts.daySeed ?? SEED
  const f = fixture(round, daySeed)
  return makeSeal({
    round, daySeed, pattern: f.pattern, marks: f.marks,
    wild: 1, online: 1200, result: f.result, at: 1763000000000,
    beacon: { day: opts.day ?? DAY, round: opts.beaconRound ?? ROUND },
    prev: opts.prev ?? ''
  })
}

test('UTC 换日与轮次公式：与 drand 实测值逐一对上', () => {
  assert.equal(utcDayKey(new Date('2026-11-13T01:31:24Z')), DAY)
  assert.equal(beaconRoundForDay(DAY), ROUND)
  assert.equal(BEACON_GENESIS + (ROUND - 1) * BEACON_PERIOD, 1794528000)
  assert.equal(new Date(1794528000 * 1000).toISOString(), '2026-11-13T00:00:00.000Z')
  assert.equal(beaconRoundForDay('2026-11-14'), ROUND + 28800) // 一天 86400s / 3s
  assert.equal(beaconRoundForDay('不是日期'), 0)
  assert.equal(isDayTag('2026-02-30'), false) // Date.parse 会回滚到 3 月，必须挡掉
  assert.equal(isDayTag(DAY), true)
  assert.equal(fallbackDaySeed(DAY), 20261113)
  assert.match(beaconUrl('https://api.drand.sh/', ROUND), new RegExp(`^https://api.drand.sh/${BEACON_CHAIN}/public/${ROUND}$`))
  assert.equal(beaconPublicUrl(ROUND), beaconUrl(BEACON_RELAYS[0].url, ROUND))
})

test('种子派生与字节哈希：randomness 就是 signature 的 SHA-256', () => {
  assert.equal(beaconSeedFromRandomness(RAND), SEED)
  assert.equal(beaconSeedFromRandomness('deadbeef'), null)
  assert.equal(beaconSeedFromRandomness('z'.repeat(64)), null)
  assert.equal(sha256BytesHex(hexBytes(SIG)), RAND)
  assert.equal(sha256BytesHex(hexBytes(SIG2)), RAND2)
})

test('单条信标响应：轮次、格式、签名自洽，缺一即拒', () => {
  assert.deepEqual(parseBeacon(beaconJson(), ROUND), { round: ROUND, randomness: RAND, signature: SIG, seed: SEED })
  assert.equal(parseBeacon(JSON.stringify(beaconJson()), ROUND).seed, SEED)
  assert.equal(parseBeacon(beaconJson(RAND2), ROUND), null) // 随机值与签名不符
  assert.equal(parseBeacon(beaconJson(RAND, SIG.toLowerCase().slice(0, -1) + 'd'), ROUND), null)
  assert.equal(parseBeacon(beaconJson(RAND, SIG, ROUND + 1), ROUND), null) // 不是要查的那一轮
  assert.equal(parseBeacon('坏 JSON', ROUND), null)
  assert.equal(parseBeacon(null, ROUND), null)
})

test('多源交叉：至少两个独立端点一致才采信', async () => {
  const ok = await fetchDayBeacon(DAY, { fetchImpl: fakeFetch(allAgree()) })
  assert.ok(ok)
  assert.equal(ok.round, ROUND)
  assert.equal(ok.seed, SEED)
  assert.equal(ok.sources.length, BEACON_RELAYS.length)
  assert.equal(ok.status, 'public')

  // 只有一个源可达：宁可降级，不赌单源
  const one = Object.fromEntries([[new URL(BEACON_RELAYS[0].url).host, beaconJson()]])
  assert.equal(await fetchDayBeacon(DAY, { fetchImpl: fakeFetch(one) }), null)

  // 两个一致、一个作恶：有分歧就整体拒绝
  const hosts = BEACON_RELAYS.map((r) => new URL(r.url).host)
  const disputed = allAgree()
  disputed[hosts[2]] = beaconJson(RAND2, SIG2)
  assert.equal(await fetchDayBeacon(DAY, { fetchImpl: fakeFetch(disputed) }), null)

  // 全断网 / 非法日期 / 没有 fetch
  assert.equal(await fetchDayBeacon(DAY, { fetchImpl: fakeFetch({}) }), null)
  assert.equal(await fetchDayBeacon('2026-02-30', { fetchImpl: fakeFetch(allAgree()) }), null)
  assert.equal(await fetchDayBeacon(DAY, { fetchImpl: null }), null)
})

test('v2 回执：公开种子可复算，v1 老回执仍照常验', () => {
  const s = v2Seal()
  assert.ok(s.text.startsWith('CT1.'))
  assert.ok(s.text.length < 300, `回执过长：${s.text.length}`)
  const v = verifySeal(s.text)
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.seal.version, 2)
  assert.equal(v.seal.source, 'public')
  assert.equal(v.seal.dayTag, DAY)
  assert.equal(v.seal.beaconRound, ROUND)
  assert.equal(v.seal.daySeed, SEED)
  assert.equal(v.seal.seed, seedFrom(3, SEED))

  const legacySeed = 20261113
  const f = fixture(3, legacySeed)
  const old = makeSeal({
    round: 3, daySeed: legacySeed, pattern: f.pattern, marks: f.marks,
    wild: 0, online: 1200, result: f.result, at: 1763000000000
  })
  const ov = verifySeal(old.text)
  assert.equal(ov.ok, true, ov.reason)
  assert.equal(ov.seal.version, 1)
  assert.equal(ov.seal.source, 'legacy')
  // 换种子后节拍表确实不同，说明公开信标真的参与了规则，而非只是贴个标签
  assert.notEqual(v.seal.seed, ov.seal.seed)
})

test('离线降级必须自认本机，不能拿日期整数冒充公开随机值', async () => {
  const honest = v2Seal(3, { daySeed: fallbackDaySeed(DAY), beaconRound: 0 })
  const hv = verifySeal(honest.text)
  assert.equal(hv.ok, true, hv.reason)
  assert.equal(hv.seal.source, 'local')
  assert.equal(hv.seal.beaconRound, 0)

  // 公开种子远超日期整数范围，先被字段范围挡下
  const fake = v2Seal(3, { daySeed: SEED, beaconRound: 0 })
  assert.match(verifySeal(fake.text).reason, /回执字段超出合法范围/)
  // 换成另一天的日期整数才进到「降级档种子与日期不符」这道专门检查
  const otherDay = v2Seal(3, { daySeed: 20261114, beaconRound: 0 })
  assert.match(verifySeal(otherDay.text).reason, /本机弱验证回执的种子与日期对不上/)

  // 公开档却填日期整数：离线复算只管自洽，在线对账会当场戳穿
  const wrong = verifySeal(v2Seal(3, { daySeed: 20261113 }).text).seal
  assert.equal(wrong.daySeed, 20261113)
  const rejected = await checkSealBeacon(wrong, { fetchImpl: fakeFetch(allAgree()) })
  assert.equal(rejected.ok, false)
  assert.match(rejected.reason, /推不出这枚种子/)
})

test('v1 / v2 回执能混在一条链里，短码照旧串起来', () => {
  const legacySeed = 20261113
  const f = fixture(1, legacySeed)
  const a = makeSeal({
    round: 1, daySeed: legacySeed, pattern: f.pattern, marks: f.marks,
    wild: 0, online: 1200, result: f.result, at: 1763000000000
  })
  const b = v2Seal(2, { prev: a.short })
  const c = v2Seal(3, { prev: b.short })
  const chain = verifyChain([a.text, b.text, c.text])
  assert.equal(chain.ok, true, chain.reason)
  assert.deepEqual(chain.items.map((i) => i.version), [1, 2, 2])
  assert.equal(verifyChain([a.text, c.text]).ok, false)
})

test('在线对账：轮次与种子都能跟公开源对上，对不上会指出原因', async () => {
  const s = verifySeal(v2Seal().text).seal
  const opts = { fetchImpl: fakeFetch(allAgree()) }
  const good = await checkSealBeacon(s, opts)
  assert.equal(good.ok, true, good.reason)
  assert.equal(good.beacon.seed, SEED)
  assert.equal(good.beacon.sources.length, BEACON_RELAYS.length)

  assert.match((await checkSealBeacon({ ...s, beaconRound: ROUND + 1 }, opts)).reason, /信标轮次对不上/)
  assert.match((await checkSealBeacon({ ...s, daySeed: 0x12345678 }, opts)).reason, /推不出这枚种子/)
  assert.match((await checkSealBeacon({ ...s, version: 1 }, opts)).reason, /没有公开信标字段/)
  assert.match((await checkSealBeacon(s, { fetchImpl: fakeFetch({}) })).reason, /连不上公开信标/)
})
