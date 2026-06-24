---
sidebar_position: 3
description: The 2D Map Editor — a visual painter for the text-map format, with form-field tuning and instant test-play.
---

# 2D Map Editor (visual painter)

The **Map Editor** is a visual painter for the [text-map format](./text-maps.md). No code,
no coordinates to memorize — click tiles from a palette, stack floors, resize the grid,
tune physics/lighting with form fields, then **▶ Test play** drops you straight into your
map.

The editor reads and writes the **exact same text format** as an ASCII `.txt` file. There
is a live textarea at the bottom that *is* the map file, synced in both directions — paint
with the mouse and watch the text update; paste an existing map in and watch the grid
rebuild. Round-trips losslessly.

## Open it

From the portal, open **🗺 Map Editor** (`#/editor`), or click **Edit** on a text-map game.
It also opens as an overlay inside the [3D Studio](./studio-3d.md) ("Floor Plan" view), where
painting tiles rebuilds the 3D scene live.

### Draft lifecycle

The editor is draft-based (it wraps your map in a `GameDoc`):

- `#/editor?draft=<key>` edits a specific draft.
- `#/editor` (no param) continues your **last-edited** draft if one exists, otherwise
  starts a fresh one.
- Every change **auto-saves** (debounced). First save assigns a key reflected into the URL
  so reloads stay on the same draft.
- Templates are included: **Castle Run** and **Facing Towers** — load one and remix.

## The palette

A click picks a tile; paint on the grid to place it. The palette covers every built-in tile
(see the [ASCII legend](./text-maps.md#tile-legend)): Stone, Grass, Planks, Brick, Ice,
Neon, Metal deck, Lava, Bounce, Coin, Tree, Checkpoint, **Door**, **Button plate**, Spawn,
Win pad, Health, Ammo crate, Red/Blue flag, Red/Blue spawn, and height columns (Wall ×1–4,
Tower ×6/×9). **Erase** is the `.` void tile.

The interactive tiles pair with the no-code rules panel:

- **Door** (`D`): a gate block rules can open (shared tag `door`).
- **Button plate** (`P`): touching it fires "the button was touched" rules (tag `button`).

## Stacking floors & resizing

- **Floors**: add a new floor (a `---` layer) and paint the level above/below. Each floor
  lifts by `@layerstep` (default 4 m).
- **Resize the grid**: grow/shrink the tile grid directly.
- **Snap alignment** is automatic — one character is one `@cell`-sized tile (default 2×2 m).

## Tune the game (form fields)

Instead of editing `@directives` by hand, set them with form fields:

- **Lighting** — `noon` / `morning` / `goldenHour` / `night` / `space`
- **Gravity** · **Jump power** · **Walk speed** — movement tuning (writes `@gravity` /
  `@jump` / `@speed`)
- **Kill Y** — the fall-death height (`@killy`)

These write the same directives the text format uses, so a hand-edited map and a painted
map are indistinguishable.

## No-code game logic (rules)

The editor includes a **Game Logic** panel for declarative `when / if / do` rules — the
same rules a [GameDoc](./gamedoc-editor.md) carries. The classic pattern:

> A **Button plate** that, on touch, **opens a Door** and shows a toast.

Rules are flat records: one trigger (`touch` / `timer` / `coin` / `kill` / `enterRegion` /
`varReaches` / `event` …), optional `if` conditions on `vars`, and an ordered `do` action
list (`toast` / `openDoor` / `movePart` / `award` / `setVar` / `teleport` / `win` / `sound`
…). Named `vars` get live HUD chips. See the [GameDoc editor tutorial](./gamedoc-editor.md#rules-no-code-logic)
for the full trigger/action vocabulary.

## Test, share, export

- **▶ Test play** — launches straight into your map (`#/play/draft/<key>`). Esc → Leave
  returns you to the editor.
- **Share** — encodes the whole map into a share link (`#/play/d/<payload>`) when it fits
  (~8 KB), otherwise downloads a `.blobcade.json`.
- **Download** — save the text map as a `.txt` (paste it into a code game with
  `buildTextMap`), or the doc as JSON.
- **Copy / paste** — the bottom textarea is the live map; paste any map in to import it.

## How it's wired

The 2D painter is a mountable component (`mountFloorPlan`) that edits a single `textmap`
string through a tiny host port (`getTextmap` / `setTextmap`). In **standalone `#/editor`**
mode it's wrapped with the meta form + rules panel + actions; in **Studio** mode it mounts
as an overlay so painting tiles rebuilds the 3D view live. Same component, two hosts —
which is why the format round-trips perfectly between the painter, ASCII files, and the 3D
editor.

## Next

- Want to place full 3D parts (boxes, lights, vehicles) directly in the world? →
  [3D Studio](./studio-3d.md)
- Want the full data format behind all of this? → [GameDoc editor](./gamedoc-editor.md)
