/**
 * 战绩分享卡 —— 把「我敲了多少」画成一张能发出去的图。
 *
 * 为什么值得做：这座寺里没有任何「官方排行榜」可以背书，晒成绩只能靠自己。
 * 一张带法号、功德、禅印短码的图，别人可以拿着短码回站里复算 —— 于是
 * 「晒」这件事本身变成了可核对的，而不是截图谁都能 P。
 *
 * 纯绘制：只依赖 Canvas 2D，不碰 DOM / 网络 / Vue，Node 里也能用（只要有 ctx）。
 * 卡片尺寸固定 1080×1350（4:5），微信、X、小红书都不会裁掉关键信息。
 */

export const CARD_W = 1080
export const CARD_H = 1350

const DAY_RE = /^(\d{4})(\d{2})(\d{2})$/

function fmtDay(seed) {
  const s = String(seed || '')
  // 信标回执里存的是 2026-11-13，本机弱验证回执里是 20261113，两种都认
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(DAY_RE)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

function grade(acc) {
  if (acc >= 0.92) return '上品'
  if (acc >= 0.78) return '中品'
  if (acc > 0) return '下品'
  return '未定'
}

/**
 * 从玩法状态里抽出一张卡的素材。
 * 注意 seals 在存档里是「一行行回执文本」，解析它们没必要 —— 玩法层已经把最近
 * 一张的结论（round/accuracy/short/beaconRound）算好了，直接用。
 * 所有字段都做上限保护：这张卡会被发出去，不能因为一个 NaN 就画出「NaN $G」。
 */
export function buildShareData({ merit = 0, bestCombo = 0, knockCount = 0, sealCount = 0, lastSeal = null, identity = null, online = 0 } = {}) {
  const last = lastSeal && typeof lastSeal === 'object' ? lastSeal : null
  const num = (v, cap = 1e9) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(cap, n)) : 0
  }
  return {
    name: identity?.name || '#未署名',
    merit: Math.round(num(merit)),
    bestCombo: Math.round(num(bestCombo, 1e5)),
    knocks: Math.round(num(knockCount, 1e7)),
    sealCount: Math.round(num(sealCount, 1e5)),
    round: Math.round(num(last?.round, 1e7)),
    accuracy: Math.min(1, num(last?.accuracy)),
    perfect: Math.round(num(last?.perfect, 1e4)),
    miss: Math.round(num(last?.miss, 1e4)),
    short: typeof last?.short === 'string' ? last.short.slice(0, 16) : '',
    day: fmtDay(last?.dayTag || last?.daySeed),
    source: last ? (Number(last?.beaconRound) > 0 ? '公开信标' : '本机弱验证') : '',
    grade: grade(num(last?.accuracy)),
    online: Math.round(num(online, 1e6)),
    hasSeal: !!last
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function fitText(ctx, text, maxWidth) {
  let s = String(text)
  if (ctx.measureText(s).width <= maxWidth) return s
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

/**
 * 画一张卡。ctx 需已按 CARD_W × CARD_H 的坐标系准备好。
 */
export function drawShareCard(ctx, d, opts = {}) {
  const W = CARD_W
  const H = CARD_H
  const accent = opts.accent || '#00f0ff'
  const gold = '#ffcc66'
  const sans = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

  // 底：深空渐变 + 两团辉光
  ctx.fillStyle = '#05030f'
  ctx.fillRect(0, 0, W, H)
  const g1 = ctx.createRadialGradient(W * 0.14, H * 0.06, 0, W * 0.14, H * 0.06, W * 0.9)
  g1.addColorStop(0, 'rgba(0, 240, 255, 0.20)')
  g1.addColorStop(1, 'rgba(0, 240, 255, 0)')
  ctx.fillStyle = g1
  ctx.fillRect(0, 0, W, H)
  const g2 = ctx.createRadialGradient(W * 0.92, H * 0.92, 0, W * 0.92, H * 0.92, W * 0.8)
  g2.addColorStop(0, 'rgba(255, 60, 172, 0.18)')
  g2.addColorStop(1, 'rgba(255, 60, 172, 0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, W, H)

  // 网格
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke()
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke()
  }

  // 边框与四角
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)'
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, W - 72, H - 72)
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)'
  ctx.lineWidth = 6
  const c = 30
  const corners = [[36, 36, 1, 1], [W - 36, 36, -1, 1], [36, H - 36, 1, -1], [W - 36, H - 36, -1, -1]]
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath()
    ctx.moveTo(x + dx * c, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * c)
    ctx.stroke()
  }

  const pad = 92
  let y = 150

  // 眉标
  ctx.fillStyle = accent
  ctx.font = `600 26px ${mono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('CYBER TEMPLE // 修行记录', pad, y)
  y += 92

  // 标题
  ctx.fillStyle = '#f2feff'
  ctx.font = `700 92px ${sans}`
  if ('shadowColor' in ctx) {
    ctx.shadowColor = 'rgba(0, 240, 255, 0.55)'
    ctx.shadowBlur = 34
  }
  ctx.fillText('赛博禅寺', pad, y)
  if ('shadowBlur' in ctx) ctx.shadowBlur = 0
  y += 46

  // 法号
  ctx.fillStyle = '#8aa6bb'
  ctx.font = `400 30px ${mono}`
  ctx.fillText(`法号 ${fitText(ctx, d.name, W - pad * 2 - 240)}`, pad, y)
  y += 34

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + 140, y); ctx.stroke()
  y += 88

  // 功德主数字
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 148px ${mono}`
  const meritText = String(d.merit)
  ctx.fillText(meritText, pad, y)
  const mw = ctx.measureText(meritText).width
  ctx.fillStyle = gold
  ctx.font = `600 44px ${mono}`
  ctx.fillText('$G', pad + mw + 14, y - 8)
  ctx.fillStyle = '#6e8ba3'
  ctx.font = `400 24px ${mono}`
  ctx.fillText('累计功德', pad, y + 46)
  y += 140

  // 三个小指标
  const stats = [
    ['最高连击', `×${d.bestCombo}`],
    ['总敲击', `${d.knocks}`],
    ['禅印', `${d.sealCount} 张`]
  ]
  const colW = (W - pad * 2) / 3
  for (let i = 0; i < stats.length; i++) {
    const x = pad + colW * i
    ctx.fillStyle = '#6e8ba3'
    ctx.font = `400 22px ${mono}`
    ctx.fillText(stats[i][0], x, y)
    ctx.fillStyle = '#eafcff'
    ctx.font = `600 46px ${mono}`
    ctx.fillText(stats[i][1], x, y + 58)
  }
  y += 132

  // 最近一炷：这是整张卡最该被复核的部分
  const boxH = 300
  roundRect(ctx, pad, y, W - pad * 2, boxH, 10)
  ctx.fillStyle = 'rgba(0, 240, 255, 0.05)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)'
  ctx.lineWidth = 2
  ctx.stroke()

  const bx = pad + 34
  let by = y + 62
  ctx.fillStyle = accent
  ctx.font = `600 24px ${mono}`
  ctx.fillText(d.hasSeal ? `最近一炷 · 第 ${d.round} 炷` : '还没有禅印', bx, by)
  by += 66

  if (d.hasSeal) {
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 76px ${mono}`
    const acc = Math.round(d.accuracy * 100)
    ctx.fillText(`${acc}%`, bx, by)
    const aw = ctx.measureText(`${acc}%`).width
    ctx.fillStyle = d.grade === '未定' ? '#8aa6bb' : gold
    ctx.font = `600 30px ${sans}`
    ctx.fillText(d.grade, bx + aw + 22, by - 6)

    const rx = bx + 360
    ctx.fillStyle = '#8aa6bb'
    ctx.font = `400 23px ${mono}`
    ctx.fillText(`合拍率 · PERFECT ${d.perfect} · MISS ${d.miss}`, rx, by - 42)
    ctx.fillText(`日期 ${d.day || '—'} · 来源 ${d.source || '—'}`, rx, by - 2)

    by += 74
    ctx.fillStyle = '#5ff2e0'
    ctx.font = `500 26px ${mono}`
    const codeText = `禅印 ${d.short}`
    ctx.fillText(codeText, bx, by)
    const codeW = ctx.measureText(codeText).width
    // 说明文字能塞进同一行就并排，塞不下就换行 —— 别让长短码压住它
    ctx.font = `400 22px ${mono}`
    const hint = '凭这串短码可在站内「禅印 → 验签」复算'
    const hintW = ctx.measureText(hint).width
    ctx.fillStyle = '#6e8ba3'
    if (bx + codeW + 26 + hintW <= pad + W - pad * 2 - 34) {
      ctx.fillText(hint, bx + codeW + 26, by)
    } else {
      ctx.fillText(hint, bx, by + 34)
    }
  } else {
    ctx.fillStyle = '#8aa6bb'
    ctx.font = `400 28px ${sans}`
    ctx.fillText('敲满一炷香，就会得到一张别人能复算的禅印。', bx, by)
  }

  // 页脚
  const fy = H - 92
  ctx.fillStyle = '#5ff2e0'
  ctx.font = `600 30px ${mono}`
  ctx.textAlign = 'left'
  ctx.fillText('cyberbuddha.ai', pad, fy)
  ctx.fillStyle = '#6e8ba3'
  ctx.font = `400 22px ${mono}`
  ctx.textAlign = 'right'
  ctx.fillText('规则开源 · 任何人可复算', W - pad, fy)
  ctx.textAlign = 'left'
  return true
}
