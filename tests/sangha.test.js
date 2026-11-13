import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makePresence, makeWish, makeJoin, makeDeliver, parseSangha,
  aggregate, verifySangha, wishId, signText, soulName, shortPub,
  PRESENCE_WINDOW_MS, WISH_TEXT_MAX
} from '../src/temple/sangha.js'
import { packRecord, b64urlEncode } from '../src/temple/seal.js'
import { createIdentity, signMessage, verifyMessage } from '../src/temple/identity.js'

/** 固定时刻，避免用例随时钟漂移。记录里存的是秒，外部 API 用毫秒 */
const T0MS = 1794550000000
const T0 = Math.floor(T0MS / 1000)

async function signer() {
  const id = await createIdentity()
  assert.ok(id, 'Node 22 应提供 Web Crypto')
  return id
}

async function wishFrom(id, { text = '愿父母身体安康', bounty = 50, need = 125, at = T0MS } = {}) {
  const sec = Math.floor(at / 1000)
  const wid = wishId({ text, bounty, need, at: sec, pub: id.pub })
  const sig = await signMessage(id.priv, signText.wish({ id: wid, wish: text, bounty, need, at: sec }))
  return makeWish({ pub: id.pub, sig, text, bounty, need, at })
}

test('愿 id 由内容派生：改一个字就对不上', async () => {
  const a = await signer()
  const w = await wishFrom(a)
  assert.equal(w.id.length, 12)
  assert.ok(parseSangha(w.text))

  // 把愿文换掉、id 不换 —— 相当于改了一个字还想复用原来的编号
  const forged = packRecord('CTW1', b64urlEncode(JSON.stringify([1, w.id, '愿父母身体健康', 50, 125, T0, a.pub, w.sig])))
  assert.equal(parseSangha(forged), null, '内容和 id 不匹配的愿必须被丢弃')

  const w2 = await wishFrom(a, { bounty: 200, need: 500 })
  assert.notEqual(w.id, w2.id, '换悬赏就是另一条愿')
})

test('四种记录都能原样打包再解析回来', async () => {
  const a = await signer()
  const w = await wishFrom(a)

  const psig = await signMessage(a.priv, signText.presence({ pub: a.pub, at: T0, wishId: w.id, hits: 12, dayHits: 40 }))
  const p = makePresence({ pub: a.pub, sig: psig, at: T0MS, wishId: w.id, hits: 12, dayHits: 40 })
  const pr = parseSangha(p.text)
  assert.equal(pr.kind, 'presence')
  assert.equal(pr.hits, 12)
  assert.equal(pr.at, T0)

  const jsig = await signMessage(a.priv, signText.join({ wishId: w.id, pub: a.pub, at: T0 }))
  const j = parseSangha(makeJoin({ pub: a.pub, sig: jsig, wishId: w.id, at: T0MS }).text)
  assert.equal(j.wishId, w.id)

  const dsig = await signMessage(a.priv, signText.deliver({ wishId: w.id, pub: a.pub, hits: 125, sealShort: '0123456789abcdef', at: T0 }))
  const d = parseSangha(makeDeliver({ pub: a.pub, sig: dsig, wishId: w.id, hits: 125, sealShort: '0123456789abcdef', at: T0MS }).text)
  assert.equal(d.hits, 125)
  assert.equal(d.sealShort, '0123456789abcdef')
})

test('垃圾、截断、位数不对的消息一律不进聚合', () => {
  assert.equal(parseSangha(''), null)
  assert.equal(parseSangha('hello world'), null)
  assert.equal(parseSangha('CTH1.'), null)
  assert.equal(parseSangha('CTH1.abc'), null)
  assert.equal(aggregate(['x', 'y', null]).wishes.length, 0)
})

test('心跳去重：同一个人连发三次，只算一个人、进度取最大值不累加', async () => {
  const a = await signer()
  const w = await wishFrom(a, { need: 125 })
  const items = [
    w,
    makePresence({ pub: a.pub, sig: 'x'.repeat(80), at: T0MS, wishId: w.id, hits: 10 }),
    makePresence({ pub: a.pub, sig: 'x'.repeat(80), at: T0MS + 5000, wishId: w.id, hits: 40 }),
    makePresence({ pub: a.pub, sig: 'x'.repeat(80), at: T0MS + 10000, wishId: w.id, hits: 60 })
  ]
  const g = aggregate(items, { now: T0MS + 12000 })
  assert.equal(g.online, 1, '同一个法号只算一个在场者')
  assert.equal(g.wishes[0].progress, 60, '重复上报只取最大值，不能靠重发心跳灌水')
})

