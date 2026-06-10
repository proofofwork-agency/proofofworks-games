// The Boxcade portal: home screen with the built-in game grid, the My Games
// draft shelf, the Bolts wallet + avatar shop, and player identity. main.ts
// stays the router; everything the home screen renders lives here.

import { GAMES } from './games'
import { economy, CATALOG } from './engine/economy'
import {
  listDrafts, loadDraft, deleteDraft, duplicateDraft, importDraft, saveDraft,
  type DraftEntry,
} from './drafts'
import { TEMPLATES } from './templates'
import { encodeGameDoc, SHARE_LINK_LIMIT, slugifyName, type GameDoc } from './sdk'
import {
  listCommunity, publishGame, republishGame, publishRecordFor, rememberPublish,
  toggleLike, reportGame, getEarnings, claimEarnings, topScores, type CommunityGame,
} from './api'
import './portal-extra.css'

export function playerName(): string {
  let n = localStorage.getItem('boxcade.name') ?? ''
  if (!n) {
    n = 'Boxy' + Math.floor(1000 + Math.random() * 9000)
    localStorage.setItem('boxcade.name', n)
  }
  return n.slice(0, 16)
}

/** a fresh textmap-only GameDoc for "New map" — a small grassy starter grid the
 *  floor-plan painter opens onto (the Studio renders it in 3D live). */
function newMapDoc(): GameDoc {
  return {
    boxcade: 'gamedoc',
    v: 1,
    meta: { name: 'My Map', emoji: '🗺', genre: 'Obby', gradient: 'linear-gradient(135deg, #06d6a0, #2f81f7)' },
    camera: 'orbit',
    textmap: '@lighting noon\n\n' + Array.from({ length: 8 }, () => 'GGGGGGGGGGGG').join('\n') + '\n',
    rules: [],
  }
}

