# Boxcade roadmap — from 6 games to a creation platform

Where the engine goes next: the staged path from "we ship six games" to
"ordinary people create, publish, and play fun games together" — Roblox's
core loop at indie scale, browser-first.

> **Status (2026-06-10, Wave 2 scale gate in progress):** Phases 1–6 of this roadmap
> shipped (overnight run); **Wave 2**: W1 Studio Comprehensive ✅, W2
> Worlds & chaining ✅, W3 Vehicles & physics options ✅, W4 Platform
> services & per-game Bolts store ✅, W5 iframe embed bridge ✅, W6 scale
> implemented pending final browser smoke (interest mgmt, avatar LOD,
> maxPlayers ≤250, bot harness). (Claude+Codex pairing over ContextRelay;
> per-phase browser gates.)
> Still open from Wave 1: runtime decomposition, P4-8 deploy (human),
> accounts + server wallet, P7-2/3/6, real-device touch QA, human PvP
> playtest. Evidence: docs/DEVLOG.md. Nothing committed to git yet.

## North star

A non-programmer opens the site → builds a world in an in-browser studio
(parts, terrain, logic) → hits **Publish** → gets a link → friends open the
link and play **together** in the same world → everyone earns Bolts → the
creator sees plays/likes and earns a creator cut.

The six first-party games (obby, battle royale, CTF, sandbox, text-map
adventure, starter) prove the fun envelope. This roadmap turns the engine
that made them into a platform where players make the next thousand.

## Prime directive

Additive evolution, as `ARCHITECTURE.md` mandates: new capabilities arrive
as registries, events, and optional fields. The six shipped games keep
working unmodified through every phase. The strict layering
`games/ → sdk/ → engine/` (with `runtime/` as composition root) never
breaks.

## The keystone: game-as-data

Phase 1 introduces **GameDoc** — a versioned, serializable JSON superset of
everything `WorldBuilder` can express (text-map source, placed parts with
materials/behaviors, voxel RLE, lighting, physics tuning, combat config)
plus data-driven **logic rules** — and an interpreter `GameDoc → GameDef`
that makes a JSON document a first-class game.

Every later capability consumes that one format: the editor saves it, share
links encode it, the studio edits it, the backend stores it, discovery
lists it, multiplayer rooms key on its hash. **No user code executes until
Phase 7**, and then only inside a sandboxed Worker with an explicit threat
model. Until then, creator logic is data: flat `when / if / do` rules over
the existing event bus and behaviors.

## How to work this roadmap

- Tasks are PR-sized: **S** ≤ half day, **M** ≤ 2 days, **L** ≤ 1 week.
- Execute task-by-task; every phase ends in a demo-able **gate** — don't
  start the next phase until the gate demo works.
- The six shipped games must keep passing (manual matrix + the Phase 1
  tests) on every PR.
- Git writes (branch/commit/merge) are handled by the human or the
  coordinating agent per repo policy.

---

## Phase 1 — Game-as-data foundation + repo hygiene

**Goal:** a game defined as pure JSON runs identically to a hand-written TS
game; the repo has commits, CI, and tests.

