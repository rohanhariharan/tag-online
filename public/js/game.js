import * as C from '../shared/constants.js';
import { getMap } from '../shared/maps.js';
import { resetMotion, stepPlayer } from '../shared/physics.js';
import { clearInput, consumeDash, consumeJump, getInput } from './input.js';
import { sfx } from './audio.js';

const SEND_INTERVAL = 1000 / 30;

export class Client {
  constructor(net = null) {
    this.net = net;
    this.myId = null;
    this.name = 'Player';
    this.room = null;
    this.ents = new Map();
    this.powerups = [];
    this.mapId = 'meadow';
    this.state = 'lobby';
    this.timeLeft = 0;
    this.countdown = 0;
    this.taggerId = null;
    this.result = null;
    this.lastSnapAt = 0;
    this.snapDt = 1000 / 30;
    this.jumpToSend = false;
    this.jumpLocal = false;
    this.dashToSend = false;
    this.dashLocal = false;
    this.sendAcc = 0;
    this.live = false;
    this.input = { l: false, r: false, u: false };
    this.effect = null; // (x, y, color, count, speed) => void
  }

  setNet(net) {
    this.net = net;
    this.sendAcc = 0;
  }

  setRoom(info) {
    const mapChanged = info.mapId !== this.mapId;
    this.room = info;
    this.mapId = info.mapId;
    this.state = info.state;
    if (mapChanged) for (const e of this.ents.values()) e.hasPos = false;
    const ids = new Set(info.players.map((p) => p.id));
    for (const id of [...this.ents.keys()]) if (!ids.has(id)) this.ents.delete(id);
    for (const p of info.players) {
      if (!this.ents.has(p.id)) this.ents.set(p.id, this.makeEnt(p));
    }
  }

