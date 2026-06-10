import * as THREE from 'three';

// Builds and animates the level: instanced masonry, traps, gates, pickups,
// torch lights, parallax skyline, graffiti, neon — everything that glows.

const GRAFFITI = ['FRESH', 'STAY FLY', 'YO!', 'ROYAL', '100%', 'NO SLEEP', 'HEIGHTS', 'BOOM'];
const NEON_COLORS = ['#ff2d95', '#19e3ff', '#ffd54a', '#7cff4f'];
const NEON_TEXT = [
  'PERSEPOLIS HEIGHTS', 'THE DUNGEON CLUB', 'ROOFTOP RUN', 'THE GRAND BAZAAR',
  'AQUEDUCT NIGHTS', 'TOWER OF BASS', 'DJ VIZIER LIVE',
];

function rnd(seed) { // deterministic pseudo-random
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function textTexture(text, { color = '#ffd54a', size = 90, glow = 14, font = 'Bungee' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${size}px ${font}, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + glow * 4;
  c.width = Math.max(2, w); c.height = size + glow * 4;
  const ctx2 = c.getContext('2d');
  ctx2.font = `${size}px ${font}, sans-serif`;
  ctx2.textBaseline = 'middle';
  ctx2.shadowColor = color; ctx2.shadowBlur = glow;
  ctx2.fillStyle = color;
  ctx2.fillText(text, glow * 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

export class World {
  constructor(game, lvl) {
    this.game = game;
    this.lvl = lvl;
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.torches = [];
    this.banners = [];
    this.rings = [];
    this.neons = [];
    this.woofers = [];
    this.pickups = [];
    this.spikeMeshes = [];
    this.chomperMeshes = [];
    this.crumbleMeshes = [];
    this.plateMeshes = [];
    this.gateMeshes = [];
    this.hazardSet = new Set();
    for (const s of lvl.spikes) this.hazardSet.add(s.x + ',' + s.y);
    for (const c of lvl.chompers) this.hazardSet.add(c.x + ',' + c.y);

    this.buildSky();
    this.buildLights();
    this.buildSolids();
    this.buildTraps();
    this.buildProps();
    this.buildBackdrop();
    this.buildExit();
  }

  isSolid(tx, ty) {
    if (tx < 0 || tx >= this.lvl.width) return true;
    const v = this.lvl.tiles.get(tx + ',' + ty);
    if (!v) return false;
    if (v.t === '#') return true;
    if (v.t === 'f') return !v.fallen;
    if (v.t === 'g') return !v.open;
    return false;
  }
  isHazard(tx, ty) { return this.hazardSet.has(tx + ',' + ty); }

  groundTopAt(x) {
    for (let y = 0; y < this.lvl.height - 1; y++) {
      if (this.isSolid(x, y) && !this.isSolid(x, y + 1)) return y + 1;
    }
    return null;
  }

  // ---------- build ----------
  buildSky() {
    const c = document.createElement('canvas');
    c.width = 2; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#05030f');
    grad.addColorStop(0.55, '#150b33');
    grad.addColorStop(0.85, '#3a1657');
    grad.addColorStop(1, '#56216e');
    g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.game.scene.background = tex;
    this.game.scene.fog = new THREE.Fog(0x140a2e, 20, 60);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0x6f5fc9, 0x40291a, 0.5);
    this.root.add(hemi);
    const moon = new THREE.DirectionalLight(0xbfd3ff, 1.0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -16; moon.shadow.camera.right = 16;
    moon.shadow.camera.top = 16; moon.shadow.camera.bottom = -16;
    moon.shadow.camera.near = 0.5; moon.shadow.camera.far = 50;
    moon.shadow.bias = -0.0006;
    this.root.add(moon, moon.target);
    this.moon = moon;
    const fill = new THREE.DirectionalLight(0x19e3ff, 0.18);
    fill.position.set(-4, 3, 9);
    this.root.add(fill);
  }

  buildSolids() {
    const solids = [];
    for (const [k, v] of this.lvl.tiles) if (v.t === '#') solids.push(k);
    const geo = new THREE.BoxGeometry(0.995, 0.995, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02 });
    const inst = new THREE.InstancedMesh(geo, mat, solids.length);
    inst.castShadow = inst.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    solids.forEach((k, i) => {
      const [x, y] = k.split(',').map(Number);
      m4.setPosition(x + 0.5, y + 0.5, 0);
      inst.setMatrixAt(i, m4);
      const h = rnd(x * 7 + y * 13);
      col.setHSL(0.07 + h * 0.025, 0.38, 0.34 + ((x + y) % 2) * 0.045 + h * 0.06);
      inst.setColorAt(i, col);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.root.add(inst);
  }

  buildTraps() {
    const lvl = this.lvl;
    // crumbling slabs
    for (const cr of lvl.crumbles) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.96, 0.32, 0.96),
        new THREE.MeshStandardMaterial({ color: 0xb08f60, roughness: 0.9 })
      );
      m.position.set(cr.x + 0.5, cr.y + 0.84, 0);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
      this.crumbleMeshes.push({ ...cr, m, state: 0, t: 0, vy: 0 });
    }
    // spikes
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd6, metalness: 0.85, roughness: 0.25 });
    for (const s of lvl.spikes) {
      const g = new THREE.Group();
      g.position.set(s.x + 0.5, s.y, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a2330, roughness: 0.8 }));
      base.position.y = 0.04;
      g.add(base);
      const cones = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 6), spikeMat);
        cone.position.set(-0.33 + i * 0.22, 0.3, (i % 2) * 0.18 - 0.09);
        cone.castShadow = true;
        cones.add(cone);
      }
      cones.scale.y = 0.05;
      g.add(cones);
      this.root.add(g);
      this.spikeMeshes.push({ ...s, cones, ext: 0 });
    }
    // chompers
    for (const ch of lvl.chompers) {
      const g = new THREE.Group();
      g.position.set(ch.x + 0.5, ch.y, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8c7430, metalness: 0.75, roughness: 0.35 });
      const mkJaw = (up) => {
        const jaw = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.92, up ? 0.6 : 0.34, 0.74), mat);
        jaw.add(block);
        for (let i = 0; i < 3; i++) {
          const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 5), mat);
          tooth.position.set(-0.26 + i * 0.26, up ? -(0.3 + 0.1) : (0.17 + 0.1), 0);
          if (up) tooth.rotation.z = Math.PI;
          jaw.add(tooth);
        }
        jaw.children[0].castShadow = true;
        return jaw;
      };
      const top = mkJaw(true); top.position.y = 2.05;
      const bot = mkJaw(false); bot.position.y = 0.18;
      for (const z of [-0.5, 0.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.3, 0.16), new THREE.MeshStandardMaterial({ color: 0x3a2f3f, roughness: 0.8 }));
        post.position.set(0, 1.15, z);
        g.add(post);
      }
      g.add(top, bot);
      this.root.add(g);
      this.chomperMeshes.push({ ...ch, top, bot, closed: 0, wasClosing: false });
    }
    // pressure plates
    for (const p of lvl.plates) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3, emissive: 0x553f00, emissiveIntensity: 0.6 })
      );
      m.position.set(p.x + 0.5, p.y + 0.05, 0);
      m.receiveShadow = true;
      this.root.add(m);
      this.plateMeshes.push({ p, m });
    }
    // gates (gold bars)
    for (const gate of lvl.gates) {
      const h = gate.ys.length;
      const y0 = Math.min(...gate.ys);
      const grp = new THREE.Group();
      grp.position.set(gate.x + 0.5, y0, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.3 });
      for (let i = 0; i < 4; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 8), mat);
        bar.position.set(0, h / 2, -0.3 + i * 0.2);
        bar.castShadow = true;
        grp.add(bar);
      }
      for (const yy of [0.18, h - 0.18]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.78), mat);
        cross.position.set(0, yy, 0);
        grp.add(cross);
      }
      this.root.add(grp);
      this.gateMeshes.push({ gate, grp, baseY: y0, h });
    }
    // pickups
    for (const p of this.lvl.pickups) this.addPickup(p.x, p.y, p.kind);
  }

  addPickup(x, y, kind) {
    let m;
    if (kind === 'sword') {
      m = new THREE.Group();
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.9, 0.03),
        new THREE.MeshStandardMaterial({ color: 0xd8e6ff, metalness: 0.95, roughness: 0.1, emissive: 0x3355aa, emissiveIntensity: 0.9 })
      );
      const hilt = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.06, 0.08),
        new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 0.9, roughness: 0.2, emissive: 0x6b5200, emissiveIntensity: 0.7 })
      );
      hilt.position.y = -0.3;
      m.add(blade, hilt);
      m.rotation.z = 0.6;
    } else if (kind === 'tape' || kind === 'mixtape') {
      const gold = kind === 'mixtape';
      m = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.3, 0.09),
        new THREE.MeshStandardMaterial({
          color: gold ? 0xffd54a : 0x1c1c24, metalness: gold ? 0.9 : 0.3, roughness: 0.3,
          emissive: gold ? 0xaa7700 : 0x000000, emissiveIntensity: 1.1,
        })
      );
      const label = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.16, 0.1),
        new THREE.MeshStandardMaterial({ color: gold ? 0xfff3c4 : 0xff2d95, emissive: gold ? 0xffcc55 : 0xff2d95, emissiveIntensity: gold ? 1.2 : 0.7 })
      );
      m.add(body, label);
    } else { // soda / bigsoda
      const big = kind === 'bigsoda';
      m = new THREE.Mesh(
        new THREE.CylinderGeometry(big ? 0.16 : 0.12, big ? 0.16 : 0.12, big ? 0.46 : 0.34, 10),
        new THREE.MeshStandardMaterial({
          color: big ? 0xffd54a : 0x19e3ff, metalness: 0.7, roughness: 0.25,
          emissive: big ? 0xaa7700 : 0x0b6677, emissiveIntensity: 0.9,
        })
      );
    }
    m.position.set(x, y, 0);
    m.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.root.add(m);
    this.pickups.push({ x, y, kind, m, taken: false });
  }

  spawnMixtape(x, y) { this.addPickup(x, y, 'mixtape'); this.game.audio.fanfare(); }
  hasBoss() { return this.lvl.guards.some(g => g.tier === 'boss'); }
  exitOpen() { return this.hasBoss() ? this.game.flags.hasMixtape : true; }

  buildExit() {
    const e = this.lvl.exit;
    if (!e) return;
    const g = new THREE.Group();
    g.position.set(e.x + 0.5, e.y, 0);
    const gold = new THREE.MeshStandardMaterial({ color: 0xb08d2f, metalness: 0.7, roughness: 0.35 });
    for (const s of [-0.55, 0.55]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.5, 0.5), gold);
      pillar.position.set(s, 1.25, 0);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 0.55), gold);
    lintel.position.set(0, 2.62, 0);
    lintel.castShadow = true;
    g.add(lintel);
    this.exitGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 2.34),
      new THREE.MeshBasicMaterial({ color: 0x19e3ff, transparent: true, opacity: 0.85 })
    );
    this.exitGlow.position.set(0, 1.2, -0.15);
    g.add(this.exitGlow);
    this.exitBars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), gold);
      bar.position.set(-0.25 + i * 0.25, 1.2, 0.1);
      this.exitBars.add(bar);
    }
    g.add(this.exitBars);
    this.root.add(g);
  }

  buildProps() {
    // torches
    for (const t of this.lvl.torches) {
      const g = new THREE.Group();
      g.position.set(t.x, t.y, -0.2);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9 }));
      bracket.position.y = -0.05;
      g.add(bracket);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.11, 0.36, 7),
        new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff7a26, emissiveIntensity: 2.6 })
      );
      flame.position.y = 0.3;
      g.add(flame);
      const light = new THREE.PointLight(0xff8a3d, 1.6, 7.5, 1.8);
      light.position.y = 0.4;
      g.add(light);
      this.root.add(g);
      this.torches.push({ g, flame, light, seed: t.x * 3.7 });
    }
    // boomboxes
    for (const b of this.lvl.boomboxes) {
      const g = new THREE.Group();
      g.position.set(b.x, b.y + 0.26, 0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.32), new THREE.MeshStandardMaterial({ color: 0x1d1d26, metalness: 0.5, roughness: 0.4 }));
      body.castShadow = true;
      g.add(body);
      for (const s of [-0.26, 0.26]) {
        const spk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 0.05, 14),
          new THREE.MeshStandardMaterial({ color: 0x111118, emissive: 0xff2d95, emissiveIntensity: 0.9 })
        );
        spk.rotation.x = Math.PI / 2;
        spk.position.set(s, 0, 0.17);
        g.add(spk);
        this.woofers.push(spk);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x444455 }));
      handle.position.y = 0.33;
      g.add(handle);
      this.root.add(g);
    }
    // DJ booth behind the boss spawn
    const boss = this.lvl.guards.find(g => g.tier === 'boss');
    if (boss) {
      const g = new THREE.Group();
      const floor = this.groundTopAt(Math.floor(boss.x)) ?? boss.y;
      g.position.set(boss.x, floor, -1.9);
      const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x221833, roughness: 0.6 }));
      table.position.y = 0.45;
      g.add(table);
      for (const s of [-0.85, 0.85]) {
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.06, 20),
          new THREE.MeshStandardMaterial({ color: 0x101018, emissive: 0x19e3ff, emissiveIntensity: 1.1 })
        );
        disc.position.set(s, 0.95, 0);
        g.add(disc);
        this.woofers.push(disc);
      }
      for (const s of [-2.6, 2.6]) {
        const stack = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x16121f, roughness: 0.7 }));
        stack.position.set(s, 1.1, 0);
        g.add(stack);
        for (let i = 0; i < 2; i++) {
          const w = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16),
            new THREE.MeshStandardMaterial({ color: 0x0c0c12, emissive: 0xff2d95, emissiveIntensity: 1.0 })
          );
          w.rotation.x = Math.PI / 2;
          w.position.set(s, 0.6 + i * 1, 0.42);
          g.add(w);
          this.woofers.push(w);
        }
      }
      this.root.add(g);
    }
  }

  buildBackdrop() {
    const W = this.lvl.width;
    // stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 320; i++) pts.push(rnd(i) * (W + 20) - 10, 4 + rnd(i + 999) * 22, -19);
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff6d8, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
    this.root.add(stars);
    // moon + crescent
    const moon = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ color: 0xfff3cf }));
    moon.position.set(W * 0.25, 17, -18);
    const shade = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32), new THREE.MeshBasicMaterial({ color: 0x150b33 }));
    shade.position.set(W * 0.25 + 0.6, 17.3, -17.9);
    this.root.add(moon, shade);
    // skyline: domes + minarets of old Persia, windows lit like a city that never sleeps
    for (let i = 0; i < 18; i++) {
      const bx = rnd(i * 17) * W;
      const bw = 1.5 + rnd(i * 31) * 3;
      const bh = 2.5 + rnd(i * 53) * 7;
      const bz = -11 - (i % 3) * 2.2;
      const mat = new THREE.MeshStandardMaterial({ color: i % 2 ? 0x1a1040 : 0x231455, roughness: 1 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 1.4), mat);
      b.position.set(bx, bh / 2 - 0.4, bz);
      this.root.add(b);
      if (rnd(i * 71) > 0.55) {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(bw * 0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        dome.position.set(bx, bh - 0.4, bz);
        this.root.add(dome);
      } else if (rnd(i * 91) > 0.5) {
        const min = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.4, 8), mat);
        min.position.set(bx + bw * 0.4, bh + 0.8, bz);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 8), mat);
        tip.position.set(bx + bw * 0.4, bh + 2.2, bz);
        this.root.add(min, tip);
      }
      const wn = Math.floor(rnd(i * 13) * 4);
      for (let w = 0; w < wn; w++) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.2, 0.28),
          new THREE.MeshBasicMaterial({ color: 0xffb35c })
        );
        win.position.set(bx - bw / 3 + rnd(i * 7 + w) * bw * 0.66, 0.5 + rnd(i * 3 + w * 5) * (bh - 1), bz + 0.71);
        this.root.add(win);
      }
    }
    // background columns on the lowest walkable surface
    for (let x = 4; x < W - 3; x += 7) {
      const surf = this.groundTopAt(x);
      if (surf == null) continue;
      const colMat = new THREE.MeshStandardMaterial({ color: 0x6e5337, roughness: 0.95 });
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 4.4, 10), colMat);
      col.position.set(x, surf + 2.2, -2.7);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1, 0.26, 1), colMat);
      cap.position.set(x, surf + 4.5, -2.7);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.95), colMat);
      base.position.set(x, surf + 0.11, -2.7);
      this.root.add(col, cap, base);
    }
    // hanging banners with a crown
    for (let x = 9; x < W - 4; x += 13) {
      const surf = this.groundTopAt(x);
      if (surf == null) continue;
      const c = document.createElement('canvas');
      c.width = 128; c.height = 220;
      const g2 = c.getContext('2d');
      g2.fillStyle = '#4a1f7e'; g2.fillRect(0, 0, 128, 220);
      g2.fillStyle = '#2d1150'; g2.fillRect(8, 8, 112, 204);
      g2.fillStyle = '#ffd54a';
      g2.font = '64px serif'; g2.textAlign = 'center';
      g2.fillText('♛', 64, 120);
      g2.fillRect(0, 0, 128, 8);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 1.7),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide })
      );
      banner.position.set(x, surf + 5.3, -2.3);
      this.root.add(banner);
      this.banners.push({ m: banner, seed: x });
    }
    // graffiti on wall faces below walking surfaces
    const cands = [];
    for (const [k, v] of this.lvl.tiles) {
      if (v.t !== '#') continue;
      const [x, y] = k.split(',').map(Number);
      if (this.lvl.tiles.get(x + ',' + (y + 1))?.t === '#' && x > 1 && x < W - 2) cands.push([x, y]);
    }
    for (let i = 0; i < Math.min(8, cands.length); i++) {
      const [x, y] = cands[Math.floor(rnd(i * 333 + W) * cands.length)];
      const word = GRAFFITI[Math.floor(rnd(i * 77) * GRAFFITI.length)];
      const color = NEON_COLORS[i % NEON_COLORS.length];
      const { tex, aspect } = textTexture(word, { color, size: 70, glow: 18 });
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(1.9, 0.62 * aspect), 0.62),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
      );
      tag.position.set(x + 0.5, y + 0.5, 0.52);
      tag.rotation.z = (rnd(i * 51) - 0.5) * 0.25;
      this.root.add(tag);
    }
    // the neon sign
    const idx = Math.min(this.game.levelIndex ?? 0, NEON_TEXT.length - 1);
    const { tex, aspect } = textTexture(NEON_TEXT[idx], { color: idx === NEON_TEXT.length - 1 ? '#ff2d95' : '#19e3ff', size: 100, glow: 22 });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6 * aspect, 1.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    sign.position.set(W * 0.62, 10.5, -8);
    this.root.add(sign);
    this.neons.push({ m: sign, seed: 5 });
  }

  // ---------- runtime ----------
  spawnRing(x, y) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.95 })
    );
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y + 0.12, 0);
    this.root.add(m);
    this.rings.push({ m, x, r: 0.5, hit: false });
    this.game.audio.bassDrop();
  }

  update(dt, t, entities) {
    const game = this.game;
    const player = game.player;

    for (const tc of this.torches) {
      const fl = 1.35 + Math.sin(t * 11 + tc.seed) * 0.25 + (rnd(Math.floor(t * 20) + tc.seed) - 0.5) * 0.35;
      tc.light.intensity = Math.max(0.6, fl);
      tc.flame.scale.setScalar(0.9 + Math.sin(t * 13 + tc.seed) * 0.12);
    }
    const pulse = game.audio.beatPulse();
    for (const w of this.woofers) w.scale.setScalar(1 + pulse * 0.18);
    for (const b of this.banners) b.m.rotation.z = Math.sin(t * 0.8 + b.seed) * 0.05;
    for (const n of this.neons) n.m.material.opacity = rnd(Math.floor(t * 9) + n.seed) > 0.06 ? 1 : 0.25;

    // spikes
    for (const s of this.spikeMeshes) {
      const cyc = (t + s.phase) % 2.2;
      let ext;
      if (cyc < 0.14) ext = cyc / 0.14;
      else if (cyc < 1.0) ext = 1;
      else if (cyc < 1.28) ext = 1 - (cyc - 1) / 0.28;
      else ext = 0;
      if (ext > 0.85 && s.ext <= 0.85) game.audio.click();
      s.ext = ext;
      s.cones.scale.y = Math.max(0.05, ext);
      if (ext > 0.6) {
        for (const e of entities) {
          if (e.body.x + e.body.w / 2 > s.x + 0.12 && e.body.x - e.body.w / 2 < s.x + 0.88 &&
              e.body.y >= s.y - 0.1 && e.body.y < s.y + 0.7) {
            e.hurt(1, 'spikes');
          }
        }
      }
    }
    // chompers
    for (const ch of this.chomperMeshes) {
      const cyc = (t + ch.phase) % 1.6;
      let k; // 0 open, 1 closed
      if (cyc < 0.1) k = cyc / 0.1;
      else if (cyc < 0.42) k = 1;
      else if (cyc < 0.62) k = 1 - (cyc - 0.42) / 0.2;
      else k = 0;
      const closing = cyc < 0.42 && cyc > 0.02;
      if (k >= 1 && !ch.wasClosing && Math.abs(player.body.x - ch.x) < 12) game.audio.slam();
      ch.wasClosing = k >= 1;
      ch.top.position.y = 2.05 - k * 0.85;
      ch.bot.position.y = 0.18 + k * 0.55;
      if (closing && k > 0.45) {
        for (const e of entities) {
          if (Math.abs(e.body.x - (ch.x + 0.5)) < 0.5 && e.body.y < ch.y + 1.9 && e.body.y + e.body.h > ch.y + 0.1) {
            e.hurt(2, 'chomper');
          }
        }
      }
    }
    // crumbling slabs
    for (const cr of this.crumbleMeshes) {
      if (cr.state === 0) {
        for (const e of entities) {
          if (e.body.grounded &&
              Math.floor(e.body.y - 0.05) === cr.y &&
              e.body.x + e.body.w / 2 > cr.x && e.body.x - e.body.w / 2 < cr.x + 1) {
            cr.state = 1; cr.t = 0;
            game.audio.crackle();
          }
        }
      } else if (cr.state === 1) {
        cr.t += dt;
        cr.m.position.x = cr.x + 0.5 + Math.sin(cr.t * 55) * 0.035;
        if (cr.t > 0.42) {
          cr.state = 2;
          this.lvl.tiles.get(cr.x + ',' + cr.y).fallen = true;
          game.particles.burst(cr.x + 0.5, cr.y + 0.9, { n: 6, color: 0xb08f60, speed: 1.5, up: 1 });
        }
      } else if (cr.state === 2) {
        cr.vy -= 22 * dt;
        cr.m.position.y += cr.vy * dt;
        cr.m.rotation.z += dt * 2.5;
        if (cr.m.position.y < cr.y - 8) { this.root.remove(cr.m); cr.state = 3; }
      }
    }
    // plates -> gates
    for (const { p, m } of this.plateMeshes) {
      if (p.pressed) continue;
      m.material.emissiveIntensity = 0.4 + Math.sin(t * 4) * 0.3;
      for (const e of entities) {
        if (Math.abs(e.body.x - (p.x + 0.5)) < 0.55 && Math.abs(e.body.y - p.y) < 0.4) {
          p.pressed = true;
          m.position.y = p.y + 0.02;
          m.material.emissiveIntensity = 0.1;
          game.audio.click();
          if (p.gate && !p.gate.open) {
            p.gate.open = true;
            for (const yy of p.gate.ys) this.lvl.tiles.get(p.gate.x + ',' + yy).open = true;
            game.audio.gate();
            game.hud.toast('GATE OPEN');
          }
        }
      }
    }
    for (const gm of this.gateMeshes) {
      if (gm.gate.open && gm.gate.anim < 1) {
        gm.gate.anim = Math.min(1, gm.gate.anim + dt / 0.9);
        gm.grp.position.y = gm.baseY - gm.gate.anim * (gm.h - 0.12);
        if (Math.floor(t * 12) % 2 === 0) {
          game.particles.burst(gm.gate.x + 0.5, gm.baseY + 0.2, { n: 1, color: 0x8a7a55, speed: 0.8, up: 0.6, life: 0.4 });
        }
      }
    }
    // pickups
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.m.position.y = pk.y + Math.sin(t * 2.5 + pk.x) * 0.1;
      pk.m.rotation.y += dt * 2.2;
      const dx = player.body.x - pk.x, dy = (player.body.y + 0.8) - pk.m.position.y;
      if (Math.abs(dx) < 0.7 && Math.abs(dy) < 1.0 && !player.dead) {
        pk.taken = true;
        this.root.remove(pk.m);
        game.collectPickup(pk.kind, pk.x, pk.y);
      }
    }
    // shockwave rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += 7.5 * dt;
      r.m.scale.set(r.r, r.r, 1);
      r.m.material.opacity = Math.max(0, 1 - r.r / 7.5);
      if (!r.hit && player.body.grounded && Math.abs(Math.abs(player.body.x - r.x) - r.r) < 0.5) {
        r.hit = true;
        player.hurt(1, 'shockwave', Math.sign(player.body.x - r.x) || 1);
      }
      if (r.r > 8) { this.root.remove(r.m); this.rings.splice(i, 1); }
    }
    // exit
    if (this.exitGlow) {
      const open = this.exitOpen();
      this.exitBars.visible = !open;
      this.exitGlow.material.opacity = open ? 0.55 + Math.sin(t * 3) * 0.25 : 0.07;
      const e = this.lvl.exit;
      if (open && !player.dead && player.body.grounded &&
          Math.abs(player.body.x - (e.x + 0.5)) < 0.6 && Math.abs(player.body.y - e.y) < 1.2) {
        game.levelComplete();
      }
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.map?.dispose(); m.dispose(); }
      }
    });
  }
}
