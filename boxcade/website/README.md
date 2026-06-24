# Blobcade Docs (Docusaurus)

The documentation website for [Blobcade](../), built with Docusaurus 3.

## Run locally

```bash
cd website
npm install
npm start          # http://localhost:3000
```

## Build

```bash
npm run build      # static site into build/
npm run serve      # preview the production build
```

## Structure

```
docs/
  intro.md                  What Blobcade is
  getting-started.md        Install, run, commands
  tutorials/                Three creation paths + maps
    typescript-game.md      Pure TypeScript (full tutorial)
    text-maps.md            ASCII maps (2D)
    visual-editor.md        2D visual painter
    studio-3d.md            3D Studio
    gamedoc-editor.md       GameDoc no-code/data format
    scripting.md            Sandboxed scripting
  architecture/             The engine, end to end
    overview.md             Layering & design patterns
    engine.md               Each engine/ module
    wiring.md               URL → frame, step by step
  reference/
    sdk.md                  WorldBuilder / GameContext / behaviors
    weapons.md              Arsenal & combat config
    gamedoc-spec.md         Full GameDoc format spec
```

The docs are synced to the source in `../src` and `../docs`. Where this site and the code
disagree, the code wins.
