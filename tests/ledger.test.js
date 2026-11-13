import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSeal, packRecord, b64urlEncode } from '../src/temple/seal.js'
import { makePattern, seedFrom, settle } from '../src/temple/rhythm.js'
import { createIdentity, signMessage, verifyMessage } from '../src/temple/identity.js'
import {
  makeClaim, makeTransfer, makeCard, parseCard, parseRecord,
  claimMessage, transferMessage, auditLedger, packBundle, unpackBundle, nameOf
} from '../src/temple/ledger.js'

const DAY = 20261113
const AT = 1763000000000
const AT_SEC = Math.floor(AT / 1000)
const flipLast = (s) => s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0')

function sealAt(round = 3, at = AT) {
  const seed = seedFrom(round, DAY)
  const pattern = makePattern(seed)
  const marks = {}
  pattern.beats.forEach((b, i) => { marks[b.index] = i % 5 === 0 ? 'miss' : 'perfect' })
  const result = settle(pattern, marks, 1480)
  return makeSeal({
    round, daySeed: DAY, pattern, marks, wild: 0, online: 1480,
    result, prev: '', at
  })
}

async function claimFor(id, seal, at = AT) {
  const sig = await signMessage(id.priv, claimMessage(seal.short, id.pub))
  return makeClaim({ pub: id.pub, sig, sealText: seal.text, at })
}

async function transferFor(id, seal, to, { purpose = '', prev, at = AT, from } = {}) {
  const msg = transferMessage({
    ticket: seal.short, amount: seal.reward, from: from || id.pub,
    to, purpose, at: Math.floor(at / 1000), prev
  })
  const sig = await signMessage(id.priv, msg)
  return makeTransfer({
    pub: from || id.pub, sig, sealText: seal.text, to, purpose, prev, at
  })
}

test('法号：签名能验，换个人或改一个字都验不过', async () => {
  const a = await createIdentity()
  const b = await createIdentity()
  assert.match(a.pub, /^[A-Za-z0-9_-]{40,120}$/)
  assert.equal(a.pub.length, 87, 'P-256 未压缩公钥应为 87 个 base64url 字符')
  assert.notEqual(a.pub, b.pub)

  const sig = await signMessage(a.priv, 'CTK1|abc|def')
  assert.equal(await verifyMessage(a.pub, 'CTK1|abc|def', sig), true)
  assert.equal(await verifyMessage(a.pub, 'CTK1|abc|deg', sig), false)
  assert.equal(await verifyMessage(b.pub, 'CTK1|abc|def', sig), false)
  assert.equal(await verifyMessage('不是公钥', 'CTK1|abc|def', sig), false)
})

test('法号名稳定且互不相同', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  assert.equal(nameOf(a.pub), nameOf(a.pub))
  assert.match(nameOf(a.pub), /^#[0-9a-f]{6}$/)
  assert.notEqual(nameOf(a.pub), nameOf(b.pub))
})

test('认领后整张票可以 A→B→C，链尾就是当前持有人', async () => {
  const [a, b, c] = await Promise.all([createIdentity(), createIdentity(), createIdentity()])
  const seal = sealAt(3)
  const claim = await claimFor(a, seal)
  const ab = await transferFor(a, seal, b.pub, { prev: claim.short, purpose: '替你敲的这炷' })
  const bc = await transferFor(b, seal, c.pub, { prev: ab.short })

  const audit = await auditLedger([claim, ab, bc], { verify: verifyMessage })
  assert.equal(audit.ok, true, JSON.stringify(audit.conflicts))
  assert.equal(audit.tickets.length, 1)
  const t = audit.tickets[0]
  assert.equal(t.short, seal.short)
  assert.equal(t.reward, seal.reward)
  assert.equal(t.holder, c.pub)
  assert.equal(t.holderName, nameOf(c.pub))
  assert.equal(t.history.length, 3)
  assert.equal(t.history[1].purpose, '替你敲的这炷')
  assert.equal(audit.rejected.length, 0)
})