export function renderPortal(app: HTMLElement) {
  app.className = ''
  app.innerHTML = `
    <div class="portal">
      <div class="portal-inner">
        <div class="brand">
          <div class="brand-mark"><span></span></div>
          <h1>BOX<em>CADE</em></h1>
          <div class="brand-right">
            <button class="wallet" id="walletBtn" title="Open the shop">B$ <b id="boltsAmt">0</b> Bolts</button>
            <button class="btn small ghost" id="shopBtn">🛍 Shop</button>
            <button class="btn small ghost" id="editorBtn">🗺 Map Editor</button>
          </div>
        </div>
        <p class="tagline"><b>Build. Play. Together.</b> — a free browser game platform with AAA-style lighting and a friendly blocky soul.</p>
        <div class="player-row">
          <label for="nick">Playing as</label>
          <input id="nick" maxlength="16" spellcheck="false" />
          <span class="net-badge" id="netState">checking server…</span>
        </div>
        <div id="myGames"></div>
        <div class="game-grid" id="grid"></div>
        <div id="community"></div>
        <p class="portal-foot">
          Boxcade Engine v0.2 — classic platform controls + gamenomics (earn Bolts by playing, spend it in the shop),
          a voxel build mode, an arena-shooter arsenal with bots, real-time multiplayer with chat,
          a ~25-line game SDK, and a map editor that reads/writes plain text files.<br/>
          Start the room server with <code>npm run server</code> for multiplayer.
        </p>
      </div>
    </div>`

  const nick = document.getElementById('nick') as HTMLInputElement
  nick.value = playerName()
  nick.addEventListener('change', () => {
    const v = nick.value.trim().slice(0, 16) || playerName()
    nick.value = v
    localStorage.setItem('boxcade.name', v)
  })

  const boltsAmt = document.getElementById('boltsAmt')!
  const refreshBolts = () => { boltsAmt.textContent = String(economy.balance) }
  refreshBolts()
  const unsub = economy.onChange(refreshBolts)
  window.addEventListener('hashchange', () => unsub(), { once: true })

  // daily login bonus — the classic retention mechanic
  const daily = economy.claimDaily()
  if (daily > 0) {
    const banner = document.createElement('div')
    banner.className = 'daily-banner'
    banner.textContent = `🎁 Daily bonus: +${daily} Bolts!`
    document.querySelector('.portal-inner')!.prepend(banner)
    setTimeout(() => banner.remove(), 5000)
  }

  document.getElementById('editorBtn')!.addEventListener('click', () => { location.hash = '#/editor' })
  document.getElementById('shopBtn')!.addEventListener('click', openShop)
  document.getElementById('walletBtn')!.addEventListener('click', openShop)

  renderMyGames(document.getElementById('myGames')!)
  void renderCommunity(document.getElementById('community')!, 'new')

  const grid = document.getElementById('grid')!
  for (const g of GAMES) {
    const card = document.createElement('button')
    card.className = 'game-card'
    card.innerHTML = `
      <div class="game-thumb" style="background:${g.meta.gradient}">${g.meta.emoji}</div>
      <div class="game-meta">
        <h3></h3>
        <p></p>
        <div class="game-foot">
          <span class="game-tag"></span>
          <span class="play-pill">▶ Play</span>
        </div>
      </div>`
    ;(card.querySelector('h3') as HTMLElement).textContent = g.meta.name
    ;(card.querySelector('.game-meta p') as HTMLElement).textContent = g.meta.blurb
    ;(card.querySelector('.game-tag') as HTMLElement).textContent = g.meta.genre
    card.onclick = () => { location.hash = `#/play/${g.meta.id}` }
    grid.appendChild(card)
  }

  // server reachability badge (pure cosmetics — games work offline too)
  const badge = document.getElementById('netState')!
  try {
    const ws = new WebSocket(`ws://${location.hostname}:8081`)
    const timer = setTimeout(() => { try { ws.close() } catch { /* noop */ } }, 1500)
    ws.onopen = () => {
      badge.textContent = '🟢 multiplayer server online'
      clearTimeout(timer)
      ws.close()
    }
    ws.onerror = () => {
      badge.textContent = '⚪ offline mode (run `npm run server`)'
      clearTimeout(timer)
    }
  } catch {
    badge.textContent = '⚪ offline mode'
  }
}

// ---------------- My Games (local draft shelf) ----------------
// The local draft shelf: cards for everything in listDrafts() with Play / Edit
// / Share / Duplicate / Delete, plus a New-game button and .boxcade.json
// import (file picker + drag-drop). Draft name/emoji/genre are USER content
// and are ALWAYS written via textContent — never interpolated into innerHTML.

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const wks = Math.round(days / 7)
  return `${wks} week${wks === 1 ? '' : 's'} ago`
}

