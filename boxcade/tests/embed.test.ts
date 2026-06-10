import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

type HttpModule = {
  validateEmbedUrl(input: unknown): string | null
}

process.env.BOXCADE_DB ??= path.join(mkdtempSync(path.join(tmpdir(), 'boxcade-embed-test-')), 'boxcade.db')

async function httpModule(): Promise<HttpModule> {
  // Import lazily so tests can run without coupling to the live server process.
  return await import('../server/http.mjs') as HttpModule
}

describe('external embed URL validation', () => {
  it('accepts https URLs', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('https://example.com/game/index.html')).toBe('https://example.com/game/index.html')
  })

  it('accepts localhost http URLs for local development', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('http://localhost:5179/embed.html')).toBe('http://localhost:5179/embed.html')
  })

  it('rejects non-localhost http URLs', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('http://example.com/game.html')).toBeNull()
    expect(validateEmbedUrl('http://127.0.0.1:5179/embed.html')).toBeNull()
  })

  it('rejects non-web and malformed URLs', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('data:text/html,hello')).toBeNull()
    expect(validateEmbedUrl('javascript:alert(1)')).toBeNull()
    expect(validateEmbedUrl('not a url')).toBeNull()
    expect(validateEmbedUrl(null)).toBeNull()
  })
})
