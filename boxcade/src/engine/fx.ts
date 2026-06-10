// Lightweight particle pool: coin sparkles, death poofs, block-break debris,
// win confetti. One THREE.Points draw call for everything.

import * as THREE from 'three'

const MAX = 1200

interface P {
  alive: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
  size: number
  gravity: number
  color: THREE.Color
}

export class Particles {
  points: THREE.Points
  private pool: P[] = []
  private geo: THREE.BufferGeometry
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX * 3)
    this.colors = new Float32Array(MAX * 3)
    this.sizes = new Float32Array(MAX)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1))

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float psize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (220.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (dot(uv, uv) > 0.25) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
    })

    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        gravity: 0,
        color: new THREE.Color(),
      })
    }

    this.points = new THREE.Points(this.geo, mat)
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  burst(
    at: THREE.Vector3,
    opts: {
      count?: number
      colors?: string[]
      speed?: number
      life?: number
      size?: number
      gravity?: number
      spread?: number
      up?: number
    } = {},
  ) {
    const {
      count = 16,
      colors = ['#ffffff'],
      speed = 4,
      life = 0.7,
      size = 0.4,
      gravity = -10,
      spread = 1,
      up = 1.4,
    } = opts
    let spawned = 0
    for (const p of this.pool) {
      if (spawned >= count) break
      if (p.alive) continue
      p.alive = true
      p.pos.copy(at)
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * spread
      p.vel.set(Math.cos(a) * r * speed, (Math.random() * 0.7 + 0.4) * speed * up * 0.6, Math.sin(a) * r * speed)
      p.maxLife = p.life = life * (0.6 + Math.random() * 0.7)
      p.size = size * (0.7 + Math.random() * 0.6)
      p.gravity = gravity
      p.color.set(colors[Math.floor(Math.random() * colors.length)])
      spawned++
    }
  }

  confetti(at: THREE.Vector3) {
    this.burst(at, {
      count: 140,
      colors: ['#ff5d5d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff8fab'],
      speed: 9,
      life: 2.0,
      size: 0.5,
      gravity: -7,
      spread: 1.6,
      up: 2.2,
    })
  }

  update(dt: number) {
    let i = 0
    for (const p of this.pool) {
      if (p.alive) {
        p.life -= dt
        if (p.life <= 0) {
          p.alive = false
        } else {
          p.vel.y += p.gravity * dt
          p.pos.addScaledVector(p.vel, dt)
          const fade = Math.min(1, p.life / (p.maxLife * 0.4))
          this.positions[i * 3] = p.pos.x
          this.positions[i * 3 + 1] = p.pos.y
          this.positions[i * 3 + 2] = p.pos.z
          this.colors[i * 3] = p.color.r
          this.colors[i * 3 + 1] = p.color.g
          this.colors[i * 3 + 2] = p.color.b
          this.sizes[i] = p.size * fade
          i++
        }
      }
    }
    // park the rest far away
    for (let j = i; j < MAX; j++) {
      this.positions[j * 3 + 1] = -9999
      this.sizes[j] = 0
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.color.needsUpdate = true
    this.geo.attributes.psize.needsUpdate = true
  }
}
