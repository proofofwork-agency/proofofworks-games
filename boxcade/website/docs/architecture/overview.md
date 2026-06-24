---
sidebar_position: 1
description: The big picture — layering, design patterns, and how a GameDef becomes a running session.
---

# Architecture overview

Blobcade is built from **swappable subsystems behind one SDK**. This page is the map;
[engine.md](./engine.md) covers each subsystem, and [wiring.md](./wiring.md) traces the
full path from a URL to a running frame.

## Strict, one-way layering

```
games/  ──imports──▶  sdk/  ──imports──▶  engine/
runtime/ ─────────────┴──────────────────────┘
```

| Layer | Responsibility | May import from |
| --- | --- | --- |
| **`engine/`** | Self-contained subsystems with **zero game knowledge**. Each module owns one concern and can be used standalone. | `engine/` only |
| **`sdk/`** | The only surface games should touch: `defineGame`, the `WorldBuilder`/`GameContext` types, prefab vocabulary, and registries re-exported from the engine. Type-glue only. | `engine/`, `sdk/` |
| **`games/`** | Plain data + hooks. A game never reaches into `runtime/`. | `sdk/`, `engine/` |
| **`runtime/`** | The **composition root**. Wires a `GameDef` to engine subsystems, owns the frame loop, HUD and input routing. | everything |

:::note The golden rule
If a feature needs an `import` from `games/` inside `engine/`, the design is wrong —
**invert it** with an event, a registry, or a config field. The engine never knows what
a "game" is.
:::

## Design patterns in use

The engine keeps itself composable through four repeating patterns:

### 1. Registries — add content once, use it everywhere

Content (materials, behaviors, weapons, sky presets, text-map tiles) is registered by
**name string** and looked up at build/spawn time. This is why docs and defs are plain
data: adding content never renumbers existing games.

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

registerSkyPreset('bloodmoon', { /* ...SKY_PRESETS.night ... */ })
```

Registered names then work in combat configs, `weaponSpawn` pads, lootboxes, part defs,
text maps and `@lighting` directives alike.

### 2. Events — observe the engine without coupling (Observer)

```ts
onStart(ctx) {
  ctx.events.on('combat:kill', ({ victimId, killerId, headshot }) => { /* ... */ })
  ctx.events.on('self:damage', () => { /* ... */ })
  ctx.events.emit('mygame:wave-start', { wave: 3 })   // your own namespaced events
}
```

Engine-published events: `combat:damage` · `combat:kill` · `combat:pickup` ·
`combat:respawn` · `self:damage` · `self:loadout` · `player:coin` · `player:checkpoint` ·
`game:celebrate` · `platform:goToGame`. Payload types live in `engine/events.ts`
(`EngineEvents`). Reserved prefixes (`combat:`/`self:`/`player:`/`game:`/`net:`/`platform:`)
may be **listened** to but never **emitted** by games/rules/scripts.

### 3. Game systems — composable logic units (Strategy)

Ship reusable behaviors as objects with a lifecycle instead of one giant `onTick`:

```ts
const dayNight: GameSystem = {
  id: 'day-night',
  update(ctx, dt) { /* rotate ctx.engine.renderer.sun ... */ },
}

export default defineGame({
  meta: { /* ... */ },
  systems: [dayNight, killStreakAnnouncer, superJumpPowerup],
  build(w) { /* ... */ },
})
```

The runtime calls `init` once after `onStart`, `update` every frame after `onTick`, and
`dispose` when the session ends.

### 4. `ctx.engine` — the power API (Facade + DI-via-context)

`ctx.engine` exposes the **live subsystem instances**: `renderer`, `parts`, `voxels`,
`combat`, `fx`, `net`, `input`, `player` (character controller), `audio`, `events`. Most
games never need it; custom systems and advanced games get full reach **without forking
the engine**. Capabilities flow through the `GameContext` (dependency injection by
context, not globals).

### 5. Data-driven defs

Weapons (`WeaponDef`), parts (`PartDef`), behaviors (`BehaviorDef`), combat configs,
physics tuning and whole text maps are **plain data**. Cloning + tweaking a def is the
intended way to make variants.

## Game-as-data (the platform contract)

A **GameDoc** is one game expressed as a single JSON document: metadata, world geometry
(text map, voxel terrain, or explicit parts), camera/physics/lighting tuning, combat
config, no-code `rules`, `vars`, and optional sandboxed `script`. It is the platform's
interchange format:

- the Studio editor edits and saves it,
- share links encode it (compressed base64url in the URL hash),
- the backend stores it,
- `buildGameFromDoc()` turns it into a runnable `GameDef`.

A doc with no `script` field is **inert data**: a malicious doc wastes CPU but never runs
code, which is the property that lets share links and community uploads open safely. See
[the GameDoc spec](../reference/gamedoc-spec.md).

## Conventions

- TypeScript strict; no classes where a plain object + interface works.
- Every module header comment states the module's single concern.
- **Additive evolution**: new capabilities arrive as events/registries/optional fields —
  existing games must keep working unmodified.
- All assets are procedural (code) — no binary assets in the repo.

## Next

- [Engine subsystems](./engine.md) — what each `engine/*.ts` module does and how.
- [Wiring](./wiring.md) — the frame-by-frame path from a hash route to a rendered pixel.
