import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildTemple } from './builders.js'
import { createRain, createSmoke, createMotes, createEffects } from './particles.js'
import { TempleAudio } from './audio.js'
import { ActionSystem } from './interactions.js'
import { PALETTE } from './materials.js'

const easeInOut = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
const HOME = { pos: [0, 1.78, 21], yaw: 0, pitch: 0.03 }

export class TempleEngine {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas
    this.cb = callbacks
    this.disposed = false
    this.clock = new THREE.Clock()
    this.keys = new Set()
    this.joy = { x: 0, y: 0 }
    this.ndc = new THREE.Vector2()
    this.raycaster = new THREE.Raycaster()
    this.hoverId = null
    this.bowOffset = 0
    this.focusTween = null
    this.pending = []
    this.drag = null
    this.lastHoverCheck = 0
    this.quality = 'high'

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', alpha: false
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.92

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05030f)
    this.scene.fog = new THREE.FogExp2(0x08061c, 0.012)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260)
    this.camera.rotation.order = 'YXZ'
    this.rig = {
      pos: new THREE.Vector3(...HOME.pos),
      yaw: HOME.yaw,
      pitch: HOME.pitch
    }

    this.world = buildTemple(this.scene)
    this.rain = createRain(900)
    this.smoke = createSmoke(new THREE.Vector3(0, 1.95, 5), 160)
    this.motes = createMotes(170)
    this.effects = createEffects(this.scene)
    ;[this.rain, this.smoke, this.motes].forEach((p) => this.scene.add(p.object))

    this.audio = new TempleAudio()
    this.actions = new ActionSystem({
      scene: this.scene,
      refs: this.world.refs,
      audio: this.audio,
      effects: this.effects,
      smoke: this.smoke,
      onMerit: (n, type) => this.cb.onMerit?.(n, type),
      onBow: (v) => { this.bowOffset = v },
      onLog: (m) => this.cb.onLog?.(m)
    })

    // 收集可拾取对象
    this.pickables = []
    this.scene.traverse((o) => {
      if (o.userData.hotspot && (o.isMesh || o.isSprite || o.isLineSegments)) this.pickables.push(o)
    })

    this._initComposer()
    this._resize()
    this._bind()
    this.cb.onReady?.()
    // 仅开发环境：便于用真事件/截图对 3D 姿态做确定性校验
    if (import.meta.env.DEV) window.__cyberEngine = this
    this._loop()
  }

  _initComposer() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.42, 0.66)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.bloom?.setSize(w, h)
  }

  _bind() {
    this._onResize = () => this._resize()
    this._onKeyDown = (e) => {
      const k = e.key.toLowerCase()
      this.keys.add(k)
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      const map = { '1': 'incense', '2': 'bow', '3': 'fish', '4': 'bell' }
      if (map[k]) this.activate(map[k])
      if (k === 'e') this.activate(this.hoverId || 'fish')
      if (k === 'r') this.resetView()
      if (k === 'm') this.cb.onToggleMute?.()
    }
    this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase())
    this._onBlur = () => this.keys.clear()
    this._onContext = (e) => e.preventDefault()

    this._onDown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }
      this.canvas.setPointerCapture?.(e.pointerId)
      this.canvas.classList.add('is-dragging')
    }
    this._onMove = (e) => {
      this._setNdc(e)
      if (this.drag) {
        const dx = e.clientX - this.drag.x
        const dy = e.clientY - this.drag.y
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true
        if (this.drag.moved) {
          this.focusTween = null
          this.rig.yaw -= dx * 0.0034
          this.rig.pitch = THREE.MathUtils.clamp(this.rig.pitch - dy * 0.0028, -0.62, 0.78)
          this.drag.x = e.clientX
          this.drag.y = e.clientY
        }
        return
      }
      const now = performance.now()
      if (now - this.lastHoverCheck > 70) {
        this.lastHoverCheck = now
        this._checkHover()
      }
    }
    this._onUp = (e) => {
      const wasDrag = this.drag?.moved
      this.drag = null
      this.canvas.classList.remove('is-dragging')
      if (!wasDrag) {
        this._setNdc(e)
        const id = this._pick()
        if (id) this.activate(id)
      }
    }
    this._onLeave = () => {
      this.drag = null
      this.canvas.classList.remove('is-dragging')
      this._setHover(null)
    }
    this._onWheel = (e) => {
      e.preventDefault()
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + e.deltaY * 0.02, 42, 78)
      this.camera.updateProjectionMatrix()
    }

    window.addEventListener('resize', this._onResize)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)
    this.canvas.addEventListener('contextmenu', this._onContext)
    this.canvas.addEventListener('pointerdown', this._onDown)
    this.canvas.addEventListener('pointermove', this._onMove)
    this.canvas.addEventListener('pointerup', this._onUp)
    this.canvas.addEventListener('pointercancel', this._onLeave)
    this.canvas.addEventListener('pointerleave', this._onLeave)
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false })
  }

  _setNdc(e) {
    const r = this.canvas.getBoundingClientRect()
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  _pick() {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.pickables, false)
    for (const hit of hits) {
      const id = hit.object.userData.hotspot
      if (id && this.world.hotspots[id]) return id
    }
    return null
  }

  _checkHover() {
    const id = this._pick()
    this._setHover(id)
  }

  _setHover(id) {
    if (id === this.hoverId) return
    this.hoverId = id
    this.canvas.classList.toggle('is-hovering', !!id)
    this.cb.onHover?.(id, id ? this.world.hotspots[id] : null)
  }

  /** 镜头平滑移动到热点观景位，并在稍后触发对应修行 */
  activate(id) {
    const h = this.world.hotspots[id]
    if (!h) return
    this.focusTo(h.focus)
    this.cb.onHotspot?.(id, h)
    this.pending.push({ at: this.clock.elapsedTime + 0.42, id })
  }

  focusTo(focus) {
    const pos = new THREE.Vector3(...focus.pos)
    const look = new THREE.Vector3(...focus.look)
    const d = look.clone().sub(pos)
    this.focusTween = {
      age: 0,
      dur: 0.85,
      fromPos: this.rig.pos.clone(),
      toPos: pos,
      fromYaw: this.rig.yaw,
      toYaw: Math.atan2(-d.x, -d.z),
      fromPitch: this.rig.pitch,
      toPitch: Math.atan2(d.y, Math.hypot(d.x, d.z))
    }
    // 选择最短旋转路径
    while (this.focusTween.toYaw - this.focusTween.fromYaw > Math.PI) this.focusTween.toYaw -= Math.PI * 2
    while (this.focusTween.toYaw - this.focusTween.fromYaw < -Math.PI) this.focusTween.toYaw += Math.PI * 2
  }

  resetView() {
    this.focusTo({ pos: HOME.pos, look: [0, 2.6, -6] })
    this.cb.onLog?.('视角已复位 · 山门外')
  }

  /** 手机虚拟摇杆：方向与 WASD 叠加，y 向上推为前进 */
  setJoystick(x = 0, y = 0) {
    this.joy.x = THREE.MathUtils.clamp(x, -1, 1)
    this.joy.y = THREE.MathUtils.clamp(y, -1, 1)
  }

  /** 共修节奏敲击：3D 木鱼同步弹跳，功德由一炷香结算统一发放 */
  knock(grade = 'perfect') {
    const pitch = grade === 'perfect' ? 1.12 : grade === 'good' ? 1 : 0.84
    this.actions.fishHit(grade, pitch)
  }

  /** 长明灯开光：佛前金色爆闪 */
  celebrate() {
    this.effects.burst(new THREE.Vector3(0, 3.1, -6.5), PALETTE.gold, 54)
    this.effects.ripple(new THREE.Vector3(0, 0.12, -6.5), PALETTE.gold, 2)
    this.audio.bell()
  }

  unlockAudio() { this.audio.unlock() }
  setMuted(v) { this.audio.setMuted(v) }
  setQuality(q) {
    this.quality = q
    const low = q === 'low'
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.75))
    this.bloom.strength = low ? 0.3 : 0.5
    this.rain.object.visible = !low
    this._resize()
  }

  _updateCamera(dt, t) {
    // 键盘漫游
    let f = 0, s = 0
    if (this.keys.has('w') || this.keys.has('arrowup')) f += 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) s += 1
    if (this.keys.has('a') || this.keys.has('arrowleft')) s -= 1
    f = THREE.MathUtils.clamp(f - this.joy.y, -1, 1)
    s = THREE.MathUtils.clamp(s + this.joy.x, -1, 1)
    let moving = false
    if (f || s) {
      this.focusTween = null
      const speed = this.keys.has('shift') ? 9.5 : 4.8
      const dir = new THREE.Vector3(-Math.sin(this.rig.yaw), 0, -Math.cos(this.rig.yaw)).multiplyScalar(f)
        .add(new THREE.Vector3(Math.cos(this.rig.yaw), 0, -Math.sin(this.rig.yaw)).multiplyScalar(s))
      if (dir.lengthSq() > 0) dir.normalize()
      this.rig.pos.addScaledVector(dir, speed * dt)
      this.rig.pos.x = THREE.MathUtils.clamp(this.rig.pos.x, -10.5, 10.5)
      this.rig.pos.z = THREE.MathUtils.clamp(this.rig.pos.z, -6.2, 25)
      moving = true
    }

    if (this.focusTween) {
      const tw = this.focusTween
      tw.age += dt
      const p = easeInOut(Math.min(1, tw.age / tw.dur))
      this.rig.pos.lerpVectors(tw.fromPos, tw.toPos, p)
      this.rig.yaw = THREE.MathUtils.lerp(tw.fromYaw, tw.toYaw, p)
      this.rig.pitch = THREE.MathUtils.lerp(tw.fromPitch, tw.toPitch, p)
      if (p >= 1) this.focusTween = null
    }

    const bob = moving ? Math.sin(t * 11) * 0.022 : 0
    this.camera.position.set(this.rig.pos.x, this.rig.pos.y + bob, this.rig.pos.z)
    this.camera.rotation.set(this.rig.pitch + this.bowOffset, this.rig.yaw, 0)
  }

  _loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this._loop)
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    this._updateCamera(dt, t)
    this.world.animated.forEach((fn) => fn(t, dt))
    this.rain.update(dt)
    this.smoke.update(dt, t)
    this.motes.update(dt, t)
    this.effects.update(dt)
    this.actions.update(dt)

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (t >= this.pending[i].at) {
        this.actions.trigger(this.pending[i].id)
        this.pending.splice(i, 1)
      }
    }

    this.composer.render()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
    this.canvas.removeEventListener('contextmenu', this._onContext)
    this.canvas.removeEventListener('pointerdown', this._onDown)
    this.canvas.removeEventListener('pointermove', this._onMove)
    this.canvas.removeEventListener('pointerup', this._onUp)
    this.canvas.removeEventListener('pointercancel', this._onLeave)
    this.canvas.removeEventListener('pointerleave', this._onLeave)
    this.canvas.removeEventListener('wheel', this._onWheel)
    this.scene.traverse((o) => {
      if (o.geometry && !o.isSprite) o.geometry.dispose?.()
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
      mats.forEach((m) => m.dispose?.())
    })
    this.composer?.dispose?.()
    this.renderer.dispose()
  }
}
