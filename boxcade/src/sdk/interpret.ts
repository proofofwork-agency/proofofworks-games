// The GameDoc interpreter: buildGameFromDoc(doc) → GameDef. A JSON document
// becomes a first-class game by replaying its sections through the same
// WorldBuilder verbs hand-written games call — there is no separate "data
// engine", so doc games and code games stay behavior-identical by design.

import { v3 } from '../engine/math'
import { behaviorFromDef, type Behavior } from '../engine/world'
import { registerWeapon, type CombatConfig, type WeaponDef } from '../engine/combat'
import { buildTextMap } from './textmap'
import { validateGameDoc, migrateGameDoc, slugifyName, type GameDoc, type DocPart } from './gamedoc'
import { createRulesSystem, PartRegistry, v3FromDoc, type RulesSystem } from './rules'
import { createScriptSystem } from './script-host'
import type { GameDef, GameMeta, GameSystem, WorldBuilder, SdkPart, VehicleOptions } from './index'

/** thrown when a doc fails validation — `errors` are player-friendly lines */
export class GameDocError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(`bad game document: ${errors[0] ?? 'unknown error'}`)
    this.name = 'GameDocError'
    this.errors = errors
  }
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #6a5cff, #2f81f7)'

/** options for {@link buildGameFromDoc}. */
export interface BuildGameOptions {
  /**
   * which level to build, in HUMAN numbering: `0`/`1` (default) = the root
   * doc itself ("level 1 is this game"); `n ≥ 2` builds `doc.levels[n-2]`,
   * inheriting weapons/combat/physics/lighting and meta from the root when
   * the level omits them. Out-of-range or missing levels fall back to root.
   */
  level?: number
  /** scripted docs run only after the shell has granted permission */
  allowScripts?: boolean
}

/**
 * Validate + migrate + interpret. Accepts a JSON string or a parsed object.
 * Throws GameDocError when the doc is invalid; warnings go to the console.
 *
 * `opts.level` (optional) selects a level from `doc.levels`; level 0 is the
 * root doc. The chosen level inherits top-level sections it omits (§ levels).
 */
export function buildGameFromDoc(input: unknown, opts?: BuildGameOptions): GameDef {
  const res = validateGameDoc(input)
  for (const w of res.warnings) console.warn(`[boxcade] gamedoc: ${w}`)
  if (!res.ok || !res.doc) throw new GameDocError(res.errors)
  const root = migrateGameDoc(res.doc)
  const { doc, levelN } = resolveLevel(root, opts?.level ?? 0)
  if (doc.script?.trim() && !opts?.allowScripts) {
    throw new GameDocError(['this game contains a creator script — run it from a trusted route or accept the script prompt'])
  }

  const baseName = doc.meta.name
  const meta: GameMeta = {
    id: doc.meta.id ?? slugifyName(baseName),
    name: levelN >= 2 ? `${baseName} — Level ${levelN}` : baseName,
    blurb: doc.meta.blurb ?? 'A community-made Boxcade game.',
    emoji: doc.meta.emoji ?? '🎮',
    gradient: doc.meta.gradient ?? DEFAULT_GRADIENT,
    genre: doc.meta.genre ?? 'Community',
  }

  // custom weapons-as-data: register each into the global WEAPONS registry
  // under a game-namespaced id (`${gameId}:${id}`) so two games can both define
  // a 'blaster' without clashing, then rewrite every reference to the namespaced
  // id. Reference rewriting works on COPIES — the input doc is never mutated.
  const idMap = registerDocWeapons(doc.weapons, meta.id)
  const combat = rewriteCombatWeapons(doc.combat, idMap)
  const parts = rewriteWeaponSpawns(doc.parts, idMap)

  const registry = new PartRegistry()
  const rules: RulesSystem | null =
    (doc.rules?.length ?? 0) > 0 || doc.vars
      ? createRulesSystem(doc.rules ?? [], doc.vars, registry)
      : null
  const script = doc.script?.trim()
  const scriptSystem = script ? createScriptSystem(doc, script, registry) : null
  const systems = [rules, scriptSystem].filter((s): s is GameSystem => !!s)

  return {
    meta,
    maxPlayers: doc.maxPlayers,
    camera: doc.camera,
    physics: doc.physics,
    rtReflections: doc.rtReflections,
    combat,
    services: doc.services,
    systems: systems.length > 0 ? systems : undefined,
    build(w) {
      if (doc.lighting) w.lighting(doc.lighting)
      if (doc.killY !== undefined) w.killY(doc.killY)
      // tagged parts placed by textmap tiles (doors, buttons) become
      // rule-addressable: wrap add() so tags land in the part registry
      if (doc.textmap) buildTextMap(withRegistry(w, registry, rules), doc.textmap)
      if (doc.voxel) w.voxelIsland(doc.voxel)
      for (const p of parts ?? []) placeDocPart(w, p, registry, rules)
      // explicit spawn wins over textmap 'S' tiles and voxel auto-spawn
      if (doc.spawn) w.spawn(v3FromDoc(doc.spawn))
    },
  }
}

