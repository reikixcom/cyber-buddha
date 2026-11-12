import * as THREE from 'three'
import {
  PALETTE, neon, metal, signPlane, glowSprite, glowTexture,
  circuitTexture, hotspotMarker, tagHotspot
} from './materials.js'

const C = PALETTE

function outline(mesh, color = C.cyan, opacity = 0.7) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  )
  mesh.add(edges)
  return mesh
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, edge = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  if (edge) outline(m, edge)
  return m
}

function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0, edge = null) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
  m.position.set(x, y, z)
  if (edge) outline(m, edge)
  return m
}

function torus(r, tube, color, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(r, tube, 8, 48),
    new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false })
  )
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, 0)
  return m
}

function lightPool(color, size, opacity = 0.35, y = 0.02) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color, transparent: true, opacity: opacity * 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  )
  m.rotation.x = -Math.PI / 2
  m.position.y = y
  return m
}

/* ------------------------------------------------------------------ */
/*  场景总装                                                            */
/* ------------------------------------------------------------------ */
export function buildTemple(scene) {
  const root = new THREE.Group()
  scene.add(root)

  const animated = []
  const refs = {}
  const hotspots = {}

  const HOTSPOTS = [
    {
      id: 'incense', name: '量子香炉', action: '上一炷香 · 功德 +10', key: '1',
      focus: { pos: [0, 1.78, 8.7], look: [0, 1.35, 5] },
      marker: [0, 2.55, 5], merit: 10
    },
    {
      id: 'bow', name: '电子蒲团', action: '诚心叩拜 · 功德 +20', key: '2',
      focus: { pos: [0, 1.78, 2.0], look: [0, 3.15, -11.3] },
      marker: [1.35, 0.9, -2], merit: 20
    },
    {
      id: 'fish', name: '电子木鱼', action: '敲一下 · 功德 +1', key: '3',
      focus: { pos: [3.4, 1.78, 5.6], look: [3.4, 1.35, 1.6] },
      marker: [3.4, 2.35, 1.6], merit: 1
    },
    {
      id: 'bell', name: '赛博晨钟', action: '撞钟三响 · 功德 +5', key: '4',
      focus: { pos: [-4.2, 1.78, 6.4], look: [-4.2, 2.35, 1.6] },
      marker: [-4.2, 2.9, 1.6], merit: 5
    }
  ]

  buildSky(root, animated)
  buildGround(root)
  buildSkyline(root)
  buildGate(root, animated)
  buildLanterns(root, animated)
  buildSutraBanners(root, animated)
  buildIncenseBurner(root, refs)
  buildHall(root)
  buildBuddha(root, refs, animated)
  buildCushion(root)
  buildWoodenFish(root, refs, animated)
  buildBell(root, refs, animated)
  buildLights(scene)

  // 交互热点标记
  HOTSPOTS.forEach((h) => {
    const marker = hotspotMarker(h.id, h.name, h.id === 'fish' ? C.magenta : C.gold)
    marker.position.set(...h.marker)
    root.add(marker)
    hotspots[h.id] = { ...h, object: marker }
    animated.push((t) => {
      marker.userData.spin.rotation.z = t * 0.8
      marker.userData.spin.rotation.y = t * 0.5
      marker.userData.dot.rotation.y = t * 1.6
      marker.position.y = h.marker[1] + Math.sin(t * 1.6 + h.marker[0]) * 0.09
    })
  })

  return { root, hotspots, animated, refs }
}

/* ------------------------------------------------------------------ */
function buildSky(root, animated) {
  // 数据明月
  const moon = new THREE.Group()
  moon.position.set(0, 16, -52)
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(8.5, 64),
    new THREE.MeshBasicMaterial({ color: C.magenta, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  moon.add(disc)
  moon.add(torus(8.5, 0.09, C.magenta, 0, 0, 0.1))
  moon.add(torus(7.3, 0.025, C.cyan, 0, 0, 0.12))
  const halo = glowSprite(C.magenta, 34, 0.22)
  halo.position.z = -0.5
  moon.add(halo)
  // 月面横纹（赛博故障感）
  for (let i = 0; i < 7; i++) {
    const w = 3 + Math.random() * 9
    const bar = box(w, 0.06, 0.02,
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending }),
      0, -6 + i * 1.9, 0.15)
    moon.add(bar)
  }
  root.add(moon)
  animated.push((t) => {
    moon.rotation.z = Math.sin(t * 0.12) * 0.03
    halo.material.opacity = 0.18 + Math.sin(t * 0.6) * 0.05
  })

  // 星点
  const starGeo = new THREE.BufferGeometry()
  const arr = []
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 60 + Math.random() * 60
    arr.push(Math.cos(a) * r, 6 + Math.random() * 48, Math.sin(a) * r)
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
  root.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x9fdcff, size: 0.32, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  })))
}

