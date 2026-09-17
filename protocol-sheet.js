/* StewardMD - Chemotherapy Protocol Sheet (mobile view + print-to-PDF + EMR assign).
 * Renders a formal, printable "Treatment Protocol" sheet from a protocol JSON + patient, with per-drug
 * doses computed by the existing dose engine (SMD_ONCODOSE), doctor dosage overrides, custom drug addition,
 * adverse effect / antidote management, multilingual oral tablet instructions (English + Telugu, Tamil,
 * Kannada, Hindi, Malayalam), customizable hospital branding, and dual doctor/pharmacist verification.
 * Decision support / DRAFT: the physician verifies; nothing is an order.
 * window.SMD_PROTOSHEET. Buildless ES5 IIFE. PDF = native browser print (Save as PDF).
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return "<span class=\"material-symbols-rounded\" aria-hidden=\"true\">" + n + "</span>"; }
  function asArr(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
  function DOSE() { return G.SMD_ONCODOSE; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

  var BRANDING_STORAGE_KEY = "smd_onco_inst_branding";
  var DEFAULT_INSTITUTION = {
    name: "StewardMD Oncology Clinical Care",
    dept: "Department of Medical Oncology & Clinical Hematology",
    line: "Chemotherapy Treatment Protocol & Order Verification Sheet",
    logoDataUrl: null
  };

  var st = {
    protocol: null,
    patient: null,
    verify: {},
    sig: null,
    editing: false,
    ctx: null,
    onAssign: null,
    institution: null,
    overrides: {},
    activeDoseEditModal: null,
    showAddDrugModal: false,
    showBrandingModal: false,
    showAddToxModal: false,
    doctorNotes: "",
    includeDoctorNotesInPrint: true,
    oralLang: "en",
    includeOralInstructions: true,
    customToxicities: [],
    disabledToxicities: {},
    tempLogoDataUrl: null
  };

  // ---- Institution Branding ---------------------------------------------------------------------
  function getInstitution() {
    if (st.institution && st.institution.name) return st.institution;
    if (st.ctx && st.ctx.institution && st.ctx.institution.name) return st.ctx.institution;
    try {
      if (typeof root !== "undefined" && root.localStorage) {
        var raw = root.localStorage.getItem(BRANDING_STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.name) {
            st.institution = parsed;
            return parsed;
          }
        }
      }
    } catch (e) {}
    return DEFAULT_INSTITUTION;
  }

  function saveInstitution(inst) {
    st.institution = inst;
    try {
      if (typeof root !== "undefined" && root.localStorage) {
        root.localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(inst));
      }
    } catch (e) {}
  }

  function resetInstitution() {
    st.institution = JSON.parse(JSON.stringify(DEFAULT_INSTITUTION));
    try {
      if (typeof root !== "undefined" && root.localStorage) {
        root.localStorage.removeItem(BRANDING_STORAGE_KEY);
      }
    } catch (e) {}
  }

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

  // per-drug: mg/m2 (or per-unit), computed total mg, route, per-cycle day markers, doctor overrides
  function drugRow(drug) {
    var line = doseLine(drug);
    var perUnit = drug.dosePerUnit != null ? drug.dosePerUnit + " " + (drug.unit || "") : "verify";
    var total = line && line.final != null ? line.final : null;

    // Custom added drug fallback calculations if DOSE() didn't handle it
    if (total == null && drug.custom) {
      var p = st.patient || {};
      var b = bsa(), w = num(p.weightKg);
      if (drug.basis === "bsa" && b && num(drug.dosePerUnit)) total = num(drug.dosePerUnit) * b;
      else if (drug.basis === "mgkg" && w && num(drug.dosePerUnit)) total = num(drug.dosePerUnit) * w;
      else if (drug.basis === "flat" && num(drug.dosePerUnit)) total = num(drug.dosePerUnit);
    }

    // Calvert (AUC) returns mg, so never label an AUC total as "AUC".
    var unitBase = drug.basis === "auc" ? "mg" : ((drug.unit || "").replace("/m2", "").replace("/kg", "") || "mg");

    // Doctor Dose Override check
    var ov = (st.overrides && st.overrides[drug.id]) || (drug.customDoseMg != null ? { customDoseMg: drug.customDoseMg, reason: drug.doctorAdjustReason } : null);
    var isAdjusted = !!(ov && ov.customDoseMg != null);
    var effectiveTotal = isAdjusted ? num(ov.customDoseMg) : total;

    // BID/TID daily total
    var perDay = line && line.dosesPerDay > 1 ? line.dosesPerDay : 1;
    var daily = (effectiveTotal != null && perDay > 1) ? (effectiveTotal * perDay) : ((total != null && perDay > 1 && line && line.dailyDose != null) ? line.dailyDose : null);
    var miss = drug.basis === "auc" ? "enter creatinine + age + sex" : (drug.basis === "bsa" || drug.basis === "mgkg" ? "enter ht/wt" : perUnit);

    return {
      id: drug.id,
      name: drug.name || drug.id,
      perUnit: perUnit,
      route: drug.route || "",
      basis: drug.basis,
      total: effectiveTotal,
      origTotal: total,
      totalTxt: effectiveTotal != null ? (round2(effectiveTotal) + " " + unitBase) : miss,
      origTotalTxt: total != null ? (round2(total) + " " + unitBase) : null,
      dailyTxt: daily != null ? (round2(daily) + " " + unitBase + "/day") : null,
      frequency: drug.frequency || "",
      days: asArr(drug.days),
      notes: drug.notes || "",
      warn: line ? asArr(line.warnings) : [],
      capApplied: line && line.capApplied,
      cycleSchedule: drug.cycleSchedule || null,
      isAdjusted: isAdjusted,
      adjustReason: ov ? ov.reason : "",
      custom: !!drug.custom
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
      var stepAttr = (key === "creatinine") ? " step=\"0.01\"" : ((key === "heightCm" || key === "weightKg") ? " step=\"0.1\"" : "");
      var minAttr = (type === "number") ? " min=\"0\"" : "";
      return "<label class=\"ps-f\"><span>" + esc(label) + "</span><input data-ps-field=\"" + key + "\" type=\"" + (type || "text") + "\"" + stepAttr + minAttr + " placeholder=\"" + esc(placeholder || "") + "\" value=\"" + esc(val == null ? "" : val) + "\"></label>";
    }
    return "<div class=\"ps-f\"><span>" + esc(label) + "</span><b>" + esc(val == null || val === "" ? "-" : val) + "</b></div>";
  }

  function sexField(val, isExport) {
    var s = String(val || "").toLowerCase();
    var isF = s.indexOf("f") === 0;
    var isM = s.indexOf("m") === 0;
    var display = isF ? "Female" : (isM ? "Male" : (val || "-"));
    if (st.editing && !isExport) {
      return "<label class=\"ps-f\"><span>Sex</span><select data-ps-field=\"sex\" class=\"ps-select-field\">" +
        "<option value=\"\">Select sex</option>" +
        "<option value=\"female\"" + (isF ? " selected" : "") + ">Female</option>" +
        "<option value=\"male\"" + (isM ? " selected" : "") + ">Male</option>" +
        "</select></label>";
    }
    return "<div class=\"ps-f\"><span>Sex</span><b>" + esc(display) + "</b></div>";
  }

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
      return "<label class=\"ps-f\"><span>Consultant</span><input data-ps-field=\"consultant\" type=\"text\" placeholder=\"Treating oncologist\" value=\"" + esc(val == null ? "" : val) + "\"></label>";
    }
    return "<div class=\"ps-f\"><span>Consultant</span><b>" + esc(val == null || val === "" ? "-" : val) + "</b></div>";
  }

  function headerHtml(isExport) {
    var p = st.patient || {}, pr = st.protocol || {};
    var b = bsa();
    var c = crcl();
    var rs = renalStage(c);
    var inst = getInstitution();
    var bsaDisp = b ? ("<span class=\"ps-calc-val\">" + round2(b) + " m²</span><span class=\"ps-calc-tag\">Mosteller</span>") : "<span class=\"ps-calc-missing\">Auto (enter Ht &amp; Wt)</span>";
    var crclDisp = c ? ("<span class=\"ps-calc-val\">" + round2(c) + " mL/min</span><span class=\"ps-calc-tag\">Cockcroft-Gault</span>" + (rs ? " <span class=\"ps-renalbadge " + rs.cls + "\">" + esc(rs.label) + "</span>" : "")) : "<span class=\"ps-calc-missing\">Auto (enter Age, Wt, SCr, Sex)</span>";

    var emrBar = (st.editing && !isExport) ? (
      "<div class=\"ps-emr-bar\">" +
        "<span class=\"ps-emr-hint\">" + ms("tune") + " <span>Doctor input mode: edit vitals, adjust doses, or add custom drugs.</span></span>" +
        "<button type=\"button\" class=\"ps-wardsync-btn\" data-ps-act=\"wardsync-fetch\" title=\"Fetch labs and vitals from WardSync EMR\">" + ms("sync") + " <span>Fetch from WardSync EMR</span></button>" +
      "</div>"
    ) : "";

    var intent = p.intent || (asArr(pr.intentOptions)[0] || "");
    var stage = asArr(pr.stage).join(", ");
    var chips = [];
    if (pr.cycles) chips.push("<span class=\"ps-regimen-chip\">" + esc(pr.cycles) + " planned cycles</span>");
    if (pr.cycleLengthDays) chips.push("<span class=\"ps-regimen-chip\">Every " + esc(pr.cycleLengthDays) + " days</span>");
    if (intent) chips.push("<span class=\"ps-regimen-chip\">" + esc(intent) + "</span>");
    if (stage) chips.push("<span class=\"ps-regimen-chip\">Stage " + esc(stage) + "</span>");
    var banner =
      "<div class=\"ps-regimenbanner\">" +
        "<div class=\"ps-regimen-kicker\">Regimen</div>" +
        "<div class=\"ps-regimen-name\">" + esc(pr.name || "Treatment Protocol") + ((pr.custom || pr.lifecycleState === "custom") ? " <span class=\"ps-custombadge\">CUSTOM / DRAFT</span>" : "") + "</div>" +
        (chips.length ? "<div class=\"ps-regimen-meta\">" + chips.join("") + "</div>" : "") +
      "</div>";

    var logoHtml = inst.logoDataUrl ?
      "<div class=\"ps-inst-logo ps-inst-logo-custom\"><img src=\"" + esc(inst.logoDataUrl) + "\" alt=\"Hospital Logo\" class=\"ps-inst-logo-img\"></div>" :
      "<div class=\"ps-inst-logo\">" + ms("local_hospital") + "</div>";

    var brandEditBtn = isExport ? "" : (
      "<button type=\"button\" class=\"ps-inst-editbtn\" data-ps-act=\"open-branding\" title=\"Customize hospital name and logo\">" +
        ms("edit_note") + "<span>Customize Hospital &amp; Logo</span>" +
      "</button>"
    );

    return "<div class=\"ps-inst\">" +
        "<div class=\"ps-inst-top\">" +
          "<div class=\"ps-inst-brand\">" +
            logoHtml +
            "<div class=\"ps-inst-text\">" +
              "<div class=\"ps-inst-name\">" + esc(inst.name) + "</div>" +
              "<div class=\"ps-inst-dept\">" + esc(inst.dept) + "</div>" +
            "</div>" +
          "</div>" +
          brandEditBtn +
        "</div>" +
        (inst.line ? "<div class=\"ps-inst-line\">" + esc(inst.line) + "</div>" : "") +
      "</div>" +
      "<div class=\"ps-title-row\">" +
        "<div class=\"ps-title\">Chemotherapy Treatment Protocol" + ((pr.custom || pr.lifecycleState === "custom") ? " <span class=\"ps-custombadge\">CUSTOM / DRAFT</span>" : "") + "</div>" +
        "<div class=\"ps-doc-meta\"><span class=\"ps-doc-date\">Date: " + esc((st.ctx && st.ctx.today) || "") + "</span></div>" +
      "</div>" +
      emrBar +
      banner +
      "<div class=\"ps-cards\">" +
        "<section class=\"ps-card\"><div class=\"ps-card-h\">Patient demographics</div><div class=\"ps-card-grid ps-grid-2\">" +
          field("Case No / MRN", "caseNo", p.caseNo, "text", "MRN / Case #", isExport) +
          field("Patient Name", "name", p.name, "text", "Full name", isExport) +
          field("Age (yrs)", "age", p.age, "number", "e.g. 58", isExport) +
          sexField(p.sex, isExport) +
          field("Plan No", "planNo", p.planNo, "text", "Plan #", isExport) +
          field("Diagnosis", "diagnosis", p.diagnosis, "text", "Histology / stage", isExport) +
          field("Intent", "intent", intent, "text", "Adjuvant / Neoadjuvant / Palliative", isExport) +
        "</div></section>" +
        "<section class=\"ps-card ps-card-bio\"><div class=\"ps-card-h\">Biometrics &amp; renal function</div><div class=\"ps-card-grid ps-grid-2\">" +
          field("Height (cm)", "heightCm", p.heightCm, "number", "e.g. 165", isExport) +
          field("Weight (kg)", "weightKg", p.weightKg, "number", "e.g. 68", isExport) +
          "<div class=\"ps-f ps-autofield ps-span-2\"><span>Auto BSA (m²)</span><b class=\"ps-auto-calc ps-auto-bsa\">" + bsaDisp + "</b></div>" +
          field("Serum Creatinine (mg/dL)", "creatinine", p.creatinine, "number", "e.g. 0.90", isExport) +
          "<div class=\"ps-f ps-autofield\"><span>Auto CrCl (mL/min)</span><b class=\"ps-auto-calc ps-auto-crcl\">" + crclDisp + "</b></div>" +
        "</div></section>" +
        "<section class=\"ps-card\"><div class=\"ps-card-h\">Prescribing oncologist &amp; date</div><div class=\"ps-card-grid ps-grid-2\">" +
          consultantField(p.consultant, isExport) +
          "<div class=\"ps-f\"><span>Date</span><b>" + esc((st.ctx && st.ctx.today) || "-") + "</b></div>" +
        "</div></section>" +
      "</div>";
  }

  // ---- drug schedule table with doctor overrides & add drug -------------------------------------
  function tableHtml(isExport) {
    var pr = st.protocol || {};
    var cycles = Math.max(1, Math.min(8, num(pr.cycles) || 1));
    var rows = asArr(pr.drugs).map(drugRow);
    var cycHead = "";
    for (var c = 1; c <= cycles; c++) cycHead += "<th>Cycle " + c + "</th>";

    var body = rows.map(function (r) {
      var cells = "";
      for (var c = 1; c <= cycles; c++) {
        var v = cycleCell(r, c);
        cells += "<td class=\"ps-cyc" + (v === "X" ? " x" : "") + "\">" + esc(v) + "</td>";
      }
      var vk = st.verify[r.id];
      var chkCol = isExport ? "" : ("<td class=\"ps-verify\"><label class=\"ps-chk\"><input type=\"checkbox\" data-ps-verify=\"" + esc(r.id) + "\"" + (vk ? " checked" : "") + "><span class=\"ps-chk-box\">" + ms("check") + "</span></label></td>");

      var editDoseBtn = isExport ? "" : (
        "<button type=\"button\" class=\"ps-dose-edit-btn\" data-ps-act=\"edit-drug-dose\" data-ps-drug-id=\"" + esc(r.id) + "\" title=\"Doctor dosage adjustment\">" +
          ms("tune") + "<span>Adjust</span>" +
        "</button>"
      );

      var customDelBtn = (!isExport && r.custom) ? (
        "<button type=\"button\" class=\"ps-linkbtn ps-danger-link ps-drug-del-btn\" data-ps-act=\"delete-custom-drug\" data-ps-drug-id=\"" + esc(r.id) + "\" title=\"Remove custom drug\">" +
          ms("delete") +
        "</button>"
      ) : "";

      var badgeHtml = "";
      if (r.isAdjusted) {
        badgeHtml += " <span class=\"ps-custombadge ps-adjusted-badge\" title=\"Doctor dosage override\">Doctor Adjusted</span>";
      }
      if (r.custom) {
        badgeHtml += " <span class=\"ps-custombadge ps-docadded-badge\">Added by Doctor</span>";
      }
      if (r.capApplied) {
        badgeHtml += " <span class=\"ps-cap\" title=\"dose cap applied\">cap</span>";
      }

      var origDoseFootnote = "";
      if (r.isAdjusted && r.origTotalTxt) {
        origDoseFootnote = "<div class=\"ps-orig-footnote\">Standard calculated: " + esc(r.origTotalTxt) + (r.adjustReason ? (" &bull; Reason: " + esc(r.adjustReason)) : "") + "</div>";
      }

      return "<tr>" +
        "<td class=\"ps-dname\">" +
          "<div class=\"ps-dname-row\">" +
            "<span>" + esc(r.name) + "</span>" +
            badgeHtml +
            customDelBtn +
          "</div>" +
        "</td>" +
        "<td class=\"ps-ddesc\">" +
          "<div class=\"ps-dose-val-row\">" +
            "<b>" + esc(r.totalTxt) + "</b>" +
            editDoseBtn +
          "</div>" +
          (r.dailyTxt ? " <span class=\"ps-daily\">(" + esc(r.dailyTxt) + ")</span>" : "") +
          " <span class=\"ps-permetre\">" + esc(r.perUnit) + (r.route ? " " + esc(r.route) : "") + (r.frequency ? " &middot; " + esc(r.frequency) : "") + "</span>" +
          origDoseFootnote +
          (r.notes ? "<span class=\"ps-dnote\">" + esc(r.notes) + "</span>" : "") +
        "</td>" +
        cells +
        chkCol +
      "</tr>";
    }).join("");

    var addDrugBtn = isExport ? "" : (
      "<div class=\"ps-table-actions\">" +
        "<button type=\"button\" class=\"ps-btn ghost ps-btn-sm\" data-ps-act=\"open-add-drug\">" +
          ms("add_circle") + "<span>Add Medication / Supportive Agent to Regimen</span>" +
        "</button>" +
      "</div>"
    );

    return "<div class=\"ps-legend\">D = day of cycle &middot; X = not scheduled that cycle &middot; total dose computed from BSA (Mosteller) / Calvert AUC (Cockcroft-Gault CrCl)</div>" +
      "<div class=\"ps-tablewrap\"><table class=\"ps-table\"><thead><tr>" +
        "<th>Drug</th><th>Dose / route</th>" + cycHead + (isExport ? "" : "<th class=\"ps-vh\">Verified</th>") +
      "</tr></thead><tbody>" + (body || "<tr><td colspan=\"" + (cycles + 3) + "\">No drugs in this protocol.</td></tr>") + "</tbody></table></div>" +
      addDrugBtn;
  }

  function listBlock(title, items) {
    items = asArr(items).filter(Boolean);
    if (!items.length) return "";
    return "<div class=\"ps-block ps-page-break-auto\"><div class=\"ps-block-h\">" + esc(title) + "</div><ul>" +
      items.map(function (i) { return "<li>" + esc(typeof i === "object" ? (i.name || i.notes || JSON.stringify(i)) : i) + "</li>"; }).join("") + "</ul></div>";
  }

  function warningsHtml() {
    var pr = st.protocol || {}, b = bsa(), c = crcl();
    var w = [];
    if (pr.custom || pr.lifecycleState === "custom") w.push("Clinician-authored custom protocol - verify every dose, unit, route, and cycle schedule.");
    if (!b) w.push("Enter height and weight to compute per-drug BSA total doses.");
    var hasAuc = asArr(pr.drugs).some(function (d) { return d.basis === "auc"; });
    if (hasAuc && !c) w.push("Enter Age, Sex, Weight, and Serum Creatinine to calculate Calvert Carboplatin AUC dose via Cockcroft-Gault CrCl.");
    asArr(pr.drugs).map(drugRow).forEach(function (r) { r.warn.forEach(function (x) { w.push(r.name + ": " + x); }); });
    if (!w.length) return "";
    return "<div class=\"ps-warns\">" + ms("info") + "<div>" + w.map(esc).join("<br>") + "</div></div>";
  }

  // ---- CLINICAL ADVERSE EFFECTS & ANTIDOTES CATALOG ---------------------------------------------
  var TOXICITY_CATALOG = [
    {
      id: "irinotecan-cholinergic",
      match: ["irinotecan", "cpt-11", "folfirinox", "folfiri", "xelliri", "capiri"],
      drug: "Irinotecan (CPT-11)",
      title: "Acute Cholinergic Syndrome & Delayed Diarrhea",
      symptoms: "Acute diaphoresis, severe abdominal cramping, lacrimation, salivation, early diarrhea, miosis (within 24h). Delayed diarrhea (>24h post-infusion) causing severe dehydration and neutropenic enterocolitis.",
      management: "Acute Cholinergic Syndrome: Administer Atropine 0.25 mg to 1.0 mg IV or SC immediately. Premedicate with Atropine 0.25–0.5 mg SC 30 min prior to future cycles.\nDelayed Diarrhea (>24h): High-dose Loperamide 4 mg PO at first loose stool, then 2 mg PO every 2 hours until diarrhea-free for 12 hours (max 16 mg/day). If refractory after 48 hours: Octreotide 100–150 mcg SC TID + Ciprofloxacin 500 mg PO BID."
    },
    {
      id: "cisplatin-nephro-emesis",
      match: ["cisplatin", "cddp", "cis-platinum"],
      drug: "Cisplatin",
      title: "Acute Tubular Nephrotoxicity, Severe Emesis & Ototoxicity",
      symptoms: "Acute tubular necrosis, renal magnesium/potassium wasting, severe acute/delayed emesis (emetogenic risk >90%), high-frequency sensorineural ototoxicity.",
      management: "Vigorous Pre-hydration: 1000 mL Normal Saline + 20 mEq KCl + 1 g MgSO4 over 2h; Post-hydration: 1000 mL NS over 2h. Maintain urine output > 100–150 mL/hr (administer Mannitol 12.5–25 g IV if output < 100 mL/hr).\nTriple Antiemetic Prophylaxis: NK1 receptor antagonist (Aprepitant 125 mg PO / Fosaprepitant 150 mg IV) + 5-HT3 antagonist (Ondansetron 16 mg IV) + Dexamethasone 12 mg IV/PO. Serial audiometry and baseline CrCl mandatory."
    },
    {
      id: "oxaliplatin-cold-spasm",
      match: ["oxaliplatin", "eloxatin", "folfox", "xelox", "capox", "folfirinox"],
      drug: "Oxaliplatin",
      title: "Acute Cold-Induced Pharyngolaryngeal Dysesthesia & Neuropathy",
      symptoms: "Cold-induced laryngopharyngeal dysesthesia (feeling of suffocation/choking on cold fluids), perioral paresthesias, cumulative peripheral sensory neuropathy.",
      management: "Patient Education: Strictly avoid cold drinks, ice, ice cream, touching cold metal/refrigerators, or breathing cold air for 5–7 days post-infusion.\nInfusion Management: If acute pharyngolaryngeal spasm occurs, prolong infusion duration from 2 to 6 hours.\nINCOMPATIBILITY: NEVER dilute or flush with Normal Saline (causes rapid degradation); dilute in 5% Dextrose (D5W) ONLY."
    },
    {
      id: "paclitaxel-hsr",
      match: ["paclitaxel", "taxol", "docetaxel", "taxotere", "cabazitaxel"],
      drug: "Taxanes (Paclitaxel / Docetaxel)",
      title: "Acute Hypersensitivity Reactions (HSR) & Peripheral Neuropathy",
      symptoms: "Type I anaphylactoid reaction (bronchospasm, dyspnea, flushing, chest pain, back pain, profound hypotension) typically within first 10–15 min of infusion.",
      management: "Mandatory Premedication: Dexamethasone 20 mg IV 30 min prior (or 20 mg PO at 12h and 6h pre-paclitaxel) + Diphenhydramine 50 mg IV + Ranitidine 50 mg IV (or Famotidine 20 mg IV).\nAcute HSR Protocol: STOP infusion immediately. High-flow 100% O2; Epinephrine 0.3–0.5 mg IM (1:1000) into lateral thigh; IV Hydrocortisone 100 mg; IV Normal Saline bolus."
    },
    {
      id: "doxorubicin-extravasation",
      match: ["doxorubicin", "adriamycin", "epirubicin", "daunorubicin", "idarubicin", "ac", "fac", "caf", "abvd", "chop"],
      drug: "Anthracyclines (Doxorubicin / Epirubicin)",
      title: "Vesicant Tissue Necrosis & Cumulative Lifetime Cardiotoxicity",
      symptoms: "Severe soft tissue necrosis and progressive deep ulceration on extravasation; cumulative dose-dependent cardiomyopathy and congestive heart failure.",
      management: "Extravasation Management: Apply cold/ice packs for 15–20 minutes 4 times daily for 48–72 hours.\nSpecific Antidote: Dexrazoxane (Totect/Savene) IV within 6 hours of extravasation (Day 1: 1000 mg/m², Day 2: 1000 mg/m², Day 3: 500 mg/m²).\nLifetime Cumulative Cap: Doxorubicin max 450–550 mg/m² (Epirubicin 900 mg/m²). Baseline and periodic 2D ECHO/MUGA required (maintain LVEF >= 50%)."
    },
    {
      id: "ifosfamide-cystitis",
      match: ["ifosfamide", "ifex", "cyclophosphamide", "cytoxan", "ac", "chop", "cvd"],
      drug: "Alkylators (Ifosfamide / Cyclophosphamide)",
      title: "Acrolein Hemorrhagic Cystitis & Ifosfamide Encephalopathy",
      symptoms: "Severe chemical hemorrhagic cystitis with gross hematuria and bladder ulceration; ifosfamide acute encephalopathy (somnolence, confusion, seizures).",
      management: "Mandatory Uroprotection: Mesna (sodium 2-mercaptoethanesulfonate) at 60–100% of total ifosfamide/cyclophosphamide dose (administered at 0, 4, and 8 hours post-chemo or continuous IV).\nHyperhydration: Normal Saline >= 3000 mL/m²/day; keep urine specific gravity < 0.010.\nIfosfamide Encephalopathy Antidote: Methylene Blue 50 mg IV every 4 hours (inhibits chloracetaldehyde metabolite formation)."
    },
    {
      id: "fluorouracil-dpd",
      match: ["5-fu", "fluorouracil", "capecitabine", "xeloda", "folfox", "folfiri", "folfirinox", "folfoxiri"],
      drug: "Fluoropyrimidines (5-FU / Capecitabine)",
      title: "Severe DPD Deficiency / Overdose & Coronary Vasospasm",
      symptoms: "Early life-threatening mucositis, bloody diarrhea, neutropenic sepsis (suggesting DPD deficiency); acute angina/coronary vasospasm during infusion; Palmar-Plantar Erythrodysesthesia (Hand-Foot syndrome).",
      management: "Specific Overdose / Toxic Antidote: Uridine Triacetate (Vistogard) 10 g orally every 6 hours for 20 doses (initiate within 96 hours of 5-FU/capecitabine).\nCoronary Vasospasm: Discontinue infusion immediately. Sublingual Nitroglycerin 0.4 mg + Diltiazem 30–60 mg PO.\nHand-Foot Syndrome: Pyridoxine (Vitamin B6) 50–100 mg PO TID + Urea 10–20% topical creams, avoid mechanical friction."
    },
    {
      id: "vincristine-fatality",
      match: ["vincristine", "oncovin", "vinblastine", "vinorelbine", "chop", "abvd", "cvd"],
      drug: "Vinca Alkaloids (Vincristine / Vinblastine)",
      title: "FATAL IF INTRATHECAL & Severe Paralytic Ileus / Neuropathy",
      symptoms: "FATAL ascending myeloencephalopathy if administered intrathecally. Severe constipation, paralytic ileus, sensorimotor neuropathy.",
      management: "CRITICAL SAFETY: NEVER administer intrathecally — dispense in a minibag IV infusion ONLY, NEVER in a syringe. Prominently label: 'FOR INTRAVENOUS USE ONLY - FATAL IF GIVEN BY OTHER ROUTES'.\nSingle-Dose Cap: Vincristine capped at 2.0 mg max per single dose to prevent paralytic ileus.\nExtravasation Management: Warm compress (NOT cold) + Hyaluronidase 150–1500 units SC around site."
    },
    {
      id: "methotrexate-rescue",
      match: ["methotrexate", "mtx"],
      drug: "High-Dose Methotrexate (HD-MTX)",
      title: "Delayed Tubular Precipitation & Severe Toxicities",
      symptoms: "Intratubular crystallization causing acute renal failure, delayed drug clearance, toxic pancytopenia, severe mucositis.",
      management: "Mandatory Leucovorin (Folinic Acid) Rescue: Start 24 hours post-MTX start (typically 15 mg q6h, titrated based on 24h, 48h, 72h MTX plasma levels until MTX < 0.05 mcmol/L).\nUrine Alkalinization: Vigorous hydration with Sodium Bicarbonate (maintain urine pH >= 7.0 and output > 100 mL/hr).\nAntidote for Delayed Clearance / Renal Failure: Glucarpidase (Voraxaze) 50 units/kg IV single dose (cleaves MTX to inactive DAMPA within 15 min)."
    },
    {
      id: "bleomycin-pulm",
      match: ["bleomycin", "bleo", "abvd", "beab"],
      drug: "Bleomycin",
      title: "Pulmonary Toxicity, Interstitial Pneumonitis & Hyperoxia Injury",
      symptoms: "Dry non-productive cough, exertional dyspnea, basilar rales, subacute progression to fatal pulmonary fibrosis.",
      management: "Cumulative Dose Cap: Lifetime limit 400 units (250 units in elderly or renal insufficiency). Monitor baseline and pre-cycle DLCO / PFTs.\nHyperoxia Warning: Keep FiO2 <= 30% during any future surgery/anesthesia to avoid triggering acute respiratory distress syndrome (ARDS)."
    },
    {
      id: "ici-irae",
      match: ["pembrolizumab", "keytruda", "nivolumab", "opdivo", "ipilimumab", "yervoy", "atezolizumab", "durvalumab"],
      drug: "Immune Checkpoint Inhibitors (ICIs)",
      title: "Immune-Related Adverse Events (irAEs: Colitis, Hepatitis, Pneumonitis)",
      symptoms: "Severe auto-immune inflammation: severe diarrhea/colitis, elevated transaminases (hepatitis), dyspnea/pneumonitis, hypophysitis with adrenal crisis.",
      management: "Grade 2 irAE: Withhold ICI; start oral Prednisone 0.5–1 mg/kg/day.\nGrade 3–4 irAE: Permanently discontinue therapy; start IV Methylprednisolone 1–2 mg/kg/day, slow taper over >= 4–6 weeks.\nSteroid-Refractory Colitis (>48h): Infliximab 5 mg/kg IV or Vedolizumab. (Caution: Avoid Infliximab in immune hepatitis; use Mycophenolate Mofetil 1 g PO BID instead)."
    },
    {
      id: "bortezomib-pn",
      match: ["bortezomib", "velcade", "vcd", "vrd"],
      drug: "Bortezomib",
      title: "Peripheral Neuropathy & Herpes Zoster Reactivation",
      symptoms: "Painful sensory peripheral neuropathy, orthostatic hypotension, localized herpes zoster (shingles) reactivation.",
      management: "Subcutaneous Administration: Administer Subcutaneously (SC) instead of IV (reduces grade >= 2 neuropathy from 41% to 24% with identical response rate).\nMandatory Antiviral Prophylaxis: Acyclovir 400 mg PO BID or Valacyclovir 500 mg PO daily throughout treatment and for 1 month post-completion."
    }
  ];

  function getRegimenToxicities(pr) {
    if (!pr) return [];
    var drugNames = asArr(pr.drugs).map(function (d) {
      return ((d.name || "") + " " + (d.id || "")).toLowerCase();
    }).join(" ");
    var protoName = ((pr.name || "") + " " + (pr.id || "")).toLowerCase();
    var allText = drugNames + " " + protoName;

    var matched = [];
    for (var i = 0; i < TOXICITY_CATALOG.length; i++) {
      var item = TOXICITY_CATALOG[i];
      var isHit = item.match.some(function (m) {
        return allText.indexOf(m.toLowerCase()) !== -1;
      });
      if (isHit) {
        matched.push(JSON.parse(JSON.stringify(item)));
      }
    }

    if (st.customToxicities && st.customToxicities.length) {
      matched = matched.concat(st.customToxicities);
    }

    return matched;
  }

  function toxicitiesHtml(isExport) {
    var pr = st.protocol || {};
    var list = getRegimenToxicities(pr);
    if (!list.length && isExport) return "";

    var activeList = list.filter(function (item) {
      return !st.disabledToxicities[item.id];
    });

    var itemsHtml = activeList.map(function (item) {
      var isCustom = !!item.custom;
      var delBtn = (!isExport && isCustom) ? (
        "<button type=\"button\" class=\"ps-linkbtn ps-danger-link ps-tox-del-btn\" data-ps-act=\"delete-custom-tox\" data-ps-tox-id=\"" + esc(item.id) + "\">" +
          ms("delete") + "<span>Remove</span>" +
        "</button>"
      ) : "";

      return "<div class=\"ps-tox-card ps-page-break-auto\">" +
        "<div class=\"ps-tox-card-h\">" +
          "<div class=\"ps-tox-drug\">" + ms("warning") + "<span>" + esc(item.drug || item.title) + "</span></div>" +
          "<div class=\"ps-tox-title\">" + esc(item.title) + "</div>" +
          delBtn +
        "</div>" +
        "<div class=\"ps-tox-symptoms\"><b>Expected Adverse Effects:</b> " + esc(item.symptoms) + "</div>" +
        "<div class=\"ps-tox-treatment\"><b>Emergency Management &amp; Antidotes:</b> " + esc(item.management).replace(/\n/g, "<br>") + "</div>" +
      "</div>";
    }).join("");

    var addToxBtn = isExport ? "" : (
      "<div class=\"ps-tox-actions\">" +
        "<button type=\"button\" class=\"ps-btn ghost ps-btn-sm\" data-ps-act=\"open-add-tox\">" +
          ms("add_moderator") + "<span>Add Custom Adverse Effect &amp; Antidote Protocol</span>" +
        "</button>" +
      "</div>"
    );

    return "<section class=\"ps-block ps-tox-section ps-page-break-auto\">" +
      "<div class=\"ps-block-h ps-tox-header\">" +
        "<span>Expected Adverse Effects &amp; Acute Toxicity Management / Antidotes</span>" +
      "</div >" +
      (itemsHtml || "<div class=\"ps-tox-empty\">No specific high-grade antidote triggers detected for this regimen. Standard supportive emesis and hydration guidelines apply.</div>") +
      addToxBtn +
    "</section>";
  }

  // ---- MULTILINGUAL ORAL MEDICATION INSTRUCTIONS ------------------------------------------------
  var ORAL_INSTRUCTIONS = {
    en: {
      name: "English (Mandatory)",
      swallow: "Swallow tablets/capsules whole with a full glass of water. Do NOT crush, chew, open, or break tablets.",
      timing: "Take at the exact scheduled time with meals or as directed by your oncologist.",
      handling: "Wash hands thoroughly with soap and water immediately after touching chemotherapy pills. Caregivers should wear disposable gloves. Never handle if pregnant.",
      missed: "If a dose is missed or vomited, do NOT take an extra or double dose. Wait and take the next scheduled dose as planned.",
      storage: "Store in original blister pack at room temperature away from moisture, heat, and direct sunlight. Keep strictly out of reach of children.",
      warning: "Contact emergency oncology immediately if you develop fever (>= 100.4°F / 38°C), severe diarrhea, chest pain, or vomiting."
    },
    te: {
      name: "Telugu (తెలుగు)",
      swallow: "మాత్రలను నమలకుండా, పగలగొట్టకుండా లేదా పొడి చేయకుండా పూర్తి గ్లాసు నీటితో మింగండి.",
      timing: "వైద్యులు సూచించిన నిర్దిష్ట సమయంలో, ఆహారం తీసుకున్న తర్వాత మాత్రమే వేసుకోండి.",
      handling: "మందులు వేసుకున్న వెంటనే చేతులను సబ్బుతో శుభ్రంగా కడుక్కోండి. సహాయకులు డిస్పోజబుల్ గ్లౌజులు ధరించాలి. గర్భిణీ స్త్రీలు ఈ మాత్రలను తాకకూడదు.",
      missed: "ఒకవేళ డోస్ మరచిపోయినా లేదా వాంతి అయినా, అదనంగా లేదా డబుల్ డోస్ తీసుకోకండి. తదుపరి షెడ్యూల్ చేసిన సమయంలో సాధారణ డోస్ మాత్రమే తీసుకోండి.",
      storage: "మాత్రలను పిల్లలకు అందకుండా, ఎండ మరియు తేమ తగలకుండా గది ఉష్ణోగ్రత వద్ద భద్రపరచండి.",
      warning: "తీవ్రమైన జ్వరం (100.4°F పైన), ఆగని విరేచనాలు, వాంతులు లేదా గుండె నొప్పి వస్తే వెంటనే ఆసుపత్రికి వెళ్లండి."
    },
    ta: {
      name: "Tamil (தமிழ்)",
      swallow: "மாத்திரைகளை மெல்லவோ, உடைக்கவோ அல்லது தூளாக்கவோ வேண்டாம். முழு டம்ளர் தண்ணீருடன் அப்படியே விழுங்கவும்.",
      timing: "மருத்துவர் குறிப்பிட்ட சரியான நேரத்தில், உணவுக்குப் பிறகு உட்கொள்ளவும்.",
      handling: "மாத்திரைகளைத் தொட்ட பிறகு கைகளை சோப்பு போட்டு நன்றாகக் கழுவவும். உதவியாளர்கள் கையுறைகளை அணிய வேண்டும். கர்ப்பிணிப் பெண்கள் இந்த மருந்துகளைத் தொடக்கூடாது.",
      missed: "ஒரு வேளை மருந்தை மறந்துவிட்டாலோ அல்லது வாந்தி எடுத்தாலோ, கூடுதல் அல்லது இரட்டை மாத்திரை சாப்பிட வேண்டாம். அடுத்த வேளைக்கான மாத்திரையை வழக்கம்போல் எடுக்கவும்.",
      storage: "மாத்திரைகளை குழந்தைகளின் கைகளுக்கு எட்டாதவாறு, நேரடி வெயில் படாமல் அறை வெப்பநிலையில் வைக்கவும்.",
      warning: "காய்ச்சல் (100.4°F மேல்), கடுமையான வயிற்றுப்போக்கு அல்லது நெஞ்சுவலி ஏற்பட்டால் உடனடியாக மருத்துவமனைக்குத் தொடர்பு கொள்ளவும்."
    },
    kn: {
      name: "Kannada (ಕನ್ನಡ)",
      swallow: "ಮಾತ್ರೆಗಳನ್ನು ಅಗಿಯಬೇಡಿ, ಮುರಿಯಬೇಡಿ ಅಥವಾ ಪುಡಿಮಾಡಬೇಡಿ. ಪೂರ್ಣ ಲೋಟ ನೀರಿನೊಂದಿಗೆ ನುಂಗಿರಿ.",
      timing: "ವೈದ್ಯರು ಸೂಚಿಸಿದ ನಿಗದಿತ ಸಮಯದಲ್ಲಿ, ಊಟದ ನಂತರ ಮಾತ್ರ ತೆಗೆದುಕೊಳ್ಳಿ.",
      handling: "ಮಾತ್ರೆಗಳನ್ನು ಮುಟ್ಟಿದ ನಂತರ ಕೈಗಳನ್ನು ಸಾಬೂನಿನಿಂದ ಸ್ವಚ್ಛವಾಗಿ ತೊಳೆಯಿರಿ. ಆರೈಕೆದಾರರು ಕೈಗವಸುಗಳನ್ನು (ಗ್ಲೌಸ್) ಧರಿಸಬೇಕು. ಗರ್ಭಿಣಿಯರು ಈ ಮಾತ್ರೆಗಳನ್ನು ಮುಟ್ಟಬಾರದು.",
      missed: "ಒಂದು ವೇಳೆ ಡೋಸ್ ತಪ್ಪಿಹೋದರೆ ಅಥವಾ ವಾಂತಿಯಾದರೆ, ಹೆಚ್ಚುವರಿ ಅಥವಾ ಡಬಲ್ ಡೋಸ್ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ. ಮುಂದಿನ ನಿಗದಿತ ಸಮಯದಲ್ಲಿ ಮಾತ್ರ ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ.",
      storage: "ಮಾತ್ರೆಗಳನ್ನು ಮಕ್ಕಳ ಕೈಗೆ ಸಿಗದಂತೆ, ತೇವಾಂಶ ಮತ್ತು ಬಿಸಿಲು ತಾಗದಂತೆ ಕೋಣೆಯ ಉಷ್ಣಾಂಶದಲ್ಲಿ ಸಂಗ್ರಹಿಸಿ.",
      warning: "ವಿಪರೀತ ಜ್ವರ (100.4°F ಗಿಂತ ಹೆಚ್ಚು), ನಿಲ್ಲದ ಭೇದಿ ಅಥವಾ ಎದೆನೋವು ಕಾಣಿಸಿಕೊಂಡರೆ ತಕ್ಷಣ ಆಸ್ಪತ್ರೆಗೆ ಭೇಟಿ ನೀಡಿ."
    },
    hi: {
      name: "Hindi (हिन्दी)",
      swallow: "गोलियों को चबाएं, तोड़ें या क्रश न करें। पूरे एक गिलास पानी के साथ पूरी गोली निगलें।",
      timing: "डॉक्टर द्वारा बताए गए सही समय पर, भोजन के बाद ही लें।",
      handling: "दवा लेने के तुरंत बाद अपने हाथों को साबुन और पानी से अच्छी तरह धोएं। तीमारदार डिस्पोजेबल दस्ताने पहनें। गर्भवती महिलाएं इन गोलियों को न छुएं।",
      missed: "यदि कोई खुराक छूट जाए या उल्टी हो जाए, तो कभी भी अतिरिक्त या डबल खुराक न लें। अगली निर्धारित खुराक का समय होने पर सामान्य रूप से दवा लें।",
      storage: "दवा को बच्चों की पहुंच से दूर, धूप और नमी से बचाकर कमरे के तापमान पर रखें।",
      warning: "यदि तेज बुखार (100.4°F / 38°C से अधिक), अत्यधिक दस्त, सीने में दर्द या लगातार उल्टी हो, तो तुरंत ऑन्कोलॉजिस्ट से संपर्क करें।"
    },
    ml: {
      name: "Malayalam (മലയാളം)",
      swallow: "ഗുളികകൾ ചവച്ചരയ്ക്കാനോ, പൊട്ടിക്കാനോ പാടില്ല. ഒരു ഗ്ലാസ്സ് വെള്ളത്തോടൊപ്പം വിഴുങ്ങുക.",
      timing: "ഡോക്ടർ നിർദ്ദേശിച്ച കൃത്യസമയത്ത്, ഭക്ഷണത്തിന് ശേഷം മാത്രം കഴിക്കുക.",
      handling: "ഗുളികകൾ എടുത്ത ശേഷം കൈകൾ സോപ്പും വെള്ളവും ഉപയോഗിച്ച് നന്നായി കഴുകുക. പരിചാരകർ ഗ്ലൗസ് ധരിക്കണം. ഗർഭിണികൾ ഈ മരുന്നുകൾ തൊടരുത്.",
      missed: "ഒരു ഡോസ് കഴിക്കാൻ മറന്നുപോവുകയോ ഛർദ്ദിക്കുകയോ ചെയ്താൽ ഇരട്ടി ഡോസ് കഴിക്കരുത്. അടുത്ത നിശ്ചിത സമയത്ത് സാധാരണ ഡോസ് മാത്രം കഴിക്കുക.",
      storage: "കുട്ടികൾക്ക് ലഭിക്കാത്ത വിധത്തിലും, ചൂടും വെയിലും ഏൽക്കാത്ത വിധത്തിലും ഊഷ്മാവിൽ സൂക്ഷിക്കുക.",
      warning: "കഠിനമായ പനി (100.4°F-ന് മുകളിൽ), അതിസാരം, അല്ലെങ്കിൽ നെഞ്ചുവേദന ഉണ്ടായാൽ ഉടൻ തന്നെ ആശുപത്രിയുമായി ബന്ധപ്പെടുക."
    }
  };

  function hasOralMedications(pr) {
    if (!pr) return false;
    var oralRegex = /capecitabine|temozolomide|olaparib|osimertinib|abiraterone|enzalutamide|palbociclib|ribociclib|imatinib|dasatinib|nilotinib|lenalidomide|pomalidomide|thalidomide|sunitinib|sorafenib|regorafenib|erlotinib|gefitinib|afatinib|lapatinib|tamoxifen|anastrozole|letrozole|exemestane|etoposide oral|cyclophosphamide oral/i;
    var drugs = asArr(pr.drugs);
    for (var i = 0; i < drugs.length; i++) {
      var d = drugs[i];
      var r = String(d.route || "").toLowerCase();
      if (r === "oral" || r === "po" || d.basis === "po" || oralRegex.test(d.name || d.id || "")) return true;
    }
    var allItems = asArr(pr.premedications).concat(asArr(pr.supportiveCare));
    for (var j = 0; j < allItems.length; j++) {
      var itemStr = String(typeof allItems[j] === "object" ? (allItems[j].name || allItems[j].notes || "") : allItems[j]).toLowerCase();
      if (itemStr.indexOf("po") !== -1 || itemStr.indexOf("oral") !== -1 || itemStr.indexOf("tablet") !== -1 || itemStr.indexOf("capsule") !== -1) {
        return true;
      }
    }
    return false;
  }

  function oralInstructionsHtml(isExport) {
    var pr = st.protocol || {};
    var isOral = hasOralMedications(pr) || st.includeOralInstructions;
    if (!isOral && isExport) return "";

    var en = ORAL_INSTRUCTIONS.en;
    var regionalKey = st.oralLang && st.oralLang !== "en" ? st.oralLang : null;
    var reg = regionalKey ? ORAL_INSTRUCTIONS[regionalKey] : null;

    var langButtons = isExport ? "" : (
      "<div class=\"ps-lang-picker\">" +
        "<span class=\"ps-lang-lbl\">Regional Indian Language:</span>" +
        ["en", "te", "ta", "kn", "hi", "ml"].map(function (key) {
          var active = st.oralLang === key;
          var label = key === "en" ? "English Only" : ORAL_INSTRUCTIONS[key].name;
          return "<button type=\"button\" class=\"ps-lang-btn" + (active ? " active" : "") + "\" data-ps-act=\"select-oral-lang\" data-ps-lang=\"" + key + "\">" +
            esc(label) +
          "</button>";
        }).join("") +
      "</div>"
    );

    return "<section class=\"ps-block ps-oral-card ps-page-break-auto\">" +
      "<div class=\"ps-block-h ps-oral-header\">" +
        "<span>Oral Medication &amp; Patient Administration Instructions</span>" +
        langButtons +
      "</div>" +
      "<div class=\"ps-oral-grid" + (reg ? " ps-oral-bilingual" : "") + "\">" +
        "<div class=\"ps-oral-col\">" +
          "<div class=\"ps-oral-lang-title\">" + ms("language") + " English (Mandatory Instructions)</div>" +
          "<ul class=\"ps-oral-list\">" +
            "<li><b>Swallowing:</b> " + esc(en.swallow) + "</li>" +
            "<li><b>Meal Timing:</b> " + esc(en.timing) + "</li>" +
            "<li><b>Safe Handling:</b> " + esc(en.handling) + "</li>" +
            "<li><b>Missed Doses:</b> " + esc(en.missed) + "</li>" +
            "<li><b>Safe Storage:</b> " + esc(en.storage) + "</li>" +
            "<li class=\"ps-oral-alert\"><b>Emergency:</b> " + esc(en.warning) + "</li>" +
          "</ul>" +
        "</div>" +
        (reg ? (
          "<div class=\"ps-oral-col ps-oral-regional\">" +
            "<div class=\"ps-oral-lang-title\">" + ms("translate") + " " + esc(reg.name) + "</div>" +
            "<ul class=\"ps-oral-list\">" +
              "<li><b>సూచనలు / வழிமுறை:</b> " + esc(reg.swallow) + "</li>" +
              "<li><b>సమయం మరియు ఆహారం:</b> " + esc(reg.timing) + "</li>" +
              "<li><b>సురక్షిత నిర్వహణ:</b> " + esc(reg.handling) + "</li>" +
              "<li><b>డోస్ మరచిపోతే:</b> " + esc(reg.missed) + "</li>" +
              "<li><b>నిల్వ ఉంచే విధానం:</b> " + esc(reg.storage) + "</li>" +
              "<li class=\"ps-oral-alert\"><b>అత్యవసర హెచ్చరిక:</b> " + esc(reg.warning) + "</li>" +
            "</ul>" +
          "</div>"
        ) : "") +
      "</div>" +
    "</section>";
  }

  // ---- DOCTOR CLINICAL NOTES & SPECIFIC ORDERS ---------------------------------------------------
  function doctorNotesHtml(isExport) {
    if (isExport && !st.includeDoctorNotesInPrint) return "";
    if (isExport && !st.doctorNotes.trim()) return "";

    var chips = [
      "+ PICC / Chemoport Infusion (0.22 micron filter)",
      "+ Check CBC with diff on Day 10 Nadir",
      "+ Pre-hydration 1000 mL Normal Saline over 2h",
      "+ G-CSF (Filgrastim 300mcg) support on Day 3",
      "+ 20% Dose Reduction Applied for Prior Toxicity",
      "+ Triple Antiemetic Prophylaxis Prescribed"
    ];

    var chipsHtml = isExport ? "" : (
      "<div class=\"ps-note-chips\">" +
        chips.map(function (c) {
          return "<button type=\"button\" class=\"ps-note-chip\" data-ps-act=\"insert-note-chip\" data-ps-chip=\"" + esc(c) + "\">" +
            esc(c) +
          "</button>";
        }).join("") +
      "</div>"
    );

    var editorHtml = isExport ?
      ("<div class=\"ps-note-display\">" + esc(st.doctorNotes).replace(/\n/g, "<br>") + "</div>") :
      ("<textarea class=\"ps-note-textarea\" data-ps-act=\"doc-notes-input\" placeholder=\"Type specific clinical instructions, nadir lab checks, PICC line care, hydration or dose modification rationale...\">" + esc(st.doctorNotes) + "</textarea>" +
       "<div class=\"ps-note-footer\">" +
         "<label class=\"ps-note-toggle\"><input type=\"checkbox\" data-ps-act=\"toggle-print-notes\"" + (st.includeDoctorNotesInPrint ? " checked" : "") + "> <span>Include Doctor Notes on Printed Sheet</span></label>" +
       "</div>");

    return "<section class=\"ps-block ps-doctor-notes-card ps-page-break-auto\">" +
      "<div class=\"ps-block-h ps-doc-notes-h\">" +
        "<span>Prescribing Oncologist Clinical Notes &amp; Special Orders</span>" +
      "</div>" +
      chipsHtml +
      editorHtml +
    "</section>";
  }

  // ---- SIGNATURES & DOUBLE-CHECK ----------------------------------------------------------------
  function sigHtml(isExport) {
    var p = st.patient || {};
    var hasSig = !!st.sig;
    var sigCanvasOrImg = "";
    if (isExport) {
      if (hasSig) {
        sigCanvasOrImg = "<div class=\"ps-sig-export-wrap\"><img src=\"" + st.sig + "\" class=\"ps-sig-img\" alt=\"Consultant Signature\" style=\"max-height:80px;display:block;\"><div class=\"ps-sig-verified-tag\">" + ms("verified") + " Digitally Signed &amp; Verified</div></div>";
      } else {
        sigCanvasOrImg = "<div class=\"ps-sig-line-placeholder\"><div class=\"ps-sig-line\"></div><div class=\"ps-sig-line-lbl\">Signature of Prescribing Medical Oncologist</div></div>";
      }
    } else {
      sigCanvasOrImg = "<canvas id=\"psSig\" width=\"600\" height=\"150\"></canvas>" +
        "<div class=\"ps-sig-actions\"><button class=\"ps-linkbtn\" data-ps-act=\"sig-clear\">" + ms("ink_eraser") + "Clear signature</button></div>" +
        "<div class=\"ps-sig-label\">Consultant signature - dose verified</div>";
    }

    return "<div class=\"ps-signatures ps-page-break-auto\">" +
      "<div class=\"ps-sig-block\">" +
        "<div class=\"ps-sig-block-h\">Primary Prescribing Oncologist Verification</div>" +
        "<div class=\"ps-sig-row\">" +
          "<div class=\"ps-sig-pad\">" + sigCanvasOrImg + "</div>" +
          "<div class=\"ps-sig-meta\">" +
            "<div class=\"ps-f\"><span>Consultant</span><b>" + esc(p.consultant || "-") + "</b></div>" +
            "<div class=\"ps-f\"><span>Date</span><b>" + esc((st.ctx && st.ctx.today) || "") + "</b></div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      "<div class=\"ps-sig-block ps-sig-second-checker\">" +
        "<div class=\"ps-sig-block-h\">Independent Double-Check (Oncology Pharmacist / Second Checker)</div>" +
        "<div class=\"ps-checker-row\">" +
          "<div class=\"ps-checker-items\">" +
            "<span>[ ] Patient ID &amp; Diagnosis Verified</span>" +
            "<span>[ ] Auto BSA / CrCl Verified</span>" +
            "<span>[ ] Drug Doses &amp; Route Verified</span>" +
            "<span>[ ] Premedications &amp; Hydration Verified</span>" +
          "</div>" +
          "<div class=\"ps-checker-sig\">" +
            "<div class=\"ps-sig-line\"></div>" +
            "<div class=\"ps-sig-line-lbl\">Pharmacist / Registered Nurse Signature &amp; Date</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  // ---- PRINT FOOTER & MEDICOLEGAL DISCLAIMER ----------------------------------------------------
  function printFooterHtml() {
    return "<div class=\"ps-foot ps-foot-print ps-page-break-auto\">" +
      "<div class=\"ps-foot-brand\">" +
        "<div class=\"ps-foot-logo\">" +
          "<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m4.93 4.93 4.24 4.24\"/><path d=\"m14.83 9.17 4.24-4.24\"/><path d=\"m14.83 14.83 4.24 4.24\"/><path d=\"m9.17 14.83-4.24 4.24\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/></svg>" +
        "</div>" +
        "<div class=\"ps-foot-brandtext\">" +
          "<b>Made using StewardMD Oncology Clinical Care</b>" +
          "<span>Clinical Decision Support &amp; Order Verification Platform (https://stewardmd.com)</span>" +
        "</div>" +
      "</div>" +
      "<div class=\"ps-foot-disclaimer\">" +
        "<b>MEDICOLEGAL DISCLAIMER:</b> This chemotherapy treatment protocol calculation sheet is generated strictly for clinical decision support and verification by authorized healthcare professionals. It does NOT constitute an independent medical prescription, automated dispensing order, or substitute for professional clinical judgment. The prescribing medical oncologist, reviewing oncology clinical pharmacist, and administering oncology nurse remain solely and non-delegably responsible for independently verifying all patient vitals, body surface area (BSA), renal function (CrCl), organ clearance, drug identities, calculated doses, cumulative toxicities, dilution volumes, compatibility, premedications, and infusion schedules prior to compounding or patient administration. StewardMD and its contributors accept no liability for clinical outcomes, dosage adjustments, or administration errors." +
      "</div>" +
      "<div class=\"ps-foot-meta\">Generated via StewardMD OncoTree &bull; Adheres to ASCO / ONS Chemotherapy Administration Safety Standards &bull; Confidential Medical Record</div>" +
    "</div>";
  }

  function isBigProtocol(pr) {
    if (!pr) return false;
    var numDrugs = asArr(pr.drugs).length;
    var numPre = asArr(pr.premedications).length;
    var hasTox = getRegimenToxicities(pr).length > 0;
    var hasOral = hasOralMedications(pr);
    var hasNotes = !!(st.doctorNotes && st.doctorNotes.trim() && st.includeDoctorNotesInPrint);
    return numDrugs > 2 || (numDrugs >= 2 && (numPre > 1 || hasTox || hasOral || hasNotes));
  }

  function sheetHtml(isExport) {
    var pr = st.protocol || {};
    var big = isBigProtocol(pr);
    var inst = getInstitution();
    var p = st.patient || {};

    var page2RunningHeader = (isExport && big) ? (
      "<div class=\"ps-page2-header\">" +
        "<span class=\"ps-page2-inst\">" + esc(inst.name) + " &bull; " + esc(inst.dept || "Oncology") + "</span>" +
        "<span class=\"ps-page2-meta\">" + esc(pr.name || "Treatment Protocol") + " &bull; Pt: " + esc(p.name || "Patient") + (p.mrn ? " (" + esc(p.mrn) + ")" : "") + " &bull; Page 2 of 2</span>" +
      "</div>"
    ) : "";

    return "<div class=\"ps-sheet" + (isExport ? " ps-sheet-export" : "") + "\" id=\"psSheet\">" +
      headerHtml(isExport) +
      "<div class=\"ps-warns-container\">" + warningsHtml() + "</div>" +
      "<div class=\"ps-tablewrap-container\">" + tableHtml(isExport) + "</div>" +
      listBlock("Premedications & Hydration", asArr(pr.premedications)) +
      (big ? "<div class=\"ps-page-break-deliberate\"></div>" + page2RunningHeader : "") +
      listBlock("Supportive Care & Emesis Prophylaxis", asArr(pr.supportiveCare)) +
      listBlock("Monitoring & Lab Safety Parameters", asArr(pr.monitoring)) +
      toxicitiesHtml(isExport) +
      oralInstructionsHtml(isExport) +
      doctorNotesHtml(isExport) +
      (pr.specialInstructions ? "<div class=\"ps-block ps-page-break-auto\"><div class=\"ps-block-h\">Special Instructions / Administration Pearls</div><p>" + esc(pr.specialInstructions) + "</p></div>" : "") +
      sigHtml(isExport) +
      printFooterHtml() +
    "</div>";
  }

  // ---- MODAL SHELLS (DOSE EDIT, ADD DRUG, BRANDING, ADD TOXICITY) --------------------------------
  function doseEditModalHtml() {
    if (!st.activeDoseEditModal) return "";
    var did = st.activeDoseEditModal;
    var pr = st.protocol || {};
    var drug = asArr(pr.drugs).find(function (d) { return d.id === did; });
    if (!drug) return "";
    var row = drugRow(drug);
    var ov = st.overrides[did] || {};
    var currentDose = ov.customDoseMg != null ? ov.customDoseMg : (row.origTotal != null ? round2(row.origTotal) : (row.total != null ? round2(row.total) : ""));
    var baseDose = row.origTotal != null ? round2(row.origTotal) : (row.total != null ? round2(row.total) : (drug.basis === "flat" && num(drug.dosePerUnit) ? num(drug.dosePerUnit) : null));

    return "<div class=\"ps-modal-backdrop\" data-ps-act=\"close-dose-modal\">" +
      "<div class=\"ps-modal-card\">" +
        "<div class=\"ps-modal-h\">" +
          "<div class=\"ps-modal-title\">" + ms("tune") + " <span>Adjust Dosage: " + esc(row.name) + "</span></div>" +
          "<button type=\"button\" class=\"ps-modal-close\" data-ps-act=\"close-dose-modal\">" + ms("close") + "</button>" +
        "</div>" +
        "<div class=\"ps-modal-body\">" +
          "<div class=\"ps-modal-info\">" +
            "<div>Standard calculated dose: <b>" + esc(row.origTotalTxt || "Variable") + "</b> (" + esc(row.perUnit) + ")</div>" +
            (row.basis === "auc" ? "<div class=\"ps-modal-subinfo\">Calvert AUC Formula based on Cockcroft-Gault CrCl</div>" : "") +
          "</div>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Doctor Adjusted Total Dose (mg)</span>" +
            "<input type=\"number\" id=\"psCustomDoseInput\" step=\"0.1\" value=\"" + esc(currentDose) + "\" placeholder=\"e.g. 240\">" +
          "</label>" +
          (baseDose ? (
            "<div class=\"ps-quick-pct-row\">" +
              "<span class=\"ps-quick-lbl\">Quick reductions:</span>" +
              "<button type=\"button\" class=\"ps-pct-btn\" data-ps-act=\"quick-dose-pct\" data-ps-pct=\"0.9\">-10% (" + round2(baseDose * 0.9) + " mg)</button>" +
              "<button type=\"button\" class=\"ps-pct-btn\" data-ps-act=\"quick-dose-pct\" data-ps-pct=\"0.8\">-20% (" + round2(baseDose * 0.8) + " mg)</button>" +
              "<button type=\"button\" class=\"ps-pct-btn\" data-ps-act=\"quick-dose-pct\" data-ps-pct=\"0.75\">-25% (" + round2(baseDose * 0.75) + " mg)</button>" +
            "</div>"
          ) : "") +
          "<label class=\"ps-modal-label\">" +
            "<span>Clinical Reason for Adjustment</span>" +
            "<input type=\"text\" id=\"psCustomDoseReason\" value=\"" + esc(ov.reason || "") + "\" placeholder=\"e.g. 20% dose reduction due to febrile neutropenia / renal impairment\">" +
          "</label>" +
          "<div class=\"ps-quick-reasons\">" +
            ["Prior Febrile Neutropenia", "Renal Impairment Modification", "Hepatic Transaminase Elevation", "Elderly / Poor ECOG PS", "Peripheral Neuropathy G2+"].map(function (rs) {
              return "<button type=\"button\" class=\"ps-reason-chip\" data-ps-act=\"quick-reason-chip\" data-ps-reason=\"" + esc(rs) + "\">" + esc(rs) + "</button>";
            }).join("") +
          "</div>" +
        "</div>" +
        "<div class=\"ps-modal-foot\">" +
          "<button type=\"button\" class=\"ps-btn ghost\" data-ps-act=\"reset-drug-dose\">Reset to Standard</button>" +
          "<button type=\"button\" class=\"ps-btn primary\" data-ps-act=\"save-drug-dose\">Save Adjustment</button>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function addDrugModalHtml() {
    if (!st.showAddDrugModal) return "";
    return "<div class=\"ps-modal-backdrop\" data-ps-act=\"close-add-drug\">" +
      "<div class=\"ps-modal-card\">" +
        "<div class=\"ps-modal-h\">" +
          "<div class=\"ps-modal-title\">" + ms("add_circle") + " <span>Add Drug to Regimen</span></div>" +
          "<button type=\"button\" class=\"ps-modal-close\" data-ps-act=\"close-add-drug\">" + ms("close") + "</button>" +
        "</div>" +
        "<div class=\"ps-modal-body\">" +
          "<label class=\"ps-modal-label\">" +
            "<span>Drug / Medication Name</span>" +
            "<input type=\"text\" id=\"psNewDrugName\" placeholder=\"e.g. Mesna, Filgrastim, Mannitol, Pembrolizumab\">" +
          "</label>" +
          "<div class=\"ps-modal-grid-2\">" +
            "<label class=\"ps-modal-label\">" +
              "<span>Dose Value</span>" +
              "<input type=\"number\" id=\"psNewDrugDose\" step=\"any\" placeholder=\"e.g. 400\">" +
            "</label>" +
            "<label class=\"ps-modal-label\">" +
              "<span>Unit</span>" +
              "<select id=\"psNewDrugUnit\">" +
                "<option value=\"mg\">mg</option>" +
                "<option value=\"mg/m2\" selected>mg/m²</option>" +
                "<option value=\"mg/kg\">mg/kg</option>" +
                "<option value=\"AUC\">AUC</option>" +
                "<option value=\"units\">units</option>" +
                "<option value=\"mcg\">mcg</option>" +
              "</select>" +
            "</label>" +
          "</div>" +
          "<div class=\"ps-modal-grid-2\">" +
            "<label class=\"ps-modal-label\">" +
              "<span>Dosing Basis</span>" +
              "<select id=\"psNewDrugBasis\">" +
                "<option value=\"bsa\" selected>BSA (mg/m²)</option>" +
                "<option value=\"flat\">Flat / Fixed Dose (mg)</option>" +
                "<option value=\"mgkg\">Weight-based (mg/kg)</option>" +
                "<option value=\"auc\">Calvert AUC (CrCl)</option>" +
              "</select>" +
            "</label>" +
            "<label class=\"ps-modal-label\">" +
              "<span>Route of Administration</span>" +
              "<select id=\"psNewDrugRoute\">" +
                "<option value=\"IV Infusion\" selected>IV Infusion</option>" +
                "<option value=\"IV Bolus\">IV Bolus</option>" +
                "<option value=\"Oral\">Oral (PO)</option>" +
                "<option value=\"Subcutaneous\">Subcutaneous (SC)</option>" +
                "<option value=\"Intramuscular\">Intramuscular (IM)</option>" +
              "</select>" +
            "</label>" +
          "</div>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Cycle Days (comma separated)</span>" +
            "<input type=\"text\" id=\"psNewDrugDays\" value=\"1\" placeholder=\"e.g. 1 or 1, 8 or 1-14\">" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Special Administration Notes</span>" +
            "<input type=\"text\" id=\"psNewDrugNotes\" placeholder=\"e.g. Administer at 0, 4, 8 hours after chemotherapy\">" +
          "</label>" +
        "</div>" +
        "<div class=\"ps-modal-foot\">" +
          "<button type=\"button\" class=\"ps-btn ghost\" data-ps-act=\"close-add-drug\">Cancel</button>" +
          "<button type=\"button\" class=\"ps-btn primary\" data-ps-act=\"save-add-drug\">Add Medication</button>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function brandingModalHtml() {
    if (!st.showBrandingModal) return "";
    var inst = getInstitution();
    var currentLogo = st.tempLogoDataUrl || inst.logoDataUrl;

    return "<div class=\"ps-modal-backdrop\" data-ps-act=\"close-branding\">" +
      "<div class=\"ps-modal-card\">" +
        "<div class=\"ps-modal-h\">" +
          "<div class=\"ps-modal-title\">" + ms("local_hospital") + " <span>Customize Hospital &amp; Logo</span></div>" +
          "<button type=\"button\" class=\"ps-modal-close\" data-ps-act=\"close-branding\">" + ms("close") + "</button>" +
        "</div>" +
        "<div class=\"ps-modal-body\">" +
          "<label class=\"ps-modal-label\">" +
            "<span>Hospital / Cancer Centre Name</span>" +
            "<input type=\"text\" id=\"psBrandName\" value=\"" + esc(inst.name) + "\" placeholder=\"e.g. Apollo Cancer Centres / Tata Memorial\">" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Department / Division</span>" +
            "<input type=\"text\" id=\"psBrandDept\" value=\"" + esc(inst.dept) + "\" placeholder=\"e.g. Department of Medical Oncology &amp; Hematology\">" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Document Subtitle / Line</span>" +
            "<input type=\"text\" id=\"psBrandLine\" value=\"" + esc(inst.line) + "\" placeholder=\"e.g. Chemotherapy Treatment Protocol &amp; Order Verification Sheet\">" +
          "</label>" +
          "<div class=\"ps-brand-logo-section\">" +
            "<span class=\"ps-modal-label-span\">Hospital Logo</span>" +
            "<div class=\"ps-brand-logo-preview-wrap\">" +
              (currentLogo ?
                ("<img src=\"" + esc(currentLogo) + "\" class=\"ps-brand-logo-preview\" alt=\"Hospital Logo Preview\">" +
                 "<button type=\"button\" class=\"ps-linkbtn ps-danger-link\" data-ps-act=\"clear-brand-logo\">" + ms("delete") + " Clear Logo</button>") :
                ("<div class=\"ps-brand-logo-placeholder\">" + ms("add_photo_alternate") + "<span>No logo uploaded (default icon will be used)</span></div>")
              ) +
            "</div>" +
            "<div class=\"ps-brand-logo-upload-wrap\">" +
              "<input type=\"file\" id=\"psBrandLogoFile\" accept=\"image/*\" class=\"ps-file-input\">" +
              "<label for=\"psBrandLogoFile\" class=\"ps-btn ghost ps-btn-sm\">" + ms("upload_file") + "<span>Upload Logo File (PNG/JPG)</span></label>" +
            "</div>" +
          "</div>" +
        "</div>" +
        "<div class=\"ps-modal-foot\">" +
          "<button type=\"button\" class=\"ps-btn ghost\" data-ps-act=\"reset-branding\">Reset to Default</button>" +
          "<button type=\"button\" class=\"ps-btn primary\" data-ps-act=\"save-branding\">Save &amp; Apply</button>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function addToxModalHtml() {
    if (!st.showAddToxModal) return "";
    return "<div class=\"ps-modal-backdrop\" data-ps-act=\"close-add-tox\">" +
      "<div class=\"ps-modal-card\">" +
        "<div class=\"ps-modal-h\">" +
          "<div class=\"ps-modal-title\">" + ms("add_moderator") + " <span>Add Custom Adverse Effect &amp; Antidote</span></div>" +
          "<button type=\"button\" class=\"ps-modal-close\" data-ps-act=\"close-add-tox\">" + ms("close") + "</button>" +
        "</div>" +
        "<div class=\"ps-modal-body\">" +
          "<label class=\"ps-modal-label\">" +
            "<span>Associated Drug</span>" +
            "<input type=\"text\" id=\"psNewToxDrug\" placeholder=\"e.g. Irinotecan, Taxanes, Cisplatin, Immunotherapy\">" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Toxicity / Syndrome Name</span>" +
            "<input type=\"text\" id=\"psNewToxTitle\" placeholder=\"e.g. Acute Cholinergic Syndrome, Vesicant Ulceration\">" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Expected Clinical Symptoms</span>" +
            "<textarea id=\"psNewToxSymptoms\" placeholder=\"e.g. Diaphoresis, abdominal cramps, early diarrhea, miosis...\"></textarea>" +
          "</label>" +
          "<label class=\"ps-modal-label\">" +
            "<span>Emergency Management Protocol &amp; Antidotes</span>" +
            "<textarea id=\"psNewToxTreatment\" placeholder=\"e.g. Atropine 0.25-1.0 mg IV/SC immediately; repeat if needed...\"></textarea>" +
          "</label>" +
        "</div>" +
        "<div class=\"ps-modal-foot\">" +
          "<button type=\"button\" class=\"ps-btn ghost\" data-ps-act=\"close-add-tox\">Cancel</button>" +
          "<button type=\"button\" class=\"ps-btn primary\" data-ps-act=\"save-add-tox\">Add Adverse Effect</button>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function shellHtml() {
    var pr = st.protocol;
    if (!pr) return "<div class=\"ps-loading\">" + ms("progress_activity") + "Loading protocol...</div>";
    return "<div class=\"ps-wrap\">" +
      "<header class=\"ps-header\">" +
        "<button class=\"ps-hbtn\" data-ps-act=\"close\" aria-label=\"Back\">" + ms("arrow_back") + "</button>" +
        "<div class=\"ps-htitle\"><span class=\"ps-hkicker\">Protocol sheet</span><span class=\"ps-hname\">" + esc(pr.name || "") + "</span></div>" +
        "<button class=\"ps-hbtn ps-hbtn-emr\" data-ps-act=\"wardsync-fetch\" title=\"Fetch from WardSync EMR\">" + ms("sync") + "</button>" +
        "<button class=\"ps-hbtn\" data-ps-act=\"edit\" aria-label=\"Edit patient\">" + ms(st.editing ? "check" : "edit") + "</button>" +
      "</header>" +
      "<div class=\"ps-scroll\">" + sheetHtml(false) + "</div>" +
      "<div class=\"ps-actionbar\">" +
        "<button class=\"ps-btn ghost\" data-ps-act=\"print\">" + ms("print") + "Print / PDF</button>" +
        "<button class=\"ps-btn primary\" data-ps-act=\"assign\">" + ms("assignment_turned_in") + "Assign to patient</button>" +
      "</div>" +
      doseEditModalHtml() +
      addDrugModalHtml() +
      brandingModalHtml() +
      addToxModalHtml() +
    "</div>";
  }

  // ---- signature pad (canvas, pointer/touch) ----------------------------------------------------
  function wireSig() {
    var c = D && D.getElementById("psSig"); if (!c) return;
    var ctx = c.getContext("2d");
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

  // ---- event handlers ---------------------------------------------------------------------------
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-ps-act]") : null;
    if (t) {
      // If t is a modal backdrop, only dismiss if clicked directly on the backdrop itself (not inside the card)
      if (t.classList.contains("ps-modal-backdrop") && e.target !== t) return;

      var act = t.getAttribute("data-ps-act");
      if (act === "close") return close();
      if (act === "edit") { commitEdits(); st.editing = !st.editing; paint(); return; }
      if (act === "wardsync-fetch") { fetchWardSync(); return; }
      if (act === "print") return doPrint();
      if (act === "assign") return doAssign();
      if (act === "sig-clear") { st.sig = null; var c = D.getElementById("psSig"); if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); return; }

      // Branding modal
      if (act === "open-branding") { st.showBrandingModal = true; st.tempLogoDataUrl = null; paint(); return; }
      if (act === "close-branding") { st.showBrandingModal = false; st.tempLogoDataUrl = null; paint(); return; }
      if (act === "clear-brand-logo") { st.tempLogoDataUrl = ""; paint(); return; }
      if (act === "reset-branding") { resetInstitution(); st.showBrandingModal = false; paint(); return; }
      if (act === "save-branding") {
        var bName = (D.getElementById("psBrandName") || {}).value || "";
        var bDept = (D.getElementById("psBrandDept") || {}).value || "";
        var bLine = (D.getElementById("psBrandLine") || {}).value || "";
        var curInst = getInstitution();
        var finalLogo = st.tempLogoDataUrl !== null ? (st.tempLogoDataUrl || null) : curInst.logoDataUrl;
        saveInstitution({ name: bName.trim() || DEFAULT_INSTITUTION.name, dept: bDept.trim(), line: bLine.trim(), logoDataUrl: finalLogo });
        st.showBrandingModal = false;
        st.tempLogoDataUrl = null;
        paint();
        try { if (G.toast) G.toast("Hospital branding saved successfully."); } catch (eBr) {}
        return;
      }

      // Dosage Override modal
      if (act === "edit-drug-dose") {
        var did = t.getAttribute("data-ps-drug-id");
        st.activeDoseEditModal = did;
        paint();
        return;
      }
      if (act === "close-dose-modal") {
        st.activeDoseEditModal = null;
        paint();
        return;
      }
      if (act === "quick-dose-pct") {
        var pct = parseFloat(t.getAttribute("data-ps-pct"));
        var didDose = st.activeDoseEditModal;
        var prDose = st.protocol || {};
        var dObj = asArr(prDose.drugs).find(function (x) { return x.id === didDose; });
        if (dObj) {
          var rDose = drugRow(dObj);
          var base = rDose.origTotal != null ? rDose.origTotal : (rDose.total != null ? rDose.total : (dObj.basis === "flat" && num(dObj.dosePerUnit) ? num(dObj.dosePerUnit) : null));
          if (base != null) {
            var inputEl = D.getElementById("psCustomDoseInput");
            if (inputEl) {
              inputEl.value = round2(base * pct);
              inputEl.focus();
            }
            if (t.parentElement) {
              var pBtns = t.parentElement.querySelectorAll(".ps-pct-btn");
              for (var bi = 0; bi < pBtns.length; bi++) pBtns[bi].classList.remove("on");
            }
            t.classList.add("on");
            var pctText = Math.round((1 - pct) * 100) + "% dose reduction applied";
            var rEl = D.getElementById("psCustomDoseReason");
            if (rEl) {
              if (!rEl.value || rEl.value.indexOf("reduction") !== -1) {
                rEl.value = pctText;
              }
            }
          }
        }
        return;
      }
      if (act === "quick-reason-chip") {
        var reason = t.getAttribute("data-ps-reason");
        var rEl = D.getElementById("psCustomDoseReason");
        if (rEl) {
          var curVal = (rEl.value || "").trim();
          if (curVal && curVal.indexOf(reason) === -1) {
            rEl.value = curVal + "; " + reason;
          } else {
            rEl.value = reason;
          }
        }
        return;
      }
      if (act === "reset-drug-dose") {
        var resetId = st.activeDoseEditModal;
        if (resetId) {
          delete st.overrides[resetId];
          var drugToReset = asArr(st.protocol && st.protocol.drugs).find(function (x) { return x.id === resetId; });
          if (drugToReset) { drugToReset.customDoseMg = null; drugToReset.doctorAdjustReason = null; }
        }
        st.activeDoseEditModal = null;
        paint();
        return;
      }
      if (act === "save-drug-dose") {
        var saveId = st.activeDoseEditModal;
        var doseIn = num((D.getElementById("psCustomDoseInput") || {}).value);
        var reasonIn = (D.getElementById("psCustomDoseReason") || {}).value || "";
        if (saveId && doseIn != null) {
          st.overrides[saveId] = { customDoseMg: doseIn, reason: reasonIn };
        }
        st.activeDoseEditModal = null;
        paint();
        try { if (G.toast) G.toast("Dose adjustment saved."); } catch (eSd) {}
        return;
      }

      // Add Drug modal
      if (act === "open-add-drug") { st.showAddDrugModal = true; paint(); return; }
      if (act === "close-add-drug") { st.showAddDrugModal = false; paint(); return; }
      if (act === "save-add-drug") {
        var dName = (D.getElementById("psNewDrugName") || {}).value || "";
        var dDose = num((D.getElementById("psNewDrugDose") || {}).value);
        var dUnit = (D.getElementById("psNewDrugUnit") || {}).value || "mg/m2";
        var dBasis = (D.getElementById("psNewDrugBasis") || {}).value || "bsa";
        var dRoute = (D.getElementById("psNewDrugRoute") || {}).value || "IV Infusion";
        var dDaysStr = (D.getElementById("psNewDrugDays") || {}).value || "1";
        var dNotes = (D.getElementById("psNewDrugNotes") || {}).value || "";

        if (!dName.trim()) {
          if (G.toast) G.toast("Please enter drug name.");
          return;
        }
        var daysArr = dDaysStr.split(/[,-\s]+/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
        if (!daysArr.length) daysArr = [1];

        st.protocol = st.protocol || {};
        st.protocol.drugs = asArr(st.protocol.drugs);
        st.protocol.drugs.push({
          id: "custom-" + Date.now(),
          name: dName.trim(),
          dosePerUnit: dDose,
          unit: dUnit,
          basis: dBasis,
          route: dRoute,
          days: daysArr,
          notes: dNotes,
          custom: true
        });
        st.showAddDrugModal = false;
        paint();
        return;
      }
      if (act === "delete-custom-drug") {
        var delDrugId = t.getAttribute("data-ps-drug-id");
        if (st.protocol && st.protocol.drugs) {
          st.protocol.drugs = st.protocol.drugs.filter(function (d) { return d.id !== delDrugId; });
          delete st.overrides[delDrugId];
          paint();
        }
        return;
      }

      // Multilingual Oral instructions
      if (act === "select-oral-lang") {
        var langKey = t.getAttribute("data-ps-lang");
        st.oralLang = langKey;
        paint();
        return;
      }

      // Toxicity modal
      if (act === "open-add-tox") { st.showAddToxModal = true; paint(); return; }
      if (act === "close-add-tox") { st.showAddToxModal = false; paint(); return; }
      if (act === "save-add-tox") {
        var tDrug = (D.getElementById("psNewToxDrug") || {}).value || "General";
        var tTitle = (D.getElementById("psNewToxTitle") || {}).value || "";
        var tSymp = (D.getElementById("psNewToxSymptoms") || {}).value || "";
        var tTreat = (D.getElementById("psNewToxTreatment") || {}).value || "";
        if (!tTitle.trim()) { if (G.toast) G.toast("Please enter toxicity title."); return; }
        st.customToxicities.push({
          id: "custom-tox-" + Date.now(),
          drug: tDrug,
          title: tTitle,
          symptoms: tSymp,
          management: tTreat,
          custom: true
        });
        st.showAddToxModal = false;
        paint();
        return;
      }
      if (act === "delete-custom-tox") {
        var delToxId = t.getAttribute("data-ps-tox-id");
        st.customToxicities = st.customToxicities.filter(function (x) { return x.id !== delToxId; });
        paint();
        return;
      }

      // Doctor note quick chips
      if (act === "insert-note-chip") {
        var chipText = t.getAttribute("data-ps-chip");
        var cleanChip = chipText.replace(/^\+\s*/, "");
        var curNotes = st.doctorNotes.trim();
        st.doctorNotes = curNotes ? (curNotes + "\n• " + cleanChip) : ("• " + cleanChip);
        var ta = D.querySelector(".ps-note-textarea");
        if (ta) ta.value = st.doctorNotes;
        return;
      }
      if (act === "toggle-print-notes") {
        st.includeDoctorNotesInPrint = !st.includeDoctorNotesInPrint;
        return;
      }
    }

    var vb = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-verify");
    if (vb) { st.verify[vb] = e.target.checked; return; }
  }

  function commitEdits() {
    if (!D) return;
    var inputs = D.querySelectorAll("[data-ps-field]");
    st.patient = st.patient || {};
    for (var i = 0; i < inputs.length; i++) {
      var k = inputs[i].getAttribute("data-ps-field");
      st.patient[k] = inputs[i].value;
    }
  }

  function updateLiveDoses() {
    if (!D) return;
    var b = bsa();
    var c = crcl();
    var elBsa = D.querySelector(".ps-auto-bsa");
    if (elBsa) {
      elBsa.innerHTML = b ? ("<span class=\"ps-calc-val\">" + round2(b) + " m²</span><span class=\"ps-calc-tag\">Mosteller</span>") : "<span class=\"ps-calc-missing\">Auto (enter Ht &amp; Wt)</span>";
    }
    var elCrcl = D.querySelector(".ps-auto-crcl");
    if (elCrcl) {
      elCrcl.innerHTML = c ? ("<span class=\"ps-calc-val\">" + round2(c) + " mL/min</span><span class=\"ps-calc-tag\">Cockcroft-Gault</span>") : "<span class=\"ps-calc-missing\">Auto (enter Age, Wt, SCr, Sex)</span>";
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
    if (e.target && e.target.classList && e.target.classList.contains("ps-note-textarea")) {
      st.doctorNotes = e.target.value;
      return;
    }
    var f = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-field");
    if (!f) return;
    st.patient = st.patient || {};
    st.patient[f] = e.target.value;
    if (f === "heightCm" || f === "weightKg" || f === "creatinine" || f === "age" || f === "sex") {
      updateLiveDoses();
    }
  }

  function onChange(e) {
    if (e.target && e.target.id === "psBrandLogoFile") {
      var file = e.target.files && e.target.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function (evt) {
          try {
            var img = new Image();
            img.onload = function () {
              try {
                var maxW = 320, maxH = 120;
                var w = img.width, h = img.height;
                if (w > maxW || h > maxH) {
                  var scale = Math.min(maxW / w, maxH / h);
                  w = Math.round(w * scale);
                  h = Math.round(h * scale);
                }
                var canvas = D.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, w, h);
                st.tempLogoDataUrl = canvas.toDataURL("image/png");
              } catch (err) {
                st.tempLogoDataUrl = evt.target.result;
              }
              paint();
            };
            img.src = evt.target.result;
          } catch (e2) {
            st.tempLogoDataUrl = evt.target.result;
            paint();
          }
        };
        reader.readAsDataURL(file);
      }
      return;
    }
    var f = e.target && e.target.getAttribute && e.target.getAttribute("data-ps-field");
    if (!f) return;
    st.patient = st.patient || {};
    st.patient[f] = e.target.value;
    if (f === "heightCm" || f === "weightKg" || f === "creatinine" || f === "age" || f === "sex") {
      updateLiveDoses();
    }
  }

  // ---- EXPORT TO PRINTABLE HTML (A4 1-PAGE OR 2-PAGE PAGINATION) --------------------------------
  function buildExportHtml() {
    var pr = st.protocol || {};
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>" + esc(pr.name || "Treatment Protocol") + "</title>" +
      "<style>" +
      ":root{color-scheme:light}" +
      "body{margin:0;padding:12px 16px;background:#fff!important;color:#0f172a!important;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:10.5pt;line-height:1.35;}" +
      ".ps-sheet{max-width:820px;margin:0 auto;background:#fff;border:none;box-shadow:none;padding:0}" +
      ".ps-inst{border-bottom:2.5px solid #0f766e;padding-bottom:10px;margin-bottom:10px}" +
      ".ps-inst-top{display:flex;align-items:center;justify-content:space-between;gap:12px}" +
      ".ps-inst-brand{display:flex;align-items:center;gap:10px}" +
      ".ps-inst-logo{width:36px;height:36px;background:#0f766e;color:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}" +
      ".ps-inst-logo-custom{background:transparent;overflow:hidden}" +
      ".ps-inst-logo-img{max-width:48px;max-height:48px;object-fit:contain}" +
      ".ps-inst-name{font:800 18px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#0f766e;letter-spacing:-.01em}" +
      ".ps-inst-dept{font:600 12px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#334155;margin-top:2px}" +
      ".ps-inst-line{font:500 10.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#64748b;margin-top:4px}" +
      ".ps-title-row{display:flex;justify-content:space-between;align-items:baseline;margin:8px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}" +
      ".ps-title{font:800 14.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#0f172a}" +
      ".ps-doc-date{font:600 11px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#64748b}" +
      ".ps-regimenbanner{background:#0f766e;color:#fff;border-radius:10px;padding:10px 14px;margin-bottom:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".ps-regimen-kicker{font:800 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;letter-spacing:.1em;opacity:.85}" +
      ".ps-regimen-name{font:800 16px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;letter-spacing:-.01em;margin-top:2px}" +
      ".ps-regimen-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
      ".ps-regimen-chip{font:700 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 8px}" +
      ".ps-cards{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:10px}" +
      ".ps-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-card-h{font:800 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#0f766e;margin-bottom:6px}" +
      ".ps-card-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 16px}" +
      ".ps-span-2{grid-column:1/-1}" +
      ".ps-renalbadge{font:700 8.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;border-radius:4px;padding:1px 5px;border:1px solid;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".ps-renal-ok{color:#166534;background:#dcfce7;border-color:#86efac}" +
      ".ps-renal-mild{color:#075985;background:#e0f2fe;border-color:#7dd3fc}" +
      ".ps-renal-mod{color:#92400e;background:#fef3c7;border-color:#fcd34d}" +
      ".ps-renal-sev{color:#9a3412;background:#ffedd5;border-color:#fdba74}" +
      ".ps-renal-fail{color:#fff;background:#dc2626;border-color:#991b1b}" +
      ".ps-f{display:flex;align-items:baseline;gap:6px;font-size:11px}" +
      ".ps-f>span{color:#64748b;font-weight:600;min-width:110px}" +
      ".ps-f>b{font-weight:700;color:#0f172a}" +
      ".ps-autofield b{display:inline-flex;align-items:center;gap:6px}" +
      ".ps-calc-val{color:#0f766e;font-weight:800}" +
      ".ps-calc-tag{font:700 8px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;color:#0f766e;background:#ccfbf1;border:1px solid #99f6e4;border-radius:4px;padding:1px 4px}" +
      ".ps-calc-missing{color:#94a3b8;font-style:italic;font-weight:500}" +
      ".ps-tablewrap{border:1px solid #94a3b8;border-radius:8px;overflow:hidden;margin-top:8px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-table{width:100%;border-collapse:collapse;font-size:10.5px}" +
      ".ps-table th{background:#f1f5f9;color:#334155;font:700 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;padding:6px 8px;border-bottom:1.5px solid #94a3b8;text-align:left}" +
      ".ps-table td{padding:6px 8px;border-bottom:1px solid #cbd5e1;vertical-align:top;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-table tr:last-child td{border-bottom:none}" +
      ".ps-dname{font-weight:700;color:#0f172a}" +
      ".ps-dname-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}" +
      ".ps-cap{font:700 8px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;color:#fff;background:#dc2626;border-radius:3px;padding:1px 3px}" +
      ".ps-ddesc b{font-weight:800;color:#0f766e;font-size:11.5px}" +
      ".ps-dose-val-row{display:flex;align-items:center;gap:6px}" +
      ".ps-daily{font:800 10.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#0f172a}" +
      ".ps-permetre{display:block;color:#64748b;font-size:9.5px;margin-top:1px}" +
      ".ps-orig-footnote{font-size:9px;color:#b45309;font-weight:600;margin-top:2px;background:#fffbeb;padding:1px 4px;border-radius:3px;display:inline-block}" +
      ".ps-dnote{display:block;color:#64748b;font-size:9px;margin-top:2px;font-style:italic}" +
      ".ps-custombadge{font:800 8.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;letter-spacing:.04em;color:#fff;background:#b45309;border-radius:4px;padding:1.5px 5px;vertical-align:middle;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".ps-adjusted-badge{background:#0369a1}" +
      ".ps-docadded-badge{background:#4338ca}" +
      ".ps-cyc{text-align:center;font:600 10px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif}" +
      ".ps-cyc.x{color:#94a3b8;font-weight:700}" +
      ".ps-legend{font-size:9px;color:#64748b;margin:5px 0}" +
      ".ps-warns{display:flex;gap:8px;font-size:10.5px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:6px 9px;margin:6px 0;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-block{margin-top:8px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-block-h{font:800 10px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;color:#475569;margin-bottom:3px;letter-spacing:.03em;border-bottom:1px dashed #e2e8f0;padding-bottom:2px}" +
      ".ps-block ul{margin:0;padding-left:16px}" +
      ".ps-block li,.ps-block p{font-size:10px;line-height:1.4;margin:2px 0;color:#334155}" +
      ".ps-tox-section{border:1px solid #fed7aa;background:#fffaf5;border-radius:8px;padding:8px 10px;margin-top:10px}" +
      ".ps-tox-header{color:#c2410c!important;border-bottom-color:#fed7aa!important}" +
      ".ps-tox-card{background:#fff;border:1px solid #ffedd5;border-radius:6px;padding:6px 8px;margin-bottom:6px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-tox-card:last-child{margin-bottom:0}" +
      ".ps-tox-card-h{display:flex;align-items:center;gap:8px;margin-bottom:3px}" +
      ".ps-tox-drug{font:800 10px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#c2410c;background:#ffedd5;padding:1px 5px;border-radius:4px}" +
      ".ps-tox-title{font:700 10.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#0f172a}" +
      ".ps-tox-symptoms{font-size:9.5px;color:#475569;margin-bottom:2px;line-height:1.35}" +
      ".ps-tox-treatment{font-size:9.5px;color:#0f766e;line-height:1.35;font-weight:600}" +
      ".ps-oral-card{border:1px solid #bfdbfe;background:#f8fafc;border-radius:8px;padding:8px 10px;margin-top:10px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-oral-header{color:#1e40af!important;border-bottom-color:#bfdbfe!important}" +
      ".ps-oral-grid{display:grid;grid-template-columns:1fr;gap:8px}" +
      ".ps-oral-bilingual{grid-template-columns:1fr 1fr}" +
      ".ps-oral-col{background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px}" +
      ".ps-oral-lang-title{font:800 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#1e40af;margin-bottom:4px}" +
      ".ps-oral-list{margin:0;padding-left:14px}" +
      ".ps-oral-list li{font-size:9.5px;line-height:1.35;margin:2px 0;color:#334155}" +
      ".ps-oral-alert{color:#b91c1c!important;font-weight:700}" +
      ".ps-doctor-notes-card{border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:8px 10px;margin-top:10px;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-doc-notes-h{color:#0f766e!important}" +
      ".ps-note-display{font-size:10px;line-height:1.45;color:#0f172a;white-space:pre-line;background:#fff;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0}" +
      ".ps-signatures{margin-top:12px;page-break-inside:avoid;break-inside:avoid;border-top:1.5px solid #cbd5e1;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:12px}" +
      ".ps-sig-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}" +
      ".ps-sig-block-h{font:800 9.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;text-transform:uppercase;color:#475569;margin-bottom:6px}" +
      ".ps-sig-row{display:flex;flex-direction:column;gap:6px}" +
      ".ps-sig-export-wrap{margin-bottom:4px}" +
      ".ps-sig-verified-tag{display:inline-flex;align-items:center;gap:4px;font:700 9px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#0f766e;margin-top:2px}" +
      ".ps-sig-line-placeholder{margin-top:24px}" +
      ".ps-sig-line{border-bottom:1px solid #0f172a;margin-bottom:3px;height:1px}" +
      ".ps-sig-line-lbl{font:600 9px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#64748b}" +
      ".ps-checker-items{display:grid;grid-template-columns:1fr;gap:2.5px;font-size:9px;color:#475569;margin-bottom:8px}" +
      ".ps-foot-print{margin-top:12px;padding-top:8px;border-top:1.5px solid #0f766e;page-break-inside:avoid;break-inside:avoid}" +
      ".ps-foot-brand{display:flex;align-items:center;gap:8px;margin-bottom:5px}" +
      ".ps-foot-logo{color:#0f766e;display:flex;align-items:center}" +
      ".ps-foot-brandtext{display:flex;flex-direction:column;line-height:1.2}" +
      ".ps-foot-brandtext b{font:800 11px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#0f766e}" +
      ".ps-foot-brandtext span{font:500 8.5px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;color:#64748b}" +
      ".ps-foot-disclaimer{font-size:8pt;color:#64748b;line-height:1.35;margin-bottom:4px;background:#f8fafc;padding:5px 8px;border-radius:4px;border:1px solid #e2e8f0}" +
      ".ps-foot-meta{font-size:7.5pt;color:#94a3b8;text-align:center;letter-spacing:.02em}" +
      ".ps-vh,.ps-verify,.ps-sig-actions,.ps-emr-bar,.ps-table-actions,.ps-dose-edit-btn,.ps-inst-editbtn,.ps-lang-picker,.ps-tox-actions,.ps-note-chips,.ps-drug-del-btn,.ps-tox-del-btn{display:none!important}" +
      ".ps-page-break-deliberate{display:none}" +
      ".ps-page2-header{display:none}" +
      "@page{size:A4 portrait;margin:8mm 10mm}" +
      "@media print{" +
        "body{padding:0!important}" +
        ".ps-vh,.ps-verify,.ps-sig-actions,.ps-emr-bar,.ps-table-actions,.ps-dose-edit-btn,.ps-inst-editbtn,.ps-lang-picker,.ps-tox-actions,.ps-note-chips,.ps-drug-del-btn,.ps-tox-del-btn{display:none!important}" +
        ".ps-sheet{max-width:100%!important;border:none!important;box-shadow:none!important}" +
        ".ps-page-break-auto{page-break-inside:avoid;break-inside:avoid}" +
        ".ps-page-break-deliberate{display:block!important;page-break-before:always!important;break-before:page!important;height:0!important;margin:0!important;padding:0!important}" +
        ".ps-page2-header{display:flex!important;justify-content:space-between;align-items:center;border-bottom:1.5px solid #0f766e;padding-bottom:5px;margin-bottom:12px;font-size:8.5pt;color:#64748b;font-weight:600}" +
      "}" +
      "</style></head><body>" + sheetHtml(true) + "</body></html>";
  }

  function doPrint() {
    commitEdits();
    var pr = st.protocol || {};
    var name = ("StewardMD-" + (pr.name || pr.id || "protocol")).replace(/[^\w.-]+/g, "-");
    var fullHtml = buildExportHtml();
    if (G.toast) G.toast("Building PDF...");

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

    if (G.SMD_PDF && G.SMD_PDF.fromHtml) {
      G.SMD_PDF.fromHtml(fullHtml, name, "StewardMD - " + (pr.name || "Protocol sheet")).catch(function () {
        try { G.print(); } catch (e) {}
      });
      return;
    }

    try { G.print(); } catch (e) {}
  }

  function doAssign() {
    commitEdits();
    var pr = st.protocol || {};
    var payload = {
      protocolId: pr.id, protocolName: pr.name, protocolVersion: pr.version || null,
      patient: st.patient, bsa: bsa(),
      doses: asArr(pr.drugs).map(function (d) { var r = drugRow(d); return { id: r.id, name: r.name, perUnit: r.perUnit, total: r.total, route: r.route, days: r.days, isAdjusted: r.isAdjusted, adjustReason: r.adjustReason }; }),
      doctorNotes: st.doctorNotes,
      institution: getInstitution(),
      verified: st.verify, signature: st.sig, signedAt: (st.ctx && st.ctx.today) || null
    };
    try { if (D && D.dispatchEvent) D.dispatchEvent(new CustomEvent("smd-protocol-assign", { detail: payload })); } catch (e) {}
    if (typeof st.onAssign === "function") { try { st.onAssign(payload); } catch (e2) {} }
    try { if (G.toast) G.toast("Protocol assigned to patient oncology plan."); } catch (e3) {}
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
    st.protocol = protocol ? JSON.parse(JSON.stringify(protocol)) : null;
    st.patient = patient ? JSON.parse(JSON.stringify(patient)) : {};
    st.verify = {};
    st.sig = null;
    st.overrides = {};
    st.activeDoseEditModal = null;
    st.showAddDrugModal = false;
    st.showBrandingModal = false;
    st.showAddToxModal = false;
    st.doctorNotes = "";
    st.includeDoctorNotesInPrint = true;
    st.oralLang = "en";
    st.includeOralInstructions = true;
    st.customToxicities = [];
    st.disabledToxicities = {};
    st.tempLogoDataUrl = null;
    st.editing = !(patient && patient.heightCm && patient.weightKg && patient.name);
    st.ctx = opts;
    st.onAssign = opts.onAssign || null;
    if (opts.institution) st.institution = opts.institution;
    var el = ensureEl();
    el.style.display = "block";
    el.style.zIndex = "15000";
    if (D.body) D.body.classList.add("ps-open");
    paint();
  }

  function open(protocolOrId, patient, opts) {
    if (!D) return;
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

  function close() {
    var el = D && D.getElementById("smdProtoSheet");
    if (el) el.style.display = "none";
    if (D && D.body) D.body.classList.remove("ps-open");
  }

  var API = {
    open: open,
    close: close,
    _st: st,
    _drugRow: drugRow,
    bsa: bsa,
    crcl: crcl,
    sheetHtml: sheetHtml,
    shellHtml: shellHtml,
    buildExportHtml: buildExportHtml,
    onClick: onClick,
    fetchWardSync: fetchWardSync,
    getInstitution: getInstitution,
    saveInstitution: saveInstitution,
    resetInstitution: resetInstitution,
    getRegimenToxicities: getRegimenToxicities,
    hasOralMedications: hasOralMedications,
    _version: "1.3"
  };

  if (root) root.SMD_PROTOSHEET = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
