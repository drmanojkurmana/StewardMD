/* StewardMD — Recent Cases (rolling last-5 activity trail).
 *
 * A lightweight, device-local record of the last 5 cases the clinician worked on
 * across the case features — Clinical reasoning (Dx My Patient), Clinical decision
 * (Start a Case), and ICU. It is intentionally SEPARATE from "My Cases" (the
 * explicit, cloud-syncable saved library): Recent Cases is automatic, capped at 5,
 * and auto-erases the oldest as new ones arrive.
 *
 * Privacy: stored ONLY in localStorage on this device, scoped to the signed-in user
 * (falls back to "guest"). Nothing is sent anywhere. Snapshots hold the case findings
 * so a tap reopens the feature and restores the case where it was left off.
 *
 *   window.SMD_RECENT = {
 *     record(entry)      // upsert by entry.caseId (one evolving case = one entry)
 *     newId(feature)     // mint a fresh case id
 *     get()              // -> [{caseId,feature,title,summary,ts,snapshot}], newest first, <=5
 *     open(caseId)       // reopen + restore that case in its feature
 *     clear()            // wipe the list
 *     onChange(fn)       // subscribe to list changes (badge/UI refresh)
 *   }
 */
(function () {
  var MAX = 5;
  var KEY_BASE = "smd_recent_cases";
  var listeners = [];

  function userKey() {
    try {
      var acc = JSON.parse(localStorage.getItem("stewardmd_account") || "null");
      if (acc && acc.email) return acc.email;
      return localStorage.getItem("stewardmd_last_user") || "guest";
    } catch (e) { return "guest"; }
  }
  function storeKey() { return KEY_BASE + "_" + userKey(); }
  function read() { try { return JSON.parse(localStorage.getItem(storeKey()) || "[]") || []; } catch (e) { return []; } }
  function write(list) { try { localStorage.setItem(storeKey(), JSON.stringify(list.slice(0, MAX))); } catch (e) {} broadcast(); }
  function broadcast() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function newId(feature) { return (feature || "case") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Upsert by caseId: a single evolving case stays one entry and floats to the top,
  // so the list is "the last 5 distinct cases", not "the last 5 keystrokes".
  function record(entry) {
    if (!entry || !entry.caseId || !entry.feature) return;
    var list = read().filter(function (x) { return x.caseId !== entry.caseId; });
    entry.ts = Date.now();
    list.unshift(entry);
    write(list);                                   // write() caps to MAX → oldest auto-erased
  }
  function get() { return read(); }
  function clear() { try { localStorage.removeItem(storeKey()); } catch (e) {} broadcast(); }
  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  function open(caseId) {
    var e = read().find(function (x) { return x.caseId === caseId; });
    if (!e) return;
    try { if (window.SMD_hideHome) window.SMD_hideHome(); } catch (x) {}
    try {
      if (e.feature === "reasoning" && window.DX && window.DX.restore) {
        window.DX.restore(e.snapshot);
      } else if (e.feature === "decision") {
        restoreDecision(e.snapshot);
      } else if (e.feature === "icu" && window.ICU && window.ICU.open) {
        window.ICU.open();
        if (e.snapshot && e.snapshot.ptId && window.ICU.loadPatient) {
          setTimeout(function () { try { window.ICU.loadPatient(e.snapshot.ptId); } catch (x) {} }, 140);
        }
      }
    } catch (x) {}
  }

  // Restore a classic "Clinical decision" case: enter the advanced form, set the
  // findings, and recompute. Falls back to the reasoning workspace (which shares the
  // same finding keys) if the classic form path is unavailable — so a case is never lost.
  function restoreDecision(snap) {
    snap = snap || {};
    var findings = snap.findings || {};
    var adv = document.getElementById("modeAdvancedCard");
    var run = document.getElementById("runBtn");
    if (adv || run) {
      try {
        var shell = document.querySelector(".shell"); if (shell) shell.style.display = "block";
        if (adv) adv.click();
        setTimeout(function () {
          try { if (window.SMD_setFindings) window.SMD_setFindings(findings); } catch (x) {}
          var r = document.getElementById("runBtn");
          if (r) { r.click(); var oa = document.getElementById("outputArea"); if (oa && oa.scrollIntoView) try { oa.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (x) {} }
        }, adv ? 120 : 0);
        return;
      } catch (x) {}
    }
    // fallback — reopen in the reasoning workspace with the same findings
    if (window.DX && window.DX.restore) window.DX.restore({ findings: findings, caseId: snap.caseId });
  }

  window.SMD_RECENT = { record: record, newId: newId, get: get, open: open, clear: clear, onChange: onChange, MAX: MAX };

  /* ---------------- capture: Clinical decision (classic engine → #outputArea) ---------------- */
  // We can't edit the minified classic engine, so we observe its result surface.
  // When #outputArea transitions empty → populated, that's a produced result: record it.
  function labelFindings(f) {
    var keys = Object.keys(f || {}).filter(function (k) { return f[k] === true; });
    return { keys: keys, count: keys.length };
  }
  function watchDecision() {
    var oa = document.getElementById("outputArea");
    if (!oa) { setTimeout(watchDecision, 1000); return; }
    var decId = null, wasEmpty = true;
    var mo = new MutationObserver(function () {
      var has = oa.innerText && oa.innerText.replace(/\s+/g, "").length > 20 && oa.offsetParent !== null;
      if (has) {
        if (wasEmpty || !decId) decId = newId("decision");
        wasEmpty = false;
        var f = {}; try { f = (window.SMD_getFindings && window.SMD_getFindings()) || {}; } catch (x) {}
        var lf = labelFindings(f);
        if (!lf.count) return;                       // no real findings yet — skip
        // top diagnosis: the most prominent heading the classic card renders
        var t = "";
        var el = oa.querySelector(".qa-title, .quick-answer-card h2, .score-card h2, .simple-candidates-card h2, h2, .dx-title, strong");
        if (el) t = (el.innerText || "").trim().slice(0, 80);
        record({ caseId: decId, feature: "decision", title: t || "Clinical decision",
          summary: lf.count + " finding" + (lf.count === 1 ? "" : "s"),
          snapshot: { caseId: decId, findings: (function () { var o = {}; lf.keys.forEach(function (k) { o[k] = true; }); return o; })() } });
      } else { wasEmpty = true; decId = null; }
    });
    mo.observe(oa, { childList: true, subtree: true, characterData: true });
  }

  /* ---------------- capture: ICU (wrap the public API) ---------------- */
  function icuSummary() {
    try {
      var p = (window.ICU_STATE && window.ICU_STATE.patient) || {};
      var bits = [];
      if (p.name) bits.push(p.name);
      if (p.age != null && p.age !== "") bits.push(p.age + (p.sex ? "/" + String(p.sex)[0].toUpperCase() : ""));
      if (p.diagnosis) bits.push(p.diagnosis);
      return { id: p._id || null, title: p.diagnosis || p.name || "ICU patient", summary: bits.join(" · ").slice(0, 90) || "ICU case" };
    } catch (e) { return { id: null, title: "ICU patient", summary: "ICU case" }; }
  }
  function recordIcu() {
    var s = icuSummary();
    var cid = "icu_" + (s.id || Date.now().toString(36));
    record({ caseId: cid, feature: "icu", title: s.title, summary: s.summary, snapshot: { ptId: s.id } });
  }
  function wrapIcu(tries) {
    tries = tries || 0;
    if (!(window.ICU && window.ICU.loadPatient) && tries < 40) { setTimeout(function () { wrapIcu(tries + 1); }, 300); return; }
    if (!window.ICU || window.ICU._smdRecentWrapped) return;
    ["loadPatient", "savePatient"].forEach(function (m) {
      if (typeof window.ICU[m] !== "function") return;
      var orig = window.ICU[m];
      window.ICU[m] = function () { var r = orig.apply(this, arguments); try { setTimeout(recordIcu, 60); } catch (x) {} return r; };
    });
    window.ICU._smdRecentWrapped = true;
  }

  /* ---------------- Recent Cases overlay UI ---------------- */
  var FEAT = {
    reasoning: { icon: "🧠", label: "Clinical reasoning", color: "#0F766E" },
    decision: { icon: "💊", label: "Clinical decision", color: "#B45309" },
    icu: { icon: "🏥", label: "ICU", color: "#7C3AED" }
  };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.round(s / 60); if (m < 60) return m + "m ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  function injectCSS() {
    if (document.getElementById("smd-recent-css")) return;
    var st = document.createElement("style"); st.id = "smd-recent-css";
    st.textContent = [
      ".rc-ov{position:fixed;inset:0;z-index:870;background:var(--paper,#f7f7f5);display:none;flex-direction:column}",
      ".rc-ov.on{display:flex;animation:rcIn .2s ease}@keyframes rcIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      ".rc-bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0)}",
      ".rc-x{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans,system-ui);color:var(--teal,#0F766E);cursor:pointer}",
      ".rc-h{flex:1;text-align:center;font:800 16px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".rc-clr{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:9px;height:34px;padding:0 10px;font:600 12px var(--sans,system-ui);color:var(--slate-soft,#888);cursor:pointer}",
      ".rc-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:720px;margin:0 auto;width:100%;box-sizing:border-box}",
      ".rc-note{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);background:var(--teal-soft,#e0f2f1);border-radius:10px;padding:10px 12px;margin-bottom:14px;line-height:1.5}",
      ".rc-list{display:flex;flex-direction:column;gap:10px}",
      ".rc-card{display:flex;align-items:center;gap:12px;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:13px;padding:13px 14px;cursor:pointer;text-align:left;width:100%;border-left:4px solid var(--line,#e5e5e0)}",
      ".rc-card:active{transform:scale(.995)}",
      ".rc-ic{flex:none;width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:20px;background:var(--teal-soft,#e0f2f1)}",
      ".rc-main{flex:1;min-width:0}",
      ".rc-feat{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;margin-bottom:2px}",
      ".rc-title{font:800 15px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".rc-sub{font:500 12.5px var(--sans,system-ui);color:var(--slate,#666);margin-top:2px}",
      ".rc-time{flex:none;font:600 11px var(--sans,system-ui);color:var(--slate-soft,#999);align-self:flex-start}",
      ".rc-empty{text-align:center;color:var(--slate-soft,#999);font:500 14px var(--sans,system-ui);padding:48px 20px;line-height:1.6}"
    ].join("");
    document.head.appendChild(st);
  }
  var _root = null;
  function build() {
    if (_root) return _root;
    injectCSS();
    _root = document.createElement("div"); _root.className = "rc-ov"; _root.id = "smdRecentOv";
    _root.innerHTML =
      '<div class="rc-bar"><button class="rc-x" id="rcClose">‹ Back</button>' +
      '<div class="rc-h">🕐 Recent Cases</div>' +
      '<button class="rc-clr" id="rcClear">Clear</button></div>' +
      '<div class="rc-scroll"><div class="rc-note">Your last ' + MAX + ' cases across Clinical reasoning, Clinical decision and ICU. Tap one to reopen it. Kept on this device only — the oldest is erased as new cases arrive.</div>' +
      '<div class="rc-list" id="rcList"></div></div>';
    document.body.appendChild(_root);
    _root.querySelector("#rcClose").addEventListener("click", close);
    _root.querySelector("#rcClear").addEventListener("click", function () {
      clear(); render();
    });
    return _root;
  }
  function render() {
    if (!_root) return;
    var list = get();
    var el = _root.querySelector("#rcList");
    if (!list.length) { el.innerHTML = '<div class="rc-empty">No recent cases yet.<br>Work a case in Clinical reasoning, Clinical decision or ICU and it will appear here.</div>'; return; }
    el.innerHTML = list.map(function (c) {
      var f = FEAT[c.feature] || { icon: "📋", label: "Case", color: "#0F766E" };
      return '<button class="rc-card" data-cid="' + esc(c.caseId) + '" style="border-left-color:' + f.color + '">' +
        '<span class="rc-ic">' + f.icon + '</span>' +
        '<span class="rc-main"><span class="rc-feat" style="color:' + f.color + '">' + esc(f.label) + '</span>' +
        '<span class="rc-title">' + esc(c.title || f.label) + '</span>' +
        (c.summary ? '<span class="rc-sub">' + esc(c.summary) + '</span>' : '') + '</span>' +
        '<span class="rc-time">' + ago(c.ts) + '</span></button>';
    }).join("");
    el.querySelectorAll(".rc-card").forEach(function (b) {
      b.addEventListener("click", function () { var id = b.getAttribute("data-cid"); close(); setTimeout(function () { open(id); }, 80); });
    });
  }
  function openOverlay() { build(); render(); _root.classList.add("on"); document.body.classList.add("ntf-lock"); }
  function close() { if (_root) { _root.classList.remove("on"); document.body.classList.remove("ntf-lock"); } }
  window.SMD_openRecentCases = openOverlay;

  /* ---------------- boot ---------------- */
  function boot() { try { watchDecision(); } catch (e) {} try { wrapIcu(); } catch (e) {} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
