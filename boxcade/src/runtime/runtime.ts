// The Blobcade runtime: takes a GameDef from the SDK and runs it. One call:
//   const session = await runGame(def, mountEl, playerName)
// runGame is the COMPOSITION ROOT: it builds the engine objects, wires the
// internal runtime systems (systems/ — HUD shell, chat, pause, build mode,
// combat HUD, all on the GameSystem lifecycle), hands games a GameContext,
// and runs the frame loop, calling each system at its fixed point in the
// frame. Gameplay-order-coupled subsystems (vehicles, remote avatars/LOD,
// voxel co-build sync) stay inline here on purpose.

import * as THREE from 'three'
import { Renderer } from '../engine/renderer'
import { Input } from '../engine/input'
import { CameraRig } from '../engine/camera'
import { CharacterController, overlapsAny, type Box, type ColliderSource } from '../engine/physics'
import { Vehicle, PARKED_INPUT, VEHICLE_SPECS, type VehicleEnv, type VehicleInput, type VehicleType } from '../engine/vehicle'
import { buildVehicleMesh } from '../engine/vehiclemesh'
import { PartsWorld, type RuntimePart, behaviors } from '../engine/world'
import { Avatar } from '../engine/avatar'
import { Particles } from '../engine/fx'
import { Net, type RemotePlayer } from '../engine/network'
import { VoxelWorld, GRASS, DIRT, STONE, SAND, WOOD, PLANK, BRICK, GLOW } from '../engine/voxel'
import { audio } from '../engine/audio'
import { economy } from '../engine/economy'
import { CombatSystem, FALL_WEAPON, WEAPONS, hazardWeapon, registerWeapon, type CombatEntity } from '../engine/combat'
import { ViewModel } from '../engine/viewmodel'
import { v3, vclone, type Vec3 } from '../engine/math'
import { EventBus } from '../engine/events'
import { attachTouchControls } from '../engine/touch'
import { createGameStore, type GameStoreEquipped } from './store'
import { escapeHtml } from './dom'
import { createHudSystem } from './systems/hud'
import { createChatSystem } from './systems/chat'
import { createPauseSystem } from './systems/pause'
import { createBuildModeSystem } from './systems/buildmode'
import { createCombatHudSystem, type CombatHudSystem } from './systems/combathud'
import '../engine/touch.css'
import type { GameDef, GameContext, WorldBuilder, SdkPart, PartHandle, PlayerApi, EntityApi, PhysicsConfig, EngineServices } from '../sdk'

export interface GameSession {
  dispose(): void
}

export interface RunGameOptions {
  /**
   * Platform hook: persist an edited voxel world (the pause menu's "Save to
   * My Games"). Receives VoxelWorld.serialize() JSON; an optional returned
   * string becomes the confirmation toast. Injected by the shell so the
   * runtime stays storage-agnostic.
   */
  onSaveWorld?: (worldJson: string) => string | void
  /**
   * Multiplayer join spec. Defaults to def.meta.id (auto-assigned instance).
   * Append '#CODE' to join a specific room; shared/published games pass a
   * doc-hash-keyed spec so players on the same doc version group together.
   */
  roomKey?: string
  /** fired when the player WINS (win pad / win rule) with the run time in seconds */
  onVictory?: (timeSeconds: number) => void
  /**
   * Platform hook: a portal was touched / a `goTo` rule fired. Receives the
   * raw target string (`g:<id>` | `draft:<key>` | `level:<n>` | `home` | the
   * code-game `play:<id>` form). Injected by the shell so the runtime stays
   * router-agnostic. The runtime debounces rapid re-fires (≈1s).
   */
  onGoToGame?: (target: string) => void
  /**
   * Platform hook: the player bought a per-game store item (GameServices).
   * The shell credits the creator on published games (server 30% cut).
   */
  onStoreBuy?: (item: import('../sdk').StoreItemDef) => void
}

const DEFAULT_PALETTE = [GRASS, DIRT, STONE, SAND, WOOD, PLANK, BRICK, GLOW]
const REMOTE_LOD_DISTANCE = 40
const REMOTE_LOD_DISTANCE2 = REMOTE_LOD_DISTANCE * REMOTE_LOD_DISTANCE
const REMOTE_SHADOW_CAP = 24

