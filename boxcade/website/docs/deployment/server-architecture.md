---
sidebar_position: 2
description: How the Blobcade server scales — a two-tier relay architecture, load model, and hosting-cost comparison (AWS/Azure vs VPS hosters vs federated).
---

# Server architecture, scaling & hosting

> Companion to [Native clients (Tauri)](./native-clients.md). That page covers
> wrapping the client in Tauri (desktop/Android/iOS/browser). This doc covers the
> **server** that all those clients talk to: how it scales, how future "server
> nodes" attach, how the hosted server becomes a **relay/coordinator** for those
> nodes, the real load profile derived from the code, and a cost comparison of
> **AWS/Azure vs VPS hosters vs community-federated** deployment.
>
> Planning document, aligned to the existing `ROADMAP.md` (Phase 5 authoritative
> multiplayer, `NET-001/002`, `OPS-005`).
>
> Note on "self-hosting": in this doc **"self-hosting" means renting VPS /
> dedicated boxes from hosters** (Hetzner, OVH, Contabo, DigitalOcean, Vultr,
& Linode/Akamai, Hostinger…), not a machine on a home/office LAN.

---

## TL;DR

- Blobcade's server today is **one Node process** doing two very different jobs:
  a **heavy** 15 Hz WebSocket room fan-out (`server/server.mjs`) and a **light**
  REST + SQLite ledger (`server/http.mjs`, `server/db.mjs`). These two jobs scale
  nothing alike and should be split.
- The room fan-out is **egress-bound**: each player receives the transforms of
  everyone near them, 15×/sec. A single Node process tops out around
  **~1,500–2,500 concurrent players (CCU)**, limited by outbound bandwidth and
  JSON serialization — *not* CPU or memory.
- **One central server does not scale.** Worse, on hyperscaler cloud the per-GB
  egress fee ($0.09/GB) makes a busy relay node cost **~$890/month each**.
- **Target topology: two tiers.**
  1. **Coordinator** (the "hosted server"): discovery, publish/leaderboards/
     economy ledger, **room registry + matchmaker**. Light, persistent, cheap.
     This is what your hosted box becomes — it *relays/directs* clients to nodes.
  2. **Relay nodes**: the actual 15 Hz rooms. Heavy, **stateless toward each
     other** (each room lives on exactly one node), horizontally scalable, and
     **federated** — they can be your own VPS hosters *or* community-donated.
- **Yes — the hosted server becomes a relay for the server nodes.** It stops
  carrying room traffic itself (except as a fallback node) and becomes a
  directory that hands clients the right node URL.
- **Cost verdict:** for the relay tier, **VPS hosters with included bandwidth
  (Hetzner/OVH/Contabo: 20–32 TB or unmetered) are ~20–50× cheaper than AWS/Azure.**
  The coordinator is near-free anywhere. At 50k CCU: AWS/Azure ≈ **$30k/mo**,
  VPS hosters ≈ **$1.4k/mo**, half-community-federated ≈ **$0.7k/mo**.

---

## 1. What the server does today (and where the cost lives)

```
server/server.mjs  ── WebSocket relay (THE heavy part)
  · rooms per game id, room codes, host election          (server.mjs:123-180)
  · 15 Hz state fan-out with interest mgmt (r=60, far=1Hz)(server.mjs:258-287)
  · chat (rate-limited), generic event relay (rate-limited)
  · PvP hit arbitration w/ damage budget + server HP      (server.mjs:199-222)
server/http.mjs    ── REST API (light)
server/db.mjs      ── SQLite: games, likes, reports, earnings, scores (light)
```

The seam already exists in the code: **room logic (`server.mjs`) is cleanly
separated from the ledger/REST (`http.mjs` + `db.mjs`)**. That separation is the
foundation for the two-tier split — no refactor required, just deployment.

### 1.1 Load model — derived from the code (auditable)

