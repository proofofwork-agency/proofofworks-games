import { Dir, DIR_VEC, Tile } from './types';
import type { GamePhase } from './types';
import {
  CELL,
  COLS,
  COLORS,
  FIELD_H,
  FIELD_W,
  LOGICAL_H,
  LOGICAL_W,
  PANEL_W,
  POWERUP_META,
  ROWS,
  TANK_SIZE,
} from './constants';
import type { World } from './world';
import type { Bullet, Explosion, PowerUp, Tank } from './entities';
import { ARMOR_COLORS, ENEMY_CONFIGS } from './constants';
import { BULLET_SIZE } from './constants';

export interface HudState {
  lives: number;
  score: number;
  hiScore: number;
  level: number;
  levelName: string;
  totalLevels: number;
  phase: GamePhase;
  muted: boolean;
}

function dirToAngle(dir: Dir): number {
  return dir * (Math.PI / 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  world: World,
  hud: HudState,
  time: number,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  drawField(ctx, world, time);
  drawTanks(ctx, world, time);
  drawBullets(ctx, world);
  drawBush(ctx, world);
  drawExplosions(ctx, world);
  drawPowerups(ctx, world, time);
  drawPanel(ctx, world, hud);
}

function drawField(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  ctx.fillStyle = COLORS.fieldBg;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const t = world.tileAt(cx, cy);
      if (t === Tile.Bush) {
        continue;
      }
      const x = cx * CELL;
      const y = cy * CELL;
      if (t === Tile.Brick) {
        drawBrick(ctx, x, y);
      } else if (t === Tile.Steel) {
        drawSteel(ctx, x, y);
      } else if (t === Tile.Water) {
        drawWater(ctx, x, y, time, cx, cy);
      } else if (t === Tile.Base) {
        drawBase(ctx, x, y, world.baseAlive, time);
      }
    }
  }

  ctx.strokeStyle = COLORS.fieldEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, FIELD_W - 3, FIELD_H - 3);
}

function drawBrick(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLORS.brick;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.strokeStyle = COLORS.brickLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const half = CELL / 2;
  ctx.moveTo(x, y + half);
  ctx.lineTo(x + CELL, y + half);
  ctx.moveTo(x + half, y);
  ctx.lineTo(x + half, y + half);
  ctx.moveTo(x + half * 0.5, y + half);
  ctx.lineTo(x + half * 0.5, y + CELL);
  ctx.moveTo(x + half * 1.5, y + half);
  ctx.lineTo(x + half * 1.5, y + CELL);
  ctx.stroke();
}

function drawSteel(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLORS.steel;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = COLORS.steelLight;
  ctx.fillRect(x + 2, y + 2, CELL - 8, 3);
  ctx.fillRect(x + 2, y + 2, 3, CELL - 8);
  ctx.fillStyle = COLORS.steelDark;
  ctx.fillRect(x + CELL - 5, y + 5, 3, CELL - 8);
  ctx.fillRect(x + 5, y + CELL - 5, CELL - 8, 3);
  ctx.fillStyle = COLORS.steelDark;
  const b = 2.5;
  ctx.fillRect(x + 3, y + 3, b, b);
  ctx.fillRect(x + CELL - 5, y + 3, b, b);
  ctx.fillRect(x + 3, y + CELL - 5, b, b);
  ctx.fillRect(x + CELL - 5, y + CELL - 5, b, b);
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  cx: number,
  cy: number,
): void {
  ctx.fillStyle = COLORS.water1;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = COLORS.water2;
  const phase = time * 2 + cx * 0.7 + cy * 0.5;
  const off = (Math.sin(phase) + 1) * 2;
  ctx.fillRect(x + 2, y + 4 + off * 0.3, CELL - 4, 2);
  ctx.fillRect(x + 4, y + 14 - off * 0.3, CELL - 8, 2);
}

