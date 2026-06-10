// Squadfall Island — Boxcade's squad battle royale on a prison island.
// Genre conventions documented in docs/squadfall-design-notes.md: squadfall
// respawns (the dead redeploy from the sky while a teammate lives),
// rarity-tiered lootboxes, a cash economy with buy stations, armor plates,
// and a shrinking gas circle. Ray-traced reflections on the ocean, piers and
// metal decks. All geometry, names and rules expressed here are Boxcade
// originals — see README "Licensing & inspirations".

import { defineGame, v3, type Vec3, type GameContext, type EntityApi, type PartHandle } from '../sdk'
import { audio } from '../engine/audio'

// ------------------------------------------------------------ match tuning --

const SQUADS = ['red', 'blue', 'gold'] as const
type Squad = (typeof SQUADS)[number]
const SQUAD_LABEL: Record<Squad, string> = { red: '🔴 RED', blue: '🔵 BLUE', gold: '🟡 GOLD' }
const TEAMMATES = ['Reyes', 'Mads']
const ENEMIES: Record<string, Array<{ name: string; skill: number }>> = {
  blue: [{ name: 'Krieg-9', skill: 0.6 }, { name: 'Sable', skill: 0.5 }, { name: 'Volt', skill: 0.68 }],
  gold: [{ name: 'Nyx', skill: 0.55 }, { name: 'Brick', skill: 0.45 }, { name: 'Halo-3', skill: 0.65 }],
}
/** squad infil vectors — everyone parachutes in from their own compass point */
const DROPS: Record<Squad, Vec3> = {
  red: v3(-14, 58, -36),
  blue: v3(32, 58, 26),
  gold: v3(-34, 58, 30),
}

// gas circle: [radius, seconds it holds, seconds it takes to shrink to next]
const PHASES = [
  { r: 72, hold: 45, shrink: 18 },
  { r: 48, hold: 35, shrink: 16 },
  { r: 32, hold: 28, shrink: 14 },
  { r: 20, hold: 24, shrink: 12 }, // respawns shut off when this one closes
  { r: 10, hold: 20, shrink: 10 },
  { r: 4, hold: 9999, shrink: 1 },
]
const RESPAWN_DELAY = [15, 22, 30, 39] // seconds, grows with each circle phase
const RESPAWN_CUTOFF_PHASE = 3
const GAS_PILLARS = 40

// lootbox rarity table (the classic gray→gold tier ladder)
interface Tier { id: string; color: string; weight: number }
const TIERS: Tier[] = [
  { id: 'common', color: '#9aa0a6', weight: 40 },
  { id: 'uncommon', color: '#4cc36a', weight: 26 },
  { id: 'rare', color: '#3f8cff', weight: 17 },
  { id: 'epic', color: '#a45ce6', weight: 11 },
  { id: 'legendary', color: '#ffb142', weight: 6 },
]
// crates per POI (x, z) — ground level
const BOX_SPOTS: Array<[number, number]> = [
  [4, 8], [-7, -6], [9, -8],            // Prison yard
  [-12, -38], [-6, -44],                // Labs
  [14, -28], [20, -34],                 // Chemical Engineering
  [32, -12], [30, -20],                 // Industry
  [-32, -40], [-26, -48],               // Dock
  [-40, -4], [-44, 8],                  // Stronghold
  [38, -2], [42, -14],                  // Headquarters
  [38, 16], [44, 24],                   // Factory
  [22, 6], [16, 12],                    // Control
  [24, 36], [30, 40],                   // Living Quarters
  [-6, 42], [2, 48],                    // Harbor
  [-28, 36], [-32, 42],                 // Outpost
  [-14, -14], [12, 24],                 // streets
]

interface LootBox {
  at: Vec3
  tier: Tier
  part: PartHandle | null
  respawnAt: number
}

// --------------------------------------------------------------- match state --

