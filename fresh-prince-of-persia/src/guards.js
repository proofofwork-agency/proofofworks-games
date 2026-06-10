import * as THREE from 'three';
import { moveBody, GRAVITY, lineClear, groundAhead } from './physics.js';
import { buildCharacter, applyPose, slashArmAngle, makeSlashArc } from './models.js';

// Guard AI — probability-table state machine, in the spirit of the 1989 original:
// per-tier chances to strike, block, and advance, evaluated on a decision clock.
// patrol -> (spots you) alert -> chase -> engage { advance | retreat | strike | block }

const TIERS = {
  street: {
    hp: 2, speed: 2.4, name: 'STREET GUARD',
    strike: 0.42, block: 0.22, decide: [0.55, 0.95],
    look: { skin: 0x9c6644, top: 0xa3273a, bottom: 0x3a3a44, shoe: 0x222228, capColor: 0x8e1f2f, hat: 'turban', sword: true },
  },
  elite: {
    hp: 3, speed: 2.7, name: 'ELITE GUARD',
    strike: 0.5, block: 0.45, decide: [0.45, 0.8],
    look: { skin: 0x7a4a2e, top: 0x2c2c38, bottom: 0x16161d, shoe: 0x101014, capColor: 0x16161d, hat: 'turban', chain: true, sword: true },
  },
  boss: {
    hp: 6, speed: 2.9, name: 'DJ VIZIER',
    strike: 0.55, block: 0.6, decide: [0.38, 0.7], ring: 5.5,
    look: { skin: 0x6e3f24, top: 0x2a1437, bottom: 0x191919, shoe: 0xffd54a, hat: 'phones', chain: true, shades: true, sword: true, swordColor: 0xffd54a },
  },
};

const STRIKE_TIME = 0.46;

