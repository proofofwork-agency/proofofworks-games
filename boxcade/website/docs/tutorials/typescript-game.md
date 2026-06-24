---
sidebar_position: 1
description: The full tutorial — build a complete multiplayer game in pure TypeScript with the defineGame SDK.
---

# Pure TypeScript game (full tutorial)

This is Blobcade's **full-power, trusted** creation path — the exact same way the six
shipped games are built. A complete multiplayer game is one small file: multiplayer,
physics, HUD, chat, sound and the renderer come free.

:::info Trust model
Trusted TypeScript games are full code (imports, arbitrary state, `onTick`, bots,
`ctx.engine`). That power means they are **not** anonymous public UGC — they ship via
curated inclusion in the repo, a self-hosted sandboxed embed, or local forks. For the
community-safe, no-code path see the [GameDoc editor](./gamedoc-editor.md).
:::

## 1. Scaffold a game

The fastest start is the scaffold script, which drops a runnable starter into `src/games/`:

```bash
npm run scaffold:game -- my-arena
```

This creates `src/games/my-arena.ts` (a complete game) and tells you the one remaining
step: **register it**. Or copy `src/games/starter.ts` by hand — it's deliberately ~25 lines.

## 2. The anatomy of a game

A game is a `GameDef`: metadata + a `build()` function + optional hooks. `defineGame()`
just returns its argument (it gives you type-checking and autocomplete):

```ts
import { defineGame, v3, behaviors, colors } from '../sdk'

export default defineGame({
  meta: {
    id: 'my-game', name: 'My Game', emoji: '🚀', genre: 'Adventure',
    blurb: 'My first Blobcade game.',
    gradient: 'linear-gradient(135deg, #f953c6, #b91d73)',
  },
  build(w) {
    w.lighting('goldenHour')                 // 'noon' | 'morning' | 'goldenHour' | 'night' | 'space'
    w.spawn(v3(0, 4, 0))
    w.add({ at: v3(0, 0, 0), size: v3(24, 2, 24), color: colors.grass, material: 'grass' })
    w.add({                                   // a spinning platform
      at: v3(8, 3, 0), size: v3(4, 1, 4), color: colors.sky,
      behavior: behaviors.spin(1.5),
    })
    w.lava(v3(0, -10, 0), v3(200, 2, 200))    // kill floor
    w.coin(v3(2, 3, 2))
    w.bouncePad(v3(-6, 1.4, -6))
    w.winPad(v3(8, 5, 0))
  },
  onStart(ctx) { ctx.hud.toast('Welcome!') },
  onTick(ctx, dt) { /* per-frame logic */ },
})
```

:::tip Where this path fits
Pure TypeScript is the **top of the trust/power ladder** — full code, ships via the repo.
It's *not* isolated from the other paths: your `build()` can pull in an [ASCII map](./text-maps.md)
with `buildTextMap`, or start from a whole [GameDoc](./gamedoc-editor.md) via
`buildGameFromDoc`. See [Creation paths](../creation-paths.md) for the full picture.
:::

### Mix in an ASCII map (code game + text-file level)

Your code game can lay out its level from a `.txt` file you hot-reload — `buildTextMap` is
just another `WorldBuilder` verb. This is how *Castle Run* and *Facing Towers* are built:

```ts
import { defineGame, buildTextMap, v3 } from '../sdk'
import arenaMap from '../maps/arena.txt?raw'   // ?raw = import the file as a string

export default defineGame({
  meta: { id: 'arena', name: 'Arena', emoji: '⚔️', genre: 'Arena', blurb: '…', gradient: '…' },
  build(w) {
    buildTextMap(w, arenaMap)                  // the whole ASCII map, placed
    w.label('FIGHT!', v3(0, 11, 0))            // code-built extras on top
  },
  onTick(ctx) { /* your logic over the map */ },
})
```

Edit `arena.txt` → save → Vite hot-reloads. Maps and code mix freely because `buildTextMap`
calls the same `w.add` / `w.coin` / … verbs your code does.

### Start from a GameDoc / Studio export (doc → code)

Built a world in the [3D Studio](./studio-3d.md)? Don't rebuild it. Either export with the
Studio's **⬇ TS** button (it generates exactly this), or do it by hand — turn the doc into a
`GameDef` and layer your code on top:

```ts
import { buildGameFromDoc, defineGame } from '../sdk'
import myDoc from './my-world.blobcade.json'   // a doc exported from the Studio

const base = buildGameFromDoc(myDoc)           // doc → GameDef (keeps its world + rules)

export default defineGame({
  ...base,                                     // keep the doc's build/rules
  meta: { ...base.meta, id: 'my-extended-game' },
  onTick(ctx, dt) {                            // add logic the doc couldn't express
    if (ctx.coins >= 10) ctx.hud.big('Coin frenzy!')
  },
})
```

This is the designed **no-code → full-code bridge**: the doc was your scaffolding, and now
you have full TypeScript power. Replace pieces of the inlined doc with direct SDK calls as
the game outgrows the data format.

:::warning One-way
Crossing to TypeScript means the **Studio can no longer visually edit your world** (the
export is doc→code, not back). Keep your map as a separate text-map (`buildTextMap`) if
you want layout to stay editable. See [Creation paths](../creation-paths.md);
fixing this is roadmap item STUDIO-009.
:::

