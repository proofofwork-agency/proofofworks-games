// The Boxcade Studio — in-world 3D creation for non-programmers. A studio
// session is its own composition root (like runtime/runtime.ts, but for
// editing): it drives the engine subsystems directly over a GameDoc draft.
// Every edit is a doc-op — mutate() snapshots the doc for undo, applies the
// change, rebuilds the scene from the doc, and autosaves the draft. The doc
// is the single source of truth; meshes are throwaway projections of it.
//
// Controls: right-drag look — orbits the SELECTED part (yaw 360°, pitch ±1.45),
// free-look when nothing is selected · scroll wheel dollies the orbit radius ·
// WASD fly (QE down/up, Shift fast) · left-click select / place · left-drag
// move on the ground plane · arrows nudge · [ ] rotate (22.5°) · + − resize
// (×1.15) · Ctrl+D duplicate · Del delete · Ctrl+Z / Ctrl+Shift+Z undo/redo.

import * as THREE from 'three'
import { Renderer } from '../engine/renderer'
import { Input } from '../engine/input'
import { PartsWorld, behaviorFromDef, type RuntimePart } from '../engine/world'
import { VoxelWorld } from '../engine/voxel'
import { v3, type Vec3 } from '../engine/math'
import { buildTextMap } from '../sdk/textmap'
import { validateGameDoc, type GameDoc, type DocPart, type DocV3, type DocVehicleType } from '../sdk/gamedoc'
import { encodeGameDoc, SHARE_LINK_LIMIT } from '../sdk/codec'
import { slugifyName } from '../sdk/gamedoc'
import { loadDraft, saveDraft } from '../drafts'
import type { WorldBuilder, SdkPart } from '../sdk'
import { buildStudioUI } from './ui'
import { mountFloorPlan, type FloorPlanHandle } from '../editor'
import './studio.css'

export interface StudioSession {
  dispose(): void
}

/** the in-Studio floor-plan overlay control the top-bar button drives */
export interface FloorPlanOverlay {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
}

/** everything the UI panels need to talk to the studio core */
export interface StudioApi {
  readonly doc: GameDoc
  readonly draftKey: string
  readonly selection: number | null
  /** the palette template currently armed for placement (null = none) */
  readonly armed: DocPart | null
  /** apply a doc change as one undoable step; the scene resyncs after */
  mutate(label: string, fn: (doc: GameDoc) => void): void
  /** update meta/world settings without rebuilding the world (cheap path) */
  mutateSettings(fn: (doc: GameDoc) => void): void
  select(index: number | null): void
  /** arm placement: next ground click places this part (null disarms) */
  armPlacement(template: DocPart | null): void
  /** arm "click to set spawn" mode */
  armSpawnPick(): void
  undo(): void
  redo(): void
  saveNow(): void
  testPlay(): void
  share(): Promise<{ copied: boolean; tooBig: boolean }>
  setLighting(preset: string): void
  toast(msg: string): void
  /** ids + tags currently present in doc.parts (for rule part pickers) */
  partRefs(): string[]
  /** move the fly camera up close to the selected part and aim at it */
  focusSelected(): void
  /** current grid snap step (meters) */
  getSnap(): number
  /** set the grid snap step (e.g. 0.5 or 0.1) */
  setSnap(step: number): void
  onChange(fn: () => void): void
  /** the in-Studio 2D floor-plan overlay (the other view of this draft) */
  readonly floorPlan: FloorPlanOverlay
}

const STARTER_DOC = (): GameDoc => ({
  boxcade: 'gamedoc',
  v: 1,
  meta: { name: 'My Studio Game', emoji: '🧱', genre: 'Obby', blurb: 'Built in the Boxcade Studio.' },
  camera: 'orbit',
  lighting: 'noon',
  spawn: [0, 2.6, 6],
  parts: [
    { kind: 'part', at: [0, 0.5, 0], size: [18, 1, 18], color: '#6cc04a', material: 'grass' },
    { kind: 'coin', at: [3, 2.4, -2] },
    { kind: 'winPad', at: [0, 1.3, -6], size: [4, 0.6, 4] },
  ],
  rules: [],
})

let SNAP = 0.5
const snap = (n: number, alt: boolean) => (alt ? n : Math.round(n / SNAP) * SNAP)

