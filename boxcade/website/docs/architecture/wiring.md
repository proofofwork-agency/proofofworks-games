---
sidebar_position: 3
description: How everything is wired — from a hash route to a rendered frame, step by step.
---

# How everything is wired

This page traces the full path: a player clicks a game card → the router runs → the
composition root builds every engine object → the game's `build()` populates the world →
the frame loop drives physics, systems, audio and the renderer. Follow along in the
source — file references are included.

## The end-to-end path

```
URL hash  ──▶  main.ts (router)  ──▶  runGame()  ──▶  GameDef.build(w)  ──▶  frame loop
                    │                     │                                       │
              resolve a GameDef     composition root:                runtime systems + engine
              (built-in / doc /     builds engine objects,          subsystems update, then
              draft / published)    wires GameContext,               renderer.render()
                                    starts the RAF loop
```

## Step 1 — the router resolves a GameDef (`src/main.ts`)

The shell is a tiny **hash router**. `route()` matches `location.hash` and resolves a
`GameDef` (the SDK's unit of "a game") from one of four sources:

| Route | How a GameDef is produced |
| --- | --- |
| `#/play/<gameId>` | `findGame(id)` from `src/games/index.ts` — a trusted TypeScript game. |
| `#/play/draft/<key>` | `loadDraft(key)` → a local GameDoc → `buildGameFromDoc(doc)`. |
| `#/play/d/<payload>` | `decodeGameDoc(payload)` (base64url → inflate → JSON) → `buildGameFromDoc(doc)`. The whole game rides in the link. |
| `#/play/g/<id>` | `getPublishedGame(id)` (server fetch) → `buildGameFromDoc(doc)`. |
| `#/studio[/<key>]` / `#/editor` | Not a game — `renderStudio()` (the visual editor) mounts instead. |

`#/studio` and `#/editor` never reach `runGame` — they hand the mount element to the
Studio, which is its **own** composition root (see the [Studio tutorial](../tutorials/studio-3d.md)).

For doc-based routes the shell also injects **platform hooks** via `RunGameOptions`:
`onSaveWorld` (persist edited voxel terrain), `onVictory` (submit leaderboard time),
`onStoreBuy` (credit the creator), and `onGoToGame` (route a portal/goTo action).
Keeping these injected lets the runtime stay storage- and router-agnostic.

The router disposes the previous session/editor, then calls:

```ts
session = await runGame(def, app, playerName, runOpts)
```

## Step 2 — `runGame()` is the composition root (`src/runtime/runtime.ts`)

`runGame` is where every subsystem meets. In order it:

1. **Builds the HUD shell + chat** (internal runtime systems in `runtime/systems/`).
   Chat mounts into the HUD element; engine deps arrive as **thunks** (`getInput`,
   `getNet`) because those objects are created further down and only touched on user
   interaction.
2. **Creates a `WorldBuilder`** — a closure over `pending*` arrays (`pendingParts`,
   `pendingLabels`, `pendingHealthPacks`, `pendingWeaponSpawns`, `pendingAmmoSpawns`,
   `pendingLights`, `pendingVehicles`). The builder's verbs (`w.add`, `w.coin`,
   `w.bouncePad`, …) don't place meshes yet — they **queue intent**.
3. **Runs `def.build(w)`** — the game's own code. This drains the pending queues, sets
   the lighting preset, spawn point, kill Y and physics override. (This is why the
   renderer is constructed *after* `build`: the world builder tells us the lighting.)
4. **Constructs the engine objects**: `Renderer` (with the resolved preset), `PartsWorld`,
   `Input`, `CameraRig`, `CharacterController`, `Avatar`, `Particles`, `Net` (WebSocket),
   `CombatSystem` (only if `def.combat` is set), `VoxelWorld` (if `w.voxelIsland()` was
   called), `ViewModel` (first-person weapons). Each gets the deps it needs.
5. **Replays the pending queues** into the live worlds — parts into `PartsWorld`, weapon
   spawns into combat, vehicles, etc.
6. **Constructs the `GameContext`** — the dependency-injection bundle handed to the game:
   `player`, `hud`, `events`, `engine` (the live facade), and (in combat games)
   `entities`, `spawnBot`, `setSpawnPoints`.
7. **Wires the internal runtime systems** (`runtime/systems/`), each on the `GameSystem`
   lifecycle (`{ id, init?, update?, dispose? }`): `hud`, `chat`, `pause`, `buildmode`
   (voxel build UI), `combathud`. The root still decides *when* each updates — `buildmode`
   runs before the camera rig, `hud`'s fps meter right after render — so extraction
   changed no frame ordering.
8. **Initializes the game's systems** (`def.systems`) and the doc's rules/script systems
   (if any), then calls `def.onStart(ctx)`.
9. **Starts the `requestAnimationFrame` loop** and returns a `GameSession` with a `dispose()`.

:::tip Why a single composition root matters
`runGame` is the *only* place that knows all the subsystems. Games get capabilities
**through the context**, never globals — which is what lets the same `GameDef` run
identically whether it came from a TypeScript file, a share link, or the server.
:::

