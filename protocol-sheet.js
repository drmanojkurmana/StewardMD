/* StewardMD - Chemotherapy Protocol Sheet (mobile view + print-to-PDF + EMR assign).
 * Renders a formal, printable "Treatment Protocol" sheet from a protocol JSON + patient, with per-drug
 * doses computed by the existing dose engine (SMD_ONCODOSE), a per-cycle day-schedule grid, dose-verify
 * checkboxes, and a signature pad. Decision support / DRAFT: the physician verifies; nothing is an order.
 * window.SMD_PROTOSHEET. Buildless ES5 IIFE. PDF = native browser print (Save as PDF).
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined">' + n + "</span>"; }
  function asArr(v) { return v == null ? [] : (v instanceof Array ? v : [v]); }
  function DOSE() { return G.SMD_ONCODOSE; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  var st = {
    protocol: null, patient: null, verify: {}, sig: null, editing: false, ctx: null, onAssign: null
  };

  // ---- dose computation via the existing engine -------------------------------------------------
  function bsa() {
    var p = st.patient || {}, h = num(p.heightCm), w = num(p.weightKg);
    if (p.bsa) return p.bsa;
    if (DOSE() && h && w) return DOSE().bsaMosteller(h, w);
    return null;
  }
  function doseLine(drug) {
    var p = st.patient || {};
    if (!DOSE()) return null;
    try {
      return DOSE().doseForDrug(drug, { height: num(p.heightCm), weight: num(p.weightKg), bsa: bsa(), sex: p.sex, age: num(p.age) });
    } catch (e) { return null; }
  }
  // per-drug: mg/m2 (or per-unit), computed total mg, route, per-cycle day markers
  function drugRow(drug) {
    var line = doseLine(drug);
    var perUnit = drug.dosePerUnit != null ? drug.dosePerUnit + " " + (drug.unit || "") : "verify";
    var total = line && line.final != null ? line.final : null;
    var unitBase = (drug.unit || "").replace("/m2", "").replace("/kg", "") || "mg";
    return {
      id: drug.id, name: drug.name || drug.id, perUnit: perUnit, route: drug.route || "",
      basis: drug.basis, total: total, totalTxt: total != null ? (round2(total) + " " + unitBase) : (drug.basis === "bsa" || drug.basis === "auc" ? "enter ht/wt" : perUnit),
      days: asArr(drug.days), notes: drug.notes || "", warn: line ? asArr(line.warnings) : [], capApplied: line && line.capApplied,
      cycleSchedule: drug.cycleSchedule || null
    };
  }
  // day markers for a given cycle number (1-based). Supports optional per-cycle override.
  function cycleCell(row, cyc) {
    if (row.cycleSchedule) {
      var v = row.cycleSchedule[cyc];
      if (v === "X" || v == null) return "X";
      return "D" + asArr(v).join(", D");
    }
    return row.days.length ? ("D" + row.days.join(", D")) : "-";
  }

  // ---- patient header ---------------------------------------------------------------------------
  function field(label, key, val, type) {
    if (st.editing) return '<label class="ps-f"><span>' + esc(label) + '</span><input data-ps-field="' + key + '" type="' + (type || "text") + '" value="' + esc(val == null ? "" : val) + '"></label>';
    return '<div class="ps-f"><span>' + esc(label) + "</span><b>" + esc(val == null || val === "" ? "-" : val) + "</b></div>";
  }
  function headerHtml() {
    var p = st.patient || {}, pr = st.protocol || {};
    var b = bsa();
    var inst = (st.ctx && st.ctx.institution) || { name: "StewardMD", dept: "Department of Medical Oncology", line: "Clinician decision-support (DRAFT protocol)" };
    return '<div class="ps-inst"><div class="ps-inst-name">' + esc(inst.name) + "</div>" +
        '<div class="ps-inst-dept">' + esc(inst.dept) + "</div>" +
        (inst.line ? '<div class="ps-inst-line">' + esc(inst.line) + "</div>" : "") + "</div>" +
      '<div class="ps-title">Treatment Protocol</div>' +
      '<div class="ps-hgrid">' +
        field("Case No", "caseNo", p.caseNo) +
        field("Name", "name", p.name) +
        field("Age", "age", p.age, "number") +
        field("Sex", "sex", p.sex) +
        field("Plan No", "planNo", p.planNo) +
        field("Height (cm)", "heightCm", p.heightCm, "number") +
        field("Weight (kg)", "weightKg", p.weightKg, "number") +
        '<div class="ps-f"><span>BSA (m2)</span><b>' + (b ? (Math.round(b * 100) / 100) : "-") + "</b></div>" +
        '<div class="ps-f"><span>Protocol</span><b>' + esc(pr.name || "-") + "</b></div>" +
        '<div class="ps-f"><span>No. of Cycles</span><b>' + esc(pr.cycles || "-") + "</b></div>" +
        '<div class="ps-f"><span>Cycle length</span><b>' + (pr.cycleLengthDays ? pr.cycleLengthDays + " days" : "-") + "</b></div>" +
        field("Diagnosis", "diagnosis", p.diagnosis) +
        field("Intent", "intent", p.intent || (asArr(pr.intentOptions)[0] || "")) +
        '<div class="ps-f"><span>Date</span><b>' + esc((st.ctx && st.ctx.today) || "") + "</b></div>" +
      "</div>";
  }

  // ---- drug schedule table ----------------------------------------------------------------------
  function tableHtml() {
    var pr = st.protocol || {};
    var cycles = Math.max(1, Math.min(8, num(pr.cycles) || 1));
    var rows = asArr(pr.drugs).map(drugRow);
    var cycHead = "";
    for (var c = 1; c <= cycles; c++) cycHead += "<th>Cycle " + c + "</th>";
    var body = rows.map(function (r) {
      var cells = "";
      for (var c = 1; c <= cycles; c++) { var v = cycleCell(r, c); cells += '<td class="ps-cyc' + (v === "X" ? " x" : "") + '">' + esc(v) + "</td>"; }
      var vk = st.verify[r.id];
      return '<tr>' +
        '<td class="ps-dname">' + esc(r.name) + (r.capApplied ? ' <span class="ps-cap" title="dose cap applied">cap</span>' : "") + "</td>" +
        '<td class="ps-ddesc"><b>' + esc(r.totalTxt) + '</b> <span class="ps-permetre">' + esc(r.perUnit) + (r.route ? " " + esc(r.route) : "") + "</span></td>" +
        cells +
        '<td class="ps-verify"><label class="ps-chk"><input type="checkbox" data-ps-verify="' + esc(r.id) + '"' + (vk ? " checked" : "") + '><span class="ps-chk-box">' + ms("check") + "</span></label></td>" +
        "</tr>";
    }).join("");
    return '<div class="ps-legend">D = day of cycle &middot; X = not scheduled that cycle &middot; total dose computed from BSA (Mosteller)</div>' +
      '<div class="ps-tablewrap"><table class="ps-table"><thead><tr>' +
        "<th>Drug</th><th>Dose / route</th>" + cycHead + '<th class="ps-vh">Verified</th>' +
      "</tr></thead><tbody>" + (body || '<tr><td colspan="' + (cycles + 3) + '">No drugs in this protocol.</td></tr>') + "</tbody></table></div>";
  }

  function listBlock(title, items) {
    items = asArr(items).filter(Boolean);
    if (!items.length) return "";
    return '<div class="ps-block"><div class="ps-block-h">' + esc(title) + "</div><ul>" +
      items.map(function (i) { return "<li>" + esc(typeof i === "object" ? (i.name || i.notes || JSON.stringify(i)) : i) + "</li>"; }).join("") + "</ul></div>";
  }

  function warningsHtml() {
    var pr = st.protocol || {}, b = bsa();
    var w = [];
    if (!b) w.push("Enter height and weight to compute per-drug total doses.");
    asArr(pr.drugs).map(drugRow).forEach(function (r) { r.warn.forEach(function (x) { w.push(r.name + ": " + x); }); });
    if (!w.length) return "";
    return '<div class="ps-warns">' + ms("info") + "<div>" + w.map(esc).join("<br>") + "</div></div>";
  }

  function sigHtml() {
    var p = st.patient || {};
    return '<div class="ps-sig-row">' +
      '<div class="ps-sig-pad"><canvas id="psSig" width="600" height="150"></canvas>' +
        '<div class="ps-sig-actions"><button class="ps-linkbtn" data-ps-act="sig-clear">' + ms("ink_eraser") + "Clear signature</button></div>" +
        '<div class="ps-sig-label">Consultant signature - dose verified</div></div>' +
      '<div class="ps-sig-meta">' +
        (st.editing ? '<label class="ps-f"><span>Consultant</span><input data-ps-field="consultant" value="' + esc(p.consultant || "") + '"></label>' : '<div class="ps-f"><span>Consultant</span><b>' + esc(p.consultant || "-") + "</b></div>") +
        '<div class="ps-f"><span>Date</span><b>' + esc((st.ctx && st.ctx.today) || "") + "</b></div>" +
      "</div></div>";
  }

  function sheetHtml() {
    var pr = st.protocol || {};
    return '<div class="ps-sheet" id="psSheet">' +
      headerHtml() +
      warningsHtml() +
      tableHtml() +
      listBlock("Premedications", asArr(pr.premedications)) +
      listBlock("Supportive care", asArr(pr.supportiveCare)) +
      listBlock("Monitoring", asArr(pr.monitoring)) +
      (pr.specialInstructions ? '<div class="ps-block"><div class="ps-block-h">Special instructions</div><p>' + esc(pr.specialInstructions) + "</p></div>" : "") +
      sigHtml() +
      '<div class="ps-foot">DRAFT decision support - not an approved clinical order. Verify every dose against your institutional protocol before administration. Generated by StewardMD OncoTree.</div>' +
      "</div>";
  }

  function shellHtml() {
    var pr = st.protocol;
    if (!pr) return '<div class="ps-loading">' + ms("progress_activity") + "Loading protocol...</div>";
    return '<div class="ps-wrap">' +
      '<header class="ps-header">' +
        '<button class="ps-hbtn" data-ps-act="close" aria-label="Back">' + ms("arrow_back") + "</button>" +
        '<div class="ps-htitle"><span class="ps-hkicker">Protocol sheet</span><span class="ps-hname">' + esc(pr.name || "") + "</span></div>" +
        '<button class="ps-hbtn" data-ps-act="edit" aria-label="Edit patient">' + ms(st.editing ? "check" : "edit") + "</button>" +
      "</header>" +
      '<div class="ps-scroll">' + sheetHtml() + "</div>" +
      '<div class="ps-actionbar">' +
        '<button class="ps-btn ghost" data-ps-act="print">' + ms("print") + "Print / PDF</button>" +
        '<button class="ps-btn primary" data-ps-act="assign">' + ms("assignment_turned_in") + "Assign to patient</button>" +
      "</div></div>";
  }

  // ---- signature pad (canvas, pointer/touch) ----------------------------------------------------
  function wireSig() {
    var c = D && D.getElementById("psSig"); if (!c) return;
    var ctx = c.getContext("2d");
    // restore
    if (st.sig) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0); }; img.src = st.sig; }
    ctx.strokeStyle = "#14202b"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    var drawing = false, last = null;
    function pos(e) {
      var r = c.getBoundingClientRect(), t = e.touches && e.touches[0];
      var x = (t ? t.clientX : e.clientX) - r.left, y = (t ? t.clientY : e.clientY) - r.top;
      return { x: x * (c.width / r.width), y: y * (c.height / r.height) };
    }
    function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
    function move(e) { if (!drawing) return; var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; e.preventDefault(); }
    function end() { if (drawing) { drawing = false; try { st.sig = c.toDataURL("image/png"); } catch (e) {} } }
    c.addEventListener("mousedown", start); c.addEventListener("mousemove", move); D.addEventListener("mouseup", end);
    c.addEventListener("touchstart", start, { passive: false }); c.addEventListener("touchmove", move, { passive: false }); c.addEventListener("touchend", end);
  }

  function paint() {
    var el = D && D.getElementById("smdProtoSheet"); if (!el) return;
    el.innerHTML = shellHtml();
    wireSig();
  }

  // ---- events -----------------------------------------------------------------------------------
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-ps-act]") : null;
    if (t) {
      var act = t.getAttribute("data-ps-act");
      if (act === "close") return close();
      if (act === "edit") { commitEdits(); st.editing = !st.editing; paint(); return; }
      if (act === "print") return doPrint();
      if (act === "assign") return doAssign();
      if (act === "sig-clear") { st.sig = null; var c = D.getElementById("psSig"); if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); return; }
    }
    var vb = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-verify");
    if (vb) { st.verify[vb] = e.target.checked; return; }
  }
  function commitEdits() {
    if (!D) return;
    var inputs = D.querySelectorAll("[data-ps-field]");
    st.patient = st.patient || {};
    for (var i = 0; i < inputs.length; i++) { var k = inputs[i].getAttribute("data-ps-field"); st.patient[k] = inputs[i].value; }
  }
  function onInput(e) {
    var f = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-field");
    if (!f) return;
    st.patient = st.patient || {}; st.patient[f] = e.target.value;
    // live-recompute doses when the anthropometrics change
    if (f === "heightCm" || f === "weightKg") {
      var scroll = D.querySelector(".ps-scroll"); if (scroll) { var y = scroll.scrollTop; scroll.innerHTML = sheetHtml(); wireSig(); scroll.scrollTop = y; }
    }
  }

  function doPrint() { commitEdits(); try { G.print(); } catch (e) {} }

  function doAssign() {
    commitEdits();
    var pr = st.protocol || {};
    var payload = {
      protocolId: pr.id, protocolName: pr.name, protocolVersion: pr.version || null,
      patient: st.patient, bsa: bsa(),
      doses: asArr(pr.drugs).map(function (d) { var r = drugRow(d); return { id: r.id, name: r.name, perUnit: r.perUnit, total: r.total, route: r.route, days: r.days }; }),
      verified: st.verify, signature: st.sig, signedAt: (st.ctx && st.ctx.today) || null
    };
    try { if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-protocol-assign", { detail: payload })); } catch (e) {}
    if (typeof st.onAssign === "function") { try { st.onAssign(payload); } catch (e2) {} }
    try { if (G.toast) G.toast("Protocol assigned to the patient's oncology plan (draft; verify doses)."); } catch (e3) {}
    close();
  }

  // ---- open / close -----------------------------------------------------------------------------
  function ensureEl() {
    var el = D.getElementById("smdProtoSheet");
    if (!el) {
      el = D.createElement("div"); el.id = "smdProtoSheet"; el.className = "ps-overlay";
      D.body.appendChild(el);
      el.addEventListener("click", onClick);
      el.addEventListener("input", onInput);
    }
    return el;
  }
  function start(protocol, patient, opts) {
    opts = opts || {};
    st.protocol = protocol; st.patient = patient ? JSON.parse(JSON.stringify(patient)) : {};
    st.verify = {}; st.sig = null; st.editing = !(patient && patient.heightCm && patient.weightKg && patient.name);
    st.ctx = opts; st.onAssign = opts.onAssign || null;
    var el = ensureEl(); el.style.display = "block"; if (D.body) D.body.classList.add("ps-open");
    paint();
  }
  function open(protocolOrId, patient, opts) {
    if (!D) return;
    if (protocolOrId && typeof protocolOrId === "object") return start(protocolOrId, patient, opts);
    if (!G.fetch) return;
    G.fetch("/kb/protocols/" + encodeURIComponent(protocolOrId) + ".json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) start(p, patient, opts); else if (G.toast) G.toast("Protocol not found: " + protocolOrId); })
      .catch(function () { if (G.toast) G.toast("Could not load protocol."); });
  }
  function close() { var el = D && D.getElementById("smdProtoSheet"); if (el) el.style.display = "none"; if (D && D.body) D.body.classList.remove("ps-open"); }

  var API = { open: open, close: close, _st: st, _drugRow: drugRow, _version: "1.0" };
  if (root) root.SMD_PROTOSHEET = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
