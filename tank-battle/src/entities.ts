import type { Dir, PowerType, Side, TankKind } from './types';
import { BULLET_SIZE, TANK_SIZE } from './constants';

let nextId = 1;

export class Tank {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  prevDir: Dir;
  kind: TankKind;
  side: Side;
  hp: number;
  maxHp: number;
  alive = true;
  moving = false;
  fireTimer = 0;
  tread = 0;
  shield = 0;
  spawnAnim = 0;
  aiTimer = 0;
  aiDirLock = 0;
  movedThisFrame = false;
  lastBumped = false;
  level = 0;
  maxBullets = 1;
  bulletPower = 1;
  bulletSpeed = 300;
  fireCooldown = 0.5;
  speed = 100;
  spawnX: number;
  spawnY: number;

  constructor(
    x: number,
    y: number,
    dir: Dir,
    kind: TankKind,
    side: Side,
    hp: number,
  ) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.spawnX = x;
    this.spawnY = y;
    this.dir = dir;
    this.prevDir = dir;
    this.kind = kind;
    this.side = side;
    this.hp = hp;
    this.maxHp = hp;
  }

  get centerX(): number {
    return this.x + TANK_SIZE / 2;
  }

  get centerY(): number {
    return this.y + TANK_SIZE / 2;
  }
}

export class Bullet {
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  power: number;
  side: Side;
  ownerId: number;
  alive = true;

  constructor(
    x: number,
    y: number,
    dir: Dir,
    speed: number,
    power: number,
    side: Side,
    ownerId: number,
  ) {
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.power = power;
    this.side = side;
    this.ownerId = ownerId;
  }

  get renderSize(): number {
    return BULLET_SIZE;
  }
}

export class Explosion {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  maxRadius: number;
  big: boolean;
  alive = true;

  constructor(x: number, y: number, radius: number, life: number, big = false) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.maxRadius = radius;
    this.life = life;
    this.maxLife = life;
    this.big = big;
  }
}

export class PowerUp {
  x: number;
  y: number;
  type: PowerType;
  life: number;
  bob = 0;
  alive = true;

  constructor(x: number, y: number, type: PowerType, life: number) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.life = life;
  }
}
