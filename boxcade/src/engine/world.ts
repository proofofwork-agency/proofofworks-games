// The Parts world — Blobcade's brick-building model. Every part is a
// rounded box with a material preset; behaviors animate parts kinematically
// (the physics layer reads their per-frame deltas to carry the player along).

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Vec3 } from './math'
import { vclone } from './math'
import type { Box, ColliderSource } from './physics'

/** built-in materials — custom kinds join via registerMaterial() */
export type BuiltinMaterial =
  | 'plastic' | 'grass' | 'wood' | 'stone' | 'ice'
  | 'neon' | 'lava' | 'water' | 'gold' | 'glass' | 'metal' | 'sand'
/** `(string & {})` keeps autocomplete for the built-ins while allowing custom kinds */
export type MaterialKind = BuiltinMaterial | (string & {})

export interface Behavior {
  update(part: RuntimePart, t: number, dt: number): void
}

export interface PartDef {
  at: Vec3
  size: Vec3
  color?: string
  material?: MaterialKind
  rotY?: number
  /** solid for the character controller (default true) */
  collide?: boolean
  /** include in screen-space ray-traced reflections (games opt in via rtReflections) */
  reflect?: boolean
  /** upward velocity applied on landing (bounce pads) */
  bounce?: number
  /** collision box override — collide as this size instead of the visual size */
  hitbox?: Vec3
  /**
   * gravity-multiplier region (0.25 = moon-like, 2 = heavy): the part stops
   * being solid and instead scales gravity for any body inside its box
   */
  gravityZone?: number
  /** non-solid climb volume; runtime lets the player climb while overlapping */
  climbable?: boolean
  tag?: string
  behavior?: Behavior | Behavior[]
}

export class RuntimePart {
  def: PartDef
  base: Vec3
  pos: Vec3
  prev: Vec3
  delta: Vec3 = { x: 0, y: 0, z: 0 }
  mesh: THREE.Mesh
  solid: boolean
  behaviors: Behavior[]
  removed = false
  // trigger wiring (set by the runtime layer)
  touch: ((part: RuntimePart) => void) | null = null
  touchOnce = false
  touching = false

  constructor(def: PartDef, mesh: THREE.Mesh) {
    this.def = def
    this.mesh = mesh
    this.base = vclone(def.at)
    this.pos = vclone(def.at)
    this.prev = vclone(def.at)
    this.solid = def.collide !== false && def.gravityZone === undefined
    this.behaviors = def.behavior ? (Array.isArray(def.behavior) ? def.behavior : [def.behavior]) : []
  }

  box(): Box {
    const s = this.def.hitbox ?? this.def.size
    return {
      minX: this.pos.x - s.x / 2, maxX: this.pos.x + s.x / 2,
      minY: this.pos.y - s.y / 2, maxY: this.pos.y + s.y / 2,
      minZ: this.pos.z - s.z / 2, maxZ: this.pos.z + s.z / 2,
      ref: this,
    }
  }
}

// ---- material + geometry caches ----

const geoCache = new Map<string, RoundedBoxGeometry>()
function roundedBox(sx: number, sy: number, sz: number): RoundedBoxGeometry {
  const key = `${sx.toFixed(2)}|${sy.toFixed(2)}|${sz.toFixed(2)}`
  let g = geoCache.get(key)
  if (!g) {
    const r = Math.min(0.09, Math.min(sx, sy, sz) * 0.16)
    g = new RoundedBoxGeometry(sx, sy, sz, 2, r)
    geoCache.set(key, g)
  }
  return g
}

const matCache = new Map<string, THREE.Material>()

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB_COLOR_RE = /^rgba?\(\s*[-+]?(?:\d+|\d*\.\d+)%?\s*,\s*[-+]?(?:\d+|\d*\.\d+)%?\s*,\s*[-+]?(?:\d+|\d*\.\d+)%?\s*(?:,\s*[-+]?(?:\d+|\d*\.\d+)%?\s*)?\)$/i
const HSL_COLOR_RE = /^hsla?\(\s*[-+]?(?:\d+|\d*\.\d+)(?:deg|rad|turn)?\s*,\s*[-+]?(?:\d+|\d*\.\d+)%\s*,\s*[-+]?(?:\d+|\d*\.\d+)%\s*(?:,\s*[-+]?(?:\d+|\d*\.\d+)%?\s*)?\)$/i
const NAMED_COLORS = new Set(Object.keys(THREE.Color.NAMES))

