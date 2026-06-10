// Boxcade combat: a classic arena-shooter arsenal (hitscan + projectile
// archetypes), damage/respawn, splash knockback (rocket jumps work), limited
// ammo with weapon/ammo/health pickups, and bots that run the same character
// physics as players. Bots pick the right gun for the range, lead their
// projectiles, hunt whoever shot them and run for supplies when low. Weapon
// stats are plain data — games can clone and tune every number.
//
// Scope note: combat is locally authoritative — your shots hurt bots in your
// session. Remote humans are visible but not damageable yet (roadmap).

import * as THREE from 'three'
import { CharacterController, raycastWorld, rayBox, type Box, type ColliderSource } from './physics'
import { Avatar } from './avatar'
import { Particles } from './fx'
import { audio } from './audio'
import { v3, vclone, type Vec3 } from './math'
import type { EventBus } from './events'

// ---------------------------------------------------------------- weapons --

export interface WeaponDef {
  id: string
  /** display name — classic arena-shooter archetypes with original names */
  name: string
  icon: string
  kind: 'hitscan' | 'projectile'
  damage: number
  /** shots per second */
  fireRate: number
  pellets?: number
  /** radians of cone jitter */
  spread?: number
  range?: number
  beamColor?: string
  /** visual beam thickness in meters (default 0.05) */
  beamWidth?: number
  /** right-mouse zoom FOV (sniper) */
  zoomFov?: number
  /** ammo reserve cap; omit for infinite (the sidearm never runs dry) */
  ammoMax?: number
  /** rounds granted by one pickup (default: a third of ammoMax) */
  ammoPickup?: number
  /** bot brain: preferred engagement band in meters [near, far] */
  botRange?: [number, number]
  projectile?: {
    speed: number
    radius: number
    color: string
    gravity?: number
    splash?: number
    life?: number
  }
  sound: string
}

/** The classic tournament loadout. Clone + tweak any of these in a game def. */
export const WEAPONS: Record<string, WeaponDef> = {
  sidearm: {
    id: 'sidearm', name: 'Sidearm', icon: '🔫', kind: 'hitscan',
    damage: 15, fireRate: 3.4, spread: 0.012, range: 90, beamColor: '#ffe9a8', sound: 'sidearm',
    botRange: [0, 55],
  },
  shock: {
    id: 'shock', name: 'Shock Lance', icon: '⚡', kind: 'hitscan',
    damage: 40, fireRate: 1.5, spread: 0, range: 140, beamColor: '#7df9ff', beamWidth: 0.11, sound: 'shock',
    ammoMax: 30, ammoPickup: 10, botRange: [16, 130],
  },
  pulse: {
    id: 'pulse', name: 'Pulse Blaster', icon: '🟢', kind: 'projectile',
    damage: 12, fireRate: 7, spread: 0.02,
    projectile: { speed: 50, radius: 0.16, color: '#5dff5d', life: 2.2 }, sound: 'pulse',
    ammoMax: 160, ammoPickup: 50, botRange: [5, 45],
  },
  minigun: {
    id: 'minigun', name: 'Minigun', icon: '🌀', kind: 'hitscan',
    damage: 7, fireRate: 14, spread: 0.038, range: 100, beamColor: '#ffd27d', beamWidth: 0.035, sound: 'minigun',
    ammoMax: 220, ammoPickup: 70, botRange: [4, 50],
  },
  flak: {
    id: 'flak', name: 'Flak Scattergun', icon: '💥', kind: 'projectile',
    damage: 11, fireRate: 1.15, pellets: 8, spread: 0.085,
    projectile: { speed: 34, radius: 0.14, color: '#ffae5e', gravity: -14, life: 1.4 }, sound: 'flak',
    ammoMax: 24, ammoPickup: 8, botRange: [0, 17],
  },
  rockets: {
    id: 'rockets', name: 'Rocket Launcher', icon: '🚀', kind: 'projectile',
    damage: 72, fireRate: 0.95,
    projectile: { speed: 30, radius: 0.3, color: '#ff6b4a', splash: 4.2, life: 4 }, sound: 'rocket',
    ammoMax: 12, ammoPickup: 4, botRange: [8, 60],
  },
  sniper: {
    id: 'sniper', name: 'Sniper Rifle', icon: '🎯', kind: 'hitscan',
    damage: 70, fireRate: 0.85, spread: 0, range: 220, beamColor: '#ff9d9d', beamWidth: 0.035, zoomFov: 20, sound: 'sniper',
    ammoMax: 15, ammoPickup: 5, botRange: [32, 220],
  },
}

export const DEFAULT_LOADOUT = ['sidearm', 'shock', 'pulse', 'minigun', 'flak', 'rockets', 'sniper']

/**
 * Registry-pattern extension point: add a custom weapon once, then reference
 * it by id in any game's combat config, weaponSpawn pads or lootboxes.
 *
 *   registerWeapon({ id: 'crossbow', name: 'Crossbow', icon: '🏹', kind: 'projectile', ... })
 */
export function registerWeapon(def: WeaponDef): WeaponDef {
  if (WEAPONS[def.id]) console.warn(`[boxcade] registerWeapon: overwriting '${def.id}'`)
  WEAPONS[def.id] = def
  return def
}

/** pseudo-weapon credited for kill-plane / void deaths */
export const FALL_WEAPON: WeaponDef = {
  id: 'void', name: 'the void', icon: '🕳', kind: 'hitscan', damage: 0, fireRate: 1, sound: 'sidearm',
}

/** pseudo-weapons for game hazards (gas circles, traps) — shows up in the kill feed */
const hazardCache = new Map<string, WeaponDef>()
export function hazardWeapon(name: string, icon = '☠'): WeaponDef {
  let w = hazardCache.get(name + icon)
  if (!w) {
    w = { id: 'hazard:' + name, name, icon, kind: 'hitscan', damage: 0, fireRate: 1, sound: 'sidearm' }
    hazardCache.set(name + icon, w)
  }
  return w
}

export interface CombatConfig {
  health?: number
  respawnSeconds?: number
  /** weapon ids or full custom defs — the whole arsenal available in this game */
  weapons?: Array<string | WeaponDef>
  /** ids everyone holds at spawn (default: the whole arsenal, classic arena style) */
  startWeapons?: string[]
  /** classic mode: nothing consumes ammo */
  infiniteAmmo?: boolean
}

export interface KillInfo {
  killer: CombatEntity | null
  victim: CombatEntity
  weapon: string
  headshot: boolean
}

// --------------------------------------------------------------- pickups --

export type PickupKind = 'weapon' | 'ammo' | 'health'

