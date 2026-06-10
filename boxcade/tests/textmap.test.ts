import { describe, it, expect } from 'vitest'
import { parseTextMap, serializeTextMap, buildTextMap } from '../src/sdk/textmap'
import { makeRecordingBuilder, type LogEntry } from './helpers/recording-builder'

const SAMPLE = [
  '@lighting goldenHour',
  '@cell 2',
  '@killy -18',
  '@gravity 30',
  '// a comment that must be ignored',
  '...S...',
  '..###..',
  '..#C#..',
  '--- +6',
  '..GGG..',
  '..GKG..',
  '---',
  '...W...',
].join('\n')

const verbsOf = (log: LogEntry[], verb: string) => log.filter((e) => e.verb === verb)

describe('parseTextMap', () => {
  it('captures directives, layers, offsets and rows', () => {
    const p = parseTextMap(SAMPLE)
    expect(p.directives.lighting).toBe('goldenHour')
    expect(p.directives.cell).toBe('2')
    expect(p.directives.killy).toBe('-18')
    expect(p.directives.gravity).toBe('30')
    expect(p.cell).toBe(2)
    // three layers split on the two `---` separators
    expect(p.layers.length).toBe(3)
    // `--- +6` then a plain `---` (default layerstep 4)
    expect(p.layerOffsets).toEqual([0, 6, 10])
    expect(p.layers[0]).toEqual(['...S...', '..###..', '..#C#..'])
    expect(p.layers[1]).toEqual(['..GGG..', '..GKG..'])
    expect(p.layers[2]).toEqual(['...W...'])
  })

  it('ignores // comment lines and blank lines', () => {
    const p = parseTextMap('// header\n\n@cell 3\n\n#\n')
    expect(p.cell).toBe(3)
    expect(p.layers.length).toBe(1)
    expect(p.layers[0]).toEqual(['#'])
  })

  it('uses the @layerstep default for a bare `---` separator', () => {
    const p = parseTextMap('@layerstep 5\n#\n---\n#\n--- +2\n#')
    expect(p.layerStep).toBe(5)
    expect(p.layerOffsets).toEqual([0, 5, 7])
  })
})

describe('parse → serialize → parse round-trip', () => {
  it('preserves directives, layer count, offsets and rows', () => {
    const first = parseTextMap(SAMPLE)
    const text = serializeTextMap(first)
    const second = parseTextMap(text)

    expect(second.directives).toEqual(first.directives)
    expect(second.layers.length).toBe(first.layers.length)
    expect(second.layerOffsets).toEqual(first.layerOffsets)
    expect(second.layers).toEqual(first.layers)
    expect(second.cell).toBe(first.cell)
    expect(second.layerStep).toBe(first.layerStep)
  })

  it('is idempotent on a second serialize pass', () => {
    const once = serializeTextMap(parseTextMap(SAMPLE))
    const twice = serializeTextMap(parseTextMap(once))
    expect(twice).toBe(once)
  })
})

describe('buildTextMap result tallies', () => {
  it('reports coins, checkpoints, spawn, layers and combat markers', () => {
    const { builder, log } = makeRecordingBuilder()
    const r = buildTextMap(builder, SAMPLE)

    expect(r.coins).toBe(1)
    expect(r.checkpoints).toBe(1)
    expect(r.spawnFound).toBe(true)
    expect(r.layers).toBe(3)
    expect(r.healthPacks).toBe(0)
    expect(r.ammoCrates).toBe(0)
    expect(r.redSpawns).toEqual([])
    expect(r.blueSpawns).toEqual([])
    expect(r.redFlag).toBeNull()
    expect(r.blueFlag).toBeNull()

    // directives flowed to the builder
    expect(verbsOf(log, 'lighting')[0]?.preset).toBe('goldenHour')
    expect(verbsOf(log, 'killY')[0]?.y).toBe(-18)
    // @gravity present -> exactly one physics() call, gravity made negative
    const phys = verbsOf(log, 'physics')
    expect(phys.length).toBe(1)
    expect((phys[0].cfg as { gravity: number }).gravity).toBe(-30)
  })

  it("a 'C' tile produces one coin plus one stone tile part", () => {
    const { builder, log } = makeRecordingBuilder()
    buildTextMap(builder, 'C')

    expect(verbsOf(log, 'coin').length).toBe(1)
    const adds = verbsOf(log, 'add')
    expect(adds.length).toBe(1)
    expect(adds[0].material).toBe('stone')
    expect((adds[0].size as { y: number }).y).toBe(1)
  })

  it("'S' sets the spawn exactly once even when repeated", () => {
    const { builder, log } = makeRecordingBuilder()
    const r = buildTextMap(builder, 'SS\nSS')

    expect(r.spawnFound).toBe(true)
    expect(verbsOf(log, 'spawn').length).toBe(1)
    // every 'S' still lays a grass tile (4 of them)
    expect(verbsOf(log, 'add').length).toBe(4)
  })

  it('combat tiles tally health packs, ammo crates, flags and team spawns', () => {
    const { builder } = makeRecordingBuilder()
    const r = buildTextMap(builder, 'HA\nFf\nrb')

    expect(r.healthPacks).toBe(1)
    expect(r.ammoCrates).toBe(1)
    expect(r.redFlag).not.toBeNull()
    expect(r.blueFlag).not.toBeNull()
    expect(r.redSpawns.length).toBe(1)
    expect(r.blueSpawns.length).toBe(1)
  })

  it('a numeric tile builds a stone column that many blocks tall', () => {
    const { builder, log } = makeRecordingBuilder()
    buildTextMap(builder, '5')
    const adds = verbsOf(log, 'add')
    expect(adds.length).toBe(1)
    expect((adds[0].size as { y: number }).y).toBe(5)
  })
})