  makeEnt(p) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: !!p.bot,
      tagger: false,
      s0x: 0,
      s0y: 0,
      s1x: 0,
      s1y: 0,
      snapAt: performance.now(),
      hasPos: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      dashCd: 0,
      facing: 1,
      onGround: false,
      speedT: 0,
      shieldT: 0,
      jumpT: 0,
      // local simulation fields (used for my own player)
      input: { l: false, r: false, u: false, jump: false, dash: false },
      coyote: 0,
      jumpBuf: 0,
      jumpHeld: false,
      airUsed: false,
      dashT: 0,
      dashDir: 1,
      padCd: 0,
      portalCd: 0,
    };
  }

  onState(pkt) {
    const now = performance.now();
    if (this.lastSnapAt) {
      const dt = now - this.lastSnapAt;
      if (dt > 4 && dt < 250) this.snapDt = dt;
    }
    this.lastSnapAt = now;

    if (pkt.state !== this.state) {
      const wasPlaying = this.state === 'playing';
      this.state = pkt.state;
      if (pkt.state === 'playing' && !wasPlaying) {
        for (const e of this.ents.values()) e.hasPos = false;
        if (pkt.cd > 0) sfx.start();
      }
    }
    this.taggerId = pkt.tagger;
    this.timeLeft = pkt.tl;
    this.countdown = pkt.cd;
    this.result = pkt.result;
    this.live = pkt.state === 'playing' && pkt.cd <= 0;
    if (Array.isArray(pkt.pw)) this.powerups = pkt.pw;

    for (const sp of pkt.players) {
      let e = this.ents.get(sp.i);
      if (!e) {
        e = this.makeEnt({ id: sp.i, name: sp.n, color: sp.c, bot: sp.b });
        this.ents.set(sp.i, e);
      }
      e.name = sp.n;
      e.color = sp.c;
      e.isBot = !!sp.b;
      e.tagger = sp.i === this.taggerId;
      e.dashCd = sp.d;
      e.facing = sp.f || 1;
      e.onGround = !!sp.g;
      e.speedT = sp.sp || 0;
      e.shieldT = sp.sh || 0;
      e.jumpT = sp.ju || 0;

      if (!e.hasPos) {
        e.s0x = e.s1x = e.x = sp.x;
        e.s0y = e.s1y = e.y = sp.y;
        e.vx = sp.vx;
        e.vy = sp.vy;
        e.hasPos = true;
        e.snapAt = now;
        if (sp.i === this.myId) resetMotion(e);
        continue;
      }

      if (sp.i === this.myId) {
        // Reconcile local prediction with the authority.
        const err = Math.hypot(sp.x - e.x, sp.y - e.y);
        if (err > 120) {
          e.x = sp.x;
          e.y = sp.y;
          e.vx = sp.vx;
          e.vy = sp.vy;
        } else {
          e.x += (sp.x - e.x) * 0.2;
          e.y += (sp.y - e.y) * 0.2;
        }
        e.s1x = sp.x;
        e.s1y = sp.y;
      } else {
        e.s0x = e.s1x;
        e.s0y = e.s1y;
        e.s1x = sp.x;
        e.s1y = sp.y;
        e.vx = sp.vx;
        e.vy = sp.vy;
      }
      e.snapAt = now;
    }

    if (pkt.ev) {
      for (const ev of pkt.ev) {
        if (ev.k === 'tag') {
          this.fx(ev.x, ev.y, '#e2685f', 20, 340);
          sfx.tag();
        } else if (ev.k === 'shield') {
          this.fx(ev.x, ev.y, C.POWERUPS.shield.color, 22, 360);
          sfx.shield();
        } else if (ev.k === 'pad') {
          this.fx(ev.x, ev.y, '#8fc06a', 14, 260);
          sfx.pad();
        } else if (ev.k === 'portal') {
          this.fx(ev.x, ev.y, '#cfe0c3', 18, 300);
          sfx.portal();
        } else if (ev.k === 'power') {
          this.fx(ev.x, ev.y, C.POWERUPS[ev.type]?.color || '#ffffff', 24, 320);
          sfx.power();
        } else if (ev.k === 'spawn') {
          this.fx(ev.x, ev.y, C.POWERUPS[ev.type]?.color || '#ffffff', 8, 140);
        } else if (ev.k === 'end') {
          sfx.end();
        }
      }
    }
  }

  fx(x, y, color, count, speed) {
    if (this.effect) this.effect(x, y, color, count, speed);
  }

  /** One simulation + interpolation step. Called from the Phaser scene. */
  update(dt) {
    // A local (offline) room advances here; a socket room is driven by the server.
    if (this.net && typeof this.net.tick === 'function') this.net.tick(dt);

    const now = performance.now();
    const me = this.myId ? this.ents.get(this.myId) : null;
    const map = getMap(this.mapId);
    const frozen = this.state !== 'playing' || this.countdown > 0;

    if (this.live) this.timeLeft = Math.max(0, this.timeLeft - dt);

    if (me && this.state === 'playing') {
      const inp = frozen ? { l: false, r: false, u: false } : getInput();
      this.input = inp;
      if (!frozen) {
        if (consumeJump()) {
          this.jumpLocal = true;
          this.jumpToSend = true;
        }
        if (consumeDash() && me.dashCd <= 0) {
          this.dashLocal = true;
          this.dashToSend = true;
          sfx.dash();
        }
      }
      me.input.l = inp.l;
      me.input.r = inp.r;
      me.input.u = inp.u;
      me.input.jump = this.jumpLocal;
      me.input.dash = this.dashLocal;
      stepPlayer(me, dt, map, frozen);
      this.jumpLocal = false;
      this.dashLocal = false;
    } else if (frozen) {
      clearInput();
      this.input = { l: false, r: false, u: false };
    }

    for (const e of this.ents.values()) {
      if (e.id === this.myId) continue;
      if (!e.hasPos) continue;
      const alpha = Math.min(1.35, (now - e.snapAt) / this.snapDt);
      if (alpha <= 1) {
        e.x = e.s0x + (e.s1x - e.s0x) * alpha;
        e.y = e.s0y + (e.s1y - e.s0y) * alpha;
      } else {
        const over = Math.min(0.12, alpha - 1);
        e.x = e.s1x + e.vx * over * 0.5;
        e.y = e.s1y + e.vy * over * 0.5;
      }
    }

    this.sendAcc += dt * 1000;
    if (this.sendAcc >= SEND_INTERVAL && this.state === 'playing' && this.net) {
      this.sendAcc = 0;
      this.net.send({
        t: 'input',
        l: this.input.l,
        r: this.input.r,
        u: this.input.u,
        jump: this.jumpToSend,
        dash: this.dashToSend,
      });
      this.jumpToSend = false;
      this.dashToSend = false;
    }
  }

  /** The draw model the Phaser scene consumes. */
  view() {
    const players = [];
    for (const e of this.ents.values()) {
      players.push({
        id: e.id,
        name: e.name,
        color: e.color,
        x: e.x,
        y: e.y,
        vx: e.vx,
        vy: e.vy,
        dashCd: e.dashCd,
        facing: e.facing,
        onGround: e.onGround,
        speedT: e.speedT,
        shieldT: e.shieldT,
        jumpT: e.jumpT,
        tagger: e.id === this.taggerId,
        isMe: e.id === this.myId,
        isBot: e.isBot,
      });
    }
    return {
      mapId: this.mapId,
      players,
      powerups: this.powerups,
      state: this.state,
      countdown: this.countdown,
    };
  }
}
