// Browser touch controls (roadmap P7-5) — lets phones/tablets play.
//
// Self-contained module that drives the existing `Input` instance by MUTATING it:
//   - a floating LEFT virtual joystick -> 8-way binary WASD keys in `input.keys`
//   - a RIGHT look area -> accumulates `input.mouseDX/mouseDY`
//   - a JUMP button -> toggles ' ' in `input.keys`
//   - (combat + first-person only) a FIRE button -> `input.lmbDown`, ZOOM toggle -> `input.rmbDown`
//   - a VEHICLE button (hidden until the runtime calls setVehicle) -> synthesizes
//     the edge-triggered 'e' press, so enter/exit needs no keyboard
//
// All DOM lives under a `.touch-root` mounted into `host`; styles are in touch.css.
// Nothing here touches runtime.ts — integration is a few lines elsewhere.
//
// NOTE: touch behaviour cannot be exercised on this dev machine (no touchscreen),
// so the runtime path is unverified by hand. The code is written defensively:
// every listener is guarded, every touch is tracked by identifier, and dispose()
// fully unwinds DOM + listeners.

import type { Input } from './input'

export interface TouchControls {
  /**
   * Show the vehicle enter/exit button with the given label (the vehicle's
   * emoji to board, an exit glyph while driving), or hide it with null.
   * The runtime calls this every frame from its vehicle-prompt logic;
   * repeated calls with the same label are free.
   */
  setVehicle(label: string | null): void
  dispose(): void
}

export interface TouchOptions {
  /** combat game (enables FIRE/ZOOM when also first-person) */
  combat?: boolean
  /** first-person camera (FIRE/ZOOM only make sense here) */
  fp?: boolean
}

/** True on devices that report touch support. */
function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0))
  )
}

/** Movement keys we ever set, so we can clear exactly these (never stomp keyboard state of other keys). */
const MOVE_KEYS = ['w', 'a', 's', 'd'] as const

/** How far a touch must leave the joystick centre (fraction of radius) before it counts as a direction. */
const DEADZONE = 0.25
/** Pixel radius the nub can travel from the joystick base centre. */
const JOY_RADIUS = 52
/** Look sensitivity: screen pixels -> mouse-delta units fed into Input. */
const LOOK_SCALE = 2.2
/** A touch that starts in the left LEFT_FRACTION of the screen owns the joystick; the rest is look. */
const LEFT_FRACTION = 0.4