export interface CombatPickup {
  kind: PickupKind
  /** weapon pickups only */
  weaponId?: string
  pos: Vec3
  active: boolean
  respawnIn: number
  /** seconds until it comes back (<= 0 = gone for good once taken) */
  respawnAfter: number
  /** health pickups: hp restored (default 35) */
  heal?: number
  setVisible: (v: boolean) => void
}

// --------------------------------------------------------------- entities --

let nextEntityId = 1

export class CombatEntity {
  id: string
  name: string
  team: string | null
  isBot: boolean
  ctrl: CharacterController
  avatar: Avatar | null
  health: number
  maxHealth: number
  alive = true
  respawnIn = 0
  spawnPoints: Vec3[]
  /** the game's full arsenal (shared); what you HOLD is `owned` + `ammo` */
  weapons: WeaponDef[]
  weaponIdx = 0
  cooldown = 0
  /** weapon ids currently held */
  owned = new Set<string>()
  /** rounds left per weapon id (absent = 0; infinite weapons aren't tracked) */
  ammo: Record<string, number> = {}
  /** free-form tag for game modes (e.g. which flag this entity carries) */
  carrying: string | null = null
  /** slow-fall infil (battle royale drops) — cleared on landing */
  parachute = false

  // bot brain
  objective: Vec3 | null = null
  skill = 0.5
  /** where shots came from — bots turn and hunt (set by CombatSystem.damage) */
  alert: Vec3 | null = null
  alertT = 0
  private strafeDir = 1
  private strafeT = 0
  private stuckT = 0
  private aimErr = 0.1
  private seenT = 0
  private lastKnown: Vec3 | null = null
  private chaseT = 0
  private swapT = 0
  private burstT = 0
  private restT = 0
  private wanderSpot: Vec3 | null = null
  private wanderT = 0

  constructor(opts: {
    name: string
    team: string | null
    isBot: boolean
    ctrl: CharacterController
    avatar: Avatar | null
    health: number
    spawnPoints: Vec3[]
    weapons: WeaponDef[]
    skill?: number
  }) {
    this.id = 'e' + nextEntityId++
    this.name = opts.name
    this.team = opts.team
    this.isBot = opts.isBot
    this.ctrl = opts.ctrl
    this.avatar = opts.avatar
    this.maxHealth = this.health = opts.health
    this.spawnPoints = opts.spawnPoints
    this.weapons = opts.weapons
    this.skill = opts.skill ?? 0.5
    this.aimErr = 0.16 - this.skill * 0.12
  }

  get pos(): Vec3 { return this.ctrl.pos }
  get weapon(): WeaponDef { return this.weapons[this.weaponIdx] }
  eye(): Vec3 { return v3(this.ctrl.pos.x, this.ctrl.pos.y + 1.62, this.ctrl.pos.z) }

  ammoOf(w: WeaponDef): number {
    return w.ammoMax === undefined ? Infinity : this.ammo[w.id] ?? 0
  }
  hasAmmo(w: WeaponDef): boolean { return this.ammoOf(w) > 0 }

  /** equip a fresh loadout: own these ids, ammo at `fill` of each cap */
  initLoadout(ids: string[], fill = 1) {
    this.owned.clear()
    this.ammo = {}
    for (const id of ids) {
      const w = this.weapons.find((x) => x.id === id)
      if (!w) continue
      this.owned.add(id)
      if (w.ammoMax !== undefined) this.ammo[id] = Math.max(1, Math.round(w.ammoMax * fill))
    }
    // hold the strongest thing we own that has ammo (sidearm = last resort)
    let best = 0
    let bestScore = -Infinity
    this.weapons.forEach((w, i) => {
      if (!this.owned.has(w.id) || !this.hasAmmo(w)) return
      const score = w.ammoMax === undefined ? 0 : w.damage * w.fireRate
      if (score > bestScore) { bestScore = score; best = i }
    })
    this.weaponIdx = best
  }

  /** 0..1 — how stocked the finite weapons are (1 when only infinite held) */
  ammoScore(): number {
    let cur = 0
    let max = 0
    for (const w of this.weapons) {
      if (!this.owned.has(w.id) || w.ammoMax === undefined) continue
      cur += Math.min(this.ammo[w.id] ?? 0, w.ammoMax)
      max += w.ammoMax
    }
    return max === 0 ? 1 : cur / max
  }

  /**
   * Hurtbox for weapons — wider and taller than the physics box so it matches
   * the avatar you SEE (arms stick out, and the blocky head tops out at
   * ~2.26m while the movement capsule ends at 1.85m — shots at the visible
   * head must land).
   */
  box() {
    const c = this.ctrl
    const w = c.halfW + 0.2
    return {
      minX: c.pos.x - w, maxX: c.pos.x + w,
      minY: c.pos.y, maxY: c.pos.y + 2.28,
      minZ: c.pos.z - w, maxZ: c.pos.z + w,
    }
  }

  /** pick the best owned gun for the current fight distance (null = no target) */
  private chooseWeapon(dist: number | null) {
    let best = this.weaponIdx
    let bestScore = -Infinity
    this.weapons.forEach((w, i) => {
      if (!this.owned.has(w.id) || !this.hasAmmo(w)) return
      let score = (w.damage * w.fireRate * (w.pellets ?? 1)) / 40
      if (w.ammoMax === undefined) score *= 0.3 // infinite = weak by design
      if (dist !== null && w.botRange) {
        if (dist >= w.botRange[0] && dist <= w.botRange[1]) score += 2.5
        else score -= (dist < w.botRange[0] ? w.botRange[0] - dist : dist - w.botRange[1]) * 0.08
      }
      if (i === this.weaponIdx) score += 0.4 // don't flicker between guns
      if (score > bestScore) { bestScore = score; best = i }
    })
    this.weaponIdx = best
  }

