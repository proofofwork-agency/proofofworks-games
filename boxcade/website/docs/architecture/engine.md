---
sidebar_position: 2
description: Each engine/ module, its concern, and the pattern it follows.
---

# Engine subsystems

The `engine/` directory is the engine — self-contained subsystems with **zero game
knowledge**. Each module owns one concern. This is the module-by-module breakdown.

| Module | Concern | Pattern |
| --- | --- | --- |
| `renderer.ts` | three.js scene, post stack (ACES, bloom, GTAO, SSR), sun/shadow follow | Facade |
| `sky.ts` | procedural sky shader + **preset registry** | Registry, data-driven |
| `physics.ts` | AABB character controller + world raycasts | — |
| `world.ts` | Parts (rounded boxes), **material registry**, behaviors, triggers | Registry, Strategy |
| `voxel.ts` | chunked voxel terrain, meshing, AO, edits | — |
| `combat.ts` | weapons-as-data + **weapon registry**, entities, bots, pickups | Registry, data-driven |
| `events.ts` | typed pub/sub bus | Observer |
| `avatar.ts` | procedural blocky character, health bar, hit flash | — |
| `camera.ts` · `input.ts` | rigs + input state | Strategy (orbit/fp rigs) |
| `network.ts` | ws rooms, interpolation, room codes, relayed events, PvP verdict callbacks, offline fallback | — |
| `audio.ts` | WebAudio synth — every sound is code | — |
| `fx.ts` | one-draw-call particle pool | Object pool |
| `economy.ts` | Blobcash wallet/shop (localStorage) | — |
| `vehicle.ts` · `vehiclemesh.ts` | drivable vehicles (car / jetpack / boat / plane) | — |
| `viewmodel.ts` · `touch.ts` | first-person weapon viewmodels; touch controls | — |

## renderer.ts — the look

A facade over three.js that applies the "AAA post-processing playbook" to deliberately
simple blocky geometry. Constructor takes a host element + a sky preset name; it builds:

- A `WebGLRenderer` with `ACESFilmicToneMapping`, `PCFSoftShadowMap`, pixel ratio capped
  at 1.75.
- A sun `DirectionalLight` with a 2048×2048 shadow map (PCF soft, snapped to texels),
  sized 55m across, that **follows the player**.
- A `SkyDome` (procedural shader) + a hemisphere fill light, fog tinted by the preset.
- An `EffectComposer` chain: `RenderPass` → optional `SSRPass` (screen-space ray-traced
  reflections) → `GTAOPass` (ground-truth ambient occlusion) → `UnrealBloomPass` →
  `OutputPass`. SSR auto-disables if the frame rate drops.

Games rarely touch the renderer directly; `w.lighting(name)` picks a sky preset and the
runtime keeps the sun on the player.

## sky.ts — procedural sky + lighting presets

One shader draws a gradient atmosphere, a sun disc with glow, animated FBM clouds and
night stars — no textures. Each **preset** drives both the sky colors *and* the scene's
sun color/intensity and fog, so worlds always feel coherent.

Built-in presets: `noon`, `morning`, `goldenHour`, `night`, `space` (the big-planet
deep-space preset Facing Towers uses). Add your own with `registerSkyPreset(name, preset)`;
the name then works in `w.lighting('…')` and `@lighting` map directives.

## physics.ts — the character controller

An **AABB collide-and-slide** controller. Axis-aligned boxes only (no slopes/rotated
colliders) — that's the deliberate scope. It handles:

- Ground friction, acceleration, walk speed, jump velocity, **coyote time**
- **Step-up** (walk up small ledges automatically)
- **Ice** material (near-zero friction — slippery floors)
- **Bounce pads** (upward velocity on landing)
- **Water buoyancy** + swimming
- **Moving-platform carry** (reads part per-frame deltas so you ride spinners/patrollers)
- **Substepping** for stable fast movement
- Optional **fall damage** (combat games get HP damage, others a screen shake)

Tuning is data: `physics: { gravity, jumpVel, walkSpeed, fallDamage }` in code, or
`@gravity / @jump / @speed` map directives in text maps.