function renderMyGames(mountEl: HTMLElement) {
  const drafts = listDrafts()

  mountEl.className = 'mygames'
  mountEl.innerHTML = `
    <div class="mygames-head">
      <h2>🎨 My Games</h2>
      <span class="spacer"></span>
      <button class="btn small ghost" id="mgImport">⬆ Import</button>
      <button class="btn small ghost" id="mgNewMap">🗺 New map</button>
      <button class="btn small" id="mgNew">🧱 New in Studio</button>
    </div>
    <div id="mgEmpty" class="mygames-empty" hidden>Games you make live here — hit New game!</div>
    <div class="draft-grid" id="mgGrid"></div>
    <div class="mygames-note" id="mgNote" aria-live="polite"></div>`

  // hidden file input — the Import button and drag-drop both feed importFile()
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.json,.boxcade.json,application/json'
  fileInput.hidden = true
  mountEl.appendChild(fileInput)

  const grid = mountEl.querySelector('#mgGrid') as HTMLElement
  const empty = mountEl.querySelector('#mgEmpty') as HTMLElement
  const shelfNote = mountEl.querySelector('#mgNote') as HTMLElement

  const rerender = () => renderMyGames(mountEl)

  const setShelfNote = (msg: string, kind: 'ok' | 'err' | 'info') => {
    shelfNote.textContent = msg
    shelfNote.className = `mygames-note ${kind}`
  }

  const importFile = (file: File) => {
    file.text().then((text) => {
      const res = importDraft(text)
      if (res.key) { rerender() }
      else { setShelfNote(res.errors?.[0] ?? 'Could not import that file.', 'err') }
    }).catch(() => setShelfNote('Could not read that file.', 'err'))
  }

  ;(mountEl.querySelector('#mgNew') as HTMLButtonElement).onclick = () => openTemplateChooser()
  // "New map" → a fresh textmap-only draft, opened in the Studio with the 2D
  // floor-plan overlay already open (paint tiles; the 3D view builds live).
  ;(mountEl.querySelector('#mgNewMap') as HTMLButtonElement).onclick = () => {
    const key = saveDraft(null, newMapDoc())
    location.hash = `#/studio/${key}?floorplan=1`
  }
  ;(mountEl.querySelector('#mgImport') as HTMLButtonElement).onclick = () => fileInput.click()
  fileInput.onchange = () => {
    const f = fileInput.files?.[0]
    if (f) importFile(f)
    fileInput.value = '' // allow re-importing the same file
  }

  // drag-drop onto the whole shelf (highlight while a file hovers)
  mountEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    mountEl.classList.add('drop')
  })
  mountEl.addEventListener('dragleave', (e) => {
    if (e.target === mountEl) mountEl.classList.remove('drop')
  })
  mountEl.addEventListener('drop', (e) => {
    e.preventDefault()
    mountEl.classList.remove('drop')
    const f = e.dataTransfer?.files?.[0]
    if (f) importFile(f)
  })

  if (drafts.length === 0) {
    empty.hidden = false
    return
  }

  for (const d of drafts) grid.appendChild(buildDraftCard(d, rerender))
}

// "New in Studio" chooser: a small overlay with a Blank option plus the four
// starter templates. Blank opens an empty Studio; a template seeds a fresh
// draft (saveDraft(null, …)) and opens the Studio on it. Esc or a backdrop
// click closes. All template strings are USER-FACING copy from templates.ts
// and are written via textContent (never interpolated into innerHTML).
function openTemplateChooser() {
  const overlay = document.createElement('div')
  overlay.className = 'overlay-screen'
  const card = document.createElement('div')
  card.className = 'overlay-card'
  card.style.maxWidth = '520px'
  overlay.appendChild(card)

  const h2 = document.createElement('h2')
  h2.textContent = '🧱 New in Studio'
  card.appendChild(h2)

  const sub = document.createElement('p')
  sub.textContent = 'Start from a blank world, or kick off with a ready-made template.'
  card.appendChild(sub)

  const list = document.createElement('div')
  list.style.cssText = 'display:flex; flex-direction:column; gap:10px; text-align:left;'
  card.appendChild(list)

  const close = () => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }

  const openStudio = (hash: string) => { close(); location.hash = hash }

  // a tappable choice row (emoji + name + blurb). The .btn.ghost class gives
  // the border/hover; inline styles lay it out as a wide left-aligned row
  // (the overlay .btn default is a centered pill). All copy via textContent.
  const choice = (emoji: string, name: string, blurb: string, onPick: () => void) => {
    const b = document.createElement('button')
    b.className = 'btn ghost'
    b.type = 'button'
    b.style.cssText =
      'display:flex; align-items:center; gap:14px; width:100%; margin:0; ' +
      'padding:14px 18px; border-radius:14px; text-align:left;'

    const e = document.createElement('span')
    e.textContent = emoji
    e.style.cssText = 'font-size:30px; line-height:1; flex:0 0 auto;'

    const body = document.createElement('span')
    body.style.cssText = 'display:flex; flex-direction:column; gap:3px; min-width:0;'
    const nameEl = document.createElement('span')
    nameEl.textContent = name
    nameEl.style.cssText = 'font-weight:800; font-size:16px;'
    const blurbEl = document.createElement('span')
    blurbEl.textContent = blurb
    blurbEl.style.cssText = 'font-weight:500; font-size:13px; color:var(--muted); line-height:1.4;'
    body.append(nameEl, blurbEl)

    b.append(e, body)
    b.onclick = onPick
    list.appendChild(b)
    return b
  }

  choice('📄', 'Blank', 'An empty world — build it from scratch.', () => openStudio('#/studio'))
  for (const t of TEMPLATES) {
    choice(t.emoji, t.name, t.blurb, () => {
      const key = saveDraft(null, t.make())
      openStudio('#/studio/' + key)
    })
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
}

