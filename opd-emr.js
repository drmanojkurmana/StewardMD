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

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
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
    var defs = [["profile", "Profile", "person"], ["inv", "Investigations", "science"], ["meds", "Medications", "pill"], ["assess", "Assessment", "clinical_notes"], ["protocol", "Protocol", "account_tree"], ["onco", "ONCQIS", "vaccines"]];
    return '<nav class="oe-tabs">' + defs.map(function (t) {
      return '<button class="oe-tab' + (t[0] === active ? " on" : "") + '" data-oe-act="tab:' + t[0] + '">' + ms(t[2]) + "<span>" + t[1] + "</span></button>";
    }).join("") + "</nav>";
  }
  function patientHead(p, phone) {
    var line = '<span>' + ms("badge") + ' MR# <b class="mono">' + esc(p.displayId || p.mrn || "-") + "</b></span>";
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
  // #156 — Lab-trend sparklines (flag smd_lab_sparklines, default OFF; ?labspark=1). PURE helpers below are
  // unit-tested; the multi-report fetch that feeds them (openLabTrend) needs on-device GHIS validation, so
  // the whole affordance stays OFF until the owner confirms the live parse. Neutral accent only (a rising
  // value is not inherently good or bad), so the sparkline never implies a clinical judgement.
  function labSparkOn() {
    try { if (G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_lab_sparklines")) return true; } catch (e) {}
    try { return /[?&]labspark=1/.test((G.location && G.location.search) || ""); } catch (e) { return false; }
  }
  // Numeric series for one analyte across fetched reports [{reported|orderDate, tests:[{test,result}]}].
  // -> [{t,v}] oldest-first; ignores narrative/non-numeric results. Pure.
  function labSeries(reports, testName) {
    var key = String(testName || "").trim().toLowerCase(), out = [];
    (reports || []).forEach(function (rp) {
      if (!rp) return;
      var t = Date.parse(rp.reported || rp.orderDate || "") || 0;
      (rp.tests || []).forEach(function (x) {
        if (!x || String(x.test || "").trim().toLowerCase() !== key) return;
        var v = parseFloat(x.result); if (!isNaN(v)) out.push({ t: t, v: v });
      });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  // Tiny inline trend SVG from a numeric array. <2 finite points -> "" (nothing to trend). Pure.
  function sparkline(nums, opts) {
    opts = opts || {}; var w = opts.w || 92, hgt = opts.h || 22, pad = 3;
    var xs = (nums || []).filter(function (n) { return typeof n === "number" && isFinite(n); });
    if (xs.length < 2) return "";
    var min = Math.min.apply(null, xs), max = Math.max.apply(null, xs), span = (max - min) || 1;
    var stepX = (w - 2 * pad) / (xs.length - 1);
    var pts = xs.map(function (v, i) {
      var x = pad + i * stepX, y = pad + (hgt - 2 * pad) * (1 - (v - min) / span);
      return (Math.round(x * 10) / 10) + "," + (Math.round(y * 10) / 10);
    });
    var lastXY = pts[pts.length - 1].split(",");
    return '<svg class="oe-spark" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + " " + hgt + '" preserveAspectRatio="none" aria-hidden="true" style="vertical-align:middle">' +
      '<polyline points="' + pts.join(" ") + '" fill="none" stroke="var(--primary,#0e6e63)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lastXY[0] + '" cy="' + lastXY[1] + '" r="2" fill="var(--primary,#0e6e63)"/></svg>';
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

  // ---- visit timeline (the encounter timeline addToTimeline() already records: assessment saved, inv
  // ordered, meds prescribed, notes, ER referral) — shown in the patient Profile, newest first. --------
  var TL_ICON = { note: "clinical_notes", medication: "medication", med: "medication", assessment: "assignment",
    investigation: "science", inv: "science", order: "science", vitals: "monitor_heart", checkout: "check_circle",
    referral: "emergency", er: "emergency" };
  function relTime(ts) {
    var d = now() - ts; if (!(d >= 0)) return "";
    var m = Math.floor(d / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60); if (h < 24) return h + "h ago"; return Math.floor(h / 24) + "d ago";
  }
  // "01-Aug-2026 10:00" / "01-Aug-2026" -> ms (best-effort; 0 if unparseable). Dashes -> spaces so Date can read it.
  function parseTs(s) { if (!s) return 0; var t = Date.parse(String(s).replace(/-/g, " ")); return isNaN(t) ? 0 : t; }
  // Merge THIS visit's recorded actions (encounter timeline) with the patient's existing GHIS history
  // (labs, imaging, current meds — which have dates), newest first, so the timeline is populated even
  // before any new action is taken.
  function buildTimeline(st) {
    var ev = [];
    (st.timeline || []).forEach(function (e) { ev.push({ ts: e.ts || 0, kind: e.kind, text: e.text, when: relTime(e.ts) + (e.by ? " · " + e.by : "") }); });
    (st.labs || []).forEach(function (l) { var d = l.reported || l.orderDate || ""; ev.push({ ts: parseTs(d), kind: "investigation", text: "Lab: " + (l.serviceName || l.testName || "") + (l.status ? " (" + l.status + ")" : ""), when: d }); });
    (st.radiology || []).forEach(function (r) { ev.push({ ts: parseTs(r.date), kind: "investigation", text: "Imaging: " + (r.description || ""), when: r.date || "" }); });
    (st.medications || []).forEach(function (m) { ev.push({ ts: parseTs(m.dateTime), kind: "medication", text: (m.drugText || m.drug || "") + [m.dosage, m.frequency, m.duration].filter(Boolean).map(function (x) { return " " + x; }).join(""), when: m.dateTime || "" }); });
    ev.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return ev;
  }
  function timelineSection(st) {
    if (usesLocal(st.source)) return clinicTimelineSection(st);   // clinic footprint (local/shared), not the GHIS visit timeline
    // GHIS: merge the crawled Opcard consults (st.timeline) with labs + meds + imaging below, newest-first,
    // so the timeline is never empty for a patient who has records but no prior OPD consult.
    if (st.timelineLoading && !(st.timeline || []).length && !(st.labs || []).length && !(st.medications || []).length) return '<section class="oe-sec"><div class="oe-h3">' + ms("history") + "Timeline</div>" + loadingBox(st.source === "ghis" ? "Loading history…" : "Loading timeline…") + "</section>";
    var tl = buildTimeline(st);
    if (!tl.length) {
      if (!st.ticketId) return "";   // nothing recorded + no history + not a queue visit -> hide
      return section("history", "Timeline", "", "", "No entries yet — the visit's history (labs, prescriptions, assessment) will appear here as it is documented.");
    }
    var rows = tl.map(function (e) {
      var ico = TL_ICON[String(e.kind || "").toLowerCase()] || "history";
      return '<div class="oe-tl-row"><div class="oe-tl-ic">' + ms(ico) + '</div><div class="oe-tl-b"><div class="oe-tl-t">' + esc(e.text || "") + '</div><div class="oe-tl-m">' + esc(e.when || "") + "</div></div></div>";
    }).join("");
    return '<section class="oe-sec"><div class="oe-h3">' + ms("history") + 'Timeline<span class="oe-sub">' + tl.length + " event" + (tl.length === 1 ? "" : "s") + '</span></div><div class="oe-tl">' + rows + "</div></section>";
  }
  function loadTimeline() {
    if (usesLocal(st.source)) { loadClinicTimeline(); return; }   // clinic footprint from the on-device store
    if (st.source === "ghis") { loadGhisHistory(); return; }      // hospital: crawl the GHIS Opcard history footprint
    if (!st.ticketId || !st.sessionId) return;
    st.timelineLoading = true;
    var forPatient = st;   // guard: a patient switch mid-fetch must not paint this timeline onto the new patient
    fbTok().then(function (t) {
      if (st !== forPatient) return;
      if (!t) { st.timelineLoading = false; return; }
      fetch(qBase() + "/api/queue/timeline?sessionId=" + encodeURIComponent(st.sessionId) + "&ticketId=" + encodeURIComponent(st.ticketId), { headers: { Authorization: "Bearer " + t } })
        .then(function (r) { return r.ok ? r.json() : { timeline: [] }; })
        .then(function (d) { if (st !== forPatient) return; st.timeline = (d && d.timeline) || []; st.timelineLoading = false; if (st.tab === "profile") paint(); })
        .catch(function () { if (st !== forPatient) return; st.timelineLoading = false; });
    }).catch(function () { if (st !== forPatient) return; st.timelineLoading = false; });
  }
  // #156 — one "<test> trend" chip per lab test the patient has ordered 2+ times (flag-gated OFF).
  function labTrendButtons(st) {
    if (!labSparkOn()) return "";
    var counts = {}; (st.labs || []).forEach(function (l) { var n = l.serviceName || l.testName; if (n) counts[n] = (counts[n] || 0) + 1; });
    var repeated = Object.keys(counts).filter(function (n) { return counts[n] >= 2; });
    if (!repeated.length) return "";
    return '<div class="oe-trend-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px">' +
      repeated.map(function (n) { return '<button class="oe-chip" data-oe-act="labtrend:' + esc(n) + '" style="border:1px solid var(--border);background:var(--card);border-radius:999px;padding:5px 10px;font:600 12px var(--font,inherit);color:var(--ink);cursor:pointer">' + ms("timeline") + esc(n) + " trend</button>"; }).join("") + "</div>";
  }
  // Trend panel: for each numeric analyte present in 2+ of the fetched reports, a row of name + sparkline +
  // first -> latest. Reuses the tested labSeries/sparkline. Live data via openLabTrend (on-device validated).
  function labTrendPanel(trend) {
    if (!trend) return "";
    var head = '<section class="oe-sec"><h3 class="oe-h3">' + ms("timeline") + esc(trend.name) + " trend" +
      '<button class="oe-linkbtn" data-oe-act="trend-close" style="margin-left:auto">Close</button></h3>';
    if (trend.loading) return head + loadingBox("Loading trend…") + "</section>";
    if (trend.err) return head + errorBox(trend.err) + "</section>";
    var names = {}; (trend.reports || []).forEach(function (rp) { (rp.tests || []).forEach(function (x) { if (x && x.test && !isNaN(parseFloat(x.result))) names[x.test] = true; }); });
    var rows = Object.keys(names).map(function (nm) {
      var series = labSeries(trend.reports, nm); if (series.length < 2) return "";
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<span style="flex:1;font:600 13px var(--font,inherit)">' + esc(nm) + "</span>" + sparkline(series.map(function (p) { return p.v; })) +
        '<span style="font:600 12px var(--font,inherit);color:var(--muted)">' + esc(String(series[0].v)) + " → " + esc(String(series[series.length - 1].v)) + "</span></div>";
    }).filter(Boolean).join("");
    return head + (rows || '<div class="oe-empty sm">Not enough repeat numeric results to trend yet.</div>') + "</section>";
  }
  function profileTab(st) {
    var labs = (st.labs || []).map(labRow).join(""), rad = (st.radiology || []).map(radRow).join("");
    var reports = section("history", "Reports", "Investigations we ordered", (labTrendButtons(st) + labs + rad) || "", "No labs or imaging on record.");
    var meds = section("pill", "Current medications", "", (st.medications || []).map(medRow).join(""), "No current medications on record.");
    return (st.trend && st.trend.open ? labTrendPanel(st.trend) : "") + timelineSection(st) + reports + meds;
  }
  // Standalone Investigations for a clinic patient (local/shared) — record onto the clinic store, no GHIS.
  function clinicInvTab(st) {
    var d = st.invDraft || {};
    var form = '<div class="oe-draft"><div class="oe-draft-h">' + ms("science") + "<b>Record an investigation</b></div>" +
      fieldRow("Investigation", textInp("cinv-name", d.name, "e.g. CBC, LFT, X-ray chest")) +
      fieldRow("Note", textInp("cinv-note", d.note, "Optional (indication / instructions)")) +
      '<button class="oe-btn primary" data-oe-act="clinic-inv-add">' + ms("add") + "Add to record</button></div>";
    var list = (_localStore && _localStore.listInvestigations) ? _localStore.listInvestigations(st.patient.mrn) : [];
    var rows = list.map(function (x) { return '<div class="oe-row"><span class="oe-row-ic">' + ms("science") + '</span><span class="oe-row-b"><span class="oe-row-t">' + esc(x.name || "") + '</span><span class="oe-row-s">' + esc([fmtClinicDate(x.ts), x.author, x.note].filter(Boolean).join(" · ")) + "</span></span></div>"; }).join("");
    return form + section("history", "Investigations ordered", list.length + " on record", rows, "No investigations recorded yet.");
  }
  // Standalone Medications for a clinic patient (local/shared) — prescribe onto the clinic store, no GHIS.
  function clinicMedsTab(st) {
    var d = st.medDraft || {};
    var form = '<div class="oe-draft"><div class="oe-draft-h">' + ms("medication") + "<b>Prescribe a medication</b></div>" +
      fieldRow("Drug", textInp("crx-drug", typeof d.drug === "string" ? d.drug : "", "e.g. Tab Paracetamol 650")) +
      fieldRow("Dose", textInp("crx-dose", d.dose, "e.g. 1 tab")) +
      fieldRow("Frequency", textInp("crx-freq", d.frequency, "e.g. TDS")) +
      fieldRow("Duration", textInp("crx-dur", d.duration, "e.g. 5 days")) +
      fieldRow("Remarks", textInp("crx-rem", d.remarks, "Optional")) +
      '<button class="oe-btn primary" data-oe-act="clinic-rx-add">' + ms("add") + "Add to record</button></div>";
    var list = (_localStore && _localStore.listPrescriptions) ? _localStore.listPrescriptions(st.patient.mrn) : [];
    var rows = list.map(function (x) { return '<div class="oe-row"><span class="oe-row-ic">' + ms("medication") + '</span><span class="oe-row-b"><span class="oe-row-t">' + esc([x.drug, x.dose].filter(Boolean).join(" ")) + '</span><span class="oe-row-s">' + esc([x.freq, x.duration, fmtClinicDate(x.ts), x.author].filter(Boolean).join(" · ")) + "</span></span></div>"; }).join("");
    return form + section("pill", "Medications prescribed", list.length + " on record", rows, "No medications recorded yet.");
  }
  function invTab(st) {
    if (usesLocal(st.source)) return clinicInvTab(st);
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
    return searchBox("inv", st.invQuery, "Search investigation services…") + '<div class="oe-searchout" id="oe-out-inv">' + resultList("inv", st.invResults) + searchStatus(st, "inv") + "</div>" + draft + existing;
  }
  function medsTab(st) {
    if (usesLocal(st.source)) return clinicMedsTab(st);
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
    return searchBox("med", st.medQuery, "Search medications…") + '<div class="oe-searchout" id="oe-out-med">' + resultList("med", st.medResults) + searchStatus(st, "med") + "</div>" + draft + current;
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
  // "Search ICD" button, shown only on the provisional diagnosis field - picking a code appends
  // "CODE - Title" as a new line rather than replacing whatever the doctor already typed, same
  // additive behaviour as the per-field mic. window.SMD_ICD comes from icd.js (loaded default-on,
  // no flag - see vault/modules/ICD Search.md).
  function icdBtn(name) {
    if (!G.SMD_ICD) return "";
    return '<button type="button" class="oe-fmic oe-icdbtn" data-oe-act="icdsearch:' + esc(name) + '" aria-label="Search ICD" title="Search ICD-10 / ICD-11 code">' + ms("search") + "</button>";
  }
  // MaiK-assisted suggestion, same button-pair idea as icu.js: manual search stays a plain magnifier
  // icon, MaiK suggestion gets its own icon so the two are never confused for the same action.
  function icdSuggestBtn(name) {
    if (!G.SMD_AI || !G.SMD_AI.extract) return "";
    return '<button type="button" class="oe-fmic oe-icdbtn" data-oe-act="icdsuggest:' + esc(name) + '" aria-label="Suggest ICD code (MaiK)" title="Suggest ICD code (MaiK)">' + ms("auto_awesome") + "</button>";
  }
  function assessField(f, vals) {
    var val = assessGet(vals, f), id = "assess:" + f.n, re = f.r && !val;
    if (f.k === "textarea") {
      var extra = f.n === "provisional_diagnosis" ? (icdBtn(f.n) + icdSuggestBtn(f.n)) : "";
      var panel = f.n === "provisional_diagnosis" ? '<div class="oe-icdsug" id="oeIcdSug"></div>' : "";
      return fieldRow(f.l, '<span class="oe-inp-wrap"><textarea class="oe-inp" data-oe-inp="' + esc(id) + '">' + esc(val) + "</textarea>" + fmicBtn(f.n) + extra + "</span>" + panel, f.r, re);
    }
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
    // Bilingual view: the LLM's English translation on top, the ORIGINAL spoken script (e.g. Telugu)
    // below it. Shown once refine has produced voiceTranscriptEn; during live dictation only the raw
    // original exists, so it shows that. The EMR complaint is still extracted in English by the LLM.
    var txEn = (st.voiceTranscriptEn || "").trim();
    function bilingualTx() {
      if (txEn && txEn !== tx.trim()) return '<div class="oe-vc-tx-en">' + esc(txEn) + "</div>" +
        '<div class="oe-vc-tx-orig"><span class="oe-vc-orig-lbl">' + ms("translate") + "Spoken (original)</span>" + esc(tx) + "</div>";
      return esc(tx);
    }
    function notesBox(live, edit) {
      var qa = st.notesView === "qa";
      var tog = tx ? '<span class="oe-vc-vtog">' +
        '<button class="oe-vc-vt' + (qa ? "" : " on") + '" data-oe-act="notes-view:raw">Raw</button>' +
        '<button class="oe-vc-vt' + (qa ? " on" : "") + '" data-oe-act="notes-view:qa">Q&amp;A</button></span>' : "";
      var acts = tx ? '<span class="oe-vc-notes-acts">' +
        (edit ? '<button class="oe-vc-nbtn" data-oe-act="notes-copy" aria-label="Copy VoiceNote">' + ms("content_copy") + "Copy</button>" +
                '<button class="oe-vc-nbtn primary" data-oe-act="notes-save" aria-label="Save to Present history">' + ms("save") + "Save</button>" : "") +
        '<button class="oe-vc-nbtn danger" data-oe-act="notes-clear" aria-label="Clear VoiceNote">' + ms("delete") + "Clear</button></span>" : "";
      var head = '<div class="oe-vc-notes-h">' + ms("clinical_notes") + "<span>VoiceNote</span>" + tog + acts + "</div>";
      var body = qa ? qaHtml()
        : edit ? ((txEn && txEn !== tx.trim() ? '<div class="oe-vc-tx-en ro">' + esc(txEn) + "</div>" : "") +
                  '<textarea class="oe-vc-edit" id="oeNotesEdit" data-oe-inp="notes" placeholder="Your words will appear here as you speak…">' + esc(tx) + "</textarea>")
        : '<div class="oe-vc-box' + (live ? " live" : "") + '"><div class="oe-vc-tx" id="oeTranscript">' +
          (tx ? bilingualTx() : '<span class="oe-vc-ph">Your words will appear here as you speak…</span>') + "</div></div>";
      return '<div class="oe-vc-notes">' + head + body + "</div>";
    }
    // Dictated investigations as removable chips (source of truth = st.dictatedInv). Tap x to drop it
    // (also strips its line from the Management plan); tap the order glyph to place it in GHIS.
    function invChips() {
      var list = st.dictatedInv || []; if (!list.length) return "";
      var canOrder = !usesLocal(st.source) && !st.noStore;   // GHIS ordering only; local/shared/decision-support have no server to order against
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
        '<div class="oe-vc-head"><span class="oe-vc-eyebrow proc">MaiK Scribe</span></div>' +
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
        '<div class="oe-vc-head"><span class="oe-vc-eyebrow">MaiK Scribe</span>' + langs + "</div>" +
        '<button class="oe-vc-orb" data-oe-act="voice-toggle" aria-label="Start MaiK Scribe"><span class="oe-vc-aura"></span><span class="oe-vc-aura d2"></span>' + ms("mic", true) + "</button>" +
        '<div class="oe-vc-status">' + (tx ? "MaiK Scribe completed" : "Start MaiK Scribe") + "</div>" +
        invChips() +
        (tx ? notesBox(false, true) : "") +
        '<div class="oe-vc-sub">Listen &amp; document</div>' +
        '<div class="oe-vc-priv">' + ms("lock") + "<span>Processed on this phone only. Never recorded, saved, or sent to the cloud. Please let the patient know you are taking voice notes.</span></div>" +
      "</div>";
    }

    // ON (listening / paused) — Stitch-style pill + breathing orb + live transcript.
    var bar = '<div class="oe-vc-bar">' +
        '<span class="oe-vc-live"><span class="oe-vc-dot' + (paused ? " paused" : "") + '"></span>' +
          '<span class="oe-vc-livetxt">' + (paused ? "MaiK Scribe paused" : "MaiK Scribe is listening") + "</span></span>" +
        '<span class="oe-vc-meta"><span class="oe-vc-timer" id="oeElapsed">' + esc(fmtElapsed((st._now || now()) - (st.voiceStartedAt || now()))) + "</span>" +
          '<span class="oe-vc-chip" id="oeVcModel" title="On-device model in use">' + esc(st.voiceModel || langChip) + "</span></span>" +
        '<span class="oe-vc-acts">' +
          '<button class="oe-vc-ic" data-oe-act="voice-pause" aria-label="' + (paused ? "Resume" : "Pause") + '">' + ms(paused ? "play_arrow" : "pause") + "</button>" +
          '<button class="oe-vc-ic stop" data-oe-act="voice-stop" aria-label="Stop">' + ms("stop") + "</button></span></div>";
    var readout = (st.scribeStats && st.scribeStats.filled) ? '<div class="oe-vc-readout"><span class="oe-vc-dot ok"></span>' + st.scribeStats.filled + " field" + (st.scribeStats.filled === 1 ? "" : "s") + " filled</div>" : "";
    return '<div class="oe-vc ' + (paused ? "paused" : "listening") + ' on">' + bar +
      '<button class="oe-vc-orb" data-oe-act="voice-pause" aria-label="' + (paused ? "Resume dictation" : "Pause dictation") + '"><span class="oe-vc-aura"></span><span class="oe-vc-aura d2"></span>' + ms("mic", true) + "</button>" +
      '<div class="oe-vc-status2" id="oeVoiceStatus" aria-live="polite" aria-atomic="true">' + esc(paused ? "MaiK Scribe paused" : (st.voiceStatus || "MaiK Scribe is listening")) + "</div>" +
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
        (opts.why ? '<div class="oe-ai-why">' + esc(opts.why) + "</div>" : "") +
        (opts.cite ? '<div class="oe-ai-cite" style="font-size:11px;color:#5a7184;margin-top:2px;display:flex;align-items:center;gap:4px">' + ms("menu_book") + esc(opts.cite) + "</div>" : "") + "</div>" +   // Explainable MaiK: guideline/source
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
    // Never-guess: when the top possibilities are genuinely close, say so instead of presenting a confident dx.
    if (s.lowConfidence) body += '<div class="oe-ai-lowconf" style="font:500 12.5px/1.45 system-ui;padding:9px 11px;border-radius:8px;margin:2px 0 8px;background:#fff8e1;color:#7a5b00;border-left:3px solid #eab308;display:flex;gap:6px;align-items:flex-start">' + ms("help") + "<span>MaiK is not confident here — the leading possibilities are close. Treat this as a checklist, not an answer; add discriminating findings (exam, labs) to narrow it.</span></div>";
    if (s.provisionalDx) body += aiGroup("Provisional diagnosis", scribeRow("dx", 0, { label: s.provisionalDx, why: s.provisionalWhy, accepted: !!s.acceptedDx }), null, 1);
    if (s.ddx && s.ddx.length) body += aiGroup("Differential", s.ddx.map(function (d, i) { return scribeRow("ddx", i, { label: d.label, score: d.score, why: d.why, accepted: !!(s.acceptedDdx && s.acceptedDdx[i]) }); }).join(""), null, s.ddx.length);
    if (s.investigations && s.investigations.length) body += aiGroup("Investigations to consider", s.investigations.map(function (d, i) { return scribeRow("inv", i, { label: d.label, accepted: !!(s.acceptedInv && s.acceptedInv[i]) }); }).join(""), "inv", s.investigations.length);
    if (s.treatment && s.treatment.length) body += aiGroup("Management / Treatment", s.treatment.map(function (d, i) { return scribeRow("rx", i, { label: d.label, cite: d.cite, accepted: !!(s.acceptedRx && s.acceptedRx[i]) }); }).join(""), "rx", s.treatment.length);
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
    var saveBtn = st.noStore
      ? '<span class="oe-btn ghost" data-oe-act="storage-info" title="This case is not saved" style="cursor:default">' + ms("info") + "Not saved</span>"
      : '<button class="oe-btn primary" data-oe-act="assess-save">' + ms("save") + "Save to " + ((st && st.emrLabel) || "GHIS") + "</button>";
    /* Three states, matching how GHIS actually works:
     *   draft      -> Save (editable; can be saved again and again)
     *   saved      -> Save + Authorise (Authorise is the permanent, locking sign-off)
     *   authorised -> neither. GHIS has locked the record; offering Save would only produce a failure.
     * The Authorise button keys off a real doc id, not "saved in this session", so reopening a patient
     * whose note was saved earlier still offers it. */
    var lock = st.assessAuthorized;
    var bar;
    if (lock) {
      bar = '<div class="oe-savebar locked"><div class="prog done">' + ms("lock") + "<span>Signed off</span></div>" +
        '<div class="oe-lockmsg">' + ms("verified") + "Authorised" + (lock.by ? " by " + esc(lock.by) : "") + (lock.on ? " on " + esc(lock.on) : "") +
        " &middot; locked in " + emrLabel() + "</div></div>";
    } else {
      var authBtn = (!st.noStore && oeDocId())
        ? '<button class="oe-btn authorise" data-oe-act="consult-authorise" title="Sign off in ' + ((st && st.emrLabel) || "GHIS") + ' - this locks the record">' + ms("verified") + "Authorise</button>"
        : "";
      bar = '<div class="oe-savebar"><div class="prog' + (done ? " done" : "") + '" title="' + reqDone + " of " + reqAll + ' required fields filled">' + ms(done ? "check_circle" : "edit_note") + "<span>" + reqDone + "/" + reqAll + "</span></div>" +
        '<button class="oe-btn ghost" data-oe-act="assess-clear" title="Clear every field and save a blank assessment">' + ms("delete_sweep") + "Clear</button>" +
        saveBtn + authBtn + "</div>";
    }
    return consultBar(st) + maikAskBtn(st) + oncoApplyOrReviewPanel(st) + '<div class="oe-accwrap">' + body + "</div>" + maikCta + suggestionsPanel(st) + bar + (st.savedConsult ? postConsultPanel() : "");
  }
  // Oncology apply-protocol suggestion (near provisional diagnosis, above the accordion, same spot
  // as the other AI-assist panels): offers ONLY ACTIVE protocols already fetched into st.oncoProtocols
  // (Phase 4). Once a plan is staged (st.oncoDraft), this slot shows the review/override panel
  // instead. Gated the same way the rest of the write UI is gated (flag + st.writeOn); delegates the
  // actual markup to onco-protocols.js (window.SMD_ONCOUI) so opd-emr.js stays the shell.
  function oncoApplyOrReviewPanel(st) {
    if (!oncoFlagOn() || !st.writeOn) return "";
    if (st.oncoDraft) return (G.SMD_ONCOUI && G.SMD_ONCOUI._buildReviewPanel) ? G.SMD_ONCOUI._buildReviewPanel(st.oncoDraft) : "";
    return oncoTreeLaunchBtn() + ((G.SMD_ONCOUI && G.SMD_ONCOUI._buildApplyPanel) ? G.SMD_ONCOUI._buildApplyPanel(st.oncoProtocols || []) : "");
  }
  // Launch the OncoTree pathway navigator FOR THIS PATIENT (carries patient ctx so its "Continue in
  // treatment workflow" hands the chosen protocol straight back here to compute doses). Nav-flag gated.
  function oncoNavOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_navigator")); } catch (e) { return false; } }
  function oncoTreeLaunchBtn() {
    if (!oncoNavOn() || !(G.SMD_ONCOTREE && G.SMD_ONCOTREE.open)) return "";
    return '<button class="oe-btn ghost oe-onco-tree" data-oe-act="onco-tree-open">' + ms("account_tree") + "Find protocol via OncoTree pathway</button>";
  }
  // "Let MaiK Ask" — optional AI-guided history taking (flag smd_maik_ask). Shown only when the feature
  // is on AND a complaint is documented (MaiK needs to know what to ask about). Delegates to SMD_MAIKASK.
  function maikAskBtn(st) {
    try { if (!(G.SMD_MAIKASK && G.SMD_MAIKASK.flagOn && G.SMD_MAIKASK.flagOn())) return ""; } catch (e) { return ""; }
    var v = st.assessVals || {}; var complaint = v.Chief_complaints_duration || v.History_present_illness || "";
    if (!String(complaint).trim()) return "";
    return '<button class="oe-maikask" data-oe-act="maik-ask"><span class="oe-maikask-ic">' + ms("record_voice_over") + "</span>" +
      '<span class="oe-maikask-tx"><b>Let MaiK Ask</b><span>MaiK asks the patient the missing history</span></span></button>';
  }
  // After a GHIS save the assessment IS the consult record; offer the two ways to finish: swipe to
  // close the consult (ends it / advances the queue) or the red button to send the patient to Emergency.
  function postConsultPanel() {
    return '<div class="oe-postsave"><div class="oe-postsave-msg">' + ms("check_circle") + "Saved to " + emrLabel() + " Initial Assessment. Authorise to sign off and move the queue on." +
      (oeDocId() ? ' <span class="oe-postsave-id">Record ' + esc(oeDocId()) + "</span>" : "") + "</div>" +
      // Authorise = the doctor's explicit sign-off. It ends the consult, which advances the OPD queue
      // (queue.js listens for smd:consult-end), so sign-off happens here rather than back in GHIS.
      // The swipe below still works; it was the ONLY way to finish before, which is easy to miss.
      '<button class="oe-btn primary" data-oe-act="consult-authorise">' + ms("verified") + "Authorise &amp; sign off</button>" +
      '<div class="oe-swipe" id="oeSwipe" role="button" tabindex="0" aria-label="Close consult — swipe, or press Enter"><div class="oe-swipe-fill"></div><span class="oe-swipe-txt">Swipe to close consult</span><div class="oe-swipe-knob" id="oeSwipeKnob">' + ms("chevron_right") + "</div></div>" +
      '<button class="oe-btn" data-oe-act="rx-share">' + ms("share") + "Share prescription (WhatsApp / print)</button>" +
      '<button class="oe-btn" data-oe-act="rx-refer">' + ms("forward") + "Refer patient</button>" +
      '<button class="oe-btn" data-oe-act="rx-summary">' + ms("description") + "Visit summary</button>" +
      ((G.SMD_FOLLOWCARE && G.SMD_FOLLOWCARE.enabled && G.SMD_FOLLOWCARE.enabled()) ? '<button class="oe-btn" data-oe-act="rx-followup">' + ms("event_repeat") + "Set follow-up</button>" : "") +   // enrol this patient into FollowCare -> pulls them back for a check-in
      '<button class="oe-btn er" data-oe-act="consult-er">' + ms("emergency") + "Send to Emergency (ER)</button></div>";
  }
  // Oncology tab (flag smd_onco_protocols, default OFF): the Tata-style drug x cycle dose matrix
  // (doctor view, READ-ONLY over st.oncoPlan) or, once toggled, the Phase 5 nurse execution view
  // ("Today's Chemotherapy", READ-ONLY over st.oncoPlan + st.oncoCycle - it never calculates a dose).
  // Delegates markup to onco-protocols.js / onco-nurse.js so opd-emr.js stays the shell; inert (not
  // enabled / no plan) never crashes.
  function oncoTab(st) {
    if (!oncoFlagOn()) return section("vaccines", "ONCQIS", "", "", "Oncology protocols are not enabled for this account.");
    var plan = st.oncoPlan;
    if (!plan) return section("vaccines", "ONCQIS", "", "", "No active treatment plan for this patient yet.");
    var toggle = oncoViewToggle(st);
    var body;
    if (st.oncoView === "nurse") {
      var cycle = st.oncoCycle;
      body = cycle
        ? ((G.SMD_ONCONURSE && G.SMD_ONCONURSE.buildNurseView) ? G.SMD_ONCONURSE.buildNurseView(plan, cycle) : '<div class="oe-empty sm">Nurse view unavailable.</div>')
        : '<div class="oe-empty sm">No cycle ready for administration yet.</div>';
    } else {
      body = (G.SMD_ONCOUI && G.SMD_ONCOUI._buildOncoMatrix) ? G.SMD_ONCOUI._buildOncoMatrix(plan) : '<div class="oe-empty sm">Oncology module unavailable.</div>';
      body += oncoCyclePanelHtml(st);   // doctor-only: create cycle / pre-chemo clearance / confirm to ready
      body += oncoPrintButtonHtml();    // Phase 6: 2-page Protocol PDF, built from this same plan/cycle
      body += oncoEmrButtonHtml(st);    // Phase G: [Add to EMR], only after CONFIRM & ACTIVATE
    }
    return section("vaccines", "ONCQIS", (plan.protocolId || "").toUpperCase(), toggle + body, "");
  }
  // Doctor-only per-cycle control panel (create/clearance/confirm), gated the same way the rest of
  // the write UI is gated (flag + smd_opd_emr_write) - a read-only doctor session sees only the
  // matrix, never these actions. Delegates markup to onco-protocols.js so opd-emr.js stays the shell.
  function oncoCyclePanelHtml(st) {
    if (!oncoFlagOn() || !st.writeOn) return "";
    return (G.SMD_ONCOUI && G.SMD_ONCOUI._buildCyclePanel) ? G.SMD_ONCOUI._buildCyclePanel(st.oncoPlan, st.oncoCycle, st.oncoClearanceDraft) : "";
  }
  // Phase 6: Print/PDF action, doctor view only. Read-only (no fetch, no write) so it is gated by the
  // module flag alone, not st.writeOn - a read-only doctor session can still print what is on screen.
  function oncoPrintButtonHtml() {
    return '<button class="oe-btn ghost oe-onco-print" data-oe-act="onco-print">' + ms("picture_as_pdf") + "Print / PDF</button>";
  }
  // Phase G: [Add to EMR] - doctor, write UI (st.writeOn), and ONLY once the plan is ACTIVE (post
  // CONFIRM & ACTIVATE). It is an explicit action, never fired automatically on activation.
  function oncoEmrButtonHtml(st) {
    var plan = st.oncoPlan || {};
    if (!oncoFlagOn() || !st.writeOn || plan.status !== "active") return "";
    return '<button class="oe-btn primary oe-onco-emr" data-oe-act="onco-add-emr">' + ms("save") + "Add to EMR</button>";
  }
  // Doctor/Nurse toggle for the Oncology tab (st.oncoView "doctor" | "nurse", default doctor). Purely
  // a local view switch - no fetch, mirrors the other data-oe-act toggles in this file.
  function oncoViewToggle(st) {
    var nurse = st.oncoView === "nurse";
    return '<div class="oe-onco-viewtoggle">' +
      '<button class="oe-btn ghost' + (nurse ? "" : " on") + '" data-oe-act="onco-view:doctor">' + ms("person") + "Doctor</button>" +
      '<button class="oe-btn ghost' + (nurse ? " on" : "") + '" data-oe-act="onco-view:nurse">' + ms("healing") + "Nurse</button></div>";
  }
  // ---- Protocol tab: search the reference protocol library + Assign to this patient --------------
  // Search is a LOCAL filter over st.oncoProtocols (the 124 /kb/protocols/*.json already loaded);
  // Assign creates a DRAFT plan (server accepts the client template) + a timeline entry, then returns
  // to the OPD profile. No auto-activation — the ONCQIS tab still owns dose-lock + administration.
  function protocolTab(st) {
    if (!oncoFlagOn()) return section("account_tree", "Protocol", "", "", "Oncology protocols are not enabled for this account.");
    if (!st.oncoProtocolsLoaded) { try { maybeLoadOncoProtocols(); } catch (e) {} return section("account_tree", "Protocol", "Loading the protocol library…", "", "Loading…"); }
    var disc = '<div class="oe-search-note" style="margin:0 0 8px">' + ms("info") + "Reference regimens — verify doses, BSA/AUC/carboplatin target, eligibility &amp; local protocol before administering. Assign attaches it to this patient (draft) and records it in the timeline.</div>";
    return section("account_tree", "Protocol", "Search &amp; assign a treatment protocol",
      disc + searchBox("proto", st.protoQuery, "Search by protocol name or cancer type…") +
      '<div class="oe-searchout" id="oe-out-proto">' + protoResults(st) + "</div>", "");
  }
  function protoResults(st) {
    var all = st.oncoProtocols || [];
    if (!all.length) return '<div class="oe-search-note">' + ms("search_off") + "No protocols in the library.</div>";
    var q = String(st.protoQuery || "").toLowerCase().trim();
    var list = !q ? all.slice(0, 50) : all.filter(function (p) {
      return ((p.name || "") + " " + (p.disease || "") + " " + (p.diseaseId || "")).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 50);
    if (!list.length) return '<div class="oe-search-note">' + ms("search_off") + "No protocol matches “" + esc(st.protoQuery) + "”.</div>";
    return list.map(function (p) {
      var intent = p.treatmentIntent && p.treatmentIntent.length ? " · " + esc([].concat(p.treatmentIntent).join("/")) : "";
      var right = st.writeOn
        ? '<button class="oe-btn primary" data-oe-act="proto-assign:' + esc(p.id) + '" style="flex:0 0 auto">' + ms("assignment_turned_in") + "Assign</button>"
        : '<span class="oe-search-note" style="margin:0">view only</span>';
      return '<div style="display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--oe-line,#e2e8f0)">' +
        '<div style="flex:1;min-width:0"><div style="font:700 14px/1.3 var(--oe-font,system-ui);color:var(--oe-ink,#0f172a)">' + esc(p.name || p.id) + "</div>" +
        '<div style="font:600 12px/1.4 var(--oe-font,system-ui);color:var(--oe-mut,#64748b)">' + esc(p.disease || "—") + intent + "</div></div>" + right + "</div>";
    }).join("");
  }
  function renderProtoOut() { try { var el = document.querySelector("#smdOpdEmr #oe-out-proto"); if (el) el.innerHTML = protoResults(st); } catch (e) {} }
  function assignProtocol(id) {
    var p = (st.oncoProtocols || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) { toast("Protocol not found."); return; }
    if (!st.writeOn) { toast("Open the patient in write mode to assign a protocol."); return; }
    if (!confirmed('Assign "' + (p.name || p.id) + '" to this patient? It attaches as a draft plan and is recorded in the timeline. Verify doses before administering.')) return;
    var body = { hospitalId: st.hospitalId || "", ghisPatientId: (st.patient && st.patient.mrn) || "", protocolId: p.id,
      intent: (p.treatmentIntent && [].concat(p.treatmentIntent)[0]) || "", patientParams: {}, template: p };
    toast("Assigning protocol…");
    oncoPost("/plan", body).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("Oncology writes are not enabled yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.plan) { toast("Could not assign the protocol. Please try again."); return; }
      st.oncoPlan = res.d.plan;
      try { addToTimeline("medication", "Oncology protocol assigned: " + (p.name || p.id)); } catch (e) {}
      toast("Protocol assigned — recorded in the timeline.");
      st.tab = "profile"; paint();   // back to OPD profile / timeline
    }).catch(function () { toast("Could not complete the request. Please try again."); });
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
      else if (active === "protocol") body = head + protocolTab(st);
      else if (active === "onco") body = head + oncoTab(st);
      else body = head + profileTab(st);
    }
    var app = '<div class="oe-app">' + header() + tabsNav(active) + '<div class="oe-canvas">' + body + "</div></div>";
    if (st.report && st.report.open) return app + reportView(st.report);   // report drawer overlays the workspace
    if (st.doseDrawer) return app + ((G.SMD_ONCOUI && G.SMD_ONCOUI.doseDrawerView) ? G.SMD_ONCOUI.doseDrawerView(st.doseDrawer) : "");   // dose drawer, cloned from the report-drawer pattern
    return app;
  }

  // ---- overlay + controller ----------------------------------------------------------------
  function flagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_opd_emr")); } catch (e) { return false; } }
  function writeFlagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_opd_emr_write")); } catch (e) { return false; } }
  function oncoFlagOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_protocols")); } catch (e) { return false; } }
  // EXPERIMENTAL test flag (default OFF): when ON, the workbench ALSO accepts experimental grounded
  // protocols (lifecycleState:draft + experimental:true). "active" is never set by promotion, so real
  // clinical activation stays a separate human decision - this only opens the owner/device test path.
  function oncoProtoLibOn() { try { return !!(G.SMD_QUEUE_FLAGS && G.SMD_QUEUE_FLAGS.bool && G.SMD_QUEUE_FLAGS.bool("smd_onco_protolib")); } catch (e) { return false; } }
  function oncoUsable(p) { return !!(p && (p.lifecycleState === "active" || (oncoProtoLibOn() && p.experimental))); }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  function root() { var el = document.getElementById("smdOpdEmr"); if (!el) { el = document.createElement("div"); el.id = "smdOpdEmr"; document.body.appendChild(el); } return el; }
  var st = freshState();
  function freshState() { return { loading: true, error: "", tab: "profile", writeOn: false, patient: {}, hospitalId: "", labs: [], radiology: [], medications: [], phone: "", invQuery: "", invResults: [], invDraft: {}, medQuery: "", medResults: [], medDraft: {}, assessLoaded: false, assessLoading: false, assessErr: "", assessVals: {}, report: null, scribeSuggestions: null, scribeStats: null, fieldMic: null, savedConsult: false, dictatedInv: [], voiceTranscript: "", voiceTranscriptEn: "", notesView: "raw", _notesSavedText: "", oncoPlan: null, doseDrawer: null, oncoProtocols: [], oncoProtocolsLoaded: false, protoQuery: "", oncoDraft: null, oncoOverrideDraft: {}, oncoView: "doctor", oncoCycle: null, oncoAdminDraft: {}, oncoClearanceDraft: {} }; }
  /* Keep the scroll position across a repaint.
   *
   * Every action in a consultation repaints the whole overlay with one innerHTML swap, and the new
   * .oe-canvas starts at scrollTop 0 - so each tap threw the doctor back to the top of the note and
   * they scrolled down again, mid-consultation, every time. queue.js paint() already does exactly
   * this for .q-canvas; this is the same fix for the EMR's own scroller.
   *
   * Restored synchronously, before the browser paints, so there is no visible jump. Guarded on a
   * non-zero top so genuinely re-opening a note still starts at the beginning. */
  function paint() {
    var r = root();
    var prev = r.querySelector(".oe-canvas"), top = prev ? prev.scrollTop : 0;
    r.innerHTML = _render(st);
    if (top) { var next = r.querySelector(".oe-canvas"); if (next) next.scrollTop = top; }
    try { initCloseSwipe(); } catch (e) {}
  }
  function paintKeepFocus(kind) {
    paint();
    try { var el = document.querySelector('#smdOpdEmr [data-oe-inp="' + kind + '-q"]'); if (el) { el.focus(); var v = el.value; el.value = ""; el.value = v; } } catch (e) {}
  }
  // Update ONLY the search-results container — never repaints the whole tab, so the search input keeps
  // focus and the soft keyboard stays open while typing (a full paint() closed the Android keyboard).
  function renderSearchOut(kind) {
    try {
      var el = document.getElementById("oe-out-" + kind);
      if (!el) return;   // container not in the DOM (tab not shown) -> nothing to do
      el.innerHTML = resultList(kind, kind === "inv" ? st.invResults : st.medResults) + searchStatus(st, kind);
    } catch (e) {}
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
  function addToTimeline(kind, text, vals, signOff, order, rx) {
    if (!st.ticketId || !st.sessionId || !text) return;   // only when opened from a queue ticket
    fbTok().then(function (t) {
      if (!t) return;
      var body = { sessionId: st.sessionId, ticketId: st.ticketId, kind: kind, text: String(text).slice(0, 1000) };
      // The doctor's Authorise, only after GHIS confirmed it. Distinct from a content save on purpose:
      // it carries no fields, and it must never be mistaken for one.
      if (signOff) body.signOff = true;
      // The structured fields travel WITH the summary text. The timeline keeps its text line; where
      // a tenant has opted a clinical write into the WardSynQ record (currently: vitals, kind
      // "assessment", an investigation order on a kind "note", and a prescription on a kind
      // "medication"), the server maps the structured payload into the canonical record and the
      // text line is untouched either way.
      if (vals) body.vals = vals;
      // What distinguishes an investigation order from every other kind:"note" line. Without it the
      // server treats this as a plain note and files nothing, which is exactly the old behaviour.
      if (order) body.order = order;
      // Likewise for a prescription against every other kind:"medication" line.
      if (rx) body.rx = rx;
      fetch(qBase() + "/api/queue/timeline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          // Off/shadow (every tenant today): the response is {ok:true, ...} and nothing changes here.
          // A tenant running the clinical record as authoritative can refuse this write; that must
          // not vanish silently, or "authoritative" would mean nothing a doctor could act on.
          if (d && d.ok === false && d.error === "record_refused") toast("Saved to " + emrLabel() + ". Could not also save to the clinical record - " + ((d.wardsynq && d.wardsynq.error) || "try again") + ".");
        }).catch(function () {});
    }).catch(function () {});
  }
  function assessSummary(v) {
    v = v || {}; var p = [];
    if (v.Chief_complaints_duration) p.push("Complaints: " + v.Chief_complaints_duration);
    if (v.provisional_diagnosis) p.push("Provisional diagnosis: " + v.provisional_diagnosis);
    if (v.management_plan) p.push("Plan: " + v.management_plan);
    return p.length ? p.join("\n") : "Initial assessment completed.";
  }

  // ---- Clinic timeline (source local/shared): the full chronological footprint (Homi-Bhabha-style),
  // grouped by date, newest first — every consult the doctor saved, with time + who entered it. --------
  function fmtClinicDate(ts) { var d = new Date(ts || 0); if (!ts || isNaN(d.getTime())) return "Undated"; function p(n) { return (n < 10 ? "0" : "") + n; } return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear(); }
  function fmtClinicTime(ts) { var d = new Date(ts || 0); if (!ts || isNaN(d.getTime())) return ""; function p(n) { return (n < 10 ? "0" : "") + n; } return p(d.getHours()) + ":" + p(d.getMinutes()); }
  function clinicNoteText(e) {
    var v = (e && e.vals) || {}, p = [];
    if (v.Chief_complaints_duration) p.push(v.Chief_complaints_duration);
    if (v.History_present_illness) p.push("HPI: " + v.History_present_illness);
    if (v.provisional_diagnosis) p.push("Dx: " + v.provisional_diagnosis);
    if (v.management_plan) p.push("Plan: " + v.management_plan);
    if (!p.length) { for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k) && typeof v[k] === "string" && v[k].trim() && k.indexOf("_yesNo") < 0) { p.push(v[k].trim()); if (p.length >= 3) break; } } }
    return p.join("\n") || "Assessment saved.";
  }
  function loadClinicTimeline() {
    st.timeline = [];
    try {
      var tl = (_localStore && _localStore.timeline) ? _localStore.timeline(st.patient.mrn) : [];
      st.timeline = (tl || []).map(function (e) { return { ts: e.ts || 0, kind: e.kind || "note", by: e.author || "", text: (e.text != null && e.text !== "") ? e.text : clinicNoteText(e) }; });
    } catch (x) {}
    st.timelineLoading = false;
    if (st.tab === "profile") paint();
  }
  // GHIS/hospital: crawl the patient's Opcard history (past OPD visits' clinical notes) from GHIS itself,
  // render in the SAME footprint UI. Read-only, live from GHIS — nothing is stored by StewardMD.
  function loadGhisHistory() {
    st.timeline = []; st.timelineLoading = true; if (st.tab === "profile") paint();
    var a = ghisAuth();
    var q = "?patientId=" + encodeURIComponent((st.patient && st.patient.mrn) || "") + "&visitId=" + encodeURIComponent(st.visitId || "") + "&episodeId=" + encodeURIComponent(st.episodeId || "");
    var forPatient = st;   // guard: don't paint patient A's history timeline onto patient B if the doctor switched mid-fetch
    fetch(a.base + "/history" + q, { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: false, d: {} }; }); })
      .then(function (res) {
        if (st !== forPatient) return;
        st.timelineLoading = false;
        var ents = (res.d && res.d.entries) || [], nowTs = now();
        st.timeline = ents.map(function (e, i) { return { ts: e.ts || (nowTs - i * 60000), by: e.by || "", kind: "note", text: e.text || "" }; });
        if (st.tab === "profile") paint();
      })
      .catch(function () { if (st !== forPatient) return; st.timelineLoading = false; if (st.tab === "profile") paint(); });
  }
  function clinicTimelineSection(s) {
    var tl = s.timeline || [];
    var head = '<div class="oe-h3">' + ms("history") + 'Timeline<span class="oe-sub">' + tl.length + " consult" + (tl.length === 1 ? "" : "s") + "</span>" +
      (tl.length ? '<button class="oe-sum-btn" data-oe-act="summarise" title="Summarise this patient\'s whole record">' + ms("auto_awesome") + "Summarise</button>" : "") + "</div>";
    if (!tl.length) return '<section class="oe-sec">' + head + '<div class="oe-ct-empty">No consults recorded yet. Save an assessment to start this patient\'s timeline.</div></section>';
    var groups = [], byDate = {};
    tl.forEach(function (e) { var d = fmtClinicDate(e.ts); if (!byDate[d]) { byDate[d] = []; groups.push(d); } byDate[d].push(e); });
    var body = groups.map(function (d) {
      var rows = byDate[d].map(function (e) {
        var note = String(e.text || "—").split("\n").map(function (ln) { return esc(ln); }).join("<br>");
        return '<div class="oe-ct-entry"><div class="oe-ct-meta">' + esc(fmtClinicTime(e.ts)) + (e.by ? ' · <b>' + esc(e.by) + "</b>" : "") + '</div><div class="oe-ct-note">' + note + "</div></div>";
      }).join("");
      return '<div class="oe-ct-day"><div class="oe-ct-date">' + esc(d) + "</div>" + rows + "</div>";
    }).join("");
    return (s.clinicSummary ? summaryCard(s.clinicSummary) : "") + '<section class="oe-sec">' + head + '<div class="oe-ct">' + body + "</div></section>";
  }
  // On-device patient summary (free tier): a deterministic overview of the whole timeline — problems, meds,
  // latest plan, pending follow-ups — for a patient with many consults. (Deeper AI summary = Pro/MaiK, later.)
  function buildClinicSummary(tl) {
    tl = tl || []; if (!tl.length) return null;
    var dates = tl.map(function (e) { return e.ts; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var range = dates.length ? (fmtClinicDate(dates[0]) + (dates.length > 1 && fmtClinicDate(dates[0]) !== fmtClinicDate(dates[dates.length - 1]) ? " to " + fmtClinicDate(dates[dates.length - 1]) : "")) : "";
    var problems = {}, meds = {}, followups = [];
    var medRe = /\b(?:tab|cap|syp|syr|inj|oint|t|c)\.?\s+([A-Za-z][A-Za-z0-9\-]{2,})/gi;
    tl.forEach(function (e) {
      var txt = String(e.text || "");
      txt.split("\n").forEach(function (ln) {
        ln = ln.trim();
        var m = /^(?:dx|diagnosis|impression|provisional[ _]diagnosis)\s*[:\-]\s*(.+)/i.exec(ln);
        if (m && m[1].trim()) problems[m[1].trim().toLowerCase()] = m[1].trim();
        if (/\b(review|r\/w|follow[\s-]?up|f\/u)\b/i.test(ln)) followups.push(ln);
      });
      var MED_STOP = { cough: 1, cold: 1, pain: 1, fever: 1, rest: 1, sos: 1, bd: 1, tds: 1, od: 1, hs: 1, syp: 1, susp: 1, drops: 1, review: 1 };
      var mm; medRe.lastIndex = 0; while ((mm = medRe.exec(txt))) { var dr = mm[1]; if (dr && !MED_STOP[dr.toLowerCase()]) meds[dr.toLowerCase()] = dr; }
    });
    function vals(o) { var a = []; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) a.push(o[k]); return a; }
    var latest = tl[0], planM = /plan\s*[:\-]\s*(.+)/i.exec(String((latest && latest.text) || ""));
    return { consults: tl.length, range: range, problems: vals(problems).slice(0, 8), meds: vals(meds).slice(0, 12),
      latestPlan: planM ? planM[1].trim() : "", latestBy: (latest && latest.by) || "", followups: followups.slice(0, 4) };
  }
  function summaryCard(s) {
    if (!s) return "";
    var closeBtn = '<button class="oe-sum-x" data-oe-act="summarise-close" title="Close">' + ms("close") + "</button>";
    if (s.loading) return '<section class="oe-sec oe-sum-card"><div class="oe-h3">' + ms("auto_awesome") + 'Patient overview<span class="oe-sub">Summarising…</span>' + closeBtn + '</div><div class="oe-sum-b"><div class="oe-sum-none">MaiK is summarising this patient\'s record…</div></div></section>';
    if (s.ai) return '<section class="oe-sec oe-sum-card"><div class="oe-h3">' + ms("auto_awesome") + 'Patient overview<span class="oe-sub">by MaiK</span>' + closeBtn + '</div><div class="oe-sum-b"><div class="oe-sum-txt">' + esc(s.text).replace(/\n/g, "<br>") + '</div><div class="oe-sum-note">Summarised by MaiK (Pro). Verify against the record.</div></div></section>';
    function chips(arr) { return arr.length ? '<div class="oe-sum-chips">' + arr.map(function (x) { return '<span class="oe-sum-chip">' + esc(x) + "</span>"; }).join("") + "</div>" : '<div class="oe-sum-none">Not documented</div>'; }
    return '<section class="oe-sec oe-sum-card"><div class="oe-h3">' + ms("auto_awesome") + "Patient overview<span class=\"oe-sub\">" + s.consults + " consult" + (s.consults === 1 ? "" : "s") + (s.range ? " &middot; " + esc(s.range) : "") + "</span>" + closeBtn + "</div>" +
      '<div class="oe-sum-b">' +
        '<div class="oe-sum-lbl">Active problems</div>' + chips(s.problems) +
        '<div class="oe-sum-lbl">Medications</div>' + chips(s.meds) +
        (s.latestPlan ? '<div class="oe-sum-lbl">Latest plan</div><div class="oe-sum-txt">' + esc(s.latestPlan) + "</div>" : "") +
        (s.followups.length ? '<div class="oe-sum-lbl">Follow-up</div><div class="oe-sum-txt">' + s.followups.map(esc).join("<br>") + "</div>" : "") +
        (s.capNote ? '<div class="oe-sum-note">' + esc(s.capNote) + "</div>" : "") +
        '<div class="oe-sum-note">On-device overview from this patient\'s record.</div>' +
      "</div></section>";
  }
  // Pro: send the whole timeline to MaiK for a deeper AI summary (module "summary", 15/day cap server-side).
  function maikSummarise(tl) {
    var text = tl.map(function (e) { return fmtClinicDate(e.ts) + (e.by ? " (" + e.by + ")" : "") + ": " + String(e.text || "").replace(/\s*\n\s*/g, "; "); }).join("\n").slice(0, 14000);
    var base = (typeof window !== "undefined" && window.AI_PROXY) || "/api/ai";
    var tokP; try { var cu = window.SMD_AUTH && SMD_AUTH.currentUser; tokP = (cu && cu.getIdToken) ? cu.getIdToken() : Promise.resolve(null); } catch (e) { tokP = Promise.resolve(null); }
    return tokP.then(function (t) {
      var h = { "Content-Type": "application/json" }; if (t) h["Authorization"] = "Bearer " + t;
      return fetch(base + "/summary", { method: "POST", headers: h, credentials: "same-origin", body: JSON.stringify({ text: text }) });
    }).then(function (r) { return r ? r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: false, d: {} }; }) : { ok: false, d: {} }; })
      .then(function (res) { return (res.ok && res.d.text) ? { text: res.d.text } : (res.d && res.d.reason === "module-daily" ? { over: true } : null); });
  }
  function summariseClinic() {
    var tl = st.timeline || []; if (!tl.length) { toast("No consults to summarise yet."); return; }
    var pro = false; try { pro = !!(window.SMD_PRO && SMD_PRO.isProSync && SMD_PRO.isProSync()); } catch (e) {}
    if (pro) {
      st.clinicSummary = { loading: true }; paint();
      maikSummarise(tl).then(function (r) {
        if (r && r.text) st.clinicSummary = { ai: true, text: r.text, consults: tl.length };
        else { st.clinicSummary = buildClinicSummary(tl); if (st.clinicSummary && r && r.over) st.clinicSummary.capNote = "Daily MaiK summary limit reached (15/day) — showing the on-device overview."; }
        paint();
      }, function () { st.clinicSummary = buildClinicSummary(tl); paint(); });
      return;
    }
    st.clinicSummary = buildClinicSummary(tl); paint();
  }

  // free-text field edits update state silently (no repaint) so focus/caret are never lost mid-typing.
  function setField(inp, val) {
    var map = { "inv-dx": ["invDraft", "diagnosis"], "med-route": ["medDraft", "route"], "med-form": ["medDraft", "form"], "med-qty": ["medDraft", "qty"], "med-freq": ["medDraft", "frequency"], "med-dur": ["medDraft", "duration"], "med-remarks": ["medDraft", "remarks"],
      "cinv-name": ["invDraft", "name"], "cinv-note": ["invDraft", "note"], "crx-drug": ["medDraft", "drug"], "crx-dose": ["medDraft", "dose"], "crx-freq": ["medDraft", "frequency"], "crx-dur": ["medDraft", "duration"], "crx-rem": ["medDraft", "remarks"] };
    if (map[inp]) { st[map[inp][0]] = st[map[inp][0]] || {}; st[map[inp][0]][map[inp][1]] = val; return; }
    if (inp.indexOf("assess:") === 0) { var an = inp.slice(7); st.assessVals = st.assessVals || {}; st.assessVals[an] = val; st.assessTouched = st.assessTouched || {}; st.assessTouched[an] = true; return; }
    // Oncology override staging (Phase 4): silent, no repaint (mirrors the assess: fields above) so
    // typing a dose/reason never loses focus. Nothing is recorded into st.oncoDraft.overrides until
    // the doctor taps "Save override" (oncoSaveOverride), which requires the reason to be non-empty.
    if (inp.indexOf("onco-ov-val:") === 0) { var dv = inp.slice(12); st.oncoOverrideDraft = st.oncoOverrideDraft || {}; st.oncoOverrideDraft[dv] = st.oncoOverrideDraft[dv] || {}; st.oncoOverrideDraft[dv].val = val; return; }
    if (inp.indexOf("onco-ov-reason:") === 0) { var dr = inp.slice(15); st.oncoOverrideDraft = st.oncoOverrideDraft || {}; st.oncoOverrideDraft[dr] = st.oncoOverrideDraft[dr] || {}; st.oncoOverrideDraft[dr].reason = val; return; }
    // Nurse administration staging (Phase 5): keyed by the SAME "<cycleId>:<drugId>" string the
    // [Start] button's data-oe-act carries, so oncoStart() reads it back with zero re-parsing.
    // Silent (no repaint) - same reason as the override inputs above.
    if (inp.indexOf("onco-admin-dose:") === 0) { var adk = inp.slice(16); st.oncoAdminDraft = st.oncoAdminDraft || {}; st.oncoAdminDraft[adk] = st.oncoAdminDraft[adk] || {}; st.oncoAdminDraft[adk].dose = val; return; }
    if (inp.indexOf("onco-admin-reaction:") === 0) { var ark = inp.slice(20); st.oncoAdminDraft = st.oncoAdminDraft || {}; st.oncoAdminDraft[ark] = st.oncoAdminDraft[ark] || {}; st.oncoAdminDraft[ark].reaction = val; return; }
    // Doctor pre-chemo clearance staging (Phase 5 gap-fix): the overall status <select>; silent
    // (no repaint) like every other draft field above - the [Resolve clearance] tap is what submits it.
    if (inp === "onco-clr-status") { st.oncoClearanceDraft = st.oncoClearanceDraft || {}; st.oncoClearanceDraft.status = val; return; }
  }
  function onInput(e) {
    var el = e.target, inp = el.getAttribute && el.getAttribute("data-oe-inp"); if (!inp) return;
    if (inp === "proto-q") { st.protoQuery = el.value; renderProtoOut(); return; }   // local filter — no network, keep focus
    if (inp === "inv-q") { st.invQuery = el.value; scheduleSearch("inv"); return; }
    if (inp === "med-q") { st.medQuery = el.value; scheduleSearch("med"); return; }
    if (inp === "notes") { st.voiceTranscript = el.value; _lastFullTranscript = el.value; return; }   // doctor edits the clinical-notes transcript after Stop
    setField(inp, el.type === "checkbox" ? (el.checked ? "true" : "false") : el.value);   // radios carry Y/N in value
  }
  var searchTimer = null;
  function scheduleSearch(kind) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(function () { runSearch(kind); }, 250); }
  // GHIS's search matches full service names, not abbreviations (measured: "cbc" -> 0 rows, "complete
  // blood count" -> 1). Expand the common ones a clinician types so the search actually finds them.
  var INV_ABBREV = { cbc: "complete blood count", cbp: "complete blood", hemogram: "complete blood count",
    lft: "liver function", rft: "renal function", kft: "kidney function", rbs: "random blood sugar",
    fbs: "fasting blood sugar", ppbs: "postprandial blood sugar", grbs: "random blood sugar", hba1c: "glycosylated",
    tsh: "thyroid stimulating", esr: "erythrocyte sedimentation", crp: "c reactive protein", ecg: "electrocardiogram",
    ekg: "electrocardiogram", cxr: "chest x ray", usg: "ultrasound", lipid: "lipid profile", "pt inr": "prothrombin",
    inr: "prothrombin", bun: "blood urea", "urine r/e": "urine routine", "2d echo": "echocardiogram" };
  function expandQuery(kind, q) { if (kind !== "inv") return q; var k = String(q || "").toLowerCase().trim(); return INV_ABBREV[k] || q; }
  // WardSynQ-native hospital, investigation search ONLY: the org's own billing-tariff catalog
  // (kind:"investigation" rows), Firebase-authed, via GET /api/queue/inv-catalog. Medication search
  // stays "offghis" for wardsynq deliberately — no native prescribing until CDSS is wired in (see
  // submitPrescribe's header), so there is nothing safe to search a drug catalog FOR yet.
  function runWardsynqInvSearch(q) {
    st.invResults = []; st.invSearchMsg = "searching"; renderSearchOut("inv");
    fbTok().then(function (t) {
      if (!t) { st.invResults = []; st.invSearchMsg = "login"; renderSearchOut("inv"); return; }
      fetch(qBase() + "/api/queue/inv-catalog?sessionId=" + encodeURIComponent(st.sessionId || "") + "&q=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + t } })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: r.ok, d: {} }; }); })
        .then(function (res) {
          if (!res.ok || (res.d && res.d.error)) { st.invResults = []; st.invSearchMsg = "error"; }
          else { st.invResults = (res.d && res.d.rows) || []; st.invSearchMsg = st.invResults.length ? "" : "none"; }
          renderSearchOut("inv");
        })
        .catch(function () { st.invResults = []; st.invSearchMsg = "error"; renderSearchOut("inv"); });
    }).catch(function () { st.invResults = []; st.invSearchMsg = "error"; renderSearchOut("inv"); });
  }
  function runSearch(kind) {
    var q = kind === "inv" ? st.invQuery : st.medQuery, key = kind === "inv" ? "invResults" : "medResults", mkey = kind + "SearchMsg";
    if (!q || q.length < 2) { st[key] = []; st[mkey] = ""; renderSearchOut(kind); return; }
    if (kind === "inv" && st.source === "wardsynq") { runWardsynqInvSearch(q); return; }
    // Search is a GHIS (hospital) lookup — needs a live Ward Sync session + is meaningless off-hospital.
    if (st.source && st.source !== "ghis") { st[key] = []; st[mkey] = "offghis"; renderSearchOut(kind); return; }
    st[key] = []; st[mkey] = "searching"; renderSearchOut(kind);
    var a = ghisAuth(), path = kind === "inv" ? "/inv-search" : "/drug-search", qsend = expandQuery(kind, q);
    fetch(a.base + path + "?q=" + encodeURIComponent(qsend), { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; }, function () { return { ok: r.ok, status: r.status, d: {} }; }); })
      .then(function (res) {
        if (res.status === 401 || (res.d && res.d.error === "login_required")) { st[key] = []; st[mkey] = "login"; }
        else if (!res.ok || (res.d && res.d.error)) { st[key] = []; st[mkey] = "error"; }
        else { st[key] = (res.d && res.d.rows) || []; st[mkey] = st[key].length ? "" : "none"; }
        renderSearchOut(kind);
      })
      .catch(function () { st[key] = []; st[mkey] = "error"; renderSearchOut(kind); });
  }
  // Visible search feedback (was silent: a dead GHIS session / parse-miss looked like a broken search).
  function searchStatus(st, kind) {
    var m = kind === "inv" ? st.invSearchMsg : st.medSearchMsg;
    if (!m) return "";
    if (m === "searching") return '<div class="oe-search-note">' + ms("hourglass_top") + "Searching GHIS…</div>";
    if (m === "none") return '<div class="oe-search-note">' + ms("search_off") + "No matches. Try a different term or spelling.</div>";
    if (m === "offghis") return '<div class="oe-search-note">' + ms("info") + "Search looks up hospital (GHIS) services — not available for this record.</div>";
    if (m === "login") return '<div class="oe-search-note err">' + ms("lock") + "Ward Sync (GHIS) session is not active. <button class=\"oe-linkbtn\" data-oe-act=\"ghis-reconnect\">Reconnect</button> to search.</div>";
    return '<div class="oe-search-note err">' + ms("error") + "Search failed. Check your connection and try again.</div>";
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-oe-act]"); if (!b) return;
    var a = b.getAttribute("data-oe-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") return close();
    if (cmd === "tab") return switchTab(arg);
    if (cmd === "lab" || cmd === "rad") return openReport(cmd, arg);
    if (cmd === "report-close") { st.report = null; paint(); return; }
    if (cmd === "labtrend") return openLabTrend(arg);
    if (cmd === "trend-close") { st.trend = null; paint(); return; }
    if (cmd === "inv-pick") { var s = st.invResults[+arg]; if (s) { st.invDraft = { service: s, diagnosis: (st.invDraft && st.invDraft.diagnosis) || "", emergency: false }; st.invResults = []; st.invQuery = ""; paint(); } return; }
    if (cmd === "inv-clear") { st.invDraft = {}; paint(); return; }
    if (cmd === "inv-emg") { st.invDraft = st.invDraft || {}; st.invDraft.emergency = !st.invDraft.emergency; paint(); return; }
    if (cmd === "inv-order") return submitInvOrder();
    if (cmd === "med-pick") { var m = st.medResults[+arg]; if (m) { st.medDraft = { drug: m, route: "", form: "", qty: "", frequency: "", duration: "", remarks: "" }; st.medResults = []; st.medQuery = ""; paint(); } return; }
    if (cmd === "med-clear") { st.medDraft = {}; paint(); return; }
    if (cmd === "med-rx") return submitPrescribe();
    if (cmd === "ghis-reconnect") {
      var kind = st.tab === "meds" ? "med" : "inv";
      if (G.GHIS && G.GHIS.ensureSession) { G.GHIS.ensureSession().then(function (ok) { if (ok) runSearch(kind); }); }
      else if (G.openGHIS) { try { G.openGHIS(); } catch (e) {} }
      return;
    }
    if (cmd === "assess-save") return submitAssessment();
    if (cmd === "summarise") return summariseClinic();
    if (cmd === "summarise-close") { st.clinicSummary = null; paint(); return; }
    if (cmd === "clinic-inv-add") {
      var iv = st.invDraft || {}; if (!String(iv.name || "").trim()) return;
      try { if (_localStore && _localStore.addInvestigation) _localStore.addInvestigation(st.patient.mrn, { name: iv.name, note: iv.note }, { author: st.author || "" }); } catch (e) {}
      st.invDraft = {}; loadTimeline(); toast("Investigation added to the record."); paint(); return;
    }
    if (cmd === "clinic-rx-add") {
      var rx = st.medDraft || {}; if (!String(rx.drug || "").trim()) return;
      try { if (_localStore && _localStore.addPrescription) _localStore.addPrescription(st.patient.mrn, { drug: rx.drug, dose: rx.dose, freq: rx.frequency, duration: rx.duration, remarks: rx.remarks }, { author: st.author || "" }); } catch (e) {}
      st.medDraft = {}; loadTimeline(); toast("Medication added to the record."); paint(); return;
    }
    if (cmd === "assess-maik") return askMaik();
    if (cmd === "maik-ask") return maikAsk();
    if (cmd === "assess-maik-pro") return askMaikPro();
    if (cmd === "assess-clear") return clearAssessment();
    if (cmd === "storage-info") return;   // passive "Not saved" note (decision-support only) — no action
    if (cmd === "voice-toggle") { if (!st.voiceOn) startVoice(); return; }
    if (cmd === "voice-pause") return togglePauseVoice();
    if (cmd === "voice-stop") return stopVoice();
    if (cmd === "vlang") { st.voiceLang = arg; if (st.voiceOn) { stopVoice(); } else { paint(); } return; }
    if (cmd === "scribe-accept") { var p = String(arg).split(":"); return scribeAccept(p[0], +p[1]); }
    if (cmd === "scribe-acceptall") return scribeAcceptAll(arg);
    if (cmd === "fieldmic") return toggleFieldMic(arg);
    if (cmd === "icdsearch") return openIcdSearchForField(arg);
    if (cmd === "icdsuggest") return openIcdSuggestForField(arg);
    if (cmd === "icdaccept") return acceptIcdSuggestion(+arg);
    if (cmd === "consult-authorise") return authoriseConsult();
    if (cmd === "consult-er") return consultToER();
    if (cmd === "rx-share") return shareRx();
    if (cmd === "rx-refer") return shareReferral();
    if (cmd === "rx-summary") return shareSummary();
    if (cmd === "rx-followup") { if (G.SMD_FOLLOWCARE && G.SMD_FOLLOWCARE.openEnroll) G.SMD_FOLLOWCARE.openEnroll({ name: (st.patient && st.patient.name) || "", phone: st.phone || "", diagnosisText: (st.assessVals && st.assessVals.provisional_diagnosis) || "" }); return; }
    if (cmd === "onco-cell") return oncoCellClick(arg);
    if (cmd === "onco-drawer-close") { st.doseDrawer = null; paint(); return; }
    if (cmd === "proto-assign") return assignProtocol(arg);
    if (cmd === "onco-apply") return oncoApply(arg);
    if (cmd === "onco-tree-open") return openOncoTree();
    if (cmd === "onco-override") return oncoSaveOverride(arg);
    if (cmd === "onco-create") return oncoCreateAndActivate();
    if (cmd === "onco-add-emr") return oncoAddToEmr();
    if (cmd === "onco-view") { st.oncoView = arg; paint(); return; }
    if (cmd === "onco-start") return oncoStart(arg);
    if (cmd === "onco-complete") return oncoComplete(arg);
    if (cmd === "onco-cycle-create") return oncoCreateCycle(+arg);
    if (cmd === "onco-clr-toggle") { st.oncoClearanceDraft = st.oncoClearanceDraft || {}; st.oncoClearanceDraft.checks = st.oncoClearanceDraft.checks || {}; st.oncoClearanceDraft.checks[arg] = !st.oncoClearanceDraft.checks[arg]; paint(); return; }
    if (cmd === "onco-clr-resolve") return oncoResolveClearance(arg);
    if (cmd === "onco-cycle-confirm") return oncoConfirmCycleReady(arg);
    if (cmd === "onco-print") return oncoPrintProtocol();
    if (cmd === "ivx") { var xi = +arg, xn = (st.dictatedInv || [])[xi]; if (xn != null) { st.dictatedInv.splice(xi, 1); stripPlanLine(xn); paint(); } return; }
    if (cmd === "ivorder") { var on = (st.dictatedInv || [])[+arg]; if (on != null) { st.tab = "inv"; st.invQuery = on; paint(); runSearch("inv"); } return; }
    if (cmd === "notes-copy") return copyNotes();
    if (cmd === "notes-save") return saveNotesToHistory();
    if (cmd === "notes-clear") return clearNotes();
    if (cmd === "notes-view") { st.notesView = (arg === "qa") ? "qa" : "raw"; paint(); return; }
  }
  // Drop one dictated-investigation's line from the Management plan (paired with removing its chip).
  function stripPlanLine(name) {
    if (!(st.assessVals && st.assessVals.management_plan)) return;
    var kept = st.assessVals.management_plan.split("\n").filter(function (l) { return l.trim() !== ("Ix: " + name); });
    st.assessVals.management_plan = kept.join("\n"); putVoiceDom("management_plan");
  }
  // Clear the VoiceNote (transcript + English translation + voice-derived suggestions/investigations)
  // so the next dictation starts clean. Keeps EMR fields the doctor already accepted.
  function clearNotes() {
    if (!(st.voiceTranscript || st.voiceTranscriptEn || (st.dictatedInv || []).length)) { paint(); return; }
    if (!confirmed("Clear this VoiceNote (transcript + translation)? EMR fields you've already accepted are kept.")) return;
    st.voiceTranscript = ""; st.voiceTranscriptEn = ""; st.scribeSuggestions = null; st.scribeStats = null; st.dictatedInv = []; st._notesSavedText = "";
    try { _lastFullTranscript = ""; _priorTranscript = ""; _lastRefinedTranscript = ""; } catch (e) {}
    st.notesView = "raw";
    paint();
    try { toast("VoiceNote cleared"); } catch (e) {}
  }
  function copyNotes() {
    var t = st.voiceTranscript || ""; if (!t) { toast("Nothing to copy"); return; }
    // The native Android WebView denies the async Clipboard API ("Write permission denied"), so fall back
    // to the legacy textarea + execCommand path — it works here because copyNotes runs inside the Copy
    // tap (a user gesture), which is exactly what execCommand("copy") requires.
    function legacyCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = t; ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.top = "0"; ta.style.left = "0"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { ta.setSelectionRange(0, t.length); } catch (e) {}
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        toast(ok ? "Notes copied" : "Copy not available on this device");
      } catch (e) { toast("Copy not available on this device"); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { toast("Notes copied"); }, legacyCopy);
        return;
      }
    } catch (e) {}
    legacyCopy();
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

  function switchTab(t) { st.tab = t; paint(); if (t === "assess") { if (!st.assessLoaded) loadAssessment(); maybeLoadOncoProtocols(); } }

  // Tap a dose-matrix cell: build the drawer PURELY from the plan already in state - no fetch, no
  // write. drugId may itself contain ":" so re-join everything after the cycle number.
  function oncoCellClick(arg) {
    var parts = String(arg || "").split(":"), cycleNo = +parts[0], drugId = parts.slice(1).join(":");
    var plan = st.oncoPlan || {}, tmpl = plan.lockedTemplate || {};
    var drug = (tmpl.drugs || []).filter(function (d) { return d && d.id === drugId; })[0] || null;
    var doses = (plan.confirmedDoses && plan.confirmedDoses.length) ? plan.confirmedDoses : (plan.calculatedDoses || []);
    var lineage = doses.filter(function (d) { return d && d.drugId === drugId; })[0] || null;
    st.doseDrawer = { cycleNo: cycleNo, drugId: drugId, drug: drug, lineage: lineage };
    paint();
  }

  // ---- Phase 4: apply protocol, review + override, create & activate (suggest-and-confirm) --------
  // Resilient manifest+template fetch, ONCE per profile open: offer nothing on any failure (never a
  // half-loaded protocol list). Static repo JSON, same trust tier as kb/treatments - no auth header.
  function maybeLoadOncoProtocols() {
    if (!oncoFlagOn() || !st.writeOn || st.oncoProtocolsLoaded) return;
    st.oncoProtocolsLoaded = true;
    fetch("/kb/protocols/index.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (manifest) {
        var list = (manifest && (manifest.protocols || manifest)) || [];
        var active = list.filter(oncoUsable);
        return Promise.all(active.map(function (p) {
          return fetch("/kb/protocols/" + encodeURIComponent(p.id) + ".json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        }));
      })
      .then(function (templates) {
        st.oncoProtocols = (templates || []).filter(oncoUsable);   // re-filter defensively
        paint();
      })
      .catch(function () { st.oncoProtocols = []; paint(); });
  }
  // Open the OncoTree navigator WITH this patient's context; its "Continue in treatment workflow"
  // returns the chosen protocol here via the smd-oncotree-select CustomEvent (receiveOncoTreeProtocol).
  function openOncoTree() {
    if (!(G.SMD_ONCOTREE && G.SMD_ONCOTREE.open)) { toast("OncoTree is not available."); return; }
    var v = st.assessVals || {};
    G.SMD_ONCOTREE.open({
      fromEmr: true,
      patientId: (st.patient && st.patient.mrn) || null,
      name: (st.patient && st.patient.name) || null,
      heightCm: v.Height || null,
      weightKg: v.Weight || null,
      diagnosis: v.Diagnosis || ""
    });
  }
  // Receive a protocol chosen in OncoTree and stage its dose PREVIEW for the open patient. No activation:
  // oncoApply only computes + stages a draft; the create/confirm gate + server QUEUE_ONCO_WRITE still own
  // activation. Guarded so a stray event with no patient profile open (e.g. OncoTree from Home) is ignored.
  function receiveOncoTreeProtocol(detail) {
    if (!detail || !detail.protocolId) return;
    if (!oncoFlagOn() || !st.writeOn) return;                                // engine off / read-only session
    if (!st.patient || !(st.patient.mrn || st.patient.name)) return;         // no patient profile open
    // Patient-switch race guard (R1): if the event names a patient, it must be the one open now, so a
    // stale/duplicate event after a switch can never stage protocol-for-A onto patient B.
    if (detail.patient && detail.patient.patientId && st.patient.mrn && detail.patient.patientId !== st.patient.mrn) return;
    var id = detail.protocolId;
    var have = (st.oncoProtocols || []).some(function (p) { return p && p.id === id; });
    if (!have && detail.template && oncoUsable(detail.template)) st.oncoProtocols = (st.oncoProtocols || []).concat([detail.template]);
    st.tab = "assess";
    oncoApply(id);   // paints the review panel with computed doses (or no-ops if the protocol isn't usable)
  }
  // Apply an ACTIVE protocol: snapshot params from the EMR already in state (Height/Weight -> BSA;
  // age/creatinine not yet captured on this form - never-invent, the dose engine warns instead of
  // guessing), compute the lineage, and STAGE it. Purely local - no fetch, no write.
  function oncoApply(protocolId) {
    var proto = (st.oncoProtocols || []).filter(function (p) { return p && p.id === protocolId && oncoUsable(p); })[0];
    if (!proto) return;   // defensive - only active (or experimental-when-flagged) protocols are ever offered
    var v = st.assessVals || {};
    var height = parseFloat(v.Height), weight = parseFloat(v.Weight);
    var params = {
      height: (isFinite(height) && height > 0) ? height : null,
      weight: (isFinite(weight) && weight > 0) ? weight : null,
      age: null, sex: null, creatinine: null
    };
    if (G.SMD_ONCODOSE && params.height && params.weight) params.bsa = G.SMD_ONCODOSE.bsaMosteller(params.height, params.weight);
    var calculatedDoses = (G.SMD_ONCODOSE && G.SMD_ONCODOSE.planDoses) ? G.SMD_ONCODOSE.planDoses(proto, params) : [];
    st.oncoDraft = { protocolId: proto.id, template: proto, params: params, intent: (proto.intentOptions && proto.intentOptions[0]) || "", calculatedDoses: calculatedDoses, overrides: [] };
    st.oncoOverrideDraft = {};
    paint();
  }
  // Save a typed override for one drug line. Override-needs-reason is enforced by SMD_ONCOUI._stageOverride
  // (mirrors the server's _recordOverride) - a reasonless save is rejected and toasted, never staged.
  function oncoSaveOverride(drugId) {
    var draft = st.oncoDraft; if (!draft) return;
    var pending = (st.oncoOverrideDraft && st.oncoOverrideDraft[drugId]) || {};
    var existing = (draft.overrides || []).filter(function (o) { return o && o.drugId === drugId; })[0];
    var lin = (draft.calculatedDoses || []).filter(function (d) { return d && d.drugId === drugId; })[0] || {};
    var was = existing ? existing.was : lin.final;
    var nowVal = null;
    if (pending.val != null && pending.val !== "") { var n = Number(pending.val); if (isFinite(n)) nowVal = n; }
    var next = (G.SMD_ONCOUI && G.SMD_ONCOUI._stageOverride) ? G.SMD_ONCOUI._stageOverride(draft.overrides, { drugId: drugId, was: was, now: nowVal, reason: pending.reason }) : null;
    if (!next) { toast("A reason is required to override this dose."); return; }
    draft.overrides = next;
    paint();
  }
  // Firebase-authed POST to the onco routes (functions/api/queue/[[path]].js resolveActor) - NOT the
  // GHIS proxy postWrite() targets; the onco routes authenticate the doctor via their StewardMD
  // Firebase session (same token addToTimeline() already uses), never GHIS.
  function oncoPost(path, body, extraHeaders) {
    return fbTok().then(function (t) {
      var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t;
      if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { if (extraHeaders[k]) h[k] = extraHeaders[k]; });
      return fetch(qBase() + "/api/queue/onco" + path, { method: "POST", headers: h, credentials: "include", body: JSON.stringify(body) });
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; }, function () { return { status: r.status, ok: r.ok, d: {} }; }); });
  }
  // Firebase-authed GET to the onco routes (mirrors oncoPost's auth, no body). Read-side counterpart
  // that lets a NURSE session (no EMR_TREAT) actually fetch a cycle - the gap this phase closes.
  function oncoGet(path) {
    return fbTok().then(function (t) {
      var h = {}; if (t) h.Authorization = "Bearer " + t;
      return fetch(qBase() + "/api/queue/onco" + path, { method: "GET", headers: h, credentials: "include" });
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; }, function () { return { status: r.status, ok: r.ok, d: {} }; }); });
  }
  // Real nurse/doctor read (GAP-1 fix): fetch one cycle + its append-only admin records over
  // GET /onco/cycle. The test/Phase-5 injection seam (opts.oncoCycle in openProfile, below) stays
  // untouched for existing tests; this is the path a session with NO local memory of the cycle (a
  // fresh device/reload - the real-world nurse case) must use instead. adminRecords is folded onto
  // administrationSequence so onco-nurse.js's giveList/adminTable (unchanged, still pure) read ground
  // truth exactly like they already do for a locally-appended record.
  function loadOncoCycle(cycleId) {
    if (!cycleId) return;
    oncoGet("/cycle?cycleId=" + encodeURIComponent(cycleId)).then(function (res) {
      if (!res.ok || res.d.ok === false || !res.d.cycle) return;
      var cyc = res.d.cycle;
      cyc.administrationSequence = res.d.adminRecords || cyc.administrationSequence || [];
      st.oncoCycle = cyc;
      // Never clobber an already-loaded FULL plan (it carries lockedTemplate.drugs the give-list
      // needs) - only seed a minimal stand-in when nothing else populated st.oncoPlan at all.
      if (!st.oncoPlan && res.d.plan) {
        st.oncoPlan = { protocolId: res.d.plan.protocolId, ghisPatientId: res.d.plan.ghisPatientId, intent: res.d.plan.intent,
          confirmedDoses: cyc.confirmedDoses || [],
          // the fetched nurse-safe template carries drug names/routes/days + premeds so the give-list
          // renders on a fresh nurse device (it has NO dose formulas); fall back to the header only.
          lockedTemplate: res.d.plan.lockedTemplate || { name: res.d.plan.name, cycleLengthDays: res.d.plan.cycleLengthDays } };
      }
      paint();
    }).catch(function () {});
  }
  // The ONLY place that writes a treatment plan. One confirm() gate covers the whole create-then-
  // activate sequence; nothing is posted before the tap, and on tap exactly these two calls fire, in
  // order: create the plan (draft), then confirm it (draft -> active) with any staged overrides.
  function oncoCreateAndActivate() {
    var draft = st.oncoDraft; if (!draft) return;
    if ((draft.overrides || []).some(function (o) { return !o || !String(o.reason || "").trim(); })) return;   // defensive; button is already disabled here
    if (!confirmed("Create and activate this treatment plan for the patient?")) return;
    var body = { hospitalId: st.hospitalId || "", ghisPatientId: st.patient.mrn || "", protocolId: draft.protocolId, intent: draft.intent || "", patientParams: draft.params || {} };
    oncoPost("/plan", body).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.plan) { toast("Could not create the treatment plan. Please try again."); return; }
      var planId = res.d.plan.planId;
      // physicianConfirmed:true is the doctor's explicit CONFIRM & ACTIVATE (this tap already passed the
      // confirmed() gate above); the server pre-activation gate requires it, so activation is never automatic.
      return oncoPost("/plan/confirm", { planId: planId, overrides: draft.overrides || [], physicianConfirmed: true }).then(function (res2) {
        if (res2.d && typeof res2.d.error === "string" && res2.d.error.indexOf("activation_blocked") === 0) { toast("Cannot activate yet: complete doses, evidence, clearance info and resolve any VERIFY first."); return; }
        if (!res2.ok || res2.d.ok === false) { toast("Plan created but could not confirm. Please retry the confirm."); return; }
        st.oncoDraft = null; st.oncoOverrideDraft = {}; st.oncoPlan = res2.d.plan || res.d.plan;
        toast("Treatment plan created and activated.");
        paint();
      });
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }

  // ---- Phase G: [Add to EMR] - structured EMR write of the ACTIVATED plan --------------------------
  // EXPLICIT physician action, one confirm() gate then exactly one POST. Never automatic: it can only be
  // reached from the button, which only renders once plan.status === "active" (post CONFIRM & ACTIVATE).
  // Sends the GHIS session token in its own header (X-Ghis-Token) - the route needs GHIS auth to write.
  function oncoAddToEmr() {
    var plan = st.oncoPlan; if (!plan || plan.status !== "active") return;
    if (!confirmed("Add this activated treatment plan to the patient's EMR?")) return;
    var g = ghisAuth();
    oncoPost("/plan/emr", {
      planId: plan.planId,
      diagnosis: (st.assessVals && st.assessVals.provisional_diagnosis) || "",
      patientName: (st.patient && st.patient.name) || "",
    }, { "X-Ghis-Token": g.token }).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled" || res.d.error === "emr_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (res.status === 401 || res.d.error === "ghis_auth_required") { toast("Connect to the hospital EMR (Ward Sync) first."); return; }
      if (!res.ok || res.d.ok === false) { toast("Could not add to EMR. Please try again."); return; }
      var emr = res.d.emr || {};
      toast(emr.pdfAttached ? "Added to EMR (protocol sheet attached)." : (emr.pdf ? "Protocol sheet ready to attach to the EMR." : "Added to EMR."));
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }

  // ---- Phase 5: nurse execution - start a drug (record administration), complete the cycle ---------
  // Staged confirm: the actual-dose/reaction inputs are staged silently (setField, above) into
  // st.oncoAdminDraft keyed by the SAME "<cycleId>:<drugId>" string the [Start] button carries; the
  // tap itself is the ONE confirm() gate, then exactly one POST to /onco/admin fires. No dose is ever
  // computed here - `actual` is whatever the nurse typed (or null), never derived from the plan.
  function oncoStart(arg) {
    var i = String(arg || "").indexOf(":"), cycleId = i < 0 ? arg : arg.slice(0, i), drugId = i < 0 ? "" : arg.slice(i + 1);
    var cycle = st.oncoCycle; if (!cycle || cycle.cycleId !== cycleId) return;
    var draft = (st.oncoAdminDraft && st.oncoAdminDraft[arg]) || {};
    var actual = null;
    if (draft.dose != null && draft.dose !== "") { var n = Number(draft.dose); if (isFinite(n)) actual = n; }
    if (!confirmed("Record this dose as given?")) return;
    var now = Date.now();
    oncoPost("/admin", { cycleId: cycleId, planId: st.oncoPlan && st.oncoPlan.planId, drugId: drugId,
      actual: actual, administered: true, startTime: now, endTime: now, reaction: draft.reaction || "" })
      .then(function (res) {
        if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
        if (!res.ok || res.d.ok === false || !res.d.admin) { toast("Could not record the administration. Please try again."); return; }
        cycle.administrationSequence = (cycle.administrationSequence || []).concat([res.d.admin]);
        if (st.oncoAdminDraft) delete st.oncoAdminDraft[arg];
        toast("Administration recorded.");
        paint();
      }).catch(function () { toast("Could not complete the request. Please try again."); });
  }
  // [Complete cycle]: one confirm() gate, then exactly one POST to /onco/cycle/complete
  // (administering -> done, guarded server-side by _canTransition).
  function oncoComplete(cycleId) {
    var cycle = st.oncoCycle; if (!cycle || cycle.cycleId !== cycleId) return;
    if (!confirmed("Complete this chemotherapy cycle?")) return;
    oncoPost("/cycle/complete", { cycleId: cycleId }).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.cycle) { toast("Could not complete the cycle. Please try again."); return; }
      st.oncoCycle = res.d.cycle;
      toast("Cycle completed.");
      paint();
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }

  // ---- Phase 5 gap-fix: DOCTOR cycle management (create / pre-chemo clearance / confirm to ready).
  // Every write here is one confirm() gate then exactly one POST, mirroring oncoCreateAndActivate/
  // oncoStart/oncoComplete above. Doctor-only (server-gated CAPS.EMR_TREAT) - the nurse view never
  // renders this panel (oncoCyclePanelHtml is only called from the doctor branch of oncoTab).
  function oncoCreateCycle(cycleNo) {
    var plan = st.oncoPlan; if (!plan || !cycleNo) return;
    if (!confirmed("Create cycle " + cycleNo + " for this treatment plan?")) return;
    oncoPost("/cycle", { planId: plan.planId, cycleNo: cycleNo }).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.cycle) { toast("Could not create the cycle. Please try again."); return; }
      st.oncoCycle = res.d.cycle;
      st.oncoClearanceDraft = {};
      toast("Cycle " + cycleNo + " created.");
      paint();
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }
  // [Resolve clearance]: sends the doctor's per-check attestation (toggled "on" -> "ok", untouched ->
  // "not_reviewed") + the chosen overall status. `by` is deliberately NOT sent - the server always
  // derives it from the authenticated actor (functions/api/queue/[[path]].js), never a client value.
  function oncoResolveClearance(cycleId) {
    var cycle = st.oncoCycle; if (!cycle || cycle.cycleId !== cycleId) return;
    var draft = st.oncoClearanceDraft || {};
    var status = draft.status || "";
    if (!status) { toast("Select a clearance status first."); return; }
    var tmpl = (st.oncoPlan && st.oncoPlan.lockedTemplate) || {};
    var names = tmpl.clearanceChecks || [];
    var checks = names.map(function (name) { return { name: name, status: (draft.checks && draft.checks[name]) ? "ok" : "not_reviewed" }; });
    if (!confirmed('Resolve pre-chemo clearance as "' + status + '"?')) return;
    oncoPost("/cycle/clearance", { cycleId: cycleId, checks: checks, status: status }).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.cycle) { toast("Could not resolve clearance. Please try again."); return; }
      st.oncoCycle = res.d.cycle;
      toast("Clearance resolved: " + status + ".");
      paint();
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }
  // [Confirm cycle to ready]: belt-and-suspenders - the button itself is already disabled (see
  // onco-protocols.js _buildCyclePanel) unless cycle.clearance.status === "cleared"; this guard is a
  // second, independent check on the SAME state, never a way around the server's real gate
  // (confirmCycle throws clearance_not_resolved regardless of what the client sends).
  function oncoConfirmCycleReady(cycleId) {
    var cycle = st.oncoCycle; if (!cycle || cycle.cycleId !== cycleId) return;
    if (!cycle.clearance || cycle.clearance.status !== "cleared") return;
    if (!confirmed("Confirm this cycle as ready for administration?")) return;
    oncoPost("/cycle/confirm", { cycleId: cycleId }).then(function (res) {
      if (res.status === 501 || res.d.error === "onco_write_disabled") { toast("This is being set up and is not live yet."); return; }
      if (!res.ok || res.d.ok === false || !res.d.cycle) { toast("Could not confirm the cycle. Please try again."); return; }
      st.oncoCycle = res.d.cycle;
      toast("Cycle confirmed and ready for administration.");
      paint();
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }

  // ---- Phase 6: Protocol PDF (reuses the ThoreX print pipeline unchanged) --------------------------
  // Built PURELY from what is already in state (st.oncoPlan / st.oncoCycle - the exact same objects
  // the matrix and nurse view already read); no fetch, no write. onco-protocol-report.js reads every
  // dose off the plan/cycle itself (single source of truth, never recomputed here).
  function oncoPrintProtocol() {
    var plan = st.oncoPlan; if (!plan) return;
    var R = G.SMD_ONCOREPORT;
    if (!R || !R.buildProtocolSheet) { toast("Print is not available on this build."); return; }
    var html = R.buildProtocolSheet(plan, {
      cycle: st.oncoCycle,
      patientName: (st.patient && st.patient.name) || "",
      diagnosis: (st.assessVals && st.assessVals.provisional_diagnosis) || "",
    });
    oncoExportHtmlDoc(html, "StewardMD-" + (plan.protocolId || "protocol") + "-" + (plan.planId || ""));
  }
  // Fallback: share the HTML document as a file (older builds without the native PDF renderer).
  // Copied from thorex-screens.js's nativeShareHtml (same Filesystem/Share dance, oncology strings).
  function oncoShareHtml(html, filename) {
    try {
      var P = G.Capacitor && G.Capacitor.Plugins;
      if (P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share) {
        var name = filename + ".html";
        P.Filesystem.writeFile({ path: name, data: html, directory: "CACHE", encoding: "utf8" })
          .then(function () { return P.Filesystem.getUri({ path: name, directory: "CACHE" }); })
          .then(function (r) { return P.Share.share({ title: "StewardMD - Protocol sheet", files: [r.uri], dialogTitle: "Save as PDF / Print / Share" }); })
          .catch(function () { toast("Export unavailable on this device."); });
        return;
      }
    } catch (e) {}
    toast("Export not available on this device.");
  }
  // Write the finished HTML document out. Native -> render a REAL PDF (VisionOcr.htmlToPdf) and share
  // it; fall back to sharing the HTML file if the native renderer is not present. Web -> hidden-iframe
  // print (the browser print dialog offers "Save as PDF"). Copied verbatim (~15 lines) from
  // thorex-screens.js's exportHtmlDoc - the ~15-line dual-path pipeline the plan called for reusing.
  // The native path is device-only (per the iOS build gotcha); this file only wires it, never tests it.
  // ---- One-tap prescription sheet: build a branded Rx from the consult, share to WhatsApp / print / PDF.
  // Reuses oncoExportHtmlDoc (native real-PDF share sheet -> WhatsApp, else share-HTML, else web print). No
  // server, no PHI in logs: the doctor picks WhatsApp in the OS share sheet. ----
  function rxLinesFromPlan(v) {
    var plan = String((v && v.management_plan) || ""), rx = [], ix = [], adv = [];
    plan.split(/\n+/).forEach(function (l) {
      l = l.trim(); if (!l) return;
      if (/^Rx:\s*/i.test(l)) rx.push(l.replace(/^Rx:\s*/i, ""));
      else if (/^Ix:\s*/i.test(l)) ix.push(l.replace(/^Ix:\s*/i, ""));
      else adv.push(l);
    });
    return { rx: rx, ix: ix, adv: adv };
  }
  function rxSheetHtml(st) {
    var v = st.assessVals || {}, p = st.patient || {};
    var e2 = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); };
    var parts = rxLinesFromPlan(v);
    var meds = parts.rx.length ? parts.rx : (st.medications || []).map(function (m) { return (m.drugText || m.drug || "") + [m.dosage, m.frequency, m.duration].filter(Boolean).map(function (x) { return " " + x; }).join(""); }).filter(Boolean);
    var doctor = st.author || st.ghisDoctorName || "";
    var today = ""; try { today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch (e) {}
    var li = function (a) { return a.map(function (x) { return "<li>" + e2(x) + "</li>"; }).join(""); };
    var sec = function (t, arr) { return arr.length ? '<div class="rx-sec"><h3>' + t + "</h3><ul>" + li(arr) + "</ul></div>" : ""; };
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prescription</title><style>' +
      'body{font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#14202b;margin:0;padding:24px;max-width:720px}' +
      '.rx-hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0e6e63;padding-bottom:12px;margin-bottom:14px}' +
      '.rx-hd h1{font-size:20px;margin:0;color:#0e6e63}.rx-hd .rx-sym{font-size:34px;color:#0e6e63;font-weight:700;line-height:1}' +
      '.rx-pt{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:13px;color:#333;margin-bottom:14px}.rx-pt b{color:#14202b}' +
      '.rx-sec{margin:12px 0}.rx-sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5a7184;margin:0 0 6px;border-bottom:1px solid #e2e8ec;padding-bottom:3px}' +
      '.rx-sec ul{margin:0;padding-left:20px}.rx-sec li{margin:3px 0}.rx-dx{font-size:15px;font-weight:600;margin:8px 0 4px}' +
      '.rx-sign{margin-top:40px;text-align:right;font-size:13px;color:#333}.rx-sign .ln{border-top:1px solid #999;width:200px;margin-left:auto;padding-top:4px}' +
      '.rx-foot{margin-top:22px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8ec;padding-top:8px}' +
      '</style></head><body>' +
      '<div class="rx-hd"><div><h1>Prescription</h1>' + (doctor ? '<div style="font-size:13px;color:#5a7184">' + e2(doctor) + "</div>" : "") + '</div><div class="rx-sym">&#8478;</div></div>' +
      '<div class="rx-pt"><span><b>' + e2(p.name || "Patient") + "</b></span>" + (p.displayId || p.mrn ? "<span>ID: " + e2(p.displayId || p.mrn) + "</span>" : "") + (today ? "<span>Date: " + e2(today) + "</span>" : "") + "</div>" +
      (v.provisional_diagnosis ? '<div class="rx-dx">Dx: ' + e2(v.provisional_diagnosis) + "</div>" : "") +
      sec("Medications", meds) + sec("Investigations advised", parts.ix) + sec("Advice", parts.adv) +
      (v.refered_management_plan ? sec("Referral", [v.refered_management_plan]) : "") +
      '<div class="rx-sign"><div class="ln">Signature</div></div>' +
      '<div class="rx-foot">Generated with StewardMD &middot; Not valid without the prescriber\'s signature</div></body></html>';
  }
  function shareRx() {
    if (!st.assessVals) { toast("Open the assessment first."); return; }
    oncoExportHtmlDoc(rxSheetHtml(st), "Prescription-" + ((st.patient && st.patient.name) || "patient"), "Prescription");
  }
  // ---- Referral letter: refer this patient to another doctor / department / hospital, with the clinical
  // record attached, shared over WhatsApp / print. Reuses the same export pipeline as the Rx sheet. ----
  function referralSheetHtml(st, toWhom, reason) {
    var v = st.assessVals || {}, p = st.patient || {};
    var e2 = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); };
    var doctor = st.author || st.ghisDoctorName || "";
    var today = ""; try { today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch (e) {}
    var summary = "";
    try { summary = (typeof assessFindingsText === "function" ? assessFindingsText(v) : "") || ""; } catch (e) {}
    var row = function (t, val) { return val ? '<div class="rl-row"><span class="rl-k">' + t + "</span><div>" + e2(val).replace(/\n/g, "<br>") + "</div></div>" : ""; };
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Referral</title><style>' +
      'body{font:14px/1.55 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#14202b;margin:0;padding:24px;max-width:720px}' +
      '.rl-hd{border-bottom:3px solid #0e6e63;padding-bottom:12px;margin-bottom:14px}.rl-hd h1{font-size:20px;margin:0;color:#0e6e63}' +
      '.rl-row{display:flex;gap:12px;margin:8px 0}.rl-k{flex:0 0 130px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5a7184;padding-top:2px}' +
      '.rl-sign{margin-top:40px;text-align:right;font-size:13px}.rl-sign .ln{border-top:1px solid #999;width:220px;margin-left:auto;padding-top:4px}' +
      '.rl-foot{margin-top:22px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8ec;padding-top:8px}</style></head><body>' +
      '<div class="rl-hd"><h1>Referral letter</h1>' + (doctor ? '<div style="font-size:13px;color:#5a7184">From: ' + e2(doctor) + "</div>" : "") + (today ? '<div style="font-size:12px;color:#94a3b8">' + e2(today) + "</div>" : "") + "</div>" +
      row("Refer to", toWhom) +
      row("Patient", (p.name || "Patient") + (p.displayId || p.mrn ? "  (ID: " + (p.displayId || p.mrn) + ")" : "")) +
      row("Diagnosis", v.provisional_diagnosis) +
      row("Reason", reason) +
      row("Clinical summary", summary) +
      row("Management so far", v.management_plan) +
      '<div class="rl-sign"><div class="ln">Referring doctor</div></div>' +
      '<div class="rl-foot">Shared securely from StewardMD</div></body></html>';
  }
  function shareReferral() {
    if (!st.assessVals) { toast("Open the assessment first."); return; }
    var toWhom = "", reason = "";
    try { toWhom = window.prompt("Refer to (doctor / department / hospital):", (st.assessVals.refered_management_plan || "")) || ""; } catch (e) {}
    try { reason = window.prompt("Reason for referral (optional):") || ""; } catch (e) {}
    oncoExportHtmlDoc(referralSheetHtml(st, toWhom, reason), "Referral-" + ((st.patient && st.patient.name) || "patient"), "Referral letter");
  }
  // ---- Medico-legal visit / discharge summary: the full consult record as a signed, timestamped document
  // (electronically-generated attribution line = the medico-legal attestation). Shareable / printable. ----
  function visitSummaryHtml(st) {
    var v = st.assessVals || {}, p = st.patient || {};
    var e2 = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); };
    var doctor = st.author || st.ghisDoctorName || "";
    var when = ""; try { when = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) {}
    var parts = rxLinesFromPlan(v);
    var meds = parts.rx.length ? parts.rx : (st.medications || []).map(function (m) { return (m.drugText || m.drug || "") + [m.dosage, m.frequency, m.duration].filter(Boolean).map(function (x) { return " " + x; }).join(""); }).filter(Boolean);
    var row = function (t, val) { return val ? '<div class="vs-row"><span class="vs-k">' + t + "</span><div>" + e2(val).replace(/\n/g, "<br>") + "</div></div>" : ""; };
    var list = function (t, arr) { return arr && arr.length ? '<div class="vs-row"><span class="vs-k">' + t + '</span><ul style="margin:0;padding-left:18px">' + arr.map(function (x) { return "<li>" + e2(x) + "</li>"; }).join("") + "</ul></div>" : ""; };
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visit summary</title><style>' +
      'body{font:14px/1.55 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#14202b;margin:0;padding:24px;max-width:760px}' +
      '.vs-hd{border-bottom:3px solid #0e6e63;padding-bottom:12px;margin-bottom:14px}.vs-hd h1{font-size:20px;margin:0;color:#0e6e63}' +
      '.vs-row{display:flex;gap:12px;margin:9px 0;border-bottom:1px solid #eef2f4;padding-bottom:9px}.vs-row:last-of-type{border-bottom:none}' +
      '.vs-k{flex:0 0 140px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5a7184;padding-top:2px}' +
      '.vs-sign{margin-top:34px;text-align:right;font-size:13px}.vs-sign .ln{border-top:1px solid #999;width:220px;margin-left:auto;padding-top:4px}' +
      '.vs-foot{margin-top:20px;font-size:11px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8ec;padding-top:8px}</style></head><body>' +
      '<div class="vs-hd"><h1>Visit summary</h1>' + (when ? '<div style="font-size:12px;color:#94a3b8">' + e2(when) + "</div>" : "") + "</div>" +
      row("Patient", (p.name || "Patient") + (p.displayId || p.mrn ? "  (ID: " + (p.displayId || p.mrn) + ")" : "")) +
      row("Chief complaints", v.Chief_complaints_duration) +
      row("History", v.History_present_illness) +
      row("Diagnosis", v.provisional_diagnosis) +
      list("Investigations", parts.ix) +
      list("Medications", meds) +
      list("Advice", parts.adv) +
      row("Referral", v.refered_management_plan) +
      '<div class="vs-sign"><div class="ln">' + (doctor ? e2(doctor) : "Treating doctor") + "</div></div>" +
      '<div class="vs-foot">Electronically generated' + (doctor ? " by " + e2(doctor) : "") + (when ? " on " + e2(when) : "") + " via StewardMD &middot; a record of this consultation</div></body></html>";
  }
  function shareSummary() {
    if (!st.assessVals) { toast("Open the assessment first."); return; }
    oncoExportHtmlDoc(visitSummaryHtml(st), "VisitSummary-" + ((st.patient && st.patient.name) || "patient"), "Visit summary");
  }

  function oncoExportHtmlDoc(html, filename, title) {
    var name = (filename || "StewardMD-Protocol-sheet").replace(/[^\w.-]+/g, "-");
    if (G.SMD_IS_NATIVE) {
      var N = G.SMD_NATIVE;
      if (N && N.sharePdfFromHtml) {
        toast("Building PDF...");
        N.sharePdfFromHtml(html, name, title || "StewardMD - Protocol sheet").catch(function () { oncoShareHtml(html, name); });
        return;
      }
      oncoShareHtml(html, name);
      return;
    }
    try {
      var ifr = document.createElement("iframe");
      ifr.setAttribute("aria-hidden", "true");
      ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
      document.body.appendChild(ifr);
      var d = ifr.contentWindow.document; d.open(); d.write(html); d.close();
      setTimeout(function () {
        try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
        setTimeout(function () { try { ifr.remove(); } catch (e) {} }, 1500);
      }, 350);
      return;
    } catch (e) {}
    toast("Export not available on this device.");
  }

  // ---- report detail: tap a lab/radiology row -> fetch + show the actual result (GHIS lab-detail / radiology-report) ----
  function openReport(kind, arg) {
    var parts = String(arg || "").split(":");
    st.report = { open: true, kind: kind, loading: true, err: "", data: null, title: kind === "lab" ? "Lab report" : "Radiology report" };
    paint();
    var a = ghisAuth(), url = kind === "lab"
      ? "/lab-detail?renderId=" + encodeURIComponent(parts[0] || "") + "&episodeId=" + encodeURIComponent(parts[1] || "")
      : "/radiology-report?resultid=" + encodeURIComponent(parts[0] || "") + "&type=" + encodeURIComponent(parts[1] || "manual");
    // The order row this tap came from, so the mirror below (if this fetch succeeds) can send the
    // SAME metadata the console already scraped, rather than re-deriving it from the URL parts.
    var orderRow = kind === "lab"
      ? (st.labs || []).filter(function (l) { return String(l.renderId || "") === parts[0] && String(l.episodeId || "") === parts[1]; })[0]
      : (st.radiology || []).filter(function (o) { return String(o.resultid || "") === parts[0]; })[0];
    fetch(a.base + url, { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }, function () { return { ok: r.ok, d: {} }; }); })
      .then(function (res) {
        if (!st.report) return;
        if (!res.ok || res.d.error) { st.report.loading = false; st.report.err = res.d.error === "login_required" ? "Connect Ward Sync (GHIS) first." : "Could not load this report."; paint(); return; }
        st.report.loading = false; st.report.data = res.d; paint();
        // Mirror what GHIS just answered into the clinical record, best-effort, after the fact.
        // GHIS's read already happened and is unaffected by anything that follows; see
        // functions/_wardsynq/migrate-results.js for why this is a READ mirror, not a write.
        mirrorResult(kind === "lab" ? "lab" : "radiology", orderRow, res.d);
      })
      .catch(function () { if (st.report) { st.report.loading = false; st.report.err = "Could not load this report."; paint(); } });
  }
  // Fire-and-forget: post what GHIS just returned to the queue-session-authenticated mirror, so a
  // tenant with the "results" migration on can file it as a WardSynQ DiagnosticReport. Off (every
  // tenant today), the server does nothing with this and nothing here is visible to the doctor
  // either way — no toast, no error surfaced, because a missed mirror changes no clinical behaviour:
  // GHIS remains the source the doctor just read from.
  function mirrorResult(source, orderRow, detail) {
    if (!st.ticketId || !st.sessionId || !orderRow || !detail) return;
    fbTok().then(function (t) {
      if (!t) return;
      var body = { sessionId: st.sessionId, ticketId: st.ticketId, source: source, order: orderRow, detail: detail };
      fetch(qBase() + "/api/queue/result", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify(body) }).catch(function () {});
    }).catch(function () {});
  }
  // #156 — fetch every lab report for a repeated test name so labTrendPanel can trend its numeric analytes.
  // Reuses the /lab-detail endpoint per order. Patient-switch guarded. Flag-gated OFF (validate on device).
  function openLabTrend(name) {
    var group = (st.labs || []).filter(function (l) { return (l.serviceName || l.testName) === name; });
    st.report = null; st.trend = { open: true, name: name, loading: true, reports: [], err: "" }; paint();
    var a = ghisAuth(), forPatient = st;
    Promise.all(group.map(function (l) {
      return fetch(a.base + "/lab-detail?renderId=" + encodeURIComponent(l.renderId || "") + "&episodeId=" + encodeURIComponent(l.episodeId || ""), { headers: authHeaders(), credentials: "include" })
        .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }).catch(function () { return null; });
    })).then(function (reps) {
      if (st !== forPatient || !st.trend) return;
      st.trend.loading = false; st.trend.reports = (reps || []).filter(Boolean);
      if (!st.trend.reports.length) st.trend.err = "Could not load the trend reports.";
      paint();
    }, function () { if (st === forPatient && st.trend) { st.trend.loading = false; st.trend.err = "Could not load the trend."; paint(); } });
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
  // Sources backed by the on-device localStore contract ({getConsult,saveConsult}): "local" = personal
  // My Clinic (single device), "shared" = Shared Clinic (multi-device, encrypted Drive sync). Both skip
  // GHIS profile/labs/assessment fetch and read/write through _localStore. The sync (for "shared") lives
  // behind saveConsult in the injected store, so the EMR overlay stays storage-agnostic.
  function usesLocal(s) { return s === "local" || s === "shared"; }
  function loadProfile(opts) {
    // Personal/shared clinic: no hospital profile/labs to fetch. WardSynQ-native hospital: same - labs/
    // radiology/medications are not migrated in this task, and there is no GHIS to fetch them from; the
    // Profile tab must not show "Connect Ward Sync (GHIS) first" for a hospital that has no GHIS.
    if (usesLocal(st.source) || st.source === "wardsynq") { st.loading = false; paint(); return; }
    var a = ghisAuth();
    var q = "?patientId=" + encodeURIComponent(opts.patientId || "") + "&recordNo=" + encodeURIComponent(opts.recordNo || "");
    var forPatient = st;   // guard: if the doctor opens another patient before this resolves, don't write A's labs onto B's chart
    fetch(a.base + "/profile" + q, { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        if (st !== forPatient) return;
        var d = res.d;
        if (!res.ok || d.error === "login_required") { st.loading = false; st.error = "Connect Ward Sync (GHIS) first, then reopen the profile."; paint(); return; }
        st.loading = false; st.labs = d.labs || []; st.radiology = d.radiology || []; st.medications = d.medications || []; st.phone = d.phone || "";
        paint();
      })
      .catch(function () { if (st !== forPatient) return; st.loading = false; st.error = "Could not load the patient profile."; paint(); });
  }
  function loadAssessment() {
    // Personal/shared clinic: prefill from the on-device store (no GHIS fetch). WardSynQ-native
    // hospital: no on-device store either, and no GHIS draft to prefill from - a blank form for this
    // encounter (the doctor's saved note is still readable afterward, via the visit timeline below).
    if (usesLocal(st.source) || st.source === "wardsynq") {
      st.assessLoaded = true; st.assessLoading = false; st.assessErr = "";
      st.assessVals = (_localStore && _localStore.getConsult) ? (_localStore.getConsult(st.patient.mrn) || {}) : {};
      paint(); return;
    }
    st.assessLoading = true; st.assessErr = ""; paint();
    var a = ghisAuth();
    var forPatient = st;   // guard: another patient opened mid-flight must not receive this patient's assessment values
    fetch(a.base + "/assessment?patientId=" + encodeURIComponent(st.patient.mrn || "") + "&episodeId=" + encodeURIComponent(st.episodeId || ""), { headers: authHeaders(), credentials: "include" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (res) {
        if (st !== forPatient) return;
        st.assessLoading = false; st.assessLoaded = true;
        if (!res.ok || res.d.error === "login_required") st.assessErr = "Connect Ward Sync (GHIS) first, then reopen this tab.";
        else {
          st.assessVals = buildAssessVals(res.d.fields || []);
          // Keep the record id this form was loaded under. The save re-activates the visit server-side,
          // but if that activation does not stick (session moved on, another tab, a slow GHIS) the form
          // comes back blank with doc_id 0 and the server REFUSES rather than write an orphan — which is
          // the "GHIS: no_active_assessment" the doctor sees. Sending the id we just read gives the
          // server the fallback it already supports, so a good load makes the save survive that.
          st.assessDocId = oeFieldValue(res.d.fields, "Initial_Assessment_doc_id");
          // Authorised = signed off in GHIS = permanently locked there. Carried so the form can stop
          // offering Save on a record GHIS will no longer accept writes for.
          st.assessAuthorized = res.d.authorized || null;
        }
        paint();
      })
      .catch(function () { if (st !== forPatient) return; st.assessLoading = false; st.assessLoaded = true; st.assessErr = "Could not load the assessment form."; paint(); });
  }

  // Read one field out of the GHIS assessment form payload by its (prefix-stripped) name.
  function oeFieldValue(fields, name) {
    for (var i = 0; i < (fields || []).length; i++) {
      var f = fields[i];
      if (f && f.name === name) return f.value == null ? "" : String(f.value);
    }
    return "";
  }
  // The doc id to send with a save: "" when we never loaded a real one (0 / blank), so the server's
  // own guard still fires rather than us pushing a bogus id at it.
  function oeDocId() { var d = String(st.assessDocId || ""); return (d && d !== "0") ? d : ""; }
  // GHIS speaks in machine codes. A doctor mid-consult needs to know what to DO about it.
  function ghisSay(resp) {
    var r = String(resp || "");
    if (/no_saved_assessment/.test(r)) return "Save the assessment first, then authorise it.";
    if (/no_active_assessment/.test(r)) {
      // Keep the [tried ...] trace on screen. It names which activation attempts GHIS rejected, which
      // is the difference between diagnosing this in one report and guessing at it across three.
      var tried = (r.match(/\[tried [^\]]*\]/) || [""])[0];
      return "This visit is not open in " + emrLabel() + " right now. Reopen the patient from the queue, then save again - nothing you typed is lost. " + tried;
    }
    if (/patient_mismatch/.test(r)) return emrLabel() + " returned a different patient's form, so the save was stopped. Reopen this patient and try again.";
    return r ? ("GHIS: " + r.slice(0, 90)) : "Could not complete the request. Please try again.";
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
        if (!res.ok || d.ok === false) { toast(ghisSay(d.resp)); return; }
        toast(okMsg);
        if (tl && tl.text) { addToTimeline(tl.kind, tl.text, tl.vals, tl.signOff, tl.order, tl.rx); setTimeout(loadTimeline, 600); }   // mirror this action into the visit summary + refresh the Profile timeline
        st.invDraft = {}; st.medDraft = {};
        if (onOk) try { onOk(); } catch (e) {}
        loadProfile({ patientId: st.patient.mrn || "", recordNo: st.recordNo || "" });
      })
      .catch(function () { toast("Could not complete the request. Please try again."); });
  }
  // WardSynQ-native hospital (source "wardsynq"): the assessment write goes DIRECTLY to the WardSynQ
  // record over the SAME /api/queue/timeline endpoint addToTimeline() already posts to for the GHIS
  // shadow mirror - but here it IS the save, not a best-effort mirror: a refusal is reported to the
  // doctor, never swallowed, and success means the WardSynQ record accepted it - no GHIS involved at
  // all. Firebase-authed (qBase/fbTok, same as addToTimeline), never _localStore.
  function wardsynqSay(d) {
    var err = d && d.error;
    if (err === "wardsynq_tenant_not_configured") return "WardSynQ is not fully set up for this hospital yet. Contact support.";
    if (err === "record_refused") return "Could not save to the clinical record - " + ((d.wardsynq && d.wardsynq.error) || "try again") + ".";
    if (err === "not_found") return "This visit could not be found. Reopen the patient from the queue and try again.";
    return "Could not complete the request. Please try again.";
  }
  // General native-WardSynQ write: posts straight to the SAME /api/queue/timeline endpoint
  // addToTimeline() uses for the GHIS shadow mirror, Firebase-authed - but here it IS the save, not a
  // best-effort mirror. `extra` carries whatever structured payload this kind needs (vals/order/rx/
  // signOff); success/failure is the WardSynQ record's own, never a GHIS response.
  function postWardsynqTimeline(kind, text, extra, okMsg, onOk) {
    if (!st.ticketId || !st.sessionId) { toast("Open this patient from the queue to save."); return; }
    fbTok().then(function (t) {
      if (!t) { toast("Sign in to WardSynQ first."); return; }
      var body = Object.assign({ sessionId: st.sessionId, ticketId: st.ticketId, kind: kind, text: text }, extra || {});
      fetch(qBase() + "/api/queue/timeline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, ok: r.ok, d: d || {} }; }); })
        .then(function (res) {
          var d = res.d;
          if (!res.ok || d.ok === false) { toast(wardsynqSay(d)); return; }
          toast(okMsg);
          setTimeout(loadTimeline, 600);
          if (onOk) try { onOk(); } catch (e) {}
        })
        .catch(function () { toast("Could not complete the request. Please try again."); });
    }).catch(function () { toast("Could not complete the request. Please try again."); });
  }
  function postWardsynqAssessment(vals, okMsg, signOff, onOk) {
    var extra = {}; if (vals) extra.vals = vals; if (signOff) extra.signOff = true;
    postWardsynqTimeline("assessment", assessSummary(st.assessVals), extra, okMsg, onOk);
  }
  function confirmed(msg) { try { return !!(G.confirm && G.confirm(msg)); } catch (e) { return false; } }
  function submitInvOrder() {
    var d = st.invDraft || {}; if (!d.service) return;
    var order = { serviceId: d.service.id, name: d.service.name || "", diagnosis: d.diagnosis || "", emergency: !!d.emergency };
    var text = "Investigation ordered: " + d.service.name + (d.diagnosis ? " (for " + d.diagnosis + ")" : "") + (d.emergency ? " [emergency]" : "");
    // WardSynQ-native hospital: straight to the WardSynQ record, no GHIS. Investigation orders carry
    // no drug-dosing risk (unlike prescriptions), so unlike submitPrescribe this is safe to enable now.
    if (st.source === "wardsynq") {
      if (!confirmed('Order "' + d.service.name + '" for this patient?')) return;
      postWardsynqTimeline("note", text, { order: order }, "Investigation ordered.", function () { st.invDraft = {}; paint(); });
      return;
    }
    if (!confirmed('Order "' + d.service.name + '" for this patient in GHIS?')) return;
    // The timeline sentence is unchanged. `order` rides beside it so the server can file the SAME
    // order structurally in the clinical record (functions/_wardsynq/migrate-inv-order.js) instead of
    // re-parsing this sentence. Ignored entirely by clinics with the migration off, which is all of
    // them today. Note `emergency` and `diagnosis` are carried here even though GHIS itself drops
    // them - that is what makes the record keep what the doctor actually entered.
    postWrite("/inv-order", { serviceId: d.service.id, diagnosis: d.diagnosis || "", emergency: !!d.emergency }, "Investigation ordered.",
      { kind: "note", text: text, order: order });
  }
  function submitPrescribe() {
    var d = st.medDraft || {}; if (!d.drug) return;
    if (!confirmed('Prescribe "' + d.drug.name + '" for this patient in GHIS?')) return;
    // The timeline sentence is unchanged. `rx` rides beside it so the server can file the SAME
    // prescription structurally in the clinical record (functions/_wardsynq/migrate-prescription.js)
    // instead of re-parsing this sentence. `generic` is the composition GHIS's own drug search
    // returned; the safety engine indexes allergy classes and dose limits by generic, so it is
    // carried rather than dropped. NOTE this whole call is inert today: /prescribe answers 501
    // until QUEUE_EMR_PRESCRIBE_OK=1, and postWrite returns above without mirroring anything - so a
    // prescription GHIS refused never reaches the record. That is deliberate, not a gap.
    postWrite("/prescribe", { drugId: d.drug.id, route: d.route || "", form: d.form || "", qty: d.qty || "", frequency: d.frequency || "", duration: d.duration || "", remarks: d.remarks || "" }, "Prescription saved.",
      { kind: "medication", text: [d.drug.name, d.route, d.form, d.qty, d.frequency, d.duration].filter(Boolean).join(" ") + (d.remarks ? " - " + d.remarks : ""),
        rx: { drugId: d.drug.id, name: d.drug.name || "", generic: d.drug.sub || "", route: d.route || "", form: d.form || "", qty: d.qty || "", frequency: d.frequency || "", duration: d.duration || "", remarks: d.remarks || "" } });
  }
  function submitAssessment() {
    // An authorised record is locked in GHIS — a write would be rejected. Say so instead of failing.
    if (st.assessAuthorized) { toast("This assessment is authorised and locked in " + emrLabel() + ". It can no longer be edited."); return; }
    if (usesLocal(st.source)) {   // personal/shared clinic: save the consult on-device (Shared syncs via the store)
      if (!confirmed("Save this consult to " + emrLabel() + " on this phone?")) return;
      try { if (_localStore && _localStore.saveConsult) _localStore.saveConsult(st.patient.mrn, buildAssessPayload(st.assessVals || {}), st.assessVals || {}, { author: st.author || "" }); } catch (e) {}
      st.savedConsult = true; loadTimeline(); toast("Saved to " + emrLabel() + " on this device."); paint(); return;
    }
    if (!confirmed("Save this assessment to " + emrLabel() + "?")) return;
    // WardSynQ-native hospital: straight to the WardSynQ record. No GHIS call - a WardSynQ write is
    // the whole save, not a mirror of one, so its own success/failure is what the doctor sees.
    if (st.source === "wardsynq") {
      postWardsynqAssessment(buildAssessPayload(st.assessVals || {}), "Saved to " + emrLabel() + ".", false, function () { st.savedConsult = true; paint(); });
      return;
    }
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", docId: oeDocId(), fields: buildAssessPayload(st.assessVals || {}) }, "Saved to " + emrLabel() + ". It appears under the patient's Initial Assessment (not Clinical notes).",
      { kind: "assessment", text: assessSummary(st.assessVals), vals: buildAssessPayload(st.assessVals || {}) }, function () { st.savedConsult = true; paint(); });
  }
  // Clear every field and save the blank assessment to GHIS (deliberate wipe of the current Initial Assessment).
  function clearAssessment() {
    var q = st.noStore ? "Clear every field?" : ("Clear every field and save a blank assessment to " + emrLabel() + "? This wipes the current Initial Assessment.");
    if (!confirmed(q)) return;
    st.assessVals = {}; st.assessTouched = {};
    if (st.noStore) { paint(); return; }                                   // nothing is stored — just clear the form
    if (usesLocal(st.source)) {                                            // clear the on-device consult (Shared syncs the clear), no GHIS
      try { if (_localStore && _localStore.saveConsult) _localStore.saveConsult(st.patient.mrn, buildAssessPayload({}), {}); } catch (e) {}
      toast("Assessment cleared in " + emrLabel() + "."); paint(); return;
    }
    paint();
    if (st.source === "wardsynq") { postWardsynqAssessment(buildAssessPayload({}), "Assessment cleared in " + emrLabel() + ".", false); return; }
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", docId: oeDocId(), fields: buildAssessPayload({}) }, "Assessment cleared in " + emrLabel() + ".",
      { kind: "assessment", text: "Assessment cleared", vals: buildAssessPayload({}) });
  }

  // ---- voice fill (ambient dictation -> assessVals + live DOM, doctor edits protected) ----------
  var _amb = null, _elapsedTmr = null, _lastFullTranscript = "", _procTmr = null, _priorTranscript = "";
  // Clear the "Finishing your dictation…" state once the last chunk + refine have landed (or on a safety timeout).
  function finishProcessing() { if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; } _finishPending = false; if (!st.voiceProcessing) return; st.voiceProcessing = false; paint(); }
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
  // Opens the ICD Search overlay in picker mode; the chosen code+title is appended as a new line
  // to the named field (same DOM-patch path as voice dictation - putVoiceDom - so it doesn't lose
  // scroll position or trigger a full repaint()).
  function openIcdSearchForField(name) {
    if (!G.SMD_ICD || !G.SMD_ICD.pick) { toast("ICD search not available on this build."); return; }
    G.SMD_ICD.pick(function (row) {
      st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
      var cur = st.assessVals[name] || "";
      var line = esc2Line(row.code) + " - " + esc2Line(row.title);
      st.assessVals[name] = cur ? (cur + (/\n$/.test(cur) ? "" : "\n") + line) : line;
      st.assessTouched[name] = true;
      putVoiceDom(name);
    });
  }
  function esc2Line(s) { return String(s == null ? "" : s).replace(/[\r\n]+/g, " "); }
  // MaiK-assisted ICD suggestion: sends chief complaint + present history + whatever's already
  // typed in provisional diagnosis (no name/MR number - explicit consent tap first, same posture
  // as askMaikPro above) to /api/ai/extract kind:"icd-suggest". The server grounds the model
  // against real icd_codes rows and re-validates every id before it comes back - this client
  // never trusts a code string directly from the model. Advisory only: each row needs its own
  // Accept tap; nothing is written to the field until then.
  var _oeIcdSug = [], _oeIcdSeq = 0, _oeIcdField = "provisional_diagnosis";
  function openIcdSuggestForField(name) {
    if (!(G.SMD_AI && G.SMD_AI.extract)) { toast("MaiK is not available on this build."); return; }
    _oeIcdField = name || "provisional_diagnosis";
    var v = st.assessVals || {};
    var text = [v.provisional_diagnosis, v.Chief_complaints_duration, v.History_present_illness].filter(Boolean).join(". ").trim();
    if (!text) { toast("Type the complaint, history or diagnosis first."); return; }
    if (!confirmed("Send this text (no name or MR number) to MaiK for ICD-10/11 code suggestions?")) return;
    var panel = document.querySelector("#smdOpdEmr #oeIcdSug"); if (!panel) return;
    panel.innerHTML = '<div class="oe-icdsug-hint">Asking MaiK…</div>';
    var mySeq = ++_oeIcdSeq;
    G.SMD_AI.extract(text, "icd-suggest").then(function (r) {
      if (mySeq !== _oeIcdSeq) return;
      var p = document.querySelector("#smdOpdEmr #oeIcdSug"); if (!p) return;
      if (!r || r.error) { p.innerHTML = '<div class="oe-icdsug-hint">' + esc(r && r.error === "quota" ? (r.message || "MaiK is a StewardMD Pro feature.") : "Could not reach MaiK. Try again.") + '</div>'; return; }
      _oeIcdSug = r.suggestions || [];
      if (!_oeIcdSug.length) { p.innerHTML = '<div class="oe-icdsug-hint">No confident ICD match found - try the search icon instead.</div>'; return; }
      p.innerHTML = _oeIcdSug.map(function (s, i) {
        return '<div class="oe-icdsug-row"><span class="oe-icdsug-code">' + esc(s.code) + '</span><span class="oe-icdsug-sys">' + esc(s.system) + '</span>' +
          '<span class="oe-icdsug-title">' + esc(s.title) + '</span>' +
          '<button type="button" class="oe-icdsug-accept" data-oe-act="icdaccept:' + i + '">Accept</button></div>';
      }).join("");
    });
  }
  function acceptIcdSuggestion(i) {
    var s = _oeIcdSug[i]; if (!s) return;
    var name = _oeIcdField;
    st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {};
    var cur = st.assessVals[name] || "";
    var line = esc2Line(s.code) + " - " + esc2Line(s.title);
    st.assessVals[name] = cur ? (cur + (/\n$/.test(cur) ? "" : "\n") + line) : line;
    st.assessTouched[name] = true;
    putVoiceDom(name);
    var p = document.querySelector("#smdOpdEmr #oeIcdSug"); if (p) p.innerHTML = "";
    toast("ICD code added: " + s.code);
  }
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
    return { rx: rx, steps: (rec.steps || []).slice(0, 4), regimen: rec.regimenLabel || "", source: tj.source || "", tier: rec.tier || "" };
  }
  // Explainable MaiK: a short, copyright-safe citation label for an OPD suggestion (Harrison genericized
  // per the app-wide policy; named guidelines/societies kept verbatim).
  function citeShort(src) {
    src = String(src || "").trim(); if (!src) return "";
    return src.replace(/Harrison[^·|,;]*/i, "Standard medicine reference").trim();
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
    // Never-guess signal (scale-independent): no score, or the top two are nearly tied => genuinely uncertain.
    var t0 = top[0] || {}, t1 = top[1] || {};
    var lowConfidence = !(t0.score > 0) || (t1.score != null && t0.score > 0 && (t1.score / t0.score) > 0.85);
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
      var cite = citeShort(t.source);   // Explainable MaiK: the guideline/textbook this regimen came from
      (t.rx || []).concat(t.steps || []).forEach(function (line) {
        var k = String(line).toLowerCase();
        if (line && !rxSeen[k]) { rxSeen[k] = 1; treatment.push({ label: cleanClinical(line), source: "engine", cite: cite, dx: r.dx }); }
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
    return { provisionalDx: provisionalDx, provisionalWhy: provisionalWhy, ddx: ddx, investigations: investigations, treatment: treatment, redFlags: redFlags, lowConfidence: lowConfidence };
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
  // ---- MaiK Ask (AI-guided history) -----------------------------------------------------------------
  // Hand the current complaint + known assessment to SMD_MAIKASK; fold the patient-reported findings back
  // into the SAME assessVals (doctor-override guard preserved) tagged source:"patient_spoken_via_MaiK".
  function maikAsk() {
    if (!(G.SMD_MAIKASK && G.SMD_MAIKASK.start)) { toast("MaiK Ask is not available on this build."); return; }
    var v = st.assessVals || {};
    var complaint = v.Chief_complaints_duration || v.History_present_illness || _lastFullTranscript || "";
    // Demo/test mode (localStorage smd_maik_ask_demo=1): scripted patient answers, no ASR/TTS, and the
    // findings are NOT written to the real record — for trying the flow without a patient.
    var demo = false; try { demo = localStorage.getItem("smd_maik_ask_demo") === "1"; } catch (e) {}
    G.SMD_MAIKASK.start({
      complaint: complaint || (demo ? "headache" : ""), known: v, demo: demo,
      demoAnswers: demo ? ["no", "no", "no", "gradually", "right side", "throbbing type", "very severe", "nausea undi"] : null,
      onFindings: demo ? function () {} : maikApplyFindings,     // demo never touches the EMR
      onConfirm: demo ? function () {} : maikConfirm,            // fast path: doctor-confirmed write
      onReview: function () { switchTab("assess"); }
    });
  }
  // The doctor reviewed (and possibly edited) the interview transcript and tapped Save. This is the
  // ONLY route that writes MaiK Ask output anywhere: the ticked findings go through the same guarded
  // apply as before, the A-to-Z transcript is kept as the patient-reported history it actually is, and
  // the whole thing is mirrored into the visit timeline so the summary covers the entire consult.
  function maikConfirm(r) {
    r = r || {};
    maikApplyFindings(r.findings || []);
    var tx = String(r.transcript || "").trim();
    if (!tx) return;
    st.assessVals = st.assessVals || {};
    var key = "History_present_illness";
    var block = "MaiK Ask (patient-reported history):\n" + tx;
    var cur = st.assessVals[key] || "";
    if (cur.indexOf(tx) === -1) {
      st.assessVals[key] = cur ? (cur.replace(/\s+$/, "") + "\n\n" + block) : block;
      try { putVoiceDom(key); } catch (e) {}
    }
    // Timeline is a real write, so it respects the same write gate as the assessment save.
    if (writeFlagOn()) { try { addToTimeline("maik-ask", block); } catch (e) {} }
    paint();
    toast("MaiK Ask history added. Review it, then Save the assessment.");
  }
  function maikApplyFindings(findings) {
    st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {}; st.maikSources = st.maikSources || {};
    var applied = 0;
    (findings || []).forEach(function (f) {
      var key = f.emr; if (!key) return;
      var isFree = /History_present_illness|management_plan|_others|note/i.test(key);
      if (isFree) {
        var cur = st.assessVals[key] || "";
        var label = String(f.target || f.field).replace(/_/g, " ");
        var line = label.charAt(0).toUpperCase() + label.slice(1) + ": " + f.value;
        if (cur.indexOf(f.value) === -1) { st.assessVals[key] = cur ? (cur.replace(/\s+$/, "") + "\n" + line) : line; applied++; }
      } else if (!st.assessTouched[key]) {                 // dedicated field: never overwrite a doctor edit
        st.assessVals[key] = f.value; applied++;
      }
      st.maikSources[key] = "patient_spoken_via_MaiK";      // provenance; NOT marked doctor_confirmed
      try { putVoiceDom(key); } catch (e) {}
    });
    if (applied) toast(applied + " field" + (applied === 1 ? "" : "s") + " added from MaiK Ask");
    paint();
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
        investigations: sg.investigations, treatment: sg.treatment, redFlags: sg.redFlags, corrections: emrCorrections(v), lowConfidence: sg.lowConfidence,
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
  // True between a doctor-initiated Pause/Stop and the moment the note is drafted. Every failure path
  // in doRefine is SILENT by design during background ticks (a mid-consult hiccup must not nag), but
  // when the doctor has explicitly finished, silence is indistinguishable from "MaiK Scribe is broken":
  // the finishing animation ends and nothing appears. While this is set, failures say what happened.
  var _finishPending = false;
  function refineFail(msg) { if (_finishPending) { try { toast(msg); } catch (e) {} } finishProcessing(); }
  function doRefine(transcript) {
    if (!transcript) { refineFail("Nothing was transcribed - check the microphone and try again."); return; }
    if (!(G.SMD_AI && G.SMD_AI.extract)) { refineFail("Note drafting is unavailable on this build."); return; }
    if (_lastRefinedTranscript.indexOf(transcript) === 0) { finishProcessing(); return; }   // no new content since the last refine — genuinely nothing to say
    _lastRefinedTranscript = transcript;
    G.SMD_AI.extract(transcript, "opd-scribe").then(function (r) {
      if (r && r.error === "quota") { toast(r.message || "MaiK Scribe limit reached. Try again later."); try { stopVoice(); } catch (e) {} return; }
      if (!r || r.error) { if (_finishPending) { try { toast("Could not draft the note from this dictation - the transcript is kept, try Stop again."); } catch (e) {} } return; }
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
    }).catch(function () {
      // Was silently swallowed: a dropped connection mid-consult looked exactly like a working Stop
      // that produced nothing. The transcript is never lost, so say so and let the doctor retry.
      if (_finishPending) { try { toast("Could not reach MaiK to draft the note - check your connection, your transcript is safe."); } catch (e) {} }
    }).then(finishProcessing);   // clear the "Finishing…" state whether it succeeded or not
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
      chunkMs: 15000, refineEveryChunks: 8,                  // refine every 2 min (cost): the full authoritative extraction still runs on Stop, so the final EMR is identical — this only trims mid-dictation live-preview calls
      getState: function () { return {}; },                 // manual-override is enforced in _voiceMerge via assessTouched
      llmExtract: assessLLM,                                 // narrative only; deterministic vitals/exam run every tick
      onUpdate: applyVoice,
      onTranscript: function (t) { _lastFullTranscript = _priorTranscript + (t || ""); setTranscript(_lastFullTranscript); },
      onModel: function (code) { setModelChip(code); },     // "which model" chip (Auto adapts per chunk)
      onRefine: doRefine,                                    // rolling capture (Task 5) is wired: fires every refineEveryChunks windows + once more on Stop (the flushed final chunk); stopVoice() only makes its own call as a fallback when there's no in-flight chunk to flush
      onState: function (s) { if (s === "fallback") st.voiceFallback = true; setVoiceStatus(s === "listening" ? (st.voiceFallback ? "MaiK Scribe is listening (device dictation)" : "MaiK Scribe is listening") : s === "fallback" ? "Whisper model not installed - using device dictation" : s === "preparing" ? "Preparing model…" : s === "downloading" ? "Downloading model…" : ""); },
      onError: function (err) { setVoiceStatus(err === "clinical-unavailable" ? "On-device voice unavailable on this build." : "Voice error - tap to retry."); st.voiceOn = false; _amb = null; if (_elapsedTmr) { clearInterval(_elapsedTmr); _elapsedTmr = null; } paint(); }
    });
  }
  function togglePauseVoice() {
    if (!_amb) return;
    if (st.voicePaused) {                                   // Resume — back to listening, transcript keeps appending
      try { _amb.resume(); } catch (x) {}
      st.voicePaused = false; paint(); return;
    }
    // Pause = flush + process the audio so far: show "Finishing your dictation", refine the captured
    // transcript, then land on the paused state with the fresh transcript. Mirrors Stop but keeps the
    // session alive (resumable). The engine gates its own onRefine on !paused, so we refine here.
    // Same contract as stop(): true means the flushed window will deliver the COMPLETE transcript via
    // onRefine, so refining here too would draft the note from the stale pre-flush text (or from
    // nothing at all, which is what "Pause shows nothing scribed" was).
    var pauseFlushing = false;
    try { pauseFlushing = !!_amb.pause(); } catch (x) {}
    st.voicePaused = true;
    st.voiceProcessing = true;                              // render checks processing first -> the finishing animation
    _finishPending = true;                                  // doctor-initiated finish: failures must speak up
    if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; }
    _procTmr = setTimeout(finishProcessing, 15000);         // safety: never hang the panel
    paint();
    if (!pauseFlushing) doRefine(st.voiceTranscript || _lastFullTranscript || "");   // updates the transcript; doRefine's .then(finishProcessing) clears the state
  }
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
    _finishPending = willProcess;                           // covers BOTH paths: our own doRefine below
                                                            // and the flush's onRefine, which lands later.
    if (_procTmr) { clearTimeout(_procTmr); _procTmr = null; }
    if (willProcess) _procTmr = setTimeout(finishProcessing, 15000);   // safety: never hang the panel
    if (!flushing) doRefine(_lastFullTranscript);           // fallback end-of-consult refine over the whole transcript
    paint();
    // Stopped with no audio transcribed at all: previously the panel just returned to idle, which is
    // exactly the "I pressed Stop and nothing showed up" report. Say it plainly.
    if (!willProcess) { try { toast("Nothing was captured - check the microphone and try again."); } catch (e) {} finishProcessing(); }
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
      // Fold every accepted investigation into the Management plan (accumulates across taps + "Accept all",
      // persists on Save). Scribe/Pro labels are free-text with no GHIS service id, so we must NOT stage them
      // as a single-slot invDraft order (that overwrote earlier accepts + posted serviceId:null -> order failed).
      appendPlan("management_plan", "Ix: " + inv.label);
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
    if (!opts.noStore && (opts.source || "ghis") === "ghis" && G.GHIS && G.GHIS.ensureSession && !opts._sessionOk) {
      G.GHIS.ensureSession().then(function (ok) { if (ok) { opts._sessionOk = true; openProfile(opts); } });
      return;
    }
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    st = freshState();
    st.patient = { name: opts.name || "", mrn: opts.patientId || "", displayId: opts.displayId || "" };   // displayId = human hospital id (SMD-XXX-nnn) for no-MRN clinic patients; mrn stays the storage key
    st.recordNo = opts.recordNo || "";
    st.episodeId = opts.episodeId || "";                      // GHIS visit/episode id — an Initial Assessment attaches to a visit
    st.visitId = opts.visitId || opts.episodeId || "";        // GHIS OPMR visit number — the Getopcard id for the history timeline
    st.ticketId = opts.ticketId || ""; st.sessionId = opts.sessionId || "";   // queue context -> mirror actions into the visit summary
    st.source = opts.source || "ghis";                       // "ghis" (hospital) | "local" (personal clinic) | "shared" (shared clinic), on-device | "wardsynq" (WardSynQ-native hospital)
    st.noStore = !!opts.noStore && !usesLocal(st.source);    // no hospital MRN + no local store: Ask MaiK decision-support only, nothing is saved
    _localStore = usesLocal(st.source) ? (opts.localStore || null) : null;   // "wardsynq" never gets a localStore - it writes to the WardSynQ record, not this device
    st.author = opts.author || "";                                          // who is documenting this consult (for the timeline footprint)
    if (_localStore && _localStore.startConsult) { try { _localStore.startConsult(st.patient.mrn); } catch (e) {} }   // each open = a new dated entry
    st.emrLabel = opts.emrLabel || (st.source === "shared" ? "Shared Clinic" : (st.source === "local" ? "My Clinic" : (st.source === "wardsynq" ? "WardSynQ" : (opts.source && opts.source !== "ghis" ? "EMR" : "GHIS"))));
    // local/shared save is always allowed (on-device, no server gate); "wardsynq" likewise - its Save
    // button must not depend on smd_opd_emr_write/QUEUE_EMR_WRITE, which gate GHIS write-back only and
    // are meaningless for a hospital with no GHIS relationship at all.
    st.writeOn = (usesLocal(st.source) || st.source === "wardsynq" || st.noStore) ? true : writeFlagOn();
    st.hospitalId = opts.hospitalId || opts.orgId || "";
    if (opts.oncoPlan) st.oncoPlan = opts.oncoPlan;            // test/Phase-4 seam: inject a treatment plan already in state
    if (opts.oncoCycle) st.oncoCycle = opts.oncoCycle;         // test/Phase-5 seam: inject a cycle already in state (nurse view)
    if (opts.oncoView) st.oncoView = opts.oncoView;            // test/Phase-5 seam: open directly on the nurse view
    if (opts.tab) st.tab = opts.tab;                          // open directly on a tab (e.g. "assess")
    if (st.noStore) { st.loading = false; st.tab = "assess"; st.assessLoaded = true; st.assessVals = {}; paint(); return; }   // blank form for Ask MaiK; skip GHIS/local load
    paint();
    loadProfile(opts);
    loadTimeline();                                           // visit timeline (queue-ticket encounters only)
    if (opts.tab === "assess") { loadAssessment(); maybeLoadOncoProtocols(); }   // Initial Assessment (+ offer active oncology protocols)
    // Real nurse/doctor session (GAP-1 fix): no injected oncoCycle object - fetch it for real over
    // GET /onco/cycle instead of leaving the Oncology tab permanently empty for anyone but a test.
    if (!opts.oncoCycle && opts.oncoCycleId) loadOncoCycle(opts.oncoCycleId);
  }
  var _localStore = null;   // personal-clinic backend (getConsult/saveConsult), set when source === "local"
  // ---- per-field dictation (fill ONLY the tapped column) ---------------------------------------
  var _fieldSession = null;
  function fmicNode(name) { var l = document.querySelectorAll("#smdOpdEmr .oe-fmic"); for (var i = 0; i < l.length; i++) { if (l[i].getAttribute("data-oe-act") === "fieldmic:" + name) return l[i]; } return null; }
  function setFmicUI(name, on) { var b = fmicNode(name); if (b) { b.classList.toggle("on", !!on); b.innerHTML = ms(on ? "stop" : "mic"); } }
  /* Dictation feedback. A red button was the ONLY sign anything was happening, and on iOS the Whisper
   * plugin is record-then-transcribe — there are no partials — so between tapping the mic and the text
   * landing the app looked frozen with nothing to confirm it had heard a word. This is a persistent
   * strip: what is happening, for how long, and how to stop. Fixed, so it stays visible wherever the
   * form is scrolled. */
  var _fmicTmr = null, _fmicT0 = 0;
  // Same plain sentences the Rx pad uses — a doctor cannot act on "mic-denied".
  var RX_VOICE_ERR_OE = {
    "mic-denied": "Microphone is blocked - allow mic access for StewardMD, then try again.",
    "no-voice-engine": "This device has no dictation engine available.",
    "stt-unavailable": "On-device dictation is not available on this build.",
    "clinical-unavailable": "Clinical dictation is not ready on this device.",
    "transcription-failed": "Could not transcribe that - try again.",
    "speech-error": "Dictation stopped - try again.",
  };
  // Human label for the field being dictated ("BP systolic"), so the strip says what it is filling.
  function fieldLabel(name) {
    try {
      var el = document.getElementById("oefld-" + name) || document.querySelector('#smdOpdEmr [data-k="' + name + '"]');
      var lab = el && el.closest ? el.closest(".oe-fld") : null;
      var l = lab && lab.querySelector ? lab.querySelector("label") : null;
      if (l && l.textContent) return l.textContent.replace(/\s*\*\s*$/, "").trim();
    } catch (e) {}
    return String(name || "this field").replace(/_/g, " ");
  }
  function fmicBar() {
    var el = document.getElementById("oeFmicBar");
    if (!el) {
      var host = document.getElementById("smdOpdEmr"); if (!host) return null;
      el = document.createElement("div"); el.id = "oeFmicBar"; el.className = "oe-fmicbar";
      el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
      host.appendChild(el);
    }
    return el;
  }
  function fmicSay(txt, kind) {
    var el = fmicBar(); if (!el) return;
    if (!txt) { el.classList.remove("on"); el.textContent = ""; return; }
    el.className = "oe-fmicbar on" + (kind ? " " + kind : "");
    el.textContent = txt;
  }
  function fmicElapsed() {
    if (!_fmicT0) return "";
    var s = Math.max(0, Math.round((now() - _fmicT0) / 1000));
    return " " + Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function fmicListening(label) {
    _fmicT0 = now();
    if (_fmicTmr) clearInterval(_fmicTmr);
    var tick = function () { fmicSay("Listening" + fmicElapsed() + " - " + label + ". Tap the mic again to stop.", "live"); };
    tick(); _fmicTmr = setInterval(tick, 1000);
  }
  function fmicDone(txt, kind) {
    if (_fmicTmr) { clearInterval(_fmicTmr); _fmicTmr = null; }
    _fmicT0 = 0;
    if (!txt) { fmicSay(""); return; }
    fmicSay(txt, kind);
    setTimeout(function () { var el = document.getElementById("oeFmicBar"); if (el && el.textContent === txt) fmicSay(""); }, 3200);
  }
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
    if (st.voiceOn || st.voiceProcessing) { toast("Stop MaiK Scribe first to dictate a single field."); return; }
    // Tapping the live mic = "I've finished speaking". On a record-then-transcribe engine the words
    // arrive AFTER this, so say "Transcribing…" rather than going blank and looking broken.
    if (st.fieldMic === name) { fmicDone("Transcribing what you said…", "busy"); stopFieldMic(); return; }
    stopFieldMic();                                        // only one field mic at a time
    if (!G.SMD_VOICE || !G.SMD_VOICE.listen) { toast("On-device voice not available on this build."); return; }
    st.fieldMic = name; setFmicUI(name, true);
    fmicListening(fieldLabel(name));
    var heard = false;
    function put(transcript, done) {
      var v = coerceFieldValue(name, transcript);
      if (v != null) { heard = true; st.assessVals = st.assessVals || {}; st.assessTouched = st.assessTouched || {}; st.assessVals[name] = v; st.assessTouched[name] = true; putVoiceDom(name); }
      if (done) { fmicDone(v != null ? ("Filled " + fieldLabel(name) + ": " + String(v).slice(0, 40)) : "Nothing was heard - try again, closer to the mic.", v != null ? "ok" : "warn"); stopFieldMic(); }
    }
    _fieldSession = G.SMD_VOICE.listen({
      language: (st.voiceLang && st.voiceLang !== "auto") ? st.voiceLang : undefined,
      noCloud: true,
      // Partials only exist on streaming engines. When they do, echo them so the doctor can see it is
      // hearing them; when they don't (on-device Whisper), the timer above is the only honest signal.
      onPartial: function (t) { put(t, false); if (t) fmicSay("Heard: " + String(t).slice(0, 60), "live"); },
      onFinal: function (t) {
        var s = String(t || "");
        // GHIS + MaiK must be English — if the dictation is Telugu/Hindi, translate the final before filling.
        if (/[ऀ-ॿఀ-౿]/.test(s) && G.SMD_AI && G.SMD_AI.translate) {
          setVoiceStatus("Translating…");
          G.SMD_AI.translate(s).then(function (r) { put((r && r.text && !r.error) ? r.text : s, true); setVoiceStatus(""); })
            .catch(function () { put(s, true); setVoiceStatus(""); });
        } else { put(s, true); }
      },
      onError: function (code) { fmicDone(RX_VOICE_ERR_OE[code] || "Dictation stopped - try again.", "warn"); setVoiceStatus(""); stopFieldMic(); },
      onState: function (s) { if (s === "transcribing") fmicSay("Transcribing what you said…", "busy"); }
    });
    if (!_fieldSession) { st.fieldMic = null; setFmicUI(name, false); fmicDone("On-device voice could not start. Type the value instead.", "warn"); }   // listen returned null (engine present but couldn't start) - tell the doctor instead of silently flicking the mic off
  }

  // ---- finish the consult (shown after a GHIS save) --------------------------------------------
  // The queue (queue.js) owns the session, so we bridge with a DOM event it listens for.
  /* Authorise = the doctor signing the note off. It is deliberately explicit (a confirm), because it
   * ends the consult and advances the OPD queue to the next patient — the same thing the swipe did,
   * but discoverable, and named for what the doctor is actually doing.
   *
   * Scope, stated plainly: this signs off in StewardMD's queue. GHIS exposes no authorise/finalise
   * action on the Initial Assessment that I could find — the live form has no such field and the OPD
   * list carries no such row action — so this does NOT set an authorisation flag inside GHIS. The note
   * itself is already saved there. If GHIS does have one, point me at where you authorise today and
   * this button can call it too. */
  function authoriseConsult() {
    if (st.assessAuthorized) { toast("This assessment is already authorised."); return; }
    // WardSynQ-native hospital: there is no GHIS doc id (oeDocId()) to gate on - the WardSynQ save
    // itself (st.savedConsult) is what "there is something to sign" means here.
    if (st.source === "wardsynq") {
      if (!st.savedConsult) { toast("Save the assessment first, then authorise it."); return; }
      if (!confirmed("Authorise this assessment?\n\nIt is signed off in " + emrLabel() + ". The record is then LOCKED - you cannot edit or save it again.")) return;
      postWardsynqAssessment(null, "Authorised in " + emrLabel() + ".", true, function () {
        st.assessAuthorized = { by: st.author || "", on: "" };
        endConsult();
      });
      return;
    }
    if (!oeDocId()) { toast("Save the assessment first, then authorise it."); return; }
    // Spelled out because it is irreversible: GHIS locks the record on sign-off.
    if (!confirmed("Authorise this assessment?\n\nIt is signed off in " + emrLabel() + " and moves into Clinical notes. The record is then LOCKED - you cannot edit or save it again.")) return;
    // GHIS's own Authorize button (signOff1 -> Home/signoffinitialAssessmentnew). The consult is only
    // finished once GHIS confirms the sign-off, so a failed authorise never silently advances the queue.
    postWrite("/assessment-authorize",
      { patientId: (st.patient && st.patient.mrn) || "", episodeId: st.episodeId || "", docId: oeDocId() },
      "Authorised in " + emrLabel() + ". It is now in Clinical notes.",
      { kind: "assessment", text: "Authorised (signed off)", signOff: true },
      function () {
        // Reflect the lock immediately: GHIS will no longer accept a write for this record.
        st.assessAuthorized = { by: st.author || "", on: "" };
        // The "Authorised by" line is a second timeline entry for the reader; it is NOT a second
        // sign-off, so it carries neither fields nor the signOff flag and the record ignores it.
        try { addToTimeline("assessment", "Authorised by " + (st.author || "the doctor")); } catch (e) {}
        endConsult();
      });
  }
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
    postWrite("/assessment-save", { patientId: st.patient.mrn || "", episodeId: st.episodeId || "", docId: oeDocId(), fields: buildAssessPayload(st.assessVals || {}) }, "Referred to Emergency (ER).", { kind: "assessment", text: "Referred to Emergency (ER)", vals: buildAssessPayload(st.assessVals || {}) });
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

  // Thin delegate so tests/callers can reach the matrix builder off OPDEMR without reaching into
  // window.SMD_ONCOUI directly (onco-protocols.js owns the real, pure implementation).
  function _buildOncoMatrixDelegate(plan) { return (G.SMD_ONCOUI && G.SMD_ONCOUI._buildOncoMatrix) ? G.SMD_ONCOUI._buildOncoMatrix(plan) : ""; }
  // OncoTree handoff: when the navigator's "Continue in treatment workflow" fires, stage the dose
  // preview for the open patient. Registered once; guarded (no-op unless a patient profile is open).
  try { if (typeof document !== "undefined") document.addEventListener("smd-oncotree-select", function (e) { try { receiveOncoTreeProtocol(e && e.detail); } catch (err) {} }); } catch (e) {}

  G.OPDEMR = { openProfile: openProfile, close: close, _render: _render, _assessPayload: buildAssessPayload, _voiceMerge: _voiceMerge, VOICE_MAP: VOICE_MAP, _applyRefine: _applyRefine, _groundOpts: groundOpts, _differentialFor: differentialFor, _toggleFieldMic: toggleFieldMic, _endConsult: endConsult, _consultToER: consultToER, _askMaik: askMaik, _assessFindingsText: assessFindingsText, _treatmentLines: treatmentLines, _buildMaikSuggestions: buildMaikSuggestions, _rankDifferential: rankDifferential, _clinicalRerank: clinicalRerank, _emrCorrections: emrCorrections, _askMaikPro: askMaikPro, _assessProText: assessProText, _alcoholCalc: alcoholCalc, _detectInvestigations: detectInvestigations, _expandQuery: expandQuery, _mergeNoteIntoHistory: mergeNoteIntoHistory, _buildOncoMatrix: _buildOncoMatrixDelegate, oncoTab: oncoTab };
  if (typeof module !== "undefined" && module.exports) module.exports = { _render: _render, _assessPayload: buildAssessPayload, _voiceMerge: _voiceMerge, VOICE_MAP: VOICE_MAP, _applyRefine: _applyRefine, _groundOpts: groundOpts, _differentialFor: differentialFor, _assessFindingsText: assessFindingsText, _treatmentLines: treatmentLines, _buildMaikSuggestions: buildMaikSuggestions, _rankDifferential: rankDifferential, _clinicalRerank: clinicalRerank, _emrCorrections: emrCorrections, _askMaikPro: askMaikPro, _assessProText: assessProText, _alcoholCalc: alcoholCalc, _detectInvestigations: detectInvestigations, _expandQuery: expandQuery, _mergeNoteIntoHistory: mergeNoteIntoHistory, _buildOncoMatrix: _buildOncoMatrixDelegate, oncoTab: oncoTab };
})();