// kinds whose mesh carries a visual rotY (door/mover/button/portal place via a
// single w.add slab in the interpreter; collision stays axis-aligned)
const KINDS_WITH_ROTY = new Set<DocPart['kind']>(['part', 'door', 'mover', 'button', 'portal'])
// kinds that carry a box `size` (some optional, defaulted by meshDefFor)
const KINDS_WITH_SIZE = new Set<DocPart['kind']>(
  ['part', 'door', 'mover', 'lava', 'winPad', 'checkpoint', 'bouncePad', 'button', 'portal', 'gravityZone'],
)
const ROT_STEP = Math.PI / 8 // 22.5° per [ or ] press
const SCALE_STEP = 1.15 // grow/shrink factor per + or - press
const SIZE_MIN = 0.1
const SIZE_MAX = 600
const SCALE_MIN = 0.2
const SCALE_MAX = 6
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function vehicleStandIn(type: DocVehicleType, at: Vec3, color?: string): SdkPart {
  const size = type === 'boat' ? v3(2.2, 0.8, 4.2) : type === 'plane' ? v3(2.0, 1.0, 3.6) : type === 'jetpack' ? v3(0.8, 1.1, 0.6) : v3(2.0, 1.0, 3.2)
  const paint = color ?? (type === 'boat' ? '#3b82f6' : type === 'plane' ? '#e8edf2' : type === 'jetpack' ? '#caa64b' : '#e74c3c')
  return { at: v3(at.x, at.y + size.y / 2, at.z), size, color: paint, material: 'metal' }
}

function gravityZoneStandIn(at: Vec3, size: Vec3, gravity: number, color?: string): SdkPart {
  return { at, size, gravityZone: gravity, color: color ?? '#8a5cff', material: 'glass' }
}

