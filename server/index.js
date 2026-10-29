import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import * as C from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { cleanName, createRoom, quickPlay, rooms } from '../shared/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');
const VENDOR_DIR = path.join(ROOT, 'node_modules', 'phaser', 'dist');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const gzipCache = new Map();

function safeJoin(base, target) {
  const full = path.resolve(base, '.' + path.posix.normalize('/' + target));
  return full.startsWith(base + path.sep) ? full : null;
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // Code and markup stay revalidated; there are no hashed filenames to lean on.
    const cache = ['.html', '.css', '.js', '.mjs'].includes(ext)
      ? 'no-cache'
      : 'public, max-age=3600';

    const compressible = ['.html', '.css', '.js', '.mjs', '.json', '.svg'].includes(ext);
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (compressible && wantsGzip) {
      let entry = gzipCache.get(filePath);
      if (!entry || entry.mtimeMs !== stat.mtimeMs) {
        entry = { buf: zlib.gzipSync(fs.readFileSync(filePath), { level: 6 }), mtimeMs: stat.mtimeMs };
        gzipCache.set(filePath, entry);
      }
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-encoding': 'gzip',
        'content-length': entry.buf.length,
        'cache-control': cache,
        vary: 'accept-encoding',
      });
      res.end(entry.buf);
      return;
    }

    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': cache,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  if (pathname === '/vendor/phaser.min.js') {
    serveFile(req, res, path.join(VENDOR_DIR, 'phaser.min.js'));
    return;
  }

  const target = pathname.startsWith('/shared/')
    ? safeJoin(SHARED_DIR, pathname.slice('/shared/'.length))
    : safeJoin(PUBLIC_DIR, pathname.slice(1));

  if (!target) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  if (pathname.endsWith('/')) {
    serveFile(req, res, path.join(target, 'index.html'));
    return;
  }
  serveFile(req, res, target);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function leaveRoom(ws) {
  const session = ws.session;
  if (!session || !session.room) return;
  const room = session.room;
  if (room.players.has(session.id)) room.removePlayer(session.id);
  session.room = null;
}

function joinRoom(ws, room) {
  const session = ws.session;
  leaveRoom(ws);
  if (room.players.size >= C.MAX_PLAYERS) {
    send(ws, { t: 'error', msg: 'That room is full (4 players max).' });
    return false;
  }
  if (room.state !== 'lobby' && room.state !== 'ended') {
    // Allow dropping into a running match as a spectator-free late joiner.
    // (Kept simple: late joins are rejected mid-match.)
    send(ws, { t: 'error', msg: 'That match is already running. Try quick play.' });
    return false;
  }
  const player = room.addPlayer({ name: session.name, ws });
  session.id = player.id;
  session.room = room;
  send(ws, { t: 'welcome', id: player.id, name: player.name, code: room.code });
  room.broadcastRoom();
  if (room.state === 'playing' || room.state === 'ended') room.broadcastState();
  return true;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.session = { id: null, name: 'Player', room: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    const session = ws.session;
    const room = session.room;

    switch (msg.t) {
      case 'hello': {
        session.name = cleanName(msg.name);
        send(ws, { t: 'welcome', id: session.id, name: session.name });
        break;
      }

      case 'quick': {
        session.name = cleanName(msg.name, session.name);
        const r = quickPlay();
        joinRoom(ws, r);
        break;
      }

      case 'create': {
        session.name = cleanName(msg.name, session.name);
        const r = createRoom({ publicRoom: msg.public !== false });
        joinRoom(ws, r);
        break;
      }

      case 'join': {
        session.name = cleanName(msg.name, session.name);
        const code = String(msg.code || '').trim().toUpperCase();
        const r = rooms.get(code);
        if (!r) {
          send(ws, { t: 'error', msg: `No room called ${code || '??'}.` });
          break;
        }
        joinRoom(ws, r);
        break;
      }

      case 'leave': {
        leaveRoom(ws);
        send(ws, { t: 'left' });
        break;
      }

      case 'map': {
        if (!room || room.hostId !== session.id) break;
        if (room.setMap(String(msg.mapId))) room.broadcastRoom();
        break;
      }

      case 'duration': {
        if (!room || room.hostId !== session.id) break;
        if (room.setDuration(Number(msg.value))) room.broadcastRoom();
        break;
      }

      case 'color': {
        if (!room) break;
        const player = room.players.get(session.id);
        const wanted = String(msg.color || '');
        if (!player || !C.COLORS.some((c) => c.id === wanted)) break;
        const taken = [...room.players.values()].some((p) => p.id !== player.id && p.color === wanted);
        if (taken) {
          send(ws, { t: 'error', msg: 'That colour is taken.' });
          break;
        }
        player.color = wanted;
        room.broadcastRoom();
        break;
      }

      case 'bot': {
        if (!room || room.hostId !== session.id || room.state !== 'lobby') break;
        const bots = [...room.players.values()].filter((p) => p.bot).length;
        if (msg.add) {
          if (room.players.size >= C.MAX_PLAYERS) {
            send(ws, { t: 'error', msg: 'Room is full.' });
            break;
          }
          room.addPlayer({ bot: true, name: `Bot ${bots + 1}` });
        } else if (bots > 0) {
          const last = [...room.players.values()].filter((p) => p.bot).pop();
          room.removePlayer(last.id);
        }
        room.broadcastRoom();
        break;
      }

      case 'start':
      case 'rematch': {
        if (!room || room.hostId !== session.id) break;
        if (room.players.size < 2) {
          send(ws, { t: 'error', msg: 'Need at least 2 players (or a bot) to start.' });
          break;
        }
        room.start();
        break;
      }

      case 'lobby': {
        if (!room || room.hostId !== session.id) break;
        room.resetToLobby();
        break;
      }

      case 'input': {
        if (!room) break;
        const p = room.players.get(session.id);
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
  });

  ws.on('close', () => {
    leaveRoom(ws);
  });
  ws.on('error', () => {
    leaveRoom(ws);
  });
});

// ---- Simulation loop -------------------------------------------------------
const STEP = 1 / C.TICK_HZ;
let accumulator = 0;
let last = performance.now();

setInterval(() => {
  const now = performance.now();
  let delta = (now - last) / 1000;
  last = now;
  if (delta > 0.25) delta = 0.25; // don't fast-forward after a stall
  accumulator += delta;
  let steps = 0;
  while (accumulator >= STEP && steps < 8) {
    for (const room of rooms.values()) room.tick(STEP);
    accumulator -= STEP;
    steps++;
  }
  if (steps === 8) accumulator = 0;
}, 1000 / 120);

// ---- Housekeeping ----------------------------------------------------------
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 25_000);

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60;
  for (const [code, room] of rooms) {
    const noHumans = ![...room.players.values()].some((p) => !p.bot);
    if (noHumans && room.lastActivity < cutoff) rooms.delete(code);
  }
}, 1000 * 60 * 5);

server.listen(PORT, HOST, () => {
  console.log(`\n  Tag — no ads, no tracking.`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Map pool: ${MAPS.map((m) => m.name).join(', ')}\n`);
});

const shutdown = () => {
  console.log('\nShutting down…');
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