function buildGround(root) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({
      map: circuitTexture(), color: 0x7f97b5,
      metalness: 0.72, roughness: 0.42,
      emissive: 0x041a28, emissiveIntensity: 0.55
    })
  )
  ground.rotation.x = -Math.PI / 2
  root.add(ground)

  // 参道
  const path = box(6.6, 0.08, 34, metal(0x0a1220, 0x002233, 0.35), 0, 0.04, 3, C.cyan)
  root.add(path)
  for (const x of [-3.32, 3.32]) {
    const strip = box(0.055, 0.02, 34, neon(C.cyan, 2.6), x, 0.09, 3)
    root.add(strip)
  }
  for (let z = 18; z > -14; z -= 2.2) {
    const seam = box(6.4, 0.012, 0.035, neon(C.cyan, 0.55), 0, 0.095, z)
    root.add(seam)
  }

  // 地面积水光池
  const pools = [
    [0, 0.03, 5, C.gold, 8, 0.3],
    [0, 0.03, -8.5, C.gold, 9, 0.22],
    [0, 0.03, 16, C.magenta, 10, 0.2],
    [3.4, 0.03, 1.6, C.magenta, 4.5, 0.26],
    [-4.2, 0.03, 1.6, C.cyan, 4.5, 0.24]
  ]
  pools.forEach(([x, y, z, c, s, o]) => {
    const p = lightPool(c, s, o)
    p.position.set(x, y, z)
    root.add(p)
  })
}

function buildSkyline(root) {
  const city = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a1020, metalness: 0.6, roughness: 0.8 })
  const litCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.55 })
  const litPink = new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.5 })
  for (let i = 0; i < 76; i++) {
    const a = (i / 76) * Math.PI * 2 + Math.random() * 0.08
    const r = 48 + Math.random() * 26
    const h = 7 + Math.random() * 26
    const w = 2.4 + Math.random() * 4
    const b = box(w, h, w, dark, Math.cos(a) * r, h / 2, Math.sin(a) * r, Math.random() > 0.72 ? C.violet : null)
    city.add(b)
    if (Math.random() > 0.45) {
      const win = box(w * 0.7, 0.12, 0.05, Math.random() > 0.5 ? litCyan : litPink, b.position.x, h * (0.3 + Math.random() * 0.6), b.position.z + w / 2 + 0.03)
      city.add(win)
    }
  }
  // 远处全息广告
  const ads = [
    { text: '南无数据', x: -26, y: 15, z: -34, c: '#ff2d95' },
    { text: '般若算法', x: 27, y: 18, z: -32, c: '#00f0ff' },
    { text: '功德上链', x: 8, y: 13, z: -46, c: '#ffcc66' }
  ]
  ads.forEach(({ text, x, y, z, c }) => {
    const s = signPlane(text, 3.6, { vertical: true, fontSize: 72, color: '#eafcff', glow: c, padding: 20 })
    s.position.set(x, y, z)
    s.material.opacity = 0.72
    city.add(s)
  })
  root.add(city)
}

