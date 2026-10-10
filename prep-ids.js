/* PrepNucleus share IDs: every MCQ and lesson has a short ID a friend can type in to open the same thing. ES5.
   window.PREP_IDS, loaded by prep-loader.js after prep.js (optional: without it nothing changes). Draws through
   PREP._host. prep.js forwards every data-act starting "id-" here.

   ID format: Q-8K3-M7T-X26 (MCQ) and L-4FD-N0V-2RA (lesson). The type letter, then 8 Crockford base32 characters
   (0-9 and A-Z without I, L, O, U), then one check character, grouped in threes. The 8 characters are the first 40
   bits of SHA-256("prepnucleus:q:" + item id) or ("prepnucleus:l:" + lesson key), so an ID follows from the item's
   own immutable id: no migration, the same ID on every device and in every bank version, nothing about the content
   in it. The check character is Luhn mod 32 over the type and the 8 characters, so any single mistyped character
   and almost every swap of two neighbours is caught ("ID looks wrong", never a wrong question). Typing is forgiving:
   case, spaces and hyphens do not matter, O reads as 0 and I or L as 1.
   Collisions: two different items with the same 8 characters (about 1 in 100 at today's 190,000 items) never share
   an ID. The item that came later (not in the published index before; both new: the larger key) takes the long
   form, 10 characters + check (Q-8K3-M7T-X26-4Z), listed in the index ("xt"); tools/prep-ids.mjs assigns it and the
   test fails on any collision it did not resolve. Plan and proof: vault/modules/PrepNucleus.md "Share IDs".

   Global index (tools/prep-ids.mjs, R2 through /api/prep/bank/v1/ids/): index.json { v, gen, n, x, xt, s: 1024 x 6
   hex in one string } names 1024 shard files <2 chars>-<6 hex>.json { v, k, e: { "Q8K3M7TX2C": loc } }, where loc is "m:<subject>/
   <module>" (a bank or overlay question), "p" (a previous-year question), "l:<lesson key>" or "x" (withdrawn).
   Shard = the ID's first two body characters (about 190 entries, about 3 KB compressed). index.json is short-cached (it names the current shards); shards are immutable.
   Both are kept in IndexedDB, so an ID looked up once resolves offline. Offline without them, the questions and
   lessons already on the phone are hashed and matched. Pure helpers load under node for tests and the build tool. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var NS = { Q: "prepnucleus:q:", L: "prepnucleus:l:" };
  var PFX = { Q: 1, L: 2 };   // the type's value in the check sum, so a Q typed as L (or back) is caught
  var BODY = 8, LONG = 10, SHARDS = 1024;

  // SHA-256 of a string (UTF-8), as 32 bytes. Small and synchronous: an ID is drawn while a screen paints.
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) {
    var out = [], i, c, d;
    s = String(s);
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function sha256(str) {
    var b = utf8(str), n = b.length, i, j, t;
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor(n / 0x20000000), lo = (n * 8) >>> 0;
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var w = new Array(64);
    for (i = 0; i < b.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (b[i + 4 * j] << 24) | (b[i + 4 * j + 1] << 16) | (b[i + 4 * j + 2] << 8) | b[i + 4 * j + 3];
      for (j = 16; j < 64; j++) {
        var x = w[j - 15], y = w[j - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (j = 0; j < 64; j++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[j] + w[j]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        t = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
    return out;
  }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  // The first n*5 bits of bytes as n Crockford characters.
  function b32(bytes, n) {
    var out = "", acc = 0, bits = 0, i = 0;
    while (out.length < n) {
      if (bits < 5) { acc = (acc << 8) | bytes[i++]; bits += 8; }
      out += ALPHA.charAt((acc >>> (bits - 5)) & 31); bits -= 5; acc &= (1 << bits) - 1;
    }
    return out;
  }
  // Luhn mod 32 over [type value, body values]: the character that makes the sum 0.
  function luhn(vals) {
    var f = 2, sum = 0;
    for (var i = vals.length - 1; i >= 0; i--) { var a = f * vals[i]; f = f === 2 ? 1 : 2; sum += Math.floor(a / 32) + (a % 32); }
    return (32 - (sum % 32)) % 32;
  }
  function valid(vals) {
    var f = 1, sum = 0;
    for (var i = vals.length - 1; i >= 0; i--) { var a = f * vals[i]; f = f === 2 ? 1 : 2; sum += Math.floor(a / 32) + (a % 32); }
    return sum % 32 === 0;
  }
  function valsOf(type, body) { var v = [PFX[type]]; for (var i = 0; i < body.length; i++) v.push(ALPHA.indexOf(body.charAt(i))); return v; }
  function checkChar(type, body) { return ALPHA.charAt(luhn(valsOf(type, body))); }
  /* idFor("Q", "rm-58a3df33975a") -> "Q8K3M7TX2C": the compact ID (type, body, check). long: the 10-character body
     an item takes when its short body is already another item's (see "Collisions" above). */
  function idFor(type, key, long) {
    if (!NS[type]) throw new Error("type must be Q or L");
    var body = b32(sha256(NS[type] + key), long ? LONG : BODY);
    return type + body + checkChar(type, body);
  }
  // The shard an ID's entry lives in: its first two body characters (the first 10 bits of the hash), 0 to 1023.
  function shardOf(id) { return ALPHA.indexOf(id.charAt(1)) * 32 + ALPHA.indexOf(id.charAt(2)); }
  function shardKey(n) { return (ALPHA.charAt(n >> 5) + ALPHA.charAt(n & 31)).toLowerCase(); }
  // "Q8K3M7TX2C" -> "Q-8K3-M7T-X26" (long: "Q-8K3-M7T-X26-4Z": groups of three, the rest last).
  function show(id) {
    if (!id) return "";
    var t = id.charAt(0), r = id.slice(1), g = [];
    for (var i = 0; i < r.length; i += 3) g.push(r.slice(i, i + 3));
    return t + "-" + g.join("-");
  }
  /* norm(input) -> { ok, id } or { ok: false, err } for what a student typed or pasted:
     err "empty", "type" (does not start with Q or L), "length" (not 9 or 11 characters after it), "char" (a character
     that is never in an ID, e.g. U), "check" (the check character does not match: a typo). Spaces, hyphens, dots and
     case are ignored; O is read as 0, I and L (after the type letter) as 1. */
  function norm(input) {
    var s = String(input == null ? "" : input).toUpperCase().replace(/[\s\-_.·‐-―#]/g, "");
    if (!s) return { ok: false, err: "empty" };
    var t = s.charAt(0);
    if (t !== "Q" && t !== "L") return { ok: false, err: "type" };
    var r = s.slice(1).replace(/O/g, "0").replace(/[IL]/g, "1");
    if (r.length !== BODY + 1 && r.length !== LONG + 1) return { ok: false, err: "length" };
    for (var i = 0; i < r.length; i++) if (ALPHA.indexOf(r.charAt(i)) < 0) return { ok: false, err: "char" };
    if (!valid(valsOf(t, r))) return { ok: false, err: "check" };
    return { ok: true, id: t + r };
  }
  /* find(text) -> the first ID in a message (a pasted share: "Try this PrepNucleus question: Q-8K3-M7T-X26 (...)"),
     normalised, or null. Only a well-formed, checked ID counts, so ordinary words never match. */
  function find(text) {
    var s = String(text == null ? "" : text), re = /(^|[^0-9A-Za-z])([QLql])[ \-]?([0-9A-Za-z]{3})[ \-]?([0-9A-Za-z]{3})[ \-]?([0-9A-Za-z]{3})(?:[ \-]([0-9A-Za-z]{2}))?(?![0-9A-Za-z])/g, m;
    while ((m = re.exec(s))) {
      var r = norm(m[2] + m[3] + m[4] + m[5] + (m[6] || ""));
      if (r.ok) return r.id;
      if (m[6]) { r = norm(m[2] + m[3] + m[4] + m[5]); if (r.ok) return r.id; }
      re.lastIndex = m.index + 1;
    }
    return null;
  }
  /* looks(q) -> how a search box should treat q: "id" (a valid ID), "bad" (shaped like an ID, Q-XXX-XXX-XXX with the
     hyphens or one unbroken token with a digit, but the check fails: say it looks wrong), or "" (a word search).
     "Q fever test" stays a word search. */
  function looks(q) {
    var s = String(q == null ? "" : q).trim();
    if (!s) return "";
    if (norm(s).ok) return "id";
    if (find(s)) return "id";
    if (/^[QLql]\s*-\s*[0-9A-Za-z]{3}\s*-\s*[0-9A-Za-z]{3}\s*-\s*[0-9A-Za-z]{2,4}(\s*-\s*[0-9A-Za-z]{1,3})?$/.test(s)) return "bad";
    if (/^[QLql][0-9A-Za-z]{8,11}$/.test(s) && /[0-9]/.test(s)) return "bad";
    return "";
  }
  function errText(err) {
    return err === "check" ? "This ID looks wrong. Check each character and try again."
      : err === "type" ? "IDs start with Q (a question) or L (a lesson)."
      : err === "length" ? "An ID has 9 characters after the Q or L, like Q-8K3-M7T-X26."
      : err === "char" ? "This ID has a character IDs never use. Check it and try again."
      : "Type or paste an ID, like Q-8K3-M7T-X26.";
  }
  // The text a share sends: the ID and how to use it. Never an answer, a score or anything about the sender.
  function shareText(id) {
    var q = id.charAt(0) === "Q";
    return "Try this PrepNucleus " + (q ? "question" : "lesson") + ": " + show(id) + " (search this ID in PrepNucleus)";
  }
  /* parseLoc("m:radiology/rad-chest") -> { kind: "m", sid, mid }; "p" -> { kind: "p" }; "l:key" -> { kind: "l", key };
     "x" -> { kind: "x" }; anything else null. */
  function parseLoc(loc) {
    var s = String(loc || ""), m;
    if (s === "p") return { kind: "p" };
    if (s === "x" || s.indexOf("x:") === 0) return { kind: "x" };
    if ((m = /^m:([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})$/.exec(s))) return { kind: "m", sid: m[1], mid: m[2] };
    if ((m = /^l:([a-z0-9-]{2,120})$/.exec(s))) return { kind: "l", key: m[1] };
    return null;
  }
  /* The ID of an MCQ or lesson as shown: the long form when the published index lists its key (xt), else the short one.
     xt: { "q:<item id>": 1, "l:<key>": 1 }. */
  function idOf(type, key, xt) { return idFor(type, key, !!(xt && xt[type.toLowerCase() + ":" + key])); }
  // A shard file's name: <its two body characters, lower case>-<6 hex of its content hash>.json, e.g. 8k-1a2b3c.json.
  function shardFile(n, h) { return shardKey(n) + "-" + h + ".json"; }
  // The pointer's s is the 1024 shard hashes run together (6 hex each).
  function shardName(ptr, n) { var h = ptr && typeof ptr.s === "string" ? ptr.s.substr(n * 6, 6) : ""; return /^[0-9a-f]{6}$/.test(h) ? shardFile(n, h) : null; }
  function shardNames(ptr) { var out = []; for (var n = 0; n < SHARDS; n++) out.push(shardName(ptr, n)); return out; }

  var PURE = { ALPHA: ALPHA, NS: NS, BODY: BODY, LONG: LONG, SHARDS: SHARDS, sha256: sha256, hex: hex, b32: b32, luhn: luhn, valid: valid, checkChar: checkChar, idFor: idFor, idOf: idOf,
    shardOf: shardOf, shardKey: shardKey, shardFile: shardFile, shardName: shardName, shardNames: shardNames, show: show, norm: norm, find: find, looks: looks, errText: errText, shareText: shareText, parseLoc: parseLoc };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= app ================= */
  var D = G.document, VER = "v1", XT_KEY = "smd_prep_ids_xt";
  // The example ID in every hint: well formed (its check character is right) so typing it shows "No question has this ID".
  var EX = show("Q8K3M7TX2" + checkChar("Q", "8K3M7TX2"));
  var I = { host: null, ptr: null, ptrP: null, memo: {}, sheet: null, prev: null, tok: 0, res: null, resView: null, go: { v: "", err: "", hint: null, note: "" } };
  var SVG = {
    share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    check: '<path d="M5 12l5 5 9-10"/>', off: '<path d="M3 3l18 18M8.5 8.6A9 9 0 0 0 5 11M2 8a14 14 0 0 1 4-2.4M16 11.5a9 9 0 0 1 3 1.5M10.7 5.1A14 14 0 0 1 22 8M8.5 15a5 5 0 0 1 6.5-.5M12 19h.01"/>',
    gone: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>', what: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M9.5 9a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.6-.7 1.1M11 14h.01"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>'
  };
  function svg(n, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + SVG[n] + "</svg>"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Read one character at a time by a screen reader: "Q, 8, K, 3, ...".
  function spell(id) { return id.split("").join(" "); }
  // The ID in large type: the hyphens drawn lighter so the groups read first (the text copies as Q-8K3-M7T-X26).
  function codeHtml(id) { return show(id).split("-").map(esc).join('<i class="pi-h">-</i>'); }
  function word(id) { return id.charAt(0) === "L" ? "lesson" : "question"; }

  /* ---------- IDs of what is on screen ---------- */
  function xt() {
    if (I.ptr && I.ptr.xt) return I.ptr.xt;
    try { return JSON.parse(G.localStorage.getItem(XT_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  // Your own deck's questions stay on the phone: no ID.
  function ofItem(it) { if (!it || it.id == null || it._s === "deck") return null; var k = "q:" + it.id; return I.memo[k] || (I.memo[k] = idOf("Q", String(it.id), xt())); }
  function ofLesson(key) { if (!key) return null; var k = "l:" + key; return I.memo[k] || (I.memo[k] = idOf("L", String(key), xt())); }

  /* ---------- the global index ---------- */
  function api() { return ((I.host && I.host.bankApi) || G.SMD_PREP_BANK_API || "/api/prep/bank/") + VER + "/ids/"; }
  function getJSON(url) { return G.fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); }); }
  function cget(k) { var H = I.host; return H && H.cacheGet ? Promise.resolve(H.cacheGet(k)).then(null, function () { return null; }) : Promise.resolve(null); }
  function cput(k, v) { var H = I.host; try { if (H && H.cachePut) H.cachePut(k, v); } catch (e) {} }
  // The pointer names the current shards: network first (short cache), the IndexedDB copy offline.
  function loadPtr() {
    if (I.ptr) return Promise.resolve(I.ptr);
    if (I.ptrP) return I.ptrP;
    I.ptrP = getJSON(api() + "index.json").then(function (p) { cput(VER + "/ids/index.json", p); return p; }, function (e) {
      return cget(VER + "/ids/index.json").then(function (hit) { if (hit && hit.s) return hit; throw e; });
    }).then(function (p) {
      var x = JSON.stringify(p.xt || {});
      try { if (G.localStorage.getItem(XT_KEY) !== x) { G.localStorage.setItem(XT_KEY, x); I.memo = {}; } } catch (e) {}
      I.ptr = p; I.ptrP = null; return p;
    }, function (e) { I.ptrP = null; throw e; });
    return I.ptrP;
  }
  // A shard is immutable under its name: IndexedDB first, then the network.
  function loadShard(p, n) {
    var name = shardName(p, n);
    if (!name) return Promise.reject(new Error("bad index"));
    var key = VER + "/ids/" + name;
    return cget(key).then(function (hit) { return hit && hit.e ? hit : getJSON(api() + name).then(function (j) { cput(key, j); return j; }); });
  }
  // lookup(id) -> { loc } (null: the index has no such ID), { offline: true } or { missing: true } (no index published).
  function lookup(id) {
    return loadPtr().then(function (p) { return loadShard(p, shardOf(id)); }).then(function (sh) { return { loc: (sh && sh.e && sh.e[id]) || null }; },
      function (e) { return e && e.status === 404 ? { missing: true } : { offline: true }; });
  }
  function lessonIx() { var LS = G.PREP_LESSONS; return LS && LS.index ? LS.index() : Promise.reject(new Error("no lessons")); }
  /* Offline, with no index on the phone: hash what is on the phone. Lessons: the lesson index. Questions: every module
     and overlay file in IndexedDB, then the previous-year items. -> a loc or null. */
  function scanLocal(id) {
    var H = I.host;
    if (id.charAt(0) === "L") return lessonIx().then(function (ix) {
      var hit = null; Object.keys((ix && ix.modules) || {}).some(function (k) { if (ofLesson(k) === id) { hit = k; return true; } return false; });
      return hit ? "l:" + hit : null;
    }, function () { return null; });
    return Promise.resolve(H && H.cacheKeys ? H.cacheKeys() : null).then(null, function () { return null; }).then(function (keys) {
      var mods = [], pyq = [];
      (keys || []).forEach(function (k) {
        k = String(k);
        var m = /^v\d{1,3}\/([a-z0-9-]{2,60})\/mcq\/([a-z0-9-]{2,80})\.json$/.exec(k) || /^overlay\/[a-z0-9-]+\/([a-z0-9-]{2,60})\/([a-z0-9-]{2,80})\.json$/.exec(k);
        if (m) mods.push([k, m[1], m[2]]); else if (/^pyq\/items-[0-9a-f]{8}\.json$/.test(k)) pyq.push(k);
      });
      var i = 0;
      function has(f) { var items = (f && f.items) || []; for (var j = 0; j < items.length; j++) if (ofItem(items[j]) === id) return true; return false; }
      function next() {
        if (i < mods.length) { var x = mods[i++]; return cget(x[0]).then(function (f) { return has(f) ? "m:" + x[1] + "/" + x[2] : next(); }); }
        if (pyq.length) return cget(pyq.shift()).then(function (f) { return has(f) ? "p" : next(); });
        return Promise.resolve(null);
      }
      return next();
    });
  }
  /* resolve(id) -> { loc } | { offline } | { unknown }: the index (cached shards first), else what is on the phone. */
  function resolve(id) {
    return lookup(id).then(function (r) {
      if (r.loc) return { loc: r.loc };
      if (!r.offline && !r.missing) return { unknown: true };
      return scanLocal(id).then(function (loc) { return loc ? { loc: loc } : r.offline ? { offline: true } : { unknown: true }; });
    });
  }

  /* ---------- open an ID ---------- */
  function offlineErr(e) { return !(e && e.status) || (G.navigator && G.navigator.onLine === false); }
  /* open(raw, host): a well-formed ID opens the question (practice, unanswered) or the lesson at its start through the
     same paths as normal navigation (so the Pro gate and its upsell apply), after a short "finding" screen that becomes
     the message when it cannot (withdrawn, unknown, offline). A malformed one opens the Go to ID screen with the error. */
  function open(raw, host) {
    if (host) I.host = host;
    var H = I.host; if (!H) return;
    var n = norm(raw);
    if (!n.ok) return goScreen(H, String(raw || ""), errText(n.err));
    var id = n.id, tok = ++I.tok;
    closeSheet(true);
    I.res = { id: id, st: "look" };
    var view = function () { drawRes(); };
    I.resView = view;
    H.push(view);
    var alive = function () { return tok === I.tok && H.stackTop() === view; };
    var fail = function (st) { if (!alive()) return; I.res.st = st; drawRes(); };
    // Leave the "finding" screen, then hand over: back from the question returns where the student was.
    var leaveRes = function () { var s = H.stack(); if (s[s.length - 1] === view) s.pop(); };
    resolve(id).then(function (r) {
      if (!alive()) return;
      if (r.offline) return fail("offline");
      if (r.unknown) return fail("unknown");
      var loc = parseLoc(r.loc);
      if (!loc) return fail("unknown");
      if (loc.kind === "x") return fail("gone");
      if (loc.kind === "l") return openLesson(id, loc.key, alive, fail, leaveRes);
      I.res.st = "dl"; drawRes();
      if (loc.kind === "p") {
        var PY = G.PREP_PYQ;
        if (!PY || !PY.items) return fail("gone");
        return PY.items(H).then(function (items) {
          if (!alive()) return;
          var it = null; (items || []).forEach(function (x) { if (!it && ofItem(x) === id) it = x; });
          var ok = it && (PY._pure && PY._pure.usable ? PY._pure.usable(it, hiddenOf(H)) : H.pool([it]).length);
          if (!ok) return fail("gone");
          leaveRes(); H.run([it], "study", "Previous year question");
        }, function (e) { fail(offlineErr(e) ? "offline" : "fail"); });
      }
      return Promise.all([H.loadIndex(loc.sid).then(null, function () { return null; }), H.loadModule(loc.sid, loc.mid)]).then(function (r2) {
        if (!alive()) return;
        var it = null; (r2[1] || []).forEach(function (x) { if (!it && ofItem(x) === id) it = x; });
        if (!it || !H.pool([it]).length) return fail("gone");
        var t = null; ((r2[0] && r2[0].topics) || []).forEach(function (x) { if (x.id === loc.mid) t = x; });
        leaveRes(); H.run([it], "study", t ? H.tx(t.title) : "Shared question");
      }, function (e) { fail(offlineErr(e) ? "offline" : "fail"); });
    }, function () { fail("fail"); });
  }
  function hiddenOf(H) { try { var h = H.store().hid; return (h && h.ids) || {}; } catch (e) { return {}; } }
  // A lesson opens at its first step, through the same free-tier check as a tap on the lesson row.
  function openLesson(id, key, alive, fail, leaveRes) {
    var H = I.host, LS = G.PREP_LESSONS;
    if (!LS) return fail("gone");
    return lessonIx().then(function (ix) {
      if (!alive()) return;
      var meta = ix && ix.modules && ix.modules[key];
      if (!meta) return fail("gone");
      var mid = (meta && meta.module) || key, sid = H.subjectOfModule(mid);
      if (!sid) return fail("gone");
      leaveRes();
      if (G.PrepPro && !G.PrepPro.can("lessons", { module: mid })) { H.rerender(); return G.PrepPro.openLimit("lessons"); }
      if (G.PrepPro) G.PrepPro.use("lessons", { module: mid });
      LS.open(sid, mid, H, key, true);
    }, function () { fail("offline"); });
  }
  var RES = {
    offline: function (q) { return ["off", "Connect to open this " + q, "It is not on this phone yet. Once it opens online, it stays here for offline use.", [["id-retry", "Try again", 1]]]; },
    gone: function (q) { return ["gone", "This " + q + " is no longer available", q === "lesson" ? "It was taken out of PrepNucleus after review." : "It was withdrawn after review, so it no longer appears in PrepNucleus.", []]; },
    unknown: function (q) { return ["what", "No " + q + " has this ID", "Check the ID with the friend who sent it. O and 0, and I, L and 1, are read the same, so only the other characters can differ.", [["id-screen", "Enter another ID", 1]]]; },
    fail: function (q) { return ["off", "The " + q + " did not load", "Something went wrong on the way. Try again in a moment.", [["id-retry", "Try again", 1]]]; }
  };
  function drawRes() {
    var H = I.host, r = I.res; if (!H || !r) return;
    var q = word(r.id), busy = r.st === "look" || r.st === "dl", body;
    if (busy) {
      body = '<section class="pi-res" role="status" aria-live="polite"><p class="pi-code sm" translate="no"><span>' + codeHtml(r.id) + "</span></p>" +
        '<p class="pi-step">' + (r.st === "look" ? "Finding this " + q + "…" : "Downloading the " + q + "…") + "</p>" +
        '<span class="pi-meter" aria-hidden="true"><i class="' + (r.st === "dl" ? "s2" : "s1") + '"></i></span></section>';
    } else {
      var m = RES[r.st](q);
      body = '<section class="pi-res pi-msg" role="alert"><span class="pi-ic" aria-hidden="true">' + svg(m[0], 26) + "</span>" +
        "<h2 tabindex=\"-1\">" + esc(m[1]) + '</h2><p class="pi-mid">' + esc(m[2]) + '</p><p class="pi-code sm" translate="no"><span>' + codeHtml(r.id) + "</span></p>" +
        '<div class="pi-acts">' + m[3].map(function (a) { return '<button type="button" class="pn-btn' + (a[2] ? " pri" : "") + '" data-act="' + a[0] + '">' + esc(a[1]) + "</button>"; }).join("") +
        '<button type="button" class="pn-btn" data-act="back">' + (m[3].length ? "Back" : "Done") + "</button></div></section>";
    }
    H.paint(H.bar("Shared " + q, "", "back") + '<div class="pn-body pi-body">' + body + "</div>", busy ? null : ".pi-msg h2");
  }

  /* ---------- Go to ID ---------- */
  function goScreen(H, pre, err) {
    if (H) I.host = H;
    I.go = { v: pre || "", err: err || "", hint: null, note: "" };
    I.host.push(drawGo);
  }
  function canPaste() { try { return !!(G.navigator && G.navigator.clipboard && G.navigator.clipboard.readText); } catch (e) { return false; } }
  function drawGo() {
    var H = I.host, g = I.go;
    H.paint(H.bar("Open an ID", "", "back") + '<div class="pn-body pi-body pi-go"><form class="pi-form" id="piForm" novalidate>' +
      '<label class="pi-lab" for="piIn">Question or lesson ID</label>' +
      '<div class="pi-row"><input id="piIn" name="prepid" class="pn-in pi-in" type="text" translate="no" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" maxlength="40" placeholder="' + EX + '" value="' + esc(g.v) + '" aria-describedby="' + (g.err ? "piErr" : "piHelp") + '"' + (g.err ? ' aria-invalid="true"' : "") + ">" +
      (canPaste() ? '<button type="button" class="pn-btn pi-paste" data-act="id-paste">Paste</button>' : "") + "</div>" +
      (g.err ? '<p class="pi-err" id="piErr" role="alert">' + esc(g.err) + "</p>" : '<p class="pn-mut pn-small pi-help" id="piHelp">' + esc(g.note || "Questions start with Q, lessons with L. Case, spaces and hyphens do not matter.") + "</p>") +
      (g.hint ? '<div class="pn-group pi-hintg"><button type="button" class="pn-row pi-hint" data-act="id-go" data-v="' + g.hint + '"><span class="pn-ri" aria-hidden="true">' + svg("hash") + '</span><span class="pn-rb"><b>Open ' + show(g.hint) + "</b><small>The " + word(g.hint) + " ID on your clipboard</small></span></button></div>" : "") +
      '<button type="submit" class="pn-btn pri pi-open">Open</button></form>' +
      '<p class="pn-note">Every question and lesson has an ID under its Share button. Send one to a friend, or open one a friend sent you.</p></div>', g.err ? "#piIn" : null);
    var r = H.root(), f = r && r.querySelector("#piForm"), inp = r && r.querySelector("#piIn"), on = G.PREP_DOM && G.PREP_DOM.on;
    if (!f || !on) return;
    on(f, "pi", "submit", function (e) { e.preventDefault(); submitGo(); });
    on(inp, "pi", "input", function () { g.v = inp.value; if (g.err || g.hint) { g.err = ""; g.hint = null; drawGo(); } });
  }
  function submitGo() {
    var H = I.host, r = H.root(), inp = r && r.querySelector("#piIn"), v = inp ? inp.value : I.go.v;
    I.go.v = v;
    var n = norm(v);
    if (!n.ok) { var f = find(v); if (f) n = { ok: true, id: f }; }
    if (!n.ok) { I.go.err = errText(n.err); I.go.hint = null; return drawGo(); }
    try { if (inp) inp.blur(); } catch (e) {}
    open(n.id);
  }
  // Paste reads the clipboard only on this tap (never by itself) and offers the ID it finds.
  function readClip() {
    if (!canPaste()) return Promise.reject(new Error("no clipboard"));
    return G.navigator.clipboard.readText().then(function (t) { var n = norm(t); return find(t) || (n.ok ? n.id : null); });
  }
  function pasteGo() {
    readClip().then(function (id) {
      if (!id) { I.go.hint = null; I.go.err = ""; I.go.note = "No question or lesson ID on the clipboard. Copy the whole message or just the ID, then try again."; return drawGo(); }
      I.go.v = show(id); I.go.err = ""; I.go.hint = id; I.go.note = ""; drawGo();
      // a focused field keeps what was typed through a repaint, so the pasted ID is put in directly
      var r = I.host.root(), inp = r && r.querySelector("#piIn"); if (inp) inp.value = I.go.v;
    }, function () { I.go.note = "PrepNucleus could not read the clipboard. Long-press the box and choose Paste."; drawGo(); });
  }

  /* ---------- search ---------- */
  // The subject search box: an ID typed or pasted there opens it; one that looks like an ID but fails the check says so.
  function searchHtml(q) {
    var k = looks(q);
    if (k === "id") { var n = norm(q), id = n.ok ? n.id : find(q); return '<ul class="pn-mods"><li><button type="button" class="pn-mod pi-shit" data-act="id-go" data-v="' + id + '"><span class="pn-ic sm" aria-hidden="true">' + svg("hash") + '</span><span class="pn-mb"><b>Open ' + show(id) + "</b><small>The shared " + word(id) + " with this ID</small></span></button></li></ul>"; }
    if (k === "bad") return '<p class="pi-err" role="alert">' + esc(errText(norm(q).err === "check" || norm(q).err === "char" ? norm(q).err : "check")) + "</p>";
    return null;
  }
  function searchExtra() { return canPaste() ? '<button type="button" class="pn-link pi-spaste" data-act="id-spaste">Paste a shared ID</button>' : ""; }
  function pasteSearch() {
    var H = I.host, r = H && H.root(), box = r && r.querySelector("#pnHits");
    readClip().then(function (id) {
      if (!box) return;
      box.innerHTML = id ? searchHtml(show(id)) : '<p class="pn-mut pn-small" role="status">No question or lesson ID on the clipboard.</p>';
    }, function () { if (box) box.innerHTML = '<p class="pn-mut pn-small" role="status">PrepNucleus could not read the clipboard. Long-press the search box and choose Paste.</p>'; });
  }

  /* ---------- share ---------- */
  function shareKind() {
    try { var C = G.Capacitor; if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Share && C.Plugins.Share.share) return "cap"; } catch (e) {}
    return G.navigator && typeof G.navigator.share === "function" ? "web" : "";
  }
  function shareBtn(id, label) { return id ? '<button type="button" class="pn-ib pi-sb" data-act="id-share" data-v="' + id + '" aria-label="' + esc(label || "Share this " + word(id)) + '">' + svg("share") + "</button>" : ""; }
  function chip(id) {
    return id ? '<button type="button" class="pi-chip" data-act="id-copy" data-v="' + id + '" aria-label="Copy the ' + word(id) + " ID, " + spell(id) + '"><span class="pi-chip-k">ID</span><span class="pi-chip-v" translate="no">' + show(id) + '</span><span class="pi-chip-i">' + svg("copy", 15) + "</span></button>" : "";
  }
  function openShare(id, from) {
    var H = I.host, root = H && H.root && H.root();
    if (!root || !norm(id).ok) return false;
    closeSheet(true);
    var q = word(id), k = shareKind(), el = D.createElement("div");
    el.className = "pn-sheet-wrap"; el.id = "piSheet";
    var copyB = '<button type="button" class="pn-btn pi-copy' + (k ? "" : " pri") + '" data-act="id-copy" data-v="' + id + '"><span class="pi-cl">' + svg("copy", 18) + " Copy ID</span></button>";
    el.innerHTML = '<div class="pn-scrim" data-act="id-close"></div><section class="pn-sheet pi-sheet" role="dialog" aria-modal="true" aria-labelledby="piSheetT" aria-describedby="piSheetD" tabindex="-1">' +
      '<span class="pn-grab" aria-hidden="true"></span><h2 id="piSheetT">Share this ' + q + "</h2>" +
      '<p class="pi-code" translate="no" aria-label="ID ' + spell(id) + '"><span>' + codeHtml(id) + "</span></p>" +
      '<p class="pn-mut pi-how" id="piSheetD">' + (q === "question" ? "A friend searches this ID in PrepNucleus and gets the same question, unanswered." : "A friend searches this ID in PrepNucleus and opens the same lesson.") + "</p>" +
      '<p class="pn-sr" id="piLive" aria-live="polite"></p>' +
      '<div class="pn-sheet-act">' + (k ? '<button type="button" class="pn-btn pri" data-act="id-send" data-v="' + id + '">' + svg("share", 18) + " Share</button>" : "") + copyB + "</div></section>";
    I.prev = from || D.activeElement;
    root.appendChild(el); I.sheet = el;
    el.addEventListener("keydown", trap);
    var f = el.querySelector(".pn-sheet-act .pn-btn.pri") || el.querySelector(".pn-sheet-act .pn-btn"); try { f.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }
  function trap(e) {
    if (e.key !== "Tab" || !I.sheet) return;
    var b = I.sheet.querySelectorAll("button"), first = b[0], last = b[b.length - 1];
    if (e.shiftKey && D.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeSheet(quiet) {
    if (!I.sheet) return false;
    if (I.sheet.parentNode) I.sheet.parentNode.removeChild(I.sheet);
    I.sheet = null;
    if (!quiet) try { if (I.prev && I.prev.isConnected) I.prev.focus({ preventScroll: true }); } catch (e) {}
    return true;
  }
  function legacyCopy(t) {
    var a = D.createElement("textarea"), ok = false;
    a.value = t; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.top = "0"; a.style.opacity = "0";
    D.body.appendChild(a); a.select();
    try { ok = D.execCommand("copy"); } catch (e) { ok = false; }
    D.body.removeChild(a); return ok;
  }
  function copyText(t) {
    try { if (G.navigator.clipboard && G.navigator.clipboard.writeText) return G.navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); }); } catch (e) {}
    return Promise.resolve(legacyCopy(t));
  }
  function haptic(k) { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS[k]) G.SMD_HAPTICS[k](); } catch (e) {} }
  // Copy: the ID only (Q-8K3-M7T-X26). The button says "Copied" for a moment; a screen reader hears it.
  function copy(id, b) {
    copyText(show(id)).then(function (ok) {
      var H = I.host, live = I.sheet && I.sheet.querySelector("#piLive");
      if (!ok) { if (H) H.toast("Copy did not work here. Long-press the ID to select it."); return; }
      haptic("light");
      if (live) live.textContent = "ID copied";
      if (b && b.classList && b.isConnected) {
        b.classList.add("pi-done");
        var lab = b.querySelector(".pi-cl, .pi-chip-v"), was = lab ? lab.innerHTML : null;
        if (lab && b.classList.contains("pi-copy")) lab.innerHTML = svg("check", 18) + " Copied";
        else if (lab) lab.textContent = "Copied";
        G.setTimeout(function () { if (!b.isConnected) return; b.classList.remove("pi-done"); if (lab && was != null) lab.innerHTML = was; }, 1600);
      }
      if (!live && H) H.toast("ID copied");
    });
  }
  // Share: the native share sheet (Capacitor Share in the app, navigator.share on the web), else copy. Text only: the ID
  // and how to use it. No link: no web page opens a PrepNucleus question (vault/modules/PrepNucleus.md "Share IDs").
  function send(id, b) {
    var k = shareKind(), text = shareText(id), p;
    try {
      p = k === "cap" ? G.Capacitor.Plugins.Share.share({ title: "PrepNucleus " + word(id), text: text, dialogTitle: "Share " + show(id) })
        : k === "web" ? G.navigator.share({ title: "PrepNucleus " + word(id), text: text }) : null;
    } catch (e) { p = null; }
    if (!p || !p.then) return copy(id, I.sheet && I.sheet.querySelector(".pi-copy"));
    p.then(function () { haptic("light"); }, function (e) {
      if (/cancel|abort/i.test(String((e && (e.name + " " + e.message)) || e))) return;
      copy(id, I.sheet && I.sheet.querySelector(".pi-copy"));
    });
  }

  /* ---------- wiring ---------- */
  function act(a, b, H) {
    if (H) I.host = H;
    var v = b && b.getAttribute ? b.getAttribute("data-v") : null;
    if (a === "id-share") return openShare(v, b);
    if (a === "id-close") return closeSheet(false);
    if (a === "id-copy") return v && norm(v).ok && copy(norm(v).id, b);
    if (a === "id-send") return v && send(v, b);
    if (a === "id-go") return open(v);
    if (a === "id-screen") { if (I.res && I.host.stackTop() === I.resView) I.host.stack().pop(); return goScreen(I.host, "", ""); }
    if (a === "id-retry") { var r = I.res; if (r) { var s = I.host.stack(); if (s[s.length - 1] === I.resView) s.pop(); return open(r.id); } return; }
    if (a === "id-paste") return pasteGo();
    if (a === "id-spaste") return pasteSearch();
  }
  function back() { return closeSheet(false); }
  function leave() { closeSheet(true); I.tok++; I.res = null; }

  G.PREP_IDS = { ofItem: ofItem, ofLesson: ofLesson, open: open, goScreen: goScreen, act: act, back: back, leave: leave, chip: chip, shareBtn: shareBtn, openShare: openShare,
    looks: looks, searchHtml: searchHtml, searchExtra: searchExtra, resolve: resolve, EX: EX, _pure: PURE, _i: I };
})(typeof window !== "undefined" ? window : this);