## Step 3 — the frame loop

Each frame (`runtime.ts`), in a fixed, deliberate order:

```
1. dt = clamp(now - last, 0.05)            // never a huge step
2. input snapshot for this frame
3. game def.onTick(ctx, dt)                // the game's own per-frame logic
4. def.systems[].update(ctx, dt)           // then composable systems
5. PartsWorld.update(t, dt)                // behaviors animate parts kinematically
6. vehicles step (read input → physics)    // inline: gameplay-order-coupled
7. CharacterController.step(dt)            // collide-and-slide, ride part deltas
8. CameraRig.update(dt)                    // orbit or pointer-lock, camera collision
9. remote avatars update + LOD cull        // network interpolation
10. CombatSystem.update(dt)                // projectiles, hits, bots, pickups
11. VoxelWorld rebuild (if dirty chunks)   // per-chunk on edit
12. Renderer.updateSun(followPlayer)       // shadow follows the player
13. Renderer.render(t)                     // EffectComposer: render → SSR → GTAO → bloom → output
14. internal systems (buildmode, combathud) at their fixed spots
15. hud fps meter right after render
16. input.endFrame()
```

Subsystems that read/write the physics step (vehicles, remote avatar LOD, voxel co-build
sync) stay **inline in `runtime.ts` on purpose** — they're gameplay-order-coupled, so they
get a frame-position-preserving seam rather than an arbitrary system slot.

## Step 4 — the GameContext capability surface

Everything a game's hooks (`onStart` / `onTick` / `onRespawn` / `onKill`) and systems
receive is the `GameContext`. It is the *only* sanctioned handle into the engine:

| Context field | What it gives |
| --- | --- |
| `ctx.player` | `kill` / `respawn` / `setCheckpoint` / `teleport` / `launch`, position, velocity |
| `ctx.hud` | `set(key,val)` chips · `toast` · `big` banner |
| `ctx.events` | the typed `EventBus` (subscribe/emit) |
| `ctx.engine` | the live subsystem facade (renderer, parts, voxels, combat, fx, net, input, player, audio, events) |
| `ctx.time` · `ctx.playersOnline` · `ctx.coins` · `ctx.blobcash` | session state |
| `ctx.award(n)` · `ctx.earnBlobcash(n)` · `ctx.celebrate()` · `ctx.systemChat()` | economy + moment APIs |
| `ctx.addPart(def)` | spawn parts at runtime |
| `ctx.entities` · `ctx.spawnBot(...)` · `ctx.setSpawnPoints(...)` | combat (only when `def.combat` set) |

See the [SDK reference](../reference/sdk.md) for the full type.

## How a GameDoc becomes a GameDef

For doc-based games, `buildGameFromDoc(doc, opts)` (`src/sdk/interpret.ts`) is the bridge:
it **validates** (`validateGameDoc`) → **migrates** (`migrateGameDoc`) → constructs a
`GameDef` whose `build(w)` replays sections in a fixed order:

```
1. lighting   → w.lighting(name)
2. killY      → w.killY(y)
3. textmap    → buildTextMap(w, …)
4. voxel      → w.voxelIsland(…)
5. parts      → each DocPart via the matching WorldBuilder verb
6. spawn      → w.spawn(…)  LAST (so doc.spawn overrides text-map S)
```

`maxPlayers`, `physics`, `combat`, `services`, `weapons`, `levels`, `studio` and `script`
aren't placed directly — the interpreter copies them into the `GameDef`, registers custom
weapons (namespaced by game id), resolves the selected level, and creates rules/script
systems when needed. A doc game and a code game are therefore **behavior-identical by
construction** — there's no separate "data engine".

## How multiplayer relay works

The room server (`server/server.mjs`) keeps a room per game id (or per doc hash for
shared/published games). Clients send at **12 Hz**; the server fans state out at **15 Hz**,
rate-limits chat, and holds the generic event relay with a per-client token bucket
(`min(20, +10/s)`, max 2048 bytes/event).

- **Presence/avatar sync**: transforms are client-sent, server-relayed, interpolated by a
  120 ms buffer on the receiver. Remote avatars LOD out past ~40 m.
- **Relayed game events**: `forEveryone` rule actions and script actions go through the
  same relay + budget, so a script can't get more network than the rule engine.
- **Host election**: the host owns shared world state (voxel co-build edits, doors,
  scores). Late joiners get a snapshot.
- **PvP**: client hit claims → server plausibility caps (damage budget, range sanity) →
  **server-owned HP verdicts**. The server is the final arbiter of health, even though hit
  *detection* is client-side today.

No server reachable? `Net` silently falls back to solo mode — every game still runs.

## Disposal

`session.dispose()` (called on every route change) cancels the RAF loop, disposes every
internal system and `def.systems` (their `dispose()`), closes the WebSocket, disposes the
renderer, tears down input listeners, and clears the mount element. Nothing leaks between
sessions.

## Next

You now have the full picture. To build on it:

- [Tutorials](../tutorials/typescript-game) — make a game three ways.
- [SDK reference](../reference/sdk.md) — the exact `WorldBuilder` / `GameContext` API.
