// Cinema Carnage — an original free-for-all arena deathmatch built in the
// spirit of 90s cinema-shooter mayhem: a neon movie house (auditorium, glowing
// screen, balcony, projection deck, rooftop), a back alley with flaming
// dumpsters, an open-air bar, and parked rides. Every weapon is a pickup.
//
// Homage note: this is an original Blobcade level inspired by the *genre* of
// the 1996 Build-engine cinema shooter (Hollywood, aliens, urban chaos,
// dual-wielded rockets). All geometry, names, weapons and art here are our
// own — see README "License, inspirations & disclaimers".

import { defineGame, v3, DEFAULT_LOADOUT, type Vec3, type GameContext } from '../sdk'
import { audio } from '../engine/audio'

// ------------------------------------------------------------ match tuning --

const FRAG_LIMIT = 25

// original alien-thug bot names (a nod to the genre's menagerie)
const BOT_NAMES = ['Hog-Cop', 'Tentakill', 'Lizard-Boy', 'Enforcer-9', 'Razorback']

// original bravado one-liners, flouted on the player's kills
const KILL_LINES = [
  'Clean up on aisle YOU.',
  'Crowd goes wild.',
  'Another one for the highlight reel.',
  'Total meltdown.',
  "You're outta here.",
  'No refunds.',
  'Box-office smash.',
  'Direct hit — stay tuned.',
]

// respawn points spread across every zone so the fight keeps moving
const SPAWNS: Vec3[] = [
  v3(0, 3, 6),       // lobby
  v3(-12, 3, -14),   // auditorium left
  v3(12, 3, -14),    // auditorium right
  v3(25, 3, -2),     // back alley
  v3(-25, 3, 6),     // bar
  v3(0, 3, 26),      // south curb / parked car
  v3(-32, 3, -26),   // NW street
  v3(32, 3, 26),     // SE street
  v3(-10, 9.5, 4),   // balcony west
  v3(0, 14, -10),    // rooftop
]

// ------------------------------------------------------------------ state --

let frags: Map<string, number>
let matchOver: boolean
let matchStartT: number

function nameFor(ctx: GameContext, id: string): string {
  const e = ctx.entities.find((x) => x.id === id)
  return e ? e.name : '???'
}

