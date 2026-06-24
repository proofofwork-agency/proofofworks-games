// Battle Chess — the classic "chess pieces come alive and fight" fantasy,
// built on the Blobcade combat arena. A grand 8×8 board floats over a lava
// abyss at golden hour. The Black army stands in standard opening formation;
// each piece defends its home square until you advance, then comes alive to
// hunt you down. Slay the ♚ King for checkmate.
//
// All geometry, names and assets are Blobcade originals — see README
// "Licensing & inspirations". Not affiliated with any chess game.

import { defineGame, v3, colors, DEFAULT_LOADOUT, type Vec3, type GameContext } from '../sdk'

// ---- the board: 8×8, each square CELL meters, centred on the origin ----
const CELL = 4
const HALF = (8 * CELL) / 2 // 16

// aggro radius (metres): pieces hold formation until the player approaches,
// then "come alive" and hunt — the Battle Chess twist.
const AGGRO = 13

// rank 1 = White/player side (+Z), rank 8 = Black back rank (−Z)
function sq(file: number, rank: number, y = 0): Vec3 {
  return v3(-HALF + (file + 0.5) * CELL, y, HALF - (rank - 0.5) * CELL)
}

interface Role {
  sym: string
  name: string
  weapon: string
  skill: number
  hp: number
  shirt: string
}

// each piece type = a distinct combat archetype (weapon, skill, toughness)
const ROLE: Record<string, Role> = {
  pawn: { sym: '♟', name: 'Pawn', weapon: 'sidearm', skill: 0.3, hp: 100, shirt: '#6b7280' },
  rook: { sym: '♜', name: 'Rook', weapon: 'minigun', skill: 0.48, hp: 160, shirt: '#9b6b3a' },
  knight: { sym: '♞', name: 'Knight', weapon: 'pulse', skill: 0.52, hp: 120, shirt: '#3b82f6' },
  bishop: { sym: '♝', name: 'Bishop', weapon: 'shock', skill: 0.55, hp: 120, shirt: '#8b5cf6' },
  queen: { sym: '♛', name: 'Queen', weapon: 'flak', skill: 0.66, hp: 190, shirt: '#ef4444' },
  king: { sym: '♚', name: 'King', weapon: 'rockets', skill: 0.7, hp: 240, shirt: '#ffd166' },
}

// standard back-rank placement, file a→h: R N B Q K B N R
const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
const FILES = 'abcdefgh'

// ---- session state (re-initialised each onStart) ----
let kingId: string | null = null
let homeOf: Map<string, Vec3> = new Map()
let roundOver = false
let kingAloneShown = false

function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

