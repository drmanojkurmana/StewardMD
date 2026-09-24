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
 * The outbox holds what the patient said at the desk (PHI), so it lives in sessionStorage: it survives a
 * reload of the desk tab, dies with the tab, and is emptied as items sync and on sign-out.
 * ponytail: sessionStorage loses an unsent check-in if the tab is closed (the patient still holds the printed
 * slip); IndexedDB, as ward-offline.js uses, is the upgrade if desks close tabs while offline.
 * Anything the server would not take cleanly (a possible duplicate, a refusal) is kept in review for the
 * desk to settle, never dropped.
 *
 * desk({ storage, call(path, body) -> Promise<json> (REJECTS when the server cannot be reached), orgId, date, now? })
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SMD_OPD_OFFLINE = api;
})(typeof self !== "undefined" ? self : this, function () {
  var KEY = "smd_opd_offline_v1";
  var TOKEN_RE = /^O[A-HJ-NP-Z]-\d{1,3}$/;

  function desk(o) {
    var now = o.now || function () { return Date.now(); };
    var busy = null;
    function read() {
      try { var v = JSON.parse(o.storage.getItem(KEY) || "null"); if (v && v.items) return v; } catch (e) {}
      return { series: null, n: 0, items: [], review: [] };
    }
    function write(s) { try { o.storage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
    function ready() { var s = read().series; return !!(s && s.orgId === o.orgId && s.date === o.date); }

    // Online: make sure today's series is in hand before it is needed. Resolves true when it is.
    function prepare() {
      if (ready()) return Promise.resolve(true);
      return Promise.resolve(o.call("offline-series", { orgId: o.orgId, date: o.date })).then(function (r) {
        if (!(r && r.ok && r.series)) return false;
        var s = read(); s.series = { orgId: o.orgId, date: o.date, code: String(r.series) }; s.n = 0;
        return write(s);
      }, function () { return false; });
    }
    // Offline: the next number of the series, with the answers kept for sync. null when no series was reserved.
    function issue(sent) {
      if (!ready()) return null;
      var s = read(); s.n += 1;
      var token = s.series.code + "-" + s.n, at = now();
      s.items.push({ orgId: o.orgId, date: o.date, token: token, at: at, sent: sent || {} });
      return write(s) ? { token: token, at: at } : null;
    }
    function pending() { return read().items.filter(function (x) { return x.orgId === o.orgId; }).length; }
    function review() { return read().review.filter(function (x) { return !x.orgId || x.orgId === o.orgId; }); }
    function dismiss(token) { var s = read(); s.review = s.review.filter(function (x) { return x.token !== token; }); write(s); }
    function clear() { try { o.storage.removeItem(KEY); } catch (e) {} }

    // Every write re-reads storage first: a check-in issued while a sync is in flight is never overwritten.
    function mutate(fn) { var s = read(); fn(s); return write(s); }
    function one(out) {
      var it = read().items.filter(function (x) { return x.orgId === o.orgId; })[0];   // only this hospital's, under this sign-in
      if (!it) return Promise.resolve(out);
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
        // A register that landed is not sent again if the queue step has to be retried.
        mutate(function (s) { s.items.forEach(function (x) { if (x.token === it.token) { x.mrn = mrn; x.flag = flag; } }); });
        if (it.flag && !flag) flag = it.flag;
        return Promise.resolve(o.call("pool", {
          orgId: it.orgId, date: it.date, name: sent.name || "", mobile: sent.mobile || "", mrn: mrn,
          visitType: sent.visitType === "followup" ? "followup" : "new", departmentId: sent.departmentId || "",
          offlineToken: it.token, offlineAt: it.at
        })).then(function (q) {
          if (!(q && (q.ok || q.error === "offline_token_used"))) flag = flag || ("Not queued (" + ((q && (q.message || q.error)) || "no answer") + ").");
          mutate(function (s) {
            s.items = s.items.filter(function (x) { return x.token !== it.token; });
            if (flag) s.review.push({ orgId: it.orgId, token: it.token, name: sent.name || "", why: flag, at: it.at });
          });
          out.synced += 1;
          return one(out);
        });
      });
    }
    // Sends the outbox in order. Stops quietly at the first unreachable call and keeps the rest.
    function sync() {
      if (busy) return busy;
      var out = { synced: 0 };
      busy = one(out).then(function () { return out; }, function () { return out; })
        .then(function (r) { busy = null; r.left = pending(); r.review = review().length; return r; });
      return busy;
    }
    return { prepare: prepare, ready: ready, issue: issue, pending: pending, review: review, dismiss: dismiss, sync: sync, clear: clear };
  }
  return { desk: desk, TOKEN_RE: TOKEN_RE, KEY: KEY };
});
