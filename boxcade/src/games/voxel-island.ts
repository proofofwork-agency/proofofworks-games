// Voxel Island — the voxel-sandbox side of Blobcade's family tree. A
// procedurally generated island you can reshape freely: pointer-lock first
// person, left-click break, right-click place, hotbar 1-8, swimmable water,
// and a world you can download as JSON and reload from the SDK.

import { defineGame, v3 } from '../sdk'

export default defineGame({
  meta: {
    id: 'voxel-island',
    name: 'Voxel Island',
    blurb: 'A whole voxel island, yours to reshape. Break, build, swim, and download your creation.',
    emoji: '⛏️',
    gradient: 'linear-gradient(135deg, #3fb950 0%, #2f81f7 70%, #1b2a55 100%)',
    genre: 'Sandbox · Building',
  },
  camera: 'fp',
  rtReflections: true, // the ocean mirrors the island — and your builds
  services: {
    leaderboard: true,
    store: [
      { id: 'island-green', name: 'Islander Shirt', kind: 'shirt', color: '#3fb950', price: 25 },
      { id: 'ocean-wake', name: 'Ocean Wake Trail', kind: 'trail', color: '#2f81f7', price: 40 },
    ],
  },

  build(w) {
    w.lighting('noon')
    w.killY(-12)
    w.voxelIsland({ seed: 20260609, size: 96 })
    w.vehicle('car', v3(56, 14, 48))
    w.vehicle('boat', v3(10, 12, 48))
  },

  onStart(ctx) {
    ctx.hud.set('mode', '⛏️ Build Mode')
    ctx.hud.toast('Click to capture the mouse — LMB breaks, RMB places.')
    ctx.systemChat('Tip: pause (Esc) to download your world as JSON.')
  },
})
