// Data-driven game logic — the no-code half of a GameDoc. A Rule is a flat
// `when / if / do` record (plain JSON, no user code): triggers ride the
// engine's event bus and part touches, conditions read named counters
// ("vars"), actions call the same GameContext APIs hand-written games use.
// createRulesSystem() compiles a doc's rules into ONE GameSystem.

import { v3, type Vec3 } from '../engine/math'
import { audio } from '../engine/audio'
import type { GameContext, GameSystem, PartHandle } from './index'
import type { DocPart, DocV3 } from './gamedoc'

// ------------------------------------------------------------- schema ----

export type RuleTrigger =
  | { type: 'start' }
  | { type: 'touch'; part: string }
  | { type: 'timer'; after?: number; every?: number }
  | { type: 'coin' }
  | { type: 'kill' }
  | { type: 'checkpoint' }
  | { type: 'hurt' }
  | { type: 'enterRegion'; min: DocV3; max: DocV3 }
  | { type: 'varReaches'; var: string; gte: number }
  | { type: 'event'; name: string }

export interface RuleCondition {
  var: string
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  value: number
}

/** set forEveryone on world-changing actions (movePart/openDoor/…) to make
 *  them happen for every player in the room, not just whoever triggered it */
export type RuleAction = { forEveryone?: boolean } & (
  | { type: 'toast'; text: string }
  | { type: 'big'; text: string }
  | { type: 'celebrate'; text?: string }
  | { type: 'win'; text?: string }
  | { type: 'kill' }
  | { type: 'teleport'; to: DocV3 }
  | { type: 'award'; amount?: number }
  | { type: 'movePart'; part: string; to?: DocV3; by?: DocV3; seconds?: number }
  | { type: 'removePart'; part: string }
  | { type: 'openDoor'; part: string; seconds?: number }
  | { type: 'spawnPart'; part: DocPart & { kind: 'part' } }
  | { type: 'setVar'; var: string; value: number }
  | { type: 'addVar'; var: string; value?: number }
  | { type: 'givePoints'; var?: string; amount?: number }
  | { type: 'restart' }
  | { type: 'sound'; name: string }
  | { type: 'emit'; name: string }
  | { type: 'goTo'; target: string }
)

export interface Rule {
  when: RuleTrigger
  if?: RuleCondition[]
  do: RuleAction[]
  /** fire at most once per session */
  once?: boolean
}

export const RULE_TRIGGER_TYPES = ['start', 'touch', 'timer', 'coin', 'kill', 'checkpoint', 'hurt', 'enterRegion', 'varReaches', 'event'] as const
export const RULE_ACTION_TYPES = [
  'toast', 'big', 'celebrate', 'win', 'kill', 'teleport', 'award',
  'movePart', 'removePart', 'openDoor', 'spawnPart', 'setVar', 'addVar', 'givePoints', 'restart', 'sound', 'emit', 'goTo',
] as const
/** synth sounds a rule may play (the safe subset of the audio facade) */
export const RULE_SOUNDS = ['coin', 'win', 'jump', 'death', 'checkpoint', 'bounce', 'splash', 'explosion', 'capture', 'chat'] as const
/** event prefixes reserved for the engine — rules may listen but not emit.
 *  'platform:' carries navigation intents (portals / the `goTo` action emit
 *  `platform:goToGame` directly); a user `emit` action may not spoof it. */
export const RESERVED_EVENT_PREFIXES = ['combat:', 'self:', 'player:', 'game:', 'net:', 'platform:'] as const

// ------------------------------------------------- part registry ---------
// Filled by the interpreter while build(w) places DocParts; rules resolve
// `part` references (an id or a tag — tags may match many parts) through it.

export interface RegisteredPart {
  handle: PartHandle
  def: DocPart & { kind: 'part' }
  removed?: boolean
}

export class PartRegistry {
  private byKey = new Map<string, RegisteredPart[]>()

  add(entry: RegisteredPart) {
    const keys = new Set([entry.def.id, entry.def.tag])
    for (const key of keys) {
      if (!key) continue
      let list = this.byKey.get(key)
      if (!list) this.byKey.set(key, (list = []))
      list.push(entry)
    }
  }

  resolve(ref: string): RegisteredPart[] {
    return (this.byKey.get(ref) ?? []).filter((e) => !e.removed)
  }
}

// ------------------------------------------------------ the system -------

export interface RulesSystem extends GameSystem {
  /** wired into a part's onTouch by the interpreter (refs = the part's id + tag) */
  notifyTouch(refs: string[], ctx: GameContext): void
  /** true if any touch rule targets one of these refs (used to decide wiring) */
  wantsTouch(refs: Array<string | undefined>): boolean
}

export function v3FromDoc(a: DocV3): Vec3 {
  return v3(a[0], a[1], a[2])
}

