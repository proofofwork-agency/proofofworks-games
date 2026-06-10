// Tiny AABB-vs-tile-grid physics. The whole game plays on the z=0 plane.

export const GRAVITY = 22;
export const FALL_DMG_HEIGHT = 4.3;
export const FALL_DEATH_HEIGHT = 7;

// body: { x, y, w, h, vx, vy, grounded }  — x is center, y is feet.
export function moveBody(world, b, dt) {
  // X axis
  b.x += b.vx * dt;
  {
    const minY = Math.floor(b.y + 0.001), maxY = Math.floor(b.y + b.h - 0.001);
    for (let ty = minY; ty <= maxY; ty++) {
      if (b.vx > 0) {
        const tx = Math.floor(b.x + b.w / 2);
        if (world.isSolid(tx, ty)) { b.x = tx - b.w / 2 - 0.001; b.vx = 0; }
      } else if (b.vx < 0) {
        const tx = Math.floor(b.x - b.w / 2);
        if (world.isSolid(tx, ty)) { b.x = tx + 1 + b.w / 2 + 0.001; b.vx = 0; }
      }
    }
  }
  // Y axis
  b.y += b.vy * dt;
  b.grounded = false;
  {
    const minX = Math.floor(b.x - b.w / 2 + 0.001), maxX = Math.floor(b.x + b.w / 2 - 0.001);
    for (let tx = minX; tx <= maxX; tx++) {
      if (b.vy <= 0) {
        const ty = Math.floor(b.y);
        if (world.isSolid(tx, ty)) { b.y = ty + 1; b.vy = 0; b.grounded = true; }
      } else {
        const ty = Math.floor(b.y + b.h);
        if (world.isSolid(tx, ty)) { b.y = ty - b.h - 0.001; b.vy = 0; }
      }
    }
  }
}

// Is there a clear horizontal line (no solid tiles) between two points at eye height?
export function lineClear(world, x0, x1, y) {
  const ty = Math.floor(y);
  const a = Math.floor(Math.min(x0, x1)), b = Math.floor(Math.max(x0, x1));
  for (let tx = a + 1; tx < b; tx++) if (world.isSolid(tx, ty)) return false;
  return true;
}

// Is the tile ahead+below solid (i.e. safe to keep walking)?
export function groundAhead(world, x, y, dir) {
  return world.isSolid(Math.floor(x + dir * 0.6), Math.floor(y - 0.5));
}
