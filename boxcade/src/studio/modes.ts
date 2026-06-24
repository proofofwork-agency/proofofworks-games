import type { CombatConfig } from '../engine/combat'
import type { DocPart, GameDoc, StudioGameMode } from '../sdk/gamedoc'
import type { Rule } from '../sdk/rules'

export interface ModeControl {
  key: string
  label: string
  kind: 'number' | 'select' | 'checkbox'
  min?: number
  max?: number
  step?: number
  options?: Array<[string, string]>
}

export interface StudioScriptAnalysis {
  errors: string[]
  warnings: string[]
  capabilities: string[]
}

export interface ScriptApiEntry {
  name: string
  signature: string
  desc: string
}

interface ModeArtifacts {
  parts: DocPart[]
  rules?: Rule[]
  vars?: Record<string, number>
  script?: string
  combat?: CombatConfig & { selfTeam?: string }
  camera?: GameDoc['camera']
  lighting?: string
  spawn?: GameDoc['spawn']
  killY?: number
  maxPlayers?: number
  blurb?: string
  genre?: string
}

const MANAGED_TAG = 'mode_managed'
const MANAGED_PREFIX = 'mode_'
const MODE_EVENT_PREFIX = 'mode:'
const MODE_VAR_KEYS = ['wave', 'frags', 'red', 'blue', 'gas', 'alive', 'score']
const DENIED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
  'indexedDB', 'caches', 'localStorage', 'sessionStorage', 'document', 'window',
  'parent', 'top',
]
const RESERVED_EMIT_PREFIXES = ['combat:', 'self:', 'player:', 'game:', 'net:', 'platform:']

export const SCRIPT_API: ScriptApiEntry[] = [
  { name: 'onStart', signature: 'blobcade.onStart(fn)', desc: 'Run once after the sandbox starts.' },
  { name: 'onTick', signature: 'blobcade.onTick((time, dt, state) => {})', desc: 'Run every frame with time, delta and safe state.' },
  { name: 'on', signature: 'blobcade.on(event, fn)', desc: 'Listen to engine or custom events.' },
  { name: 'log', signature: 'blobcade.log(value)', desc: 'Write to the dev console only.' },
  { name: 'toast', signature: 'blobcade.toast(text)', desc: 'Show a small HUD message.' },
  { name: 'big', signature: 'blobcade.big(text)', desc: 'Show a large HUD message.' },
  { name: 'celebrate', signature: 'blobcade.celebrate(text?)', desc: 'Trigger the celebration flow.' },
  { name: 'win', signature: 'blobcade.win(text?)', desc: 'Mark local victory and award Blobcash.' },
  { name: 'kill', signature: 'blobcade.kill()', desc: 'Kill the local player.' },
  { name: 'teleport', signature: 'blobcade.teleport([x,y,z])', desc: 'Move the local player.' },
  { name: 'award', signature: 'blobcade.award(amount)', desc: 'Award a small amount through the host.' },
  { name: 'movePart', signature: 'blobcade.movePart(id, byOrTo, seconds?)', desc: 'Tween a registered part.' },
  { name: 'openDoor', signature: 'blobcade.openDoor(id, seconds?)', desc: 'Slide a registered part down.' },
  { name: 'removePart', signature: 'blobcade.removePart(id)', desc: 'Remove a registered part.' },
  { name: 'spawnPart', signature: 'blobcade.spawnPart(part)', desc: 'Spawn a simple part.' },
  { name: 'setVar', signature: 'blobcade.setVar(name, value)', desc: 'Set a HUD/rules counter.' },
  { name: 'addVar', signature: 'blobcade.addVar(name, amount?)', desc: 'Increment a HUD/rules counter.' },
  { name: 'sound', signature: 'blobcade.sound(name)', desc: 'Play an allowed rule sound.' },
  { name: 'emit', signature: 'blobcade.emit(name)', desc: 'Emit a custom event; engine prefixes are blocked.' },
  { name: 'goTo', signature: 'blobcade.goTo(target)', desc: 'Navigate to home, level, draft or published game.' },
  { name: 'spawnBot', signature: 'blobcade.spawnBot(opts)', desc: 'Spawn a combat bot.' },
  { name: 'setSpawnPoints', signature: 'blobcade.setSpawnPoints(points)', desc: 'Set session spawn points.' },
  { name: 'entity', signature: 'blobcade.entity(id)', desc: 'Get a limited entity command proxy.' },
]

