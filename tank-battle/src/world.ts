import {
  Dir,
  DIR_VEC,
  type EnemyKind,
  isVertical,
  SOLID_TANK,
  Tile,
  turnAxis,
} from './types';
import {
  aabb,
  BULLET_SIZE,
  CELL,
  clamp,
  COLS,
  ENEMY_CONFIGS,
  ENEMY_SPAWN_BLOCKS,
  FIELD_H,
  FIELD_W,
  MAX_CONCURRENT_ENEMIES,
  PLAYER_RESPAWN_TIME,
  playerConfig,
  PLAYER_SPAWN_BLOCK_X,
  PLAYER_SPAWN_BLOCK_Y,
  POWERUP_DROP_CHANCE,
  POWERUP_LIFETIME,
  rand,
  ROWS,
  snapToCell,
  SPAWN_ANIM_TIME,
  TANK_SIZE,
} from './constants';
import type { AudioEngine } from './audio';
import { Bullet, Explosion, PowerUp, Tank } from './entities';
import { type AIWorld, updateEnemyAI } from './ai';
import { LEVELS, parseTerrain, type LevelDef } from './levels';

export interface WorldEvents {
  onScore(points: number): void;
  onPlayerKilled(): void;
  onBaseDestroyed(): void;
  onExtraLife(): void;
}

interface Intent {
  moveDir: Dir | null;
  firing: boolean;
}

export class World implements AIWorld {
  grid: Uint8Array = new Uint8Array(COLS * ROWS);
  tanks: Tank[] = [];
  bullets: Bullet[] = [];
  explosions: Explosion[] = [];
  powerups: PowerUp[] = [];

  player: Tank | null = null;
  playerLevel = 0;
  private playerIntent: Intent = { moveDir: null, firing: false };

  enemyQueue: EnemyKind[] = [];
  spawnTimer = 0;
  private spawnCursor = 0;

  baseAlive = true;
  baseX = 0;
  baseY = 0;

  get playerAlive(): boolean {
    return this.player !== null && this.player.alive;
  }
  get playerX(): number {
    return this.player ? this.player.centerX : this.baseX;
  }
  get playerY(): number {
    return this.player ? this.player.centerY : this.baseY;
  }

  playerDead = false;
  playerRespawnTimer = 0;

  private audio: AudioEngine;
  private events: WorldEvents;
  levelIndex = 0;
  currentLevel: LevelDef;

  constructor(audio: AudioEngine, events: WorldEvents) {
    this.audio = audio;
    this.events = events;
    this.currentLevel = LEVELS[0];
  }

  loadLevel(index: number, keepLevel: boolean): void {
    this.levelIndex = index;
    this.currentLevel = LEVELS[index];
    const parsed = parseTerrain(this.currentLevel);
    this.grid = parsed.grid;
    this.placeBase();
    this.clearSpawnZones();
    this.tanks = [];
    this.bullets = [];
    this.explosions = [];
    this.powerups = [];
    this.baseAlive = true;
    this.playerDead = false;
    this.playerRespawnTimer = 0;
    this.enemyQueue = [...this.currentLevel.enemies];
    this.spawnTimer = 0.6;
    this.spawnCursor = 0;
    if (!keepLevel) {
      this.playerLevel = 0;
    }
    this.spawnPlayer();
  }

  private placeBase(): void {
    const bx = 2 * 6;
    const by = 2 * 12;
    this.setBlock(bx, by, Tile.Base);
    this.setTile(bx - 1, by - 1, Tile.Brick);
    this.setTile(bx, by - 1, Tile.Brick);
    this.setTile(bx + 1, by - 1, Tile.Brick);
    this.setTile(bx + 2, by - 1, Tile.Brick);
    this.setTile(bx - 1, by, Tile.Brick);
    this.setTile(bx - 1, by + 1, Tile.Brick);
    this.setTile(bx + 2, by, Tile.Brick);
    this.setTile(bx + 2, by + 1, Tile.Brick);
    this.baseX = 13 * CELL;
    this.baseY = 25 * CELL;
  }

  private clearSpawnZones(): void {
    this.setBlock(2 * PLAYER_SPAWN_BLOCK_X, 2 * PLAYER_SPAWN_BLOCK_Y, Tile.Empty);
    for (const [bx, by] of ENEMY_SPAWN_BLOCKS) {
      this.setBlock(2 * bx, 2 * by, Tile.Empty);
    }
  }

