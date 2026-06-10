# Boxcade Platform Parity Roadmap

**Date:** 2026-06-10
**Status:** Architecture and execution roadmap for closing the gap between the current Boxcade stack and a top-tier user-generated 3D game creation platform.

This document is not a marketing plan. It is a build plan for turning Boxcade from a playable browser-first creation loop into a durable platform: authenticated creators, versioned games, trusted publishing, moderated discovery, authoritative sessions, server-owned economy, sandboxed creator APIs, analytics, collaboration, and operational discipline.

## North Star and Principles

Boxcade should let a creator sign in, build a 3D game in Studio, test it, publish it through review, manage versions and earnings, invite collaborators, and watch players join stable multiplayer sessions. Players should be able to discover games, trust the content state, play with friends, earn and spend through server-owned ledgers, report abuse, and keep progress across devices.

Non-negotiable principles:

- **Game-as-data remains the platform contract.** GameDoc is the canonical authored artifact. Studio, publishing, runtime, analytics, moderation, remixing, and export all operate on versioned documents and derived artifacts.
- **Registries are extension points, not loose globals.** Materials, behaviors, weapons, sky presets, textmap tiles, and future plugin capabilities need manifest-backed package metadata, lifecycle hooks, introspection, permissions, and compatibility checks.
- **No untrusted creator code runs without a sandbox.** Logic rules stay data-only until a capability-based scripting runtime exists with isolation, CPU limits, memory limits, API permissions, and publish-time review signals.
- **Authority moves server-side where value or fairness exists.** Ownership, publishing state, moderation state, economy, marketplace inventory, leaderboards, PvP damage, session admission, and audit logs cannot depend on localStorage or client claims.
- **Creator workflows belong inside Studio.** Portal-only publish, earnings, analytics, and moderation workflows are not enough. Studio must become the first-class place to publish, republish, validate, version, remix, and inspect game health.
- **Every phase ships behind gates.** A phase is not done when code merges. It is done when schema, tests, docs, migration paths, user workflow, and operational checks are present.
- **Backwards compatibility is explicit.** Existing share links, published games, local drafts, and current first-party games must either migrate cleanly or fail with a clear compatibility message.
- **Safety is product infrastructure.** Reporting, blocking, maturity gates, rate limits, deduplication, review queues, admin audit, and abuse response are core systems, not late polish.
- **Browser-first does not mean single-device.** Identity, persistence, mobile input, accessibility, and low-end performance must be treated as platform requirements.

## Current State Snapshot

### Already Strong

Boxcade already has the right foundation for a data-driven creation platform:

- **GameDoc exists** as the primary authored game shape.
- **Studio exists** with a unified Floor Plan, element palette, local drafts, and a playable creator loop.
- **Gameplay vocabulary is growing:** Water, Ladder, vehicles, prefabs, and interactive world elements are already available to creators.
- **Sharing and publishing exist:** local drafts, share links, and a published games API provide an early creator-to-player path.
- **Community surfaces exist:** discovery, likes, reports, leaderboards, and room codes already establish the outline of a platform loop.
- **Backend exists:** SQLite, WebSocket rooms, generic event relay, host election, interest filtering, simple PvP arbitration, published game storage, and one-process local operations are already in place.
- **Economy exists locally:** Bolts, per-game store concepts, and per-game earnings establish the shape of creator monetization.
- **Plugin registries exist:** materials, behaviors, weapons, sky presets, and textmap tiles are registered through local extension points.

These are meaningful assets. The platform should not be restarted. It should be hardened, versioned, and given authority boundaries.

### Missing or Too Weak

The gaps are structural:

- **No real identity spine.** Creator ownership is anonymous-token based. Likes, reports, and plays depend on localStorage device keys. This breaks cross-device use, abuse controls, entitlement checks, payouts, and collaboration.
- **Publishing is not first-class in Studio.** Publish, republish, moderation, analytics, and earnings are mostly portal workflows. Studio lacks a serious publish drawer, version history, source lineage, remix handling, and strong preflight validation.
- **Plugin system is registry-only.** There is no `PluginManifest`, loader lifecycle, install/enable/disable flow, package catalog, marketplace, permission model, sandbox boundary, or broad registry introspection. `behaviorTypes` is the only notable introspection surface.
- **Runtime authority is too client-heavy.** Transforms and events are client-authoritative. PvP is plausibility-only. Hosted session state lives in host/client memory. Economy is locally mutable.
- **Operations are local and fragile.** One process handles local ops. The WebSocket endpoint is hardcoded. Health checks, metrics, backups, migrations, admin audit, and status reporting are missing.
- **Content governance is incomplete.** Reporting exists, but robust moderation queues, review states, blocking, maturity gates, asset trust, appeal logs, and admin audit are not platform-grade.
- **Analytics are not creator-grade.** Discovery metrics, retention, conversion, device breakdown, session quality, earnings attribution, moderation outcomes, and funnel analysis need durable event pipelines.
- **Testing is narrow.** Studio workflows, publish gates, plugin compatibility, moderation, multiplayer authority, economy ledgers, and migrations need acceptance-level coverage.
- **Docs drift.** The current architecture, plugin surface, SDK claims, and roadmap do not consistently match implementation. The SDK package is not a real distributable platform SDK yet.