export const SCRIPT_ENTITY_API: ScriptApiEntry[] = [
  { name: 'setObjective', signature: 'entity.setObjective([x,y,z] | null)', desc: 'Point a bot toward a target.' },
  { name: 'teleport', signature: 'entity.teleport([x,y,z])', desc: 'Move an entity.' },
  { name: 'respawn', signature: 'entity.respawn()', desc: 'Respawn an entity.' },
  { name: 'carrying', signature: 'entity.carrying(value)', desc: 'Set carrying tag metadata.' },
  { name: 'giveWeapon', signature: 'entity.giveWeapon(id)', desc: 'Give a weapon.' },
  { name: 'giveAmmo', signature: 'entity.giveAmmo()', desc: 'Refill ammo.' },
  { name: 'heal', signature: 'entity.heal(amount, capTo?)', desc: 'Heal an entity.' },
  { name: 'hurt', signature: 'entity.hurt(amount, cause?, icon?)', desc: 'Damage an entity.' },
  { name: 'deploy', signature: 'entity.deploy([x,y,z])', desc: 'Deploy/drop an entity at a point.' },
]

const SCRIPT_METHODS = new Set(SCRIPT_API.map((entry) => entry.name))
const ENTITY_METHODS = new Set(SCRIPT_ENTITY_API.map((entry) => entry.name))

export const STUDIO_MODE_LABELS: Record<StudioGameMode, string> = {
  custom: 'Custom',
  obby: 'Obby',
  arena: 'Arena',
  waves: 'Waves',
  ctf: 'CTF',
  royale: 'Mini Royale',
}

export const STUDIO_MODE_OPTIONS: Array<[StudioGameMode, string]> = [
  ['custom', STUDIO_MODE_LABELS.custom],
  ['obby', STUDIO_MODE_LABELS.obby],
  ['arena', STUDIO_MODE_LABELS.arena],
  ['waves', STUDIO_MODE_LABELS.waves],
  ['ctf', STUDIO_MODE_LABELS.ctf],
  ['royale', STUDIO_MODE_LABELS.royale],
]

export const STUDIO_MODE_CONTROLS: Record<StudioGameMode, ModeControl[]> = {
  custom: [],
  obby: [
    { key: 'stages', label: 'stages', kind: 'number', min: 4, max: 18, step: 1 },
    { key: 'heightStep', label: 'rise', kind: 'number', min: 1, max: 5, step: 0.5 },
    { key: 'lava', label: 'lava', kind: 'checkbox' },
  ],
  arena: [
    { key: 'botCount', label: 'bots', kind: 'number', min: 0, max: 12, step: 1 },
    { key: 'scoreLimit', label: 'score', kind: 'number', min: 3, max: 50, step: 1 },
    { key: 'teamMode', label: 'teams', kind: 'select', options: [['ffa', 'FFA'], ['teams', 'Teams']] },
  ],
  waves: [
    { key: 'baseBots', label: 'base bots', kind: 'number', min: 1, max: 8, step: 1 },
    { key: 'botsPerWave', label: 'scaling', kind: 'number', min: 1, max: 8, step: 1 },
    { key: 'waveDelay', label: 'delay', kind: 'number', min: 4, max: 30, step: 1 },
    { key: 'winWave', label: 'win wave', kind: 'number', min: 0, max: 30, step: 1 },
  ],
  ctf: [
    { key: 'scoreLimit', label: 'score', kind: 'number', min: 1, max: 10, step: 1 },
    { key: 'botsPerTeam', label: 'bots/team', kind: 'number', min: 0, max: 6, step: 1 },
    { key: 'respawnDelay', label: 'respawn', kind: 'number', min: 1, max: 15, step: 1 },
  ],
  royale: [
    { key: 'botCount', label: 'bots', kind: 'number', min: 2, max: 24, step: 1 },
    { key: 'lootPads', label: 'loot', kind: 'number', min: 2, max: 16, step: 1 },
    { key: 'startRadius', label: 'start gas', kind: 'number', min: 18, max: 80, step: 1 },
    { key: 'endRadius', label: 'end gas', kind: 'number', min: 6, max: 24, step: 1 },
    { key: 'shrinkEvery', label: 'shrink s', kind: 'number', min: 4, max: 30, step: 1 },
  ],
}

