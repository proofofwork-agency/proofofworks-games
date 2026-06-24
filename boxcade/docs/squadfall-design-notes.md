# Squadfall Island — design notes

Design research for `src/games/squadfall.ts`, compiled 2026-06-09/10 from public
documentation of popular squad-respawn ("resurgence-style") battle royales.
These are *genre conventions* — numbers we tuned to Blobcade scale. All names,
geometry and rules expressed in the game are Blobcade originals.

## The island

Small (sub-500m) island, a central prison-style tower as the navigation
landmark, ringed by themed districts: labs, chemical works, industry, a dock
with a freighter, a satellite stronghold with helipad, a surveillance tower,
a factory, living quarters, a harbor and a small outpost. Compact enough that
every fight is reachable in under a minute.

## Squadfall rules (squad-respawn royale)

- Squads of 3; while ≥1 squadmate lives, dead members **redeploy from the sky**.
- Redeploy timer grows with the match: **15s → 22s → 30s → 39s** by circle
  phase. Squad kills shave **−7s** off pending timers.
- Respawns shut off permanently in the late circles (phase 4 here).
- No second-chance arena: when a whole squad is down at once, it's eliminated.
- Win: last squad standing. Target match length: 4–7 minutes (arcade pace).

## Dropping in

- Match opens with every squad parachuting in from its own compass heading.
- Redeploys also arrive by parachute, near the current safe circle.
- Implemented with `EntityApi.deploy()` — a slow-fall clamp until touchdown.

## Loot economy

- **Rarity ladder** gray → green → blue → purple → gold; better tiers carry
  better weapons plus armor and cash.
- Lootboxes scattered per district; reopen ~30s after being looted. Bots loot
  them too.
- Fixed weapon pads on landmark roofs/piers (rockets, sniper, shock, minigun,
  flak, pulse) + ammo crates + health packs — engine pickups on timers.
- Cash: ~$500 start, ~$800 per elimination, $200–1200 from crates.
- **Buy stations** (gold pads): armor plate +50 ($1000), munitions restock
  ($500), **squad buyback** — instantly redeploy a dead teammate ($4000).

## Health model

- Base **100 hp**, regenerates after ~5s without damage.
- **Armor plates** overheal above base up to **250 effective hp**; armor never
  regenerates (implemented as `heal(50, capTo: 250)`).

## Gas circle

- Phase plan (radius / hold / shrink seconds): 72/45/18 → 48/35/16 → 32/28/14
  → 20/24/12 → 10/20/10 → 4/end.
- Damage outside the ring starts ~8 hp/s and ramps ~+4 hp/s per phase.
- Ring rendered as a rotating fence of neon pillars; squads outside the ring
  path back toward the center automatically (bot objective override).

## Controls (engine defaults)

WASD move · Space jump · hold LMB fire · RMB zoom (sniper) · 1–7/scroll
weapons (only ones you hold) · walk over pads/crates to loot · R reset ·
/ chat · M mute.
