// Offline practice: runs the same authoritative room code the server uses,
// but inside the page. This is what makes the static GitHub Pages build
// playable without a server (you versus bots).
import { cleanName, GameRoom } from '../shared/rooms.js';

export class LocalNet {
  constructor() {
    this.handlers = new Map();
    this.room = null;
    this.me = null;
    this.name = 'Player';
    this.offline = true;
  }

  connect() {
    /* nothing to dial */
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  send(msg) {
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'hello': {
        this.name = cleanName(msg.name, this.name);
        this.emit('welcome', { id: this.me ? this.me.id : null, name: this.name });
        break;
      }

      case 'quick':
      case 'create': {
        if (!this.room) this.openRoom(msg.name);
        this.addBot();
        this.addBot();
        break;
      }

      case 'join': {
        this.emit('error', {
          msg: 'Room codes need a running server. This build is offline practice.',
        });
        break;
      }

      case 'map':
        if (this.room) this.room.setMap(String(msg.mapId));
        break;

      case 'duration':
        if (this.room) this.room.setDuration(Number(msg.value));
        break;

      case 'bot': {
        if (!this.room) break;
        if (msg.add) this.addBot();
        else {
          const bots = [...this.room.players.values()].filter((p) => p.bot);
          if (bots.length) this.room.removePlayer(bots[bots.length - 1].id);
        }
        break;
      }

      case 'start':
      case 'rematch':
        if (this.room) this.room.start();
        break;

      case 'lobby':
        if (this.room) this.room.resetToLobby();
        break;

      case 'leave': {
        this.room = null;
        this.me = null;
        this.emit('left', {});
        break;
      }

      case 'input': {
        const p = this.me;
        if (!p || p.bot) break;
        p.input.l = !!msg.l;
        p.input.r = !!msg.r;
        p.input.u = !!msg.u;
        if (msg.jump) p.input.jump = true;
        if (msg.dash) p.input.dash = true;
        break;
      }

      default:
        break;
    }
  }

  openRoom(name) {
    const room = new GameRoom('BOTS', { publicRoom: false });
    room.onPacket = (m) => {
      this.emit(m.t, m);
      this.emit('message', m);
    };
    this.room = room;
    this.me = room.addPlayer({ name: cleanName(name), ws: null });
    this.emit('welcome', { id: this.me.id, name: this.me.name });
    room.broadcastRoom();
  }

  addBot() {
    if (!this.room) return;
    if (this.room.players.size >= 4) return;
    const bots = [...this.room.players.values()].filter((p) => p.bot).length;
    this.room.addPlayer({ bot: true, name: `Bot ${bots + 1}` });
    this.room.broadcastRoom();
  }

  tick(dt) {
    if (this.room) this.room.tick(dt);
  }
}
