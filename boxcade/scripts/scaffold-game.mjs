#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const raw = process.argv[2] ?? 'my-game'
const id = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-game'
const name = id.split('-').map((s) => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ')
const out = resolve('src/games', `${id}.ts`)

if (existsSync(out)) {
  console.error(`${out} already exists`)
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `import { defineGame, v3, colors } from '../sdk'

export default defineGame({
  meta: {
    id: '${id}',
    name: '${name}',
    emoji: '🧪',
    genre: 'Developer',
    blurb: 'A trusted TypeScript game built with the Boxcade SDK.',
    gradient: 'linear-gradient(135deg, #06d6a0, #2f81f7)',
  },
  camera: 'orbit',
  build(w) {
    w.lighting('noon')
    w.spawn(v3(0, 3, 8))
    w.add({ at: v3(0, 0, 0), size: v3(24, 1, 24), color: colors.grass, material: 'grass' })
    w.coin(v3(0, 2, 0))
    w.winPad(v3(0, 1, -8))
  },
  onStart(ctx) {
    ctx.hud.toast('Trusted TypeScript Developer Mode')
  },
  onTick(ctx, dt) {
    void ctx
    void dt
  },
})
`)

console.log(`Created ${out}`)
console.log(`Register it in src/games/index.ts to show it in the portal.`)
