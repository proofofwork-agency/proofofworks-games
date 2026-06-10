// Boxcade publish DB — node:sqlite (built into Node ≥ 22.13, zero deps).
// One file next to the server; gitignored. Games are GameDoc JSON blobs with
// counters; creators keep edit rights via a hashed edit token (no accounts).

import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DB_PATH = process.env.BOXCADE_DB ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'boxcade.db')

const db = new DatabaseSync(DB_PATH)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'game',
    url TEXT NOT NULL DEFAULT '',
    doc TEXT NOT NULL,
    name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'anonymous',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    plays INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    edit_token_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS likes (
    game_id TEXT NOT NULL,
    device TEXT NOT NULL,
    PRIMARY KEY (game_id, device)
  );
  CREATE TABLE IF NOT EXISTS reports (
    game_id TEXT NOT NULL,
    device TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS earnings (
    game_id TEXT PRIMARY KEY,
    accrued INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS scores (
    game_id TEXT NOT NULL,
    device TEXT NOT NULL,
    name TEXT NOT NULL,
    score REAL NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (game_id, device)
  );
`)

try { db.exec("ALTER TABLE games ADD COLUMN type TEXT NOT NULL DEFAULT 'game'") } catch { /* already migrated */ }
try { db.exec("ALTER TABLE games ADD COLUMN url TEXT NOT NULL DEFAULT ''") } catch { /* already migrated */ }

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function newId() {
  return randomBytes(5).toString('base64url').replace(/[-_]/g, 'a').toLowerCase()
}

export function newToken() {
  return randomBytes(24).toString('base64url')
}

// thumbnails must be small raster data-URIs — SVG data-URIs can carry markup/
// script, so they are dropped at both the write and read boundaries
const THUMB_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,']
export const THUMB_MAX = 80_000
export function validImageThumb(s) {
  return typeof s === 'string' && s.length <= THUMB_MAX && THUMB_PREFIXES.some((p) => s.startsWith(p))
}

export function createGame({ doc, name, author, type = 'game', url = '', hidden = false }) {
  const id = newId()
  const token = newToken()
  const now = Date.now()
  db.prepare(
    `INSERT INTO games (id, type, url, doc, name, author, created, updated, hidden, edit_token_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, type, url, doc, name, author, now, now, hidden ? 1 : 0, hashToken(token))
  return { id, editToken: token }
}

export function updateGame(id, token, { doc, name }) {
  const row = db.prepare('SELECT edit_token_hash, type FROM games WHERE id = ?').get(id)
  if (!row) return { ok: false, status: 404, error: 'game not found' }
  if (row.edit_token_hash !== hashToken(token)) return { ok: false, status: 403, error: 'wrong edit token' }
  if (row.type !== 'game') return { ok: false, status: 400, error: 'external games require admin approval' }
  db.prepare('UPDATE games SET doc = ?, name = ?, updated = ?, hidden = 0 WHERE id = ?')
    .run(doc, name, Date.now(), id)
  return { ok: true }
}

export function unpublishGame(id, token) {
  const row = db.prepare('SELECT edit_token_hash FROM games WHERE id = ?').get(id)
  if (!row) return { ok: false, status: 404, error: 'game not found' }
  if (row.edit_token_hash !== hashToken(token)) return { ok: false, status: 403, error: 'wrong edit token' }
  db.prepare('UPDATE games SET hidden = 1, updated = ? WHERE id = ?').run(Date.now(), id)
  return { ok: true }
}

export function getGame(id) {
  return db.prepare('SELECT id, type, url, doc, name, author, created, updated, plays, likes, hidden FROM games WHERE id = ?').get(id) ?? null
}

const SORTS = {
  new: 'updated DESC',
  plays: 'plays DESC, updated DESC',
  likes: 'likes DESC, updated DESC',
}

export function listGames(sort = 'new', limit = 60) {
  const order = SORTS[sort] ?? SORTS.new
  return db.prepare(
    `SELECT id, type, url, name, author, updated, plays, likes FROM games
     WHERE hidden = 0 ORDER BY ${order} LIMIT ?`,
  ).all(Math.min(200, Math.max(1, limit)))
}

/** thumbnails ride inside the doc; list endpoints pull just meta cheaply */
export function getGameMeta(id) {
  const row = getGame(id)
  if (!row) return null
  let emoji = '🎮'
  let gradient = ''
  let thumb = ''
  let blurb = ''
  try {
    const meta = JSON.parse(row.doc)?.meta ?? {}
    emoji = typeof meta.emoji === 'string' ? meta.emoji.slice(0, 8) : emoji
    gradient = typeof meta.gradient === 'string' ? meta.gradient.slice(0, 200) : ''
    blurb = typeof meta.blurb === 'string' ? meta.blurb.slice(0, 140) : ''
    thumb = validImageThumb(meta.thumb) ? meta.thumb : ''
  } catch { /* corrupt docs render with defaults */ }
  return { emoji, gradient, thumb, blurb }
}

export function bumpPlay(id) {
  db.prepare('UPDATE games SET plays = plays + 1 WHERE id = ? AND hidden = 0').run(id)
  accrue(id, 2) // the creator cut: every counted play pays the maker
}

/** creator earnings (Bolts) — accrue on plays/likes, claim with the edit token */
function accrue(gameId, bolts) {
  db.prepare(
    `INSERT INTO earnings (game_id, accrued) VALUES (?, ?)
     ON CONFLICT(game_id) DO UPDATE SET accrued = accrued + excluded.accrued`,
  ).run(gameId, bolts)
}

export function creditStoreEarnings(gameId, bolts) {
  accrue(gameId, bolts)
}

export function getEarnings(id, token) {
  const row = db.prepare('SELECT edit_token_hash FROM games WHERE id = ?').get(id)
  if (!row) return { ok: false, status: 404, error: 'game not found' }
  if (row.edit_token_hash !== hashToken(token)) return { ok: false, status: 403, error: 'wrong edit token' }
  const e = db.prepare('SELECT accrued, claimed FROM earnings WHERE game_id = ?').get(id)
  return { ok: true, accrued: e?.accrued ?? 0, claimed: e?.claimed ?? 0 }
}

export function claimEarnings(id, token) {
  const check = getEarnings(id, token)
  if (!check.ok) return check
  const amount = check.accrued
  if (amount > 0) {
    db.prepare('UPDATE earnings SET accrued = 0, claimed = claimed + ? WHERE game_id = ?').run(amount, id)
  }
  return { ok: true, amount }
}

/** per-game leaderboard: best (lowest) win time per device */
export function submitScore(gameId, device, name, score) {
  if (!getGame(gameId)) return false
  db.prepare(
    `INSERT INTO scores (game_id, device, name, score, updated) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(game_id, device) DO UPDATE SET
       score = MIN(scores.score, excluded.score),
       name = excluded.name,
       updated = excluded.updated`,
  ).run(gameId, device, name, score, Date.now())
  return true
}

export function topScores(gameId, limit = 5) {
  return db.prepare(
    'SELECT name, score FROM scores WHERE game_id = ? ORDER BY score ASC LIMIT ?',
  ).all(gameId, Math.min(20, limit))
}

export function likeGame(id, device) {
  const exists = db.prepare('SELECT 1 FROM likes WHERE game_id = ? AND device = ?').get(id, device)
  if (exists) {
    db.prepare('DELETE FROM likes WHERE game_id = ? AND device = ?').run(id, device)
    db.prepare('UPDATE games SET likes = MAX(0, likes - 1) WHERE id = ?').run(id)
    return { liked: false }
  }
  db.prepare('INSERT INTO likes (game_id, device) VALUES (?, ?)').run(id, device)
  db.prepare('UPDATE games SET likes = likes + 1 WHERE id = ?').run(id)
  accrue(id, 5) // likes pay the creator too
  return { liked: true }
}

export function reportGame(id, device, reason) {
  db.prepare('INSERT INTO reports (game_id, device, reason, created) VALUES (?, ?, ?, ?)')
    .run(id, device, String(reason ?? '').slice(0, 200), Date.now())
  // auto-hide after 5 distinct-device reports — a human reviews via admin API
  const n = db.prepare('SELECT COUNT(DISTINCT device) AS n FROM reports WHERE game_id = ?').get(id)?.n ?? 0
  if (n >= 5) db.prepare('UPDATE games SET hidden = 1 WHERE id = ?').run(id)
  return { reports: n }
}

export function adminSetHidden(id, hidden) {
  db.prepare('UPDATE games SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id)
}

export function adminList(limit = 200) {
  return db.prepare(
    `SELECT g.id, g.type, g.url, g.name, g.author, g.plays, g.likes, g.hidden,
            (SELECT COUNT(*) FROM reports r WHERE r.game_id = g.id) AS reports
     FROM games g ORDER BY g.updated DESC LIMIT ?`,
  ).all(limit)
}
