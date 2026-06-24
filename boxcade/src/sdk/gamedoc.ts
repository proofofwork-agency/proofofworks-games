// GameDoc — a Blobcade game as one JSON document. This is the platform's
// interchange format: the editor saves it, share links encode it, the studio
// edits it, the backend stores it, and buildGameFromDoc() (interpret.ts)
// turns it into a runnable GameDef. Spec: docs/GAMEDOC.md.
//
// Versioning contract (decide once, keep forever):
//   - integer `v`, linear migrateGameDoc() chain
//   - unknown FIELDS  → warn and ignore (old clients degrade gracefully)
//   - unknown VERSION → hard error ("made with a newer Blobcade")
//   - extensible content (materials, weapons, tiles, behaviors, sky presets,
//     rule actions) is referenced by registry NAME STRINGS, never by index.

import type { BehaviorDef } from '../engine/world'
import type { CombatConfig, WeaponDef } from '../engine/combat'
import type { Rule } from './rules'
import { RULE_TRIGGER_TYPES, RULE_ACTION_TYPES } from './rules'

export const GAMEDOC_VERSION = 2

/** compact JSON vector: [x, y, z] */
export type DocV3 = [number, number, number]
export type DocVehicleType = 'car' | 'jetpack' | 'boat' | 'plane'
export type StoreItemKind = 'shirt' | 'trail'

export interface StoreItem {
  id: string
  name: string
  kind: StoreItemKind
  color: string
  price: number
}

export interface GameDocMeta {
  /** assigned on publish/import; drafts may omit it */
  id?: string
  name: string
  blurb?: string
  emoji?: string
  /** css background for the portal card */
  gradient?: string
  genre?: string
  author?: string
  /** generated thumbnail (data URL) — never an uploaded asset */
  thumb?: string
}

export type StudioGameMode = 'custom' | 'obby' | 'arena' | 'waves' | 'ctf' | 'royale'

export interface GameDocStudio {
  /** editor metadata schema; ignored by runtime */
  schema?: 1
  /** visual Studio mode builder preset */
  mode?: StudioGameMode
  /** mode-specific controls, validated by Studio mode builders */
  settings?: Record<string, unknown>
  /** true when Studio owns/regenerates doc.script from mode settings */
  scriptManaged?: boolean
}

interface DocPartCommon {
  id?: string
  tag?: string
}

export type DocPart =
  | (DocPartCommon & {
      kind: 'part'
      at: DocV3
      size: DocV3
      color?: string
      material?: string
      rotY?: number
      collide?: boolean
      reflect?: boolean
      bounce?: number
      hitbox?: DocV3
      behaviors?: BehaviorDef[]
    })
  | (DocPartCommon & { kind: 'coin' | 'healthPack' | 'ammoSpawn'; at: DocV3 })
  | (DocPartCommon & { kind: 'tree' | 'cloud'; at: DocV3; scale?: number })
  | (DocPartCommon & { kind: 'lava' | 'water' | 'winPad'; at: DocV3; size?: DocV3 })
  | (DocPartCommon & { kind: 'checkpoint'; at: DocV3; index?: number; size?: DocV3 })
  | (DocPartCommon & { kind: 'bouncePad'; at: DocV3; power?: number; size?: DocV3 })
  | (DocPartCommon & { kind: 'weaponSpawn'; at: DocV3; weapon: string })
  | (DocPartCommon & { kind: 'spinnerHazard'; at: DocV3; radius: number; count?: number; period?: number })
  | (DocPartCommon & { kind: 'label'; at: DocV3; text: string; scale?: number; color?: string })
  | (DocPartCommon & { kind: 'light'; at: DocV3; color?: string; intensity?: number; range?: number })
  | (DocPartCommon & { kind: 'vehicle'; at: DocV3; vehicle: DocVehicleType; speed?: number; fuel?: number; color?: string })
  | (DocPartCommon & { kind: 'gravityZone'; at: DocV3; size: DocV3; gravity: number; color?: string })
  | (DocPartCommon & { kind: 'ladder'; at: DocV3; size?: DocV3; color?: string; rotY?: number })
  // interactive prefabs — sugar over 'part', pre-wired for rules. rotY is a
  // VISUAL-ONLY yaw (radians): these kinds place their primary slab via w.add,
  // so the mesh rotates, but collision stays axis-aligned (engine AABB).
  | (DocPartCommon & { kind: 'button'; at: DocV3; size?: DocV3; color?: string; rotY?: number })
  | (DocPartCommon & { kind: 'door'; at: DocV3; size?: DocV3; color?: string; material?: string; rotY?: number })
  | (DocPartCommon & { kind: 'mover'; at: DocV3; size: DocV3; by: DocV3; period?: number; color?: string; material?: string; rotY?: number })
  // a step-through gateway: touching it emits platform:goToGame { target }
  | (DocPartCommon & { kind: 'portal'; at: DocV3; target: string; label?: string; size?: DocV3; color?: string; rotY?: number })

