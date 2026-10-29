import * as C from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { Client } from './game.js';
import { attachClient, GameScene } from './scene.js';
import { initInput, isTouch } from './input.js';
import { LocalNet } from './localnet.js';
import { Net } from './net.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

const client = new Client();

let net = null;
let room = null;
let myId = null;
let name = localStorage.getItem('tag.name') || '';
let game = null;
let offline = false;
let ready = false;

// --------------------------------------------------------------- screens
function show(which) {
  for (const id of ['home', 'lobby', 'game']) {
    $(`screen-${id}`).hidden = id !== which;
  }
  if (which === 'game') ensureGame();
}

function ensureGame() {
  if (game) return;
  attachClient(client);
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'stage',
    backgroundColor: '#05070a',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    banner: false,
    audio: { noAudio: true },
    render: { antialias: true, preserveDrawingBuffer: true },
    scene: [GameScene],
  });
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// ------------------------------------------------------------------- net
function useNet(impl) {
  net = impl;
  client.setNet(impl);

  impl.on('welcome', (msg) => {
    if (msg.id) {
      myId = msg.id;
      client.myId = msg.id;
      if (msg.name) {
        name = msg.name;
        client.name = msg.name;
      }
    }
  });

  impl.on('room', (msg) => {
    room = msg;
    client.setRoom(msg);
    renderLobby();
    if (msg.state === 'playing' || msg.state === 'ended') show('game');
    else show('lobby');
    syncResults();
  });

  impl.on('state', (msg) => {
    if (!room) return;
    client.onState(msg);
    if (msg.state === 'playing' && room.state !== 'playing') {
      room.state = 'playing';
      show('game');
    }
    syncResults();
  });

  impl.on('error', (msg) => toast(msg.msg || 'Something went wrong.'));

  impl.on('left', () => {
    room = null;
    history.replaceState({}, '', location.pathname);
    show('home');
    if (offline) setMode('offline');
  });
}

function setReady(value) {
  ready = value;
  for (const id of ['btn-quick', 'btn-create', 'btn-join']) $(id).disabled = !value;
  if (offline) {
    $('btn-join').disabled = true;
    $('code-input').disabled = true;
  }
}

// Static hosts (GitHub Pages, file://) can't run the socket server, so skip the
// doomed connection attempt and go straight to practice mode.
function isStaticHost() {
  return location.protocol === 'file:' || /\.github\.io$/.test(location.hostname);
}

function setMode(mode) {
  offline = mode === 'offline';
  document.body.classList.toggle('offline', offline);
  const note = $('net-note');

  if (offline) {
    note.textContent = 'No server reachable — offline practice against bots.';
    note.className = 'note warn';
    $('btn-quick').textContent = 'Practice with bots';
    $('btn-create').textContent = 'Practice room';
    $('code-input').disabled = true;
    $('code-input').placeholder = 'OFFLINE';
    $('btn-join').disabled = true;
  } else {
    $('btn-quick').textContent = 'Quick play';
    $('btn-create').textContent = 'Create a room';
    $('code-input').disabled = false;
    $('code-input').placeholder = 'CODE';
  }
}

function switchToOffline() {
  if (offline) return;
  const remote = net;
  if (remote && typeof remote.close === 'function') remote.close();
  useNet(new LocalNet());
  setMode('offline');
  setReady(true);
}

// ------------------------------------------------------------------ boot
const remote = new Net();
useNet(remote);

let fallback = null;

if (isStaticHost()) {
  switchToOffline();
} else {
  remote.connect();
  setReady(false);

  fallback = setTimeout(() => {
    if (!remote.opened) switchToOffline();
  }, 2500);

  remote.on('open', () => {
    if (fallback) clearTimeout(fallback);
    if (offline) return;
    setReady(true);
    setMode('online');
    const note = $('net-note');
    note.textContent = 'Connected · no ads, no accounts, no tracking';
    note.className = 'note ok';
  });

  remote.on('close', () => {
    if (!remote.opened) {
      if (fallback) clearTimeout(fallback);
      switchToOffline();
    }
  });
}

// ------------------------------------------------------------ home screen
function currentName() {
  const typed = $('name-input').value.trim();
  return typed || name || 'Player';
}

function rememberName() {
  const n = currentName();
  const existing = localStorage.getItem('tag.name');
  localStorage.setItem('tag.name', n);
  if (n !== existing && net) net.send({ t: 'hello', name: n });
  return n;
}

$('name-input').value = name;
$('name-input').addEventListener('change', rememberName);

