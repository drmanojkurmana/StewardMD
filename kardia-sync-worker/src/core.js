/* kardia-sync-worker/src/core.js
 * Kardia SyncProbe Relay pure core: session management, role binding,
 * protocol validation, rate and frame size limits, and timeout state machine.
 *
 * Spec: ~/prep-data/cxp-briefs/_syncprobe-contract.md (Worker C)
 * Pure module without Workers runtime dependencies; testable in node.
 */

export const MAX_FRAME_BYTES = 128;
export const MAX_FPS = 60;
export const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const IDLE_TIMEOUT_MS = 60 * 1000;    // 60 seconds

export const TYPE_HELLO = 1;
export const TYPE_WELCOME = 2;
export const TYPE_POSE = 3;
export const TYPE_CONTROL = 4;
export const TYPE_PING = 5;
export const TYPE_PONG = 6;
export const TYPE_BYE = 7;

/* SHA-256 pure JS implementation (synchronous, zero external dependencies) */
export function sha256(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
  const maxWord = Math.pow(2, 32);
  const words = [];
  const bitLength = bytes.length * 8;
  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let c = 2; primeCounter < 64; c++) {
    if (!isComposite[c]) {
      for (let i = 0; i < 313; i += c) isComposite[i] = c;
      hash[primeCounter] = (Math.pow(c, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(c, 1 / 3) * maxWord) | 0;
    }
  }

  const fullLen = bytes.length + 1;
  const padLen = ((fullLen + 8 + 63) >> 6) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLength >>> 0);
  view.setUint32(padLen - 8, Math.floor(bitLength / 0x100000000));

  for (let i = 0; i < padLen; i += 4) {
    words.push(view.getUint32(i));
  }

  let h = hash.slice(0, 8);
  for (let j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = h.slice();
    for (let i = 0; i < 64; i++) {
      if (i >= 16) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const s0 = rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3);
        const s1 = rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      const a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hVal = h[7];
      const s1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hVal + s1 + ch + k[i] + w[i]) | 0;
      const s0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h[7] = h[6];
      h[6] = h[5];
      h[5] = h[4];
      h[4] = (d + temp1) | 0;
      h[3] = h[2];
      h[2] = h[1];
      h[1] = a;
      h[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) {
      h[i] = (h[i] + oldHash[i]) | 0;
    }
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i] >>> 0);
  }
  return out;
}

/* Constant-time roomToken comparison: compare SHA-256 digests in fixed 32-byte loop */
export function timingSafeEqualTokens(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = sha256(a);
  const hashB = sha256(b);

  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.timingSafeEqual === "function") {
    try {
      return crypto.subtle.timingSafeEqual(hashA, hashB);
    } catch (e) {}
  }

  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= hashA[i] ^ hashB[i];
  }
  return diff === 0;
}

/* Anonymous relay identity (owner 2026-10-26): pairing is secured by the
 * single use 6 character code, ECDH key agreement with the 4 digit match
 * confirmation and HMAC signed poses, so a Firebase sign-in is not required
 * to create or join a room. Signed-in rooms keep their uid binding; an
 * anonymous room binds both roles to this one shared marker and the secret
 * room token (43 random characters) stays the capability. */
export const ANON_UID = "anon";
export const ANON_PROTOCOL_TOKEN = "kardia-anon";

/* Parse Sec-WebSocket-Protocol: "kardia-sync, <Firebase ID token or
 * kardia-anon>, <roomToken>" */
export function parseProtocol(h) {
  if (!h || typeof h !== "string") return null;
  const parts = h.split(",").map((s) => s.trim());
  if (parts.length !== 3) return null;
  if (parts[0] !== "kardia-sync") return null;
  const token = parts[1];
  const roomToken = parts[2];
  const anonymous = token === ANON_PROTOCOL_TOKEN;
  // Firebase ID token is a 3-part compact JWT
  if (!anonymous && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  // roomToken is random 32 bytes base64url (43 chars, safe range 32-64 chars)
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(roomToken)) return null;
  return { protocol: "kardia-sync", token, roomToken, anonymous };
}

