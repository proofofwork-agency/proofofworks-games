import { describe, expect, it } from 'vitest'
import { migrateBlobcadeLocalStorage } from '../src/storage-migration'

class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string): void { this.map.set(k, String(v)) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
}

describe('migrateBlobcadeLocalStorage', () => {
  it('migrates legacy boxcade keys and bolts balances to blobcade/blobcash', () => {
    const storage = new MemoryStorage() as unknown as Storage
    storage.setItem('boxcade.bolts', '250')
    storage.setItem('boxcade.inventory', '["shirt-royal"]')
    storage.setItem('boxcade.store.abc', '{"owned":["x"]}')
    storage.setItem('boxcade.editor.lastDraft', 'draft-1')

    migrateBlobcadeLocalStorage(storage)

    expect(storage.getItem('blobcade.blobcash')).toBe('250')
    expect(storage.getItem('blobcade.inventory')).toBe('["shirt-royal"]')
    expect(storage.getItem('blobcade.store.abc')).toBe('{"owned":["x"]}')
    expect(storage.getItem('blobcade.editor.lastDraft')).toBe('draft-1')
    expect(storage.getItem('boxcade.bolts')).toBeNull()
    expect(storage.getItem('boxcade.inventory')).toBeNull()
  })

  it('chains pre-Boxcade freeblox/blux keys directly to blobcade/blobcash', () => {
    const storage = new MemoryStorage() as unknown as Storage
    storage.setItem('freeblox.blux', '99')
    storage.setItem('freeblox.editor.map', '@lighting noon')

    migrateBlobcadeLocalStorage(storage)

    expect(storage.getItem('blobcade.blobcash')).toBe('99')
    expect(storage.getItem('blobcade.editor.map')).toBe('@lighting noon')
    expect(storage.getItem('freeblox.blux')).toBeNull()
  })

  it('does not overwrite newer blobcade data when a legacy key conflicts', () => {
    const storage = new MemoryStorage() as unknown as Storage
    storage.setItem('blobcade.name', 'NewName')
    storage.setItem('boxcade.name', 'OldName')

    migrateBlobcadeLocalStorage(storage)

    expect(storage.getItem('blobcade.name')).toBe('NewName')
    expect(storage.getItem('boxcade.name')).toBe('OldName')
  })

  it('is idempotent after migrating matching legacy keys', () => {
    const storage = new MemoryStorage() as unknown as Storage
    storage.setItem('boxcade.bolts', '75')
    storage.setItem('boxcade.dailyBonus', '2026-06-24')

    migrateBlobcadeLocalStorage(storage)
    migrateBlobcadeLocalStorage(storage)

    expect(storage.getItem('blobcade.blobcash')).toBe('75')
    expect(storage.getItem('blobcade.dailyBonus')).toBe('2026-06-24')
    expect(storage.getItem('boxcade.bolts')).toBeNull()
    expect(storage.getItem('boxcade.dailyBonus')).toBeNull()
  })
})
