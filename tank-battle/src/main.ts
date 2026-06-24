import { LOGICAL_H, LOGICAL_W } from './constants';
import { AudioEngine } from './audio';
import { Game } from './game';
import { Input } from './input';
import { drawGame, drawOverlay } from './render';

function bootstrap(): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  app.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = (): void => {
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    const scale = Math.min(
      window.innerWidth / LOGICAL_W,
      window.innerHeight / LOGICAL_H,
    );
    canvas.style.width = `${Math.floor(LOGICAL_W * scale)}px`;
    canvas.style.height = `${Math.floor(LOGICAL_H * scale)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  window.addEventListener('resize', resize);
  resize();

  const audio = new AudioEngine();
  const input = new Input();
  input.attach(window);

  const game = new Game(audio, input);

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    const hud = game.buildHud();
    drawGame(ctx, game.currentWorld, hud, game.time);
    drawOverlay(ctx, hud, game.time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

bootstrap();