test('同一张票同时转给两个人：两本账一合并就报双花', async () => {
  const [a, b, c] = await Promise.all([createIdentity(), createIdentity(), createIdentity()])
  const seal = sealAt(4)
  const claim = await claimFor(a, seal)
  const ab = await transferFor(a, seal, b.pub, { prev: claim.short })
  const ac = await transferFor(a, seal, c.pub, { prev: claim.short })

  // 只看单边，各自都像正常转让
  assert.equal((await auditLedger([claim, ab], { verify: verifyMessage })).ok, true)
  assert.equal((await auditLedger([claim, ac], { verify: verifyMessage })).ok, true)

  // 合起来就露馅
  const audit = await auditLedger([claim, ab, ac], { verify: verifyMessage })
  assert.equal(audit.ok, false)
  const hit = audit.conflicts.find((x) => x.kind === 'double-spend')
  assert.ok(hit, JSON.stringify(audit.conflicts))
  assert.match(hit.detail, /同时转给了 2 个法号/)
  assert.equal(audit.doubleSpent, 1)
})

test('同一张票被两个法号认领：只认最早那条，并报归属冲突', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(5)
  const first = await claimFor(a, seal, AT)
  const second = await claimFor(b, seal, AT + 5000)

  const audit = await auditLedger([first, second], { verify: verifyMessage })
  assert.equal(audit.ok, false)
  assert.equal(audit.tickets[0].holder, a.pub)
  assert.ok(audit.conflicts.some((x) => x.kind === 'claim-conflict'))
})

test('冒名转让：拿别人公钥当 from，签名对不上', async () => {
  const [a, b, c] = await Promise.all([createIdentity(), createIdentity(), createIdentity()])
  const seal = sealAt(6)
  const claim = await claimFor(a, seal)
  // b 想冒充 a 把票转走：from 写 a，签名用自己的私钥
  const forged = await transferFor(b, seal, c.pub, { prev: claim.short, from: a.pub })

  const audit = await auditLedger([claim, forged], { verify: verifyMessage })
  assert.equal(audit.tickets[0].holder, a.pub, '伪造的转让不能改变持有人')
  assert.equal(audit.rejected.length, 1)
  assert.match(audit.rejected[0].reason, /签名/)
})

test('不是持有人却签了有效名：链上判为越权转让', async () => {
  const [a, b, c] = await Promise.all([createIdentity(), createIdentity(), createIdentity()])
  const seal = sealAt(7)
  const claim = await claimFor(a, seal)
  // b 用自己的名义签，签名有效，但 b 从来不是这张票的持有人
  const steal = await transferFor(b, seal, c.pub, { prev: claim.short })

  const audit = await auditLedger([claim, steal], { verify: verifyMessage })
  assert.equal(audit.ok, false)
  assert.ok(audit.conflicts.some((x) => x.kind === 'not-holder'))
  assert.equal(audit.tickets[0].holder, a.pub)
})

test('金额必须等于票面：多写一个 $G 也过不了', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(8)
  const claim = await claimFor(a, seal)
  const prev = claim.short
  const at = AT_SEC
  const msg = transferMessage({
    ticket: seal.short, amount: seal.reward, from: a.pub, to: b.pub,
    purpose: '', at, prev
  })
  const sig = await signMessage(a.priv, msg)
  // 签名本身合法，但 payload 里把金额改大，重新打包 → 校验码合法、语义不合法
  const payload = [1, seal.short, seal.reward + 10, a.pub, b.pub, '', at, prev, sig, seal.text]
  const padded = packRecord('CTX1', b64urlEncode(JSON.stringify(payload)))

  assert.ok(parseRecord(padded), '这仍然是一条结构合法的流水')
  const audit = await auditLedger([claim, padded], { verify: verifyMessage })
  assert.equal(audit.tickets[0].holder, a.pub)
  assert.equal(audit.rejected.length, 1)
  assert.match(audit.rejected[0].reason, /票面/)
})

test('只拿到一条转让单：内嵌认领能让接收方独立追溯到票的来源', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(9)
  const claim = await claimFor(a, seal)
  const ab = makeTransfer({
    pub: a.pub,
    sig: await signMessage(a.priv, transferMessage({
      ticket: seal.short, amount: seal.reward, from: a.pub, to: b.pub,
      purpose: '', at: AT_SEC, prev: claim.short
    })),
    sealText: seal.text, claimText: claim.text, to: b.pub, prev: claim.short, at: AT
  })

  // 接收方手里只有这一条流水，没有 A 的认领记录
  const audit = await auditLedger([ab], { verify: verifyMessage })
  assert.equal(audit.ok, true, JSON.stringify(audit.conflicts))
  assert.equal(audit.tickets.length, 1)
  const t = audit.tickets[0]
  assert.equal(t.holder, b.pub)
  assert.equal(t.implicit, false, '认领是从转让单里恢复的，不算无源')
  assert.equal(t.history[0].kind, 'claim')
  assert.equal(t.history[0].to, a.pub)
})