**Tick & fan-out** (`server.mjs:30, 258-287`): the broadcast runs every `TICK_MS`
= 66 ms ≈ **15.15 Hz**. For each room, for each target player, it collects the
state of every *dirty* player within `INTEREST_RADIUS = 60`; players farther
away are sent at most once per `FAR_SNAPSHOT_MS = 1000` (1 Hz). Each state entry
is `[id, x, y, z, ry, anim, vehicle]` ≈ **~42 bytes** of JSON.

**Outbound per room** (worst case, everyone near everyone):

```
bytes/sec ≈ 15 × n × (n − 1) × 42        (n = players in the room, all near)
```

| Room size `n` | Outbound / room / sec | Typical game |
|---|---|---|
| 8  | ~35 KB/s   | small obby / co-op |
| 16 | ~140 KB/s  | CTF match |
| 32 | ~600 KB/s  | battle-royale mid-game |
| 64 | ~2.5 MB/s  | full Squadfall (DEFAULT_ROOM_LIMIT = 64) |

In spread-out worlds, interest management cuts this to ~30–50% of the worst case.

**Inbound per player** (`network.ts:200`): `sendState` is throttled to 80 ms ≈
**12.5 Hz**, ~45 B/msg → **~0.5 KB/s/player**. Negligible.

**Outbound per player** (what each client *receives*): ≈ `(near players) × 15 × 42 B`.
Small room (8): ~4 KB/s. Full 64-room: ~40 KB/s. Planning average across mixed
rooms: **~6 KB/s/player**.

### 1.2 What limits a single node

| Resource | Pressure | Notes |
|---|---|---|
| **Outbound bandwidth** | **THE limit** | 6 KB/s/player × CCU. 1,500 CCU ≈ 72 Mbps sustained. |
| **CPU (event loop)** | High | Single Node thread serializes JSON + `ws.send` per target per tick. Saturates ~1k–3k CCU. Run 2–4 processes/box to use more cores. |
| Memory | Low | Server stores only the last transform per player (~tens of bytes). 1k players ≈ a few MB. |
| Inbound | Low | 0.5 KB/s/player. |
| SQLite/REST | Trivial | Low QPS; file DB. |

**Planning capacity: ~1,500–2,500 CCU per box** (a few Node processes), capped by
uplink bandwidth and the single-thread event loop. Bigger/denser rooms → fewer
CCU; small obby rooms → more.

---

## 2. Why one central server doesn't scale

Two independent problems force the split:

1. **The fan-out is O(n²) per room and chatty.** Pushing every active room
   through one process caps you at low thousands of CCU regardless of how beefy
   the box is (single Node thread).
2. **Egress is the cost killer on hyperscaler cloud.** A relay node at 1,500 CCU
   pushes ~9–23 TB/month outbound. At AWS/Azure's **$0.09/GB**, that is
   **~$800–2,100 per node per month just in bandwidth** — compute is almost
   irrelevant next to it.

The good news: **rooms are independent.** Room `sky-obby#ABCD` has zero need to
share state with `facing-towers#ZZQQ`. Every room can live on exactly one node.
That makes the heavy tier **embarrassingly horizontal** — and the perfect shape
for offloading to cheap, flat-bandwidth hosters and even community-donated nodes.

---

## 3. Target topology — Coordinator + Relay nodes (two-tier)

```
                         ┌─────────────────────────────────────┐
                         │  COORDINATOR  (your hosted box)      │
                         │  · REST: discovery, publish, versions│
                         │  · SQLite/Postgres ledger: games,    │
                         │    likes, reports, earnings, scores  │
                         │  · ROOM REGISTRY + MATCHMAKER        │
                         │    gameKey#code → node URL, region,  │
                         │    capacity, trust, lastHeartbeat    │
                         │  · (future) accounts, identity       │
                         └───────┬──────────────────┬──────────┘
                  register/heartbeat│                │ resolve(room)
                                   │                │
        ┌──────────────┬───────────┴──┐  ┌──────────┴─────────────┐
        ▼              ▼              ▼  ▼            ▼            ▼
  Relay node A   Relay node B   Relay node C   Community    Community
  (your VPS)     (your VPS)     (autoscale)    node (donated) node
  rooms…         rooms…         rooms…         rooms…        rooms…
        │              │              │   │            │            │
        └──────────────┴──── wss: ────┴───┴────────────┴────────────┘
                       clients connect directly to the chosen node
```

