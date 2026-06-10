import * as THREE from 'three';

// Small pooled box-particle system: dust, sparks, coins, confetti.
export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  }
  burst(x, y, opts = {}) {
    const n = opts.n ?? 10;
    const color = opts.color ?? 0xc9a06b;
    const speed = opts.speed ?? 3;
    const up = opts.up ?? 2.5;
    const grav = opts.grav ?? 9;
    const life = opts.life ?? 0.7;
    const size = opts.size ?? 1;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const m = new THREE.Mesh(this.geo, mat);
      const s = size * (0.6 + Math.random() * 0.9);
      m.scale.setScalar(s);
      m.position.set(x, y, 0.3 + Math.random() * 0.3);
      this.scene.add(m);
      this.items.push({
        m, grav,
        vx: (Math.random() - 0.5) * 2 * speed,
        vy: Math.random() * up + up * 0.3,
        vr: (Math.random() - 0.5) * 12,
        life, t: 0,
      });
    }
  }
  dust(x, y)   { this.burst(x, y, { n: 7, color: 0x9a8a76, speed: 1.6, up: 1.2, life: 0.45, grav: 4 }); }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.scene.remove(p.m); p.m.material.dispose();
        this.items.splice(i, 1); continue;
      }
      p.vy -= p.grav * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.rotation.x += p.vr * dt;
      p.m.rotation.z += p.vr * dt;
      p.m.material.opacity = 1 - p.t / p.life;
    }
  }
  clear() {
    for (const p of this.items) { this.scene.remove(p.m); p.m.material.dispose(); }
    this.items.length = 0;
  }
}
