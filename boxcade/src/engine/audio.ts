// Blobcade audio: every sound is synthesized with WebAudio at runtime.
// Zero asset files — jump chirps, coin dings, fanfares and block crunches
// are all tiny oscillator/noise recipes.

class Synth {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  muted = false

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    } catch {
      return null
    }
    return this.ctx
  }

  /** Must be called from a user gesture once (click/keydown). */
  unlock() {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5
    return this.muted
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol = 0.3,
    delay = 0,
  ) {
    const ctx = this.ensure()
    if (!ctx || !this.master || this.muted) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(20, f0), t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, vol = 0.25, filterFreq = 1200, delay = 0, q = 0.8) {
    const ctx = this.ensure()
    if (!ctx || !this.master || this.muted) return
    const t0 = ctx.currentTime + delay
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFreq
    filter.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(g).connect(this.master)
    src.start(t0)
  }

  // ---- game sounds ----
  jump() { this.tone('sine', 290, 520, 0.16, 0.22) }
  doubleJump() { this.tone('sine', 420, 760, 0.14, 0.2) }
  land() { this.noise(0.09, 0.16, 500) }
  coin() {
    this.tone('square', 990, 990, 0.07, 0.12)
    this.tone('square', 1320, 1320, 0.16, 0.12, 0.07)
  }
  death() {
    this.tone('sawtooth', 320, 60, 0.5, 0.22)
    this.noise(0.3, 0.18, 800, 0.05)
  }
  checkpoint() {
    const seq = [523, 659, 784]
    seq.forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.18, i * 0.09))
  }
  win() {
    const seq = [523, 659, 784, 1047]
    seq.forEach((f, i) => this.tone('square', f, f, i === 3 ? 0.5 : 0.16, 0.14, i * 0.13))
    this.noise(0.7, 0.08, 4000, 0.5)
  }
  place() { this.tone('triangle', 220, 180, 0.07, 0.2); this.noise(0.04, 0.1, 2200) }
  breakBlock() { this.noise(0.12, 0.26, 900, 0, 1.5); this.tone('triangle', 160, 90, 0.1, 0.12) }
  chat() { this.tone('sine', 880, 1100, 0.07, 0.08) }
  bounce() { this.tone('sine', 200, 640, 0.22, 0.24) }
  splash() { this.noise(0.25, 0.2, 700); this.tone('sine', 300, 120, 0.2, 0.08) }

  // ---- combat sounds ----
  switchWeapon() { this.tone('triangle', 520, 300, 0.05, 0.1); this.noise(0.025, 0.05, 3200) }
  scopeIn() { this.tone('sine', 880, 1240, 0.09, 0.08) }
  shoot(kind: string) {
    switch (kind) {
      case 'sidearm': this.tone('square', 760, 240, 0.07, 0.16); this.noise(0.05, 0.12, 2600); break
      case 'shock': this.tone('sawtooth', 1400, 180, 0.16, 0.2); this.tone('sine', 2200, 900, 0.1, 0.08); break
      case 'pulse': this.tone('square', 580, 720, 0.05, 0.13); break
      case 'minigun': this.noise(0.035, 0.14, 3200, 0, 1.2); this.tone('square', 300, 220, 0.03, 0.08); break
      case 'flak': this.noise(0.13, 0.3, 1500, 0, 1.4); this.tone('triangle', 180, 90, 0.1, 0.14); break
      case 'rocket': this.noise(0.28, 0.2, 900); this.tone('sawtooth', 140, 60, 0.3, 0.18); break
      case 'sniper': this.noise(0.16, 0.26, 2400, 0, 1.6); this.tone('sine', 1500, 250, 0.2, 0.12); break
      default: this.tone('square', 600, 300, 0.06, 0.12)
    }
  }
  explosion() {
    this.noise(0.5, 0.34, 420, 0, 1.2)
    this.tone('sine', 90, 36, 0.45, 0.26)
  }
  hitmarker() { this.tone('square', 1700, 1700, 0.035, 0.1) }
  hurt() { this.tone('sawtooth', 240, 130, 0.13, 0.2) }
  dryFire() { this.tone('square', 240, 170, 0.04, 0.09); this.noise(0.02, 0.05, 3600) }
  pickupWeapon() { this.tone('triangle', 330, 660, 0.12, 0.16); this.noise(0.05, 0.07, 1800) }
  pickupAmmo() { this.tone('triangle', 480, 720, 0.07, 0.12) }
  killConfirm() {
    this.tone('triangle', 660, 660, 0.07, 0.14)
    this.tone('triangle', 990, 990, 0.1, 0.14, 0.07)
  }
  flagAlarm() {
    this.tone('square', 520, 520, 0.12, 0.12)
    this.tone('square', 392, 392, 0.14, 0.12, 0.13)
  }
  capture() {
    const seq = [659, 784, 988, 1319]
    seq.forEach((f, i) => this.tone('triangle', f, f, 0.13, 0.16, i * 0.09))
  }

  /** Gentle looping wind bed. */
  startAmbience() {
    const ctx = this.ensure()
    if (!ctx || !this.master || this.windGain) return
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      // pink-ish noise via leaky integrator
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03
      data[i] = last * 6
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0.05
    src.connect(filter).connect(this.windGain).connect(this.master)
    src.start()
  }
}

export const audio = new Synth()
