// Wolfden — a stone-keep maze shooter in the classic grid-dungeon tradition:
// a seeded dungeon of tall blue-brick walls, roaming guards, scattered
// arsenal/treasure, and an exit elevator at the far corner. First-person,
// run the same character physics as every Blobcade game. All geometry, names,
// weapons and rules here are Blobcade originals — see README "Licensing".

import { defineGame, v3, type Vec3 } from '../sdk'

// --------------------------------------------------------------- map tuning --

const COLS = 31
const ROWS = 31
const CELL = 2.4
const WALL_H = 4.2
const SEED = 0xc0ffee

const WALL_COLOR = '#7886a0'
const FLOOR_COLOR = '#454b57'
const TRIM_COLOR = '#5d6781'

const GUARD_NAMES = ['Krieg', 'Sable', 'Volt', 'Reinhardt', 'Nyx', 'Brick', 'Halo', 'Vex', 'Drake', 'Ash']
const GUARD_COUNT = 8

// ----------------------------------------------------- deterministic RNG (mulberry32) --

function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------- dungeon layout --

type Grid = boolean[][]

function carveMaze(rng: () => number): Grid {
  const walls: Grid = Array.from({ length: COLS }, () => new Array(ROWS).fill(true))
  const stack: Array<[number, number]> = [[1, 1]]
  walls[1][1] = false
  const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]]
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]
    const order = dirs.slice()
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    let moved = false
    for (const [dc, dr] of order) {
      const nc = c + dc
      const nr = r + dr
      if (nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1 && walls[nc][nr]) {
        walls[nc][nr] = false
        walls[c + dc / 2][r + dr / 2] = false
        stack.push([nc, nr])
        moved = true
        break
      }
    }
    if (!moved) stack.pop()
  }
  return walls
}

// a few rectangular halls so it reads as rooms + corridors, not a tight maze
function carveRooms(walls: Grid, rng: () => number): void {
  for (let i = 0; i < 5; i++) {
    const cw = 4 + Math.floor(rng() * 4)
    const ch = 4 + Math.floor(rng() * 4)
    const c0 = 2 + Math.floor(rng() * (COLS - cw - 4))
    const r0 = 2 + Math.floor(rng() * (ROWS - ch - 4))
    for (let c = c0; c < c0 + cw; c++)
      for (let r = r0; r < r0 + ch; r++) walls[c][r] = false
  }
}

// knock holes between corridors so there are loops and sightlines to fight in
function openLoops(walls: Grid, rng: () => number): void {
  for (let c = 2; c < COLS - 2; c++) {
    for (let r = 2; r < ROWS - 2; r++) {
      if (!walls[c][r] || rng() > 0.14) continue
      const horiz = !walls[c - 1][r] && !walls[c + 1][r]
      const vert = !walls[c][r - 1] && !walls[c][r + 1]
      if (horiz || vert) walls[c][r] = false
    }
  }
}

// greedy rectangle merge → big wall slabs (few draw calls, clean Wolf-style blocks)
function mergeWalls(walls: Grid): Array<{ c: number; r: number; w: number; h: number }> {
  const used: Grid = Array.from({ length: COLS }, () => new Array(ROWS).fill(false))
  const boxes: Array<{ c: number; r: number; w: number; h: number }> = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!walls[c][r] || used[c][r]) continue
      let w = 1
      while (c + w < COLS && walls[c + w][r] && !used[c + w][r]) w++
      let h = 1
      let growing = true
      while (growing && r + h < ROWS) {
        for (let i = 0; i < w; i++) {
          if (!walls[c + i][r + h] || used[c + i][r + h]) { growing = false; break }
        }
        if (growing) h++
      }
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) used[c + i][r + j] = true
      boxes.push({ c, r, w, h })
    }
  }
  return boxes
}

// ----------------------------------------------------------------- session state --

const originX = (-COLS * CELL) / 2
const originZ = (-ROWS * CELL) / 2

function cellCenter(c: number, r: number): Vec3 {
  return v3(originX + (c + 0.5) * CELL, 0, originZ + (r + 0.5) * CELL)
}

let floorCells: Vec3[] = []
let coinTotal = 0
let guardCount = 0
let roamAt = new Map<string, number>()

function pickSpread(cells: Vec3[], n: number, minSep2: number, rng: () => number): Vec3[] {
  const chosen: Vec3[] = []
  const pool = cells.slice()
  let guard = 0
  while (chosen.length < n && guard++ < 4000 && pool.length) {
    const idx = Math.floor(rng() * pool.length)
    const cand = pool[idx]
    let ok = true
    for (const ch of chosen) {
      const dx = cand.x - ch.x
      const dz = cand.z - ch.z
      if (dx * dx + dz * dz < minSep2) { ok = false; break }
    }
    pool.splice(idx, 1)
    if (ok) chosen.push(cand)
  }
  return chosen
}

