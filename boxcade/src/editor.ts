// The Boxcade floor-plan painter. The 2D tile-grid painter is now a mountable
// COMPONENT (mountFloorPlan) that edits a single textmap string through a small
// host-supplied port (getTextmap / setTextmap / onClose). The Studio mounts it
// as an in-world overlay so painting tiles rebuilds the 3D view live; the
// standalone #/editor route mounts the SAME component wrapped with the GameDoc
// meta form + no-code "Game Logic" rules panel + share/test/download actions.
//
// The text map is still the world format; in standalone mode it's wrapped in
// { boxcade:'gamedoc', v:1, meta, camera, textmap, rules }.
//
// Standalone draft lifecycle (#/editor):
//   - #/editor?draft=<key>  → edits that draft (loadDraft)
//   - #/editor (no param)   → continues the LAST-edited draft if one exists
//                             (key in localStorage 'boxcade.editor.lastDraft'),
//                             otherwise starts a fresh unsaved draft.
//   - first save assigns a key (saveDraft(null,…)), which we remember in
//     lastDraft and reflect into the hash so reloads stay on the same draft.
//   - one-time migration: a legacy STORE_KEY text map with no drafts yet is
//     wrapped into a real draft so old work is never lost.
//   - every change auto-saves (debounced) to the draft AND write-throughs the
//     bare text map to CUSTOM_MAP_KEY, so the old #/play/custom-map still works.

import './editor-extra.css'
import { parseTextMap, serializeTextMap, type ParsedTextMap } from './sdk/textmap'
import {
  validateGameDoc, encodeGameDoc, slugifyName, SHARE_LINK_LIMIT,
  type GameDoc, type Rule, type RuleAction, RULE_SOUNDS,
} from './sdk'
import { saveDraft, loadDraft, listDrafts } from './drafts'
import castleRaw from './maps/castle.txt?raw'
import faceRaw from './maps/facing-towers.txt?raw'

const STORE_KEY = 'boxcade.editor.map'
const LAST_DRAFT_KEY = 'boxcade.editor.lastDraft'
export const CUSTOM_MAP_KEY = 'boxcade.customMap'

interface TileInfo { ch: string; name: string; color: string; text?: string }

const TILES: TileInfo[] = [
  { ch: '.', name: 'Erase', color: '#10151c' },
  { ch: '#', name: 'Stone', color: '#9aa0a6' },
  { ch: 'G', name: 'Grass', color: '#6cc04a' },
  { ch: 'O', name: 'Planks', color: '#c89c62' },
  { ch: 'X', name: 'Brick', color: '#b5564e' },
  { ch: 'I', name: 'Ice', color: '#bfeaff' },
  { ch: 'N', name: 'Neon', color: '#59f7d2' },
  { ch: 'M', name: 'Metal deck', color: '#46525f' },
  { ch: 'L', name: 'Lava', color: '#ff5a1f' },
  { ch: 'B', name: 'Bounce', color: '#06d6a0' },
  { ch: 'C', name: 'Coin', color: '#ffc94d' },
  { ch: 'T', name: 'Tree', color: '#3f9e35' },
  { ch: 'K', name: 'Checkpoint', color: '#39d98a' },
  { ch: 'D', name: 'Door', color: '#8a5a2b' },
  { ch: 'P', name: 'Button plate', color: '#ffd166' },
  { ch: 'S', name: 'Spawn', color: '#a8ff9e' },
  { ch: 'W', name: 'Win pad', color: '#ffd700' },
  { ch: 'H', name: 'Health', color: '#37d67a' },
  { ch: 'A', name: 'Ammo crate', color: '#caa64b' },
  { ch: 'F', name: 'Red flag', color: '#ff4d4d' },
  { ch: 'f', name: 'Blue flag', color: '#4d8bff' },
  { ch: 'r', name: 'Red spawn', color: '#7d3b3b' },
  { ch: 'b', name: 'Blue spawn', color: '#39517d' },
  { ch: '1', name: 'Wall ×1', color: '#75797e' },
  { ch: '2', name: 'Wall ×2', color: '#7e8287' },
  { ch: '3', name: 'Wall ×3', color: '#878b90' },
  { ch: '4', name: 'Wall ×4', color: '#8f9398' },
  { ch: '6', name: 'Tower ×6', color: '#a0a4a9' },
  { ch: '9', name: 'Tower ×9', color: '#b2b6bb' },
]
const tileColor = new Map(TILES.map((t) => [t.ch, t.color]))
for (const d of '5789') tileColor.set(d, '#999da2')
// tooltips for the less-obvious tiles
const TILE_TIPS: Record<string, string> = {
  D: 'Gate block rules can open (tag "door"). Pair with a P button + an "open the door" rule.',
  P: 'Pressure plate — touching it fires "button is touched" rules (tag "button").',
}

const DEFAULT_MAP = `@lighting noon
@cell 2

........................
........................
....GGGGGGGGGGGGGGGG....
....GGGGGGGGGGGGGGGG....
....GGGGGGS GGGGGGGG....
....GGGGGGGGGGGGGGGG....
....GGGGGGGGGGGGGGGG....
........................
........................
`.replace('S ', 'SG')

const GENRES = ['Obby', 'Adventure', 'Sandbox', 'Arena', 'Custom']

const GRADIENTS = [
  'linear-gradient(135deg, #06d6a0, #2f81f7)',
  'linear-gradient(135deg, #f97316, #ef4444)',
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #0ea5e9, #22d3ee)',
  'linear-gradient(135deg, #facc15, #f97316)',
  'linear-gradient(135deg, #1f2937, #4b5563)',
]