**Gate:** Castle Run built entirely from a GameDoc JSON fixture, visually
identical to `#/play/castle-run`; CI green on every PR.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P1-1 | First commit + hygiene | `.gitignore` (node_modules, dist), initial commit, CONTRIBUTING conventions. The repo is `git init`-ed but has zero commits. Git writes → human/coordinator per policy. | repo root | S | — |
| P1-2 | CI pipeline | GitHub Actions: `tsc --noEmit`, `vite build`, vitest (new devDependency; runtime deps stay three+ws only). | `.github/workflows/ci.yml`, `package.json` | S | P1-1 |
| P1-3 | Unit tests for pure seams | Lock down the formats the platform will depend on: textmap parse/serialize round-trip, voxel RLE shape, EventBus, Economy (localStorage shim). | `tests/*.test.ts` | M | P1-2 |
| P1-4 | Behaviors-as-data | `behaviors.spin(1.4)` returns a closure — unserializable. Add `BehaviorDef` (`{type:'spin'\|'patrol'\|'orbit'\|'bob', ...}`), a `registerBehavior` registry (mirrors `registerMaterial`), and `behaviorFromDef()`. `PartDef.behavior` additionally accepts `BehaviorDef` (additive — closures keep working). | `src/engine/world.ts`, `src/sdk/index.ts` | S | — |
| P1-5 | Voxel loader | `VoxelWorld.serialize()` exists (`voxel-world/v1` RLE) but there is **no loader**. Add `deserialize(json)` + `voxelIsland({ data })` to boot from saved worlds instead of a seed. Round-trip test. | `src/engine/voxel.ts`, `src/runtime/runtime.ts` | M | P1-3 |
| P1-6 | GameDoc v1 schema | The load-bearing wall: `{ boxcade:'gamedoc', v:1, meta, camera?, physics?, lighting?, killY?, spawn?, combat?, textmap?, parts?: DocPart[], voxel?, rules?: Rule[] }`. `DocPart` = PartDef-as-JSON with `BehaviorDef[]` + id/tag, or prefab kinds mapping 1:1 to the ~20 `WorldBuilder` verbs (coin, lava, checkpoint, winPad, bouncePad, weaponSpawn…). `CombatConfig` is already pure JSON. Ship `validateGameDoc()` (friendly errors, size caps, warn-and-ignore unknown fields) + `migrateGameDoc()` chain stub + spec doc. | `src/sdk/gamedoc.ts` (new), `docs/GAMEDOC.md` (new) | M | P1-4 |
| P1-7 | Interpreter GameDoc → GameDef | `buildGameFromDoc(doc): GameDef` — synthesizes meta/camera/physics/combat and a `build(w)` that replays parts/prefabs through `WorldBuilder`, `buildTextMap` for the textmap section, `voxelIsland` for the voxel section. Precedent: `customMapDef()` in `src/main.ts`. | `src/sdk/interpret.ts` (new) | L | P1-5, P1-6 |
| P1-8 | Logic rules engine (no user code) | `Rule = { when: Trigger, if?: Condition[], do: Action[] }` compiled into one generated `GameSystem`. Triggers: touch(part/tag), coin, start, timer, kill, enterRegion, varReaches. Actions: movePart, remove/spawnPart, teleportPlayer, award, toast/celebrate/win, killPlayer, openDoor(tag), playSound, setVar/addVar, emit. Named-counter `vars` store with auto HUD chips. Rides existing seams: `SdkPart.onTouch`, the event bus (`combat:kill`, `player:coin`…), ctx APIs. | `src/sdk/rules.ts` (new) | L | P1-7 |
| P1-9 | Parity proof + dev route | Castle Run as a GameDoc fixture (its TS is already mostly `buildTextMap(castle.txt)`); golden test (part counts/spawn/lighting); temporary `#/play/dev-doc` route (becomes the share route in P2). | `tests/fixtures/`, `src/main.ts` | S | P1-7, P1-8 |

## Phase 2 — Share anywhere (local-first creator loop, zero backend)

**Goal:** anything made in the editor becomes a link or a file that anyone
can open and play — no server involved.

