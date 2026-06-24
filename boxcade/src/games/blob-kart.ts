// Blob Kart — an arcade kart racer built on the Blobcade SDK.
//
// The whole circuit is generated from one rounded-rectangle centerline: the
// road, barriers, start gate, checkpoints, coins and the wrong-way detector
// all derive from it, so reshaping the track is just tweaking the constants
// below. Hop in a kart with E and complete 3 laps.

import { defineGame, v3, behaviors, type GameContext } from '../sdk'

// ---- track geometry constants (tweak to reshape the circuit) ----
const RXc = 50          // half-extent X (to the outer barrier centerline)
const RZc = 34          // half-extent Z
const RC = 14           // corner radius
const HW = 6            // road half-width (distance centerline -> wall)
const SX = RXc - RC     // straight half-length along X  (36)
const SZ = RZc - RC     // straight half-length along Z  (20)
const SEG_S = 9         // samples per straight
const SEG_C = 7         // samples per corner arc
const TOTAL_LAPS = 3

const ROAD = '#474b55'
const WALL_A = '#e6eaf0'
const WALL_B = '#e63946'

type Pt = { x: number; z: number }

// ---- centerline (closed loop, counter-clockwise) ----
function buildCenterline(): Pt[] {
  const cl: Pt[] = []
  // 1. right straight: z -SZ -> +SZ at x = RXc
  for (let i = 0; i <= SEG_S; i++) cl.push({ x: RXc, z: -SZ + (2 * SZ * i) / SEG_S })
  // 2. TR arc, center ( SX,  SZ), a 0 -> 90
  for (let i = 1; i <= SEG_C; i++) { const a = (Math.PI / 2) * i / SEG_C; cl.push({ x: SX + RC * Math.cos(a), z: SZ + RC * Math.sin(a) }) }
  // 3. top straight: x  SX -> -SX at z = RZc
  for (let i = 1; i <= SEG_S; i++) cl.push({ x: SX - (2 * SX * i) / SEG_S, z: RZc })
  // 4. TL arc, center (-SX,  SZ), a 90 -> 180
  for (let i = 1; i <= SEG_C; i++) { const a = Math.PI / 2 + (Math.PI / 2) * i / SEG_C; cl.push({ x: -SX + RC * Math.cos(a), z: SZ + RC * Math.sin(a) }) }
  // 5. left straight: z  SZ -> -SZ at x = -RXc
  for (let i = 1; i <= SEG_S; i++) cl.push({ x: -RXc, z: SZ - (2 * SZ * i) / SEG_S })
  // 6. BL arc, center (-SX, -SZ), a 180 -> 270
  for (let i = 1; i <= SEG_C; i++) { const a = Math.PI + (Math.PI / 2) * i / SEG_C; cl.push({ x: -SX + RC * Math.cos(a), z: -SZ + RC * Math.sin(a) }) }
  // 7. bottom straight: x -SX -> SX at z = -RZc
  for (let i = 1; i <= SEG_S; i++) cl.push({ x: -SX + (2 * SX * i) / SEG_S, z: -RZc })
  // 8. BR arc, center ( SX, -SZ), a 270 -> 360
  for (let i = 1; i <= SEG_C; i++) { const a = 1.5 * Math.PI + (Math.PI / 2) * i / SEG_C; cl.push({ x: SX + RC * Math.cos(a), z: -SZ + RC * Math.sin(a) }) }
  return cl
}

const CL = buildCenterline()
const N = CL.length

// tangents (race direction) + outward normals via finite differences
const TAN: Pt[] = []
const NOR: Pt[] = []
for (let i = 0; i < N; i++) {
  const a = CL[(i - 1 + N) % N]
  const b = CL[(i + 1) % N]
  let tx = b.x - a.x, tz = b.z - a.z
  const L = Math.hypot(tx, tz) || 1
  tx /= L; tz /= L
  TAN[i] = { x: tx, z: tz }
  NOR[i] = { x: tz, z: -tx } // points away from the infield (outward)
}

function nearest(target: Pt): number {
  let bi = 0, bd = Infinity
  for (let i = 0; i < N; i++) {
    const d = (CL[i].x - target.x) ** 2 + (CL[i].z - target.z) ** 2
    if (d < bd) { bd = d; bi = i }
  }
  return bi
}

// checkpoint 0 is the start/finish; 1..3 are the intermediate gates, in race order
const CP_CL = [
  nearest({ x: RXc, z: 0 }),     // 0 finish — middle of the right straight
  nearest({ x: 0, z: RZc }),     // 1 top straight
  nearest({ x: -RXc, z: 0 }),    // 2 left straight
  nearest({ x: 0, z: -RZc }),    // 3 bottom straight
]

