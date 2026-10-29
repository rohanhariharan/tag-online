import * as C from './constants.js';
import { getMap } from './maps.js';
import { bodyBox, boxesOverlap, knock, resetMotion, stepPlayer, touching } from './physics.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let nextPlayerId = 1;

export const rooms = new Map();

export function makeCode() {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return 'X' + Date.now().toString(36).slice(-3).toUpperCase();
}

export function cleanName(raw, fallback = 'Player') {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 14);
  return name || fallback;
}

export class GameRoom {
  constructor(code, { publicRoom = true } = {}) {
    this.code = code;
    this.isPublic = publicRoom;
    this.players = new Map();
    this.hostId = null;
    this.state = 'lobby'; // lobby | playing | ended
    this.mapId = 'meadow';
    this.duration = 120;
    this.timeLeft = this.duration;
    this.countdown = 0;
    this.taggerId = null;
    this.tagCd = 0;
    this.resultT = 0;
    this.result = null;
    this.snapAcc = 0;
    this.events = [];
    this.powerups = [];
    this.lastActivity = Date.now();
    this.resetPowerups();
  }

  get map() {
    return getMap(this.mapId);
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  get joinable() {
    return this.isPublic && this.state === 'lobby' && this.players.size < C.MAX_PLAYERS;
  }

  resetPowerups() {
    this.powerups = this.map.powerups.map((p) => ({
      x: p.x,
      y: p.y,
      type: p.type,
      active: true,
      respawn: 0,
    }));
  }

  freeColor() {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const free = C.COLORS.find((c) => !used.has(c.id));
    return (free || C.COLORS[0]).id;
  }

  addPlayer({ name, bot = false, ws = null, color = null }) {
    const player = {
      id: nextPlayerId++,
      name: bot ? name || `Bot ${this.players.size + 1}` : cleanName(name),
      color: color && ![...this.players.values()].some((p) => p.color === color) ? color : this.freeColor(),
      bot,
      ws,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      input: { l: false, r: false, u: false, jump: false, dash: false },
      onGround: false,
      coyote: 0,
      jumpBuf: 0,
      jumpHeld: false,
      airUsed: false,
      dashT: 0,
      dashCd: 0,
      dashDir: 1,
      padCd: 0,
      portalCd: 0,
      facing: 1,
      speedT: 0,
      jumpT: 0,
      shieldT: 0,
      ai: { wander: 0, wx: 0, wy: 0, jumpCd: 0 },
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    this.placeAtSpawn(player);
    this.lastActivity = Date.now();
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.taggerId === id) {
      const next = [...this.players.values()][0];
      this.taggerId = next ? next.id : null;
    }
    if (this.hostId === id) {
      const nextHuman = [...this.players.values()].find((p) => !p.bot);
      const next = nextHuman || [...this.players.values()][0];
      this.hostId = next ? next.id : null;
    }
    if (this.players.size === 0) {
      rooms.delete(this.code);
      return;
    }
    if (this.state === 'playing' && this.players.size < 2) {
      this.end('abandoned');
    }
    if (this.state === 'lobby' && this.humanCount === 0) {
      rooms.delete(this.code);
      return;
    }
    this.broadcastRoom();
  }

  placeAtSpawn(player) {
    const map = this.map;
    const index = [...this.players.keys()].indexOf(player.id);
    const spot = map.spawns[index % map.spawns.length];
    player.x = spot.x;
    player.y = spot.y;
    resetMotion(player);
    player.input = { l: false, r: false, u: false, jump: false, dash: false };
  }

  setMap(id) {
    if (this.state !== 'lobby') return false;
    const map = getMap(id);
    if (!map) return false;
    this.mapId = map.id;
    this.resetPowerups();
    for (const p of this.players.values()) this.placeAtSpawn(p);
    this.broadcastRoom();
    return true;
  }

  setDuration(seconds) {
    if (this.state !== 'lobby') return false;
    if (!C.DURATIONS.includes(seconds)) return false;
    this.duration = seconds;
    this.timeLeft = seconds;
    this.broadcastRoom();
    return true;
  }

  resetToLobby() {
    this.state = 'lobby';
    this.taggerId = null;
    this.tagCd = 0;
    this.result = null;
    this.resultT = 0;
    this.countdown = 0;
    this.timeLeft = this.duration;
    this.resetPowerups();
    for (const p of this.players.values()) this.placeAtSpawn(p);
    this.broadcastRoom();
  }

  start() {
    if (this.state === 'playing') return false;
    if (this.players.size < 2) return false;
    this.state = 'playing';
    this.countdown = C.COUNTDOWN;
    this.timeLeft = this.duration;
    this.tagCd = 0;
    this.result = null;
    this.resultT = 0;
    this.resetPowerups();

    const list = [...this.players.values()];
    const order = list.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const map = this.map;
    list.forEach((p, i) => {
      const spot = map.spawns[order[i] % map.spawns.length];
      p.x = spot.x;
      p.y = spot.y;
      resetMotion(p);
    });
    this.taggerId = list[Math.floor(Math.random() * list.length)].id;
    this.broadcastRoom();
    this.broadcastState();
    return true;
  }

  end(reason = 'time') {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.resultT = C.RESULT_HOLD;
    this.result = {
      reason,
      loserId: this.taggerId,
      winnerIds: [...this.players.keys()].filter((id) => id !== this.taggerId),
    };
    this.events.push({ k: 'end' });
    this.broadcastRoom();
    this.broadcastState();
  }

  /** Called on every server tick with a fixed dt. */
  tick(dt = 1 / C.TICK_HZ) {
    this.lastActivity = Date.now();

    for (const pw of this.powerups) {
      if (pw.active) continue;
      pw.respawn -= dt;
      if (pw.respawn <= 0) {
        pw.active = true;
        pw.respawn = 0;
        this.events.push({ k: 'spawn', x: pw.x, y: pw.y, type: pw.type });
      }
    }

    if (this.state === 'playing') {
      const frozen = this.countdown > 0;
      if (frozen) {
        this.countdown = Math.max(0, this.countdown - dt);
        if (this.countdown > 0) {
          for (const p of this.players.values()) resetMotion(p);
        }
      } else {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (this.timeLeft <= 0) {
          this.end('time');
          return;
        }
      }

      for (const p of this.players.values()) {
        if (p.bot) this.think(p, dt);
        stepPlayer(p, dt, this.map, frozen || this.state !== 'playing');
        // Jump and dash are edge-triggered: consume them after one step.
        p.input.jump = false;
        p.input.dash = false;
        if (p.hitPad) {
          this.events.push({ k: 'pad', i: p.id, x: p.hitPad.x, y: p.hitPad.y });
          p.hitPad = null;
        }
        if (p.hitPortal) {
          this.events.push({ k: 'portal', i: p.id, x: p.hitPortal.x, y: p.hitPortal.y });
          p.hitPortal = null;
        }
      }

      if (!frozen && this.state === 'playing') {
        this.collectPowerups();
        this.resolveTags(dt);
      }

      this.snapAcc += dt;
      if (this.snapAcc >= 1 / C.SNAPSHOT_HZ) {
        this.snapAcc = 0;
        this.broadcastState();
      }
    } else if (this.state === 'ended') {
      this.snapAcc += dt;
      if (this.snapAcc >= 1 / C.SNAPSHOT_HZ) {
        this.snapAcc = 0;
        this.broadcastState();
      }
      this.resultT = Math.max(0, this.resultT - dt);
      if (this.resultT === 0) this.resetToLobby();
    }
  }

  collectPowerups() {
    for (const pw of this.powerups) {
      if (!pw.active) continue;
      const box = { x: pw.x - 22, y: pw.y - 22, w: 44, h: 44 };
      for (const p of this.players.values()) {
        const b = bodyBox(p);
        if (!boxesOverlap(b.x, b.y, b.w, b.h, box)) continue;
        pw.active = false;
        pw.respawn = C.POWERUP_RESPAWN;
        if (pw.type === 'speed') p.speedT = C.POWERUPS.speed.duration;
        else if (pw.type === 'shield') p.shieldT = C.POWERUPS.shield.duration;
        else if (pw.type === 'jump') p.jumpT = C.POWERUPS.jump.duration;
        this.events.push({ k: 'power', i: p.id, type: pw.type, x: pw.x, y: pw.y });
        break;
      }
    }
  }

  resolveTags(dt = 1 / C.TICK_HZ) {
    if (this.tagCd > 0) {
      this.tagCd = Math.max(0, this.tagCd - dt);
      return;
    }
    const tagger = this.players.get(this.taggerId);
    if (!tagger) return;

    for (const other of this.players.values()) {
      if (other.id === tagger.id) continue;
      if (!touching(tagger, other)) continue;

      const dx = other.x - tagger.x;
      const dy = other.y - tagger.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;

      if (other.shieldT > 0) {
        // Shield eats the tag: nobody changes hands, both get shoved apart.
        other.shieldT = 0;
        knock(other, nx, ny, C.TAG_KNOCKBACK * 0.6);
        knock(tagger, -nx, -ny, C.TAG_KNOCKBACK * 0.8);
        this.tagCd = C.TAG_COOLDOWN;
        this.events.push({ k: 'shield', i: other.id, x: other.x, y: other.y });
        break;
      }

      knock(other, nx, ny, C.TAG_KNOCKBACK);
      knock(tagger, -nx, -ny, C.TAG_KNOCKBACK * 0.6);
      const prev = tagger.id;
      this.taggerId = other.id;
      this.tagCd = C.TAG_COOLDOWN;
      this.events.push({ k: 'tag', from: prev, to: other.id, x: other.x, y: other.y });
      break;
    }
  }

  /** Small platformer AI: chase, flee, hop onto ledges when it makes sense. */
  think(p, dt) {
    const ai = p.ai;
    ai.jumpCd = Math.max(0, ai.jumpCd - dt);
    const tagger = this.players.get(this.taggerId);
    const isTagger = tagger && tagger.id === p.id;

    let dx = 0;
    let dy = 0;
    let wantJump = false;
    let wantDash = false;

    if (isTagger) {
      let best = null;
      let bestD = Infinity;
      for (const o of this.players.values()) {
        if (o.id === p.id) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        dx = best.x - p.x;
        dy = best.y - p.y;
        if (bestD > 160 && bestD < 520 && Math.random() < 0.02) wantDash = true;
      }
    } else if (tagger) {
      dx = p.x - tagger.x;
      dy = p.y - tagger.y;
      const d = Math.hypot(dx, dy) || 1;
      dx = (dx / d) * 120;
      dy = (dy / d) * 120;
      if (d < 220 && Math.random() < 0.03) wantDash = true;
    } else {
      ai.wander = Math.max(0, ai.wander - dt);
      if (ai.wander <= 0) {
        ai.wander = 1.6 + Math.random() * 2;
        ai.wx = Math.random() * 2 - 1;
      }
      dx = ai.wx * 120;
    }

    if (p.onGround && ai.jumpCd <= 0) {
      const wantsHeight = dy < -50;
      const blocked = Math.abs(p.vx) < 40 && Math.abs(dx) > 30;
      const hop = Math.random() < 0.012;
      if (wantsHeight || blocked || hop) wantJump = true;
    }

    const jump = wantJump && ai.jumpCd <= 0;
    if (jump) ai.jumpCd = 0.55;

    p.input = {
      l: dx < -12,
      r: dx > 12,
      u: wantJump || p.vy < -80,
      jump,
      dash: wantDash && p.dashCd <= 0,
    };
  }

  roomInfo() {
    return {
      t: 'room',
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      mapId: this.mapId,
      duration: this.duration,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        bot: p.bot,
      })),
    };
  }

  statePacket() {
    const events = this.events;
    this.events = [];
    return {
      t: 'state',
      state: this.state,
      tagger: this.taggerId,
      tl: Math.round(this.timeLeft * 10) / 10,
      cd: Math.round(this.countdown * 100) / 100,
      result: this.result,
      players: [...this.players.values()].map((p) => ({
        i: p.id,
        n: p.name,
        c: p.color,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        d: Math.round(p.dashCd * 100) / 100,
        f: p.facing,
        g: p.onGround ? 1 : 0,
        sp: Math.round(p.speedT * 10) / 10,
        sh: Math.round(p.shieldT * 10) / 10,
        ju: Math.round(p.jumpT * 10) / 10,
        b: p.bot ? 1 : 0,
      })),
      pw: this.powerups.map((p) => ({ x: p.x, y: p.y, t: p.type, a: p.active ? 1 : 0 })),
      ev: events.length ? events : undefined,
    };
  }

  broadcast(msg) {
    // A browser-local room (offline practice) listens here instead of over ws.
    if (this.onPacket) this.onPacket(msg);
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  broadcastRoom() {
    this.broadcast(this.roomInfo());
  }

  broadcastState() {
    this.broadcast(this.statePacket());
  }
}

/** Find a public lobby with a free seat, or make a fresh one. */
export function quickPlay() {
  let best = null;
  for (const room of rooms.values()) {
    if (!room.joinable) continue;
    if (!best || room.players.size > best.players.size) best = room;
  }
  if (best) return best;
  const code = makeCode();
  const room = new GameRoom(code, { publicRoom: true });
  rooms.set(code, room);
  return room;
}

export function createRoom({ publicRoom = true } = {}) {
  const code = makeCode();
  const room = new GameRoom(code, { publicRoom });
  rooms.set(code, room);
  return room;
}
