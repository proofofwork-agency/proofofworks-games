// The P1 parity proof: Castle Run rebuilt as a pure-data GameDoc must place
// the exact same world as the hand-written TS game. The doc inlines the same
// castle.txt the real game imports, so the proof tracks the map forever.

import { describe, it, expect } from 'vitest'
import castleRun from '../src/games/castle-run'
import castleMap from '../src/maps/castle.txt?raw'
import { buildGameFromDoc, GameDocError } from '../src/sdk/interpret'
import { validateGameDoc } from '../src/sdk/gamedoc'
import { WEAPONS } from '../src/engine/combat'
import { EventBus } from '../src/engine/events'
import { makeRecordingBuilder, type LogEntry } from './helpers/recording-builder'

const castleDoc = {
  blobcade: 'gamedoc' as const,
  v: 1,
  meta: {
    id: 'castle-run-doc',
    name: 'Castle Run',
    blurb: 'A whole castle drawn in one text file. Cross the moat, climb the battlements, take the keep.',
    emoji: '🏰',
    gradient: 'linear-gradient(135deg, #8e9bb5 0%, #5d6df1 60%, #2c2e57 100%)',
    genre: 'Text-map · Adventure',
  },
  camera: 'orbit' as const,
  rtReflections: true,
  textmap: castleMap,
  parts: [
    { kind: 'label', at: [0, 17, -10], text: '🏰 CASTLE RUN', scale: 1.4 },
    { kind: 'label', at: [0, 14.8, -10], text: 'drawn in castle.txt', scale: 0.7, color: '#c9d4ff' },
    { kind: 'cloud', at: [-26, 22, -20], scale: 1.2 },
    { kind: 'cloud', at: [24, 26, 6], scale: 0.9 },
    { kind: 'cloud', at: [8, 30, -34], scale: 1.4 },
  ],
  rules: [
    {
      when: { type: 'start' },
      do: [{ type: 'toast', text: 'Cross the moat, climb the wall stairs, bounce onto the keep!' }],
    },
  ],
}

const positionsOf = (log: LogEntry[], verb: string) =>
  log
    .filter((e) => e.verb === verb)
    .map((e) => e.at as { x: number; y: number; z: number })
    .map((p) => [p.x, p.y, p.z] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])

const countBy = (log: LogEntry[]) => {
  const counts: Record<string, number> = {}
  for (const e of log) counts[e.verb] = (counts[e.verb] ?? 0) + 1
  return counts
}

describe('castle-run GameDoc parity', () => {
  it('is a valid GameDoc (and survives JSON round-trip)', () => {
    expect(validateGameDoc(castleDoc).ok).toBe(true)
    const round = JSON.parse(JSON.stringify(castleDoc))
    const res = validateGameDoc(round)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([])
  })

  it('interprets with the right meta and systems', () => {
    const def = buildGameFromDoc(castleDoc)
    expect(def.meta.name).toBe('Castle Run')
    expect(def.meta.id).toBe('castle-run-doc')
    expect(def.camera).toBe('orbit')
    expect(def.rtReflections).toBe(true)
    expect(def.systems?.length).toBe(1)
    expect(def.systems?.[0].id).toBe('gamedoc-rules')
  })

  it('places the identical world', () => {
    const real = makeRecordingBuilder()
    castleRun.build(real.builder)

    const doc = makeRecordingBuilder()
    buildGameFromDoc(castleDoc).build(doc.builder)

    const realCounts = countBy(real.log)
    const docCounts = countBy(doc.log)
    expect(docCounts).toEqual(realCounts)

    // every solid part lands in exactly the same place
    expect(positionsOf(doc.log, 'add')).toEqual(positionsOf(real.log, 'add'))
    expect(positionsOf(doc.log, 'coin')).toEqual(positionsOf(real.log, 'coin'))
    expect(positionsOf(doc.log, 'lava')).toEqual(positionsOf(real.log, 'lava'))
    expect(positionsOf(doc.log, 'tree')).toEqual(positionsOf(real.log, 'tree'))
    expect(positionsOf(doc.log, 'cloud')).toEqual(positionsOf(real.log, 'cloud'))

    // same lighting + killY (both come from the embedded textmap directives)
    expect(doc.log.find((e) => e.verb === 'lighting')).toEqual(real.log.find((e) => e.verb === 'lighting'))
    expect(doc.log.find((e) => e.verb === 'killY')).toEqual(real.log.find((e) => e.verb === 'killY'))

    // labels match including text
    const labels = (log: LogEntry[]) => log.filter((e) => e.verb === 'label').map((e) => e.text).sort()
    expect(labels(doc.log)).toEqual(labels(real.log))
  })

  it('throws GameDocError with friendly lines on invalid docs', () => {
    try {
      buildGameFromDoc({ blobcade: 'gamedoc', v: 999, meta: { name: 'x' } })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(GameDocError)
      expect((err as GameDocError).errors.join(' ')).toMatch(/newer Blobcade/)
    }
  })
})

