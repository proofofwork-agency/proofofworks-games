---
sidebar_position: 1
description: Shipping Blobcade as native apps on desktop, Android, iOS, consoles and the browser with Tauri 2.
---

# Native clients (Tauri): desktop, mobile & console

> Goal: ship Blobcade as a native app on **desktop (Windows / macOS / Linux),
> Android, iPhone / iPad, and the browser** from one codebase.
>
> This document maps every coupling point in the current codebase, the hard
> constraints of each platform, the realistic architecture options, and a
> concrete, phased plan with file/line references.
>
> Planning document — the integration blueprint (`src-tauri/` is not yet scaffolded).

---

## TL;DR — the one-paragraph answer

Blobcade's **frontend** (Vite + TypeScript + three.js, WebGL2) wraps into Tauri 2
almost as-is on **every** target, because Tauri renders the existing `dist/` in a
native WebView (and mobile touch controls already exist in `engine/touch.ts`).
The real work is the **backend**: Blobcade's multiplayer relay, publish/discovery
REST API and SQLite DB live in a **separate Node.js process**
(`server/server.mjs` + `server/http.mjs` + `server/db.mjs`) that uses
`node:sqlite` (Node ≥ 22.13) and the `ws` library. **Node.js cannot run on
iOS or Android**, so that server cannot be bundled into a mobile app. The
recommended architecture is therefore: **host the existing Node server on a
remote machine and point all clients (browser + desktop + mobile) at it via a
configurable URL** (the client already degrades to solo play when no server is
reachable). The frontend needs ~3 networking edits + an optional local-storage
abstraction. Desktop *may* optionally bundle the server as a Node sidecar for
fully-offline/LAN play — but that is a desktop-only bonus, not a requirement.

---

## 1. What Blobcade is today (the parts that matter for Tauri)

### 1.1 Frontend (the thing Tauri will wrap)

| Aspect | Where | Notes for Tauri |
| --- | --- | --- |
| Entry | `index.html` → `src/main.ts` | Plain SPA, renders into `<div id="app">`. Tauri loads the Vite `dist/`. |
| Bundler | `vite.config.ts` (Vite 5.4) | Tauri has first-class Vite support; needs `TAURI_DEV_HOST` + fixed port tweaks. |
| Renderer | `src/engine/renderer.ts` (three.js, **WebGL2**) | `WebGLRenderer` at `renderer.ts:40`. Works in all Tauri WebViews (WKWebView on iOS/macOS, WebView2 on Windows, WebKitGTK on Linux, Android WebView). |
| Post stack | GTAO, SSR (screen-space ray-traced reflections), bloom, ACES | `renderer.ts:9-15`. **Performance caveat on low-end mobile** — see §8. |
| Routing | hash router (`#/play/<id>`, `#/studio`, …) in `src/main.ts` | Hash routing is ideal for Tauri (no server-side routes needed). |
| Mobile/touch | `src/engine/touch.ts` (+ `touch.css`) | Virtual joystick, jump/fire/zoom buttons, vehicle button — **already built**. Tauri mobile gains these for free. |
| State | heavy use of `localStorage` (wallet, inventory, drafts, device key, publish tokens, editor state, name) | Works in Tauri's WebView, but **fragile on mobile** (OS may clear it). See §6. |
| Dependencies | `three`, `ws` (ws is server-only) | Only `three` ships to the client bundle. Tiny (~185KB gzipped). |

### 1.2 Backend (the hard part)

`server/server.mjs` is a **single Node process on port 8081** doing two jobs:

1. **Multiplayer relay** — WebSocket rooms: per-game instances, room codes,
   host election, 15 Hz transform fan-out, chat (rate-limited), relayed game
   events, and **plausibility-capped PvP hit arbitration** with server-owned HP.
   (`server/server.mjs:123-255`)
2. **Publish / discovery REST API** (`server/http.mjs`) backed by **SQLite**
   (`server/db.mjs`, `node:sqlite`): community game list, publish/edit/unpublish
   (edit-token auth, no accounts), play/like/report counters, creator earnings,
   per-game leaderboards, moderation. (`server/db.mjs:13-53` for the schema)

**Critical constraint:** this server uses `node:sqlite` (built into Node ≥ 22.13)
and the `ws` npm package. **Node.js does not run on iOS or Android.** There is no
way to execute `server.mjs` inside a mobile app. This single fact drives the
entire architecture.

