import * as THREE from 'three'
import { PALETTE, labelTexture, glowTexture } from './materials.js'

const C = PALETTE

/** 霓虹雨丝 */
export function createRain(count = 1000) {
  const positions = new Float32Array(count * 6)
  const speeds = new Float32Array(count)
  const lens = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 76
    const z = (Math.random() - 0.5) * 76 - 4
    const y = Math.random() * 28
    const len = 0.35 + Math.random() * 0.75
    const o = i * 6
    positions[o] = x; positions[o + 1] = y; positions[o + 2] = z
    positions[o + 3] = x + 0.05; positions[o + 4] = y - len; positions[o + 5] = z
    speeds[i] = 13 + Math.random() * 16
    lens[i] = len
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: 0x79cfff, transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false
  })
  const lines = new THREE.LineSegments(geo, mat)
  lines.frustumCulled = false

  return {
    object: lines,
    update(dt) {
      const a = geo.attributes.position.array
      for (let i = 0; i < count; i++) {
        const o = i * 6
        const d = speeds[i] * dt
        a[o + 1] -= d
        a[o + 4] -= d
        if (a[o + 4] < 0) {
          const y = 24 + Math.random() * 8
          a[o + 1] = y
          a[o + 4] = y - lens[i]
        }
      }
      geo.attributes.position.needsUpdate = true
    }
  }
}

/** 香炉青烟（GPU 粒子） */
export function createSmoke(origin, count = 150) {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * 0.62
    positions[i * 3] = Math.cos(a) * r
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = Math.sin(a) * r
    seeds[i] = Math.random()
    speeds[i] = 0.16 + Math.random() * 0.14
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))

  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0.55 },
    uColor: { value: new THREE.Color(0xbfe9ff) }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float aSeed;
      attribute float aSpeed;
      uniform float uTime;
      uniform float uStrength;
      varying float vAlpha;
      void main() {
        float life = fract(uTime * aSpeed + aSeed);
        vec3 p = position;
        p.y += life * 4.6;
        p.x += sin(life * 7.0 + aSeed * 31.0) * 0.42 * life;
        p.z += cos(life * 5.5 + aSeed * 23.0) * 0.42 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 1.0);
        gl_PointSize = clamp((9.0 + life * 30.0) * (14.0 / dist), 2.0, 68.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = (1.0 - life) * 0.3 * uStrength;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float a = smoothstep(0.5, 0.02, d) * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `
  })
  const points = new THREE.Points(geo, mat)
  points.position.copy(origin)
  points.frustumCulled = false

  let boost = 0
  return {
    object: points,
    uniforms,
    boost(amount = 1) { boost = Math.min(boost + amount, 2.2) },
    update(dt, t) {
      uniforms.uTime.value = t
      boost = Math.max(0, boost - dt * 0.35)
      uniforms.uStrength.value = 0.6 + boost + Math.sin(t * 0.7) * 0.06
    }
  }
}

/** 漂浮数据光尘 */
export function createMotes(count = 180) {
  const positions = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 44
    positions[i * 3 + 1] = 0.3 + Math.random() * 11
    positions[i * 3 + 2] = (Math.random() - 0.5) * 52 - 4
    phase[i] = Math.random() * Math.PI * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xff7ac6, size: 0.13, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return {
    object: points,
    update(dt, t) {
      const a = geo.attributes.position.array
      for (let i = 0; i < count; i++) {
        a[i * 3 + 1] += dt * (0.12 + (i % 5) * 0.035)
        if (a[i * 3 + 1] > 12) a[i * 3 + 1] = 0.3
        a[i * 3] += Math.sin(t * 0.5 + phase[i]) * dt * 0.08
      }
      geo.attributes.position.needsUpdate = true
    }
  }
}

/** 涟漪光环 + 上浮功德符文 */
export function createEffects(scene) {
  const ripples = []
  const floaters = []
  const cachedText = new Map()

  function getTextTexture(text, color) {
    const key = text + color
    if (cachedText.has(key)) return cachedText.get(key)
    const { texture } = labelTexture(text, {
      fontSize: 96, color: '#fff6d8', glow: color, padding: 22
    })
    cachedText.set(key, texture)
    return texture
  }

  return {
    ripple(pos, color = C.gold, scale = 1) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.33, 40),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      )
      mesh.position.copy(pos)
      mesh.rotation.x = -Math.PI / 2
      scene.add(mesh)
      ripples.push({ mesh, age: 0, life: 0.85, scale })
    },
    floatText(pos, text, color = '#ffcc66') {
      const mat = new THREE.SpriteMaterial({
        map: getTextTexture(text, color), transparent: true,
        opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending
      })
      const s = new THREE.Sprite(mat)
      s.scale.set(1.1, 0.46, 1)
      s.position.copy(pos)
      scene.add(s)
      floaters.push({ sprite: s, age: 0, life: 1.25 })
    },
    burst(pos, color = C.gold, count = 14) {
      const geo = new THREE.BufferGeometry()
      const arr = new Float32Array(count * 3)
      const vel = []
      for (let i = 0; i < count; i++) {
        arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z
        vel.push(new THREE.Vector3(
          (Math.random() - 0.5) * 2.4,
          0.7 + Math.random() * 2.2,
          (Math.random() - 0.5) * 2.4
        ))
      }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
      const mat = new THREE.PointsMaterial({
        map: glowTexture(), color, size: 0.34, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
      const pts = new THREE.Points(geo, mat)
      scene.add(pts)
      floaters.push({ sprite: pts, age: 0, life: 1.1, vel, burst: true })
    },
    update(dt) {
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        r.age += dt
        const p = r.age / r.life
        const s = (1 + p * 4.5) * r.scale
        r.mesh.scale.set(s, s, s)
        r.mesh.material.opacity = Math.max(0, 0.85 * (1 - p))
        if (p >= 1) {
          scene.remove(r.mesh)
          r.mesh.geometry.dispose()
          r.mesh.material.dispose()
          ripples.splice(i, 1)
        }
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]
        f.age += dt
        const p = f.age / f.life
        if (f.burst) {
          const a = f.sprite.geometry.attributes.position.array
          for (let k = 0; k < f.vel.length; k++) {
            a[k * 3] += f.vel[k].x * dt
            a[k * 3 + 1] += (f.vel[k].y - p * 2.2) * dt
            a[k * 3 + 2] += f.vel[k].z * dt
          }
          f.sprite.geometry.attributes.position.needsUpdate = true
          f.sprite.material.opacity = Math.max(0, 1 - p)
        } else {
          f.sprite.position.y += dt * 0.95
          f.sprite.material.opacity = Math.max(0, 1 - p * p)
        }
        if (p >= 1) {
          scene.remove(f.sprite)
          f.sprite.material.dispose()
          // Sprite 共享 three 内部几何体，只能释放粒子爆发用的独立几何体
          if (f.burst && f.sprite.geometry) f.sprite.geometry.dispose()
          floaters.splice(i, 1)
        }
      }
    }
  }
}