### 3.1 Coordinator (the "hosted server" — light, persistent, cheap)

This is the box **you must run yourself.** It carries **no 15 Hz room traffic.**
Responsibilities:

- The existing REST API + DB (`http.mjs` / `db.mjs`): discovery, publish/edit/
  unpublish, likes, reports, leaderboards, creator earnings, moderation.
- **NEW: room registry + matchmaker.** A table mapping `gameKey#roomCode →
  { nodeUrl, region, capacity, ccu, trust, lastHeartbeat }`, plus endpoints:
  - `POST /api/nodes/register` — a node announces itself (auth token, region,
    capacity, public `wss://` URL).
  - `POST /api/nodes/heartbeat` — node reports live CCU / rooms (every few sec).
  - `GET  /api/rooms/resolve?g=<gameKey>[&room=<code>]` — **the client's first
    call**: returns the `wss://` URL of the node that should host/join this room
    (auto-assign = least-loaded suitable node; explicit code = that room's node,
    or "create here").
- (Roadmap-aligned) accounts/identity, session service (`NET-002`), analytics.

Because it only answers occasional directory/ledger calls (one per join, not per
frame), its load is **~2 orders of magnitude lower** than a relay node. A tiny
VPS handles it. This directly satisfies *"we want the hosted load to be low."*

### 3.2 Relay nodes (the heavy 15 Hz rooms — horizontal, replaceable, federated)

Each relay node runs the **existing room logic from `server.mjs`** (minus the
REST DB, or with the DB disabled). On boot it registers with the coordinator and
heartbeats its load. A client arrives already knowing the node URL (from
`/api/rooms/resolve`) and runs the **unchanged** join handshake (`{t:'j', g, n}`).
Nothing about the wire protocol or the client's `network.ts` needs to change
except *which URL it connects to*.

Three flavors of node, freely mixed:

| Flavor | Who runs it | When to use |
|---|---|---|
| **Official (your VPS hosters)** | You, on Hetzner/OVH/Contamo | Baseline guaranteed capacity + quality |
| **Autoscaled (cloud, spot)** | You, ephemeral | Burst capacity during peaks (use cheap-egress regions / Fly.io) |
| **Community (donated/federated)** | Creators/players, their own VPS | Free capacity + geo-distribution, like community Minecraft servers |

### 3.3 "Will the hosted server be a relay for those?" — yes, precisely

The coordinator **is** the relay in the routing sense: clients never need to know
the node list — they ask the coordinator "where do I play `sky-obby#ABCD`?" and
get handed a node URL (yours or a community one). The coordinator can also act as
a **fallback relay node itself** at small scale (literally the current
single-process server), then shed room traffic to dedicated nodes as you grow.
One smooth continuum from "one box" → "coordinator + N nodes."

---

## 4. How "future server nodes" attach (federation)

A community/creator node is just a relay node someone else runs:

1. They run `blobcade-node` (the room server) on their VPS, reachable at a public
   `wss://their.host:port`.
2. They register it with your coordinator via a node auth token (issued through
   a creator account, `ROADMAP` Phase 1 identity). The coordinator tags it
   `trust: community`, region, capacity.
