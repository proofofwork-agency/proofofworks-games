// Phobos Reactor Run — an original Blobcade homage to classic 1990s maze
// shooters: fast first-person combat, keycards, secrets, toxic floors, weapon
// pickups, and a final exit room. No original Doom maps, names or assets.

import { defineGame, v3, behaviors, type GameContext, type PartHandle, type Vec3 } from '../sdk'

type DoorId = 'red' | 'blue' | 'yellow' | 'secret' | 'exit'
type KeyId = 'red' | 'blue' | 'yellow'

const FLOOR_Y = 0
const WALL_H = 4.2
const DOOR_H = 3.6

let doors: Partial<Record<DoorId, PartHandle>> = {}
let keys: Record<KeyId, boolean> = { red: false, blue: false, yellow: false }
let guardianDown = false
let guardianId: string | null = null
let kills = 0

function resetState() {
  doors = {}
  keys = { red: false, blue: false, yellow: false }
  guardianDown = false
  guardianId = null
  kills = 0
}

function openDoor(ctx: GameContext, id: DoorId, msg: string) {
  const d = doors[id]
  if (!d) return
  d.remove()
  delete doors[id]
  ctx.hud.toast(msg)
  ctx.systemChat(msg)
}

function keyHud(ctx: GameContext) {
  ctx.hud.set('keys', `Keys ${keys.red ? 'R' : '-'} ${keys.blue ? 'B' : '-'} ${keys.yellow ? 'Y' : '-'}`)
}

function pickupKey(ctx: GameContext, key: KeyId) {
  if (keys[key]) return
  keys[key] = true
  keyHud(ctx)
  const label = key === 'red' ? 'RED' : key === 'blue' ? 'BLUE' : 'YELLOW'
  ctx.hud.big(`${label} KEYCARD`, 1600)
  ctx.systemChat(`${label} keycard acquired.`)
}

