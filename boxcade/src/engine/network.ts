// Multiplayer client. Talks to the Blobcade room server over WebSocket,
// keeps a snapshot buffer per remote player and interpolates 120ms in the
// past for silky movement. If no server is reachable the game silently
// plays solo — multiplayer is an upgrade, never a requirement.

export interface RemoteSnap {
  at: number
  x: number; y: number; z: number
  ry: number
  anim: number // 0 idle, 1 walk, 2 air
  vehicle: string // '' on foot, else 'car' | 'jetpack' | 'boat' | 'plane'
}

export interface RemotePlayer {
  id: number
  name: string
  snaps: RemoteSnap[]
  // sampled state (filled by sample())
  x: number; y: number; z: number
  ry: number
  anim: number
  speed: number
  vehicle: string
}

export interface ChatMsg {
  id: number
  name: string
  text: string
  system?: boolean
}

const INTERP_DELAY = 120 // ms

export class Net {
  online = false
  selfId = -1
  /** the instance code of the joined room ('' while offline) */
  roomCode = ''
  /** the room's host (oldest member) — hosts run host-only game logic */
  hostId = -1
  remotes = new Map<number, RemotePlayer>()

  onPlayerJoin: (p: RemotePlayer) => void = () => {}
  onPlayerLeave: (p: RemotePlayer) => void = () => {}
  onChat: (m: ChatMsg) => void = () => {}
  /** a relayed game event from another player (see sendEvent) */
  onEvent: (k: string, d: unknown, fromId: number) => void = () => {}
  onHostChange: (hostId: number) => void = () => {}
  /** server-validated PvP damage (any victim in the room, including self) */
  onPvpDamage: (e: { attackerId: number; victimId: number; damage: number; hp: number; headshot: boolean; weapon: string }) => void = () => {}
  onPvpKill: (e: { attackerId: number; attackerName: string; victimId: number; victimName: string; weapon: string }) => void = () => {}
  onPvpRespawn: (victimId: number) => void = () => {}

  private ws: WebSocket | null = null
  private lastSent = 0
  private closedByUs = false

  get isHost(): boolean {
    return !this.online || this.hostId === this.selfId
  }

