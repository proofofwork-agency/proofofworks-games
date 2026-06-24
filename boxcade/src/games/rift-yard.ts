// Rift Yard — Blobcade's arena-deathmatch tribute to the classic space-map
// FPS archetype: floating metal pads in the void, jump pads flinging you
// between levels, low-gravity bunny-hopping, contested power weapons and a
// free-for-all frag race against bots. All geometry, names, weapons and audio
// here are Blobcade originals — see README "Licensing & inspirations".
//
// Design notes (genre, not expression): the gameplay verbs — bounce-pad
// routing between disconnected pads, a high isolated "rail" platform, a
// centrally contested rocket, fast-respawn FFA with a frag limit — are the
// arena-shooter grammar. Every art asset (geometry, colors, names, currency)
// is our own.

import { defineGame, v3, DEFAULT_LOADOUT, type Vec3, type GameContext, type KillInfoApi } from '../sdk'
import { audio } from '../engine/audio'

// -------------------------------------------------------------- match tuning --
const FRAG_LIMIT = 25
const RESPAWN_SECONDS = 2.4 // fast arena respawns
const GRAVITY = 26          // floaty low-grav movement (engine expects negative)
const JUMP_VEL = 13.5
const WALK_SPEED = 10

// Bots: each gets a UNIQUE team so the combat system treats every entity as a
// valid enemy of every other (free-for-all). selfTeam 'player' is likewise
// unique — nobody is friendly.
const BOTS = [
  { name: 'Hunter-X', skill: 0.62 },
  { name: 'Krex', skill: 0.55 },
  { name: 'Visor', skill: 0.66 },
  { name: 'Nyx-7', skill: 0.5 },
  { name: 'Sorg', skill: 0.58 },
]

// Palette — dark steel decks with cyan/orange neon, the space-arena look
const DECK = '#39414f'
const DECK_DARK = '#262c38'
const EDGE_CYAN = '#59f7d2'
const EDGE_ORANGE = '#ff8c42'
const SPAWN_GLOW = '#ffe9c9'

// ---------------------------------------------------------------- match state --
let frags = new Map<string, number>()
let names = new Map<string, string>()
let selfId = ''
let matchOver = false
let resetTimer = 0

