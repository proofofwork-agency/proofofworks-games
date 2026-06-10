// DOM-overlay HUD: PoP-style dual health bars at the bottom, timer up top.
export class Hud {
  constructor() {
    this.el = {
      lvlName: document.getElementById('lvl-name'),
      lvlSub: document.getElementById('lvl-sub'),
      timer: document.getElementById('timer'),
      tapes: document.getElementById('tapes'),
      hearts: document.getElementById('hearts'),
      ename: document.getElementById('ename'),
      ehearts: document.getElementById('ehearts'),
      enemy: document.getElementById('enemy'),
      toast: document.getElementById('toast'),
      overlay: document.getElementById('overlay'),
      title: document.getElementById('title-screen'),
    };
    this._hearts = ''; this._ehearts = ''; this._toastTimer = null;
  }

  setLevel(name, sub) {
    this.el.lvlName.textContent = name;
    this.el.lvlSub.textContent = sub;
  }
  setTimer(s) {
    s = Math.max(0, s);
    const mm = String(Math.floor(s / 60));
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    this.el.timer.textContent = mm + ':' + ss;
    this.el.timer.classList.toggle('low', s < 60);
  }
  setTapes(got, total) {
    this.el.tapes.textContent = '⏵ TAPES ' + got + '/' + total;
  }
  setHearts(hp, max) {
    const key = hp + '/' + max;
    if (key === this._hearts) return;
    this._hearts = key;
    this.el.hearts.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const s = document.createElement('span');
      s.className = 'link' + (i < hp ? '' : ' off');
      this.el.hearts.appendChild(s);
    }
  }
  setEnemy(info) {
    if (!info) {
      this.el.enemy.classList.add('hidden');
      this._ehearts = '';
      return;
    }
    this.el.enemy.classList.remove('hidden');
    this.el.ename.textContent = info.name;
    const key = info.name + info.hp + '/' + info.max;
    if (key === this._ehearts) return;
    this._ehearts = key;
    this.el.ehearts.innerHTML = '';
    for (let i = 0; i < info.max; i++) {
      const s = document.createElement('span');
      s.className = 'link foe' + (i < info.hp ? '' : ' off');
      this.el.ehearts.appendChild(s);
    }
  }
  toast(msg, dur = 2.4) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth; // restart the animation
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), dur * 1000);
  }
  overlay(html) {
    const o = this.el.overlay;
    if (!html) { o.classList.add('hidden'); o.innerHTML = ''; return; }
    o.innerHTML = html;
    o.classList.remove('hidden');
  }
  title(show) {
    this.el.title.classList.toggle('hidden', !show);
  }
}
