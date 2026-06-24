import type { Dir } from './types';
import { ALL_DIRS, DIR_VEC } from './types';
import type { Tank } from './entities';
import { TANK_SIZE } from './constants';
import { pick, rand } from './constants';

export interface AIWorld {
  baseX: number;
  baseY: number;
  playerAlive: boolean;
  playerX: number;
  playerY: number;
  canAdvance(tank: Tank, dir: Dir, step: number): boolean;
  alignedShot(tank: Tank): boolean;
  fire(tank: Tank): void;
}

export function updateEnemyAI(ai: AIWorld, tank: Tank, dt: number): void {
  tank.aiTimer -= dt;

  const blocked = tank.moving && !tank.movedThisFrame;
  let decide = false;
  if (tank.aiTimer <= 0) {
    decide = true;
  } else if (blocked && tank.aiDirLock <= 0) {
    decide = true;
  }
  if (decide) {
    tank.aiDirLock = 0.25;
    tank.aiTimer = rand(0.5, 1.7);
    chooseDirection(ai, tank);
  }

  tank.moving = true;
  tank.aiDirLock -= dt;

  if (tank.fireTimer <= 0) {
    const aligned = ai.alignedShot(tank);
    const chance = aligned ? 0.9 : 0.12;
    if (Math.random() < chance) {
      ai.fire(tank);
    }
  }
}

function chooseDirection(ai: AIWorld, tank: Tank): void {
  const usePlayer =
    ai.playerAlive && Math.random() < 0.45
      ? { x: ai.playerX, y: ai.playerY }
      : { x: ai.baseX, y: ai.baseY };

  const tx = usePlayer.x;
  const ty = usePlayer.y;
  const cx = tank.x + TANK_SIZE / 2;
  const cy = tank.y + TANK_SIZE / 2;

  const scored = ALL_DIRS.map((dir) => {
    const v = DIR_VEC[dir];
    const step = TANK_SIZE * 0.5;
    const nx = cx + v.x * step;
    const ny = cy + v.y * step;
    const dist = Math.abs(nx - tx) + Math.abs(ny - ty);
    return { dir, dist };
  });

  scored.sort((a, b) => a.dist - b.dist);

  const free = scored.filter((s) => ai.canAdvance(tank, s.dir, 6));
  if (free.length > 0) {
    if (Math.random() < 0.78 || free[0].dist < scored[0].dist + 1) {
      tank.dir = free[0].dir;
      return;
    }
    tank.dir = pick(free).dir;
    return;
  }

  const anyFree = ALL_DIRS.filter((d) => ai.canAdvance(tank, d, 6));
  if (anyFree.length > 0) {
    tank.dir = pick(anyFree);
  }
}