test('多人共诵按人累加，送达用送达击数覆盖心跳值', async () => {
  const [a, b, c] = await Promise.all([signer(), signer(), signer()])
  const w = await wishFrom(a, { need: 125 })
  const items = [
    w,
    makePresence({ pub: b.pub, sig: 'x'.repeat(80), at: T0MS + 1000, wishId: w.id, hits: 50 }),
    // c 先报了 30 击，后来正式送达 70 击 —— 应取 70，而不是相加成 100
    makePresence({ pub: c.pub, sig: 'x'.repeat(80), at: T0MS + 1000, wishId: w.id, hits: 30 }),
    makeDeliver({ pub: c.pub, sig: 'y'.repeat(80), wishId: w.id, hits: 70, sealShort: '', at: T0MS + 20000 })
  ]
  const g = aggregate(items, { now: T0MS + 25000 })
  assert.equal(g.wishes[0].progress, 120)
  assert.equal(g.wishes[0].delivered, 1)
  assert.equal(g.wishes[0].crowd, 2)
})

test('超过在场窗口的心跳不再计入在线人数', async () => {
  const a = await signer()
  const p = makePresence({ pub: a.pub, sig: 'x'.repeat(80), at: T0MS, wishId: '', hits: 0 })
  const fresh = aggregate([p], { now: T0MS + 5000 })
  assert.equal(fresh.online, 1)
  const stale = aggregate([p], { now: T0MS + PRESENCE_WINDOW_MS + 1000 })
  assert.equal(stale.online, 0, '早就没心跳的人不能一直挂着算在线')
})

test('自己的愿标 mine，别人的愿不标；在线里没有自己时自动补上', async () => {
  const [a, b] = await Promise.all([signer(), signer()])
  const w1 = await wishFrom(a, { text: '愿猫找到家', at: T0MS })
  const w2 = await wishFrom(b, { text: '愿 offer 落地', at: T0MS + 1000 })
  const g = aggregate([w1, w2], { selfPub: a.pub, now: T0MS + 2000 })
  const one = g.wishes.find((x) => x.id === w1.id)
  const two = g.wishes.find((x) => x.id === w2.id)
  assert.equal(one.mine, true)
  assert.equal(two.mine, false)
  assert.equal(g.online, 1, '刚打开还没发心跳，也要算自己一个')
})

test('签名真的能被验证：伪造的公钥或改过的字段都过不了', async () => {
  const a = await signer()
  const w = await wishFrom(a)
  const ok = await verifySangha([parseSangha(w.text)], { verify: verifyMessage })
  assert.equal(ok.ok, true)
  assert.equal(ok.records.length, 1, '真签名应当通过')

  const tampered = makeWish({ pub: a.pub, sig: 'A'.repeat(86), text: '愿父母身体安康', bounty: 50, need: 125, at: T0MS })
  const bad = await verifySangha([parseSangha(tampered.text)], { verify: verifyMessage })
  assert.equal(bad.records.length, 0)
  assert.equal(bad.rejected, 1)

  // 拿自己签的 join 套到别人名下
  const other = await signer()
  const sigA = await signMessage(a.priv, signText.join({ wishId: w.id, pub: a.pub, at: T0 }))
  const stolen = makeJoin({ pub: other.pub, sig: sigA, wishId: w.id, at: T0MS })
  const r = await verifySangha([parseSangha(stolen.text)], { verify: verifyMessage })
  assert.equal(r.records.length, 0, '签名和公钥不匹配必须被拒')
})

test('愿文长度与悬赏范围有硬边界', async () => {
  const a = await signer()
  const long = makeWish({ pub: a.pub, sig: 'x'.repeat(80), text: '愿'.repeat(WISH_TEXT_MAX + 5), bounty: 20, need: 50, at: T0MS })
  const parsed = parseSangha(long.text)
  assert.ok(!parsed || parsed.wish.length <= WISH_TEXT_MAX)
})

test('昵称稳定：同一个法号每次算出来一样', () => {
  const pub = 'A'.repeat(44)
  assert.equal(soulName(pub), soulName(pub))
  assert.equal(shortPub(pub).length, 7)
})