## Target Architecture

### Creator Identity

Creator identity becomes the root of ownership, collaboration, moderation accountability, economy, and audit.

- Accounts support authenticated sessions, device upgrade, passkeys or email links, token rotation, and account recovery.
- Ownership records bind users to games, packages, assets, teams, earnings, and moderation history.
- Teams support roles: owner, admin, editor, analyst, moderator, and payout manager.
- Public creator profiles expose published work and safe metadata only.
- Anonymous play can remain, but anonymous creation cannot publish into the main catalog without an upgrade path and rate-limited trust state.

### GameDoc and Artifact Registry

GameDoc remains the editable source. Published games reference immutable versions and generated artifacts.

- `GameDoc` stores authoring data, dependencies, permissions, source lineage, remix metadata, compatibility version, and validation results.
- `GameVersion` is immutable after publish. Republish creates a new version, not an in-place mutation.
- `Artifact` records generated outputs: thumbnail, cooked asset bundle, search document, moderation snapshot, runtime manifest, and optional export package.
- Content states are explicit: draft, private, unlisted, submitted, in_review, approved, published, rejected, hidden, archived, and deleted.
- Migrations are linear, tested, and tracked by schema version.

### Plugin and Package System

Registries become package-backed platform APIs.

- Every plugin has a `PluginManifest` with id, version, engine compatibility, registry contributions, permissions, assets, package type, and lifecycle hooks.
- Loader lifecycle: discover, validate, install, enable, initialize, register, disable, uninstall, migrate.
- Registry introspection exposes materials, behaviors, weapons, sky presets, textmap tiles, rule actions, property editors, Studio palette entries, and runtime systems.
- Packages can be first-party, trusted partner, team-private, or untrusted community packages.
- Untrusted packages cannot execute arbitrary code without a sandbox and explicit capabilities.
- Marketplace/catalog metadata supports install counts, ratings, moderation state, dependency graph, compatibility warnings, and update channels.

### Studio

Studio becomes the control plane for creation.

- First-class publish drawer with validation, version notes, visibility, target audience, maturity, dependencies, monetization, permissions, and review status.
- Remix workflow with source attribution, license terms, lineage, and source-version locking.
- Version history with diff summary, rollback, compare, and restore-to-draft.
- Plugin manager with installed/enabled packages, permission prompts, compatibility status, and registry browser.
- Analytics and earnings panels for owned games.
- Team collaboration with role-aware edit, review, comment, and publish controls.
- Preflight validation catches schema errors, missing dependencies, unsafe settings, performance budget failures, moderation risks, economy violations, and multiplayer incompatibilities.

### Publishing and Review

Publishing becomes a state machine.

- Submissions include immutable GameVersion, validation report, dependency manifest, generated thumbnail, moderation snapshot, and creator identity.
- Review queues support automated checks, human review, rejection reasons, appeal notes, and admin audit.
- Visibility states separate private testing, unlisted sharing, public catalog listing, and hidden/takedown state.
- Published pages expose version, creator, maturity, reports, stats, dependencies, and safe remix status.

### Discovery and Social

Discovery is ranking plus trust.

- Catalog ranking uses plays, retention, likes, reports, freshness, social graph signals, moderation status, quality gates, and device compatibility.
- Likes, reports, follows, blocks, comments, and favorites are account-backed with abuse controls.
- Leaderboards are server-owned and scoped by game version where needed.
- Room invites, room codes, private servers, and friend join flows are durable server concepts, not only client memory.

### Runtime and Session Authority

Runtime becomes session-orchestrated.

- Session service creates, joins, lists, and retires room instances.
- Server owns session admission, room metadata, host election, timeout, authoritative clocks, critical events, PvP health ledger, and persistence checkpoints.
- Clients can still predict movement and render locally, but transforms, damage, inventory, economy, and score claims are validated.
- Hosted sessions persist enough state to recover from host leave, server restart, or late join.
- WebSocket endpoints are environment-configured and observable.

### Economy and Marketplace

Economy moves from local mutation to server ledger.

- Bolts balances are ledger entries, not local counters.
- Earnings are attributable to source events: playtime, purchases, tips, premium rewards, creator cuts, and refunds.
- Per-game stores use server-owned products, prices, inventory, entitlements, receipts, and fraud checks.
- Marketplace supports packages, cosmetics, templates, game passes, and creator revenue share.
- Payout and financial compliance can be deferred, but internal accounting must be correct before real-money conversion is considered.

### Trust and Safety

Trust systems cover content, users, sessions, and economy.

