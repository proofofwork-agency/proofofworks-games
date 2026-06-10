// Pause menu system: the Escape overlay with controls help, voxel-world
// save/download, and the leave/back-to-Studio button. Internal runtime
// system on the GameSystem lifecycle.

import type { GameDef, GameSystem } from '../../sdk'
import type { Input } from '../../engine/input'
import type { VoxelWorld } from '../../engine/voxel'
import { el, btn } from '../dom'

export interface PauseSystem extends GameSystem {
  readonly isOpen: boolean
  toggle(): void
}

export function createPauseSystem(deps: {
  mount: HTMLElement
  input: Input
  def: GameDef
  hasCombat: boolean
  toast: (msg: string) => void
  getVoxels: () => VoxelWorld | null
  onSaveWorld?: (worldJson: string) => string | void
  isChatOpen: () => boolean
}): PauseSystem {
  const { mount, input, def, hasCombat, toast, getVoxels, onSaveWorld, isChatOpen } = deps
  let pauseEl: HTMLElement | null = null

  function toggle() {
    if (pauseEl) {
      pauseEl.remove()
      pauseEl = null
      input.captured = isChatOpen()
      return
    }
    input.captured = true
    pauseEl = el('div', 'overlay-screen')
    const card = el('div', 'overlay-card')
    card.innerHTML = `
      <h2>Paused</h2>
      <p>
        <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>R</kbd> reset ·
        ${hasCombat && def.camera === 'fp'
          ? '<kbd>Click</kbd> capture mouse · hold <kbd>left-click</kbd> fire · <kbd>right-click</kbd> zoom (sniper) · <kbd>1–7</kbd>/<kbd>scroll</kbd> weapons'
          : def.camera === 'fp'
            ? '<kbd>Click</kbd> capture mouse · <kbd>left-click</kbd> break · <kbd>right-click</kbd> place · <kbd>1–8</kbd> blocks'
            : 'drag the mouse (either button) to look around · <kbd>Scroll</kbd> zoom · <kbd>Shift</kbd> toggle mouse-look'}
        · <kbd>/</kbd> chat · <kbd>M</kbd> mute
      </p>`
    const resume = btn('Resume', '')
    resume.onclick = () => toggle()
    card.appendChild(resume)
    const voxels = getVoxels()
    if (voxels) {
      if (onSaveWorld) {
        const saveDraftBtn = btn('💾 Save world to My Games', '')
        saveDraftBtn.onclick = () => {
          const msg = onSaveWorld(voxels.serialize())
          toast(typeof msg === 'string' && msg ? msg : '💾 World saved to My Games')
          toggle()
        }
        card.appendChild(saveDraftBtn)
      }
      const save = btn('Download world', 'ghost')
      save.onclick = () => {
        const blob = new Blob([voxels.serialize()], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `boxcade-${def.meta.id}-world.json`
        a.click()
        URL.revokeObjectURL(a.href)
      }
      card.appendChild(save)
    }
    // test-play sessions (Studio/editor) leave back to where they came from
    const returnTo = localStorage.getItem('boxcade.returnTo')
    const home = btn(returnTo ? '⬅ Back to Studio' : 'Leave game', 'ghost')
    home.onclick = () => {
      if (returnTo) localStorage.removeItem('boxcade.returnTo')
      location.hash = returnTo ?? ''
    }
    card.appendChild(home)
    pauseEl.appendChild(card)
    mount.appendChild(pauseEl)
  }

  return {
    id: 'boxcade:pause',
    get isOpen() { return pauseEl !== null },
    toggle,
  }
}
