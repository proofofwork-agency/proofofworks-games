// Disaster Island — a Blobcade remake of the "survive the island while disasters
// strike" genre (à la Natural Disaster Survival). Each round a random disaster is
// telegraphed, then erupts for ~half a minute. Stay alive to bank a Survival and
// grow your streak. Six original disaster implementations — tornado, meteor
// shower, lightning storm, tsunami flood, earthquake and acid rain — all built
// from the SDK's runtime parts, behaviors and particle power API.
//
// All geometry, names, sounds and rules here are Blobcade originals — see the
// README "Licensing & inspirations" section.

import { defineGame, v3, type Vec3, type GameContext, type SdkPart, type PartHandle } from '../sdk'
import { audio } from '../engine/audio'
import { Vector3 } from 'three'

// --------------------------------------------------------------- world consts --

const SURFACE = 1            // top of the grass — the island's walking height
const HALF = 26              // island half-extent (the playable ~52m square)
const SPAWN: Vec3 = v3(0, SURFACE + 2, 0)
const OBSERVE: Vec3 = v3(0, 31, 0)   // high spectate deck for eliminated players

// round-state machine timing (seconds)
const T_INTERMISSION = 7
const T_WARNING = 5
const T_RESOLVE = 4.5

// acid-rain shelter volumes (under solid roofs). { xz box, top of the roof }
interface Shelter { minX: number; maxX: number; minZ: number; maxZ: number; top: number }
const SHELTERS: Shelter[] = [
  { minX: -24.5, maxX: -15.5, minZ: -6.5, maxZ: 2.5, top: 6.8 }, // wooden house (west)
  { minX: -5.5, maxX: 5.5, minZ: 9.5, maxZ: 18.5, top: 4.8 },    // beach café (south)
]

// ----------------------------------------------------------- disaster contract --

interface Disaster {
  id: string
  name: string
  emoji: string
  tip: string
  duration: number
  begin(ctx: GameContext): void
  tick(ctx: GameContext, dt: number, elapsed: number): void
  end(ctx: GameContext): void
}

// ----------------------------------------------------------- runtime part pool --
// Disasters only ever spawn *temporary* parts (tracked here) and clear them when
// the round ends — the static island is never mutated, so the map resets itself.

let liveParts: PartHandle[] = []
function spawnPart(ctx: GameContext, def: SdkPart): PartHandle {
  const h = ctx.addPart(def)
  liveParts.push(h)
  return h
}
function clearParts(): void {
  for (const h of liveParts) { try { h.remove() } catch { /* already gone */ } }
  liveParts = []
}

// anyone above the spectate deck is immune — disasters only threaten the island
const SAFE_Y = 28
const vulnerable = (c: GameContext): boolean => c.player.position.y < SAFE_Y

// ============================================================ disasters ========

// ---- 🌪️ Tornado: a wandering vortex that sucks in and flings anyone nearby ----
function tornado(): Disaster {
  let cx = 0, cz = 0            // vortex center (xz)
  let tx = 0, tz = 0            // wander target
  let wanderIn = 0
  let core: PartHandle | null = null
  const debris: Array<{ h: PartHandle; r: number; y: number; off: number; spd: number }> = []
  return {
    id: 'tornado', name: 'Tornado', emoji: '🌪️',
    tip: 'Run from the spinning vortex — it flings you to your doom!',
    duration: 30,
    begin(ctx) {
      const a = Math.random() * Math.PI * 2
      cx = Math.cos(a) * 22; cz = Math.sin(a) * 22
      tx = 0; tz = 0; wanderIn = 0
      core = spawnPart(ctx, { at: v3(cx, 9, cz), size: v3(2.6, 18, 2.6), color: '#3b2f2f', material: 'plastic', collide: false })
      for (let i = 0; i < 16; i++) {
        const h = spawnPart(ctx, {
          at: v3(cx, 2 + i * 1.3, cz), size: v3(1.2, 1.2, 1.2),
          color: i % 2 ? '#6b7280' : '#9ca3af', material: 'stone', collide: false,
        })
        debris.push({ h, r: 3 + (i % 5), y: 1.5 + i * 1.3, off: Math.random() * 6.28, spd: 4 + Math.random() * 2 })
      }
      audio.flagAlarm()
    },
    tick(ctx, dt, t) {
      wanderIn -= dt
      if (wanderIn <= 0) {
        wanderIn = 2.5 + Math.random() * 2
        tx = (Math.random() * 2 - 1) * 19
        tz = (Math.random() * 2 - 1) * 19
      }
      cx += (tx - cx) * Math.min(1, dt * 0.6)
      cz += (tz - cz) * Math.min(1, dt * 0.6)
      if (core) { core.pos.x = cx; core.pos.z = cz }
      for (const d of debris) {
        const ang = d.off + t * d.spd
        d.h.pos.x = cx + Math.cos(ang) * d.r
        d.h.pos.z = cz + Math.sin(ang) * d.r
        d.h.pos.y = d.y + Math.sin(t * 3 + d.off) * 0.5
      }
      const p = ctx.player.position
      const dist = Math.hypot(p.x - cx, p.z - cz)
      if (dist < 9 && dist > 0.1) {                    // suction pull toward the eye
        ctx.player.launch(v3((cx - p.x) * dt * 5, 0, (cz - p.z) * dt * 5))
      }
      if (dist < 3.2 && p.y < 27) {                    // caught in the funnel → yeet + doom
        ctx.player.launch(v3((Math.random() * 2 - 1) * 20, 26, (Math.random() * 2 - 1) * 20))
        ctx.player.kill()
      }
    },
    end() { /* clearParts() reaps everything */ },
  }
}

