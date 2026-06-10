// Minimal vector math used across the engine. Kept as plain objects so game
// code (the SDK surface) never needs to import three.js types.

export interface Vec3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vlen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt))

/** Shortest-path angle interpolation (radians). */
export function dampAngle(a: number, b: number, lambda: number, dt: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * (1 - Math.exp(-lambda * dt))
}

/** Deterministic 32-bit string hash (player colors, world seeds). */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Tiny seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2D value noise (terrain heightmaps). Smooth, cheap, deterministic. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512)
  const rng = mulberry32(seed)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]

  const fade = (t: number) => t * t * (3 - 2 * t)
  const grad = (h: number) => (h & 1 ? 1 : -1)

  return (x: number, y: number) => {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const tl = perm[perm[xi] + yi] / 255
    const tr = perm[perm[xi + 1] + yi] / 255
    const bl = perm[perm[xi] + yi + 1] / 255
    const br = perm[perm[xi + 1] + yi + 1] / 255
    const u = fade(xf)
    const v = fade(yf)
    const top = tl + (tr - tl) * u
    const bot = bl + (br - bl) * u
    void grad
    return (top + (bot - top) * v) * 2 - 1 // -1..1
  }
}

/** Fractal brownian motion over a noise function. */
export function fbm2(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq)
    amp *= 0.5
    freq *= 2
  }
  return sum
}
