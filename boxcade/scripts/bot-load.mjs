#!/usr/bin/env node
// Headless websocket load harness for W6. It joins many synthetic players to
// one room, sends normal transform packets, and reports relay throughput.

import { WebSocket } from 'ws'
import { performance } from 'node:perf_hooks'

const opts = parseArgs(process.argv.slice(2))
const bots = numberOpt(opts.bots, 50)
const durationMs = numberOpt(opts.duration, 30) * 1000
const url = String(opts.url ?? 'ws://localhost:8081')
const game = String(opts.game ?? 'loadtest')
const room = String(opts.room ?? 'LOAD')
const max = numberOpt(opts.max, Math.max(64, bots))

let opened = 0
let welcomed = 0
let closed = 0
let errors = 0
let rxMessages = 0
let rxBytes = 0
let txMessages = 0
let txBytes = 0
const sockets = []
const t0 = performance.now()

for (let i = 0; i < bots; i++) {
  const ws = new WebSocket(url)
  sockets.push(ws)
  const phase = (i / Math.max(1, bots)) * Math.PI * 2
  const lane = 18 + (i % 8) * 7
  let joined = false
  let timer = null

  ws.on('open', () => {
    opened++
    send(ws, { t: 'j', g: `${game}#${room}`, n: `Bot${i}`, max })
    timer = setInterval(() => {
      if (!joined || ws.readyState !== WebSocket.OPEN) return
      const t = (performance.now() - t0) / 1000
      const x = Math.cos(t * 0.55 + phase) * lane
      const z = Math.sin(t * 0.55 + phase) * lane
      const y = 2 + Math.sin(t * 0.9 + phase) * 0.25
      send(ws, { t: 's', p: [round2(x), round2(y), round2(z)], r: round2(t + phase), a: 1 })
    }, 83)
  })

  ws.on('message', (data) => {
    rxMessages++
    rxBytes += data.length
    try {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'w' && !joined) {
        joined = true
        welcomed++
      }
    } catch { /* ignore non-protocol payloads */ }
  })

  ws.on('error', () => { errors++ })
  ws.on('close', () => {
    closed++
    if (timer) clearInterval(timer)
  })
}

setTimeout(() => {
  for (const ws of sockets) {
    try { ws.close() } catch { /* noop */ }
  }
}, durationMs)

setTimeout(() => {
  const elapsed = Math.max(0.001, (performance.now() - t0) / 1000)
  const result = {
    bots,
    durationSeconds: Math.round(elapsed * 10) / 10,
    url,
    game,
    room,
    max,
    opened,
    welcomed,
    closed,
    errors,
    rxMessages,
    txMessages,
    rxKbps: Math.round((rxBytes * 8) / elapsed / 1024),
    txKbps: Math.round((txBytes * 8) / elapsed / 1024),
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(errors > 0 || welcomed < bots ? 1 : 0)
}, durationMs + 1000)

function send(ws, msg) {
  const text = JSON.stringify(msg)
  txMessages++
  txBytes += Buffer.byteLength(text)
  ws.send(text)
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function numberOpt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      out[arg.slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
    }
  }
  return out
}
