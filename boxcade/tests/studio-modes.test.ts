import { describe, expect, it } from 'vitest'
import { buildGameFromDoc } from '../src/sdk/interpret'
import { validateGameDoc, type GameDoc, type StudioGameMode } from '../src/sdk/gamedoc'
import { analyzeStudioScript, applyStudioMode, getStudioModeSettings, STUDIO_MODE_OPTIONS } from '../src/studio/modes'

const baseDoc = (): GameDoc => ({
  boxcade: 'gamedoc',
  v: 1,
  meta: { name: 'Mode Test' },
  parts: [{ kind: 'part', id: 'creator_block', at: [4, 1, 4], size: [2, 2, 2], color: '#abcdef' }],
  rules: [],
})

describe('Studio Mode Builder', () => {
  it('generates valid runnable GameDocs for every preset mode', () => {
    const modes = STUDIO_MODE_OPTIONS.map(([id]) => id).filter((id) => id !== 'custom')
    expect(modes).toEqual(['obby', 'arena', 'waves', 'ctf', 'royale'])

    for (const mode of modes) {
      const doc = baseDoc()
      applyStudioMode(doc, mode, undefined)

      const validation = validateGameDoc(doc)
      expect(validation.errors).toEqual([])
      expect(validation.ok).toBe(true)
      expect(doc.studio?.mode).toBe(mode)
      expect(doc.parts?.some((p) => p.id === 'creator_block')).toBe(true)
      expect(doc.parts?.some((p) => p.id?.startsWith('mode_'))).toBe(true)

      expect(() => buildGameFromDoc(doc, { allowScripts: true })).not.toThrow()
    }
  })

  it('roundtrips normalized settings in editor metadata', () => {
    const doc = baseDoc()
    applyStudioMode(doc, 'waves', { baseBots: 99, botsPerWave: 3, waveDelay: 12, winWave: 5 })

    expect(getStudioModeSettings(doc, 'waves')).toEqual({
      baseBots: 8,
      botsPerWave: 3,
      waveDelay: 12,
      winWave: 5,
    })
    expect(doc.script).toContain('const baseBots = 8')
    expect(doc.studio?.scriptManaged).toBe(true)
  })

  it('replaces only managed parts and mode rules on regeneration', () => {
    const doc = baseDoc()
    applyStudioMode(doc, 'ctf', { botsPerTeam: 2 })
    doc.parts!.push({ kind: 'part', id: 'creator_cover', at: [0, 1, 0], size: [2, 2, 2], color: '#123456' })
    const firstManagedCount = doc.parts!.filter((p) => p.id?.startsWith('mode_')).length

    applyStudioMode(doc, 'ctf', { botsPerTeam: 4 })

    expect(doc.parts!.filter((p) => p.id?.startsWith('mode_'))).toHaveLength(firstManagedCount)
    expect(doc.parts!.some((p) => p.id === 'creator_block')).toBe(true)
    expect(doc.parts!.some((p) => p.id === 'creator_cover')).toBe(true)
    expect(doc.rules?.every((r) => r.when.type !== 'touch' || r.when.part.startsWith('mode_'))).toBe(true)
    expect(doc.script).toContain('const botsPerTeam = 4')
  })

  it('can switch to custom without deleting generated draft content', () => {
    const doc = baseDoc()
    applyStudioMode(doc, 'arena', undefined)
    const parts = doc.parts?.length

    applyStudioMode(doc, 'custom' as StudioGameMode, undefined)

    expect(doc.studio?.mode).toBe('custom')
    expect(doc.studio?.scriptManaged).toBe(false)
    expect(doc.parts?.length).toBe(parts)
  })

  it('reports script syntax and sandbox capability hints', () => {
    const broken = analyzeStudioScript('boxcade.toast("hi"\nfetch("/x")')
    expect(broken.errors.length).toBeGreaterThan(0)
    expect(broken.warnings.join(' ')).toContain('fetch')

    const ok = analyzeStudioScript('boxcade.onStart(() => boxcade.toast("hi"))')
    expect(ok.errors).toEqual([])
    expect(ok.capabilities).toEqual(['onStart', 'toast'])
  })

  it('validates scripts against the documented sandbox API', () => {
    const analysis = analyzeStudioScript(`
      boxcade.fly()
      boxcade.entity('bot').dance()
      boxcade.emit('combat:kill')
      boxcade.sound('airhorn')
      document.body
      import('/remote.js')
    `)

    const text = analysis.warnings.join('\n')
    expect(text).toContain('boxcade.fly is not in the documented sandbox API')
    expect(text).toContain('entity.dance is not in the documented entity API')
    expect(text).toContain("Reserved engine event 'combat:kill'")
    expect(text).toContain("Sound 'airhorn'")
    expect(text).toContain('document is not available')
    expect(text).toContain('Dynamic import()')
  })
})