  /** bot steering + shooting; called by CombatSystem.update */
  think(dt: number, sys: CombatSystem) {
    if (!this.alive) return
    const enemies = sys.entities.filter((e) => e.alive && e !== this && (this.team === null || e.team !== this.team))

    // nearest visible enemy
    let target: CombatEntity | null = null
    let bestD = 70
    const eye = this.eye()
    for (const e of enemies) {
      const te = e.eye()
      const d = Math.hypot(te.x - eye.x, te.y - eye.y, te.z - eye.z)
      if (d < bestD && sys.hasLOS(eye, te, d)) {
        bestD = d
        target = e
      }
    }
    this.seenT = target ? this.seenT + dt : 0
    if (this.avatar) this.avatar.aiming = !!target

    // memory: chase the last seen position; getting shot reveals the shooter
    if (target) {
      this.lastKnown = vclone(target.pos)
      this.chaseT = 3.5
    } else if (this.chaseT > 0) {
      this.chaseT -= dt
      if (this.lastKnown && Math.hypot(this.lastKnown.x - this.ctrl.pos.x, this.lastKnown.z - this.ctrl.pos.z) < 2.5) {
        this.chaseT = 0 // arrived, nobody here — drop the lead
      }
    }
    if (this.alertT > 0) this.alertT -= dt

    // re-evaluate the gun for this range every beat
    this.swapT -= dt
    if (this.swapT <= 0) {
      this.swapT = 0.7
      this.chooseWeapon(target ? bestD : null)
    }

    // ---- where to go: survival > supplies > revenge > last-seen > game objective > wander
    let goal = this.objective
    const lowHp = this.health < this.maxHealth * 0.45
    const lowAmmo = !sys.infiniteAmmo && this.ammoScore() < 0.22
    const supply = lowHp
      ? sys.nearestPickup(this.pos, 'health', 80)
      : lowAmmo ? sys.nearestPickup(this.pos, null, 60) : null
    if (supply) goal = supply.pos
    else if (!target && this.alertT > 0 && this.alert) goal = this.alert
    else if (!target && this.chaseT > 0 && this.lastKnown) goal = this.lastKnown
    else if (!goal && !target) {
      this.wanderT -= dt
      if (!this.wanderSpot || this.wanderT <= 0) {
        this.wanderSpot = sys.wanderSpot(this)
        this.wanderT = 4 + Math.random() * 4
      }
      goal = this.wanderSpot
    }

    // steering
    let wishX = 0
    let wishZ = 0
    if (goal) {
      const dx = goal.x - this.ctrl.pos.x
      const dz = goal.z - this.ctrl.pos.z
      const len = Math.hypot(dx, dz)
      if (len > 1.2) {
        wishX = dx / len
        wishZ = dz / len
      }
    }
    if (target) {
      // strafe perpendicular to the target while holding the gun's sweet range
      this.strafeT -= dt
      if (this.strafeT <= 0) {
        this.strafeT = 0.7 + Math.random() * 1.1
        this.strafeDir = Math.random() < 0.5 ? -1 : 1
      }
      const tx = target.pos.x - this.ctrl.pos.x
      const tz = target.pos.z - this.ctrl.pos.z
      const tl = Math.hypot(tx, tz) || 1
      const px = (-tz / tl) * this.strafeDir
      const pz = (tx / tl) * this.strafeDir
      const band = this.weapon.botRange ?? [4, 60]
      let radial = 0 // + closes in, − backs off
      if (bestD > band[1] * 0.9) radial = 0.85
      else if (bestD < band[0] * 1.1) radial = -0.9
      wishX = wishX * 0.35 + px * 0.7 + (tx / tl) * radial
      wishZ = wishZ * 0.35 + pz * 0.7 + (tz / tl) * radial
      const wl = Math.hypot(wishX, wishZ) || 1
      wishX /= wl
      wishZ /= wl
    }

    // edge guard — probe for ground ahead so bots never strafe off a bridge
    // into the void. If the full direction leads nowhere, keep whichever axis
    // still has floor under it (slide along the edge instead of over it).
    const wishLen = Math.hypot(wishX, wishZ)
    if (wishLen > 0.1) {
      const groundAhead = (dx: number, dz: number) =>
        raycastWorld(
          this.ctrl.pos.x + dx * 1.5, this.ctrl.pos.y + 0.6, this.ctrl.pos.z + dz * 1.5,
          0, -1, 0, 8, sys.sources,
        ) !== null
      if (!groundAhead(wishX / wishLen, wishZ / wishLen)) {
        const xOk = Math.abs(wishX) > 0.05 && groundAhead(Math.sign(wishX), 0)
        const zOk = Math.abs(wishZ) > 0.05 && groundAhead(0, Math.sign(wishZ))
        if (xOk && !zOk) wishZ = 0
        else if (zOk && !xOk) wishX = 0
        else if (!xOk && !zOk) { wishX *= -0.5; wishZ *= -0.5 }
        this.strafeDir *= -1
        this.strafeT = 0.9 // commit to the safer direction for a moment
      }
    }

    // obstacles: hop a knee-high wall when there's headroom; if truly wedged,
    // sidestep hard and re-roll the strafe instead of grinding the wall
    const moving = Math.hypot(this.ctrl.vel.x, this.ctrl.vel.z)
    const wants = Math.hypot(wishX, wishZ)
    let jump = false
    if (wants > 0.4 && this.ctrl.grounded) {
      const fx = wishX / wants
      const fz = wishZ / wants
      const knee = raycastWorld(this.ctrl.pos.x, this.ctrl.pos.y + 0.45, this.ctrl.pos.z, fx, 0, fz, 1.25, sys.sources)
      if (knee) {
        const head = raycastWorld(this.ctrl.pos.x, this.ctrl.pos.y + 1.7, this.ctrl.pos.z, fx, 0, fz, 1.6, sys.sources)
        if (!head) jump = true
      }
    }
    if (wants > 0.4 && moving < 0.7 && this.ctrl.grounded) this.stuckT += dt
    else this.stuckT = Math.max(0, this.stuckT - dt * 2)
    if (this.stuckT > 0.35) {
      jump = true
      if (this.stuckT > 0.9) {
        const a = Math.atan2(wishZ, wishX) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2
        wishX = Math.cos(a)
        wishZ = Math.sin(a)
        this.strafeDir *= -1
        this.stuckT = 0.4
      }
    }
    jump = jump || (this.ctrl.grounded && Math.random() < dt * 0.01)

    this.ctrl.step(dt, { x: wishX, z: wishZ }, jump, sys.sources)

    // face + animate
    if (this.avatar) {
      if (target) {
        this.avatar.targetYaw = Math.atan2(target.pos.x - this.ctrl.pos.x, target.pos.z - this.ctrl.pos.z)
      } else if (this.alertT > 0 && this.alert) {
        this.avatar.targetYaw = Math.atan2(this.alert.x - this.ctrl.pos.x, this.alert.z - this.ctrl.pos.z)
      } else if (moving > 0.6) {
        this.avatar.targetYaw = Math.atan2(this.ctrl.vel.x, this.ctrl.vel.z)
      }
      this.avatar.group.position.set(this.ctrl.pos.x, this.ctrl.pos.y, this.ctrl.pos.z)
      this.avatar.animate(dt, moving, this.ctrl.grounded, sys.time)
    }

    // ---- shoot: lead projectiles, fire in human bursts, mind the splash ----
    if (this.restT > 0) this.restT -= dt
    if (target && this.seenT > 0.45 - this.skill * 0.25 && this.cooldown <= 0 && this.restT <= 0) {
      const w = this.weapon
      const te = target.eye()
      let ax = te.x
      let ay = te.y - 0.4
      let az = te.z
      if (w.kind === 'projectile' && w.projectile) {
        // lead by flight time (skill scales how well), lob for gravity
        const tFly = bestD / w.projectile.speed
        const lead = Math.min(1.2, tFly) * (0.5 + this.skill * 0.55)
        ax += target.ctrl.vel.x * lead
        ay += target.ctrl.vel.y * lead * 0.5
        az += target.ctrl.vel.z * lead
        if (w.projectile.gravity) ay += -w.projectile.gravity * tFly * tFly * 0.45
        if (w.projectile.splash) ay = target.pos.y + 0.3 // rockets at the feet
      }
      let dir = new THREE.Vector3(ax - eye.x, ay - eye.y, az - eye.z).normalize()
      // sloppier against fast strafers, sharper against statues
      const targetSpeed = Math.hypot(target.ctrl.vel.x, target.ctrl.vel.z)
      dir = jitter(dir, this.aimErr * (0.75 + Math.min(1.2, targetSpeed / 7) * 0.6))
      const splashSelf = w.projectile?.splash ? bestD < w.projectile.splash + 2.5 : false
      if (!splashSelf && sys.fire(this, w, eye, dir)) {
        this.burstT += 1 / w.fireRate
        const burstFor = w.fireRate > 6 ? 0.7 + this.skill * 0.6 : w.fireRate > 2 ? 0.5 : 0.01
        if (this.burstT >= burstFor) {
          this.burstT = 0
          this.restT = (0.35 + Math.random() * 0.5) * (1.15 - this.skill * 0.6)
        }
      }
    }
  }
}