$('btn-quick').addEventListener('click', () => {
  if (!ready) return;
  sfx.unlock();
  net.send({ t: 'quick', name: rememberName() });
});

$('btn-create').addEventListener('click', () => {
  if (!ready) return;
  sfx.unlock();
  net.send({ t: 'create', name: rememberName() });
});

$('btn-join').addEventListener('click', joinFromInput);
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinFromInput();
});

function joinFromInput() {
  if (!ready || offline) return;
  sfx.unlock();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length < 3) {
    toast('Enter the 4-letter room code.');
    return;
  }
  net.send({ t: 'join', name: rememberName(), code });
}

// ---------------------------------------------------------------- lobby
const mapPicker = $('map-picker');
for (const map of MAPS) {
  const btn = document.createElement('button');
  btn.className = 'map-card';
  btn.dataset.map = map.id;
  btn.innerHTML = `<b>${map.name}</b><span>${map.blurb}</span>`;
  btn.addEventListener('click', () => {
    if (!isHost()) return;
    sfx.ui();
    net.send({ t: 'map', mapId: map.id });
  });
  mapPicker.appendChild(btn);
}

const homeMapList = $('home-map-list');
for (const map of MAPS) {
  const li = document.createElement('li');
  li.innerHTML = `<strong>${map.name}</strong><span>${map.blurb}</span>`;
  homeMapList.appendChild(li);
}

$('duration-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !isHost()) return;
  sfx.ui();
  net.send({ t: 'duration', value: Number(btn.dataset.value) });
});

$('btn-add-bot').addEventListener('click', () => isHost() && net.send({ t: 'bot', add: true }));
$('btn-remove-bot').addEventListener('click', () => isHost() && net.send({ t: 'bot', add: false }));
$('btn-start').addEventListener('click', () => {
  sfx.unlock();
  net.send({ t: 'start' });
});
$('btn-leave-lobby').addEventListener('click', () => net.send({ t: 'leave' }));

$('btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${room?.code || ''}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied.');
  } catch {
    toast(url);
  }
});

const isHost = () => room && room.hostId === myId;

