---
sidebar_position: 3
description: The normative spec for a GameDoc — every top-level field, part kind, rule, and size limit.
---

# GameDoc format spec

A **GameDoc** is one game as a single JSON document — Blobcade's interchange format. The
editor saves it, share links encode it, the Studio edits it, the backend stores it, and
`buildGameFromDoc()` turns it into a runnable game. Source of truth: `src/sdk/gamedoc.ts`
(schema + `validateGameDoc`), `src/sdk/rules.ts`, `src/sdk/interpret.ts`,
`src/sdk/codec.ts`. Where this doc and the code disagree, the code wins.

## Marker & version

```json
{ "blobcade": "gamedoc", "v": 2, "meta": { "name": "…" } }
```

`blobcade` (required, must be `"gamedoc"`), `v` (required integer; current `2`), and
`meta` are required; everything else is optional.

**Versioning contract:**
- integer `v`, linear `migrateGameDoc()` chain.
- unknown **fields** → warn and ignore (old clients degrade gracefully).
- unknown **version** → hard error ("made with a newer Blobcade… refresh/update to play").
- extensible content (materials, weapons, tiles, behaviors, sky presets, rule actions) is
  referenced by registry **name string**, never by index.

## Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `meta` | `GameDocMeta` | Required (see below). |
| `maxPlayers` | int 1–250 | Preferred room capacity (server clamps). |
| `camera` | `'orbit' \| 'fp'` | Third-person or first-person rig. |
| `physics` | `{gravity?, jumpVel?, walkSpeed?, fallDamage?}` | Partial objects fine. |
| `lighting` | string | Sky preset name (`noon`/`morning`/`goldenHour`/`night`/`space` or registered). |
| `killY` | number | Fall-out death plane. |
| `spawn` | `[x,y,z]` | Explicit spawn — **wins over** text-map `S` and voxel auto-spawn. |
| `rtReflections` | boolean | Enable SSR. |
| `combat` | `CombatConfig & {selfTeam?}` | Turns it into a combat game. |
| `services` | `{chat?, leaderboard?, store?}` | Per-game platform toggles + Blobcash store. |
| `weapons` | `WeaponDef[]` (≤12) | Custom weapons, namespaced at build. |
| `textmap` | string (≤64 KB) | ASCII level. |
| `parts` | `DocPart[]` (≤2000) | Explicit placed objects. |
| `voxel` | `{data?, seed?, size?, palette?}` | Voxel terrain. `size` int 16–256. |
| `rules` | `Rule[]` (≤200) | No-code logic. |
| `vars` | `Record<string, number>` (≤64) | Named counters (each gets a HUD chip). |
| `levels` | `GameDoc[]` (≤8) | Extra levels, depth 1. Sub-docs inherit selected parent fields. |
| `studio` | `GameDocStudio` | Editor-only metadata. Ignored by runtime. |
| `script` | string (≤64 KB) | Sandboxed creator script. Requires `v:2` + permission. |

### `meta`

`name` (1–48, required) · `id` (≤64) · `blurb` (≤140) · `emoji` (≤8) · `gradient` (≤200
CSS) · `genre` (≤24) · `author` (≤24) · `thumb` (≤80 KB generated data URL — never an
upload).

## DocPart kinds

`parts` is an array of `DocPart`. All vectors are `[x, y, z]`. `size`/`hitbox` components
must be `0 < n ≤ 600`. Every part may carry `id` and/or `tag`; only `kind:'part'` is
registered for rules (so only it is moveable/removable/openable).

| Kind | Required | Optional |
| --- | --- | --- |
| `part` | `at`, `size` | `color`, `material`, `rotY`, `collide`, `reflect`, `bounce`, `hitbox`, `behaviors[]` |
| `coin` · `healthPack` · `ammoSpawn` | `at` | — |
| `tree` · `cloud` | `at` | `scale` |
| `lava` · `water` · `winPad` · `checkpoint` · `bouncePad` | `at` | `size` (+`index`/`power`) |
| `weaponSpawn` | `at`, `weapon` | — |
| `spinnerHazard` | `at`, `radius` | `count`, `period` |
| `label` | `at`, `text` | `scale`, `color` |
| `light` | `at` | `color`, `intensity`, `range` |
| `vehicle` | `at`, `vehicle` | `speed` (1–80), `fuel` (1–600), `color` |
| `gravityZone` | `at`, `size`, `gravity` (0.05–3) | `color` |
| `ladder` | `at` | `size`, `color`, `rotY` |
| `button` | `at` | `size`, `color`, `rotY` |
| `door` | `at` | `size`, `color`, `material`, `rotY` |
| `mover` | `at`, `size`, `by` | `period`, `color`, `material`, `rotY` |
| `portal` | `at`, `target` | `label`, `size`, `color`, `rotY` |

