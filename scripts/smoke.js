// Headless smoke test: two clients, one bot, a round of platformer tag.
// Usage: node scripts/smoke.js [url]
import WebSocket from 'ws';
import { WORLD } from '../shared/constants.js';

const URL = process.argv[2] || 'ws://localhost:3000/ws';
const log = (...a) => console.log(...a);

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const client = { ws, name, state: null, room: null, id: null, states: 0 };
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', name }));
      resolve(client);
    });
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.t === 'welcome') client.id = msg.id ?? client.id;
      if (msg.t === 'room') client.room = msg;
      if (msg.t === 'state') {
        client.state = msg;
        client.states++;
      }
      if (msg.t === 'error') log(`[${name}] error: ${msg.msg}`);
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await connect('Alice');
const b = await connect('Bob');

a.ws.send(JSON.stringify({ t: 'create', name: 'Alice' }));
await wait(150);
log('room code:', a.room?.code, 'players:', a.room?.players.length);

b.ws.send(JSON.stringify({ t: 'join', name: 'Bob', code: a.room.code }));
await wait(150);
log('after join:', a.room?.players.map((p) => p.name).join(', '));

a.ws.send(JSON.stringify({ t: 'map', mapId: 'backyard' }));
a.ws.send(JSON.stringify({ t: 'duration', value: 60 }));
a.ws.send(JSON.stringify({ t: 'bot', add: true }));
await wait(120);
log('map:', a.room?.mapId, 'duration:', a.room?.duration, 'players:', a.room?.players.length);

a.ws.send(JSON.stringify({ t: 'start' }));
await wait(200);
log('state after start:', a.state?.state, 'countdown:', a.state?.cd);

await wait(3300); // countdown

const startY = new Map();
const lastX = new Map();
const stuckFor = new Map();
let tagChanges = 0;
let lastTagger = a.state.tagger;
let sawAirborne = false;
let minY = Infinity;
let maxY = -Infinity;

for (let i = 0; i < 240; i++) {
  for (const c of [a, b]) {
    const me = c.state?.players.find((p) => p.i === c.id);
    if (!me) continue;
    if (!startY.has(c.id)) startY.set(c.id, me.y);
    const tagger = c.state.players.find((p) => p.i === c.state.tagger);
    const target = tagger && tagger.i !== c.id ? tagger : c.state.players.find((p) => p.i !== c.id);
    const dx = (target?.x ?? 800) - me.x;

    // Jump when stuck against something, otherwise hop on a rhythm.
    const prevX = lastX.get(c.id);
    const stuck = prevX != null && Math.abs(prevX - me.x) < 2 ? (stuckFor.get(c.id) || 0) + 1 : 0;
    stuckFor.set(c.id, stuck);
    lastX.set(c.id, me.x);
    const jumpNow = i % 18 === 0 || stuck > 2;
    const hop = i % 18 < 6 || jumpNow;

    c.ws.send(
      JSON.stringify({
        t: 'input',
        l: dx < -12,
        r: dx > 12,
        u: hop,
        jump: jumpNow,
      })
    );
  }
  const me = a.state.players.find((p) => p.i === a.id);
  if (me) {
    minY = Math.min(minY, me.y);
    maxY = Math.max(maxY, me.y);
    if (!me.g) sawAirborne = true;
  }
  if (a.state.tagger !== lastTagger) {
    tagChanges++;
    lastTagger = a.state.tagger;
  }
  await wait(33);
}

const meA = a.state.players.find((p) => p.i === a.id);
log('states received:', a.states, b.states);
log('y range:', Math.round(minY), '->', Math.round(maxY), '| airborne seen:', sawAirborne);
log('time left:', a.state.tl, '| tag transfers:', tagChanges);
log(
  'in bounds:',
  a.state.players.every((p) => p.x >= 15 && p.x <= WORLD.w - 15 && p.y >= 15 && p.y <= WORLD.h - 15)
);
log('players:', a.state.players.length, '| tagger valid:', !!a.state.tagger);
log('clients agree:', a.state.tagger === b.state.tagger);
log('powerups present:', Array.isArray(a.state.pw) && a.state.pw.length > 0);

// leave -> match ends
b.ws.close();
await wait(500);
log('after quit:', a.state.state, '| reason:', a.state.result?.reason);

a.ws.close();
process.exit(0);
