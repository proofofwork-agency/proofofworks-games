import { describe, it, expect, vi } from 'vitest'
import {
  CharacterController, resolveY, resolveAxis, probeGroundBox, overlapsAny,
  collectAround, bodyOverlaps, STEP_HEIGHT,
  type Box, type ColliderSource, type KinematicBody,
} from '../src/engine/physics'

/** a ColliderSource backed by a static box list (the engine's contract) */
function staticWorld(boxes: Box[]): ColliderSource {
  return {
    collect(minX, minY, minZ, maxX, maxY, maxZ, out) {
      for (const b of boxes) {
        if (b.minX < maxX && b.maxX > minX && b.minY < maxY && b.maxY > minY && b.minZ < maxZ && b.maxZ > minZ) {
          out.push(b)
        }
      }
    },
  }
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, ref?: unknown): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ, ref }
}

function body(x = 0, y = 0, z = 0): KinematicBody {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, halfW: 0.34, height: 1.85 }
}

const floor = () => box(-10, -1, -10, 10, 0, 10)

describe('free AABB resolve', () => {
  it('resolveY falling settles on the highest floor and returns it', () => {
    const ground = floor()
    const plate = box(-1, 0, -1, 1, 0.4, 1)
    const w = [staticWorld([ground, plate])]
    const b = body(0, 0.3, 0)
    const landed = resolveY(b, -0.5, w, [])
    expect(landed).toBe(plate)
    expect(b.pos.y).toBeCloseTo(0.4, 5)
  })

  it('resolveY rising clamps under a ceiling and zeroes upward velocity', () => {
    const ceiling = box(-5, 3, -5, 5, 4, 5)
    const w = [staticWorld([ceiling])]
    const b = body(0, 1.0, 0)
    b.vel.y = 9
    const landed = resolveY(b, 0.5, w, [])
    expect(landed).toBeNull()
    expect(b.pos.y).toBeLessThanOrEqual(3 - b.height)
    expect(b.vel.y).toBe(0)
  })

  it('resolveAxis blocks against a wall and zeroes axis velocity', () => {
    const wall = box(2, 0, -5, 3, 4, 5)
    const w = [staticWorld([floor(), wall])]
    const b = body(0, 0, 0)
    b.vel.x = 10
    const r = resolveAxis(b, 'x', 2.0, w, [])
    expect(r.blocked).toBe(true)
    expect(b.pos.x).toBeLessThanOrEqual(2 - b.halfW)
    expect(b.vel.x).toBe(0)
  })

  it('resolveAxis climbs a half-step when stepHeight allows it', () => {
    const step = box(0.5, 0, -2, 4, 0.5, 2) // 0.5 rise < STEP_HEIGHT
    const w = [staticWorld([floor(), step])]
    const b = body(0, 0, 0)
    b.vel.x = 5
    const r = resolveAxis(b, 'x', 0.4, w, [], STEP_HEIGHT)
    expect(r.steppedUp).toBe(true)
    expect(r.blocked).toBe(false)
    expect(b.pos.y).toBeGreaterThanOrEqual(0.5)
    expect(b.vel.x).toBe(5) // move stood, velocity kept
  })

  it('resolveAxis does NOT step up with stepHeight 0 (airborne rule)', () => {
    const step = box(0.5, 0, -2, 4, 0.5, 2)
    const w = [staticWorld([floor(), step])]
    const b = body(0, 0, 0)
    b.vel.x = 5
    const r = resolveAxis(b, 'x', 0.4, w, [], 0)
    expect(r.blocked).toBe(true)
    expect(b.pos.y).toBe(0)
    expect(b.vel.x).toBe(0)
  })

  it('probeGroundBox finds the floor just below the feet', () => {
    const g = floor()
    const w = [staticWorld([g])]
    const b = body(0, 0.02, 0)
    expect(probeGroundBox(b, w, [])).toBe(g)
    b.pos.y = 1.0
    expect(probeGroundBox(b, w, [])).toBeNull()
  })

  it('overlapsAny + collectAround + bodyOverlaps agree on a penetrating box', () => {
    const slab = box(-1, 0, -1, 1, 1, 1)
    const w = [staticWorld([slab])]
    const b = body(0, 0.5, 0)
    expect(bodyOverlaps(b, slab)).toBe(true)
    expect(collectAround(b, w, 0, [])).toContain(slab)
    expect(overlapsAny(b, w, [])).toBe(true)
    b.pos.x = 5
    expect(overlapsAny(b, w, [])).toBe(false)
  })
})

