// Dustyard -- a compact desert oil-yard shooter built in trusted TypeScript
// mode. It uses broad arena cues from dusty Call of Duty oil-yard maps: a
// central tower, raised pipes, container lanes, fuel tanks and exposed sand.
// The layout and names here are original to Blobcade.

import { DEFAULT_LOADOUT, defineGame, v3, type EntityApi, type MaterialKind, type Vec3, type WorldBuilder } from '../sdk'

const RED_SPAWNS = [v3(-30, 3, -29), v3(-24, 3, -34), v3(-35, 3, -22)]
const BLUE_SPAWNS = [v3(30, 3, 29), v3(24, 3, 34), v3(35, 3, 22)]
const BOT_NAMES_RED = ['Rook', 'Vega']
const BOT_NAMES_BLUE = ['Mako', 'Graves', 'Sable']

const HOLD_POINTS = [
  v3(0, 1.2, 0),
  v3(-24, 1.2, -18),
  v3(23, 1.2, 18),
  v3(-29, 1.2, 27),
  v3(29, 1.2, -26),
  v3(0, 9.4, 0),
]

let redScore = 0
let blueScore = 0
let matchClock = 0
let objectiveClock = 0
let objectiveIndex = 0
let roundOver = false
let nextThink = new Map<string, number>()

function scoreFor(team: string | null): number {
  return team === 'red' ? redScore : team === 'blue' ? blueScore : 0
}