// ---- ☄️ Meteor Shower: flaming rocks rain down, leaving burning patches ----
function meteorShower(): Disaster {
  interface Meteor { h: PartHandle; x: number; z: number; y: number }
  let meteors: Meteor[] = []
  let next = 0
  return {
    id: 'meteor', name: 'Meteor Shower', emoji: '☄️',
    tip: 'Keep moving — flaming rocks rain from the sky!',
    duration: 28,
    begin(ctx) { meteors = []; next = 0; audio.flagAlarm() },
    tick(ctx, dt) {
      next -= dt
      if (next <= 0) {
        next = 0.45 + Math.random() * 0.5
        let x: number, z: number
        if (Math.random() < 0.4) {   // lead the player a little
          const p = ctx.player.position
          x = p.x + (Math.random() * 2 - 1) * 4; z = p.z + (Math.random() * 2 - 1) * 4
        } else {
          x = (Math.random() * 2 - 1) * (HALF - 2); z = (Math.random() * 2 - 1) * (HALF - 2)
        }
        const h = spawnPart(ctx, {
          at: v3(x, 42, z), size: v3(1.5, 1.5, 1.5), color: '#ff7a18', material: 'neon',
          collide: false, onTouch: (c) => { if (vulnerable(c)) c.player.kill() },
        })
        meteors.push({ h, x, z, y: 42 })
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        m.y -= 20 * dt
        m.h.pos.y = m.y
        if (m.y <= SURFACE + 0.7) {
          ctx.engine.fx.burst(new Vector3(m.x, SURFACE + 0.5, m.z), {
            count: 22, colors: ['#ff7a18', '#ffd166', '#9a4a16'], speed: 9, life: 0.7, size: 0.5, up: 1.6,
          })
          const p = ctx.player.position
          if (Math.hypot(p.x - m.x, p.z - m.z) < 2.6 && p.y < SURFACE + 3.5) ctx.player.kill()
          audio.explosion()
          spawnPart(ctx, {                               // lingering fire patch
            at: v3(m.x, SURFACE + 0.2, m.z), size: v3(1.8, 0.4, 1.8), color: '#ff5a1f', material: 'lava',
            collide: false, onTouch: (c) => { if (vulnerable(c)) c.player.kill() },
          })
          m.h.remove()
          meteors.splice(i, 1)
        }
      }
    },
    end() {},
  }
}

