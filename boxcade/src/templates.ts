// Starter templates for the Studio's "New from template" picker. Each entry
// hand-builds a complete, valid GameDoc via make() — a FRESH deep object every
// call (no shared references), so editing one new draft never mutates another
// or the template itself. make() returns a doc that passes validateGameDoc()
// (schema: src/sdk/gamedoc.ts, spec: docs/GAMEDOC.md). The portal's "New in
// Studio" chooser saves the result as a draft and opens the Studio on it.
//
// Name-string discipline (per the GameDoc versioning contract): materials,
// weapons and sky presets are referenced by registry name —
//   materials  : plastic grass wood stone ice neon lava gold glass metal sand
//   weapons    : sidearm shock pulse minigun flak rockets sniper
//   sky presets: noon morning goldenHour night space
// Only kind:'part' objects are registered for rules, so anything a rule must
// open/move/remove (e.g. a gate) is authored as a kind:'part' with an id.

import type { GameDoc } from './sdk'

export interface Template {
  id: string
  name: string
  emoji: string
  blurb: string
  make(): GameDoc
}

// ---------------------------------------------------------------- obby ----
// Classic floating-island obby: platforms ascending across gaps, two
// checkpoints, lava patches, a bounce pad, a spinner, coins, labels, and a
// win pad high up.
function makeObby(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: {
      name: 'Classic Obby',
      emoji: '🟦',
      genre: 'Obby',
      blurb: 'Hop the floating islands, dodge the lava, reach the win pad.',
      gradient: 'linear-gradient(135deg, #4cc9f0, #6a5cff)',
    },
    camera: 'orbit',
    lighting: 'goldenHour',
    killY: -18,
    spawn: [0, 4, 14],
    parts: [
      // start island
      { kind: 'part', at: [0, 0, 14], size: [8, 1, 8], material: 'grass' },
      { kind: 'label', at: [0, 3, 14], text: 'CLASSIC OBBY — reach the gold!', scale: 1.1, color: '#ffd166' },
      { kind: 'label', at: [0, 2.2, 14], text: 'Mind the gaps.', scale: 0.8, color: '#dfe9ff' },

      // ascending platforms with gaps between them
      { kind: 'part', at: [0, 1.5, 6], size: [4, 1, 4], material: 'stone' },
      { kind: 'lava', at: [0, 0.5, 0], size: [6, 1, 4] },
      { kind: 'part', at: [0, 3, -2], size: [4, 1, 4], material: 'stone' },

      // first checkpoint
      { kind: 'part', at: [-6, 4.5, -8], size: [5, 1, 5], material: 'wood' },
      { kind: 'checkpoint', at: [-6, 5.2, -8], index: 1 },
      { kind: 'label', at: [-6, 7, -8], text: 'Checkpoint 1', scale: 0.8, color: '#06d6a0' },
      { kind: 'coin', at: [-6, 6, -8] },

      // bounce pad lobs you up to the high ledge
      { kind: 'bouncePad', at: [-6, 5, -14], power: 22, size: [3, 1, 3] },
      { kind: 'part', at: [-2, 9, -18], size: [4, 1, 4], material: 'stone' },
      { kind: 'coin', at: [-2, 10.5, -18] },

      // spinner gauntlet
      { kind: 'part', at: [4, 10.5, -22], size: [6, 1, 4], material: 'stone' },
      { kind: 'spinnerHazard', at: [4, 12, -22], radius: 3, count: 3, period: 2.4 },

      // second checkpoint
      { kind: 'part', at: [4, 12, -28], size: [5, 1, 5], material: 'wood' },
      { kind: 'checkpoint', at: [4, 12.7, -28], index: 2 },
      { kind: 'label', at: [4, 14.5, -28], text: 'Checkpoint 2', scale: 0.8, color: '#06d6a0' },
      { kind: 'lava', at: [4, 11.5, -33], size: [6, 1, 3] },

      // final climb + win pad
      { kind: 'part', at: [0, 14, -36], size: [3, 1, 3], material: 'stone' },
      { kind: 'part', at: [-3, 16, -40], size: [3, 1, 3], material: 'stone' },
      { kind: 'coin', at: [-3, 17.5, -40] },
      { kind: 'part', at: [0, 18, -44], size: [6, 1, 6], material: 'gold' },
      { kind: 'winPad', at: [0, 19, -44], size: [3, 0.4, 3] },
      { kind: 'label', at: [0, 21, -44], text: 'FINISH!', scale: 1.3, color: '#ffc94d' },
    ],
    rules: [
      {
        when: { type: 'start' },
        do: [{ type: 'toast', text: 'Reach the gold win pad — checkpoints save you!' }],
        once: true,
      },
    ],
  }
}

