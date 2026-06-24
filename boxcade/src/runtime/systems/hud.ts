// HUD shell system: the overlay scaffolding every game gets (top chips,
// corner home button, net/fps chips, toasts, big messages, loading screen,
// controls hint) plus the fps meter with its reflections perf guard.
// Internal runtime system on the GameSystem lifecycle — the composition root
// (runtime.ts) creates it first so other systems can mount into hudEl, and
// calls update() right after each render (where the fps meter always lived).

import type { GameDef, GameContext, GameSystem, HudApi } from '../../sdk'
import { el, escapeHtml } from '../dom'

export interface HudSystem extends GameSystem {
  hudEl: HTMLElement
  hudTop: HTMLElement
  hudCorner: HTMLElement
  hudRight: HTMLElement
  toastWrap: HTMLElement
  netChip: HTMLElement
  loadingEl: HTMLElement
  api: HudApi
  deathFlash(): void
  mountControlsHint(hasCombat: boolean): void
  /** fps meter + reflections guard — call right after each render */
  update(ctx: GameContext, dt: number): void
}

export function createHudSystem(mount: HTMLElement, def: GameDef): HudSystem {
  const hudEl = el('div', 'hud')
  const hudTop = el('div', 'hud-top')
  const hudCorner = el('div', 'hud-corner')
  const hudRight = el('div', 'hud-right')
  const toastWrap = el('div', 'toast-wrap')

  const homeBtn = document.createElement('button')
  homeBtn.className = 'hud-home'
  homeBtn.textContent = '⬅ Blobcade'
  homeBtn.onclick = () => { location.hash = '' }
  hudCorner.appendChild(homeBtn)

  const netChip = el('div', 'hud-chip')
  netChip.style.fontSize = '12px'
  hudRight.appendChild(netChip)
  const fpsChip = el('div', 'hud-chip')
  fpsChip.style.fontSize = '12px'
  hudRight.appendChild(fpsChip)

  hudEl.append(hudTop, hudCorner, hudRight, toastWrap)
  mount.appendChild(hudEl)

  // loading screen
  const loadingEl = el('div', 'overlay-screen')
  loadingEl.innerHTML = `
    <div class="overlay-card">
      <div class="spinner"></div>
      <h2>${escapeHtml(def.meta.name)}</h2>
      <p>${escapeHtml(def.meta.blurb)}</p>
    </div>`
  mount.appendChild(loadingEl)

  const hudChips = new Map<string, HTMLElement>()
  const api: HudApi = {
    set(key, value) {
      let chip = hudChips.get(key)
      if (!chip) {
        chip = el('div', 'hud-chip')
        hudChips.set(key, chip)
        hudTop.appendChild(chip)
      }
      chip.textContent = value
    },
    remove(key) {
      hudChips.get(key)?.remove()
      hudChips.delete(key)
    },
    toast(msg) {
      const t = el('div', 'toast')
      t.textContent = msg
      toastWrap.appendChild(t)
      setTimeout(() => t.remove(), 3200)
    },
    big(msg, ms = 2600) {
      const b = el('div', 'big-msg')
      b.textContent = msg
      hudEl.appendChild(b)
      setTimeout(() => b.remove(), ms)
    },
  }

  // fps meter (+ reflections perf guard)
  let fpsAcc = 0
  let fpsN = 0
  let fpsAt = 0
  let lowFpsStreak = 0

  return {
    id: 'blobcade:hud',
    hudEl, hudTop, hudCorner, hudRight, toastWrap, netChip, loadingEl, api,

    deathFlash() {
      const f = el('div', 'death-flash')
      hudEl.appendChild(f)
      setTimeout(() => f.remove(), 600)
    },

    mountControlsHint(hasCombat: boolean) {
      const hint = el('div', 'controls-hint')
      hint.innerHTML = hasCombat && def.camera === 'fp'
        ? '<kbd>Click</kbd> to play · <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · hold <kbd>left-click</kbd> fire · <kbd>right-click</kbd> zoom · <kbd>1–7</kbd> weapons · walk over pads for guns &amp; ammo'
        : def.camera === 'fp'
          ? '<kbd>Click</kbd> to play · <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>left-click</kbd> break · <kbd>right-click</kbd> place · <kbd>1–8</kbd> blocks'
          : '<kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>drag mouse</kbd> to look around · <kbd>Scroll</kbd> zoom · <kbd>R</kbd> reset'
      hudEl.appendChild(hint)
      setTimeout(() => { hint.style.opacity = '0'; hint.style.transition = 'opacity 1s' }, 9000)
    },

    update(ctx: GameContext, dt: number) {
      fpsAcc += dt
      fpsN++
      const now = performance.now()
      if (now - fpsAt > 800) {
        const fps = fpsN / Math.max(0.001, fpsAcc)
        fpsChip.textContent = `${Math.round(fps)} fps`
        const R = ctx.engine.renderer
        if (R.ssrActive) {
          lowFpsStreak = fps < 42 ? lowFpsStreak + 1 : 0
          if (lowFpsStreak >= 4) {
            R.disableReflections()
            api.toast('⚙️ Reflections turned off to keep the game smooth')
          }
        }
        fpsAt = now
        fpsAcc = 0
        fpsN = 0
      }
    },
  }
}
