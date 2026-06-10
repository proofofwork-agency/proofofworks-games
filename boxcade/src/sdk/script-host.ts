// Sandboxed creator scripting for GameDoc. A script runs in a dedicated
// Worker and talks to the live game only through validated JSON messages.

import { v3 } from '../engine/math'
import { PartRegistry, RULE_SOUNDS, RESERVED_EVENT_PREFIXES, type RegisteredPart, type RuleAction } from './rules'
import type { DocPart, DocV3, GameDoc } from './gamedoc'
import type { EntityApi, GameContext, GameSystem, SdkPart } from './index'

type ScriptMessage =
  | { type: 'ready' }
  | { type: 'pong'; seq: number }
  | { type: 'subscribe'; events: unknown }
  | { type: 'action'; action: unknown }
  | { type: 'entity'; id: unknown; cmd: unknown; args?: unknown }
  | { type: 'spawnBot'; opts: unknown }
  | { type: 'setSpawnPoints'; points: unknown }
  | { type: 'log'; level?: unknown; msg?: unknown }

interface Bucket { tokens: number; at: number }

const MAX_EVENTS = 32
const MAX_REF = 40
const MAX_TEXT = 160

const isV3 = (v: unknown): v is DocV3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const cleanText = (s: unknown, max = MAX_TEXT) => String(s ?? '').slice(0, max)
const cleanRef = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= MAX_REF ? s : null

function creatorWorkerSource(script: string): string {
  return `
const creatorCode = ${JSON.stringify(script)}
const callbacks = { start: [], tick: [], events: new Map() }
const send = (msg) => postMessage(msg)
for (const key of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches']) {
  try { self[key] = undefined } catch {}
}
try { if (self.navigator) self.navigator.sendBeacon = undefined } catch {}
const boxcade = {
  onStart(fn) { if (typeof fn === 'function') callbacks.start.push(fn) },
  onTick(fn) { if (typeof fn === 'function') callbacks.tick.push(fn) },
  on(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return
    let list = callbacks.events.get(name)
    if (!list) { callbacks.events.set(name, (list = [])); send({ type: 'subscribe', events: [name] }) }
    list.push(fn)
  },
  log(msg) { send({ type: 'log', level: 'info', msg: String(msg) }) },
  toast(text) { send({ type: 'action', action: { type: 'toast', text: String(text) } }) },
  big(text) { send({ type: 'action', action: { type: 'big', text: String(text) } }) },
  celebrate(text) { send({ type: 'action', action: { type: 'celebrate', text: text == null ? undefined : String(text) } }) },
  win(text) { send({ type: 'action', action: { type: 'win', text: text == null ? undefined : String(text) } }) },
  kill() { send({ type: 'action', action: { type: 'kill' } }) },
  teleport(to) { send({ type: 'action', action: { type: 'teleport', to } }) },
  award(amount) { send({ type: 'action', action: { type: 'award', amount } }) },
  movePart(part, byOrTo, seconds) {
    const action = { type: 'movePart', part: String(part), seconds }
    if (byOrTo && byOrTo.to) action.to = byOrTo.to
    else action.by = byOrTo
    send({ type: 'action', action })
  },
  openDoor(part, seconds) { send({ type: 'action', action: { type: 'openDoor', part: String(part), seconds } }) },
  removePart(part) { send({ type: 'action', action: { type: 'removePart', part: String(part) } }) },
  spawnPart(part) { send({ type: 'action', action: { type: 'spawnPart', part } }) },
  setVar(name, value) { send({ type: 'action', action: { type: 'setVar', var: String(name), value } }) },
  addVar(name, value = 1) { send({ type: 'action', action: { type: 'addVar', var: String(name), value } }) },
  sound(name) { send({ type: 'action', action: { type: 'sound', name: String(name) } }) },
  emit(name) { send({ type: 'action', action: { type: 'emit', name: String(name) } }) },
  goTo(target) { send({ type: 'action', action: { type: 'goTo', target: String(target) } }) },
  spawnBot(opts) { send({ type: 'spawnBot', opts }) },
  setSpawnPoints(points) { send({ type: 'setSpawnPoints', points }) },
  entity(id) {
    const call = (cmd, args) => send({ type: 'entity', id, cmd, args })
    return {
      setObjective(at) { call('setObjective', at) },
      teleport(at) { call('teleport', at) },
      respawn() { call('respawn') },
      carrying(value) { call('carrying', value) },
      giveWeapon(weapon) { call('giveWeapon', String(weapon)) },
      giveAmmo() { call('giveAmmo') },
      heal(n, capTo) { call('heal', { n, capTo }) },
      hurt(n, cause, icon) { call('hurt', { n, cause, icon }) },
      deploy(at) { call('deploy', at) },
    }
  },
}
try {
  new Function('boxcade', '"use strict";\\n' + creatorCode)(boxcade)
  send({ type: 'ready' })
} catch (err) {
  send({ type: 'log', level: 'error', msg: err && err.message ? err.message : String(err) })
}
onmessage = (event) => {
  const msg = event.data || {}
  if (msg.type === 'ping') { send({ type: 'pong', seq: msg.seq }); return }
  if (msg.type === 'init') {
    for (const fn of callbacks.start) { try { fn(msg.doc) } catch (err) { boxcade.log(err && err.message ? err.message : err) } }
    return
  }
  if (msg.type === 'tick') {
    for (const fn of callbacks.tick) { try { fn(msg.time, msg.dt, msg.state) } catch (err) { boxcade.log(err && err.message ? err.message : err) } }
    return
  }
  if (msg.type === 'event') {
    const list = callbacks.events.get(msg.name) || []
    for (const fn of list) { try { fn(msg.payload) } catch (err) { boxcade.log(err && err.message ? err.message : err) } }
  }
}
`
}

