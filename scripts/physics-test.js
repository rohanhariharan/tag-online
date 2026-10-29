// Physics regression checks against the real map data.
// Usage: node scripts/physics-test.js
import { JUMP_VELOCITY, GRAVITY, PLAYER } from '../shared/constants.js';
import { MAPS, getMap } from '../shared/maps.js';
import { resetMotion, stepPlayer } from '../shared/physics.js';

const DT = 1 / 60;
let failures = 0;

const check = (label, pass, detail = '') => {
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures++;
};

const makePlayer = (x, y, vy = 0) => {
  const p = { x, y, vx: 0, vy, input: {}, facing: 1 };
  resetMotion(p);
  p.x = x;
  p.y = y;
  p.vy = vy;
  return p;
};

const map = getMap('meadow');
const floorY = map.walls[0].y; // ground top
const floorRest = floorY - PLAYER.h / 2;

// 1. gravity settles on the floor
let p = makePlayer(60, 300);
for (let i = 0; i < 240; i++) stepPlayer(p, DT, map, false);
check('falls and rests on the ground', Math.abs(p.y - floorRest) < 0.6 && p.onGround, `y=${p.y.toFixed(1)}`);

// 2. full jump height is in the expected band
p = makePlayer(60, floorRest);
stepPlayer(p, DT, map, false);
let minY = p.y;
for (let i = 0; i < 90; i++) {
  p.input = { u: true, jump: i === 0 };
  stepPlayer(p, DT, map, false);
  minY = Math.min(minY, p.y);
}
const height = floorRest - minY;
const expected = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
check('jump height matches gravity', Math.abs(height - expected) < 25, `${height.toFixed(0)}px vs ~${expected.toFixed(0)}px`);

// 3. one-way ledge: falls onto it, then passes through it from below
const plat = map.platforms.reduce((a, b) => (b.w > a.w ? b : a));
const platTop = plat.y - PLAYER.h / 2;

p = makePlayer(plat.x + plat.w / 2, plat.y - 200);
for (let i = 0; i < 180; i++) stepPlayer(p, DT, map, false);
check('lands on a ledge from above', Math.abs(p.y - platTop) < 0.6 && p.onGround, `y=${p.y.toFixed(1)}`);

p = makePlayer(plat.x + plat.w / 2, plat.y + 120, -JUMP_VELOCITY);
let passed = false;
for (let i = 0; i < 120; i++) {
  p.input = {};
  stepPlayer(p, DT, map, false);
  if (p.y < platTop - 20) passed = true;
}
check('passes up through a ledge', passed);

// 4. side walls stop you
p = makePlayer(60, floorRest);
for (let i = 0; i < 120; i++) {
  p.input = { l: true };
  stepPlayer(p, DT, map, false);
}
check('left wall blocks movement', p.x >= 30 + PLAYER.w / 2 - 0.5, `x=${p.x.toFixed(1)}`);

// 5. dash sets its cooldown and burst speed
p = makePlayer(200, floorRest);
stepPlayer(p, DT, map, false);
p.input = { r: true, dash: true };
stepPlayer(p, DT, map, false);
check('dash gives a burst and a cooldown', p.vx > 900 && p.dashCd > 2, `vx=${p.vx.toFixed(0)}`);

// 6. every map spawn is on solid ground
for (const m of MAPS) {
  const spawn = m.spawns[0];
  const q = makePlayer(spawn.x, spawn.y - 4);
  for (let i = 0; i < 90; i++) stepPlayer(q, DT, m, false);
  check(`${m.name}: spawn settles on the ground`, q.onGround && Math.abs(q.y - (floorY - PLAYER.h / 2)) < 1);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nPhysics ok.');
process.exit(failures ? 1 : 0);
