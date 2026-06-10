// Custom character physics tuned for that friendly blocky-platformer feel:
//   brisk walk, floaty-but-snappy jump, hold-space-to-bunny-hop,
//   coyote time, automatic step-up onto half-height ledges,
//   slippery ice, bounce pads and moving-platform carry.
// Everything collides as axis-aligned boxes — blocky worlds make
// blocky collision exact, which is why it feels glitch-free.
//
// The AABB resolve itself lives in free functions over a KinematicBody so
// other movers (vehicles) share the exact same collision rules as the
// character controller.

import type { Vec3 } from './math'

export interface Box {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  /** opaque reference back to whatever owns this box (a part, a voxel...) */
  ref?: unknown
}

export interface ColliderSource {
  /** push every solid box overlapping the query bounds into `out` */
  collect(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Box[]): void
}

export interface GroundInfo {
  ref: unknown
  material?: string
  bounce?: number
  delta?: Vec3
}

export const EPS = 0.001
export const STEP_HEIGHT = 0.55

// ---------------------------------------------------------------------------
//  Shared AABB resolve — any box-shaped mover (player, vehicle) is a
//  KinematicBody: feet-origin position + velocity + half-width + height.
// ---------------------------------------------------------------------------

export interface KinematicBody {
  /** feet position (bottom-center of the collision box) */
  pos: Vec3
  vel: Vec3
  halfW: number
  height: number
}

/** gather solid boxes around the body into `out` (cleared first) */
export function collectAround(body: KinematicBody, sources: ColliderSource[], pad: number, out: Box[]): Box[] {
  out.length = 0
  const p = body.pos
  for (const s of sources) {
    s.collect(
      p.x - body.halfW - pad, p.y - pad, p.z - body.halfW - pad,
      p.x + body.halfW + pad, p.y + body.height + pad, p.z + body.halfW + pad,
      out,
    )
  }
  return out
}

export function bodyOverlaps(body: KinematicBody, b: Box): boolean {
  const p = body.pos
  return (
    p.x - body.halfW < b.maxX && p.x + body.halfW > b.minX &&
    p.y < b.maxY && p.y + body.height > b.minY &&
    p.z - body.halfW < b.maxZ && p.z + body.halfW > b.minZ
  )
}

export function overlapsAny(body: KinematicBody, sources: ColliderSource[], scratch: Box[]): boolean {
  for (const b of collectAround(body, sources, 0, scratch)) if (bodyOverlaps(body, b)) return true
  return false
}

/**
 * Sweep the body along Y by `amount` and resolve penetration. Falling
 * (amount <= 0) settles on the highest floor and returns that box — the
 * caller decides what landing means (zero velocity, bounce, damage...).
 * Rising clamps under ceilings and zeroes upward velocity.
 */
export function resolveY(body: KinematicBody, amount: number, sources: ColliderSource[], scratch: Box[]): Box | null {
  body.pos.y += amount
  const boxes = collectAround(body, sources, 0, scratch)
  let landed: Box | null = null
  for (const b of boxes) {
    if (!bodyOverlaps(body, b)) continue
    if (amount <= 0) {
      // floor: keep the highest one
      if (!landed || b.maxY > landed.maxY) landed = b
      body.pos.y = Math.max(body.pos.y, b.maxY)
    } else {
      body.pos.y = Math.min(body.pos.y, b.minY - body.height - EPS)
      if (body.vel.y > 0) body.vel.y = 0
    }
  }
  return landed
}

/**
 * Sweep the body along a horizontal axis and resolve penetration. With
 * `stepHeight` > 0, ledges up to that rise are climbed automatically.
 * Blocked moves clamp position and zero the axis velocity.
 */