let cash = 0
let lootboxes: LootBox[] = []
let gasPillars: PartHandle[] = []
let gasCenter = v3(0, 1, 0)
let gasRadius = PHASES[0].r
let phaseIdx = 0
let phaseT = 0
let shrinking = false
let respawnsOff = false
let redeployAt = new Map<string, number>()
let toDeploy = new Set<string>()
let eliminated = new Set<string>()
let matchOver = false
let buyCooldown = 0
let lastHp = new Map<string, number>()
let lastHurtT = new Map<string, number>()
let roamT = new Map<string, number>()
let matchStartT = 0

function squadOf(e: EntityApi): Squad { return (e.team ?? 'red') as Squad }

function rollTier(): Tier {
  let total = 0
  for (const t of TIERS) total += t.weight
  let r = Math.random() * total
  for (const t of TIERS) {
    r -= t.weight
    if (r <= 0) return t
  }
  return TIERS[0]
}

export default defineGame({
  meta: {
    id: 'squadfall',
    name: 'Squadfall Island',
    blurb: 'Drop onto the prison island. Loot rarity crates, plate up, buy back your squad — last squad standing wins.',
    emoji: '🪂',
    gradient: 'linear-gradient(135deg, #2c3a52 0%, #b3543e 55%, #131a2a 100%)',
    genre: 'Squad Royale · Bots',
  },
  maxPlayers: 64,
  camera: 'fp',
  rtReflections: true, // ocean, piers, helipad and prison deck all mirror
  // island scrap weapon: a junk-shrapnel slug gun that drops from common crates
  weapons: [{ id: 'scrapcannon', name: 'Scrap Cannon', icon: '🔩', kind: 'projectile', pellets: 5, damage: 14, fireRate: 1.0, spread: 0.07, projectile: { speed: 38, radius: 0.13, color: '#ffd166', gravity: -10, life: 1.2 }, ammoMax: 20, ammoPickup: 6, botRange: [0, 20], sound: 'flak' }],
  combat: {
    selfTeam: 'red',
    health: 100,
    respawnSeconds: 9999, // the GAME owns respawns — squadfall rules below
    startWeapons: ['sidearm'], // you drop in with a pistol — loot the rest
  },

  // ------------------------------------------------------------------ map --
  build(w) {
    w.lighting('goldenHour')
    w.killY(-1.2) // the ocean is death
    w.spawn(v3(0, 3, 0))

    const Y = 1 // island walking surface

    // ocean — a reflective (ICE) sea band hugs the shore so the island
    // ray-traces into the water, while the deep sea beyond stays plain (a
    // 460m reflective plane costs too much SSR and just streaks)
    w.add({ at: v3(0, -2.3, 0), size: v3(210, 0.6, 210), color: '#1d4e6e', material: 'ice', collide: false })
    w.add({ at: v3(0, -2.42, 0), size: v3(460, 0.5, 460), color: '#16384f', material: 'plastic', collide: false })

    // the island: stone shelf + grass top + sand fringe. Tops are staggered a
    // few cm — exactly-coplanar plates z-fight and flicker lines when you move.
    w.add({ at: v3(0, -0.66, 0), size: v3(126, 3.2, 126), color: '#7e848c', material: 'stone' })  // top 0.94
    w.add({ at: v3(0, 0.5, 0), size: v3(120, 1, 100), color: '#75a558', material: 'grass' })      // top 1.00
    w.add({ at: v3(-6, 0.47, 6), size: v3(100, 1, 120), color: '#73a254', material: 'grass' })    // top 0.97
    w.add({ at: v3(0, 0.08, 0), size: v3(126, 0.5, 126), color: '#d9c489', material: 'sand' })    // top 0.33

    const slab = (x: number, z: number, sx: number, sy: number, sz: number, color: string, material: Parameters<typeof w.add>[0]['material'] = 'stone', rotY = 0) =>
      w.add({ at: v3(x, Y + sy / 2, z), size: v3(sx, sy, sz), color, material, rotY })
    const deck = (x: number, y: number, z: number, sx: number, sz: number) =>
      w.add({ at: v3(x, y, z), size: v3(sx, 0.3, sz), color: '#46525f', material: 'metal' })
    const glow = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color = '#ffd9a8') =>
      w.add({ at: v3(x, y, z), size: v3(sx, sy, sz), color, material: 'neon', collide: false })
    const poi = (text: string, x: number, z: number, y = 14) => w.label(text, v3(x, y, z), 0.72, '#ffe2c4')

    // ---- PRISON (center): block + tower, the island's landmark ----
    poi('PRISON', 0, 0, 22)
    for (const [wx, wz, sx, sz] of [[0, -13, 28, 1.2], [0, 13, 28, 1.2], [-13, 0, 1.2, 28], [13, 0, 1.2, 28]] as const) {
      slab(wx, wz, sx, 3, sz, '#8b9099')
    }
    slab(0, 0, 14, 8, 14, '#7c828c')                       // cell block (roof y9)
    w.add({ at: v3(0, 13, 0), size: v3(8, 8, 8), color: '#6d737d', material: 'stone' }) // tower (roof y17)
    deck(0, 17.25, 0, 8.6, 8.6)                            // mirror roof deck
    w.add({ at: v3(3, 19.5, 3), size: v3(0.4, 4.4, 0.4), color: '#c5cdd8', material: 'metal' }) // antenna
    glow(0, 9.4, 7.2, 13, 0.5, 0.3)                        // roofline strips
    glow(0, 9.4, -7.2, 13, 0.5, 0.3)
    w.bouncePad(v3(7.8, 1.35, 7.8), 29)                    // yard → block roof
    w.bouncePad(v3(5, 9.55, 5), 30)                        // block roof → tower roof
    w.vehicle('jetpack', v3(-7.8, 1.2, 7.8))               // BR mobility: fly the prison wall
    w.vehicle('jetpack', v3(34, 1.2, -34))
    w.light(v3(0, 6, 0), { color: '#ffd9a8', intensity: 130, range: 30 })
    // water tower at the prison's NW corner — the classic high ground
    w.add({ at: v3(-16, 5, -14), size: v3(1.1, 8, 1.1), color: '#8d97a5', material: 'metal' })
    w.add({ at: v3(-16, 10.2, -14), size: v3(4.4, 2.6, 4.4), color: '#b35a4a', material: 'stone' })

    // ---- north: Labs, Chemical Engineering, Industry, Dock ----
    poi('LABS', -10, -40)
    slab(-10, -40, 11, 9, 8, '#a8554c')
    deck(-10, 10.3, -40, 11.5, 8.5)
    glow(-10, 5, -35.8, 9, 0.6, 0.2, '#9fe8d8')
    poi('CHEM ENG', 16, -31)
    slab(16, -31, 10, 4, 8, '#90a08e')
    for (const tx of [12.5, 16, 19.5]) {
      w.add({ at: v3(tx, Y + 3, -26), size: v3(2.6, 6, 2.6), color: '#aab4bd', material: 'metal' }) // tanks mirror
    }
    poi('INDUSTRY', 32, -16)
    slab(32, -16, 12, 4, 9, '#9a8f7a')
    poi('DOCK', -32, -46)
    deck(-32, 0.9, -52, 8, 20) // pier runs out over the water
    slab(-38, -42, 6, 7, 5, '#7f8a94') // lookout
    // the freighter, half over the sea
    w.add({ at: v3(-26, 2.2, -58), size: v3(22, 3.4, 7), color: '#8a4a3c', material: 'stone' })
    w.add({ at: v3(-19, 5.4, -58), size: v3(5, 3, 5), color: '#dfe5ec', material: 'plastic' })
    w.add({ at: v3(-30, 4.6, -58), size: v3(4, 1.6, 3), color: '#cf7f3e', material: 'plastic' })
    w.add({ at: v3(-34, 4.6, -57), size: v3(4, 1.6, 3), color: '#5d8fc0', material: 'plastic' })

    // ---- west: Stronghold + helipad ----
    poi('STRONGHOLD', -42, 2)
    slab(-42, 2, 6, 13, 6, '#6a7280')
    w.add({ at: v3(-42, Y + 14, 2), size: v3(4.6, 0.7, 4.6), color: '#aab4bd', material: 'metal', rotY: 0.5 }) // dish
    slab(-36, 8, 7, 3.4, 5, '#7d8794') // supply shed
    deck(-44, 1.25, 16, 9, 9) // helipad mirrors the sky
    w.label('🚁', v3(-44, 3.4, 16), 0.9)

    // ---- east: Headquarters, Factory, Control ----
    poi('HEADQUARTERS', 40, -8)
    slab(40, -8, 7, 14, 7, '#8d97a5')
    deck(40, 15.4, -8, 7.6, 7.6)
    glow(40, 9, -4.4, 5.5, 0.5, 0.2, '#9fd9ff')
    w.bouncePad(v3(35.5, 1.35, -8), 38) // street → HQ roof
    poi('FACTORY', 40, 20)
    slab(40, 20, 16, 7, 12, '#9a6f54')
    w.add({ at: v3(45, Y + 11, 24), size: v3(2, 9, 2), color: '#73655a', material: 'stone' }) // chimney
    w.bouncePad(v3(31, 1.35, 20), 29)
    poi('CONTROL', 20, 8)
    slab(20, 8, 9, 3.5, 9, '#828c96')

    // ---- south: Living Quarters, Harbor, Outpost ----
    poi('LIVING QTRS', 27, 38)
    for (const [hx, hz, c] of [[24, 34, '#b08968'], [30, 40, '#8fa3b8'], [24, 43, '#a3b18a']] as const) {
      slab(hx, hz, 6, 4, 6, c)
    }
    poi('HARBOR', -4, 46)
    slab(-4, 46, 14, 6, 10, '#7f8a94')
    deck(-4, 0.9, 56, 10, 10) // south pier
    glow(-4, 7.3, 41.2, 12, 0.5, 0.2)
    poi('OUTPOST', -30, 38)
    slab(-30, 38, 5, 3, 5, '#86755d')

    // scattered cover crates + rocks so the streets aren't naked
    const cover: Array<[number, number, number, string]> = [
      [-20, 20, 1.6, '#7d8794'], [10, -18, 1.4, '#9a8f7a'], [-8, 28, 1.8, '#8b9099'],
      [18, -8, 1.3, '#b08968'], [-26, -22, 1.7, '#828c96'], [34, 4, 1.5, '#73655a'],
      [6, 34, 1.4, '#7f8a94'], [-38, 26, 1.6, '#8d97a5'], [24, -42, 1.5, '#90a08e'],
    ]
    for (const [cx, cz, s, c] of cover) {
      slab(cx, cz, 2.2 * s, 1.4 * s, 2.2 * s, c)
    }

    // fixed ground arsenal on the roofs + piers (lootboxes carry the rest)
    w.weaponSpawn(v3(0, 18.3, 0), 'rockets')      // prison tower roof
    w.weaponSpawn(v3(40, 16.6, -8), 'sniper')     // HQ roof
    w.weaponSpawn(v3(-44, 2.3, 16), 'shock')      // helipad
    w.weaponSpawn(v3(40, Y + 8.3, 20), 'minigun') // factory roof
    w.weaponSpawn(v3(-32, 2.1, -56), 'flak')      // pier end
    w.weaponSpawn(v3(-4, 2.1, 56), 'pulse')       // harbor pier
    for (const [ax, az] of [[-10, -34], [30, -10], [-40, 10], [26, 32], [0, 14], [-24, 30]] as const) {
      w.ammoSpawn(v3(ax, Y + 0.8, az))
    }
    for (const [hx, hz] of [[8, -2], [-34, -42], [42, 14], [-2, 50]] as const) {
      w.healthPack(v3(hx, Y + 0.8, hz))
    }

    // buy stations: gold pads at Prison yard, Harbor and Stronghold
    for (const [bx, bz] of [[10, -10], [-8, 46], [-38, 14]] as const) {
      w.add({ at: v3(bx, Y + 0.12, bz), size: v3(2.6, 0.25, 2.6), color: '#ffc94d', material: 'gold' })
      w.label('🛒 BUY', v3(bx, Y + 2.6, bz), 0.5, '#ffe9b8')
    }
  },

  // ---------------------------------------------------------------- match --
  onStart(ctx) {
    cash = 500
    phaseIdx = 0
    phaseT = 0
    shrinking = false
    respawnsOff = false
    matchOver = false
    buyCooldown = 0
    gasCenter = v3(0, 1, 0)
    gasRadius = PHASES[0].r
    redeployAt = new Map()
    toDeploy = new Set()
    eliminated = new Set()
    lastHp = new Map()
    lastHurtT = new Map()
    roamT = new Map()
    matchStartT = ctx.time

    ctx.setSpawnPoints([v3(0, 3, 0), v3(8, 3, 8), v3(-8, 3, -8)])

    // squads: you + 2 (red) vs blue vs gold
    for (let i = 0; i < TEAMMATES.length; i++) {
      ctx.spawnBot({ name: TEAMMATES[i], team: 'red', skill: 0.62, spawns: [v3(-4 + i * 8, 3, -4)] })
    }
    for (const team of ['blue', 'gold'] as const) {
      for (const b of ENEMIES[team]) {
        ctx.spawnBot({
          name: b.name, team, skill: b.skill, spawns: [v3(DROPS[team].x, 3, DROPS[team].z)],
          shirt: team === 'gold' ? '#ffd166' : undefined,
        })
      }
    }

    // INFIL — every squad parachutes in from its own side
    for (const e of ctx.entities) {
      const d = DROPS[squadOf(e)]
      e.deploy(v3(d.x + (Math.random() - 0.5) * 14, d.y, d.z + (Math.random() - 0.5) * 14))
    }

    // gas ring pillars
    gasPillars = []
    for (let i = 0; i < GAS_PILLARS; i++) {
      const a = (i / GAS_PILLARS) * Math.PI * 2
      gasPillars.push(ctx.addPart({
        at: v3(gasCenter.x + Math.cos(a) * gasRadius, 14, gasCenter.z + Math.sin(a) * gasRadius),
        size: v3(0.8, 30, 0.8), color: '#a4ff5e', material: 'neon', collide: false,
      }))
    }

    // lootboxes
    lootboxes = BOX_SPOTS.map(([x, z]) => makeBox(ctx, v3(x, 1.55, z)))

    ctx.hud.set('cash', `💵 $${cash}`)
    ctx.hud.set('squads', `👥 3 squads`)
    ctx.hud.set('circle', `⭕ ${PHASES[0].r}m`)
    ctx.hud.big('🪂 DROPPING IN', 2200)
    ctx.systemChat('SQUADFALL: while a squadmate lives, the dead drop back in. Wipe the enemy squads!')
    ctx.systemChat('Loot the crates (gray→gold = better), grab 🛒 buy pads for plates & squad buybacks.')
    audio.flagAlarm()
  },

  onTick(ctx, dt) {
    if (matchOver) return
    const everyone = ctx.entities
    const t = ctx.time - matchStartT

    // ---- gas circle ----
    const phase = PHASES[phaseIdx]
    phaseT += dt
    if (!shrinking && phaseT > phase.hold && phaseIdx < PHASES.length - 1) {
      shrinking = true
      phaseT = 0
      ctx.hud.toast('☣ The gas is closing in!')
      audio.flagAlarm()
    }
    if (shrinking) {
      const next = PHASES[phaseIdx + 1]
      const k = Math.min(1, phaseT / phase.shrink)
      gasRadius = phase.r + (next.r - phase.r) * k
      if (k >= 1) {
        shrinking = false
        phaseT = 0
        phaseIdx++
        if (phaseIdx >= RESPAWN_CUTOFF_PHASE && !respawnsOff) {
          respawnsOff = true
          redeployAt.clear()
          ctx.hud.toast('💀 Respawns are now DISABLED')
          ctx.systemChat('💀 Final circles — no more redeploys.')
        }
      }
    }
    ctx.hud.set('circle', `⭕ ${Math.round(gasRadius)}m${shrinking ? ' ⚠' : ''}`)
    for (let i = 0; i < gasPillars.length; i++) {
      const a = (i / gasPillars.length) * Math.PI * 2 + t * 0.03
      gasPillars[i].pos.x = gasCenter.x + Math.cos(a) * gasRadius
      gasPillars[i].pos.z = gasCenter.z + Math.sin(a) * gasRadius
    }
    const gasDps = 8 + phaseIdx * 4
    for (const e of everyone) {
      if (!e.alive) continue
      const d = Math.hypot(e.position.x - gasCenter.x, e.position.z - gasCenter.z)
      if (d > gasRadius) e.hurt(gasDps * dt, 'the gas', '☣')
    }

    // ---- lootboxes: anyone close pops them ----
    for (const box of lootboxes) {
      if (!box.part) {
        if (box.respawnAt > 0 && t > box.respawnAt) {
          const fresh = makeBox(ctx, box.at)
          box.part = fresh.part
          box.tier = fresh.tier
          box.respawnAt = 0
        }
        continue
      }
      for (const e of everyone) {
        if (!e.alive) continue
        const p = e.position
        const dx = p.x - box.at.x
        const dz = p.z - box.at.z
        if (dx * dx + dz * dz > 1.9 * 1.9 || Math.abs(p.y - box.at.y) > 2.4) continue
        openBox(ctx, e, box)
        break
      }
    }

    // ---- buy stations (self only): plates / restock / squad buyback ----
    buyCooldown = Math.max(0, buyCooldown - dt)
    const me = everyone.find((e) => e.isSelf)
    if (me?.alive && buyCooldown <= 0) {
      for (const [bx, bz] of [[10, -10], [-8, 46], [-38, 14]] as const) {
        if (Math.hypot(me.position.x - bx, me.position.z - bz) > 1.8) continue
        const deadMate = everyone.find((e) => e.team === 'red' && !e.isSelf && !e.alive)
        if (deadMate && cash >= 4000 && !respawnsOff) {
          cash -= 4000
          redeployAt.set(deadMate.id, t) // instant buyback
          ctx.hud.toast(`🛒 Squad buyback! ${deadMate.name} is dropping back in (-$4000)`)
          audio.capture()
        } else if (me.health < 250 && cash >= 1000) {
          cash -= 1000
          me.heal(50, 250)
          ctx.hud.toast('🛒 Armor plate +50 (-$1000)')
          audio.pickupWeapon()
        } else if (cash >= 500 && me.giveAmmo()) {
          cash -= 500
          ctx.hud.toast('🛒 Munitions restock (-$500)')
        } else {
          break
        }
        buyCooldown = 1.6
        ctx.hud.set('cash', `💵 $${cash}`)
        break
      }
    }

    // ---- squadfall redeploys ----
    if (!respawnsOff) {
      for (const e of everyone) {
        if (e.alive || redeployAt.has(e.id) || toDeploy.has(e.id) || eliminated.has(e.team ?? '')) continue
        // freshly dead with living teammates → schedule a redeploy
        const mates = everyone.filter((m) => m.team === e.team && m.id !== e.id && m.alive)
        if (mates.length > 0) {
          redeployAt.set(e.id, t + RESPAWN_DELAY[Math.min(phaseIdx, RESPAWN_DELAY.length - 1)])
        }
      }
      for (const [id, at] of redeployAt) {
        const e = everyone.find((x) => x.id === id)
        if (!e || e.alive) { redeployAt.delete(id); continue }
        const mates = everyone.filter((m) => m.team === e.team && m.id !== e.id && m.alive)
        if (mates.length === 0) { redeployAt.delete(id); continue }
        if (e.isSelf) ctx.hud.set('redeploy', `🪂 Redeploy in ${Math.max(0, Math.ceil(at - t))}s`)
        if (t >= at) {
          redeployAt.delete(id)
          e.respawn()
          toDeploy.add(id)
        }
      }
    }
    if (!redeployAt.has(me?.id ?? '') && (me?.alive ?? true)) ctx.hud.remove('redeploy')
    for (const id of toDeploy) {
      const e = everyone.find((x) => x.id === id)
      if (!e) { toDeploy.delete(id); continue }
      if (e.alive) {
        toDeploy.delete(id)
        e.deploy(v3(
          gasCenter.x + (Math.random() - 0.5) * gasRadius * 1.2, 55,
          gasCenter.z + (Math.random() - 0.5) * gasRadius * 1.2,
        ))
        if (e.isSelf) ctx.hud.big('🪂 REDEPLOYING', 1600)
        ctx.systemChat(`🪂 ${e.name} redeployed!`)
      }
    }

    // ---- squad eliminations + win ----
    let squadsAlive = 0
    let redIn = false
    for (const team of SQUADS) {
      if (eliminated.has(team)) continue
      const members = everyone.filter((e) => e.team === team)
      const inPlay = members.some((e) => e.alive || redeployAt.has(e.id) || toDeploy.has(e.id))
      if (!inPlay) {
        eliminated.add(team)
        for (const m of members) redeployAt.delete(m.id)
        ctx.hud.big(`💀 ${SQUAD_LABEL[team]} SQUAD ELIMINATED`, 2200)
        ctx.systemChat(`💀 ${SQUAD_LABEL[team]} squad was wiped.`)
        audio.explosion()
        continue
      }
      squadsAlive++
      if (team === 'red') redIn = true
    }
    ctx.hud.set('squads', `👥 ${squadsAlive} squads`)
    if (squadsAlive <= 1) {
      matchOver = true
      if (redIn) {
        ctx.celebrate('🏆 RED SQUAD WINS!')
        ctx.earnBolts(200, 'squadfall victory')
      } else {
        ctx.hud.big('💀 YOUR SQUAD WAS WIPED', 3000)
        audio.death()
      }
      setTimeout(() => {
        if (!matchOver) return
        restartMatch(ctx)
      }, 6500)
      return
    }

    // ---- base-health regen: the first 100 hp comes back, armor doesn't ----
    for (const e of everyone) {
      const prev = lastHp.get(e.id) ?? e.health
      if (e.health < prev) lastHurtT.set(e.id, t)
      lastHp.set(e.id, e.health)
      if (e.alive && t - (lastHurtT.get(e.id) ?? -99) > 5) e.heal(9 * dt)
    }

    // ---- bot objectives: stay out of the gas, roam POIs, stick with squad --
    for (const e of everyone) {
      if (!e.isBot || !e.alive) continue
      const d = Math.hypot(e.position.x - gasCenter.x, e.position.z - gasCenter.z)
      if (d > gasRadius * 0.85) {
        e.setObjective(v3(
          gasCenter.x + (Math.random() - 0.5) * gasRadius * 0.6, 1,
          gasCenter.z + (Math.random() - 0.5) * gasRadius * 0.6,
        ))
        continue
      }
      if (e.team === 'red' && me?.alive) {
        // squad cohesion: hold loosely near the player
        const p = me.position
        e.setObjective(v3(p.x + (Math.random() - 0.5) * 12, p.y, p.z + (Math.random() - 0.5) * 12))
      } else {
        const next = roamT.get(e.id) ?? 0
        if (t > next) {
          roamT.set(e.id, t + 7 + Math.random() * 6)
          const spot = BOX_SPOTS[Math.floor(Math.random() * BOX_SPOTS.length)]
          e.setObjective(v3(spot[0], 1, spot[1]))
        }
      }
    }
  },

  onKill(ctx, info) {
    if (matchOver) return
    if (info.killerIsSelf) {
      cash += 800
      ctx.hud.set('cash', `💵 $${cash}`)
      ctx.hud.toast('💵 +$800 elimination')
    }
    // squadfall rule: kills shave 7s off your squad's pending redeploys
    if (info.killerTeam) {
      for (const [id, at] of redeployAt) {
        const e = ctx.entities.find((x) => x.id === id)
        if (e && e.team === info.killerTeam) redeployAt.set(id, at - 7)
      }
    }
  },
})

