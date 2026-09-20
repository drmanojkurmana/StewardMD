/* ward-offline.js - WardSynQ offline outbox and read cache (window.WARD_OFFLINE). P2.4.
 *
 * Buildless ES5 IIFE. Loaded before ward.js, which uses it for a FIXED set of bedside writes:
 * vitals, a nursing task marked done, a note, a medication administration step, an ICU observation,
 * a fluid entry. Nothing else is ever queued.
 *
 * THE RULES THIS FILE DOES NOT BEND
 *
 * 1. NO FALSE "SAVED". A queued write is "saved on this device, not yet sent" until the server has
 *    answered it. If this device cannot hold offline work durably (no IndexedDB), the write is
 *    REFUSED here and the nurse is told to use paper; a memory-only queue would lose the work on reload.
 * 2. THE SERVER DECIDES. A queued write is sent through the SAME route, with the SAME body, as the
 *    online one. A medication step offline is checked by the eMAR on sync exactly as it would have been
 *    at the bedside; a refusal is shown loudly and never retried on its own.
 * 3. NO SILENT OVERWRITE. Every write carries its own idempotency key (a resend replays the original
 *    outcome) and the version the user saw (for a dose, the ORDER's version). A version conflict, or a dose
 *    whose order changed, becomes a CONFLICT item that stays until a person resends theirs (as a new version,
 *    with a reason), edits it, or discards it. ward.js records that decision on the server first
 *    (/ward/offline-resolve); nothing here drops or re-sends an item on a decision the server did not record.
 * 4. PHI STAYS ON THIS DEVICE AND LEAVES WITH THE USER. Queue and read cache live only in this device's
 *    IndexedDB, are owned by the user who wrote them, and are cleared on sign-out or when a different
 *    user is signed in. No credential is ever stored: headers are asked for at send time.
 * 5. CLIENT TIME IS FOR DISPLAY. The device's created-at is sent as X-Offline-Created-At and audited
 *    beside the server's own sync time; it never orders anything on the server.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  /* kind -> the route it goes through. The whole allow-list. */
  var KINDS = {
    vitals: "/ward/vitals",
    "nursing-task-done": "/ward/nursing-task-act",
    note: "/ward/note",
    mar: "/ward/mar",
    icu: "/ward/icu-record",
    fluid: "/ward/fluid"
  };
  var WORDS = { vitals: "vitals", "nursing-task-done": "nursing task", note: "note", mar: "dose record", icu: "ICU observation", fluid: "fluid entry" };
  /* Where the version a write was made against travels in its body. A dose is checked against its order. */
  function versionField(kind) { return kind === "mar" ? "expectedOrderVersion" : "expectedVersion"; }
  /* The part of a body a person may change on the conflict screen. A task done and a dose step have none:
   * a different task or a different dose is a new act at the bedside, not an edit. */
  var EDITABLE = { vitals: "vitals", note: "sections", icu: "values", fluid: "entries" };

  function OfflineRefused(message, code) { var e = new Error(message); e.code = code; return e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function iso(ms) { return new Date(ms).toISOString(); }

  function randomKey() {
    var s = "";
    try {
      var a = new Uint8Array(16); G.crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += (a[i] + 256).toString(16).slice(1);
    } catch (e) { s = Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); }
    return "off-" + s;
  }

  /* The time field each route reads, stamped from the device clock when the caller left it empty, so the
   * first attempt and every resend carry the same instant (and so derive the same record id). */
  function stampTime(kind, body, at) {
    if (kind === "vitals" && !body.recordedAt) body.recordedAt = at;
    if ((kind === "note" || kind === "icu") && !body.at) body.at = at;
    return body;
  }

  // ---- stores ------------------------------------------------------------------------------
  /* Two buckets, "outbox" and "cache". A store says whether it is durable; only a durable one may queue. */
  function memoryStore() {
    var b = { outbox: {}, cache: {} };
    return {
      durable: false,
      put: function (bucket, key, v) { b[bucket][key] = copy(v); return Promise.resolve(); },
      get: function (bucket, key) { return Promise.resolve(b[bucket][key] ? copy(b[bucket][key]) : null); },
      all: function (bucket) { return Promise.resolve(Object.keys(b[bucket]).map(function (k) { return copy(b[bucket][k]); })); },
      del: function (bucket, key) { delete b[bucket][key]; return Promise.resolve(); },
      clear: function () { b = { outbox: {}, cache: {} }; return Promise.resolve(); }
    };
  }

  /* IndexedDB. Never touched at load, every call wrapped: a browser that blocks storage degrades to
   * "cannot hold offline work", it does not throw into the ward. Writes resolve on transaction COMPLETE,
   * because request success is not durability. */
  function idbStore(idb, name) {
    name = name || "wardsynq-offline-v1";
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        try {
          var req = idb.open(name, 1);
          req.onupgradeneeded = function () {
            var db = req.result;
            if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox");
            if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
          };
          req.onsuccess = function () { res(req.result); };
          req.onerror = function () { rej(req.error); };
        } catch (e) { rej(e); }
      });
      dbp.catch(function () { dbp = null; });
      return dbp;
    }
    function tx(bucket, mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(bucket, mode), os = t.objectStore(bucket), out = fn(os);
          t.oncomplete = function () { res(out && "result" in out ? out.result : undefined); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      durable: true,
      put: function (bucket, key, v) { return tx(bucket, "readwrite", function (os) { os.put(copy(v), key); }); },
      get: function (bucket, key) { return tx(bucket, "readonly", function (os) { return os.get(key); }).then(function (v) { return v || null; }); },
      all: function (bucket) { return tx(bucket, "readonly", function (os) { return os.getAll(); }).then(function (v) { return v || []; }); },
      del: function (bucket, key) { return tx(bucket, "readwrite", function (os) { os.delete(key); }); },
      clear: function () {
        return open().then(function (db) {
          return new Promise(function (res, rej) {
            var t = db.transaction(["outbox", "cache"], "readwrite");
            t.objectStore("outbox").clear(); t.objectStore("cache").clear();
            t.oncomplete = function () { res(); }; t.onerror = function () { rej(t.error); };
          });
        });
      }
    };
  }

  // ---- what a server answer means for a queued write ---------------------------------------
  function reasonOf(r) {
    if (!r) return "no answer";
    var rs = (r.reasons || r.rejected || r.problems || []).map(function (x) {
      return typeof x === "string" ? x : (x && (x.message || x.reason || x.code)) || JSON.stringify(x);
    });
    return rs.length ? rs.join("; ") : String(r.detail || r.message || r.error || "refused");
  }
  /* PURE. -> "sent" | "conflict" | "refused" | "auth" | "retry" */
  function classify(status, r) {
    if (status === 401 || status === 403 && r && (r.error === "auth" || r.error === "permission" || r.error === "unauthorized" || r.error === "forbidden")) return "auth";
    if (r && (r.error === "auth" || r.error === "unauthorized")) return "auth";
    if (!r || status >= 500 || status === 0 || r.error === "upstream_unreachable") return "retry";
    if (r.error === "version_conflict" || r.error === "order_changed") return "conflict";
    if (r.ok) {
      // ok:true that recorded nothing is not a save.
      if (r.skipped === "no_numeric_values" || r.skipped === "no_entries") return "refused";
      if (r.written === 0 && r.rejected && r.rejected.length) return "refused";
      return "sent";
    }
    return "refused";
  }

  // ---- the outbox --------------------------------------------------------------------------
  /**
   * deps: { store, fetch, api, headers: () => Promise<obj>, actor: () => string|null, online: () => bool,
   *         now: () => ms, onChange: (state) => void }
   */
  function create(deps) {
    var store = deps.store, api = deps.api || "/api/queue";
    var now = deps.now || function () { return Date.now(); };
    var online = deps.online || function () { return true; };
    var actor = deps.actor || function () { return null; };
    var syncing = false, authNeeded = false, items = [], loaded = null, seq = 0, readFailed = false;

    function sorted() { return items.slice().sort(function (a, b) { return a.seq - b.seq; }); }
    function snapshot() {
      var me = actor(), mine = items.filter(function (i) { return i.actor === me; });
      var waiting = mine.filter(function (i) { return i.state === "queued"; }).length;
      var conflicts = mine.filter(function (i) { return i.state === "conflict"; }).length;
      var refused = mine.filter(function (i) { return i.state === "refused"; }).length;
      return { online: !!online(), syncing: syncing, waiting: waiting, conflicts: conflicts, refused: refused, authNeeded: authNeeded, durable: !!store.durable, readFailed: readFailed,
        items: mine.filter(function (i) { return i.state !== "queued"; }).map(function (i) {
          return { id: i.id, kind: i.kind, label: i.label, state: i.state, createdAt: iso(i.createdAt), reason: i.reason || "", error: i.error || "", currentVersion: i.currentVersion, expectedVersion: i.expectedVersion,
            patientId: i.patientId, idempotencyKey: i.idempotencyKey, body: copy(i.body), current: i.current ? copy(i.current) : null, editable: !!EDITABLE[i.kind] };
        }),
        queued: mine.filter(function (i) { return i.state === "queued"; }).map(function (i) { return { id: i.id, kind: i.kind, label: i.label, createdAt: iso(i.createdAt), patientId: i.patientId }; }) };
    }
    function changed() { if (deps.onChange) { try { deps.onChange(snapshot()); } catch (e) {} } }

    /* Loads what a previous page left, and drops anything owned by somebody other than who is signed in. */
    function load() {
      if (loaded) return loaded;
      loaded = store.all("outbox").then(function (rows) {
        var me = actor(), drop = [];
        items = [];
        rows.forEach(function (r) { if (me && r.actor !== me) drop.push(r.id); else items.push(r); seq = Math.max(seq, r.seq || 0); });
        readFailed = false;
        if (drop.length) return clearAll();
      }).catch(function () { items = []; readFailed = true; loaded = null; }).then(changed);
      return loaded;
    }
    function save(item) { return store.put("outbox", item.id, item); }

    function enqueue(kind, body, opts) {
      opts = opts || {};
      if (!KINDS[kind]) return Promise.reject(OfflineRefused("this kind of write is not kept offline", "NOT_QUEUEABLE"));
      if (!store.durable) return Promise.reject(OfflineRefused("this device cannot keep offline work; record it on paper", "NO_DEVICE_STORE"));
      var who = actor();
      if (!who) return Promise.reject(OfflineRefused("an offline write must name who made it", "NO_ACTOR"));
      if (!body || typeof body !== "object") return Promise.reject(OfflineRefused("an offline write needs a body", "NO_BODY"));
      return load().then(function () {
        var t = now(), b = stampTime(kind, copy(body), iso(t));
        b.idempotencyKey = b.idempotencyKey || randomKey();
        var ev = opts.expectedVersion == null ? null : Number(opts.expectedVersion);
        if (ev != null) b[versionField(kind)] = ev;
        var item = { id: b.idempotencyKey, seq: ++seq, kind: kind, path: KINDS[kind], body: b, idempotencyKey: b.idempotencyKey,
          expectedVersion: ev, createdAt: t, actor: who, patientId: opts.patientId || b.patientId || null,
          label: String(opts.label || WORDS[kind]), state: "queued", attempts: 0 };
        return save(item).then(function () { items.push(item); changed(); return copy(item); });
      });
    }

    function send(item) {
      return Promise.resolve(deps.headers ? deps.headers() : {}).then(function (h) {
        var hh = {}; Object.keys(h || {}).forEach(function (k) { hh[k] = h[k]; });
        hh["Content-Type"] = "application/json";
        hh["X-Offline-Created-At"] = iso(item.createdAt);
        if (item.conflictReason) hh["X-Offline-Conflict-Reason"] = encodeURIComponent(item.conflictReason);
        return deps.fetch(api + item.path, { method: "POST", headers: hh, credentials: "include", body: JSON.stringify(item.body) });
      }).then(function (res) {
        return Promise.resolve(res.json ? res.json() : null).catch(function () { return null; }).then(function (j) { return { status: res.status || 0, json: j }; });
      });
    }

    /* In order. Stops at the first write that could not be answered (offline, server down, signed out),
     * so nothing later overtakes it. A conflict or refusal is an ANSWER and the queue moves on. */
    function sync() {
      if (syncing) return Promise.resolve({ skipped: "already syncing" });
      return load().then(function () {
        var me = actor(), out = { sent: 0, replayed: 0, conflicts: 0, refused: 0, stopped: null };
        if (!online()) { out.stopped = "offline"; return out; }
        if (!me) { authNeeded = true; out.stopped = "auth"; changed(); return out; }
        var queue = sorted().filter(function (i) { return i.state === "queued" && i.actor === me; });
        if (!queue.length) { authNeeded = false; changed(); return out; }
        syncing = true; changed();
        var idx = 0;
        function next() {
          if (idx >= queue.length) return out;
          var item = queue[idx++];
          item.attempts++;
          return send(item).then(function (resp) {
            var c = classify(resp.status, resp.json), r = resp.json || {};
            if (c === "auth") { authNeeded = true; out.stopped = "auth"; return save(item).then(function () { return out; }); }
            if (c === "retry") { out.stopped = "server"; return save(item).then(function () { return out; }); }
            authNeeded = false;
            if (c === "sent") {
              out.sent++; if (r.replayed) out.replayed++;
              items = items.filter(function (i) { return i.id !== item.id; });
              return store.del("outbox", item.id).then(next);
            }
            item.state = c; item.reason = reasonOf(r); item.error = String(r.error || "");
            if (c === "conflict") {
              out.conflicts++;
              item.currentVersion = r.currentVersion != null ? r.currentVersion : (r.detail && r.detail.currentVersion != null ? r.detail.currentVersion : null);
              // The record as it is now, for the side by side on the conflict screen.
              item.current = r.current || (r.detail && r.detail.current) || null;
            }
            else out.refused++;
            return save(item).then(next);
          }, function () { out.stopped = "offline"; return out; });
        }
        return Promise.resolve(next()).then(function (res) { syncing = false; changed(); return res; }, function (e) { syncing = false; changed(); throw e; });
      });
    }

    function find(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

    /* The user's own decision on a CONFLICT or a refusal: their write is dropped. Nothing is sent. */
    function discard(id) {
      return load().then(function () {
        var it = find(id);
        if (!it || it.actor !== actor()) throw OfflineRefused("not your write", "NOT_FOUND");
        if (it.state === "queued") throw OfflineRefused("a write still waiting to send is not discarded from here", "STILL_QUEUED");
        items = items.filter(function (i) { return i.id !== id; });
        return store.del("outbox", id).then(changed);
      });
    }

    /* KEEP MINE (resend): re-sent as a NEW version on top of the one the server now holds, with the reason on
     * the audit. EDIT: the same, with the editable part of the body replaced; a refused entry may be edited
     * too. A fresh idempotency key either way, because it is a different write from the one that came back.
     * A dose whose ORDER changed is re-sent against the order as it is now, and the eMAR checks it again. */
    function keepMine(id, reason, currentVersion, edit) {
      return load().then(function () {
        var it = find(id);
        if (!it || it.actor !== actor()) throw OfflineRefused("not your write", "NOT_FOUND");
        if (edit !== undefined) {
          if (!EDITABLE[it.kind]) throw OfflineRefused("this kind of entry cannot be edited here", "NOT_EDITABLE");
          if (it.state !== "conflict" && it.state !== "refused") throw OfflineRefused("only a returned entry can be edited", "NOT_RETURNED");
        } else if (it.state !== "conflict") throw OfflineRefused("only a conflict can be kept", "NOT_CONFLICT");
        var why = String(reason || "").trim();
        if (why.length < 5) throw OfflineRefused("say why your version should stand over the one on the server", "NO_REASON");
        var cv = currentVersion != null ? currentVersion : it.currentVersion;
        var versioned = it.kind === "mar" ? it.error === "order_changed" : true;
        if (it.state === "conflict" && it.expectedVersion != null && versioned) {
          if (cv == null || !(Number(cv) >= 0) || Math.floor(Number(cv)) !== Number(cv)) throw OfflineRefused("reload the record to see the version you are replacing", "NO_CURRENT_VERSION");
          it.expectedVersion = Number(cv); it.body[versionField(it.kind)] = Number(cv);
        }
        if (edit !== undefined) it.body[EDITABLE[it.kind]] = copy(edit);
        it.body.idempotencyKey = randomKey(); it.idempotencyKey = it.body.idempotencyKey;
        it.state = "queued"; it.conflictReason = why.slice(0, 200); it.reason = ""; it.error = ""; it.current = null; it.seq = ++seq;
        return save(it).then(function () { changed(); return copy(it); });
      });
    }

    // ---- read cache ------------------------------------------------------------------------
    function cachePut(patientId, data) {
      var who = actor();
      if (!store.durable || !who || !patientId) return Promise.resolve(false);
      return store.put("cache", who + "|" + patientId, { actor: who, patientId: patientId, savedAt: now(), data: data }).then(function () { return true; }, function () { return false; });
    }
    /* null when there is no copy, it is somebody else's, or it has expired (an expired copy is deleted). */
    function cacheGet(patientId, hours) {
      var who = actor();
      if (!who || !patientId) return Promise.resolve(null);
      var key = who + "|" + patientId, h = Number(hours) > 0 ? Number(hours) : 12;
      return store.get("cache", key).then(function (c) {
        if (!c || c.actor !== who) return null;
        if (now() - c.savedAt > h * 3600000) return store.del("cache", key).then(function () { return null; });
        return { savedAt: iso(c.savedAt), data: c.data, expiresAt: iso(c.savedAt + h * 3600000) };
      }).catch(function () { return null; });
    }

    /* Sign-out. Everything, queue and cache. */
    function clearAll() {
      items = []; authNeeded = false;
      return store.clear().catch(function () {}).then(changed);
    }

    return { enqueue: enqueue, sync: sync, discard: discard, keepMine: keepMine, state: snapshot, list: function () { return load().then(function () { return sorted().map(copy); }); },
      cachePut: cachePut, cacheGet: cacheGet, clearAll: clearAll, load: load };
  }

  /* The words below are English. ward.js passes its staff-language lookup as tr (owner decision 2026-09-15: a
   * picked language changes the whole staff interface); without one, tr fills the English, so every other caller
   * and test reads exactly what it always did. The server's refusal reason is a value, never looked up. */
  function en(key, text, vars) { return vars ? text.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? "" + vars[k] : m; }) : text; }
  /* PURE. The words for the sync state, the same on every screen. */
  function label(s, tr) {
    tr = tr || en;
    if (!s) return { kind: "online", text: tr("ward.offline-online", "Online") };
    if (s.readFailed) return { kind: "conflicts", text: tr("ward.offline-entries-could-not-be-read", "Entries kept on this device could not be read") };
    if (s.syncing) return { kind: "syncing", text: tr("ward.offline-syncing", "Syncing") };
    if (s.conflicts) return { kind: "conflicts", text: tr("ward.offline-conflicts", "Conflicts ({n})", { n: s.conflicts }) };
    if (!s.online) return { kind: "offline", text: tr("ward.offline-offline-waiting", "Offline ({n} waiting)", { n: s.waiting }) };
    if (s.authNeeded && s.waiting) return { kind: "offline", text: tr("ward.offline-sign-in-again-to-send", "Sign in again to send ({n} waiting)", { n: s.waiting }) };
    if (s.waiting) return { kind: "offline", text: tr("ward.offline-online-waiting", "Online ({n} waiting)", { n: s.waiting }) };
    return { kind: "online", text: tr("ward.offline-online", "Online") };
  }
  /* PURE. What a settled item says. A dose refusal is loud and uses the exact words. */
  function itemText(it, tr) {
    tr = tr || en;
    if (it.state === "refused") {
      return it.kind === "mar" ? tr("ward.offline-dose-refused", "Not recorded - the dose record was refused: {reason}", { reason: it.reason })
        : tr("ward.offline-write-refused", "Not recorded - the {what} was refused: {reason}", { what: tr("ward.offline-word-" + (WORDS[it.kind] ? it.kind : "write"), WORDS[it.kind] || "write"), reason: it.reason });
    }
    if (it.state === "conflict" && it.error === "order_changed") return tr("ward.offline-order-changed", "CONFLICT: the order changed after this dose was charted. Nothing was recorded. Compare it with the order as it is now.");
    if (it.state === "conflict") return tr("ward.offline-record-changed", "CONFLICT: this {what} changed on the server after you saw it. Nothing was overwritten.", { what: tr("ward.offline-word-" + (WORDS[it.kind] ? it.kind : "record"), WORDS[it.kind] || "record") });
    return tr("ward.offline-saved-not-yet-sent", "Saved on this device, not yet sent.");
  }

  /* The device instance ward.js uses. Built lazily so this file loads in Node for tests. */
  var device = null;
  function deviceFor(deps) {
    if (device) return device;
    var store;
    try { store = G.indexedDB ? idbStore(G.indexedDB) : memoryStore(); } catch (e) { store = memoryStore(); }
    deps.store = store;
    deps.fetch = deps.fetch || function (u, o) { return G.fetch(u, o); };
    deps.online = deps.online || function () { try { return G.navigator.onLine !== false; } catch (e) { return true; } };
    device = create(deps);
    try { G.addEventListener("online", function () { device.sync(); }); G.addEventListener("offline", function () { device.load().then(function () { if (deps.onChange) deps.onChange(device.state()); }); }); } catch (e) {}
    return device;
  }

  G.WARD_OFFLINE = { KINDS: KINDS, EDITABLE: EDITABLE, WORDS: WORDS, create: create, memoryStore: memoryStore, idbStore: idbStore, classify: classify, label: label, itemText: itemText, deviceFor: deviceFor,
    clearDevice: function () { return device ? device.clearAll() : Promise.resolve(); }, device: function () { return device; } };
})();
