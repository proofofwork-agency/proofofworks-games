// The Blobcade avatar: a friendly blob character built from
// cached soft primitives, with a canvas-drawn face, procedural walk/jump animation,
// a floating name tag and chat bubbles. No rigs, no assets — pure code.

import * as THREE from 'three'
import { dampAngle, hashString } from './math'
import { partMaterial } from './world'

const SKIN = '#f2c84b'
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#fd79a8', '#00b06f', '#5d6df1']
const PANTS = ['#2c3e50', '#34495e', '#1e3a5f', '#3d2b56', '#4a3728']

/** Optional cosmetics the runtime/shop can apply to any avatar (local or
 *  remote). hat = a shop item id like 'hat-crown' (+ its accent color);
 *  face = a face variant id like 'face-cool'. null/undefined leaves the slot
 *  as-is (or clears it, in setCosmetics). */
export interface AvatarCosmetics {
  hat?: string | null
  /** accent color for the hat (from the shop item); falls back to a sensible per-hat default */
  hatColor?: string | null
  face?: string | null
}

/** known face variant ids — anything else falls back to the default smile */
const FACE_VARIANTS = new Set(['face-happy', 'face-cool', 'face-angry'])

// All faces are drawn on one 128×128 canvas, parameterized by variant. The
// default smile is unchanged; 'face-cool' swaps the eyes for shades and
// 'face-angry' adds eyebrows + a frown. Pure canvas — no assets.
type FaceVariant = 'face-happy' | 'face-cool' | 'face-angry'

function drawFace(g: CanvasRenderingContext2D, variant: FaceVariant) {
  g.clearRect(0, 0, 128, 128)
  g.fillStyle = '#1a1a1a'
  g.strokeStyle = '#1a1a1a'
  g.lineCap = 'round'

  if (variant === 'face-cool') {
    // black rectangle shades joined by a bridge — eyes hidden behind them
    g.fillRect(28, 44, 28, 18)
    g.fillRect(72, 44, 28, 18)
    g.fillRect(56, 50, 16, 5)
    // easy grin
    g.lineWidth = 7
    g.beginPath()
    g.arc(64, 74, 22, Math.PI * 0.12, Math.PI * 0.88)
    g.stroke()
    return
  }

  // eyes (shared by happy + angry)
  g.beginPath()
  g.ellipse(42, 52, 9, 13, 0, 0, Math.PI * 2)
  g.ellipse(86, 52, 9, 13, 0, 0, Math.PI * 2)
  g.fill()

  if (variant === 'face-angry') {
    // angled eyebrows pointing inward + a frown
    g.lineWidth = 8
    g.beginPath()
    g.moveTo(30, 30); g.lineTo(54, 42)
    g.moveTo(98, 30); g.lineTo(74, 42)
    g.stroke()
    g.lineWidth = 7
    g.beginPath()
    g.arc(64, 92, 24, Math.PI * 1.2, Math.PI * 1.8)
    g.stroke()
    return
  }

  // default: smile
  g.lineWidth = 7
  g.beginPath()
  g.arc(64, 70, 24, Math.PI * 0.18, Math.PI * 0.82)
  g.stroke()
}

