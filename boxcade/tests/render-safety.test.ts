import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { pickBotSpawn } from '../src/engine/combat'
import { Particles } from '../src/engine/fx'
import { v3 } from '../src/engine/math'
import { safeColor } from '../src/engine/world'

describe('render safety fallbacks', () => {
  it('falls back before constructing invalid colors', () => {
    expect(safeColor('#123456', '#ffffff').getHexString()).toBe('123456')
    expect(safeColor('red', '#ffffff').getHexString()).toBe('ff0000')
    expect(safeColor('not-a-color', '#abcdef').getHexString()).toBe('abcdef')
    expect(safeColor(undefined, '#fedcba').getHexString()).toBe('fedcba')
    expect(safeColor('', 'also-bad').getHexString()).toBe('ffffff')
  })

  it('uses white particles when a caller passes an empty color palette', () => {
    const scene = new THREE.Scene()
    const fx = new Particles(scene)

    fx.burst(new THREE.Vector3(0, 0, 0), { count: 1, colors: [], life: 1 })
    fx.update(0.01)

    const colorAttr = fx.points.geometry.getAttribute('color') as THREE.BufferAttribute
    const colors = colorAttr.array as Float32Array
    expect(colors[0]).toBeCloseTo(1)
    expect(colors[1]).toBeCloseTo(1)
    expect(colors[2]).toBeCloseTo(1)
    fx.dispose()
  })

  it('disposes particle GPU resources idempotently', () => {
    const scene = new THREE.Scene()
    const fx = new Particles(scene)
    let geoDisposed = 0
    let matDisposed = 0
    fx.points.geometry.addEventListener('dispose', () => { geoDisposed++ })
    ;(fx.points.material as THREE.Material).addEventListener('dispose', () => { matDisposed++ })

    fx.dispose()
    fx.dispose()

    expect(scene.children).not.toContain(fx.points)
    expect(geoDisposed).toBe(1)
    expect(matDisposed).toBe(1)
  })
})

describe('bot spawn fallbacks', () => {
  it('uses the local-player fallback when a bot spawn list is empty', () => {
    const fallback = v3(3, 4, 5)
    expect(pickBotSpawn([], fallback)).toBe(fallback)
  })
})