// --------------------------------------------------------------- arena ----
// Walled combat arena: floor, four perimeter walls, weapon/ammo/health pads,
// and a center spawn. Combat enables weapons, health and bots.
function makeArena(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: {
      name: 'Bot Arena',
      emoji: '🤖',
      genre: 'Arena',
      blurb: 'Walled deathmatch pit — grab a gun and frag the bots.',
      gradient: 'linear-gradient(135deg, #e74c3c, #2c3e50)',
    },
    camera: 'fp',
    lighting: 'night',
    killY: -20,
    spawn: [0, 3, 0],
    combat: {
      weapons: ['sidearm', 'rockets', 'sniper'],
      health: 100,
    },
    parts: [
      // arena floor
      { kind: 'part', at: [0, 0, 0], size: [60, 1, 60], material: 'metal' },
      // perimeter walls (kind:'part', tall, collidable)
      { kind: 'part', at: [0, 5, 30], size: [60, 10, 2], material: 'stone' },
      { kind: 'part', at: [0, 5, -30], size: [60, 10, 2], material: 'stone' },
      { kind: 'part', at: [30, 5, 0], size: [2, 10, 60], material: 'stone' },
      { kind: 'part', at: [-30, 5, 0], size: [2, 10, 60], material: 'stone' },

      // cover blocks
      { kind: 'part', at: [10, 1.5, 10], size: [4, 3, 4], material: 'stone' },
      { kind: 'part', at: [-10, 1.5, -10], size: [4, 3, 4], material: 'stone' },
      { kind: 'part', at: [-12, 1.5, 12], size: [4, 3, 4], material: 'stone' },
      { kind: 'part', at: [12, 1.5, -12], size: [4, 3, 4], material: 'stone' },

      // weapon spawn pads
      { kind: 'weaponSpawn', at: [20, 1.5, 20], weapon: 'rockets' },
      { kind: 'weaponSpawn', at: [-20, 1.5, -20], weapon: 'sniper' },
      { kind: 'weaponSpawn', at: [20, 1.5, -20], weapon: 'sidearm' },

      // supplies
      { kind: 'healthPack', at: [0, 1.5, 18] },
      { kind: 'healthPack', at: [0, 1.5, -18] },
      { kind: 'ammoSpawn', at: [18, 1.5, 0] },
      { kind: 'ammoSpawn', at: [-18, 1.5, 0] },

      // center marker
      { kind: 'label', at: [0, 6, 0], text: 'BOT ARENA', scale: 1.3, color: '#ff6b6b' },
      { kind: 'light', at: [0, 14, 0], color: '#ffd9a0', intensity: 2, range: 60 },
    ],
    rules: [
      {
        when: { type: 'start' },
        do: [{ type: 'big', text: '⚔️ FIGHT!' }],
        once: true,
      },
    ],
  }
}

// ------------------------------------------------------------- sandbox ----
// Voxel build sandbox: a procedural island, first-person build camera, a
// welcome label and a start toast. No goal — just build.
function makeSandbox(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: {
      name: 'Voxel Sandbox',
      emoji: '🧰',
      genre: 'Sandbox',
      blurb: 'A blank voxel island in build mode — make whatever you like.',
      gradient: 'linear-gradient(135deg, #06d6a0, #2f81f7)',
    },
    camera: 'fp',
    lighting: 'noon',
    voxel: { seed: 7, size: 96 },
    parts: [
      { kind: 'label', at: [0, 8, 0], text: 'VOXEL SANDBOX — build mode', scale: 1.2, color: '#ffffff' },
      { kind: 'label', at: [0, 7, 0], text: 'Left-click place · right-click dig', scale: 0.8, color: '#dfe9ff' },
    ],
    rules: [
      {
        when: { type: 'start' },
        do: [{ type: 'toast', text: '🧰 Build mode — place and dig blocks to make your world.' }],
        once: true,
      },
    ],
  }
}

