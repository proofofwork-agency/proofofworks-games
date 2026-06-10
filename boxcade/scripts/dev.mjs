// `npm run dev` — starts the Vite client AND the multiplayer room server in
// one command, prefixing output. Ctrl-C stops both.

import { spawn } from 'node:child_process'

const procs = []

function run(name, cmd, args, color) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const tag = `\x1b[${color}m[${name}]\x1b[0m `
  const pipe = (stream) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (line.trim()) console.log(tag + line)
      }
    })
  }
  pipe(p.stdout)
  pipe(p.stderr)
  p.on('exit', (code) => {
    console.log(`${tag}exited (${code ?? 'signal'})`)
    shutdown()
  })
  procs.push(p)
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const p of procs) {
    try { p.kill('SIGTERM') } catch { /* noop */ }
  }
  setTimeout(() => process.exit(0), 200)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

run('server', process.execPath, ['server/server.mjs'], '32')
run('client', process.execPath, ['node_modules/vite/bin/vite.js'], '36')
