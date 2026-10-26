/* kardia-sync.js - Kardia SyncProbe core (contract: prep-data/cxp-briefs/_syncprobe-contract.md).
 *
 * ES5 IIFE, window.KARDIA_SYNC, module.exports under node for the pure parts.
 * Protocol, crypto, session, state machine, transport manager, display-side
 * receiver, probe-side sender and the loopback mock transport. No DOM and no
 * native code are needed for the maths; DOM is only touched by the probe
 * sender when the learner taps Use This Device as Probe.
 *
 * Crypto choice, one everywhere: WebCrypto ECDH P-256 plus HKDF-SHA256 for
 * key derivation, HMAC-SHA256 truncated to 8 bytes to authenticate frames.
 * Frame MAC uses a small pure SHA-256/HMAC over the derived key bytes so
 * encode and decode stay synchronous on the hot pose path; the key itself
 * is always derived through WebCrypto (see deriveSessionKey).
 */
(function (G) {
  "use strict";

  var VERSION = 1;
  var TYPES = { HELLO: 1, WELCOME: 2, POSE: 3, CONTROL: 4, PING: 5, PONG: 6, BYE: 7 };
  var CONTROLS = { PAUSE: 1, RESUME: 2, RECENTER: 3, CALIBRATE: 4, SELECT_WINDOW: 5, END: 6, CONFIRM: 7, DEPTH: 8 };
  var BYE = { NORMAL: 0, CONTROLLER_BUSY: 1, EXPIRED: 2, MAC_FAILURE: 3, USER: 4 };
  var HEADER_LEN = 12, MAC_LEN = 8;
  var PAIRING_TTL_MS = 5 * 60 * 1000;
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var STALE_MS = 500;
  var SHORT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var WINDOW_ORDER = ["parasternal", "apical", "subcostal", "suprasternal", "abdominal", "lung", "oesophageal", "gastric"];
  var FALLBACK_WINDOWS = {
    parasternal: { slideX: [-45, 45], slideY: [-55, 55] }, apical: { slideX: [-35, 35], slideY: [-40, 40] },
    subcostal: { slideX: [-40, 40], slideY: [-45, 45] }, suprasternal: { slideX: [-30, 30], slideY: [-35, 35] },
    abdominal: { slideX: [-60, 60], slideY: [-60, 60] }, lung: { slideX: [-45, 45], slideY: [-60, 60] },
    oesophageal: { slideX: [-25, 25], slideY: [-25, 25] }, gastric: { slideX: [-25, 25], slideY: [-25, 25] }
  };
  var STATES = ["idle", "discovering", "pairing", "confirming", "connecting", "connected", "reconnecting", "disconnected", "failed"];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function nowDefault() { return typeof Date !== "undefined" ? Date.now() : 0; }
  function subtleCrypto() {
    var c = (G && G.crypto) || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    return c && c.subtle ? c : null;
  }
  function randomBytes(n) {
    var c = subtleCrypto() || (G && G.crypto);
    var out = new Uint8Array(n);
    if (c && c.getRandomValues) { c.getRandomValues(out); return out; }
    for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function bytesToHex(b) { var s = ""; for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2); return s; }
  function hexToBytes(h) {
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function b64urlEncode(b) {
    var s = "", i;
    if (typeof Buffer !== "undefined") return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0; i < b.length; i += 3) {
      var a = b[i], bb = i + 1 < b.length ? b[i + 1] : 0, cc = i + 2 < b.length ? b[i + 2] : 0;
      s += chars.charAt(a >> 2) + chars.charAt(((a & 3) << 4) | (bb >> 4)) + (i + 1 < b.length ? chars.charAt(((bb & 15) << 2) | (cc >> 6)) : "=") + (i + 2 < b.length ? chars.charAt(cc & 63) : "=");
    }
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concatBytes(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
  function sessionTagOf(sessionIdBytes) { return sessionIdBytes.length >= 2 ? ((sessionIdBytes[0] << 8) | sessionIdBytes[1]) : 0; }
  function diffU32(a, b) { var d = (a - b) % 4294967296; if (d > 2147483647) d -= 4294967296; if (d < -2147483648) d += 4294967296; return d; }

  /* ---------- pure SHA-256 and HMAC (frame MAC only) ---------- */
  var SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bitLenHi = Math.floor(bytes.length / 536870912), bitLenLo = bytes.length * 8;
    var total = (((bytes.length + 9 + 63) >> 6) << 6);
    var msg = new Uint8Array(total); msg.set(bytes); msg[bytes.length] = 0x80;
    var dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, bitLenLo >>> 0); dv.setUint32(total - 8, bitLenHi >>> 0);
    var w = new Array(64), i, t;
    for (var block = 0; block < total; block += 64) {
      for (t = 0; t < 16; t++) w[t] = dv.getUint32(block + t * 4);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = new Uint8Array(32), od = new DataView(out.buffer);
    for (i = 0; i < 8; i++) od.setUint32(i * 4, H[i] >>> 0);
    return out;
  }
  function hmacSha256(key, data) {
    var k = key.length > 64 ? sha256(key) : key;
    var ipad = new Uint8Array(64), opad = new Uint8Array(64), i;
    for (i = 0; i < 64; i++) { var kb = i < k.length ? k[i] : 0; ipad[i] = kb ^ 0x36; opad[i] = kb ^ 0x5c; }
    return sha256(concatBytes(opad, sha256(concatBytes(ipad, data))));
  }
  function mac8(key, data) { return hmacSha256(key, data).slice(0, MAC_LEN); }
  function macEqual(a, b) { if (!a || !b || a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

  /* ---------- pairing helpers ---------- */
  function makeShortCode(rand) {
    var r = rand || randomBytes(6), s = "";
    for (var i = 0; i < 6; i++) s += SHORT_ALPHABET.charAt(r[i] % SHORT_ALPHABET.length);
    return s;
  }
  function shortCodeHash4(shortCode) { return sha256(new TextEncoder().encode(String(shortCode))).slice(0, 4); }
  function pairingPayload(p) {
    var base = "kardia-sync:1:" + p.sessionId + ":" + p.displayPub + ":" + p.shortCode + ":" + p.expiresAt;
    var roomId = (p.relay && p.relay.roomId) || p.roomId || "";
    var roomToken = (p.relay && p.relay.roomToken) || p.roomToken || "";
    if (roomId && roomToken) base += ":" + roomId + ":" + roomToken;
    return base;
  }
  function parsePairingPayload(str) {
    if (typeof str !== "string") return null;
    var parts = str.split(":");
    if ((parts.length !== 6 && parts.length !== 8) || parts[0] !== "kardia-sync" || parts[1] !== "1") return null;
    if (!/^[0-9a-f]{32}$/i.test(parts[2])) return null;
    var exp = parseInt(parts[5], 10);
    if (!isFinite(exp)) return null;
    var pub;
    try { pub = b64urlDecode(parts[3]); } catch (e) { return null; }
    if (pub.length !== 65 || pub[0] !== 4) return null;
    var out = { sessionId: parts[2].toLowerCase(), displayPub: parts[3], displayPubBytes: pub, shortCode: parts[4], expiresAt: exp };
    if (parts.length === 8) {
      if (!/^[0-9a-f]{32}$/i.test(parts[6]) || !/^[A-Za-z0-9_-]{32,64}$/.test(parts[7])) return null;
      out.roomId = parts[6].toLowerCase(); out.roomToken = parts[7];
      out.relay = { roomId: out.roomId, roomToken: out.roomToken };
    }
    return out;
  }
  /* Map any transport or relay error to a stable reason code the UI can
   * turn into a specific message and one next action. */
  function transportErrorReason(err) {
    if (!err) return "unknown";
    if (err.reason) return String(err.reason);
    if (err.code && typeof err.code === "string" && err.code !== "not-found") return err.code;
    var m = String((err && err.message) || err || "");
    if (/sign-in required|sign in required|401|unauthori[sz]ed/i.test(m)) return "sign-in-required";
    if (/expired|credential-expired|gone/i.test(m)) return "expired";
    if (/controller-busy|already training|room_full|busy/i.test(m)) return "busy";
    if (/not-found|no display found|no display/i.test(m)) return "not-found";
    if (/rate-limit|too many|429/i.test(m)) return "rate-limited";
    if (/permission|denied|not authorized/i.test(m) && /bluetooth|ble/i.test(m)) return "bluetooth-permission";
    if (/bluetooth is (off|not available|powered off)|poweredoff/i.test(m)) return "bluetooth-off";
    if (/bluetooth/i.test(m) && /not available|only available in the app|needs the latest app/i.test(m)) return "bluetooth-unavailable";
    if (/relay|pairing service|session creation failed|code lookup failed|websocket connection|websocket closed|failed to fetch|fetch api unavailable|networkerror|load failed/i.test(m)) return "relay-unreachable";
    if (/offline|no internet|internet connection required|network/i.test(m)) return "offline";
    if (/bad-version|version mismatch|protocol/i.test(m)) return "version-mismatch";
    if (/no-transport|no link is available/i.test(m)) return "no-transport";
    if (/invalid pairing|bad-pairing|scan the qr/i.test(m)) return "bad-code";
    return "unknown";
  }
  function reasonError(reason, message) { var e = new Error(message || reason); e.reason = reason; e.code = reason; return e; }
  function confirmCodeFromBytes(b) {
    var v = ((b[0] << 8) | b[1]) % 10000;
    return ("000" + v).slice(-4);
  }

  /* ---------- WebCrypto key derivation ---------- */
  function generateKeyPair() {
    var c = subtleCrypto();
    if (!c) return Promise.reject(new Error("WebCrypto unavailable"));
    return c.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]).then(function (kp) {
      return c.subtle.exportKey("raw", kp.publicKey).then(function (raw) {
        return { keyPair: kp, publicKeyBytes: new Uint8Array(raw), publicKeyB64: b64urlEncode(new Uint8Array(raw)) };
      });
    });
  }
  function deriveSessionKey(ownPrivateKey, peerPubBytes, sessionIdBytes) {
    var c = subtleCrypto();
    if (!c) return Promise.reject(new Error("WebCrypto unavailable"));
    return c.subtle.importKey("raw", peerPubBytes, { name: "ECDH", namedCurve: "P-256" }, false, []).then(function (peerKey) {
      return c.subtle.deriveBits({ name: "ECDH", public: peerKey }, ownPrivateKey, 256);
    }).then(function (secretBuf) {
      var secret = new Uint8Array(secretBuf);
      function hkdf(info) {
        return c.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]).then(function (base) {
          return c.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sessionIdBytes, info: new TextEncoder().encode(info) }, base, 256);
        });
      }
      return Promise.all([hkdf("kardia-sync-v1"), hkdf("confirm")]).then(function (r) {
        return { key: new Uint8Array(r[0]), confirmCode: confirmCodeFromBytes(new Uint8Array(r[1])) };
      });
    });
  }

  /* ---------- frames ---------- */
  function windowIndexOf(win) {
    if (typeof win === "number") return clamp(Math.round(win), 0, WINDOW_ORDER.length - 1);
    var i = WINDOW_ORDER.indexOf(win);
    return i >= 0 ? i : 0;
  }
  function windowIdOf(idx) { return WINDOW_ORDER[clamp(idx || 0, 0, WINDOW_ORDER.length - 1)]; }
  function windowClamps(winId, probeLib) {
    if (probeLib && probeLib.WINDOWS && probeLib.WINDOWS[winId]) {
      var w = probeLib.WINDOWS[winId];
      return { slideX: w.slideX, slideY: w.slideY };
    }
    return FALLBACK_WINDOWS[winId] || FALLBACK_WINDOWS.parasternal;
  }
  function poseFlagsByte(pose) {
    if (typeof pose.flags === "number") return pose.flags & 255;
    var f = pose.flags || {};
    return (pose.paused || f.paused ? 1 : 0) | (f.recenter ? 2 : 0) | (f.calibrated || pose.calibrated ? 4 : 0);
  }
  function clampPose(pose, probeLib) {
    var winId = windowIdOf(windowIndexOf(pose.window != null ? pose.window : pose.windowId));
    var c = windowClamps(winId, probeLib);
    var q = (pose.quat || pose.quaternion || [0, 0, 0, 1]).slice();
    var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
    for (var i = 0; i < 4; i++) q[i] = q[i] / n;
    return {
      quat: q, touch: (pose.touch || 0) & 255, window: winId, windowIndex: windowIndexOf(winId),
      slideXmm: clamp(+pose.slideXmm || 0, c.slideX[0], c.slideX[1]),
      slideYmm: clamp(+pose.slideYmm || 0, c.slideY[0], c.slideY[1]),
      flags: poseFlagsByte(pose),
      paused: !!(poseFlagsByte(pose) & 1), recenter: !!(poseFlagsByte(pose) & 2), calibrated: !!(poseFlagsByte(pose) & 4)
    };
  }
  function validatePose(pose, probeLib) {
    var q = pose.quat || pose.quaternion;
    if (!q || q.length !== 4) return { ok: false, reason: "bad-quaternion" };
    var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (!(n >= 0.9 && n <= 1.1)) return { ok: false, reason: "quaternion-norm" };
    var winId = windowIdOf(windowIndexOf(pose.window != null ? pose.window : pose.windowIndex));
    var c = windowClamps(winId, probeLib);
    var sx = pose.slideXmm != null ? pose.slideXmm : pose.slideX, sy = pose.slideYmm != null ? pose.slideYmm : pose.slideY;
    if (!(sx >= c.slideX[0] - 1e-9 && sx <= c.slideX[1] + 1e-9)) return { ok: false, reason: "slideX-out-of-bounds" };
    if (!(sy >= c.slideY[0] - 1e-9 && sy <= c.slideY[1] + 1e-9)) return { ok: false, reason: "slideY-out-of-bounds" };
    return { ok: true, reason: null };
  }
  function encodeFrame(frame, key) {
    var type = frame.type, body;
    if (type === TYPES.HELLO) {
      body = new Uint8Array(77); body.set(frame.probePub.slice(0, 65), 0); body.set(frame.nonce.slice(0, 12), 65);
    } else if (type === TYPES.WELCOME) {
      body = new Uint8Array(14); body[0] = frame.controllerId & 255; body[1] = frame.confirmHint & 255; body.set(frame.nonce.slice(0, 12), 2);
    } else if (type === TYPES.POSE) {
      body = new Uint8Array(15); var dv = new DataView(body.buffer), i;
      var q = frame.pose.quat;
      for (i = 0; i < 4; i++) dv.setInt16(i * 2, clamp(Math.round(q[i] * 32767), -32767, 32767), true);
      body[8] = frame.pose.touch & 255; body[9] = windowIndexOf(frame.pose.window) & 255;
      dv.setInt16(10, clamp(Math.round(frame.pose.slideXmm * 10), -32768, 32767), true);
      dv.setInt16(12, clamp(Math.round(frame.pose.slideYmm * 10), -32768, 32767), true);
      body[14] = frame.pose.flags & 255;
    } else if (type === TYPES.CONTROL) {
      body = new Uint8Array(3); body[0] = frame.code & 255; new DataView(body.buffer).setUint16(1, frame.arg || 0, true);
    } else if (type === TYPES.PING) {
      body = new Uint8Array(4); new DataView(body.buffer).setUint32(0, frame.tMs >>> 0, true);
    } else if (type === TYPES.PONG) {
      body = new Uint8Array(8); var pd = new DataView(body.buffer);
      pd.setUint32(0, frame.echoTms >>> 0, true); pd.setUint32(4, frame.tMs >>> 0, true);
    } else if (type === TYPES.BYE) {
      body = new Uint8Array(1); body[0] = frame.reason & 255;
    } else { body = frame.body || new Uint8Array(0); }
    var hasMac = type !== TYPES.HELLO;
    var out = new Uint8Array(HEADER_LEN + body.length + (hasMac ? MAC_LEN : 0));
    var hv = new DataView(out.buffer);
    out[0] = VERSION; out[1] = type;
    hv.setUint32(2, frame.seq >>> 0, true); hv.setUint32(6, frame.tMs >>> 0, true); hv.setUint16(10, frame.sessionTag & 65535, true);
    out.set(body, HEADER_LEN);
    if (hasMac) {
      if (!key) throw new Error("session key required");
      out.set(mac8(key, out.slice(0, HEADER_LEN + body.length)), HEADER_LEN + body.length);
    }
    return out;
  }
  function decodeFrame(bytes, key) {
    if (!bytes || bytes.length < HEADER_LEN) return { ok: false, reason: "too-short" };
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var version = b[0], type = b[1];
    if (version !== VERSION) return { ok: false, reason: "bad-version" };
    var frame = { version: version, type: type, seq: dv.getUint32(2, true), tMs: dv.getUint32(6, true), sessionTag: dv.getUint16(10, true) };
    var hasMac = type !== TYPES.HELLO;
    if (hasMac) {
      if (b.length < HEADER_LEN + MAC_LEN) return { ok: false, reason: "too-short" };
      if (key) {
        var expect = mac8(key, b.slice(0, b.length - MAC_LEN));
        if (!macEqual(expect, b.slice(b.length - MAC_LEN))) return { ok: false, reason: "mac-failure", frame: frame };
      } else { frame.macVerified = false; }
      frame.macVerified = !!key;
    }
    var body = b.slice(HEADER_LEN, hasMac ? b.length - MAC_LEN : b.length);
    var bd = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (type === TYPES.HELLO) {
      if (body.length !== 77) return { ok: false, reason: "bad-hello" };
      frame.probePub = body.slice(0, 65); frame.nonce = body.slice(65, 77);
    } else if (type === TYPES.WELCOME) {
      if (body.length !== 14) return { ok: false, reason: "bad-welcome" };
      frame.controllerId = body[0]; frame.confirmHint = body[1]; frame.nonce = body.slice(2, 14);
    } else if (type === TYPES.POSE) {
      if (body.length !== 15) return { ok: false, reason: "bad-pose" };
      var q = [], i;
      for (i = 0; i < 4; i++) q.push(bd.getInt16(i * 2, true) / 32767);
      var flags = body[14];
      frame.pose = { quat: q, touch: body[8], windowIndex: body[9], window: windowIdOf(body[9]), slideXmm: bd.getInt16(10, true) / 10, slideYmm: bd.getInt16(12, true) / 10, flags: flags, paused: !!(flags & 1), recenter: !!(flags & 2), calibrated: !!(flags & 4) };
    } else if (type === TYPES.CONTROL) {
      if (body.length !== 3) return { ok: false, reason: "bad-control" };
      frame.code = body[0]; frame.arg = bd.getUint16(1, true);
    } else if (type === TYPES.PING) {
      if (body.length !== 4) return { ok: false, reason: "bad-ping" };
      frame.echoTms = bd.getUint32(0, true);
    } else if (type === TYPES.PONG) {
      if (body.length !== 8) return { ok: false, reason: "bad-pong" };
      frame.echoTms = bd.getUint32(0, true); frame.pongTms = bd.getUint32(4, true);
    } else if (type === TYPES.BYE) {
      if (body.length !== 1) return { ok: false, reason: "bad-bye" };
      frame.reason = body[0];
    } else { frame.body = body; }
    return { ok: true, frame: frame };
  }

  /* ---------- quaternion and critically damped smoothing ---------- */
  function quatNormalize(q) { var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
  function quatConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
  function quatMul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function quatFromEuler(tiltDeg, rotationDeg, rockDeg) {
    function qAxis(ax, deg) { var h = deg * Math.PI / 360, s = Math.sin(h); var q = [0, 0, 0, Math.cos(h)]; q[ax] = s; return q; }
    return quatNormalize(quatMul(quatMul(qAxis(1, tiltDeg), qAxis(2, rotationDeg)), qAxis(0, rockDeg)));
  }
  function eulerFromQuat(q0) {
    var q = quatNormalize(q0), x = q[0], y = q[1], z = q[2], w = q[3];
    var tilt = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
    var s = clamp(2 * (w * x - z * y), -1, 1);
    var rock = Math.asin(s);
    var rot = Math.atan2(2 * (w * z + x * y), 1 - 2 * (z * z + x * x));
    function d(r) { return r * 180 / Math.PI; }
    return { tiltDeg: d(tilt), rotationDeg: d(rot), rockDeg: d(rock) };
  }
  function createSmoother(tauMs) {
    var tau = tauMs || 60, cur = null, vel = { tiltDeg: 0, rotationDeg: 0, rockDeg: 0, x: 0, y: 0 };
    function stepField(k, target, dt) {
      var omega = 2 / tau;
      var f = 1 / (1 + omega * dt + 0.48 * omega * omega * dt * dt + 0.235 * omega * omega * omega * dt * dt * dt);
      var change = cur[k] - target;
      var temp = (vel[k] + omega * change) * dt;
      vel[k] = (vel[k] - omega * temp) * f;
      var out = target + (change + temp) * f;
      cur[k] = out;
      return out;
    }
    return {
      reset: function (state) { cur = { tiltDeg: state.tiltDeg || 0, rotationDeg: state.rotationDeg || 0, rockDeg: state.rockDeg || 0, x: state.x || 0, y: state.y || 0 }; vel = { tiltDeg: 0, rotationDeg: 0, rockDeg: 0, x: 0, y: 0 }; return this.current(); },
      current: function () { return cur ? { tiltDeg: cur.tiltDeg, rotationDeg: cur.rotationDeg, rockDeg: cur.rockDeg, x: cur.x, y: cur.y } : null; },
      step: function (target, dtMs) {
        if (!cur) return this.reset(target);
        var dt = clamp(dtMs == null ? 16 : dtMs, 1, 100);
        stepField("tiltDeg", target.tiltDeg || 0, dt); stepField("rotationDeg", target.rotationDeg || 0, dt);
        stepField("rockDeg", target.rockDeg || 0, dt); stepField("x", target.x || 0, dt); stepField("y", target.y || 0, dt);
        return this.current();
      }
    };
  }
  function scanBackoffMs(attempt) { return Math.min(2000 * Math.pow(2, Math.max(0, attempt || 0)), 15000); }
  function healthScore(stats) {
    if (!stats) return 0;
    var rtt = stats.rttMs == null ? 999 : stats.rttMs, loss = stats.lossPct || 0;
    var score = 100 - clamp((rtt - 50) / 5, 0, 40) - clamp(loss * 3, 0, 60);
    if (stats.lastRecvAt == null) score -= 10;
    return Math.round(clamp(score, 0, 100));
  }
  function isHealthy(stats) { return !!stats && (stats.rttMs == null || stats.rttMs <= 250) && (stats.lossPct || 0) <= 10 && healthScore(stats) >= 50; }

  /* ---------- capability detection ---------- */
  function detectCapabilities(env) {
    var e = env || G || {};
    var c = e.crypto || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    var hasOrientation = typeof e.DeviceOrientationEvent !== "undefined" || typeof e.DeviceMotionEvent !== "undefined";
    var needsPermission = false;
    try { needsPermission = !!(e.DeviceOrientationEvent && typeof e.DeviceOrientationEvent.requestPermission === "function") || !!(e.DeviceMotionEvent && typeof e.DeviceMotionEvent.requestPermission === "function"); } catch (x) {}
    var platform = "web";
    try {
      var cap = e.Capacitor;
      if (cap && typeof cap.getPlatform === "function") platform = cap.getPlatform();
      else if (e.navigator && /iphone|ipad|ipod/i.test(e.navigator.userAgent || "")) platform = "ios";
      else if (e.navigator && /android/i.test(e.navigator.userAgent || "")) platform = "android";
    } catch (x2) {}
    return {
      hasWebCrypto: !!(c && c.subtle && typeof c.subtle.generateKey === "function"),
      hasDeviceOrientation: hasOrientation,
      needsIosPermission: needsPermission,
      canUseProbeSensor: hasOrientation,
      platform: platform
    };
  }

  /* ---------- transport registry ---------- */
  var registry = {};
  function registerTransport(t) {
    if (!t || !t.id) throw new Error("transport id required");
    var fns = ["capabilities", "host", "join", "send", "close", "stats"], i;
    for (i = 0; i < fns.length; i++) if (typeof t[fns[i]] !== "function") throw new Error("transport missing " + fns[i]);
    registry[t.id] = t;
    return t;
  }
  function getTransport(id) { return registry[id] || null; }
  function listTransports() { var out = []; for (var k in registry) if (Object.prototype.hasOwnProperty.call(registry, k)) out.push(registry[k]); return out; }
  function transportPriority(t) { if (t.kind === "direct") return t.id === "ble" ? 0 : 1; return 2; }
  function queryCapabilities(transports) {
    return Promise.all(transports.map(function (t) {
      return Promise.resolve().then(function () { return t.capabilities(); }).then(function (caps) { return { transport: t, caps: caps }; }, function () { return { transport: t, caps: { available: false, reason: "capabilities-failed" } }; });
    }));
  }
  function selectTransport(transports) {
    return queryCapabilities(transports).then(function (rows) {
      var avail = rows.filter(function (r) { return r.caps && r.caps.available; });
      avail.sort(function (a, b) { return transportPriority(a.transport) - transportPriority(b.transport); });
      return avail.length ? avail[0] : null;
    });
  }

  /* ---------- transport manager: health, hysteresis, fallback, scan back-off ---------- */
  function createTransportManager(opts) {
    opts = opts || {};
    var nowFn = opts.now || nowDefault;
    var transports = opts.transports || null;
    var active = null, activeSince = 0, unhealthySince = null, directHealthySince = null, scanning = false, scanAttempt = 0;
    var onSwitch = opts.onSwitch || function () {};
    function all() { return transports || listTransports(); }
    function findById(id) { var a = all(), i; for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
    var mgr = {
      get active() { return active; },
      get scanning() { return scanning; },
      register: function (t) { registerTransport(t); if (!transports) transports = listTransports(); else if (transports.indexOf(t) < 0) transports.push(t); return t; },
      list: all,
      select: function () { return selectTransport(all()); },
      startScan: function () { if (scanning) return false; scanning = true; return true; },
      endScan: function (success) { scanning = false; scanAttempt = success ? 0 : scanAttempt + 1; return scanBackoffMs(scanAttempt); },
      scanBackoffMs: function () { return scanBackoffMs(scanAttempt); },
      getScanAttempt: function () { return scanAttempt; },
      setActive: function (t, when) { active = t; activeSince = when == null ? nowFn() : when; unhealthySince = null; directHealthySince = null; return active; },
      healthOf: function (t) { try { return t.stats(); } catch (e) { return null; } },
      evaluate: function (when) {
        var now = when == null ? nowFn() : when;
        if (!active) return { switched: false, active: null };
        var stats = mgr.healthOf(active);
        if (isHealthy(stats)) { unhealthySince = null; }
        else if (unhealthySince == null) unhealthySince = now;
        var rows = all(), i, bestRelay = null, bestDirect = null;
        for (i = 0; i < rows.length; i++) {
          if (rows[i] === active) continue;
          var s = mgr.healthOf(rows[i]);
          if (!isHealthy(s)) continue;
          if (rows[i].kind === "direct" && !bestDirect) bestDirect = rows[i];
          if (rows[i].kind === "relay" && !bestRelay) bestRelay = rows[i];
        }
        if (active.kind === "relay") {
          if (bestDirect) {
            if (directHealthySince == null) directHealthySince = now;
            if (now - directHealthySince >= 20000) {
              var fromR = active; mgr.setActive(bestDirect, now); onSwitch(fromR, bestDirect, "direct-healthy-20s");
              return { switched: true, from: fromR, to: bestDirect, reason: "direct-healthy-20s" };
            }
          } else directHealthySince = null;
        }
        if (unhealthySince != null && now - unhealthySince >= 4000) {
          var target = active.kind === "direct" ? bestRelay : (bestDirect || bestRelay);
          if (target) {
            var from = active; mgr.setActive(target, now); onSwitch(from, target, "unhealthy-4s");
            return { switched: true, from: from, to: target, reason: "unhealthy-4s" };
          }
        }
        return { switched: false, active: active, unhealthyForMs: unhealthySince == null ? 0 : now - unhealthySince };
      },
      tick: function (when) { return mgr.evaluate(when); }
    };
    return mgr;
  }

  /* ---------- raced transport: BLE and relay in parallel ----------
   * host() and join() start on every candidate at once. The first one to
   * succeed becomes active; the others stay open as backup (send falls
   * back to a backup when the active send fails) and are closed only by
   * close(). If every candidate fails, the rejection carries the reason
   * of the most specific failure (sign-in and Bluetooth before unknown). */
  var REASON_RANK = { "sign-in-required": 1, "bluetooth-off": 2, "bluetooth-permission": 3, "offline": 4, "relay-unreachable": 5, "not-found": 6, "expired": 7, "busy": 8, "bluetooth-unavailable": 9, "no-transport": 10, "unknown": 11 };
  function bestReasonError(errs) {
    var best = null, bestRank = 99;
    (errs || []).forEach(function (e) {
      var r = transportErrorReason(e), rank = REASON_RANK[r] || 9;
      if (rank < bestRank) { bestRank = rank; best = reasonError(r, (e && e.message) || r); best.causes = errs; }
    });
    return best || reasonError("unknown", "No link is available on this phone.");
  }
  function raceFirstSuccess(candidates, startFn) {
    var list = (candidates || []).slice();
    if (!list.length) return Promise.reject(reasonError("no-transport", "No link is available on this phone."));
    return new Promise(function (resolve, reject) {
      var pending = list.length, errs = [], settled = false;
      list.forEach(function (t, idx) {
        var job;
        try { job = startFn(t, idx); } catch (e) { job = Promise.reject(e); }
        Promise.resolve(job).then(function (v) {
          if (settled) return;
          settled = true;
          resolve({ transport: t, index: idx, value: v });
        }, function (e) {
          errs.push(e);
          if (--pending === 0 && !settled) reject(bestReasonError(errs));
        });
      });
    });
  }
  function createRacedTransport(candidates) {
    var list = (candidates || []).slice();
    var active = null;
    function race(method, pairing, handlers) {
      if (!list.length) return Promise.reject(reasonError("no-transport", "No link is available on this phone."));
      if (list.length === 1) {
        return Promise.resolve(list[0][method](pairing, handlers)).then(function (v) { active = list[0]; return v; });
      }
      return raceFirstSuccess(list, function (t) { return t[method](pairing, handlers); }).then(function (r) {
        active = r.transport;
        return r.value;
      });
    }
    var raced = {
      id: "raced", kind: "direct",
      candidates: list,
      activeId: function () { return active ? active.id : null; },
      backupIds: function () { return list.filter(function (t) { return t !== active; }).map(function (t) { return t.id; }); },
      capabilities: function () {
        return Promise.all(list.map(function (t) {
          return Promise.resolve(t.capabilities()).then(function (c) { return c; }, function () { return { available: false }; });
        })).then(function (caps) {
          var any = caps.some(function (c) { return c && c.available; });
          return { available: any, canAdvertise: any, canScan: any, needsInternet: false, maxPayload: 512, platform: "web", perTransport: caps };
        });
      },
      host: function (p, h) { return race("host", p, h); },
      join: function (p, h) { return race("join", p, h); },
      send: function (bytes) {
        if (active) { try { if (active.send(bytes)) return true; } catch (e) {} }
        for (var i = 0; i < list.length; i++) {
          if (list[i] === active) continue;
          try { if (list[i].send(bytes)) { active = list[i]; return true; } } catch (e) {}
        }
        return false;
      },
      close: function (reason) {
        var jobs = list.map(function (t) { try { return Promise.resolve(t.close(reason)); } catch (e) { return Promise.resolve(); } });
        active = null;
        return Promise.all(jobs).then(function () {});
      },
      stats: function () { try { return active ? active.stats() : { rttMs: 0, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null }; } catch (e) { return { rttMs: 0, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null }; } }
    };
    var withDiscover = list.filter(function (t) { return typeof t.discover === "function"; });
    if (withDiscover.length) raced.discover = function (code) { return withDiscover[0].discover(code); };
    var withNearby = list.filter(function (t) { return typeof t.discoverNearby === "function"; });
    if (withNearby.length) raced.discoverNearby = function (ms) { return withNearby[0].discoverNearby(ms); };
    var withByHash = list.filter(function (t) { return typeof t.discoverByHash === "function"; });
    if (withByHash.length) raced.discoverByHash = function (h) { return withByHash[0].discoverByHash(h); };
    return raced;
  }

  /* ---------- loopback mock transport ---------- */
  function createLoopbackPair(opts) {
    opts = opts || {};
    var faults = { loss: opts.loss || 0, delayMs: opts.delayMs || 0, duplicate: !!opts.duplicate, duplicateProb: opts.duplicateProb, reorder: !!opts.reorder, random: opts.random || Math.random };
    var pair = [];
    function make(id) {
      var handlers = null, peer = null, sent = 0, recv = 0, toggle = false, closed = false;
      var t = {
        id: id, kind: opts.kind || "direct",
        _setPeer: function (p) { peer = p; },
        _setFaults: function (f) { for (var k in f) faults[k] = f[k]; },
        _handlers: function () { return handlers; },
        capabilities: function () {
          return Promise.resolve({ available: !closed, canAdvertise: true, canScan: true, needsInternet: false, maxPayload: 512, platform: "web" });
        },
        host: function (pairing, h) { handlers = h; closed = false; return Promise.resolve(); },
        join: function (pairing, h) {
          handlers = h; closed = false;
          var other = peer && peer._handlers();
          if (other && other.onPeerConnected) other.onPeerConnected({ transport: id });
          if (h && h.onPeerConnected) h.onPeerConnected({ transport: peer ? peer.id : "loopback" });
          return Promise.resolve();
        },
        send: function (bytes) {
          if (closed || !peer || !peer._handlers()) return false;
          sent++;
          var deliver = function () {
            if (faults.loss && faults.random() < faults.loss) return;
            var ph = peer._handlers(); if (!ph || !ph.onBytes) return;
            recv++; ph.onBytes(bytes);
            if (faults.duplicate || (faults.duplicateProb && faults.random() < faults.duplicateProb)) ph.onBytes(bytes);
          };
          var delay = faults.delayMs || 0;
          if (faults.reorder) { toggle = !toggle; delay += toggle ? 6 : 0; }
          if (delay > 0 || faults.reorder) setTimeout(deliver, delay); else deliver();
          return true;
        },
        close: function () {
          closed = true;
          var ph = peer && peer._handlers();
          if (ph && ph.onPeerLost) ph.onPeerLost("closed");
          return Promise.resolve();
        },
        stats: function () { return { rttMs: opts.rttMs == null ? 5 : opts.rttMs, lossPct: Math.round(faults.loss * 100), sentPerSec: sent, recvPerSec: recv, lastRecvAt: recv ? nowDefault() : null, sent: sent, recv: recv }; }
      };
      pair.push(t);
      return t;
    }
    var a = make(opts.idA || "loopback-a"), b = make(opts.idB || "loopback");
    a._setPeer(b); b._setPeer(a);
    return [a, b];
  }

  /* ---------- session node: state machine, display receiver, probe sender core ---------- */
  function createNode(opts) {
    opts = opts || {};
    var role = opts.role || "display";
    var nowFn = opts.now || nowDefault;
    var probeLib = opts.probeLib || (G && G.KARDIA_PROBE) || null;
    var echoLab = opts.echoLab || null;
    var onState = opts.onState || function () {};
    var onWarning = opts.onWarning || function () {};
    var state = "idle", stateReason = null, recoveryHint = null;
    var pairing = null, ownKeys = null, sessionKey = null, confirmCode = null;
    var sessionIdBytes = null, sessionTag = 0, peerPubBytes = null;
    var seqOut = 0, lastSeqIn = 0, seqSeen = {};
    var controllerActive = false, controllerId = 0, confirmedLocal = false, confirmedPeer = false;
    var clockOffsetMs = null, lastActivityAt = nowFn(), lastPoseAt = 0, lastRenderAt = 0;
    var frozen = false, frozenReason = null, pendingPose = null, lastValidPose = null, lastValidState = null;
    var displayProbe = null, smoother = createSmoother(opts.tauMs || 60), calibQuat = null, calibBase = null, needsCalib = true;
    var lastDepthCm = null;
    var resumeArmed = false;
    var transport = null, destroyed = false, rejectedHellos = 0, statsIn = { accepted: 0, droppedMac: 0, droppedSeq: 0, droppedStale: 0, droppedBounds: 0, droppedSession: 0, droppedFrozen: 0 };
    var monoStart = nowFn();
    function monoMs() { return (nowFn() - monoStart) >>> 0; }
    function setState(next, reason, hint) {
      if (STATES.indexOf(next) < 0) throw new Error("bad state " + next);
      var prev = state; state = next; stateReason = reason || null; recoveryHint = hint || null;
      if (prev !== next) onState(next, prev, reason || null);
      return state;
    }
    function failWith(reason, hint) { setState("failed", reason, hint || "Try pairing again."); return node; }
    function wipeKeys() { sessionKey = null; confirmCode = null; }
    function nextSeq() { seqOut = (seqOut + 1) >>> 0; if (seqOut === 0) seqOut = 1; return seqOut; }
    function sendBytes(bytes) { if (!transport) return false; try { return !!transport.send(bytes); } catch (e) { return false; } }
    function sendFrame(frame, keyOverride) {
      frame.seq = nextSeq(); frame.tMs = monoMs(); frame.sessionTag = sessionTag;
      return sendBytes(encodeFrame(frame, keyOverride || sessionKey));
    }
    function ensureDisplayProbe() {
      if (!displayProbe && probeLib && typeof probeLib.create === "function") {
        displayProbe = probeLib.create({});
        try { displayProbe.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 }); } catch (e) {}
      }
      return displayProbe;
    }
    function handleHello(frame) {
      if (role !== "display") return Promise.resolve(false);
      if (controllerActive) {
        rejectedHellos++;
        try { sendFrame({ type: TYPES.BYE, reason: BYE.CONTROLLER_BUSY }, sessionKey); } catch (e) {}
        return Promise.resolve(false);
      }
      if (!pairing || !ownKeys) { failWith("hello-without-pairing", "Show the pairing code first."); return Promise.resolve(false); }
      if (nowFn() > pairing.expiresAt) { failWith("credential-expired", "The pairing code has expired. Show a new code."); return Promise.resolve(false); }
      if (frame.sessionTag !== sessionTag) { statsIn.droppedSession++; return Promise.resolve(false); }
      peerPubBytes = frame.probePub;
      return deriveSessionKey(ownKeys.keyPair.privateKey, peerPubBytes, sessionIdBytes).then(function (derived) {
        sessionKey = derived.key; confirmCode = derived.confirmCode;
        controllerActive = true; controllerId = 1; confirmedLocal = false; confirmedPeer = false;
        lastActivityAt = nowFn();
        setState("confirming", "hello");
        sendFrame({ type: TYPES.WELCOME, controllerId: controllerId, confirmHint: parseInt(confirmCode.slice(0, 2), 10) || 0, nonce: randomBytes(12) });
        return true;
      });
    }
    function checkSeqAndStale(frame) {
      if (frame.seq <= lastSeqIn || seqSeen[frame.seq]) { statsIn.droppedSeq++; return false; }
      if (clockOffsetMs != null) {
        var corrected = frame.tMs + clockOffsetMs;
        var age = diffU32((monoMs() >>> 0), corrected >>> 0);
        if (age > STALE_MS) { statsIn.droppedStale++; return false; }
      }
      return true;
    }
    function acceptSeq(frame) { seqSeen[frame.seq] = 1; if (frame.seq > lastSeqIn) lastSeqIn = frame.seq; }
    function poseToDisplayState(pose) {
      var dp = ensureDisplayProbe();
      var target;
      if (dp) {
        if (dp.getState().window !== pose.window) {
          try { dp.setState({ window: pose.window }); } catch (e0) {}
          needsCalib = true; calibQuat = null;
        }
        if (needsCalib || !calibQuat) {
          calibQuat = pose.quat.slice(); needsCalib = false;
          try { dp.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 }); } catch (e) {}
          calibBase = dp.getState();
        }
        var rel = quatNormalize(quatMul(quatConj(calibQuat), pose.quat));
        var eu = eulerFromQuat(rel);
        var ps;
        if (probeLib && typeof probeLib.isTeeWindow === "function" && probeLib.isTeeWindow(pose.window)) {
          try { dp.applyGyroSample({ alpha: eu.rockDeg, beta: eu.tiltDeg, gamma: eu.rotationDeg }, 16); } catch (e2) {}
          ps = dp.getState();
        } else {
          // No second low-pass here: the probe already filtered its samples,
          // and re-filtering on the display doubled the lag. Set the target
          // directly from the relative euler angles off the calibrate base.
          var base = calibBase || dp.getState();
          try { ps = dp.setState({ tiltDeg: base.tiltDeg + eu.tiltDeg, rotationDeg: base.rotationDeg + eu.rotationDeg, rockDeg: base.rockDeg + eu.rockDeg }); }
          catch (e2) { ps = dp.getState(); }
        }
        target = { window: pose.window, tiltDeg: ps.tiltDeg, rotationDeg: ps.rotationDeg, rockDeg: ps.rockDeg, x: pose.slideXmm, y: pose.slideYmm, raw: { tiltDeg: eu.tiltDeg, rotationDeg: eu.rotationDeg, rockDeg: eu.rockDeg } };
      } else {
        var eu2 = eulerFromQuat(quatNormalize(pose.quat));
        target = { window: pose.window, tiltDeg: eu2.tiltDeg, rotationDeg: eu2.rotationDeg, rockDeg: eu2.rockDeg, x: pose.slideXmm, y: pose.slideYmm, raw: eu2 };
      }
      return target;
    }
    var node = {
      get role() { return role; },
      get state() { return state; },
      get frozen() { return frozen; },
      get confirmCode() { return confirmCode; },
      get sessionKey() { return sessionKey; },
      get pairing() { return pairing; },
      get stats() { return statsIn; },
      get lastValidPose() { return lastValidPose; },
      get lastValidState() { return lastValidState; },
      get clockOffsetMs() { return clockOffsetMs; },
      get rejectedHellos() { return rejectedHellos; },
      getState: function () {
        return { state: state, reason: stateReason, recoveryHint: recoveryHint, role: role, frozen: frozen, frozenReason: frozenReason, resumeArmed: resumeArmed, confirmCode: confirmCode, sessionId: sessionIdBytes ? bytesToHex(sessionIdBytes) : null, controllerActive: controllerActive, lastSeqIn: lastSeqIn, seqOut: seqOut, clockOffsetMs: clockOffsetMs, depthCm: lastDepthCm };
      },
      setStateForTest: function (s, r) { return setState(s, r); },
      attachTransport: function (t) { transport = t; return node; },
      getTransport: function () { return transport; },
      createPairing: function () {
        if (role !== "display") return Promise.reject(new Error("only display creates pairing"));
        return generateKeyPair().then(function (keys) {
          ownKeys = keys;
          sessionIdBytes = randomBytes(16); sessionTag = sessionTagOf(sessionIdBytes);
          var shortCode = makeShortCode();
          pairing = { sessionId: bytesToHex(sessionIdBytes), shortCode: shortCode, displayPub: keys.publicKeyB64, displayPubBytes: keys.publicKeyBytes, expiresAt: nowFn() + PAIRING_TTL_MS, codeHashHex: bytesToHex(shortCodeHash4(shortCode)) };
          pairing.payload = pairingPayload(pairing);
          setState("pairing", "pairing-created");
          return pairing;
        });
      },
      hostWith: function (t, transportsPairing) {
        transport = t;
        var p = transportsPairing || pairing;
        var handlers = node._handlers();
        return Promise.resolve(t.host(p, handlers)).then(function () { if (state === "idle") setState("pairing", "hosting"); return node; });
      },
      joinPairing: function (input, t) {
        if (t) transport = t;
        var parsed = typeof input === "string" && input.indexOf("kardia-sync:") === 0 ? parsePairingPayload(input) : input;
        if (!parsed) { failWith("bad-pairing-payload", "Scan the QR code again."); return Promise.resolve(node); }
        if (nowFn() > parsed.expiresAt) { failWith("credential-expired", "The pairing code has expired. Ask for a new code."); return Promise.resolve(node); }
        pairing = parsed; sessionIdBytes = hexToBytes(parsed.sessionId); sessionTag = sessionTagOf(sessionIdBytes);
        setState("discovering", "joining");
        return generateKeyPair().then(function (keys) {
          ownKeys = keys; peerPubBytes = parsed.displayPubBytes || b64urlDecode(parsed.displayPub);
          setState("pairing", "hello");
          return deriveSessionKey(keys.keyPair.privateKey, peerPubBytes, sessionIdBytes).then(function (derived) {
            /* Probe derives early only to show the confirmation number.
             * The display derives on HELLO and both must match. The probe
             * keeps its key; the HELLO itself carries no MAC. */
            var probeDerived = derived;
            /* Do not adopt the key for MAC until WELCOME verifies: store pending. */
            node._pendingKey = probeDerived.key; node._pendingConfirm = probeDerived.confirmCode;
            sessionKey = probeDerived.key; confirmCode = probeDerived.confirmCode;
            var handlers = node._handlers();
            var hello = { type: TYPES.HELLO, seq: nextSeq(), tMs: monoMs(), sessionTag: sessionTag, probePub: keys.publicKeyBytes, nonce: randomBytes(12) };
            var helloBytes = encodeFrame(hello, null);
            node._lastHelloBytes = helloBytes; node._helloSent = false;
            if (transport) {
              /* Bluetooth join resolves when the scan starts, before the link
               * is up, so this first send can fail; onPeerConnected resends. */
              return Promise.resolve(transport.join(parsed, handlers)).then(function () { if (!node._helloSent) node._helloSent = sendBytes(helloBytes); return node; });
            }
            node._lastHelloBytes = helloBytes;
            return node;
          });
        });
      },
      _handlers: function () {
        return {
          onBytes: function (b) { node.handleBytes(b); },
          onPeerConnected: function () {
            /* Resend HELLO once the link is up. A fresh Bluetooth link can still
             * be negotiating its packet size, so retry briefly if refused. */
            var tries = 0;
            (function trySend() {
              if (role !== "probe" || !node._lastHelloBytes || node._helloSent || state !== "pairing") return;
              node._helloSent = sendBytes(node._lastHelloBytes);
              if (!node._helloSent && ++tries < 8 && typeof setTimeout !== "undefined") setTimeout(trySend, 400);
            })();
          },
          onPeerLost: function (reason) { node.handlePeerLost(reason); },
          onError: function () { node.handlePeerLost("transport-error"); }
        };
      },
      handlePeerLost: function (reason) {
        if (state === "connected" || state === "connecting" || state === "confirming") {
          frozen = true; frozenReason = reason || "peer-lost";
          onWarning("Connection lost. The image is frozen at the last position.");
          setState("reconnecting", reason || "peer-lost");
        } else if (state !== "idle" && state !== "failed") {
          frozen = true; frozenReason = reason || "peer-lost";
          setState("disconnected", reason || "peer-lost");
        }
        return node;
      },
      freeze: function (reason) { frozen = true; frozenReason = reason || "loss"; onWarning("Connection lost. The image is frozen at the last position."); return node; },
      armResume: function () {
        // Re-arm the receiver after a gap: accept the peer's next sequence
        // (however far it advanced, or restarted, while the link was down),
        // drop the old clock offset so the next PING/PONG re-estimates it,
        // and keep the image frozen until the first valid pose lands. That
        // pose becomes the new calibrate zero, so the display eases from
        // the frozen pose instead of jumping.
        seqSeen = {}; lastSeqIn = 0; clockOffsetMs = null;
        resumeArmed = true; needsCalib = true; calibQuat = null; calibBase = null; pendingPose = null;
        frozen = true; frozenReason = "awaiting-first-pose-after-resume";
        if (lastValidState) smoother.reset({ tiltDeg: lastValidState.tiltDeg, rotationDeg: lastValidState.rotationDeg, rockDeg: lastValidState.rockDeg, x: lastValidState.position ? lastValidState.position.x : 0, y: lastValidState.position ? lastValidState.position.y : 0 });
        return node;
      },
      resume: function () {
        node.armResume();
        if (state === "reconnecting" || state === "disconnected") setState("connected", "explicit-resume");
        try { sendFrame({ type: TYPES.CONTROL, code: CONTROLS.RESUME, arg: 0 }); } catch (e) {}
        return node;
      },
      recenter: function () {
        needsCalib = true; calibQuat = lastValidPose ? lastValidPose.quat.slice() : null;
        frozen = false; frozenReason = null; pendingPose = null;
        if (lastValidState) smoother.reset({ tiltDeg: 0, rotationDeg: 0, rockDeg: 0, x: lastValidState.position ? lastValidState.position.x : 0, y: lastValidState.position ? lastValidState.position.y : 0 });
        if (state === "reconnecting" || state === "disconnected") setState("connected", "explicit-recenter");
        try { sendFrame({ type: TYPES.CONTROL, code: CONTROLS.RECENTER, arg: 0 }); } catch (e) {}
        return node;
      },
      confirm: function () {
        confirmedLocal = true;
        if (state === "confirming") setState("connecting", "local-confirm");
        try { sendFrame({ type: TYPES.CONTROL, code: CONTROLS.CONFIRM, arg: 0 }); } catch (e) {}
        if (confirmedPeer) setState("connected", "both-confirmed");
        return node;
      },
      sendPose: function (poseIn) {
        var pose = clampPose(poseIn, probeLib);
        pose.window = pose.window; pose.slideXmm = pose.slideXmm; pose.slideYmm = pose.slideYmm;
        return sendFrame({ type: TYPES.POSE, pose: pose });
      },
      sendProbeState: function (probeState) {
        var q = quatFromEuler(probeState.tiltDeg || 0, probeState.rotationDeg || 0, probeState.rockDeg || 0);
        return node.sendPose({ quat: q, touch: 0, window: probeState.window, slideXmm: probeState.position ? probeState.position.x : 0, slideYmm: probeState.position ? probeState.position.y : 0, flags: { calibrated: true } });
      },
      sendControl: function (code, arg) { return sendFrame({ type: TYPES.CONTROL, code: code, arg: arg || 0 }); },
      sendPing: function () { var t = monoMs(); node._lastPingTms = t; return sendFrame({ type: TYPES.PING }); },
      updateClockOffset: function (offset) { clockOffsetMs = offset; return clockOffsetMs; },
      estimateFromPong: function (frame, recvMono) {
        var rtt = diffU32(recvMono >>> 0, frame.echoTms >>> 0);
        /* Offset added to a sender tMs to get local time: local - sender. */
        clockOffsetMs = diffU32((frame.echoTms + Math.round(rtt / 2)) >>> 0, frame.pongTms >>> 0);
        return clockOffsetMs;
      },
      handleBytes: function (bytes) {
        if (destroyed) return Promise.resolve(false);
        var pre = decodeFrame(bytes, null);
        if (!pre.ok && pre.reason !== "mac-failure") {
          /* Try with key first for the real MAC path below. */
          if (!sessionKey) return Promise.resolve(false);
        }
        var type = pre.frame ? pre.frame.type : (bytes && bytes[1]);
        if (type === TYPES.HELLO) {
          var helloDec = decodeFrame(bytes, null);
          if (!helloDec.ok) return Promise.resolve(false);
          lastActivityAt = nowFn();
          return handleHello(helloDec.frame);
        }
        if (!sessionKey) return Promise.resolve(false);
        var dec = decodeFrame(bytes, sessionKey);
        if (!dec.ok) { if (dec.reason === "mac-failure") statsIn.droppedMac++; return Promise.resolve(false); }
        var frame = dec.frame;
        if (frame.sessionTag !== sessionTag) { statsIn.droppedSession++; return Promise.resolve(false); }
        if (frame.type === TYPES.POSE) {
          // First valid pose after Resume bypasses seq/stale: the receiver
          // was re-armed, so a jumped or restarted sequence and a not yet
          // re-estimated clock offset must not drop it.
          if (!resumeArmed && !checkSeqAndStale(frame)) return Promise.resolve(false);
          var v = validatePose(frame.pose, probeLib);
          if (!v.ok) { statsIn.droppedBounds++; return Promise.resolve(false); }
          acceptSeq(frame); lastActivityAt = nowFn(); lastPoseAt = lastActivityAt;
          if (resumeArmed) {
            resumeArmed = false; frozen = false; frozenReason = null;
            pendingPose = frame.pose; lastValidPose = frame.pose; statsIn.accepted++;
            return Promise.resolve(true);
          }
          if (frozen) { statsIn.droppedFrozen++; pendingPose = frame.pose; return Promise.resolve(true); }
          pendingPose = frame.pose; lastValidPose = frame.pose; statsIn.accepted++;
          return Promise.resolve(true);
        }
        if (!checkSeqAndStale(frame) && frame.type !== TYPES.PONG) return Promise.resolve(false);
        if (frame.type === TYPES.PONG) {
          /* PONG seq is the responder sequence; do not let it block poses. */
          if (seqSeen[frame.seq] && frame.seq <= lastSeqIn && role === "probe") { /* still useful for RTT */ }
          clockOffsetMs = node.estimateFromPong(frame, monoMs());
          lastActivityAt = nowFn();
          return Promise.resolve(true);
        }
        acceptSeq(frame); lastActivityAt = nowFn();
        if (frame.type === TYPES.WELCOME) {
          if (role === "probe") {
            controllerId = frame.controllerId;
            if (state === "pairing" || state === "discovering") setState("confirming", "welcome");
          }
        } else if (frame.type === TYPES.PING) {
          try { sendFrame({ type: TYPES.PONG, echoTms: frame.tMs }); } catch (e) {}
          /* The pinger clock offset from display view: peer tMs against local mono. */
          if (clockOffsetMs == null) clockOffsetMs = diffU32(frame.tMs >>> 0, monoMs() >>> 0) * -1;
        } else if (frame.type === TYPES.CONTROL) {
          if (frame.code === CONTROLS.CONFIRM) {
            confirmedPeer = true;
            if (confirmedLocal && state === "connecting") setState("connected", "both-confirmed");
            else if (confirmedLocal) setState("connected", "both-confirmed");
          } else if (frame.code === CONTROLS.RESUME) { node.armResume(); }
          else if (frame.code === CONTROLS.RECENTER) { needsCalib = true; calibQuat = null; calibBase = null; frozen = false; resumeArmed = false; }
          else if (frame.code === CONTROLS.DEPTH) { var dcm = frame.arg / 10; if (dcm >= 8 && dcm <= 30) lastDepthCm = dcm; }
          else if (frame.code === CONTROLS.END) { node.handlePeerLost("ended"); }
          else if (frame.code === CONTROLS.PAUSE) { frozen = true; }
        } else if (frame.type === TYPES.BYE) {
          if (frame.reason === BYE.CONTROLLER_BUSY) failWith("controller-busy", "Another probe is already controlling this display.");
          else node.handlePeerLost("bye");
        }
        return Promise.resolve(true);
      },
      /* Display render step: coalesce to newest POSE, smooth, apply once. */
      renderFrame: function (when) {
        var now = when == null ? nowFn() : when;
        if (frozen || !pendingPose) return null;
        var pose = pendingPose; pendingPose = null;
        var target = poseToDisplayState(pose);
        var dt = lastRenderAt ? now - lastRenderAt : 16; lastRenderAt = now;
        var sm = smoother.step({ tiltDeg: target.tiltDeg, rotationDeg: target.rotationDeg, rockDeg: target.rockDeg, x: target.x, y: target.y }, dt);
        var outState;
        if (displayProbe) {
          outState = { window: target.window, tiltDeg: sm.tiltDeg, rotationDeg: sm.rotationDeg, rockDeg: sm.rockDeg, position: { x: sm.x, y: sm.y } };
        } else {
          outState = { window: target.window, tiltDeg: sm.tiltDeg, rotationDeg: sm.rotationDeg, rockDeg: sm.rockDeg, position: { x: sm.x, y: sm.y } };
        }
        if (lastDepthCm != null) outState.depthCm = lastDepthCm;
        lastValidState = outState;
        if (echoLab && typeof echoLab.setProbeState === "function") echoLab.setProbeState(outState);
        else if (displayProbe) displayProbe.setState(outState);
        return outState;
      },
      tick: function (when) {
        var now = when == null ? nowFn() : when;
        if ((state === "connected" || state === "connecting" || state === "confirming") && now - lastActivityAt > SESSION_IDLE_MS) {
          wipeKeys(); controllerActive = false;
          setState("disconnected", "idle-expired");
          return { expired: true };
        }
        if (pairing && role === "display" && state === "pairing" && now > pairing.expiresAt) {
          setState("failed", "credential-expired", "The pairing code has expired. Show a new code.");
          return { expired: true };
        }
        return { expired: false };
      },
      close: function (reason) {
        try { if (sessionKey) sendFrame({ type: TYPES.BYE, reason: reason == null ? BYE.NORMAL : reason }); } catch (e) {}
        wipeKeys(); controllerActive = false; confirmedLocal = false; confirmedPeer = false;
        seqSeen = {};
        if (transport) { var t = transport; transport = null; try { t.close("closed"); } catch (e2) {} }
        setState("disconnected", "closed");
        return node;
      },
      destroy: function () { destroyed = true; wipeKeys(); }
    };
    return node;
  }
  function createDisplay(opts) { opts = opts || {}; opts.role = "display"; return createNode(opts); }
  function createProbe(opts) { opts = opts || {}; opts.role = "probe"; return createNode(opts); }

  /* ---------- probe-side DeviceOrientation sender ---------- */
  function createProbeSender(opts) {
    opts = opts || {};
    var env = opts.env || G || {};
    var probeLib = opts.probeLib || (G && G.KARDIA_PROBE) || null;
    var sendPose = opts.sendPose || function () {};
    var onError = opts.onError || function () {};
    var probe = opts.probe || null, listening = false, handler = null, lastTs = 0, calibrateAtt = null;
    var lastPose = null, lastPoseState = null, lastMoveAt = 0, resendTimer = null;
    function ensureProbe() { if (!probe && probeLib) probe = probeLib.create({}); return probe; }
    function handleOrientation(attitude, dtMs) {
      var p = ensureProbe(); if (!p) return null;
      if (!calibrateAtt) { try { p.calibrateGyro(attitude); } catch (e) {} calibrateAtt = { alpha: attitude.alpha || 0, beta: attitude.beta || 0, gamma: attitude.gamma || 0 }; }
      var st;
      try { st = p.applyGyroSample(attitude, dtMs == null ? 16 : dtMs); } catch (e2) { return null; }
      /* Dead zone: hold the last sent pose while every axis is within
       * 1.5 degrees of it, so hand tremor at rest does not jitter the
       * image. Smoothing upstream (probe filter) and downstream (display
       * smoother) handles the rest; latency stays one sample. */
      if (lastPoseState && calibrateAtt) {
        var dz = Math.max(
          Math.abs((st.tiltDeg || 0) - (lastPoseState.tiltDeg || 0)),
          Math.abs((st.rotationDeg || 0) - (lastPoseState.rotationDeg || 0)),
          Math.abs((st.rockDeg || 0) - (lastPoseState.rockDeg || 0)));
        if (dz < 1.5) return lastPose;
      }
      var q = quatFromEuler(st.tiltDeg || 0, st.rotationDeg || 0, st.rockDeg || 0);
      var pose = { quat: q, touch: 0, window: st.window, slideXmm: st.position ? st.position.x : 0, slideYmm: st.position ? st.position.y : 0, flags: { calibrated: true } };
      pose.probeState = st;
      lastPose = pose; lastPoseState = st; lastMoveAt = nowDefault();
      sendPose(pose, st);
      return pose;
    }
    // While the phone is moving, POSE goes out at 25 Hz: orientation events
    // alone can arrive sparsely, so the latest pose is resent on a 40 ms
    // timer for a short window after the last sample. The display coalesces
    // to the newest pose, so resends only step its smoothing forward.
    function startResend() {
      if (resendTimer || typeof setInterval === "undefined") return;
      resendTimer = setInterval(function () {
        if (!listening || !lastPose) return;
        if (nowDefault() - lastMoveAt > 500) return;
        try { sendPose(lastPose, lastPoseState); } catch (e) {}
      }, 40);
      if (resendTimer && resendTimer.unref) resendTimer.unref();
    }
    function stopResend() { if (resendTimer) { try { clearInterval(resendTimer); } catch (e) {} resendTimer = null; } }
    var sender = {
      get listening() { return listening; },
      get probe() { return probe; },
      handleOrientation: handleOrientation,
      calibrate: function (attitude) { calibrateAtt = null; var p = ensureProbe(); if (p && attitude) { p.calibrateGyro(attitude); calibrateAtt = { alpha: attitude.alpha || 0, beta: attitude.beta || 0, gamma: attitude.gamma || 0 }; } return sender; },
      /* Call ONLY from the learner tap on Use This Device as Probe. */
      enableAsProbe: function () {
        var caps = detectCapabilities(env);
        if (!caps.hasDeviceOrientation || typeof env.addEventListener !== "function") {
          onError("no-sensor");
          return Promise.resolve({ ok: false, reason: "no-sensor" });
        }
        var ask = null, askThis = null;
        try {
          if (env.DeviceOrientationEvent && typeof env.DeviceOrientationEvent.requestPermission === "function") { ask = env.DeviceOrientationEvent.requestPermission; askThis = env.DeviceOrientationEvent; }
          else if (env.DeviceMotionEvent && typeof env.DeviceMotionEvent.requestPermission === "function") { ask = env.DeviceMotionEvent.requestPermission; askThis = env.DeviceMotionEvent; }
        } catch (e) {}
        function start() {
          ensureProbe(); calibrateAtt = null; lastTs = 0;
          if (!handler) {
            handler = function (e) {
              if (!listening) return;
              var now = (e && e.timeStamp) || nowDefault();
              var dt = lastTs ? now - lastTs : 16; lastTs = now;
              handleOrientation(e, dt);
            };
            try { env.addEventListener("deviceorientation", handler, true); } catch (e2) {}
          }
          listening = true;
          startResend();
          return { ok: true };
        }
        if (!ask) return Promise.resolve(start());
        return Promise.resolve(ask.call(askThis)).then(function (r) {
          if (r !== "granted") { onError("permission-denied"); return { ok: false, reason: "permission-denied" }; }
          return start();
        }, function () { onError("permission-denied"); return { ok: false, reason: "permission-denied" }; });
      },
      disable: function () {
        listening = false; stopResend(); lastPose = null; lastPoseState = null;
        if (handler && typeof env.removeEventListener === "function") { try { env.removeEventListener("deviceorientation", handler, true); } catch (e) {} handler = null; }
        return sender;
      }
    };
    return sender;
  }

  /* ---------- BroadcastChannel loopback transport (test flag only) ----------
   * Registered only when the page asks for it (query syncprobeLoopback=1 or
   * window.__KARDIA_SYNC_LOOPBACK_TEST__), so production never sees it. It
   * bridges two pages on one origin for the headless two page test and
   * measures its own round trip with channel ping and pong messages. That
   * round trip is a loopback figure, not a radio measurement. Cutting is
   * driven by window.__KARDIA_SYNC_TEST_CUT__ so the runner can drop the
   * link without touching the core. */
  function createBroadcastLoopbackTransport() {
    var BC = null;
    try { BC = G.BroadcastChannel || (typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null); } catch (e) {}
    var handlers = null, channel = null, closed = true, clientId = bytesToHex(randomBytes(6));
    var pairingHeld = null, sentAt = [], recvAt = [], lastRecvAt = 0, rttMs = 0, cutState = false, cutTimer = null, pingTimer = null;
    function isCut() { try { return !!G.__KARDIA_SYNC_TEST_CUT__; } catch (e) { return false; } }
    function openChannel() {
      if (channel || !BC) return channel;
      channel = new BC("kardia-syncprobe-loopback-test"); closed = false;
      channel.onmessage = function (ev) {
        var m = ev && ev.data; if (!m || m.from === clientId) return;
        if (m.kind === "ping") { post({ kind: "pong", to: m.from, ts: m.ts }); return; }
        if (m.kind === "pong") { if (m.to === clientId) rttMs = Math.max(1, nowDefault() - m.ts); return; }
        if (m.kind === "discover") {
          if (pairingHeld && pairingHeld.shortCode === m.shortCode) post({ kind: "pairing", to: m.from, pairing: pairingHeld });
          return;
        }
        if (!handlers) return;
        if (m.kind === "join-announce") { if (handlers.onPeerConnected) handlers.onPeerConnected({ transport: "loopback" }); post({ kind: "host-announce" }); }
        else if (m.kind === "host-announce") { if (handlers.onPeerConnected) handlers.onPeerConnected({ transport: "loopback" }); }
        else if (m.kind === "peer-bye") { if (handlers.onPeerLost) handlers.onPeerLost(m.reason || "peer-closed"); }
        else if (m.kind === "bytes" && m.data) { lastRecvAt = nowDefault(); recvAt.push(lastRecvAt); if (handlers.onBytes) handlers.onBytes(new Uint8Array(m.data)); }
      };
      cutTimer = setInterval(function () {
        var cut = isCut();
        if (cut && !cutState) { cutState = true; if (handlers && handlers.onPeerLost) handlers.onPeerLost("loopback-cut"); }
        else if (!cut && cutState) cutState = false;
      }, 200);
      if (cutTimer && cutTimer.unref) cutTimer.unref();
      pingTimer = setInterval(function () { if (!isCut()) post({ kind: "ping", ts: nowDefault() }); }, 1000);
      if (pingTimer && pingTimer.unref) pingTimer.unref();
      return channel;
    }
    function post(m) { try { if (channel) { m.from = clientId; channel.postMessage(m); } } catch (e) {} }
    function perSec(arr) { var cut = nowDefault() - 1000; while (arr.length && arr[0] < cut) arr.shift(); return arr.length; }
    var t = {
      id: "loopback", kind: "direct",
      capabilities: function () { return Promise.resolve({ available: !!BC, reason: BC ? "" : "BroadcastChannel is not available", canAdvertise: true, canScan: true, needsInternet: false, maxPayload: 65536, platform: "web" }); },
      host: function (pairing, h) { handlers = h; pairingHeld = pairing; openChannel(); post({ kind: "host-announce" }); return Promise.resolve(); },
      join: function (pairing, h) { handlers = h; openChannel(); post({ kind: "join-announce" }); return Promise.resolve(); },
      discover: function (shortCode) {
        if (!BC) return Promise.resolve(null);
        return new Promise(function (res) {
          var ch = new BC("kardia-syncprobe-loopback-test"), done = false;
          var timer = setTimeout(function () { finish(null); }, 3000);
          if (timer.unref) timer.unref();
          function finish(v) { if (done) return; done = true; clearTimeout(timer); try { ch.close(); } catch (e) {} res(v); }
          ch.onmessage = function (ev) { var m = ev && ev.data; if (m && m.kind === "pairing" && m.to === clientId && m.pairing) finish(m.pairing); };
          try { ch.postMessage({ kind: "discover", from: clientId, shortCode: String(shortCode || "").toUpperCase() }); } catch (e) { finish(null); }
        });
      },
      send: function (bytes) { if (closed || !channel || isCut()) return false; sentAt.push(nowDefault()); post({ kind: "bytes", data: Array.prototype.slice.call(bytes) }); return true; },
      close: function () { post({ kind: "peer-bye", reason: "closed" }); closed = true; handlers = null; pairingHeld = null; if (cutTimer) clearInterval(cutTimer); if (pingTimer) clearInterval(pingTimer); if (channel) { try { channel.close(); } catch (e) {} channel = null; } return Promise.resolve(); },
      stats: function () { return { rttMs: rttMs, lossPct: 0, sentPerSec: perSec(sentAt), recvPerSec: perSec(recvAt), lastRecvAt: lastRecvAt || null }; }
    };
    return t;
  }
  function loopbackTestWanted() {
    try {
      if (G.__KARDIA_SYNC_LOOPBACK_TEST__) return true;
      if (G.location && /[?&]syncprobeLoopback=1/.test(G.location.search || "")) return true;
    } catch (e) {}
    return false;
  }

  /* ---------- UI facade: the exact surface kardia-syncprobe.js calls ----------
   * One facade session at a time over a core node. This is the single
   * contract between the UI and the core (see the header of
   * kardia-syncprobe.js): state, on, startDisplay, joinProbe, confirm,
   * disconnect, reconnect, recenter, setPaused, calibrate, probePatch,
   * stats, transports, activeTransport, session, lastError and the role
   * property. Transports plug in through registerTransport above; the
   * facade picks one with selectTransport, so a relay adapter registered
   * later needs no UI change. Pairing creation needs WebCrypto, so
   * startDisplay returns a thenable pairing object that is filled in
   * place; awaiting it (or reading session() after the state event)
   * gives the finished pairing. */
  var facadeLocalPairings = {};
  var F = {
    node: null, role: null, listeners: [], pairing: null, transport: null, transportId: null,
    lastError: null, paused: false, sender: null, renderTimer: null, pingTimer: null,
    lastFrameAt: 0, deferredApply: false,
    transportCaps: {}, capsBusy: false, touchState: { window: "parasternal", rotationDeg: 0, tiltDeg: 0, rockDeg: 0, depthCm: 18, slideX: 0, slideY: 0 },
    wrapRttMs: 0, pingSentAt: 0
  };
  function facadeEmit(evt) { F.listeners.slice().forEach(function (fn) { try { fn(evt); } catch (e) {} }); }
  function facadeStateName() { return F.node ? F.node.state : "idle"; }
  function facadeResolveEchoLab() { try { return (G.KARDIA && G.KARDIA._kardia && G.KARDIA._kardia.echoLab) || null; } catch (e) { return null; } }
  var facadeEchoLabProxy = {
    setProbeState: function (s) { var lab = facadeResolveEchoLab(); return lab && lab.setProbeState ? lab.setProbeState(s) : null; },
    getProbeState: function () { var lab = facadeResolveEchoLab(); return lab && lab.getProbeState ? lab.getProbeState() : null; }
  };
  function facadeWrapTransport(t) {
    return {
      id: t.id, kind: t.kind,
      capabilities: function () { return t.capabilities(); },
      host: function (p, h) { return t.host(p, facadeWrapHandlers(h)); },
      join: function (p, h) { return t.join(p, facadeWrapHandlers(h)); },
      send: function (bytes) { if (bytes && bytes[1] === TYPES.PING) F.pingSentAt = nowDefault(); try { return t.send(bytes); } catch (e) { return false; } },
      close: function (r) { return t.close(r); },
      stats: function () { var s = {}; try { s = t.stats() || {}; } catch (e) {} if (F.wrapRttMs && (!s.rttMs || s.rttMs <= 0)) s.rttMs = F.wrapRttMs; return s; },
      discover: t.discover ? function (c) { return t.discover(c); } : undefined,
      discoverNearby: t.discoverNearby ? function (ms) { return t.discoverNearby(ms); } : undefined,
      discoverByHash: t.discoverByHash ? function (h) { return t.discoverByHash(h); } : undefined,
      activeId: t.activeId ? function () { return t.activeId(); } : undefined,
      candidates: t.candidates || undefined
    };
  }
  function facadeWrapHandlers(h) {
    return {
      onBytes: function (b) { if (b && b[1] === TYPES.PONG && F.pingSentAt) F.wrapRttMs = Math.max(1, nowDefault() - F.pingSentAt); if (h.onBytes) h.onBytes(b); if (b && b[1] === TYPES.POSE) facadeScheduleDeferredApply(); },
      onPeerConnected: function (i) { if (h.onPeerConnected) h.onPeerConnected(i); },
      onPeerLost: function (r) { if (h.onPeerLost) h.onPeerLost(r); },
      onError: function (e) { if (h.onError) h.onError(e); }
    };
  }
  function facadeRefreshCaps() {
    if (F.capsBusy) return;
    F.capsBusy = true;
    queryCapabilities(listTransports()).then(function (rows) {
      F.capsBusy = false;
      rows.forEach(function (r) { F.transportCaps[r.transport.id] = r.caps; });
      facadeEmit({ type: "transports" });
    }, function () { F.capsBusy = false; });
  }
  function facadeMakeNode(role) {
    var node = createNode({
      role: role, probeLib: (G && G.KARDIA_PROBE) || undefined, echoLab: role === "display" ? facadeEchoLabProxy : undefined,
      onState: function (next, prev, reason) {
        if (next === "failed" && F.node) F.lastError = (F.node.getState().reason || reason || "failed");
        facadeEmit({ type: "state", name: next, reason: reason || null, hint: F.node ? F.node.getState().recoveryHint : null });
        if (next === "connected") facadeStartLoops(); else if (next === "disconnected" || next === "failed" || next === "idle") facadeStopLoops();
      },
      onWarning: function (msg) { F.lastError = msg; facadeEmit({ type: "warning", message: msg }); facadeEmit({ type: "state", name: facadeStateName(), reason: "peer-lost" }); }
    });
    return node;
  }
  /* Display: incoming frames are decoded, validated and stored as the
   * newest pending pose synchronously in handleBytes (the message
   * callback); this step only applies that newest pose. Echo Lab calls
   * it at the start of each rendered (capped) frame; the 33 ms timer
   * below is only a fallback for when no live canvas is running. */
  function facadeRenderLatest(fromFrame) {
    /* Only a real rendered frame (Echo Lab's onFrameStart) counts as a
     * frame for the 50 ms check below; timer and message-path applies
     * must not masquerade as one, or a pose arriving just after such an
     * apply in a stalled page would be left pending with no frame to
     * ever pick it up. */
    if (fromFrame) F.lastFrameAt = nowDefault();
    if (!F.node || F.role !== "display" || F.paused) return null;
    var out = null;
    try { out = F.node.renderFrame(); } catch (e) {}
    if (out) facadeEmit({ type: "pose", pose: { tiltDeg: out.tiltDeg, rotationDeg: out.rotationDeg, rockDeg: out.rockDeg, window: out.window, slideX: out.position ? out.position.x : 0, slideY: out.position ? out.position.y : 0, depthCm: out.depthCm != null ? out.depthCm : null } });
    return out;
  }
  /* Message-path apply: rAF (and timers) can be paused on a background
   * target or a stalled display, so a pose must not wait for the next
   * rendered frame. When no frame has run in the last 50 ms, apply the
   * newest stored pose on a microtask straight after the message that
   * stored it. This goes through the same facadeRenderLatest /
   * node.renderFrame authority (same smoother, same frozen and
   * Resume-armed checks in renderFrame), so rendering only ever reads
   * the probe state this step set; it never applies a second time. */
  function facadeScheduleDeferredApply() {
    if (F.deferredApply || !F.node || F.role !== "display" || F.paused) return;
    if (F.lastFrameAt && nowDefault() - F.lastFrameAt < 50) return;
    F.deferredApply = true;
    var run = function () { F.deferredApply = false; facadeRenderLatest(); };
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else if (typeof Promise !== "undefined" && Promise.resolve) Promise.resolve().then(run);
    else if (typeof setTimeout !== "undefined") setTimeout(run, 0);
    else { F.deferredApply = false; }
  }
  function facadeStartLoops() {
    if (F.renderTimer || typeof setInterval === "undefined") return;
    F.renderTimer = setInterval(function () { facadeRenderLatest(); }, 33);
    if (F.renderTimer.unref) F.renderTimer.unref();
    F.pingTimer = setInterval(function () { if (F.node && facadeStateName() === "connected") { try { F.node.sendPing(); } catch (e) {} } }, 1000);
    if (F.pingTimer.unref) F.pingTimer.unref();
  }
  function facadeStopLoops() {
    if (F.renderTimer) clearInterval(F.renderTimer); F.renderTimer = null;
    if (F.pingTimer) clearInterval(F.pingTimer); F.pingTimer = null;
  }
  function facadePickTransport() {
    /* Race every available transport in parallel: BLE and relay start
     * together, the first healthy one wins and the other stays as backup
     * inside the raced transport. Transports whose capabilities fail or
     * report unavailable (for example relay while signed out) are left
     * out, but their reason is remembered for a specific error message. */
    return queryCapabilities(listTransports()).then(function (rows) {
      var avail = rows.filter(function (r) { return r.caps && r.caps.available; });
      avail.sort(function (a, b) { return transportPriority(a.transport) - transportPriority(b.transport); });
      if (!avail.length) {
        var errs = rows.map(function (r) { return reasonError(transportErrorReason({ message: r.caps && r.caps.reason }), (r.caps && r.caps.reason) || "No link is available on this phone."); });
        throw bestReasonError(errs);
      }
      F.lastTransportErrors = rows.filter(function (r) { return !(r.caps && r.caps.available); }).map(function (r) { return { id: r.transport.id, reason: transportErrorReason({ message: r.caps && r.caps.reason }), message: (r.caps && r.caps.reason) || "" }; });
      if (avail.length === 1) return avail[0].transport;
      return createRacedTransport(avail.map(function (r) { return r.transport; }));
    });
  }
  function facadeActiveId() {
    if (F.transport && F.transport.activeId) { var a = F.transport.activeId(); if (a) return a; }
    return F.transportId;
  }
  function facadeSessionObject() {
    if (!F.node || !F.pairing) return null;
    var name = facadeStateName();
    if (name === "idle" || name === "disconnected" || name === "failed") return null;
    var out = {}, k;
    for (k in F.pairing) if (Object.prototype.hasOwnProperty.call(F.pairing, k) && k !== "displayPubBytes" && k !== "then") out[k] = F.pairing[k];
    out.confirm = (F.node && F.node.confirmCode) || F.pairing.confirm || null;
    out.confirmed = name === "connected";
    if (!out.payload && out.sessionId && out.displayPub) out.payload = pairingPayload(out);
    return out;
  }
  function facadeJoinParsed(parsed, text) {
      if (nowDefault() > parsed.expiresAt) { var e4 = new Error("gone"); e4.reason = "expired"; return Promise.reject(e4); }
      facadeStopLoops(); F.role = "probe"; F.paused = false; F.lastError = null;
      F.node = facadeMakeNode("probe");
      F.pairing = { sessionId: parsed.sessionId, displayPub: parsed.displayPub, shortCode: parsed.shortCode, expiresAt: parsed.expiresAt, payload: (text && text.indexOf("kardia-sync:") === 0) ? text : pairingPayload(parsed), confirm: null };
      if (parsed.roomId) { F.pairing.roomId = parsed.roomId; F.pairing.roomToken = parsed.roomToken; F.pairing.relay = parsed.relay || { roomId: parsed.roomId, roomToken: parsed.roomToken }; }
      if (parsed.codeHashHex) F.pairing.codeHashHex = parsed.codeHashHex;
      if (parsed.displayPubBytes) F.pairing.displayPubBytes = parsed.displayPubBytes;
      return facadePickTransport().then(function (t) {
        if (!t) { F.lastError = "No link is available on this phone."; var e5 = new Error("no-transport"); e5.reason = "no-transport"; throw e5; }
        F.transport = facadeWrapTransport(t); F.transportId = t.id === "raced" ? null : t.id;
        var joinInput = (F.pairing.roomId || F.pairing.codeHashHex) ? { sessionId: parsed.sessionId, displayPub: parsed.displayPub, displayPubBytes: parsed.displayPubBytes || b64urlDecode(parsed.displayPub), shortCode: parsed.shortCode, expiresAt: parsed.expiresAt, roomId: F.pairing.roomId, roomToken: F.pairing.roomToken, relay: F.pairing.relay, codeHashHex: parsed.codeHashHex } : F.pairing.payload;
        return F.node.joinPairing(joinInput, F.transport).then(function () {
          F.transportId = facadeActiveId() || F.transportId;
          if (F.node.state === "failed") { var e6 = new Error(F.node.getState().reason || "failed"); e6.reason = transportErrorReason(e6); throw e6; }
          facadeStartSender();
          return true;
        }, function (err) { throw reasonError(transportErrorReason(err), (err && err.message) || "Could not join."); });
      }, function (err) { throw reasonError(transportErrorReason(err), (err && err.message) || "No link is available on this phone."); });
    }
  var facade = {
    on: function (fn) { if (typeof fn === "function") F.listeners.push(fn); return function () { F.listeners = F.listeners.filter(function (f) { return f !== fn; }); }; },
    state: function () { var s = F.node ? F.node.getState() : null; return { name: facadeStateName(), confirm: F.node ? F.node.confirmCode : null, reason: s ? s.reason : null, hint: s ? s.recoveryHint : null }; },
    startDisplay: function () {
      if (F.node && F.role === "display" && F.pairing && ["pairing", "confirming", "connecting", "connected", "reconnecting", "discovering"].indexOf(facadeStateName()) >= 0) return F.pairing;
      facadeStopLoops(); F.role = "display"; F.paused = false; F.lastError = null;
      F.node = facadeMakeNode("display");
      var placeholder = { sessionId: "", displayPub: "", shortCode: "", expiresAt: 0, confirm: null, payload: "" };
      F.pairing = placeholder;
      var ready = facadePickTransport().then(function (t) {
        if (!t) { F.lastError = "No link is available on this phone."; throw new Error("no-transport"); }
        F.transport = facadeWrapTransport(t); F.transportId = t.id;
        return F.node.createPairing().then(function (pairing) {
          Object.keys(pairing).forEach(function (k) { if (k !== "displayPubBytes") placeholder[k] = pairing[k]; });
          placeholder.payload = pairing.payload; F.pairing = placeholder;
          facadeLocalPairings[pairing.shortCode] = placeholder;
          return F.node.hostWith(F.transport, pairing).then(function () {
            /* Relay hosting creates the room during host(): copy its
             * credentials onto the shared pairing and rebuild the payload
             * so the QR carries them. Without this a probe that scans the
             * QR can never join over the relay. */
            if (pairing.relay) placeholder.relay = pairing.relay;
            if (pairing.roomId) placeholder.roomId = pairing.roomId;
            if (pairing.roomToken) placeholder.roomToken = pairing.roomToken;
            F.transportId = facadeActiveId() || F.transportId;
            placeholder.payload = pairingPayload(placeholder);
            pairing.payload = placeholder.payload;
            facadeEmit({ type: "pairing", name: facadeStateName() });
            return facadeSessionObject();
          });
        });
      });
      ready.then(function () { facadeEmit({ type: "state", name: facadeStateName() }); }, function (e) { F.lastError = (e && e.message) || "Could not start pairing."; try { console.warn("[SyncProbe] pairing failed:", (e && (e.reason || e.message)) || e); } catch (x) {} facadeEmit({ type: "state", name: facadeStateName(), reason: transportErrorReason(e), error: e }); });
      placeholder.then = function (onF, onR) { return ready.then(onF, onR); };
      placeholder.catch = function (onR) { return ready.catch(onR); };
      return placeholder;
    },
    joinProbe: function (input) {
      if (input && typeof input === "object" && input.sessionId && input.displayPub) {
        var objParsed = { sessionId: String(input.sessionId).toLowerCase(), displayPub: input.displayPub, displayPubBytes: input.displayPubBytes || null, shortCode: input.shortCode || "NEARBY", expiresAt: input.expiresAt || (nowDefault() + PAIRING_TTL_MS), roomId: input.roomId, roomToken: input.roomToken, relay: input.relay, codeHashHex: input.codeHashHex };
        if (!objParsed.displayPubBytes) { try { objParsed.displayPubBytes = b64urlDecode(objParsed.displayPub); } catch (e) {} }
        return facadeJoinParsed(objParsed, pairingPayload(objParsed));
      }
      var text = String(input == null ? "" : input).trim();
      var parsed = parsePairingPayload(text);
      if (!parsed && /^[A-Za-z0-9 ]{6,7}$/.test(text)) {
        var code = text.toUpperCase().replace(/[^A-Z2-9]/g, "");
        if (facadeLocalPairings[code]) parsed = parsePairingPayload(facadeLocalPairings[code].payload);
        if (!parsed) {
          // Typed code: race every lookup at once. Bluetooth discovery and
          // the relay code lookup start in parallel and the first healthy
          // result wins, the same as the QR path races transports. A
          // Bluetooth miss never fails the search (only an empty result
          // across all lookups is not-found); a relay failure keeps its
          // specific reason so sign-in and rate limits surface.
          var lookups = [];
          listTransports().filter(function (t) { return typeof t.discover === "function"; }).forEach(function (t) {
            lookups.push({
              run: function () {
                try { return Promise.resolve(t.discover(code)).then(function (v) { return v; }, function () { return null; }); }
                catch (e) { return Promise.resolve(null); }
              }
            });
          });
          listTransports().filter(function (t) { return typeof t.resolveCode === "function"; }).forEach(function (t) {
            lookups.push({
              run: function () {
                try { return Promise.resolve(t.resolveCode(code)); }
                catch (e) { return Promise.reject(e); }
              }
            });
          });
          if (!lookups.length) {
            var e0 = new Error("not-found"); e0.reason = "not-found"; return Promise.reject(e0);
          }
          return raceFirstSuccess(lookups, function (job) {
            return job.run().then(function (v) {
              if (!v) { var e1 = new Error("not-found"); e1.reason = "not-found"; throw e1; }
              return v;
            });
          }).then(function (r) {
            var hit = r.value;
            // Bluetooth discovery returns sessionId and displayPub without an
            // expiry; tolerate it and keep the short code for the session.
            // The 4 digit confirmation in the confirming state still guards
            // this path before control is granted.
            if (!hit.expiresAt) hit.expiresAt = nowDefault() + PAIRING_TTL_MS;
            if (!hit.shortCode) hit.shortCode = code;
            return facade.joinProbe(hit.payload || pairingPayload(hit));
          });
        }
      }
      if (!parsed) { var e3 = new Error("not-found"); e3.reason = "not-found"; return Promise.reject(e3); }
      if (nowDefault() > parsed.expiresAt) { var e4 = new Error("gone"); e4.reason = "expired"; return Promise.reject(e4); }
      return facadeJoinParsed(parsed, text);
    },
    discoverNearby: function (timeoutMs) {
      var ble = listTransports().filter(function (t) { return typeof t.discoverNearby === "function"; });
      if (!ble.length) return Promise.resolve([]);
      return Promise.resolve(ble[0].discoverNearby(timeoutMs)).then(function (list) { return list || []; }, function (err) { throw reasonError(transportErrorReason(err), (err && err.message) || "Nearby search failed."); });
    },
    joinNearby: function (item) {
      if (!item || !item.codeHashHex) return Promise.reject(reasonError("not-found", "That display is no longer nearby."));
      var ble = listTransports().filter(function (t) { return typeof t.discoverByHash === "function"; });
      if (!ble.length) return Promise.reject(reasonError("bluetooth-unavailable", "Nearby joining needs the latest app build. Scan the QR code instead."));
      return Promise.resolve(ble[0].discoverByHash(item.codeHashHex)).then(function (hit) {
        if (!hit) throw reasonError("not-found", "That display is no longer nearby.");
        if (!hit.expiresAt) hit.expiresAt = nowDefault() + PAIRING_TTL_MS;
        var obj = { sessionId: hit.sessionId, displayPub: hit.displayPub, displayPubBytes: hit.displayPubBytes || b64urlDecode(hit.displayPub), shortCode: hit.shortCode || "NEARBY", expiresAt: hit.expiresAt, codeHashHex: item.codeHashHex };
        return facade.joinProbe(obj);
      });
    },
    refreshDisplay: function () {
      if (F.node && F.role === "display") { try { F.node.close(); } catch (e) {} F.node = null; F.pairing = null; }
      return facade.startDisplay();
    },
    transportErrors: function () { return F.lastTransportErrors || []; },
    confirm: function () { if (F.node) F.node.confirm(); return true; },
    disconnect: function () {
      if (wirePose.timer) { try { clearTimeout(wirePose.timer); } catch (e) {} wirePose.timer = null; }
      wirePose.pending = null;
      if (F.sender) { try { F.sender.disable(); } catch (e) {} F.sender = null; }
      facadeStopLoops();
      if (F.pairing && F.pairing.shortCode) delete facadeLocalPairings[F.pairing.shortCode];
      if (F.node) { try { F.node.close(); } catch (e) {} }
      if (F.transport) { try { F.transport.close("closed"); } catch (e) {} F.transport = null; F.transportId = null; }
      facadeEmit({ type: "state", name: facadeStateName() });
      return Promise.resolve();
    },
    reconnect: function () {
      if (!F.node) return Promise.resolve(false);
      try { F.node.resume(); } catch (e) {}
      if (F.role === "probe") facadeStartSender();
      facadeEmit({ type: "state", name: facadeStateName() });
      return Promise.resolve(true);
    },
    recenter: function () {
      if (!F.node) return true;
      if (F.role === "probe") { if (F.sender) { try { F.sender.calibrate(); } catch (e) {} } try { F.node.sendControl(CONTROLS.RECENTER, 0); } catch (e) {} }
      else { try { F.node.recenter(); } catch (e) {} }
      return true;
    },
    calibrate: function () {
      if (F.role === "probe") { if (!F.sender) facadeStartSender(); if (F.sender) { try { F.sender.calibrate(); } catch (e) {} } if (F.node) { try { F.node.sendControl(CONTROLS.CALIBRATE, 0); } catch (e) {} } return true; }
      return facade.recenter();
    },
    setPaused: function (b) {
      F.paused = !!b;
      if (F.node && facadeStateName() === "connected") { try { F.node.sendControl(F.paused ? CONTROLS.PAUSE : CONTROLS.RESUME, 0); } catch (e) {} }
      if (F.role === "display" && F.node) { if (F.paused) { try { F.node.freeze("paused"); } catch (e) {} } else if (F.node.frozen) { try { F.node.resume(); } catch (e) {} } }
      return true;
    },
    probePatch: function (patch) {
      var depthChanged = false;
      if (patch) {
        if (patch.window) F.touchState.window = patch.window;
        if (patch.rotationDeg != null) F.touchState.rotationDeg = +patch.rotationDeg;
        if (patch.tiltDeg != null) F.touchState.tiltDeg = +patch.tiltDeg;
        if (patch.rockDeg != null) F.touchState.rockDeg = +patch.rockDeg;
        if (patch.depthCm != null && +patch.depthCm !== F.touchState.depthCm) { F.touchState.depthCm = Math.min(30, Math.max(8, +patch.depthCm)); depthChanged = true; }
        if (patch.slideX != null) F.touchState.slideX = +patch.slideX;
        if (patch.slideY != null) F.touchState.slideY = +patch.slideY;
        if (patch.position) { if (patch.position.x != null) F.touchState.slideX = +patch.position.x; if (patch.position.y != null) F.touchState.slideY = +patch.position.y; }
      }
      facadeEmit({ type: "pose", pose: { tiltDeg: F.touchState.tiltDeg, rotationDeg: F.touchState.rotationDeg, rockDeg: F.touchState.rockDeg, slideX: F.touchState.slideX, slideY: F.touchState.slideY, depthCm: F.touchState.depthCm } });
      if (F.node && F.role === "probe" && facadeStateName() === "connected" && !F.paused) {
        try { F.node.sendProbeState({ window: F.touchState.window, rotationDeg: F.touchState.rotationDeg, tiltDeg: F.touchState.tiltDeg, rockDeg: F.touchState.rockDeg, position: { x: F.touchState.slideX, y: F.touchState.slideY } }); } catch (e) {}
        if (depthChanged) { try { F.node.sendControl(CONTROLS.DEPTH, Math.round(F.touchState.depthCm * 10)); } catch (e) {} }
      }
      return true;
    },
    stats: function () {
      var s = { rttMs: 0, lossPct: 0, sentPerSec: 0, recvPerSec: 0, lastRecvAt: null };
      if (F.transport) { try { var ts = F.transport.stats(); if (ts) for (var k in ts) s[k] = ts[k]; } catch (e) {} }
      if (F.wrapRttMs && (!s.rttMs || s.rttMs <= 0)) s.rttMs = F.wrapRttMs;
      return s;
    },
    transports: function () {
      facadeRefreshCaps();
      return listTransports().map(function (t) {
        var c = F.transportCaps[t.id] || { available: false, reason: "Checking the link", canAdvertise: false, canScan: false, needsInternet: t.kind === "relay", maxPayload: 0, platform: "web" };
        return { id: t.id, kind: t.kind, available: !!c.available, reason: c.reason || "", canAdvertise: !!c.canAdvertise, canScan: !!c.canScan, needsInternet: !!c.needsInternet, maxPayload: c.maxPayload || 0, platform: c.platform || "web" };
      });
    },
    activeTransport: function () { var n = facadeStateName(); return (n === "connected" || n === "reconnecting") ? F.transportId : null; },
    session: function () { return facadeSessionObject(); },
    lastError: function () { return F.lastError; }
  };
  /* Probe wire throttle: POSE at up to 30 Hz, gated by elapsed time
   * (never by rAF). Poses arriving inside the window keep only the
   * newest, flushed by a one-shot timer at the window edge. */
  var wirePose = { lastAt: 0, pending: null, timer: null };
  function wireSendPose(pose) {
    if (F.node && facadeStateName() === "connected" && !F.paused) { try { F.node.sendPose(pose); } catch (e) {} }
  }
  function wireFlushPose() {
    wirePose.timer = null;
    if (!wirePose.pending) return;
    var pose = wirePose.pending; wirePose.pending = null;
    wirePose.lastAt = nowDefault(); wireSendPose(pose);
  }
  function wirePoseThrottled(pose) {
    var now = nowDefault(), wait = 33 - (now - wirePose.lastAt);
    if (wait <= 0) { wirePose.lastAt = now; wirePose.pending = null; wireSendPose(pose); return; }
    wirePose.pending = pose;
    if (!wirePose.timer && typeof setTimeout !== "undefined") {
      wirePose.timer = setTimeout(wireFlushPose, wait);
      if (wirePose.timer && wirePose.timer.unref) wirePose.timer.unref();
    }
  }
  function facadeStartSender() {
    if (F.role !== "probe" || F.sender) return;
    F.sender = createProbeSender({
      env: G, probeLib: (G && G.KARDIA_PROBE) || undefined,
      onError: function (reason) { F.lastError = reason; },
      sendPose: function (pose, st) {
        facadeEmit({ type: "pose", pose: { tiltDeg: st ? st.tiltDeg : 0, rotationDeg: st ? st.rotationDeg : 0, rockDeg: st ? st.rockDeg : 0 } });
        wirePoseThrottled(pose);
      }
    });
    F.sender.enableAsProbe().then(function () {}, function () {});
  }
  if (loopbackTestWanted()) { try { registerTransport(createBroadcastLoopbackTransport()); } catch (e) {} }

  var API = {
    VERSION: VERSION, TYPES: TYPES, CONTROLS: CONTROLS, BYE: BYE, STATES: STATES.slice(),
    WINDOW_ORDER: WINDOW_ORDER.slice(), PAIRING_TTL_MS: PAIRING_TTL_MS, SESSION_IDLE_MS: SESSION_IDLE_MS, STALE_MS: STALE_MS,
    registerTransport: registerTransport, getTransport: getTransport, listTransports: listTransports,
    selectTransport: selectTransport, queryCapabilities: queryCapabilities,
    createTransportManager: createTransportManager, createRacedTransport: createRacedTransport, raceFirstSuccess: raceFirstSuccess, createLoopbackPair: createLoopbackPair,
    createNode: createNode, createDisplay: createDisplay, createProbe: createProbe, createProbeSender: createProbeSender,
    createSmoother: createSmoother, detectCapabilities: detectCapabilities,
    createBroadcastLoopbackTransport: createBroadcastLoopbackTransport,
    on: facade.on, state: facade.state, startDisplay: facade.startDisplay, joinProbe: facade.joinProbe, discoverNearby: facade.discoverNearby, joinNearby: facade.joinNearby, refreshDisplay: facade.refreshDisplay, transportErrors: facade.transportErrors,
    confirm: facade.confirm, disconnect: facade.disconnect, reconnect: facade.reconnect, recenter: facade.recenter,
    setPaused: facade.setPaused, calibrate: facade.calibrate, probePatch: facade.probePatch,
    renderLatest: facadeRenderLatest,
    stats: facade.stats, transports: facade.transports, activeTransport: facade.activeTransport,
    session: facade.session, lastError: facade.lastError,
    _facade: facade,
    generateKeyPair: generateKeyPair, deriveSessionKey: deriveSessionKey,
    pairingPayload: pairingPayload, parsePairingPayload: parsePairingPayload,
    _pure: {
      sha256: sha256, hmacSha256: hmacSha256, mac8: mac8, encodeFrame: encodeFrame, decodeFrame: decodeFrame,
      clampPose: clampPose, validatePose: validatePose, windowIndexOf: windowIndexOf, windowIdOf: windowIdOf, windowClamps: windowClamps,
      makeShortCode: makeShortCode, shortCodeHash4: shortCodeHash4, confirmCodeFromBytes: confirmCodeFromBytes,
      bytesToHex: bytesToHex, hexToBytes: hexToBytes, b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode,
      sessionTagOf: sessionTagOf, diffU32: diffU32, quatFromEuler: quatFromEuler, eulerFromQuat: eulerFromQuat,
      quatMul: quatMul, quatConj: quatConj, quatNormalize: quatNormalize,
      createSmoother: createSmoother, scanBackoffMs: scanBackoffMs, healthScore: healthScore, isHealthy: isHealthy,
      detectCapabilities: detectCapabilities, pairingPayload: pairingPayload, parsePairingPayload: parsePairingPayload, transportErrorReason: transportErrorReason,
      HEADER_LEN: HEADER_LEN, MAC_LEN: MAC_LEN
    }
  };
  try { Object.defineProperty(API, "role", { enumerable: true, get: function () { var n = facadeStateName(); return (n === "idle" || n === "disconnected" || n === "failed") ? null : F.role; } }); } catch (e) { API.role = null; }
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SYNC = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));