const DEFAULT_SETTINGS: Record<StudioGameMode, Record<string, unknown>> = {
  custom: {},
  obby: { stages: 9, heightStep: 2.5, lava: true },
  arena: { botCount: 6, scoreLimit: 15, teamMode: 'ffa' },
  waves: { baseBots: 2, botsPerWave: 2, waveDelay: 14, winWave: 0 },
  ctf: { scoreLimit: 3, botsPerTeam: 3, respawnDelay: 5 },
  royale: { botCount: 10, lootPads: 8, startRadius: 42, endRadius: 10, shrinkEvery: 8 },
}

export function getStudioMode(doc: GameDoc): StudioGameMode {
  return normalizeMode(doc.studio?.mode)
}

export function getStudioModeSettings(doc: GameDoc, mode = getStudioMode(doc)): Record<string, unknown> {
  return normalizeModeSettings(mode, doc.studio?.settings)
}

export function defaultModeSettings(mode: StudioGameMode): Record<string, unknown> {
  return { ...DEFAULT_SETTINGS[mode] }
}

export function normalizeMode(mode: unknown): StudioGameMode {
  return STUDIO_MODE_OPTIONS.some(([id]) => id === mode) ? mode as StudioGameMode : 'custom'
}

export function normalizeModeSettings(mode: StudioGameMode, raw: unknown): Record<string, unknown> {
  const out = defaultModeSettings(mode)
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  for (const control of STUDIO_MODE_CONTROLS[mode]) {
    const value = source[control.key]
    if (control.kind === 'number') {
      const n = Number(value ?? out[control.key])
      out[control.key] = clamp(Number.isFinite(n) ? n : Number(out[control.key] ?? 0), control.min ?? -Infinity, control.max ?? Infinity)
    } else if (control.kind === 'checkbox') {
      out[control.key] = Boolean(value ?? out[control.key])
    } else if (control.kind === 'select') {
      const allowed = control.options?.map(([v]) => v) ?? []
      out[control.key] = allowed.includes(String(value)) ? String(value) : out[control.key]
    }
  }
  return out
}

export function applyStudioMode(doc: GameDoc, modeIn: StudioGameMode, rawSettings: unknown): StudioScriptAnalysis {
  const mode = normalizeMode(modeIn)
  const settings = normalizeModeSettings(mode, rawSettings)
  doc.studio = { schema: 1, mode, settings, scriptManaged: mode !== 'custom' }

  if (mode === 'custom') {
    doc.studio.scriptManaged = false
    return analyzeStudioScript(doc.script ?? '')
  }

  const artifacts = buildModeArtifacts(mode, settings)
  doc.parts = [...(doc.parts ?? []).filter((p) => !isManagedPart(p)), ...artifacts.parts]
  doc.rules = [...(doc.rules ?? []).filter((r) => !isManagedRule(r)), ...(artifacts.rules ?? [])]
  doc.vars = mergeVars(doc.vars, artifacts.vars)
  doc.camera = artifacts.camera ?? doc.camera
  doc.lighting = artifacts.lighting ?? doc.lighting
  doc.spawn = artifacts.spawn ?? doc.spawn
  doc.killY = artifacts.killY
  doc.maxPlayers = artifacts.maxPlayers ?? doc.maxPlayers
  if (artifacts.combat) doc.combat = artifacts.combat
  else delete doc.combat
  if (artifacts.genre) doc.meta.genre = artifacts.genre
  if (artifacts.blurb) doc.meta.blurb = artifacts.blurb
  if (artifacts.script?.trim()) {
    doc.v = Math.max(doc.v, 2)
    doc.script = artifacts.script
  } else {
    delete doc.script
  }

  return analyzeStudioScript(doc.script ?? '')
}

