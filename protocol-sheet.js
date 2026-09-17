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
  function ms(n) { return '<span class="material-symbols-rounded" aria-hidden="true">' + n + "</span>"; }
  function asArr(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
  function DOSE() { return G.SMD_ONCODOSE; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  var st = {
    protocol: null, patient: null, verify: {}, sig: null, editing: false, ctx: null, onAssign: null
  };

  // ---- dose computation via the existing engine -------------------------------------------------
  function bsa() {
    var p = st.patient || {}, h = num(p.heightCm), w = num(p.weightKg);
    if (p.bsa) return num(p.bsa);
    if (DOSE() && h && w) return DOSE().bsaMosteller(h, w);
    return null;
  }
  function crcl() {
    var p = st.patient || {}, a = num(p.age), w = num(p.weightKg), scr = num(p.creatinine);
    if (p.crcl) return num(p.crcl);
    if (!DOSE() || !a || !w || !scr) return null;
    return DOSE().gfrCockcroft({ age: a, wKg: w, scr: scr, sex: p.sex });
  }
  function doseLine(drug) {
    var p = st.patient || {};
    if (!DOSE()) return null;
    try {
      return DOSE().doseForDrug(drug, {
        height: num(p.heightCm),
        weight: num(p.weightKg),
        bsa: bsa(),
        sex: p.sex,
        age: num(p.age),
        creatinine: num(p.creatinine)
      });
    } catch (e) { return null; }
  }
  // per-drug: mg/m2 (or per-unit), computed total mg, route, per-cycle day markers
  function drugRow(drug) {
    var line = doseLine(drug);
    var perUnit = drug.dosePerUnit != null ? drug.dosePerUnit + " " + (drug.unit || "") : "verify";
    var total = line && line.final != null ? line.final : null;
    // Calvert (AUC) returns mg, so never label an AUC total as "AUC".
    var unitBase = drug.basis === "auc" ? "mg" : ((drug.unit || "").replace("/m2", "").replace("/kg", "") || "mg");
    // BID/TID: the engine keeps `final` per-administration and computes dailyDose; surface both so a
    // twice-daily oral drug is never read as once-daily / at a single administration's mg.
    var perDay = line && line.dosesPerDay > 1 ? line.dosesPerDay : 1;
    var daily = (total != null && perDay > 1 && line.dailyDose != null) ? line.dailyDose : null;
    var miss = drug.basis === "auc" ? "enter creatinine + age + sex" : (drug.basis === "bsa" || drug.basis === "mgkg" ? "enter ht/wt" : perUnit);
    return {
      id: drug.id, name: drug.name || drug.id, perUnit: perUnit, route: drug.route || "", basis: drug.basis,
      total: total, totalTxt: total != null ? (round2(total) + " " + unitBase) : miss,
      dailyTxt: daily != null ? (round2(daily) + " " + unitBase + "/day") : null,
      frequency: drug.frequency || "", days: asArr(drug.days), notes: drug.notes || "",
      warn: line ? asArr(line.warnings) : [], capApplied: line && line.capApplied,
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

  // ---- WardSync EMR integration -----------------------------------------------------------------
  function fetchWardSync() {
    var wsq = null;
    try {
      if (G.SMD_ONCO_ORGAN_DOSE && G.SMD_ONCO_ORGAN_DOSE.fetchWardSyncPatientLabs) {
        wsq = G.SMD_ONCO_ORGAN_DOSE.fetchWardSyncPatientLabs(G);
      }
    } catch (e) {}
    if (wsq && (wsq.patient || (wsq.vitals && (wsq.vitals.weightKg || wsq.vitals.heightCm)))) {
      st.patient = st.patient || {};
      if (wsq.patient) {
        if (wsq.patient.name) st.patient.name = wsq.patient.name;
        if (wsq.patient.id) st.patient.caseNo = wsq.patient.id;
      }
      if (wsq.vitals) {
        if (wsq.vitals.age != null) st.patient.age = wsq.vitals.age;
        if (wsq.vitals.sex) st.patient.sex = wsq.vitals.sex;
        if (wsq.vitals.heightCm != null) st.patient.heightCm = wsq.vitals.heightCm;
        if (wsq.vitals.weightKg != null) st.patient.weightKg = wsq.vitals.weightKg;
      }
      if (wsq.labs && wsq.labs.serumCreatinine != null) {
        st.patient.creatinine = wsq.labs.serumCreatinine;
      }
      if (G.toast) G.toast("Fetched patient vitals & labs from WardSync EMR.");
      paint();
    } else {
      if (G.toast) G.toast("No active WardSync patient in EMR. Enter vitals manually.");
    }
  }

  // ---- patient header ---------------------------------------------------------------------------
  function field(label, key, val, type, placeholder, isExport) {
    if (st.editing && !isExport) {
      var stepAttr = (key === "creatinine") ? ' step="0.01"' : ((key === "heightCm" || key === "weightKg") ? ' step="0.1"' : '');
      var minAttr = (type === "number") ? ' min="0"' : '';
      return '<label class="ps-f"><span>' + esc(label) + '</span><input data-ps-field="' + key + '" type="' + (type || "text") + '"' + stepAttr + minAttr + ' placeholder="' + esc(placeholder || "") + '" value="' + esc(val == null ? "" : val) + '"></label>';
    }
    return '<div class="ps-f"><span>' + esc(label) + "</span><b>" + esc(val == null || val === "" ? "-" : val) + "</b></div>";
  }

  function sexField(val, isExport) {
    var s = String(val || "").toLowerCase();
    var isF = s.indexOf("f") === 0;
    var isM = s.indexOf("m") === 0;
    var display = isF ? "Female" : (isM ? "Male" : (val || "-"));
    if (st.editing && !isExport) {
      return '<label class="ps-f"><span>Sex</span><select data-ps-field="sex" class="ps-select-field">' +
        '<option value="">Select sex</option>' +
        '<option value="female"' + (isF ? ' selected' : '') + '>Female</option>' +
        '<option value="male"' + (isM ? ' selected' : '') + '>Male</option>' +
        '</select></label>';
    }
    return '<div class="ps-f"><span>Sex</span><b>' + esc(display) + '</b></div>';
  }

  // Color-coded renal staging for the auto CrCl badge (same cutoffs as the bedside calculator).
  function renalStage(c) {
    if (c == null) return null;
    if (c >= 90) return { label: "Normal", cls: "ps-renal-ok" };
    if (c >= 60) return { label: "Mild impairment", cls: "ps-renal-mild" };
    if (c >= 30) return { label: "Moderate impairment", cls: "ps-renal-mod" };
    if (c >= 15) return { label: "Severe impairment", cls: "ps-renal-sev" };
    return { label: "Kidney failure", cls: "ps-renal-fail" };
  }

  function consultantField(val, isExport) {
    if (st.editing && !isExport) {
      return '<label class="ps-f"><span>Consultant</span><input data-ps-field="consultant" type="text" placeholder="Treating oncologist" value="' + esc(val == null ? "" : val) + '"></label>';
    }
    return '<div class="ps-f"><span>Consultant</span><b>' + esc(val == null || val === "" ? "-" : val) + "</b></div>";
  }

  function headerHtml(isExport) {
    var p = st.patient || {}, pr = st.protocol || {};
    var b = bsa();
    var c = crcl();
    var rs = renalStage(c);
    var inst = (st.ctx && st.ctx.institution) || { name: "StewardMD Oncology Clinical Care", dept: "Department of Medical Oncology & Clinical Hematology", line: "Chemotherapy Treatment Protocol & Order Verification Sheet" };
    var bsaDisp = b ? ('<span class="ps-calc-val">' + round2(b) + ' m²</span><span class="ps-calc-tag">Mosteller</span>') : '<span class="ps-calc-missing">Auto (enter Ht &amp; Wt)</span>';
    var crclDisp = c ? ('<span class="ps-calc-val">' + round2(c) + ' mL/min</span><span class="ps-calc-tag">Cockcroft-Gault</span>' + (rs ? ' <span class="ps-renalbadge ' + rs.cls + '">' + esc(rs.label) + "</span>" : "")) : '<span class="ps-calc-missing">Auto (enter Age, Wt, SCr, Sex)</span>';

    var emrBar = (st.editing && !isExport) ? (
      '<div class="ps-emr-bar">' +
        '<span class="ps-emr-hint">' + ms("tune") + ' <span>Doctor input mode: edit patient vitals to auto-calculate BSA &amp; Calvert CrCl live.</span></span>' +
        '<button type="button" class="ps-wardsync-btn" data-ps-act="wardsync-fetch" title="Fetch labs and vitals from WardSync EMR">' + ms("sync") + ' <span>Fetch from WardSync EMR</span></button>' +
      '</div>'
    ) : "";

    // Full-width regimen banner: protocol identity at a glance (name + plan meta chips).
    var intent = p.intent || (asArr(pr.intentOptions)[0] || "");
    var stage = asArr(pr.stage).join(", ");
    var chips = [];
    if (pr.cycles) chips.push('<span class="ps-regimen-chip">' + esc(pr.cycles) + " planned cycles</span>");
    if (pr.cycleLengthDays) chips.push('<span class="ps-regimen-chip">Every ' + esc(pr.cycleLengthDays) + " days</span>");
    if (intent) chips.push('<span class="ps-regimen-chip">' + esc(intent) + "</span>");
    if (stage) chips.push('<span class="ps-regimen-chip">Stage ' + esc(stage) + "</span>");
    var banner =
      '<div class="ps-regimenbanner">' +
        '<div class="ps-regimen-kicker">Regimen</div>' +
        '<div class="ps-regimen-name">' + esc(pr.name || "Treatment Protocol") + ((pr.custom || pr.lifecycleState === "custom") ? ' <span class="ps-custombadge">CUSTOM / DRAFT</span>' : "") + "</div>" +
        (chips.length ? '<div class="ps-regimen-meta">' + chips.join("") + "</div>" : "") +
      "</div>";

    return '<div class="ps-inst">' +
        '<div class="ps-inst-brand">' +
          '<div class="ps-inst-logo">' + ms("local_hospital") + '</div>' +
          '<div class="ps-inst-text">' +
            '<div class="ps-inst-name">' + esc(inst.name) + '</div>' +
            '<div class="ps-inst-dept">' + esc(inst.dept) + '</div>' +
          '</div>' +
        '</div>' +
        (inst.line ? '<div class="ps-inst-line">' + esc(inst.line) + '</div>' : '') +
      '</div>' +
      '<div class="ps-title-row">' +
        '<div class="ps-title">Chemotherapy Treatment Protocol' + ((pr.custom || pr.lifecycleState === "custom") ? ' <span class="ps-custombadge">CUSTOM / DRAFT</span>' : '') + '</div>' +
        '<div class="ps-doc-meta"><span class="ps-doc-date">Date: ' + esc((st.ctx && st.ctx.today) || "") + '</span></div>' +
      '</div>' +
      emrBar +
      banner +
      '<div class="ps-cards">' +
        '<section class="ps-card"><div class="ps-card-h">Patient demographics</div><div class="ps-card-grid ps-grid-2">' +
          field("Case No / MRN", "caseNo", p.caseNo, "text", "MRN / Case #", isExport) +
          field("Patient Name", "name", p.name, "text", "Full name", isExport) +
          field("Age (yrs)", "age", p.age, "number", "e.g. 58", isExport) +
          sexField(p.sex, isExport) +
          field("Plan No", "planNo", p.planNo, "text", "Plan #", isExport) +
          field("Diagnosis", "diagnosis", p.diagnosis, "text", "Histology / stage", isExport) +
          field("Intent", "intent", intent, "text", "Adjuvant / Neoadjuvant / Palliative", isExport) +
        "</div></section>" +
        '<section class="ps-card ps-card-bio"><div class="ps-card-h">Biometrics &amp; renal function</div><div class="ps-card-grid ps-grid-2">' +
          field("Height (cm)", "heightCm", p.heightCm, "number", "e.g. 165", isExport) +
          field("Weight (kg)", "weightKg", p.weightKg, "number", "e.g. 68", isExport) +
          '<div class="ps-f ps-autofield ps-span-2"><span>Auto BSA (m²)</span><b class="ps-auto-calc ps-auto-bsa">' + bsaDisp + "</b></div>" +
          field("Serum Creatinine (mg/dL)", "creatinine", p.creatinine, "number", "e.g. 0.90", isExport) +
          '<div class="ps-f ps-autofield"><span>Auto CrCl (mL/min)</span><b class="ps-auto-calc ps-auto-crcl">' + crclDisp + "</b></div>" +
        "</div></section>" +
        '<section class="ps-card"><div class="ps-card-h">Prescribing oncologist &amp; date</div><div class="ps-card-grid ps-grid-2">' +
          consultantField(p.consultant, isExport) +
          '<div class="ps-f"><span>Date</span><b>' + esc((st.ctx && st.ctx.today) || "-") + "</b></div>" +
        "</div></section>" +
      "</div>";
  }

  // ---- drug schedule table ----------------------------------------------------------------------
  function tableHtml(isExport) {
    var pr = st.protocol || {};
    var cycles = Math.max(1, Math.min(8, num(pr.cycles) || 1));
    var rows = asArr(pr.drugs).map(drugRow);
    var cycHead = "";
    for (var c = 1; c <= cycles; c++) cycHead += "<th>Cycle " + c + "</th>";
    var body = rows.map(function (r) {
      var cells = "";
      for (var c = 1; c <= cycles; c++) { var v = cycleCell(r, c); cells += '<td class="ps-cyc' + (v === "X" ? " x" : "") + '">' + esc(v) + "</td>"; }
      var vk = st.verify[r.id];
      var chkCol = isExport ? '' : ('<td class="ps-verify"><label class="ps-chk"><input type="checkbox" data-ps-verify="' + esc(r.id) + '"' + (vk ? " checked" : "") + '><span class="ps-chk-box">' + ms("check") + "</span></label></td>");
      return '<tr>' +
        '<td class="ps-dname">' + esc(r.name) + (r.capApplied ? ' <span class="ps-cap" title="dose cap applied">cap</span>' : "") + "</td>" +
        '<td class="ps-ddesc"><b>' + esc(r.totalTxt) + "</b>" + (r.dailyTxt ? ' <span class="ps-daily">(' + esc(r.dailyTxt) + ")</span>" : "") +
          ' <span class="ps-permetre">' + esc(r.perUnit) + (r.route ? " " + esc(r.route) : "") + (r.frequency ? " &middot; " + esc(r.frequency) : "") + "</span>" +
          (r.notes ? '<span class="ps-dnote">' + esc(r.notes) + "</span>" : "") + "</td>" +
        cells +
        chkCol +
        "</tr>";
    }).join("");
    return '<div class="ps-legend">D = day of cycle &middot; X = not scheduled that cycle &middot; total dose computed from BSA (Mosteller) / Calvert AUC (Cockcroft-Gault CrCl)</div>' +
      '<div class="ps-tablewrap"><table class="ps-table"><thead><tr>' +
        "<th>Drug</th><th>Dose / route</th>" + cycHead + (isExport ? '' : '<th class="ps-vh">Verified</th>') +
      "</tr></thead><tbody>" + (body || '<tr><td colspan="' + (cycles + 3) + '">No drugs in this protocol.</td></tr>') + "</tbody></table></div>";
  }

  function listBlock(title, items) {
    items = asArr(items).filter(Boolean);
    if (!items.length) return "";
    return '<div class="ps-block"><div class="ps-block-h">' + esc(title) + "</div><ul>" +
      items.map(function (i) { return "<li>" + esc(typeof i === "object" ? (i.name || i.notes || JSON.stringify(i)) : i) + "</li>"; }).join("") + "</ul></div>";
  }

  function warningsHtml() {
    var pr = st.protocol || {}, b = bsa(), c = crcl();
    var w = [];
    if (pr.custom || pr.lifecycleState === "custom") w.push("Clinician-authored custom protocol - no automatic dose caps applied; verify every dose, unit, route, and schedule.");
    if (!b) w.push("Enter height and weight to compute per-drug BSA total doses.");
    var hasAuc = asArr(pr.drugs).some(function (d) { return d.basis === "auc"; });
    if (hasAuc && !c) w.push("Enter Age, Sex, Weight, and Serum Creatinine to calculate Calvert Carboplatin AUC dose via Cockcroft-Gault CrCl.");
    asArr(pr.drugs).map(drugRow).forEach(function (r) { r.warn.forEach(function (x) { w.push(r.name + ": " + x); }); });
    if (!w.length) return "";
    return '<div class="ps-warns">' + ms("info") + "<div>" + w.map(esc).join("<br>") + "</div></div>";
  }

  function sigHtml(isExport) {
    var p = st.patient || {};
    var hasSig = !!st.sig;
    var sigCanvasOrImg = "";
    if (isExport) {
      if (hasSig) {
        sigCanvasOrImg = '<div class="ps-sig-export-wrap"><img src="' + st.sig + '" class="ps-sig-img" alt="Consultant Signature" style="max-height:80px;display:block;"><div class="ps-sig-verified-tag">' + ms("verified") + ' Digitally Signed &amp; Verified</div></div>';
      } else {
        sigCanvasOrImg = '<div class="ps-sig-line-placeholder"><div class="ps-sig-line"></div><div class="ps-sig-line-lbl">Signature of Prescribing Medical Oncologist</div></div>';
      }
    } else {
      sigCanvasOrImg = '<canvas id="psSig" width="600" height="150"></canvas>' +
        '<div class="ps-sig-actions"><button class="ps-linkbtn" data-ps-act="sig-clear">' + ms("ink_eraser") + "Clear signature</button></div>" +
        '<div class="ps-sig-label">Consultant signature - dose verified</div>';
    }

    return '<div class="ps-signatures">' +
      '<div class="ps-sig-block">' +
        '<div class="ps-sig-block-h">Primary Prescribing Oncologist Verification</div>' +
        '<div class="ps-sig-row">' +
          '<div class="ps-sig-pad">' + sigCanvasOrImg + "</div>" +
          '<div class="ps-sig-meta">' +
            '<div class="ps-f"><span>Consultant</span><b>' + esc(p.consultant || "-") + "</b></div>" +
            '<div class="ps-f"><span>Date</span><b>' + esc((st.ctx && st.ctx.today) || "") + "</b></div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="ps-sig-block ps-sig-second-checker">' +
        '<div class="ps-sig-block-h">Independent Double-Check (Oncology Pharmacist / Second Checker)</div>' +
        '<div class="ps-checker-row">' +
          '<div class="ps-checker-items">' +
            "<span>[ ] Patient ID &amp; Diagnosis Verified</span>" +
            "<span>[ ] Auto BSA / CrCl Verified</span>" +
            "<span>[ ] Drug Doses &amp; Route Verified</span>" +
            "<span>[ ] Premedications &amp; Hydration Verified</span>" +
          "</div>" +
          '<div class="ps-checker-sig">' +
            '<div class="ps-sig-line"></div>' +
            '<div class="ps-sig-line-lbl">Pharmacist / Registered Nurse Signature &amp; Date</div>' +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function sheetHtml(isExport) {
    var pr = st.protocol || {};
    return '<div class="ps-sheet' + (isExport ? ' ps-sheet-export' : '') + '" id="psSheet">' +
      headerHtml(isExport) +
      '<div class="ps-warns-container">' + warningsHtml() + "</div>" +
      '<div class="ps-tablewrap-container">' + tableHtml(isExport) + "</div>" +
      listBlock("Premedications & Hydration", asArr(pr.premedications)) +
      listBlock("Supportive Care", asArr(pr.supportiveCare)) +
      listBlock("Monitoring & Lab Safety Parameters", asArr(pr.monitoring)) +
      (pr.specialInstructions ? '<div class="ps-block"><div class="ps-block-h">Special Instructions / Administration Pearls</div><p>' + esc(pr.specialInstructions) + "</p></div>" : "") +
      sigHtml(isExport) +
      '<div class="ps-foot">NOTICE: Clinician decision-support document — not an automated order. Independent double-check and dose verification required prior to compounding and administration in accordance with ASCO/ONS chemotherapy safety standards. Generated by StewardMD OncoTree.</div>' +
      "</div>";
  }

  function shellHtml() {
    var pr = st.protocol;
    if (!pr) return '<div class="ps-loading">' + ms("progress_activity") + "Loading protocol...</div>";
    return '<div class="ps-wrap">' +
      '<header class="ps-header">' +
        '<button class="ps-hbtn" data-ps-act="close" aria-label="Back">' + ms("arrow_back") + "</button>" +
        '<div class="ps-htitle"><span class="ps-hkicker">Protocol sheet</span><span class="ps-hname">' + esc(pr.name || "") + "</span></div>" +
        '<button class="ps-hbtn ps-hbtn-emr" data-ps-act="wardsync-fetch" title="Fetch from WardSync EMR">' + ms("sync") + "</button>" +
        '<button class="ps-hbtn" data-ps-act="edit" aria-label="Edit patient">' + ms(st.editing ? "check" : "edit") + "</button>" +
      "</header>" +
      '<div class="ps-scroll">' + sheetHtml(false) + "</div>" +
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
      if (act === "wardsync-fetch") { fetchWardSync(); return; }
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
  function updateLiveDoses() {
    if (!D) return;
    var b = bsa();
    var c = crcl();
    var elBsa = D.querySelector(".ps-auto-bsa");
    if (elBsa) {
      elBsa.innerHTML = b ? ('<span class="ps-calc-val">' + round2(b) + ' m²</span><span class="ps-calc-tag">Mosteller</span>') : '<span class="ps-calc-missing">Auto (enter Ht &amp; Wt)</span>';
    }
    var elCrcl = D.querySelector(".ps-auto-crcl");
    if (elCrcl) {
      elCrcl.innerHTML = c ? ('<span class="ps-calc-val">' + round2(c) + ' mL/min</span><span class="ps-calc-tag">Cockcroft-Gault</span>') : '<span class="ps-calc-missing">Auto (enter Age, Wt, SCr, Sex)</span>';
    }
    var tableWrap = D.querySelector(".ps-tablewrap-container");
    if (tableWrap) {
      tableWrap.innerHTML = tableHtml(false);
    }
    var warnsWrap = D.querySelector(".ps-warns-container");
    if (warnsWrap) {
      warnsWrap.innerHTML = warningsHtml();
    }
  }
  function onInput(e) {
    var f = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-field");
    if (!f) return;
    st.patient = st.patient || {};
    st.patient[f] = e.target.value;
    if (f === "heightCm" || f === "weightKg" || f === "creatinine" || f === "age" || f === "sex") {
      updateLiveDoses();
    }
  }
  function onChange(e) {
    var f = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-field");
    if (!f) return;
    st.patient = st.patient || {};
    st.patient[f] = e.target.value;
    if (f === "heightCm" || f === "weightKg" || f === "creatinine" || f === "age" || f === "sex") {
      updateLiveDoses();
    }
  }

  function buildExportHtml() {
    var pr = st.protocol || {};
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(pr.name || "Treatment Protocol") + '</title>' +
      '<style>' +
      ':root{color-scheme:light}' +
      'body{margin:0;padding:16px;background:#fff!important;color:#14202b!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '.ps-sheet{max-width:800px;margin:0 auto;background:#fff;border:none;box-shadow:none;padding:8px}' +
      '.ps-inst{border-bottom:2.5px solid #0f766e;padding-bottom:10px;margin-bottom:10px}' +
      '.ps-inst-brand{display:flex;align-items:center;gap:10px}' +
      '.ps-inst-logo{width:36px;height:36px;background:#0f766e;color:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center}' +
      '.ps-inst-name{font:800 18px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f766e;letter-spacing:-.01em}' +
      '.ps-inst-dept{font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#334155;margin-top:2px}' +
      '.ps-inst-line{font:500 10.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#64748b;margin-top:4px}' +
      '.ps-title-row{display:flex;justify-content:space-between;align-items:baseline;margin:8px 0 12px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}' +
      '.ps-title{font:800 15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#0f172a}' +
      '.ps-doc-date{font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#64748b}' +
      '.ps-regimenbanner{background:#0f766e;color:#fff;border-radius:10px;padding:12px 16px;margin-bottom:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.ps-regimen-kicker{font:800 9.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;letter-spacing:.1em;opacity:.8}' +
      '.ps-regimen-name{font:800 17px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:-.01em;margin-top:2px}' +
      '.ps-regimen-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
      '.ps-regimen-chip{font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:3px 10px}' +
      '.ps-cards{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px}' +
      '.ps-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px}' +
      '.ps-card-h{font:800 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;margin-bottom:8px}' +
      '.ps-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}' +
      '.ps-span-2{grid-column:1/-1}' +
      '.ps-renalbadge{font:700 8.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border-radius:4px;padding:1px 5px;border:1px solid;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.ps-renal-ok{color:#166534;background:#dcfce7;border-color:#86efac}' +
      '.ps-renal-mild{color:#075985;background:#e0f2fe;border-color:#7dd3fc}' +
      '.ps-renal-mod{color:#92400e;background:#fef3c7;border-color:#fcd34d}' +
      '.ps-renal-sev{color:#9a3412;background:#ffedd5;border-color:#fdba74}' +
      '.ps-renal-fail{color:#fff;background:#dc2626;border-color:#991b1b}' +
      '.ps-f{display:flex;align-items:baseline;gap:6px;font-size:11.5px}' +
      '.ps-f>span{color:#64748b;font-weight:600;min-width:110px}' +
      '.ps-f>b{font-weight:700;color:#0f172a}' +
      '.ps-autofield b{display:inline-flex;align-items:center;gap:6px}' +
      '.ps-calc-val{color:#0f766e;font-weight:800}' +
      '.ps-calc-tag{font:700 8.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;color:#0f766e;background:#ccfbf1;border:1px solid #99f6e4;border-radius:4px;padding:1px 5px}' +
      '.ps-calc-missing{color:#94a3b8;font-style:italic;font-weight:500}' +
      '.ps-tablewrap{border:1px solid #94a3b8;border-radius:8px;overflow:hidden;margin-top:10px}' +
      '.ps-table{width:100%;border-collapse:collapse;font-size:11px}' +
      '.ps-table th{background:#f1f5f9;color:#334155;font:700 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;padding:7px 9px;border-bottom:1.5px solid #94a3b8;text-align:left}' +
      '.ps-table td{padding:7px 9px;border-bottom:1px solid #cbd5e1;vertical-align:top}' +
      '.ps-table tr:last-child td{border-bottom:none}' +
      '.ps-dname{font-weight:700;color:#0f172a}' +
      '.ps-cap{font:700 8.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;color:#fff;background:#dc2626;border-radius:4px;padding:1px 4px}' +
      '.ps-ddesc b{font-weight:800;color:#0f766e;font-size:12px}' +
      '.ps-daily{font:800 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a}' +
      '.ps-permetre{display:block;color:#64748b;font-size:10px;margin-top:2px}' +
      '.ps-dnote{display:block;color:#64748b;font-size:9.5px;margin-top:2px;font-style:italic}' +
      '.ps-cyc{text-align:center;font:600 10.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.ps-cyc.x{color:#94a3b8;font-weight:700}' +
      '.ps-legend{font-size:9.5px;color:#64748b;margin:6px 0}' +
      '.ps-warns{display:flex;gap:8px;font-size:11px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin:8px 0}' +
      '.ps-block{margin-top:10px;page-break-inside:avoid}' +
      '.ps-block-h{font:800 10.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;color:#475569;margin-bottom:4px;letter-spacing:.03em;border-bottom:1px dashed #e2e8f0;padding-bottom:2px}' +
      '.ps-block ul{margin:0;padding-left:18px}' +
      '.ps-block li,.ps-block p{font-size:10.5px;line-height:1.45;margin:2px 0;color:#334155}' +
      '.ps-signatures{margin-top:16px;page-break-inside:avoid;border-top:1.5px solid #cbd5e1;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
      '.ps-sig-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}' +
      '.ps-sig-block-h{font:800 10px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-transform:uppercase;color:#475569;margin-bottom:8px}' +
      '.ps-sig-row{display:flex;flex-direction:column;gap:8px}' +
      '.ps-sig-export-wrap{margin-bottom:6px}' +
      '.ps-sig-verified-tag{display:inline-flex;align-items:center;gap:4px;font:700 9.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f766e;margin-top:4px}' +
      '.ps-sig-line-placeholder{margin-top:30px}' +
      '.ps-sig-line{border-bottom:1px solid #0f172a;margin-bottom:4px;height:1px}' +
      '.ps-sig-line-lbl{font:600 9.5px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#64748b}' +
      '.ps-checker-items{display:grid;grid-template-columns:1fr;gap:3px;font-size:9.5px;color:#475569;margin-bottom:12px}' +
      '.ps-foot{margin-top:14px;padding-top:8px;border-top:1px solid #cbd5e1;font-size:9px;color:#64748b;line-height:1.4}' +
      '.ps-vh,.ps-verify,.ps-sig-actions,.ps-emr-bar{display:none!important}' +
      '@page{size:A4 portrait;margin:8mm 10mm}' +
      '@media print{.ps-vh,.ps-verify,.ps-sig-actions,.ps-emr-bar{display:none!important}}' +
      '</style></head><body>' + sheetHtml(true) + '</body></html>';
  }

  function doPrint() {
    commitEdits();
    var pr = st.protocol || {};
    var name = ("StewardMD-" + (pr.name || pr.id || "protocol")).replace(/[^\w.-]+/g, "-");
    var fullHtml = buildExportHtml();
    if (G.toast) G.toast("Building PDF...");

    // 1. Native bridge PDF export (shares real .pdf)
    var N = G.SMD_NATIVE;
    if (G.SMD_IS_NATIVE && N && N.sharePdfFromHtml) {
      N.sharePdfFromHtml(fullHtml, name, "StewardMD - " + (pr.name || "Protocol sheet")).catch(function () {
        if (G.SMD_PDF && G.SMD_PDF.fromHtml) {
          G.SMD_PDF.fromHtml(fullHtml, name, "StewardMD - " + (pr.name || "Protocol sheet")).catch(function () {
            try { G.print(); } catch (e) {}
          });
        } else {
          try { G.print(); } catch (e) {}
        }
      });
      return;
    }

    // 2. Client-side PDF export (downloads real .pdf)
    if (G.SMD_PDF && G.SMD_PDF.fromHtml) {
      G.SMD_PDF.fromHtml(fullHtml, name, "StewardMD - " + (pr.name || "Protocol sheet")).catch(function () {
        try { G.print(); } catch (e) {}
      });
      return;
    }

    // 3. Desktop browser print fallback
    try { G.print(); } catch (e) {}
  }

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
      el.style.zIndex = "15000";
      D.body.appendChild(el);
      el.addEventListener("click", onClick);
      el.addEventListener("input", onInput);
      el.addEventListener("change", onChange);
    } else {
      el.style.zIndex = "15000";
    }
    return el;
  }
  function start(protocol, patient, opts) {
    opts = opts || {};
    st.protocol = protocol; st.patient = patient ? JSON.parse(JSON.stringify(patient)) : {};
    st.verify = {}; st.sig = null; st.editing = !(patient && patient.heightCm && patient.weightKg && patient.name);
    st.ctx = opts; st.onAssign = opts.onAssign || null;
    var el = ensureEl(); el.style.display = "block"; el.style.zIndex = "15000"; if (D.body) D.body.classList.add("ps-open");
    paint();
  }
  function open(protocolOrId, patient, opts) {
    if (!D) return;
    // Object-envelope form: open({ protocol, patient, today, institution, onAssign, opts }).
    if (protocolOrId && typeof protocolOrId === "object" && protocolOrId.protocol) {
      var o = protocolOrId;
      var oc = (o.opts && typeof o.opts === "object") ? o.opts : {};
      if (o.today != null && oc.today == null) oc.today = o.today;
      if (o.institution != null && oc.institution == null) oc.institution = o.institution;
      if (o.onAssign != null && oc.onAssign == null) oc.onAssign = o.onAssign;
      var merged = {}, k;
      for (k in oc) merged[k] = oc[k];
      if (opts && typeof opts === "object") { for (k in opts) merged[k] = opts[k]; }
      return start(o.protocol, o.patient || patient || {}, merged);
    }
    if (protocolOrId && typeof protocolOrId === "object") return start(protocolOrId, patient, opts);
    if (!G.fetch) return;
    G.fetch("/kb/protocols/" + encodeURIComponent(protocolOrId) + ".json").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { if (p) start(p, patient, opts); else if (G.toast) G.toast("Protocol not found: " + protocolOrId); })
      .catch(function () { if (G.toast) G.toast("Could not load protocol."); });
  }
  function close() { var el = D && D.getElementById("smdProtoSheet"); if (el) el.style.display = "none"; if (D && D.body) D.body.classList.remove("ps-open"); }

  var API = {
    open: open, close: close, _st: st, _drugRow: drugRow,
    bsa: bsa, crcl: crcl, sheetHtml: sheetHtml, buildExportHtml: buildExportHtml,
    fetchWardSync: fetchWardSync, _version: "1.2"
  };
  if (root) root.SMD_PROTOSHEET = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
