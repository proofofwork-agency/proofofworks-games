// Generates src/maps/facing-towers.txt — the two-towers arena CTF map.
// Two facing towers on an asteroid bridge in space, 4 layers (ground,
// two tower floors, roof). Run: node scripts/generate-face.mjs

import { writeFileSync } from 'node:fs'

const COLS = 21
const ROWS = 61
const T = { redTop: 0, redBot: 8, blueTop: 52, blueBot: 60 } // tower row ranges
const TW = { left: 6, right: 14 } // tower col range
const BRIDGE = { left: 8, right: 12 }

const grid = (fill = '.') => Array.from({ length: ROWS }, () => Array(COLS).fill(fill))
const layers = [grid(), grid(), grid(), grid()]

const set = (l, r, c, ch) => {
  if (r >= 0 && r < ROWS && c >= 0 && c < COLS) layers[l][r][c] = ch
}

function tower(top, bot, team) {
  const gateRow = team === 'red' ? bot : top
  const innerTop = top + 1
  const innerBot = bot - 1

  // ---- L0: walls + interior ----
  for (let r = top; r <= bot; r++) {
    for (let c = TW.left; c <= TW.right; c++) {
      const edge = r === top || r === bot || c === TW.left || c === TW.right
      if (!edge) continue
      const corner = (r === top || r === bot) && (c === TW.left || c === TW.right)
      set(0, r, c, corner ? '6' : '5')
    }
  }
  // gate opening (3 wide, on the bridge side)
  for (const c of [9, 10, 11]) set(0, gateRow, c, '#')
  // interior floor
  for (let r = innerTop; r <= innerBot; r++) {
    for (let c = TW.left + 1; c <= TW.right - 1; c++) set(0, r, c, '#')
  }
  // flag stand at the heart of the tower
  const mid = Math.floor((top + bot) / 2)
  set(0, mid, 10, team === 'red' ? 'F' : 'f')
  // glowing floor strips light the hall
  for (const [r, c] of [[innerTop, 9], [innerTop, 11], [innerBot, 9], [innerBot, 11], [mid, 7], [mid, 13]]) {
    if (layers[0][r][c] === '#') set(0, r, c, 'N')
  }
  // team spawns
  for (const [r, c] of [[innerTop + 1, 8], [innerTop + 1, 12], [innerBot - 1, 8], [innerBot - 1, 12]]) {
    set(0, r, c, team === 'red' ? 'r' : 'b')
  }
  // stairs to floor 2 along the west interior wall (ascend away from the gate)
  const stairs = team === 'red'
    ? [[innerBot - 1, '1'], [innerBot - 2, '2'], [innerBot - 3, '3'], [innerBot - 4, '4']]
    : [[innerTop + 1, '1'], [innerTop + 2, '2'], [innerTop + 3, '3'], [innerTop + 4, '4']]
  for (const [r, ch] of stairs) set(0, r, TW.left + 1, ch)

  // ---- L1 (+4): second floor, center atrium open, window over the gate ----
  for (let r = top; r <= bot; r++) {
    for (let c = TW.left; c <= TW.right; c++) {
      const hole = r >= mid - 1 && r <= mid + 1 && c >= 9 && c <= 11
      const window = r === gateRow && c >= 9 && c <= 11
      if (!hole && !window) set(1, r, c, '#')
    }
  }
  // stairs to floor 3 along the east wall
  const stairs2 = team === 'red'
    ? [[innerBot - 1, '1'], [innerBot - 2, '2'], [innerBot - 3, '3'], [innerBot - 4, '4']]
    : [[innerTop + 1, '1'], [innerTop + 2, '2'], [innerTop + 3, '3'], [innerTop + 4, '4']]
  for (const [r, ch] of stairs2) set(1, r, TW.right - 1, ch)

  // ---- L2 (+8): third floor, smaller hole, window again ----
  for (let r = top; r <= bot; r++) {
    for (let c = TW.left; c <= TW.right; c++) {
      const hole = r === mid && c === 10
      const window = r === gateRow && c >= 9 && c <= 11
      if (!hole && !window) set(2, r, c, '#')
    }
  }
  set(2, mid, 7, 'N')
  set(2, mid, 13, 'N')
  const stairs3 = team === 'red'
    ? [[innerBot - 1, '1'], [innerBot - 2, '2'], [innerBot - 3, '3'], [innerBot - 4, '4']]
    : [[innerTop + 1, '1'], [innerTop + 2, '2'], [innerTop + 3, '3'], [innerTop + 4, '4']]
  for (const [r, ch] of stairs3) set(2, r, TW.left + 1, ch)

  // ---- L3 (+12): sniper roof with crenellations + health ----
  for (let r = top; r <= bot; r++) {
    for (let c = TW.left; c <= TW.right; c++) {
      const edge = r === top || r === bot || c === TW.left || c === TW.right
      if (edge) {
        // alternating battlements, but keep the bridge-facing edge low for sniping
        set(3, r, c, (r + c) % 2 === 0 && r !== gateRow ? '1' : '#')
      } else {
        set(3, r, c, '#')
      }
    }
  }
  set(3, mid, 10, 'H')

  // ---- stairwell openings: carve the floor above each staircase ----
  const stairRows = team === 'red'
    ? [innerBot - 1, innerBot - 2, innerBot - 3, innerBot - 4]
    : [innerTop + 1, innerTop + 2, innerTop + 3, innerTop + 4]
  for (const r of stairRows) {
    set(1, r, TW.left + 1, '.')   // above L0 stairs (west wall)
    set(2, r, TW.right - 1, '.')  // above L1 stairs (east wall)
    set(3, r, TW.left + 1, '.')   // above L2 stairs (west wall)
  }
}

tower(T.redTop, T.redBot, 'red')
tower(T.blueTop, T.blueBot, 'blue')

// ---- the bridge: neon-railed metal spine (M = reflective deck plates) ----
for (let r = T.redBot + 1; r < T.blueTop; r++) {
  for (let c = BRIDGE.left; c <= BRIDGE.right; c++) {
    set(0, r, c, c === BRIDGE.left || c === BRIDGE.right ? 'N' : 'M')
  }
}
// wider diamonds at the quarter points + middle
for (const center of [20, 30, 40]) {
  for (let dr = -2; dr <= 2; dr++) {
    const span = 2 - Math.abs(dr)
    for (let dc = -(2 + span); dc <= 2 + span; dc++) {
      const c = 10 + dc
      const r = center + dr
      if (layers[0][r][c] === '.') set(0, r, c, '#')
    }
  }
}
// pickups along the spine
set(0, 15, 10, 'C'); set(0, 25, 10, 'C'); set(0, 35, 10, 'C'); set(0, 45, 10, 'C')
set(0, 20, 10, 'H'); set(0, 40, 10, 'H')
set(0, 30, 10, 'B') // mid-bridge bounce pad — escape route or trick jumps
set(0, 30, 6, 'C'); set(0, 30, 14, 'C')

const header = `// ============================================================
//  FACING TOWERS — two towers, one bridge, deep space — built from scratch
//  (two towers, one bridge, deep space). All geometry + names are
//  Blobcade originals. Generated by scripts/generate-face.mjs.
// ============================================================
@lighting space
@cell 2
@layerstep 4
@killy -22
@gravity 18
@jump 12.5
@speed 9.5
`

const body = layers
  .map((g, i) => (i === 0 ? '' : '---\n') + g.map((row) => row.join('')).join('\n'))
  .join('\n')

writeFileSync(new URL('../src/maps/facing-towers.txt', import.meta.url), header + '\n' + body + '\n')
console.log('wrote src/maps/facing-towers.txt')
