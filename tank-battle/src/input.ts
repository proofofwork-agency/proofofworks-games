import { Dir } from './types';

const MOVE_KEYS: Record<string, Dir> = {
  ArrowUp: Dir.Up,
  KeyW: Dir.Up,
  ArrowDown: Dir.Down,
  KeyS: Dir.Down,
  ArrowLeft: Dir.Left,
  KeyA: Dir.Left,
  ArrowRight: Dir.Right,
  KeyD: Dir.Right,
};

export class Input {
  private held = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private moveStack: Dir[] = [];
  muted = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      return;
    }
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }
    this.held.add(code);
    this.pressedThisFrame.add(code);
    const dir = MOVE_KEYS[code];
    if (dir !== undefined && !this.moveStack.includes(dir)) {
      this.moveStack.push(dir);
    }
    if (code === 'KeyM') {
      this.muted = !this.muted;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.held.delete(code);
    const dir = MOVE_KEYS[code];
    if (dir !== undefined) {
      const idx = this.moveStack.indexOf(dir);
      if (idx >= 0) {
        this.moveStack.splice(idx, 1);
      }
    }
  };

  private onBlur = (): void => {
    this.held.clear();
    this.moveStack.length = 0;
  };

  attach(target: Window): void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  fireHeld(): boolean {
    return this.held.has('Space') || this.held.has('KeyJ') || this.held.has('KeyZ');
  }

  consumePressed(code: string): boolean {
    if (this.pressedThisFrame.has(code)) {
      this.pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  currentMoveDir(): Dir | null {
    if (this.moveStack.length === 0) {
      return null;
    }
    return this.moveStack[this.moveStack.length - 1];
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
