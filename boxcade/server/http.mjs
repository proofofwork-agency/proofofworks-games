// Boxcade publish API — a plain node:http handler (no framework) that shares
// the websocket server's port. Local-first: anonymous creators, edit rights
// via a bearer-style edit token, per-IP rate limits, light server-side doc
// checks (the client fully validates docs again before running them).
//
//   GET    /api/games?sort=new|plays|likes     discovery list
//   GET    /api/games/:id                      one game (doc + counters)
//   POST   /api/games                          publish  → { id, editToken }
//   PUT    /api/games/:id      (token)         republish
//   DELETE /api/games/:id      (token)         unpublish (hide)
//   POST   /api/games/:id/play                 play counter (debounced client-side)
//   POST   /api/games/:id/like   { device }    toggle like
//   POST   /api/games/:id/report { device, reason }
//   GET    /api/admin/games        (ADMIN_TOKEN)  moderation list
//   POST   /api/admin/hide         (ADMIN_TOKEN)  { id, hidden }

import {
  createGame, updateGame, unpublishGame, getGame, getGameMeta, listGames,
  bumpPlay, likeGame, reportGame, adminSetHidden, adminList,
  getEarnings, claimEarnings, creditStoreEarnings, submitScore, topScores,
} from './db.mjs'

const MAX_BODY = 300 * 1024
const MAX_DOC = 256 * 1024
const ADMIN_TOKEN = process.env.BOXCADE_ADMIN_TOKEN ?? ''

// ---- per-IP rate limiting (token bucket, writes only) ----
const buckets = new Map()
function allow(ip, cost = 1) {
  const now = Date.now()
  let b = buckets.get(ip)
  if (!b) buckets.set(ip, (b = { tokens: 20, at: now }))
  b.tokens = Math.min(20, b.tokens + ((now - b.at) / 1000) * 0.5) // refill 1 per 2s
  b.at = now
  if (b.tokens < cost) return false
  b.tokens -= cost
  return true
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip)
}, 60_000).unref()

const storeBuckets = new Map()
function allowStoreCredit(ip) {
  const now = Date.now()
  let b = storeBuckets.get(ip)
  if (!b) storeBuckets.set(ip, (b = { tokens: 20, at: now }))
  b.tokens = Math.min(20, b.tokens + ((now - b.at) / 3_600_000) * 20)
  b.at = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60_000
  for (const [ip, b] of storeBuckets) if (b.at < cutoff) storeBuckets.delete(ip)
}, 60_000).unref()

const cleanText = (s, max) =>
  String(s ?? '').replace(/[^\w \-–—.,!?'"():;@#%&+*/€$☆★a-zA-Z0-9À-ɏḀ-ỿ\p{Emoji}]/gu, '').slice(0, max).trim()

export function validateEmbedUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null
  let url
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol === 'https:') return url.href
  if (url.protocol === 'http:' && url.hostname === 'localhost') return url.href
  return null
}

/** light server-side doc sanity (full validation happens client-side on play) */
function checkDoc(text) {
  if (typeof text !== 'string' || text.length > MAX_DOC) return 'doc too large'
  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return 'doc is not valid JSON'
  }
  if (doc?.boxcade !== 'gamedoc') return 'not a Boxcade game document'
  if (!Number.isInteger(doc.v) || doc.v < 1 || doc.v > 8) return 'bad doc version'
  if (typeof doc.meta?.name !== 'string' || !doc.meta.name.trim()) return 'game needs a name'
  if (Array.isArray(doc.parts) && doc.parts.length > 2000) return 'too many parts'
  if (Array.isArray(doc.rules) && doc.rules.length > 200) return 'too many rules'
  return null
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-edit-token,x-admin-token',
    'cache-control': 'no-store',
  })
  res.end(json)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** returns true when the request was an API call (handled), false otherwise */
