// ============================================================================
//  Boxcade SDK — build a multiplayer browser game in a handful of lines.
//
//    import { defineGame, v3, behaviors } from '../sdk'
//
//    export default defineGame({
//      meta: { id: 'my-game', name: 'My Game', emoji: '🌴', blurb: '...' },
//      build(w) {
//        w.lighting('noon')
//        w.spawn(v3(0, 6, 0))
//        w.add({ at: v3(0, 0, 0), size: v3(24, 2, 24), color: '#6cc04a', material: 'grass' })
//        w.coin(v3(4, 3, 0))
//      },
//    })
//
//  Everything else — rendering, physics, multiplayer, chat, HUD — is engine.
// ============================================================================

import type { Vec3 } from '../engine/math'
import type { PartDef, MaterialKind, Behavior } from '../engine/world'
import type { EventBus } from '../engine/events'

export { v3 } from '../engine/math'
export {
  behaviors, registerMaterial, partMaterial,
  registerBehavior, behaviorFromDef, behaviorTypes, type BehaviorDef,
} from '../engine/world'
export {
  buildTextMap, parseTextMap, serializeTextMap, registerTile,
  type TextMapResult, type ParsedTextMap, type TileContext, type TileHandler,
} from './textmap'
export {
  WEAPONS, DEFAULT_LOADOUT, registerWeapon, hazardWeapon,
  type WeaponDef, type CombatConfig, type KillInfo,
} from '../engine/combat'
export { registerSkyPreset, SKY_PRESETS, type SkyPreset } from '../engine/sky'
export { EventBus, type EngineEvents } from '../engine/events'
export { audio } from '../engine/audio'
export {
  GAMEDOC_VERSION, GAMEDOC_LIMITS, DOC_PART_KINDS, PORTAL_TARGET_RE,
  validateGameDoc, migrateGameDoc, slugifyName,
  type GameDoc, type GameDocMeta, type DocPart, type DocV3, type GameDocValidation,
} from './gamedoc'
export {
  createRulesSystem, PartRegistry, v3FromDoc,
  RULE_TRIGGER_TYPES, RULE_ACTION_TYPES, RULE_SOUNDS, RESERVED_EVENT_PREFIXES,
  type Rule, type RuleTrigger, type RuleCondition, type RuleAction, type RulesSystem,
} from './rules'
export { buildGameFromDoc, GameDocError } from './interpret'
export { createScriptSystem } from './script-host'
export { encodeGameDoc, decodeGameDoc, hashGameDoc, SHARE_LINK_LIMIT } from './codec'
export { gameDocToTypeScript } from './ts-export'
export type { Vec3, PartDef, MaterialKind, Behavior }

/**
 * The engine services behind the current session — the "power API". Most
 * games never need this; it exists so advanced games and custom GameSystems
 * can compose with any engine subsystem directly (Facade + DI-via-context).
 * Everything here is the live instance, not a copy.
 */
export interface EngineServices {
  renderer: import('../engine/renderer').Renderer
  parts: import('../engine/world').PartsWorld
  voxels: import('../engine/voxel').VoxelWorld | null
  combat: import('../engine/combat').CombatSystem | null
  fx: import('../engine/fx').Particles
  net: import('../engine/network').Net
  input: import('../engine/input').Input
  /** the local player's character controller (position, velocity, tuning) */
  player: import('../engine/physics').CharacterController
  audio: typeof import('../engine/audio').audio
  events: EventBus
}

/**
 * A composable unit of game logic with a lifecycle (Strategy pattern).
 * Ship reusable behaviors — day/night cycles, score tickers, wave spawners —
 * as systems and mix them into any game via GameDef.systems.
 */
export interface GameSystem {
  id: string
  init?(ctx: GameContext): void
  update?(ctx: GameContext, dt: number): void
  dispose?(): void
}

/** A part definition plus gameplay wiring. */
export interface SdkPart extends PartDef {
  /** called when the local player touches this part */
  onTouch?: (ctx: GameContext) => void
  /** fire onTouch only once, ever */
  touchOnce?: boolean
}

export interface PartHandle {
  /** live center position — write to move the part */
  readonly pos: Vec3
  remove(): void
}

/** built-in presets get autocomplete; registerSkyPreset() names work too */
export type LightingPreset = 'noon' | 'morning' | 'goldenHour' | 'night' | 'space' | (string & {})

export interface WorldBuilder {
  /** sky + sun + fog preset (built-in or registered via registerSkyPreset) */
  lighting(preset: LightingPreset): void
  /** where players appear (and respawn before any checkpoint) */
  spawn(at: Vec3): void
  /** falling below this Y counts as death (default -30) */
  killY(y: number): void

  add(def: SdkPart): PartHandle
  /** floating billboard text */
  label(text: string, at: Vec3, scale?: number, color?: string): void