export default defineGame({
  meta: {
    id: 'rift-yard',
    name: 'Rift Yard',
    blurb: 'Floating metal pads in the void. Bounce between levels, grab the rail, win the frag race. FFA arena deathmatch with bots.',
    emoji: '☄️',
    gradient: 'linear-gradient(135deg, #11131c 0%, #2a3f6e 55%, #06080f 100%)',
    genre: 'Arena Deathmatch · Bots',
  },
  maxPlayers: 16,
  camera: 'fp',
  rtReflections: true, // the metal decks mirror neon, rockets and the void glow
  physics: { gravity: -GRAVITY, jumpVel: JUMP_VEL, walkSpeed: WALK_SPEED, fallDamage: false },

  combat: {
    selfTeam: 'player',
    health: 100,
    respawnSeconds: RESPAWN_SECONDS,
    weapons: [...DEFAULT_LOADOUT],
    // spawn light — the heavy guns are contested on the pads (classic arena)
    startWeapons: ['sidearm', 'shock'],
  },

  // ------------------------------------------------------------------- map --
  build(w) {
    // void: space all the way down
    w.lighting('space')
    w.killY(-30)

    w.label('☄ RIFT YARD', v3(0, 22, 0), 1.7, '#9fe8ff')
    w.label('FFA · first to ' + FRAG_LIMIT + ' frags', v3(0, 19.5, 0), 0.7, '#7fd4ff')

    // ---- central hub pad: the contested rocket spawn ----
    pad(w, v3(0, 0, 0), 18, 18, DECK, EDGE_CYAN)
    // glowing reactor core under the rocket pad
    w.add({ at: v3(0, 0.9, 0), size: v3(6, 0.4, 6), color: EDGE_ORANGE, material: 'neon', collide: false })
    w.weaponSpawn(v3(0, 1.8, 0), 'rockets') // the power weapon — everyone contests center
    w.light(v3(0, 4, 0), { color: '#ffb066', intensity: 90, range: 22 })

    // ---- four mid pads at the compass points, slightly raised ----
    // NE / NW / SE / SW — each carries a different arena gun
    const mids: Array<[number, number, string, string, string]> = [
      [22, -22, EDGE_CYAN, 'pulse', 'A'],   // plasma (NE)
      [-22, -22, EDGE_ORANGE, 'minigun', 'B'], // machine gun (NW)
      [22, 22, EDGE_ORANGE, 'flak', 'C'],   // shotgun (SE)
      [-22, 22, EDGE_CYAN, 'shock', 'D'],   // shaft (SW)
    ]
    for (const [mx, mz, edge, gun] of mids) {
      pad(w, v3(mx, 3.5, mz), 10, 10, DECK, edge)
      w.weaponSpawn(v3(mx, 5.2, mz), gun)
      w.ammoSpawn(v3(mx + 3, 5.2, mz))
    }

    // ---- high rail platform: isolated, reachable only by bounce pad ----
    // the classic "rail tower" — high ground for the hitscan one-shot
    pad(w, v3(0, 15, 0), 8, 8, DECK_DARK, EDGE_ORANGE)
    w.weaponSpawn(v3(0, 16.6, 0), 'sniper') // the railgun analog
    w.healthPack(v3(2.4, 16.6, 2.4))         // mega-health style reward for climbing
    w.ammoSpawn(v3(-2.4, 16.6, -2.4))
    w.light(v3(0, 18.5, 0), { color: '#ffd27d', intensity: 70, range: 16 })
    // a thin light beam so the rail tower reads from anywhere on the map
    w.add({ at: v3(0, 8, 0), size: v3(0.5, 16, 0.5), color: '#ffae5e', material: 'neon', collide: false })

    // ---- low dive pads: verticality beneath the hub ----
    pad(w, v3(26, -4, 0), 8, 8, DECK_DARK, EDGE_CYAN)
    pad(w, v3(-26, -4, 0), 8, 8, DECK_DARK, EDGE_CYAN)
    w.healthPack(v3(26, -2.4, 0))
    w.healthPack(v3(-26, -2.4, 0))

    // ---- jump pads (the signature routing verb) ----
    // hub edges -> each mid pad
    jumpTo(w, v3(8, 0.8, 0), v3(22, 4.5, -22))   // -> NE
    jumpTo(w, v3(-8, 0.8, 0), v3(-22, 4.5, -22)) // -> NW
    jumpTo(w, v3(8, 0.8, 6), v3(22, 4.5, 22))    // -> SE
    jumpTo(w, v3(-8, 0.8, 6), v3(-22, 4.5, 22))  // -> SW
    // mids -> high rail tower (the committed climb)
    jumpTo(w, v3(22, 4.3, -22), v3(0, 15.6, 0), 46)
    jumpTo(w, v3(-22, 4.3, 22), v3(0, 15.6, 0), 46)
    // low dive pads -> hub (return route)
    jumpTo(w, v3(26, -3.2, 0), v3(0, 1.2, 0))
    jumpTo(w, v3(-26, -3.2, 0), v3(0, 1.2, 0))

    // ---- decorative floating asteroids for depth ----
    const rocks: Array<[number, number, number, number]> = [
      [-40, 8, -30, 2.4], [38, -2, 28, 1.8], [-34, 18, 36, 1.4],
      [44, 12, -18, 2.8], [-46, -6, 6, 2.0], [30, 24, 14, 1.2],
      [8, -14, -40, 1.6], [-20, -12, 44, 2.2],
    ]
    for (const [x, y, z, s] of rocks) {
      w.add({ at: v3(x, y, z), size: v3(3 * s, 2.2 * s, 2.6 * s), color: '#4a4f5b', material: 'stone', collide: false, rotY: x * 0.7 })
    }
  },

  // ---------------------------------------------------------------- onStart --
  onStart(ctx) {
    frags = new Map()
    names = new Map()
    matchOver = false
    resetTimer = 0

    // FFA spawn spread across every pad
    const spawns: Vec3[] = [
      v3(0, 2.6, 6), v3(6, 2.6, 0), v3(-6, 2.6, 0), v3(0, 2.6, -6),         // hub
      v3(22, 5.2, -22), v3(-22, 5.2, -22), v3(22, 5.2, 22), v3(-22, 5.2, 22), // mids
      v3(26, -2.4, 0), v3(-26, -2.4, 0),                                     // low
    ]
    ctx.setSpawnPoints(spawns)
    ctx.player.teleport(spawns[0])

    // spawn the local player entry + all bots, each on a unique team (FFA)
    for (let i = 0; i < BOTS.length; i++) {
      const b = BOTS[i]
      ctx.spawnBot({ name: b.name, team: 'bot-' + i, skill: b.skill, spawns })
    }

    // register everyone in the score tables
    for (const e of ctx.entities) {
      names.set(e.id, e.isSelf ? 'You' : e.name)
      frags.set(e.id, 0)
      if (e.isSelf) selfId = e.id
    }

    renderHud(ctx)
    ctx.hud.toast(`First to ${FRAG_LIMIT} frags wins. Grab the ☄ rockets at center, the 🎯 rail up top.`)
    ctx.systemChat('Free-for-all. You spawn with Sidearm + Shock — the heavy guns sit on glowing pads.')
    ctx.systemChat('Bounce pads fling you between platforms. Low gravity: hold Space to bunny-hop.')
  },

  onRespawn(ctx) {
    renderHud(ctx)
  },

  // ------------------------------------------------------------------ onKill --
  onKill(ctx, info) {
    if (info.killerId) {
      frags.set(info.killerId, (frags.get(info.killerId) ?? 0) + 1)
      if (info.killerIsSelf) {
        audio.killConfirm()
        ctx.earnBlobcash(info.headshot ? 15 : 10, info.headshot ? 'headshot frag' : 'frag')
      }
    }
    // ensure victim/killer are tracked (late spawns)
    for (const e of ctx.entities) {
      if (!names.has(e.id)) names.set(e.id, e.isSelf ? 'You' : e.name)
      if (!frags.has(e.id)) frags.set(e.id, 0)
      if (e.isSelf) selfId = e.id
    }

    const victim = names.get(info.victimId) ?? 'someone'
    const killer = info.killerName ? (info.killerIsSelf ? 'You' : info.killerName) : 'the void'
    ctx.systemChat(`${killer} fragged ${victim}${info.headshot ? ' 🎯 headshot' : ''}`)

    renderHud(ctx)

    if (!matchOver) {
      const top = Math.max(...frags.values(), 0)
      if (top >= FRAG_LIMIT) {
        matchOver = true
        resetTimer = 5
        const winnerId = [...frags.entries()].find(([, f]) => f >= FRAG_LIMIT)?.[0]
        const youWon = winnerId === selfId
        ctx.celebrate(youWon ? '🏆 YOU WIN THE YARD!' : `${names.get(winnerId ?? '') ?? 'A bot'} WINS`)
        if (youWon) ctx.earnBlobcash(150, 'match win')
      }
    }
  },

  // ------------------------------------------------------------------ onTick --
  onTick(ctx, dt) {
    // refresh the board (handles late joiners / name resolution)
    renderHud(ctx)

    if (matchOver) {
      resetTimer -= dt
      if (resetTimer <= 0) resetMatch(ctx)
    }
  },
})

