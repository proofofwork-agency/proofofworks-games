// Studio UI: top bar, part palette, and the right-hand tabs (Part properties /
// World settings / Game Logic). Pure DOM over the StudioApi — every change
// goes through api.mutate / api.mutateSettings so undo + autosave just work.
// All user-entered values render via textContent / input.value (no HTML).

import { WEAPONS, type WeaponDef } from '../engine/combat'
import { RULE_SOUNDS } from '../sdk/rules'
import type { Rule, RuleAction, RuleTrigger } from '../sdk/rules'
import { PORTAL_TARGET_RE, slugifyName, type DocPart, type DocV3, type DocVehicleType, type GameDoc, type StoreItem, type StudioGameMode } from '../sdk/gamedoc'
import { listDrafts, loadDraft } from '../drafts'
import type { StudioApi } from './studio'
import { analyzeStudioScript, applyStudioMode, getStudioMode, getStudioModeSettings, SCRIPT_API, SCRIPT_ENTITY_API, STUDIO_MODE_CONTROLS, STUDIO_MODE_LABELS, STUDIO_MODE_OPTIONS, type ModeControl } from './modes'

export interface StudioPaletteItem {
  label: string
  icon: string
  group: string
  mapChar: string
  mapColor: string
  template: DocPart
}

export const STUDIO_PALETTE: StudioPaletteItem[] = [
  { group: 'Build', label: 'Block', icon: '⬜', mapChar: '#', mapColor: '#9aa0a6', template: { kind: 'part', at: [0, 1, 0], size: [4, 1, 4], color: '#9aa0a6', material: 'stone' } },
  { group: 'Build', label: 'Platform', icon: '🟫', mapChar: '=', mapColor: '#c89c62', template: { kind: 'part', at: [0, 1, 0], size: [6, 0.6, 6], color: '#c89c62', material: 'wood' } },
  { group: 'Build', label: 'Wall', icon: '🧱', mapChar: '1', mapColor: '#b5564e', template: { kind: 'part', at: [0, 2, 0], size: [4, 3, 0.6], color: '#b5564e', material: 'stone' } },
  { group: 'Build', label: 'Ice', icon: '🧊', mapChar: 'I', mapColor: '#bfeaff', template: { kind: 'part', at: [0, 1, 0], size: [4, 0.6, 4], color: '#bfeaff', material: 'ice' } },
  { group: 'Build', label: 'Neon', icon: '🟩', mapChar: 'N', mapColor: '#59f7d2', template: { kind: 'part', at: [0, 1, 0], size: [3, 0.6, 3], color: '#59f7d2', material: 'neon' } },
  { group: 'Build', label: 'Glass', icon: '🔷', mapChar: 'g', mapColor: '#bfeaff', template: { kind: 'part', at: [0, 2, 0], size: [4, 3, 0.4], color: '#bfeaff', material: 'glass' } },
  { group: 'Gameplay', label: 'Coin', icon: '🪙', mapChar: 'C', mapColor: '#ffc94d', template: { kind: 'coin', at: [0, 2, 0] } },
  { group: 'Gameplay', label: 'Lava', icon: '🔥', mapChar: 'L', mapColor: '#ff5a1f', template: { kind: 'lava', at: [0, 0.5, 0], size: [4, 0.6, 4] } },
  { group: 'Gameplay', label: 'Water', icon: '💧', mapChar: '~', mapColor: '#2f81f7', template: { kind: 'water', at: [0, 0.4, 0], size: [8, 0.8, 8] } },
  { group: 'Gameplay', label: 'Checkpoint', icon: '✅', mapChar: 'K', mapColor: '#39d98a', template: { kind: 'checkpoint', at: [0, 0.8, 0], index: 1 } },
  { group: 'Gameplay', label: 'Win pad', icon: '🏆', mapChar: 'W', mapColor: '#ffd700', template: { kind: 'winPad', at: [0, 0.8, 0], size: [4, 0.6, 4] } },
  { group: 'Gameplay', label: 'Bounce', icon: '🟢', mapChar: 'B', mapColor: '#06d6a0', template: { kind: 'bouncePad', at: [0, 0.8, 0], power: 24 } },
  { group: 'Gameplay', label: 'Spinner', icon: '🌀', mapChar: 'Z', mapColor: '#ff3b3b', template: { kind: 'spinnerHazard', at: [0, 2, 0], radius: 4, count: 3 } },
  { group: 'Gameplay', label: 'Button', icon: '🔘', mapChar: 'P', mapColor: '#ffd166', template: { kind: 'button', at: [0, 1.2, 0] } },
  { group: 'Gameplay', label: 'Door', icon: '🚪', mapChar: 'D', mapColor: '#8a5a2b', template: { kind: 'door', at: [0, 2.5, 0], size: [2, 3, 0.5], tag: 'door' } },
  { group: 'Gameplay', label: 'Ladder', icon: '🪜', mapChar: 'E', mapColor: '#c89c62', template: { kind: 'ladder', at: [0, 2.5, 0], size: [1.4, 5, 0.25], color: '#c89c62' } },
  { group: 'Gameplay', label: 'Elevator', icon: '🛗', mapChar: 'V', mapColor: '#9aa0a6', template: { kind: 'mover', at: [0, 1, 0], size: [3, 0.6, 3], by: [0, 5, 0], period: 5 } },
  { group: 'Gameplay', label: 'Portal', icon: '🌀', mapChar: 'Q', mapColor: '#8a5cff', template: { kind: 'portal', at: [0, 2.2, 0], target: 'home', label: 'Portal' } },
  { group: 'Gameplay', label: 'Low-G Zone', icon: '🌙', mapChar: 'U', mapColor: '#6d8cff', template: { kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 0.3 } },
  { group: 'Vehicles', label: 'Car', icon: '🚗', mapChar: 'R', mapColor: '#e74c3c', template: { kind: 'vehicle', at: [0, 1, 0], vehicle: 'car', speed: 26, color: '#e74c3c' } },
  { group: 'Vehicles', label: 'Jetpack', icon: '🎒', mapChar: 'J', mapColor: '#caa64b', template: { kind: 'vehicle', at: [0, 1.5, 0], vehicle: 'jetpack', speed: 12, fuel: 10, color: '#caa64b' } },
  { group: 'Vehicles', label: 'Boat', icon: '🚤', mapChar: 'O', mapColor: '#3b82f6', template: { kind: 'vehicle', at: [0, 1, 0], vehicle: 'boat', speed: 14, color: '#3b82f6' } },
  { group: 'Vehicles', label: 'Plane', icon: '✈️', mapChar: 'F', mapColor: '#e8edf2', template: { kind: 'vehicle', at: [0, 1.2, 0], vehicle: 'plane', speed: 34, fuel: 60, color: '#e8edf2' } },
  { group: 'Combat', label: 'Health', icon: '💚', mapChar: 'H', mapColor: '#37d67a', template: { kind: 'healthPack', at: [0, 1.8, 0] } },
  { group: 'Combat', label: 'Ammo', icon: '📦', mapChar: 'A', mapColor: '#caa64b', template: { kind: 'ammoSpawn', at: [0, 1.8, 0] } },
  { group: 'Combat', label: 'Weapon', icon: '🚀', mapChar: 'Y', mapColor: '#cfd8e3', template: { kind: 'weaponSpawn', at: [0, 1.8, 0], weapon: 'rockets' } },
  { group: 'Decor', label: 'Tree', icon: '🌳', mapChar: 'T', mapColor: '#3f9e35', template: { kind: 'tree', at: [0, 1, 0] } },
  { group: 'Decor', label: 'Cloud', icon: '☁️', mapChar: 'M', mapColor: '#ffffff', template: { kind: 'cloud', at: [0, 14, 0] } },
  { group: 'Decor', label: 'Label', icon: '🔤', mapChar: '@', mapColor: '#e8ecf6', template: { kind: 'label', at: [0, 4, 0], text: 'Hello!' } },
  { group: 'Decor', label: 'Light', icon: '💡', mapChar: '*', mapColor: '#fff3c4', template: { kind: 'light', at: [0, 4, 0], intensity: 90, range: 28 } },
]

const MATERIALS = ['plastic', 'grass', 'wood', 'stone', 'ice', 'neon', 'lava', 'water', 'gold', 'glass', 'metal', 'sand']
const LIGHTING = ['noon', 'morning', 'goldenHour', 'night', 'space']
const WEAPON_SOUNDS = ['sidearm', 'shock', 'pulse', 'minigun', 'flak', 'rocket', 'sniper']
const VOXEL_SIZES = [64, 96, 128]
const VEHICLE_LABELS: Record<DocVehicleType, string> = {
  car: 'Car',
  jetpack: 'Jetpack',
  boat: 'Boat',
  plane: 'Plane',
}
const VEHICLE_DEFAULT_SPEED: Record<DocVehicleType, number> = {
  car: 26,
  jetpack: 12,
  boat: 14,
  plane: 34,
}
const VEHICLE_DEFAULT_FUEL: Partial<Record<DocVehicleType, number>> = {
  jetpack: 10,
  plane: 60,
}
const STORE_KINDS: Array<[StoreItem['kind'], string]> = [['shirt', 'shirt'], ['trail', 'trail']]
const SCRIPT_STARTER = `let wave = 0
let nextWaveAt = 1

boxcade.onStart(() => {
  boxcade.toast('Survive the waves!')
  boxcade.setVar('wave', 0)
})

boxcade.onTick((time, dt, state) => {
  if (!state.isHost || time < nextWaveAt) return
  wave += 1
  boxcade.setVar('wave', wave)
  boxcade.big('Wave ' + wave)
  const count = 2 + wave
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    boxcade.spawnBot({
      name: 'Bot ' + wave + '-' + i,
      team: 'enemy',
      skill: Math.min(1, 0.35 + wave * 0.04),
      spawns: [[Math.cos(a) * 18, 3, Math.sin(a) * 18]],
      shirt: '#e74c3c',
    })
  }
  nextWaveAt = time + Math.max(6, 16 - wave)
})
`

