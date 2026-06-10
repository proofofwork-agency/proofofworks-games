// Original synthesized score + SFX via WebAudio. No samples, no copyrighted audio:
// a Persian double-harmonic (hijaz-flavored) lead over a boom-bap beat, generated live.
// Combat adds a 16th-note hat layer and an octave-up lead double.

const D2 = 73.42;
const ST = (n) => D2 * Math.pow(2, n / 12);

// Melody over 64 sixteenth-steps: [step, semitones above D, length in 16ths]
const MELODY = [
  [0, 12, 2], [3, 13, 1], [4, 12, 2], [7, 11, 1], [8, 7, 3], [12, 4, 3],
  [16, 5, 2], [19, 7, 1], [20, 8, 3], [24, 7, 2], [28, 5, 1], [30, 4, 1],
  [32, 0, 2], [35, 1, 1], [36, 4, 2], [39, 5, 1], [40, 7, 4], [44, 11, 2],
  [48, 12, 4], [54, 13, 1], [56, 11, 2], [60, 8, 1], [62, 7, 1],
];
const BASS_ROOTS = [0, 0, 1, 7]; // per bar: D D Eb A

export class AudioMan {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.combat = false;
    this.playing = false;
    this.step = 0;
    this.nextT = 0;
    this.bpm = 92;
    this.lastKickT = -10;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.55; this.master.connect(c.destination);
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
      this.musBus = c.createGain(); this.musBus.gain.value = 0.85; this.musBus.connect(this.master);
      this.delay = c.createDelay(1); this.delay.delayTime.value = 0.245;
      const fb = c.createGain(); fb.gain.value = 0.32;
      const wet = c.createGain(); wet.gain.value = 0.4;
      this.delay.connect(fb); fb.connect(this.delay);
      this.delay.connect(wet); wet.connect(this.musBus);
      const n = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  resume() { try { this.ctx?.resume(); } catch (e) {} }

  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 30);
  }

  setCombat(on) { this.combat = on; }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  beatPulse() {
    if (!this.ctx) return 0;
    return Math.max(0, 1 - (this.ctx.currentTime - this.lastKickT) * 5);
  }

  tick() {
    if (!this.ctx) return;
    const spd = 60 / this.bpm / 4;
    while (this.nextT < this.ctx.currentTime + 0.12) {
      this.schedule(this.step, this.nextT + (this.step % 2 ? spd * 0.16 : 0), spd);
      this.step = (this.step + 1) % 64;
      this.nextT += spd;
    }
  }

  schedule(step, t, spd) {
    const s = step % 16, bar = Math.floor(step / 16);
    if ([0, 7, 10].includes(s)) { this.kick(t); if (s === 0) this.lastKickT = t; }
    if (s === 4 || s === 12) this.snare(t);
    if (this.combat ? true : s % 2 === 0) this.hat(t, s % 4 === 2);
    if ([0, 7, 10].includes(s)) this.bassNote(t, BASS_ROOTS[bar]);
    for (const [ms, semi, len] of MELODY) {
      if (ms === step) {
        this.leadNote(t, semi + 24, len * spd, 0.05);
        if (this.combat) this.leadNote(t, semi + 36, len * spd, 0.022);
      }
    }
  }

  // ---- voices ----
  noiseSrc(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(t);
    return s;
  }
  envGain(t, peak, dur, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(dest);
    return g;
  }
  kick(t) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    o.connect(this.envGain(t, 0.9, 0.26, this.musBus));
    o.start(t); o.stop(t + 0.3);
  }
  snare(t) {
    const n = this.noiseSrc(t);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
    n.connect(bp); bp.connect(this.envGain(t, 0.4, 0.18, this.musBus));
    n.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    o.connect(this.envGain(t, 0.25, 0.09, this.musBus));
    o.start(t); o.stop(t + 0.1);
  }
  hat(t, open) {
    const n = this.noiseSrc(t);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    n.connect(hp); hp.connect(this.envGain(t, open ? 0.16 : 0.09, open ? 0.1 : 0.04, this.musBus));
    n.stop(t + 0.12);
  }
  bassNote(t, semi) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = ST(semi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    o.connect(lp); lp.connect(this.envGain(t, 0.24, 0.26, this.musBus));
    o.start(t); o.stop(t + 0.3);
  }
  leadNote(t, semi, dur, vol) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    lp.connect(g); g.connect(this.musBus); g.connect(this.delay);
    const vib = this.ctx.createOscillator();
    const vibG = this.ctx.createGain();
    vib.frequency.value = 5.5; vibG.gain.value = ST(semi) * 0.004;
    vib.connect(vibG);
    for (const det of [-5, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = ST(semi);
      o.detune.value = det;
      vibG.connect(o.frequency);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.1);
    }
    vib.start(t); vib.stop(t + dur + 0.1);
  }

  // ---- SFX ----
  sweep(f0, f1, dur, type, vol, t0 = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + t0;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    o.connect(this.envGain(t, vol, dur, this.sfxBus));
    o.start(t); o.stop(t + dur + 0.05);
  }
  noiseHit(filterType, freq, dur, vol, t0 = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + t0;
    const n = this.noiseSrc(t);
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq;
    n.connect(f); f.connect(this.envGain(t, vol, dur, this.sfxBus));
    n.stop(t + dur + 0.05);
  }
  arp(semis, stepDur, type, vol) {
    if (!this.ctx) return;
    semis.forEach((s, i) => this.sweep(ST(s + 24), ST(s + 24), 0.14, type, vol, i * stepDur));
  }

  jump()    { this.sweep(280, 540, 0.13, 'sine', 0.22); }
  land()    { this.noiseHit('lowpass', 400, 0.09, 0.25); this.sweep(110, 60, 0.08, 'sine', 0.3); }
  swing()   { this.noiseHit('bandpass', 1100, 0.1, 0.28); }
  clang()   {
    this.sweep(523, 510, 0.16, 'square', 0.16);
    this.sweep(787, 760, 0.12, 'square', 0.12);
    this.noiseHit('highpass', 4000, 0.08, 0.25);
  }
  hit()     { this.sweep(220, 90, 0.16, 'sawtooth', 0.3); this.noiseHit('bandpass', 700, 0.1, 0.2); }
  hurt()    { this.sweep(330, 110, 0.24, 'sawtooth', 0.32); }
  pickup()  { this.arp([0, 7, 12], 0.05, 'sine', 0.22); }
  tape()    { this.sweep(700, 1500, 0.12, 'sine', 0.16); this.sweep(1500, 500, 0.16, 'sine', 0.16, 0.12); }
  swordGet(){ this.arp([0, 4, 7, 12], 0.07, 'square', 0.16); }
  alert()   {
    // record scratch
    this.noiseHit('bandpass', 500, 0.08, 0.3);
    this.noiseHit('bandpass', 2200, 0.09, 0.3, 0.08);
    this.noiseHit('bandpass', 800, 0.12, 0.25, 0.18);
  }
  gate()    { this.sweep(70, 45, 0.5, 'square', 0.2); this.noiseHit('lowpass', 220, 0.5, 0.2); }
  crackle() { this.noiseHit('bandpass', 2500, 0.06, 0.18); this.noiseHit('bandpass', 1800, 0.08, 0.15, 0.07); }
  slam()    { this.noiseHit('lowpass', 250, 0.14, 0.45); this.sweep(90, 50, 0.12, 'sine', 0.4); }
  bassDrop(){ this.sweep(220, 30, 0.6, 'sine', 0.5); this.noiseHit('lowpass', 150, 0.5, 0.25); }
  death()   { this.arp([12, 8, 5, 1, 0], 0.12, 'sawtooth', 0.2); }
  fanfare() { this.arp([0, 4, 7, 11, 12, 16], 0.08, 'square', 0.18); this.noiseHit('highpass', 6000, 0.4, 0.12, 0.3); }
  click()   { this.sweep(1300, 900, 0.05, 'square', 0.15); }
}
