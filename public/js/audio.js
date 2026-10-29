// Tiny WebAudio blips — no asset files, nothing to download.

let ctx = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq, to = null, dur = 0.12, type = 'sine', gain = 0.05, delay = 0 }) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.18, gain = 0.04 }) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  const g = a.createGain();
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1400;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  unlock() {
    ac();
  },
  tag() {
    tone({ freq: 330, to: 120, dur: 0.16, type: 'square', gain: 0.05 });
    noise({ dur: 0.14, gain: 0.03 });
  },
  pad() {
    tone({ freq: 260, to: 640, dur: 0.14, type: 'triangle', gain: 0.04 });
  },
  portal() {
    tone({ freq: 900, to: 260, dur: 0.22, type: 'sine', gain: 0.04 });
  },
  shield() {
    tone({ freq: 240, to: 520, dur: 0.2, type: 'sine', gain: 0.05 });
    tone({ freq: 520, to: 300, dur: 0.16, type: 'triangle', gain: 0.03, delay: 0.05 });
  },
  power() {
    tone({ freq: 660, to: 990, dur: 0.13, type: 'triangle', gain: 0.045 });
    tone({ freq: 990, to: 1320, dur: 0.12, type: 'sine', gain: 0.03, delay: 0.09 });
  },
  dash() {
    noise({ dur: 0.1, gain: 0.02 });
  },
  start() {
    [0, 0.16, 0.32].forEach((d, i) => tone({ freq: 380 + i * 120, dur: 0.11, gain: 0.04, delay: d }));
  },
  end() {
    [0, 0.14, 0.3].forEach((d, i) => tone({ freq: 520 - i * 120, dur: 0.2, gain: 0.05, delay: d }));
  },
  ui() {
    tone({ freq: 440, dur: 0.06, type: 'sine', gain: 0.03 });
  },
};

export function setMuted(v) {
  muted = !!v;
}