function buildGate(root, animated) {
  const gate = new THREE.Group()
  gate.position.z = 16
  for (const x of [-5.2, 5.2]) {
    gate.add(cyl(0.62, 0.75, 0.5, 8, metal(0x101828), x, 0.25, 0, C.cyan))
    gate.add(box(0.9, 7.4, 0.9, metal(), x, 4.1, 0, C.cyan))
    gate.add(box(0.1, 6.9, 0.06, neon(C.cyan, 2.8), x, 4.1, 0.5))
    const verse = signPlane(x < 0 ? '诸行无常' : '数据皆空', 2.9, {
      vertical: true, fontSize: 76, color: '#eafcff', glow: '#ff2d95', padding: 18
    })
    verse.position.set(x, 4.4, 0.54)
    gate.add(verse)
    const gl = glowSprite(C.cyan, 3.4, 0.3)
    gl.position.set(x, 4.2, 0.7)
    gate.add(gl)
  }
  gate.add(box(12.6, 1.25, 1.3, metal(), 0, 7.9, 0, C.magenta))
  gate.add(box(12.2, 0.09, 0.09, neon(C.magenta, 2.6), 0, 7.2, 0.7))
  // 双层飞檐
  const roofA = box(14.4, 0.34, 3.1, metal(0x0d1626), 0, 8.75, 0, C.cyan)
  roofA.rotation.x = 0.06
  gate.add(roofA)
  const roofB = box(12.8, 0.26, 2.3, metal(0x0d1626), 0, 9.35, 0, C.magenta)
  gate.add(roofB)
  for (const x of [-6.9, 6.9]) {
    for (const z of [-1.3, 1.3]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 4), neon(C.gold, 1.8))
      tip.position.set(x, 9.1, z)
      tip.rotation.z = x > 0 ? -0.42 : 0.42
      gate.add(tip)
    }
  }
  // 匾额
  const plate = box(5.1, 1.65, 0.16, metal(0x06101d), 0, 7.9, 0.76, C.gold)
  gate.add(plate)
  const title = signPlane('赛博禅寺', 1.15, {
    fontSize: 120, color: '#fff8e4', glow: '#00f0ff', padding: 18, sub: 'CYBER TEMPLE  /  v1.0'
  })
  title.position.set(0, 7.98, 0.87)
  gate.add(title)
  const halo = glowSprite(C.cyan, 7, 0.16)
  halo.position.set(0, 7.9, -0.3)
  gate.add(halo)
  root.add(gate)
  animated.push((t) => { halo.material.opacity = 0.13 + Math.sin(t * 1.4) * 0.05 })
}

function buildLanterns(root, animated) {
  const zs = [13, 8.5, 4, -0.5, -5]
  zs.forEach((z, i) => {
    for (const side of [-1, 1]) {
      const x = side * 4.7
      const c = (i + (side > 0 ? 1 : 0)) % 2 ? C.magenta : C.cyan
      root.add(cyl(0.34, 0.42, 0.3, 8, metal(), x, 0.15, z))
      root.add(cyl(0.07, 0.09, 2.5, 8, metal(), x, 1.5, z))
      const cage = box(0.62, 0.82, 0.62, metal(0x0a1422), x, 3.05, z, c)
      root.add(cage)
      const core = box(0.42, 0.58, 0.42, neon(c, 2.2), x, 3.05, z)
      root.add(core)
      root.add(box(0.82, 0.1, 0.82, metal(), x, 3.52, z, c))
      const gl = glowSprite(c, 3.2, 0.42)
      gl.position.set(x, 3.05, z)
      root.add(gl)
      const p = lightPool(c, 3.2, 0.2)
      p.position.set(x, 0.03, z)
      root.add(p)
      animated.push((t) => {
        const k = 0.36 + Math.sin(t * 2.1 + i * 1.3 + side) * 0.08
        gl.material.opacity = k
      })
    }
  })
}

function buildSutraBanners(root, animated) {
  const texts = ['南无', '般若', '0x1F4', '空即是色', '色即是空', 'ALL IS DATA']
  texts.forEach((text, i) => {
    const side = i % 2 ? 1 : -1
    const z = 12 - Math.floor(i / 2) * 7
    const c = i % 3 === 0 ? '#ff2d95' : '#00f0ff'
    const s = signPlane(text, 2.2, {
      vertical: true, fontSize: 68, color: '#dffbff', glow: c, padding: 14
    })
    s.position.set(side * 7.4, 3.4 + (i % 3) * 0.5, z)
    s.material.opacity = 0.55
    root.add(s)
    animated.push((t) => {
      s.position.y = 3.4 + (i % 3) * 0.5 + Math.sin(t * 0.9 + i) * 0.22
      s.material.opacity = 0.42 + Math.sin(t * 1.3 + i) * 0.13
    })
  })
}

