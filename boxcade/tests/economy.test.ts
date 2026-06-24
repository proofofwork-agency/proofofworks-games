import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'

// Node 22 has no localStorage — install a tiny in-memory shim BEFORE importing
// economy.ts (it touches localStorage at call time, but we set it up first to
// be safe). economy is a singleton, but all its state lives in localStorage,
// so clearing the store between tests fully resets it.
class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string): void { this.map.set(k, String(v)) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
}

const shim = new MemoryStorage()
;(globalThis as unknown as { localStorage: Storage }).localStorage = shim as unknown as Storage

type EconomyModule = typeof import('../src/engine/economy')
let economy: EconomyModule['economy']
let CATALOG: EconomyModule['CATALOG']

beforeAll(async () => {
  const mod = await import('../src/engine/economy')
  economy = mod.economy
  CATALOG = mod.CATALOG
})

beforeEach(() => {
  shim.clear()
})

describe('economy starting state', () => {
  it('starts with a zero Blobcash balance', () => {
    expect(economy.balance).toBe(0)
  })

  it('persists everything under blobcade.* keys', () => {
    economy.earn(50)
    economy.buy('shirt-royal') // not enough yet -> no write, but earn wrote blobcash
    economy.equip('shirt-crimson', 'shirt') // free item, owned by default
    economy.claimDaily()
    const keys = [...Array(shim.length)].map((_, i) => shim.key(i)!)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) expect(k).toMatch(/^blobcade\./)
  })
})

describe('earn', () => {
  it('adds positive amounts and returns the new balance', () => {
    expect(economy.earn(100)).toBe(100)
    expect(economy.earn(25)).toBe(125)
    expect(economy.balance).toBe(125)
  })

  it('ignores non-positive amounts', () => {
    economy.earn(40)
    expect(economy.earn(0)).toBe(40)
    expect(economy.earn(-10)).toBe(40)
  })

  it('notifies onChange subscribers', () => {
    const fn = vi.fn()
    const off = economy.onChange(fn)
    economy.earn(10)
    expect(fn).toHaveBeenCalledWith(10)
    off()
    economy.earn(10)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('owns', () => {
  it('free items are owned by default; paid items are not', () => {
    expect(economy.owns('shirt-crimson')).toBe(true) // price 0
    expect(economy.owns('shirt-royal')).toBe(false)
    expect(economy.owns('does-not-exist')).toBe(false)
  })
})

describe('buy', () => {
  it('succeeds when funds suffice and records ownership', () => {
    economy.earn(200)
    const res = economy.buy('shirt-royal') // price 150
    expect(res.ok).toBe(true)
    expect(economy.owns('shirt-royal')).toBe(true)
    expect(economy.balance).toBe(50)
  })

  it('fails with a reason when funds are insufficient', () => {
    economy.earn(10)
    const res = economy.buy('shirt-royal') // price 150
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/not enough/i)
    expect(economy.owns('shirt-royal')).toBe(false)
    expect(economy.balance).toBe(10)
  })

  it('rejects unknown items', () => {
    economy.earn(1000)
    const res = economy.buy('nope')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/unknown/i)
  })

  it('refuses to double-buy an owned item', () => {
    economy.earn(1000)
    expect(economy.buy('shirt-royal').ok).toBe(true)
    const again = economy.buy('shirt-royal')
    expect(again.ok).toBe(false)
    expect(again.reason).toMatch(/already owned/i)
  })
})

describe('equip / equipped', () => {
  it('defaults to nothing equipped', () => {
    expect(economy.equipped()).toEqual({ shirt: null, trail: null })
  })

  it('equips an owned shirt and a trail independently', () => {
    economy.earn(1000)
    economy.buy('trail-fire')
    economy.equip('shirt-crimson', 'shirt') // free -> owned
    economy.equip('trail-fire', 'trail')
    expect(economy.equipped()).toEqual({ shirt: 'shirt-crimson', trail: 'trail-fire' })
    expect(economy.equippedShirtColor()).toBe(
      CATALOG.find((i) => i.id === 'shirt-crimson')!.color,
    )
    expect(economy.equippedTrail()?.id).toBe('trail-fire')
  })

  it('refuses to equip an item the player does not own', () => {
    economy.equip('shirt-gold', 'shirt') // price 500, not owned
    expect(economy.equipped().shirt).toBeNull()
  })

  it('can clear a slot with null', () => {
    economy.equip('shirt-crimson', 'shirt')
    economy.equip(null, 'shirt')
    expect(economy.equipped().shirt).toBeNull()
  })
})

describe('claimDaily', () => {
  it('grants 100 once per calendar day and 0 on the next claim', () => {
    expect(economy.claimDaily()).toBe(100)
    expect(economy.balance).toBe(100)
    expect(economy.claimDaily()).toBe(0)
    expect(economy.balance).toBe(100)
  })

  it('stores the claim date as an ISO yyyy-mm-dd string', () => {
    economy.claimDaily()
    const stored = shim.getItem('blobcade.dailyBonus')
    expect(stored).toBe(new Date().toISOString().slice(0, 10))
  })

  it('grants again once the stored day is in the past', () => {
    expect(economy.claimDaily()).toBe(100)
    // rewind the stored claim to yesterday
    shim.setItem('blobcade.dailyBonus', '2000-01-01')
    expect(economy.claimDaily()).toBe(100)
    expect(economy.balance).toBe(200)
  })
})

afterEach(() => {
  shim.clear()
})
