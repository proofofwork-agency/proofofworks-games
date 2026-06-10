// Vehicles — kinematic arcade movers on the same AABB resolve as the
// character controller (physics.ts free functions), so they collide with
// parts and voxels by the exact same rules.
//
//   car      ground accel/brake/steer with drift friction; climbs curbs
//   boat     buoyancy band at the waterline; thrust only works in water
//   plane    throttle builds airspeed, lift scales with speed, stall → glide
//   jetpack  worn, not boarded: hover thrust + fuel, refills on the ground
//
// Collision boxes are square in XZ (one halfW) like everything else here —
// blocky worlds, blocky vehicles. Meshes are the runtime's problem.

import type { Vec3 } from './math'
import {
  resolveY, resolveAxis, probeGroundBox, STEP_HEIGHT,
  type Box, type ColliderSource, type KinematicBody,
} from './physics'

export type VehicleType = 'car' | 'jetpack' | 'boat' | 'plane'

export interface VehicleSpec {
  /** top speed, m/s */
  speed: number
  /** accel toward target speed, m/s² */
  accel: number
  /** seconds of thrust (Infinity = no fuel system) */
  fuel: number
  halfW: number
  height: number
  /** ledge rise the vehicle climbs without stopping */
  stepHeight: number
  /** plane only: below this airspeed there is no lift */
  stall?: number
}

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  car: { speed: 26, accel: 16, fuel: Infinity, halfW: 1.05, height: 1.5, stepHeight: STEP_HEIGHT },
  boat: { speed: 14, accel: 10, fuel: Infinity, halfW: 1.1, height: 1.1, stepHeight: 0.2 },
  plane: { speed: 34, accel: 8, fuel: 60, halfW: 1.2, height: 1.4, stepHeight: 0.3, stall: 12 },
  jetpack: { speed: 12, accel: 30, fuel: 10, halfW: 0.34, height: 1.85, stepHeight: STEP_HEIGHT },
}

export interface VehicleInput {
  /** W/S — −1..1 (car/boat/plane throttle; jetpack: camera-relative wish instead) */
  throttle: number
  /** A/D — −1..1, steers the heading */
  steer: number
  /** space — jetpack/plane up */
  ascend: boolean
  /** shift — jetpack/plane down */
  descend: boolean
  /** jetpack only: desired horizontal direction in world space (camera-relative) */
  wish?: { x: number; z: number }
}

export const PARKED_INPUT: VehicleInput = { throttle: 0, steer: 0, ascend: false, descend: false }

export interface VehicleEnv {
  sources: ColliderSource[]
  /** world gravity (negative) */
  gravity: number
  /** is this world point water? (voxel worlds; () => false elsewhere) */
  isWater(x: number, y: number, z: number): boolean
}

export class Vehicle implements KinematicBody {
  readonly type: VehicleType
  readonly spec: VehicleSpec
  /** bottom-center, like the character controller */
  pos: Vec3
  vel: Vec3 = { x: 0, y: 0, z: 0 }
  halfW: number
  height: number
  /** heading, radians — forward is (sin yaw, cos yaw) */
  yaw = 0
  fuel: number
  fuelMax: number
  occupied = false
  grounded = false
  inWater = false
  /** where the vehicle respawns after being abandoned */
  home: Vec3
  homeYaw = 0

  private scratch: Box[] = []

  constructor(type: VehicleType, at: Vec3, opts: { speed?: number; fuel?: number } = {}) {
    this.type = type
    const base = VEHICLE_SPECS[type]
    this.spec = {
      ...base,
      speed: opts.speed ?? base.speed,
      fuel: opts.fuel ?? base.fuel,
    }
    this.pos = { ...at }
    this.home = { ...at }
    this.halfW = base.halfW
    this.height = base.height
    this.fuelMax = this.spec.fuel
    this.fuel = this.spec.fuel
  }

