import {
  AIR_ACCEL,
  AIR_DRAG,
  AIR_JUMP_VELOCITY,
  COYOTE_TIME,
  DASH_COOLDOWN,
  DASH_SPEED,
  DASH_TIME,
  FALL_GRAVITY,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_VELOCITY,
  MAX_FALL,
  MOVE_SPEED,
  PAD_COOLDOWN,
  PAD_POWER,
  PLAYER,
  PORTAL_COOLDOWN,
  TAG_REACH,
  WORLD,
} from './constants.js';

const HALF_W = PLAYER.w / 2;
const HALF_H = PLAYER.h / 2;

function approach(current, target, maxDelta) {
  const d = target - current;
  if (d > maxDelta) return current + maxDelta;
  if (d < -maxDelta) return current - maxDelta;
  return target;
}

export function boxesOverlap(ax, ay, aw, ah, b) {
  return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
}

export function bodyBox(p) {
  return { x: p.x - HALF_W, y: p.y - HALF_H, w: PLAYER.w, h: PLAYER.h };
}

/** Two players are close enough to tag. */
export function touching(a, b) {
  return (
    Math.abs(a.x - b.x) < PLAYER.w + TAG_REACH &&
    Math.abs(a.y - b.y) < PLAYER.h + TAG_REACH
  );
}

/**
 * Drop a player at a portal exit, pushed clear of the ring so they don't fall
 * straight back in and ping-pong between the pair.
 */
function exitPortal(p, x, y, r) {
  const away = Math.sign(x - WORLD.w / 2) || 1;
  if (Math.abs(x - WORLD.w / 2) > 200) {
    p.x = x + away * (r + 18);
    p.y = y;
  } else {
    p.x = x;
    p.y = y + r + 18;
  }
  p.portalCd = PORTAL_COOLDOWN;
}

export function resetMotion(p) {
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;
  p.coyote = 0;
  p.jumpBuf = 0;
  p.jumpHeld = false;
  p.airUsed = false;
  p.dashT = 0;
  p.dashCd = 0;
  p.dashDir = 1;
  p.padCd = 0;
  p.portalCd = 0;
  p.facing = 1;
  p.speedT = 0;
  p.jumpT = 0;
  p.shieldT = 0;
}

/** Push a player away (tag knockback). */
export function knock(p, nx, ny, power) {
  p.vx = nx * power;
  p.vy = ny * power - 180;
}

/**
 * Advance one player by dt seconds.
 * Identical code runs on the server and on the client for its own player, so
 * local prediction matches the authority.
 */