// --------------------------------------------------------------- tower ----
// Parkour tower: platforms spiral upward around a center column, checkpoints
// every ~4 steps, a button+door gate midway (touch the button → the gate
// slides open), and a win pad on top. killY tuned to the tower base.
function makeTower(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: {
      name: 'Parkour Tower',
      emoji: '🗼',
      genre: 'Parkour',
      blurb: 'Spiral up the tower, open the gate, plant the flag on top.',
      gradient: 'linear-gradient(135deg, #9b59b6, #2c3e50)',
    },
    camera: 'orbit',
    lighting: 'morning',
    killY: -12,
    spawn: [6, 3, 0],
    parts: [
      // central column for visual reference
      { kind: 'part', at: [0, 14, 0], size: [3, 30, 3], material: 'stone', color: '#566573' },
      { kind: 'label', at: [0, 1.5, 6], text: 'PARKOUR TOWER — climb to the top!', scale: 0.9, color: '#e6d6ff' },

      // 14 platforms spiraling upward (radius ~6, ~51deg apart, +3.2 m/step)
      { kind: 'part', at: [6, 1, 0], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'checkpoint', at: [6, 1.7, 0], index: 1 },
      { kind: 'part', at: [3.8, 4.2, 4.6], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'part', at: [-1.6, 7.4, 5.8], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'coin', at: [-1.6, 8.7, 5.8] },
      { kind: 'part', at: [-5.6, 10.6, 2.4], size: [3.5, 1, 3.5], material: 'wood' },

      // checkpoint #2 (step 5)
      { kind: 'part', at: [-5.6, 13.8, -2.4], size: [3.8, 1, 3.8], material: 'stone' },
      { kind: 'checkpoint', at: [-5.6, 14.5, -2.4], index: 2 },
      { kind: 'label', at: [-5.6, 16.2, -2.4], text: 'Checkpoint 2', scale: 0.75, color: '#06d6a0' },

      // midway gate: a button (touch) and a kind:'part' gate the rule opens
      { kind: 'part', at: [-1.6, 17, -5.8], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'button', id: 'gateBtn', at: [-1.6, 17.8, -5.8], size: [1.4, 0.6, 1.4], color: '#ffd166' },
      { kind: 'label', at: [-1.6, 19.4, -5.8], text: 'Step on the button to open the gate ↑', scale: 0.7, color: '#ffe9a8' },
      { kind: 'part', id: 'gate', at: [3.8, 21.5, -4.6], size: [3.6, 3, 0.6], color: '#8a5cff', material: 'neon' },
      { kind: 'part', at: [3.8, 20.2, -4.6], size: [3.5, 1, 3.5], material: 'stone' },

      { kind: 'part', at: [6, 23.4, 0], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'coin', at: [6, 24.7, 0] },

      // checkpoint #3 (step 9)
      { kind: 'part', at: [3.8, 26.6, 4.6], size: [3.8, 1, 3.8], material: 'stone' },
      { kind: 'checkpoint', at: [3.8, 27.3, 4.6], index: 3 },

      { kind: 'part', at: [-1.6, 29.8, 5.8], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'part', at: [-5.6, 33, 2.4], size: [3.5, 1, 3.5], material: 'wood' },
      { kind: 'coin', at: [-5.6, 34.3, 2.4] },
      { kind: 'part', at: [-5.6, 36.2, -2.4], size: [3.5, 1, 3.5], material: 'wood' },

      // summit + win pad
      { kind: 'part', at: [0, 39, 0], size: [7, 1, 7], material: 'gold' },
      { kind: 'winPad', at: [0, 40, 0], size: [3, 0.4, 3] },
      { kind: 'label', at: [0, 42, 0], text: '🏆 SUMMIT', scale: 1.3, color: '#ffc94d' },
    ],
    rules: [
      {
        when: { type: 'start' },
        do: [{ type: 'toast', text: 'Spiral up — hit the midway button to open the gate.' }],
        once: true,
      },
      {
        when: { type: 'touch', part: 'gateBtn' },
        do: [
          { type: 'openDoor', part: 'gate', seconds: 0.8 },
          { type: 'big', text: '🔓 Gate open!' },
          { type: 'sound', name: 'checkpoint' },
        ],
        once: true,
      },
    ],
  }
}

