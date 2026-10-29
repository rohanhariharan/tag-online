// Thin WebSocket wrapper: auto-reconnect, typed handlers, small send queue.

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.queue = [];
    this.retry = 0;
    this.opened = false;
    this.closedByUs = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.opened = true;
      this.retry = 0;
      this.emit('open');
      for (const msg of this.queue.splice(0)) ws.send(msg);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.emit('message', msg);
      if (msg && msg.t) this.emit(msg.t, msg);
    });

    ws.addEventListener('close', () => {
      this.opened = false;
      this.emit('close');
      if (this.closedByUs) return;
      const delay = Math.min(8000, 400 * 2 ** Math.min(this.retry++, 4));
      setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener('error', () => {
      /* close follows */
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
    else if (this.queue.length < 40) this.queue.push(data);
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }

  close() {
    this.closedByUs = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
