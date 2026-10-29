import { DASH_COOLDOWN, PLAYER, POWERUPS, WORLD, colorFor } from '../shared/constants.js';
import { getMap } from '../shared/maps.js';

const PLAYER_TEXTURE = 'tag-player';
const SHADOW_TEXTURE = 'tag-shadow';
const SPARK_TEXTURE = 'tag-spark';

// The scene is created by Phaser before our game screen exists; hand it the
// client through a module-level slot instead of depending on boot order.
let sharedClient = null;
export function attachClient(client) {
  sharedClient = client;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Phaser owns the canvas, camera and effects. It does not own the game rules —
 * the authoritative server does, and `client.view()` hands us the world state
 * to draw. That keeps four browsers on four networks in agreement.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
    this.client = null;
    this.mapId = null;
    this.mapImage = null;
    this.mapKey = null;
    this.actors = new Map();
    this.shadows = new Map();
    this.emitters = new Map();
    this.zoom = 1;
    this.hasZoom = false;
    this.t = 0;
  }

  create() {
    buildTextures(this);
    this.cameras.main.setBackgroundColor('#0b0f0d');

    this.dynLayer = this.add.graphics().setDepth(-10);

    this.client = sharedClient;
    if (this.client) {
      this.client.effect = (x, y, color, count, speed) => this.burst(x, y, color, count, speed);
    }

    this.scale.on('resize', (size) => {
      this.cameras.resize(size.width, size.height);
    });
  }

  attach(client) {
    this.client = client;
    this.client.effect = (x, y, color, count, speed) => this.burst(x, y, color, count, speed);
  }

  update(_time, deltaMs) {
    const dt = Math.min(0.05, deltaMs / 1000);
    this.t += dt;
    if (this.client) this.client.update(dt);
    const view = this.client ? this.client.view() : null;
    if (view) this.render(view, dt);
  }

  // -------------------------------------------------------------- rendering

  render(view, dt) {
    if (view.mapId !== this.mapId) this.buildMap(view.mapId);
    const map = getMap(view.mapId);

    this.updateCamera(view, dt);

    this.dynLayer.clear();
    for (const pad of map.pads) this.drawPad(pad, map.theme);
    for (const portal of map.portals) {
      this.drawPortal(portal.ax, portal.ay, portal.r, map.theme.glow, 0);
      this.drawPortal(portal.bx, portal.by, portal.r, map.theme.glow, 0.7);
    }
    for (const pw of view.powerups) this.drawPowerup(pw);

    const seen = new Set();
    for (const p of view.players) {
      seen.add(p.id);
      this.syncActor(p, view);
    }
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) {
        this.actors.get(id).container.destroy();
        this.actors.delete(id);
        this.shadows.get(id)?.destroy();
        this.shadows.delete(id);
      }
    }
  }

  /**
   * Adaptive camera: the zoom widens as the tagger gets further away, and the
   * frame leans toward whoever is holding the tag. Without this a 3200x1800
   * world either shows ants or hides the chase.
   */
  updateCamera(view, dt) {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    if (w < 2 || h < 2) return; // game screen is hidden

    const me = view.players.find((p) => p.isMe) || view.players[0];
    const tagger = view.players.find((p) => p.tagger);
    const anchorX = me ? me.x : WORLD.w / 2;
    const anchorY = me ? me.y : WORLD.h / 2;

    let gap = 0;
    if (me && tagger && tagger.id !== me.id) {
      gap = Math.hypot(tagger.x - me.x, tagger.y - me.y);
    }

    // Show more of the map when the chase spans more of it.
    const visibleW = clamp(1000 + gap * 0.75, 1000, 1900);
    const coverZoom = Math.max(w / WORLD.w, h / WORLD.h);
    let target = clamp(w / visibleW, coverZoom, 1.15);

    if (!this.hasZoom) {
      this.zoom = target;
      this.hasZoom = true;
    } else {
      const k = Math.min(1, dt * 4.5);
      this.zoom += (target - this.zoom) * k;
    }

    let camX = anchorX;
    let camY = anchorY;
    if (me && tagger && tagger.id !== me.id && gap < 1500) {
      camX = me.x * 0.72 + tagger.x * 0.28;
      camY = me.y * 0.8 + tagger.y * 0.2;
    }

    const halfW = w / (2 * this.zoom);
    const halfH = h / (2 * this.zoom);
    // No slack: showing blank space past the world edge looks worse than a
    // player occasionally sitting near the frame edge.
    camX = halfW * 2 >= WORLD.w ? WORLD.w / 2 : clamp(camX, halfW, WORLD.w - halfW);
    camY = halfH * 2 >= WORLD.h ? WORLD.h / 2 : clamp(camY, halfH, WORLD.h - halfH);

    cam.setZoom(this.zoom);
    cam.centerOn(camX, camY);
  }

  buildMap(mapId) {
    this.mapId = mapId;
    const map = getMap(mapId);
    const key = `tag-map-${mapId}`;

    if (this.mapKey && this.textures.exists(this.mapKey)) this.textures.remove(this.mapKey);
    if (this.mapImage) {
      this.mapImage.destroy();
      this.mapImage = null;
    }

    const g = this.make.graphics({ x: 0, y: 0, add: false });
    drawWorld(g, map);
    g.generateTexture(key, WORLD.w, WORLD.h);
    g.destroy();

    this.mapKey = key;
    this.mapImage = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-30);
    this.cameras.main.setBackgroundColor(map.theme.skyLow);
  }

  drawPad(pad, th) {
    const g = this.dynLayer;
    const compress = 0.78 + 0.22 * Math.abs(Math.sin(this.t * 2));
    const cx = pad.x + pad.w / 2;
    const capY = pad.y + pad.h - 9 * compress;

    // springy branch: two posts, a coil and a cap
    g.lineStyle(4, hexNum(th.wood), 1);
    g.lineBetween(pad.x + 16, pad.y + pad.h, pad.x + 16, capY + 6);
    g.lineBetween(pad.x + pad.w - 16, pad.y + pad.h, pad.x + pad.w - 16, capY + 6);

    g.lineStyle(3, hexNum(th.leaf), 0.9);
    for (let i = 0; i < 3; i++) {
      const y = capY + 6 + i * 7;
      g.lineBetween(pad.x + 16, y, pad.x + pad.w - 16, y + 4);
    }

    g.fillStyle(hexNum(th.woodLight), 1);
    g.fillRoundedRect(pad.x, capY, pad.w, 9 * compress, 4);
    g.fillStyle(hexNum(th.grassLight), 0.9);
    g.fillRoundedRect(pad.x, capY, pad.w, 4, 3);

    g.lineStyle(3, hexNum(th.leaf), 0.75);
    g.lineBetween(cx, capY - 10, cx, capY - 30);
    g.lineBetween(cx - 7, capY - 22, cx, capY - 30);
    g.lineBetween(cx + 7, capY - 22, cx, capY - 30);
  }

  drawPortal(x, y, r, glow, phase) {
    const g = this.dynLayer;
    const col = hexNum(glow);
    const pulse = 0.7 + 0.3 * Math.sin(this.t * 2.2 + phase);
    g.fillStyle(col, 0.16 * pulse);
    g.fillCircle(x, y, r * 0.92);
    g.lineStyle(2.5, col, 0.7);
    g.strokeCircle(x, y, r * 0.72);
    g.lineStyle(1.5, col, 0.45);
    g.strokeCircle(x, y, r * 0.5);

    // drifting motes
    for (let i = 0; i < 3; i++) {
      const a = this.t * 0.9 + phase + (i * Math.PI * 2) / 3;
      const rr = r * (0.55 + 0.2 * Math.sin(this.t + i));
      g.fillStyle(col, 0.5);
      g.fillCircle(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 2.6);
    }
  }

  drawPowerup(pw) {
    const def = POWERUPS[pw.t] || POWERUPS.speed;
    const g = this.dynLayer;
    const col = hexNum(def.color);
    const bob = Math.sin(this.t * 2.2 + pw.x * 0.01) * 6;
    const y = pw.y + bob;

    if (!pw.a) {
      g.lineStyle(1.5, col, 0.22);
      g.strokeCircle(pw.x, pw.y, 15);
      return;
    }

    // soft token with a cream face
    g.fillStyle(col, 0.22);
    g.fillCircle(pw.x, y, 23);
    g.fillStyle(0xf3ead6, 0.92);
    g.fillCircle(pw.x, y, 16);
    g.lineStyle(2.5, col, 0.95);
    g.strokeCircle(pw.x, y, 23);

    if (pw.t === 'speed') {
      // feather
      g.fillStyle(col, 0.95);
      g.fillEllipse(pw.x, y - 2, 14, 22);
      g.lineStyle(1.6, 0x6d7a63, 0.8);
      g.lineBetween(pw.x, y - 11, pw.x, y + 9);
    } else if (pw.t === 'shield') {
      // acorn
      g.fillStyle(col, 1);
      g.fillEllipse(pw.x, y + 2, 16, 18);
      g.fillStyle(0x8a5f3c, 1);
      g.fillEllipse(pw.x, y - 6, 20, 11);
      g.lineStyle(1.6, 0x8a5f3c, 1);
      g.lineBetween(pw.x, y - 11, pw.x, y - 14);
    } else {
      // leaf
      g.fillStyle(col, 1);
      g.fillEllipse(pw.x, y, 22, 13);
      g.lineStyle(1.6, 0x5f7a4a, 0.9);
      g.lineBetween(pw.x - 9, y, pw.x + 11, y);
    }
  }

  syncActor(p, view) {
    let actor = this.actors.get(p.id);
    if (!actor) {
      actor = this.createActor(p);
      this.actors.set(p.id, actor);
    }
    const { container, aura, body, eyes, shield, label, badge } = actor;

    container.setPosition(p.x, p.y);
    container.setDepth(10 + p.y * 0.01);

    const airStretch = p.onGround ? 0 : Math.min(0.16, Math.abs(p.vy || 0) / 5200);
    container.setScale(1 - airStretch * 0.6, 1 + airStretch);

    const dir = p.facing || 1;
    eyes.left.x = -5 + dir * 4;
    eyes.right.x = 5 + dir * 4;

    aura.setVisible(!!p.tagger);
    shield.setVisible(p.shieldT > 0);
    badge.setVisible(!!p.tagger);

    label.setText(p.isMe ? 'you' : p.name);
    label.setColor(p.isMe ? '#ffffff' : '#dbe4d6');

    let shadow = this.shadows.get(p.id);
    if (!shadow) {
      shadow = this.add.image(0, 0, SHADOW_TEXTURE).setDepth(5).setAlpha(0.28);
      this.shadows.set(p.id, shadow);
    }
    const groundY = groundBelow(getMap(view.mapId), p.x, p.y + PLAYER.h / 2);
    if (groundY == null) {
      shadow.setVisible(false);
    } else {
      const dist = Math.max(0, groundY - (p.y + PLAYER.h / 2));
      const alpha = Math.max(0, 0.3 - dist / 800);
      shadow.setVisible(alpha > 0.02);
      shadow.setAlpha(alpha);
      shadow.setPosition(p.x, groundY - 3);
      shadow.setScale(1 - Math.min(0.4, dist / 1000));
    }
  }

  createActor(p) {
    const c = colorFor(p.color);
    const tint = hexNum(c.hex);
    const w = PLAYER.w;
    const h = PLAYER.h;

    const container = this.add.container(0, 0).setDepth(10);

    const aura = this.add.graphics();
    aura.lineStyle(4, 0xff6f5e, 0.35);
    aura.strokeRoundedRect(-w / 2 - 9, -h / 2 - 9, w + 18, h + 18, 16);
    aura.fillStyle(0xff6f5e, 0.1);
    aura.fillRoundedRect(-w / 2 - 9, -h / 2 - 9, w + 18, h + 18, 16);

    const body = this.add.image(0, 0, PLAYER_TEXTURE).setTint(tint);

    const eyes = {
      left: this.add.circle(-5, -6, 3.4, 0x241f1a),
      right: this.add.circle(5, -6, 3.4, 0x241f1a),
    };

    const shield = this.add.graphics();
    shield.lineStyle(2.5, hexNum(POWERUPS.shield.color), 0.85);
    shield.strokeEllipse(0, 0, w * 1.9, h * 1.56);
    shield.fillStyle(hexNum(POWERUPS.shield.color), 0.12);
    shield.fillEllipse(0, 0, w * 1.9, h * 1.56);

    const label = this.add
      .text(0, -h / 2 - 12, '', {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '15px',
        color: '#dbe4d6',
        stroke: '#1a221c',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    const badge = this.add
      .text(0, -h / 2 - 30, 'IT', {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ff8a7a',
        stroke: '#2a1714',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    container.add([aura, body, eyes.left, eyes.right, shield, label, badge]);

    return { container, aura, body, eyes, shield, label, badge };
  }

  // ------------------------------------------------------------------ effects

  burst(x, y, color, count = 12, speed = 280) {
    let emitter = this.emitters.get(color);
    if (!emitter) {
      emitter = this.add
        .particles(0, 0, SPARK_TEXTURE, {
          speed: { min: speed * 0.25, max: speed },
          angle: { min: 0, max: 360 },
          lifespan: { min: 300, max: 800 },
          scale: { start: 0.9, end: 0 },
          alpha: { start: 1, end: 0 },
          gravityY: 320,
          tint: hexNum(color),
          emitting: false,
          maxAliveParticles: 140,
        })
        .setDepth(30);
      this.emitters.set(color, emitter);
    }
    emitter.setParticleSpeed(speed * 0.25, speed);
    emitter.explode(count, x, y);
  }
}

// ----------------------------------------------------------------- world art

function drawWorld(g, map) {
  const th = map.theme;
  drawSky(g, th);
  drawHills(g, th);
  for (const d of map.decor || []) drawDecor(g, d, th, map);
  drawGround(g, map, th);
  for (const w of map.walls) drawSolid(g, w, th);
  for (const plat of map.platforms) drawPlatform(g, plat, th);
}

function drawSky(g, th) {
  // fillGradientStyle is WebGL-only, and generateTexture bakes through the
  // canvas renderer, so build the gradient out of bands instead.
  fillGradient(g, 0, 0, WORLD.w, WORLD.h, hexNum(th.skyTop), hexNum(th.skyLow), 72);

  // low sun + haze
  const sunX = WORLD.w * 0.74;
  const sunY = WORLD.h * 0.28;
  g.fillStyle(hexNum(th.haze), 0.22);
  g.fillCircle(sunX, sunY, 320);
  g.fillStyle(hexNum(th.haze), 0.5);
  g.fillCircle(sunX, sunY, 130);
  g.fillStyle(0xfff6e2, 0.85);
  g.fillCircle(sunX, sunY, 74);

  // soft cloud bands
  for (let i = 0; i < 5; i++) {
    const cx = (i * 690 + 200) % WORLD.w;
    const cy = 260 + ((i * 137) % 420);
    g.fillStyle(0xffffff, 0.07);
    g.fillEllipse(cx, cy, 420, 90);
    g.fillEllipse(cx + 120, cy + 18, 300, 64);
  }
}

function fillGradient(g, x, y, w, h, top, bottom, steps) {
  const tr = (top >> 16) & 255;
  const tg = (top >> 8) & 255;
  const tb = top & 255;
  const br = (bottom >> 16) & 255;
  const bgc = (bottom >> 8) & 255;
  const bb = bottom & 255;
  const bandH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const r = Math.round(tr + (br - tr) * t);
    const gg = Math.round(tg + (bgc - tg) * t);
    const b = Math.round(tb + (bb - tb) * t);
    g.fillStyle((r << 16) | (gg << 8) | b, 1);
    g.fillRect(x, y + i * bandH, w, bandH + 1);
  }
}

function drawHills(g, th) {
  const base = 1740;
  const far = hexNum(th.hillFar);
  const near = hexNum(th.hillNear);

  g.fillStyle(far, 0.55);
  for (let i = 0; i < 7; i++) {
    const cx = i * 520 - 120;
    g.fillEllipse(cx, base - 40, 620, 340);
  }
  g.fillRect(0, base - 230, WORLD.w, 240);

  g.fillStyle(near, 0.7);
  for (let i = 0; i < 6; i++) {
    const cx = i * 620 + 180;
    g.fillEllipse(cx, base - 20, 720, 300);
  }
  g.fillRect(0, base - 140, WORLD.w, 150);
}

function drawGround(g, map, th) {
  const floor = map.walls.find((w) => w.kind === 'ground');
  if (!floor) return;
  const top = floor.y;

  g.fillStyle(hexNum(th.ground), 1);
  g.fillRect(0, top, WORLD.w, WORLD.h - top);
  g.fillStyle(hexNum(th.groundDark), 1);
  g.fillRect(0, top + 40, WORLD.w, WORLD.h - top - 40);

  // grass band
  g.fillStyle(hexNum(th.grass), 1);
  g.fillRect(0, top, WORLD.w, 18);
  g.fillStyle(hexNum(th.grassLight), 1);
  g.fillRect(0, top, WORLD.w, 6);

  // pebbles + tufts
  for (let i = 0; i < 90; i++) {
    const x = (i * 173) % WORLD.w;
    const y = top + 34 + ((i * 53) % 40);
    g.fillStyle(hexNum(th.groundDark), 0.55);
    g.fillCircle(x, y, 2 + ((i * 7) % 4));
  }
  for (let i = 0; i < 46; i++) {
    const x = (i * 211 + 60) % WORLD.w;
    g.lineStyle(2, hexNum(th.grassLight), 0.7);
    g.lineBetween(x, top, x - 4, top - 12 - ((i * 5) % 8));
    g.lineBetween(x, top, x + 5, top - 9 - ((i * 3) % 7));
  }
}

function drawSolid(g, w, th) {
  if (w.kind === 'edge') {
    g.fillStyle(hexNum(th.groundDark), 1);
    g.fillRect(w.x, w.y, w.w, w.h);
    return;
  }
  if (w.kind === 'ground') return; // drawn by drawGround

  if (w.kind === 'mesa' || w.kind === 'boulder') {
    const base = w.kind === 'mesa' ? hexNum(th.rock) : hexNum(th.rock);
    g.fillStyle(base, 1);
    g.fillRoundedRect(w.x, w.y, w.w, w.h, 14);
    g.fillStyle(0xffffff, 0.06);
    g.fillRoundedRect(w.x + 6, w.y + 6, w.w - 12, 26, 10);
    g.lineStyle(2, 0x000000, 0.16);
    g.strokeRoundedRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1, 14);
    // strata
    g.lineStyle(2, 0x000000, 0.1);
    for (let y = w.y + 42; y < w.y + w.h - 10; y += 44) {
      g.lineBetween(w.x + 8, y, w.x + w.w - 8, y);
    }
    return;
  }

  g.fillStyle(hexNum(th.rock), 1);
  g.fillRect(w.x, w.y, w.w, w.h);
  g.lineStyle(2, 0x000000, 0.15);
  g.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
}

function drawPlatform(g, plat, th) {
  const h = 22;
  const y = plat.y;

  // shadow underneath
  g.fillStyle(0x000000, 0.12);
  g.fillRoundedRect(plat.x + 3, y + h - 2, plat.w, 8, 6);

  // log body
  g.fillStyle(hexNum(th.wood), 1);
  g.fillRoundedRect(plat.x, y, plat.w, h, 9);
  g.fillStyle(hexNum(th.woodLight), 1);
  g.fillRoundedRect(plat.x, y, plat.w, 8, 6);

  // grass / moss cap
  g.fillStyle(hexNum(th.grass), 1);
  g.fillRoundedRect(plat.x + 2, y - 3, plat.w - 4, 7, 4);
  g.fillStyle(hexNum(th.grassLight), 0.9);
  g.fillRoundedRect(plat.x + 4, y - 3, plat.w - 8, 3, 2);

  // grain + end caps
  g.lineStyle(1.5, 0x000000, 0.12);
  g.lineBetween(plat.x + 12, y + 14, plat.x + plat.w - 12, y + 14);
  g.fillStyle(0x000000, 0.12);
  g.fillCircle(plat.x + 7, y + 13, 3);
  g.fillCircle(plat.x + plat.w - 7, y + 13, 3);
}

function drawDecor(g, d, th, map) {
  const s = d.s || 1;
  const leaf = hexNum(th.leaf);
  const leafLight = hexNum(th.leafLight);

  if (d.type === 'tree') {
    const trunkW = 20 * s;
    const trunkH = 190 * s;
    g.fillStyle(hexNum(th.wood), 1);
    g.fillRect(d.x - trunkW / 2, d.y - trunkH, trunkW, trunkH);
    g.fillStyle(0x000000, 0.12);
    g.fillRect(d.x - trunkW / 2, d.y - trunkH, trunkW * 0.35, trunkH);

    const cy = d.y - trunkH - 26 * s;
    g.fillStyle(leaf, 0.95);
    g.fillCircle(d.x - 46 * s, cy + 18 * s, 54 * s);
    g.fillCircle(d.x + 44 * s, cy + 22 * s, 50 * s);
    g.fillCircle(d.x, cy - 26 * s, 62 * s);
    g.fillStyle(leafLight, 0.85);
    g.fillCircle(d.x - 18 * s, cy - 30 * s, 38 * s);
    g.fillCircle(d.x + 26 * s, cy + 4 * s, 30 * s);
    return;
  }

  if (d.type === 'bush') {
    g.fillStyle(leaf, 0.95);
    g.fillCircle(d.x - 26 * s, d.y - 16 * s, 26 * s);
    g.fillCircle(d.x + 24 * s, d.y - 14 * s, 24 * s);
    g.fillCircle(d.x, d.y - 30 * s, 30 * s);
    g.fillStyle(leafLight, 0.8);
    g.fillCircle(d.x - 6 * s, d.y - 36 * s, 16 * s);
    return;
  }

  if (d.type === 'rock') {
    g.fillStyle(hexNum(th.rock), 1);
    g.fillRoundedRect(d.x - 34 * s, d.y - 26 * s, 68 * s, 26 * s, 10);
    g.fillStyle(0xffffff, 0.08);
    g.fillRoundedRect(d.x - 28 * s, d.y - 24 * s, 56 * s, 8 * s, 6);
    return;
  }

  if (d.type === 'grass') {
    for (let i = 0; i < 5; i++) {
      const x = d.x + (i - 2) * 7 * s;
      g.lineStyle(2, hexNum(th.grassLight), 0.85);
      g.lineBetween(x, d.y, x - 3 * s, d.y - (16 + (i % 3) * 7) * s);
    }
    return;
  }

  if (d.type === 'cactus') {
    g.fillStyle(hexNum(th.leaf), 1);
    g.fillRoundedRect(d.x - 9 * s, d.y - 92 * s, 18 * s, 92 * s, 9 * s);
    g.fillRoundedRect(d.x - 30 * s, d.y - 62 * s, 16 * s, 34 * s, 8 * s);
    g.fillRoundedRect(d.x + 14 * s, d.y - 74 * s, 16 * s, 40 * s, 8 * s);
    g.lineStyle(2, 0x000000, 0.12);
    g.lineBetween(d.x, d.y - 86 * s, d.x, d.y - 12 * s);
    return;
  }

  if (d.type === 'fern') {
    g.lineStyle(3, hexNum(th.leafLight), 0.9);
    for (let i = -2; i <= 2; i++) {
      g.lineBetween(d.x, d.y, d.x + i * 18 * s, d.y - (34 - Math.abs(i) * 6) * s);
    }
    return;
  }

  if (d.type === 'mushroom') {
    g.fillStyle(0xece0cc, 1);
    g.fillRect(d.x - 5 * s, d.y - 22 * s, 10 * s, 22 * s);
    g.fillStyle(0xb4543f, 1);
    g.fillEllipse(d.x, d.y - 24 * s, 40 * s, 20 * s);
    g.fillStyle(0xf2e6d2, 0.9);
    g.fillCircle(d.x - 8 * s, d.y - 28 * s, 3 * s);
    g.fillCircle(d.x + 7 * s, d.y - 26 * s, 2.5 * s);
    return;
  }

  if (d.type === 'mesa') {
    g.fillStyle(hexNum(th.rock), 0.55);
    g.fillRoundedRect(d.x - 90 * s, d.y - 150 * s, 180 * s, 150 * s, 18);
    return;
  }
}

// -------------------------------------------------------------------- helpers

function buildTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  g.fillStyle(0xcfcfcf, 1);
  g.fillRoundedRect(0, 0, PLAYER.w, PLAYER.h, 11);
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(2, 1, PLAYER.w - 4, 15, 9);
  g.generateTexture(PLAYER_TEXTURE, PLAYER.w, PLAYER.h);
  g.clear();

  g.fillStyle(0x000000, 1);
  g.fillEllipse(24, 9, 44, 16);
  g.generateTexture(SHADOW_TEXTURE, 48, 18);
  g.clear();

  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture(SPARK_TEXTURE, 8, 8);
  g.destroy();
}

function groundBelow(map, x, fromY) {
  let best = null;
  for (const w of map.walls) {
    if (x > w.x - 8 && x < w.x + w.w + 8 && w.y >= fromY - 2 && (best == null || w.y < best)) best = w.y;
  }
  for (const plat of map.platforms) {
    if (x > plat.x && x < plat.x + plat.w && plat.y >= fromY - 2 && (best == null || plat.y < best)) best = plat.y;
  }
  return best;
}

function hexNum(hex) {
  return parseInt(String(hex).replace('#', ''), 16);
}
