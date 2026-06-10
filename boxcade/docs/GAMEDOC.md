# GameDoc format

The normative spec for a **GameDoc**: one Boxcade game expressed as a single
JSON document. This is the platform's interchange format — the editor saves it,
share links encode it, the studio edits it, the backend stores it, and
`buildGameFromDoc()` turns it into a runnable `GameDef`. The source of truth is
`src/sdk/gamedoc.ts` (schema + `validateGameDoc`), `src/sdk/rules.ts` (logic),
`src/sdk/interpret.ts` (build), and `src/sdk/codec.ts` (wire format). Where this
document and the code disagree, the code wins — file a doc fix.

## 1. What a GameDoc is

A GameDoc is a plain JSON object marked `{ "boxcade": "gamedoc", "v": 1, … }`.
It carries everything needed to reconstruct a game: metadata, world geometry
(text map, voxel terrain, or explicit parts), camera/physics/lighting tuning,
combat config, no-code `rules`, and `vars`. Nothing else is needed to play it.

Design goals:

- **Game as data.** A doc is replayed through the same `WorldBuilder` verbs a
  hand-written game calls (`interpret.ts`), so doc games and code games are
  behavior-identical by construction — there is no separate "data engine".
- **No user code.** A doc is inert data. Logic is expressed as declarative
  `when / if / do` rules (§5), never as scripts. A malicious doc can waste your
  CPU but cannot execute arbitrary code. This is the security boundary that lets
  share links and community uploads be opened safely.
- **One file, portable.** The whole game round-trips through a URL hash, a
  `.boxcade.json` download, or a DB row. Size caps (§6) are part of the format
  because docs live forever in those places.
- **Forward/backward tolerant.** See the versioning contract (§2).

## 2. Versioning contract

Quoted verbatim from the `gamedoc.ts` header — decided once, kept forever:

> - integer `v`, linear `migrateGameDoc()` chain
> - unknown FIELDS → warn and ignore (old clients degrade gracefully)
> - unknown VERSION → hard error ("made with a newer Boxcade")
> - extensible content (materials, weapons, tiles, behaviors, sky presets,
>   rule actions) is referenced by registry NAME STRINGS, never by index.

Concretely, `validateGameDoc()`:

- requires integer `v`; `v > GAMEDOC_VERSION` is a hard **error**
  (`"made with a newer Boxcade … refresh / update to play it"`); `v < 1` errors.
- collects unknown top-level keys as **warnings** (`unknown field 'x' ignored`)
  and still builds. Unknown `DocPart.kind`, rule trigger types, and rule action
  types are likewise **skipped with a warning**, not fatal.
- `migrateGameDoc()` is a linear chain: `v1` is current and the chain is a
  no-op. When `v2` lands, add a `1 → 2` step and bump `GAMEDOC_VERSION`; the
  validator has already rejected anything newer than the running build.

The name-strings rule is load-bearing: materials, weapons, tiles, sky presets,
behaviors and rule actions are all looked up in a **registry by name** at
build/spawn time, so adding content never renumbers existing docs.

## 3. Top-level fields