// ---- ⚡ Lightning Storm: telegraphed marks on the ground, then a strike ----
function lightningStorm(): Disaster {
  interface Strike { x: number; z: number; marker: PartHandle; fireAt: number; fired: boolean }
  let strikes: Strike[] = []
  let bolts: Array<{ h: PartHandle; removeAt: number }> = []
  let next = 0
  return {
    id: 'lightning', name: 'Lightning Storm', emoji: '⚡',
    tip: "Don't stand on the glowing marks — a bolt is incoming!",
    duration: 26,
    begin(ctx) { strikes = []; bolts = []; next = 0.6 },
    tick(ctx, dt, t) {
      next -= dt
      if (next <= 0) {
        next = 1.0 + Math.random() * 0.8
        let x: number, z: number
        if (Math.random() < 0.45) {
          const p = ctx.player.position
          x = p.x + (Math.random() * 2 - 1) * 2; z = p.z + (Math.random() * 2 - 1) * 2
        } else {
          x = (Math.random() * 2 - 1) * (HALF - 2); z = (Math.random() * 2 - 1) * (HALF - 2)
        }
        const marker = spawnPart(ctx, {
          at: v3(x, SURFACE + 0.15, z), size: v3(2.6, 0.2, 2.6), color: '#7dd3fc', material: 'neon', collide: false,
        })
        strikes.push({ x, z, marker, fireAt: t + 1.2, fired: false })
      }
      for (let i = strikes.length - 1; i >= 0; i--) {
        const s = strikes[i]
        if (!s.fired && t >= s.fireAt) {
          s.fired = true
          const bolt = spawnPart(ctx, {
            at: v3(s.x, 14, s.z), size: v3(0.5, 28, 0.5), color: '#ffffff', material: 'neon', collide: false,
          })
          bolts.push({ h: bolt, removeAt: t + 0.18 })
          ctx.engine.fx.burst(new Vector3(s.x, SURFACE + 1, s.z), {
            count: 26, colors: ['#ffffff', '#7dd3fc', '#bae6fd'], speed: 11, life: 0.5, size: 0.4, up: 1.2,
          })
          audio.explosion()
          const p = ctx.player.position
          if (Math.hypot(p.x - s.x, p.z - s.z) < 2.7 && p.y < SAFE_Y) ctx.player.kill()
          s.marker.remove()
        }
        if (s.fired) strikes.splice(i, 1)
      }
      for (let i = bolts.length - 1; i >= 0; i--) {
        if (t >= bolts[i].removeAt) { bolts[i].h.remove(); bolts.splice(i, 1) }
      }
    },
    end() {},
  }
}

// ---- 🌊 Tsunami: the sea itself rises — race to high ground ----
function tsunami(): Disaster {
  let level = -3                 // current water surface height
  let water: PartHandle | null = null
  const MAX = 6.3                // flood crest (house roof at 6.8 stays dry)
  const RATE = 0.42              // m/s rise
  return {
    id: 'tsunami', name: 'Tsunami', emoji: '🌊',
    tip: 'The sea is rising — climb to the highest ground NOW!',
    duration: 30,
    begin(ctx) {
      level = -3
      water = spawnPart(ctx, {
        at: v3(0, -5, 0), size: v3(150, 4, 150), color: '#2f8fb8', material: 'water',
        collide: false, onTouch: (c) => c.player.kill(),
      })
      audio.flagAlarm()
    },
    tick(ctx, dt) {
      level = Math.min(MAX, level + RATE * dt)
      if (water) water.pos.y = level - 2           // box top tracks `level`
      if (Math.random() < dt * 2) {
        ctx.engine.fx.burst(
          new Vector3((Math.random() * 2 - 1) * 20, Math.max(SURFACE, level), (Math.random() * 2 - 1) * 20),
          { count: 8, colors: ['#bfeaff', '#7dd3fc'], speed: 4, life: 0.5, size: 0.3, up: 1.4 },
        )
      }
    },
    end() {},
  }
}