export function stepPlayer(p, dt, map, frozen = false) {
  const inp = p.input || {};

  // ---- timers -----------------------------------------------------------
  if (p.dashCd > 0) p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.padCd > 0) p.padCd = Math.max(0, p.padCd - dt);
  if (p.portalCd > 0) p.portalCd = Math.max(0, p.portalCd - dt);
  if (p.speedT > 0) p.speedT = Math.max(0, p.speedT - dt);
  if (p.jumpT > 0) p.jumpT = Math.max(0, p.jumpT - dt);
  if (p.shieldT > 0) p.shieldT = Math.max(0, p.shieldT - dt);

  const ix = frozen ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  if (ix) p.facing = ix;

  // ---- dash -------------------------------------------------------------
  if (inp.dash && !frozen && p.dashCd <= 0 && p.dashT <= 0) {
    p.dashT = DASH_TIME;
    p.dashCd = DASH_COOLDOWN;
    p.dashDir = ix || p.facing || 1;
  }

  // ---- jump -------------------------------------------------------------
  if (!frozen && inp.jump) p.jumpBuf = JUMP_BUFFER;
  else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  if (p.jumpBuf > 0 && p.dashT <= 0 && !frozen) {
    if (p.onGround || p.coyote > 0) {
      p.vy = -JUMP_VELOCITY;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.jumpHeld = true;
      p.airUsed = false;
    } else if (p.jumpT > 0 && !p.airUsed) {
      p.vy = -AIR_JUMP_VELOCITY;
      p.airUsed = true;
      p.jumpBuf = 0;
      p.jumpHeld = true;
    }
  }

  // Releasing jump early gives a shorter hop.
  if (p.jumpHeld && !inp.u && p.vy < 0 && !frozen) {
    p.vy *= JUMP_CUT;
    p.jumpHeld = false;
  }

  // ---- horizontal + gravity --------------------------------------------
  if (p.dashT > 0) {
    p.dashT = Math.max(0, p.dashT - dt);
    p.vx = p.dashDir * DASH_SPEED;
    p.vy = 0;
  } else {
    const speedMul = p.speedT > 0 ? 1.45 : 1;
    const target = ix * MOVE_SPEED * speedMul;
    const rate = ix ? (p.onGround ? GROUND_ACCEL : AIR_ACCEL) : p.onGround ? GROUND_FRICTION : AIR_DRAG;
    p.vx = approach(p.vx, target, rate * dt);
    p.vy = Math.min(p.vy + (p.vy > 0 ? FALL_GRAVITY : GRAVITY) * dt, MAX_FALL);
  }

  // ---- move + collide ---------------------------------------------------
  const prevBottom = p.y + HALF_H;

  p.x += p.vx * dt;
  for (const w of map.walls) {
    if (!boxesOverlap(p.x - HALF_W, p.y - HALF_H, PLAYER.w, PLAYER.h, w)) continue;
    if (p.vx > 0) p.x = w.x - HALF_W;
    else if (p.vx < 0) p.x = w.x + w.w + HALF_W;
    p.vx = 0;
  }

  p.y += p.vy * dt;
  p.onGround = false;

  for (const w of map.walls) {
    if (!boxesOverlap(p.x - HALF_W, p.y - HALF_H, PLAYER.w, PLAYER.h, w)) continue;
    if (p.vy > 0) {
      p.y = w.y - HALF_H;
      p.onGround = true;
    } else if (p.vy < 0) {
      p.y = w.y + w.h + HALF_H;
    }
    p.vy = 0;
  }

  // One-way ledges: only land when falling onto them from above.
  if (p.vy >= 0) {
    for (const plat of map.platforms) {
      const bottom = p.y + HALF_H;
      if (
        prevBottom <= plat.y + 2 &&
        bottom >= plat.y &&
        p.x + HALF_W > plat.x &&
        p.x - HALF_W < plat.x + plat.w
      ) {
        p.y = plat.y - HALF_H;
        p.vy = 0;
        p.onGround = true;
      }
    }
  }

  if (p.onGround) {
    p.coyote = COYOTE_TIME;
    p.airUsed = false;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }

  // ---- bounce pads ------------------------------------------------------
  if (p.padCd <= 0 && p.vy >= 0) {
    for (const pad of map.pads) {
      if (boxesOverlap(p.x - HALF_W, p.y - HALF_H, PLAYER.w, PLAYER.h, pad)) {
        p.vy = -PAD_POWER;
        p.onGround = false;
        p.padCd = PAD_COOLDOWN;
        p.hitPad = { x: p.x, y: pad.y };
        break;
      }
    }
  }

  // ---- teleporters ------------------------------------------------------
  if (p.portalCd <= 0) {
    for (const portal of map.portals) {
      const da = Math.hypot(p.x - portal.ax, p.y - portal.ay);
      const db = Math.hypot(p.x - portal.bx, p.y - portal.by);
      if (da < portal.r * 0.7) {
        exitPortal(p, portal.bx, portal.by, portal.r);
        p.hitPortal = { x: portal.bx, y: portal.by };
        break;
      }
      if (db < portal.r * 0.7) {
        exitPortal(p, portal.ax, portal.ay, portal.r);
        p.hitPortal = { x: portal.ax, y: portal.ay };
        break;
      }
    }
  }

  // ---- stay inside the world -------------------------------------------
  p.x = Math.max(30 + HALF_W, Math.min(WORLD.w - 30 - HALF_W, p.x));
  p.y = Math.max(30 + HALF_H, Math.min(WORLD.h - HALF_H, p.y));
}