/** the starter floor the painter shows when there is no textmap yet */
const STARTER_TEXTMAP = '@lighting noon\n\n' +
  Array.from({ length: 6 }, () => 'GGGGGGGGGG').join('\n') + '\n'

// ---- the no-code rule vocabulary the panel exposes (a curated v0 subset) ----

interface WhenOpt { id: string; label: string; param?: 'after' | 'every' }
const WHEN_OPTS: WhenOpt[] = [
  { id: 'start', label: 'game starts' },
  { id: 'touch:button', label: 'button is touched' },
  { id: 'touch:door', label: 'door is touched' },
  { id: 'coin', label: 'any coin collected' },
  { id: 'timer:after', label: 'after N seconds', param: 'after' },
  { id: 'timer:every', label: 'every N seconds', param: 'every' },
]

interface DoOpt { id: string; label: string; param?: 'text' | 'amount' | 'sound'; hint?: string }
const DO_OPTS: DoOpt[] = [
  { id: 'toast', label: 'show message', param: 'text' },
  { id: 'big', label: 'big message', param: 'text' },
  { id: 'openDoor', label: 'open the door', hint: 'Place a D door tile + a P button tile, then add a "button is touched" rule.' },
  { id: 'win', label: 'you win!' },
  { id: 'kill', label: 'kill player' },
  { id: 'award', label: 'give coins', param: 'amount' },
  { id: 'sound', label: 'play sound', param: 'sound' },
]

/** map a stored Rule back to the WHEN option id the dropdown should show */
function whenIdOf(rule: Rule): string {
  const w = rule.when
  if (w.type === 'touch') return w.part === 'door' ? 'touch:door' : 'touch:button'
  if (w.type === 'timer') return w.every !== undefined ? 'timer:every' : 'timer:after'
  return w.type // 'start' | 'coin'
}

/** map a stored action back to the DO option id the dropdown should show */
function doIdOf(action: RuleAction): string {
  return action.type
}

// ===========================================================================
//  mountFloorPlan — the reusable 2D tile-grid painter component
//
//  Renders the tile palette + grid canvas + floor/layer bar + W/H inputs +
//  the live textarea (the map file) into `host`. It owns ONLY the textmap; it
//  reads the initial source via opts.getTextmap() (falling back to a starter
//  grid) and pushes every paint/resize/edit back through opts.setTextmap(),
//  debounced. opts.onClose() is called when the user dismisses it (the Studio
//  overlay hides; standalone wires it to "back to Boxcade").
//
//  Panning: left-drag paints, right-drag erases, and SPACE+drag OR
//  middle-mouse-drag pans the (scrollable) grid viewport. The grid lives in an
//  overflow:auto wrap so big maps stay usable; the cursor shows grab/grabbing
//  while space is held.
// ===========================================================================

export interface FloorPlanPort {
  /** current textmap source for this doc (undefined → start a fresh grid) */
  getTextmap(): string | undefined
  /** persist an edited textmap source (host decides how: draft, doc-op, …) */
  setTextmap(src: string): void
  /** the user dismissed the painter (close button / Esc) */
  onClose(): void
  /** optional label shown in the painter header (defaults to a generic one) */
  title?: string
}

export interface FloorPlanHandle {
  /** tear down listeners + clear the host */
  dispose(): void
  /** re-read getTextmap() and repaint (e.g. after an external undo) */
  refresh(): void
}