function drawBush(ctx: CanvasRenderingContext2D, world: World): void {
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (world.tileAt(cx, cy) !== Tile.Bush) {
        continue;
      }
      const x = cx * CELL;
      const y = cy * CELL;
      ctx.fillStyle = COLORS.bush;
      ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = COLORS.bushDark;
      for (let i = 0; i < 3; i++) {
        const bx = x + 4 + ((cx * 7 + i * 9) % (CELL - 8));
        const by = y + 4 + ((cy * 5 + i * 11) % (CELL - 8));
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  alive: boolean,
  time: number,
): void {
  const s = CELL;
  ctx.fillStyle = alive ? COLORS.base : COLORS.baseDark;
  ctx.fillRect(x, y, s, s);
  const cx = x + s / 2;
  const cy = y + s / 2;
  if (alive) {
    const glow = 0.5 + 0.5 * Math.sin(time * 3);
    ctx.fillStyle = COLORS.eagle;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 9, cy + 7);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 9, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.eagleDark;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25 + glow * 0.25;
    ctx.strokeStyle = COLORS.eagle;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#1c1410';
    ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + s - 4);
    ctx.lineTo(x + s / 2, y + 6);
    ctx.lineTo(x + s - 4, y + s - 4);
    ctx.closePath();
    ctx.fill();
  }
}

function tankColor(t: Tank): string {
  if (t.kind === 'player') {
    return COLORS.player;
  }
  if (t.kind === 'armor') {
    const idx = Math.max(0, Math.min(ARMOR_COLORS.length - 1, t.hp - 1));
    return ARMOR_COLORS[idx];
  }
  return ENEMY_CONFIGS[t.kind].color;
}

function drawTanks(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  for (const t of world.tanks) {
    if (!t.alive) {
      continue;
    }
    drawTank(ctx, t, time);
  }
}

function drawTank(ctx: CanvasRenderingContext2D, t: Tank, time: number): void {
  const cx = t.x + TANK_SIZE / 2;
  const cy = t.y + TANK_SIZE / 2;
  const half = TANK_SIZE / 2;

  if (t.spawnAnim > 0) {
    const prog = 1 - t.spawnAnim;
    const r = 6 + prog * 26;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 8);
    ctx.strokeStyle = COLORS.shield;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.rotate(Math.PI / 3);
      ctx.moveTo(r - 6, 0);
      ctx.lineTo(r, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 20);
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirToAngle(t.dir));

  const body = tankColor(t);
  const treadW = 7;
  ctx.fillStyle = '#1a1f26';
  roundRect(ctx, -half, -half + 2, treadW, TANK_SIZE - 4, 2);
  ctx.fill();
  roundRect(ctx, half - treadW, -half + 2, treadW, TANK_SIZE - 4, 2);
  ctx.fill();

  ctx.fillStyle = '#0d1117';
  const seg = 5;
  const offset = (t.tread % seg);
  for (let i = -half + 2 - seg; i < half - 2; i += seg) {
    ctx.fillRect(-half + 1, i + offset, treadW - 2, 2);
    ctx.fillRect(half - treadW + 1, i + offset, treadW - 2, 2);
  }

  ctx.fillStyle = body;
  roundRect(ctx, -half + treadW - 1, -half + 4, TANK_SIZE - (treadW - 1) * 2, TANK_SIZE - 8, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, -half + treadW, -half + 5, TANK_SIZE - treadW * 2, 4, 2);
  ctx.fill();

  ctx.fillStyle = t.kind === 'player' ? COLORS.playerAccent : '#2a3138';
  ctx.beginPath();
  ctx.arc(0, 2, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#15191e';
  ctx.fillRect(-3.5, -half - 2, 7, half + 4);
  ctx.fillStyle = body;
  ctx.fillRect(-2.5, -half - 2, 5, half + 4);

  ctx.restore();
  ctx.globalAlpha = 1;

  if (t.shield > 0) {
    const pulse = 0.4 + 0.4 * Math.sin(time * 14);
    ctx.strokeStyle = COLORS.shield;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, half + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.bullets) {
    drawBullet(ctx, b);
  }
}

function drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
  const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, BULLET_SIZE);
  grad.addColorStop(0, COLORS.bullet);
  grad.addColorStop(0.5, COLORS.bulletGlow);
  grad.addColorStop(1, 'rgba(255,180,40,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BULLET_SIZE, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.bullet;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BULLET_SIZE * 0.35, 0, Math.PI * 2);
  ctx.fill();
  const v = DIR_VEC[b.dir];
  ctx.strokeStyle = 'rgba(255,220,120,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - v.x * 10, b.y - v.y * 10);
  ctx.stroke();
}

function drawExplosions(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.explosions) {
    drawExplosion(ctx, e);
  }
}

function drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion): void {
  const p = 1 - e.life / e.maxLife;
  const r = e.maxRadius * (0.3 + p * 0.9);
  const alpha = Math.max(0, 1 - p);
  const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
  grad.addColorStop(0, COLORS.explosion[0]);
  grad.addColorStop(0.35, COLORS.explosion[1]);
  grad.addColorStop(0.7, COLORS.explosion[2]);
  grad.addColorStop(1, COLORS.explosion[3]);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = COLORS.explosion[1];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r * 1.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPowerups(ctx: CanvasRenderingContext2D, world: World, time: number): void {
  for (const pu of world.powerups) {
    drawPowerup(ctx, pu, time);
  }
}

function drawPowerup(ctx: CanvasRenderingContext2D, pu: PowerUp, time: number): void {
  const meta = POWERUP_META[pu.type];
  const blinking = pu.life < 3 && Math.floor(time * 8) % 2 === 0;
  if (blinking) {
    return;
  }
  const bob = Math.sin(pu.bob * 4) * 2;
  const x = pu.x - CELL / 2;
  const y = pu.y - CELL / 2 + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, x + 1, y + 3, CELL, CELL, 4);
  ctx.fill();
  ctx.fillStyle = '#0e151c';
  roundRect(ctx, x, y, CELL, CELL, 4);
  ctx.fill();
  ctx.strokeStyle = meta.color;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, CELL - 2, CELL - 2, 4);
  ctx.stroke();
  ctx.fillStyle = meta.color;
  ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.glyph, pu.x, pu.y + bob + 1);
}

function drawPanel(ctx: CanvasRenderingContext2D, world: World, hud: HudState): void {
  const px = FIELD_W;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(px, 0, PANEL_W, FIELD_H);
  ctx.fillStyle = COLORS.panelEdge;
  ctx.fillRect(px, 0, 2, FIELD_H);

  const cx = px + PANEL_W / 2;
  let y = 18;

  ctx.fillStyle = COLORS.star;
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('STEEL', cx, y);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('STORM', cx, y + 16);
  y += 44;

  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE', px + 12, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
  ctx.fillText(String(hud.score).padStart(6, '0'), px + PANEL_W - 12, y - 2);
  y += 22;

  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('HI', px + 12, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.gold;
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.fillText(String(hud.hiScore).padStart(6, '0'), px + PANEL_W - 12, y);
  y += 22;

  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SECTOR', px + 12, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 12px "Trebuchet MS", sans-serif';
  ctx.fillText(`${hud.level}/${hud.totalLevels}`, px + PANEL_W - 12, y);
  y += 16;
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '8px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hud.levelName, cx, y);

  y += 22;
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ENEMIES', px + 12, y);
  y += 14;
  const remaining = world.remainingEnemies();
  drawIconGrid(ctx, px + 12, y, PANEL_W - 24, remaining, COLORS.bomb);

  y = FIELD_H - 132;
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '9px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('LIVES', px + 12, y);
  y += 14;
  drawTankIcons(ctx, px + 12, y, hud.lives);

  y += 34;
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '8px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('WASD / ARROWS', px + 12, y);
  y += 11;
  ctx.fillText('SPACE  FIRE', px + 12, y);
  y += 11;
  ctx.fillText('P  PAUSE', px + 12, y);
  y += 11;
  ctx.fillText(`M  ${hud.muted ? 'UNMUTE' : 'MUTE'}`, px + 12, y);
}

function drawIconGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  count: number,
  color: string,
): void {
  const cols = 5;
  const s = 9;
  const gap = 4;
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const ix = x + c * (s + gap);
    const iy = y + r * (s + gap);
    if (ix + s > x + w) {
      break;
    }
    ctx.fillStyle = color;
    ctx.fillRect(ix, iy, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(ix + 2, iy + 2, s - 4, s - 4);
  }
}