export const DOC_PART_KINDS = [
  'part', 'coin', 'healthPack', 'ammoSpawn', 'tree', 'cloud', 'lava', 'water', 'winPad',
  'checkpoint', 'bouncePad', 'weaponSpawn', 'spinnerHazard', 'label', 'light',
  'vehicle', 'gravityZone', 'button', 'door', 'mover', 'portal',
  'ladder',
] as const

const DOC_VEHICLE_TYPES = ['car', 'jetpack', 'boat', 'plane'] as const

export interface GameDoc {
  blobcade: 'gamedoc'
  /** legacy marker accepted on read, omitted from new writes */
  boxcade?: 'gamedoc'
  v: number
  meta: GameDocMeta
  maxPlayers?: number
  camera?: 'orbit' | 'fp'
  physics?: { gravity?: number; jumpVel?: number; walkSpeed?: number; fallDamage?: boolean }
  /** sky preset name (built-in or registered) */
  lighting?: string
  killY?: number
  spawn?: DocV3
  rtReflections?: boolean
  combat?: CombatConfig & { selfTeam?: string }
  services?: { chat?: boolean; leaderboard?: boolean; store?: StoreItem[] }
  /** custom weapons-as-data — registered (namespaced by game id) at build */
  weapons?: WeaponDef[]
  /** an ASCII text map (the editor's native format) */
  textmap?: string
  parts?: DocPart[]
  /** voxel terrain: saved world data, or procedural seed/size */
  voxel?: { data?: string; seed?: number; size?: number; palette?: number[] }
  rules?: Rule[]
  /** named counters; declared vars get an auto HUD chip */
  vars?: Record<string, number>
  /**
   * extra levels of THIS game (depth 1 — a level may not nest its own
   * `levels`). Level 0 is the root doc; `levels[n-1]` is "level n". Each entry
   * is a GameDoc that may omit `blobcade`/`v`/`meta` (inherited from the parent)
   * and inherits `weapons`/`combat`/`physics`/`lighting` when it omits them.
   */
  levels?: GameDoc[]
  /** editor-only metadata used by advanced Studio mode builders */
  studio?: GameDocStudio
  /**
   * creator script, executed only by the sandboxed ScriptSystem and only after
   * the shell grants script permission for the current document.
   */
  script?: string
}

/** the grammar a portal/`goTo` target must match (one of four forms):
 *  `g:<publishedId>` · `draft:<key>` · `level:<n>` · `home` */
export const PORTAL_TARGET_RE = /^(g:[a-z0-9]+|draft:[\w-]+|level:\d|home)$/

// ----------------------------------------------------------- size caps ----
// Docs live forever in URLs, files and the DB — caps are part of the format.

export const GAMEDOC_LIMITS = {
  json: 256 * 1024,
  textmap: 64 * 1024,
  voxelData: 2 * 1024 * 1024,
  parts: 2000,
  rules: 200,
  actionsPerRule: 16,
  vars: 64,
  weapons: 12,
  name: 48,
  blurb: 140,
  author: 24,
  labelText: 80,
  ref: 40,
  portalLabel: 40,
  vehicleSpeed: 80,
  vehicleFuel: 600,
  gravityZone: 3,
  storeItems: 8,
  storeItemName: 24,
  storeItemPrice: 500,
  levels: 8,
  maxPlayers: 250,
  script: 64 * 1024,
  studioSettings: 16 * 1024,
} as const

// ------------------------------------------------------------ validate ----

export interface GameDocValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** present when ok — same object, typed */
  doc?: GameDoc
}

const TOP_FIELDS = new Set([
  'blobcade', 'boxcade', 'v', 'meta', 'maxPlayers', 'camera', 'physics', 'lighting', 'killY', 'spawn',
  'rtReflections', 'combat', 'services', 'weapons', 'textmap', 'parts', 'voxel', 'rules', 'vars', 'levels', 'studio', 'script',
])

const STUDIO_MODES: readonly StudioGameMode[] = ['custom', 'obby', 'arena', 'waves', 'ctf', 'royale']