function renderLobby() {
  if (!room) return;
  $('room-code').textContent = room.code;
  $('player-count').textContent = `${room.players.length}/${C.MAX_PLAYERS}`;
  $('btn-copy').hidden = offline;

  const list = $('lobby-players');
  list.innerHTML = '';
  room.players.forEach((p) => {
    const color = C.colorFor(p.color);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot" style="background:${color.hex}"></span>
      <span class="who">${escapeHtml(p.name)}</span>
      ${p.id === room.hostId ? '<span class="tag-you">host</span>' : ''}
      ${p.id === myId ? '<span class="tag-you">you</span>' : ''}
      ${p.bot ? '<span class="tag-you">bot</span>' : ''}
    `;
    list.appendChild(li);
  });
  for (let i = room.players.length; i < C.MAX_PLAYERS; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Open slot';
    list.appendChild(li);
  }

  for (const btn of mapPicker.children) {
    btn.classList.toggle('active', btn.dataset.map === room.mapId);
    btn.disabled = !isHost();
  }
  for (const btn of $('duration-picker').children) {
    btn.classList.toggle('active', Number(btn.dataset.value) === room.duration);
    btn.disabled = !isHost();
  }

  const start = $('btn-start');
  start.disabled = !isHost() || room.players.length < 2;
  start.textContent = isHost() ? 'Start match' : 'Waiting for host…';
  $('bot-row').hidden = !isHost();

  const bots = room.players.filter((p) => p.bot).length;
  $('lobby-hint').textContent = offline
    ? 'Offline practice: bots chase and flee on their own. Pick a map and start.'
    : isHost()
      ? bots
        ? 'Bots chase and flee on their own — good for a warm-up.'
        : 'Share the code or invite link. Add a bot if you want to test solo.'
      : 'The host picks the map and starts the match.';

  $('host-hint').textContent =
    room.players.length < 2
      ? 'Need at least one other player (or a bot) to start.'
      : isHost()
        ? 'Everyone spawns on the ground. One random player is it.'
        : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ----------------------------------------------------------------- game
$('btn-leave-game').addEventListener('click', () => net.send({ t: 'leave' }));
$('btn-rematch').addEventListener('click', () => net.send({ t: 'rematch' }));
$('btn-back-lobby').addEventListener('click', () => net.send({ t: 'lobby' }));
$('btn-results-leave').addEventListener('click', () => net.send({ t: 'leave' }));

function syncResults() {
  const el = $('results');
  const ended = room && room.state === 'ended';
  el.hidden = !ended;
  if (!ended) return;

  const meIsLoser = client.result && client.result.loserId === myId;
  const winnerNames = (client.result?.winnerIds || [])
    .map((id) => room.players.find((p) => p.id === id)?.name)
    .filter(Boolean);

  $('results-title').textContent = meIsLoser ? 'You were it — you lose' : 'You survived';

  let body = meIsLoser
    ? 'The clock beat you. Tag someone before time runs out next round.'
    : winnerNames.length
      ? `${winnerNames.join(', ')} made it out.`
      : 'The round ended before anyone got out.';
  if (client.result?.reason === 'abandoned') body += ' Someone left, so the match stopped.';
  if (!isHost()) body += ' Waiting for the host to start the next round.';
  $('results-body').textContent = body;

  const host = isHost();
  $('btn-rematch').hidden = !host;
  $('btn-rematch').textContent = 'Play again';
  $('btn-back-lobby').hidden = !host;
}

// HUD refresh at ~12 Hz
let hudSignature = '';
setInterval(() => {
  if (!room || room.state !== 'playing') {
    $('countdown').hidden = true;
    return;
  }
  const tl = Math.max(0, client.timeLeft);
  const m = Math.floor(tl / 60);
  const s = Math.floor(tl % 60);
  const timer = $('hud-timer');
  timer.textContent = `${m}:${String(s).padStart(2, '0')}`;

  const me = myId ? client.ents.get(myId) : null;
  const isIt = !!me && me.tagger;
  timer.classList.toggle('warn', isIt && tl <= 10);

  const role = $('hud-role');
  role.textContent = isIt ? 'You are IT' : 'You are safe';
  role.classList.toggle('it', isIt);

  const cd = $('countdown');
  if (client.countdown > 0) {
    const n = Math.ceil(client.countdown);
    cd.hidden = false;
    const span = cd.firstElementChild;
    if (span.textContent !== String(n)) {
      span.textContent = String(n);
      span.style.animation = 'none';
      void span.offsetWidth;
      span.style.animation = '';
    }
  } else {
    cd.hidden = true;
  }

  const dashBtn = $('dash-btn');
  dashBtn.classList.toggle('cooling', !!me && me.dashCd > 0);

  const chips = [];
  if (me) {
    if (me.speedT > 0) chips.push(['speed', me.speedT]);
    if (me.shieldT > 0) chips.push(['shield', me.shieldT]);
    if (me.jumpT > 0) chips.push(['jump', me.jumpT]);
  }
  const sig = chips.map(([k, t]) => `${k}${Math.ceil(t)}`).join('|');
  if (sig !== hudSignature) {
    hudSignature = sig;
    $('hud-powerups').innerHTML = chips
      .map(([k, t]) => {
        const def = C.POWERUPS[k];
        return `<span class="pw-chip" style="--pw:${def.color}">
          <i></i>${def.name}<b>${Math.ceil(t)}s</b>
        </span>`;
      })
      .join('');
  }
}, 80);

// -------------------------------------------------------------- startup
initInput();
if (isTouch()) document.body.classList.add('touch');

$('name-input').value = name;
show('home');

const params = new URLSearchParams(location.search);
const codeParam = (params.get('room') || '').trim().toUpperCase();
if (codeParam) {
  $('code-input').value = codeParam;
  const autoName = localStorage.getItem('tag.name') || `Player ${Math.floor(Math.random() * 90 + 10)}`;
  $('name-input').value = autoName;
}

// Wait for the socket before letting anyone click through, so a dead server
// (like GitHub Pages) drops straight into practice mode instead of hanging.
let joinedFromUrl = false;
function maybeAutoJoin() {
  if (joinedFromUrl || !codeParam || offline || !remote.opened) return;
  joinedFromUrl = true;
  net.send({ t: 'join', name: $('name-input').value || 'Player', code: codeParam });
}
remote.on('open', maybeAutoJoin);
const autoJoinTimer = setInterval(() => {
  if (ready || offline) {
    clearInterval(autoJoinTimer);
    maybeAutoJoin();
  }
}, 120);

if (!codeParam && !name) {
  setTimeout(() => $('name-input').focus(), 300);
}

window.addEventListener('beforeunload', () => {
  remote.closedByUs = true;
});

if (new URLSearchParams(location.search).get('debug')) {
  window.__tag = {
    client,
    get net() {
      return net;
    },
    get room() {
      return room;
    },
    get scene() {
      return game ? game.scene.getScene('game') : null;
    },
    get offline() {
      return offline;
    },
  };
}