`GameDoc` (see `gamedoc.ts`). `boxcade`, `v`, and `meta` are required; the rest
are optional.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `boxcade` | `'gamedoc'` | — | Required marker. Must equal `"gamedoc"`. |
| `v` | integer | — | Format version. Current = `1` (`GAMEDOC_VERSION`). |
| `meta` | `GameDocMeta` | — | Required. See §3.1. |
| `camera` | `'orbit' \| 'fp'` | engine default | Orbit (third-person) or first-person rig. |
| `physics` | `{ gravity?, jumpVel?, walkSpeed? }` | engine defaults | All members are numbers; partial objects are fine. |
| `lighting` | string | none | Sky **preset name** (built-in or registered), e.g. `noon`, `goldenHour`, `night`, `space`. Validated as a string only; unknown names fall back at build time. |
| `killY` | number | none | Y below which the player dies (fall-out plane). |
| `spawn` | `[x,y,z]` | from world | Explicit spawn point. **Wins over** text-map `S` and voxel auto-spawn (§8). |
| `rtReflections` | boolean | engine default | Enable real-time reflections (SSR) for this game. |
| `combat` | `CombatConfig & { selfTeam?: string }` | none | Turns the game into a combat game. See §3.2. |
| `textmap` | string | none | ASCII level (the editor's native format). See §3.3 / `textmap.ts`. |
| `parts` | `DocPart[]` | none | Explicit placed objects. See §4. |
| `voxel` | `{ data?, seed?, size?, palette? }` | none | Voxel terrain: saved `data` string, or procedural `seed`/`size`/`palette`. `size` is an integer 16–256; `palette` is an array of integer block ids. |
| `rules` | `Rule[]` | none | No-code logic. See §5. |
| `vars` | `Record<string, number>` | none | Named counters; each declared var gets an auto HUD chip (§5.4). |

### 3.1 `meta`

| Field | Type | Limit | Notes |
| --- | --- | --- | --- |
| `name` | string | 1–48 | **Required**, non-empty after trim. |
| `id` | string | ≤64 | Assigned on publish/import; drafts may omit it (then derived via `slugifyName`). |
| `blurb` | string | ≤140 | Short description. |
| `emoji` | string | ≤8 | Portal-card emoji. |
| `gradient` | string | ≤200 | CSS background for the portal card. |
| `genre` | string | ≤24 | Free-text genre tag. |
| `author` | string | ≤24 | Display name. |
| `thumb` | string | ≤80 KB | Generated thumbnail **data URL** — never an uploaded asset. |

Build-time defaults (`interpret.ts`): missing `blurb` → "A community-made
Boxcade game.", `emoji` → 🎮, `gradient` → the house purple/blue, `genre` →
"Community", `id` → `slugifyName(name)`.

### 3.2 `combat`

`CombatConfig` (`engine/combat.ts`) plus a doc-only `selfTeam`:

| Field | Type | Notes |
| --- | --- | --- |
| `health` | number | Starting/max HP. |
| `respawnSeconds` | number | Respawn delay. |
| `weapons` | `Array<string \| WeaponDef>` | The whole arsenal: weapon **ids** (registry names) or full custom defs. |
| `startWeapons` | `string[]` | Ids held at spawn (default: the whole arsenal). |
| `infiniteAmmo` | boolean | Classic mode — nothing consumes ammo. |
| `selfTeam` | string | Team the local player joins. |

`validateGameDoc` only checks that `weapons`/`startWeapons` are arrays and
`health` is a number; weapon ids are resolved against the weapon registry at
build time. Weapon-id strings also bind `weaponSpawn` parts and `weaponSpawn`
text-map tiles (§8).

### 3.3 `textmap`

An ASCII level drawn one character per tile (default 2×2 m), centered on the
origin, with `---` floor separators and `@directive` lines. The full tile legend
and directives live in the header comment of `src/sdk/textmap.ts`; a brief
sketch: `#`/`G`/`O`/`X` are floor materials, `1`–`9` are columns N blocks tall,
`L` lava, `B` bounce pad, `C` coin tile, `T` tree tile, `K` checkpoint, `S`
spawn, `W` win pad, `H`/`A` health/ammo, `F`/`f`/`r`/`b` CTF markers; directives
include `@lighting`, `@cell`, `@layerstep`, `@killy`, `@gravity`, `@jump`,
`@speed`. The visual Map Editor reads and writes this exact format. Stored as a
single string in the doc (cap: 64 KB).

## 4. DocPart kinds

`parts` is an array of `DocPart`. **All vectors are `[x, y, z]`** (`DocV3`).
Every part may carry an optional `id` and/or `tag`; only `kind: 'part'` parts
are registered for rules, and only those are addressable/moveable by rule
actions in v1 (§5.3). A `tag` may be shared by many parts — a rule that targets
it affects all of them.

| Kind | Required | Optional | Notes |
| --- | --- | --- | --- |
| `part` | `at`, `size` | `color`, `material`, `rotY`, `collide`, `reflect`, `bounce`, `behaviors[]` | The general rounded-box primitive. `size` components must be `0 < n ≤ 600`. `material` is a registry name. `behaviors` are `BehaviorDef[]` (each needs a `type` string; resolved via `behaviorFromDef`). **The only addressable/moveable kind.** |
| `coin` | `at` | — | Collectible coin. |
| `healthPack` | `at` | — | +HP pickup (combat games). |
| `ammoSpawn` | `at` | — | Ammo crate (combat games). |
| `tree` | `at` | `scale` | Decorative tree. |
| `cloud` | `at` | `scale` | Decorative cloud. |
| `lava` | `at` | `size` | Kill volume. `size` default `[2,1,2]`. |
| `winPad` | `at` | `size` | Golden win pad (confetti + fanfare). |
| `checkpoint` | `at` | `index`, `size` | Respawn checkpoint. `index` default `1`. |
| `bouncePad` | `at` | `power`, `size` | Launch pad. |
| `weaponSpawn` | `at`, `weapon` | — | `weapon` is a required weapon-id string. |
| `spinnerHazard` | `at`, `radius` | `count`, `period` | Rotating blade hazard. |
| `label` | `at`, `text` | `scale`, `color` | Floating text (≤80 chars). |
| `light` | `at` | `color`, `intensity`, `range` | Point light. |

Unknown `kind` values are skipped with a warning (forward-compat). Note the
field-name split for sized hazards/pads: `lava`/`winPad`/`checkpoint`/
`bouncePad` use an **optional** `size`, while `part` **requires** `size`.

## 5. Rules (no-code logic)

A `Rule` (`rules.ts`) is a flat `when / if / do` record:

```json
{ "when": { "type": "touch", "part": "btn" },
  "if":   [{ "var": "keys", "op": "gte", "value": 1 }],
  "do":   [{ "type": "openDoor", "part": "gate" }],
  "once": true }
```

`createRulesSystem()` compiles all of a doc's rules into one `GameSystem`.
Triggers ride the engine event bus and part touches; conditions read `vars`;
actions call the same `GameContext` APIs hand-written games use.

### 5.1 Triggers (`when`)

`RULE_TRIGGER_TYPES = start, touch, timer, coin, kill, enterRegion, varReaches, event`.

| `type` | Fields | Fires when |
| --- | --- | --- |
| `start` | — | Once at world build (during system `init`). |
| `touch` | `part` (id/tag, **required**) | Player touches a part with that id/tag. Wiring is auto-installed only for parts a touch rule targets. |
| `timer` | `after?`, `every?` | First fire at `t = after ?? every ?? 1` s. With `every`, repeats every `every` s; otherwise one-shot. |
| `coin` | — | Player collects a coin (`player:coin`). |
| `kill` | — | A combat kill happens (`combat:kill`). |
| `enterRegion` | `min`, `max` (both `[x,y,z]`, **required**) | Player enters the AABB. **Edge-triggered**: fires on entry; leaving re-arms it. |
| `varReaches` | `var` (string), `gte` (number) — both **required** | A var rises to `≥ gte`. **Edge-triggered**: fires once on crossing; dropping back below `gte` re-arms it. May fire at start if the initial value already satisfies it. |
| `event` | `name` (string, **required**) | A named engine/rule event fires (see `emit`). |

### 5.2 Conditions (`if`)

Optional array of `RuleCondition`. Every condition must pass (logical AND) for
the `do` block to run. Shape: `{ var: string, op, value: number }`, where `op ∈
eq | ne | gt | gte | lt | lte`. An unset var reads as `0`.

### 5.3 Actions (`do`)

Non-empty array, max `actionsPerRule` (16). `RULE_ACTION_TYPES = toast, big,
celebrate, win, kill, teleport, award, movePart, removePart, openDoor,
spawnPart, setVar, addVar, sound, emit`.

| `type` | Fields | Effect |
| --- | --- | --- |
| `toast` | `text` (**required**) | HUD toast. |
| `big` | `text` (**required**) | Big centered banner. |
| `celebrate` | `text?` | Confetti + message. |
| `win` | `text?` | Celebrate (default `🏆 YOU WIN!`) and award 25 Bolts. |
| `kill` | — | Kill the player. |
| `teleport` | `to` (`[x,y,z]`, **required**) | Move player to a point. |
| `award` | `amount?` | Award coins (default `1`). |
| `movePart` | `part`, then `to` **or** `by` (one **required**), `seconds?` | Tween every part matching `part` to an absolute `to` or by a delta `by` over `seconds` (instant if `0`/omitted). |
| `removePart` | `part` (**required**) | Despawn matching parts (also drops them from the registry). |
| `openDoor` | `part` (**required**), `seconds?` | Slide matching parts down by `size.y + 0.4` (collision follows); default `0.9` s; plays a place sound. |
| `spawnPart` | `part` (a full `DocPart` with `kind:'part'`, **required**) | Spawn a new part at runtime; it is registered (so its `id`/`tag` work). |
| `setVar` | `var`, `value` (both **required**) | Set a counter. |
| `addVar` | `var` (**required**), `value?` | Add to a counter (default `+1`). |
| `sound` | `name` (**required**) | Play a synth sound — only from the whitelist below; others are ignored. |
| `emit` | `name` (**required**) | Emit a custom event. Names starting with a reserved prefix are refused with a console warning. |

`part` in an action is an id **or** a tag and may match many parts; all matches
are affected. Only `kind:'part'` parts are ever registered, so only they can be
moved/removed/opened — pointing an action at a `coin`/`lava`/etc. id is a no-op.

**Sound whitelist** (`RULE_SOUNDS`): `coin`, `win`, `jump`, `death`,
`checkpoint`, `bounce`, `splash`, `explosion`, `capture`, `chat`.

**Reserved event prefixes** (`RESERVED_EVENT_PREFIXES`): `combat:`, `self:`,
`player:`, `game:`, `net:`. Rules may **listen** to these via an `event` trigger
but may **not** `emit` them (the engine owns them); attempts are dropped.

### 5.4 `vars` and HUD chips

`vars` declares named integer/number counters with starting values. Every
**declared** var (a key present in `doc.vars`) gets an automatic HUD chip
rendered as `name: value` and kept live as `setVar`/`addVar` change it. Vars
created only by `setVar`/`addVar` (never declared in `doc.vars`) still work as
logic state but get **no** chip. Conditions and `varReaches` read vars the same
way; an undeclared/unset var reads `0`.

### 5.5 `once`

`once: true` makes a rule fire at most once per session. The single fire is
"spent" only when the rule actually runs — i.e. after its `if` conditions pass —
so a `once` rule whose conditions are not yet met keeps waiting rather than
burning its one shot. (Rules without `once` re-fire on every matching trigger.)

## 6. Size limits

From `GAMEDOC_LIMITS`. These are part of the format, not soft UI hints, because
docs live forever in URLs, files and the DB. Exceeding most of them is a
validation **error**.

| Limit | Value | Applies to |
| --- | --- | --- |
| `json` | 256 KB | Whole document (string form). |
| `textmap` | 64 KB | `textmap` string length. |
| `voxelData` | 2 MB | `voxel.data` string length. |
| `parts` | 2000 | `parts` array length. |
| `rules` | 200 | `rules` array length. |
| `actionsPerRule` | 16 | `do` array length per rule. |
| `vars` | 64 | Number of `vars` keys. |
| `name` | 48 | `meta.name`. |
| `blurb` | 140 | `meta.blurb`. |
| `author` | 24 | `meta.author`. |
| `labelText` | 80 | `label` part `text`. |
| `ref` | 40 | Part `id`/`tag`, var names. |

Additional structural bounds: `part` `size` components `0 < n ≤ 600`;
`voxel.size` integer `16–256`; `meta.id` ≤64; `meta.emoji` ≤8;
`meta.gradient` ≤200; `meta.genre` ≤24; `meta.thumb` ≤80 KB.

## 7. Share links

A GameDoc travels in a URL hash route: **`#/play/d/{payload}`**.

Encoding pipeline (`codec.ts`, zero-dependency, native `CompressionStream`):

```
GameDoc  ──JSON.stringify──▶  deflate-raw  ──▶  base64url  ──▶  {payload}
```

`decodeGameDoc()` reverses it (base64url → inflate → `JSON.parse`); always run
the result through `validateGameDoc()` before building. `hashGameDoc()` is a
stable short hash of the canonical JSON used as **doc identity** (e.g. multiplayer
room keys), independent of the share encoding.

**8 KB guideline.** `SHARE_LINK_LIMIT = 8 * 1024` is the largest payload that
travels reliably through chat apps and proxies. It is a guideline for choosing a
delivery method, not a hard parse cap (the hard cap is the 256 KB `json` limit).
The fallback chain, longest-link-first:

1. **URL** — `#/play/d/{payload}` when the payload ≤ ~8 KB.
2. **`.boxcade.json` file** — download/attach the raw doc when it is too big or
   too fragile for a link.
3. **Hosted id** — publish and share by `meta.id` for large or canonical games.

## 8. Build order and interplay

`buildGameFromDoc()` validates → migrates → constructs a `GameDef`, whose
`build(w)` replays sections **in this fixed order** (`interpret.ts`):

1. `lighting` → `w.lighting(name)`
2. `killY` → `w.killY(y)`
3. `textmap` → `buildTextMap(w, …)`
4. `voxel` → `w.voxelIsland(…)`
5. `parts` → each `DocPart` via the matching `WorldBuilder` verb
6. `spawn` → `w.spawn(…)` **last**, so it overrides any earlier spawn

**Spawn precedence (last wins).** A text-map `S` tile and voxel auto-spawn set a
spawn during steps 3–4; an explicit `doc.spawn` runs in step 6 and therefore
wins. If you set `doc.spawn`, that is where the player appears regardless of `S`.

**Rules system.** A `RulesSystem` is created only when the doc has rules or any
`vars`. Touch wiring is installed lazily: a `kind:'part'` part gets an `onTouch`
hook only when some `touch` rule targets its `id`/`tag`. Parts with neither
`id` nor `tag` are placed but not registered, so rules can never address them.

**Combat references.** `combat.weapons` / `startWeapons` and `weaponSpawn`
parts/tiles refer to weapons by **id string**; the ids must exist in the weapon
registry at build time (built-ins or ones a first-party game registered).

## 9. Worked example

A tiny obby: a floor, a coin, a lava pit, a button that (on touch) opens a
tagged door and toasts. Valid per `gamedoc.ts` and `rules.ts`.

```json
{
  "boxcade": "gamedoc",
  "v": 1,
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

## 10. Not in v1 (deliberately)

- **No user code / scripts.** Logic is rules-only. A future, sandboxed `script`
  section may be added behind the same forward-compat rules — it does not exist
  yet, and `rules` is the only programmable surface today. The "no executable
  data" property is the reason docs can be opened from untrusted links.
- **No binary assets.** Everything is procedural. `meta.thumb` is a generated
  data URL, not an upload; there are no image/audio/model blobs in a doc.
- **First-party match logic stays in TypeScript.** Complex, authoritative game
  modes (e.g. Squadfall-class battle-royale match flow) are shipped as
  first-party `GameSystem`s in code, not expressed as `rules`. Docs target the
  community-buildable surface; the rule vocabulary is intentionally bounded.
- **Limited addressability.** Only `kind:'part'` objects are registered and thus
  moveable/removable/openable by rules; pickups, hazards and decoration are
  placed-and-forgotten in v1.