export function resolveAxis(
  body: KinematicBody,
  axis: 'x' | 'z',
  amount: number,
  sources: ColliderSource[],
  scratch: Box[],
  stepHeight = 0,
): { blocked: boolean; steppedUp: boolean } {
  if (Math.abs(amount) < 1e-9) return { blocked: false, steppedUp: false }
  body.pos[axis] += amount

  const boxes = collectAround(body, sources, 0, scratch).filter((b) => bodyOverlaps(body, b))
  if (boxes.length === 0) return { blocked: false, steppedUp: false }

  if (stepHeight > 0) {
    let top = -Infinity
    for (const b of boxes) top = Math.max(top, b.maxY)
    const rise = top - body.pos.y
    if (rise > 0.01 && rise <= stepHeight) {
      const oldY = body.pos.y
      body.pos.y = top + EPS
      if (!overlapsAny(body, sources, scratch)) {
        return { blocked: false, steppedUp: true } // stepped up cleanly, horizontal move stands
      }
      body.pos.y = oldY
    }
  }

  for (const b of boxes) {
    if (!bodyOverlaps(body, b)) continue
    if (amount > 0) body.pos[axis] = Math.min(body.pos[axis], (axis === 'x' ? b.minX : b.minZ) - body.halfW - EPS)
    else body.pos[axis] = Math.max(body.pos[axis], (axis === 'x' ? b.maxX : b.maxZ) + body.halfW + EPS)
  }
  body.vel[axis] = 0
  return { blocked: true, steppedUp: false }
}

/** probe a short distance below the feet; returns the highest floor box there */
export function probeGroundBox(body: KinematicBody, sources: ColliderSource[], scratch: Box[], dist = 0.06): Box | null {
  const prevY = body.pos.y
  body.pos.y -= dist
  const boxes = collectAround(body, sources, 0, scratch)
  let ground: Box | null = null
  for (const b of boxes) {
    if (!bodyOverlaps(body, b)) continue
    if (!ground || b.maxY > ground.maxY) ground = b
  }
  body.pos.y = prevY
  return ground
}

export interface CharEvents {
  onJump?: () => void
  onLand?: (fallSpeed: number) => void
  onBounce?: () => void
}

export class CharacterController implements KinematicBody {
  /** feet position (bottom-center of the collision box) */
  pos: Vec3 = { x: 0, y: 0, z: 0 }
  vel: Vec3 = { x: 0, y: 0, z: 0 }
  halfW = 0.34
  height = 1.85

  walkSpeed = 8.2
  gravity = -46
  jumpVel = 14.2
  /** multiplies gravity while airborne (gravity zones); reset each frame by the runtime */
  gravityScale = 1

  grounded = false
  groundInfo: GroundInfo | null = null
  inWater = false

  private coyote = 0
  private jumpCooldown = 0
  private wasFalling = 0
  events: CharEvents = {}

  private scratch: Box[] = []

  teleport(p: Vec3) {
    this.pos = { ...p }
    this.vel = { x: 0, y: 0, z: 0 }
    this.grounded = false
    this.groundInfo = null
  }

  /**
   * @param wish desired horizontal direction in world space (unit-ish), camera-relative
   */
  step(dt: number, wish: { x: number; z: number }, jumpHeld: boolean, sources: ColliderSource[]) {
    dt = Math.min(dt, 1 / 30)
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt)

    // ride moving platforms before anything else
    if (this.grounded && this.groundInfo?.delta) {
      const d = this.groundInfo.delta
      this.pos.x += d.x
      this.pos.z += d.z
      if (d.y !== 0) this.pos.y += d.y
      if (overlapsAny(this, sources, this.scratch)) this.pos.y += 0.05 // platform pushed into us: pop up
    }

    const onIce = this.grounded && this.groundInfo?.material === 'ice'

    // horizontal acceleration
    const speed = this.walkSpeed * (this.inWater ? 0.62 : 1)
    const accel = this.inWater ? 26 : this.grounded ? (onIce ? 13 : 70) : 26
    const decel = this.inWater ? 14 : this.grounded ? (onIce ? 2.5 : 56) : 5
    const targetX = wish.x * speed
    const targetZ = wish.z * speed
    const hasInput = Math.abs(wish.x) + Math.abs(wish.z) > 0.01
    const rate = hasInput ? accel : decel
    this.vel.x = approach(this.vel.x, targetX, rate * dt * speed)
    this.vel.z = approach(this.vel.z, targetZ, rate * dt * speed)