`portal.target` grammar: `g:<id>` · `draft:<key>` · `level:<n>` · `home`. Unknown `kind`
values are skipped with a warning (forward-compat). `rotY` is visual-only yaw (collision
stays axis-aligned).

## Rules

A flat `when / if / do` record:

```json
{ "when": { "type": "touch", "part": "btn" },
  "if":   [{ "var": "keys", "op": "gte", "value": 1 }],
  "do":   [{ "type": "openDoor", "part": "gate" }],
  "once": true }
```

### Triggers (`when`)

`start` · `touch` (`part` required) · `timer` (`after?`/`every?`) · `coin` · `kill` ·
`checkpoint` · `hurt` · `enterRegion` (`min`/`max` AABB, edge-triggered) · `varReaches`
(`var`/`gte`, edge-triggered) · `event` (`name`).

### Conditions (`if`)

`{ var, op, value }`, `op ∈ eq|ne|gt|gte|lt|lte`. Unset var reads `0`. All must pass (AND).

### Actions (`do`, max 16)

`toast` · `big` · `celebrate` · `win` · `kill` · `teleport` · `award` · `movePart` ·
`removePart` · `openDoor` · `spawnPart` · `setVar` · `addVar` · `givePoints` · `restart` ·
`sound` · `emit` · `goTo`. Any action may set `forEveryone: true` (replicates via the
relay). `part` is an id **or** tag and may match many parts.

**Sound whitelist:** `coin` · `win` · `jump` · `death` · `checkpoint` · `bounce` ·
`splash` · `explosion` · `capture` · `chat`.

**Reserved event prefixes:** `combat:` · `self:` · `player:` · `game:` · `net:` ·
`platform:` — rules may listen but never emit.

### `vars` & HUD chips

Each **declared** var key gets an auto HUD chip (`name: value`), kept live by
`setVar`/`addVar`. Undeclared vars work as state but get no chip.

### `once`

`once: true` fires a rule at most once per session — the single fire is "spent" only when
the `if` conditions pass (a `once` rule still waiting on its conditions keeps waiting).

## Size limits

These are part of the format (the `GAMEDOC_LIMITS` table — docs live forever in URLs,
files and DB), enforced as errors:

| Limit | Value | Limit | Value |
| --- | --- | --- | --- |
| whole JSON | 256 KB | `textmap` | 64 KB |
| `voxelData` | 2 MB | `parts` | 2000 |
| `rules` | 200 | `actionsPerRule` | 16 |
| `vars` | 64 | `weapons` | 12 |
| `script` | 64 KB | `studio.settings` | 16 KB |
| `meta.name` | 48 | `meta.blurb` | 140 |
| `meta.author` | 24 | `label.text` | 80 |
| ref (id/tag/var/color) | 40 | `storeItems` | 8 |
| `levels` | 8 | `maxPlayers` | 250 |
| part/hitbox `size` | 0 < n ≤ 600 | `voxel.size` | int 16–256 |

## Share links

`#/play/d/<payload>`. Pipeline (`codec.ts`, native `CompressionStream`):

```
GameDoc ──JSON.stringify──▶ deflate-raw ──▶ base64url ──▶ {payload}
```

`SHARE_LINK_LIMIT = 8 KB` is the largest payload that travels reliably through chat apps
(a guideline for choosing delivery, not a hard parse cap — that's the 256 KB JSON limit).
Fallback chain: URL (≤~8 KB) → `.blobcade.json` file → hosted `meta.id`. `hashGameDoc()`
is a stable identity for multiplayer room keys, independent of the share encoding.

## Build order

`buildGameFromDoc()` validates → migrates → constructs a `GameDef` whose `build(w)` replays
sections **in fixed order**: `lighting` → `killY` → `textmap` → `voxel` → `parts` →
`spawn` (last, so `doc.spawn` overrides text-map `S`). `maxPlayers`/`physics`/`combat`/
`services`/`weapons`/`levels`/`studio`/`script` aren't placed — they're copied into the
`GameDef`, weapons registered, the level resolved, and rules/script systems created.

## Deliberate limits

- **No raw TypeScript in GameDocs.** The `script` field is plain sandboxed JS (see
  [Scripting](../tutorials/scripting.md)). Full TS games are trusted-mode only.
- **No binary assets.** Everything is procedural; `meta.thumb` is a generated data URL.
- **First-party match logic stays in TypeScript.** Complex authoritative modes
  (Squadfall-class) ship as first-party `GameSystem`s, not as rules.
- **Limited addressability.** Only `kind:'part'` objects are registered and thus
  moveable/removable/openable by rules.