function makeWaveSurvival(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 2,
    meta: {
      name: 'Scripted Wave Survival',
      emoji: '🌊',
      genre: 'Survival',
      blurb: 'A Studio-scripted combat loop with scaling bot waves.',
      gradient: 'linear-gradient(135deg, #273c75, #44bd32)',
    },
    camera: 'fp',
    lighting: 'night',
    spawn: [0, 3, 0],
    combat: { selfTeam: 'hero', health: 120, weapons: ['sidearm', 'pulse', 'flak'], startWeapons: ['sidearm', 'pulse'], infiniteAmmo: true },
    vars: { wave: 0 },
    parts: [
      { kind: 'part', at: [0, 0, 0], size: [54, 1, 54], material: 'metal', color: '#2f3640' },
      { kind: 'part', at: [0, 3, 27], size: [54, 6, 1], material: 'stone' },
      { kind: 'part', at: [0, 3, -27], size: [54, 6, 1], material: 'stone' },
      { kind: 'part', at: [27, 3, 0], size: [1, 6, 54], material: 'stone' },
      { kind: 'part', at: [-27, 3, 0], size: [1, 6, 54], material: 'stone' },
      { kind: 'weaponSpawn', at: [12, 1.5, 0], weapon: 'flak' },
      { kind: 'healthPack', at: [-12, 1.5, 0] },
      { kind: 'ammoSpawn', at: [0, 1.5, 12] },
      { kind: 'label', at: [0, 7, 0], text: 'SURVIVE THE WAVES', scale: 1.1, color: '#9fe8d8' },
    ],
    script: `let wave = 0
let nextAt = 1
const spawns = [[22,3,22],[-22,3,22],[22,3,-22],[-22,3,-22]]

boxcade.onStart(() => {
  boxcade.setSpawnPoints([[0,3,0]])
  boxcade.toast('Scripted game mode: survive as long as you can.')
})

boxcade.onTick((time, dt, state) => {
  if (!state.isHost || time < nextAt) return
  wave += 1
  boxcade.setVar('wave', wave)
  boxcade.big('Wave ' + wave)
  const count = Math.min(14, 2 + wave * 2)
  for (let i = 0; i < count; i++) {
    const s = spawns[i % spawns.length]
    boxcade.spawnBot({ name: 'Raider ' + wave + '-' + i, team: 'enemy', skill: Math.min(1, 0.35 + wave * 0.05), spawns: [s], shirt: '#e74c3c' })
  }
  nextAt = time + Math.max(8, 18 - wave)
})
`,
  }
}

function makeCtfArena(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 2,
    meta: {
      name: 'Scripted CTF Arena',
      emoji: '🚩',
      genre: 'CTF',
      blurb: 'A two-base shooter starter with scripted teams and bot objectives.',
      gradient: 'linear-gradient(135deg, #e74c3c, #3b82f6)',
    },
    camera: 'fp',
    lighting: 'space',
    spawn: [0, 3, -20],
    combat: { selfTeam: 'red', health: 100, weapons: ['sidearm', 'pulse', 'rockets', 'sniper'], startWeapons: ['sidearm', 'pulse'] },
    vars: { red: 0, blue: 0 },
    parts: [
      { kind: 'part', at: [0, 0, 0], size: [32, 1, 62], material: 'metal' },
      { kind: 'part', at: [0, 1, -24], size: [18, 1, 8], material: 'stone', color: '#7f1d1d' },
      { kind: 'part', at: [0, 1, 24], size: [18, 1, 8], material: 'stone', color: '#1d4ed8' },
      { kind: 'part', id: 'redFlag', at: [0, 3, -24], size: [0.5, 3, 0.5], material: 'neon', color: '#ff4d4d', collide: false },
      { kind: 'part', id: 'blueFlag', at: [0, 3, 24], size: [0.5, 3, 0.5], material: 'neon', color: '#4d8bff', collide: false },
      { kind: 'weaponSpawn', at: [10, 1.5, 0], weapon: 'rockets' },
      { kind: 'weaponSpawn', at: [-10, 1.5, 0], weapon: 'sniper' },
      { kind: 'healthPack', at: [0, 1.5, 0] },
      { kind: 'label', at: [0, 8, 0], text: 'SCRIPTED CTF STARTER', scale: 1.1, color: '#ffffff' },
    ],
    script: `let booted = false
const redBase = [0,3,-24]
const blueBase = [0,3,24]

boxcade.onStart(() => {
  boxcade.setSpawnPoints([[0,3,-20],[-5,3,-22],[5,3,-22]])
  boxcade.toast('Starter CTF script: bots push toward the enemy flag.')
})

boxcade.onTick((time, dt, state) => {
  if (!state.isHost) return
  if (!booted) {
    booted = true
    for (let i = 0; i < 3; i++) boxcade.spawnBot({ name: 'Blue ' + (i + 1), team: 'blue', skill: 0.45 + i * 0.1, spawns: [[0,3,20],[-5,3,22],[5,3,22]], shirt: '#3b82f6' })
    for (let i = 0; i < 2; i++) boxcade.spawnBot({ name: 'Red ' + (i + 1), team: 'red', skill: 0.45 + i * 0.1, spawns: [[-5,3,-22],[5,3,-22]], shirt: '#e74c3c' })
  }
  for (const e of state.entities) {
    if (!e.isBot || !e.alive) continue
    boxcade.entity(e.id).setObjective(e.team === 'red' ? blueBase : redBase)
  }
})
`,
  }
}