## world.ts — parts (the brick model)

Every part is a **rounded box** (`RoundedBoxGeometry`) with a material preset. Behaviors
animate parts **kinematically** — the physics layer reads their per-frame `delta` to
carry the player along. Key pieces:

- **`MaterialKind`** built-ins: `plastic · grass · wood · stone · ice · neon · lava ·
  water · gold · glass · metal · sand`. Custom kinds join via `registerMaterial()`.
- **`behaviors`**: `spin` · `patrol` · `orbit` · `bob` (and `registerBehavior()` for
  custom types). Behaviors are data-serializable (`BehaviorDef`) so they survive in docs.
- A part can carry `collide`, `bounce`, `hitbox` (collision override), `reflect` (SSR),
  `gravityZone` (non-solid gravity multiplier), `climbable` (ladders), `tag`, and a
  `touch` trigger.

## voxel.ts — chunked voxels

A voxel-sandbox world: 16×16 chunks, **hidden-face culling** meshing, classic 3-neighbor
**per-vertex ambient occlusion** with anisotropy-corrected quad flipping, and a
**DDA raycast** for precise break/place targeting. Worlds serialize with **RLE export** to
JSON — the pause-menu world download. Rebuilt per-chunk on edit. Drives *Voxel Island*.

## combat.ts — weapons, entities, bots

Turns a game into a shooter. Weapons are **pure data** (`WeaponDef`) in a registry;
seven tournament archetypes ship built-in. See [Weapons reference](../reference/weapons.md).

- **Entities** (you + bots) share the same character physics.
- **Bots** (`ctx.spawnBot({ name, team, skill, spawns })`) pick the right gun for range,
  lead projectiles, fire in bursts, hunt attackers, loot weapon/ammo/health pickups,
  hop low walls, strafe, and play objective modes (CTF carry/return/recover).
- **Pickups**: `weaponSpawn`, `ammoSpawn`, `healthPack` — they respawn on timers; bots
  loot them too. Overhead life bars, hit-flash, floating damage numbers.

:::warning Honest scope
Combat is not fully server-authoritative. Shots hurt bots locally; remote-human PvP uses
client hit claims with server-side plausibility caps (damage budget, range sanity,
server-owned HP verdicts). Fully authoritative PvP is still on the roadmap.
:::

## events.ts — the bus

A typed pub/sub bus (`EngineEvents`). The single mechanism for engine↔game decoupling.
Games subscribe in `onStart`; the engine publishes lifecycle and combat events.

## avatar.ts · camera.ts · input.ts

- **`avatar.ts`**: a procedural blocky character — walk/jump animation, a canvas-drawn
  smile face, per-player shirt colors, a floating name tag, chat bubbles, health bar,
  and hit-flash.
- **`camera.ts`**: two rigs (Strategy) — an **orbit rig** (third person: drag-to-orbit,
  scroll zoom, camera collision) and a **pointer-lock rig** (first person).
- **`input.ts`**: keyboard/mouse/touch state, captured- vs free-mode, move axes.

## network.ts — multiplayer

A WebSocket client to the room server: **12 Hz send, 120 ms interpolation buffer**,
remote avatars with **distance-based LOD** (shadow culling past ~40 m), room codes
(`?room=CODE`), relayed game events, PvP verdict callbacks, and a silent **offline
fallback** (no server → solo). Host election drives shared world state (voxel co-build,
doors/score). See [wiring.md](./wiring.md) for how relay works.

## audio.ts · fx.ts · economy.ts

- **`audio.ts`**: a WebAudio **synth** — every sound (jump, coin, fanfare, crunch, weapons)
  is code. No audio files exist in the repo.
- **`fx.ts`**: a **one-draw-call particle pool** (confetti, sparkles, debris) using
  instanced meshes.
- **`economy.ts`**: the **Blobcash** wallet + shop, persisted in `localStorage`. Swapping
  in a real backend later means replacing one small class.

## Next

Read [wiring.md](./wiring.md) to see how these subsystems get instantiated and driven
every frame.