### 1.3 How client + server are coupled today

The client assumes the server runs **on the same host as the web page**, on a
fixed port 8081. There are exactly **three hardcoded networking spots**:

| File | Line | Code |
| --- | --- | --- |
| `src/api.ts` | 7 | builds REST base from `location.protocol` + `location.hostname` + `:8081` |
| `src/engine/network.ts` | 68 | WebSocket to `ws://<hostname>:8081` |
| `src/portal.ts` | 128 | `new WebSocket(...)` ping to `ws://<hostname>:8081` |

These work for the browser build (page is served by the dev server on the same
host) but **break under Tauri**, where `location.hostname` is `tauri.localhost`
(or empty) and there is no Node server on the device. These must become a
configurable endpoint — the single most important code change (see §5).

A secondary coupling is **share-link generation**, which embeds
`location.origin` (`portal.ts:412,467`, `editor.ts:1270`, `studio.ts:943`,
`runtime.ts:920`). Native apps have no web origin, so shared links should point
at the published web URL instead. Low priority, but noted.

---

## 2. Can Tauri actually hit all five targets? (verified against docs)

Yes, for **Tauri 2.x** (the current major version; Tauri 1 was desktop-only).

| Target | Tauri 2 support | Mechanism |
| --- | --- | --- |
| Windows | ✅ Full | Edge WebView2 |
| macOS | ✅ Full | WKWebView |
| Linux | ✅ Full | WebKitGTK |
| Android | ✅ Full (stable) | Android WebView; needs Android SDK/NDK + rust targets |
| iOS / iPadOS | ✅ Full (stable) | WKWebView; needs Xcode + CocoaPods + rust targets (macOS host only) |
| **Browser** | n/a | The browser target is the **existing Vite web build** deployed to a host — it is *not* a Tauri build. Tauri and the web build share the same `src/`. |

Sources: Tauri 2 Architecture, Prerequisites, and the Vite frontend guide.

### 2.1 The three tooling capabilities that matter for Blobcade

| Capability | What it does | Platforms | Relevance to Blobcade |
| --- | --- | --- | --- |
| **Node.js sidecar** (`pkg` binary via `bundle.externalBin`) | Bundle + spawn a Node binary | **Desktop only** (docs: "applicable for desktop operating systems only") | Could bundle `server.mjs` for offline/LAN play on desktop. **Cannot run on mobile.** |
| **`tauri-plugin-sql`** (sqlx + SQLite) | SQL DB in the app, JS bindings | **All platforms incl. mobile** | Replaces `node:sqlite` for any *local* DB needs (e.g. durable drafts/wallet). |
| **`tauri-plugin-localhost`** | Serve assets over real `http://localhost:PORT` instead of the custom protocol | **All platforms incl. mobile** | Can sidestep WebView/origin quirks with WebGL + WebSocket. Security caveat in docs. |

### 2.2 Build prerequisites (per the docs)

- **Desktop:** Rust (rustup), plus platform toolchains (Xcode CLT / MSVC + WebView2 / webkit2gtk-4.1).
- **Android:** Android Studio (SDK + NDK), `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`, and
  `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
- **iOS:** macOS host, Xcode + CocoaPods, and
  `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`.

---

## 3. The core decision: what happens to the Node server?

Because the server can't run on mobile, and because the client **already
degrades to solo/offline play** when no server is reachable (`network.ts:71-101`,
the `fail()` path resolves `online=false` and games run solo), there are three
realistic options. **Option A is recommended.**

### Option A — Remote hosted server, one deployment for all platforms (RECOMMENDED)

- Host `server.mjs` on a VPS / Fly.io / Railway / Render (it is plain Node,
  `node server/server.mjs`, SQLite file or swap to Postgres later).
- Every client — browser, desktop, mobile — points at it via a **configurable
  endpoint** (env var at build time, e.g. `VITE_BLOBCADE_SERVER`).
- ✅ Full multiplayer + community features on **every** platform.
- ✅ Zero server rewrite. The existing server runs unchanged.
- ✅ Single source of truth for leaderboards, published games, earnings.
- ⚠️ Requires hosting + TLS (`wss://` / `https://`). Cross-device play needs
  internet. Single-device/offline play still works (solo fallback).

### Option B — Rust-native server embedded in the desktop app (ambitious)