export function buildModePreview(modeIn: StudioGameMode, rawSettings: unknown): ModeArtifacts {
  return buildModeArtifacts(normalizeMode(modeIn), normalizeModeSettings(normalizeMode(modeIn), rawSettings))
}

export function analyzeStudioScript(script: string): StudioScriptAnalysis {
  const errors: string[] = []
  const warnings: string[] = []
  const trimmed = script.trim()
  if (!trimmed) return { errors, warnings, capabilities: [] }
  if (script.length > 64 * 1024) warnings.push('Script is over the 64 KB GameDoc limit.')
  try {
    // Static parse only; the generated function is not invoked.
    new Function('blobcade', `"use strict";\n${script}`)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }
  for (const token of DENIED_GLOBALS) {
    if (new RegExp(`\\b${token}\\b`).test(script)) warnings.push(`${token} is not available in the script sandbox.`)
  }
  if (/\bimport\s*\(/.test(script)) warnings.push('Dynamic import() is not available in creator scripts.')
  const capabilities = [...script.matchAll(/\bblobcade\.([a-zA-Z_]\w*)/g)]
    .map((m) => m[1])
    .filter((name, i, all) => all.indexOf(name) === i)
    .sort()
  for (const name of capabilities) {
    if (!SCRIPT_METHODS.has(name)) warnings.push(`blobcade.${name} is not in the documented sandbox API.`)
  }
  const entityMethods = [...script.matchAll(/\bblobcade\.entity\([^)]*\)\.([a-zA-Z_]\w*)/g)]
    .map((m) => m[1])
    .filter((name, i, all) => all.indexOf(name) === i)
    .sort()
  for (const name of entityMethods) {
    if (!ENTITY_METHODS.has(name)) warnings.push(`entity.${name} is not in the documented entity API.`)
  }
  for (const match of script.matchAll(/\bblobcade\.emit\(\s*(['"`])([^'"`]+)\1/g)) {
    if (RESERVED_EMIT_PREFIXES.some((prefix) => match[2].startsWith(prefix))) {
      warnings.push(`Reserved engine event '${match[2]}' can be listened to, but scripts cannot emit it.`)
    }
  }
  for (const match of script.matchAll(/\bblobcade\.sound\(\s*(['"`])([^'"`]+)\1/g)) {
    if (!['coin', 'win', 'jump', 'death', 'checkpoint', 'bounce', 'splash', 'explosion', 'capture', 'chat'].includes(match[2])) {
      warnings.push(`Sound '${match[2]}' is not in the documented rule sound whitelist.`)
    }
  }
  return { errors, warnings, capabilities }
}

function buildModeArtifacts(mode: StudioGameMode, settings: Record<string, unknown>): ModeArtifacts {
  if (mode === 'obby') return obbyArtifacts(settings)
  if (mode === 'arena') return arenaArtifacts(settings)
  if (mode === 'waves') return wavesArtifacts(settings)
  if (mode === 'ctf') return ctfArtifacts(settings)
  if (mode === 'royale') return royaleArtifacts(settings)
  return { parts: [] }
}

function obbyArtifacts(settings: Record<string, unknown>): ModeArtifacts {
  const stages = num(settings.stages, 9)
  const rise = num(settings.heightStep, 2.5)
  const parts: DocPart[] = [
    part('mode_obby_start', [0, 0, 12], [8, 1, 8], '#3f9e35', 'grass'),
    { kind: 'label', id: 'mode_obby_label', tag: MANAGED_TAG, at: [0, 3, 12], text: 'MODE BUILDER OBBY', scale: 1, color: '#ffd166' },
  ]
  for (let i = 0; i < stages; i++) {
    const z = 5 - i * 7
    const y = 1 + i * rise
    const x = Math.sin(i * 1.25) * 7
    parts.push(part(`mode_obby_step_${i}`, [round(x), round(y), z], [4, 1, 4], i % 3 === 0 ? '#c89c62' : '#9aa0a6', i % 3 === 0 ? 'wood' : 'stone'))
    if (i > 0 && i % 3 === 0) parts.push({ kind: 'checkpoint', id: `mode_obby_checkpoint_${i}`, tag: MANAGED_TAG, at: [round(x), round(y + 0.7), z], index: i / 3 })
    if (settings.lava && i % 3 === 1) parts.push({ kind: 'lava', id: `mode_obby_lava_${i}`, tag: MANAGED_TAG, at: [round(x), round(y - 1.2), z - 3], size: [5, 0.6, 3] })
  }
  const finalY = 1 + stages * rise
  const finalZ = 5 - stages * 7
  parts.push(part('mode_obby_finish', [0, round(finalY), finalZ], [8, 1, 8], '#ffc94d', 'gold'))
  parts.push({ kind: 'winPad', id: 'mode_obby_win', tag: MANAGED_TAG, at: [0, round(finalY + 0.7), finalZ], size: [4, 0.5, 4] })
  return {
    genre: 'Obby',
    blurb: 'A Studio Mode Builder obby with checkpoints, hazards and a finish pad.',
    camera: 'orbit',
    lighting: 'goldenHour',
    killY: -24,
    spawn: [0, 3, 12],
    parts,
  }
}

function arenaArtifacts(settings: Record<string, unknown>): ModeArtifacts {
  const botCount = num(settings.botCount, 6)
  const scoreLimit = num(settings.scoreLimit, 15)
  const teamMode = settings.teamMode === 'teams'
  const spawns = [[18, 3, 18], [-18, 3, 18], [18, 3, -18], [-18, 3, -18]]
  return {
    genre: 'Arena',
    blurb: 'A Mode Builder arena with weapons, supplies and scripted bot pressure.',
    camera: 'fp',
    lighting: 'night',
    spawn: [0, 3, 0],
    killY: -20,
    combat: { selfTeam: teamMode ? 'red' : 'hero', health: 100, weapons: ['sidearm', 'pulse', 'flak', 'rockets', 'sniper'], startWeapons: ['sidearm', 'pulse'] },
    vars: { frags: 0 },
    parts: arenaShell('ARENA', '#ff6b6b'),
    script: `let booted = false
let frags = 0
const scoreLimit = ${scoreLimit}
const botCount = ${botCount}
const spawns = ${JSON.stringify(spawns)}

blobcade.onStart(() => {
  blobcade.setSpawnPoints([[0,3,0],[4,3,0],[-4,3,0]])
  blobcade.setVar('frags', 0)
  blobcade.toast('Arena mode: first to ' + scoreLimit + ' frags wins.')
})

blobcade.on('combat:kill', () => {
  frags += 1
  blobcade.addVar('frags', 1)
  if (frags >= scoreLimit) blobcade.win('Frag limit reached!')
})

blobcade.onTick((time, dt, state) => {
  if (!state.isHost || booted) return
  booted = true
  for (let i = 0; i < botCount; i++) {
    blobcade.spawnBot({ name: 'Arena Bot ' + (i + 1), team: ${teamMode ? "i % 2 ? 'blue' : 'red'" : "'enemy'"}, skill: Math.min(1, 0.4 + i * 0.05), spawns: [spawns[i % spawns.length]], shirt: i % 2 ? '#3b82f6' : '#e74c3c' })
  }
})
`,
  }
}

function wavesArtifacts(settings: Record<string, unknown>): ModeArtifacts {
  const baseBots = num(settings.baseBots, 2)
  const botsPerWave = num(settings.botsPerWave, 2)
  const waveDelay = num(settings.waveDelay, 14)
  const winWave = num(settings.winWave, 0)
  return {
    genre: 'Survival',
    blurb: 'A Mode Builder survival arena with escalating scripted bot waves.',
    camera: 'fp',
    lighting: 'night',
    spawn: [0, 3, 0],
    killY: -20,
    combat: { selfTeam: 'hero', health: 120, weapons: ['sidearm', 'pulse', 'flak', 'rockets'], startWeapons: ['sidearm', 'pulse'], infiniteAmmo: true },
    vars: { wave: 0 },
    parts: arenaShell('WAVES', '#9fe8d8'),
    script: `let wave = 0
let nextAt = 1
const baseBots = ${baseBots}
const botsPerWave = ${botsPerWave}
const waveDelay = ${waveDelay}
const winWave = ${winWave}
const spawns = [[22,3,22],[-22,3,22],[22,3,-22],[-22,3,-22]]

blobcade.onStart(() => {
  blobcade.setSpawnPoints([[0,3,0],[4,3,0],[-4,3,0]])
  blobcade.setVar('wave', 0)
  blobcade.toast('Wave mode: survive the bot waves.')
})

blobcade.onTick((time, dt, state) => {
  if (!state.isHost || time < nextAt) return
  wave += 1
  blobcade.setVar('wave', wave)
  blobcade.big('Wave ' + wave)
  const count = Math.min(24, baseBots + wave * botsPerWave)
  for (let i = 0; i < count; i++) {
    const s = spawns[i % spawns.length]
    blobcade.spawnBot({ name: 'Wave ' + wave + '-' + (i + 1), team: 'enemy', skill: Math.min(1, 0.35 + wave * 0.04), spawns: [s], shirt: '#e74c3c' })
  }
  if (winWave > 0 && wave >= winWave) blobcade.win('Cleared wave ' + wave + '!')
  nextAt = time + Math.max(6, waveDelay - wave)
})
`,
  }
}

function ctfArtifacts(settings: Record<string, unknown>): ModeArtifacts {
  const scoreLimit = num(settings.scoreLimit, 3)
  const botsPerTeam = num(settings.botsPerTeam, 3)
  const respawnDelay = num(settings.respawnDelay, 5)
  return {
    genre: 'CTF',
    blurb: 'A Mode Builder capture-the-flag arena with teams, flags and bot objectives.',
    camera: 'fp',
    lighting: 'space',
    spawn: [0, 3, -20],
    killY: -20,
    maxPlayers: 16,
    combat: { selfTeam: 'red', health: 100, weapons: ['sidearm', 'pulse', 'rockets', 'sniper'], startWeapons: ['sidearm', 'pulse'] },
    vars: { red: 0, blue: 0 },
    parts: [
      ...arenaShell('CAPTURE THE FLAG', '#ffffff'),
      part('mode_red_base', [0, 1, -24], [18, 1, 8], '#7f1d1d', 'stone'),
      part('mode_blue_base', [0, 1, 24], [18, 1, 8], '#1d4ed8', 'stone'),
      part('mode_red_flag', [0, 3, -24], [0.6, 3, 0.6], '#ff4d4d', 'neon', false),
      part('mode_blue_flag', [0, 3, 24], [0.6, 3, 0.6], '#4d8bff', 'neon', false),
    ],
    rules: [
      emitOnTouch('mode_blue_flag', 'mode:blueFlag'),
      emitOnTouch('mode_red_flag', 'mode:redFlag'),
      emitOnTouch('mode_red_base', 'mode:redBase'),
      emitOnTouch('mode_blue_base', 'mode:blueBase'),
    ],
    script: `let carrying = null
let redScore = 0
let blueScore = 0
const scoreLimit = ${scoreLimit}
const botsPerTeam = ${botsPerTeam}
const respawnDelay = ${respawnDelay}
const redBase = [0,3,-24]
const blueBase = [0,3,24]

blobcade.onStart(() => {
  blobcade.setSpawnPoints([[0,3,-20],[-5,3,-22],[5,3,-22]])
  blobcade.setVar('red', 0)
  blobcade.setVar('blue', 0)
  blobcade.toast('CTF mode: steal the blue flag and return to red base.')
})

blobcade.on('mode:blueFlag', () => { carrying = 'blue'; blobcade.big('Blue flag taken!') })
blobcade.on('mode:redFlag', () => { carrying = 'red'; blobcade.big('Red flag taken!') })
blobcade.on('mode:redBase', () => {
  if (carrying === 'blue') { carrying = null; redScore += 1; blobcade.addVar('red', 1); blobcade.sound('capture'); blobcade.big('Red scores!'); if (redScore >= scoreLimit) blobcade.win('Red wins!') }
})
blobcade.on('mode:blueBase', () => {
  if (carrying === 'red') { carrying = null; blueScore += 1; blobcade.addVar('blue', 1); blobcade.sound('capture'); blobcade.big('Blue scores!'); if (blueScore >= scoreLimit) blobcade.win('Blue wins!') }
})

blobcade.on('combat:kill', (event) => {
  if (event && event.victimId) setTimeout(() => blobcade.entity(event.victimId).respawn(), respawnDelay * 1000)
})

blobcade.onTick((time, dt, state) => {
  if (!state.isHost) return
  if (time < 1.5 && state.entities.length === 0) {
    for (let i = 0; i < botsPerTeam; i++) {
      blobcade.spawnBot({ name: 'Blue ' + (i + 1), team: 'blue', skill: 0.45 + i * 0.07, spawns: [[0,3,20],[-5,3,22],[5,3,22]], shirt: '#3b82f6' })
      blobcade.spawnBot({ name: 'Red ' + (i + 1), team: 'red', skill: 0.45 + i * 0.07, spawns: [[0,3,-20],[-5,3,-22],[5,3,-22]], shirt: '#e74c3c' })
    }
  }
  for (const e of state.entities) {
    if (!e.isBot || !e.alive) continue
    blobcade.entity(e.id).setObjective(e.team === 'red' ? blueBase : redBase)
  }
})
`,
  }
}

function royaleArtifacts(settings: Record<string, unknown>): ModeArtifacts {
  const botCount = num(settings.botCount, 10)
  const lootPads = num(settings.lootPads, 8)
  const startRadius = num(settings.startRadius, 42)
  const endRadius = num(settings.endRadius, 10)
  const shrinkEvery = num(settings.shrinkEvery, 8)
  const parts: DocPart[] = [
    part('mode_royale_island', [0, 0, 0], [72, 2, 72], '#75a558', 'grass'),
    { kind: 'water', id: 'mode_royale_water', tag: MANAGED_TAG, at: [0, -1.6, 0], size: [124, 1, 124] },
    part('mode_royale_center', [0, 2, 0], [14, 4, 14], '#8e9bb5', 'stone'),
    { kind: 'label', id: 'mode_royale_label', tag: MANAGED_TAG, at: [0, 9, 0], text: 'MINI ROYALE', scale: 1.3, color: '#ffe2c4' },
  ]
  const weapons = ['pulse', 'flak', 'rockets', 'sniper']
  for (let i = 0; i < lootPads; i++) {
    const a = (i / lootPads) * Math.PI * 2
    const r = 14 + (i % 3) * 7
    parts.push({ kind: 'weaponSpawn', id: `mode_loot_${i}`, tag: MANAGED_TAG, at: [round(Math.cos(a) * r), 1.5, round(Math.sin(a) * r)], weapon: weapons[i % weapons.length] })
  }
  parts.push({ kind: 'healthPack', id: 'mode_royale_health', tag: MANAGED_TAG, at: [0, 1.5, 18] })
  parts.push({ kind: 'ammoSpawn', id: 'mode_royale_ammo', tag: MANAGED_TAG, at: [-18, 1.5, 0] })
  return {
    genre: 'Royale',
    blurb: 'A Mode Builder mini royale with loot pads, bots and a shrinking gas ring.',
    camera: 'fp',
    lighting: 'goldenHour',
    spawn: [0, 35, 0],
    killY: -5,
    combat: { selfTeam: 'red', health: 100, weapons: ['sidearm', 'pulse', 'flak', 'rockets', 'sniper'], startWeapons: ['sidearm'] },
    vars: { gas: startRadius, alive: botCount + 1 },
    parts,
    script: `let booted = false
let alive = ${botCount + 1}
let nextGas = ${shrinkEvery}
let radius = ${startRadius}
const endRadius = ${endRadius}
const shrinkEvery = ${shrinkEvery}
const botCount = ${botCount}
const drops = [[-24,35,-24],[24,35,24],[-24,35,18],[18,35,-24],[0,35,28]]

blobcade.onStart(() => {
  blobcade.setVar('gas', radius)
  blobcade.setVar('alive', botCount + 1)
  blobcade.toast('Mini Royale: loot up and stay near the center.')
})

blobcade.on('combat:kill', () => {
  alive = Math.max(1, alive - 1)
  blobcade.setVar('alive', alive)
  if (alive <= 1) blobcade.win('Last player standing!')
})

blobcade.onTick((time, dt, state) => {
  if (!state.isHost) return
  if (!booted) {
    booted = true
    for (let i = 0; i < botCount; i++) {
      blobcade.spawnBot({ name: 'Dropper ' + (i + 1), team: 'enemy', skill: Math.min(1, 0.38 + i * 0.03), spawns: [drops[i % drops.length]], shirt: '#3b82f6' })
    }
  }
  if (time >= nextGas) {
    radius = Math.max(endRadius, radius - 4)
    blobcade.setVar('gas', radius)
    blobcade.toast('Gas radius: ' + radius)
    nextGas = time + shrinkEvery
  }
  for (const e of state.entities) {
    if (!e.alive) continue
    const p = e.position
    if (Math.hypot(p[0], p[2]) > radius) blobcade.entity(e.id).hurt(4, 'gas', 'gas')
    if (e.isBot) blobcade.entity(e.id).setObjective([0, 2, 0])
  }
})
`,
  }
}

function arenaShell(label: string, color: string): DocPart[] {
  return [
    part('mode_floor', [0, 0, 0], [56, 1, 56], '#2f3640', 'metal'),
    part('mode_wall_n', [0, 3, 28], [56, 6, 1], '#707b8f', 'stone'),
    part('mode_wall_s', [0, 3, -28], [56, 6, 1], '#707b8f', 'stone'),
    part('mode_wall_e', [28, 3, 0], [1, 6, 56], '#707b8f', 'stone'),
    part('mode_wall_w', [-28, 3, 0], [1, 6, 56], '#707b8f', 'stone'),
    part('mode_cover_a', [10, 1.5, 10], [4, 3, 4], '#8e9bb5', 'stone'),
    part('mode_cover_b', [-10, 1.5, -10], [4, 3, 4], '#8e9bb5', 'stone'),
    { kind: 'weaponSpawn', id: 'mode_weapon_a', tag: MANAGED_TAG, at: [17, 1.5, 17], weapon: 'rockets' },
    { kind: 'weaponSpawn', id: 'mode_weapon_b', tag: MANAGED_TAG, at: [-17, 1.5, -17], weapon: 'sniper' },
    { kind: 'healthPack', id: 'mode_health_a', tag: MANAGED_TAG, at: [0, 1.5, 18] },
    { kind: 'ammoSpawn', id: 'mode_ammo_a', tag: MANAGED_TAG, at: [18, 1.5, 0] },
    { kind: 'label', id: 'mode_label', tag: MANAGED_TAG, at: [0, 7, 0], text: label, scale: 1.2, color },
  ]
}

function part(id: string, at: [number, number, number], size: [number, number, number], color: string, material: string, collide?: boolean): DocPart {
  return { kind: 'part', id, tag: MANAGED_TAG, at, size, color, material, collide }
}

function emitOnTouch(partRef: string, name: string): Rule {
  return { when: { type: 'touch', part: partRef }, do: [{ type: 'emit', name }] }
}

function isManagedPart(part: DocPart): boolean {
  return part.id?.startsWith(MANAGED_PREFIX) === true || part.tag?.startsWith(MANAGED_PREFIX) === true || part.tag === MANAGED_TAG
}

function isManagedRule(rule: Rule): boolean {
  const touch = rule.when.type === 'touch' && rule.when.part.startsWith(MANAGED_PREFIX)
  const emits = rule.do.some((a) => a.type === 'emit' && a.name.startsWith(MODE_EVENT_PREFIX))
  return touch || emits
}

function mergeVars(existing: Record<string, number> | undefined, generated: Record<string, number> | undefined): Record<string, number> | undefined {
  const next = { ...(existing ?? {}) }
  for (const key of MODE_VAR_KEYS) delete next[key]
  for (const [key, value] of Object.entries(generated ?? {})) next[key] = value
  return Object.keys(next).length ? next : undefined
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
