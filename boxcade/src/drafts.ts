// The local draft library — "My Games" lives in localStorage. One index key
// (boxcade.myGames) plus one key per draft (boxcade.draft.<key>) holding the
// GameDoc JSON. Everything that creates or lists local games goes through
// this module: the editor saves here, the portal shelf lists here, the
// #/play/draft/<key> route loads here.

import { validateGameDoc, type GameDoc } from './sdk'

const INDEX_KEY = 'boxcade.myGames'
const DRAFT_PREFIX = 'boxcade.draft.'

export interface DraftEntry {
  key: string
  name: string
  emoji: string
  genre: string
  updated: number
}

function readIndex(): DraftEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeIndex(list: DraftEntry[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list))
}

export function listDrafts(): DraftEntry[] {
  return readIndex().sort((a, b) => b.updated - a.updated)
}

export function loadDraft(key: string): GameDoc | null {
  const raw = localStorage.getItem(DRAFT_PREFIX + key)
  if (!raw) return null
  const res = validateGameDoc(raw)
  return res.ok ? (res.doc as GameDoc) : null
}

/** save (key = null creates a new draft); returns the draft key */
export function saveDraft(key: string | null, doc: GameDoc): string {
  const k = key ?? Math.random().toString(36).slice(2, 10)
  localStorage.setItem(DRAFT_PREFIX + k, JSON.stringify(doc))
  const index = readIndex().filter((e) => e.key !== k)
  index.push({
    key: k,
    name: doc.meta.name,
    emoji: doc.meta.emoji ?? '🎮',
    genre: doc.meta.genre ?? 'Custom',
    updated: Date.now(),
  })
  writeIndex(index)
  return k
}

export function deleteDraft(key: string) {
  localStorage.removeItem(DRAFT_PREFIX + key)
  writeIndex(readIndex().filter((e) => e.key !== key))
}

export function duplicateDraft(key: string): string | null {
  const doc = loadDraft(key)
  if (!doc) return null
  const copy: GameDoc = JSON.parse(JSON.stringify(doc))
  copy.meta.name = `${copy.meta.name} (copy)`.slice(0, 48)
  delete copy.meta.id
  return saveDraft(null, copy)
}

/** import a .boxcade.json file's text; returns the key or friendly errors */
export function importDraft(text: string): { key?: string; errors?: string[] } {
  const res = validateGameDoc(text)
  if (!res.ok || !res.doc) return { errors: res.errors }
  return { key: saveDraft(null, res.doc as GameDoc) }
}
