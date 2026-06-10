// Bolts — Boxcade's platform economy:
//   earn by playing (coins, kills, captures, wins, daily login)
//   spend in the avatar shop (shirts, trails, hats, faces)
// Wallet + inventory persist in localStorage. The classic platform loop,
// miniaturized: play → earn → express yourself → play more.

/** Cosmetic slots. Each slot equips independently of the others. */
export type CosmeticKind = 'shirt' | 'trail' | 'hat' | 'face'

export interface ShopItem {
  id: string
  kind: CosmeticKind
  name: string
  price: number
  /** css color for shirts / trail tint / hat & face accent */
  color: string
}

export const CATALOG: ShopItem[] = [
  { id: 'shirt-crimson', kind: 'shirt', name: 'Crimson Shirt', price: 0, color: '#e74c3c' },
  { id: 'shirt-royal', kind: 'shirt', name: 'Royal Blue', price: 150, color: '#5d6df1' },
  { id: 'shirt-mint', kind: 'shirt', name: 'Fresh Mint', price: 150, color: '#06d6a0' },
  { id: 'shirt-midnight', kind: 'shirt', name: 'Midnight', price: 250, color: '#2c3e50' },
  { id: 'shirt-pink', kind: 'shirt', name: 'Bubblegum', price: 250, color: '#fd79a8' },
  { id: 'shirt-gold', kind: 'shirt', name: 'Golden Drip', price: 500, color: '#ffc94d' },
  { id: 'trail-sparkle', kind: 'trail', name: 'Sparkle Trail', price: 300, color: '#ffffff' },
  { id: 'trail-fire', kind: 'trail', name: 'Fire Trail', price: 500, color: '#ff8c42' },
  { id: 'trail-rainbow', kind: 'trail', name: 'Rainbow Trail', price: 900, color: '#b388ff' },
  // hats — procedural meshes parented to the head (see avatar.ts)
  { id: 'hat-cap', kind: 'hat', name: 'Baseball Cap', price: 200, color: '#e74c3c' },
  { id: 'hat-tophat', kind: 'hat', name: 'Top Hat', price: 400, color: '#1c2733' },
  { id: 'hat-crown', kind: 'hat', name: 'Golden Crown', price: 1200, color: '#ffc94d' },
  { id: 'hat-halo', kind: 'hat', name: 'Glow Halo', price: 800, color: '#ffe9a8' },
  // faces — canvas-drawn expression variants (see avatar.ts)
  { id: 'face-happy', kind: 'face', name: 'Happy Face', price: 0, color: '#1a1a1a' },
  { id: 'face-cool', kind: 'face', name: 'Cool Shades', price: 350, color: '#222' },
  { id: 'face-angry', kind: 'face', name: 'Game Face', price: 250, color: '#1a1a1a' },
]

const K_BOLTS = 'boxcade.bolts'
const K_INV = 'boxcade.inventory'
const K_EQUIP = 'boxcade.equipped'
const K_DAILY = 'boxcade.dailyBonus'

export interface Equipped {
  shirt: string | null
  trail: string | null
  /** additive slots — present only once touched, so the legacy
   *  boxcade.equipped JSON ({shirt,trail}) stays compatible */
  hat?: string | null
  face?: string | null
}

type Listener = (balance: number) => void

class Economy {
  private listeners: Listener[] = []

  get balance(): number {
    return Number(localStorage.getItem(K_BOLTS) ?? 0) || 0
  }

  private setBalance(n: number) {
    localStorage.setItem(K_BOLTS, String(Math.max(0, Math.round(n))))
    this.listeners.forEach((l) => l(this.balance))
  }

  onChange(fn: Listener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  earn(amount: number, _reason?: string): number {
    if (amount > 0) this.setBalance(this.balance + amount)
    return this.balance
  }

  inventory(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(K_INV) ?? '[]')
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }

  owns(id: string): boolean {
    const item = CATALOG.find((i) => i.id === id)
    return (item?.price === 0) || this.inventory().includes(id)
  }

  /** deduct Bolts if affordable (per-game stores) — false when short */
  spend(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0 || this.balance < amount) return false
    this.setBalance(this.balance - amount)
    return true
  }

  buy(id: string): { ok: boolean; reason?: string } {
    const item = CATALOG.find((i) => i.id === id)
    if (!item) return { ok: false, reason: 'unknown item' }
    if (this.owns(id)) return { ok: false, reason: 'already owned' }
    if (this.balance < item.price) return { ok: false, reason: 'not enough Bolts' }
    this.setBalance(this.balance - item.price)
    localStorage.setItem(K_INV, JSON.stringify([...this.inventory(), id]))
    return { ok: true }
  }

  equipped(): Equipped {
    try {
      const v = JSON.parse(localStorage.getItem(K_EQUIP) ?? '{}')
      // shirt/trail always present (legacy shape); hat/face are additive and
      // only included once set, so the returned record stays a strict superset
      // of the old { shirt, trail } object.
      const eq: Equipped = { shirt: v.shirt ?? null, trail: v.trail ?? null }
      if (v.hat != null) eq.hat = v.hat
      if (v.face != null) eq.face = v.face
      return eq
    } catch {
      return { shirt: null, trail: null }
    }
  }

  equip(id: string | null, kind: CosmeticKind) {
    const eq = this.equipped()
    if (id !== null && !this.owns(id)) return
    eq[kind] = id
    localStorage.setItem(K_EQUIP, JSON.stringify(eq))
    this.listeners.forEach((l) => l(this.balance))
  }

  equippedShirtColor(): string | undefined {
    const id = this.equipped().shirt
    return CATALOG.find((i) => i.id === id && i.kind === 'shirt')?.color
  }

  equippedTrail(): ShopItem | null {
    const id = this.equipped().trail
    return CATALOG.find((i) => i.id === id && i.kind === 'trail') ?? null
  }

  /** the equipped hat item (the avatar reads .id + .color), or null */
  equippedHat(): ShopItem | null {
    const id = this.equipped().hat
    return CATALOG.find((i) => i.id === id && i.kind === 'hat') ?? null
  }

  /** the equipped face id (e.g. 'face-cool'), or null for the default smile */
  equippedFace(): string | null {
    const id = this.equipped().face
    return CATALOG.find((i) => i.id === id && i.kind === 'face')?.id ?? null
  }

  /** daily login bonus. Returns the amount granted (0 if already claimed). */
  claimDaily(): number {
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem(K_DAILY) === today) return 0
    localStorage.setItem(K_DAILY, today)
    this.earn(100, 'daily')
    return 100
  }
}

export const economy = new Economy()
