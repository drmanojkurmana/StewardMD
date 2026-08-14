/* clinic-sync.js — Shared Clinic EMR sync engine (Phase 6). Incremental, encrypted, delta-based sync
 * over a pluggable transport (the clinic's ONE Google Drive folder — owner's chosen "direct sync"
 * model) and pluggable crypto (the existing AES-GCM envelope from personal-clinic.js, keyed by the
 * clinic secret).
 *
 * Not whole-file: each device appends its NEW changes as numbered, encrypted delta batches
 * (`<clinicId>/<deviceId>.<batch>.smddelta`). Peers pull only batches past their per-device cursor,
 * decrypt, and feed them through clinic-store.ingest() — where conflicts are parked, never overwritten.
 *
 * Local-first: sync is best-effort. The store works fully offline; a failed transport/decrypt leaves
 * the cursor unadvanced so the batch is retried, and unsynced local changes stay queued in pending().
 * All PHI is encrypted before it touches the transport — the delta files are opaque ciphertext.
 *
 * window.SMD_CLINIC_SYNC.create(opts) + module.exports. Node-testable with in-memory transport/crypto.
 * Generic — no ONCQIS / oncology.
 */
(function () {
  "use strict";
  var EXT = ".smddelta";

  // opts: { store, transport, crypto, deviceId, clinicId, state?, onState?, clock? }
  //   transport: { list()->[names]|Promise, get(name)->Promise<blob>, put(name,blob)->Promise }
  //   crypto:    { encrypt(str)->Promise<blob>, decrypt(blob)->Promise<str> }
  //   state:     { batch: <my next-1 batch #>, cursor: { <peerDeviceId>: <last consumed batch> } }
  function create(opts) {
    opts = opts || {};
    var store = opts.store;
    var tx = opts.transport;
    var crypto = opts.crypto;
    var deviceId = opts.deviceId;
    var clinicId = opts.clinicId || "";
    var state = opts.state || { batch: 0, cursor: {} };
    if (!state.cursor) state.cursor = {};
    var onState = opts.onState || function () {};

    function nameFor(dev, batch) {
      var f = dev + "." + batch + EXT;
      return clinicId ? (clinicId + "/" + f) : f;
    }
    function parse(name) {
      var base = String(name).split("/").pop();
      var m = /^(.+)\.(\d+)\.smddelta$/.exec(base);
      return m ? { device: m[1], batch: Number(m[2]) } : null;
    }

    // Upload this device's queued changes as one new encrypted batch, then clear them from pending.
    // Incremental: only the currently-pending changes go out; nothing is re-uploaded.
    function push() {
      var pending = store.pending();
      if (!pending.length) return Promise.resolve({ pushed: 0, batch: state.batch });
      var batch = state.batch + 1;
      var payload = JSON.stringify({ v: 1, clinicId: clinicId, deviceId: deviceId, batch: batch, changes: pending });
      var ids = pending.map(function (c) { return c.changeId; });
      return Promise.resolve(crypto.encrypt(payload))
        .then(function (blob) { return tx.put(nameFor(deviceId, batch), blob); })
        .then(function () {
          state.batch = batch;
          store.markSynced(ids);
          onState(state);
          return { pushed: ids.length, batch: batch };
        });
    }

    // Pull every peer batch we have not consumed yet, oldest-first, and merge it into the store.
    function pull() {
      return Promise.resolve(tx.list()).then(function (names) {
        var todo = (names || []).map(parse).filter(function (p) {
          return p && p.device !== deviceId && p.batch > (state.cursor[p.device] || 0);
        }).sort(function (a, b) { return (a.batch - b.batch) || String(a.device).localeCompare(b.device); });

        var res = { applied: 0, conflicts: 0, batches: 0, failed: 0 };
        return todo.reduce(function (chain, p) {
          return chain.then(function () {
            return Promise.resolve(tx.get(nameFor(p.device, p.batch)))
              .then(function (blob) { return crypto.decrypt(blob); })
              .then(function (str) {
                var d = JSON.parse(str);
                var r = store.ingest(d.changes || []);
                res.applied += r.applied; res.conflicts += r.conflicts; res.batches++;
                state.cursor[p.device] = p.batch;   // consumed; advance the cursor
                onState(state);
              })
              .catch(function () { res.failed++; /* leave cursor unadvanced -> retried next pull */ });
          });
        }, Promise.resolve()).then(function () { return res; });
      });
    }

    // Pull first (learn peers) then push (share ours) — one sync cycle. The engine caller drives the
    // cadence (Phase 7: ~15s while active + on open/foreground/reconnect/save/manual).
    function syncOnce() {
      return pull().then(function (pr) {
        return push().then(function (ph) { return { pull: pr, push: ph }; });
      });
    }

    return {
      push: push, pull: pull, syncOnce: syncOnce,
      state: function () { return state; },
      deviceId: deviceId, clinicId: clinicId
    };
  }

  var API = { create: create };
  if (typeof window !== "undefined") window.SMD_CLINIC_SYNC = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
