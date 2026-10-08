/* PrepNucleus sync: opt-in, end-to-end encrypted progress sync across one user's devices. window.PREP_SYNC. ES5.
   Server: functions/api/prep/sync/[[path]].js keeps one opaque blob per user (D1 prep_sync) with a version for
   compare-and-set. Loaded by prep-loader.js after prep.js; pure helpers load under node for tests.

   THREAT MODEL. Key = HKDF-SHA256(uid, per-user random server salt, "prepnucleus-sync-v1") -> AES-GCM-256; the blob is
   [flag][12-byte IV][ciphertext], flag 1 = gzip(JSON), 2 = raw JSON (no CompressionStream); the AAD is the info string
   plus the flag byte. It protects the progress against a database or backup leak and against anyone without the uid.
   It does NOT protect against the server operator running modified code: the server sees the uid on every
   authenticated request and holds the salt. Closing that needs a secret only the user holds (a passphrase or
   recovery code, with its own lost-code UX), which this does not have. The server sees: blob size, update times,
   and sha256("prep-sync|" + uid).

   Local state: localStorage smd_prep_sync_v1 = { on, dev, seq, ver, doc, uid, fresh, at, err } (doc = the last merged
   doc without its card base b). Reviews reach the log through specialty-core.js review(): it appends
   [cardKey, day, g, ms] to store.rl, which exists only while sync is on.

   Doc (the plaintext) = { v: 1, b: { cardKey: card } base cards, hw: { dev: last folded seq }, ev: [[id, cardKey,
   day, g, ms]] (id = dev + "." + seq), c: { dev: { "d|<day>" | "m|<mid>|t" | "m|<mid>|ok": n } }, ml: { mid: max last
   day }, kv: { path: [ts, value | null] }, mh: [finished mocks] }.
   - Cards = b, then every unfolded event replayed in (day, ms, dev, seq) order with specialty-core's own math. The
     server's b is the base (If-Match makes it the linearization point). A first sync (or one after the server copy
     was wiped) has no shared history: it takes, card by card, the one further along (reps, then last day, then due
     day) of the server's cards and this device's, and folds all server events into that base.
   - Events older than 30 days are folded into b before upload (per device, a seq prefix; hw[dev] records it). The one
     approximation: an event that arrives after its day was cut (a device offline for over 30 days) is replayed on
     top of b, after later reviews from other devices.
   - A local card further along (more reps) than the recomputed one changed outside the log; it is kept on this
     device, never dropped.
   - days and mod[mid].t/.ok are per-device grow-only counters (slot max, value = sum): replaying a merge or losing
     a PUT response cannot double count. mod[mid].last is a max. conf, dl, hid, fc, sims stay on the device.
   - exam, goal, last, pl, pt, lsp, ra, ask, cel, ml and every key of bm, mt, rep, ls are last-writer-wins registers with a hybrid
     clock: a local change (found by diffing against the last merged doc) is stamped max(now, newest stamp this device
     has seen + 1), so an edit made after seeing a value beats it even on a slow clock. Concurrent edits: the later
     wall clock wins; ties by JSON string. A deleted map key is a [ts, null] tombstone.
   - mh: union by ts, newest 20.
   Known limits: deleting cards (prep-create purgeStore) is not synced, other devices keep them; counters never go
   down. */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  // ask (Ask MaiK choice), cel (celebrated milestones), ml (MaiK line rotation): owner 2026-10-09, plain registers.
  var SCALARS = ["exam", "goal", "last", "pl", "pt", "lsp", "ra", "ask", "cel", "ml"], MAPS = ["bm", "mt", "rep", "ls"];
  var KEEP_DAYS = 30, TOMB_MS = 120 * 864e5, MH_MAX = 20, INFO = "prepnucleus-sync-v1";
  var _core = null;
  function core() { return _core || (_core = (G && G.SPECIALTY_CORE) || require("./specialty-core.js")); }
  function js(v) { return JSON.stringify(v === undefined ? null : v); }
  function clone(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function devOf(id) { return id.slice(0, id.lastIndexOf(".")); }
  function seqOf(id) { return +id.slice(id.lastIndexOf(".") + 1); }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function maxMap(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) if (!(o[k] >= b[k])) o[k] = b[k]; return o; }

  function evOrder(a, b) {
    var da = devOf(a[0]), db = devOf(b[0]);
    return a[2] - b[2] || a[4] - b[4] || (da < db ? -1 : da > db ? 1 : seqOf(a[0]) - seqOf(b[0]));
  }
  // Cards from a base and events, by specialty-core's review (a card key is deck + ":" + item; split at the last ":").
  function replay(base, evs) {
    var tmp = { cards: {}, days: {} }, k;
    for (k in base) tmp.cards[k] = base[k].slice();
    evs.slice().sort(evOrder).forEach(function (e) { var i = e[1].lastIndexOf(":"); core().review(tmp, e[1].slice(0, i), e[1].slice(i + 1), e[3], e[2]); });
    return tmp.cards;
  }
  // The card further along: more reviews, then the later last review, then the later due day (then JSON, for determinism).
  function better(a, b) {
    if (!a || !b) return a || b;
    var x = a[4] - b[4] || a[2] - b[2] || a[3] - b[3];
    if (!x) x = js(a) >= js(b) ? 1 : -1;
    return x > 0 ? a : b;
  }

  function kvOf(store) {
    var out = {};
    SCALARS.forEach(function (p) { out[p] = store[p] === undefined ? null : store[p]; });
    MAPS.forEach(function (m) { var o = store[m] || {}; for (var id in o) out[m + "." + id] = o[id]; });
    return out;
  }
  function maxTs(kv) { var t = 0; for (var k in kv) if (kv[k][0] > t) t = kv[k][0]; return t; }
  // This device's registers: the last merged ones plus what changed since. Without a last merged kv (first sync),
  // local values get ts 0 and only where the server has no value, so a new phone's defaults never override real data.
  function localKv(store, prev, remoteKv, now) {
    var cur = kvOf(store), out = {}, k, t = Math.max(now, (prev ? maxTs(prev) : 0) + 1), all = {};
    for (k in prev) { out[k] = prev[k]; all[k] = 1; }
    for (k in cur) all[k] = 1;
    for (k in all) {
      var v = own(cur, k) ? cur[k] : null, p = prev && prev[k];
      if (p ? js(p[1]) === js(v) : v === null) continue;
      if (prev) out[k] = [t, clone(v)];
      else if (!own(remoteKv, k)) out[k] = [0, clone(v)];
    }
    return out;
  }
  function win(a, b) {
    if (!a || !b) return a || b;
    return a[0] !== b[0] ? (a[0] > b[0] ? a : b) : js(a[1]) >= js(b[1]) ? a : b;
  }
  function mergeKv(a, b, now) {
    var out = {}, k;
    for (k in a) out[k] = a[k];
    for (k in b) out[k] = win(out[k], b[k]);
    // ponytail: map tombstones older than 120 days are dropped; a device offline longer than that can bring a deleted key back.
    for (k in out) if (out[k][1] === null && k.indexOf(".") > 0 && out[k][0] < now - TOMB_MS) delete out[k];
    return out;
  }
  function applyKv(store, kv) {
    SCALARS.forEach(function (p) { if (own(kv, p)) store[p] = clone(kv[p][1]); });
    MAPS.forEach(function (m) {
      var o = store[m] || (store[m] = {}), want = {}, k;
      for (k in kv) if (k.indexOf(m + ".") === 0 && kv[k][1] !== null) want[k.slice(m.length + 1)] = kv[k][1];
      for (k in o) if (!own(want, k)) delete o[k];
      for (k in want) if (js(o[k]) !== js(want[k])) o[k] = clone(want[k]);
    });
  }

  function countsOf(store) {
    var out = {}, k, m;
    for (k in store.days) out["d|" + k] = store.days[k] || 0;
    for (k in store.mod) { m = store.mod[k] || {}; out["m|" + k + "|t"] = m.t || 0; out["m|" + k + "|ok"] = m.ok || 0; }
    return out;
  }
  function sumC(c, skip) {
    var out = {}, d, k;
    for (d in c) if (d !== skip) for (k in c[d]) out[k] = (out[k] || 0) + c[d][k];
    return out;
  }
  function mergeC(a, b) { var out = {}, d; for (d in a) out[d] = a[d]; for (d in b) out[d] = maxMap(out[d] || {}, b[d]); return out; }

  function mergeMh(a, b) {
    var by = {};
    a.concat(b).forEach(function (h) { if (h && h.ts && (!by[h.ts] || js(h) > js(by[h.ts]))) by[h.ts] = h; });
    return values(by).sort(function (x, y) { return x.ts - y.ts; }).slice(-MH_MAX);
  }

  function norm(d) {
    d = d || {};
    if (d.v && d.v !== 1) throw new Error("newer-format");
    return { v: 1, b: d.b || {}, hw: d.hw || {}, ev: d.ev || [], c: d.c || {}, ml: d.ml || {}, kv: d.kv || {}, mh: d.mh || [] };
  }
  function view(s) { return js([s.cards, s.days, s.mod, kvOf(s), s.mh]); }

  /* Merge the server doc (null when there is none) into the live store IN PLACE (prep.js and others hold the object).
     S = local sync state: reads S.doc, S.dev, S.fresh; advances S.seq. Returns { doc, changed }: the merged doc,
     not yet compacted. The caller saves the store. */
  function mergeInto(store, S, remoteDoc, now, today) {
    ["cards", "days", "mod"].forEach(function (f) { if (!store[f] || typeof store[f] !== "object") store[f] = {}; });
    if (!Array.isArray(store.mh)) store.mh = [];
    var prev = S.doc || null, me = S.dev, R = norm(remoteDoc), fresh = !!S.fresh || !remoteDoc, before = view(store), k;

    // 1. review log -> events (a log entry already in the last doc is skipped, if a save was lost between the two)
    var had = {}, evNew = [];
    ((prev && prev.ev) || []).forEach(function (e) { if (devOf(e[0]) === me) had[e[1] + "|" + e[4]] = 1; });
    (store.rl || []).forEach(function (r) { if (!had[r[0] + "|" + r[3]]) evNew.push([me + "." + (S.seq = (S.seq || 0) + 1), r[0], r[1], r[2], r[3]]); });
    if (store.rl) store.rl.length = 0;

    // 2. cards
    var hw = maxMap(R.hw, (prev && prev.hw) || {}), b, ev, cards;
    if (fresh) {
      // No shared history: the local cards already hold this device's reviews, so its log is not replayed.
      cards = replay(R.b, R.ev);
      R.ev.forEach(function (e) { var d = devOf(e[0]); if (!(hw[d] >= seqOf(e[0]))) hw[d] = seqOf(e[0]); });
      for (k in store.cards) cards[k] = better(cards[k], store.cards[k]);
      b = cards; ev = [];
    } else {
      var byId = {};
      [R.ev, (prev && prev.ev) || [], evNew].forEach(function (list) {
        list.forEach(function (e) { if (seqOf(e[0]) > (hw[devOf(e[0])] || 0)) byId[e[0]] = e; });
      });
      b = R.b; ev = values(byId); cards = replay(b, ev);
      for (k in store.cards) if (!cards[k] || store.cards[k][4] > cards[k][4]) cards[k] = store.cards[k];
    }
    for (k in cards) if (js(store.cards[k]) !== js(cards[k])) store.cards[k] = cards[k].slice();

    // 3. counters: my slot = local total minus the other devices' slots I had merged
    var others = sumC((prev && prev.c) || {}, me), local = countsOf(store), mine = {};
    for (k in local) mine[k] = Math.max(0, local[k] - (others[k] || 0));
    var c = mergeC(R.c, (prev && prev.c) || {});
    c[me] = maxMap(c[me] || {}, mine);
    var tot = sumC(c, null), ml = maxMap(R.ml, (prev && prev.ml) || {});
    for (k in store.mod) if (store.mod[k] && store.mod[k].last != null && !(ml[k] >= store.mod[k].last)) ml[k] = store.mod[k].last;
    for (k in tot) {
      if (k.charAt(0) === "d") { store.days[k.slice(2)] = tot[k]; continue; }
      var mid = k.slice(2, k.lastIndexOf("|")), mo = store.mod[mid] || (store.mod[mid] = { t: 0, ok: 0 });
      mo[k.slice(k.lastIndexOf("|") + 1)] = tot[k];
    }
    for (k in ml) { var mm = store.mod[k] || (store.mod[k] = { t: 0, ok: 0 }); mm.last = ml[k]; }

    // 4. registers and mocks
    var kv = mergeKv(R.kv, localKv(store, prev && prev.kv, R.kv, now), now);
    applyKv(store, kv);
    var mh = mergeMh(R.mh, store.mh);
    store.mh.length = 0; Array.prototype.push.apply(store.mh, clone(mh));

    return { doc: { v: 1, b: b, hw: hw, ev: ev, c: c, ml: ml, kv: kv, mh: mh }, changed: view(store) !== before };
  }

  // Fold events older than 30 days into b: per device, the longest seq prefix of old events (so hw stays a prefix).
  function compact(doc, today) {
    var cut = today - KEEP_DAYS, hw = maxMap(doc.hw, {}), byDev = {}, fold = [], keep = [];
    doc.ev.forEach(function (e) { (byDev[devOf(e[0])] || (byDev[devOf(e[0])] = [])).push(e); });
    Object.keys(byDev).forEach(function (d) {
      var open = true;
      byDev[d].sort(function (x, y) { return seqOf(x[0]) - seqOf(y[0]); }).forEach(function (e) {
        if (open && e[2] < cut) { fold.push(e); hw[d] = seqOf(e[0]); } else { open = false; keep.push(e); }
      });
    });
    return { v: 1, b: fold.length ? replay(doc.b, fold) : doc.b, hw: hw, ev: keep.sort(evOrder), c: doc.c, ml: doc.ml, kv: doc.kv, mh: doc.mh };
  }
  // What the device keeps of a doc: everything but the card base (the store holds the cards; the server holds b).
  function strip(doc) { var o = {}; for (var k in doc) if (k !== "b") o[k] = doc[k]; return o; }

  // One sync round on a decrypted server doc: merge in place, remember the merged doc, return what to upload.
  function round(store, S, remoteDoc, now, today) {
    var r = mergeInto(store, S, remoteDoc, now, today);
    S.doc = strip(r.doc);
    return { up: compact(r.doc, today), changed: r.changed };
  }
  // The server took `up` as version ver.
  function ack(S, up, ver, now) { S.doc = strip(up); S.ver = ver; S.fresh = false; S.at = now; S.err = null; }

  /* ---------- crypto (WebCrypto; WKWebView, Android WebView and node all have it) ---------- */
  function utf8(s) { return new TextEncoder().encode(s); }
  function deriveKey(uid, salt) {
    var s = crypto.subtle;
    return s.importKey("raw", utf8(String(uid)), "HKDF", false, ["deriveKey"]).then(function (base) {
      return s.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: utf8(INFO) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function pipe(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function aad(flag) { var a = utf8(INFO), o = new Uint8Array(a.length + 1); o.set(a); o[a.length] = flag; return o; }
  function encrypt(key, doc) {
    var raw = utf8(JSON.stringify(doc)), gz = typeof CompressionStream === "function", flag = gz ? 1 : 2;
    return (gz ? pipe(raw, new CompressionStream("gzip")) : Promise.resolve(raw)).then(function (pt) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(flag) }, key, pt).then(function (ct) {
        var out = new Uint8Array(13 + ct.byteLength); out[0] = flag; out.set(iv, 1); out.set(new Uint8Array(ct), 13); return out;
      });
    });
  }
  function decrypt(key, blob) {
    blob = new Uint8Array(blob);
    var flag = blob[0];
    if ((flag !== 1 && flag !== 2) || blob.length < 29) return Promise.reject(new Error("bad-blob"));
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(1, 13), additionalData: aad(flag) }, key, blob.subarray(13)).then(function (pt) {
      return flag === 1 ? pipe(new Uint8Array(pt), new DecompressionStream("gzip")) : new Uint8Array(pt);
    }, function () { throw new Error("decrypt-failed"); }).then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
  }
  function b64enc(u) { var s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
  function b64dec(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  var PURE = { mergeInto: mergeInto, compact: compact, strip: strip, round: round, ack: ack, replay: replay, better: better,
    mergeKv: mergeKv, deriveKey: deriveKey, encrypt: encrypt, decrypt: decrypt, b64enc: b64enc, b64dec: b64dec, INFO: INFO };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var KEY = "smd_prep_sync_v1", PKEY = "smd_prep_v1", busy = null, subs = [];
  function url() { return G.SMD_PREP_SYNC_API || "/api/prep/sync"; }
  function user() { try { return (G.SMD_AUTH && G.SMD_AUTH.currentUser) || null; } catch (e) { return null; } }
  function today() { return core().dayNum(Date.now(), new Date().getTimezoneOffset()); }
  function readS() {
    var s = null; try { s = JSON.parse(G.localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    return s && typeof s === "object" ? s : { on: false, dev: null, seq: 0, ver: null, doc: null, uid: null, fresh: true, at: 0, err: null };
  }
  function writeS(s) { try { G.localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  // The live prep store when prep.js is loaded (it caches the object), else the saved copy.
  function live() {
    var h = G.PREP && G.PREP._host;
    if (h) return { s: h.store(), save: h.save };
    var s = null; try { s = JSON.parse(G.localStorage.getItem(PKEY) || "null"); } catch (e) { s = null; }
    if (!s || s.v !== 1) s = { v: 1, cards: {}, conf: {}, days: {} };
    return { s: s, save: function () { try { G.localStorage.setItem(PKEY, JSON.stringify(s)); } catch (e) {} } };
  }
  function rid() { var a = crypto.getRandomValues(new Uint8Array(8)), s = ""; for (var i = 0; i < 8; i++) s += (a[i] + 256).toString(16).slice(1); return s; }
  function req(u, method, body, headers) {
    return u.getIdToken().then(function (tok) {
      var h = { Authorization: "Bearer " + tok }, k;
      for (k in headers || {}) h[k] = headers[k];
      return G.fetch(url(), { method: method, headers: h, body: body, cache: "no-store" });
    });
  }
  function httpErr(r) { var e = new Error("HTTP " + r.status); e.status = r.status; return e; }
  function notify() { subs.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // GET, decrypt, merge, PUT with If-Match. Resolves "done", or "retry" on 412.
  function once(u, out) {
    var ver, salt, key;
    return req(u, "GET").then(function (r) {
      if (!r.ok) throw httpErr(r);
      ver = (r.headers.get("ETag") || "").replace(/\D/g, ""); salt = r.headers.get("X-Sync-Salt") || "";
      return r.text();
    }).then(function (t) {
      if (!ver || !salt) throw new Error("bad-response");
      return deriveKey(u.uid, b64dec(salt)).then(function (k) { key = k; return t ? decrypt(key, b64dec(t)) : null; });
    }).then(function (remote) {
      var S = readS();
      if (!S.on) throw new Error("off");
      if (S.uid !== u.uid) { S.uid = u.uid; S.doc = null; S.fresh = true; }
      var L = live(), rl = (L.s.rl || []).slice(), r = round(L.s, S, remote, Date.now(), today());
      // The merged doc must be stored before the store drops its log, else those reviews leave the log.
      if (!writeS(S)) { L.s.rl = rl.concat(L.s.rl || []); throw new Error("storage-full"); }
      L.save();
      if (r.changed) { out.changed = true; notify(); }
      return encrypt(key, r.up).then(function (blob) {
        return req(u, "PUT", b64enc(blob), { "If-Match": '"' + ver + '"', "X-Sync-Salt": salt, "Content-Type": "text/plain" });
      }).then(function (p) {
        if (p.status === 412) return "retry";
        if (!p.ok) throw httpErr(p);
        return p.json().then(function (j) { var S2 = readS(); if (S2.on) { ack(S2, r.up, j.ver, Date.now()); writeS(S2); } return "done"; });
      });
    });
  }

  function sync(reason) {
    if (busy) return busy;
    var S = readS(), u = user();
    if (!S.on || !u) return Promise.resolve({ ok: false, changed: false, err: S.on ? "signed-out" : "off" });
    var out = { changed: false };
    function go(n) { return once(u, out).then(function (x) { if (x === "retry") { if (n >= 2) throw new Error("conflict"); return go(n + 1); } }); }
    busy = go(0).then(function () { return { ok: true, changed: out.changed, err: null }; }, function (e) {
      var msg = (e && e.message) || "error", S2 = readS();
      if (S2.on && msg !== "off") { S2.err = msg; writeS(S2); }
      return { ok: false, changed: out.changed, err: msg };
    }).then(function (res) { busy = null; return res; });
    return busy;
  }

  function enable() {
    var u = user();
    if (!u) return Promise.reject(new Error("sign-in-required"));
    var S = readS();
    if (!S.dev) S.dev = rid();
    if (S.uid !== u.uid) S.doc = null;
    S.on = true; S.fresh = true; S.uid = u.uid; S.err = null;
    if (!writeS(S)) return Promise.reject(new Error("storage-full"));
    var L = live();
    if (!L.s.rl) { L.s.rl = []; L.save(); }
    return sync("enable");
  }

  // Off: the log goes, the device forgets its merged doc except the counter slots (so a later enable does not count
  // other devices' answers as its own). wipe: also delete the server copy (and with it the counter slots).
  function disable(o) {
    var wipe = !!(o && o.wipe), u = user();
    if (wipe && !u) return Promise.reject(new Error("sign-in-required"));
    var S = readS(), L = live();
    if (L.s.rl) { delete L.s.rl; L.save(); }
    S.on = false; S.ver = null; S.fresh = true; S.err = null;
    S.doc = wipe || !S.doc ? null : { c: S.doc.c || {} };
    writeS(S);
    if (!wipe) return Promise.resolve();
    return (busy || Promise.resolve()).then(function () { return req(u, "DELETE"); }).then(function (r) { if (!r.ok) throw httpErr(r); });
  }

  function status() { var S = readS(); return { on: !!S.on, signedIn: !!user(), at: S.at || 0, err: S.err || null, busy: !!busy }; }
  function onChange(fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; }

  if (G.document) G.document.addEventListener("visibilitychange", function () { if (readS().on) sync("visibility"); });
  G.PREP_SYNC = { status: status, enable: enable, disable: disable, sync: sync, onChange: onChange, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