// ----------------------------------------------------------------- system --

interface Projectile {
  pos: THREE.Vector3
  vel: THREE.Vector3
  weapon: WeaponDef
  owner: CombatEntity
  life: number
  mesh: THREE.Mesh
}

interface BeamFx {
  mesh: THREE.Mesh
  ttl: number
  max: number
  width: number
}

interface Floater {
  sprite: THREE.Sprite
  ttl: number
  max: number
}

const sphereGeo = new THREE.SphereGeometry(1, 10, 8)
const beamGeo = new THREE.BoxGeometry(1, 1, 1)
const basicMats = new Map<string, THREE.MeshBasicMaterial>()
function basicMat(color: string): THREE.MeshBasicMaterial {
  let m = basicMats.get(color)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true })
    basicMats.set(color, m)
  }
  return m
}

/** floating damage number sprite (drifts up, fades out) */
function damageSprite(amount: number, headshot: boolean): THREE.Sprite {
  const text = String(Math.max(1, Math.round(amount)))
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const font = `900 ${headshot ? 64 : 52}px "Avenir Next", system-ui, sans-serif`
  g.font = font
  const w = Math.ceil(g.measureText(text).width) + 28
  c.width = w
  c.height = 80
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 9
  g.strokeStyle = 'rgba(12,10,8,0.85)'
  g.strokeText(text, w / 2, 40)
  g.fillStyle = headshot ? '#ffd166' : '#ffffff'
  g.fillText(text, w / 2, 40)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
  const s = headshot ? 0.012 : 0.009
  sprite.scale.set(w * s, 80 * s, 1)
  return sprite
}

export class CombatSystem {
  entities: CombatEntity[] = []
  sources: ColliderSource[]
  pickups: CombatPickup[] = []
  time = 0
  infiniteAmmo: boolean
  /** entities (bots included) falling below this Y die and respawn */
  killY = -40
  onKill: (info: KillInfo) => void = () => {}
  onSelfDamage: (hp: number, max: number) => void = () => {}
  onSelfRespawn: (at: Vec3) => void = () => {}
  onHitmarker: () => void = () => {}
  /** self ammo/weapons changed — re-render weapon bar + ammo counter */
  onLoadoutChange: () => void = () => {}
  onPickupToast: (msg: string) => void = () => {}
  /** optional event bus — combat publishes 'combat:*' / 'self:*' events here */
  events: EventBus | null = null

  private scene: THREE.Scene
  private fx: Particles
  private projectiles: Projectile[] = []
  private beams: BeamFx[] = []
  private floaters: Floater[] = []
  private cfgHealth: number
  private respawnSeconds: number
  private startIds: string[]

  constructor(opts: {
    scene: THREE.Scene
    fx: Particles
    sources: ColliderSource[]
    config: CombatConfig
    selfCtrl: CharacterController
    selfName: string
    selfTeam: string | null
    selfSpawns: Vec3[]
    selfAvatar: Avatar
  }) {
    this.scene = opts.scene
    this.fx = opts.fx
    this.sources = opts.sources
    this.cfgHealth = opts.config.health ?? 100
    this.respawnSeconds = opts.config.respawnSeconds ?? 2.5
    this.infiniteAmmo = !!opts.config.infiniteAmmo

    const weapons = (opts.config.weapons ?? DEFAULT_LOADOUT).map((w) =>
      typeof w === 'string' ? WEAPONS[w] ?? WEAPONS.sidearm : w,
    )
    const wanted = (opts.config.startWeapons ?? weapons.map((w) => w.id))
      .filter((id) => weapons.some((w) => w.id === id))
    this.startIds = wanted.length ? wanted : [weapons[0].id]

    opts.selfAvatar.enableHealthBar()
    const self = new CombatEntity({
      name: opts.selfName,
      team: opts.selfTeam,
      isBot: false,
      ctrl: opts.selfCtrl,
      avatar: opts.selfAvatar,
      health: this.cfgHealth,
      spawnPoints: opts.selfSpawns,
      weapons,
    })
    this.entities.push(self)
    this.assignSpawnLoadout(self)
  }

  get self(): CombatEntity { return this.entities[0] }

  /** fresh spawn kit: start weapons (+ a random extra for bots, for variety) */
  private assignSpawnLoadout(e: CombatEntity) {
    const ids = [...this.startIds]
    if (e.isBot) {
      const extras = e.weapons.filter((w) => !ids.includes(w.id))
      if (extras.length > 0 && Math.random() < 0.85) {
        ids.push(extras[Math.floor(Math.random() * extras.length)].id)
      }
      e.initLoadout(ids, this.infiniteAmmo ? 1 : 0.55 + Math.random() * 0.45)
    } else {
      e.initLoadout(ids, 1)
    }
  }

