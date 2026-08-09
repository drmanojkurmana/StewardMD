/* connect-patient.js — StewardMD Connect patient pull (P2, increment 2). Exposes window.CONNECTPT.
 *
 * "Connect once, it just works" (like GIMSR): pick a hospital you onboarded via Connect + a patient
 * reference, pull that patient's NORMALIZED (SCCM) record via window.SMD_CONNECT, and feed it into the
 * app's EXISTING clinical surfaces:
 *   - demographics + labs -> the ICU dashboard, via the SAME conflict-safe path GHIS/GIMSR uses
 *     (ICU.ingestPatient + ICU.ingestWardHistory; never overwrites a manually-entered value);
 *   - problems / allergies / medications -> shown in the pull summary;
 *   - medications -> the med list (MEDLIST) only on an EXPLICIT tap (never auto-changes a prescription).
 *
 * PHI: the pulled bundle populates the in-app dashboards and is not persisted by this module.
 * Flag: smd_connect_ehr (default ON; ?connectehr=0 or localStorage "0" disables). Owner + RBAC are
 * enforced SERVER-side on every pull; this module never trusts a client-supplied tenant/patient.
 */
(function () {
  "use strict";

  function flagOn() {
    try {
      var q = (location.search.match(/[?&]connectehr=([^&]+)/) || [])[1];
      if (q != null) return q !== "0";
      return localStorage.getItem("smd_connect_ehr") !== "0";
    } catch (e) { return true; }
  }
  function C() { return window.SMD_CONNECT; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function tt(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function loadLast() { try { return JSON.parse(localStorage.getItem("smd_connect_last") || "null"); } catch (e) { return null; } }
  function saveLast(tid, ref) { try { localStorage.setItem("smd_connect_last", JSON.stringify({ tenantId: tid, patientRef: ref })); } catch (e) {} }

  // ---- pure SCCM -> app mappers (unit-tested via the exposed _* handles) --------------------------
  function ageFromDob(dob, nowMs) {
    try {
      var d = new Date(dob); if (isNaN(d.getTime())) return "";
      var now = nowMs != null ? new Date(nowMs) : new Date();
      var a = now.getFullYear() - d.getFullYear();
      var mo = now.getMonth() - d.getMonth();
      if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) a--;
      return (a >= 0 && a < 150) ? a : "";
    } catch (e) { return ""; }
  }
  function patientName(p) {
    if (!p || !p.name) return "Unknown";
    if (p.name.text) return p.name.text;
    var g = (p.name.given || []).join(" "), f = p.name.family || "";
    return (g + " " + f).trim() || "Unknown";
  }
  function demographics(bundle) {
    var p = bundle && bundle.patient, conds = (bundle && bundle.conditions) || [];
    return {
      name: patientName(p),
      sex: (p && p.gender && p.gender !== "unknown") ? p.gender : "",
      age: ageFromDob(p && p.birthDate),
      mrn: (p && p.identifiers && p.identifiers[0] && p.identifiers[0].value) || "",
      diagnosis: conds.map(function (c) { return c && c.code && c.code.text; }).filter(Boolean).join("; "),
    };
  }
  function obsValue(o) {
    var v = o && o.value; if (v == null) return "";
    if (v.value != null) return v.value;   // Quantity numeric
    if (v.text != null) return v.text;     // valueString / valueCodeableConcept
    return "";
  }
  // LAB observations only (vital-signs are routed to the ICU monitor separately, see vitalsFromObs).
  function labRows(bundle) {
    var obs = ((bundle && bundle.observations) || []).filter(function (o) { return o.category !== "vital-signs"; });
    return obs.map(function (o) {
      return {
        test: (o.code && o.code.text) || "",
        result: obsValue(o),
        units: (o.value && o.value.unit) || "",
        low: (o.referenceRange && o.referenceRange.low && o.referenceRange.low.value),
        high: (o.referenceRange && o.referenceRange.high && o.referenceRange.high.value),
        date: o.effectiveDateTime || "",
      };
    }).filter(function (r) { return r.test && r.result !== ""; });
  }
  // VITAL-SIGNS observations -> the ICU monitor's vitals object (LOINC-coded, with a BP-panel + text fallback).
  var VITAL_LOINC = { "8867-4": "hr", "8480-6": "sbp", "8462-4": "dbp", "8478-0": "map", "9279-1": "rr", "2708-6": "spo2", "59408-5": "spo2", "8310-5": "temp", "8329-5": "temp" };
  function obsNum(o) { var v = o && o.value; return (v && v.value != null && !isNaN(+v.value)) ? +v.value : null; }
  function vitalsFromObs(bundle) {
    var out = {};
    ((bundle && bundle.observations) || []).forEach(function (o) {
      if (o.category !== "vital-signs") return;
      var codes = ((o.code && o.code.coding) || []).map(function (c) { return c.code; });
      (o.components || o.component || []).forEach(function (c) {   // BP panel components
        var cc = ((c.code && c.code.coding) || []).map(function (x) { return x.code; });
        var k = cc.indexOf("8480-6") > -1 ? "sbp" : cc.indexOf("8462-4") > -1 ? "dbp" : null;
        var val = c.value && c.value.value; if (k && val != null && !isNaN(+val) && out[k] == null) out[k] = +val;
      });
      var key = null; for (var i = 0; i < codes.length; i++) { if (VITAL_LOINC[codes[i]]) { key = VITAL_LOINC[codes[i]]; break; } }
      if (!key) { var t = ((o.code && o.code.text) || "").toLowerCase(); key = /heart rate|pulse/.test(t) ? "hr" : /systolic/.test(t) ? "sbp" : /diastolic/.test(t) ? "dbp" : /respirat/.test(t) ? "rr" : /oxygen sat|spo2|o2 sat/.test(t) ? "spo2" : /temperature/.test(t) ? "temp" : null; }
      var n = obsNum(o); if (key && n != null && out[key] == null) out[key] = n;
    });
    return out;
  }
  // DiagnosticReports -> ICU imaging/report records (the shape ICU.ingestWardImaging normalizes).
  function imagingRows(bundle) {
    return ((bundle && bundle.diagnosticReports) || []).map(function (r) {
      return { studyName: (r.code && r.code.text) || r.category || "Diagnostic report", report: r.conclusion || "", date: r.effectiveDateTime || r.issued || "" };
    }).filter(function (x) { return x.report || x.studyName; });
  }
  function medText(m) {
    var n = (m && m.medication && m.medication.text) || "";
    var d = (m && m.dosage && m.dosage.text) || "";
    return (n + " " + d).trim();
  }

  // ---- feed the app's existing surfaces ----------------------------------------------------------
  function pushToICU(bundle) {
    var out = { labs: 0, vitals: 0, imaging: 0 };
    try {
      var demo = demographics(bundle);
      var pid = (bundle.patient && bundle.patient.id) || "";
      if (window.ICU && window.ICU.ingestPatient) window.ICU.ingestPatient({ name: demo.name, sex: demo.sex, age: demo.age, mrn: demo.mrn, diagnosis: demo.diagnosis });
      var labs = labRows(bundle), vitals = vitalsFromObs(bundle);
      if ((labs.length || Object.keys(vitals).length) && window.ICU && window.ICU.ingestWardHistory) {
        window.ICU.ingestWardHistory({ patient: { name: demo.name }, patientId: pid, source: "Connect EMR", labs: labs, vitals: Object.keys(vitals).length ? vitals : undefined });
        out.labs = labs.length; out.vitals = Object.keys(vitals).length;
      }
      var img = imagingRows(bundle);
      if (img.length && window.ICU && window.ICU.ingestWardImaging) { window.ICU.ingestWardImaging({ patientId: pid, source: "Connect EMR", imaging: img }); out.imaging = img.length; }
    } catch (e) {}
    return out;
  }
  function sendMedsToList(bundle) {
    var meds = (bundle && bundle.medications) || [], n = 0;
    meds.forEach(function (m) {
      var t = medText(m); if (!t) return;
      try { if (window.MEDLIST && window.MEDLIST.parseEntry && window.MEDLIST.add) { window.MEDLIST.add(window.MEDLIST.parseEntry(t), "connect"); n++; } } catch (e) {}
    });
    return n;
  }

  // ---- UI ----------------------------------------------------------------------------------------
  function close() { var o = document.getElementById("smdConnectPtOverlay"); if (o && o.parentNode) o.parentNode.removeChild(o); }
  function msg(k, t) { var m = document.getElementById("cptMsg"); if (m) { m.textContent = t || ""; m.style.color = k === "err" ? "#e5484d" : k === "warn" ? "#d9a441" : "var(--slate,#9bb0c2)"; } }

  function open(preTenant, prePatient, preConn, preName) {
    if (!flagOn()) { tt("Connect EMR is off."); return; }
    close();
    var ov = document.createElement("div"); ov.id = "smdConnectPtOverlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:var(--paper,#0b1016);color:var(--ink,#e8eef4);display:flex;flex-direction:column;font-family:var(--hfont,-apple-system,sans-serif)";
    ov.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;border-bottom:1px solid var(--line,#22303c)">' +
        '<b style="flex:1;font-size:15px">Connect patient</b>' +
        '<button id="cptClose" style="background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:8px;padding:7px 12px;font-weight:700">Close</button></div>' +
      '<div style="padding:14px;overflow:auto;flex:1">' +
        '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);margin-bottom:12px">Pull a patient from a hospital you connected, straight into the ICU dashboard.</div>' +
        '<label style="font-size:12px;font-weight:700">Hospital</label>' +
        '<select id="cptTenant" style="width:100%;margin:5px 0 12px;padding:9px;border-radius:9px;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c)"></select>' +
        '<label style="font-size:12px;font-weight:700">Find patient by name</label>' +
        '<div style="display:flex;gap:8px;margin:5px 0 8px;flex-wrap:wrap">' +
          '<input id="cptSearch" placeholder="Type a name" autocapitalize="words" spellcheck="false" style="flex:1;min-width:160px;padding:9px;border-radius:9px;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c)">' +
          '<button id="cptSearchBtn" style="background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:9px;padding:9px 16px;font-weight:700">Search</button></div>' +
        '<div id="cptResults" style="margin:2px 0 12px"></div>' +
        '<label style="font-size:12px;font-weight:700">Or enter a patient id directly</label>' +
        '<div style="display:flex;gap:8px;margin:5px 0 12px;flex-wrap:wrap">' +
          '<input id="cptRef" placeholder="e.g. patient id / MRN" autocapitalize="off" spellcheck="false" style="flex:1;min-width:160px;padding:9px;border-radius:9px;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c)">' +
          '<button id="cptPull" style="background:var(--teal,#0e6e63);color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:700">Pull</button></div>' +
        '<div id="cptMsg" style="font-size:12.5px;margin:6px 0"></div>' +
        '<div id="cptSummary"></div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById("cptClose").onclick = close;
    var sel = document.getElementById("cptTenant");
    sel.innerHTML = '<option value="">Loading your hospitals...</option>';
    (C() ? C().tenants() : Promise.resolve([])).then(function (ts) {
      if (!ts || !ts.length) { sel.innerHTML = '<option value="">No connected hospital</option>'; msg("warn", "You have not connected a hospital yet. Use Connect EMR first."); return; }
      sel.innerHTML = ts.map(function (t) { return '<option value="' + esc(t.tenantId) + '">' + esc(t.name || t.tenantId) + '</option>'; }).join("");
      var last = loadLast();   // P3: re-select the last-used hospital + patient so re-opening is instant
      if (last) { if (last.tenantId && ts.some(function (t) { return t.tenantId === last.tenantId; })) sel.value = last.tenantId; var rf = document.getElementById("cptRef"); if (rf && last.patientRef) rf.value = last.patientRef; }
      if (preTenant && ts.some(function (t) { return t.tenantId === preTenant; })) sel.value = preTenant;   // launched from Ward Sync with a chosen hospital
      if (prePatient) { var rf2 = document.getElementById("cptRef"); if (rf2) rf2.value = prePatient; doPull(preConn, preName); }   // Ward Sync roster tap: auto-pull this patient into ICU (via the roster's exact connection), carrying the roster's resolved name
    });
    document.getElementById("cptPull").onclick = doPull;
    document.getElementById("cptRef").addEventListener("keydown", function (e) { if (e.key === "Enter") doPull(); });
    document.getElementById("cptSearchBtn").onclick = doSearch;
    document.getElementById("cptSearch").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
  }

  function doSearch() {
    var tid = (document.getElementById("cptTenant") || {}).value, q = ((document.getElementById("cptSearch") || {}).value || "").trim();
    var box = document.getElementById("cptResults");
    if (!tid) { msg("err", "Pick a hospital."); return; }
    if (!q) { if (box) box.innerHTML = ""; return; }
    if (!C() || !C().searchPatients) { msg("err", "Search unavailable."); return; }
    if (box) box.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">Searching...</div>';
    C().searchPatients({ tenantId: tid, query: q }).then(function (r) {
      if (!box) return;
      if (!r || r.error) { box.innerHTML = '<div style="font-size:12.5px;color:#e5484d">Search failed: ' + esc((r && r.error) || "error") + '</div>'; return; }
      var ps = r.patients || [];
      if (!ps.length) { box.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">No matches.</div>'; return; }
      box.innerHTML = ps.slice(0, 25).map(function (p) {
        var sub = [p.gender, p.birthDate].filter(Boolean).join(" · ");
        return '<button class="cpt-hit" data-pid="' + esc(p.id) + '" style="display:block;width:100%;text-align:left;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c);border-radius:9px;padding:9px 11px;margin:4px 0;cursor:pointer">' +
          '<div style="font-weight:700;font-size:13.5px">' + esc(p.name || "(unnamed)") + '</div>' + (sub ? '<div style="font-size:11.5px;color:var(--slate,#9bb0c2)">' + esc(sub) + '</div>' : "") + '</button>';
      }).join("");
      [].slice.call(box.querySelectorAll(".cpt-hit")).forEach(function (btn) {
        btn.onclick = function () { var ref = document.getElementById("cptRef"); if (ref) ref.value = btn.getAttribute("data-pid"); doPull(); };
      });
    }).catch(function () { if (box) box.innerHTML = '<div style="font-size:12.5px;color:#e5484d">Search error.</div>'; });
  }

  function doPull(connId, preName) {
    connId = (typeof connId === "string") ? connId : "";   // onclick passes an Event; only a roster auto-pull passes the connectionId string
    var tid = (document.getElementById("cptTenant") || {}).value, ref = ((document.getElementById("cptRef") || {}).value || "").trim();
    if (!tid) { msg("err", "Pick a hospital."); return; }
    if (!ref) { msg("err", "Enter a patient reference."); return; }
    if (!C()) { msg("err", "Connect is unavailable."); return; }
    var btn = document.getElementById("cptPull"); if (btn) btn.disabled = true; msg("", "Pulling...");
    C().pullContext({ tenantId: tid, patientRef: ref, connectionId: connId || undefined }).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r || !r.ok) { msg("err", "Could not pull: " + ((r && r.error) || "failed")); return; }
      saveLast(tid, ref);
      var b = r.bundle || {};
      // Some FHIR servers carry no Patient.name (the name lives on Encounter.subject.display, which the roster
      // already resolved). Fall back to the roster's name so an admitted patient is never "Unknown".
      if (preName && (!b.patient || !b.patient.name)) { b.patient = b.patient || {}; b.patient.name = { text: preName }; }
      var icu = pushToICU(b);
      msg("ok", "Loaded into ICU: " + icu.labs + " lab value(s).");
      renderSummary(b, icu);
    }).catch(function () { if (btn) btn.disabled = false; msg("err", "Network error."); });
  }

  function renderSummary(b) {
    var demo = demographics(b);
    var conds = (b.conditions || []).map(function (c) { return c.code && c.code.text; }).filter(Boolean);
    var allg = (b.allergies || []).map(function (a) { return a.code && a.code.text; }).filter(Boolean);
    var meds = (b.medications || []).map(medText).filter(Boolean);
    var labs = labRows(b);
    function section(title, items) {
      return '<div style="margin-top:12px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--slate,#9bb0c2);font-weight:700">' + esc(title) + '</div>' +
        (items.length ? items.map(function (x) { return '<div style="padding:3px 0;font-size:13px">' + esc(x) + '</div>'; }).join("") : '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">None</div>') + '</div>';
    }
    var el = document.getElementById("cptSummary"); if (!el) return;
    el.innerHTML =
      '<div style="margin-top:8px;padding:12px;border:1px solid var(--line,#22303c);border-radius:12px">' +
        '<div style="font-size:16px;font-weight:800">' + esc(demo.name) + '</div>' +
        '<div style="font-size:12.5px;color:var(--slate,#9bb0c2)">' + esc([demo.sex, demo.age !== "" ? demo.age + "y" : "", demo.mrn ? "MRN " + demo.mrn : ""].filter(Boolean).join(" · ")) + '</div>' +
        section("Problems", conds) +
        section("Allergies", allg) +
        section("Medications (" + meds.length + ")", meds) +
        section("Labs loaded to ICU (" + labs.length + ")", labs.map(function (r) { return r.test + ": " + r.result + (r.units ? " " + r.units : ""); })) +
        '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
          '<button id="cptOpenIcu" style="background:var(--teal,#0e6e63);color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:700">Open ICU dashboard</button>' +
          (meds.length ? '<button id="cptSendMeds" style="background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:9px;padding:10px 16px;font-weight:700">Send ' + meds.length + ' meds to med list</button>' : "") +
        '</div></div>';
    var oi = document.getElementById("cptOpenIcu"); if (oi) oi.onclick = function () { close(); try { if (window.ICU && window.ICU.open) window.ICU.open(); } catch (e) {} };
    var sm = document.getElementById("cptSendMeds"); if (sm) sm.onclick = function () { var n = sendMedsToList(b); tt(n + " medication(s) sent to the med list."); sm.disabled = true; sm.textContent = "Sent " + n + " to med list"; };
  }

  // ---- Admit-from-connected-hospital: a BROWSABLE roster picker (pick hospital -> today's ward list ->
  // tap a patient -> the SAME pull that admits into ICU). Reuses SMD_CONNECT.connections/worklist + open().
  function closeRoster() { var o = document.getElementById("cptRosterOverlay"); if (o && o.parentNode) o.parentNode.removeChild(o); }
  function openRoster() {
    if (!flagOn()) { tt("Connect EMR is off."); return; }
    if (!C()) { tt("Connect is unavailable."); return; }
    closeRoster();
    var ov = document.createElement("div"); ov.id = "cptRosterOverlay";
    ov.style.cssText = "position:fixed;inset:0;z-index:100001;background:var(--paper,#0b1016);color:var(--ink,#e8eef4);display:flex;flex-direction:column;font-family:var(--hfont,-apple-system,sans-serif)";
    ov.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;border-bottom:1px solid var(--line,#22303c)">' +
        '<button id="cptrBack" style="background:transparent;color:var(--ink,#e8eef4);border:1px solid var(--line,#3a4a5a);border-radius:8px;padding:7px 12px;font-weight:700">Back</button>' +
        '<b style="flex:1;font-size:15px">Admit from a connected hospital</b></div>' +
      '<div style="padding:14px 14px 6px">' +
        '<label style="font-size:12px;font-weight:700">Hospital</label>' +
        '<select id="cptrTenant" style="width:100%;margin:5px 0 8px;padding:9px;border-radius:9px;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c)"></select>' +
        '<div id="cptrUnit" style="display:flex;align-items:center;margin:0 0 8px"></div>' +   // Adding to [ICU unit / ward ▾] -- destination, freely interchangeable
        '<div style="font-size:12px;color:var(--slate,#9bb0c2)">Tap <b>Add</b> to admit into the unit above (add several). Tap a name to open the full record.</div></div>' +
      '<div id="cptrList" style="padding:8px 14px 14px;overflow:auto;flex:1"></div>';
    document.body.appendChild(ov);
    document.getElementById("cptrBack").onclick = closeRoster;
    var sel = document.getElementById("cptrTenant"), list = document.getElementById("cptrList");
    renderUnitBar();
    sel.innerHTML = '<option value="">Loading your hospitals...</option>';
    C().tenants().then(function (ts) {
      // GHIS (GITAM/GIMSR) is a hospital like any other -- list it alongside the Connect-onboarded ones
      // whenever the doctor has a live GHIS session with a loaded ward list (its roster shape matches).
      var opts = [];
      if (ghisReady()) opts.push({ id: "__ghis__", name: "GIMSR · GHIS" });
      (ts || []).forEach(function (t) { opts.push({ id: t.tenantId, name: t.name || t.tenantId }); });
      if (!opts.length) { sel.innerHTML = '<option value="">No connected hospital</option>'; list.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);padding:8px 0">Connect a hospital (Connect EMR), or sign in to GHIS from Ward Sync, first.</div>'; return; }
      sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>'; }).join("");
      sel.onchange = function () { loadRoster(sel.value); };
      loadRoster(sel.value);
    });
    // "Adding to [unit ▾]" -- the destination ICU unit OR ward, freely switchable (reuses the dashboard's own
    // unit registry, so ICU units and wards are interchangeable here). Mirrors the GHIS ward "Adding to" bar.
    function renderUnitBar() {
      var bar = document.getElementById("cptrUnit"); if (!bar) return;   // overlay closed -> stale callback no-ops
      if (!(window.ICU && ICU.unitList)) { bar.style.display = "none"; return; }
      var units = []; try { units = (ICU.ensureUnits ? ICU.ensureUnits(renderUnitBar) : ICU.unitList()) || []; } catch (e) {}
      bar.style.display = "flex"; bar.style.alignItems = "center";
      if (!units.length) {
        bar.innerHTML = '<span style="font-size:12px;font-weight:700;color:var(--slate,#9bb0c2)">Adding to the dashboard</span>' +
          '<button id="cptrSetup" style="margin-left:auto;background:none;border:none;color:var(--teal,#0e6e63);font-weight:700;font-size:12px;cursor:pointer">Set up a unit ›</button>';
        var su = document.getElementById("cptrSetup"); if (su) su.onclick = function () { closeRoster(); try { if (window.ICU && ICU.openUnits) ICU.openUnits(); } catch (e) {} };
        return;
      }
      var opts = units.map(function (u) { return '<option value="' + esc(u.key) + '"' + (u.active ? " selected" : "") + '>' + esc(u.label) + '</option>'; }).join("");
      bar.innerHTML = '<span style="font-size:12px;font-weight:700;color:var(--slate,#9bb0c2);flex:0 0 auto">Adding to</span>' +
        '<select id="cptrUnitSel" style="flex:1;min-width:0;margin-left:8px;padding:8px;border-radius:8px;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c);font-weight:600;font-size:13px">' + opts + '</select>';
      var us = document.getElementById("cptrUnitSel");
      if (us) us.onchange = function () { try { if (window.ICU && ICU.selectUnitByKey) ICU.selectUnitByKey(us.value); } catch (e) {} renderUnitBar(); };
    }
    var added = {};   // patientId -> true, this session (multi-add "Added" state)
    // ctx.add(row) admits into the selected unit WITHOUT navigating (multi-add) -> Promise<bool>;
    // ctx.view(row) closes the picker and opens the full record. Both routed per source.
    function renderRows(rows, ctx) {
      if (!rows || !rows.length) { list.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);padding:8px 0">No patients on today’s ward list.</div>'; return; }
      list.innerHTML = rows.map(function (p, i) {
        var sub = [p.bedName ? "Bed " + p.bedName : "", p.deptDescription, p.employeeFirstName].filter(Boolean).join(" · ");
        var dem = [p.gender, p.dob].filter(Boolean).join(" · "), on = !!added[p.patientId];
        return '<div style="display:flex;align-items:center;gap:10px;background:var(--panel,#111820);border:1px solid var(--line,#22303c);border-radius:11px;padding:10px 12px;margin:6px 0">' +
          '<button class="cptr-add" data-i="' + i + '" style="flex:0 0 auto;background:' + (on ? "transparent" : "var(--teal,#0e6e63)") + ';color:' + (on ? "var(--teal,#0e6e63)" : "#fff") + ';border:' + (on ? "1px solid var(--teal,#0e6e63)" : "0") + ';border-radius:9px;padding:9px 15px;font-weight:800;font-size:13px;cursor:pointer">' + (on ? "Added" : "Add") + '</button>' +
          '<button class="cptr-view" data-i="' + i + '" style="flex:1;min-width:0;text-align:left;background:transparent;border:0;color:var(--ink,#e8eef4);padding:0;cursor:pointer">' +
            '<div style="font-weight:700;font-size:14px">' + esc(p.patientFirstName || "(unnamed)") + '</div>' +
            (sub ? '<div style="font-size:12px;color:var(--teal,#4ec9b8);margin-top:2px">' + esc(sub) + '</div>' : "") +
            (dem ? '<div style="font-size:11.5px;color:var(--slate,#9bb0c2);margin-top:1px">' + esc(dem) + '</div>' : "") + '</button>' +
          '</div>';
      }).join("");
      [].slice.call(list.querySelectorAll(".cptr-view")).forEach(function (b) {
        b.onclick = function () { var p = rows[+b.getAttribute("data-i")]; if (!p) return; closeRoster(); ctx.view(p); };
      });
      [].slice.call(list.querySelectorAll(".cptr-add")).forEach(function (b) {
        b.onclick = function () {
          var p = rows[+b.getAttribute("data-i")]; if (!p || added[p.patientId]) return;
          b.disabled = true; b.textContent = "Adding...";
          Promise.resolve(ctx.add(p)).then(function (ok) {
            b.disabled = false;
            if (ok) { added[p.patientId] = true; b.textContent = "Added"; b.style.background = "transparent"; b.style.color = "var(--teal,#0e6e63)"; b.style.border = "1px solid var(--teal,#0e6e63)"; }
            else { b.textContent = "Add"; }
          });
        };
      });
    }
    // Admit a Connect (FHIR) patient into the CURRENT unit without navigating: pull -> addWardPatientToRoster.
    function addConnect(tenantId, connectionId, p) {
      return C().pullContext({ tenantId: tenantId, patientRef: p.patientId, connectionId: connectionId }).then(function (r) {
        if (!r || !r.ok) { tt("Could not pull " + (p.patientFirstName || "patient") + "."); return false; }
        var b = r.bundle || {};
        if (p.patientFirstName && (!b.patient || !b.patient.name)) { b.patient = b.patient || {}; b.patient.name = { text: p.patientFirstName }; }
        var dem = demographics(b); if (p.bedName) dem.bed = p.bedName;
        if (!(window.ICU && ICU.addWardPatientToRoster)) { tt("Open the ICU dashboard and pick a unit first."); return false; }
        return Promise.resolve(ICU.addWardPatientToRoster({ patient: dem, patientId: p.patientId, source: "Connect EMR", labs: labRows(b) })).then(function () {
          tt("Added " + (dem.name || "patient") + " to " + (ICU.currentUnitLabel ? ICU.currentUnitLabel() : "the dashboard")); return true;
        }, function () { tt("Couldn’t add — open the dashboard and choose a unit first."); return false; });
      });
    }
    function loadRoster(id) {
      if (!id) { list.innerHTML = ""; return; }
      list.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);padding:8px 0">Loading ward list...</div>';
      if (id === "__ghis__") {   // GHIS: reuse its already-loaded roster + its own no-navigate add / full open
        renderRows(window.GHIS.getPatients(), {
          add: function (p) { try { window.GHIS.addToDashboard(p.episodeId, p.patientId, p.patientFirstName); } catch (e) {} return true; },
          view: function (p) { try { window.GHIS.loadIntoICU(p.patientId); } catch (e) {} },
        });
        return;
      }
      C().connections(id).then(function (cons) {
        var fhir = (cons || []).filter(function (c) { return c && c.connectionId; })[0];
        if (!fhir) { list.innerHTML = '<div style="font-size:12.5px;color:var(--slate,#9bb0c2);padding:8px 0">No FHIR connection on this hospital yet.</div>'; return; }
        return C().worklist({ tenantId: id, connectionId: fhir.connectionId }).then(function (r) {
          if (!r || r.error) { list.innerHTML = '<div style="font-size:12.5px;color:#e5484d;padding:8px 0">Could not load the ward list: ' + esc((r && r.error) || "error") + '</div>'; return; }
          renderRows(r.rows || [], {
            add: function (p) { return addConnect(id, fhir.connectionId, p); },
            view: function (p) { open(id, p.patientId, fhir.connectionId, p.patientFirstName); },
          });
        });
      }).catch(function () { list.innerHTML = '<div style="font-size:12.5px;color:#e5484d;padding:8px 0">Network error loading the ward list.</div>'; });
    }
  }
  // True when GHIS has a live session with a loaded ward list (so it can be listed + admitted like any hospital).
  function ghisReady() { try { return !!(window.GHIS && GHIS.isConnected && GHIS.isConnected() && GHIS.getPatients && GHIS.getPatients().length); } catch (e) { return false; } }

  // Called by the ICU Admit action. If the doctor has connected hospitals, offer a choice; otherwise fall
  // straight through to onBlank() so the default admit flow is unchanged for everyone else.
  function openAdmitChooser(onBlank) {
    var blank = (typeof onBlank === "function") ? onBlank : function () {};
    if (!flagOn() || !C()) { blank(); return; }
    C().tenants().then(function (ts) {
      if ((!ts || !ts.length) && !ghisReady()) { blank(); return; }   // no connected hospital AND no GHIS -> identical to today's behavior
      var ov = document.createElement("div"); ov.id = "cptAdmitChooser";
      ov.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(3,7,12,.55);display:flex;align-items:flex-end;font-family:var(--hfont,-apple-system,sans-serif)";
      ov.innerHTML =
        '<div style="width:100%;background:var(--paper,#0b1016);color:var(--ink,#e8eef4);border-top-left-radius:18px;border-top-right-radius:18px;border-top:1px solid var(--line,#22303c);padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 16px)">' +
          '<div style="font-size:15px;font-weight:800;margin-bottom:12px">Admit a patient</div>' +
          '<button id="cptAcBlank" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--panel,#111820);color:var(--ink,#e8eef4);border:1px solid var(--line,#22303c);border-radius:12px;padding:13px 14px;margin-bottom:8px;font-weight:700;font-size:14px">Blank patient</button>' +
          '<button id="cptAcConnect" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--teal,#0e6e63);color:#fff;border:0;border-radius:12px;padding:13px 14px;font-weight:700;font-size:14px">From a connected hospital</button>' +
          '<button id="cptAcCancel" style="width:100%;background:transparent;color:var(--slate,#9bb0c2);border:0;padding:12px;margin-top:6px;font-weight:700">Cancel</button></div>';
      document.body.appendChild(ov);
      function shut() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      ov.addEventListener("click", function (e) { if (e.target === ov) shut(); });
      document.getElementById("cptAcBlank").onclick = function () { shut(); blank(); };
      document.getElementById("cptAcConnect").onclick = function () { shut(); openRoster(); };
      document.getElementById("cptAcCancel").onclick = shut;
    }).catch(function () { blank(); });
  }

  window.CONNECTPT = {
    open: open, on: flagOn, openRoster: openRoster, openAdmitChooser: openAdmitChooser,
    _demographics: demographics, _labRows: labRows, _age: ageFromDob, _medText: medText,
    _pushToICU: pushToICU, _sendMeds: sendMedsToList,
  };
})();
