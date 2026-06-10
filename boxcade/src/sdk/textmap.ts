// ============================================================================
//  Text maps — draw a Boxcade level in a plain text file.
//
//  Each character is one tile (default 2x2 meters). Rows are north→south,
//  the map is centered on the origin. Stack floors with `---` separators.
//  Vite hot-reloads .txt files, and the visual Map Editor (#/editor) reads
//  and writes this exact format.
//
//  TILE LEGEND
//    .  (or space)  empty / void — falling here is death
//    #  stone floor block            G  grass block
//    O  wooden planks                X  brick
//    I  ice (slippery!)              N  glowing neon block
//    M  metal deck plate (mirror-shiny; reflective in RT games)
//    1–9  stone column, that many blocks tall (stairs, walls, towers)
//    L  lava — touching it kills     B  bounce pad
//    C  floor tile + hovering coin   T  grass tile + tree on top
//    K  checkpoint pad (auto-numbered in reading order)
//    S  spawn pad (where players appear)
//    W  golden win pad (confetti + fanfare)
//    H  health pack (+35 hp in combat games, respawns)
//    A  ammo crate (tops up held weapons in combat games, respawns)
//    F  RED flag stand    f  BLUE flag stand     (CTF marker tiles)
//    r  RED team spawn    b  BLUE team spawn     (marker tiles)
//
//  DIRECTIVES (anywhere in the file)
//    @lighting goldenHour      noon | morning | goldenHour | night | space
//    @cell 2                   tile size in meters
//    @layerstep 4              height between `---` layers
//    @killy -18                fall-death height
//    @gravity 46               gravity strength (m/s², positive number)
//    @jump 14                  jump velocity
//    @speed 8                  walk speed
//    // comment lines are ignored
//
//  LAYERS
//    ---        next floor, +layerstep higher
//    --- +6     next floor, +6 higher
// ============================================================================

import { v3, type Vec3 } from '../engine/math'
import { SKY_PRESETS } from '../engine/sky'
import type { WorldBuilder } from './index'

export interface ParsedTextMap {
  directives: Record<string, string>
  /** layers[i] = rows of tile chars */
  layers: string[][]
  /** absolute base height of each layer */
  layerOffsets: number[]
  cell: number
  layerStep: number
}

export interface TextMapResult {
  coins: number
  checkpoints: number
  spawnFound: boolean
  layers: number
  size: { cols: number; rows: number }
  /** CTF + combat markers (world coordinates) */
  redFlag: Vec3 | null
  blueFlag: Vec3 | null
  redSpawns: Vec3[]
  blueSpawns: Vec3[]
  healthPacks: number
  ammoCrates: number
}

export const LIGHTING_NAMES = ['noon', 'morning', 'goldenHour', 'night', 'space'] as const
type LightingName = (typeof LIGHTING_NAMES)[number]

export function parseTextMap(source: string): ParsedTextMap {
  const directives: Record<string, string> = {}
  let cell = 2
  let layerStep = 4
  const layers: string[][] = [[]]
  const layerOffsets: number[] = [0]

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed === '') continue

    if (trimmed.startsWith('@')) {
      const m = trimmed.match(/^@(\w+)\s+(.+)$/)
      if (m) {
        const key = m[1].toLowerCase()
        directives[key] = m[2].trim()
        if (key === 'cell') cell = clampNum(parseFloat(m[2]), 1, 8, 2)
        if (key === 'layerstep') layerStep = clampNum(parseFloat(m[2]), 2, 30, 4)
      }
      continue
    }

    if (trimmed.startsWith('---')) {
      const stepMatch = trimmed.match(/\+\s*(\d+(?:\.\d+)?)/)
      const step = stepMatch ? parseFloat(stepMatch[1]) : layerStep
      layerOffsets.push(layerOffsets[layerOffsets.length - 1] + step)
      layers.push([])
      continue
    }

    layers[layers.length - 1].push(line)
  }
  return { directives, layers, layerOffsets, cell, layerStep }
}

