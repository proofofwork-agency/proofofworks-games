---
sidebar_position: 6
description: Sandboxed creator scripting — the escape hatch past the rule ceiling, running in a locked-down Web Worker.
---

# Scripting (sandboxed creator code)

Rules are deliberately bounded — no nesting, expressions, loops, or functions, only
named-counter state — so a GameDoc with no `script` field is **inert data** that anyone
can open safely. But that ceiling is a real wall: you can't express a wave spawner that
scales with the round, a shrinking-zone timer with derived positions, or anything needing
arithmetic and collections.

**Scripts are the designed escape hatch, not rule-language creep.** A script ships in a
GameDoc's `script` field (a single string, cap 64 KB, requires GameDoc `v: 2`) and runs in
a locked-down **Web Worker** sandbox. It unlocks programmability *without* re-opening the
"no executable data" property for docs that don't use it.

## How scripts relate to rules and TypeScript

Scripts are **not a fourth creation path** — they're the *code half of a GameDoc*. This is
the part that confuses everyone, so here it is explicitly:

```
a GameDoc =  a WORLD  (textmap | parts | voxel)         ← geometry
           + LOGIC, which comes in two strengths:
               rules  (no-code, when/if/do)             ← declarative, inert data
               script (sandboxed JS, optional)          ← programmable, same vocabulary
```

| Question | Answer |
| --- | --- |
| Where does a script live? | The `script` field **inside a GameDoc**, alongside its map/rules/parts. Not a file. |
| Is a script a separate game type? | No. It's the programmable logic layer that rides on a doc's world. |
| What can a script do that rules can't? | Loops, arithmetic, variables, timing math (e.g. "wave size = 3 + round × 2"). |
| What can a script **not** do? | Touch `ctx.engine`, the DOM, the network, or anything outside the rule-action vocabulary. |
| How does it relate to TypeScript games? | TypeScript is *above* it on the power ladder — full code, repo-only, main thread. A script is the most code a **shareable** doc can carry. |

**The key constraint: a script gets *exactly the rule action vocabulary* — just
programmable.** Both `rules` and `script` resolve to the same `RULE_ACTION_TYPES`
(`toast` / `big` / `award` / `movePart` / `openDoor` / `spawnPart` / `setVar` / `teleport`
/ `win` / `sound` / …). The difference is *how you decide when to fire them*:

- A **rule** says: *"when the player touches `btn`, if `keys ≥ 1`, open `gate`"* — flat,
  declarative, no control flow.
- A **script** says: *"every tick, if `time > nextAt`, spawn `3 + wave×2` parts in a ring,
  increment `wave`, ramp the cadence"* — real loops and math.