export function attachTouchControls(
  input: Input,
  host: HTMLElement,
  opts: TouchOptions = {},
): TouchControls | null {
  if (!isTouchDevice()) return null
  if (typeof document === 'undefined') return null

  const showCombat = !!opts.combat && !!opts.fp

  // ---------- DOM ----------
  const root = document.createElement('div')
  root.className = 'touch-root'

  // Transparent full-screen layer that captures "look" drags. It is mounted in tree
  // order BEFORE .hud so it paints UNDER the HUD (see layering note at bottom): HUD
  // buttons (which use pointer-events:auto) stay tappable above it.
  const lookLayer = document.createElement('div')
  lookLayer.className = 'touch-look'

  // Visible controls layer. Its z-index sits ABOVE .hud but BELOW the pause/shop
  // overlays, so buttons are tappable yet hidden while a modal overlay is open.
  const ui = document.createElement('div')
  ui.className = 'touch-ui'

  // Floating joystick (base + nub). Hidden until a finger lands in the left zone.
  const joyBase = document.createElement('div')
  joyBase.className = 'touch-joy'
  const joyNub = document.createElement('div')
  joyNub.className = 'touch-joy-nub'
  joyBase.appendChild(joyNub)

  const jumpBtn = makeButton('touch-btn touch-jump', '⤒', 'Jump')

  // hidden until the runtime reports a boardable vehicle / an active ride
  const vehicleBtn = makeButton('touch-btn touch-vehicle', '🚗', 'Enter or exit vehicle')

  let fireBtn: HTMLButtonElement | null = null
  let zoomBtn: HTMLButtonElement | null = null
  if (showCombat) {
    fireBtn = makeButton('touch-btn touch-fire', '◉', 'Fire')
    zoomBtn = makeButton('touch-btn touch-zoom', '⊕', 'Zoom')
  }

  ui.appendChild(joyBase)
  if (fireBtn) ui.appendChild(fireBtn)
  if (zoomBtn) ui.appendChild(zoomBtn)
  ui.appendChild(vehicleBtn)
  ui.appendChild(jumpBtn)

  root.appendChild(lookLayer)
  root.appendChild(ui)

  // Insert before .hud so the look layer paints underneath the HUD. Fall back to append.
  const hud = host.querySelector('.hud')
  if (hud) host.insertBefore(root, hud)
  else host.appendChild(root)

  // ---------- state ----------
  // Touches we're tracking, keyed by Touch.identifier.
  let joyTouchId: number | null = null
  let joyCx = 0 // joystick centre, viewport coords (where the finger first landed)
  let joyCy = 0

  let lookTouchId: number | null = null
  let lookLastX = 0
  let lookLastY = 0

  const cleanups: Array<() => void> = []
  const on = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document,
    type: K,
    fn: (e: any) => void,
    options?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type as string, fn as EventListener, options)
    cleanups.push(() => target.removeEventListener(type as string, fn as EventListener))
  }

  // ---------- helpers ----------
  function clearMoveKeys() {
    for (const k of MOVE_KEYS) input.keys.delete(k)
  }

  /** Map a joystick vector (dx,dy in pixels, screen-space: +y is down) to 8-way WASD. */
  function applyJoystick(dx: number, dy: number) {
    clearMoveKeys()
    const dist = Math.hypot(dx, dy)
    if (dist < JOY_RADIUS * DEADZONE) return // inside deadzone -> no movement
    // Angle from +x axis; invert y so up is positive (screen y grows downward).
    const ang = Math.atan2(-dy, dx) // radians, -PI..PI
    // 8 sectors, 45° each, centred on the cardinal/diagonal directions.
    const deg = ((ang * 180) / Math.PI + 360) % 360
    const sector = Math.round(deg / 45) % 8 // 0=E,1=NE,2=N,3=NW,4=W,5=SW,6=S,7=SE
    // forward = 'w' (north), back = 's', left = 'a', right = 'd'
    switch (sector) {
      case 0: input.keys.add('d'); break // E
      case 1: input.keys.add('w'); input.keys.add('d'); break // NE
      case 2: input.keys.add('w'); break // N
      case 3: input.keys.add('w'); input.keys.add('a'); break // NW
      case 4: input.keys.add('a'); break // W
      case 5: input.keys.add('s'); input.keys.add('a'); break // SW
      case 6: input.keys.add('s'); break // S
      case 7: input.keys.add('s'); input.keys.add('d'); break // SE
    }
  }

  function moveNub(dx: number, dy: number) {
    const dist = Math.hypot(dx, dy)
    const scale = dist > JOY_RADIUS ? JOY_RADIUS / dist : 1
    joyNub.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`
  }

  function showJoystick(cx: number, cy: number) {
    joyCx = cx
    joyCy = cy
    joyBase.style.left = `${cx}px`
    joyBase.style.top = `${cy}px`
    joyBase.classList.add('on')
    joyNub.style.transform = 'translate(0px, 0px)'
  }

  function hideJoystick() {
    joyBase.classList.remove('on')
    joyNub.style.transform = 'translate(0px, 0px)'
    clearMoveKeys()
  }

  /** Find a Touch by identifier within a TouchList. */
  function findTouch(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i]
    }
    return null
  }

  // ---------- joystick (left zone) ----------
  // We listen on the look layer for the joystick spawn too, because the joystick
  // floats: it appears wherever a finger lands in the left LEFT_FRACTION of the screen.
  on(lookLayer, 'touchstart', (e: TouchEvent) => {
    if (input.captured) return
    const threshold = window.innerWidth * LEFT_FRACTION
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (t.clientX <= threshold && joyTouchId === null) {
        joyTouchId = t.identifier
        showJoystick(t.clientX, t.clientY)
        applyJoystick(0, 0)
        e.preventDefault()
      } else if (lookTouchId === null) {
        // Right zone (or left zone already owned) -> look drag.
        lookTouchId = t.identifier
        lookLastX = t.clientX
        lookLastY = t.clientY
        e.preventDefault()
      }
    }
  }, { passive: false })

  on(lookLayer, 'touchmove', (e: TouchEvent) => {
    if (input.captured) {
      // Chat opened mid-gesture: drop everything we were tracking.
      if (joyTouchId !== null) { joyTouchId = null; hideJoystick() }
      lookTouchId = null
      return
    }
    let used = false
    if (joyTouchId !== null) {
      const t = findTouch(e.changedTouches, joyTouchId)
      if (t) {
        const dx = t.clientX - joyCx
        const dy = t.clientY - joyCy
        moveNub(dx, dy)
        applyJoystick(dx, dy)
        used = true
      }
    }
    if (lookTouchId !== null) {
      const t = findTouch(e.changedTouches, lookTouchId)
      if (t) {
        input.mouseDX += (t.clientX - lookLastX) * LOOK_SCALE
        input.mouseDY += (t.clientY - lookLastY) * LOOK_SCALE
        lookLastX = t.clientX
        lookLastY = t.clientY
        used = true
      }
    }
    if (used) e.preventDefault()
  }, { passive: false })

  const endTouch = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const id = e.changedTouches[i].identifier
      if (id === joyTouchId) {
        joyTouchId = null
        hideJoystick()
      }
      if (id === lookTouchId) {
        lookTouchId = null
      }
    }
  }
  on(lookLayer, 'touchend', endTouch)
  on(lookLayer, 'touchcancel', endTouch)

  // ---------- buttons ----------
  // Each button uses touchstart/touchend with preventDefault so it never scrolls,
  // zooms, or fires a synthetic 300ms click. Press = set, release/cancel = clear.
  function bindHold(btn: HTMLElement, press: () => void, release: () => void) {
    // Track how many fingers are on this button so multi-touch release is correct.
    let active = 0
    const down = (e: TouchEvent) => {
      if (input.captured) return
      active += e.changedTouches.length
      btn.classList.add('pressed')
      press()
      e.preventDefault()
    }
    const up = (e: TouchEvent) => {
      active -= e.changedTouches.length
      if (active <= 0) {
        active = 0
        btn.classList.remove('pressed')
        release()
      }
      e.preventDefault()
    }
    on(btn, 'touchstart', down, { passive: false })
    on(btn, 'touchend', up, { passive: false })
    on(btn, 'touchcancel', up, { passive: false })
  }

  bindHold(
    jumpBtn,
    () => {
      input.keys.add(' ')
      input.pressed.add(' ')
    },
    () => input.keys.delete(' '),
  )

  // Vehicle enter/exit: one synthesized edge-press of 'e' per tap — exactly
  // what the runtime's vehicle logic polls for; Input.endFrame clears it.
  bindHold(
    vehicleBtn,
    () => input.pressed.add('e'),
    () => { /* edge press — nothing to release */ },
  )

  let vehicleLabel: string | null = null
  function setVehicle(label: string | null) {
    if (label === vehicleLabel) return
    vehicleLabel = label
    if (label) {
      vehicleBtn.textContent = label
      vehicleBtn.classList.add('on')
    } else {
      vehicleBtn.classList.remove('on')
    }
  }

  if (fireBtn) {
    bindHold(
      fireBtn,
      () => { input.lmbDown = true },
      () => { input.lmbDown = false },
    )
  }

  if (zoomBtn) {
    // Zoom is a toggle, not a hold: tap flips input.rmbDown.
    const toggle = (e: TouchEvent) => {
      if (input.captured) return
      input.rmbDown = !input.rmbDown
      zoomBtn!.classList.toggle('on', input.rmbDown)
      e.preventDefault()
    }
    on(zoomBtn, 'touchstart', toggle, { passive: false })
    // Swallow touchend so it doesn't bubble into a synthetic click.
    on(zoomBtn, 'touchend', (e: TouchEvent) => e.preventDefault(), { passive: false })
  }

  // ---------- dispose ----------
  function dispose() {
    cleanups.forEach((c) => c())
    cleanups.length = 0
    // Release any keys/buttons we may have left set.
    clearMoveKeys()
    input.keys.delete(' ')
    if (fireBtn) input.lmbDown = false
    root.remove()
  }

  return { setVehicle, dispose }
}

function makeButton(className: string, label: string, aria: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = className
  b.type = 'button'
  b.textContent = label
  b.setAttribute('aria-label', aria)
  return b
}