function makeFaceTexture(variant: FaceVariant = 'face-happy'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  drawFace(g, variant)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
/** shared default-face texture (the common case — most avatars never change it) */
let faceTex: THREE.CanvasTexture | null = null

function textSprite(text: string, opts: { font?: string; pad?: number; bg?: string; fg?: string; maxW?: number } = {}) {
  const { font = '700 44px "Avenir Next", system-ui, sans-serif', pad = 18, bg = 'rgba(12,16,22,0.66)', fg = '#fff' } = opts
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = font
  const w = Math.min(opts.maxW ?? 560, Math.ceil(g.measureText(text).width)) + pad * 2
  const h = 64 + pad
  c.width = w
  c.height = h
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (bg) {
    g.fillStyle = bg
    const r = 18
    g.beginPath()
    g.roundRect(0, 0, w, h, r)
    g.fill()
  }
  g.fillStyle = fg
  g.fillText(text, w / 2, h / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  const scale = 0.011
  sprite.scale.set(w * scale, h * scale, 1)
  return sprite
}

// ---- shared avatar geometry cache ----
// Avatar meshes share these geometries across local + remote players. Per-avatar
// teardown must never dispose them; only per-instance textures/materials are owned.
const avatarGeoCache = new Map<string, THREE.BufferGeometry>()

function cachedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = avatarGeoCache.get(key) as T | undefined
  if (!g) {
    g = make()
    avatarGeoCache.set(key, g)
  }
  return g
}

function avatarBox(w: number, h: number, d: number): THREE.BoxGeometry {
  return cachedGeo(`box:${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d))
}

function avatarCapsule(radius: number, height: number, capSegments = 4, radialSegments = 8): THREE.CapsuleGeometry {
  const r = Math.max(0.01, radius)
  const length = Math.max(0.001, height - r * 2)
  return cachedGeo(
    `capsule:${r.toFixed(3)}|${height.toFixed(3)}|${capSegments}|${radialSegments}`,
    () => new THREE.CapsuleGeometry(r, length, capSegments, radialSegments),
  )
}

function avatarEllipsoid(rx: number, ry: number, rz: number, widthSegments = 16, heightSegments = 12): THREE.SphereGeometry {
  return cachedGeo(
    `ellipsoid:${rx.toFixed(3)}|${ry.toFixed(3)}|${rz.toFixed(3)}|${widthSegments}|${heightSegments}`,
    () => {
      const g = new THREE.SphereGeometry(1, widthSegments, heightSegments)
      g.scale(rx, ry, rz)
      return g
    },
  )
}

function avatarCylinder(radiusTop: number, radiusBottom: number, height: number, radialSegments = 16): THREE.CylinderGeometry {
  return cachedGeo(
    `cylinder:${radiusTop.toFixed(3)}|${radiusBottom.toFixed(3)}|${height.toFixed(3)}|${radialSegments}`,
    () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1),
  )
}

function avatarTorus(radius: number, tube: number, radialSegments = 8, tubularSegments = 24): THREE.TorusGeometry {
  return cachedGeo(
    `torus:${radius.toFixed(3)}|${tube.toFixed(3)}|${radialSegments}|${tubularSegments}`,
    () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments),
  )
}

function avatarPlane(w: number, h: number): THREE.PlaneGeometry {
  return cachedGeo(`plane:${w.toFixed(3)}|${h.toFixed(3)}`, () => new THREE.PlaneGeometry(w, h))
}

function limb(w: number, h: number, d: number, color: string): { pivot: THREE.Group; mesh: THREE.Mesh } {
  const pivot = new THREE.Group()
  const geo = avatarCapsule(Math.min(w, d) / 2, h)
  const mesh = new THREE.Mesh(geo, partMaterial(color, 'plastic'))
  mesh.position.y = -h / 2
  mesh.castShadow = true
  pivot.add(mesh)
  return { pivot, mesh }
}

const flashMat = new THREE.MeshBasicMaterial({ color: '#ff6b5e' })

export class Avatar {
  group = new THREE.Group()
  /** yaw the body is currently facing (smoothed) */
  yaw = 0
  targetYaw = 0
  /** combat: raises the weapon arm toward the target */
  aiming = false
  private weaponProp: THREE.Group | null = null
  // overhead health bar (combat games)
  private hpSprite: THREE.Sprite | null = null
  private hpCanvas: HTMLCanvasElement | null = null
  private hpTex: THREE.CanvasTexture | null = null
  // hit flash (all meshes swap to red for a beat)
  private flashT = 0
  private flashed: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = []

  private leftArm: THREE.Group
  private rightArm: THREE.Group
  private leftLeg: THREE.Group
  private rightLeg: THREE.Group
  private body: THREE.Group
  private torso: THREE.Mesh
  private head: THREE.Mesh
  private face: THREE.Mesh
  // cosmetics: a hat group parented to the body at head height (moves exactly
  // like the face plane), plus per-instance resources to dispose.
  private hatGroup: THREE.Group | null = null
  private halo: THREE.Mesh | null = null
  private haloBaseY = 0
  private ownFaceTex: THREE.CanvasTexture | null = null
  private faceVariant: FaceVariant = 'face-happy'
  private nameSprite: THREE.Sprite | null = null
  private bubble: THREE.Sprite | null = null
  private bubbleUntil = 0
  private animT = Math.random() * 10

  readonly shirtColor: string

  constructor(name: string, seedKey: string, shirtOverride?: string, cosmetics?: AvatarCosmetics) {
    const seed = hashString(seedKey)
    this.shirtColor = shirtOverride ?? SHIRTS[seed % SHIRTS.length]
    const pants = PANTS[(seed >> 4) % PANTS.length]

    this.body = new THREE.Group()
    this.group.add(this.body)

    // torso: soft ellipsoid filling roughly the old 0.85w x 0.95h x 0.5d silhouette
    const torsoGeo = avatarEllipsoid(0.43, 0.52, 0.27)
    this.torso = new THREE.Mesh(torsoGeo, partMaterial(this.shirtColor, 'plastic'))
    this.torso.position.y = 1.125
    this.torso.castShadow = true
    this.body.add(this.torso)

    // head: round crown with a tiny vertical squash to keep the old height read
    const headGeo = avatarEllipsoid(0.32, 0.33, 0.32)
    this.head = new THREE.Mesh(headGeo, partMaterial(SKIN, 'plastic'))
    this.head.position.y = 1.95
    this.head.castShadow = true
    this.body.add(this.head)

    // face (front of head, -Z is forward... we use +Z forward for the model and rotate)
    if (!faceTex) faceTex = makeFaceTexture()
    this.face = new THREE.Mesh(
      avatarPlane(0.48, 0.42),
      // polygonOffset + a real gap to the head's front face — without both,
      // depth precision at distance z-fights the plane into a visible seam
      new THREE.MeshBasicMaterial({
        map: faceTex, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    )
    this.face.position.set(0, 1.96, 0.342)
    this.body.add(this.face)

    // arms (pivot at shoulder y=1.55)
    const armW = 0.28
    const la = limb(armW, 0.9, armW, this.shirtColor)
    const ra = limb(armW, 0.9, armW, this.shirtColor)
    this.leftArm = la.pivot
    this.rightArm = ra.pivot
    this.leftArm.position.set(-(0.425 + armW / 2 + 0.02), 1.55, 0)
    this.rightArm.position.set(0.425 + armW / 2 + 0.02, 1.55, 0)
    this.body.add(this.leftArm, this.rightArm)

    // hands (skin tone tips) — slightly proud of the sleeve so no face is
    // coplanar with the arm capsule (coplanar faces z-fight = flickering hands)
    for (const arm of [la, ra]) {
      const hand = new THREE.Mesh(avatarEllipsoid(0.155, 0.135, 0.155, 12, 8), partMaterial(SKIN, 'plastic'))
      hand.position.y = -0.875
      arm.pivot.add(hand)
    }

    // legs (pivot at hip y=0.65)
    const legW = 0.32
    const ll = limb(legW, 0.65, legW, pants)
    const rl = limb(legW, 0.65, legW, pants)
    this.leftLeg = ll.pivot
    this.rightLeg = rl.pivot
    this.leftLeg.position.set(-0.21, 0.65, 0)
    this.rightLeg.position.set(0.21, 0.65, 0)
    this.body.add(this.leftLeg, this.rightLeg)

    if (name) {
      this.nameSprite = textSprite(name, { bg: '', fg: '#ffffff' })
      this.nameSprite.position.y = 2.62
      this.group.add(this.nameSprite)
    }

    if (cosmetics) this.setCosmetics(cosmetics)
  }

  /**
   * Apply shop cosmetics. Safe to call any time after construction (the
   * runtime wires this from economy.equippedHat()/equippedFace()). Only the
   * provided keys change; pass `null` to clear a slot. Works on remote avatars
   * too — the runtime just calls it with their broadcast cosmetics.
   */
  setCosmetics(opts: AvatarCosmetics) {
    if ('face' in opts) this.setFace(opts.face ?? null)
    if ('hat' in opts) this.setHat(opts.hat ?? null, opts.hatColor ?? null)
  }

  /** repaint the shirt (torso + sleeves) — per-game stores sell recolors.
   *  Materials are shared via the cache, so swap, never tint in place. */
  setShirtColor(color: string) {
    const m = partMaterial(color, 'plastic')
    this.torso.material = m
    for (const pivot of [this.leftArm, this.rightArm]) {
      const sleeve = pivot.children[0]
      if (sleeve instanceof THREE.Mesh) sleeve.material = m
    }
  }

  private setFace(faceId: string | null) {
    const variant: FaceVariant = (faceId && FACE_VARIANTS.has(faceId) ? faceId : 'face-happy') as FaceVariant
    if (variant === this.faceVariant) return
    this.faceVariant = variant
    const mat = this.face.material as THREE.MeshBasicMaterial
    if (variant === 'face-happy') {
      // back to the shared default texture; drop any per-instance one
      if (!faceTex) faceTex = makeFaceTexture()
      mat.map = faceTex
      if (this.ownFaceTex) { this.ownFaceTex.dispose(); this.ownFaceTex = null }
    } else {
      // own texture for the variant (the shared one must stay the default)
      this.ownFaceTex?.dispose()
      this.ownFaceTex = makeFaceTexture(variant)
      mat.map = this.ownFaceTex
    }
    mat.needsUpdate = true
  }

  private setHat(hatId: string | null, color: string | null) {
    // tear down any existing hat first (slot is exclusive)
    if (this.hatGroup) {
      this.body.remove(this.hatGroup)
      disposeGroup(this.hatGroup)
      this.hatGroup = null
      this.halo = null
    }
    if (!hatId) return

    const g = new THREE.Group()
    // head: center y=1.95, vertical radius 0.33 → crown/top at about 2.28.
    const TOP = 2.28
    switch (hatId) {
      case 'hat-cap': {
        const col = color ?? '#e74c3c'
        const dome = new THREE.Mesh(avatarEllipsoid(0.33, 0.11, 0.31, 16, 8), partMaterial(col, 'plastic'))
        dome.position.y = TOP + 0.04
        dome.castShadow = true
        // brim juts forward over the face (+Z)
        const brim = new THREE.Mesh(avatarEllipsoid(0.26, 0.035, 0.15, 12, 6), partMaterial(col, 'plastic'))
        brim.position.set(0, TOP - 0.02, 0.34)
        brim.castShadow = true
        g.add(dome, brim)
        break
      }
      case 'hat-tophat': {
        const col = color ?? '#1c2733'
        const brim = new THREE.Mesh(avatarCylinder(0.38, 0.38, 0.06, 20), partMaterial(col, 'plastic'))
        brim.position.y = TOP + 0.01
        const crown = new THREE.Mesh(avatarCylinder(0.24, 0.25, 0.42, 20), partMaterial(col, 'plastic'))
        crown.position.y = TOP + 0.25
        brim.castShadow = crown.castShadow = true
        g.add(brim, crown)
        break
      }
      case 'hat-crown': {
        const col = color ?? '#ffc94d'
        // thin gold ring with 3 little rounded spikes
        const band = new THREE.Mesh(avatarCylinder(0.33, 0.34, 0.13, 18), partMaterial(col, 'gold'))
        band.position.y = TOP + 0.05
        band.castShadow = true
        g.add(band)
        const spike = () => new THREE.Mesh(avatarEllipsoid(0.055, 0.1, 0.055, 8, 6), partMaterial(col, 'gold'))
        for (const dx of [-0.2, 0, 0.2]) {
          const s = spike()
          s.position.set(dx, TOP + 0.2, 0)
          s.castShadow = true
          g.add(s)
        }
        break
      }
      case 'hat-halo': {
        const col = color ?? '#ffe9a8'
        const haloMat = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: 1.6, roughness: 0.4 })
        haloMat.userData.ownedByAvatar = true // inline material — safe to dispose (see disposeGroup)
        const halo = new THREE.Mesh(avatarTorus(0.32, 0.045, 8, 24), haloMat)
        halo.rotation.x = Math.PI / 2 // lie flat, ring parallel to the ground
        this.haloBaseY = TOP + 0.32
        halo.position.y = this.haloBaseY
        this.halo = halo
        g.add(halo)
        break
      }
      default:
        return // unknown hat id — leave bare-headed
    }
    this.body.add(g) // parented to body at head height → tracks the head like the face plane
    this.hatGroup = g
  }

  /** put a simple weapon prop in the right hand (combat games) */
  holdWeapon(accent = '#7df9ff') {
    if (this.weaponProp) return
    const grip = new THREE.Group()
    const body = new THREE.Mesh(avatarBox(0.17, 0.22, 0.6), partMaterial('#2e3540', 'metal'))
    body.position.set(0, -0.78, 0.28)
    body.castShadow = true
    const barrel = new THREE.Mesh(avatarBox(0.09, 0.09, 0.36), partMaterial(accent, 'neon'))
    barrel.position.set(0, -0.75, 0.72)
    grip.add(body, barrel)
    this.rightArm.add(grip)
    this.weaponProp = grip
  }

  /** show a life bar above the head (combat games). Starts full. */
  enableHealthBar() {
    if (this.hpSprite) return
    this.hpCanvas = document.createElement('canvas')
    this.hpCanvas.width = 128
    this.hpCanvas.height = 22
    this.hpTex = new THREE.CanvasTexture(this.hpCanvas)
    this.hpTex.colorSpace = THREE.SRGBColorSpace
    this.hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hpTex, transparent: true, depthWrite: false }))
    this.hpSprite.scale.set(1.15, 0.2, 1)
    this.hpSprite.position.y = 2.42
    this.body.add(this.hpSprite) // on the body so it hides with the corpse
    this.setHealth(1)
  }

  /** redraw the life bar at k = health/maxHealth (0..1) */
  setHealth(k: number) {
    if (!this.hpCanvas || !this.hpTex) return
    k = Math.max(0, Math.min(1, k))
    const g = this.hpCanvas.getContext('2d')!
    g.clearRect(0, 0, 128, 22)
    g.fillStyle = 'rgba(10,14,20,0.72)'
    g.beginPath()
    g.roundRect(0, 0, 128, 22, 11)
    g.fill()
    if (k > 0.003) {
      g.fillStyle = k > 0.55 ? '#37d67a' : k > 0.28 ? '#ffc94d' : '#ff5d5d'
      g.beginPath()
      g.roundRect(3, 3, Math.max(8, (128 - 6) * k), 16, 8)
      g.fill()
    }
    this.hpTex.needsUpdate = true
  }

  /** flash the whole body red for a beat — the universal "I got hit" read */
  hitFlash() {
    if (this.flashT <= 0) {
      this.flashed = []
      this.body.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && !(m.material as THREE.MeshBasicMaterial).map) {
          this.flashed.push([m, m.material])
          m.material = flashMat
        }
      })
    }
    this.flashT = 0.09
  }

  say(text: string) {
    if (this.bubble) {
      disposeSprite(this.bubble)
      this.bubble = null
    }
    this.bubble = textSprite(text.slice(0, 60), { bg: 'rgba(255,255,255,0.95)', fg: '#15202b' })
    this.bubble.position.y = 3.15
    this.group.add(this.bubble)
    this.bubbleUntil = performance.now() + 4200
  }

  setVisible(v: boolean) {
    this.body.visible = v
    if (this.nameSprite) this.nameSprite.visible = v
    if (this.bubble) this.bubble.visible = v
    if (this.hpSprite) this.hpSprite.visible = v
  }

  /**
   * @param speed horizontal speed (m/s)
   * @param grounded standing on something
   * @param now seconds clock
   */
  animate(dt: number, speed: number, grounded: boolean, now: number) {
    this.yaw = dampAngle(this.yaw, this.targetYaw, 14, dt)
    this.body.rotation.y = this.yaw
    if (this.nameSprite) this.nameSprite.position.y = 2.62

    // halo bobs gently above the head and slowly spins
    if (this.halo) {
      this.halo.position.y = this.haloBaseY + Math.sin(now * 2.2) * 0.05
      this.halo.rotation.z += dt * 0.8
    }

    if (this.flashT > 0) {
      this.flashT -= dt
      if (this.flashT <= 0) {
        for (const [mesh, mat] of this.flashed) mesh.material = mat
        this.flashed = []
      }
    }

    const walk = Math.min(1, speed / 6)
    this.animT += dt * (4.5 + speed * 1.1)

    if (!grounded) {
      // air pose: arms up & out, legs tucked
      const t = Math.min(1, Math.abs(dt) * 60)
      this.leftArm.rotation.x = lerpA(this.leftArm.rotation.x, -2.5, 0.15 * t * 60 * dt)
      this.rightArm.rotation.x = lerpA(this.rightArm.rotation.x, -2.5, 0.15 * t * 60 * dt)
      this.leftLeg.rotation.x = lerpA(this.leftLeg.rotation.x, 0.45, 0.2)
      this.rightLeg.rotation.x = lerpA(this.rightLeg.rotation.x, -0.3, 0.2)
      this.body.position.y = 0
    } else if (walk > 0.05) {
      const s = Math.sin(this.animT)
      const amp = 0.85 * walk
      this.leftArm.rotation.x = s * amp
      this.rightArm.rotation.x = -s * amp
      this.leftLeg.rotation.x = -s * amp
      this.rightLeg.rotation.x = s * amp
      this.body.position.y = Math.abs(Math.cos(this.animT)) * 0.06 * walk
    } else {
      // idle: subtle breathing sway
      const b = Math.sin(now * 1.7)
      this.leftArm.rotation.x = lerpA(this.leftArm.rotation.x, b * 0.04, 0.12)
      this.rightArm.rotation.x = lerpA(this.rightArm.rotation.x, -b * 0.04, 0.12)
      this.leftLeg.rotation.x = lerpA(this.leftLeg.rotation.x, 0, 0.18)
      this.rightLeg.rotation.x = lerpA(this.rightLeg.rotation.x, 0, 0.18)
      this.body.position.y = b * 0.012
    }

    // armed + aiming: the weapon arm levels at the target regardless of gait
    if (this.aiming && this.weaponProp) {
      this.rightArm.rotation.x = lerpA(this.rightArm.rotation.x, -1.45, 0.35)
    }

    if (this.bubble && performance.now() > this.bubbleUntil) {
      disposeSprite(this.bubble)
      this.bubble = null
    }
  }

  dispose() {
    if (this.flashT > 0) {
      for (const [mesh, mat] of this.flashed) mesh.material = mat
      this.flashT = 0
      this.flashed = []
    }
    if (this.hatGroup) {
      this.body.remove(this.hatGroup)
      disposeGroup(this.hatGroup)
      this.hatGroup = null
      this.halo = null
    }
    if (this.ownFaceTex) { this.ownFaceTex.dispose(); this.ownFaceTex = null }
    const faceMat = this.face.material as THREE.MeshBasicMaterial
    faceMat.map = null
    faceMat.dispose()
    if (this.hpSprite) { disposeSprite(this.hpSprite); this.hpSprite = null }
    this.hpTex = null
    this.hpCanvas = null
    if (this.nameSprite) { disposeSprite(this.nameSprite); this.nameSprite = null }
    if (this.bubble) { disposeSprite(this.bubble); this.bubble = null }
    if (this.weaponProp) {
      this.rightArm.remove(this.weaponProp)
      disposeGroup(this.weaponProp)
      this.weaponProp = null
    }
    this.group.removeFromParent()
  }
}

function lerpA(a: number, b: number, t: number) {
  return a + (b - a) * Math.min(1, t)
}

/**
 * Free the per-instance GPU resources a cosmetic/prop group owns. Geometry is
 * shared through avatarGeoCache and must never be disposed here. Materials from
 * world.ts's partMaterial() cache are also shared; only inline tagged materials
 * (currently the halo) are freed.
 */
function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      if (mat?.userData?.ownedByAvatar) mat.dispose()
    }
  })
}

function disposeSprite(sprite: THREE.Sprite) {
  sprite.removeFromParent()
  const mat = sprite.material as THREE.SpriteMaterial
  mat.map?.dispose()
  mat.dispose()
}