- Rewrite the relay + REST + DB in Rust: `tokio` + `tokio-tungstenite` (WS),
  `axum`/`hyper` (HTTP), `rusqlite`/`sqlx` (SQLite) — roughly mirroring
  `server/server.mjs` (~310 lines), `server/http.mjs` (~365 lines),
  `server/db.mjs` (~229 lines).
- On **desktop**, bind a `127.0.0.1:<port>` inside the Tauri app and serve the
  relay there → LAN/offline multiplayer with no external server.
- On **mobile**, a background listener can't realistically accept inbound
  connections, so mobile is still **solo or remote-only**.
- ⚠️ ~900 lines of battle-tested server logic to re-implement in Rust
  (room codes, host election, interest management, PvP plausibility caps,
  rate limiting). High effort, high risk of behavioural drift.

### Option C — Hybrid (pragmatic; A + desktop-only sidecar)

- Same as A (remote server is the primary path for all platforms).
- Additionally bundle `server.mjs` (via `pkg`) as a **desktop sidecar** so the
  desktop app can do fully-offline/LAN play without the remote server. The
  client detects "is the sidecar up?" and prefers it, else falls back to the
  remote server, else solo.
- ✅ Best desktop UX, full mobile parity via the remote server.
- ⚠️ Two server paths to keep in sync; sidecar is desktop-only.

### Decision matrix

| | Effort | Mobile MP | Desktop offline MP | Community DB shared | Server rewrite |
| --- | --- | --- | --- | --- | --- |
| **A: Remote only** | Low | ✅ (remote) | ❌ (solo only) | ✅ | None |
| **B: Rust embedded** | Very high | ❌/solo | ✅ (localhost) | per-device | Full rewrite |
| **C: A + desktop sidecar** | Medium | ✅ (remote) | ✅ (sidecar) | ✅ | None |

**Recommendation: start with A; add C's sidecar later only if offline desktop
play is a real requirement.** B is not worth it unless self-contained desktop
multiplayer is a hard product requirement *and* you want to drop the remote
server entirely.

---

## 4. Target architecture (Option A)

```
                      ┌──────────────────────────────────────┐
                      │  Remote Blobcade server (hosted)     │
                      │  server.mjs (ws relay) + http.mjs    │
                      │  (REST) + db.mjs (SQLite/Postgres)   │
                      └───────────────┬──────────────────────┘
                          wss:// + https://  (configurable URL)
        ┌──────────────────┬───────────────────────┬──────────────────┐
        │                  │                       │                  │
   Browser build     Desktop (Tauri)       Android (Tauri)      iOS/iPadOS (Tauri)
   (Vite → host)     Vite dist/ + Rust      Vite dist/ + Rust     Vite dist/ + Rust
                     WebView: WKWebView2/   WebView: Android      WebView: WKWebView
                     WebKitGTK/WebView2
        │                  │                       │                  │
        └──────────────────┴───────────┬───────────┴──────────────────┘
                                       │
                            same src/ (Blobcade engine)
                  local state: localStorage (web) → Store/SQL plugin (native)
```

- **Browser** = the existing deployment. No Tauri involved. Shares `src/`.
- **Desktop / Android / iOS** = Tauri 2 apps wrapping the same `dist/`, all
  pointing at the remote server. Mobile already has touch controls.
- Local persistence: web keeps `localStorage`; native can migrate to
  `tauri-plugin-store` / `tauri-plugin-sql` for durability (see §6).

---

## 5. Concrete integration steps

### Step 0 — Prerequisites

Install Rust, platform toolchains, and (for mobile) Android Studio / Xcode per
§2.2. Confirm `rustc --print host-tuple` works (needs Rust ≥ 1.84 for that flag).

### Step 1 — Scaffold Tauri into the repo

From the repo root:

```bash
npm create tauri-app@latest   # choose "use existing frontend" → point at this repo
# or, once Node deps are present:
npm install --save-dev @tauri-apps/cli
npx tauri init
```

This creates `src-tauri/` (`tauri.conf.json`, `Cargo.toml`, `src/lib.rs`,
`src/main.rs`, `capabilities/`, icons). The Vite guide recommends this layout.

### Step 2 — Wire Vite + Tauri config

`vite.config.ts` — adapt per the official Vite guide (fixed port, `TAURI_DEV_HOST`
for physical iOS, ignore `src-tauri/` from watch, platform-aware build target):

