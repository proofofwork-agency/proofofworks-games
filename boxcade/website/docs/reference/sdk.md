---
sidebar_position: 1
description: The Blobcade SDK — defineGame, WorldBuilder, GameContext, behaviors, materials, and the engine facade.
---

# SDK reference

The SDK (`src/sdk/index.ts`) is the only surface games should touch. This is the
creator-facing API reference, distilled from the source types. Source of truth: the code.

## `defineGame(def)`

Returns its argument (pure type helper — gives you autocomplete + strict checking). A
`GameDef` is:

```ts
interface GameDef {
  meta: GameMeta                       // id, name, blurb, emoji, gradient, genre
  maxPlayers?: number                  // room capacity (server clamps 1..250, default 64)
  camera?: 'orbit' | 'fp'              // third-person (default) or first-person
  physics?: PhysicsConfig              // gravity/jumpVel/walkSpeed/fallDamage
  rtReflections?: boolean              // SSR on reflective parts (auto-disables on low fps)
  weapons?: WeaponDef[]                // custom weapons, registered at session start
  combat?: CombatConfig & { selfTeam?: string }  // enables weapons/health/bots
  systems?: GameSystem[]               // composable per-frame logic
  services?: GameServices              // chat/leaderboard toggles, per-game store
  build(w: WorldBuilder): void         // place the world
  onStart?(ctx: GameContext): void
  onTick?(ctx: GameContext, dt: number): void
  onRespawn?(ctx: GameContext): void
  onKill?(ctx: GameContext, info: KillInfoApi): void
}
```

`v3(x, y, z)` builds a `Vec3`. `colors` is a friendly palette object
(`grass`/`dirt`/`stone`/`red`/`blue`/`sky`/`yellow`/`orange`/`purple`/`pink`/`white`/`dark`/`lava`/`gold`/`mint`).

## `WorldBuilder`

Available inside `build(w)`. Verbs queue intent the runtime replays once the engine exists.

| Verb | Signature | Notes |
| --- | --- | --- |
| `lighting` | `(preset)` | sky preset name (built-in or registered) |
| `spawn` | `(at)` | where players appear (overridden by `doc.spawn`) |
| `killY` | `(y)` | fall-death height (default −30) |
| `physics` | `(cfg)` | `{ gravity (negative), jumpVel, walkSpeed, fallDamage }` |
| `add` | `(def: SdkPart)` → `PartHandle` | the general rounded-box part |
| `label` | `(text, at, scale?, color?)` | floating billboard text |
| `checkpoint` | `(at, index, size?)` | glowing respawn pad |
| `lava` | `(at, size)` | kill volume |
| `coin` | `(at)` | collectible spinning coin |
| `winPad` | `(at, size?, onWin?)` | golden victory pad |
| `bouncePad` | `(at, power?, size?)` | launches on landing |
| `tree` | `(at, scale?)` | decorative tree |
| `cloud` | `(at, scale?)` | soft floating cloud (not solid) |
| `spinnerHazard` | `(center, radius, count?, period?)` | orbiting kill-cubes |
| `healthPack` | `(at)` | +HP pickup (combat; respawns ~20s) |
| `weaponSpawn` | `(at, weaponId)` | grants weapon + ammo; respawns ~14s |
| `ammoSpawn` | `(at)` | tops up held weapons; respawns ~10s |
| `light` | `(at, {color?, intensity?, range?})` | point light (a few per map) |
| `portal` | `(at, target, label?)` | step-through gateway |
| `vehicle` | `(type, at, opts?)` | `car`/`jetpack`/`boat`/`plane` |
| `voxelIsland` | `(opts?)` | editable voxel island (enables build mode in `fp`) |

### `SdkPart` (`w.add`)

```ts
interface SdkPart extends PartDef {
  onTouch?: (ctx: GameContext) => void
  touchOnce?: boolean
}
interface PartDef {
  at: Vec3; size: Vec3
  color?: string; material?: MaterialKind; rotY?: number
  collide?: boolean      // default true
  reflect?: boolean      // include in SSR (games opt in via rtReflections)
  bounce?: number        // upward velocity on landing
  hitbox?: Vec3          // collide as this size instead of the visual size
  gravityZone?: number   // 0.25=moon, 2=heavy; part becomes non-solid
  climbable?: boolean    // ladder volume
  tag?: string
  behavior?: Behavior | Behavior[]
}
```

**Materials** (`MaterialKind`): `plastic · grass · wood · stone · ice (slippery!) · neon ·
lava · water · gold · glass · metal · sand`, plus any custom kind via `registerMaterial`.

