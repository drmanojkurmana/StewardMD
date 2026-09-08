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
    problems: [], criticals: [], balance: null, outbox: [], cosign: null, downtime: null, quality: null, pcopy: null,
    /* Held from other systems. null until asked, an object once answered, and a separate error
     * string when the list could not be read: an unreadable queue of held clinical data must never
     * look like an empty one. */
    xchg: null, xchgErr: "",
    /* The terminology search: null while it runs, an array once it answers, undefined when nobody has
     * asked. Three states, because "searching" and "no matches" must not look the same. */
    icd: undefined, probText: "", probCode: "",
    templates: [], noteTemplateId: "", noteResult: null, overrides: null,
    due: [], prn: [], unscheduled: [], truncated: false,
    from: "", to: "",          // the window being viewed, NOT a claim about when a dose is due
    // Bed board + admission. board: null until loaded, {wards:[...]} once read. admitTarget: the
    // ward/bed a person clicked, or null - nothing is admitted until a real patient is confirmed.
    board: null, boardErr: "", admitTarget: null, mrnLookup: null, mrnLookupErr: "",
    flowsheet: null, news2: null,
    investigations: null, results: null,
    drugOrder: { drug: "", value: "", unit: "", route: "", frequency: "" },
    invOrder: { code: "", display: "", category: "laboratory", priority: "routine", reason: "" },
    // Emergency department. ed: null until loaded, {patients:[...]} once read (the ED board -
    // untriaged first, same shape discipline as the ward list). edArrivalOpen: whether the arrival
    // panel is showing. edMrnLookup/edMrnLookupErr: the SAME confirm-before-admit pattern the bed
    // board already uses - nobody arrives on a typed MRN alone.
    ed: null, edErr: "", edArrivalOpen: false, edMrnLookup: null, edMrnLookupErr: "", edAdmitPending: false,
    resusBundles: null, resusStarting: false,
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
      '<button class="w-btn" data-w-act="board" title="Admit a patient to a bed">' + ms("add_circle") + "Admit</button>" +
      '<button class="w-btn ghost" data-w-act="edboard" title="Emergency department">' + ms("emergency") + "ED</button>" +
      // Reachable BEFORE an outage, which is the only time it can be taken. A pack you can only get
      // to while the system is up is a pack the ward has to remember to take while the system is up.
      '<button class="w-btn ghost" data-w-act="downtime" title="Printable sheet for when the system is unavailable">' + ms("print") + "Downtime pack</button></div>" +
      (rows || (state.loaded ? '<p class="w-empty">No patients are currently admitted' + (state.ward ? " to " + esc(state.ward) : "") + ".</p>" : '<p class="w-empty">Loading the ward…</p>')) +
      "</div>" + xchgCard(state) + cosignCard(state) + qualityCard(state) + overrideCard(state);
  }

  /* THE BED BOARD. Every configured ward, every bed, occupied or free - from the record itself
   * (GET /ward/beds), never guessed at. Admitting is a two-step act on purpose: PICK A BED, then
   * NAME THE PATIENT. A form that took a patient first and a bed second is how "admit to whichever
   * bed is free" quietly becomes "admit to bed 4" when bed 4 was actually taken a minute ago -
   * picking the bed from the board's own live occupancy is what keeps that from happening.
   *
   * NOBODY IS ADMITTED ON A TYPED MRN ALONE. Existing-patient admission looks the patient up first
   * and shows their name for a human to confirm; a mistyped digit in an MRN must never silently
   * admit the wrong person's chart into a bed. A new patient goes through the SAME registration
   * sheet the front desk uses (SMD_PATIENTREG) - one form, not a second one that could drift from it. */
  function boardView(state) {
    var wards = (state.board && state.board.wards) || [];
    var t = state.admitTarget;
    var wardsHtml = wards.map(function (w) {
      var occ = (w.occupied || []).map(function (o) {
        return '<div class="w-bedcell occ"><b>' + esc(o.bed) + '</b><span>' + esc(o.patientId) + "</span></div>";
      }).join("");
      // Which free cell is highlighted as "picked" - a UI selection compare against what the board
      // itself already reported as free, never a computation of whether a bed IS free.
      var isPicked = function (b) { return !!t && t.ward === w.ward && String(t.bed) === String(b); };
      var free = w.bedsKnown ? (w.free || []).map(function (b) {
        return '<button class="w-bedcell free' + (isPicked(b) ? " picked" : "") + '" data-w-act="pickbed:' + esc(w.ward) + "|" + esc(b) + '"><b>' + esc(b) + "</b><span>Free</span></button>";
      }).join("") : '<div class="w-bedcell unknown"><span>Bed list not configured</span></div>';
      var unplaced = (w.unplaced || []).map(function (o) {
        return '<div class="w-bedcell occ"><b>&mdash;</b><span>' + esc(o.patientId) + " (no bed assigned)</span></div>";
      }).join("");
      return '<div class="w-wardrow"><h4>' + esc(w.ward) + "<small>" + esc((w.occupied || []).length) + " occupied" + (w.bedsKnown ? " &middot; " + esc((w.free || []).length) + " free" : "") + "</small></h4>" +
        '<div class="w-bedgrid">' + occ + free + unplaced + "</div></div>";
    }).join("");

    var lookup = state.mrnLookup;
    var admitPanel = !t ? "" :
      '<div class="w-card admit"><div class="w-card-h">' + ms("bed") + "<h3>Admit to " + esc(t.ward) + ", bed " + esc(t.bed) + "</h3>" +
        '<button class="w-ic" data-w-act="unpickbed" title="Choose a different bed">' + ms("close") + "</button></div>" +
        '<div class="w-sub"><h4>' + ms("badge") + "Existing patient (by MRN)</h4>" +
        '<div class="w-filter"><input id="wAdmitMrn" type="text" autocomplete="off" placeholder="MRN">' +
        '<button class="w-btn ghost" data-w-act="mrnlookup">' + ms("search") + "Find</button></div>" +
        (state.mrnLookupErr ? '<p class="w-hint warn">' + ms("error") + esc(state.mrnLookupErr) + "</p>" : "") +
        (lookup ? '<div class="w-mrn-found"><b>' + esc(lookup.name || lookup.mrn) + "</b><span>" + esc(lookup.mrn) +
          (lookup.ageYears != null ? " &middot; " + esc(lookup.ageYears) + "y" : "") + (lookup.gender ? " &middot; " + esc(lookup.gender) : "") + "</span>" +
          '<button class="w-btn tiny go" data-w-act="admitconfirm">' + ms("check") + "This is the patient - admit</button></div>" : "") +
        "</div>" +
        '<div class="w-sub"><h4>' + ms("person_add") + "New patient</h4>" +
        '<p class="w-hint">Opens the same check-in sheet used at the front desk.</p>' +
        '<button class="w-btn" data-w-act="admitnew">' + ms("person_add") + "Register &amp; admit</button></div>" +
      "</div>";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      '<div><b>Bed board</b></div>' +
      '<button class="w-ic" data-w-act="board" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card">' +
      (state.boardErr ? '<p class="w-hint warn">' + ms("error") + esc(state.boardErr) + "</p>"
        : wardsHtml || '<p class="w-empty">No admissions and no bed lists configured.</p>') +
      "</div>" + admitPanel;
  }

  /* THE ED BOARD. A worklist, not an arrival log - the server itself sorts untriaged patients
   * first, then by acuity, then by wait (listEd(), migrate-ed.js), so the same screen that lists
   * who is here is also the answer to "who needs a nurse's eyes right now". Nothing here computes
   * an acuity; the board only ever shows what a human has already recorded (or that nobody has
   * yet). Arrival is a separate, explicit panel - the same "pick a real fact, then confirm" shape
   * the bed board's admit panel already uses. */
  var ACUITY_WORDS = { 1: "1 - Immediate", 2: "2 - Emergent", 3: "3 - Urgent", 4: "4 - Less urgent", 5: "5 - Non-urgent" };
  function edBoardView(state) {
    var rows = (state.ed && state.ed.patients || []).map(function (p) {
      return "<li>" + '<button class="w-bed" data-w-act="openEd:' + esc(p.encounterId) + '">' +
        '<span class="w-bed-no' + (p.acuity == null ? " untriaged" : " acuity-" + esc(p.acuity)) + '">' + (p.acuity == null ? ms("priority_high") : esc(p.acuity)) + "</span>" +
        '<span class="w-bed-b"><b>' + esc(p.mrn || p.patientId) + "</b><small>" + esc(p.chiefComplaint || "No chief complaint recorded") + " &middot; arrived " + when(p.arrivedAt) + "</small></span>" +
        ms("chevron_right") + "</button></li>";
    }).join("");

    var lookup = state.edMrnLookup;
    var arrivalPanel = !state.edArrivalOpen ? "" :
      '<div class="w-card admit"><div class="w-card-h">' + ms("emergency") + "<h3>New arrival</h3>" +
      '<button class="w-ic" data-w-act="edarrivalclose" title="Cancel">' + ms("close") + "</button></div>" +
      '<div class="w-sub"><h4>' + ms("badge") + "Known patient (by MRN)</h4>" +
      '<div class="w-filter"><input id="wEdMrn" type="text" autocomplete="off" placeholder="MRN">' +
      '<button class="w-btn ghost" data-w-act="edmrnlookup">' + ms("search") + "Find</button></div>" +
      (state.edMrnLookupErr ? '<p class="w-hint warn">' + ms("error") + esc(state.edMrnLookupErr) + "</p>" : "") +
      (lookup ? '<div class="w-mrn-found"><b>' + esc(lookup.name || lookup.mrn) + "</b><span>" + esc(lookup.mrn) +
        (lookup.ageYears != null ? " &middot; " + esc(lookup.ageYears) + "y" : "") + (lookup.gender ? " &middot; " + esc(lookup.gender) : "") + "</span>" +
        '<button class="w-btn tiny go" data-w-act="edarriveknown">' + ms("check") + "This is the patient - arrival</button></div>" : "") +
      "</div>" +
      '<div class="w-sub"><h4>' + ms("person_off") + "Unidentified patient</h4>" +
      '<p class="w-hint">' + ms("info") + "Assigns a provisional MRN this hospital's own scheme generates (never invented on screen), pending identification and a later merge." + "</p>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Sex</span><select id="wEdSex"><option value="unknown">Not known</option><option value="male">Male</option><option value="female">Female</option></select></label>' +
      '<label class="w-f"><span>Chief complaint</span><input id="wEdUnkCc" type="text" autocomplete="off" placeholder="e.g. found down, unresponsive"></label>' +
      "</div>" +
      '<button class="w-btn warn" data-w-act="edarriveunknown">' + ms("person_add") + "Arrive as unidentified</button></div>" +
      "</div>";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Emergency department</b></div>" +
      '<button class="w-btn tiny go" data-w-act="edarrivalopen">' + ms("add_circle") + "Arrival</button>" +
      '<button class="w-ic" data-w-act="edboard" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card">' +
      (state.edErr ? '<p class="w-hint warn">' + ms("error") + esc(state.edErr) + "</p>"
        : rows ? '<ul class="w-q w-ed-board">' + rows + "</ul>"
        : '<p class="w-empty">No patients currently in the ED.</p>') +
      "</div>" + arrivalPanel;
  }

  /* HELD FROM OTHER SYSTEMS. Everything here is something another system sent that WardSynQ would
   * not file without a person deciding: a patient who might be one of two, a record another feed
   * owns, a fact re-sent for a different person. NOTHING ON THIS CARD IS ON A CHART YET.
   *
   * THE SCREEN OFFERS ONLY THE DECISIONS THAT FIT. The server refuses a resolution that does not fit
   * the reason, and the screen mirrors that table as a display convenience so nobody is offered a
   * button that is certain to be refused; the server remains the authority. A patient-mismatch
   * conflict can never be accepted from the feed, and keeping it as ours would file a fact that
   * belongs to a different person onto this one's chart - so only reject is offered for it.
   *
   * NO DECISION IS EVER PRESELECTED. An identity or resolution choice a clinician never touched is
   * not a decision they made; the candidate list and the decision dropdown both start unchosen, and
   * deciding is refused until something is actually picked.
   *
   * A REASON IS REQUIRED AND SHOWN AS REQUIRED. It is read next year by somebody asking why. */
  var XCHG_WORDS = {
    "identity-ambiguous": "More than one patient here carries this identifier.",
    "identity-probable-duplicate": "No identifier matched, but a patient here looks like this person.",
    "conflict-local-authoritative": "This hospital authored the current version of this record.",
    "conflict-other-source": "Another feed authored the current version of this record.",
    "conflict-patient-mismatch": "The feed re-sent this record for a different patient. It cannot be accepted or kept; it can only be rejected.",
    "version-mismatch": "The feed updated a version that is no longer current.",
    "unsupported-resource": "A kind of record WardSynQ does not import.",
    "invalid-resource": "The record could not be understood."
  };
  var XCHG_FITS = {
    "identity-ambiguous": ["link", "create", "reject"],
    "identity-probable-duplicate": ["link", "create", "reject"],
    "conflict-local-authoritative": ["accept-feed", "keep-local"],
    "conflict-other-source": ["accept-feed", "keep-local"],
    "conflict-patient-mismatch": ["reject"]
  };
  var XCHG_RES = {
    link: "Link - this IS the patient chosen below; file the message on their chart",
    create: "Create - nobody here is this patient; register them from the message",
    reject: "Reject - file nothing",
    "accept-feed": "Accept the feed's version - it becomes the next version of OUR record, attributed to the feed",
    "keep-local": "Keep ours - the feed's version is not filed"
  };
  function xchgFits(reason) { return XCHG_FITS[reason] || ["reject"]; }
  function xchgCard(state) {
    var q = state.xchg;
    var open = (q && q.open) || [];
    var rows = open.map(function (x) {
      var fits = xchgFits(x.reason);
      var cands = (x.candidates || []).map(function (c, i) {
        return '<label class="w-xc"><input type="radio" name="wxP-' + esc(x.id) + '" value="' + esc(c.id) + '"> <b>' + esc(c.id) + "</b>" +
          (c.mrn ? ' <span class="w-code">' + esc(c.mrn) + "</span>" : "") +
          (c.band ? " <small>" + esc(c.band) + (c.score != null ? " " + esc(Math.round(Number(c.score) * 100) / 100) : "") + "</small>" : "") + "</label>";
      }).join("");
      var opts = '<option value="">Choose&hellip;</option>' + fits.map(function (r) { return '<option value="' + esc(r) + '">' + esc(XCHG_RES[r] || r) + "</option>"; }).join("");
      return '<li class="w-xchg-row">' +
        "<h4>" + esc(x.reason) + ' <span class="w-code">' + esc(x.source || "") + "</span></h4>" +
        '<p class="w-xw">' + esc(XCHG_WORDS[x.reason] || "") + (x.detail ? " " + esc(x.detail) : "") + "</p>" +
        "<small>Raised " + when(x.raisedAt) + " &middot; " + esc((x.entityRefs || []).length) + " record" + ((x.entityRefs || []).length === 1 ? "" : "s") + " held" +
        (x.conflict ? " &middot; ours: " + esc(x.conflict.resourceType || "") + "/" + esc(x.conflict.id || "") + " v" + esc(x.conflict.version == null ? "?" : x.conflict.version) + " (" + esc(x.conflict.source || "") + ")" : "") + "</small>" +
        (cands ? '<div class="w-xcs"><span class="w-xl">Which patient here, if any:</span>' + cands + "</div>" : "") +
        (fits.indexOf("link") >= 0 && !cands ? '<label class="w-xl">Local patient id for a link<input id="wxPid-' + esc(x.id) + '" type="text" autocomplete="off"></label>' : "") +
        '<label class="w-xl">Decision<select id="wxR-' + esc(x.id) + '">' + opts + "</select></label>" +
        '<label class="w-xl">Why (required)<textarea id="wxW-' + esc(x.id) + '" rows="2" placeholder="In a sentence somebody can read next year"></textarea></label>' +
        '<div class="w-dose-a"><button class="w-btn tiny go" data-w-act="xchg:' + esc(x.id) + '">' + ms("gavel") + "Decide</button></div>" +
        "</li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("swap_horiz") + "<h3>Held from other systems" + (open.length ? " &middot; " + open.length : "") + "</h3>" +
      '<button class="w-ic" data-w-act="xchgs" title="Refresh">' + ms("refresh") + "</button></div>" +
      (state.xchgErr ? '<p class="w-hint warn">' + ms("warning") + esc(state.xchgErr) + "</p>"
        : rows ? '<ul class="w-q w-xchg">' + rows + "</ul>"
        : (q ? '<p class="w-empty">Nothing is held from another system.</p>' : '<p class="w-empty">Loading the exchange queue&hellip;</p>')) +
      (rows ? '<p class="w-hint">' + ms("info") + "Nothing here is on a chart yet. Deciding needs the right to treat; a decision is recorded under your name and cannot be deleted afterwards.</p>" : "") +
      "</div>";
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
  /* The two an early warning score cannot do without. They are not numbers, so they sit beside the
   * numeric grid rather than in it - and leaving them blank leaves the score INCOMPLETE, which is
   * the honest outcome rather than a reassuring total about a patient nobody finished examining. */
  var ACVPU = [["", "Consciousness: not assessed"], ["A", "A - alert"], ["C", "C - new confusion"], ["V", "V - responds to voice"], ["P", "P - responds to pain"], ["U", "U - unresponsive"]];
  function vitalsCard() {
    var f = VITALS.map(function (v) {
      return '<label class="w-f"><span>' + esc(v.l) + ' <i>' + esc(v.u) + "</i></span>" +
        '<input id="wv_' + v.k + '" type="text" inputmode="decimal" autocomplete="off"></label>';
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>Vitals</h3></div>" +
      '<div class="w-grid">' + f + "</div>" +
      '<div class="w-fluid"><label class="w-f"><span>Supplemental oxygen</span>' +
      '<select id="wv_o2"><option value="">Not recorded</option><option value="0">Breathing air</option><option value="1">On oxygen</option></select></label>' +
      '<label class="w-f"><span>Consciousness <i>ACVPU</i></span><select id="wv_acvpu">' +
      ACVPU.map(function (a) { return '<option value="' + esc(a[0]) + '">' + esc(a[1]) + "</option>"; }).join("") + "</select></label></div>" +
      // Weight is not decoration: a weight-based dose is REFUSED at the bedside until the ward has
      // actually weighed the patient, and this is where that weight comes from.
      '<p class="w-hint">Blank fields are not recorded. A value that is not plainly one number is skipped, never guessed at.</p>' +
      '<button class="w-btn" data-w-act="vitals">' + ms("save") + "Record vitals</button></div>";
  }

  /* THE FLOWSHEET. A grid, not a form: hours across, the hospital's rows down, from the SAME vitals
   * this screen just recorded (and the fluid this chart already charts) - a second write path never
   * existed and none is added here. AN EMPTY CELL IS AN HOUR NOBODY CHARTED, shown as a plain dash,
   * because a blank that looked the same as a normal value would hide exactly the gap a flowsheet
   * exists to show. NEWS2/PEWS sits beside it as a score, never as an escalation: it computes, it
   * pages nobody, and the card says so in the server's own words. */
  function flowsheetCard(state) {
    var g = state.flowsheet, n = state.news2;
    var grid = !g ? '<p class="w-empty">Loading the flowsheet…</p>'
      : !(g.rows || []).length ? '<p class="w-empty">No vitals charted in this window yet.</p>'
      : '<div class="w-flowgrid"><table><thead><tr><th>' + (g.hours || []).map(function (h) { return "<th>" + when(h).replace(/^.* /, "") + "</th>"; }).join("").replace(/^<th>/, "") +
        '</tr></thead><tbody>' + g.rows.map(function (r) {
          return "<tr><th>" + esc(r.label) + "</th>" + r.cells.map(function (c) {
            return "<td" + (c.empty ? ' class="empty"' : c.backfilled ? ' class="late"' : "") + ">" + (c.empty ? "&ndash;" : esc(c.value) + (c.unit ? " " + esc(c.unit) : "")) + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" +
        (g.backfillReading ? '<p class="w-hint warn">' + ms("warning") + esc(g.backfillReading) + "</p>" : "") +
        (g.note ? '<p class="w-hint">' + ms("info") + esc(g.note) + "</p>" : "");

    var score = !n ? "" : !n.score || n.score.scorable === false
      ? '<div class="w-news2 na"><b>' + esc(n.tool || "NEWS2") + "</b><span>" + esc((n.score && n.score.reason) || n.note || "Not enough recorded to score.") + "</span></div>"
      : '<div class="w-news2 risk-' + esc(n.score.risk || "low") + '"><b>' + esc(n.score.total) + "</b><span>" + esc(n.tool) + " &middot; " + esc(n.score.risk || "") + " risk</span></div>";

    return '<div class="w-card"><div class="w-card-h">' + ms("monitoring") + "<h3>Flowsheet</h3>" +
      '<button class="w-ic" data-w-act="flowsheet" title="Refresh">' + ms("refresh") + "</button></div>" +
      score + grid +
      '<p class="w-hint">' + ms("info") + "This is a score, not an escalation. Nothing here pages anyone.</p></div>";
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

  /* PRESCRIBING. Writes ONE thing: a MedicationOrder, through the same door the round already reads
   * from - there is no separate "order" model here, so an order placed here appears on the round the
   * moment it is reloaded. NO SAFETY CHECK LIVES HERE: the formulary/restriction/advisory answer
   * comes back on the response and is shown VERBATIM, exactly like every other refusal on this
   * screen. A dose is never computed for the prescriber; value and unit are typed, not derived. */
  function medOrderCard(state) {
    var o = state.drugOrder || {};
    return '<div class="w-card"><div class="w-card-h">' + ms("edit_calendar") + "<h3>New medication order</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Drug</span><input id="wMoDrug" type="text" autocomplete="off" value="' + esc(o.drug || "") + '"></label>' +
      '<label class="w-f"><span>Dose</span><input id="wMoValue" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.value || "") + '"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wMoUnit" type="text" autocomplete="off" placeholder="mg" value="' + esc(o.unit || "") + '"></label>' +
      '<label class="w-f"><span>Route</span><input id="wMoRoute" type="text" autocomplete="off" placeholder="oral" value="' + esc(o.route || "") + '"></label>' +
      '<label class="w-f"><span>Frequency</span><input id="wMoFreq" type="text" autocomplete="off" placeholder="e.g. BD, 8th hourly" value="' + esc(o.frequency || "") + '"></label>' +
      "</div>" +
      '<p class="w-hint">' + ms("info") + "Every safety and formulary check happens on the server. A refusal here is shown in full, exactly as the eMAR shows one.</p>" +
      '<button class="w-btn" data-w-act="medorder">' + ms("send") + "Prescribe</button></div>";
  }

  /* ORDERING AN INVESTIGATION, AND SEEING WHERE IT STANDS. One card, three honest states: not yet
   * collected (from GET /ward/collections, the phlebotomy worklist itself), collected and awaiting a
   * report (from GET /ward/pending-tests), and resulted (DiagnosticReport, read through the SAME
   * read-only FHIR door the record already exports through - no second results store exists to
   * build, and none is invented here). Nothing here releases or interprets a result; that authority
   * stays with lab-result.js and is reached from wherever a report actually gets entered. */
  var INV_CATEGORY = [["laboratory", "Laboratory"], ["imaging", "Imaging"], ["procedure", "Procedure"], ["other", "Other"]];
  var INV_PRIORITY = [["routine", "Routine"], ["urgent", "Urgent"], ["stat", "STAT"]];
  function investigationsCard(state) {
    var o = state.invOrder || {};
    var inv = state.investigations;
    var coll = (inv && inv.requests) || [];
    var pend = (inv && inv.pending) || [];
    var pendIds = {}; pend.forEach(function (p) { pendIds[p.serviceRequestId] = 1; });

    var rows = coll.map(function (c) {
      var st_ = (c.collection && c.collection.state) || "ordered";
      return "<li><b>" + esc(c.display || c.code) + "</b> <span>" + esc(c.category || "") + (c.priority && c.priority !== "routine" ? " &middot; " + esc(c.priority).toUpperCase() : "") + "</span>" +
        '<span class="w-st ' + esc(st_) + '">' + esc(st_.replace(/_/g, " ")) + "</span></li>";
    }).join("");

    var results = (state.results || []).map(function (r) {
      return "<li><b>" + esc(r.display) + "</b> <span>" + esc(r.status || "") + "</span>" +
        (r.conclusion ? "<div>" + esc(r.conclusion) + "</div>" : "") +
        '<small>' + when(r.reportedAt) + "</small></li>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("science") + "<h3>Investigations</h3>" +
      '<button class="w-ic" data-w-act="investigations" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Test</span><input id="wInvCode" type="text" autocomplete="off" placeholder="e.g. Chest X-ray" value="' + esc(o.display || "") + '"></label>' +
      '<label class="w-f"><span>Category</span><select id="wInvCat">' + INV_CATEGORY.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (o.category === c[0] ? " selected" : "") + ">" + esc(c[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Priority</span><select id="wInvPri">' + INV_PRIORITY.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (o.priority === c[0] ? " selected" : "") + ">" + esc(c[1]) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      '<label class="w-f"><span>Reason (optional)</span><input id="wInvReason" type="text" autocomplete="off"></label>' +
      '<button class="w-btn" data-w-act="investigation">' + ms("send") + "Order</button>" +
      (rows ? '<div class="w-sub"><h4>' + ms("checklist") + "On order</h4><ul class=\"w-mini\">" + rows + "</ul></div>" : "") +
      (results ? '<div class="w-sub"><h4>' + ms("fact_check") + "Results</h4><ul class=\"w-mini w-results\">" + results + "</ul></div>" : "") +
      "</div>";
  }

  function chartView(state) {
    var s = state.sel || {};
    var isEd = s.class === "ED";
    var header = isEd
      ? '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        "<div><b>" + esc(s.mrn || s.patientId || "") + "</b><small>" + ms("emergency", true) + "ED" +
        (s.chiefComplaint ? " &middot; " + esc(s.chiefComplaint) : "") + " &middot; arrived " + when(s.arrivedAt) + "</small></div>" +
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>"
      : '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        "<div><b>" + esc(s.patientId || "") + "</b><small>" + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + " &middot; admitted " + when(s.admittedAt) + "</small></div>" +
        // The summary is reachable from the patient, not from a menu somewhere else. A planned
        // discharge is prepared while the patient is still on the ward, so this is not gated on the
        // stay being closed - the summary screen states plainly when a stay is still open.
        '<button class="w-btn ghost" data-w-act="move" title="Transfer to another ward or bed">' + ms("swap_horiz") + "Transfer</button>" +
        '<button class="w-btn ghost" data-w-act="summary" title="Discharge summary">' + ms("description") + "Summary</button>" +
        // The patient's own copy. Reachable from the patient because that is where the conversation
        // that produces it happens, not from a menu somewhere else.
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>";

    return header +
      criticalsCard(state) + (isEd ? triageCard(state) : "") + problemsCard(state) + noteCard(state) + vitalsCard() + flowsheetCard(state) + fluidCard(state) +
      (isEd ? resusCard(state) : "") +
      medOrderCard(state) + marCard(state) + outboxCard(state) + investigationsCard(state) +
      (isEd ? dispositionCard(state) : "");
  }

  /* TRIAGE. The acuity is a human's choice, made once, shown plainly once made - and this card
   * NEVER computes one from the vitals sitting right below it on the same chart. The words each
   * level maps to are ORG content (ACUITY_WORDS is this build's own unapproved seed labelling, not
   * a claim about ESI/CTAS/any named scale); a hospital that has adopted a real one configures its
   * own words the same way note-templates.js already lets it configure its own headings. */
  function triageCard(state) {
    var s = state.sel || {};
    if (s.acuity != null) {
      return '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Triage</h3></div>" +
        '<div class="w-news2 risk-' + (s.acuity <= 2 ? "high" : s.acuity === 3 ? "medium" : "low") + '"><b>' + esc(s.acuity) + "</b><span>" + esc(ACUITY_WORDS[s.acuity] || "") + "</span></div>" +
        '<p class="w-hint">' + ms("info") + "Triaged " + when(s.triagedAt) + ". Not clinically validated content - this hospital's own scale." + "</p></div>";
    }
    var opts = Object.keys(ACUITY_WORDS).map(function (k) { return '<option value="' + k + '">' + esc(ACUITY_WORDS[k]) + "</option>"; }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Triage</h3></div>" +
      '<p class="w-hint warn">' + ms("warning") + "Not yet triaged.</p>" +
      '<label class="w-f"><span>Acuity</span><select id="wTriageAcuity"><option value="">Choose&hellip;</option>' + opts + "</select></label>" +
      '<button class="w-btn" data-w-act="triage">' + ms("save") + "Record triage</button></div>";
  }

  /* RESUSCITATION. The bundle is wardsynq-emergency.js's own tested state machine, run for real
   * (functions/_wardsynq/migrate-resus.js); this card renders exactly what it reports and starts
   * or marks nothing on its own - a bundle is "a clinical commitment", in that file's own words,
   * never opened by a screen. STATUS: not clinically validated, per that file's header. */
  function resusCard(state) {
    var bundles = state.resusBundles || [];
    var running = bundles.filter(function (b) { return b.state === "running" || b.state === "breached"; });
    var rows = running.map(function (b) {
      var els = b.elements.map(function (e) {
        return "<li" + (e.done ? "" : e.overdue ? ' class="overdue"' : "") + '><div class="w-dose-h"><b>' + esc(e.label) + "</b>" +
          (e.done ? '<span class="w-st administered">done ' + when(e.doneAt) + "</span>" : e.overdue ? '<span class="w-st overdue">overdue</span>' : '<span class="w-st">' + esc(Math.round(e.minutesRemaining || 0)) + " min left</span>") +
          "</div>" +
          (!e.done && !e.notApplicable ? '<div class="w-dose-a"><button class="w-btn tiny go" data-w-act="resusmark:' + esc(b.bundleId) + "|" + esc(e.key) + '">' + ms("task_alt") + "Mark done</button></div>" : "") +
          "</li>";
      }).join("");
      return '<div class="w-sub"><h4>' + ms("emergency") + esc(b.label) + '<span class="w-st ' + (b.state === "breached" ? "overdue" : "") + '">' + esc(b.state) + "</span></h4>" +
        "<ul class=\"w-doses\">" + els + "</ul>" +
        '<button class="w-btn tiny warn" data-w-act="resusvoid:' + esc(b.bundleId) + '">' + ms("cancel") + "Void bundle</button></div>";
    }).join("");

    return '<div class="w-card"><div class="w-card-h">' + ms("emergency") + "<h3>Resuscitation</h3>" +
      '<button class="w-ic" data-w-act="resusload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows || '<p class="w-empty">No resuscitation bundle running.</p>') +
      '<div class="w-filter"><select id="wResusCode"><option value="code-sepsis">Code Sepsis</option><option value="code-blue">Code Blue</option><option value="code-stemi">Code STEMI</option></select>' +
      '<button class="w-btn warn" data-w-act="resusstart">' + ms("add_circle") + "Start bundle</button></div>" +
      '<p class="w-hint">' + ms("info") + "Not clinically validated or approved. Records what happened and when; never doses a drug or instructs anyone." + "</p></div>";
  }

  /* DISPOSITION: the ED visit ends. "Admitted" reuses the SAME bed board an inpatient admission
   * uses - reachable straight from here, not a second admission flow - because an ED patient being
   * admitted needs the SAME bed-occupancy guard any admission needs. */
  function dispositionCard(state) {
    return '<div class="w-card"><div class="w-card-h">' + ms("exit_to_app") + "<h3>Disposition</h3></div>" +
      '<p class="w-hint">' + ms("info") + "Ends this ED visit. The chart stays exactly as it is - nothing here is hidden or removed." + "</p>" +
      '<div class="w-dose-a">' +
      '<button class="w-btn" data-w-act="dispositionadmit">' + ms("bed") + "Admit</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:home">' + ms("home") + "Home</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:transferred">' + ms("local_shipping") + "Transfer</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:lwbs">' + ms("directions_walk") + "LWBS</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:deceased">' + ms("healing") + "Deceased</button>" +
      "</div></div>";
  }

  /* The patient's own copy, on screen and on paper. It reuses the downtime pack's print styling
   * deliberately: both are documents that leave the building, and both have to be legible in black
   * and white and honest about what they do not contain.
   *
   * THE WITHHELD ITEMS ARE ON THE PAGE. A result left off silently reads as a test nobody did, which
   * is a more reassuring statement than the truth. Each one prints the sentence the server wrote for
   * the patient, and never the reason code, which is for the clinician and not for them. */
  function pcopyView(state) {
    var r = state.pcopy;
    if (!r) return '<div class="w-card"><p class="w-empty">Preparing the copy…</p></div>';
    var d = r.document || {};
    var p = d.patient || {};

    var list = function (arr, empty, fn) {
      return arr && arr.length ? "<ul class=\"w-dt-meds\">" + arr.map(fn).join("") + "</ul>" : '<p class="w-empty">' + empty + "</p>";
    };

    /* The allergies are never filtered by anything, and an empty list is stated in words. A blank
     * allergy block reads as "no known allergies" to every clinician alive, and this page is one a
     * patient carries to the next hospital. */
    var allergies = d.allergies && d.allergies.length
      ? d.allergies.map(function (a) { return "<b>" + esc(a.substance) + "</b>" + (a.reaction ? " (" + esc(a.reaction) + ")" : ""); }).join(", ")
      : "No allergies are recorded for you. Tell your care team if you know of any.";

    var withheld = (d.withheldResults || []).length
      ? '<section class="w-dt-p"><h3>Not included here</h3>' +
        "<ul class=\"w-dt-meds\">" + d.withheldResults.map(function (w) {
          return "<li>" + esc(w.say) + (w.reportedAt ? ' <span class="w-dt-times">' + when(w.reportedAt) + "</span>" : "") + "</li>";
        }).join("") + "</ul></section>"
      : "";

    return '<div class="w-dt">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      '<button class="w-btn" data-w-act="printpack">' + ms("print") + "Print</button>" +
      '<button class="w-btn ghost" data-w-act="pcopyGive" title="Record that you gave this to the patient">' + ms("how_to_reg") + "Record handover</button>" +
      '<button class="w-btn ghost" data-w-act="pcopy">' + ms("refresh") + "Refresh</button></div>" +
      '<header class="w-dt-h"><h2>Your record</h2>' +
      "<p><b>" + esc(p.name || r.patientId || "") + "</b>" + (p.mrn ? " &middot; " + esc(p.mrn) : "") + (p.dob ? " &middot; " + esc(p.dob) : "") + "</p>" +
      /* Two audiences, and they are never mixed. `statements` is addressed to the patient and
       * prints. `clinicianWarnings` is w-noprint: a line reading "not for the patient" printed on
       * the patient's own copy would be the most careless thing on the page. */
      (r.statements || []).map(function (s) { return '<p class="w-dt-warn">' + esc(s) + "</p>"; }).join("") +
      (r.clinicianWarnings || []).map(function (s) { return '<p class="w-dt-gap w-noprint">' + esc(s) + "</p>"; }).join("") +
      (r.release ? '<p class="w-ok w-noprint">Handover recorded at ' + when(r.release.at) + ".</p>" : "") +
      "</header>" +
      '<section class="w-dt-p"><h3>Allergies</h3><p class="w-dt-alg">' + allergies + "</p></section>" +
      '<section class="w-dt-p"><h3>Your diagnoses</h3>' +
      list(d.diagnoses, "No diagnoses are recorded.", function (x) {
        return "<li><b>" + esc(x.display) + "</b>" + (x.note ? '<div class="w-dt-times">' + esc(x.note) + "</div>" : "") + "</li>";
      }) + "</section>" +
      '<section class="w-dt-p"><h3>Your medicines</h3>' +
      list(d.medicines, "No medicines are recorded.", function (m) {
        return "<li><b>" + esc(m.drug) + "</b> " + dose(m.dose) + (m.route ? " &middot; " + esc(m.route) : "") +
          (m.frequency ? '<div class="w-dt-times">' + esc(m.frequency) + "</div>" : "") + "</li>";
      }) + "</section>" +
      '<section class="w-dt-p"><h3>Your results</h3>' +
      list(d.results, "No results are ready to be given to you yet.", function (x) {
        return "<li><b>" + esc(x.name) + "</b>" + (x.conclusion ? "<div>" + esc(x.conclusion) + "</div>" : "") +
          '<div class="w-dt-times">' + when(x.reportedAt) + "</div></li>";
      }) + "</section>" +
      withheld +
      '<section class="w-dt-p"><h3>Next appointments</h3>' +
      list(d.appointments, "No appointment is booked.", function (a) {
        return "<li>" + when(a.at) + (a.with ? " &middot; " + esc(a.with) : "") + "</li>";
      }) + "</section>" +
      "</div>";
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
      (state.view === "chart" ? chartView(state)
        : state.view === "downtime" ? downtimeView(state)
        : state.view === "pcopy" ? pcopyView(state)
        : state.view === "board" ? boardView(state)
        : state.view === "ed" ? edBoardView(state)
        : listView(state)) + "</div></div>";
  }

  // ---- controller --------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdWard"); if (!el) { el = document.createElement("div"); el.id = "smdWard"; document.body.appendChild(el); } return el; }
  function paint() { root().innerHTML = _render(st); }

  function loadWard() {
    st.busy = true; paint();
    return apiGet("/ward/list?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { if (settle(r)) st.patients = r.patients || []; st.loaded = true; paint(); return Promise.all([loadCosigns(), loadQuality(), loadOverrides(), loadExceptions()]); })
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

  // ---- bed board + admission ----------------------------------------------------------------
  function loadBoard() {
    st.busy = true; st.view = "board"; st.boardErr = ""; paint();
    return apiGet("/ward/beds?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.board = r; else st.boardErr = (r && (r.detail || r.message || r.error)) || "Could not load the bed board.";
        paint();
      })
      .catch(function () { st.busy = false; st.boardErr = "Could not reach the bed board."; paint(); });
  }
  function pickBed(ward, bed) {
    // An ED disposition-to-admit already knows who the patient is (st.sel) - picking a bed fires
    // the disposition directly, never through the admit panel's own MRN-lookup/register flow,
    // which is for a patient the board does not already have open.
    if (st.edAdmitPending) { st.edAdmitPending = false; edDispose("admitted", { admission: { ward: ward, bed: bed } }); return; }
    st.admitTarget = { ward: ward, bed: bed }; st.mrnLookup = null; st.mrnLookupErr = ""; paint();
  }
  /* The one write in this whole flow: an Encounter, exactly as /ward/transfer and every other admit
   * caller writes it. Nothing here invents a second admission path. */
  function doAdmit(mrn) {
    var t = st.admitTarget; if (!t || !mrn) return;
    st.busy = true; paint();
    apiPost("/ward/admit", { orgId: st.orgId, mrn: mrn, ward: t.ward, bed: t.bed, admittedAt: new Date().toISOString() })
      .then(function (r) {
        if (r && r.error === "no_patient_identity") { st.busy = false; st.err = "That MRN is not registered here."; paint(); return; }
        if (settle(r, r && r.written ? "Admitted to " + t.ward + ", bed " + t.bed + "." : "Already admitted there.")) {
          st.admitTarget = null; st.mrnLookup = null; st.view = "list"; loadWard();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not admit the patient."; paint(); });
  }
  /* NEVER ADMITS ON THE TYPED MRN ALONE. This looks the patient up and shows their name; admitting
   * is a second, separate click (admitconfirm) once a human has read who it is. */
  function mrnLookup() {
    var mrn = val("wAdmitMrn");
    if (!mrn) { st.mrnLookupErr = "Enter an MRN."; st.mrnLookup = null; paint(); return; }
    st.busy = true; st.mrnLookupErr = ""; st.mrnLookup = null; paint();
    apiGet("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok && r.patient) st.mrnLookup = Object.assign({ mrn: mrn }, r.patient);
        else st.mrnLookupErr = "No patient found with that MRN.";
        paint();
      })
      .catch(function () { st.busy = false; st.mrnLookupErr = "Could not look up that MRN."; paint(); });
  }
  function admitConfirm() { if (st.mrnLookup) doAdmit(st.mrnLookup.mrn); }
  /* NEW PATIENT: the SAME check-in sheet the front desk uses (SMD_PATIENTREG), not a second form
   * that could drift from it. Registration and admission are two writes, in order - a registration
   * that succeeds but whose admit then fails still leaves a real, findable patient record; it is
   * never silently discarded. */
  function admitNew() {
    var t = st.admitTarget; if (!t) return;
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { st.err = "Registration is unavailable on this build."; paint(); return; }
    G.SMD_PATIENTREG.open({
      submit: function (payload) { return apiPost("/patient/register", Object.assign({ orgId: st.orgId }, payload)); },
      onAdded: function (r) { if (r && r.mrn) doAdmit(r.mrn); },
    });
  }

  // ---- emergency department ----------------------------------------------------------------
  function loadEd() {
    st.busy = true; st.view = "ed"; st.edErr = ""; paint();
    return apiGet("/ward/ed-list?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.ed = r; else st.edErr = (r && (r.detail || r.message || r.error)) || "Could not load the ED board.";
        paint();
      })
      .catch(function () { st.busy = false; st.edErr = "Could not reach the ED."; paint(); });
  }
  function edMrnLookup() {
    var mrn = val("wEdMrn");
    if (!mrn) { st.edMrnLookupErr = "Enter an MRN."; st.edMrnLookup = null; paint(); return; }
    st.busy = true; st.edMrnLookupErr = ""; st.edMrnLookup = null; paint();
    apiGet("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok && r.patient) st.edMrnLookup = Object.assign({ mrn: mrn }, r.patient);
        else st.edMrnLookupErr = "No patient found with that MRN.";
        paint();
      })
      .catch(function () { st.busy = false; st.edMrnLookupErr = "Could not look up that MRN."; paint(); });
  }
  function edArrive(arrival) {
    st.busy = true; paint();
    apiPost("/ward/ed-arrival", { orgId: st.orgId, arrival: arrival })
      .then(function (r) {
        if (settle(r, r && r.written ? "Arrived." : "Already arrived.")) {
          st.edArrivalOpen = false; st.edMrnLookup = null; loadEd();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the arrival."; paint(); });
  }
  function edArriveKnown() { if (st.edMrnLookup) edArrive({ mrn: st.edMrnLookup.mrn }); }
  function edArriveUnknown() {
    var sex = val("wEdSex"), cc = val("wEdUnkCc");
    edArrive({ unknown: { sex: sex }, chiefComplaint: cc || undefined });
  }
  function recordTriage() {
    var s = st.sel; if (!s) return;
    var acuity = val("wTriageAcuity");
    if (!acuity) { st.err = "Choose an acuity level."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/ed-triage", { orgId: st.orgId, encounterId: s.encounterId, acuity: Number(acuity) })
      .then(function (r) {
        if (settle(r, "Triaged.")) { s.acuity = Number(acuity); s.triagedAt = new Date().toISOString(); paint(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record triage."; paint(); });
  }
  function loadResus() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/resus?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (r && r.ok) st.resusBundles = r.bundles; paint(); })
      .catch(function () {});
  }
  function resusStart() {
    var s = st.sel; if (!s) return;
    var code = val("wResusCode");
    st.busy = true; paint();
    apiPost("/ward/resus-start", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, code: code })
      .then(function (r) { if (settle(r, "Bundle started.")) loadResus(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not start the bundle."; paint(); });
  }
  function resusMark(bundleId, key) {
    var event = "";
    try { event = G.prompt("What actually happened (e.g. resulted, collected, administered)?") || ""; } catch (e) { return; }
    if (!event.trim()) { st.err = "Say what actually happened - ordering a thing is not doing it."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/resus-mark", { orgId: st.orgId, bundleId: bundleId, key: key, event: event.trim() })
      .then(function (r) { if (settle(r, "Recorded.")) loadResus(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not mark that element."; paint(); });
  }
  function resusVoid(bundleId) {
    var reason = ""; try { reason = G.prompt("Why is this bundle being voided?") || ""; } catch (e) { return; }
    if (!reason.trim()) { st.err = "Voiding a bundle needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/resus-void", { orgId: st.orgId, bundleId: bundleId, reason: reason.trim() })
      .then(function (r) { if (settle(r, "Voided.")) loadResus(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not void the bundle."; paint(); });
  }
  function edDispose(disposition, extra) {
    var s = st.sel; if (!s) return;
    st.busy = true; paint();
    apiPost("/ward/ed-disposition", Object.assign({ orgId: st.orgId, encounterId: s.encounterId, disposition: disposition }, extra || {}))
      .then(function (r) {
        if (r && r.error === "bed_occupied") { st.busy = false; st.err = r.detail; paint(); return; }
        if (settle(r, r && r.disposition ? "Disposition: " + r.disposition + "." : "Already closed.")) { st.sel = null; st.view = "ed"; loadEd(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the disposition."; paint(); });
  }
  function edDispositionHome(disposition) {
    var reason = ""; try { reason = G.prompt("Reason for this disposition (optional):") || ""; } catch (e) {}
    edDispose(disposition, reason.trim() ? { reason: reason.trim() } : {});
  }
  /* Admitting an ED patient reuses the SAME bed board an inpatient admission uses - the disposition
   * itself fires only once a real bed is picked from it, exactly as any other admission does. */
  function edDispositionAdmit() {
    var s = st.sel; if (!s) return;
    st.edAdmitPending = true;
    loadBoard();
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
  /* Prescribing writes a MedicationOrder through the SAME door the round already reads from; the
   * refusal - formulary, restricted, incomplete - is the server's own and shown verbatim, exactly
   * like every other refusal on this screen. Nothing about the dose is computed here. */
  function orderMedication() {
    var s = st.sel; if (!s) return;
    var drug = val("wMoDrug"), value = val("wMoValue"), unit = val("wMoUnit"), route = val("wMoRoute"), frequency = val("wMoFreq");
    if (!drug || !value || !unit) { st.err = "Drug, dose and unit are required."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/medication-order", {
      orgId: st.orgId,
      order: { patientId: s.patientId, encounterId: s.encounterId, drug: drug, dose: { value: value, unit: unit }, route: route || undefined, frequency: frequency || undefined },
    }).then(function (r) {
      if (settle(r, r && r.written ? "Prescribed " + drug + "." : null)) {
        ["wMoDrug", "wMoValue", "wMoUnit", "wMoRoute", "wMoFreq"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
        loadRound();
      } else paint();
    }).catch(function () { st.busy = false; st.err = "Could not place the order."; paint(); });
  }
  /* Ordering an investigation, and reloading the two worklists it now shows up on: the collection
   * board (has it been taken yet) and pending-tests (has it been reported yet). */
  function loadInvestigations() {
    var s = st.sel; if (!s) return Promise.resolve();
    var q = "orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId);
    return Promise.all([
      apiGet("/ward/collections?" + q), apiGet("/ward/pending-tests?" + q),
      apiGet("/ward/fhir?" + q.replace("patientId=", "patient=") + "&_type=DiagnosticReport"),
    ]).then(function (rs) {
      st.investigations = (rs[0] && rs[0].ok) ? rs[0] : null;
      if (rs[1] && rs[1].ok) st.investigations = Object.assign({}, st.investigations, { pending: rs[1].pending });
      var bundle = rs[2];
      st.results = (bundle && bundle.entry ? bundle.entry.map(function (e) { return e.resource; }).filter(Boolean) : [])
        .map(function (d) {
          return { display: (d.code && (d.code.text || (d.code.coding && d.code.coding[0] && d.code.coding[0].display))) || "Result",
            status: d.status, conclusion: d.conclusion, reportedAt: d.effectiveDateTime };
        });
      paint();
    }).catch(function () { paint(); });
  }
  function orderInvestigation() {
    var s = st.sel; if (!s) return;
    var display = val("wInvCode"), category = val("wInvCat"), priority = val("wInvPri"), reason = val("wInvReason");
    if (!display) { st.err = "Name the test."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/investigation", {
      orgId: st.orgId, encounterId: s.encounterId, display: display, code: display, category: category, priority: priority, reason: reason || undefined,
    }).then(function (r) {
      if (settle(r, r && r.written ? "Ordered " + display + "." : null)) {
        ["wInvCode", "wInvReason"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
        loadInvestigations();
      } else paint();
    }).catch(function () { st.busy = false; st.err = "Could not order that."; paint(); });
  }
  /* The flowsheet and NEWS2/PEWS are READ from the same vitals this chart already records - no
   * second write path. A failure to load either is silent on the card itself (it says "loading"
   * indefinitely rather than throwing a banner over the whole chart for a secondary panel). */
  function loadFlowsheet() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/flowsheet?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId) + "&hours=24")
      .then(function (r) { if (r && r.ok) st.flowsheet = r.grid; paint(); })
      .catch(function () {});
  }
  function loadNews2() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/news2?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (r && r.ok) st.news2 = r; paint(); })
      .catch(function () {});
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
  function loadPatientCopy() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; st.view = "pcopy"; st.pcopy = null; paint();
    return apiGet("/ward/patient-copy?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { if (settle(r)) st.pcopy = r; paint(); })
      /* Never leave a previous patient's copy on screen. The hazard of this feature is handing the
       * wrong person a page with somebody else's diagnoses on it, and a stale render is exactly how
       * that happens. */
      .catch(function () { st.busy = false; st.pcopy = null; st.err = "Could not build the patient's copy. Do not print an older one."; paint(); });
  }
  function givePatientCopy() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    return apiPost("/ward/patient-release", { orgId: st.orgId, patientId: st.sel.patientId })
      /* The response carries the document it recorded, so the page then on screen is the page that
       * was released - not the one loaded some minutes earlier that the record may have moved past. */
      .then(function (r) { if (settle(r)) { st.pcopy = r; st.ok = "Handover recorded."; } paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the handover."; paint(); });
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
  /* Unlike the cosign queue, a failure here is NOT silent: held clinical data that cannot be listed
   * must not look like nothing is held. The card says it could not load. */
  function loadExceptions() {
    return apiGet("/ward/fhir-exceptions?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        if (r && r.ok) { st.xchg = r; st.xchgErr = ""; }
        else st.xchgErr = (r && (r.detail || r.message || r.error)) ? "Could not load the exchange queue: " + (r.detail || r.message || r.error) : "Could not load the exchange queue.";
        paint();
      })
      .catch(function () { st.xchgErr = "Could not reach the exchange queue."; paint(); });
  }
  function decideException(id) {
    if (!id) return;
    var resolution = val("wxR-" + id), why = val("wxW-" + id);
    var picked = null;
    try { var el = document.querySelector('input[name="wxP-' + id + '"]:checked'); picked = el ? String(el.value || "") : null; } catch (e) {}
    var localPatientId = picked || val("wxPid-" + id);
    if (!why) { st.err = "A reason is required to decide what happens to a held message."; paint(); return; }
    if (!resolution) { st.err = "Choose a decision before deciding."; paint(); return; }
    if (resolution === "link" && !localPatientId) { st.err = "A link needs the local patient it links to."; paint(); return; }
    st.busy = true; paint();
    var body = { orgId: st.orgId, exceptionId: id, resolution: resolution, reason: why };
    if (resolution === "link") body.localPatientId = localPatientId;
    apiPost("/ward/fhir-exception-resolve", body)
      // The server's own sentence: what was filed, or why not. Never paraphrased into "done".
      .then(function (r) { if (settle(r, r && (r.note || (r.written != null ? "Decided: " + r.resolution + ", " + r.written + " record" + (r.written === 1 ? "" : "s") + " filed." : "Decided.")))) loadExceptions(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not reach the exchange queue."; paint(); });
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
    // Not recorded and "no" are different: an empty select writes nothing, "0" records breathing air.
    var o2 = val("wv_o2"); if (o2 !== "") { v.o2 = o2; any = true; }
    var ac = val("wv_acvpu"); if (ac) { v.acvpu = ac; any = true; }
    if (!any) { st.err = "Nothing to record."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/vitals", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, vitals: v })
      .then(function (r) {
        // `written: 0` with ok:true is the server saying nothing was numeric. Say so plainly rather
        // than showing a success message for a save that recorded nothing.
        if (settle(r, r && r.written ? "Recorded " + r.written + " observation" + (r.written === 1 ? "" : "s") + "." : null)) {
          if (r && !r.written) st.err = "Nothing was recorded - no field held a plain number.";
          else {
            VITALS.forEach(function (f) { var el = document.getElementById("wv_" + f.k); if (el) el.value = ""; });
            ["wv_o2", "wv_acvpu"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          }
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
    if (cmd === "back") {
      /* The patient's copy is opened FROM a chart, so back returns to that chart rather than
       * throwing the selection away - and the copy itself is always dropped, because a page with
       * one patient's diagnoses left on screen is how the next person gets handed the wrong one. */
      if (st.view === "pcopy") { st.view = "chart"; st.pcopy = null; paint(); return; }
      // Picking a bed to admit an ED patient opens the SAME bed board a fresh admission uses;
      // backing out of it returns to that patient's ED chart, not the ward list, and drops the
      // pending admit rather than leaving it to fire on some later, unrelated bed pick.
      if (st.view === "board" && st.edAdmitPending) { st.edAdmitPending = false; st.board = null; st.admitTarget = null; st.view = "chart"; paint(); return; }
      st.view = "list"; st.sel = null; st.due = []; st.problems = []; st.outbox = []; st.downtime = null; st.pcopy = null;
      st.board = null; st.admitTarget = null; st.mrnLookup = null; st.mrnLookupErr = ""; st.edAdmitPending = false;
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.resusBundles = null;
      st.ed = null; st.edArrivalOpen = false; st.edMrnLookup = null; st.edMrnLookupErr = "";
      paint(); return;
    }
    if (cmd === "board") { loadBoard(); return; }
    if (cmd === "unpickbed") { st.admitTarget = null; st.mrnLookup = null; st.mrnLookupErr = ""; paint(); return; }
    if (cmd === "pickbed") { var pb = arg.indexOf("|"); if (pb > 0) pickBed(arg.slice(0, pb), arg.slice(pb + 1)); return; }
    if (cmd === "mrnlookup") { mrnLookup(); return; }
    if (cmd === "admitconfirm") { admitConfirm(); return; }
    if (cmd === "admitnew") { admitNew(); return; }
    if (cmd === "medorder") { orderMedication(); return; }
    if (cmd === "investigation") { orderInvestigation(); return; }
    if (cmd === "investigations") { loadInvestigations(); return; }
    if (cmd === "flowsheet") { loadFlowsheet(); loadNews2(); return; }
    if (cmd === "open") {
      var p = null;
      for (var j = 0; j < st.patients.length; j++) { if (st.patients[j].encounterId === arg) { p = st.patients[j]; break; } }
      if (!p) return;
      st.sel = p; st.view = "chart"; st.due = []; st.prn = []; st.unscheduled = []; st.problems = []; st.criticals = []; st.balance = null; st.outbox = [];
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null;
      st.err = ""; st.note = ""; st.refusal = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations(); return;
    }
    if (cmd === "openEd") {
      var pe = null;
      for (var k2 = 0; k2 < ((st.ed && st.ed.patients) || []).length; k2++) { if (st.ed.patients[k2].encounterId === arg) { pe = st.ed.patients[k2]; break; } }
      if (!pe) return;
      st.sel = Object.assign({ class: "ED" }, pe); st.view = "chart"; st.due = []; st.prn = []; st.unscheduled = []; st.problems = []; st.criticals = []; st.balance = null; st.outbox = [];
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.resusBundles = null;
      st.err = ""; st.note = ""; st.refusal = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations(); loadResus(); return;
    }
    if (cmd === "edboard") { loadEd(); return; }
    if (cmd === "edarrivalopen") { st.edArrivalOpen = true; st.edMrnLookup = null; st.edMrnLookupErr = ""; paint(); return; }
    if (cmd === "edarrivalclose") { st.edArrivalOpen = false; st.edMrnLookup = null; st.edMrnLookupErr = ""; paint(); return; }
    if (cmd === "edmrnlookup") { edMrnLookup(); return; }
    if (cmd === "edarriveknown") { edArriveKnown(); return; }
    if (cmd === "edarriveunknown") { edArriveUnknown(); return; }
    if (cmd === "triage") { recordTriage(); return; }
    if (cmd === "resusload") { loadResus(); return; }
    if (cmd === "resusstart") { resusStart(); return; }
    if (cmd === "resusmark") { var rm = arg.indexOf("|"); if (rm > 0) resusMark(arg.slice(0, rm), arg.slice(rm + 1)); return; }
    if (cmd === "resusvoid") { resusVoid(arg); return; }
    if (cmd === "dispositionadmit") { edDispositionAdmit(); return; }
    if (cmd === "disposition") { edDispositionHome(arg); return; }
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
    if (cmd === "xchgs") { loadExceptions(); return; }
    if (cmd === "xchg") { decideException(arg); return; }
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
    if (cmd === "pcopy") { loadPatientCopy(); return; }
    if (cmd === "pcopyGive") { givePatientCopy(); return; }
    if (cmd === "cosign") { cosign(arg); return; }
    if (cmd === "submitnote") { submitNote(arg); return; }
    if (cmd === "tx") { transmit(arg); return; }
    if (cmd === "txr") { resolveTx(arg); return; }
  }

  /* The remembered workplace, exactly as queue.js's own workplace router writes it
   * ("wardsynq:<hospitalId>" in the SAME localStorage key) - reused, not re-derived, so this
   * screen and the OPD desk can never disagree about which hospital is signed in. */
  function rememberedOrgId() {
    try {
      var wp = localStorage.getItem("smd_opd_workplace") || "";
      if (wp.indexOf("wardsynq:") === 0) return wp.slice(9);
    } catch (e) {}
    return "";
  }
  function open(opts) {
    opts = opts || {};
    st.orgId = opts.orgId || st.orgId || rememberedOrgId();
    if (!st.orgId) { try { G.toast && G.toast("The ward needs a hospital."); } catch (e) {} return; }
    st.view = "list"; st.sel = null; st.loaded = false; st.err = ""; st.note = ""; st.refusal = null;
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    paint(); loadWard();
  }
  function close() { var el = root(); el.classList.remove("on"); el.innerHTML = ""; }

  G.WARD = { open: open, close: close, _render: _render, _st: st, _nextFor: nextFor, _problem: problem };
})();
