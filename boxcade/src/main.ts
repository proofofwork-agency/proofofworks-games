// Blobcade shell: the tiny hash router. Screens live elsewhere — the portal
// (home + shop + My Games) in portal.ts, the editor in editor.ts, games run
// through runtime/runtime.ts. Routes:
//   #/                   portal
//   #/play/<gameId>      built-in game (custom-map = legacy editor map)
//   #/play/draft/<key>   a local draft from My Games
//   #/play/d/<payload>   a shared game — the whole GameDoc rides in the link
//   #/editor             legacy link → Studio Floor Plan
//   #/studio[/<key>]     the 3D Studio (new draft, or edit an existing one)

import './style.css'
import { findGame } from './games'
import { runGame, type GameSession, type RunGameOptions } from './runtime/runtime'
import { CUSTOM_MAP_KEY, resolveEditorDraftKeyForStudio } from './editor'
import { renderStudio } from './studio/studio'
import { buildTextMap } from './sdk/textmap'
import { decodeGameDoc, buildGameFromDoc, GameDocError, hashGameDoc } from './sdk'
import { renderPortal, playerName } from './portal'
import { loadDraft, saveDraft } from './drafts'
import { deviceKey, getPublishedGame, countPlay, submitScore, creditStorePurchase, type PublishedGame } from './api'
import { economy } from './engine/economy'
import { migrateBlobcadeLocalStorage } from './storage-migration'
import type { GameDef, GameDoc } from './sdk'

// one-time migration: carry wallets/maps through both historical renames
// (freeblox/blux -> boxcade/bolts -> blobcade/blobcash).
migrateBlobcadeLocalStorage()

const app = document.getElementById('app')!
let session: GameSession | null = null
let editor: { dispose(): void } | null = null
let embedDispose: (() => void) | null = null
let booting = false

function customMapDef(): GameDef {
  const source = localStorage.getItem(CUSTOM_MAP_KEY) ?? '@lighting noon\n\nGGGGG\nGGSGG\nGGGGG\n'
  return {
    meta: {
      id: 'custom-map',
      name: 'My Custom Map',
      blurb: 'A map from the Blobcade editor.',
      emoji: '🗺',
      gradient: 'linear-gradient(135deg, #06d6a0, #2f81f7)',
      genre: 'Custom',
    },
    camera: 'orbit',
    build(w) {
      buildTextMap(w, source)
    },
    onStart(ctx) {
      ctx.hud.toast('Your map! Press Esc → Leave game to go back to the editor.')
    },
  }
}

function embedOrigin(src: string): string {
  return new URL(src).origin
}

function renderEmbedHost(game: PublishedGame) {
  if (game.type !== 'embed' || !game.url) throw new Error('not an external game')
  const embedUrlOrigin = embedOrigin(game.url)
  let awarded = 0
  let bucketAt = Date.now()

  app.className = ''
  app.innerHTML = ''
  const shell = document.createElement('div')
  shell.className = 'embed-shell'
  shell.style.cssText = 'position:fixed;inset:0;background:#050712;overflow:hidden;'

  const frame = document.createElement('iframe')
  frame.src = game.url
  frame.sandbox.add('allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.title = game.name
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;'

  const back = document.createElement('button')
  back.className = 'btn small ghost'
  back.textContent = '⬅ Blobcade'
  back.style.cssText = 'position:absolute;top:14px;left:14px;z-index:2;box-shadow:0 8px 24px rgba(0,0,0,.25);'
  back.onclick = () => { location.hash = '' }

  shell.append(frame, back)
  app.appendChild(shell)

  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return
    const data = event.data as { t?: string; v?: number; n?: number; reason?: string; seconds?: number }
    if (!data || data.v !== 1 || typeof data.t !== 'string') return
    if (event.origin !== 'null') {
      console.warn(`[blobcade] ignored embed bridge message from ${event.origin}; expected sandboxed opaque origin for ${embedUrlOrigin}`)
      return
    }
    const legacyBridge = data.t.startsWith('boxcade:')
    const bridgeType = legacyBridge
      ? data.t.replace(/^boxcade:/, 'blobcade:').replace('awardBolts', 'awardBlobcash')
      : data.t
    if (bridgeType === 'blobcade:ready') {
      // sandbox="allow-scripts" without allow-same-origin gives the child an
      // opaque origin, so the hello must use "*". The trust boundary is the
      // iframe window identity above, not the untrusted child origin.
      frame.contentWindow?.postMessage({
        t: legacyBridge ? 'boxcade:hello' : 'blobcade:hello',
        v: 1,
        name: playerName(),
        device: deviceKey(),
        room: '',
      }, '*')
      return
    }
    if (bridgeType === 'blobcade:awardBlobcash') {
      const now = Date.now()
      if (now - bucketAt >= 60_000) {
        bucketAt = now
        awarded = 0
      }
      const n = Math.max(1, Math.min(10, Math.floor(Number(data.n) || 0)))
      if (awarded + n > 30) {
        console.warn('[blobcade] embed awardBlobcash rate cap exceeded')
        return
      }
      awarded += n
      economy.earn(n, typeof data.reason === 'string' ? data.reason : 'external game')
      return
    }
    if (bridgeType === 'blobcade:submitScore') {
      const seconds = Number(data.seconds)
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) {
        void submitScore(game.id, Math.round(seconds * 10) / 10).catch(() => {})
      }
    }
  }

  window.addEventListener('message', onMessage)
  embedDispose = () => {
    window.removeEventListener('message', onMessage)
    frame.src = 'about:blank'
    embedDispose = null
  }
}