  // ---- prefabs (one-liners for the classics) ----
  /** glowing pad that saves the player's respawn point */
  checkpoint(at: Vec3, index: number, size?: Vec3): void
  /** kill brick — touching it respawns the player */
  lava(at: Vec3, size: Vec3): void
  /** collectible spinning coin */
  coin(at: Vec3): void
  /** golden victory pad — fires ctx.celebrate() and onWin */
  winPad(at: Vec3, size?: Vec3, onWin?: (ctx: GameContext) => void): void
  /** launches the player upward on landing */
  bouncePad(at: Vec3, power?: number, size?: Vec3): void
  /** decorative blocky tree */
  tree(at: Vec3, scale?: number): void
  /** soft floating cloud (decor, not solid) */
  cloud(at: Vec3, scale?: number): void
  /** ring of orbiting kill-cubes — the classic windmill hazard */
  spinnerHazard(center: Vec3, radius: number, count?: number, period?: number): void
  /** floating +35hp pickup (combat games); respawns after ~20s */
  healthPack(at: Vec3): void
  /**
   * weapon pickup pad (combat games): grants the weapon + ammo to whoever
   * walks over it — bots loot these too. Respawns after ~14s.
   */
  weaponSpawn(at: Vec3, weaponId: string): void
  /** ammo crate (combat games): tops up every weapon you hold. Respawns ~10s. */
  ammoSpawn(at: Vec3): void
  /** a real point light — lights up interiors (a few per map; they cost performance) */
  light(at: Vec3, opts?: { color?: string; intensity?: number; range?: number }): void
  /**
   * a step-through gateway to another game/level. Walking into it emits
   * `platform:goToGame` { target } — the shell routes it. `target` grammar:
   * `g:<publishedId>` · `draft:<key>` · `level:<n>` · `home` (code games may
   * also use `play:<builtinId>` to hop to a built-in game).
   */
  portal(at: Vec3, target: string, label?: string): void

  /** override movement physics: gravity (negative), jumpVel, walkSpeed */
  physics(cfg: PhysicsConfig): void

  /** a parked vehicle players can enter/exit with E — car / jetpack / boat / plane */
  vehicle(type: VehicleType, at: Vec3, opts?: VehicleOptions): void

  /**
   * editable voxel island (enables build mode UI in fp camera). Either
   * procedural (seed/size) or revived from a saved world (data = the JSON
   * produced by VoxelWorld.serialize() / the pause-menu world download).
   */
  voxelIsland(opts?: { seed?: number; size?: number; palette?: number[]; data?: string }): void
}

export interface PhysicsConfig {
  /** negative — engine default -46 */
  gravity?: number
  /** engine default 14.2 */
  jumpVel?: number
  /** engine default 8.2 */
  walkSpeed?: number
  /** hard landings hurt (combat games get hp damage, others a screen shake) */
  fallDamage?: boolean
}

/** a per-game cosmetic on sale for Bolts — always a procedural recolor */
export interface StoreItemDef {
  id: string
  name: string
  /** what the recolor applies to */
  kind: 'shirt' | 'trail'
  color: string
  /** price in Bolts (the creator keeps a 30% cut on published games) */
  price: number
}

/** platform services a game opts in or out of (everything defaults sensible) */
export interface GameServices {
  /** in-game text chat (default true) */
  chat?: boolean
  /** submit best win times to this game's leaderboard (default true) */
  leaderboard?: boolean
  /** per-game cosmetic shop — creator-named, creator-priced recolors */
  store?: StoreItemDef[]
}

export type VehicleType = 'car' | 'jetpack' | 'boat' | 'plane'

export interface VehicleOptions {
  /** top speed override — per-type defaults (car 26, boat 14, plane 34, jetpack 12) */
  speed?: number
  /** flight fuel in seconds (jetpack default 10, plane 60); refills while parked */
  fuel?: number
  /** body paint */
  color?: string
}

/** A combat entity (you or a bot) as exposed to game code. */
export interface EntityApi {
  readonly id: string
  readonly name: string
  readonly team: string | null
  readonly isBot: boolean
  readonly isSelf: boolean
  readonly position: Vec3
  readonly health: number
  readonly alive: boolean
  /** free-form tag for game modes (e.g. 'red-flag' while carrying) */
  carrying: string | null
  /** where this bot is heading (no-op for the local player) */
  setObjective(at: Vec3 | null): void
  teleport(at: Vec3): void
  respawn(): void
  /** grant a weapon from the game's arsenal (+ some ammo). False if unknown/already full. */
  giveWeapon(weaponId: string): boolean
  /** top up the ammo of every held weapon. False if already full. */
  giveAmmo(): boolean
  /** heal; pass capTo above maxHealth for armor-style overheal (e.g. 250) */
  heal(n: number, capTo?: number): boolean
  /** apply damage with a custom cause for the kill feed (gas, traps, …) */
  hurt(n: number, cause?: string, causeIcon?: string): void
  /** drop from the sky on a slow parachute fall (battle-royale infil) */
  deploy(at: Vec3): void
}