function isColorString(value: string): boolean {
  return HEX_COLOR_RE.test(value)
    || RGB_COLOR_RE.test(value)
    || HSL_COLOR_RE.test(value)
    || NAMED_COLORS.has(value.toLowerCase())
}

export function safeColor(input: unknown, fallback = '#ffffff'): THREE.Color {
  const value = typeof input === 'string' ? input.trim() : ''
  if (value && isColorString(value)) return new THREE.Color(value)
  const fallbackValue = fallback.trim()
  return new THREE.Color(isColorString(fallbackValue) ? fallbackValue : '#ffffff')
}

/**
 * Registry-pattern extension point: add your own material kind, then use it
 * anywhere a MaterialKind goes (parts, prefabs, text-map handlers).
 *
 *   registerMaterial('hologram', (c) =>
 *     new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.4, emissive: c }),
 *     { reflective: true })
 */
const customMaterials = new Map<string, (color: THREE.Color) => THREE.Material>()
export function registerMaterial(
  kind: string,
  factory: (color: THREE.Color) => THREE.Material,
  opts: { reflective?: boolean } = {},
) {
  if (customMaterials.has(kind)) console.warn(`[blobcade] registerMaterial: overwriting '${kind}'`)
  customMaterials.set(kind, factory)
  if (opts.reflective) AUTO_REFLECT.add(kind)
}

export function partMaterial(color: string, kind: MaterialKind = 'plastic'): THREE.Material {
  const key = `${color}|${kind}`
  let m = matCache.get(key)
  if (m) return m

  const c = safeColor(color, '#b8c4d0')
  const std = (opts: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({ color: c, ...opts })

  const custom = customMaterials.get(kind)
  if (custom) {
    m = custom(c)
    matCache.set(key, m)
    return m
  }

  switch (kind) {
    case 'grass': m = std({ roughness: 0.94, metalness: 0 }); break
    case 'sand': m = std({ roughness: 0.98, metalness: 0 }); break
    case 'wood': m = std({ roughness: 0.78, metalness: 0 }); break
    case 'stone': m = std({ roughness: 0.96, metalness: 0 }); break
    case 'ice': m = std({ roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.92 }); break
    case 'neon':
      m = new THREE.MeshStandardMaterial({
        color: c.clone().multiplyScalar(0.25),
        emissive: c, emissiveIntensity: 2.6, roughness: 0.4,
      })
      break
    case 'lava':
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#1f0a04'),
        emissive: c, emissiveIntensity: 2.1, roughness: 0.85,
      })
      break
    case 'water':
      m = std({ roughness: 0.04, metalness: 0.02, transparent: true, opacity: 0.48 })
      break
    case 'gold': m = std({ roughness: 0.26, metalness: 0.95 }); break
    case 'metal': m = std({ roughness: 0.38, metalness: 0.85 }); break
    case 'glass': m = std({ roughness: 0.08, metalness: 0, transparent: true, opacity: 0.38 }); break
    default: m = std({ roughness: 0.52, metalness: 0 })
  }
  matCache.set(key, m)
  return m
}

// ---- behaviors ----

