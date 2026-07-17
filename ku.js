/* StewardMD — Knowledge Units (KU) client.
 *
 * Batches "learning/usage" events (reading content, cases, calculators, MaiK) and
 * posts them to the server-authoritative ledger (/api/ku/award) with the Firebase
 * ID token so the server can verify identity. Balance is cached in localStorage for
 * instant display, but the SERVER is the source of truth — local edits never grant
 * redeemable KU. Earns ONLY when signed in (guests see "sign in to earn" in the UI).
 *
 * window.SMD_KU = { emit(type,refId), balance(), summary()->Promise, onChange(fn), signedIn() }
 */
(function () {
  "use strict";
  if (window.SMD_KU) return;

  var LKEY = "stewardmd_ku_";
  var FLUSH_MS = 4000, BATCH_MAX = 50, FLUSH_AT = 20;
  var queue = [], timer = null, cache = null, listeners = [];

  function uid() { try { return window.SMD_ACCOUNT && SMD_ACCOUNT.uid && SMD_ACCOUNT.uid(); } catch (e) { return null; } }
  function signedIn() { var u = uid(); return !!u && u !== "anon" && u !== "guest"; }
  function cacheKey() { return LKEY + (uid() || "guest"); }
  // Mirror aiBase(): same origin on web (/api/ku), the AI proxy (…/ai → …/ku) on native.
  function kuBase() { return window.AI_PROXY ? String(window.AI_PROXY).replace(/\/ai\b/, "/ku") : "/api/ku"; }
  function idToken() {
    try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; }); } catch (e) {}
    return Promise.resolve(null);
  }

  function loadCache() { try { cache = JSON.parse(localStorage.getItem(cacheKey()) || "null"); } catch (e) { cache = null; } return cache; }
  function saveCache(c) {
    if (!c || typeof c.balance !== "number") return;
    cache = c; try { localStorage.setItem(cacheKey(), JSON.stringify(c)); } catch (e) {}
    listeners.forEach(function (f) { try { f(c); } catch (e) {} });
  }

  function flush() {
    timer = null;
    if (!signedIn() || !queue.length) return;
    var batch = queue.splice(0, BATCH_MAX);
    idToken().then(function (tok) {
      if (!tok) { queue = batch.concat(queue); return; }        // token not ready → requeue for later
      return fetch(kuBase() + "/award", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ events: batch }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && typeof j.balance === "number") saveCache(j); else queue = batch.concat(queue); });
    }).catch(function () { queue = batch.concat(queue); });
  }
  function scheduleFlush() {
    if (queue.length >= FLUSH_AT) { if (timer) { clearTimeout(timer); timer = null; } flush(); }
    else if (!timer) { timer = setTimeout(flush, FLUSH_MS); }
  }

  function emit(type, refId) {
    if (!signedIn() || !type || refId == null || refId === "") return;
    refId = String(refId);
    for (var i = 0; i < queue.length; i++) { if (queue[i].type === type && queue[i].refId === refId) return; }  // in-batch dedup
    queue.push({ type: type, refId: refId });
    scheduleFlush();
  }
  function summary() {
    if (!signedIn()) return Promise.resolve(null);
    return idToken().then(function (tok) {
      if (!tok) return cache;
      return fetch(kuBase() + "/summary", { headers: { "Authorization": "Bearer " + tok } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && typeof j.balance === "number") saveCache(j); return j || cache; });
    }).catch(function () { return cache; });
  }
  function balance() { return (cache && cache.balance) || 0; }
  function onChange(f) { if (typeof f === "function") listeners.push(f); }

  // On sign-in/out: reload the per-user cache, flush any queued events, notify listeners.
  try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.onChange) SMD_ACCOUNT.onChange(function () { loadCache(); if (signedIn()) flush(); listeners.forEach(function (f) { try { f(cache); } catch (e) {} }); }); } catch (e) {}
  try { window.addEventListener("beforeunload", function () { if (queue.length) { try { flush(); } catch (e) {} } }); } catch (e) {}
  loadCache();

  // Absorb a server response (award/qualify/summary) into the cache so balance + listeners update
  // immediately without a re-fetch. The merged engagement view is a superset of the old summary,
  // so everything downstream (chip, dashboard) sees fresh data.
  function absorb(j) { if (j && typeof j.balance === "number") saveCache(j); return j; }

  window.SMD_KU = { emit: emit, balance: balance, summary: summary, onChange: onChange, signedIn: signedIn, _absorb: absorb, _cache: function () { return cache; }, _flush: flush, _queue: function () { return queue.slice(); } };
})();
