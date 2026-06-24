// Blobcade server — one process, one port: the publish/discovery REST API
// (server/http.mjs + node:sqlite) and the multiplayer relay share it.
// Plain JS on purpose: `node server/server.mjs` and you're online.
//
// Rooms are INSTANCES: the wire field `g` is `<gameKey>` (auto-assign to the
// fullest open instance) or `<gameKey>#<CODE>` (join/create that instance —
// the "play with friends" room code). Old clients that send a bare game id
// keep working: they just auto-assign. The server stays a dumb relay; the
// oldest member of a room is its HOST (clients run host-only logic like rule
// timers), announced in the welcome and re-announced when the host leaves.
//
// Protocol (JSON):
//   client → server   { t:'j', g, n }                join
//                     { t:'s', p:[x,y,z], r, a }     transform (client-authoritative)
//                     { t:'c', x }                   chat (rate-limited)
//                     { t:'e', k, d }                game event relay (rate-limited)
//   server → client   { t:'w', id, room, host, players:[...] }
//                     { t:'j', id, n, p, r }         someone joined
//                     { t:'l', id }                  someone left
//                     { t:'h', id }                  new host
//                     { t:'s', s:[[id,x,y,z,ry,a]] } transform fan-out (15Hz)
//                     { t:'c', id, n, x, sys? }      chat
//                     { t:'e', id, k, d }            game event

import http from 'node:http'
import { WebSocketServer } from 'ws'
import { handleApi } from './http.mjs'

const PORT = process.env.BOXCADE_PORT ? Number(process.env.BOXCADE_PORT) : 8081
const TICK_MS = 66 // ~15Hz state broadcast
const DEFAULT_ROOM_LIMIT = 64
const MAX_ROOM_LIMIT = 250
const MAX_GLOBAL_CLIENTS = 5000
const MAX_IP_CLIENTS = 32
const MAX_GLOBAL_ROOMS = 2000
const PREJOIN_IDLE_MS = 20_000
const INTEREST_RADIUS = 60
const INTEREST_RADIUS2 = INTEREST_RADIUS * INTEREST_RADIUS
const FAR_SNAPSHOT_MS = 1000
const MAX_EVENT_BYTES = 2048
const WORLD_BOUND = 100_000
const MAX_BUFFERED_BYTES = 1024 * 1024
const MAX_BUFFER_STRIKES = 3
const STATE_BUDGET_MAX = 90
const STATE_REFILL_PER_SEC = 30
const GAME_KEY_RE = /^[a-z0-9_-]{1,64}$/i
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const server = http.createServer((req, res) => {
  handleApi(req, res).then((handled) => {
    if (!handled) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
      res.end('Blobcade server: API at /api/*, websocket on this port.')
    }
  }).catch(() => {
    try {
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json' })
      res.end('{"error":"server error"}')
    } catch { /* socket gone */ }
  })
})

const wss = new WebSocketServer({ server })
const rooms = new Map() // roomKey "gameKey#code" -> Map<id, client>
const roomCaps = new Map()
const clients = new Set()
const ipCounts = new Map()
let nextId = 1

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function newCode() {
  let c = ''
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return c
}

function roomCap(key) {
  return roomCaps.get(key) ?? DEFAULT_ROOM_LIMIT
}

function cleanMaxPlayers(n) {
  const v = Math.round(Number(n) || DEFAULT_ROOM_LIMIT)
  return Math.min(MAX_ROOM_LIMIT, Math.max(1, v))
}

function remoteIp(req) {
  return req?.socket?.remoteAddress ?? '?'
}

function incIp(ip) {
  const n = ipCounts.get(ip) ?? 0
  ipCounts.set(ip, n + 1)
}

function decIp(ip) {
  const n = (ipCounts.get(ip) ?? 1) - 1
  if (n <= 0) ipCounts.delete(ip)
  else ipCounts.set(ip, n)
}

