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
   Nothing here leaves the phone. No export in v1. When IndexedDB is unavailable (private mode) everything lives in
   memory for the session and the deck is lost on close.
   Also the shared SHA-256 (pure ES5, synchronous) used for deck, item, card and idempotency ids. */
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

  var LABEL = "AI-generated educational content";
  /* A new manifest (6.7). o = { id, title, exam, profileV, pv, model, source: { type, name, pages, sha }, now } */
  function newManifest(o) {
    return {
      id: o.id, v: 1, title: o.title || "My deck", exam: o.exam, profileV: o.profileV,
      source: { type: o.source.type, name: o.source.name || "", pages: o.source.pages || null, sha: o.source.sha },
      prov: "AI", label: LABEL, model: o.model, pv: o.pv, created: o.now || Date.now(),
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

  var PURE = { sha256: sha256, sha12: sha12, utf8: utf8, newManifest: newManifest, topicsFor: topicsFor, questionCount: questionCount, sortDecks: sortDecks, LABEL: LABEL };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= browser: IndexedDB ================= */
  var DB = "prep-gen", BY_DECK = ["prep-facts", "prep-items", "prep-cards", "prep-imgs"], ALL = ["prep-src", "prep-facts", "prep-items", "prep-cards", "prep-decks", "prep-imgs"];
  var KEYS = { "prep-src": "deckId", "prep-facts": "id", "prep-items": "id", "prep-cards": "id", "prep-decks": "id", "prep-imgs": "id" };
  var dbP = null, mem = null;
  function open() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
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
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbP.then(function (db) { if (!db && !mem) { mem = {}; ALL.forEach(function (n) { mem[n] = {}; }); } return db; });
  }
  function memVals(store, deckId) { var o = mem[store], out = []; for (var k in o) if (deckId == null || o[k].deckId === deckId) out.push(o[k]); return out; }
  // One transaction; fn(objectStore) may return a request whose result is the answer.
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t, rq;
        try { t = db.transaction(store, mode); rq = fn(t.objectStore(store)); } catch (e) { return rej(e); }
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
  function byDeck(store, deckId) {
    return open().then(function (db) { return db ? tx(store, "readonly", function (os) { return os.index("deckId").getAll(deckId); }) : memVals(store, deckId); });
  }
  function all(store) {
    return open().then(function (db) { return db ? tx(store, "readonly", function (os) { return os.getAll(); }) : memVals(store, null); });
  }
  function deleteDeck(id) {
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

  var API = {
    _pure: PURE, sha256: sha256, sha12: sha12, newManifest: newManifest, topicsFor: topicsFor, questionCount: questionCount, LABEL: LABEL,
    getDeck: function (id) { return get("prep-decks", id); },
    putDeck: function (m) { return put("prep-decks", m); },
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
    deleteDeck: deleteDeck,
    persistent: function () { return open().then(function (db) { return !!db; }); }
  };
  G.PREP_DECKS = API;
})(typeof window !== "undefined" ? window : this);