- Reporting supports categories, evidence, target type, session/game/version references, and duplicate detection.
- Blocking affects chat, social interactions, invites, and discovery recommendations where appropriate.
- Maturity gates and age suitability tags are part of publish metadata and discovery filters.
- Moderation actions are audited and reversible by authorized admins.
- Automated checks handle text metadata, dependency trust, scripts, asset risk, spam, economy abuse, and session behavior.

### Analytics and Ops

Platform decisions need durable data.

- Event pipeline captures publish funnel, Studio validation failures, plays, session quality, retention, likes, reports, earnings, purchases, crashes, latency, and moderation outcomes.
- Creator dashboards show actionable metrics, not raw noise.
- Ops exposes health, readiness, metrics, logs, migrations, backup status, queue depth, active sessions, and WebSocket error rates.
- Admin audit tracks privileged reads and writes.

### Mobile and Accessibility

Mobile and accessibility are baseline platform support.

- Touch movement, camera, jump, interact, inventory, and Studio placement need first-class controls.
- UI must be responsive for phone, tablet, laptop, and desktop.
- Accessibility coverage includes keyboard navigation, visible focus, reduced motion, color contrast, captions/labels, scalable text, and remappable controls where practical.
- Performance budgets must include low-end mobile browsers and integrated GPUs.

### Portability and Governance

Creators need confidence that their work is not trapped.

- Export supports GameDoc, dependencies, thumbnails, metadata, and version history where rights allow it.
- Import validates package dependencies and source lineage.
- Governance defines deprecation policy, schema migration policy, package trust levels, creator terms, moderation policy, data retention, and API stability.

## Phased Roadmap

Each task includes dependencies, acceptance gates, and concrete file or module areas. File names are directional; inspect the current tree before implementation.

### Phase 0: Documentation, Schema, and Test Alignment

**Goal:** make the current platform contract honest before deeper work starts.
**Phase gate:** docs, schemas, tests, and shipped behavior agree on GameDoc, Studio, publishing, plugins, multiplayer, economy, and moderation.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| ARCH-001 | Audit current shipped capabilities against architecture docs and tests. | None | `docs/`, `src/sdk/`, `src/studio/`, `src/runtime/`, `server/`, `tests/` | A checked-in audit table lists implemented, partial, missing, and obsolete claims. |
| ARCH-002 | Define platform state model for draft, private, submitted, approved, published, hidden, archived, and deleted content. | ARCH-001 | `docs/ARCHITECTURE.md`, `docs/GAMEDOC.md`, server schema docs | State transitions are documented with required actor, validation, audit, and rollback behavior. |
| ARCH-003 | Freeze GameDoc compatibility policy and migration contract. | ARCH-001 | `src/sdk/gamedoc*`, `tests/fixtures/`, `docs/GAMEDOC.md` | Fixtures cover current and previous versions; unknown future versions fail clearly. |
| ARCH-004 | Add acceptance test matrix for Studio, publish, multiplayer, economy, plugins, moderation, and discovery. | ARCH-001 | `tests/`, Playwright or browser smoke harness | CI or documented local gates cover the main creator and player loops. |
| ARCH-005 | Replace drifting plugin docs with an implementation-backed plugin audit. | ARCH-001 | `docs/PLUGINS.md`, `src/sdk/`, registry modules | Docs state exactly which registries exist and which package features do not exist yet. |
| ARCH-006 | Establish module ownership boundaries for platform subsystems. | ARCH-001 | `docs/ARCHITECTURE.md` | New work can be assigned to identity, publishing, Studio, runtime, economy, trust, analytics, or ops without ambiguity. |

### Phase 1: Accounts, Identity, and Ownership

**Goal:** replace anonymous creator ownership and local device dedup with authenticated platform identity.
**Phase gate:** a creator can sign in, claim existing drafts/published games, publish under an account, and see account-backed likes/reports/plays deduplicated server-side.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| ID-001 | Add account schema: users, sessions, devices, ownership claims, roles, and audit fields. | ARCH-002 | `server/db*`, migrations, `server/http*` | Migration creates account tables without losing existing games. |
| ID-002 | Implement authentication: session cookies or bearer tokens, token rotation, logout, and device upgrade. | ID-001 | `server/auth*`, `src/portal*`, `src/studio*` | User can sign in, refresh, logout, and resume on page reload. |
| ID-003 | Claim anonymous published games by edit token into an account. | ID-001, ID-002 | `server/games*`, `src/portal*` | Existing token-owned games can be claimed once; duplicate claims are rejected and audited. |
| ID-004 | Replace localStorage dedup for likes, reports, and plays with account/device-backed server records. | ID-002 | `server/social*`, `server/moderation*`, `src/portal*` | Clearing localStorage no longer allows repeated likes or report spam. |
| ID-005 | Add public creator profile and private creator dashboard identity surfaces. | ID-002 | `src/portal*`, API routes | Public profile exposes safe published metadata; private dashboard shows owned drafts and games. |
| ID-006 | Add teams and roles schema without full collaboration UI. | ID-001 | `server/teams*`, DB migrations | A game can be owned by a team with owner/admin/editor/analyst role checks enforced in API tests. |