function buildIncenseBurner(root, refs) {
  const g = new THREE.Group()
  g.position.set(0, 0, 5)
  g.add(cyl(1.3, 1.45, 0.32, 12, metal(0x111a2b), 0, 0.16, 0, C.gold))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    g.add(cyl(0.13, 0.18, 0.62, 8, metal(0x1b2233), Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8))
  }
  const body = cyl(0.98, 0.78, 1.05, 12, metal(0x16202f, 0x3a1c00, 0.2), 0, 1.35, 0, C.gold)
  g.add(body)
  g.add(torus(1.0, 0.035, C.gold, 0, 0.88, 0, Math.PI / 2))
  g.add(torus(0.92, 0.028, C.cyan, 0, 1.84, 0, Math.PI / 2))
  for (const x of [-1.02, 1.02]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 20), metal(0x2a2115, 0x402000, 0.3))
    ear.position.set(x, 1.75, 0)
    ear.rotation.y = Math.PI / 2
    g.add(ear)
  }
  g.add(cyl(0.88, 0.88, 0.06, 24, new THREE.MeshStandardMaterial({ color: 0x25262c, roughness: 1 }), 0, 1.9, 0))
  const plate = signPlane('功德无量', 0.34, { fontSize: 90, color: '#fff1cf', glow: '#ffcc66', padding: 14 })
  plate.position.set(0, 1.4, 1.0)
  g.add(plate)
  const gl = glowSprite(C.gold, 4.4, 0.3)
  gl.position.set(0, 1.9, 0)
  g.add(gl)

  const anchor = new THREE.Group()
  anchor.position.y = 1.92
  g.add(anchor)
  refs.burner = { group: g, anchor, sticks: [], glow: gl }

  // 预置三炷香
  const presets = [[-0.28, -0.1, -0.07], [0.05, 0.2, 0.06], [0.32, -0.14, 0.1]]
  presets.forEach(([x, z, tilt]) => refs.burner.sticks.push(makeIncenseStick(anchor, x, z, tilt)))

  tagHotspot(g, 'incense')
  root.add(g)
}

/** 创建一炷香，返回 { group, tip } */
export function makeIncenseStick(parent, x = 0, z = 0, tilt = 0) {
  const stick = new THREE.Group()
  stick.position.set(x, 0, z)
  stick.rotation.z = tilt
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.022, 1.05, 6),
    new THREE.MeshStandardMaterial({ color: 0x7b2a3a, emissive: 0x2a0a12, emissiveIntensity: 0.5, roughness: 0.9 })
  )
  body.position.y = 0.52
  stick.add(body)
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.042, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb454 })
  )
  tip.position.y = 1.06
  stick.add(tip)
  const ember = glowSprite(0xff8a3c, 0.42, 0.85)
  ember.position.y = 1.06
  stick.add(ember)
  parent.add(stick)
  return { group: stick, tip, ember }
}

function buildHall(root) {
  const h = new THREE.Group()
  h.position.z = -9
  h.add(box(17.4, 0.7, 10.6, metal(0x101828), 0, 0.35, 0, C.gold))
  // 台阶
  for (let i = 0; i < 3; i++) {
    h.add(box(7.6 - i * 0.5, 0.16, 0.65, metal(0x0d1524), 0, 0.12 + i * 0.18, 5.6 + i * 0.6, C.cyan))
  }
  // 立柱
  for (const z of [4.35, -4.35]) {
    for (const x of [-7.3, -3.7, 3.7, 7.3]) {
      h.add(cyl(0.36, 0.42, 6.1, 8, metal(0x141c2e), x, 3.75, z, C.gold))
      h.add(box(0.07, 5.5, 0.06, neon(C.cyan, 1.6), x + 0.36, 3.75, z))
    }
  }
  // 墙
  h.add(box(17, 6.2, 0.36, metal(0x0a1120), 0, 3.8, -4.9))
  for (const x of [-8.4, 8.4]) h.add(box(0.36, 6.2, 10, metal(0x0a1120), x, 3.8, 0))
  // 殿内背光墙
  const backlit = box(11, 5.4, 0.06, neon(C.violet, 0.35, { base: 0x120a24, metalness: 0.2 }), 0, 3.6, -4.68)
  h.add(backlit)
  // 门楣
  h.add(box(17, 0.8, 0.7, metal(0x111a2b), 0, 6.6, 4.5, C.magenta))
  const plaque = box(4.9, 1.35, 0.14, metal(0x06101d), 0, 6.55, 4.92, C.gold)
  h.add(plaque)
  const title = signPlane('大雄宝殿', 0.95, { fontSize: 116, color: '#fff6dd', glow: '#ffcc66', padding: 16 })
  title.position.set(0, 6.6, 5.02)
  h.add(title)
  // 屋顶
  const roof = box(19.6, 0.55, 11.8, metal(0x0b1424), 0, 7.55, 0, C.cyan)
  h.add(roof)
  for (const z of [4.9, -4.9]) {
    const eave = box(19.8, 0.22, 3.4, metal(0x0c1526), 0, 8.2, z * 1.12, C.cyan)
    eave.rotation.x = z > 0 ? -0.34 : 0.34
    h.add(eave)
  }
  h.add(box(20, 0.09, 0.09, neon(C.magenta, 2.4), 0, 7.86, 5.95))
  h.add(box(20, 0.09, 0.09, neon(C.cyan, 2.2), 0, 7.86, -5.95))
  for (const x of [-9.7, 9.7]) {
    for (const z of [5.9, -5.9]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 4), neon(C.gold, 1.6))
      tip.position.set(x, 8.7, z)
      tip.rotation.z = x > 0 ? -0.42 : 0.42
      h.add(tip)
    }
  }
  // 门口两侧竖联
  for (const x of [-6.1, 6.1]) {
    const s = signPlane(x < 0 ? '香火通链上' : '禅心入云端', 2.4, {
      vertical: true, fontSize: 68, color: '#eafcff', glow: '#00f0ff', padding: 16
    })
    s.position.set(x, 3.9, 4.88)
    h.add(s)
  }
  root.add(h)
}

