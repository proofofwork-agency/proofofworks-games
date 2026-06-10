// Chunked voxel terrain — the sandbox DNA in Boxcade. 16x16 chunks,
// hidden-face culling, classic per-vertex ambient occlusion (the corner
// darkening that makes flat-colored blocks read as 3D), face shading and
// per-block color jitter. Meshes rebuild per chunk on edit.

import * as THREE from 'three'
import { makeNoise2D, fbm2, mulberry32, type Vec3 } from './math'
import type { Box, ColliderSource } from './physics'

export const AIR = 0
export const GRASS = 1
export const DIRT = 2
export const STONE = 3
export const SAND = 4
export const WOOD = 5
export const LEAVES = 6
export const PLANK = 7
export const BRICK = 8
export const GLOW = 9
export const WATER = 10

export interface BlockInfo {
  name: string
  top: string
  side: string
  bottom: string
  glow?: boolean
}

export const BLOCKS: Record<number, BlockInfo> = {
  [GRASS]: { name: 'Grass', top: '#69c24b', side: '#8a6a43', bottom: '#7d5f3c' },
  [DIRT]: { name: 'Dirt', top: '#8a6a43', side: '#8a6a43', bottom: '#7d5f3c' },
  [STONE]: { name: 'Stone', top: '#9aa0a6', side: '#8f959b', bottom: '#83898f' },
  [SAND]: { name: 'Sand', top: '#e9d9a4', side: '#e2d098', bottom: '#d4c28b' },
  [WOOD]: { name: 'Wood', top: '#9a7148', side: '#74512f', bottom: '#9a7148' },
  [LEAVES]: { name: 'Leaves', top: '#4f9e3c', side: '#479237', bottom: '#3f832f' },
  [PLANK]: { name: 'Planks', top: '#c89c62', side: '#bf945c', bottom: '#b08753' },
  [BRICK]: { name: 'Brick', top: '#b5564e', side: '#aa4f48', bottom: '#9c4842' },
  [GLOW]: { name: 'Glow', top: '#ffd97a', side: '#ffd97a', bottom: '#ffd97a', glow: true },
  [WATER]: { name: 'Water', top: '#3f7fd6', side: '#3a76c8', bottom: '#3a76c8' },
}

const CHUNK = 16
const AO_LEVELS = [0.66, 0.8, 0.91, 1.0]