### Phase 2: Studio Publish, Remix, and Version Workflow

**Goal:** make Studio the primary publishing surface and make versions immutable.
**Phase gate:** a creator can validate, publish, republish, rollback, remix, and inspect review status from Studio.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| STUDIO-001 | Build Studio publish drawer with visibility, version notes, maturity, thumbnail, dependencies, and validation report. | ID-002, ARCH-003 | `src/studio/`, `src/sdk/gamedoc*`, `server/games*` | Publish cannot proceed until required fields and validation pass. |
| STUDIO-002 | Create immutable game versions and make republish create a new version. | ID-003, ARCH-002 | DB migrations, `server/games*`, `src/main*` | Existing published URLs resolve to a stable version or explicit latest alias. |
| STUDIO-003 | Add version history, compare summary, rollback-to-draft, and restore controls. | STUDIO-002 | `src/studio/`, `src/portal*`, API routes | Creator can restore an older version into a draft without mutating the published version. |
| STUDIO-004 | Add remix/source lineage fields and workflow. | STUDIO-002 | `src/sdk/gamedoc*`, `server/games*`, `src/studio/` | Remixed games record source game, source version, creator, license, and attribution. |
| STUDIO-005 | Strengthen preflight validation for dependencies, performance budgets, missing assets, unsafe rules, economy hooks, and multiplayer limits. | STUDIO-001 | `src/sdk/validation*`, `src/studio/`, `server/validation*` | Server and Studio return matching validation errors for the same GameDoc. |
| STUDIO-006 | Expand Studio tests around placement, Floor Plan, publish drawer, version history, remix, and validation failures. | STUDIO-001, STUDIO-002, STUDIO-003, STUDIO-004, STUDIO-005 | `tests/`, browser smoke harness | Tests cover narrow editor regressions and the complete publish workflow. |

### Phase 3: Plugin and Package Manifest, Loader, and Registry Introspection

**Goal:** turn loose registries into a platform package system.
**Phase gate:** first-party packages install through a manifest, expose registry metadata to Studio, and can be enabled/disabled with compatibility checks.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| PLUGIN-001 | Define `PluginManifest` schema with id, version, engine range, package type, registry contributions, dependencies, permissions, and assets. | ARCH-005 | `src/sdk/plugin*`, `docs/PLUGINS.md`, tests | Invalid manifests fail with actionable errors. |
| PLUGIN-002 | Implement loader lifecycle: discover, validate, install, enable, initialize, register, disable, uninstall, migrate. | PLUGIN-001 | `src/sdk/plugin-loader*`, `src/runtime/`, `src/studio/` | A package can be enabled and disabled without stale registry entries. |
| PLUGIN-003 | Add registry introspection beyond behavior types. | PLUGIN-001 | registry modules for materials, behaviors, weapons, sky, textmap tiles, rules | Studio can list registry entries with display name, category, properties, version, package, and permissions. |
| PLUGIN-004 | Convert first-party registry contributions into manifest-backed packages. | PLUGIN-002, PLUGIN-003 | `src/plugins/`, `src/sdk/`, `src/studio/` | Existing games still load; registry data reports package provenance. |
| PLUGIN-005 | Add Studio plugin manager for installed/enabled packages and compatibility warnings. | PLUGIN-002 | `src/studio/` | Creator can see which packages a draft depends on and disable unused packages. |
| PLUGIN-006 | Design marketplace/catalog API for packages without untrusted code execution. | PLUGIN-001, ID-002 | `server/packages*`, `src/portal*`, docs | Catalog lists trusted packages with install metadata and moderation state. |
| PLUGIN-007 | Replace SDK placeholder claims with a real package boundary plan. | PLUGIN-001 | `package.json`, `src/sdk/`, docs | Docs distinguish internal SDK modules from a future distributable SDK. |

### Phase 4: Trusted Asset, Content Pipeline, and Moderation