export function validateGameDoc(input: unknown): GameDocValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const err = (m: string) => { errors.push(m) }
  const warn = (m: string) => { warnings.push(m) }

  if (typeof input === 'string') {
    if (input.length > GAMEDOC_LIMITS.json) {
      return { ok: false, errors: [`document too large (${input.length} bytes, max ${GAMEDOC_LIMITS.json})`], warnings }
    }
    try {
      input = JSON.parse(input)
    } catch {
      return { ok: false, errors: ['not valid JSON'], warnings }
    }
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['not a JSON object'], warnings }
  }
  const d = input as Record<string, unknown>

  const hasBlobcadeMarker = d.blobcade === 'gamedoc'
  const hasLegacyBoxcadeMarker = d.boxcade === 'gamedoc'
  if (!hasBlobcadeMarker && !hasLegacyBoxcadeMarker) {
    err(`missing blobcade: 'gamedoc' marker — is this a Blobcade game file?`)
  } else if (!hasBlobcadeMarker && hasLegacyBoxcadeMarker) {
    d.blobcade = 'gamedoc'
    delete d.boxcade
  }
  if (!Number.isInteger(d.v)) {
    err('missing or invalid version number v')
  } else if ((d.v as number) > GAMEDOC_VERSION) {
    err(`this game was made with a newer Blobcade (doc v${d.v}, this build understands v${GAMEDOC_VERSION}) — refresh / update to play it`)
  } else if ((d.v as number) < 1) {
    err(`unsupported/too-old GameDoc version v${d.v} — this build supports v1–v${GAMEDOC_VERSION}`)
  }

  validateDocBody(d, err, warn, false, '')

  const ok = errors.length === 0
  return { ok, errors, warnings, doc: ok ? (d as unknown as GameDoc) : undefined }
}

/**
 * Validate one entry of `doc.levels` (depth-1 sub-doc). A level may omit
 * `blobcade`/`v`/`meta` (inherited from the parent at build time), so those
 * three checks are skipped; it may NOT declare its own `levels`. Everything
 * else is validated exactly as a top-level doc. `path` is the error prefix
 * (e.g. `levels[0]`).
 */
function validateLevel(input: unknown, path: string, err: (m: string) => void, warn: (m: string) => void) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err(`${path}: must be a JSON object`)
  }
  const d = input as Record<string, unknown>
  // meta is optional on a level (inherited); when present it must still be valid
  if (d.meta !== undefined) validateMeta(d.meta, `${path}.meta`, err)
  validateDocBody(d, err, warn, true, `${path}.`)
}

