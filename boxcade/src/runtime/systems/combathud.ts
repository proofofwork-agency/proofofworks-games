// Combat HUD system: health bar, ammo readout, weapon bar, kill feed,
// hitmarker, damage vignette, sniper-scope overlay, respawn overlay and the
// fp crosshair. Pure DOM — the CombatSystem wiring (what to show when) stays
// in the composition root, which calls these methods. Internal runtime
// system on the GameSystem lifecycle.

import type { GameSystem } from '../../sdk'
import type { CombatSystem } from '../../engine/combat'
import { el } from '../dom'

export interface CombatHudSystem extends GameSystem {
  updateHealth(hp: number, max: number): void
  addKillLine(attackerName: string, icon: string, victimName: string): void
  updateAmmo(): void
  renderWeaponBar(): void
  damageVignette(): void
  hitmarker(): void
  showRespawnOverlay(): void
  hideRespawnOverlay(): void
  setScoped(on: boolean, zoomLabel: string): void
}

export function createCombatHudSystem(deps: {
  hudEl: HTMLElement
  mount: HTMLElement
  combat: CombatSystem
  fp: boolean
}): CombatHudSystem {
  const { hudEl, mount, combat, fp } = deps

  hudEl.classList.add('combat') // shifts chat above the health bar

  // sniper scope overlay (shown while right-click zooming)
  let scopeEl: HTMLElement | null = null
  let scopeZoomEl: HTMLElement | null = null
  if (fp) {
    scopeEl = el('div', 'scope-overlay')
    const ring = el('div', 'scope-ring')
    const hLine = el('div', 'scope-h')
    const vLine = el('div', 'scope-v')
    scopeZoomEl = el('div', 'scope-zoom')
    scopeEl.append(ring, hLine, vLine, scopeZoomEl)
    hudEl.appendChild(scopeEl)
  }

  const hbWrap = el('div', 'health-wrap')
  const hb = el('div', 'health-bar')
  const healthFill = el('div', 'health-fill')
  hb.appendChild(healthFill)
  const healthNum = el('div', 'health-num')
  healthNum.textContent = '100'
  const ammoWrap = el('div', 'ammo-wrap')
  const ammoIcon = el('div', 'ammo-icon')
  const ammoNum = el('div', 'ammo-num')
  ammoWrap.append(ammoIcon, ammoNum)
  hbWrap.append(healthNum, hb, ammoWrap)
  hudEl.appendChild(hbWrap)

  const weaponBar = el('div', 'hotbar weapon-bar')
  hudEl.appendChild(weaponBar)

  const killFeed = el('div', 'kill-feed')
  hudEl.appendChild(killFeed)

  const hitmarkerEl = el('div', 'hitmarker')
  hitmarkerEl.textContent = '✛'
  hudEl.appendChild(hitmarkerEl)

  if (fp) hudEl.appendChild(el('div', 'crosshair'))

  let respawnOverlay: HTMLElement | null = null

  function updateHealth(hp: number, max: number) {
    const k = Math.max(0, Math.min(1, hp / max))
    healthFill.style.width = `${k * 100}%`
    healthFill.style.background = k > 0.55 ? '#37d67a' : k > 0.28 ? '#ffc94d' : '#ff5d5d'
    healthNum.textContent = String(Math.ceil(hp))
  }

  function updateAmmo() {
    const self = combat.self
    const w = self.weapon
    const a = combat.infiniteAmmo ? Infinity : self.ammoOf(w)
    ammoIcon.textContent = w.icon
    ammoNum.textContent = a === Infinity ? '∞' : String(a)
    ammoNum.classList.toggle('low', a !== Infinity && a <= Math.max(3, (w.ammoMax ?? 0) * 0.15))
  }

  function renderWeaponBar() {
    const self = combat.self
    weaponBar.innerHTML = ''
    self.weapons.forEach((wp, i) => {
      const owned = self.owned.has(wp.id)
      const a = combat.infiniteAmmo ? Infinity : self.ammoOf(wp)
      let cls = 'hot-slot weapon-slot'
      if (i === self.weaponIdx) cls += ' sel'
      if (!owned) cls += ' locked'
      else if (a <= 0) cls += ' dry'
      const slot = el('div', cls)
      const num = el('div', 'num')
      num.textContent = String(i + 1)
      const icon = el('div', 'wicon')
      icon.textContent = owned ? wp.icon : '🔒'
      const nm = el('div', 'nm')
      nm.textContent = wp.name
      const am = el('div', 'ammo')
      am.textContent = !owned ? '–' : a === Infinity ? '∞' : String(a)
      slot.append(num, icon, nm, am)
      weaponBar.appendChild(slot)
    })
    updateAmmo()
  }

  renderWeaponBar()
  updateHealth(combat.self.health, combat.self.maxHealth)

  return {
    id: 'blobcade:combat-hud',
    updateHealth,
    updateAmmo,
    renderWeaponBar,

    addKillLine(attackerName: string, iconText: string, victimName: string) {
      const line = el('div', 'kill-line')
      const attacker = document.createElement('b')
      attacker.textContent = attackerName
      const victim = document.createElement('b')
      victim.textContent = victimName
      line.append(attacker, document.createTextNode(` ${iconText} `), victim)
      killFeed.appendChild(line)
      while (killFeed.children.length > 6) killFeed.firstChild?.remove()
      setTimeout(() => line.remove(), 6000)
    },

    damageVignette() {
      const v = el('div', 'dmg-vignette')
      hudEl.appendChild(v)
      setTimeout(() => v.remove(), 380)
    },

    hitmarker() {
      hitmarkerEl.classList.remove('show')
      void hitmarkerEl.offsetWidth
      hitmarkerEl.classList.add('show')
    },

    showRespawnOverlay() {
      respawnOverlay = el('div', 'overlay-screen respawn-overlay')
      const c = el('div', 'overlay-card')
      c.innerHTML = `<h2>💀</h2><p>Respawning…</p>`
      respawnOverlay.appendChild(c)
      mount.appendChild(respawnOverlay)
    },

    hideRespawnOverlay() {
      respawnOverlay?.remove()
      respawnOverlay = null
    },

    setScoped(on: boolean, zoomLabel: string) {
      if (scopeEl) scopeEl.classList.toggle('show', on)
      if (on && scopeZoomEl) scopeZoomEl.textContent = zoomLabel
      hudEl.classList.toggle('scoped', on)
    },
  }
}
