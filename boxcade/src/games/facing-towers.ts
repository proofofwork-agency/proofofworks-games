// Facing Towers — two towers, one bridge, deep space: the classic arena-CTF
// archetype, built from scratch. 3v3 capture the flag against bots, the
// full weapon arsenal, low gravity. All geometry, names and assets are
// Boxcade originals — see README "Licensing & inspirations".

import { defineGame, buildTextMap, v3, DEFAULT_LOADOUT, type Vec3, type GameContext, type EntityApi, type PartHandle, type TextMapResult } from '../sdk'
import { audio } from '../engine/audio'
import faceMap from '../maps/facing-towers.txt?raw'

const CAPS_TO_WIN = 3
const BOT_NAMES_BLUE = ['Xenna', 'Mal', 'Vortex']
const BOT_NAMES_RED = ['Loque-7', 'Tamara']

interface FlagState {
  team: 'red' | 'blue'
  stand: Vec3
  state: 'base' | 'carried' | 'dropped'
  carrierId: string | null
  dropTimer: number
  part: PartHandle | null
}

let map: TextMapResult | null = null
let flags: { red: FlagState; blue: FlagState } | null = null
let score = { red: 0, blue: 0 }
let roundOver = false

function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  const dy = a.y - b.y
  return dx * dx + dz * dz + dy * dy * 0.25 // forgiving vertically
}

