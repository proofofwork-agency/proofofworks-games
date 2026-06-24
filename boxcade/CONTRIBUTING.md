# Contributing to Blobcade

## Architecture & Layering

Blobcade enforces a strict layering rule to keep the codebase modular and composable:

```
games/ → sdk/ → engine/
         ↓
    runtime/ (composition root)
```

- **engine/** — Core game loop, systems, registries, event bus. No imports from `games/` or `runtime/`.
- **sdk/** — Game API and utilities. Imports only from `engine/`.
- **games/** — Individual game implementations. Import from `sdk/` and `engine/`.
- **runtime/** — Bootstraps engine, loads games. Imports from all layers.

## Evolution Rule

All features arrive as additive changes:
- New capabilities → new registries, event types, or optional fields
- The 6 shipped games must keep working unmodified
- Deprecation is allowed; removal requires major version bump

## Task Sizing

Pick from `docs/ROADMAP.md`:

- **S** — ≤ half day (small fix, add one system)
- **M** — ≤ 2 days (new game mode, extend registry)
- **L** — ≤ 1 week (new graphics subsystem, major refactor)

## Development Commands

```bash
npm run dev        # Vite :5173 + WebSocket server :8081
npm run build      # tsc --noEmit + vite build
npm test           # vitest run
```

## Assets

All assets are procedural — no binary assets in the repo. Keep geometry, textures, and audio as code.

## Git Workflow

Git commits are handled by the repository owner. Submit PRs with a clear description linking to the ROADMAP task.
