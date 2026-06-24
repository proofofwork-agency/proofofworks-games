---
sidebar_position: 5
description: The GameDoc — one game as a single portable JSON document. The community-safe, no-code creation path.
---

# GameDoc editor (no-code / data)

A **GameDoc** is one game expressed as a single JSON document. It is Blobcade's
interchange format: the [2D editor](./visual-editor.md) and [3D Studio](./studio-3d.md)
write it, share links encode it, the backend stores it, and `buildGameFromDoc()` turns it
into a runnable game. This page is the creator-facing tour; the [full spec](../reference/gamedoc-spec.md)
has every field and limit.

## Why GameDoc?

A GameDoc carries everything needed to reconstruct a game: metadata, world geometry (text
map, voxel terrain, or explicit parts), camera/physics/lighting tuning, combat config,
no-code `rules`, `vars`, and an optional sandboxed `script`. Three design properties:

- **Game as data.** A doc replays through the *same* `WorldBuilder` verbs a TypeScript
  game calls, so doc games and code games are behavior-identical — no separate "data engine".
- **Code is opt-in.** A doc with no `script` field is **inert data**: logic is declarative
  rules. A malicious doc wastes CPU but never runs code — which is what lets share links
  and community uploads open safely.
- **One file, portable.** The whole game round-trips through a URL hash, a
  `.blobcade.json` download, or a DB row.

## The three world sections (pick any mix)

A doc builds its world by replaying sections **in a fixed order**:

```
1. lighting   2. killY   3. textmap   4. voxel   5. parts   6. spawn (last → wins)
```

- **`textmap`** — an [ASCII level](./text-maps.md) (a single string, cap 64 KB).
- **`voxel`** — voxel terrain: a saved `data` string, or procedural `seed`/`size`.
- **`parts`** — an array of explicit placed objects (see below).

You can mix them: a text map for the layout, plus a few `parts` for scripted elements.

