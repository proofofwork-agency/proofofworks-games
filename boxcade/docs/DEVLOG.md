# Boxcade devlog

## 2026-06-10 (late evening) — git baseline, security hardening, runtime decomposition ✅

- **Git**: repo initialized; history starts at the verified W1–W6 baseline
  (`2954946`, 87 files). `.gitignore` covers DBs, snapshots, agent state.
- **Security hardening (automated review on the baseline commit, Claude):**
  `validateEmbedUrl` rejects userinfo + private/loopback/link-local
  IP-literal hosts; thumbnails must be ≤80KB png/jpeg/webp data-URIs (SVG
  data-URIs can carry markup) — enforced at publish (field stripped), read
  (`getGameMeta`) and render (portal allowlist regex); embed iframe gains
  `referrerpolicy=no-referrer`. +4 tests → 168.
- **Runtime decomposition (P3-1 + P3-2, Claude):** `runGame` shrank
  1710→1354 lines. New `runtime/systems/` on the `GameSystem` lifecycle:
  `hud` (shell, chips, toasts, loading, controls hint, fps meter + SSR
  guard), `chat` (box, open/close, lines — engine deps as thunks so HUD DOM
  order is unchanged), `pause`, `buildmode` (hotbar + break/place; updated
  at its original mid-frame spot so edit raycasts see the same camera
  state), `combathud` (health/ammo/weapon bar/kill feed/hitmarker/scope/
  respawn overlay — folded in as part of the HUD concern). Composition root
  keeps vehicles, remote LOD, and voxel co-build sync inline (physics-order
  coupled). Pure refactor: tsc clean, 168/168, zero console errors.
- Gate (chrome-devtools): Sky Obby — HUD chips + fps meter live, `/` chat
  sent "decomposition smoke test" into Room JZ8W, Escape pause + Resume;
  Voxel Island — crosshair + 8-slot hotbar, key `3` selected Stone;
  Squadfall — combat class, health 100→0→88 with respawn overlay
  shown/cleared, 7-weapon bar with lock states, kill feed ("Sable ⚔ Nyx").

## 2026-06-10 (evening) — Wave 2 / W5 embed + W6 scale takeover

**W5 external embeds:** `embed` publish type is in the DB/API (type+url
columns, existing rows remain `game`), embeds publish hidden until admin
approval, list/detail include type+url, Community cards badge external games,
and `#/play/embed/<id>` hosts a full-viewport sandboxed iframe. The
`public/boxcade-platform.js` SDK exposes `Boxcade.ready`, `awardBolts`, and
`submitScore`, queues calls until hello, clamps awards to 1–10/call, and pins
later sends to the platform origin. Audit correction: sandboxed embeds use
`sandbox="allow-scripts"` without `allow-same-origin`, so child messages have
opaque origin `null`; the canonical trust boundary is now iframe
`contentWindow` identity + required opaque origin + platform-side caps, with
`targetOrigin:"*"` only for the low-sensitivity hello reply.

**W6 scale:** server relay now honors per-room caps (`maxPlayers`, clamped
1–250, default 64) and interest-manages transform fan-out: nearby players
(~60m) receive full-rate dirty state, far players receive a 1Hz trickle.
Clients tolerate sparse state packets via the existing snapshot buffer.
Remote avatars switch to a procedural billboard impostor beyond 40m, skip
full mesh animation while far, cap remote avatar shadows to the nearest 24,
and hide avatar name/bubble/health sprites when the full avatar is hidden.
`GameDef.maxPlayers` / GameDoc `maxPlayers` validate and flow through
interpreter → client join → server cap. DOG: Squadfall declares
`maxPlayers: 64`.

**Bot harness:** `npm run bot-load -- --bots=N --duration=S --max=250`
drives headless websocket clients against the relay. Fresh-port matrix on
`:8091`: 50/100/250 bots all welcomed, zero errors; receive throughput was
~3.8 / 15.6 / 97.3 Mbps over 7s windows. Static evidence so far:
`tsc --noEmit` clean, vitest **164/164**.