export async function runGame(def: GameDef, mount: HTMLElement, playerName: string, opts: RunGameOptions = {}): Promise<GameSession> {
  mount.innerHTML = ''
  mount.className = 'game-shell'

  // platform services — everything defaults ON; games opt out via def.services
  const services = {
    chat: def.services?.chat !== false,
    leaderboard: def.services?.leaderboard !== false,
    store: def.services?.store ?? [],
  }

  // ---------- HUD shell + chat (internal systems) ----------
  // chat mounts its box into hudEl right after the shell so HUD DOM order is
  // exactly what it always was; engine deps arrive as thunks (they're created
  // further down and only touched on user interaction)
  const hudSys = createHudSystem(mount, def)
  const hud = hudSys.api
  const chatSys = createChatSystem({
    hudEl: hudSys.hudEl,
    enabled: services.chat,
    playerName,
    getInput: () => input,
    getNet: () => net,
    say: (text) => selfAvatar.say(text),
  })

  // ---------- engine objects ----------
  let lightingPreset = 'noon'
  let spawnPoint: Vec3 = v3(0, 6, 0)
  let killY = -30
  let voxels: VoxelWorld | null = null
  let voxelPalette: number[] = DEFAULT_PALETTE
  let mapPhysics: PhysicsConfig = {}

  const pendingParts: SdkPart[] = []
  const pendingLabels: Array<{ text: string; at: Vec3; scale: number; color: string }> = []
  const pendingHealthPacks: Vec3[] = []
  const pendingWeaponSpawns: Array<{ at: Vec3; weaponId: string }> = []
  const pendingAmmoSpawns: Vec3[] = []
  const pendingLights: Array<{ at: Vec3; color: string; intensity: number; range: number }> = []
  const pendingVehicles: Array<{ type: import('../sdk').VehicleType; at: Vec3; opts: import('../sdk').VehicleOptions }> = []

  // World builder runs first so we know the lighting preset before creating the renderer.
  const builder: WorldBuilder = {
    lighting(p) { lightingPreset = p },
    spawn(at) { spawnPoint = vclone(at) },
    killY(y) { killY = y },
    add(d) { pendingParts.push(d); return makePendingHandle(d) },
    label(text, at, scale = 1, color = '#ffffff') { pendingLabels.push({ text, at, scale, color }) },
    checkpoint(at, index, size = v3(4, 0.6, 4)) {
      pendingParts.push({
        at, size, color: '#39d98a', material: 'neon',
        onTouch: (ctx) => {
          ctx.player.setCheckpoint(v3(at.x, at.y + size.y / 2 + 0.1, at.z))
          ctx.hud.toast(`✅ Checkpoint ${index}`)
          ctx.events.emit('player:checkpoint', { index })
          audio.checkpoint()
        },
      })
    },
    lava(at, size) {
      pendingParts.push({
        at, size, color: '#ff5a1f', material: 'lava', collide: false,
        onTouch: (ctx) => ctx.player.kill(),
      })
    },
    coin(at) {
      pendingParts.push({
        at, size: v3(0.9, 0.9, 0.25), color: '#ffc94d', material: 'gold', collide: false,
        behavior: [behaviors.spin(2.6), behaviors.bob(0.25, 2.2, at.x + at.z)],
        touchOnce: true,
        onTouch: (ctx) => ctx.award(1),
      })
    },
    winPad(at, size = v3(6, 1, 6), onWin) {
      pendingParts.push({
        at, size, color: '#ffc94d', material: 'gold',
        onTouch: (ctx) => {
          ctx.celebrate('🏆 YOU WIN!')
          ctx.earnBlobcash(25, 'victory')
          onWin?.(ctx)
        },
      })
    },
    bouncePad(at, power = 24, size = v3(3, 0.7, 3)) {
      pendingParts.push({ at, size, color: '#06d6a0', material: 'neon', bounce: power })
    },
    tree(at, scale = 1) {
      const s = scale
      pendingParts.push({ at: v3(at.x, at.y + 1.5 * s, at.z), size: v3(0.8 * s, 3 * s, 0.8 * s), color: '#74512f', material: 'wood' })
      pendingParts.push({ at: v3(at.x, at.y + 3.6 * s, at.z), size: v3(3 * s, 2.2 * s, 3 * s), color: '#3f9e35', material: 'grass', collide: false })
      pendingParts.push({ at: v3(at.x, at.y + 5.0 * s, at.z), size: v3(1.9 * s, 1.3 * s, 1.9 * s), color: '#4cb53f', material: 'grass', collide: false })
    },
    cloud(at, scale = 1) {
      const s = scale
      pendingParts.push({
        at, size: v3(7 * s, 1.6 * s, 4 * s), color: '#ffffff', material: 'plastic', collide: false,
        behavior: behaviors.bob(0.5, 7, at.x * 0.3),
      })
    },
    spinnerHazard(center, radius, count = 3, period = 3.2) {
      for (let i = 0; i < count; i++) {
        pendingParts.push({
          at: vclone(center), size: v3(1.6, 1.6, 1.6), color: '#ff3b3b', material: 'neon', collide: false,
          behavior: behaviors.orbit(center, radius, period, (i / count) * Math.PI * 2),
          onTouch: (ctx) => ctx.player.kill(),
        })
      }
    },
    healthPack(at) {
      pendingHealthPacks.push(vclone(at))
    },
    weaponSpawn(at, weaponId) {
      pendingWeaponSpawns.push({ at: vclone(at), weaponId })
    },
    ammoSpawn(at) {
      pendingAmmoSpawns.push(vclone(at))
    },
    light(at, opts = {}) {
      pendingLights.push({
        at: vclone(at),
        color: opts.color ?? '#ffffff',
        intensity: opts.intensity ?? 90,
        range: opts.range ?? 32,
      })
    },
    portal(at, target, label) {
      // mirrors interpret.ts's 'portal' visual: a neon frame + an inner glass
      // pane (decor) + an optional floating label + a thin walk-through touch
      // slab that asks the host to navigate when the player steps through.
      const frame = v3(2.6, 3.2, 0.4)
      pendingParts.push({ at: vclone(at), size: frame, color: '#8a5cff', material: 'neon', collide: false })
      pendingParts.push({
        at: vclone(at),
        size: v3(frame.x - 0.6, frame.y - 0.6, 0.12),
        color: '#c4b5ff', material: 'glass', collide: false,
      })
      if (label) pendingLabels.push({ text: label, at: v3(at.x, at.y + frame.y / 2 + 0.6, at.z), scale: 0.8, color: '#c4b5ff' })
      pendingParts.push({
        at: vclone(at),
        size: v3(frame.x - 0.4, frame.y - 0.4, 0.6),
        color: '#8a5cff', material: 'glass', collide: false,
        onTouch: (ctx) => ctx.events.emit('platform:goToGame', { target }),
      })
    },
    physics(cfg) {
      mapPhysics = { ...mapPhysics, ...cfg }
    },
    vehicle(type, at, opts = {}) {
      pendingVehicles.push({ type, at: vclone(at), opts })
    },
    voxelIsland(opts = {}) {
      if (opts.data) {
        voxels = VoxelWorld.deserialize(opts.data)
      } else {
        const size = opts.size ?? 96
        voxels = new VoxelWorld(size, 42, size, 10)
        voxels.generateIsland(opts.seed ?? 20260609)
      }
      if (opts.palette) voxelPalette = opts.palette
      const vw = voxels as VoxelWorld
      const cx = Math.floor(vw.sx / 2)
      const cz = Math.floor(vw.sz / 2)
      spawnPoint = v3(cx + 0.5, vw.surfaceY(cx, cz) + 0.2, cz + 0.5)
    },
  }

  // handles for parts created before the world exists
  const handleMap = new Map<SdkPart, RuntimePart>()
  function makePendingHandle(d: SdkPart): PartHandle {
    return {
      get pos() {
        const rp = handleMap.get(d)
        return rp ? rp.pos : d.at
      },
      remove() {
        const rp = handleMap.get(d)
        if (rp) parts.remove(rp)
      },
    }
  }

  // a game's custom weapons join the registry before anything references them
  for (const w of def.weapons ?? []) registerWeapon(w)

  def.build(builder)

  // ---------- scene ----------
  const R = new Renderer(mount, lightingPreset)
  mount.appendChild(hudSys.hudEl) // keep HUD above the canvas
  if (hudSys.loadingEl.parentElement) mount.appendChild(hudSys.loadingEl)

  const parts = new PartsWorld()
  R.scene.add(parts.group)
  const fx = new Particles(R.scene)
  if (voxels) {
    const vw = voxels as VoxelWorld
    vw.buildAll()
    R.scene.add(vw.group)
  }

  const input = new Input(R.renderer.domElement)
  const rig = new CameraRig(def.camera ?? 'orbit')
  const char = new CharacterController()
  const events = new EventBus() // engine systems publish here; games subscribe

  // portal / `goTo` navigation: touching a portal slab emits this every frame
  // it overlaps, so debounce (~1s) and hand the target to the shell once.
  let lastGoTo = 0
  if (opts.onGoToGame) {
    events.on('platform:goToGame', (payload) => {
      const now = performance.now()
      if (now - lastGoTo < 1000) return
      lastGoTo = now
      const target = (payload as { target?: unknown }).target
      if (typeof target === 'string') opts.onGoToGame!(target)
    })
  }

  // movement tuning: engine defaults ← GameDef.physics ← text-map @directives
  const phys = { ...def.physics, ...mapPhysics }
  if (phys.gravity !== undefined) char.gravity = phys.gravity
  if (phys.jumpVel !== undefined) char.jumpVel = phys.jumpVel
  if (phys.walkSpeed !== undefined) char.walkSpeed = phys.walkSpeed
  char.teleport(spawnPoint)

  const sources: ColliderSource[] = [parts]
  if (voxels) sources.push(voxels)

  const teamColors: Record<string, string> = { red: '#e74c3c', blue: '#3b82f6' }
  const selfShirt = def.combat?.selfTeam
    ? teamColors[def.combat.selfTeam] ?? undefined
    : economy.equippedShirtColor()
  const selfAvatar = new Avatar(playerName, playerName + ':self', selfShirt)
  selfAvatar.setCosmetics({
    hat: economy.equippedHat()?.id ?? null,
    hatColor: economy.equippedHat()?.color,
    face: economy.equippedFace(),
  })
  R.scene.add(selfAvatar.group)

  // phones/tablets: virtual joystick + look + jump/fire (no-op on desktop)
  const touch = attachTouchControls(input, mount, { combat: !!def.combat, fp: def.camera === 'fp' })

  // ---------- game context ----------
  let checkpoint = vclone(spawnPoint)
  let coins = 0
  let started = performance.now()
  let disposed = false

  // per-game store (GameServices.store): buy/equip creator-priced recolors
  let storeEq: GameStoreEquipped = {}
  const gameStore = services.store.length > 0
    ? createGameStore({
        gameId: def.meta.id,
        items: services.store,
        mount: hudSys.hudEl,
        toast: (m) => hud.toast(m),
        onChange: (eq) => {
          storeEq = eq
          selfAvatar.setShirtColor(eq.shirt?.color ?? selfShirt ?? selfAvatar.shirtColor)
          hud.set('blobcash', `B$ ${economy.balance}`)
        },
        onBuy: (item) => opts.onStoreBuy?.(item),
      })
    : null
  if (gameStore) hudSys.hudTop.appendChild(gameStore.button)

  // ---------- combat system + combat HUD ----------
  let combat: CombatSystem | null = null
  let chud: CombatHudSystem | null = null
  let selfSpawnPool: Vec3[] = [vclone(spawnPoint)]
  let scoped = false
  let viewmodel: ViewModel | null = null

  if (def.combat) {
    combat = new CombatSystem({
      scene: R.scene,
      fx,
      sources,
      config: def.combat,
      selfCtrl: char,
      selfName: playerName,
      selfTeam: def.combat.selfTeam ?? null,
      selfSpawns: selfSpawnPool,
      selfAvatar,
    })
    combat.killY = killY // bots fall to their death too — nobody falls forever
    combat.events = events

    if (def.camera === 'fp') {
      viewmodel = new ViewModel(R.camera)
      viewmodel.equip(combat.self.weapon)
    }

    chud = createCombatHudSystem({ hudEl: hudSys.hudEl, mount, combat, fp: def.camera === 'fp' })
    const ch = chud

    combat.onLoadoutChange = () => ch.renderWeaponBar()
    combat.onPickupToast = (msg) => hud.toast(msg)
    combat.onSelfDamage = (hp, max) => {
      ch.updateHealth(hp, max)
      if (hp < combatLastHp) ch.damageVignette()
      combatLastHp = hp
    }
    combat.onHitmarker = () => ch.hitmarker()
    combat.onSelfRespawn = () => {
      ch.hideRespawnOverlay()
      combatLastHp = combat!.self.maxHealth
    }
    combat.onKill = (info) => {
      const kn = info.killer ? info.killer.name : '☠'
      const icon = info.headshot ? '🎯' : '⚔'
      ch.addKillLine(`<b>${escapeHtml(kn)}</b> ${icon} ${escapeHtml(info.victim.name)}`)
      if (info.killer === combat!.self) {
        const blobcash = info.headshot ? 15 : 10
        economy.earn(blobcash, 'kill')
        hud.set('blobcash', `B$ ${economy.balance}`)
      }
      if (info.victim === combat!.self) {
        ch.showRespawnOverlay()
      }
      def.onKill?.(ctx, {
        killerId: info.killer?.id ?? null,
        killerName: info.killer?.name ?? null,
        killerTeam: info.killer?.team ?? null,
        killerIsSelf: info.killer === combat!.self,
        victimId: info.victim.id,
        victimName: info.victim.name,
        victimTeam: info.victim.team,
        victimIsSelf: info.victim === combat!.self,
        weapon: info.weapon,
        headshot: info.headshot,
      })
    }
  }
  let combatLastHp = combat?.self.health ?? 100
  let shownWeaponIdx = combat?.self.weaponIdx ?? 0

  function entApi(e: CombatEntity): EntityApi {
    return {
      get id() { return e.id },
      get name() { return e.name },
      get team() { return e.team },
      get isBot() { return e.isBot },
      get isSelf() { return combat?.self === e },
      get position() { return vclone(e.pos) },
      get health() { return e.health },
      get alive() { return e.alive },
      get carrying() { return e.carrying },
      set carrying(v: string | null) { e.carrying = v },
      setObjective(at) { e.objective = at ? vclone(at) : null },
      teleport(at) { e.ctrl.teleport(vclone(at)) },
      respawn() {
        e.alive = false
        e.respawnIn = 0.01
        e.avatar?.setVisible(false)
      },
      giveWeapon(weaponId) { return combat ? combat.grantWeapon(e, weaponId) : false },
      giveAmmo() { return combat ? combat.grantAmmo(e) : false },
      heal(n, capTo) { return combat ? combat.healEntity(e, n, capTo) : false },
      hurt(n, cause, causeIcon) {
        combat?.damage(e, n, null, cause ? hazardWeapon(cause, causeIcon) : FALL_WEAPON)
      },
      deploy(at) { combat?.deploy(e, vclone(at)) },
    }
  }

  const player: PlayerApi = {
    get name() { return playerName },
    get position() { return vclone(char.pos) },
    get velocity() { return vclone(char.vel) },
    kill() {
      if (combat) {
        if (combat.self.alive) combat.damage(combat.self, 1e6, null, FALL_WEAPON)
        return
      }
      audio.death()
      hudSys.deathFlash()
      fx.burst(new THREE.Vector3(char.pos.x, char.pos.y + 1, char.pos.z), {
        count: 26, colors: [selfAvatar.shirtColor, '#f2c84b', '#ffffff'], speed: 6, life: 0.8,
      })
      char.teleport(checkpoint)
      def.onRespawn?.(ctx)
    },
    respawn() {
      char.teleport(checkpoint)
      def.onRespawn?.(ctx)
    },
    setCheckpoint(at) { checkpoint = vclone(at) },
    teleport(at) { char.teleport(at) },
    launch(v) {
      char.vel.x += v.x
      char.vel.y += v.y
      char.vel.z += v.z
    },
  }

  const net = new Net()

  // engine services facade — the SDK's "power API" (live instances, not copies)
  const engineServices: EngineServices = {
    renderer: R, parts, fx, net, input, player: char, audio, events,
    get voxels() { return voxels },
    get combat() { return combat },
  }

  const ctx: GameContext = {
    player,
    hud,
    events,
    engine: engineServices,
    get time() { return (performance.now() - started) / 1000 },
    get playersOnline() { return 1 + net.remotes.size },
    get coins() { return coins },
    award(n) {
      coins += n
      audio.coin()
      hud.set('coins', `🪙 ${coins}`)
      economy.earn(n, 'coins') // coins feed the platform economy 1:1
      events.emit('player:coin', { total: coins })
      fx.burst(new THREE.Vector3(char.pos.x, char.pos.y + 1.4, char.pos.z), {
        count: 10, colors: ['#ffc94d', '#fff3c4'], speed: 3, life: 0.5, gravity: -4, size: 0.3,
      })
    },
    get blobcash() { return economy.balance },
    earnBlobcash(n, reason) {
      economy.earn(n, reason)
      hud.set('blobcash', `B$ ${economy.balance}`)
      if (n >= 50) hud.toast(`B$ +${n} Blobcash${reason ? ` — ${reason}` : ''}`)
      // win pads and `win` rule actions both award with this reason — the
      // shell hooks it for leaderboards (best win time)
      if (reason === 'victory' && services.leaderboard) opts.onVictory?.((performance.now() - started) / 1000)
    },
    get entities() {
      return combat ? combat.entities.map(entApi) : []
    },
    spawnBot(opts) {
      if (!combat) throw new Error('spawnBot requires GameDef.combat')
      const bot = combat.spawnBot({
        name: opts.name,
        team: opts.team ?? null,
        skill: opts.skill,
        spawns: opts.spawns,
        shirt: opts.shirt ?? (opts.team ? teamColors[opts.team] : undefined),
      })
      return entApi(bot)
    },
    setSpawnPoints(points) {
      if (points.length === 0) return
      selfSpawnPool.length = 0
      for (const p of points) selfSpawnPool.push(vclone(p))
      checkpoint = vclone(points[0])
      if (combat) combat.self.spawnPoints = selfSpawnPool
    },
    celebrate(msg = '🎉 NICE!') {
      hud.big(msg, 3400)
      audio.win()
      events.emit('game:celebrate', { msg })
      fx.confetti(new THREE.Vector3(char.pos.x, char.pos.y + 2.5, char.pos.z))
    },
    systemChat(msg) { chatSys.addLine('', msg, true) },
    addPart(d) {
      const rp = instantiatePart(d)
      return {
        get pos() { return rp.pos },
        remove() { parts.remove(rp) },
      }
    },
  }

  function instantiatePart(d: SdkPart): RuntimePart {
    const rp = parts.add(d)
    handleMap.set(d, rp)
    if (d.climbable) ladderParts.push(rp)
    if (d.material === 'water') waterParts.push(rp)
    if (d.onTouch) {
      rp.touch = () => d.onTouch!(ctx)
      rp.touchOnce = !!d.touchOnce
      if (d.touchOnce) {
        const original = rp.touch
        rp.touch = (p) => {
          original(p)
          parts.remove(p)
        }
      }
    }
    return rp
  }

  const ladderParts: RuntimePart[] = []
  const waterParts: RuntimePart[] = []
  for (const d of pendingParts) instantiatePart(d)
  for (const l of pendingLabels) parts.addLabel(l.text, l.at, l.scale, l.color)

  function pointInPlacedWater(x: number, y: number, z: number) {
    for (const water of waterParts) {
      const b = water.box()
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ) return true
    }
    return false
  }

  // ---- combat pickups: health packs, weapon spawns, ammo crates ----------
  // Registered with the CombatSystem so BOTS loot them too; without combat
  // they're inert decor.
  function addCombatPickup(
    kind: 'weapon' | 'ammo' | 'health',
    at: Vec3,
    respawnAfter: number,
    visual: SdkPart,
    weaponId?: string,
    labelText?: string,
    labelColor?: string,
  ) {
    const rp = instantiatePart(visual)
    const label = labelText
      ? parts.addLabel(labelText, v3(at.x, at.y + 1.05, at.z), 0.4, labelColor ?? '#ffffff')
      : null
    if (!combat) return
    combat.addPickup({
      kind, weaponId, pos: vclone(at), active: true, respawnIn: 0, respawnAfter,
      setVisible(v) {
        rp.mesh.visible = v
        if (label) label.visible = v
      },
    })
  }

  for (const at of pendingHealthPacks) {
    addCombatPickup('health', at, 20, {
      at: vclone(at), size: v3(0.9, 0.9, 0.9), color: '#37d67a', material: 'neon', collide: false,
      behavior: [behaviors.spin(1.8), behaviors.bob(0.22, 2.4, at.x)],
    })
  }
  for (const { at, weaponId } of pendingWeaponSpawns) {
    const wd = combat?.self.weapons.find((w) => w.id === weaponId) ?? WEAPONS[weaponId]
    if (!wd) {
      console.warn(`[blobcade] weaponSpawn: unknown weapon '${weaponId}'`)
      continue
    }
    const tint = wd.beamColor ?? wd.projectile?.color ?? '#cfd8e3'
    // glowing pad marks the spot even while the weapon is taken
    instantiatePart({
      at: v3(at.x, at.y - 0.55, at.z), size: v3(1.7, 0.16, 1.7), color: tint, material: 'neon', collide: false,
    })
    addCombatPickup('weapon', at, 14, {
      at: vclone(at), size: v3(0.95, 0.4, 0.4), color: tint, material: 'metal', collide: false, reflect: false,
      behavior: [behaviors.spin(1.4), behaviors.bob(0.18, 2.6, at.z)],
    }, weaponId, `${wd.icon} ${wd.name}`, '#e8ecf6')
  }
  for (const at of pendingAmmoSpawns) {
    addCombatPickup('ammo', at, 10, {
      at: vclone(at), size: v3(0.8, 0.55, 0.8), color: '#caa64b', material: 'metal', collide: false, reflect: false,
      behavior: [behaviors.spin(1.1), behaviors.bob(0.16, 2.2, at.x + at.z)],
    }, undefined, '📦 ammo', '#ffe9b8')
  }

  for (const l of pendingLights) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.range, 1.8)
    pl.position.set(l.at.x, l.at.y, l.at.z)
    R.scene.add(pl)
  }

  // ---------- vehicles ----------
  // Client-local sims: every client spawns the same parked vehicles from the
  // game def. While a REMOTE player drives, their ride renders from protocol
  // state ([6] = vehicle type) and the matching local sim hides ("claimed");
  // abandoned rides respawn at their pad, so worlds re-converge on their own.
  interface VehicleSim { v: Vehicle; mesh: THREE.Group; idleAt: number; claimedBy: number | null }
  const VEHICLE_EMOJI: Record<VehicleType, string> = { car: '🚗', boat: '🚤', plane: '✈️', jetpack: '🎒' }
  const vehicles: VehicleSim[] = []
  let driving: VehicleSim | null = null
  let prevCamDist = 8
  const vehicleEnv: VehicleEnv = {
    sources: [...sources], // parts + voxels — vehicles never collide with themselves
    gravity: char.gravity,
    isWater: (x, y, z) => pointInPlacedWater(x, y, z) || (voxels ? (voxels as VoxelWorld).isWater(x, y, z) : false),
  }
  for (const { type, at, opts } of pendingVehicles) {
    const v = new Vehicle(type, at, opts)
    const mesh = buildVehicleMesh(type, opts.color)
    mesh.rotation.order = 'YXZ'
    R.scene.add(mesh)
    vehicles.push({ v, mesh, idleAt: 0, claimedBy: null })
  }
  if (vehicles.length > 0) {
    // players collide with parked rides (stand on the hood, blocked by hulls)
    sources.push({
      collect(minX, minY, minZ, maxX, maxY, maxZ, out) {
        for (const s of vehicles) {
          if (s === driving || s.claimedBy !== null || s.v.type === 'jetpack') continue
          const { pos, halfW, height } = s.v
          const b: Box = {
            minX: pos.x - halfW, maxX: pos.x + halfW,
            minY: pos.y, maxY: pos.y + height,
            minZ: pos.z - halfW, maxZ: pos.z + halfW,
          }
          if (b.minX < maxX && b.maxX > minX && b.minY < maxY && b.maxY > minY && b.minZ < maxZ && b.maxZ > minZ) out.push(b)
        }
      },
    })
  }
  const vehicleScratch: Box[] = []
  function nearestVehicle(range: number): VehicleSim | null {
    let best: VehicleSim | null = null
    let bestD = range
    for (const s of vehicles) {
      if (s.v.occupied || s.claimedBy !== null) continue
      const d = Math.hypot(s.v.pos.x - char.pos.x, s.v.pos.z - char.pos.z)
      if (d < bestD && Math.abs(s.v.pos.y - char.pos.y) < 3.5) {
        best = s
        bestD = d
      }
    }
    return best
  }
  function enterVehicle(s: VehicleSim) {
    driving = s
    s.v.occupied = true
    s.idleAt = 0
    prevCamDist = rig.dist
    if (s.v.type !== 'jetpack') rig.dist = Math.max(rig.dist, 11)
    hud.set('vehicle', `${VEHICLE_EMOJI[s.v.type]} E to ${s.v.type === 'jetpack' ? 'take off the pack' : 'get out'}`)
    audio.switchWeapon()
  }
  function exitVehicle(respawnRide: boolean) {
    const s = driving
    if (!s) return
    driving = null
    s.v.occupied = false
    s.idleAt = performance.now()
    // step out beside the ride; fall back to its roof if both sides are blocked
    const f = s.v.forward()
    const spots: Vec3[] = [
      v3(s.v.pos.x + f.z * (s.v.halfW + 0.95), s.v.pos.y + 0.45, s.v.pos.z - f.x * (s.v.halfW + 0.95)),
      v3(s.v.pos.x - f.z * (s.v.halfW + 0.95), s.v.pos.y + 0.45, s.v.pos.z + f.x * (s.v.halfW + 0.95)),
      v3(s.v.pos.x, s.v.pos.y + s.v.height + 0.15, s.v.pos.z),
    ]
    let spot = spots[2]
    for (const p of spots) {
      const saved = { ...char.pos }
      char.pos.x = p.x; char.pos.y = p.y; char.pos.z = p.z
      const clear = !overlapsAny(char, sources, vehicleScratch)
      char.pos.x = saved.x; char.pos.y = saved.y; char.pos.z = saved.z
      if (clear) { spot = p; break }
    }
    char.teleport(spot)
    rig.dist = prevCamDist
    hud.remove('vehicle')
    hud.remove('fuel')
    if (respawnRide) s.v.respawnHome()
  }
  // remote players' rides: protocol-driven meshes + local-sim claims
  const remoteVehicles = new Map<number, { type: string; mesh: THREE.Group }>()
  function releaseClaim(id: number) {
    for (const s of vehicles) {
      if (s.claimedBy === id) {
        s.claimedBy = null
        s.v.respawnHome() // their ride snaps back to its pad on this client
      }
    }
  }
  function syncRemoteVehicle(id: number, rp: RemotePlayer) {
    let rv = remoteVehicles.get(id)
    if (rp.vehicle && VEHICLE_SPECS[rp.vehicle as VehicleType]) {
      if (!rv || rv.type !== rp.vehicle) {
        if (rv) R.scene.remove(rv.mesh)
        const mesh = buildVehicleMesh(rp.vehicle as VehicleType)
        mesh.rotation.order = 'YXZ'
        rv = { type: rp.vehicle, mesh }
        remoteVehicles.set(id, rv)
        R.scene.add(mesh)
        // hide the local parked twin they climbed into (nearest same-type)
        let claim: VehicleSim | null = null
        let claimD = 7
        for (const s of vehicles) {
          if (s.claimedBy !== null || s.v.occupied || s.v.type !== rp.vehicle) continue
          const d = Math.hypot(s.v.pos.x - rp.x, s.v.pos.z - rp.z)
          if (d < claimD) { claim = s; claimD = d }
        }
        if (claim) claim.claimedBy = id
      }
      if (rv.type === 'jetpack') {
        rv.mesh.position.set(rp.x - Math.sin(rp.ry) * 0.34, rp.y + 0.55, rp.z - Math.cos(rp.ry) * 0.34)
      } else {
        rv.mesh.position.set(rp.x, rp.y, rp.z)
      }
      rv.mesh.rotation.y = rp.ry
    } else if (rv) {
      R.scene.remove(rv.mesh)
      remoteVehicles.delete(id)
      releaseClaim(id)
    }
  }

  // ray-traced-style reflections (parts.reflective is live — later parts join).
  // Voxel worlds contribute their water surfaces: the ocean mirrors the island.
  if (def.rtReflections) {
    if (voxels) parts.reflective.push(...(voxels as VoxelWorld).waterMeshes)
    if (parts.reflective.length > 0) R.enableReflections(parts.reflective)
  }

  // ---------- avatars (remote) ----------
  const remoteAvatars = new Map<number, Avatar>()
  const remoteImpostors = new Map<number, THREE.Sprite>()
  const addRemoteAvatar = (p: RemotePlayer) => {
    const av = new Avatar(p.name, 'p' + p.id)
    const impostor = makeRemoteImpostor(p.name)
    impostor.visible = false
    remoteAvatars.set(p.id, av)
    remoteImpostors.set(p.id, impostor)
    R.scene.add(av.group, impostor)
    return av
  }
  const removeRemoteAvatar = (id: number) => {
    const av = remoteAvatars.get(id)
    if (av) {
      av.dispose()
      remoteAvatars.delete(id)
    }
    const impostor = remoteImpostors.get(id)
    if (impostor) {
      disposeSprite(impostor)
      remoteImpostors.delete(id)
    }
  }
  net.onPlayerJoin = (p: RemotePlayer) => {
    addRemoteAvatar(p)
    hud.toast(`${p.name} joined`)
    chatSys.addLine('', `${p.name} joined the game`, true)
  }
  net.onPlayerLeave = (p: RemotePlayer) => {
    removeRemoteAvatar(p.id)
    const rv = remoteVehicles.get(p.id)
    if (rv) {
      R.scene.remove(rv.mesh)
      remoteVehicles.delete(p.id)
    }
    releaseClaim(p.id)
    chatSys.addLine('', `${p.name} left`, true)
  }
  net.onChat = (m) => {
    if (m.system) {
      chatSys.addLine('', m.text, true)
      return
    }
    chatSys.addLine(m.name, m.text)
    audio.chat()
    if (m.id === net.selfId) selfAvatar.say(m.text)
    else remoteAvatars.get(m.id)?.say(m.text)
  }

  // relayed game events surface on the bus as net:<kind> for games + rules
  net.onEvent = (k, d, fromId) => events.emit(`net:${k}`, { d, fromId })

  // ---- PvP (combat games): your shots claim hits on remote humans; the
  // server arbitrates (rate/range/ledger) and broadcasts the verdicts ----
  if (combat) {
    const cb = combat
    const ch = chud!
    cb.remoteTargets = () => [...net.remotes.values()].map((r) => ({ id: r.id, x: r.x, y: r.y, z: r.z }))
    cb.onPvpHit = (claim) => net.sendHit(claim.victimNetId, claim.damage, claim.headshot, claim.weaponName)
    net.onPvpDamage = (e) => {
      if (e.victimId === net.selfId) {
        cb.applyServerDamage(e.damage, net.remotes.get(e.attackerId)?.name ?? 'someone', e.weapon, e.headshot)
      } else {
        const av = remoteAvatars.get(e.victimId)
        if (av) {
          av.enableHealthBar()
          av.setHealth(Math.max(0, e.hp) / 100)
          av.hitFlash()
        }
      }
    }
    net.onPvpKill = (e) => {
      ch.addKillLine(`<b>${escapeHtml(e.attackerName)}</b> ⚔ ${escapeHtml(e.victimName)}`)
      if (e.victimId === net.selfId) {
        cb.applyServerKill(e.attackerName, e.weapon)
      } else {
        const av = remoteAvatars.get(e.victimId)
        if (av) {
          fx.burst(new THREE.Vector3(av.group.position.x, av.group.position.y + 1, av.group.position.z), {
            count: 26, colors: [av.shirtColor, '#f2c84b', '#ff8a8a'], speed: 6, life: 0.8,
          })
          av.setVisible(false)
        }
      }
      if (e.attackerId === net.selfId) {
        economy.earn(10, 'pvp kill')
        hud.set('blobcash', `B$ ${economy.balance}`)
      }
    }
    net.onPvpRespawn = (victimId) => {
      if (victimId !== net.selfId) remoteAvatars.get(victimId)?.setVisible(true)
    }
  }

  // co-build: another player's voxel edits land in our world too. Every edit
  // (local or remote) is also journaled so the HOST can replay the session's
  // edits to late joiners.
  const voxelEdits: Array<[number, number, number, number]> = []
  const voxelReplayTimers: ReturnType<typeof setTimeout>[] = []
  const trackVoxelEdit = (x: number, y: number, z: number, t: number) => {
    if (voxelEdits.length < 20000) voxelEdits.push([x, y, z, t])
  }
  const applyVoxelEdit = (d: unknown) => {
    if (!voxels || !Array.isArray(d) || d.length !== 4) return
    const [x, y, z, t] = (d as number[]).map((n) => Number(n) | 0)
    const vw = voxels as VoxelWorld
    if (vw.inBounds(x, y, z) && t >= 0 && t <= 255) {
      vw.set(x, y, z, t)
      trackVoxelEdit(x, y, z, t)
    }
  }
  events.on('net:voxel', (payload) => applyVoxelEdit((payload as { d?: unknown }).d))
  events.on('net:voxel:batch', (payload) => {
    const list = (payload as { d?: unknown }).d
    if (Array.isArray(list)) for (const e of list.slice(0, 120)) applyVoxelEdit(e)
  })
  // host replays the edit journal to whoever joins (paced under the relay budget)
  const prevJoin = net.onPlayerJoin
  net.onPlayerJoin = (p) => {
    prevJoin(p)
    if (!voxels || !net.isHost || voxelEdits.length === 0) return
    const batches: Array<Array<[number, number, number, number]>> = []
    for (let i = 0; i < voxelEdits.length; i += 100) batches.push(voxelEdits.slice(i, i + 100))
    batches.forEach((batch, i) => {
      const id = setTimeout(() => {
        if (!disposed) net.sendEvent('voxel:batch', batch)
      }, 150 * i)
      voxelReplayTimers.push(id)
    })
  }

  const online = await net.connect(opts.roomKey ?? def.meta.id, playerName, def.maxPlayers)
  for (const p of net.remotes.values()) {
    if (!remoteAvatars.has(p.id)) {
      addRemoteAvatar(p)
    }
  }
  if (online && net.roomCode) {
    const netChip = hudSys.netChip
    netChip.textContent = `🟢 Room ${net.roomCode} ⧉`
    netChip.style.cursor = 'pointer'
    netChip.title = 'Copy an invite link to this room'
    netChip.onclick = () => {
      const base = location.hash.replace(/\?room=[A-Za-z0-9]+/, '')
      const invite = `${location.origin}${location.pathname}${base}?room=${net.roomCode}`
      void navigator.clipboard.writeText(invite)
        .then(() => hud.toast('🔗 Invite link copied — friends land in this room'))
        .catch(() => hud.toast('Clipboard blocked — copy the room code from the HUD.'))
    }
  } else {
    hudSys.netChip.textContent = online ? '🟢 Online' : '⚪ Offline (solo)'
  }
  if (!online) {
    chatSys.addLine('', 'Multiplayer server not found — playing solo. Run `npm run server` to go online.', true)
  }

  // global keys coordinate across the chat/pause systems, so they live here
  const globalKeys = (e: KeyboardEvent) => {
    if (disposed) return
    if (!chatSys.isOpen && services.chat && (e.key === '/' || e.key === 'Enter')) {
      e.preventDefault()
      chatSys.open()
    } else if (!chatSys.isOpen && (e.key === 'm' || e.key === 'M')) {
      const muted = audio.toggleMute()
      hud.toast(muted ? '🔇 Muted' : '🔊 Sound on')
    } else if (!chatSys.isOpen && e.key === 'Escape' && !input.pointerLocked) {
      pauseSys.toggle()
    }
  }
  document.addEventListener('keydown', globalKeys)

  // unlock audio on first interaction
  const unlockAudio = () => {
    audio.unlock()
    audio.startAmbience()
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true })
  document.addEventListener('keydown', unlockAudio, { once: true })

  // ---------- pause menu (internal system) ----------
  const pauseSys = createPauseSystem({
    mount,
    input,
    def,
    hasCombat: !!combat,
    toast: (m) => hud.toast(m),
    getVoxels: () => voxels,
    onSaveWorld: opts.onSaveWorld,
    isChatOpen: () => chatSys.isOpen,
  })

  // ---------- build mode (internal system) ----------
  const buildSys = createBuildModeSystem({
    hudEl: hudSys.hudEl,
    def,
    voxels,
    palette: voxelPalette,
    input,
    rig,
    camera: R.camera,
    char,
    fx,
    recordEdit: (x, y, z, t) => {
      trackVoxelEdit(x, y, z, t)
      net.sendEvent('voxel', [x, y, z, t])
    },
  })
  if (def.camera === 'fp') {
    R.renderer.domElement.addEventListener('click', () => {
      if (!input.pointerLocked && !chatSys.isOpen && !pauseSys.isOpen) input.requestPointerLock()
    })
  }

  // controls hint (auto-hides)
  hudSys.mountControlsHint(!!combat)

  // physics → audio/fx wiring
  char.events = {
    onJump: () => audio.jump(),
    onLand: (speed) => {
      audio.land()
      if (speed > 18) {
        fx.burst(new THREE.Vector3(char.pos.x, char.pos.y + 0.1, char.pos.z), {
          count: 8, colors: ['#cfd8e3'], speed: 2.4, life: 0.4, gravity: -6, size: 0.25, up: 0.5,
        })
      }
      // opt-in fall damage: hp in combat games, a thump everywhere else
      if (phys.fallDamage && speed > 17) {
        const dmg = Math.round((speed - 17) * 2.4)
        if (dmg > 0 && combat?.self.alive) {
          combat.damage(combat.self, dmg, null, FALL_WEAPON)
        } else if (dmg > 0 && !combat) {
          mount.animate(
            [{ transform: 'translate(0,0)' }, { transform: 'translate(6px,-5px)' }, { transform: 'translate(-5px,4px)' }, { transform: 'translate(0,0)' }],
            { duration: 220 },
          )
        }
      }
    },
    onBounce: () => audio.bounce(),
  }

  let wasInWater = false
  let lastSpacePressedAt = -Infinity

  function touchingLadder(): RuntimePart | null {
    for (const p of ladderParts) {
      if (p.removed) continue
      const b = p.box()
      if (
        char.pos.x + char.halfW > b.minX && char.pos.x - char.halfW < b.maxX &&
        char.pos.y + char.height > b.minY && char.pos.y < b.maxY &&
        char.pos.z + char.halfW > b.minZ && char.pos.z - char.halfW < b.maxZ
      ) return p
    }
    return null
  }

  // ---------- game loop ----------
  def.onStart?.(ctx)
  const systems = def.systems ?? []
  for (const s of systems) s.init?.(ctx)
  hud.set('players', `👥 ${ctx.playersOnline}`)
  hud.set('blobcash', `B$ ${economy.balance}`)

  let trailT = 0
  let last = performance.now()
  let raf = 0

  function frame(now: number) {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = (now - started) / 1000
    let highJumpPressed = false
    if (!chatSys.isOpen && !pauseSys.isOpen && input.wasPressed(' ')) {
      highJumpPressed = now - lastSpacePressedAt <= 320
      lastSpacePressedAt = now
    }

    // parts behaviors (platforms move before the player so deltas are fresh)
    parts.update(t, dt)

    // input → wish dir (dead players don't steer)
    const selfDead = combat ? !combat.self.alive : false
    const axes = selfDead ? { x: 0, z: 0 } : input.moveAxes()
    const fwd = rig.forward()
    const right = rig.right()
    const wish = {
      x: fwd.x * axes.z + right.x * axes.x,
      z: fwd.z * axes.z + right.z * axes.x,
    }

    // water check (voxel worlds + placed water elements)
    {
      const inWater = pointInPlacedWater(char.pos.x, char.pos.y + 0.9, char.pos.z) ||
        (voxels ? (voxels as VoxelWorld).isWater(char.pos.x, char.pos.y + 0.9, char.pos.z) : false)
      if (inWater && !wasInWater) audio.splash()
      wasInWater = inWater
      char.inWater = inWater
    }

    // ---- vehicles: enter/exit + drive ----
    if (driving && (selfDead || char.pos.y < killY || input.wasPressed('r'))) exitVehicle(char.pos.y < killY)
    if (!chatSys.isOpen && !selfDead && input.wasPressed('e')) {
      if (driving) exitVehicle(false)
      else {
        const near = nearestVehicle(5.2)
        if (near) enterVehicle(near)
      }
    }
    if (!driving && vehicles.length > 0) {
      const near = nearestVehicle(5.2)
      if (near) hud.set('vehicle', `${VEHICLE_EMOJI[near.v.type]} Press E to ${near.v.type === 'plane' ? 'fly' : near.v.type === 'jetpack' ? 'wear' : 'drive'} · W/S throttle · A/D steer · Space up · Shift down`)
      else hud.remove('vehicle')
      touch?.setVehicle(near ? VEHICLE_EMOJI[near.v.type] : null)
    } else if (driving) {
      touch?.setVehicle('🚪') // tap to hop out — the touch E
    }

    // gravity zones scale the fall (low-g bubbles) for the player and rides
    const zonesLive = parts.gravityZones.length > 0
    char.gravityScale = zonesLive ? parts.gravityAt(char.pos.x, char.pos.y + 0.9, char.pos.z) : 1
    const ladder = !driving && !selfDead ? touchingLadder() : null
    if (ladder) hud.set('ladder', '🪜 W/Space climb · S/Shift down')
    else hud.remove('ladder')

    if (driving) {
      const s = driving
      vehicleEnv.gravity = char.gravity *
        (zonesLive ? parts.gravityAt(s.v.pos.x, s.v.pos.y + 0.6, s.v.pos.z) : 1)
      const vInput: VehicleInput = s.v.type === 'jetpack'
        ? { throttle: 0, steer: 0, ascend: input.jumpHeld(), descend: input.held('shift'), wish }
        : { throttle: axes.z, steer: axes.x, ascend: input.jumpHeld(), descend: input.held('shift') }
      s.v.step(dt, vInput, vehicleEnv)
      // the character rides along: combat hurtbox, triggers and camera follow it
      char.pos.x = s.v.pos.x; char.pos.y = s.v.pos.y; char.pos.z = s.v.pos.z
      char.vel.x = s.v.vel.x; char.vel.y = s.v.vel.y; char.vel.z = s.v.vel.z
      char.grounded = s.v.grounded
      if (s.v.fuelMax !== Infinity) hud.set('fuel', `⛽ ${Math.ceil(s.v.fuel)}s`)
    } else {
      if (ladder) {
        const climbUp = input.jumpHeld() || input.held('w') || input.held('arrowup')
        const climbDown = input.held('shift') || input.held('s') || input.held('arrowdown')
        const climb = (climbUp ? 1 : 0) - (climbDown ? 1 : 0)
        char.gravityScale = 0
        char.vel.y = climb * 6.8
        char.step(dt, wish, false, sources)
        char.grounded = false
        char.groundInfo = null
      } else {
        char.step(dt, wish, !selfDead && input.jumpHeld(), sources)
        if (highJumpPressed && !selfDead && !char.inWater && char.vel.y > 1) {
          char.vel.y = Math.max(char.vel.y, char.jumpVel * 1.45)
          audio.jump()
        }
      }
    }

    // parked rides settle/bob; abandoned ones head home after a while
    for (const s of vehicles) {
      if (s !== driving && s.claimedBy === null) {
        vehicleEnv.gravity = char.gravity
        s.v.step(dt, PARKED_INPUT, vehicleEnv)
        if (!s.v.occupied && s.idleAt > 0 && now - s.idleAt > 8000) {
          s.idleAt = 0
          if (Math.hypot(s.v.pos.x - s.v.home.x, s.v.pos.z - s.v.home.z) > 2) s.v.respawnHome()
        }
      }
      s.mesh.visible = s.claimedBy === null && (s !== driving || s.v.type !== 'jetpack' || !rig.isFirstPersonish())
      if (s === driving && s.v.type === 'jetpack') {
        // worn on the avatar's back, not boarded
        const yaw = selfAvatar.targetYaw
        s.mesh.position.set(char.pos.x - Math.sin(yaw) * 0.34, char.pos.y + 0.55, char.pos.z - Math.cos(yaw) * 0.34)
        s.mesh.rotation.y = yaw
        if (input.jumpHeld() && s.v.fuel > 0 && Math.random() < 0.6) {
          fx.burst(new THREE.Vector3(s.mesh.position.x, s.mesh.position.y - 0.55, s.mesh.position.z), {
            count: 2, colors: ['#ffd166', '#ff8c42'], speed: 1.6, life: 0.3, size: 0.22, gravity: -4, up: -1,
          })
        }
      } else {
        s.mesh.position.set(s.v.pos.x, s.v.pos.y, s.v.pos.z)
        s.mesh.rotation.y = s.v.yaw
        s.mesh.rotation.x = s.v.type === 'plane' ? clampPitch(-s.v.vel.y * 0.022) : 0
      }
      if (s.v.type === 'plane') {
        const prop = s.mesh.getObjectByName('prop')
        if (prop) prop.rotation.z += dt * (4 + Math.abs(s.v.forwardSpeed()) * 0.9)
      }
    }

    // triggers
    parts.checkTriggers(
      char.pos.x - char.halfW, char.pos.y, char.pos.z - char.halfW,
      char.pos.x + char.halfW, char.pos.y + char.height, char.pos.z + char.halfW,
    )

    // kill plane
    if (char.pos.y < killY) player.kill()

    // R = reset (the classic platformer convention)
    if (input.wasPressed('r')) player.kill()

    // build mode: hotbar keys, wheel cycling, break/place edits
    buildSys.update(ctx, dt)

    // voxel edits rebuild water chunks — keep fresh surfaces in the SSR list
    if (R.ssrActive && voxels) {
      for (const m of (voxels as VoxelWorld).waterMeshes) {
        if (!parts.reflective.includes(m)) parts.reflective.push(m)
      }
    }

    // ---- combat: weapons, zoom, bots ----
    if (combat) {
      const self = combat.self
      const ch = chud!
      // weapon switching: number keys + wheel — only weapons you actually hold
      for (let i = 0; i < self.weapons.length; i++) {
        if (input.wasPressed(String(i + 1)) && self.owned.has(self.weapons[i].id)) self.weaponIdx = i
      }
      if (!buildSys.active && input.pointerLocked && input.wheelDelta !== 0) {
        const n = self.weapons.length
        const step = input.wheelDelta > 0 ? 1 : -1
        let idx = self.weaponIdx
        for (let tries = 0; tries < n; tries++) {
          idx = ((idx + step) % n + n) % n
          if (self.owned.has(self.weapons[idx].id)) break
        }
        self.weaponIdx = idx
      }

      // sniper zoom on right mouse — scope overlay + reduced sensitivity
      const wantZoom = !selfDead && rig.mode === 'fp' && input.pointerLocked && input.rmbDown && !!self.weapon.zoomFov
      if (wantZoom !== scoped) {
        scoped = wantZoom
        if (scoped) audio.scopeIn()
        ch.setScoped(scoped, scoped ? `${(70 / self.weapon.zoomFov!).toFixed(1)}×` : '')
      }
      rig.sensScale = scoped ? Math.max(0.18, self.weapon.zoomFov! / 70) : 1
      const targetFov = scoped ? self.weapon.zoomFov! : 70
      if (Math.abs(R.camera.fov - targetFov) > 0.05) {
        R.camera.fov += (targetFov - R.camera.fov) * Math.min(1, dt * 16)
        R.camera.updateProjectionMatrix()
      }

      // hold to fire — shots trace from the eye, but visually leave the muzzle
      if (!selfDead && rig.mode === 'fp' && input.pointerLocked && input.lmbDown && !chatSys.isOpen) {
        const eye = v3(R.camera.position.x, R.camera.position.y, R.camera.position.z)
        const muzzle = viewmodel && !scoped ? viewmodel.muzzleWorld() : undefined
        if (combat.fire(self, self.weapon, eye, rig.lookDir(), muzzle)) {
          viewmodel?.onFire(self.weapon)
        }
      }

      viewmodel?.update(dt, {
        speed: Math.hypot(char.vel.x, char.vel.z),
        grounded: char.grounded,
        hidden: selfDead || scoped,
        lookDX: input.mouseDX,
        lookDY: input.mouseDY,
      })

      combat.update(dt, t)

      // weapon changed this frame (keys, wheel, pickup or auto-switch on dry)?
      if (self.weaponIdx !== shownWeaponIdx) {
        shownWeaponIdx = self.weaponIdx
        ch.renderWeaponBar()
        viewmodel?.equip(self.weapon)
        audio.switchWeapon()
      }
    }

    // camera
    rig.update(dt, input, R.camera, char.pos, sources)

    // self avatar pose
    const planarSpeed = Math.hypot(char.vel.x, char.vel.z)
    selfAvatar.group.position.set(char.pos.x, char.pos.y, char.pos.z)
    if (driving && driving.v.type !== 'jetpack') {
      selfAvatar.targetYaw = driving.v.yaw // remotes see the ride facing its heading
    } else if (rig.mode === 'orbit' && rig.shiftLock) {
      selfAvatar.targetYaw = Math.atan2(fwd.x, fwd.z)
    } else if (planarSpeed > 0.6) {
      selfAvatar.targetYaw = Math.atan2(char.vel.x, char.vel.z)
    }
    const seated = !!driving && driving.v.type !== 'jetpack'
    selfAvatar.setVisible(!rig.isFirstPersonish() && !selfDead && !seated)
    selfAvatar.animate(dt, planarSpeed, char.grounded, t)

    // equipped trail (game-store recolor wins over the global shop cosmetic)
    const trail = storeEq.trail ?? economy.equippedTrail()
    if (trail && planarSpeed > 3 && !selfDead) {
      trailT += dt
      if (trailT > 0.055) {
        trailT = 0
        const color = storeEq.trail
          ? storeEq.trail.color
          : trail.id === 'trail-rainbow'
            ? `hsl(${Math.floor((t * 140) % 360)}, 90%, 60%)`
            : trail.id === 'trail-fire' ? (Math.random() < 0.5 ? '#ff8c42' : '#ffd166') : '#ffffff'
        fx.burst(new THREE.Vector3(char.pos.x, char.pos.y + 0.25, char.pos.z), {
          count: 2, colors: [color], speed: 0.7, life: 0.55, size: 0.3, gravity: 1.5, up: 0.4,
        })
      }
    }

    // network
    const animCode = !char.grounded ? 2 : planarSpeed > 0.6 ? 1 : 0
    net.sendState(char.pos.x, char.pos.y, char.pos.z, selfAvatar.targetYaw, animCode, driving ? driving.v.type : '')
    net.sample()
    const shadowCandidates: Array<{ id: number; d2: number }> = []
    for (const id of remoteAvatars.keys()) {
      const rp = net.remotes.get(id)
      if (!rp) continue
      const dx = rp.x - char.pos.x
      const dy = rp.y - char.pos.y
      const dz = rp.z - char.pos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 <= REMOTE_LOD_DISTANCE2) shadowCandidates.push({ id, d2 })
    }
    shadowCandidates.sort((a, b) => a.d2 - b.d2)
    const shadowIds = new Set(shadowCandidates.slice(0, REMOTE_SHADOW_CAP).map((p) => p.id))
    for (const [id, av] of remoteAvatars) {
      const rp = net.remotes.get(id)
      if (!rp) continue
      av.group.position.set(rp.x, rp.y, rp.z)
      av.targetYaw = rp.ry
      const rideHidesAvatar = rp.vehicle !== '' && rp.vehicle !== 'jetpack'
      const dx = rp.x - char.pos.x
      const dy = rp.y - char.pos.y
      const dz = rp.z - char.pos.z
      const far = dx * dx + dy * dy + dz * dz > REMOTE_LOD_DISTANCE2
      const impostor = remoteImpostors.get(id)
      if (impostor) {
        impostor.position.set(rp.x, rp.y + 1.35, rp.z)
        impostor.visible = far && !rideHidesAvatar
      }
      av.setVisible(!rideHidesAvatar && !far)
      setAvatarShadows(av, shadowIds.has(id))
      if (!far) av.animate(dt, rp.anim === 1 ? Math.max(rp.speed, 3) : rp.speed, rp.anim !== 2, t)
      syncRemoteVehicle(id, rp)
    }
    hud.set('players', `👥 ${ctx.playersOnline}`)

    // tick + systems + fx + render
    def.onTick?.(ctx, dt)
    for (const s of systems) s.update?.(ctx, dt)
    fx.update(dt)
    R.updateSun(new THREE.Vector3(char.pos.x, char.pos.y, char.pos.z))
    R.render(t)

    // fps meter (+ reflections perf guard)
    hudSys.update(ctx, dt)

    input.endFrame()
  }

  hudSys.loadingEl.remove()
  raf = requestAnimationFrame((n) => {
    last = n
    frame(n)
  })

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', globalKeys)
      document.removeEventListener('pointerdown', unlockAudio)
      document.removeEventListener('keydown', unlockAudio)
      for (const id of voxelReplayTimers) clearTimeout(id)
      voxelReplayTimers.length = 0
      for (const s of systems) s.dispose?.()
      events.clear()
      gameStore?.dispose()
      combat?.dispose()
      for (const id of [...remoteAvatars.keys()]) removeRemoteAvatar(id)
      viewmodel?.dispose()
      fx.dispose()
      parts.dispose()
      voxels?.dispose()
      touch?.dispose()
      input.exitPointerLock()
      input.dispose()
      net.dispose()
      R.dispose()
      mount.innerHTML = ''
      mount.className = ''
    },
  }
}