export function createScriptSystem(doc: GameDoc, script: string, registry: PartRegistry): GameSystem {
  let worker: Worker | null = null
  let workerUrl = ''
  let context: GameContext | null = null
  let disposed = false
  let strikes = 0
  let seq = 0
  let waitingFor: number | null = null
  let nextPing = 0
  const offs: Array<() => void> = []
  const bucket: Bucket = { tokens: 20, at: 0 }
  const vars: Record<string, number> = { ...(doc.vars ?? {}) }
  const tweens: Array<{ entry: RegisteredPart; from: DocV3; to: DocV3; t: number; dur: number }> = []

  const spend = () => {
    const now = performance.now()
    bucket.tokens = Math.min(20, bucket.tokens + ((now - bucket.at) / 1000) * 10)
    bucket.at = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  const postState = () => ({
    isHost: !!context?.engine.net.isHost,
    playersOnline: context?.playersOnline ?? 1,
    player: context ? safeEntity({
      id: 'self',
      name: context.player.name,
      team: null,
      isBot: false,
      isSelf: true,
      position: context.player.position,
      health: 100,
      alive: true,
      carrying: null,
    }) : null,
    entities: context?.entities.map(safeEntity) ?? [],
  })

  function boot(ctx: GameContext) {
    if (disposed || typeof Worker === 'undefined') return
    if (worker) worker.terminate()
    if (workerUrl) URL.revokeObjectURL(workerUrl)
    workerUrl = URL.createObjectURL(new Blob([creatorWorkerSource(script)], { type: 'text/javascript' }))
    worker = new Worker(workerUrl, { name: `boxcade-script:${doc.meta.name}` })
    bucket.at = performance.now()
    waitingFor = null
    worker.onmessage = (event) => handleMessage(event.data as ScriptMessage)
    worker.onerror = (event) => {
      console.warn('[boxcade] script worker error', event.message)
    }
    worker.postMessage({
      type: 'init',
      doc: {
        meta: doc.meta,
        vars: doc.vars ?? {},
        combat: !!doc.combat,
        parts: doc.parts?.length ?? 0,
      },
      state: postState(),
    })
    ctx.hud.toast('Script running in sandbox')
  }

  function disable(reason: string) {
    if (worker) worker.terminate()
    worker = null
    if (workerUrl) URL.revokeObjectURL(workerUrl)
    workerUrl = ''
    context?.hud.toast(reason)
  }

  function restart(ctx: GameContext) {
    strikes++
    disable('Script restarted after timeout')
    if (strikes >= 3) {
      disable('Script disabled after repeated timeouts')
      return
    }
    setTimeout(() => boot(ctx), strikes === 1 ? 250 : strikes === 2 ? 1000 : 4000)
  }

  function subscribe(events: unknown) {
    if (!context || !Array.isArray(events)) return
    for (const name of events.slice(0, MAX_EVENTS)) {
      if (typeof name !== 'string' || name.length > MAX_REF * 2) continue
      offs.push(context.events.on(name, (payload) => worker?.postMessage({ type: 'event', name, payload })))
    }
  }

  function handleMessage(msg: ScriptMessage) {
    const ctx = context
    if (!ctx || !msg || typeof msg.type !== 'string') return
    if (msg.type === 'pong') {
      if (msg.seq === waitingFor) waitingFor = null
      return
    }
    if (msg.type === 'subscribe') { subscribe(msg.events); return }
    if (msg.type === 'log') {
      console[msg.level === 'error' ? 'warn' : 'log']('[boxcade script]', cleanText(msg.msg, 500))
      return
    }
    if (!spend()) return
    if (msg.type === 'action') runAction(ctx, msg.action, registry, vars, tweens)
    else if (msg.type === 'spawnBot') spawnBot(ctx, msg.opts)
    else if (msg.type === 'setSpawnPoints') setSpawnPoints(ctx, msg.points)
    else if (msg.type === 'entity') runEntityCommand(ctx, msg)
  }

  return {
    id: 'gamedoc-script',
    init(ctx) {
      context = ctx
      boot(ctx)
    },
    update(ctx, dt) {
      const now = performance.now()
      if (worker) {
        worker.postMessage({ type: 'tick', time: ctx.time, dt, state: postState() })
        if (now >= nextPing) {
          if (waitingFor !== null) restart(ctx)
          else {
            waitingFor = ++seq
            worker.postMessage({ type: 'ping', seq })
          }
          nextPing = now + 1000
        }
      }
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]
        tw.t += dt
        const k = Math.min(1, tw.t / tw.dur)
        const s = k * k * (3 - 2 * k)
        const p = tw.entry.handle.pos
        p.x = tw.from[0] + (tw.to[0] - tw.from[0]) * s
        p.y = tw.from[1] + (tw.to[1] - tw.from[1]) * s
        p.z = tw.from[2] + (tw.to[2] - tw.from[2]) * s
        if (k >= 1) tweens.splice(i, 1)
      }
    },
    dispose() {
      disposed = true
      for (const off of offs) off()
      offs.length = 0
      tweens.length = 0
      disable('Script stopped')
      context = null
    },
  }
}

