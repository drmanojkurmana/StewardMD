// test/fixtures/kardia-sync-stub.mjs - small KARDIA_SYNC stand-in for SyncProbe UI tests.
// Implements the contract's createLoopbackPair() semantics plus the minimal core
// surface kardia-syncprobe.js expects (see its header). The real core (worker A)
// replaces this at merge; the UI calls only the methods listed here.
// Both roles can run in one page: the display registers its short code, the probe
// joins through the same registry, and a loopback pair wires them together.
const registry = new Map();

function hex(n, bytes) {
  let s = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < bytes * 2; i++) s += chars[Math.floor(n() * 16)];
  return s;
}
let seed = 0x12345678;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

export function createLoopbackPair(opts = {}) {
  const loss = opts.loss || 0, delay = opts.delayMs || 0, dup = opts.duplicate || false, reorder = opts.reorder || false;
  const ends = [];
  let pending = [];
  function make(name) {
    const t = {
      name,
      peer: null,
      handlers: null,
      sent: 0,
      recv: 0,
      recvAt: 0,
      rttMs: 18 + Math.floor(rand() * 30),
      lossPct: loss * 100,
      send(bytes) {
        if (!t.peer || !t.peer.handlers || t.closed) return false;
        t.sent++;
        if (rand() < loss) return true;
        const deliver = () => {
          if (t.closed || t.peer.closed) return;
          t.peer.recv++;
          t.peer.recvAt = Date.now();
          try { t.peer.handlers.onBytes(bytes.slice()); } catch {}
        };
        if (dup) { later(deliver); later(deliver); }
        else if (reorder && rand() < 0.5) { pending.push(deliver); later(() => { pending.forEach((f) => f()); pending = []; }); }
        else later(deliver);
        return true;
      },
      async host(pairing, handlers) { t.handlers = handlers; t.pairing = pairing; return; },
      async join(pairing, handlers) {
        t.handlers = handlers; t.pairing = pairing;
        if (t.peer && t.peer.handlers) {
          later(() => { try { t.peer.handlers.onPeerConnected({ transport: "loopback" }); } catch {} });
          later(() => { try { t.handlers.onPeerConnected({ transport: "loopback" }); } catch {} });
        }
        return;
      },
      async close() { t.closed = true; return; },
      stats() {
        return { rttMs: t.rttMs, lossPct: t.lossPct, sentPerSec: 24, recvPerSec: 24, lastRecvAt: t.recvAt };
      },
    };
    ends.push(t);
    return t;
  }
  function later(f) {
    if (delay > 0) setTimeout(f, delay);
    else queueMicrotask(f);
  }
  const a = make("a"), b = make("b");
  a.peer = b; b.peer = a;
  return [a, b];
}

const SHORT = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function shortCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += SHORT[Math.floor(rand() * SHORT.length)];
  return s;
}

// One directed session: FakeCore is either the display side or the probe side.
// `link` is a shared record so the two sides observe the same state.
function makeLink() {
  return {
    name: "idle", confirm: null, confirmed: { display: false, probe: false },
    paused: false, lastError: null, rttMs: 42, transport: "loopback", poseTick: 0,
  };
}