**Gate:** paint a map in `#/editor`, add a "button opens door" rule, click
Copy Link, open it in an incognito window, play it.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P2-1 | GameDoc codec | JSON → native `CompressionStream('deflate-raw')` → base64url and back. Zero new dependencies. Size guard + tests. | `src/sdk/codec.ts` (new) | S | P1-6 |
| P2-2 | Share-link route | `#/play/d/{payload}`: decode → validate → interpret → run. Friendly error card for corrupt/oversized/future-version docs. Widen the `#/play/` route regex in `src/main.ts` for the payload alphabet. | `src/main.ts` | S | P2-1 |
| P2-3 | Editor saves GameDoc | The text-map editor wraps its output in a GameDoc draft: meta form (name, blurb, emoji, genre, gradient). One-time storage-key migration (precedent: the `freeblox.*` migration in `src/main.ts`). | `src/editor.ts` | M | P1-6 |
| P2-4 | Share + import UI | Editor: "Copy share link" (size guard suggests file export when too big) + "Download .boxcade.json". Portal: file-picker/drag-drop import → playable draft. | `src/editor.ts`, `src/main.ts` | M | P2-1, P2-2, P2-3 |
| P2-5 | "My Games" shelf | Draft library in localStorage (`boxcade.myGames` index); portal cards: Play / Edit / Duplicate / Delete / Share. Extract portal rendering to `src/portal.ts` while touching it (`src/main.ts` stays the router). | `src/portal.ts` (new) | M | P2-3 |
| P2-6 | Rules editor v0 (forms) | List-of-rules panel in the 2D editor over the P1-8 schema: dropdown triggers/actions, no free text. Deliberately small vocabulary; the Studio (P3) gets the richer version. | `src/editor.ts` | M | P1-8, P2-3 |
| P2-7 | Interactive prefabs: button, door, mover | New WorldBuilder prefabs + text-map tiles (via `registerTile`) + GameDoc kinds that make rules fun immediately: pressure-plate button (emits `button:<tag>`), door (tagged part that `openDoor` animates away), elevator (patrol behavior preset). | runtime builder, `src/sdk/*` | M | P1-8 |
| P2-8 | Voxel worlds in drafts | Build mode's "Download world" (pause menu) gains "Save to draft" → voxel RLE into the active GameDoc; voxel drafts re-open from data (P1-5). Big worlds route to file export, not URL. | `src/runtime/runtime.ts` | M | P1-5, P2-5 |

## Phase 3 — The Studio (in-world 3D creation for non-programmers)

**Goal:** build a real game — parts, terrain, logic — entirely inside the
3D world, no text files.

**Gate:** a non-programmer assembles an obby in the Studio (platforms, a
moving platform, lava, a button-opens-door rule), test-plays it, and shares
the link.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P3-1 | Runtime decomposition | Pay the debt `ARCHITECTURE.md` names: split the `runGame` monolith's HUD/chat/pause concerns into internal runtime systems on the `GameSystem` lifecycle. Pure refactor; all six games run identically. | `src/runtime/systems/{hud,chat,pause}.ts` (new) | L | P1-3 |
| P3-2 | Build-mode extraction | Move the voxel build mode out of `runtime.ts` into a runtime system — the seed of the Studio's edit mode. | `src/runtime/systems/buildmode.ts` (new) | M | P3-1 |
| P3-3 | Studio session | `#/studio/{draftId}`: the runtime over a draft GameDoc in edit mode — fly camera, no death/combat. Edits are doc-ops applied incrementally to the live `PartsWorld` (full world rebuild = the always-correct fallback; worlds are small). | `src/studio/studio.ts` (new), `src/main.ts` | M | P3-1, P2-5 |
| P3-4 | Placement + part palette | Catalog UI of parts/prefabs (all builder verbs + P2-7 interactives), ghost preview, grid snap, click-to-place → writes `DocPart`s into the draft. | `src/studio/palette.ts` (new) | L | P3-3 |
| P3-5 | Select / transform / undo | Raycaster click-select, move / rotate-Y / resize / duplicate / delete, command-stack undo/redo over GameDoc operations (the reason edits are doc-ops, not mesh-ops). | `src/studio/tools.ts` (new) | L | P3-4 |
| P3-6 | Properties panel | Edit selection: color, material (registry-aware), behavior (BehaviorDef forms), tag/id. Live-applies + writes the doc. | `src/studio/panels.ts` (new) | M | P3-5 |
| P3-7 | Logic editor v1 | Visual rule builder bound to selection: "When [this part] is touched → [open door 'gate1'] + [toast 'Unlocked!']". Pick-part-by-clicking fills references. Same Rule schema as P1-8 — the Studio is just a nicer pen. | `src/studio/panels.ts` | L | P3-5, P2-6 |
| P3-8 | World settings panel | Lighting/sky preset picker, physics sliders (gravity/jump/speed), killY, click-to-set spawn, camera mode, combat toggle + weapon checklist from the weapon registry. | `src/studio/panels.ts` | M | P3-3 |
| P3-9 | Test-play toggle | One key flips Studio ⇄ play of the same doc and back, preserving edit state — the "Play Solo" moment, the core creator feedback loop. | `src/studio/studio.ts` | M | P3-3 |
| P3-10 | Procedural thumbnails | One offscreen render → small dataURL in `doc.meta.thumb`; used by My Games and (later) discovery cards. Keeps the no-binary-assets policy — thumbnails are generated. | `src/studio/studio.ts` | S | P3-3 |

