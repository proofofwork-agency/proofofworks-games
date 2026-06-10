// Procedural blocky vehicle meshes — the visual bodies for engine/vehicle.ts.
// Same recipe as the avatar: a few rounded boxes + the shared material cache,
// so vehicles read as native Boxcade objects. Group origin is bottom-center
// (Vehicle.pos) facing +Z (Vehicle.yaw = 0); name-tagged child parts let the
// runtime animate them (prop spin, wheel roll).

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { partMaterial } from './world'
import type { VehicleType } from './vehicle'

const geoCache = new Map<string, RoundedBoxGeometry>()
function box(sx: number, sy: number, sz: number): RoundedBoxGeometry {
  const key = `${sx}|${sy}|${sz}`
  let g = geoCache.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(0.07, Math.min(sx, sy, sz) * 0.18))
    geoCache.set(key, g)
  }
  return g
}

function part(group: THREE.Group, sx: number, sy: number, sz: number, x: number, y: number, z: number, color: string, material = 'plastic', name = '') {
  const m = new THREE.Mesh(box(sx, sy, sz), partMaterial(color, material))
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  if (name) m.name = name
  group.add(m)
  return m
}

export const VEHICLE_COLORS: Record<VehicleType, string> = {
  car: '#e74c3c',
  boat: '#3b82f6',
  plane: '#e8edf2',
  jetpack: '#caa64b',
}

export function buildVehicleMesh(type: VehicleType, color?: string): THREE.Group {
  const g = new THREE.Group()
  const c = color ?? VEHICLE_COLORS[type]
  switch (type) {
    case 'car': {
      part(g, 2.0, 0.55, 3.2, 0, 0.58, 0, c, 'plastic')
      part(g, 1.7, 0.52, 1.5, 0, 1.1, -0.25, '#bfe3ff', 'glass')
      part(g, 1.72, 0.1, 1.55, 0, 1.38, -0.25, c, 'plastic')
      for (const [wx, wz] of [[-0.95, 1.05], [0.95, 1.05], [-0.95, -1.05], [0.95, -1.05]] as const) {
        part(g, 0.3, 0.6, 0.6, wx, 0.32, wz, '#23262b', 'plastic', 'wheel')
      }
      part(g, 0.26, 0.14, 0.06, -0.6, 0.62, 1.62, '#fff7c4', 'neon')
      part(g, 0.26, 0.14, 0.06, 0.6, 0.62, 1.62, '#fff7c4', 'neon')
      break
    }
    case 'boat': {
      part(g, 2.2, 0.55, 4.0, 0, 0.34, -0.2, c, 'plastic')
      part(g, 1.4, 0.5, 1.1, 0, 0.34, 2.0, c, 'plastic') // bow
      part(g, 1.9, 0.35, 3.4, 0, 0.66, -0.3, '#f4f6f8', 'plastic') // deck rim
      part(g, 1.5, 0.5, 0.14, 0, 1.05, 0.75, '#bfe3ff', 'glass') // windshield
      part(g, 0.6, 0.4, 0.7, 0, 0.95, -1.4, '#23262b', 'plastic') // outboard
      break
    }
    case 'plane': {
      part(g, 1.1, 0.9, 3.6, 0, 0.95, 0, c, 'plastic') // fuselage
      part(g, 4.6, 0.14, 1.1, 0, 1.05, 0.25, c, 'plastic') // wings
      part(g, 1.8, 0.1, 0.55, 0, 1.5, -1.55, c, 'plastic') // tail wing
      part(g, 0.12, 0.8, 0.62, 0, 1.7, -1.6, c, 'plastic') // fin
      part(g, 0.8, 0.55, 0.9, 0, 1.05, 0.95, '#bfe3ff', 'glass') // canopy
      part(g, 0.18, 1.5, 0.1, 0, 0.95, 1.88, '#3a3f47', 'metal', 'prop')
      part(g, 0.26, 0.5, 0.26, -0.7, 0.25, 0.5, '#23262b', 'plastic')
      part(g, 0.26, 0.5, 0.26, 0.7, 0.25, 0.5, '#23262b', 'plastic')
      part(g, 0.22, 0.45, 0.22, 0, 0.22, -1.4, '#23262b', 'plastic')
      break
    }
    case 'jetpack': {
      part(g, 0.3, 0.9, 0.3, -0.2, 0.62, 0, c, 'metal')
      part(g, 0.3, 0.9, 0.3, 0.2, 0.62, 0, c, 'metal')
      part(g, 0.52, 0.16, 0.3, 0, 1.12, 0, '#3a3f47', 'metal')
      part(g, 0.16, 0.18, 0.16, -0.2, 0.1, 0, '#23262b', 'metal', 'nozzle')
      part(g, 0.16, 0.18, 0.16, 0.2, 0.1, 0, '#23262b', 'metal', 'nozzle')
      break
    }
  }
  return g
}
