/**
 * 纯 Web Audio 程序化音效，无需任何外部音频资源。
 * 木鱼 / 钟 / 香 / 叩拜 / 环境底噪全部实时合成。
 */
export class TempleAudio {
  constructor() {
    this.ctx = null
    this.master = null
    this.muted = false
    this.noise = null
    this.ambientNodes = []
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.62
      this.master.connect(this.ctx.destination)
      this.noise = this._noiseBuffer(2)
      this._startAmbient()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  setMuted(v) {
    this.muted = !!v
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62, this.ctx.currentTime, 0.05)
    }
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    return s
  }

  _env(node, t, peak, attack, decay) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    node.connect(g)
    g.connect(this.master)
    return g
  }

  _tone(freq, { type = 'sine', peak = 0.2, attack = 0.005, decay = 0.5, slide = null, delay = 0 } = {}) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 20), t + attack + decay)
    this._env(o, t, peak, attack, decay)
    o.start(t)
    o.stop(t + attack + decay + 0.05)
  }

  _noiseBurst({ peak = 0.2, attack = 0.004, decay = 0.12, freq = 1200, q = 1, type = 'bandpass', delay = 0 } = {}) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    src.connect(filter)
    this._env(filter, t, peak, attack, decay)
    src.start(t, Math.random() * 1.2)
    src.stop(t + attack + decay + 0.05)
  }

  /** 电子木鱼：短促木质「咚」+ 数字泛音 */
  woodFish(pitch = 1) {
    if (!this.ctx) return
    this._noiseBurst({ peak: 0.34, decay: 0.075, freq: 1050 * pitch, q: 3.2 })
    this._tone(300 * pitch, { type: 'triangle', peak: 0.28, attack: 0.003, decay: 0.2, slide: 118 * pitch })
    this._tone(88 * pitch, { type: 'sine', peak: 0.2, attack: 0.004, decay: 0.16 })
    this._tone(1420 * pitch, { type: 'sine', peak: 0.045, attack: 0.002, decay: 0.09 })
  }

  /** 晨钟：多分音长衰减 */
  bell(delay = 0) {
    if (!this.ctx) return
    const partials = [1, 2.02, 2.98, 4.12, 5.43, 6.8]
    const gains = [0.2, 0.13, 0.09, 0.055, 0.035, 0.02]
    partials.forEach((p, i) => {
      this._tone(196 * p, {
        type: 'sine', peak: gains[i], attack: 0.008,
        decay: 3.4 - i * 0.35, delay
      })
    })
    this._noiseBurst({ peak: 0.12, decay: 0.18, freq: 2600, q: 0.8, delay })
  }

  /** 上香：柔和气流 */
  incense() {
    if (!this.ctx) return
    this._noiseBurst({ peak: 0.09, attack: 0.06, decay: 0.55, freq: 900, q: 0.6, type: 'lowpass' })
    this._tone(523.25, { type: 'sine', peak: 0.07, attack: 0.12, decay: 0.9 })
    this._tone(783.99, { type: 'sine', peak: 0.04, attack: 0.2, decay: 1.1, delay: 0.08 })
  }

  /** 叩拜：温暖和弦 */
  bow() {
    if (!this.ctx) return
    ;[261.63, 392.0, 523.25, 659.25].forEach((f, i) => {
      this._tone(f, { type: 'sine', peak: 0.085 - i * 0.012, attack: 0.3, decay: 1.9, delay: i * 0.05 })
    })
    this._noiseBurst({ peak: 0.05, attack: 0.2, decay: 1.2, freq: 420, q: 0.5, type: 'lowpass' })
  }

  /** 节奏判定的清脆泛音，PERFECT 比 GOOD 高一个五度 */
  gradeTone(grade) {
    if (!this.ctx || grade === 'wild') return
    const freq = grade === 'perfect' ? 1568 : 1046.5
    this._tone(freq, { type: 'sine', peak: 0.048, attack: 0.002, decay: 0.15 })
    if (grade === 'perfect') this._tone(freq * 2, { type: 'sine', peak: 0.018, attack: 0.002, decay: 0.1 })
  }

  /** UI 提示 */
  tick() {
    if (!this.ctx) return
    this._tone(1180, { type: 'square', peak: 0.025, attack: 0.002, decay: 0.045 })
  }

  /** 环境底噪：低频 drone + 雨夜白噪 */
  _startAmbient() {
    const ctx = this.ctx
    const bus = ctx.createGain()
    bus.gain.value = 0.42
    bus.connect(this.master)

    ;[55, 82.41, 110.3].forEach((f, i) => {
      const o = ctx.createOscillator()
      o.type = i === 2 ? 'triangle' : 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = 0.055 - i * 0.012
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.05 + i * 0.037
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.022
      lfo.connect(lfoGain)
      lfoGain.connect(g.gain)
      o.connect(g)
      g.connect(bus)
      o.start(); lfo.start()
      this.ambientNodes.push(o, lfo)
    })

    const rain = this._noiseSource()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 780
    const rg = ctx.createGain()
    rg.gain.value = 0.035
    rain.connect(lp); lp.connect(rg); rg.connect(bus)
    rain.start()
    this.ambientNodes.push(rain)
  }
}