function nearestEnemy(self: EntityApi, all: EntityApi[]): EntityApi | null {
  let best: EntityApi | null = null
  let bestD = Infinity
  for (const e of all) {
    if (!e.alive || e.team === self.team) continue
    const dx = e.position.x - self.position.x
    const dz = e.position.z - self.position.z
    const d = dx * dx + dz * dz
    if (d < bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

export default defineGame({
  meta: {
    id: 'dustyard',
    name: 'Dustyard',
    blurb: 'Fight through a dusty desert oil yard: central tower, pipeline lanes, containers, fuel tanks and fast bot skirmishes.',
    emoji: '🏜️',
    gradient: 'linear-gradient(135deg, #d8b66f 0%, #6f7b82 52%, #9f4f32 100%)',
    genre: 'Arena Shooter · Bots',
  },
  camera: 'fp',
  maxPlayers: 16,
  rtReflections: true,
  combat: {
    selfTeam: 'red',
    health: 100,
    respawnSeconds: 4,
    weapons: [...DEFAULT_LOADOUT],
    startWeapons: ['sidearm', 'pulse'],
  },

  build(w) {
    w.lighting('goldenHour')
    w.killY(-10)
    w.spawn(RED_SPAWNS[0])
    w.physics({ walkSpeed: 8.8, jumpVel: 14.8, gravity: -44, fallDamage: true })

    const add = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material: MaterialKind = 'stone', rotY = 0, collide = true) =>
      w.add({ at: v3(x, y, z), size: v3(sx, sy, sz), color, material, rotY, collide })
    const block = (x: number, z: number, sx: number, sy: number, sz: number, color: string, material: MaterialKind = 'stone', rotY = 0) =>
      add(x, 1 + sy / 2, z, sx, sy, sz, color, material, rotY)

    // Sand bowl and industrial edge walls.
    add(0, 0, 0, 92, 1, 92, '#d9bd78', 'sand')
    add(0, -0.4, 0, 98, 0.45, 98, '#b79c63', 'stone')
    add(0, 4.5, -45, 92, 8, 2.5, '#8b806e')
    add(0, 4.5, 45, 92, 8, 2.5, '#8b806e')
    add(-45, 4.5, 0, 2.5, 8, 92, '#8b806e')
    add(45, 4.5, 0, 2.5, 8, 92, '#8b806e')

    // Soft dunes just outside the playable square.
    for (const [x, z, sx, sz] of [
      [-34, -50, 20, 6], [20, -51, 28, 7], [-50, 18, 7, 28], [49, -20, 6, 24], [4, 50, 30, 6],
    ] as const) {
      add(x, 0.8, z, sx, 1.2, sz, '#cfae6d', 'sand', x * 0.02, false)
    }

    buildTower(w, add)
    buildPipeline(w, add, block)
    buildContainers(w, add, block)
    buildFuelDepot(w, add, block)
    buildPerimeterProps(w, add, block)

    // Readable zone labels, high enough to stay out of firefights.
    w.label('DUSTYARD', v3(0, 23, 0), 1.4, '#ffe0a1')
    w.label('PIPELINE', v3(-19, 7, -32), 0.55, '#dcecff')
    w.label('LOADING DOCK', v3(-30, 6.5, 27), 0.5, '#dcecff')
    w.label('FUEL DEPOT', v3(29, 7, 25), 0.5, '#ffd2b4')
    w.label('COMMS', v3(33, 8, -31), 0.5, '#dcecff')

    // Contested pickups reflect Rust-style vertical risk: strongest weapons
    // are visible and exposed.
    w.weaponSpawn(v3(0, 16.3, 0), 'sniper')
    w.weaponSpawn(v3(0, 9.5, -5), 'rockets')
    w.weaponSpawn(v3(-23, 4.6, -26), 'minigun')
    w.weaponSpawn(v3(27, 2.2, 23), 'flak')
    w.weaponSpawn(v3(-30, 2.2, 28), 'shock')
    w.weaponSpawn(v3(31, 2.2, -31), 'pulse')

    for (const p of [v3(-13, 2.2, 10), v3(13, 2.2, -10), v3(-31, 2.2, -10), v3(31, 2.2, 9), v3(0, 10.4, 6)]) w.ammoSpawn(p)
    for (const p of [v3(-20, 2.2, 31), v3(20, 2.2, -31), v3(-5, 2.2, -28), v3(6, 2.2, 28)]) w.healthPack(p)

    w.light(v3(0, 12, 0), { color: '#ffcf8a', intensity: 190, range: 46 })
    w.light(v3(-29, 5, 27), { color: '#bcd8ff', intensity: 75, range: 18 })
    w.light(v3(29, 5, -29), { color: '#bcd8ff', intensity: 75, range: 18 })
    w.light(v3(25, 5, 23), { color: '#ffd1a1', intensity: 85, range: 22 })
  },

  onStart(ctx) {
    redScore = 0
    blueScore = 0
    matchClock = 240
    objectiveClock = 0
    objectiveIndex = 0
    roundOver = false
    nextThink = new Map()

    ctx.setSpawnPoints(RED_SPAWNS)
    ctx.player.teleport(RED_SPAWNS[0])

    for (let i = 0; i < BOT_NAMES_RED.length; i++) {
      ctx.spawnBot({ name: BOT_NAMES_RED[i], team: 'red', skill: 0.56 + i * 0.08, spawns: RED_SPAWNS })
    }
    for (let i = 0; i < BOT_NAMES_BLUE.length; i++) {
      ctx.spawnBot({ name: BOT_NAMES_BLUE[i], team: 'blue', skill: 0.58 + i * 0.08, spawns: BLUE_SPAWNS })
    }

    ctx.hud.set('score', 'RED 0 - 0 BLUE')
    ctx.hud.set('timer', '4:00')
    ctx.hud.set('point', 'HOLD: TOWER')
    ctx.hud.big('DUSTYARD', 1800)
    ctx.systemChat('Hold the rotating hot zone and fight for tower control. Sniper is exposed on the top deck.')
  },

  onTick(ctx, dt) {
    if (roundOver) return

    matchClock = Math.max(0, matchClock - dt)
    objectiveClock += dt
    if (objectiveClock >= 38) {
      objectiveClock = 0
      objectiveIndex = (objectiveIndex + 1) % HOLD_POINTS.length
      const names = ['TOWER', 'OIL DERRICK', 'FUEL DEPOT', 'LOADING DOCK', 'COMMS', 'TOP DECK']
      ctx.hud.set('point', `HOLD: ${names[objectiveIndex]}`)
      ctx.hud.toast(`Hot zone moved to ${names[objectiveIndex]}`)
    }

    const point = HOLD_POINTS[objectiveIndex]
    let redNear = 0
    let blueNear = 0
    for (const e of ctx.entities) {
      if (!e.alive || !e.team) continue
      const d = Math.hypot(e.position.x - point.x, e.position.z - point.z)
      if (d < 9 && Math.abs(e.position.y - point.y) < 6) {
        if (e.team === 'red') redNear++
        else if (e.team === 'blue') blueNear++
      }
    }
    if (redNear > 0 && blueNear === 0) redScore += dt * (redNear > 1 ? 1.3 : 1)
    if (blueNear > 0 && redNear === 0) blueScore += dt * (blueNear > 1 ? 1.3 : 1)

    ctx.hud.set('score', `RED ${Math.floor(redScore)} - ${Math.floor(blueScore)} BLUE`)
    const mins = Math.floor(matchClock / 60)
    const secs = Math.floor(matchClock % 60).toString().padStart(2, '0')
    ctx.hud.set('timer', `${mins}:${secs}`)

    const all = ctx.entities
    for (const bot of all) {
      if (!bot.isBot || !bot.alive) continue
      const thinkAt = nextThink.get(bot.id) ?? 0
      if (ctx.time < thinkAt) continue
      nextThink.set(bot.id, ctx.time + 2.2 + Math.random() * 1.8)
      const enemy = nearestEnemy(bot, all)
      if (enemy && Math.hypot(enemy.position.x - bot.position.x, enemy.position.z - bot.position.z) < 19) {
        bot.setObjective(enemy.position)
      } else {
        const spread = bot.team === 'red' ? -1 : 1
        bot.setObjective(v3(point.x + (Math.random() - 0.5) * 8, point.y, point.z + spread * (2 + Math.random() * 6)))
      }
    }

    if (redScore >= 100 || blueScore >= 100 || matchClock <= 0) {
      roundOver = true
      const redWon = redScore >= blueScore
      ctx.celebrate(redWon ? 'RED CONTROLS THE YARD' : 'BLUE CONTROLS THE YARD')
      if (redWon) ctx.earnBlobcash(120, 'dustyard victory')
      setTimeout(() => {
        for (const e of ctx.entities) e.respawn()
        ctx.player.teleport(RED_SPAWNS[0])
        redScore = 0
        blueScore = 0
        matchClock = 240
        roundOver = false
      }, 5000)
    }
  },

  onKill(ctx, info) {
    if (info.killerTeam === 'red') redScore += 4
    if (info.killerTeam === 'blue') blueScore += 4
    if (info.killerIsSelf) ctx.earnBlobcash(5, 'dustyard elimination')
    ctx.hud.set('score', `RED ${Math.floor(scoreFor('red'))} - ${Math.floor(scoreFor('blue'))} BLUE`)
  },
})

function buildTower(
  w: WorldBuilder,
  add: (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number, collide?: boolean) => void,
) {
  // Wide lower pad, four structural legs, three exposed decks and a climb
  // shaft. This gives the same "valuable but dangerous" tower rhythm without
  // copying any original layout.
  add(0, 1.12, 0, 20, 0.45, 20, '#9b8c74', 'metal')
  add(0, 4.4, 0, 12, 0.55, 12, '#6f7478', 'metal')
  add(0, 8.8, 0, 9, 0.5, 9, '#747a7f', 'metal')
  add(0, 15.6, 0, 6, 0.48, 6, '#858a8e', 'metal')
  for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as const) {
    add(x, 8.2, z, 0.65, 14.5, 0.65, '#5e656b', 'metal')
  }
  add(-3.8, 6.8, 0, 0.5, 10, 0.5, '#c3b393', 'metal')
  add(3.8, 6.8, 0, 0.5, 10, 0.5, '#c3b393', 'metal')
  add(0, 7, 0, 2.6, 12, 1.4, '#d6c28b', 'metal', 0, false)
  w.add({ at: v3(0, 7, 0), size: v3(2.8, 12, 1.8), color: '#d6c28b', material: 'glass', collide: false, climbable: true })
  for (let y = 2; y < 14; y += 1.35) add(0, y, 0, 3.2, 0.15, 0.18, '#e2d1a3', 'metal', 0, false)

  // Low ramps and bridge pipes give two risky approaches to the middle deck.
  add(-8.5, 2.8, -1.8, 10, 0.55, 2.3, '#77746d', 'metal', -0.33)
  add(8.5, 2.8, 1.8, 10, 0.55, 2.3, '#77746d', 'metal', -0.33)
  add(-6.5, 6.9, -8.6, 11, 0.65, 2.2, '#746c5d', 'metal', 0.48)
  add(6.5, 6.9, 8.6, 11, 0.65, 2.2, '#746c5d', 'metal', 0.48)
}

function buildPipeline(
  w: WorldBuilder,
  add: (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number, collide?: boolean) => void,
  block: (x: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number) => void,
) {
  block(-24, -25, 14, 5, 8, '#8d7b5e')
  add(-24, 5.1, -25, 15, 0.45, 9, '#6e767b', 'metal')
  add(-16, 4.2, -32, 28, 1.2, 1.2, '#a37c55', 'metal')
  add(-2, 5, -32, 20, 1.1, 1.1, '#b58b61', 'metal', 0.08)
  add(-31, 2.2, -33, 8, 1.05, 1.05, '#a37c55', 'metal')
  add(-28, 2.6, -18, 0.75, 3.2, 0.75, '#6d7377', 'metal')
  add(-20, 2.6, -18, 0.75, 3.2, 0.75, '#6d7377', 'metal')
  w.label('OIL DERRICK', v3(-24, 8, -23), 0.48, '#f4dfb0')
}

function buildContainers(
  w: WorldBuilder,
  add: (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number, collide?: boolean) => void,
  block: (x: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number) => void,
) {
  const container = (x: number, z: number, color: string, rotY = 0) => {
    block(x, z, 8, 2.8, 3.2, color, 'metal', rotY)
    add(x, 3.02, z, 8.1, 0.12, 3.3, '#d8d1bf', 'metal', rotY, false)
  }
  container(-31, 22, '#3f6c93', 0.12)
  container(-24, 29, '#bb553d', -0.2)
  container(-34, 31, '#6f7c48', 0.04)
  container(26, -29, '#3f6c93', -0.1)
  container(34, -22, '#bb553d', 0.16)
  container(30, -34, '#6f7c48', 0)
  w.label('BLUE CONTAINERS', v3(-29, 5.8, 24), 0.42, '#bfdfff')
  w.label('RED CONTAINERS', v3(31, 5.8, -27), 0.42, '#ffd0bf')
}

function buildFuelDepot(
  w: WorldBuilder,
  add: (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number, collide?: boolean) => void,
  block: (x: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number) => void,
) {
  block(27, 24, 18, 1.2, 13, '#8e6b4b')
  for (const [x, z] of [[22, 22], [29, 23], [25, 29], [33, 27]] as const) {
    add(x, 2.7, z, 2.4, 3.8, 2.4, '#b9bec0', 'metal')
    add(x, 4.8, z, 2.65, 0.35, 2.65, '#d4d9db', 'metal')
  }
  add(26, 5.15, 24, 16, 0.45, 11, '#696f74', 'metal')
  add(18, 3.1, 24, 0.6, 4.2, 9, '#565e64', 'metal')
  add(35, 3.1, 24, 0.6, 4.2, 9, '#565e64', 'metal')
  w.label('GENERATORS', v3(12, 5.7, 27), 0.42, '#ffe7bf')
}

function buildPerimeterProps(
  w: WorldBuilder,
  add: (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number, collide?: boolean) => void,
  block: (x: number, z: number, sx: number, sy: number, sz: number, color: string, material?: MaterialKind, rotY?: number) => void,
) {
  // Office/comms corner.
  block(32, -34, 10, 5.2, 7, '#898f90')
  add(37, 7.8, -34, 0.55, 7, 0.55, '#c9c7b7', 'metal')
  add(37, 11.5, -34, 3.2, 0.25, 0.25, '#c9c7b7', 'metal', 0.6, false)
  add(37, 11.5, -34, 0.25, 0.25, 3.2, '#c9c7b7', 'metal', 0.6, false)

  // Loading dock and truck wreck.
  add(-30, 1.7, 29, 18, 1.4, 13, '#777067', 'metal')
  add(-37, 2.8, 18, 8, 3, 4, '#807461', 'metal', 0.25)
  add(-38, 1.4, 14, 2.2, 1.2, 2.2, '#323438', 'metal')
  add(-32, 1.4, 16, 2.2, 1.2, 2.2, '#323438', 'metal')

  // Ground cover: crates, half walls and broken sheet metal.
  for (const [x, z, sx, sz, color] of [
    [-12, 16, 5, 2, '#8b7258'], [-14, -12, 6, 2, '#877c69'], [13, 13, 5, 2, '#877c69'],
    [17, -15, 6, 2, '#8b7258'], [-32, -4, 5, 2, '#7a7f82'], [33, 5, 5, 2, '#7a7f82'],
    [-8, 31, 4, 2, '#8b7258'], [8, -31, 4, 2, '#8b7258'], [2, 21, 3, 3, '#777067'],
    [-2, -21, 3, 3, '#777067'], [20, 3, 4, 2, '#6f7c48'], [-20, -3, 4, 2, '#6f7c48'],
  ] as const) {
    block(x, z, sx, 1.6, sz, color)
  }

  // Pump jacks as blocky silhouettes.
  for (const [x, z, flip] of [[-37, -30, -1], [36, 34, 1]] as const) {
    add(x, 2.4, z, 0.55, 3.8, 0.55, '#5f6060', 'metal')
    add(x + flip * 2.2, 4.4, z, 4.8, 0.45, 0.45, '#5f6060', 'metal', 0.2 * flip)
    add(x + flip * 4.5, 2.4, z, 0.45, 3.4, 0.45, '#5f6060', 'metal')
  }

  // Dusty, non-solid background palms and towers add depth without blocking.
  for (const [x, z] of [[-40, 39], [40, -40], [42, 38], [-42, -39]] as const) {
    add(x, 3.2, z, 0.45, 5.4, 0.45, '#7b563a', 'wood', 0, false)
    add(x, 6.1, z, 3.2, 0.25, 0.8, '#6d8244', 'grass', x * 0.1, false)
    add(x, 6.2, z, 0.8, 0.25, 3.2, '#6d8244', 'grass', z * 0.1, false)
  }
  w.cloud(v3(-28, 25, -54), 1.2)
  w.cloud(v3(32, 23, 51), 1.0)
}