/** the shared field validator for a doc body — top-level and per-level. */
function validateDocBody(
  d: Record<string, unknown>,
  err: (m: string) => void,
  warn: (m: string) => void,
  isLevel: boolean,
  pathPrefix: string,
) {
  for (const k of Object.keys(d)) {
    if (!TOP_FIELDS.has(k)) warn(`${pathPrefix}unknown field '${k}' ignored`)
  }

  // meta — required at the top level; on a level it is optional (inherited) and
  // validated by the caller when present.
  if (!isLevel) {
    if (d.meta === undefined || typeof d.meta !== 'object' || d.meta === null) err('meta is required')
    else validateMeta(d.meta, 'meta', err)
  }

  if (d.camera !== undefined && d.camera !== 'orbit' && d.camera !== 'fp') err(`${pathPrefix}camera must be 'orbit' or 'fp'`)
  if (d.maxPlayers !== undefined && (!Number.isInteger(d.maxPlayers) || (d.maxPlayers as number) < 1 || (d.maxPlayers as number) > GAMEDOC_LIMITS.maxPlayers)) {
    err(`${pathPrefix}maxPlayers must be an integer 1–${GAMEDOC_LIMITS.maxPlayers}`)
  }
  if (d.lighting !== undefined && typeof d.lighting !== 'string') err(`${pathPrefix}lighting must be a preset name string`)
  if (d.killY !== undefined && !isNum(d.killY)) err(`${pathPrefix}killY must be a number`)
  if (d.spawn !== undefined && !isV3(d.spawn)) err(`${pathPrefix}spawn must be [x, y, z]`)
  if (d.rtReflections !== undefined && typeof d.rtReflections !== 'boolean') err(`${pathPrefix}rtReflections must be true/false`)

  if (d.physics !== undefined) {
    const p = d.physics as Record<string, unknown>
    if (typeof p !== 'object' || p === null) err(`${pathPrefix}physics must be an object`)
    else {
      for (const k of ['gravity', 'jumpVel', 'walkSpeed']) {
        if (p[k] !== undefined && !isNum(p[k])) err(`${pathPrefix}physics.${k} must be a number`)
      }
      if (p.fallDamage !== undefined && typeof p.fallDamage !== 'boolean') err(`${pathPrefix}physics.fallDamage must be true/false`)
    }
  }

  if (d.combat !== undefined) {
    const c = d.combat as Record<string, unknown>
    if (typeof c !== 'object' || c === null) err(`${pathPrefix}combat must be an object`)
    else {
      if (c.weapons !== undefined && !Array.isArray(c.weapons)) err(`${pathPrefix}combat.weapons must be an array`)
      if (c.startWeapons !== undefined && !Array.isArray(c.startWeapons)) err(`${pathPrefix}combat.startWeapons must be an array`)
      if (c.health !== undefined && !isNum(c.health)) err(`${pathPrefix}combat.health must be a number`)
    }
  }

  if (d.services !== undefined) {
    validateServices(d.services, `${pathPrefix}services`, err)
  }

  // weapons — custom weapons-as-data, registered (namespaced) at build time
  if (d.weapons !== undefined) {
    if (!Array.isArray(d.weapons)) {
      err(`${pathPrefix}weapons must be an array`)
    } else if (d.weapons.length > GAMEDOC_LIMITS.weapons) {
      err(`${pathPrefix}too many weapons (${d.weapons.length}, max ${GAMEDOC_LIMITS.weapons})`)
    } else {
      d.weapons.forEach((wp, i) => validateWeapon(wp, `${pathPrefix}weapons[${i}]`, err, warn))
    }
  }

  if (d.textmap !== undefined) {
    if (typeof d.textmap !== 'string') err(`${pathPrefix}textmap must be a string`)
    else if (d.textmap.length > GAMEDOC_LIMITS.textmap) err(`${pathPrefix}textmap too large (max ${GAMEDOC_LIMITS.textmap} chars)`)
  }

  if (d.voxel !== undefined) {
    const vx = d.voxel as Record<string, unknown>
    if (typeof vx !== 'object' || vx === null) err(`${pathPrefix}voxel must be an object`)
    else {
      if (vx.data !== undefined) {
        if (typeof vx.data !== 'string') err(`${pathPrefix}voxel.data must be a string`)
        else if (vx.data.length > GAMEDOC_LIMITS.voxelData) err(`${pathPrefix}voxel.data too large (max ${GAMEDOC_LIMITS.voxelData} chars)`)
      }
      if (vx.seed !== undefined && !isNum(vx.seed)) err(`${pathPrefix}voxel.seed must be a number`)
      if (vx.size !== undefined && (!Number.isInteger(vx.size) || (vx.size as number) < 16 || (vx.size as number) > 256)) err(`${pathPrefix}voxel.size must be an integer 16–256`)
      if (vx.palette !== undefined && (!Array.isArray(vx.palette) || (vx.palette as unknown[]).some((n) => !Number.isInteger(n)))) err(`${pathPrefix}voxel.palette must be an array of block ids`)
    }
  }

  // parts
  if (d.parts !== undefined) {
    if (!Array.isArray(d.parts)) {
      err(`${pathPrefix}parts must be an array`)
    } else if (d.parts.length > GAMEDOC_LIMITS.parts) {
      err(`${pathPrefix}too many parts (${d.parts.length}, max ${GAMEDOC_LIMITS.parts})`)
    } else {
      d.parts.forEach((p, i) => validatePart(p, `${pathPrefix}parts[${i}]`, err, warn))
    }
  }

  // rules
  if (d.rules !== undefined) {
    if (!Array.isArray(d.rules)) {
      err(`${pathPrefix}rules must be an array`)
    } else if (d.rules.length > GAMEDOC_LIMITS.rules) {
      err(`${pathPrefix}too many rules (${d.rules.length}, max ${GAMEDOC_LIMITS.rules})`)
    } else {
      d.rules.forEach((r, i) => validateRule(r, `${pathPrefix}rules[${i}]`, err, warn))
    }
  }

  // vars
  if (d.vars !== undefined) {
    const v = d.vars as Record<string, unknown>
    if (typeof v !== 'object' || v === null || Array.isArray(v)) err(`${pathPrefix}vars must be an object of numbers`)
    else {
      const keys = Object.keys(v)
      if (keys.length > GAMEDOC_LIMITS.vars) err(`${pathPrefix}too many vars (max ${GAMEDOC_LIMITS.vars})`)
      for (const k of keys) {
        if (!isNum(v[k])) err(`${pathPrefix}vars.${k} must be a number`)
        if (k.length > GAMEDOC_LIMITS.ref) err(`${pathPrefix}var name '${k.slice(0, 20)}…' too long`)
      }
    }
  }

  // levels — extra levels of this game (depth 1: a level may not nest levels)
  if (d.levels !== undefined) {
    if (isLevel) {
      err(`${pathPrefix}levels: nested levels are not allowed (max depth 1)`)
    } else if (!Array.isArray(d.levels)) {
      err('levels must be an array')
    } else if (d.levels.length > GAMEDOC_LIMITS.levels) {
      err(`too many levels (${d.levels.length}, max ${GAMEDOC_LIMITS.levels})`)
    } else {
      if (d.v === 1 && d.levels.some((lv) => typeof (lv as Record<string, unknown>)?.script === 'string' && ((lv as Record<string, unknown>).script as string).trim())) {
        err('script requires GameDoc v2')
      }
      d.levels.forEach((lv, i) => validateLevel(lv, `levels[${i}]`, err, warn))
    }
  }

  if (d.script !== undefined) {
    if (typeof d.script !== 'string') err(`${pathPrefix}script must be a string`)
    else if (d.script.length > GAMEDOC_LIMITS.script) err(`${pathPrefix}script too large (max ${GAMEDOC_LIMITS.script} chars)`)
    else if (!isLevel && d.script.trim() && d.v === 1) err('script requires GameDoc v2')
  }

  if (d.studio !== undefined) validateStudio(d.studio, `${pathPrefix}studio`, err)
}

