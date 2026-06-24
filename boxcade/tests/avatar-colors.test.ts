import { describe, expect, it } from 'vitest'
import { pickAvatarColors } from '../src/engine/avatar'

const shirts = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#fd79a8', '#00b06f', '#5d6df1']
const pants = ['#2c3e50', '#34495e', '#1e3a5f', '#3d2b56', '#4a3728']

describe('avatar color picking', () => {
  it('always maps unsigned and high-bit seeds to defined palette colors', () => {
    const seeds = [
      0,
      1,
      15,
      16,
      0x7fffffff,
      0x80000000,
      0x80000010,
      0xf0000000,
      0xffffffff,
      ...Array.from({ length: 5000 }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0)),
    ]

    for (const seed of seeds) {
      const colors = pickAvatarColors(seed)
      expect(shirts).toContain(colors.shirt)
      expect(pants).toContain(colors.pants)
    }
  })

  it('keeps shirt overrides while still deriving pants from the unsigned seed', () => {
    expect(pickAvatarColors(0xf0000000, '#123456')).toEqual({
      shirt: '#123456',
      pants: pants[(0xf0000000 >>> 4) % pants.length],
    })
  })
})