  spawnBot(opts: { name: string; team?: string | null; skill?: number; spawns: Vec3[]; shirt?: string }): CombatEntity {
    const ctrl = new CharacterController()
    // bots share movement params with the local player so tuning applies to all
    ctrl.walkSpeed = this.self.ctrl.walkSpeed * 0.92
    ctrl.gravity = this.self.ctrl.gravity
    ctrl.jumpVel = this.self.ctrl.jumpVel
    const spawn = opts.spawns[Math.floor(Math.random() * opts.spawns.length)]
    ctrl.teleport(v3(spawn.x + (Math.random() - 0.5), spawn.y, spawn.z + (Math.random() - 0.5)))
    const avatar = new Avatar(opts.name, 'bot:' + opts.name, opts.shirt)
    avatar.holdWeapon()
    avatar.enableHealthBar()
    this.scene.add(avatar.group)
    const bot = new CombatEntity({
      name: opts.name,
      team: opts.team ?? null,
      isBot: true,
      ctrl,
      avatar,
      health: this.cfgHealth,
      spawnPoints: opts.spawns,
      weapons: this.self.weapons,
      skill: opts.skill ?? 0.5,
    })
    this.entities.push(bot)
    this.assignSpawnLoadout(bot)
    return bot
  }

  hasLOS(a: Vec3, b: Vec3, dist: number): boolean {
    const dx = (b.x - a.x) / dist
    const dy = (b.y - a.y) / dist
    const dz = (b.z - a.z) / dist
    const hit = raycastWorld(a.x, a.y, a.z, dx, dy, dz, dist, this.sources)
    return !hit || hit.dist >= dist - 0.3
  }

  // ---------------------------------------------------------- pickups api --

  addPickup(p: CombatPickup) { this.pickups.push(p) }

  nearestPickup(from: Vec3, kind: PickupKind | null, maxDist: number): CombatPickup | null {
    let best: CombatPickup | null = null
    let bestD = maxDist
    for (const p of this.pickups) {
      if (!p.active) continue
      if (kind ? p.kind !== kind : p.kind === 'health') continue // null = supplies (weapon/ammo)
      const d = Math.hypot(p.pos.x - from.x, p.pos.z - from.z)
      if (d < bestD) { bestD = d; best = p }
    }
    return best
  }

  /** somewhere interesting to drift toward when a bot has nothing to do */
  wanderSpot(e: CombatEntity): Vec3 | null {
    const spots: Vec3[] = []
    for (const p of this.pickups) if (p.active) spots.push(p.pos)
    spots.push(...e.spawnPoints)
    if (spots.length === 0) return null
    const s = spots[Math.floor(Math.random() * spots.length)]
    return v3(s.x + (Math.random() - 0.5) * 4, s.y, s.z + (Math.random() - 0.5) * 4)
  }

  /** give a weapon (+pickup ammo). False if nothing was gained. */
  grantWeapon(e: CombatEntity, id: string): boolean {
    const idx = e.weapons.findIndex((w) => w.id === id)
    if (idx < 0) return false
    const w = e.weapons[idx]
    const had = e.owned.has(id)
    if (had && (w.ammoMax === undefined || (e.ammo[id] ?? 0) >= w.ammoMax)) return false
    e.owned.add(id)
    if (w.ammoMax !== undefined) {
      const gain = (w.ammoPickup ?? Math.ceil(w.ammoMax / 3)) * 2
      e.ammo[id] = Math.min(w.ammoMax, (had ? e.ammo[id] ?? 0 : 0) + gain)
    }
    // a fresh gun beats a dry one — equip it if the current weapon is empty or the sidearm
    if (!had && (!e.hasAmmo(e.weapon) || e.weapon.ammoMax === undefined)) e.weaponIdx = idx
    if (e === this.self) {
      audio.pickupWeapon()
      this.onPickupToast(had ? `${w.icon} ${w.name} ammo` : `${w.icon} Picked up ${w.name}!`)
      this.notifyLoadout()
    }
    return true
  }

  /** generic ammo crate: top up every owned finite weapon. False if all full. */
  grantAmmo(e: CombatEntity): boolean {
    let gained = false
    for (const w of e.weapons) {
      if (!e.owned.has(w.id) || w.ammoMax === undefined) continue
      const cur = e.ammo[w.id] ?? 0
      if (cur >= w.ammoMax) continue
      e.ammo[w.id] = Math.min(w.ammoMax, cur + (w.ammoPickup ?? Math.ceil(w.ammoMax / 3)))
      gained = true
    }
    if (gained && e === this.self) {
      audio.pickupAmmo()
      this.onPickupToast('📦 Ammo restocked')
      this.notifyLoadout()
    }
    return gained
  }

  /** heal up to `capTo` (default maxHealth — pass more for armor/overheal) */
  healEntity(e: CombatEntity, amount: number, capTo?: number): boolean {
    const cap = Math.max(e.maxHealth, capTo ?? e.maxHealth)
    if (!e.alive || e.health >= cap) return false
    e.health = Math.min(cap, e.health + amount)
    e.avatar?.setHealth(e.health / e.maxHealth)
    if (e === this.self) {
      audio.checkpoint()
      this.notifySelfHp(e.health, e.maxHealth)
    }
    return true
  }

  /** battle-royale infil: drop from the sky under a slow parachute fall */
  deploy(e: CombatEntity, at: Vec3) {
    e.ctrl.teleport(vclone(at))
    e.ctrl.vel.x = 0
    e.ctrl.vel.y = 0
    e.ctrl.vel.z = 0
    e.parachute = true
  }

  // ------------------------------------------------------------------ pvp --
  // Remote humans become damageable: the LOCAL player's shots also test the
  // interpolated remote-player hurtboxes; hits are CLAIMS sent to the server
  // (via the runtime), which rate/range-checks them, owns the hp ledger and
  // broadcasts the result. Incoming validated damage lands through
  // applyServerDamage() into the normal local damage pipeline. Bots never
  // shoot remote humans (their fire isn't server-validatable).

  /** injected by the runtime: live remote player positions (net.remotes) */
  remoteTargets: (() => Array<{ id: number; x: number; y: number; z: number }>) | null = null
  /** injected by the runtime: forward a hit claim to the server */
  onPvpHit: (claim: { victimNetId: number; weaponId: string; weaponName: string; damage: number; headshot: boolean }) => void = () => {}

  private remoteBox(r: { x: number; y: number; z: number }): Box {
    return {
      minX: r.x - 0.55, maxX: r.x + 0.55,
      minY: r.y, maxY: r.y + 2.28,
      minZ: r.z - 0.55, maxZ: r.z + 0.55,
    }
  }

