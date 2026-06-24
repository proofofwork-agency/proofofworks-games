// Client for the Blobcade publish/discovery API (served by server/server.mjs
// on the same port as the multiplayer relay). Everything degrades gracefully:
// when the server is unreachable the portal simply hides the Community shelf.

import type { GameDoc } from './sdk'
import { apiBaseUrl } from './config'

const base = () => apiBaseUrl()

export interface CommunityGame {
  id: string
  type?: 'game' | 'embed'
  url?: string
  name: string
  author: string
  updated: number
  plays: number
  likes: number
  emoji: string
  gradient: string
  thumb: string
  blurb: string
}

/** anonymous per-browser identity for likes/report dedup (not an account) */
export function deviceKey(): string {
  let k = localStorage.getItem('blobcade.device')
  if (!k) {
    k = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
    localStorage.setItem('blobcade.device', k)
  }
  return k
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error ?? `server said ${res.status}`)
  return body
}

export async function listCommunity(sort: 'new' | 'plays' | 'likes' = 'new'): Promise<CommunityGame[]> {
  const out = await call<{ games: CommunityGame[] }>(`/api/games?sort=${sort}`)
  return out.games
}

export async function getPublished(id: string): Promise<{ id: string; name: string; author: string; plays: number; likes: number; doc: GameDoc }> {
  return call(`/api/games/${id}`)
}

export interface PublishedGame {
  id: string
  type?: 'game' | 'embed'
  url?: string
  name: string
  author: string
  plays: number
  likes: number
  updated: number
  doc: GameDoc | { blobcade: 'embed'; v: number; meta?: { name?: string; emoji?: string; blurb?: string } }
}

export async function getPublishedGame(id: string): Promise<PublishedGame> {
  return call(`/api/games/${id}`)
}

export async function publishGame(doc: GameDoc, author: string): Promise<{ id: string; editToken: string }> {
  return call('/api/games', { method: 'POST', body: JSON.stringify({ doc, author }) })
}

export async function publishEmbed(embed: { url: string; name: string; emoji?: string; blurb?: string }, author: string): Promise<{ id: string; editToken: string }> {
  return call('/api/games', { method: 'POST', body: JSON.stringify({ embed, author }) })
}

export async function republishGame(id: string, token: string, doc: GameDoc): Promise<void> {
  await call(`/api/games/${id}`, { method: 'PUT', body: JSON.stringify({ doc }), headers: { 'x-edit-token': token } })
}

export async function unpublishGame(id: string, token: string): Promise<void> {
  await call(`/api/games/${id}`, { method: 'DELETE', headers: { 'x-edit-token': token } })
}

/** count a play at most once per game per device per 6h */
export function countPlay(id: string) {
  const key = `blobcade.played.${id}`
  const last = Number(localStorage.getItem(key) ?? 0)
  if (Date.now() - last < 6 * 3600_000) return
  localStorage.setItem(key, String(Date.now()))
  void call(`/api/games/${id}/play`, { method: 'POST', body: JSON.stringify({ device: deviceKey() }) }).catch(() => {})
}

export async function toggleLike(id: string): Promise<boolean> {
  const out = await call<{ liked: boolean }>(`/api/games/${id}/like`, { method: 'POST', body: JSON.stringify({ device: deviceKey() }) })
  return out.liked
}

export async function reportGame(id: string, reason: string): Promise<void> {
  await call(`/api/games/${id}/report`, { method: 'POST', body: JSON.stringify({ device: deviceKey(), reason }) })
}

// ---- creator earnings (claim Blobcash your published games earned) ----

export async function getEarnings(id: string, token: string): Promise<{ accrued: number; claimed: number }> {
  return call(`/api/games/${id}/earnings`, { headers: { 'x-edit-token': token } })
}

export async function claimEarnings(id: string, token: string): Promise<number> {
  const out = await call<{ amount: number }>(`/api/games/${id}/claim`, { method: 'POST', headers: { 'x-edit-token': token } })
  return out.amount
}

// ---- leaderboards (best win time per game) ----

export async function submitScore(id: string, score: number): Promise<void> {
  await call(`/api/games/${id}/scores`, {
    method: 'POST',
    body: JSON.stringify({ device: deviceKey(), name: localStorage.getItem('blobcade.name') ?? 'Boxy', score }),
  })
}

export async function topScores(id: string): Promise<Array<{ name: string; score: number }>> {
  const out = await call<{ scores: Array<{ name: string; score: number }> }>(`/api/games/${id}/scores`)
  return out.scores
}

/** a store item was bought — the server credits the creator's 30% cut */
export async function creditStorePurchase(id: string, itemId: string, price: number): Promise<void> {
  await call(`/api/games/${id}/store-credit`, {
    method: 'POST',
    body: JSON.stringify({ itemId, price }),
  })
}

// ---- publish tokens (creator edit rights, kept locally) ----

interface PublishRecord { id: string; token: string }

function readTokens(): Record<string, PublishRecord> {
  try {
    return JSON.parse(localStorage.getItem('blobcade.publishTokens') ?? '{}')
  } catch {
    return {}
  }
}

export function publishRecordFor(draftKey: string): PublishRecord | null {
  return readTokens()[draftKey] ?? null
}

export function rememberPublish(draftKey: string, rec: PublishRecord) {
  const all = readTokens()
  all[draftKey] = rec
  localStorage.setItem('blobcade.publishTokens', JSON.stringify(all))
}

export function forgetPublish(draftKey: string) {
  const all = readTokens()
  delete all[draftKey]
  localStorage.setItem('blobcade.publishTokens', JSON.stringify(all))
}
