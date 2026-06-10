import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LEVELS, parseLevel } from './levels.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Guard } from './guards.js';
import { Particles } from './particles.js';
import { AudioMan } from './audio.js';
import { Hud } from './hud.js';

const TOTAL_TIME = 480; // eight minutes for seven levels (PoP gave sixty for twelve)

// ---------- renderer / scene / post ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 130);
camera.position.set(0, 4, 11);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.85, 0.62);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- input ----------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'jump',
  KeyX: 'attack', KeyJ: 'attack',
  KeyC: 'block', KeyK: 'block',
};
const keys = {}, pressedKeys = {};
addEventListener('keydown', (e) => {
  const name = KEYMAP[e.code];
  if (name || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (name && !keys[name]) pressedKeys[name] = true;
  if (name) keys[name] = true;
  if ((e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') && !keys.jump) pressedKeys.jump = true;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') keys.jump = true;
  if (e.code === 'Enter') onEnter();
  if (e.code === 'KeyM') { const m = audio.toggleMute(); hud.toast(m ? 'MUTED' : 'SOUND ON', 1); }
  if (e.code === 'KeyR' && game.state === 'play') { hud.toast('RESTART', 1); loadLevel(game.levelIndex); }
});
addEventListener('keyup', (e) => {
  const name = KEYMAP[e.code];
  if (name) keys[name] = false;
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') keys.jump = false;
});

// ---------- game object ----------
const audio = new AudioMan();
const hud = new Hud();
const game = {
  scene, camera, audio, hud,
  input: {
    down: (n) => !!keys[n],
    pressed: (n) => !!pressedKeys[n],
  },
  state: 'title',
  levelIndex: 0,
  timeLeft: TOTAL_TIME,
  flags: { hasSword: false, hasMixtape: false },
  carry: { hp: 3, maxHp: 3 },
  tapes: 0, tapesAll: 0,
  player: null, guards: [], world: null, particles: null,
  lvl: null,
  combatHeat: 0, shake: 0,
  collectPickup, levelComplete, onPlayerDeath, onGuardDeath,
};
window.FP = game; // debug handle
game.loadLevel = (i) => loadLevel(i);

function loadLevel(i) {
  game.levelIndex = i;
  if (game.world) game.world.dispose();
  if (game.player) scene.remove(game.player.mesh);
  for (const gu of game.guards) { scene.remove(gu.mesh); scene.remove(gu.alertSprite); }
  if (game.particles) game.particles.clear();
  else game.particles = new Particles(scene);

  game.flags.hasMixtape = false;
  game.tapes = 0;
  game.combatHeat = 0;

  const lvl = parseLevel(LEVELS[i]);
  game.lvl = lvl;
  game.world = new World(game, lvl);

  let sy = lvl.spawn.y;
  for (let k = 0; k <= 10; k++) {
    if (game.world.isSolid(Math.floor(lvl.spawn.x), lvl.spawn.y - 1 - k)) { sy = lvl.spawn.y - k; break; }
  }
  game.player = new Player(game, lvl.spawn.x, sy);
  game.guards = lvl.guards.map(s => new Guard(game, s.x, s.y, s.tier));

  hud.setLevel(lvl.name, lvl.sub);
  hud.setTapes(0, lvl.totalTapes);
  hud.setHearts(game.player.hp, game.player.maxHp);
  hud.setEnemy(null);
  camera.position.x = game.player.body.x;
  camera.position.y = game.player.body.y + 2.5;
  if (game.state === 'play') hud.toast(lvl.story, 3.2);
}

function collectPickup(kind) {
  const p = game.player;
  if (kind === 'sword') {
    game.flags.hasSword = true;
    p.parts.sword.visible = true;
    audio.swordGet();
    hud.toast('SWORD ACQUIRED — X TO SWING, C TO BLOCK', 3);
    game.particles.burst(p.body.x, p.body.y + 1.2, { n: 14, color: 0xffd54a, speed: 3 });
  } else if (kind === 'tape') {
    game.tapes++; game.tapesAll++;
    audio.tape();
    hud.setTapes(game.tapes, game.lvl.totalTapes);
    game.particles.burst(p.body.x, p.body.y + 1.4, { n: 8, color: 0xff2d95, speed: 2 });
  } else if (kind === 'soda') {
    p.hp = Math.min(p.maxHp, p.hp + 1);
    audio.pickup();
    hud.toast('PERSIAN PUNCH +1', 1.4);
  } else if (kind === 'bigsoda') {
    p.maxHp++; p.hp = p.maxHp;
    game.carry.maxHp = p.maxHp;
    audio.pickup();
    hud.toast('MAX HEALTH UP!', 2);
  } else if (kind === 'mixtape') {
    game.flags.hasMixtape = true;
    audio.fanfare();
    hud.toast('THE GOLDEN MIXTAPE! THE EXIT IS OPEN', 3);
    game.shake = 0.3;
  }
  hud.setHearts(p.hp, p.maxHp);
}

function onGuardDeath(guard) {
  if (guard.tier === 'boss') {
    game.world.spawnMixtape(guard.body.x, guard.body.y + 1);
    hud.toast('DJ VIZIER IS DOWN', 2.5);
    game.shake = 0.4;
  }
}

function levelComplete() {
  if (game.state !== 'play') return;
  game.state = 'clear';
  game.carry.hp = game.player.hp;
  audio.fanfare();
  hud.overlay(`<h2>LEVEL CLEAR</h2><p>STAY FRESH</p>`);
  setTimeout(() => {
    const next = game.levelIndex + 1;
    if (next >= LEVELS.length) { winScreen(); return; }
    hud.overlay(null);
    game.state = 'play';
    loadLevel(next);
  }, 1800);
}

function onPlayerDeath(src) {
  if (game.state !== 'play') return;
  game.state = 'dying';
  const msg = src === 'fall' || src === 'void' ? 'GRAVITY WINS THIS ROUND'
    : src === 'spikes' ? 'SPIKED'
    : src === 'chomper' ? 'CHOMPED'
    : 'YOU GOT PLAYED';
  setTimeout(() => {
    hud.overlay(`<h2>${msg}</h2><p>BACK TO THE TOP OF THE TRACK</p>`);
  }, 500);
  setTimeout(() => {
    game.carry.hp = game.carry.maxHp; // PoP rules: retry with full strength, clock still running
    hud.overlay(null);
    game.state = 'play';
    loadLevel(game.levelIndex);
  }, 2000);
}

function gameOverTime() {
  game.state = 'over';
  hud.overlay(`<h2>TIME'S UP</h2><p>THE BEAT DROPPED WITHOUT YOU</p><p class="press">PRESS ENTER</p>`);
}

function winScreen() {
  game.state = 'won';
  const s = Math.max(0, game.timeLeft);
  const mm = Math.floor(s / 60), ss = String(Math.floor(s % 60)).padStart(2, '0');
  hud.overlay(
    `<h2>FRESH VICTORY</h2>` +
    `<p>THE GOLDEN MIXTAPE IS BACK</p>` +
    `<p>TIME LEFT ${mm}:${ss} · TAPES ${game.tapesAll}</p>` +
    `<p class="press">PRESS ENTER</p>`
  );
}

function resetRun() {
  game.flags.hasSword = false;
  game.flags.hasMixtape = false;
  game.carry = { hp: 3, maxHp: 3 };
  game.timeLeft = TOTAL_TIME;
  game.tapesAll = 0;
  loadLevel(0);
}

function onEnter() {
  if (game.state === 'title') {
    audio.init();
    audio.resume();
    audio.startMusic();
    hud.title(false);
    game.state = 'play';
    hud.toast(game.lvl.story, 3.4);
  } else if (game.state === 'over' || game.state === 'won') {
    hud.overlay(null);
    resetRun();
    hud.title(true);
    game.state = 'title';
  }
}

// ---------- camera ----------
function updateCamera(dt, t) {
  const p = game.player;
  if (!p) return;
  const lookAhead = p.facing * 1.8;
  const tx = p.body.x + lookAhead;
  const ty = p.body.y + 2.4;
  camera.position.x += (tx - camera.position.x) * Math.min(1, 5 * dt);
  camera.position.y += (ty - camera.position.y) * Math.min(1, 3.5 * dt);
  camera.position.z = 11;
  if (game.shake > 0) {
    game.shake = Math.max(0, game.shake - dt * 1.6);
    camera.position.x += (Math.random() - 0.5) * game.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.5;
  }
  camera.lookAt(camera.position.x, camera.position.y - 0.6, 0);
  // moonlight follows the player so the shadow box stays tight
  const moon = game.world?.moon;
  if (moon) {
    moon.position.set(p.body.x + 6, p.body.y + 10, 7);
    moon.target.position.set(p.body.x, p.body.y, 0);
  }
}

// ---------- HUD glue ----------
function nearestThreat() {
  let best = null, bestD = Infinity;
  for (const gu of game.guards) {
    if (gu.removed || gu.state === 'dead') continue;
    if (gu.state !== 'engage' && gu.state !== 'chase') continue;
    const d = Math.abs(gu.body.x - game.player.body.x);
    if (d < 9 && d < bestD) { bestD = d; best = gu; }
  }
  return best;
}

// ---------- boot + loop ----------
async function boot() {
  try { await document.fonts.ready; } catch (e) {}
  loadLevel(0);
  hud.title(true);
  hud.setTimer(game.timeLeft);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    const t = now / 1000;

    if (game.state === 'play' || game.state === 'dying') {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0 && game.state === 'play') gameOverTime();
      if (game.state === 'play') game.player.update(dt);
      const entities = [game.player, ...game.guards.filter(gu => !gu.removed && gu.state !== 'dead')];
      for (const gu of game.guards) gu.update(dt, t);
      game.world.update(dt, t, entities.filter(e => !e.dead));
      game.combatHeat = Math.max(0, game.combatHeat - dt);
      audio.setCombat(game.combatHeat > 0);
      hud.setTimer(game.timeLeft);
      hud.setHearts(game.player.hp, game.player.maxHp);
      const threat = nearestThreat();
      hud.setEnemy(threat ? { name: threat.cfg.name, hp: Math.max(0, threat.hp), max: threat.cfg.hp } : null);
    } else if (game.state === 'title') {
      game.world.update(dt, t, []);
      camera.position.x += (game.player.body.x + Math.sin(t * 0.22) * 2.5 - camera.position.x) * Math.min(1, 1.2 * dt);
      camera.lookAt(camera.position.x, camera.position.y - 0.6, 0);
    }

    game.player.updateModel(dt, t);
    game.particles.update(dt);
    if (game.state !== 'title') updateCamera(dt, t);

    composer.render();
    for (const k in pressedKeys) delete pressedKeys[k];
  });
}

boot();