**Goal:** publish content through validation, generated artifacts, and review states.
**Phase gate:** public catalog publishing requires a passed content pipeline and produces audited moderation state.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| CONTENT-001 | Add artifact registry for thumbnails, cooked runtime manifest, search document, dependency snapshot, and moderation snapshot. | STUDIO-002, PLUGIN-004 | DB migrations, `server/artifacts*`, `src/sdk/` | Every approved version has required artifacts linked by hash. |
| CONTENT-002 | Add asset cook pipeline for generated thumbnails, GameDoc normalization, package dependency lock, and performance budget summary. | CONTENT-001 | `server/pipeline*`, `src/studio/`, tests | Pipeline is deterministic for the same source version. |
| CONTENT-003 | Implement publish review states and queue. | ARCH-002, ID-006 | `server/moderation*`, `src/portal*`, `src/studio/` | Submitted content cannot become public without state transition and audit record. |
| CONTENT-004 | Add moderation categories, rejection reasons, appeal notes, and admin action audit. | CONTENT-003 | `server/moderation*`, admin UI/API | Hide, reject, approve, and restore actions are audited with actor and reason. |
| CONTENT-005 | Add maturity gates and catalog filters. | CONTENT-003 | `server/games*`, `src/portal*`, `src/studio/` | Content can be filtered by maturity state before discovery ranking. |
| CONTENT-006 | Add blocking primitives for users, creators, and game interactions. | ID-002 | `server/social*`, `src/portal*`, `src/runtime/` | Blocked users are filtered from direct social surfaces and restricted interactions. |
| CONTENT-007 | Replace local report implementation with account/device-backed reports and duplicate detection. | ID-004, CONTENT-003 | `server/moderation*`, client report UI | Report spam is rate-limited, deduplicated, and still preserves evidence. |

### Phase 5: Authoritative Multiplayer and Session Orchestration

**Goal:** move from client-hosted room behavior to server-orchestrated sessions with authoritative critical state.
**Phase gate:** a multiplayer published game survives host departure, validates critical events server-side, and exposes session health metrics.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| NET-001 | Replace hardcoded WebSocket endpoint with environment-configured connection discovery. | ARCH-006 | `src/engine/network*`, server config | Local, staging, and production endpoints work without source edits. |
| NET-002 | Add session service: create, join, list, retire, room code, private room, capacity, and lifecycle state. | ID-002 | `server/sessions*`, `src/portal*`, `src/runtime/` | Room state is server-owned and queryable. |
| NET-003 | Persist hosted session metadata and recover from host leave. | NET-002 | `server/sessions*`, WebSocket rooms | Host election does not lose room identity or admission state. |
| NET-004 | Define authoritative event classes: movement hints, interactions, economy claims, damage, score, inventory, chat, and admin events. | NET-002 | `src/engine/network*`, `server/sessions*`, docs | Each event class has owner, validation, rate limit, and persistence policy. |
| NET-005 | Move PvP health and damage ledger to server arbitration with stricter validation. | NET-004 | `src/engine/combat*`, `server/combat*`, WebSocket routes | Client cannot directly set victim health; server broadcasts accepted damage and kills. |
| NET-006 | Add server checkpoints for session-scoped mutable world state. | NET-003, NET-004 | `server/sessions*`, runtime systems | Late joiners receive consistent door, switch, score, and key shared state. |
| NET-007 | Add load, latency, packet, disconnect, and room saturation metrics. | NET-002 | metrics module, ops dashboard/API | Active rooms and WebSocket health are observable. |
| NET-008 | Add multiplayer acceptance tests with two or more browser clients. | NET-002, NET-003, NET-004, NET-005, NET-006 | browser tests, server test harness | Tests cover join, room code, host leave, shared event, and PvP arbitration. |

### Phase 6: Server Ledger Economy and Marketplace

**Goal:** make Bolts, stores, earnings, and entitlements server-owned.
**Phase gate:** creator earnings and player purchases are backed by immutable ledger entries and cannot be forged by client localStorage.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| ECO-001 | Design ledger schema: accounts, balances, entries, source event, idempotency key, reversal, and audit. | ID-002 | DB migrations, `server/economy*`, docs | Balances are derived from ledger entries or reconciled snapshots. |
| ECO-002 | Replace local mutable Bolts for authenticated users with server balance sync. | ECO-001 | `src/engine/economy*`, `server/economy*` | Editing localStorage does not change server balance. |
| ECO-003 | Add earn-event validation and caps for gameplay rewards. | ECO-002, NET-004 | `server/economy*`, runtime event hooks | Reward spam is idempotent and rate-limited by source. |
| ECO-004 | Implement per-game store products, prices, inventory, and receipts. | ECO-002, STUDIO-001 | `server/store*`, `src/studio/`, `src/runtime/` | Purchases create receipts and entitlements. |
| ECO-005 | Add creator earnings attribution and payout ledger entries. | ECO-001, CONTENT-001 | `server/economy*`, analytics events | Creator dashboard reconciles plays, purchases, and earnings. |
| ECO-006 | Add package/cosmetic marketplace catalog with moderation state. | PLUGIN-006, CONTENT-003 | `server/marketplace*`, `src/portal*`, `src/studio/` | Only approved catalog items can be sold or installed publicly. |
| ECO-007 | Add economy abuse review tooling. | ECO-003, ECO-005 | admin API/UI, audit logs | Admin can inspect suspicious ledger activity and reverse entries. |

### Phase 7: Sandboxed Scripting and Advanced Creator APIs