/* Base64url encode a byte array without padding */
export function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof btoa === "function"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Generate a 128-bit (16-byte) random room id in hex (32 lowercase hex chars) */
export function generateRoomId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback if crypto.webcrypto not global
    const nodeCrypto = awaitNodeCrypto();
    nodeCrypto.randomFillSync(bytes);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Generate 32 random bytes base64url */
export function generateRoomToken() {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    const nodeCrypto = awaitNodeCrypto();
    nodeCrypto.randomFillSync(bytes);
  }
  return bytesToBase64Url(bytes);
}

function awaitNodeCrypto() {
  try {
    // eslint-disable-next-line no-undef
    return require("crypto");
  } catch (e) {
    throw new Error("No secure random generator available");
  }
}

/* Frame header inspect: version u8 (1), type u8. Type 7 is BYE */
export function isByeFrame(data) {
  if (!data) return false;
  let u8 = null;
  if (data instanceof Uint8Array) {
    u8 = data;
  } else if (data instanceof ArrayBuffer) {
    u8 = new Uint8Array(data);
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    u8 = new Uint8Array(data.buffer, data.byteOffset, data.length);
  } else if (typeof data.byteLength === "number") {
    u8 = new Uint8Array(data);
  }
  if (!u8 || u8.length < 2) return false;
  return u8[0] === 1 && u8[1] === TYPE_BYE;
}

/* SyncRoomCore: pure state machine for a single pairing room */
export class SyncRoomCore {
  constructor(opts = {}) {
    this.roomId = opts.roomId || "";
    this.roomToken = opts.roomToken || null;
    this.displayUid = opts.displayUid || "";
    this.probeUid = opts.probeUid || null;
    this.createdAt = opts.createdAt || opts.now || Date.now();
    this.expiresAt = opts.expiresAt || (this.createdAt + (opts.ttl || SESSION_TTL_MS));
    this.lastActiveAt = opts.lastActiveAt || this.createdAt;
    this.maxFrameBytes = opts.maxFrameBytes || MAX_FRAME_BYTES;
    this.maxFps = opts.maxFps || MAX_FPS;
    this.idleTimeout = opts.idleTimeout || IDLE_TIMEOUT_MS;

    this.rolesUsed = opts.rolesUsed
      ? { ...opts.rolesUsed }
      : { display: false, probe: false };
    this.connected = opts.connected
      ? { ...opts.connected }
      : { display: false, probe: false };

    this.closed = !!opts.closed;
    this.closeReason = opts.closeReason || null;

    this.rateLogs = opts.rateLogs
      ? { display: opts.rateLogs.display ? opts.rateLogs.display.slice() : [],
          probe: opts.rateLogs.probe ? opts.rateLogs.probe.slice() : [] }
      : { display: [], probe: [] };
  }

  /* Check whether a socket connection can be accepted */
  canConnect({ role, tokenUid, roomToken, now = Date.now() }) {
    if (this.closed) {
      return { ok: false, status: 403, reason: "room_closed" };
    }
    if (now >= this.expiresAt) {
      return { ok: false, status: 403, reason: "expired" };
    }
    if (this.probeUid && (now - this.lastActiveAt >= this.idleTimeout)) {
      this.invalidate("idle_timeout");
      return { ok: false, status: 403, reason: "idle_timeout" };
    }
    if (!this.roomToken || !timingSafeEqualTokens(roomToken, this.roomToken)) {
      return { ok: false, status: 403, reason: "invalid_room_token" };
    }
    if (role !== "display" && role !== "probe") {
      return { ok: false, status: 400, reason: "invalid_role" };
    }

    if (role === "display") {
      if (tokenUid !== this.displayUid) {
        return { ok: false, status: 403, reason: "uid_mismatch" };
      }
      if (this.connected.display) {
        return { ok: false, status: 403, reason: "display_already_connected" };
      }
    } else if (role === "probe") {
      if (this.probeUid && tokenUid !== this.probeUid) {
        return { ok: false, status: 403, reason: "uid_mismatch" };
      }
      if (this.connected.probe) {
        return { ok: false, status: 403, reason: "probe_already_connected" };
      }
    }

    if (this.connected.display && this.connected.probe) {
      return { ok: false, status: 403, reason: "room_full" };
    }

    return { ok: true };
  }