function pickScatter(cells: Vec3[], n: number, rng: () => number): Vec3[] {
  const pool = cells.slice()
  const out: Vec3[] = []
  while (out.length < n && pool.length) {
    const idx = Math.floor(rng() * pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

// remove + return n cells, preferring the ones closest to `near` first
function takeNear(cells: Vec3[], n: number, near: Vec3, rng: () => number): Vec3[] {
  void rng
  const sorted = cells
    .map((c) => ({ c, d: (c.x - near.x) ** 2 + (c.z - near.z) ** 2 }))
    .sort((a, b) => a.d - b.d)
  const out: Vec3[] = []
  for (const { c } of sorted) {
    if (out.length >= n) break
    const idx = cells.indexOf(c)
    if (idx >= 0) { cells.splice(idx, 1); out.push(c) }
  }
  return out
}

// ----------------------------------------------------------------- the game --

export default defineGame({
  meta: {
    id: 'wolfden',
    name: 'Wolfden',
    blurb: 'A stone-keep dungeon maze. Clear the guards, loot the arsenal, ride the exit elevator.',
    emoji: '🐺',
    gradient: 'linear-gradient(135deg, #2b3553 0%, #7886a0 55%, #11151f 100%)',
    genre: 'Dungeon Maze Shooter · Bots',
  },
  camera: 'fp',
  rtReflections: true, // the exit elevator deck mirrors the torch-lit walls
  // the signature run-and-gun: a fast hitscan carbine (the classic machine gun)
  weapons: [{
    id: 'carbine', name: 'Combat Carbine', icon: '🔫', kind: 'hitscan',
    damage: 16, fireRate: 8, spread: 0.03, range: 90,
    beamColor: '#ffe08a', beamWidth: 0.04,
    ammoMax: 120, ammoPickup: 40, botRange: [6, 80], sound: 'minigun',
  }],
  combat: {
    selfTeam: 'red',
    health: 100,
    respawnSeconds: 4,
    startWeapons: ['sidearm'],
  },

  build(w) {
    w.lighting('morning')
    w.killY(-12)

    const rng = makeRng(SEED)
    const walls = carveMaze(rng)
    carveRooms(walls, rng)
    openLoops(walls, rng)

    const startCell = cellCenter(1, 1)
    const exitCell = cellCenter(COLS - 2, ROWS - 2)

    // floor — one slab, no voids (falling is impossible inside the keep)
    w.add({ at: v3(0, -0.5, 0), size: v3(COLS * CELL, 1, ROWS * CELL), color: FLOOR_COLOR, material: 'stone' })

    // walls — merged into big slabs
    for (const b of mergeWalls(walls)) {
      const x0 = originX + b.c * CELL
      const z0 = originZ + b.r * CELL
      const sx = b.w * CELL
      const sz = b.h * CELL
      w.add({
        at: v3(x0 + sx / 2, WALL_H / 2, z0 + sz / 2),
        size: v3(sx, WALL_H, sz),
        color: WALL_COLOR, material: 'stone',
      })
    }

    // a darker cap trim along the top of the outer curtain so the keep reads as stone
    w.add({ at: v3(0, WALL_H + 0.15, 0), size: v3(COLS * CELL, 0.3, ROWS * CELL), color: TRIM_COLOR, material: 'stone', collide: false })

    // spawn + exit
    w.spawn(v3(startCell.x, 1.6, startCell.z))

    // exit elevator — a glowing metal shaft at the far corner
    w.add({ at: v3(exitCell.x, 0.05, exitCell.z), size: v3(CELL * 2.2, 0.2, CELL * 2.2), color: '#5b6675', material: 'metal', reflect: true })
    w.winPad(
      v3(exitCell.x, 0.6, exitCell.z),
      v3(CELL * 2.4, 0.4, CELL * 2.4),
      (ctx) => {
        ctx.earnBlobcash(150, 'keep cleared')
        ctx.systemChat('🛉 You rode the elevator out — the keep is clear!')
      },
    )
    w.label('🛉 EXIT', v3(exitCell.x, WALL_H + 1.4, exitCell.z), 0.9, '#ffd9a8')
    w.label('🐺 WOLFDEN', v3(0, WALL_H + 2.6, 0), 1.6, '#cdd6ff')

    // collect floor cells for item / guard placement (skip a safe bubble around spawn)
    const safe2 = (CELL * 4) * (CELL * 4)
    floorCells = []
    for (let c = 1; c < COLS - 1; c++) {
      for (let r = 1; r < ROWS - 1; r++) {
        if (walls[c][r]) continue
        const p = cellCenter(c, r)
        const dx = p.x - startCell.x
        const dz = p.z - startCell.z
        if (dx * dx + dz * dz < safe2) continue
        floorCells.push(p)
      }
    }

    // torches — a warm brazier every few cells for mood (mesh only, no per-light cost)
    for (let c = 1; c < COLS - 1; c++) {
      for (let r = 1; r < ROWS - 1; r++) {
        if (walls[c][r]) continue
        if ((c + r) % 5 !== 0) continue
        const p = cellCenter(c, r)
        w.add({ at: v3(p.x, WALL_H - 0.5, p.z), size: v3(0.35, 0.35, 0.35), color: '#ff9d3c', material: 'neon', collide: false })
        w.add({ at: v3(p.x, WALL_H - 0.85, p.z), size: v3(0.18, 0.5, 0.18), color: '#3a2a1a', material: 'wood', collide: false })
      }
    }
    // a handful of REAL point lights at spread intersections (kept few on purpose)
    const lightCells = pickSpread(floorCells, 8, (CELL * 7) * (CELL * 7), rng)
    for (const p of lightCells) {
      w.light(v3(p.x, WALL_H - 1.1, p.z), { color: '#ffb866', intensity: 90, range: 22 })
    }
    w.light(v3(exitCell.x, WALL_H - 1, exitCell.z), { color: '#ffd9a8', intensity: 140, range: 24 })

    // a shared, consumed pool so pickups never stack on the same tile
    const placeable = floorCells.slice()

    // arsenal — the carbine closest to spawn so the player upgrades fast, then
    // progressively heavier guns deeper into the keep
    const kits = ['carbine', 'minigun', 'flak', 'shock', 'carbine']
    const weaponCells = takeNear(placeable, kits.length, startCell, rng)
    for (let i = 0; i < weaponCells.length; i++) {
      w.weaponSpawn(v3(weaponCells[i].x, 1.6, weaponCells[i].z), kits[i])
    }
    // ammo + health
    for (const p of pickScatter(placeable, 9, rng)) w.ammoSpawn(v3(p.x, 1.4, p.z))
    for (const p of pickScatter(placeable, 6, rng)) w.healthPack(v3(p.x, 1.4, p.z))
    // treasure
    const coinCells = pickScatter(placeable, 12, rng)
    coinTotal = coinCells.length
    for (const p of coinCells) w.coin(v3(p.x, 1.4, p.z))
  },

  onStart(ctx) {
    guardCount = GUARD_COUNT
    roamAt = new Map()
    ctx.setSpawnPoints([v3(originX + 1.5 * CELL, 1.6, originZ + 1.5 * CELL)])

    // guards far from spawn, spread across the keep
    const rng = makeRng(SEED ^ 0x9e3779b9)
    const spots = pickSpread(floorCells, GUARD_COUNT, (CELL * 6) * (CELL * 6), rng)
    for (let i = 0; i < GUARD_COUNT; i++) {
      const at = spots[i % spots.length]
      const bot = ctx.spawnBot({
        name: GUARD_NAMES[i % GUARD_NAMES.length],
        team: 'blue',
        skill: 0.42 + (i % 3) * 0.08,
        spawns: [v3(at.x, 1.6, at.z)],
        shirt: '#8a3b3b',
      })
      bot.giveWeapon('carbine')
      if (i % 4 === 0) bot.giveWeapon('minigun') // a few tougher enforcers
      bot.giveAmmo()
    }

    ctx.hud.set('guards', `🐺 ${guardCount} guards`)
    ctx.hud.set('coins', `🪙 0/${coinTotal}`)
    ctx.hud.set('obj', `🛉 Find the exit`)
    ctx.hud.big('🐺 WOLFDEN', 2200)
    ctx.systemChat('You start with only a Sidearm. Grab the Combat Carbine, clear the keep, ride the 🛉 exit elevator.')
    ctx.systemChat('Keys 1–4 switch weapons · right-click zooms · / chat · R reset.')
  },

  onTick(ctx, dt) {
    const aliveGuards = ctx.entities.filter((e) => e.team === 'blue' && e.alive).length
    ctx.hud.set('guards', `🐺 ${aliveGuards} guards`)

    // guards roam the dungeon; half drift toward the player to keep pressure
    for (const e of ctx.entities) {
      if (!e.isBot || !e.alive || e.team !== 'blue') continue
      const next = roamAt.get(e.id) ?? 0
      if (ctx.time < next) continue
      roamAt.set(e.id, ctx.time + 5 + Math.random() * 5)
      if (Math.random() < 0.5) {
        const p = ctx.player.position
        e.setObjective(v3(p.x + (Math.random() - 0.5) * 10, 1.6, p.z + (Math.random() - 0.5) * 10))
      } else if (floorCells.length) {
        const c = floorCells[Math.floor(Math.random() * floorCells.length)]
        e.setObjective(v3(c.x, 1.6, c.z))
      }
    }
  },

  onKill(ctx, info) {
    if (info.killerIsSelf) {
      ctx.earnBlobcash(10, 'guard down')
      ctx.hud.toast('💵 Guard down')
    }
  },
})