  private setBlock(cellX: number, cellY: number, tile: Tile): void {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        this.setTile(cellX + dx, cellY + dy, tile);
      }
    }
  }

  setTile(cx: number, cy: number, tile: Tile): void {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) {
      return;
    }
    this.grid[cy * COLS + cx] = tile;
  }

  tileAt(cx: number, cy: number): Tile {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) {
      return Tile.Steel;
    }
    return this.grid[cy * COLS + cx] as Tile;
  }

  setPlayerIntent(moveDir: Dir | null, firing: boolean): void {
    this.playerIntent.moveDir = moveDir;
    this.playerIntent.firing = firing;
  }

  aliveEnemies(): number {
    let n = 0;
    for (const t of this.tanks) {
      if (t.side === 'enemy' && t.alive) {
        n++;
      }
    }
    return n;
  }

  remainingEnemies(): number {
    return this.enemyQueue.length + this.aliveEnemies();
  }

  isCleared(): boolean {
    return this.baseAlive && this.enemyQueue.length === 0 && this.aliveEnemies() === 0;
  }

  spawnPlayer(): void {
    const px = 2 * PLAYER_SPAWN_BLOCK_X * CELL;
    const py = 2 * PLAYER_SPAWN_BLOCK_Y * CELL;
    const tank = new Tank(px, py, Dir.Up, 'player', 'player', 1);
    tank.level = this.playerLevel;
    tank.shield = 3.2;
    this.applyPlayerConfig(tank);
    this.player = tank;
    this.tanks.push(tank);
  }

  private applyPlayerConfig(tank: Tank): void {
    const cfg = playerConfig(tank.level);
    tank.speed = cfg.speed;
    tank.fireCooldown = cfg.fireCooldown;
    tank.bulletSpeed = cfg.bulletSpeed;
    tank.bulletPower = cfg.bulletPower;
    tank.maxBullets = cfg.maxBullets;
  }

  private spawnEnemy(): void {
    if (this.enemyQueue.length === 0) {
      return;
    }
    if (this.aliveEnemies() >= MAX_CONCURRENT_ENEMIES) {
      return;
    }
    for (let i = 0; i < ENEMY_SPAWN_BLOCKS.length; i++) {
      const idx = (this.spawnCursor + i) % ENEMY_SPAWN_BLOCKS.length;
      const [bx, by] = ENEMY_SPAWN_BLOCKS[idx];
      const px = 2 * bx * CELL;
      const py = 2 * by * CELL;
      if (this.areaClear(px, py)) {
        const kind = this.enemyQueue.shift()!;
        const cfg = ENEMY_CONFIGS[kind];
        const tank = new Tank(px, py, Dir.Down, kind, 'enemy', cfg.maxHp);
        tank.speed = cfg.speed;
        tank.fireCooldown = cfg.fireCooldown;
        tank.bulletSpeed = cfg.bulletSpeed;
        tank.bulletPower = cfg.bulletPower;
        tank.maxBullets = cfg.maxBullets;
        tank.spawnAnim = SPAWN_ANIM_TIME;
        tank.aiTimer = rand(0.3, 0.9);
        this.spawnCursor = (idx + 1) % ENEMY_SPAWN_BLOCKS.length;
        this.tanks.push(tank);
        return;
      }
    }
  }

  private areaClear(x: number, y: number): boolean {
    for (const t of this.tanks) {
      if (!t.alive) {
        continue;
      }
      if (aabb(x, y, TANK_SIZE, TANK_SIZE, t.x, t.y, TANK_SIZE, TANK_SIZE)) {
        return false;
      }
    }
    return true;
  }

  update(dt: number): void {
    this.updateSpawns(dt);
    this.updatePlayerIntent();
    this.updateTanks(dt);
    this.updateBullets(dt);
    this.updateExplosions(dt);
    this.updatePowerups(dt);
    this.cull();
  }

  private updateSpawns(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.enemyQueue.length > 0) {
      this.spawnEnemy();
      this.spawnTimer = 1.8;
    }
  }

  private updatePlayerIntent(): void {
    const p = this.player;
    if (!p || !p.alive || p.spawnAnim > 0) {
      return;
    }
    const md = this.playerIntent.moveDir;
    if (md !== null) {
      this.faceDirection(p, md);
      p.moving = true;
    } else {
      p.moving = false;
    }
    if (this.playerIntent.firing) {
      this.fire(p);
    }
  }

  private updateTanks(dt: number): void {
    for (const t of this.tanks) {
      if (!t.alive) {
        continue;
      }
      if (t.fireTimer > 0) {
        t.fireTimer -= dt;
      }
      if (t.shield > 0) {
        t.shield -= dt;
      }
      if (t.spawnAnim > 0) {
        t.spawnAnim -= dt;
        t.moving = false;
        continue;
      }
      if (t.side === 'enemy') {
        updateEnemyAI(this, t, dt);
      }
      this.moveTank(t, dt);
    }
    if (this.playerDead) {
      this.playerRespawnTimer -= dt;
      if (this.playerRespawnTimer <= 0) {
        this.playerDead = false;
        this.spawnPlayer();
      }
    }
  }

  private faceDirection(tank: Tank, dir: Dir): void {
    if (dir !== tank.dir && turnAxis(dir) !== turnAxis(tank.dir)) {
      if (isVertical(dir)) {
        tank.x = clamp(snapToCell(tank.x), 0, FIELD_W - TANK_SIZE);
      } else {
        tank.y = clamp(snapToCell(tank.y), 0, FIELD_H - TANK_SIZE);
      }
    }
    tank.prevDir = tank.dir;
    tank.dir = dir;
  }

  private moveTank(tank: Tank, dt: number): void {
    tank.movedThisFrame = false;
    tank.lastBumped = false;
    if (!tank.moving) {
      return;
    }
    const v = DIR_VEC[tank.dir];
    const dist = tank.speed * dt;
    const steps = Math.max(1, Math.ceil(dist));
    const inc = dist / steps;
    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const nx = tank.x + v.x * inc;
      const ny = tank.y + v.y * inc;
      if (this.canMoveTo(tank, nx, ny)) {
        tank.x = nx;
        tank.y = ny;
        moved += inc;
      } else {
        break;
      }
    }
    tank.movedThisFrame = moved > 0.001;
    tank.lastBumped = !tank.movedThisFrame && tank.moving;
    if (moved > 0) {
      tank.tread += moved;
    }
  }

  canMoveTo(tank: Tank, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x + TANK_SIZE > FIELD_W || y + TANK_SIZE > FIELD_H) {
      return false;
    }
    const x0 = Math.floor(x / CELL);
    const y0 = Math.floor(y / CELL);
    const x1 = Math.floor((x + TANK_SIZE - 1) / CELL);
    const y1 = Math.floor((y + TANK_SIZE - 1) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (SOLID_TANK.has(this.tileAt(cx, cy))) {
          return false;
        }
      }
    }
    for (const other of this.tanks) {
      if (!other.alive || other === tank) {
        continue;
      }
      if (aabb(x, y, TANK_SIZE, TANK_SIZE, other.x, other.y, TANK_SIZE, TANK_SIZE)) {
        return false;
      }
    }
    return true;
  }

  canAdvance(tank: Tank, dir: Dir, step: number): boolean {
    const v = DIR_VEC[dir];
    return this.canMoveTo(tank, tank.x + v.x * step, tank.y + v.y * step);
  }

  fire(tank: Tank): void {
    if (!tank.alive || tank.spawnAnim > 0 || tank.fireTimer > 0) {
      return;
    }
    let active = 0;
    for (const b of this.bullets) {
      if (b.alive && b.ownerId === tank.id) {
        active++;
      }
    }
    if (active >= tank.maxBullets) {
      return;
    }
    const v = DIR_VEC[tank.dir];
    const bx = tank.centerX + v.x * (TANK_SIZE / 2);
    const by = tank.centerY + v.y * (TANK_SIZE / 2);
    this.bullets.push(
      new Bullet(bx, by, tank.dir, tank.bulletSpeed, tank.bulletPower, tank.side, tank.id),
    );
    tank.fireTimer = tank.fireCooldown;
    if (tank.side === 'player') {
      this.audio.shoot();
    } else {
      this.audio.enemyShoot();
    }
  }

  private updateBullets(dt: number): void {
    for (const b of this.bullets) {
      if (!b.alive) {
        continue;
      }
      const v = DIR_VEC[b.dir];
      const dist = b.speed * dt;
      const steps = Math.max(1, Math.ceil(dist / (CELL * 0.4)));
      const inc = dist / steps;
      for (let i = 0; i < steps; i++) {
        b.x += v.x * inc;
        b.y += v.y * inc;
        if (
          b.x < 0 ||
          b.y < 0 ||
          b.x > FIELD_W ||
          b.y > FIELD_H
        ) {
          b.alive = false;
          this.spawnExplosion(clamp(b.x, 4, FIELD_W - 4), clamp(b.y, 4, FIELD_H - 4), 10, 0.22);
          break;
        }
        if (this.bulletHitTiles(b)) {
          break;
        }
        const target = this.bulletHitTank(b);
        if (target) {
          b.alive = false;
          break;
        }
      }
    }
  }

  private bulletHitTiles(b: Bullet): boolean {
    const half = BULLET_SIZE / 2;
    const x0 = Math.floor((b.x - half) / CELL);
    const y0 = Math.floor((b.y - half) / CELL);
    const x1 = Math.floor((b.x + half) / CELL);
    const y1 = Math.floor((b.y + half) / CELL);
    let hitBase = false;
    let hitSteel = false;
    let hitBrick = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = this.tileAt(cx, cy);
        if (t === Tile.Base) {
          hitBase = true;
        } else if (t === Tile.Brick) {
          hitBrick = true;
        } else if (t === Tile.Steel) {
          hitSteel = true;
        }
      }
    }
    if (hitBase) {
      b.alive = false;
      this.destroyBase();
      return true;
    }
    if (hitBrick) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (this.tileAt(cx, cy) === Tile.Brick) {
            this.setTile(cx, cy, Tile.Empty);
          }
        }
      }
      b.alive = false;
      this.audio.hitBrick();
      this.spawnExplosion(b.x, b.y, 12, 0.2);
      return true;
    }
    if (hitSteel) {
      if (b.power >= 2) {
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            if (this.tileAt(cx, cy) === Tile.Steel) {
              this.setTile(cx, cy, Tile.Empty);
            }
          }
        }
      }
      b.alive = false;
      this.audio.hitSteel();
      this.spawnExplosion(b.x, b.y, 10, 0.16);
      return true;
    }
    return false;
  }

  private bulletHitTank(b: Bullet): Tank | null {
    const half = BULLET_SIZE / 2;
    for (const t of this.tanks) {
      if (!t.alive || t.spawnAnim > 0) {
        continue;
      }
      if (t.side === b.side) {
        continue;
      }
      if (
        aabb(
          b.x - half,
          b.y - half,
          BULLET_SIZE,
          BULLET_SIZE,
          t.x,
          t.y,
          TANK_SIZE,
          TANK_SIZE,
        )
      ) {
        b.alive = false;
        if (t.shield > 0) {
          this.spawnExplosion(b.x, b.y, 12, 0.18);
          return t;
        }
        this.damageTank(t);
        return t;
      }
    }
    return null;
  }

  private damageTank(tank: Tank): void {
    tank.hp -= 1;
    if (tank.kind === 'armor' && tank.hp > 0) {
      this.audio.hitSteel();
      this.spawnExplosion(tank.centerX, tank.centerY, 14, 0.16);
      return;
    }
    if (tank.hp > 0) {
      return;
    }
    this.killTank(tank);
  }

  private killTank(tank: Tank): void {
    tank.alive = false;
    const big = tank.kind === 'armor' || tank.side === 'player';
    this.spawnExplosion(tank.centerX, tank.centerY, big ? 46 : 30, big ? 0.6 : 0.4, big);
    if (tank.side === 'player') {
      this.audio.playerHit();
      this.audio.explosion();
      this.playerDead = true;
      this.playerRespawnTimer = PLAYER_RESPAWN_TIME;
      this.playerLevel = Math.max(0, this.playerLevel - 1);
      this.events.onPlayerKilled();
      this.player = null;
    } else {
      this.audio.explosion();
      const cfg = ENEMY_CONFIGS[tank.kind as EnemyKind];
      this.events.onScore(cfg.score);
      if (Math.random() < POWERUP_DROP_CHANCE) {
        this.dropPowerup(tank.centerX, tank.centerY);
      }
    }
  }

  private destroyBase(): void {
    if (!this.baseAlive) {
      return;
    }
    this.baseAlive = false;
    this.audio.bigExplosion();
    this.spawnExplosion(this.baseX, this.baseY, 60, 0.8, true);
    this.events.onBaseDestroyed();
  }

  private dropPowerup(x: number, y: number): void {
    const r = Math.random();
    const type: 'shield' | 'star' | 'life' | 'bomb' =
      r < 0.34 ? 'shield' : r < 0.64 ? 'star' : r < 0.85 ? 'life' : 'bomb';
    const cx = clamp(Math.floor(x / CELL), 1, COLS - 2);
    const cy = clamp(Math.floor(y / CELL), 1, ROWS - 2);
    const px = cx * CELL + CELL / 2;
    const py = cy * CELL + CELL / 2;
    this.powerups.push(new PowerUp(px, py, type, POWERUP_LIFETIME));
  }

  private updateExplosions(dt: number): void {
    for (const e of this.explosions) {
      if (!e.alive) {
        continue;
      }
      e.life -= dt;
      if (e.life <= 0) {
        e.alive = false;
      }
    }
  }

  private updatePowerups(dt: number): void {
    const p = this.player;
    for (const pu of this.powerups) {
      if (!pu.alive) {
        continue;
      }
      pu.life -= dt;
      pu.bob += dt;
      if (pu.life <= 0) {
        pu.alive = false;
        continue;
      }
      if (p && p.alive && p.spawnAnim <= 0) {
        if (aabb(pu.x - CELL, pu.y - CELL, CELL * 2, CELL * 2, p.x, p.y, TANK_SIZE, TANK_SIZE)) {
          this.collectPowerup(pu);
        }
      }
    }
  }

  private collectPowerup(pu: PowerUp): void {
    pu.alive = false;
    this.audio.powerup();
    const p = this.player;
    switch (pu.type) {
      case 'shield':
        if (p) {
          p.shield = Math.max(p.shield, 12);
        }
        break;
      case 'star':
        if (p) {
          p.level = Math.min(3, p.level + 1);
          this.playerLevel = p.level;
          this.applyPlayerConfig(p);
        }
        break;
      case 'life':
        this.events.onExtraLife();
        this.audio.extraLife();
        break;
      case 'bomb':
        this.detonateBomb();
        break;
    }
  }

  private detonateBomb(): void {
    this.audio.bigExplosion();
    for (const t of this.tanks) {
      if (t.alive && t.side === 'enemy') {
        this.spawnExplosion(t.centerX, t.centerY, 40, 0.5, true);
        t.alive = false;
        const cfg = ENEMY_CONFIGS[t.kind as EnemyKind];
        this.events.onScore(cfg.score);
      }
    }
  }

  private spawnExplosion(x: number, y: number, radius: number, life: number, big = false): void {
    this.explosions.push(new Explosion(x, y, radius, life, big));
  }

  private cull(): void {
    this.bullets = this.bullets.filter((b) => b.alive);
    this.explosions = this.explosions.filter((e) => e.alive);
    this.powerups = this.powerups.filter((p) => p.alive);
    this.tanks = this.tanks.filter((t) => t.alive);
  }

  alignedShot(tank: Tank): boolean {
    const targets: Array<{ x: number; y: number }> = [];
    if (this.player && this.player.alive && this.player.spawnAnim <= 0) {
      targets.push({ x: this.player.centerX, y: this.player.centerY });
    }
    targets.push({ x: this.baseX, y: this.baseY });
    const v = DIR_VEC[tank.dir];
    const tcx = tank.centerX;
    const tcy = tank.centerY;
    for (const tg of targets) {
      const dx = tg.x - tcx;
      const dy = tg.y - tcy;
      const ahead = dx * v.x + dy * v.y;
      if (ahead <= 0) {
        continue;
      }
      const lateral = isVertical(tank.dir) ? Math.abs(dx) : Math.abs(dy);
      if (lateral < TANK_SIZE * 0.55) {
        return true;
      }
    }
    return false;
  }
}