export function mountFloorPlan(host: HTMLElement, opts: FloorPlanPort): FloorPlanHandle {
  let parsed: ParsedTextMap
  try {
    parsed = parseTextMap(opts.getTextmap() || STARTER_TEXTMAP)
  } catch {
    parsed = parseTextMap(STARTER_TEXTMAP)
  }
  normalize(parsed)

  let activeLayer = 0
  let brush = '#'
  let painting = false
  let panning = false
  let spaceDown = false
  let panStart = { x: 0, y: 0, left: 0, top: 0 }
  let disposed = false

  host.innerHTML = `
    <div class="fp-root">
      <div class="fp-side">
        <div class="fp-head">
          <span class="fp-title"></span>
          <button class="btn small ghost fp-close" id="fpClose" title="Close the floor plan (Esc)">✕ Close</button>
        </div>
        <div class="ed-section">Tiles</div>
        <div class="ed-palette" id="fpPalette"></div>
        <div class="ed-section">World settings</div>
        <div class="ed-fields" id="fpFields"></div>
        <select id="fpTemplate" class="ed-select">
          <option value="">Load template…</option>
          <option value="blank">Blank meadow</option>
          <option value="castle">Castle Run</option>
          <option value="face">Facing Towers</option>
        </select>
      </div>
      <div class="fp-center">
        <div class="ed-layerbar" id="fpLayers"></div>
        <div class="ed-canvas-wrap" id="fpCanvasWrap"><canvas id="fpCanvas"></canvas></div>
        <div class="ed-sizebar">
          <label>W <input id="fpW" type="number" min="4" max="120" /></label>
          <label>H <input id="fpH" type="number" min="4" max="120" /></label>
          <span class="ed-hint">left-drag paint · right-drag erase · Space-drag or middle-drag to pan · lower floor shows ghosted</span>
        </div>
        <textarea id="fpText" class="ed-text" spellcheck="false"></textarea>
        <div class="ed-sizebar">
          <button class="btn small ghost" id="fpApply">⤴ Apply text to grid</button>
          <span class="ed-hint">the textarea IS the map file — paste any Boxcade map here</span>
        </div>
      </div>
    </div>`

  const $ = (id: string) => host.querySelector('#' + id) as HTMLElement
  const canvas = $('fpCanvas') as HTMLCanvasElement
  const canvasWrap = $('fpCanvasWrap') as HTMLElement
  const g = canvas.getContext('2d')!
  const textArea = $('fpText') as HTMLTextAreaElement
  ;(host.querySelector('.fp-title') as HTMLElement).textContent = opts.title ?? '🗺 Floor plan — tiles & layers'

  // ---- palette ----
  const paletteEl = $('fpPalette')
  for (const t of TILES) {
    const b = document.createElement('button')
    b.className = 'ed-tile' + (t.ch === brush ? ' sel' : '')
    if (TILE_TIPS[t.ch]) b.title = TILE_TIPS[t.ch]
    const sw = document.createElement('span')
    sw.className = 'sw'
    sw.style.background = t.color
    const code = document.createElement('code')
    code.textContent = t.ch === '.' ? '·' : t.ch
    b.appendChild(sw)
    b.append(t.name + ' ')
    b.appendChild(code)
    b.onclick = () => {
      brush = t.ch
      paletteEl.querySelectorAll('.ed-tile').forEach((x) => x.classList.remove('sel'))
      b.classList.add('sel')
    }
    paletteEl.appendChild(b)
  }

  // ---- world settings fields ----
  const fieldsEl = $('fpFields')
  const fieldDefs: Array<{ key: string; label: string; kind: 'select' | 'number'; opts?: string[]; ph?: string }> = [
    { key: 'lighting', label: 'Lighting', kind: 'select', opts: ['', 'noon', 'morning', 'goldenHour', 'night', 'space'] },
    { key: 'gravity', label: 'Gravity', kind: 'number', ph: '46' },
    { key: 'jump', label: 'Jump power', kind: 'number', ph: '14' },
    { key: 'speed', label: 'Walk speed', kind: 'number', ph: '8' },
    { key: 'cell', label: 'Tile size (m)', kind: 'number', ph: '2' },
    { key: 'layerstep', label: 'Floor height', kind: 'number', ph: '4' },
    { key: 'killy', label: 'Kill height', kind: 'number', ph: '-20' },
  ]
  for (const f of fieldDefs) {
    const row = document.createElement('label')
    row.className = 'ed-field'
    row.textContent = f.label
    let inp: HTMLInputElement | HTMLSelectElement
    if (f.kind === 'select') {
      inp = document.createElement('select')
      for (const o of f.opts!) {
        const op = document.createElement('option')
        op.value = o
        op.textContent = o || '(default)'
        inp.appendChild(op)
      }
      ;(inp as HTMLSelectElement).value = parsed.directives[f.key] ?? ''
    } else {
      inp = document.createElement('input')
      inp.type = 'number'
      inp.placeholder = f.ph ?? ''
      inp.value = parsed.directives[f.key] ?? ''
    }
    inp.addEventListener('change', () => {
      const v = (inp as HTMLInputElement).value.trim()
      if (v === '') delete parsed.directives[f.key]
      else parsed.directives[f.key] = v
      if (f.key === 'cell') parsed.cell = parseFloat(v) || 2
      if (f.key === 'layerstep') parsed.layerStep = parseFloat(v) || 4
      sync()
    })
    row.appendChild(inp)
    fieldsEl.appendChild(row)
  }

  function refreshFields() {
    const inputs = fieldsEl.querySelectorAll('input, select')
    fieldDefs.forEach((f, i) => {
      const inp = inputs[i] as HTMLInputElement | HTMLSelectElement
      if (inp) inp.value = parsed.directives[f.key] ?? ''
    })
  }

  // ---- layers ----
  function renderLayerBar() {
    const bar = $('fpLayers')
    bar.innerHTML = ''
    parsed.layers.forEach((_, i) => {
      const b = document.createElement('button')
      b.className = 'ed-layer' + (i === activeLayer ? ' sel' : '')
      b.textContent = i === 0 ? 'Ground' : `Floor ${i + 1} (+${parsed.layerOffsets[i]})`
      b.onclick = () => {
        activeLayer = i
        renderLayerBar()
        draw()
      }
      bar.appendChild(b)
    })
    const add = document.createElement('button')
    add.className = 'ed-layer add'
    add.textContent = '+ floor'
    add.onclick = () => {
      const { rows, cols } = dims()
      parsed.layers.push(Array.from({ length: rows }, () => '.'.repeat(cols)))
      parsed.layerOffsets.push(parsed.layerOffsets[parsed.layerOffsets.length - 1] + parsed.layerStep)
      activeLayer = parsed.layers.length - 1
      renderLayerBar()
      sync()
    }
    bar.appendChild(add)
    if (parsed.layers.length > 1) {
      const del = document.createElement('button')
      del.className = 'ed-layer del'
      del.textContent = '✕ remove top'
      del.onclick = () => {
        parsed.layers.pop()
        parsed.layerOffsets.pop()
        activeLayer = Math.min(activeLayer, parsed.layers.length - 1)
        renderLayerBar()
        sync()
      }
      bar.appendChild(del)
    }
  }

  function dims() {
    const rows = Math.max(...parsed.layers.map((l) => l.length), 1)
    const cols = Math.max(...parsed.layers.flatMap((l) => l.map((r) => r.length)), 1)
    return { rows, cols }
  }

  function setCell(layer: number, r: number, c: number, ch: string) {
    const rows = parsed.layers[layer]
    while (rows.length <= r) rows.push('')
    const line = rows[r].padEnd(c + 1, '.')
    rows[r] = line.slice(0, c) + ch + line.slice(c + 1)
  }

  // ---- canvas ----
  // big maps stay usable: the grid renders at a comfortable cell size inside an
  // overflow:auto wrap (pan/scroll), instead of shrinking tiles to fit.
  function cellPx() {
    const { rows, cols } = dims()
    const max = Math.max(cols, rows)
    // shrink only for small maps to fill the pane; clamp to a usable size so
    // large maps stay legible and scroll instead
    return Math.max(14, Math.min(30, Math.floor(720 / Math.max(max, 1))))
  }

  function draw() {
    const { rows, cols } = dims()
    const px = cellPx()
    canvas.width = cols * px
    canvas.height = rows * px
    g.fillStyle = '#0a0f16'
    g.fillRect(0, 0, canvas.width, canvas.height)

    const paint = (layer: number, alpha: number) => {
      g.globalAlpha = alpha
      const grid = parsed.layers[layer]
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          const ch = grid[r][c]
          if (ch === '.' || ch === ' ' || ch === undefined) continue
          g.fillStyle = tileColor.get(ch) ?? '#ff00ff'
          g.fillRect(c * px + 1, r * px + 1, px - 2, px - 2)
          if (px >= 14 && !'#G'.includes(ch)) {
            g.fillStyle = 'rgba(0,0,0,0.55)'
            g.font = `${px - 7}px monospace`
            g.fillText(ch, c * px + px * 0.3, r * px + px * 0.75)
          }
        }
      }
      g.globalAlpha = 1
    }
    if (activeLayer > 0) paint(activeLayer - 1, 0.22)
    paint(activeLayer, 1)

    // grid lines
    g.strokeStyle = 'rgba(255,255,255,0.06)'
    for (let c = 0; c <= cols; c++) {
      g.beginPath(); g.moveTo(c * px, 0); g.lineTo(c * px, rows * px); g.stroke()
    }
    for (let r = 0; r <= rows; r++) {
      g.beginPath(); g.moveTo(0, r * px); g.lineTo(cols * px, r * px); g.stroke()
    }
  }

  function cellFromEvent(e: MouseEvent): { r: number; c: number } | null {
    const rect = canvas.getBoundingClientRect()
    const { rows, cols } = dims()
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols)
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows)
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null
    return { r, c }
  }

  function paintAt(e: MouseEvent, erase: boolean) {
    const cell = cellFromEvent(e)
    if (!cell) return
    setCell(activeLayer, cell.r, cell.c, erase ? '.' : brush)
    draw()
    queueSyncText()
  }

  // ---- panning (space-drag / middle-drag scrolls the canvas wrap) ----
  function startPan(e: MouseEvent) {
    panning = true
    panStart = { x: e.clientX, y: e.clientY, left: canvasWrap.scrollLeft, top: canvasWrap.scrollTop }
    canvasWrap.classList.add('grabbing')
  }
  function doPan(e: MouseEvent) {
    canvasWrap.scrollLeft = panStart.left - (e.clientX - panStart.x)
    canvasWrap.scrollTop = panStart.top - (e.clientY - panStart.y)
  }

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault()
    // middle-mouse OR space-held → pan; never paints
    if (e.button === 1 || spaceDown) { startPan(e); return }
    painting = true
    paintAt(e, e.button === 2)
  })
  canvas.addEventListener('mousemove', (e) => {
    if (panning) { doPan(e); return }
    if (painting) paintAt(e, (e.buttons & 2) !== 0)
  })
  const onWindowMouseUp = () => {
    if (panning) {
      panning = false
      canvasWrap.classList.remove('grabbing')
    }
    if (painting) {
      painting = false
      sync()
    }
  }
  window.addEventListener('mouseup', onWindowMouseUp)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // Space toggles the grab cursor + arms panning (without scrolling the page).
  // Ignore Space while a field is focused so typing in W/H/textarea is normal.
  const isFieldFocused = () => {
    const a = document.activeElement
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (disposed) return
    if (e.key === ' ' && !isFieldFocused()) {
      e.preventDefault()
      spaceDown = true
      canvasWrap.classList.add('grab')
    } else if (e.key === 'Escape') {
      opts.onClose()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      spaceDown = false
      canvasWrap.classList.remove('grab')
    }
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // ---- size inputs ----
  const wInp = $('fpW') as HTMLInputElement
  const hInp = $('fpH') as HTMLInputElement
  function refreshSizeInputs() {
    const { rows, cols } = dims()
    wInp.value = String(cols)
    hInp.value = String(rows)
  }
  function resizeTo(cols: number, rows: number) {
    cols = Math.max(4, Math.min(120, cols))
    rows = Math.max(4, Math.min(120, rows))
    parsed.layers = parsed.layers.map((grid) => {
      const out: string[] = []
      for (let r = 0; r < rows; r++) {
        out.push((grid[r] ?? '').padEnd(cols, '.').slice(0, cols))
      }
      return out
    })
    sync()
  }
  wInp.addEventListener('change', () => resizeTo(parseInt(wInp.value, 10) || 24, dims().rows))
  hInp.addEventListener('change', () => resizeTo(dims().cols, parseInt(hInp.value, 10) || 24))

  // ---- text sync (push the serialized map back through the port) ----
  let syncTimer = 0
  function queueSyncText() {
    window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      const src = serializeTextMap(parsed)
      textArea.value = src
      opts.setTextmap(src)
    }, 120)
  }
  function sync() {
    normalize(parsed)
    refreshSizeInputs()
    renderLayerBar()
    draw()
    const src = serializeTextMap(parsed)
    textArea.value = src
    opts.setTextmap(src)
  }
  ;($('fpApply') as HTMLButtonElement).onclick = () => {
    try {
      parsed = parseTextMap(textArea.value)
      normalize(parsed)
      activeLayer = Math.min(activeLayer, parsed.layers.length - 1)
      refreshFields()
      sync()
    } catch {
      // bad paste — keep the previous grid; the textarea retains the user's text
    }
  }

  ;($('fpClose') as HTMLButtonElement).onclick = () => opts.onClose()

  ;($('fpTemplate') as HTMLSelectElement).onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value
    const src = v === 'castle' ? castleRaw : v === 'face' ? faceRaw : v === 'blank' ? DEFAULT_MAP : null
    if (src) {
      parsed = parseTextMap(src)
      normalize(parsed)
      activeLayer = 0
      refreshFields()
      sync()
    }
    ;(e.target as HTMLSelectElement).value = ''
  }

  sync()

  return {
    dispose() {
      disposed = true
      window.clearTimeout(syncTimer)
      window.removeEventListener('mouseup', onWindowMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      host.innerHTML = ''
    },
    refresh() {
      try {
        parsed = parseTextMap(opts.getTextmap() || STARTER_TEXTMAP)
      } catch {
        parsed = parseTextMap(STARTER_TEXTMAP)
      }
      normalize(parsed)
      activeLayer = Math.min(activeLayer, parsed.layers.length - 1)
      refreshFields()
      refreshSizeInputs()
      renderLayerBar()
      draw()
      textArea.value = serializeTextMap(parsed)
    },
  }
}