**Goal:** let advanced creators exceed visual rules without exposing players or the platform to arbitrary code.
**Phase gate:** a scripted game runs in a sandbox with capability permissions, watchdog termination, publish review signals, and documented APIs.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| SCRIPT-001 | Write scripting threat model and capability API. | PLUGIN-001, CONTENT-003, NET-004 | `docs/SCRIPTING.md`, `src/sdk/` | Threat model defines denied APIs, allowed capabilities, limits, and failure behavior. |
| SCRIPT-002 | Implement sandbox host using Worker or stronger isolated runtime. | SCRIPT-001 | `src/sdk/script-host*`, runtime systems | Script cannot access DOM, network, storage, cookies, or unrestricted timers. |
| SCRIPT-003 | Add CPU, memory, message size, and execution watchdogs. | SCRIPT-002 | script host, tests | Infinite loop or message flood is terminated and reported. |
| SCRIPT-004 | Add permission prompts and publish-time script review flags. | SCRIPT-002, CONTENT-003 | `src/studio/`, `server/moderation*` | Scripted game submission shows requested capabilities and review risk. |
| SCRIPT-005 | Expose stable creator APIs for events, parts, rules, inventory, economy claims, UI prompts, and session state. | SCRIPT-002, NET-004, ECO-003 | `src/sdk/creator-api*`, docs | API tests demonstrate allowed calls and rejected calls. |
| SCRIPT-006 | Add script editor, examples, diagnostics, and API docs in Studio. | SCRIPT-005 | `src/studio/` | Creator can write, test, debug, and publish a simple script without leaving Studio. |
| SCRIPT-007 | Add package support for scripted modules with dependency permissions. | SCRIPT-004, PLUGIN-002 | plugin loader, package catalog | Scripted package install shows capabilities and can be disabled safely. |

### Phase 8: Analytics, Discovery, Social, and Team Collaboration

**Goal:** give creators platform feedback loops and give players safer discovery and social mechanics.
**Phase gate:** creators can diagnose performance and retention; players can follow, block, favorite, join friends, and discover ranked content with abuse controls.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| ANALYTICS-001 | Define event taxonomy for Studio funnel, publishing, plays, retention, session health, economy, moderation, and discovery. | ARCH-006 | `server/analytics*`, docs | Events have names, schema, retention, privacy class, and owner. |
| ANALYTICS-002 | Implement analytics ingestion and aggregation. | ANALYTICS-001 | `server/analytics*`, DB migrations or event store | Dashboards can query daily creator/game metrics. |
| ANALYTICS-003 | Add creator analytics panel in Studio and portal. | ANALYTICS-002, STUDIO-001 | `src/studio/`, `src/portal*` | Creator sees plays, retention, likes, reports, earnings, devices, and validation failures. |
| DISC-001 | Replace simple discovery sorting with ranking inputs and trust filters. | ANALYTICS-002, CONTENT-005 | `server/discovery*`, `src/portal*` | Hidden/rejected/maturity-filtered content cannot rank publicly. |
| SOCIAL-001 | Add favorites, follows, blocks, and friend join primitives. | ID-002, CONTENT-006 | `server/social*`, `src/portal*`, runtime UI | Social actions are account-backed and rate-limited. |
| SOCIAL-002 | Add comments or lightweight creator updates only after moderation controls exist. | SOCIAL-001, CONTENT-004 | `server/social*`, moderation UI | User-generated text is reportable, block-aware, and admin-audited. |
| TEAM-001 | Add team management UI and role-aware Studio actions. | ID-006, STUDIO-001 | `src/studio/`, `src/portal*`, `server/teams*` | Editors can edit drafts but cannot change payouts or publish without permission. |
| TEAM-002 | Add collaboration comments, review requests, and publish approvals. | TEAM-001, STUDIO-002 | `src/studio/`, `server/teams*` | Team publish flow can require approval from an owner/admin. |

### Phase 9: Mobile, Performance, and Accessibility

**Goal:** make Boxcade playable and creatable across common devices without excluding keyboard, touch, or assistive users.
**Phase gate:** core play, Studio basics, publishing, and discovery pass mobile, keyboard, and performance budgets.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| MOBILE-001 | Add touch movement, camera, jump, interact, inventory, and menu controls. | NET-001 | `src/engine/input*`, runtime HUD | A phone can play obby, sandbox, combat, and social rooms without keyboard. |
| MOBILE-002 | Add Studio touch placement and transform controls for small screens or define supported minimum editor viewport. | STUDIO-006, MOBILE-001 | `src/studio/` | Studio either works on target tablet/phone sizes or blocks unsupported sizes clearly. |
| PERF-001 | Define performance budgets for draw calls, parts, scripts, package count, network rate, memory, and load time. | ARCH-004 | docs, validation modules | Publish preflight reports budget usage and failures. |
| PERF-002 | Add asset/runtime profiling and low-end quality modes. | PERF-001 | renderer/runtime modules, Studio preview | Player can switch quality mode; Studio warns on expensive worlds. |
| PERF-003 | Add interest management and LOD acceptance tests at target room sizes. | NET-007, PERF-001 | server sessions, runtime renderer | Large rooms stay within latency and frame budget targets. |
| A11Y-001 | Add keyboard navigation, focus states, labels, contrast pass, reduced motion, and scalable text audit. | STUDIO-001 | `src/`, CSS, UI components | Main portal, Studio publish drawer, and runtime menus pass documented checks. |
| A11Y-002 | Add remappable controls and readable HUD scaling. | MOBILE-001, A11Y-001 | input/HUD modules | Players can adjust controls and HUD scale without breaking layout. |