```ts
import { defineConfig } from 'vite'
const host = process.env.TAURI_DEV_HOST
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105'
                                                       : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
```

`src-tauri/tauri.conf.json` — the build block (the key part):

```jsonc
{
  "build": {
    "beforeDevCommand": "npm run client",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  }
}
```

> Note: `npm run dev` currently launches **both** client and server via
> `scripts/dev.mjs`. For Tauri dev you want **client only**, so point
> `beforeDevCommand` at `npm run client` (the plain Vite script) and run the
> server separately (or against the remote server) during native development.

### Step 3 — Make the server URL configurable (THE core code change)

Introduce one config module, e.g. `src/env.ts`:

```ts
// Single source of truth for the Blobcade server endpoint.
// - Web build: default to same-host:8081 (preserves current behaviour) unless
//   VITE_BLOBCADE_SERVER is set.
// - Native (Tauri) builds: VITE_BLOBCADE_SERVER is required at build time.
export const SERVER_HTTP = import.meta.env.VITE_BLOBCADE_SERVER
  ?? `${location.protocol}//${location.hostname}:8081`
export const SERVER_WS = SERVER_HTTP.replace(/^http/, 'ws')
```

Then replace the three hardcoded spots:

- `src/api.ts:7` → `const base = () => SERVER_HTTP`
- `src/engine/network.ts:68` → `const url = SERVER_WS`
- `src/portal.ts:128` → `const ws = new WebSocket(SERVER_WS)`

Build the Tauri apps with, e.g.:
`VITE_BLOBCADE_SERVER=https://api.blobcade.example npm run tauri build`.

That's the bulk of the runtime porting. The game loop, renderer, physics,
combat, voxels and SDK need **no changes**.

### Step 4 — Storage abstraction for durable local state (recommended)

`localStorage` survives in Tauri's WebView, but on mobile the OS can evict it
and there's no easy backup/export. Introduce a thin adapter and route the
existing call sites through it. The codebase already centralises some of this
(`drafts.ts`, `engine/economy.ts`, `storage-migration.ts`), so the surface is
small.

Minimal shape:

```ts
// src/storage.ts
export const storage = {
  get(key: string): string | null {
    if (window.__TAURI__) return window.__TAURI__?.store ? /* sync cache */ : localStorage.getItem(key)
    return localStorage.getItem(key)
  },
  set(key: string, val: string) { /* … */ },
  remove(key: string) { /* … */ },
}
```

Two good Tauri options:

- **`tauri-plugin-store`** — key/value JSON files, all platforms. Closest 1:1
  drop-in for `localStorage`. Easiest migration.
- **`tauri-plugin-sql`** (SQLite, sqlx) — all platforms incl. mobile. Use if you
  want structured local data (e.g. a real drafts/wallet table). The server's own
  schema (`server/db.mjs:13-53`) can be mirrored locally if you ever go offline-first.

Because `localStorage` is synchronous and the plugins are async, the pragmatic
path is: keep an in-memory cache hydrated on boot, write through to the plugin.
The 53 `localStorage` call sites (see §1.1) then become trivial renames.

### Step 5 — App shell: fullscreen, orientation, safe areas

In `src-tauri/tauri.conf.json` (app/windows block) and/or `src/lib.rs`:
- Launch fullscreen-ish, hide the default window chrome on mobile.
- Lock orientation per game (obby/CTF want landscape; the portal can be portrait).
- Respect notch/safe-area insets (CSS `env(safe-area-inset-*)`) for HUD/joystick.
- The existing `<div id="app">` + `style.css` already fill the viewport.

### Step 6 — Security: capabilities + CSP

Tauri 2 is permissioned. In `src-tauri/capabilities/default.json`:

- Grant only what the app uses. A pure "wrap the web app + point at remote
  server" build needs almost nothing beyond `core:default` (no FS/shell/proc).
- If you adopt the SQL/Store plugin, add `sql:default` (+ `sql:allow-execute`) or
  the store permissions.
- **Only add the shell/sidecar permission if you implement Option C** (desktop
  Node sidecar) — and scope it tightly to the named binary + args.

Set a `security.csp` in `tauri.conf.json` that allows the remote server for
network access, e.g.:

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
connect-src 'self' https://api.blobcade.example wss://api.blobcade.example ipc: http://ipc.localhost;
```

`connect-src` must include both the `https://` (REST) and `wss://` (WebSocket)
origins of the hosted server, plus Tauri's IPC. Use `wss://` in production.