export interface KillInfoApi {
  killerId: string | null
  killerName: string | null
  killerTeam: string | null
  killerIsSelf: boolean
  victimId: string
  victimName: string
  victimTeam: string | null
  victimIsSelf: boolean
  weapon: string
  headshot: boolean
}

export interface PlayerApi {
  readonly name: string
  /** feet position (copy) */
  readonly position: Vec3
  readonly velocity: Vec3
  /** death flash + respawn at last checkpoint */
  kill(): void
  /** quiet teleport back to last checkpoint */
  respawn(): void
  setCheckpoint(at: Vec3): void
  teleport(at: Vec3): void
  /** add velocity (launch pads, explosions) */
  launch(v: Vec3): void
}

export interface HudApi {
  /** upsert a HUD chip, e.g. hud.set('stage', '⭐ Stage 3/12') */
  set(key: string, value: string): void
  remove(key: string): void
  toast(msg: string): void
  /** large center text, auto-fades */
  big(msg: string, ms?: number): void
}

export interface GameContext {
  player: PlayerApi
  hud: HudApi
  /** seconds since the game started */
  time: number
  /** local + remote player count */
  playersOnline: number
  /** session coin balance for this player */
  coins: number
  /** grant coins (plays the coin sound + sparkle; coins also earn Bolts 1:1) */
  award(n: number): void
  /** persistent platform currency balance */
  readonly bolts: number
  /** grant Bolts (the platform economy — kills, wins, achievements) */
  earnBolts(n: number, reason?: string): void
  /** confetti + fanfare + big message — the win moment */
  celebrate(msg?: string): void
  /** system line in chat (local) */
  systemChat(msg: string): void
  /** spawn parts at runtime */
  addPart(def: SdkPart): PartHandle

  /**
   * typed pub/sub bus — the engine publishes 'combat:*' / 'self:*' / 'player:*'
   * events here, and games can emit/listen to their own (Observer pattern)
   */
  readonly events: EventBus
  /** the live engine subsystems (renderer, physics, net, …) — the power API */
  readonly engine: EngineServices

  // ---- combat (available when GameDef.combat is set) ----
  /** you + all bots */
  readonly entities: EntityApi[]
  /** add a bot to the match */
  spawnBot(opts: { name: string; team?: string; skill?: number; spawns: Vec3[]; shirt?: string }): EntityApi
  /** respawn pool for the local player in combat games */
  setSpawnPoints(points: Vec3[]): void
}

export interface GameMeta {
  id: string
  name: string
  blurb: string
  emoji: string
  /** css background for the portal card thumbnail */
  gradient: string
  genre: string
}

export interface GameDef {
  meta: GameMeta
  /** preferred multiplayer room capacity (server clamps to 1..250, default 64) */
  maxPlayers?: number
  /** 'orbit' = classic third person (default) · 'fp' = pointer-lock build/shooter view */
  camera?: 'orbit' | 'fp'
  /** movement tuning (gravity/jump/speed) — text-map @directives override this */
  physics?: PhysicsConfig
  /**
   * screen-space ray-traced reflections on parts flagged `reflect: true`
   * (and `M` text-map tiles). Costs GPU time — the runtime auto-disables it
   * if the frame rate drops.
   */
  rtReflections?: boolean
  /**
   * custom weapons for this game, registered at session start — reference
   * them by id in `combat.weapons`/`weaponSpawn` like any built-in
   */
  weapons?: import('../engine/combat').WeaponDef[]
  /** enables weapons, health, bots. Configure the arsenal + your team here. */
  combat?: import('../engine/combat').CombatConfig & { selfTeam?: string }
  /**
   * composable logic units run by the engine each frame (after onTick) —
   * mix in reusable systems instead of growing one giant onTick
   */
  systems?: GameSystem[]
  /** platform services: chat toggle, leaderboard toggle, per-game Bolts store */
  services?: GameServices
  build(w: WorldBuilder): void
  onStart?(ctx: GameContext): void
  onTick?(ctx: GameContext, dt: number): void
  onRespawn?(ctx: GameContext): void
  /** combat games: someone died */
  onKill?(ctx: GameContext, info: KillInfoApi): void
}

export function defineGame(def: GameDef): GameDef {
  return def
}

/** friendly default palette, used by examples */
export const colors = {
  grass: '#6cc04a',
  dirt: '#8a6a43',
  stone: '#9aa0a6',
  red: '#e74c3c',
  blue: '#3b82f6',
  sky: '#4cc9f0',
  yellow: '#ffd166',
  orange: '#ff8c42',
  purple: '#9b59b6',
  pink: '#fd79a8',
  white: '#f4f6f8',
  dark: '#2c3e50',
  lava: '#ff5a1f',
  gold: '#ffc94d',
  mint: '#06d6a0',
}