export function serializeTextMap(parsed: ParsedTextMap): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(parsed.directives)) {
    if (String(v).trim() !== '') out.push(`@${k} ${v}`)
  }
  out.push('')
  parsed.layers.forEach((rows, i) => {
    if (i > 0) {
      const step = parsed.layerOffsets[i] - parsed.layerOffsets[i - 1]
      out.push(step === parsed.layerStep ? '---' : `--- +${step}`)
    }
    out.push(...rows)
    out.push('')
  })
  return out.join('\n')
}

// ---------------------------------------------------------- tile registry --

/** everything a tile handler needs to build its cell */
export interface TileContext {
  w: WorldBuilder
  /** world-space center of this tile */
  x: number
  z: number
  /** base height of the current layer */
  base: number
  /** tile size in meters */
  cell: number
  /** running tallies + CTF markers — mutate to report what you placed */
  result: TextMapResult
  /** convenience: a cell-sized solid block of the given height on this tile */
  tile(height: number, color: string, material?: Parameters<WorldBuilder['add']>[0]['material']): void
}

export type TileHandler = (t: TileContext) => void

const TILE_HANDLERS = new Map<string, TileHandler>()

/**
 * Registry-pattern extension point: claim a character for your own tile.
 * Registered handlers work in every text map AND in the visual editor's
 * "Apply text" path.
 *
 *   registerTile('J', (t) => { t.tile(1, '#222', 'stone'); t.w.bouncePad(v3(t.x, t.base + 1.5, t.z), 40) })
 */
export function registerTile(ch: string, handler: TileHandler) {
  if (ch.length !== 1 || ch === '.' || ch === ' ' || ch === '_') {
    console.warn(`[boxcade] registerTile: '${ch}' must be a single non-empty character`)
    return
  }
  if (TILE_HANDLERS.has(ch)) console.warn(`[boxcade] registerTile: overwriting '${ch}'`)
  TILE_HANDLERS.set(ch, handler)
}

// the built-in vocabulary (see the legend at the top of this file)
registerTile('#', (t) => t.tile(1, '#9aa0a6', 'stone'))
registerTile('G', (t) => t.tile(1, '#6cc04a', 'grass'))
registerTile('O', (t) => t.tile(1, '#c89c62', 'wood'))
registerTile('X', (t) => t.tile(1, '#b5564e', 'stone'))
registerTile('I', (t) => t.tile(1, '#bfeaff', 'ice'))
registerTile('N', (t) => t.tile(1, '#59f7d2', 'neon'))
registerTile('M', (t) =>
  t.w.add({ at: v3(t.x, t.base + 0.5, t.z), size: v3(t.cell, 1, t.cell), color: '#46525f', material: 'metal', reflect: true }))
