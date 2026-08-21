/* referrals.js — doctor-to-doctor referral inbox (window.SMD_REFERRALS). A referring doctor sends a
 * patient (ICU roster entry + reason) to a colleague addressed by StewardMD ID or email; the recipient
 * sees it in an inbox and loads it into ICU. Firestore collection `referrals`, keyed by recipient uid.
 *
 * Reuses: SMD_ICU_GROUPS.resolveDoctor (doctorDirectory lookup), SMD_STEWARD_ID (my smdId), the firebase
 * compat SDK, ICU.state()/ICU.ingestReferral(). Flag smd_referrals default OFF (reversible). Every entry
 * point no-ops when the flag is off, firebase is missing, or the user is signed out. PHI (the attached
 * state) is member-to-member, gated by firestore rules on toUid/fromUid — NOT a public code share.
 */
(function () {
  "use strict";
  var G = window;

  function flagOn() {
    try {
      var q = (location.search.match(/[?&]referrals=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return localStorage.getItem("smd_referrals") === "1";
    } catch (e) { return false; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function toast(m) { try { (G.toast || function () {})(m); } catch (e) {} }

  function fb() { return G.firebase; }
  function db() { try { return G.SMD_DB || (fb() && fb().firestore && fb().firestore()); } catch (e) { return null; } }
  function auth() { try { return (G.SMD_AUTH && G.SMD_AUTH.currentUser ? G.SMD_AUTH : (fb() && fb().auth && fb().auth())); } catch (e) { return null; } }
  function meUid() { try { var a = auth(); return (a && a.currentUser && a.currentUser.uid) || ""; } catch (e) { return ""; } }
  function meName() { try { var a = auth(); var u = a && a.currentUser; return (u && (u.displayName || u.email)) || "Doctor"; } catch (e) { return "Doctor"; } }
  function mySmd() { try { return (G.SMD_STEWARD_ID && G.SMD_STEWARD_ID.my && G.SMD_STEWARD_ID.my()) || ""; } catch (e) { return ""; } }
  function ready(cb) {
    var a = auth(); if (!a) { cb(null); return; }
    if (a.currentUser) { cb(a.currentUser); return; }
    try { a.onAuthStateChanged(function (u) { cb(u || null); }); } catch (e) { cb(null); }
  }
  function serverTs() { try { return fb().firestore.FieldValue.serverTimestamp(); } catch (e) { return Date.now(); } }

  // Send a referral. entry = the ICU roster entry {id,name,dx,bed,mrn,savedAt,state}. Resolves the
  // recipient by SMD id / email via the shared doctor directory. Returns a Promise<{ok}|{error}>.
  function refer(idOrEmail, entry, reason) {
    if (!flagOn()) return Promise.resolve({ error: "off" });
    var d = db(); if (!d) return Promise.resolve({ error: "no-firestore" });
    if (!meUid()) return Promise.resolve({ error: "signed-out" });
    if (!entry || !entry.state) return Promise.resolve({ error: "no-patient" });
    var resolve = (G.SMD_ICU_GROUPS && G.SMD_ICU_GROUPS.resolveDoctor) ? G.SMD_ICU_GROUPS.resolveDoctor(idOrEmail) : Promise.resolve(null);
    return Promise.resolve(resolve).then(function (rec) {
      if (!rec || !rec.uid) return { error: "doctor-not-found" };
      if (rec.uid === meUid()) return { error: "self" };
      var id = "ref_" + meUid().slice(0, 6) + "_" + (entry.id || "x") + "_" + String(Date.now()).slice(-8);
      var doc = {
        v: 1, fromUid: meUid(), fromSmdId: mySmd(), fromName: meName(),
        toUid: rec.uid, toSmdId: rec.smdId || "",
        patient: entry, dx: entry.dx || "", reason: String(reason || ""),
        summary: (G.ICU && ICU.summary && entry.state) ? String(ICU.summary(entry.state)).slice(0, 4000) : "",
        status: "sent", createdAt: serverTs(), createdAtMs: Date.now(),
        expiresAt: Date.now() + 31 * 24 * 60 * 60 * 1000
      };
      return d.collection("referrals").doc(id).set(doc).then(function () { return { ok: true, to: rec.name || rec.smdId || "doctor" }; }, function (e) { return { error: (e && e.code) || "write-failed" }; });
    }).catch(function (e) { return { error: (e && e.message) || "error" }; });
  }

  // Live inbox for the signed-in doctor. cb(array) each change. Returns an unsubscribe fn (or noop).
  var _unsub = null, _items = [];
  function subscribeInbox(cb) {
    if (!flagOn()) { cb && cb([]); return function () {}; }
    var d = db(); if (!d) { cb && cb([]); return function () {}; }
    if (_unsub) { try { _unsub(); } catch (e) {} _unsub = null; }
    ready(function (u) {
      if (!u) { cb && cb([]); return; }
      try {
        _unsub = d.collection("referrals").where("toUid", "==", u.uid).onSnapshot(function (snap) {
          var out = []; snap.forEach(function (x) { out.push(Object.assign({ id: x.id }, x.data())); });
          out.sort(function (a, b) { return (b.createdAtMs || 0) - (a.createdAtMs || 0); });
          _items = out; refreshBadge(); cb && cb(out);
        }, function () { cb && cb([]); });
      } catch (e) { cb && cb([]); }
    });
    return function () { if (_unsub) { try { _unsub(); } catch (e) {} _unsub = null; } };
  }
  function unreadCount() { return _items.filter(function (r) { return r.status === "sent"; }).length; }

  // Load a received referral into ICU + mark accepted.
  function accept(refId) {
    var r = _items.filter(function (x) { return x.id === refId; })[0];
    if (!r) return;
    if (G.ICU && ICU.ingestReferral && r.patient) { try { ICU.ingestReferral(r.patient); } catch (e) {} }
    setStatus(refId, "accepted"); close();
  }
  function decline(refId) { setStatus(refId, "declined"); render(); }
  function setStatus(refId, status) {
    var d = db(); if (!d) return;
    try { d.collection("referrals").doc(refId).update({ status: status }).catch(function () {}); } catch (e) {}
  }

  // ---- inbox overlay (self-contained; mirrors caseshare chrome) ----
  var overlay = null;
  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "refOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(10,20,25,.5);display:none;align-items:flex-end;justify-content:center";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    return overlay;
  }
  function close() { if (overlay) overlay.style.display = "none"; }
  function render() {
    ensure();
    var rows = _items.length ? _items.map(function (r) {
      var badge = r.status === "sent" ? '<span style="background:#0e6e63;color:#fff;font-size:10px;padding:2px 7px;border-radius:999px">NEW</span>' :
        '<span style="color:#94a3b8;font-size:11px">' + esc(r.status) + "</span>";
      return '<div style="border:1px solid #e2e8ec;border-radius:12px;padding:12px;margin:8px 0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>' + esc(r.patient && r.patient.name || "Patient") + "</b>" + badge + "</div>" +
        '<div style="font-size:12.5px;color:#5a7184;margin:3px 0">' + esc(r.dx || "No diagnosis") + (r.patient && r.patient.bed ? " · Bed " + esc(r.patient.bed) : "") + "</div>" +
        (r.reason ? '<div style="font-size:12.5px;margin:4px 0">Reason: ' + esc(r.reason) + "</div>" : "") +
        '<div style="font-size:11.5px;color:#94a3b8;margin:2px 0 8px">From ' + esc(r.fromName || r.fromSmdId || "a doctor") + "</div>" +
        '<div style="display:flex;gap:8px"><button data-ref-accept="' + esc(r.id) + '" style="flex:1;background:#0e6e63;color:#fff;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer">Open in ICU</button>' +
        '<button data-ref-decline="' + esc(r.id) + '" style="background:#eef1f4;color:#14202b;border:none;border-radius:9px;padding:10px 14px;cursor:pointer">Dismiss</button></div></div>';
    }).join("") : '<div style="text-align:center;color:#94a3b8;padding:30px 10px">No referrals yet. When a colleague refers a patient to you, it appears here.</div>';
    overlay.innerHTML = '<div style="background:#fff;color:#14202b;width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));max-height:80vh;overflow:auto;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0;font-size:17px">Referrals</h3><button data-ref-close="1" style="border:none;background:none;font-size:20px;cursor:pointer;color:#5a7184">×</button></div>' +
      rows + "</div>";
    overlay.querySelector("[data-ref-close]").onclick = close;
    overlay.querySelectorAll("[data-ref-accept]").forEach(function (b) { b.onclick = function () { accept(b.getAttribute("data-ref-accept")); }; });
    overlay.querySelectorAll("[data-ref-decline]").forEach(function (b) { b.onclick = function () { decline(b.getAttribute("data-ref-decline")); }; });
  }
  function openInbox() {
    if (!flagOn()) { toast("Referrals are off"); return; }
    ensure(); render(); overlay.style.display = "flex";
    // mark all sent -> seen (so the badge clears) once opened
    _items.filter(function (r) { return r.status === "sent"; }).forEach(function (r) { setStatus(r.id, "seen"); });
  }

  // ---- referral send prompt (used by ICU / consult "Refer" actions) ----
  function referPrompt(entry) {
    if (!flagOn()) { toast("Referrals are off"); return; }
    var to = ""; try { to = (window.prompt("Refer to StewardMD ID or email:") || "").trim(); } catch (e) {}
    if (!to) return;
    var reason = ""; try { reason = (window.prompt("Reason / note (optional):") || "").trim(); } catch (e) {}
    toast("Sending referral…");
    refer(to, entry, reason).then(function (r) {
      if (r && r.ok) toast("Referred to " + r.to);
      else toast(r && r.error === "doctor-not-found" ? "No StewardMD doctor with that ID/email" : "Could not send referral");
    });
  }

  // ---- unread badge (best-effort; reuses home.js badge if present) ----
  function refreshBadge() {
    try { if (G.SMD_refreshReferralBadge) G.SMD_refreshReferralBadge(unreadCount()); } catch (e) {}
    try {
      var el = document.getElementById("refInboxBtn");
      if (el) el.classList.toggle("has-unread", unreadCount() > 0);
    } catch (e) {}
  }

  G.SMD_REFERRALS = { flagOn: flagOn, refer: refer, referPrompt: referPrompt, subscribeInbox: subscribeInbox, openInbox: openInbox, unreadCount: unreadCount, accept: accept };

  // Auto-start the inbox subscription for the signed-in doctor when the flag is on.
  try { if (flagOn()) G.addEventListener("DOMContentLoaded", function () { subscribeInbox(function () {}); }); } catch (e) {}
})();
