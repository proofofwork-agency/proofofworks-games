# THE FRESH PRINCE OF PERSIA

A 2.5D side-scrolling platformer — 3D models and environments on a 2D gameplay plane —
that remixes Jordan Mechner's *Prince of Persia* (1989) into a neon-soaked urban night in
"Persepolis Heights". You are FRESH: backwards cap, gold chain, teal hoodie. DJ Vizier
stole the Golden Mixtape and you have five minutes to take it back.

## Run it

```bash
cd fresh-prince-of-persia
python3 -m http.server 8462
# open http://localhost:8462
```

Any static file server works (ES modules need http, not file://). Three.js loads from a CDN
import map — no install, no build step.

## Controls

| Key | Action |
| --- | --- |
| ← → / A D | run |
| SPACE / ↑ | jump · grab ledges · climb up |
| ↓ | let go of a ledge |
| X / J | swing sword |
| C / K | block (parry a telegraphed strike) |
| M | mute · R restart level · ENTER start |

## What's inside (authentic 1989 mechanics, remixed)

- **Cinematic platforming** — run, jump with coyote time, ledge grab + climb, fall damage.
- **The traps** — cycling floor spikes, gold chompers, crumbling slabs, pressure plates and gates.
- **Guard AI** — a probability-table state machine, like the original's: per-tier chances to
  strike, block your wind-up, advance and retreat on a decision clock. Patrol → alert (!) →
  chase → engage. Guards fear traps while patrolling but not while chasing — lure them.
- **DJ Vizier** — boss with headphones, shades and a gold scimitar who periodically *drops the
  bass*: an expanding shockwave ring you must jump over. Enrages below half health.
- **Seven levels** — streets, dungeon club, rooftops, the grand bazaar, an aqueduct,
  a vertical tower climb, and the boss penthouse.
- **The clock** — 8:00 for the whole run. Dying restarts the level; the clock keeps running.
- **The score** — an original Persian double-harmonic lead over a synthesized boom-bap beat,
  composed in WebAudio and generated live. Combat adds hats and an octave double. The boombox
  and DJ woofers pulse on the kick.
- **The look** — Three.js + UnrealBloomPass: torchlight, neon signage, graffiti tags, a
  domes-and-minarets skyline, stars, crescent moon, soft moonlight shadows, ACES tone mapping.

Engine: Three.js r160 for rendering; everything else (fixed-grid AABB physics, animation,
state machines, audio engine, particles) is a hand-rolled micro-engine in `src/`. Levels are
ASCII grids in `src/levels.js` — edit them with a text editor.

## Provenance & legal

- The original game's Apple II source (6502 assembly) was released by Jordan Mechner in 2012
  at `github.com/jmechner/Prince-of-Persia-Apple-II` for study only — *Prince of Persia* is an
  Ubisoft franchise. It was used here as **reference for mechanics only**; no code or assets
  were copied (nothing here is assembly).
- This is a non-commercial fan parody. All code, models, levels, text and music in this repo
  are original.