export function renderStudio(app: HTMLElement, draftKeyIn: string | null): StudioSession {
  // does the launch hash ask us to open the floor-plan overlay right away?
  // (read BEFORE the replaceState below, which would drop the ?floorplan flag)
  const wantFloorPlan = /[?&]floorplan=1/.test(location.hash)

  // ---------- document ----------
  let draftKey = draftKeyIn ?? ''
  let doc: GameDoc = (draftKeyIn && loadDraft(draftKeyIn)) || STARTER_DOC()
  if (!draftKeyIn) {
    draftKey = saveDraft(null, doc)
    history.replaceState(null, '', `#/studio/${draftKey}`)
  }
  doc.parts = doc.parts ?? []
  doc.rules = doc.rules ?? []

  const undoStack: string[] = []
  const redoStack: string[] = []
  let disposed = false

  // ---------- DOM scaffold ----------
  app.className = ''
  app.innerHTML = ''
  const shell = document.createElement('div')
  shell.className = 'studio-shell'
  const viewport = document.createElement('div')
  viewport.className = 'studio-viewport'
  shell.appendChild(viewport)
  // floor-plan overlay host: a full-viewport panel above the 3D view (below the
  // top bar). The 3D scene keeps rendering behind it; painting tiles rebuilds it
  // live via mutate('floorplan', …). Hidden until the top-bar button opens it.
  const floorPlanHost = document.createElement('div')
  floorPlanHost.className = 'studio-floorplan'
  floorPlanHost.hidden = true
  shell.appendChild(floorPlanHost)
  app.appendChild(shell)

  // ---------- engine ----------
  const R = new Renderer(viewport, doc.lighting ?? 'noon')
  const parts = new PartsWorld()
  R.scene.add(parts.group)
  const input = new Input(R.renderer.domElement)

  // edit-only helpers: grid + spawn marker + selection box + ghost
  const grid = new THREE.GridHelper(120, 120, 0x5d6df1, 0x2c3454)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.35
  grid.position.y = 0.01
  R.scene.add(grid)

  const spawnMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.4, 12),
    new THREE.MeshStandardMaterial({ color: '#39d98a', emissive: '#1f8f5a', emissiveIntensity: 0.7 }),
  )
  spawnMarker.rotation.x = Math.PI
  R.scene.add(spawnMarker)

  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd166)
  selBox.visible = false
  R.scene.add(selBox)

  let ghost: THREE.Mesh | null = null
  let placeTemplate: DocPart | null = null
  let spawnPickArmed = false

  // ---------- scene sync (doc → meshes) ----------
  // doc.parts entries become selectable meshes; embedded textmap/voxel
  // sections render read-only context (edited in their own tools).
  let editableMeshes: THREE.Mesh[] = []
  let meshToIndex = new Map<THREE.Mesh, number>()
  let voxels: VoxelWorld | null = null

  function clearWorld() {
    for (const p of [...parts.parts]) parts.remove(p)
    parts.group.clear()
    parts.parts.length = 0
    parts.reflective.length = 0
    if (voxels) {
      R.scene.remove(voxels.group)
      voxels = null
    }
    editableMeshes = []
    meshToIndex = new Map()
  }

  /** a WorldBuilder that projects prefab verbs straight into the PartsWorld —
   *  enough visual truth for editing; gameplay wiring happens in the runtime */
  function contextBuilder(): WorldBuilder {
    const addPart = (d: SdkPart) => {
      const rp = parts.add(d)
      return { get pos() { return rp.pos }, remove() { parts.remove(rp) } }
    }
    return {
      lighting() { /* studio uses doc.lighting */ },
      spawn(at: Vec3) { if (!doc.spawn) spawnMarker.position.set(at.x, at.y + 1.2, at.z) },
      killY() {},
      add: addPart,
      label(text, at, scale = 1, color = '#ffffff') { parts.addLabel(text, at, scale, color) },
      checkpoint(at, _i, size = v3(4, 0.6, 4)) { addPart({ at, size, color: '#39d98a', material: 'neon' }) },
      lava(at, size) { addPart({ at, size, color: '#ff5a1f', material: 'lava', collide: false }) },
      coin(at) { addPart({ at, size: v3(0.9, 0.9, 0.25), color: '#ffc94d', material: 'gold', collide: false }) },
      winPad(at, size = v3(6, 1, 6)) { addPart({ at, size, color: '#ffc94d', material: 'gold' }) },
      bouncePad(at, _p, size = v3(3, 0.7, 3)) { addPart({ at, size, color: '#06d6a0', material: 'neon' }) },
      tree(at, scale = 1) {
        addPart({ at: v3(at.x, at.y + 1.5 * scale, at.z), size: v3(0.8 * scale, 3 * scale, 0.8 * scale), color: '#74512f', material: 'wood' })
        addPart({ at: v3(at.x, at.y + 3.6 * scale, at.z), size: v3(3 * scale, 2.2 * scale, 3 * scale), color: '#3f9e35', material: 'grass', collide: false })
      },
      cloud(at, scale = 1) { addPart({ at, size: v3(7 * scale, 1.6 * scale, 4 * scale), color: '#ffffff', collide: false }) },
      spinnerHazard(center, radius, count = 3) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          addPart({ at: v3(center.x + Math.cos(a) * radius, center.y, center.z + Math.sin(a) * radius), size: v3(1.6, 1.6, 1.6), color: '#ff3b3b', material: 'neon', collide: false })
        }
      },
      healthPack(at) { addPart({ at, size: v3(0.9, 0.9, 0.9), color: '#37d67a', material: 'neon', collide: false }) },
      vehicle(type, at, opts = {}) {
        addPart(vehicleStandIn(type, at, opts.color))
      },
      weaponSpawn(at) { addPart({ at, size: v3(0.95, 0.4, 0.4), color: '#cfd8e3', material: 'metal', collide: false }) },
      ammoSpawn(at) { addPart({ at, size: v3(0.8, 0.55, 0.8), color: '#caa64b', material: 'metal', collide: false }) },
      light(at, opts = {}) {
        const pl = new THREE.PointLight(opts.color ?? '#ffffff', opts.intensity ?? 90, opts.range ?? 32, 1.8)
        pl.position.set(at.x, at.y, at.z)
        parts.group.add(pl)
      },
      portal(at) {
        // frame + inner pane only — gameplay wiring (touch slab) is runtime-only
        addPart({ at, size: v3(2.6, 3.2, 0.4), color: '#8a5cff', material: 'neon', collide: false })
        addPart({ at, size: v3(2.0, 2.6, 0.12), color: '#c4b5ff', material: 'glass', collide: false })
      },
      physics() {},
      voxelIsland(opts = {}) {
        voxels = opts.data ? VoxelWorld.deserialize(opts.data) : new VoxelWorld(opts.size ?? 96, 42, opts.size ?? 96, 10)
        if (!opts.data) voxels.generateIsland(opts.seed ?? 20260609)
        voxels.buildAll()
        R.scene.add(voxels.group)
      },
    }
  }

  /** mesh shapes for each editable DocPart (mirrors the interpreter visuals) */
  function meshDefFor(p: DocPart): SdkPart {
    const at = v3(p.at[0], p.at[1], p.at[2])
    switch (p.kind) {
      case 'part': return { at, size: v3(...(p.size as DocV3)), color: p.color, material: p.material, rotY: p.rotY }
      case 'coin': return { at, size: v3(0.9, 0.9, 0.25), color: '#ffc94d', material: 'gold' }
      case 'healthPack': return { at, size: v3(0.9, 0.9, 0.9), color: '#37d67a', material: 'neon' }
      case 'ammoSpawn': return { at, size: v3(0.8, 0.55, 0.8), color: '#caa64b', material: 'metal' }
      case 'tree': return { at: v3(at.x, at.y + 1.8, at.z), size: v3(2.4 * (p.scale ?? 1), 4 * (p.scale ?? 1), 2.4 * (p.scale ?? 1)), color: '#3f9e35', material: 'grass' }
      case 'cloud': return { at, size: v3(7 * (p.scale ?? 1), 1.6 * (p.scale ?? 1), 4 * (p.scale ?? 1)), color: '#ffffff' }
      case 'lava': return { at, size: p.size ? v3(...p.size) : v3(2, 1, 2), color: '#ff5a1f', material: 'lava' }
      case 'winPad': return { at, size: p.size ? v3(...p.size) : v3(6, 1, 6), color: '#ffc94d', material: 'gold' }
      case 'checkpoint': return { at, size: p.size ? v3(...p.size) : v3(4, 0.6, 4), color: '#39d98a', material: 'neon' }
      case 'bouncePad': return { at, size: p.size ? v3(...p.size) : v3(3, 0.7, 3), color: '#06d6a0', material: 'neon' }
      case 'weaponSpawn': return { at, size: v3(0.95, 0.5, 0.5), color: '#cfd8e3', material: 'metal' }
      case 'spinnerHazard': return { at, size: v3(p.radius * 2, 1.6, p.radius * 2), color: '#ff3b3b', material: 'glass' }
      case 'label': return { at, size: v3(3, 0.8, 0.3), color: '#e8ecf6', material: 'neon' }
      case 'light': return { at, size: v3(0.6, 0.6, 0.6), color: p.color ?? '#fff3c4', material: 'neon' }
      case 'vehicle': return vehicleStandIn(p.vehicle, at, p.color)
      case 'gravityZone': return gravityZoneStandIn(at, v3(...p.size), p.gravity, p.color)
      case 'button': return { at, size: p.size ? v3(...p.size) : v3(1.6, 0.22, 1.6), color: p.color ?? '#ffd166', material: 'neon', rotY: p.rotY }
      case 'door': return { at, size: p.size ? v3(...p.size) : v3(2, 3, 0.5), color: p.color ?? '#8a5a2b', material: p.material ?? 'wood', rotY: p.rotY }
      case 'mover': return { at, size: v3(...p.size), color: p.color ?? '#9aa0a6', material: p.material ?? 'stone', rotY: p.rotY }
      case 'portal': return { at, size: p.size ? v3(...p.size) : v3(2.6, 3.2, 0.4), color: p.color ?? '#8a5cff', material: 'neon', rotY: p.rotY }
    }
  }

  function syncScene() {
    clearWorld()
    // read-only context first (textmap world, voxel terrain)
    if (doc.textmap) {
      try { buildTextMap(contextBuilder(), doc.textmap) } catch (err) { console.warn('[studio] textmap render failed', err) }
    }
    if (doc.voxel) {
      try { contextBuilder().voxelIsland(doc.voxel) } catch (err) { console.warn('[studio] voxel render failed', err) }
    }
    const contextCount = parts.parts.length
    // editable doc parts
    for (let i = 0; i < doc.parts!.length; i++) {
      const rp = parts.add(meshDefFor(doc.parts![i]))
      meshToIndex.set(rp.mesh, i)
      editableMeshes.push(rp.mesh)
    }
    void contextCount
    if (doc.spawn) spawnMarker.position.set(doc.spawn[0], doc.spawn[1] + 1.2, doc.spawn[2])
    refreshSelectionBox()
    // keep the open painter in step with external textmap changes (undo/redo,
    // template loads) — skip the echo from the painter's own paint
    if (floorPlanHandle && !floorPlanEcho) floorPlanHandle.refresh()
  }

  // ---------- selection ----------
  let selection: number | null = null

  function refreshSelectionBox() {
    if (selection === null || selection >= doc.parts!.length) {
      selBox.visible = false
      return
    }
    const mesh = editableMeshes[selection]
    if (!mesh) { selBox.visible = false; return }
    selBox.box.setFromObject(mesh)
    selBox.box.expandByScalar(0.06)
    selBox.visible = true
  }

  function select(i: number | null) {
    const changed = i !== selection
    selection = i
    // re-anchor the orbit to the new pivot on the next frame (radius/yaw/pitch
    // recomputed from the current camera pose — no snap when selection flips)
    if (changed) orbitRadius = 0
    refreshSelectionBox()
    emitChange()
  }

  // ---------- undo / autosave ----------
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let savedAt = 0

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 800)
  }

  function captureThumb() {
    try {
      R.render(performance.now() / 1000)
      const srcCanvas = R.renderer.domElement
      const w = 220
      const h = Math.max(1, Math.round((srcCanvas.height / Math.max(1, srcCanvas.width)) * w))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(srcCanvas, 0, 0, w, h)
      const url = c.toDataURL('image/jpeg', 0.55)
      if (url.length < 60_000) doc.meta.thumb = url
    } catch { /* thumbnails are best-effort */ }
  }

  function saveNow() {
    if (disposed) return
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    captureThumb()
    const res = validateGameDoc(JSON.parse(JSON.stringify(doc)))
    if (!res.ok) {
      console.warn('[studio] draft failed validation, saving anyway for recovery', res.errors)
    }
    saveDraft(draftKey, doc)
    savedAt = Date.now()
    emitChange()
  }

  function mutate(label: string, fn: (d: GameDoc) => void) {
    undoStack.push(JSON.stringify(doc))
    if (undoStack.length > 100) undoStack.shift()
    redoStack.length = 0
    fn(doc)
    syncScene()
    scheduleSave()
    emitChange()
    void label
  }

  function mutateSettings(fn: (d: GameDoc) => void) {
    undoStack.push(JSON.stringify(doc))
    redoStack.length = 0
    fn(doc)
    if (doc.spawn) spawnMarker.position.set(doc.spawn[0], doc.spawn[1] + 1.2, doc.spawn[2])
    scheduleSave()
    emitChange()
  }

  function undo() {
    const prev = undoStack.pop()
    if (!prev) return
    redoStack.push(JSON.stringify(doc))
    doc = JSON.parse(prev)
    selection = null
    syncScene()
    scheduleSave()
    emitChange()
  }

  function redo() {
    const next = redoStack.pop()
    if (!next) return
    undoStack.push(JSON.stringify(doc))
    doc = JSON.parse(next)
    selection = null
    syncScene()
    scheduleSave()
    emitChange()
  }

  // ---------- fly camera ----------
  // starts above the +x/+z corner looking back at the origin (where the
  // starter floor sits): yaw π+atan2(14,16), pitch ≈ -asin(12/|pos|)
  //
  // cam.yaw/cam.pitch always describe the VIEW DIRECTION (where the camera
  // looks). Free-fly moves cam.pos along that direction. Orbit mode (a part is
  // selected) keeps the same yaw/pitch meaning but pins the look target to the
  // selected part: the camera sits at pivot − dir·radius and looks at the
  // pivot, so a right-drag swings the camera AROUND the part (yaw is free 360°,
  // pitch clamps ±1.45). Scroll dollies the orbit radius (3..60 m).
  const cam = { yaw: 3.86, pitch: -0.51, pos: v3(14, 12, 16) }
  const ORBIT_MIN = 3
  const ORBIT_MAX = 60
  let orbitRadius = 0 // re-seeded from cam.pos each time a part is selected

  function camDir(): Vec3 {
    const cp = Math.cos(cam.pitch)
    return v3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp)
  }

  /** the live orbit pivot: the selected part's position (null when none). */
  function orbitPivot(): Vec3 | null {
    if (selection === null) return null
    const p = doc.parts?.[selection]
    return p ? v3(p.at[0], p.at[1], p.at[2]) : null
  }

  /** re-anchor the orbit to a pivot WITHOUT snapping: keep the current view
   *  direction, derive yaw/pitch + radius from where the camera already is. */
  function reseatOrbit(pivot: Vec3) {
    const dx = pivot.x - cam.pos.x
    const dy = pivot.y - cam.pos.y
    const dz = pivot.z - cam.pos.z
    const dist = Math.hypot(dx, dy, dz)
    orbitRadius = Math.max(ORBIT_MIN, Math.min(ORBIT_MAX, dist || ORBIT_MIN))
    if (dist > 1e-4) {
      cam.yaw = Math.atan2(dx, dz)
      cam.pitch = Math.max(-1.45, Math.min(1.45, Math.asin(dy / dist)))
    }
  }

  function updateCamera(dt: number) {
    const pivot = orbitPivot()

    if (input.rmbDown) {
      cam.yaw -= input.mouseDX * 0.0042
      cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch - input.mouseDY * 0.0042))
    }

    if (pivot) {
      // ----- orbit mode: swing around the selected part -----
      if (orbitRadius <= 0) reseatOrbit(pivot)
      // scroll wheel dollies in/out along the view ray
      if (input.wheelDelta !== 0) {
        orbitRadius = Math.max(ORBIT_MIN, Math.min(ORBIT_MAX, orbitRadius + input.wheelDelta * 0.02))
      }
      // WASD/QE still pan: nudge the radius (forward/back) so flying near a
      // selection feels alive without losing the orbit anchor
      const axes = input.moveAxes()
      if (axes.z !== 0) {
        const speed = (input.keys.has('shift') ? 34 : 14) * dt
        orbitRadius = Math.max(ORBIT_MIN, Math.min(ORBIT_MAX, orbitRadius - axes.z * speed))
      }
      const d = camDir()
      cam.pos.x = pivot.x - d.x * orbitRadius
      cam.pos.y = pivot.y - d.y * orbitRadius
      cam.pos.z = pivot.z - d.z * orbitRadius
      cam.pos.y = Math.max(-20, cam.pos.y)
      R.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z)
      R.camera.lookAt(pivot.x, pivot.y, pivot.z)
      return
    }

    // ----- free-fly mode: no selection -----
    orbitRadius = 0
    const axes = input.moveAxes()
    const speed = (input.keys.has('shift') ? 34 : 14) * dt
    const dir = camDir()
    const right = v3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw))
    cam.pos.x += (dir.x * axes.z + right.x * axes.x) * speed
    cam.pos.y += (dir.y * axes.z + right.y * axes.x) * speed
    cam.pos.z += (dir.z * axes.z + right.z * axes.x) * speed
    if (!input.captured) {
      if (input.keys.has('e') || input.keys.has(' ')) cam.pos.y += speed
      if (input.keys.has('q')) cam.pos.y -= speed
    }
    cam.pos.y = Math.max(-20, cam.pos.y)
    R.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z)
    const d = camDir()
    R.camera.lookAt(cam.pos.x + d.x, cam.pos.y + d.y, cam.pos.z + d.z)
  }

  // ---------- picking + transform ----------
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let dragging = false
  let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const dragOffset = new THREE.Vector3()
  let downAt: { x: number; y: number } | null = null

  function setNdc(e: MouseEvent) {
    const rect = R.renderer.domElement.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  function pick(e: MouseEvent): number | null {
    setNdc(e)
    raycaster.setFromCamera(ndc, R.camera)
    const hits = raycaster.intersectObjects(editableMeshes, false)
    if (hits.length === 0) return null
    return meshToIndex.get(hits[0].object as THREE.Mesh) ?? null
  }

  function groundPoint(e: MouseEvent, planeY = 0): THREE.Vector3 | null {
    setNdc(e)
    raycaster.setFromCamera(ndc, R.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
    const out = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, out) ? out : null
  }

  /** placement point: top of a hovered part, else the y=0 grid */
  function placePoint(e: MouseEvent, half: number): THREE.Vector3 | null {
    setNdc(e)
    raycaster.setFromCamera(ndc, R.camera)
    const hits = raycaster.intersectObjects(parts.group.children, false)
    const hit = hits.find((h) => (h.object as THREE.Mesh).isMesh)
    if (hit && hit.face) {
      const p = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(half))
      return p
    }
    const g = groundPoint(e, 0)
    if (g) g.y += half
    return g
  }

  const domEl = R.renderer.domElement
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || input.captured) return
    downAt = { x: e.clientX, y: e.clientY }
    // spawn pick mode
    if (spawnPickArmed) {
      const g = placePoint(e, 0)
      if (g) {
        spawnPickArmed = false
        domEl.style.cursor = ''
        mutateSettings((d) => { d.spawn = [snap(g.x, e.altKey), snap(g.y + 1.4, e.altKey), snap(g.z, e.altKey)] })
        api.toast('📍 Spawn moved')
      }
      return
    }
    // placement mode
    if (placeTemplate) {
      const half = (meshDefFor(placeTemplate).size?.y ?? 1) / 2
      const g = placePoint(e, half)
      if (g) {
        const t = JSON.parse(JSON.stringify(placeTemplate)) as DocPart
        t.at = [snap(g.x, e.altKey), snap(g.y, e.altKey), snap(g.z, e.altKey)]
        mutate('place', (d) => { d.parts!.push(t) })
        select(doc.parts!.length - 1)
        if (!e.shiftKey) api.armPlacement(null) // shift = keep stamping
      }
      return
    }
    // select / start drag
    const hit = pick(e)
    if (hit !== null) {
      select(hit)
      const p = doc.parts![hit]
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.at[1])
      const g = groundPoint(e, p.at[1])
      if (g) {
        dragOffset.set(p.at[0] - g.x, 0, p.at[2] - g.z)
        dragging = true
        undoStack.push(JSON.stringify(doc)) // one undo step per drag
        redoStack.length = 0
      }
    } else {
      select(null)
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    if (ghost && placeTemplate) {
      const half = (meshDefFor(placeTemplate).size?.y ?? 1) / 2
      const g = placePoint(e, half)
      if (g) {
        ghost.position.set(snap(g.x, e.altKey), snap(g.y, e.altKey), snap(g.z, e.altKey))
        ghost.visible = true
      } else ghost.visible = false
      return
    }
    if (!dragging || selection === null) return
    const p = doc.parts![selection]
    const g = groundPoint(e, p.at[1])
    if (!g) return
    p.at = [snap(g.x + dragOffset.x, e.altKey), p.at[1], snap(g.z + dragOffset.z, e.altKey)]
    const mesh = editableMeshes[selection]
    const rp = parts.parts.find((x: RuntimePart) => x.mesh === mesh)
    if (rp) {
      rp.pos.x = p.at[0]; rp.pos.y = p.at[1]; rp.pos.z = p.at[2]
      rp.base = { ...rp.pos }
    }
    refreshSelectionBox()
  }

  const onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0) return
    if (dragging) {
      dragging = false
      // tiny drags = clicks; drop the undo frame we pushed if nothing moved
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 3) undoStack.pop()
      else { scheduleSave(); emitChange() }
    }
    downAt = null
  }

  domEl.addEventListener('mousedown', onMouseDown)
  domEl.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)

  // typing in any panel field must not fly the camera or trigger hotkeys
  const isFormEl = (t: EventTarget | null) =>
    t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement
  const onFocusIn = (e: FocusEvent) => { if (isFormEl(e.target)) input.captured = true }
  const onFocusOut = () => { input.captured = isFormEl(document.activeElement) }
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)

  /** scale the selected part by `factor`: size-based kinds scale their box
   *  (per-axis clamp 0.1..600), tree/cloud scale their `scale` (0.2..6), and
   *  spinnerHazard scales its radius. One mutate per call (undoable). */
  function resizeSelected(factor: number) {
    if (selection === null) return
    const i = selection
    const p = doc.parts![i]
    if (p.kind === 'tree' || p.kind === 'cloud') {
      mutate('scale', (d) => {
        const part = d.parts![i] as Extract<DocPart, { kind: 'tree' | 'cloud' }>
        part.scale = clamp((part.scale ?? 1) * factor, SCALE_MIN, SCALE_MAX)
      })
    } else if (p.kind === 'spinnerHazard') {
      mutate('scale', (d) => {
        const part = d.parts![i] as Extract<DocPart, { kind: 'spinnerHazard' }>
        part.radius = clamp(part.radius * factor, 1, SIZE_MAX)
      })
    } else if (KINDS_WITH_SIZE.has(p.kind)) {
      // size-based: materialize the effective size (defaults included) then scale
      const cur = meshDefFor(p).size
      mutate('resize', (d) => {
        const part = d.parts![i] as Extract<DocPart, { size?: DocV3 }>
        part.size = [
          clamp(cur.x * factor, SIZE_MIN, SIZE_MAX),
          clamp(cur.y * factor, SIZE_MIN, SIZE_MAX),
          clamp(cur.z * factor, SIZE_MIN, SIZE_MAX),
        ]
      })
    }
  }

  // ---------- keyboard ops ----------
  const onKey = (e: KeyboardEvent) => {
    if (disposed || input.captured) return
    const k = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && k === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
      return
    }
    if ((e.metaKey || e.ctrlKey) && k === 'd') {
      e.preventDefault()
      if (selection !== null) {
        const copy = JSON.parse(JSON.stringify(doc.parts![selection])) as DocPart
        copy.at = [copy.at[0] + 2, copy.at[1], copy.at[2] + 2]
        delete copy.id
        mutate('duplicate', (d) => { d.parts!.push(copy) })
        select(doc.parts!.length - 1)
      }
      return
    }
    if (selection === null) return
    if (k === 'f') { e.preventDefault(); api.focusSelected(); return }
    const p = doc.parts![selection]
    const step = e.shiftKey ? 2 : SNAP
    const nudge = (dx: number, dy: number, dz: number) => {
      e.preventDefault()
      mutate('nudge', () => { p.at = [p.at[0] + dx, p.at[1] + dy, p.at[2] + dz] })
    }
    if (k === 'delete' || k === 'backspace') {
      e.preventDefault()
      const idx = selection
      mutate('delete', (d) => { d.parts!.splice(idx, 1) })
      select(null)
    } else if (k === 'arrowup' && !e.metaKey) nudge(0, 0, -step)
    else if (k === 'arrowdown') nudge(0, 0, step)
    else if (k === 'arrowleft') nudge(-step, 0, 0)
    else if (k === 'arrowright') nudge(step, 0, 0)
    else if (k === 'pageup' || k === 'r') nudge(0, step, 0)
    else if (k === 'pagedown') nudge(0, -step, 0)
    else if (k === '[' || k === ']') {
      e.preventDefault()
      if (KINDS_WITH_ROTY.has(p.kind)) {
        const part = p as Extract<DocPart, { rotY?: number }>
        mutate('rotate', () => { part.rotY = (part.rotY ?? 0) + (k === ']' ? 1 : -1) * ROT_STEP })
      }
    } else if (k === '+' || k === '=' || k === '-') {
      e.preventDefault()
      const factor = k === '-' ? 1 / SCALE_STEP : SCALE_STEP
      resizeSelected(factor)
    }
  }
  document.addEventListener('keydown', onKey)

  // ---------- change listeners (UI panels subscribe) ----------
  const changeFns: Array<() => void> = []
  function emitChange() {
    for (const fn of changeFns) {
      try { fn() } catch (err) { console.error('[studio] panel update failed', err) }
    }
  }

  // ---------- floor-plan overlay ----------
  // The 2D painter mounts into floorPlanHost and edits doc.textmap. Each paint
  // is a real doc-op (mutate('floorplan', …)) so the 3D view rebuilds live and
  // undo works. While the overlay is open we capture input so studio fly-keys /
  // hotkeys stay quiet (the painter has its own Space-to-pan handling).
  let floorPlanHandle: FloorPlanHandle | null = null
  // ignore the textmap mutate we cause ourselves when refreshing the painter
  let floorPlanEcho = false

  function openFloorPlan() {
    if (floorPlanHandle) return
    input.captured = true
    floorPlanHost.hidden = false
    floorPlanHandle = mountFloorPlan(floorPlanHost, {
      title: '🗺 Floor plan — paint tiles; the 3D view rebuilds live behind you',
      getTextmap: () => doc.textmap,
      setTextmap: (src) => {
        // the painter's mount-time sync re-serializes the same map; skip the
        // no-op so opening the overlay doesn't create an undo frame / rebuild
        if (src === doc.textmap) return
        floorPlanEcho = true
        mutate('floorplan', (d) => { d.textmap = src })
        floorPlanEcho = false
      },
      onClose: () => closeFloorPlan(),
    })
    emitChange() // reflect the button's active (.sel) state
  }

  function closeFloorPlan() {
    if (!floorPlanHandle) return
    floorPlanHandle.dispose()
    floorPlanHandle = null
    floorPlanHost.hidden = true
    input.captured = isFormEl(document.activeElement)
    emitChange()
  }

  const floorPlan: FloorPlanOverlay = {
    open: openFloorPlan,
    close: closeFloorPlan,
    toggle() { floorPlanHandle ? closeFloorPlan() : openFloorPlan() },
    isOpen() { return floorPlanHandle !== null },
  }

  // ---------- the api ----------
  const api: StudioApi = {
    get doc() { return doc },
    get draftKey() { return draftKey },
    get selection() { return selection },
    get armed() { return placeTemplate },
    mutate,
    mutateSettings,
    select,
    armPlacement(template) {
      placeTemplate = template
      spawnPickArmed = false
      if (ghost) { R.scene.remove(ghost); ghost.geometry.dispose(); ghost = null }
      if (template) {
        const def = meshDefFor(template)
        ghost = new THREE.Mesh(
          new THREE.BoxGeometry(def.size.x, def.size.y, def.size.z),
          new THREE.MeshStandardMaterial({ color: def.color ?? '#8fd0ff', transparent: true, opacity: 0.45, depthWrite: false }),
        )
        ghost.visible = false
        R.scene.add(ghost)
        domEl.style.cursor = 'copy'
      } else {
        domEl.style.cursor = ''
      }
      emitChange()
    },
    armSpawnPick() {
      api.armPlacement(null)
      spawnPickArmed = true
      domEl.style.cursor = 'crosshair'
    },
    undo,
    redo,
    saveNow,
    testPlay() {
      saveNow()
      localStorage.setItem('boxcade.returnTo', `#/studio/${draftKey}`)
      location.hash = `#/play/draft/${draftKey}`
    },
    async share() {
      saveNow()
      const payload = await encodeGameDoc(doc)
      if (payload.length <= SHARE_LINK_LIMIT) {
        await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/play/d/${payload}`)
        return { copied: true, tooBig: false }
      }
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${slugifyName(doc.meta.name)}.boxcade.json`
      a.click()
      URL.revokeObjectURL(a.href)
      return { copied: false, tooBig: true }
    },
    setLighting(preset) {
      mutateSettings((d) => { d.lighting = preset })
      api.toast('💡 Lighting is applied when you play (studio keeps its work light)')
    },
    toast(msg) {
      const t = document.createElement('div')
      t.className = 'studio-toast'
      t.textContent = msg
      shell.appendChild(t)
      setTimeout(() => t.remove(), 2600)
    },
    partRefs() {
      const refs = new Set<string>()
      for (const p of doc.parts ?? []) {
        if (p.id) refs.add(p.id)
        if (p.tag) refs.add(p.tag)
        if (p.kind === 'button') refs.add(p.tag ?? 'button')
        if (p.kind === 'door') refs.add(p.tag ?? 'door')
      }
      if (doc.textmap?.includes('D')) refs.add('door')
      if (doc.textmap?.includes('P')) refs.add('button')
      return [...refs]
    },
    focusSelected() {
      if (selection === null) return
      const mesh = editableMeshes[selection]
      if (!mesh) return
      const box = new THREE.Box3().setFromObject(mesh)
      const center = box.getCenter(new THREE.Vector3())
      const radius = Math.max(2, box.getSize(new THREE.Vector3()).length() / 2)
      // pull back along the current view direction so the part frames nicely
      const back = camDir()
      const dist = radius * 2.4 + 3
      cam.pos.x = center.x - back.x * dist
      cam.pos.y = center.y - back.y * dist + radius * 0.6
      cam.pos.z = center.z - back.z * dist
      cam.pos.y = Math.max(-20, cam.pos.y)
      const dx = center.x - cam.pos.x
      const dy = center.y - cam.pos.y
      const dz = center.z - cam.pos.z
      cam.yaw = Math.atan2(dx, dz)
      cam.pitch = Math.max(-1.45, Math.min(1.45, Math.asin(dy / (Math.hypot(dx, dy, dz) || 1))))
      // in orbit mode the next frame re-derives radius from this fresh pose
      orbitRadius = 0
    },
    getSnap() { return SNAP },
    setSnap(step) {
      SNAP = step > 0 ? step : 0.5
      emitChange()
    },
    onChange(fn) { changeFns.push(fn) },
    floorPlan,
  }

  // ---------- UI panels ----------
  const ui = buildStudioUI(shell, api, () => savedAt)

  // ---------- frame loop ----------
  let last = performance.now()
  let raf = 0
  function frame(now: number) {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000
    updateCamera(dt)
    parts.update(t, dt)
    R.updateSun(new THREE.Vector3(cam.pos.x, cam.pos.y, cam.pos.z))
    R.render(t)
    input.endFrame()
  }

  syncScene()
  emitChange()
  // launched as #/studio/<key>?floorplan=1 → open the painter straight away
  // (Portal "New map" + textmap-only "Edit" route through here)
  if (wantFloorPlan) openFloorPlan()
  raf = requestAnimationFrame((n) => { last = n; frame(n) })

  return {
    dispose() {
      disposed = true
      if (floorPlanHandle) { floorPlanHandle.dispose(); floorPlanHandle = null }
      if (saveTimer) { clearTimeout(saveTimer); saveNow() }
      cancelAnimationFrame(raf)
      domEl.removeEventListener('mousedown', onMouseDown)
      domEl.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      ui.dispose()
      input.dispose()
      R.dispose()
      app.innerHTML = ''
    },
  }
}