export const behaviors = {
  /** rotate visually around Y (collision box stays put — use square platforms) */
  spin(speed = 1.4): Behavior {
    return {
      update(part, t) {
        part.mesh.rotation.y = t * speed
      },
    }
  },
  /** glide back & forth between base and base+offset on a smooth sine */
  patrol(offset: Vec3, period = 4, phase = 0): Behavior {
    return {
      update(part, t) {
        const k = (Math.sin(((t / period) * Math.PI * 2) + phase) + 1) / 2
        part.pos.x = part.base.x + offset.x * k
        part.pos.y = part.base.y + offset.y * k
        part.pos.z = part.base.z + offset.z * k
      },
    }
  },
  /** circle around a center point (windmill hazards, orbiting coins) */
  orbit(center: Vec3, radius: number, period = 3, phase = 0): Behavior {
    return {
      update(part, t) {
        const a = (t / period) * Math.PI * 2 + phase
        part.pos.x = center.x + Math.cos(a) * radius
        part.pos.z = center.z + Math.sin(a) * radius
        part.pos.y = center.y
        part.mesh.rotation.y = -a
      },
    }
  },
  /** gentle vertical hover */
  bob(amp = 0.4, period = 2.6, phase = 0): Behavior {
    return {
      update(part, t) {
        part.pos.y = part.base.y + Math.sin((t / period) * Math.PI * 2 + phase) * amp
      },
    }
  },
}

// ---- behaviors as data ----
// A BehaviorDef is the serializable twin of a Behavior closure: GameDocs,
// the editor and share links carry defs; behaviorFromDef() revives them.

export type BehaviorDef =
  | { type: 'spin'; speed?: number }
  | { type: 'patrol'; offset: Vec3; period?: number; phase?: number }
  | { type: 'orbit'; center: Vec3; radius: number; period?: number; phase?: number }
  | { type: 'bob'; amp?: number; period?: number; phase?: number }
  | { type: string; [k: string]: unknown }

const behaviorFactories = new Map<string, (def: BehaviorDef) => Behavior>()

/**
 * Registry-pattern extension point (mirrors registerMaterial): claim a
 * behavior type once and it works in every GameDoc, part def and editor.
 */
export function registerBehavior(type: string, factory: (def: BehaviorDef) => Behavior) {
  if (behaviorFactories.has(type)) console.warn(`[blobcade] registerBehavior: overwriting '${type}'`)
  behaviorFactories.set(type, factory)
}

export function behaviorFromDef(def: BehaviorDef): Behavior | null {
  const factory = behaviorFactories.get(def.type)
  if (!factory) {
    console.warn(`[blobcade] behaviorFromDef: unknown behavior type '${def.type}'`)
    return null
  }
  return factory(def)
}

export function behaviorTypes(): string[] {
  return [...behaviorFactories.keys()]
}

registerBehavior('spin', (d) => behaviors.spin((d as { speed?: number }).speed))
registerBehavior('patrol', (d) => {
  const p = d as { offset: Vec3; period?: number; phase?: number }
  return behaviors.patrol(p.offset, p.period, p.phase)
})
registerBehavior('orbit', (d) => {
  const o = d as { center: Vec3; radius: number; period?: number; phase?: number }
  return behaviors.orbit(o.center, o.radius, o.period, o.phase)
})
registerBehavior('bob', (d) => {
  const b = d as { amp?: number; period?: number; phase?: number }
  return behaviors.bob(b.amp, b.period, b.phase)
})

// ---- the world ----

/** materials that are mirror-shiny by nature — auto-included in SSR when a
 *  game turns on rtReflections (override per part with reflect: false).
 *  registerMaterial({ reflective: true }) adds custom kinds here. */
const AUTO_REFLECT = new Set<string>(['ice', 'metal', 'gold', 'glass', 'water'])

export class PartsWorld implements ColliderSource {
  group = new THREE.Group()
  parts: RuntimePart[] = []
  /** meshes flagged for SSR reflections — pass to Renderer.enableReflections */
  reflective: THREE.Mesh[] = []
  /** non-solid gravity-multiplier regions (PartDef.gravityZone) */
  gravityZones: RuntimePart[] = []
  private labels = new Set<THREE.Sprite>()