### Phase 10: Operations, Governance, Portability, and Scale

**Goal:** run Boxcade as a durable service with backups, migrations, audit, incident response, export, and clear platform policy.
**Phase gate:** the platform can be deployed, monitored, backed up, restored, migrated, audited, and governed without tribal knowledge.

| ID | Task | Dependencies | File/module areas | Acceptance gate |
|---|---|---|---|---|
| OPS-001 | Add health, readiness, metrics, structured logs, and status endpoint. | NET-007 | `server/ops*`, deployment config | External monitor can detect app, DB, WebSocket, and queue health. |
| OPS-002 | Add migration runner with forward-only migrations and rollback plan. | ID-001, STUDIO-002 | `server/migrations/`, docs | Fresh install and upgraded install produce the same schema. |
| OPS-003 | Add backup and restore runbook for SQLite or selected production DB. | OPS-002 | deployment docs, scripts | Restore drill succeeds on staging data. |
| OPS-004 | Add admin audit log for privileged actions and sensitive reads. | CONTENT-004, ECO-007 | `server/audit*` | Admin actions are immutable and searchable by actor, target, action, and time. |
| OPS-005 | Remove one-process assumptions where scale requires separation. | OPS-001, NET-002 | server entrypoints, deployment config | Static app, API, WebSocket/session workers, and jobs can be run separately. |
| GOV-001 | Publish platform policy docs: creator terms, package trust levels, moderation policy, data retention, schema deprecation, and API stability. | CONTENT-004, PLUGIN-006 | `docs/` | Policies are linked from publish and package submission flows. |
| PORT-001 | Add export/import for GameDoc, versions, dependencies, thumbnails, and metadata. | CONTENT-001, PLUGIN-004 | `src/studio/`, `server/export*` | Creator can export an owned game and re-import it with dependency validation. |
| PORT-002 | Add public status and incident workflow. | OPS-001 | docs, status endpoint | Incidents can be created, updated, and resolved with public status history. |

## Risk Register and Task Gates

| Risk | Impact | Mitigation | Gate |
|---|---|---|---|
| GameDoc schema drift | Old share links, drafts, and published games break. | Versioned migrations, fixtures, canonical validation, and explicit compatibility messages. | ARCH-003, STUDIO-002 |
| Anonymous ownership model persists too long | Creator trust, payouts, collaboration, and abuse response remain weak. | Prioritize identity before marketplace, teams, and public-scale discovery. | ID-001 to ID-006 |
| Plugin system executes untrusted code too early | Security failure and moderation burden. | Manifest and package catalog first; scripting only after sandbox and permissions. | PLUGIN-001 to PLUGIN-006, SCRIPT-001 |
| Client-authoritative economy or PvP remains exploitable | Forged currency, unfair combat, invalid leaderboards. | Server ledger, authoritative damage, idempotency, and validation. | NET-005, ECO-001 to ECO-003 |
| Moderation is bolted on after growth | Public catalog becomes hard to govern. | Review states, report taxonomy, admin audit, maturity gates before stronger discovery. | CONTENT-003 to CONTENT-007 |
| Studio and server validation diverge | Creators pass local checks but fail publish, or unsafe content passes. | Shared validation package and parity tests. | STUDIO-005 |
| Analytics becomes surveillance or noise | Low trust and poor decisions. | Event taxonomy with privacy class, retention, and creator-facing purpose. | ANALYTICS-001 |
| One-process local architecture leaks into production | Poor uptime and hard recovery. | Health, migrations, backups, separated workers, environment config. | OPS-001 to OPS-005 |
| Mobile support is treated as polish | Large part of player base has broken controls. | Mobile controls and performance budgets before scale claims. | MOBILE-001, PERF-001 |
| Marketplace arrives before accounting | Creator balances and entitlements become untrustworthy. | Ledger and receipt model before public marketplace. | ECO-001 to ECO-006 |

General task gates:

- Schema changes include migration, fixtures, and downgrade/error behavior.
- Public API changes include authentication, authorization, rate limits, and tests.
- Studio workflow changes include browser smoke coverage.
- Runtime authority changes include two-client multiplayer tests.
- Economy changes include idempotency and audit.
- Moderation changes include admin audit and reversal path.
- Plugin changes include compatibility and dependency tests.
- Ops changes include runbook updates.

## Near-Term Plan