// face corner tables — winding chosen so cross(e1, e2) == outward normal
interface Face {
  nx: number; ny: number; nz: number
  corners: [number, number, number][]
  shade: number
}
const FACES: Face[] = [
  { nx: 0, ny: 1, nz: 0, shade: 1.0, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { nx: 0, ny: -1, nz: 0, shade: 0.72, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { nx: 1, ny: 0, nz: 0, shade: 0.88, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { nx: -1, ny: 0, nz: 0, shade: 0.88, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { nx: 0, ny: 0, nz: 1, shade: 0.94, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { nx: 0, ny: 0, nz: -1, shade: 0.94, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
]

function hashCell(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

export interface VoxelHit {
  x: number; y: number; z: number
  nx: number; ny: number; nz: number
  type: number
}

export class VoxelWorld implements ColliderSource {
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly seaLevel: number
  group = new THREE.Group()

  private data: Uint8Array
  private chunksX: number
  private chunksZ: number
  private chunkMeshes: (THREE.Mesh | null)[][] = [] // [chunkIndex][0=opaque,1=water,2=glow]
  /** live list of water-surface meshes — pass to Renderer.enableReflections so
   *  the ocean mirrors the island (kept in sync across chunk rebuilds) */
  waterMeshes: THREE.Mesh[] = []
  private opaqueMat: THREE.MeshStandardMaterial
  private waterMat: THREE.MeshStandardMaterial
  private glowMat: THREE.MeshStandardMaterial

  constructor(sx = 96, sy = 42, sz = 96, seaLevel = 10) {
    this.sx = sx
    this.sy = sy
    this.sz = sz
    this.seaLevel = seaLevel
    this.data = new Uint8Array(sx * sy * sz)
    this.chunksX = Math.ceil(sx / CHUNK)
    this.chunksZ = Math.ceil(sz / CHUNK)
    for (let i = 0; i < this.chunksX * this.chunksZ; i++) this.chunkMeshes.push([null, null, null])

    this.opaqueMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
    this.waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.12, metalness: 0,
      transparent: true, opacity: 0.72, depthWrite: false,
    })
    this.glowMat = new THREE.MeshStandardMaterial({
      color: '#ffd97a', emissive: '#ffc44d', emissiveIntensity: 1.6, roughness: 0.5,
    })
  }

  private idx(x: number, y: number, z: number) {
    return (y * this.sz + z) * this.sx + x
  }
  inBounds(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz
  }
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return y < 0 ? STONE : AIR
    return this.data[this.idx(x, y, z)]
  }
  private isSolid(x: number, y: number, z: number) {
    const t = this.get(x, y, z)
    return t !== AIR && t !== WATER
  }

  set(x: number, y: number, z: number, type: number) {
    if (!this.inBounds(x, y, z)) return
    this.data[this.idx(x, y, z)] = type
    // rebuild this chunk and any neighbor chunk the cell borders
    const cs = new Set<number>()
    for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const cx = Math.floor((x + dx) / CHUNK)
      const cz = Math.floor((z + dz) / CHUNK)
      if (cx >= 0 && cz >= 0 && cx < this.chunksX && cz < this.chunksZ) cs.add(cz * this.chunksX + cx)
    }
    for (const ci of cs) this.buildChunk(ci % this.chunksX, Math.floor(ci / this.chunksX))
  }

  surfaceY(x: number, z: number): number {
    for (let y = this.sy - 1; y >= 0; y--) {
      if (this.isSolid(x, y, z)) return y + 1
    }
    return this.seaLevel + 1
  }

  isWater(x: number, y: number, z: number): boolean {
    return this.get(Math.floor(x), Math.floor(y), Math.floor(z)) === WATER
  }

  // ---- generation ----

  generateIsland(seed = 1337) {
    const noise = makeNoise2D(seed)
    const rng = mulberry32(seed ^ 0x9e3779b9)
    const cx = this.sx / 2
    const cz = this.sz / 2
    const maxR = Math.min(this.sx, this.sz) * 0.46

    for (let x = 0; x < this.sx; x++) {
      for (let z = 0; z < this.sz; z++) {
        const d = Math.hypot(x - cx, z - cz) / maxR
        const falloff = Math.max(0, 1 - d * d * 1.05)
        const n = fbm2(noise, x * 0.032, z * 0.032, 4)
        let h = Math.floor(3 + falloff * (this.seaLevel - 1 + 9 + n * 8))
        h = Math.max(1, Math.min(this.sy - 8, h))
        for (let y = 0; y <= h; y++) {
          let t = STONE
          if (y === h) {
            t = h <= this.seaLevel + 1 ? SAND : GRASS
          } else if (y >= h - 3) {
            t = h <= this.seaLevel + 1 ? SAND : DIRT
          }
          this.data[this.idx(x, y, z)] = t
        }
        // fill water above terrain up to sea level
        for (let y = h + 1; y <= this.seaLevel; y++) {
          this.data[this.idx(x, y, z)] = WATER
        }
      }
    }

    // trees
    const treeCount = 26
    let placed = 0
    for (let attempt = 0; attempt < 400 && placed < treeCount; attempt++) {
      const x = 4 + Math.floor(rng() * (this.sx - 8))
      const z = 4 + Math.floor(rng() * (this.sz - 8))
      const y = this.surfaceY(x, z)
      if (this.get(x, y - 1, z) !== GRASS || y > this.sy - 9) continue
      const trunkH = 4 + Math.floor(rng() * 2)
      for (let i = 0; i < trunkH; i++) this.data[this.idx(x, y + i, z)] = WOOD
      const ly = y + trunkH
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
            if (dy === 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue
            const px = x + dx
            const py = ly + dy
            const pz = z + dz
            if (this.inBounds(px, py, pz) && this.get(px, py, pz) === AIR) {
              this.data[this.idx(px, py, pz)] = LEAVES
            }
          }
        }
      }
      if (this.inBounds(x, ly + 2, z)) this.data[this.idx(x, ly + 2, z)] = LEAVES
      placed++
    }
  }

  buildAll() {
    for (let cz = 0; cz < this.chunksZ; cz++) {
      for (let cx = 0; cx < this.chunksX; cx++) this.buildChunk(cx, cz)
    }
  }

  // ---- meshing ----

  private buildChunk(cx: number, cz: number) {
    const ci = cz * this.chunksX + cx
    const old = this.chunkMeshes[ci]
    for (const m of old) {
      if (m) {
        this.group.remove(m)
        m.geometry.dispose()
        const wi = this.waterMeshes.indexOf(m)
        if (wi >= 0) this.waterMeshes.splice(wi, 1)
      }
    }
    this.chunkMeshes[ci] = [null, null, null]

    const x0 = cx * CHUNK
    const z0 = cz * CHUNK
    const x1 = Math.min(x0 + CHUNK, this.sx)
    const z1 = Math.min(z0 + CHUNK, this.sz)

    const builders = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()] // opaque, water, glow
    const color = new THREE.Color()

    for (let y = 0; y < this.sy; y++) {
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          const t = this.data[this.idx(x, y, z)]
          if (t === AIR) continue
          const info = BLOCKS[t]
          const isWaterBlock = t === WATER
          const builder = isWaterBlock ? builders[1] : info.glow ? builders[2] : builders[0]

          for (const f of FACES) {
            const nxp = x + f.nx
            const nyp = y + f.ny
            const nzp = z + f.nz
            const nb = this.get(nxp, nyp, nzp)
            if (isWaterBlock) {
              if (nb !== AIR) continue // water surface only faces air
              // no phantom water walls at the world border: out-of-bounds at
              // or below sea level reads as more ocean, not as air
              if (!this.inBounds(nxp, nyp, nzp) && nyp <= this.seaLevel) continue
            } else {
              if (nb !== AIR && nb !== WATER) continue
            }

            const baseHex = f.ny > 0 ? info.top : f.ny < 0 ? info.bottom : info.side
            color.set(baseHex)
            const jitter = 0.94 + hashCell(x, y, z) * 0.1
            const vcols: number[][] = []
            const aos: number[] = []

            for (const c of f.corners) {
              let ao = 3
              if (!isWaterBlock) {
                ao = this.cornerAO(x, y, z, f, c)
              }
              aos.push(ao)
              const b = AO_LEVELS[ao] * f.shade * jitter
              vcols.push([color.r * b, color.g * b, color.b * b])
            }

            // water surface sits slightly below the top of the cell
            const yShrink = isWaterBlock && f.ny > 0 ? 0.12 : 0
            builder.quad(
              f.corners.map((c) => [x + c[0], y + c[1] - (c[1] === 1 ? yShrink : 0), z + c[2]]),
              [f.nx, f.ny, f.nz],
              vcols,
              aos,
            )
          }
        }
      }
    }

    const mats = [this.opaqueMat, this.waterMat, this.glowMat]
    builders.forEach((b, i) => {
      if (b.empty()) return
      const mesh = new THREE.Mesh(b.build(), mats[i])
      mesh.castShadow = i === 0
      mesh.receiveShadow = true
      if (i === 1) {
        mesh.renderOrder = 2
        this.waterMeshes.push(mesh)
      }
      this.group.add(mesh)
      this.chunkMeshes[ci][i] = mesh
    })
  }

  private cornerAO(x: number, y: number, z: number, f: Face, corner: [number, number, number]): number {
    // tangent axes of the face
    const axes = [0, 1, 2].filter((a) => [f.nx, f.ny, f.nz][a] === 0)
    const pos = [x, y, z]
    const n = [f.nx, f.ny, f.nz]
    const s = [0, 0, 0]
    const t = [0, 0, 0]
    s[axes[0]] = corner[axes[0]] === 1 ? 1 : -1
    t[axes[1]] = corner[axes[1]] === 1 ? 1 : -1

    const sx = pos[0] + n[0] + s[0]
    const sy = pos[1] + n[1] + s[1]
    const sz = pos[2] + n[2] + s[2]
    const tx = pos[0] + n[0] + t[0]
    const ty = pos[1] + n[1] + t[1]
    const tz = pos[2] + n[2] + t[2]
    const c1 = this.isSolid(sx, sy, sz) ? 1 : 0
    const c2 = this.isSolid(tx, ty, tz) ? 1 : 0
    const cc = this.isSolid(pos[0] + n[0] + s[0] + t[0], pos[1] + n[1] + s[1] + t[1], pos[2] + n[2] + s[2] + t[2]) ? 1 : 0
    if (c1 && c2) return 0
    return 3 - (c1 + c2 + cc)
  }

  // ---- queries ----

  collect(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Box[]) {
    const x0 = Math.max(0, Math.floor(minX))
    const y0 = Math.max(0, Math.floor(minY))
    const z0 = Math.max(0, Math.floor(minZ))
    const x1 = Math.min(this.sx - 1, Math.floor(maxX))
    const y1 = Math.min(this.sy - 1, Math.floor(maxY))
    const z1 = Math.min(this.sz - 1, Math.floor(maxZ))
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const t = this.data[this.idx(x, y, z)]
          if (t === AIR || t === WATER) continue
          out.push({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 })
        }
      }
    }
  }

  /** Amanatides-Woo DDA voxel raycast. */
  raycast(origin: Vec3, dir: { x: number; y: number; z: number }, maxDist = 7): VoxelHit | null {
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)
    const stepX = dir.x > 0 ? 1 : -1
    const stepY = dir.y > 0 ? 1 : -1
    const stepZ = dir.z > 0 ? 1 : -1
    const tDeltaX = Math.abs(1 / (dir.x || 1e-9))
    const tDeltaY = Math.abs(1 / (dir.y || 1e-9))
    const tDeltaZ = Math.abs(1 / (dir.z || 1e-9))
    let tMaxX = ((stepX > 0 ? x + 1 - origin.x : origin.x - x)) * tDeltaX
    let tMaxY = ((stepY > 0 ? y + 1 - origin.y : origin.y - y)) * tDeltaY
    let tMaxZ = ((stepZ > 0 ? z + 1 - origin.z : origin.z - z)) * tDeltaZ
    let nx = 0
    let ny = 0
    let nz = 0
    let t = 0

    while (t <= maxDist) {
      const type = this.get(x, y, z)
      if (type !== AIR && type !== WATER) {
        return { x, y, z, nx, ny, nz, type }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ
      }
    }
    return null
  }

  serialize(): string {
    // simple RLE: [count, type] pairs
    const runs: number[] = []
    let cur = this.data[0]
    let count = 0
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] === cur && count < 0xffff) count++
      else {
        runs.push(count, cur)
        cur = this.data[i]
        count = 1
      }
    }
    runs.push(count, cur)
    return JSON.stringify({
      boxcade: 'voxel-world/v1',
      size: [this.sx, this.sy, this.sz],
      seaLevel: this.seaLevel,
      rle: runs,
    })
  }

  /**
   * Revive a world saved by serialize(). Accepts the JSON string or an
   * already-parsed object. Throws with a friendly message on bad input —
   * callers surface it to the player (corrupt file / wrong file type).
   */
  static deserialize(saved: string | object): VoxelWorld {
    let obj: { boxcade?: string; size?: unknown; seaLevel?: number; rle?: unknown }
    try {
      obj = typeof saved === 'string' ? JSON.parse(saved) : (saved as Record<string, unknown>)
    } catch {
      throw new Error('voxel world: not valid JSON')
    }
    if (!obj || obj.boxcade !== 'voxel-world/v1') {
      throw new Error('voxel world: not a Boxcade voxel-world/v1 file')
    }
    const size = obj.size
    if (!Array.isArray(size) || size.length !== 3 || size.some((n) => !Number.isInteger(n) || n < 1 || n > 512)) {
      throw new Error('voxel world: bad size')
    }
    const [sx, sy, sz] = size as [number, number, number]
    const rle = obj.rle
    if (!Array.isArray(rle) || rle.length % 2 !== 0) {
      throw new Error('voxel world: bad block data')
    }
    const vw = new VoxelWorld(sx, sy, sz, typeof obj.seaLevel === 'number' ? obj.seaLevel : 10)
    let i = 0
    for (let r = 0; r < rle.length; r += 2) {
      const count = rle[r]
      const type = rle[r + 1]
      if (!Number.isInteger(count) || count < 1 || !Number.isInteger(type) || type < 0 || type > 255 || i + count > vw.data.length) {
        throw new Error('voxel world: corrupt block data')
      }
      vw.data.fill(type, i, i + count)
      i += count
    }
    if (i !== vw.data.length) throw new Error('voxel world: block data does not match size')
    return vw
  }
}

class GeoBuilder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []
  private vcount = 0

  quad(corners: number[][], normal: number[], vcols: number[][], aos: number[]) {
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.colors.push(vcols[i][0], vcols[i][1], vcols[i][2])
    }
    const v = this.vcount
    // flip the quad diagonal when AO is anisotropic (classic fix for AO seams)
    if (aos[0] + aos[2] > aos[1] + aos[3]) {
      this.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
    } else {
      this.indices.push(v + 1, v + 2, v + 3, v + 1, v + 3, v)
    }
    this.vcount += 4
  }

  empty() {
    return this.vcount === 0
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geo.setIndex(this.indices)
    return geo
  }
}
