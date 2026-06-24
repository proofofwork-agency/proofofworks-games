export enum Dir {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

export interface Vec {
  x: number;
  y: number;
}

export const DIR_VEC: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const ALL_DIRS: readonly Dir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];

export function isVertical(dir: Dir): boolean {
  return dir === Dir.Up || dir === Dir.Down;
}

export function turnAxis(dir: Dir): 0 | 1 {
  return isVertical(dir) ? 1 : 0;
}

export function dirFromDelta(dx: number, dy: number): Dir {
  return Math.abs(dx) >= Math.abs(dy)
    ? dx >= 0
      ? Dir.Right
      : Dir.Left
    : dy >= 0
      ? Dir.Down
      : Dir.Up;
}

export enum Tile {
  Empty = 0,
  Brick = 1,
  Steel = 2,
  Water = 3,
  Bush = 4,
  Base = 5,
}

export const SOLID_TANK: ReadonlySet<Tile> = new Set<Tile>([
  Tile.Brick,
  Tile.Steel,
  Tile.Water,
  Tile.Base,
]);

export const SOLID_BULLET: ReadonlySet<Tile> = new Set<Tile>([
  Tile.Brick,
  Tile.Steel,
  Tile.Base,
]);

export type TankKind = 'player' | 'basic' | 'fast' | 'power' | 'armor';
export type EnemyKind = 'basic' | 'fast' | 'power' | 'armor';
export type Side = 'player' | 'enemy';
export type PowerType = 'shield' | 'star' | 'life' | 'bomb';

export type GamePhase =
  | 'title'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'cleared'
  | 'gameover'
  | 'victory';

export interface TankConfig {
  speed: number;
  fireCooldown: number;
  bulletSpeed: number;
  maxHp: number;
  color: string;
  accent: string;
  score: number;
  bulletPower: number;
  maxBullets: number;
}