    // gravity / buoyancy
    if (this.inWater) {
      this.vel.y += (this.gravity * 0.22 + (jumpHeld ? 38 : 0)) * dt
      this.vel.y = clampN(this.vel.y, -7, 6.5)
    } else {
      this.vel.y += this.gravity * this.gravityScale * dt
      this.vel.y = Math.max(this.vel.y, -55)
    }

    // jumping (hold space = rejump on landing, the classic bunny-hop feel)
    if (jumpHeld && !this.inWater && this.jumpCooldown <= 0 && (this.grounded || this.coyote > 0)) {
      this.vel.y = this.jumpVel
      this.grounded = false
      this.groundInfo = null
      this.coyote = 0
      this.jumpCooldown = 0.22
      this.events.onJump?.()
    }

    this.wasFalling = this.vel.y < -9 ? -this.vel.y : this.wasFalling

    // integrate with substeps so fast falls can't tunnel through thin plates
    const maxDisp = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt
    const sub = Math.min(4, Math.max(1, Math.ceil(maxDisp / 0.4)))
    const sdt = dt / sub
    const canStep = () => (this.grounded || this.coyote > 0 ? STEP_HEIGHT : 0)
    for (let i = 0; i < sub; i++) {
      const landed = resolveY(this, this.vel.y * sdt, sources, this.scratch)
      if (landed) {
        const bounce = (landed.ref as any)?.def?.bounce as number | undefined
        if (bounce && this.vel.y < -1) {
          this.vel.y = bounce
          this.grounded = false
          this.groundInfo = null
          this.events.onBounce?.()
        } else if (this.vel.y < 0) {
          this.vel.y = 0
        }
      }
      resolveAxis(this, 'x', this.vel.x * sdt, sources, this.scratch, canStep())
      resolveAxis(this, 'z', this.vel.z * sdt, sources, this.scratch, canStep())
    }

    // ground probe (walking off edges, standing detection)
    this.probeGround(sources)

    if (this.grounded) {
      this.coyote = 0.13
      if (this.wasFalling > 11) {
        this.events.onLand?.(this.wasFalling)
      }
      this.wasFalling = 0
    } else {
      this.coyote = Math.max(0, this.coyote - dt)
    }
  }

  private probeGround(sources: ColliderSource[]) {
    const ground = probeGroundBox(this, sources, this.scratch)
    if (ground && this.vel.y <= 0.01) {
      this.grounded = true
      const ref = ground.ref as any
      this.groundInfo = {
        ref,
        material: ref?.def?.material,
        bounce: ref?.def?.bounce,
        delta: ref?.delta,
      }
    } else {
      this.grounded = false
      this.groundInfo = null
    }
  }
}

/**
 * Ray vs world AABBs (slab method). Used for hitscan weapons, bot line-of-
 * sight and camera checks. Returns the nearest hit distance or null.
 */
export function raycastWorld(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  sources: ColliderSource[],
): { dist: number; box: Box } | null {
  const ex = ox + dx * maxDist
  const ey = oy + dy * maxDist
  const ez = oz + dz * maxDist
  const boxes: Box[] = []
  for (const s of sources) {
    s.collect(
      Math.min(ox, ex) - 0.5, Math.min(oy, ey) - 0.5, Math.min(oz, ez) - 0.5,
      Math.max(ox, ex) + 0.5, Math.max(oy, ey) + 0.5, Math.max(oz, ez) + 0.5,
      boxes,
    )
  }
  let best: { dist: number; box: Box } | null = null
  for (const b of boxes) {
    const d = rayBox(ox, oy, oz, dx, dy, dz, b)
    if (d !== null && d >= 0 && d <= maxDist && (!best || d < best.dist)) {
      best = { dist: d, box: b }
    }
  }
  return best
}

export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): number | null {
  let tmin = -Infinity
  let tmax = Infinity
  const axes: Array<[number, number, number, number]> = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ]
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null
    } else {
      let t1 = (lo - o) / d
      let t2 = (hi - o) / d
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return null
    }
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target)
  return Math.max(v - maxDelta, target)
}
function clampN(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