/**
 * Resolve which doc to build for the requested level, using HUMAN numbering:
 * level 1 (and 0, and any out-of-range / missing index) is the root doc —
 * "level 1 is this game". Level `n ≥ 2` with `root.levels[n-2]` present
 * returns an "effective doc" = that level merged over the fields it inherits
 * from the root:
 *   - meta: parent meta as the base, the level's own meta members overriding
 *   - weapons / combat / physics / lighting: the root's when the level omits them
 * All other sections (parts, rules, vars, textmap, voxel, spawn, killY, camera,
 * rtReflections) come from the level as authored.
 */
function resolveLevel(root: GameDoc, level: number): { doc: GameDoc; levelN: number } {
  const lv = level >= 2 ? root.levels?.[level - 2] : undefined
  if (!lv) return { doc: root, levelN: 0 }
  const effective: GameDoc = {
    ...lv,
    boxcade: 'gamedoc',
    v: root.v,
    meta: { ...root.meta, ...(lv.meta ?? {}) },
    // inherit these top-level sections from the parent when the level omits them
    weapons: lv.weapons ?? root.weapons,
    combat: lv.combat ?? root.combat,
    physics: lv.physics ?? root.physics,
    lighting: lv.lighting ?? root.lighting,
  }
  // a level never carries its own sub-levels (depth-1; validation enforces it)
  delete effective.levels
  return { doc: effective, levelN: level }
}

/**
 * Register each custom weapon under a game-namespaced id and return a map from
 * the doc-local id → namespaced id. Re-registering on every interpret is fine
 * (the registry just warns on overwrite). Validation has already vetted shape.
 */
function registerDocWeapons(weapons: WeaponDef[] | undefined, gameId: string): Map<string, string> {
  const idMap = new Map<string, string>()
  if (!weapons) return idMap
  for (const w of weapons) {
    const namespacedId = `${gameId}:${w.id}`
    idMap.set(w.id, namespacedId)
    // fill the engine's required fields the doc schema lets games omit
    registerWeapon({ ...w, id: namespacedId, icon: w.icon ?? '🔫', sound: w.sound ?? 'sidearm' })
  }
  return idMap
}

/** map a doc-local weapon id to its namespaced form (pass-through if unknown) */
const remap = (idMap: Map<string, string>, id: string): string => idMap.get(id) ?? id

/** copy combat config, rewriting custom weapon ids in weapons/startWeapons */
function rewriteCombatWeapons(
  combat: (CombatConfig & { selfTeam?: string }) | undefined,
  idMap: Map<string, string>,
): (CombatConfig & { selfTeam?: string }) | undefined {
  if (!combat || idMap.size === 0) return combat
  const next = { ...combat }
  if (Array.isArray(combat.weapons)) {
    next.weapons = combat.weapons.map((w) => (typeof w === 'string' ? remap(idMap, w) : w))
  }
  if (Array.isArray(combat.startWeapons)) {
    next.startWeapons = combat.startWeapons.map((id) => remap(idMap, id))
  }
  return next
}