export default defineGame({
  meta: {
    id: 'cinema-carnage',
    name: 'Cinema Carnage',
    blurb: 'A neon movie house turned free-for-all meat grinder. Loot the arsenal, work the balcony, hit 25 frags.',
    emoji: '🎬',
    gradient: 'linear-gradient(135deg, #2a0d1e 0%, #ff5a1f 55%, #141428 100%)',
    genre: 'Arena Deathmatch · Bots',
  },
  maxPlayers: 12,
  camera: 'fp',
  rtReflections: true, // the auditorium's polished floor mirrors the screen, neon and rockets
  // the signature gun: a dual-rocket spam cannon (a nod to the genre's
  // two-handed "devastator") — contested on the rooftop
  weapons: [{
    id: 'twinboomer', name: 'Twin Boomer', icon: '💢', kind: 'projectile',
    pellets: 2, damage: 34, fireRate: 2.4, spread: 0.035,
    projectile: { speed: 36, radius: 0.22, color: '#ff7a3c', splash: 3.2, life: 3 },
    ammoMax: 40, ammoPickup: 10, botRange: [10, 50], sound: 'rocket',
  }],
  combat: {
    health: 100,
    respawnSeconds: 3,
    weapons: [...DEFAULT_LOADOUT, 'twinboomer'],
    // drop in light — the heavy arsenal is contested across the map
    startWeapons: ['sidearm', 'flak'],
  },

  // ------------------------------------------------------------------ map --
  build(w) {
    w.lighting('night')
    w.killY(-6)
    w.spawn(v3(0, 3, 14))

    const Y = 1 // street / interior walking surface

    const slab = (x: number, z: number, sx: number, sy: number, sz: number, color: string, material: Parameters<typeof w.add>[0]['material'] = 'stone', rotY = 0) =>
      w.add({ at: v3(x, Y + sy / 2, z), size: v3(sx, sy, sz), color, material, rotY })
    const deck = (x: number, y: number, z: number, sx: number, sz: number) =>
      w.add({ at: v3(x, y, z), size: v3(sx, 0.4, sz), color: '#46525f', material: 'metal' })
    // like slab, but placed at an explicit center Y (for anything not rising from the floor)
    const block = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material: Parameters<typeof w.add>[0]['material'] = 'stone', rotY = 0) =>
      w.add({ at: v3(x, y, z), size: v3(sx, sy, sz), color, material, rotY })
    const glow = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color = '#ffd9a8') =>
      w.add({ at: v3(x, y, z), size: v3(sx, sy, sz), color, material: 'neon', collide: false })
    const poi = (text: string, x: number, z: number, y = 16) => w.label(text, v3(x, y, z), 0.7, '#ffe2c4')

    // ---- STREET + city frame ----
    w.add({ at: v3(0, 0, 0), size: v3(100, 2, 80), color: '#33363d', material: 'stone' }) // asphalt
    // rain puddles that ray-trace the neon (a handful of reflective patches)
    for (const [px, pz] of [[-28, 20], [30, -22], [10, 30], [-34, -10]] as const) {
      w.add({ at: v3(px, 0.96, pz), size: v3(7, 0.12, 5), color: '#1b3a4a', material: 'ice', collide: false })
    }
    // faceless city towers framing the block (read as walls, block the void)
    const towers: Array<[number, number, number, number]> = [
      [-44, -28, 12, 22], [44, -28, 10, 20], [-44, 28, 11, 24], [44, 28, 13, 22],
      [0, -38, 14, 18], [0, 38, 12, 20],
    ]
    for (const [tx, tz, tw, th] of towers) {
      w.add({ at: v3(tx, th, tz), size: v3(tw, th * 2, tw), color: '#23262e', material: 'stone' })
    }

    // ---- CINEMA shell (brick box, south entrance) ----
    poi('CINEMA', 0, -11, 18)
    const WALL = '#9a4b3f' // faded brick
    slab(0, -24, 38, 12, 2, WALL)              // north (screen) wall
    slab(-12, 12, 14, 12, 2, WALL)             // south wall — left of door
    slab(12, 12, 14, 12, 2, WALL)              // south wall — right of door
    slab(-18, -6, 2, 12, 38, WALL)             // west wall
    slab(18, -6, 2, 12, 38, WALL)              // east wall
    // polished auditorium + lobby floors (reflective)
    w.add({ at: v3(0, 0, -11), size: v3(34, 2, 22), color: '#3a4250', material: 'metal' })
    w.add({ at: v3(0, 0, 6), size: v3(34, 2, 12), color: '#3a4250', material: 'metal' })

    // ---- the SCREEN: glowing panel on the north wall, framed ----
    slab(0, -23, 30, 9, 0.6, '#1a1a26', 'stone')          // dark backing
    glow(0, 6, -22.5, 26, 7, 0.4, '#cfe8ff')              // the picture
    glow(0, 9.8, -22.5, 27, 0.4, 0.3, '#ff5a1f')          // top marquee strip
    w.label('NOW PLAYING: TOTAL MELTDOWN', v3(0, 11.5, -22.8), 0.5, '#ffd9a8')
    // stadium seating rising toward the back — cover + verticality
    slab(0, -17, 28, 1.4, 3, '#6a5a4a', 'wood')
    slab(0, -13, 28, 2.6, 3, '#6a5a4a', 'wood')
    slab(0, -9, 28, 3.8, 3, '#6a5a4a', 'wood')

    // ---- BALCONY (overlooks the screen from the south) + projection deck ----
    deck(0, 8, 4, 32, 10)                                  // balcony floor (top ~8.2)
    block(0, 8.9, -1, 32, 1.4, 0.6, '#5a4038', 'wood')     // front rail, on the deck
    glow(0, 8.4, -0.7, 30, 0.2, 0.2, '#59f7d2')            // neon rail trim
    // projection console facing the screen
    block(0, 8.8, 8.4, 8, 1.2, 2, '#2a2f3a', 'metal')
    glow(0, 9.5, 7.6, 6, 0.2, 0.2, '#9fe8d8')
    // access: interior staircase up the west lobby wall -> balcony
    for (let i = 0; i < 7; i++) {
      w.add({ at: v3(-14, 1 + (1 + i) / 2, 9.5 - i * 1.3), size: v3(3, 1 + i, 1.4), color: '#7a7f86', material: 'stone' })
    }
    // open-auditorium bounce pad (tall volume, no ceiling until the roof) -> high seats
    w.bouncePad(v3(0, 1.4, -6), 26)

    // ---- ROOFTOP (the power-weapon throne) ----
    deck(0, 13, -6, 38, 38)                               // roof (top ~13.2)
    block(0, 13.9, -24, 38, 1.2, 1, WALL)                  // parapet (north, on roof)
    block(-5, 13.9, 12, 28, 1.2, 1, WALL)                  // parapet (south, left of fire-escape)
    block(17, 13.9, 12, 4, 1.2, 1, WALL)                   // parapet (south, right)
    block(-18, 13.9, -6, 1, 1.2, 38, WALL)                 // parapet (west)
    block(18, 13.9, -6, 1, 1.2, 38, WALL)                  // parapet (east)
    glow(0, 13.2, -12, 10, 0.2, 8, '#9fe8d8')             // skylight over the seats
    block(-12, 14.5, -16, 4, 3, 4, '#5a5f6b', 'metal')     // AC units (on roof)
    block(13, 14.5, -2, 5, 3, 5, '#5a5f6b', 'metal')
    block(8, 15, 8, 4, 4, 4, '#5a5f6b', 'metal')
    // exterior fire-escape: south facade -> rooftop
    for (let i = 0; i < 7; i++) {
      w.add({ at: v3(12, 1 + (2 + i * 1.8) / 2, 20 - i), size: v3(4, 2 + i * 1.8, 1.4), color: '#7a7f86', material: 'stone' })
    }
    // roof-edge bounce pad for rooftop traversal
    w.bouncePad(v3(12, 13.5, -16), 20)

    // ---- MARQUEE over the south entrance ----
    block(0, 12.5, 13.2, 16, 2.4, 1.2, '#1a1a26', 'stone') // header board, up high
    glow(0, 12.4, 13.1, 15, 1.6, 0.2, '#ff5a1f')         // glowing band
    w.label('★ TOTAL MELTDOWN ★', v3(0, 12.4, 14.2), 1.0, '#ffcf6b')
    w.label('CINEMA', v3(0, 10.4, 14.2), 0.8, '#ffd9a8')
    glow(-6, 7.5, 12.8, 0.5, 9, 0.4, '#ff4d6d')          // neon pillar lights
    glow(6, 7.5, 12.8, 0.5, 9, 0.4, '#4d8bff')
    glow(0, 1.08, 18, 10, 0.12, 6, '#b3122b')            // red carpet to the curb

    // ---- BACK ALLEY (east): flaming dumpsters ----
    poi('ALLEY', 25, 6)
    w.add({ at: v3(25, 1.05, -2), size: v3(14, 0.2, 26), color: '#2c2f36', material: 'stone' }) // alley pad (flush)
    for (const [ax, az] of [[23, -10], [27, -14]] as const) {
      slab(ax, az, 4, 2.4, 3.2, '#3f6f4a', 'metal')      // dumpster body
      w.lava(v3(ax, Y + 2.4, az), v3(3.2, 0.5, 2.4))     // burning trash
    }
    slab(31, -4, 1.2, 6, 18, '#3a3d44', 'stone')         // alley back wall
    glow(28, 5.5, 6, 4, 0.25, 0.25, '#ffd166')           // buzzing alley sign
    w.label('ALLEY', v3(25, 8, 6), 0.6, '#ffd166')

    // ---- OPEN-AIR BAR (west): counter, stools, neon ----
    poi('BAR', -25, 12)
    w.add({ at: v3(-25, 1.05, 2), size: v3(12, 0.2, 16), color: '#4a3b2e', material: 'wood' }) // bar deck (flush)
    slab(-25, 0, 10, 1.6, 2, '#5a4030', 'wood')       // the counter
    glow(-25, 2.0, 8.2, 9, 0.25, 0.25, '#59f7d2')        // bar runner
    for (const sx of [-29, -27, -23, -21] as const) {     // stools
      w.add({ at: v3(sx, 1.4, 3), size: v3(0.8, 1.4, 0.8), color: '#7a4a3a', material: 'wood' })
    }
    block(-25, 5, 2, 12, 0.4, 10, '#3a3028', 'wood')      // roof (elevated)
    for (const [px, pz] of [[-30, -2], [-30, 6], [-20, -2], [-20, 6]] as const) {
      slab(px, pz, 0.6, 5, 0.6, '#6a5a4a', 'wood')        // roof posts
    }
    w.label('🍸 BAR', v3(-25, 6.2, 2), 0.9, '#59f7d2')

    // ---- PARKED RIDES (the genre's blow-up-everything props) ----
    w.vehicle('car', v3(0, 1.2, 24))
    w.vehicle('jetpack', v3(21, 1.2, 10))                 // rooftop mobility

    // ---- CONTESTED ARSENAL (mirrored for flow) ----
    w.weaponSpawn(v3(0, 14, -10), 'twinboomer')           // rooftop: the power gun
    w.weaponSpawn(v3(-14, 9, 4), 'shock')                 // balcony west
    w.weaponSpawn(v3(14, 9, 4), 'rockets')                // balcony east
    w.weaponSpawn(v3(25, 2, -2), 'flak')                  // alley (shotgun country)
    w.weaponSpawn(v3(-25, 1.8, 5), 'minigun')            // bar (chaingun)
    w.weaponSpawn(v3(0, 2, -16), 'pulse')                 // auditorium
    w.weaponSpawn(v3(-14, 14, -20), 'sniper')            // rooftop snipe nest
    for (const [ax, az, ay] of [[0, 2, 2], [10, -10, 2], [-10, -10, 2], [0, 8.6, 8.4], [0, 14, 0]] as const) {
      w.ammoSpawn(v3(ax, ay, az))
    }
    for (const [hx, hz, hy] of [[0, 0, 2], [25, 6, 2], [-25, -4, 2], [0, 8.6, 8.6]] as const) {
      w.healthPack(v3(hx, hy, hz))
    }

    // ---- INTERIOR LIGHTING (the neon-house glow; a few point lights) ----
    w.light(v3(0, 7, -16), { color: '#bfe0ff', intensity: 140, range: 30 }) // screen wash
    w.light(v3(0, 7, 6), { color: '#ffd9a8', intensity: 120, range: 22 })   // lobby
    w.light(v3(0, 11, 4), { color: '#ffd9a8', intensity: 90, range: 18 })   // balcony
    w.light(v3(25, 5, -2), { color: '#ff9d5e', intensity: 90, range: 18 })  // alley fire
    w.light(v3(-25, 5, 2), { color: '#59f7d2', intensity: 80, range: 18 })  // bar
    w.light(v3(0, 16, 16), { color: '#ff5a1f', intensity: 120, range: 26 }) // marquee
  },

  // ---------------------------------------------------------------- match --
  onStart(ctx) {
    frags = new Map()
    matchOver = false
    matchStartT = ctx.time

    ctx.setSpawnPoints(SPAWNS)
    ctx.player.teleport(SPAWNS[0])
    for (let i = 0; i < BOT_NAMES.length; i++) {
      ctx.spawnBot({ name: BOT_NAMES[i], skill: 0.5 + i * 0.06, spawns: SPAWNS })
    }

    ctx.hud.set('frags', `💀 0/${FRAG_LIMIT}`)
    ctx.hud.set('leader', `👑 —`)
    ctx.hud.big('🎬 CINEMA CARNAGE', 2200)
    ctx.hud.toast('Free-for-all. First to 25 frags wins.')
    ctx.systemChat('Lock and load. You drop in with a Sidearm + Flak — the heavy guns are pickups.')
    ctx.systemChat('Rooftop holds the Twin Boomer. Balcony = Rockets/Shock. Alley = Flak. Bar = Minigun.')
    ctx.systemChat('Inside stairs reach the balcony. The south fire-escape + jetpack hit the rooftop.')
  },

  onTick(ctx) {
    if (matchOver) return
    const me = ctx.entities.find((e) => e.isSelf)
    const myFrags = me ? (frags.get(me.id) ?? 0) : 0
    ctx.hud.set('frags', `💀 ${myFrags}/${FRAG_LIMIT}`)

    // leaderboard: top fragger
    let topId: string | null = null
    let topN = -1
    for (const [id, n] of frags) {
      if (n > topN) { topN = n; topId = id }
    }
    ctx.hud.set('leader', topId ? `👑 ${nameFor(ctx, topId)} ${topN}` : '👑 —')
  },

  onKill(ctx, info) {
    if (matchOver) return
    if (info.killerId) {
      frags.set(info.killerId, (frags.get(info.killerId) ?? 0) + 1)
    }
    // suicides cost a frag — keeps the scoreboard honest
    if (!info.killerId || info.killerId === info.victimId) {
      frags.set(info.victimId, (frags.get(info.victimId) ?? 0) - 1)
    }

    if (info.killerIsSelf) {
      ctx.hud.toast(KILL_LINES[Math.floor(Math.random() * KILL_LINES.length)])
      ctx.earnBlobcash(15, 'frag')
      audio.capture()
    }

    const winnerId = info.killerId && info.killerId !== info.victimId ? info.killerId : null
    if (winnerId && (frags.get(winnerId) ?? 0) >= FRAG_LIMIT) {
      matchOver = true
      const selfWon = info.killerIsSelf
      if (selfWon) {
        ctx.celebrate('🏆 TOTAL MELTDOWN — YOU WIN!')
        ctx.earnBlobcash(200, 'carnage victory')
      } else {
        ctx.hud.big(`💀 ${nameFor(ctx, winnerId).toUpperCase()} WINS`, 3000)
        audio.death()
      }
      setTimeout(() => restartMatch(ctx), 6000)
    }
  },
})

// ---------------------------------------------------------------- helpers --

function restartMatch(ctx: GameContext) {
  frags = new Map()
  matchOver = false
  matchStartT = ctx.time
  for (const e of ctx.entities) e.respawn()
  ctx.hud.set('frags', `💀 0/${FRAG_LIMIT}`)
  ctx.hud.set('leader', `👑 —`)
  ctx.hud.big('🎬 NEW MATCH', 2000)
  audio.flagAlarm()
}
