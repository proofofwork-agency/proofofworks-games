# Boxcade architecture

How the engine is put together, which design patterns hold it up, and every
extension point the SDK exposes. Read this before adding engine features.

## Layering (strict, one-way)

```
games/  ──imports──▶  sdk/  ──imports──▶  engine/
runtime/ ─────────────┴──────────────────────┘
```

- **engine/** — self-contained subsystems with *zero game knowledge*. Each
  module owns one concern and can be used standalone.
- **sdk/** — the only import surface games should touch: `defineGame`, the
  builder/context types, and the registries re-exported from the engine.
- **runtime/** — composition root. It wires a `GameDef` to engine subsystems,
  owns the frame loop, HUD and input routing.
- **games/** — plain data + hooks. A game never reaches into `runtime/`.

Rule of thumb: if a feature needs `import` from `games/` inside `engine/`,
the design is wrong — invert it with an event, registry or config field.

## The subsystems (engine/)

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
| `camera.ts` `input.ts` | rigs + input state | Strategy (orbit/fp rigs) |
| `network.ts` | ws rooms, interpolation, offline fallback | — |
| `audio.ts` | WebAudio synth, all sounds are code | — |
| `fx.ts` | one-draw-call particle pool | Object pool |
| `economy.ts` | Bolts wallet/shop (localStorage) | — |

`runtime/runtime.ts` is the **composition root**: it builds these objects,
hands games a `GameContext`, and runs the loop. Games receive capabilities
through that context (dependency injection by context, not globals).

## Extension points (the composable surface)

All exported from `../sdk`:

### 1. Registries — add content once, use it everywhere

```ts
import { registerWeapon, registerMaterial, registerTile, registerSkyPreset } from '../sdk'

registerWeapon({ id: 'crossbow', name: 'Crossbow', icon: '🏹', kind: 'projectile',
  damage: 55, fireRate: 0.8, ammoMax: 10, projectile: { speed: 44, radius: 0.12, color: '#caffb0' }, sound: 'sniper' })

registerMaterial('hologram', (c) => new THREE.MeshStandardMaterial({
  color: c, transparent: true, opacity: 0.35, emissive: c, emissiveIntensity: 1.2,
}), { reflective: false })

registerTile('J', (t) => {           // claim a text-map character
  t.tile(1, '#223', 'stone')
  t.w.bouncePad(v3(t.x, t.base + 1.4, t.z), 40)
})

registerSkyPreset('bloodmoon', { ...SKY_PRESETS.night, horizon: '#5a1111', fog: '#2a0808' })
```

Registered ids work in combat configs, `weaponSpawn` pads, lootboxes, part
defs, text maps and `@lighting` directives — the engine looks everything up
by name at build/spawn time (data-driven design).

### 2. Events — observe the engine without coupling (Observer)

```ts
onStart(ctx) {
  ctx.events.on('combat:kill', ({ victimId, killerId, headshot }) => { /* streaks, scores */ })
  ctx.events.on('combat:pickup', ({ entityId, kind }) => { /* loot telemetry */ })
  ctx.events.emit('mygame:wave-start', { wave: 3 })   // your own namespaced events
}
```

Engine-published events: `combat:damage` · `combat:kill` · `combat:pickup` ·
`combat:respawn` · `self:damage` · `self:loadout` · `player:coin` ·
`game:celebrate`. Payload types live in `engine/events.ts` (`EngineEvents`).

### 3. Game systems — composable logic units (Strategy)

Ship reusable behaviors as objects with a lifecycle instead of growing one
giant `onTick`:

```ts
const dayNight: GameSystem = {
  id: 'day-night',
  update(ctx, dt) { /* rotate ctx.engine.renderer.sun ... */ },
}

export default defineGame({
  meta: { ... },
  systems: [dayNight, killStreakAnnouncer, superJumpPowerup],
  build(w) { ... },
})
```

The runtime calls `init` once after `onStart`, `update` every frame after
`onTick`, and `dispose` when the session ends.

### 4. The engine facade — `ctx.engine` (power API)

`ctx.engine` exposes the live subsystem instances: `renderer` (scene, camera,
post stack), `parts`, `voxels`, `combat`, `fx`, `net`, `input`, `player`
(character controller), `audio`, `events`. Most games never need it; custom
systems and advanced games get full reach without forking the engine.

### 5. Data-driven defs

Weapons (`WeaponDef`), parts (`PartDef`), behaviors (`Behavior` interface —
pass any object with `update(part, t, dt)`), combat configs, physics tuning
and text maps are all plain data. Cloning + tweaking a def is the intended
way to make variants.

## Conventions

- TypeScript strict; no classes where a plain object + interface works.
- Every module header comment states the module's single concern.
- Additive evolution: new capabilities arrive as events/registries/optional
  fields — existing games must keep working unmodified.
- Engine never imports from `games/` or `runtime/`. SDK is type-glue only.
- All assets are procedural (code) — no binary assets in the repo.

## Internal runtime systems

`runGame` (the composition root) delegates its HUD/chat/pause/build-mode/
combat-HUD concerns to internal systems in `runtime/systems/`, each
conforming to the `GameSystem` lifecycle (`{id, init?, update?, dispose?}`).
The root still decides *when* each system updates — `buildmode` runs at its
original mid-frame spot (before the camera rig), `hud`'s fps meter right
after render — so extraction changed no frame ordering. Engine deps the
systems need land via narrow constructor params (or thunks where the dep is
created later but only touched on user interaction). Gameplay-order-coupled
subsystems (vehicles, remote avatars/LOD, voxel co-build sync) stay inline
in `runtime.ts` on purpose: they read and write the physics step.

## Known debt / next steps

- Vehicles / remote-avatar LOD / voxel co-build sync are the next extraction
  candidates if `runtime.ts` keeps growing — each needs a frame-position-
  preserving seam like build mode's.
- Server-authoritative combat (PvP) will move hit resolution behind an
  interface so local + server authority become swappable strategies.
- Renderer post stack could expose a pass registry (insert custom passes).