export default defineGame({
  meta: {
    id: 'battle-chess',
    name: 'Battle Chess',
    blurb: 'A chess board over a lava abyss. The Black army stands in formation — advance and the pieces come alive to fight. Slay the ♚ King for checkmate.',
    emoji: '♟️',
    gradient: 'linear-gradient(135deg, #1f2433 0%, #6b5a2e 50%, #15171d 100%)',
    genre: 'Arena · Chess',
  },
  camera: 'fp',
  rtReflections: true, // the gold frame + marble lip mirror the pieces and lava glow

  combat: {
    selfTeam: 'white',
    health: 100,
    respawnSeconds: 4,
    weapons: [...DEFAULT_LOADOUT, 'rockets', 'sniper'],
    startWeapons: ['sidearm', 'pulse'], // you spawn light — push the centre for the heavy guns
  },

  build(w) {
    w.lighting('goldenHour')
    w.killY(-14)

    // ---- the marble slab the board rests on ----
    w.add({ at: v3(0, -2, 0), size: v3(8 * CELL + 4, 2, 8 * CELL + 4), color: '#2a2d36', material: 'stone' })

    // ---- the 64 checkered squares ----
    for (let r = 1; r <= 8; r++) {
      for (let f = 0; f < 8; f++) {
        const light = (f + r) % 2 === 0
        w.add({
          at: v3(-HALF + (f + 0.5) * CELL, -0.5, HALF - (r - 0.5) * CELL),
          size: v3(CELL - 0.08, 1, CELL - 0.08),
          color: light ? '#e9e2cf' : '#3a3f4b',
          material: 'stone',
        })
      }
    }

    // ---- gold reflective border frame around the board ----
    const span = 8 * CELL
    for (const [x, z, sx, sz] of [
      [0, HALF + 0.7, span + 2.4, 1.4],
      [0, -HALF - 0.7, span + 2.4, 1.4],
      [HALF + 0.7, 0, 1.4, span + 2.4],
      [-HALF - 0.7, 0, 1.4, span + 2.4],
    ] as const) {
      w.add({ at: v3(x, -0.2, z), size: v3(sx, 1.2, sz), color: '#bfa14e', material: 'metal', reflect: true })
    }

    // ---- four corner posts: gold neon beacons that light the hall ----
    for (const [cx, cz] of [[HALF, HALF], [-HALF, HALF], [HALF, -HALF], [-HALF, -HALF]] as const) {
      w.add({ at: v3(cx, 4.5, cz), size: v3(1.3, 9, 1.3), color: colors.gold, material: 'neon' })
      w.light(v3(cx, 9, cz), { color: '#ffd9a0', intensity: 130, range: 28 })
    }

    // ---- four centre columns: classic cover + the board's tall centre pieces ----
    for (const [f, r] of [[3, 4], [4, 4], [3, 5], [4, 5]] as const) {
      const p = sq(f, r)
      w.add({ at: v3(p.x, 3, p.z), size: v3(2.4, 6, 2.4), color: '#4a5060', material: 'stone' })
      w.add({ at: v3(p.x, 6.4, p.z), size: v3(2.7, 0.5, 2.7), color: colors.gold, material: 'neon', collide: false })
    }

    // ---- coordinate labels around the edge (files a–h, ranks 1–8) ----
    for (let f = 0; f < 8; f++) {
      w.label(FILES[f], v3(-HALF + (f + 0.5) * CELL, 0.7, HALF + 2.4), 0.6, '#d8c98a')
      w.label(FILES[f], v3(-HALF + (f + 0.5) * CELL, 0.7, -HALF - 2.4), 0.6, '#d8c98a')
    }
    for (let r = 1; r <= 8; r++) {
      w.label(String(r), v3(-HALF - 2.4, 0.7, HALF - (r - 0.5) * CELL), 0.6, '#d8c98a')
      w.label(String(r), v3(HALF + 2.4, 0.7, HALF - (r - 0.5) * CELL), 0.6, '#d8c98a')
    }

    // ---- the lava abyss far below (falling off the board = death) ----
    w.lava(v3(0, -7, 0), v3(96, 2, 96))
    w.add({ at: v3(0, -12, 0), size: v3(130, 2, 130), color: '#14161c', material: 'stone', collide: false })

    // ---- contested arsenal on the centre ring (push forward to gear up) ----
    w.weaponSpawn(sq(2, 4, 1.8), 'sniper')
    w.weaponSpawn(sq(5, 4, 1.8), 'rockets')
    w.weaponSpawn(sq(2, 5, 1.8), 'minigun')
    w.weaponSpawn(sq(5, 5, 1.8), 'flak')
    // White-side resupply (safe rear)
    w.ammoSpawn(sq(3, 1, 1.8))
    w.ammoSpawn(sq(4, 1, 1.8))
    w.healthPack(sq(0, 1, 1.8))
    w.healthPack(sq(7, 1, 1.8))
    // forward caches near the enemy line
    w.ammoSpawn(sq(3, 8, 1.8))
    w.ammoSpawn(sq(4, 8, 1.8))

    // ---- the title, floating over the far side ----
    w.label('♟️ BATTLE CHESS', v3(0, 12.5, -HALF - 7), 1.9, '#ffe7a8')
    w.label('Slay the ♚ King for checkmate', v3(0, 10, -HALF - 7), 0.85, '#ffd9ae')

    // ---- the White champion spawns on the king's file, rank 1 ----
    w.spawn(sq(4, 1, 2.2))
  },

  onStart(ctx) {
    kingId = null
    homeOf = new Map()
    roundOver = false
    kingAloneShown = false

    // White-side spawn pool for the player
    ctx.setSpawnPoints([sq(4, 1, 1.8), sq(3, 1, 1.8), sq(4, 2, 1.8)])
    ctx.player.teleport(sq(4, 1, 1.8))

    const spawnPiece = (roleKey: string, file: number, rank: number) => {
      const r = ROLE[roleKey]
      const home = sq(file, rank, 1.8)
      const e = ctx.spawnBot({
        name: `${r.sym} ${r.name}`,
        team: 'black',
        skill: r.skill,
        shirt: r.shirt,
        spawns: [home],
      })
      e.giveWeapon(r.weapon)
      if (r.hp > 100) e.heal(r.hp, r.hp) // tougher pieces overheal like armour
      homeOf.set(e.id, home)
      if (roleKey === 'king') kingId = e.id
    }

    // Black pawns on rank 7, back rank on rank 8 — standard opening formation
    for (let f = 0; f < 8; f++) spawnPiece('pawn', f, 7)
    BACK_RANK.forEach((role, f) => spawnPiece(role, f, 8))

    ctx.hud.set('army', `♟ 16 standing · Slay the ♚`)
    ctx.hud.toast('♟ Battle Chess! Advance and the pieces come alive. Slay the ♚ King!')
    ctx.systemChat('You spawn light: Sidearm + Pulse. Heavy guns wait on the centre ring — push forward.')
    ctx.systemChat('Pieces hold formation until you approach, then hunt you. Reach the back rank and take the ♚ King.')
  },

  onTick(ctx) {
    if (roundOver) return

    // pieces come alive within the aggro radius; otherwise they hold their square
    const pp = ctx.player.position
    let alive = 0
    for (const e of ctx.entities) {
      if (!e.isBot || !e.team || e.team !== 'black') continue
      if (e.alive) {
        alive++
        const home = homeOf.get(e.id)
        e.setObjective(home && distXZ(pp, home) < AGGRO ? pp : home ?? null)
      }
    }
    ctx.hud.set('army', `♟ ${alive} standing · Slay the ♚`)

    if (!kingAloneShown && alive === 1 && kingId) {
      kingAloneShown = true
      ctx.hud.big('♚ THE KING STANDS ALONE', 2400)
    }
  },

  onKill(ctx, info) {
    if (roundOver || info.victimIsSelf) return

    ctx.earnBlobcash(10, 'piece down')
    ctx.systemChat(`${info.killerIsSelf ? 'You' : info.killerName} downed ${info.victimName}!`)

    if (info.victimId === kingId) {
      roundOver = true
      ctx.celebrate('♚ CHECKMATE — THE KING FALLS!')
      ctx.earnBlobcash(150, 'checkmate')
      ctx.hud.big('♚ CHECKMATE!', 3200)
      ctx.systemChat(`♛ ${info.killerName} slew the King — checkmate!`)
      setTimeout(() => resetRound(ctx), 5500)
    }
  },
})

function resetRound(ctx: GameContext) {
  roundOver = false
  kingAloneShown = false
  for (const e of ctx.entities) e.respawn()
  ctx.hud.toast('The board resets — a new game begins!')
}
