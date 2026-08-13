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
  // per-field dictation mic: fills ONLY this column (dictate-into-field) - deterministic placement,
  // no LLM guessing. Shown only when a voice engine is present. Number fields keep the first number.
  function fmicBtn(name) {
    if (!G.SMD_VOICE) return "";
    if (st.voiceOn || st.voiceProcessing) return "";   // the Voice Consult owns the mic — single-field dictation is disabled while it runs (they shared one global session and stomped each other)
    var on = st.fieldMic === name;
    return '<button type="button" class="oe-fmic' + (on ? " on" : "") + '" data-oe-act="fieldmic:' + esc(name) + '" aria-label="Dictate this field" title="Dictate this field">' + ms(on ? "stop" : "mic") + "</button>";
  }
  function assessField(f, vals) {
    var val = assessGet(vals, f), id = "assess:" + f.n, re = f.r && !val;
    if (f.k === "textarea") return fieldRow(f.l, '<span class="oe-inp-wrap"><textarea class="oe-inp" data-oe-inp="' + esc(id) + '">' + esc(val) + "</textarea>" + fmicBtn(f.n) + "</span>", f.r, re);
    if (f.k === "yesno") return ynRow(f, val);
    var type = f.k === "number" ? "number" : "text";
    return fieldRow(f.l, '<span class="oe-inp-wrap"><input class="oe-inp" type="' + type + '" data-oe-inp="' + esc(id) + '" value="' + esc(val) + '" placeholder="' + esc(f.p) + '">' + fmicBtn(f.n) + "</span>", f.r, re);
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

  // ---- voice autofill: SMD_AMBIENT engine field id -> this form's GHIS field name -------------
  // Only fields opd-emr can actually SAVE are mapped; the engine also extracts radio-group findings
  // (LOC, neck stiffness, murmurs, breath sounds, abdomen shape, bowel sounds, dyspnoea, pain, …) that
  // opd-emr omits because their GHIS write-names aren't captured — those are DROPPED, never guessed.
  var OPD_KIND = {}; ASSESS_SCHEMA.forEach(function (sec) { sec.f.forEach(function (f) { OPD_KIND[f.n] = f.k; }); });
  var OPD_LABEL = {}; ASSESS_SCHEMA.forEach(function (sec) { sec.f.forEach(function (f) { OPD_LABEL[f.n] = f.l; }); });
  function fieldLabel(n) { return OPD_LABEL[n] || n; }
  var VOICE_MAP = {
    cc: "Chief_complaints_duration", presentHx: "History_present_illness", pastHx: "History_past_illness",
    temp: "Temp", bpSys: "BP_SYS", bpDia: "BP_dia", pulse: "Pulse", rr: "respiratory",
    pallor: "pallor", icterus: "icterus", cyanosis: "cyanosis", clubbing: "clubbing",
    oedema: "Oedema", lymphadenopathy: "Lymphadenopathy", rash: "Rash", goitre: "goitre",
    systemicExam: "sys_examination", gcs: "glasgow_scale", cardiacSounds: "cardiac_sound",
    tenderness: "tenderness_yesNo", abdoMass: "palpable_mass_yesNo",
    provisionalDx: "provisional_diagnosis", managementPlan: "management_plan",
    heightCm: "Height", weightKg: "Weight",
    dm: "Diabetes_yesNo", htn: "Hypertension_yesNo", cardiac: "Cardiac_yesNo",
    asthma: "Bronchial_yesNo", tb: "Tuberculosis_yesNo", thyroid: "Thyroid_yesNo", epilepsy: "Epilepsy_yesNo",
    habits: "Habitat_addiction_yesno", alcohol: "Habitat_addiction_alcohol", smoking: "Habitat_addiction_smoking",
    recDrug: "Habitat_addiction_drug", tobacco: "Habitat_addiction_tobacco"
  };
  // Alcohol quantification: "60 ml whisky" -> grams of ethanol + WHO standard drinks (10 g each).
  // grams = volume(ml) x ABV x 0.789 (ethanol density). Returns null if volume or drink-type is missing.
  var ALC_ABV = { whisky: .40, whiskey: .40, rum: .40, vodka: .40, brandy: .40, gin: .40, tequila: .40,
    "feni": .30, wine: .12, champagne: .12, beer: .05, toddy: .05, arrack: .35 };
  function alcoholCalc(detail) {
    var s = String(detail || "").toLowerCase();
    var ml = null, m = s.match(/(\d+(?:\.\d+)?)\s*(ml|milli\w*|cc)\b/);
    if (m) ml = parseFloat(m[1]);
    else { m = s.match(/(\d+(?:\.\d+)?)\s*(l|lit\w*)\b/); if (m) ml = parseFloat(m[1]) * 1000; }
    var abv = 0, type = ""; for (var k in ALC_ABV) if (s.indexOf(k) >= 0) { abv = ALC_ABV[k]; type = k; break; }
    if (!ml || !abv) return null;
    // volume of pure alcohol (ml) = ml x ABV; grams = that x 0.79 (ethanol density); 14 g = 1 standard drink.
    var pureMl = ml * abv, grams = pureMl * 0.79, std = grams / 14;
    return { ml: ml, type: type, pureMl: Math.round(pureMl * 10) / 10, grams: Math.round(grams * 10) / 10, std: Math.round(std * 10) / 10 };
  }
  // Doctor-dictated investigation orders ("let's do CBC, LFT, RFT") -> canonical names for the plan.
  // Short acronyms match word-bounded (so "esr" inside a word can't false-trigger); multi-word panels
  // match as substrings. Deterministic + on-device; a draft the doctor reviews before saving.
  var INV_DICT = [
    ["CBC", ["cbc", "cbp", "complete blood count", "full blood count", "fbc", "hemogram", "haemogram"]],
    ["LFT", ["lft", "liver function"]],
    ["RFT", ["rft", "kft", "renal function", "kidney function"]],
    ["Serum electrolytes", ["serum electrolyte", "electrolyte"]],
    ["Blood sugar", ["blood sugar", "rbs", "fbs", "ppbs", "grbs", "fasting sugar", "random sugar"]],
    ["HbA1c", ["hba1c", "glycated"]],
    ["Lipid profile", ["lipid profile", "lipid panel"]],
    ["Thyroid profile", ["tsh", "thyroid profile", "thyroid function"]],
    ["CRP", ["crp", "c reactive protein", "c-reactive"]],
    ["ESR", ["esr"]],
    ["Urine routine", ["urine routine", "urine r/e", "urine microscopy", "urine examination", "urine analysis"]],
    ["Chest X-ray", ["chest x-ray", "chest x ray", "chest xray", "cxr", "chest radiograph"]],
    ["ECG", ["ecg", "ekg", "electrocardiogram"]],
    ["2D Echo", ["2d echo", "echocardiogram", "echocardiography"]],
    ["USG abdomen", ["usg abdomen", "ultrasound abdomen", "abdominal ultrasound", "abdomen sonography"]],
    ["Blood culture", ["blood culture"]],
    ["Urine culture", ["urine culture"]],
    ["D-dimer", ["d-dimer", "d dimer"]],
    ["Troponin", ["troponin", "trop t", "trop i"]],
    ["ABG", ["abg", "arterial blood gas"]],
    ["PT/INR", ["pt inr", "pt/inr", "prothrombin", "inr"]],
    ["Peripheral smear", ["peripheral smear", "peripheral blood smear"]],
    ["Dengue serology", ["dengue", "ns1"]],
    ["Widal", ["widal"]],
    ["CT scan", ["ct scan", "ct brain", "ct head", "cect", "hrct"]],
    ["MRI", ["mri"]]
  ];
  function detectInvestigations(text) {
    var s = " " + String(text || "").toLowerCase().replace(/[^a-z0-9/ -]+/g, " ") + " ";
    var out = [], seen = {};
    INV_DICT.forEach(function (row) {
      var canon = row[0], al = row[1];
      for (var i = 0; i < al.length; i++) {
        var a = al[i], hit;
        if (/^[a-z0-9/]{1,5}$/.test(a)) hit = new RegExp("(^| )" + a.replace(/\//g, "[/ ]") + "( |$)").test(s);   // short acronym: word-bounded
        else hit = s.indexOf(a) >= 0;
        if (hit) { if (!seen[canon]) { out.push(canon); seen[canon] = 1; } break; }
      }
    });
    return out;
  }
  // coerce the engine's value to this form's wire value for the target field kind. null = don't set.
  function voiceCoerce(name, value) {
    var k = OPD_KIND[name];
    if (k === "check") return (value === true || value === "true" || value === "Yes" || value === "Y") ? "true"
      : (value === false || value === "false" || value === "No" || value === "N") ? "false" : null;
    if (k === "yesno") return (value === "Yes" || value === true || value === "Y") ? "Y"
      : (value === "No" || value === false || value === "N") ? "N" : null;
    // null = don't set. Treat empty/whitespace as "no value" too, so a later empty extraction can't
    // silently BLANK a field the doctor already voice-filled (voice writes aren't marked 'touched').
    if (value == null) return null;
    var s = String(value); return s.trim() ? s : null;
  }
  // PURE: fold SMD_AMBIENT updates into assessVals. Skips map-gated (patient-speech) + doctor-edited
  // fields (conflict, never overwrite) + unmapped engine findings. Exposed for tests. No DOM.
  function _voiceMerge(assessVals, touched, updates) {
    var out = {}, k; assessVals = assessVals || {}; touched = touched || {};
    for (k in assessVals) if (assessVals.hasOwnProperty(k)) out[k] = assessVals[k];
    var filled = [], dropped = [], conflicts = [];
    (updates || []).forEach(function (u) {
      if (!u || u.applied === false) return;                 // map-level gate (e.g. patient-reported)
      var name = VOICE_MAP[u.field];
      if (!name) { dropped.push(u.field); return; }           // engine finding opd-emr can't save
      if (touched[name]) { conflicts.push({ name: name, incoming: u.value }); return; }  // manual edit wins
      var wire = voiceCoerce(name, u.value);
      if (wire == null) return;
      out[name] = wire; filled.push(name);
    });
    return { vals: out, filled: filled, dropped: dropped, conflicts: conflicts };
  }

  // Ambient consultation control bar (shown only when the ambient engine is loaded): start/pause/stop
  // the whole-visit voice consultation, elapsed timer, the language toggle, and a live "filled N ·
  // N suggestions" readout once a refine pass has landed. Nothing is saved until the doctor taps Save
  // to GHIS (fields) or Accept (suggestions) — this bar only ever starts/stops capture.
  function fmtElapsed(ms) { var s = Math.max(0, Math.floor((ms || 0) / 1000)), m = Math.floor(s / 60); s = s % 60; return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  // "Voice Consult" panel — a glowing mic orb (breathes while listening), a live transcript box so
  // the clinician sees words land in real time, language toggle, and pause/stop + a fill readout.
  // Only ever starts/stops capture; nothing is written until Save to GHIS / Accept.
  function consultBar(st) {
    if (!G.SMD_AMBIENT) return "";
    var on = !!st.voiceOn, paused = !!st.voicePaused, processing = !!st.voiceProcessing, lang = st.voiceLang || "auto";
    function lb(v, t) { return '<button class="oe-vc-lang' + (lang === v ? " on" : "") + '" data-oe-act="vlang:' + v + '" aria-pressed="' + (lang === v) + '">' + t + "</button>"; }
    var langs = '<div class="oe-vc-langs">' + lb("auto", "Auto") + lb("en", "EN") + lb("te", "తె") + "</div>";
    var langChip = { auto: "AUTO", en: "EN", te: "TE" }[lang] || "AUTO";
    var tx = st.voiceTranscript || "";
    // "Clinical notes" box = the WHOLE consult transcript, A-to-Z. Persistent: stays below the mic
    // while listening AND after Stop. `edit` (after Stop) makes it an editable textarea with a
    // Copy + "Save to Present history" toolbar so the doctor can correct + keep the note.
    // Q&A view: best-effort Doctor/Patient turns (SMD_DIARIZE), display-only, never touches the EMR.
    // Prefers the English translation (voiceTranscriptEn) where cues are clearest; falls back to raw.
    function qaHtml() {
      var src = st.voiceTranscriptEn || tx;
      var turns = (G.SMD_DIARIZE && G.SMD_DIARIZE.toQA && src) ? G.SMD_DIARIZE.toQA(src) : [];
      if (!turns.length) return '<div class="oe-vc-box"><div class="oe-vc-tx"><span class="oe-vc-ph">The Q&amp;A view appears once there is some back-and-forth to label.</span></div></div>';
      return '<div class="oe-vc-qa">' + turns.map(function (t) {
        return '<div class="oe-vc-turn ' + (t.speaker === "doctor" ? "dr" : "pt") + '"><span class="oe-vc-who">' + (t.speaker === "doctor" ? "Doctor" : "Patient") + "</span>" + esc(t.text) + "</div>";
      }).join("") + '<div class="oe-vc-qa-note">' + ms("info") + "Auto-labelled from the conversation - may be imperfect. Never changes an EMR field.</div></div>";
    }
    function notesBox(live, edit) {
      var qa = st.notesView === "qa";
      var tog = tx ? '<span class="oe-vc-vtog">' +
        '<button class="oe-vc-vt' + (qa ? "" : " on") + '" data-oe-act="notes-view:raw">Raw</button>' +
        '<button class="oe-vc-vt' + (qa ? " on" : "") + '" data-oe-act="notes-view:qa">Q&amp;A</button></span>' : "";
      var acts = (edit && !qa && tx) ? '<span class="oe-vc-notes-acts">' +
        '<button class="oe-vc-nbtn" data-oe-act="notes-copy" aria-label="Copy notes">' + ms("content_copy") + "Copy</button>" +
        '<button class="oe-vc-nbtn primary" data-oe-act="notes-save" aria-label="Save to Present history">' + ms("save") + "Save</button></span>" : "";
      var head = '<div class="oe-vc-notes-h">' + ms("clinical_notes") + "<span>Clinical notes</span>" + tog + acts + "</div>";
      var body = qa ? qaHtml()
        : edit ? '<textarea class="oe-vc-edit" id="oeNotesEdit" data-oe-inp="notes" placeholder="Your words will appear here as you speak…">' + esc(tx) + "</textarea>"
        : '<div class="oe-vc-box' + (live ? " live" : "") + '"><div class="oe-vc-tx" id="oeTranscript">' +
          (tx ? esc(tx) : '<span class="oe-vc-ph">Your words will appear here as you speak…</span>') + "</div></div>";
      return '<div class="oe-vc-notes">' + head + body + "</div>";
    }
    // Dictated investigations as removable chips (source of truth = st.dictatedInv). Tap x to drop it
    // (also strips its line from the Management plan); tap the order glyph to place it in GHIS.
    function invChips() {
      var list = st.dictatedInv || []; if (!list.length) return "";
      var canOrder = st.source !== "local";
      return '<div class="oe-vc-orders"><div class="oe-vc-orders-h">' + ms("science") + "<span>Investigations advised</span></div><div class=\"oe-vc-chips\">" +
        list.map(function (nm, i) {
          return '<span class="oe-vc-chip2">' + esc(nm) +
            (canOrder ? '<button class="oe-vc-chiporder" data-oe-act="ivorder:' + i + '" title="Order in GHIS" aria-label="Order ' + esc(nm) + ' in GHIS">' + ms("send") + "</button>" : "") +
            '<button class="oe-vc-chipx" data-oe-act="ivx:' + i + '" title="Remove" aria-label="Remove ' + esc(nm) + '">' + ms("close") + "</button></span>";
        }).join("") + "</div></div>";
    }
    var txBox = notesBox(true);

    // PROCESSING (after Stop) — the last chunk is still transcribing + notes are drafting on-device.
    if (processing) {
      return '<div class="oe-vc processing">' +
        '<div class="oe-vc-head"><span class="oe-vc-eyebrow proc">Processing</span></div>' +
        '<div class="oe-vc-procwrap"><span class="oe-vc-spin"></span>' +
          '<div class="oe-vc-proctext"><b>Finishing your dictation…</b><span>Transcribing the last part and drafting notes.</span></div></div>' +
        '<div class="oe-vc-shimmer"><i></i></div>' +
        invChips() +
        (tx ? notesBox(false) : "") +
      "</div>";
    }

    // OFF (idle) — invite to start.
    if (!on) {
      return '<div class="oe-vc idle">' +
        '<div class="oe-vc-head"><span class="oe-vc-eyebrow">Voice Consult</span>' + langs + "</div>" +
        '<button class="oe-vc-orb" data-oe-act="voice-toggle" aria-label="Start voice consult"><span class="oe-vc-aura"></span><span class="oe-vc-aura d2"></span>' + ms("mic", true) + "</button>" +
        '<div class="oe-vc-status">' + (tx ? "Tap the mic to add more" : "Tap the mic to start") + "</div>" +
        invChips() +
        (tx ? notesBox(false, true) : "") +
        '<div class="oe-vc-sub">Speak the visit in English, Hindi or Telugu — the transcript appears below and fields fill as you talk.</div>' +
        '<div class="oe-vc-priv">' + ms("lock") + "<span>Processed on this phone only — never recorded, saved, or sent to the cloud. Please let the patient know you are taking voice notes.</span></div>" +
      "</div>";
    }

    // ON (listening / paused) — Stitch-style pill + breathing orb + live transcript.
    var bar = '<div class="oe-vc-bar">' +
        '<span class="oe-vc-live"><span class="oe-vc-dot' + (paused ? " paused" : "") + '"></span>' +
          '<span class="oe-vc-livetxt">' + (paused ? "Scribe paused" : "MaiK Scribe · Listening") + "</span></span>" +
        '<span class="oe-vc-meta"><span class="oe-vc-timer" id="oeElapsed">' + esc(fmtElapsed((st._now || now()) - (st.voiceStartedAt || now()))) + "</span>" +
          '<span class="oe-vc-chip" id="oeVcModel" title="On-device model in use">' + esc(st.voiceModel || langChip) + "</span></span>" +
        '<span class="oe-vc-acts">' +
          '<button class="oe-vc-ic" data-oe-act="voice-pause" aria-label="' + (paused ? "Resume" : "Pause") + '">' + ms(paused ? "play_arrow" : "pause") + "</button>" +
          '<button class="oe-vc-ic stop" data-oe-act="voice-stop" aria-label="Stop">' + ms("stop") + "</button></span></div>";
    var readout = (st.scribeStats && st.scribeStats.filled) ? '<div class="oe-vc-readout"><span class="oe-vc-dot ok"></span>' + st.scribeStats.filled + " field" + (st.scribeStats.filled === 1 ? "" : "s") + " filled</div>" : "";
    return '<div class="oe-vc ' + (paused ? "paused" : "listening") + ' on">' + bar +
      '<button class="oe-vc-orb" data-oe-act="voice-pause" aria-label="' + (paused ? "Resume dictation" : "Pause dictation") + '"><span class="oe-vc-aura"></span><span class="oe-vc-aura d2"></span>' + ms("mic", true) + "</button>" +
      '<div class="oe-vc-status2" id="oeVoiceStatus" aria-live="polite" aria-atomic="true">' + esc(paused ? "Paused" : (st.voiceStatus || "Listening…")) + "</div>" +
      (paused ? "" : '<div class="oe-vc-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>') +
      txBox + invChips() + readout + langs +
      '<div class="oe-vc-priv sm">' + ms("lock") + "<span>On-device · not saved or sent to the cloud</span></div>" +
    "</div>";
  }
  function now() { try { return Date.now(); } catch (e) { return 0; } }

  // ---- AI suggestions panel (review-first: Dx / differential / investigations from a refine pass).
  // Nothing here is written to the EMR or an order until the doctor taps Accept on that specific row.
  // One suggestion row: text column (name + optional score chip + optional why) on the left, a compact
  // top-aligned Accept on the right. opts = { label, score, why, accepted }.
  function scribeRow(kind, idx, opts) {
    opts = opts || {};
    return '<div class="oe-ai-row">' +
      '<div class="oe-ai-main"><div class="oe-ai-label">' + esc(opts.label) +
        (opts.score != null ? '<span class="oe-ai-score">' + Math.round(opts.score) + "</span>" : "") + "</div>" +
        (opts.why ? '<div class="oe-ai-why">' + esc(opts.why) + "</div>" : "") + "</div>" +
      (opts.accepted ? '<span class="oe-ai-added">' + ms("check") + "Added</span>"
        : '<button class="oe-ai-accept" data-oe-act="scribe-accept:' + kind + ":" + idx + '">' + ms("add") + "Accept</button>") +
      "</div>";
  }
  // A suggestion group: header (with an optional "Accept all" for sections where accepting every row is
  // meaningful — investigations, treatment, corrections; NOT the differential or the single provisional).
  function aiGroup(title, rowsHtml, acceptAllKind, count) {
    return '<div class="oe-ai-group"><div class="oe-ai-ghead"><h4>' + title + "</h4>" +
      (acceptAllKind && count > 1 ? '<button class="oe-ai-acceptall" data-oe-act="scribe-acceptall:' + acceptAllKind + '">' + ms("done_all") + "Accept all</button>" : "") +
      "</div>" + rowsHtml + "</div>";
  }
  function correctionLabel(c) { return c.type === "spelling" ? ('Spelling: "' + c.from + '" to "' + c.to + '"') : c.issue; }
  function correctionSub(c) {
    if (c.type === "spelling") return "in " + fieldLabel(c.field);
    return "Move to " + fieldLabel(c.targetField) + ': "' + String(c.from).replace(/\n/g, " / ").slice(0, 60) + '"';
  }
  function suggestionsPanel(st) {
    var s = st.scribeSuggestions; if (!s) return "";
    var body = "";
    // Must-not-miss red flags first — surfaced only, never accepted or written to the chart.
    if (s.redFlags && s.redFlags.length) {
      body += '<div class="oe-ai-redflags">' + ms("warning") + "<div><b>Must-not-miss red flags</b><ul>" +
        s.redFlags.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul></div></div>";
    }
    if (s.provisionalDx) body += aiGroup("Provisional diagnosis", scribeRow("dx", 0, { label: s.provisionalDx, why: s.provisionalWhy, accepted: !!s.acceptedDx }), null, 1);
    if (s.ddx && s.ddx.length) body += aiGroup("Differential", s.ddx.map(function (d, i) { return scribeRow("ddx", i, { label: d.label, score: d.score, why: d.why, accepted: !!(s.acceptedDdx && s.acceptedDdx[i]) }); }).join(""), null, s.ddx.length);
    if (s.investigations && s.investigations.length) body += aiGroup("Investigations to consider", s.investigations.map(function (d, i) { return scribeRow("inv", i, { label: d.label, accepted: !!(s.acceptedInv && s.acceptedInv[i]) }); }).join(""), "inv", s.investigations.length);
    if (s.treatment && s.treatment.length) body += aiGroup("Management / Treatment", s.treatment.map(function (d, i) { return scribeRow("rx", i, { label: d.label, accepted: !!(s.acceptedRx && s.acceptedRx[i]) }); }).join(""), "rx", s.treatment.length);
    if (s.corrections && s.corrections.length) body += aiGroup("EMR corrections", s.corrections.map(function (c, i) { return scribeRow("fix", i, { label: correctionLabel(c), why: correctionSub(c), accepted: !!(s.acceptedFix && s.acceptedFix[i]) }); }).join(""), null, s.corrections.length);
    if (!body) return "";
    // Pro (Vertex) upgrade: offer a deeper LLM differential (explicit tap = consent to send the note).
    var pro = (G.SMD_AI && G.SMD_AI.extract && s.source !== "pro")
      ? '<button class="oe-maik-pro" data-oe-act="assess-maik-pro"' + (st.maikProBusy ? " disabled" : "") + ">" + ms(st.maikProBusy ? "hourglass_top" : "auto_awesome") +
        "<span>" + (st.maikProBusy ? "MaiK Pro is thinking" : "Deepen with MaiK Pro") + "<span class=\"oe-maik-pro-note\">" + (st.maikProBusy ? "sending the note to AI" : "sends the note (no name / MR) to AI") + "</span></span></button>"
      : "";
    return '<section class="oe-ai-panel' + (st.scribeAnim ? " smd-in" : "") + '"><h3 class="oe-h3">' + ms("auto_awesome") + "MaiK suggestions" +
      (s.source === "pro" ? '<span class="oe-tag oe-pro">MaiK Pro</span>' : "") +
      '<span class="oe-tag oe-review">Review before use</span></h3>' + body + pro +
      '<div class="oe-ai-disc">' + ms("info") +
      "<span>Decision support only. Provisional and advisory; not a substitute for clinical judgement. Nothing is saved until you Accept and Save. Verify doses, contraindications and local protocol.</span></div>" +
      "</section>";
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
    // Ask MaiK: its own glowing AI banner (Option C), separate from the save actions.
    var maikCta = (maikOn() && G.DX) ?
      '<button class="oe-maik-cta' + (st.maikBusy ? " busy" : "") + '" data-oe-act="assess-maik"' + (st.maikBusy ? " disabled" : "") + ' aria-label="Ask MaiK">' +
        '<span class="oe-maik-glow" aria-hidden="true"></span>' +
        '<span class="oe-maik-ico">' + ms(st.maikBusy ? "hourglass_top" : "auto_awesome") + "</span>" +
        '<span class="oe-maik-txt"><b>' + (st.maikBusy ? "MaiK is thinking" : "Ask MaiK") + "</b>" +
        "<span>" + (st.maikBusy ? "Reading your notes" : "Diagnosis, investigations &amp; treatment from your notes") + "</span></span>" +
      "</button>" : "";
    var bar = '<div class="oe-savebar"><div class="prog' + (done ? " done" : "") + '">' + ms(done ? "check_circle" : "edit_note") + "<span>" + reqDone + " / " + reqAll + " required filled</span></div>" +
      '<button class="oe-btn ghost" data-oe-act="assess-clear" title="Clear every field and save a blank assessment">' + ms("delete_sweep") + "Clear</button>" +
      '<button class="oe-btn primary" data-oe-act="assess-save">' + ms("save") + "Save to " + ((st && st.emrLabel) || "GHIS") + "</button></div>";
    return consultBar(st) + '<div class="oe-accwrap">' + body + "</div>" + maikCta + suggestionsPanel(st) + bar + (st.savedConsult ? postConsultPanel() : "");
  }
  // After a GHIS save the assessment IS the consult record; offer the two ways to finish: swipe to
  // close the consult (ends it / advances the queue) or the red button to send the patient to Emergency.
  function postConsultPanel() {
    return '<div class="oe-postsave"><div class="oe-postsave-msg">' + ms("check_circle") + "Saved to " + emrLabel() + " Initial Assessment. Close the consult, or send to Emergency.</div>" +
      '<div class="oe-swipe" id="oeSwipe" role="button" tabindex="0" aria-label="Close consult — swipe, or press Enter"><div class="oe-swipe-fill"></div><span class="oe-swipe-txt">Swipe to close consult</span><div class="oe-swipe-knob" id="oeSwipeKnob">' + ms("chevron_right") + "</div></div>" +
      '<button class="oe-btn er" data-oe-act="consult-er">' + ms("emergency") + "Send to Emergency (ER)</button></div>";
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
  function freshState() { return { loading: true, error: "", tab: "profile", writeOn: false, patient: {}, labs: [], radiology: [], medications: [], phone: "", invQuery: "", invResults: [], invDraft: {}, medQuery: "", medResults: [], medDraft: {}, assessLoaded: false, assessLoading: false, assessErr: "", assessVals: {}, report: null, scribeSuggestions: null, scribeStats: null, fieldMic: null, savedConsult: false, dictatedInv: [], voiceTranscript: "", voiceTranscriptEn: "", notesView: "raw", _notesSavedText: "" }; }
  function paint() { root().innerHTML = _render(st); try { initCloseSwipe(); } catch (e) {} }
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
    if (inp.indexOf("assess:") === 0) { var an = inp.slice(7); st.assessVals = st.assessVals || {}; st.assessVals[an] = val; st.assessTouched = st.assessTouched || {}; st.assessTouched[an] = true; }
  }
  function onInput(e) {
    var el = e.target, inp = el.getAttribute && el.getAttribute("data-oe-inp"); if (!inp) return;
    if (inp === "inv-q") { st.invQuery = el.value; scheduleSearch("inv"); return; }
    if (inp === "med-q") { st.medQuery = el.value; scheduleSearch("med"); return; }
    if (inp === "notes") { st.voiceTranscript = el.value; _lastFullTranscript = el.value; return; }   // doctor edits the clinical-notes transcript after Stop
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
    if (cmd === "assess-maik") return askMaik();
    if (cmd === "assess-maik-pro") return askMaikPro();
    if (cmd === "assess-clear") return clearAssessment();
    if (cmd === "voice-toggle") { if (!st.voiceOn) startVoice(); return; }
    if (cmd === "voice-pause") return togglePauseVoice();
    if (cmd === "voice-stop") return stopVoice();
    if (cmd === "vlang") { st.voiceLang = arg; if (st.voiceOn) { stopVoice(); } else { paint(); } return; }
    if (cmd === "scribe-accept") { var p = String(arg).split(":"); return scribeAccept(p[0], +p[1]); }
    if (cmd === "scribe-acceptall") return scribeAcceptAll(arg);
    if (cmd === "fieldmic") return toggleFieldMic(arg);
    if (cmd === "consult-er") return consultToER();
    if (cmd === "ivx") { var xi = +arg, xn = (st.dictatedInv || [])[xi]; if (xn != null) { st.dictatedInv.splice(xi, 1); stripPlanLine(xn); paint(); } return; }
    if (cmd === "ivorder") { var on = (st.dictatedInv || [])[+arg]; if (on != null) { st.tab = "inv"; st.invQuery = on; paint(); runSearch("inv"); } return; }
    if (cmd === "notes-copy") return copyNotes();
    if (cmd === "notes-save") return saveNotesToHistory();
    if (cmd === "notes-view") { st.notesView = (arg === "qa") ? "qa" : "raw"; paint(); return; }
  }
  // Drop one dictated-investigation's line from the Management plan (paired with removing its chip).
  function stripPlanLine(name) {
    if (!(st.assessVals && st.assessVals.management_plan)) return;
    var kept = st.assessVals.management_plan.split("\n").filter(function (l) { return l.trim() !== ("Ix: " + name); });
    st.assessVals.management_plan = kept.join("\n"); putVoiceDom("management_plan");
  }
  function copyNotes() {
    var t = st.voiceTranscript || ""; if (!t) { toast("Nothing to copy"); return; }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { toast("Notes copied"); }, function () { toast("Copy failed"); }); return; } } catch (e) {}
    toast("Copy not available on this device");
  }
  // Fold the whole consult transcript into the assessment's Present history (append, never overwrite),
  // then jump to the Assessment tab so the doctor sees it landed.
  // PURE + idempotent: fold the consult note `t` into existing Present-history `cur`. If a prior Save
  // already folded a block (`prev`) in, drop that exact block first so re-saving refreshes rather than
  // duplicates. Returns null when there's nothing to save. Exposed for tests.
  function mergeNoteIntoHistory(cur, prev, t) {
    t = String(t == null ? "" : t).trim(); if (!t) return null;
    cur = String(cur || ""); prev = String(prev || "");
    if (prev && cur.indexOf(prev) >= 0) cur = cur.replace(prev, "").replace(/\n{2,}/g, "\n").trim();
    return { text: cur ? (cur.replace(/\s+$/, "") + "\n" + t) : t, saved: t };
  }
  function saveNotesToHistory() {
    var m = mergeNoteIntoHistory(st.assessVals && st.assessVals.History_present_illness, st._notesSavedText, st.voiceTranscript);
    if (!m) { toast("Nothing to save"); return; }
    st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
    st.assessVals.History_present_illness = m.text; st._notesSavedText = m.saved;
    st.assessTouched.History_present_illness = true;
    toast("Saved to Present history");
    switchTab("assess");
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
  // GHIS lab results can be HTML (histopath/culture narratives). Turn block tags into line breaks, drop the
  // rest, decode entities -> readable plain text (mirrors the server's htmlToText for radiology).
  function plainText(s) {
    return String(s == null ? "" : s)
      .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/g, "'").replace(/&quot;/gi, '"')
      .replace(/[ \t]{2,}/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
        // GHIS results are often HTML (histopath/culture narratives) -> render as readable text, not raw tags.
        var rows = (d.tests || []).map(function (t) {
          var res = plainText(t.result), abx = plainText(t.antibiogram);
          // long / multi-line narrative (histopathology, culture report) -> full-width readable block
          if (res.length > 70 || /\n/.test(res) || abx) {
            return '<div class="oe-lab-report"><div class="oe-lab-t">' + esc(t.test || "Report") + (t.units ? ' <span class="oe-lab-u">' + esc(t.units) + "</span>" : "") + "</div>" +
              (res ? '<div class="oe-rep-text">' + esc(res) + "</div>" : "") +
              (abx ? '<div class="oe-lab-abx">' + esc(abx) + "</div>" : "") + "</div>";
          }
          // short numeric value -> compact Test / Result / Reference row
          var ab = abnormal(t);
          return '<div class="oe-lab-row"><div class="oe-lab-t">' + esc(t.test || "") + "</div>" +
            '<div class="oe-lab-v' + (ab ? " abn" : "") + '">' + esc(res) + (t.units ? " " + esc(t.units) : "") + "</div>" +
            '<div class="oe-lab-r">' + esc(t.range || "") + "</div></div>";
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
    if (st.source === "local") { st.loading = false; paint(); return; }   // personal clinic: no hospital profile/labs to fetch
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
    if (st.source === "local") {   // personal clinic: prefill from the on-device store (no GHIS fetch)
      st.assessLoaded = true; st.assessLoading = false; st.assessErr = "";
      st.assessVals = (_localStore && _localStore.getConsult) ? (_localStore.getConsult(st.patient.mrn) || {}) : {};
      paint(); return;
    }
    st.assessLoading = true; st.assessErr = ""; paint();
    var a = ghisAuth();
    fetch(a.base + "/assessment?patientId=" + encodeURIComponent(st.patient.mrn || "") + "&episodeId=" + encodeURIComponent(st.episodeId || ""), { headers: authHeaders(), credentials: "include" })
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
  function postWrite(path, body, okMsg, tl, onOk) {
    var a = ghisAuth();
    fetch(a.base + path, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), credentials: "include", body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        var d = res.d;
        if (res.status === 501 || d.error === "emr_write_disabled" || d.error === "assessment_write_not_captured") { toast("This is being set up and is not live yet."); return; }
        if (res.status === 401 || d.error === "login_required") { toast("Connect Ward Sync (GHIS) first."); return; }
        if (!res.ok || d.ok === false) { toast(d.resp ? ("GHIS: " + String(d.resp).slice(0, 90)) : "Could not complete the request. Please try again."); return; }
        toast(okMsg);
        if (tl && tl.text) addToTimeline(tl.kind, tl.text);   // mirror this action into the patient's visit summary
        st.invDraft = {}; st.medDraft = {};
        if (onOk) try { onOk(); } catch (e) {}
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
    if (st.source === "local") {   // personal clinic: save the consult on-device (no GHIS)
      if (!confirmed("Save this consult to " + emrLabel() + " on this phone?")) return;
      try { if (_localStore && _localStore.saveConsult) _localStore.saveConsult(st.patient.mrn, buildAssessPayload(st.assessVals || {}), st.assessVals || {}); } catch (e) {}
      st.savedConsult = true; toast("Saved to " + emrLabel() + " on this device."); paint(); return;
    }
    if (!confirmed("Save this assessment to " + emrLabel() + "?")) return;
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", fields: buildAssessPayload(st.assessVals || {}) }, "Saved to " + emrLabel() + ". It appears under the patient's Initial Assessment (not Clinical notes).",
      { kind: "assessment", text: assessSummary(st.assessVals) }, function () { st.savedConsult = true; paint(); });
  }
  // Clear every field and save the blank assessment to GHIS (deliberate wipe of the current Initial Assessment).
  function clearAssessment() {
    if (!confirmed("Clear every field and save a blank assessment to " + emrLabel() + "? This wipes the current Initial Assessment.")) return;
    st.assessVals = {}; st.assessTouched = {};
    paint();
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", fields: buildAssessPayload({}) }, "Assessment cleared in " + emrLabel() + ".",
      { kind: "assessment", text: "Assessment cleared" });
  }

  // ---- voice fill (ambient dictation -> assessVals + live DOM, doctor edits protected) ----------
  var _amb = null, _elapsedTmr = null, _lastFullTranscript = "", _procTmr = null, _priorTranscript = "";
  // Clear the "Finishing your dictation…" state once the last chunk + refine have landed (or on a safety timeout).
  function finishProcessing() { if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; } if (!st.voiceProcessing) return; st.voiceProcessing = false; paint(); }
  function setVoiceStatus(t) { st.voiceStatus = t; try { var e = document.getElementById("oeVoiceStatus"); if (e) e.textContent = t; } catch (x) {} }
  // Live transcript into the Voice Consult box (updates the DOM without a full repaint; keeps it scrolled).
  function setTranscript(t) {
    st.voiceTranscript = t || "";
    try {
      var e = document.getElementById("oeTranscript"); if (!e) return;
      if (t) e.textContent = t; else e.innerHTML = '<span class="oe-vc-ph">Your words will appear here as you speak…</span>';
      var box = e.parentNode; if (box && box.scrollHeight) box.scrollTop = box.scrollHeight;
    } catch (x) {}
  }
  // Which on-device model is transcribing right now (updates live as Auto mode adapts per chunk).
  function setModelChip(code) { st.voiceModel = code || ""; try { var e = document.getElementById("oeVcModel"); if (e && code) e.textContent = code; } catch (x) {} }
  function tickElapsed() { try { var e = document.getElementById("oeElapsed"); if (e) e.textContent = fmtElapsed(now() - (st.voiceStartedAt || now())); } catch (x) {} }
  function putVoiceDom(name) {
    try {
      var esc2 = (G.CSS && CSS.escape) ? CSS.escape(name) : name;
      var els = document.querySelectorAll('#smdOpdEmr [data-oe-inp="assess:' + esc2 + '"]');
      if (!els.length) return;
      var acc = els[0].closest && els[0].closest("details.oe-acc"); if (acc && !acc.open) acc.open = true;   // reveal a section the voice just filled (vitals live in a collapsed accordion)
      var wire = st.assessVals[name];
      if (OPD_KIND[name] === "yesno") { [].forEach.call(els, function (r) { r.checked = (r.value === wire); }); tint(els[0]); return; }
      var el = els[0];
      if (el.type === "checkbox") el.checked = (wire === "true"); else el.value = wire;
      tint(el);
    } catch (x) {}
  }
  function tint(el) { try { var f = el.closest ? (el.closest(".oe-field") || el.closest(".oe-yn") || el.closest(".oe-check") || el) : el; if (f && f.classList) f.classList.add("oe-voice"); } catch (x) {} }
  function applyVoice(res) {
    var m = _voiceMerge(st.assessVals, st.assessTouched, (res && res.updates) || []);
    st.assessVals = m.vals;
    m.filled.forEach(putVoiceDom);
    var msg = m.filled.length ? ("Filled " + m.filled.length + " field" + (m.filled.length === 1 ? "" : "s")) : "";
    if (m.conflicts.length) msg += (msg ? " · " : "") + m.conflicts.length + " kept (you edited)";
    if (msg) setVoiceStatus(msg);
  }
  // narrative fields (complaints / history / stated dx & plan) via the LLM extractor — vitals + exam
  // stay deterministic on-device. SMD_AMBIENT throttles this + only calls it for genuine narrative.
  function assessLLM(transcript) {
    if (!(G.SMD_AI && G.SMD_AI.extract)) return null;
    return G.SMD_AI.extract(transcript, "assessment").then(function (r) {
      if (!(r && !r.error && r.fields)) return null;
      // Avoid racing the opd-scribe refine (onRefine → doRefine) over cc/presentHx/pastHx: keep ONLY the
      // fields opd-scribe does not emit (the doctor's explicit provisional dx / plan). Two async LLM
      // calls writing the same fields had no ordering guarantee (last write wins).
      var f = {}; ["provisionalDx", "managementPlan"].forEach(function (k) { if (r.fields[k]) f[k] = r.fields[k]; });
      return Object.keys(f).length ? { fields: f, confidence: 0.7 } : null;
    }).catch(function () { return null; });
  }
  // Grounding inputs for SMD_SCRIBEGROUND.ground(): the differential/investigations engine adapter is
  // not wired here yet (the antibiotic/reasoning engine's differential() is closure-bound to its own
  // finding state, not a plain findingKeys->ddx function) — ground() with empty engine inputs still
  // safely forwards the LLM's own ddx/investigations (source:"ai"), never fabricating anything.
  // Build the SMD_NLP extraction context from the DX engine's finding catalog (keys + labels).
  function nlpCtx() {
    var cat = (G.DX && G.DX.findingCatalog) ? G.DX.findingCatalog() : [];
    var valid = {}, labels = {};
    cat.forEach(function (c) { if (c && c.key) { valid[c.key] = 1; labels[c.key] = c.label || c.key; } });
    return { valid: valid, labels: labels, syn: {} };
  }
  // Pure findingKeys -> ranked differential via the DX engine, WITHOUT disturbing the live reasoning
  // workspace: snapshot S.f, score on the given keys, restore. Synchronous, so nothing interleaves;
  // derived caches (fInf/_dom) self-heal on the next real differential() call.
  function differentialFor(keys) {
    var DX = G.DX;
    if (!(DX && DX._differential && DX._state)) return [];
    var S = DX._state, savedF = S.f;
    try {
      var f = {}; (keys || []).forEach(function (k) { if (k) f[k] = true; });
      S.f = f;
      var d = DX._differential() || {};
      return (d.inf || []).concat(d.ni || []).map(function (r) { return { id: r.id, dx: r.name, score: r.score, inv: r.inv || [], reason: r.reason || "", red: r.red || [] }; });
    } catch (e) { return []; } finally { S.f = savedF; }
  }
  // Grounding options for SMD_SCRIBEGROUND.ground(): extract findings from the transcript
  // (deterministic, SMD_NLP over the DX catalog) and anchor the differential + investigations to the
  // StewardMD engine. Precomputed once, so it is independent of ground()'s call order.
  function groundOpts(transcript) {
    var findings = (G.SMD_NLP && G.SMD_NLP.extract) ? ((G.SMD_NLP.extract(transcript || "", nlpCtx()) || {}).present || []) : [];
    var diff = differentialFor(findings);
    var invMap = {}; diff.forEach(function (x) { if (x.inv && x.inv.length) invMap[x.dx] = x.inv; });
    var ddx = diff.map(function (x) { return { dx: x.dx, score: x.score }; });
    return { findings: findings, differential: function () { return ddx; }, investigationsFor: function (dx) { return invMap[dx] || []; } };
  }
  // ---- Ask MaiK (on-device, PHI-safe): the entered assessment -> Dx / Mx / Rx suggestions --------
  // Everything below reasons in-memory on-device. The ONLY network call is loadTreatment()'s fetch of a
  // STATIC disease-treatment file (/kb/treatments/<id>.json) whose URL carries a disease id, never a
  // patient identifier — no PHI leaves the device. Advisory only: nothing is written to the EMR until
  // the doctor taps Accept on a specific row (and then Save to GHIS). Base (free) tier — the reasoning
  // engine "M"; the Pro (Vertex) tier is a later phase.
  // ON by default (advisory-only); kill on a device with localStorage.setItem("smd_opd_maik","off").
  function maikOn() { try { if (G.localStorage && localStorage.getItem("smd_opd_maik") === "off") return false; } catch (e) {} return true; }
  // GHIS is GIMSR's EMR; any other connected EMR (Connect) shows a generic label. Set from openProfile
  // opts.emrLabel / opts.source; defaults to GHIS.
  function emrLabel() { return (st && st.emrLabel) ? st.emrLabel : "GHIS"; }

  // PURE: the free-text the engine reasons over — only the narrative + comorbid fields the doctor
  // already typed. Positive comorbids are appended as plain words so the engine weighs them.
  function assessFindingsText(v) {
    v = v || {};
    var parts = [v.Chief_complaints_duration, v.History_present_illness, v.History_past_illness, v.sys_examination, v.provisional_diagnosis];
    if (v.Diabetes_yesNo === "Y") parts.push("diabetes");
    if (v.Hypertension_yesNo === "Y") parts.push("hypertension");
    if (v.Cardiac_yesNo === "Y") parts.push("cardiac disease");
    if (v.Bronchial_yesNo === "Y") parts.push("asthma");
    if (v.Tuberculosis_yesNo === "Y") parts.push("tuberculosis");
    return parts.filter(function (x) { return x && String(x).trim(); }).map(function (x) { return String(x).trim(); }).join(". ");
  }

  // Clear medical-term misspellings (NOT real words, so replacement is safe). Deliberately small and
  // conservative — a doctor's shorthand must never be "corrected" into something wrong.
  var MED_TYPOS = {
    diabetis: "diabetes", diabetese: "diabetes", hypertention: "hypertension", hypertenstion: "hypertension",
    pancreatits: "pancreatitis", pnuemonia: "pneumonia", astma: "asthma", jaundince: "jaundice",
    vomitting: "vomiting", breathlessnes: "breathlessness", headche: "headache", feaver: "fever",
    tuberculosos: "tuberculosis", ceizure: "seizure", palpitaion: "palpitation", giddyness: "giddiness"
  };
  // A prescription line. We only look at the line's LEADING clause (before the first comma/semicolon or
  // a spaced dash) so "CAP - started Augmentin 625mg" keeps the diagnosis clause "CAP" and is not moved.
  // That clause must START with a dosage-form word AND carry a dose in the SAME clause. This never flags
  // bare "mg" (lab "450 mg/dl"), "OD" (right eye), or "CAP" (community-acquired pneumonia). A line that
  // matches is a pure prescription, so moving the whole line evicts nothing else.
  function rxLine(line) {
    var clause = String(line).trim().split(/[,;]|\s[-–]\s/)[0].trim();   // leading clause only; spaced dash, not drug hyphens
    return /^(tab|tablet|cap|capsule|inj|injection|syp|syr|syrup|oint|ointment|neb|supp|susp|drops?)\b\.?\s+\S/i.test(clause) && /\b\d+\s*(mg|mcg|ml|g|iu|units?)\b/i.test(clause);
  }
  // A substance/social HISTORY statement (belongs in Personal history, not the Complaint). Conservative:
  // requires the line to be PHRASED as history (an explicit h/o / known prefix, or a consumption verb),
  // and NOT to attach a presenting complaint (so "chronic smoker with hemoptysis" is left in place).
  function substanceHistoryLine(line) {
    var t = String(line);
    if (!/\b(alcohol|alcoholic|smoking|smoker|tobacco|cigarette|beedi|bidi|gutka)\b/i.test(t)) return false;
    var phrasedAsHistory = /\b(h\/o|k\/c\/o|history of|known)\b/i.test(t) || /\b(consum\w*|drinks?|smokes?|uses?|takes?|intake|addicted|dependence)\b/i.test(t);
    if (!phrasedAsHistory) return false;
    // a conjunction that pulls in a symptom means a complaint is attached to this line -> do not move it
    if (/\b(with|and|presenting|complain|c\/o|since|for|x)\b[^]*\b(pain|fever|cough|breathless|dyspn|vomit|nausea|headache|giddi|dizz|swelling|bleed|rash|weak|loss|hemoptysis|h[ae]matemesis|melena|jaundice|palpitation|seizure|altered|confus|hematuria|dysuria|discharge)\b/i.test(t)) return false;
    return true;
  }
  // PURE: deterministic EMR-hygiene checks over the entered assessment. Conservative (high-confidence
  // patterns only) so it never nags on legitimate text. Returns correction objects; NOTHING is applied
  // until the doctor taps Accept on that row. Two kinds: "misplaced" (content that belongs in another
  // field -> accept moves it) and "spelling" (a clear medical typo -> accept replaces it in place).
  function emrCorrections(v) {
    v = v || {}; var out = [];
    // 1) Prescription line sitting in the Diagnosis field -> Management plan.
    var dxLines = String(v.provisional_diagnosis || "").split("\n").filter(function (l) { return l.trim(); });
    var rxInDx = dxLines.filter(rxLine);
    if (rxInDx.length) out.push({ type: "misplaced", field: "provisional_diagnosis", targetField: "management_plan",
      issue: "Looks like a prescription in the Diagnosis field", from: rxInDx.join("\n"), fromLines: rxInDx });
    // 2) Substance/social history sitting in the Chief complaint field -> Personal history (habits).
    var ccLines = String(v.Chief_complaints_duration || "").split("\n").filter(function (l) { return l.trim(); });
    var subInCc = ccLines.filter(substanceHistoryLine);
    if (subInCc.length) out.push({ type: "misplaced", field: "Chief_complaints_duration", targetField: "Habitat_addiction_others",
      issue: "Substance/social history in the Complaint field", from: subInCc.join("\n"), fromLines: subInCc });
    // 3) Clear medical-term spelling fixes across the narrative fields.
    ["Chief_complaints_duration", "History_present_illness", "History_past_illness", "provisional_diagnosis", "management_plan"].forEach(function (fld) {
      var txt = String(v[fld] || ""); if (!txt) return;
      Object.keys(MED_TYPOS).forEach(function (bad) {
        if (new RegExp("\\b" + bad + "\\b", "i").test(txt)) out.push({ type: "spelling", field: fld, issue: "Spelling", from: bad, to: MED_TYPOS[bad] });
      });
    });
    return out;
  }

  // PURE: a disease-treatment JSON (kb/treatments/<id>.json) -> Rx lines. Picks the highest-precedence
  // recommendation, then its drug regimens (composition — dose route freq) and up to 4 non-drug steps.
  function treatmentLines(tj) {
    if (!tj || !tj.recommendations || !tj.recommendations.length) return { rx: [], steps: [] };
    var prec = tj.precedence || [];
    var recs = tj.recommendations.slice().sort(function (a, b) {
      var ai = prec.indexOf(a.tier), bi = prec.indexOf(b.tier);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    var rec = recs[0];
    var rx = (rec.drugRefs || []).map(function (d) {
      var dosing = [d.dose, d.route, d.freq].filter(Boolean).join(" ");
      return [d.composition, dosing].filter(Boolean).join(" · ");
    }).filter(Boolean);
    return { rx: rx, steps: (rec.steps || []).slice(0, 4), regimen: rec.regimenLabel || "" };
  }

  // PURE: differentialFor returns infective THEN non-infective (the antibiotic gate's order); rank the
  // DIFFERENTIAL purely by score so a higher-scoring non-infective dx (e.g. ACS) is not buried beneath a
  // lower-scoring infective one. Stable within equal scores; does not mutate the input.
  function rankDifferential(diff) {
    return (diff || []).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }

  // Classically AFEBRILE presentations — fever is a strong argument against these.
  var AFEBRILE_MIMIC = [/subarachnoid/i, /\bcolic\b/i, /cholelithiasis/i, /biliary/i, /migraine/i, /tension-type/i, /non-cardiac chest/i, /\bgerd\b/i, /panic|anxiety/i, /pneumothorax/i, /aortic dissection/i, /aortic stenosis/i, /musculoskeletal/i, /tamponade/i, /hypovol|haemorrhagic|hemorrhagic shock/i];
  // Chronic / rare "diagnosis of exclusion" conditions that over-trigger on generic fever in the base
  // score model — they should not LEAD an acute febrile presentation (still shown, just not on top).
  var NOT_ACUTE_LEAD = [/hemophagocytic|\bHLH\b/i, /sarcoidosis/i, /malignancy/i, /serotonin syndrome|\bNMS\b/i, /systemic vasculitis/i];
  // PURE: nudge the engine differential with robust, textbook clinical discriminators the base score
  // model misses (measured gaps: infective dx losing to non-infective mimics). Adjustments are MODERATE
  // (re-rank, not override) and preserve every field on each entry. Shared with the benchmark so each
  // rule's effect is measured. Only fires when the discriminating findings are present.
  function clinicalRerank(list, keys) {
    var f = {}; (keys || []).forEach(function (k) { if (k) f[k] = 1; });
    var scored = (list || []).map(function (e) {
      var adj = 0, n = e.dx || e.name || "";
      if (f.fever) {
        if (AFEBRILE_MIMIC.some(function (re) { return re.test(n); })) adj -= 18;                          // fever vs an afebrile dx
        if (NOT_ACUTE_LEAD.some(function (re) { return re.test(n); })) adj -= 20;                          // don't lead with a chronic/rare dx on acute fever
      }
      if (/thyroid storm|thyrotox/i.test(n) && !(f.goitre || f.tremor || f.heatIntolerance || f.thyroidHx || f.weightLoss)) adj -= 28;   // no thyroid storm without thyroid signs
      if (f.fever && f.neckStiffness && /mening/i.test(n)) adj += 26;                                      // fever + meningism -> meningitis
      if (f.fever && f.purulentSputum && /pneumonia/i.test(n)) adj += 26;                                   // fever + PURULENT sputum -> pneumonia (cough alone is too weak — it displaces TB)
      if (f.fever && (f.dysuria || f.flankPain) && /(pyelo|urinary|uti)/i.test(n)) adj += 20;               // fever + urinary -> pyelonephritis
      if (f.fever && f.jaundice && /cholangitis/i.test(n)) adj += 24;                                       // fever + jaundice (Charcot) -> cholangitis
      if (f.hypotension && (f.lactate || f.tachycardia) && /(sepsis|septic)/i.test(n)) adj += 22;           // shock + lactate -> sepsis
      if (f.purulentSputum && /asthma/i.test(n)) adj -= 16;                                                 // purulent sputum is not asthma
      var c = {}; for (var k in e) c[k] = e[k]; c.score = (e.score || 0) + adj; return c;
    });
    return scored.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }

  // Keep surfaced/accepted clinical text app-clean: em-dash -> comma (sentence separator), en-dash ->
  // hyphen (number ranges like 70-90), arrow -> "to". Drug-name hyphens (piperacillin-tazobactam) are
  // untouched. Applied to everything MaiK shows AND to what Accept folds into the chart, so no em-dash
  // ever reaches GHIS.
  function cleanClinical(s) {
    return String(s == null ? "" : s).replace(/\s*—\s*/g, ", ").replace(/–/g, "-").replace(/\s*→\s*/g, " to ").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
  }
  // PURE: engine differential (+ treatments keyed by dx id) -> the review-panel model.
  // Dx = provisional + differential (with scores); Mx = deduped investigation workup; Rx = drug
  // regimens + management steps for the TOP-2 working diagnoses (deduped, case-insensitive).
  function buildMaikSuggestions(diff, treatMap) {
    diff = diff || []; treatMap = treatMap || {};
    var top = diff.slice(0, 6);
    var provisionalDx = top.length ? cleanClinical(top[0].dx) : "";
    var provisionalWhy = top.length ? cleanClinical(top[0].reason || "") : "";
    var ddx = top.slice(1).map(function (r) { var nm = cleanClinical(r.dx); return { label: nm, dx: nm, score: r.score, source: "engine", why: cleanClinical(r.reason || "") }; });
    var invSeen = {}, investigations = [];
    top.forEach(function (r) {
      (r.inv || []).forEach(function (ix) {
        var k = String(ix).toLowerCase();
        if (ix && !invSeen[k]) { invSeen[k] = 1; investigations.push({ label: cleanClinical(ix), source: "engine" }); }
      });
    });
    var rxSeen = {}, treatment = [];
    top.slice(0, 2).forEach(function (r) {
      var t = treatMap[r.id]; if (!t) return;
      (t.rx || []).concat(t.steps || []).forEach(function (line) {
        var k = String(line).toLowerCase();
        if (line && !rxSeen[k]) { rxSeen[k] = 1; treatment.push({ label: cleanClinical(line), source: "engine", dx: r.dx }); }
      });
    });
    // Must-not-miss red flags across the leading differentials (deduped) — surfaced, never accepted/written.
    var redSeen = {}, redFlags = [];
    top.slice(0, 4).forEach(function (r) {
      (r.red || []).forEach(function (rf) {
        var k = String(rf).toLowerCase();
        if (rf && !redSeen[k]) { redSeen[k] = 1; redFlags.push(cleanClinical(rf)); }
      });
    });
    return { provisionalDx: provisionalDx, provisionalWhy: provisionalWhy, ddx: ddx, investigations: investigations, treatment: treatment, redFlags: redFlags };
  }

  // Fetch a STATIC disease-treatment file (no PHI). Tries the id verbatim then upper/lower-case
  // filename variants; resolves to null on 404 so the caller falls back to the DX_MGMT global.
  function loadTreatment(id) {
    if (!id || typeof fetch !== "function") return Promise.resolve(null);
    var tries = [id, id.toUpperCase(), id.toLowerCase()].filter(function (x, i, a) { return a.indexOf(x) === i; });
    function attempt(i) {
      if (i >= tries.length) return Promise.resolve(null);
      return fetch("/kb/treatments/" + encodeURIComponent(tries[i]) + ".json")
        .then(function (r) { return r.ok ? r.json() : attempt(i + 1); })
        .catch(function () { return attempt(i + 1); });
    }
    return attempt(0);
  }
  // Sync fallback Rx/Mx from the on-device DX_MGMT global (no network) when no treatment file exists.
  function mgmtFallback(id) {
    var m = (G.DX_MGMT && G.DX_MGMT[id]) || null;
    if (!m || !(m.tx && m.tx.length)) return null;
    return { rx: m.tx.slice(0, 8), steps: [], regimen: "" };
  }

  // The button: derive findings from the typed assessment, run the engine, load treatment for the
  // top-2 dx, stage the review panel. Async only for the static-file loads; never blocks on network.
  function askMaik() {
    var v = st.assessVals || {};
    var text = assessFindingsText(v);
    if (!text.replace(/[.\s]/g, "")) { toast("Type the complaint / history first, then Ask MaiK."); return; }
    // Extract findings with the engine's OWN synonym set (rich FT_SYN) when available, so risk factors
    // like "known diabetic" -> diabetesHx are captured; fall back to the bare SMD_NLP context otherwise.
    var keys = (G.DX && DX.findingsFromText) ? DX.findingsFromText(text)
      : ((G.SMD_NLP && SMD_NLP.extract) ? ((SMD_NLP.extract(text, nlpCtx()) || {}).present || []) : []);
    var diff = clinicalRerank(differentialFor(keys), keys);   // score-rank + textbook clinical discriminators
    if (!diff.length) { toast("MaiK could not derive a differential yet. Add more detail to the notes."); return; }
    st.maikBusy = true; paint();
    // Capture the patient in scope NOW. openProfile() reassigns the module-level `st` to a fresh object
    // per patient, so if the doctor switches patients before these static-file loads resolve, we MUST NOT
    // write one patient's Dx/Rx into another's panel (accepted rows fold straight into the chart).
    var forPatient = st;
    var top2 = diff.slice(0, 2);
    Promise.all(top2.map(function (r) {
      return loadTreatment(r.id).then(function (tj) { return { id: r.id, t: tj ? treatmentLines(tj) : mgmtFallback(r.id) }; });
    })).then(function (loaded) {
      if (st !== forPatient) return;                        // doctor moved to another patient mid-flight
      var treatMap = {}; loaded.forEach(function (x) { if (x.t) treatMap[x.id] = x.t; });
      var sg = buildMaikSuggestions(diff, treatMap);
      st.maikBusy = false;
      st.scribeSuggestions = { provisionalDx: sg.provisionalDx, provisionalWhy: sg.provisionalWhy, ddx: sg.ddx,
        investigations: sg.investigations, treatment: sg.treatment, redFlags: sg.redFlags, corrections: emrCorrections(v),
        acceptedDx: false, acceptedDdx: {}, acceptedInv: {}, acceptedRx: {}, acceptedFix: {}, source: "maik" };
      st.scribeStats = { filled: 0, suggestions: (sg.provisionalDx ? 1 : 0) + sg.ddx.length + sg.investigations.length + sg.treatment.length };
      st.scribeAnim = true; paint();
      // bring the panel into view (the doctor taps from the bottom save bar; the panel renders on top)
      try {
        var p = document.querySelector("#smdOpdEmr .oe-ai-panel");
        var reduce = G.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (p && p.scrollIntoView) p.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      } catch (e) {}
    }).catch(function () {
      if (st !== forPatient) return;
      st.maikBusy = false; toast("MaiK could not load suggestions. Try again."); paint();
    });
  }

  // Assessment -> a compact clinical summary for the Pro (Vertex) tier. Clinical content only — NO name,
  // MR number, or any identifier ever leaves the device.
  function assessProText(v) {
    v = v || {};
    function ln(lbl, val) { return (val && String(val).trim()) ? (lbl + ": " + String(val).trim()) : ""; }
    var yn = function (k, lbl) { return v[k] === "Y" ? lbl : ""; };
    var co = [yn("Diabetes_yesNo", "diabetes"), yn("Hypertension_yesNo", "hypertension"), yn("Cardiac_yesNo", "cardiac disease"), yn("Bronchial_yesNo", "asthma"), yn("Tuberculosis_yesNo", "TB"), yn("Thyroid_yesNo", "thyroid disorder"), yn("Epilepsy_yesNo", "epilepsy")].filter(Boolean).join(", ");
    var vit = [v.Temp ? ("Temp " + v.Temp) : "", (v.BP_SYS && v.BP_dia) ? ("BP " + v.BP_SYS + "/" + v.BP_dia) : "", v.Pulse ? ("Pulse " + v.Pulse) : "", v.respiratory ? ("RR " + v.respiratory) : ""].filter(Boolean).join(", ");
    return [ln("Chief complaint", v.Chief_complaints_duration), ln("History of present illness", v.History_present_illness), ln("Past history", v.History_past_illness),
      co ? ("Comorbidities: " + co) : "", vit ? ("Vitals: " + vit) : "", ln("Systemic examination", v.sys_examination), ln("Provisional diagnosis (doctor)", v.provisional_diagnosis)].filter(Boolean).join("\n");
  }

  // Pro tier — send the (de-identified) assessment to Vertex for a deeper differential. Explicit action
  // (the tap is the consent to send). Falls back cleanly to the on-device base result on any error/quota.
  // EMR corrections stay on-device (deterministic); the LLM only refines Dx / Mx / Rx / red flags.
  function askMaikPro() {
    if (!(G.SMD_AI && G.SMD_AI.extract)) { toast("MaiK Pro (AI) is not available on this build."); return; }
    var v = st.assessVals || {};
    var text = assessProText(v);
    if (!text.replace(/[:\s]/g, "")) { toast("Type the complaint / history first."); return; }
    if (!confirmed("Send this assessment (no name or MR number) to MaiK Pro (AI) for a deeper differential?")) return;
    st.maikProBusy = true; paint();
    var forPatient = st;
    G.SMD_AI.extract(text, "opd-suggest").then(function (r) {
      if (st !== forPatient) return;
      st.maikProBusy = false;
      if (!r || r.error || !(r.provisionalDx || (r.ddx && r.ddx.length))) {
        toast(r && r.error === "quota" ? "Daily AI limit reached. Use the on-device result or try again tomorrow." : "MaiK Pro is unavailable right now; the on-device result stands.");
        paint(); return;
      }
      var ddx = (r.ddx || []).map(function (d) { return { label: cleanClinical(d.dx), dx: cleanClinical(d.dx), source: "ai", why: cleanClinical(d.why || "") }; }).filter(function (d) { return d.dx; });
      var prov = cleanClinical(r.provisionalDx || "") || (ddx[0] && ddx[0].dx) || "";
      var provWhy = "";
      var ddxOut = ddx.filter(function (d) { if (d.dx === prov) { if (!provWhy) provWhy = d.why; return false; } return true; });
      st.scribeSuggestions = { provisionalDx: prov, provisionalWhy: provWhy, ddx: ddxOut,
        investigations: (r.investigations || []).map(function (x) { return { label: cleanClinical(x), source: "ai" }; }),
        treatment: (r.treatment || []).map(function (x) { return { label: cleanClinical(x), source: "ai" }; }),
        redFlags: (r.redFlags || []).map(function (x) { return cleanClinical(x); }), corrections: emrCorrections(v),
        acceptedDx: false, acceptedDdx: {}, acceptedInv: {}, acceptedRx: {}, acceptedFix: {}, source: "pro" };
      st.scribeStats = { filled: 0, suggestions: (prov ? 1 : 0) + ddxOut.length };
      st.scribeAnim = true; paint();
      try { var p = document.querySelector("#smdOpdEmr .oe-ai-panel"); if (p && p.scrollIntoView) p.scrollIntoView({ block: "start" }); } catch (e) {}
    }).catch(function () { if (st !== forPatient) return; st.maikProBusy = false; toast("MaiK Pro is unavailable right now."); paint(); });
  }

  // opd-scribe refine pass: full transcript -> LLM extract -> grounded suggestions -> _applyRefine.
  // Suggest-only: nothing here is written to the EMR/orders until the doctor taps Accept (_applyRefine
  // only stages st.scribeSuggestions + folds emrFields the same protected way as applyVoice).
  // Dedup guard: skip a call whose transcript is identical to (or a prefix of) the last one we
  // actually refined -- defense-in-depth against a redundant call carrying no new content (the
  // main double-call-on-Stop fix is in stopVoice(), which no longer races its own stale call
  // against the teardown flush's onRefine).
  var _lastRefinedTranscript = "";
  function doRefine(transcript) {
    if (!transcript || !(G.SMD_AI && G.SMD_AI.extract)) { finishProcessing(); return; }
    if (_lastRefinedTranscript.indexOf(transcript) === 0) { finishProcessing(); return; }   // no new content since the last refine
    _lastRefinedTranscript = transcript;
    G.SMD_AI.extract(transcript, "opd-scribe").then(function (r) {
      if (!r || r.error) return;
      var sg = r.suggestions || {};
      var grounded = (G.SMD_SCRIBEGROUND && G.SMD_SCRIBEGROUND.ground) ? G.SMD_SCRIBEGROUND.ground(transcript, sg, groundOpts(transcript))
        : { ddx: (sg.ddx || []).map(function (l) { return { label: l, source: "ai" }; }), investigations: (sg.investigations || []).map(function (l) { return { label: l, source: "ai" }; }) };
      _applyRefine({ emrFields: r.emrFields || {}, suggestions: { provisionalDx: sg.provisionalDx, ddx: grounded.ddx, investigations: grounded.investigations } });
      // Multilingual VITALS: the deterministic extractor (voice-vitals) is English-regex only, so a
      // Telugu/Hindi consult (native-script transcript) never matched "BP 120/80" etc. Re-run the SAME
      // deterministic extractor on the LLM's faithful English translation — still no LLM-invented numbers.
      if (r.en && G.SMD_AMBIENT && G.SMD_AMBIENT.reduce) {
        st.voiceTranscriptEn = r.en;                       // full English translation-so-far -> powers the Q&A speaker view
        try { applyVoice(G.SMD_AMBIENT.reduce(r.en, { speaker: "doctor", state: {}, now: now() })); } catch (e) {}
      }
      // Alcohol: patient stated an amount -> tick Alcohol/Habits + write the amount with computed
      // grams of ethanol + WHO standard drinks into the details field (respecting a doctor edit).
      var alcAff = (r.emrFields && r.emrFields.alcohol === "Yes") || !!r.alcoholDetail;
      var ac = alcoholCalc(r.alcoholDetail || r.en || "");   // parse "<n> ml <drink>" from the detail OR the English transcript (needs a drink-type word, so 'ml saline' won't trigger)
      if (alcAff || ac) {
        applyVoice({ updates: [{ field: "habits", value: "Yes", applied: true }, { field: "alcohol", value: "Yes", applied: true }] });
        if (ac) {
          var note = (r.alcoholDetail || (ac.ml + " ml " + ac.type)) + " (" + ac.pureMl + " ml pure alcohol, ~" + ac.grams + " g, ~" + ac.std + " standard drink" + (ac.std === 1 ? "" : "s") + ")";
          st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
          if (!st.assessTouched.Habitat_addiction_others) { st.assessVals.Habitat_addiction_others = note; putVoiceDom("Habitat_addiction_others"); }
        }
      }
      // Doctor-dictated investigations ("let's do CBC, LFT, RFT") -> Management plan. Deterministic +
      // on-device (works for GHIS AND personal clinic; no catalog needed); appendPlan dedups so a
      // re-run over the growing transcript never duplicates a line.
      var invs = detectInvestigations((r.en || "") + " " + transcript);
      if (invs.length) {
        st.dictatedInv = st.dictatedInv || []; var added = false;
        invs.forEach(function (n) { if (st.dictatedInv.indexOf(n) < 0) { st.dictatedInv.push(n); added = true; } appendPlan("management_plan", "Ix: " + n); });
        putVoiceDom("management_plan");
        // Surface new investigation chips (infrequent: per refine, not per tick) — but NOT while the
        // doctor is mid-edit in the notes textarea (a late refine resolving after Stop would steal focus).
        if (added) { var ed = null; try { ed = document.getElementById("oeNotesEdit"); } catch (e) {} if (!ed || document.activeElement !== ed) paint(); }
      }
    }).catch(function () {}).then(finishProcessing);   // clear the "Finishing…" state whether it succeeded or not
  }
  function startVoice() {
    if (!G.SMD_AMBIENT) { toast("Voice engine not available on this build."); return; }
    // Preserve any prior transcript so restarting after Stop APPENDS ("record more") instead of wiping it.
    _priorTranscript = (st.voiceTranscript || "").trim() ? ((st.voiceTranscript || "").trim() + "\n") : "";
    st.voiceOn = true; st.voicePaused = false; st.voiceProcessing = false; st.voiceFallback = false; st.voiceStatus = "Starting…"; st.voiceStartedAt = now(); st.voiceModel = ""; _lastFullTranscript = st.voiceTranscript || ""; _lastRefinedTranscript = ""; if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; } paint();
    if (_elapsedTmr) clearInterval(_elapsedTmr); _elapsedTmr = setInterval(tickElapsed, 1000);
    _amb = G.SMD_AMBIENT.start({
      speaker: "doctor",
      language: st.voiceLang || "auto",                     // en | auto | te — multilingual Whisper decodes Telugu + code-switch
      chunkMs: 15000, refineEveryChunks: 4,                  // forward-compat with the native continuous-capture cadence (Task 5)
      getState: function () { return {}; },                 // manual-override is enforced in _voiceMerge via assessTouched
      llmExtract: assessLLM,                                 // narrative only; deterministic vitals/exam run every tick
      onUpdate: applyVoice,
      onTranscript: function (t) { _lastFullTranscript = _priorTranscript + (t || ""); setTranscript(_lastFullTranscript); },
      onModel: function (code) { setModelChip(code); },     // "which model" chip (Auto adapts per chunk)
      onRefine: doRefine,                                    // rolling capture (Task 5) is wired: fires every refineEveryChunks windows + once more on Stop (the flushed final chunk); stopVoice() only makes its own call as a fallback when there's no in-flight chunk to flush
      onState: function (s) { if (s === "fallback") st.voiceFallback = true; setVoiceStatus(s === "listening" ? (st.voiceFallback ? "Listening (device dictation)…" : "Listening…") : s === "fallback" ? "Whisper model not installed - using device dictation" : s === "preparing" ? "Preparing model…" : s === "downloading" ? "Downloading model…" : ""); },
      onError: function (err) { setVoiceStatus(err === "clinical-unavailable" ? "On-device voice unavailable on this build." : "Voice error - tap to retry."); st.voiceOn = false; _amb = null; if (_elapsedTmr) { clearInterval(_elapsedTmr); _elapsedTmr = null; } paint(); }
    });
  }
  function togglePauseVoice() { if (!_amb) return; if (st.voicePaused) { try { _amb.resume(); } catch (x) {} st.voicePaused = false; } else { try { _amb.pause(); } catch (x) {} st.voicePaused = true; } paint(); }
  function stopVoice() {
    // _amb.stop() returns true when an in-flight chunk is being flushed AND that flush will itself
    // call onRefine with the COMPLETE transcript (see teardown() in voice-ambient.js) -- in that case
    // don't also refine here with our own stale (pre-flush) transcript. Only fall back to a manual
    // call when there's nothing to flush (or the flush won't refine, e.g. stopped while paused).
    var flushing = false;
    if (_amb) { try { flushing = !!_amb.stop(); } catch (x) {} _amb = null; }
    if (_elapsedTmr) { clearInterval(_elapsedTmr); _elapsedTmr = null; }
    st.voiceOn = false; st.voicePaused = false; st.voiceStatus = "";
    // Show a "Finishing…" state while the last chunk transcribes + notes draft (finishProcessing clears it).
    var willProcess = flushing || !!_lastFullTranscript;
    st.voiceProcessing = willProcess;
    if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; }
    if (willProcess) _procTmr = setTimeout(finishProcessing, 15000);   // safety: never hang the panel
    if (!flushing) doRefine(_lastFullTranscript);           // fallback end-of-consult refine over the whole transcript
    paint();
    if (!willProcess) finishProcessing();
  }

  // Doctor taps Accept on one suggestion row: writes ONLY that row into the assessment/an inv-order
  // draft; every other suggestion stays untouched until its own Accept is tapped.
  function scribeAccept(kind, idx) { st.scribeAnim = false; if (scribeAcceptOne(kind, idx)) paint(); }
  // Apply ONE accepted row into the assessment. NO repaint (accept-all batches then paints once).
  // Returns true if it changed state. Every path folds into st.assessVals only — never GHIS directly.
  function scribeAcceptOne(kind, idx) {
    var s = st.scribeSuggestions; if (!s) return false;
    if (kind === "dx" || kind === "ddx") {
      var name = kind === "dx" ? s.provisionalDx : (s.ddx[idx] && (s.ddx[idx].dx || s.ddx[idx].label));   // clean name, not "name (score)"
      if (!name) return false;
      // Explicit Accept OVERRIDES the touched-guard: that guard protects against PASSIVE ambient fill,
      // not a deliberate tap. _voiceMerge would silently drop this to conflicts while the UI shows
      // "Added" — so force-apply the value and mark it edited.
      st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
      st.assessVals.provisional_diagnosis = name; st.assessTouched.provisional_diagnosis = true;
      if (kind === "dx") s.acceptedDx = true; else { s.acceptedDdx = s.acceptedDdx || {}; s.acceptedDdx[idx] = true; }
    } else if (kind === "inv") {
      var inv = s.investigations[idx]; if (!inv) return false;
      // Ask MaiK folds the workup into the Management plan; the voice-scribe path keeps its order draft.
      if (s.source === "maik") appendPlan("management_plan", "Ix: " + inv.label);
      else st.invDraft = { service: { id: null, name: inv.label }, diagnosis: (st.assessVals && st.assessVals.provisional_diagnosis) || "", emergency: false, fromSuggestion: true };
      s.acceptedInv = s.acceptedInv || {}; s.acceptedInv[idx] = true;
    } else if (kind === "rx") {
      var rx = s.treatment && s.treatment[idx]; if (!rx) return false;
      appendPlan("management_plan", "Rx: " + rx.label);
      s.acceptedRx = s.acceptedRx || {}; s.acceptedRx[idx] = true;
    } else if (kind === "fix") {
      var fx = s.corrections && s.corrections[idx]; if (!fx) return false;
      applyCorrection(fx);
      s.acceptedFix = s.acceptedFix || {}; s.acceptedFix[idx] = true;
    } else return false;
    return true;
  }
  // Accept every not-yet-accepted row in a section (investigations / treatment / corrections), one repaint.
  function scribeAcceptAll(kind) {
    var s = st.scribeSuggestions; if (!s) return;
    var list = kind === "inv" ? s.investigations : kind === "rx" ? s.treatment : kind === "fix" ? s.corrections : null;
    if (!list) return;
    var changed = false;
    for (var i = 0; i < list.length; i++) { if (scribeAcceptOne(kind, i)) changed = true; }
    st.scribeAnim = false; if (changed) paint();
  }
  // Apply an EMR correction to st.assessVals (spelling = in-place replace; misplaced = move offending
  // lines from the source field to the target field). Append-only into the target; never clears elsewhere.
  function applyCorrection(fx) {
    if (!fx) return;
    st.assessVals = st.assessVals || {};
    var cur = st.assessVals[fx.field] || "";
    if (fx.type === "spelling") {
      st.assessVals[fx.field] = cur.replace(new RegExp("\\b" + String(fx.from).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), fx.to);
    } else {
      var drop = {}; (fx.fromLines || []).forEach(function (l) { drop[String(l).trim()] = 1; });
      st.assessVals[fx.field] = cur.split("\n").filter(function (l) { return !drop[l.trim()]; }).join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
      appendPlan(fx.targetField, fx.from);
    }
    st.assessTouched = st.assessTouched || {}; st.assessTouched[fx.field] = true;
  }
  // Append a line into a plan textarea without disturbing what the doctor already typed (dedup on
  // substring, never clears). Marks the field touched so a later voice pass won't overwrite it.
  function appendPlan(name, line) {
    st.assessVals = st.assessVals || {};
    var cur = st.assessVals[name] || "";
    if (cur.indexOf(line) !== -1) return;
    st.assessVals[name] = cur ? (cur.replace(/\s+$/, "") + "\n" + line) : line;
    st.assessTouched = st.assessTouched || {}; st.assessTouched[name] = true;
  }
  // PURE-ish: fold a Task-1 opd-scribe extract + Task-2 grounded suggestions into state. emrFields fold
  // via the SAME _voiceMerge manual-override guard as live dictation; suggestions are staged for review
  // only — nothing lands in the EMR/orders until scribeAccept() runs for that specific row. Exposed for
  // testing (CDP + a real audio pipeline both call this the same way).
  function _applyRefine(result) {
    result = result || {};
    var ef = result.emrFields || {};
    var updates = Object.keys(ef).map(function (k) { return { field: k, value: ef[k], applied: true }; });
    var m = _voiceMerge(st.assessVals, st.assessTouched, updates);
    st.assessVals = m.vals;
    // Voice refine autofills the EMR fields ONLY. Diagnostic / investigation SUGGESTIONS are NOT
    // auto-shown after a consult — the clinician taps "Ask MaiK" to pull them on demand.
    st.scribeStats = { filled: m.filled.length, suggestions: 0 };
    paint();
    return { filled: m.filled, dropped: m.dropped, conflicts: m.conflicts };
  }

  function openProfile(opts) {
    opts = opts || {};
    if (!flagOn()) return;                       // inert unless smd_opd_emr is on
    // Reopened the app straight into OPD with a stale GHIS session? Verify (and silently refresh)
    // BEFORE opening an empty EMR — if the doctor must sign in again, show Ward Sync up front
    // instead of failing mid-load. Local (personal clinic) source needs no GHIS session.
    if ((opts.source || "ghis") === "ghis" && G.GHIS && G.GHIS.ensureSession && !opts._sessionOk) {
      G.GHIS.ensureSession().then(function (ok) { if (ok) { opts._sessionOk = true; openProfile(opts); } });
      return;
    }
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    st = freshState();
    st.patient = { name: opts.name || "", mrn: opts.patientId || "" };
    st.recordNo = opts.recordNo || "";
    st.episodeId = opts.episodeId || "";                      // GHIS visit/episode id — an Initial Assessment attaches to a visit
    st.ticketId = opts.ticketId || ""; st.sessionId = opts.sessionId || "";   // queue context -> mirror actions into the visit summary
    st.source = opts.source || "ghis";                       // "ghis" (hospital) | "local" (personal clinic, on-device)
    _localStore = (st.source === "local") ? (opts.localStore || null) : null;
    st.emrLabel = opts.emrLabel || (st.source === "local" ? "My Clinic" : (opts.source && opts.source !== "ghis" ? "EMR" : "GHIS"));
    st.writeOn = (st.source === "local") ? true : writeFlagOn();   // local save is always allowed (on-device, no server gate)
    if (opts.tab) st.tab = opts.tab;                          // open directly on a tab (e.g. "assess")
    paint();
    loadProfile(opts);
    if (opts.tab === "assess") loadAssessment();              // jump straight to the Initial Assessment
  }
  var _localStore = null;   // personal-clinic backend (getConsult/saveConsult), set when source === "local"
  // ---- per-field dictation (fill ONLY the tapped column) ---------------------------------------
  var _fieldSession = null;
  function fmicNode(name) { var l = document.querySelectorAll("#smdOpdEmr .oe-fmic"); for (var i = 0; i < l.length; i++) { if (l[i].getAttribute("data-oe-act") === "fieldmic:" + name) return l[i]; } return null; }
  function setFmicUI(name, on) { var b = fmicNode(name); if (b) { b.classList.toggle("on", !!on); b.innerHTML = ms(on ? "stop" : "mic"); } }
  function stopFieldMic() {
    if (_fieldSession) { try { _fieldSession.stop(); } catch (x) {} _fieldSession = null; }
    if (st.fieldMic) { setFmicUI(st.fieldMic, false); st.fieldMic = null; }
  }
  function coerceFieldValue(name, transcript) {
    var t = (transcript || "").trim(); if (!t) return null;
    if (OPD_KIND[name] === "number") { var m = t.match(/-?\d+(\.\d+)?/); return m ? m[0] : null; }   // vitals etc: keep the first number the doctor said
    return t;
  }
  // Dictate into one field only. Uses the device's on-device STT (noCloud: audio never leaves the
  // phone) and degrades gracefully via voice.js. Never touches any other column - deterministic placement.
  function toggleFieldMic(name) {
    if (st.voiceOn || st.voiceProcessing) { toast("Stop the Voice Consult first to dictate a single field."); return; }
    if (st.fieldMic === name) { stopFieldMic(); return; }
    stopFieldMic();                                        // only one field mic at a time
    if (!G.SMD_VOICE || !G.SMD_VOICE.listen) { toast("On-device voice not available on this build."); return; }
    st.fieldMic = name; setFmicUI(name, true);
    function put(transcript, done) {
      var v = coerceFieldValue(name, transcript);
      if (v != null) { st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {}; st.assessVals[name] = v; st.assessTouched[name] = true; putVoiceDom(name); }
      if (done) stopFieldMic();
    }
    _fieldSession = G.SMD_VOICE.listen({
      language: (st.voiceLang && st.voiceLang !== "auto") ? st.voiceLang : undefined,
      noCloud: true,
      onPartial: function (t) { put(t, false); },
      onFinal: function (t) {
        var s = String(t || "");
        // GHIS + MaiK must be English — if the dictation is Telugu/Hindi, translate the final before filling.
        if (/[ऀ-ॿఀ-౿]/.test(s) && G.SMD_AI && G.SMD_AI.translate) {
          setVoiceStatus("Translating…");
          G.SMD_AI.translate(s).then(function (r) { put((r && r.text && !r.error) ? r.text : s, true); setVoiceStatus(""); })
            .catch(function () { put(s, true); setVoiceStatus(""); });
        } else { put(s, true); }
      },
      onError: function () { setVoiceStatus("On-device voice unavailable"); stopFieldMic(); },
      onState: function () {}
    });
    if (!_fieldSession) { st.fieldMic = null; setFmicUI(name, false); }   // listen returned null (no engine)
  }

  // ---- finish the consult (shown after a GHIS save) --------------------------------------------
  // The queue (queue.js) owns the session, so we bridge with a DOM event it listens for.
  function endConsult() {
    try { document.dispatchEvent(new CustomEvent("smd:consult-end", { detail: { ticketId: st.ticketId || "" } })); } catch (e) {}
    close();
  }
  function consultToER() {
    if (!confirmed("Send this patient to Emergency (ER)?")) return;
    // 1) best-effort GHIS referral note (skips silently if EMR write is off)
    st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
    var cur = st.assessVals.refered_management_plan || "";
    if (!/emergency/i.test(cur)) { st.assessVals.refered_management_plan = (cur ? cur + " " : "") + "Refer to Emergency (ER)."; st.assessTouched.refered_management_plan = true; }
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", fields: buildAssessPayload(st.assessVals || {}) }, "Referred to Emergency (ER).", { kind: "assessment", text: "Referred to Emergency (ER)" });
    // 2) escalate in the queue + end the consult (works even when the GHIS write is off)
    try { document.dispatchEvent(new CustomEvent("smd:consult-emergency", { detail: { ticketId: st.ticketId || "" } })); } catch (e) {}
    close();
  }
  // swipe-to-close: a deliberate drag (0.85 of the track) ends the consult; a short drag snaps back.
  function initCloseSwipe() {
    var track = document.getElementById("oeSwipe"), knob = document.getElementById("oeSwipeKnob");
    if (!track || !knob) return;
    var fill = track.querySelector(".oe-swipe-fill");
    var startX = 0, curX = 0, maxX = 0, dragging = false, DONE = 0.85;
    function px(e) { return e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX; }
    function move(e) { if (!dragging) return; curX = Math.max(0, Math.min(maxX, px(e) - startX)); knob.style.transform = "translateX(" + curX + "px)"; if (fill) fill.style.width = (curX + knob.offsetWidth + 4) + "px"; track.classList.toggle("armed", !!maxX && curX / maxX > DONE); if (e.cancelable) e.preventDefault(); }
    function up() { if (!dragging) return; dragging = false; document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); if (maxX && curX / maxX > DONE) { endConsult(); } else { curX = 0; knob.style.transform = "translateX(0)"; if (fill) fill.style.width = ""; track.classList.remove("armed"); } }
    function down(e) { dragging = true; maxX = track.clientWidth - knob.offsetWidth - 8; startX = px(e) - curX; document.addEventListener("touchmove", move, { passive: false }); document.addEventListener("touchend", up); document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); if (e.cancelable) e.preventDefault(); }
    knob.addEventListener("touchstart", down, { passive: false });
    knob.addEventListener("mousedown", down);
    // Keyboard / VoiceOver / Switch-Control path (the swipe alone excluded anyone who can't drag).
    track.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); endConsult(); } });
  }

  function close() { stopVoice(); stopFieldMic(); var el = document.getElementById("smdOpdEmr"); if (el) el.classList.remove("on"); }

  G.OPDEMR = { openProfile: openProfile, close: close, _render: _render, _assessPayload: buildAssessPayload, _voiceMerge: _voiceMerge, VOICE_MAP: VOICE_MAP, _applyRefine: _applyRefine, _groundOpts: groundOpts, _differentialFor: differentialFor, _toggleFieldMic: toggleFieldMic, _endConsult: endConsult, _consultToER: consultToER, _askMaik: askMaik, _assessFindingsText: assessFindingsText, _treatmentLines: treatmentLines, _buildMaikSuggestions: buildMaikSuggestions, _rankDifferential: rankDifferential, _clinicalRerank: clinicalRerank, _emrCorrections: emrCorrections, _askMaikPro: askMaikPro, _assessProText: assessProText, _alcoholCalc: alcoholCalc, _detectInvestigations: detectInvestigations, _mergeNoteIntoHistory: mergeNoteIntoHistory };
  if (typeof module !== "undefined" && module.exports) module.exports = { _render: _render, _assessPayload: buildAssessPayload, _voiceMerge: _voiceMerge, VOICE_MAP: VOICE_MAP, _applyRefine: _applyRefine, _groundOpts: groundOpts, _differentialFor: differentialFor, _assessFindingsText: assessFindingsText, _treatmentLines: treatmentLines, _buildMaikSuggestions: buildMaikSuggestions, _rankDifferential: rankDifferential, _clinicalRerank: clinicalRerank, _emrCorrections: emrCorrections, _askMaikPro: askMaikPro, _assessProText: assessProText, _alcoholCalc: alcoholCalc, _detectInvestigations: detectInvestigations, _mergeNoteIntoHistory: mergeNoteIntoHistory };
})();