### `meta` — the portal card

| Field | Notes |
| --- | --- |
| `id` | Unique id; used for the room key and routing. |
| `name` · `blurb` · `emoji` | Portal card text. |
| `gradient` | CSS background for the card thumbnail. |
| `genre` | Free-text tag. |

### `build(w)` — place the world

`w` is a `WorldBuilder`. Its verbs either place a rounded-box part (`w.add`) or drop a
prefab (`w.coin`, `w.bouncePad`, …). Calls run before the renderer exists, so they queue
intent that the runtime replays once the engine is built. Full verb list in the
[SDK reference](../reference/sdk.md); the essentials:

- **Parts**: `w.add({ at, size, color, material, collide, bounce, behavior, onTouch })`
  - materials: `plastic · grass · wood · stone · ice (slippery!) · neon · lava · gold · glass · metal · sand`
- **Behaviors**: `behaviors.spin(speed)` · `patrol(offset, period)` · `orbit(center, r, period)` · `bob(amp, period)`
- **Prefabs**: `w.checkpoint() · w.lava() · w.coin() · w.winPad() · w.bouncePad() · w.tree() · w.cloud() · w.spinnerHazard() · w.label() · w.weaponSpawn() · w.ammoSpawn() · w.healthPack() · w.light() · w.portal() · w.vehicle()`
- **World**: `w.lighting(name)` · `w.spawn(at)` · `w.killY(y)` · `w.physics({gravity,jumpVel,walkSpeed})`

### Hooks — react to the session

| Hook | Fires |
| --- | --- |
| `onStart(ctx)` | Once, after the world is built and systems init. |
| `onTick(ctx, dt)` | Every frame (runs **before** `def.systems`). |
| `onRespawn(ctx)` | When the local player respawns. |
| `onKill(ctx, info)` | In combat games, when someone dies (`info` is a `KillInfoApi`). |

`ctx` is the [`GameContext`](../reference/sdk.md#gamecontext) — your capability surface:
`ctx.player`, `ctx.hud`, `ctx.events`, `ctx.engine`, plus economy/moment APIs.

## 3. Register it

Edit `src/games/index.ts` — one import + one array entry. It appears on the portal with
everything working:

```ts
import myGame from './my-game'
export const GAMES: GameDef[] = [/* … */, myGame]
```

Visit `http://localhost:5173/#/play/my-game` (or click its card). Vite hot-reloads on save.

## 4. Make it a shooter (combat)

Set `def.combat` to turn on the arsenal, health, bots and the combat HUD:

```ts
import { WEAPONS } from '../sdk'

export default defineGame({
  meta: { /* … */ },
  camera: 'orbit',
  rtReflections: true,
  physics: { gravity: -20 },              // floaty low-gravity
  combat: {
    health: 100,
    respawnSeconds: 2,
    weapons: ['sidearm', 'shock', 'pulse', 'minigun', 'flak', 'rockets', 'sniper'],
    startWeapons: ['sidearm', 'shock'],
    selfTeam: 'red',
  },
  build(w) {
    w.lighting('space')
    w.weaponSpawn(v3(0, 2, 4), 'rockets')
    w.ammoSpawn(v3(4, 2, 0))
    w.healthPack(v3(-4, 2, 0))
  },
  onStart(ctx) {
    ctx.spawnBot({ name: 'Grunt', team: 'blue', skill: 0.5, spawns: [v3(8, 4, 8), v3(-8, 4, -8)] })
  },
  onKill(ctx, info) {
    ctx.hud.toast(`${info.killerName} 💀 ${info.victimName}`)
  },
})
```

Weapon ids are registry names (the seven built-ins or ones you `registerWeapon`). See
[Weapons reference](../reference/weapons.md).

## 5. Compose with systems

Move reusable per-frame logic into `GameSystem` objects (Strategy) instead of one giant
`onTick`:

```ts
import { type GameSystem } from '../sdk'

const killStreaks: GameSystem = {
  id: 'kill-streaks',
  init(ctx) { ctx.events.on('combat:kill', ({ killerIsSelf }) => { /* … */ }) },
  update(ctx, dt) { /* … */ },
  dispose() { /* … */ },
}

export default defineGame({
  meta: { /* … */ },
  systems: [killStreaks],
  build(w) { /* … */ },
})
```

The runtime calls `init` after `onStart`, `update` every frame after `onTick`, `dispose`
on session end.

## 6. Reach the engine directly (`ctx.engine`)

For advanced games, `ctx.engine` is the live facade — full reach without forking:

```ts
onTick(ctx) {
  // pulse the sun, read raw input, spawn FX, talk to combat…
  ctx.engine.renderer.sun.intensity = 3 + Math.sin(ctx.time) * 0.5
  if (ctx.engine.input.keys.has('f')) ctx.engine.fx.burst(ctx.player.position, '#fff')
}
```

It exposes `renderer`, `parts`, `voxels`, `combat`, `fx`, `net`, `input`, `player`,
`audio`, `events` — the live instances, not copies.

## That's it

You now have: metadata, a built world, hooks, combat, composable systems, and engine
reach — everything the shipped games use. For the same world expressed as portable data
(no code, shareable by link), continue to the [GameDoc editor](./gamedoc-editor.md).