// ---- race state (module scope: one session per page load, like castle-run) ----
let nextCp = 1
let lap = 0
let finished = false
let bestLap = Infinity
let lapStart = 0
let finishTime = 0
let wrongWay = 0

function gateLogic(ctx: GameContext, i: number): void {
  if (finished) return
  if (i !== nextCp) return // out of order / re-crossing the gate we just left: ignore
  if (i === 0) {
    const lapTime = ctx.time - lapStart
    if (lapTime < bestLap) bestLap = lapTime
    lap++
    lapStart = ctx.time
    if (lap >= TOTAL_LAPS) {
      finished = true
      finishTime = ctx.time
      ctx.hud.set('lap', '🏁 FINISH!')
      ctx.hud.remove('wrongway')
      ctx.celebrate(`🏁 Race complete! Best lap ${bestLap.toFixed(1)}s`)
      ctx.earnBlobcash(30, 'victory')
      ctx.systemChat(`Finished in ${finishTime.toFixed(1)}s — best lap ${bestLap.toFixed(1)}s`)
    } else {
      ctx.hud.toast(`🏁 Lap ${lap + 1}/${TOTAL_LAPS}  ·  last lap ${lapTime.toFixed(1)}s`)
      nextCp = 1
    }
  } else {
    const p = CL[CP_CL[i]]
    ctx.hud.toast(`✅ Checkpoint ${i}/3`)
    ctx.player.setCheckpoint(v3(p.x, 1.2, p.z)) // respawn here if you fall/reset
    nextCp = i + 1 === 4 ? 0 : i + 1
  }
}

// gate slab orients across the lane (perpendicular to travel), axis-aligned
function gateSize(t: Pt, span = 15, thin = 2.6, h = 5) {
  return Math.abs(t.x) > Math.abs(t.z) ? v3(thin, h, span) : v3(span, h, thin)
}

