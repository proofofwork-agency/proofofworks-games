import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = () => readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')

describe('legacy embed bridge compatibility', () => {
  it('maps legacy boxcade inbound messages onto blobcade handlers', () => {
    const source = mainSource()

    expect(source).toContain("data.t.startsWith('boxcade:')")
    expect(source).toContain("data.t.replace(/^boxcade:/, 'blobcade:').replace('awardBolts', 'awardBlobcash')")
    expect(source).toContain("bridgeType === 'blobcade:ready'")
    expect(source).toContain("bridgeType === 'blobcade:awardBlobcash'")
    expect(source).toContain("bridgeType === 'blobcade:submitScore'")
  })

  it('replies to legacy ready messages with the legacy hello type', () => {
    const source = mainSource()

    expect(source).toContain("t: legacyBridge ? 'boxcade:hello' : 'blobcade:hello'")
  })
})