  /**
   * gameKey may carry an explicit instance: 'sky-obby' auto-assigns,
   * 'sky-obby#ABCD' joins/creates that room code.
   */
  connect(gameId: string, name: string, maxPlayers = 64): Promise<boolean> {
    const url = `ws://${location.hostname}:8081`
    return new Promise((resolve) => {
      let settled = false
      const fail = () => {
        if (!settled) {
          settled = true
          this.online = false
          resolve(false)
        }
      }
      try {
        this.ws = new WebSocket(url)
      } catch {
        fail()
        return
      }
      const timer = setTimeout(() => {
        if (!settled) {
          try { this.ws?.close() } catch { /* noop */ }
          fail()
        }
      }, 1800)

      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify({ t: 'j', g: gameId, n: name, max: maxPlayers }))
      }
      this.ws.onerror = () => fail()
      this.ws.onclose = () => {
        this.online = false
        if (!settled) fail()
        else if (!this.closedByUs) {
          this.onChat({ id: -1, name: '', text: 'Disconnected from server — playing offline.', system: true })
        }
      }
      this.ws.onmessage = (ev) => {
        let m: any
        try { m = JSON.parse(ev.data as string) } catch { return }
        switch (m.t) {
          case 'w': {
            clearTimeout(timer)
            this.selfId = m.id
            this.roomCode = String(m.room ?? '')
            this.hostId = Number(m.host ?? m.id)
            this.online = true
            for (const p of m.players as Array<{ id: number; n: string; p: number[]; r: number }>) {
              this.addRemote(p.id, p.n, p.p, p.r)
            }
            if (!settled) {
              settled = true
              resolve(true)
            }
            break
          }
          case 'h': {
            this.hostId = Number(m.id)
            this.onHostChange(this.hostId)
            break
          }
          case 'e': {
            this.onEvent(String(m.k ?? ''), m.d, Number(m.id))
            break
          }
          case 'x': {
            this.onPvpDamage({
              attackerId: Number(m.a), victimId: Number(m.v), damage: Number(m.d),
              hp: Number(m.hp), headshot: !!m.h, weapon: String(m.w ?? ''),
            })
            break
          }
          case 'k': {
            this.onPvpKill({
              attackerId: Number(m.a), attackerName: String(m.an ?? '?'),
              victimId: Number(m.v), victimName: String(m.vn ?? '?'), weapon: String(m.w ?? ''),
            })
            break
          }
          case 'r': {
            this.onPvpRespawn(Number(m.v))
            break
          }
          case 'j': {
            const rp = this.addRemote(m.id, m.n, m.p, m.r)
            this.onPlayerJoin(rp)
            break
          }
          case 'l': {
            const rp = this.remotes.get(m.id)
            if (rp) {
              this.remotes.delete(m.id)
              this.onPlayerLeave(rp)
            }
            break
          }
          case 's': {
            const now = performance.now()
            for (const s of m.s as Array<Array<number | string>>) {
              const rp = this.remotes.get(s[0] as number)
              if (!rp) continue
              rp.snaps.push({
                at: now,
                x: s[1] as number, y: s[2] as number, z: s[3] as number,
                ry: s[4] as number, anim: s[5] as number,
                vehicle: typeof s[6] === 'string' ? s[6] : '', // [6] absent on old servers
              })
              if (rp.snaps.length > 30) rp.snaps.splice(0, rp.snaps.length - 30)
            }
            break
          }
          case 'c':
            this.onChat({ id: m.id, name: m.n ?? '', text: String(m.x ?? ''), system: !!m.sys })
            break
        }
      }
    })
  }

  private addRemote(id: number, name: string, p?: number[], r?: number): RemotePlayer {
    let rp = this.remotes.get(id)
    if (!rp) {
      const x = p?.[0] ?? 0
      const y = p?.[1] ?? 0
      const z = p?.[2] ?? 0
      rp = { id, name, snaps: [], x, y, z, ry: r ?? 0, anim: 0, speed: 0, vehicle: '' }
      rp.snaps.push({ at: performance.now(), x, y, z, ry: r ?? 0, anim: 0, vehicle: '' })
      this.remotes.set(id, rp)
    }
    return rp
  }

  sendState(x: number, y: number, z: number, ry: number, anim: number, vehicle = '') {
    if (!this.online || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const now = performance.now()
    if (now - this.lastSent < 80) return // ~12Hz
    this.lastSent = now
    const msg: Record<string, unknown> = {
      t: 's',
      p: [round2(x), round2(y), round2(z)],
      r: round2(ry),
      a: anim,
    }
    if (vehicle) msg.v = vehicle
    this.ws.send(JSON.stringify(msg))
  }

  sendChat(text: string) {
    if (!this.online || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'c', x: text.slice(0, 200) }))
    return true
  }

  /** relay a small game event to everyone else in the room (≤ ~2KB) */
  sendEvent(k: string, d?: unknown) {
    if (!this.online || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'e', k: k.slice(0, 32), d }))
    return true
  }

  /** claim a PvP hit — the server validates and broadcasts the verdict */
  sendHit(victimId: number, damage: number, headshot: boolean, weaponName: string) {
    if (!this.online || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'x', v: victimId, d: Math.round(damage), h: headshot, w: weaponName.slice(0, 24) }))
    return true
  }

  /** advance interpolation for all remotes */
  sample() {
    const t = performance.now() - INTERP_DELAY
    for (const rp of this.remotes.values()) {
      const s = rp.snaps
      if (s.length === 0) continue
      let a = s[0]
      let b = s[s.length - 1]
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i].at <= t) {
          a = s[i]
          b = s[Math.min(i + 1, s.length - 1)]
          break
        }
      }
      const span = Math.max(1, b.at - a.at)
      const k = Math.min(1.25, Math.max(0, (t - a.at) / span))
      const px = rp.x
      const pz = rp.z
      rp.x = a.x + (b.x - a.x) * k
      rp.y = a.y + (b.y - a.y) * k
      rp.z = a.z + (b.z - a.z) * k
      let dr = (b.ry - a.ry) % (Math.PI * 2)
      if (dr > Math.PI) dr -= Math.PI * 2
      if (dr < -Math.PI) dr += Math.PI * 2
      rp.ry = a.ry + dr * Math.min(1, k)
      rp.anim = b.anim
      rp.vehicle = b.vehicle
      rp.speed = Math.hypot(rp.x - px, rp.z - pz) * 60
    }
  }

  dispose() {
    this.closedByUs = true
    try { this.ws?.close() } catch { /* noop */ }
    this.ws = null
    this.remotes.clear()
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
