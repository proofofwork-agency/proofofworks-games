export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  private ensure(): boolean {
    if (this.ctx) {
      return true;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return false;
    }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise();
    return true;
  }

  resume(): void {
    if (this.ensure() && this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) {
      this.master.gain.value = muted ? 0 : 0.5;
    }
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.ensure() || this.muted) {
      return;
    }
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0): void {
    if (!this.ensure() || this.muted || !this.noiseBuffer) {
      return;
    }
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.25), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  shoot(): void {
    this.tone(680, 0.12, 'square', 0.12, 220);
    this.noise(0.08, 0.06, 2200);
  }

  enemyShoot(): void {
    this.tone(320, 0.1, 'square', 0.05, 160);
  }

  hitBrick(): void {
    this.noise(0.12, 0.12, 1800);
  }

  hitSteel(): void {
    this.tone(240, 0.05, 'square', 0.08, 120);
    this.noise(0.06, 0.05, 3200);
  }

  explosion(): void {
    this.noise(0.5, 0.32, 1200);
    this.tone(120, 0.4, 'sawtooth', 0.12, 40);
  }

  bigExplosion(): void {
    this.noise(0.7, 0.4, 900);
    this.tone(90, 0.6, 'sawtooth', 0.16, 30);
    this.noise(0.5, 0.25, 600, 0.1);
  }

  playerHit(): void {
    this.tone(420, 0.18, 'sawtooth', 0.16, 90);
    this.noise(0.3, 0.2, 1000);
  }

  powerup(): void {
    this.tone(523, 0.09, 'square', 0.12);
    this.tone(659, 0.09, 'square', 0.12, undefined, 0.09);
    this.tone(784, 0.12, 'square', 0.12, undefined, 0.18);
    this.tone(1047, 0.16, 'square', 0.12, undefined, 0.27);
  }

  extraLife(): void {
    this.tone(659, 0.1, 'triangle', 0.14);
    this.tone(880, 0.1, 'triangle', 0.14, undefined, 0.1);
    this.tone(1175, 0.18, 'triangle', 0.14, undefined, 0.2);
  }

  start(): void {
    this.tone(392, 0.12, 'square', 0.14);
    this.tone(523, 0.12, 'square', 0.14, undefined, 0.12);
    this.tone(784, 0.2, 'square', 0.14, undefined, 0.24);
  }

  levelClear(): void {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => this.tone(f, 0.14, 'square', 0.13, undefined, i * 0.12));
  }

  gameOver(): void {
    const seq = [523, 415, 330, 262];
    seq.forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.14, undefined, i * 0.22));
  }

  victory(): void {
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((f, i) => this.tone(f, 0.22, 'square', 0.14, undefined, i * 0.16));
  }
}
