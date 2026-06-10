import { describe, it, expect } from 'vitest'
import { Vehicle, VEHICLE_SPECS, PARKED_INPUT, type VehicleEnv, type VehicleInput } from '../src/engine/vehicle'
import type { Box, ColliderSource } from '../src/engine/physics'

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

const floor = (): Box => ({ minX: -200, minY: -1, minZ: -200, maxX: 200, maxY: 0, maxZ: 200 })

function env(boxes: Box[] = [floor()], water?: (x: number, y: number, z: number) => boolean): VehicleEnv {
  return { sources: [staticWorld(boxes)], gravity: -46, isWater: water ?? (() => false) }
}

const drive = (over: Partial<VehicleInput>): VehicleInput => ({ ...PARKED_INPUT, ...over })

function run(v: Vehicle, e: VehicleEnv, input: VehicleInput, seconds: number) {
  const steps = Math.round(seconds * 60)
  for (let i = 0; i < steps; i++) v.step(1 / 60, input, e)
}

describe('car', () => {
  it('parked car settles onto the ground under gravity', () => {
    const v = new Vehicle('car', { x: 0, y: 4, z: 0 })
    run(v, env(), PARKED_INPUT, 2)
    expect(v.pos.y).toBeCloseTo(0, 1)
    expect(v.grounded).toBe(true)
  })

  it('accelerates toward top speed under full throttle', () => {
    const v = new Vehicle('car', { x: 0, y: 0.01, z: 0 })
    run(v, env(), drive({ throttle: 1 }), 4)
    const speed = Math.hypot(v.vel.x, v.vel.z)
    expect(speed).toBeGreaterThan(VEHICLE_SPECS.car.speed * 0.9)
    expect(speed).toBeLessThanOrEqual(VEHICLE_SPECS.car.speed + 0.001)
  })

  it('honors a custom speed cap from doc tuning', () => {
    const v = new Vehicle('car', { x: 0, y: 0.01, z: 0 }, { speed: 10 })
    run(v, env(), drive({ throttle: 1 }), 4)
    expect(Math.hypot(v.vel.x, v.vel.z)).toBeLessThanOrEqual(10.001)
  })

  it('steering at speed turns the heading; grip re-aligns velocity after the turn', () => {
    const v = new Vehicle('car', { x: 0, y: 0.01, z: 0 })
    const e = env()
    run(v, e, drive({ throttle: 1 }), 2)
    const yaw0 = v.yaw
    run(v, e, drive({ throttle: 1, steer: 1 }), 1)
    expect(v.yaw).not.toBeCloseTo(yaw0, 2)
    run(v, e, drive({ throttle: 1 }), 0.8) // wheels straight: drift grips up
    const f = v.forward()
    const speed = Math.hypot(v.vel.x, v.vel.z)
    const along = (v.vel.x * f.x + v.vel.z * f.z) / speed
    expect(along).toBeGreaterThan(0.95)
  })

  it('stops against a wall instead of clipping through', () => {
    const wall: Box = { minX: 30, minY: 0, minZ: -50, maxX: 32, maxY: 6, maxZ: 50 }
    const v = new Vehicle('car', { x: 0, y: 0.01, z: 0 })
    v.yaw = Math.PI / 2 // forward = +x
    run(v, env([floor(), wall]), drive({ throttle: 1 }), 4)
    expect(v.pos.x).toBeLessThanOrEqual(30 - v.halfW)
    expect(v.pos.x).toBeGreaterThan(25)
  })

  it('does not steer while standing still', () => {
    const v = new Vehicle('car', { x: 0, y: 0.01, z: 0 })
    run(v, env(), drive({ steer: 1 }), 1)
    expect(Math.abs(v.yaw)).toBeLessThan(0.05)
  })
})