describe('interactive prefabs through the interpreter', () => {
  it('requires explicit permission for scripted docs', () => {
    const doc = {
      blobcade: 'gamedoc' as const,
      v: 2,
      meta: { name: 'Scripted' },
      script: 'blobcade.toast("hi")',
    }
    expect(() => buildGameFromDoc(doc)).toThrow(GameDocError)
    const def = buildGameFromDoc(doc, { allowScripts: true })
    expect(def.systems?.map((s) => s.id)).toContain('gamedoc-script')
  })

  it('places water as a non-solid water material volume', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Water Test' },
      parts: [
        { kind: 'water', at: [0, 0.4, 0], size: [8, 0.8, 8] },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)

    expect(rb.log).toContainEqual(expect.objectContaining({
      verb: 'add',
      material: 'water',
      collide: false,
      color: '#2f81f7',
    }))
  })

  it('button + door + mover place parts and wire rules', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Door Test' },
      parts: [
        { kind: 'part', at: [0, 0, 0], size: [10, 1, 10], color: '#888' },
        { kind: 'button', at: [2, 1, 0], tag: 'open-sesame' },
        { kind: 'door', at: [0, 2, 4], size: [2, 3, 0.5], tag: 'gate' },
        { kind: 'mover', at: [6, 1, 0], size: [3, 0.6, 3], by: [0, 4, 0], period: 5 },
      ],
      rules: [{ when: { type: 'touch', part: 'open-sesame' }, do: [{ type: 'openDoor', part: 'gate' }] }],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    const adds = rb.log.filter((e) => e.verb === 'add')
    expect(adds.length).toBe(4) // floor + button + door + mover
    expect(def.systems?.length).toBe(1)
  })
})

describe('custom weapons-as-data through the interpreter', () => {
  const weaponDoc = {
    blobcade: 'gamedoc' as const,
    v: 1,
    meta: { id: 'arena-x', name: 'Arena X' },
    weapons: [
      { id: 'blaster', name: 'Blaster', kind: 'projectile' as const, damage: 18, fireRate: 6 },
    ],
    combat: {
      weapons: ['sidearm', 'blaster'],
      startWeapons: ['blaster'],
    },
    parts: [
      { kind: 'weaponSpawn' as const, at: [2, 1, 0] as [number, number, number], weapon: 'blaster' },
      { kind: 'weaponSpawn' as const, at: [4, 1, 0] as [number, number, number], weapon: 'sidearm' },
    ],
  }

  it('registers the weapon under a game-namespaced id', () => {
    expect(validateGameDoc(weaponDoc).ok).toBe(true)
    buildGameFromDoc(weaponDoc)
    expect(WEAPONS['arena-x:blaster']).toBeDefined()
    expect(WEAPONS['arena-x:blaster'].name).toBe('Blaster')
    // engine-required fields the doc omitted get filled with defaults
    expect(WEAPONS['arena-x:blaster'].icon).toBeTruthy()
    expect(WEAPONS['arena-x:blaster'].sound).toBe('sidearm')
  })

  it('rewrites combat weapons/startWeapons to the namespaced id', () => {
    const def = buildGameFromDoc(weaponDoc)
    expect(def.combat?.weapons).toEqual(['sidearm', 'arena-x:blaster'])
    expect(def.combat?.startWeapons).toEqual(['arena-x:blaster'])
  })

  it('rewrites matching weaponSpawn parts (leaving built-ins untouched)', () => {
    const def = buildGameFromDoc(weaponDoc)
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    const spawns = rb.log.filter((e) => e.verb === 'weaponSpawn').map((e) => e.weaponId)
    expect(spawns).toContain('arena-x:blaster')
    expect(spawns).toContain('sidearm') // built-in id passes through unchanged
  })

  it('does not mutate the input doc', () => {
    const doc = JSON.parse(JSON.stringify(weaponDoc))
    buildGameFromDoc(doc)
    expect(doc.combat.weapons).toEqual(['sidearm', 'blaster'])
    expect(doc.combat.startWeapons).toEqual(['blaster'])
    expect(doc.parts[0].weapon).toBe('blaster')
  })
})