/** validate a meta object (shared by the top-level doc and per-level metas). */
function validateMeta(input: unknown, path: string, err: (m: string) => void) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return err(`${path} must be an object`)
  const meta = input as Record<string, unknown>
  if (typeof meta.name !== 'string' || meta.name.trim() === '') err(`${path}.name is required`)
  else if (meta.name.length > GAMEDOC_LIMITS.name) err(`${path}.name too long (max ${GAMEDOC_LIMITS.name})`)
  checkOptStr(meta, path, 'blurb', GAMEDOC_LIMITS.blurb, err)
  checkOptStr(meta, path, 'author', GAMEDOC_LIMITS.author, err)
  checkOptStr(meta, path, 'id', 64, err)
  checkOptStr(meta, path, 'emoji', 8, err)
  checkOptStr(meta, path, 'gradient', 200, err)
  checkOptStr(meta, path, 'genre', 24, err)
  checkOptStr(meta, path, 'thumb', 80 * 1024, err)
}

function validateServices(input: unknown, path: string, err: (m: string) => void) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return err(`${path} must be an object`)
  const services = input as Record<string, unknown>
  if (services.chat !== undefined && typeof services.chat !== 'boolean') err(`${path}.chat must be true/false`)
  if (services.leaderboard !== undefined && typeof services.leaderboard !== 'boolean') err(`${path}.leaderboard must be true/false`)
  if (services.store !== undefined) {
    if (!Array.isArray(services.store)) {
      err(`${path}.store must be an array`)
    } else if (services.store.length > GAMEDOC_LIMITS.storeItems) {
      err(`${path}.store too large (max ${GAMEDOC_LIMITS.storeItems})`)
    } else {
      const ids = new Set<string>()
      services.store.forEach((item, i) => validateStoreItem(item, `${path}.store[${i}]`, ids, err))
    }
  }
}

function validateStudio(input: unknown, path: string, err: (m: string) => void) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return err(`${path} must be an object`)
  const studio = input as Record<string, unknown>
  if (studio.schema !== undefined && studio.schema !== 1) err(`${path}.schema must be 1`)
  if (studio.mode !== undefined && !(STUDIO_MODES as readonly unknown[]).includes(studio.mode)) {
    err(`${path}.mode must be custom, obby, arena, waves, ctf, or royale`)
  }
  if (studio.scriptManaged !== undefined && typeof studio.scriptManaged !== 'boolean') {
    err(`${path}.scriptManaged must be true/false`)
  }
  if (studio.settings !== undefined) {
    if (typeof studio.settings !== 'object' || studio.settings === null || Array.isArray(studio.settings)) {
      err(`${path}.settings must be an object`)
    } else {
      try {
        const json = JSON.stringify(studio.settings)
        if (json.length > GAMEDOC_LIMITS.studioSettings) {
          err(`${path}.settings too large (max ${GAMEDOC_LIMITS.studioSettings} chars)`)
        }
      } catch {
        err(`${path}.settings must be JSON-serializable`)
      }
    }
  }
}

function validateStoreItem(input: unknown, path: string, ids: Set<string>, err: (m: string) => void) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return err(`${path}: not an object`)
  const item = input as Record<string, unknown>
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    err(`${path}: id is required`)
  } else if (item.id.length > GAMEDOC_LIMITS.ref) {
    err(`${path}: id too long (max ${GAMEDOC_LIMITS.ref})`)
  } else if (!isSlug(item.id)) {
    err(`${path}: id must be a lowercase slug (a–z, 0–9, dashes)`)
  } else if (ids.has(item.id)) {
    err(`${path}: duplicate id '${item.id}'`)
  } else {
    ids.add(item.id)
  }

  if (typeof item.name !== 'string' || item.name.trim() === '') err(`${path}: name is required`)
  else if (item.name.length > GAMEDOC_LIMITS.storeItemName) err(`${path}: name too long (max ${GAMEDOC_LIMITS.storeItemName})`)

  if (item.kind !== 'shirt' && item.kind !== 'trail') err(`${path}: kind must be 'shirt' or 'trail'`)
  if (typeof item.color !== 'string' || !HEX_COLOR_RE.test(item.color)) err(`${path}: color must be #rrggbb`)
  if (!Number.isInteger(item.price) || (item.price as number) < 1 || (item.price as number) > GAMEDOC_LIMITS.storeItemPrice) {
    err(`${path}: price must be an integer 1–${GAMEDOC_LIMITS.storeItemPrice}`)
  }
}

