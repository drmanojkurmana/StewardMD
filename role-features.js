/* role-features.js - window.SMD_ROLE: who the user is (Medical student / Intern / PG Resident /
 * Doctor) and which Home tools that role gets. Owner, 2026-09-26: a Role box at sign-up and in Profile,
 * and "show only those features to them, lock the rest". Map: vault/Role-Tiers.md section 2.
 *
 * WHAT THIS IS: a presentation gate. It decides which Home tiles open for a role and explains the
 * rest. It is NOT the security boundary: prescribing still needs a full-register verification
 * (prescription.js), paid features still need the plan (server 402s), and the PG logbook still needs
 * an institutional pg_resident membership. A user can change their declared role, so nothing unsafe
 * may rely on this file alone.
 *
 * Source of the role, strongest first:
 *   1. the VERIFIED role the server holds (entitlements.role via /billing/status, cached by account.js
 *      as SMD_PRO.proState().role or localStorage smd_role_verified:<uid>)
 *   2. the role the user DECLARED in the Role box (profile doc `role`, cached in localStorage smd_role)
 *   3. none: nothing is locked (existing users are never locked out by an unanswered question).
 * Kill switch: localStorage smd_role_gates = "0" unlocks everything. ES5, no dependencies. */
(function () {
  "use strict";
  var ROLES = [
    { key: "student", label: "Medical student (UG)", short: "Medical student" },
    { key: "intern", label: "Intern", short: "Intern" },
    { key: "resident", label: "PG Resident", short: "PG Resident" },
    { key: "doctor", label: "Doctor (practising)", short: "Doctor" }
  ];
  // Home tool acts NOT available to a role. Everything else is open to it.
  var PRACTICE = ["followcare", "maitri", "queue", "review", "agentconnect"];
  var LOCKED = {
    student: ["pglog", "dictate", "docs", "review", "kxinbox", "hospital", "icu", "ward", "agentconnect", "dosing", "insulin"].concat(["followcare", "maitri", "queue"]),
    intern: ["pglog", "review", "kxinbox", "ward", "agentconnect", "hospital"].concat(["followcare", "maitri", "queue"]),
    resident: PRACTICE.slice(),
    // Doctors keep the eLogbook (owner, 2026-09-26): guides, co-guides and HODs verify residents' entries in it.
    doctor: []
  };
  // Who a locked tool IS for, in the explainer.
  var FOR = {
    pglog: "PG residents and doctors (NMC PG logbook)",
    followcare: "practising doctors", maitri: "practising doctors", queue: "practising doctors with a clinic",
    review: "practising doctors (clinical reviewers)", agentconnect: "practising doctors",
    kxinbox: "registered doctors and PG residents", ward: "PG residents and doctors", hospital: "PG residents and doctors",
    icu: "interns, PG residents and doctors", dictate: "interns, PG residents and doctors", docs: "interns, PG residents and doctors",
    dosing: "interns, PG residents and doctors", insulin: "interns, PG residents and doctors"
  };

  function uid() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser && SMD_AUTH.currentUser.uid) || ""; } catch (e) { return ""; } }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  // "Medical student (UG)", "student", "physician", "co_resident" ... -> student|intern|resident|doctor|null
  function normalize(r) {
    var v = String(r == null ? "" : r).trim().toLowerCase();
    if (!v) return null;
    for (var i = 0; i < ROLES.length; i++) if (v === ROLES[i].key || v === ROLES[i].label.toLowerCase() || v === ROLES[i].short.toLowerCase()) return ROLES[i].key;
    if (v === "physician" || v === "physician_pro" || v === "pro") return "doctor";
    if (v === "co_resident" || v === "pg resident") return "resident";
    return null;
  }
  function verifiedRole() {
    try { var st = window.SMD_PRO && SMD_PRO.proState && SMD_PRO.proState(); var r = normalize(st && st.role); if (r) return r; } catch (e) {}
    var u = uid(); return u ? normalize(ls("smd_role_verified:" + u)) : null;
  }
  function declaredRole() { return normalize(ls("smd_role")); }
  function current() { return verifiedRole() || declaredRole(); }
  function isVerified() { return !!verifiedRole(); }
  function gatesOn() { return ls("smd_role_gates") !== "0"; }
  function allows(act) {
    if (!gatesOn()) return true;
    var r = current(); if (!r) return true;
    return (LOCKED[r] || []).indexOf(String(act || "")) < 0;
  }
  function labelOf(r) { r = normalize(r); for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === r) return ROLES[i].short; return ""; }
  function lockReason(act, title) {
    var who = FOR[act] || "other roles";
    return (title || "This tool") + " is for " + who + ". Your role is set to " + (labelOf(current()) || "not set") + ".";
  }
  // Declare (Role box). Persists locally at once so Home re-renders now; the profile doc write is the
  // caller's (profile-setup.js / the Profile card), which also syncs it to other devices.
  function set(r) {
    var k = normalize(r); if (!k) return false;
    ls("smd_role", k);
    try { document.dispatchEvent(new CustomEvent("smd:role-changed", { detail: { role: k } })); } catch (e) {}
    return true;
  }
  // The server's verified role (account.js / billing status). Remembered per account.
  function setVerified(r) {
    var u = uid(), k = normalize(r); if (!u) return;
    ls("smd_role_verified:" + u, k || null);
    try { document.dispatchEvent(new CustomEvent("smd:role-changed", { detail: { role: current(), verified: !!k } })); } catch (e) {}
  }
  // A profile doc arrived (profile-setup.js smd:profile-loaded carries it): adopt its declared role.
  document.addEventListener("smd:profile-loaded", function (e) {
    var r = normalize(e && e.detail && e.detail.role);
    if (r && r !== declaredRole()) set(r);
  });

  // The server's verified role arrives with /billing/status (account.js keeps it as SMD_PRO.proState()),
  // after first paint. Adopt it when it appears or changes, so Home re-renders with the right locks.
  function syncVerified() {
    try {
      var st = window.SMD_PRO && SMD_PRO.proState && SMD_PRO.proState(); if (!st) return false;
      var u = uid(); if (!u) return true;
      var r = normalize(st.role), prev = normalize(ls("smd_role_verified:" + u));
      if (r !== prev) setVerified(r);
      return true;
    } catch (e) { return false; }
  }
  (function watch() {
    var n = 0, t = setInterval(function () { n++; if (syncVerified() || n > 90) clearInterval(t); }, 1000);
    try { window.addEventListener("smd:tier", syncVerified); } catch (e) {}
    try { document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(syncVerified, 1500); }); } catch (e) {}
  })();

  /* Keep what another script already hung on SMD_ROLE (native-watch.js adds seniorMost /
   * isRestricted). Whichever of the two loads first, neither may erase the other. */
  var _prevRole = window.SMD_ROLE || null;
  window.SMD_ROLE = {
    syncVerified: syncVerified,
    ROLES: ROLES, LOCKED: LOCKED, normalize: normalize, current: current, declared: declaredRole,
    verified: verifiedRole, isVerified: isVerified, allows: allows, lockReason: lockReason,
    labelOf: labelOf, set: set, setVerified: setVerified, gatesOn: gatesOn,
    labels: function () { return ROLES.map(function (x) { return x.label; }); }
  };
  if (_prevRole) { for (var _k in _prevRole) { if (Object.prototype.hasOwnProperty.call(_prevRole, _k) && !(_k in window.SMD_ROLE)) window.SMD_ROLE[_k] = _prevRole[_k]; } }
})();