describe('portal parts through the interpreter (W2)', () => {
  it('places a frame + pane + touch slab (+ optional label) and wires goToGame', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Hub' },
      parts: [
        { kind: 'part', at: [0, 0, 0], size: [10, 1, 10], color: '#888' },
        { kind: 'portal', at: [0, 2, -4], target: 'g:lavamaze7', label: 'Lava Maze' },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)

    const adds = rb.log.filter((e) => e.verb === 'add')
    // floor + neon frame + glass pane + touch slab = 4
    expect(adds.length).toBe(4)
    // a label was placed above the ring
    const labels = rb.log.filter((e) => e.verb === 'label')
    expect(labels.length).toBe(1)
    expect(labels[0].text).toBe('Lava Maze')

    // the three portal adds are all non-colliding (walk-through)
    const portalAdds = adds.filter((e) => e.collide === false)
    expect(portalAdds.length).toBe(3)

    // the slab carries an onTouch that emits platform:goToGame { target }
    const slab = portalAdds.find((e) => typeof e.onTouch === 'function')
    expect(slab).toBeDefined()
    const bus = new EventBus()
    let got: unknown = null
    bus.on('platform:goToGame', (p) => { got = p })
    ;(slab!.onTouch as (ctx: { events: EventBus }) => void)({ events: bus })
    expect(got).toEqual({ target: 'g:lavamaze7' })
  })

  it('uses the default ring size + color and omits the label when unset', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc', v: 1, meta: { name: 'Hub' },
      parts: [{ kind: 'portal', at: [1, 2, 3], target: 'home' }],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    expect(rb.log.filter((e) => e.verb === 'label').length).toBe(0)
    const frame = rb.log.find((e) => e.verb === 'add')
    expect(frame?.material).toBe('neon')
    expect(frame?.color).toBe('#8a5cff')
    expect(frame?.size).toEqual({ x: 2.6, y: 3.2, z: 0.4 }) // default ring
  })
})

describe('vehicle parts through the interpreter (W3)', () => {
  it('calls the vehicle builder with type, position and options', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Garage' },
      parts: [
        { kind: 'vehicle', at: [1, 2, 3], vehicle: 'plane', speed: 34, fuel: 60, color: '#e8edf2' },
        { kind: 'vehicle', at: [-2, 1, 0], vehicle: 'car' },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)

    const vehicles = rb.log.filter((e) => e.verb === 'vehicle')
    expect(vehicles).toEqual([
      { verb: 'vehicle', type: 'plane', at: { x: 1, y: 2, z: 3 }, opts: { speed: 34, fuel: 60, color: '#e8edf2' } },
      { verb: 'vehicle', type: 'car', at: { x: -2, y: 1, z: 0 }, opts: undefined },
    ])
  })
})

describe('ladder parts through the interpreter', () => {
  it('places a non-solid climbable part', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Climb' },
      parts: [
        { kind: 'ladder', at: [0, 2.5, -3], size: [1.4, 5, 0.25], color: '#c89c62', rotY: Math.PI / 2 },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)

    const ladder = rb.log.find((e) => e.verb === 'add')
    expect(ladder).toMatchObject({
      verb: 'add',
      at: { x: 0, y: 2.5, z: -3 },
      size: { x: 1.4, y: 5, z: 0.25 },
      color: '#c89c62',
      material: 'wood',
      collide: false,
      climbable: true,
    })
  })
})

describe('physics hitboxes and gravity zones through the interpreter (W3)', () => {
  it('passes fallDamage into GameDef physics', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Hard Landing' },
      physics: { gravity: -46, fallDamage: true },
    })
    expect(def.physics).toEqual({ gravity: -46, fallDamage: true })
  })

  it('passes part hitbox through to w.add', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Tight Collision' },
      parts: [
        { kind: 'part', at: [0, 1, 0], size: [4, 2, 4], hitbox: [2, 1, 2], color: '#888' },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    const part = rb.log.find((e) => e.verb === 'add')
    expect(part?.hitbox).toEqual({ x: 2, y: 1, z: 2 })
  })

  it('builds gravity zones as glass parts with gravityZone set', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Moon Room' },
      parts: [
        { kind: 'gravityZone', at: [0, 3, 0], size: [6, 6, 6], gravity: 0.3 },
        { kind: 'gravityZone', at: [8, 3, 0], size: [4, 4, 4], gravity: 2, color: '#44ccff' },
      ],
    })
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    const zones = rb.log.filter((e) => e.verb === 'add')
    expect(zones).toEqual([
      {
        verb: 'add',
        at: { x: 0, y: 3, z: 0 },
        size: { x: 6, y: 6, z: 6 },
        hitbox: undefined,
        color: '#8a5cff',
        material: 'glass',
        collide: undefined,
        gravityZone: 0.3,
        onTouch: undefined,
      },
      {
        verb: 'add',
        at: { x: 8, y: 3, z: 0 },
        size: { x: 4, y: 4, z: 4 },
        hitbox: undefined,
        color: '#44ccff',
        material: 'glass',
        collide: undefined,
        gravityZone: 2,
        onTouch: undefined,
      },
    ])
  })
})