  /* Bind socket for role */
  connect({ role, tokenUid, roomToken, now = Date.now() }) {
    const check = this.canConnect({ role, tokenUid, roomToken, now });
    if (!check.ok) return check;

    if (role === "probe" && !this.probeUid) {
      this.probeUid = tokenUid;
    }
    this.rolesUsed[role] = true;
    this.connected[role] = true;
    this.lastActiveAt = now;
    return { ok: true };
  }

  /* Receive and validate a binary frame from a role */
  onMessage({ role, data, now = Date.now() }) {
    if (this.closed) {
      return { forwarded: false, dropped: true, reason: "room_closed" };
    }
    if (now >= this.expiresAt) {
      this.invalidate("session_expired");
      return { forwarded: false, dropped: true, reason: "expired" };
    }
    if (role !== "display" && role !== "probe") {
      return { forwarded: false, dropped: true, reason: "invalid_role" };
    }
    if (!this.connected[role]) {
      return { forwarded: false, dropped: true, reason: "role_not_connected" };
    }

    const peerRole = role === "display" ? "probe" : "display";

    // Determine byte length
    let byteLength = 0;
    let u8 = null;
    if (data instanceof Uint8Array) {
      byteLength = data.byteLength;
      u8 = data;
    } else if (data instanceof ArrayBuffer) {
      byteLength = data.byteLength;
      u8 = new Uint8Array(data);
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
      byteLength = data.length;
      u8 = new Uint8Array(data.buffer, data.byteOffset, data.length);
    } else if (data && typeof data.byteLength === "number") {
      byteLength = data.byteLength;
      u8 = new Uint8Array(data);
    } else {
      return { forwarded: false, dropped: true, reason: "non_binary" };
    }

    // Size limit check
    if (byteLength > this.maxFrameBytes) {
      return { forwarded: false, dropped: true, reason: "size_limit" };
    }

    // Rate limit check: max 60 fps per socket in sliding 1000ms window
    const history = (this.rateLogs[role] || []).filter((t) => now - t < 1000);
    if (history.length >= this.maxFps) {
      this.rateLogs[role] = history;
      return { forwarded: false, dropped: true, reason: "rate_limit" };
    }
    history.push(now);
    this.rateLogs[role] = history;

    // Check if peer is currently connected
    if (!this.connected[peerRole]) {
      return { forwarded: false, dropped: true, reason: "peer_not_connected" };
    }

    // Check for BYE frame: forward, then invalidate room and close both
    if (isByeFrame(u8)) {
      this.lastActiveAt = now;
      this.invalidate("bye");
      return {
        forwarded: true,
        toRole: peerRole,
        closeBoth: true,
        reason: "bye",
        data,
      };
    }

    this.lastActiveAt = now;
    return {
      forwarded: true,
      toRole: peerRole,
      data,
    };
  }

  /* Socket drops or closes without explicit room invalidation */
  onClose({ role, now = Date.now(), reason = "closed" }) {
    if (this.closed) {
      return { closePeer: false };
    }
    if (role === "display" || role === "probe") {
      this.connected[role] = false;
    }
    return {
      closePeer: false,
      peerRole: role === "display" ? "probe" : "display",
      reason,
    };
  }

  /* Periodic timeout evaluation */
  checkTimeouts(now = Date.now()) {
    if (this.closed) return null;
    if (now >= this.expiresAt) {
      this.invalidate("session_expired");
      return { expired: true, closeBoth: true, reason: "session_expired" };
    }
    if (now - this.lastActiveAt >= this.idleTimeout) {
      this.invalidate("idle_timeout");
      return { expired: true, closeBoth: true, reason: "idle_timeout" };
    }
    return null;
  }

  /* Next alarm timestamp or null if closed */
  wakeAt(now = Date.now()) {
    if (this.closed) return null;
    if (!this.probeUid) {
      return this.expiresAt;
    }
    return Math.min(this.expiresAt, this.lastActiveAt + this.idleTimeout);
  }