**Browser smoke (Claude, closes the W5+W6 gates ✅):** against `:8081`
restarted on the new server code — (1) embed `ckpmk2o` published via
`POST /api/games {embed}`, admin-unhidden, opened at `#/play/embed/ckpmk2o`:
iframe rendered `sandbox="allow-scripts"` only, the sandboxed child received
its HELLO (name/device/room) through the opaque-origin handshake,
`awardBolts(10)` credited the wallet 361→371 under the 30/min cap, and
`submitScore(12.3)` landed on the leaderboard
(`{"name":"Blox2588","score":12.3}`); (2) two-tab Sky Obby joined Room 9SDA
with 👥 2 on the interest-managed fan-out (near path live-verified; far path
+ caps covered by the bot matrix). Coordinator control returned to Claude
after the smoke, by human instruction. Snapshot: snap-9-w5w6-scale.tgz.
The approved test embed `ckpmk2o` stays in the local DB as a working
external-game demo.

## 2026-06-10 (midday) — Wave 2 / W2 + Studio UX sweep ✅

**W2 worlds & chaining (gate passed):** `portal` DocPart (strict target
grammar `g:<id>|draft:<key>|level:<n>|home`, glowing frame + touch slab),
`goTo` rule action, reserved `platform:` event prefix, `levels?: GameDoc[]`
(≤8, depth-1, meta/weapons/combat/physics/lighting inheritance),
`buildGameFromDoc(doc,{level})`, `WorldBuilder.portal` one-liner,
shell `handleGoTo` + in-place level relaunch with level-scoped room keys,
Studio Portal palette item + target editor + attach-draft-as-level Levels
section. Dogfood: Sky Obby summit portals to Castle Run (+1 line; return
portal deliberately skipped — would break the castle parity golden test and
`play:` targets are code-game-only by design). FIXED during gate: level
numbering off-by-one between Studio copy and interpreter (now HUMAN
numbering: level 1 = the game, level 2 = first added level) and a
relaunch-forever loop when a goTo targeted a missing level (guard added;
found via ~15 renderer boots in the console). Gate evidence: published
"Level Hopper" auto-ran root → level 2 (night, "🌑 LEVEL TWO!" toast
captured) → home in 10s.

**Studio UX sweep (user playtest asks):** right-drag now ORBITS 360° around
the selected part (scroll dollies, no snap on selection change; free-look
otherwise); rotate `[`/`]` + rotate° field extended to door/mover/button/
portal (visual-only — collision stays AABB, hinted in-panel); `+`/`-`
grow/shrink ×1.15 for sizes/scales/radius, undoable per press. **Map Editor
merged INTO the Studio:** the painter is now a mountable component
(`mountFloorPlan` in editor.ts) hosted as a Studio overlay — painting tiles
is a doc-op (3D rebuilds live behind the panel, undo works); space-drag /
middle-drag PANS the grid; `#/editor` remains a thin standalone wrapper;
portal "New map" → `#/studio/<key>?floorplan=1`. Avatar fixes from
playtest: face-plane z-fight seam (gap + polygonOffset), coplanar hand
flicker (proud cuff), water: dig-below-sea-level floods (replicated) + no
phantom water walls at world edge. 112/112 tests; in-Studio overlay
verified live (overlay+grid+active button+starter textmap+3D behind).

## 2026-06-10 (morning) — Wave 2 / W1: Studio Comprehensive ✅ (gate passed)

- **Custom weapons-as-data**: GameDoc `weapons: WeaponDef[]` (≤12, validated
  ranges, slug ids) registered as `<gameId>:<id>` at interpret with
  combat/weaponSpawn references auto-rewritten; `GameDef.weapons` gives code
  games the same one-liner (runtime registers at session start).
- **Rules v2**: multi-action rules in the Studio (≤6 rows, per-action
  "everyone" forEveryone toggle), new triggers `checkpoint` (new
  `player:checkpoint` event) + `hurt`, new actions `givePoints`/`restart`/
  `celebrate`.
- **Studio**: Combat panel (arsenal/start checklists, health, infinite ammo,
  team), Weapon designer (full hitscan/projectile forms, customs appear in
  arsenal + weapon-pad dropdowns), Terrain section (voxel island seed/size,
  palette entry), F = focus selected, grid-snap toggle 0.5⇄0.1, part-count
  chip.
- **Templates**: "New in Studio" chooser — Blank / Classic Obby / Bot Arena /
  Voxel Sandbox / Parkour Tower (all validateGameDoc-clean).
- **Dogfood (one-liners, line counts guarded)**: Facing Towers + Storm
  Crossbow (+1.4%), Squadfall + Scrap Cannon in uncommon loot (+0.3%).
