import { moveBody, GRAVITY, FALL_DMG_HEIGHT, FALL_DEATH_HEIGHT } from './physics.js';
import { buildCharacter, applyPose, slashArmAngle, makeSlashArc } from './models.js';

const RUN = 5.4, JUMP_V = 9.9, COYOTE = 0.1, BUFFER = 0.14;
const ATTACK_TIME = 0.42, ATTACK_CD = 0.55;

export class Player {
  constructor(game, x, y) {
    this.game = game;
    this.body = { x, y, w: 0.55, h: 1.7, vx: 0, vy: 0, grounded: true };
    this.facing = 1;
    this.hp = game.carry.hp;
    this.maxHp = game.carry.maxHp;
    this.state = 'move'; // move | hang | climb | dead
    this.dead = false;
    this.attackT = 0; this.attackCd = 0; this.didHit = false;
    this.blocking = false;
    this.iframes = 0; this.coyote = 0; this.jumpBuf = 0; this.grabCd = 0;
    this.peakY = y; this.wasGrounded = true;
    this.runPhase = 0; this.idleT = 0; this.danceT = 0;
    this.hang = null; this.climb = null;

    const ch = buildCharacter({
      skin: 0x8d5a3b, top: 0x14d4c0, bottom: 0x5b2d8e, shoe: 0xf5f5f5,
      capColor: 0xe5273e, hat: 'cap', chain: true, sword: true,
    });
    this.mesh = ch.group;
    this.parts = ch.parts;
    this.parts.sword.visible = game.flags.hasSword;
    this.slash = makeSlashArc(0x9ff3ff);
    this.mesh.add(this.slash);
    game.scene.add(this.mesh);
  }

  get hasSword() { return this.game.flags.hasSword; }

  update(dt) {
    if (this.dead) return;
    const g = this.game, ip = g.input, b = this.body, world = g.world;
    const mx = (ip.down('right') ? 1 : 0) - (ip.down('left') ? 1 : 0);

    this.iframes = Math.max(0, this.iframes - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.grabCd = Math.max(0, this.grabCd - dt);

    if (this.state === 'climb') {
      this.climb.t += dt / 0.38;
      const k = Math.min(1, this.climb.t);
      const s = k * k * (3 - 2 * k);
      b.x = this.climb.x0 + (this.climb.x1 - this.climb.x0) * s;
      b.y = this.climb.y0 + (this.climb.y1 - this.climb.y0) * s;
      b.vx = 0; b.vy = 0;
      if (k >= 1) { this.state = 'move'; b.grounded = true; }
      return;
    }

    if (this.state === 'hang') {
      b.vx = 0; b.vy = 0;
      if (ip.pressed('jump') || ip.pressed('up')) {
        const { tx, top, dir } = this.hang;
        if (!world.isSolid(tx, top) && !world.isSolid(tx, top + 1)) {
          this.state = 'climb';
          this.climb = { t: 0, x0: b.x, y0: b.y, x1: tx + 0.5, y1: top };
          g.audio.land();
        }
      } else if (ip.pressed('down')) {
        this.state = 'move';
        this.grabCd = 0.3;
      }
      return;
    }

    // ---- move state ----
    const speedMul = this.blocking ? 0.25 : 1;
    if (b.grounded) {
      b.vx += (mx * RUN * speedMul - b.vx) * Math.min(1, 18 * dt);
    } else {
      b.vx += (mx * RUN - b.vx) * Math.min(1, 4.5 * dt);
    }
    if (mx !== 0 && !this.blocking) this.facing = mx;

    this.coyote = b.grounded ? COYOTE : Math.max(0, this.coyote - dt);
    if (ip.pressed('jump')) this.jumpBuf = BUFFER;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (this.jumpBuf > 0 && (b.grounded || this.coyote > 0)) {
      b.vy = JUMP_V;
      b.grounded = false;
      this.coyote = 0; this.jumpBuf = 0;
      g.audio.jump();
      g.particles.dust(b.x, b.y);
    }

    b.vy = Math.max(-20, b.vy - GRAVITY * dt);
    if (!b.grounded) this.peakY = Math.max(this.peakY, b.y);
    moveBody(world, b, dt);

    if (b.grounded && !this.wasGrounded) {
      const fall = this.peakY - b.y;
      if (fall > FALL_DEATH_HEIGHT) { g.particles.burst(b.x, b.y, { n: 14, color: 0xc23b3b, speed: 3 }); this.die('fall'); return; }
      if (fall > FALL_DMG_HEIGHT) this.hurt(1, 'fall');
      else if (fall > 1.2) { g.audio.land(); g.particles.dust(b.x, b.y); }
      this.peakY = b.y;
    }
    if (b.grounded) this.peakY = b.y;
    this.wasGrounded = b.grounded;

    if (b.y < -3) { this.die('void'); return; }

    // ledge grab
    if (!b.grounded && b.vy < 1 && mx === this.facing && mx !== 0 && this.grabCd <= 0) {
      const dir = this.facing;
      const handX = b.x + dir * (b.w / 2 + 0.14);
      const tx = Math.floor(handX);
      const topY = b.y + b.h;
      const ledge = Math.round(topY);
      if (Math.abs(topY - ledge) < 0.38 &&
          world.isSolid(tx, ledge - 1) && !world.isSolid(tx, ledge) &&
          !world.isSolid(Math.floor(b.x), ledge - 1)) {
        this.state = 'hang';
        this.hang = { tx, top: ledge, dir };
        b.x = dir > 0 ? tx - b.w / 2 - 0.02 : tx + 1 + b.w / 2 + 0.02;
        b.y = ledge - b.h;
        b.vx = 0; b.vy = 0;
        g.audio.land();
        g.particles.dust(b.x + dir * 0.3, ledge);
        return;
      }
    }

    // combat
    if (ip.pressed('attack') && this.hasSword && this.attackCd <= 0) {
      this.attackT = ATTACK_TIME;
      this.attackCd = ATTACK_CD;
      this.didHit = false;
      g.audio.swing();
    }
    if (this.attackT > 0) {
      this.attackT -= dt;
      const elapsed = ATTACK_TIME - this.attackT;
      if (!this.didHit && elapsed > 0.13 && elapsed < 0.26) {
        for (const guard of g.guards) {
          if (guard.state === 'dead') continue;
          const dx = guard.body.x - (b.x + this.facing * 0.9);
          if (Math.abs(dx) < 0.8 && Math.abs(guard.body.y - b.y) < 1.3) {
            this.didHit = true;
            guard.takeHit(1, this.facing);
            break;
          }
        }
      }
    }
    this.blocking = ip.down('block') && this.hasSword && b.grounded && this.attackT <= 0;

    // idle -> breakdance
    if (mx === 0 && b.grounded && this.attackT <= 0 && !this.blocking) this.idleT += dt;
    else { this.idleT = 0; this.danceT = 0; }
    if (this.idleT > 6) {
      this.danceT += dt;
      if (this.danceT > 1.3) { this.idleT = 0; this.danceT = 0; }
    }
  }

  hurt(d, src, dir = 0) {
    if (this.iframes > 0 || this.dead) return;
    this.hp -= d;
    this.iframes = 1.1;
    this.game.audio.hurt();
    this.game.shake = 0.35;
    this.game.particles.burst(this.body.x, this.body.y + 1, { n: 8, color: 0xff4d6d, speed: 2.5 });
    if (src !== 'fall') {
      this.body.vx = (dir || -this.facing) * 4.5;
      this.body.vy = Math.max(this.body.vy, 3.2);
      this.body.grounded = false;
    }
    if (this.hp <= 0) this.die(src);
  }

  die(src) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.game.audio.death();
    this.game.shake = 0.5;
    this.game.onPlayerDeath(src);
  }