  /* Invalidate room and its token permanently */
  invalidate(reason = "invalidated") {
    this.closed = true;
    this.closeReason = reason;
    this.roomToken = null; // invalidates the token
    this.connected.display = false;
    this.connected.probe = false;
  }

  toJSON() {
    return {
      roomId: this.roomId,
      roomToken: this.roomToken,
      displayUid: this.displayUid,
      probeUid: this.probeUid,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      lastActiveAt: this.lastActiveAt,
      rolesUsed: { ...this.rolesUsed },
      connected: { ...this.connected },
      closed: this.closed,
      closeReason: this.closeReason,
      maxFrameBytes: this.maxFrameBytes,
      maxFps: this.maxFps,
      idleTimeout: this.idleTimeout,
      rateLogs: {
        display: this.rateLogs.display.slice(),
        probe: this.rateLogs.probe.slice(),
      },
    };
  }

  static fromJSON(json) {
    return new SyncRoomCore(json);
  }
}

/* ---------- Short-code directory: typed-code relay lookup ----------
 * The display registers its 6-character short code when it creates a
 * session; the probe resolves the code to the room join material over
 * an authenticated endpoint. Entries live for the code lifetime
 * (CODE_TTL_MS, 5 minutes), are single use (a successful resolve
 * deletes the entry), and hold only small join fields: never frames,
 * poses, images, or any other payload.
 */
export const SHORT_CODE_RE = /^[A-Z2-9]{6}$/;
export const CODE_TTL_MS = SESSION_TTL_MS;
export const CODE_LOOKUP_MAX = 30;
export const CODE_LOOKUP_WINDOW_MS = 60 * 1000;

/* Normalize a typed code the same way the client does: uppercase, drop
 * anything outside the short-code alphabet, accept exactly 6 chars. */
export function normalizeShortCode(code) {
  if (typeof code !== "string") return null;
  const c = code.toUpperCase().replace(/[^A-Z2-9]/g, "");
  return c.length === 6 && SHORT_CODE_RE.test(c) ? c : null;
}

/* Constant-time code compare: compare SHA-256 digests in a fixed
 * 32-byte loop so timing reveals nothing about the stored code. */
export function timingSafeEqualCodes(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = sha256(a);
  const hb = sha256(b);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= ha[i] ^ hb[i];
  }
  return diff === 0;
}

function digestHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function isRoomId(s) {
  return typeof s === "string" && /^[0-9a-f]{32}$/i.test(s);
}

function isRoomToken(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(s);
}

function isDisplayPub(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{86,88}$/.test(s);
}

export class CodeDirectory {
  constructor(entries) {
    this.entries = entries instanceof Map ? entries : new Map();
  }

  static fromJSON(json) {
    const dir = new CodeDirectory();
    if (json && Array.isArray(json.entries)) {
      for (const [key, entry] of json.entries) {
        if (typeof key === "string" && entry && typeof entry === "object") {
          dir.entries.set(key, { ...entry });
        }
      }
    }
    return dir;
  }

  toJSON() {
    return { entries: Array.from(this.entries.entries()) };
  }

  get size() {
    return this.entries.size;
  }

  /* Remove expired entries; returns the number removed. */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /* Earliest expiry timestamp, or null when empty (for DO alarms). */
  nextExpiry() {
    let next = null;
    for (const entry of this.entries.values()) {
      if (next == null || entry.expiresAt < next) next = entry.expiresAt;
    }
    return next;
  }

