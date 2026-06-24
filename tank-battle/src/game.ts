import { type GamePhase } from './types';
import {
  CLEARED_TIME,
  PLAYER_START_LIVES,
  READY_TIME,
} from './constants';
import { TOTAL_LEVELS } from './levels';
import type { AudioEngine } from './audio';
import type { Input } from './input';
import { World, type WorldEvents } from './world';
import type { HudState } from './render';

const HI_KEY = 'steelstorm.hiscore';

export class Game implements WorldEvents {
  private world: World;
  private audio: AudioEngine;
  private input: Input;

  phase: GamePhase = 'title';
  score = 0;
  hiScore = 0;
  lives = PLAYER_START_LIVES;
  level = 1;
  time = 0;

  private readyTimer = 0;
  private clearedTimer = 0;
  private requestGameOver = false;

  constructor(audio: AudioEngine, input: Input) {
    this.audio = audio;
    this.input = input;
    this.world = new World(audio, this);
    this.hiScore = this.loadHi();
    this.world.loadLevel(0, false);
  }

  get currentWorld(): World {
    return this.world;
  }

  private loadHi(): number {
    try {
      return parseInt(localStorage.getItem(HI_KEY) ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  private saveHi(): void {
    try {
      localStorage.setItem(HI_KEY, String(this.hiScore));
    } catch {
      /* ignore */
    }
  }

  onScore(points: number): void {
    this.score += points;
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
    }
  }

  onPlayerKilled(): void {
    this.lives -= 1;
    if (this.lives <= 0) {
      this.requestGameOver = true;
    }
  }

  onBaseDestroyed(): void {
    this.requestGameOver = true;
  }

  onExtraLife(): void {
    this.lives += 1;
  }

  update(dt: number): void {
    this.time += dt;
    this.audio.setMuted(this.input.muted);

    if (this.input.consumePressed('Enter')) {
      this.onEnter();
    }
    if (this.input.consumePressed('KeyP')) {
      this.togglePause();
    }

    switch (this.phase) {
      case 'title':
        break;
      case 'ready':
        this.readyTimer -= dt;
        if (this.readyTimer <= 0) {
          this.phase = 'playing';
        }
        break;
      case 'playing':
        this.tickPlay(dt);
        break;
      case 'paused':
        break;
      case 'cleared':
        this.clearedTimer -= dt;
        if (this.clearedTimer <= 0) {
          this.advanceLevel();
        }
        break;
      case 'gameover':
      case 'victory':
        break;
    }

    this.input.endFrame();
  }

  private tickPlay(dt: number): void {
    const dir = this.input.currentMoveDir();
    this.world.setPlayerIntent(dir, this.input.fireHeld());
    this.world.update(dt);

    if (this.requestGameOver) {
      this.enterGameOver();
      return;
    }
    if (this.world.isCleared()) {
      this.enterCleared();
    }
  }

  private onEnter(): void {
    if (this.phase === 'title') {
      this.startGame();
    } else if (this.phase === 'gameover' || this.phase === 'victory') {
      this.phase = 'title';
      this.score = 0;
      this.lives = PLAYER_START_LIVES;
      this.level = 1;
      this.world.loadLevel(0, false);
    }
  }

  private togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
    }
  }

  private startGame(): void {
    this.audio.resume();
    this.audio.start();
    this.score = 0;
    this.lives = PLAYER_START_LIVES;
    this.level = 1;
    this.requestGameOver = false;
    this.world.loadLevel(0, false);
    this.enterReady();
  }

  private enterReady(): void {
    this.phase = 'ready';
    this.readyTimer = READY_TIME;
  }

  private enterCleared(): void {
    this.phase = 'cleared';
    this.clearedTimer = CLEARED_TIME;
    this.audio.levelClear();
  }

  private advanceLevel(): void {
    this.level += 1;
    if (this.level > TOTAL_LEVELS) {
      this.enterVictory();
      return;
    }
    this.requestGameOver = false;
    this.world.loadLevel(this.level - 1, true);
    this.enterReady();
  }

  private enterGameOver(): void {
    this.phase = 'gameover';
    this.requestGameOver = false;
    this.saveHi();
    this.audio.gameOver();
  }

  private enterVictory(): void {
    this.phase = 'victory';
    this.saveHi();
    this.audio.victory();
  }

  buildHud(): HudState {
    return {
      lives: Math.max(0, this.lives),
      score: this.score,
      hiScore: this.hiScore,
      level: this.level,
      levelName: this.world.currentLevel.name,
      totalLevels: TOTAL_LEVELS,
      phase: this.phase,
      muted: this.input.muted,
    };
  }
}