**Behaviors** (`behaviors.*`):

| Behavior | Args | Effect |
| --- | --- | --- |
| `spin(speed = 1.4)` | radians/sec | rotate visually around Y (collision stays put) |
| `patrol(offset, period = 4, phase = 0)` | Vec3, secs | glide base↔base+offset on a sine |
| `orbit(center, radius, period = 3, phase = 0)` | Vec3, m, secs | circle a point |
| `bob(amp = 0.4, period = 2.6, phase = 0)` | m, secs | gentle vertical hover |

Custom behaviors via `registerBehavior(type, factory)`; data-serializable as `BehaviorDef`.

## `GameContext`

The capability surface handed to hooks and systems.

| Field | What it gives |
| --- | --- |
| `ctx.player` | `PlayerApi`: `kill()`, `respawn()`, `setCheckpoint(at)`, `teleport(at)`, `launch(v)`, `name`, `position`, `velocity` |
| `ctx.hud` | `HudApi`: `set(key, value)` chips, `remove(key)`, `toast(msg)`, `big(msg, ms?)` |
| `ctx.events` | the typed `EventBus` (`on`/`emit`/`off`) |
| `ctx.engine` | `EngineServices` — the live facade (below) |
| `ctx.time` · `ctx.playersOnline` · `ctx.coins` · `ctx.blobcash` | session state |
| `ctx.award(n)` | grant coins (coin sound + sparkle; coins also earn Blobcash 1:1) |
| `ctx.earnBlobcash(n, reason?)` | grant platform currency |
| `ctx.celebrate(msg?)` | confetti + fanfare |
| `ctx.systemChat(msg)` | a system line in chat (local) |
| `ctx.addPart(def)` | spawn a part at runtime → `PartHandle` |

**Combat-only** (when `def.combat` is set):

| Field | What it gives |
| --- | --- |
| `ctx.entities` | `EntityApi[]` — you + all bots |
| `ctx.spawnBot({name, team?, skill?, spawns, shirt?})` | add a bot → `EntityApi` |
| `ctx.setSpawnPoints(points)` | respawn pool for the local player |

### `EntityApi`

`id` · `name` · `team` · `isBot` · `isSelf` · `position` · `health` · `alive` · `carrying`,
plus `setObjective(at)`, `teleport(at)`, `respawn()`, `giveWeapon(id)`, `giveAmmo()`,
`heal(n, capTo?)`, `hurt(n, cause?, causeIcon?)`, `deploy(at)` (parachute infil).

## `EngineServices` (`ctx.engine`)

The live subsystem instances — the "power API". Most games never need it; advanced games
and custom systems get full reach:

```ts
interface EngineServices {
  renderer: Renderer          // scene, camera, sun, post composer
  parts: PartsWorld           // the parts world
  voxels: VoxelWorld | null
  combat: CombatSystem | null
  fx: Particles               // burst(pos, color), confetti…
  net: Net                    // isHost, room info
  input: Input                // keys, mouse state
  player: CharacterController // position, velocity, tuning
  audio: typeof audio         // play(name)
  events: EventBus
}
```

## `GameSystem`

```ts
interface GameSystem {
  id: string
  init?(ctx: GameContext): void      // once, after onStart
  update?(ctx: GameContext, dt: number): void  // every frame, after onTick
  dispose?(): void                   // session end
}
```

Mix systems into a game via `def.systems`. The runtime owns the lifecycle ordering.

## Registries (extension points)

All exported from `'../sdk'`:

| Register | Adds |
| --- | --- |
| `registerMaterial(kind, factory, {reflective?})` | a visual surface kind |
| `registerBehavior(type, factory)` | a part behavior |
| `registerWeapon(def)` | a weapon (pure data) |
| `registerSkyPreset(name, preset)` | a sky/lighting preset |
| `registerTile(char, handler)` | a text-map tile char |

Content is looked up by **name string** at build/spawn time, so adding content never
renumbers existing games/docs. Prefix anything you ship with your plugin/game name
(`'synthwave:grid'`, `'mygame:zapper'`).

## Helpers (GameDoc / codec)

`buildGameFromDoc(doc, opts?)` · `validateGameDoc(doc)` · `migrateGameDoc(doc)` ·
`encodeGameDoc(doc)` / `decodeGameDoc(payload)` / `hashGameDoc(doc)` ·
`buildTextMap(w, source)` · `gameDocToTypeScript(doc)` · `createScriptSystem(doc, script, registry)`.