function safeEntity(e: Partial<EntityApi>) {
  const p = e.position
  return {
    id: e.id,
    name: e.name,
    team: e.team,
    isBot: !!e.isBot,
    isSelf: !!e.isSelf,
    position: p ? [p.x, p.y, p.z] : [0, 0, 0],
    health: e.health ?? 0,
    alive: !!e.alive,
    carrying: e.carrying ?? null,
  }
}

function runAction(
  ctx: GameContext,
  raw: unknown,
  registry: PartRegistry,
  vars: Record<string, number>,
  tweens: Array<{ entry: RegisteredPart; from: DocV3; to: DocV3; t: number; dur: number }>,
) {
  const a = sanitizeAction(raw)
  if (!a) return
  switch (a.type) {
    case 'toast': ctx.hud.toast(a.text); break
    case 'big': ctx.hud.big(a.text); break
    case 'celebrate': ctx.celebrate(a.text); break
    case 'win': ctx.celebrate(a.text ?? '🏆 YOU WIN!'); ctx.earnBolts(25, 'victory'); break
    case 'kill': ctx.player.kill(); break
    case 'teleport': ctx.player.teleport(v3(a.to[0], a.to[1], a.to[2])); break
    case 'award': ctx.award(a.amount ?? 1); break
    case 'movePart': {
      for (const entry of registry.resolve(a.part)) {
        const p = entry.handle.pos
        const to = a.to ?? (a.by ? [p.x + a.by[0], p.y + a.by[1], p.z + a.by[2]] as DocV3 : null)
        if (!to) continue
        if ((a.seconds ?? 0) <= 0) {
          p.x = to[0]; p.y = to[1]; p.z = to[2]
        } else {
          tweens.push({ entry, from: [p.x, p.y, p.z], to, t: 0, dur: a.seconds ?? 0 })
        }
      }
      break
    }
    case 'openDoor': {
      for (const entry of registry.resolve(a.part)) {
        const p = entry.handle.pos
        const drop = entry.def.size[1] + 0.4
        tweens.push({ entry, from: [p.x, p.y, p.z], to: [p.x, p.y - drop, p.z], t: 0, dur: a.seconds ?? 0.9 })
      }
      break
    }
    case 'removePart': {
      for (const entry of registry.resolve(a.part)) {
        entry.handle.remove()
        entry.removed = true
      }
      break
    }
    case 'spawnPart': {
      const handle = ctx.addPart(partToSdk(a.part))
      if (a.part.id || a.part.tag) registry.add({ handle, def: a.part })
      break
    }
    case 'setVar':
      vars[a.var] = a.value
      ctx.hud.set(`var:${a.var}`, `${a.var}: ${a.value}`)
      break
    case 'addVar':
      vars[a.var] = (vars[a.var] ?? 0) + (a.value ?? 1)
      ctx.hud.set(`var:${a.var}`, `${a.var}: ${vars[a.var]}`)
      break
    case 'sound':
      if ((RULE_SOUNDS as readonly string[]).includes(a.name)) {
        ;(ctx.engine.audio as unknown as Record<string, () => void>)[a.name]?.()
      }
      break
    case 'emit':
      if (!RESERVED_EVENT_PREFIXES.some((p) => a.name.startsWith(p))) ctx.events.emit(a.name, {})
      break
    case 'goTo': ctx.events.emit('platform:goToGame', { target: a.target }); break
    case 'givePoints':
    case 'restart':
      // Rules own these higher-level conveniences for now.
      break
  }
}

