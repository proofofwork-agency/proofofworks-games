// Build mode system (the seed of the Studio's edit mode): hotbar + crosshair
// UI and the first-person voxel break/place loop. Internal runtime system on
// the GameSystem lifecycle. The composition root calls update() at build
// mode's original spot in the frame — before the camera rig updates — so
// edit raycasts use the same camera state they always did. Only LOCAL edit
// effects live here; journaling + network broadcast go through recordEdit
// (remote edits apply in runtime.ts even for non-building viewers).

import * as THREE from 'three'
import type { GameDef, GameContext, GameSystem } from '../../sdk'
import type { Input } from '../../engine/input'
import type { CameraRig } from '../../engine/camera'
import type { CharacterController } from '../../engine/physics'
import type { Particles } from '../../engine/fx'
import { VoxelWorld, BLOCKS, AIR, WATER } from '../../engine/voxel'
import { audio } from '../../engine/audio'
import { el } from '../dom'

export interface BuildModeSystem extends GameSystem {
  /** true when this game has a first-person voxel world to edit */
  readonly active: boolean
  /** keys/wheel/break/place — call at build mode's original frame position */
  update(ctx: GameContext, dt: number): void
}

export function createBuildModeSystem(deps: {
  hudEl: HTMLElement
  def: GameDef
  voxels: VoxelWorld | null
  palette: number[]
  input: Input
  rig: CameraRig
  camera: THREE.PerspectiveCamera
  char: CharacterController
  fx: Particles
  /** journal the edit + broadcast it to the room */
  recordEdit: (x: number, y: number, z: number, t: number) => void
}): BuildModeSystem {
  const { hudEl, def, voxels, palette, input, rig, camera, char, fx, recordEdit } = deps
  const active = !!voxels && def.camera === 'fp'

  let hotbarSel = 0
  let hotbarEl: HTMLElement | null = null
  if (active) {
    const cross = el('div', 'crosshair')
    hudEl.appendChild(cross)
    hotbarEl = el('div', 'hotbar')
    palette.forEach((bt, i) => {
      const slot = el('div', 'hot-slot' + (i === 0 ? ' sel' : ''))
      const sw = el('div', 'swatch')
      sw.style.background = BLOCKS[bt].top
      const num = el('div', 'num')
      num.textContent = String(i + 1)
      const nm = el('div', 'nm')
      nm.textContent = BLOCKS[bt].name
      slot.append(num, sw, nm)
      hotbarEl!.appendChild(slot)
    })
    hudEl.appendChild(hotbarEl)
  }

  function selectHotbar(i: number) {
    if (!hotbarEl) return
    hotbarSel = ((i % palette.length) + palette.length) % palette.length
    Array.from(hotbarEl.children).forEach((c, j) => c.classList.toggle('sel', j === hotbarSel))
  }

  return {
    id: 'blobcade:buildmode',
    active,

    update(_ctx: GameContext, _dt: number) {
      if (!active || !voxels) return
      // hotbar keys + wheel cycling
      for (let i = 0; i < palette.length; i++) {
        if (input.wasPressed(String(i + 1))) selectHotbar(i)
      }
      if (input.pointerLocked && input.wheelDelta !== 0) {
        selectHotbar(hotbarSel + (input.wheelDelta > 0 ? 1 : -1))
      }
      if (!input.pointerLocked) return
      const vw = voxels
      const eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      if (input.lmbClicked) {
        const hit = vw.raycast(eye, rig.lookDir(), 7)
        if (hit && hit.y > 0) {
          const info = BLOCKS[hit.type]
          // digging at/below sea level next to water floods the hole —
          // otherwise you get see-through air pockets walled by water
          const nearWater =
            hit.y <= vw.seaLevel &&
            (vw.get(hit.x + 1, hit.y, hit.z) === WATER || vw.get(hit.x - 1, hit.y, hit.z) === WATER ||
             vw.get(hit.x, hit.y, hit.z + 1) === WATER || vw.get(hit.x, hit.y, hit.z - 1) === WATER ||
             vw.get(hit.x, hit.y + 1, hit.z) === WATER)
          const fill = nearWater ? WATER : AIR
          vw.set(hit.x, hit.y, hit.z, fill)
          recordEdit(hit.x, hit.y, hit.z, fill)
          audio.breakBlock()
          fx.burst(new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5), {
            count: 14, colors: [info.side, info.top], speed: 3.2, life: 0.55, size: 0.28,
          })
        }
      }
      if (input.rmbClicked) {
        const hit = vw.raycast(eye, rig.lookDir(), 7)
        if (hit) {
          const px = hit.x + hit.nx
          const py = hit.y + hit.ny
          const pz = hit.z + hit.nz
          const cur = vw.get(px, py, pz)
          const intersectsPlayer =
            px + 1 > char.pos.x - char.halfW && px < char.pos.x + char.halfW &&
            py + 1 > char.pos.y && py < char.pos.y + char.height &&
            pz + 1 > char.pos.z - char.halfW && pz < char.pos.z + char.halfW
          if ((cur === AIR || cur === WATER) && !intersectsPlayer && vw.inBounds(px, py, pz)) {
            vw.set(px, py, pz, palette[hotbarSel])
            recordEdit(px, py, pz, palette[hotbarSel])
            audio.place()
          }
        }
      }
    },
  }
}