export default defineGame({
  meta: {
    id: 'blob-kart',
    name: 'Blob Kart',
    blurb: 'An arcade kart racer. Hop in, hit the gas, grab the coins, and take 3 laps before the clock beats you.',
    emoji: '🏎️',
    gradient: 'linear-gradient(135deg, #ff8c42 0%, #e63946 55%, #7a1f2b 100%)',
    genre: 'Racing · Time Trial',
  },
  camera: 'orbit',
  maxPlayers: 12,

  build(w) {
    w.lighting('noon')
    w.killY(-12)

    // world floor (grass) so the circuit sits on solid ground
    w.add({ at: v3(0, -2, 0), size: v3(320, 1, 320), color: '#2f6b34', material: 'grass' })

    // ---- road: a slab per centerline sample (same color => overlap is invisible) ----
    for (let i = 0; i < N; i++) {
      const p = CL[i]
      w.add({ at: v3(p.x, 0, p.z), size: v3(15, 1, 15), color: ROAD, material: 'stone' })
    }

    // ---- barriers: long boxes on the straights, cubes around the corners ----
    // straight walls (inner + outer for each of the 4 straights)
    const longZ = v3(3.6, 1.6, 2 * SZ + 9)   // runs along Z (left/right straights)
    const longX = v3(2 * SX + 9, 1.6, 3.6)   // runs along X (top/bottom straights)
    w.add({ at: v3(RXc - HW, 1.3, 0), size: longZ, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(RXc + HW, 1.3, 0), size: longZ, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(-RXc - HW, 1.3, 0), size: longZ, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(-RXc + HW, 1.3, 0), size: longZ, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(0, 1.3, RZc - HW), size: longX, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(0, 1.3, RZc + HW), size: longX, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(0, 1.3, -RZc - HW), size: longX, color: WALL_A, material: 'plastic' })
    w.add({ at: v3(0, 1.3, -RZc + HW), size: longX, color: WALL_A, material: 'plastic' })
    // corner walls (inner radius RC-HW, outer RC+HW), alternating curb colors
    const corners = [
      { cx: SX, cz: SZ, a0: 0 },
      { cx: -SX, cz: SZ, a0: Math.PI / 2 },
      { cx: -SX, cz: -SZ, a0: Math.PI },
      { cx: SX, cz: -SZ, a0: 1.5 * Math.PI },
    ]
    for (const c of corners) {
      for (const r of [RC - HW, RC + HW]) {
        for (let i = 0; i <= SEG_C; i++) {
          const a = c.a0 + (Math.PI / 2) * (i / SEG_C)
          w.add({
            at: v3(c.cx + Math.cos(a) * r, 1.3, c.cz + Math.sin(a) * r),
            size: v3(3.7, 1.6, 3.7),
            color: i % 2 ? WALL_B : WALL_A,
            material: 'plastic',
          })
        }
      }
    }

    // ---- start/finish line + checkpoint gates (non-colliding trigger volumes) ----
    const gateColors = ['#ffd166', '#22d3ee', '#a78bfa', '#34d399']
    for (let gi = 0; gi < 4; gi++) {
      const ci = CP_CL[gi]
      const p = CL[ci]
      const closed = (gi === 0)
      w.add({
        at: v3(p.x, 2.5, p.z),
        size: gateSize(TAN[ci]),
        color: gateColors[gi],
        material: 'neon',
        collide: false,
        onTouch: (ctx) => gateLogic(ctx, gi),
      })
      const txt = closed ? '🏁 START / FINISH' : `CP ${gi}`
      w.label(txt, v3(p.x, 5.6, p.z), closed ? 0.9 : 0.6, gateColors[gi])
    }
    // checkered start strip on the asphalt
    w.add({ at: v3(RXc, 0.55, 0), size: v3(13, 0.2, 1.8), color: '#f4f6f8', material: 'plastic', collide: false })

    // ---- karts: a 2x2 starting grid on the right straight, all facing +Z (forward) ----
    const gridColors = ['#ef4444', '#3b82f6', '#fbbf24', '#22c55e']
    for (let i = 0; i < 4; i++) {
      const row = Math.floor(i / 2)
      const col = i % 2
      w.vehicle('car', v3(RXc + (col ? 3 : -3), 1.2, -5 - row * 5), { speed: 32, color: gridColors[i] })
    }
    // the driver spawns beside the grid, on the asphalt
    w.spawn(v3(RXc, 1.5, 2))

    // ---- coins: a trail around the racing line, skipping the gates ----
    for (let i = 0; i < N; i++) {
      const nearGate = CP_CL.some((ci) => Math.abs(ci - i) < 2)
      if (nearGate) continue
      if (i % 3 !== 0) continue
      const p = CL[i]
      w.coin(v3(p.x, 1.4, p.z))
    }

    // ---- infield flavor: grandstand label + orbiting trophy cubes + greenery ----
    w.label('🏎️  BLOB  KART', v3(0, 11, 0), 2.4, '#ffd166')
    w.label('3 LAPS', v3(0, 8.6, 0), 1.0, '#ffe7a8')
    for (let i = 0; i < 3; i++) {
      w.add({
        at: v3(0, 7, 0),
        size: v3(1.4, 1.4, 1.4),
        color: '#ffd166',
        material: 'gold',
        collide: false,
        behavior: behaviors.orbit(v3(0, 7, 0), 9, 5.5, (i / 3) * Math.PI * 2),
      })
    }
    for (const [tx, tz] of [[0, 0], [16, 8], [-16, -8], [10, -12], [-12, 12]] as const) {
      w.tree(v3(tx, -1.5, tz), 1.1)
    }
    w.cloud(v3(-30, 20, 18), 1.2)
    w.cloud(v3(28, 24, -22), 0.9)
    w.cloud(v3(6, 27, 30), 1.4)
  },

  onStart(ctx) {
    nextCp = 1
    lap = 0
    finished = false
    bestLap = Infinity
    lapStart = ctx.time
    wrongWay = 0
    finishTime = 0
    ctx.hud.set('lap', `🏁 Lap 1/${TOTAL_LAPS}`)
    ctx.hud.set('time', '⏱ 0.0s')
    ctx.hud.toast('Hop in a kart with E!  W/S gas · A/D steer · 3 laps')
    ctx.systemChat('Welcome to Blob Kart — collect coins and complete 3 laps. Watch for WRONG WAY!')
  },

  onTick(ctx, dt) {
    if (finished) {
      ctx.hud.set('time', `⏱ ${finishTime.toFixed(1)}s`)
      return
    }
    ctx.hud.set('time', `⏱ ${ctx.time.toFixed(1)}s`)
    ctx.hud.set('lap', `🏁 Lap ${Math.min(lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`)

    // wrong-way detection: dot the player's velocity with the local race direction
    const p = ctx.player.position
    let bi = 0, bd = Infinity
    for (let i = 0; i < N; i++) {
      const d = (CL[i].x - p.x) ** 2 + (CL[i].z - p.z) ** 2
      if (d < bd) { bd = d; bi = i }
    }
    const t = TAN[bi]
    const v = ctx.player.velocity
    if (v.x * t.x + v.z * t.z < -3) {
      wrongWay += dt
      if (wrongWay > 0.7) ctx.hud.set('wrongway', '⚠️  WRONG WAY — turn around!')
    } else {
      wrongWay = 0
      ctx.hud.remove('wrongway')
    }
  },
})