### Step 7 — (Optional, desktop-only) Node sidecar for offline play — Option C

Only if you want desktop LAN/offline multiplayer without the remote server:

1. Bundle `server.mjs` with [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)
   (note: `node:sqlite` is a native Node ≥ 22.13 builtin — verify `pkg` supports
   your Node target, or switch the server to `better-sqlite3` first).
2. Add `bundle.externalBin: ["binaries/blobcade-server"]` and name the output
   `blobcade-server-<target-triple>`.
3. Spawn it from `src/lib.rs` setup (`tauri_plugin_shell::ShellExt`), pick an
   ephemeral port, and pass it to the frontend (e.g. via a Tauri command or
   `VITE_BLOBCADE_SERVER` resolved at runtime).
4. Capabilities: scope `shell:allow-spawn` to exactly that binary.
5. **This path does not exist on mobile** — there, always use the remote server.

### Step 8 — Build & distribute

```bash
npm run tauri dev                  # desktop dev (client + Tauri shell)
npm run tauri build                # desktop installers (.msi/.dmg/.deb/.AppImage)
npm run tauri android dev          # Android (needs SDK/NDK)
npm run tauri android build        # .apk / .aab for Google Play
npm run tauri ios dev              # iOS simulator/device (macOS only)
npm run tauri ios build            # .ipa for App Store
```

For CI, `tauri-apps/tauri-action` (GitHub Actions matrix) builds desktop
artifacts for all three OSes. Android/iOS need extra runners/secrets/signing.
The existing **browser** build stays `npm run build` → deploy `dist/` to any
static host (unchanged).

---

## 6. Local state: what moves where

| Data | Today | Native recommendation |
| --- | --- | --- |
| Wallet (Blobcash) | `localStorage` (`engine/economy.ts`) | Store plugin (durability) |
| Inventory / equipped | `localStorage` (`engine/economy.ts`) | Store plugin |
| Drafts ("My Games") | `localStorage` (`drafts.ts`) | Store or SQL plugin |
| Device key | `localStorage` (`api.ts:26`) | Store plugin |
| Publish/edit tokens | `localStorage` (`api.ts:140`) | Store plugin (treat as a secret) |
| Player name | `localStorage` (`portal.ts`) | Store plugin |
| Editor/studio state | `localStorage` (`editor.ts`) | Store plugin |
| Community games / leaderboards / earnings | **server SQLite** (`server/db.mjs`) | stays server-side (remote API) |

Server-side data stays server-side — it is inherently cross-device and must not
live only on one device. The local changes above are purely about *durability*
of per-device state.

---

## 7. Networking rework (detail)

The relay protocol (`server/server.mjs:12-23`) is unchanged — it's the same
server, just remote. Client-side:

- **`src/engine/network.ts`** — the only edit is `url` (line 68). Everything
  else (join handshake `t:'j'`, 12 Hz send, 120 ms interpolation buffer, offline
  fallback at `:71-101`) works over `wss://` as-is. Consider adding reconnect
  logic for flaky mobile networks (nice-to-have; today it falls to solo on close).
- **`src/api.ts`** — only `base()` (line 7) changes. The REST calls are plain
  `fetch` and work cross-origin (the server already sends
  `access-control-allow-origin: *`, `http.mjs:139`).
- **`src/portal.ts:128`** — the portal's "online indicator" ping; same URL edit.

For production, serve the server behind TLS and use `wss://`/`https://`. The
client's graceful degradation means a flaky connection never hard-crashes a game.

---

## 8. Caveats, risks & unknowns

1. **Mobile WebGL performance.** The post stack (GTAO + SSR + bloom) is GPU-heavy.
   iOS/Android WebViews support WebGL2, so it *runs*, but low-end phones may drop
   frames. Mitigations: detect mobile/low-power and disable SSR + GTAO (the
   renderer already has `ssrActive` and nullable `gtao`), cap pixel ratio lower
   (currently `min(devicePixelRatio, 1.75)` at `renderer.ts:41`). Needs
   real-device QA — the README itself notes "real-device QA is still owed."
2. **Touch controls unverified on hardware** (`engine/touch.ts:14-17` says so).
   Tauri mobile is the first time these run on real devices; budget QA time.
3. **`location.origin` in share links** (5 call sites, §1.3) produces nonsense in
   native apps. Replace with the published web app URL for share/copy-link flows.