function validatePart(p: unknown, path: string, err: (m: string) => void, warn: (m: string) => void) {
  if (typeof p !== 'object' || p === null) return err(`${path}: not an object`)
  const part = p as Record<string, unknown>
  const kind = part.kind
  if (typeof kind !== 'string') return err(`${path}: missing kind`)
  if (!(DOC_PART_KINDS as readonly string[]).includes(kind)) {
    return warn(`${path}: unknown kind '${kind}' skipped`)
  }
  if (!isV3(part.at)) return err(`${path}: at must be [x, y, z]`)
  if (part.id !== undefined && (typeof part.id !== 'string' || part.id.length > GAMEDOC_LIMITS.ref)) err(`${path}: bad id`)
  if (part.tag !== undefined && (typeof part.tag !== 'string' || part.tag.length > GAMEDOC_LIMITS.ref)) err(`${path}: bad tag`)

  // rotY — optional visual yaw (radians). Honored only for kinds placed via a
  // single w.add slab (part, door, mover, button, portal, ladder); the interpreter
  // ignores it on prefab-verb kinds. Collision stays axis-aligned regardless.
  if ((kind === 'part' || kind === 'door' || kind === 'mover' || kind === 'button' || kind === 'portal' || kind === 'ladder')
      && part.rotY !== undefined && !isNum(part.rotY)) {
    err(`${path}: rotY must be a number (radians)`)
  }
  warnHexColor(part, path, 'color', warn)

  if (kind === 'part') {
    validateSize(part.size, `${path}: size`, err)
    if (part.hitbox !== undefined) validateSize(part.hitbox, `${path}: hitbox`, err)
    if (part.behaviors !== undefined) {
      if (!Array.isArray(part.behaviors)) err(`${path}: behaviors must be an array`)
      else {
        for (const b of part.behaviors as unknown[]) {
          if (typeof b !== 'object' || b === null || typeof (b as Record<string, unknown>).type !== 'string') {
            err(`${path}: each behavior needs a type`)
            break
          }
        }
      }
    }
  }
  if (kind === 'weaponSpawn' && typeof part.weapon !== 'string') err(`${path}: weapon id required`)
  if (kind === 'spinnerHazard' && !isNum(part.radius)) err(`${path}: radius required`)
  if (kind === 'mover') {
    if (!isV3(part.size)) err(`${path}: mover needs size [x,y,z]`)
    if (!isV3(part.by)) err(`${path}: mover needs by [x,y,z] (patrol offset)`)
  }
  if ((kind === 'button' || kind === 'door' || kind === 'ladder') && part.size !== undefined && !isV3(part.size)) {
    err(`${path}: size must be [x, y, z]`)
  }
  if (kind === 'label') {
    if (typeof part.text !== 'string') err(`${path}: text required`)
    else if (part.text.length > GAMEDOC_LIMITS.labelText) err(`${path}: label text too long`)
  }
  if (kind === 'vehicle') {
    if (!(DOC_VEHICLE_TYPES as readonly string[]).includes(part.vehicle as string)) {
      err(`${path}: vehicle type must be 'car', 'jetpack', 'boat', or 'plane'`)
    }
    if (part.speed !== undefined && !isNumIn(part.speed, 1, GAMEDOC_LIMITS.vehicleSpeed)) {
      err(`${path}: speed must be a number 1–${GAMEDOC_LIMITS.vehicleSpeed}`)
    }
    if (part.fuel !== undefined && !isNumIn(part.fuel, 1, GAMEDOC_LIMITS.vehicleFuel)) {
      err(`${path}: fuel must be a number 1–${GAMEDOC_LIMITS.vehicleFuel}`)
    }
  }
  if (kind === 'gravityZone') {
    validateSize(part.size, `${path}: size`, err)
    if (!isNumIn(part.gravity, 0.05, GAMEDOC_LIMITS.gravityZone)) {
      err(`${path}: gravity must be a number 0.05–${GAMEDOC_LIMITS.gravityZone}`)
    }
  }
  if (kind === 'portal') {
    validateTarget(part.target, path, err)
    if (part.label !== undefined) {
      if (typeof part.label !== 'string') err(`${path}: label must be a string`)
      else if (part.label.length > GAMEDOC_LIMITS.portalLabel) err(`${path}: label too long (max ${GAMEDOC_LIMITS.portalLabel})`)
    }
    if (part.size !== undefined && !isV3(part.size)) err(`${path}: size must be [x, y, z]`)
  }
  if ((kind === 'lava' || kind === 'water' || kind === 'winPad' || kind === 'checkpoint' || kind === 'bouncePad') && part.size !== undefined && !isV3(part.size)) {
    err(`${path}: size must be [x, y, z]`)
  }
}

/** a portal/`goTo` target must be a non-empty string matching the grammar. */
function validateTarget(target: unknown, path: string, err: (m: string) => void) {
  if (typeof target !== 'string' || target === '') {
    err(`${path}: target is required (g:<id> | draft:<key> | level:<n> | home)`)
  } else if (!PORTAL_TARGET_RE.test(target)) {
    err(`${path}: bad target '${target.slice(0, 24)}' — must be g:<id>, draft:<key>, level:<n>, or home`)
  }
}