// One draft card. Returns the element; `rerender` rebuilds the whole shelf
// (used after duplicate / delete / import).
function buildDraftCard(d: DraftEntry, rerender: () => void): HTMLElement {
  const card = document.createElement('div')
  card.className = 'draft-card'
  card.innerHTML = `
    <div class="draft-emoji"></div>
    <div class="draft-body">
      <div class="draft-name"></div>
      <div class="draft-sub">
        <span class="draft-genre"></span>
        <span class="dot">·</span>
        <span class="draft-updated"></span>
      </div>
      <div class="draft-actions">
        <button class="btn small tiny" data-act="play">▶ Play</button>
        <button class="btn small ghost tiny" data-act="edit">✏ Edit</button>
        <button class="btn small ghost tiny" data-act="share">🔗 Share</button>
        <button class="btn small ghost tiny" data-act="publish">🚀 Publish</button>
        <button class="btn small ghost tiny" data-act="dup">⧉ Duplicate</button>
        <button class="btn small ghost tiny danger" data-act="del">🗑 Delete</button>
      </div>
      <div class="draft-note" aria-live="polite"></div>
    </div>`

  // USER CONTENT — textContent only, never innerHTML.
  ;(card.querySelector('.draft-emoji') as HTMLElement).textContent = d.emoji || '🎮'
  ;(card.querySelector('.draft-name') as HTMLElement).textContent = d.name
  ;(card.querySelector('.draft-name') as HTMLElement).title = d.name
  ;(card.querySelector('.draft-genre') as HTMLElement).textContent = d.genre || 'Custom'
  ;(card.querySelector('.draft-updated') as HTMLElement).textContent = relTime(d.updated)

  const note = card.querySelector('.draft-note') as HTMLElement
  const setNote = (msg: string, kind: 'ok' | 'err' | 'info') => {
    note.textContent = msg
    note.className = `draft-note ${kind}`
  }

  const btn = (act: string) => card.querySelector(`[data-act="${act}"]`) as HTMLButtonElement

  btn('play').onclick = () => { location.hash = `#/play/draft/${d.key}` }
  btn('edit').onclick = () => {
    // everything edits in the Studio now; a textmap-only draft (the old "map")
    // opens with the 2D floor-plan overlay already up, 3D drafts open plain.
    const doc = loadDraft(d.key)
    const onlyMap = !!doc && !!doc.textmap && (doc.parts?.length ?? 0) === 0
    location.hash = onlyMap ? `#/studio/${d.key}?floorplan=1` : `#/studio/${d.key}`
  }

  btn('share').onclick = () => shareDraft(d, btn('share'), setNote)

  // publish to the community gallery (server-backed; edit rights via token)
  const pub = btn('publish')
  const rec = publishRecordFor(d.key)
  if (rec) {
    pub.textContent = '🚀 Republish'
    // creator cut: show + claim Bolts this game earned from plays/likes
    void getEarnings(rec.id, rec.token).then((e) => {
      if (e.accrued <= 0) return
      const claim = document.createElement('button')
      claim.className = 'btn small tiny'
      claim.textContent = `💰 Claim B$ ${e.accrued}`
      claim.onclick = async () => {
        claim.disabled = true
        try {
          const amount = await claimEarnings(rec.id, rec.token)
          economy.earn(amount, 'creator earnings')
          claim.remove()
          setNote(`B$ ${amount} creator earnings added to your wallet!`, 'ok')
        } catch (err) {
          claim.disabled = false
          setNote(err instanceof Error ? err.message : 'Claim failed.', 'err')
        }
      }
      pub.after(claim)
    }).catch(() => {})
  }
  pub.onclick = async () => {
    const doc = loadDraft(d.key)
    if (!doc) return setNote('Could not load this draft.', 'err')
    pub.disabled = true
    pub.textContent = '…'
    try {
      const existing = publishRecordFor(d.key)
      const author = localStorage.getItem('boxcade.name') ?? 'anonymous'
      let id = existing?.id
      if (existing) {
        await republishGame(existing.id, existing.token, doc)
      } else {
        const out = await publishGame(doc, author)
        rememberPublish(d.key, { id: out.id, token: out.editToken })
        id = out.id
      }
      const link = `${location.origin}${location.pathname}#/play/g/${id}`
      await navigator.clipboard.writeText(link).catch(() => {})
      pub.textContent = '🚀 Republish'
      setNote('Published! Game link copied — it is now in Community games.', 'ok')
    } catch (err) {
      pub.textContent = publishRecordFor(d.key) ? '🚀 Republish' : '🚀 Publish'
      setNote(err instanceof Error ? err.message : 'Publishing failed — is the server running?', 'err')
    } finally {
      pub.disabled = false
    }
  }

  btn('dup').onclick = () => {
    const newKey = duplicateDraft(d.key)
    if (newKey) rerender()
    else setNote('Could not duplicate — the draft may be corrupt.', 'err')
  }

  // two-step inline delete: first click arms for 3s, second click within the
  // window deletes. No window.confirm (it freezes the MCP browser).
  const del = btn('del')
  let armed = false
  let armTimer: ReturnType<typeof setTimeout> | undefined
  del.onclick = () => {
    if (!armed) {
      armed = true
      del.textContent = 'Really delete?'
      del.classList.add('armed')
      armTimer = setTimeout(() => {
        armed = false
        del.textContent = '🗑 Delete'
        del.classList.remove('armed')
      }, 3000)
      return
    }
    if (armTimer) clearTimeout(armTimer)
    deleteDraft(d.key)
    rerender()
  }

  return card
}

