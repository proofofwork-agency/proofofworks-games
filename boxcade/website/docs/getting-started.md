---
sidebar_position: 2
description: Install Blobcade, run the client + room server, and learn the commands.
---

# Getting started

Blobcade runs entirely in the browser. One command starts the Vite client and the
WebSocket multiplayer room server together.

## Prerequisites

- **Node.js 18+** and npm
- A modern browser with WebGL support

## Install & run

```bash
npm install
npm run dev
```

This starts:

- **Vite dev client** at `http://localhost:5173` (the Blobcade portal)
- **WebSocket room server** at `ws://localhost:8081` (multiplayer, chat, relay)

Open `http://localhost:5173` and you land on the portal — a grid of game cards. Click
any card to play. Open a second browser tab (or a second browser) to the same URL and
your avatars, name tags and chat sync through the room server. **No server?** Games
silently run solo — nothing breaks.

## Commands

```bash
npm run dev      # client (Vite :5173) + room server (:8081) together
npm run client   # Vite only (games auto-fallback to solo mode)
npm run server   # room server only (ws://localhost:8081)
npm run build    # tsc --noEmit typecheck + production bundle to dist/
npm run preview  # preview the production build
npm test         # vitest run (unit tests)
npm run scaffold:game -- my-arena   # scaffold a new TypeScript game
```

## The portal & routes

Blobcade uses a tiny **hash router** (`src/main.ts`). The portal is the home screen;
routes you'll hit:

| Route | Meaning |
| --- | --- |
| `#/` | Portal (home + Shop + My Games) |
| `#/play/<gameId>` | A built-in game (e.g. `#/play/starter`) |
| `#/play/draft/<key>` | A local draft from My Games / Studio |
| `#/play/d/<payload>` | A shared game — the whole GameDoc rides inside the link |
| `#/play/g/<id>` | A published community game, fetched by id |
| `#/editor` | Legacy map editor → opens Studio Floor Plan |
| `#/studio[/<key>]` | The 3D Studio (new draft, or edit an existing one) |

## Controls

| | Third person (obby / arena) | First person (Voxel Island) |
| --- | --- | --- |
| Move / jump | `WASD` + `Space` (hold Space to bunny-hop) | same |
| Camera | drag with either mouse button · scroll zoom · `Shift` toggles mouse-look | click to capture mouse |
| Act | `R` reset to checkpoint | left-click break · right-click place · `1–8`/scroll blocks |
| Social | `/` or `Enter` chat · `M` mute · `Esc` pause | same |

## Project layout at a glance

```
src/
  engine/     the engine — zero game knowledge (renderer, sky, physics, world,
              voxel, combat, events, avatar, camera, network, audio, fx, economy)
  sdk/        the creator-facing API: defineGame + types + prefab vocabulary
              (gamedoc, rules, interpret, textmap, script-host, codec, ts-export)
  runtime/    glues a GameDef to the engine: HUD, chat, build mode, pause, game loop
              (runtime.ts is the composition root; systems/ holds the HUD/chat/pause)
  games/      the six shipped games + index.ts (the registry)
  studio/     the 3D visual Studio
  maps/       ASCII text maps (castle.txt, facing-towers.txt)
  portal.ts, editor.ts, main.ts, api.ts, drafts.ts ...
server/       room server: rooms per game id, 15Hz state fan-out, chat rate limiting
docs/         architecture / GameDoc / scripting / plugin specs
```

Total: ~6,500 lines of TypeScript, two runtime dependencies (`three`, `ws`), ~185KB gzipped.

## Where to go next

- New to the SDK? Start with [a pure TypeScript game](./tutorials/typescript-game.md).
- Want to draw levels in text? See [ASCII text maps](./tutorials/text-maps.md).
- Want the visual map painter? See the [2D editor](./tutorials/visual-editor.md) or
  [3D Studio](./tutorials/studio-3d.md).
- Want the big picture? Read the [architecture overview](./architecture/overview.md).