4. **iOS WKWebView quirks.** WebGL + WebSocket from a custom-scheme origin can be
   finicky. If you hit issues, adopt `tauri-plugin-localhost` (serves the app from
   a real `http://localhost:PORT` on all platforms) — but read its security caveat.
5. **App Store / Play Store policies.** User-generated content (the publish API)
   needs a reporting/moderation flow for store approval — the server already has
   `reportGame` + admin hide + auto-hide at 5 reports (`db.mjs:210-217`), which
   helps. Account-less publish is fine, but be ready to justify moderation.
6. **Server hosting + ops.** Option A means you operate a server: TLS, backups
   for `blobcade.db`, rate limits (already present), and eventual Postgres
   migration if SQLite file-locking becomes a bottleneck.
7. **Signing.** iOS needs an Apple Developer account; Android needs a Play
   console + keystore; Windows/macOS want notarization/signing for clean installs.
8. **`pkg` + `node:sqlite` (Option C only).** `node:sqlite` is a recent Node
   builtin; confirm your `pkg`/Node version bundles it correctly, or migrate the
   server to `better-sqlite3` before sidecar-ing. Mobile is unaffected either way.

---

## 9. Phased roadmap

| Phase | Scope | Deliverable |
| --- | --- | --- |
| **0. Prep** | Install Rust + mobile toolchains; decide hosting | Local `npx tauri dev` boots the web app in a desktop window |
| **1. Server URL refactor** | `src/env.ts` + 3 edits (§5 Step 3) | Web build still works; endpoint configurable via env |
| **2. Host the server** | Deploy `server.mjs` to a host with TLS | `wss://`+`https://` reachable from any client |
| **3. Desktop MVP** | `src-tauri/` + Vite/tauri config + CSP (§5 Steps 1–3,6) | Windows/macOS/Linux installers, full MP + community |
| **4. Storage durability** | Storage adapter + Store plugin (§5 Step 4, §6) | Native wallets/drafts survive app reinstall / OS eviction |
| **5. Android** | `tauri android` + orientation/safe-area + mobile perf flags | Play-ready `.aab`; touch controls validated on devices |
| **6. iOS/iPadOS** | `tauri ios` + signing | App-Store-ready `.ipa`; iPad layout/keyboard support |
| **7. Polish** | Reconnect logic, mobile graphics tiering, share-link URL fix | Ship to stores |

Optional **C (desktop sidecar)** can be slotted in any time after Phase 3 if
offline/LAN desktop play becomes a requirement.

---

## 10. Quick reference — what changes, what doesn't

**No changes needed:** the game engine, physics, combat, voxels, SDK, text-map
system, audio, FX, the relay protocol, the server code itself, and the browser
deployment.

**Changes needed (small):**
- 3 server-URL hardcodes → configurable endpoint (`src/env.ts`).
- `vite.config.ts` → Tauri-aware (fixed port, `TAURI_DEV_HOST`, build targets).
- New `src-tauri/` (config, `lib.rs`, capabilities, CSP, icons).

**Changes recommended (durability):**
- `localStorage` call sites → storage adapter backed by Store/SQL plugin.
- Share-link `location.origin` → published web URL.

**Big optional work:** Rust server rewrite (Option B) or desktop Node sidecar
(Option C) — only if self-contained/offline multiplayer is a hard requirement.

---

## 11. Consoles (Xbox / PlayStation 4–5 / Nintendo Switch / Wii) — future stretch, not a must

Consoles are called out here for completeness as a **possible future target**, not
a v1 requirement. The headline is blunt but important:

> **Tauri does not extend to consoles.** Consoles are closed, NDA-gated platforms
> with **no WebView exposed to third-party apps**, so the entire "wrap the Vite
> app in a native shell" strategy from §1–§10 **does not apply** to any console.
> Consoles are a **separate port family** with a different cost model and per-
> platform approval/certification gates.

The one thing that *does* carry over for free: **the server doesn't care.** The
coordinator + relay design in [Server architecture, scaling & hosting](./server-architecture.md)
serves a console identically to a browser or phone — a console is just another
client hitting `/api/rooms/resolve` then `wss://` to a relay node. No server work
is required to *support* consoles; all the work is client-side and contractual.

### 11.1 Per-platform reality