function rejectBusy(ws) {
  try {
    ws.send(JSON.stringify({ t: 'c', id: -1, sys: true, x: 'Server is busy — try again soon.' }), () => {
      try { ws.close() } catch { /* noop */ }
    })
  } catch {
    try { ws.close() } catch { /* noop */ }
  }
}

function clampFinite(value, min, max, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function allowState(client) {
  const now = Date.now()
  client.stateBudget = Math.min(STATE_BUDGET_MAX, client.stateBudget + ((now - client.stateAt) / 1000) * STATE_REFILL_PER_SEC)
  client.stateAt = now
  if (client.stateBudget < 1) return false
  client.stateBudget -= 1
  return true
}

function canSend(c) {
  if (c.ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
    c.bufferStrikes = 0
    return true
  }
  c.bufferStrikes = (c.bufferStrikes ?? 0) + 1
  if (c.bufferStrikes >= MAX_BUFFER_STRIKES) {
    try { c.ws.terminate() } catch { /* noop */ }
  }
  return false
}

function sendClient(c, data) {
  if (c.ws.readyState !== 1 || !canSend(c)) return false
  try { c.ws.send(data); return true } catch { return false }
}

/** resolve a join spec to a concrete room key (auto-assign or explicit code) */
function resolveRoom(spec, desiredCap = DEFAULT_ROOM_LIMIT) {
  const hash = spec.indexOf('#')
  if (hash >= 0) {
    const gameKey = spec.slice(0, hash)
    const code = spec.slice(hash + 1).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (!GAME_KEY_RE.test(gameKey) || !code) return null
    const key = `${gameKey}#${code}`
    if (!rooms.has(key) && rooms.size >= MAX_GLOBAL_ROOMS) return null
    if (!roomCaps.has(key)) roomCaps.set(key, desiredCap)
    return key
  }
  if (!GAME_KEY_RE.test(spec)) return null
  // auto-assign: fullest open instance of this game, else a fresh one
  let best = null
  let bestSize = -1
  for (const [key, r] of rooms) {
    if (!key.startsWith(spec + '#')) continue
    if (r.size >= roomCap(key)) continue
    if (r.size > bestSize) {
      best = key
      bestSize = r.size
    }
  }
  if (best) return best
  if (rooms.size >= MAX_GLOBAL_ROOMS) return null
  const key = `${spec}#${newCode()}`
  if (!roomCaps.has(key)) roomCaps.set(key, desiredCap)
  return key
}

function room(key) {
  let r = rooms.get(key)
  if (!r) {
    r = new Map()
    rooms.set(key, r)
  }
  return r
}

function broadcast(r, msg, exceptId = -1) {
  const data = JSON.stringify(msg)
  for (const c of r.values()) {
    if (c.id !== exceptId) sendClient(c, data)
  }
}

function hostOf(r) {
  for (const c of r.values()) return c.id // Maps iterate in insertion order
  return -1
}

function cleanName(n) {
  return String(n ?? '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Boxy' + Math.floor(Math.random() * 9999)
}

function validJoinSpec(spec) {
  const hash = spec.indexOf('#')
  const gameKey = hash >= 0 ? spec.slice(0, hash) : spec
  return GAME_KEY_RE.test(gameKey)
}

wss.on('connection', (ws, req) => {
  const ip = remoteIp(req)
  if (clients.size >= MAX_GLOBAL_CLIENTS || (ipCounts.get(ip) ?? 0) >= MAX_IP_CLIENTS) {
    rejectBusy(ws)
    return
  }
  incIp(ip)
  const client = {
    ws,
    ip,
    id: nextId++,
    name: '',
    roomKey: null,
    p: [0, 0, 0],
    r: 0,
    a: 0,
    v: '', // vehicle type while driving ('' on foot)
    dirty: false,
    interestAt: new Map(),
    lastChat: 0,
    stateBudget: STATE_BUDGET_MAX,
    stateAt: Date.now(),
    eventBudget: 20,
    eventAt: Date.now(),
    bufferStrikes: 0,
    // pvp arbitration ledger
    hp: 100,
    respawnAt: 0,
    dmgTokens: 220,
    dmgAt: Date.now(),
    alive: true,
  }
  clients.add(client)
  const prejoinTimer = setTimeout(() => {
    if (!client.roomKey) {
      try { ws.close() } catch { /* noop */ }
    }
  }, PREJOIN_IDLE_MS)
  prejoinTimer.unref?.()

  ws.on('pong', () => { client.alive = true })

  ws.on('message', (raw) => {
    if (raw.length > 64 * 1024) return
    let m
    try { m = JSON.parse(raw.toString()) } catch { return }

    if (m.t === 'j' && !client.roomKey) {
      const spec = String(m.g ?? '').slice(0, 80)
      if (!spec) return
      if (!validJoinSpec(spec)) {
        try { ws.close() } catch { /* noop */ }
        return
      }
      const desiredCap = cleanMaxPlayers(m.max)
      const key = resolveRoom(spec, desiredCap)
      if (!key) {
        rejectBusy(ws)
        return
      }
      const r = room(key)
      if (!roomCaps.has(key)) roomCaps.set(key, desiredCap)
      if (r.size >= roomCap(key)) {
        ws.send(JSON.stringify({ t: 'c', id: -1, sys: true, x: 'Room is full — playing solo.' }))
        ws.close()
        return
      }
      clearTimeout(prejoinTimer)
      client.roomKey = key
      client.name = cleanName(m.n)
      r.set(client.id, client)
      ws.send(JSON.stringify({
        t: 'w',
        id: client.id,
        room: key.slice(key.indexOf('#') + 1),
        host: hostOf(r),
        players: [...r.values()].filter((c) => c.id !== client.id)
          .map((c) => ({ id: c.id, n: c.name, p: c.p, r: c.r })),
      }))
      broadcast(r, { t: 'j', id: client.id, n: client.name, p: client.p, r: client.r }, client.id)
      console.log(`[blobcade] ${client.name}#${client.id} joined ${key} (${r.size} in room)`)
      return
    }

    if (!client.roomKey) return
    const r = rooms.get(client.roomKey)
    if (!r) return

    if (m.t === 's' && Array.isArray(m.p) && m.p.length === 3) {
      if (!allowState(client)) return
      client.p = m.p.map((v) => clampFinite(v, -WORLD_BOUND, WORLD_BOUND, 0))
      // rotation is periodic: normalize to [-pi, pi] rather than clamp, so an
      // accumulated yaw (e.g. a vehicle steered in circles) never mis-faces.
      const yaw = Number(m.r)
      client.r = Number.isFinite(yaw) ? Math.atan2(Math.sin(yaw), Math.cos(yaw)) : 0
      client.a = Math.round(clampFinite(m.a, 0, 16, 0))
      client.v = typeof m.v === 'string' ? m.v.slice(0, 8) : '' // omitted = on foot
      client.dirty = true
    } else if (m.t === 'c') {
      const now = Date.now()
      if (now - client.lastChat < 600) return
      client.lastChat = now
      const text = String(m.x ?? '').slice(0, 200).trim()
      if (!text) return
      broadcast(r, { t: 'c', id: client.id, n: client.name, x: text })
    } else if (m.t === 'x') {
      // PvP hit claim: arbitration only — generic plausibility, not physics.
      // The server doesn't know custom weapon stats, so it enforces caps:
      // ≤100 dmg per claim, a per-attacker damage budget, and range sanity.
      const victimId = Number(m.v)
      const victim = r.get(victimId)
      const dmg = Math.min(100, Math.max(1, Math.round(Number(m.d) || 0)))
      if (!victim || victim === client || victim.hp <= 0) return
      const now = Date.now()
      client.dmgTokens = Math.min(220, client.dmgTokens + ((now - client.dmgAt) / 1000) * 120)
      client.dmgAt = now
      if (client.dmgTokens < dmg) return
      const dx = client.p[0] - victim.p[0]
      const dy = client.p[1] - victim.p[1]
      const dz = client.p[2] - victim.p[2]
      if (Math.hypot(dx, dy, dz) > 260) return
      client.dmgTokens -= dmg
      victim.hp = Math.max(0, victim.hp - dmg)
      const w = String(m.w ?? 'weapon').slice(0, 24)
      broadcast(r, { t: 'x', a: client.id, v: victimId, d: dmg, hp: victim.hp, h: !!m.h, w })
      if (victim.hp <= 0) {
        victim.respawnAt = now + 4000
        broadcast(r, { t: 'k', a: client.id, an: client.name, v: victimId, vn: victim.name, w })
      }
    } else if (m.t === 'e') {
      // generic game-event relay: semantics live in game data, not here
      const now = Date.now()
      client.eventBudget = Math.min(20, client.eventBudget + ((now - client.eventAt) / 1000) * 10)
      client.eventAt = now
      if (client.eventBudget < 1) return
      client.eventBudget -= 1
      const k = String(m.k ?? '').slice(0, 32)
      if (!k) return
      let d = m.d
      try {
        if (JSON.stringify(d ?? null).length > MAX_EVENT_BYTES) return
      } catch { return }
      broadcast(r, { t: 'e', id: client.id, k, d }, client.id)
    }
  })

  ws.on('close', () => {
    clearTimeout(prejoinTimer)
    clients.delete(client)
    decIp(client.ip)
    if (!client.roomKey) return
    const r = rooms.get(client.roomKey)
    if (!r) return
    const wasHost = hostOf(r) === client.id
    r.delete(client.id)
    for (const c of r.values()) c.interestAt.delete(client.id)
    broadcast(r, { t: 'l', id: client.id })
    if (wasHost && r.size > 0) broadcast(r, { t: 'h', id: hostOf(r) })
    console.log(`[blobcade] ${client.name}#${client.id} left ${client.roomKey} (${r.size} in room)`)
    if (r.size === 0) {
      rooms.delete(client.roomKey)
      roomCaps.delete(client.roomKey)
    }
  })
})

// state fan-out + pvp respawns
setInterval(() => {
  const now = Date.now()
  for (const r of rooms.values()) {
    const clients = [...r.values()]
    const dirty = clients.filter((c) => c.dirty)
    for (const target of clients) {
      const states = []
      for (const c of dirty) {
        if (c.id === target.id) continue
        const dx = c.p[0] - target.p[0]
        const dy = c.p[1] - target.p[1]
        const dz = c.p[2] - target.p[2]
        const near = dx * dx + dy * dy + dz * dz <= INTEREST_RADIUS2
        const lastFar = target.interestAt.get(c.id) ?? 0
        if (!near && now - lastFar < FAR_SNAPSHOT_MS) continue
        if (!near) target.interestAt.set(c.id, now)
        states.push([c.id, c.p[0], c.p[1], c.p[2], c.r, c.a, c.v])
      }
      if (states.length > 0) sendClient(target, JSON.stringify({ t: 's', s: states }))
    }
    for (const c of r.values()) {
      if (c.dirty) c.dirty = false
      if (c.hp <= 0 && c.respawnAt > 0 && now >= c.respawnAt) {
        c.hp = 100
        c.respawnAt = 0
        broadcast(r, { t: 'r', v: c.id })
      }
    }
  }
}, TICK_MS)

// heartbeat
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      try { c.ws.terminate() } catch { /* noop */ }
      continue
    }
    c.alive = false
    try { c.ws.ping() } catch { /* noop */ }
  }
}, 30000)

server.listen(PORT, () => {
  console.log(`
  ███████╗██████╗ ███████╗███████╗██████╗ ██╗      ██████╗ ██╗  ██╗
  Blobcade server on http://localhost:${PORT}
  · multiplayer relay (websocket, room instances + host + event relay)
  · publish API at /api/games (node:sqlite, local file server/blobcade.db)
  Ctrl-C to stop.
`)
})
