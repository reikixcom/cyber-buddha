import * as THREE from 'three'
import { makeIncenseStick } from './builders.js'
import { PALETTE } from './materials.js'

const C = PALETTE
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const clamp01 = (p) => Math.min(1, Math.max(0, p))

/**
 * 四大修行动作：上香 / 叩拜 / 敲木鱼 / 撞钟
 * 每个动作由若干 tween 组成，update(dt) 统一推进。
 */
export class ActionSystem {
  constructor({ scene, refs, audio, effects, smoke, onMerit, onBow, onLog }) {
    this.scene = scene
    this.refs = refs
    this.audio = audio
    this.effects = effects
    this.smoke = smoke
    this.onMerit = onMerit || (() => {})
    this.onBow = onBow || (() => {})
    this.onLog = onLog || (() => {})
    this.tweens = []
    this.cooldown = {}
    this.busy = false
    this._bowFired = false
    this._bellFired = false
  }

  trigger(id) {
    const now = performance.now()
    const gap = { incense: 420, bow: 1100, fish: 95, bell: 1400 }[id] ?? 300
    if (now - (this.cooldown[id] || 0) < gap) return false
    this.cooldown[id] = now
    const fn = {
      incense: () => this._incense(),
      bow: () => this._bow(),
      fish: () => this._fish(),
      bell: () => this._bell()
    }[id]
    if (fn) fn()
    return true
  }

  _tween(dur, step, done) {
    this.tweens.push({ age: 0, dur, step, done })
  }

