// Chomp Maze — a pellet-maze arcade game drawn in src/maps/pacman.txt.
// Pac-Man-inspired gameplay, built on the Blobcade engine: eat every pellet,
// grab the four power pellets to charge up, then chomp the roaming ghosts
// before the charge runs out. All geometry, names and assets are Blobcade
// originals — see README "Licensing & inspirations".

import {
  defineGame, buildTextMap, v3, behaviors, registerTile, partMaterial,
  type Vec3, type TextMapResult, type GameContext,
} from '../sdk'
import type { RuntimePart, Behavior } from '../engine/world'
import pacMap from '../maps/pacman.txt?raw'

const FLOOR = '#0b1438'
const WALL_H = 4
const POWER_TIME = 7      // seconds a power pellet keeps ghosts edible
const HOUSE_TIME = 5      // seconds an eaten ghost sits in the house
const HOUSE = v3(0, 1.6, -1)   // center of the ghost house (cols 9–11, rows 10–11)

type Mat = RuntimePart['mesh']['material']

interface Ghost {
  name: string
  rp: RuntimePart
  start: Vec3
  baseMat: Mat
  flee: boolean
  eaten: boolean
  eatenTimer: number
  /** current waypoint index along its patrol loop */
  i: number
}

// ---- map-only tile vocabulary (registered once on import) ----
// Using lowercase chars that aren't in the built-in legend keeps these local
// to this map — they never collide with other games' text maps.
registerTile('n', (t) => {
  t.w.add({ at: v3(t.x, t.base + WALL_H / 2, t.z), size: v3(t.cell, WALL_H, t.cell), color: '#1f4dff', material: 'neon' })
})
registerTile('p', (t) => {
  t.tile(1, FLOOR, 'stone')
  t.result.coins++
  t.w.add({
    at: v3(t.x, t.base + 1.35, t.z), size: v3(0.42, 0.42, 0.42), color: '#ffe066', material: 'neon',
    collide: false, touchOnce: true,
    behavior: behaviors.bob(0.12, 2.2, (t.x + t.z) * 0.7),
    onTouch: (ctx) => { ctx.award(1); ctx.events.emit('chomp:pellet', {}) },
  })
})
registerTile('o', (t) => {
  t.tile(1, FLOOR, 'stone')
  t.result.coins++
  t.w.add({
    at: v3(t.x, t.base + 1.5, t.z), size: v3(0.95, 0.95, 0.95), color: '#ffd166', material: 'neon',
    collide: false, touchOnce: true,
    behavior: [behaviors.spin(2.2), behaviors.bob(0.16, 1.7, t.x + t.z)],
    onTouch: (ctx) => { ctx.award(1); ctx.events.emit('chomp:power', {}) },
  })
})
registerTile('g', (t) => t.tile(1, '#070b22', 'stone'))
registerTile('d', (t) => {
  t.tile(1, FLOOR, 'stone')
  t.w.add({ at: v3(t.x, t.base + 0.35, t.z), size: v3(t.cell, 0.5, t.cell), color: '#ff79c6', material: 'neon', collide: false })
})

// grid cell (row r, col c) → world center. Matches the text-map projector
// (cell 2, 21×23 grid centered on the origin): x = 2c-20, z = 2r-22.
function gc(r: number, c: number): Vec3 { return v3(2 * c - 20, 1.6, 2 * r - 22) }

// four classic ghosts, each patrolling a rectangle of open corridors.
const GHOST_DEFS = [
  { name: 'Blinky', color: '#ff4d4d', speed: 4.6, pts: [gc(1, 6), gc(1, 14), gc(21, 14), gc(21, 6)] },
  { name: 'Pinky', color: '#ffb8de', speed: 4.1, pts: [gc(4, 6), gc(4, 14), gc(8, 14), gc(8, 6)] },
  { name: 'Inky', color: '#4dd2ff', speed: 4.3, pts: [gc(13, 6), gc(13, 14), gc(17, 14), gc(17, 6)] },
  { name: 'Clyde', color: '#ffb347', speed: 3.8, pts: [gc(17, 6), gc(17, 14), gc(21, 14), gc(21, 6)] },
]

/** patrol a closed loop of waypoints; reverses while fleeing, freezes while eaten. */
function ghostBehavior(pts: Vec3[], speed: number, g: Ghost): Behavior {
  return {
    update(part, _t, dt) {
      if (g.eaten) return
      const dir = g.flee ? -1 : 1
      const target = pts[g.i]
      const dx = target.x - part.pos.x
      const dz = target.z - part.pos.z
      const dist = Math.hypot(dx, dz) || 1e-6
      const step = speed * dt
      if (dist <= step) {
        part.pos.x = target.x
        part.pos.z = target.z
        g.i = (g.i + dir + pts.length) % pts.length
      } else {
        part.pos.x += (dx / dist) * step
        part.pos.z += (dz / dist) * step
      }
    },
  }
}

