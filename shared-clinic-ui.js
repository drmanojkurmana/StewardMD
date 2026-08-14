/* shared-clinic-ui.js — StewardMD "Shared Clinic": the launcher/overlay for the multi-device, encrypted,
 * Google-Drive-synced EMR (clinic-app.js core). Sibling to personal-clinic.js ("My Clinic", single
 * device) — same assessment form + MaiK, but every patient/consult is shared across the clinic's devices
 * through the encrypted Drive-delta sync, and read/written locally so the OPD stays instant + offline.
 *
 * Flow: Create a clinic (name + passphrase) OR Join one already in the signed-in Drive account (passphrase
 * only — the app discovers the clinic + its public salt from Drive). The passphrase is held in the device
 * Keychain (never in localStorage, never in Drive); it derives the AES key that opens both the local
 * encrypted snapshot and the Drive deltas. Patients + consults reuse opd-emr via openProfile(source:
 * "shared", localStore). A single clinic Google account = one clinic (owner's "direct sync" model).
 *
 * Flag: smd_shared_clinic (default OFF) or ?shared=1. window.SMD_SHARED. Generic — no ONCQIS / oncology.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : this;
  var CFG_KEY = "smd_shared_config";     // non-secret: {clinicId, salt, name}
  var DEV_KEY = "smd_shared_devid";      // stable per-device id (localStorage)
  var _app = null;                       // live SMD_CLINIC_APP instance once unlocked

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(m) { try { (G.toast || function () {})(m); } catch (e) {} }
  function rand() { try { return Math.floor(Math.random() * 1e9).toString(36); } catch (e) { return "0"; } }
  function uid(pre) { try { return pre + Date.now().toString(36) + rand(); } catch (e) { return pre + rand(); } }
  function readCfg() { try { var s = localStorage.getItem(CFG_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function writeCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
  function devId() { try { var v = localStorage.getItem(DEV_KEY); if (!v) { v = uid("dev"); localStorage.setItem(DEV_KEY, v); } return v; } catch (e) { return uid("dev"); } }
  function userId() { try { return (G.SMD_AUTH && G.SMD_AUTH.currentUser && G.SMD_AUTH.currentUser.uid) || (G.SMD_ACCOUNT && G.SMD_ACCOUNT.uid && G.SMD_ACCOUNT.uid()) || ""; } catch (e) { return ""; } }

  /* ---- passphrase in the device Keychain (SecureStoragePlugin); localStorage fallback on web dev only ---- */
  function SS() { try { var P = G.Capacitor && G.Capacitor.Plugins; return (P && P.SecureStoragePlugin) || null; } catch (e) { return null; } }
  function setSecret(pw) { var s = SS(); if (s && s.set) return Promise.resolve(s.set({ key: "smd_shared_pw", value: pw })).then(function () { return true; }).catch(function () { return false; }); try { sessionStorage.setItem("smd_shared_pw", pw); } catch (e) {} return Promise.resolve(true); }
  function getSecret() { var s = SS(); if (s && s.get) return Promise.resolve(s.get({ key: "smd_shared_pw" })).then(function (r) { return (r && r.value) || null; }).catch(function () { return null; }); try { return Promise.resolve(sessionStorage.getItem("smd_shared_pw")); } catch (e) { return Promise.resolve(null); } }

  /* ---- boot the live app instance ---- */
  function boot(cfg, secret) {
    if (!G.SMD_CLINIC_APP) return Promise.reject(new Error("core_missing"));
    return G.SMD_CLINIC_APP.create({ clinicId: cfg.clinicId, salt: cfg.salt, secret: secret, deviceId: devId(), userId: userId(), bindEvents: true })
      .then(function (inst) { _app = inst; try { inst.start(); } catch (e) {} return inst; });
  }

  /* ------------------------------ UI ------------------------------ */
  function flagOn() { try { if (/[?&]shared=1\b/.test(location.search || "")) return true; return localStorage.getItem("smd_shared_clinic") === "1"; } catch (e) { return false; } }
  function root() { var el = document.getElementById("smdShared"); if (!el) { el = document.createElement("div"); el.id = "smdShared"; document.body.appendChild(el); injectCSS(); } el.onclick = onClick; return el; }
  function close() { var el = document.getElementById("smdShared"); if (el) el.classList.remove("on"); }

  function open() {
    if (!flagOn()) { toast("Enable Shared Clinic in Settings first."); return; }
    var el = root(); el.classList.add("on");
    if (_app) { renderList(); return; }
    var cfg = readCfg();
    if (!cfg) { renderSetup(); return; }
    // clinic configured on this device — unlock with the cached passphrase, else ask
    getSecret().then(function (pw) {
      if (pw) { renderLoading("Opening " + esc(cfg.name || "your clinic") + "…"); boot(cfg, pw).then(renderList, function () { renderUnlock(cfg); }); }
      else renderUnlock(cfg);
    });
  }

  function renderLoading(msg) { var el = document.getElementById("smdShared"); if (el) el.innerHTML = '<div class="sc-top"><span class="sc-ic"></span><div class="sc-ttl">Shared Clinic</div><span class="sc-ic"></span></div><div class="sc-body"><div class="sc-empty">' + esc(msg || "Loading…") + "</div></div>"; }

  function renderSetup() {
    var el = document.getElementById("smdShared"); if (!el) return;
    el.innerHTML =
      '<div class="sc-top"><button class="sc-ic" data-sc="close" aria-label="Close">&#10005;</button><div class="sc-ttl">Shared Clinic</div><span class="sc-ic"></span></div>' +
      '<div class="sc-body">' +
        '<div class="sc-card"><div class="sc-card-t">Create a clinic</div>' +
          '<div class="sc-card-s">For a clinic or small hospital with no EMR. Patients + consults are shared across all your clinic devices, encrypted, through your clinic Google account.</div>' +
          '<form id="scNew" class="sc-form" style="margin-top:12px">' +
            '<label class="sc-f"><span>Clinic name</span><input name="name" autocomplete="off" placeholder="e.g. Sunrise Clinic" required></label>' +
            '<label class="sc-f"><span>Clinic passphrase</span><input name="pw" type="password" autocomplete="new-password" placeholder="Shared by all devices" required></label>' +
            '<button class="sc-add" type="submit" style="margin:0">Create clinic</button></form></div>' +
        '<div class="sc-card"><div class="sc-card-t">Join a clinic</div>' +
          '<div class="sc-card-s">Second device? Sign into the SAME clinic Google account, then enter the clinic passphrase.</div>' +
          '<form id="scJoin" class="sc-form" style="margin-top:12px">' +
            '<label class="sc-f"><span>Clinic passphrase</span><input name="pw" type="password" autocomplete="off" required></label>' +
            '<button class="sc-btn2" type="submit" style="margin:0">Find + join clinic</button></form></div>' +
        '<div class="sc-foot">The passphrase never leaves your device (kept in the Keychain) and is not stored in Drive. Only devices with it can read the clinic. Keep it safe — it cannot be recovered.</div>' +
      '</div>';
    bindForm("scNew", function (d) {
      if (!String(d.name || "").trim() || !d.pw) return;
      var salt = (G.SMD_CLINIC_CRYPTO && G.SMD_CLINIC_CRYPTO.newSalt) ? G.SMD_CLINIC_CRYPTO.newSalt() : "";
      var cfg = { clinicId: uid("sc"), salt: salt, name: String(d.name).trim() };
      renderLoading("Creating " + esc(cfg.name) + "…");
      writeCfg(cfg);
      setSecret(d.pw).then(function () { return boot(cfg, d.pw); }).then(function () {
        // publish the non-secret config to Drive so other devices can join (best-effort; needs Drive sign-in)
        try { G.SMD_CLINIC_DRIVE.create(cfg.clinicId).putConfig(cfg); } catch (e) {}
        renderList();
      }, function () { toast("Could not open the clinic on this device."); renderSetup(); });
    });
    bindForm("scJoin", function (d) {
      if (!d.pw) return;
      renderLoading("Looking for your clinic in Google Drive…");
      Promise.resolve(G.SMD_CLINIC_DRIVE && G.SMD_CLINIC_DRIVE.discover ? G.SMD_CLINIC_DRIVE.discover({}) : []).then(function (found) {
        var cfg = found && found[0];
        if (!cfg || !cfg.clinicId) { toast("No clinic found. Sign into the clinic Google account, or create the clinic first."); renderSetup(); return; }
        writeCfg(cfg);
        setSecret(d.pw).then(function () { return boot(cfg, d.pw); }).then(function () { _app.syncNow(); renderList(); }, function () { toast("Wrong passphrase, or the clinic could not be opened."); renderSetup(); });
      }, function () { toast("Could not reach Google Drive. Check your clinic Google sign-in."); renderSetup(); });
    });
  }

  function renderUnlock(cfg) {
    var el = document.getElementById("smdShared"); if (!el) return;
    el.innerHTML =
      '<div class="sc-top"><button class="sc-ic" data-sc="close" aria-label="Close">&#10005;</button><div class="sc-ttl">' + esc(cfg.name || "Shared Clinic") + '</div><span class="sc-ic"></span></div>' +
      '<div class="sc-body"><div class="sc-card"><div class="sc-card-t">Unlock this clinic</div>' +
        '<div class="sc-card-s">Enter the clinic passphrase to open patients on this device.</div>' +
        '<form id="scUnlock" class="sc-form" style="margin-top:12px"><label class="sc-f"><span>Passphrase</span><input name="pw" type="password" autocomplete="off" required></label>' +
        '<button class="sc-add" type="submit" style="margin:0">Unlock</button></form></div>' +
        '<div class="sc-foot"><button class="sc-link" data-sc="reset">Use a different clinic</button></div></div>';
    bindForm("scUnlock", function (d) {
      if (!d.pw) return;
      renderLoading("Opening…");
      setSecret(d.pw).then(function () { return boot(cfg, d.pw); }).then(function () { _app.syncNow(); renderList(); }, function () { toast("Could not open the clinic — check the passphrase."); renderUnlock(cfg); });
    });
  }

  function renderList() {
    var el = document.getElementById("smdShared"); if (!el || !_app) return;
    var pts = _app.listPatients();
    var pend = 0, conf = 0; try { pend = _app.pendingCount(); conf = _app.conflictCount(); } catch (e) {}
    var status = conf ? (conf + " to review") : (pend ? (pend + " to sync") : "All synced");
    el.innerHTML =
      '<div class="sc-top"><button class="sc-ic" data-sc="close" aria-label="Close">&#10005;</button>' +
        '<div class="sc-ttl">Shared Clinic</div>' +
        '<button class="sc-ic" data-sc="sync" aria-label="Sync now" title="Sync now">&#8635;</button></div>' +
      '<div class="sc-body">' +
        '<div class="sc-status' + (conf ? ' warn' : '') + '" data-sc="sync">' + esc(status) + '</div>' +
        '<button class="sc-add" data-sc="new">+ New patient</button>' +
        (pts.length ? '<div class="sc-list">' + pts.map(function (p) {
          var sub = [p.age && (p.age + "y"), p.sex, p.phone].filter(Boolean).join(" · ");
          return '<button class="sc-row" data-sc="open:' + esc(p.id) + '"><div class="sc-row-b"><span class="sc-row-n">' + esc(p.name) + '</span>' + (sub ? '<span class="sc-row-s">' + esc(sub) + '</span>' : "") + '</div><span class="sc-row-c">&#8250;</span></button>';
        }).join("") + '</div>'
          : '<div class="sc-empty">No patients yet. Tap <b>+ New patient</b> to start. Everything syncs to your clinic devices.</div>') +
        '<div class="sc-foot">Shared across your clinic devices · encrypted · backed up to your clinic Google Drive</div>' +
      '</div>';
  }

  function renderNew() {
    var el = document.getElementById("smdShared"); if (!el) return;
    el.innerHTML =
      '<div class="sc-top"><button class="sc-ic" data-sc="list" aria-label="Back">&#8249;</button><div class="sc-ttl">New patient</div><span class="sc-ic"></span></div>' +
      '<div class="sc-body"><form id="scForm" class="sc-form">' +
        '<label class="sc-f"><span>Name</span><input name="name" autocomplete="off" required></label>' +
        '<div class="sc-frow"><label class="sc-f"><span>Age</span><input name="age" inputmode="numeric"></label>' +
          '<label class="sc-f"><span>Sex</span><select name="sex"><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></label></div>' +
        '<label class="sc-f"><span>Phone</span><input name="phone" inputmode="tel" autocomplete="off"></label>' +
        '<button class="sc-add" type="submit">Create + start consult</button>' +
      '</form></div>';
    bindForm("scForm", function (d) { if (!String(d.name || "").trim() || !_app) return; var id = _app.addPatient(d); openConsult(id); });
  }

  function openConsult(id) {
    if (!_app) return; var p = _app.getPatient(id); if (!p) return;
    close();
    if (G.OPDEMR && G.OPDEMR.openProfile) G.OPDEMR.openProfile({ source: "shared", localStore: _app.localStore, name: p.name, patientId: id, tab: "assess" });
    else toast("EMR module not available.");
  }

  function bindForm(id, onSubmit) {
    var f = document.getElementById(id); if (!f) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault(); var d = {}; var els = f.elements;
      for (var i = 0; i < els.length; i++) { var n = els[i].name; if (n) d[n] = els[i].value; }
      onSubmit(d);
    });
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-sc]"); if (!b) return;
    var act = b.getAttribute("data-sc");
    if (act === "close") return close();
    if (act === "list") return renderList();
    if (act === "new") return renderNew();
    if (act === "reset") { try { localStorage.removeItem(CFG_KEY); } catch (x) {} _app = null; return renderSetup(); }
    if (act === "sync") { if (_app) { toast("Syncing…"); Promise.resolve(_app.syncNow()).then(function () { renderList(); }); } return; }
    if (act.indexOf("open:") === 0) return openConsult(act.slice(5));
  }

  function injectCSS() {
    if (document.getElementById("smd-shared-css")) return;
    var s = document.createElement("style"); s.id = "smd-shared-css";
    s.textContent = [
      "#smdShared{position:fixed;inset:0;z-index:12020;display:none;background:var(--bg,#f7f9fb);color:var(--ink,#191c1e);font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif)}",
      "#smdShared.on{display:block}",
      "#smdShared .sc-top{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e2e8f0)}",
      "#smdShared .sc-ttl{font:800 20px var(--sans);color:var(--ink,#0f172a)}",
      "#smdShared .sc-ic{min-width:40px;height:40px;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--slate,#475569);border-radius:999px;font-size:18px;cursor:pointer;display:grid;place-items:center}",
      "#smdShared .sc-body{padding:16px;max-width:640px;margin:0 auto;padding-bottom:calc(24px + env(safe-area-inset-bottom))}",
      "#smdShared .sc-status{font:700 12.5px var(--sans);color:var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);border-radius:10px;padding:8px 12px;margin-bottom:12px;cursor:pointer;text-align:center}",
      "#smdShared .sc-status.warn{color:#9a3412;background:#ffedd5}",
      "#smdShared .sc-add{width:100%;border:none;border-radius:14px;background:var(--teal,#0f766e);color:#fff;font:800 15px var(--sans);padding:14px;cursor:pointer;margin-bottom:16px}",
      "#smdShared .sc-list{display:flex;flex-direction:column;gap:8px}",
      "#smdShared .sc-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);border-radius:14px;padding:14px;cursor:pointer}",
      "#smdShared .sc-row-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
      "#smdShared .sc-row-n{font:700 15px var(--sans);color:var(--ink,#0f172a)}",
      "#smdShared .sc-row-s{font:500 12.5px var(--sans);color:var(--slate-soft,#64748b)}",
      "#smdShared .sc-row-c{color:var(--slate-soft,#94a3b8);font-size:20px}",
      "#smdShared .sc-empty{text-align:center;color:var(--slate-soft,#64748b);font:500 13.5px/1.6 var(--sans);padding:24px 12px;border:1px dashed var(--line,#cbd5e1);border-radius:14px}",
      "#smdShared .sc-foot{text-align:center;color:var(--slate-soft,#94a3b8);font:600 11px/1.5 var(--sans);margin-top:16px}",
      "#smdShared .sc-link{background:none;border:none;color:var(--teal,#0f766e);font:700 12px var(--sans);cursor:pointer;text-decoration:underline}",
      "#smdShared .sc-form{display:flex;flex-direction:column;gap:12px}",
      "#smdShared .sc-frow{display:flex;gap:12px}#smdShared .sc-frow .sc-f{flex:1}",
      "#smdShared .sc-f{display:flex;flex-direction:column;gap:5px}",
      "#smdShared .sc-f>span{font:700 12px var(--sans);color:var(--slate,#475569)}",
      "#smdShared .sc-f input,#smdShared .sc-f select{border:1.5px solid var(--line,#e2e8f0);border-radius:11px;padding:12px;font:500 15px var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a)}",
      "#smdShared .sc-card{border:1px solid var(--line,#e2e8f0);border-radius:14px;background:var(--panel,#fff);padding:14px;margin-bottom:14px}",
      "#smdShared .sc-card-t{font:800 15px var(--sans);color:var(--ink,#0f172a);margin-bottom:4px}",
      "#smdShared .sc-card-s{font:500 12.5px/1.5 var(--sans);color:var(--slate-soft,#64748b)}",
      "#smdShared .sc-btn2{width:100%;border:1px solid var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e);font:800 14px var(--sans);padding:12px;border-radius:11px;cursor:pointer}",
      "body.dark #smdShared{--bg:#191c1e;--panel:#1f2325;--ink:#eff1f3;--line:#3d4947}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  // ?shared=1 opens it straight away (testing / first look), once the DOM + core are ready.
  function autoOpen() { try { if (/[?&]shared=1\b/.test(location.search || "")) open(); } catch (e) {} }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoOpen);
    else autoOpen();
  }

  var API = { open: open, close: close, flagOn: flagOn, app: function () { return _app; } };
  if (typeof window !== "undefined") window.SMD_SHARED = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
