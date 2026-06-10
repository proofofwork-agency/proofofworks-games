import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveDraft, loadDraft } from '../src/drafts'
import { CUSTOM_MAP_KEY, floorPlanWorldToCell, placeFloorPlanElement, resolveEditorDraftKeyForStudio, STARTER_TEXTMAP } from '../src/editor'
import { createStarterStudioDoc } from '../src/studio/studio'
import { STUDIO_PALETTE } from '../src/studio/ui'
import { TEMPLATES } from '../src/templates'
import { validateGameDoc } from '../src/sdk/gamedoc'
import { gameDocToTypeScript } from '../src/sdk/ts-export'
import type { GameDoc } from '../src/sdk'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()

  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

describe('Studio Floor Plan integration', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('starts new Studio drafts from a single textmap-backed floor source', () => {
    const doc = createStarterStudioDoc()

    expect(doc.textmap).toBe(STARTER_TEXTMAP)
    expect(doc.parts).toEqual([])
  })

  it('opens legacy editor draft links without rewriting the draft', () => {
    const doc: GameDoc = {
      boxcade: 'gamedoc',
      v: 1,
      meta: { name: 'Existing', emoji: '🧪', genre: 'Custom' },
      camera: 'orbit',
      textmap: '@lighting noon\n\nGG\nSG\n',
      parts: [{ kind: 'part', at: [0, 0.5, 0], size: [4, 1, 4], color: '#abcdef' }],
      rules: [],
    }
    const key = saveDraft(null, doc)
    const rawBefore = localStorage.getItem(`boxcade.draft.${key}`)

    const resolved = resolveEditorDraftKeyForStudio(`#/editor?draft=${key}`)

    expect(resolved).toBe(key)
    expect(localStorage.getItem(`boxcade.draft.${key}`)).toBe(rawBefore)
    expect(loadDraft(key)?.parts).toEqual(doc.parts)
  })

  it('creates a textmap draft for bare legacy editor links', () => {
    const key = resolveEditorDraftKeyForStudio('#/editor')
    const doc = loadDraft(key)

    expect(doc?.textmap).toContain('@lighting noon')
    expect(localStorage.getItem(CUSTOM_MAP_KEY)).toBe(doc?.textmap)
  })

  it('can place every Studio palette element from Floor Plan cells', () => {
    for (const item of STUDIO_PALETTE) {
      const placed = placeFloorPlanElement(item.template, { r: 2, c: 3 }, { rows: 5, cols: 7 }, 2, 4)

      expect(placed.kind).toBe(item.template.kind)
      expect(placed.at).toEqual([0, 4 + item.template.at[1], 0])
      expect(floorPlanWorldToCell(placed.at, { rows: 5, cols: 7 }, 2)).toEqual({ r: 2, c: 3 })
      expect(item.mapChar).toHaveLength(1)
      expect(item.mapColor).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('ships valid scripted templates and TypeScript export starters', () => {
    const scripted = TEMPLATES.filter((t) => t.make().script)
    expect(scripted.map((t) => t.id)).toEqual(expect.arrayContaining(['waves', 'ctf-scripted', 'mini-royale']))

    for (const t of TEMPLATES) {
      const doc = t.make()
      expect(validateGameDoc(doc).ok).toBe(true)
      if (doc.script) expect(doc.v).toBe(2)
    }

    const ts = gameDocToTypeScript(scripted[0].make())
    expect(ts).toContain('buildGameFromDoc')
    expect(ts).toContain('allowScripts: true')
  })
})
