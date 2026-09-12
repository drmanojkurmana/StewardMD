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
    orgId: "", ward: "", q: "", cls: "", patients: [], view: "list",
    sel: null,                 // the selected {encounterId, patientId, ward, bed, admittedAt}
    problems: [], criticals: [], balance: null, outbox: [], cosign: null, downtime: null, quality: null, pcopy: null, consent: null, completion: null, emergency: null, roi: null, tpa: null, billing: null, reports: null, emergencyOverride: false, emergencyAdmin: null, emergencyReconcile: null,
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
    demo: false,             // a demonstration hospital, marked on the chart; set by the caller
    /* Which country this hospital is in, from /ward/list. It decides the unit a temperature box is
     * LABELLED with, and the unit that box then SENDS - so the screen and the record can never
     * disagree about whether 98.6 is Fahrenheit. "IN" until the server answers. */
    region: "IN",
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
    // TASK 4.15: on EVERY screen, not just the ward list - an emergency declared while a nurse has a
    // chart open must still be visible without them backing out to find it.
    var em = (state.emergency && state.emergency.active) || [];
    var emBanner = em.length ? '<div class="w-emergency">' + ms("emergency") +
      "<div>" + em.map(function (a) {
        return "<p><b>" + esc(a.kind || "Emergency") + "</b> &middot; " + esc(a.reason) +
          (a.relaxations && a.relaxations.length ? " &middot; relaxes: " + esc(a.relaxations.join(", ")) : "") +
          '<span class="w-dt-times">declared ' + when(a.declaredAt) + " &middot; until " + when(a.expiresAt) + "</span></p>";
      }).join("") + "</div></div>" : "";
    if (state.refusal) {
      var rs = (state.refusal.reasons || []).map(function (r) {
        return "<li>" + esc(typeof r === "string" ? r : (r.code || JSON.stringify(r))) + "</li>";
      }).join("");
      return emBanner + '<div class="w-refusal">' + ms("gpp_maybe") + "<div><h4>Refused" + (state.refusal.action ? " on " + esc(state.refusal.action) : "") + "</h4>" +
        (rs ? "<ul>" + rs + "</ul>" : "") +
        (state.refusal.detail ? "<p>" + esc(state.refusal.detail) + "</p>" : "") +
        '</div><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    }
    if (state.err) return emBanner + '<div class="w-err">' + ms("error") + "<p>" + esc(state.err) + '</p><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    if (state.note) return emBanner + '<div class="w-ok">' + ms("check_circle") + "<p>" + esc(state.note) + '</p><button class="w-x" data-w-act="dismiss">' + ms("close") + "</button></div>";
    return emBanner;
  }

  /* THE WARD ROUND LIST. Grouped by ward, ordered by bed, filtered by admission class and a live
   * search over name / MRN / bed - the way a round is actually walked, not one flat list of every
   * admission in the hospital. Every fact on a row comes from /ward/list as the server projected it
   * (name, MRN, ward, bed, class, admission time); nothing is inferred here. The hospital-wide
   * boards (bed board, ED, surgery, twin...) live in their own card below the round, not in the
   * filter row. */
  var CLASS_LABEL = { IPD: "General", ICU: "ICU", MATERNITY: "Maternity", PEDIATRICS: "Paediatrics", NICU: "NICU" };
  var CLASS_ORDER = ["IPD", "ICU", "MATERNITY", "PEDIATRICS", "NICU"];
  function bedKey(b) { var m = /^(\D*)(\d+)(.*)$/.exec(String(b || "")); return m ? [m[1], Number(m[2]), m[3]] : [String(b || "~"), 0, ""]; }
  function bedCompare(a, b) {
    var ka = bedKey(a.bed), kb = bedKey(b.bed);
    return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  }
  function stayDay(iso) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var d = Math.floor((Date.now() - t) / 86400000) + 1;
    return d < 1 ? "" : "day " + d;
  }
  /* Pure: which rows survive the class chip and the search. Exposed as WARD.filterRoster for tests. */
  function filterRoster(patients, cls, q) {
    var needle = String(q || "").trim().toLowerCase();
    return (patients || []).filter(function (p) {
      if (cls && p.class !== cls) return false;
      if (!needle) return true;
      return [p.name, p.mrn, p.bed, p.ward, p.patientId].some(function (v) { return v != null && String(v).toLowerCase().indexOf(needle) >= 0; });
    });
  }
  function rosterHtml(state) {
    var all = state.patients || [];
    var shown = filterRoster(all, state.cls, state.q);
    var counts = {}; all.forEach(function (p) { counts[p.class] = (counts[p.class] || 0) + 1; });
    var chips = '<div class="w-chips" role="tablist">' +
      '<button class="w-chip' + (!state.cls ? " on" : "") + '" data-w-act="setcls:" type="button">All <b>' + all.length + "</b></button>" +
      CLASS_ORDER.filter(function (c) { return counts[c]; }).map(function (c) {
        return '<button class="w-chip' + (state.cls === c ? " on" : "") + '" data-w-act="setcls:' + c + '" type="button">' + esc(CLASS_LABEL[c] || c) + " <b>" + counts[c] + "</b></button>";
      }).join("") + "</div>";
    var byWard = {}; shown.forEach(function (p) { var w = p.ward || "No ward assigned"; (byWard[w] = byWard[w] || []).push(p); });
    var wards = Object.keys(byWard).sort(function (a, b) { return a === "No ward assigned" ? 1 : b === "No ward assigned" ? -1 : a.localeCompare(b); });
    var groups = wards.map(function (w) {
      var rows = byWard[w].sort(bedCompare).map(function (p) {
        var day = stayDay(p.admittedAt);
        return '<button class="w-bed" data-w-act="open:' + esc(p.encounterId) + '" type="button">' +
          '<span class="w-bed-no">' + esc(p.bed || "-") + "</span>" +
          /* Name first, then the MRN a wristband can be checked against. The record id is the last
           * resort, not the default: it is the one identifier on the row nobody can verify against
           * the patient in front of them. */
          '<span class="w-bed-b"><b>' + esc(p.name || p.mrn || p.patientId) + "</b><small>" +
            esc(p.mrn && p.name ? p.mrn + " · " : "") + esc(CLASS_LABEL[p.class] || p.class || "") +
            (day ? " · " + esc(day) : "") + " · admitted " + when(p.admittedAt) + "</small></span>" +
          ms("chevron_right") + "</button>";
      }).join("");
      return '<div class="w-wardrow"><h4>' + esc(w) + "<small>" + byWard[w].length + (byWard[w].length === 1 ? " patient" : " patients") + "</small></h4>" + rows + "</div>";
    }).join("");
    var empty = !state.loaded ? '<p class="w-empty">Loading the ward…</p>'
      : !all.length ? '<p class="w-empty">No patients are currently admitted' + (state.ward ? " to " + esc(state.ward) : "") + ".</p>"
      : !shown.length ? '<p class="w-empty">No patients match. Clear the search or the filter.</p>' : "";
    return '<p class="w-count">' + shown.length + " of " + all.length + (all.length === 1 ? " patient" : " patients") + (wards.length ? " · " + wards.length + (wards.length === 1 ? " ward" : " wards") : "") + "</p>" + chips + (groups || empty);
  }
  function listView(state) {
    return '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>Ward round" + (state.ward ? ": " + esc(state.ward) : "") + "</h3>" +
      '<button class="w-ic" data-w-act="reload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-filter"><input id="wQ" type="search" autocomplete="off" placeholder="Search name, MRN or bed" value="' + esc(state.q || "") + '">' +
      '<input id="wWard" type="text" placeholder="Ward (blank = all)" value="' + esc(state.ward) + '">' +
      '<button class="w-btn ghost" data-w-act="setward" type="button">Apply</button></div>' +
      '<div id="wRoster">' + rosterHtml(state) + "</div></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("hub") + '<h3>Boards and tools</h3></div><div class="w-tools">' +
      '<button class="w-btn" data-w-act="board" title="Admit a patient to a bed">' + ms("add_circle") + "Admit</button>" +
      '<button class="w-btn ghost" data-w-act="edboard" title="Emergency department">' + ms("emergency") + "ED</button>" +
      '<button class="w-btn ghost" data-w-act="surgeryboard" title="Surgery / OT / PACU">' + ms("medical_services") + "Surgery</button>" +
      // Not patient-scoped: a real stock levels, receipts, adjustments and reconciliation
      // workstation, the same shape as ED/Surgery's own ward-wide boards.
      '<button class="w-btn ghost" data-w-act="inventoryboard" title="Pharmacy stock: levels, receipts, adjustments, reconciliation">' + ms("inventory_2") + "Inventory</button>" +
      // Hospital-wide, not patient-scoped: the same listCriticalLoops() this build already uses per
      // patient (criticalsCard), read here with no patientId so anyone covering the ward or the lab
      // can see every open critical loop at once, not just the one chart they happen to have open.
      '<button class="w-btn ghost" data-w-act="critsboard" title="Every open critical result, hospital-wide">' + ms("priority_high") + "Critical results</button>" +
      // Hospital-wide, like Critical results beside it: imaging had a backend and nowhere to
      // land before this - the missing screen for a radiographer or radiologist who signs in.
      '<button class="w-btn ghost" data-w-act="labboard" title="Specimens, tests awaiting a result and open critical results, hospital-wide">' + ms("science") + "Laboratory board</button>" +
      '<button class="w-btn ghost" data-w-act="radboard" title="Imaging worklist, reporting and open critical findings, hospital-wide">' + ms("medical_information") + "Radiology board</button>" +
      '<button class="w-btn ghost" data-w-act="bedmgmt" title="Reserve, block for maintenance, clean-before-reuse - real bed states, server-checked">' + ms("bed") + "Bed management</button>" +
      '<button class="w-btn ghost" data-w-act="flowcommand" title="ED, beds, admissions pending, discharge, transfers - hospital-wide, live">' + ms("hub") + "Patient flow</button>" +
      // TASK 10: the Hospital Digital Twin - a fused view over patient flow, ward metrics, criticals,
      // emergency/blackout state, pharmacy and HIM, none of it recomputed here. Not called "command
      // center": that name already means the button above (Task 4.4), a FollowCare analytics feature
      // and the Code Blue Watch screen.
      '<button class="w-btn ghost" data-w-act="twin" title="Fused hospital state with freshness, provenance and a governed AI copilot">' + ms("hub") + "Digital twin</button>" +
      '<button class="w-btn ghost" data-w-act="scheduling" title="Appointments, resource bookings, blackout periods - conflict-checked, server-side">' + ms("event") + "Scheduling</button>" +
      '<button class="w-btn ghost" data-w-act="cashier" title="Balance, invoices, payments, refunds - no clinical detail">' + ms("point_of_sale") + "Cashier</button>" +
      // TASK 4.17 (Administration, scoped down per its own audit): the six hospital reports
      // TASK 4.12 already built and deferred a UI for, shown verbatim - dataSource/period/filters/
      // generatedAt/scope stated on every one, exactly as reportEnvelope() already stamps them.
      // No org-configuration screen here: nothing in the backend supports one yet, and "avoid
      // generic CRUD screens" argues against building a kitchen-sink admin console to hold it.
      '<button class="w-btn ghost" data-w-act="reports" title="Hospital reports: patient flow, clinical operations, billing, claims, pharmacy, HIM">' + ms("summarize") + "Reports</button>" +
      // Declare/deactivate themselves - the banner (banner(), above) is read-only status shown
      // everywhere; this is the one screen that can actually change it. EMERGENCY_DECLARE-gated
      // server-side, same as every other capability boundary in this app - the button is offered to
      // everyone the same way bed-management's own controls are, and a role without the capability
      // is told so by the server's own 403, not by this screen guessing who holds it.
      '<button class="w-btn ghost" data-w-act="emergencyadmin" title="Declare or stand down a hospital emergency">' + ms("emergency") + "Emergency</button>" +
      // Reachable BEFORE an outage, which is the only time it can be taken. A pack you can only get
      // to while the system is up is a pack the ward has to remember to take while the system is up.
      /* TASK 7.10. Hospital-wide, like Reports and Emergency beside it: the interfaces are not one
       * patient's business. It is offered to everyone the way every other control here is, and a
       * role without the capability is told so by the server's own 403 rather than by this screen
       * guessing who holds it. */
      '<button class="w-btn ghost" data-w-act="integration" title="Feeds in and out: what is held, what is stuck, who may push, where this hospital sends">' + ms("hub") + "Integration</button>" +
      '<button class="w-btn ghost" data-w-act="downtime" title="Printable sheet for when the system is unavailable">' + ms("print") + "Downtime pack</button></div></div>" +
      xchgCard(state) + cosignCard(state) + qualityCard(state) + overrideCard(state);
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
        // The server now sends name/mrn on every occupied bed (migrate-inpatient.js bedBoard).
        // The id is the LAST resort, never the first thing a nurse reads off a bed.
        return '<div class="w-bedcell occ"><b>' + esc(o.bed) + '</b><span>' + esc(o.name || o.mrn || o.patientId) + "</span></div>";
      }).join("");
      // Which free cell is highlighted as "picked" - a UI selection compare against what the board
      // itself already reported as free, never a computation of whether a bed IS free.
      var isPicked = function (b) { return !!t && t.ward === w.ward && String(t.bed) === String(b); };
      var free = w.bedsKnown ? (w.free || []).map(function (b) {
        return '<button class="w-bedcell free' + (isPicked(b) ? " picked" : "") + '" data-w-act="pickbed:' + esc(w.ward) + "|" + esc(b) + '"><b>' + esc(b) + "</b><span>Free</span></button>";
      }).join("") : '<div class="w-bedcell unknown"><span>Bed list not configured</span></div>';
      var unplaced = (w.unplaced || []).map(function (o) {
        return '<div class="w-bedcell occ"><b>&mdash;</b><span>' + esc(o.name || o.mrn || o.patientId) + " (no bed assigned)</span></div>";
      }).join("");
      return '<div class="w-wardrow"><h4>' + esc(w.ward) + "<small>" + esc((w.occupied || []).length) + " occupied" + (w.bedsKnown ? " &middot; " + esc((w.free || []).length) + " free" : "") + "</small></h4>" +
        '<div class="w-bedgrid">' + occ + free + unplaced + "</div></div>";
    }).join("");

    var lookup = state.mrnLookup;
    var admitPanel = !t ? "" :
      '<div class="w-card admit"><div class="w-card-h">' + ms("bed") + "<h3>Admit to " + esc(t.ward) + ", bed " + esc(t.bed) + "</h3>" +
        '<button class="w-ic" data-w-act="unpickbed" title="Choose a different bed">' + ms("close") + "</button></div>" +
        // Explicit, never inferred from the ward's name - the same rule migrate-inpatient.js's own
        // header states: a ward literally named "ICU" admits as IPD unless this is checked.
        '<label class="w-f"><span>Admission type</span><select id="wAdmitClass">' +
          '<option value=""' + (!state.admitClass ? " selected" : "") + '>General ward</option>' +
          '<option value="ICU"' + (state.admitClass === "ICU" ? " selected" : "") + '>Critical care (ICU)</option>' +
          '<option value="MATERNITY"' + (state.admitClass === "MATERNITY" ? " selected" : "") + '>Maternity</option>' +
          '<option value="PEDIATRICS"' + (state.admitClass === "PEDIATRICS" ? " selected" : "") + '>Pediatrics</option>' +
          '<option value="NICU"' + (state.admitClass === "NICU" ? " selected" : "") + '>NICU</option>' +
        '</select></label>' +
        // Shown only while a declared emergency actually names this relaxation - never a standing
        // option, so ticking it outside a real declaration cannot do anything either (the server
        // checks this for real; the checkbox is only hidden when it is pointless to offer).
        ((state.emergency && (state.emergency.active || []).some(function (a) { return (a.relaxations || []).indexOf("bed-assignment-conflict-override") >= 0; })) ?
          '<label class="w-f-check"><input type="checkbox" id="wAdmitEmergencyOverride"' + (state.emergencyOverride ? " checked" : "") + '> Use the declared emergency to admit past a blocked/cleaning/maintenance/reserved bed</label>' : "") +
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

  /* THE THEATRE BOARD. Every open case hospital-wide (functions/_wardsynq/migrate-surgery.js's
   * listOpenCases), and a booking panel that looks a patient up first, the same rule the bed
   * board's own admit panel keeps: nobody is booked for a procedure on a typed MRN alone. */
  var STAGE_WORDS = {
    booked: "Booked", marked: "Site marked", "signed-in": "Signed in", "timed-out": "Timed out",
    incised: "In procedure", "signed-out": "Signed out", abandoned: "Abandoned",
  };
  function surgeryBoardView(state) {
    var rows = ((state.surgBoard && state.surgBoard.cases) || []).map(function (c) {
      return "<li>" + '<button class="w-bed" data-w-act="opensurgery:' + esc(c.id) + '">' +
        '<span class="w-bed-no untriaged">' + ms("medical_services") + "</span>" +
        '<span class="w-bed-b"><b>' + esc(c.patientMrn || c.patientId) + "</b><small>" + esc(c.procedure) + " &middot; " + esc(c.theatre || "theatre unstated") + " &middot; " + esc(STAGE_WORDS[c.stage] || c.stage) + "</small></span>" +
        ms("chevron_right") + "</button></li>";
    }).join("");

    var lookup = state.surgMrnLookup;
    var bookPanel = !state.surgBookOpen ? "" :
      '<div class="w-card admit"><div class="w-card-h">' + ms("medical_services") + "<h3>Book a case</h3>" +
      '<button class="w-ic" data-w-act="surgerybookclose" title="Cancel">' + ms("close") + "</button></div>" +
      '<div class="w-filter"><input id="wSurgMrn" type="text" autocomplete="off" placeholder="MRN">' +
      '<button class="w-btn ghost" data-w-act="surgmrnlookup">' + ms("search") + "Find</button></div>" +
      (state.surgMrnLookupErr ? '<p class="w-hint warn">' + ms("error") + esc(state.surgMrnLookupErr) + "</p>" : "") +
      (lookup ? '<div class="w-mrn-found"><b>' + esc(lookup.name || lookup.mrn) + "</b><span>" + esc(lookup.mrn) + "</span></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Procedure</span><input id="wSurgProcedure" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Site</span><input id="wSurgSite" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Laterality</span><select id="wSurgLaterality"><option value="not-applicable">Not applicable</option><option value="left">Left</option><option value="right">Right</option><option value="bilateral">Bilateral</option></select></label>' +
        '<label class="w-f"><span>Theatre</span><input id="wSurgTheatre" type="text" autocomplete="off" placeholder="e.g. OT-1"></label>' +
        "</div>" +
        '<button class="w-btn tiny go" data-w-act="surgerybook">' + ms("check") + "Book case</button>" : "") +
      "</div>";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Surgery / OT / PACU</b></div>" +
      '<button class="w-btn tiny go" data-w-act="surgerybookopen">' + ms("add_circle") + "Book</button>" +
      '<button class="w-ic" data-w-act="surgeryboard" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card">' +
      (state.surgErr ? '<p class="w-hint warn">' + ms("error") + esc(state.surgErr) + "</p>"
        : rows ? '<ul class="w-q w-ed-board">' + rows + "</ul>"
        : '<p class="w-empty">No open cases.</p>') +
      "</div>" + bookPanel;
  }

  /* THE CASE VIEW. What's shown at any moment is driven entirely by the case's own `stage`, read
   * back from the server on every action - never advanced client-side. Incision stays visibly
   * locked until BOTH Sign In and Time Out are complete, the real gate wardsynq-surgical.js itself
   * enforces; this screen cannot open it early, only ask the server, which can refuse. */
  var SIGN_IN_ITEMS = ["identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed", "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working", "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed"];
  var TIME_OUT_ITEMS = ["team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated", "antibiotic-prophylaxis-addressed", "imaging-displayed"];
  var SIGN_OUT_ITEMS = ["procedure-recorded", "counts-correct", "specimens-labelled", "equipment-problems-addressed", "recovery-concerns-addressed"];
  var ITEM_WORDS = {
    "identity-confirmed": "Patient identity confirmed", "site-confirmed": "Site confirmed", "procedure-confirmed": "Procedure confirmed",
    "consent-confirmed": "Consent confirmed", "site-marked-confirmed": "Site marking confirmed", "anaesthesia-safety-check": "Anaesthesia safety check complete",
    "pulse-oximeter-working": "Pulse oximeter working", "allergies-reviewed": "Allergies reviewed", "airway-risk-assessed": "Airway risk assessed",
    "blood-loss-risk-assessed": "Blood loss risk assessed", "team-introduced": "Team introduced by name and role",
    "identity-site-procedure-reconfirmed": "Identity, site and procedure reconfirmed", "critical-events-anticipated": "Critical events anticipated",
    "antibiotic-prophylaxis-addressed": "Antibiotic prophylaxis addressed", "imaging-displayed": "Essential imaging displayed",
    "procedure-recorded": "Procedure performed recorded", "counts-correct": "Instrument, sponge and needle counts correct",
    "specimens-labelled": "Specimens labelled", "equipment-problems-addressed": "Equipment problems addressed", "recovery-concerns-addressed": "Recovery concerns addressed",
  };
  function checklistForm(phase, items, act) {
    var rows = items.map(function (k) {
      return '<label class="w-chk"><input type="checkbox" id="wSurgItem-' + esc(phase) + "-" + esc(k) + '"> ' + esc(ITEM_WORDS[k] || k) + "</label>";
    }).join("");
    return '<div class="w-sub"><h4>' + ms("checklist") + esc(phase === "signIn" ? "Sign In" : phase === "timeOut" ? "Time Out" : "Sign Out") + "</h4>" +
      rows +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Surgeon</span><input id="wSurgSig-' + esc(phase) + '-surgeon" type="text" autocomplete="off" placeholder="who spoke"></label>' +
      '<label class="w-f"><span>Anaesthetist</span><input id="wSurgSig-' + esc(phase) + '-anaesthetist" type="text" autocomplete="off" placeholder="who spoke"></label>' +
      '<label class="w-f"><span>Nurse</span><input id="wSurgSig-' + esc(phase) + '-nurse" type="text" autocomplete="off" placeholder="who spoke"></label>' +
      (phase !== "signOut" ? '<label class="w-f"><span>Side, stated out loud</span><select id="wSurgLatAssert-' + esc(phase) + '"><option value="not-applicable">Not applicable</option><option value="left">Left</option><option value="right">Right</option><option value="bilateral">Bilateral</option></select></label>' : "") +
      "</div>" +
      '<button class="w-btn go" data-w-act="' + esc(act) + ":" + esc(phase) + '">' + ms("task_alt") + "Complete " + esc(phase === "signIn" ? "Sign In" : phase === "timeOut" ? "Time Out" : "Sign Out") + "</button>" +
      '<p class="w-hint">' + ms("info") + "Every item must be explicitly confirmed; three DIFFERENT people, three different roles - one person signing all three is refused." + "</p></div>";
  }
  function surgeryCaseView(state) {
    var d = state.surgCase; var c = d && d.case;
    if (!c) return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button><div><b>Case</b></div></div><div class=\"w-card\"><p class=\"w-empty\">Loading&hellip;</p></div>";

    var header = '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(c.patientMrn || c.patientId) + "</b><small>" + esc(c.procedure) + " &middot; " + esc(c.laterality) + " &middot; " + esc(STAGE_WORDS[c.stage] || c.stage) + "</small></div>" +
      '<button class="w-ic" data-w-act="surgeryload" title="Refresh">' + ms("refresh") + "</button></div>";

    var consentCard = '<div class="w-card"><div class="w-card-h">' + ms("assignment_turned_in") + "<h3>Consent</h3></div>" +
      (c.consent
        ? '<p class="w-hint">' + ms("check_circle") + "Recorded: " + esc(c.consent.procedure) + " " + esc(c.consent.laterality) + "</p>"
        : '<div class="w-grid">' +
          '<label class="w-f"><span>Procedure</span><input id="wSurgConsentProc" type="text" autocomplete="off" value="' + esc(c.procedure) + '"></label>' +
          '<label class="w-f"><span>Laterality</span><select id="wSurgConsentLat"><option value="not-applicable"' + (c.laterality === "not-applicable" ? " selected" : "") + '>Not applicable</option><option value="left"' + (c.laterality === "left" ? " selected" : "") + '>Left</option><option value="right"' + (c.laterality === "right" ? " selected" : "") + '>Right</option><option value="bilateral"' + (c.laterality === "bilateral" ? " selected" : "") + '>Bilateral</option></select></label>' +
          "</div>" +
          '<label class="w-chk"><input type="checkbox" id="wSurgConsentSigned"> Signed by the patient or a lawful proxy</label>' +
          '<button class="w-btn go" data-w-act="surgeryconsent">' + ms("save") + "Record consent</button></div>") +
      "</div>";

    var siteCard = c.marking ? "" : '<div class="w-card"><div class="w-card-h">' + ms("fact_check") + "<h3>Site marking</h3></div>" +
      '<label class="w-f"><span>Site marked</span><input id="wSurgMarkSite" type="text" autocomplete="off" value="' + esc(c.site || "") + '"></label>' +
      '<label class="w-f"><span>Laterality marked</span><select id="wSurgMarkLat"><option value="not-applicable"' + (c.laterality === "not-applicable" ? " selected" : "") + '>Not applicable</option><option value="left"' + (c.laterality === "left" ? " selected" : "") + '>Left</option><option value="right"' + (c.laterality === "right" ? " selected" : "") + '>Right</option><option value="bilateral"' + (c.laterality === "bilateral" ? " selected" : "") + '>Bilateral</option></select></label>' +
      '<button class="w-btn go" data-w-act="surgerymarksite">' + ms("save") + "Record marking</button></div>";

    var checklistCard = c.stage === "marked" ? checklistForm("signIn", SIGN_IN_ITEMS, "surgeryphase")
      : c.stage === "signed-in" ? checklistForm("timeOut", TIME_OUT_ITEMS, "surgeryphase")
      : c.stage === "timed-out" ? '<div class="w-card"><div class="w-card-h">' + ms("cut") + "<h3>Incision</h3></div>" +
          '<p class="w-hint">' + ms("check_circle") + "Sign In and Time Out are both complete. Incision is unlocked.</p>" +
          '<button class="w-btn warn" data-w-act="surgeryincise">' + ms("cut") + "Record incision</button></div>"
      : c.stage === "incised" ? checklistForm("signOut", SIGN_OUT_ITEMS, "surgeryphase")
      : "";

    var anesCard = (c.stage === "signed-in" || c.stage === "timed-out" || c.stage === "incised") ? anesthesiaCard(state) : "";
    var implantCard = (c.stage === "incised" || c.stage === "signed-out") ? implantsCard(state) : "";

    var dispositionCard = c.stage !== "signed-out" ? "" : '<div class="w-card"><div class="w-card-h">' + ms("exit_to_app") + "<h3>Operative note &amp; disposition</h3></div>" +
      '<label class="w-f"><span>Operative note</span><textarea id="wSurgNote" rows="2"></textarea></label>' +
      '<button class="w-btn ghost" data-w-act="surgerynote">' + ms("save") + "Save note</button>" +
      '<div class="w-dose-a" style="margin-top:8px">' +
      '<button class="w-btn" data-w-act="surgerydisposition:pacu">' + ms("bed") + "To PACU</button>" +
      '<button class="w-btn ghost" data-w-act="surgerydisposition:direct-discharge">' + ms("home") + "Direct discharge</button>" +
      "</div></div>";

    return header + consentCard + siteCard + checklistCard + anesCard + implantCard + dispositionCard;
  }

  function anesthesiaCard(state) {
    var a = state.surgCase && state.surgCase.anesthesia;
    var rows = ((a && a.events) || []).map(function (e) {
      return "<li><b>" + esc(e.drug) + "</b><span>" + esc(e.dose) + (e.route ? " " + esc(e.route) : "") + " &middot; " + when(e.at) + "</span></li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("vital_signs") + "<h3>Anaesthesia</h3></div>" +
      (!a
        ? '<label class="w-f"><span>ASA class</span><input id="wSurgAsa" type="text" autocomplete="off" placeholder="e.g. ASA II"></label>' +
          '<button class="w-btn go" data-w-act="anesstart">' + ms("play_arrow") + "Start anaesthesia record</button>"
        : a.endedAt
          ? '<p class="w-hint">' + ms("check_circle") + "Ended " + when(a.endedAt) + "</p>" + (rows ? '<ul class="w-mini">' + rows + "</ul>" : "")
          : (rows ? '<ul class="w-mini">' + rows + "</ul>" : "") +
            '<div class="w-grid">' +
            '<label class="w-f"><span>Drug</span><input id="wSurgAnesDrug" type="text" autocomplete="off"></label>' +
            '<label class="w-f"><span>Dose</span><input id="wSurgAnesDose" type="text" autocomplete="off"></label>' +
            '<label class="w-f"><span>Route</span><input id="wSurgAnesRoute" type="text" autocomplete="off" placeholder="e.g. IV"></label>' +
            "</div>" +
            '<button class="w-btn ghost" data-w-act="anesevent">' + ms("add") + "Record drug given</button>" +
            '<button class="w-btn" data-w-act="anesend">' + ms("stop") + "End anaesthesia</button>") +
      "</div>";
  }

  function implantsCard(state) {
    var rows = ((state.surgCase && state.surgCase.implants) || []).map(function (i) {
      return "<li><b>" + esc(i.device) + "</b><span>" + (i.lot ? "lot " + esc(i.lot) : "") + (i.serial ? " &middot; serial " + esc(i.serial) : "") + "</span></li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("device_hub") + "<h3>Implants</h3></div>" +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">Nothing logged.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Device</span><input id="wSurgImplantDevice" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Lot</span><input id="wSurgImplantLot" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Serial</span><input id="wSurgImplantSerial" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn ghost" data-w-act="surgeryimplant">' + ms("add") + "Log implant</button></div>";
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

  /* ACTIVE MEDICATIONS. What is running right now, in one place - filtered server-side to
   * status==="active" MedicationOrder (functions/_wardsynq/migrate-inpatient.js timelineFromChart),
   * the same field "New medication order" writes and "Medication round" administers against. This
   * card writes nothing; it is the missing answer to "what drugs is this patient currently on",
   * which used to mean reading the round and the order form and holding the rest in your head. */
  function activeMedsCard(state) {
    var meds = state.activeMeds;
    if (meds == null) return "";
    var rows = meds.map(function (m) {
      return "<li><b>" + esc(m.drug) + "</b>" +
        (m.dose && m.dose.value != null ? " <span>" + esc(m.dose.value) + esc(m.dose.unit || "") + "</span>" : "") +
        (m.route ? " <span>" + esc(m.route) + "</span>" : "") +
        (m.frequency ? " <span>" + esc(m.frequency) + "</span>" : "") +
        (m.since ? " <small>since " + when(m.since) + "</small>" : "") +
        "</li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("pill") + "<h3>Active medications</h3></div>" +
      (rows ? "<ul class=\"w-mini\">" + rows + "</ul>" : '<p class="w-empty">Nothing currently active.</p>') + "</div>";
  }

  /* THE TIMELINE. Every readable resource on this chart, in one chronological list - the same
   * governed read every section above already does, merged server-side
   * (functions/_wardsynq/migrate-inpatient.js patientTimeline) rather than left for a clinician to
   * reconstruct by reading nine separate cards. Nothing here is a second copy of the record: the
   * events are labels over the SAME rows the cards above render, ordered by when each actually
   * happened. A resource with no timestamp is counted, never silently dropped - see w-hint below. */
  /* One row of the stay. Shared by the card on the chart and the full-page Timeline, so the two can
   * never drift into telling the story differently. */
  function timelineRow(e) {
    return '<li><span class="w-tl-t">' + when(e.at) + '</span><span class="w-tl-k">' + esc(e.resourceType) + "</span><span>" + esc(e.label) + "</span></li>";
  }
  function timelineGapHint(state) {
    return state.timelineGap ? '<p class="w-hint warn">' + ms("warning") + esc(state.timelineGap) + " record" + (state.timelineGap === 1 ? "" : "s") + " on this chart carry no timestamp and are not shown here.</p>" : "";
  }
  function timelineCard(state) {
    var t = state.timeline;
    if (t == null) return "";
    var rows = t.map(timelineRow).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>Timeline</h3>" +
      '<button class="w-btn tiny" data-w-act="timeline" title="The whole clinical history on one page">' + ms("open_in_full") + "Open full history</button>" +
      '<button class="w-ic" data-w-act="open:' + esc((state.sel || {}).encounterId || "") + '" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows ? "<ul class=\"w-timeline\">" + rows + "</ul>" : '<p class="w-empty">Nothing recorded yet.</p>') +
      timelineGapHint(state) +
      "</div>";
  }

  /* THE WHOLE CLINICAL HISTORY, ON ONE PAGE, WITH SOMEWHERE TO WRITE.
   *
   * The timeline was a card among a dozen other cards, which is the wrong shape for the one thing a
   * doctor picking up an unfamiliar patient actually does first: read the stay from the beginning.
   * It is now a page of its own, and the note box sits at the top of it, because the note a ward
   * round produces is written WHILE reading the history that prompted it, not on a different screen.
   *
   * Notes are append-only here as everywhere else: there is no edit and no delete. A correction is a
   * new note, exactly as a corrected discharge summary is a new signed version. */
  function timelineOpen() {
    var s = st.sel; if (!s) return;
    st.view = "timeline"; st.noteErr = ""; paint();
    if (st.timeline == null) loadChart();
  }
  function timelineNoteSave() {
    var s = st.sel; if (!s) return;
    var text = val("wTlNote");
    if (!text) { st.noteErr = "A note needs words."; paint(); return; }
    st.noteDraft = text;               // survives the repaint, and every refusal below
    st.busy = true; st.noteErr = ""; paint();
    /* "progress" is the built-in free-text template every hospital has without configuring one
     * (functions/_wardsynq/note-templates.js). A hospital that defines its own `progress` template
     * replaces it, and this keeps working. */
    apiPost("/ward/note", { orgId: st.orgId, templateId: "progress", encounterId: s.encounterId, sections: { narrative: text } })
      .then(function (r) {
        if (settle(r, r && r.written ? "Note added." : null)) {
          st.noteDraft = "";           // on the record now, so the draft has done its job
          var el = document.getElementById("wTlNote"); if (el) el.value = "";
          // Re-read rather than repaint from what the browser believes. A successful write that
          // leaves the page showing the old story is the bug this codebase has already been bitten
          // by on the flowsheet and the problem list.
          loadChart();
        } else paint();
      })
      .catch(function () { st.busy = false; st.noteErr = "Could not save that note."; paint(); });
  }
  function timelineView(state) {
    var s = state.sel || {};
    var t = state.timeline;
    var rows = (t || []).map(timelineRow).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(s.name || s.patientId || "Patient") + "</b><small>" +
        (s.mrn ? esc(s.mrn) + " &middot; " : "") + "clinical history</small></div>" +
      '<button class="w-ic" data-w-act="timelineload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Add a clinical note</h3></div>" +
      '<p class="w-hint">What has happened, what was found, what was done, and what happens next. It is added to this history and cannot be edited afterwards; a correction is a new note.</p>' +
      /* The words survive a repaint. A refused save used to clear the box, so a clinician who was
       * told "your role cannot do that" also lost the note they had just written - the one moment
       * the text is most worth keeping, because the fix is to fetch someone who CAN sign it, not to
       * type it again. st.noteDraft is held across paints and only cleared on a successful save. */
      '<textarea id="wTlNote" class="w-input" rows="5" placeholder="Admitted with community-acquired pneumonia. Started on co-amoxiclav 1.2 g IV TDS. Observations improving, remains on 2 L oxygen.">' + esc(state.noteDraft || "") + "</textarea>" +
      (state.noteErr ? '<p class="w-hint warn">' + ms("warning") + esc(state.noteErr) + "</p>" : "") +
      '<button class="w-btn" data-w-act="timelinenote">' + ms("save") + "Add note</button></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>History &middot; " + (t ? t.length : 0) + "</h3></div>" +
      (t == null ? '<p class="w-empty">Loading the history.</p>'
        : rows ? '<ul class="w-timeline">' + rows + "</ul>"
        : '<p class="w-empty">Nothing recorded on this stay yet.</p>') +
      timelineGapHint(state) + "</div>";
  }

  var VITALS = [
    { k: "sbp", l: "Systolic", u: "mmHg" }, { k: "dbp", l: "Diastolic", u: "mmHg" },
    { k: "pulse", l: "Pulse", u: "/min" }, { k: "rr", l: "Resp rate", u: "/min" },
    /* Temperature's unit is resolved when the card is DRAWN (tempUnitLabel), never here: it depends
     * on which hospital is open, and this array is built once when the file loads. A box labelled
     * one unit whose value is stored as the other is a false number in a clinical record - 98.6
     * recorded as Celsius, or 37.1 as Fahrenheit - and it is invisible to whoever reads the chart
     * next. The value is sent WITH its unit, so the two cannot drift again. */
    { k: "temp", l: "Temp", u: null }, { k: "spo2", l: "SpO₂", u: "%" },
    { k: "weight", l: "Weight", u: null }
  ];
  /* The two an early warning score cannot do without. They are not numbers, so they sit beside the
   * numeric grid rather than in it - and leaving them blank leaves the score INCOMPLETE, which is
   * the honest outcome rather than a reassuring total about a patient nobody finished examining. */
  var ACVPU = [["", "Consciousness: not assessed"], ["A", "A - alert"], ["C", "C - new confusion"], ["V", "V - responds to voice"], ["P", "P - responds to pain"], ["U", "U - unresponsive"]];
  /* The unit this hospital's country writes a temperature in, and therefore the unit the server
   * will store it in. st.region comes from GET /ward/list. */
  function tempUnitLabel() { return st.region === "US" ? "°F" : "°C"; }
  /* The unit this hospital weighs in. A box labelled kg receiving a pounds value is not a display
   * problem: nothing downstream can tell, the adult plausibility band (25 to 300 kg) passes 154,
   * and every weight-based infusion rate computed from it is 2.2 times out. */
  function weightUnitLabel() { return st.region === "US" ? "lb" : "kg"; }
  function vitalsCard() {
    var f = VITALS.map(function (v) {
      var unit = v.u !== null ? v.u : v.k === "weight" ? weightUnitLabel() : tempUnitLabel();
      return '<label class="w-f"><span>' + esc(v.l) + ' <i>' + esc(unit) + "</i></span>" +
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
        /* The clock changed and this dose is NOT at the time the ward's policy names. The server
         * decided that and said so; the screen only repeats it. A nurse handed a time the policy
         * does not contain, with no reason on the row, would be right to distrust the whole round. */
        (d.adjusted ? "<small>clock change: " + esc(d.adjusted.from) + " does not exist today, moved to " + esc(d.adjusted.to) + "</small>" : "") +
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
      // TASK 3.1: the phlebotomist's actual next action, not just a status word. Only offered while
      // a sample genuinely still needs taking (none/failed) - a collected or received sample has
      // nothing left to do here.
      var canCollect = st_ === "none" || st_ === "failed";
      return "<li><b>" + esc(c.display || c.code) + "</b> <span>" + esc(c.category || "") + (c.priority && c.priority !== "routine" ? " &middot; " + esc(c.priority).toUpperCase() : "") + "</span>" +
        " " + '<span class="w-st ' + esc(st_) + '">' + esc(st_.replace(/_/g, " ")) + "</span>" +
        (canCollect ? '<button class="w-btn tiny go" data-w-act="collectspecimen:' + esc(c.serviceRequestId) + '">' + ms("colorize") + "Collect</button>" : "") +
      "</li>";
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
    var isIcu = s.class === "ICU";
    var isMaternity = s.class === "MATERNITY";
    var isPediatric = s.class === "PEDIATRICS" || s.class === "NICU";
    var isNicu = s.class === "NICU";
    var header = isEd
      ? '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        "<div><b>" + esc(s.mrn || s.patientId || "") + "</b><small>" + ms("emergency", true) + "ED" +
        (s.chiefComplaint ? " &middot; " + esc(s.chiefComplaint) : "") + " &middot; arrived " + when(s.arrivedAt) + "</small></div>" +
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>"
      : '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        // A human on the ward reads a name and an MR number, not a record id: the ward list's own
        // roster join (functions/_wardsynq/migrate-inpatient.js listWard) already carries both on
        // this same object, and the header is now the second of two places that used to ignore them
        // - found 2026-09-12, same defect, different screen.
        "<div><b>" + esc(s.name || s.patientId || "") + "</b><small>" + (s.name && s.mrn ? esc(s.mrn) + " &middot; " : "") + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + " &middot; admitted " + when(s.admittedAt) + "</small></div>" +
        // The summary is reachable from the patient, not from a menu somewhere else. A planned
        // discharge is prepared while the patient is still on the ward, so this is not gated on the
        // stay being closed - the summary screen states plainly when a stay is still open.
        '<button class="w-btn ghost" data-w-act="move" title="Transfer to another ward or bed">' + ms("swap_horiz") + "Transfer</button>" +
        // First in the row on purpose: reading the stay is what a doctor picking up an unfamiliar
        // patient does before anything else, and it is where the note box now lives.
        '<button class="w-btn ghost" data-w-act="timeline" title="The whole clinical history on one page, and where you add a clinical note">' + ms("history") + "Timeline</button>" +
        '<button class="w-btn ghost" data-w-act="summary" title="Discharge summary">' + ms("description") + "Summary</button>" +
        // ONCqis is a separate product; this is only the LINK into it. Reachable from any patient
        // because oncology is a workflow layered on the ordinary chart, not a ward of its own.
        '<button class="w-btn ghost" data-w-act="oncologyopen" title="ONCqis link, diagnosis, adverse events, chemo administration">' + ms("labs") + "Oncology</button>" +
        // KardiQ X is a separate product; this is only the LINK into it. Reachable from any
        // patient for the same reason oncology is - a layered workflow, not a ward of its own.
        '<button class="w-btn ghost" data-w-act="cardiologyopen" title="KardiQ X link and ECG reference">' + ms("monitor_heart") + "Cardiology</button>" +
        // A radiologist's own worklist for THIS patient's imaging orders - protocol, report, and an
        // honest IMAGE SOURCE UNAVAILABLE in place of a viewer that does not exist.
        '<button class="w-btn ghost" data-w-act="radiologyopen" title="Imaging worklist, protocol and report">' + ms("medical_information") + "Radiology</button>" +
        // A pharmacist's own verification/dispense screen - never a reuse of this doctor's ordering
        // view. Reachable from any patient chart, gated server-side to the pharmacy role's own caps.
        '<button class="w-btn ghost" data-w-act="pharmacyopen" title="Verification queue and dispense">' + ms("medication") + "Pharmacy</button>" +
        '<button class="w-btn ghost" data-w-act="txopen" title="Transfusion request, crossmatch, bedside verification">' + ms("bloodtype") + "Blood bank</button>" +
        // TASK 4.10: consent.js already governs every decision - treatment, sharing outside this
        // hospital, research, photography, blood products, a specific procedure. This is the
        // general-purpose capture/history screen; surgery's own consent step (surgeryConsent())
        // already calls the SAME consent.js record for the "procedure" scope and is unaffected.
        '<button class="w-btn ghost" data-w-act="consentopen" title="What this patient has agreed to and refused">' + ms("fact_check") + "Consent</button>" +
        // TASK 4.11: whatever is on this list is a real gap - an unsigned note, an open critical
        // loop, an undecided medicine, a scope with no consent - never a manufactured checklist.
        // Nothing here can be "completed" from this screen: it clears on its own once the
        // underlying act happens (the note is signed, the loop acknowledged, and so on).
        '<button class="w-btn ghost" data-w-act="completionopen" title="What is still outstanding on this chart">' + ms("checklist") + "Chart check</button>" +
        // TASK 4.17: HIM's other half, alongside Chart check. A third-party request to see this
        // record - never the patient's own copy (that is "Patient copy", below) and never a consent
        // decision (that is "Consent", above): who asked, on what basis, and what was actually sent.
        '<button class="w-btn ghost" data-w-act="roiopen" title="Third-party requests to release this record">' + ms("outbox") + "ROI</button>" +
        // TASK 4.8's own workstation. wardsynq-billing.js's own rule stands unmoved: the clinical
        // record is the source and this screen reads it, it never writes a diagnosis to support a code.
        '<button class="w-btn ghost" data-w-act="tpaopen" title="Claims and pre-authorisations">' + ms("gavel") + "TPA</button>" +
        // TASK 4.17: read-only, distinct from Cashier. See billingView's own header comment.
        '<button class="w-btn ghost" data-w-act="billingopen" title="Charges, invoices and claims - no collection here">' + ms("request_quote") + "Billing</button>" +
        // The patient's own copy. Reachable from the patient because that is where the conversation
        // that produces it happens, not from a menu somewhere else.
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>";

    return header +
      criticalsCard(state) + (isEd ? triageCard(state) : "") + (isMaternity ? pregnancyCard(state) + meowsCard(state) : "") +
      (isPediatric ? ageBandCard(state) : "") +
      problemsCard(state) + activeMedsCard(state) + timelineCard(state) + maikCard(state) + noteCard(state) + vitalsCard() + flowsheetCard(state) + fluidCard(state) +
      (isMaternity ? labourCard() + bloodLossCard(state) : "") +
      (isNicu ? neonatalCard() + linesCard(state) : "") +
      ((isEd || isMaternity) ? resusCard(state) : "") + (isIcu ? deviceCard(state) : "") +
      medOrderCard(state) + marCard(state) + outboxCard(state) + investigationsCard(state) +
      (isMaternity ? deliveryCard(state) : "") +
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
      '<div class="w-filter"><select id="wResusCode"><option value="code-sepsis">Code Sepsis</option><option value="code-blue">Code Blue</option><option value="code-stemi">Code STEMI</option><option value="code-pph">Code PPH</option><option value="code-eclampsia">Code Eclampsia</option></select>' +
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

  /* TASK 4.10: consent.js's own closed lists, mirrored here so the form can only ever submit a value
   * the server already recognises. Free text would not be queryable server-side, so it is not offered
   * here either - `other`/`procedure` carry a required detail field instead. */
  var CONSENT_SCOPES = [
    ["treatment", "General treatment"], ["share-external", "Sharing the record outside this hospital"],
    ["share-registry", "Sharing with a registry or exchange"], ["research", "Use of the record for research"],
    ["photography", "Clinical photography"], ["blood-products", "Transfusion of blood products"],
    ["procedure", "A specific procedure"], ["other", "Other"],
  ];
  var CONSENT_GIVERS = [
    ["patient", "Patient"], ["parent", "Parent"], ["legal-guardian", "Legal guardian"],
    ["next-of-kin", "Next of kin"], ["power-of-attorney", "Power of attorney"], ["clinician-emergency", "Clinician (emergency)"],
  ];
  function consentView(state) {
    var c = state.consent || {};
    var opts = function (list, cur) {
      return list.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === cur ? " selected" : "") + '>' + esc(x[1]) + "</option>"; }).join("");
    };
    var rows = (c.consents || []).map(function (r) {
      var canWithdraw = r.status === "granted" || r.status === "refused";
      return '<li class="w-mini-row"><div><b>' + esc(r.scopeLabel || r.scope) + '</b> &middot; <span class="w-st ' + esc(r.status) + '">' + esc(r.status) + "</span>" +
        (r.detail ? " &middot; " + esc(r.detail) : "") + '<div class="w-dt-times">' + esc(r.givenBy || "") + (r.giverName ? " (" + esc(r.giverName) + ")" : "") +
        (r.recordedAt ? " &middot; " + when(r.recordedAt) : "") + (r.validUntil ? " &middot; until " + when(r.validUntil) : "") + "</div></div>" +
        (canWithdraw ? '<button class="w-btn ghost sm" data-w-act="consentwithdraw:' + esc(r.scope) + "|" + esc(r.detail || "") + '">' + ms("cancel") + "Withdraw</button>" : "") +
        "</li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Consent</h3></div>" +
      (c.refused ? '<p class="w-warn">' + c.refused + " refused</p>" : "") +
      (rows ? "<ul class=\"w-mini\">" + rows + "</ul>" : '<p class="w-empty">No consent has been recorded for this patient.</p>') +
      '<div class="w-sub"><h4>Record a decision</h4>' +
      '<select id="wConsentScope">' + opts(CONSENT_SCOPES, c.scope) + "</select>" +
      '<select id="wConsentDecision"><option value="granted">Granted</option><option value="refused">Refused</option></select>' +
      '<input id="wConsentDetail" placeholder="What exactly (required for Other / a specific procedure)" value="' + esc(c.detail || "") + '">' +
      '<select id="wConsentGivenBy">' + opts(CONSENT_GIVERS, c.givenBy) + "</select>" +
      '<input id="wConsentGiverName" placeholder="Giver name (if not the patient)">' +
      '<label><input type="checkbox" id="wConsentCapacity" checked> Patient had capacity</label>' +
      '<input id="wConsentValidUntil" type="date" placeholder="Valid until (optional)">' +
      '<button class="w-btn" data-w-act="consentrecord">' + ms("fact_check") + "Record</button></div>" +
      "</div>";
  }

  var COMPLETION_LABELS = {
    "unsigned-notes": "Unsigned note", "discharge-summary": "Discharge summary",
    "operative-documentation": "Operative documentation", "result-acknowledgement": "Result not acknowledged",
    "medication-reconciliation": "Medication reconciliation", "consent": "Consent", "nursing-documentation": "Nursing documentation",
  };
  function completionView(state) {
    var c = state.completion || {};
    var rows = (c.items || []).map(function (i) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(i.escalation.level) + '">' + esc(i.escalation.level) + "</span> " +
        "<b>" + esc(COMPLETION_LABELS[i.type] || i.type) + "</b> &middot; " + esc(i.detail || "") +
        (i.responsibleRole ? '<div class="w-dt-times">' + esc(i.responsibleRole) + (i.escalation.hoursOpen ? " &middot; open " + i.escalation.hoursOpen + "h" : "") + "</div>" : "") +
        "</div></li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Chart check</h3><button class=\"w-btn ghost\" data-w-act=\"completionopen\">" + ms("refresh") + "Refresh</button></div>" +
      (rows ? "<ul class=\"w-mini\">" + rows + "</ul>" : '<p class="w-empty">Nothing outstanding, against what this hospital has configured to check.</p>') +
      "</div>";
  }

  var ROI_RELATIONSHIPS = [["patient", "Patient"], ["attorney", "Attorney"], ["other-provider", "Other provider"], ["insurer", "Insurer"], ["government-agency", "Government agency"], ["employer", "Employer"], ["family-member", "Family member"], ["other", "Other"]];
  function roiView(state) {
    var r = state.roi || {};
    var rows = (r.requests || []).map(function (req) {
      var actions = "";
      if (req.state === "requested") {
        actions = '<button class="w-btn ghost sm" data-w-act="roiauthorize:' + esc(req.roiId) + '">' + ms("check_circle") + "Authorize</button>" +
          '<button class="w-btn ghost sm" data-w-act="roideny:' + esc(req.roiId) + '">' + ms("cancel") + "Deny</button>";
      } else if (req.state === "authorized") {
        actions = '<button class="w-btn ghost sm" data-w-act="roifulfill:' + esc(req.roiId) + '">' + ms("outbox") + "Fulfill</button>" +
          '<button class="w-btn ghost sm" data-w-act="roicancel:' + esc(req.roiId) + '">' + ms("cancel") + "Cancel</button>";
      }
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(req.state) + '">' + esc(req.state) + "</span> " +
        "<b>" + esc(req.requester && req.requester.name) + "</b>" + (req.requester && req.requester.relationship ? " (" + esc(req.requester.relationship) + ")" : "") +
        " &middot; " + esc(req.purpose) +
        '<div class="w-dt-times">scope: ' + esc((req.scope && req.scope.recordTypes || []).join(", ")) +
        (req.authorizationBasis ? " &middot; basis: " + esc(req.authorizationBasis) : "") +
        (req.decisionReason ? " &middot; " + esc(req.decisionReason) : "") +
        (req.disclosure ? " &middot; sent " + esc(req.disclosure.deliveredStatus) + " (" + esc(JSON.stringify(req.disclosure.resourceCounts || {})) + ")" : "") +
        " &middot; requested " + when(req.requestedAt) + "</div></div>" +
        (actions ? '<div class="w-mini-row-act">' + actions + "</div>" : "") +
        "</li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Release of information</h3><button class=\"w-btn ghost\" data-w-act=\"roiopen\">" + ms("refresh") + "Refresh</button></div>" +
      (r.shareExternalConsent ? '<p class="w-dt-times">Share-external consent: ' + esc(r.shareExternalConsent.status) + "</p>" : "") +
      (rows ? "<ul class=\"w-mini\">" + rows + "</ul>" : '<p class="w-empty">No release request has ever been made for this patient.</p>') +
      '<div class="w-sub"><h4>New request</h4>' +
      '<input id="wRoiRequesterName" placeholder="Requester name">' +
      '<input id="wRoiOrg" placeholder="Organization (optional)">' +
      '<select id="wRoiRelationship">' + ROI_RELATIONSHIPS.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wRoiPurpose" placeholder="Purpose">' +
      '<input id="wRoiRecipient" placeholder="Recipient (where it goes)">' +
      '<input id="wRoiRecordTypes" placeholder="Record types, comma-separated (e.g. DiagnosticReport)">' +
      '<button class="w-btn" data-w-act="roirequest">' + ms("outbox") + "Request</button></div>" +
      "</div>";
  }

  var PREAUTH_STATES = [["requested", "Requested"], ["approved", "Approved"], ["refused", "Refused"], ["expired", "Expired"]];
  function tpaView(state) {
    var t = state.tpa || {};
    var claimRows = (t.claims || []).map(function (c) {
      var actions = "";
      if (c.state === "coded") actions = '<button class="w-btn ghost sm" data-w-act="claimsubmit:' + esc(c.id) + '">' + ms("send") + "Submit</button>";
      else if (c.state === "submitted" || c.state === "queried") {
        actions = '<button class="w-btn ghost sm" data-w-act="claimadjudicate:' + esc(c.id) + '">' + ms("gavel") + "Adjudicate</button>" +
          '<button class="w-btn ghost sm" data-w-act="claimdeny:' + esc(c.id) + '">' + ms("cancel") + "Deny</button>";
      } else if (c.state === "denied") actions = '<button class="w-btn ghost sm" data-w-act="claimresubmit:' + esc(c.id) + '">' + ms("refresh") + "Resubmit</button>";
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(c.state) + '">' + esc(c.state) + "</span> " +
        "<b>" + esc((c.codes || []).map(function (x) { return x.code; }).join(", ")) + "</b>" +
        (c.submittedAmount != null ? " &middot; submitted " + esc(c.submittedAmount) : "") +
        (c.approvedAmount != null ? " &middot; approved " + esc(c.approvedAmount) : "") +
        (c.deniedAmount != null ? " &middot; denied " + esc(c.deniedAmount) : "") +
        (c.denialReason ? " &middot; " + esc(c.denialReason) : "") +
        (c.clinicalContentChangedAfterDenial ? '<div class="w-warn">Coding changed after denial - flagged, not blocked.</div>' : "") +
        ((c.queries || []).length ? '<div class="w-dt-times">' + c.queries.map(function (q) { return esc(q.question); }).join(" ") + "</div>" : "") +
        // The adapter boundary, stated honestly: no live payer connector exists in this build, so a
        // submission is queued for the hospital's own process, never shown as sent to anyone.
        (c.adapter ? '<div class="w-dt-times">payer channel: ' + esc(c.adapter.state) + (c.adapter.note ? " - " + esc(c.adapter.note) : "") + "</div>" : "") +
        "</div>" + (actions ? '<div class="w-mini-row-act">' + actions + "</div>" : "") + "</li>";
    }).join("");
    var authRows = (t.preAuthorisations || []).map(function (a) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(a.state) + '">' + esc(a.state) + "</span> " +
        "<b>" + esc(a.treatment) + "</b>" + (a.scheme ? " &middot; " + esc(a.scheme) : "") +
        (a.authorizedAmount != null ? " &middot; " + esc(a.authorizedAmount) : "") +
        (a.reason ? " &middot; " + esc(a.reason) : "") +
        '<div class="w-dt-times">' + esc(a.note || "") + "</div></div></li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>TPA / Claims</h3><button class=\"w-btn ghost\" data-w-act=\"tpaopen\">" + ms("refresh") + "Refresh</button></div>" +
      '<div class="w-sub"><h4>Claims</h4>' +
      (claimRows ? "<ul class=\"w-mini\">" + claimRows + "</ul>" : '<p class="w-empty">No claim has been coded for this patient.</p>') +
      '<input id="wTpaCodes" placeholder="Codes to claim, comma-separated">' +
      '<button class="w-btn" data-w-act="claimcode">' + ms("receipt_long") + "Code claim</button></div>" +
      '<div class="w-sub"><h4>Pre-authorisations</h4>' +
      (authRows ? "<ul class=\"w-mini\">" + authRows + "</ul>" : '<p class="w-empty">No pre-authorisation has been recorded for this patient.</p>') +
      '<input id="wTpaTreatment" placeholder="Treatment">' +
      '<input id="wTpaScheme" placeholder="Scheme (optional)">' +
      '<select id="wTpaAuthState">' + PREAUTH_STATES.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wTpaAuthReason" placeholder="Reason (required if refused)">' +
      '<input id="wTpaAuthAmount" placeholder="Authorized amount (if approved)">' +
      '<button class="w-btn" data-w-act="preauth">' + ms("fact_check") + "Record</button></div>" +
      "</div>";
  }

  /* TASK 4.17: Billing, distinct from Cashier on purpose. TASK 4.13 gave `billing` BILLING_VIEW and
   * deliberately NOT BILLING_CHARGE - "a billing clerk who codes and reviews does not also collect
   * payment." Cashier's own screen carries collect/refund/discount buttons a billing-only actor is
   * not meant to see; this screen shows the SAME real invoices and claims, read-only, no button on
   * it calls a write route. */
  function billingView(state) {
    var b = state.billing || {};
    var invRows = (b.invoices || []).map(function (inv) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(inv.status) + '">' + esc(inv.status) + "</span> " +
        "<b>" + esc(inv.invoiceId) + "</b> &middot; charged " + esc(inv.charged) + " &middot; balance " + esc(inv.balance) +
        (inv.void ? " &middot; VOID" + (inv.voidReason ? ": " + esc(inv.voidReason) : "") : "") + "</div></li>";
    }).join("");
    var claimRows = (b.claims || []).map(function (c) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(c.state) + '">' + esc(c.state) + "</span> " +
        "<b>" + esc((c.codes || []).map(function (x) { return x.code; }).join(", ")) + "</b>" +
        (c.submittedAmount != null ? " &middot; submitted " + esc(c.submittedAmount) : "") +
        (c.approvedAmount != null ? " &middot; approved " + esc(c.approvedAmount) : "") + "</div></li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Billing</h3><button class=\"w-btn ghost\" data-w-act=\"billingopen\">" + ms("refresh") + "Refresh</button></div>" +
      (b.outstandingBalance != null ? '<p class="w-dt-times">Outstanding: ' + esc(b.outstandingBalance) + "</p>" : "") +
      '<div class="w-sub"><h4>Invoices</h4>' + (invRows ? "<ul class=\"w-mini\">" + invRows + "</ul>" : '<p class="w-empty">No invoice has been raised for this patient.</p>') + "</div>" +
      '<div class="w-sub"><h4>Claims</h4>' + (claimRows ? "<ul class=\"w-mini\">" + claimRows + "</ul>" : '<p class="w-empty">No claim has been coded for this patient.</p>') + "</div>" +
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

  /* DEVICE ASSOCIATION (HAZ-DEV-01). Both the patient's wristband and the monitor's own asset tag
   * must be scanned, and match, before a reading from it can reach this chart - the real check runs
   * server-side in wardsynq-iomt.js's DeviceGateway, this card only shows what is currently bound
   * and lets a nurse scan a new one on or take one off. */
  function deviceCard(state) {
    var rows = (state.devices || []).map(function (d) {
      return "<li><div><b>" + esc(d.deviceId) + "</b><small>" + esc(d.kind || "monitor") + " &middot; " + esc(d.assetTag) + "</small></div>" +
        '<button class="w-btn tiny warn" data-w-act="devicedissociate:' + esc(d.deviceId) + '">' + ms("link_off") + "Remove</button></li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("sensors") + "<h3>Devices</h3>" +
      '<button class="w-ic" data-w-act="deviceload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows ? '<ul class="w-devices">' + rows + "</ul>" : '<p class="w-empty">No monitor currently associated with this patient.</p>') +
      '<div class="w-filter"><input id="wDevId" type="text" placeholder="Device ID" autocomplete="off">' +
      '<input id="wDevTag" type="text" placeholder="Scan asset tag" autocomplete="off">' +
      '<input id="wDevWrist" type="text" placeholder="Scan wristband" autocomplete="off">' +
      '<button class="w-btn" data-w-act="deviceassociate">' + ms("sensors") + "Associate</button></div>" +
      '<p class="w-hint">' + ms("info") + "Both codes must be scanned and must match this patient - a device found in the room is not the same as a device confirmed on the patient." + "</p></div>";
  }

  /* PREGNANCY EPISODE. Gravida/para/gestation, recorded exactly as entered - para only ever changes
   * on its own when a real delivery is recorded (migrate-maternity.js), never edited here. */
  function pregnancyCard(state) {
    var p = state.maternity && state.maternity.pregnancy;
    return '<div class="w-card"><div class="w-card-h">' + ms("pregnant_woman") + "<h3>Pregnancy</h3>" +
      '<button class="w-ic" data-w-act="maternityload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (p ? '<p class="w-hint">' + ms("info") + "Gravida " + esc(p.gravida == null ? "?" : p.gravida) + ", para " + esc(p.para == null ? "?" : p.para) +
        (p.gestationWeeks != null ? ", " + esc(p.gestationWeeks) + " weeks gestation" : "") + (p.edd ? ", EDD " + esc(p.edd) : "") + "</p>" : '<p class="w-empty">No pregnancy episode recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Gravida</span><input id="wPregGravida" type="text" inputmode="numeric" autocomplete="off" value="' + esc(p && p.gravida != null ? p.gravida : "") + '"></label>' +
      '<label class="w-f"><span>Para</span><input id="wPregPara" type="text" inputmode="numeric" autocomplete="off" value="' + esc(p && p.para != null ? p.para : "") + '"></label>' +
      '<label class="w-f"><span>Gestation (weeks)</span><input id="wPregWeeks" type="text" inputmode="numeric" autocomplete="off" value="' + esc(p && p.gestationWeeks != null ? p.gestationWeeks : "") + '"></label>' +
      '<label class="w-f"><span>EDD</span><input id="wPregEdd" type="text" autocomplete="off" placeholder="YYYY-MM-DD" value="' + esc((p && p.edd) || "") + '"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="pregnancysave">' + ms("save") + "Save</button></div>";
  }

  /* MEOWS. Triggers, never a total - the card renders exactly what wardsynq-obstetrics.js returns
   * and computes nothing of its own. */
  function meowsCard(state) {
    var m = state.maternity && state.maternity.meows;
    if (!m) return "";
    if (!m.applicable) return '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>MEOWS</h3></div><p class=\"w-hint\">" + ms("info") + esc(m.reason) + "</p></div>";
    var red = (m.red || []).map(function (t) { return "<li class=\"lvl-escalate\">" + esc(t.label) + ": " + esc(t.value) + "</li>"; }).join("");
    var yellow = (m.yellow || []).map(function (t) { return "<li class=\"lvl-due\">" + esc(t.label) + ": " + esc(t.value) + "</li>"; }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>MEOWS</h3>" +
      '<button class="w-ic" data-w-act="maternityload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (m.alert ? '<div class="w-news2 risk-high"><b>' + esc((m.red || []).length || (m.yellow || []).length) + "</b><span>trigger" + (((m.red || []).length + (m.yellow || []).length) === 1 ? "" : "s") + "</span></div>" : '<div class="w-news2 risk-low"><b>0</b><span>no trigger</span></div>') +
      (red || yellow ? '<ul class="w-crit-list">' + red + yellow + "</ul>" : "") +
      '<p class="w-hint warn">' + ms("warning") + esc(m.advice) + "</p>" +
      (m.ageCaution ? '<p class="w-hint warn">' + ms("warning") + esc(m.ageCaution) + "</p>" : "") +
      "</div>";
  }

  /* BLOOD LOSS. Visual vs quantitative is never blurred - the card shows what recordBloodLoss()
   * actually returned, including the honest "plausibly double" reading of a visual estimate. */
  function bloodLossCard(state) {
    var losses = (state.maternity && state.maternity.losses) || [];
    var rows = losses.map(function (l) {
      return "<li><b>" + esc(l.ml) + " mL</b><span>" + esc(l.method) + (l.quantitative ? "" : " (visual - plausibly " + esc(l.plausibleActualMl) + " mL)") + "</span></li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("water_drop") + "<h3>Blood loss</h3></div>" +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No blood loss recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>mL</span><input id="wLossMl" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>How established</span><select id="wLossMethod"><option value="weighed">Weighed</option><option value="calibrated-drape">Calibrated drape</option><option value="suction-volume">Suction volume</option><option value="visual-estimate">Visual estimate</option></select></label>' +
      "</div>" +
      '<button class="w-btn warn" data-w-act="bloodlosssave">' + ms("save") + "Record</button></div>";
  }

  /* DELIVERY + NEWBORN. Delivery documented first; a newborn cannot be registered before a real
   * delivery record exists for this encounter (migrate-maternity.js refuses it). */
  function deliveryCard(state) {
    var d = state.maternity && state.maternity.delivery;
    var links = (state.maternity && state.maternity.links) || [];
    var newbornRows = links.map(function (l) {
      return "<li><b>" + esc(l.relatedPatientId) + "</b><span>linked " + when(l.recordedAt) + "</span></li>";
    }).join("");
    if (!d) {
      return '<div class="w-card"><div class="w-card-h">' + ms("child_care") + "<h3>Delivery</h3></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Mode</span><select id="wDelMode"><option value="vaginal">Vaginal</option><option value="caesarean">Caesarean</option><option value="instrumental">Instrumental</option></select></label>' +
        "</div>" +
        '<label class="w-f"><span>Complications</span><textarea id="wDelComplications" rows="2"></textarea></label>' +
        '<button class="w-btn go" data-w-act="deliverysave">' + ms("save") + "Record delivery</button></div>";
    }
    return '<div class="w-card"><div class="w-card-h">' + ms("child_care") + "<h3>Delivery &amp; newborn</h3></div>" +
      '<p class="w-hint">' + ms("check_circle") + esc(d.mode) + " delivery, " + when(d.deliveredAt) + (d.complications ? " - " + esc(d.complications) : "") + "</p>" +
      (newbornRows ? '<ul class="w-mini">' + newbornRows + "</ul>" : "") +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Sex</span><select id="wNewbornSex"><option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option></select></label>' +
      '<label class="w-f"><span>Name</span><input id="wNewbornName" type="text" autocomplete="off" placeholder="optional"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="newbornsave">' + ms("child_care") + "Register newborn</button></div>";
  }

  /* PARTOGRAM entry. Writes ordinary Observations, category "labour" - the flowsheet card already on
   * this chart is where they are actually read back, honestly: nothing here plots an alert or action
   * line, because that is real clinical content this build will not invent. */
  function labourCard() {
    return '<div class="w-card"><div class="w-card-h">' + ms("timeline") + "<h3>Labour</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Status</span><select id="wLabStatus"><option value="not-in-labour">Not in labour</option><option value="latent">Latent</option><option value="active">Active</option><option value="second-stage">Second stage</option><option value="third-stage">Third stage</option></select></label>' +
      '<label class="w-f"><span>Cervical dilation (cm)</span><input id="wLabDilation" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Contractions /10min</span><input id="wLabContractions" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Fetal heart rate</span><input id="wLabFhr" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="labourchart">' + ms("save") + "Chart</button>" +
      '<p class="w-hint">' + ms("info") + "Recorded on the flowsheet below, exactly as charted. This is not a WHO partogram alert/action-line plot." + "</p></div>";
  }

  /* NEONATAL respiratory-support / device-settings entry. Same shape as labourCard: writes ordinary
   * Observations, category "neonatal", read back on the shared flowsheet grid below. */
  function neonatalCard() {
    return '<div class="w-card"><div class="w-card-h">' + ms("air") + "<h3>Respiratory support</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Mode</span><select id="wNeoMode"><option value="room-air">Room air</option><option value="low-flow-oxygen">Low-flow oxygen</option><option value="cpap">CPAP</option><option value="ventilated">Ventilated</option></select></label>' +
      '<label class="w-f"><span>FiO2 (%)</span><input id="wNeoFio2" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>PEEP (cmH2O)</span><input id="wNeoPeep" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="neonatalchart">' + ms("save") + "Chart</button>" +
      '<p class="w-hint">' + ms("info") + "Recorded on the flowsheet below, exactly as charted." + "</p></div>";
  }

  /* AGE/WEIGHT SAFETY. The card shows the REAL wardsynq-paediatrics.js banding, never a client-side
   * guess, and a weight-based-rate calculator that persists nothing - the actual infusion is still
   * charted through the existing rate/infusion door, unchanged. */
  function ageBandCard(state) {
    var b = state.ageBand;
    return '<div class="w-card"><div class="w-card-h">' + ms("straighten") + "<h3>Age &amp; weight</h3>" +
      '<button class="w-ic" data-w-act="agebandcheck" title="Check">' + ms("refresh") + "</button></div>" +
      (b ? '<p class="w-hint' + (b.weightWarning ? " warn" : "") + '">' + ms(b.weightWarning ? "warning" : "info") + "Band: " + esc(b.band) +
        (b.neonatal && !b.neonatal.ready ? " - " + esc(b.neonatal.reason) : "") +
        (b.weightWarning ? " - " + esc(b.weightWarning.message) : "") + "</p>" : "") +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Weight (kg)</span><input id="wAgeWeight" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Gestational age (weeks, if neonate)</span><input id="wAgeGest" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<div class="w-sub"><h4>' + ms("calculate") + "Weight-based rate</h4>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>mcg/kg/min</span><input id="wRateDose" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Concentration (mg/mL)</span><input id="wRateConc" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn ghost" data-w-act="ratecalc">' + ms("calculate") + "Calculate</button>" +
      (state.rateResult ? '<p class="w-hint' + (state.rateResult.weightWarning ? " warn" : "") + '">' + esc(state.rateResult.ratePerHour == null ? state.rateResult.reason : state.rateResult.workings + " = " + state.rateResult.ratePerHour + " mL/h") + "</p>" : "") +
      "</div></div>";
  }

  /* LINES. A placement log, mirroring surgery's implant card exactly - site, type, when, by. */
  function linesCard(state) {
    var rows = (state.lines || []).map(function (l) {
      return "<li><b>" + esc(l.type) + "</b><span>" + (l.site ? esc(l.site) + " &middot; " : "") + "placed " + when(l.insertedAt) + (l.removedAt ? " &middot; removed " + when(l.removedAt) : "") + "</span>" +
        (!l.removedAt ? '<button class="w-btn tiny warn" data-w-act="lineremove:' + esc(l.id) + '">' + ms("close") + "Remove</button>" : "") + "</li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("device_hub") + "<h3>Lines</h3>" +
      '<button class="w-ic" data-w-act="linesload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No lines recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Type</span><input id="wLineType" type="text" autocomplete="off" placeholder="e.g. UVC, PICC"></label>' +
      '<label class="w-f"><span>Site</span><input id="wLineSite" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="linesave">' + ms("add") + "Record line</button></div>";
  }

  /* THE ONCqis BRIDGE VIEW. ONCqis itself (staging, protocols, dosing, CTCAE) is a separate,
   * owner-approved product and is not rebuilt here - this screen only links a plan, records the
   * diagnosis/staging IT resolved, an adverse-event grade IT assigned, and a chemo administration's
   * documentation. Nothing here computes a stage, a dose or a grade. */
  function oncologyView(state) {
    var tl = (state.oncology && state.oncology.timeline) || null;
    var linkRows = ((tl && tl.links) || []).map(function (l) {
      return "<li><b>" + esc(l.regimen || l.oncoPlanId) + "</b><span>plan " + esc(l.oncoPlanId) + (l.protocolVersion ? " v" + esc(l.protocolVersion) : "") + "</span></li>";
    }).join("");
    var dxRows = ((tl && tl.diagnoses) || []).map(function (c) {
      var s = c.oncologyStaging || {};
      return "<li><b>" + esc(c.display) + "</b><span>" + (s.stageGroup ? "stage " + esc(s.stageGroup) + " (" + esc(s.t) + " " + esc(s.n) + " " + esc(s.m) + ")" : "") + "</span></li>";
    }).join("");
    var aeRows = ((tl && tl.adverseEvents) || []).map(function (e) {
      return '<li><b>' + esc(e.term) + '</b><span class="w-vs">grade ' + esc(e.grade) + " &middot; CTCAE v" + esc(e.ctcaeVersion) + "</span></li>";
    }).join("");
    var chemoRows = ((tl && tl.chemoAdministrations) || []).map(function (a) {
      return "<li><b>" + esc(a.drug) + "</b><span>" + esc(a.doseGiven) + esc(a.doseUnit || "") + (a.bsaUsed ? " &middot; BSA " + esc(a.bsaUsed) : "") +
        (a.extravasation && a.extravasation.occurred ? '<span class="w-st overdue">extravasation</span>' : "") + " &middot; " + when(a.startedAt) + "</span></li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Oncology</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="oncologyload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("link") + "<h3>ONCqis plan link</h3></div>" +
      (linkRows ? '<ul class="w-mini">' + linkRows + "</ul>" : '<p class="w-empty">No ONCqis plan linked.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>ONCqis plan id</span><input id="wOncoPlanId" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Regimen</span><input id="wOncoRegimen" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Protocol version</span><input id="wOncoVersion" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="oncolinksave">' + ms("link") + "Link plan</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("clinical_notes") + "<h3>Diagnosis &amp; staging</h3></div>" +
      (dxRows ? '<ul class="w-mini">' + dxRows + "</ul>" : '<p class="w-empty">No oncology diagnosis recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Code</span><input id="wOncoDxCode" type="text" autocomplete="off" placeholder="e.g. C34.1"></label>' +
      '<label class="w-f"><span>Description</span><input id="wOncoDxDisplay" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Stage group (from ONCqis)</span><input id="wOncoStage" type="text" autocomplete="off" placeholder="e.g. IIIA"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="oncodxsave">' + ms("save") + "Record diagnosis</button>" +
      '<p class="w-hint">' + ms("info") + "Staging is recorded exactly as ONCqis's own engine resolved it - nothing here derives a stage." + "</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("warning") + "<h3>Adverse events</h3></div>" +
      (aeRows ? '<ul class="w-mini">' + aeRows + "</ul>" : '<p class="w-empty">None recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Term</span><input id="wOncoAeTerm" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>CTCAE grade (1-5, from ONCqis)</span><input id="wOncoAeGrade" type="text" inputmode="numeric" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn warn" data-w-act="oncoaesave">' + ms("add") + "Record adverse event</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("medication") + "<h3>Chemotherapy administration</h3></div>" +
      (chemoRows ? '<ul class="w-mini">' + chemoRows + "</ul>" : '<p class="w-empty">None recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Cycle id</span><input id="wOncoCycleId" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Drug</span><input id="wOncoDrug" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Dose given</span><input id="wOncoDose" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>BSA used</span><input id="wOncoBsa" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<label class="w-chk"><input type="checkbox" id="wOncoExtrav"> Extravasation occurred</label>' +
      '<button class="w-btn go" data-w-act="oncochemosave">' + ms("save") + "Record administration</button>" +
      '<p class="w-hint">' + ms("info") + "This documents what a cycle's administration was; it does not re-run the bedside five-rights scan, which stays on the ordinary eMAR." + "</p></div>";
  }

  function cardiologyView(state) {
    var tl = (state.cardiology && state.cardiology.timeline) || null;
    var linkRows = ((tl && tl.links) || []).map(function (l) {
      return "<li><b>" + esc(l.kardioxRecordId) + "</b><span>mrn " + esc(l.mrn) + "</span></li>";
    }).join("");
    var ecgRows = ((tl && tl.ecgs) || []).map(function (e) {
      return "<li><b>" + esc(e.verdict) + "</b><span>" +
        (e.heartScore != null ? "HEART " + esc(e.heartScore) + " &middot; " : "") +
        (e.timiScore != null ? "TIMI " + esc(e.timiScore) + " &middot; " : "") +
        '<span class="w-st overdue">unvalidated AI output</span> &middot; ' + when(e.capturedAt || e.recordedAt) + "</span></li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Cardiology</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="cardiologyload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("link") + "<h3>KardiQ X record link</h3></div>" +
      (linkRows ? '<ul class="w-mini">' + linkRows + "</ul>" : '<p class="w-empty">No KardiQ X record linked.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>KardiQ X record id</span><input id="wCardioRecordId" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cardiolinksave">' + ms("link") + "Link record</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>ECG reference</h3></div>" +
      (ecgRows ? '<ul class="w-mini">' + ecgRows + "</ul>" : '<p class="w-empty">No ECG reference recorded.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Verdict (from KardiQ X)</span><input id="wCardioVerdict" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>HEART score</span><input id="wCardioHeart" type="text" inputmode="numeric" autocomplete="off"></label>' +
      '<label class="w-f"><span>TIMI score</span><input id="wCardioTimi" type="text" inputmode="numeric" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cardioecgsave">' + ms("save") + "Record ECG reference</button>" +
      '<p class="w-hint">' + ms("warning") + "KardiQ X is self-declared clinically unvalidated, regulatory-pending. This records its AI verdict as external, unvalidated output - never a validated clinical finding." + "</p></div>";
  }

  /* TASK 3.2: the radiologist's actual workflow, not the generic order/result list - a worklist of
   * this patient's imaging orders, the contrast/allergy protocol context ALREADY built
   * (radiology-protocol.js) but never reachable from any screen before this, and report entry
   * through the SAME state machine (radiology-report.js) that already keeps a preliminary reading on
   * the record and flags a changed impression as a discrepancy. NO IMAGE VIEWER: DICOM/PACS does not
   * exist in this build, and a screen that pretended otherwise would be worse than one that says so. */
  function radiologyView(state) {
    var rad = state.radiology || {};
    var studies = ((state.investigations && state.investigations.requests) || []).filter(function (r) { return r.category === "imaging"; });
    var pc = rad.protocol;
    var picked = rad.pickedRequestId;

    var studyRows = studies.map(function (s) {
      var st_ = (s.collection && s.collection.state) || "ordered";
      return '<li' + (s.serviceRequestId === picked ? ' class="picked"' : '') + '>' +
        '<button class="w-btn ghost tiny" data-w-act="radpick:' + esc(s.serviceRequestId) + '"><b>' + esc(s.display || s.code) + "</b></button>" +
        "<span>" + (s.priority && s.priority !== "routine" ? esc(s.priority).toUpperCase() + " &middot; " : "") + esc(st_.replace(/_/g, " ")) + "</span></li>";
    }).join("");

    var allergyRows = pc && pc.contrastAllergies && pc.contrastAllergies.length
      ? '<ul class="w-mini">' + pc.contrastAllergies.map(function (a) {
          return "<li><b>" + esc(a.substance) + "</b><span>" + esc(a.reaction || "") + (a.severity ? " &middot; " + esc(a.severity) : "") + "</span></li>";
        }).join("") + "</ul>"
      : "";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Radiology</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="radiologyload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("list") + "<h3>Imaging worklist</h3></div>" +
      (studyRows ? '<ul class="w-mini">' + studyRows + "</ul>" : '<p class="w-empty">No imaging ordered for this patient.</p>') +
      "</div>" +

      (picked ? (
        '<div class="w-card"><div class="w-card-h">' + ms("shield") + "<h3>Protocol context</h3></div>" +
        (pc ? (
          (allergyRows ? '<p class="w-hint warn">' + ms("warning") + "A contrast reaction is recorded for this patient.</p>" + allergyRows
                       : '<p class="w-hint">' + ms("info") + "No contrast reaction is recorded. That is what the record holds, not a guarantee none happened elsewhere.</p>") +
          (pc.renal ? "<p><b>Latest creatinine</b>: " + esc(pc.renal.value) + " " + esc(pc.renal.unit || "") + " (" + when(pc.renal.at) + ")</p>" : "<p class=\"w-empty\">No creatinine on record.</p>") +
          '<div class="w-grid">' +
          '<label class="w-f"><span>Protocol</span><input id="wRadProtocol" type="text" autocomplete="off" placeholder="e.g. CT abdomen with contrast"></label>' +
          '<label class="w-chk"><input type="checkbox" id="wRadContrast"> Contrast planned</label>' +
          "</div>" +
          '<button class="w-btn go" data-w-act="radprotocolsave">' + ms("save") + "Record protocol</button>"
        ) : '<p class="w-empty">Loading&hellip;</p>') +
        "</div>" +

        '<div class="w-card"><div class="w-card-h">' + ms("image_not_supported") + "<h3>Study images</h3></div>" +
        '<p class="w-hint warn">' + ms("visibility_off") + "IMAGE SOURCE UNAVAILABLE. No PACS/DICOM viewer is connected in this build; the report below is the record, not the pixels.</p>" +
        "</div>" +

        '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Report</h3></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Modality</span><input id="wRadModality" type="text" autocomplete="off" placeholder="e.g. CT, XR, US, MR"></label>' +
        '<label class="w-f"><span>Status</span><select id="wRadStatus"><option value="preliminary">Preliminary</option><option value="final">Final</option><option value="corrected">Corrected</option></select></label>' +
        "</div>" +
        '<label class="w-f"><span>Findings</span><textarea id="wRadFindings" rows="3"></textarea></label>' +
        '<label class="w-f"><span>Impression</span><textarea id="wRadImpression" rows="2"></textarea></label>' +
        '<label class="w-chk"><input type="checkbox" id="wRadCritical"> Critical finding - opens the SAME closed-loop notification a critical lab value does</label>' +
        '<button class="w-btn go" data-w-act="radreportsave">' + ms("send") + "Release report</button>" +
        '<p class="w-hint">' + ms("info") + "A final report needs an impression. A changed impression from a preliminary reading is flagged as a discrepancy, never silently overwritten." + "</p></div>"
      ) : '<p class="w-empty" style="padding:0 16px">Pick a study above to protocol or report it.</p>');
  }

  /* TASK 8.9: MaiK's words about the verdict the engine computed, rendered under it and never
   * beside it as an equal. Three things stay three things on the screen: the FINDINGS above (the
   * engine's, authoritative), this EXPLANATION (MaiK's, never authoritative), and what the clinician
   * then does (a separate act, on a separate record). A refusal is shown verbatim - a fail-closed
   * safety check that renders as a blank panel reads as "nothing wrong", which is the error this
   * whole path exists to prevent. */
  function maikExplainBlock(state, pickedOrder) {
    var ex = (state.pharmacy && state.pharmacy.explain) || null;
    if (!ex || ex.orderId !== pickedOrder.orderId) {
      return '<div class="w-maik-acts"><button class="w-btn ghost" data-w-act="maikexplain">' + ms("neurology") +
        "Ask MaiK to explain this verdict</button></div>";
    }
    if (ex.busy) return '<p class="w-empty">Asking MaiK&hellip;</p>';
    /* A REFUSAL IS SHOWN VERBATIM. The server's own sentence is the one that says which check did not
     * run; flattening it to "unavailable" is how a fail-closed safety check comes to read as a clean
     * one on a screen. */
    if (ex.err) {
      return '<div class="w-sub"><h4>' + ms("neurology") + "MaiK did not explain this</h4>" +
        '<p class="w-hint warn">' + ms("block") + esc(ex.err) + "</p>" +
        '<div class="w-maik-acts"><button class="w-btn ghost" data-w-act="maikexplain">' + ms("refresh") + "Try again</button></div></div>";
    }
    var i = ex.interaction || {};
    var m = i.model || {};
    var reviewed = i.review && i.review.state && i.review.state !== "pending";
    var body = ex.explanation
      ? '<div class="w-maik-out">' + esc(ex.explanation).replace(/\n/g, "<br>") + "</div>"
      : '<p class="w-hint warn">' + ms("block") + "MaiK's answer was withheld before anybody saw it" +
        (ex.withheld && ex.withheld.violations && ex.withheld.violations.length ? " (" + esc(ex.withheld.violations.join(", ")) + ")" : "") +
        ". The findings above are the deterministic engine's own and are unaffected.</p>";

    return '<div class="w-sub"><h4>' + ms("neurology") + "MaiK explains the findings above</h4>" +
      body +
      '<ul class="w-maik-prov">' +
      "<li>" + ms("health_and_safety") + "<span>MaiK computed none of this. The findings above are the deterministic safety engine's, on rule pack " +
        esc((ex.deterministic && ex.deterministic.rulePackVersion) || "unknown") + "." +
        (ex.deterministic && ex.deterministic.unapproved ? " That content is unapproved and does not gate this order." : "") + "</span></li>" +
      "<li>" + ms("smart_toy") + "<span>" + esc(m.model || "unknown model") +
        (m.version ? " &middot; " + esc(m.version) : "") + "</span></li>" +
      "<li>" + ms("gavel") + "<span>Reading or rejecting these words overrides nothing. Overriding a finding is a separate act, with its own reason, on the override record.</span></li>" +
      "</ul>" +
      (reviewed
        ? '<p class="w-hint">' + ms("task_alt") + esc(i.review.state.charAt(0).toUpperCase() + i.review.state.slice(1)) +
          " by " + esc(i.review.by || "") + (i.review.reason ? " &middot; " + esc(i.review.reason) : "") + " &middot; no finding changed.</p>"
        : (ex.explanation ? '<div class="w-maik-acts">' +
          '<button class="w-btn ghost" data-w-act="maikexplainreview:accepted">' + ms("thumb_up") + "Helpful</button>" +
          '<button class="w-btn ghost" data-w-act="maikexplainreview:rejected">' + ms("thumb_down") + "Not helpful</button>" +
          "</div>" : "")) +
      "</div>";
  }

  /* TASK 3.3: the pharmacist's own verification queue - not a reuse of the doctor's ordering view.
   * Every row carries the SAME safety-engine verdict the bedside eMAR runs (never a second engine,
   * never silently skipped - a rule pack that fails to load reads as a NOT_CHECKED_* warning, never
   * as a quiet "clear"), the allergy list a verification is actually checking against, and the exact
   * state (unverified/queried/stale/verified) pharmacy-verify.js's own ranking already computes.
   * Verifying writes ONLY MedicationVerification, never MedicationAdministration - a pharmacist
   * cannot give or claim to have given a dose through this screen, by construction. */
  function pharmacyView(state) {
    var ph = state.pharmacy || {};
    var q = ph.queue;
    var picked = ph.pickedOrderId;
    var dispenses = ph.dispenses || [];

    var orderRows = ((q && q.orders) || []).map(function (o) {
      var safe = o.safety || {};
      var blocked = safe.blocks && safe.blocks.length;
      var warned = safe.warnings && safe.warnings.length;
      return '<li' + (o.orderId === picked ? ' class="picked"' : '') + '>' +
        '<button class="w-btn ghost tiny" data-w-act="phpick:' + esc(o.orderId) + '"><b>' + esc(o.drug) + "</b></button>" +
        '<span class="w-st ' + esc(o.state) + '">' + esc(o.state) + "</span>" +
        (blocked ? '<span class="w-st overdue">' + ms("block") + safe.blocks.length + " blocked</span>" : "") +
        (warned ? '<span class="w-st due">' + ms("warning") + safe.warnings.length + " warning</span>" : "") +
        "</li>";
    }).join("");

    var allergyRows = (q && q.allergies || []).map(function (a) {
      return "<li><b>" + esc(a.substance) + "</b>" + (a.severity ? "<span>" + esc(a.severity) + "</span>" : "") + "</li>";
    }).join("");

    var pickedOrder = picked && q ? q.orders.filter(function (o) { return o.orderId === picked; })[0] : null;
    var safety = pickedOrder && pickedOrder.safety;

    var dispenseRows = dispenses.map(function (d) {
      return "<li><b>" + esc(d.drug) + "</b><span>" + esc(d.quantity && (d.quantity.value + " " + d.quantity.unit)) +
        (d.batch ? " &middot; batch " + esc(d.batch) : "") + (d.expiry ? " &middot; exp " + esc(d.expiry) : "") +
        " &middot; " + when(d.dispensedAt) + "</span></li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Pharmacy</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="pharmacyload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("medication") + "<h3>Verification queue" + (q ? " &middot; " + q.unverified + " unverified" : "") + "</h3></div>" +
      (orderRows ? '<ul class="w-mini">' + orderRows + "</ul>" : '<p class="w-empty">No active orders for this patient.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("warning") + "<h3>Allergies</h3></div>" +
      (allergyRows ? '<ul class="w-mini">' + allergyRows + "</ul>" : '<p class="w-empty">No allergy recorded.</p>') +
      "</div>" +

      (pickedOrder ? (
        '<div class="w-card"><div class="w-card-h">' + ms("health_and_safety") + "<h3>Safety verdict &middot; " + esc(pickedOrder.drug) + "</h3></div>" +
        (safety ? (
          (safety.blocks && safety.blocks.length ? '<ul class="w-mini">' + safety.blocks.map(function (b) { return '<li class="w-st overdue">' + esc(b.code) + "<span>" + esc(b.message || "") + "</span></li>"; }).join("") + "</ul>" : "") +
          (safety.warnings && safety.warnings.length ? '<ul class="w-mini">' + safety.warnings.map(function (w) {
            var notChecked = String(w.code || "").indexOf("NOT_CHECKED") === 0 || w.code === "NO_RULE_PACK" || w.code === "SAFETY_CHECK_UNAVAILABLE";
            return '<li class="w-st ' + (notChecked ? "due" : "overdue") + '">' + esc(w.code) + "<span>" + esc(w.message || "") + "</span></li>";
          }).join("") + "</ul>" : "") +
          (!(safety.blocks && safety.blocks.length) && !(safety.warnings && safety.warnings.length) ? '<p class="w-empty">The safety engine reports nothing against this order.</p>' : "")
        ) : '<p class="w-empty">Loading&hellip;</p>') +
        '<p class="w-hint">' + ms("info") + "This is decision support, not a block: the pharmacist's own judgement decides the outcome." + "</p>" +
        /* TASK 8.9: MaiK explains the verdict ABOVE, inside the card that already shows it. There is
         * deliberately no second CDS screen: the findings a clinician acts on are the engine's, and
         * putting MaiK anywhere else would create a rival place to read them. */
        maikExplainBlock(state, pickedOrder) + "</div>" +

        '<div class="w-card"><div class="w-card-h">' + ms("fact_check") + "<h3>Verify</h3></div>" +
        '<label class="w-f"><span>Query reason (required if querying)</span><input id="wPhReason" type="text" autocomplete="off"></label>' +
        '<div class="w-actions">' +
        '<button class="w-btn go" data-w-act="phverify">' + ms("check") + "Verify</button>" +
        '<button class="w-btn warn" data-w-act="phquery">' + ms("help") + "Query</button>" +
        "</div></div>" +

        '<div class="w-card"><div class="w-card-h">' + ms("outbound") + "<h3>Dispense</h3></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Quantity</span><input id="wPhQty" type="text" inputmode="decimal" autocomplete="off"></label>' +
        '<label class="w-f"><span>Unit</span><input id="wPhUnit" type="text" autocomplete="off" placeholder="e.g. tablet, mL"></label>' +
        '<label class="w-f"><span>Batch</span><input id="wPhBatch" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Expiry</span><input id="wPhExpiry" type="date"></label>' +
        '<label class="w-f"><span>Destination</span><input id="wPhDest" type="text" autocomplete="off" placeholder="e.g. Ward A cabinet"></label>' +
        "</div>" +
        '<button class="w-btn go" data-w-act="phdispense">' + ms("send") + "Dispense</button>" +
        (dispenseRows ? '<div class="w-sub"><h4>' + ms("history") + "Dispense history</h4><ul class=\"w-mini\">" + dispenseRows + "</ul></div>" : "") +
        '<p class="w-hint">' + ms("info") + "No stock is deducted without this event. An expired batch or a dispense against an unverified order is shown exactly as the server reports it, never hidden." + "</p></div>"
      ) : '<p class="w-empty" style="padding:0 16px">Pick an order above to verify or dispense it.</p>');
  }

  /* TASK 3.4: hospital-wide pharmacy stock, not patient-scoped - the same shape ED/Surgery's own
   * ward-wide boards already use. A level is DERIVED (stock.js's own rule) and shown exactly as
   * computed: negative levels are never clamped, mixed units are never summed, and a dispense
   * already reduces the level without a second movement being written for it. */
  function inventoryView(state) {
    var inv = state.inventory || {};
    var s = inv.stock;
    var levels = (s && s.levels) || [];
    var expiring = (s && s.expiring) || [];

    var levelRows = levels.map(function (r) {
      return "<li><b>" + esc(r.display) + "</b><span>" + esc(r.location || "") + " &middot; " + esc(r.level) + " " + esc(r.unit) +
        (r.impossible ? '<span class="w-st overdue">' + ms("error") + "impossible</span>" : "") +
        (r.belowReorder ? '<span class="w-st due">' + ms("warning") + "reorder</span>" : "") +
        "</span></li>";
    }).join("");

    var expiringRows = expiring.map(function (r) {
      return "<li><b>" + esc(r.display) + "</b><span>" + esc(r.location || "") + " &middot; batch " + esc(r.batch || "-") + " &middot; " +
        (r.expired ? '<span class="w-st overdue">expired</span>' : esc(r.daysRemaining) + " days left") + "</span></li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Inventory</b></div>" +
      '<button class="w-ic" data-w-act="inventoryload" title="Refresh">' + ms("refresh") + "</button></div>" +

      (s && s.negative && s.negative.length ? '<p class="w-hint warn">' + ms("error") + esc(s.negativeWarning) + "</p>" : "") +
      (s && s.mixedUnitsWarning ? '<p class="w-hint warn">' + ms("warning") + esc(s.mixedUnitsWarning) + "</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("inventory_2") + "<h3>Stock levels</h3></div>" +
      (levelRows ? '<ul class="w-mini">' + levelRows + "</ul>" : '<p class="w-empty">No stock movements recorded yet.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("event_busy") + "<h3>Near expiry</h3></div>" +
      (expiringRows ? '<ul class="w-mini">' + expiringRows + "</ul>" : '<p class="w-empty">Nothing expiring soon.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("call_received") + "<h3>Receipt</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Drug</span><input id="wStkCode" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Quantity</span><input id="wStkQty" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wStkUnit" type="text" autocomplete="off" placeholder="e.g. tablet, vial"></label>' +
      '<label class="w-f"><span>Location</span><input id="wStkLoc" type="text" autocomplete="off" placeholder="e.g. Main"></label>' +
      '<label class="w-f"><span>Batch</span><input id="wStkBatch" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Expiry</span><input id="wStkExpiry" type="date"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="stockreceive">' + ms("add") + "Record receipt</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("edit") + "<h3>Adjustment / wastage</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Drug</span><input id="wAdjCode" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Quantity (+/-)</span><input id="wAdjQty" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wAdjUnit" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Location</span><input id="wAdjLoc" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<label class="w-f"><span>Reason (required)</span><input id="wAdjReason" type="text" autocomplete="off"></label>' +
      '<div class="w-actions">' +
      '<button class="w-btn warn" data-w-act="stockadjust">' + ms("edit") + "Adjust</button>" +
      '<button class="w-btn warn" data-w-act="stockwaste">' + ms("delete") + "Wastage</button>" +
      "</div></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("fact_check") + "<h3>Reconciliation</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Drug</span><input id="wRecCode" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wRecUnit" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Location</span><input id="wRecLoc" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Counted quantity</span><input id="wRecCounted" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<label class="w-f"><span>Note (optional)</span><input id="wRecReason" type="text" autocomplete="off"></label>' +
      '<button class="w-btn go" data-w-act="stockreconcile">' + ms("check") + "Reconcile</button>" +
      '<p class="w-hint">' + ms("info") + "Posts the counted quantity against the derived level as an auditable adjustment naming the expected value and the variance. A matching count writes nothing." + "</p></div>";
  }

  /* TASK 3.6: the hospital-wide critical-result queue. Not patient-scoped, unlike criticalsCard on
   * the ordinary chart - the SAME listCriticalLoops() backend, called with no patientId, so whoever
   * is covering the ward or the lab can see every open loop at once. No new logic: same escalation
   * levels, same "acknowledging records what was done, not a way to clear the list" discipline. */
  /* THE INTEGRATION CONSOLE (TASK 7.10). A WardSynQ workstation for the person who has to answer
   * "is anything stuck", not an onboarding wizard: onboarding is a one-off act of connecting a
   * hospital, and this is the screen somebody opens on a Tuesday morning because a laboratory has
   * rung to ask why a result never arrived.
   *
   * IT SHOWS BOTH DIRECTIONS AND IT NEVER FLATTERS EITHER. Every count here is something a person
   * may have to act on: messages HELD because WardSynQ would not file them without a decision;
   * deliveries that FAILED and are backing off; deliveries that have been DEAD-LETTERED and stopped
   * for good; authorisations that have EXPIRED or been REVOKED and would silently refuse the next
   * message. A zero is only shown when the list was actually read - an unreachable list says so,
   * because "nothing held" and "could not tell" are the two answers that must never look alike on
   * an operations screen. */
  function integrationView(state) {
    var g = state.integration || {};
    var errs = (g.errors || []);
    var held = (g.exceptions && g.exceptions.open) || [];
    var grants = (g.grants && g.grants.grants) || [];
    var dests = (g.destinations && g.destinations.destinations) || [];
    var deliveries = (g.outbound && g.outbound.deliveries) || [];
    var counts = (g.outbound && g.outbound.counts) || {};
    var unreachable = function (what) { return errs.indexOf(what) >= 0; };

    var stat = function (label, n, what, hint) {
      return '<li class="w-int-stat' + (n > 0 ? " on" : "") + '"><b>' + (unreachable(what) ? "?" : n) + "</b><span>" + esc(label) + "</span>" +
        (unreachable(what) ? '<small class="warn">could not be read</small>' : (hint ? "<small>" + esc(hint) + "</small>" : "")) + "</li>";
    };

    var grantRows = grants.map(function (r) {
      return '<li class="st-' + esc(r.state) + '"><div><b>' + esc(r.sourceSystem) + "</b>" +
        "<small>" + esc(r.actorId || "") + (r.grantedAt ? " &middot; granted " + when(r.grantedAt) : "") +
        (r.state === "expired" ? " &middot; expired " + when(r.expiresAt) : "") +
        (r.state === "revoked" ? " &middot; revoked" + (r.revokedReason ? ": " + esc(r.revokedReason) : "") : "") + "</small></div>" +
        '<span class="w-int-tag">' + esc(r.state) + "</span>" +
        (r.state === "active" ? '<button class="w-btn tiny" data-w-act="srcrevoke:' + esc(r.sourceSystem) + "|" + esc(r.actorId || "") + '">' + ms("block") + "Revoke</button>" : "") +
        "</li>";
    }).join("");

    var destRows = dests.map(function (d) {
      return '<li class="' + (d.active ? "" : "st-revoked") + '"><div><b>' + esc(d.name) + "</b>" +
        "<small>" + esc(d.url) + " &middot; " + esc((d.resourceTypes || []).join(", ") || "nothing") + "</small>" +
        "<small>" + (d.auth && d.auth.kind === "bearer"
          ? (d.auth.configured ? "authenticated &middot; credential present" : "authenticated &middot; NO CREDENTIAL CONFIGURED")
          : "no authentication") + "</small></div>" +
        (d.active ? '<button class="w-btn tiny" data-w-act="destrevoke:' + esc(d.name) + '">' + ms("block") + "Stop</button>"
                  : '<span class="w-int-tag">stopped</span>') + "</li>";
    }).join("");

    // Only what a person can still do something about: what is stuck, and what has given up.
    var stuck = deliveries.filter(function (d) { return d.state === "failed" || d.state === "dead-letter" || d.state === "queued"; });
    var deliveryRows = stuck.map(function (d) {
      var t = d.target || {};
      return '<li class="st-' + esc(d.state) + '"><div><b>' + esc(t.fhirType || t.resourceType || "") + " &rarr; " + esc(d.destinationName || d.destinationId) + "</b>" +
        "<small>" + esc(t.id || "") + " v" + esc(t.version || "") + " &middot; " + (d.attempts || []).length + " attempt" + ((d.attempts || []).length === 1 ? "" : "s") +
        (d.nextAttemptAt ? " &middot; next " + when(d.nextAttemptAt) : "") + "</small>" +
        (d.lastError ? '<small class="warn">' + esc(d.lastError) + "</small>" : "") + "</div>" +
        '<span class="w-int-tag">' + esc(d.state) + "</span>" +
        (d.state === "dead-letter" ? '<button class="w-btn tiny go" data-w-act="outreplay:' + esc(d.id) + '">' + ms("replay") + "Send again</button>" : "") +
        "</li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Integration</b><small>what is coming in, what is going out, and what is stuck</small></div>" +
      '<button class="w-ic" data-w-act="intload" title="Refresh">' + ms("refresh") + "</button></div>" +

      (errs.length ? '<p class="w-hint warn">' + ms("warning") + "Some of this could not be read (" + esc(errs.join(", ")) +
        "). What is shown below is incomplete: do not read a zero here as nothing outstanding.</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("hub") + "<h3>Right now</h3></div>" +
      '<ul class="w-int-stats">' +
      stat("held for a decision", held.length, "exceptions", "nothing here is on a chart") +
      stat("waiting to go out", (counts.queued || 0), "outbound", "") +
      stat("retrying", (counts.failed || 0), "outbound", "backing off") +
      stat("given up", (counts.deadLetter || counts["dead-letter"] || 0), "outbound", "needs a person") +
      stat("lapsed authorisations", grants.filter(function (r) { return r.state !== "active"; }).length, "grants", "would refuse the next message") +
      "</ul>" +
      '<button class="w-btn go" data-w-act="outdispatch">' + ms("send") + "Send what is due now</button>" +
      '<p class="w-hint">' + ms("info") + "Sending is not scheduled by this screen: it runs when this hospital's own timer calls it, or when somebody presses this.</p>" +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("login") + "<h3>Coming in &middot; who WardSynQ believes</h3></div>" +
      '<p class="w-hint">A feed may only claim a source it has been granted. An expired or revoked authorisation refuses the next message it sends, and says which of the two it was.</p>' +
      (unreachable("grants") ? '<p class="w-empty warn">The authorisation list could not be read.</p>'
        : grantRows ? '<ul class="w-int-list">' + grantRows + "</ul>"
        : '<p class="w-empty">No source system has been authorised. Nothing outside this hospital can push data in.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("logout") + "<h3>Going out &middot; where this hospital may send</h3></div>" +
      '<p class="w-hint">Nothing is ever sent to an address that is not on this list. Stopping a destination also stops what is already queued for it.</p>' +
      (unreachable("destinations") ? '<p class="w-empty warn">The destination list could not be read.</p>'
        : destRows ? '<ul class="w-int-list">' + destRows + "</ul>"
        : '<p class="w-empty">No destination is registered. This hospital sends nothing out.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("outbox") + "<h3>Outbound queue</h3></div>" +
      (unreachable("outbound") ? '<p class="w-empty warn">The outbound queue could not be read.</p>'
        : deliveryRows ? '<ul class="w-int-list">' + deliveryRows + "</ul>"
        : '<p class="w-empty">Nothing is waiting, retrying or stopped.</p>') +
      "</div>";
  }

  /* MAIK, ON THE PATIENT'S OWN CHART (TASK 8.5). Not a chatbot and not a dashboard: a card in the
   * chart, beside the medicines and the results, that answers about the patient already open. There
   * is no thread, no history of banter and nothing to converse with - a clinician asks one thing
   * about one patient and gets one answer they can accept, edit or reject.
   *
   * WHAT THIS SCREEN MUST ALWAYS SHOW, because an answer without them is not reviewable:
   *   WHAT MAIK READ - the sections and how many record versions went in, so a clinician can tell a
   *     summary of a full chart from a summary of three rows.
   *   WHERE IT CAME FROM - and specifically whether any of it was written by ANOTHER hospital.
   *   WHAT IT IS NOT - MaiK states no confidence unless the model gave one, and this says so rather
   *     than rendering an invented number next to a clinical sentence.
   *   WHAT WOULD BE WRITTEN - before accepting, not after.
   *
   * ACCEPT / EDIT / REJECT ARE THE ONLY VERBS. There is no "apply", no "use this", no silent
   * insertion into a note the clinician is typing. Rejecting needs a reason because a model that is
   * regularly wrong about one thing is only visible if the reasons are kept. */
  function maikCard(state) {
    var m = state.maik || {};
    var s = state.sel;
    if (!s) return "";
    var i = m.interaction;
    var busy = m.busy === true;

    var head = '<div class="w-card"><div class="w-card-h">' + ms("neurology") + "<h3>MaiK</h3>" +
      (i ? '<button class="w-ic" data-w-act="maikclear" title="Clear">' + ms("close") + "</button>" : "") + "</div>";

    if (m.err) head += '<p class="w-hint warn">' + ms("warning") + esc(m.err) + "</p>";

    if (!i) {
      return head +
        '<p class="w-hint">MaiK reads this patient\'s chart as you, and can propose text for you to accept, edit or reject. It cannot sign, prescribe or change anything by itself.</p>' +
        '<div class="w-maik-acts">' +
        '<button class="w-btn" data-w-act="maikask:summarise"' + (busy ? " disabled" : "") + ">" + ms("summarize") + "Summarise this chart</button>" +
        '<button class="w-btn ghost" data-w-act="maikask:draft-note"' + (busy ? " disabled" : "") + ">" + ms("edit_note") + "Draft a progress note</button>" +
        "</div>" +
        (busy ? '<p class="w-empty">Asking MaiK&hellip;</p>' : "") +
        "</div>";
    }

    var provCount = (i.contextProvenance || []).length;
    var external = (i.contextDocuments || []).filter(function (d) { return d && d.origin && d.origin !== "wardsynq-native"; });
    var flagged = ((i.security || {}).injectionFindings || []).length;
    var reviewed = i.review && i.review.state && i.review.state !== "pending";

    /* THE WITHHELD CASE IS NOT AN ERROR MESSAGE. The clinician is told the answer was stopped and
     * why, because a screen that silently shows nothing looks like a model that had nothing to say. */
    var body = i.output
      ? '<div class="w-maik-out">' + esc(i.output).replace(/\n/g, "<br>") + "</div>"
      : '<p class="w-hint warn">' + ms("block") + "MaiK's answer was withheld before anybody saw it" +
        (i.withheld && i.withheld.violations ? " (" + esc(i.withheld.violations.join(", ")) + ")" : "") +
        ". Nothing was shown and nothing was written.</p>";

    var prov = '<ul class="w-maik-prov">' +
      "<li>" + ms("database") + "<span>Read " + provCount + " record version" + (provCount === 1 ? "" : "s") + " from this chart</span></li>" +
      "<li>" + ms("smart_toy") + "<span>" + esc((i.model && i.model.model) || "unknown model") +
        (i.model && i.model.version ? " &middot; " + esc(i.model.version) : "") +
        (i.generated === false ? " &middot; assembled from the record, not generated" : "") + "</span></li>" +
      (external.length ? "<li class=\"warn\">" + ms("warning") + "<span>Includes text written by another system: " +
        esc(external.map(function (d) { return d.origin; }).join(", ")) + "</span></li>" : "") +
      (flagged ? "<li class=\"warn\">" + ms("security") + "<span>" + flagged + " document" + (flagged === 1 ? "" : "s") +
        " in this chart contained something that reads like an instruction. It was fenced as data and could not act.</span></li>" : "") +
      "<li>" + ms("help") + "<span>" + (i.uncertainty == null
        ? "MaiK stated no measure of its own certainty. Absence of a warning is not reassurance."
        : "Model-stated uncertainty: " + esc(String(i.uncertainty))) + "</span></li>" +
      "</ul>";

    var preview = i.preview
      ? '<div class="w-maik-prev"><b>' + ms("draft") + "If you accept</b>" +
        "<span>A " + esc(i.preview.resourceType) + " will be created, authored by " + esc(i.preview.authorId) +
        " and <b>unsigned</b>. " + esc(i.preview.note) + "</span></div>"
      : "";

    var acts = reviewed
      ? '<p class="w-hint">' + ms("task_alt") + esc(i.review.state.charAt(0).toUpperCase() + i.review.state.slice(1)) +
        " by " + esc(i.review.by || "") + (i.review.reason ? " &middot; " + esc(i.review.reason) : "") +
        ((i.resultingChanges || []).length ? " &middot; wrote " + i.resultingChanges.length + " record" + (i.resultingChanges.length === 1 ? "" : "s") : "") + "</p>"
      : (i.output ? '<div class="w-maik-acts">' +
          '<button class="w-btn go" data-w-act="maikreview:accepted"' + (busy ? " disabled" : "") + ">" + ms("check") + "Accept</button>" +
          '<button class="w-btn ghost" data-w-act="maikedit"' + (busy ? " disabled" : "") + ">" + ms("edit") + "Edit</button>" +
          '<button class="w-btn ghost" data-w-act="maikreview:rejected"' + (busy ? " disabled" : "") + ">" + ms("close") + "Reject</button>" +
          "</div>" +
          (m.editing ? '<label class="w-f"><span>Your text (this is what will be filed)</span>' +
            '<textarea id="wMaikEdit" rows="6">' + esc(i.output) + "</textarea></label>" +
            '<button class="w-btn go" data-w-act="maikreview:edited">' + ms("save") + "File my edited version</button>" : "")
        : "");

    return head + body + prov + preview + acts + "</div>";
  }

  /* The bench, in the order work actually moves: to be collected, in transit, awaiting a result,
   * and whatever has gone critical. Counts sit in every heading because "12 specimens uncollected"
   * is the number a shift decides on, and an empty section names WHAT is empty rather than saying
   * "None", which reads as a rendering failure. */
  function labBoardView(state) {
    var b = state.labBoard || { specimens: [], pending: [], criticals: [], errors: [] };
    var none = function (what) { return '<p class="w-empty">' + esc(what) + "</p>"; };
    var stateOf = function (s) { return (s && s.collection && s.collection.state) || "none"; };
    var spec = b.specimens || [];
    var uncollected = spec.filter(function (s) { return stateOf(s) === "none" || stateOf(s) === "failed"; });
    var inTransit = spec.filter(function (s) { return stateOf(s) === "collected"; });
    var pri = function (s) { return s.priority === "stat" ? "overdue" : s.priority === "urgent" ? "failed" : ""; };
    var specRow = function (s) {
      return '<li class="' + pri(s) + '"><div class="w-crit-h"><b>' + esc(s.display || s.code) + "</b>" +
        (s.priority && s.priority !== "routine" ? '<span class="w-st ' + esc(s.priority) + '">' + esc(String(s.priority).toUpperCase()) + "</span>" : "") +
        "</div><div class=\"w-crit-m\">" + ms("person") + labWho(s.patientId) +
        (s.category ? " &middot; " + esc(s.category) : "") + "</div></li>";
    };
    var pendRow = function (p) {
      return '<li><div class="w-crit-h"><b>' + esc(p.display || p.code) + "</b></div>" +
        '<div class="w-crit-m">' + ms("person") + labWho(p.patientId) + "</div></li>";
    };
    var critRow = function (c) {
      var e = c.escalation || {};
      return '<li class="lvl-' + esc(e.level || "due") + '"><div class="w-crit-h"><b>' + esc(c.display || c.code) + "</b>" +
        (c.value == null ? "" : '<span class="w-crit-v">' + esc(c.value) + (c.unit ? " " + esc(c.unit) : "") + "</span>") +
        '</div><div class="w-crit-m">' + ms("person") + labWho(c.patientId) +
        (e.minutesOpen == null ? "" : " &middot; " + e.minutesOpen + " min open") + "</div></li>";
    };
    var card = function (icon, title, n, rows, emptyWords) {
      return '<div class="w-card"><div class="w-card-h">' + ms(icon) + "<h3>" + esc(title) + " &middot; " + n + "</h3></div>" +
        (n ? '<ul class="w-crits">' + rows + "</ul>" : none(emptyWords)) + "</div>";
    };
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Laboratory</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="labboardload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (b.errors && b.errors.length
        ? '<div class="w-card warn"><div class="w-card-h">' + ms("error") + "<h3>Could not be read</h3></div>" +
          "<p>" + esc(b.errors.join(", ")) + ". What is shown below is incomplete.</p></div>"
        : "") +
      card("colorize", "Awaiting collection", uncollected.length, uncollected.map(specRow).join(""), "No specimens awaiting collection.") +
      card("local_shipping", "Collected, awaiting the laboratory", inTransit.length, inTransit.map(specRow).join(""), "Nothing in transit.") +
      card("biotech", "Awaiting a result", (b.pending || []).length, (b.pending || []).map(pendRow).join(""), "No tests awaiting a result.") +
      card("priority_high", "Critical results", (b.criticals || []).length, (b.criticals || []).map(critRow).join(""), "No open critical results.");
  }
  function critsBoardView(state) {
    var loops = state.critsBoard || [];
    var rows = loops.map(function (c) {
      var esc_ = c.escalation || {}, mins = esc_.minutesOpen;
      return '<li class="lvl-' + esc(esc_.level || "due") + '">' +
        '<div class="w-crit-h"><b>' + esc(c.display || c.code) + "</b>" +
        (c.value == null ? "" : '<span class="w-crit-v">' + esc(c.value) + (c.unit ? " " + esc(c.unit) : "") + "</span>") +
        '<span class="w-crit-b">' + (c.basis === "lab" ? "flagged by the lab" : c.basis === "limit" ? "outside critical limit" : esc(c.basis || "")) + "</span></div>" +
        '<div class="w-crit-m">' + ms("person") + esc(c.patientId || "") +
        " &middot; " + ms("schedule") + (mins == null ? "" : mins + " min since reported") +
        (esc_.level === "escalate" ? " &middot; ESCALATE" : esc_.level === "overdue" ? " &middot; overdue" : "") +
        (c.state === "acknowledged" ? " &middot; acknowledged by " + esc(c.acknowledgedBy || "a clinician") : "") + "</div>" +
        (c.state === "open" ? '<button class="w-btn tiny go" data-w-act="ackboard:' + esc(c.loopId) + '">' + ms("task_alt") + "Acknowledge</button>" : "") +
      "</li>";
    }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Critical results</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="critsboardload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Open loops &middot; " + loops.length + "</h3></div>" +
      '<p class="w-hint">Acknowledging records that you have seen this and what you did. It is not a way to clear the list.</p>' +
      (rows ? '<ul class="w-crits">' + rows + "</ul>" : '<p class="w-empty">No open critical results anywhere right now.</p>') +
      "</div>";
  }

  /* THE RADIOLOGY BOARD. Every other department (ED, theatre, pharmacy stock, critical results) has
   * a hospital-wide board; imaging had a backend (dicom.js, radiology-report.js) and nowhere for a
   * radiographer or radiologist to land. This is that screen, built from exactly three routes:
   * GET imaging-worklist, POST report-imaging, GET criticals.
   *
   * imaging-worklist IS A DICOM MODALITY WORKLIST: every item on it is, by definition, still to be
   * performed - that is what a worklist is. This hospital touches no field when a study is actually
   * acquired (landing an ImagingStudy from a PACS never writes back to the ServiceRequest, see
   * dicom.js/wardsynq-sccm-adapter.js) and reportImaging() never flips the order's status either, so
   * there is no signal anywhere this screen is allowed to read that would split "not yet scanned"
   * from "scanned, not yet reported" - both are simply "on the worklist, not yet reported here". This
   * board says exactly that, in one honest section, rather than inventing a split the data does not
   * support. "Reported this session" is genuinely this board's own session - there is no hospital-
   * wide reported-studies list among these three routes, so that is stated rather than dressed up as
   * more history than it is. Priority is read defensively from a DICOM tag this worklist does not
   * currently emit: absent means "not recorded", never "routine" - a priority this screen never saw
   * is not one it may guess at.
   *
   * NO SPECIMEN, NO COLLECT ACTION. A plain radiograph has nothing to collect; an imaging order is
   * acquired, not collected. This board never reads /ward/collections (the generic specimen/
   * collection tracker every ServiceRequest carries, imaging included, and the one place a "Collect"
   * button could wrongly appear for a chest X-ray), so that mistake cannot happen here. */
  function radWorklistTagStr(tag) { return (tag && tag.Value && tag.Value.length) ? String(tag.Value[0]) : ""; }
  function radPatientDisplayName(tag) {
    var s = radWorklistTagStr(tag); if (!s) return "";
    var parts = s.split("^");
    return parts.length > 1 ? (parts[1] + " " + parts[0]).replace(/\s+/g, " ").trim() : s;
  }
  function radDicomDateTime(date, time) {
    if (!date || date.length < 8) return "";
    var iso = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8);
    if (time && time.length >= 6) iso += "T" + time.slice(0, 2) + ":" + time.slice(2, 4) + ":" + time.slice(4, 6);
    return iso;
  }
  function radWaitLabel(iso) {
    if (!iso) return "";
    var ms_ = Date.now() - new Date(iso).getTime();
    if (!(ms_ >= 0)) return "";
    var mins = Math.floor(ms_ / 60000);
    if (mins < 60) return mins + " min";
    return Math.floor(mins / 60) + "h " + (mins % 60) + "m";
  }
  /** PURE. One DICOM-JSON worklist item into the fields this board renders. */
  function radWorklistRow(item) {
    item = item || {};
    var step = item["00400100"] && item["00400100"].Value && item["00400100"].Value[0];
    var date = step && radWorklistTagStr(step["00400002"]);
    var time = step && radWorklistTagStr(step["00400003"]);
    return {
      orderId: radWorklistTagStr(item["00080050"]),
      name: radPatientDisplayName(item["00100010"]),
      mrn: radWorklistTagStr(item["00100020"]),
      procedure: radWorklistTagStr(item["00321060"]),
      modality: (step && radWorklistTagStr(step["00080060"])) || "",
      priority: radWorklistTagStr(item["00401003"]).toLowerCase(),
      orderedAt: radDicomDateTime(date, time),
    };
  }
  /** A critical loop opened against a radiology report. Report ids are "wsq-rad-<slug>"
   *  (radiology-report.js's reportIdFor) versus a lab result's "wsq-dr-<slug>" - the only field
   *  the criticals list carries that says which department a loop belongs to. */
  function radCriticalOf(loop) { return !!(loop && typeof loop.reportId === "string" && loop.reportId.indexOf("wsq-rad-") === 0); }
  var RAD_PRIORITY_WORDS = { stat: "STAT", urgent: "Urgent", routine: "Routine" };
  var RAD_PRIORITY_CLASS = { stat: "overdue", urgent: "failed" };
  /* THE LABORATORY BOARD. The bench had no screen of its own: specimens and pending tests could only
   * ever be read one chart at a time (collectionList and pendingRequests were per-patient and
   * answered 422 without a patientId), so the only way to see the department's work was to open
   * eighty charts. Both reads now take scope=hospital - see the comments on those two functions for
   * why the opt-in is an explicit word and not a missing parameter.
   *
   * NAMES, NOT RECORD IDS. Every row is joined against the ward roster, which already carries name
   * and MRN, because a specimen tube identified only by "opd-pat-smd-demo-00020" cannot be checked
   * against a wristband. Where the join misses (an outpatient, a discharged stay) the row says so
   * rather than printing the id and calling it a name. */
  function labPatientName(pid) {
    var list = st.list || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].patientId === pid) return list[i];
    return null;
  }
  function labWho(pid) {
    var p = labPatientName(pid);
    if (p) return esc(p.name || p.patientId) + (p.mrn ? " &middot; " + esc(p.mrn) : "");
    return '<i>not on the ward list</i>';
  }
  function labBoardOpen() {
    st.view = "labboard"; st.labBoard = { specimens: [], pending: [], criticals: [], errors: [] }; paint(); loadLabBoard();
  }
  /* Four reads, and a failure in ANY of them is recorded BY NAME rather than left as an empty list.
   * On this screen "nothing outstanding" and "could not tell" must never look the same: one of them
   * means a specimen is sitting somewhere and nobody knows it. Same discipline as loadIntegration. */
  function loadLabBoard() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId);
    var out = { specimens: [], pending: [], criticals: [], errors: [] };
    var read = function (name, path, fn) {
      return apiGet(path).then(function (r) {
        if (r && r.ok) fn(r); else out.errors.push(name);
      }).catch(function () { out.errors.push(name); });
    };
    return Promise.all([
      read("specimens", "/ward/collections?" + q + "&scope=hospital", function (r) { out.specimens = r.requests || []; }),
      read("tests awaiting a result", "/ward/pending-tests?" + q + "&scope=hospital", function (r) { out.pending = r.pending || []; }),
      read("critical results", "/ward/criticals?" + q, function (r) {
        // The laboratory's own loops. A radiology report id starts wsq-rad-; a lab one does not.
        out.criticals = (r.loops || []).filter(function (l) { return !radCriticalOf(l); });
      }),
      // The roster is what turns a patientId into a name. Its failure is not fatal to the board:
      // the rows still render, they just cannot be named, and labWho says so per row.
      read("ward roster", "/ward/list?" + q, function (r) { st.list = r.patients || st.list || []; }),
    ]).then(function () { st.busy = false; st.labBoard = out; paint(); });
  }
  function radBoardOpen() {
    st.view = "radboard"; st.radBoard = { requested: [], reported: [], criticals: [], errors: [], picked: null }; paint(); loadRadBoard();
  }
  function loadRadBoard() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId);
    var prev = st.radBoard || {};
    var out = { requested: [], reported: prev.reported || [], criticals: [], errors: [], picked: prev.picked || null };
    var reportedIds = {}; out.reported.forEach(function (x) { reportedIds[x.orderId] = 1; });
    return Promise.all([
      apiGet("/ward/imaging-worklist?" + q)
        .then(function (r) {
          if (r && r.ok) out.requested = (r.worklist || []).map(radWorklistRow).filter(function (s) { return !reportedIds[s.orderId]; });
          else out.errors.push("imaging worklist");
        })
        .catch(function () { out.errors.push("imaging worklist"); }),
      apiGet("/ward/criticals?" + q)
        .then(function (r) { if (r && r.ok) out.criticals = (r.loops || []).filter(radCriticalOf); else out.errors.push("critical findings"); })
        .catch(function () { out.errors.push("critical findings"); }),
    ]).then(function () { st.busy = false; st.radBoard = out; paint(); });
  }
  function radBoardPick(orderId) {
    if (!st.radBoard) st.radBoard = {};
    st.radBoard.picked = orderId || null; paint();
  }
  function radBoardReportSave() {
    var b = st.radBoard, picked = b && b.picked; if (!picked) return;
    var modality = val("wRadBModality"), status = val("wRadBStatus"), findings = val("wRadBFindings"), impression = val("wRadBImpression");
    var critical = !!(document.getElementById("wRadBCritical") || {}).checked;
    if (!findings) { st.err = "Say what was seen; the impression may follow."; paint(); return; }
    var row = null;
    for (var i = 0; i < (b.requested || []).length; i++) { if (b.requested[i].orderId === picked) { row = b.requested[i]; break; } }
    st.busy = true; paint();
    apiPost("/ward/report-imaging", { orgId: st.orgId, serviceRequestId: picked, modality: modality || undefined, status: status || "preliminary", findings: findings, impression: impression || undefined, critical: critical })
      .then(function (r) {
        if (r && r.error === "impression_required") { st.busy = false; st.err = "A final report needs an impression; release it as preliminary if it is not ready."; paint(); return; }
        var msg = r && r.discrepancy
          ? "Released. The impression changed from a reading that may already have been acted on - flagged as a discrepancy on the record."
          : (r && r.critical ? "Released. Critical finding - a closed loop was opened." : "Released.");
        if (!settle(r, msg)) { paint(); return; }
        b.reported.unshift({ orderId: picked, name: row && row.name, mrn: row && row.mrn, modality: modality || (row && row.modality) || "", status: status || "preliminary", discrepancy: !!(r && r.discrepancy), reportedAt: new Date().toISOString() });
        b.picked = null;
        loadRadBoard();
      })
      .catch(function () { st.busy = false; st.err = "Could not release the report."; paint(); });
  }
  function radBoardFormHtml(row) {
    return '<div class="w-sub"><h4>' + ms("edit_note") + "File report &middot; " + esc((row && row.name) || "Unknown patient") + (row && row.mrn ? " (" + esc(row.mrn) + ")" : "") + "</h4>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Modality</span><input id="wRadBModality" type="text" autocomplete="off" placeholder="e.g. CT, XR, US, MR" value="' + esc((row && row.modality) || "") + '"></label>' +
      '<label class="w-f"><span>Status</span><select id="wRadBStatus"><option value="preliminary">Preliminary</option><option value="final">Final</option><option value="corrected">Corrected</option></select></label>' +
      "</div>" +
      '<label class="w-f"><span>Findings</span><textarea id="wRadBFindings" rows="3"></textarea></label>' +
      '<label class="w-f"><span>Impression</span><textarea id="wRadBImpression" rows="2"></textarea></label>' +
      '<label class="w-chk"><input type="checkbox" id="wRadBCritical"> Critical finding - opens the same closed-loop notification a critical lab value does</label>' +
      '<div class="w-maik-acts"><button class="w-btn go" data-w-act="radboardreportsave">' + ms("send") + "Release report</button>" +
      '<button class="w-btn ghost" data-w-act="radboardpick:">' + ms("close") + "Cancel</button></div>" +
      '<p class="w-hint">' + ms("info") + "A final report needs an impression. A changed impression from a preliminary reading is flagged as a discrepancy, never silently overwritten." + "</p></div>";
  }
  function radBoardView(state) {
    var b = state.radBoard || {};
    var errs = b.errors || [];
    var requested = b.requested || [];
    var reported = b.reported || [];
    var criticals = b.criticals || [];
    var picked = b.picked;
    var unreachable = function (what) { return errs.indexOf(what) >= 0; };
    var pickedRow = null;
    for (var i = 0; i < requested.length; i++) { if (requested[i].orderId === picked) { pickedRow = requested[i]; break; } }

    var reqRows = requested.map(function (s) {
      var pr = s.priority, prCls = RAD_PRIORITY_CLASS[pr] || "";
      return '<li' + (s.orderId === picked ? ' class="picked"' : '') + '>' +
        '<div class="w-crit-h"><b>' + esc(s.name || "Unknown patient") + "</b>" +
        '<span class="w-crit-v">' + esc(s.mrn || "no MRN on record") + "</span>" +
        (pr ? '<span class="w-st ' + prCls + '">' + esc(RAD_PRIORITY_WORDS[pr] || pr) + "</span>" : "") +
        "</div>" +
        '<div class="w-crit-m">' + esc(s.procedure || "Imaging study") +
        (s.modality ? " &middot; " + esc(s.modality) : " &middot; modality not mapped") +
        (s.orderedAt ? " &middot; waiting " + radWaitLabel(s.orderedAt) : "") + "</div>" +
        '<button class="w-btn tiny go" data-w-act="radboardpick:' + esc(s.orderId) + '">' + ms("edit_note") + "File report</button>" +
      "</li>";
    }).join("");

    var repRows = reported.map(function (r) {
      return "<li><b>" + esc(r.name || "Unknown patient") + "</b> <span>" + esc(r.mrn || "") + "</span>" +
        '<div class="w-crit-m">' + esc(r.modality || "modality not recorded") + " &middot; " + esc(r.status || "preliminary") +
        (r.discrepancy ? " &middot; discrepancy flagged" : "") + " &middot; " + when(r.reportedAt) + "</div></li>";
    }).join("");

    var critRows = criticals.map(function (c) {
      var esc_ = c.escalation || {}, mins = esc_.minutesOpen;
      return '<li class="lvl-' + esc(esc_.level || "due") + '">' +
        '<div class="w-crit-h"><b>' + esc(c.display || c.code || "Critical finding") + "</b></div>" +
        '<div class="w-crit-m">' + ms("person") + esc(c.patientId || "") +
        (mins == null ? "" : " &middot; " + mins + " min since reported") +
        (esc_.level === "escalate" ? " &middot; ESCALATE" : esc_.level === "overdue" ? " &middot; overdue" : "") + "</div>" +
      "</li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Radiology</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="radboardload" title="Refresh">' + ms("refresh") + "</button></div>" +

      (errs.length ? '<p class="w-hint warn">' + ms("warning") + "Some of this could not be read (" + esc(errs.join(", ")) +
        "). What is shown below is incomplete: do not read an empty section here as nothing outstanding.</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("list") + "<h3>Requested &middot; " + requested.length + "</h3></div>" +
      '<p class="w-hint">This hospital does not record a separate acquisition step for imaging: a study stays on this list from the order until it is reported here, whether or not it has been scanned yet.</p>' +
      (unreachable("imaging worklist") ? '<p class="w-empty warn">The imaging worklist could not be read.</p>'
        : reqRows ? '<ul class="w-crits">' + reqRows + "</ul>"
        : '<p class="w-empty">No studies awaiting acquisition or a report.</p>') +
      (pickedRow ? radBoardFormHtml(pickedRow) : "") +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Reported this session &middot; " + reported.length + "</h3></div>" +
      '<p class="w-hint">Reports filed from this board since it was opened, most recent first. There is no hospital-wide reported-studies list to read back here.</p>' +
      (repRows ? '<ul class="w-mini">' + repRows + "</ul>" : '<p class="w-empty">No studies reported yet this session.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Critical findings &middot; " + criticals.length + "</h3></div>" +
      (unreachable("critical findings") ? '<p class="w-empty warn">Critical findings could not be read.</p>'
        : critRows ? '<ul class="w-crits">' + critRows + "</ul>"
        : '<p class="w-empty">No open critical findings for radiology right now.</p>') +
      "</div>";
  }

  /* TASK 4.3: the bed-management workstation. Bed STATE lives in the real master record TASK 4.1
   * built (_opd_org.js's bed()), never inferred from an Encounter - occupied happens automatically
   * on admit/transfer/discharge (TASK 4.2); this screen is for the OTHER transitions a ward
   * actually manages by hand: reserving a bed ahead of an arrival, blocking one for maintenance,
   * and the clean-before-reuse turnover. No client-side state machine: every option is offered,
   * the server's own bed:update route (TASK 4.3's CAS) is the only thing that can refuse one. */
  var BED_STATE_WORDS = { available: "Available", reserved: "Reserved", occupied: "Occupied", blocked: "Blocked", cleaning: "Cleaning", maintenance: "Maintenance" };
  function bedBoardMgmtView(state) {
    var bm = state.bedMgmt || {};
    var wards = bm.wards || [];
    var wardRows = wards.map(function (w) {
      var beds = (bm.bedsByWard && bm.bedsByWard[w.id]) || [];
      var bedRows = beds.map(function (b) {
        var opts = Object.keys(BED_STATE_WORDS).map(function (s) {
          return '<option value="' + s + '"' + (s === b.state ? " selected" : "") + ">" + BED_STATE_WORDS[s] + "</option>";
        }).join("");
        return '<li class="w-bedrow"><span class="w-st ' + esc(b.state) + '">' + esc(BED_STATE_WORDS[b.state] || b.state) + "</span>" +
          "<b>" + esc(b.name) + "</b>" +
          (b.genderRestriction ? '<span class="w-tag">' + esc(b.genderRestriction) + " only</span>" : "") +
          (b.isolation ? '<span class="w-tag warn">isolation</span>' : "") +
          (b.active === false ? '<span class="w-tag warn">retired</span>' : "") +
          '<select data-bed-state="' + esc(b.id) + '">' + opts + "</select>" +
          '<button class="w-btn ghost tiny" data-w-act="bedstate:' + esc(b.id) + '">' + ms("check") + "Apply</button></li>";
      }).join("");
      return '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>" + esc(w.name) + (w.active === false ? " (retired)" : "") + "</h3></div>" +
        (bedRows ? '<ul class="w-mini">' + bedRows + "</ul>" : '<p class="w-empty">No beds recorded for this ward.</p>') + "</div>";
    }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Bed management</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="bedmgmtload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (bm.conflict ? '<p class="w-hint warn">' + ms("warning") + "This bed changed under you. Reloaded - check the state before applying again." + "</p>" : "") +
      (wardRows || '<p class="w-empty">' + (bm.loaded ? "No wards are recorded for this hospital yet." : "Loading&hellip;") + "</p>");
  }

  /* TASK 4.4: the patient flow command center. IT COUNTS, IT DOES NOT JUDGE - every number here
   * comes verbatim from /ward/patient-flow (patient-flow.js), which states in its own header what
   * it deliberately does not invent: no predicted/expected discharge date, no bottleneck-severity
   * score, no transfer-approval workflow. This screen adds nothing - it renders the server's
   * numbers, and "recent transfers" / "discharge candidates" are labelled exactly as the server
   * means them, never dressed up as something more certain. */
  function flowCommandView(state) {
    var f = (state.flow && state.flow.flow) || null;
    if (!f) {
      return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        "<div><b>Patient flow</b><small>hospital-wide</small></div>" +
        '<button class="w-ic" data-w-act="flowload" title="Refresh">' + ms("refresh") + "</button></div>" +
        '<p class="w-empty">' + (state.flow && state.flow.loaded ? "Nothing to show yet." : "Loading&hellip;") + "</p>";
    }
    var bottleneckWords = { unplaced_patients: "unplaced patients on", ed_untriaged: "ED patients not yet triaged", beds_blocked: "beds blocked", beds_in_cleaning_turnover: "beds in cleaning turnover", stays_with_open_items: "stays with open items" };
    var bottlenecks = (f.bottlenecks || []).map(function (b) {
      return "<li><b>" + esc(b.count) + "</b> " + esc(bottleneckWords[b.kind] || b.kind) + (b.ward ? " " + esc(b.ward) : "") + "</li>";
    }).join("");
    var openRows = (f.staysWithOpenItems || []).map(function (s) {
      return "<li><b>" + esc(s.openItems) + "</b> open item" + (s.openItems === 1 ? "" : "s") + '<span>' + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + (s.lengthOfStayDays != null ? " &middot; day " + esc(s.lengthOfStayDays) : "") + "</span></li>";
    }).join("");
    var transferRows = (f.recentTransfers || []).map(function (t) {
      return "<li>" + esc((t.movedFrom && t.movedFrom.ward) || "?") + " &rarr; " + esc(t.ward || "?") + '<span>' + when(t.movedAt) + (t.moveReason ? " &middot; " + esc(t.moveReason) : "") + "</span></li>";
    }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Patient flow</b><small>hospital-wide &middot; " + when(f.computedAt) + "</small></div>" +
      '<button class="w-ic" data-w-act="flowload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("emergency") + "<h3>ED</h3></div>" +
      "<p>" + esc(f.ed.arrivals) + " in the department &middot; " + esc(f.ed.untriaged) + " not yet triaged</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>Beds</h3></div>" +
      "<p>" + esc(f.beds.occupied) + " occupied &middot; " + esc(f.beds.unplacedPatients) + " admitted with no bed yet</p>" +
      "<p class=\"w-hint\">Available " + esc(f.beds.states.available) + " &middot; Reserved " + esc(f.beds.states.reserved) +
      " &middot; Blocked " + esc(f.beds.states.blocked) + " &middot; Cleaning " + esc(f.beds.states.cleaning) + " &middot; Maintenance " + esc(f.beds.states.maintenance) + "</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("hourglass_top") + "<h3>Admissions pending</h3></div>" +
      "<p>" + esc(f.admissionsPending.waiting) + " waiting &middot; longest wait " + esc(f.admissionsPending.longestWaitHours) + " h</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("task_alt") + "<h3>Discharge</h3></div>" +
      "<p>" + esc(f.dischargeCandidates) + " stay" + (f.dischargeCandidates === 1 ? "" : "s") + " with nothing outstanding right now</p>" +
      '<p class="w-hint">This is a live fact, not a predicted discharge date - no expected-discharge field exists in this record.</p>' +
      (openRows ? '<ul class="w-mini">' + openRows + "</ul>" : "") + "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("swap_horiz") + "<h3>Recent transfers</h3></div>" +
      (transferRows ? '<ul class="w-mini">' + transferRows + "</ul>" : '<p class="w-empty">None in the last 24 hours.</p>') + "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Where to look first</h3></div>" +
      '<p class="w-hint">Ranked by count. Nothing here is a score - a human decides what matters.</p>' +
      (bottlenecks ? '<ul class="w-mini">' + bottlenecks + "</ul>" : '<p class="w-empty">Nothing stands out right now.</p>') + "</div>";
  }

  /* TASK 10: the Hospital Digital Twin. Every number rendered here already exists on a screen
   * elsewhere in this file - patient-flow's beds/ED, ward-metrics' open items, critsboard's loops,
   * the emergency/blackout screens. This view's own contribution is FUSION: one screen, each section
   * labelled with its own freshness, "not built" named rather than shown as zero, and a governed
   * MaiK copilot that can only speak about what this same screen already shows. */
  var TWIN_FRESHNESS_WORDS = { live: "Live", delayed: "Delayed", stale: "Stale", unavailable: "Unavailable" };
  function twinSectionCard(icon, title, section, body) {
    if (!section) return "";
    var badge = section.status === "ok"
      ? '<span class="w-st ' + (section.freshness === "live" ? "" : "due") + '">' + esc(TWIN_FRESHNESS_WORDS[section.freshness] || section.freshness) + "</span>"
      : '<span class="w-st overdue">' + ms("block") + "Unavailable</span>";
    return '<div class="w-card"><div class="w-card-h">' + ms(icon) + "<h3>" + esc(title) + "</h3>" + badge + "</div>" +
      (section.status === "ok" ? body(section.data)
        : '<p class="w-hint warn">' + ms("warning") + esc(section.error || "unavailable") + (section.detail ? ": " + esc(section.detail) : "") + '<br><small>This section is UNAVAILABLE, not zero - the rest of this screen is unaffected.</small></p>') +
      "</div>";
  }
  function twinView(state) {
    var tw = state.twin || {};
    var t = tw.snapshot;
    if (!t) {
      return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
        "<div><b>Digital twin</b><small>hospital-wide</small></div>" +
        '<button class="w-ic" data-w-act="twinload" title="Refresh">' + ms("refresh") + "</button></div>" +
        '<p class="w-empty">' + (tw.loaded ? (tw.err ? esc(tw.err) : "Nothing to show yet.") : "Loading&hellip;") + "</p>";
    }
    var s = t.sections;
    var notBuiltRows = Object.keys(t.notBuilt || {}).map(function (k) { return "<li><b>" + esc(k) + "</b><span>" + esc(t.notBuilt[k]) + "</span></li>"; }).join("");

    var copilot = tw.copilot;
    var copilotBody = !copilot ? "" :
      copilot.busy ? '<p class="w-empty">Asking MaiK&hellip;</p>' :
      copilot.err ? '<p class="w-hint warn">' + ms("warning") + esc(copilot.err) + "</p>" :
      !copilot.answered ? '<p class="w-hint warn">' + ms("block") + "MaiK's answer was withheld or unavailable." + (copilot.note ? " " + esc(copilot.note) : "") + "</p>" :
      '<div class="w-maik-out">' + esc(copilot.answer).replace(/\n/g, "<br>") + "</div>" +
        '<ul class="w-maik-prov"><li>' + ms("smart_toy") + "<span>" + esc((copilot.interaction && copilot.interaction.model && copilot.interaction.model.model) || "") +
        "</span></li><li>" + ms("schedule") + "<span>Answered from the snapshot generated " + when(t.generatedAt) + "</span></li></ul>" +
        (copilot.interaction && copilot.interaction.review && copilot.interaction.review.state === "pending" ?
          '<div class="w-actions"><button class="w-btn ghost tiny" data-w-act="twincopilotreview:accepted">' + ms("check") + "Helpful</button>" +
          '<button class="w-btn ghost tiny" data-w-act="twincopilotreview:rejected">' + ms("close") + "Not helpful</button></div>" :
          copilot.interaction && copilot.interaction.review ? '<p class="w-hint">' + ms("task_alt") + esc(copilot.interaction.review.state) + "</p>" : "");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Digital twin</b><small>" + esc(t.sectionsOk) + "/" + esc(t.sectionsTotal) + " sections &middot; " + when(t.generatedAt) + "</small></div>" +
      '<button class="w-ic" data-w-act="twinload" title="Refresh">' + ms("refresh") + "</button></div>" +

      twinSectionCard("hub", "Flow &amp; capacity", s.flow, function (d) {
        var f = d.flow;
        return "<p>" + esc(f.beds.occupied) + " occupied &middot; " + esc(f.ed.arrivals) + " in ED &middot; " + esc(f.dischargeCandidates) + " ready to leave</p>";
      }) +
      twinSectionCard("monitor_heart", "Clinical operations", s.clinicalOps, function (d) {
        var m = d.metrics;
        return "<p>" + esc(m.open.criticalResults) + " open critical result(s) &middot; " + esc(m.open.dosesInFlight) + " dose(s) in flight &middot; " + esc(m.openItems) + " open item(s)</p>";
      }) +
      twinSectionCard("priority_high", "Critical results", s.criticals, function (d) {
        return "<p>" + esc(d.open) + " open loop(s)</p>";
      }) +
      twinSectionCard("emergency", "Emergency", s.emergency, function (d) {
        return d.any ? "<p>" + esc(d.active.length) + " active declaration(s): " + esc(d.active.map(function (a) { return a.kind; }).join(", ")) + "</p>" : '<p class="w-empty">None active.</p>';
      }) +
      twinSectionCard("event_busy", "Blackouts", s.blackouts, function (d) {
        return d.blackouts.length ? "<p>" + esc(d.blackouts.length) + " active blackout(s)</p>" : '<p class="w-empty">None active.</p>';
      }) +
      twinSectionCard("medication", "Pharmacy", s.pharmacy, function (d) {
        return "<p>" + esc(d.dispenseCount) + " dispensed &middot; " + esc(d.pendingVerification) + " pending verification &middot; " + esc((d.stock || []).filter(function (r) { return r.belowReorder; }).length) + " below reorder</p>";
      }) +
      twinSectionCard("folder_shared", "HIM", s.him, function (d) {
        return "<p>" + esc(d.incompleteCharts) + " incomplete chart(s) of " + esc(d.chartsChecked) + " checked</p>";
      }) +
      twinSectionCard("science", "Diagnostics (LIS)", s.lis, function (d) {
        return "<p>" + esc(d.outstanding) + " outstanding of " + esc(d.checked) + " checked</p>";
      }) +

      (notBuiltRows ? '<div class="w-card"><div class="w-card-h">' + ms("info") + "<h3>Not built</h3></div>" +
        '<p class="w-hint">Named honestly rather than shown as a silent zero.</p><ul class="w-mini">' + notBuiltRows + "</ul></div>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("neurology") + "<h3>MaiK</h3></div>" +
      '<p class="w-hint">Answers only from the sections above. It cannot invent a bed, a patient or a staffing figure, and has no authority over any safety verdict or order.</p>' +
      '<div class="w-maik-acts"><button class="w-btn ghost" data-w-act="twinask">' + ms("summarize") + "Ask about this hospital</button></div>" +
      copilotBody + "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("science") + "<h3>Simulate</h3></div>" +
      '<p class="w-hint">SIMULATION - NOT LIVE STATE. Writes nothing.</p>' +
      '<div class="w-actions">' +
      '<button class="w-btn ghost tiny" data-w-act="twinsim:extra-admissions">' + ms("add") + "+10 admissions</button>" +
      '<button class="w-btn ghost tiny" data-w-act="twinsim:icu-capacity-reduction">' + ms("bed") + "-5 ICU beds</button>" +
      "</div>" +
      (tw.sim ? (tw.sim.ok === false ? '<p class="w-hint warn">' + esc(tw.sim.detail || tw.sim.error) + "</p>" :
        '<p class="w-hint"><b>' + esc(tw.sim.label) + "</b><br>" + esc(JSON.stringify(tw.sim.projected)) + "</p>") : "") +
      "</div>";
  }

  /* TASK 4.5: scheduling. scheduling.js/resource-booking.js/blackout.js already enforce every hard
   * safeguard here - a slot cannot be double-held, a blackout cannot be overridden, a resource the
   * hospital does not have cannot be booked. This screen adds no logic: it books, cancels,
   * reschedules-by-state-change, marks did-not-attend, and blocks/unblocks a period, and shows the
   * server's own refusal reason verbatim on a clash or a blackout. */
  var APPT_STATE_WORDS = { booked: "Booked", arrived: "Arrived", completed: "Completed", cancelled: "Cancelled", "did-not-attend": "Did not attend" };
  function schedulingView(state) {
    var sc = state.scheduling || {};
    var diary = sc.diary || {};
    var apptRows = (diary.appointments || []).map(function (a) {
      var live = a.state === "booked" || a.state === "arrived";
      return "<li><b>" + esc(when(a.startAt)) + "</b> &middot; " + esc(a.minutes) + "m &middot; " + esc(a.clinicianId) +
        '<span class="w-st ' + esc(a.state) + '">' + esc(APPT_STATE_WORDS[a.state] || a.state) + "</span>" +
        (a.overbooked ? '<span class="w-tag warn">overbooked: ' + esc(a.overbookReason || "") + "</span>" : "") +
        (a.reason ? "<br><small>" + esc(a.reason) + "</small>" : "") +
        (live ? '<div class="w-actions"><button class="w-btn tiny ghost" data-w-act="apptcancel:' + esc(a.appointmentId) + '">' + ms("close") + "Cancel</button>" +
          '<button class="w-btn tiny ghost" data-w-act="apptdna:' + esc(a.appointmentId) + '">' + ms("event_busy") + "DNA</button></div>" : "") +
        "</li>";
    }).join("");
    var recallRows = (diary.recalls || []).map(function (r) {
      return "<li><b>" + esc(r.reason) + "</b>" + (r.state === "overdue" ? '<span class="w-st overdue">' + esc(r.overdueDays) + " days overdue</span>" : "") +
        "<br><small>" + esc(r.patientId) + (r.dueBy ? " &middot; due " + esc(when(r.dueBy)) : "") + "</small></li>";
    }).join("");
    var resRows = ((sc.resources && sc.resources.resources) || []).map(function (r) {
      var bookingRows = (r.bookings || []).filter(function (b) { return b.state === "booked"; }).map(function (b) {
        return "<li><b>" + esc(when(b.startAt)) + "</b> &middot; " + esc(b.minutes) + "m" + (b.purpose ? " &middot; " + esc(b.purpose) : "") +
          '<button class="w-btn tiny ghost" data-w-act="rescancel:' + esc(b.bookingId) + '">' + ms("close") + "Cancel</button></li>";
      }).join("");
      return '<div class="w-sub"><h4>' + esc(r.name) + " (" + esc(r.kind) + ")</h4>" + (bookingRows ? '<ul class="w-mini">' + bookingRows + "</ul>" : '<p class="w-empty">No bookings.</p>') + "</div>";
    }).join("");
    var blackoutRows = (sc.blackouts || []).map(function (b) {
      return "<li><b>" + esc(b.clinicianId || b.resourceId) + "</b> " + esc(when(b.from)) + " &rarr; " + esc(when(b.to)) +
        "<br><small>" + esc(b.reason) + "</small>" +
        '<button class="w-btn tiny ghost" data-w-act="blackoutcancel:' + esc(b.blackoutId) + '">' + ms("close") + "Unblock</button></li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Scheduling</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="schedload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (sc.err ? '<p class="w-hint warn">' + ms("warning") + esc(sc.err) + "</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("event") + "<h3>Appointments</h3></div>" +
      (apptRows ? '<ul class="w-mini">' + apptRows + "</ul>" : '<p class="w-empty">No appointments loaded. Set a clinician and load.</p>') +
      (recallRows ? '<h4>Unbooked follow-ups</h4><ul class="w-mini">' + recallRows + "</ul>" : "") +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Clinician</span><input id="wSchedClinician" type="text" autocomplete="off" value="' + esc(sc.clinicianId || "") + '"></label>' +
      '<label class="w-f"><span>Patient ID</span><input id="wSchedPatient" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Start (ISO)</span><input id="wSchedStart" type="text" autocomplete="off" placeholder="2026-09-10T10:00:00.000Z"></label>' +
      '<label class="w-f"><span>Minutes</span><input id="wSchedMinutes" type="text" inputmode="numeric" autocomplete="off" value="15"></label>' +
      '<label class="w-f"><span>Reason</span><input id="wSchedReason" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<div class="w-actions">' +
      '<button class="w-btn go" data-w-act="schedload2">' + ms("search") + "Load this clinician's diary</button>" +
      '<button class="w-btn" data-w-act="apptbook">' + ms("add") + "Book</button>" +
      '<button class="w-btn ghost" data-w-act="apptoverbook">' + ms("warning") + "Book anyway (overbook)</button>" +
      "</div></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("meeting_room") + "<h3>Resources</h3></div>" +
      (resRows || '<p class="w-empty">No bookable resources are configured for this hospital.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Resource ID</span><input id="wResId" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Start (ISO)</span><input id="wResStart" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Minutes</span><input id="wResMinutes" type="text" inputmode="numeric" autocomplete="off" value="30"></label>' +
      '<label class="w-f"><span>Purpose</span><input id="wResPurpose" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="resbook">' + ms("add") + "Book resource</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("block") + "<h3>Blackout periods</h3></div>" +
      '<p class="w-hint">A blackout cannot be overridden - it is the hospital saying this slot does not exist right now.</p>' +
      (blackoutRows ? '<ul class="w-mini">' + blackoutRows + "</ul>" : '<p class="w-empty">No active blackouts.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Clinician (or leave blank)</span><input id="wBoClinician" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Resource (or leave blank)</span><input id="wBoResource" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>From (ISO)</span><input id="wBoFrom" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>To (ISO)</span><input id="wBoTo" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Reason</span><input id="wBoReason" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn warn" data-w-act="blackoutadd">' + ms("block") + "Block period</button></div>";
  }

  /* TASK 4.7: the cashier workstation. wardsynq-invoice.js already enforces every rule that
   * matters - a refund cannot exceed what was paid, a discount/adjustment/write-off must say why,
   * void only before real money moves - this screen adds no logic, only a lookup, a balance, and
   * the same actions the ledger already governs. THE CASHIER NEEDS NO CLINICAL PRIVILEGE: this
   * view is reached from the ward list, never from inside a chart, and shows nothing clinical -
   * only identity, invoices and money. "Refunds according to authorization" is read here as the
   * existing billing.charge capability gate, already server-enforced - no separate approval tier
   * is invented; if a hospital wants a threshold-based sign-off, that is a real policy decision for
   * a later, explicitly-scoped task, not assumed here. */
  var INVOICE_STATUS_WORDS = { open: "Open", paid: "Paid", void: "Void" };
  var EVENT_KIND_WORDS = { raised: "Invoice raised", discount: "Discount", deposit: "Deposit", payment: "Payment", refund: "Refund", adjustment: "Adjustment", write_off: "Write-off", void: "Voided" };
  function cashierView(state) {
    var c = state.cashier || {};
    var invoices = c.invoices || [];
    var invRows = invoices.map(function (inv) {
      var eventRows = (inv.events || []).map(function (ev) {
        return "<li><b>" + esc(EVENT_KIND_WORDS[ev.kind] || ev.kind) + "</b> " + esc(ev.amount) + " " + esc(inv.currency || "") +
          '<span>' + esc(when(ev.at)) + (ev.reason ? " &middot; " + esc(ev.reason) : "") + (ev.reference ? " &middot; ref " + esc(ev.reference) : "") + "</span></li>";
      }).join("");
      var receiptRows = (inv.receipts || []).map(function (r) {
        // The payment-gateway adapter boundary, stated on the receipt itself: no live gateway exists
        // in this build, so a payment/deposit is honestly shown as recorded through the hospital's
        // own process, never as a channel it never actually went through.
        return "<li><b>" + esc(r.receiptNumber) + "</b> " + esc(EVENT_KIND_WORDS[r.kind] || r.kind) + " " + esc(r.amount) + " " + esc(r.currency || "") + '<span>' + esc(when(r.at)) +
          (r.adapter ? " &middot; " + esc(r.adapter.state) : "") + "</span></li>";
      }).join("");
      var live = inv.status !== "void";
      return '<div class="w-sub"><h4>' + esc(inv.invoiceId) + '<span class="w-st ' + esc(inv.status) + '">' + esc(INVOICE_STATUS_WORDS[inv.status] || inv.status) + "</span></h4>" +
        "<p>Charged " + esc(inv.charged) + " &middot; Paid in " + esc(inv.paidIn) + " &middot; Balance " + esc(inv.balance) + (inv.creditBalance ? " &middot; Credit " + esc(inv.creditBalance) : "") + "</p>" +
        (eventRows ? '<ul class="w-mini">' + eventRows + "</ul>" : "") +
        (receiptRows ? "<h4>Receipts</h4><ul class=\"w-mini\">" + receiptRows + "</ul>" : "") +
        (live ? '<div class="w-actions">' +
          '<button class="w-btn tiny go" data-w-act="invpay:' + esc(inv.invoiceId) + '">' + ms("payments") + "Collect payment</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invdeposit:' + esc(inv.invoiceId) + '">' + ms("savings") + "Deposit</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invdiscount:' + esc(inv.invoiceId) + '">' + ms("percent") + "Discount</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invrefund:' + esc(inv.invoiceId) + '">' + ms("undo") + "Refund</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invadjust:' + esc(inv.invoiceId) + '">' + ms("tune") + "Adjustment</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invwriteoff:' + esc(inv.invoiceId) + '">' + ms("remove_circle") + "Write off</button>" +
          "</div>" : "") + "</div>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Cashier</b><small>financial collection only - no clinical detail</small></div>" +
      '<button class="w-ic" data-w-act="cashload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (c.err ? '<p class="w-hint warn">' + ms("warning") + esc(c.err) + "</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("search") + "<h3>Find patient</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>MRN</span><input id="wCashMrn" type="text" autocomplete="off" value="' + esc(c.mrn || "") + '"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cashlookup">' + ms("search") + "Look up</button>" +
      (c.patientId ? "<p><b>" + esc(c.patientName || c.patientId) + "</b><br><small>" + esc(c.patientId) + "</small></p>" : "") + "</div>" +

      (c.patientId ? '<div class="w-card"><div class="w-card-h">' + ms("account_balance") + "<h3>Outstanding balance</h3></div>" +
        "<p><b>" + esc(c.outstandingBalance == null ? "-" : c.outstandingBalance) + "</b></p>" +
        '<button class="w-btn" data-w-act="cashraise">' + ms("receipt_long") + "Raise invoice from today's charges</button>" +
        (invRows || '<p class="w-empty">No invoices for this patient yet.</p>') + "</div>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("payments") + "<h3>Post an amount</h3></div>" +
      '<p class="w-hint">Applies to whichever invoice button above you use. A discount, an adjustment and a write-off all require a reason; a plain payment or deposit does not.</p>' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Amount</span><input id="wCashAmount" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Reason (where required)</span><input id="wCashReason" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Reference (optional)</span><input id="wCashReference" type="text" autocomplete="off"></label>' +
      "</div></div>";
  }

  /* TASK 3.5: the blood bank workstation. wardsynq-transfusion.js (HAZ-BLD-01) already enforces
   * everything hazardous here - ABO/RhD compatibility, a crossmatch bound to one patient, and a
   * two-person bedside check that re-derives compatibility from the physical unit rather than the
   * paperwork. This screen adds NO logic: it shows the server's own verdict/failure reasons verbatim
   * and never lets the bedside-check button submit without both scans and both names present -
   * NO ONE-CLICK TRANSFUSE, enforced here as well as on the server. */
  var TXN_PHASE_WORDS = { requested: "Requested", crossmatched: "Crossmatched", issued: "Issued", checked: "Bedside check passed", transfusing: "Transfusing", completed: "Completed", stopped: "STOPPED" };
  function transfusionView(state) {
    var tx = state.transfusion || {};
    var episodes = (tx.queue && tx.queue.episodes) || [];
    var picked = tx.pickedEpisodeId;
    var ep = picked ? episodes.filter(function (e) { return e.episodeId === picked; })[0] : null;

    var rows = episodes.map(function (e) {
      return '<li' + (e.episodeId === picked ? ' class="picked"' : '') + '>' +
        '<button class="w-btn ghost tiny" data-w-act="txpick:' + esc(e.episodeId) + '"><b>' + esc(e.component || "component?") + "</b></button>" +
        '<span class="w-st ' + esc(e.phase) + '">' + esc(TXN_PHASE_WORDS[e.phase] || e.phase) + "</span></li>";
    }).join("");

    var ledgerRows = ep ? (ep.ledger || []).map(function (l) {
      return "<li><b>" + esc(l.event) + "</b><span>" + (l.actorId ? esc(l.actorId) + " &middot; " : "") + when(l.at) + (l.detail ? " &middot; " + esc(l.detail) : "") + "</span></li>";
    }).join("") : "";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<div><b>Blood bank</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="txload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("bloodtype") + "<h3>Requests</h3></div>" +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No transfusion requested for this patient.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Component</span><select id="wTxComponent"><option value="red-cells">Red cells</option><option value="plasma">Plasma</option><option value="platelets">Platelets</option></select></label>' +
      '<label class="w-f"><span>Units</span><input id="wTxUnits" type="text" inputmode="numeric" autocomplete="off" value="1"></label>' +
      '<label class="w-f"><span>Indication</span><input id="wTxIndication" type="text" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="txrequest">' + ms("add") + "Request</button></div>" +

      (ep ? (
        '<div class="w-card"><div class="w-card-h">' + ms("science") + "<h3>Crossmatch</h3></div>" +
        (ep.crossmatch ? "<p><b>" + esc(ep.crossmatch.unitId) + "</b> " + esc(ep.crossmatch.verdict && ep.crossmatch.verdict.abo) + "</p>" : '<p class="w-empty">Not yet crossmatched.</p>') +
        (ep.phase === "requested" ? (
          '<div class="w-grid">' +
          '<label class="w-f"><span>Unit ID</span><input id="wTxUnitId" type="text" autocomplete="off"></label>' +
          '<label class="w-f"><span>ABO group</span><select id="wTxUnitAbo"><option>O</option><option>A</option><option>B</option><option>AB</option></select></label>' +
          '<label class="w-f"><span>RhD</span><select id="wTxUnitRh"><option value="positive">Positive</option><option value="negative">Negative</option></select></label>' +
          '<label class="w-f"><span>Expiry</span><input id="wTxUnitExpiry" type="date"></label>' +
          "</div>" +
          '<button class="w-btn go" data-w-act="txcrossmatch">' + ms("check") + "Crossmatch</button>"
        ) : "") +
        (ep.phase === "crossmatched" ? '<button class="w-btn go" data-w-act="txissue">' + ms("outbound") + "Issue unit</button>" : "") +
        "</div>"
      ) : "") +

      (ep && ep.phase === "issued" ? (
        '<div class="w-card"><div class="w-card-h">' + ms("verified") + "<h3>Bedside verification - two people, two scans</h3></div>" +
        '<p class="w-hint warn">' + ms("warning") + "NO ONE-CLICK TRANSFUSE. Both checkers and both scans are required; compatibility is re-derived from what is scanned, never trusted from the crossmatch record." + "</p>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>First checker (you)</span><input id="wTxChecker1" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Second checker (independent)</span><input id="wTxChecker2" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Scan: patient wristband</span><input id="wTxScanPatient" type="text" autocomplete="off"></label>' +
        '<label class="w-f"><span>Scan: unit label</span><input id="wTxScanUnit" type="text" autocomplete="off"></label>' +
        "</div>" +
        '<button class="w-btn go" data-w-act="txbedside">' + ms("qr_code_scanner") + "Verify at bedside</button></div>"
      ) : "") +

      (ep && ep.phase === "checked" ? '<div class="w-card"><button class="w-btn go" data-w-act="txstart">' + ms("play_arrow") + "Start transfusion</button></div>" : "") +

      (ep && ep.phase === "transfusing" ? (
        '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>Running - observations</h3></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Pulse</span><input id="wTxPulse" type="text" inputmode="numeric" autocomplete="off"></label>' +
        '<label class="w-f"><span>Temp</span><input id="wTxTemp" type="text" inputmode="decimal" autocomplete="off"></label>' +
        '<label class="w-f"><span>SBP</span><input id="wTxSbp" type="text" inputmode="numeric" autocomplete="off"></label>' +
        "</div>" +
        '<button class="w-btn ghost" data-w-act="txobserve">' + ms("monitoring") + "Record observation</button>" +
        '<div class="w-actions">' +
        '<button class="w-btn go" data-w-act="txcomplete">' + ms("check_circle") + "Complete</button>" +
        '<button class="w-btn warn" data-w-act="txreaction">' + ms("emergency") + "Reaction - STOP</button>" +
        "</div></div>"
      ) : "") +

      (ep && ep.phase === "stopped" && ep.reaction ? '<div class="w-card"><div class="w-card-h">' + ms("emergency") + "<h3>STOPPED - reaction</h3></div><p>" + esc(ep.reaction.detail || "") + "</p><p><small>" + when(ep.reaction.at) + " &middot; " + esc(ep.reaction.by) + "</small></p></div>" : "") +

      (ep ? ('<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>Ledger</h3></div>" + (ledgerRows ? '<ul class="w-mini">' + ledgerRows + "</ul>" : "") + "</div>") : "");
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
  var REPORT_LABELS = {
    patientFlow: "Patient flow", clinicalOperations: "Clinical operations", billing: "Billing",
    claims: "Claims", pharmacy: "Pharmacy", him: "HIM",
  };
  /* TASK 4.17 (Administration, scoped down): each report is shown exactly as reportEnvelope()
   * stamps it - data source, period, filters, generated-at, permission scope - never re-summarised
   * into a single number this screen invented. What each report's own body contains varies (a claim
   * count is not a stock level), so the body is listed generically as key: value rather than a
   * bespoke layout per report, which would be six more places to keep in sync with reports.js. */
  function reportsView(state) {
    var r = state.reports || {};
    var sections = Object.keys(REPORT_LABELS).map(function (key) {
      var rep = r[key];
      if (!rep) return "";
      if (!rep.ok) return '<div class="w-sub"><h4>' + esc(REPORT_LABELS[key]) + "</h4><p class=\"w-empty\">Could not load: " + esc(rep.detail || rep.error || "unknown error") + "</p></div>";
      var body = Object.keys(rep).filter(function (k) { return ["ok", "mode", "tenantId", "dataSource", "period", "filters", "generatedAt", "scope"].indexOf(k) < 0; })
        .map(function (k) { var v = rep[k]; return "<li><b>" + esc(k) + ":</b> " + esc(typeof v === "object" ? JSON.stringify(v) : v) + "</li>"; }).join("");
      return '<div class="w-sub"><h4>' + esc(REPORT_LABELS[key]) + "</h4>" +
        '<p class="w-dt-times">source: ' + esc((rep.dataSource || []).join(", ")) +
        (rep.period && (rep.period.from || rep.period.to) ? " &middot; " + esc(rep.period.from || "") + " to " + esc(rep.period.to || "") : "") +
        " &middot; generated " + when(rep.generatedAt) + " &middot; as " + esc(rep.scope && rep.scope.role) + "</p>" +
        "<ul class=\"w-mini-flat\">" + body + "</ul></div>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-card-h">' + ms("summarize") + "<h3>Reports</h3>" +
      '<button class="w-ic" data-w-act="reports" title="Refresh">' + ms("refresh") + "</button></div>" +
      (sections || '<p class="w-empty">Loading…</p>') +
      "</div>";
  }

  var EMERGENCY_KINDS = [["mass-casualty", "Mass casualty"], ["disaster", "Disaster"], ["downtime", "Major downtime"], ["evacuation", "Evacuation"], ["surge", "Surge"], ["network-outage", "Network outage"], ["other", "Other"]];
  function emergencyAdminView(state) {
    var e = state.emergencyAdmin || {};
    var rows = (e.activations || []).map(function (a) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(a.active ? "escalate" : a.revokedAt ? "" : "due") + '">' + esc(a.active ? "active" : (a.revokedAt ? "stood down" : "expired")) + "</span> " +
        "<b>" + esc(a.kind) + "</b> &middot; " + esc(a.reason) +
        (a.relaxations && a.relaxations.length ? " &middot; relaxes: " + esc(a.relaxations.join(", ")) : "") +
        '<div class="w-dt-times">declared ' + when(a.declaredAt) + " &middot; until " + when(a.expiresAt) +
        (a.revokedAt ? " &middot; stood down " + when(a.revokedAt) + (a.revokedReason ? ": " + esc(a.revokedReason) : "") : "") + "</div></div>" +
        '<div class="w-mini-row-act">' +
        (a.active ? '<button class="w-btn ghost sm" data-w-act="emergencydeactivate:' + esc(a.activationId) + '">' + ms("cancel") + "Stand down</button>" : "") +
        '<button class="w-btn ghost sm" data-w-act="emergencyreconcile:' + esc(a.activationId) + '">' + ms("fact_check") + "Reconcile</button>" +
        "</div></li>";
    }).join("");
    var rec = state.emergencyReconcile;
    var recBlock = "";
    if (rec) {
      var recRows = (rec.overrides || []).map(function (o) {
        return "<li>" + esc(o.relaxation) + " overrode <b>" + esc(o.overriddenState) + "</b> on " + esc(o.sourceType) + " " + esc(o.sourceId) +
          " &middot; by " + esc(o.by) + " &middot; " + when(o.at) + "</li>";
      }).join("");
      recBlock = '<div class="w-sub"><h4>Reconciliation: ' + esc(rec.activationId) + "</h4>" +
        "<p>" + esc(rec.note || "") + "</p>" +
        (recRows ? "<ul class=\"w-mini\">" + recRows + "</ul>" : "") + "</div>";
    }
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Emergency mode</h3><button class=\"w-btn ghost\" data-w-act=\"emergencyadmin\">" + ms("refresh") + "Refresh</button></div>" +
      (rows ? "<ul class=\"w-mini\">" + rows + "</ul>" : '<p class="w-empty">No emergency has ever been declared here.</p>') +
      recBlock +
      '<div class="w-sub"><h4>Declare</h4>' +
      '<select id="wEmergencyKind">' + EMERGENCY_KINDS.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wEmergencyReason" placeholder="What is the emergency, in your own words">' +
      '<input id="wEmergencyRelaxations" placeholder="Relaxations to name, comma-separated (e.g. bed-assignment-conflict-override)">' +
      '<input id="wEmergencyMinutes" type="number" placeholder="Minutes (default 240, capped at 1440)">' +
      '<button class="w-btn" data-w-act="emergencydeclare">' + ms("emergency") + "Declare</button></div>" +
      "</div>";
  }

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
      /* A demonstration hospital says so on the chart itself. Demo and real records are separate
       * tenants, but that separation is invisible to somebody reading a screen over a shoulder, and
       * a fabricated patient that reads as a real one is the whole hazard. */
      (state.demo ? '<span class="w-demo" title="Fabricated patients, for demonstration. Nothing here is a real person or a real clinical record.">DEMO</span>' : "") +
      (state.busy ? '<span class="w-busy">' + ms("progress_activity") + "</span>" : "<span></span>") + "</header>" +
      '<div class="w-canvas">' + banner(state) +
      (state.view === "chart" ? chartView(state)
        : state.view === "downtime" ? downtimeView(state)
        : state.view === "reports" ? reportsView(state)
        : state.view === "emergencyadmin" ? emergencyAdminView(state)
        : state.view === "pcopy" ? pcopyView(state)
        : state.view === "consent" ? consentView(state)
        : state.view === "completion" ? completionView(state)
        : state.view === "roi" ? roiView(state)
        : state.view === "tpa" ? tpaView(state)
        : state.view === "billing" ? billingView(state)
        : state.view === "board" ? boardView(state)
        : state.view === "ed" ? edBoardView(state)
        : state.view === "inventory" ? inventoryView(state)
        : state.view === "surgery" ? surgeryBoardView(state)
        : state.view === "surgerycase" ? surgeryCaseView(state)
        : state.view === "oncology" ? oncologyView(state)
        : state.view === "cardiology" ? cardiologyView(state)
        : state.view === "radiology" ? radiologyView(state)
        : state.view === "pharmacy" ? pharmacyView(state)
        : state.view === "transfusion" ? transfusionView(state)
        : state.view === "critsboard" ? critsBoardView(state)
        : state.view === "timeline" ? timelineView(state)
        : state.view === "labboard" ? labBoardView(state)
        : state.view === "radboard" ? radBoardView(state)
        : state.view === "integration" ? integrationView(state)
        : state.view === "bedmgmt" ? bedBoardMgmtView(state)
        : state.view === "flowcommand" ? flowCommandView(state)
        : state.view === "twin" ? twinView(state)
        : state.view === "scheduling" ? schedulingView(state)
        : state.view === "cashier" ? cashierView(state)
        : listView(state)) + "</div></div>";
  }

  // ---- controller --------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdWard"); if (!el) { el = document.createElement("div"); el.id = "smdWard"; document.body.appendChild(el); } return el; }
  function paint() { root().innerHTML = _render(st); }

  function loadWard() {
    st.busy = true; paint();
    return apiGet("/ward/list?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { if (settle(r)) { st.patients = r.patients || []; if (r.region) st.region = r.region; } st.loaded = true; paint(); return Promise.all([loadCosigns(), loadQuality(), loadOverrides(), loadExceptions(), loadEmergencyStatus()]); })
      .catch(function () { st.busy = false; st.err = "Could not reach the ward."; st.loaded = true; paint(); });
  }
  function loadChart() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId);
    return Promise.all([apiGet("/ward/problems?" + q), apiGet("/ward/criticals?" + q), apiGet("/ward/timeline?" + q)])
      .then(function (rs) {
        if (settle(rs[0])) st.problems = rs[0].problems || [];
        // A failure to READ the critical list must not be silent: an empty list and an unreachable
        // one look identical on screen, and that is the difference between calm and dangerous.
        if (rs[1] && rs[1].ok) st.criticals = rs[1].loops || [];
        else st.err = st.err || "Could not load critical results. Do not read this chart as clear.";
        // The timeline is a READ of records already shown elsewhere on this chart, merged into one
        // order - a failure here is never worse than not having merged them, so it degrades to
        // "not shown" rather than joining the critical-results error above.
        if (rs[2] && rs[2].ok) { st.timeline = rs[2].events || []; st.activeMeds = rs[2].activeMedications || []; st.timelineGap = rs[2].withoutTimestamp || 0; }
        else { st.timeline = null; st.activeMeds = null; }
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
    st.admitTarget = { ward: ward, bed: bed }; st.mrnLookup = null; st.mrnLookupErr = ""; st.admitClass = ""; st.emergencyOverride = false; paint();
  }
  /* The one write in this whole flow: an Encounter, exactly as /ward/transfer and every other admit
   * caller writes it. Nothing here invents a second admission path.
   *
   * The class is read from st.admitClass, captured the moment it was chosen (mrnLookup/admitNew,
   * below) - NOT from the select's live DOM state here. paint() replaces the admit panel's whole
   * innerHTML on the way to this call (the lookup's own busy-state repaint), which silently resets
   * an uncontrolled <select>; reading the DOM at this point would quietly drop the choice a nurse
   * already made (Task 2.2's own report named this exact bug for the ICU checkbox that used to be
   * here). */
  function doAdmit(mrn) {
    var t = st.admitTarget; if (!t || !mrn) return;
    st.busy = true; paint();
    apiPost("/ward/admit", { orgId: st.orgId, mrn: mrn, ward: t.ward, bed: t.bed, admittedAt: new Date().toISOString(), class: st.admitClass || undefined, emergencyOverride: st.emergencyOverride === true })
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
    var classEl = document.getElementById("wAdmitClass");
    if (classEl) st.admitClass = classEl.value || "";
    var overrideEl = document.getElementById("wAdmitEmergencyOverride");
    if (overrideEl) st.emergencyOverride = !!overrideEl.checked;
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
  function admitConfirm() {
    if (!st.mrnLookup) return;
    // The override checkbox is ticked AFTER the lookup's own repaint, not before it - captured here,
    // fresh, the same reason mrnLookup/admitNew capture the class select at their own click rather
    // than trusting a value read at an earlier one.
    var overrideEl = document.getElementById("wAdmitEmergencyOverride");
    if (overrideEl) st.emergencyOverride = !!overrideEl.checked;
    doAdmit(st.mrnLookup.mrn);
  }
  /* NEW PATIENT: the SAME check-in sheet the front desk uses (SMD_PATIENTREG), not a second form
   * that could drift from it. Registration and admission are two writes, in order - a registration
   * that succeeds but whose admit then fails still leaves a real, findable patient record; it is
   * never silently discarded. */
  function admitNew() {
    var t = st.admitTarget; if (!t) return;
    var classEl = document.getElementById("wAdmitClass");
    if (classEl) st.admitClass = classEl.value || "";
    var overrideEl = document.getElementById("wAdmitEmergencyOverride");
    if (overrideEl) st.emergencyOverride = !!overrideEl.checked;
    if (!(G.SMD_PATIENTREG && G.SMD_PATIENTREG.open)) { st.err = "Registration is unavailable on this build."; paint(); return; }
    G.SMD_PATIENTREG.open({
      /* The hospital's country, so the sheet asks for the right phone and postcode shapes. st.region
       * comes from GET /ward/list; without it a US hospital admitting from the bed board would be
       * handed an Indian mobile field and could not complete the registration. */
      region: st.region,
      // This sheet is shared with the OPD front desk, whose verb is "Add to queue". Opened from the
      // bed board the act is an admission, and the button now says which bed it is admitting to.
      submitLabel: st.admitTarget && st.admitTarget.bed ? "Register & admit to " + st.admitTarget.bed : "Register & admit",
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
  // ---- ICU device association (HAZ-DEV-01) --------------------------------------------------
  function loadDevices() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/device-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (r && r.ok) st.devices = r.devices; paint(); })
      .catch(function () {});
  }
  function deviceAssociate() {
    var s = st.sel; if (!s) return;
    var deviceId = val("wDevId"), assetTag = val("wDevTag"), wristband = val("wDevWrist");
    if (!deviceId || !assetTag || !wristband) { st.err = "Scan the device's asset tag and the patient's wristband, and give the device an ID."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/device-associate", {
      orgId: st.orgId,
      association: {
        // The server looks up this patient's own MRN itself and checks the scanned wristband
        // against IT - it never trusts an mrn/wristbandBarcode value sent from here.
        device: { deviceId: deviceId, assetTag: assetTag },
        patient: { id: s.patientId },
        encounterId: s.encounterId, scannedWristband: wristband, scannedAssetTag: assetTag,
      },
    })
      .then(function (r) {
        if (r && !r.ok && r.error === "WRISTBAND_MISMATCH") { st.busy = false; st.err = "That wristband does not match this patient."; paint(); return; }
        if (r && !r.ok && r.error === "ASSET_TAG_MISMATCH") { st.busy = false; st.err = "That asset tag does not match the device ID entered."; paint(); return; }
        if (settle(r, "Device associated.")) loadDevices(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not associate the device."; paint(); });
  }
  function deviceDissociate(deviceId) {
    st.busy = true; paint();
    apiPost("/ward/device-dissociate", { orgId: st.orgId, deviceId: deviceId, reason: "removed from patient" })
      .then(function (r) { if (settle(r, "Device removed.")) loadDevices(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not remove the device."; paint(); });
  }
  // ---- surgery / OT / PACU (Task 2.3) ------------------------------------------------------
  function loadSurgeryBoard() {
    st.busy = true; st.view = "surgery"; st.surgErr = ""; paint();
    return apiGet("/ward/surgery-board?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.surgBoard = r; else st.surgErr = (r && r.detail) || "Could not load the theatre board."; paint(); })
      .catch(function () { st.busy = false; st.surgErr = "Could not load the theatre board."; paint(); });
  }
  function surgeryBookOpen() { st.surgBookOpen = true; st.surgMrnLookup = null; st.surgMrnLookupErr = ""; paint(); }
  function surgeryBookClose() { st.surgBookOpen = false; st.surgMrnLookup = null; paint(); }
  function surgMrnLookup() {
    var mrn = val("wSurgMrn");
    if (!mrn) { st.surgMrnLookupErr = "Enter an MRN."; st.surgMrnLookup = null; paint(); return; }
    st.busy = true; st.surgMrnLookupErr = ""; st.surgMrnLookup = null; paint();
    apiGet("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok && r.patient) st.surgMrnLookup = Object.assign({ mrn: mrn }, r.patient);
        else st.surgMrnLookupErr = "No patient found with that MRN.";
        paint();
      })
      .catch(function () { st.busy = false; st.surgMrnLookupErr = "Could not look up that MRN."; paint(); });
  }
  // Every field read() happens BEFORE st.busy=true;paint() in every function below: paint() replaces
  // this panel's whole innerHTML, and reading an input AFTER that reads a freshly-rendered, empty
  // node instead of what was typed - the same bug the ICU admit checkbox had (Task 2.2's own report).
  function surgeryBook() {
    var lookup = st.surgMrnLookup; if (!lookup) return;
    var procedure = val("wSurgProcedure"), site = val("wSurgSite"), theatre = val("wSurgTheatre");
    var laterality = (document.getElementById("wSurgLaterality") || {}).value || "not-applicable";
    st.busy = true; paint();
    apiPost("/ward/surgery-book", { orgId: st.orgId, booking: { mrn: lookup.mrn, procedure: procedure, site: site, laterality: laterality, theatre: theatre } })
      .then(function (r) {
        if (settle(r, "Case booked.")) { st.surgBookOpen = false; st.surgMrnLookup = null; loadSurgeryBoard(); } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not book the case."; paint(); });
  }
  function loadSurgeryCase(caseId) {
    st.busy = true; paint();
    return apiGet("/ward/surgery-get?orgId=" + encodeURIComponent(st.orgId) + "&caseId=" + encodeURIComponent(caseId))
      .then(function (r) {
        if (!r || !r.ok || !r.case) { st.busy = false; st.err = "That case could not be loaded."; st.view = "surgery"; paint(); return; }
        st.surgCase = { case: r.case, anesthesia: null, implants: [] };
        paint();
        return Promise.all([
          apiGet("/ward/anesthesia-get?orgId=" + encodeURIComponent(st.orgId) + "&caseId=" + encodeURIComponent(caseId)).then(function (a) { if (a && a.ok) st.surgCase.anesthesia = a.record; }),
          apiGet("/ward/implant-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(r.case.patientId) + "&caseId=" + encodeURIComponent(caseId)).then(function (i) { if (i && i.ok) st.surgCase.implants = i.implants; }),
        ]).then(function () { st.busy = false; paint(); });
      })
      .catch(function () { st.busy = false; st.err = "Could not load the case."; paint(); });
  }
  function openSurgeryCase(caseId) { st.view = "surgerycase"; st.surgCase = null; loadSurgeryCase(caseId); }
  function surgeryLoad() { var c = st.surgCase && st.surgCase.case; if (c) loadSurgeryCase(c.id); }
  function surgeryConsent() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var signed = !!(document.getElementById("wSurgConsentSigned") || {}).checked;
    var procedure = val("wSurgConsentProc"), laterality = (document.getElementById("wSurgConsentLat") || {}).value || "not-applicable";
    st.busy = true; paint();
    apiPost("/ward/surgery-consent", { orgId: st.orgId, caseId: c.id, consent: { procedure: procedure, laterality: laterality, signedByPatientOrProxy: signed, givenBy: "patient" } })
      .then(function (r) {
        if (r && !r.ok && r.code) { st.busy = false; st.err = r.detail || "The consent does not match this booking."; paint(); return; }
        if (settle(r, "Consent recorded.")) loadSurgeryCase(c.id); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record consent."; paint(); });
  }
  function surgeryMarkSite() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var site = val("wSurgMarkSite"), laterality = (document.getElementById("wSurgMarkLat") || {}).value || "not-applicable";
    st.busy = true; paint();
    apiPost("/ward/surgery-marksite", { orgId: st.orgId, caseId: c.id, marking: { site: site, laterality: laterality } })
      .then(function (r) {
        if (r && !r.ok && r.code) { st.busy = false; st.err = r.detail || "The marking does not match the booking."; paint(); return; }
        if (settle(r, "Site marking recorded.")) loadSurgeryCase(c.id); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the marking."; paint(); });
  }
  function surgeryPhase(phase) {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var items = phase === "signIn" ? SIGN_IN_ITEMS : phase === "timeOut" ? TIME_OUT_ITEMS : SIGN_OUT_ITEMS;
    var itemMap = {}; items.forEach(function (k) { itemMap[k] = !!(document.getElementById("wSurgItem-" + phase + "-" + k) || {}).checked; });
    var role = function (r) { return val("wSurgSig-" + phase + "-" + r); };
    var signatures = [];
    ["surgeon", "anaesthetist", "nurse"].forEach(function (r) { var a = role(r); if (a) signatures.push({ role: r, actorId: a }); });
    var submission = { items: itemMap, signatures: signatures };
    if (phase !== "signOut") submission.lateralityAsserted = (document.getElementById("wSurgLatAssert-" + phase) || {}).value || "not-applicable";
    var route = phase === "signIn" ? "/ward/surgery-signin" : phase === "timeOut" ? "/ward/surgery-timeout" : "/ward/surgery-signout";
    st.busy = true; paint();
    apiPost(route, { orgId: st.orgId, caseId: c.id, submission: submission })
      .then(function (r) {
        if (r && !r.ok && r.code) { st.busy = false; st.err = r.detail || "The checklist could not be completed."; paint(); return; }
        if (settle(r, "Completed.")) loadSurgeryCase(c.id); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not complete this phase."; paint(); });
  }
  function surgeryIncise() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    st.busy = true; paint();
    apiPost("/ward/surgery-incise", { orgId: st.orgId, caseId: c.id })
      .then(function (r) {
        if (r && !r.ok && r.code) { st.busy = false; st.err = r.detail || "Incision is locked."; paint(); return; }
        if (settle(r, "Incision recorded.")) loadSurgeryCase(c.id); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the incision."; paint(); });
  }
  function surgeryImplant() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var device = val("wSurgImplantDevice"); if (!device) { st.err = "Enter the device."; paint(); return; }
    var lot = val("wSurgImplantLot"), serial = val("wSurgImplantSerial");
    st.busy = true; paint();
    apiPost("/ward/implant", { orgId: st.orgId, caseId: c.id, implant: { device: device, lot: lot, serial: serial } })
      .then(function (r) { if (settle(r, "Implant logged.")) loadSurgeryCase(c.id); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not log the implant."; paint(); });
  }
  function surgeryNote() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var note = val("wSurgNote");
    st.busy = true; paint();
    apiPost("/ward/surgery-note", { orgId: st.orgId, caseId: c.id, note: note })
      .then(function (r) { if (settle(r, "Note saved.")) loadSurgeryCase(c.id); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not save the note."; paint(); });
  }
  function surgeryDisposition(disposition) {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    st.busy = true; paint();
    apiPost("/ward/surgery-disposition", { orgId: st.orgId, caseId: c.id, disposition: disposition, pacuBed: disposition === "pacu" ? "1" : undefined })
      .then(function (r) {
        if (r && !r.ok && r.error === "not_signed_out") { st.busy = false; st.err = "Sign out has to be complete first."; paint(); return; }
        if (settle(r, "Disposition recorded.")) { st.view = "surgery"; st.surgCase = null; loadSurgeryBoard(); } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the disposition."; paint(); });
  }
  function anesStart() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var asaClass = val("wSurgAsa");
    st.busy = true; paint();
    apiPost("/ward/anesthesia-start", { orgId: st.orgId, caseId: c.id, asaClass: asaClass })
      .then(function (r) { if (settle(r, "Anaesthesia record started.")) loadSurgeryCase(c.id); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not start the anaesthesia record."; paint(); });
  }
  function anesEvent() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    var drug = val("wSurgAnesDrug"), dose = val("wSurgAnesDose"), route = val("wSurgAnesRoute");
    if (!drug || !dose) { st.err = "Enter the drug and the dose."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/anesthesia-event", { orgId: st.orgId, caseId: c.id, event: { drug: drug, dose: dose, route: route } })
      .then(function (r) { if (settle(r, "Recorded.")) loadSurgeryCase(c.id); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that drug."; paint(); });
  }
  function anesEnd() {
    var c = st.surgCase && st.surgCase.case; if (!c) return;
    st.busy = true; paint();
    apiPost("/ward/anesthesia-end", { orgId: st.orgId, caseId: c.id })
      .then(function (r) { if (settle(r, "Anaesthesia ended.")) loadSurgeryCase(c.id); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not end the anaesthesia record."; paint(); });
  }
  // ---- maternity / OB-GYN (Task 2.4) -------------------------------------------------------
  function loadMaternity() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.maternity = st.maternity || {};
    return Promise.all([
      apiGet("/ward/pregnancy-get?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { if (r && r.ok) st.maternity.pregnancy = r.pregnancy; }),
      apiGet("/ward/meows?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { if (r && r.ok) st.maternity.meows = r.meows; }),
      apiGet("/ward/blood-loss-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { if (r && r.ok) st.maternity.losses = r.losses; }),
      apiGet("/ward/delivery-get?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { if (r && r.ok) st.maternity.delivery = r.delivery; }),
      apiGet("/ward/family-links?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { if (r && r.ok) st.maternity.links = r.links; }),
    ]).then(function () { paint(); });
  }
  function pregnancySave() {
    var s = st.sel; if (!s) return;
    var gravida = Number(val("wPregGravida")), para = Number(val("wPregPara")), gestationWeeks = Number(val("wPregWeeks")), edd = val("wPregEdd");
    st.busy = true; paint();
    apiPost("/ward/pregnancy", { orgId: st.orgId, patientId: s.patientId, pregnancy: {
      gravida: Number.isFinite(gravida) ? gravida : undefined, para: Number.isFinite(para) ? para : undefined,
      gestationWeeks: Number.isFinite(gestationWeeks) ? gestationWeeks : undefined, edd: edd || undefined,
    } })
      .then(function (r) { if (settle(r, "Saved.")) loadMaternity(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not save the pregnancy episode."; paint(); });
  }
  function labourChart() {
    var s = st.sel; if (!s) return;
    var status = (document.getElementById("wLabStatus") || {}).value;
    var dilation = val("wLabDilation"), contractions = val("wLabContractions"), fhr = val("wLabFhr");
    var entries = [];
    if (status) entries.push(["labour-status", status]);
    if (dilation) entries.push(["dilation-cm", Number(dilation)]);
    if (contractions) entries.push(["contractions-per-10min", Number(contractions)]);
    if (fhr) entries.push(["fhr-bpm", Number(fhr)]);
    if (!entries.length) { st.err = "Enter at least one value."; paint(); return; }
    st.busy = true; paint();
    var at = new Date().toISOString();
    Promise.all(entries.map(function (e) {
      return apiPost("/ward/labour", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, code: e[0], value: e[1], at: at });
    })).then(function (rs) {
      st.busy = false;
      if (rs.every(function (r) { return r && r.ok; })) { st.note = "Charted."; loadFlowsheet(); } else st.err = "Some values could not be charted.";
      paint();
    }).catch(function () { st.busy = false; st.err = "Could not chart labour observations."; paint(); });
  }
  function bloodLossSave() {
    var s = st.sel; if (!s) return;
    var ml = Number(val("wLossMl")), method = (document.getElementById("wLossMethod") || {}).value;
    if (!Number.isFinite(ml)) { st.err = "Enter the volume in mL."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/blood-loss", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, loss: { ml: ml, method: method } })
      .then(function (r) {
        if (!r || !r.ok) { st.busy = false; st.err = (r && r.detail) || "Could not record blood loss."; paint(); return; }
        st.note = r.recognition && r.recognition.prompt
          ? "Recorded. " + r.recognition.reasons.join("; ") + (r.recognition.code ? " - consider starting " + r.recognition.code + "." : "")
          : "Recorded.";
        loadMaternity();
      })
      .catch(function () { st.busy = false; st.err = "Could not record blood loss."; paint(); });
  }
  function deliverySave() {
    var s = st.sel; if (!s) return;
    var mode = (document.getElementById("wDelMode") || {}).value, complications = val("wDelComplications");
    st.busy = true; paint();
    apiPost("/ward/delivery", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, delivery: { mode: mode, complications: complications || undefined } })
      .then(function (r) { if (settle(r, "Delivery recorded.")) loadMaternity(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the delivery."; paint(); });
  }
  function newbornSave() {
    var s = st.sel; if (!s) return;
    var sex = (document.getElementById("wNewbornSex") || {}).value, name = val("wNewbornName");
    st.busy = true; paint();
    apiPost("/ward/newborn", { orgId: st.orgId, motherPatientId: s.patientId, encounterId: s.encounterId, sex: sex, name: name || undefined })
      .then(function (r) {
        if (r && !r.ok && r.error === "no_delivery_recorded") { st.busy = false; st.err = "Record the delivery first."; paint(); return; }
        if (settle(r, "Newborn registered.")) loadMaternity(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not register the newborn."; paint(); });
  }
  // ---- pediatrics / NICU (Task 2.5) ----------------------------------------------------------
  function loadAgeBand() {
    var s = st.sel; if (!s) return Promise.resolve();
    var weight = val("wAgeWeight"), gest = val("wAgeGest");
    var patient = {};
    if (weight) patient.weightKg = Number(weight);
    if (gest) patient.gestationalAgeWeeks = Number(gest);
    return apiPost("/ward/age-band", { orgId: st.orgId, patient: patient })
      .then(function (r) { if (r && r.ok) st.ageBand = r.banding; paint(); })
      .catch(function () {});
  }
  function rateCalc() {
    var dose = Number(val("wRateDose")), conc = Number(val("wRateConc")), weight = Number(val("wAgeWeight"));
    if (!dose || !conc) { st.err = "Enter the dose and the concentration."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/weight-rate", { orgId: st.orgId, dosePerKgPerMin: dose, weightKg: weight, concentrationMgPerMl: conc, patient: weight ? { weightKg: weight } : null })
      .then(function (r) { st.busy = false; if (r && r.ok) st.rateResult = r.result; else st.err = (r && r.detail) || "Could not calculate."; paint(); })
      .catch(function () { st.busy = false; st.err = "Could not calculate."; paint(); });
  }
  function neonatalChart() {
    var s = st.sel; if (!s) return;
    var mode = (document.getElementById("wNeoMode") || {}).value, fio2 = val("wNeoFio2"), peep = val("wNeoPeep");
    var entries = [["resp-support-mode", mode]];
    if (fio2) entries.push(["fio2-percent", Number(fio2)]);
    if (peep) entries.push(["peep-cmh2o", Number(peep)]);
    st.busy = true; paint();
    var at = new Date().toISOString();
    Promise.all(entries.map(function (e) {
      return apiPost("/ward/neonatal", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, code: e[0], value: e[1], at: at });
    })).then(function (rs) {
      st.busy = false;
      if (rs.every(function (r) { return r && r.ok; })) { st.note = "Charted."; loadFlowsheet(); } else st.err = "Some values could not be charted.";
      paint();
    }).catch(function () { st.busy = false; st.err = "Could not chart the observation."; paint(); });
  }
  function loadLines() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/line-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (r && r.ok) st.lines = r.lines; paint(); })
      .catch(function () {});
  }
  function lineSave() {
    var s = st.sel; if (!s) return;
    var type = val("wLineType"), site = val("wLineSite");
    if (!type) { st.err = "Enter the line type."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/line", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, line: { type: type, site: site || undefined } })
      .then(function (r) { if (settle(r, "Line recorded.")) loadLines(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the line."; paint(); });
  }
  function lineRemove(lineId) {
    st.busy = true; paint();
    apiPost("/ward/line-remove", { orgId: st.orgId, lineId: lineId })
      .then(function (r) { if (settle(r, "Line removed.")) loadLines(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not remove the line."; paint(); });
  }
  // ---- ONCqis bridge (Task 2.6) ---------------------------------------------------------------
  function oncologyOpen() {
    st.view = "oncology"; st.oncology = null; paint(); loadOncology();
  }
  function loadOncology() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/onco-timeline?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.oncology = { timeline: r && r.ok ? r.timeline : null }; paint(); })
      .catch(function () {});
  }
  function oncoLinkSave() {
    var s = st.sel; if (!s) return;
    var oncoPlanId = val("wOncoPlanId"), regimen = val("wOncoRegimen"), version = val("wOncoVersion");
    if (!oncoPlanId) { st.err = "Enter the ONCqis plan id."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/onco-link", { orgId: st.orgId, encounterId: s.encounterId, plan: {
      oncoPlanId: oncoPlanId, hospitalId: st.orgId, ghisPatientId: s.mrn || s.patientId, regimen: regimen || undefined, protocolVersion: version || undefined,
    } })
      .then(function (r) { if (settle(r, "Plan linked.")) loadOncology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not link the plan."; paint(); });
  }
  function oncoDxSave() {
    var s = st.sel; if (!s) return;
    var code = val("wOncoDxCode"), display = val("wOncoDxDisplay"), stage = val("wOncoStage");
    if (!code) { st.err = "Enter the diagnosis code."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/onco-diagnosis", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, condition: { code: code, display: display || undefined },
      staging: stage ? { stageGroup: stage } : undefined })
      .then(function (r) { if (settle(r, "Diagnosis recorded.")) loadOncology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the diagnosis."; paint(); });
  }
  function oncoAeSave() {
    var s = st.sel; if (!s) return;
    var term = val("wOncoAeTerm"), grade = Number(val("wOncoAeGrade"));
    if (!term || !grade) { st.err = "Enter the term and the CTCAE grade."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/onco-ae", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, event: { term: term, grade: grade } })
      .then(function (r) {
        if (r && !r.ok && r.error === "grade_must_be_1_to_5") { st.busy = false; st.err = "The CTCAE grade must be 1 to 5."; paint(); return; }
        if (settle(r, "Adverse event recorded.")) loadOncology(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the adverse event."; paint(); });
  }
  function oncoChemoSave() {
    var s = st.sel; if (!s) return;
    var cycleId = val("wOncoCycleId"), drug = val("wOncoDrug"), dose = Number(val("wOncoDose")), bsa = val("wOncoBsa");
    var extravasated = !!(document.getElementById("wOncoExtrav") || {}).checked;
    if (!cycleId || !drug || !dose) { st.err = "Enter the cycle id, drug and dose."; paint(); return; }
    var oncoPlanId = (st.oncology && st.oncology.timeline && st.oncology.timeline.links[0] && st.oncology.timeline.links[0].oncoPlanId) || "";
    if (!oncoPlanId) { st.err = "Link an ONCqis plan first."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/onco-chemo", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, oncoPlanId: oncoPlanId, cycleId: cycleId, admin: {
      drug: drug, doseGiven: dose, bsaUsed: bsa ? Number(bsa) : undefined, extravasation: { occurred: extravasated },
    } })
      .then(function (r) { if (settle(r, "Administration recorded.")) loadOncology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the administration."; paint(); });
  }
  function cardiologyOpen() {
    st.view = "cardiology"; st.cardiology = null; paint(); loadCardiology();
  }
  function loadCardiology() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/cardio-timeline?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.cardiology = { timeline: r && r.ok ? r.timeline : null }; paint(); })
      .catch(function () {});
  }
  function cardioLinkSave() {
    var s = st.sel; if (!s) return;
    var recordId = val("wCardioRecordId");
    if (!recordId) { st.err = "Enter the KardiQ X record id."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/cardio-link", { orgId: st.orgId, encounterId: s.encounterId, link: { kardioxRecordId: recordId, mrn: s.mrn || s.patientId } })
      .then(function (r) { if (settle(r, "Record linked.")) loadCardiology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not link the record."; paint(); });
  }
  function cardioEcgSave() {
    var s = st.sel; if (!s) return;
    var verdict = val("wCardioVerdict"), heart = val("wCardioHeart"), timi = val("wCardioTimi");
    if (!verdict) { st.err = "Enter the KardiQ X verdict."; paint(); return; }
    var recordId = (st.cardiology && st.cardiology.timeline && st.cardiology.timeline.links[0] && st.cardiology.timeline.links[0].kardioxRecordId) || "";
    if (!recordId) { st.err = "Link a KardiQ X record first."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/cardio-ecg", { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId, ecg: {
      kardioxRecordId: recordId, verdict: verdict, heartScore: heart ? Number(heart) : undefined, timiScore: timi ? Number(timi) : undefined,
    } })
      .then(function (r) { if (settle(r, "ECG reference recorded.")) loadCardiology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the ECG reference."; paint(); });
  }
  function radiologyOpen() {
    st.view = "radiology"; st.radiology = null; paint(); loadInvestigations().then(loadRadiology);
  }
  function loadRadiology() {
    if (!st.radiology) st.radiology = {};
    paint();
    var picked = st.radiology.pickedRequestId;
    if (!picked) return Promise.resolve();
    return apiGet("/ward/protocol-context?orgId=" + encodeURIComponent(st.orgId) + "&serviceRequestId=" + encodeURIComponent(picked))
      .then(function (r) { st.radiology.protocol = (r && r.ok) ? r : null; paint(); })
      .catch(function () {});
  }
  function radiologyPick(serviceRequestId) {
    if (!st.radiology) st.radiology = {};
    st.radiology.pickedRequestId = serviceRequestId;
    st.radiology.protocol = null;
    loadRadiology();
  }
  function radiologyProtocolSave() {
    var picked = st.radiology && st.radiology.pickedRequestId; if (!picked) return;
    var protocol = val("wRadProtocol"), contrast = !!(document.getElementById("wRadContrast") || {}).checked;
    if (!protocol) { st.err = "Name the protocol."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/protocol-set", { orgId: st.orgId, serviceRequestId: picked, protocol: protocol, contrast: contrast })
      .then(function (r) { if (settle(r, "Protocol recorded.")) loadRadiology(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the protocol."; paint(); });
  }
  function radiologyReportSave() {
    var s = st.sel, picked = st.radiology && st.radiology.pickedRequestId; if (!s || !picked) return;
    var modality = val("wRadModality"), status = val("wRadStatus"), findings = val("wRadFindings"), impression = val("wRadImpression");
    var critical = !!(document.getElementById("wRadCritical") || {}).checked;
    if (!findings) { st.err = "Say what was seen; the impression may follow."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/report-imaging", { orgId: st.orgId, serviceRequestId: picked, modality: modality || undefined, status: status || "preliminary", findings: findings, impression: impression || undefined, critical: critical })
      .then(function (r) {
        if (r && r.error === "impression_required") { st.busy = false; st.err = "A final report needs an impression; release it as preliminary if it is not ready."; paint(); return; }
        if (r && r.discrepancy) { st.busy = false; st.note = "Released. The impression changed from a reading that may already have been acted on - flagged as a discrepancy on the record."; loadInvestigations().then(loadRadiology); return; }
        if (settle(r, r && r.critical ? "Released. Critical finding - a closed loop was opened." : "Released.")) loadInvestigations().then(loadRadiology);
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not release the report."; paint(); });
  }
  function pharmacyOpen() {
    st.view = "pharmacy"; st.pharmacy = null; paint(); loadPharmacy();
  }
  function loadPharmacy() {
    var s = st.sel; if (!s) return Promise.resolve();
    if (!st.pharmacy) st.pharmacy = {};
    st.pharmacy.explain = null;
    return Promise.all([
      apiGet("/ward/verification-queue?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)),
      apiGet("/ward/dispenses?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)),
    ]).then(function (rs) {
      st.pharmacy.queue = (rs[0] && rs[0].ok) ? rs[0] : null;
      st.pharmacy.dispenses = (rs[1] && rs[1].ok) ? rs[1].dispenses : [];
      paint();
    }).catch(function () { paint(); });
  }
  function pharmacyPick(orderId) {
    if (!st.pharmacy) st.pharmacy = {};
    st.pharmacy.pickedOrderId = orderId;
    /* An explanation is about ONE order. Picking another must not leave the previous order's words
     * sitting under a different drug's findings. */
    st.pharmacy.explain = null;
    paint();
  }
  function pharmacyVerify(outcome) {
    var s = st.sel, picked = st.pharmacy && st.pharmacy.pickedOrderId; if (!s || !picked) return;
    var reason = val("wPhReason");
    if (outcome === "queried" && !reason) { st.err = "Say what the query is, so the ward can act on it."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/verify-order", { orgId: st.orgId, orderId: picked, outcome: outcome, reason: reason || undefined })
      .then(function (r) {
        if (r && r.error === "reason_required") { st.busy = false; st.err = "Say what the query is, so the ward can act on it."; paint(); return; }
        if (settle(r, outcome === "verified" ? "Verified." : "Queried.")) loadPharmacy(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the verification."; paint(); });
  }
  function pharmacyDispense() {
    var s = st.sel, picked = st.pharmacy && st.pharmacy.pickedOrderId; if (!s || !picked) return;
    var qty = val("wPhQty"), unit = val("wPhUnit"), batch = val("wPhBatch"), expiry = val("wPhExpiry"), dest = val("wPhDest");
    if (!qty || !unit) { st.err = "A dispense needs a positive quantity and a unit."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/dispense", { orgId: st.orgId, orderId: picked, quantity: { value: Number(qty), unit: unit }, batch: batch || undefined, expiry: expiry || undefined, destination: dest || undefined })
      .then(function (r) {
        if (r && r.error === "quantity_required") { st.busy = false; st.err = "A dispense needs a positive quantity and a unit."; paint(); return; }
        var msg = "Dispensed.";
        if (r && r.expiryWarning) msg = "Dispensed. " + r.expiryWarning;
        if (r && r.warning) msg = "Dispensed. " + r.warning;
        if (settle(r, msg)) loadPharmacy(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the dispense."; paint(); });
  }
  /* TASK 8.9. The order is the one PICKED on this screen, so an explanation can only ever be about
   * the verdict the pharmacist is looking at. A refusal is kept verbatim rather than flattened: the
   * server's own sentence is the one that says which check did not run. */
  function maikExplainVerdict() {
    var picked = st.pharmacy && st.pharmacy.pickedOrderId; if (!picked) return;
    st.pharmacy.explain = { orderId: picked, busy: true, err: "" }; paint();
    apiPost("/ward/maik-explain-safety", { orgId: st.orgId, orderId: picked })
      .then(function (r) {
        if (!r || r.ok !== true) {
          st.pharmacy.explain = { orderId: picked, busy: false, err: (r && (r.detail || r.error)) || "MaiK could not be reached." };
        } else {
          st.pharmacy.explain = { orderId: picked, busy: false, err: "", explanation: r.explanation,
            deterministic: r.deterministic, withheld: r.withheld, note: r.note, interaction: r.interaction };
        }
        paint();
      })
      .catch(function () { st.pharmacy.explain = { orderId: picked, busy: false, err: "MaiK could not be reached." }; paint(); });
  }
  function maikExplainReview(decision) {
    var ex = st.pharmacy && st.pharmacy.explain, i = ex && ex.interaction; if (!i) return;
    var reason = decision === "rejected" ? window.prompt("Why was this explanation not helpful?") : "";
    if (decision === "rejected" && !String(reason || "").trim()) { st.err = "A rejection needs a reason."; paint(); return; }
    apiPost("/ward/maik-review", { orgId: st.orgId, interactionId: i.id, decision: decision, reason: reason || undefined })
      .then(function (r) { if (r && r.ok && r.interaction) ex.interaction = r.interaction; paint(); })
      .catch(function () { st.err = "Could not record that."; paint(); });
  }
  function inventoryOpen() {
    st.view = "inventory"; st.inventory = null; paint(); loadInventory();
  }
  /* MAIK, the controller (TASK 8.5). Every call names the patient the chart is open on - never a
   * patient id from anywhere else - so the screen cannot ask about somebody other than the person a
   * clinician is looking at. */
  function maikAsk(task) {
    var sel = st.sel; if (!sel) return;
    st.maik = { busy: true, interaction: null, err: "" }; paint();
    apiPost("/ward/maik-ask", { orgId: st.orgId, patientId: sel.patientId, encounterId: sel.encounterId || undefined, task: task })
      .then(function (r) {
        st.maik.busy = false;
        if (r && r.ok) { st.maik.interaction = r.interaction; st.maik.err = ""; }
        /* The server's own sentence, verbatim. "MaiK is not enabled" and "this hospital has approved
         * no model provider" are different facts and a clinician acts on them differently; flattening
         * both into "AI unavailable" would hide which one it is. */
        else st.maik.err = (r && (r.detail || r.message || r.error)) || "MaiK could not be reached.";
        paint();
      })
      .catch(function () { st.maik.busy = false; st.maik.err = "Could not reach MaiK."; paint(); });
  }
  function maikReview(decision) {
    var m = st.maik || {}; if (!m.interaction) return;
    var body = { orgId: st.orgId, interactionId: m.interaction.id, decision: decision };
    if (decision === "rejected") {
      var why = ""; try { why = G.prompt("Why are you rejecting this? A model that is regularly wrong is only visible if the reasons are kept.") || ""; } catch (e) {}
      if (!why.trim() || why.trim().length < 5) { st.maik.err = "A rejection needs a reason."; paint(); return; }
      body.reason = why.trim();
    }
    if (decision === "edited") {
      var text = val("wMaikEdit");
      if (!text) { st.maik.err = "An edit is the text you are keeping; it cannot be empty."; paint(); return; }
      body.editedOutput = text;
    }
    st.maik.busy = true; paint();
    apiPost("/ward/maik-review", body)
      .then(function (r) {
        st.maik.busy = false; st.maik.editing = false;
        if (r && r.ok) { st.maik.interaction = r.interaction; st.maik.err = ""; }
        else st.maik.err = (r && (r.detail || r.message || r.error)) || "That decision could not be recorded.";
        paint();
      })
      .catch(function () { st.maik.busy = false; st.maik.err = "Could not record that decision."; paint(); });
  }

  function critsBoardOpen() {
    st.view = "critsboard"; st.critsBoard = []; paint(); loadCritsBoard();
  }
  /* TASK 7.10, the integration console. Four independent reads, and a failure in ANY of them is
   * recorded by name rather than left as an empty list: on this screen "nothing held" and "could not
   * tell" are the two answers that must never look the same, because one of them means a result is
   * sitting undelivered and nobody knows. */
  function integrationOpen() { st.view = "integration"; st.integration = { errors: [] }; paint(); loadIntegration(); }
  function loadIntegration() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId);
    var out = { errors: [] };
    var read = function (name, path, key) {
      return apiGet(path + "?" + q)
        .then(function (r) { if (r && r.ok) out[key] = r; else out.errors.push(name); })
        .catch(function () { out.errors.push(name); });
    };
    return Promise.all([
      read("held messages", "/ward/fhir-exceptions", "exceptions"),
      read("grants", "/ward/source-grants", "grants"),
      read("destinations", "/ward/outbound-destinations", "destinations"),
      read("outbound", "/ward/outbound", "outbound"),
    ]).then(function () { st.busy = false; st.integration = out; paint(); });
  }
  function dispatchOutbound() {
    st.busy = true; paint();
    apiPost("/ward/outbound-dispatch", { orgId: st.orgId })
      // The server's own count, never "sent". A delivery is only delivered when the far end says so.
      .then(function (r) { if (settle(r, r && r.ok ? (r.attempted || 0) + " deliver" + ((r.attempted || 0) === 1 ? "y" : "ies") + " attempted." : null)) loadIntegration(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not reach the outbound queue."; paint(); });
  }
  function replayDelivery(id) {
    if (!id) return;
    var why = ""; try { why = G.prompt("Why is this being sent again?") || ""; } catch (e) {}
    if (!why.trim() || why.trim().length < 5) { st.err = "Sending a stopped delivery again is a decision, and it needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/outbound-replay", { orgId: st.orgId, deliveryId: id, reason: why.trim() })
      .then(function (r) { if (settle(r, "Queued to send again.")) loadIntegration(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not re-queue that delivery."; paint(); });
  }
  function revokeDestination(name) {
    if (!name) return;
    var why = ""; try { why = G.prompt("Why is this destination being stopped?") || ""; } catch (e) {}
    if (!why.trim() || why.trim().length < 5) { st.err = "Stopping a destination needs a reason: it stops what is already queued for it."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/outbound-destination-revoke", { orgId: st.orgId, name: name, reason: why.trim() })
      .then(function (r) { if (settle(r, "Stopped.")) loadIntegration(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not stop that destination."; paint(); });
  }
  function revokeSource(arg) {
    var parts = String(arg || "").split("|"), system = parts[0], actorId = parts[1] || "";
    if (!system) return;
    var why = ""; try { why = G.prompt("Why is this system's authorisation being withdrawn?") || ""; } catch (e) {}
    if (!why.trim() || why.trim().length < 5) { st.err = "Withdrawing an authorisation needs a reason. The next message from that system will be refused."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/source-revoke", { orgId: st.orgId, sourceSystem: system, actorId: actorId, reason: why.trim() })
      .then(function (r) { if (settle(r, "Withdrawn.")) loadIntegration(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not withdraw that authorisation."; paint(); });
  }
  function loadCritsBoard() {
    return apiGet("/ward/criticals?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.critsBoard = (r && r.ok && r.loops) || []; paint(); })
      .catch(function () { paint(); });
  }
  function acknowledgeBoard(loopId) {
    var why = ""; try { why = G.prompt("What did you do about this result?") || ""; } catch (e) {}
    if (!why.trim()) { st.err = "An acknowledgement records what was done. It needs a sentence."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/acknowledge", { orgId: st.orgId, loopId: loopId, action: why.trim() })
      .then(function (r) { if (settle(r, "Acknowledged.")) loadCritsBoard(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the acknowledgement."; paint(); });
  }
  function cashierOpen() {
    st.view = "cashier"; st.cashier = {}; paint();
  }
  function cashLookup() {
    var mrn = val("wCashMrn");
    if (!mrn) { st.cashier.err = "Enter an MRN."; paint(); return; }
    st.cashier.mrn = mrn; st.cashier.err = ""; st.busy = true; paint();
    // The same deterministic patientId every other ward flow derives from an MRN - never guessed,
    // never a second identity scheme.
    var patientId = "opd-pat-" + mrn.toLowerCase();
    apiGet("/patient/get?orgId=" + encodeURIComponent(st.orgId) + "&mrn=" + encodeURIComponent(mrn))
      .then(function (r) {
        st.busy = false;
        if (!r || !r.ok || !r.patient) { st.cashier.err = "No patient found with that MRN."; st.cashier.patientId = null; paint(); return; }
        st.cashier.patientId = patientId; st.cashier.patientName = r.patient.name || null;
        loadCashier();
      })
      .catch(function () { st.busy = false; st.cashier.err = "Could not look up that MRN."; paint(); });
  }
  function loadCashier() {
    if (!st.cashier || !st.cashier.patientId) return;
    return apiGet("/ward/invoices?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.cashier.patientId))
      .then(function (r) {
        st.cashier.invoices = (r && r.ok && r.invoices) || [];
        st.cashier.outstandingBalance = r && r.ok ? r.outstandingBalance : null;
        paint();
      })
      .catch(function () { paint(); });
  }
  function cashRaise() {
    if (!st.cashier || !st.cashier.patientId) return;
    st.cashier.err = ""; st.busy = true; paint();
    apiPost("/ward/invoice", { orgId: st.orgId, patientId: st.cashier.patientId })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadCashier(); return; }
        st.cashier.err = (r && (r.detail || r.error)) || "Could not raise an invoice.";
        paint();
      })
      .catch(function () { st.busy = false; st.cashier.err = "Could not reach the server."; paint(); });
  }
  var CASH_ACTION_ROUTE = { pay: "invoice-payment", deposit: "invoice-deposit", discount: "invoice-discount", refund: "invoice-refund", adjust: "invoice-adjustment", writeoff: "invoice-writeoff" };
  function cashPost(invoiceId, kind) {
    var amount = val("wCashAmount"), reason = val("wCashReason"), reference = val("wCashReference");
    if (!amount || Number(amount) <= 0) { st.cashier.err = "Enter a positive amount."; paint(); return; }
    var route = CASH_ACTION_ROUTE[kind];
    st.cashier.err = ""; st.busy = true; paint();
    apiPost("/ward/" + route, { orgId: st.orgId, invoiceId: invoiceId, amount: Number(amount), reason: reason || undefined, reference: reference || undefined })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadCashier(); return; }
        st.cashier.err = (r && (r.detail || r.error)) || "Could not post that.";
        paint();
      })
      .catch(function () { st.busy = false; st.cashier.err = "Could not reach the server."; paint(); });
  }
  function schedulingOpen() {
    st.view = "scheduling"; st.scheduling = {}; paint(); loadScheduling();
  }
  function loadScheduling() {
    if (!st.scheduling) st.scheduling = {};
    var sc = st.scheduling;
    var clinicianId = sc.clinicianId || val("wSchedClinician") || "";
    sc.clinicianId = clinicianId;
    return Promise.all([
      apiGet("/ward/diary?orgId=" + encodeURIComponent(st.orgId) + (clinicianId ? "&clinicianId=" + encodeURIComponent(clinicianId) : "")),
      apiGet("/ward/resource-schedule?orgId=" + encodeURIComponent(st.orgId)),
      apiGet("/ward/blackouts?orgId=" + encodeURIComponent(st.orgId)),
    ]).then(function (r) {
      sc.diary = (r[0] && r[0].ok) ? r[0] : null;
      sc.resources = (r[1] && r[1].ok) ? r[1] : null;
      sc.blackouts = (r[2] && r[2].ok && r[2].blackouts) || [];
      paint();
    }).catch(function () { paint(); });
  }
  function apptBookOrOverbook(overbook) {
    var clinicianId = val("wSchedClinician"), patientId = val("wSchedPatient"), startAt = val("wSchedStart"), minutes = val("wSchedMinutes"), reason = val("wSchedReason");
    if (!clinicianId || !patientId || !startAt || !minutes) { st.scheduling.err = "A clinician, a patient, a start time and a length are all required."; paint(); return; }
    st.scheduling.err = ""; st.busy = true; paint();
    apiPost("/ward/book", { orgId: st.orgId, clinicianId: clinicianId, patientId: patientId, startAt: startAt, minutes: Number(minutes), reason: reason || undefined, overbook: !!overbook, overbookReason: overbook ? (reason || "Overbooked at the desk's request") : undefined })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadScheduling(); return; }
        st.scheduling.err = r && (r.detail || r.error) || "Could not book that slot.";
        paint();
      })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function apptSetState(appointmentId, state) {
    var reason = ""; try { reason = G.prompt("Reason (" + state + "):") || ""; } catch (e) {}
    if (!reason.trim()) { st.scheduling.err = "A reason is required."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/appointment", { orgId: st.orgId, appointmentId: appointmentId, state: state, reason: reason.trim() })
      .then(function (r) { st.busy = false; if (r && r.ok) loadScheduling(); else { st.scheduling.err = (r && r.detail) || "Could not update that appointment."; paint(); } })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function resBook() {
    var resourceId = val("wResId"), startAt = val("wResStart"), minutes = val("wResMinutes"), purpose = val("wResPurpose");
    if (!resourceId || !startAt || !minutes) { st.scheduling.err = "A resource, a start time and a length are all required."; paint(); return; }
    st.scheduling.err = ""; st.busy = true; paint();
    apiPost("/ward/book-resource", { orgId: st.orgId, resourceId: resourceId, startAt: startAt, minutes: Number(minutes), purpose: purpose || undefined })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadScheduling(); return; }
        st.scheduling.err = r && (r.detail || r.error) || "Could not book that resource.";
        paint();
      })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function resCancel(bookingId) {
    var reason = ""; try { reason = G.prompt("Reason for cancelling:") || ""; } catch (e) {}
    if (!reason.trim()) { st.scheduling.err = "A reason is required."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/resource-state", { orgId: st.orgId, bookingId: bookingId, state: "cancelled", reason: reason.trim() })
      .then(function (r) { st.busy = false; if (r && r.ok) loadScheduling(); else { st.scheduling.err = (r && r.detail) || "Could not cancel that booking."; paint(); } })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function blackoutAdd() {
    var clinicianId = val("wBoClinician"), resourceId = val("wBoResource"), from = val("wBoFrom"), to = val("wBoTo"), reason = val("wBoReason");
    if ((!clinicianId && !resourceId) || (clinicianId && resourceId)) { st.scheduling.err = "Name exactly one clinician or one resource."; paint(); return; }
    if (!from || !to || !reason) { st.scheduling.err = "A start, an end and a reason are all required."; paint(); return; }
    st.scheduling.err = ""; st.busy = true; paint();
    apiPost("/ward/block-period", { orgId: st.orgId, clinicianId: clinicianId || undefined, resourceId: resourceId || undefined, from: from, to: to, reason: reason })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadScheduling(); return; }
        st.scheduling.err = r && (r.detail || r.error) || "Could not block that period.";
        paint();
      })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function blackoutCancel(blackoutId) {
    st.busy = true; paint();
    apiPost("/ward/cancel-blackout", { orgId: st.orgId, blackoutId: blackoutId })
      .then(function (r) { st.busy = false; if (r && r.ok) loadScheduling(); else { st.scheduling.err = (r && r.detail) || "Could not unblock that period."; paint(); } })
      .catch(function () { st.busy = false; st.scheduling.err = "Could not reach the server."; paint(); });
  }
  function twinOpen() {
    st.view = "twin"; st.twin = {}; paint(); loadTwin();
  }
  function loadTwin() {
    if (!st.twin) st.twin = {};
    st.twin.copilot = null; st.twin.sim = null;
    return apiGet("/ward/twin?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.twin.snapshot = (r && r.ok && r.twin) || null;
        st.twin.err = (r && !r.ok) ? (r.detail || r.error) : "";
        st.twin.loaded = true; paint();
      })
      .catch(function () { st.twin.loaded = true; st.twin.err = "Could not reach the hospital snapshot."; paint(); });
  }
  function twinAsk() {
    var q = window.prompt("Ask MaiK about this hospital's current state:");
    if (!q) return;
    st.twin.copilot = { busy: true }; paint();
    apiPost("/ward/twin-copilot", { orgId: st.orgId, question: q })
      .then(function (r) {
        if (!r || r.ok !== true) { st.twin.copilot = { busy: false, err: (r && (r.detail || r.error)) || "MaiK could not be reached." }; paint(); return; }
        st.twin.copilot = { busy: false, answered: r.answered, answer: r.answer, note: r.note, interaction: r.interaction };
        paint();
      })
      .catch(function () { st.twin.copilot = { busy: false, err: "MaiK could not be reached." }; paint(); });
  }
  function twinCopilotReview(decision) {
    var c = st.twin && st.twin.copilot, i = c && c.interaction; if (!i) return;
    var reason = decision === "rejected" ? window.prompt("Why was this not helpful?") : "";
    if (decision === "rejected" && !String(reason || "").trim()) { st.err = "A rejection needs a reason."; paint(); return; }
    apiPost("/ward/twin-review", { orgId: st.orgId, interactionId: i.id, decision: decision, reason: reason || undefined })
      .then(function (r) { if (r && r.ok && r.interaction) c.interaction = r.interaction; paint(); })
      .catch(function () { st.err = "Could not record that."; paint(); });
  }
  function twinSimulate(scenario) {
    st.twin.sim = { busy: true }; paint();
    apiPost("/ward/twin-simulate", { orgId: st.orgId, scenario: scenario, params: scenario === "extra-admissions" ? { extraAdmissions: 10 } : { removedBeds: 5 } })
      .then(function (r) { st.twin.sim = r; paint(); })
      .catch(function () { st.twin.sim = { ok: false, error: "Could not run the simulation." }; paint(); });
  }
  function flowCommandOpen() {
    st.view = "flowcommand"; st.flow = {}; paint(); loadFlowCommand();
  }
  function loadFlowCommand() {
    if (!st.flow) st.flow = {};
    return apiGet("/ward/patient-flow?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.flow.flow = (r && r.ok && r.flow) || null; st.flow.loaded = true; paint(); })
      .catch(function () { st.flow.loaded = true; paint(); });
  }
  function bedMgmtOpen() {
    st.view = "bedmgmt"; st.bedMgmt = {}; paint(); loadBedMgmt();
  }
  function loadBedMgmt() {
    if (!st.bedMgmt) st.bedMgmt = {};
    return Promise.all([
      apiGet("/wards?orgId=" + encodeURIComponent(st.orgId)),
      apiGet("/beds?orgId=" + encodeURIComponent(st.orgId)),
    ]).then(function (r) {
      var wr = r[0], br = r[1];
      var byWard = {};
      ((br && br.beds) || []).forEach(function (b) { (byWard[b.wardId] = byWard[b.wardId] || []).push(b); });
      st.bedMgmt.wards = (wr && wr.wards) || [];
      st.bedMgmt.bedsByWard = byWard;
      st.bedMgmt.loaded = true;
      paint();
    }).catch(function () { st.bedMgmt.loaded = true; paint(); });
  }
  function bedStateApply(bedId) {
    var sel = document.querySelector('[data-bed-state="' + bedId + '"]');
    var state = sel ? sel.value : "";
    if (!state) return;
    st.bedMgmt.conflict = false; st.busy = true; paint();
    apiPost("/bed/update", { orgId: st.orgId, bedId: bedId, state: state })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadBedMgmt(); return; }
        // TASK 4.3: server-side concurrency. Another change landed first - reload the real state
        // rather than letting this screen keep showing what was true a moment ago.
        if (r && r.error === "bed_changed") { st.bedMgmt.conflict = true; loadBedMgmt(); return; }
        st.err = (r && r.message) || "Could not update that bed."; paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not reach the server."; paint(); });
  }
  function loadInventory() {
    if (!st.inventory) st.inventory = {};
    return apiGet("/ward/stock?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.inventory.stock = (r && r.ok) ? r : null; paint(); })
      .catch(function () { paint(); });
  }
  function stockReceive() {
    var code = val("wStkCode"), qty = val("wStkQty"), unit = val("wStkUnit"), loc = val("wStkLoc"), batch = val("wStkBatch"), expiry = val("wStkExpiry");
    if (!code || !qty || !unit) { st.err = "A receipt needs a drug, a quantity and a unit."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/stock-move", { orgId: st.orgId, kind: "receipt", code: code, quantity: { value: Number(qty), unit: unit }, location: loc || undefined, batch: batch || undefined, expiry: expiry || undefined })
      .then(function (r) {
        if (settle(r, "Receipt recorded.")) { ["wStkCode", "wStkQty", "wStkUnit", "wStkLoc", "wStkBatch", "wStkExpiry"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; }); loadInventory(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the receipt."; paint(); });
  }
  function stockAdjustOrWaste(kind) {
    var code = val("wAdjCode"), qty = val("wAdjQty"), unit = val("wAdjUnit"), loc = val("wAdjLoc"), reason = val("wAdjReason");
    if (!code || !qty || !unit) { st.err = "Fill in the drug, quantity and unit."; paint(); return; }
    if (!reason) { st.err = "An adjustment or wastage needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/stock-move", { orgId: st.orgId, kind: kind, code: code, quantity: { value: Number(qty), unit: unit }, location: loc || undefined, reason: reason })
      .then(function (r) {
        if (r && r.error === "reason_required") { st.busy = false; st.err = "An adjustment or wastage needs a reason."; paint(); return; }
        if (settle(r, kind === "wastage" ? "Wastage recorded." : "Adjustment recorded.")) { ["wAdjCode", "wAdjQty", "wAdjUnit", "wAdjLoc", "wAdjReason"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; }); loadInventory(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the movement."; paint(); });
  }
  function stockReconcile() {
    var code = val("wRecCode"), unit = val("wRecUnit"), loc = val("wRecLoc"), counted = val("wRecCounted"), reason = val("wRecReason");
    if (!code || !unit || counted === "") { st.err = "A reconciliation needs a drug, a unit and the counted quantity."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/stock-reconcile", { orgId: st.orgId, code: code, unit: unit, location: loc || undefined, counted: Number(counted), reason: reason || undefined })
      .then(function (r) {
        if (r && r.error === "counted_required") { st.busy = false; st.err = "Enter the number actually counted."; paint(); return; }
        var msg = r && r.skipped === "no_variance" ? "The count matches the record. Nothing was posted." : (r && r.reason) || "Reconciled.";
        if (settle(r, msg)) { ["wRecCode", "wRecUnit", "wRecLoc", "wRecCounted", "wRecReason"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; }); loadInventory(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not reconcile."; paint(); });
  }
  function txOpen() {
    st.view = "transfusion"; st.transfusion = null; paint(); loadTransfusion();
  }
  function loadTransfusion() {
    var s = st.sel; if (!s) return Promise.resolve();
    if (!st.transfusion) st.transfusion = {};
    return apiGet("/ward/transfusion-queue?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.transfusion.queue = (r && r.ok) ? r : null; paint(); })
      .catch(function () { paint(); });
  }
  function txPick(episodeId) {
    if (!st.transfusion) st.transfusion = {};
    st.transfusion.pickedEpisodeId = episodeId;
    paint();
  }
  function txRequest() {
    var s = st.sel; if (!s) return;
    var component = val("wTxComponent"), units = val("wTxUnits"), indication = val("wTxIndication");
    st.busy = true; paint();
    apiPost("/ward/transfusion-request", { orgId: st.orgId, patientId: s.patientId, mrn: s.mrn, encounterId: s.encounterId, component: component, units: units ? Number(units) : 1, indication: indication || undefined })
      .then(function (r) { if (settle(r, "Requested.")) { st.transfusion.pickedEpisodeId = r.episodeId; loadTransfusion(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the request."; paint(); });
  }
  function txCrossmatch() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    var unitId = val("wTxUnitId"), abo = val("wTxUnitAbo"), rh = val("wTxUnitRh"), expiry = val("wTxUnitExpiry");
    if (!unitId) { st.err = "Enter the unit id."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/transfusion-crossmatch", { orgId: st.orgId, episodeId: picked, unitId: unitId, aboGroup: abo, rhD: rh, component: (st.transfusion.queue.episodes.filter(function (e) { return e.episodeId === picked; })[0] || {}).component, expiresAt: expiry || undefined })
      .then(function (r) {
        if (r && r.error === "transfusion_refused") { st.busy = false; st.err = r.detail; paint(); return; }
        if (settle(r, "Crossmatched.")) loadTransfusion(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the crossmatch."; paint(); });
  }
  function txIssue() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    st.busy = true; paint();
    apiPost("/ward/transfusion-issue", { orgId: st.orgId, episodeId: picked })
      .then(function (r) { if (settle(r, "Issued.")) loadTransfusion(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not issue the unit."; paint(); });
  }
  function txBedsideCheck() {
    var s = st.sel, picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!s || !picked) return;
    var checker1 = val("wTxChecker1"), checker2 = val("wTxChecker2"), scanPatient = val("wTxScanPatient"), scanUnit = val("wTxScanUnit");
    if (!checker1 || !checker2 || !scanPatient || !scanUnit) { st.err = "NO ONE-CLICK TRANSFUSE: both checkers and both scans are required."; paint(); return; }
    var ep = (st.transfusion.queue.episodes || []).filter(function (e) { return e.episodeId === picked; })[0];
    var crossUnit = ep && ep.crossmatch ? { unitId: ep.crossmatch.unitId, aboGroup: ep.crossmatch.aboGroup, rhD: ep.crossmatch.rhD, component: ep.crossmatch.component } : null;
    st.busy = true; paint();
    apiPost("/ward/transfusion-bedside-check", {
      orgId: st.orgId, episodeId: picked, checkerId: checker1, secondCheckerId: checker2,
      scannedPatientBarcode: scanPatient, scannedUnitId: scanUnit,
      patient: { id: s.patientId, mrn: s.mrn, wristbandBarcode: s.mrn },
      unitInHand: crossUnit ? Object.assign({}, crossUnit, { unitId: scanUnit }) : { unitId: scanUnit },
    })
      .then(function (r) {
        if (r && r.error === "transfusion_refused") { st.busy = false; st.err = r.detail; paint(); return; }
        if (settle(r, "Bedside check passed.")) loadTransfusion(); else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the bedside check."; paint(); });
  }
  function txStart() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    st.busy = true; paint();
    apiPost("/ward/transfusion-start", { orgId: st.orgId, episodeId: picked })
      .then(function (r) { if (settle(r, "Started.")) loadTransfusion(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not start the transfusion."; paint(); });
  }
  function txObserve() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    var pulse = val("wTxPulse"), temp = val("wTxTemp"), sbp = val("wTxSbp");
    var vitals = {};
    if (pulse) vitals.pulse = Number(pulse);
    // Always stated, never inferred: the unit the box was labelled with is the unit that is stored.
    if (temp) { vitals.temp = Number(temp); vitals.tempUnit = st.region === "US" ? "F" : "C"; }
    if (sbp) vitals.sbp = Number(sbp);
    st.busy = true; paint();
    apiPost("/ward/transfusion-observe", { orgId: st.orgId, episodeId: picked, vitals: vitals })
      .then(function (r) { if (settle(r, "Recorded.")) loadTransfusion(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the observation."; paint(); });
  }
  function txComplete() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    st.busy = true; paint();
    apiPost("/ward/transfusion-complete", { orgId: st.orgId, episodeId: picked })
      .then(function (r) { if (settle(r, "Completed.")) loadTransfusion(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not complete the transfusion."; paint(); });
  }
  function txReaction() {
    var picked = st.transfusion && st.transfusion.pickedEpisodeId; if (!picked) return;
    var detail = ""; try { detail = G.prompt("Describe the reaction:") || ""; } catch (e) {}
    if (!detail.trim()) return;
    st.busy = true; paint();
    apiPost("/ward/transfusion-reaction", { orgId: st.orgId, episodeId: picked, detail: detail.trim() })
      .then(function (r) { if (settle(r, "STOPPED. Reaction recorded.")) loadTransfusion(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the reaction."; paint(); });
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
    var ward = "", bed = "", override = false;
    var emergencyActive = st.emergency && (st.emergency.active || []).some(function (a) { return (a.relaxations || []).indexOf("bed-assignment-conflict-override") >= 0; });
    try {
      ward = G.prompt("Transfer to which ward?", s.ward || "") || "";
      if (!ward.trim()) return;
      bed = G.prompt("Which bed? (leave blank if awaiting one)", "") || "";
      if (emergencyActive && bed.trim()) {
        override = /^y/i.test(G.prompt("A declared emergency permits admitting past a blocked/cleaning/maintenance/reserved bed. Use that here? (y/N)", "") || "");
      }
    } catch (e) { return; }
    st.busy = true; paint();
    apiPost("/ward/transfer", { orgId: st.orgId, encounterId: s.encounterId, ward: ward.trim(), bed: bed.trim(), emergencyOverride: override })
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
  /* TASK 3.1: collecting the sample the phlebotomist has actually just taken. Specimen type is
   * asked for plainly (nothing here guesses a tube from the test name), and the wristband scan is
   * asked for as a real safeguard, not a formality - the server refuses the collection outright if
   * it does not match the order's own patient (wrong-patient collection blocked). */
  function collectSpecimen(serviceRequestId) {
    var specimenType = "", scanned = "";
    try {
      specimenType = G.prompt("Specimen type (e.g. Whole blood, Serum, Urine):") || "";
      if (!specimenType.trim()) return;
      scanned = G.prompt("Scan or enter the patient's wristband barcode/MRN, to confirm this is the right patient:") || "";
    } catch (e) { return; }
    st.busy = true; paint();
    apiPost("/ward/collect", { orgId: st.orgId, serviceRequestId: serviceRequestId, specimenType: specimenType.trim(), scannedPatientBarcode: scanned.trim() || undefined })
      .then(function (r) {
        if (r && r.error === "wrong_patient_scan") { st.busy = false; st.err = "The scanned wristband does not match this patient's order. Nothing was collected."; paint(); return; }
        if (settle(r, r && r.accessionNumber ? "Collected. Accession " + r.accessionNumber + "." : "Collected.")) loadInvestigations();
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the collection."; paint(); });
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
  function loadReports() {
    st.busy = true; st.view = "reports"; st.reports = st.reports || {}; paint();
    var q = "?orgId=" + encodeURIComponent(st.orgId);
    return Promise.all([
      apiGet("/ward/report-patient-flow" + q), apiGet("/ward/report-clinical-operations" + q),
      apiGet("/ward/report-billing" + q), apiGet("/ward/report-claims" + q),
      apiGet("/ward/report-pharmacy" + q), apiGet("/ward/report-him" + q),
    ])
      .then(function (rs) {
        st.busy = false;
        st.reports = { patientFlow: rs[0], clinicalOperations: rs[1], billing: rs[2], claims: rs[3], pharmacy: rs[4], him: rs[5] };
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not load the reports."; paint(); });
  }
  function emergencyAdminOpen() {
    st.view = "emergencyadmin"; st.emergencyAdmin = null; st.emergencyReconcile = null; paint(); loadEmergencyLog();
  }
  function loadEmergencyLog() {
    st.busy = true; paint();
    return apiGet("/ward/emergency-log?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.emergencyAdmin = r; else { st.emergencyAdmin = { activations: [] }; st.err = "Could not load the emergency log."; } paint(); })
      .catch(function () { st.busy = false; st.emergencyAdmin = { activations: [] }; st.err = "Could not load the emergency log."; paint(); });
  }
  function emergencyDeclareAction() {
    var reason = val("wEmergencyReason");
    var relaxations = val("wEmergencyRelaxations").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var kind = val("wEmergencyKind"), minutesStr = val("wEmergencyMinutes");
    if (reason.length < 10) { st.err = "Say what the emergency is, in your own words - at least 10 characters."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/emergency-declare", { orgId: st.orgId, kind: kind, reason: reason, relaxations: relaxations, minutes: minutesStr ? Number(minutesStr) : undefined })
      .then(function (r) { if (settle(r, "Declared.")) { loadEmergencyLog(); loadEmergencyStatus(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not declare that."; paint(); });
  }
  function emergencyDeactivateAction(activationId) {
    var reason = window.prompt("Reason for standing this emergency down:");
    if (!reason) return;
    st.busy = true; paint();
    apiPost("/ward/emergency-deactivate", { orgId: st.orgId, activationId: activationId, reason: reason })
      .then(function (r) { if (settle(r, "Stood down.")) { loadEmergencyLog(); loadEmergencyStatus(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not stand that down."; paint(); });
  }
  function emergencyReconcileAction(activationId) {
    st.busy = true; paint();
    apiGet("/ward/emergency-reconciliation?orgId=" + encodeURIComponent(st.orgId) + "&activationId=" + encodeURIComponent(activationId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.emergencyReconcile = r; else st.err = (r && r.detail) || "Could not reconcile that."; paint(); })
      .catch(function () { st.busy = false; st.err = "Could not reconcile that."; paint(); });
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
  function consentOpen() {
    st.view = "consent"; st.consent = {}; paint(); loadConsent();
  }
  function loadConsent() {
    if (!st.sel || !st.sel.patientId) return;
    if (!st.consent) st.consent = {};
    return apiGet("/ward/consents?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { if (r && r.ok) { st.consent.consents = r.consents; st.consent.refused = r.refused; } paint(); })
      .catch(function () { paint(); });
  }
  function recordConsentAction() {
    if (!st.sel || !st.sel.patientId) return;
    var scope = val("wConsentScope"), decision = val("wConsentDecision"), detail = val("wConsentDetail");
    if ((scope === "other" || scope === "procedure") && !detail) { st.err = "Say what this is about."; paint(); return; }
    st.consent.scope = scope; st.consent.givenBy = val("wConsentGivenBy"); st.consent.detail = detail;
    var capEl = document.getElementById("wConsentCapacity");
    st.busy = true; paint();
    apiPost("/ward/consent", {
      orgId: st.orgId, patientId: st.sel.patientId, encounterId: st.sel.encounterId, scope: scope, decision: decision,
      detail: detail || undefined, givenBy: st.consent.givenBy, giverName: val("wConsentGiverName") || undefined,
      capacity: capEl ? capEl.checked : true, validUntil: val("wConsentValidUntil") || undefined,
    })
      .then(function (r) { if (settle(r, "Recorded.")) loadConsent(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }
  function withdrawConsentAction(scope, detail) {
    if (!st.sel || !st.sel.patientId) return;
    var reason = window.prompt("Reason for withdrawing this consent:");
    if (!reason) return;
    st.busy = true; paint();
    apiPost("/ward/withdraw-consent", { orgId: st.orgId, patientId: st.sel.patientId, scope: scope, detail: detail || undefined, reason: reason })
      .then(function (r) { if (settle(r, "Withdrawn.")) loadConsent(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not withdraw that."; paint(); });
  }
  function completionOpen() {
    st.view = "completion"; st.completion = null; paint(); loadCompletion();
  }
  function loadCompletion() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    return apiGet("/ward/completion-queue?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.completion = r; else { st.completion = { items: [] }; st.err = "Could not build the chart check."; } paint(); })
      .catch(function () { st.busy = false; st.completion = { items: [] }; st.err = "Could not build the chart check."; paint(); });
  }
  function roiOpen() {
    st.view = "roi"; st.roi = null; paint(); loadRoi();
  }
  function loadRoi() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    return apiGet("/ward/roi-requests?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.roi = r; else { st.roi = { requests: [] }; st.err = "Could not load release requests."; } paint(); })
      .catch(function () { st.busy = false; st.roi = { requests: [] }; st.err = "Could not load release requests."; paint(); });
  }
  function roiRequestAction() {
    if (!st.sel || !st.sel.patientId) return;
    var name = val("wRoiRequesterName"), purpose = val("wRoiPurpose"), recipient = val("wRoiRecipient");
    var types = val("wRoiRecordTypes").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!name || !purpose || !recipient || !types.length) { st.err = "Requester name, purpose, recipient and at least one record type are all required."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/roi-request", {
      orgId: st.orgId, patientId: st.sel.patientId,
      requester: { name: name, organization: val("wRoiOrg") || undefined, relationship: val("wRoiRelationship") },
      purpose: purpose, recipient: recipient, scope: { recordTypes: types },
    })
      .then(function (r) { if (settle(r, "Requested.")) loadRoi(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that request."; paint(); });
  }
  function roiAuthorizeAction(roiId) {
    var basis = window.prompt("Authorization basis (a signed release, a consent on record, a court order):");
    if (!basis) return;
    st.busy = true; paint();
    apiPost("/ward/roi-authorize", { orgId: st.orgId, roiId: roiId, authorizationBasis: basis })
      .then(function (r) { if (settle(r, "Authorized.")) loadRoi(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not authorize that."; paint(); });
  }
  function roiDenyAction(roiId) {
    var reason = window.prompt("Reason for denying this request:");
    if (!reason) return;
    st.busy = true; paint();
    apiPost("/ward/roi-deny", { orgId: st.orgId, roiId: roiId, reason: reason })
      .then(function (r) { if (settle(r, "Denied.")) loadRoi(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not deny that."; paint(); });
  }
  function roiCancelAction(roiId) {
    var reason = window.prompt("Reason for cancelling this authorization:");
    if (!reason) return;
    st.busy = true; paint();
    apiPost("/ward/roi-cancel", { orgId: st.orgId, roiId: roiId, reason: reason })
      .then(function (r) { if (settle(r, "Cancelled.")) loadRoi(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not cancel that."; paint(); });
  }
  function roiFulfillAction(roiId) {
    var deliveredStatus = window.prompt("Delivered how (e.g. emailed, posted, handed to requester)?");
    if (!deliveredStatus) return;
    var countStr = window.prompt("How many records were sent?", "1");
    var count = Number(countStr);
    if (!Number.isFinite(count) || count < 0) { st.err = "Enter a real count of what was sent."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/roi-fulfill", { orgId: st.orgId, roiId: roiId, deliveredStatus: deliveredStatus, resourceCounts: { records: count } })
      .then(function (r) { if (settle(r, "Fulfilled.")) loadRoi(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that fulfillment."; paint(); });
  }
  function billingOpen() {
    st.view = "billing"; st.billing = null; paint(); loadBilling();
  }
  function loadBilling() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    Promise.all([
      apiGet("/ward/invoices?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId)),
      apiGet("/ward/claims?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId)),
    ])
      .then(function (rs) {
        st.busy = false;
        var inv = rs[0], cl = rs[1];
        st.billing = {
          invoices: (inv && inv.ok) ? inv.invoices : [], outstandingBalance: (inv && inv.ok) ? inv.outstandingBalance : null,
          claims: (cl && cl.ok) ? cl.claims : [],
        };
        if (!(inv && inv.ok) && !(cl && cl.ok)) st.err = "Could not load billing.";
        paint();
      })
      .catch(function () { st.busy = false; st.billing = { invoices: [], claims: [] }; st.err = "Could not load billing."; paint(); });
  }
  function tpaOpen() {
    st.view = "tpa"; st.tpa = null; paint(); loadTpa();
  }
  function loadTpa() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    return apiGet("/ward/claims?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.tpa = r; else { st.tpa = { claims: [], preAuthorisations: [] }; st.err = "Could not load claims."; } paint(); })
      .catch(function () { st.busy = false; st.tpa = { claims: [], preAuthorisations: [] }; st.err = "Could not load claims."; paint(); });
  }
  function claimCodeAction() {
    if (!st.sel || !st.sel.patientId || !st.sel.encounterId) return;
    var codes = val("wTpaCodes").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!codes.length) { st.err = "Enter at least one code to claim."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/claim", { orgId: st.orgId, patientId: st.sel.patientId, encounterId: st.sel.encounterId, codes: codes })
      .then(function (r) { if (settle(r, "Coded.")) loadTpa(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not code that claim."; paint(); });
  }
  function claimActionCall(claimId, action, extra) {
    st.busy = true; paint();
    apiPost("/ward/claim-state", Object.assign({ orgId: st.orgId, claimId: claimId, action: action }, extra || {}))
      .then(function (r) { if (settle(r, "Done.")) loadTpa(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not update that claim."; paint(); });
  }
  function claimSubmitAction(claimId) {
    var amount = window.prompt("Amount submitted to the payer:");
    if (amount == null) return;
    claimActionCall(claimId, "submit", { submittedAmount: Number(amount) || undefined });
  }
  function claimDenyAction(claimId) {
    var reason = window.prompt("The payer's reason for denying this claim:");
    if (!reason) return;
    var amount = window.prompt("Amount denied (optional):");
    claimActionCall(claimId, "deny", { reason: reason, deniedAmount: amount ? Number(amount) : undefined });
  }
  function claimAdjudicateAction(claimId) {
    var approved = window.prompt("Amount approved (leave blank if none):");
    var denied = window.prompt("Amount denied (leave blank if none):");
    if (!approved && !denied) { st.err = "An adjudication needs an approved or a denied amount."; paint(); return; }
    claimActionCall(claimId, "adjudicate", { approvedAmount: approved ? Number(approved) : undefined, deniedAmount: denied ? Number(denied) : undefined });
  }
  function claimResubmitAction(claimId) {
    var reason = window.prompt("Reason for resubmitting this claim:");
    if (!reason) return;
    var amount = window.prompt("Amount submitted to the payer:");
    claimActionCall(claimId, "resubmit", { reason: reason, submittedAmount: amount ? Number(amount) : undefined });
  }
  function preAuthAction() {
    if (!st.sel || !st.sel.patientId) return;
    var treatment = val("wTpaTreatment"), state = val("wTpaAuthState"), reason = val("wTpaAuthReason");
    var scheme = val("wTpaScheme"), amountStr = val("wTpaAuthAmount");
    if (!treatment) { st.err = "Enter the treatment this pre-authorisation is for."; paint(); return; }
    if (state === "refused" && !reason) { st.err = "A refused pre-authorisation must say why."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/preauth", {
      orgId: st.orgId, patientId: st.sel.patientId, treatment: treatment, state: state,
      scheme: scheme || undefined, reason: reason || undefined,
      authorizedAmount: amountStr ? Number(amountStr) : undefined,
    })
      .then(function (r) { if (settle(r, "Recorded.")) loadTpa(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that pre-authorisation."; paint(); });
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
  function loadEmergencyStatus() {
    // TASK 4.15: read-only, on every screen, no matter which board a user has open - the plan's own
    // "provide visible status" requirement. This never widens anything itself; a route that wants to
    // honour a named relaxation checks the server's own emergency-mode.js directly.
    return apiGet("/ward/emergency-status?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { if (r && r.ok) st.emergency = r; paint(); })
      .catch(function () { paint(); });
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
    /* THE UNITS THE BOXES WERE LABELLED WITH travel with the values. Without this the server had to
     * infer them, and an inference that disagrees with the label on screen is a false number in a
     * clinical record: 98.6 stored as Celsius, or a pounds weight read as kilograms. */
    if (v.temp) v.tempUnit = st.region === "US" ? "F" : "C";
    if (v.weight) v.weightUnit = st.region === "US" ? "lb" : "kg";
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
            /* THE SCORE PANEL HAS TO RE-READ, OR IT REPORTS THE OBSERVATIONS AS MISSING.
             *
             * Recording vitals repainted from existing client state, so the Flowsheet sitting
             * directly below still said "NEWS2 Incomplete: RespiratoryRate, OxygenSaturation ...
             * were not recorded ... partial total of 0" and "No vitals charted in this window yet"
             * for a set that had just been accepted by the server. Charting RR 24, SpO2 91, pulse
             * 112, temp 38.4 - a NEWS2 of 8 - and being shown a 0 is the deterioration path
             * reporting the opposite of what was charted. Found 2026-09-12 on the live ward.
             * The timeline is re-read too: the dose and the observation belong on it immediately. */
            loadFlowsheet(); loadNews2(); loadChart();
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
    dispatch(b.getAttribute("data-w-act"));
  }
  /* One dispatcher for a click on a data-w-act button AND for the wardsynq.com shell, which opens
   * a hospital-level view directly (open({act:"twin"})) with the SAME verb a click would send. */
  function dispatch(a) {
    var i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "dismiss") { st.err = ""; st.note = ""; st.refusal = null; paint(); return; }
    if (cmd === "reload") { loadWard(); return; }
    if (cmd === "setward") { st.ward = val("wWard"); loadWard(); return; }
    if (cmd === "setcls") { st.cls = arg; var r0 = document.getElementById("wRoster"); if (r0) r0.innerHTML = rosterHtml(st); else paint(); return; }
    if (cmd === "back") {
      /* The patient's copy is opened FROM a chart, so back returns to that chart rather than
       * throwing the selection away - and the copy itself is always dropped, because a page with
       * one patient's diagnoses left on screen is how the next person gets handed the wrong one. */
      if (st.view === "pcopy") { st.view = "chart"; st.pcopy = null; paint(); return; }
      if (st.view === "consent") { st.view = "chart"; st.consent = null; paint(); return; }
      if (st.view === "completion") { st.view = "chart"; st.completion = null; paint(); return; }
      if (st.view === "roi") { st.view = "chart"; st.roi = null; paint(); return; }
      if (st.view === "tpa") { st.view = "chart"; st.tpa = null; paint(); return; }
      if (st.view === "billing") { st.view = "chart"; st.billing = null; paint(); return; }
      if (st.view === "oncology") { st.view = "chart"; st.oncology = null; paint(); return; }
      if (st.view === "cardiology") { st.view = "chart"; st.cardiology = null; paint(); return; }
      if (st.view === "radiology") { st.view = "chart"; st.radiology = null; paint(); return; }
      if (st.view === "pharmacy") { st.view = "chart"; st.pharmacy = null; paint(); return; }
      if (st.view === "transfusion") { st.view = "chart"; st.transfusion = null; paint(); return; }
      if (st.view === "inventory") { st.inventory = null; st.view = "list"; paint(); return; }
      if (st.view === "critsboard") { st.critsBoard = []; st.view = "list"; paint(); return; }
      if (st.view === "timeline") { st.view = "chart"; paint(); return; }
      if (st.view === "labboard") { st.labBoard = null; st.view = "list"; paint(); return; }
      if (st.view === "radboard") { st.radBoard = null; st.view = "list"; paint(); return; }
      if (st.view === "integration") { st.integration = null; st.view = "list"; paint(); return; }
      if (st.view === "bedmgmt") { st.bedMgmt = {}; st.view = "list"; paint(); return; }
      if (st.view === "flowcommand") { st.flow = {}; st.view = "list"; paint(); return; }
      if (st.view === "twin") { st.twin = {}; st.view = "list"; paint(); return; }
      if (st.view === "scheduling") { st.scheduling = {}; st.view = "list"; paint(); return; }
      if (st.view === "cashier") { st.cashier = {}; st.view = "list"; paint(); return; }
      if (st.view === "reports") { st.reports = {}; st.view = "list"; paint(); return; }
      if (st.view === "emergencyadmin") { st.emergencyAdmin = null; st.emergencyReconcile = null; st.view = "list"; paint(); return; }
      // Picking a bed to admit an ED patient opens the SAME bed board a fresh admission uses;
      // backing out of it returns to that patient's ED chart, not the ward list, and drops the
      // pending admit rather than leaving it to fire on some later, unrelated bed pick.
      if (st.view === "board" && st.edAdmitPending) { st.edAdmitPending = false; st.board = null; st.admitTarget = null; st.view = "chart"; paint(); return; }
      // A case's own chart backs out to the theatre board, not the ward list - the same reason the
      // ED chart backs out to the ED board rather than to an unrelated ward roster.
      if (st.view === "surgerycase") { st.surgCase = null; loadSurgeryBoard(); return; }
      st.view = "list"; st.sel = null; st.due = []; st.problems = []; st.outbox = []; st.downtime = null; st.pcopy = null;
      st.board = null; st.admitTarget = null; st.mrnLookup = null; st.mrnLookupErr = ""; st.edAdmitPending = false;
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.resusBundles = null;
      st.ed = null; st.edArrivalOpen = false; st.edMrnLookup = null; st.edMrnLookupErr = "";
      st.surgBoard = null; st.surgCase = null; st.surgBookOpen = false; st.surgMrnLookup = null; st.surgMrnLookupErr = ""; st.surgErr = "";
      st.maternity = null; st.admitClass = ""; st.emergencyOverride = false; st.ageBand = null; st.lines = null; st.rateResult = null; st.oncology = null; st.cardiology = null; st.radiology = null; st.pharmacy = null; st.transfusion = null; st.consent = null; st.completion = null; st.roi = null; st.tpa = null; st.billing = null;
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
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.timeline = null; st.activeMeds = null;
      st.err = ""; st.note = ""; st.refusal = null; st.devices = null; st.maternity = null; st.ageBand = null; st.lines = null; st.rateResult = null; st.oncology = null; st.cardiology = null; st.radiology = null; st.pharmacy = null; st.transfusion = null;
      /* TASK 8.5: MaiK is cleared with the rest of the chart. An answer about the previous patient
       * left on screen beside a new patient's observations is the wrong-patient error with extra
       * steps, and it is the one this panel could most easily cause. */
      st.maik = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations();
      if (p.class === "ICU") loadDevices();
      if (p.class === "MATERNITY") loadMaternity();
      if (p.class === "PEDIATRICS" || p.class === "NICU") loadAgeBand();
      if (p.class === "NICU") loadLines();
      return;
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
      /* MaiK's panel is cleared when the chart changes. An answer about the previous patient left on
       * screen beside a new patient's observations is the wrong-patient error with extra steps. */
      st.maik = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations(); loadResus(); return;
    }
    if (cmd === "edboard") { loadEd(); return; }
    if (cmd === "inventoryboard") { inventoryOpen(); return; }
    if (cmd === "inventoryload") { loadInventory(); return; }
    if (cmd === "maikask") { maikAsk(arg); return; }
    if (cmd === "maikreview") { maikReview(arg); return; }
    if (cmd === "maikedit") { st.maik.editing = true; paint(); return; }
    if (cmd === "maikclear") { st.maik = null; paint(); return; }
    if (cmd === "integration") { integrationOpen(); return; }
    if (cmd === "intload") { loadIntegration(); return; }
    if (cmd === "outdispatch") { dispatchOutbound(); return; }
    if (cmd === "outreplay") { replayDelivery(arg); return; }
    if (cmd === "destrevoke") { revokeDestination(arg); return; }
    if (cmd === "srcrevoke") { revokeSource(arg); return; }
    if (cmd === "critsboard") { critsBoardOpen(); return; }
    if (cmd === "critsboardload") { loadCritsBoard(); return; }
    if (cmd === "timeline") { timelineOpen(); return; }
    if (cmd === "timelineload") { loadChart(); return; }
    if (cmd === "timelinenote") { timelineNoteSave(); return; }
    if (cmd === "labboard") { labBoardOpen(); return; }
    if (cmd === "labboardload") { loadLabBoard(); return; }
    if (cmd === "radboard") { radBoardOpen(); return; }
    if (cmd === "radboardload") { loadRadBoard(); return; }
    if (cmd === "radboardpick") { radBoardPick(arg); return; }
    if (cmd === "radboardreportsave") { radBoardReportSave(); return; }
    if (cmd === "ackboard") { acknowledgeBoard(arg); return; }
    if (cmd === "bedmgmt") { bedMgmtOpen(); return; }
    if (cmd === "flowcommand") { flowCommandOpen(); return; }
    if (cmd === "flowload") { loadFlowCommand(); return; }
    if (cmd === "twin") { twinOpen(); return; }
    if (cmd === "twinload") { loadTwin(); return; }
    if (cmd === "twinask") { twinAsk(); return; }
    if (cmd === "twincopilotreview") { twinCopilotReview(arg); return; }
    if (cmd === "twinsim") { twinSimulate(arg); return; }
    if (cmd === "scheduling") { schedulingOpen(); return; }
    if (cmd === "schedload") { loadScheduling(); return; }
    if (cmd === "schedload2") { st.scheduling.clinicianId = val("wSchedClinician"); loadScheduling(); return; }
    if (cmd === "apptbook") { apptBookOrOverbook(false); return; }
    if (cmd === "apptoverbook") { apptBookOrOverbook(true); return; }
    if (cmd === "apptcancel") { apptSetState(arg, "cancelled"); return; }
    if (cmd === "apptdna") { apptSetState(arg, "did-not-attend"); return; }
    if (cmd === "resbook") { resBook(); return; }
    if (cmd === "rescancel") { resCancel(arg); return; }
    if (cmd === "blackoutadd") { blackoutAdd(); return; }
    if (cmd === "blackoutcancel") { blackoutCancel(arg); return; }
    if (cmd === "cashier") { cashierOpen(); return; }
    if (cmd === "cashload") { loadCashier(); return; }
    if (cmd === "cashlookup") { cashLookup(); return; }
    if (cmd === "cashraise") { cashRaise(); return; }
    if (cmd === "invpay") { cashPost(arg, "pay"); return; }
    if (cmd === "invdeposit") { cashPost(arg, "deposit"); return; }
    if (cmd === "invdiscount") { cashPost(arg, "discount"); return; }
    if (cmd === "invrefund") { cashPost(arg, "refund"); return; }
    if (cmd === "invadjust") { cashPost(arg, "adjust"); return; }
    if (cmd === "invwriteoff") { cashPost(arg, "writeoff"); return; }
    if (cmd === "bedmgmtload") { loadBedMgmt(); return; }
    if (cmd === "bedstate") { bedStateApply(arg); return; }
    if (cmd === "stockreceive") { stockReceive(); return; }
    if (cmd === "stockadjust") { stockAdjustOrWaste("adjustment"); return; }
    if (cmd === "stockwaste") { stockAdjustOrWaste("wastage"); return; }
    if (cmd === "stockreconcile") { stockReconcile(); return; }
    if (cmd === "txopen") { txOpen(); return; }
    if (cmd === "txload") { loadTransfusion(); return; }
    if (cmd === "txpick") { txPick(arg); return; }
    if (cmd === "txrequest") { txRequest(); return; }
    if (cmd === "txcrossmatch") { txCrossmatch(); return; }
    if (cmd === "txissue") { txIssue(); return; }
    if (cmd === "txbedside") { txBedsideCheck(); return; }
    if (cmd === "txstart") { txStart(); return; }
    if (cmd === "txobserve") { txObserve(); return; }
    if (cmd === "txcomplete") { txComplete(); return; }
    if (cmd === "txreaction") { txReaction(); return; }
    if (cmd === "surgeryboard") { loadSurgeryBoard(); return; }
    if (cmd === "surgerybookopen") { surgeryBookOpen(); return; }
    if (cmd === "surgerybookclose") { surgeryBookClose(); return; }
    if (cmd === "surgmrnlookup") { surgMrnLookup(); return; }
    if (cmd === "surgerybook") { surgeryBook(); return; }
    if (cmd === "opensurgery") { openSurgeryCase(arg); return; }
    if (cmd === "surgeryload") { surgeryLoad(); return; }
    if (cmd === "surgeryconsent") { surgeryConsent(); return; }
    if (cmd === "surgerymarksite") { surgeryMarkSite(); return; }
    if (cmd === "surgeryphase") { surgeryPhase(arg); return; }
    if (cmd === "surgeryincise") { surgeryIncise(); return; }
    if (cmd === "surgeryimplant") { surgeryImplant(); return; }
    if (cmd === "surgerynote") { surgeryNote(); return; }
    if (cmd === "surgerydisposition") { surgeryDisposition(arg); return; }
    if (cmd === "anesstart") { anesStart(); return; }
    if (cmd === "anesevent") { anesEvent(); return; }
    if (cmd === "anesend") { anesEnd(); return; }
    if (cmd === "maternityload") { loadMaternity(); return; }
    if (cmd === "pregnancysave") { pregnancySave(); return; }
    if (cmd === "labourchart") { labourChart(); return; }
    if (cmd === "bloodlosssave") { bloodLossSave(); return; }
    if (cmd === "deliverysave") { deliverySave(); return; }
    if (cmd === "newbornsave") { newbornSave(); return; }
    if (cmd === "agebandcheck") { loadAgeBand(); return; }
    if (cmd === "ratecalc") { rateCalc(); return; }
    if (cmd === "neonatalchart") { neonatalChart(); return; }
    if (cmd === "linesload") { loadLines(); return; }
    if (cmd === "linesave") { lineSave(); return; }
    if (cmd === "lineremove") { lineRemove(arg); return; }
    if (cmd === "oncologyopen") { oncologyOpen(); return; }
    if (cmd === "oncologyload") { loadOncology(); return; }
    if (cmd === "oncolinksave") { oncoLinkSave(); return; }
    if (cmd === "oncodxsave") { oncoDxSave(); return; }
    if (cmd === "oncoaesave") { oncoAeSave(); return; }
    if (cmd === "oncochemosave") { oncoChemoSave(); return; }
    if (cmd === "cardiologyopen") { cardiologyOpen(); return; }
    if (cmd === "cardiologyload") { loadCardiology(); return; }
    if (cmd === "cardiolinksave") { cardioLinkSave(); return; }
    if (cmd === "cardioecgsave") { cardioEcgSave(); return; }
    if (cmd === "radiologyopen") { radiologyOpen(); return; }
    if (cmd === "radiologyload") { loadInvestigations().then(loadRadiology); return; }
    if (cmd === "radpick") { radiologyPick(arg); return; }
    if (cmd === "radprotocolsave") { radiologyProtocolSave(); return; }
    if (cmd === "radreportsave") { radiologyReportSave(); return; }
    if (cmd === "pharmacyopen") { pharmacyOpen(); return; }
    if (cmd === "pharmacyload") { loadPharmacy(); return; }
    if (cmd === "phpick") { pharmacyPick(arg); return; }
    if (cmd === "phverify") { pharmacyVerify("verified"); return; }
    if (cmd === "maikexplain") { maikExplainVerdict(); return; }
    if (cmd === "maikexplainreview") { maikExplainReview(arg); return; }
    if (cmd === "phquery") { pharmacyVerify("queried"); return; }
    if (cmd === "phdispense") { pharmacyDispense(); return; }
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
    if (cmd === "deviceload") { loadDevices(); return; }
    if (cmd === "deviceassociate") { deviceAssociate(); return; }
    if (cmd === "devicedissociate") { deviceDissociate(arg); return; }
    if (cmd === "dispositionadmit") { edDispositionAdmit(); return; }
    if (cmd === "disposition") { edDispositionHome(arg); return; }
    if (cmd === "summary") {
      var sel = st.sel; if (!sel) return;
      if (!(G.DISCHARGE && G.DISCHARGE.open)) { st.err = "The discharge summary is unavailable on this build."; paint(); return; }
      G.DISCHARGE.open({ orgId: st.orgId, encounterId: sel.encounterId, patientId: sel.patientId });
      return;
    }
    if (cmd === "ack") { acknowledge(arg); return; }
    if (cmd === "collectspecimen") { collectSpecimen(arg); return; }
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
    if (cmd === "reports") { loadReports(); return; }
    if (cmd === "emergencyadmin") { emergencyAdminOpen(); return; }
    if (cmd === "emergencydeclare") { emergencyDeclareAction(); return; }
    if (cmd === "emergencydeactivate") { emergencyDeactivateAction(arg); return; }
    if (cmd === "emergencyreconcile") { emergencyReconcileAction(arg); return; }
    if (cmd === "printpack") { try { G.print(); } catch (e) {} return; }
    if (cmd === "pcopy") { loadPatientCopy(); return; }
    if (cmd === "pcopyGive") { givePatientCopy(); return; }
    if (cmd === "consentopen") { consentOpen(); return; }
    if (cmd === "consentrecord") { recordConsentAction(); return; }
    if (cmd === "consentwithdraw") { var parts = arg.split("|"); withdrawConsentAction(parts[0], parts[1]); return; }
    if (cmd === "completionopen") { completionOpen(); return; }
    if (cmd === "roiopen") { roiOpen(); return; }
    if (cmd === "roirequest") { roiRequestAction(); return; }
    if (cmd === "roiauthorize") { roiAuthorizeAction(arg); return; }
    if (cmd === "roideny") { roiDenyAction(arg); return; }
    if (cmd === "roicancel") { roiCancelAction(arg); return; }
    if (cmd === "roifulfill") { roiFulfillAction(arg); return; }
    if (cmd === "billingopen") { billingOpen(); return; }
    if (cmd === "tpaopen") { tpaOpen(); return; }
    if (cmd === "claimcode") { claimCodeAction(); return; }
    if (cmd === "claimsubmit") { claimSubmitAction(arg); return; }
    if (cmd === "claimdeny") { claimDenyAction(arg); return; }
    if (cmd === "claimadjudicate") { claimAdjudicateAction(arg); return; }
    if (cmd === "claimresubmit") { claimResubmitAction(arg); return; }
    if (cmd === "preauth") { preAuthAction(); return; }
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
  function onInput(e) {
    if (!e.target || e.target.id !== "wQ") return;
    st.q = String(e.target.value || "");
    var r0 = document.getElementById("wRoster"); if (r0) r0.innerHTML = rosterHtml(st);
  }
  function open(opts) {
    opts = opts || {};
    st.orgId = opts.orgId || st.orgId || rememberedOrgId();
    if (opts.demo !== undefined) st.demo = !!opts.demo;
    if (!st.orgId) { try { G.toast && G.toast("The ward needs a hospital."); } catch (e) {} return; }
    st.view = "list"; st.sel = null; st.loaded = false; st.err = ""; st.note = ""; st.refusal = null;
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    // Live search: re-render only the roster so the search box keeps focus and its caret.
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    paint(); loadWard();
    // A hospital-level view requested by the shell (bed board, ED, twin...). Only the verbs the ward
    // list's own toolbar offers: a chart-scoped verb needs a selected patient and is not honoured.
    if (opts.act && HOSPITAL_ACTS.indexOf(opts.act) >= 0) dispatch(opts.act);
  }
  var HOSPITAL_ACTS = ["board", "edboard", "surgeryboard", "inventoryboard", "critsboard", "labboard", "radboard", "bedmgmt", "flowcommand", "twin", "scheduling", "cashier", "reports", "emergencyadmin", "integration", "downtime"];
  /* CLOSING THE WARD FORGETS THE PATIENTS.
   *
   * close() used to empty the markup and leave every patient in memory - the roster, the open
   * chart, its timeline, its medications. signOut() calls this, so on a shared ward computer the
   * next person to sign in opened the ward and saw the PREVIOUS user's patient list: 81 names, bed
   * numbers and hospital numbers belonging to someone else's session. It was replaced a second
   * later by their own fetch, which hid how wrong it was - and if that fetch was REFUSED, as it is
   * for a pharmacist who may not read the ward, the old list simply stayed on screen.
   *
   * Found 2026-09-12 signing out of a nurse's session and in as the pharmacist. Everything clinical
   * is cleared here; nothing is kept that names a patient. */
  function close() {
    var el = root(); el.classList.remove("on"); el.innerHTML = "";
    st.list = null; st.sel = null; st.timeline = null; st.activeMeds = null; st.timelineGap = 0;
    st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null;
    st.due = null; st.problems = null; st.labBoard = null; st.radBoard = null; st.critsBoard = null;
    st.noteDraft = ""; st.noteErr = ""; st.err = ""; st.view = "list";
    if (G.WARD && typeof G.WARD.onClose === "function") { try { G.WARD.onClose(); } catch (e) {} }
  }

  /* THE OVERLAY LET GO OF THE SCREEN WHEN THE SHELL NAVIGATED AWAY.
   *
   * This is a fixed, full-viewport layer at z-index 12000. It closed only through its own X, so
   * using the left-hand navigation while the ward was open left it covering an app that had already
   * routed somewhere else: the map, the admin centre or the discharge summary rendered underneath,
   * unreachable, and the ward looked stuck. Found 2026-09-12 clicking the shell's own nav on the
   * live site. The shell owns the route; the overlay follows it. Only when it is actually open, so
   * this can never interfere with a page the ward is not on top of. */
  try {
    G.addEventListener("hashchange", function () {
      var el = document.getElementById("smdWard");
      if (el && el.classList.contains("on")) close();
    });
  } catch (e) {}

  G.WARD = { filterRoster: filterRoster, open: open, close: close, _render: _render, _st: st, _nextFor: nextFor, _problem: problem };
})();
