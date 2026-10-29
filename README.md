# TAG — online tag, no ads

A small, self-hostable game of tag: 2–4 players bounce around a side-scrolling
world of grass, wood and floating ledges, one player is **it**, and whoever is
still it when the clock runs out loses. Everyone can be on a different network —
you share a link, not a couch.

- **No ads, no accounts, no analytics, no third-party requests.** The page loads
  local files only and opens one WebSocket.
- **Works across networks.** The server is authoritative and relays state, so it
  behaves like any normal website: no port forwarding, no NAT traversal, no TURN
  servers (which is what WebRTC-based clones need).
- **Phaser 3 handles the client** — camera, sprites, particles, scaling. The rules
  live on the server, so four browsers on four networks see the same game.
- **A 3200×1800 world with an adaptive camera.** The view zooms out as the tagger
  gets further away and leans toward the chase, so the map feels big instead of
  either cramped or unreadable.
- **One Node process, no database.** Rooms live in memory and are garbage
  collected when empty.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

Open two browser windows (or one normal + one incognito), create a room in one,
paste the code in the other. Or press **Quick play** to get dropped into a public
lobby with a free seat.

Tests and checks:

```bash
npm test             # physics regression + map sanity
npm run smoke        # two clients + a bot play a round over the real server
```

## Play with friends on other networks

Anywhere that runs Node 18+ or Docker works. The app is a single HTTP server that
serves the client and upgrades `/ws` on the same port — no second service, no
CORS setup, and static assets are gzipped on the fly (Phaser is ~1.2 MB raw,
~330 KB compressed).

**Docker**

```bash
docker build -t tag .
docker run -p 3000:3000 -e PORT=3000 tag
```

**Fly.io** (a `fly.toml` is included)

```bash
fly launch --no-deploy      # accept the existing fly.toml
fly deploy
```

**Render / Railway / a VPS** — create a web service from the repo, build with
`npm install`, start with `npm start`, and make sure the proxy forwards WebSocket
upgrades (all three do by default).

Then send friends `https://your-host/?room=ABCD`. The link drops them straight
into the lobby; there is no sign-up.

### GitHub Pages (static build)

`npm run build:pages` produces `_site/` — the client, `shared/` and Phaser, with no
server. Pushing to `main` runs `.github/workflows/pages.yml` and publishes it.

GitHub Pages can't run Node or WebSockets, so the Pages URL detects the static
host and drops into **offline practice**: the same room code runs inside the
browser, against bots. Online play with friends needs a real server (above);
point the client at one by serving this same bundle from that server.

### Notes on latency

Snapshots go out at 30 Hz and the client predicts its own movement locally with
the same physics step the server runs, so the game feels responsive up to about
120 ms RTT. Above that, movement stays correct but tagging feels slightly
forgiving in the tagger's favour. Put the server near your players.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | A / D or ← / → | on-screen stick |
| Jump | Space, W or ↑ — hold for height, tap for a short hop | JUMP |
| Dash | Shift or X | DASH |

- A full jump clears ~220px; with the **Double jump** powerup you get ~390px and
  can skip a platform level.
- The camera follows you and zooms out to keep the tagger in frame when they run.
- Bounce pads throw you straight up; teleporters pair up two points on the map.
- Dashing is a horizontal burst with a 2.2s cooldown, usable in the air.

## Powerups

| Powerup | Effect |
| --- | --- |
| **Speed** (feather) | +45% run speed for 8s |
| **Shield** (acorn) | blocks one tag, then pops |
| **Double jump** (leaf) | one extra jump in the air for 14s |

Each anchor respawns 9s after someone grabs it. All of it is resolved on the
server: picking one up, the shield eating a tag, and expiring timers.

## How a round works

1. The host picks a map — **Meadow**, **Canyon** or **Canopy** — and a length
   (1–3 minutes).
2. Everyone spawns on the ground; one player is randomly chosen as the tagger.
3. Run into anyone while you're it to pass the tag on. A short cooldown after each
   tag stops the two of you re-tagging each other instantly.
4. When the timer hits zero, the tagger loses. The host can replay immediately.

Bots can be added in the lobby for a warm-up — they chase when tagged, flee
otherwise, and hop onto ledges when it helps.

## Layout

```
shared/            code used by both server and client
  constants.js     tuning knobs (gravity, jump, speed, tag reach, powerups)
  maps.js          world geometry: solids, ledges, pads, portals, powerups, decor
  physics.js       the movement/collision step — identical on both sides
server/
  index.js         static file server (gzip) + WebSocket + simulation loop
  rooms.js         room lifecycle, tagging, powerups, bot steering
public/
  index.html, style.css, favicon.svg
  js/main.js       screens, lobby, results, HUD
  js/scene.js      Phaser scene: camera, actors, effects
  js/game.js       prediction + interpolation, and the draw model Phaser consumes
  js/input.js      keyboard + virtual stick + jump/dash buttons
  js/net.js        WebSocket wrapper with reconnect
  js/audio.js      WebAudio blips, no asset files
scripts/
  physics-test.js  jumps, ledges, walls, dashes, spawns
  validate-maps.js spawn/powerup/portal placement
  smoke.js         end-to-end round against a running server
```

The server runs a fixed 60 Hz simulation and broadcasts compact snapshots 30
times a second. The client runs the same `stepPlayer()` for its own player, then
Phaser draws the result — with one snapshot of interpolation for everyone else.

Why not run the rules in Phaser? Arcade Physics is frame-rate dependent and
client-side, which is fine for a single-player game but lets a laggy or
misbehaving client teleport through walls. Keeping the authoritative step in
`shared/physics.js` costs a few hundred lines and makes the game fair.

## Customising

- Tuning: `shared/constants.js` (gravity, jump velocity, speeds, tag reach).
- New map: add an entry to `MAPS` in `shared/maps.js` — solids, one-way ledges,
  pads, portals, powerup anchors and four spawns. Then run `npm test`.
- No build step. Edit a file, refresh.

## Privacy

No cookies, no local storage beyond your player name, no fonts or scripts from
other domains. The only network request the client makes is the WebSocket back to
the server you're running.
