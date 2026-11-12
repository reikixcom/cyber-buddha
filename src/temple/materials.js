import * as THREE from 'three'

export const PALETTE = {
  cyan: 0x00f0ff,
  magenta: 0xff2d95,
  gold: 0xffcc66,
  violet: 0x8a5cff,
  ink: 0x05030f,
  steel: 0x111a2b,
  darkMetal: 0x0c1220
}

const CN_FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const MONO_FONT = 'Consolas, "SFMono-Regular", Menlo, monospace'

/** 自发光霓虹材质 */
export function neon(color, intensity = 1.8, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: opts.base ?? 0x0a1420,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.32,
    ...(opts.extra || {})
  })
}

/** 金属结构材质 */
export function metal(color = PALETTE.darkMetal, emissive = 0x000000, intensity = 0.15) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.82,
    roughness: 0.38
  })
}

/**
 * 生成中文霓虹文字贴图（支持竖排），返回 { texture, aspect }
 */
export function labelTexture(text, {
  fontSize = 96,
  color = '#eafcff',
  glow = '#00f0ff',
  vertical = false,
  weight = 800,
  font = CN_FONT,
  gap = 0,
  padding = 30,
  bg = null,
  sub = null
} = {}) {
  const chars = Array.from(text)
  const step = fontSize + gap
  const w = vertical ? fontSize + padding * 2 : chars.length * step + padding * 2
  const h = vertical ? chars.length * step + padding * 2 : fontSize + padding * 2 + (sub ? 34 : 0)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w / 4) * 4
  canvas.height = Math.ceil(h / 4) * 4
  const ctx = canvas.getContext('2d')

  if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = glow
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.55
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12)
    ctx.globalAlpha = 1
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${weight} ${fontSize}px ${font}`
  ctx.shadowColor = glow
  ctx.shadowBlur = fontSize * 0.55

  chars.forEach((ch, i) => {
    const x = vertical ? canvas.width / 2 : padding + step * (i + 0.5)
    const y = vertical ? padding + step * (i + 0.5) : canvas.height / 2 - (sub ? 14 : 0)
    for (let p = 0; p < 3; p++) {
      ctx.fillStyle = glow
      ctx.globalAlpha = 0.28
      ctx.fillText(ch, x, y)
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillText(ch, x, y)
    ctx.shadowBlur = 0
    ctx.lineWidth = 1.4
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.strokeText(ch, x, y)
    ctx.shadowBlur = fontSize * 0.55
  })

  if (sub) {
    ctx.shadowBlur = 10
    ctx.font = `500 ${Math.round(fontSize * 0.24)}px ${MONO_FONT}`
    ctx.fillStyle = glow
    const subY = canvas.height - padding * 0.55
    ctx.fillText(sub, canvas.width / 2, subY)
  }

  ctx.shadowBlur = 0
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: canvas.width / canvas.height }
}

/** 悬浮霓虹字牌 */
export function signPlane(text, height, opts = {}) {
  const { texture, aspect } = labelTexture(text, opts)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: opts.opacity ?? 1
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat)
  mesh.userData.isSign = true
  return mesh
}

/** 径向光晕贴图（复用缓存） */
let _glowTex = null
export function glowTexture() {
  if (_glowTex) return _glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)')
  g.addColorStop(0.48, 'rgba(255,255,255,0.2)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  _glowTex = new THREE.CanvasTexture(c)
  return _glowTex
}

export function glowSprite(color = PALETTE.cyan, size = 3, opacity = 0.75) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity: opacity * 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  const s = new THREE.Sprite(mat)
  s.scale.set(size, size, 1)
  return s
}

/** 地面电路网格贴图 */
export function circuitTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#060b16'
  ctx.fillRect(0, 0, 512, 512)

  ctx.strokeStyle = 'rgba(0,240,255,0.10)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(0,240,255,0.32)'
  ctx.lineWidth = 2
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(Math.random() * 16) * 32
    const y = Math.floor(Math.random() * 16) * 32
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 32 * (1 + Math.floor(Math.random() * 3)), y)
    ctx.lineTo(x + 32 * (1 + Math.floor(Math.random() * 3)), y + 32 * (1 + Math.floor(Math.random() * 3)))
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,45,149,0.5)'
    ctx.fillRect(x - 2, y - 2, 4, 4)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(8, 18)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 交互标记：旋转圆环 + 光点 + 中文标签 */
export function hotspotMarker(id, title, color = PALETTE.gold) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.016, 6, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  g.add(ring)
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.008, 6, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  ring2.rotation.x = Math.PI / 2.4
  g.add(ring2)
  const dot = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.09),
    new THREE.MeshBasicMaterial({ color })
  )
  g.add(dot)
  const halo = glowSprite(color, 1.5, 0.35)
  g.add(halo)

  const label = signPlane(title, 0.26, { fontSize: 80, color: '#fff4d6', glow: '#ffcc66', padding: 16 })
  label.position.y = 0.62
  g.add(label)

  g.userData.hotspot = id
  ring.userData.hotspot = id
  ring2.userData.hotspot = id
  dot.userData.hotspot = id
  label.userData.hotspot = id
  g.userData.spin = ring2
  g.userData.dot = dot
  return g
}

/** 给一组网格快速打上热点标记 */
export function tagHotspot(object, id) {
  object.traverse((o) => { o.userData.hotspot = id })
  return object
}