export default defineGame({
  meta: {
    id: 'facing-towers',
    name: 'Facing Towers',
    blurb: 'Two towers. One bridge. Deep space. 3v3 capture-the-flag with bots and the full arsenal.',
    emoji: '🚩',
    gradient: 'linear-gradient(135deg, #1b1f3d 0%, #5d2bd1 55%, #03040c 100%)',
    genre: 'CTF Shooter · Bots',
  },
  camera: 'fp',
  rtReflections: true, // the metal bridge deck mirrors towers, neon and rockets
  // CTF signature gun: a silent, hard-hitting bolt thrower for the bridge duels
  weapons: [{ id: 'crossbow', name: 'Storm Crossbow', icon: '⚡🏹', kind: 'projectile', damage: 48, fireRate: 1.1, projectile: { speed: 55, radius: 0.12, color: '#caffb0', life: 2.5 }, ammoMax: 14, ammoPickup: 5, botRange: [10, 80], sound: 'shock' }],
  combat: {
    selfTeam: 'red',
    health: 100,
    respawnSeconds: 3,
    weapons: [...DEFAULT_LOADOUT, 'crossbow'], // full arsenal + the contested crossbow
    // everyone spawns light — the heavy arsenal is contested on the map
    startWeapons: ['sidearm', 'pulse'],
  },

  build(w) {
    map = buildTextMap(w, faceMap)
    w.label('FACING TOWERS', v3(0, 24, 0), 1.6, '#cdd6ff')

    // Contested arsenal — mirrored so both teams reach equal firepower in
    // equal time. Heavy guns on the bridge, snipers on the tower roofs.
    for (const s of [1, -1]) {
      w.weaponSpawn(v3(6 * s, 1.8, 0), 'rockets')   // center side pods
      w.weaponSpawn(v3(0, 1.8, 14 * s), 'minigun')
      w.weaponSpawn(v3(0, 1.8, 32 * s), 'flak')
      w.weaponSpawn(v3(0, 1.8, 44 * s), 'shock')
      w.weaponSpawn(v3(-4, 1.8, 38 * s), 'crossbow') // flag-approach lanes
      w.weaponSpawn(v3(4, 13.8, 52 * s), 'sniper')  // tower roofs
      w.ammoSpawn(v3(0, 1.8, 24 * s))
      w.ammoSpawn(v3(0, 1.8, 48 * s))
    }

    // Interior lighting — the towers are fully enclosed, so the space sun
    // never reaches inside. Every floor gets a glowing ceiling fixture with a
    // real point light under it (rooms span y≈1–4, 5–8 and 9–12 per tower).
    for (const flag of [map.redFlag, map.blueFlag]) {
      if (!flag) continue
      const tint = flag === map.redFlag ? '#ffb4a8' : '#a8c4ff'
      w.light(v3(flag.x, flag.y + 2.5, flag.z), { color: tint, intensity: 180, range: 24 })
      w.light(v3(flag.x, flag.y + 6.3, flag.z), { color: '#ffe2bd', intensity: 150, range: 20 })
      w.light(v3(flag.x, flag.y + 10.3, flag.z), { color: '#ffe2bd', intensity: 150, range: 20 })
      for (const fy of [2.85, 6.75, 10.75]) {
        w.add({
          at: v3(flag.x, flag.y + fy, flag.z), size: v3(2.6, 0.18, 2.6),
          color: '#ffe9c9', material: 'neon', collide: false,
        })
      }
    }
    for (const z of [-30, 0, 30]) {
      w.light(v3(0, 5, z), { color: '#9fe8d8', intensity: 80, range: 30 })
    }

    // drifting asteroids for depth
    const rocks: Array<[number, number, number, number]> = [
      [-34, 6, -26, 2.2], [30, 14, 18, 3.1], [-26, 20, 34, 1.6],
      [36, 4, -40, 2.6], [-40, 12, 8, 1.9], [28, 26, -12, 1.2],
    ]
    for (const [x, y, z, s] of rocks) {
      w.add({
        at: v3(x, y, z), size: v3(3 * s, 2.2 * s, 2.6 * s), color: '#5a5f6b',
        material: 'stone', collide: false, rotY: x * 0.7,
      })
    }
  },

  onStart(ctx) {
    score = { red: 0, blue: 0 }
    roundOver = false
    const m = map!
    const redStand = m.redFlag ?? v3(0, 1, -52)
    const blueStand = m.blueFlag ?? v3(0, 1, 52)

    flags = {
      red: makeFlag(ctx, 'red', redStand),
      blue: makeFlag(ctx, 'blue', blueStand),
    }

    ctx.setSpawnPoints(m.redSpawns.length ? m.redSpawns : [v3(0, 3, -48)])
    ctx.player.teleport(m.redSpawns[0] ?? v3(0, 3, -48))
    for (let i = 0; i < BOT_NAMES_RED.length; i++) {
      ctx.spawnBot({ name: BOT_NAMES_RED[i], team: 'red', skill: 0.55, spawns: m.redSpawns })
    }
    for (let i = 0; i < BOT_NAMES_BLUE.length; i++) {
      ctx.spawnBot({ name: BOT_NAMES_BLUE[i], team: 'blue', skill: 0.5 + i * 0.12, spawns: m.blueSpawns })
    }

    ctx.hud.set('score', `🔴 0 — 0 🔵`)
    ctx.hud.toast(`Capture the blue flag ${CAPS_TO_WIN}× to win!`)
    ctx.systemChat('You spawn light: Sidearm + Pulse. The heavy guns sit on glowing pads — bridge & tower roofs.')
    ctx.systemChat('Ammo is limited! Grab 📦 crates to restock. Keys 1–7 or scroll · right-click zooms the sniper.')
  },

  onTick(ctx, dt) {
    if (!flags || !map || roundOver) return
    const everyone = ctx.entities

    for (const team of ['red', 'blue'] as const) {
      const flag = flags[team]
      const enemyTeam = team === 'red' ? 'blue' : 'red'

      // dropped flags tick home (a flag knocked into space returns at once)
      if (flag.state === 'dropped') {
        flag.dropTimer -= dt
        if (flag.part && flag.part.pos.y < -6) {
          returnFlag(ctx, flag)
          ctx.systemChat(`🚩 The ${team.toUpperCase()} flag fell into space — returned home.`)
        } else if (flag.dropTimer <= 0) {
          returnFlag(ctx, flag)
        }
      }

      // carried flags ride on the carrier
      if (flag.state === 'carried' && flag.part) {
        const carrier = everyone.find((e) => e.id === flag.carrierId)
        if (carrier && carrier.alive) {
          const p = carrier.position
          flag.part.pos.x = p.x
          flag.part.pos.y = p.y + 2.9
          flag.part.pos.z = p.z
        } else if (carrier) {
          dropFlag(ctx, flag, carrier.position)
        }
      }

      for (const e of everyone) {
        if (!e.alive || !e.team) continue
        const pos = e.position

        // pick up the enemy flag
        if (e.team === enemyTeam && flag.state !== 'carried' && flag.part && dist2(pos, flag.part.pos) < 3.4) {
          flag.state = 'carried'
          flag.carrierId = e.id
          e.carrying = team + '-flag'
          audio.flagAlarm()
          ctx.systemChat(`🚩 ${e.name} took the ${team.toUpperCase()} flag!`)
          if (e.isSelf) ctx.hud.big('🚩 YOU HAVE THE FLAG!', 1800)
        }

        // return your own dropped flag by touching it
        if (e.team === team && flag.state === 'dropped' && flag.part && dist2(pos, flag.part.pos) < 3.4) {
          returnFlag(ctx, flag)
          ctx.systemChat(`${e.name} returned the ${team.toUpperCase()} flag.`)
        }

        // score: carry the enemy flag onto your own stand while your flag is home
        const own = flags[e.team as 'red' | 'blue']
        const enemyFlag = flags[e.team === 'red' ? 'blue' : 'red']
        if (
          e.carrying && enemyFlag.carrierId === e.id && own.state === 'base' &&
          dist2(pos, own.stand) < 4.5
        ) {
          e.carrying = null
          returnFlag(ctx, enemyFlag)
          score[e.team as 'red' | 'blue']++
          audio.capture()
          ctx.hud.set('score', `🔴 ${score.red} — ${score.blue} 🔵`)
          ctx.hud.big(`${e.team === 'red' ? '🔴' : '🔵'} ${e.team.toUpperCase()} SCORES!`, 2000)
          if (e.isSelf) ctx.earnBolts(50, 'flag capture')

          if (score[e.team as 'red' | 'blue'] >= CAPS_TO_WIN) {
            roundOver = true
            const selfWon = e.team === 'red'
            ctx.celebrate(selfWon ? '🏆 RED WINS!' : '🔵 BLUE WINS')
            if (selfWon) ctx.earnBolts(150, 'match win')
            setTimeout(() => resetRound(ctx), 4500)
          }
        }
      }
    }

    // bot objectives: carry home > recover stolen flag > hunt the enemy flag
    for (const e of everyone) {
      if (!e.isBot || !e.alive) continue
      const own = flags[e.team as 'red' | 'blue']
      const enemyFlag = flags[e.team === 'red' ? 'blue' : 'red']
      if (e.carrying) {
        e.setObjective(own.stand)
      } else if (own.state === 'carried') {
        const thief = everyone.find((x) => x.id === own.carrierId)
        e.setObjective(thief ? thief.position : own.stand)
      } else if (own.state === 'dropped' && own.part) {
        e.setObjective(own.part.pos)
      } else {
        e.setObjective(enemyFlag.part ? enemyFlag.part.pos : enemyFlag.stand)
      }
    }
  },

  onKill(ctx, info) {
    if (!flags) return
    // carriers drop the flag where they died
    for (const team of ['red', 'blue'] as const) {
      const flag = flags[team]
      if (flag.state === 'carried' && flag.carrierId === info.victimId) {
        const victim = ctx.entities.find((e) => e.id === info.victimId)
        dropFlag(ctx, flag, victim ? victim.position : flag.stand)
        ctx.systemChat(`🚩 ${team.toUpperCase()} flag is down!`)
      }
    }
  },
})

