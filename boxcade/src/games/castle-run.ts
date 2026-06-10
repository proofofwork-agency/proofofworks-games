// Castle Run — this game's entire level lives in src/maps/castle.txt as
// ASCII art. Edit the text file, hit save, and Vite hot-reloads you straight
// into the new layout: the text file IS the map editor.

import { defineGame, buildTextMap, v3, type TextMapResult } from '../sdk'
import castleMap from '../maps/castle.txt?raw'

let map: TextMapResult | null = null

export default defineGame({
  meta: {
    id: 'castle-run',
    name: 'Castle Run',
    blurb: 'A whole castle drawn in one text file. Cross the moat, climb the battlements, take the keep.',
    emoji: '🏰',
    gradient: 'linear-gradient(135deg, #8e9bb5 0%, #5d6df1 60%, #2c2e57 100%)',
    genre: 'Text-map · Adventure',
  },
  camera: 'orbit',
  rtReflections: true, // the keep's polished metal floor mirrors the battlements

  build(w) {
    map = buildTextMap(w, castleMap)

    // text + code mix freely: decorations added the SDK way
    w.label('🏰 CASTLE RUN', v3(0, 17, -10), 1.4)
    w.label('drawn in castle.txt', v3(0, 14.8, -10), 0.7, '#c9d4ff')
    w.cloud(v3(-26, 22, -20), 1.2)
    w.cloud(v3(24, 26, 6), 0.9)
    w.cloud(v3(8, 30, -34), 1.4)
  },

  onStart(ctx) {
    ctx.hud.set('coins', `🪙 0/${map?.coins ?? 0}`)
    ctx.hud.toast('Cross the moat, climb the wall stairs, bounce onto the keep!')
    ctx.systemChat('This level is src/maps/castle.txt — edit it and save to reshape the castle.')
  },

  onTick(ctx) {
    ctx.hud.set('coins', `🪙 ${ctx.coins}/${map?.coins ?? 0}`)
  },
})