  update(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      tw.age += dt
      const p = clamp01(tw.age / tw.dur)
      if (tw.step) tw.step(p)
      if (p >= 1) {
        if (tw.done) tw.done()
        this.tweens.splice(i, 1)
      }
    }
  }

  /* ---------------------------------------------------------- 上香 */
  _incense() {
    const { burner } = this.refs
    const x = (Math.random() - 0.5) * 0.9
    const z = (Math.random() - 0.5) * 0.75
    const tilt = (Math.random() - 0.5) * 0.2
    const stick = makeIncenseStick(burner.anchor, x, z, tilt)
    burner.sticks.push(stick)
    // 新香也参与射线拾取
    stick.group.traverse((o) => { o.userData.hotspot = 'incense' })

    stick.group.position.y = 3.2
    stick.group.visible = true
    this.audio.incense()

    this._tween(0.82, (p) => {
      const e = easeOut(p)
      stick.group.position.y = 3.2 * (1 - e)
      stick.group.rotation.x = (1 - e) * 0.5
      burner.glow.material.opacity = 0.2 + Math.sin(p * Math.PI) * 0.22
    }, () => {
      stick.group.position.y = 0
      stick.group.rotation.x = 0
      this.smoke.boost(1.5)
      this.effects.ripple(new THREE.Vector3(x, 1.98, 5 + z), C.gold, 0.35)
      this.effects.burst(new THREE.Vector3(x, 2.1, 5 + z), C.gold, 12)
      this.effects.floatText(new THREE.Vector3(1.35, 2.6, 5), '+10', '#ffcc66')
      this.onMerit(10, 'incense')
      this.onLog('香火信号已上链 · 区块确认 1/1')
      // 最多保留 14 炷香
      while (burner.sticks.length > 14) {
        const old = burner.sticks.shift()
        burner.anchor.remove(old.group)
        old.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose()
          if (o.material && o.material.dispose) o.material.dispose()
        })
      }
    })
  }

  /* ---------------------------------------------------------- 叩拜 */
  _bow() {
    const { buddha } = this.refs
    this.busy = true
    this.audio.bow()
    const baseScale = buddha.backGlow.scale.x
    this._tween(1.5, (p) => {
      // 低头 → 起身
      const dip = Math.sin(Math.PI * p)
      this.onBow(-0.3 * dip)
      const s = baseScale * (1 + dip * 0.1)
      buddha.backGlow.scale.setScalar(s)
      buddha.halo.material.opacity = 0.17 + dip * 0.28
      buddha.urna.scale.setScalar(1 + dip * 0.8)
      if (p > 0.42 && !this._bowFired) {
        this._bowFired = true
        this.effects.ripple(new THREE.Vector3(0, 0.12, -7.5), C.gold, 1.1)
        this.effects.burst(new THREE.Vector3(0, 2.4, -10), C.gold, 26)
        this.effects.floatText(new THREE.Vector3(1.9, 3.5, -9.4), '+20', '#ffcc66')
        this.onMerit(20, 'bow')
        this.onLog('检测到虔诚信号 · 佛光响应 +20')
      }
    }, () => {
      this._bowFired = false
      this.onBow(0)
      buddha.backGlow.scale.setScalar(baseScale)
      buddha.halo.material.opacity = 0.17
      this.busy = false
    })
  }

  /**
   * 节奏共修的一次敲击：只做 3D 视听反馈，不给单次功德。
   * 功德由一炷香结束后的合拍结算统一发放 —— 乱敲不计，合拍才有权重。
   */
  fishHit(grade = 'perfect', pitch = 1) {
    const { fish } = this.refs
    const wild = grade === 'wild'
    this.audio.gradeTone?.(grade)
    this.audio.woodFish(wild ? 0.8 : pitch)
    if (!wild) {
      const color = grade === 'perfect' ? C.cyan : C.magenta
      this.effects.ripple(new THREE.Vector3(3.4, 0.12, 1.6), color, 0.42)
      this.effects.burst(new THREE.Vector3(3.4, 1.9, 1.6), color, grade === 'perfect' ? 10 : 6)
    }
    this._tween(0.24, (p) => {
      const bounce = Math.sin(Math.PI * p)
      fish.fish.scale.setScalar(1 + bounce * (wild ? 0.06 : 0.15))
      fish.fish.rotation.z = -bounce * 0.07
      fish.mallet.rotation.z = (fish.malletRest ?? 0) + bounce * 0.27
      fish.glow.material.opacity = 0.16 + bounce * (grade === 'perfect' ? 0.38 : 0.22)
    }, () => {
      fish.fish.scale.setScalar(1)
      fish.fish.rotation.z = 0
      fish.mallet.rotation.z = fish.malletRest ?? 0
    })
  }

  /* ---------------------------------------------------------- 敲木鱼 */
  _fish() {
    const { fish } = this.refs
    const pitch = 0.94 + Math.random() * 0.14
    this.audio.woodFish(pitch)
    this.effects.ripple(new THREE.Vector3(3.4, 0.12, 1.6), C.magenta, 0.5)
    this.effects.floatText(new THREE.Vector3(4.25, 2.3, 1.6), '+1', '#ff2d95')
    this.effects.burst(new THREE.Vector3(3.4, 1.9, 1.6), C.magenta, 8)
    this.onMerit(1, 'fish')
    this._tween(0.26, (p) => {
      const bounce = Math.sin(Math.PI * p)
      fish.fish.scale.setScalar(1 + bounce * 0.13)
      fish.fish.rotation.z = -bounce * 0.07
      fish.mallet.rotation.z = (fish.malletRest ?? 0) + bounce * 0.27
      fish.glow.material.opacity = 0.16 + bounce * 0.3
    }, () => {
      fish.fish.scale.setScalar(1)
      fish.fish.rotation.z = 0
      fish.mallet.rotation.z = fish.malletRest ?? 0
    })
  }

  /* ---------------------------------------------------------- 撞钟 */
  _bell() {
    const { bell } = this.refs
    const fired = [false, false, false]
    const marks = [0.08, 0.4, 0.72]
    this._tween(1.7, (p) => {
      const damp = 1 - p * 0.75
      bell.bell.rotation.z = Math.sin(p * Math.PI * 9) * 0.11 * damp
      bell.striker.position.x = 0.95 - Math.sin(p * Math.PI * 3) * 0.3
      bell.glow.material.opacity = 0.14 + Math.sin(p * Math.PI) * 0.24
      marks.forEach((m, i) => {
        if (p >= m && !fired[i]) {
          fired[i] = true
          this.audio.bell(i * 0.02)
          this.effects.ripple(new THREE.Vector3(-4.2, 0.1, 1.6), C.cyan, 0.7 + i * 0.35)
          this.effects.burst(new THREE.Vector3(-4.2, 2.4, 1.6), C.cyan, 10)
        }
      })
      if (p > 0.78 && !this._bellFired) {
        this._bellFired = true
        this.effects.floatText(new THREE.Vector3(-5.1, 3.4, 1.6), '+5', '#00f0ff')
        this.onMerit(5, 'bell')
        this.onLog('晨钟三响 · 数据流已净化')
      }
    }, () => {
      this._bellFired = false
      bell.bell.rotation.z = 0
      bell.striker.position.x = 0.95
    })
  }
}