function clampPitch(n: number): number {
  return Math.max(-0.35, Math.min(0.35, n))
}

function makeRemoteImpostor(name: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 220
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = 'rgba(10, 14, 24, 0.46)'
  g.beginPath()
  g.ellipse(80, 204, 38, 10, 0, 0, Math.PI * 2)
  g.fill()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // soft capsule limbs behind the torso
  g.strokeStyle = '#2f81f7'
  g.lineWidth = 18
  g.beginPath()
  g.moveTo(53, 92); g.lineTo(42, 144)
  g.moveTo(107, 92); g.lineTo(118, 144)
  g.stroke()
  g.strokeStyle = '#253044'
  g.lineWidth = 20
  g.beginPath()
  g.moveTo(66, 144); g.lineTo(58, 194)
  g.moveTo(94, 144); g.lineTo(102, 194)
  g.stroke()
  g.fillStyle = '#f2c84b'
  g.beginPath()
  g.ellipse(80, 54, 26, 29, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#2f81f7'
  g.beginPath()
  g.ellipse(80, 112, 35, 47, 0, 0, Math.PI * 2)
  g.fill()
  // tiny face read: dark eyes and smile, still cheap at sprite distance
  g.fillStyle = '#1a1a1a'
  g.beginPath()
  g.ellipse(70, 51, 4, 6, 0, 0, Math.PI * 2)
  g.ellipse(90, 51, 4, 6, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#1a1a1a'
  g.lineWidth = 3
  g.beginPath()
  g.arc(80, 61, 10, Math.PI * 0.15, Math.PI * 0.85)
  g.stroke()
  g.fillStyle = '#ffffff'
  g.font = '700 18px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name.slice(0, 14), 80, 16)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.scale.set(2.2, 3.0, 1)
  return sprite
}

function setAvatarShadows(av: Avatar, enabled: boolean) {
  av.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = enabled
  })
}

function disposeSprite(sprite: THREE.Sprite) {
  sprite.removeFromParent()
  const mat = sprite.material as THREE.SpriteMaterial
  mat.map?.dispose()
  mat.dispose()
}
