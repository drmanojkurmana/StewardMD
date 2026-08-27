/* pglog-model.js — NMC Logbook · THE PURE CORE.
 * ===========================================================================
 * Entities, the verification state machine, the progress/cadence engine, attendance, exam
 * eligibility and assessment scoring. No DOM, no fetch, no storage, no Date.now() except through
 * an injectable `now` — so every rule below is unit-testable and is enforced IDENTICALLY on the
 * client (pglog-screens.js) and on the server (functions/_pglog_store.js imports this file, the
 * same UMD interop path functions/_onco_store.js uses for onco-dose.js).
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE UI
 * -----------------------------------------
 * A PG logbook entry is a document a University examiner relies on, and PGMER-2023 section 9.2(c)
 * puts a monetary penalty on the named faculty/HoD/Dean who submits a false record. So the
 * guarantees below are throws at the data layer, not disabled buttons:
 *
 *   1. verify()      throws if the actor is the entry's author  - nobody verifies their own record
 *   2. returnEntry() throws on an empty reason                  - a return must say what to fix
 *   3. applyEdit()   throws on a verified entry                 - verified history is never rewritten
 *   4. amend()       snapshots the whole prior doc into revisions[] before mutating
 *   5. softDelete()  throws on a verified entry                 - correction is amend(), not delete
 *   6. assess()      throws if assessor === assessee
 *   7. every timestamp the caller may not forge is taken from the injected `now`, never the client
 *
 * PROVENANCE: every requirement carries source/clause. Nothing in this file invents an NMC number.
 * The only numbers here are the ones the regulation states (80% attendance) and cadence arithmetic.
 * See NMC_PG_LOGBOOK_REQUIREMENTS.md for source -> clause -> feature for every one of them.
 *
 * FUTURE UG: nothing here knows the word "PG". programmeType is a field; requirements carry an
 * unused-for-PG competencyCode which is exactly where a CBME code will go.
 */