  register({ code, roomId, roomToken, sessionId, displayPub, now = Date.now(), ttlMs = CODE_TTL_MS, expiresAt = null }) {
    const normalized = normalizeShortCode(code);
    if (!normalized) return { ok: false, reason: "bad-code" };
    if (!isRoomId(roomId)) return { ok: false, reason: "bad-room" };
    if (!isRoomToken(roomToken)) return { ok: false, reason: "bad-token" };
    if (!isRoomId(sessionId)) return { ok: false, reason: "bad-session" };
    if (!isDisplayPub(displayPub)) return { ok: false, reason: "bad-key" };
    const t = now == null ? Date.now() : now;
    // A code never outlives its room: clamp to the room expiry.
    const end = typeof expiresAt === "number" ? Math.min(t + ttlMs, expiresAt) : t + ttlMs;
    if (!(end > t)) return { ok: false, reason: "bad-expiry" };
    this.entries.set(digestHex(sha256(normalized)), {
      shortCode: normalized,
      roomId: String(roomId).toLowerCase(),
      roomToken,
      sessionId: String(sessionId).toLowerCase(),
      displayPub,
      createdAt: t,
      expiresAt: end,
    });
    return { ok: true };
  }

  /* Single-use resolve: a hit deletes the entry, so a code can only be
   * joined once. Hits, misses, and expired entries all report the same
   * not-found shape; the scan is constant-time across entries. */
  resolve({ code, now = Date.now() }) {
    const t = now == null ? Date.now() : now;
    this.sweep(t);
    const normalized = normalizeShortCode(code);
    if (!normalized) return { ok: false, reason: "not-found" };
    let hitKey = null;
    for (const [key, entry] of this.entries) {
      if (timingSafeEqualCodes(normalized, entry.shortCode)) {
        hitKey = key;
      }
    }
    if (hitKey == null) return { ok: false, reason: "not-found" };
    const entry = this.entries.get(hitKey);
    this.entries.delete(hitKey);
    return { ok: true, entry: { ...entry } };
  }

  deleteByRoom({ roomId }) {
    if (!isRoomId(roomId)) return { ok: false, removed: 0 };
    const want = String(roomId).toLowerCase();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.roomId === want) {
        this.entries.delete(key);
        removed++;
      }
    }
    return { ok: true, removed };
  }
}

/* Sliding-window lookup limiter: at most CODE_LOOKUP_MAX attempts per
 * CODE_LOOKUP_WINDOW_MS per user and per IP, so codes cannot be brute
 * forced. Both buckets must pass; every attempt that reaches the
 * lookup consumes quota, hits and misses alike. */
export class LookupRateLimiter {
  constructor(buckets) {
    this.buckets = buckets instanceof Map ? buckets : new Map();
  }

  static fromJSON(json) {
    const lim = new LookupRateLimiter();
    if (json && Array.isArray(json.buckets)) {
      for (const [key, stamps] of json.buckets) {
        if (typeof key === "string" && Array.isArray(stamps)) {
          lim.buckets.set(key, stamps.filter((t) => typeof t === "number"));
        }
      }
    }
    return lim;
  }

  toJSON(now = Date.now()) {
    const t = now == null ? Date.now() : now;
    const buckets = [];
    for (const [key, stamps] of this.buckets) {
      const fresh = stamps.filter((s) => t - s < CODE_LOOKUP_WINDOW_MS);
      if (fresh.length) buckets.push([key, fresh]);
    }
    return { buckets };
  }

  prune(now = Date.now()) {
    const t = now == null ? Date.now() : now;
    for (const [key, stamps] of this.buckets) {
      const fresh = stamps.filter((s) => t - s < CODE_LOOKUP_WINDOW_MS);
      if (fresh.length) this.buckets.set(key, fresh);
      else this.buckets.delete(key);
    }
  }

  check({ key, now = Date.now(), max = CODE_LOOKUP_MAX, windowMs = CODE_LOOKUP_WINDOW_MS }) {
    const t = now == null ? Date.now() : now;
    const history = (this.buckets.get(key) || []).filter((s) => t - s < windowMs);
    if (history.length >= max) {
      this.buckets.set(key, history);
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (t - history[0])) };
    }
    history.push(t);
    this.buckets.set(key, history);
    return { ok: true };
  }

  checkLookup({ uid, ip, now = Date.now() }) {
    const u = this.check({ key: "uid:" + uid, now });
    if (!u.ok) return u;
    const r = this.check({ key: "ip:" + (ip || "unknown"), now });
    if (!r.ok) return { ok: false, retryAfterMs: r.retryAfterMs };
    return { ok: true };
  }
}