// ---- 🌍 Earthquake: the world lurches, debris rains, cracks split the ground ----
function earthquake(): Disaster {
  let nextShake = 0
  let nextDebris = 0
  interface Chunk { h: PartHandle; x: number; z: number; y: number }
  let chunks: Chunk[] = []
  return {
    id: 'quake', name: 'Earthquake', emoji: '🌍',
    tip: 'The ground is heaving — dodge falling debris and the glowing cracks!',
    duration: 26,
    begin(ctx) {
      nextShake = 0; nextDebris = 0; chunks = []
      // two lava fault-lines cross the island
      spawnPart(ctx, { at: v3(0, SURFACE + 0.1, 0), size: v3(HALF * 1.6, 0.3, 2.2), color: '#ff5a1f', material: 'lava', collide: false, onTouch: (c) => c.player.kill() })
      spawnPart(ctx, { at: v3(0, SURFACE + 0.1, 0), size: v3(2.2, 0.3, HALF * 1.6), color: '#ff5a1f', material: 'lava', collide: false, onTouch: (c) => c.player.kill() })
      audio.flagAlarm()
    },
    tick(ctx, dt) {
      nextShake -= dt
      if (nextShake <= 0) {                       // periodic jolt
        nextShake = 1.0 + Math.random() * 0.5
        const p = ctx.player.position
        ctx.player.launch(v3((Math.random() * 2 - 1) * 5, 5 + Math.random() * 3, (Math.random() * 2 - 1) * 5))
        ctx.engine.fx.burst(new Vector3(p.x, SURFACE + 0.5, p.z), {
          count: 10, colors: ['#a8a29e', '#78716c'], speed: 3, life: 0.6, size: 0.3, up: 0.8,
        })
        audio.land()
      }
      nextDebris -= dt
      if (nextDebris <= 0) {                      // falling rubble
        nextDebris = 0.65 + Math.random() * 0.5
        const x = (Math.random() * 2 - 1) * (HALF - 3)
        const z = (Math.random() * 2 - 1) * (HALF - 3)
        const h = spawnPart(ctx, {
          at: v3(x, 16, z), size: v3(1.4, 1.4, 1.4), color: '#9ca3af', material: 'stone',
          collide: false, onTouch: (c) => c.player.kill(),
        })
        chunks.push({ h, x, z, y: 16 })
      }
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i]
        c.y -= 14 * dt
        c.h.pos.y = c.y
        if (c.y <= SURFACE + 0.8) {
          ctx.engine.fx.burst(new Vector3(c.x, SURFACE + 0.5, c.z), {
            count: 10, colors: ['#9ca3af', '#78716c'], speed: 5, life: 0.5, size: 0.35,
          })
          c.h.remove()
          chunks.splice(i, 1)
        }
      }
    },
    end() {},
  }
}

// ---- 🌧️ Acid Rain: lethal downpour — survive only under a roof ----
function acidRain(): Disaster {
  let exposure = 0
  let nextDrip = 0
  const LETHAL = 6                              // seconds of unsheltered time → death
  return {
    id: 'acid', name: 'Acid Rain', emoji: '🌧️',
    tip: 'Take cover under a roof — the green rain is lethal!',
    duration: 28,
    begin(ctx) {
      exposure = 0; nextDrip = 0
      spawnPart(ctx, { at: v3(0, 23, 0), size: v3(HALF * 2.8, 1, HALF * 2.8), color: '#a3e635', material: 'glass', collide: false })
      audio.flagAlarm()
    },
    tick(ctx, dt, t) {
      const p = ctx.player.position
      const sheltered = p.y > 28 || SHELTERS.some((s) =>
        p.x > s.minX && p.x < s.maxX && p.z > s.minZ && p.z < s.maxZ && p.y < s.top + 1)
      if (sheltered) exposure = Math.max(0, exposure - dt * 1.5)
      else exposure += dt
      nextDrip -= dt
      if (nextDrip <= 0) {
        nextDrip = 0.05
        ctx.engine.fx.burst(
          new Vector3(p.x + (Math.random() * 2 - 1) * 12, 18, p.z + (Math.random() * 2 - 1) * 12),
          { count: 3, colors: ['#a3e635', '#84cc16', '#bef264'], speed: 1, life: 1.2, size: 0.18, gravity: -2, up: -1 },
        )
      }
      ctx.hud.set('acid', sheltered ? '🛡️ Sheltered' : `☠️ Exposure ${Math.ceil(LETHAL - exposure)}s`)
      if (exposure >= LETHAL) { ctx.player.kill(); exposure = 0 }
      void t
    },
    end(ctx) { ctx.hud.remove('acid') },
  }
}

const DISASTER_FACTORIES: Array<() => Disaster> = [
  tornado, meteorShower, lightningStorm, tsunami, earthquake, acidRain,
]
let lastDisasterIdx = -1
function pickDisaster(): Disaster {
  let i = lastDisasterIdx
  while (i === lastDisasterIdx && DISASTER_FACTORIES.length > 1) {
    i = Math.floor(Math.random() * DISASTER_FACTORIES.length)
  }
  lastDisasterIdx = i
  return DISASTER_FACTORIES[i]()
}