export async function handleApi(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  if (!path.startsWith('/api/')) return false
  const ip = req.socket.remoteAddress ?? '?'

  if (req.method === 'OPTIONS') {
    send(res, 204, {})
    return true
  }

  try {
    // ---- discovery ----
    if (req.method === 'GET' && path === '/api/games') {
      const sort = ['new', 'plays', 'likes'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'new'
      const rows = listGames(sort).map((g) => ({ ...g, ...getGameMeta(g.id) }))
      send(res, 200, { games: rows })
      return true
    }

    const one = path.match(/^\/api\/games\/([a-z0-9]+)$/)
    if (req.method === 'GET' && one) {
      const g = getGame(one[1])
      if (!g || g.hidden) send(res, 404, { error: 'game not found' })
      else send(res, 200, {
        id: g.id,
        type: g.type,
        url: g.url,
        name: g.name,
        author: g.author,
        plays: g.plays,
        likes: g.likes,
        updated: g.updated,
        doc: JSON.parse(g.doc),
      })
      return true
    }

    // ---- creator store cut (no auth; closed-loop local wallets) ----
    const storeCredit = path.match(/^\/api\/games\/([a-z0-9]+)\/store-credit$/)
    if (req.method === 'POST' && storeCredit) {
      if (!allowStoreCredit(ip)) return send(res, 429, { error: 'slow down a little' }), true
      const g = getGame(storeCredit[1])
      if (!g || g.hidden) return send(res, 404, { error: 'game not found' }), true
      const body = await readBody(req)
      const itemId = String(body.itemId ?? '')
      if (!/^[a-z0-9-]+$/.test(itemId)) return send(res, 400, { error: 'bad item id' }), true
      const price = Number(body.price)
      if (!Number.isInteger(price) || price < 1 || price > 500) return send(res, 400, { error: 'bad price' }), true
      let item = null
      try {
        const doc = JSON.parse(g.doc)
        item = Array.isArray(doc?.services?.store) ? doc.services.store.find((it) => it?.id === itemId) : null
      } catch { /* corrupt docs are not creditable */ }
      if (!item) return send(res, 400, { error: 'store item not found' }), true
      if (item.price !== price) return send(res, 400, { error: 'price mismatch' }), true
      const credited = Math.round(price * 0.30)
      if (credited > 0) creditStoreEarnings(g.id, credited)
      send(res, 200, { ok: true, credited })
      return true
    }

    // ---- publish ----
    if (req.method === 'POST' && path === '/api/games') {
      if (!allow(ip, 4)) return send(res, 429, { error: 'slow down a little' }), true
      const body = await readBody(req)
      if (body.embed !== undefined) {
        const embed = body.embed ?? {}
        const embedUrl = validateEmbedUrl(embed.url)
        if (!embedUrl) return send(res, 400, { error: 'embed url must be https: or http://localhost' }), true
        const name = cleanText(embed.name, 48) || 'External game'
        const doc = {
          boxcade: 'embed',
          v: 1,
          meta: {
            name,
            emoji: cleanText(embed.emoji, 8) || '🔗',
            blurb: cleanText(embed.blurb, 140),
          },
        }
        const author = cleanText(body.author, 24) || 'anonymous'
        const out = createGame({ doc: JSON.stringify(doc), name, author, type: 'embed', url: embedUrl, hidden: true })
        send(res, 201, out)
        return true
      }
      const docText = JSON.stringify(body.doc ?? null)
      const err = checkDoc(docText)
      if (err) return send(res, 400, { error: err }), true
      const name = cleanText(body.doc.meta.name, 48) || 'Untitled'
      const author = cleanText(body.author, 24) || 'anonymous'
      const out = createGame({ doc: docText, name, author })
      send(res, 201, out)
      return true
    }

    if ((req.method === 'PUT' || req.method === 'DELETE') && one) {
      if (!allow(ip, 2)) return send(res, 429, { error: 'slow down a little' }), true
      const token = req.headers['x-edit-token']
      if (typeof token !== 'string' || !token) return send(res, 401, { error: 'missing edit token' }), true
      if (req.method === 'DELETE') {
        const out = unpublishGame(one[1], token)
        send(res, out.ok ? 200 : out.status, out.ok ? { ok: true } : { error: out.error })
        return true
      }
      const body = await readBody(req)
      const docText = JSON.stringify(body.doc ?? null)
      const err = checkDoc(docText)
      if (err) return send(res, 400, { error: err }), true
      const out = updateGame(one[1], token, { doc: docText, name: cleanText(body.doc.meta.name, 48) || 'Untitled' })
      send(res, out.ok ? 200 : out.status, out.ok ? { ok: true } : { error: out.error })
      return true
    }

    // ---- creator earnings (edit-token gated) ----
    const earn = path.match(/^\/api\/games\/([a-z0-9]+)\/(earnings|claim)$/)
    if (earn) {
      const token = req.headers['x-edit-token']
      if (typeof token !== 'string' || !token) return send(res, 401, { error: 'missing edit token' }), true
      const out = earn[2] === 'claim' && req.method === 'POST'
        ? claimEarnings(earn[1], token)
        : req.method === 'GET' && earn[2] === 'earnings'
          ? getEarnings(earn[1], token)
          : null
      if (out === null) return send(res, 404, { error: 'unknown api route' }), true
      send(res, out.ok ? 200 : out.status, out.ok ? out : { error: out.error })
      return true
    }

    // ---- leaderboards ----
    const board = path.match(/^\/api\/games\/([a-z0-9]+)\/scores$/)
    if (board) {
      if (req.method === 'GET') {
        send(res, 200, { scores: topScores(board[1], 5) })
        return true
      }
      if (req.method === 'POST') {
        if (!allow(ip, 1)) return send(res, 429, { error: 'slow down a little' }), true
        const body = await readBody(req)
        const score = Number(body.score)
        if (!Number.isFinite(score) || score <= 0 || score > 86400) return send(res, 400, { error: 'bad score' }), true
        const okSub = submitScore(board[1], cleanText(body.device, 32) || ip, cleanText(body.name, 16) || 'Boxy', Math.round(score * 10) / 10)
        send(res, okSub ? 200 : 404, okSub ? { ok: true } : { error: 'game not found' })
        return true
      }
    }

    // ---- counters ----
    const sub = path.match(/^\/api\/games\/([a-z0-9]+)\/(play|like|report)$/)
    if (req.method === 'POST' && sub) {
      if (!allow(ip, 1)) return send(res, 429, { error: 'slow down a little' }), true
      const [, id, action] = sub
      if (!getGame(id)) return send(res, 404, { error: 'game not found' }), true
      const body = await readBody(req)
      const device = cleanText(body.device, 32) || ip
      if (action === 'play') {
        bumpPlay(id)
        send(res, 200, { ok: true })
      } else if (action === 'like') {
        send(res, 200, likeGame(id, device))
      } else {
        send(res, 200, reportGame(id, device, body.reason))
      }
      return true
    }

    // ---- moderation ----
    if (path.startsWith('/api/admin/')) {
      if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
        send(res, 403, { error: 'admin token required (set BOXCADE_ADMIN_TOKEN)' })
        return true
      }
      if (req.method === 'GET' && path === '/api/admin/games') {
        send(res, 200, { games: adminList() })
        return true
      }
      if (req.method === 'POST' && path === '/api/admin/hide') {
        const body = await readBody(req)
        adminSetHidden(String(body.id ?? ''), !!body.hidden)
        send(res, 200, { ok: true })
        return true
      }
    }

    send(res, 404, { error: 'unknown api route' })
    return true
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : 'bad request' })
    return true
  }
}
