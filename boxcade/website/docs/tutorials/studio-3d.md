---
sidebar_position: 4
description: The 3D Studio — in-world creation. Place, move, resize and rotate parts directly in 3D, with undo, rules and one-click test-play.
---

# 3D Studio

The **Studio** is Blobcade's in-world 3D creator. Instead of typing coordinates or drawing
ASCII, you fly a camera through the scene and place full 3D parts — boxes, hazards, lights,
vehicles, doors, movers — directly where you want them, with live undo/redo and instant
test-play.

Like the [2D editor](./visual-editor.md), the Studio edits a **GameDoc**: every edit is a
*doc-op* that snapshots the doc for undo, applies the change, rebuilds the scene from the
doc, and autosaves the draft. **The doc is the single source of truth; meshes are
throwaway projections of it.**

## Open it

From the portal: **New map** or **Edit** on a draft → `#/studio/<key>`. The legacy
`#/editor` route opens the Studio's Floor Plan view directly.

## Controls

The Studio has its own fly camera (it's its own composition root, separate from gameplay):

| Action | Keys |
| --- | --- |
| Look / orbit | **right-drag** (orbits the selected part 360°; free-look when nothing selected) |
| Dolly | **scroll wheel** (adjusts orbit radius 3–60 m) |
| Fly | **WASD** · **Q**/**E** (or **Space**) down/up · **Shift** = fast |
| Select / place | **left-click** a part to select; **left-drag** to move on the ground plane |
| Nudge selected | **Arrow keys** (XZ) · **PageUp**/**R** (Y up) · **PageDown** (Y down) |
| Rotate | **[** / **]** (22.5° yaw) |
| Resize | **+** / **−** (×1.15 per press) |
| Duplicate | **Ctrl/Cmd + D** |
| Delete | **Del** / **Backspace** |
| Undo / redo | **Ctrl/Cmd + Z** / **Ctrl/Cmd + Shift + Z** |
| Focus selected | **F** (frame the part in the camera) |

Hold **Alt** while dragging/nudging to bypass grid snap. Grid snap defaults to 0.5 m
(adjustable in settings).

## Two views of one draft

- **Build (3D)** — place and shape parts in the world.
- **Floor Plan (2D)** — the [2D painter](./visual-editor.md) as an overlay, for fast tile
  layouts. Painting tiles rebuilds the 3D view live, and undo works across both. Toggle
  with the top-bar button.

Both edit the same GameDoc `textmap`/`parts` — pick whichever is faster for the job.

## The element palette

Arm a template, then the next ground click places it (**Shift**-click to keep stamping).
Palette entries mirror the [DocPart kinds](../reference/gamedoc-spec.md#docpart-kinds):

- **Parts**: stone/wood/grass/ice/neon/metal/glass boxes — set color, material, size, rotY.
- **Prefabs**: coin, lava, water, win pad, checkpoint, bounce pad, health pack, ammo
  crate, weapon spawn, tree, cloud, label, light, spinner hazard.
- **Interactive**: **door**, **mover** (moving platform), **button**, **portal**,
  **ladder**, **gravity zone**.
- **Vehicles**: car / jetpack / boat / plane (placed as their real in-game meshes).

Only `kind: 'part'` objects are registered for rules — so point a rule at a part's `id` or
`tag`, not at a coin.

## Game settings

A settings panel edits the doc's top-level fields without rebuilding the world (cheap path):

- **Meta** — name, emoji, genre, blurb, gradient.
- **Camera** — `orbit` (third person) or `fp` (first person).
- **Lighting** — sky preset (applied when you play; the Studio keeps its work light).
- **Physics** — gravity / jump / walk speed.
- **Spawn** — click-to-set ("📍 Spawn moved").
- **Reflections** — toggle RT reflections for shiny surfaces.
- **Max players** — room capacity.

## Rules & script

- **Rules panel** — the same declarative `when / if / do` rules as the [2D editor](./visual-editor.md#no-code-game-logic-rules),
  with part pickers populated from the ids/tags actually in your doc.
- **Script** — attach a [sandboxed creator script](./scripting.md) to the doc (GameDoc v2).
  Scripts run only after a player grants permission.

## Test, share, export

- **▶ Test play** — saves and launches `#/play/draft/<key>`; Esc → Leave returns to the
  Studio (and remembers which view you were in).
- **Share** — encodes the doc into a share link when it fits, else downloads
  `.blobcade.json`.
- **Download** — export the **text map** (`.txt`), the **GameDoc** (`.json`), or
  **TypeScript** (`.ts`). The TS export embeds your doc and runs it through
  `buildGameFromDoc` — a bridge into [trusted TypeScript mode](./typescript-game.md) where
  you keep the generated world and replace pieces with direct SDK calls as the game grows.

## How it's wired

The Studio is a **separate composition root** from the runtime: it instantiates its own
`Renderer`, `PartsWorld`, `Input` and camera, drives the engine directly over the draft
doc, and rebuilds the scene on every doc-op. The `contextBuilder()` it uses projects prefab
verbs straight into the `PartsWorld` for visual truth; gameplay wiring (touch triggers,
combat) happens later in the real runtime when you press Test play. Doc edits
(`mutate('place' | 'nudge' | 'resize' | 'rotate' | 'floorplan' | …`) each push one
undoable snapshot, capped at 100 steps.

## Next

- The full data shape the Studio writes → [GameDoc editor](./gamedoc-editor.md).
- Escape the rule ceiling with code → [Scripting](./scripting.md).
