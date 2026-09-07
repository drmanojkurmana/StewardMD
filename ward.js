/* ward.js - WardSynQ inpatient ward controller (window.WARD).
 *
 * Buildless ES5 IIFE, same shape as queue.js: a self-mounting fixed overlay (#smdWard), a PURE
 * _render(state) -> HTML, one delegated click handler on data-w-act, and the SAME authHeaders /
 * fetchRetry / apiGet / apiPost transport against /api/queue. It talks only to the ward routes,
 * which are already server-authoritative and capability-gated.
 *
 * WHY THIS FILE EXISTS: the whole inpatient vertical - admission, ward list, ward vitals, the eMAR
 * state machine, discharge, the problem list - has been finished and tested on the server for a
 * while, and NOTHING in the app called any of it. It was usable by curl and by nobody else.
 *
 * THREE RULES THIS UI DOES NOT BEND
 *
 * 1. IT NEVER DECIDES A DOSE IS SAFE. There is no client-side safety check here, not even a
 *    convenience one, because a second copy of the rules is how the screen and the server start
 *    disagreeing about whether a drug is contraindicated. The server refuses or it does not.
 *
 * 2. A REFUSAL IS RENDERED VERBATIM. When the eMAR refuses, its `reasons` are the answer - they are
 *    the thing the nurse has to act on. They are shown in full, never collapsed into "failed",
 *    never retried automatically, and the dose does not move.
 *
 * 3. IT NEVER INVENTS A DUE TIME. MAR scheduling does not exist yet: nothing on the server computes
 *    what dose is due when. So the round time is CHOSEN BY THE NURSE and labelled as chosen, rather
 *    than being quietly defaulted to "now" - which would let the chart imply a schedule that no one
 *    ever wrote down.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var API = "/api/queue";
  var LS_STAFF = "smd_opd_staff_tok";

  var st = {
    orgId: "", ward: "", patients: [], view: "list",
    sel: null,                 // the selected {encounterId, patientId, ward, bed, admittedAt}
    problems: [], criticals: [], balance: null, outbox: [], cosign: null, downtime: null, quality: null,
    /* The terminology search: null while it runs, an array once it answers, undefined when nobody has
     * asked. Three states, because "searching" and "no matches" must not look the same. */
    icd: undefined, probText: "", probCode: "",
    templates: [], noteTemplateId: "", noteResult: null, overrides: null,
    due: [], prn: [], unscheduled: [], truncated: false,
    from: "", to: "",          // the window being viewed, NOT a claim about when a dose is due
    busy: false, err: "", note: "", refusal: null, loaded: false
  };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '">' + name + "</span>"; }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }

  // ---- transport (identical to queue.js; a staff token wins when present) -------------------
  function staffTok() { try { return localStorage.getItem(LS_STAFF) || ""; } catch (e) { return ""; } }
  function fbToken() {
    try { if (G.SMD_AUTH && G.SMD_AUTH.token) return Promise.resolve(G.SMD_AUTH.token()); } catch (e) {}
    try { if (G.firebase && firebase.auth && firebase.auth().currentUser) return firebase.auth().currentUser.getIdToken(); } catch (e) {}
    return Promise.resolve(null);
  }
  function authHeaders() {
    var t = staffTok();
    if (t) return Promise.resolve({ "Content-Type": "application/json", "X-Staff-Token": t });
    return fbToken().then(function (t2) { var h = { "Content-Type": "application/json" }; if (t2) h.Authorization = "Bearer " + t2; return h; });
  }
  function fetchRetry(url, opts, tries) {
    tries = tries || 3;
    return fetch(url, opts).catch(function (e) {
      if (tries <= 1) throw e;
      return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return fetchRetry(url, opts, tries - 1); });
    });
  }
  function apiGet(path) { return authHeaders().then(function (h) { return fetchRetry(API + path, { headers: h, credentials: "include" }); }).then(function (r) { return r.json(); }); }
  /* The ICD reference API is public, read-only, non-PHI and lives on its own path. It is fetched
   * separately rather than through apiGet so no patient identifier can ever be sent to it: a
   * terminology lookup that carried the patient it was for would leak a diagnosis to a service that
   * has no business knowing one. */
  function icdSearch(q) {
    return fetchRetry("/api/icd/search?limit=8&q=" + encodeURIComponent(q), { credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.results) || []; });
  }
  function apiPost(path, body) { return authHeaders().then(function (h) { return fetchRetry(API + path, { method: "POST", headers: h, credentials: "include", body: JSON.stringify(body || {}) }); }).then(function (r) { return r.json(); }); }

  /* One place that turns any ward response into what the screen shows. A refusal keeps its reasons;
   * everything else gets the server's own message rather than a rewritten one, because "the ward is
   * only available for a WardSynQ-native hospital" is actionable and "something went wrong" is not. */
  function problem(r) {
    if (!r) return { err: "No response from the server." };
    if (r.ok) return null;
    if (r.error === "refused") return { refusal: { reasons: r.reasons || [], detail: r.detail || "", action: r.action || "" } };
    if (r.error === "governance") return { refusal: { reasons: r.reasons || [], detail: "The record service refused this write.", action: "" } };
    return { err: r.message || r.detail || r.error || "Request failed." };
  }
  function settle(r, okMsg) {
    st.busy = false; st.err = ""; st.refusal = null; st.note = "";
    var p = problem(r);
    if (p) { st.err = p.err || ""; st.refusal = p.refusal || null; }
    else if (okMsg) st.note = okMsg;
    return !p;
  }

  // ---- pure render -------------------------------------------------------------------------
  function when(iso) {
    if (!iso) return "-";
    var d = new Date(iso); if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function dose(d) { return d && d.value != null ? esc(String(d.value) + " " + (d.unit || "")) : ""; }

  /* The eMAR states, and the actions the machine will accept out of each. This mirrors the server's
   * transition table so the screen does not offer a button that is certain to be refused - it is a
   * DISPLAY convenience only. The machine remains the authority: an action shown here can still be
   * refused, and an action hidden here is not thereby permitted.
   *
   * THE KEYS ARE THE STATE MACHINE'S OWN SPELLING, IN LOWER CASE. This map was written in capitals
   * first, which meant every lookup missed and the round rendered no action buttons at all once a
   * dose had any status - the screen would have looked like a ward where nothing could be given.
   * The status is lowercased on the way in so a server that ever changes case cannot silently
   * empty the round again. */
  var NEXT = {
    "": ["verify"],
    ordered: ["verify", "hold", "refuse", "cancel"],
    verified: ["dispense", "hold", "refuse", "cancel"],
    dispensed: ["scan", "hold", "refuse", "cancel"],
    scanned: ["administer", "hold", "refuse"],
    administered: [], held: ["dispense", "refuse", "cancel"], refused: [], cancelled: []
  };
  function nextFor(status) { return NEXT[status == null ? "" : String(status).toLowerCase()] || []; }

  function banner(state) {
    if (state.refusal) {
      var rs = (state.refusal.reasons || []).map(function (r) {
        return "<li>" + esc(typeof r === "string" ? r : (r.code || JSON.stringify(r))) + "</li>";
      }).join("");
      return '<div class="w-refusal">' + ms("gpp_maybe") + "<div><h4>Refused" + (state.refusal.action ? " on " + esc(state.refusal.action) : "") + "</h4>" +
        (rs ? "<ul>" + rs + "</ul>" : "") +
        (state.refusal.detail ? "<p>" + esc(state.refusal.detail) + "</p>" : "") +
        '</div><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    }
    if (state.err) return '<div class="w-err">' + ms("error") + "<p>" + esc(state.err) + '</p><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    if (state.note) return '<div class="w-ok">' + ms("check_circle") + "<p>" + esc(state.note) + '</p><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    return "";
  }

  function listView(state) {
    var rows = (state.patients || []).map(function (p) {
      return '<button class="w-bed" data-w-act="open:' + esc(p.encounterId) + '">' +
        '<span class="w-bed-no">' + esc(p.bed || "-") + "</span>" +
        '<span class="w-bed-b"><b>' + esc(p.patientId) + "</b><small>" + esc(p.ward || "") + " &middot; admitted " + when(p.admittedAt) + "</small></span>" +
        ms("chevron_right") + "</button>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>Ward" + (state.ward ? ": " + esc(state.ward) : "") + "</h3>" +
      '<button class="w-ic" data-w-act="reload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-filter"><input id="wWard" type="text" placeholder="Filter by ward (blank = all)" value="' + esc(state.ward) + '">' +
      '<button class="w-btn ghost" data-w-act="setward">Apply</button>' +
      // Reachable BEFORE an outage, which is the only time it can be taken. A pack you can only get
      // to while the system is up is a pack the ward has to remember to take while the system is up.
      '<button class="w-btn ghost" data-w-act="downtime" title="Printable sheet for when the system is unavailable">' + ms("print") + "Downtime pack</button></div>" +
      (rows || (state.loaded ? '<p class="w-empty">No patients are currently admitted' + (state.ward ? " to " + esc(state.ward) : "") + ".</p>" : '<p class="w-empty">Loading the ward…</p>')) +
      "</div>" + cosignCard(state) + qualityCard(state) + overrideCard(state);
  }

  /* Which safety rules are being clicked through. ALERT FATIGUE IS THE CHARACTERISTIC FAILURE OF
   * CDSS: a rule that fires on every third order and is overridden 98% of the time is not protecting
   * anyone - it is training every clinician in the hospital to click through warnings, including the
   * one that mattered. This report existed on the server from the day override analytics landed and
   * nothing displayed it, which made it evidence nobody could act on.
   *
   * IT IS ABOUT RULES, NEVER ABOUT PEOPLE. No clinician is named or counted, here or on the server.
   * A screen that ranked clinicians by override rate would stop them writing honest rationales, and
   * the rationale is the only thing that makes a bad rule fixable.
   *
   * A RATE WITH NO DENOMINATOR IS NOT A RATE. It shows the count and says the denominator is missing,
   * rather than drawing a bar that looks like a measurement. */
  function overrideCard(state) {
    var rep = state.overrides;
    if (!rep || !(rep.rules || []).length) return "";
    var pct = function (r) { return Math.round(r * 100) + "%"; };

    /* Worst first: the rule overridden most OFTEN, proportionally, is the one to look at. Rules with
     * no rate sort after the ones that have one - they cannot be judged yet, not that they are fine. */
    var rows = (rep.rules || []).slice().sort(function (a, b) {
      if (a.overrideRate === null && b.overrideRate === null) return b.overridden - a.overridden;
      if (a.overrideRate === null) return 1;
      if (b.overrideRate === null) return -1;
      return b.overrideRate - a.overrideRate;
    }).map(function (m) {
      return '<li' + (m.overrideRate !== null && m.overrideRate >= 0.9 ? ' class="hot"' : "") + ">" +
        "<h4>" + esc(m.code) + (m.targetId ? ' <span class="w-code">' + esc(m.targetId) + "</span>" : "") + "</h4>" +
        (m.overrideRate === null
          ? '<div class="w-q-n"><b>' + esc(m.overridden) + "</b><span>overridden &middot; no firing count, so no rate</span></div>"
          : '<div class="w-q-n"><b>' + esc(pct(m.overrideRate)) + "</b><span>" + esc(m.overridden) + " of " + esc(m.fired) + " firings</span></div>") +
        (m.topReason ? '<p class="w-hint">' + ms("info") + "Most given reason: " + esc(m.topReason) + "</p>" : "") +
        (m.overrideRate !== null && m.overrideRate >= 0.9
          ? '<p class="w-hint warn">' + ms("warning") + "Overridden almost every time it fires. A rule like this trains people to click through warnings.</p>"
          : "") +
        "</li>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("rule") + "<h3>Safety rules being overridden</h3>" +
      '<button class="w-ic" data-w-act="overrides" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<ul class="w-q">' + rows + "</ul>" +
      // The server's own sentence, shown verbatim. The conclusion people reach from an override table
      // is usually the wrong one, so it is stated rather than left to be inferred.
      (rep.note ? '<p class="w-hint">' + ms("info") + esc(rep.note) + "</p>" : "") +
      (rep.note2 ? '<p class="w-hint warn">' + ms("warning") + esc(rep.note2) + "</p>" : "") +
      "</div>";
  }

  /* Measures about the SYSTEM, over a period. Never about a person: nothing here is aggregated by
   * clinician, because the moment a number can be attributed to an individual it stops measuring the
   * process and starts managing the staff.
   *
   * The two rules this card exists to keep visible: a rate over too few cases is not shown as a
   * percentage, and a measure the record cannot support is shown WITH its reason rather than left
   * off - a missing row on a dashboard reads as "nothing to report". */
  function qualityCard(state) {
    var q = state.quality;
    if (!q || !(q.measures || []).length) return "";
    var pct = function (r) { return Math.round(r * 100) + "%"; };

    var rows = q.measures.map(function (m) {
      var body = !m.computable
        ? '<p class="w-hint warn">' + ms("help") + esc(m.reason) + "</p>"
        : m.rate === null
          // No cases is not 0% and not 100%. Both of those are how a dashboard lies.
          ? '<p class="w-hint">' + ms("info") + "No cases in this period." + "</p>"
          : '<div class="w-q-n"><b>' + esc(pct(m.rate)) + "</b><span>" + esc(m.numerator) + " of " + esc(m.denominator) + "</span></div>" +
            (m.underpowered ? '<p class="w-hint warn">' + ms("warning") + esc(m.note) + "</p>" : "") +
            (m.neverAcknowledged ? '<p class="w-hint">' + ms("error") + esc(m.neverAcknowledged) + " were never acknowledged at all.</p>" : "") +
            (m.excludedNoDueTime ? '<p class="w-hint">' + ms("info") + esc(m.excludedNoDueTime) + " dose(s) had no recorded due time and are in neither half.</p>" : "");
      return '<li' + (m.computable ? "" : ' class="unavailable"') + "><h4>" + esc(m.title) + "</h4>" + body + "</li>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("query_stats") + "<h3>Measures</h3>" +
      '<button class="w-ic" data-w-act="quality" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<p class="w-hint">' + ms("info") + "Last " + esc(q.period && q.period.days) + " days. These measure the system, not any clinician. Nobody is named or counted.</p>" +
      '<ul class="w-q">' + rows + "</ul>" +
      (q.notComputable ? '<p class="w-hint">' + ms("help") + esc(q.notComputable) + " of these cannot be computed from the record as it stands. The reason is on each one.</p>" : "") +
      "</div>";
  }

  /* Notes waiting on a signature. This is the routing: a note the system cannot verify is not a
   * failure state to sweep up, it is the ordinary case on a ward round, and without a list of them
   * it simply sits unsigned and indistinguishable from one nobody finished.
   *
   * It sits on the ward list rather than a patient's chart because that is what a worklist is - the
   * question "what is between me and a signed record" is asked once, not once per bed. */
  function cosignCard(state) {
    var q = state.cosign;
    if (!q || (!(q.notes || []).length && !(q.mine || []).length)) return "";
    var wait = function (m) { return m == null ? "" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };

    var rows = (q.notes || []).map(function (n) {
      return "<li><div class=\"w-dose-h\"><b>" + esc(n.noteType || "note") + "</b> <span>written by " + esc(n.authorId) + "</span></div>" +
        '<div class="w-dose-s"><span class="w-due">' + ms("schedule") + "waiting " + esc(wait(n.waitingMinutes)) + "</span>" +
        // The gap travels WITH the note to the person being asked to put their name to it. A
        // signature does not fill in a missing plan, and the signer should know before, not after.
        ((n.incompleteSections || []).length ? '<span class="w-st overdue">' + esc(n.incompleteSections.join(", ")) + " not filled in</span>" : "") + "</div>" +
        (q.canSign ? '<div class="w-dose-a"><button class="w-btn tiny go" data-w-act="cosign:' + esc(n.noteId) + '">' + ms("draw") + "Sign</button></div>" : "") +
        "</li>";
    }).join("");

    var mine = (q.mine || []).map(function (n) {
      return "<li><b>" + esc(n.noteType || "note") + "</b> <span>" + ((n.incompleteSections || []).length ? esc(n.incompleteSections.join(", ")) + " still blank" : "complete") + "</span>" +
        '<button class="w-btn tiny" data-w-act="submitnote:' + esc(n.noteId) + '">' + ms("outbox") + "Submit</button></li>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("draw") + "<h3>Notes awaiting signature" + ((q.notes || []).length ? " &middot; " + q.notes.length : "") + "</h3>" +
      '<button class="w-ic" data-w-act="cosigns" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows ? '<ul class="w-doses w-tx">' + rows + "</ul>" : '<p class="w-empty">No notes are waiting on a signature.</p>') +
      // Said plainly rather than by hiding the buttons: a worklist somebody cannot act on, with no
      // explanation, is how a queue grows while everybody assumes it is handled.
      (rows && !q.canSign ? '<p class="w-hint">' + ms("info") + "You hold no verified registration on this account, so you cannot sign these. They need a registered clinician." + "</p>" : "") +
      (mine ? '<div class="w-sub"><h4>' + ms("edit_note") + "Your notes, not yet submitted</h4>" +
        '<p class="w-hint">Submitting says the note is finished. It is not a signature, and it does not need a registration.</p>' +
        '<ul class="w-mini w-unsent">' + mine + "</ul></div>" : "") +
      "</div>";
  }

  /* HOW CONFIDENT SOMEBODY WAS. The server's own vocabulary, offered in full: a list that only let a
   * clinician say "confirmed" would turn every working idea into a diagnosis on the chart, and the
   * default is `provisional` for exactly that reason. */
  var VERIFICATION = [
    ["provisional", "Provisional - a working diagnosis"],
    ["differential", "Differential - one of several being considered"],
    ["confirmed", "Confirmed"],
    ["refuted", "Refuted - considered and ruled out"]
  ];
  function problemsCard(state) {
    var rows = (state.problems || []).map(function (p) {
      return '<li><b>' + esc(p.display) + "</b>" + (p.codeSystem && p.codeSystem !== "text" ? ' <span class="w-code">' + esc(p.code) + "</span>" : "") +
        ' <span class="w-vs ' + esc(p.verificationStatus) + '">' + esc(p.verificationStatus) + "</span>" +
        // Resolving is a new version, never a deletion: the diagnosis stays on the record with its
        // history, which is what makes "we thought it was X" answerable later.
        (p.clinicalStatus === "active" ? '<button class="w-btn tiny" data-w-act="resolve:' + esc(p.problemId) + '">' + ms("task_alt") + "Resolve</button>" : '<span class="w-vs">' + esc(p.clinicalStatus) + "</span>") +
        "</li>";
    }).join("");

    var opts = VERIFICATION.map(function (v) { return '<option value="' + esc(v[0]) + '">' + esc(v[1]) + "</option>"; }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("clinical_notes") + "<h3>Problem list</h3></div>" +
      (rows ? "<ul class=\"w-problems\">" + rows + "</ul>" : '<p class="w-empty">No problems recorded.</p>') +
      /* The entry form is always rendered. Hiding it from a nurse would be the screen deciding who
       * may assert a diagnosis, and it is not the screen's decision: the capability is checked on the
       * server, which refuses and says why. A UI that hides a refusal teaches people the feature does
       * not exist. */
      '<div class="w-sub"><h4>' + ms("add") + "Add a problem</h4>" +
      '<div class="w-prob"><input id="wProbText" type="text" autocomplete="off" placeholder="Diagnosis, in words" value="' + esc(state.probText || "") + '">' +
      '<input id="wProbCode" type="text" autocomplete="off" placeholder="ICD code (optional)" value="' + esc(state.probCode || "") + '">' +
      '<select id="wProbVs">' + opts + "</select>" +
      '<button class="w-btn ghost" data-w-act="icd">' + ms("search") + "Find code</button>" +
      '<button class="w-btn" data-w-act="problem">' + ms("save") + "Record</button></div>" +
      /* THE CODE IS PICKED BY A PERSON, NEVER DERIVED. The search offers candidates and attaches
       * nothing: no result is preselected, not even when there is exactly one, because a single
       * result is not the same as the right one. Until somebody clicks, the diagnosis is text. */
      (state.icd === null ? '<p class="w-hint">' + ms("info") + "Searching…</p>" : "") +
      (Array.isArray(state.icd)
        ? (state.icd.length
          ? '<ul class="w-icd">' + state.icd.map(function (c, i) {
              return '<li><button class="w-icd-p" data-w-act="icdpick:' + i + '"><b>' + esc(c.code) + "</b><span>" + esc(c.title) + "</span><small>" + esc(c.system || "") + "</small></button></li>";
            }).join("") + "</ul>"
          : '<p class="w-hint">' + ms("info") + "No matching code. Record it in words: an uncoded diagnosis is honest, a guessed code is not.</p>")
        : "") +
      // Said plainly, because a code box beside a text box invites typing one in and hoping.
      '<p class="w-hint">' + ms("info") + "Left blank, the code is not guessed at: the diagnosis is recorded as text, and says so. Nothing here decides what the words mean.</p>" +
      "</div></div>";
  }

  var VITALS = [
    { k: "sbp", l: "Systolic", u: "mmHg" }, { k: "dbp", l: "Diastolic", u: "mmHg" },
    { k: "pulse", l: "Pulse", u: "/min" }, { k: "rr", l: "Resp rate", u: "/min" },
    { k: "temp", l: "Temp", u: "°F" }, { k: "spo2", l: "SpO₂", u: "%" },
    { k: "weight", l: "Weight", u: "kg" }
  ];
  function vitalsCard() {
    var f = VITALS.map(function (v) {
      return '<label class="w-f"><span>' + esc(v.l) + ' <i>' + esc(v.u) + "</i></span>" +
        '<input id="wv_' + v.k + '" type="text" inputmode="decimal" autocomplete="off"></label>';
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>Vitals</h3></div>" +
      '<div class="w-grid">' + f + "</div>" +
      // Weight is not decoration: a weight-based dose is REFUSED at the bedside until the ward has
      // actually weighed the patient, and this is where that weight comes from.
      '<p class="w-hint">Blank fields are not recorded. A value that is not plainly one number is skipped, never guessed at.</p>' +
      '<button class="w-btn" data-w-act="vitals">' + ms("save") + "Record vitals</button></div>";
  }

  function marCard(state) {
    var rows = (state.due || []).map(function (d, i) {
      var acts = nextFor(d.status).map(function (a) {
        // The dose is addressed by its INDEX in the loaded round, so the exact dueAt the server
        // computed is the one sent back. Re-deriving a time in the browser is how a click could
        // land on a different dose than the row the nurse is looking at.
        return '<button class="w-btn tiny' + (a === "administer" ? " go" : (a === "refuse" || a === "cancel" ? " warn" : "")) + '" data-w-act="mar:' + a + "|" + i + '">' + esc(a) + "</button>";
      }).join("");
      return '<li' + (d.overdue ? ' class="overdue"' : "") + '><div class="w-dose-h"><b>' + esc(d.drug) + "</b> <span>" + dose(d.dose) + (d.route ? " &middot; " + esc(d.route) : "") + (d.frequency ? " &middot; " + esc(d.frequency) : "") + "</span></div>" +
        '<div class="w-dose-s"><span class="w-due">' + ms("schedule") + when(d.dueAt) + "</span>" +
        (d.overdue ? '<span class="w-st overdue">overdue</span>' : "") +
        '<span class="w-st ' + esc(String(d.status || "notstarted").toLowerCase()) + '">' + esc(d.status || "not started") + "</span>" +
        (d.administeredAt ? "<small>given " + when(d.administeredAt) + "</small>" : "") + "</div>" +
        '<div class="w-dose-a">' + (acts || '<small class="w-empty">No further action.</small>') + "</div></li>";
    }).join("");

    // PRN is shown, and shown APART. An as-needed drug is given on the patient's need, not on the
    // clock, so it must be visible to the ward without ever appearing among the doses that are due.
    var prn = (state.prn || []).map(function (p) {
      return "<li><b>" + esc(p.drug) + "</b> <span>" + dose(p.dose) + (p.route ? " &middot; " + esc(p.route) : "") + "</span></li>";
    }).join("");
    // The orders the schedule could not read. Surfaced loudly: an order the ward cannot see on the
    // round is a dose nobody knows is missing.
    var unsched = (state.unscheduled || []).map(function (u) {
      return "<li><b>" + esc(u.drug) + "</b> <span>" + (u.frequency ? '"' + esc(u.frequency) + '"' : "no frequency written") + "</span></li>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("pill") + "<h3>Medication round</h3>" +
      '<button class="w-ic" data-w-act="round" title="Reload the round">' + ms("refresh") + "</button></div>" +
      '<div class="w-filter"><input id="wFrom" type="datetime-local" value="' + esc(state.from) + '">' +
      '<input id="wTo" type="datetime-local" value="' + esc(state.to) + '">' +
      '<button class="w-btn ghost" data-w-act="round">Load</button></div>' +
      '<div class="w-scan"><label class="w-f"><span>Wristband scan</span><input id="wScanP" type="text" autocomplete="off" placeholder="Patient barcode"></label>' +
      '<label class="w-f"><span>Drug scan</span><input id="wScanD" type="text" autocomplete="off" placeholder="Drug barcode"></label>' +
      /* The second nurse. The hospital's own high-alert list decides which drugs need one, and the
       * SERVER refuses without it - insulin, heparin, opioids. Before this field existed the refusal
       * was correct and unanswerable: a nurse at the bedside had no way to name the witness, so a
       * high-alert dose could not be given from this screen at all. The field is always shown, never
       * shown only for drugs the browser thinks are high-alert: that would be a second copy of the
       * formulary living in the UI. */
      '<label class="w-f"><span>Second nurse <i>high-alert drugs only</i></span><input id="wWitness" type="text" autocomplete="off" placeholder="Witness ID"></label></div>' +
      (rows ? '<ul class="w-doses">' + rows + "</ul>" : '<p class="w-empty">No doses fall in this window.</p>') +
      (prn ? '<div class="w-sub"><h4>' + ms("touch_app") + 'As needed (PRN)</h4><p class="w-hint">Given on the patient’s need. These are never due at a time.</p><ul class="w-mini">' + prn + "</ul></div>" : "") +
      (unsched ? '<div class="w-sub warn"><h4>' + ms("help") + 'Not on the round</h4><p class="w-hint">The frequency on these orders could not be read, so no dose times were computed. They need a look.</p><ul class="w-mini">' + unsched + "</ul></div>" : "") +
      (state.truncated ? '<p class="w-hint">' + ms("warning") + "More doses fall in this window than can be listed. Narrow it.</p>" : "") +
      "</div>";
  }

  function chartView(state) {
    var s = state.sel || {};
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(s.patientId || "") + "</b><small>" + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + " &middot; admitted " + when(s.admittedAt) + "</small></div>" +
      // The summary is reachable from the patient, not from a menu somewhere else. A planned
      // discharge is prepared while the patient is still on the ward, so this is not gated on the
      // stay being closed - the summary screen states plainly when a stay is still open.
      '<button class="w-btn ghost" data-w-act="move" title="Transfer to another ward or bed">' + ms("swap_horiz") + "Transfer</button>" +
      '<button class="w-btn ghost" data-w-act="summary" title="Discharge summary">' + ms("description") + "Summary</button></div>" +
      criticalsCard(state) + problemsCard(state) + noteCard(state) + vitalsCard() + fluidCard(state) + marCard(state) + outboxCard(state);
  }

  var FLUID_IN = [["oral", "Oral"], ["iv", "IV"], ["ng", "NG / enteral"], ["blood", "Blood"], ["other", "Other"]];
  var FLUID_OUT = [["urine", "Urine"], ["drain", "Drain"], ["vomit", "Vomit"], ["stool", "Stool"], ["blood", "Blood loss"], ["other", "Other"]];
  /* Fluid balance. The total is never shown on its own: "+400" hides whether that is a patient who
   * drank 400 and passed nothing, or one who took three litres and passed 2.6 - different patients,
   * one of them in trouble. And the hours nobody charted are shown beside the number, because a
   * balance presented as a fact implies a chart that was actually kept. */
  function fluidCard(state) {
    var b = state.balance;
    var opts = function (list) {
      return list.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("");
    };
    var totals = !b ? '<p class="w-empty">No fluid charted for this period.</p>'
      : '<div class="w-bal">' +
          '<div class="w-bal-c"><span>In</span><b>' + esc(b.intake) + " mL</b></div>" +
          '<div class="w-bal-c"><span>Out</span><b>' + esc(b.output) + " mL</b></div>" +
          '<div class="w-bal-c net"><span>Balance</span><b>' + (b.balance > 0 ? "+" : "") + esc(b.balance) + " mL</b></div>" +
        "</div>" +
        (b.complete
          ? '<p class="w-hint">' + ms("check_circle") + "Every hour of this period has an entry.</p>"
          : '<p class="w-hint warn">' + ms("error") + esc(b.gaps.length) + " of the last " + esc(b.gaps.length + b.hours.length) +
            " hours have nothing charted. Read this balance as incomplete.</p>");
    return '<div class="w-card"><div class="w-card-h">' + ms("water_drop") + "<h3>Fluid balance</h3>" +
      '<button class="w-ic" data-w-act="balance" title="Refresh">' + ms("refresh") + "</button></div>" +
      totals +
      '<div class="w-fluid"><select id="wFDir"><option value="intake">Intake</option><option value="output">Output</option></select>' +
      '<select id="wFKind">' + opts(FLUID_IN) + "</select>" +
      '<input id="wFVal" type="text" inputmode="decimal" placeholder="mL" autocomplete="off">' +
      '<button class="w-btn" data-w-act="fluid">' + ms("add") + "Chart</button></div>" +
      '<p class="w-hint">Volumes are recorded in mL. A value that is not plainly one number is not recorded.</p></div>';
  }

  /* Open critical results, ABOVE everything else on the chart. A critical result that reaches a
   * chart nobody reads is the oldest preventable death in hospital medicine, and the failure is
   * never the measurement - it is that no named human said "I have seen this". So this sits first,
   * and it stays until somebody acknowledges it. */
  function criticalsCard(state) {
    var rows = (state.criticals || []).map(function (c) {
      var esc_ = c.escalation || {}, mins = esc_.minutesOpen;
      return '<li class="lvl-' + esc(esc_.level || "due") + '">' +
        '<div class="w-crit-h"><b>' + esc(c.display || c.code) + "</b>" +
        (c.value == null ? "" : '<span class="w-crit-v">' + esc(c.value) + (c.unit ? " " + esc(c.unit) : "") + "</span>") +
        // Whose call this was. A laboratory's own flag and a configured threshold are never
        // presented as the same thing.
        '<span class="w-crit-b">' + (c.basis === "lab" ? "flagged by the lab" : c.basis === "limit" ? "outside critical limit" : esc(c.basis || "")) + "</span></div>" +
        '<div class="w-crit-m">' + ms("schedule") + (mins == null ? "" : mins + " min since reported") +
        (esc_.level === "escalate" ? " &middot; ESCALATE" : esc_.level === "overdue" ? " &middot; overdue" : "") +
        (c.state === "acknowledged" ? " &middot; acknowledged by " + esc(c.acknowledgedBy || "a clinician") : "") + "</div>" +
        (c.state === "open" ? '<button class="w-btn tiny go" data-w-act="ack:' + esc(c.loopId) + '">' + ms("task_alt") + "Acknowledge</button>" : "") +
      "</li>";
    }).join("");
    if (!rows) return "";
    return '<div class="w-card crit"><div class="w-card-h">' + ms("priority_high") + "<h3>Critical results &middot; " + state.criticals.length + "</h3></div>" +
      '<p class="w-hint">Acknowledging records that you have seen this and what you did. It is not a way to clear the list.</p>' +
      '<ul class="w-crits">' + rows + "</ul></div>";
  }

  /* The prescription outbox. The point of this card is the gap between "we sent it" and "they have
   * it": a prescription that silently failed to transmit is a patient who goes to the pharmacy and
   * is told there is nothing for them. So QUEUED and SENT are shown as plainly unfinished, and only
   * ACKNOWLEDGED reads as done. Nothing here is styled as an alarm - it is a worklist, and a wall of
   * red on a ward screen stops being read within a shift. */
  var TX_WORD = { queued: "not sent yet", sent: "sent, not confirmed", acknowledged: "confirmed received", failed: "not delivered" };
  function outboxCard(state) {
    // The active orders, as the round already knows them. Deriving them here rather than fetching a
    // second list keeps the screen's idea of "this patient's medicines" a single one.
    var orders = [], seen = {};
    [].concat(state.due || [], state.prn || [], state.unscheduled || []).forEach(function (d) {
      if (d && d.orderId && !seen[d.orderId]) { seen[d.orderId] = 1; orders.push({ orderId: d.orderId, drug: d.drug, dose: d.dose, route: d.route }); }
    });
    var byOrder = {};
    (state.outbox || []).forEach(function (t) { (byOrder[t.orderId] = byOrder[t.orderId] || []).push(t); });

    var rows = (state.outbox || []).map(function (t) {
      return '<li class="tx-' + esc(t.state) + (t.outstanding ? " open" : "") + '">' +
        '<div class="w-dose-h"><b>' + esc(drugFor(orders, t.orderId)) + "</b>" +
        '<span>' + esc(t.channel) + (t.destination ? " &middot; " + esc(t.destination) : "") + "</span></div>" +
        '<div class="w-dose-s"><span class="w-st ' + esc(t.state) + '">' + esc(TX_WORD[t.state] || t.state) + "</span>" +
        // Which version of the order left the building. If the prescriber has changed the dose since,
        // what was sent is still what was sent, and this is how the ward can tell.
        (t.orderVersion == null ? "" : "<small>order v" + esc(t.orderVersion) + "</small>") +
        (t.acknowledgedAt ? "<small>confirmed " + when(t.acknowledgedAt) + "</small>" : t.queuedAt ? "<small>queued " + when(t.queuedAt) + "</small>" : "") + "</div>" +
        (t.failureReason ? '<p class="w-hint warn">' + ms("error") + esc(t.failureReason) + "</p>" : "") +
        (t.resolvedAt ? '<p class="w-hint">' + ms("task_alt") + "Dealt with: " + esc(t.resolution) + "</p>" : "") +
        (t.outstanding ? '<div class="w-dose-a"><button class="w-btn tiny" data-w-act="txr:' + esc(t.transmissionId) + '">' + ms("edit_note") + "Record what was done</button></div>" : "") +
        "</li>";
    }).join("");

    // Medicines with nothing in the outbox at all. Named rather than left off: an order nobody sent
    // looks exactly like an order that arrived, unless the screen says otherwise.
    var unsent = orders.filter(function (o) { return !byOrder[o.orderId]; }).map(function (o) {
      return "<li><b>" + esc(o.drug) + "</b> <span>" + dose(o.dose) + (o.route ? " &middot; " + esc(o.route) : "") + "</span>" +
        '<button class="w-btn tiny" data-w-act="tx:' + esc(o.orderId) + '">' + ms("send") + "Send</button></li>";
    }).join("");
    if (!rows && !unsent) return "";

    return '<div class="w-card"><div class="w-card-h">' + ms("outbox") + "<h3>Prescriptions sent</h3>" +
      '<button class="w-ic" data-w-act="outbox" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows ? '<ul class="w-doses w-tx">' + rows + "</ul>" : '<p class="w-empty">Nothing has been sent for this patient.</p>') +
      (unsent ? '<div class="w-sub"><h4>' + ms("pending") + "Not sent anywhere</h4>" +
        '<p class="w-hint">These are prescribed and on the record. Sending is a separate act, and it has not happened.</p>' +
        '<ul class="w-mini w-unsent">' + unsent + "</ul></div>" : "") +
      '<p class="w-hint">' + ms("info") + "Confirmed means the far end said it has the prescription. Anything else still needs somebody.</p></div>";
  }
  function drugFor(orders, orderId) {
    for (var i = 0; i < orders.length; i++) { if (orders[i].orderId === orderId) return orders[i].drug; }
    return orderId;   // the order is no longer active; its id is the honest label, not a guessed name
  }

  /* The downtime pack, on screen and on paper. Every safety property of this view is about being
   * honest that it is a COPY: it is stamped, it says what it does not know, and a page with a gap in
   * it says so beside the patient's name rather than printing a reassuring blank. */
  function downtimeView(state) {
    var d = state.downtime;
    if (!d) return '<div class="w-card"><p class="w-empty">Preparing the pack…</p></div>';

    var pages = (d.patients || []).map(function (p) {
      var allergies = p.allergies === null
        // The single most dangerous line this screen could print. An empty allergy row reads as "no
        // known allergies" to every clinician alive, so a failed read never renders as one.
        ? '<b class="w-dt-gap">ALLERGIES COULD NOT BE READ. Ask before giving anything.</b>'
        : (p.allergies.length
          ? p.allergies.map(function (a) { return "<b>" + esc(a.substance) + "</b>" + (a.reaction ? " (" + esc(a.reaction) + ")" : ""); }).join(", ")
          : "No allergies recorded.");

      var meds = p.orders === null
        ? '<li class="w-dt-gap">MEDICINES COULD NOT BE READ.</li>'
        : (p.orders.length ? p.orders.map(function (o) {
            var times = o.asNeeded ? "as needed (PRN)"
              : o.scheduleKnown ? (o.due || []).map(function (t) { return when(t); }).join(" &middot; ")
              // Stated, never blank: an empty time column reads as "nothing due today", which is how
              // a dose gets missed for a whole outage.
              : '<span class="w-dt-gap">no dose times could be worked out from "' + esc(o.frequency || "") + '"</span>';
            return "<li><b>" + esc(o.drug) + "</b> " + dose(o.dose) + (o.route ? " &middot; " + esc(o.route) : "") +
              '<div class="w-dt-times">' + times + "</div></li>";
          }).join("") : "<li>No active medicines.</li>");

      var crit = p.criticals === null
        ? '<p class="w-dt-gap">OPEN CRITICAL RESULTS COULD NOT BE READ.</p>'
        : (p.criticals.length ? '<p class="w-dt-crit">' + ms("priority_high") + "Outstanding: " +
            p.criticals.map(function (c) { return esc(c.display) + (c.value == null ? "" : " " + esc(c.value) + (c.unit ? " " + esc(c.unit) : "")); }).join("; ") + "</p>" : "");

      return '<section class="w-dt-p">' +
        '<header><span class="w-dt-bed">' + esc(p.bed || "-") + "</span>" +
        "<div><b>" + esc(p.name || p.patientId) + "</b><small>" + esc(p.mrn || "") + (p.dob ? " &middot; " + esc(p.dob) : "") +
        " &middot; admitted " + when(p.admittedAt) + "</small></div></header>" +
        '<p class="w-dt-alg">' + allergies + "</p>" + crit +
        "<ul class=\"w-dt-meds\">" + meds + "</ul>" +
        '<div class="w-dt-blank"><span>Given during downtime - drug, dose, time, signature</span></div>' +
        "</section>";
    }).join("");

    return '<div class="w-dt">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      '<button class="w-btn" data-w-act="printpack">' + ms("print") + "Print</button>" +
      '<button class="w-btn ghost" data-w-act="downtime">' + ms("refresh") + "Refresh</button></div>" +
      '<header class="w-dt-h"><h2>Downtime pack' + (d.ward ? " &middot; " + esc(d.ward) : "") + "</h2>" +
      "<p><b>" + esc(d.count) + "</b> patient" + (d.count === 1 ? "" : "s") + " &middot; printed " + when(d.generatedAt) + "</p>" +
      '<p class="w-dt-warn">' + esc(d.warning) + "</p>" +
      (d.incomplete ? '<p class="w-dt-gap">' + esc(d.incomplete) + " of these pages could not be fully read. Those gaps are marked on the page.</p>" : "") +
      "</header>" +
      (pages || '<p class="w-empty">No patients are admitted, so there is nothing to print.</p>') +
      "</div>";
  }

  /* The ward round note. The templates are the HOSPITAL's - this screen supplies no headings of its
   * own and no text at all, which is the rule note-templates.js already keeps on the server: the
   * questions a hospital wants asked are a clinical decision, and inventing them would be making it.
   *
   * A REQUIRED SECTION LEFT BLANK DOES NOT BLOCK THE SAVE. A clinician interrupted mid-note by an
   * arrest must be able to keep what they have, and a screen that refuses is one people stop using
   * for the notes that matter most. The server names the gap and the note is stored incomplete,
   * visibly - which is also what the discharge summary does.
   *
   * IT NEVER SIGNS. Signing is its own act with its own authority (note-cosign.js), and a composer
   * that signed on the way past would put a name against a note nobody re-read. */
  function noteCard(state) {
    var tpls = state.templates || [];
    if (!tpls.length) return "";
    var chosen = null, i;
    for (i = 0; i < tpls.length; i++) if (tpls[i].id === state.noteTemplateId) chosen = tpls[i];

    var opts = '<option value="">Choose a note…</option>' + tpls.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (chosen && chosen.id === t.id ? " selected" : "") + ">" + esc(t.name) + "</option>";
    }).join("");

    var fields = chosen ? chosen.sections.map(function (sec) {
      return '<label class="w-f"><span>' + esc(sec.title) + (sec.required ? " <i>required</i>" : "") + "</span>" +
        '<textarea id="wNote_' + esc(sec.key) + '" rows="3" placeholder="' + esc(sec.prompt || "") + '"></textarea></label>';
    }).join("") : "";

    var r = state.noteResult;
    return '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Ward round note</h3></div>" +
      '<div class="w-filter"><select id="wNoteTpl">' + opts + "</select>" +
      '<button class="w-btn ghost" data-w-act="pickTpl">Open</button></div>' +
      (chosen
        ? '<div class="w-note">' + fields + "</div>" +
          '<p class="w-hint">' + ms("info") + "A blank section is recorded as not recorded, and the note says so. Nothing here writes text for you.</p>" +
          '<button class="w-btn" data-w-act="note">' + ms("save") + "Save note</button>"
        : '<p class="w-empty">The headings come from this hospital&#39;s own templates.</p>') +
      (r ? '<div class="w-sub"><h4>' + ms("task_alt") + "Saved</h4>" +
        '<p class="w-hint' + (r.incomplete ? " warn" : "") + '">' + (r.incomplete
          ? ms("warning") + "Saved with " + esc((r.missing || []).map(function (m) { return m.title; }).join(", ")) + " still blank. It is on the record as incomplete."
          : ms("check_circle") + "Every section was filled in.") + "</p>" +
        '<p class="w-hint">' + ms("info") + "Unsigned. Submit it for signature from the ward list.</p></div>" : "") +
      "</div>";
  }

  function _render(state) {
    return '<div class="w-shell"><header class="w-top"><button class="w-ic" data-w-act="close">' + ms("close") + "</button>" +
      '<span class="w-title">WardSynQ &middot; Inpatient</span>' +
      (state.busy ? '<span class="w-busy">' + ms("progress_activity") + "</span>" : "<span></span>") + "</header>" +
      '<div class="w-canvas">' + banner(state) +
      (state.view === "chart" ? chartView(state) : state.view === "downtime" ? downtimeView(state) : listView(state)) + "</div></div>";
  }

  // ---- controller --------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdWard"); if (!el) { el = document.createElement("div"); el.id = "smdWard"; document.body.appendChild(el); } return el; }
  function paint() { root().innerHTML = _render(st); }

  function loadWard() {
    st.busy = true; paint();
    return apiGet("/ward/list?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { if (settle(r)) st.patients = r.patients || []; st.loaded = true; paint(); return Promise.all([loadCosigns(), loadQuality(), loadOverrides()]); })
      .catch(function () { st.busy = false; st.err = "Could not reach the ward."; st.loaded = true; paint(); });
  }
  function loadChart() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId);
    return Promise.all([apiGet("/ward/problems?" + q), apiGet("/ward/criticals?" + q)])
      .then(function (rs) {
        if (settle(rs[0])) st.problems = rs[0].problems || [];
        // A failure to READ the critical list must not be silent: an empty list and an unreachable
        // one look identical on screen, and that is the difference between calm and dangerous.
        if (rs[1] && rs[1].ok) st.criticals = rs[1].loops || [];
        else st.err = st.err || "Could not load critical results. Do not read this chart as clear.";
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not load the chart."; paint(); });
  }
  /* A transfer, from the patient's own chart. The refusal a busy bed produces is the important part
   * of this flow: the server names the occupant, and that is shown as-is rather than collapsed into
   * "could not transfer", because "bed 12 already has someone in it" is what the ward has to act on. */
  function transfer() {
    var s = st.sel; if (!s) return;
    var ward = "", bed = "";
    try {
      ward = G.prompt("Transfer to which ward?", s.ward || "") || "";
      if (!ward.trim()) return;
      bed = G.prompt("Which bed? (leave blank if awaiting one)", "") || "";
    } catch (e) { return; }
    st.busy = true; paint();
    apiPost("/ward/transfer", { orgId: st.orgId, encounterId: s.encounterId, ward: ward.trim(), bed: bed.trim() })
      .then(function (r) {
        if (r && r.error === "bed_occupied") {
          st.busy = false;
          st.err = r.detail + (r.occupiedBy && r.occupiedBy.patientId ? " by " + r.occupiedBy.patientId : "") + ". Choose another bed.";
          paint(); return;
        }
        if (settle(r, r && r.written ? "Moved to " + ward.trim() + (bed.trim() ? ", bed " + bed.trim() : "") + "." : "Already there.")) {
          st.sel = null; st.view = "list"; loadWard();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the transfer."; paint(); });
  }
  /* The balance window is the last 12 hours: a shift. Recomputed each load rather than stored, so a
   * chart opened at the end of a shift shows that shift and not a stale window. */
  function loadBalance() {
    var s = st.sel; if (!s) return Promise.resolve();
    var to = new Date(), from = new Date(to.getTime() - 12 * 3600000);
    return apiGet("/ward/balance?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId) +
      "&from=" + encodeURIComponent(from.toISOString()) + "&to=" + encodeURIComponent(to.toISOString()))
      .then(function (r) { if (r && r.ok) st.balance = r.balance; paint(); })
      .catch(function () { /* the card says "no fluid charted"; a failure is not a zero balance */ });
  }
  function chartFluid() {
    var s = st.sel; if (!s) return;
    var v = val("wFVal");
    if (!v) { st.err = "How much?"; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/fluid", {
      orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId,
      entries: [{ direction: val("wFDir"), kind: val("wFKind"), value: v, at: new Date().toISOString() }],
    }).then(function (r) {
      // A rejected row is the answer, not something to hide behind a success message.
      if (r && r.rejected && r.rejected.length && !r.written) { st.busy = false; st.err = "Not recorded: " + r.rejected[0].reason.replace(/_/g, " ") + "."; paint(); return; }
      if (settle(r, "Charted.")) { var el = document.getElementById("wFVal"); if (el) el.value = ""; loadBalance(); }
      else paint();
    }).catch(function () { st.busy = false; st.err = "Could not chart that."; paint(); });
  }
  function acknowledge(loopId) {
    var why = ""; try { why = G.prompt("What did you do about this result?") || ""; } catch (e) {}
    if (!why.trim()) { st.err = "An acknowledgement records what was done. It needs a sentence."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/acknowledge", { orgId: st.orgId, loopId: loopId, action: why.trim() })
      .then(function (r) { if (settle(r, "Acknowledged.")) loadChart(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the acknowledgement."; paint(); });
  }
  /* A datetime-local value ("YYYY-MM-DDTHH:mm") for an instant, in the BROWSER's clock, which is
   * what the input shows and what the nurse reads. The hospital's own round times come from the
   * server; this is only the window being looked at. */
  function localInput(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  /* The default window is TODAY. It is a view range, not an assertion: the server decides what is
   * due, from the frequency the prescriber wrote. Before scheduling existed this field had to be
   * filled in by the nurse and the screen had to say the system was claiming nothing. */
  function defaultWindow() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    st.from = localInput(d.getTime());
    st.to = localInput(d.getTime() + 86400000);
  }
  function loadRound() {
    var s = st.sel; if (!s) return Promise.resolve();
    if (!st.from || !st.to) defaultWindow();
    st.busy = true; paint();
    var q = "/ward/schedule?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId) +
      "&from=" + encodeURIComponent(new Date(st.from).toISOString()) + "&to=" + encodeURIComponent(new Date(st.to).toISOString());
    return apiGet(q)
      .then(function (r) {
        if (settle(r)) { st.due = r.due || []; st.prn = r.prn || []; st.unscheduled = r.unscheduled || []; st.truncated = !!r.truncated; }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not load the round."; paint(); });
  }
  /* Asserting a diagnosis. The screen carries the words and, if the clinician has one, the code; it
   * never derives a code from the words. An uncoded diagnosis is recorded as text and the server says
   * so - which is true, and is the one thing a receiving system can act on honestly. */
  /* Searching the terminology. The words the clinician typed are the query and nothing else - no
   * patient identifier is sent, because a lookup that carried the patient it was for would leak a
   * diagnosis to a reference service that has no business knowing one. */
  function loadTemplates() {
    return apiGet("/ward/templates?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { if (r && r.ok) st.templates = r.templates || []; paint(); })
      // Silent: a ward whose note templates would not load can still chart everything else, and an
      // error banner over the whole chart for a missing composer helps nobody.
      .catch(function () {});
  }
  /* Saves the note. The sections go up exactly as typed - this screen composes nothing, expands no
   * abbreviation and fills nothing in. */
  function saveNote() {
    var s = st.sel; if (!s || !st.noteTemplateId) return;
    var tpl = null, i;
    for (i = 0; i < st.templates.length; i++) if (st.templates[i].id === st.noteTemplateId) tpl = st.templates[i];
    if (!tpl) return;
    var sections = {};
    tpl.sections.forEach(function (sec) { var v = val("wNote_" + sec.key); if (v) sections[sec.key] = v; });
    st.busy = true; paint();
    apiPost("/ward/note", { orgId: st.orgId, templateId: tpl.id, encounterId: s.encounterId, sections: sections })
      .then(function (r) {
        if (settle(r, r && r.incomplete ? null : "Note saved.")) {
          st.noteResult = r;
          tpl.sections.forEach(function (sec) { var el = document.getElementById("wNote_" + sec.key); if (el) el.value = ""; });
          loadCosigns();
        }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not save the note."; paint(); });
  }

  function findCode() {
    var q = val("wProbText");
    st.probText = q; st.probCode = val("wProbCode");
    if (!q) { st.err = "Type the diagnosis first, then search for its code."; paint(); return; }
    st.icd = null; paint();
    icdSearch(q)
      .then(function (rows) { st.icd = rows; paint(); })
      // A terminology service that is down must never stop a diagnosis being recorded. The words
      // still work, and the screen says so rather than leaving a spinner up.
      .catch(function () { st.icd = []; st.err = "The code search is unavailable. Record the diagnosis in words."; paint(); });
  }
  /* A PERSON PICKS. Nothing here scores, ranks or auto-selects a result - not even when there is
   * exactly one, because one result is not the same as the right one. */
  function pickCode(i) {
    var c = (st.icd || [])[i];
    if (!c) return;
    st.probCode = c.code;
    // The official title becomes the words, so the record says what the code actually means rather
    // than what somebody typed on the way to finding it.
    st.probText = c.title;
    st.icd = undefined;
    paint();
  }

  function addProblem() {
    var s = st.sel; if (!s) return;
    var text = val("wProbText"), code = val("wProbCode");
    if (!text && !code) { st.err = "A diagnosis needs words, a code, or both."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/problem", {
      orgId: st.orgId,
      problem: {
        patientId: s.patientId, encounterId: s.encounterId,
        display: text, code: code,
        verificationStatus: val("wProbVs") || undefined,
      },
    })
      .then(function (r) {
        if (settle(r, r && r.written ? "Recorded as " + r.verificationStatus + "." : (r && r.skipped === "unchanged" ? "Already on the list, unchanged." : null))) {
          st.probText = ""; st.probCode = ""; st.icd = undefined;
          ["wProbText", "wProbCode"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          loadChart();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the problem."; paint(); });
  }
  /* RESOLVING IS A NEW VERSION, NOT A DELETION. The same problem is re-asserted with a resolved
   * clinical status, so "we thought it was this" stays answerable afterwards. */
  function resolveProblem(id) {
    var s = st.sel; if (!s || !id) return;
    var p = null;
    for (var i = 0; i < (st.problems || []).length; i++) if (st.problems[i].problemId === id) p = st.problems[i];
    if (!p) { st.err = "That problem is no longer on the list. Reload the chart."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/problem", {
      orgId: st.orgId,
      problem: {
        patientId: s.patientId, encounterId: s.encounterId,
        display: p.display, code: p.code, codeSystem: p.codeSystem,
        verificationStatus: p.verificationStatus, clinicalStatus: "resolved",
      },
    })
      .then(function (r) { if (settle(r, "Resolved. The problem stays on the record with its history.")) loadChart(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not resolve the problem."; paint(); });
  }

  function loadOverrides() {
    return apiGet("/ward/overrides?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { if (r && r.ok) st.overrides = r.report; paint(); })
      // Silent, like the other secondary panels: a ward that cannot load its override report can
      // still look after every patient on it.
      .catch(function () {});
  }
  function loadQuality() {
    return apiGet("/ward/quality?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { if (r && r.ok) st.quality = r; paint(); })
      // Silent on failure, like the co-sign worklist: an error banner over the bed board because a
      // secondary panel would not load helps nobody find a patient.
      .catch(function () {});
  }
  function loadDowntime() {
    st.busy = true; st.view = "downtime"; paint();
    return apiGet("/ward/downtime?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { if (settle(r)) st.downtime = r; paint(); })
      /* A pack that failed to load must never leave the previous one on screen: the whole hazard of
       * this feature is a clinician reading a sheet that is older than they think. */
      .catch(function () { st.busy = false; st.downtime = null; st.err = "Could not build the downtime pack. Do not print an older one."; paint(); });
  }
  function loadCosigns() {
    return apiGet("/ward/cosign-queue?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { if (r && r.ok) st.cosign = r; paint(); })
      // Silent on a failure by design: this is a worklist beside the ward list, and an error banner
      // over the bed board because a secondary list would not load helps nobody find a patient.
      .catch(function () {});
  }
  function submitNote(id) {
    if (!id) return;
    st.busy = true; paint();
    apiPost("/ward/note-submit", { orgId: st.orgId, noteId: id })
      .then(function (r) { if (settle(r, r && r.note)) loadCosigns(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not submit the note."; paint(); });
  }
  function cosign(id) {
    if (!id) return;
    st.busy = true; paint();
    apiPost("/ward/note-sign", { orgId: st.orgId, noteId: id })
      // The server says whether this was a signature or a co-signature, and its wording names the
      // author who remains the author. The screen does not paraphrase that.
      .then(function (r) { if (settle(r, r && (r.note || "Signed."))) loadCosigns(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not sign the note."; paint(); });
  }

  function loadOutbox() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/outbox?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (r && r.ok) st.outbox = r.transmissions || []; paint(); })
      // A failed READ of the outbox is not "nothing outstanding". Empty and unreachable look the same
      // on screen, and one of them means a prescription may be sitting undelivered.
      .catch(function () { st.err = st.err || "Could not load the prescription outbox."; paint(); });
  }
  function transmit(orderId) {
    if (!orderId) return;
    var where = ""; try { where = G.prompt("Send to which pharmacy? (leave blank to send unaddressed)", "") || ""; } catch (e) { return; }
    st.busy = true; paint();
    apiPost("/ward/transmit", { orgId: st.orgId, orderId: orderId, channel: "pharmacy", destination: where.trim() })
      // The server's own wording is shown: it says queued, not sent, and that distinction is the
      // entire point of the card.
      .then(function (r) { if (settle(r, r && r.note)) loadOutbox(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not queue the prescription."; paint(); });
  }
  function resolveTx(id) {
    if (!id) return;
    var what = ""; try { what = G.prompt("What was done instead? (printed and handed over, re-sent, cancelled)", "") || ""; } catch (e) { return; }
    if (!what.trim()) { st.err = "Say what was done. Clearing it off the list without a reason leaves a patient with no prescription and no trace of why."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/transmit-resolve", { orgId: st.orgId, transmissionId: id, resolution: what.trim() })
      .then(function (r) { if (settle(r, "Recorded. The transmission still reads as undelivered, because it was.")) loadOutbox(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  function saveVitals() {
    var s = st.sel; if (!s) return;
    var v = {}, any = false;
    VITALS.forEach(function (f) { var x = val("wv_" + f.k); if (x) { v[f.k] = x; any = true; } });
    if (!any) { st.err = "Nothing to record."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/vitals", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, vitals: v })
      .then(function (r) {
        // `written: 0` with ok:true is the server saying nothing was numeric. Say so plainly rather
        // than showing a success message for a save that recorded nothing.
        if (settle(r, r && r.written ? "Recorded " + r.written + " observation" + (r.written === 1 ? "" : "s") + "." : null)) {
          if (r && !r.written) st.err = "Nothing was recorded - no field held a plain number.";
          else VITALS.forEach(function (f) { var el = document.getElementById("wv_" + f.k); if (el) el.value = ""; });
        }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record vitals."; paint(); });
  }
  function marAction(action, idx) {
    var s = st.sel, d = st.due[idx];
    // The dose carries its own computed time. The browser never re-derives one: a click must act on
    // the row it was on, not on a time recomputed a moment later.
    if (!s || !d || !d.dueAt) { st.err = "That dose is no longer on the round. Reload it."; paint(); return; }
    var body = {
      orgId: st.orgId, action: action, orderId: d.orderId, dueAt: d.dueAt,
      patient: { id: s.patientId }
    };
    // The five rights are checked on the server against what was actually scanned. The UI passes the
    // scans through untouched; it does not compare them itself and does not proceed on its own.
    if (action === "scan") body.scan = { patient: val("wScanP"), drug: val("wScanD") };
    /* Passed through untouched, and only ever passed. The screen does not decide whether a witness is
     * needed - the hospital's high-alert list does, on the server - and it never compares the witness
     * to the nurse. `WITNESS_NOT_INDEPENDENT` is the server's refusal to make. */
    if (action === "administer") { var w = val("wWitness"); if (w) body.witnessId = w; }
    if (action === "hold" || action === "refuse" || action === "cancel") {
      var why = ""; try { why = G.prompt("Reason for " + action + ":") || ""; } catch (e) {}
      if (!why.trim()) { st.err = "A reason is required to " + action + " a dose."; paint(); return; }
      body.reason = why.trim();
    }
    st.busy = true; paint();
    apiPost("/ward/mar", body)
      .then(function (r) { if (settle(r, r && r.to ? action + ": " + r.from + " → " + r.to : null)) loadRound(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not reach the eMAR."; paint(); });
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest("[data-w-act]"); if (!b) return;
    var a = b.getAttribute("data-w-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "dismiss") { st.err = ""; st.note = ""; st.refusal = null; paint(); return; }
    if (cmd === "reload") { loadWard(); return; }
    if (cmd === "setward") { st.ward = val("wWard"); loadWard(); return; }
    if (cmd === "back") { st.view = "list"; st.sel = null; st.due = []; st.problems = []; st.outbox = []; st.downtime = null; paint(); return; }
    if (cmd === "open") {
      var p = null;
      for (var j = 0; j < st.patients.length; j++) { if (st.patients[j].encounterId === arg) { p = st.patients[j]; break; } }
      if (!p) return;
      st.sel = p; st.view = "chart"; st.due = []; st.prn = []; st.unscheduled = []; st.problems = []; st.criticals = []; st.balance = null; st.outbox = [];
      st.err = ""; st.note = ""; st.refusal = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); return;
    }
    if (cmd === "summary") {
      var sel = st.sel; if (!sel) return;
      if (!(G.DISCHARGE && G.DISCHARGE.open)) { st.err = "The discharge summary is unavailable on this build."; paint(); return; }
      G.DISCHARGE.open({ orgId: st.orgId, encounterId: sel.encounterId, patientId: sel.patientId });
      return;
    }
    if (cmd === "ack") { acknowledge(arg); return; }
    if (cmd === "move") { transfer(); return; }
    if (cmd === "fluid") { chartFluid(); return; }
    if (cmd === "balance") { loadBalance(); return; }
    if (cmd === "vitals") { saveVitals(); return; }
    if (cmd === "round") { st.from = val("wFrom") || st.from; st.to = val("wTo") || st.to; loadRound(); return; }
    if (cmd === "mar") { var k = arg.indexOf("|"); if (k > 0) marAction(arg.slice(0, k), Number(arg.slice(k + 1))); return; }
    if (cmd === "outbox") { loadOutbox(); return; }
    if (cmd === "cosigns") { loadCosigns(); return; }
    if (cmd === "quality") { loadQuality(); return; }
    if (cmd === "overrides") { loadOverrides(); return; }
    if (cmd === "problem") { addProblem(); return; }
    if (cmd === "icd") { findCode(); return; }
    if (cmd === "pickTpl") { st.noteTemplateId = val("wNoteTpl"); st.noteResult = null; paint(); return; }
    if (cmd === "note") { saveNote(); return; }
    if (cmd === "icdpick") { pickCode(Number(arg)); return; }
    if (cmd === "resolve") { resolveProblem(arg); return; }
    if (cmd === "downtime") { loadDowntime(); return; }
    if (cmd === "printpack") { try { G.print(); } catch (e) {} return; }
    if (cmd === "cosign") { cosign(arg); return; }
    if (cmd === "submitnote") { submitNote(arg); return; }
    if (cmd === "tx") { transmit(arg); return; }
    if (cmd === "txr") { resolveTx(arg); return; }
  }

  function open(opts) {
    opts = opts || {};
    st.orgId = opts.orgId || st.orgId || "";
    if (!st.orgId) { try { G.toast && G.toast("The ward needs a hospital."); } catch (e) {} return; }
    st.view = "list"; st.sel = null; st.loaded = false; st.err = ""; st.note = ""; st.refusal = null;
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    paint(); loadWard();
  }
  function close() { var el = root(); el.classList.remove("on"); el.innerHTML = ""; }

  G.WARD = { open: open, close: close, _render: _render, _st: st, _nextFor: nextFor, _problem: problem };
})();