  /** claim a PvP hit (local player only) + show the usual hit feedback */
  private claimPvpHit(weapon: WeaponDef, victimNetId: number, damage: number, headshot: boolean, at: THREE.Vector3) {
    this.onPvpHit({ victimNetId, weaponId: weapon.id, weaponName: weapon.name, damage: Math.round(damage), headshot })
    this.onHitmarker()
    audio.hitmarker()
    this.fx.burst(at, { count: 6, colors: ['#ff5d5d', '#ffd1d1'], speed: 2.5, life: 0.35, size: 0.22 })
  }

  /**
   * server-validated damage arriving for the LOCAL player. Routed through
   * the normal damage pipeline so health bar, vignette, death and respawn
   * all behave exactly like a bot hit.
   */
  applyServerDamage(amount: number, attackerName: string, weaponName: string, headshot: boolean) {
    if (!this.self.alive) return
    this.damage(this.self, amount, null, hazardWeapon(`${attackerName} · ${weaponName}`, '⚔'), headshot)
  }

  /** server says we died (authoritative even if local hp disagreed) */
  applyServerKill(attackerName: string, weaponName: string) {
    if (!this.self.alive) return
    this.damage(this.self, 1e9, null, hazardWeapon(`${attackerName} · ${weaponName}`, '⚔'))
  }

  // ------------------------------------------------------------- shooting --

  /**
   * fire a weapon — used by the local player (runtime) and by bots.
   * `muzzle` is a purely visual origin (the gun barrel): beams and projectiles
   * appear to leave the weapon while aim/hit math stays on the eye ray.
   */
  fire(owner: CombatEntity, weapon: WeaponDef, origin: Vec3, dir: THREE.Vector3, muzzle?: Vec3) {
    if (owner.cooldown > 0 || !owner.alive) return false
    if (!this.infiniteAmmo && owner.ammoOf(weapon) <= 0) {
      owner.cooldown = Math.max(owner.cooldown, 0.3)
      if (owner === this.self) {
        audio.dryFire()
        this.autoSwitch(owner)
      }
      return false
    }
    owner.cooldown = 1 / weapon.fireRate
    if (!this.infiniteAmmo && weapon.ammoMax !== undefined) {
      owner.ammo[weapon.id] = Math.max(0, (owner.ammo[weapon.id] ?? 0) - 1)
      if (owner === this.self) {
        this.notifyLoadout()
        if ((owner.ammo[weapon.id] ?? 0) <= 0) this.autoSwitch(owner)
      }
    }
    audio.shoot(weapon.sound)

    const pellets = weapon.pellets ?? 1
    for (let i = 0; i < pellets; i++) {
      const d = jitter(dir, weapon.spread ?? 0)
      if (weapon.kind === 'hitscan') this.hitscan(owner, weapon, origin, d, muzzle)
      else this.launchProjectile(owner, weapon, origin, d, muzzle)
    }
    return true
  }

  /** loadout changed for the local player: callback + event, one place */
  private notifyLoadout() {
    this.onLoadoutChange()
    this.events?.emit('self:loadout', {})
  }

  /** local player hp changed (hurt OR heal): callback + event, one place */
  private notifySelfHp(hp: number, max: number) {
    this.onSelfDamage(hp, max)
    this.events?.emit('self:damage', { hp, max })
  }

  /** current gun ran dry — swap to the best owned weapon that still shoots */
  private autoSwitch(e: CombatEntity) {
    if (e.hasAmmo(e.weapon)) return
    let best = -1
    let bestScore = -Infinity
    e.weapons.forEach((w, i) => {
      if (!e.owned.has(w.id) || !e.hasAmmo(w)) return
      const score = w.ammoMax === undefined ? 0 : w.damage * w.fireRate * (w.pellets ?? 1)
      if (score > bestScore) { bestScore = score; best = i }
    })
    if (best >= 0 && best !== e.weaponIdx) {
      e.weaponIdx = best
      if (e === this.self) this.onLoadoutChange()
    }
  }

