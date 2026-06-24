import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { VoxelWorld, GRASS, STONE, AIR, WATER } from '../src/engine/voxel'

describe('VoxelWorld serialize → deserialize round-trip', () => {
  it('preserves sizes, seaLevel and every cell (procedural island)', () => {
    const w = new VoxelWorld(20, 12, 20, 4)
    w.generateIsland(42)

    const json = w.serialize()
    const r = VoxelWorld.deserialize(json)

    expect(r.sx).toBe(w.sx)
    expect(r.sy).toBe(w.sy)
    expect(r.sz).toBe(w.sz)
    expect(r.seaLevel).toBe(w.seaLevel)

    let checked = 0
    for (let x = 0; x < w.sx; x++) {
      for (let y = 0; y < w.sy; y++) {
        for (let z = 0; z < w.sz; z++) {
          expect(r.get(x, y, z)).toBe(w.get(x, y, z))
          checked++
        }
      }
    }
    expect(checked).toBe(20 * 12 * 20)
  })

  it('preserves a hand-built world of a few dozen blocks', () => {
    const w = new VoxelWorld(16, 16, 16, 6)
    let n = 0
    for (let x = 0; x < 16; x += 3) {
      for (let z = 0; z < 16; z += 2) {
        w.set(x, (x + z) % 16, z, ((x + z) % 9) + 1)
        n++
      }
    }
    expect(n).toBeGreaterThan(30)

    const r = VoxelWorld.deserialize(JSON.parse(w.serialize())) // also accepts a parsed object
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          expect(r.get(x, y, z)).toBe(w.get(x, y, z))
        }
      }
    }
  })
})

describe('VoxelWorld.deserialize rejects bad input', () => {
  const valid = new VoxelWorld(8, 8, 8, 4)
  valid.set(1, 1, 1, STONE)
  const goodObj = JSON.parse(valid.serialize()) as Record<string, unknown>

  it('accepts the legacy boxcade voxel-world marker', () => {
    const legacy = { ...goodObj, boxcade: 'voxel-world/v1' }
    delete legacy.blobcade
    const restored = VoxelWorld.deserialize(JSON.stringify(legacy))
    expect(restored.sx).toBe(valid.sx)
    expect(restored.sy).toBe(valid.sy)
    expect(restored.sz).toBe(valid.sz)
    expect(restored.get(1, 1, 1)).toBe(STONE)
  })

  it('rejects invalid JSON', () => {
    expect(() => VoxelWorld.deserialize('{ not json')).toThrow(/not valid JSON/i)
  })

  it('rejects a wrong / missing marker', () => {
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, blobcade: 'nope' })))
      .toThrow(/voxel-world\/v1/i)
    expect(() => VoxelWorld.deserialize(JSON.stringify({ size: [8, 8, 8], rle: [1, 0] })))
      .toThrow(/voxel-world\/v1/i)
  })

  it('rejects a bad size', () => {
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, size: [8, 8] })))
      .toThrow(/bad size/i)
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, size: [8, 8, 99999] })))
      .toThrow(/bad size/i)
  })

  it('rejects truncated / odd-length rle', () => {
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, rle: [5] })))
      .toThrow(/bad block data/i)
  })

  it('rejects rle whose run total is smaller than the world (size mismatch)', () => {
    // one short run cannot fill an 8x8x8 volume
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, rle: [4, STONE] })))
      .toThrow(/does not match size/i)
  })

  it('rejects rle that overflows the world', () => {
    const tooMuch = 8 * 8 * 8 + 10
    expect(() => VoxelWorld.deserialize(JSON.stringify({ ...goodObj, rle: [tooMuch, AIR] })))
      .toThrow(/corrupt block data/i)
  })

  it('every friendly message is prefixed with "voxel world:"', () => {
    for (const bad of ['{ not json', JSON.stringify({ blobcade: 'x' })]) {
      try {
        VoxelWorld.deserialize(bad)
        throw new Error('expected throw')
      } catch (e) {
        expect((e as Error).message).toMatch(/^voxel world:/)
      }
    }
  })
})

describe('VoxelWorld set / get / surfaceY', () => {
  it('round-trips a single block via set/get', () => {
    const w = new VoxelWorld(8, 8, 8, 4)
    expect(w.get(2, 3, 4)).toBe(AIR)
    w.set(2, 3, 4, GRASS)
    expect(w.get(2, 3, 4)).toBe(GRASS)
  })

  it('out-of-bounds get returns STONE below the floor and AIR elsewhere', () => {
    const w = new VoxelWorld(8, 8, 8, 4)
    expect(w.get(0, -1, 0)).toBe(STONE)
    expect(w.get(0, 99, 0)).toBe(AIR)
    expect(w.get(-1, 0, 0)).toBe(AIR)
  })

  it('out-of-bounds set is a no-op (does not throw)', () => {
    const w = new VoxelWorld(8, 8, 8, 4)
    expect(() => w.set(-5, 0, 0, STONE)).not.toThrow()
    expect(() => w.set(0, 99, 0, STONE)).not.toThrow()
  })

  it('surfaceY returns the cell above the topmost solid block', () => {
    const w = new VoxelWorld(8, 12, 8, 4)
    // empty column -> seaLevel + 1
    expect(w.surfaceY(0, 0)).toBe(5)
    w.set(3, 0, 3, STONE)
    w.set(3, 1, 3, STONE)
    w.set(3, 2, 3, GRASS)
    expect(w.surfaceY(3, 3)).toBe(3)
  })

  it('water does not count as a solid surface', () => {
    const w = new VoxelWorld(8, 12, 8, 4)
    w.set(5, 0, 5, WATER)
    w.set(5, 1, 5, WATER)
    // still no solid -> falls through to seaLevel + 1
    expect(w.surfaceY(5, 5)).toBe(5)
    expect(w.isWater(5, 0, 5)).toBe(true)
  })

  it('disposes live chunk geometry and owned materials idempotently', () => {
    const w = new VoxelWorld(8, 8, 8, 4)
    w.set(1, 1, 1, STONE)
    w.set(2, 1, 1, WATER)
    w.buildAll()

    let geoDisposed = 0
    let matDisposed = 0
    const materials = new Set<THREE.Material>()
    for (const child of w.group.children) {
      const mesh = child as THREE.Mesh
      mesh.geometry.addEventListener('dispose', () => { geoDisposed++ })
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (materials.has(mat)) continue
        materials.add(mat)
        mat.addEventListener('dispose', () => { matDisposed++ })
      }
    }

    expect(w.group.children.length).toBeGreaterThan(0)
    w.dispose()
    w.dispose()

    expect(w.group.children).toHaveLength(0)
    expect(w.waterMeshes).toHaveLength(0)
    expect(geoDisposed).toBeGreaterThan(0)
    expect(matDisposed).toBe(materials.size)
  })
})