### 30 Days

Focus: make the platform contract honest and stop building on anonymous ownership.

- Complete ARCH-001 through ARCH-006.
- Complete ID-001, ID-002, and ID-003.
- Start ID-004 for server-backed deduplication.
- Complete STUDIO-001 publish drawer design and validation wiring.
- Complete PLUGIN-001 manifest schema draft and PLUGIN-003 registry introspection plan.
- Add at least one end-to-end browser smoke for Studio draft to publish validation.

Exit criteria:

- Current docs no longer overclaim plugin, SDK, identity, or moderation capabilities.
- Authenticated creator can claim an existing token-owned game.
- Studio can show a real preflight validation report before publish.

### 60 Days

Focus: versioned publishing, plugin package foundation, and review states.

- Complete ID-004, ID-005, and the schema portion of ID-006.
- Complete STUDIO-002, STUDIO-003, STUDIO-004, and STUDIO-005.
- Complete PLUGIN-001 through PLUGIN-004.
- Complete CONTENT-001, CONTENT-002, and CONTENT-003.
- Start NET-001 and NET-002.
- Add tests for version immutability, remix lineage, server validation parity, and first-party package enable/disable.

Exit criteria:

- Republish creates immutable versions.
- Public catalog publishing can require review state.
- First-party registry entries report package provenance.
- WebSocket endpoint configuration is not hardcoded.

### 90 Days

Focus: server authority, economy ledger, and operational basics.

- Complete NET-001 through NET-005.
- Complete ECO-001 through ECO-003.
- Complete CONTENT-004 through CONTENT-007.
- Complete OPS-001 and OPS-002.
- Start ANALYTICS-001 and PERF-001.
- Add two-client acceptance tests for shared session state and PvP damage arbitration.

Exit criteria:

- Client cannot forge Bolts balance for authenticated accounts.
- PvP health is server-owned for multiplayer sessions.
- Reports and moderation actions are account/device-backed and audited.
- Health/readiness and migration checks exist for deployment.

## Definition of Done for Platform Parity

Boxcade reaches platform parity when all of the following are true:

- Creators authenticate, own games, work in teams, and recover access across devices.
- Studio supports build, test, validate, publish, republish, remix, version history, rollback, dependency inspection, analytics, and earnings.
- GameDoc, package manifests, published versions, artifacts, and migrations are versioned and tested.
- Public publishing runs through validation, review state, moderation tools, maturity gates, and audit.
- Discovery ranks approved content using quality, trust, engagement, and safety signals.
- Multiplayer sessions are server-orchestrated, observable, recoverable, and authoritative for critical state.
- Economy, stores, marketplace purchases, creator earnings, and entitlements are server-ledger-backed.
- Plugin packages have manifests, lifecycle, compatibility checks, registry introspection, catalog metadata, and permissions.
- Sandboxed scripting exists with capability APIs, resource limits, diagnostics, and review signals.
- Analytics gives creators actionable retention, quality, monetization, and moderation feedback.
- Mobile play is first-class, Studio has a clear mobile/tablet stance, and accessibility checks are part of release gates.
- Operations include health, metrics, logs, migrations, backups, restore drills, admin audit, incident workflow, and deployment runbooks.
- Export/import exists for creator-owned work with dependency validation and clear rights boundaries.

## Research Basis

This roadmap is based on public documentation patterns from established creator, UGC, marketplace, safety, and analytics platforms. The point is not to copy product surface area; it is to adopt proven platform primitives: identity, teams, versioning, moderation, capability boundaries, analytics, marketplace controls, and operational status.
The list is representative, non-exhaustive, and intentionally excludes the benchmark named in the request.

- Epic Games Creator Portal team and publishing concepts: https://dev.epicgames.com/documentation/en-us/fortnite/creating-teams-in-creator-portal-in-unreal-editor-for-fortnite
- Epic Verse language and device API documentation, useful as a reference for capability-scoped creator APIs: https://dev.epicgames.com/documentation/en-us/uefn/verse-language-reference
- Unity UGC and Vivox-related platform documentation, useful for creator content lifecycle and community service thinking: https://docs.unity.com/ugs/en-us/manual/overview/manual/unity-gaming-services-home
- mod.io moderation documentation, useful for report queues and UGC moderation workflow concepts: https://docs.mod.io/restapiref/#moderation
- mod.io monetization documentation, useful for marketplace and creator economy primitives: https://docs.mod.io/monetization
- Google Play User Generated Content policy, useful for content moderation, reporting, and removal expectations: https://support.google.com/googleplay/android-developer/answer/9876937
- Microsoft Store XR-018 user generated content policy, useful for safety requirements around online UGC: https://learn.microsoft.com/en-us/gaming/gdk/docs/store/policies/pc/live-policies-pc#xr-018-user-generated-content
- GameAnalytics documentation, useful for event taxonomy and creator analytics design: https://docs.gameanalytics.com/
