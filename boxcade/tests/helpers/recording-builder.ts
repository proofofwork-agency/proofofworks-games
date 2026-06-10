// A no-DOM, no-three.js WorldBuilder that records every verb it receives.
// Tests replay a GameDef's build() against this to inspect what got placed —
// the foundation of the textmap tallies tests and the GameDoc parity proof.
//
// Each method pushes an entry onto `log`; entries are plain JSON-friendly
// objects so positions can be sorted/compared directly. `add(def)` returns a
// minimal PartHandle stub ({ pos, remove() }) so interpret.ts's part registry
// wiring works without a real parts world.

import type { Vec3 } from '../../src/engine/math'
import type {
  WorldBuilder, SdkPart, PartHandle, LightingPreset, PhysicsConfig, VehicleType, VehicleOptions,
} from '../../src/sdk'

export interface LogEntry {
  verb: string
  [k: string]: unknown
}

export interface RecordingBuilder {
  builder: WorldBuilder
  log: LogEntry[]
}

const copyVec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z })

export function makeRecordingBuilder(): RecordingBuilder {
  const log: LogEntry[] = []
  const push = (entry: LogEntry) => { log.push(entry) }

  const builder: WorldBuilder = {
    lighting(preset: LightingPreset) {
      push({ verb: 'lighting', preset })
    },
    spawn(at: Vec3) {
      push({ verb: 'spawn', at: copyVec(at) })
    },
    killY(y: number) {
      push({ verb: 'killY', y })
    },
    add(def: SdkPart): PartHandle {
      push({
        verb: 'add',
        at: copyVec(def.at),
        size: copyVec(def.size),
        hitbox: def.hitbox ? copyVec(def.hitbox) : undefined,
        color: def.color,
        material: def.material,
        collide: def.collide,
        gravityZone: def.gravityZone,
        // keep the wiring so tests can fire it (e.g. portal touch → goToGame)
        onTouch: def.onTouch,
      })
      // a live, mutable position object — rules tweening writes through it
      const pos: Vec3 = copyVec(def.at)
      return { pos, remove() {} }
    },
    label(text: string, at: Vec3, scale?: number, color?: string) {
      push({ verb: 'label', text, at: copyVec(at), scale, color })
    },
    checkpoint(at: Vec3, index: number, size?: Vec3) {
      push({ verb: 'checkpoint', at: copyVec(at), index, size: size ? copyVec(size) : undefined })
    },
    lava(at: Vec3, size: Vec3) {
      push({ verb: 'lava', at: copyVec(at), size: copyVec(size) })
    },
    coin(at: Vec3) {
      push({ verb: 'coin', at: copyVec(at) })
    },
    winPad(at: Vec3, size?: Vec3, onWin?: unknown) {
      push({ verb: 'winPad', at: copyVec(at), size: size ? copyVec(size) : undefined, hasOnWin: !!onWin })
    },
    bouncePad(at: Vec3, power?: number, size?: Vec3) {
      push({ verb: 'bouncePad', at: copyVec(at), power, size: size ? copyVec(size) : undefined })
    },
    tree(at: Vec3, scale?: number) {
      push({ verb: 'tree', at: copyVec(at), scale })
    },
    cloud(at: Vec3, scale?: number) {
      push({ verb: 'cloud', at: copyVec(at), scale })
    },
    spinnerHazard(center: Vec3, radius: number, count?: number, period?: number) {
      push({ verb: 'spinnerHazard', center: copyVec(center), radius, count, period })
    },
    healthPack(at: Vec3) {
      push({ verb: 'healthPack', at: copyVec(at) })
    },
    weaponSpawn(at: Vec3, weaponId: string) {
      push({ verb: 'weaponSpawn', at: copyVec(at), weaponId })
    },
    ammoSpawn(at: Vec3) {
      push({ verb: 'ammoSpawn', at: copyVec(at) })
    },
    light(at: Vec3, opts?: { color?: string; intensity?: number; range?: number }) {
      push({ verb: 'light', at: copyVec(at), opts: opts ? { ...opts } : undefined })
    },
    portal(at: Vec3, target: string, label?: string) {
      push({ verb: 'portal', at: copyVec(at), target, label })
    },
    physics(cfg: PhysicsConfig) {
      push({ verb: 'physics', cfg: { ...cfg } })
    },
    vehicle(type: VehicleType, at: Vec3, opts?: VehicleOptions) {
      push({ verb: 'vehicle', type, at: copyVec(at), opts: opts ? { ...opts } : undefined })
    },
    voxelIsland(opts?: { seed?: number; size?: number; palette?: number[]; data?: string }) {
      push({ verb: 'voxelIsland', opts: opts ? { ...opts } : undefined })
    },
  }

  return { builder, log }
}