## Phase 4 — Publish & discover (tiny backend)

**Goal:** one click publishes a GameDoc to a hosted gallery anyone can
browse and play; creators keep edit rights via token — no accounts yet.

**Gate:** publish from the Studio; a friend on another network plays
`https://host/#/play/g/abc123`; the play counter increments on the
creator's dashboard.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P4-1 | Server: HTTP + SQLite | One process serves `dist/` static + REST + the existing WS. SQLite via built-in `node:sqlite` (Node ≥ 22.13; zero native deps, keeps the dependency moat). Schema: `games(id, doc, name, author_name, created, updated, plays, likes, hidden, edit_token_hash)`. | `server/{http,db}.mjs` (new) | M | — |
| P4-2 | Publish API | `POST /api/games` → `{id, editToken}`; `PUT /api/games/:id` requires the token. Server-side `validateGameDoc`, 256KB doc cap, string sanitization (reuse the `cleanName` approach). | `server/http.mjs` | M | P4-1, P1-6 |
| P4-3 | Publish from Studio | Publish / Republish / Unpublish buttons; edit tokens in `boxcade.publishTokens`; "published" badge + copyable canonical link on My Games cards. | `src/studio/studio.ts`, `src/portal.ts` | M | P4-2, P3-3 |
| P4-4 | Discovery + play route | `GET /api/games?sort=new\|plays\|likes` → portal "Community" grid beside the built-ins; `#/play/g/{id}` fetches → validates → interprets → runs. | `src/portal.ts`, `src/main.ts` | M | P4-1 |
| P4-5 | Plays, likes, creator dashboard | Debounced `/play` + one-per-device `/like`; `#/me` lists your published games with stats — the visibility loop that makes creating feel alive. | `server/http.mjs`, `src/portal.ts` | M | P4-4 |
| P4-6 | Report + moderation basics | `/report`, `hidden` flag, `ADMIN_TOKEN`-gated list/hide endpoints, shared word-filter for names/chat/meta. All-procedural assets already remove the worst UGC moderation surface (no image uploads). | `server/moderation.mjs` (new) | M | P4-4 |
| P4-7 | Abuse guards | Per-IP rate limits on all write endpoints, body-size caps, schema rejection before the DB. | `server/http.mjs` | S | P4-2 |
| P4-8 | Deploy | Single-VM story: `vite build` + node server behind Caddy/nginx for TLS (wss). Dockerfile + deploy doc. First production deploy. | `Dockerfile` (new), `docs/DEPLOY.md` (new) | M | P4-1 |

## Phase 5 — Play together (multiplayer for UGC worlds)

**Goal:** friends share one room in the same published world, and the
world's logic visibly happens for everyone.