function renderDocError(err: unknown) {
  const lines = err instanceof GameDocError ? err.errors : [err instanceof Error ? err.message : 'unknown error']
  app.className = ''
  app.innerHTML = `
    <div class="portal"><div class="portal-inner">
      <div class="overlay-card" style="margin:80px auto;max-width:520px">
        <h2>😵 Couldn't load that game</h2>
        <div id="docErrs"></div>
        <button class="btn" id="docErrBack">⬅ Back to Blobcade</button>
      </div>
    </div></div>`
  const errBox = document.getElementById('docErrs')!
  for (const line of lines.slice(0, 6)) {
    const p = document.createElement('p')
    p.textContent = line
    errBox.appendChild(p)
  }
  document.getElementById('docErrBack')!.addEventListener('click', () => { location.hash = '' })
}

function hasScript(doc: unknown): doc is GameDoc & { script: string } {
  return typeof doc === 'object' && doc !== null && typeof (doc as GameDoc).script === 'string' && (doc as GameDoc).script!.trim() !== ''
}

async function ensureScriptAllowed(doc: GameDoc, source: string): Promise<boolean> {
  if (!hasScript(doc)) return false
  const key = `blobcade.script.ok.${hashGameDoc(doc as object)}`
  if (localStorage.getItem(key) === '1') return true
  const ok = window.confirm(`"${doc.meta.name}" contains a creator script from ${source}.\n\nScripts run in a sandbox without DOM, storage, or network access. Run it?`)
  if (ok) localStorage.setItem(key, '1')
  return ok
}

/** `?room=CODE` anywhere in the hash targets a specific multiplayer room */
function roomSuffix(): string {
  const code = location.hash.match(/[?&]room=([A-Za-z0-9]+)/)?.[1]
  return code ? `#${code.toUpperCase()}` : ''
}

/**
 * How a doc-based route can hop to another level of the SAME game in place.
 * Simple cross-game targets are plain hash changes (route() re-runs on
 * hashchange); `level:<n>` has no hash of its own, so the loaded doc and its
 * run options are captured here and replayed via {@link relaunchLevel}.
 */
interface GoToContext {
  relaunchLevel?: (level: number) => Promise<void>
}

/**
 * Route a portal touch / `goTo` rule. Cross-game forms become hash changes;
 * `level:<n>` re-launches the current doc at that level (when the call site
 * supplied a relauncher). Shared by every runGame call site.
 */
