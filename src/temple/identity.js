/**
 * 法号（身份）—— 一把只存在你自己浏览器里的 P-256 密钥。
 *
 * 功德票要能转手，就必须回答「谁有权转」。没有服务端签发账号，所以用
 * Web Crypto 现成的 ECDSA：公钥当法号，私钥留在本机 localStorage。
 * 转让时对规范串签名，别人拿公钥一验就知道是不是持有人签的。
 *
 * 为什么不用助记词 / 钱包：这是寺里的功德票，不是链上资产，
 * 引入钱包会把「打开网页就能玩」变成「先装插件」。代价是私钥丢了票就
 * 归不了你 —— 所以提供了身份备份（CTI1.），导出时明确警告这是私钥。
 *
 * 边界：Web Crypto 只在安全上下文可用（https 或 localhost）。不可用时
 * 账本功能整体禁用并说明原因，绝不降级成「不验签的假签名」。
 */
import { packRecord, unpackRecord, b64urlEncode } from './seal.js'
import { sha256Hex } from './seal.js'

export const ID_KEY = 'cyber-temple-id-v1'
export const ID_BACKUP_PREFIX = 'CTI1'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function hasCrypto() {
  return typeof crypto !== 'undefined' && !!crypto.subtle &&
    typeof crypto.subtle.generateKey === 'function'
}

function bytesToB64url(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += B64[c & 63]
  }
  return out
}

function b64urlToBytes(s) {
  const bytes = []
  let acc = 0, bits = 0
  for (const ch of s) {
    const v = B64.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
  }
  return new Uint8Array(bytes)
}

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' }
const text = (s) => new TextEncoder().encode(String(s))

/** 生成一份新身份；私钥以 JWK 形式存本机，公钥是 65 字节未压缩点的 base64url */
export async function createIdentity() {
  if (!hasCrypto()) return null
  const pair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const pub = bytesToB64url(raw)
  return { v: 1, pub, priv, name: '#' + sha256Hex('ct-name|' + pub).slice(0, 6), at: Date.now() }
}

export async function signMessage(priv, msg) {
  if (!hasCrypto() || !priv) return ''
  try {
    const key = await crypto.subtle.importKey('jwk', priv, ALGO, false, ['sign'])
    const sig = await crypto.subtle.sign(SIGN_ALGO, key, text(msg))
    return bytesToB64url(new Uint8Array(sig))
  } catch { return '' }
}

export async function verifyMessage(pub, msg, sig) {
  if (!hasCrypto()) return false
  try {
    const raw = b64urlToBytes(String(pub))
    const sign = b64urlToBytes(String(sig))
    if (!raw || !sign) return false
    const key = await crypto.subtle.importKey('raw', raw, ALGO, false, ['verify'])
    return await crypto.subtle.verify(SIGN_ALGO, key, sign, text(msg))
  } catch { return false }
}

/* ------------------------------------------------------------------ *
 * 本机存取与备份
 * ------------------------------------------------------------------ */
export function loadIdentity() {
  try {
    const raw = localStorage.getItem(ID_KEY)
    if (!raw) return null
    const id = JSON.parse(raw)
    if (!id || typeof id.pub !== 'string' || typeof id.priv !== 'object') return null
    if (!/^[A-Za-z0-9_-]{40,120}$/.test(id.pub)) return null
    return id
  } catch { return null }
}

export function saveIdentity(id) {
  try { localStorage.setItem(ID_KEY, JSON.stringify(id)); return true } catch { return false }
}

/** 身份备份：含私钥，贴给别人等于把法号送人，UI 必须写清楚 */
export function packIdentity(id) {
  if (!id || !id.priv) return ''
  return packRecord(ID_BACKUP_PREFIX, b64urlEncode(JSON.stringify({ v: 1, pub: id.pub, priv: id.priv, at: id.at || Date.now() })))
}

export function unpackIdentity(txt) {
  const u = unpackRecord(txt, ID_BACKUP_PREFIX)
  if (!u || u.decoded === null) return null
  let obj
  try { obj = JSON.parse(u.decoded) } catch { return null }
  if (!obj || obj.v !== 1 || typeof obj.pub !== 'string' || typeof obj.priv !== 'object') return null
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(obj.pub)) return null
  return { v: 1, pub: obj.pub, priv: obj.priv, name: '#' + sha256Hex('ct-name|' + obj.pub).slice(0, 6), at: obj.at || 0 }
}
