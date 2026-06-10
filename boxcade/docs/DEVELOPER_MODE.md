# Trusted TypeScript Developer Mode

Boxcade has two creation paths:

- **Studio Mode**: GameDoc, visual building, rules, sandboxed scripts, share
  links, and the public creator path.
- **Trusted TypeScript Mode**: local code using the same `defineGame()` SDK as
  the first-party games in `src/games/`.

Trusted TypeScript games are full-power code. They can import modules, keep
arbitrary state, use `onTick`, `onKill`, `ctx.entities`, `ctx.spawnBot`, and
the `ctx.engine` facade. That is how games like Squadfall Island and Facing
Towers are built.

Because this is full code, it is not anonymous public UGC. Use it for:

- first-party games,
- reviewed partner games,
- self-hosted games submitted as sandboxed embeds,
- local forks and private deployments.

## Scaffold a Full TypeScript Game

```bash
npm run scaffold:game -- my-arena
```

This creates `src/games/my-arena.ts`. Register it in `src/games/index.ts` to
show it in the portal.

## Export a Studio Draft to TypeScript

Studio's `⬇ TS` button downloads a TypeScript starter that embeds the current
GameDoc and runs it through `buildGameFromDoc(doc, { allowScripts: true })`.
Use it as a bridge: keep the generated world, then replace pieces with direct
SDK calls as the game becomes more custom.

## Publishing Policy

Scripted Studio drafts can run locally and through share links after a player
accepts the script prompt. The public catalog rejects scripted GameDocs until
server-side review and moderation are added.

Full TypeScript games can be published today only through trusted routes:

- curated native inclusion in the repo/build,
- self-hosted external embed, subject to the existing sandbox and admin
  approval flow.