  updateModel(dt, t) {
    const b = this.body;
    this.mesh.position.set(b.x, b.y, 0);
    this.slash.material.opacity *= Math.max(0, 1 - 14 * dt);

    if (this.danceT > 0) {
      this.mesh.rotation.y += dt * 11;
      applyPose(this.parts, { aL: 2.9, aR: -2.9, lL: 0.4, lR: -0.4 }, 14 * dt);
      if (Math.floor(t * 10) % 3 === 0) this.game.particles.burst(b.x, b.y + 1.6, { n: 1, color: 0xffd54a, speed: 1, up: 1.5, life: 0.4 });
      return;
    }
    const targetRotY = this.facing > 0 ? 0 : Math.PI;
    let d = targetRotY - this.mesh.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.mesh.rotation.y += d * Math.min(1, 16 * dt);

    this.mesh.visible = this.iframes > 0 ? Math.floor(t * 14) % 2 === 0 : true;
    if (this.dead) {
      this.mesh.visible = true;
      this.mesh.rotation.z += (-Math.PI / 2 - this.mesh.rotation.z) * Math.min(1, 6 * dt);
      applyPose(this.parts, { aL: 1.5, aR: -1.5 }, 8 * dt);
      return;
    }

    let pose, tilt = 0;
    if (this.state === 'hang') {
      pose = { aL: 3.0, aR: -3.0, lL: 0.25 + Math.sin(t * 2) * 0.1, lR: -0.25, sw: 0 };
    } else if (this.state === 'climb') {
      pose = { aL: 1.6, aR: -1.6, lL: 0.9, lR: -0.6, sw: 0 };
    } else if (this.attackT > 0) {
      // sword arm is driven explicitly below — overhead slash, never the bottom arc
      const p = 1 - this.attackT / ATTACK_TIME;
      pose = { aL: p < 0.3 ? 0.6 : -0.5, lL: 0.5, lR: -0.5, sw: 0 };
      tilt = p < 0.3 ? 0.06 : -0.12;
    } else if (this.blocking) {
      pose = { aL: 0.4, aR: 0.95, sw: -1.25, lL: 0.25, lR: -0.25 };
    } else if (!b.grounded) {
      pose = b.vy > 1
        ? { aL: 2.3, aR: -1.6, lL: 0.85, lR: -0.45, sw: 0.3 }
        : { aL: 1.2, aR: -0.8, lL: 0.45, lR: -0.7, sw: 0.3 };
    } else if (Math.abs(b.vx) > 0.6) {
      this.runPhase += Math.abs(b.vx) * dt * 2.4;
      const s = Math.sin(this.runPhase * Math.PI * 2);
      pose = { aL: s * 0.95, aR: -s * 0.95, lL: -s * 0.85, lR: s * 0.85, sw: 0.35 };
      tilt = -0.08;
    } else {
      pose = { aL: Math.sin(t * 2) * 0.07, aR: -Math.sin(t * 2) * 0.07, lL: 0, lR: 0, sw: 0.25 };
    }
    this.mesh.rotation.z += (tilt - this.mesh.rotation.z) * Math.min(1, 10 * dt);
    applyPose(this.parts, pose, 15 * dt);

    if (this.attackT > 0) {
      const p = 1 - this.attackT / ATTACK_TIME;
      this.parts.armR.rotation.z = slashArmAngle(p, 0.3, 0.58);
      if (p > 0.28 && p < 0.66) {
        this.slash.material.opacity = Math.sin(((p - 0.28) / 0.38) * Math.PI) * 0.75;
      }
    }
    if (this.parts.swordMat) {
      this.parts.swordMat.emissiveIntensity = this.attackT > 0 ? 1.6 : 0.5;
    }
  }
}
