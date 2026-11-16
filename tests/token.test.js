import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TOKEN, bookOf, packSnapshot, unpackSnapshot, mergeSnapshots,
  mergeLine, TOKEN_RULES, SNAP_PREFIX, MAX_SNAP_TICKETS
} from '../src/temple/token.js'

const PUB_A = 'A'.repeat(87)
const PUB_B = 'B'.repeat(87)

test('台账：修行所得 / 当前余额 / 亲手转出，三个数各管一件事', () => {
  const b = bookOf({ issued: 1200, balance: 640, sent: 400, received: 200, tickets: 9, seals: 16 })
  assert.equal(b.issued, 1200)
  assert.equal(b.balance, 640)
  assert.equal(b.sent, 400)
  assert.equal(b.tickets, 9)
  assert.equal(b.perSeal, 75)
  assert.equal(b.cap, TOKEN.cap)
  assert.ok(b.pctOfCap > 0 && b.pctOfCap < 1)
  assert.ok(b.givenAway > 0 && b.givenAway <= 1)
})

test('台账：脏数据不炸，负数与 NaN 一律当 0，不会出现负余额', () => {
  const b = bookOf({ issued: -5, balance: NaN, sent: 'x', seals: -3 })
  assert.equal(b.issued, 0)
  assert.equal(b.balance, 0)
  assert.equal(b.sent, 0)
  assert.equal(b.perSeal, 0)
  assert.equal(bookOf().cap, TOKEN.cap)
})

test('快照：打包再解开，余额与票号原样回来', () => {
  const s = packSnapshot({
    pub: PUB_A, name: '#a3f2c1', balance: 512, issued: 900, sent: 88, received: 12,
    tickets: [{ t: 'a'.repeat(16), a: 72 }, { t: 'b'.repeat(16), a: 88 }],
    at: 1763000000000
  })
  assert.ok(s.text.startsWith(SNAP_PREFIX + '.'))
  const back = unpackSnapshot(s.text)
  assert.ok(back?.ok)
  assert.equal(back.pub, PUB_A)
  assert.equal(back.name, '#a3f2c1')
  assert.equal(back.balance, 512)
  assert.equal(back.issued, 900)
  assert.equal(back.sent, 88)
  assert.equal(back.tickets.length, 2)
  assert.equal(back.at, 1763000000)
})

test('快照：改名一个字就解不开，也不能拿别人的前缀冒充', () => {
  const s = packSnapshot({ pub: PUB_A, balance: 10 })
  const parts = s.text.split('.')
  const flip = (c) => (c === 'A' ? 'B' : 'A')
  const bad = [parts[0], flip(parts[1][0]) + parts[1].slice(1), parts[2]].join('.')
  assert.equal(unpackSnapshot(bad), null)
  assert.equal(unpackSnapshot('CTX1.' + parts[1] + '.' + parts[2]), null)
  assert.equal(unpackSnapshot(''), null)
  assert.equal(unpackSnapshot(null), null)
})

test('快照：没有合法公钥就打不出来，票号必须是 16 位十六进制', () => {
  assert.equal(packSnapshot({ balance: 10 }), null)
  assert.equal(packSnapshot({ pub: 'too-short', balance: 10 }), null)
  const s = packSnapshot({
    pub: PUB_A, balance: 10,
    tickets: [{ t: 'not-a-ticket' }, { t: 'c'.repeat(16), a: 5 }]
  })
  assert.equal(unpackSnapshot(s.text).tickets.length, 1)
})

test('快照：票数与余额都有上限，别让一条文本大到贴不进聊天框', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ t: i.toString(16).padStart(16, '0'), a: 1 }))
  const s = packSnapshot({ pub: PUB_A, balance: 1e12, tickets: many })
  const back = unpackSnapshot(s.text)
  assert.equal(back.tickets.length, MAX_SNAP_TICKETS)
  assert.ok(back.balance <= 1e9)
})

test('合并：同一法号导出两次只算最新一份，不会把总量灌水', () => {
  const old = packSnapshot({ pub: PUB_A, name: '#a3f2c1', balance: 100, at: 1763000000000 })
  const fresh = packSnapshot({ pub: PUB_A, name: '#a3f2c1', balance: 260, at: 1763000900000 })
  const m = mergeSnapshots([old.text, fresh.text])
  assert.equal(m.count, 1)
  assert.equal(m.holders[0].balance, 260)
  assert.equal(m.totalBalance, 260)
  assert.equal(m.repeats, 1)
  assert.match(mergeLine(m), /重复/)
})

test('合并：旧的一份更新，也不会把新余额倒扣回去', () => {
  const fresh = packSnapshot({ pub: PUB_A, balance: 260, at: 1763000900000 })
  const old = packSnapshot({ pub: PUB_A, balance: 100, at: 1763000000000 })
  const m = mergeSnapshots([fresh.text, old.text])
  assert.equal(m.holders[0].balance, 260)
})

test('合并：不同法号各算一份，总数与票数都累加', () => {
  const a = packSnapshot({ pub: PUB_A, balance: 300, tickets: [{ t: 'a'.repeat(16), a: 72 }] })
  const b = packSnapshot({ pub: PUB_B, balance: 200, tickets: [{ t: 'b'.repeat(16), a: 88 }] })
  const m = mergeSnapshots([a.text, b.text])
  assert.equal(m.count, 2)
  assert.equal(m.totalBalance, 500)
  assert.equal(m.totalTickets, 2)
  assert.equal(m.holders[0].balance, 300, '按持仓从大到小排')
  assert.equal(m.digest.length, 32)
})

test('合并：摘要对内容敏感 —— 改一个余额，摘要就换，名单赖不掉', () => {
  const a1 = packSnapshot({ pub: PUB_A, balance: 300, at: 1 })
  const a2 = packSnapshot({ pub: PUB_A, balance: 301, at: 1 })
  const d1 = mergeSnapshots([a1.text]).digest
  const d2 = mergeSnapshots([a2.text]).digest
  assert.notEqual(d1, d2)
  // 同样的输入永远同样的摘要：谁都能自己复算
  assert.equal(mergeSnapshots([a1.text]).digest, d1)
})

test('合并：垃圾输入被丢掉，不污染结果', () => {
  const good = packSnapshot({ pub: PUB_A, balance: 50 })
  const m = mergeSnapshots([good.text, 'garbage', '', null, 'CTA1.xxx.yyy'])
  assert.equal(m.count, 1)
  assert.ok(m.bad >= 1)
  assert.equal(mergeSnapshots([]).ok, false)
  assert.match(mergeLine(null), /没有可用/)
  assert.equal(mergeSnapshots('not-an-array').count, 0)
})

test('规则文案必须写清楚「无预挖」与「未上链」，别把话说满', () => {
  const joined = TOKEN_RULES.join('')
  assert.match(joined, /21,000,000/)
  assert.match(joined, /没有预挖/)
  assert.match(joined, /未上链/)
  assert.match(joined, /不承诺任何收益/)
})