describe('platform services through the interpreter (W4)', () => {
  it('passes services through to the GameDef', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Shop Game' },
      services: {
        chat: false,
        leaderboard: true,
        store: [
          { id: 'red-shirt', name: 'Red Shirt', kind: 'shirt', color: '#ff0033', price: 25 },
          { id: 'blue-trail', name: 'Blue Trail', kind: 'trail', color: '#3366ff', price: 50 },
        ],
      },
    })
    expect(def.services).toEqual({
      chat: false,
      leaderboard: true,
      store: [
        { id: 'red-shirt', name: 'Red Shirt', kind: 'shirt', color: '#ff0033', price: 25 },
        { id: 'blue-trail', name: 'Blue Trail', kind: 'trail', color: '#3366ff', price: 50 },
      ],
    })
  })

  it('passes maxPlayers through to the GameDef', () => {
    const def = buildGameFromDoc({
      blobcade: 'gamedoc',
      v: 1,
      meta: { name: 'Big Room' },
      maxPlayers: 100,
    })
    expect(def.maxPlayers).toBe(100)
  })
})

describe('multi-level docs through the interpreter (W2)', () => {
  const multi = {
    blobcade: 'gamedoc' as const,
    v: 1,
    meta: { id: 'tower', name: 'Tower', blurb: 'Climb it.' },
    lighting: 'noon',
    physics: { gravity: -50 },
    weapons: [{ id: 'blaster', name: 'Blaster', kind: 'projectile' as const, damage: 18, fireRate: 6 }],
    combat: { weapons: ['sidearm', 'blaster'], startWeapons: ['blaster'] },
    parts: [{ kind: 'coin' as const, at: [0, 1, 0] as [number, number, number] }],
    levels: [
      // level 1 (index 0): omits lighting/physics/weapons/combat → inherits them
      { parts: [{ kind: 'coin' as const, at: [2, 1, 0] as [number, number, number] }, { kind: 'coin' as const, at: [4, 1, 0] as [number, number, number] }] },
      // level 2 (index 1): overrides lighting + supplies its own meta name
      { meta: { name: 'Rooftop' }, lighting: 'night', parts: [{ kind: 'tree' as const, at: [0, 0, 0] as [number, number, number] }] },
    ],
  }

  it('level 0 (default) builds the root doc unchanged', () => {
    const def = buildGameFromDoc(multi)
    expect(def.meta.name).toBe('Tower')
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    expect(rb.log.filter((e) => e.verb === 'coin').length).toBe(1) // root's single coin
    expect(rb.log.find((e) => e.verb === 'lighting')?.preset).toBe('noon')
  })

  it('level 1 is the root game itself (human numbering)', () => {
    const def = buildGameFromDoc(multi, { level: 1 })
    expect(def.meta.name).toBe('Tower') // no suffix — level 1 = this game
  })

  it('level 2 builds the first added level and inherits lighting/physics/combat/weapons + meta', () => {
    const def = buildGameFromDoc(multi, { level: 2 })
    // meta name gets the suffix; id inherited
    expect(def.meta.name).toBe('Tower — Level 2')
    expect(def.meta.id).toBe('tower')
    // physics + combat inherited from the parent (level omitted them)
    expect(def.physics).toEqual({ gravity: -50 })
    expect(def.combat?.startWeapons).toEqual(['tower:blaster']) // namespaced, inherited
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    // this level's own two coins (not the root's one)
    expect(rb.log.filter((e) => e.verb === 'coin').length).toBe(2)
    // inherited lighting preset
    expect(rb.log.find((e) => e.verb === 'lighting')?.preset).toBe('noon')
  })

  it('level 3 overrides lighting and uses its own meta name', () => {
    const def = buildGameFromDoc(multi, { level: 3 })
    expect(def.meta.name).toBe('Rooftop — Level 3')
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    expect(rb.log.find((e) => e.verb === 'lighting')?.preset).toBe('night') // overridden
    expect(rb.log.filter((e) => e.verb === 'tree').length).toBe(1)
    expect(rb.log.filter((e) => e.verb === 'coin').length).toBe(0)
  })

  it('an out-of-range level falls back to the root doc', () => {
    const def = buildGameFromDoc(multi, { level: 9 })
    expect(def.meta.name).toBe('Tower') // no suffix — root
    const rb = makeRecordingBuilder()
    def.build(rb.builder)
    expect(rb.log.filter((e) => e.verb === 'coin').length).toBe(1)
  })

  it('does not mutate the input doc when building a level', () => {
    const doc = JSON.parse(JSON.stringify(multi))
    buildGameFromDoc(doc, { level: 2 })
    expect(doc.combat.startWeapons).toEqual(['blaster']) // still doc-local id
    expect(doc.levels[0].lighting).toBeUndefined() // inheritance didn't write back
    expect(doc.levels.length).toBe(2)
  })
})