// ===========================================================================
//  renderEditor — the standalone #/editor route.
//
//  A thin wrapper that owns the whole GameDoc draft (meta form + no-code
//  "Game Logic" rules + share/test/download + autosave) and embeds the
//  mountFloorPlan painter for the tile grid. The painter pushes textmap edits
//  back here via setTextmap → scheduleSave; meta/rules live only here (the
//  Studio owns its own copies in the intertwined flow).
// ===========================================================================

export function renderEditor(app: HTMLElement): { dispose(): void } {
  app.className = ''

  // ---- resolve which draft we're editing (see lifecycle note up top) ----
  const hashQuery = location.hash.split('?')[1] ?? ''
  const draftParam = new URLSearchParams(hashQuery).get('draft')

  let draftKey: string | null = null
  let doc: GameDoc | null = null

  if (draftParam) {
    doc = loadDraft(draftParam)
    if (doc) draftKey = draftParam
  }
  if (!doc) {
    const last = localStorage.getItem(LAST_DRAFT_KEY)
    if (last) {
      const d = loadDraft(last)
      if (d) { doc = d; draftKey = last }
    }
  }
  if (!doc) doc = migrateLegacyOrNew()

  // normalize the doc's working shape (these always exist while editing)
  doc.camera = doc.camera ?? 'orbit'
  doc.meta = doc.meta ?? { name: 'My Game' }
  if (!doc.meta.gradient) doc.meta.gradient = GRADIENTS[0]
  doc.rules = doc.rules ?? []
  if (!doc.textmap) doc.textmap = DEFAULT_MAP

  let rulesCollapsed = false

  app.innerHTML = `
    <div class="editor">
      <div class="ed-top">
        <button class="hud-home" id="edHome">⬅ Boxcade</button>
        <h2>🗺 Game Editor <span class="ed-sub-title">2D floor plan — tiles &amp; layers</span></h2>
        <div class="ed-actions">
          <button class="btn small" id="edTest">▶ Test play</button>
          <button class="btn small ghost" id="edStudio" title="Same game, full 3D: add parts, weapons, terrain and logic on top of this floor plan">🧱 Open in Studio</button>
          <button class="btn small ghost" id="edShare">🔗 Copy share link</button>
          <button class="btn small ghost" id="edJson">⬇ Download .boxcade.json</button>
          <button class="btn small ghost" id="edDownload">⬇ Download .txt</button>
          <span class="ed-status" id="edStatus"></span>
        </div>
      </div>
      <div class="ed-meta" id="edMeta"></div>
      <div class="ed-main">
        <div class="ed-floorplan" id="edFloorPlan"></div>
        <div class="ed-rules" id="edRules"></div>
      </div>
    </div>`

  const $ = (id: string) => document.getElementById(id)!
  const statusEl = $('edStatus')

  function setStatus(msg: string, warn = false) {
    statusEl.textContent = msg
    statusEl.classList.toggle('warn', warn)
  }

  // ---- meta form ----
  const metaEl = $('edMeta')
  function metaField(cls: string, label: string, node: HTMLElement): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'ed-meta-field ' + cls
    wrap.textContent = label
    wrap.appendChild(node)
    return wrap
  }
  const nameInp = document.createElement('input')
  nameInp.maxLength = 48
  nameInp.value = doc.meta.name || 'My Game'
  nameInp.placeholder = 'My Game'
  nameInp.addEventListener('input', () => {
    doc!.meta.name = nameInp.value.slice(0, 48)
    scheduleSave()
  })
  const emojiInp = document.createElement('input')
  emojiInp.maxLength = 8
  emojiInp.value = doc.meta.emoji ?? '🗺'
  emojiInp.addEventListener('input', () => {
    doc!.meta.emoji = emojiInp.value || undefined
    scheduleSave()
  })
  const genreSel = document.createElement('select')
  for (const gName of GENRES) {
    const op = document.createElement('option')
    op.value = gName
    op.textContent = gName
    genreSel.appendChild(op)
  }
  genreSel.value = GENRES.includes(doc.meta.genre ?? '') ? (doc.meta.genre as string) : 'Obby'
  doc.meta.genre = genreSel.value
  genreSel.addEventListener('change', () => { doc!.meta.genre = genreSel.value; scheduleSave() })
  const blurbInp = document.createElement('input')
  blurbInp.maxLength = 140
  blurbInp.value = doc.meta.blurb ?? ''
  blurbInp.placeholder = 'One-line description'
  blurbInp.addEventListener('input', () => {
    doc!.meta.blurb = blurbInp.value.slice(0, 140) || undefined
    scheduleSave()
  })
  const gradWrap = document.createElement('div')
  gradWrap.className = 'ed-gradients'
  function refreshGradSel() {
    gradWrap.querySelectorAll('.ed-grad-sw').forEach((el) => {
      el.classList.toggle('sel', (el as HTMLElement).dataset.grad === doc!.meta.gradient)
    })
  }
  for (const grad of GRADIENTS) {
    const sw = document.createElement('button')
    sw.type = 'button'
    sw.className = 'ed-grad-sw'
    sw.dataset.grad = grad
    sw.style.background = grad
    sw.title = 'Card background'
    sw.onclick = () => { doc!.meta.gradient = grad; refreshGradSel(); scheduleSave() }
    gradWrap.appendChild(sw)
  }
  metaEl.appendChild(metaField('name', 'Name', nameInp))
  metaEl.appendChild(metaField('emoji', 'Icon', emojiInp))
  metaEl.appendChild(metaField('genre', 'Genre', genreSel))
  metaEl.appendChild(metaField('grad', 'Card', gradWrap))
  metaEl.appendChild(metaField('blurb', 'Blurb', blurbInp))
  refreshGradSel()

  // ---- the floor-plan painter (owns doc.textmap) ----
  const floorPlan = mountFloorPlan($('edFloorPlan') as HTMLElement, {
    title: '🗺 Floor plan — tiles & layers',
    getTextmap: () => doc!.textmap,
    setTextmap: (src) => { doc!.textmap = src; scheduleSave() },
    onClose: () => { location.hash = '' },
  })

  // ---- rules panel ("Game Logic") ----
  const rulesEl = $('edRules')

  /** read the WHEN/DO dropdowns + params back into a Rule, or null if invalid */
  function readRuleRow(row: HTMLElement): Rule | null {
    const whenSel = row.querySelector('.rule-when') as HTMLSelectElement
    const doSel = row.querySelector('.rule-do') as HTMLSelectElement
    const whenOpt = WHEN_OPTS.find((o) => o.id === whenSel.value)
    const doOpt = DO_OPTS.find((o) => o.id === doSel.value)
    if (!whenOpt || !doOpt) return null

    let when: Rule['when']
    if (whenOpt.id === 'start') when = { type: 'start' }
    else if (whenOpt.id === 'coin') when = { type: 'coin' }
    else if (whenOpt.id === 'touch:button') when = { type: 'touch', part: 'button' }
    else if (whenOpt.id === 'touch:door') when = { type: 'touch', part: 'door' }
    else {
      const n = Math.max(0, parseFloat((row.querySelector('.rule-when-param') as HTMLInputElement)?.value) || 0)
      when = whenOpt.param === 'every' ? { type: 'timer', every: n } : { type: 'timer', after: n }
    }

    let action: RuleAction
    if (doOpt.param === 'text') {
      const text = (row.querySelector('.rule-do-param') as HTMLInputElement)?.value ?? ''
      action = doOpt.id === 'big' ? { type: 'big', text } : { type: 'toast', text }
    } else if (doOpt.param === 'amount') {
      const amount = Math.max(1, Math.round(parseFloat((row.querySelector('.rule-do-param') as HTMLInputElement)?.value) || 1))
      action = { type: 'award', amount }
    } else if (doOpt.param === 'sound') {
      const name = (row.querySelector('.rule-do-param') as HTMLSelectElement)?.value || RULE_SOUNDS[0]
      action = { type: 'sound', name }
    } else if (doOpt.id === 'openDoor') {
      action = { type: 'openDoor', part: 'door' }
    } else if (doOpt.id === 'win') {
      action = { type: 'win' }
    } else {
      action = { type: 'kill' }
    }
    return { when, do: [action] }
  }

  /** rebuild a row's WHEN-param / DO-param widgets to match the dropdowns */
  function refreshRuleParams(row: HTMLElement, rule: Rule) {
    const whenSel = row.querySelector('.rule-when') as HTMLSelectElement
    const doSel = row.querySelector('.rule-do') as HTMLSelectElement
    const whenParamBox = row.querySelector('.rule-when-box') as HTMLElement
    const doParamBox = row.querySelector('.rule-do-box') as HTMLElement
    const hintEl = row.querySelector('.ed-rule-hint') as HTMLElement
    const whenOpt = WHEN_OPTS.find((o) => o.id === whenSel.value)
    const doOpt = DO_OPTS.find((o) => o.id === doSel.value)

    whenParamBox.innerHTML = ''
    if (whenOpt?.param) {
      const inp = document.createElement('input')
      inp.className = 'rule-when-param'
      inp.type = 'number'
      inp.min = '0'
      inp.placeholder = 'seconds'
      const w = rule.when
      inp.value = w.type === 'timer' ? String((whenOpt.param === 'every' ? w.every : w.after) ?? 3) : '3'
      inp.addEventListener('input', commitRules)
      whenParamBox.appendChild(inp)
    }

    doParamBox.innerHTML = ''
    const act = rule.do[0]
    if (doOpt?.param === 'text') {
      const inp = document.createElement('input')
      inp.className = 'rule-do-param'
      inp.maxLength = 120
      inp.placeholder = 'message text'
      inp.value = act && (act.type === 'toast' || act.type === 'big') ? act.text : ''
      inp.addEventListener('input', commitRules)
      doParamBox.appendChild(inp)
    } else if (doOpt?.param === 'amount') {
      const inp = document.createElement('input')
      inp.className = 'rule-do-param'
      inp.type = 'number'
      inp.min = '1'
      inp.placeholder = 'coins'
      inp.value = act && act.type === 'award' ? String(act.amount ?? 1) : '1'
      inp.addEventListener('input', commitRules)
      doParamBox.appendChild(inp)
    } else if (doOpt?.param === 'sound') {
      const sel = document.createElement('select')
      sel.className = 'rule-do-param'
      for (const s of RULE_SOUNDS) {
        const op = document.createElement('option')
        op.value = s
        op.textContent = s
        sel.appendChild(op)
      }
      sel.value = act && act.type === 'sound' ? act.name : RULE_SOUNDS[0]
      sel.addEventListener('change', commitRules)
      doParamBox.appendChild(sel)
    }
    hintEl.textContent = doOpt?.hint ?? ''
  }

  function makeRuleRow(rule: Rule): HTMLElement {
    const row = document.createElement('div')
    row.className = 'ed-rule'

    const whenLine = document.createElement('div')
    whenLine.className = 'ed-rule-line'
    const whenLead = document.createElement('span')
    whenLead.className = 'lead'
    whenLead.textContent = 'When'
    const whenSel = document.createElement('select')
    whenSel.className = 'rule-when'
    for (const o of WHEN_OPTS) {
      const op = document.createElement('option')
      op.value = o.id
      op.textContent = o.label
      whenSel.appendChild(op)
    }
    whenSel.value = whenIdOf(rule)
    whenLine.appendChild(whenLead)
    whenLine.appendChild(whenSel)

    const whenBox = document.createElement('div')
    whenBox.className = 'rule-when-box ed-rule-param'

    const doLine = document.createElement('div')
    doLine.className = 'ed-rule-line'
    const doLead = document.createElement('span')
    doLead.className = 'lead'
    doLead.textContent = 'Do'
    const doSel = document.createElement('select')
    doSel.className = 'rule-do'
    for (const o of DO_OPTS) {
      const op = document.createElement('option')
      op.value = o.id
      op.textContent = o.label
      doSel.appendChild(op)
    }
    doSel.value = doIdOf(rule.do[0])
    doLine.appendChild(doLead)
    doLine.appendChild(doSel)

    const doBox = document.createElement('div')
    doBox.className = 'rule-do-box ed-rule-param'

    const hint = document.createElement('div')
    hint.className = 'ed-rule-hint'

    const del = document.createElement('button')
    del.className = 'ed-rule-del'
    del.textContent = '✕ delete'
    del.onclick = () => {
      row.remove()
      commitRules()
    }

    // changing a dropdown re-derives params from a fresh rule of that shape
    whenSel.addEventListener('change', () => {
      const fresh = readRuleRow(row)
      if (fresh) refreshRuleParams(row, fresh)
      commitRules()
    })
    doSel.addEventListener('change', () => {
      const fresh = readRuleRow(row)
      if (fresh) refreshRuleParams(row, fresh)
      commitRules()
    })

    row.appendChild(whenLine)
    row.appendChild(whenBox)
    row.appendChild(doLine)
    row.appendChild(doBox)
    row.appendChild(hint)
    row.appendChild(del)
    refreshRuleParams(row, rule)
    return row
  }

  /** collect every row → doc.rules, validate, save, and surface errors inline */
  function commitRules() {
    const rows = Array.from(rulesEl.querySelectorAll('.ed-rule')) as HTMLElement[]
    const rules: Rule[] = []
    for (const row of rows) {
      const r = readRuleRow(row)
      if (r) rules.push(r)
    }
    doc!.rules = rules
    scheduleSave()
  }

  function renderRulesPanel() {
    rulesEl.className = 'ed-rules' + (rulesCollapsed ? ' collapsed' : '')
    rulesEl.innerHTML = ''

    const head = document.createElement('div')
    head.className = 'ed-rules-head'
    const toggle = document.createElement('button')
    toggle.className = 'ed-rules-toggle'
    toggle.textContent = rulesCollapsed ? '⚙' : '⟨'
    toggle.title = 'Toggle Game Logic'
    toggle.onclick = () => { rulesCollapsed = !rulesCollapsed; renderRulesPanel() }
    const title = document.createElement('h3')
    title.textContent = '⚙ Game Logic'
    head.appendChild(title)
    head.appendChild(toggle)
    rulesEl.appendChild(head)

    if (rulesCollapsed) return

    const body = document.createElement('div')
    body.className = 'ed-rules-body'

    const note = document.createElement('div')
    note.className = 'ed-rules-note'
    note.textContent = 'Each rule is one trigger → one action. Add more rules for more actions.'
    body.appendChild(note)

    for (const rule of doc!.rules!) body.appendChild(makeRuleRow(rule))

    const add = document.createElement('button')
    add.className = 'ed-rule-add'
    add.textContent = '+ Add rule'
    add.onclick = () => {
      const fresh: Rule = { when: { type: 'start' }, do: [{ type: 'toast', text: 'Hello!' }] }
      doc!.rules!.push(fresh)
      body.insertBefore(makeRuleRow(fresh), add)
      commitRules()
    }
    body.appendChild(add)

    const errBox = document.createElement('p')
    errBox.className = 'ed-err'
    errBox.id = 'edRuleErr'
    body.appendChild(errBox)

    rulesEl.appendChild(body)
  }

  // ---- build the working GameDoc + validation ----

  /** assemble the live doc from textmap + meta + rules */
  function buildDoc(): GameDoc {
    const out: GameDoc = {
      boxcade: 'gamedoc',
      v: 1,
      meta: { ...doc!.meta, name: (doc!.meta.name || 'My Game').slice(0, 48) },
      camera: 'orbit',
      textmap: doc!.textmap,
      rules: doc!.rules && doc!.rules.length > 0 ? doc!.rules : undefined,
    }
    return out
  }

  /** validate; render rule errors inline (small red text). returns ok-ness */
  function validateAndShow(built: GameDoc): boolean {
    const res = validateGameDoc(built)
    const errBox = document.getElementById('edRuleErr')
    if (errBox) errBox.textContent = res.ok ? '' : res.errors.slice(0, 4).join(' · ')
    return res.ok
  }

  // ---- save (debounced auto-save to the draft + write-throughs) ----
  let saveTimer = 0
  function scheduleSave() {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveNow, 250)
  }
  function saveNow() {
    const built = buildDoc()
    const ok = validateAndShow(built)
    // always keep the raw textmap working copies (legacy + recovery)
    const text = built.textmap ?? ''
    localStorage.setItem(STORE_KEY, text)
    localStorage.setItem(CUSTOM_MAP_KEY, text)
    if (!ok) return // never persist an invalid GameDoc as the draft
    draftKey = saveDraft(draftKey, built)
    localStorage.setItem(LAST_DRAFT_KEY, draftKey)
    doc = built
    doc.meta.gradient = doc.meta.gradient ?? GRADIENTS[0]
    // reflect the assigned key in the hash so reload stays on this draft
    const want = `#/editor?draft=${draftKey}`
    if (location.hash !== want && location.hash.startsWith('#/editor')) {
      history.replaceState(null, '', want)
    }
  }
  /** force-save synchronously (used right before navigating to play) */
  function saveImmediate(): string | null {
    window.clearTimeout(saveTimer)
    const built = buildDoc()
    if (!validateAndShow(built)) {
      setStatus('Fix the highlighted problems before playing.', true)
      return null
    }
    const text = built.textmap ?? ''
    localStorage.setItem(STORE_KEY, text)
    localStorage.setItem(CUSTOM_MAP_KEY, text)
    draftKey = saveDraft(draftKey, built)
    localStorage.setItem(LAST_DRAFT_KEY, draftKey)
    doc = built
    doc.meta.gradient = doc.meta.gradient ?? GRADIENTS[0]
    return draftKey
  }

  // ---- actions ----
  ;($('edHome') as HTMLButtonElement).onclick = () => { location.hash = '' }
  // same draft, other tool: the Studio renders this floor plan in 3D and
  // layers parts/weapons/terrain/logic on top
  ;($('edStudio') as HTMLButtonElement).onclick = () => {
    const key = saveImmediate()
    if (key) location.hash = `#/studio/${key}`
  }
  ;($('edTest') as HTMLButtonElement).onclick = () => {
    const key = saveImmediate()
    if (!key) return
    // Esc → Leave brings the player back here (the draft param survives history)
    location.hash = `#/play/draft/${key}`
  }
  ;($('edShare') as HTMLButtonElement).onclick = async () => {
    const key = saveImmediate()
    if (!key || !doc) return
    setStatus('Building link…')
    try {
      const payload = await encodeGameDoc(doc)
      if (payload.length <= SHARE_LINK_LIMIT) {
        const url = `${location.origin}${location.pathname}#/play/d/${payload}`
        await navigator.clipboard.writeText(url)
        setStatus('Link copied!')
      } else {
        setStatus('Too big for a link — downloading a file instead', true)
        downloadJson()
      }
    } catch (err) {
      setStatus('Could not build a link: ' + (err instanceof Error ? err.message : err), true)
    }
  }
  function downloadJson() {
    if (!doc) return
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slugifyName(doc.meta.name)}.boxcade.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  ;($('edJson') as HTMLButtonElement).onclick = () => {
    if (!saveImmediate()) return
    downloadJson()
  }
  ;($('edDownload') as HTMLButtonElement).onclick = () => {
    const blob = new Blob([doc!.textmap ?? ''], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slugifyName(doc!.meta.name)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  renderRulesPanel()
  // first paint shouldn't shout "Fix problems"; just persist whatever loaded
  saveNow()

  return {
    dispose() {
      window.clearTimeout(saveTimer)
      floorPlan.dispose()
      saveNow()
      app.innerHTML = ''
    },
  }
}

/**
 * One-time migration / new-draft factory. If a legacy STORE_KEY text map exists
 * and the draft library is still empty, wrap it into a real draft so nobody
 * loses their old map. Otherwise hand back a fresh in-memory GameDoc.
 */
function migrateLegacyOrNew(): GameDoc {
  const legacy = localStorage.getItem(STORE_KEY)
  if (legacy && legacy.trim() !== '' && listDrafts().length === 0) {
    return {
      boxcade: 'gamedoc',
      v: 1,
      meta: { name: 'My Game', emoji: '🗺', genre: 'Obby', gradient: GRADIENTS[0] },
      camera: 'orbit',
      textmap: legacy,
      rules: [],
    }
  }
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: { name: 'My Game', emoji: '🗺', genre: 'Obby', gradient: GRADIENTS[0] },
    camera: 'orbit',
    textmap: DEFAULT_MAP,
    rules: [],
  }
}

/** pad all layers to a consistent rectangle */
function normalize(parsed: ParsedTextMap) {
  const rows = Math.max(...parsed.layers.map((l) => l.length), 4)
  const cols = Math.max(...parsed.layers.flatMap((l) => l.map((r) => r.length)), 4)
  parsed.layers = parsed.layers.map((grid) => {
    const out: string[] = []
    for (let r = 0; r < rows; r++) out.push((grid[r] ?? '').padEnd(cols, '.').slice(0, cols))
    return out
  })
  if (parsed.layers.length === 0) parsed.layers.push(Array.from({ length: rows }, () => '.'.repeat(cols)))
}