function sanitizeAction(raw: unknown): RuleAction | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'toast': return { type: 'toast', text: cleanText(a.text) }
    case 'big': return { type: 'big', text: cleanText(a.text) }
    case 'celebrate': return { type: 'celebrate', text: a.text === undefined ? undefined : cleanText(a.text) }
    case 'win': return { type: 'win', text: a.text === undefined ? undefined : cleanText(a.text) }
    case 'kill': return { type: 'kill' }
    case 'teleport': return isV3(a.to) ? { type: 'teleport', to: a.to } : null
    case 'award': return { type: 'award', amount: clamp(Math.round(Number(a.amount ?? 1)), 0, 100) }
    case 'movePart': {
      const part = cleanRef(a.part)
      if (!part) return null
      if (isV3(a.to)) return { type: 'movePart', part, to: a.to, seconds: clamp(Number(a.seconds ?? 0), 0, 30) }
      if (isV3(a.by)) return { type: 'movePart', part, by: a.by, seconds: clamp(Number(a.seconds ?? 0), 0, 30) }
      return null
    }
    case 'openDoor': {
      const part = cleanRef(a.part)
      return part ? { type: 'openDoor', part, seconds: clamp(Number(a.seconds ?? 0.9), 0, 30) } : null
    }
    case 'removePart': {
      const part = cleanRef(a.part)
      return part ? { type: 'removePart', part } : null
    }
    case 'spawnPart': return isDocSpawnPart(a.part) ? { type: 'spawnPart', part: a.part } : null
    case 'setVar': {
      const name = cleanRef(a.var)
      const value = Number(a.value)
      return name && Number.isFinite(value) ? { type: 'setVar', var: name, value } : null
    }
    case 'addVar': {
      const name = cleanRef(a.var)
      const value = Number(a.value ?? 1)
      return name && Number.isFinite(value) ? { type: 'addVar', var: name, value } : null
    }
    case 'sound': {
      const name = cleanRef(a.name)
      return name ? { type: 'sound', name } : null
    }
    case 'emit': {
      const name = cleanRef(a.name)
      return name ? { type: 'emit', name } : null
    }
    case 'goTo': {
      const target = cleanRef(a.target)
      return target ? { type: 'goTo', target } : null
    }
    default: return null
  }
}