// =============================================================== round state ==

type Phase = 'intermission' | 'warning' | 'active' | 'resolve'
let phase: Phase = 'intermission'
let phaseT = 0
let round = 0
let streak = 0
let best = 0
let current: Disaster | null = null
let diedThisRound = false

function resetState(): void {
  phase = 'intermission'
  phaseT = 0
  round = 0
  streak = 0
  current = null
  diedThisRound = false
  clearParts()
}

function resolveRound(ctx: GameContext): void {
  current?.end(ctx)
  clearParts()
  ctx.hud.remove('acid')
  if (!diedThisRound) {
    streak++
    best = Math.max(best, streak)
    const reward = 15 + streak * 2
    ctx.award(reward)
    ctx.earnBlobcash(5 + Math.min(streak, 10), `survived ${current?.name ?? 'a disaster'}`)
    ctx.hud.toast(`✅ Survived ${current?.name ?? ''}! +${reward} 🪙`)
    ctx.hud.set('streak', `🔥 Streak ${streak} · Best ${best}`)
    if (streak > 0 && streak % 5 === 0) ctx.celebrate(`🔥 ${streak}-SURVIVAL STREAK!`)
    else audio.capture()
  } else {
    streak = 0
    ctx.hud.toast(`💀 You didn't survive the ${current?.name ?? 'disaster'}.`)
    ctx.hud.set('streak', `🔥 Streak 0 · Best ${best}`)
    audio.death()
  }
  phase = 'resolve'
  phaseT = 0
  ctx.player.teleport(OBSERVE)   // watch the calm before the next round
}

// =============================================================== the game ====