describe('CharacterController on the shared resolve', () => {
  it('drops onto a floor, lands, and reports grounded', () => {
    const c = new CharacterController()
    c.teleport({ x: 0, y: 3, z: 0 })
    const w = [staticWorld([floor()])]
    for (let i = 0; i < 60; i++) c.step(1 / 60, { x: 0, z: 0 }, false, w)
    expect(c.grounded).toBe(true)
    expect(c.pos.y).toBeCloseTo(0, 2)
    expect(c.vel.y).toBe(0)
  })

  it('walks into a wall and stops at it', () => {
    const c = new CharacterController()
    c.teleport({ x: 0, y: 0.01, z: 0 })
    const w = [staticWorld([floor(), box(3, 0, -5, 4, 4, 5)])]
    for (let i = 0; i < 120; i++) c.step(1 / 60, { x: 1, z: 0 }, false, w)
    expect(c.pos.x).toBeLessThanOrEqual(3 - c.halfW)
    expect(c.pos.x).toBeGreaterThan(2) // actually reached the wall
    expect(c.vel.x).toBe(0)
  })

  it('steps up a half-height ledge while walking', () => {
    const c = new CharacterController()
    c.teleport({ x: 0, y: 0.01, z: 0 })
    const w = [staticWorld([floor(), box(2, 0, -5, 40, 0.5, 5)])]
    for (let i = 0; i < 120; i++) c.step(1 / 60, { x: 1, z: 0 }, false, w)
    expect(c.pos.x).toBeGreaterThan(2.5) // walked onto the ledge
    expect(c.pos.y).toBeCloseTo(0.5, 1)
    expect(c.grounded).toBe(true)
  })

  it('bounce pads launch upward and fire onBounce', () => {
    const c = new CharacterController()
    const pad = box(-2, 0, -2, 2, 0.7, 2, { def: { bounce: 24 } })
    const w = [staticWorld([pad])]
    const onBounce = vi.fn()
    c.events.onBounce = onBounce
    c.teleport({ x: 0, y: 4, z: 0 })
    let maxVy = -Infinity
    for (let i = 0; i < 90; i++) {
      c.step(1 / 60, { x: 0, z: 0 }, false, w)
      maxVy = Math.max(maxVy, c.vel.y)
    }
    expect(onBounce).toHaveBeenCalled()
    expect(maxVy).toBeGreaterThan(20)
  })

  it('jump leaves the ground and lands again (onJump/onLand wiring)', () => {
    const c = new CharacterController()
    const w = [staticWorld([floor()])]
    const onJump = vi.fn()
    c.events.onJump = onJump
    c.teleport({ x: 0, y: 0.01, z: 0 })
    c.step(1 / 60, { x: 0, z: 0 }, false, w) // settle + probe ground
    expect(c.grounded).toBe(true)
    c.step(1 / 60, { x: 0, z: 0 }, true, w) // jump held
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(c.vel.y).toBeGreaterThan(0)
    let landedAgain = false
    for (let i = 0; i < 180; i++) {
      c.step(1 / 60, { x: 0, z: 0 }, false, w)
      if (c.grounded && i > 5) { landedAgain = true; break }
    }
    expect(landedAgain).toBe(true)
  })

  it('gravityScale softens the fall (gravity zone hook)', () => {
    const mk = (scale: number) => {
      const c = new CharacterController()
      c.gravityScale = scale
      c.teleport({ x: 0, y: 8, z: 0 })
      const w = [staticWorld([floor()])]
      let frames = 0
      while (!c.grounded && frames < 600) { c.step(1 / 60, { x: 0, z: 0 }, false, w); frames++ }
      return frames
    }
    expect(mk(0.25)).toBeGreaterThan(mk(1))
  })
})
