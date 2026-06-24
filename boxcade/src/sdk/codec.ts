// GameDoc wire codec: JSON → deflate-raw → base64url, and back. Built on the
// native CompressionStream API (browsers + Node ≥ 18) — zero dependencies.
// Share links carry this payload in the URL hash: #/play/d/{payload}.

import { validateGameDoc, type GameDoc } from './gamedoc'

/** encoded payloads above this are too fragile for chat apps/proxies — use a
 *  file download or a hosted link instead (the UI offers the fallback) */
export const SHARE_LINK_LIMIT = 8 * 1024
export const SHARE_LINK_DECODE_LIMIT = SHARE_LINK_LIMIT
const SHARE_LINK_ALPHABET = /^[A-Za-z0-9_-]+$/

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** GameDoc (object or JSON string) → URL-safe compressed payload */
export async function encodeGameDoc(doc: GameDoc | object | string): Promise<string> {
  const json = typeof doc === 'string' ? doc : JSON.stringify(doc)
  const deflated = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return toBase64Url(deflated)
}

/** payload → validated GameDoc */
export async function decodeGameDoc(payload: string): Promise<GameDoc> {
  if (!payload || payload.length > SHARE_LINK_DECODE_LIMIT || !SHARE_LINK_ALPHABET.test(payload)) {
    throw new Error('this share link is invalid or too large')
  }
  let inflated: Uint8Array
  try {
    inflated = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'))
  } catch {
    throw new Error('this share link is damaged or incomplete')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder().decode(inflated))
  } catch {
    throw new Error('this share link is invalid or from a newer version of Blobcade')
  }
  const res = validateGameDoc(decoded)
  if (!res.ok || !res.doc) {
    throw new Error(res.errors[0] ?? 'this share link does not contain a valid Blobcade game')
  }
  return res.doc
}

/** stable short hash of a doc's canonical JSON — doc identity for room keys */
export function hashGameDoc(doc: object | string): string {
  const json = typeof doc === 'string' ? doc : JSON.stringify(doc)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).slice(0, 10)
}