  add(def: PartDef): RuntimePart {
    const mesh = new THREE.Mesh(
      roundedBox(def.size.x, def.size.y, def.size.z),
      partMaterial(def.color ?? '#b8c4d0', def.material ?? 'plastic'),
    )
    mesh.position.set(def.at.x, def.at.y, def.at.z)
    if (def.rotY) mesh.rotation.y = def.rotY
    const big = Math.max(def.size.x, def.size.z) > 40
    mesh.castShadow = !big
    mesh.receiveShadow = true
    const part = new RuntimePart(def, mesh)
    this.parts.push(part)
    this.group.add(mesh)
    if (def.reflect ?? AUTO_REFLECT.has(def.material ?? 'plastic')) this.reflective.push(mesh)
    if (def.gravityZone !== undefined) this.gravityZones.push(part)
    return part
  }

  /** combined gravity multiplier at a world point (1 = normal gravity) */
  gravityAt(x: number, y: number, z: number): number {
    let g = 1
    for (const zone of this.gravityZones) {
      const b = zone.box()
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ) {
        g *= zone.def.gravityZone!
      }
    }
    return g
  }

  /** floating billboard text (spawn signs, tips) */
  addLabel(text: string, at: Vec3, scale = 1, color = '#ffffff') {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    const g = canvas.getContext('2d')!
    g.font = '800 56px "Avenir Next", system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = 'rgba(0,0,0,0.55)'
    g.shadowBlur = 14
    g.shadowOffsetY = 5
    g.fillStyle = color
    g.fillText(text, 256, 64)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
    sprite.scale.set(8 * scale, 2 * scale, 1)
    sprite.position.set(at.x, at.y, at.z)
    this.group.add(sprite)
    this.labels.add(sprite)
    return sprite
  }

  remove(part: RuntimePart) {
    part.removed = true
    this.group.remove(part.mesh)
    const i = this.parts.indexOf(part)
    if (i >= 0) this.parts.splice(i, 1)
    const r = this.reflective.indexOf(part.mesh)
    if (r >= 0) this.reflective.splice(r, 1)
    const z = this.gravityZones.indexOf(part)
    if (z >= 0) this.gravityZones.splice(z, 1)
  }

  update(t: number, dt: number) {
    for (const part of this.parts) {
      if (part.behaviors.length > 0) {
        part.prev.x = part.pos.x
        part.prev.y = part.pos.y
        part.prev.z = part.pos.z
        for (const b of part.behaviors) b.update(part, t, dt)
        part.delta.x = part.pos.x - part.prev.x
        part.delta.y = part.pos.y - part.prev.y
        part.delta.z = part.pos.z - part.prev.z
      }
      // always sync — game code may move parts directly (carried flags etc.)
      part.mesh.position.set(part.pos.x, part.pos.y, part.pos.z)
    }
  }

  collect(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Box[]) {
    for (const part of this.parts) {
      if (!part.solid) continue
      const b = part.box()
      if (b.minX < maxX && b.maxX > minX && b.minY < maxY && b.maxY > minY && b.minZ < maxZ && b.maxZ > minZ) {
        out.push(b)
      }
    }
  }

  /** fire touch handlers for trigger parts overlapping the player box (edge-triggered) */
  checkTriggers(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    const fired: RuntimePart[] = []
    for (const part of this.parts) {
      if (!part.touch || part.removed) continue
      const b = part.box()
      const pad = 0.12
      const hit =
        b.minX - pad < maxX && b.maxX + pad > minX &&
        b.minY - pad < maxY && b.maxY + pad > minY &&
        b.minZ - pad < maxZ && b.maxZ + pad > minZ
      if (hit && !part.touching) {
        part.touching = true
        fired.push(part)
      } else if (!hit) {
        part.touching = false
      }
    }
    // fire after the scan: handlers may remove parts
    for (const part of fired) {
      part.touch!(part)
      if (part.touchOnce) part.touch = null
    }
  }

  dispose() {
    for (const label of this.labels) {
      label.removeFromParent()
      const mat = label.material as THREE.SpriteMaterial
      mat.map?.dispose()
      mat.dispose()
    }
    this.labels.clear()
    for (const part of this.parts) part.removed = true
    this.parts.length = 0
    this.reflective.length = 0
    this.gravityZones.length = 0
    this.group.clear()
  }
}