/** copy the parts list, rewriting weaponSpawn.weapon when it names a custom id */
function rewriteWeaponSpawns(parts: DocPart[] | undefined, idMap: Map<string, string>): DocPart[] | undefined {
  if (!parts || idMap.size === 0) return parts
  return parts.map((p) =>
    p.kind === 'weaponSpawn' && idMap.has(p.weapon) ? { ...p, weapon: remap(idMap, p.weapon) } : p,
  )
}

/** wraps a WorldBuilder so tagged adds register for rules (touch + movePart) */
function withRegistry(w: WorldBuilder, registry: PartRegistry, rules: RulesSystem | null): WorldBuilder {
  return {
    ...w,
    add(def) {
      if (def.tag && rules && rules.wantsTouch([def.tag])) {
        const refs = [def.tag]
        const prev = def.onTouch
        def = {
          ...def,
          onTouch: (ctx) => {
            prev?.(ctx)
            rules.notifyTouch(refs, ctx)
          },
        }
      }
      const handle = w.add(def)
      if (def.tag) {
        registry.add({
          handle,
          def: {
            kind: 'part',
            tag: def.tag,
            at: [def.at.x, def.at.y, def.at.z],
            size: [def.size.x, def.size.y, def.size.z],
          },
        })
      }
      return handle
    },
  }
}

