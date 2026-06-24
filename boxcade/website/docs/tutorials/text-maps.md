---
sidebar_position: 2
description: Draw a whole level in a plain text file — one character per tile, no code. The 2D ASCII map format.
---

# ASCII text maps (2D)

Levels can be **ASCII art**. One character = one tile (default 2×2 m), rows run
north→south, the map is centered on the origin, and `---` starts the next floor up. This
is Blobcade's fastest way to lay out a level — and the visual editor reads/writes this
exact format, so the two are interchangeable.

:::note Where this fits
A text map is **just geometry** — it's the world, no logic. It can live two places:
(1) inside a **GameDoc's `textmap` field** (the no-code/share-link path), or (2) loaded by
a **TypeScript game** via `buildTextMap(w, mapStr)`. Both use the exact same string.
See [Creation paths](../creation-paths.md).
:::

## A complete playable map

```text
@lighting goldenHour

.........333..........
..C....1..3W3..1....C..
.######.##333##.######.
.#....#.#.....#.#....#.
.#.S..#L#..K..#L#..B.#.
.#....#.#.....#.#....#.
.######.#######.######.
```

Save it as a `.txt` file, wire it into a game (below), and play. Edit the file, save, and
Vite hot-reloads you into the new layout in under a second.

## Tile legend

| Char | Meaning | Char | Meaning |
| --- | --- | --- | --- |
| `#` | stone floor | `G` | grass |
| `O` | planks | `X` | brick |
| `I` | ice (slippery) | `N` | glowing neon |
| `M` | metal deck (mirror-shiny) | `1`–`9` | stone column, that tall |
| `L` | lava (kills) | `B` | bounce pad |
| `C` | tile + coin | `T` | tile + tree |
| `K` | checkpoint (auto-numbered) | `S` | spawn |
| `W` | golden win pad | `H` | health pack (+35 hp) |
| `A` | ammo crate (restocks weapons) | `D` | door (rule-openable, tag `door`) |
| `P` | pressure plate (tag `button`) | `F` / `f` | red / blue flag stand (CTF) |
| `r` / `b` | red / blue team spawn | `.` (or space/`_`) | void (falling = death) |

:::tip Custom tiles
Claim your own character with `registerTile('J', (t) => { t.tile(1, '#223', 'stone'); … })`.
Registered tiles work in every text map **and** the visual editor's "Apply text" path.
:::

## Directives

Directives are `@name value` lines that can appear anywhere in the file:

| Directive | Meaning |
| --- | --- |
| `@lighting goldenHour` | `noon` \| `morning` \| `goldenHour` \| `night` \| `space` (or a registered preset) |
| `@cell 2` | tile size in meters |
| `@layerstep 4` | height added per `---` layer |
| `@killy -18` | fall-death height |
| `@gravity 46` | gravity strength (m/s²) |
| `@jump 14` | jump velocity |
| `@speed 8` | walk speed |

Lines starting with `//` are comments and ignored. Use `@gravity`/`@jump`/`@speed` to
tune movement per map — Facing Towers runs at low gravity for that floaty space feel.

## Layers (stacking floors)

```
---          next floor, +layerstep higher
--- +6       next floor, +6 higher (custom step)
```

Everything between two `---` is one flat floor. The first layer is at height 0; each
`---` lifts the base by `@layerstep` (default 4) or by the `+N` you write on the line.

## Wiring a map into a game

It takes **three lines** of TypeScript to play a text map. This is the whole of
*Castle Run*:

```ts
// src/games/castle-run.ts
import { defineGame, buildTextMap, v3, type TextMapResult } from '../sdk'
import castleMap from '../maps/castle.txt?raw'   // ?raw = import as a string

let map: TextMapResult | null = null

export default defineGame({
  meta: { id: 'castle-run', name: 'Castle Run', emoji: '🏰', /* … */ },
  camera: 'orbit',
  build(w) {
    map = buildTextMap(w, castleMap)             // builds the level
    // text + code mix freely — add decorations the SDK way:
    w.label('🏰 CASTLE RUN', v3(0, 17, -10), 1.4)
  },
  onStart(ctx) { ctx.hud.toast('Cross the moat, climb the wall stairs!') },
  onTick(ctx) { ctx.hud.set('coins', `🪙 ${ctx.coins}/${map?.coins ?? 0}`) },
})
```

The `?raw` suffix is Vite's way to import a file's contents as a string — and it
**hot-reloads** when the `.txt` changes. `buildTextMap()` returns tallies (coins,
checkpoints, spawn, CTF markers) you can use in your HUD/logic.

:::note Text and code mix freely
A map doesn't lock you out of the SDK. Decorations, moving platforms, scripted logic and
SDK-built parts all work on top of the text map. `buildTextMap()` just calls the same
`WorldBuilder` verbs your code uses.
:::

## Workflow

1. `npm run dev`, open your map-driven game.
2. Edit the `.txt` file in any editor and **save**.
3. Vite hot-reloads you into the new layout in under a second.

See `src/maps/castle.txt` + `src/games/castle-run.ts` and `src/maps/facing-towers.txt` +
`src/games/facing-towers.ts` for real, complete examples.

## Direct text in a GameDoc

Text maps also live inside a **GameDoc** as the `textmap` field (a single string, cap
64 KB). The visual editor (next page) and the Studio write this field; share links and
drafts carry it. So you can author in ASCII, refine in the visual painter, or paste a map
straight into the editor's textarea — all three edit the same string.

## Next

- Prefer to paint tiles with a mouse? → [2D visual editor](./visual-editor.md)
- Prefer to place 3D parts directly? → [3D Studio](./studio-3d.md)