function makeFlag(ctx: GameContext, team: 'red' | 'blue', stand: Vec3): FlagState {
  const color = team === 'red' ? '#ff4d4d' : '#4d8bff'
  const part = ctx.addPart({
    at: v3(stand.x, stand.y + 1.3, stand.z),
    size: v3(0.5, 2.6, 0.5),
    color,
    material: 'neon',
    collide: false,
  })
  return { team, stand, state: 'base', carrierId: null, dropTimer: 0, part }
}

function returnFlag(ctx: GameContext, flag: FlagState) {
  flag.state = 'base'
  flag.carrierId = null
  flag.dropTimer = 0
  for (const e of ctx.entities) {
    if (e.carrying === flag.team + '-flag') e.carrying = null
  }
  if (flag.part) {
    flag.part.pos.x = flag.stand.x
    flag.part.pos.y = flag.stand.y + 1.3
    flag.part.pos.z = flag.stand.z
  }
}

function dropFlag(ctx: GameContext, flag: FlagState, at: Vec3) {
  flag.state = 'dropped'
  flag.carrierId = null
  flag.dropTimer = 12
  for (const e of ctx.entities) {
    if (e.carrying === flag.team + '-flag') e.carrying = null
  }
  if (flag.part) {
    flag.part.pos.x = at.x
    flag.part.pos.y = at.y + 1.3
    flag.part.pos.z = at.z
  }
}

function resetRound(ctx: GameContext) {
  if (!flags) return
  score = { red: 0, blue: 0 }
  roundOver = false
  returnFlag(ctx, flags.red)
  returnFlag(ctx, flags.blue)
  for (const e of ctx.entities) e.respawn()
  ctx.hud.set('score', `🔴 0 — 0 🔵`)
  ctx.hud.toast('New round!')
}
