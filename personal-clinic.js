/* personal-clinic.js — StewardMD "My Clinic": on-device EMR for solo/personal clinics.
 * ---------------------------------------------------------------------------------------
 * A doctor WITHOUT a hospital EMR (GHIS) gets the SAME assessment template + Voice Consult +
 * MaiK, but every patient + consult is stored ON THIS PHONE (localStorage) — no server, fully
 * offline. Reuses opd-emr's whole overlay via openProfile({ source:"local", localStore }).
 *
 * Backup / Google Drive: exportJSON() serialises every patient+consult; backup() writes it to a
 * file and opens the native Share sheet so the doctor can "Save to Drive" (no OAuth needed).
 * uploadToDrive(accessToken) is the direct Drive REST path for when an OAuth client is wired.
 *
 * Store is headless-testable (localStorage injected via configure). window.SMD_CLINIC + module.exports.
 * Flag: smd_personal_clinic (default OFF). No PHI leaves the device unless the doctor shares a backup.
 */
(function () {
  "use strict";

  var KEY_PTS = "stewardmd.clinic.patients";              // index: [{id,name,age,sex,phone,at,updatedAt}]
  var KEY_P = function (id) { return "stewardmd.clinic.p." + id; };   // per-patient: {patient, latest, consults:[{at,fields}]}

  var LS = (function () { try { return (typeof localStorage !== "undefined") ? localStorage : (typeof window !== "undefined" ? window.localStorage : null); } catch (e) { return null; } })();
  function configure(deps) { if (deps && deps.localStorage) LS = deps.localStorage; }
  function readJSON(k, dflt) { try { var s = LS && LS.getItem(k); return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
  function writeJSON(k, v) { try { LS && LS.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function nowISO() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  var _seq = 0;
  function uid() { _seq++; try { return "pc" + Date.now().toString(36) + _seq.toString(36); } catch (e) { return "pc" + _seq; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ------------------------------ store ------------------------------ */
  function listPatients() { var a = readJSON(KEY_PTS, []); return Array.isArray(a) ? a : []; }
  function getPatient(id) { var r = readJSON(KEY_P(id), null); return (r && r.patient) || null; }
  function addPatient(p) {
    p = p || {}; var id = uid();
    var rec = { id: id, name: String(p.name || "").trim() || "Unnamed", age: String(p.age || "").trim(), sex: p.sex || "", phone: String(p.phone || "").trim(), at: nowISO(), updatedAt: nowISO() };
    var idx = listPatients(); idx.unshift(rec); writeJSON(KEY_PTS, idx);
    writeJSON(KEY_P(id), { patient: rec, latest: {}, consults: [] });
    return id;
  }
  function deletePatient(id) {
    writeJSON(KEY_PTS, listPatients().filter(function (x) { return x.id !== id; }));
    try { LS && LS.removeItem(KEY_P(id)); } catch (e) {}
  }
  // opd-emr backend: current assessment values for prefill.
  function getConsult(id) { var r = readJSON(KEY_P(id), null); return (r && r.latest) || {}; }
  // opd-emr backend: persist a saved consult (fields = GHIS-name payload, vals = form state for prefill).
  function saveConsult(id, fields, vals) {
    var r = readJSON(KEY_P(id), null) || { patient: getPatient(id), latest: {}, consults: [] };
    r.latest = vals || {}; r.consults = r.consults || []; r.consults.unshift({ at: nowISO(), fields: fields || {} });
    writeJSON(KEY_P(id), r);
    var idx = listPatients(); for (var i = 0; i < idx.length; i++) if (idx[i].id === id) { idx[i].updatedAt = nowISO(); break; }
    writeJSON(KEY_PTS, idx);
  }
  var localStore = { getConsult: getConsult, saveConsult: saveConsult };

  /* ------------------------------ backup / Drive ------------------------------ */
  function exportJSON() {
    var out = { app: "StewardMD My Clinic", version: 1, exportedAt: nowISO(), patients: [] };
    listPatients().forEach(function (p) { out.patients.push(readJSON(KEY_P(p.id), null) || { patient: p, latest: {}, consults: [] }); });
    return JSON.stringify(out, null, 2);
  }
  function importJSON(json) {
    var data; try { data = (typeof json === "string") ? JSON.parse(json) : json; } catch (e) { return { ok: false, error: "bad_json" }; }
    if (!data || !Array.isArray(data.patients)) return { ok: false, error: "bad_shape" };
    var idx = listPatients(), byId = {}; idx.forEach(function (p) { byId[p.id] = 1; }); var added = 0;
    data.patients.forEach(function (rec) {
      var p = rec && rec.patient; if (!p || !p.id) return;
      writeJSON(KEY_P(p.id), { patient: p, latest: rec.latest || {}, consults: rec.consults || [] });
      if (!byId[p.id]) { idx.unshift(p); byId[p.id] = 1; added++; }
    });
    writeJSON(KEY_PTS, idx); return { ok: true, added: added };
  }
  // Save a backup file and open the native Share sheet (the doctor picks Google Drive / Files / etc).
  function backup() {
    var data = exportJSON(), name = "stewardmd-clinic-backup.json";
    try {
      var C = window.Capacitor, P = C && C.Plugins;
      if (P && P.Filesystem && P.Share) {
        return P.Filesystem.writeFile({ path: name, data: data, directory: "CACHE", encoding: "utf8" })
          .then(function (w) { return P.Share.share({ title: "StewardMD clinic backup", text: "My Clinic patients + consults", url: w.uri }); })
          .then(function () { return { ok: true, shared: true }; })
          .catch(function (e) { return webDownload(name, data); });
      }
    } catch (e) {}
    return Promise.resolve(webDownload(name, data));
  }
  function webDownload(name, data) {
    try {
      var b = new Blob([data], { type: "application/json" }), u = URL.createObjectURL(b);
      var a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 500);
      return { ok: true, downloaded: true };
    } catch (e) { return { ok: false, error: "share_unavailable" }; }
  }
  // Direct Google Drive upload (multipart, appDataFolder). Needs an OAuth access token (Drive scope).
  // Owner wires the OAuth client; this uploads the backup as one file, overwriting by name if present.
  function uploadToDrive(accessToken) {
    if (!accessToken) return Promise.resolve({ ok: false, error: "no_token" });
    var data = exportJSON(), name = "stewardmd-clinic-backup.json";
    var meta = { name: name, parents: ["appDataFolder"] };
    var boundary = "smdclinic" + Date.now();
    var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + data + "\r\n--" + boundary + "--";
    return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST", headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "multipart/related; boundary=" + boundary }, body: body
    }).then(function (r) { return r.ok ? { ok: true } : { ok: false, error: "http_" + r.status }; })
      .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }

  /* ------------------------------ UI ------------------------------ */
  function flagOn() { try { return localStorage.getItem("smd_personal_clinic") === "1"; } catch (e) { return false; } }
  function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} }
  function root() { var el = document.getElementById("smdClinic"); if (!el) { el = document.createElement("div"); el.id = "smdClinic"; document.body.appendChild(el); injectCSS(); } return el; }

  function open() {
    if (!flagOn()) { toast("Enable My Clinic in Settings first."); return; }
    var el = root(); el.classList.add("on");
    el.onclick = onClick; renderList();
  }
  function close() { var el = document.getElementById("smdClinic"); if (el) el.classList.remove("on"); }

  function renderList() {
    var el = document.getElementById("smdClinic"); if (!el) return;
    var pts = listPatients();
    el.innerHTML =
      '<div class="pc-top"><button class="pc-ic" data-pc="close" aria-label="Close">&#10005;</button>' +
        '<div class="pc-ttl">My Clinic</div>' +
        '<button class="pc-ic" data-pc="backup" aria-label="Back up to Drive" title="Back up / Save to Drive">&#8681;</button></div>' +
      '<div class="pc-body">' +
        '<button class="pc-add" data-pc="new">+ New patient</button>' +
        (pts.length ? '<div class="pc-list">' + pts.map(function (p) {
          var sub = [p.age && (p.age + "y"), p.sex, p.phone].filter(Boolean).join(" · ");
          return '<button class="pc-row" data-pc="open:' + esc(p.id) + '"><div class="pc-row-b"><span class="pc-row-n">' + esc(p.name) + '</span>' +
            (sub ? '<span class="pc-row-s">' + esc(sub) + '</span>' : "") + '</div><span class="pc-row-c">&#8250;</span></button>';
        }).join("") + '</div>'
          : '<div class="pc-empty">No patients yet. Tap <b>+ New patient</b> to start a consult. Everything stays on this phone.</div>') +
        '<div class="pc-foot">On-device EMR · back up to Google Drive from the button above</div>' +
      '</div>';
  }

  function renderNew() {
    var el = document.getElementById("smdClinic"); if (!el) return;
    el.innerHTML =
      '<div class="pc-top"><button class="pc-ic" data-pc="list" aria-label="Back">&#8249;</button><div class="pc-ttl">New patient</div><span class="pc-ic"></span></div>' +
      '<div class="pc-body"><form id="pcForm" class="pc-form">' +
        '<label class="pc-f"><span>Name</span><input name="name" autocomplete="off" required></label>' +
        '<div class="pc-frow"><label class="pc-f"><span>Age</span><input name="age" inputmode="numeric"></label>' +
          '<label class="pc-f"><span>Sex</span><select name="sex"><option value="">-</option><option>Male</option><option>Female</option><option>Other</option></select></label></div>' +
        '<label class="pc-f"><span>Phone</span><input name="phone" inputmode="tel" autocomplete="off"></label>' +
        '<button class="pc-add" type="submit">Create + start consult</button>' +
      '</form></div>';
    var f = document.getElementById("pcForm");
    if (f) f.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = {}; ["name", "age", "sex", "phone"].forEach(function (k) { var i = f.elements[k]; if (i) d[k] = i.value; });
      if (!String(d.name || "").trim()) return;
      var id = addPatient(d); openConsult(id);
    });
  }

  function openConsult(id) {
    var p = getPatient(id); if (!p) return;
    close();
    if (window.OPDEMR && OPDEMR.openProfile) OPDEMR.openProfile({ source: "local", localStore: localStore, name: p.name, patientId: id, tab: "assess" });
    else toast("EMR module not available.");
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-pc]"); if (!b) return;
    var act = b.getAttribute("data-pc");
    if (act === "close") return close();
    if (act === "list") return renderList();
    if (act === "new") return renderNew();
    if (act === "backup") { Promise.resolve(backup()).then(function (r) { toast(r && r.ok ? (r.downloaded ? "Backup downloaded." : "Choose Google Drive to save your backup.") : "Backup failed."); }); return; }
    if (act.indexOf("open:") === 0) return openConsult(act.slice(5));
  }

  function injectCSS() {
    if (document.getElementById("smd-clinic-css")) return;
    var s = document.createElement("style"); s.id = "smd-clinic-css";
    s.textContent = [
      "#smdClinic{position:fixed;inset:0;z-index:12020;display:none;background:var(--bg,#f7f9fb);color:var(--ink,#191c1e);font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif)}",
      "#smdClinic.on{display:block}",
      "#smdClinic .pc-top{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e2e8f0)}",
      "#smdClinic .pc-ttl{font:800 20px var(--sans);color:var(--ink,#0f172a)}",
      "#smdClinic .pc-ic{min-width:40px;height:40px;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);color:var(--slate,#475569);border-radius:999px;font-size:18px;cursor:pointer;display:grid;place-items:center}",
      "#smdClinic .pc-body{padding:16px;max-width:640px;margin:0 auto;padding-bottom:calc(24px + env(safe-area-inset-bottom))}",
      "#smdClinic .pc-add{width:100%;border:none;border-radius:14px;background:var(--teal,#0f766e);color:#fff;font:800 15px var(--sans);padding:14px;cursor:pointer;margin-bottom:16px}",
      "#smdClinic .pc-list{display:flex;flex-direction:column;gap:8px}",
      "#smdClinic .pc-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);border-radius:14px;padding:14px;cursor:pointer}",
      "#smdClinic .pc-row-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
      "#smdClinic .pc-row-n{font:700 15px var(--sans);color:var(--ink,#0f172a)}",
      "#smdClinic .pc-row-s{font:500 12.5px var(--sans);color:var(--slate-soft,#64748b)}",
      "#smdClinic .pc-row-c{color:var(--slate-soft,#94a3b8);font-size:20px}",
      "#smdClinic .pc-empty{text-align:center;color:var(--slate-soft,#64748b);font:500 13.5px/1.6 var(--sans);padding:24px 12px;border:1px dashed var(--line,#cbd5e1);border-radius:14px}",
      "#smdClinic .pc-foot{text-align:center;color:var(--slate-soft,#94a3b8);font:600 11px var(--sans);margin-top:16px}",
      "#smdClinic .pc-form{display:flex;flex-direction:column;gap:12px}",
      "#smdClinic .pc-frow{display:flex;gap:12px}#smdClinic .pc-frow .pc-f{flex:1}",
      "#smdClinic .pc-f{display:flex;flex-direction:column;gap:5px}",
      "#smdClinic .pc-f>span{font:700 12px var(--sans);color:var(--slate,#475569)}",
      "#smdClinic .pc-f input,#smdClinic .pc-f select{border:1.5px solid var(--line,#e2e8f0);border-radius:11px;padding:12px;font:500 15px var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a)}",
      "body.dark #smdClinic{--bg:#191c1e;--panel:#1f2325;--ink:#eff1f3;--line:#3d4947}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  var API = { open: open, close: close, flagOn: flagOn, localStore: localStore,
    listPatients: listPatients, getPatient: getPatient, addPatient: addPatient, deletePatient: deletePatient,
    getConsult: getConsult, saveConsult: saveConsult, exportJSON: exportJSON, importJSON: importJSON,
    backup: backup, uploadToDrive: uploadToDrive, configure: configure };
  if (typeof window !== "undefined") window.SMD_CLINIC = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
