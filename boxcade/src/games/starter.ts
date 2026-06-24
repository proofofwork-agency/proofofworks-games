// Starter Island — the "my first Blobcade game" template, kept deliberately
// tiny. This whole game is ~25 lines of SDK calls; it's the snippet from the
// README, running live. Copy this file to start your own game.

import { defineGame, v3, behaviors, colors } from '../sdk'

export default defineGame({
  meta: {
    id: 'starter',
    name: 'Starter Island',
    blurb: 'The 25-line example game. Copy src/games/starter.ts and make it yours.',
    emoji: '🌴',
    gradient: 'linear-gradient(135deg, #06d6a0 0%, #4cc9f0 100%)',
    genre: 'Template · Learn',
  },

  rtReflections: true, // the little mirror pond shows off ray-traced reflections

  build(w) {
    w.lighting('morning')
    w.spawn(v3(0, 4, 6))
    w.add({ at: v3(0, 0, 0), size: v3(26, 2, 26), color: colors.grass, material: 'grass' })
    w.add({ at: v3(0, -1.4, 0), size: v3(20, 1.5, 20), color: colors.dirt, material: 'stone' })
    // mirror pond — 'ice' is one of the shiny materials that reflect for real
    w.add({ at: v3(-7, 1.04, 7), size: v3(7, 0.18, 6), color: '#9fd9ff', material: 'ice' })
    w.tree(v3(-8, 1, -8))
    w.tree(v3(9, 1, -6), 1.3)
    w.label('🌴 Welcome to Blobcade!', v3(0, 8, -8))
    w.add({
      at: v3(0, 2.5, -8), size: v3(4, 1, 4), color: colors.sky,
      behavior: behaviors.spin(1.2),
    })
    w.bouncePad(v3(8, 1.4, 8))
    for (let i = 0; i < 6; i++) {
      w.coin(v3(-6 + i * 2.4, 3.2, 4))
    }
    w.winPad(v3(0, 5.4, -8), v3(3, 0.8, 3))
  },

  onStart(ctx) {
    ctx.hud.set('coins', '🪙 0')
    ctx.hud.toast('Collect the coins, then jump on the gold pad!')
  },
})
