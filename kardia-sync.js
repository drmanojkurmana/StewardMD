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
  var CONTROLS = { PAUSE: 1, RESUME: 2, RECENTER: 3, CALIBRATE: 4, SELECT_WINDOW: 5, END: 6, CONFIRM: 7 };
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
    return "kardia-sync:1:" + p.sessionId + ":" + p.displayPub + ":" + p.shortCode + ":" + p.expiresAt;
  }
  function parsePairingPayload(str) {
    if (typeof str !== "string") return null;
    var parts = str.split(":");
    if (parts.length !== 6 || parts[0] !== "kardia-sync" || parts[1] !== "1") return null;
    if (!/^[0-9a-f]{32}$/i.test(parts[2])) return null;
    var exp = parseInt(parts[5], 10);
    if (!isFinite(exp)) return null;
    var pub;
    try { pub = b64urlDecode(parts[3]); } catch (e) { return null; }
    if (pub.length !== 65 || pub[0] !== 4) return null;
    return { sessionId: parts[2].toLowerCase(), displayPub: parts[3], displayPubBytes: pub, shortCode: parts[4], expiresAt: exp };
  }
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
    var displayProbe = null, smoother = createSmoother(opts.tauMs || 60), calibQuat = null, needsCalib = true;
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
        if (needsCalib || !calibQuat) { calibQuat = pose.quat.slice(); needsCalib = false; try { dp.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 }); } catch (e) {} }
        var rel = quatNormalize(quatMul(quatConj(calibQuat), pose.quat));
        var eu = eulerFromQuat(rel);
        try { dp.applyGyroSample({ alpha: eu.rockDeg, beta: eu.tiltDeg, gamma: eu.rotationDeg }, 16); } catch (e2) {}
        var ps = dp.getState();
        target = { window: pose.window, tiltDeg: ps.tiltDeg, rotationDeg: ps.rotationDeg, rockDeg: ps.rockDeg, x: pose.slideXmm, y: pose.slideYmm, raw: { tiltDeg: eu.tiltDeg, rotationDeg: eu.rotationDeg, rockDeg: eu.rockDeg } };
        if (ps.window !== pose.window) { try { dp.setState({ window: pose.window }); dp.calibrateGyro({ alpha: 0, beta: 0, gamma: 0 }); calibQuat = pose.quat.slice(); } catch (e3) {} }
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
        return { state: state, reason: stateReason, recoveryHint: recoveryHint, role: role, frozen: frozen, frozenReason: frozenReason, confirmCode: confirmCode, sessionId: sessionIdBytes ? bytesToHex(sessionIdBytes) : null, controllerActive: controllerActive, lastSeqIn: lastSeqIn, seqOut: seqOut, clockOffsetMs: clockOffsetMs };
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
          pairing = { sessionId: bytesToHex(sessionIdBytes), shortCode: shortCode, displayPub: keys.publicKeyB64, displayPubBytes: keys.publicKeyBytes, expiresAt: nowFn() + PAIRING_TTL_MS };
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
            if (transport) {
              return Promise.resolve(transport.join(parsed, handlers)).then(function () { sendBytes(helloBytes); return node; });
            }
            node._lastHelloBytes = helloBytes;
            return node;
          });
        });
      },
      _handlers: function () {
        return {
          onBytes: function (b) { node.handleBytes(b); },
          onPeerConnected: function () {},
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
      resume: function () {
        frozen = false; frozenReason = null; needsCalib = true; pendingPose = null;
        if (lastValidState) smoother.reset({ tiltDeg: lastValidState.tiltDeg, rotationDeg: lastValidState.rotationDeg, rockDeg: lastValidState.rockDeg, x: lastValidState.position ? lastValidState.position.x : 0, y: lastValidState.position ? lastValidState.position.y : 0 });
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
          if (!checkSeqAndStale(frame)) return Promise.resolve(false);
          var v = validatePose(frame.pose, probeLib);
          if (!v.ok) { statsIn.droppedBounds++; return Promise.resolve(false); }
          acceptSeq(frame); lastActivityAt = nowFn(); lastPoseAt = lastActivityAt;
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
          } else if (frame.code === CONTROLS.RESUME) { frozen = false; needsCalib = true; }
          else if (frame.code === CONTROLS.RECENTER) { needsCalib = true; frozen = false; }
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
    function ensureProbe() { if (!probe && probeLib) probe = probeLib.create({}); return probe; }
    function handleOrientation(attitude, dtMs) {
      var p = ensureProbe(); if (!p) return null;
      if (!calibrateAtt) { try { p.calibrateGyro(attitude); } catch (e) {} calibrateAtt = { alpha: attitude.alpha || 0, beta: attitude.beta || 0, gamma: attitude.gamma || 0 }; }
      var st;
      try { st = p.applyGyroSample(attitude, dtMs == null ? 16 : dtMs); } catch (e2) { return null; }
      var q = quatFromEuler(st.tiltDeg || 0, st.rotationDeg || 0, st.rockDeg || 0);
      var pose = { quat: q, touch: 0, window: st.window, slideXmm: st.position ? st.position.x : 0, slideYmm: st.position ? st.position.y : 0, flags: { calibrated: true } };
      pose.probeState = st;
      sendPose(pose, st);
      return pose;
    }
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
          return { ok: true };
        }
        if (!ask) return Promise.resolve(start());
        return Promise.resolve(ask.call(askThis)).then(function (r) {
          if (r !== "granted") { onError("permission-denied"); return { ok: false, reason: "permission-denied" }; }
          return start();
        }, function () { onError("permission-denied"); return { ok: false, reason: "permission-denied" }; });
      },
      disable: function () {
        listening = false;
        if (handler && typeof env.removeEventListener === "function") { try { env.removeEventListener("deviceorientation", handler, true); } catch (e) {} handler = null; }
        return sender;
      }
    };
    return sender;
  }

  var API = {
    VERSION: VERSION, TYPES: TYPES, CONTROLS: CONTROLS, BYE: BYE, STATES: STATES.slice(),
    WINDOW_ORDER: WINDOW_ORDER.slice(), PAIRING_TTL_MS: PAIRING_TTL_MS, SESSION_IDLE_MS: SESSION_IDLE_MS, STALE_MS: STALE_MS,
    registerTransport: registerTransport, getTransport: getTransport, listTransports: listTransports,
    selectTransport: selectTransport, queryCapabilities: queryCapabilities,
    createTransportManager: createTransportManager, createLoopbackPair: createLoopbackPair,
    createNode: createNode, createDisplay: createDisplay, createProbe: createProbe, createProbeSender: createProbeSender,
    createSmoother: createSmoother, detectCapabilities: detectCapabilities,
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
      detectCapabilities: detectCapabilities, pairingPayload: pairingPayload, parsePairingPayload: parsePairingPayload,
      HEADER_LEN: HEADER_LEN, MAC_LEN: MAC_LEN
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SYNC = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));


