# Blobcade plugins — extend the platform without forking it

Blobcade has no separate "plugin loader". The plugin API **is** the seam the
engine already exposes: registries for content, the event bus for behavior,
GameSystems for lifecycle, and GameServices for platform features. A plugin
is just a module that registers things — import it for its side effects (or
call an exported `install()`), and every game in the session can use what it
brought.

That means today's plugins are **trusted code modules or GameDoc fragments**,
not installable marketplace packages. There is no `PluginManifest`, package
catalog, enable/disable lifecycle, permission prompt, dependency resolver, or
untrusted-code sandbox for plugins yet; those belong to the roadmap.

This is deliberate (see ARCHITECTURE.md): plugins ride the same extension
points first-party content uses, so there is no second-class API to fall
behind. The strict layering still holds — a plugin may import from `sdk/`
(which re-exports the safe engine surface) and must not reach into
`runtime/`.

## The extension points

| You want to add… | Register with | Lives in |
|---|---|---|
| a material (visual surface kind) | `registerMaterial(kind, factory, { reflective? })` | engine/world |
| a part behavior (animation as data) | `registerBehavior(type, factory)` | engine/world |
| a weapon | `registerWeapon(def)` — pure data | engine/combat |
| a sky/lighting preset | `registerSkyPreset(name, preset)` | engine/sky |
| a text-map tile | `registerTile(char, handler)` | sdk/textmap |
| per-frame logic with a lifecycle | `GameDef.systems: GameSystem[]` | sdk |
| reactions to engine events | `ctx.events.on('combat:kill', …)` | engine/events |
| platform features per game | `GameDef.services` (chat / leaderboard / store) | sdk |
| raw engine access (escape hatch) | `ctx.engine` — the live `EngineServices` facade | sdk |

Naming rule: registry names are strings and never indexes; prefix anything
you ship with your plugin name (`'neon:hologram'`, weapon ids
`'mygame:zapper'`) — the interpreter already namespaces GameDoc weapons as
`<gameId>:<id>` for the same reason.

## A worked example — one module, three registrations

```ts
// plugins/synthwave.ts — a "plugin" is a plain module with an install().
import {
  registerMaterial, registerWeapon, registerSkyPreset,
  type GameSystem,
} from '../sdk'
import * as THREE from 'three'

export function installSynthwave() {
  // 1. a glowing grid material every game can now use by name
  registerMaterial('synthwave:grid', (c) =>
    new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.15),
      emissive: c, emissiveIntensity: 1.8, roughness: 0.35,
    }), { reflective: true })

  // 2. a weapon — pure data, shows up in arsenals & weapon pads by id
  registerWeapon({
    id: 'synthwave:laser', name: 'Gridlaser', icon: '🔆',
    kind: 'beam', damage: 11, fireRate: 7, range: 120, ammoMax: 80,
    beamColor: '#ff5af1',
  })

  // 3. a sky preset usable from w.lighting('synthwave:dusk') or @lighting
  registerSkyPreset('synthwave:dusk', {
    top: '#1b0533', horizon: '#ff2d95', sunColor: '#ff8c42',
    sunIntensity: 2.1, ambient: 0.55, fog: '#2a0a4a',
  })
}

// 4. (optional) a reusable system — mix into any game via GameDef.systems
export const beatPulse: GameSystem = {
  id: 'synthwave:beat-pulse',
  update(ctx, dt) {
    // pulse every reflective part to the beat — ctx.engine is the live facade
    void ctx; void dt
  },
}
```

A game uses all of it in one-liners, the way the dogfood rule demands:

```ts
installSynthwave()
export default defineGame({
  // …
  systems: [beatPulse],
  services: { leaderboard: true },
  build(w) {
    w.lighting('synthwave:dusk')
    w.add({ at: v3(0, 0, 0), size: v3(24, 1, 24), color: '#b026ff', material: 'synthwave:grid' })
    w.weaponSpawn(v3(0, 2, 4), 'synthwave:laser')
  },
})
```

## GameDoc plugins (creator-facing)

Data documents get the same powers with no code: custom `weapons` (validated,
namespaced at build), `services.store` items, `gravityZone`/`vehicle` parts,
and rules. A plugin that wants to serve Studio creators should ship content
as **GameDoc fragments** (template docs), not code.

## Platform services (W4)

`GameDef.services` / `doc.services`:

- `chat: false` hides and disables in-game chat.
- `leaderboard: false` stops best-time submission for published games.
- `store: StoreItemDef[]` (≤ 8) sells per-game cosmetic **recolors** for
  Blobcash. Purchases persist per game (`blobcade.store.<gameId>`), the global
  wallet pays, and on published games the server credits the creator 30%
  (`POST /api/games/:id/store-credit`, validated against the published doc,
  rate-limited). Everything stays in the closed Blobcash loop — no real money.

## Shipping plugins as a package — boundary audit (packaging deferred)

Current `sdk/` import surface (audited 2026-06-10):

- `sdk/index.ts` → engine/{math, world, events} — **types + registries only**
- `sdk/interpret.ts` → engine/{math, world, combat}
- `sdk/rules.ts` → engine/{math, audio}
- `sdk/textmap.ts` → engine/{math, sky}
- `sdk/gamedoc.ts` → engine/combat (WeaponDef type), sdk/rules
- `sdk/codec.ts` → no engine imports

Verdict: a future `blobcade-sdk` npm package must ship `sdk/` **plus** the
six leaf engine modules above (math, events, world, combat, audio, sky) or
split those into `blobcade-core`. No `runtime/` or DOM coupling leaks into
`sdk/` except `codec.ts`'s use of `CompressionStream` (web standard, fine)
and `world.ts`/`combat.ts`'s three.js dependency (peer dep). Blockers to
publishing as a real package are product and tooling work rather than the
import graph alone: package metadata, build outputs, compatibility policy,
tests, docs, and a loader/installation story still need to exist.
