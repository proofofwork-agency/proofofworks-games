// Typed event bus — the engine's Observer-pattern backbone. Engine systems
// publish domain events here; games, runtime UI and custom GameSystems
// subscribe without coupling to each other. Known engine events are typed
// below; games are free to emit their own namespaced events (e.g.
// 'mygame:wave-start') with any payload.

import type { Vec3 } from './math'

/** events the engine itself emits (extend per game with custom strings) */
export interface EngineEvents {
  /** any entity took damage */
  'combat:damage': { victimId: string; attackerId: string | null; amount: number; headshot: boolean; weaponId: string }
  /** any entity died */
  'combat:kill': { victimId: string; killerId: string | null; weapon: string; headshot: boolean }
  /** any entity grabbed a world pickup (bots included) */
  'combat:pickup': { entityId: string; kind: 'weapon' | 'ammo' | 'health'; weaponId?: string }
  /** any entity respawned */
  'combat:respawn': { entityId: string; at: Vec3 }
  /** the local player's hp changed (heal or hurt) */
  'self:damage': { hp: number; max: number }
  /** the local player's weapons/ammo changed */
  'self:loadout': Record<string, never>
  /** the local player collected a coin */
  'player:coin': { total: number }
  /** ctx.celebrate fired */
  'game:celebrate': { msg: string }
}

type PayloadOf<K> = K extends keyof EngineEvents ? EngineEvents[K] : unknown
type EventKey = keyof EngineEvents | (string & {})

export class EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>()

  /** subscribe; returns an unsubscribe function */
  on<K extends EventKey>(type: K, handler: (payload: PayloadOf<K>) => void): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as (payload: unknown) => void)
    return () => this.off(type, handler)
  }

  /** subscribe for a single firing */
  once<K extends EventKey>(type: K, handler: (payload: PayloadOf<K>) => void): () => void {
    const off = this.on(type, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  off<K extends EventKey>(type: K, handler: (payload: PayloadOf<K>) => void): void {
    this.handlers.get(type)?.delete(handler as (payload: unknown) => void)
  }

  emit<K extends EventKey>(type: K, payload: PayloadOf<K>): void {
    const set = this.handlers.get(type)
    if (!set) return
    // copy: handlers may unsubscribe (or subscribe) while we iterate
    for (const h of [...set]) {
      try {
        h(payload)
      } catch (err) {
        console.error(`[boxcade] event handler for '${type}' threw`, err)
      }
    }
  }

  /** drop every subscription (called on session dispose) */
  clear(): void {
    this.handlers.clear()
  }
}
