# Open-sourcing Boxcade (ex-FreeBlox) — landscape & IP review

Reviewed 2026-06-10. Question: are there comparable projects, and can this repo
be open-sourced without copyright/trademark problems?

## TL;DR

**Yes, you can open-source it — the code, mechanics and assets are clean.**
The risk surface was entirely **names**. Status after the 2026-06-10 cleanup:

1. ✅ **"Rebirth Blox" → "Squadfall Island"** — renamed, and all franchise
   references scrubbed from titles, UI strings and code comments. (Context:
   Activision C&D'd a fan Warzone revival in Feb 2026, so this mattered.)
2. ✅ **"BloxCraft Island" → "Voxel Island"** — removed the Blox+craft double
   mark. ✅ **"FreeBlox" → "Boxcade"** (2026-06-10, second pass): although
   "blox" was legally defensible (no standalone BLOX registration; descriptive
   fragment; crowded field), the owner decided a brand you can't *own and
   enforce yourself* isn't worth building on. "Boxcade" is a coined word with
   zero collisions found (engines/products/trademarks) — registrable.
   Currency "Blux" → "Bolts" (kills the Robux echo; B$ symbol kept), and
   "Facing Blox" → "Facing Towers". Old localStorage wallets auto-migrate.
3. ✅ Engine/README copy genericized (genre language instead of naming
   Roblox/Minecraft/Unreal); Facing Blox header reworded; the homage stance
   (original names/assets, archetype-as-idea) is documented in the README's
   "License, inspirations & disclaimers" section.
4. ✅ **MIT LICENSE added** + `"license": "MIT"` in package.json.

Note: we do **not** use Unreal Engine — no Epic engine, code or assets — so no
UE EULA/royalty applies. `UnrealBloomPass` is a three.js (MIT) addon class
name we import, not Epic code.

## 1. Is there anything else like this?

The "open-source Roblox-like in the browser" category exists but is thin —
nobody combines a game **portal + defineGame SDK + arena-shooter combat + a
post-processing stack (bloom/GTAO/SSR)** in pure TypeScript/three.js the way
this repo does:

| Project | What it is | License/status |
|---|---|---|
| [Notblox](https://github.com/iErcann/Notblox) | Three.js + TS multiplayer "Roblox-like", ECS + Rapier physics | Open source, closest analog |
| [Clawblox](https://github.com/nacloos/clawblox) | Rust + three.js Roblox-like for embodied AI agents | Open source |
| Librebox | "Roblox-compatible" engine reimplementation (Luau API) | Open source; riskier posture than ours (API compatibility) |
| [voxel.js](http://voxel.github.io/voxeljs-site/) / [Voxelize](https://github.com/kevzettler/multiplayer-voxel-browser-game-engine) | Browser voxel engines/frameworks | MIT-era ecosystem, mostly dormant |
| Luanti (ex-Minetest) | The flagship open-source "Minecraft-like platform + modding API" | LGPL, native not browser |
| Bloxd.io | Commercial browser voxel Roblox-like | **Closed source** — proof the niche has an audience |
| PlayCanvas / Babylon.js / Godot | General engines (web-capable) | MIT/Apache — engines, not platforms |

Takeaway: FreeBlox's niche (batteries-included *platform* with games, economy,
text-map editor and an FPS layer) is genuinely under-served in open source.
That's an argument **for** open-sourcing: there's room to be the reference
project, the way Luanti is for the Minecraft-like space.

## 2. What's clean

- **Code provenance**: written from scratch in this repo; no copied code, no
  decompiled anything (contrast: Eaglercraft-style projects, which ship
  derived Mojang code — we are nothing like that).
- **Dependencies**: `three` (MIT, incl. the addons we use — EffectComposer,
  UnrealBloomPass, GTAOPass, SSRPass), `ws` (MIT), Vite/TS dev deps
  (MIT/Apache-2.0). All compatible with any mainstream OSS license.
- **Assets**: every model, face, sound and map is procedurally generated in
  code. There are zero imported art/audio files to clear.
- **Game mechanics**: CTF, resurgence respawns, armor plates, buy stations,
  loot rarities, gas circles — *mechanics and rules are not copyrightable*
  (only their specific expression is, and ours is original blocky geometry
  with original names).
- **No secrets** in the repo (scanned); `package.json` is `private: true` so
  it can't be accidentally npm-published.

## 3. The risk surface (names & framing)

### 3.1 Rebirth Blox — fix before publishing 🔴

- "Rebirth Island", Verdansk, and Warzone are Activision IP, and in
  **February 2026 Activision C&D'd the fan "Classic Warzone" revival** that
  featured Rebirth Island ([Dexerto](https://www.dexerto.com/call-of-duty/activision-responds-after-shutting-down-fan-made-classic-warzone-revival-with-cease-and-desist-3317710/),
  [GameRant](https://gamerant.com/activision-shuts-down-classic-warzone-fan-project/)).
  That project used actual game builds — far worse than our case — but it
  shows active, current enforcement appetite around this exact franchise.
- Our exposure is *not* the mechanics or the blocky island (original
  expression), it's: the **title containing "Rebirth"**, and marketing the
  game as a "remake of Rebirth Island". That's a trademark / trade-dress
  invitation, not a copyright problem.
- **Action before open-sourcing**: retitle (e.g. *Resurgence Isle*,
  *Prison Island*, *Last Squad Island*), rewrite the meta blurb and code
  comments to say "resurgence-style battle royale on a prison island", and
  keep `docs/rebirth-island-research.md` purely factual (naming a game to
  describe what inspired you is nominative use and fine in docs; using their
  mark as your *product name* is not).

### 3.2 FreeBlox / "blox" — watch, don't panic 🟡

- **Verified 2026-06-10: Roblox Corporation holds no standalone "BLOX"
  trademark registration** ([USPTO portfolio](https://uspto.report/company/Roblox-Corp) —
  ROBLOX word/logo marks only; even "BLOXY COLA" went abandoned). "Blox" is a
  phonetic spelling of "blocks" — descriptive for block-building games — and
  the field is crowded (Bloxd.io et al.), so the fragment alone is weak ground
  for a claim. Decision: **keep "blox"** in FreeBlox/Facing Blox.
- Roblox bans "Blox"-similar names **on its own platform** ([usage guidelines](https://en.help.roblox.com/hc/en-us/articles/115001708126-Roblox-Name-and-Logo-Community-Usage-Guidelines));
  that policy doesn't govern the open web, but Roblox Corp does hold the
  ROBLOX marks and polices lookalikes. Counter-evidence: **Bloxd.io** operates
  as a large commercial "blox"-named browser game without apparent issue.
- Residual confusion risk lives in the *combination*, not the word: "FreeBlox"
  can be read as "free Roblox", and the "Blux" currency echoes "Robux". If the
  project commercializes or grows a brand, the cheapest de-risk is renaming
  the currency (one file + UI strings); a platform rebrand only becomes a
  question if an actual C&D arrives.
- "BloxCraft" stacks a second mark family; Mojang's
  [usage guidelines](https://www.minecraft.net/en-us/usage-guidelines) mainly
  require not implying affiliation. "…craft" names are extremely common.
- **Action**: keep the names if you like them, but (a) add a prominent
  "not affiliated with Roblox/Mojang/Activision/Epic" disclaimer to the
  README, and (b) accept that a future C&D would mean renaming — cheap for a
  repo, expensive for a brand, so decide before it *becomes* a brand.

### 3.3 Facing Blox / UT — already handled 🟢

README "Licensing notes" documents the analysis: the two-towers-in-space
*archetype* is an idea; every name, asset and map cell here is original.
Same posture games like TF2/OW take borrowing each other's modes.

## 4. License recommendation

- **MIT** — matches the three.js ecosystem, simplest possible terms,
  maximizes adoption and contribution. This is what I'd pick.
- Alternative: **AGPL-3.0** if you want anyone hosting a modified server to
  publish their changes (Luanti-style copyleft community). Heavier, deters
  commercial tinkering.
- Either way add: `LICENSE` file, `license` field in package.json, and a
  README **Disclaimers** section (non-affiliation + "inspired-by" framing).

## 5. Pre-publish checklist

- [x] Rename Rebirth Blox → **Squadfall Island** + scrub franchise references
      from strings/comments; research doc genericized to
      `squadfall-design-notes.md`. (2026-06-10)
- [x] Rename BloxCraft Island → **Voxel Island**; genericize engine/README
      copy that name-dropped other platforms. (2026-06-10)
- [x] Add LICENSE (MIT) + package.json `"license": "MIT"`. (2026-06-10)
- [x] README: "License, inspirations & disclaimers" section with
      non-affiliation block. (2026-06-10)
- [ ] `git init` + first commit + GitHub repo (git writes = Codex/human per
      repo policy; publishing is a human decision).
- [ ] Optional: CONTRIBUTING.md + screenshots/GIF for the README.

## Sources

- https://github.com/iErcann/Notblox
- https://github.com/nacloos/clawblox
- http://voxel.github.io/voxeljs-site/
- https://github.com/kevzettler/multiplayer-voxel-browser-game-engine
- https://www.dexerto.com/call-of-duty/activision-responds-after-shutting-down-fan-made-classic-warzone-revival-with-cease-and-desist-3317710/
- https://gamerant.com/activision-shuts-down-classic-warzone-fan-project/
- https://en.help.roblox.com/hc/en-us/articles/115001708126-Roblox-Name-and-Logo-Community-Usage-Guidelines
- https://devforum.roblox.com/t/am-i-allowed-to-use-the-word-blox/2586921
- https://www.minecraft.net/en-us/usage-guidelines