function validateRule(r: unknown, path: string, err: (m: string) => void, warn: (m: string) => void) {
  if (typeof r !== 'object' || r === null) return err(`${path}: not an object`)
  const rule = r as Record<string, unknown>
  const when = rule.when as Record<string, unknown> | undefined
  if (typeof when !== 'object' || when === null || typeof when.type !== 'string') {
    return err(`${path}: when.type is required`)
  }
  if (!(RULE_TRIGGER_TYPES as readonly string[]).includes(when.type as string)) {
    return warn(`${path}: unknown trigger '${when.type}' — rule skipped`)
  }
  if (when.type === 'touch' && typeof when.part !== 'string') err(`${path}: touch trigger needs a part id/tag`)
  if (when.type === 'enterRegion' && (!isV3(when.min) || !isV3(when.max))) err(`${path}: enterRegion needs min/max [x,y,z]`)
  if (when.type === 'varReaches' && (typeof when.var !== 'string' || !isNum(when.gte))) err(`${path}: varReaches needs var + gte`)
  if (when.type === 'event' && typeof when.name !== 'string') err(`${path}: event trigger needs a name`)

  if (rule.if !== undefined) {
    if (!Array.isArray(rule.if)) err(`${path}: if must be an array of conditions`)
    else {
      for (const c of rule.if as Array<Record<string, unknown>>) {
        if (typeof c?.var !== 'string' || !isNum(c?.value) || !['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(c?.op as string)) {
          err(`${path}: bad condition (need var, op, value)`)
          break
        }
      }
    }
  }

  const actions = rule.do
  if (!Array.isArray(actions) || actions.length === 0) return err(`${path}: do must be a non-empty array of actions`)
  if (actions.length > GAMEDOC_LIMITS.actionsPerRule) return err(`${path}: too many actions (max ${GAMEDOC_LIMITS.actionsPerRule})`)
  actions.forEach((a, i) => {
    const act = a as Record<string, unknown>
    if (typeof act !== 'object' || act === null || typeof act.type !== 'string') {
      return err(`${path}.do[${i}]: missing type`)
    }
    if (!(RULE_ACTION_TYPES as readonly string[]).includes(act.type as string)) {
      return warn(`${path}.do[${i}]: unknown action '${act.type}' skipped`)
    }
    if ((act.type === 'toast' || act.type === 'big') && typeof act.text !== 'string') err(`${path}.do[${i}]: text required`)
    if (act.type === 'teleport' && !isV3(act.to)) err(`${path}.do[${i}]: to must be [x,y,z]`)
    if ((act.type === 'movePart' || act.type === 'removePart' || act.type === 'openDoor') && typeof act.part !== 'string') {
      err(`${path}.do[${i}]: part id/tag required`)
    }
    if (act.type === 'movePart' && act.to === undefined && act.by === undefined) err(`${path}.do[${i}]: movePart needs to or by`)
    if (act.type === 'movePart' && act.to !== undefined && !isV3(act.to)) err(`${path}.do[${i}]: to must be [x,y,z]`)
    if (act.type === 'movePart' && act.by !== undefined && !isV3(act.by)) err(`${path}.do[${i}]: by must be [x,y,z]`)
    if (act.type === 'spawnPart') validatePart(act.part, `${path}.do[${i}].part`, err, warn)
    if ((act.type === 'setVar' || act.type === 'addVar') && typeof act.var !== 'string') err(`${path}.do[${i}]: var name required`)
    if (act.type === 'setVar' && !isNum(act.value)) err(`${path}.do[${i}]: value required`)
    if (act.type === 'givePoints' && act.var !== undefined && typeof act.var !== 'string') err(`${path}.do[${i}]: givePoints var must be a string`)
    if (act.type === 'givePoints' && act.amount !== undefined && !isNum(act.amount)) err(`${path}.do[${i}]: givePoints amount must be a number`)
    if ((act.type === 'sound' || act.type === 'emit') && typeof act.name !== 'string') err(`${path}.do[${i}]: name required`)
    if (act.type === 'goTo') validateTarget(act.target, `${path}.do[${i}]`, err)
  })
}

function validateWeapon(wp: unknown, path: string, err: (m: string) => void, warn: (m: string) => void) {
  if (typeof wp !== 'object' || wp === null || Array.isArray(wp)) return err(`${path}: not an object`)
  const w = wp as Record<string, unknown>

  // id — required lowercase slug, ≤24 (gets namespaced as `${gameId}:${id}` at build)
  if (typeof w.id !== 'string' || w.id.trim() === '') err(`${path}: id is required`)
  else if (w.id.length > 24) err(`${path}: id too long (max 24)`)
  else if (!isSlug(w.id)) err(`${path}: id must be a lowercase slug (a–z, 0–9, dashes)`)

  if (typeof w.name !== 'string' || w.name.trim() === '') err(`${path}: name is required`)
  else if (w.name.length > 24) err(`${path}: name too long (max 24)`)

  if (w.kind !== 'hitscan' && w.kind !== 'projectile') err(`${path}: kind must be 'hitscan' or 'projectile'`)

  if (!isNumIn(w.damage, 1, 100)) err(`${path}: damage must be a number 1–100`)
  if (!isNumIn(w.fireRate, 0.1, 20)) err(`${path}: fireRate must be a number 0.1–20`)

  checkOptStr(w, path, 'icon', 8, err)
  if (w.pellets !== undefined && (!Number.isInteger(w.pellets) || (w.pellets as number) < 1 || (w.pellets as number) > 12)) {
    err(`${path}: pellets must be an integer 1–12`)
  }
  if (w.spread !== undefined && !isNum(w.spread)) err(`${path}: spread must be a number`)
  if (w.range !== undefined && !isNumIn(w.range, 0, 400)) err(`${path}: range must be a number ≤400`)
  checkOptStr(w, path, 'beamColor', GAMEDOC_LIMITS.ref, err)
  warnHexColor(w, path, 'beamColor', warn)
  if (w.beamWidth !== undefined && !isNum(w.beamWidth)) err(`${path}: beamWidth must be a number`)
  if (w.zoomFov !== undefined && !isNumIn(w.zoomFov, 8, 70)) err(`${path}: zoomFov must be a number 8–70`)
  if (w.ammoMax !== undefined && (!Number.isInteger(w.ammoMax) || (w.ammoMax as number) < 0 || (w.ammoMax as number) > 999)) {
    err(`${path}: ammoMax must be an integer ≤999`)
  }
  if (w.ammoPickup !== undefined && (!Number.isInteger(w.ammoPickup) || (w.ammoPickup as number) < 0)) {
    err(`${path}: ammoPickup must be a non-negative integer`)
  }
  checkOptStr(w, path, 'sound', 16, err)

  if (w.projectile !== undefined) {
    if (typeof w.projectile !== 'object' || w.projectile === null || Array.isArray(w.projectile)) {
      err(`${path}: projectile must be an object`)
    } else {
      const pr = w.projectile as Record<string, unknown>
      if (!isNumIn(pr.speed, 1, 120)) err(`${path}.projectile: speed must be a number 1–120`)
      if (!isNumIn(pr.radius, 0.05, 1)) err(`${path}.projectile: radius must be a number 0.05–1`)
      checkOptStr(pr, `${path}.projectile`, 'color', GAMEDOC_LIMITS.ref, err)
      warnHexColor(pr, `${path}.projectile`, 'color', warn)
      if (pr.gravity !== undefined && !isNum(pr.gravity)) err(`${path}.projectile: gravity must be a number`)
      if (pr.splash !== undefined && !isNumIn(pr.splash, 0, 10)) err(`${path}.projectile: splash must be a number ≤10`)
      if (pr.life !== undefined && !isNumIn(pr.life, 0, 10)) err(`${path}.projectile: life must be a number ≤10`)
    }
  }
}

function checkOptStr(obj: Record<string, unknown>, owner: string, key: string, max: number, err: (m: string) => void) {
  const v = obj[key]
  if (v === undefined) return
  if (typeof v !== 'string') err(`${owner}.${key} must be a string`)
  else if (v.length > max) err(`${owner}.${key} too long (max ${max})`)
}

function warnHexColor(obj: Record<string, unknown>, owner: string, key: string, warn: (m: string) => void) {
  const v = obj[key]
  if (v === undefined) return
  if (typeof v !== 'string' || !HEX_COLOR_RE.test(v)) {
    warn(`${owner}: ${key} "${String(v)}" should be #rrggbb (will render a default)`)
  }
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** finite number within an inclusive range */
function isNumIn(v: unknown, min: number, max: number): v is number {
  return isNum(v) && v >= min && v <= max
}

/** lowercase slug: a–z, 0–9 and dashes only (weapon ids, like the engine's) */
function isSlug(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9-]+$/.test(v)
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

function isV3(v: unknown): v is DocV3 {
  return Array.isArray(v) && v.length === 3 && v.every(isNum)
}

function validateSize(v: unknown, owner: string, err: (m: string) => void) {
  if (!isV3(v)) {
    err(`${owner} must be [x, y, z]`)
    return
  }
  const s = v as DocV3
  if (s.some((n) => n <= 0 || n > 600)) err(`${owner} out of range (0–600)`)
}

// ------------------------------------------------------------- migrate ----

/**
 * Linear migration chain. v2 is current; v1 docs are still accepted because
 * the v2 addition (`script`) is optional. validateGameDoc() has already
 * rejected versions newer than this build.
 */
export function migrateGameDoc(doc: GameDoc): GameDoc {
  let d = doc
  // while (d.v < GAMEDOC_VERSION) { d = MIGRATIONS[d.v](d) }
  void 0
  return d
}

/** stable id slug from a game name ('Lava Maze!' → 'lava-maze') */
export function slugifyName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || 'untitled'
}