  private hitscan(owner: CombatEntity, weapon: WeaponDef, origin: Vec3, dir: THREE.Vector3, muzzle?: Vec3) {
    const range = weapon.range ?? 120
    const wall = raycastWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, this.sources)
    let dist = wall ? wall.dist : range
    let victim: CombatEntity | null = null
    let hitY = 0
    for (const e of this.entities) {
      if (e === owner || !e.alive) continue
      if (owner.team !== null && e.team === owner.team) continue
      const d = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, e.box())
      if (d !== null && d < dist) {
        dist = d
        victim = e
        hitY = origin.y + dir.y * d
      }
    }

    // remote humans (PvP): only the local player's shots make claims
    let remoteVictim: { id: number; x: number; y: number; z: number } | null = null
    if (owner === this.self && this.remoteTargets) {
      for (const r of this.remoteTargets()) {
        const d = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, this.remoteBox(r))
        if (d !== null && d < dist) {
          dist = d
          victim = null // the remote is closer than any bot
          remoteVictim = r
          hitY = origin.y + dir.y * d
        }
      }
    }

    const end = new THREE.Vector3(origin.x + dir.x * dist, origin.y + dir.y * dist, origin.z + dir.z * dist)
    const beamFrom = muzzle
      ? new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z)
      : new THREE.Vector3(origin.x, origin.y - 0.12, origin.z)
    if (weapon.beamColor) this.addBeam(beamFrom, end, weapon.beamColor, weapon.beamWidth ?? 0.05)

    if (remoteVictim) {
      const headshot = weapon.id === 'sniper' && hitY > remoteVictim.y + 2.28 - 0.64
      this.claimPvpHit(weapon, remoteVictim.id, weapon.damage * (headshot ? 2 : 1), headshot, end)
      return
    }

    if (victim) {
      const headshot = weapon.id === 'sniper' && hitY > victim.box().maxY - 0.64
      this.damage(victim, weapon.damage * (headshot ? 2 : 1), owner, weapon, headshot)
      this.fx.burst(end, { count: 6, colors: ['#ff5d5d', '#ffd1d1'], speed: 2.5, life: 0.35, size: 0.22 })
    } else if (wall) {
      this.fx.burst(end, { count: 5, colors: [weapon.beamColor ?? '#ffffff'], speed: 2, life: 0.3, size: 0.18 })
    }
  }

  private launchProjectile(owner: CombatEntity, weapon: WeaponDef, origin: Vec3, dir: THREE.Vector3, muzzle?: Vec3) {
    const p = weapon.projectile!
    const mesh = new THREE.Mesh(sphereGeo, basicMat(p.color))
    mesh.scale.setScalar(p.radius)
    if (muzzle) mesh.position.set(muzzle.x + dir.x * 0.4, muzzle.y + dir.y * 0.4, muzzle.z + dir.z * 0.4)
    else mesh.position.set(origin.x + dir.x, origin.y + dir.y - 0.15, origin.z + dir.z)
    this.scene.add(mesh)
    this.projectiles.push({
      pos: mesh.position.clone(),
      vel: dir.clone().multiplyScalar(p.speed),
      weapon, owner,
      life: p.life ?? 3,
      mesh,
    })
  }

  private addBeam(a: THREE.Vector3, b: THREE.Vector3, color: string, width = 0.05) {
    const len = a.distanceTo(b)
    if (len < 0.1) return
    const mesh = new THREE.Mesh(beamGeo, basicMat(color).clone())
    mesh.scale.set(width, width, len)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.lookAt(b)
    this.scene.add(mesh)
    this.beams.push({ mesh, ttl: 0.09, max: 0.09, width })
  }

  damage(victim: CombatEntity, amount: number, attacker: CombatEntity | null, weapon: WeaponDef, headshot = false) {
    if (!victim.alive) return
    victim.health -= amount
    this.events?.emit('combat:damage', {
      victimId: victim.id, attackerId: attacker?.id ?? null, amount, headshot, weaponId: weapon.id,
    })

    // visible hit feedback: life bar shrinks + the body flashes red
    victim.avatar?.setHealth(Math.max(0, victim.health) / victim.maxHealth)
    victim.avatar?.hitFlash()

    // bots remember where the pain came from and go hunting
    if (attacker && attacker !== victim && victim.isBot) {
      victim.alert = vclone(attacker.pos)
      victim.alertT = 4
    }

    if (attacker === this.self && victim !== this.self) {
      this.onHitmarker()
      audio.hitmarker()
      this.spawnFloater(victim, amount, headshot)
    }
    if (victim === this.self) {
      audio.hurt()
      this.notifySelfHp(Math.max(0, victim.health), victim.maxHealth)
    }
    if (victim.health <= 0) {
      victim.alive = false
      victim.respawnIn = this.respawnSeconds
      victim.avatar?.setVisible(false)
      const at = victim.pos
      this.fx.burst(new THREE.Vector3(at.x, at.y + 1, at.z), {
        count: 30, colors: [victim.avatar?.shirtColor ?? '#fff', '#f2c84b', '#ff8a8a'], speed: 6.5, life: 0.9,
      })
      if (attacker === this.self) audio.killConfirm()
      if (victim === this.self) audio.death()
      this.events?.emit('combat:kill', {
        victimId: victim.id, killerId: attacker?.id ?? null, weapon: weapon.name, headshot,
      })
      this.onKill({ killer: attacker, victim, weapon: weapon.name, headshot })
    }
  }

  /** floating damage number above the victim — you SEE every hit land */
  private spawnFloater(victim: CombatEntity, amount: number, headshot: boolean) {
    const sprite = damageSprite(amount, headshot)
    const b = victim.box()
    sprite.position.set(
      victim.pos.x + (Math.random() - 0.5) * 0.7,
      b.maxY + 0.25 + Math.random() * 0.3,
      victim.pos.z + (Math.random() - 0.5) * 0.7,
    )
    this.scene.add(sprite)
    this.floaters.push({ sprite, ttl: 0.75, max: 0.75 })
    if (this.floaters.length > 24) {
      const old = this.floaters.shift()!
      this.disposeFloater(old)
    }
  }

  private disposeFloater(f: Floater) {
    this.scene.remove(f.sprite)
    f.sprite.material.map?.dispose()
    f.sprite.material.dispose()
  }

  update(dt: number, t: number) {
    this.time = t

    // kill plane — applies to EVERYONE, not just the local player. Without
    // this, a bot that walks off the map falls forever and can never be
    // fought again.
    for (const e of this.entities) {
      if (e.alive && e.pos.y < this.killY) this.damage(e, 1e9, null, FALL_WEAPON)
    }

    // parachutes: clamp fall speed until touchdown
    for (const e of this.entities) {
      if (!e.parachute) continue
      if (e.ctrl.grounded) e.parachute = false
      else e.ctrl.vel.y = Math.max(e.ctrl.vel.y, -7.5)
    }

    // respawns
    for (const e of this.entities) {
      e.cooldown = Math.max(0, e.cooldown - dt)
      if (!e.alive) {
        e.respawnIn -= dt
        if (e.respawnIn <= 0) {
          const sp = e.spawnPoints[Math.floor(Math.random() * e.spawnPoints.length)] ?? v3(0, 5, 0)
          e.ctrl.teleport(vclone(sp))
          e.health = e.maxHealth
          e.alive = true
          e.carrying = null
          e.avatar?.setVisible(true)
          e.avatar?.setHealth(1)
          this.assignSpawnLoadout(e) // you re-arm at spawn; go find the good guns
          this.events?.emit('combat:respawn', { entityId: e.id, at: vclone(sp) })
          if (!e.isBot) {
            this.onSelfRespawn(sp)
            this.notifySelfHp(e.health, e.maxHealth)
            this.notifyLoadout()
          }
        }
      }
    }

    // pickups: anyone alive (bots too) can grab them
    for (const pk of this.pickups) {
      if (!pk.active) {
        if (pk.respawnAfter > 0) {
          pk.respawnIn -= dt
          if (pk.respawnIn <= 0) {
            pk.active = true
            pk.setVisible(true)
          }
        }
        continue
      }
      for (const e of this.entities) {
        if (!e.alive) continue
        const dx = e.pos.x - pk.pos.x
        const dy = e.pos.y + 0.9 - pk.pos.y
        const dz = e.pos.z - pk.pos.z
        if (dx * dx + dz * dz > 1.7 * 1.7 || Math.abs(dy) > 2.6) continue
        let took = false
        if (pk.kind === 'weapon') took = this.grantWeapon(e, pk.weaponId!)
        else if (pk.kind === 'ammo') took = this.grantAmmo(e)
        else took = this.healEntity(e, pk.heal ?? 35)
        if (took) {
          pk.active = false
          pk.respawnIn = pk.respawnAfter
          pk.setVisible(false)
          this.events?.emit('combat:pickup', { entityId: e.id, kind: pk.kind, weaponId: pk.weaponId })
          break
        }
      }
    }

    // bot brains
    for (const e of this.entities) {
      if (e.isBot) e.think(dt, this)
    }

    // body blocking — entities shove each other apart so you can actually
    // bump into a bot instead of ghosting through it
    for (let i = 0; i < this.entities.length; i++) {
      const a = this.entities[i]
      if (!a.alive) continue
      for (let j = i + 1; j < this.entities.length; j++) {
        const b = this.entities[j]
        if (!b.alive) continue
        if (a.pos.y >= b.pos.y + b.ctrl.height || b.pos.y >= a.pos.y + a.ctrl.height) continue
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const minD = a.ctrl.halfW + b.ctrl.halfW + 0.06
        const d = Math.hypot(dx, dz)
        if (d >= minD) continue
        const nx = d > 1e-4 ? dx / d : 1
        const nz = d > 1e-4 ? dz / d : 0
        const push = (minD - d) / 2
        a.pos.x -= nx * push; a.pos.z -= nz * push
        b.pos.x += nx * push; b.pos.z += nz * push
      }
    }

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]
      pr.life -= dt
      const p = pr.weapon.projectile!
      if (p.gravity) pr.vel.y += p.gravity * dt
      pr.pos.addScaledVector(pr.vel, dt)
      pr.mesh.position.copy(pr.pos)
      if (pr.weapon.id === 'rockets') {
        this.fx.burst(pr.pos, { count: 1, colors: ['#ffb46b', '#8a8a8a'], speed: 0.6, life: 0.4, size: 0.22, gravity: 1 })
      }

      let exploded = pr.life <= 0
      let directHit: CombatEntity | null = null

      if (!exploded) {
        // entity hit?
        for (const e of this.entities) {
          if (e === pr.owner || !e.alive) continue
          if (pr.owner.team !== null && e.team === pr.owner.team) continue
          const b = e.box()
          const r = p.radius
          if (
            pr.pos.x > b.minX - r && pr.pos.x < b.maxX + r &&
            pr.pos.y > b.minY - r && pr.pos.y < b.maxY + r &&
            pr.pos.z > b.minZ - r && pr.pos.z < b.maxZ + r
          ) {
            exploded = true
            directHit = e
            break
          }
        }
      }
      if (!exploded) {
        // world hit?
        const boxes: Box[] = []
        const r = p.radius
        for (const s of this.sources) {
          s.collect(pr.pos.x - r, pr.pos.y - r, pr.pos.z - r, pr.pos.x + r, pr.pos.y + r, pr.pos.z + r, boxes)
        }
        if (boxes.length > 0) exploded = true
      }

      // remote humans: direct projectile hits become PvP claims (self only)
      if (!exploded && pr.owner === this.self && this.remoteTargets) {
        for (const r of this.remoteTargets()) {
          const b = this.remoteBox(r)
          const rr = p.radius
          if (
            pr.pos.x > b.minX - rr && pr.pos.x < b.maxX + rr &&
            pr.pos.y > b.minY - rr && pr.pos.y < b.maxY + rr &&
            pr.pos.z > b.minZ - rr && pr.pos.z < b.maxZ + rr
          ) {
            exploded = true
            this.claimPvpHit(pr.weapon, r.id, pr.weapon.damage, false, pr.pos)
            break
          }
        }
      }

      if (exploded) {
        if (directHit) this.damage(directHit, pr.weapon.damage, pr.owner, pr.weapon)
        if (p.splash && pr.owner === this.self && this.remoteTargets) {
          // splash also reaches remote humans (reduced like self-splash isn't)
          for (const r of this.remoteTargets()) {
            const d = Math.hypot(r.x - pr.pos.x, r.y + 0.9 - pr.pos.y, r.z - pr.pos.z)
            if (d < p.splash) {
              const dmg = pr.weapon.damage * (1 - d / p.splash)
              if (dmg > 1) this.claimPvpHit(pr.weapon, r.id, dmg, false, pr.pos)
            }
          }
        }
        if (p.splash) {
          audio.explosion()
          this.fx.burst(pr.pos, { count: 40, colors: ['#ffb46b', '#ff6b4a', '#fff1c4'], speed: 9, life: 0.7, size: 0.5 })
          for (const e of this.entities) {
            if (!e.alive) continue
            const ex = e.pos.x - pr.pos.x
            const ey = e.pos.y + 0.9 - pr.pos.y
            const ez = e.pos.z - pr.pos.z
            const d = Math.hypot(ex, ey, ez)
            if (d < p.splash) {
              const k = 1 - d / p.splash
              // knockback — aim a rocket at your feet and you've got a rocket jump
              const kb = 14 * k
              e.ctrl.vel.x += (ex / (d || 1)) * kb
              e.ctrl.vel.y += Math.abs(ey / (d || 1)) * kb + 4 * k
              e.ctrl.vel.z += (ez / (d || 1)) * kb
              const friendly = pr.owner.team !== null && e.team === pr.owner.team && e !== pr.owner
              if (!friendly && e !== directHit) {
                const dmg = pr.weapon.damage * k * (e === pr.owner ? 0.4 : 1)
                if (dmg > 1) this.damage(e, dmg, pr.owner, pr.weapon)
              }
            }
          }
        } else {
          this.fx.burst(pr.pos, { count: 6, colors: [p.color], speed: 2.5, life: 0.3, size: 0.2 })
        }
        this.scene.remove(pr.mesh)
        this.projectiles.splice(i, 1)
      }
    }

    // beams fade
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]
      b.ttl -= dt
      const k = Math.max(0, b.ttl / b.max)
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = k
      b.mesh.scale.x = b.width * (0.4 + k)
      b.mesh.scale.y = b.width * (0.4 + k)
      if (b.ttl <= 0) {
        ;(b.mesh.material as THREE.Material).dispose()
        this.scene.remove(b.mesh)
        this.beams.splice(i, 1)
      }
    }

    // damage numbers drift up + fade
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]
      f.ttl -= dt
      f.sprite.position.y += dt * 1.5
      f.sprite.material.opacity = Math.min(1, (f.ttl / f.max) * 2)
      if (f.ttl <= 0) {
        this.disposeFloater(f)
        this.floaters.splice(i, 1)
      }
    }
  }

  dispose() {
    for (const pr of this.projectiles) this.scene.remove(pr.mesh)
    for (const b of this.beams) this.scene.remove(b.mesh)
    for (const f of this.floaters) this.disposeFloater(f)
    for (const e of this.entities) {
      if (e.isBot && e.avatar) e.avatar.dispose()
    }
    this.projectiles = []
    this.beams = []
    this.floaters = []
  }
}

function jitter(dir: THREE.Vector3, amount: number): THREE.Vector3 {
  if (amount <= 0) return dir.clone()
  const d = dir.clone()
  d.x += (Math.random() - 0.5) * 2 * amount
  d.y += (Math.random() - 0.5) * 2 * amount
  d.z += (Math.random() - 0.5) * 2 * amount
  return d.normalize()
}