export default defineGame({
  meta: {
    id: 'phobos-reactor-run',
    name: 'Phobos Reactor Run',
    blurb: 'A fast keycard maze shooter: clear the reactor base, find secrets, and escape through the infernal gate.',
    emoji: '🟥',
    gradient: 'linear-gradient(135deg, #3b4856 0%, #8f2f24 54%, #12070a 100%)',
    genre: 'Maze Shooter · Bots',
  },
  camera: 'fp',
  maxPlayers: 8,
  rtReflections: true,
  physics: { walkSpeed: 9.6, jumpVel: 12.5, fallDamage: false },
  weapons: [
    {
      id: 'repeater',
      name: 'Repeater',
      icon: 'R',
      kind: 'hitscan',
      damage: 18,
      fireRate: 6.2,
      spread: 0.025,
      range: 95,
      beamColor: '#ffb36b',
      beamWidth: 0.045,
      ammoMax: 120,
      ammoPickup: 36,
      botRange: [4, 58],
      sound: 'minigun',
    },
    {
      id: 'hellburst',
      name: 'Hellburst',
      icon: 'H',
      kind: 'projectile',
      damage: 34,
      fireRate: 2.2,
      projectile: { speed: 42, radius: 0.2, color: '#ff5a1f', splash: 2.2, life: 2.5 },
      ammoMax: 42,
      ammoPickup: 12,
      botRange: [5, 48],
      sound: 'rocket',
    },
  ],
  combat: {
    selfTeam: 'marine',
    health: 120,
    respawnSeconds: 4,
    weapons: ['sidearm', 'repeater', 'flak', 'pulse', 'rockets', 'hellburst', 'sniper'],
    startWeapons: ['sidearm'],
  },
  services: { chat: true, leaderboard: true },

  build(w) {
    resetState()
    w.lighting('night')
    w.spawn(v3(-34, 1.4, 20))
    w.killY(-8)

    const floor = (x: number, z: number, sx: number, sz: number, color = '#434a50', material: 'stone' | 'metal' = 'stone') =>
      w.add({ at: v3(x, FLOOR_Y, z), size: v3(sx, 0.6, sz), color, material })
    const wall = (x: number, z: number, sx: number, sz: number, color = '#666d75', material: 'stone' | 'metal' = 'stone') =>
      w.add({ at: v3(x, FLOOR_Y + WALL_H / 2, z), size: v3(sx, WALL_H, sz), color, material })
    const low = (x: number, z: number, sx: number, sz: number, color = '#3a4148') =>
      w.add({ at: v3(x, FLOOR_Y + 1, z), size: v3(sx, 2, sz), color, material: 'metal' })
    const neon = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) =>
      w.add({ at: v3(x, y, z), size: v3(sx, sy, sz), color, material: 'neon', collide: false })
    const label = (text: string, x: number, y: number, z: number, color = '#ffe1c2') =>
      w.label(text, v3(x, y, z), 0.68, color)
    const door = (id: DoorId, x: number, z: number, sx: number, sz: number, color: string) => {
      doors[id] = w.add({ at: v3(x, FLOOR_Y + DOOR_H / 2, z), size: v3(sx, DOOR_H, sz), color, material: 'metal' })
      neon(x, FLOOR_Y + DOOR_H + 0.25, z, Math.max(0.25, sx), 0.18, Math.max(0.25, sz), color)
    }
    const trigger = (x: number, z: number, sx: number, sz: number, fn: (ctx: GameContext) => void, color = '#ffffff') =>
      w.add({ at: v3(x, FLOOR_Y + 0.35, z), size: v3(sx, 0.7, sz), color, material: 'glass', collide: false, onTouch: fn })

    // Connected floor route: start bay -> red door -> central plant -> blue
    // door -> yellow wing -> reactor vault -> exit.
    floor(-38, 20, 28, 24, '#3f474e')
    floor(-50, 36, 16, 10, '#394249')
    floor(-50, 4, 16, 10, '#394249')
    floor(-18, 20, 14, 8, '#343b43', 'metal')
    floor(-4, 20, 14, 8, '#343b43', 'metal')
    floor(10, 18, 20, 18, '#3b4249')
    floor(10, 0, 22, 20, '#30383f')
    floor(-16, 0, 22, 18, '#3f474e')
    floor(-34, -16, 18, 18, '#30383f')
    floor(10, -20, 22, 18, '#3b4249')
    floor(34, -20, 20, 20, '#40363a')
    floor(34, 6, 16, 22, '#30383f')
    floor(6, -42, 34, 18, '#40363a')

    // Perimeter and maze chunks. Internal walls deliberately leave gaps so the
    // level is non-linear without becoming a dead-end grid.
    wall(-32.5, 32, 18, 1.1); wall(-32.5, 8, 18, 1.1); wall(-52.5, 20, 1.1, 24)
    wall(-50, 41, 17, 1.1); wall(-58.5, 36, 1.1, 10)
    wall(-50, -1, 17, 1.1); wall(-58.5, 4, 1.1, 10)
    wall(-18, 24.5, 15, 1.1); wall(-18, 15.5, 15, 1.1)
    wall(-4, 24.5, 15, 1.1); wall(-4, 15.5, 15, 1.1)
    wall(10, 27, 21, 1.1); wall(20.5, 18, 1.1, 18)
    wall(21, 0, 1.1, 20); wall(-5, 9.5, 32, 1.1); wall(-5, -9.5, 32, 1.1)
    wall(-27, 0, 1.1, 18); wall(-16, 9, 23, 1.1)
    wall(-34, -7, 19, 1.1); wall(-43.5, -16, 1.1, 18); wall(-24.5, -16, 1.1, 18); wall(-34, -25, 19, 1.1)
    wall(10, -11, 23, 1.1); wall(10, -29, 23, 1.1)
    wall(24, -10, 1.1, 20); wall(44, -20, 1.1, 20); wall(34, -30, 20, 1.1)
    wall(26, 6, 1.1, 22); wall(42, 6, 1.1, 22); wall(34, 17, 16, 1.1)
    wall(6, -33, 35, 1.1); wall(6, -51, 35, 1.1); wall(-11.5, -42, 1.1, 18); wall(23.5, -42, 1.1, 18)

    // Gates and nearby touch panels.
    door('red', -10, 20, 1.2, 5.2, '#ff3b35')
    trigger(-12.2, 20, 1.5, 5.4, (ctx) => keys.red ? openDoor(ctx, 'red', 'Red security door opened.') : ctx.hud.toast('Need the red keycard.'), '#ff3b35')
    door('blue', 21, 6, 1.2, 5.4, '#3d8bff')
    trigger(18.8, 6, 1.5, 5.4, (ctx) => keys.blue ? openDoor(ctx, 'blue', 'Blue access door opened.') : ctx.hud.toast('Need the blue keycard.'), '#3d8bff')
    door('yellow', 24, -20, 1.2, 5.4, '#ffd166')
    trigger(21.8, -20, 1.5, 5.4, (ctx) => keys.yellow ? openDoor(ctx, 'yellow', 'Yellow reactor door opened.') : ctx.hud.toast('Need the yellow keycard.'), '#ffd166')
    door('secret', -16, -9.5, 5.2, 1.2, '#8b5cf6')
    trigger(-22, 1.5, 1.2, 1.2, (ctx) => openDoor(ctx, 'secret', 'A hidden arsenal wall slides open.'), '#8b5cf6')
    door('exit', 18, -42, 1.2, 5.8, '#ff5a1f')
    trigger(15.8, -42, 1.4, 5.8, (ctx) => {
      if (!guardianDown) ctx.hud.toast('The reactor guardian is still alive.')
      else openDoor(ctx, 'exit', 'The infernal exit is clear.')
    }, '#ff5a1f')

    // Toxic channels and hazards.
    w.lava(v3(4, 0.2, 0), v3(5, 0.5, 14))
    w.lava(v3(9, 0.2, -20), v3(5, 0.5, 8))
    w.spinnerHazard(v3(34, 1.7, -20), 5.2, 4, 2.9)
    neon(4, 2.8, 0, 0.2, 0.2, 14, '#39ff88')
    neon(9, 2.8, -20, 0.2, 0.2, 8, '#39ff88')

    // Keycards: red is available in the start wing; blue and yellow are behind
    // earlier locks, matching the classic keycard progression.
    w.add({
      at: v3(-50, 1.4, 36), size: v3(1.1, 0.35, 1.6), color: '#ff3b35', material: 'neon', collide: false,
      behavior: [behaviors.spin(1.9), behaviors.bob(0.18, 2.4, 1)],
      touchOnce: true,
      onTouch: (ctx) => pickupKey(ctx, 'red'),
    })
    w.add({
      at: v3(-38, 1.4, -18), size: v3(1.1, 0.35, 1.6), color: '#3d8bff', material: 'neon', collide: false,
      behavior: [behaviors.spin(1.9), behaviors.bob(0.18, 2.4, 2)],
      touchOnce: true,
      onTouch: (ctx) => pickupKey(ctx, 'blue'),
    })
    w.add({
      at: v3(38, 1.4, 10), size: v3(1.1, 0.35, 1.6), color: '#ffd166', material: 'neon', collide: false,
      behavior: [behaviors.spin(1.9), behaviors.bob(0.18, 2.4, 3)],
      touchOnce: true,
      onTouch: (ctx) => pickupKey(ctx, 'yellow'),
    })

    // Pickups and weapons: pistol start, find the firepower.
    w.weaponSpawn(v3(-44, 1.4, 4), 'repeater')
    w.weaponSpawn(v3(-18, 1.4, 20), 'repeater')
    w.weaponSpawn(v3(10, 1.4, 18), 'flak')
    w.weaponSpawn(v3(-34, 1.4, -12), 'pulse')
    w.weaponSpawn(v3(-16, 1.4, -12), 'rockets')
    w.weaponSpawn(v3(34, 1.4, -20), 'hellburst')
    w.weaponSpawn(v3(6, 1.4, -46), 'sniper')
    for (const [x, z] of [[-50, 4], [-30, 20], [-4, 20], [10, 18], [-16, 0], [10, -24], [34, 4], [6, -38]] as const) {
      w.ammoSpawn(v3(x, 1.4, z))
    }
    for (const [x, z] of [[-50, 36], [-46, 8], [10, 2], [-38, -14], [14, -26], [38, 10], [12, -44]] as const) {
      w.healthPack(v3(x, 1.4, z))
    }

    // Cover, pillars, lights and signage.
    for (const [x, z] of [[-42, 24], [-46, 15], [-50, 36], [-50, 4], [-30, 16], [-4, 18], [10, 18], [0, -4], [-16, 2], [-34, -16], [10, -20], [34, -20], [34, 6], [6, -42]] as const) {
      low(x, z, 2.2, 2.2)
      w.light(v3(x, 3.4, z), { color: '#ffb36b', intensity: 70, range: 16 })
    }
    // Tall starter-room dividers: enough to hide behind, low enough to keep the
    // room readable from first person.
    low(-38, 24, 1.4, 6, '#4b555f')
    low(-43, 11, 6, 1.4, '#4b555f')
    low(-47, 29, 6, 1.4, '#4b555f')
    low(-54, 35, 1.4, 5, '#4b555f')
    low(-54, 5, 1.4, 5, '#4b555f')

    label('PHOBOS REACTOR', -38, 5.5, 11.2)
    label('RED KEY', -50, 3.8, 36, '#ffb0a8')
    label('BLUE KEY', -38, 3.8, -18, '#a8c8ff')
    label('YELLOW KEY', 38, 3.8, 10, '#ffe9a8')
    label('SECRET ARMORY', -18, 3.8, -12, '#d8c7ff')
    label('EXIT', 6, 4.6, -48, '#ffd2b8')
    w.light(v3(6, 5, -42), { color: '#ff5a1f', intensity: 180, range: 28 })

    // Exit pad stays inert until the guardian is dead and its seal is opened.
    w.add({
      at: v3(6, 0.6, -46), size: v3(5, 0.8, 5), color: '#ffc94d', material: 'gold',
      onTouch: (ctx) => {
        if (!guardianDown || doors.exit) {
          ctx.hud.toast('The exit is sealed.')
          return
        }
        ctx.celebrate('REACTOR ESCAPED!')
        ctx.earnBlobcash(120, 'victory')
      },
    })
  },

  onStart(ctx) {
    keyHud(ctx)
    ctx.hud.set('objective', 'Find red keycard')
    ctx.hud.set('kills', 'Kills 0')
    ctx.setSpawnPoints([v3(-46, 1.4, 20)])
    ctx.player.teleport(v3(-46, 1.4, 20))
    ctx.systemChat('Fast maze shooter: strafe, grab ammo, find keycards, and look for secret switches.')
    ctx.systemChat('Original Blobcade level inspired by classic 1990s FPS loops: keys, hordes, hazards, exit.')

    const bots = [
      ['Cinder Grunt', -22, 1.4, 20, 0.25, '#a33a32'],
      ['Ash Fiend', 4, 1.4, 18, 0.34, '#b45b42'],
      ['Chain Warden', 12, 1.4, 4, 0.48, '#c97c50'],
      ['Toxic Prowler', -18, 1.4, -2, 0.5, '#56b36a'],
      ['Blue Vault Guard', -36, 1.4, -18, 0.55, '#5b8cff'],
      ['Reactor Cultist', 10, 1.4, -20, 0.6, '#cf6b43'],
      ['Yellow Wing Brute', 34, 1.4, 8, 0.68, '#e0ad50'],
      ['Exit Sentinel', 2, 1.4, -42, 0.72, '#d95c3a'],
    ] as const
    for (const [name, x, y, z, skill, shirt] of bots) {
      ctx.spawnBot({ name, team: 'enemy', skill, spawns: [v3(x, y, z)], shirt })
    }
    const guardian = ctx.spawnBot({ name: 'Reactor Guardian', team: 'enemy', skill: 0.9, spawns: [v3(10, 1.4, -42)], shirt: '#ff5a1f' })
    guardianId = guardian.id
  },

  onTick(ctx) {
    if (!keys.red) ctx.hud.set('objective', 'Find red keycard')
    else if (keys.red && !keys.blue) ctx.hud.set('objective', 'Open red door, find blue key')
    else if (keys.blue && !keys.yellow) ctx.hud.set('objective', 'Open blue door, find yellow key')
    else if (keys.yellow && !guardianDown) ctx.hud.set('objective', 'Open yellow door, defeat guardian')
    else ctx.hud.set('objective', 'Open the exit seal and escape')

    for (const e of ctx.entities) {
      if (!e.isBot || !e.alive) continue
      if (e.name === 'Reactor Guardian') e.setObjective(ctx.player.position)
      else if (keys.yellow) e.setObjective(v3(6, 1.4, -42))
      else if (keys.blue) e.setObjective(v3(34, 1.4, 6))
      else if (keys.red) e.setObjective(v3(-34, 1.4, -16))
      else if (e.name === 'Cinder Grunt') e.setObjective(v3(-18, 1.4, 20))
      else if (e.name === 'Ash Fiend') e.setObjective(v3(4, 1.4, 18))
      else e.setObjective(v3(-34, 1.4, -16))
    }
  },

  onKill(ctx, info) {
    if (!info.victimIsSelf) {
      kills++
      ctx.hud.set('kills', `Kills ${kills}`)
    }
    if (info.victimId === guardianId) {
      guardianDown = true
      ctx.hud.big('REACTOR GUARDIAN DOWN', 2200)
      ctx.systemChat('The exit seal is weakening. Step on the orange panel by the vault.')
      ctx.earnBlobcash(50, 'guardian kill')
    }
  },
})