test('连认领都没有：从自称链头的那条转让起步，并标明来源较弱', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(10)
  const claim = await claimFor(a, seal)
  const ab = await transferFor(a, seal, b.pub, { prev: claim.short })

  // 剥掉认领，只留转让单（模拟公告板上只剩这一条）
  const audit = await auditLedger([ab], { verify: verifyMessage })
  assert.equal(audit.tickets.length, 1)
  const t = audit.tickets[0]
  assert.equal(t.holder, b.pub)
  assert.equal(t.implicit, true, '无认领时应当明确标记来源较弱')
})

test('流水被改一个字：校验码立刻不符，解析直接失败', async () => {
  const a = await createIdentity()
  const seal = sealAt(10)
  const claim = await claimFor(a, seal)
  assert.ok(parseRecord(claim.text))
  assert.equal(parseRecord(flipLast(claim.text)), null)
  assert.equal(parseRecord(claim.text.slice(0, -3)), null)
  assert.equal(parseRecord('CTX1.abc'), null)
})

test('用途写中文不影响签名：编解码必须按 UTF-8 往返', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(12)
  const claim = await claimFor(a, seal)
  const rec = await transferFor(a, seal, b.pub, { prev: claim.short, purpose: '替我敲的这炷' })

  const parsed = parseRecord(rec.text)
  assert.ok(parsed)
  assert.equal(parsed.purpose, '替我敲的这炷')
  assert.equal(parsed.sealText, seal.text)
  assert.equal(await verifyMessage(parsed.from, transferMessage(parsed), parsed.sig), true)

  const audit = await auditLedger([claim, rec], { verify: verifyMessage })
  assert.equal(audit.ok, true, JSON.stringify(audit.conflicts))
  assert.equal(audit.tickets[0].history[1].purpose, '替我敲的这炷')
})

test('整包流水能原样搬运，坏的条目自动剔掉', async () => {
  const [a, b] = await Promise.all([createIdentity(), createIdentity()])
  const seal = sealAt(11)
  const claim = await claimFor(a, seal)
  const ab = await transferFor(a, seal, b.pub, { prev: claim.short })

  const pack = packBundle([claim.text, 'not-a-record', ab.text])
  const back = unpackBundle(pack)
  assert.equal(back.records.length, 2)
  assert.equal(unpackBundle(flipLast(pack)), null)

  const audit = await auditLedger(back.records, { verify: verifyMessage })
  assert.equal(audit.ok, true)
  assert.equal(audit.tickets[0].holder, b.pub)
})

test('收款码：解出来就是本人公钥，改一位就作废', async () => {
  const a = await createIdentity()
  const card = makeCard(a.pub)
  assert.ok(card.startsWith('CTP1.'))
  assert.equal(parseCard(card), a.pub)
  assert.equal(parseCard(flipLast(card)), null)
  assert.equal(parseCard(a.pub), null, '裸公钥不能直接当收款码')
})

test('旧版本 v1 回执同样能当票用', async () => {
  const a = await createIdentity()
  const pattern = makePattern(seedFrom(2, DAY))
  const marks = Object.fromEntries(pattern.beats.map((b) => [b.index, 'perfect']))
  const result = settle(pattern, marks, 900)
  const legacy = makeSeal({
    round: 2, daySeed: DAY, pattern, marks,
    wild: 0, online: 900, result, prev: '', at: AT
  })
  const claim = await claimFor(a, legacy)
  assert.ok(claim, 'v1 回执应当能被认领')
  const audit = await auditLedger([claim], { verify: verifyMessage })
  assert.equal(audit.ok, true)
  assert.equal(audit.tickets.length, 1)
})

test('空账本不报错，也不凭空产生票', async () => {
  const audit = await auditLedger([], { verify: verifyMessage })
  assert.equal(audit.ok, true)
  assert.equal(audit.tickets.length, 0)
  assert.equal((await auditLedger(null)).ok, true)
})