**Gate:** two browsers join the same published obby via a room code; player
A stands on the button, the door opens for both; in a sandbox world they
co-build voxels.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P5-1 | Room instances | The server keys rooms by bare gameId today (one global room per game). Migrate the join key to `gameId#instance` — auto-assign to the emptiest open instance under cap, or join an explicit code. Old clients land in instance 0 (protocol-compatible). | `server/server.mjs`, `src/engine/network.ts` | M | — |
| P5-2 | Room code UI | HUD shows the room code; game cards + share links accept `?room=CODE`; "Play with friends" copies a room-targeted link. | hud system, `src/portal.ts` | M | P5-1 |
| P5-3 | Generic game-event relay | New message `t:'e' {k,d}` — size-capped, rate-limited, broadcast to the room. Client `Net.sendEvent/onEvent` bridged onto the EventBus as `net:<k>`. The protocol stays game-agnostic; semantics live in game/rule data (preserves layering). | server, `src/engine/network.ts` | M | P5-1 |
| P5-4 | Replicated logic blocks | Rule actions gain `forEveryone: true` → broadcast via the relay and applied by all clients. The server marks the oldest member as **host** (`t:'w'` gains host); the host owns rule timers so doors/waves don't double-fire. Coins/personal progress stay local. | `src/sdk/rules.ts`, server | L | P5-3, P1-8 |
| P5-5 | Doc-version-keyed rooms | Published-game joins include a doc hash (`gameId#instance#docHash`) so players on stale cached versions split into separate instances instead of desyncing. | network, codec | S | P5-1, P4-4 |
| P5-6 | Co-build voxel relay | Sandbox worlds broadcast voxel set-ops; late joiners get edits-since-load from the host. Voxel Island — and every UGC sandbox — becomes a shared canvas. | buildmode system, network, server | M | P5-3, P3-2 |
| P5-7 | Presence polish | Tab player-list overlay, join/leave feed, remote cosmetics (equipped shirt color travels in the join message). | hud, network, server | S | P5-1 |

## Phase 6 — Creator economy + server authority

**Goal:** creating pays (in Bolts), identity persists, and human-vs-human
combat is real and fair enough.

**Gate:** two humans damage each other in a published arena map; a
creator's wallet visibly grows because strangers played their game.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P6-1 | Identity: device key → account | Anonymous device key first; optional upgrade to a named account (username+token or passkey) that claims existing publishes/wallet. Accounts-later was the deliberate P4 simplification; this closes it. | server, `src/portal.ts` | L | P4-1 |
| P6-2 | Server wallet | Bolts move server-side (localStorage stays the offline fallback): `economy.ts` gets a sync backend; earn events batched + server-validated with per-source daily caps (anti-grind). | `src/engine/economy.ts`, server | L | P6-1 |
| P6-3 | Creator cut | Daily job: plays/likes/playtime → Bolts payouts to creators; earnings panel on `#/me`. Completes the flywheel: play → earn → create → earn more. | server, portal | M | P6-2, P4-5 |
| P6-4 | Procedural avatar expansion | Hats, faces, colors, trail variants — all procedural geometry/canvas, data-driven CATALOG; equipped cosmetics replicate (P5-7). More things to want = more reason to earn. | `src/engine/{economy,avatar}.ts` | M | P5-7 |
| P6-5 | HitResolver strategy seam | Extract local hit resolution (`combat.ts` fire/hitscan/damage) behind a `HitResolver` interface — the swappable-strategy refactor `ARCHITECTURE.md` already plans. Local resolver = current behavior; offline/bots unchanged. | `src/engine/combat.ts` | M | — |
| P6-6 | Server-arbitrated PvP | Remote humans become damageable: clients claim hits via the relay; the server sanity-checks (fire-rate, range, victim-position plausibility), owns the health ledger, broadcasts damage/kill/respawn. Arbitration only — not full server physics. | combat, network, server | L | P6-5, P5-3 |
| P6-7 | Per-game leaderboards | Server-stored top scores/times per published game; rule action `submitScore`; board on game cards + end-of-round HUD. | server, rules, portal | M | P6-1 |

## Phase 7 — Raising the ceiling (sandboxed scripting + scale + reach)

**Goal:** power creators escape the logic-block ceiling safely; rooms get
bigger; players on more devices.