  /** forward unit vector on the ground plane */
  forward(): { x: number; z: number } {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }
  }

  /** velocity component along the heading (signed) */
  forwardSpeed(): number {
    const f = this.forward()
    return this.vel.x * f.x + this.vel.z * f.z
  }

  teleport(at: Vec3, yaw = this.yaw) {
    this.pos = { ...at }
    this.vel = { x: 0, y: 0, z: 0 }
    this.yaw = yaw
  }

  respawnHome() {
    this.teleport(this.home, this.homeYaw)
    this.fuel = this.fuelMax
  }

  step(dt: number, input: VehicleInput, env: VehicleEnv) {
    dt = Math.min(dt, 1 / 30)
    switch (this.type) {
      case 'car': this.stepCar(dt, input, env); break
      case 'boat': this.stepBoat(dt, input, env); break
      case 'plane': this.stepPlane(dt, input, env); break
      case 'jetpack': this.stepJetpack(dt, input, env); break
    }
    this.integrate(dt, env)
  }

  // ---- per-mode forces ----

  private stepCar(dt: number, input: VehicleInput, env: VehicleEnv) {
    this.probe(env)
    const fwd = this.forward()
    const fwdSpeed = this.forwardSpeed()
    const latX = fwd.z, latZ = -fwd.x
    const latSpeed = this.vel.x * latX + this.vel.z * latZ

    if (this.grounded) {
      // throttle: full speed forward, 40% reversing
      const target = input.throttle >= 0 ? input.throttle * this.spec.speed : input.throttle * this.spec.speed * 0.4
      const accel = Math.abs(target) > Math.abs(fwdSpeed) ? this.spec.accel : this.spec.accel * 2.2 // brakes bite harder
      const newFwd = approach(fwdSpeed, target, accel * dt)
      // drift friction: lateral velocity bleeds off fast (less on ice would go here)
      const newLat = approach(latSpeed, 0, 30 * dt)
      this.vel.x = fwd.x * newFwd + latX * newLat
      this.vel.z = fwd.z * newFwd + latZ * newLat
      // steering authority grows with speed, flips when reversing
      const auth = Math.min(1, Math.abs(fwdSpeed) / 7) * Math.sign(fwdSpeed || 1)
      this.yaw -= input.steer * 1.85 * auth * dt
    } else {
      // airborne: no engine authority, slight drag
      this.vel.x *= 1 - 0.2 * dt
      this.vel.z *= 1 - 0.2 * dt
    }
    this.vel.y += env.gravity * dt
    this.vel.y = Math.max(this.vel.y, -55)
  }

  private stepBoat(dt: number, input: VehicleInput, env: VehicleEnv) {
    this.probe(env)
    const hullMid = this.pos.y + this.height * 0.35
    this.inWater = env.isWater(this.pos.x, hullMid, this.pos.z)
    const fwd = this.forward()
    const fwdSpeed = this.forwardSpeed()
    const latX = fwd.z, latZ = -fwd.x
    const latSpeed = this.vel.x * latX + this.vel.z * latZ

    if (this.inWater) {
      // buoyancy band: hull below the line floats up, damped to a bob
      this.vel.y += 34 * dt
      this.vel.y *= 1 - 5.5 * dt
      const target = input.throttle >= 0 ? input.throttle * this.spec.speed : input.throttle * this.spec.speed * 0.35
      const newFwd = approach(fwdSpeed, target, this.spec.accel * dt)
      const newLat = approach(latSpeed, 0, 10 * dt) // boats slide more than cars
      this.vel.x = fwd.x * newFwd + latX * newLat
      this.vel.z = fwd.z * newFwd + latZ * newLat
      const auth = Math.min(1, Math.abs(fwdSpeed) / 4) * Math.sign(fwdSpeed || 1)
      this.yaw -= input.steer * 1.5 * auth * dt
    } else {
      if (this.grounded) {
        // beached on land: heavy scrape, no thrust
        this.vel.x = approach(this.vel.x, 0, 24 * dt)
        this.vel.z = approach(this.vel.z, 0, 24 * dt)
      } else {
        // hopping above the waterline mid-bob: keep momentum, light air drag
        this.vel.x *= 1 - 0.3 * dt
        this.vel.z *= 1 - 0.3 * dt
      }
      this.vel.y += env.gravity * dt
      this.vel.y = Math.max(this.vel.y, -55)
    }
  }

  private stepPlane(dt: number, input: VehicleInput, env: VehicleEnv) {
    this.probe(env)
    const fwd = this.forward()
    const fwdSpeed = this.forwardSpeed()
    const stall = this.spec.stall ?? 12

    // throttle burns fuel; empty tank = glider
    const hasFuel = this.fuel > 0
    const throttle = hasFuel ? Math.max(0, input.throttle) : 0
    if (throttle > 0.05) this.fuel = Math.max(0, this.fuel - dt)
    const brake = input.throttle < 0 && this.grounded ? input.throttle : 0

    const target = (throttle + brake) * this.spec.speed
    const newFwd = approach(fwdSpeed, target, this.spec.accel * dt)
    // lateral bleed keeps flight on rails (arcade, not sim)
    const latX = fwd.z, latZ = -fwd.x
    const latSpeed = this.vel.x * latX + this.vel.z * latZ
    const newLat = approach(latSpeed, 0, 14 * dt)
    this.vel.x = fwd.x * newFwd + latX * newLat
    this.vel.z = fwd.z * newFwd + latZ * newLat

    const auth = Math.min(1, Math.abs(newFwd) / 6) * Math.sign(newFwd || 1)
    this.yaw -= input.steer * (this.grounded ? 1.2 : 1.6) * auth * dt

    // lift cancels gravity above stall speed; climb/dive only with airspeed
    const lift = clamp01(newFwd / stall)
    const vyTarget = lift >= 1 ? (input.ascend ? 0.42 * newFwd : input.descend ? -0.5 * newFwd : 0) : 0
    if (lift >= 1) {
      this.vel.y = approach(this.vel.y, vyTarget, 26 * dt)
    } else {
      this.vel.y += env.gravity * (1 - lift * 0.85) * dt // stall: mush downward, partial lift softens
      this.vel.y = Math.max(this.vel.y, -30)
    }
    // grounded refuel
    if (this.grounded && throttle < 0.05 && this.fuelMax !== Infinity) {
      this.fuel = Math.min(this.fuelMax, this.fuel + dt * 3)
    }
  }

  private stepJetpack(dt: number, input: VehicleInput, env: VehicleEnv) {
    this.probe(env)
    const wish = input.wish ?? { x: 0, z: 0 }
    const speed = this.spec.speed
    this.vel.x = approach(this.vel.x, wish.x * speed, this.spec.accel * dt)
    this.vel.z = approach(this.vel.z, wish.z * speed, this.spec.accel * dt)

    const thrusting = input.ascend && this.fuel > 0
    if (thrusting) {
      this.fuel = Math.max(0, this.fuel - dt)
      this.vel.y += 50 * dt
      this.vel.y = Math.min(this.vel.y, 10)
    } else {
      // gentle fall — a jetpack is its own parachute
      const g = input.descend ? 1 : 0.45
      this.vel.y += env.gravity * g * dt
      this.vel.y = Math.max(this.vel.y, input.descend ? -22 : -9)
    }
    if (this.grounded && !thrusting) {
      this.fuel = Math.min(this.fuelMax, this.fuel + dt * 1.5)
    }
  }

  // ---- shared integration on the engine resolve ----

  private integrate(dt: number, env: VehicleEnv) {
    const maxDisp = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt
    const sub = Math.min(4, Math.max(1, Math.ceil(maxDisp / 0.4)))
    const sdt = dt / sub
    for (let i = 0; i < sub; i++) {
      const landed = resolveY(this, this.vel.y * sdt, env.sources, this.scratch)
      if (landed && this.vel.y < 0) this.vel.y = 0
      const step = this.grounded ? this.spec.stepHeight : 0
      resolveAxis(this, 'x', this.vel.x * sdt, env.sources, this.scratch, step)
      resolveAxis(this, 'z', this.vel.z * sdt, env.sources, this.scratch, step)
    }
    this.probe(env)
  }

  private probe(env: VehicleEnv) {
    this.grounded = probeGroundBox(this, env.sources, this.scratch) !== null && this.vel.y <= 0.01
  }
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target)
  return Math.max(v - maxDelta, target)
}
function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}
