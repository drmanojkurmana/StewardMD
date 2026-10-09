/* PrepNucleus Layer C: the student's own decks on this phone. window.PREP_DECKS. ES5.
   Contract: vault/plans/PrepNucleus-LayerC.md 6.4 to 6.7. Loaded with prep-create.js (see prep-loader.js).

   IndexedDB database "prep-gen" (separate from the bank cache "prep-bank" and from every clinical store), five stores:
     prep-src    key deckId   { deckId, name, type, sents: [{ n, p, h, tx, s }] }   numbered source sentences
     prep-facts  key id (fid) { id, deckId, ft, cq, sn, fk, p, h, sec, used, chunk }
     prep-items  key id       stored questions (6.4) plus deckId, _s "deck", _m "deck-<deckId>"
     prep-cards  key id       flashcards (6.5)
     prep-decks  key id       the deck manifest (6.7) plus prog { done: [chunk indexes] } for "10 more"
     prep-imgs   key id       { id, deckId, p, w, h, data } an image cut from the PDF (data: URL, at most 1280 px) that an
                              image question shows with its stem; only images that got a question are kept (version 2)
   facts, items and cards carry an index on deckId, so a deck is listed and deleted in one pass.
   Also the shared SHA-256 (pure ES5, synchronous) used for deck, item, card and idempotency ids.

   WHY DECKS WERE LOST (owner report 2026-10-09) and what keeps them now:
   1. A failed IndexedDB open (iOS WebKit drops its storage process while the app is in the background, and the next
      open can fail once) used to switch this file to an in-memory store for the rest of the session, silently: the
      list came up empty ("my decks are gone"), and a deck made in that state was "Saved on this phone" in memory only
      and vanished when the app closed. Now a failed open is retried, a lost connection (onclose, InvalidStateError) is
      reopened, and memory is used only where IndexedDB does not exist at all, with durable() false so the screens say so.
   2. Storage was best effort: the browser may evict it under storage pressure. persist() asks for persistent storage.
   3. A reinstall (or a new phone) starts with empty storage, and nothing was kept anywhere else. Now every saved deck
      is mirrored to the app's own files on native (Capacitor Filesystem, Directory.DATA, prep-decks/<id>.json, the
      whole deck with its images) and backed up, encrypted, to the student's account (/api/prep/decks: manifest,
      questions, cards and the facts not yet used with the sentences they cite; no file, no images, no other page
      text). restore() brings back what is missing: native files first, then the account, after sign-in.
   Not causes (checked): an OTA update keeps the WebView origin (capacitor-updater swaps the server base path only),
   and sign-out does not touch PrepNucleus storage (no wipe listener here). */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  function isPrime(n) { for (var d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }
  // SHA-256 constants from the fractional parts of the square and cube roots of the first primes.
  var H0 = [], K = [];
  (function () {
    var n = 2;
    while (K.length < 64) {
      if (isPrime(n)) {
        if (H0.length < 8) H0.push((Math.pow(n, 1 / 2) % 1) * 4294967296 | 0);
        K.push((Math.pow(n, 1 / 3) % 1) * 4294967296 | 0);
      }
      n++;
    }
  })();
  function utf8(s) {
    s = String(s == null ? "" : s);
    try { return unescape(encodeURIComponent(s)); } catch (e) { return unescape(encodeURIComponent(s.replace(/[\uD800-\uDFFF]/g, "\uFFFD"))); }
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(str) {
    var s = utf8(str), l = s.length, words = [], i, j;
    for (i = 0; i < l; i++) words[i >> 2] |= (s.charCodeAt(i) & 255) << (24 - (i % 4) * 8);
    words[l >> 2] |= 128 << (24 - (l % 4) * 8);
    var nw = (((l + 8) >> 6) + 1) * 16;
    words[nw - 1] = (l * 8) | 0;
    words[nw - 2] = Math.floor(l / 536870912);
    var H = H0.slice(), w = new Array(64);
    for (var b = 0; b < nw; b += 16) {
      for (j = 0; j < 16; j++) w[j] = words[b + j] | 0;
      for (j = 16; j < 64; j++) {
        var x = w[j - 15], y = w[j - 2];
        w[j] = (w[j - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + w[j - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10))) | 0;
      }
      var A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], Gg = H[6], Hh = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (Hh + (ror(E, 6) ^ ror(E, 11) ^ ror(E, 25)) + ((E & F) ^ (~E & Gg)) + K[j] + w[j]) | 0;
        var t2 = ((ror(A, 2) ^ ror(A, 13) ^ ror(A, 22)) + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        Hh = Gg; Gg = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] = (H[0] + A) | 0; H[1] = (H[1] + B) | 0; H[2] = (H[2] + C) | 0; H[3] = (H[3] + D) | 0;
      H[4] = (H[4] + E) | 0; H[5] = (H[5] + F) | 0; H[6] = (H[6] + Gg) | 0; H[7] = (H[7] + Hh) | 0;
    }
    var out = "";
    for (i = 0; i < 8; i++) out += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function sha12(s) { return sha256(s).slice(0, 12); }

  // Owner rule (2026-10-07, 2026-10-09): no AI or source label in the app; the deck manifest carries none.
  var LABEL = "";
  /* A new manifest (6.7). o = { id, title, exam, profileV, pv, model, source: { type, name, pages, sha }, now } */
  function newManifest(o) {
    return {
      id: o.id, v: 1, title: o.title || "My deck", exam: o.exam, profileV: o.profileV,
      source: { type: o.source.type, name: o.source.name || "", pages: o.source.pages || null, sha: o.source.sha },
      prov: "AI", model: o.model, pv: o.pv, created: o.now || Date.now(),
      stats: { facts: 0, generated: 0, accepted: 0, rejected: 0, regenerated: 0, cards: 0 },
      cost: { inTok: 0, outTok: 0, thinkTok: 0, inr: 0, stopped: null },
      topics: [], prog: { done: [] }
    };
  }
  /* The manifest's topic list from the saved items and the source sections ({ id, title }): one topic per section
     that has questions, in section order, file "idb:<deckId>/<sec>". */
  function topicsFor(deckId, items, sections) {
    var n = {}, order = [], title = {};
    (sections || []).forEach(function (s) { title[s.id] = s.title; order.push(s.id); });
    (items || []).forEach(function (it) { n[it.t] = (n[it.t] || 0) + 1; if (order.indexOf(it.t) < 0) order.push(it.t); });
    return order.filter(function (id) { return n[id]; }).map(function (id) {
      return { id: id, title: { en: title[id] || "General" }, count: n[id], file: "idb:" + deckId + "/" + id };
    });
  }
  function questionCount(m) { var t = 0; ((m && m.topics) || []).forEach(function (x) { t += x.count || 0; }); return t; }
  // Newest first.
  function sortDecks(list) { return (list || []).slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); }

  /* ---------- backup payload (pure) ---------- */
  /* What leaves the phone for the account backup: the manifest (title scrubbed again, no running round), every
     question (an image question keeps its imgId, its picture stays on the phone), every card, and the facts not used
     yet with only the one or two sentences each cites (quote), so "10 more" still works after a restore. */
  function backupPayload(m, items, cards, facts, sents, scrub) {
    var byN = {}, sc = scrub || function (x) { return x; };
    (sents || []).forEach(function (s) { byN[s.n] = s.tx; });
    var mm = JSON.parse(JSON.stringify(m || {}));
    mm.title = sc(String(mm.title || "My deck")).slice(0, 80);
    if (mm.source) mm.source.name = sc(String(mm.source.name || "")).slice(0, 120);
    delete mm.run; delete mm.imgPend;
    var fx = [];
    (facts || []).forEach(function (f) {
      if (!f || f.used) return;
      var q = (f.sn || []).map(function (n) { return byN[n] || ""; }).filter(Boolean).join(" ") || f.quote || "";
      if (!q) return;
      fx.push({ id: f.id, deckId: f.deckId, ft: f.ft, cq: f.cq, sn: f.sn, fk: f.fk, p: f.p, h: f.h, sec: f.sec, used: false, chunk: f.chunk, quote: q.slice(0, 2000) });
    });
    var it = (items || []).map(function (x) { var o = {}; for (var k in x) if (k !== "img" && k !== "_s" && k !== "_m") o[k] = x[k]; return o; });
    return { v: 1, m: mm, items: it, cards: (cards || []).slice(), facts: fx };
  }
  /* A payload back to records for IndexedDB, or null when it is not a deck. The source sentences are not part of it,
     so the manifest says so (noSrc): "10 more" uses the saved facts, then asks for the source. */
  function fromPayload(p) {
    if (!p || p.v !== 1 || !p.m || typeof p.m.id !== "string" || !/^gen_[a-f0-9]{12}$/.test(p.m.id)) return null;
    var id = p.m.id, m = p.m;
    m.restored = Date.now(); m.noSrc = true; m.run = null;
    var own = function (r) { return r && typeof r === "object" && r.deckId === id; };
    return { m: m, items: (p.items || []).filter(own).map(function (x) { x._s = "deck"; x._m = "deck-" + id; return x; }), cards: (p.cards || []).filter(own), facts: (p.facts || []).filter(own) };
  }

  var PURE = { sha256: sha256, sha12: sha12, utf8: utf8, newManifest: newManifest, topicsFor: topicsFor, questionCount: questionCount, sortDecks: sortDecks, LABEL: LABEL,
    backupPayload: backupPayload, fromPayload: fromPayload };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser: IndexedDB ================= */
  var DB = "prep-gen", BY_DECK = ["prep-facts", "prep-items", "prep-cards", "prep-imgs"], ALL = ["prep-src", "prep-facts", "prep-items", "prep-cards", "prep-decks", "prep-imgs"];
  var KEYS = { "prep-src": "deckId", "prep-facts": "id", "prep-items": "id", "prep-cards": "id", "prep-decks": "id", "prep-imgs": "id" };
  var dbP = null, mem = null, noIdb = false, persistAsked = false, persisted = null;
  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      var S = G.navigator && G.navigator.storage;
      if (S && S.persist) S.persist().then(function (v) { persisted = !!v; }, function () { persisted = false; });
    } catch (e) {}
  }
  function openOnce() {
    return new Promise(function (res) {
      var done = false, fin = function (db) { if (!done) { done = true; res(db); } };
      try {
        var rq = G.indexedDB.open(DB, 2);   // 2: prep-imgs (the upgrade only adds the missing store)
        rq.onupgradeneeded = function () {
          var db = rq.result;
          ALL.forEach(function (n) {
            if (db.objectStoreNames.contains(n)) return;
            var os = db.createObjectStore(n, { keyPath: KEYS[n] });
            if (BY_DECK.indexOf(n) >= 0) os.createIndex("deckId", "deckId");
          });
        };
        rq.onsuccess = function () {
          var db = rq.result;
          // A connection the browser closes (storage process gone, another version) is dropped, so the next call reopens.
          db.onclose = function () { dbP = null; };
          db.onversionchange = function () { try { db.close(); } catch (e) {} dbP = null; };
          fin(db);
        };
        rq.onerror = function () { fin(null); };
        rq.onblocked = function () { G.setTimeout(function () { fin(null); }, 3000); };
      } catch (e) { fin(null); }
    });
  }
  function open() {
    if (dbP) return dbP;
    askPersist();
    if (!G.indexedDB) { noIdb = true; if (!mem) { mem = {}; ALL.forEach(function (n) { mem[n] = {}; }); } return (dbP = Promise.resolve(null)); }
    // One retry after a short wait: the first open after the app comes back can fail while WebKit restarts storage.
    var p = openOnce().then(function (db) { return db || new Promise(function (r) { G.setTimeout(r, 400); }).then(openOnce); });
    dbP = p.then(function (db) {
      if (!db) { dbP = null; var e = new Error("storage"); e.name = "StorageOpenError"; throw e; }
      return db;
    });
    return dbP;
  }
  function memVals(store, deckId) { var o = mem[store], out = []; for (var k in o) if (deckId == null || o[k].deckId === deckId) out.push(o[k]); return out; }
  // One transaction; fn(objectStore) may return a request whose result is the answer. A connection that died
  // (InvalidStateError when the transaction is opened) is reopened once.
  function tx(store, mode, fn, again) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t, rq;
        try { t = db.transaction(store, mode); rq = fn(t.objectStore(store)); } catch (e) {
          if (!again && e && (e.name === "InvalidStateError" || e.name === "UnknownError")) { dbP = null; return res(tx(store, mode, fn, true)); }
          return rej(e);
        }
        t.oncomplete = function () { res(rq && "result" in rq ? rq.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("storage")); };
      });
    });
  }
  function get(store, key) {
    return open().then(function (db) { return db ? tx(store, "readonly", function (os) { return os.get(key); }) : mem[store][key]; });
  }
  function putMany(store, recs) {
    recs = recs || [];
    if (!recs.length) return Promise.resolve(0);
    return open().then(function (db) {
      if (!db) { recs.forEach(function (r) { mem[store][r[KEYS[store]]] = JSON.parse(JSON.stringify(r)); }); return recs.length; }
      return tx(store, "readwrite", function (os) { recs.forEach(function (r) { os.put(r); }); return null; }).then(function () { return recs.length; });
    });
  }
  function put(store, rec) { return putMany(store, [rec]); }
  function delMany(store, keys) {
    if (!keys || !keys.length) return Promise.resolve(0);
    return open().then(function (db) {
      if (!db) { keys.forEach(function (k) { delete mem[store][k]; }); return keys.length; }
      return tx(store, "readwrite", function (os) { keys.forEach(function (k) { os.delete(k); }); return null; }).then(function () { return keys.length; });
    });
  }
  function byDeck(store, deckId) {
    return open().then(function (db) { return db ? tx(store, "readonly", function (os) { return os.index("deckId").getAll(deckId); }) : memVals(store, deckId); });
  }
  function all(store) {
    return open().then(function (db) { return db ? tx(store, "readonly", function (os) { return os.getAll(); }) : memVals(store, null); });
  }
  function deleteLocal(id) {
    return open().then(function (db) {
      if (!db) { ALL.forEach(function (n) { var o = mem[n]; for (var k in o) if (o[k].deckId === id || o[k].id === id) delete o[k]; }); return true; }
      return new Promise(function (res, rej) {
        var t = db.transaction(ALL, "readwrite");
        t.objectStore("prep-decks").delete(id);
        t.objectStore("prep-src").delete(id);
        BY_DECK.forEach(function (n) {
          var os = t.objectStore(n), rq = os.index("deckId").getAllKeys(id);
          rq.onsuccess = function () { (rq.result || []).forEach(function (k) { os.delete(k); }); };
        });
        t.oncomplete = function () { res(true); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("storage")); };
      });
    });
  }
  function whole(id) {
    return Promise.all([get("prep-decks", id), get("prep-src", id), byDeck("prep-facts", id), byDeck("prep-items", id), byDeck("prep-cards", id), byDeck("prep-imgs", id)])
      .then(function (a) { return a[0] ? { v: 1, m: a[0], src: a[1] || null, facts: a[2] || [], items: a[3] || [], cards: a[4] || [], imgs: a[5] || [] } : null; });
  }
  // A whole deck into storage (a restore): the manifest last, so a half-written deck is never listed.
  function importDeck(b) {
    var id = b.m.id;
    return putMany("prep-items", b.items || []).then(function () { return putMany("prep-cards", b.cards || []); })
      .then(function () { return putMany("prep-facts", b.facts || []); }).then(function () { return putMany("prep-imgs", b.imgs || []); })
      .then(function () { return b.src && b.src.deckId === id ? put("prep-src", b.src) : 0; })
      .then(function () { return put("prep-decks", b.m); });
  }

  /* ---------- deleted ids (so a restore never brings back a deck the student removed) ---------- */
  var DEL_KEY = "smd_prep_deck_del", BK_KEY = "smd_prep_deck_bk";
  function readLS(k, d) { try { var v = JSON.parse(G.localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : d; } catch (e) { return d; } }
  function writeLS(k, v) { try { G.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------- native files: the whole deck in the app's own storage (Capacitor Filesystem, Directory.DATA) ---------- */
  var DIR = "prep-decks";
  function fs() {
    try { var P = G.Capacitor && G.Capacitor.Plugins; return G.SMD_IS_NATIVE && P && P.Filesystem && P.Filesystem.writeFile ? P.Filesystem : null; } catch (e) { return null; }
  }
  var fileTimers = {};
  function mirror(id) {
    var F = fs();
    if (!F) return Promise.resolve(false);
    return whole(id).then(function (b) {
      if (!b) return false;
      return F.writeFile({ path: DIR + "/" + id + ".json", directory: "DATA", encoding: "utf8", recursive: true, data: JSON.stringify(b) }).then(function () { return true; });
    }).then(null, function () { return false; });
  }
  function mirrorSoon(id) {
    if (!fs()) return;
    if (fileTimers[id]) G.clearTimeout(fileTimers[id]);
    fileTimers[id] = G.setTimeout(function () { delete fileTimers[id]; mirror(id); }, 1200);
  }
  function fileIds() {
    var F = fs();
    if (!F || !F.readdir) return Promise.resolve([]);
    return F.readdir({ path: DIR, directory: "DATA" }).then(function (r) {
      return ((r && r.files) || []).map(function (f) { return typeof f === "string" ? f : f && f.name; }).filter(function (n) { return /^gen_[a-f0-9]{12}\.json$/.test(n || ""); }).map(function (n) { return n.slice(0, -5); });
    }, function () { return []; });
  }
  function readFileDeck(id) {
    var F = fs();
    return F.readFile({ path: DIR + "/" + id + ".json", directory: "DATA", encoding: "utf8" }).then(function (r) {
      var b = JSON.parse(r && typeof r.data === "string" ? r.data : "null");
      return b && b.v === 1 && b.m && b.m.id === id ? b : null;
    }, function () { return null; });
  }
  function unmirror(id) { var F = fs(); if (!F || !F.deleteFile) return Promise.resolve(); return F.deleteFile({ path: DIR + "/" + id + ".json", directory: "DATA" }).then(null, function () {}); }

  /* ---------- account backup: /api/prep/decks, AES-GCM under HKDF(uid, server salt) ---------- */
  var INFO = "prepnucleus-decks-v1", keyP = null, keyUid = null;
  function user() { try { return (G.SMD_AUTH && G.SMD_AUTH.currentUser) || null; } catch (e) { return null; } }
  function apiUrl(id) { return (G.SMD_API_BASE || "") + (G.SMD_PREP_DECKS_API || "/api/prep/decks") + (id ? "/" + id : ""); }
  function req(u, method, id, body) {
    return u.getIdToken().then(function (tok) {
      var h = { Authorization: "Bearer " + tok };
      if (body != null) h["Content-Type"] = "text/plain";
      return G.fetch(apiUrl(id), { method: method, headers: h, body: body, cache: "no-store" });
    });
  }
  function enc8(s) { return new TextEncoder().encode(s); }
  function b64enc(u) { var s = ""; for (var i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
  function b64dec(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function pipe(bytes, stream) { return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function aad(flag) { var a = enc8(INFO), o = new Uint8Array(a.length + 1); o.set(a); o[a.length] = flag; return o; }
  // The list (and the salt) for this user; the key is derived once per uid.
  function listing(u) {
    return req(u, "GET").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      if (!j || typeof j.salt !== "string") throw new Error("bad-response");
      if (keyUid !== u.uid || !keyP) {
        keyUid = u.uid;
        keyP = crypto.subtle.importKey("raw", enc8(String(u.uid)), "HKDF", false, ["deriveKey"]).then(function (base) {
          return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: b64dec(j.salt), info: enc8(INFO) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        });
      }
      return keyP.then(function (key) { return { key: key, decks: j.decks || [] }; });
    });
  }
  function seal(key, obj) {
    var raw = enc8(JSON.stringify(obj)), gz = typeof CompressionStream === "function", flag = gz ? 1 : 2;
    return (gz ? pipe(raw, new CompressionStream("gzip")) : Promise.resolve(raw)).then(function (pt) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(flag) }, key, pt).then(function (ct) {
        var out = new Uint8Array(13 + ct.byteLength); out[0] = flag; out.set(iv, 1); out.set(new Uint8Array(ct), 13); return b64enc(out);
      });
    });
  }
  function unseal(key, text) {
    var blob = b64dec(text), flag = blob[0];
    if ((flag !== 1 && flag !== 2) || blob.length < 29) return Promise.reject(new Error("bad-blob"));
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(1, 13), additionalData: aad(flag) }, key, blob.subarray(13)).then(function (pt) {
      return flag === 1 ? pipe(new Uint8Array(pt), new DecompressionStream("gzip")) : new Uint8Array(pt);
    }).then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
  }
  function scrubFn() { var S = G.PREP_SRC; return S && S.prepScrub ? S.prepScrub : null; }
  var bkTimer = null, bkQueue = {}, bkBusy = null;
  /* Upload the decks that changed since their last backup (m.upd newer than the stamp kept for this uid). */
  function push(ids) {
    var u = user();
    if (!u || !u.getIdToken) return Promise.resolve({ ok: false, err: "signed-out" });
    var bk = readLS(BK_KEY, {}), mine = bk.uid === u.uid ? bk : { uid: u.uid, at: {} };
    return listing(u).then(function (L) {
      return (ids ? Promise.resolve(ids) : all("prep-decks").then(function (list) { return list.map(function (m) { return m.id; }); })).then(function (list) {
        var sent = 0;
        return list.reduce(function (p, id) {
          return p.then(function () {
            return whole(id).then(function (b) {
              if (!b || (mine.at[id] && mine.at[id] >= (b.m.upd || b.m.created || 0))) return;
              var stamp = b.m.upd || b.m.created || Date.now();
              return seal(L.key, backupPayload(b.m, b.items, b.cards, b.facts, b.src && b.src.sents, scrubFn())).then(function (text) {
                return req(u, "PUT", id, text);
              }).then(function (r) { if (r.ok) { mine.at[id] = stamp; sent++; } });
            });
          });
        }, Promise.resolve()).then(function () { writeLS(BK_KEY, mine); return { ok: true, sent: sent }; });
      });
    }).then(null, function (e) { return { ok: false, err: (e && e.message) || "error" }; });
  }
  function backupSoon(id) {
    bkQueue[id] = 1;
    if (bkTimer) G.clearTimeout(bkTimer);
    bkTimer = G.setTimeout(function () {
      bkTimer = null;
      var ids = Object.keys(bkQueue); bkQueue = {};
      bkBusy = (bkBusy || Promise.resolve()).then(function () { return push(ids); });
    }, 1500);
  }
  function removeRemote(id) {
    var u = user();
    if (!u || !u.getIdToken) return Promise.resolve();
    return req(u, "DELETE", id).then(null, function () {});
  }

  /* restore() -> Promise({ files, account }): decks missing here come back, from this phone's files first (they have
     the source and images too), then from the account. A deck the student deleted on this phone is never brought back. */
  var restoreP = null;
  function restore() {
    if (restoreP) return restoreP;
    var out = { files: 0, account: 0 }, del = readLS(DEL_KEY, {});
    restoreP = all("prep-decks").then(function (list) {
      var have = {}; list.forEach(function (m) { have[m.id] = 1; });
      return fileIds().then(function (ids) {
        return ids.reduce(function (p, id) {
          if (have[id] || del[id]) return p;
          return p.then(function () { return readFileDeck(id).then(function (b) { if (b) return importDeck(b).then(function () { have[id] = 1; out.files++; }); }); });
        }, Promise.resolve());
      }).then(function () {
        var u = user();
        if (!u || !u.getIdToken) return;
        return listing(u).then(function (L) {
          var bk = readLS(BK_KEY, {}), mine = bk.uid === u.uid ? bk : { uid: u.uid, at: {} };
          return L.decks.reduce(function (p, d) {
            if (!d || have[d.id] || del[d.id]) return p;
            return p.then(function () {
              return req(u, "GET", d.id).then(function (r) { return r.ok ? r.text() : null; }).then(function (t) { return t ? unseal(L.key, t) : null; }).then(function (pl) {
                var r = fromPayload(pl);
                if (!r || r.m.id !== d.id) return;
                return importDeck({ m: r.m, items: r.items, cards: r.cards, facts: r.facts }).then(function () { have[d.id] = 1; out.account++; mine.at[d.id] = r.m.upd || r.m.created || 0; mirrorSoon(d.id); });
              }).then(null, function () {});
            });
          }, Promise.resolve()).then(function () { writeLS(BK_KEY, mine); });
        }).then(null, function () {});
      });
    }).then(function () { return out; }, function () { return out; }).then(function (r) { restoreP = null; return r; });
    return restoreP;
  }
  // A saved deck changed: keep the file copy and the account copy in step (both debounced).
  function changed(id) { mirrorSoon(id); backupSoon(id); }
  function deleteDeck(id) {
    var del = readLS(DEL_KEY, {}); del[id] = Date.now(); writeLS(DEL_KEY, del);
    return deleteLocal(id).then(function (r) { unmirror(id); removeRemote(id); return r; });
  }

  var API = {
    _pure: PURE, sha256: sha256, sha12: sha12, newManifest: newManifest, topicsFor: topicsFor, questionCount: questionCount, LABEL: LABEL,
    getDeck: function (id) { return get("prep-decks", id); },
    putDeck: function (m) { m.upd = Date.now(); return put("prep-decks", m); },
    listDecks: function () { return all("prep-decks").then(sortDecks); },
    getSrc: function (id) { return get("prep-src", id); },
    putSrc: function (rec) { return put("prep-src", rec); },
    facts: function (id) { return byDeck("prep-facts", id); },
    putFacts: function (recs) { return putMany("prep-facts", recs); },
    items: function (id) { return byDeck("prep-items", id); },
    putItems: function (recs) { return putMany("prep-items", recs); },
    cards: function (id) { return byDeck("prep-cards", id); },
    putCards: function (recs) { return putMany("prep-cards", recs); },
    imgs: function (id) { return byDeck("prep-imgs", id); },
    putImgs: function (recs) { return putMany("prep-imgs", recs); },
    delImgs: function (ids) { return delMany("prep-imgs", ids); },
    deleteDeck: deleteDeck, restore: restore, changed: changed, whole: whole, importDeck: importDeck,
    backup: { push: push, remove: removeRemote, mirror: mirror },
    // false only where IndexedDB does not exist at all (decks then last until the app closes).
    durable: function () { return !noIdb; },
    persisted: function () { return persisted; },
    persistent: function () { return open().then(function (db) { return !!db; }, function () { return false; }); }
  };
  G.PREP_DECKS = API;
})(typeof window !== "undefined" ? window : this);
