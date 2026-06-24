// Share-link codec: JSON → deflate-raw → base64url and back. Payloads ride
// in URL hashes, so URL-safety and friendly decode errors are contract.

import { describe, it, expect } from 'vitest'
import { encodeGameDoc, decodeGameDoc, hashGameDoc, SHARE_LINK_DECODE_LIMIT, SHARE_LINK_LIMIT } from '../src/sdk/codec'
import { GAMEDOC_VERSION } from '../src/sdk/gamedoc'

const doc = {
  blobcade: 'gamedoc',
  v: 1,
  meta: { name: 'Codec Test', emoji: '🧪' },
  parts: [
    { kind: 'part', at: [0, 0, 0], size: [24, 2, 24], color: '#6cc04a', material: 'grass' },
    { kind: 'coin', at: [4, 3, 0] },
  ],
  rules: [{ when: { type: 'start' }, do: [{ type: 'toast', text: 'hello — ünïcødé 👋' }] }],
}

const toBase64Url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const expectFriendlyDecodeError = async (payload: string, message: RegExp) => {
  await expect(decodeGameDoc(payload)).rejects.toThrow(message)
  await expect(decodeGameDoc(payload)).rejects.not.toThrow(/DecompressionStream|CompressionStream|SyntaxError|JSON\.parse|incorrect header|invalid stored block|unexpected end/i)
}

describe('codec', () => {
  it('round-trips a doc object', async () => {
    const payload = await encodeGameDoc(doc)
    const back = await decodeGameDoc(payload)
    expect(back).toEqual(doc)
  })

  it('produces URL-safe payloads', async () => {
    const payload = await encodeGameDoc(doc)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('compresses typical docs well under the share-link limit', async () => {
    const payload = await encodeGameDoc(doc)
    expect(payload.length).toBeLessThan(SHARE_LINK_LIMIT / 8)
  })

  it('rejects damaged payloads with friendly errors', async () => {
    await expectFriendlyDecodeError('!!!not-base64url!!!', /invalid|too large/)
    const payload = await encodeGameDoc(doc)
    await expectFriendlyDecodeError(payload.slice(0, Math.floor(payload.length / 2)), /damaged|incomplete/)
  })

  it('rejects valid base64url that is not deflate data', async () => {
    await expectFriendlyDecodeError(toBase64Url('not compressed'), /damaged|incomplete/)
  })

  it('rejects payloads that inflate to non-JSON', async () => {
    // valid deflate of a non-JSON string
    const bogus = await encodeGameDoc('this is not json')
    // encodeGameDoc(string) treats it as pre-stringified JSON; decoding parses → throws
    await expectFriendlyDecodeError(bogus, /invalid|newer version/)
  })

  it('rejects structurally invalid GameDoc JSON with validator messages', async () => {
    const bogus = await encodeGameDoc({ hello: 'world' })
    await expectFriendlyDecodeError(bogus, /missing blobcade/)
  })

  it('rejects future GameDoc versions with the validator update message', async () => {
    const future = await encodeGameDoc({ ...doc, v: GAMEDOC_VERSION + 1 })
    await expectFriendlyDecodeError(future, /newer Blobcade/)
  })

  it('rejects oversized share payloads before inflate', async () => {
    await expectFriendlyDecodeError('A'.repeat(SHARE_LINK_DECODE_LIMIT + 1), /invalid|too large/)
  })

  it('hashGameDoc is stable and discriminating', () => {
    const a1 = hashGameDoc(doc)
    const a2 = hashGameDoc(JSON.parse(JSON.stringify(doc)))
    const b = hashGameDoc({ ...doc, v: 2 })
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
    expect(a1).toMatch(/^[a-z0-9]+$/)
  })
})
