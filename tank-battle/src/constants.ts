import type { EnemyKind, TankConfig } from './types';

export const CELL = 24;
export const COLS = 26;
export const ROWS = 26;
export const FIELD_W = COLS * CELL;
export const FIELD_H = ROWS * CELL;
export const TANK_SIZE = CELL * 2;
export const HALF_TANK = TANK_SIZE / 2;
export const BULLET_SIZE = 9;

export const BLOCK = 2;
export const GRID = COLS / BLOCK;

export const PANEL_W = 132;
export const LOGICAL_W = FIELD_W + PANEL_W;
export const LOGICAL_H = FIELD_H;

export const PLAYER_START_LIVES = 3;
export const MAX_CONCURRENT_ENEMIES = 4;
export const ENEMY_SPAWN_INTERVAL = 1.7;
export const SPAWN_ANIM_TIME = 1.0;
export const PLAYER_RESPAWN_TIME = 1.2;
export const READY_TIME = 1.8;
export const CLEARED_TIME = 2.4;

export const BASE_BLOCK_X = 6;
export const BASE_BLOCK_Y = 12;
export const PLAYER_SPAWN_BLOCK_X = 8;
export const PLAYER_SPAWN_BLOCK_Y = 12;
export const ENEMY_SPAWN_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [6, 0],
  [12, 0],
];

export const POWERUP_DROP_CHANCE = 0.16;
export const POWERUP_LIFETIME = 13;

export function blockToPx(block: number): number {
  return block * BLOCK * CELL;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function snapToCell(v: number): number {
  return Math.round(v / CELL) * CELL;
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function randInt(lo: number, hi: number): number {
  return Math.floor(rand(lo, hi + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export const ENEMY_CONFIGS: Record<EnemyKind, TankConfig> = {
  basic: {
    speed: 58,
    fireCooldown: 1.5,
    bulletSpeed: 200,
    maxHp: 1,
    color: '#c3ccd6',
    accent: '#7f8a96',
    score: 100,
    bulletPower: 1,
    maxBullets: 1,
  },
  fast: {
    speed: 116,
    fireCooldown: 1.05,
    bulletSpeed: 270,
    maxHp: 1,
    color: '#67d0e8',
    accent: '#2b8aa3',
    score: 200,
    bulletPower: 1,
    maxBullets: 1,
  },
  power: {
    speed: 72,
    fireCooldown: 1.25,
    bulletSpeed: 250,
    maxHp: 1,
    color: '#e066b0',
    accent: '#9a2f73',
    score: 300,
    bulletPower: 2,
    maxBullets: 1,
  },
  armor: {
    speed: 66,
    fireCooldown: 1.35,
    bulletSpeed: 225,
    maxHp: 4,
    color: '#8fd14f',
    accent: '#4f8a26',
    score: 400,
    bulletPower: 1,
    maxBullets: 1,
  },
};

export const ARMOR_COLORS: readonly string[] = ['#8fd14f', '#e0d24a', '#e88a3c', '#e0524a'];

export interface PlayerConfig {
  speed: number;
  fireCooldown: number;
  bulletSpeed: number;
  bulletPower: number;
  maxBullets: number;
}

export function playerConfig(level: number): PlayerConfig {
  const lvl = Math.max(0, Math.min(3, level));
  const table: PlayerConfig[] = [
    { speed: 104, fireCooldown: 0.5, bulletSpeed: 300, bulletPower: 1, maxBullets: 1 },
    { speed: 114, fireCooldown: 0.36, bulletSpeed: 320, bulletPower: 1, maxBullets: 1 },
    { speed: 120, fireCooldown: 0.32, bulletSpeed: 340, bulletPower: 1, maxBullets: 2 },
    { speed: 126, fireCooldown: 0.28, bulletSpeed: 360, bulletPower: 2, maxBullets: 2 },
  ];
  return table[lvl];
}

export const COLORS = {
  bg: '#0b0f14',
  panel: '#0e151c',
  panelEdge: '#1d2733',
  fieldBg: '#0a131b',
  fieldEdge: '#26323f',
  gold: '#ffd24a',
  brick: '#c8743a',
  brickDark: '#9e5526',
  brickLine: '#7a4019',
  steel: '#9aa6b2',
  steelDark: '#6b7682',
  steelLight: '#cdd6df',
  water1: '#2f6fb0',
  water2: '#3f8ad0',
  bush: '#3fa34a',
  bushDark: '#2c7a34',
  base: '#5c6b78',
  baseDark: '#3a4651',
  eagle: '#ffd24a',
  eagleDark: '#b8860b',
  player: '#f4d23c',
  playerAccent: '#fff7d6',
  bullet: '#fff8d0',
  bulletGlow: '#ffd24a',
  explosion: ['#fff3c4', '#ffd24a', '#ff8a3c', '#ff4a2c'],
  shield: '#67d0e8',
  star: '#ffd24a',
  life: '#7CFC8A',
  bomb: '#ff5a4a',
  ink: '#e7eef5',
  inkDim: '#8a98a6',
  hud: '#cdd6df',
};

export const POWERUP_META: Record<
  'shield' | 'star' | 'life' | 'bomb',
  { label: string; color: string; glyph: string }
> = {
  shield: { label: 'SHIELD', color: COLORS.shield, glyph: '⛨' },
  star: { label: 'STAR', color: COLORS.star, glyph: '★' },
  life: { label: '1UP', color: COLORS.life, glyph: '❤' },
  bomb: { label: 'BOMB', color: COLORS.bomb, glyph: '✸' },
};