function buildBuddha(root, refs, animated) {
  const b = new THREE.Group()
  b.position.set(0, 0, -11.3)
  const gold = new THREE.MeshStandardMaterial({
    color: 0x7a5c28, emissive: 0xffa63c, emissiveIntensity: 0.13,
    metalness: 0.78, roughness: 0.4
  })
  const brightGold = new THREE.MeshStandardMaterial({
    color: 0xc9a05a, emissive: 0xffb347, emissiveIntensity: 0.3,
    metalness: 0.6, roughness: 0.36
  })

  b.add(box(3.8, 0.55, 2.7, metal(0x111a2b), 0, 0.95, 0, C.gold))
  b.add(cyl(1.42, 1.55, 0.46, 16, gold, 0, 1.45, 0))
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), gold)
    petal.scale.set(0.55, 0.32, 1.05)
    petal.position.set(Math.cos(a) * 1.36, 1.42, Math.sin(a) * 1.36)
    petal.rotation.y = -a
    b.add(petal)
  }
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), gold)
  body.scale.set(1.16, 1.4, 0.86)
  body.position.y = 3.05
  b.add(body)
  // 衣纹电路
  for (let i = 0; i < 3; i++) {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(0.86 - i * 0.13, 0.018, 6, 40, Math.PI * 1.15),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending })
    )
    arc.position.set(0, 3.45 - i * 0.42, 0.8 - i * 0.08)
    arc.rotation.z = -Math.PI * 0.92
    b.add(arc)
  }
  for (const x of [-1.0, 1.0]) {
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), gold)
    arm.scale.set(0.75, 1.2, 0.9)
    arm.position.set(x, 2.85, 0.35)
    b.add(arm)
  }
  b.add(box(1.15, 0.24, 0.65, brightGold, 0, 2.12, 0.95))

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 18), brightGold)
  head.scale.set(1, 1.14, 0.94)
  head.position.y = 4.55
  b.add(head)
  b.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), gold).translateY(5.12))
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const curl = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), gold)
    curl.position.set(Math.cos(a) * 0.48, 4.94, Math.sin(a) * 0.44)
    b.add(curl)
  }
  for (const x of [-0.64, 0.64]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), gold)
    ear.scale.set(0.5, 1.65, 0.7)
    ear.position.set(x, 4.45, 0)
    b.add(ear)
  }
  const urna = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), neon(C.cyan, 3))
  urna.position.set(0, 4.62, 0.58)
  b.add(urna)

  // 背光
  const backGlow = new THREE.Group()
  backGlow.position.set(0, 3.4, -1.1)
  const ringA = torus(2.25, 0.055, C.gold, 0, 0, 0)
  const ringB = torus(2.62, 0.022, C.cyan, 0, 0, -0.08)
  backGlow.add(ringA, ringB)
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    const p = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.065),
      new THREE.MeshBasicMaterial({ color: i % 2 ? C.gold : C.cyan })
    )
    p.position.set(Math.cos(a) * 2.45, Math.sin(a) * 2.45, 0)
    backGlow.add(p)
  }
  const halo = glowSprite(C.gold, 5.2, 0.16)
  halo.position.z = -0.3
  backGlow.add(halo)
  b.add(backGlow)

  // 供桌与电子蜡烛
  const altar = new THREE.Group()
  altar.position.z = 2.35
  altar.add(box(3.6, 0.16, 0.9, metal(0x1a1a22), 0, 1.05, 0, C.gold))
  for (const x of [-1.4, 1.4]) {
    altar.add(cyl(0.08, 0.08, 0.9, 8, metal(), x, 0.55, 0))
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 8), neon(C.gold, 2.6))
    flame.position.set(x, 1.27, 0)
    altar.add(flame)
    const fg = glowSprite(C.gold, 0.9, 0.65)
    fg.position.set(x, 1.3, 0)
    altar.add(fg)
  }
  const incenseLabel = signPlane('香火通证 · ON CHAIN', 0.24, {
    fontSize: 56, color: '#ffe9b8', glow: '#ffcc66', padding: 12
  })
  incenseLabel.position.set(0, 0.8, 0.48)
  altar.add(incenseLabel)
  b.add(altar)

  refs.buddha = { group: b, halo, ringA, ringB, backGlow, urna }
  root.add(b)
  animated.push((t) => {
    ringB.rotation.z = t * 0.16
    ringA.rotation.z = -t * 0.09
    halo.material.opacity = 0.15 + Math.sin(t * 0.8) * 0.035
    urna.scale.setScalar(1 + Math.sin(t * 3.1) * 0.12)
  })
}