let map: TextMapResult | null = null
const ghosts: Ghost[] = []
const state = { collected: 0, total: 0, powered: 0, lives: 3, over: false }
let scaredMat: Mat
let eyesMat: Mat

function onGhostTouch(ctx: GameContext, g: Ghost) {
  if (state.over || g.eaten) return
  if (state.powered > 0) {
    g.eaten = true
    g.eatenTimer = HOUSE_TIME
    g.rp.pos.x = HOUSE.x; g.rp.pos.y = HOUSE.y; g.rp.pos.z = HOUSE.z
    ctx.award(10)
    ctx.hud.toast(`👻 Chomped ${g.name}! +10`)
  } else {
    state.lives -= 1
    ctx.hud.toast(`💀 ${g.name} caught you!`)
    ctx.player.kill()
    if (state.lives <= 0) {
      state.lives = 3
      ctx.hud.big('💀 GAME OVER — back to 3 lives', 2200)
    }
  }
}

export default defineGame({
  meta: {
    id: 'chomp-maze',
    name: 'Chomp Maze',
    blurb: 'A neon pellet maze — eat every dot, grab the power pellets, and outrun four roaming ghosts.',
    emoji: '👻',
    gradient: 'linear-gradient(135deg, #0a1230 0%, #1f4dff 55%, #050816 100%)',
    genre: 'Arcade · Maze',
  },
  camera: 'orbit',

  build(w) {
    map = buildTextMap(w, pacMap)
    w.spawn(v3(0, 2.6, 18)) // bottom-center corridor (row 20, col 10)
    w.label('CHOMP MAZE', v3(0, 10, -24), 1.4, '#ffe066')
  },

  onStart(ctx) {
    state.collected = 0
    state.total = map?.coins ?? 0
    state.powered = 0
    state.lives = 3
    state.over = false
    ghosts.length = 0
    scaredMat = partMaterial('#3b6bff', 'neon')
    eyesMat = partMaterial('#dce6ff', 'neon')

    ctx.events.on('chomp:pellet', () => { state.collected++ })
    ctx.events.on('chomp:power', () => {
      state.powered = POWER_TIME
      state.collected++
      ctx.hud.toast('⚡ POWER PELLET — chomp the ghosts!')
    })

    for (const gd of GHOST_DEFS) {
      const g: Ghost = {
        name: gd.name, rp: null!, start: gd.pts[0], baseMat: null!,
        flee: false, eaten: false, eatenTimer: 0, i: 1,
      }
      ctx.addPart({
        at: gd.pts[0], size: v3(1.4, 1.6, 1.4), color: gd.color, material: 'neon', collide: false,
        behavior: ghostBehavior(gd.pts, gd.speed, g),
        onTouch: (c) => onGhostTouch(c, g),
      })
      const rp = ctx.engine.parts.parts[ctx.engine.parts.parts.length - 1]
      g.rp = rp
      g.baseMat = rp.mesh.material
      ghosts.push(g)
    }

    ctx.hud.set('pellets', `🟡 0/${state.total}`)
    ctx.hud.set('lives', `❤️ ${state.lives}`)
    ctx.hud.toast('Eat every pellet! Power pellets let you chomp ghosts.')
    ctx.systemChat('Tip: drag the mouse up for a top-down view of the maze.')
  },

  onTick(ctx, dt) {
    if (state.over) return
    if (state.powered > 0) state.powered -= dt
    const scared = state.powered > 0

    for (const g of ghosts) {
      if (g.eaten) {
        g.eatenTimer -= dt
        if (g.eatenTimer <= 0) {
          g.eaten = false
          g.rp.pos.x = g.start.x; g.rp.pos.y = g.start.y; g.rp.pos.z = g.start.z
          g.i = 1
        }
      }
      g.flee = scared && !g.eaten
      const want: Mat = g.eaten ? eyesMat : (g.flee ? scaredMat : g.baseMat)
      if (g.rp.mesh.material !== want) g.rp.mesh.material = want
    }

    ctx.hud.set('pellets', `🟡 ${Math.min(state.collected, state.total)}/${state.total}`)
    ctx.hud.set('lives', `❤️ ${state.lives}`)
    if (scared) ctx.hud.set('power', `⚡ ${Math.max(0, state.powered).toFixed(1)}s`)
    else ctx.hud.remove('power')

    if (state.collected >= state.total) {
      state.over = true
      ctx.celebrate('🏆 MAZE CLEARED!')
      ctx.earnBlobcash(150, 'maze cleared')
    }
  },
})