3. The matchmaker may route public/auto-assign rooms to it (subject to policy:
   region, trust tier, opt-in). Explicit room codes on a community node stay on
   that node (the creator's private server).
4. The node heartbeats load; if it dies, its rooms die (rooms are ephemeral —
   the server already deletes empty rooms, `server.mjs:250-253`) and clients
   reconnect → matchmaker reassigns.

**This is the scalable form of "self-hosting":** instead of you paying for every
slot, the community donates capacity (exactly how Minecraft/TeamSpeak/Mumble
communities scale), while you keep authoritative control of the *ledger*
(identity, published games, leaderboards, economy, moderation) on your cheap
coordinator.

### 4.1 Trust & authority boundaries

- **The ledger never leaves the coordinator.** Published games, scores, earnings,
  likes, reports, accounts all stay on *your* box. Community nodes only see
  ephemeral room state (transforms, chat, relayed events).
- **PvP arbitration** (`server.mjs:199-222`) today runs server-side with
  plausibility caps. On a community node that arbitration is local to the node —
  a *malicious* community node could cheat within its own room. Mitigations:
  - Mark nodes `official` vs `community`; competitive/leaderboard modes
    (`NET-009`) only run on `official` nodes.
  - The coordinator stays the source of truth for scores/earnings; a rogue node
    can move avatars but can't mint Blobcash or alter leaderboards.
  - Reputation/heartbeat abuse detection; revoke node tokens.
- **`ROADMAP` alignment:** this maps cleanly onto `NET-002` (session service),
  `NET-005` (server damage ledger), `OPS-005` (remove one-process assumptions),
  and the Phase-5 authoritative-multiplayer gate.

### 4.2 Reachability / NAT for community nodes

A community node needs a publicly reachable `wss://` address. Options, cheapest
first:

- Public-IP VPS (Hetzner/OVH/Contabo all give a public IPv4) — **the normal
  case; recommended.** A €4 box is enough for a small community node.
- Home server behind NAT: port-forward / UPnP (fragile, residential upstream is
  the real cap), or…
- **Relay-through**: if a node can't accept inbound, tunnel it through one of
  your official nodes (a TURN-like fallback). Costs *you* bandwidth, so reserve
  this for trusted/official cases, or just require a public-IP VPS.

---

## 5. Cost analysis — AWS/Azure vs VPS hosters vs federated

All figures are **planning estimates** to verify with each provider's calculator;
they are intentionally conservative on the cloud side and generous on the
hoster side. `$1 ≈ €0.93` treated at parity. Egress is the dominant variable.

### 5.1 Unit costs used

| Item | AWS / Azure | VPS hosters (Hetzner/OVH/Contabo) |
|---|---|---|
| **Egress** | **$0.09/GB** (AWS) / $0.087 (Azure); first 100 GB free | **Included flat**: Hetzner 20 TB, Contabo 32 TB, OVH Game unmetered 500 Mbps. Overage ~€1/TB. |
| Relay node compute (8 vCPU/16 GB) | m6i.2xlarge ≈ $170/mo on-demand | Hetzner AX41 dedicated ≈ €35/mo; Contabo VPS L ≈ $16/mo |
| Coordinator (2 vCPU/4 GB, always-on) | t3.medium ≈ $30 / B1ms ≈ $15 | Hetzner CX22 ≈ **€3.79/mo**; OVH VPS Starter ≈ €4 |

**Per-node monthly egress** (the deciding number): a relay node at **1,500 CCU ×
6 KB/s** = ~72 Mbps sustained. Sustained = **~23 TB/mo**; with a realistic 0.4
duty factor (not all CCU active 24×7) ≈ **~9.3 TB/mo**.

- Cloud egress: 9.3 TB × $0.09 ≈ **$837/mo per node** (realistic) → ~$2,100/mo
  sustained. Plus compute → **~$890–$2,300 per node per month.**
- VPS hoster: 9.3 TB sits **inside** the 20–32 TB included bundle → **€35–40
  per node per month, flat.**

> ⚠️ **Hoster sub-split that matters:** not all "VPS hosters" are equal for
> relays. **Hetzner, Contabo, OVH, Hostinger** include 20–32 TB (or unmetered) —
> ideal for relays. **DigitalOcean, Vultr, Linode/Akamai** include only ~1–4 TB
> then charge ~$0.01/GB: still ~9× cheaper than AWS/Azure per GB, but watch the
> overage — fine for the coordinator, risky as a busy relay.

### 5.2 Scenario tables (realistic, 0.4 duty factor)

Node capacity assumed = **1,500 CCU/box** (planning; range 1k–3k by room density).

#### Small launch — 500 CCU
| Tier | AWS / Azure | VPS hosters | Federated |
|---|---|---|---|
| Coordinator (1) | $15 | €4 (~$5) | €4 |
| Relay nodes (1) | $890 | €35 (~$40) | 1 community → $0 |
| **Total / mo** | **~$900** | **~$45** | **~$5** |

(At 500 CCU you'd more likely run one combined box: AWS ~$300/mo, hoster €35/mo.)

#### Growth — 5,000 CCU
| Tier | AWS / Azure | VPS hosters | Federated (½ community) |
|---|---|---|---|
| Coordinator (1–2) | $30 | €6 (~$7) | €6 |
| Relay nodes (4) | 4 × $890 = $3,560 | 4 × €35 = €140 | 2 × €35 + 2 community |
| **Total / mo** | **~$3,600** | **~$150** | **~$80** |

#### Scale — 50,000 CCU
| Tier | AWS / Azure | VPS hosters | Federated (½ community) |
|---|---|---|---|
| Coordinator (3–5 + LB) | $150 | €80 (~$90) | €80 |
| Relay nodes (34) | 34 × $890 = $30,260 | 34 × €35 = €1,190 | 17 × €35 + 17 community |
| **Total / mo** | **~$30,400** | **~$1,280** | **~$670** |

### 5.3 What the numbers say

- **Coordinator is free-tier-able anywhere.** $5–15/mo for the one box you *must*
  own. The whole "low load" goal is achieved by **not putting room traffic on it.**
- **Relay tier is egress-bound → hyperscaler per-GB pricing is the wrong model.**
  AWS/Azure run **~20–50× more expensive** than flat-bandwidth VPS hosters, and
  the gap *widens* with scale.
- **VPS hosters (Hetzner/OVH/Contabo) are the sweet spot** for relays: flat
  bandwidth, dedicated cores, predictable €35/node.
- **Community federation halves it again** and adds free geo-distribution + good
  will, at the cost of trust/ops complexity (§4).
- **Use cloud selectively**, not as the default: the coordinator (or a tiny
  always-on cloud instance), burst/autoscale relays in cheap-egress setups
  (Fly.io is worth evaluating — historically much cheaper egress than AWS/Azure
  and anycast in many regions), and managed Postgres/SQLite backups if you don't
  want to run a DB yourself.

### 5.4 Recommendation

> **Coordinator: one Hetzner/OVH small VPS (~€4–6/mo). Relay nodes: Hetzner
> AX41 / OVH Game / Contabo L dedicated boxes (~€35/mo each), sized to CCU.
> Open a community-node federation path early so capacity can be donated as you
> grow. Avoid AWS/Azure for the relay tier; use cloud only for the coordinator
> and optional autoscale bursts.**

---

## 6. Code seam — what already supports this

The current code is **already shaped** for the split; the migration is mostly
*deployment + a small registry*, not a rewrite:

| Future piece | Today | Change needed |
|---|---|---|
| Room relay (node) | `server/server.mjs` (room loop, PvP, events) | Run standalone; on boot, `POST /api/nodes/register` + heartbeat to coordinator. Optionally drop the `http.createServer`/DB when node-only. |
| Ledger/REST (coordinator) | `server/http.mjs` + `server/db.mjs` | Keep; add `nodes` + `rooms` tables + `/api/nodes/*` + `/api/rooms/resolve`. |
| Matchmaker | Implicit (one process) | Explicit: `resolveRoom()` picks a node from the registry (`server.mjs:74-96` `resolveRoom` becomes a coordinator query). |
| Client endpoint | Hardcoded `ws://hostname:8081` (`network.ts:68`, `api.ts:7`, `portal.ts:128`) | One `GET /api/rooms/resolve` before `connect()`; connect to the returned `wss://`. (= `ROADMAP` `NET-001`.) |
| Single-box mode | Today's `npm run dev` | Still works: coordinator + one local relay node in one process (current behaviour). |

So the **minimal first step** is exactly `ROADMAP` `NET-001` + `NET-002`: make
the endpoint configurable and add the session/room-registry service. The
heavy "split across boxes" work is `OPS-005` and can follow once CCU justifies it.

---

## 7. Phased migration (mapped to `ROADMAP.md`)

| Phase | Does | Roadmap IDs |
|---|---|---|
| **0. Configurable endpoint** | `VITE_BLOBCADE_SERVER` env; client reads server URL from one place. | `NET-001` |
| **1. Host coordinator on a VPS hoster** | Run existing one-process server on Hetzner/OVH; TLS (`wss://`/`https://`). One box = coordinator + relay (today's shape). | `OPS-001/003` |
| **2. Room registry + matchmaker** | `nodes`/`rooms` tables, `/api/nodes/*`, `/api/rooms/resolve`; client resolves before connect. | `NET-002` |
| **3. Peel the first relay node** | Split: coordinator stops hosting rooms; add one official relay VPS; route clients to it. | `OPS-005` |
| **4. Horizontal relays** | Add official relay nodes by CCU; autoscale/burst in cloud for peaks. | `OPS-005`, `NET-007` |
| **5. Community federation** | Node auth tokens, trust tiers, region routing, reputation. | `ID-002`, `CONTENT-*` |
| **6. Authority hardening** | Move damage/score/economy verdicts to official nodes + coordinator ledger. | `NET-005`, `ECO-001` |

Each phase is independently shippable and leaves the one-box mode working.

---

## 8. Assumptions & caveats

- **CCU/node = 1,500 is a planning figure.** Real capacity is 1k–3k depending on
  room size/density and is **bandwidth-bound** first, event-loop-bound second.
  Load-test with `scripts/bot-load.mjs` to calibrate before committing to spend.
- **Egress numbers assume ~6 KB/s/player sustained with a 0.4 duty factor.**
  Battle-royale/CTF rooms run higher; obby rooms lower. Interest management
  already reduces far-player traffic to 1 Hz — keep it.
- **All $/€ figures are ballpark** as of writing; verify with each provider's
  pricing calculator before budgeting. Regional pricing and reserved/spot
  discounts change the cloud numbers (usually still far above hosters).
- **Cloud isn't banned** — it's the wrong *default for the relay tier*. Use it
  for the coordinator, managed DB/backups, and burst autoscale (prefer cheap-
  egress options like Fly.io).
- **Trust:** community nodes can cheat within their own rooms; keep competitive
  modes + the economy ledger on official nodes / the coordinator.
- **Ops you still owe regardless of host:** TLS termination, backups for the
  coordinator DB, health/readiness/metrics (`OPS-001`), migration runner
  (`OPS-002`), admin audit (`OPS-004`).

---

## 9. One-line answer to each question

- **How do we handle future server nodes?** Split into a light **coordinator**
  (ledger + discovery + matchmaker, your hosted box) and heavy **relay nodes**
  (the 15 Hz rooms). Rooms are independent → nodes scale horizontally and can be
  yours *or* community-donated.
- **Will the hosted server be a relay for those?** Yes — the hosted server
  *becomes* the coordinator/matchmaker that directs clients to nodes (yours or
  community). It stops carrying room traffic itself, which is what keeps its load
  low.
- **Server load?** Bandwidth-bound: ~6 KB/s/player outbound; a node tops out
  ~1,500–2,500 CCU (uplink + single Node thread), not CPU/memory. The
  coordinator is ~100× lighter (one call per join, not per frame).
- **AWS/Azure vs self-host (VPS hosters)?** For the relay tier, **VPS hosters
  with included bandwidth (Hetzner/OVH/Contabo) are ~20–50× cheaper** than
  AWS/Azure's per-GB egress. At 50k CCU: ~$30k/mo (cloud) vs ~$1.3k/mo (hosters)
  vs ~$0.7k/mo (half-federated). Host the coordinator anywhere for ~€5/mo.
