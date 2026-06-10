// Camera rigs.
//   'orbit' — classic third person: right-mouse-drag to orbit, scroll to
//             zoom, Shift toggles shift-lock (mouselook over the shoulder).
//   'fp'    — pointer-lock first person for build mode and shooters.
// Both rigs pull the camera in when world geometry blocks the view.

import * as THREE from 'three'
import type { Input } from './input'
import type { Box, ColliderSource } from './physics'
import { clamp, damp } from './math'

export type CameraMode = 'orbit' | 'fp'

export class CameraRig {
  mode: CameraMode
  yaw = Math.PI // start behind the character looking forward (-Z)
  pitch = 0.32
  dist = 8
  shiftLock = false
  /** mouse sensitivity multiplier (sniper scopes set this below 1) */
  sensScale = 1
  private smoothedDist = 8
  private dragAccum = 0
  private scratch: Box[] = []

  constructor(mode: CameraMode) {
    this.mode = mode
    if (mode === 'fp') this.pitch = 0
  }

  /** planar forward (the direction W walks) */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }
  }
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }
  }
  /** full 3D look direction (for build-mode raycasts) */
  lookDir(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize()
  }

  update(
    dt: number,
    input: Input,
    camera: THREE.PerspectiveCamera,
    feet: { x: number; y: number; z: number },
    sources: ColliderSource[],
  ) {
    const sens = 0.0042 * this.sensScale

    if (this.mode === 'fp') {
      if (input.pointerLocked) {
        this.yaw -= input.mouseDX * sens
        this.pitch = clamp(this.pitch + input.mouseDY * sens, -1.54, 1.54)
      }
      const eye = new THREE.Vector3(feet.x, feet.y + 1.62, feet.z)
      camera.position.copy(eye)
      camera.rotation.set(0, 0, 0)
      camera.rotation.order = 'YXZ'
      camera.rotation.y = this.yaw
      camera.rotation.x = -this.pitch
      return
    }

    // ---- orbit mode ----
    if (input.wasPressed('shift')) {
      this.shiftLock = !this.shiftLock
      if (this.shiftLock) input.requestPointerLock()
      else input.exitPointerLock()
    }
    const dragging = !input.captured && (input.rmbDown || input.lmbDown)
    if (this.shiftLock && !input.pointerLocked && !dragging) {
      // user pressed Esc — drop shift lock
      this.shiftLock = false
    }

    if (dragging || (this.shiftLock && input.pointerLocked)) {
      this.yaw -= input.mouseDX * sens
      this.pitch = clamp(this.pitch + input.mouseDY * sens, -1.15, 1.42)
    }

    // capture the pointer during a real drag so rotation never stops at the
    // screen edge — this is what makes full 360° spins possible
    if (!this.shiftLock) {
      if (dragging) {
        this.dragAccum += Math.abs(input.mouseDX) + Math.abs(input.mouseDY)
        if (this.dragAccum > 6 && !input.pointerLocked) input.requestPointerLock()
      } else {
        if (input.pointerLocked && this.dragAccum > 0) input.exitPointerLock()
        this.dragAccum = 0
      }
    }
    if (input.wheelDelta !== 0) {
      this.dist = clamp(this.dist * (1 + input.wheelDelta * 0.0011), 2.4, 16)
    }

    const target = new THREE.Vector3(feet.x, feet.y + 1.7, feet.z)
    if (this.shiftLock) {
      // shoulder offset
      const r = this.right()
      target.x += r.x * 0.85
      target.z += r.z * 0.85
    }

    const cp = Math.cos(this.pitch)
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    )

    // pull in when blocked
    let allowed = this.dist
    const steps = 18
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * this.dist
      const px = target.x + offset.x * t
      const py = target.y + offset.y * t
      const pz = target.z + offset.z * t
      if (this.pointBlocked(px, py, pz, sources)) {
        allowed = Math.max(1.2, t - 0.45)
        break
      }
    }

    this.smoothedDist = allowed < this.smoothedDist
      ? allowed // snap in fast (never clip)
      : damp(this.smoothedDist, allowed, 4, dt)

    camera.position.set(
      target.x + offset.x * this.smoothedDist,
      target.y + offset.y * this.smoothedDist,
      target.z + offset.z * this.smoothedDist,
    )
    camera.lookAt(target)
  }

  /** true when orbit camera is close enough that the avatar should hide */
  isFirstPersonish(): boolean {
    return this.mode === 'fp' || this.smoothedDist < 2.6
  }

  private pointBlocked(x: number, y: number, z: number, sources: ColliderSource[]): boolean {
    const r = 0.22
    this.scratch.length = 0
    for (const s of sources) s.collect(x - r, y - r, z - r, x + r, y + r, z + r, this.scratch)
    for (const b of this.scratch) {
      if (x > b.minX - r && x < b.maxX + r && y > b.minY - r && y < b.maxY + r && z > b.minZ - r && z < b.maxZ + r) {
        return true
      }
    }
    return false
  }
}