**Gate:** a published game runs a creator-written script in a locked-down
Worker (something logic blocks couldn't express), with a CPU watchdog
killing a deliberate infinite loop.

| ID | Task | What / why | Key files | Size | Deps |
|---|---|---|---|---|---|
| P7-1 | Scripting threat model + API design | Design doc before code: Web Worker isolation (no DOM/net/storage), message-only capability API mirroring the rule-action vocabulary, CPU watchdog (terminate + respawn), memory caps, per-game permission prompt. Evaluate QuickJS-in-WASM as a hardening step. | `docs/SCRIPTING.md` (new) | M | P1-8 |
| P7-2 | Worker script host | `ScriptSystem` (a GameSystem) bridging the Worker ⇄ EventBus + a whitelisted `GameContext` subset; scripts ship in the GameDoc `script` section (string, size-capped, server-validated). | `src/sdk/script-host.ts` (new) | L | P7-1 |
| P7-3 | Script editor panel | Studio code panel with examples + API reference; the publish flow flags scripted games in discovery (player-visible trust signal). | studio panels, server | M | P7-2 |
| P7-4 | Interest management | Server-side spatial filtering of state fan-out (only nearby players at full rate) to raise the 30-player cap. | server, network | L | P5-1 |
| P7-5 | Touch controls + responsive HUD | Virtual joystick + touch-look + tap-jump, responsive HUD for small screens. Roblox's audience is heavily mobile; browser touch is in scope — native apps are not. | `src/engine/input.ts`, hud system | L | P3-1 |
| P7-6 | WebGPU spike | `WebGPURenderer` behind a flag; measure on the six games; adopt only if the wins are real. | `src/engine/renderer.ts` | L | — |

---

## The five riskiest design decisions

1. **GameDoc schema versioning.** Once share links exist, docs live forever
   in URLs, files, and the DB — schema mistakes are permanent. Decision:
   integer `v` + a linear `migrateGameDoc()` chain (follow the existing
   `voxel-world/v1` self-identification pattern); unknown *fields*
   warn-and-ignore (old clients degrade gracefully), unknown *versions*
   hard-fail with an "update Boxcade" card; all extensible content
   (materials, weapons, tiles, behaviors, sky presets, rule actions)
   referenced by registry **name strings**, never by index. Canonical-JSON
   hash for doc identity (used by P5-5 room keying). P1-6 is the
   load-bearing wall — spend real review time there.
2. **Logic-block expressiveness ceiling.** Too weak → boring UGC; too
   expressive → an accidental unsandboxed language. Decision: flat
   `when/if/do` rules + named counters only in v1 — no nesting, no
   expressions, no string interpolation. Squadfall-class games stay
   first-party TS; Worker scripting (P7) is the designed escape hatch, not
   rule-language creep.
3. **Share-link size.** URL fragments technically hold ~64KB, but chat apps
   and proxies mangle long URLs around 2–8KB. Decision: native
   `CompressionStream('deflate-raw')` + base64url (zero new deps); hard cap
   encoded links at ~8KB with a graceful fallback chain: URL →
   `.boxcade.json` file → hosted `#/play/g/{id}`. Text-map/parts games
   compress to well under 2KB; voxel worlds route to file/hosted paths.
4. **Room instancing + host model.** Decision: keep the wire field `g`, its
   value becomes `gameId#instance[#docHash]` — protocol-compatible, old
   clients land in instance 0. The server stays a dumb relay through P5;
   the consistency model is explicitly "host-trusted, last-write-wins"
   (server marks the oldest member as host; the host owns rule timers).
   Cheap, honest, and fine at ≤ 30 players.
5. **Combat authority.** Full server-authoritative physics + rollback
   netcode is a multi-month rabbit hole that contradicts the offline-first
   design (`network.ts` silently falls back to solo). Decision: the
   `HitResolver` strategy seam (P6-5) with **server arbitration** — clients
   claim hits, the server validates rate/range/plausibility and owns the
   health ledger. Local resolver remains for offline/bots. Good enough
   against casual cheating at indie scale.

## Non-goals

- **No real-money payouts or purchases** — Bolts stay a closed loop
  (avoids payments/legal/fraud surface entirely).
- **No binary asset uploads** (models, images, audio) — all-procedural is
  the moderation and IP moat; cosmetics and thumbnails stay generated.
- **No user code execution before Phase 7**, and never main-thread/eval —
  logic is data until the Worker sandbox ships with its threat model.
- **No full server-authoritative physics or rollback netcode** —
  arbitration only.
- **No native/mobile apps** — browser-first; touch controls are P7-5, app
  stores are not.
- **No friends lists/DMs/SSO** — room codes are the social mechanism.
- **No new engine genres** (vehicles, slopes, ragdolls, 2D) — blocky
  character-controller games are the envelope the six games prove.