function handleGoTo(target: string, context: GoToContext = {}) {
  const level = target.match(/^level:(\d+)$/)
  if (level) {
    void context.relaunchLevel?.(parseInt(level[1], 10))
    return
  }
  if (target === 'home') { location.hash = ''; return }
  const g = target.match(/^g:([a-z0-9]+)$/)
  if (g) { location.hash = `#/play/g/${g[1]}`; return }
  const draft = target.match(/^draft:([\w-]+)$/)
  if (draft) { location.hash = `#/play/draft/${draft[1]}`; return }
  // code-game escape hatch: hop to a built-in game by id (docs can't emit this)
  const play = target.match(/^play:([\w-]+)$/)
  if (play) { location.hash = `#/play/${play[1]}`; return }
  console.warn('[blobcade] goToGame: unrecognized target', target)
}

/**
 * Re-launch `doc` at `level`, reusing the same run options but a level-scoped
 * room key (`<roomKey>-l<n>`) so level rooms don't mix. Disposes the current
 * session first and guards re-entry with `booting`, mirroring route().
 */
async function relaunchAtLevel(doc: GameDoc, level: number, roomKey: string, opts: RunGameOptions, allowScripts = false) {
  if (booting) return
  // human numbering: level 1 = the root game, level n≥2 = doc.levels[n-2].
  // a target that doesn't exist must NOT relaunch the root — a root rule
  // retargeting itself would relaunch forever.
  if (level >= 2 && !doc.levels?.[level - 2]) {
    console.warn(`[blobcade] goTo level:${level} — this game has no such level`)
    return
  }
  booting = true
  try {
    if (session) { session.dispose(); session = null }
    session = await runGame(buildGameFromDoc(doc, { level, allowScripts }), app, playerName(), {
      ...opts,
      roomKey: `${roomKey}-l${level}`,
    })
  } catch (err) {
    console.error('[blobcade] failed to enter level', err)
    renderDocError(err)
  } finally {
    booting = false
  }
}