// Share a draft: small enough → copy a share link to the clipboard; too big →
// download the doc as a .boxcade.json file with an inline notice.
function shareDraft(
  d: DraftEntry,
  shareBtn: HTMLButtonElement,
  setNote: (msg: string, kind: 'ok' | 'err' | 'info') => void,
) {
  const doc = loadDraft(d.key)
  if (!doc) { setNote('Could not load this draft to share.', 'err'); return }

  encodeGameDoc(doc).then((payload) => {
    if (payload.length <= SHARE_LINK_LIMIT) {
      const link = `${location.origin}${location.pathname}#/play/d/${payload}`
      navigator.clipboard.writeText(link).then(() => {
        const prev = shareBtn.textContent
        shareBtn.textContent = 'Copied!'
        setTimeout(() => { shareBtn.textContent = prev }, 2000)
      }).catch(() => setNote('Clipboard blocked — copy the link manually.', 'err'))
    } else {
      downloadDoc(doc, d.name)
      setNote('Too big for a link — file downloaded', 'info')
    }
  }).catch(() => setNote('Could not encode this game to share.', 'err'))
}

function downloadDoc(doc: object, name: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugifyName(name)}.boxcade.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------- Community games (published gallery) ----------------
// Server-backed discovery. When the server is unreachable the section simply
// doesn't render — the portal works fully offline. ALL user content (names,
// authors, blurbs) renders via textContent; thumbnails must be raster
// data-URIs (png/jpeg/webp — SVG data-URIs can carry markup, so they're out).