A doc can use **both**: rules for the simple reactions (a button opens a door), a script
for the logic rules can't express (a wave spawner). They share the same `vars` and the same
action set. When you outgrow even scripting — you need `ctx.engine`, custom systems, or
repo shipping — **bridge to TypeScript** via the [Studio ⬇ TS export](./studio-3d.md#test-share-export)
or [`buildGameFromDoc`](../creation-paths.md).

## The `blobcade` global

A script is self-contained. It sees one global, `blobcade`, that mirrors the rule-action
vocabulary plus `onTick` / `on` hooks. No imports, no DOM, no globals beyond this. Here's a
wave spawner that scales with the round — *expressible here, impossible in rules*:

```js
// A wave spawner: each wave is bigger and faster than the last.
let wave = 0
let nextAt = 0

blobcade.on('start', () => {
  blobcade.toast('Survive the waves!')
})

blobcade.onTick((t /* seconds */) => {
  if (t < nextAt) return
  wave += 1
  const count = 3 + wave * 2            // arithmetic — no rule can do this
  const radius = 12 + wave              // derived geometry
  for (let i = 0; i < count; i++) {     // a loop — no rule can do this
    const a = (i / count) * Math.PI * 2
    blobcade.spawnPart({
      kind: 'part', tag: 'creep',
      at: [Math.cos(a) * radius, 1, Math.sin(a) * radius],
      size: [1, 1, 1], color: '#e74c3c',
    })
  }
  blobcade.setVar('wave', wave)          // drives the HUD chip + varReaches
  blobcade.big('Wave ' + wave)
  nextAt = t + Math.max(2, 8 - wave)    // ramps the cadence
})
```

### The API surface

Every `blobcade.*` call is a validated message — the script never touches an engine object.
`spawnPart` / `setVar` / `big` / `toast` are the **same actions a rule would emit**; the
script just decides *when* and *how many* with real control flow.

| Method | Effect |
| --- | --- |
| `onStart(fn)` / `onTick(t, dt)` / `on(name, fn)` | hooks (start, every frame, subscribed events) |
| `toast(text)` · `big(text)` · `celebrate(text?)` · `win(text?)` | HUD / moment |
| `kill()` · `teleport([x,y,z])` · `award(n?)` | player / economy |
| `movePart(part, byOrTo, seconds?)` · `openDoor(part, seconds?)` · `removePart(part)` · `spawnPart(part)` | parts (id or tag) |
| `setVar(name, value)` · `addVar(name, value?)` | named counters (drive HUD chips + `varReaches`) |
| `sound(name)` · `emit(name)` · `goTo(target)` | audio / custom events / navigation |
| `spawnBot(opts)` · `setSpawnPoints(points)` · `entity(id).{…}` | combat (when the doc has `combat`) |
| `log(msg)` | dev console only (never player-facing, never DOM) |

Reserved event prefixes (`combat:` / `self:` / `player:` / `game:` / `net:` / `platform:`)
may be **listened** to but never **emitted** — the engine owns them. `goTo` is the
supported way to emit a navigation intent.

## Trust UX

Scripting changes a doc from "inert data" to "code that runs", so the player must consent:

- **Per-game permission prompt** before the first run on a device: *"This game runs creator
  code in a sandbox (no network, no storage access). Run it?"* — remembered per `meta.id`.
  Built-in games never prompt (they're first-party).
- **"Scripted" badge** on discovery cards and the pre-play screen.
- **Publish-side static checks** flag banned tokens (`importScripts`, `eval`, `Function(`,
  `fetch`, `WebSocket`, `://`) — these are tripwires, not security.

:::warning Publishing
Scripted drafts run locally and through share links after the prompt. The **public catalog
rejects scripted GameDocs** until server-side review/moderation exist. Full TypeScript games
publish only through trusted routes (curated inclusion or sandboxed external embed).
:::

## How the sandbox works

One dedicated **Web Worker per game session** (`src/sdk/script-host.ts`). A `ScriptSystem`
(a `GameSystem`) owns the worker, bridges it to the `EventBus` and a whitelisted slice of
`GameContext`, and dies with the session. The worker is created from a blob bootstrap that,
**before running the creator string**:

1. deletes the network + storage globals (`fetch`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `importScripts`, `indexedDB`, `caches`, `navigator.sendBeacon`),
2. installs the message-only `blobcade` shim,
3. then evaluates the creator code in that stripped scope.

The worker **never receives an object reference** — only JSON data crosses the boundary
(structured clone strips functions/DOM/prototypes). Capability is expressed *only* as
validated messages.

**The single choke point:** worker action messages dispatch through the **same executor
rules already use**. A script therefore gets *exactly* the powers a rule has — just
programmable. No new authority is introduced by scripting.

## Resource governance

Three independent budgets; tripping any one degrades gracefully:

- **CPU watchdog** — the host pings every 1000 ms; a missed pong (a thread stuck in
  compute) → `worker.terminate()`, **restart with backoff** (250 ms → 1 s → 4 s).
  **3 strikes ⇒ scripting disabled for the session** (the game keeps running on its
  rules/parts). A `while(true){}` is caught and killed without freezing the render loop.
- **Action rate limit** — worker actions draw from the **same token bucket the multiplayer
  relay enforces** (`min(20, +10/s)`, max 2048 bytes/event). Over-budget actions are
  dropped, not queued.
- **Memory** — no `SharedArrayBuffer`; reclamation is via `terminate()` only. (Honest gap:
  browsers give JS no hard per-worker heap cap; QuickJS-in-WASM is the planned hardening
  step that adds a real byte limit and deterministic interrupts, behind the same wire
  protocol — an executor swap, not an API change.)

## Non-goals (hard lines)

- **No `eval` / no main-thread execution, ever.** Creator code runs only inside the Worker.
- **No DOM API.** Player-facing output is the existing HUD vocabulary only (anti-phishing).
- **No network API.** No `fetch`/`WebSocket`/`import(url)`; multiplayer reach is only via
  `forEveryone` actions through the existing relay.
- **No cross-game / persistent storage.** No `localStorage`/`IndexedDB`/cookies. A script's
  only durable state is the doc's `vars` for that session.
- **No new authority over rules.** Scripts get the rule-action set and nothing more.
- **No module/URL imports.** The script string is wholly self-contained.

## Next

- The data format that carries scripts → [GameDoc spec](../reference/gamedoc-spec.md).
- The rules vocabulary scripts reuse → the [GameDoc editor rules section](./gamedoc-editor.md#rules-no-code-logic).