function buildCushion(root) {
  const g = new THREE.Group()
  g.position.set(0, 0, -2)
  const p = cyl(1.02, 1.12, 0.3, 28, new THREE.MeshStandardMaterial({
    color: 0x4a1030, emissive: 0x3a0a24, emissiveIntensity: 0.45, roughness: 0.9
  }), 0, 0.17, 0)
  g.add(p)
  g.add(torus(1.0, 0.028, C.gold, 0, 0.3, 0, Math.PI / 2))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const seam = box(0.02, 0.3, 0.05, neon(C.magenta, 0.9), Math.cos(a) * 1.06, 0.17, Math.sin(a) * 1.06)
    seam.rotation.y = -a
    g.add(seam)
  }
  const lp = lightPool(C.gold, 4.2, 0.28)
  g.add(lp)
  tagHotspot(g, 'bow')
  root.add(g)
}

function buildWoodenFish(root, refs, animated) {
  const g = new THREE.Group()
  g.position.set(3.4, 0, 1.6)
  // 供案
  g.add(box(2.1, 0.9, 1.3, metal(0x121a28), 0, 0.45, 0, C.magenta))
  g.add(box(2.2, 0.06, 1.4, metal(0x1b2334), 0, 0.92, 0))
  const fish = new THREE.Group()
  fish.position.y = 1.45
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 28, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a2a18, emissive: 0x3a1304, emissiveIntensity: 0.35, metalness: 0.35, roughness: 0.62 })
  )
  shell.scale.set(1.25, 0.88, 1.0)
  fish.add(shell)
  for (let i = 0; i < 3; i++) {
    const r = torus(0.52 - i * 0.1, 0.014, C.gold, 0, 0, 0, Math.PI / 2 + i * 0.3, i * 0.5)
    fish.add(r)
  }
  const mouth = box(0.52, 0.075, 0.16, new THREE.MeshBasicMaterial({ color: 0x150603 }), 0, -0.06, 0.55)
  fish.add(mouth)
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), neon(C.cyan, 2.6))
  eyeL.position.set(-0.34, 0.22, 0.46)
  const eyeR = eyeL.clone()
  eyeR.position.x = 0.34
  fish.add(eyeL, eyeR)
  g.add(fish)

  // 木槌：握柄末端（右上）是旋转支点，槌头装在伸向左下的那一端。
  // 局部坐标里柄沿 -Y 伸直，整组绕 Z 轴约 -81° 横握；击打时只把角度抬回一点，
  // 槌头就近乎垂直地落到木鱼顶面 —— 绝不会变成「拿柄去敲」。
  const MALLET_REST = -1.42
  const mallet = new THREE.Group()
  mallet.position.set(0.93, 2.42, 0.22)
  const shaft = cyl(0.036, 0.045, 0.86, 10, metal(0x8a6238), 0, -0.43, 0, C.gold)
  mallet.add(shaft)
  const gripRing = cyl(0.052, 0.052, 0.11, 10, metal(0x24160f), 0, -0.07, 0)
  mallet.add(gripRing)
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.165, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffcf78, emissive: 0xff8a1e, emissiveIntensity: 0.9,
      metalness: 0.2, roughness: 0.45
    })
  )
  knob.scale.set(1, 0.84, 1)
  knob.position.set(0, -0.94, 0)
  mallet.add(knob)
  mallet.add(torus(0.155, 0.014, C.gold, 0, -0.94, 0, Math.PI / 2))
  const knobGlow = glowSprite(C.gold, 0.72, 0.4)
  knobGlow.position.set(0, -0.94, 0)
  mallet.add(knobGlow)
  mallet.rotation.z = MALLET_REST
  g.add(mallet)

  const board = signPlane('电子木鱼', 1.2, {
    vertical: true, fontSize: 72, color: '#ffe6f4', glow: '#ff2d95', padding: 16
  })
  board.position.set(0, 2.75, -0.1)
  g.add(board)
  const gl = glowSprite(C.magenta, 3.4, 0.28)
  gl.position.set(0, 1.5, 0)
  g.add(gl)

  refs.fish = { group: g, fish, shell, mallet, malletRest: MALLET_REST, glow: gl }
  animated.push((t) => {
    board.material.opacity = 0.82 + Math.sin(t * 2.4) * 0.16
    gl.material.opacity = 0.22 + Math.sin(t * 2.4) * 0.07
  })
  tagHotspot(g, 'fish')
  root.add(g)
}