describe('boat', () => {
  const waterAt = (level: number) => (_x: number, y: number, _z: number) => y < level

  it('floats up to a bobbing equilibrium near the waterline', () => {
    const v = new Vehicle('boat', { x: 0, y: 1, z: 0 })
    const e = env([], waterAt(8)) // deep water, no floor needed
    run(v, e, PARKED_INPUT, 4)
    // hull mid bobs around the waterline: pos.y stays in a band near 8
    // (inWater itself flickers at the line each bob — that's the mechanism)
    expect(v.pos.y).toBeGreaterThan(5.5)
    expect(v.pos.y).toBeLessThan(8.5)
  })

  it('thrusts in water, barely moves beached', () => {
    const inWater = new Vehicle('boat', { x: 0, y: 6, z: 0 })
    const e1 = env([], waterAt(8))
    run(inWater, e1, drive({ throttle: 1 }), 3)
    expect(Math.hypot(inWater.vel.x, inWater.vel.z)).toBeGreaterThan(8)

    const beached = new Vehicle('boat', { x: 0, y: 0.01, z: 0 })
    run(beached, env(), drive({ throttle: 1 }), 3)
    expect(Math.hypot(beached.vel.x, beached.vel.z)).toBeLessThan(0.5)
  })
})

describe('plane', () => {
  it('climbs while Space is held, then stops climbing when released', () => {
    const v = new Vehicle('plane', { x: 0, y: 0.01, z: 0 })
    const e = env()
    run(v, e, drive({ throttle: 1, ascend: true }), 1.5)
    const high = v.pos.y
    expect(high).toBeGreaterThan(8)
    expect(v.vel.y).toBeGreaterThan(0)

    run(v, e, drive({ throttle: 1 }), 1.5)
    expect(v.vel.y).toBeLessThanOrEqual(1)
  })

  it('burns fuel under throttle and sinks when the tank runs dry', () => {
    const v = new Vehicle('plane', { x: 0, y: 0.01, z: 0 }, { fuel: 2 })
    const e = env()
    run(v, e, drive({ throttle: 1 }), 1)
    run(v, e, drive({ throttle: 1, ascend: true }), 1.5)
    expect(v.fuel).toBe(0)
    const apex = v.pos.y
    run(v, e, drive({ throttle: 1, ascend: true }), 3) // no fuel: glide decays
    expect(v.pos.y).toBeLessThan(Math.max(apex, 1) + 0.001)
  })
})

describe('jetpack', () => {
  it('thrust lifts off, fuel drains, and the fall is gentle', () => {
    const v = new Vehicle('jetpack', { x: 0, y: 0.01, z: 0 })
    const e = env()
    run(v, e, drive({ ascend: true }), 2)
    expect(v.pos.y).toBeGreaterThan(4)
    expect(v.fuel).toBeLessThan(VEHICLE_SPECS.jetpack.fuel)
    const high = v.pos.y
    run(v, e, PARKED_INPUT, 1.5) // past the ballistic apex and into the fall
    expect(v.pos.y).toBeLessThan(high)
    expect(v.vel.y).toBeGreaterThanOrEqual(-9.01) // but gently
  })

  it('refuels while resting on the ground', () => {
    const v = new Vehicle('jetpack', { x: 0, y: 0.01, z: 0 }, { fuel: 4 })
    const e = env()
    run(v, e, drive({ ascend: true }), 4.2) // tank empty
    expect(v.fuel).toBe(0)
    run(v, e, PARKED_INPUT, 10) // long gentle fall from ~40m, then sit and sip
    expect(v.grounded).toBe(true)
    expect(v.fuel).toBeGreaterThan(2)
  })

  it('moves horizontally toward the camera-relative wish', () => {
    const v = new Vehicle('jetpack', { x: 0, y: 0.01, z: 0 })
    run(v, env(), drive({ wish: { x: 1, z: 0 } }), 2)
    expect(v.pos.x).toBeGreaterThan(6)
  })
})

describe('abandoned-vehicle respawn contract', () => {
  it('respawnHome restores pose and fuel', () => {
    const v = new Vehicle('plane', { x: 3, y: 0.01, z: 4 }, { fuel: 30 })
    v.homeYaw = 1.2
    const e = env()
    run(v, e, drive({ throttle: 1 }), 2)
    v.respawnHome()
    expect(v.pos).toEqual({ x: 3, y: 0.01, z: 4 })
    expect(v.yaw).toBe(1.2)
    expect(v.fuel).toBe(30)
    expect(v.vel).toEqual({ x: 0, y: 0, z: 0 })
  })
})
