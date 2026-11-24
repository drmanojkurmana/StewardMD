/* StewardMD - ResearchMD case file screen (CARE order).
 * ES5 IIFE. Registers SMD.screens.casefile. Item 2 (case report) and item 3 (case series).
 * Pure buildTimeline and chartFromCasefiles are exported for Node tests.
 * The case file stays on this phone (RMDStore kind casefile). Nothing here is uploaded.
 * No em or en dashes.
 */
(function (G) {
  "use strict";
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};
  var KEY = "casefile";
  var DAY_MS = 86400000;

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelFor(name) {
    var C = G.SMD_RESEARCH_CONTRACTS;
    if (C && C.STEP_LABELS && C.STEP_LABELS[name]) return C.STEP_LABELS[name];
    return name;
  }

  function str(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }
  function trim(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }

  /* Milliseconds for a strict yyyy-mm-dd date, or null. UTC so day numbers never shift. */
  function parseIsoDate(s) {
    if (typeof s !== "string") return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return t;
  }

  function emptyCasefile() {
    return {
      age: "", sex: "",
      presenting: "", presentingDate: "",
      history: "", examination: "",
      investigations: [],
      diagnosis: "", diagnosisDate: "",
      treatment: "", treatmentDate: "",
      outcome: "", outcomeDate: "",
      followup: "", followupDate: "",
      unusual: ""
    };
  }

  function normCasefile(v) {
    var cf = emptyCasefile(), k, i, r;
    if (!v || typeof v !== "object") return cf;
    for (k in cf) {
      if (Object.prototype.hasOwnProperty.call(cf, k) && k !== "investigations" && typeof v[k] === "string") cf[k] = v[k];
    }
    if (Object.prototype.toString.call(v.investigations) === "[object Array]") {
      for (i = 0; i < v.investigations.length; i++) {
        r = v.investigations[i] || {};
        cf.investigations.push({ date: str(r.date), test: str(r.test), value: str(r.value), unit: str(r.unit) });
      }
    }
    return cf;
  }

  /* Synthetic example only: zinc phosphide poisoning with myocardial infarction. */
  function exampleCasefile() {
    return {
      age: "34", sex: "Male",
      presenting: "Severe central chest pain, sweating and breathlessness for 2 hours after ingesting zinc phosphide paste.",
      presentingDate: "2026-03-02",
      history: "No prior cardiac illness. No diabetes, hypertension or smoking. Reached hospital within 2 hours of ingestion.",
      examination: "Pulse 110 per minute, blood pressure 90/60 mmHg, cold peripheries. Chest clear on auscultation (listening with a stethoscope).",
      investigations: [
        { date: "2026-03-02", test: "ECG", value: "ST elevation in leads V1 to V4", unit: "" },
        { date: "2026-03-02", test: "Troponin I", value: "8.4", unit: "ng/mL" },
        { date: "2026-03-03", test: "Echocardiography", value: "LVEF 35 percent with anterior wall hypokinesia", unit: "" },
        { date: "2026-03-08", test: "Repeat troponin I", value: "0.9", unit: "ng/mL" }
      ],
      diagnosis: "Acute anterior ST elevation myocardial infarction (heart attack) after zinc phosphide poisoning.",
      diagnosisDate: "2026-03-02",
      treatment: "Gastric lavage, intravenous fluids, inotropes and standard acute coronary syndrome care. Coronary angiography was normal.",
      treatmentDate: "2026-03-02",
      outcome: "Chest pain settled by day 3. Discharged on day 7 on guideline directed medical therapy.",
      outcomeDate: "2026-03-09",
      followup: "At 6 weeks the left ventricular ejection fraction (pumping strength of the heart) improved to 55 percent and the patient was asymptomatic.",
      followupDate: "2026-04-13",
      unusual: "Myocardial infarction after zinc phosphide poisoning is rarely reported, and the normal coronary angiogram suggests a toxic vasospastic mechanism rather than plaque rupture."
    };
  }

  /* Pure timeline: dated entries sorted, Day 0 = first presentation date,
   * undated entries after dated ones. Never throws on bad data. */
  function buildTimeline(casefile) {
    var cf = normCasefile(casefile);
    var entries = [], i, inv, txt;
    function add(date, text) {
      var t = trim(text);
      if (!t) return;
      entries.push({ raw: str(date), t: parseIsoDate(date), text: t });
    }
    add(cf.presentingDate, cf.presenting ? "Presenting complaint: " + cf.presenting : "");
    for (i = 0; i < cf.investigations.length; i++) {
      inv = cf.investigations[i];
      txt = trim(inv.test);
      if (txt && trim(inv.value)) txt += ": " + trim(inv.value);
      else if (!txt) txt = trim(inv.value);
      if (txt && trim(inv.unit)) txt += " " + trim(inv.unit);
      add(inv.date, txt);
    }
    add(cf.diagnosisDate, cf.diagnosis ? "Diagnosis: " + cf.diagnosis : "");
    add(cf.treatmentDate, cf.treatment ? "Treatment: " + cf.treatment : "");
    add(cf.outcomeDate, cf.outcome ? "Outcome: " + cf.outcome : "");
    add(cf.followupDate, cf.followup ? "Follow-up: " + cf.followup : "");

    var anchor = parseIsoDate(cf.presentingDate);
    if (anchor === null) {
      for (i = 0; i < entries.length; i++) {
        if (entries[i].t !== null && (anchor === null || entries[i].t < anchor)) anchor = entries[i].t;
      }
    }
    var dated = [], undated = [], e;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.t !== null && anchor !== null) {
        dated.push({ date: e.raw, day: Math.round((e.t - anchor) / DAY_MS), text: e.text, t: e.t, ord: i });
      } else {
        undated.push({ date: null, day: null, text: e.text });
      }
    }
    dated.sort(function (a, b) { return a.t !== b.t ? a.t - b.t : a.ord - b.ord; });
    var out = [];
    for (i = 0; i < dated.length; i++) out.push({ date: dated[i].date, day: dated[i].day, text: dated[i].text });
    for (i = 0; i < undated.length; i++) out.push(undated[i]);
    return out;
  }

  /* Pure: per-patient case files become a master chart (one row per patient). */
  function chartFromCasefiles(records) {
    var list = [], tests = [], seen = {}, i, j, k, cf, inv, name;
    var recs = Object.prototype.toString.call(records) === "[object Array]" ? records : [];
    for (i = 0; i < recs.length; i++) {
      cf = normCasefile(recs[i] && recs[i].value);
      list.push({ id: str(recs[i] && recs[i].id), cf: cf });
      for (j = 0; j < cf.investigations.length; j++) {
        inv = cf.investigations[j];
        name = trim(inv.test);
        if (!name) continue;
        if (trim(inv.unit)) name += " (" + trim(inv.unit) + ")";
        if (!seen[name]) { seen[name] = 1; tests.push(name); }
      }
    }
    tests.sort();
    var columns = ["Patient", "Age", "Sex", "Diagnosis"];
    for (i = 0; i < tests.length; i++) columns.push(tests[i]);
    var rows = [];
    for (i = 0; i < list.length; i++) {
      cf = list[i].cf;
      var row = [list[i].id, cf.age, cf.sex, cf.diagnosis];
      for (j = 0; j < tests.length; j++) {
        var val = "";
        for (k = 0; k < cf.investigations.length; k++) {
          inv = cf.investigations[k];
          name = trim(inv.test);
          if (trim(inv.unit)) name += " (" + trim(inv.unit) + ")";
          if (name === tests[j]) { val = inv.value; break; }
        }
        row.push(val);
      }
      rows.push(row);
    }
    return { columns: columns, rows: rows };
  }

  /* ---------- screen state ---------- */

  var st = null;

  function modeFor(proj) {
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var hasCasefile = false, hasChart = false, i;
    for (i = 0; i < journey.length; i++) {
      if (journey[i] === "casefile") hasCasefile = true;
      if (journey[i] === "masterchart") hasChart = true;
    }
    return hasCasefile && hasChart ? "series" : "report";
  }

  function freshState(pid, mode) {
    return {
      pid: pid, mode: mode, container: null,
      patients: [], patientId: mode === "series" ? "1" : "case",
      cf: emptyCasefile(), loading: true, error: null, saved: false, busy: false
    };
  }

  function injectCss() {
    var D = G.document;
    if (!D || D.getElementById("rmdCasefileCss")) return;
    var s = D.createElement("style");
    s.id = "rmdCasefileCss";
    s.textContent = [
      "#researchMD .rmd-cf-patients { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }",
      "#researchMD .rmd-cf-patient { min-height: 44px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); font: 600 14px var(--rmd-f); cursor: pointer; }",
      "#researchMD .rmd-cf-patient-active { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-cf-timeline { list-style: none; margin: 8px 0 0; padding: 0; }",
      "#researchMD .rmd-cf-tl-row { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; border-top: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-cf-tl-row:first-child { border-top: 0; }",
      "#researchMD .rmd-cf-day { flex: 0 0 auto; min-width: 64px; padding: 4px 8px; border-radius: 8px; background: var(--rmd-acc-soft); color: var(--rmd-acc); font: 600 12.5px var(--rmd-f); text-align: center; font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-cf-tl-text { font: 400 14px/1.45 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-cf-invrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 0; border-top: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-cf-invrow .rmd-field { margin: 0; }",
      "#researchMD .rmd-cf-invremove { grid-column: 1 / -1; justify-self: start; }",
      "#researchMD .rmd-cf-savestatus { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); margin: 6px 0 0; }",
      /* Shared base only forces 44px targets at iPad width and skips date inputs; scope phone fixes here. */
      "#researchMD .rmd-casefile-screen .rmd-btn, #researchMD .rmd-casefile-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-casefile-screen input[type=text], #researchMD .rmd-casefile-screen input[type=number], #researchMD .rmd-casefile-screen input[type=date], #researchMD .rmd-casefile-screen select, #researchMD .rmd-casefile-screen textarea { min-height: 44px; }",
      "#researchMD .rmd-casefile-screen input[type=date] { width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); }",
      "@media (min-width: 900px) {",
      "  #researchMD .rmd-cf-invrow { grid-template-columns: 1fr 1fr 1fr 1fr auto; align-items: end; }",
      "  #researchMD .rmd-cf-invremove { grid-column: auto; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  function stepBannerHtml() {
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var journey = SMD.journeyFor ? SMD.journeyFor(proj) : [];
    var idx = -1, i;
    for (i = 0; i < journey.length; i++) if (journey[i] === KEY) idx = i;
    var nextName = (idx >= 0 && idx + 1 < journey.length) ? journey[idx + 1] : "";
    var stepNo = idx >= 0 ? idx + 1 : 1;
    var stepCount = journey.length || 1;
    var nextLabel = nextName ? labelFor(nextName) : "continue when this step is ready";
    var h = '<div class="rmd-step-banner" role="status">';
    h += '<div class="rmd-step-line"><span class="rmd-step-text"><strong>Step ' + stepNo + ' of ' + stepCount + '</strong> ' + esc(labelFor(KEY)) + '</span></div>';
    h += '</div>';
    h += '<p class="rmd-next-line">Next: ' + esc(nextLabel) + '</p>';
    return h;
  }

  function fieldHtml(id, label, inputHtml, hint) {
    var h = '<div class="rmd-field">';
    h += '<label for="' + id + '">' + esc(label) + '</label>';
    h += inputHtml;
    if (hint) h += '<p class="rmd-muted">' + esc(hint) + '</p>';
    h += '</div>';
    return h;
  }

  function textInput(id, attr, value, placeholder) {
    return '<input type="text" id="' + id + '" data-rmd-cf-field="' + attr + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '" autocomplete="off">';
  }

  function areaInput(id, attr, value, placeholder, rows) {
    return '<textarea id="' + id + '" data-rmd-cf-field="' + attr + '" rows="' + (rows || 3) + '" placeholder="' + esc(placeholder || "") + '">' + esc(value) + '</textarea>';
  }

  function dateInput(id, attr, value) {
    return '<input type="date" id="' + id + '" data-rmd-cf-field="' + attr + '" value="' + esc(value) + '">';
  }

  function formHtml() {
    var cf = st.cf, h = [], i, inv;
    h.push('<div class="rmd-card">');
    h.push('<h3>Case file</h3>');
    h.push('<p class="rmd-muted">Fill this in CARE order (the reporting checklist for case reports). Do not type the patient\u2019s name, hospital number, address or phone number. This case file stays on this phone.</p>');
    h.push('<div class="rmd-form">');
    h.push('<div class="rmd-cf-invrow">');
    h.push(fieldHtml("rmdCfAge", "Age (years)", '<input type="number" id="rmdCfAge" data-rmd-cf-field="age" min="0" max="120" inputmode="numeric" value="' + esc(cf.age) + '" autocomplete="off">'));
    var sexOpts = ["", "Female", "Male", "Other"], sexH = '<select id="rmdCfSex" data-rmd-cf-field="sex">';
    for (i = 0; i < sexOpts.length; i++) {
      sexH += '<option value="' + esc(sexOpts[i]) + '"' + (cf.sex === sexOpts[i] ? " selected" : "") + '>' + esc(sexOpts[i] || "Select") + '</option>';
    }
    sexH += '</select>';
    h.push(fieldHtml("rmdCfSex", "Sex", sexH));
    h.push('</div>');
    h.push(fieldHtml("rmdCfPresenting", "Presenting complaint (why the patient came)", areaInput("rmdCfPresenting", "presenting", cf.presenting, "Symptoms and how long they were present")));
    h.push(fieldHtml("rmdCfPresentingDate", "Date of first presentation", dateInput("rmdCfPresentingDate", "presentingDate", cf.presentingDate), "Day 0 of the timeline."));
    h.push(fieldHtml("rmdCfHistory", "History", areaInput("rmdCfHistory", "history", cf.history, "Past illness, medicines, habits, family history")));
    h.push(fieldHtml("rmdCfExamination", "Examination findings", areaInput("rmdCfExamination", "examination", cf.examination, "Vitals and what you found on examining the patient")));
    h.push('<div class="rmd-field"><label>Investigations (test results)</label>');
    h.push('<div id="rmdCfInvList">');
    for (i = 0; i < cf.investigations.length; i++) {
      inv = cf.investigations[i];
      h.push('<div class="rmd-cf-invrow">');
      h.push(fieldHtml("rmdCfInvDate" + i, "Date", '<input type="date" id="rmdCfInvDate' + i + '" data-rmd-cf-inv="' + i + '" data-rmd-cf-invkey="date" value="' + esc(inv.date) + '">'));
      h.push(fieldHtml("rmdCfInvTest" + i, "Test", '<input type="text" id="rmdCfInvTest' + i + '" data-rmd-cf-inv="' + i + '" data-rmd-cf-invkey="test" value="' + esc(inv.test) + '" autocomplete="off" placeholder="Troponin I">'));
      h.push(fieldHtml("rmdCfInvValue" + i, "Value", '<input type="text" id="rmdCfInvValue' + i + '" data-rmd-cf-inv="' + i + '" data-rmd-cf-invkey="value" value="' + esc(inv.value) + '" autocomplete="off" placeholder="8.4">'));
      h.push(fieldHtml("rmdCfInvUnit" + i, "Unit", '<input type="text" id="rmdCfInvUnit' + i + '" data-rmd-cf-inv="' + i + '" data-rmd-cf-invkey="unit" value="' + esc(inv.unit) + '" autocomplete="off" placeholder="ng/mL">'));
      h.push('<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm rmd-cf-invremove" data-rmd-cf-invremove="' + i + '">Remove</button>');
      h.push('</div>');
    }
    h.push('</div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-cf="addinv">Add investigation</button>');
    h.push('</div>');
    h.push(fieldHtml("rmdCfDiagnosis", "Diagnosis", areaInput("rmdCfDiagnosis", "diagnosis", cf.diagnosis, "The final diagnosis", 2)));
    h.push(fieldHtml("rmdCfDiagnosisDate", "Date of diagnosis", dateInput("rmdCfDiagnosisDate", "diagnosisDate", cf.diagnosisDate)));
    h.push(fieldHtml("rmdCfTreatment", "Treatment", areaInput("rmdCfTreatment", "treatment", cf.treatment, "What was done for the patient")));
    h.push(fieldHtml("rmdCfTreatmentDate", "Date treatment started", dateInput("rmdCfTreatmentDate", "treatmentDate", cf.treatmentDate)));
    h.push(fieldHtml("rmdCfOutcome", "Outcome", areaInput("rmdCfOutcome", "outcome", cf.outcome, "How the patient was at discharge or at the end of the episode", 2)));
    h.push(fieldHtml("rmdCfOutcomeDate", "Outcome date", dateInput("rmdCfOutcomeDate", "outcomeDate", cf.outcomeDate)));
    h.push(fieldHtml("rmdCfFollowup", "Follow-up", areaInput("rmdCfFollowup", "followup", cf.followup, "What happened afterwards, if known", 2)));
    h.push(fieldHtml("rmdCfFollowupDate", "Follow-up date", dateInput("rmdCfFollowupDate", "followupDate", cf.followupDate)));
    h.push(fieldHtml("rmdCfUnusual", "What is new or unusual", areaInput("rmdCfUnusual", "unusual", cf.unusual, "Why this case is worth publishing", 2)));
    h.push('<div class="rmd-modal-footer">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-cf="example">See an example (zinc phosphide MI)</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cf="save">Save case file</button>');
    h.push('</div>');
    h.push('<p class="rmd-cf-savestatus" id="rmdCfSaveStatus" role="status" aria-live="polite">' + (st.saved ? "Saved on this phone. Nothing was uploaded." : "") + '</p>');
    h.push('</div></div>');
    return h.join("");
  }

  function timelineHtml() {
    var tl = buildTimeline(st.cf), i, e;
    var h = '<div class="rmd-card"><h3>Timeline</h3>';
    h += '<p class="rmd-muted">Built from the dates you entered. Day 0 is the first presentation. Entries without a date are listed last.</p>';
    h += '<div id="rmdCfTimeline">';
    if (!tl.length) {
      h += '<p class="rmd-muted">Add the presentation date and complaint to start the timeline.</p>';
    } else {
      h += '<ol class="rmd-cf-timeline">';
      for (i = 0; i < tl.length; i++) {
        e = tl[i];
        h += '<li class="rmd-cf-tl-row">';
        h += '<span class="rmd-cf-day">' + (e.day === null ? "No date" : "Day " + e.day) + '</span>';
        h += '<span class="rmd-cf-tl-text">' + esc(e.text) + (e.date ? ' <span class="rmd-muted">(' + esc(e.date) + ')</span>' : "") + '</span>';
        h += '</li>';
      }
      h += '</ol>';
    }
    h += '</div></div>';
    return h;
  }

  function patientsHtml() {
    var h = '<div class="rmd-card"><h3>Patients in this series</h3>';
    h += '<p class="rmd-muted">One case file per patient. Patient numbers only, never names or hospital numbers.</p>';
    h += '<div class="rmd-cf-patients" role="tablist" aria-label="Patients">';
    for (var i = 0; i < st.patients.length; i++) {
      var p = st.patients[i];
      var active = p.id === st.patientId;
      h += '<button type="button" role="tab" aria-selected="' + (active ? "true" : "false") + '" class="rmd-cf-patient' + (active ? " rmd-cf-patient-active" : "") + '" data-rmd-cf-patient="' + esc(p.id) + '">Patient ' + esc(p.id) + '</button>';
    }
    h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-cf="addpatient">Add patient</button>';
    h += '</div>';
    if (st.patients.length > 1) {
      h += '<button type="button" class="rmd-btn rmd-btn-quiet rmd-btn-sm" data-rmd-cf="removepatient">Remove patient ' + esc(st.patientId) + '</button>';
    }
    h += '</div>';
    return h;
  }

  function seriesFooterHtml() {
    var h = '<div class="rmd-card">';
    h += '<h3>Summarise the series</h3>';
    h += '<p class="rmd-muted">Turn the case files into a master chart to describe age, sex, test values and common features. No hypothesis test is run unless you ask for one.</p>';
    h += '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-cf="tochart"' + (st.busy ? " disabled" : "") + '>Turn into master chart</button>';
    h += '<p class="rmd-muted">For a surgical case series, many journals ask for PROCESS 2025. Check the journal\u2019s instructions.</p>';
    h += '</div>';
    return h;
  }

  function draw() {
    if (!st || !st.container) return;
    var h = [];
    h.push('<div class="rmd-p2-screen rmd-' + KEY + '-screen">');
    h.push(stepBannerHtml());
    if (st.loading) {
      h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.loadingHtml("Opening the case file") : "Loading") + '</div>');
    } else if (st.error) {
      h.push('<div class="rmd-card">' + (SMD.p2 ? SMD.p2.errHtml(st.error) : '<div class="rmd-banner rmd-banner-error" role="alert">' + esc(st.error.message) + '</div>') + '</div>');
    } else {
      if (st.mode === "series") h.push(patientsHtml());
      h.push(formHtml());
      h.push(timelineHtml());
      if (st.mode === "series") h.push(seriesFooterHtml());
    }
    h.push('</div>');
    st.container.innerHTML = h.join("");
    bind();
  }

  function refreshTimeline() {
    if (!st || !st.container) return;
    var card = st.container.querySelector("#rmdCfTimeline");
    if (!card) return;
    var tl = buildTimeline(st.cf), i, e;
    if (!tl.length) {
      card.innerHTML = '<p class="rmd-muted">Add the presentation date and complaint to start the timeline.</p>';
      return;
    }
    var h = '<ol class="rmd-cf-timeline">';
    for (i = 0; i < tl.length; i++) {
      e = tl[i];
      h += '<li class="rmd-cf-tl-row">';
      h += '<span class="rmd-cf-day">' + (e.day === null ? "No date" : "Day " + e.day) + '</span>';
      h += '<span class="rmd-cf-tl-text">' + esc(e.text) + (e.date ? ' <span class="rmd-muted">(' + esc(e.date) + ')</span>' : "") + '</span>';
      h += '</li>';
    }
    h += '</ol>';
    card.innerHTML = h;
  }

  function saveStatus(msg) {
    if (!st || !st.container) return;
    var el = st.container.querySelector("#rmdCfSaveStatus");
    if (el) el.textContent = msg;
  }

  function save() {
    var store = G.RMDStore;
    if (!store || !st) return Promise.resolve();
    var snapshot = normCasefile(st.cf);
    return store.put(st.pid, "casefile", st.patientId, snapshot).then(function (res) {
      if (res && res.ok === false) {
        st.error = { message: (res.warnings && res.warnings[0]) || "Could not save the case file on this phone." };
        draw();
        return;
      }
      st.saved = true;
      for (var i = 0; i < st.patients.length; i++) {
        if (st.patients[i].id === st.patientId) st.patients[i].value = snapshot;
      }
      saveStatus("Saved on this phone. Nothing was uploaded.");
    }).catch(function () {
      st.error = { message: "Could not save the case file on this phone. Try again." };
      draw();
    });
  }

  function nextPatientId() {
    var max = 0, i, n;
    for (i = 0; i < st.patients.length; i++) {
      n = parseInt(st.patients[i].id, 10);
      if (isFinite(n) && n > max) max = n;
    }
    return String(max + 1);
  }

  function load() {
    var store = G.RMDStore;
    if (!store || !store.list) {
      st.loading = false;
      st.error = { message: "Research storage is not available on this device yet." };
      draw();
      return;
    }
    store.list(st.pid, "casefile").then(function (recs) {
      st.patients = recs || [];
      var i, rec = null;
      if (st.mode === "series") {
        if (!st.patients.length) {
          st.patientId = "1";
          st.cf = emptyCasefile();
          st.patients = [{ id: "1", value: st.cf }];
          return store.put(st.pid, "casefile", "1", st.cf).then(function () {
            st.loading = false;
            draw();
          });
        }
        st.patientId = st.patients[0].id;
        st.cf = normCasefile(st.patients[0].value);
      } else {
        for (i = 0; i < st.patients.length; i++) if (st.patients[i].id === "case") rec = st.patients[i];
        st.patientId = "case";
        st.cf = rec ? normCasefile(rec.value) : emptyCasefile();
      }
      st.loading = false;
      draw();
    }).catch(function () {
      st.loading = false;
      st.error = { message: "Could not open the case file on this phone. Try again." };
      draw();
    });
  }

  function turnIntoChart() {
    var store = G.RMDStore;
    if (!store || st.busy) return;
    st.busy = true;
    draw();
    save().then(function () {
      var chart = chartFromCasefiles(st.patients);
      if (!chart.rows.length) {
        st.busy = false;
        st.error = { message: "Add at least one patient before making the master chart." };
        draw();
        return;
      }
      var value = { fileName: "Case series", sample: false, columns: chart.columns, rows: chart.rows, types: {}, fromCasefiles: true };
      return store.put(st.pid, "masterchart", "chart", value).then(function (res) {
        st.busy = false;
        if (res && res.ok === false) {
          st.error = { message: (res.warnings && res.warnings[0]) || "Could not save the master chart on this phone." };
          draw();
          return;
        }
        if (SMD.navigate) SMD.navigate("masterchart", { projectId: st.pid, describe: true });
      });
    }).catch(function () {
      st.busy = false;
      st.error = { message: "Could not build the master chart. Try again." };
      draw();
    });
  }

  function bind() {
    var c = st.container, i, els;
    els = c.querySelectorAll("[data-rmd-cf-field]");
    for (i = 0; i < els.length; i++) {
      els[i].oninput = function () {
        st.cf[this.getAttribute("data-rmd-cf-field")] = this.value;
        st.saved = false;
        refreshTimeline();
      };
      els[i].onchange = function () {
        st.cf[this.getAttribute("data-rmd-cf-field")] = this.value;
        refreshTimeline();
        save();
      };
    }
    els = c.querySelectorAll("[data-rmd-cf-inv]");
    for (i = 0; i < els.length; i++) {
      els[i].oninput = function () {
        var idx = parseInt(this.getAttribute("data-rmd-cf-inv"), 10);
        var key = this.getAttribute("data-rmd-cf-invkey");
        if (st.cf.investigations[idx]) {
          st.cf.investigations[idx][key] = this.value;
          st.saved = false;
          refreshTimeline();
        }
      };
      els[i].onchange = function () {
        var idx = parseInt(this.getAttribute("data-rmd-cf-inv"), 10);
        var key = this.getAttribute("data-rmd-cf-invkey");
        if (st.cf.investigations[idx]) {
          st.cf.investigations[idx][key] = this.value;
          refreshTimeline();
          save();
        }
      };
    }
    c.onclick = function (ev) {
      var t = ev.target, el = t, attr;
      while (el && el !== c) {
        if (el.getAttribute) {
          attr = el.getAttribute("data-rmd-cf");
          if (attr) { handleAction(attr); return; }
          attr = el.getAttribute("data-rmd-cf-invremove");
          if (attr != null && attr !== "") {
            st.cf.investigations.splice(parseInt(attr, 10), 1);
            save();
            draw();
            return;
          }
          attr = el.getAttribute("data-rmd-cf-patient");
          if (attr != null && attr !== "") {
            switchPatient(attr);
            return;
          }
        }
        el = el.parentNode;
      }
    };
  }

  function switchPatient(id) {
    var i;
    for (i = 0; i < st.patients.length; i++) {
      if (st.patients[i].id === id) {
        st.patientId = id;
        st.cf = normCasefile(st.patients[i].value);
        st.saved = true;
        draw();
        return;
      }
    }
  }

  function handleAction(action) {
    var store = G.RMDStore, i;
    if (action === "save") { save(); return; }
    if (action === "example") {
      st.cf = exampleCasefile();
      st.saved = false;
      save();
      draw();
      return;
    }
    if (action === "addinv") {
      st.cf.investigations.push({ date: "", test: "", value: "", unit: "" });
      draw();
      var last = st.container.querySelector('[data-rmd-cf-inv="' + (st.cf.investigations.length - 1) + '"][data-rmd-cf-invkey="test"]');
      if (last && last.focus) last.focus();
      return;
    }
    if (action === "addpatient" && store) {
      var id = nextPatientId();
      var cf = emptyCasefile();
      store.put(st.pid, "casefile", id, cf).then(function () {
        st.patients.push({ id: id, value: cf });
        st.patientId = id;
        st.cf = cf;
        st.saved = true;
        draw();
      }).catch(function () {
        st.error = { message: "Could not add a patient on this phone. Try again." };
        draw();
      });
      return;
    }
    if (action === "removepatient" && store) {
      if (!G.confirm || G.confirm("Remove patient " + st.patientId + " and their case file from this phone?")) {
        var rid = st.patientId;
        store.remove(st.pid, "casefile", rid).then(function () {
          var kept = [];
          for (i = 0; i < st.patients.length; i++) if (st.patients[i].id !== rid) kept.push(st.patients[i]);
          st.patients = kept;
          if (!kept.length) {
            st.patientId = "1";
            st.cf = emptyCasefile();
            st.patients = [{ id: "1", value: st.cf }];
            return store.put(st.pid, "casefile", "1", st.cf);
          }
          st.patientId = kept[0].id;
          st.cf = normCasefile(kept[0].value);
        }).then(function () {
          st.saved = true;
          draw();
        }).catch(function () {
          st.error = { message: "Could not remove the patient on this phone. Try again." };
          draw();
        });
      }
      return;
    }
    if (action === "tochart") { turnIntoChart(); return; }
  }

  function render(container, params) {
    if (!container) return;
    var proj = SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
    var pid = (params && params.projectId) || (proj && proj.id) || "local";
    st = freshState(pid, modeFor(proj));
    st.container = container;
    injectCss();
    draw();
    load();
  }

  SMD.screens[KEY] = { render: render };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      render: render,
      buildTimeline: buildTimeline,
      emptyCasefile: emptyCasefile,
      normCasefile: normCasefile,
      exampleCasefile: exampleCasefile,
      chartFromCasefiles: chartFromCasefiles
    };
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