// ----------------------------------------------------------------- helpers --

/** A metal deck pad with a glowing neon edge strip. */
function pad(w: import('../sdk').WorldBuilder, center: Vec3, sx: number, sz: number, color: string, edge: string) {
  w.add({ at: v3(center.x, center.y, center.z), size: v3(sx, 1.4, sz), color, material: 'metal', reflect: true })
  // neon border ring (thin raised frame)
  const t = 0.35
  const ex = sx / 2, ez = sz / 2, y = center.y + 0.85
  w.add({ at: v3(center.x, y, center.z + ez), size: v3(sx, t, t), color: edge, material: 'neon', collide: false })
  w.add({ at: v3(center.x, y, center.z - ez), size: v3(sx, t, t), color: edge, material: 'neon', collide: false })
  w.add({ at: v3(center.x + ex, y, center.z), size: v3(t, t, sz), color: edge, material: 'neon', collide: false })
  w.add({ at: v3(center.x - ex, y, center.z), size: v3(t, t, sz), color: edge, material: 'neon', collide: false })
}

/**
 * A bounce pad tuned to launch a player from `from` toward `to`.
 * `power` defaults to a value that comfortably clears the typical gap; raise
 * it for the committed climb to the rail tower.
 */
function jumpTo(w: import('../sdk').WorldBuilder, from: Vec3, to: Vec3, power = 34) {
  w.bouncePad(v3(from.x, from.y, from.z), power, v3(2.2, 0.4, 2.2))
  // a small neon chevron on the pad, rotated to face the destination
  const dx = to.x - from.x, dz = to.z - from.z
  const ang = Math.atan2(dx, dz)
  w.add({
    at: v3(from.x, from.y + 0.3, from.z), size: v3(0.6, 0.1, 1.2),
    color: EDGE_ORANGE, material: 'neon', collide: false, rotY: ang,
  })
}

/** Rebuild the frag-race HUD: your frags + a compact leaderboard. */
function renderHud(ctx: GameContext) {
  const my = frags.get(selfId) ?? 0
  ctx.hud.set('frags', `💀 ${my} / ${FRAG_LIMIT}`)

  const rows = ctx.entities
    .map((e) => ({ n: e.isSelf ? 'You' : (names.get(e.id) ?? e.name), f: frags.get(e.id) ?? 0, self: e.isSelf }))
    .sort((a, b) => b.f - a.f)
    .slice(0, 5)
  ctx.hud.set('board', rows.map((r, i) => `${i + 1}. ${r.n} ${r.f}`).join('  '))
}

function resetMatch(ctx: GameContext) {
  matchOver = false
  resetTimer = 0
  for (const e of ctx.entities) {
    frags.set(e.id, 0)
    e.respawn()
  }
  renderHud(ctx)
  ctx.hud.toast('New match!')
}