registerTile('L', (t) => t.w.lava(v3(t.x, t.base + 0.5, t.z), v3(t.cell, 1, t.cell)))
registerTile('B', (t) => t.w.bouncePad(v3(t.x, t.base + 0.5, t.z), 24, v3(t.cell, 1, t.cell)))
registerTile('C', (t) => {
  t.tile(1, '#9aa0a6', 'stone')
  t.w.coin(v3(t.x, t.base + 2.2, t.z))
  t.result.coins++
})
registerTile('T', (t) => {
  t.tile(1, '#6cc04a', 'grass')
  t.w.tree(v3(t.x, t.base + 1, t.z))
})
registerTile('K', (t) => {
  t.result.checkpoints++
  t.w.checkpoint(v3(t.x, t.base + 0.5, t.z), t.result.checkpoints, v3(t.cell, 1, t.cell))
})
registerTile('S', (t) => {
  t.tile(1, '#6cc04a', 'grass')
  if (!t.result.spawnFound) {
    t.w.spawn(v3(t.x, t.base + 1.6, t.z))
    t.result.spawnFound = true
  }
})
registerTile('W', (t) => t.w.winPad(v3(t.x, t.base + 0.5, t.z), v3(t.cell, 1, t.cell)))
registerTile('H', (t) => {
  t.tile(1, '#3a4654', 'metal')
  t.w.healthPack(v3(t.x, t.base + 1.8, t.z))
  t.result.healthPacks++
})
registerTile('A', (t) => {
  t.tile(1, '#4a4234', 'metal')
  t.w.ammoSpawn(v3(t.x, t.base + 1.8, t.z))
  t.result.ammoCrates++
})
registerTile('D', (t) => {
  // door: a gate block rules can open — all textmap doors share tag 'door'
  t.tile(1, '#9aa0a6', 'stone')
  t.w.add({
    at: v3(t.x, t.base + 1 + 1.3, t.z), size: v3(t.cell, 2.6, t.cell),
    color: '#8a5a2b', material: 'wood', tag: 'door',
  })
})
registerTile('P', (t) => {
  // pressure plate: touch fires rules (tag 'button') + emits 'button:button'
  t.tile(1, '#9aa0a6', 'stone')
  t.w.add({
    at: v3(t.x, t.base + 1.11, t.z), size: v3(t.cell * 0.8, 0.22, t.cell * 0.8),
    color: '#ffd166', material: 'neon', tag: 'button',
    onTouch: (ctx) => ctx.events.emit('button:button', {}),
  })
})
registerTile('F', (t) => {
  t.tile(1, '#e74c3c', 'neon')
  t.result.redFlag = v3(t.x, t.base + 1, t.z)
})
registerTile('f', (t) => {
  t.tile(1, '#3b82f6', 'neon')
  t.result.blueFlag = v3(t.x, t.base + 1, t.z)
})
registerTile('r', (t) => {
  t.tile(1, '#7d3b3b', 'stone')
  t.result.redSpawns.push(v3(t.x, t.base + 1.6, t.z))
})
registerTile('b', (t) => {
  t.tile(1, '#39517d', 'stone')
  t.result.blueSpawns.push(v3(t.x, t.base + 1.6, t.z))
})
for (let n = 1; n <= 9; n++) {
  registerTile(String(n), (t) => t.tile(n, '#8f959b', 'stone'))
}

// ----------------------------------------------------------------- build --

export function buildTextMap(w: WorldBuilder, source: string | ParsedTextMap): TextMapResult {
  const parsed = typeof source === 'string' ? parseTextMap(source) : source
  const { directives, layers, layerOffsets, cell } = parsed

  // ---- apply directives ----
  const lighting = directives.lighting
  if (lighting && SKY_PRESETS[lighting]) {
    w.lighting(lighting as LightingName) // registry-aware: custom presets work too
  }
  if (directives.killy) w.killY(clampNum(parseFloat(directives.killy), -500, 0, -20))
  const phys: { gravity?: number; jumpVel?: number; walkSpeed?: number } = {}
  if (directives.gravity) phys.gravity = -Math.abs(clampNum(parseFloat(directives.gravity), 4, 200, 46))
  if (directives.jump) phys.jumpVel = clampNum(parseFloat(directives.jump), 4, 50, 14.2)
  if (directives.speed) phys.walkSpeed = clampNum(parseFloat(directives.speed), 2, 40, 8.2)
  if (Object.keys(phys).length > 0) w.physics(phys)

  const rows = Math.max(...layers.map((l) => l.length), 1)
  const cols = Math.max(...layers.flatMap((l) => l.map((r) => r.length)), 1)
  const originX = (-cols * cell) / 2
  const originZ = (-rows * cell) / 2

  const result: TextMapResult = {
    coins: 0,
    checkpoints: 0,
    spawnFound: false,
    layers: layers.length,
    size: { cols, rows },
    redFlag: null,
    blueFlag: null,
    redSpawns: [],
    blueSpawns: [],
    healthPacks: 0,
    ammoCrates: 0,
  }

  layers.forEach((grid, li) => {
    const base = layerOffsets[li]
    grid.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]
        if (ch === '.' || ch === ' ' || ch === '_') continue
        const handler = TILE_HANDLERS.get(ch)
        if (!handler) {
          console.warn(`[boxcade] text map: unknown tile '${ch}' at row ${r}, col ${c} (layer ${li})`)
          continue
        }
        const x = originX + (c + 0.5) * cell
        const z = originZ + (r + 0.5) * cell
        handler({
          w, x, z, base, cell, result,
          tile(height, color, material = 'stone') {
            w.add({ at: v3(x, base + height / 2, z), size: v3(cell, height, cell), color, material })
          },
        })
      }
    })
  })

  return result
}

function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback
  return Math.min(hi, Math.max(lo, v))
}
