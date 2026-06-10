// Sky Obby — the flagship Boxcade game. The obby is blocky gaming's
// foundational genre, so this is the engine's showpiece: 15 stages
// over a lava ocean at golden hour, with checkpoints, kill bricks, moving
// platforms, windmill hazards, an ice bridge, bounce pads and a victory podium.

import { defineGame, v3, behaviors, colors, type WorldBuilder } from '../sdk'

const STAGES = 15
let lastStage = 1

export default defineGame({
  meta: {
    id: 'sky-obby',
    name: 'Sky Obby',
    blurb: 'Climb 15 stages of floating islands above a lava ocean. Checkpoints, spinners, ice — the classic.',
    emoji: '🌋',
    gradient: 'linear-gradient(135deg, #ff8c42 0%, #ff3b3b 55%, #5d2bd1 100%)',
    genre: 'Obby · Multiplayer',
  },
  camera: 'orbit',
  rtReflections: true, // the ice bridge + golden podium mirror the lava glow
  services: {
    leaderboard: true,
    store: [
      { id: 'lava-runner', name: 'Lava Runner Shirt', kind: 'shirt', color: '#ff5a1f', price: 25 },
      { id: 'sky-streak', name: 'Sky Streak Trail', kind: 'trail', color: '#4cc9f0', price: 40 },
    ],
  },

  build(w: WorldBuilder) {
    w.lighting('goldenHour')
    w.killY(-14)
    w.spawn(v3(0, 3.4, 0))

    // ---- the lava ocean far below ----
    w.lava(v3(0, -20, -160), v3(420, 4, 520))

    // ---- spawn plaza ----
    w.add({ at: v3(0, 1, 0), size: v3(18, 2, 18), color: colors.grass, material: 'grass' })
    w.add({ at: v3(0, 0.4, 0), size: v3(22, 0.8, 22), color: '#8a6a43', material: 'stone' })
    w.label('🌋 SKY OBBY', v3(0, 9.5, -6), 1.6)
    w.label('Reach the golden podium!', v3(0, 7.8, -6), 0.8, '#ffd9ae')
    w.tree(v3(-6.5, 2, 5.5), 1.1)
    w.tree(v3(6.5, 2, 6), 0.9)
    for (let i = 0; i < 5; i++) w.coin(v3(-4 + i * 2, 3.4, -4))

    let z = -14 // build path heads in -Z
    const stagePads: Array<{ at: ReturnType<typeof v3>; n: number }> = []

    const stagePad = (n: number, x: number, y: number) => {
      w.add({ at: v3(x, y, z), size: v3(8, 1.2, 8), color: '#7e57c2', material: 'plastic' })
      w.label(`Stage ${n}`, v3(x, y + 4.6, z), 0.62, '#e8dcff')
      if (n % 3 === 1 && n > 1) w.checkpoint(v3(x, y + 0.9, z), Math.ceil(n / 3))
      stagePads.push({ at: v3(x, y, z), n })
    }

    // ---- stage 1-2: warm-up jumps ----
    stagePad(1, 0, 2)
    z -= 6
    for (let i = 0; i < 3; i++) {
      w.add({ at: v3(0, 2 + i * 0.6, z), size: v3(3.4, 1, 3.4), color: colors.sky, material: 'plastic' })
      z -= 5
    }
    stagePad(2, 0, 4)
    z -= 6

    // ---- stage 3: lava-gap hops ----
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 === 0 ? -2.2 : 2.2)
      w.add({ at: v3(x, 4.6 + i * 0.5, z), size: v3(2.8, 0.9, 2.8), color: colors.yellow, material: 'plastic' })
      w.lava(v3(0, 3.2, z), v3(12, 0.4, 1.6))
      z -= 5.2
    }
    stagePad(3, 0, 7)
    z -= 7

    // ---- stage 4: first moving platform ----
    w.add({
      at: v3(0, 7, z), size: v3(3.6, 0.8, 3.6), color: colors.mint, material: 'neon',
      behavior: behaviors.patrol(v3(0, 0, -12), 5.2),
    })
    z -= 17
    stagePad(4, 0, 7.4)
    z -= 7

    // ---- stage 5: windmill spinner ----
    w.add({ at: v3(0, 7.4, z - 4), size: v3(11, 1, 11), color: '#546e8f', material: 'stone' })
    w.spinnerHazard(v3(0, 9.2, z - 4), 4.4, 3, 3.4)
    w.coin(v3(0, 9.4, z - 4))
    z -= 14
    stagePad(5, 0, 7.8)
    z -= 7

    // ---- stage 6: bounce pads up ----
    w.bouncePad(v3(0, 8, z), 26)
    w.add({ at: v3(0, 13, z - 7), size: v3(4, 1, 4), color: colors.purple, material: 'plastic' })
    w.bouncePad(v3(0, 13.9, z - 7), 26)
    z -= 14
    stagePad(6, 0, 18)
    z -= 7

    // ---- stage 7: ice bridge (slippery!) ----
    w.add({ at: v3(0, 18, z - 7), size: v3(2.4, 0.8, 16), color: '#bfeaff', material: 'ice' })
    w.label('❄️ careful…', v3(0, 21.5, z - 7), 0.62, '#d6f3ff')
    z -= 16
    stagePad(7, 0, 18)
    z -= 7

    // ---- stage 8: shrinking ledges ----
    const widths = [2.6, 2.0, 1.5, 1.1]
    for (let i = 0; i < widths.length; i++) {
      w.add({ at: v3((i % 2 ? 1.8 : -1.8), 18.4 + i * 0.5, z), size: v3(widths[i], 0.8, widths[i]), color: colors.orange, material: 'plastic' })
      z -= 4.6
    }
    stagePad(8, 0, 20.6)
    z -= 7

    // ---- stage 9: dual patrol gauntlet ----
    w.add({
      at: v3(-3, 20.6, z - 3), size: v3(3, 0.8, 3), color: colors.mint, material: 'neon',
      behavior: behaviors.patrol(v3(6, 0, 0), 3.6),
    })
    w.add({
      at: v3(3, 21.2, z - 10), size: v3(3, 0.8, 3), color: colors.mint, material: 'neon',
      behavior: behaviors.patrol(v3(-6, 0, 0), 3.6, Math.PI),
    })
    z -= 17
    stagePad(9, 0, 21.6)
    z -= 7

    // ---- stage 10: kill-brick corridor ----
    w.add({ at: v3(0, 21.6, z - 6), size: v3(3, 1, 14), color: '#546e8f', material: 'stone' })
    for (let i = 0; i < 3; i++) {
      w.add({
        at: v3(0, 23.6, z - 2 - i * 4.5), size: v3(1.4, 1.4, 1.4), color: '#ff3b3b', material: 'neon', collide: false,
        behavior: behaviors.patrol(v3(i % 2 ? 4.4 : -4.4, 0, 0), 2.2 + i * 0.3),
        onTouch: (ctx) => ctx.player.kill(),
      })
    }
    z -= 14
    stagePad(10, 0, 22)
    z -= 7

    // ---- stage 11: vertical orbit lift ----
    w.add({
      at: v3(0, 23, z - 2), size: v3(3.2, 0.8, 3.2), color: colors.sky, material: 'plastic',
      behavior: behaviors.patrol(v3(0, 9, -8), 6),
    })
    z -= 13
    stagePad(11, 0, 32.4)
    z -= 7

    // ---- stage 12: coin gallery across clouds ----
    for (let i = 0; i < 4; i++) {
      w.add({ at: v3((i % 2 ? 2.4 : -2.4), 32.6 + i * 0.4, z), size: v3(2.6, 0.9, 2.6), color: colors.white, material: 'plastic' })
      w.coin(v3((i % 2 ? 2.4 : -2.4), 34.4 + i * 0.4, z))
      z -= 4.8
    }
    stagePad(12, 0, 34.4)
    z -= 7

    // ---- stage 13: double windmill ----
    w.add({ at: v3(0, 34.4, z - 5), size: v3(13, 1, 13), color: '#546e8f', material: 'stone' })
    w.spinnerHazard(v3(0, 36.2, z - 5), 5.4, 4, 3.0)
    w.spinnerHazard(v3(0, 36.2, z - 5), 2.6, 2, 2.0)
    w.coin(v3(0, 36.6, z - 5))
    z -= 16
    stagePad(13, 0, 35)
    z -= 7

    // ---- stage 14: leap of faith bounce ----
    w.bouncePad(v3(0, 35.6, z), 32)
    w.label('⬆ BOUNCE!', v3(0, 39, z), 0.7, '#aef7d8')
    z -= 13
    stagePad(14, 0, 44)
    z -= 8

    // ---- stage 15: the summit ----
    w.add({ at: v3(0, 45, z - 4), size: v3(14, 1.6, 14), color: colors.grass, material: 'grass' })
    w.tree(v3(-4.5, 45.8, z - 7), 1.2)
    w.tree(v3(4.5, 45.8, z - 6), 1)
    w.winPad(v3(0, 46.6, z - 4), v3(5, 1.2, 5), (ctx) => {
      ctx.hud.set('stage', `⭐ COMPLETED in ${Math.floor(ctx.time / 60)}:${String(Math.floor(ctx.time % 60)).padStart(2, '0')}`)
      ctx.award(25)
      ctx.systemChat(`${ctx.player.name} beat Sky Obby! 🏆`)
    })
    w.label('🏆', v3(0, 51, z - 4), 1.6)
    w.portal(v3(5.5, 47.4, z - 4), 'play:castle-run', 'To Castle Run! 🏰') // hop to the sister game from the summit
    stagePads.push({ at: v3(0, 45, z - 4), n: STAGES })

    // ---- decoration: side islands + clouds ----
    const decor: Array<[number, number, number, number]> = [
      [-26, 5, -30, 1.3], [24, 9, -60, 1.0], [-30, 14, -95, 1.4],
      [28, 20, -130, 1.1], [-24, 27, -170, 1.2], [26, 33, -205, 0.9],
    ]
    for (const [x, y, zz, s] of decor) {
      w.add({ at: v3(x, y, zz), size: v3(10 * s, 2 * s, 10 * s), color: colors.grass, material: 'grass' })
      w.add({ at: v3(x, y - 1.6 * s, zz), size: v3(7 * s, 1.6 * s, 7 * s), color: '#7a5a3a', material: 'stone' })
      w.tree(v3(x + 2, y + s, zz - 1), s * 0.9)
    }
    for (let i = 0; i < 10; i++) {
      w.cloud(v3((i % 2 ? -1 : 1) * (18 + (i * 7) % 26), 12 + i * 4.2, -20 - i * 26), 0.8 + (i % 3) * 0.5)
    }
  },

  onStart(ctx) {
    lastStage = 1
    ctx.hud.set('stage', `⭐ Stage 1/${STAGES}`)
    ctx.hud.set('coins', '🪙 0')
    ctx.hud.toast('Reach the golden podium — checkpoints save your progress!')
  },

  onTick(ctx) {
    // stage tracker: furthest -Z progress mapped to stage number
    const z = ctx.player.position.z
    const stage = Math.max(1, Math.min(STAGES, 1 + Math.floor(-z / 22)))
    if (stage > lastStage) {
      lastStage = stage
      ctx.hud.set('stage', `⭐ Stage ${stage}/${STAGES}`)
    }
  },

  onRespawn() {
    // keep the stage display — checkpoints already handle progress
  },
})
