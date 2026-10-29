// Shared between server and client so prediction matches the simulation exactly.

// Four times the area of the old arena; the camera decides how much you see.
export const WORLD = { w: 3200, h: 1800 };

export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 30;

export const MAX_PLAYERS = 4;

// Player box (x/y are the centre; the box is w x h)
export const PLAYER = { w: 34, h: 48 };

// Horizontal movement
export const MOVE_SPEED = 360;
export const GROUND_ACCEL = 4200;
export const GROUND_FRICTION = 5400;
export const AIR_ACCEL = 2500;
export const AIR_DRAG = 900;

// Vertical movement — a full jump clears ~220px, a double jump ~390px.
export const GRAVITY = 2150;
export const FALL_GRAVITY = 2450;
export const MAX_FALL = 1600;
export const JUMP_VELOCITY = 980;
export const JUMP_CUT = 0.45;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;
export const AIR_JUMP_VELOCITY = 860;

// Dash
export const DASH_SPEED = 1000;
export const DASH_TIME = 0.14;
export const DASH_COOLDOWN = 2.2;

// Tagging
export const TAG_REACH = 12;
export const TAG_COOLDOWN = 0.85;
export const TAG_KNOCKBACK = 460;

// Map furniture
export const PAD_POWER = 1500;
export const PAD_COOLDOWN = 0.35;
export const PORTAL_COOLDOWN = 1.1;

// Match flow
export const COUNTDOWN = 3;
export const DURATIONS = [60, 120, 180];
export const RESULT_HOLD = 15;

export const COLORS = [
  { id: 'red', name: 'Red', hex: '#e2685f', dark: '#94302c' },
  { id: 'blue', name: 'Blue', hex: '#5f9fe0', dark: '#2a5488' },
  { id: 'yellow', name: 'Yellow', hex: '#e6c25a', dark: '#8f7020' },
  { id: 'green', name: 'Green', hex: '#6fc98a', dark: '#2c6c46' },
];

// Powerups are drawn as natural tokens: a feather, an acorn and a leaf.
export const POWERUPS = {
  speed: { name: 'Speed', color: '#8fb8d8', duration: 8, blurb: 'run 45% faster' },
  shield: { name: 'Shield', color: '#c99a5b', duration: 14, blurb: 'blocks one tag' },
  jump: { name: 'Double jump', color: '#8fc06a', duration: 14, blurb: 'one extra jump' },
};

export const POWERUP_RESPAWN = 9;

export const colorFor = (id) => COLORS.find((c) => c.id === id) || COLORS[0];