/** every weapon id usable in this game: built-in arsenal + the doc's customs */
function allWeaponIds(doc: GameDoc): string[] {
  const ids = Object.keys(WEAPONS)
  for (const w of doc.weapons ?? []) if (w.id && !ids.includes(w.id)) ids.push(w.id)
  return ids
}
const GRADIENTS = [
  'linear-gradient(135deg, #6a5cff, #2f81f7)',
  'linear-gradient(135deg, #06d6a0, #2f81f7)',
  'linear-gradient(135deg, #ff8c42, #e74c3c)',
  'linear-gradient(135deg, #ffd166, #ff8c42)',
  'linear-gradient(135deg, #8e9bb5, #2c2e57)',
  'linear-gradient(135deg, #fd79a8, #9b59b6)',
]

// ---- tiny DOM helpers -----------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

function btn(label: string, cls = ''): HTMLButtonElement {
  const b = el('button', ('btn small ' + cls).trim())
  b.textContent = label
  b.type = 'button'
  return b
}

function numInput(value: number, step = 0.5, onCommit: (v: number) => void): HTMLInputElement {
  const i = el('input', 'st-num') as HTMLInputElement
  i.type = 'number'
  i.step = String(step)
  i.value = String(Math.round(value * 100) / 100)
  i.addEventListener('change', () => {
    const v = parseFloat(i.value)
    if (Number.isFinite(v)) onCommit(v)
  })
  return i
}

function row(label: string, ...controls: HTMLElement[]): HTMLElement {
  const r = el('div', 'st-row')
  r.appendChild(el('label', '', label))
  const right = el('div', 'st-row-controls')
  for (const c of controls) right.appendChild(c)
  r.appendChild(right)
  return r
}

function selectInput(options: Array<[string, string]>, value: string, onCommit: (v: string) => void): HTMLSelectElement {
  const s = el('select', 'st-select') as HTMLSelectElement
  for (const [v, label] of options) {
    const o = el('option', '', label) as HTMLOptionElement
    o.value = v
    s.appendChild(o)
  }
  s.value = value
  s.addEventListener('change', () => onCommit(s.value))
  return s
}

function textInput(value: string, onCommit: (v: string) => void, placeholder = ''): HTMLInputElement {
  const i = el('input', 'st-text') as HTMLInputElement
  i.type = 'text'
  i.value = value
  i.placeholder = placeholder
  i.addEventListener('change', () => onCommit(i.value))
  i.addEventListener('focus', () => { focusGuard(true) })
  i.addEventListener('blur', () => { focusGuard(false) })
  return i
}

function storeItemIdFromName(name: string, items: StoreItem[], self = -1): string {
  const base = slugifyName(name).slice(0, 32) || 'item'
  let id = base
  let n = 2
  while (items.some((item, i) => i !== self && item.id === id)) {
    id = `${base}-${n++}`.slice(0, 40)
  }
  return id
}

function ensureServices(doc: GameDoc): NonNullable<GameDoc['services']> {
  return (doc.services = doc.services ?? {})
}

// while typing in a field, studio fly-keys must not move the camera
let focusGuardFn: (on: boolean) => void = () => {}
function focusGuard(on: boolean) { focusGuardFn(on) }

// ---- the UI ---------------------------------------------------------------