/* Pure lookup decision shared by the Worker route and unit tests.
 * Returns an HTTP-style { status, body }. Unknown, expired, consumed,
 * and malformed codes all answer 404 so responses do not oracle which
 * codes exist. The body carries only the small join fields, never the
 * display uid and never any session payload. */
export function handleCodeLookup({ code, uid, ip, now = Date.now() } = {}, deps = {}) {
  const t = now == null ? Date.now() : now;
  /* No sign-in needed: a signed-in caller is limited per user and per IP;
   * an anonymous caller is limited per IP alone (the uid bucket is keyed
   * by that same IP, so the strict limit still applies). Only a caller
   * with neither identity nor IP is refused. */
  const effectiveUid = typeof uid === "string" && uid ? uid : (ip ? ANON_UID + ":" + ip : null);
  if (!effectiveUid) {
    return { status: 401, body: { error: "sign-in required" } };
  }
  const directory = deps.directory;
  const limiter = deps.limiter;
  if (limiter) {
    const lim = limiter.checkLookup({ uid: effectiveUid, ip: ip || "unknown", now: t });
    if (!lim.ok) {
      return { status: 429, body: { error: "rate-limited", retryAfterMs: lim.retryAfterMs } };
    }
  }
  if (!directory) {
    return { status: 404, body: { error: "not-found" } };
  }
  const hit = directory.resolve({ code, now: t });
  if (!hit.ok) {
    return { status: 404, body: { error: "not-found" } };
  }
  const e = hit.entry;
  return {
    status: 200,
    body: {
      roomId: e.roomId,
      roomToken: e.roomToken,
      sessionId: e.sessionId,
      displayPub: e.displayPub,
      shortCode: e.shortCode,
      expiresAt: e.expiresAt,
    },
  };
}

/* ---------- Per-IP session creation limit ----------
 * Anonymous session creation is open, so it is strictly limited per IP:
 * at most SESSION_CREATE_MAX rooms per SESSION_CREATE_WINDOW_MS. Every
 * attempt that reaches the check consumes quota, signed in or not. */
export const SESSION_CREATE_MAX = 30;
export const SESSION_CREATE_WINDOW_MS = 10 * 60 * 1000;

export class IpRateLimiter {
  constructor(buckets) {
    this.buckets = buckets instanceof Map ? buckets : new Map();
  }

  static fromJSON(json) {
    const lim = new IpRateLimiter();
    if (json && Array.isArray(json.buckets)) {
      for (const [key, stamps] of json.buckets) {
        if (typeof key === "string" && Array.isArray(stamps)) {
          lim.buckets.set(key, stamps.filter((t) => typeof t === "number"));
        }
      }
    }
    return lim;
  }

  toJSON(now = Date.now(), windowMs = SESSION_CREATE_WINDOW_MS) {
    const t = now == null ? Date.now() : now;
    const buckets = [];
    for (const [key, stamps] of this.buckets) {
      const fresh = stamps.filter((s) => t - s < windowMs);
      if (fresh.length) buckets.push([key, fresh]);
    }
    return { buckets };
  }

  check({ key, now = Date.now(), max = SESSION_CREATE_MAX, windowMs = SESSION_CREATE_WINDOW_MS }) {
    const t = now == null ? Date.now() : now;
    const history = (this.buckets.get(key) || []).filter((s) => t - s < windowMs);
    if (history.length >= max) {
      this.buckets.set(key, history);
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (t - history[0])) };
    }
    history.push(t);
    this.buckets.set(key, history);
    return { ok: true };
  }
}

/* Pure session creation decision shared by the Worker route and tests. */
export function handleSessionCreate({ ip, now = Date.now() } = {}, deps = {}) {
  const t = now == null ? Date.now() : now;
  if (deps.limiter) {
    const lim = deps.limiter.check({ key: "ip:" + (ip || "unknown"), now: t });
    if (!lim.ok) {
      return { status: 429, body: { error: "rate-limited", retryAfterMs: lim.retryAfterMs } };
    }
  }
  return { status: 200, body: { ok: true } };
}
