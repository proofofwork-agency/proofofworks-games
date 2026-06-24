// First-person weapon viewmodels — the gun you see in your hands.
// Every weapon is a distinct chunky silhouette built from rounded blocks (no assets),
// with walk bob, mouse sway, recoil kick, a raise animation on switch,
// spinning minigun barrels and an additive muzzle flash. The flash mesh
// doubles as the world-space muzzle anchor that beams/rockets spawn from.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { partMaterial } from './world'
import type { WeaponDef } from './combat'
import type { Vec3 } from './math'

const DARK = '#262c36'
const STEEL = '#3a4654'
const GRIP = '#1d232c'

const geoCache = new Map<string, RoundedBoxGeometry>()

function roundedBlock(w: number, h: number, d: number): RoundedBoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`
  let g = geoCache.get(key)
  if (!g) {
    const r = Math.min(0.018, Math.min(w, h, d) * 0.18)
    g = new RoundedBoxGeometry(w, h, d, 2, r)
    geoCache.set(key, g)
  }
  return g
}

function block(
  parent: THREE.Object3D,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  color: string, kind: 'metal' | 'plastic' | 'neon' = 'metal',
): THREE.Mesh {
  const m = new THREE.Mesh(roundedBlock(w, h, d), partMaterial(color, kind))
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

interface ModelInfo {
  group: THREE.Group
  muzzle: THREE.Vector3
  /** spinning barrel cluster (minigun) */
  spinner: THREE.Group | null
}

function buildModel(id: string): ModelInfo {
  const g = new THREE.Group()
  let muzzle = new THREE.Vector3(0, 0.02, -0.55)
  let spinner: THREE.Group | null = null

  switch (id) {
    case 'sidearm': {
      block(g, 0.07, 0.17, 0.09, 0, -0.1, 0.04, GRIP, 'plastic')
      block(g, 0.085, 0.085, 0.3, 0, 0, -0.08, STEEL)
      block(g, 0.05, 0.05, 0.06, 0, 0.005, -0.25, '#ffe9a8', 'neon')
      muzzle = new THREE.Vector3(0, 0.01, -0.3)
      break
    }
    case 'shock': {
      block(g, 0.09, 0.16, 0.12, 0, -0.1, 0.1, GRIP, 'plastic')
      block(g, 0.12, 0.13, 0.42, 0, 0, -0.12, DARK)
      block(g, 0.035, 0.035, 0.22, -0.05, 0.02, -0.42, STEEL)
      block(g, 0.035, 0.035, 0.22, 0.05, 0.02, -0.42, STEEL)
      block(g, 0.055, 0.055, 0.1, 0, 0.02, -0.44, '#7df9ff', 'neon')
      muzzle = new THREE.Vector3(0, 0.02, -0.54)
      break
    }
    case 'pulse': {
      block(g, 0.08, 0.16, 0.1, 0, -0.11, 0.08, GRIP, 'plastic')
      block(g, 0.11, 0.14, 0.4, 0, 0, -0.1, DARK)
      block(g, 0.06, 0.18, 0.09, 0, -0.14, -0.12, STEEL)
      block(g, 0.07, 0.045, 0.3, 0, 0.085, -0.1, '#5dff5d', 'neon')
      block(g, 0.05, 0.05, 0.08, 0, 0.01, -0.33, '#5dff5d', 'neon')
      muzzle = new THREE.Vector3(0, 0.01, -0.38)
      break
    }
    case 'minigun': {
      block(g, 0.1, 0.18, 0.12, 0, -0.12, 0.14, GRIP, 'plastic')
      block(g, 0.17, 0.19, 0.34, 0, 0, 0, DARK)
      block(g, 0.06, 0.06, 0.07, 0, 0.1, 0.02, '#ffd27d', 'neon')
      spinner = new THREE.Group()
      spinner.position.set(0, 0.01, -0.42)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        block(spinner, 0.038, 0.038, 0.5, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0, STEEL)
      }
      block(spinner, 0.13, 0.13, 0.05, 0, 0, 0.24, DARK)
      g.add(spinner)
      muzzle = new THREE.Vector3(0, 0.01, -0.72)
      break
    }
    case 'flak': {
      block(g, 0.09, 0.17, 0.11, 0, -0.11, 0.12, GRIP, 'plastic')
      block(g, 0.17, 0.17, 0.36, 0, 0, 0.02, '#4a3b30', 'plastic')
      block(g, 0.125, 0.125, 0.3, 0, 0.01, -0.3, STEEL)
      block(g, 0.135, 0.05, 0.05, 0, 0.085, -0.16, '#ffae5e', 'neon')
      muzzle = new THREE.Vector3(0, 0.02, -0.47)
      break
    }
    case 'rockets': {
      block(g, 0.1, 0.17, 0.12, 0, -0.13, 0.1, GRIP, 'plastic')
      block(g, 0.19, 0.19, 0.62, 0, 0.02, -0.12, DARK)
      block(g, 0.145, 0.145, 0.06, 0, 0.02, -0.44, '#0c0e12', 'plastic')
      block(g, 0.2, 0.05, 0.1, 0, 0.02, -0.34, '#ff6b4a', 'neon')
      block(g, 0.05, 0.08, 0.2, 0, 0.15, 0.05, STEEL)
      muzzle = new THREE.Vector3(0, 0.03, -0.48)
      break
    }
    case 'sniper': {
      block(g, 0.08, 0.17, 0.1, 0, -0.11, 0.14, GRIP, 'plastic')
      block(g, 0.1, 0.13, 0.34, 0, 0, 0.04, DARK)
      block(g, 0.055, 0.055, 0.62, 0, 0.015, -0.42, STEEL)
      block(g, 0.04, 0.04, 0.08, 0, 0.015, -0.72, '#10141a', 'plastic')
      // the scope
      block(g, 0.065, 0.065, 0.22, 0, 0.115, -0.02, DARK)
      block(g, 0.05, 0.05, 0.02, 0, 0.115, -0.135, '#9fd8ff', 'neon')
      block(g, 0.03, 0.06, 0.03, 0, 0.07, -0.02, STEEL)
      muzzle = new THREE.Vector3(0, 0.015, -0.76)
      break
    }
    default: {
      block(g, 0.08, 0.16, 0.1, 0, -0.1, 0.06, GRIP, 'plastic')
      block(g, 0.1, 0.1, 0.36, 0, 0, -0.08, STEEL)
      muzzle = new THREE.Vector3(0, 0, -0.3)
    }
  }
  return { group: g, muzzle, spinner }
}

export class ViewModel {
  group = new THREE.Group()

  private models = new Map<string, ModelInfo>()
  private current: ModelInfo | null = null
  private bobT = 0
  private kick = 0
  private raise = 1
  private swayX = 0
  private swayY = 0
  private spinVel = 0
  private flash: THREE.Mesh
  private flashTtl = 0
  private lamp: THREE.PointLight
  private disposed = false

  constructor(camera: THREE.PerspectiveCamera) {
    // bottom-right of the view, like every shooter since 1996
    this.group.position.set(0.32, -0.34, -0.58)
    this.group.rotation.y = -0.05
    camera.add(this.group)

    // tiny personal light so the gun stays readable inside dark towers
    this.lamp = new THREE.PointLight('#cfd8ff', 1.6, 2.2, 2)
    this.lamp.position.set(-0.2, 0.25, 0.1)
    this.group.add(this.lamp)

    const flashMat = new THREE.MeshBasicMaterial({
      color: '#fff3c4', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat)
    this.flash.visible = false
    this.group.add(this.flash)
  }

  equip(weapon: WeaponDef) {
    let info = this.models.get(weapon.id)
    if (!info) {
      info = buildModel(weapon.id)
      this.models.set(weapon.id, info)
      this.group.add(info.group)
    }
    if (this.current === info) return
    for (const m of this.models.values()) m.group.visible = false
    info.group.visible = true
    this.current = info
    this.raise = 0 // play the raise animation
    this.flash.position.copy(info.muzzle)
  }

  /** call when the local player actually fired (CombatSystem.fire returned true) */
  onFire(weapon: WeaponDef) {
    this.kick = weapon.id === 'rockets' || weapon.id === 'sniper' || weapon.id === 'flak' ? 1 : 0.55
    this.flashTtl = 0.05
    if (weapon.id === 'minigun') this.spinVel = Math.min(28, this.spinVel + 9)
  }

  /** world-space muzzle position — beams and projectiles spawn here */
  muzzleWorld(): Vec3 {
    const v = new THREE.Vector3()
    this.flash.getWorldPosition(v)
    return { x: v.x, y: v.y, z: v.z }
  }

  update(dt: number, opts: { speed: number; grounded: boolean; hidden: boolean; lookDX: number; lookDY: number }) {
    this.group.visible = !opts.hidden
    if (opts.hidden) return

    // raise after a switch
    this.raise = Math.min(1, this.raise + dt * 5)
    // recoil decay
    this.kick = Math.max(0, this.kick - dt * 7 * (0.4 + this.kick))

    // walk bob (figure-eight), fades in the air
    const walkK = Math.min(1, opts.speed / 7.5) * (opts.grounded ? 1 : 0.25)
    this.bobT += dt * (3.6 + opts.speed * 1.2)
    const bobX = Math.cos(this.bobT) * 0.013 * walkK
    const bobY = Math.sin(this.bobT * 2) * 0.011 * walkK

    // mouse sway drags the gun slightly behind the camera
    this.swayX += (-opts.lookDX * 0.00045 - this.swayX) * Math.min(1, dt * 10)
    this.swayY += (opts.lookDY * 0.00045 - this.swayY) * Math.min(1, dt * 10)
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX))
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY))

    const lower = (1 - this.raise)
    this.group.position.set(
      0.32 + bobX + this.swayX,
      -0.34 + bobY + this.swayY - lower * 0.34,
      -0.58 + this.kick * 0.085,
    )
    this.group.rotation.x = this.kick * 0.085 - lower * 0.85 + this.swayY * 0.6
    this.group.rotation.y = -0.05 + this.swayX * 0.8
    this.group.rotation.z = bobX * 0.5

    // minigun barrels wind down when not feeding them
    this.spinVel = Math.max(0, this.spinVel - dt * 14)
    if (this.current?.spinner) this.current.spinner.rotation.z += this.spinVel * dt

    // muzzle flash
    this.flashTtl -= dt
    this.flash.visible = this.flashTtl > 0
    if (this.flash.visible) {
      this.flash.rotation.z = Math.random() * Math.PI * 2
      const s = 0.75 + Math.random() * 0.5
      this.flash.scale.set(s, s, s)
    }
    this.lamp.intensity = 1.6 + (this.flash.visible ? 6 : 0) + this.kick * 2
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    this.flash.geometry.dispose()
    for (const m of Array.isArray(this.flash.material) ? this.flash.material : [this.flash.material]) m.dispose()
    this.models.clear()
  }
}
