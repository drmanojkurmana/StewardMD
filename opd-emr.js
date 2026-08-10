/* opd-emr.js — OPD patient workspace (window.OPDEMR). Phase 1 profile (READ ONLY) + Phases 2-4 write-back:
 * order investigations, prescribe medications, fill the assessment form — all from StewardMD's own UI,
 * writing back to GHIS (docs/queue/emr-opd-integration-plan.md). Buildless ES5 IIFE.
 * Two flags: smd_opd_emr (opens the overlay at all) + smd_opd_emr_write (shows the SUBMIT buttons). Writes are
 * ALSO gated server-side (QUEUE_EMR_WRITE=1) AND behind an explicit confirm() — no write fires without all three.
 * Full-screen overlay (#smdOpdEmr) with tabs: Profile · Investigations · Medications · Assessment.
 * _render(state) is PURE (state -> HTML) so the demo/tests reuse it verbatim. Material Symbols icons (no emoji). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '">' + name + "</span>"; }
  function initials(n) { n = String(n || "").trim(); if (!n) return "PT"; var p = n.split(/\s+/); return ((p[0][0] || "") + (p[1] ? p[1][0] : (p[0][1] || ""))).toUpperCase(); }

  // ---- PURE render: state -> HTML (the demo/tests use this verbatim) -----------------------
  function header() {
    return '<header class="oe-top">' +
      '<button class="oe-back" data-oe-act="close" title="Back to queue" aria-label="Back to queue">' + ms("arrow_back") + "</button>" +
      '<div class="oe-brand"><span class="oe-logo-mark" aria-hidden="true"></span>' +
      '<span class="oe-wordmark">Steward<span>MD</span></span></div>' +
      '<button class="oe-close" data-oe-act="close" title="Close" aria-label="Close">' + ms("close") + "</button></header>";
  }
  function tabsNav(active) {
    var defs = [["profile", "Profile", "person"], ["inv", "Investigations", "science"], ["meds", "Medications", "pill"], ["assess", "Assessment", "clinical_notes"]];
    return '<nav class="oe-tabs">' + defs.map(function (t) {
      return '<button class="oe-tab' + (t[0] === active ? " on" : "") + '" data-oe-act="tab:' + t[0] + '">' + ms(t[2]) + "<span>" + t[1] + "</span></button>";
    }).join("") + "</nav>";
  }
  function patientHead(p, phone) {
    var line = '<span>' + ms("badge") + ' MR# <b class="mono">' + esc(p.mrn || "-") + "</b></span>";
    if (phone) line += '<span>' + ms("call") + ' <span class="mono">' + esc(phone) + "</span></span>";
    return '<section class="oe-phead"><div class="oe-avatar">' + esc(initials(p.name)) + "</div>" +
      '<div class="oe-pmeta"><h2>' + esc(p.name || "Patient") + "</h2><div class=\"oe-prow\">" + line + "</div></div></section>";
  }
  function labRow(o) {
    var meta = [o.department, o.orderDate].filter(Boolean).map(esc).join(" · ");
    var status = o.status ? '<span class="oe-tag">' + esc(o.status) + "</span>" : "";
    return '<button class="oe-row" data-oe-act="lab:' + esc(o.renderId || "") + ":" + esc(o.episodeId || "") + '">' +
      '<span class="oe-row-ic">' + ms("science") + "</span>" +
      '<span class="oe-row-b"><span class="oe-row-t">' + esc(o.serviceName || "Lab test") + "</span>" +
      (meta ? '<span class="oe-row-m">' + meta + "</span>" : "") + "</span>" + status + ms("chevron_right") + "</button>";
  }
  function radRow(o) {
    var meta = [o.date].filter(Boolean).map(esc).join(" · ");
    return '<button class="oe-row" data-oe-act="rad:' + esc(o.resultid || "") + ":" + esc(o.printType || "manual") + '">' +
      '<span class="oe-row-ic">' + ms("radiology") + "</span>" +
      '<span class="oe-row-b"><span class="oe-row-t">' + esc(o.description || "Radiology") + "</span>" +
      (meta ? '<span class="oe-row-m">' + meta + "</span>" : "") + "</span>" + ms("chevron_right") + "</button>";
  }
  function medRow(m) {
    var d = [m.dosage, m.route, m.frequency, m.duration].filter(Boolean).map(esc).join(" · ");
    return '<div class="oe-row static"><span class="oe-row-ic">' + ms("medication") + "</span>" +
      '<span class="oe-row-b"><span class="oe-row-t">' + esc(m.drugText || "Medication") + "</span>" +
      (d ? '<span class="oe-row-m">' + d + "</span>" : "") + "</span>" +
      (m.dateTime ? '<span class="oe-when">' + esc(m.dateTime) + "</span>" : "") + "</div>";
  }
  function section(icon, title, sub, rowsHtml, emptyMsg) {
    var head = '<h3 class="oe-h3">' + ms(icon) + title + (sub ? '<span class="oe-sub">' + esc(sub) + "</span>" : "") + "</h3>";
    return '<section class="oe-sec">' + head + (rowsHtml || '<div class="oe-empty sm">' + esc(emptyMsg) + "</div>") + "</section>";
  }
  function loadingBox(msg) { return '<div class="oe-empty">' + ms("hourglass_top") + "<div>" + esc(msg || "Loading patient profile…") + "</div></div>"; }
  function errorBox(msg) { return '<div class="oe-empty err">' + ms("error") + "<div>" + esc(msg) + "</div></div>"; }
  function writeNote() { return '<div class="oe-note">' + ms("info") + "<span>Ordering and prescribing are being set up.</span></div>"; }
  function searchBox(kind, query, placeholder) {
    return '<div class="oe-search-wrap">' + ms("search") +
      '<input class="oe-search" type="search" autocomplete="off" data-oe-inp="' + kind + '-q" placeholder="' + esc(placeholder) + '" value="' + esc(query || "") + '"></div>';
  }
  function resultList(kind, results) {
    if (!results || !results.length) return "";
    return '<div class="oe-results">' + results.map(function (r, i) {
      return '<button class="oe-result" data-oe-act="' + kind + '-pick:' + i + '">' + ms("add") + "<span>" + esc(r.name) + "</span></button>";
    }).join("") + "</div>";
  }
  function fieldRow(label, inp, req, reqEmpty) { return '<label class="oe-field' + (reqEmpty ? " req-empty" : "") + '"><span>' + esc(label) + (req ? ' <b class="oe-req">*</b>' : "") + "</span>" + inp + "</label>"; }
  function textInp(name, value, ph) { return '<input class="oe-inp" data-oe-inp="' + esc(name) + '" value="' + esc(value || "") + '" placeholder="' + esc(ph || "") + '">'; }

  function profileTab(st) {
    var labs = (st.labs || []).map(labRow).join(""), rad = (st.radiology || []).map(radRow).join("");
    var reports = section("history", "Reports", "Investigations we ordered", (labs + rad) || "", "No labs or imaging on record.");
    var meds = section("pill", "Current medications", "", (st.medications || []).map(medRow).join(""), "No current medications on record.");
    return reports + meds;
  }
  function invTab(st) {
    var d = st.invDraft || {}, draft = "";
    if (d.service) {
      var action = st.writeOn
        ? '<button class="oe-btn primary" data-oe-act="inv-order">' + ms("send") + "Order</button>"
        : writeNote();
      draft = '<div class="oe-draft"><div class="oe-draft-h">' + ms("science") + "<b>" + esc(d.service.name) + "</b>" +
        '<button class="oe-x" data-oe-act="inv-clear" aria-label="Remove">' + ms("close") + "</button></div>" +
        fieldRow("Diagnosis", textInp("inv-dx", d.diagnosis, "Provisional diagnosis")) +
        '<button class="oe-toggle' + (d.emergency ? " on" : "") + '" data-oe-act="inv-emg">' + ms(d.emergency ? "check_box" : "check_box_outline_blank") + "Emergency</button>" +
        action + "</div>";
    }
    var existing = section("history", "Existing orders", "Investigations on record", (st.labs || []).map(labRow).join(""), "No investigations on record.");
    return searchBox("inv", st.invQuery, "Search investigation services…") + resultList("inv", st.invResults) + draft + existing;
  }
  function medsTab(st) {
    var d = st.medDraft || {}, draft = "";
    if (d.drug) {
      var action = st.writeOn
        ? '<button class="oe-btn primary" data-oe-act="med-rx">' + ms("send") + "Prescribe</button>"
        : writeNote();
      draft = '<div class="oe-draft"><div class="oe-draft-h">' + ms("medication") + "<b>" + esc(d.drug.name) + "</b>" +
        '<button class="oe-x" data-oe-act="med-clear" aria-label="Remove">' + ms("close") + "</button></div>" +
        fieldRow("Route", textInp("med-route", d.route, "e.g. Oral")) +
        fieldRow("Form", textInp("med-form", d.form, "e.g. Tablet")) +
        fieldRow("Quantity", textInp("med-qty", d.qty, "e.g. 10")) +
        fieldRow("Frequency", textInp("med-freq", d.frequency, "e.g. BID")) +
        fieldRow("Duration", textInp("med-dur", d.duration, "e.g. 5 days")) +
        fieldRow("Remarks", textInp("med-remarks", d.remarks, "Optional")) +
        action + "</div>";
    }
    var current = section("pill", "Current medications", "", (st.medications || []).map(medRow).join(""), "No current medications on record.");
    return searchBox("med", st.medQuery, "Search medications…") + resultList("med", st.medResults) + draft + current;
  }
  // ---- GHIS Initial Assessment schema (field names VERBATIM from a live CreateinitialAssessmentnew capture,
  // 2026-08-07). `val.*` names keep their prefix; bare names get `assessment.` server-side. kind: text|number|
  // textarea|yesno(Y/N)|check(true/false)|select(rendered as a plain text input — no GHIS option values captured).
  // OMITTED radio groups (write field names NOT captured — do not guess): level of consciousness, neck stiffness,
  // dyspnoea, abdomen shape, pain scale, birth history, general condition, diet, menstrual status/cycles/flow.
  function F(n, l, k, req, ph) { return { n: n, l: l, k: k || "text", r: !!req, p: ph || "" }; }
  var ASSESS_SCHEMA = [
    { t: "History", i: "description", f: [
      F("Chief_complaints_duration", "Chief complaints", "textarea", true),
      F("History_present_illness", "Present history", "textarea", true),
      F("History_past_illness", "Past history", "textarea", true) ] },
    { t: "Pre-admission investigation / treatment", i: "biotech", f: [
      F("val.investigation_desc", "Investigation"), F("val.investigation_diagnostic", "Diagnostics"), F("val.investigation_date", "Date"),
      F("val.treatment_received", "Treatment received"), F("val.treatment_received_date", "Date"), F("val.treatment_received_hospital", "Hospital") ] },
    { t: "Co-morbid conditions", i: "coronavirus", f: [
      F("Diabetes_yesNo", "Diabetes", "yesno"), F("Diabetes_details", "Diabetes details"),
      F("Hypertension_yesNo", "Hypertension", "yesno"), F("Hypertension_details", "Hypertension details"),
      F("Cardiac_yesNo", "Cardiac illness", "yesno"), F("Cardiac_details", "Cardiac details"),
      F("Bronchial_yesNo", "Bronchial asthma", "yesno"), F("Bronchial_details", "Bronchial asthma details"),
      F("Tuberculosis_yesNo", "Tuberculosis", "yesno"), F("Tuberculosis_details", "Tuberculosis details"),
      F("Thyroid_yesNo", "Thyroid disorder", "yesno"), F("Thyroid_details", "Thyroid details"),
      F("Epilepsy_yesNo", "Epilepsy", "yesno"), F("Epilepsy_details", "Epilepsy details"),
      F("Others_details", "Others") ] },
    { t: "Immunisation status", i: "vaccines", f: [
      F("immunization_status", "Immunisation status", "text", false, "IAP guidelines") ] },
    { t: "Personal history", i: "person", f: [
      F("Single_married", "Marital status", "select"), F("No_of_children", "Children", "select"), F("Consanguinity", "Consanguinity", "select"),
      F("Appetite", "Appetite", "select"), F("Bowels", "Bowels", "select"), F("Micturition", "Micturition", "select"),
      F("Mic_abnorml_details", "Micturition details"), F("Known_allergies_details", "Known allergies"),
      F("Habitat_addiction_yesno", "Habits", "yesno"),
      F("Habitat_addiction_alcohol", "Alcohol", "check"), F("Habitat_addiction_smoking", "Smoking", "check"),
      F("Habitat_addiction_drug", "Drug use", "check"), F("Habitat_addiction_tobacco", "Chewing of tobacco", "check"),
      F("Habitat_addiction_others", "Details") ] },
    { t: "Family history", i: "groups", f: [
      F("Family_history_yesno", "Family history", "yesno"),
      F("Family_history_diabetics", "Diabetes", "check"), F("Family_history_hypertension", "Hypertension", "check"),
      F("Family_history_Heart", "Heart disease", "check"), F("Family_history_cancer", "Cancers", "check"),
      F("Family_history_TB", "TB", "check"), F("Family_history_asthma", "Bronchial asthma", "check"),
      F("Family_history_psych", "Psychiatric", "check"), F("Family_history_others", "Others", "check"),
      F("Family_history_othersdetails", "Details") ] },
    { t: "Menstrual / Obstetric / Contraceptive / HRT history", i: "pregnant_woman", f: [
      F("menstrual_history_y_n", "Menstrual history significant", "yesno"), F("LMP", "LMP"),
      F("age_menarche", "Age of menarche", "number"), F("age_menopause", "Age of menopause", "number"), F("age_marriage", "Age of marriage", "number"),
      F("dysmenorrhoea", "Dysmenorrhoea"), F("Others", "Menstrual - others", "textarea"),
      F("obstetric_history_yes_no", "Obstetric history applicable", "yesno"), F("no_of_abortions", "No. of abortions", "number"),
      F("children_living", "Children alive", "number"), F("children_died", "Children died", "number"),
      F("LCB", "LCB"), F("IUD", "IUD"), F("still_birth", "Still birth"), F("neonatal_death", "Neonatal death"), F("lactating", "Lactating"),
      F("first_delivery_age", "Age of first delivery"), F("last_delivery_age", "Age of last delivery"),
      F("breast_feeding", "Breast feeding"), F("feeding_duration", "Duration"), F("molar_pregnancy", "Molar pregnancy"),
      F("pregnancy_comlications", "Pregnancy complications"), F("contracception", "Contraception"), F("sterilization", "Sterilization") ] },
    { t: "Nutritional screening", i: "monitor_weight", f: [
      F("Height", "Height (cms)", "number"), F("Weight", "Weight (kgs)", "number"), F("BMI", "BMI"), F("bsa", "BSA (m2)") ] },
    { t: "Physical examination - vital parameters", i: "vital_signs", f: [
      F("Temp", "Temperature (F)", "number", true), F("BP_SYS", "BP systolic", "number", true), F("BP_dia", "BP diastolic", "number", true),
      F("Nutrtion", "Nutrition"), F("hydration", "Hydration"),
      F("Pulse", "Pulse rate /min", "number", true), F("respiratory", "Respiratory rate /min", "number", true),
      F("pallor", "Pallor", "check"), F("icterus", "Icterus", "check"), F("cyanosis", "Cyanosis", "check"), F("clubbing", "Clubbing", "check"),
      F("Oedema", "Oedema", "check"), F("Lymphadenopathy", "Lymphadenopathy", "check"), F("Rash", "Rash", "check"), F("goitre", "Goitre", "check"),
      F("sys_examination", "Systemic examination", "textarea") ] },
    { t: "Examination", i: "stethoscope", f: [
      F("cranial_nerves", "Cranial nerves"), F("sensory_sys", "Sensory system"), F("gait", "Gait"), F("motor_sys", "Motor system"),
      F("speech", "Speech"), F("reflexes", "Reflexes"), F("plantar", "Plantars"), F("glasgow_scale", "Glasgow scale"),
      F("cerebellar_sign", "Cerebellar signs"), F("cardiac_sound", "Cardiac sounds"), F("JVP", "JVP"),
      F("musculo_skeletal_system", "Musculoskeletal system", "textarea"), F("skin", "Skin", "textarea"),
      F("breast_exam", "Examination of breast", "textarea"), F("ENT_exam", "Examination of ENT", "textarea"),
      F("teeth_exam", "Teeth and oral cavity", "textarea"), F("head_neck_exam", "Head and neck", "textarea"),
      F("tenderness_yesNo", "Abdomen tenderness", "yesno"), F("tenderness_details", "Tenderness details"),
      F("palpable_mass_yesNo", "Palpable mass", "yesno"), F("palpable_mass_details", "Palpable mass details"),
      F("hernial_orifices", "Hernial orifices normal", "yesno"), F("hernial_orifices_details", "Hernial orifices details"),
      F("genital", "Genitalia"), F("external_genitilia_perineum", "External genital & perineum"), F("examination", "P/R examination") ] },
    { t: "Diagnosis & plan", i: "assignment_turned_in", f: [
      F("provisional_diagnosis", "Provisional diagnosis", "textarea"), F("management_plan", "Management plan", "textarea"),
      F("refered_management_plan", "Referred to & management plan", "textarea"),
      F("informany_attendant", "Informant name"), F("informant_relation", "Relation with attendant", "select") ] }
  ];
  function defVal(k) { return k === "yesno" ? "N" : (k === "check" ? "false" : ""); }
  function assessGet(vals, f) { return (vals && vals[f.n] != null) ? String(vals[f.n]) : defVal(f.k); }
  function ynRow(f, val) {
    val = (val === "Y") ? "Y" : "N";
    var nm = "oe-" + f.n;
    function r(v, lbl) { return '<label class="oe-radio"><input type="radio" name="' + esc(nm) + '" data-oe-inp="assess:' + esc(f.n) + '" value="' + v + '"' + (val === v ? " checked" : "") + "><span>" + lbl + "</span></label>"; }
    return '<div class="oe-yn"><span>' + esc(f.l) + (f.r ? ' <b class="oe-req">*</b>' : "") + '</span><div class="oe-yn-opts">' + r("Y", "Yes") + r("N", "No") + "</div></div>";
  }
  function checkBox(f, val) {
    return '<label class="oe-check"><input type="checkbox" data-oe-inp="assess:' + esc(f.n) + '"' + (val === "true" ? " checked" : "") + "><span>" + esc(f.l) + "</span></label>";
  }
  function assessField(f, vals) {
    var val = assessGet(vals, f), id = "assess:" + f.n, re = f.r && !val;
    if (f.k === "textarea") return fieldRow(f.l, '<textarea class="oe-inp" data-oe-inp="' + esc(id) + '">' + esc(val) + "</textarea>", f.r, re);
    if (f.k === "yesno") return ynRow(f, val);
    var type = f.k === "number" ? "number" : "text";
    return fieldRow(f.l, '<input class="oe-inp" type="' + type + '" data-oe-inp="' + esc(id) + '" value="' + esc(val) + '" placeholder="' + esc(f.p) + '">', f.r, re);
  }
  // one section = a native <details> accordion (zero-JS collapse; survives typing since onInput doesn't re-render).
  // header shows a required-badge (n/m) or a filled count so the doctor sees at a glance what still needs attention.
  function assessSection(sec, vals, open) {
    var html = "", run = [];
    function flush() { if (run.length) { html += '<div class="oe-checks">' + run.map(function (f) { return checkBox(f, assessGet(vals, f)); }).join("") + "</div>"; run = []; } }
    sec.f.forEach(function (f) { if (f.k === "check") { run.push(f); return; } flush(); html += assessField(f, vals); });
    flush();
    var reqN = 0, reqDone = 0, filled = 0;
    sec.f.forEach(function (f) { var v = assessGet(vals, f); var has = v && v !== "" && v !== "N" && v !== "false"; if (has) filled++; if (f.r) { reqN++; if (v) reqDone++; } });
    var badge = reqN ? '<span class="oe-req-badge ' + (reqDone >= reqN ? "done" : "pending") + '">' + reqDone + "/" + reqN + " required</span>"
      : (filled ? '<span class="oe-cnt">' + filled + "</span>" : "");
    return '<details class="oe-acc"' + (open ? " open" : "") + '><summary class="oe-acc-h"><span class="oe-acc-ic">' + ms(sec.i) + '</span><span class="oe-acc-t">' + esc(sec.t) + "</span>" + badge + '<span class="oe-chev">' + ms("expand_more") + "</span></summary><div class=\"oe-acc-body\">" + html + "</div></details>";
  }
  // pure payload builder: EVERY schema field -> string value (yesno Y/N, check true/false, empties ""). Exposed for tests.
  function buildAssessPayload(vals) {
    var out = {};
    ASSESS_SCHEMA.forEach(function (sec) { sec.f.forEach(function (f) { out[f.n] = assessGet(vals, f); }); });
    return out;
  }
  // prefill schema values from the server field list (matched by name); missing = default.
  function buildAssessVals(serverFields) {
    var byName = {}; (serverFields || []).forEach(function (f) { if (f && f.name) byName[f.name] = f.value != null ? String(f.value) : ""; });
    var vals = {};
    ASSESS_SCHEMA.forEach(function (sec) { sec.f.forEach(function (f) { vals[f.n] = byName.hasOwnProperty(f.n) ? byName[f.n] : defVal(f.k); }); });
    return vals;
  }
  function assessTab(st) {
    if (st.assessLoading) return loadingBox("Loading assessment…");
    if (st.assessErr) return errorBox(st.assessErr);
    var vals = st.assessVals || {};
    var body = ASSESS_SCHEMA.map(function (sec, i) { return assessSection(sec, vals, i === 0); }).join("");   // History expanded, rest collapsed
    // overall required progress -> shown in the sticky save bar
    var reqAll = 0, reqDone = 0;
    ASSESS_SCHEMA.forEach(function (sec) { sec.f.forEach(function (f) { if (f.r) { reqAll++; if (assessGet(vals, f)) reqDone++; } }); });
    var done = reqDone >= reqAll;
    if (!st.writeOn) return '<div class="oe-accwrap">' + body + '</div><div class="oe-actions">' + writeNote() + "</div>";
    var bar = '<div class="oe-savebar"><div class="prog' + (done ? " done" : "") + '">' + ms(done ? "check_circle" : "edit_note") + "<span>" + reqDone + " / " + reqAll + " required filled</span></div>" +
      '<button class="oe-btn primary" data-oe-act="assess-save">' + ms("save") + "Save to GHIS</button></div>";
    return '<div class="oe-accwrap">' + body + "</div>" + bar;
  }
  function _render(state) {
    var st = state || {}, active = st.tab || "profile", body;
    if (st.loading) body = loadingBox();
    else if (st.error) body = errorBox(st.error);
    else {
      var head = patientHead(st.patient || {}, st.phone);
      if (active === "inv") body = head + invTab(st);
      else if (active === "meds") body = head + medsTab(st);
      else if (active === "assess") body = head + assessTab(st);
      else body = head + profileTab(st);
    }
    var app = '<div class="oe-app">' + header() + tabsNav(active) + '<div class="oe-canvas">' + body + "</div></div>";
    return (st.report && st.report.open) ? app + reportView(st.report) : app;   // report drawer overlays the workspace
  }

  // ---- overlay + controller ----------------------------------------------------------------
  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_opd_emr")); } catch (e) { return false; } }
  function writeFlagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_opd_emr_write")); } catch (e) { return false; } }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  function root() { var el = document.getElementById("smdOpdEmr"); if (!el) { el = document.createElement("div"); el.id = "smdOpdEmr"; document.body.appendChild(el); } return el; }
  var st = freshState();
  function freshState() { return { loading: true, error: "", tab: "profile", writeOn: false, patient: {}, labs: [], radiology: [], medications: [], phone: "", invQuery: "", invResults: [], invDraft: {}, medQuery: "", medResults: [], medDraft: {}, assessLoaded: false, assessLoading: false, assessErr: "", assessVals: {}, report: null }; }
  function paint() { root().innerHTML = _render(st); }
  function paintKeepFocus(kind) {
    paint();
    try { var el = document.querySelector('#smdOpdEmr [data-oe-inp="' + kind + '-q"]'); if (el) { el.focus(); var v = el.value; el.value = ""; el.value = v; } } catch (e) {}
  }

  function ghisAuth() {
    var t = ""; try { t = (G.GHIS && G.GHIS.getToken && G.GHIS.getToken()) || ""; } catch (e) {}
    var base = "/api/ghis"; try { base = (G.GHIS && G.GHIS.getProxyBase && G.GHIS.getProxyBase()) || base; } catch (e) {}
    return { token: t, base: base };
  }
  function authHeaders(extra) { var a = ghisAuth(), h = extra || {}; if (a.token) h.Authorization = "Bearer " + a.token; return h; }

  // ---- mirror each OPD action into the patient's visit-summary timeline (so the summary = the whole visit) ----
  // The queue timeline is a StewardMD (Firebase-authed) endpoint, NOT GHIS — so it needs the Firebase token +
  // the stewardmd.in base in-app (relative /api hits the Capacitor local origin). Best-effort; silent on failure.
  function qBase() { try { var h = (G.location && G.location.hostname) || ""; return /(^|\.)stewardmd\.in$/i.test(h) ? "" : "https://stewardmd.in"; } catch (e) { return "https://stewardmd.in"; } }
  function fbTok() { try { var u = (G.SMD_AUTH && G.SMD_AUTH.currentUser) || (G.firebase && G.firebase.auth && G.firebase.auth().currentUser); return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function addToTimeline(kind, text) {
    if (!st.ticketId || !st.sessionId || !text) return;   // only when opened from a queue ticket
    fbTok().then(function (t) {
      if (!t) return;
      fetch(qBase() + "/api/queue/timeline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
        body: JSON.stringify({ sessionId: st.sessionId, ticketId: st.ticketId, kind: kind, text: String(text).slice(0, 1000) }) }).catch(function () {});
    }).catch(function () {});
  }
  function assessSummary(v) {
    v = v || {}; var p = [];
    if (v.Chief_complaints_duration) p.push("Complaints: " + v.Chief_complaints_duration);
    if (v.provisional_diagnosis) p.push("Provisional diagnosis: " + v.provisional_diagnosis);
    if (v.management_plan) p.push("Plan: " + v.management_plan);
    return p.length ? p.join("\n") : "Initial assessment completed.";
  }

  // free-text field edits update state silently (no repaint) so focus/caret are never lost mid-typing.
  function setField(inp, val) {
    var map = { "inv-dx": ["invDraft", "diagnosis"], "med-route": ["medDraft", "route"], "med-form": ["medDraft", "form"], "med-qty": ["medDraft", "qty"], "med-freq": ["medDraft", "frequency"], "med-dur": ["medDraft", "duration"], "med-remarks": ["medDraft", "remarks"] };
    if (map[inp]) { st[map[inp][0]] = st[map[inp][0]] || {}; st[map[inp][0]][map[inp][1]] = val; return; }
    if (inp.indexOf("assess:") === 0) { st.assessVals = st.assessVals || {}; st.assessVals[inp.slice(7)] = val; }
  }
  function onInput(e) {
    var el = e.target, inp = el.getAttribute && el.getAttribute("data-oe-inp"); if (!inp) return;
    if (inp === "inv-q") { st.invQuery = el.value; scheduleSearch("inv"); return; }
    if (inp === "med-q") { st.medQuery = el.value; scheduleSearch("med"); return; }
    setField(inp, el.type === "checkbox" ? (el.checked ? "true" : "false") : el.value);   // radios carry Y/N in value
  }
  var searchTimer = null;
  function scheduleSearch(kind) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(function () { runSearch(kind); }, 250); }
  function runSearch(kind) {
    var q = kind === "inv" ? st.invQuery : st.medQuery, key = kind === "inv" ? "invResults" : "medResults";
    if (!q || q.length < 2) { st[key] = []; paintKeepFocus(kind); return; }
    var a = ghisAuth(), path = kind === "inv" ? "/inv-search" : "/drug-search";
    fetch(a.base + path + "?q=" + encodeURIComponent(q), { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : { rows: [] }; })
      .then(function (d) { st[key] = (d && d.rows) || []; paintKeepFocus(kind); })
      .catch(function () { paintKeepFocus(kind); });
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-oe-act]"); if (!b) return;
    var a = b.getAttribute("data-oe-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") return close();
    if (cmd === "tab") return switchTab(arg);
    if (cmd === "lab" || cmd === "rad") return openReport(cmd, arg);
    if (cmd === "report-close") { st.report = null; paint(); return; }
    if (cmd === "inv-pick") { var s = st.invResults[+arg]; if (s) { st.invDraft = { service: s, diagnosis: (st.invDraft && st.invDraft.diagnosis) || "", emergency: false }; st.invResults = []; st.invQuery = ""; paint(); } return; }
    if (cmd === "inv-clear") { st.invDraft = {}; paint(); return; }
    if (cmd === "inv-emg") { st.invDraft = st.invDraft || {}; st.invDraft.emergency = !st.invDraft.emergency; paint(); return; }
    if (cmd === "inv-order") return submitInvOrder();
    if (cmd === "med-pick") { var m = st.medResults[+arg]; if (m) { st.medDraft = { drug: m, route: "", form: "", qty: "", frequency: "", duration: "", remarks: "" }; st.medResults = []; st.medQuery = ""; paint(); } return; }
    if (cmd === "med-clear") { st.medDraft = {}; paint(); return; }
    if (cmd === "med-rx") return submitPrescribe();
    if (cmd === "assess-save") return submitAssessment();
  }

  function switchTab(t) { st.tab = t; paint(); if (t === "assess" && !st.assessLoaded) loadAssessment(); }

  // ---- report detail: tap a lab/radiology row -> fetch + show the actual result (GHIS lab-detail / radiology-report) ----
  function openReport(kind, arg) {
    var parts = String(arg || "").split(":");
    st.report = { open: true, kind: kind, loading: true, err: "", data: null, title: kind === "lab" ? "Lab report" : "Radiology report" };
    paint();
    var a = ghisAuth(), url = kind === "lab"
      ? "/lab-detail?renderId=" + encodeURIComponent(parts[0] || "") + "&episodeId=" + encodeURIComponent(parts[1] || "")
      : "/radiology-report?resultid=" + encodeURIComponent(parts[0] || "") + "&type=" + encodeURIComponent(parts[1] || "manual");
    fetch(a.base + url, { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: r.ok, d: {} }; }); })
      .then(function (res) {
        if (!st.report) return;
        if (!res.ok || res.d.error) { st.report.loading = false; st.report.err = res.d.error === "login_required" ? "Connect Ward Sync (GHIS) first." : "Could not load this report."; paint(); return; }
        st.report.loading = false; st.report.data = res.d; paint();
      })
      .catch(function () { if (st.report) { st.report.loading = false; st.report.err = "Could not load this report."; paint(); } });
  }
  function abnormal(t) {
    var v = parseFloat(t.result); if (isNaN(v)) return false;
    if (t.low !== "" && t.low != null && !isNaN(parseFloat(t.low)) && v < parseFloat(t.low)) return true;
    if (t.high !== "" && t.high != null && !isNaN(parseFloat(t.high)) && v > parseFloat(t.high)) return true;
    return !!(t.critical && String(t.critical).trim() && String(t.critical).toLowerCase() !== "n");
  }
  function reportView(rp) {
    var body;
    if (rp.loading) body = loadingBox("Loading report…");
    else if (rp.err) body = errorBox(rp.err);
    else {
      var d = rp.data || {};
      if (rp.kind === "lab") {
        var meta = [d.group, d.department, d.reported && ("Reported " + d.reported)].filter(Boolean).join("  ·  ");
        var rows = (d.tests || []).map(function (t) {
          var ab = abnormal(t);
          return '<div class="oe-lab-row"><div class="oe-lab-t">' + esc(t.test || "") + "</div>" +
            '<div class="oe-lab-v' + (ab ? " abn" : "") + '">' + esc(String(t.result == null ? "" : t.result)) + (t.units ? " " + esc(t.units) : "") + "</div>" +
            '<div class="oe-lab-r">' + esc(t.range || "") + "</div></div>" +
            (t.antibiogram && String(t.antibiogram).trim() ? '<div class="oe-lab-abx">' + esc(String(t.antibiogram)) + "</div>" : "");
        }).join("");
        body = (meta ? '<div class="oe-rep-meta">' + esc(meta) + "</div>" : "") + (rows ? '<div class="oe-lab-tbl"><div class="oe-lab-hd"><span>Test</span><span>Result</span><span>Reference</span></div>' + rows + "</div>" : '<div class="oe-empty sm">No values recorded in this report.</div>');
      } else {
        var meta2 = [d.testName, d.reported && ("Reported " + d.reported), d.doctor].filter(Boolean).join("  ·  ");
        body = (meta2 ? '<div class="oe-rep-meta">' + esc(meta2) + "</div>" : "") + (d.report ? '<div class="oe-rep-text">' + esc(d.report) + "</div>" : '<div class="oe-empty sm">No report text available yet.</div>');
      }
    }
    return '<div class="oe-report"><header class="oe-top">' +
      '<button class="oe-back" data-oe-act="report-close" title="Back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      '<div class="oe-rep-title">' + esc(rp.title) + "</div>" +
      '<button class="oe-close" data-oe-act="report-close" title="Close" aria-label="Close">' + ms("close") + "</button></header>" +
      '<div class="oe-canvas">' + body + "</div></div>";
  }
  function loadProfile(opts) {
    var a = ghisAuth();
    var q = "?patientId=" + encodeURIComponent(opts.patientId || "") + "&recordNo=" + encodeURIComponent(opts.recordNo || "");
    fetch(a.base + "/profile" + q, { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        var d = res.d;
        if (!res.ok || d.error === "login_required") { st.loading = false; st.error = "Connect Ward Sync (GHIS) first, then reopen the profile."; paint(); return; }
        st.loading = false; st.labs = d.labs || []; st.radiology = d.radiology || []; st.medications = d.medications || []; st.phone = d.phone || "";
        paint();
      })
      .catch(function () { st.loading = false; st.error = "Could not load the patient profile."; paint(); });
  }
  function loadAssessment() {
    st.assessLoading = true; st.assessErr = ""; paint();
    var a = ghisAuth();
    fetch(a.base + "/assessment?patientId=" + encodeURIComponent(st.patient.mrn || ""), { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        st.assessLoading = false; st.assessLoaded = true;
        if (!res.ok || res.d.error === "login_required") st.assessErr = "Connect Ward Sync (GHIS) first, then reopen this tab.";
        else st.assessVals = buildAssessVals(res.d.fields || []);
        paint();
      })
      .catch(function () { st.assessLoading = false; st.assessLoaded = true; st.assessErr = "Could not load the assessment form."; paint(); });
  }

  // Every write: explicit confirm() -> POST. 501 / disabled -> clean "being set up" toast (never a raw error).
  function postWrite(path, body, okMsg, tl) {
    var a = ghisAuth();
    fetch(a.base + path, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), credentials: "include", body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        var d = res.d;
        if (res.status === 501 || d.error === "emr_write_disabled" || d.error === "assessment_write_not_captured") { toast("This is being set up and is not live yet."); return; }
        if (res.status === 401 || d.error === "login_required") { toast("Connect Ward Sync (GHIS) first."); return; }
        if (!res.ok || d.ok === false) { toast("Could not complete the request. Please try again."); return; }
        toast(okMsg);
        if (tl && tl.text) addToTimeline(tl.kind, tl.text);   // mirror this action into the patient's visit summary
        st.invDraft = {}; st.medDraft = {};
        loadProfile({ patientId: st.patient.mrn || "", recordNo: st.recordNo || "" });
      })
      .catch(function () { toast("Could not complete the request. Please try again."); });
  }
  function confirmed(msg) { try { return !!(G.confirm && G.confirm(msg)); } catch (e) { return false; } }
  function submitInvOrder() {
    var d = st.invDraft || {}; if (!d.service) return;
    if (!confirmed('Order "' + d.service.name + '" for this patient in GHIS?')) return;
    postWrite("/inv-order", { serviceId: d.service.id, diagnosis: d.diagnosis || "", emergency: !!d.emergency }, "Investigation ordered.",
      { kind: "note", text: "Investigation ordered: " + d.service.name + (d.diagnosis ? " (for " + d.diagnosis + ")" : "") + (d.emergency ? " [emergency]" : "") });
  }
  function submitPrescribe() {
    var d = st.medDraft || {}; if (!d.drug) return;
    if (!confirmed('Prescribe "' + d.drug.name + '" for this patient in GHIS?')) return;
    postWrite("/prescribe", { drugId: d.drug.id, route: d.route || "", form: d.form || "", qty: d.qty || "", frequency: d.frequency || "", duration: d.duration || "", remarks: d.remarks || "" }, "Prescription saved.",
      { kind: "medication", text: [d.drug.name, d.route, d.form, d.qty, d.frequency, d.duration].filter(Boolean).join(" ") + (d.remarks ? " - " + d.remarks : "") });
  }
  function submitAssessment() {
    if (!confirmed("Save this assessment to GHIS?")) return;
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", fields: buildAssessPayload(st.assessVals || {}) }, "Assessment saved.",
      { kind: "assessment", text: assessSummary(st.assessVals) });
  }

  function openProfile(opts) {
    opts = opts || {};
    if (!flagOn()) return;                       // inert unless smd_opd_emr is on
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    st = freshState();
    st.patient = { name: opts.name || "", mrn: opts.patientId || "" };
    st.recordNo = opts.recordNo || "";
    st.ticketId = opts.ticketId || ""; st.sessionId = opts.sessionId || "";   // queue context -> mirror actions into the visit summary
    st.writeOn = writeFlagOn();
    if (opts.tab) st.tab = opts.tab;                          // open directly on a tab (e.g. "assess")
    paint();
    loadProfile(opts);
    if (opts.tab === "assess") loadAssessment();              // jump straight to the GHIS Initial Assessment
  }
  function close() { var el = document.getElementById("smdOpdEmr"); if (el) el.classList.remove("on"); }

  G.OPDEMR = { openProfile: openProfile, close: close, _render: _render, _assessPayload: buildAssessPayload };
})();
