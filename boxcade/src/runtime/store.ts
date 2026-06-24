// The per-game Blobcash store — GameServices.store rendered as a HUD button +
// buy/equip overlay. Purchases and equips persist per game in localStorage;
// the wallet is the global Blobcash balance. The runtime reacts through
// onChange (recolor the avatar / trail); the shell hears onBuy (creator cut).

import { economy } from '../engine/economy'
import type { StoreItemDef } from '../sdk'

const KEY_PREFIX = 'blobcade.store.'

interface Persisted {
  owned: string[]
  equipped: { shirt?: string; trail?: string }
}

/** the currently equipped store items, resolved to their defs */
export interface GameStoreEquipped {
  shirt?: StoreItemDef
  trail?: StoreItemDef
}

export interface GameStore {
  /** HUD chip that opens the store — caller mounts it */
  button: HTMLElement
  equipped(): GameStoreEquipped
  dispose(): void
}

function load(gameId: string): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + gameId) ?? '{}')
    return {
      owned: Array.isArray(raw.owned) ? raw.owned : [],
      equipped: typeof raw.equipped === 'object' && raw.equipped ? raw.equipped : {},
    }
  } catch {
    return { owned: [], equipped: {} }
  }
}

export function createGameStore(opts: {
  gameId: string
  items: StoreItemDef[]
  /** overlay parent (the HUD root) */
  mount: HTMLElement
  toast: (msg: string) => void
  /** fired on every equip change AND once at creation with the persisted state */
  onChange: (eq: GameStoreEquipped) => void
  /** fired after a successful purchase (the shell may credit the creator) */
  onBuy?: (item: StoreItemDef) => void
}): GameStore {
  const state = load(opts.gameId)
  const byId = new Map(opts.items.map((i) => [i.id, i]))

  const save = () => localStorage.setItem(KEY_PREFIX + opts.gameId, JSON.stringify(state))
  const resolve = (): GameStoreEquipped => {
    const eq: GameStoreEquipped = {}
    const shirt = state.equipped.shirt ? byId.get(state.equipped.shirt) : undefined
    const trail = state.equipped.trail ? byId.get(state.equipped.trail) : undefined
    if (shirt) eq.shirt = shirt
    if (trail) eq.trail = trail
    return eq
  }

  const button = document.createElement('div')
  button.className = 'hud-chip'
  button.textContent = '🛍️ Store'
  button.style.cursor = 'pointer'
  button.title = 'This game sells cosmetics for Blobcash'

  let overlay: HTMLElement | null = null
  const close = () => {
    overlay?.remove()
    overlay = null
  }

  function open() {
    if (overlay) return close()
    overlay = document.createElement('div')
    overlay.className = 'overlay-screen'
    const card = document.createElement('div')
    card.className = 'overlay-card'
    card.innerHTML = `<h2>🛍️ Game Store</h2>
      <p>Cosmetics for this game, priced by its creator. Yours: <b>B$ ${economy.balance}</b></p>`
    const list = document.createElement('div')
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:10px 0;text-align:left'
    for (const item of opts.items) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;gap:10px'
      const swatch = document.createElement('span')
      swatch.style.width = '22px'
      swatch.style.height = '22px'
      swatch.style.borderRadius = '6px'
      swatch.style.backgroundColor = item.color
      swatch.style.border = '2px solid rgba(255,255,255,.35)'
      swatch.style.flex = 'none'
      const label = document.createElement('span')
      label.style.cssText = 'flex:1'
      label.textContent = `${item.name} · ${item.kind === 'shirt' ? 'shirt' : 'trail'}`
      const action = document.createElement('button')
      action.className = 'btn'
      const refresh = () => {
        const owned = state.owned.includes(item.id)
        const equipped = state.equipped[item.kind] === item.id
        action.textContent = !owned ? `Buy · B$ ${item.price}` : equipped ? 'Equipped ✓' : 'Equip'
      }
      refresh()
      action.onclick = () => {
        const owned = state.owned.includes(item.id)
        if (!owned) {
          if (!economy.spend(item.price)) {
            opts.toast('Not enough Blobcash — play to earn more!')
            return
          }
          state.owned.push(item.id)
          state.equipped[item.kind] = item.id
          save()
          opts.toast(`✨ Bought ${item.name}!`)
          opts.onBuy?.(item)
        } else if (state.equipped[item.kind] === item.id) {
          delete state.equipped[item.kind]
          save()
        } else {
          state.equipped[item.kind] = item.id
          save()
        }
        const balanceLine = card.querySelector('p b')
        if (balanceLine) balanceLine.textContent = `B$ ${economy.balance}`
        for (const r of list.querySelectorAll('button')) r.dispatchEvent(new Event('refresh'))
        opts.onChange(resolve())
      }
      action.addEventListener('refresh', refresh)
      row.append(swatch, label, action)
      list.appendChild(row)
    }
    const done = document.createElement('button')
    done.className = 'btn'
    done.textContent = 'Close'
    done.onclick = close
    card.append(list, done)
    overlay.appendChild(card)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })
    opts.mount.appendChild(overlay)
  }

  button.onclick = open
  // apply whatever was equipped last session
  opts.onChange(resolve())

  return {
    button,
    equipped: resolve,
    dispose() {
      close()
      button.remove()
    },
  }
}
