import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'

// The avatar draws its face + name tag onto a 2D canvas. Vitest runs in Node
// (no jsdom), so stub just enough of document/canvas for construction — THREE's
// scene-graph + matrix math, which is what we're actually testing, runs natively.
beforeAll(() => {
  const ctx2d = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 24 })
        return () => {}
      },
    },
  )
  const makeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d })
  ;(globalThis as any).document = {
    createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : {}),
  }
})

// Imported after the stub is declared; the module only touches document at
// construction time (inside the test bodies), never at import time.
const { Avatar } = await import('../src/engine/avatar')

const worldY = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).y
const make = () => {
  const av = new Avatar('Tester', 'seed-1') as any
  av.group.updateMatrixWorld(true)
  return av
}

describe('avatar articulated rig', () => {
  it('stands with the head at ~1.95 and shoe soles resting at ground level', () => {
    const av = make()
    expect(worldY(av.head)).toBeCloseTo(1.95, 1)
    for (const foot of av.shoeMeshes as THREE.Mesh[]) {
      const centre = worldY(foot)
      expect(centre).toBeGreaterThan(0) // off the floor a touch...
      expect(centre).toBeLessThan(0.16)
      expect(centre - 0.085).toBeLessThan(0.05) // ...sole (ry=0.085) ~ ground
      expect(centre - 0.085).toBeGreaterThan(-0.08)
    }
  })

  it('groups every body mesh into a recolor slot (skin/shirt/pants/shoe)', () => {
    const av = make()
    expect(av.skinMeshes.length).toBe(3) // head + 2 hands
    expect(av.shirtMeshes.length).toBe(5) // torso + 2× (upper arm + forearm)
    expect(av.pantsMeshes.length).toBe(4) // 2× (thigh + shin)
    expect(av.shoeMeshes.length).toBe(2) // 2 feet
    // recolor setters swap materials in place without throwing
    expect(() => {
      av.setShirtColor('#123456')
      av.setSkinColor('#abcdef')
      av.setPantsColor('#222222')
      av.setShoeColor('#000000')
    }).not.toThrow()
  })

  it('exposes cosmetic anchors fixed to the matching joints', () => {
    const av = make()
    const keys = [
      'head', 'face', 'chest', 'back',
      'leftShoulder', 'rightShoulder', 'leftWrist', 'rightWrist',
      'leftHand', 'rightHand', 'leftFoot', 'rightFoot',
    ]
    for (const k of keys) expect(av.anchors[k]).toBeInstanceOf(THREE.Group)
    expect(worldY(av.anchors.head)).toBeCloseTo(2.28, 1) // crown
    expect(worldY(av.anchors.leftHand)).toBeGreaterThan(0.4)
    expect(worldY(av.anchors.leftHand)).toBeLessThan(0.9)
    expect(worldY(av.anchors.leftFoot)).toBeLessThan(0.2)
    // an attached cosmetic rides the joint, then clears cleanly
    const ring = new THREE.Group()
    av.attach('rightHand', ring)
    expect(ring.parent).toBe(av.anchors.rightHand)
    av.clearAnchor('rightHand')
    expect(ring.parent).toBe(null)
  })

  it('flexes knees & elbows while walking, but relaxes them when idle', () => {
    const av = make()
    for (let i = 0; i < 30; i++) av.animate(0.016, 0, true, i * 0.016) // settle idle
    const idleKnee = Math.abs(av.leftKnee.rotation.x)

    let maxKnee = 0
    let minElbow = 0 // most-forward elbow flex seen (negative = forward)
    for (let i = 0; i < 200; i++) {
      av.animate(0.016, 5, true, 1 + i * 0.016) // brisk walk
      maxKnee = Math.max(maxKnee, av.leftKnee.rotation.x)
      minElbow = Math.min(minElbow, av.leftElbow.rotation.x)
    }
    expect(idleKnee).toBeLessThan(0.2)
    // knee bends backward (positive), elbow bends the opposite way — forward
    // (negative), like a real arm rather than mirroring the knee
    expect(maxKnee).toBeGreaterThan(0.3)
    expect(minElbow).toBeLessThan(-0.3)
  })

  it('arches the back + bounces the head on a jump, tilts shoulders on a run', () => {
    const av = make()
    for (let i = 0; i < 10; i++) av.animate(0.016, 0, true, i * 0.016) // grounded
    let minBob = 0
    for (let i = 0; i < 40; i++) {
      av.animate(0.016, 0, false, 1 + i * 0.016) // airborne
      minBob = Math.min(minBob, av.headBob)
    }
    expect(av.upper.rotation.x).toBeLessThan(-0.1) // spine arched back
    expect(minBob).toBeLessThan(-0.01) // head dipped from the takeoff kick
    expect(av.leftArm.rotation.x).toBeLessThan(-2.0) // arms reach overhead...
    expect(Math.abs(av.leftElbow.rotation.x)).toBeLessThan(0.15) // ...elbows extended (stretch, not bend)

    const runner = make()
    let maxTilt = 0
    for (let i = 0; i < 200; i++) {
      runner.animate(0.016, 9, true, 1 + i * 0.016) // sprint
      maxTilt = Math.max(maxTilt, Math.abs(runner.upper.rotation.z))
    }
    expect(maxTilt).toBeGreaterThan(0.05) // shoulders rock side-to-side
  })

  it('never produces a NaN transform across rapid state changes', () => {
    const av = make()
    const seq: Array<[number, boolean]> = [
      [0, true], [5, true], [0, false], [0, true], [9, true], [0, false], [3, true],
    ]
    let t = 0
    for (const [sp, gr] of seq) {
      for (let i = 0; i < 60; i++) {
        t += 0.016
        av.animate(0.016, sp, gr, t)
      }
    }
    av.group.updateMatrixWorld(true)
    let bad = 0
    av.group.traverse((o: THREE.Object3D) => {
      const v = o.getWorldPosition(new THREE.Vector3())
      if (!Number.isFinite(v.x + v.y + v.z)) bad++
    })
    expect(bad).toBe(0)
  })
})