export class Guard {
  constructor(game, x, y, tier) {
    this.game = game;
    this.tier = tier;
    this.cfg = TIERS[tier];
    // snap to the floor below the spawn marker
    let fy = y;
    for (let k = 0; k <= 10; k++) {
      if (game.world.isSolid(Math.floor(x), y - 1 - k)) { fy = y - k; break; }
    }
    this.body = { x, y: fy, w: 0.55, h: 1.7, vx: 0, vy: 0, grounded: true };
    this.homeX = x;
    this.dir = -1;
    this.state = 'patrol';
    this.hp = this.cfg.hp;
    this.decideT = 0; this.moveT = 0; this.moveDir = 0;
    this.strikeT = 0; this.didHit = false;
    this.blockT = 0; this.staggerT = 0; this.reacted = false;
    this.alertT = 0; this.deadT = 0; this.flashT = 0;
    this.ringT = this.cfg.ring ?? 0;
    this.removed = false;

    const ch = buildCharacter(this.cfg.look);
    this.mesh = ch.group;
    this.parts = ch.parts;
    this.slash = makeSlashArc(tier === 'boss' ? 0xffd54a : 0xff9a66);
    this.mesh.add(this.slash);
    if (tier === 'boss') this.mesh.scale.setScalar(1.12);
    game.scene.add(this.mesh);

    // "!" alert sprite
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g2 = c.getContext('2d');
    g2.font = 'bold 52px Bungee, sans-serif';
    g2.textAlign = 'center';
    g2.shadowColor = '#ff2d95'; g2.shadowBlur = 10;
    g2.fillStyle = '#ff2d95';
    g2.fillText('!', 32, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.alertSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.alertSprite.scale.set(0.6, 0.6, 1);
    this.alertSprite.visible = false;
    game.scene.add(this.alertSprite);
  }

  update(dt, t) {
    const g = this.game, b = this.body, world = g.world, p = g.player;
    if (this.removed) return;

    if (this.state === 'dead') {
      this.deadT += dt;
      b.vy = Math.max(-20, b.vy - GRAVITY * dt);
      moveBody(world, b, dt);
      this.updateModel(dt, t);
      if (this.deadT > 2.4) {
        g.scene.remove(this.mesh);
        g.scene.remove(this.alertSprite);
        this.removed = true;
      }
      return;
    }

    this.staggerT = Math.max(0, this.staggerT - dt);
    this.blockT = Math.max(0, this.blockT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.alertT = Math.max(0, this.alertT - dt);

    const dx = p.body.x - b.x;
    const dy = p.body.y - b.y;
    const dist = Math.abs(dx);
    const canSee = !p.dead && dist < 8 && Math.abs(dy) < 1.8 && lineClear(world, b.x, p.body.x, b.y + 1.4);

    let vxTarget = 0;

    if (this.staggerT > 0) {
      // knocked — no decisions
    } else if (this.state === 'patrol') {
      const aheadX = Math.floor(b.x + this.dir * 0.7);
      const aheadY = Math.floor(b.y + 0.5);
      if (!groundAhead(world, b.x, b.y, this.dir) ||
          world.isSolid(aheadX, aheadY) ||
          world.isHazard(aheadX, aheadY) || world.isHazard(aheadX, aheadY - 1) ||
          Math.abs(b.x - this.homeX) > 3.2 && Math.sign(this.dir) === Math.sign(b.x - this.homeX)) {
        this.dir = -this.dir;
      }
      vxTarget = this.dir * 1.1;
      if (canSee && (Math.sign(dx) === this.dir || dist < 2.5)) {
        this.state = 'chase';
        this.alertT = 0.7;
        g.audio.alert();
        g.combatHeat = 3;
      }
    } else if (this.state === 'chase') {
      this.dir = dx >= 0 ? 1 : -1;
      if (!canSee && dist > 11) this.state = 'patrol';
      else if (dist <= 1.8 && Math.abs(dy) < 1.3) { this.state = 'engage'; this.decideT = 0.25; }
      else if (groundAhead(world, b.x, b.y, this.dir)) vxTarget = this.dir * this.cfg.speed;
      // at an edge: hold position, wave the sword (taunt)
      g.combatHeat = Math.max(g.combatHeat, 1.5);
    } else if (this.state === 'engage') {
      this.dir = dx >= 0 ? 1 : -1;
      g.combatHeat = 3;
      if (p.dead) { this.state = 'patrol'; }
      else if (dist > 2.6 || Math.abs(dy) > 1.5) { this.state = 'chase'; }
      else if (this.strikeT > 0) {
        this.strikeT -= dt;
        const elapsed = STRIKE_TIME - this.strikeT;
        if (!this.didHit && elapsed > 0.3 && elapsed < 0.42 && dist < 1.4 && Math.abs(dy) < 1.3) {
          this.didHit = true;
          if (p.blocking && p.facing === -this.dir) {
            g.audio.clang();
            g.particles.burst(b.x + this.dir * 0.8, b.y + 1.2, { n: 8, color: 0xffe08a, speed: 3, grav: 5, life: 0.4 });
            this.staggerT = 0.75;
            g.shake = 0.15;
          } else {
            g.audio.hit();
            p.hurt(1, 'sword', this.dir);
          }
        }
        if (this.strikeT <= 0 && elapsed >= STRIKE_TIME) this.strikeT = 0;
      } else if (this.blockT > 0) {
        // holding block
      } else {
        // react-block against the player's wind-up (the classic probability roll)
        if (p.attackT > 0.3 && !this.reacted) {
          this.reacted = true;
          if (Math.random() < this.cfg.block) this.blockT = 0.5;
        }
        if (p.attackT <= 0) this.reacted = false;

        this.moveT = Math.max(0, this.moveT - dt);
        if (this.moveT > 0) {
          vxTarget = this.moveDir * this.cfg.speed * 0.55;
          if (!groundAhead(world, b.x, b.y, Math.sign(this.moveDir) || 1)) vxTarget = 0;
        }
        this.decideT -= dt;
        if (this.decideT <= 0) {
          const [d0, d1] = this.cfg.decide;
          this.decideT = d0 + Math.random() * (d1 - d0);
          if (dist > 1.9) { this.moveT = 0.32; this.moveDir = this.dir; }
          else if (dist < 1.0) { this.moveT = 0.26; this.moveDir = -this.dir; }
          else {
            const r = Math.random();
            if (r < this.cfg.strike) { this.strikeT = STRIKE_TIME; this.didHit = false; g.audio.swing(); }
            else if (r < this.cfg.strike + 0.25) { this.moveT = 0.22; this.moveDir = this.dir; }
          }
        }
      }
      // boss: drop the bass
      if (this.tier === 'boss') {
        this.ringT -= dt;
        if (this.ringT <= 0) {
          world.spawnRing(b.x, b.y);
          this.ringT = this.hp <= 3 ? 3.8 : 5.5;
        }
      }
    }

    b.vx += (vxTarget - b.vx) * Math.min(1, 14 * dt);
    b.vy = Math.max(-20, b.vy - GRAVITY * dt);
    moveBody(world, b, dt);
    if (b.y < -3 && this.state !== 'dead') { this.hp = 0; this.die(); }
    this.updateModel(dt, t);
  }

  takeHit(d, dir) {
    if (this.state === 'dead') return;
    const g = this.game;
    if (this.blockT > 0 && this.dir === -dir) {
      g.audio.clang();
      g.particles.burst(this.body.x - dir * 0.3, this.body.y + 1.2, { n: 8, color: 0xffe08a, speed: 3, grav: 5, life: 0.4 });
      return;
    }
    this.hp -= d;
    this.flashT = 0.2;
    this.staggerT = 0.5;
    this.body.vx = dir * 3;
    this.body.vy = 2.2;
    this.body.grounded = false;
    g.audio.hit();
    g.shake = 0.18;
    g.particles.burst(this.body.x, this.body.y + 1.1, { n: 6, color: 0xff4d6d, speed: 2.2 });
    if (this.state === 'patrol') { this.state = 'chase'; this.alertT = 0.6; g.audio.alert(); }
    if (this.hp <= 0) this.die();
  }

  // traps call this through the shared entity interface
  hurt(d, src) {
    if (this.state === 'dead') return;
    if (this.hurtCd > 0) return;
    this.hurtCd = 1.0;
    this.takeHit(d, this.dir * -1);
  }

  die() {
    const g = this.game;
    this.state = 'dead';
    this.deadT = 0;
    g.audio.death();
    g.particles.burst(this.body.x, this.body.y + 1, { n: 16, color: 0xffd54a, speed: 3.5, up: 4, life: 1.0 });
    g.onGuardDeath(this);
  }

  updateModel(dt, t) {
    this.hurtCd = Math.max(0, (this.hurtCd ?? 0) - dt);
    const b = this.body;
    this.mesh.position.set(b.x, b.y, 0);
    this.slash.material.opacity *= Math.max(0, 1 - 12 * dt);
    this.alertSprite.position.set(b.x, b.y + 2.35, 0);
    this.alertSprite.visible = this.alertT > 0;
    if (this.alertT > 0) {
      const s = 0.5 + Math.min(1, (0.7 - this.alertT) * 8) * 0.25;
      this.alertSprite.scale.set(s, s, 1);
    }

    if (this.parts.torso) {
      this.parts.torso.material.emissive.setHex(this.flashT > 0 ? 0xff2222 : (this.tier === 'boss' && this.hp <= 3 ? 0x550022 : 0x000000));
      this.parts.torso.material.emissiveIntensity = this.flashT > 0 ? 1.5 : 0.8;
    }

    if (this.state === 'dead') {
      this.mesh.rotation.z += ((Math.PI / 2) * -this.dir - this.mesh.rotation.z) * Math.min(1, 7 * dt);
      applyPose(this.parts, { aL: 1.4, aR: -1.4 }, 8 * dt);
      if (this.deadT > 1.4) {
        const k = Math.max(0, 1 - (this.deadT - 1.4));
        this.mesh.traverse(o => {
          if (o.isMesh) { o.material.transparent = true; o.material.opacity = k; }
        });
      }
      return;
    }

    const targetRotY = this.dir > 0 ? 0 : Math.PI;
    let d = targetRotY - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, 12 * dt);

    let pose;
    const speed = Math.abs(b.vx);
    if (this.staggerT > 0) {
      pose = { aL: 1.9, aR: -1.7, lL: 0.4, lR: -0.4, sw: 0 };
    } else if (this.strikeT > 0) {
      // sword arm driven explicitly below — slow overhead wind-up IS the parry telegraph
      const elapsed = STRIKE_TIME - this.strikeT;
      pose = { aL: elapsed < 0.3 ? 0.5 : -0.4, lL: 0.45, lR: -0.45, sw: 0 };
    } else if (this.blockT > 0) {
      pose = { aL: 0.3, aR: 0.95, sw: -1.25, lL: 0.3, lR: -0.3 };
    } else if (this.state === 'engage') {
      pose = { aL: 0.45, aR: -0.55, lL: 0.32, lR: -0.32, sw: 0.15 };
    } else if (this.state === 'chase' && speed < 0.3) {
      pose = { aL: 0.3, aR: -2.4 + Math.sin(t * 8) * 0.3, lL: 0.2, lR: -0.2, sw: 0.2 }; // edge taunt
    } else if (speed > 0.4) {
      this.runPhase = (this.runPhase ?? 0) + speed * dt * 2.4;
      const s = Math.sin(this.runPhase * Math.PI * 2);
      pose = { aL: s * 0.8, aR: -s * 0.8, lL: -s * 0.75, lR: s * 0.75, sw: 0.35 };
    } else {
      pose = { aL: Math.sin(t * 1.7) * 0.06, aR: -Math.sin(t * 1.7) * 0.06, lL: 0, lR: 0, sw: 0.2 };
    }
    // boss telegraphs the shockwave: arms up
    if (this.tier === 'boss' && this.ringT < 0.6 && this.state === 'engage') {
      pose = { aL: 2.9, aR: -2.9, lL: 0.2, lR: -0.2, sw: 0 };
    }
    applyPose(this.parts, pose, 13 * dt);

    if (this.strikeT > 0) {
      const p = (STRIKE_TIME - this.strikeT) / STRIKE_TIME;
      this.parts.armR.rotation.z = slashArmAngle(p, 0.65, 0.91, 0.3);
      if (p > 0.62 && p < 1) {
        this.slash.material.opacity = Math.sin(((p - 0.62) / 0.38) * Math.PI) * 0.7;
      }
    }
  }
}
