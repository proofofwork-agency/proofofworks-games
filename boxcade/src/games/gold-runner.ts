// Gold Runner — a Lode Runner-style homage: climb stacked brick tiers
// (the ladders), grab every gold bar, dodge the patrolling robot guards,
// and crack the locked vault at the top. Falling is death; checkpoints
// save your climb. Gold-gated exit — the vault only opens when it's all yours.

import { defineGame, v3, behaviors, type Vec3 } from '../sdk'

const BRICK = '#9e5b4f'
const BRICK_DARK = '#6f4039'

let totalGold = 0
let won = false
let lastLockedToast = -10

export default defineGame({
  meta: {
    id: 'gold-runner',
    name: 'Gold Runner',
    blurb: 'A Lode Runner-style climb: scale the brick tiers, grab all the gold, dodge the guards, crack the vault.',
    emoji: '💰',
    gradient: 'linear-gradient(135deg, #2c1810 0%, #b8860b 55%, #ffd166 100%)',
    genre: 'Obby · Puzzle',
  },
  camera: 'orbit',
  rtReflections: true, // the gold vault floor mirrors the torchlight

  build(w) {
    w.lighting('night')
    w.killY(-14)
    w.spawn(v3(0, 2, 4))

    // lava moat far below — a visible death floor under the void
    w.lava(v3(0, -20, -15), v3(70, 3, 90))

    const tier = (x: number, y: number, z: number, width: number, depth: number, color = BRICK) =>
      w.add({ at: v3(x, y, z), size: v3(width, 1, depth), color, material: 'stone' })
    // a climbable "ladder rung" — a small plank step between tiers
    const rung = (x: number, y: number, z: number, s = 3) =>
      w.add({ at: v3(x, y, z), size: v3(s, 1, s), color: '#caa15a', material: 'wood' })
    // a robot guard: patrols a tier and kills on contact (collide:false so it never shoves you)
    const guard = (x: number, yTop: number, z: number, range: number, period = 3.4, phase = 0) =>
      w.add({
        at: v3(x, yTop + 0.75, z), size: v3(1.5, 1.5, 1.5), color: '#ff3b3b', material: 'neon', collide: false,
        behavior: behaviors.patrol(v3(range, 0, 0), period, phase),
        onTouch: (ctx) => ctx.player.kill(),
      })

    // ---- COURTYARD (spawn) ----
    tier(0, 0, 4, 16, 12)
    w.label('💰 GOLD RUNNER', v3(0, 6, 4), 1.4)
    w.label('climb · grab all gold · dodge guards', v3(0, 4.4, 4), 0.62, '#ffd9a0')
    w.light(v3(0, 5, 4), { color: '#ffb347', intensity: 2, range: 16 })
    rung(0, 1.0, -4)
    rung(0, 2.0, -6)

    // ---- TIER 1 ----
    tier(0, 3.0, -8, 12, 6)
    w.checkpoint(v3(0, 4.0, -8), 1)
    w.light(v3(0, 7, -8), { color: '#ffb347', intensity: 1.6, range: 14 })
    guard(0, 3.5, -8, 4)
    rung(0, 4.0, -12.5)
    rung(0, 5.0, -14)

    // ---- TIER 2 ----
    tier(0, 6.0, -15.5, 12, 6)
    w.checkpoint(v3(0, 7.0, -15.5), 2)
    guard(0, 6.5, -15.5, 4.5, 3.0, Math.PI)
    rung(0, 7.0, -20)
    rung(0, 8.0, -21.5)

    // ---- TIER 3 (gauntlet) ----
    tier(0, 9.0, -23, 12, 6)
    w.checkpoint(v3(0, 10.0, -23), 3)
    w.light(v3(0, 13, -23), { color: '#ffb347', intensity: 1.6, range: 14 })
    guard(0, 9.5, -23, 4)
    guard(0, 9.5, -21, 3, 2.6, Math.PI)
    rung(0, 10.0, -27.5)
    rung(0, 11.0, -29)

    // ---- VAULT (locked exit) ----
    tier(0, 12.0, -30.5, 14, 7, BRICK_DARK)
    w.add({ at: v3(0, 14.8, -34), size: v3(14, 5, 1), color: BRICK_DARK, material: 'stone' }) // back wall
    w.checkpoint(v3(0, 13.0, -30.5), 4)
    w.label('🔒 THE VAULT', v3(0, 16, -30.5), 1.0, '#ffd166')
    w.light(v3(0, 16, -30.5), { color: '#ffe08a', intensity: 2.4, range: 18 })

    // ---- GOLD (collect every bar to unlock the vault) ----
    const gold: Vec3[] = [
      // courtyard
      v3(-4, 2.6, 4), v3(0, 2.6, 4), v3(4, 2.6, 4),
      // tier 1
      v3(-3, 5.6, -8), v3(3, 5.6, -8),
      // tier 2
      v3(-4, 8.6, -15.5), v3(4, 8.6, -15.5),
      // tier 3
      v3(-4, 11.6, -23), v3(0, 11.6, -23), v3(4, 11.6, -21),
      // vault
      v3(-4, 14.6, -30.5), v3(0, 14.6, -30.5), v3(4, 14.6, -30.5),
    ]
    for (const g of gold) w.coin(g)
    totalGold = gold.length

    // ---- the locked vault pad: only opens when all gold is collected ----
    w.add({
      at: v3(0, 12.8, -30.5), size: v3(4.4, 0.4, 4.4), color: '#ffd166', material: 'gold', reflect: true,
      onTouch: (ctx) => {
        if (won) return
        if (ctx.coins >= totalGold) {
          won = true
          ctx.celebrate(`💰 Vault cracked! All ${totalGold} gold secured.`)
          ctx.award(50)
          ctx.systemChat(`${ctx.player.name} cleared Gold Runner! 🏆`)
        } else if (ctx.time - lastLockedToast > 2.2) {
          lastLockedToast = ctx.time
          ctx.hud.toast(`🔒 Locked — ${ctx.coins}/${totalGold} gold collected`)
        }
      },
    })
  },

  onStart(ctx) {
    won = false
    lastLockedToast = -10
    ctx.hud.set('gold', `💰 0/${totalGold}`)
    ctx.hud.toast('Climb the tiers, grab ALL the gold, then crack the vault!')
    ctx.systemChat('Guards kill on touch — time your runs. Falling sends you to the last checkpoint.')
  },

  onTick(ctx) {
    ctx.hud.set('gold', `💰 ${ctx.coins}/${totalGold}`)
  },
})
