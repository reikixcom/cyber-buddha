/**
 * 公共公告板的中继策略：这是「不归项目方管」的代价所在 ——
 * 免费实例按来访 IP 限流，策略错了整个产品就时好时坏。
 * 这里只测纯策略：请求次数、切换顺序、退避、合并去重。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  publishRecord, pullRecords, RELAYS, relayHealth, resetRelayHealth
} from '../src/temple/bulletin.js'

const HOSTS = RELAYS.map((r) => r.host)

/** 记录每次请求，按 host 决定返回什么 */
function fakeNet(plan = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const host = u.host
    const method = init.method || 'GET'
    calls.push({ host, method, url })
    const p = plan[host]
    const decide = typeof p === 'function' ? p({ url, init, calls }) : p
    if (decide === 'ok') {
      if (method === 'POST') {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'x', time: 1700000000 }) }
      }
      const line = JSON.stringify({ event: 'message', message: `CTH1.${host}` })
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => line }
    }
    const status = decide || 429
    return {
      ok: false, status, headers: { get: (k) => (k === 'retry-after' ? '30' : null) },
      text: async () => '', json: async () => null
    }
  }
  return { fetchImpl, calls }
}

test('单点轮询只发一个请求：这是把限流压下去的关键', async () => {
  resetRelayHealth()
  const { fetchImpl, calls } = fakeNet(Object.fromEntries(HOSTS.map((h) => [h, 'ok'])))
  const r = await pullRecords({ fetchImpl, mode: 'fast' })
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'fast')
  assert.equal(calls.length, 1, `fast 模式只该读一个中继，实际 ${calls.length}`)
})

test('全量对齐才会读全部中继，并合并去重', async () => {
  resetRelayHealth()
  const { fetchImpl, calls } = fakeNet(Object.fromEntries(HOSTS.map((h) => [h, 'ok'])))
  const r = await pullRecords({ fetchImpl, mode: 'full' })
  assert.equal(r.ok, true)
  assert.equal(calls.length, HOSTS.length)
  assert.equal(r.messages.length, HOSTS.length, '每个中继各一条不同内容，应全部保留')
})

test('首个中继限流时自动换下一个，并记住它好用', async () => {
  resetRelayHealth()
  const bad = HOSTS[0]
  const good = HOSTS[1]
  const { fetchImpl, calls } = fakeNet({ [bad]: 429, [good]: 'ok' })
  const r = await pullRecords({ fetchImpl, mode: 'fast' })
  assert.equal(r.ok, true)
  assert.equal(r.host, good, '应当由第二个中继供消息')
  assert.equal(calls.length, 2, '最多试两个，不该把三个都撞一遍')
  const health = Object.fromEntries(relayHealth().map((h) => [h.host, h]))
  assert.ok(health[bad].readUntil > Date.now(), '读限流的中继要进冷却')
  assert.equal(health[good].readFails, 0)
  assert.ok(health[good].lastOk > 0)
})

test('健康度会改变下次尝试顺序', async () => {
  resetRelayHealth()
  const bad = HOSTS[0]
  const good = HOSTS[1]
  const plan = { [bad]: 429, [good]: 'ok' }
  const a = fakeNet(plan)
  await pullRecords({ fetchImpl: a.fetchImpl, mode: 'fast' })
  const b = fakeNet(plan)
  await pullRecords({ fetchImpl: b.fetchImpl, mode: 'fast' })
  assert.equal(b.calls[0].host, good, '第二个客户端应当先问上次好用的那个中继')
})

test('429 退避按次数翻倍，且有上限', async () => {
  resetRelayHealth()
  const all = Object.fromEntries(HOSTS.map((h) => [h, 429]))
  const waits = []
  for (let i = 0; i < 5; i++) {
    const { fetchImpl } = fakeNet(all)
    await pullRecords({ fetchImpl, mode: 'fast' })
    const h = relayHealth().find((x) => x.host === HOSTS[0])
    waits.push(h.readUntil - Date.now())
  }
  assert.ok(waits[0] >= 25000, `首次退避应约 30s，实际 ${waits[0]}`)
  assert.ok(waits[4] > waits[0], `连续失败应加长退避：${waits.join(',')}`)
  assert.ok(waits[4] <= 301000, '退避要有上限，别把重试推到无限远')
})

test('全部限流时如实报「限流」，不假装有数据', async () => {
  resetRelayHealth()
  const all = Object.fromEntries(HOSTS.map((h) => [h, 429]))
  const { fetchImpl } = fakeNet(all)
  const r = await pullRecords({ fetchImpl, mode: 'fast' })
  assert.equal(r.ok, false)
  assert.equal(r.limited, true)
  assert.match(r.reason, /限流/)
  assert.deepEqual(r.messages, [])
})

test('发布走最先健康的中继，成功后清零冷却', async () => {
  resetRelayHealth()
  const all = Object.fromEntries(HOSTS.map((h) => [h, 'ok']))
  const { fetchImpl, calls } = fakeNet(all)
  const r = await publishRecord('CTH1.demo', { fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  assert.ok(HOSTS.includes(r.relay))
})

test('发布遇到内容错误（4xx 非限流）不浪费请求换中继', async () => {
  resetRelayHealth()
  const all = Object.fromEntries(HOSTS.map((h) => [h, 400]))
  const { fetchImpl, calls } = fakeNet(all)
  const r = await publishRecord('x', { fetchImpl })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 1, '内容本身有问题，换中继也没用')
})

test('写被限流后，读成功不能顺手清掉写的退避', async () => {
  resetRelayHealth()
  const writeBad = HOSTS[0]
  // 第一家能读、不能写（实测 ntfy.sh 的当日消息配额就长这样）
  const plan = { [writeBad]: ({ init }) => (init.method === 'POST' ? 429 : 'ok') }
  const net = fakeNet(plan)

  const w = await publishRecord('CTH1.demo', { fetchImpl: net.fetchImpl })
  assert.equal(w.ok, false, '唯一能写的那家被限流，应如实失败')
  const afterWrite = relayHealth().find((h) => h.host === writeBad)
  assert.ok(afterWrite.writeUntil > Date.now(), '写要进冷却')
  assert.equal(afterWrite.readUntil, 0, '写失败不该连累读')

  // 读一次成功
  const rd = await pullRecords({ fetchImpl: net.fetchImpl, mode: 'fast', relays: [{ base: 'https://' + writeBad, host: writeBad }] })
  assert.equal(rd.ok, true)
  const afterRead = relayHealth().find((h) => h.host === writeBad)
  assert.ok(afterRead.writeUntil > Date.now(), '读成功不该清掉写的退避 —— 否则心跳会反复撞 429')
  assert.equal(afterRead.readUntil, 0)
})
