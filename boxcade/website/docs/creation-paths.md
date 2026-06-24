---
sidebar_position: 3
description: The one mental model — how TypeScript, GameDocs (maps/rules), and sandboxed scripts relate, bridge, and mix.
---

# Creation paths: how they relate

Blobcade has **three creation paths**, and they confuse people because they look separate
but are actually one ladder. This page is the map. Read it once and the rest of the docs
click into place.

## The one mental model

There is **one thing the runtime runs: a `GameDef`.** Everything becomes a `GameDef`:

- **Pure TypeScript** — you call `defineGame({...})` and write a `GameDef` directly in code.
- **GameDoc (maps + rules)** — you author portable **data** (a JSON document); the runtime
  calls `buildGameFromDoc(doc)` to interpret it into a `GameDef`.
- **Sandboxed script** — *not* a separate path. It's the **`script` field inside a
  GameDoc**: the "programmable logic" half of a doc. It rides on top of the doc's world.

There is no "data engine" — a doc replays through the *same* `WorldBuilder` verbs a
hand-written game uses (`src/sdk/interpret.ts`), so **a doc game and a code game are
behavior-identical by construction**.

## The trust ↔ power ladder

```
   MOST POWER, repo-only trust                         least portable
  ┌─────────────────────────────────────────────────────────────────┐
  │  Pure TypeScript  (defineGame)                                  │
  │     full ctx.engine · onTick · imports · bots · arbitrary state │
  ├─────────────────────────────────────────────────────────────────┤
  │  GameDoc + script  (sandboxed JS in a Worker)                   │
  │     loops/arithmetic/spawners, but SAME action vocabulary as    │
  │     rules only — no ctx.engine, no DOM, no network              │
  ├─────────────────────────────────────────────────────────────────┤
  │  GameDoc + rules  (no-code when / if / do)                      │
  │     declarative triggers + conditions + actions; inert data     │
  ├─────────────────────────────────────────────────────────────────┤
  │  GameDoc world only  (textmap / parts / voxel — no logic)       │
  │     just geometry; a malicious doc wastes CPU, never runs code  │
  └─────────────────────────────────────────────────────────────────┘
   LEAST POWER, share-link safe                        most portable
```

| | Pure TypeScript | GameDoc + script | GameDoc + rules | GameDoc world |
| --- | --- | --- | --- | --- |
| Author as | `.ts` file in repo | doc `script` field (JSON) | doc `rules` array | doc `textmap`/`parts` |
| Ships via | curated repo / embed | share link (after prompt) | share link | share link |
| Can loop / do math | ✅ full | ✅ (Worker) | ❌ | ❌ |
| Touches `ctx.engine` | ✅ | ❌ | ❌ | ❌ |
| Reads as inert data | ❌ (it's code) | ❌ (runs code) | ✅ | ✅ |

The ladder exists for **one reason: trust**. A share link can contain a game from a
stranger, so the further "down" the ladder, the safer it is to open without asking. Code
that touches your browser (TypeScript) can only ship through trusted routes; everything
shareable is either inert data or locked-down sandboxed code.

## The four bridges (how paths connect)

The paths aren't silos — you can move **up** the ladder (add power) and **across** (mix
worlds and logic). Here are the four real bridges, each with a concrete example.

### Bridge 1 — a TypeScript game *uses* an ASCII map (`buildTextMap`)

The most common mix. Your game is code, but the **level layout** is a text file you can
hot-reload. This is exactly how *Castle Run* and *Facing Towers* work — `buildTextMap` is
just another `WorldBuilder` verb you call inside `build()`:

```ts
// src/games/arena.ts
import { defineGame, buildTextMap, v3, behaviors, colors } from '../sdk'
import arenaMap from '../maps/arena.txt?raw'   // ?raw = import the file as a string

export default defineGame({
  meta: { id: 'arena', name: 'Arena', emoji: '⚔️', genre: 'Arena', blurb: '…', gradient: '…' },
  build(w) {
    buildTextMap(w, arenaMap)                  // ← the whole ASCII map, placed
    // code-built additions live happily on top of the map:
    w.add({ at: v3(0, 6, 0), size: v3(4, 1, 4), color: colors.red, behavior: behaviors.spin(2) })
    w.label('FIGHT!', v3(0, 11, 0))
  },
  onTick(ctx, dt) { /* your scripted logic over the map */ },
})
```

Edit `arena.txt` and save → Vite hot-reloads the new layout instantly. Maps and code mix
freely because `buildTextMap` calls the same `w.add`/`w.coin`/… verbs your code does.

### Bridge 2 — a TypeScript game *starts from* a whole GameDoc (`buildGameFromDoc`)

Built something in the [Studio](./tutorials/studio-3d.md) and want full code power? Don't
rebuild it — turn the doc into a `GameDef` and **layer your code on top**:

```ts
import { buildGameFromDoc, defineGame } from '../sdk'
import myDoc from './my-world.blobcade.json'   // a doc you exported from the Studio

const base = buildGameFromDoc(myDoc)           // doc → GameDef (keeps its build/rules)

export default defineGame({
  ...base,                                     // keep the doc's world + rules
  meta: { ...base.meta, id: 'my-extended-game' },
  onTick(ctx, dt) {                            // add logic the doc couldn't express
    if (ctx.coins >= 10) ctx.hud.big('Coin frenzy!')
  },
})
```

You don't even have to write this by hand — see Bridge 4.

### Bridge 3 — inside one GameDoc, map + parts + rules + script all coexist

A single GameDoc can stack **all four** at once. The interpreter replays them in a fixed
order: `lighting → killY → textmap → voxel → parts → spawn`, then attaches the `rules`
system and (if present) the `script` system.

```jsonc
{
  "blobcade": "gamedoc", "v": 2,
  "meta": { "name": "Spawner Arena", "emoji": "👾" },
  "lighting": "night",
  "textmap": "...\n#S#...\n###\n",     // (1) ASCII layout
  "parts": [                            // (2) extra parts on top of the map
    { "kind": "part", "id": "throne", "at": [0,1,0], "size": [2,3,2], "color": "#ffd166" }
  ],
  "rules": [                            // (3) no-code logic (open the gate, toast)
    { "when": { "type": "touch", "part": "throne" },
      "do": [{ "type": "toast", "text": "Defend the throne!" }] }
  ],
  "vars": { "wave": 0 },
  "script": "..."                       // (4) sandboxed code: wave spawner using loops
}
```

- **Rules** handle the simple, declarative reactions (touch → toast/door/award).
- **Script** handles anything rules *can't* (wave size scaling with the round, loops,
  derived positions). A script gets **exactly the rule action vocabulary**, just
  programmable — see [Scripting](./tutorials/scripting.md#how-scripts-relate-to-rules-and-typescript).
- You don't need all four — most docs use only one or two.

### Bridge 4 — the Studio *exports* a GameDoc to TypeScript (`gameDocToTypeScript`)

This is the designed path from no-code → full-code. The 3D Studio's **⬇ TS** button runs
`gameDocToTypeScript(doc)` and downloads a real `.ts` file. Here's exactly what it
generates:

```ts
// Generated from Blobcade Studio. This is a trusted developer starter:
// edit it locally, review it like code, and bundle it as a curated/native game.

import { buildGameFromDoc, type GameDoc } from '../sdk'

const doc = { /* …your whole doc, inlined… */ } satisfies GameDoc

const game = buildGameFromDoc(doc, { allowScripts: true })
game.meta.id = 'spawner-arena'

export default game
```

Drop that file into `src/games/`, register it in `src/games/index.ts`, and you now have a
**trusted TypeScript game** that started life as a doc. From there, replace pieces of the
inlined doc with direct SDK calls (`w.add`, `behaviors.spin`, …) as your game outgrows the
data format. The doc was your scaffolding; now you have full code.

:::warning This bridge is one-way (a known gap)
Once geometry becomes imperative code, it can't be turned back into an editable doc — so
**visual editing in the Studio stops here.** To keep *some* editability, leave your map as
a separate text-map loaded via `buildTextMap` (Bridge 1) and only put scripted extras in
code. Closing this gap (world-capture + a live-doc world reference) is tracked as roadmap
item **STUDIO-009** in `docs/ROADMAP.md`.
:::

## Where each thing lives at runtime

| You author… | Becomes… | Runs… |
| --- | --- | --- |
| a `.ts` game | a `GameDef` (directly) | on the **main thread** |
| a doc's `textmap`/`parts`/`voxel` | `WorldBuilder` calls during `build()` | once, at world build |
| a doc's `rules` | a `RulesSystem` (a `GameSystem`) | on the main thread, each frame |
| a doc's `script` | a `ScriptSystem` owning a **Web Worker** | in a **sandboxed Worker** |

That's why a script can't reach `ctx.engine` (it's on the main thread; the worker only
gets validated JSON messages), but TypeScript `onTick` can.

## Which should I pick?

- **I want maximum power / I'm a developer / it's going in the repo** →
  [Pure TypeScript](./tutorials/typescript-game.md) (start from a map or a Studio export
  if you like — Bridges 1, 2, 4).
- **I want non-programmers to build & share by link, with simple logic** →
  [2D editor](./tutorials/visual-editor.md) or [3D Studio](./tutorials/studio-3d.md) +
  [rules](./tutorials/gamedoc-editor.md#rules-no-code-logic).
- **My shareable game needs logic rules can't express (spawners, scaling, math)** →
  add a [sandboxed script](./tutorials/scripting.md) to the doc.
- **I just want to draw a level fast** → [ASCII text map](./tutorials/text-maps.md).

## Next

Now that the landscape is clear, the [tutorials](./tutorials/typescript-game.md) go deep on each path.