function placeDocPart(w: WorldBuilder, p: DocPart, registry: PartRegistry, rules: RulesSystem | null) {
  const at = v3FromDoc(p.at)
  switch (p.kind) {
    case 'part': {
      const behaviors = (p.behaviors ?? [])
        .map((b) => behaviorFromDef(b))
        .filter((b): b is Behavior => b !== null)
      const def: SdkPart = {
        at,
        size: v3FromDoc(p.size),
        color: p.color,
        material: p.material,
        rotY: p.rotY,
        collide: p.collide,
        reflect: p.reflect,
        bounce: p.bounce,
        hitbox: p.hitbox ? v3FromDoc(p.hitbox) : undefined,
        behavior: behaviors.length > 0 ? behaviors : undefined,
      }
      if (rules && rules.wantsTouch([p.id, p.tag])) {
        const refs = [p.id, p.tag].filter((r): r is string => !!r)
        def.onTouch = (ctx) => rules.notifyTouch(refs, ctx)
      }
      const handle = w.add(def)
      if (p.id || p.tag) registry.add({ handle, def: p })
      break
    }
    case 'coin': w.coin(at); break
    case 'healthPack': w.healthPack(at); break
    case 'ammoSpawn': w.ammoSpawn(at); break
    case 'tree': w.tree(at, p.scale); break
    case 'cloud': w.cloud(at, p.scale); break
    case 'lava': w.lava(at, p.size ? v3FromDoc(p.size) : v3(2, 1, 2)); break
    case 'water': w.add({ at, size: p.size ? v3FromDoc(p.size) : v3(8, 1, 8), color: '#2f81f7', material: 'water', collide: false }); break
    case 'winPad': w.winPad(at, p.size ? v3FromDoc(p.size) : undefined); break
    case 'checkpoint': w.checkpoint(at, p.index ?? 1, p.size ? v3FromDoc(p.size) : undefined); break
    case 'bouncePad': w.bouncePad(at, p.power, p.size ? v3FromDoc(p.size) : undefined); break
    case 'weaponSpawn': w.weaponSpawn(at, p.weapon); break
    case 'spinnerHazard': w.spinnerHazard(at, p.radius, p.count, p.period); break
    case 'label': w.label(p.text, at, p.scale, p.color); break
    case 'light': w.light(at, { color: p.color, intensity: p.intensity, range: p.range }); break
    case 'gravityZone': w.add({
      at,
      size: v3FromDoc(p.size),
      gravityZone: p.gravity,
      color: p.color ?? '#8a5cff',
      material: 'glass',
    }); break
    case 'ladder': {
      const size = p.size ? v3FromDoc(p.size) : v3(1.4, 5, 0.25)
      const def: SdkPart = {
        at,
        size,
        color: p.color ?? '#c89c62',
        material: 'wood',
        rotY: p.rotY,
        collide: false,
        climbable: true,
      }
      if (rules && rules.wantsTouch([p.id, p.tag])) {
        const refs = [p.id, p.tag].filter((r): r is string => !!r)
        def.onTouch = (ctx) => rules.notifyTouch(refs, ctx)
      }
      const handle = w.add(def)
      if (p.id || p.tag) registry.add({ handle, def: { kind: 'part', id: p.id, tag: p.tag, at: p.at, size: [size.x, size.y, size.z] } })
      break
    }
    case 'vehicle': {
      const opts: VehicleOptions = {}
      if (p.speed !== undefined) opts.speed = p.speed
      if (p.fuel !== undefined) opts.fuel = p.fuel
      if (p.color !== undefined) opts.color = p.color
      w.vehicle(p.vehicle, at, Object.keys(opts).length > 0 ? opts : undefined)
      break
    }

    case 'button': {
      const tag = p.tag ?? 'button'
      const size = p.size ? v3FromDoc(p.size) : v3(1.6, 0.22, 1.6)
      const refs = [p.id, tag].filter((r): r is string => !!r)
      const handle = w.add({
        at, size, color: p.color ?? '#ffd166', material: 'neon', rotY: p.rotY,
        onTouch: (ctx) => {
          ctx.events.emit(`button:${tag}`, {})
          rules?.notifyTouch(refs, ctx)
        },
      })
      registry.add({ handle, def: { kind: 'part', id: p.id, tag, at: p.at, size: [size.x, size.y, size.z] } })
      break
    }
    case 'door': {
      const tag = p.tag ?? 'door'
      const size = p.size ? v3FromDoc(p.size) : v3(2, 3, 0.5)
      const def: SdkPart = { at, size, color: p.color ?? '#8a5a2b', material: p.material ?? 'wood', rotY: p.rotY }
      if (rules && rules.wantsTouch([p.id, tag])) {
        const refs = [p.id, tag].filter((r): r is string => !!r)
        def.onTouch = (ctx) => rules.notifyTouch(refs, ctx)
      }
      const handle = w.add(def)
      registry.add({ handle, def: { kind: 'part', id: p.id, tag, at: p.at, size: [size.x, size.y, size.z] } })
      break
    }
    case 'mover': {
      const size = v3FromDoc(p.size)
      const behavior = behaviorFromDef({ type: 'patrol', offset: v3FromDoc(p.by), period: p.period })
      const handle = w.add({
        at, size, color: p.color ?? '#9aa0a6', material: p.material ?? 'stone', rotY: p.rotY,
        behavior: behavior ?? undefined,
      })
      if (p.id || p.tag) {
        registry.add({ handle, def: { kind: 'part', id: p.id, tag: p.tag, at: p.at, size: p.size } })
      }
      break
    }
    case 'portal': {
      // a glowing gateway: a neon frame + an inner glass pane (decor, no
      // collision), an optional floating label, and a thin invisible-ish touch
      // slab that emits a navigation intent when the player steps through.
      const frame = p.size ? v3FromDoc(p.size) : v3(2.6, 3.2, 0.4)
      // rotY spins the whole gateway (frame + pane + touch slab) as a unit; the
      // collision/touch volume stays axis-aligned (engine AABB) — visual only.
      w.add({ at, size: frame, color: p.color ?? '#8a5cff', material: 'neon', collide: false, rotY: p.rotY })
      // inner pane: slightly inset, a shimmer the player can walk through
      w.add({
        at: v3(at.x, at.y, at.z),
        size: v3(Math.max(0.2, frame.x - 0.6), Math.max(0.2, frame.y - 0.6), 0.12),
        color: p.color ?? '#c4b5ff', material: 'glass', collide: false, rotY: p.rotY,
      })
      if (p.label) w.label(p.label, v3(at.x, at.y + frame.y / 2 + 0.6, at.z), 0.8, p.color)
      // the trigger slab — touching it asks the host to navigate
      const target = p.target
      w.add({
        at: v3(at.x, at.y, at.z),
        size: v3(Math.max(0.2, frame.x - 0.4), Math.max(0.2, frame.y - 0.4), 0.6),
        color: p.color ?? '#8a5cff', material: 'glass', collide: false, rotY: p.rotY,
        onTouch: (ctx) => ctx.events.emit('platform:goToGame', { target }),
      })
      break
    }
  }
}