function isDocSpawnPart(part: unknown): part is DocPart & { kind: 'part' } {
  if (typeof part !== 'object' || part === null || Array.isArray(part)) return false
  const p = part as Record<string, unknown>
  return p.kind === 'part' && isV3(p.at) && isV3(p.size)
}

function partToSdk(part: DocPart & { kind: 'part' }): SdkPart {
  return {
    at: v3(part.at[0], part.at[1], part.at[2]),
    size: v3(part.size[0], part.size[1], part.size[2]),
    color: part.color,
    material: part.material,
    rotY: part.rotY,
    collide: part.collide,
    reflect: part.reflect,
    bounce: part.bounce,
  }
}

function spawnBot(ctx: GameContext, raw: unknown) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return
  const opts = raw as Record<string, unknown>
  const spawns = Array.isArray(opts.spawns) ? opts.spawns.filter(isV3).slice(0, 16) : []
  if (spawns.length === 0) return
  try {
    ctx.spawnBot({
      name: cleanText(opts.name, 24) || 'Bot',
      team: typeof opts.team === 'string' ? opts.team.slice(0, 24) : undefined,
      skill: clamp(Number(opts.skill ?? 0.5), 0, 1),
      spawns: spawns.map((p) => v3(p[0], p[1], p[2])),
      shirt: typeof opts.shirt === 'string' ? opts.shirt : undefined,
    })
  } catch (err) {
    console.warn('[boxcade script] spawnBot skipped:', err instanceof Error ? err.message : err)
  }
}

function setSpawnPoints(ctx: GameContext, raw: unknown) {
  if (!Array.isArray(raw)) return
  const points = raw.filter(isV3).slice(0, 32).map((p) => v3(p[0], p[1], p[2]))
  if (points.length > 0) ctx.setSpawnPoints(points)
}

function runEntityCommand(ctx: GameContext, msg: Extract<ScriptMessage, { type: 'entity' }>) {
  const id = typeof msg.id === 'string' ? msg.id : ''
  const e = ctx.entities.find((x) => x.id === id)
  if (!e) return
  const cmd = String(msg.cmd ?? '')
  if (cmd === 'setObjective') {
    e.setObjective(isV3(msg.args) ? v3(msg.args[0], msg.args[1], msg.args[2]) : null)
  } else if (cmd === 'teleport' && isV3(msg.args)) {
    e.teleport(v3(msg.args[0], msg.args[1], msg.args[2]))
  } else if (cmd === 'respawn') {
    e.respawn()
  } else if (cmd === 'carrying') {
    e.carrying = msg.args === null ? null : cleanText(msg.args, 40)
  } else if (cmd === 'giveWeapon') {
    const id = cleanRef(msg.args)
    if (id) e.giveWeapon(id)
  } else if (cmd === 'giveAmmo') {
    e.giveAmmo()
  } else if (cmd === 'heal' && typeof msg.args === 'object' && msg.args !== null) {
    const a = msg.args as Record<string, unknown>
    e.heal(clamp(Number(a.n ?? 0), 0, 500), a.capTo === undefined ? undefined : clamp(Number(a.capTo), 1, 500))
  } else if (cmd === 'hurt' && typeof msg.args === 'object' && msg.args !== null) {
    const a = msg.args as Record<string, unknown>
    e.hurt(clamp(Number(a.n ?? 0), 0, 500), cleanText(a.cause, 40), cleanText(a.icon, 8))
  } else if (cmd === 'deploy' && isV3(msg.args)) {
    e.deploy(v3(msg.args[0], msg.args[1], msg.args[2]))
  }
}