- Verified: tsc + **88/88** + build; browser gate — tower template + custom
  Zapper published (`hyc4uwc`) and played: weapon bar shows Sidearm+Zapper,
  checkpoint rule fired givePoints+toast (score chip = 5). Snapshot
  snap-4-w1.tgz.


Working notes from roadmap execution — what shipped, what was decided, how it
was verified. Newest phase first. (Roadmap: docs/ROADMAP.md.)

## 2026-06-10 (overnight) — Phase 1 + Phase 2

Autonomous overnight run (human asleep; "make the big choices" authorized).
Standing constraints honored: **no git commits** (git writes stay with the
human/coordinator; rollback tarballs in /tmp/boxcade-snaps instead) and **no
external deploy**.

### Phase 1 — game-as-data foundation ✅ (gate passed)

Shipped:
- `.gitignore`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`, vitest 4.1.8,
  `npm test`. Repo still has zero commits — first commit is the human's.
- **Behaviors-as-data** (`src/engine/world.ts`): `BehaviorDef` +
  `registerBehavior`/`behaviorFromDef` registry mirroring `registerMaterial`;
  spin/patrol/orbit/bob registered. `PartDef.behavior` itself was left
  closure-typed — defs are converted at the SDK/interpreter layer instead
  (deviation from ROADMAP P1-4's letter, same capability, smaller surface).
- **Voxel loader** (`src/engine/voxel.ts`): `VoxelWorld.deserialize()` for the
  existing `voxel-world/v1` RLE format, with friendly errors;
  `voxelIsland({ data })` boots a saved world (`src/runtime/runtime.ts`).
- **GameDoc v1** (`src/sdk/gamedoc.ts`): the platform's interchange format —
  meta/camera/physics/lighting/killY/spawn/combat/textmap/parts/voxel/rules/
  vars. 17 DocPart kinds (14 world + button/door/mover interactive prefabs).
  `validateGameDoc` (friendly error paths, size caps as format contract,
  unknown fields/kinds/types warn-and-skip, newer versions hard-fail),
  `migrateGameDoc` chain stub, `slugifyName`. Spec: docs/GAMEDOC.md.
- **Rules engine** (`src/sdk/rules.ts`): flat `when/if/do` over the existing
  EventBus + part touches. Triggers: start/touch/timer/coin/kill/enterRegion/
  varReaches/event. Actions: toast/big/celebrate/win/kill/teleport/award/
  movePart/removePart/openDoor/spawnPart/setVar/addVar/sound/emit. Named
  counters with auto HUD chips; smoothstep part tweens; sound whitelist;
  reserved event prefixes can't be spoofed by `emit`.
- **Interpreter** (`src/sdk/interpret.ts`): `buildGameFromDoc` replays a doc
  through the same WorldBuilder verbs hand-written games call. Tagged
  textmap parts (D doors / P buttons) become rule-addressable via a wrapped
  builder. Build order: lighting → killY → textmap → voxel → parts →
  explicit `spawn` wins last.
- **Codec** (`src/sdk/codec.ts`): JSON → native `CompressionStream
  ('deflate-raw')` → base64url; `SHARE_LINK_LIMIT` 8KB; `hashGameDoc` for
  doc identity (room keying later).
- Tests: 76 passing across textmap/voxel/events/economy/gamedoc/codec/
  interpret + a no-DOM RecordingBuilder helper.

Gate evidence: `tests/interpret.test.ts` — **Castle Run rebuilt as a pure
JSON GameDoc places the identical world** (same verb counts, identical
sorted part positions, same lighting/killY/labels) as the hand-written TS
game. The fixture inlines the same `castle.txt?raw` import the real game
uses, so parity tracks the map file forever. Deviation: no separate
`#/play/dev-doc` route — the real share route `#/play/d/{payload}` shipped
directly instead.

Decisions of note:
1. Doc vectors are `[x,y,z]` arrays (compact in URLs, trivially validated);
   the SDK's `Vec3` objects stay engine-side. `v3FromDoc` converts.