export default defineGame({
  meta: {
    id: 'disaster-island',
    name: 'Disaster Island',
    blurb: 'Stranded on an island where a new disaster strikes every round. Survive the tornado, tsunami, meteors and more to grow your streak.',
    emoji: '🌪️',
    gradient: 'linear-gradient(135deg, #1f3a5f 0%, #c0392b 55%, #2c1414 100%)',
    genre: 'Survival · Rounds',
  },
  maxPlayers: 50,
  camera: 'orbit',
  rtReflections: true,   // the ocean + beacon glass mirror the chaos
  services: { leaderboard: true },

  build(w) {
    w.lighting('goldenHour')
    w.killY(-1.2)             // the ocean is death
    w.spawn(SPAWN)

    // ---- the ocean: a reflective shore band over a deep plain ----
    w.add({ at: v3(0, -2.3, 0), size: v3(180, 0.6, 180), color: '#1d4e6e', material: 'ice', collide: false })
    w.add({ at: v3(0, -2.45, 0), size: v3(360, 0.5, 360), color: '#16384f', material: 'plastic', collide: false })

    // ---- the island: stone shelf + grass top + sand fringe ----
    w.add({ at: v3(0, -0.66, 0), size: v3(HALF * 2 + 6, 3.2, HALF * 2 + 6), color: '#7e848c', material: 'stone' })
    w.add({ at: v3(0, 0.5, 0), size: v3(HALF * 2, 1, HALF * 2), color: '#75a558', material: 'grass' })
    w.add({ at: v3(0, 0.08, 0), size: v3(HALF * 2 + 6, 0.5, HALF * 2 + 6), color: '#d9c489', material: 'sand' })

    // grounded slab helper (base sits on SURFACE)
    const slab = (x: number, z: number, sx: number, sy: number, sz: number, color: string, material: Parameters<typeof w.add>[0]['material'] = 'stone', rotY = 0) =>
      w.add({ at: v3(x, SURFACE + sy / 2, z), size: v3(sx, sy, sz), color, material, rotY })
    const label = (text: string, x: number, z: number, y = 14, s = 0.8, c = '#ffe2c4') =>
      w.label(text, v3(x, y, z), s, c)

    label('🌪️ DISASTER ISLAND', 0, -HALF + 3, 10, 1.4)
    label('Survive the round to score!', 0, -HALF + 7, 8, 0.6, '#ffd9ae')

    // ---- central spawn plaza: a ring of pillars marking the safe start ----
    w.add({ at: v3(0, SURFACE + 0.15, 0), size: v3(10, 0.3, 10), color: '#c8b478', material: 'wood' })
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      w.add({ at: v3(Math.cos(a) * 5.5, SURFACE + 1.4, Math.sin(a) * 5.5), size: v3(0.7, 2.8, 0.7), color: '#8d8275', material: 'stone' })
    }

    // ---- watchtower (east): the island's high ground, reached by one boost ----
    label('🗼 TOWER', 18, -14, 20)
    slab(18, -14, 7, 15, 7, '#8b9099')
    w.add({ at: v3(18, SURFACE + 15.4, -14), size: v3(8.6, 0.5, 8.6), color: '#46525f', material: 'metal' })     // parapet deck
    w.add({ at: v3(18, SURFACE + 18.5, -14), size: v3(1.6, 5.5, 1.6), color: '#aab4bd', material: 'metal' })       // mast
    w.add({ at: v3(18, SURFACE + 21.4, -14), size: v3(2.6, 1.2, 2.6), color: '#ffd166', material: 'neon' })        // beacon
    w.light(v3(18, SURFACE + 16, -14), { color: '#ffd9a8', intensity: 120, range: 26 })
    w.bouncePad(v3(18, SURFACE + 0.3, -14), 38)   // single boost to the parapet

    // ---- wooden house (west): roof = acid-rain shelter + dry ground in a flood ----
    label('🏠 HOUSE', -20, -2, 11)
    for (const [px, pz] of [[-23.5, -5.5], [-16.5, -5.5], [-23.5, 1.5], [-16.5, 1.5]] as const) {
      w.add({ at: v3(px, SURFACE + 2.8, pz), size: v3(0.7, 5.6, 0.7), color: '#7a5a3a', material: 'wood' })
    }
    w.add({ at: v3(-20, SURFACE + 6.4, -2), size: v3(9, 0.8, 10), color: '#9a4a3c', material: 'wood' })             // roof (top ≈ 6.8)
    w.add({ at: v3(-20, SURFACE + 0.15, -2), size: v3(8, 0.3, 9), color: '#b08968', material: 'wood' })             // floor
    w.bouncePad(v3(-20, SURFACE + 0.3, 6), 24)   // up onto the roof

    // ---- beach café (south): low roof = acid shelter (but floods in a tsunami) ----
    label('☕ CAFÉ', 0, 14, 9)
    for (const [px, pz] of [[-4.5, 10.5], [4.5, 10.5], [-4.5, 17.5], [4.5, 17.5]] as const) {
      w.add({ at: v3(px, SURFACE + 2, pz), size: v3(0.6, 4, 0.6), color: '#8fa3b8', material: 'plastic' })
    }
    w.add({ at: v3(0, SURFACE + 4.5, 14), size: v3(11, 0.6, 9), color: '#5d8fc0', material: 'plastic' })            // roof (top ≈ 4.8)
    w.bouncePad(v3(0, SURFACE + 0.3, 8), 18)     // onto the café roof

    // ---- a jetty running out into the sea (south) ----
    w.add({ at: v3(0, -0.1, HALF + 6), size: v3(5, 0.5, 16), color: '#9a6f54', material: 'wood' })

    // ---- mid-island parkour platforms (extra escape routes + coin run) ----
    w.add({ at: v3(10, SURFACE + 3.2, 8), size: v3(4, 0.5, 4), color: '#7c828c', material: 'stone' })
    w.add({ at: v3(-9, SURFACE + 3.6, 10), size: v3(4, 0.5, 4), color: '#7c828c', material: 'stone' })
    w.add({ at: v3(7, SURFACE + 5.2, -6), size: v3(3.5, 0.5, 3.5), color: '#8d97a5', material: 'stone' })

    // ---- scatter: trees, rocks, crates, clouds (decor + flung-from cover) ----
    for (const [tx, tz] of [[-12, 12], [12, -18], [-14, -16], [22, 8], [-22, 18]] as const) w.tree(v3(tx, SURFACE, tz), 1 + Math.random() * 0.4)
    for (const [rx, rz, s] of [[6, -4, 1.4], [-6, -10, 1.1], [14, 16, 1.6], [-18, 8, 1.2]] as const) {
      w.add({ at: v3(rx, SURFACE + s * 0.6, rz), size: v3(2 * s, 1.2 * s, 2 * s), color: '#7d8794', material: 'stone' })
    }
    for (const [cx, cz] of [[3, 3], [-3, -3], [20, -2]] as const) {
      w.add({ at: v3(cx, SURFACE + 0.8, cz), size: v3(1.6, 1.6, 1.6), color: '#a37a4a', material: 'wood' })
    }
    for (let i = 0; i < 7; i++) w.cloud(v3((i % 2 ? -1 : 1) * (16 + (i * 6) % 20), 18 + (i % 3) * 4, (i * 9) % 40 - 20), 0.8 + (i % 3) * 0.4)

    // ---- coins around the island (a little reward for exploring) ----
    for (let i = 0; i < 6; i++) w.coin(v3(-5 + i * 2, SURFACE + 3.5, -6))

    // ---- spectate deck: where the eliminated wait out the round (very high) ----
    w.add({ at: v3(0, 30, 0), size: v3(9, 0.5, 9), color: '#46525f', material: 'metal' })
    label('💀 Spectating — next round soon', 0, 0, 32.4, 0.6, '#ffd9ae')
  },

  onStart(ctx) {
    resetState()
    best = 0
    ctx.hud.set('round', '🌀 Round 0')
    ctx.hud.set('streak', '🔥 Streak 0 · Best 0')
    ctx.hud.big('🌪️ DISASTER ISLAND', 2600)
    ctx.systemChat('A new disaster strikes every round. Read the warning, get to safety, and SURVIVE!')
    ctx.systemChat('Flood → climb high · Acid rain → take cover · Tornado → run · Meteors/Lightning → keep moving.')
    audio.flagAlarm()
  },

  onTick(ctx, dt) {
    phaseT += dt

    if (phase === 'intermission') {
      const left = Math.max(0, Math.ceil(T_INTERMISSION - phaseT))
      ctx.hud.set('round', `🌀 Get ready — Round ${round + 1} in ${left}s`)
      if (phaseT >= T_INTERMISSION) {                 // → WARNING: pick the disaster
        round++
        current = pickDisaster()
        diedThisRound = false
        phase = 'warning'
        phaseT = 0
        ctx.player.teleport(SPAWN)                    // fresh start each round
        ctx.hud.big(`${current.emoji} ${current.name.toUpperCase()}`, 2400)
        ctx.hud.toast(`⚠️ ${current.tip}`)
        ctx.systemChat(`⚠️ INCOMING: ${current.name} — ${current.tip}`)
        ctx.hud.set('round', `🌀 Round ${round}`)
        audio.flagAlarm()
      }
      return
    }

    if (phase === 'warning') {
      const left = Math.max(0, Math.ceil(T_WARNING - phaseT))
      ctx.hud.set('round', `${current!.emoji} ${current!.name} in ${left}s — ${current!.tip}`)
      if (phaseT >= T_WARNING) {                       // → ACTIVE: unleash it
        phase = 'active'
        phaseT = 0
        current!.begin(ctx)
        ctx.hud.big(`${current!.emoji} TAKE COVER!`, 1400)
        audio.explosion()
      }
      return
    }

    if (phase === 'active') {
      current!.tick(ctx, dt, phaseT)
      const left = Math.max(0, Math.ceil(current!.duration - phaseT))
      ctx.hud.set('round', `${current!.emoji} ${current!.name} — ${left}s`)
      if (phaseT >= current!.duration) resolveRound(ctx)
      return
    }

    // resolve
    if (phaseT >= T_RESOLVE) {
      phase = 'intermission'
      phaseT = 0
      clearParts()
      ctx.player.teleport(SPAWN)
      ctx.hud.set('round', `🌀 Round ${round} cleared`)
    }
  },

  onRespawn(ctx) {
    // Non-combat: every death routes here. Caught during a disaster = round lost,
    // then warp up to the spectate deck to watch the rest safely.
    if (phase === 'active' && !diedThisRound) {
      diedThisRound = true
      ctx.hud.toast(`💀 Caught by the ${current?.name ?? 'disaster'}!`)
    }
    if (phase === 'active') {
      ctx.player.teleport(OBSERVE)
    }
  },
})