// ---------------------------------------------------------------- helpers --

function makeBox(ctx: GameContext, at: Vec3): LootBox {
  const tier = rollTier()
  const part = ctx.addPart({
    at: v3(at.x, at.y, at.z),
    size: v3(1.15, 0.85, 0.85),
    color: tier.color,
    material: tier.id === 'legendary' ? 'gold' : 'plastic',
    collide: false,
    reflect: false,
  })
  return { at: v3(at.x, at.y, at.z), tier, part, respawnAt: 0 }
}

function openBox(ctx: GameContext, e: EntityApi, box: LootBox) {
  const tier = box.tier
  box.part?.remove()
  box.part = null
  box.respawnAt = (ctx.time - matchStartT) + 30 // match-relative, same clock as onTick's t

  let cashDrop = 0
  switch (tier.id) {
    case 'common':
      e.giveAmmo()
      cashDrop = 200
      break
    case 'uncommon':
      e.giveWeapon(['pulse', 'flak', 'scrapcannon'][Math.floor(Math.random() * 3)]) // scrapcannon = island close-range slug gun
      e.giveAmmo()
      cashDrop = 300
      break
    case 'rare':
      e.giveWeapon(Math.random() < 0.5 ? 'minigun' : 'shock')
      cashDrop = 500
      break
    case 'epic':
      e.giveWeapon('rockets')
      e.heal(50, 250) // armor plate
      cashDrop = 700
      break
    default: // legendary
      e.giveWeapon('sniper')
      e.heal(100, 250)
      cashDrop = 1200
  }
  if (e.isSelf) {
    cash += cashDrop
    ctx.hud.set('cash', `💵 $${cash}`)
    ctx.hud.toast(`🎁 ${tier.id.toUpperCase()} crate — +$${cashDrop}`)
    if (tier.id === 'legendary') audio.capture()
    else audio.pickupAmmo()
  }
}

function restartMatch(ctx: GameContext) {
  matchOver = false
  cash = 500
  phaseIdx = 0
  phaseT = 0
  shrinking = false
  respawnsOff = false
  gasRadius = PHASES[0].r
  redeployAt.clear()
  toDeploy.clear()
  eliminated.clear()
  matchStartT = ctx.time

  // fresh crates
  for (const box of lootboxes) {
    box.part?.remove()
    const fresh = makeBox(ctx, box.at)
    box.part = fresh.part
    box.tier = fresh.tier
    box.respawnAt = 0
  }
  // everyone back in the sky
  for (const e of ctx.entities) {
    e.respawn()
  }
  setTimeout(() => {
    for (const e of ctx.entities) {
      const d = DROPS[squadOf(e)]
      e.deploy(v3(d.x + (Math.random() - 0.5) * 14, d.y, d.z + (Math.random() - 0.5) * 14))
    }
  }, 150)
  ctx.hud.set('cash', `💵 $${cash}`)
  ctx.hud.set('squads', `👥 3 squads`)
  ctx.hud.big('🪂 NEW MATCH', 2200)
  audio.flagAlarm()
}