2. Rule logic v1 has ONE flat vocabulary, no nesting/expressions — the
   ceiling is intentional (ROADMAP risk #2); Worker scripting is the later
   escape hatch.
3. Textmap doors/buttons share fixed tags (`door`/`button`) — one button
   opens all doors in a 2D-editor map. Per-part ids arrive with the Studio.
4. spawnPart action included (small win); rules can only address
   `kind:'part'`-backed entries (prefab internals stay engine-owned).

### Phase 2 — share anywhere ✅ (gate passed)

- Router split: `src/main.ts` is now routes-only (`#/`, `#/play/<id>`,
  `#/play/draft/<key>`, `#/play/d/<payload>`, `#/play/g/<id>`,
  `#/editor`, `#/studio[/<key>]`); portal + shop moved to `src/portal.ts`;
  friendly error card for bad/foreign/corrupt docs.
- `src/drafts.ts`: the My Games store — `boxcade.myGames` index +
  `boxcade.draft.<key>` GameDoc JSON; list/load/save/delete/duplicate/import.
- Editor (`src/editor.ts`) upgraded to GameDoc drafts: meta form
  (name/icon/genre/gradient/blurb), D door + P button tiles, Game Logic
  rules panel v0 (one trigger → one action per rule), Test play via the
  draft route, Copy share link / Download .boxcade.json / .txt, legacy
  `boxcade.editor.map` migration + custom-map write-through.
- Portal (`src/portal.ts`): My Games shelf — cards w/ Play / Edit (smart:
  textmap → 2D editor, 3D → Studio) / Share / Publish / Duplicate /
  two-step Delete; `.boxcade.json` import via picker + drag-drop;
  "New in Studio" + "New map" entry points.
- Voxel build mode → drafts (P2-8): `runGame` gained an injected
  `onSaveWorld` hook; built-in voxel games save a NEW draft, draft games
  update themselves in place.

Gate evidence (browser, chrome-devtools): a 386-char self-generated share
link decoded → validated → ran (room family auto-assigned). A hand-corrupted
link (1-char typo) rendered the friendly error card instead of crashing.

### Phase 3 — the Studio ✅ (MVP gate passed; 2 deviations)

`src/studio/` (studio.ts core + ui.ts panels + studio.css): a second
composition root that drives the engine subsystems directly over a GameDoc
draft. Fly camera (RMB-look + WASD/QE), 21-item palette (Build/Gameplay/
Combat/Decor incl. button/door/elevator), ghost-preview click-to-place with
grid snap (Shift = keep stamping, Alt = no snap), raycast select +
drag-move + arrow nudges + R/F raise/lower + rotate, Ctrl+D duplicate, Del,
command-stack undo/redo (Ctrl+Z/Ctrl+Shift+Z) — every edit is a doc-op on
the GameDoc (the scene is rebuilt from the doc each step). Right-hand tabs:
Part properties (pos/size/color/material/rotate/solid/bounce/spin/hover +
kind-specific fields + id/tag), World settings (meta, gradient swatches,
lighting, camera, killY, click-to-set spawn, physics sliders, combat +
reflections toggles), Logic (counters + visual when→do rule rows with
part-ref dropdowns). Test play round-trips through `#/play/draft/<key>`
with a "⬅ Back to Studio" pause action (`boxcade.returnTo`). Share = link
or .boxcade.json fallback. Procedural thumbnails (offscreen render →
`meta.thumb` dataURL) feed My Games + Community cards. Embedded textmap /
voxel sections render as read-only context (each edited in its own tool).

DEVIATIONS from ROADMAP: (1) P3-1/P3-2 (runtime decomposition + build-mode
extraction) deliberately deferred — a 1,200-line refactor with zero git
commits overnight was the wrong risk; the Studio didn't need it. (2) The
roadmap's "studio inside the runtime in edit mode" became "studio as its
own composition root" — cleaner and layering-legal.

Gate evidence (browser): palette → canvas click placed a grid-snapped part
(`parts 3 → 4` in the saved draft), autosave + JPEG thumbnail confirmed in
localStorage.

### Phase 4 — publish & discover ✅ (local gate passed; no deploy)

- `server/db.mjs`: node:sqlite (zero new deps; DB file gitignored next to
  the server). games/likes/reports tables; sha256 edit-token hashes;
  auto-hide after 5 distinct-device reports; admin list/hide.
- `server/http.mjs`: plain node:http API on the SAME port as the ws relay —
  GET/POST /api/games, GET/PUT/DELETE /api/games/:id (x-edit-token),
  /play /like /report counters, /api/admin/* (BOXCADE_ADMIN_TOKEN), CORS,
  per-IP token-bucket rate limits, 300KB body / 256KB doc caps, server-side
  doc sanity checks (full validation stays client-side at play time).
- `src/api.ts`: client + publish-token store (`boxcade.publishTokens`),
  6h-debounced play counting, device key for like/report dedup.
- Portal: 🚀 Publish/Republish on draft cards (copies the public link);
  "🌍 Community games" shelf with Newest/Most played/Most liked sorts,
  thumbnails (strict `data:image/` check), ♥ like toggle, ⚑ report.

Gate evidence: published via API (`ffk6xls`), republished with the edit
token, listed in the Community shelf with **▶ 1** (debounced play counter),
played via `#/play/g/ffk6xls` in the browser.

### Phase 5 — play together ✅ (gate passed in two browser tabs)

- Server rooms became INSTANCES: join spec `<gameKey>` auto-assigns to the
  fullest open instance, `<gameKey>#CODE` joins/creates that room; 4-char
  codes; the oldest member is HOST (`w` carries `host`, `h` re-announces on
  host leave). Generic event relay `t:'e' {k,d}` (≤2KB, ~10/s/client).
- Client: `Net.roomCode/hostId/isHost/sendEvent/onEvent/onHostChange`;
  runtime bridges relay events onto the bus as `net:<k>`; HUD shows
  `🟢 Room CODE ⧉` (click = copy invite link with `?room=`).
- Doc-hash room keys: shared links join `d-<hash>`, published games
  `g-<id>-<hash>` — stale doc versions split instead of desyncing.
- Replicated rules: actions with `forEveryone: true` broadcast `{ri,ai}`
  and apply on every client; HOST runs replicated timers (no double-fire).
- Voxel co-build: build-mode edits relay as `voxel [x,y,z,t]` set-ops
  (late-join backfill is a known gap — joiners co-build from join time).

Gate evidence (two Chrome tabs, same `?room=GATE`): 👥 2 + same room chip
in both; player B stepped on the button; player A's MutationObserver
recorded the replicated "🚪 The gate is open!" twice — touch trigger →
relay → remote rule application, end to end.

### Phase 6 + 7 (second overnight leg, ~05:40-06:10) — partial ✅

- **Server-arbitrated PvP (P6-5/6-6):** the local player's hitscan AND
  projectile shots (direct + splash) now also test interpolated remote-player
  hurtboxes (combat.ts `remoteTargets` injection); hits become CLAIMS
  (`t:'x'`) the server validates — ≤100 dmg/claim, per-attacker damage
  budget (220 burst / 120 hp·s refill), 260m range sanity, server-owned hp
  ledger with 4s respawn — then broadcasts verdicts. Victims take damage
  through the normal local pipeline (bar/vignette/death); remote avatars get
  health bars + hit flashes + death bursts; PvP kills pay 10 Bolts. Bots
  never shoot humans (unvalidatable). Server hp ledger is an anti-cheat
  ceiling, local hp stays display-truth (model documented here, divergence
  only relaxes PvP kills). NOTE: implemented + typechecked + server logic
  endpoint-smoked; a live two-human aimed-shots playtest is still owed.
  The full HitResolver strategy interface is folded into the decomposition
  debt — the seam today is the two injection points.
- **Creator cut (P6-3, lite identity P6-1):** plays pay +2 B$, likes +5 B$
  into a server `earnings` table; `GET /earnings` + `POST /claim` are
  edit-token-gated; "💰 Claim B$ N" appears on your published cards and pays
  into the local wallet. Full server wallet + accounts deferred (needs auth
  decisions a human should make).
- **Leaderboards (P6-7):** best win time per device per game (`scores`
  table, POST/GET `/scores`); the runtime fires `onVictory(seconds)` when
  Bolts are earned with reason 'victory' (win pads + win rules, code games
  included); published-game route submits automatically; 🏆 on community
  cards shows the top 5. Verified: "1. Nillo — 12.4s" renders.
- **Cosmetics (P6-4, agent):** catalog +7 items (4 procedural hats incl.
  animated halo, 3 canvas faces); independent equip slots; existing shop UI
  renders them with zero portal edits; self avatar wears them in-game.
  Remote-avatar cosmetics broadcast still unwired.
- **Touch controls (P7-5, agent):** `engine/touch.ts` — floating 8-way
  joystick, drag-look, jump/fire/zoom buttons, attaches only on touch
  devices; wired into the runtime. UNTESTED on a real device (no touchscreen
  here) — needs phone QA.
- **Scripting design (P7-1, agent):** docs/SCRIPTING.md — Worker isolation
  threat model; load-bearing calls: scripts are "programmable rules" reusing
  the rules action executor as the single choke point; honest gaps (no
  browser memory caps, blob-worker CSP inheritance); QuickJS as the later
  hardening swap behind the same protocol.
- **Voxel late-join backfill:** every edit (local + relayed) journals; the
  HOST replays the journal to new joiners in paced 100-edit batches under
  the relay budget. Caveat: a late joiner who becomes host only knows edits
  since their own join.

Not done: P6-2 full server wallet, accounts/passkeys, P7-2/3 worker host +
script editor, P7-4 interest management, P7-6 WebGPU spike, P4-8 deploy,
runtime decomposition.

### Verification summary (05:25)

`tsc --noEmit` clean · vitest **76/76** · `vite build` green · six built-in
games regression: Sky Obby played unmodified with the new room plumbing.
Snapshots: /tmp/boxcade-snaps/snap-{0-pristine,1-p1-gate,2-p5-gate}.tgz.

Known gaps / next session: runtime decomposition (old P3-1/2), studio
multi-action rules UI, voxel late-join backfill, server-side full-validator
port, moderation admin UI, leaderboards + creator Bolts cut (P6), scripting
threat model (P7-1), touch controls. NOT committed to git (zero commits in
repo — first commit belongs to the human/coordinator).

Interruption note: the 03:00–04:40 window hit the account session limit —
two agents died mid-task (their partial test files were completed by hand;
one wrong test assumption fixed: EventBus handlers fire in insertion
order). The JBreano dev server had taken port 5173 during the outage; it
was stopped and Boxcade's vite reclaimed the port (restart JBreano's with
`npm run dev` in its repo when needed).

## 2026-06-10 (day) — Wave 2: W1 Studio Comprehensive + W2 Worlds & chaining

(Logged retroactively at the start of the W3 session.)

### W1 — Studio Comprehensive ✅ (gate passed)

- **Weapons-as-data:** GameDoc `weapons: WeaponDef[]` (≤12, validated),
  registered namespaced `<gameId>:<id>` at build; Studio weapon designer
  (kind/damage/fireRate/pellets/projectile, icon picker); combat panel
  (arsenal checklist, startWeapons, health, infiniteAmmo, selfTeam).
- **Rules v2:** multi-action rules UI, `checkpoint`/`hurt` triggers,
  `givePoints`/`restart` actions.
- **Terrain section + templates:** voxel island controls in Studio; 5
  starter templates incl. Parkour Tower.
- **Dogfood:** Facing Towers crossbow + Squadfall scrapcannon as
  weapons-as-data one-liners (+1.4% / +0.3% line counts).
- Gate: published **Storm Tower** (hyc4uwc) with a custom Zapper + a
  checkpoint rule entirely from the Studio.

### W2 — Worlds & chaining ✅ (gate passed)

- `portal` DocPart kind + palette item; rule action `goToGame`; target
  grammar `g:<id>` / `draft:<key>` / `level:<n>` / `home` (+ code-game
  `play:<builtin>`); shell hook `RunGameOptions.onGoToGame`.
- Multi-level docs: `levels?: GameDoc[]` (depth 1, ≤8, inherited meta),
  in-place level relaunch with `-l<n>` room keys; Studio Levels section.
  FIXED off-by-one: level 1 = the game itself, level 2 = levels[0].
- Studio UX sweep: orbit-360 around selection, rotate `[`/`]`, +/- resize,
  Map Editor merged into Studio as the floor-plan overlay (paint = doc-op).
- Gate: **Level Hopper** (uyacgrq) root → L2 → home in 10s.
- 112/112 vitest · snapshot snap-6.

## 2026-06-10 (afternoon) — Wave 2: W3 Vehicles + W4 Services & store

First session pairing Claude (engine/runtime lanes) with Codex
(doc/Studio/server lanes) over ContextRelay — every Codex delivery audited
(diff read + full verification chain) before the next handoff.

### W3 — Vehicles & physics options ✅ (browser gate passed)

- **W3-1 (Claude):** AABB resolve extracted from `CharacterController.step`
  into free functions over a `KinematicBody` (`resolveY`, `resolveAxis`,
  `probeGroundBox`, `overlapsAny`, `collectAround`) — character and vehicles
  share the exact same collision rules. NEW tests/physics.test.ts (13).
- **W3-2 (Claude):** `engine/vehicle.ts` — car (drift grip, brakes bite
  harder, steering authority grows with speed), boat (buoyancy band at the
  waterline, thrust only in water; fixed: beached-scrape applied mid-bob
  killed thrust — now only when grounded on land), plane (lift scales with
  airspeed, stall → mush, fuel → glider), jetpack (worn not boarded, thrust
  + fuel, gentle fall, ground refuel). tests/vehicle.test.ts (14).
- **W3-3 (Claude):** E enter/exit with side-exit probing, HUD prompts +
  fuel chip, protocol field `[6] = vehicle type` (back-compat: old clients
  never read past `[5]`, omitted = on foot), remote vehicle meshes
  (procedural blocky car/boat/plane/jetpack in `engine/vehiclemesh.ts`),
  **claim system**: while a remote player drives, the local parked twin
  hides; abandoned rides respawn at their pad after 8s, so worlds
  re-converge without vehicle state sync.
- **W3-4 (Codex):** GameDoc `vehicle` kind (type required, speed 1–80,
  fuel 1–600) + interpreter + Studio Vehicles palette (Car/Jetpack/Boat/
  Plane with type-true defaults) + properties + 6 tests.
- **W3-5 (Codex doc-side / Claude engine-side):** per-part `hitbox`
  override (collide ≠ visual), `gravityZone` part kind (non-solid gravity
  multiplier region, `PartsWorld.gravityAt`), `physics.fallDamage` (hp via
  the FALL_WEAPON pipeline in combat games, screen shake otherwise);
  Studio Low-G Zone palette item + fall-damage checkbox + 7 tests.
- **DOG:** Voxel Island `w.vehicle('car'|'boat', …)`, Squadfall jetpack
  pads — one-liners. Starter untouched.
- Gate (chrome-devtools, two tabs, test draft): car E-enter → drive off a
  6m deck → land → exit/re-enter → circle; jetpack wear → climb → fuel
  10→0 → gentle fall; tab 2 saw the remote car + driver nametag with its
  local pad twin hidden (claim), 👥2; gravityZone region rendered. Server
  restarted for the protocol field.

### W4 — Platform services & per-game Bolts store ✅ (browser-verified)

- **Contract (Claude):** `GameServices`/`StoreItemDef` in the SDK;
  `GameDef.services` (chat / leaderboard / store of cosmetic recolors).
- **Codex lane:** GameDoc `services` validation (store ≤8, unique slug ids,
  name ≤24, kind shirt|trail, hex color, integer price 1–500), interpreter
  passthrough, Studio Services section (toggles + store item editor),
  server `POST /api/games/:id/store-credit` — hardened beyond spec: item
  id + price validated against the *published doc* before crediting 30%
  (unauthenticated endpoint stays bounded), separate 20/h/IP token bucket,
  `creditStoreEarnings` wrapper over the existing earnings accrual. +6
  tests (158 total).
- **Claude lane:** runtime honors services (chat hidden+disabled,
  leaderboard submit gated), `runtime/store.ts` buy/equip overlay
  (persists per game in `boxcade.store.<id>`, wallet via new
  `economy.spend`, `Avatar.setShirtColor` swaps shared materials, store
  trail recolor overrides the global cosmetic), `RunGameOptions.onStoreBuy`
  → shell credits creators on published games; docs/PLUGINS.md (the
  registries/events/systems/services ARE the plugin API + worked example +
  npm `boxcade-sdk` boundary audit: sdk/ + 6 leaf engine modules, three.js
  as peer dep, no architectural blockers).
- **DOG:** Sky Obby + Voxel Island `services:` blocks (leaderboard + 2
  recolors each). Verified live: Store chip → overlay → buy Lava Runner
  Shirt B$333→308 → Equipped ✓.
- Known gaps: store cosmetics don't broadcast to remote avatars yet (same
  gap as hats/faces); touch devices have no E-key for vehicles yet.