async function renderCommunity(mountEl: HTMLElement, sort: 'new' | 'plays' | 'likes') {
  let games: CommunityGame[]
  try {
    games = await listCommunity(sort)
  } catch {
    mountEl.innerHTML = ''
    return
  }
  if (!mountEl.isConnected) return

  mountEl.className = 'community'
  mountEl.innerHTML = `
    <div class="mygames-head">
      <h2>🌍 Community games</h2>
      <span class="spacer"></span>
      <button class="btn small ghost" data-sort="new">Newest</button>
      <button class="btn small ghost" data-sort="plays">Most played</button>
      <button class="btn small ghost" data-sort="likes">Most liked</button>
    </div>
    <div class="game-grid" id="communityGrid"></div>
    <p class="mygames-empty" id="communityEmpty" hidden>No published games yet — be the first! Build something and hit 🚀 Publish.</p>`

  for (const b of mountEl.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
    b.classList.toggle('sel', b.dataset.sort === sort)
    b.onclick = () => void renderCommunity(mountEl, b.dataset.sort as 'new' | 'plays' | 'likes')
  }

  const grid = mountEl.querySelector('#communityGrid') as HTMLElement
  if (games.length === 0) {
    ;(mountEl.querySelector('#communityEmpty') as HTMLElement).hidden = false
    return
  }

  for (const g of games) {
    const card = document.createElement('div')
    card.className = 'game-card community-card'
    card.innerHTML = `
      <div class="game-thumb"></div>
      <div class="game-meta">
        <h3></h3>
        <p></p>
        <div class="game-foot">
          <span class="game-tag"></span>
          <span class="embed-badge" hidden>🔗 external</span>
          <span class="community-stats"></span>
        </div>
        <div class="draft-actions">
          <button class="btn small tiny" data-act="play">▶ Play</button>
          <button class="btn small ghost tiny" data-act="like">♥ <span></span></button>
          <button class="btn small ghost tiny" data-act="report" title="Report this game">⚑</button>
        </div>
      </div>`

    // USER CONTENT — textContent only; thumbs only when they are raster data images
    const thumbEl = card.querySelector('.game-thumb') as HTMLElement
    if (g.thumb && /^data:image\/(png|jpeg|webp);base64,/.test(g.thumb)) {
      const img = document.createElement('img')
      img.src = g.thumb
      img.alt = ''
      img.className = 'community-thumb'
      thumbEl.appendChild(img)
    } else {
      thumbEl.style.background = /^linear-gradient\([^<>"';]{4,180}\)$/.test(g.gradient)
        ? g.gradient
        : 'linear-gradient(135deg, #6a5cff, #2f81f7)'
      thumbEl.textContent = (g.emoji || '🎮').slice(0, 4)
    }
    ;(card.querySelector('h3') as HTMLElement).textContent = g.name
    ;(card.querySelector('.game-meta p') as HTMLElement).textContent = g.blurb || `by ${g.author}`
    ;(card.querySelector('.game-tag') as HTMLElement).textContent = `by ${g.author}`
    const embedBadge = card.querySelector('.embed-badge') as HTMLElement
    embedBadge.hidden = g.type !== 'embed'
    ;(card.querySelector('.community-stats') as HTMLElement).textContent = `▶ ${g.plays} · ♥ ${g.likes}`

    const act = (a: string) => card.querySelector(`[data-act="${a}"]`) as HTMLButtonElement
    act('play').onclick = () => { location.hash = g.type === 'embed' ? `#/play/embed/${g.id}` : `#/play/g/${g.id}` }
    // 🏆 best-win-time leaderboard (toggles a small list under the card)
    const lb = document.createElement('button')
    lb.className = 'btn small ghost tiny'
    lb.textContent = '🏆'
    lb.title = 'Leaderboard — fastest wins'
    lb.onclick = async () => {
      const open = card.querySelector('.lb-list')
      if (open) { open.remove(); return }
      const list = document.createElement('div')
      list.className = 'lb-list draft-note info'
      list.textContent = 'Loading…'
      card.querySelector('.draft-actions')!.after(list)
      try {
        const scores = await topScores(g.id)
        list.textContent = ''
        if (scores.length === 0) {
          list.textContent = 'No wins yet — be the first!'
        } else {
          scores.forEach((s, i) => {
            const row = document.createElement('div')
            row.textContent = `${i + 1}. ${s.name} — ${s.score}s`
            list.appendChild(row)
          })
        }
      } catch {
        list.textContent = 'Leaderboard unavailable.'
      }
    }
    ;(card.querySelector('[data-act="report"]') as HTMLElement).before(lb)
    const likeBtn = act('like')
    ;(likeBtn.querySelector('span') as HTMLElement).textContent = String(g.likes)
    likeBtn.onclick = async () => {
      try {
        const liked = await toggleLike(g.id)
        g.likes += liked ? 1 : -1
        ;(likeBtn.querySelector('span') as HTMLElement).textContent = String(g.likes)
        likeBtn.classList.toggle('liked', liked)
      } catch { /* offline — ignore */ }
    }
    act('report').onclick = async () => {
      act('report').disabled = true
      try {
        await reportGame(g.id, 'reported from portal')
        act('report').textContent = '✓'
      } catch { /* offline — ignore */ }
    }
    grid.appendChild(card)
  }
}

// ---------------- the shop (Bolts gamenomics) ----------------
function openShop() {
  const overlay = document.createElement('div')
  overlay.className = 'overlay-screen shop-overlay'
  const card = document.createElement('div')
  card.className = 'shop-card'
  overlay.appendChild(card)

  function render() {
    const eq = economy.equipped()
    card.innerHTML = `
      <div class="shop-head">
        <h2>🛍 Avatar Shop</h2>
        <div class="wallet">B$ <b>${economy.balance}</b> Bolts</div>
        <button class="btn small ghost" id="shopClose">✕</button>
      </div>
      <p class="shop-sub">Earn Bolts by playing: coins +1 · kills +10 · captures +50 · wins +25–150 · daily login +100.</p>
      <div class="shop-grid" id="shopGrid"></div>`
    const grid = card.querySelector('#shopGrid')!
    for (const item of CATALOG) {
      const owned = economy.owns(item.id)
      const equipped = (item.kind === 'shirt' ? eq.shirt : eq.trail) === item.id
      const div = document.createElement('div')
      div.className = 'shop-item' + (equipped ? ' eq' : '')
      div.innerHTML = `
        <div class="swatch big" style="background:${item.color}">${item.kind === 'trail' ? '✨' : ''}</div>
        <div class="shop-name"></div>
        <div class="shop-price">${item.price === 0 ? 'Free' : `B$ ${item.price}`}</div>`
      ;(div.querySelector('.shop-name') as HTMLElement).textContent = item.name
      const btn = document.createElement('button')
      btn.className = 'btn small' + (owned ? ' ghost' : '')
      btn.textContent = equipped ? 'Equipped ✓' : owned ? 'Equip' : 'Buy'
      btn.onclick = () => {
        if (!owned) {
          const res = economy.buy(item.id)
          if (!res.ok) {
            btn.textContent = res.reason === 'not enough Bolts' ? 'Need more B$' : 'Hmm…'
            setTimeout(render, 900)
            return
          }
        }
        economy.equip(equipped ? null : item.id, item.kind)
        render()
      }
      div.appendChild(btn)
      grid.appendChild(div)
    }
    ;(card.querySelector('#shopClose') as HTMLButtonElement).onclick = () => overlay.remove()
  }
  render()
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })
  document.body.appendChild(overlay)
}