function drawTankIcons(ctx: CanvasRenderingContext2D, x: number, y: number, count: number): void {
  const s = 14;
  const gap = 6;
  const show = Math.min(count, 6);
  for (let i = 0; i < show; i++) {
    const ix = x + i * (s + gap);
    ctx.fillStyle = COLORS.player;
    roundRect(ctx, ix, y, s, s, 3);
    ctx.fill();
    ctx.fillStyle = '#15191e';
    ctx.fillRect(ix + s / 2 - 1.5, y - 3, 3, 6);
  }
  if (count > 6) {
    ctx.fillStyle = COLORS.ink;
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`x${count}`, x + 6 * (s + gap), y + 1);
  }
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  hud: HudState,
  time: number,
): void {
  if (hud.phase === 'playing' || hud.phase === 'ready') {
    if (hud.phase === 'ready') {
      drawReady(ctx, hud);
    }
    return;
  }

  ctx.fillStyle = 'rgba(4,8,12,0.72)';
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (hud.phase === 'title') {
    drawTitle(ctx, FIELD_W / 2, FIELD_H / 2, time);
  } else if (hud.phase === 'paused') {
    ctx.fillStyle = COLORS.ink;
    ctx.font = 'bold 40px "Trebuchet MS", sans-serif';
    ctx.fillText('PAUSED', FIELD_W / 2, FIELD_H / 2 - 10);
    ctx.fillStyle = COLORS.inkDim;
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.fillText('PRESS P TO RESUME', FIELD_W / 2, FIELD_H / 2 + 26);
  } else if (hud.phase === 'cleared') {
    ctx.fillStyle = COLORS.star;
    ctx.font = 'bold 38px "Trebuchet MS", sans-serif';
    ctx.fillText('SECTOR CLEARED', FIELD_W / 2, FIELD_H / 2 - 16);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '14px "Trebuchet MS", sans-serif';
    ctx.fillText(`SCORE  ${hud.score}`, FIELD_W / 2, FIELD_H / 2 + 20);
  } else if (hud.phase === 'gameover') {
    ctx.fillStyle = COLORS.bomb;
    ctx.font = 'bold 46px "Trebuchet MS", sans-serif';
    ctx.fillText('GAME OVER', FIELD_W / 2, FIELD_H / 2 - 24);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.fillText(`FINAL SCORE  ${hud.score}`, FIELD_W / 2, FIELD_H / 2 + 14);
    ctx.fillStyle = COLORS.gold;
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.fillText(`HI  ${hud.hiScore}`, FIELD_W / 2, FIELD_H / 2 + 36);
    ctx.fillStyle = COLORS.inkDim;
    const blink = Math.floor(time * 2) % 2 === 0;
    if (blink) {
      ctx.fillText('PRESS ENTER', FIELD_W / 2, FIELD_H / 2 + 70);
    }
  } else if (hud.phase === 'victory') {
    ctx.fillStyle = COLORS.gold;
    ctx.font = 'bold 46px "Trebuchet MS", sans-serif';
    ctx.fillText('VICTORY!', FIELD_W / 2, FIELD_H / 2 - 24);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '15px "Trebuchet MS", sans-serif';
    ctx.fillText(`ALL SECTORS CLEARED`, FIELD_W / 2, FIELD_H / 2 + 8);
    ctx.fillStyle = COLORS.star;
    ctx.fillText(`SCORE  ${hud.score}`, FIELD_W / 2, FIELD_H / 2 + 32);
    ctx.fillStyle = COLORS.inkDim;
    const blink = Math.floor(time * 2) % 2 === 0;
    if (blink) {
      ctx.fillText('PRESS ENTER', FIELD_W / 2, FIELD_H / 2 + 70);
    }
  }
}

function drawReady(ctx: CanvasRenderingContext2D, hud: HudState): void {
  ctx.fillStyle = 'rgba(4,8,12,0.45)';
  ctx.fillRect(0, FIELD_H / 2 - 70, FIELD_W, 140);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.gold;
  ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
  ctx.fillText(`SECTOR ${hud.level}`, FIELD_W / 2, FIELD_H / 2 - 18);
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 18px "Trebuchet MS", sans-serif';
  ctx.fillText(hud.levelName, FIELD_W / 2, FIELD_H / 2 + 14);
  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.fillText('DEFEND THE HQ', FIELD_W / 2, FIELD_H / 2 + 40);
}

function drawTitle(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.fillStyle = COLORS.gold;
  ctx.font = 'bold 64px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STEEL', x, y - 70);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('STORM', x, y - 18);

  ctx.fillStyle = COLORS.inkDim;
  ctx.font = '13px "Trebuchet MS", sans-serif';
  ctx.fillText('A TOP-DOWN TANK BATTLE', x, y + 24);

  ctx.fillStyle = COLORS.ink;
  ctx.font = '12px "Trebuchet MS", sans-serif';
  ctx.fillText('WASD / ARROWS  MOVE     SPACE  FIRE', x, y + 58);
  ctx.fillStyle = COLORS.inkDim;
  ctx.fillText('P  PAUSE     M  MUTE', x, y + 78);

  const blink = Math.floor(time * 2) % 2 === 0;
  if (blink) {
    ctx.fillStyle = COLORS.star;
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.fillText('PRESS ENTER TO DEPLOY', x, y + 116);
  }
}