(function () {
  "use strict";

  var VERSION = "1.0";

  /* ── enums ───────────────────────────────────────────────────────────────── */

  // The seven activity kinds. `reflection` is first-class because the 2022-revised curricula say
  // "trained to reflect and record their reflections in log book particularly of the critical
  // incidents" - a reflection is not a remark on something else.
  var ENTRY_KINDS = ["clinical", "procedure", "academic", "research", "certification", "attendance", "reflection"];
  var CLINICAL_SETTINGS = ["opd", "ipd", "emergency"];

  // The role ladder. PGMER-2023 5.2(vi) names two of these literally ("assisted or done
  // independently"); the curricula's DOAP (Demonstrate-Observe-Assist-Perform) gives the other two.
  // Order is meaningful: index = graded responsibility (5.2(x)).
  var ROLES = ["observed", "assisted", "performed_supervised", "performed_independent"];
  var ROLE_LABEL = {
    observed: "Observed",
    assisted: "Assisted",
    performed_supervised: "Performed under supervision",
    performed_independent: "Performed independently"
  };

  // Academic activity types. The first nine are PGMER-2023 5.2(x) verbatim; ug_teaching is 5.2(viii);
  // the rest come from the specialty curricula (see the requirements doc section 1.4 / 3.3).
  var ACADEMIC_TYPES = [
    "lecture", "seminar", "journal_club", "group_discussion", "laboratory_work",
    "clinical_meeting", "grand_round", "cpc", "interdepartmental",
    "ug_teaching", "case_presentation", "case_discussion", "symposium",
    "thesis_presentation", "cme_conference", "workshop", "mortality_morbidity", "other"
  ];
  var ACADEMIC_LABEL = {
    lecture: "Lecture", seminar: "Seminar", journal_club: "Journal club",
    group_discussion: "Group discussion", laboratory_work: "Laboratory / experimental work",
    clinical_meeting: "Clinical meeting", grand_round: "Grand round",
    cpc: "Clinico-pathological conference", interdepartmental: "Interdepartmental meeting",
    ug_teaching: "Teaching undergraduates / interns", case_presentation: "Case presentation",
    case_discussion: "Case discussion", symposium: "Symposium",
    thesis_presentation: "Thesis / research presentation", cme_conference: "CME / conference",
    workshop: "Workshop", mortality_morbidity: "Mortality & morbidity audit", other: "Other"
  };
  // MD Emergency Medicine 2024's own parenthetical: "within department / peripheral posting /
  // outside department / outside institution".
  var ACADEMIC_SCOPES = ["within_department", "peripheral_posting", "outside_department", "outside_institution"];
  var ACADEMIC_ROLES = ["presented", "attended", "moderated", "organised"];

  // Research/thesis milestones. CONFIG, reorderable per programme - PGMER-2023 makes thesis a
  // curriculum component (2.2(iii)) and gives it 5% of practical marks (8.1) but prescribes no
  // milestone chain. This default is seeded from the curricula's own thesis paragraphs.
  var RESEARCH_MILESTONES = [
    "topic_selected", "guide_allotted", "protocol_drafted", "protocol_approved",
    "ethics_approval", "data_collection", "analysis", "draft_written", "submitted", "accepted"
  ];
  var RESEARCH_SUBTYPES = ["thesis_milestone", "publication", "poster", "conference_paper", "additional_project", "presentation"];
  // PGMER-2023 5.2(xi)-(c): the three certifications that are mandatory in year 1 and are a
  // pre-requisite to sitting the final examination.
  var CERTIFICATIONS = ["research_methodology", "ethics_gcp_glp", "bcls_acls"];
  // PGMER-2023 5.5.
  var ATTENDANCE_STATES = ["present", "leave_paid", "leave_academic", "leave_maternity", "leave_paternity", "absent", "holiday"];
  /* WHAT COUNTS AS AN ATTENDED DAY IS INSTITUTIONAL POLICY, NOT REGULATION.
   * PGMER-2023 5.5 GRANTS 20 days paid leave (5.5(a)), 5 days academic leave (5.5(e)), a weekly
   * holiday (5.5(b)) and maternity/paternity leave (5.5(c),(d)). It says the term is extended only
   * "If a candidate avails leave IN EXCESS THAN the permitted number of days". It nowhere says that
   * permitted leave is non-attendance.
   *
   * So the default below counts every PERMITTED leave state. Deducting statutory maternity leave
   * from a resident's attendance percentage — and then badging the result "PGMER-2023 5.5" — would
   * be the module inventing a rule and attributing it to the gazette. (R1 2026-08-27, finding C2.)
   *
   * Institutions do differ, so this is `attendanceCounts` in pconfig() and the Academic Cell can
   * change it; attendanceSummary() then reports interpretationSource "institution". */
  var COUNTS_AS_ATTENDED_DEFAULT = {
    present: 1, leave_paid: 1, leave_academic: 1, leave_maternity: 1, leave_paternity: 1,
    absent: 0, holiday: 0
  };

  var STATUSES = ["draft", "submitted", "verified", "returned"];
  var ASSESSMENT_OUTCOMES = ["satisfactory", "needs_improvement", "remediation"];
  var ASSESSMENT_STATUSES = ["draft", "completed", "remediation_plan", "reassessment", "signed"];
  var ATTESTATION_KINDS = ["monthly", "hod_final", "hod_proficiency"];
  var DEGREES = ["MD", "MS", "DM", "MCh", "Diploma", "PDCC", "PDF"];
  var OUTCOMES = ["improved", "unchanged", "worsened", "referred", "died", "unknown"];

  /* ── small pure helpers ──────────────────────────────────────────────────── */

  function s(v) { return v == null ? "" : String(v); }
  function trim(v) { return s(v).trim(); }
  function clampStr(v, n) { return trim(v).slice(0, n); }
  function oneOf(list, v, dflt) { return list.indexOf(s(v)) > -1 ? s(v) : dflt; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function strArr(x, n) {
    var out = [], seen = {};
    arr(x).forEach(function (v) { var t = clampStr(v, 120); if (t && !seen[t]) { seen[t] = 1; out.push(t); } });
    return out.slice(0, n || 40);
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function posInt(v, d) { var n = Math.round(Number(v)); return isFinite(n) && n > 0 ? n : d; }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? null : o)); }
  function err(code, detail) { var e = new Error(code); e.code = code; if (detail) e.detail = detail; return e; }

  /* Dates. Everything date-shaped in this module is an ISO "YYYY-MM-DD" STRING and all arithmetic
   * is done in UTC, because a logbook day must not shift when a resident travels or when the server
   * runs in UTC and the phone does not. Timestamps (createdAt/verifiedAt) are ms epoch. */
  function isoDate(x) {
    if (x == null || x === "") return "";
    if (typeof x === "number") return new Date(x).toISOString().slice(0, 10);
    var t = trim(x);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var d = new Date(t);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  function dayMs(iso) { var d = isoDate(iso); return d ? Date.parse(d + "T00:00:00Z") : NaN; }
  function daysBetween(a, b) {   // b - a, in whole days; NaN-safe -> 0
    var x = dayMs(a), y = dayMs(b);
    if (!isFinite(x) || !isFinite(y)) return 0;
    return Math.round((y - x) / 86400000);
  }
  function addDays(iso, n) {
    var x = dayMs(iso); if (!isFinite(x)) return "";
    return new Date(x + n * 86400000).toISOString().slice(0, 10);
  }
  function addMonths(iso, n) {
    var d = isoDate(iso); if (!d) return "";
    var y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
    var t = new Date(Date.UTC(y, m + n, 1));
    // clamp the day to the target month's length (31 Jan + 1 month -> 28/29 Feb, not 3 Mar)
    var last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.toISOString().slice(0, 10);
  }
  function monthKey(iso) { var d = isoDate(iso); return d ? d.slice(0, 7) : ""; }
  // ISO-8601 week key "YYYY-Www". PGMER 5.2(vi) says the e-logbook is "updated on weekly basis", so
  // the week is a regulatory unit here and must be the same week for everyone (Mon-Sun, ISO).
  function weekKey(iso) {
    var t = dayMs(iso); if (!isFinite(t)) return "";
    var d = new Date(t);
    var dow = (d.getUTCDay() + 6) % 7;                 // Mon=0 .. Sun=6
    d.setUTCDate(d.getUTCDate() - dow + 3);            // Thursday of this ISO week
    var year = d.getUTCFullYear();
    var jan4 = Date.UTC(year, 0, 4);
    var jd = new Date(jan4);
    var jdow = (jd.getUTCDay() + 6) % 7;
    var week1Thu = jan4 - jdow * 86400000 + 3 * 86400000;
    var wk = Math.round((d.getTime() - week1Thu) / (7 * 86400000)) + 1;
    return year + "-W" + (wk < 10 ? "0" + wk : String(wk));
  }
  function weeksBetween(a, b) { var d = daysBetween(a, b); return d <= 0 ? 0 : Math.floor(d / 7) + 1; }

  /* ── PHI minimisation ────────────────────────────────────────────────────────
   * The logbook is an educational record, not a second EMR. There is no schema field for a patient
   * name, phone, address or Aadhaar, and this scrubber is the belt to that braces: a resident who
   * types a name into the case-reference box gets it stripped rather than stored. It is deliberately
   * conservative - it keeps MRN-shaped tokens and drops long alphabetic runs and anything that looks
   * like a phone/Aadhaar/email. Also applied server-side (never trust the client). */
  /* The same scrubber, applied to the FREE-TEXT fields a resident actually types into. `title` is the
   * box someone writes "Mr Ramesh, 54M, DKA" in, and it was previously stored raw, shown to every
   * `full` audience, and sent to the AI endpoint (R1, finding I9). Unlike caseRef this must NOT drop
   * ordinary clinical prose, so it removes only the unambiguous identifiers — email, mobile,
   * Aadhaar-shaped digits — and leaves the rest intact. A clinical title is meant to be readable. */
  function scrubFreeText(v, max) {
    var t = trim(v);
    if (!t) return "";
    t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[removed]");
    t = t.replace(/(?:\+\s?)?(?:91[-\s]?)?\b[6-9]\d{9}\b/g, "[removed]");
    t = t.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, "[removed]");
    return t.replace(/\s{2,}/g, " ").trim().slice(0, max || 160);
  }
  function sanitizeCaseRef(v) {
    var t = trim(v);
    if (!t) return "";
    t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "");            // email
    // No \b before the optional "+91" — \b never matches before "+", which would leave a stray "+".
    t = t.replace(/(?:\+\s?)?(?:91[-\s]?)?\b[6-9]\d{9}\b/g, "");   // IN mobile, with or without +91
    t = t.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, "");          // Aadhaar-shaped
    // A name is alphabetic words; an MRN is alphanumeric or numeric. Drop runs of >=2 purely
    // alphabetic words of >=3 letters (e.g. "Ramesh Kumar"), keep "MRN 4482" / "IP-99213" / "OPD22".
    t = t.replace(/\b([A-Za-z]{3,})(\s+[A-Za-z]{3,})+\b/g, function (m0) {
      return /^(mrn|ipd?|opd?|uhid|reg|no|number|case|bed|ward|ot|ip|op)\b/i.test(m0) ? m0 : "";
    });
    // Trim the punctuation a removal leaves behind ("+", trailing "-", a lone "/") so a fully
    // scrubbed value comes back as "" rather than as a stub that looks like a real reference.
    return t.replace(/\s{2,}/g, " ").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim().slice(0, 32);
  }
  var AGE_BANDS = ["0-1", "1-5", "5-12", "12-18", "18-30", "30-45", "45-60", "60-75", "75+"];
  function ageBand(v) {
    var t = trim(v);
    if (AGE_BANDS.indexOf(t) > -1) return t;
    var n = Number(t);
    if (!isFinite(n) || n < 0) return "";
    if (n < 1) return "0-1"; if (n < 5) return "1-5"; if (n < 12) return "5-12"; if (n < 18) return "12-18";
    if (n < 30) return "18-30"; if (n < 45) return "30-45"; if (n < 60) return "45-60"; if (n < 75) return "60-75";
    return "75+";
  }

  /* ── entities ────────────────────────────────────────────────────────────── */

  function requireId(o, what) { if (!o || !trim(o.id)) throw err("pglog_id_required", what || ""); }

  function programme(o) {
    o = o || {}; requireId(o, "programme");
    var degree = oneOf(DEGREES, o.degree, "MD");
    return {
      id: clampStr(o.id, 80),
      programmeType: o.programmeType === "UG" ? "UG" : "PG",   // UG is a valid value the engine carries; no UG pack ships today
      orgId: clampStr(o.orgId, 80),
      departmentId: clampStr(o.departmentId, 80),
      name: clampStr(o.name, 120),
      degree: degree,
      specialtyId: clampStr(o.specialtyId, 80),
      curriculumId: clampStr(o.curriculumId, 80),
      // PGMER-2023 2.1: broad specialty 3 years (2 for diploma-holders), super specialty 3, diploma 2.
      durationMonths: posInt(o.durationMonths, degree === "Diploma" ? 24 : 36),
      config: pconfig(o.config),
      createdAt: num(o.createdAt, 0)
    };
  }
  // Institutional policy. NOT NMC requirements - see the requirements doc. Seeded from the
  // regulation where the regulation gives a number, and labelled with whose rule each one is.
  function pconfig(c) {
    c = c || {};
    return {
      verifySlaDays: posInt(c.verifySlaDays, 7),                 // CONFIG
      attestationGraceDays: posInt(c.attestationGraceDays, 7),   // CONFIG
      rotationEndNoticeDays: posInt(c.rotationEndNoticeDays, 7), // CONFIG
      attendancePct: num(c.attendancePct, 80),                   // PGMER-2023 5.5 (regulation)
      // Which attendance states count toward the percentage. INSTITUTIONAL, not NMC — see the
      // COUNTS_AS_ATTENDED_DEFAULT comment. Only the seven known states are accepted.
      attendanceCounts: attendanceCounts(c.attendanceCounts),
      attendanceDays: posInt(c.attendanceDays, 0),               // PGMEB FAQ 751/501 - SECONDARY source; 0 = not set
      attendanceDaysSource: clampStr(c.attendanceDaysSource || "nmc_faq_secondary", 40),
      researchMilestones: strArr(c.researchMilestones, 20).length ? strArr(c.researchMilestones, 20) : RESEARCH_MILESTONES.slice()
    };
  }
  // Normalise an institutional attendance-counting map: known states only, 1 or 0 only, defaults
  // filled in. A stray key or a truthy string cannot quietly change what "attended" means.
  function attendanceCounts(m) {
    var out = {};
    ATTENDANCE_STATES.forEach(function (k) {
      out[k] = (m && Object.prototype.hasOwnProperty.call(m, k)) ? (m[k] ? 1 : 0) : COUNTS_AS_ATTENDED_DEFAULT[k];
    });
    return out;
  }
  // True when the institution has changed any of the defaults — the UI says so rather than letting a
  // local interpretation read as the regulation's.
  function attendanceCountsCustomised(m) {
    return ATTENDANCE_STATES.some(function (k) { return attendanceCounts(m)[k] !== COUNTS_AS_ATTENDED_DEFAULT[k]; });
  }

  function resident(o) {
    o = o || {}; requireId(o, "resident");
    var start = isoDate(o.startDate);
    return {
      id: clampStr(o.id, 80),
      uid: clampStr(o.uid, 120),
      orgId: clampStr(o.orgId, 80),
      programmeId: clampStr(o.programmeId, 80),
      departmentId: clampStr(o.departmentId, 80),
      smdId: clampStr(o.smdId, 40),
      name: clampStr(o.name, 120),
      batch: clampStr(o.batch, 20),
      unit: clampStr(o.unit, 60),
      trainingYear: Math.min(6, Math.max(1, posInt(o.trainingYear, 1))),
      startDate: start,
      endDate: isoDate(o.endDate),
      guide: clampStr(o.guide, 120),
      coGuides: strArr(o.coGuides, 5),
      active: o.active !== false,
      createdAt: num(o.createdAt, 0)
    };
  }
  // Training year derived from elapsed time, so a dashboard never shows a stale hand-typed year.
  // Capped at the programme duration - a resident whose term was extended stays in the final year.
  function trainingYearOn(res, prog, todayIso) {
    var start = isoDate(res && res.startDate); if (!start) return posInt(res && res.trainingYear, 1);
    var months = Math.floor(daysBetween(start, todayIso) / 30.4375);
    var maxYear = Math.max(1, Math.ceil(posInt(prog && prog.durationMonths, 36) / 12));
    return Math.min(maxYear, Math.max(1, Math.floor(months / 12) + 1));
  }
  // Semester (1-based), used by the DRP window check below.
  function semesterOn(res, todayIso) {
    var start = isoDate(res && res.startDate); if (!start) return 1;
    return Math.max(1, Math.floor(Math.floor(daysBetween(start, todayIso) / 30.4375) / 6) + 1);
  }

  var ROTATION_KINDS = ["department", "unit", "drp", "elective", "external", "casualty", "laboratory"];
  function rotation(o) {
    o = o || {}; requireId(o, "rotation");
    return {
      id: clampStr(o.id, 80),
      residentId: clampStr(o.residentId, 80),
      orgId: clampStr(o.orgId, 80),
      programmeId: clampStr(o.programmeId, 80),
      name: clampStr(o.name, 120),
      kind: oneOf(ROTATION_KINDS, o.kind, "department"),
      departmentId: clampStr(o.departmentId, 80),
      unit: clampStr(o.unit, 60),
      externalSite: clampStr(o.externalSite, 120),
      startDate: isoDate(o.startDate),
      endDate: isoDate(o.endDate),
      faculty: clampStr(o.faculty, 120),
      coordinator: clampStr(o.coordinator, 120),        // DRPC for a DRP rotation (PGMER 5.2(xv)VI)
      requirementIds: strArr(o.requirementIds, 60),
      objectives: clampStr(o.objectives, 600),
      status: oneOf(["planned", "active", "completed"], o.status, "planned"),
      createdAt: num(o.createdAt, 0)
    };
  }
  /* PGMER-2023 5.2(xv)V, verbatim: "shall undergo a compulsory residential rotation of three months
   * in District Hospitals/ District Health System ... Such rotation shall take place in the 3rd or
   * 4th or 5th semester of the post-graduate programme. In case of those students who have taken
   * admission after completion of Diploma in the relevant specialty, District Residency Programme
   * shall take place in third semester only. Similarly, the post-graduate diploma students shall
   * undergo the District Residency Programme in the third semester."
   *
   * TWO EXCEPTIONS the clause states and the first version of this function ignored (R1, finding I8):
   * a post-diploma entrant and a PG-diploma student are BOTH restricted to the third semester.
   *
   * Returned as a WARNING, never a block: a State's posting schedule is not the resident's to fix,
   * and refusing to record a posting that actually happened would make the logbook less true. */
  function drpWindowOk(rot, res, prog) {
    if (!rot || rot.kind !== "drp") return { ok: true };
    var start = isoDate(rot.startDate);
    if (!start || !res || !res.startDate) return { ok: true, unknown: true };
    var sem = Math.max(1, Math.floor(Math.floor(daysBetween(res.startDate, start) / 30.4375) / 6) + 1);
    // Third-semester-only cases: a PG Diploma student, or an entrant admitted on the strength of a
    // diploma in the same specialty (which the programme records by shortening the course to 24 mo).
    var thirdOnly = !!(prog && (prog.degree === "Diploma" || posInt(prog.durationMonths, 36) <= 24)) || !!(res && res.postDiploma);
    var lo = thirdOnly ? 3 : 3, hi = thirdOnly ? 3 : 5;
    if (sem >= lo && sem <= hi) return { ok: true, semester: sem, thirdOnly: thirdOnly };
    return {
      ok: false, semester: sem, thirdOnly: thirdOnly,
      warning: thirdOnly
        ? "PGMER-2023 5.2(xv)V places the District Residency in the THIRD SEMESTER ONLY for a " +
          "post-diploma entrant or a PG Diploma student; this rotation starts in semester " + sem + "."
        : "PGMER-2023 5.2(xv)V places the District Residency in the 3rd, 4th or 5th semester; " +
          "this rotation starts in semester " + sem + ".",
      source: "nmc_regulation", clause: "5.2(xv)V"
    };
  }
  // Total DRP DAYS recorded. Days, not months, because months are the thing being tested against and
  // a fractional-month figure is what let a 77-day posting satisfy "three months" (R1, finding C1).
  function drpDays(rots) {
    return arr(rots).filter(function (r) { return r && r.kind === "drp"; })
      .reduce(function (a, r) { return a + Math.max(0, daysBetween(r.startDate, r.endDate)); }, 0);
  }
  // Months, for DISPLAY only. Never compare this against 3.
  function drpMonths(rots) { return drpDays(rots) / 30.4375; }
  // THE THRESHOLD. The regulation says three CALENDAR months. The shortest possible three-calendar-
  // month span is 1 Feb -> 1 May = 89 days (28+31+30); the longest is 92. So 89 days is the honest
  // floor: it admits every real three-month posting and excludes the 77-day one that the previous
  // `months >= 2.5` accepted. A DRP may legitimately be split across postings, so days are summed.
  var DRP_MIN_DAYS = 89;
  function drpMeetsThreeMonths(rots) { return drpDays(rots) >= DRP_MIN_DAYS; }

  /* ── the entry: one polymorphic record for every logged activity ─────────────
   * Deliberately ONE shape rather than seven collections. A logbook's whole value is the union - the
   * weekly-cadence check (5.2(vi)), the monthly attestation (5.2(vii)) and every report iterate all
   * activity at once, and seven parallel schemas would mean seven places to get the audit trail
   * right. Kind-specific fields are validated per kind by validateEntry(). */
  function entry(o) {
    o = o || {}; requireId(o, "entry");
    var kind = oneOf(ENTRY_KINDS, o.kind, "clinical");
    var e = {
      id: clampStr(o.id, 80),
      v: VERSION,
      kind: kind,
      residentId: clampStr(o.residentId, 80),
      programmeId: clampStr(o.programmeId, 80),
      orgId: clampStr(o.orgId, 80),
      departmentId: clampStr(o.departmentId, 80),
      rotationId: clampStr(o.rotationId, 80),
      occurredAt: isoDate(o.occurredAt),
      title: scrubFreeText(o.title, 160),
      remarks: scrubFreeText(o.remarks, 1200),
      supervisor: clampStr(o.supervisor, 120),
      requirementIds: strArr(o.requirementIds, 12),
      attachments: arr(o.attachments).slice(0, 6).map(attachment),
      linkedEntryIds: strArr(o.linkedEntryIds, 12),
      // lifecycle
      status: oneOf(STATUSES, o.status, "draft"),
      createdBy: clampStr(o.createdBy, 120),
      createdAt: num(o.createdAt, 0),
      updatedAt: num(o.updatedAt, 0),
      submittedAt: num(o.submittedAt, 0),
      verifiedBy: clampStr(o.verifiedBy, 120),
      verifiedAt: num(o.verifiedAt, 0),
      returnedBy: clampStr(o.returnedBy, 120),
      returnedAt: num(o.returnedAt, 0),
      returnReason: clampStr(o.returnReason, 500),
      attestedIn: clampStr(o.attestedIn, 16),      // the monthly attestation (YYYY-MM) that covered it
      // Bounded for the Firestore 1 MiB document limit, but NEVER silently: overflowedHistory /
      // overflowedRevisions record that older rows exist and were shed, so a report cannot present a
      // truncated chain as complete. (R1, finding I3.) At these caps an entry would need 200 state
      // changes or 30 amendments to reach them, so in practice nothing is ever dropped.
      history: arr(o.history).slice(-HISTORY_CAP).map(historyRow),
      overflowedHistory: Math.max(num(o.overflowedHistory, 0), Math.max(0, arr(o.history).length - HISTORY_CAP)),
      revisions: arr(o.revisions).slice(-REVISION_CAP),
      overflowedRevisions: Math.max(num(o.overflowedRevisions, 0), Math.max(0, arr(o.revisions).length - REVISION_CAP)),
      deleted: !!o.deleted,
      deletedBy: clampStr(o.deletedBy, 120),
      deletedAt: num(o.deletedAt, 0),
      deleteReason: clampStr(o.deleteReason, 300)
    };
    if (kind === "clinical") {
      e.setting = oneOf(CLINICAL_SETTINGS, o.setting, "opd");
      e.category = clampStr(o.category, 80);
      e.diagnosis = scrubFreeText(o.diagnosis, 160);
      e.role = oneOf(ROLES, o.role, "assisted");
      e.caseRef = sanitizeCaseRef(o.caseRef);
      e.ageBand = ageBand(o.ageBand);
      e.sex = oneOf(["male", "female", "other", ""], o.sex, "");
      e.outcome = oneOf(OUTCOMES, o.outcome, "unknown");
      e.work = strArr(o.work, 12);
      e.unit = clampStr(o.unit, 60);
    } else if (kind === "procedure") {
      e.procedureId = clampStr(o.procedureId, 80);
      e.procedureText = scrubFreeText(o.procedureText, 160);
      e.role = oneOf(ROLES, o.role, "assisted");
      e.caseRef = sanitizeCaseRef(o.caseRef);
      e.ageBand = ageBand(o.ageBand);
      e.sex = oneOf(["male", "female", "other", ""], o.sex, "");
      e.outcome = oneOf(OUTCOMES, o.outcome, "unknown");
      e.complications = strArr(o.complications, 8);
      e.complicationNotes = scrubFreeText(o.complicationNotes, 600);
      e.anaesthesia = clampStr(o.anaesthesia, 60);
      e.setting = oneOf(CLINICAL_SETTINGS.concat(["ot", "daycare", "bedside"]), o.setting, "ot");
    } else if (kind === "academic") {
      e.academicType = oneOf(ACADEMIC_TYPES, o.academicType, "seminar");
      e.role = oneOf(ACADEMIC_ROLES, o.role, "attended");
      e.topic = scrubFreeText(o.topic, 200);
      e.scope = oneOf(ACADEMIC_SCOPES, o.scope, "within_department");
      e.place = clampStr(o.place, 120);
      e.audience = clampStr(o.audience, 80);
    } else if (kind === "research") {
      e.subtype = oneOf(RESEARCH_SUBTYPES, o.subtype, "thesis_milestone");
      e.milestone = clampStr(o.milestone, 60);
      e.projectTitle = clampStr(o.projectTitle, 240);
      e.guide = clampStr(o.guide, 120);
      e.coGuides = strArr(o.coGuides, 5);
      e.journal = clampStr(o.journal, 160);
      e.indexed = !!o.indexed;
      e.firstAuthor = !!o.firstAuthor;
      e.conference = clampStr(o.conference, 160);
      e.conferenceLevel = oneOf(["institutional", "state", "zonal", "national", "international", ""], o.conferenceLevel, "");
      e.identifier = clampStr(o.identifier, 120);      // DOI / PMID / IEC reference
      e.status = e.status;                              // (lifecycle status, not project status)
      e.projectStatus = clampStr(o.projectStatus, 40);
    } else if (kind === "certification") {
      e.subtype = oneOf(CERTIFICATIONS, o.subtype, "research_methodology");
      e.issuer = clampStr(o.issuer, 160);
      e.certificateNo = clampStr(o.certificateNo, 80);
      e.validUntil = isoDate(o.validUntil);
    } else if (kind === "attendance") {
      e.state = oneOf(ATTENDANCE_STATES, o.state, "present");
      e.endDate = isoDate(o.endDate) || e.occurredAt;   // a range collapses to per-day on expansion
      e.shift = clampStr(o.shift, 40);
    } else if (kind === "reflection") {
      e.subtype = oneOf(["critical_incident", "learning_point", "feedback_received", "other"], o.subtype, "learning_point");
      e.body = scrubFreeText(o.body, 4000);
    }
    return e;
  }
  function attachment(a) {
    a = a || {};
    return {
      id: clampStr(a.id, 80), name: clampStr(a.name, 160),
      mime: clampStr(a.mime, 80), size: num(a.size, 0),
      url: clampStr(a.url, 500), sha256: clampStr(a.sha256, 64), addedAt: num(a.addedAt, 0)
    };
  }
  function historyRow(h) {
    h = h || {};
    return {
      at: num(h.at, 0), by: clampStr(h.by, 120), action: clampStr(h.action, 40),
      from: clampStr(h.from, 24), to: clampStr(h.to, 24), reason: clampStr(h.reason, 500)
    };
  }

  /* ── validation ──────────────────────────────────────────────────────────────
   * Returns { ok, errors[] }. Called by the UI to disable Submit AND by the server before any write,
   * so a crafted request cannot store a record the UI would have refused. */
  function validateEntry(e, ctx) {
    ctx = ctx || {};
    var errors = [];
    function bad(field, msg) { errors.push({ field: field, message: msg }); }

    // A DEVICE-LOCAL DRAFT has no resident id yet: a resident evaluating the module before their
    // Academic Cell has enrolled them can still record what they did, and that draft is exactly what
    // gets submitted on the day they are linked. The server never passes requireResident:false, so
    // nothing can reach Firestore without one — this relaxation is client-side only, by design.
    if (ctx.requireResident !== false && !trim(e.residentId)) bad("residentId", "Resident is required.");
    if (!e.occurredAt) bad("occurredAt", "Date is required.");
    else {
      // occurredAt is the one date the CALLER supplies (when the work happened). Bound it: not in the
      // future, not before the programme began. Everything else is server-stamped.
      if (ctx.today && daysBetween(e.occurredAt, ctx.today) < 0) bad("occurredAt", "Date cannot be in the future.");
      if (ctx.programmeStart && daysBetween(ctx.programmeStart, e.occurredAt) < 0) {
        bad("occurredAt", "Date is before training started (" + ctx.programmeStart + ").");
      }
    }
    if (e.kind === "clinical") {
      if (!trim(e.title)) bad("title", "Describe the clinical activity or case.");
      if (ROLES.indexOf(e.role) < 0) bad("role", "Your role is required.");
    } else if (e.kind === "procedure") {
      if (!trim(e.procedureId) && !trim(e.procedureText)) bad("procedure", "Select or name the procedure.");
      if (ROLES.indexOf(e.role) < 0) bad("role", "Your role is required (PGMER-2023 5.2(vi)).");
    } else if (e.kind === "academic") {
      if (!trim(e.topic) && !trim(e.title)) bad("topic", "Topic is required.");
    } else if (e.kind === "research") {
      if (e.subtype === "thesis_milestone" && !trim(e.milestone)) bad("milestone", "Which milestone?");
      if (e.subtype === "publication" && !trim(e.journal)) bad("journal", "Journal is required.");
      // The regulation names the certificate as the evidence for ethics clearance; a milestone that
      // claims IEC approval with nothing attached is the exact record 9.2(c) is about.
      if (e.milestone === "ethics_approval" && !e.attachments.length) {
        bad("attachments", "Attach the ethics-committee approval letter.");
      }
    } else if (e.kind === "certification") {
      if (CERTIFICATIONS.indexOf(e.subtype) < 0) bad("subtype", "Unknown certification.");
      // PGMER-2023 5.2(xi)iv: "The online certificate generated on successful completion ... will
      // be acceptable evidence of having completed this course."
      if (!e.attachments.length && !trim(e.certificateNo)) {
        bad("attachments", "Attach the certificate (PGMER-2023 5.2(xi)) or enter its number.");
      }
    } else if (e.kind === "attendance") {
      if (e.endDate && daysBetween(e.occurredAt, e.endDate) < 0) bad("endDate", "End date is before the start date.");
      if (e.endDate && daysBetween(e.occurredAt, e.endDate) > 366) bad("endDate", "Range longer than a year.");
    } else if (e.kind === "reflection") {
      if (!trim(e.body)) bad("body", "Write the reflection.");
    }
    // MS / M.Ch: PGMER-2023 5.2(vi) makes the surgical-procedure log mandatory, so a procedure entry
    // from these degrees must name a supervisor - "assisted or done independently" is a claim about a
    // named person's theatre.
    if (e.kind === "procedure" && ctx.degree && requiresProcedureLog(ctx.degree) && !trim(e.supervisor)) {
      bad("supervisor", "Supervising consultant is required for " + ctx.degree + " procedure entries (PGMER-2023 5.2(vi)).");
    }
    return { ok: !errors.length, errors: errors };
  }
  // PGMER-2023 5.2(vi): "MS/M.Ch students shall mandatorily enter details of surgical procedures
  // assisted or done independently."
  function requiresProcedureLog(degree) { return degree === "MS" || degree === "MCh"; }

  /* ── the verification state machine ──────────────────────────────────────────
   * Each transition returns a NEW entry object; none mutates its input. `at` and `by` are supplied by
   * the caller (the server passes its own clock and the verified caller identity - never the body). */

  var HISTORY_CAP = 200, REVISION_CAP = 30;
  function pushHistory(e, row) {
    var out = clone(e);
    var all = arr(out.history).concat([historyRow(row)]);
    out.overflowedHistory = num(out.overflowedHistory, 0) + Math.max(0, all.length - HISTORY_CAP);
    out.history = all.slice(-HISTORY_CAP);
    return out;
  }

  function submit(e, actor, at) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status === "verified") throw err("pglog_already_verified");
    var out = pushHistory(e, { at: at, by: actor, action: "submit", from: e.status, to: "submitted" });
    out.status = "submitted";
    out.submittedAt = at;
    out.updatedAt = at;
    out.returnReason = "";                     // a resubmission clears the old return reason from the
    out.returnedBy = ""; out.returnedAt = 0;   // ACTIVE fields only; history keeps the return forever
    return out;
  }

  // RULE 1. Nobody verifies their own record. Enforced here so it holds for every caller - the UI,
  // the API, a future import job - and not only where someone remembered to check.
  function verify(e, actor, at, note) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status !== "submitted") throw err("pglog_not_submitted");
    if (!trim(actor)) throw err("pglog_actor_required");
    if (sameActor(actor, e.createdBy)) throw err("pglog_self_verify_forbidden");
    var out = pushHistory(e, { at: at, by: actor, action: "verify", from: e.status, to: "verified", reason: clampStr(note, 500) });
    out.status = "verified";
    out.verifiedBy = clampStr(actor, 120);
    out.verifiedAt = at;
    out.updatedAt = at;
    return out;
  }

  // RULE 2. A return must say what to correct - otherwise the resident is told "wrong" and nothing else.
  function returnEntry(e, actor, at, reason) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status !== "submitted") throw err("pglog_not_submitted");
    if (!trim(actor)) throw err("pglog_actor_required");
    if (sameActor(actor, e.createdBy)) throw err("pglog_self_verify_forbidden");
    if (!trim(reason)) throw err("pglog_return_reason_required");
    var out = pushHistory(e, { at: at, by: actor, action: "return", from: e.status, to: "returned", reason: clampStr(reason, 500) });
    out.status = "returned";
    out.returnedBy = clampStr(actor, 120);
    out.returnedAt = at;
    out.returnReason = clampStr(reason, 500);
    out.updatedAt = at;
    return out;
  }

  // Identity comparison tolerant of the app's namespacing ("fb:<uid>" vs "<uid>"), the same
  // normalisation functions/_taskpush.js rawUid() does. Getting this wrong would silently DISABLE the
  // self-verify guard, so it is one function used by every check.
  function sameActor(a, b) {
    var x = trim(a).toLowerCase().replace(/^(fb:|ghis:|cfa:)/, "");
    var y = trim(b).toLowerCase().replace(/^(fb:|ghis:|cfa:)/, "");
    return !!x && x === y;
  }

  /* RULE 3. A verified entry is never edited in place — the whole point of the audit trail.
   *
   * AND a SUBMITTED entry is not editable either. It is sitting in a named faculty member's queue;
   * letting it change underneath them means they can sign a document different from the one they
   * read, which is the §9.2(c) failure mode with extra steps. The author withdraws it to a draft
   * first (withdraw()), which is visible in history and pulls it out of the verifier's queue.
   * (R1, finding I2.) */
  function applyEdit(e, patch, actor, at) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status === "verified") throw err("pglog_verified_immutable");
    if (e.status === "submitted") throw err("pglog_submitted_withdraw_first");
    var merged = entry(Object.assign({}, e, patch || {}, {
      // never patchable from the outside
      id: e.id, kind: e.kind, residentId: e.residentId, programmeId: e.programmeId, orgId: e.orgId,
      status: e.status, createdBy: e.createdBy, createdAt: e.createdAt,
      submittedAt: e.submittedAt, verifiedBy: e.verifiedBy, verifiedAt: e.verifiedAt,
      history: e.history, revisions: e.revisions, deleted: e.deleted
    }));
    var out = pushHistory(merged, { at: at, by: actor, action: "edit", from: e.status, to: e.status, reason: changedFields(e, merged).join(",") });
    out.updatedAt = at;
    return out;
  }

  // Pull a submitted entry back out of the verifier's queue so it can be corrected. Only the author
  // may do this, and it is recorded — a verifier who had already opened it sees it disappear with a
  // reason, rather than silently mutating in front of them.
  function withdraw(e, actor, at, reason) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status !== "submitted") throw err("pglog_not_submitted");
    if (!sameActor(actor, e.createdBy)) throw err("pglog_not_author");
    var out = pushHistory(e, { at: at, by: actor, action: "withdraw", from: "submitted", to: "draft", reason: clampStr(reason, 300) });
    out.status = "draft";
    out.submittedAt = 0;
    out.updatedAt = at;
    return out;
  }

  // RULE 4. Authorised correction of a VERIFIED record: snapshot the whole prior document into
  // revisions[], then apply the change and send it back for verification. The verified original is
  // preserved in full - it is not summarised, diffed or dropped.
  function amend(e, patch, actor, at, reason) {
    if (e.deleted) throw err("pglog_deleted");
    if (e.status !== "verified") throw err("pglog_amend_only_verified");
    if (!trim(reason)) throw err("pglog_amend_reason_required");
    var snapshot = clone(e);
    delete snapshot.revisions;                       // revisions are not nested inside revisions
    var merged = entry(Object.assign({}, e, patch || {}, {
      id: e.id, kind: e.kind, residentId: e.residentId, programmeId: e.programmeId, orgId: e.orgId,
      createdBy: e.createdBy, createdAt: e.createdAt, history: e.history, revisions: e.revisions
    }));
    var out = pushHistory(merged, {
      at: at, by: actor, action: "amend", from: "verified", to: "submitted", reason: clampStr(reason, 500)
    });
    var allRev = arr(e.revisions).concat([{
      at: at, by: clampStr(actor, 120), reason: clampStr(reason, 500),
      wasVerifiedBy: e.verifiedBy, wasVerifiedAt: e.verifiedAt, doc: snapshot
    }]);
    out.overflowedRevisions = num(e.overflowedRevisions, 0) + Math.max(0, allRev.length - REVISION_CAP);
    out.revisions = allRev.slice(-REVISION_CAP);
    out.status = "submitted";
    out.submittedAt = at;
    out.verifiedBy = ""; out.verifiedAt = 0;
    out.updatedAt = at;
    return out;
  }

  // RULE 5. Soft delete, never hard, and never on a verified record.
  function softDelete(e, actor, at, reason) {
    if (e.status === "verified") throw err("pglog_verified_immutable");
    if (!trim(reason)) throw err("pglog_delete_reason_required");
    var out = pushHistory(e, { at: at, by: actor, action: "delete", from: e.status, to: "deleted", reason: clampStr(reason, 300) });
    out.deleted = true;
    out.deletedBy = clampStr(actor, 120);
    out.deletedAt = at;
    out.deleteReason = clampStr(reason, 300);
    out.updatedAt = at;
    return out;
  }

  function changedFields(a, b) {
    var out = [], k;
    for (k in b) {
      if (k === "history" || k === "revisions" || k === "updatedAt") continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
    }
    return out.slice(0, 20);
  }

  /* ── assessments ─────────────────────────────────────────────────────────────
   * Templates come from pglog/assessment-templates.json (sourced from the NMC curricula's own
   * proformas - see the requirements doc section 2.4). Scoring is here so it is testable and so the
   * same total is computed on the phone and on the server. */
  function assessment(o) {
    o = o || {}; requireId(o, "assessment");
    return {
      id: clampStr(o.id, 80),
      v: VERSION,
      residentId: clampStr(o.residentId, 80),
      programmeId: clampStr(o.programmeId, 80),
      orgId: clampStr(o.orgId, 80),
      templateId: clampStr(o.templateId, 80),
      entryId: clampStr(o.entryId, 80),                 // the activity assessed, when there is one
      rotationId: clampStr(o.rotationId, 80),
      period: clampStr(o.period, 16),                   // YYYY-MM or YYYY-Qn for periodic appraisals
      scores: scoreMap(o.scores),
      logbookScore: o.logbookScore == null ? null : num(o.logbookScore, 0),
      total: num(o.total, 0),
      maxTotal: num(o.maxTotal, 0),
      feedback: clampStr(o.feedback, 3000),
      strengths: clampStr(o.strengths, 1000),
      improvements: clampStr(o.improvements, 1000),
      outcome: oneOf(ASSESSMENT_OUTCOMES, o.outcome, "satisfactory"),
      actionPlan: clampStr(o.actionPlan, 2000),
      reassessmentDue: isoDate(o.reassessmentDue),
      reassessmentOf: clampStr(o.reassessmentOf, 80),
      // MD General Medicine's appraisal form asks this literally: "Has this assessment been discussed
      // with the trainee? Yes/No". An assessment the trainee never saw is not feedback.
      discussedWithTrainee: o.discussedWithTrainee === true ? true : (o.discussedWithTrainee === false ? false : null),
      assessor: clampStr(o.assessor, 120),
      assessedAt: num(o.assessedAt, 0),
      status: oneOf(ASSESSMENT_STATUSES, o.status, "draft"),
      signedBy: clampStr(o.signedBy, 120),
      signedAt: num(o.signedAt, 0),
      history: arr(o.history).slice(-100).map(historyRow),
      createdAt: num(o.createdAt, 0)
    };
  }
  function scoreMap(m) {
    var out = {};
    Object.keys(m || {}).slice(0, 40).forEach(function (k) {
      var v = Number(m[k]);
      if (isFinite(v)) out[clampStr(k, 60)] = v;
    });
    return out;
  }
  // Score an assessment against its template. Returns { total, maxTotal, criteriaTotal, criteriaMax,
  // missing[] }. `missing` is why a template with an unscored criterion cannot be completed - a
  // partially-scored DOPS that silently totals as if the blanks were zero is a false record.
  function scoreAssessment(a, template) {
    template = template || {};
    var crit = arr(template.criteria), max = num(template.scaleMax, 5);
    var missing = [], sum = 0;
    crit.forEach(function (c) {
      var key = c && c.key;
      if (!key) return;
      var v = a && a.scores ? a.scores[key] : undefined;
      if (v == null || !isFinite(Number(v))) { missing.push(key); return; }
      sum += Math.max(num(template.scaleMin, 0), Math.min(max, Number(v)));
    });
    var criteriaMax = crit.length * max;
    var lbMax = num(template.logbookMax, 0);
    var lb = a && a.logbookScore != null ? Math.max(0, Math.min(lbMax, num(a.logbookScore, 0))) : 0;
    if (lbMax > 0 && (!a || a.logbookScore == null)) missing.push("logbook");
    return {
      criteriaTotal: sum, criteriaMax: criteriaMax,
      logbookScore: lb, logbookMax: lbMax,
      // A template the NMC prints with no total row reports none. The per-element ratings ARE the
      // record; a synthesised sum would be a mark the form does not have. (R1, finding I5.)
      noTotal: !!template.noTotal,
      total: template.noTotal ? null : sum + lb,
      maxTotal: template.noTotal ? null : criteriaMax + lbMax,
      missing: missing
    };
  }
  // RULE 6. An assessor may not assess themselves.
  function assess(a, actor, at, template) {
    if (!trim(actor)) throw err("pglog_actor_required");
    if (sameActor(actor, a.residentUid || "")) throw err("pglog_self_assess_forbidden");
    var sc = scoreAssessment(a, template);
    if (sc.missing.length) throw err("pglog_assessment_incomplete", sc.missing.join(","));
    if (a.discussedWithTrainee == null && template && template.requireDiscussed) {
      throw err("pglog_discussed_required");
    }
    var out = clone(a);
    out.total = sc.total == null ? 0 : sc.total;
    out.maxTotal = sc.maxTotal == null ? 0 : sc.maxTotal;   // 0 = "this form has no total"
    out.assessor = clampStr(actor, 120);
    out.assessedAt = at;
    // An outcome of "remediation" opens the remediation arm rather than closing the assessment.
    out.status = out.outcome === "remediation" ? "remediation_plan" : "completed";
    out.history = arr(out.history).concat([historyRow({ at: at, by: actor, action: "assess", to: out.status })]).slice(-100);
    if (out.status === "remediation_plan" && !trim(out.actionPlan)) throw err("pglog_action_plan_required");
    return out;
  }
  function signAssessment(a, actor, at) {
    if (a.status === "signed") throw err("pglog_already_signed");
    if (a.status === "draft") throw err("pglog_assessment_incomplete");
    var out = clone(a);
    out.status = "signed"; out.signedBy = clampStr(actor, 120); out.signedAt = at;
    out.history = arr(out.history).concat([historyRow({ at: at, by: actor, action: "sign", to: "signed" })]).slice(-100);
    return out;
  }

  /* ── attestation (PGMER-2023 5.2(vii)) ────────────────────────────────────────
   * "The record (Log) books shall be checked, assessed and authenticated MONTHLY by the postgraduate
   * guide imparting the training." The clause's unit is the month, so this is a first-class object -
   * a per-entry tick does not satisfy it and does not produce the artefact an examiner asks for. */
  function attestationId(residentId, kind, period) {
    return clampStr(residentId, 80) + "__" + oneOf(ATTESTATION_KINDS, kind, "monthly") + "__" + clampStr(period || "final", 16);
  }
  function attestation(o) {
    o = o || {};
    var kind = oneOf(ATTESTATION_KINDS, o.kind, "monthly");
    return {
      id: clampStr(o.id || attestationId(o.residentId, kind, o.period), 200),
      v: VERSION,
      kind: kind,
      residentId: clampStr(o.residentId, 80),
      programmeId: clampStr(o.programmeId, 80),
      orgId: clampStr(o.orgId, 80),
      period: clampStr(o.period, 16),                  // YYYY-MM for monthly; "" for the final ones
      entryIds: strArr(o.entryIds, 2000),
      counts: countsOf(o.counts),
      note: clampStr(o.note, 1000),
      attestedBy: clampStr(o.attestedBy, 120),
      attestedRole: clampStr(o.attestedRole, 40),
      attestedAt: num(o.attestedAt, 0),
      createdAt: num(o.createdAt, 0)
    };
  }
  function countsOf(c) {
    var out = {};
    ENTRY_KINDS.forEach(function (k) { out[k] = posInt(c && c[k], 0) || 0; });
    out.verified = posInt(c && c.verified, 0) || 0;
    out.total = posInt(c && c.total, 0) || 0;
    return out;
  }
  // The months a resident's training spans, oldest first, as "YYYY-MM".
  function monthsInRange(startIso, endIso) {
    var out = [], m = monthKey(startIso), last = monthKey(endIso);
    if (!m || !last) return out;
    var guard = 0;
    while (m <= last && guard++ < 240) { out.push(m); m = monthKey(addMonths(m + "-01", 1)); }
    return out;
  }
  // Which months are missing their guide authentication, and which of those are past the grace period.
  function attestationStatus(res, entries, attestations, ctx) {
    ctx = ctx || {};
    var today = ctx.today || isoDate(ctx.now || Date.now());
    var grace = posInt(ctx.attestationGraceDays, 7);
    var have = {};
    arr(attestations).forEach(function (a) { if (a && a.kind === "monthly" && a.attestedAt) have[a.period] = a; });
    var byMonth = {};
    arr(entries).forEach(function (e) {
      if (!e || e.deleted || e.kind === "attendance") return;
      var mk = monthKey(e.occurredAt); if (!mk) return;
      byMonth[mk] = (byMonth[mk] || 0) + 1;
    });
    var end = res && res.endDate && daysBetween(res.endDate, today) > 0 ? res.endDate : today;
    var months = monthsInRange(res && res.startDate, end);
    var out = [];
    months.forEach(function (mk) {
      var monthEnd = addDays(addMonths(mk + "-01", 1), -1);
      var closed = daysBetween(monthEnd, today) > 0;
      var overdue = closed && daysBetween(monthEnd, today) > grace;
      out.push({
        period: mk, entries: byMonth[mk] || 0,
        attested: !!have[mk], attestedAt: have[mk] ? have[mk].attestedAt : 0,
        attestedBy: have[mk] ? have[mk].attestedBy : "",
        closed: closed,
        overdue: !have[mk] && overdue && (byMonth[mk] || 0) > 0
      });
    });
    return out;
  }

  /* ── the progress engine ─────────────────────────────────────────────────────
   * A requirement is { id, kind, label, target|null, per, source, clause, ... } from a curriculum
   * pack. Two shapes, because that is how the NMC documents state them:
   *
   *   ABSOLUTE   target: 100, per: "course"   ("Tracheal intubation (100)")
   *   CADENCE    target: 1,   per: "week"     ("Journal club: Minimum of once in 1-2 weeks")
   *
   * and a third, which is the honest one and the most common:
   *
   *   UNSPECIFIED target: null                ("a specified number of cases" - specified by the dept)
   *
   * An unspecified requirement COUNTS and never shows a denominator. Inventing a target there would
   * be exactly the thing the brief forbids.
   *
   * ONLY VERIFIED ENTRIES COUNT toward progress. A resident cannot advance their own progress bar by
   * logging; a faculty member advancing it is the point of 5.2(vii). Submitted-but-unverified work is
   * reported separately as `pending` so the resident can see it is not lost. */

  var PER_DAYS = { day: 1, week: 7, fortnight: 14, month: 30.4375, quarter: 91.3125, semester: 182.625, year: 365.25 };

  /* How much of a requirement should be done BY NOW.
   *
   * For a cadence ("once a fortnight") this is arithmetic on elapsed time and is well defined.
   *
   * For a WHOLE-COURSE target ("Tracheal intubation (100)") it is not: the regulation says 100 by the
   * end of training and says nothing about the rate. The first version returned the full target from
   * day one, so a resident three days into residency was shown 72 high-severity gaps and told about
   * 100 intubations were "expected by now" (R1, finding C3). That number came from nowhere.
   *
   * So a whole-course target is now prorated against the programme's own length when that is known,
   * and returns null when it is not — no expectation is better than an invented one. */
  function expectedToDate(req, elapsedDays, programmeDays) {
    if (!req || req.target == null) return null;
    var per = req.per || "course";
    if (per === "course") {
      var total = posInt(programmeDays, 0);
      if (!total) return null;                       // unknown programme length -> no expectation
      return Math.floor((Math.min(total, Math.max(0, elapsedDays)) / total) * req.target);
    }
    var d = PER_DAYS[per];
    if (!d) return null;
    return Math.floor((Math.max(0, elapsedDays) / d) * req.target);
  }

  // Does an entry satisfy this requirement? Explicit link first (requirementIds, which is how a
  // resident or the mapper attaches it), then the requirement's own matcher.
  function entryMatches(e, req) {
    if (!e || !req || e.deleted) return false;
    if (arr(e.requirementIds).indexOf(req.id) > -1) return true;
    if (req.kind && e.kind !== req.kind) return false;
    var m = req.match || {};
    if (m.academicType && e.academicType !== m.academicType) return false;
    if (m.setting && e.setting !== m.setting) return false;
    if (m.subtype && e.subtype !== m.subtype) return false;
    if (m.procedureId && e.procedureId !== m.procedureId) return false;
    if (m.roles && m.roles.indexOf(e.role) < 0) return false;
    if (m.scope && e.scope !== m.scope) return false;
    // A matcher with no discriminator at all would silently match every entry of the kind, which is
    // how a "target 100" requirement quietly reports itself complete. Require at least one.
    if (!m.academicType && !m.setting && !m.subtype && !m.procedureId && !m.roles && !m.scope) return false;
    return true;
  }

  function progressFor(req, entries, ctx) {
    ctx = ctx || {};
    var elapsed = ctx.elapsedDays == null ? daysBetween(ctx.programmeStart, ctx.today) : ctx.elapsedDays;
    // The programme's full length in days, so a whole-course target can be prorated rather than
    // demanded on day one. Derived from durationMonths when the caller passes the programme.
    var programmeDays = posInt(ctx.programmeDays, 0) ||
      (ctx.programme && posInt(ctx.programme.durationMonths, 0) ? Math.round(posInt(ctx.programme.durationMonths, 36) * 30.4375) : 0);
    var done = 0, pending = 0, lastAt = "";
    arr(entries).forEach(function (e) {
      if (!entryMatches(e, req)) return;
      if (e.status === "verified") {
        done++;
        if (!lastAt || daysBetween(lastAt, e.occurredAt) > 0) lastAt = e.occurredAt;
      } else if (e.status === "submitted") pending++;
    });
    var expected = expectedToDate(req, elapsed, programmeDays);
    var out = {
      requirementId: req.id, label: req.label, kind: req.kind,
      target: req.target == null ? null : req.target,
      per: req.per || "course",
      done: done, pending: pending, expected: expected,
      lastAt: lastAt,
      source: req.source || "unspecified", clause: req.clause || "",
      mandatoryForExam: !!req.mandatoryForExam,
      anyOf: arr(req.anyOf)
    };
    if (req.target == null) { out.state = "counted"; out.pct = null; return out; }
    if (req.per && req.per !== "course") {
      // Cadence: measure against what should have happened BY NOW, not against the whole course.
      out.pct = expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : (done > 0 ? 100 : null);
      out.state = expected <= 0 ? "not_started" : (done >= expected ? "on_track" : (done >= expected * 0.7 ? "slightly_behind" : "behind"));
      return out;
    }
    out.pct = req.target > 0 ? Math.min(100, Math.round((done / req.target) * 100)) : null;
    // With no expectation to measure against (programme length unknown), a resident who has not
    // finished is "in progress", NOT "behind". Calling them behind would be a claim we cannot make.
    out.state = done >= req.target ? "met"
      : (expected == null ? "in_progress" : (done >= expected ? "on_track" : "behind"));
    return out;
  }

  function progress(requirements, entries, ctx) {
    return arr(requirements).map(function (r) { return progressFor(r, entries, ctx); });
  }

  // The gaps a resident (and their faculty) should act on. Pure - no AI anywhere near this.
  function gaps(requirements, entries, ctx) {
    var rows = progress(requirements, entries, ctx);
    var out = [];
    rows.forEach(function (p) {
      // No expectation -> no gap. A gap is a claim that the resident should have done more BY NOW,
      // and without a rate there is nothing to base that on.
      if (p.expected == null) return;
      if (p.state === "behind" || p.state === "slightly_behind") {
        out.push({
          requirementId: p.requirementId, label: p.label, severity: p.state === "behind" ? "high" : "medium",
          done: p.done, expected: p.expected, target: p.target,
          message: p.target == null ? "" :
            (p.per === "course"
              ? p.done + " of " + p.target + " logged and verified" + (p.expected != null ? " (about " + p.expected + " expected by now)" : "")
              : p.done + " logged and verified, about " + p.expected + " expected by now"),
          source: p.source, clause: p.clause
        });
      }
    });
    return out.sort(function (a, b) { return (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1); });
  }

  /* ── weekly cadence (PGMER-2023 5.2(vi)) ──────────────────────────────────────
   * "a dynamic e-log book which needs to be updated on WEEKLY basis". This measures the clause
   * literally: ISO weeks from the start of training to today, and which of them have no entry.
   * An entry counts toward its OCCURRED week, and separately we track the week it was CREATED in, so
   * the "entries must be done in real time" line from the curricula is measurable too. */
  function weeklyCadence(entries, startIso, todayIso) {
    var start = isoDate(startIso), today = isoDate(todayIso);
    if (!start || !today || daysBetween(start, today) < 0) return { weeks: 0, logged: 0, missed: [], pct: null, streak: 0 };
    var byWeek = {};
    arr(entries).forEach(function (e) {
      if (!e || e.deleted || e.kind === "attendance") return;
      var wk = weekKey(e.occurredAt); if (wk) byWeek[wk] = (byWeek[wk] || 0) + 1;
    });
    var weeks = [], cur = start, guard = 0;
    while (daysBetween(cur, today) >= 0 && guard++ < 600) { weeks.push(weekKey(cur)); cur = addDays(cur, 7); }
    var seen = {}, ordered = [];
    weeks.forEach(function (w) { if (w && !seen[w]) { seen[w] = 1; ordered.push(w); } });
    var missed = ordered.filter(function (w) { return !byWeek[w]; });
    // Trailing streak of consecutive logged weeks (most recent first), excluding the current week if
    // it is still open - a resident is not "behind" on a week that has not ended.
    var streak = 0;
    for (var i = ordered.length - 1; i >= 0; i--) { if (byWeek[ordered[i]]) streak++; else break; }
    return {
      weeks: ordered.length,
      logged: ordered.length - missed.length,
      missed: missed,
      pct: ordered.length ? Math.round(((ordered.length - missed.length) / ordered.length) * 100) : null,
      streak: streak,
      source: "nmc_regulation", clause: "5.2(vi)"
    };
  }

  // "The log book entries must be done in real time" (2022-revised curricula, section J). Late
  // logging is made VISIBLE rather than blocked - a resident on nights logging three days later is
  // still telling the truth, and refusing the entry would lose the record entirely.
  function latencyDays(e) {
    if (!e || !e.createdAt || !e.occurredAt) return null;
    return Math.max(0, daysBetween(e.occurredAt, isoDate(e.createdAt)));
  }

  /* ── attendance (PGMER-2023 5.5 + PGMEB FAQ 10.04.2024) ──────────────────────
   * THE DENOMINATOR IS WORKING DAYS, AND THIS MODULE HAD IT WRONG UNTIL 2026-08-27.
   *
   * PGMER-2023 5.5 gives only a percentage ("80% of the attendance"). The PGMEB FAQ of 10.04.2024 —
   * a PRIMARY source, obtained 2026-08-27, checked into pglog-sources/PGMEB-FAQ-2024-04-10.txt —
   * defines what that percentage is OF, verbatim:
   *
   *   "For Three-Year Course: Total days in a three-year course will be 1095 days. So the total
   *    working days will be 939 days after deducting weekly offs (52 x 3 years = 156 days). A
   *    student will require 80 per cent attendance of working days (i.e. 751 days of 939 days) for
   *    appearing in the examination."
   *
   * So: WORKING DAYS = calendar days - weekly offs (52/yr), and the threshold is 80% OF THAT.
   * The earlier implementation computed a percentage of the days the resident happened to have
   * RECORDED, and a second one of elapsed CALENDAR days. Neither is the FAQ's definition, and the
   * first is worse than wrong - it flatters, because a resident who records only the days they were
   * present scores 100%.
   *
   * The FAQ also settles two things the module had been guessing at:
   *   - "Five days Academic Leave per year, if availed by a student WILL BE COUNTED AS DUTY."
   *   - maternity/paternity leave and EXCESS casual leave do not reduce the percentage; they
   *     "extend the period of training by the same number of days" (see termExtensionDays()).
   *
   * Nothing here declares anyone exam-ineligible. It reports the number and says whose rule it is. */

  // Derived from the FAQ's own arithmetic, not hard-coded from its answer: 52 weekly offs a year.
  var WEEKLY_OFFS_PER_YEAR = 52;
  // Working days and the 80% threshold for a course of N months. Returns the FAQ's own figures for
  // the two courses it works through (36 mo -> 939/751, 24 mo -> 626/501) because it uses the same
  // arithmetic, which is the point: the constants are reproduced, not copied.
  function workingDays(durationMonths) {
    var months = posInt(durationMonths, 36);
    var years = months / 12;
    var calendar = Math.round(years * 365);
    var offs = Math.round(years * WEEKLY_OFFS_PER_YEAR);
    return { calendarDays: calendar, weeklyOffs: offs, workingDays: calendar - offs };
  }
  function requiredAttendanceDays(durationMonths, pct) {
    var w = workingDays(durationMonths);
    return Math.round(w.workingDays * (num(pct, 80) / 100));
  }
  function expandAttendance(entries) {
    var out = [];
    arr(entries).forEach(function (e) {
      if (!e || e.deleted || e.kind !== "attendance") return;
      var from = e.occurredAt, to = e.endDate || e.occurredAt;
      var n = Math.max(0, daysBetween(from, to));
      if (n > 366) n = 366;
      for (var i = 0; i <= n; i++) out.push({ date: addDays(from, i), state: e.state, status: e.status, id: e.id });
    });
    // Last write wins per day, so correcting a day does not double-count it.
    var byDay = {};
    out.forEach(function (r) { byDay[r.date] = r; });
    return Object.keys(byDay).sort().map(function (d) { return byDay[d]; });
  }
  // The days a resident's training was EXTENDED by, per the FAQ: maternity/paternity leave, and
  // casual leave taken in excess of the 20 days a year 5.5(a) grants. This does NOT reduce the
  // attendance percentage — it moves the end of training.
  function termExtensionDays(entries, ctx) {
    ctx = ctx || {};
    var rows = expandAttendance(entries);
    var mat = 0, pat = 0, casual = 0;
    rows.forEach(function (r) {
      if (r.state === "leave_maternity") mat++;
      else if (r.state === "leave_paternity") pat++;
      else if (r.state === "leave_paid") casual++;
    });
    var years = Math.max(1, posInt(ctx.durationMonths, 36) / 12);
    var casualAllowance = Math.round(num(ctx.casualLeavePerYear, 20) * years);
    var excessCasual = Math.max(0, casual - casualAllowance);
    return {
      maternity: mat, paternity: pat,
      casualTaken: casual, casualAllowance: casualAllowance, excessCasual: excessCasual,
      totalDays: mat + pat + excessCasual,
      source: "nmc_faq", clause: "PGMEB FAQ 10.04.2024, Q1 and Q2",
      note: "Maternity/paternity leave and casual leave taken in excess of the annual allowance " +
        "extend the period of training by the same number of days. They do not reduce the " +
        "attendance percentage."
    };
  }

  function attendanceSummary(entries, ctx) {
    ctx = ctx || {};
    var rows = expandAttendance(entries);
    var cmap = attendanceCounts(ctx.attendanceCounts);
    var counts = {}; ATTENDANCE_STATES.forEach(function (k) { counts[k] = 0; });
    var attended = 0, recorded = 0;
    rows.forEach(function (r) {
      counts[r.state] = (counts[r.state] || 0) + 1;
      if (r.state !== "holiday") recorded++;
      attended += cmap[r.state] || 0;
    });
    var start = isoDate(ctx.programmeStart), today = isoDate(ctx.today);
    var elapsed = start && today ? Math.max(0, daysBetween(start, today) + 1) : 0;
    // THE FAQ'S DENOMINATOR. Working days elapsed so far = calendar days elapsed minus the weekly
    // offs in that period. This is what the 80% is a percentage OF.
    var offsElapsed = Math.round((elapsed / 365) * WEEKLY_OFFS_PER_YEAR);
    var workingElapsed = Math.max(0, elapsed - offsElapsed);
    var course = workingDays(ctx.durationMonths);
    var requiredDays = requiredAttendanceDays(ctx.durationMonths, ctx.attendancePct);
    var courseDays = posInt(ctx.courseDays, 0) || requiredDays;
    return {
      recordedDays: recorded,
      attendedDays: attended,
      counts: counts,
      elapsedDays: elapsed,
      // THE ONE THAT MATTERS: attendance as a percentage of WORKING days elapsed, which is the
      // PGMEB FAQ's definition. Null until there are working days to measure against.
      workingDaysElapsed: workingElapsed,
      // Capped at 100: a resident who logs "present" on a weekly off produces more attended days
      // than working days, and a 111% attendance figure on an examiner-facing report reads as a bug.
      // attendedDays and workingDaysElapsed are both exposed raw so the reader can see 10 of 9, and
      // exceedsWorkingDays flags it rather than hiding it.
      pctOfWorkingDays: workingElapsed ? Math.min(100, Math.round((attended / workingElapsed) * 100)) : null,
      exceedsWorkingDays: workingElapsed ? attended > workingElapsed : false,
      // The whole course, for the "751 of 939" view the FAQ states directly.
      courseCalendarDays: course.calendarDays,
      courseWeeklyOffs: course.weeklyOffs,
      courseWorkingDays: course.workingDays,
      requiredDays: requiredDays,
      // Kept for continuity and shown as SECONDARY readings, clearly labelled. pctOfRecorded in
      // particular FLATTERS - a resident who records only the days they were present scores 100% -
      // so it is never the headline number.
      pctOfRecorded: recorded ? Math.round((attended / recorded) * 100) : null,
      pctOfElapsed: elapsed ? Math.round((attended / elapsed) * 100) : null,
      thresholdPct: num(ctx.attendancePct, 80),
      thresholdPctSource: "nmc_regulation",           // PGMER-2023 5.5 states the 80% itself
      thresholdDays: courseDays,
      // PRIMARY now: the PGMEB FAQ PDF was obtained on 2026-08-27 (pglog-sources/). It was carried
      // as nmc_faq_secondary while it was known only from news coverage of the notice.
      thresholdDaysSource: ctx.attendanceDaysSource || "nmc_faq",
      // WHICH DAYS COUNT is institutional, and is reported separately from the threshold so a local
      // interpretation can never be read as the gazette's. attendanceCounts is the map that was
      // actually applied, so a report can print it.
      attendanceCounts: cmap,
      interpretationSource: "institution",
      interpretationCustomised: attendanceCountsCustomised(ctx.attendanceCounts),
      // Measured against WORKING days, per the FAQ. Null while there is nothing to measure.
      meetsPct: workingElapsed ? (attended / workingElapsed) * 100 >= num(ctx.attendancePct, 80) : null,
      meetsDays: requiredDays ? attended >= requiredDays : null,
      termExtension: termExtensionDays(entries, ctx),
      note: "PGMER-2023 5.5 states the 80% figure; the PGMEB FAQ of 10.04.2024 defines what it is a " +
        "percentage OF: WORKING days, i.e. calendar days minus 52 weekly offs a year (939 working " +
        "days in a three-year course, of which 80% is 751). Academic leave is counted as duty by " +
        "the FAQ's own words. Maternity/paternity leave and excess casual leave do not reduce the " +
        "percentage - they extend the period of training by the same number of days."
    };
  }

  /* ── exam eligibility ────────────────────────────────────────────────────────
   * A CHECKLIST, never a verdict. Each row says which source imposes it. The module does not, and
   * must not, declare a resident eligible or ineligible to sit an examination - that is the
   * University's and the institution's decision. */
  function examEligibility(ctx) {
    ctx = ctx || {};
    var entries = arr(ctx.entries).filter(function (e) { return e && !e.deleted && e.status === "verified"; });
    var rows = [];
    function has(fn) { return entries.some(fn); }

    // PGMER-2023 5.2(xi)-(c): the three mandatory first-year courses.
    var certLabel = { research_methodology: "Research Methodology course", ethics_gcp_glp: "Ethics / GCP / GLP course", bcls_acls: "BCLS + ACLS certification" };
    CERTIFICATIONS.forEach(function (c) {
      rows.push({
        key: "cert_" + c, label: certLabel[c],
        met: has(function (e) { return e.kind === "certification" && e.subtype === c; }),
        source: "nmc_regulation", clause: "5.2(xi)"
      });
    });

    // PGMER-2023 5.2(x): poster OR paper read at a conference OR first-author publication. A real OR,
    // shown as ONE row - splitting it into three would misstate the regulation as three requirements.
    var poster = has(function (e) { return e.kind === "research" && e.subtype === "poster"; });
    var paper = has(function (e) { return e.kind === "research" && e.subtype === "conference_paper"; });
    var pub = has(function (e) { return e.kind === "research" && e.subtype === "publication" && e.firstAuthor; });
    rows.push({
      key: "dissemination",
      label: "One poster presentation, or one paper read at a national/zonal/state conference, or one first-author paper published/accepted",
      met: poster || paper || pub,
      via: poster ? "poster" : paper ? "conference_paper" : pub ? "publication" : "",
      source: "nmc_regulation", clause: "5.2(x)"
    });

    // PGMER-2023 5.2(xv)VIII(c): satisfactory completion of the District Residency.
    if (ctx.programme && ctx.programme.programmeType === "PG" && (ctx.programme.degree === "MD" || ctx.programme.degree === "MS" || ctx.programme.degree === "Diploma")) {
      var months = drpMonths(ctx.rotations);
      rows.push({
        key: "drp",
        label: "District Residency Programme (3 months) completed",
        met: arr(ctx.rotations).some(function (r) { return r && r.kind === "drp" && r.status === "completed"; }) && drpMeetsThreeMonths(ctx.rotations),
        detail: months ? months.toFixed(1) + " months (" + drpDays(ctx.rotations) + " days) recorded; three calendar months is at least " + DRP_MIN_DAYS + " days" : "",
        source: "nmc_regulation", clause: "5.2(xv)V, VIII(c)"
      });
    }

    // PGMER-2023 5.5: the attendance threshold. Reported, never adjudicated.
    if (ctx.attendance) {
      rows.push({
        key: "attendance",
        label: "80% attendance",
        met: ctx.attendance.meetsPct,
        detail: ctx.attendance.pctOfRecorded == null ? "no attendance recorded yet" : ctx.attendance.pctOfRecorded + "% of recorded days",
        source: "nmc_regulation", clause: "5.5",
        advisory: true
      });
    }

    // Thesis. PGMER-2023 2.2(iii) makes it a curriculum component; the curricula require acceptance
    // before the candidate may sit theory/practical.
    rows.push({
      key: "thesis",
      label: "Thesis submitted and accepted",
      met: has(function (e) { return e.kind === "research" && e.subtype === "thesis_milestone" && e.milestone === "accepted"; }),
      source: "nmc_curriculum", clause: "Summative assessment / Thesis"
    });

    /* Whatever the specialty pack additionally marks mandatoryForExam.
     *
     * A pack requirement may carry `anyOf`: a list of entry shapes, ANY ONE of which satisfies it.
     * MD Paediatrics needs this — its wording is "At least one if not two presentation(s) at
     * national/state level conference. IF NOT PRESENTED AT NATIONAL LEVEL, ALTERNATIVELY, one
     * research paper should be published / accepted in an indexed journal." Modelling that as two
     * separate mandatory rows (which the shared 2022 pack did until R1 finding C4) tells a
     * Paediatrics resident they have two unmet requirements when their curriculum is satisfied. */
    arr(ctx.requirementProgress).forEach(function (p) {
      if (!p.mandatoryForExam) return;
      var met, detail, via = "";
      if (arr(p.anyOf).length) {
        var hit = null;
        arr(p.anyOf).forEach(function (shape) {
          if (hit) return;
          var n = entries.filter(function (e) {
            return Object.keys(shape).every(function (k) { return e[k] === shape[k]; });
          }).length;
          if (n >= (p.target || 1)) hit = shape;
        });
        met = !!hit;
        via = hit ? (hit.subtype || "") : "";
        detail = met ? "satisfied via " + via : "none of the alternatives recorded yet";
      } else {
        met = p.target == null ? p.done > 0 : p.done >= p.target;
        detail = p.target == null ? p.done + " recorded" : p.done + " of " + p.target;
      }
      rows.push({
        key: "req_" + p.requirementId, label: p.label,
        met: met, detail: detail, via: via, source: p.source, clause: p.clause
      });
    });

    var blocking = rows.filter(function (r) { return !r.advisory; });
    return {
      rows: rows,
      metCount: blocking.filter(function (r) { return r.met === true; }).length,
      total: blocking.length,
      // Deliberately NOT called "eligible". This is what the checklist shows; the University decides.
      allChecklistItemsMet: blocking.every(function (r) { return r.met === true; }),
      disclaimer: "This is a checklist of requirements traced to their NMC source. Eligibility to " +
        "appear for the examination is determined by the University and the institution, not by this app."
    };
  }

  /* ── dashboards: the aggregate a resident/faculty/HOD view needs ─────────── */

  function summarise(entries) {
    var out = { total: 0, draft: 0, submitted: 0, verified: 0, returned: 0, byKind: {} };
    ENTRY_KINDS.forEach(function (k) { out.byKind[k] = { total: 0, verified: 0, submitted: 0 }; });
    arr(entries).forEach(function (e) {
      if (!e || e.deleted) return;
      out.total++;
      out[e.status] = (out[e.status] || 0) + 1;
      var b = out.byKind[e.kind]; if (!b) return;
      b.total++;
      if (e.status === "verified") b.verified++;
      if (e.status === "submitted") b.submitted++;
    });
    return out;
  }
  // Pending verifications older than the institution's SLA. CONFIG, labelled as such - NMC gives no
  // per-entry SLA (its only cadence is monthly authentication).
  function overdueVerifications(entries, ctx) {
    ctx = ctx || {};
    var sla = posInt(ctx.verifySlaDays, 7);
    var today = ctx.today || isoDate(ctx.now || Date.now());
    return arr(entries).filter(function (e) {
      if (!e || e.deleted || e.status !== "submitted" || !e.submittedAt) return false;
      return daysBetween(isoDate(e.submittedAt), today) > sla;
    }).map(function (e) {
      return { id: e.id, kind: e.kind, title: e.title || e.procedureText || e.topic || "", residentId: e.residentId,
        supervisor: e.supervisor, days: daysBetween(isoDate(e.submittedAt), today), submittedAt: e.submittedAt };
    }).sort(function (a, b) { return b.days - a.days; });
  }
  // The single number a HOD list sorts on. Blend of verified-requirement progress, weekly cadence and
  // exam-checklist completion, all of which are themselves pure. Explicitly a TRIAGE score for
  // "who needs a conversation", not a grade - it is never shown to the resident as a mark.
  function progressScore(ctx) {
    ctx = ctx || {};
    var rows = arr(ctx.requirementProgress).filter(function (p) { return p.target != null; });
    var reqPct = rows.length
      ? Math.round(rows.reduce(function (a, p) { return a + Math.min(100, p.pct == null ? 0 : p.pct); }, 0) / rows.length)
      : null;
    var wk = ctx.weekly && ctx.weekly.pct != null ? ctx.weekly.pct : null;
    var ex = ctx.eligibility && ctx.eligibility.total ? Math.round((ctx.eligibility.metCount / ctx.eligibility.total) * 100) : null;
    var parts = [reqPct, wk, ex].filter(function (v) { return v != null; });
    if (!parts.length) return null;
    return Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length);
  }

  /* ── exports ─────────────────────────────────────────────────────────────── */

  var API = {
    VERSION: VERSION,
    ENTRY_KINDS: ENTRY_KINDS, CLINICAL_SETTINGS: CLINICAL_SETTINGS, ROLES: ROLES, ROLE_LABEL: ROLE_LABEL,
    ACADEMIC_TYPES: ACADEMIC_TYPES, ACADEMIC_LABEL: ACADEMIC_LABEL, ACADEMIC_SCOPES: ACADEMIC_SCOPES,
    ACADEMIC_ROLES: ACADEMIC_ROLES, RESEARCH_MILESTONES: RESEARCH_MILESTONES,
    RESEARCH_SUBTYPES: RESEARCH_SUBTYPES, CERTIFICATIONS: CERTIFICATIONS,
    ATTENDANCE_STATES: ATTENDANCE_STATES, STATUSES: STATUSES, DEGREES: DEGREES, OUTCOMES: OUTCOMES,
    ASSESSMENT_OUTCOMES: ASSESSMENT_OUTCOMES, ASSESSMENT_STATUSES: ASSESSMENT_STATUSES,
    ATTESTATION_KINDS: ATTESTATION_KINDS, ROTATION_KINDS: ROTATION_KINDS, AGE_BANDS: AGE_BANDS,

    // entities
    programme: programme, pconfig: pconfig, resident: resident, rotation: rotation,
    entry: entry, assessment: assessment, attestation: attestation, attestationId: attestationId,

    // validation + state machine
    validateEntry: validateEntry, requiresProcedureLog: requiresProcedureLog,
    submit: submit, verify: verify, returnEntry: returnEntry, applyEdit: applyEdit,
    amend: amend, softDelete: softDelete, withdraw: withdraw, sameActor: sameActor,
    HISTORY_CAP: HISTORY_CAP, REVISION_CAP: REVISION_CAP,

    // assessment
    scoreAssessment: scoreAssessment, assess: assess, signAssessment: signAssessment,

    // attestation
    attestationStatus: attestationStatus, monthsInRange: monthsInRange,

    // progress
    entryMatches: entryMatches, expectedToDate: expectedToDate, progressFor: progressFor,
    progress: progress, gaps: gaps, weeklyCadence: weeklyCadence, latencyDays: latencyDays,
    expandAttendance: expandAttendance, attendanceSummary: attendanceSummary,
    attendanceCounts: attendanceCounts, attendanceCountsCustomised: attendanceCountsCustomised,
    workingDays: workingDays, requiredAttendanceDays: requiredAttendanceDays,
    termExtensionDays: termExtensionDays, WEEKLY_OFFS_PER_YEAR: WEEKLY_OFFS_PER_YEAR,
    COUNTS_AS_ATTENDED_DEFAULT: COUNTS_AS_ATTENDED_DEFAULT,
    examEligibility: examEligibility, summarise: summarise,
    overdueVerifications: overdueVerifications, progressScore: progressScore,
    trainingYearOn: trainingYearOn, semesterOn: semesterOn, drpWindowOk: drpWindowOk,
    drpMonths: drpMonths, drpDays: drpDays, drpMeetsThreeMonths: drpMeetsThreeMonths, DRP_MIN_DAYS: DRP_MIN_DAYS,

    // privacy + dates (exported because the server and the reports use the same ones)
    sanitizeCaseRef: sanitizeCaseRef, scrubFreeText: scrubFreeText, ageBand: ageBand,
    isoDate: isoDate, daysBetween: daysBetween, addDays: addDays, addMonths: addMonths,
    monthKey: monthKey, weekKey: weekKey, weeksBetween: weeksBetween
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_PGLOG_MODEL = API;
})();
