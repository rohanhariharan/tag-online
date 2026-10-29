// Sanity checks for map geometry. Run after editing shared/maps.js.
import { PLAYER, WORLD } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';

const HALF_W = PLAYER.w / 2;
const HALF_H = PLAYER.h / 2;

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

let problems = 0;
const bad = (msg) => {
  problems++;
  console.log('  ✗ ' + msg);
};

for (const map of MAPS) {
  console.log(map.name);

  for (const [i, s] of map.spawns.entries()) {
    const box = { x: s.x - HALF_W, y: s.y - HALF_H, w: PLAYER.w, h: PLAYER.h };
    if (s.x < HALF_W || s.x > WORLD.w - HALF_W || s.y < HALF_H || s.y > WORLD.h - HALF_H) {
      bad(`spawn ${i} is outside the world`);
    }
    for (const w of map.walls) if (overlap(box, w)) bad(`spawn ${i} is inside a wall (${w.x},${w.y})`);
    for (const p of map.pads) if (overlap(box, p)) bad(`spawn ${i} sits on a bounce pad`);
  }

  for (const [i, p] of map.powerups.entries()) {
    for (const w of map.walls) {
      if (p.x > w.x && p.x < w.x + w.w && p.y > w.y && p.y < w.y + w.h) {
        bad(`powerup ${i} (${p.type}) is inside a wall`);
      }
    }
  }

  for (const [i, p] of map.portals.entries()) {
    for (const [x, y] of [[p.ax, p.ay], [p.bx, p.by]]) {
      for (const w of map.walls) {
        if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) bad(`portal ${i} end is inside a wall`);
      }
    }
  }

  for (const [i, p] of map.platforms.entries()) {
    if (p.x < 0 || p.x + p.w > WORLD.w) bad(`platform ${i} leaves the world horizontally`);
  }

  if (!problems) console.log('  ✓ ok');
}

console.log(problems ? `\n${problems} problem(s)` : '\nAll maps look sane.');
process.exit(problems ? 1 : 0);