:::tip The bigger picture
A GameDoc is **world + logic**. The world is the three sections above; the logic is
[`rules`](#rules-no-code-logic) (no-code) and an optional [`script`](./scripting.md)
(sandboxed code). All four stack in one doc. See [Creation paths](../creation-paths.md)
for a worked example mixing all of them.
:::

## DocPart kinds

`parts` is an array of `DocPart`. All vectors are `[x, y, z]`. Every part may carry an
optional `id` and/or `tag`; only `kind: 'part'` parts are registered for rules.

| Kind | Required | Notes |
| --- | --- | --- |
| `part` | `at`, `size` | The general rounded-box. `material`, `color`, `rotY`, `collide`, `reflect`, `bounce`, `behaviors[]`. **Only addressable/moveable kind.** |
| `coin` · `healthPack` · `ammoSpawn` | `at` | Pickups. |
| `tree` · `cloud` | `at` (+`scale`) | Decoration. |
| `lava` · `water` · `winPad` · `checkpoint` · `bouncePad` | `at` (+`size`) | Hazards/pads. |
| `weaponSpawn` | `at`, `weapon` | `weapon` = a weapon-id string. |
| `spinnerHazard` | `at`, `radius` (+`count`, `period`) | Rotating blades. |
| `label` | `at`, `text` (+`scale`, `color`) | Floating text (≤80 chars). |
| `light` | `at` (+`color`, `intensity`, `range`) | Point light. |
| `vehicle` | `at`, `vehicle` (+`speed`, `fuel`, `color`) | `car`/`jetpack`/`boat`/`plane`. |
| `gravityZone` | `at`, `size`, `gravity` | Non-solid gravity volume (0.05–3). |
| `ladder` · `button` · `door` · `mover` · `portal` | see spec | Interactive prefabs. |

## Rules (no-code logic)

A `Rule` is a flat `when / if / do` record — one trigger, an AND list of `var op value`
conditions, an ordered action list:

```json
{
  "when": { "type": "touch", "part": "btn" },
  "if":   [{ "var": "keys", "op": "gte", "value": 1 }],
  "do":   [{ "type": "openDoor", "part": "gate" }],
  "once": true
}
```

**Triggers** (`when`): `start` · `touch` (needs `part`) · `timer` (`after`/`every`) · `coin` ·
`kill` · `checkpoint` · `hurt` · `enterRegion` (`min`/`max` AABB, edge-triggered) ·
`varReaches` (`var`/`gte`, edge-triggered) · `event` (`name`).

**Conditions** (`if`): `{ var, op, value }`, `op ∈ eq|ne|gt|gte|lt|lte`. Unset vars read `0`.

**Actions** (`do`): `toast` · `big` · `celebrate` · `win` · `kill` · `teleport` · `award` ·
`movePart` · `removePart` · `openDoor` · `spawnPart` · `setVar` · `addVar` · `givePoints` ·
`restart` · `sound` · `emit` · `goTo`. Any action may set `forEveryone: true` to replicate
through the multiplayer relay.

`part` in an action is an id **or** tag and may match many parts; all matches are affected.
`once: true` makes a rule fire at most once per session (only "spent" after its `if` pass).

### `vars` and HUD chips

`vars` declares named integer counters. Every **declared** var gets an automatic live HUD
chip (`name: value`). Conditions and `varReaches` read vars the same way.

## A worked example

A tiny obby: a floor, a coin, a lava pit, a button that opens a tagged door. Valid per the
schema:

```json
{
  "blobcade": "gamedoc",
  "v": 2,
  "meta": { "name": "Button Bridge", "blurb": "Hit the button, cross the gap.", "emoji": "🚪", "genre": "Obby" },
  "camera": "orbit",
  "lighting": "goldenHour",
  "killY": -12,
  "spawn": [0, 3, 8],
  "parts": [
    { "kind": "part", "at": [0, 0, 6], "size": [6, 1, 6], "material": "stone" },
    { "kind": "part", "at": [0, 0, -6], "size": [6, 1, 6], "material": "grass" },
    { "kind": "coin", "at": [0, 2, 6] },
    { "kind": "lava", "at": [0, -0.5, 0], "size": [6, 1, 6] },
    { "kind": "part", "id": "btn", "at": [0, 1, 6], "size": [1.5, 1, 1.5], "color": "#ff5252" },
    { "kind": "part", "tag": "gate", "at": [0, 1.5, 0], "size": [6, 3, 1], "color": "#8a8a8a" }
  ],
  "rules": [
    {
      "when": { "type": "touch", "part": "btn" },
      "do": [
        { "type": "openDoor", "part": "gate", "seconds": 0.6 },
        { "type": "toast", "text": "Bridge open!" },
        { "type": "sound", "name": "checkpoint" }
      ],
      "once": true
    }
  ],
  "vars": { "buttons": 0 }
}
```

You don't usually hand-write JSON — you produce this with the [2D editor](./visual-editor.md)
or [3D Studio](./studio-3d.md). But knowing the shape helps you read share links, debug
validation, and write rules deliberately.

## How a doc is shared & built

- **Share link** — `#/play/d/<payload>`. Encoding pipeline (`src/sdk/codec.ts`,
  zero-dependency, native `CompressionStream`): `JSON.stringify → deflate-raw → base64url`.
  Decode always runs through `validateGameDoc()` first. `hashGameDoc()` gives a stable
  identity used for multiplayer room keys.
- **`.blobcade.json`** — download/attach when the doc is too big or fragile for a link.
- **Hosted id** — publish and share by `meta.id` for large or canonical games.

`buildGameFromDoc()` validates → migrates → constructs a `GameDef`, registers any custom
weapons (namespaced by game id), resolves the selected `level`, and creates rules/script
systems when needed. Combat references (`combat.weapons`, `weaponSpawn`) resolve weapon
ids against the registry at build time.

## Versioning (forward/backward tolerant)

- Integer `v` (current = `2`) with a linear `migrateGameDoc()` chain.
- **Unknown fields** → warn and ignore (old clients degrade gracefully).
- **Unknown version** → hard error ("made with a newer Blobcade…").
- Extensible content (materials, weapons, tiles, behaviors, sky presets, rule actions) is
  referenced by registry **name string**, never by index — so adding content never
  renumbers existing docs.

## Limits (part of the format)

Docs live forever in URLs, files and the DB, so size caps are enforced, not soft hints.
Headline limits (see the [full spec](../reference/gamedoc-spec.md#size-limits)): whole
JSON ≤ 256 KB · `textmap` ≤ 64 KB · `voxelData` ≤ 2 MB · `parts` ≤ 2000 · `rules` ≤ 200 ·
`actionsPerRule` ≤ 16 · `vars` ≤ 64 · `weapons` ≤ 12 · `script` ≤ 64 KB. Share links target
a ~8 KB guideline for chat-app reliability (the hard cap is the 256 KB JSON limit).

## Next

- Hit the rule ceiling? Add a [sandboxed script](./scripting.md).
- Want full power? Bridge into [TypeScript](./typescript-game.md) via the Studio's
  **⬇ TS** export.