export function createRulesSystem(
  rules: Rule[],
  initialVars: Record<string, number> | undefined,
  registry: PartRegistry,
): RulesSystem {
  const vars: Record<string, number> = { ...(initialVars ?? {}) }
  /** snapshot of declared vars at their initial values — `restart` resets to this */
  const initialSnapshot: Record<string, number> = { ...vars }
  const declared = new Set(Object.keys(vars))
  const firedOnce = new Set<Rule>()
  const offs: Array<() => void> = []
  let context: GameContext | null = null

  interface Tween { entry: RegisteredPart; from: Vec3; to: Vec3; t: number; dur: number }
  const tweens: Tween[] = []

  const touchRules = rules.filter((r) => r.when.type === 'touch')
  const touchRefs = new Set(touchRules.map((r) => (r.when as { part: string }).part))
  const timerRules = rules.filter((r) => r.when.type === 'timer')
  const timerNext = new Map<Rule, number>()
  const regionRules = rules.filter((r) => r.when.type === 'enterRegion')
  const regionInside = new Map<Rule, boolean>()
  const varRules = rules.filter((r) => r.when.type === 'varReaches')
  const varArmed = new Map<Rule, boolean>()

  function condsPass(rule: Rule): boolean {
    for (const c of rule.if ?? []) {
      const v = vars[c.var] ?? 0
      const ok =
        c.op === 'eq' ? v === c.value :
        c.op === 'ne' ? v !== c.value :
        c.op === 'gt' ? v > c.value :
        c.op === 'gte' ? v >= c.value :
        c.op === 'lt' ? v < c.value : v <= c.value
      if (!ok) return false
    }
    return true
  }

  function fire(rule: Rule, ctx: GameContext) {
    if (rule.once && firedOnce.has(rule)) return
    if (!condsPass(rule)) return
    firedOnce.add(rule)
    const net = ctx.engine.net
    const ri = rules.indexOf(rule)
    rule.do.forEach((a, ai) => {
      // replicated actions: tell the room, then do it locally too
      if (a.forEveryone && net.online) net.sendEvent('rule', { ri, ai })
      runAction(a, ctx)
    })
  }

  /** a replicated action arriving from another player (via the event relay) */
  function applyRemote(ctx: GameContext, d: unknown) {
    const msg = d as { ri?: number; ai?: number }
    if (typeof msg?.ri !== 'number' || typeof msg?.ai !== 'number') return
    const action = rules[msg.ri]?.do[msg.ai]
    if (action?.forEveryone) runAction(action, ctx)
  }

  function refreshChip(ctx: GameContext, name: string) {
    if (declared.has(name)) ctx.hud.set(`var:${name}`, `${name}: ${vars[name] ?? 0}`)
  }

  function setVar(ctx: GameContext, name: string, value: number) {
    vars[name] = value
    refreshChip(ctx, name)
    for (const r of varRules) {
      const w = r.when as { var: string; gte: number }
      if (w.var !== name) continue
      const reached = (vars[name] ?? 0) >= w.gte
      if (reached && varArmed.get(r) !== false) {
        varArmed.set(r, false)
        fire(r, ctx)
      } else if (!reached) {
        varArmed.set(r, true) // re-arm when dropping back below the threshold
      }
    }
  }

  function startTween(entry: RegisteredPart, to: Vec3, seconds: number) {
    const p = entry.handle.pos
    if (seconds <= 0) {
      p.x = to.x; p.y = to.y; p.z = to.z
      return
    }
    tweens.push({ entry, from: v3(p.x, p.y, p.z), to, t: 0, dur: seconds })
  }

  function runAction(a: RuleAction, ctx: GameContext) {
    switch (a.type) {
      case 'toast': ctx.hud.toast(a.text); break
      case 'big': ctx.hud.big(a.text); break
      case 'celebrate': ctx.celebrate(a.text); break
      case 'win':
        ctx.celebrate(a.text ?? '🏆 YOU WIN!')
        ctx.earnBlobcash(25, 'victory')
        break
      case 'kill': ctx.player.kill(); break
      case 'teleport': ctx.player.teleport(v3FromDoc(a.to)); break
      case 'award': ctx.award(a.amount ?? 1); break
      case 'movePart': {
        for (const entry of registry.resolve(a.part)) {
          const p = entry.handle.pos
          const to = a.to
            ? v3FromDoc(a.to)
            : a.by
              ? v3(p.x + a.by[0], p.y + a.by[1], p.z + a.by[2])
              : null
          if (to) startTween(entry, to, a.seconds ?? 0)
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
      case 'openDoor': {
        // slide the part down out of the way (collision box follows pos)
        for (const entry of registry.resolve(a.part)) {
          const p = entry.handle.pos
          const drop = entry.def.size[1] + 0.4
          startTween(entry, v3(p.x, p.y - drop, p.z), a.seconds ?? 0.9)
        }
        audio.place()
        break
      }
      case 'spawnPart': {
        const def = a.part
        const handle = ctx.addPart({
          at: v3FromDoc(def.at),
          size: v3FromDoc(def.size),
          color: def.color,
          material: def.material,
          rotY: def.rotY,
          collide: def.collide,
          reflect: def.reflect,
          bounce: def.bounce,
          onTouch: system.wantsTouch([def.id, def.tag])
            ? (c) => system.notifyTouch([def.id, def.tag].filter((r): r is string => !!r), c)
            : undefined,
        })
        registry.add({ handle, def })
        break
      }
      case 'setVar': setVar(ctx, a.var, a.value); break
      case 'addVar': setVar(ctx, a.var, (vars[a.var] ?? 0) + (a.value ?? 1)); break
      case 'givePoints': {
        const name = a.var ?? 'score'
        setVar(ctx, name, (vars[name] ?? 0) + (a.amount ?? 1))
        break
      }
      case 'restart': {
        ctx.player.respawn()
        // reset every var to its initial value, re-emitting HUD chips +
        // re-arming varReaches triggers through the normal setVar path
        for (const name of Object.keys(vars)) {
          setVar(ctx, name, initialSnapshot[name] ?? 0)
        }
        break
      }
      case 'sound': {
        if ((RULE_SOUNDS as readonly string[]).includes(a.name)) {
          ;(audio as unknown as Record<string, () => void>)[a.name]()
        }
        break
      }
      case 'emit': {
        if (RESERVED_EVENT_PREFIXES.some((p) => a.name.startsWith(p))) {
          console.warn(`[blobcade] rules: emit '${a.name}' uses a reserved prefix — skipped`)
          break
        }
        ctx.events.emit(a.name, {})
        break
      }
      case 'goTo': {
        // navigation intent — emitted on the reserved 'platform:' channel
        // directly (not via the user-facing 'emit' action), so the prefix
        // guard above does not apply. The portal/router host handles it.
        ctx.events.emit('platform:goToGame', { target: a.target })
        break
      }
    }
  }

  const system: RulesSystem = {
    id: 'gamedoc-rules',

    wantsTouch(refs) {
      return refs.some((r) => !!r && touchRefs.has(r))
    },

    notifyTouch(refs, ctx) {
      for (const rule of touchRules) {
        if (refs.includes((rule.when as { part: string }).part)) fire(rule, ctx)
      }
    },

    init(ctx) {
      context = ctx
      for (const name of declared) refreshChip(ctx, name)
      for (const r of timerRules) {
        const w = r.when as { after?: number; every?: number }
        timerNext.set(r, w.after ?? w.every ?? 1)
      }
      for (const r of varRules) varArmed.set(r, true)
      for (const rule of rules) {
        if (rule.when.type === 'start') fire(rule, ctx)
        else if (rule.when.type === 'coin') offs.push(ctx.events.on('player:coin', () => fire(rule, ctx)))
        else if (rule.when.type === 'kill') offs.push(ctx.events.on('combat:kill', () => fire(rule, ctx)))
        else if (rule.when.type === 'checkpoint') offs.push(ctx.events.on('player:checkpoint', () => fire(rule, ctx)))
        else if (rule.when.type === 'hurt') offs.push(ctx.events.on('self:damage', () => fire(rule, ctx)))
        else if (rule.when.type === 'event') offs.push(ctx.events.on((rule.when as { name: string }).name, () => fire(rule, ctx)))
      }
      // replicated rule actions from other players in the room
      offs.push(ctx.events.on('net:rule', (payload) => applyRemote(ctx, (payload as { d?: unknown })?.d)))
      // vars may already satisfy varReaches at start
      for (const name of declared) setVar(ctx, name, vars[name])
    },

    update(ctx, dt) {
      // timers — replicated timers run on the HOST only (no double-firing)
      for (const r of timerRules) {
        const next = timerNext.get(r)
        if (next === undefined || ctx.time < next) continue
        const w = r.when as { after?: number; every?: number }
        timerNext.set(r, w.every ? next + w.every : Infinity)
        if (r.do.some((a) => a.forEveryone) && !ctx.engine.net.isHost) continue
        fire(r, ctx)
      }
      // regions (edge-triggered on enter; leaving re-arms)
      if (regionRules.length > 0) {
        const p = ctx.player.position
        for (const r of regionRules) {
          const w = r.when as { min: DocV3; max: DocV3 }
          const inside =
            p.x >= w.min[0] && p.x <= w.max[0] &&
            p.y >= w.min[1] && p.y <= w.max[1] &&
            p.z >= w.min[2] && p.z <= w.max[2]
          if (inside && !regionInside.get(r)) fire(r, ctx)
          regionInside.set(r, inside)
        }
      }
      // part tweens
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]
        tw.t += dt
        const k = Math.min(1, tw.t / tw.dur)
        const s = k * k * (3 - 2 * k) // smoothstep
        const p = tw.entry.handle.pos
        p.x = tw.from.x + (tw.to.x - tw.from.x) * s
        p.y = tw.from.y + (tw.to.y - tw.from.y) * s
        p.z = tw.from.z + (tw.to.z - tw.from.z) * s
        if (k >= 1) tweens.splice(i, 1)
      }
    },

    dispose() {
      for (const off of offs) off()
      offs.length = 0
      tweens.length = 0
      context = null
    },
  }

  void context
  return system
}