function makeMiniRoyale(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 2,
    meta: {
      name: 'Mini Royale',
      emoji: '🪂',
      genre: 'Royale',
      blurb: 'A compact scripted royale starter with drops, loot pads and gas pressure.',
      gradient: 'linear-gradient(135deg, #2c3a52, #b3543e)',
    },
    camera: 'fp',
    lighting: 'goldenHour',
    killY: -5,
    spawn: [0, 35, 0],
    combat: { selfTeam: 'red', health: 100, weapons: ['sidearm', 'pulse', 'flak', 'rockets'], startWeapons: ['sidearm'] },
    vars: { gas: 40, alive: 1 },
    parts: [
      { kind: 'part', at: [0, 0, 0], size: [70, 2, 70], material: 'grass', color: '#75a558' },
      { kind: 'water', at: [0, -1.6, 0], size: [120, 1, 120] },
      { kind: 'part', at: [0, 2, 0], size: [14, 4, 14], material: 'stone' },
      { kind: 'weaponSpawn', at: [12, 1.5, 8], weapon: 'pulse' },
      { kind: 'weaponSpawn', at: [-14, 1.5, -12], weapon: 'flak' },
      { kind: 'weaponSpawn', at: [20, 1.5, -20], weapon: 'rockets' },
      { kind: 'healthPack', at: [0, 1.5, 18] },
      { kind: 'ammoSpawn', at: [-18, 1.5, 0] },
      { kind: 'label', at: [0, 9, 0], text: 'MINI ROYALE', scale: 1.3, color: '#ffe2c4' },
    ],
    script: `let booted = false
let nextGas = 6
let radius = 40
const drops = [[-22,35,-22],[22,35,22],[-24,35,18],[18,35,-24]]

boxcade.onStart(() => {
  boxcade.toast('Mini Royale: loot up and stay near the center.')
})

boxcade.onTick((time, dt, state) => {
  if (!state.isHost) return
  if (!booted) {
    booted = true
    for (let i = 0; i < drops.length; i++) {
      boxcade.spawnBot({ name: 'Dropper ' + (i + 1), team: 'enemy', skill: 0.45 + i * 0.08, spawns: [drops[i]], shirt: '#3b82f6' })
    }
    for (const e of state.entities) if (e.isBot) boxcade.entity(e.id).deploy(drops[0])
  }
  if (time >= nextGas) {
    radius = Math.max(8, radius - 4)
    boxcade.setVar('gas', radius)
    boxcade.toast('Gas radius: ' + radius)
    nextGas = time + 8
  }
  for (const e of state.entities) {
    if (!e.alive) continue
    const p = e.position
    const outside = Math.hypot(p[0], p[2]) > radius
    if (outside) boxcade.entity(e.id).hurt(4, 'gas', '☣')
    if (e.isBot) boxcade.entity(e.id).setObjective([0, 2, 0])
  }
})
`,
  }
}

export const TEMPLATES: Template[] = [
  {
    id: 'obby',
    name: 'Classic Obby',
    emoji: '🟦',
    blurb: 'Floating islands ascending past lava to a win pad.',
    make: makeObby,
  },
  {
    id: 'arena',
    name: 'Bot Arena',
    emoji: '🤖',
    blurb: 'Walled deathmatch pit with weapons, ammo and bots.',
    make: makeArena,
  },
  {
    id: 'sandbox',
    name: 'Voxel Sandbox',
    emoji: '🧰',
    blurb: 'A blank voxel island in first-person build mode.',
    make: makeSandbox,
  },
  {
    id: 'tower',
    name: 'Parkour Tower',
    emoji: '🗼',
    blurb: 'A spiraling tower with a button-gated midway and a summit.',
    make: makeTower,
  },
  {
    id: 'waves',
    name: 'Scripted Waves',
    emoji: '🌊',
    blurb: 'A sandboxed-script combat loop with escalating bot waves.',
    make: makeWaveSurvival,
  },
  {
    id: 'ctf-scripted',
    name: 'Scripted CTF',
    emoji: '🚩',
    blurb: 'Two bases, teams, bots and scripted objectives.',
    make: makeCtfArena,
  },
  {
    id: 'mini-royale',
    name: 'Mini Royale',
    emoji: '🪂',
    blurb: 'A compact scripted royale with loot and gas pressure.',
    make: makeMiniRoyale,
  },
]
