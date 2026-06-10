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

  it('rejects credential smuggling in the URL', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('https://user:pw@example.com/game.html')).toBeNull()
    expect(validateEmbedUrl('https://admin@example.com/game.html')).toBeNull()
  })

  it('rejects private/loopback/link-local IP-literal hosts', async () => {
    const { validateEmbedUrl } = await httpModule()

    expect(validateEmbedUrl('https://10.0.0.8/game.html')).toBeNull()
    expect(validateEmbedUrl('https://192.168.1.1/router')).toBeNull()
    expect(validateEmbedUrl('https://172.20.3.4/internal')).toBeNull()
    expect(validateEmbedUrl('https://169.254.169.254/latest/meta-data')).toBeNull()
    expect(validateEmbedUrl('https://127.0.0.1/game.html')).toBeNull()
    expect(validateEmbedUrl('https://[::1]/game.html')).toBeNull()
    expect(validateEmbedUrl('https://[fe80::1]/game.html')).toBeNull()
    // public IP literals and localhost-by-name stay allowed
    expect(validateEmbedUrl('https://93.184.216.34/game.html')).toBe('https://93.184.216.34/game.html')
    expect(validateEmbedUrl('https://localhost:5179/game.html')).toBe('https://localhost:5179/game.html')
  })
})

describe('thumbnail validation', () => {
  type DbModule = { validImageThumb(s: unknown): boolean }
  const dbModule = async () => await import('../server/db.mjs') as DbModule

  it('accepts small raster data-URIs only', async () => {
    const { validImageThumb } = await dbModule()

    expect(validImageThumb('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(validImageThumb('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
    expect(validImageThumb('data:image/webp;base64,UklGRg==')).toBe(true)
  })

  it('rejects SVG data-URIs, foreign URLs, and oversized payloads', async () => {
    const { validImageThumb } = await dbModule()

    expect(validImageThumb('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false)
    expect(validImageThumb('data:image/svg+xml,<svg onload=alert(1)/>')).toBe(false)
    expect(validImageThumb('https://example.com/thumb.png')).toBe(false)
    expect(validImageThumb('data:image/png;base64,' + 'A'.repeat(90_000))).toBe(false)
    expect(validImageThumb(42)).toBe(false)
  })
})