export function buildStudioUI(shell: HTMLElement, api: StudioApi, getSavedAt: () => number): { dispose(): void } {
  focusGuardFn = () => {}

  // ----- top bar -----
  const top = el('div', 'studio-top')
  const back = btn('⬅ Boxcade', 'ghost')
  back.onclick = () => { location.hash = '' }
  const nameField = textInput(api.doc.meta.name, (v) => {
    api.mutateSettings((d) => { d.meta.name = (v.trim() || 'My Studio Game').slice(0, 48) })
  })
  nameField.classList.add('st-name')
  const savedChip = el('span', 'st-saved', '')
  const partChip = el('span', 'st-chip', '')
  const buildModeB = btn('3D Build', 'ghost st-mode')
  buildModeB.title = 'Edit 3D parts, terrain, rules and world settings'
  buildModeB.onclick = () => api.setViewMode('build')
  const floorB = btn('Floor Plan', 'ghost st-mode')
  floorB.title = 'Paint this game\'s tile map and edit Text Mode'
  floorB.onclick = () => api.setViewMode('floorplan')
  const snapB = btn('', 'ghost st-snap')
  snapB.title = 'Grid snap step — click to toggle'
  const refreshSnap = () => { snapB.textContent = `Grid ${api.getSnap()}` }
  snapB.onclick = () => { api.setSnap(api.getSnap() <= 0.1 ? 0.5 : 0.1); refreshSnap() }
  const undoB = btn('↶', 'ghost')
  undoB.title = 'Undo (Ctrl+Z)'
  undoB.onclick = () => api.undo()
  const redoB = btn('↷', 'ghost')
  redoB.title = 'Redo (Ctrl+Shift+Z)'
  redoB.onclick = () => api.redo()
  const helpB = btn('?', 'ghost')
  const playB = btn('▶ Test play', '')
  playB.onclick = () => api.testPlay()
  const txtB = btn('⬇ TXT', 'ghost')
  txtB.title = 'Download this floor plan as a .txt text map'
  txtB.onclick = () => api.downloadTextmap()
  const jsonB = btn('⬇ JSON', 'ghost')
  jsonB.title = 'Download this game as a .boxcade.json file'
  jsonB.onclick = () => api.downloadJson()
  const tsB = btn('⬇ TS', 'ghost')
  tsB.title = 'Export a trusted TypeScript starter for local developer mode'
  tsB.onclick = () => api.downloadTypeScript()
  const shareB = btn('🔗 Share', 'ghost')
  shareB.onclick = async () => {
    const res = await api.share()
    api.toast(res.copied ? '🔗 Share link copied!' : '📦 Too big for a link — file downloaded')
  }
  top.append(back, nameField, partChip, buildModeB, floorB, snapB, savedChip, undoB, redoB, helpB, txtB, jsonB, tsB, playB, shareB)
  shell.appendChild(top)
  refreshSnap()

  helpB.onclick = () => {
    api.toast('Right-drag look (orbits the selected part) · scroll zoom · WASD fly (Q/E down/up) · click select · drag move · arrows nudge · R raise · PgDn lower · [ ] rotate · + − resize · F focus · Ctrl+D duplicate · Del delete')
  }

  // ----- palette (left) -----
  const palette = el('div', 'studio-palette')
  palette.appendChild(el('h3', '', 'Place'))
  const groups = new Map<string, HTMLElement>()
  const paletteButtons = new Map<HTMLButtonElement, StudioPaletteItem>()
  for (const item of STUDIO_PALETTE) {
    let g = groups.get(item.group)
    if (!g) {
      palette.appendChild(el('div', 'st-group', item.group))
      g = el('div', 'st-group-grid')
      palette.appendChild(g)
      groups.set(item.group, g)
    }
    const b = el('button', 'st-pal') as HTMLButtonElement
    b.type = 'button'
    b.append(el('span', 'st-pal-icon', item.icon), el('span', 'st-pal-label', item.label))
    b.onclick = () => {
      const arming = !b.classList.contains('armed')
      api.armPlacement(arming ? (JSON.parse(JSON.stringify(item.template)) as DocPart) : null)
      for (const ob of paletteButtons.keys()) ob.classList.remove('armed')
      if (arming) b.classList.add('armed')
    }
    paletteButtons.set(b, item)
    g.appendChild(b)
  }

  // Terrain group — does NOT arm placement; jumps to the World tab's terrain
  // section (voxel island is edited as doc settings, not placed like a part).
  palette.appendChild(el('div', 'st-group', 'Terrain'))
  const terrainGrid = el('div', 'st-group-grid')
  const terrainBtn = el('button', 'st-pal') as HTMLButtonElement
  terrainBtn.type = 'button'
  terrainBtn.append(el('span', 'st-pal-icon', '🏝'), el('span', 'st-pal-label', 'Voxel Island'))
  terrainBtn.onclick = () => {
    api.armPlacement(null)
    for (const ob of paletteButtons.keys()) ob.classList.remove('armed')
    setTab('world')
    api.toast('🏝 Terrain settings are in the World tab')
  }
  terrainGrid.appendChild(terrainBtn)
  palette.appendChild(terrainGrid)

  palette.appendChild(el('p', 'st-hint', 'Click an item, then click the world to place it. Hold Shift to keep stamping.'))
  shell.appendChild(palette)

  // ----- right side: tabs -----
  const side = el('div', 'studio-side')
  const tabs = el('div', 'st-tabs')
  const tabPart = btn('Part', 'ghost st-tab')
  const tabWorld = btn('World', 'ghost st-tab')
  const tabMode = btn('Mode', 'ghost st-tab')
  const tabLogic = btn('Logic', 'ghost st-tab')
  const tabScript = btn('Script', 'ghost st-tab')
  tabs.append(tabPart, tabWorld, tabMode, tabLogic, tabScript)
  const body = el('div', 'st-body')
  side.append(tabs, body)
  shell.appendChild(side)

  let activeTab: 'part' | 'world' | 'mode' | 'logic' | 'script' = 'part'
  let scriptExpanded = false
  // index of the custom weapon whose edit form is open (null = list only)
  let editingWeapon: number | null = null
  function setTab(t: typeof activeTab) {
    if (t !== 'world') editingWeapon = null
    if (t !== 'script') {
      scriptExpanded = false
      shell.classList.remove('script-editor-expanded')
    }
    activeTab = t
    tabPart.classList.toggle('sel', t === 'part')
    tabWorld.classList.toggle('sel', t === 'world')
    tabMode.classList.toggle('sel', t === 'mode')
    tabLogic.classList.toggle('sel', t === 'logic')
    tabScript.classList.toggle('sel', t === 'script')
    renderBody()
  }
  tabPart.onclick = () => setTab('part')
  tabWorld.onclick = () => setTab('world')
  tabMode.onclick = () => setTab('mode')
  tabLogic.onclick = () => setTab('logic')
  tabScript.onclick = () => setTab('script')

  // ----- Part properties -----
  function renderPartTab(mount: HTMLElement) {
    const i = api.selection
    const doc = api.doc
    if (i === null || !doc.parts || !doc.parts[i]) {
      mount.appendChild(el('p', 'st-hint', 'Select a part in the world (click it), or place a new one from the palette.'))
      return
    }
    const p = doc.parts[i]
    mount.appendChild(el('h3', '', `${p.kind}`))

    const setAt = (axis: 0 | 1 | 2) => (v: number) => api.mutate('move', (d) => { d.parts![i].at[axis] = v })
    mount.appendChild(row('position',
      numInput(p.at[0], 0.5, setAt(0)), numInput(p.at[1], 0.5, setAt(1)), numInput(p.at[2], 0.5, setAt(2))))

    const sized = p as Extract<DocPart, { kind: 'part' }>
    if ('size' in p && p.size) {
      const setSize = (axis: 0 | 1 | 2) => (v: number) =>
        api.mutate('resize', (d) => { (d.parts![i] as typeof sized).size![axis] = Math.max(0.1, v) })
      mount.appendChild(row('size',
        numInput(p.size[0], 0.5, setSize(0)), numInput(p.size[1], 0.5, setSize(1)), numInput(p.size[2], 0.5, setSize(2))))
    }

    if (p.kind === 'part' || p.kind === 'door' || p.kind === 'mover' || p.kind === 'button' || p.kind === 'vehicle' || p.kind === 'gravityZone' || p.kind === 'ladder') {
      const colorIn = el('input', 'st-color') as HTMLInputElement
      colorIn.type = 'color'
      colorIn.value = /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? (p.color as string) : p.kind === 'gravityZone' ? '#8a5cff' : '#9aa0a6'
      colorIn.addEventListener('change', () => api.mutate('color', (d) => { (d.parts![i] as typeof sized).color = colorIn.value }))
      mount.appendChild(row('color', colorIn))
    }
    if (p.kind === 'part' || p.kind === 'door' || p.kind === 'mover') {
      mount.appendChild(row('material', selectInput(MATERIALS.map((m) => [m, m]), (p as typeof sized).material ?? 'plastic',
        (v) => api.mutate('material', (d) => { (d.parts![i] as typeof sized).material = v }))))
    }
    // rotY is visual-only yaw — honored for the kinds the interpreter places
    // via a single slab (part, door, mover, button, portal)
    if (p.kind === 'part' || p.kind === 'door' || p.kind === 'mover' || p.kind === 'button' || p.kind === 'portal' || p.kind === 'ladder') {
      mount.appendChild(row('rotate°', numInput(((p.rotY ?? 0) * 180) / Math.PI, 15,
        (v) => api.mutate('rot', (d) => { (d.parts![i] as typeof sized).rotY = (v * Math.PI) / 180 }))))
      mount.appendChild(el('p', 'st-hint', 'Rotate/resize are visual — collision stays box-aligned. Keys: [ ] rotate · + − resize.'))
    }
    if (p.kind === 'part') {
      const collide = el('input') as HTMLInputElement
      collide.type = 'checkbox'
      collide.checked = p.collide !== false
      collide.addEventListener('change', () => api.mutate('collide', (d) => { (d.parts![i] as typeof sized).collide = collide.checked ? undefined : false }))
      mount.appendChild(row('solid', collide))
      mount.appendChild(row('bounce', numInput(p.bounce ?? 0, 4, (v) => api.mutate('bounce', (d) => { (d.parts![i] as typeof sized).bounce = v > 0 ? v : undefined }))))
      const hitboxInputs = ([0, 1, 2] as const).map((axis) => {
        const input = el('input', 'st-num') as HTMLInputElement
        input.type = 'number'
        input.step = '0.5'
        input.placeholder = String(Math.round(p.size[axis] * 100) / 100)
        input.value = p.hitbox ? String(Math.round(p.hitbox[axis] * 100) / 100) : ''
        input.addEventListener('change', () => {
          const raw = hitboxInputs.map((field) => field.value.trim())
          if (raw.every((value) => value === '')) {
            api.mutate('hitbox', (d) => { delete (d.parts![i] as typeof p).hitbox })
            return
          }
          const next = raw.map((value, idx) => (value === '' ? p.size[idx] : parseFloat(value))) as DocV3
          if (next.every((n) => Number.isFinite(n) && n > 0)) {
            api.mutate('hitbox', (d) => { (d.parts![i] as typeof p).hitbox = next })
          }
        })
        input.addEventListener('focus', () => { focusGuard(true) })
        input.addEventListener('blur', () => { focusGuard(false) })
        return input
      })
      mount.appendChild(row('hitbox', ...hitboxInputs))
      // behaviors
      const hasB = (t: string) => (p.behaviors ?? []).some((b) => b.type === t)
      const toggleB = (t: 'spin' | 'bob') => {
        api.mutate('behavior', (d) => {
          const part = d.parts![i] as typeof sized
          const list = part.behaviors ?? []
          part.behaviors = hasB(t) ? list.filter((b) => b.type !== t) : [...list, t === 'spin' ? { type: 'spin', speed: 1.4 } : { type: 'bob', amp: 0.4 }]
          if (part.behaviors.length === 0) delete part.behaviors
        })
      }
      const spinC = el('input') as HTMLInputElement
      spinC.type = 'checkbox'
      spinC.checked = hasB('spin')
      spinC.addEventListener('change', () => toggleB('spin'))
      const bobC = el('input') as HTMLInputElement
      bobC.type = 'checkbox'
      bobC.checked = hasB('bob')
      bobC.addEventListener('change', () => toggleB('bob'))
      mount.appendChild(row('spins', spinC))
      mount.appendChild(row('hovers', bobC))
    }
    if (p.kind === 'bouncePad') {
      mount.appendChild(row('power', numInput(p.power ?? 24, 2, (v) => api.mutate('power', (d) => { (d.parts![i] as typeof p).power = v }))))
    }
    if (p.kind === 'spinnerHazard') {
      mount.appendChild(row('radius', numInput(p.radius, 0.5, (v) => api.mutate('radius', (d) => { (d.parts![i] as typeof p).radius = Math.max(1, v) }))))
      mount.appendChild(row('blades', numInput(p.count ?? 3, 1, (v) => api.mutate('count', (d) => { (d.parts![i] as typeof p).count = Math.max(1, Math.round(v)) }))))
    }
    if (p.kind === 'label') {
      mount.appendChild(row('text', textInput(p.text, (v) => api.mutate('text', (d) => { (d.parts![i] as typeof p).text = v.slice(0, 80) }))))
    }
    if (p.kind === 'weaponSpawn') {
      const ids = allWeaponIds(doc)
      if (!ids.includes(p.weapon)) ids.unshift(p.weapon)
      mount.appendChild(row('weapon', selectInput(ids.map((w) => [w, w]), p.weapon,
        (v) => api.mutate('weapon', (d) => { (d.parts![i] as typeof p).weapon = v }))))
    }
    if (p.kind === 'mover') {
      const setBy = (axis: 0 | 1 | 2) => (v: number) => api.mutate('by', (d) => { (d.parts![i] as typeof p).by[axis] = v })
      mount.appendChild(row('moves by', numInput(p.by[0], 1, setBy(0)), numInput(p.by[1], 1, setBy(1)), numInput(p.by[2], 1, setBy(2))))
      mount.appendChild(row('period s', numInput(p.period ?? 4, 0.5, (v) => api.mutate('period', (d) => { (d.parts![i] as typeof p).period = Math.max(0.5, v) }))))
    }
    if (p.kind === 'light') {
      mount.appendChild(row('intensity', numInput(p.intensity ?? 90, 10, (v) => api.mutate('intensity', (d) => { (d.parts![i] as typeof p).intensity = v }))))
      mount.appendChild(row('range', numInput(p.range ?? 28, 2, (v) => api.mutate('range', (d) => { (d.parts![i] as typeof p).range = v }))))
    }
    if (p.kind === 'gravityZone') {
      mount.appendChild(row('gravity', numInput(p.gravity, 0.05,
        (v) => api.mutate('gravity-zone', (d) => {
          (d.parts![i] as typeof p).gravity = Math.min(3, Math.max(0.05, v))
        }))))
    }
    if (p.kind === 'vehicle') {
      mount.appendChild(row('type', selectInput(
        (Object.keys(VEHICLE_LABELS) as DocVehicleType[]).map((type) => [type, VEHICLE_LABELS[type]]),
        p.vehicle,
        (v) => api.mutate('vehicle-type', (d) => {
          const part = d.parts![i] as typeof p
          part.vehicle = v as DocVehicleType
          part.speed = VEHICLE_DEFAULT_SPEED[part.vehicle]
          const fuel = VEHICLE_DEFAULT_FUEL[part.vehicle]
          if (fuel !== undefined) part.fuel = fuel
          else delete part.fuel
        }),
      )))
      mount.appendChild(row('speed', numInput(p.speed ?? VEHICLE_DEFAULT_SPEED[p.vehicle], 1,
        (v) => api.mutate('vehicle-speed', (d) => {
          (d.parts![i] as typeof p).speed = Math.min(80, Math.max(1, v))
        }))))
      mount.appendChild(row('fuel', numInput(p.fuel ?? VEHICLE_DEFAULT_FUEL[p.vehicle] ?? 60, 1,
        (v) => api.mutate('vehicle-fuel', (d) => {
          (d.parts![i] as typeof p).fuel = Math.min(600, Math.max(1, v))
        }))))
    }
    if (p.kind === 'portal') {
      // target — validated live against the portal grammar (red on mismatch)
      const tgtWarn = el('p', 'st-warn', '')
      const tgtIn = textInput(p.target, (v) => {
        const t = v.trim()
        const valid = PORTAL_TARGET_RE.test(t)
        if (valid) api.mutate('portal-target', (d) => { (d.parts![i] as typeof p).target = t })
        tgtWarn.textContent = valid ? '' : 'use g:<id>, draft:<key>, level:<n>, or home'
      }, 'home')
      mount.appendChild(row('goes to', tgtIn))
      mount.appendChild(tgtWarn)
      mount.appendChild(el('p', 'st-hint', 'Targets: g:<id> (published) · draft:<key> · level:<n> · home'))
      mount.appendChild(row('label', textInput(p.label ?? '', (v) => api.mutate('portal-label', (d) => {
        const part = d.parts![i] as typeof p
        if (v.trim()) part.label = v.slice(0, 40); else delete part.label
      }), 'Portal')))
      const colorIn = el('input', 'st-color') as HTMLInputElement
      colorIn.type = 'color'
      colorIn.value = /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? (p.color as string) : '#8a5cff'
      colorIn.addEventListener('change', () => api.mutate('portal-color', (d) => { (d.parts![i] as typeof p).color = colorIn.value }))
      mount.appendChild(row('color', colorIn))
    }

    // id / tag (rules wiring)
    mount.appendChild(row('id', textInput(p.id ?? '', (v) => api.mutateSettings((d) => {
      const part = d.parts![i]
      if (v.trim()) part.id = v.trim().slice(0, 40); else delete part.id
    }), 'for rules')))
    mount.appendChild(row('tag', textInput(p.tag ?? '', (v) => api.mutateSettings((d) => {
      const part = d.parts![i]
      if (v.trim()) part.tag = v.trim().slice(0, 40); else delete part.tag
    }), 'group name')))

    const actions = el('div', 'st-actions')
    const dup = btn('⧉ Duplicate')
    dup.onclick = () => {
      const copy = JSON.parse(JSON.stringify(p)) as DocPart
      copy.at = [copy.at[0] + 2, copy.at[1], copy.at[2] + 2]
      delete copy.id
      api.mutate('duplicate', (d) => { d.parts!.push(copy) })
      api.select(api.doc.parts!.length - 1)
    }
    const del = btn('🗑 Delete', 'ghost')
    del.onclick = () => {
      api.mutate('delete', (d) => { d.parts!.splice(i, 1) })
      api.select(null)
    }
    actions.append(dup, del)
    mount.appendChild(actions)
  }

  // ----- World settings -----
  function renderWorldTab(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Game'))
    mount.appendChild(row('name', textInput(doc.meta.name, (v) => api.mutateSettings((d) => { d.meta.name = (v.trim() || 'My Studio Game').slice(0, 48) }))))
    mount.appendChild(row('emoji', textInput(doc.meta.emoji ?? '🧱', (v) => api.mutateSettings((d) => { d.meta.emoji = v.slice(0, 8) || '🧱' }))))
    mount.appendChild(row('blurb', textInput(doc.meta.blurb ?? '', (v) => api.mutateSettings((d) => { d.meta.blurb = v.slice(0, 140) }))))
    mount.appendChild(row('genre', selectInput(
      ['Obby', 'Adventure', 'Sandbox', 'Arena', 'Community'].map((g) => [g, g]),
      doc.meta.genre ?? 'Obby',
      (v) => api.mutateSettings((d) => { d.meta.genre = v }))))

    const swatches = el('div', 'st-swatches')
    for (const g of GRADIENTS) {
      const s = el('button', 'st-swatch') as HTMLButtonElement
      s.type = 'button'
      s.style.background = g
      s.classList.toggle('sel', doc.meta.gradient === g)
      s.onclick = () => api.mutateSettings((d) => { d.meta.gradient = g })
      swatches.appendChild(s)
    }
    mount.appendChild(row('card', swatches))

    mount.appendChild(el('h3', '', 'World'))
    mount.appendChild(row('lighting', selectInput(LIGHTING.map((l) => [l, l]), doc.lighting ?? 'noon', (v) => api.setLighting(v))))
    mount.appendChild(row('camera', selectInput([['orbit', 'third person'], ['fp', 'first person']], doc.camera ?? 'orbit',
      (v) => api.mutateSettings((d) => { d.camera = v as GameDoc['camera'] }))))
    mount.appendChild(row('fall kills at', numInput(doc.killY ?? -30, 5, (v) => api.mutateSettings((d) => { d.killY = v }))))

    const spawnBtn = btn('📍 Click world to set spawn')
    spawnBtn.onclick = () => { api.armSpawnPick(); api.toast('Click anywhere in the world to set the spawn point') }
    mount.appendChild(row('spawn', spawnBtn))

    mount.appendChild(el('h3', '', 'Physics'))
    mount.appendChild(row('gravity', numInput(Math.abs(doc.physics?.gravity ?? 46), 4,
      (v) => api.mutateSettings((d) => { d.physics = { ...d.physics, gravity: -Math.abs(v) } }))))
    mount.appendChild(row('jump', numInput(doc.physics?.jumpVel ?? 14.2, 1,
      (v) => api.mutateSettings((d) => { d.physics = { ...d.physics, jumpVel: v } }))))
    mount.appendChild(row('speed', numInput(doc.physics?.walkSpeed ?? 8.2, 1,
      (v) => api.mutateSettings((d) => { d.physics = { ...d.physics, walkSpeed: v } }))))
    mount.appendChild(row('fall damage', checkbox(!!doc.physics?.fallDamage, (v) => api.mutateSettings((d) => {
      const cfg = (d.physics = { ...d.physics })
      if (v) cfg.fallDamage = true
      else delete cfg.fallDamage
    }))))

    renderServicesSection(mount)
    renderCombatSection(mount)
    renderWeaponsSection(mount)
    renderTerrainSection(mount)
    renderLevelsSection(mount)

    const rt = el('input') as HTMLInputElement
    rt.type = 'checkbox'
    rt.checked = !!doc.rtReflections
    rt.addEventListener('change', () => api.mutateSettings((d) => {
      if (rt.checked) d.rtReflections = true
      else delete d.rtReflections
    }))
    mount.appendChild(el('h3', '', 'Graphics'))
    mount.appendChild(row('reflections', rt))
  }

  // ----- Combat (World tab) -----
  function checkbox(checked: boolean, onCommit: (v: boolean) => void): HTMLInputElement {
    const c = el('input') as HTMLInputElement
    c.type = 'checkbox'
    c.checked = checked
    c.addEventListener('change', () => onCommit(c.checked))
    return c
  }

  function renderServicesSection(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Services'))
    mount.appendChild(row('chat', checkbox(doc.services?.chat !== false, (v) => api.mutateSettings((d) => {
      ensureServices(d).chat = v
    }))))
    mount.appendChild(row('leaderboard', checkbox(doc.services?.leaderboard !== false, (v) => api.mutateSettings((d) => {
      ensureServices(d).leaderboard = v
    }))))

    mount.appendChild(el('p', 'st-sub', 'Store'))
    const store = doc.services?.store ?? []
    store.forEach((item, si) => {
      const name = textInput(item.name, (v) => api.mutateSettings((d) => {
        const items = ensureServices(d).store ?? []
        const next = v.slice(0, 24) || 'Item'
        items[si].name = next
        items[si].id = storeItemIdFromName(next, items, si)
      }))
      const kind = selectInput(STORE_KINDS, item.kind, (v) => api.mutateSettings((d) => {
        ;(ensureServices(d).store ?? [])[si].kind = v as StoreItem['kind']
      }))
      const color = el('input', 'st-color') as HTMLInputElement
      color.type = 'color'
      color.value = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#6a5cff'
      color.addEventListener('change', () => api.mutateSettings((d) => {
        ;(ensureServices(d).store ?? [])[si].color = color.value
      }))
      const price = numInput(item.price, 5, (v) => api.mutateSettings((d) => {
        ;(ensureServices(d).store ?? [])[si].price = Math.min(500, Math.max(1, Math.round(v)))
      }))
      const del = btn('✕', 'ghost')
      del.title = 'Remove store item'
      del.onclick = () => api.mutateSettings((d) => {
        const services = ensureServices(d)
        services.store!.splice(si, 1)
        if (services.store!.length === 0) delete services.store
      })
      mount.appendChild(row(item.id, name, kind, color, price, del))
    })

    const add = btn('＋ Store item', 'ghost')
    add.disabled = store.length >= 8
    add.onclick = () => api.mutateSettings((d) => {
      const services = ensureServices(d)
      const items = services.store ?? []
      const name = `Item ${items.length + 1}`
      const item: StoreItem = {
        id: storeItemIdFromName(name, items),
        name,
        kind: 'shirt',
        color: '#6a5cff',
        price: 25,
      }
      services.store = [...items, item]
    })
    mount.appendChild(add)
    if (store.length >= 8) mount.appendChild(el('p', 'st-warn', 'A game store can have at most 8 items.'))
  }

  /** ids of the arsenal weapons (combat.weapons); undefined = the whole arsenal */
  function arsenalIds(doc: GameDoc): string[] {
    const cfg = doc.combat
    if (!cfg?.weapons) return allWeaponIds(doc)
    return cfg.weapons.map((w) => (typeof w === 'string' ? w : w.id))
  }

  function renderCombatSection(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Combat'))
    const on = !!doc.combat
    mount.appendChild(row('enable', checkbox(on, (v) => api.mutateSettings((d) => {
      if (v) d.combat = d.combat ?? {}
      else delete d.combat
    }))))
    if (!on) {
      mount.appendChild(el('p', 'st-hint', 'Turn on combat for weapons, health and bots.'))
      return
    }

    // arsenal — which weapons exist in this game (built-in + custom)
    mount.appendChild(el('p', 'st-sub', 'Arsenal'))
    const ids = allWeaponIds(doc)
    const inArsenal = new Set(arsenalIds(doc))
    const arsenalBox = el('div', 'st-checks')
    for (const id of ids) {
      const lab = el('label', 'st-check')
      lab.append(checkbox(inArsenal.has(id), (v) => api.mutateSettings((d) => {
        const cfg = (d.combat = d.combat ?? {})
        const next = new Set(arsenalIds(d))
        if (v) next.add(id); else next.delete(id)
        cfg.weapons = ids.filter((x) => next.has(x))
        // startWeapons can't reference weapons no longer in the arsenal
        if (cfg.startWeapons) cfg.startWeapons = cfg.startWeapons.filter((s) => next.has(s))
      })), el('span', '', id))
      arsenalBox.appendChild(lab)
    }
    mount.appendChild(arsenalBox)

    // start weapons — what every player spawns holding
    mount.appendChild(el('p', 'st-sub', 'Start weapons'))
    const start = new Set(doc.combat?.startWeapons ?? [])
    const startBox = el('div', 'st-checks')
    for (const id of [...inArsenal]) {
      const lab = el('label', 'st-check')
      lab.append(checkbox(start.has(id), (v) => api.mutateSettings((d) => {
        const cfg = (d.combat = d.combat ?? {})
        const next = new Set(cfg.startWeapons ?? [])
        if (v) next.add(id); else next.delete(id)
        if (next.size === 0) delete cfg.startWeapons
        else cfg.startWeapons = [...next]
      })), el('span', '', id))
      startBox.appendChild(lab)
    }
    if (inArsenal.size === 0) startBox.appendChild(el('span', 'st-hint', 'Pick at least one arsenal weapon.'))
    mount.appendChild(startBox)

    mount.appendChild(row('health', numInput(doc.combat?.health ?? 100, 10, (v) =>
      api.mutateSettings((d) => { (d.combat = d.combat ?? {}).health = Math.max(1, Math.round(v)) }))))
    mount.appendChild(row('infinite ammo', checkbox(!!doc.combat?.infiniteAmmo, (v) =>
      api.mutateSettings((d) => {
        const cfg = (d.combat = d.combat ?? {})
        if (v) cfg.infiniteAmmo = true; else delete cfg.infiniteAmmo
      }))))
    mount.appendChild(row('your team', textInput(doc.combat?.selfTeam ?? '', (v) =>
      api.mutateSettings((d) => {
        const cfg = (d.combat = d.combat ?? {})
        const t = v.trim().slice(0, 24)
        if (t) cfg.selfTeam = t; else delete cfg.selfTeam
      }), 'e.g. red')))
  }

  // ----- Weapon designer (World tab) -----
  function renderWeaponsSection(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Weapons'))
    const weapons = doc.weapons ?? []
    if (editingWeapon !== null && weapons[editingWeapon]) {
      renderWeaponForm(mount, editingWeapon)
      return
    }
    editingWeapon = null
    if (weapons.length === 0) {
      mount.appendChild(el('p', 'st-hint', 'Design your own weapon — it appears in the arsenal and weapon pads.'))
    }
    weapons.forEach((w, wi) => {
      const r = el('div', 'st-row')
      const name = el('span', 'st-wname', `${w.icon ?? '🔫'} ${w.name}`)
      const ctrls = el('div', 'st-row-controls')
      const edit = btn('✎', 'ghost')
      edit.onclick = () => { editingWeapon = wi; renderBody() }
      const del = btn('🗑', 'ghost')
      del.onclick = () => api.mutate('weapon-del', (d) => {
        d.weapons!.splice(wi, 1)
        if (d.weapons!.length === 0) delete d.weapons
      })
      ctrls.append(edit, del)
      r.append(name, ctrls)
      mount.appendChild(r)
    })
    const add = btn('＋ New weapon', 'ghost')
    add.disabled = weapons.length >= 12
    add.onclick = () => {
      const n = weapons.length + 1
      const def: WeaponDef = { id: `my-weapon-${n}`, name: `Weapon ${n}`, icon: '🔫', kind: 'hitscan', damage: 20, fireRate: 3, sound: 'sidearm' }
      api.mutate('weapon-add', (d) => { d.weapons = [...(d.weapons ?? []), def] })
      editingWeapon = (doc.weapons?.length ?? 1) - 1
      renderBody()
    }
    mount.appendChild(add)
  }

  function renderWeaponForm(mount: HTMLElement, wi: number) {
    const doc = api.doc
    const w = doc.weapons![wi]
    const edit = (label: string, fn: (def: WeaponDef) => void) => api.mutate(label, (d) => { fn(d.weapons![wi]) })

    const head = el('div', 'st-rule-head')
    head.appendChild(el('span', 'st-rule-n', `${w.icon ?? '🔫'} ${w.name}`))
    const done = btn('✓ Done', 'ghost')
    done.onclick = () => { editingWeapon = null; renderBody() }
    head.appendChild(done)
    mount.appendChild(head)

    // id — lowercase slug, validated inline
    const idWarn = el('p', 'st-warn', '')
    const idIn = textInput(w.id, (v) => {
      const slug = v.trim().toLowerCase()
      const valid = /^[a-z0-9-]+$/.test(slug) && slug.length <= 24
      if (valid) edit('weapon-id', (def) => { def.id = slug })
      idWarn.textContent = valid ? '' : 'lowercase letters, numbers, dashes only'
    }, 'my-weapon')
    mount.appendChild(row('id', idIn))
    mount.appendChild(idWarn)

    mount.appendChild(row('name', textInput(w.name, (v) => edit('weapon-name', (def) => { def.name = v.slice(0, 24) || 'Weapon' }))))
    mount.appendChild(row('icon', textInput(w.icon ?? '🔫', (v) => edit('weapon-icon', (def) => { def.icon = v.slice(0, 8) || '🔫' }))))
    mount.appendChild(row('kind', selectInput([['hitscan', 'hitscan (beam)'], ['projectile', 'projectile']], w.kind, (v) => {
      api.mutate('weapon-kind', (d) => {
        const def = d.weapons![wi]
        def.kind = v as WeaponDef['kind']
        if (v === 'projectile' && !def.projectile) def.projectile = { speed: 40, radius: 0.16, color: '#5dff5d' }
        if (v === 'hitscan') delete def.projectile
      })
      renderBody() // swap the hitscan/projectile field set immediately
    })))

    // shared stats
    mount.appendChild(row('damage', numInput(w.damage, 5, (v) => edit('weapon-damage', (def) => { def.damage = Math.min(100, Math.max(1, v)) }))))
    mount.appendChild(row('fire rate', numInput(w.fireRate, 0.5, (v) => edit('weapon-firerate', (def) => { def.fireRate = Math.min(20, Math.max(0.1, v)) }))))
    mount.appendChild(row('pellets', numInput(w.pellets ?? 1, 1, (v) => edit('weapon-pellets', (def) => {
      const n = Math.round(v); def.pellets = n > 1 ? Math.min(12, n) : undefined
    }))))
    mount.appendChild(row('ammo max', numInput(w.ammoMax ?? 0, 5, (v) => edit('weapon-ammomax', (def) => {
      const n = Math.round(v); def.ammoMax = n > 0 ? Math.min(999, n) : undefined
    }))))
    mount.appendChild(row('ammo/pickup', numInput(w.ammoPickup ?? 0, 5, (v) => edit('weapon-ammopickup', (def) => {
      const n = Math.round(v); def.ammoPickup = n > 0 ? n : undefined
    }))))
    mount.appendChild(row('sound', selectInput(WEAPON_SOUNDS.map((s) => [s, s]), WEAPON_SOUNDS.includes(w.sound) ? w.sound : 'sidearm',
      (v) => edit('weapon-sound', (def) => { def.sound = v }))))

    if (w.kind === 'hitscan') {
      mount.appendChild(el('p', 'st-sub', 'Beam'))
      mount.appendChild(row('range', numInput(w.range ?? 120, 10, (v) => edit('weapon-range', (def) => { def.range = Math.min(400, Math.max(0, v)) }))))
      mount.appendChild(row('spread', numInput(w.spread ?? 0, 0.01, (v) => edit('weapon-spread', (def) => { def.spread = v > 0 ? v : undefined }))))
      const beamColor = el('input', 'st-color') as HTMLInputElement
      beamColor.type = 'color'
      beamColor.value = /^#[0-9a-f]{6}$/i.test(w.beamColor ?? '') ? (w.beamColor as string) : '#ffe9a8'
      beamColor.addEventListener('change', () => edit('weapon-beamcolor', (def) => { def.beamColor = beamColor.value }))
      mount.appendChild(row('beam color', beamColor))
      mount.appendChild(row('beam width', numInput(w.beamWidth ?? 0.05, 0.01, (v) => edit('weapon-beamwidth', (def) => { def.beamWidth = v > 0 ? v : undefined }))))
      mount.appendChild(row('zoom fov', numInput(w.zoomFov ?? 0, 5, (v) => edit('weapon-zoomfov', (def) => {
        def.zoomFov = v >= 8 && v <= 70 ? v : undefined
      }))))
    } else {
      mount.appendChild(el('p', 'st-sub', 'Projectile'))
      const pr = () => (w.projectile ?? { speed: 40, radius: 0.16, color: '#5dff5d' })
      const editPr = (label: string, fn: (p: NonNullable<WeaponDef['projectile']>) => void) => api.mutate(label, (d) => {
        const def = d.weapons![wi]
        def.projectile = def.projectile ?? { speed: 40, radius: 0.16, color: '#5dff5d' }
        fn(def.projectile)
      })
      mount.appendChild(row('speed', numInput(pr().speed, 5, (v) => editPr('weapon-speed', (p) => { p.speed = Math.min(120, Math.max(1, v)) }))))
      mount.appendChild(row('radius', numInput(pr().radius, 0.05, (v) => editPr('weapon-radius', (p) => { p.radius = Math.min(1, Math.max(0.05, v)) }))))
      const projColor = el('input', 'st-color') as HTMLInputElement
      projColor.type = 'color'
      projColor.value = /^#[0-9a-f]{6}$/i.test(pr().color) ? pr().color : '#5dff5d'
      projColor.addEventListener('change', () => editPr('weapon-projcolor', (p) => { p.color = projColor.value }))
      mount.appendChild(row('color', projColor))
      mount.appendChild(row('gravity', numInput(pr().gravity ?? 0, 2, (v) => editPr('weapon-gravity', (p) => { p.gravity = v !== 0 ? v : undefined }))))
      mount.appendChild(row('splash', numInput(pr().splash ?? 0, 0.5, (v) => editPr('weapon-splash', (p) => { p.splash = v > 0 ? Math.min(10, v) : undefined }))))
      mount.appendChild(row('life s', numInput(pr().life ?? 0, 0.5, (v) => editPr('weapon-life', (p) => { p.life = v > 0 ? Math.min(10, v) : undefined }))))
    }
  }

  // ----- Terrain (World tab) -----
  function renderTerrainSection(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Terrain'))
    if (!doc.voxel) {
      mount.appendChild(el('p', 'st-hint', 'Generate a procedural voxel island as the world floor.'))
    }
    const seed = doc.voxel?.seed ?? 20260609
    const size = doc.voxel?.size ?? 96
    let seedVal = seed
    let sizeVal = size
    mount.appendChild(row('seed', numInput(seed, 1, (v) => { seedVal = Math.round(v) })))
    mount.appendChild(row('size', selectInput(VOXEL_SIZES.map((s) => [String(s), String(s)]), String(size), (v) => { sizeVal = parseInt(v, 10) })))
    const genBtn = btn(doc.voxel ? '🔄 Regenerate island' : '🏝 Generate island')
    genBtn.onclick = () => {
      api.mutate('voxel', (d) => { d.voxel = { seed: seedVal, size: sizeVal } })
      api.toast('🏝 Island generated')
    }
    mount.appendChild(genBtn)
    if (doc.voxel) {
      const rm = btn('🗑 Remove terrain', 'ghost')
      rm.onclick = () => api.mutate('voxel-del', (d) => { delete d.voxel })
      mount.appendChild(rm)
    }
  }

  // ----- Levels (World tab) -----
  // Extra levels of THIS game (depth 1). Each level is another draft's body
  // copied in; reach them with a Portal or goTo rule targeting level:2 etc.
  function renderLevelsSection(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Levels'))
    mount.appendChild(el('p', 'st-hint', 'Reach levels with a Portal or goTo rule targeting level:2 etc. Level 1 is this game.'))

    const levels = doc.levels ?? []
    levels.forEach((lv, li) => {
      const name = lv.meta?.name ? `Level ${li + 2} · ${lv.meta.name}` : `Level ${li + 2}`
      const remove = btn('✕', 'ghost')
      remove.title = 'Remove this level'
      remove.onclick = () => api.mutateSettings((d) => {
        d.levels!.splice(li, 1)
        if (d.levels!.length === 0) delete d.levels
      })
      mount.appendChild(row(name, remove))
    })

    if (levels.length >= 8) {
      mount.appendChild(el('p', 'st-warn', 'A game can have at most 8 levels.'))
      return
    }

    // other drafts (exclude self) — pick one to append as the next level
    const others = listDrafts().filter((d) => d.key !== api.draftKey)
    if (others.length === 0) {
      mount.appendChild(el('p', 'st-hint', 'Make another draft in My Games to add it as a level here.'))
      return
    }
    let pick = others[0].key
    const sel = selectInput(others.map((d) => [d.key, `${d.emoji} ${d.name}`]), pick, (v) => { pick = v })
    const add = btn('＋ Add level from draft', 'ghost')
    add.onclick = () => {
      const src = loadDraft(pick)
      if (!src) { api.toast('Could not load that draft'); return }
      // deep-copy the draft's body; keep meta (inheritance fills the rest) but
      // strip nested levels — a level may not carry its own levels (depth 1).
      const body = JSON.parse(JSON.stringify(src)) as GameDoc
      delete body.levels
      api.mutateSettings((d) => { d.levels = [...(d.levels ?? []), body] })
      api.toast(`🎚 Added ${src.meta.name} as Level ${(doc.levels?.length ?? 0) + 1}`)
    }
    mount.appendChild(row('add level', sel, add))
  }

  // ----- Logic (rules + vars) -----
  const TRIGGERS: Array<[string, string]> = [
    ['start', 'game starts'],
    ['touch', 'part is touched'],
    ['coin', 'any coin collected'],
    ['timer-after', 'after N seconds'],
    ['timer-every', 'every N seconds'],
    ['varReaches', 'counter reaches'],
    ['kill', 'someone is eliminated'],
    ['checkpoint', 'checkpoint reached'],
    ['hurt', 'player gets hurt'],
  ]
  const ACTIONS: Array<[string, string]> = [
    ['toast', 'show message'],
    ['big', 'big message'],
    ['openDoor', 'open door/part'],
    ['movePart', 'move part by'],
    ['removePart', 'remove part'],
    ['win', 'you win!'],
    ['kill', 'kill player'],
    ['award', 'give coins'],
    ['givePoints', 'give points'],
    ['teleport', 'teleport player'],
    ['sound', 'play sound'],
    ['celebrate', 'celebrate'],
    ['restart', 'restart round'],
    ['addVar', 'add to counter'],
    ['setVar', 'set counter'],
  ]

  function triggerKey(t: RuleTrigger): string {
    if (t.type === 'timer') return (t as { every?: number }).every !== undefined ? 'timer-every' : 'timer-after'
    return t.type
  }

  function defaultTrigger(key: string): RuleTrigger {
    switch (key) {
      case 'touch': return { type: 'touch', part: api.partRefs()[0] ?? 'button' }
      case 'timer-after': return { type: 'timer', after: 5 }
      case 'timer-every': return { type: 'timer', every: 10 }
      case 'varReaches': return { type: 'varReaches', var: 'score', gte: 5 }
      case 'kill': return { type: 'kill' }
      case 'coin': return { type: 'coin' }
      case 'checkpoint': return { type: 'checkpoint' }
      case 'hurt': return { type: 'hurt' }
      default: return { type: 'start' }
    }
  }

  function defaultAction(key: string): RuleAction {
    switch (key) {
      case 'big': return { type: 'big', text: 'GO!' }
      case 'openDoor': return { type: 'openDoor', part: 'door' }
      case 'movePart': return { type: 'movePart', part: api.partRefs()[0] ?? 'door', by: [0, 4, 0], seconds: 1 }
      case 'removePart': return { type: 'removePart', part: api.partRefs()[0] ?? 'door' }
      case 'win': return { type: 'win' }
      case 'kill': return { type: 'kill' }
      case 'award': return { type: 'award', amount: 1 }
      case 'givePoints': return { type: 'givePoints', var: 'score', amount: 1 }
      case 'teleport': return { type: 'teleport', to: [0, 4, 0] }
      case 'sound': return { type: 'sound', name: 'win' }
      case 'celebrate': return { type: 'celebrate', text: '🎉' }
      case 'restart': return { type: 'restart' }
      case 'addVar': return { type: 'addVar', var: 'score', value: 1 }
      case 'setVar': return { type: 'setVar', var: 'score', value: 0 }
      default: return { type: 'toast', text: 'Hello!' }
    }
  }

  function partRefSelect(current: string, onCommit: (v: string) => void): HTMLElement {
    const refs = api.partRefs()
    if (refs.length === 0) return textInput(current, onCommit, 'part id/tag')
    if (!refs.includes(current)) refs.unshift(current)
    return selectInput(refs.map((r) => [r, r]), current, onCommit)
  }

  /** one DO action row inside rule `ri`, action index `ai` (rules v2) */
  function renderActionRow(ri: number, ai: number): HTMLElement {
    const a = api.doc.rules![ri].do[ai]
    const multi = api.doc.rules![ri].do.length > 1
    const doRow = el('div', 'st-rule-row')
    doRow.appendChild(el('span', 'st-kw', ai === 0 ? 'do' : 'and'))
    doRow.appendChild(selectInput(ACTIONS, a?.type ?? 'toast', (key) => {
      api.mutateSettings((d) => { d.rules![ri].do[ai] = defaultAction(key) })
      renderBody() // show the new action's fields immediately
    }))
    if (a) {
      if (a.type === 'toast' || a.type === 'big' || a.type === 'celebrate') {
        doRow.appendChild(textInput(a.text ?? '', (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).text = v.slice(0, 120) }), 'message'))
      } else if (a.type === 'openDoor' || a.type === 'removePart') {
        doRow.appendChild(partRefSelect(a.part, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).part = v })))
      } else if (a.type === 'movePart') {
        doRow.appendChild(partRefSelect(a.part, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).part = v })))
        const by = a.by ?? [0, 4, 0]
        const setBy = (axis: 0 | 1 | 2) => (v: number) => api.mutateSettings((d) => {
          const act = d.rules![ri].do[ai] as typeof a
          act.by = [...(act.by ?? [0, 4, 0])] as [number, number, number]
          act.by[axis] = v
        })
        doRow.append(numInput(by[0], 1, setBy(0)), numInput(by[1], 1, setBy(1)), numInput(by[2], 1, setBy(2)))
      } else if (a.type === 'award') {
        doRow.appendChild(numInput(a.amount ?? 1, 1, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).amount = Math.max(1, Math.round(v)) })))
      } else if (a.type === 'givePoints') {
        doRow.appendChild(textInput(a.var ?? 'score', (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).var = v || 'score' })))
        doRow.appendChild(numInput(a.amount ?? 1, 1, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).amount = v })))
      } else if (a.type === 'teleport') {
        const setTo = (axis: 0 | 1 | 2) => (v: number) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).to[axis] = v })
        doRow.append(numInput(a.to[0], 1, setTo(0)), numInput(a.to[1], 1, setTo(1)), numInput(a.to[2], 1, setTo(2)))
      } else if (a.type === 'sound') {
        doRow.appendChild(selectInput(RULE_SOUNDS.map((s) => [s, s]), a.name, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).name = v })))
      } else if (a.type === 'setVar' || a.type === 'addVar') {
        doRow.appendChild(textInput(a.var, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).var = v })))
        doRow.appendChild(numInput(a.value ?? 1, 1, (v) => api.mutateSettings((d) => { (d.rules![ri].do[ai] as typeof a).value = v })))
      }

      // per-action "everyone" toggle (RuleAction.forEveryone) + delete
      const everyone = el('label', 'st-check st-everyone')
      const cb = el('input') as HTMLInputElement
      cb.type = 'checkbox'
      cb.checked = !!a.forEveryone
      cb.addEventListener('change', () => api.mutateSettings((d) => {
        const act = d.rules![ri].do[ai]
        if (cb.checked) act.forEveryone = true; else delete act.forEveryone
      }))
      everyone.append(cb, el('span', '', 'everyone'))
      doRow.appendChild(everyone)
    }
    if (multi) {
      const del = btn('✕', 'ghost')
      del.title = 'Remove this action'
      del.onclick = () => { api.mutateSettings((d) => { d.rules![ri].do.splice(ai, 1) }); renderBody() }
      doRow.appendChild(del)
    }
    return doRow
  }

  function renderLogicTab(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Counters'))
    const vars = doc.vars ?? {}
    for (const [name, value] of Object.entries(vars)) {
      const remove = btn('✕', 'ghost')
      remove.onclick = () => api.mutateSettings((d) => {
        if (d.vars) delete d.vars[name]
        if (d.vars && Object.keys(d.vars).length === 0) delete d.vars
      })
      mount.appendChild(row(name, numInput(value, 1, (v) => api.mutateSettings((d) => { d.vars![name] = v })), remove))
    }
    const addVarB = btn('＋ counter', 'ghost')
    addVarB.onclick = () => {
      const name = `counter${Object.keys(vars).length + 1}`
      api.mutateSettings((d) => { d.vars = { ...d.vars, [name]: 0 } })
    }
    mount.appendChild(addVarB)

    mount.appendChild(el('h3', '', 'Rules'))
    mount.appendChild(el('p', 'st-hint', 'When something happens → do one or more things. Tick "everyone" to apply a world change for all players.'))

    const rules = doc.rules ?? []
    rules.forEach((rule, ri) => {
      const box = el('div', 'st-rule')
      const head = el('div', 'st-rule-head')
      head.appendChild(el('span', 'st-rule-n', `${ri + 1}`))
      const del = btn('✕', 'ghost')
      del.onclick = () => { api.mutateSettings((d) => { d.rules!.splice(ri, 1) }); renderBody() }
      head.appendChild(del)
      box.appendChild(head)

      // WHEN
      const whenRow = el('div', 'st-rule-row')
      whenRow.appendChild(el('span', 'st-kw', 'when'))
      whenRow.appendChild(selectInput(TRIGGERS, triggerKey(rule.when), (key) => {
        api.mutateSettings((d) => { d.rules![ri].when = defaultTrigger(key) })
        renderBody() // show the new trigger's fields immediately
      }))
      const w = rule.when
      if (w.type === 'touch') {
        whenRow.appendChild(partRefSelect(w.part, (v) => api.mutateSettings((d) => { (d.rules![ri].when as typeof w).part = v })))
      } else if (w.type === 'timer') {
        const isEvery = (w as { every?: number }).every !== undefined
        whenRow.appendChild(numInput(isEvery ? (w as { every?: number }).every ?? 10 : (w as { after?: number }).after ?? 5, 1, (v) =>
          api.mutateSettings((d) => { d.rules![ri].when = isEvery ? { type: 'timer', every: Math.max(0.5, v) } : { type: 'timer', after: Math.max(0, v) } })))
        whenRow.appendChild(el('span', 'st-kw', 's'))
      } else if (w.type === 'varReaches') {
        whenRow.appendChild(textInput(w.var, (v) => api.mutateSettings((d) => { (d.rules![ri].when as typeof w).var = v })))
        whenRow.appendChild(el('span', 'st-kw', '≥'))
        whenRow.appendChild(numInput(w.gte, 1, (v) => api.mutateSettings((d) => { (d.rules![ri].when as typeof w).gte = v })))
      }
      box.appendChild(whenRow)

      // DO — one row per action (rules v2: multiple actions per rule)
      rule.do.forEach((_, ai) => box.appendChild(renderActionRow(ri, ai)))

      const addAction = btn('＋ action', 'ghost')
      addAction.disabled = rule.do.length >= 6
      addAction.onclick = () => { api.mutateSettings((d) => { d.rules![ri].do.push(defaultAction('toast')) }); renderBody() }
      box.appendChild(addAction)
      mount.appendChild(box)
    })

    const addRule = btn('＋ Add rule')
    addRule.onclick = () => api.mutateSettings((d) => {
      d.rules = d.rules ?? []
      d.rules.push({ when: { type: 'start' }, do: [{ type: 'toast', text: 'Hello!' }] } as Rule)
    })
    mount.appendChild(addRule)
  }

  function renderScriptTab(mount: HTMLElement) {
    const doc = api.doc
    mount.appendChild(el('h3', '', 'Script'))
    mount.appendChild(el('p', 'st-hint', 'Scripts run in a sandbox and can control HUD, vars, parts, bots, teams and game flow. Players are asked before a scripted draft or share link runs.'))
    if (doc.studio?.scriptManaged) {
      mount.appendChild(el('p', 'st-mode-note', `Managed by ${STUDIO_MODE_LABELS[getStudioMode(doc)]} Mode. Edit settings in the Mode tab, or switch Mode to Custom before hand-editing.`))
    }

    const enabled = !!doc.script?.trim()
    mount.appendChild(row('enable', checkbox(enabled, (v) => api.mutateSettings((d) => {
      if (v) {
        d.v = Math.max(d.v, 2)
        d.script = d.script?.trim() || SCRIPT_STARTER
      } else {
        delete d.script
      }
    }))))

    if (!enabled) {
      const add = btn('＋ Add starter script', 'ghost')
      add.onclick = () => api.mutateSettings((d) => {
        d.v = Math.max(d.v, 2)
        d.script = SCRIPT_STARTER
      })
      mount.appendChild(add)
      renderScriptReference(mount)
      return
    }

    const editor = el('div', 'st-code-editor')
    const codeHead = el('div', 'st-code-head')
    const status = el('span', 'st-code-status')
    const validate = btn('Validate', 'ghost')
    const expand = btn(scriptExpanded ? 'Collapse' : 'Expand', 'ghost')
    expand.onclick = () => {
      scriptExpanded = !scriptExpanded
      shell.classList.toggle('script-editor-expanded', scriptExpanded)
      renderBody()
    }
    codeHead.append(status, expand, validate)
    editor.appendChild(codeHead)
    const area = el('textarea', 'st-script') as HTMLTextAreaElement
    area.spellcheck = false
    area.value = doc.script ?? ''
    editor.appendChild(area)
    const analysisMount = el('div')
    const refreshAnalysis = (announce = false) => {
      const chars = area.value.length
      const lines = area.value ? area.value.split(/\r?\n/).length : 0
      const analysis = analyzeStudioScript(area.value)
      const result = analysis.errors.length ? `${analysis.errors.length} errors` : analysis.warnings.length ? `${analysis.warnings.length} warnings` : 'valid'
      status.textContent = `${result} · ${lines} lines · ${chars} chars`
      analysisMount.innerHTML = ''
      renderScriptAnalysis(analysisMount, area.value)
      if (announce) {
        api.toast(analysis.errors.length ? `Script has ${analysis.errors.length} errors` : analysis.warnings.length ? `Script has ${analysis.warnings.length} warnings` : 'Script validation passed')
        analysisMount.scrollIntoView({ block: 'nearest' })
      }
    }
    validate.onclick = () => refreshAnalysis(true)
    area.addEventListener('input', () => refreshAnalysis(false))
    area.addEventListener('focus', () => { focusGuard(true) })
    area.addEventListener('blur', () => {
      focusGuard(false)
      api.mutateSettings((d) => {
        d.v = Math.max(d.v, 2)
        d.script = area.value.slice(0, 64 * 1024)
      })
    })
    mount.appendChild(editor)

    const controls = el('div', 'st-actions')
    const wave = btn('Wave example', 'ghost')
    wave.onclick = () => {
      area.value = SCRIPT_STARTER
      refreshAnalysis(false)
      api.mutateSettings((d) => { d.v = Math.max(d.v, 2); d.script = SCRIPT_STARTER })
    }
    const clear = btn('Clear script', 'ghost')
    clear.onclick = () => api.mutateSettings((d) => {
      delete d.script
      if (d.studio) d.studio.scriptManaged = false
    })
    controls.append(wave, clear)
    mount.appendChild(controls)
    mount.appendChild(analysisMount)
    refreshAnalysis(false)
    renderScriptReference(mount)
  }

  function renderModeTab(mount: HTMLElement) {
    const doc = api.doc
    const mode = getStudioMode(doc)
    const settings = getStudioModeSettings(doc, mode)
    mount.appendChild(el('h3', '', 'Game Mode'))
    mount.appendChild(el('p', 'st-hint', 'Mode Builder generates normal Boxcade parts, combat settings, vars, rules and sandbox scripts. Your own placed parts stay untouched.'))

    mount.appendChild(row('mode', selectInput(STUDIO_MODE_OPTIONS, mode, (v) => {
      const next = v as StudioGameMode
      api.mutateSettings((d) => { applyStudioMode(d, next, undefined) })
    })))

    if (mode === 'custom') {
      mount.appendChild(el('p', 'st-mode-note', 'Custom keeps the current draft as-is. Use World, Logic and Script tabs directly, or choose a preset to generate a full game loop.'))
      renderScriptAnalysis(mount, doc.script ?? '')
      return
    }

    for (const control of STUDIO_MODE_CONTROLS[mode]) {
      mount.appendChild(renderModeControl(mode, settings, control))
    }

    const controls = el('div', 'st-actions')
    const regen = btn('Regenerate mode')
    regen.onclick = () => {
      api.mutateSettings((d) => { applyStudioMode(d, mode, settings) })
      api.toast(`${STUDIO_MODE_LABELS[mode]} mode regenerated`)
    }
    const custom = btn('Make custom', 'ghost')
    custom.onclick = () => api.mutateSettings((d) => {
      d.studio = { ...(d.studio ?? {}), schema: 1, mode: 'custom', settings: {}, scriptManaged: false }
    })
    controls.append(regen, custom)
    mount.appendChild(controls)

    const analysis = analyzeStudioScript(doc.script ?? '')
    mount.appendChild(el('p', 'st-mode-note', `${STUDIO_MODE_LABELS[mode]} owns ${doc.parts?.filter((p) => p.tag === 'mode_managed' || p.id?.startsWith('mode_')).length ?? 0} generated parts and ${analysis.capabilities.length} script capabilities.`))
    renderScriptAnalysis(mount, doc.script ?? '')
  }

  function renderModeControl(mode: StudioGameMode, settings: Record<string, unknown>, control: ModeControl): HTMLElement {
    const commit = (value: unknown) => api.mutateSettings((d) => {
      const next = getStudioModeSettings(d, mode)
      next[control.key] = value
      applyStudioMode(d, mode, next)
    })
    if (control.kind === 'number') {
      return row(control.label, numInput(Number(settings[control.key] ?? 0), control.step ?? 1, (v) => commit(v)))
    }
    if (control.kind === 'checkbox') {
      return row(control.label, checkbox(Boolean(settings[control.key]), (v) => commit(v)))
    }
    return row(control.label, selectInput(control.options ?? [], String(settings[control.key] ?? ''), (v) => commit(v)))
  }

  function renderScriptAnalysis(mount: HTMLElement, script: string) {
    const analysis = analyzeStudioScript(script)
    if (!script.trim()) return
    const box = el('div', 'st-analysis')
    const titleText = analysis.errors.length
      ? 'Script has errors'
      : analysis.warnings.length
        ? 'Script has warnings'
        : 'Script check passed'
    const title = el('div', 'st-analysis-title', titleText)
    box.appendChild(title)
    if (analysis.capabilities.length) box.appendChild(el('p', '', `Uses: ${analysis.capabilities.join(', ')}`))
    for (const e of analysis.errors) box.appendChild(el('p', 'st-warn', e))
    for (const w of analysis.warnings) box.appendChild(el('p', 'st-hint', w))
    mount.appendChild(box)
  }

  function renderScriptReference(mount: HTMLElement) {
    const ref = el('details', 'st-api-ref') as HTMLDetailsElement
    ref.open = false
    ref.appendChild(el('summary', '', 'Sandbox API reference'))
    ref.appendChild(el('p', 'st-hint', 'Validated against the documented Worker sandbox: no DOM, network, storage, imports, or raw engine objects.'))
    const list = el('div', 'st-api-list')
    for (const entry of SCRIPT_API) {
      const item = el('button', 'st-api-item') as HTMLButtonElement
      item.type = 'button'
      item.title = entry.desc
      item.append(el('code', '', entry.signature), el('span', '', entry.desc))
      item.onclick = () => navigator.clipboard?.writeText(entry.signature).catch(() => {})
      list.appendChild(item)
    }
    ref.appendChild(list)
    ref.appendChild(el('p', 'st-sub', 'Entity proxy'))
    const entities = el('div', 'st-api-list')
    for (const entry of SCRIPT_ENTITY_API) {
      const item = el('div', 'st-api-item')
      item.append(el('code', '', entry.signature), el('span', '', entry.desc))
      entities.appendChild(item)
    }
    ref.appendChild(entities)
    mount.appendChild(ref)
  }

  // ----- render cycle -----
  let lastSelection: number | null = null

  function renderBody() {
    body.innerHTML = ''
    if (activeTab === 'part') renderPartTab(body)
    else if (activeTab === 'world') renderWorldTab(body)
    else if (activeTab === 'mode') renderModeTab(body)
    else if (activeTab === 'logic') renderLogicTab(body)
    else renderScriptTab(body)
  }

  function refreshSavedChip() {
    const at = getSavedAt()
    savedChip.textContent = at ? '✓ saved' : ''
    const n = api.doc.parts?.length ?? 0
    partChip.textContent = `${n} ${n === 1 ? 'part' : 'parts'}`
  }

  api.onChange(() => {
    refreshSavedChip()
    buildModeB.classList.toggle('sel', api.viewMode === 'build')
    floorB.classList.toggle('sel', api.viewMode === 'floorplan')
    if (!api.armed) for (const b of paletteButtons.keys()) b.classList.remove('armed')
    if (nameField !== document.activeElement) nameField.value = api.doc.meta.name
    // selecting a part jumps to its properties
    if (api.selection !== lastSelection) {
      lastSelection = api.selection
      if (api.selection !== null && activeTab !== 'part') { setTab('part'); return }
    }
    if (document.activeElement && body.contains(document.activeElement)) return // don't yank focus while typing
    renderBody()
  })

  setTab('part')
  refreshSavedChip()

  return {
    dispose() { /* listeners die with the DOM; nothing global to detach */ },
  }
}
