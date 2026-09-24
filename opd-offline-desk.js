/* opd-offline-desk.js - degraded desk mode (OPD plan item 13): window.SMD_OPD_OFFLINE.
 *
 * When the connection drops, the front desk keeps checking patients in. While online, the desk reserves
 * an offline series for the day from the server (POST /offline-series -> "OA"; one letter per desk, so
 * two desks can never print the same number). Offline, a check-in gets the next number of that series
 * (OA-1, OA-2 ...), the slip is printed, and the answers wait in an outbox. Back online, sync() sends
 * each one the way an online check-in goes (patient/register, then pool) carrying its offline token and
 * the time it was taken; the server accepts an offline token once (create-only), so a retried sync can
 * never queue the patient twice, and the patient keeps the number on their slip and their place.
 *
 * WHERE THE OUTBOX LIVES. In this browser's IndexedDB, so a check-in survives the desk tab being closed or the
 * browser restarting, not only a reload. Every change is a read, change and write inside ONE readwrite
 * transaction, so a second desk tab, or a sync in flight, can never overwrite a check-in. A check-in is shown as
 * taken only once that write has committed (issue() resolves after it): there is no "saved" that is not saved.
 * Where IndexedDB cannot be opened (a private window), the tab's sessionStorage is used instead and durable()
 * says so, so the desk can tell the patient's slip is only as safe as the open tab.
 *
 * The outbox holds what the patient said at the desk (PHI) on this device until it is sent: each item is
 * deleted as it syncs, and a sign-out that would drop unsent items asks first (the hosts), then clears it all.
 * Anything the server would not take cleanly (a possible duplicate, a refusal) is kept in review for the
 * desk to settle, never dropped.
 *
 * desk({ indexedDB?, storage?, store?, call(path, body) -> Promise<json> (REJECTS when unreachable), orgId, date, now? })
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SMD_OPD_OFFLINE = api;
})(typeof self !== "undefined" ? self : this, function () {
  var KEY = "smd_opd_offline_v1", DB = "smd-opd-offline";
  var TOKEN_RE = /^O[A-HJ-NP-Z]-\d{1,3}$/;
  function blank() { return { series: null, n: 0, items: [], review: [] }; }
  function valid(v) { return v && Array.isArray(v.items) && Array.isArray(v.review) ? v : blank(); }

  /* A store holds the one state record. update(fn) reads it, lets fn change it and writes it back atomically,
   * resolving with the state as written; it rejects when the write did not happen. */
  function kvStore(storage) {   // sessionStorage: survives a reload, not a closed tab
    function get() { try { return valid(JSON.parse(storage.getItem(KEY) || "null")); } catch (e) { return blank(); } }
    return {
      durable: false,
      load: function () { return Promise.resolve(get()); },
      update: function (fn) { return new Promise(function (res) { var s = get(); fn(s); storage.setItem(KEY, JSON.stringify(s)); res(s); }); },
      clear: function () { try { storage.removeItem(KEY); } catch (e) {} return Promise.resolve(); }
    };
  }
  function idbStore(idb) {   // IndexedDB: survives a closed tab and a restart
    var dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise(function (res, rej) {
          var q = idb.open(DB, 1);
          q.onupgradeneeded = function () { if (!q.result.objectStoreNames.contains("desk")) q.result.createObjectStore("desk"); };
          q.onsuccess = function () { res(q.result); };
          q.onerror = function () { rej(q.error); };
        });
        dbp.catch(function () { dbp = null; });
      }
      return dbp;
    }
    function txn(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction("desk", mode), os = t.objectStore("desk"), out = { v: null };
          fn(os, out);
          t.oncomplete = function () { res(out.v); };
          t.onerror = t.onabort = function () { rej(t.error || new Error("aborted")); };
        });
      });
    }
    return {
      durable: true,
      load: function () { return txn("readonly", function (os, out) { var r = os.get(KEY); r.onsuccess = function () { out.v = valid(r.result); }; }).then(valid); },
      update: function (fn) {
        return txn("readwrite", function (os, out) { var r = os.get(KEY); r.onsuccess = function () { var s = valid(r.result); fn(s); os.put(s, KEY); out.v = s; }; });
      },
      clear: function () { return txn("readwrite", function (os) { os.delete(KEY); }); }
    };
  }

  function desk(o) {
    var now = o.now || function () { return Date.now(); };
    var store = o.store || (o.indexedDB ? idbStore(o.indexedDB) : kvStore(o.storage));
    var cur = blank(), busy = null;
    function keep(s) { cur = valid(s); return cur; }
    function update(fn) { return store.update(fn).then(keep); }
    /* Opening: the durable store, falling back to the tab's storage when it cannot be opened. A tab that kept its
     * outbox in sessionStorage before this desk had IndexedDB hands it over, so nothing waiting is stranded. */
    var loaded = store.load().catch(function () {
      if (!o.storage) throw new Error("no_store");
      store = kvStore(o.storage);
      return store.load();
    }).then(function (s) {
      if (!store.durable || !o.storage) return s;
      var old = kvStore(o.storage), was;
      return old.load().then(function (x) {
        was = x;
        if (!was.items.length && !was.review.length) return s;
        return store.update(function (d) {
          if (!d.series && was.series) { d.series = was.series; d.n = was.n; }
          d.items = d.items.concat(was.items.filter(function (i) { return !d.items.some(function (j) { return j.token === i.token; }); }));
          d.review = d.review.concat(was.review);
        }).then(function (d) { return old.clear().then(function () { return d; }); });
      });
    }).then(keep, function () { return cur; });

    function ready() { var s = cur.series; return !!(s && s.orgId === o.orgId && s.date === o.date); }
    // Online: make sure today's series is in hand before it is needed. Resolves true when it is.
    function prepare() {
      return loaded.then(function () {
        if (ready()) return true;
        return Promise.resolve(o.call("offline-series", { orgId: o.orgId, date: o.date })).then(function (r) {
          if (!(r && r.ok && r.series)) return false;
          return update(function (s) { s.series = { orgId: o.orgId, date: o.date, code: String(r.series) }; s.n = 0; }).then(function () { return true; });
        }, function () { return false; });
      }).catch(function () { return false; });
    }
    /* Offline: the next number of the series, with the answers kept for sync. Resolves { token, at, durable } once
     * written; null when no series was reserved or the write failed (then nothing was promised to the patient). */
    function issue(sent) {
      return loaded.then(function () {
        if (!ready()) return null;
        var got = null;
        return update(function (s) {
          if (!(s.series && s.series.orgId === o.orgId && s.series.date === o.date)) return;
          s.n += 1;
          got = { token: s.series.code + "-" + s.n, at: now() };
          s.items.push({ orgId: o.orgId, date: o.date, token: got.token, at: got.at, sent: sent || {} });
        }).then(function () { return got ? { token: got.token, at: got.at, durable: !!store.durable } : null; });
      }).catch(function () { return null; });
    }
    function pending() { return cur.items.filter(function (x) { return x.orgId === o.orgId; }).length; }
    function review() { return cur.review.filter(function (x) { return !x.orgId || x.orgId === o.orgId; }); }
    function dismiss(token) { return update(function (s) { s.review = s.review.filter(function (x) { return x.token !== token; }); }).catch(function () { return cur; }); }
    function clear() { return store.clear().then(function () { cur = blank(); }, function () {}); }
    function durable() { return !!store.durable; }

    function one(out) {
      return store.load().then(keep).then(function () {
        var it = cur.items.filter(function (x) { return x.orgId === o.orgId; })[0];   // only this hospital's, under this sign-in
        if (!it) return out;
        var sent = it.sent || {};
        var reg = it.mrn != null ? Promise.resolve({ ok: true, mrn: it.mrn })
          : Promise.resolve(o.call("patient/register", Object.assign({}, sent, { orgId: it.orgId, date: it.date, forQueue: "pool" })));
        return reg.then(function (r) {
          var flag = "", mrn = "";
          if (r && r.ok) mrn = r.mrn || "";
          else if (r && r.error === "duplicate" && r.duplicateOf) {
            var d = r.duplicateOf;
            // The same card or folder is the same patient; a shared phone number is not proof of anything.
            if ((sent.stewardId && d.stewardId === sent.stewardId) || (sent.mrn && d.mrn === sent.mrn)) mrn = d.mrn || "";
            else flag = "Possible duplicate of " + (d.mrn || d.stewardId || "an existing record") + ": check before billing.";
          } else flag = "Not registered (" + ((r && (r.message || r.error)) || "no answer") + "): queued by name only.";
          if (it.flag && !flag) flag = it.flag;
          // A register that landed is not sent again if the queue step has to be retried.
          return update(function (s) { s.items.forEach(function (x) { if (x.token === it.token) { x.mrn = mrn; x.flag = flag; } }); }).then(function () {
            return o.call("pool", {
              orgId: it.orgId, date: it.date, name: sent.name || "", mobile: sent.mobile || "", mrn: mrn,
              visitType: sent.visitType === "followup" ? "followup" : "new", departmentId: sent.departmentId || "",
              offlineToken: it.token, offlineAt: it.at
            });
          }).then(function (q) {
            if (!(q && (q.ok || q.error === "offline_token_used"))) flag = flag || ("Not queued (" + ((q && (q.message || q.error)) || "no answer") + ").");
            return update(function (s) {
              s.items = s.items.filter(function (x) { return x.token !== it.token; });
              if (flag) s.review.push({ orgId: it.orgId, token: it.token, name: sent.name || "", why: flag, at: it.at });
            });
          }).then(function () { out.synced += 1; return one(out); });
        });
      });
    }
    // Sends the outbox in order. Stops quietly at the first unreachable call and keeps the rest.
    function sync() {
      if (busy) return busy;
      var out = { synced: 0 };
      busy = loaded.then(function () { return one(out); }).then(function () { return out; }, function () { return out; })
        .then(function (r) { busy = null; r.left = pending(); r.review = review().length; return r; });
      return busy;
    }
    return { loaded: loaded, prepare: prepare, ready: ready, issue: issue, pending: pending, review: review, dismiss: dismiss, sync: sync, clear: clear, durable: durable };
  }
  return { desk: desk, kvStore: kvStore, idbStore: idbStore, TOKEN_RE: TOKEN_RE, KEY: KEY, DB: DB };
});