function buildBell(root, refs, animated) {
  const g = new THREE.Group()
  g.position.set(-4.2, 0, 1.6)
  const wood = metal(0x3a2418)
  for (const x of [-1.0, 1.0]) g.add(cyl(0.11, 0.14, 3.5, 8, wood, x, 1.75, 0))
  g.add(box(2.6, 0.2, 0.3, wood, 0, 3.45, 0, C.cyan))
  const bell = new THREE.Group()
  bell.position.y = 2.35
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.78, 1.5, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x8a6a2c, emissive: 0x6a3d08, emissiveIntensity: 0.55, metalness: 0.62, roughness: 0.42, side: THREE.DoubleSide })
  )
  bell.add(shell)
  bell.add(torus(0.78, 0.045, C.gold, 0, -0.75, 0, Math.PI / 2))
  for (let i = 0; i < 3; i++) bell.add(torus(0.58 + i * 0.09, 0.012, C.cyan, 0, -0.2 - i * 0.22, 0, Math.PI / 2))
  bell.add(cyl(0.1, 0.1, 0.35, 8, metal(0x9a7830), 0, 0.9, 0))
  g.add(bell)

  const striker = new THREE.Group()
  striker.position.set(0.95, 1.55, 0.85)
  const rod = cyl(0.06, 0.06, 1.5, 8, wood, 0, 0, 0)
  rod.rotation.z = Math.PI / 2
  striker.add(rod)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), metal(0x8a6a38))
  head.position.x = -0.78
  striker.add(head)
  g.add(striker)

  const board = signPlane('赛博晨钟', 1.2, {
    vertical: true, fontSize: 72, color: '#dffbff', glow: '#00f0ff', padding: 16
  })
  board.position.set(0, 4.15, -0.1)
  g.add(board)
  const gl = glowSprite(C.cyan, 3.2, 0.24)
  gl.position.set(0, 2.4, 0)
  g.add(gl)

  refs.bell = { group: g, bell, striker, glow: gl }
  animated.push((t) => { gl.material.opacity = 0.2 + Math.sin(t * 1.6) * 0.06 })
  tagHotspot(g, 'bell')
  root.add(g)
}

function buildLights(scene) {
  scene.add(new THREE.AmbientLight(0x4a5a8c, 0.5))
  scene.add(new THREE.HemisphereLight(0x2a4a88, 0x0a0512, 0.62))
  const key = new THREE.DirectionalLight(0x7f9cff, 0.42)
  key.position.set(12, 22, 14)
  scene.add(key)
  const lights = [
    [C.gold, 24, 18, 0, 4, 5],
    [C.gold, 32, 22, 0, 4, -10],
    [C.magenta, 19, 20, 0, 6, 16],
    [C.cyan, 8, 8, 3.4, 2, 1.6],
    [C.cyan, 8, 8, -4.2, 2.5, 1.6],
    [C.violet, 11, 15, 0, 5, -13]
  ]
  lights.forEach(([c, i, d, x, y, z]) => {
    const p = new THREE.PointLight(c, i, d, 2)
    p.position.set(x, y, z)
    scene.add(p)
  })
}
