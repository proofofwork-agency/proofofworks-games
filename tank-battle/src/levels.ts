import { Tile } from './types';
import { COLS, GRID, ROWS } from './constants';

export interface LevelDef {
  name: string;
  terrain: readonly string[];
  enemies: readonly ('basic' | 'fast' | 'power' | 'armor')[];
}

export const LEVELS: readonly LevelDef[] = [
  {
    name: 'OUTPOST 14',
    terrain: [
      '             ',
      ' BB  BBB  BB ',
      '             ',
      '  B       B  ',
      '  B  S S  B  ',
      '    B   B    ',
      '   B   B B   ',
      '    B   B    ',
      '  B  T T  B  ',
      '  B       B  ',
      '             ',
      ' BB  BBB  BB ',
      '             ',
    ],
    enemies: [
      'basic', 'basic', 'fast', 'basic',
      'fast', 'basic', 'basic', 'fast',
      'basic', 'basic', 'fast', 'fast',
    ],
  },
  {
    name: 'CROSSFIRE',
    terrain: [
      '             ',
      '  BBB   BBB  ',
      '  B       B  ',
      '  B  W W  B  ',
      '   WW S WW   ',
      '    B   B    ',
      ' T  B   B  T ',
      '    B   B    ',
      '   WW S WW   ',
      '  B  W W  B  ',
      '  B       B  ',
      '  BBB   BBB  ',
      '             ',
    ],
    enemies: [
      'fast', 'basic', 'power', 'fast',
      'basic', 'armor', 'fast', 'power',
      'basic', 'fast', 'armor', 'power',
      'fast', 'basic',
    ],
  },
  {
    name: 'STEEL CITADEL',
    terrain: [
      '             ',
      ' BSB BSB BSB ',
      '             ',
      '  BB     BB  ',
      '  B  SSS  B  ',
      '  B  S S  B  ',
      ' WW  S S  WW ',
      '  B  S S  B  ',
      '  B  SSS  B  ',
      '  BB     BB  ',
      '             ',
      ' BSB B B BSB ',
      '             ',
    ],
    enemies: [
      'armor', 'fast', 'power', 'armor',
      'fast', 'power', 'armor', 'fast',
      'power', 'armor', 'fast', 'power',
      'armor', 'power', 'fast', 'armor',
      'power', 'fast',
    ],
  },
];

const TERRAIN_MAP: Record<string, Tile> = {
  ' ': Tile.Empty,
  '.': Tile.Empty,
  B: Tile.Brick,
  S: Tile.Steel,
  W: Tile.Water,
  T: Tile.Bush,
};

export interface ParsedTerrain {
  grid: Uint8Array;
}

export function parseTerrain(level: LevelDef): ParsedTerrain {
  const rows = level.terrain;
  if (rows.length !== GRID) {
    throw new Error(`Level "${level.name}" has ${rows.length} rows, expected ${GRID}`);
  }
  const grid = new Uint8Array(COLS * ROWS);
  for (let by = 0; by < GRID; by++) {
    const row = rows[by];
    if (row.length !== GRID) {
      throw new Error(
        `Level "${level.name}" row ${by} is ${row.length} cols, expected ${GRID}`,
      );
    }
    for (let bx = 0; bx < GRID; bx++) {
      const tile = TERRAIN_MAP[row[bx]] ?? Tile.Empty;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = bx * 2 + dx;
          const cy = by * 2 + dy;
          grid[cy * COLS + cx] = tile;
        }
      }
    }
  }
  return { grid };
}

export const TOTAL_LEVELS = LEVELS.length;
