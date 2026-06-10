// Keyboard + mouse input manager. Classic platformer scheme by default:
//   WASD/arrows move, Space jump, right-mouse-drag orbits the camera,
//   scroll zooms, Shift toggles shift-lock, R resets, Enter opens chat.
// Build games switch to pointer-lock first person (LMB break / RMB place).

export class Input {
  keys = new Set<string>()
  /** edge-triggered presses consumed once per frame */
  pressed = new Set<string>()
  mouseDX = 0
  mouseDY = 0
  wheelDelta = 0
  rmbDown = false
  lmbDown = false
  lmbClicked = false
  rmbClicked = false
  pointerLocked = false
  /** when true (chat open / menu), gameplay keys are ignored */
  captured = false

  private el: HTMLElement
  private detach: Array<() => void> = []

  constructor(el: HTMLElement) {
    this.el = el

    const on = <K extends keyof DocumentEventMap>(
      target: Document | HTMLElement,
      type: K,
      fn: (e: any) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type as string, fn as EventListener, opts)
      this.detach.push(() => target.removeEventListener(type as string, fn as EventListener))
    }

    on(document, 'keydown', (e: KeyboardEvent) => {
      if (this.captured) return
      const k = e.key.toLowerCase()
      if (!e.repeat) this.pressed.add(k)
      this.keys.add(k)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
    })
    on(document, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase())
    })

    on(this.el, 'mousedown', (e: MouseEvent) => {
      if (e.button === 2) this.rmbDown = true
      if (e.button === 0) {
        this.lmbDown = true
        e.preventDefault() // no text selection while orbit-dragging over the HUD
      }
      if (this.pointerLocked) {
        if (e.button === 0) this.lmbClicked = true
        if (e.button === 2) this.rmbClicked = true
      }
    })
    on(document, 'mouseup', (e: MouseEvent) => {
      if (e.button === 2) this.rmbDown = false
      if (e.button === 0) this.lmbDown = false
    })
    on(document, 'mousemove', (e: MouseEvent) => {
      if (this.pointerLocked || this.rmbDown || this.lmbDown) {
        this.mouseDX += e.movementX
        this.mouseDY += e.movementY
      }
    })
    on(this.el, 'wheel', (e: WheelEvent) => {
      this.wheelDelta += e.deltaY
      e.preventDefault()
    }, { passive: false })
    on(this.el, 'contextmenu', (e: Event) => e.preventDefault())

    on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el
    })
  }

  requestPointerLock() {
    if (!this.pointerLocked) this.el.requestPointerLock?.()
  }
  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock?.()
  }

  /** Movement vector in input space: x = strafe right, z = forward. */
  moveAxes(): { x: number; z: number } {
    if (this.captured) return { x: 0, z: 0 }
    let x = 0
    let z = 0
    if (this.keys.has('w') || this.keys.has('arrowup')) z += 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) z -= 1
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1
    const len = Math.hypot(x, z)
    return len > 1 ? { x: x / len, z: z / len } : { x, z }
  }

  jumpHeld(): boolean {
    return !this.captured && this.keys.has(' ')
  }
  /** is a key currently held? (lowercase name, e.g. 'shift', 'e') */
  held(key: string): boolean {
    return !this.captured && this.keys.has(key)
  }
  wasPressed(key: string): boolean {
    return !this.captured && this.pressed.has(key)
  }

  /** Call at end of frame: clears per-frame edges. */
  endFrame() {
    this.pressed.clear()
    this.mouseDX = 0
    this.mouseDY = 0
    this.wheelDelta = 0
    this.lmbClicked = false
    this.rmbClicked = false
  }

  dispose() {
    this.detach.forEach((d) => d())
    this.detach = []
  }
}