| Console | Can the web/Tauri stack run? | Realistic path | Viability for Blobcade |
|---|---|---|---|
| **Xbox One / Series X\|S** | No Tauri; but Microsoft allows **Hosted Web App / PWA via UWP** in the Store (Edge/Chromium, WebGL2 supported) | Package the Vite build as a Store PWA; ID@Xbox or individual dev account (~$19 once) | **Best (only) "web" console path.** Reuses `src/`. Needs perf tiering (post stack on integrated GPU) + Store certification (TCR/XR). |
| **PlayStation 4 / 5** | No third-party web runtime; browser is hidden/limited, not an app host | **Native only**: licensed dev (PlayStation Partners, NDA, dev kits) via Unity/Unreal/custom SDK. Three.js does **not** run. | High effort, NDA-gated, per-platform. No web shortcut. |
| **Nintendo Switch** | **No browser at all**, no web runtime | **Native only**: Nintendo Developer Portal (NDA) via Unity/Unreal/(Godot via publisher). Three.js does **not** run. | High effort, NDA-gated, strict cert. |
| **Nintendo Wii** | **Not achievable.** Discontinued (2006); Opera browser only, **no WebGL**, ~88 MB RAM, ~729 MHz CPU | Homebrew (Homebrew Channel) only — not a legal/commercial channel | Effectively impossible for a Three.js/WebGL2 game. *(If you meant Wii U: also discontinued with similar browser limits; Switch is Nintendo's current platform.)* |

### 11.2 Two port strategies (if/when consoles become real)

1. **Web-where-allowed → Xbox only (cheap-ish).** Ship the existing Vite build as
   a Microsoft Store PWA/Hosted Web App. This is the lowest-effort console entry
   and the only one that reuses the web renderer. Scope: Xbox only; still needs
   certification and a WebGL perf tier.
2. **Native port → PS4/PS5/Switch (expensive).** Re-host the game on an engine
   with console support (Unity/Unreal; Godot via a publisher). The leverage here
   is Blobcade's **games-as-data** model: `GameDoc` is engine-agnostic, so a
   native runtime can consume the *same authored content* and speak the *same
   network protocol*. Only the renderer/physics get reimplemented. This is a
   large, per-platform, NDA-gated effort — the textbook "not a must."

### 11.3 What to do *now* to keep the option open (cheap; mostly discipline)

These cost almost nothing today and preserve every future console path:

- **Keep `GameDoc` games-as-data engine-agnostic** (already true). A console port
  consumes the same authored worlds — don't let web-specific assumptions leak into
  the doc format.
- **Freeze the wire protocol** (`server/server.mjs` ↔ `src/engine/network.ts`).
  Console clients are just clients on the same relay; protocol stability = trivial
  cross-play.
- **Plan a renderer/runtime abstraction** so a non-WebGL backend is possible one
  day. This also pays off for the `ROADMAP` WebGPU path and for mobile perf
  tiering (§8), so it's not console-only value.
- **Keep the server console-agnostic.** Consoles = clients → coordinator → relay.
  No server-side console-specific work.
- **Treat UGC moderation as a cert prerequisite.** Console certification is hard
  on **unmoderated user-generated content**. The publish/report/moderation flow
  (`ROADMAP` Phase 4, `CONTENT-003/007`) must be mature before any console
  submission — this is the single biggest contractual blocker, not the tech.

### 11.4 Bottom line for consoles

Consoles are a **separate, expensive, NDA-gated port family**, with Xbox (via a
Store PWA) the only semi-web path and PS/Switch requiring native ports. The
server is already ready for them; the client is not, and Tauri won't get you
there. Park consoles as a post-launch stretch goal, and in the meantime keep the
data model, protocol, and rendering boundary clean so the option stays open.

---

## Sources

- Tauri 2 Architecture — https://v2.tauri.app/concept/architecture/
- Tauri 2 Prerequisites (desktop + Android + iOS toolchains) — https://v2.tauri.app/start/prerequisites/
- Tauri 2 + Vite frontend guide — https://v2.tauri.app/start/frontend/vite/
- Node.js as a sidecar (**desktop only**) — https://v2.tauri.app/learn/sidecar-nodejs/
- Embedding external binaries (sidecar) — https://v2.tauri.app/develop/sidecar/
- `tauri-plugin-localhost` (all platforms) — https://v2.tauri.app/plugin/localhost/
- `tauri-plugin-sql` (SQLite, all platforms) — https://v2.tauri.app/plugin/sql/
