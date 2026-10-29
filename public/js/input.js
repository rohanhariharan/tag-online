// Keyboard + touch input: horizontal movement, held jump, edge-triggered jump/dash.

const keys = new Set();
let jumpQueued = false;
let jumpQueuedAt = 0;
let dashQueued = false;
let dashQueuedAt = 0;

const stick = { active: false, id: null, x: 0, y: 0 };
const THRESHOLD = 0.26;
const EDGE_TTL = 400;

const JUMP_CODES = new Set(['Space', 'KeyW', 'ArrowUp']);
const DASH_CODES = new Set(['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyK']);
const LEFT_CODES = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_CODES = new Set(['KeyD', 'ArrowRight']);

export function initInput() {
  const knobEl = document.getElementById('stick-knob');
  const stickEl = document.getElementById('stick');

  window.addEventListener('keydown', (e) => {
    if (JUMP_CODES.has(e.code)) {
      e.preventDefault();
      if (!keys.has(e.code)) queueJump();
      keys.add(e.code);
      return;
    }
    if (DASH_CODES.has(e.code)) {
      e.preventDefault();
      if (!keys.has(e.code)) queueDash();
      keys.add(e.code);
      return;
    }
    if (LEFT_CODES.has(e.code) || RIGHT_CODES.has(e.code)) {
      e.preventDefault();
      keys.add(e.code);
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    stick.active = false;
    stick.x = 0;
    stick.y = 0;
    setKnob(0, 0);
  });

  // ---- virtual stick --------------------------------------------------
  if (stickEl && knobEl) {
    const radius = 52;

    const update = (e) => {
      const rect = stickEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = (e.clientX - cx) / radius;
      let dy = (e.clientY - cy) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      stick.x = dx;
      stick.y = dy;
      setKnob(dx * radius, dy * radius);
    };

    stickEl.addEventListener('pointerdown', (e) => {
      stick.active = true;
      stick.id = e.pointerId;
      stickEl.setPointerCapture(e.pointerId);
      update(e);
      e.preventDefault();
    });

    stickEl.addEventListener('pointermove', (e) => {
      if (!stick.active || e.pointerId !== stick.id) return;
      update(e);
      e.preventDefault();
    });

    const end = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.active = false;
      stick.id = null;
      stick.x = 0;
      stick.y = 0;
      setKnob(0, 0);
    };
    stickEl.addEventListener('pointerup', end);
    stickEl.addEventListener('pointercancel', end);
    stickEl.addEventListener('lostpointercapture', end);
  }

  function setKnob(x, y) {
    if (!knobEl) return;
    knobEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  const jumpBtn = document.getElementById('jump-btn');
  if (jumpBtn) {
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      queueJump();
    });
  }

  const dashBtn = document.getElementById('dash-btn');
  if (dashBtn) {
    dashBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      queueDash();
    });
  }
}

export function queueJump() {
  jumpQueued = true;
  jumpQueuedAt = performance.now();
}

export function queueDash() {
  dashQueued = true;
  dashQueuedAt = performance.now();
}

export function consumeJump() {
  if (!jumpQueued || performance.now() - jumpQueuedAt > EDGE_TTL) {
    jumpQueued = false;
    return false;
  }
  jumpQueued = false;
  return true;
}

export function consumeDash() {
  if (!dashQueued || performance.now() - dashQueuedAt > EDGE_TTL) {
    dashQueued = false;
    return false;
  }
  dashQueued = false;
  return true;
}

export function getInput() {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || (stick.active && stick.x < -THRESHOLD);
  const right = keys.has('KeyD') || keys.has('ArrowRight') || (stick.active && stick.x > THRESHOLD);
  const up = [...JUMP_CODES].some((c) => keys.has(c)) || (stick.active && stick.y < -THRESHOLD);
  return { l: left && !right, r: right && !left, u: up };
}

export function clearInput() {
  keys.clear();
  jumpQueued = false;
  dashQueued = false;
}

export const isTouch = () =>
  window.matchMedia('(hover: none) and (pointer: coarse)').matches;