async function route() {
  if (booting) return
  const shared = location.hash.match(/^#\/play\/d\/([A-Za-z0-9_-]+)/)
  const embedM = shared ? null : location.hash.match(/^#\/play\/embed\/([a-z0-9]+)/)
  const published = shared || embedM ? null : location.hash.match(/^#\/play\/g\/([a-z0-9]+)/)
  const draftM = shared || embedM || published ? null : location.hash.match(/^#\/play\/draft\/([\w-]+)/)
  const m = shared || embedM || published || draftM ? null : location.hash.match(/^#\/play\/([\w-]+)/)

  if (session) {
    session.dispose()
    session = null
  }
  if (editor) {
    editor.dispose()
    editor = null
  }
  if (embedDispose) embedDispose()

  if (location.hash.startsWith('#/editor')) {
    const key = resolveEditorDraftKeyForStudio(location.hash)
    history.replaceState(null, '', `#/studio/${key}?floorplan=1`)
    editor = renderStudio(app, key)
    return
  }

  const studioM = location.hash.match(/^#\/studio(?:\/([\w-]+))?/)
  if (studioM) {
    editor = renderStudio(app, studioM[1] ?? null)
    return
  }

  // shared game: the whole GameDoc travels inside the link — no server needed
  if (shared) {
    booting = true
    try {
      const doc = await decodeGameDoc(shared[1])
      const gameDoc = doc as GameDoc
      const allowScripts = await ensureScriptAllowed(gameDoc, 'a shared link')
      if (hasScript(gameDoc) && !allowScripts) throw new Error('script permission was not granted')
      const def = buildGameFromDoc(gameDoc, { allowScripts })
      // players holding the same link land in the same room family
      const roomKey = `d-${hashGameDoc(doc as object)}${roomSuffix()}`
      const runOpts: RunGameOptions = { roomKey }
      runOpts.onGoToGame = (target) =>
        handleGoTo(target, { relaunchLevel: (n) => relaunchAtLevel(gameDoc, n, roomKey, runOpts, allowScripts) })
      session = await runGame(def, app, playerName(), runOpts)
    } catch (err) {
      console.error('[blobcade] failed to load shared game', err)
      renderDocError(err)
    } finally {
      booting = false
    }
    return
  }

  // an approved external game hosted in a sandboxed iframe
  if (embedM) {
    booting = true
    try {
      const g = await getPublishedGame(embedM[1])
      if (g.type !== 'embed') {
        throw new Error('that published game is not an external embed')
      } else {
        countPlay(g.id)
        renderEmbedHost(g)
      }
    } catch (err) {
      console.error('[blobcade] failed to load external game', err)
      renderDocError(err)
    } finally {
      booting = false
    }
    return
  }

  // a published community game, fetched from the server by id
  if (published) {
    booting = true
    try {
      const g = await getPublishedGame(published[1])
      if (g.type === 'embed') {
        countPlay(g.id)
        renderEmbedHost(g)
        return
      }
      const doc = g.doc as GameDoc
      if (hasScript(doc)) throw new Error('published scripted games are not enabled yet — share this draft link instead')
      const def = buildGameFromDoc(doc)
      countPlay(g.id)
      // room key includes the doc hash: stale cached versions split cleanly
      const roomKey = `g-${g.id}-${hashGameDoc(doc as object)}${roomSuffix()}`
      const runOpts: RunGameOptions = {
        roomKey,
        // first win of the run goes on the game's leaderboard (best time)
        onVictory: (seconds) => void submitScore(g.id, Math.round(seconds * 10) / 10).catch(() => {}),
        // store buys pay the creator a 30% cut server-side
        onStoreBuy: (item) => void creditStorePurchase(g.id, item.id, item.price).catch(() => {}),
      }
      runOpts.onGoToGame = (target) =>
        handleGoTo(target, { relaunchLevel: (n) => relaunchAtLevel(doc, n, roomKey, runOpts) })
      session = await runGame(def, app, playerName(), runOpts)
    } catch (err) {
      console.error('[blobcade] failed to load published game', err)
      renderDocError(err)
    } finally {
      booting = false
    }
    return
  }

  // a local draft from My Games / the editor
  if (draftM) {
    const key = draftM[1]
    const doc = loadDraft(key)
    if (!doc) {
      renderDocError(new Error('this draft was not found — it may have been deleted'))
      return
    }
    booting = true
    try {
      const allowScripts = await ensureScriptAllowed(doc, 'your local draft')
      if (hasScript(doc) && !allowScripts) throw new Error('script permission was not granted')
      const roomKey = `draft-${key}${roomSuffix()}`
      const runOpts: RunGameOptions = {
        roomKey,
        // edited voxel terrain saves back into the same draft
        onSaveWorld(worldJson) {
          const latest = loadDraft(key) ?? doc
          latest.voxel = { ...latest.voxel, data: worldJson, seed: undefined, size: undefined }
          saveDraft(key, latest)
          return `💾 Saved into “${latest.meta.name}”`
        },
      }
      runOpts.onGoToGame = (target) =>
        handleGoTo(target, { relaunchLevel: (n) => relaunchAtLevel(doc, n, roomKey, runOpts, allowScripts) })
      session = await runGame(buildGameFromDoc(doc, { allowScripts }), app, playerName(), runOpts)
    } catch (err) {
      console.error('[blobcade] failed to start draft', err)
      renderDocError(err)
    } finally {
      booting = false
    }
    return
  }

  if (m) {
    const def = m[1] === 'custom-map' ? customMapDef() : findGame(m[1])
    if (def) {
      booting = true
      try {
        session = await runGame(def, app, playerName(), {
          roomKey: `${def.meta.id}${roomSuffix()}`,
          // code-game portals hop by hash (g:/draft:/home/play:); no level docs
          onGoToGame: (target) => handleGoTo(target),
          // built-in voxel games (Voxel Island) save edits as a NEW draft
          onSaveWorld(worldJson) {
            const doc: GameDoc = {
              blobcade: 'gamedoc',
              v: 1,
              meta: {
                name: `${def.meta.name} — my world`.slice(0, 48),
                emoji: '🏝',
                genre: 'Sandbox',
                blurb: 'A world built in Blobcade build mode.',
              },
              camera: 'fp',
              voxel: { data: worldJson },
            }
            saveDraft(null, doc)
            return '💾 Saved to My Games — find it on the home screen'
          },
        })
      } catch (err) {
        console.error('[blobcade] failed to start game', err)
        location.hash = ''
      } finally {
        booting = false
      }
      return
    }
    location.hash = ''
    return
  }

  renderPortal(app)
}

window.addEventListener('hashchange', route)
void route()