export class FakeCore {
  constructor(role, pair) {
    this._role = role; // "display" | "probe"
    this._link = makeLink();
    this._listeners = [];
    this._session = null;
    this._transport = pair ? (role === "display" ? pair[0] : pair[1]) : null;
    this._poseTimer = null;
  }
  on(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }
  _emit(evt) {
    for (const f of this._listeners.slice()) {
      try { f(evt); } catch {}
    }
  }
  _set(name, extra = {}) {
    this._link.name = name;
    queueMicrotask(() => this._emit({ type: "state", name, ...extra }));
  }
  role() { return this._link.name === "idle" || this._link.name === "disconnected" ? null : this._role; }
  state() { return { name: this._link.name, confirm: this._link.confirm }; }
  // ---- display side ----
  startDisplay() {
    const sessionId = hex(rand, 16);
    const displayPub = "B".repeat(86);
    const code = shortCode();
    this._session = {
      sessionId, displayPub, shortCode: code, expiresAt: Date.now() + 5 * 60 * 1000,
      confirm: String(1000 + (parseInt(sessionId.slice(0, 4), 16) % 9000)),
      confirmed: false,
    };
    this._link.confirm = this._session.confirm;
    registry.set(code, this);
    this._set("discovering");
    setTimeout(() => { if (this._link.name === "discovering") this._set("pairing"); }, 30);
    return { ...this._session };
  }
  // ---- probe side ----
  joinProbe(input) {
    const text = String(input == null ? "" : input).trim();
    const m = text.match(/^kardia-sync:1:([0-9a-fA-F]{32}):/);
    let display = null;
    if (m) {
      for (const d of registry.values()) {
        if (d._session && d._session.sessionId === m[1].toLowerCase()) { display = d; break; }
      }
    } else {
      const code = text.toUpperCase().replace(/[^A-Z2-9]/g, "");
      display = registry.get(code) || null;
    }
    if (!display || !display._session) return Promise.reject(new Error("not-found"));
    if (Date.now() > display._session.expiresAt) return Promise.reject(Object.assign(new Error("gone"), { reason: "expired" }));
    this._peer = display;
    display._peer = this;
    this._session = { ...display._session };
    this._link = display._link;
    this._link.confirm = display._session.confirm;
    display._set("confirming");
    this._set("confirming");
    return Promise.resolve(true);
  }
  confirm() {
    this._link.confirmed[this._role] = true;
    const other = this._peer;
    if (other && this._link.confirmed.display && this._link.confirmed.probe) {
      if (this._session) this._session.confirmed = true;
      if (other._session) other._session.confirmed = true;
      this._set("connecting");
      other._set("connecting");
      setTimeout(() => {
        this._set("connected"); other._set("connected");
        this._startPose(); other._startPose();
      }, 30);
    }
    return true;
  }
  _startPose() {
    if (this._poseTimer) return;
    this._poseTimer = setInterval(() => {
      // Test-only timer: never hold the runner process open on its own.
      if (this._link.name !== "connected" || this._link.paused) return;
      this._link.poseTick++;
      const pose = {
        tiltDeg: Math.round(20 * Math.sin(this._link.poseTick / 4)),
        rotationDeg: Math.round(30 * Math.cos(this._link.poseTick / 5)),
      };
      this._emit({ type: "pose", pose });
    }, 200);
    if (this._poseTimer.unref) this._poseTimer.unref();
  }
  disconnect() {
    if (this._poseTimer) { clearInterval(this._poseTimer); this._poseTimer = null; }
    if (this._session) registry.delete(this._session.shortCode);
    this._set("disconnected");
    if (this._peer) this._peer._set("disconnected");
    return Promise.resolve();
  }
  reconnect() {
    this._set("reconnecting");
    if (this._peer) this._peer._set("reconnecting");
    setTimeout(() => {
      this._set("connected");
      if (this._peer) this._peer._set("connected");
    }, 60);
    return Promise.resolve();
  }
  recenter() {
    this._link.poseTick = 0;
    this._emit({ type: "pose", pose: { tiltDeg: 0, rotationDeg: 0 } });
    return true;
  }
  calibrate() { return this.recenter(); }
  setPaused(b) { this._link.paused = !!b; return true; }
  probePatch() { return true; }
  stats() {
    return { rttMs: this._link.rttMs, lossPct: 0, sentPerSec: 24, recvPerSec: 24, lastRecvAt: Date.now() };
  }
  transports() {
    return [
      { id: "loopback", kind: "direct", available: true, canAdvertise: true, canScan: true, needsInternet: false, maxPayload: 1024, platform: "web" },
      { id: "ble", kind: "direct", available: false, reason: "No Bluetooth radio in this test", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 182, platform: "web" },
      { id: "relay", kind: "relay", available: true, reason: "", canAdvertise: true, canScan: true, needsInternet: true, maxPayload: 1024, platform: "web" },
    ];
  }
  activeTransport() { return this._link.name === "connected" || this._link.name === "reconnecting" ? this._link.transport : null; }
  session() { return this._session ? { ...this._session } : null; }
  lastError() { return this._link.lastError; }
}

export function createSessionPair() {
  const pair = createLoopbackPair();
  const display = new FakeCore("display", pair);
  const probe = new FakeCore("probe", pair);
  return { display, probe, pair };
}

export function __reset() {
  registry.clear();
  seed = 0x12345678;
}
