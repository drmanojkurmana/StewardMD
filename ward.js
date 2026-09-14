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
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '" aria-hidden="true">' + name + "</span>"; }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }

  // ---- transport (same shape as queue.js; the workplace decides the credential) ----------------
  function staffTok() { try { return localStorage.getItem(LS_STAFF) || ""; } catch (e) { return ""; } }
  function fbToken() {
    try { if (G.SMD_AUTH && G.SMD_AUTH.token) return Promise.resolve(G.SMD_AUTH.token()); } catch (e) {}
    try { if (G.firebase && firebase.auth && firebase.auth().currentUser) return firebase.auth().currentUser.getIdToken(); } catch (e) {}
    return Promise.resolve(null);
  }
  /* A staff token is sent only for the hospital it was minted for (hospital-auth.js, S3 ID-01): a stale
   * session from another hospital never acts here. Pages that load ward.js without that file (the test
   * harnesses) keep the old rule; test/wsq-push-client.test.mjs pins that both real pages load it first. */
  function authHeaders() {
    if (G.SMD_HOSPITAL_AUTH) return G.SMD_HOSPITAL_AUTH.headersFor(st.orgId, fbToken);
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

  /* ---- G2: THE SIX BEDSIDE WRITES SURVIVE A LOST CONNECTION (ward-offline.js) ------------------------
   *
   * Vitals, a nursing task done, a note, a dose step, an ICU observation and a fluid entry go through
   * bedsideWrite(). The request key and the bedside time are fixed BEFORE the first attempt, so an attempt
   * whose answer was lost and its later resend from the device are one write, not two. With no connection,
   * or no answer at all, the entry is kept on this device and the nurse is told exactly that: saved on this
   * device, NOT in the record until it is sent. An answer, even a refusal, is handled as before.
   *
   * What comes back as a conflict (the record changed, or a dose's order changed) or a refusal waits on the
   * "Saved on this device" screen until a person resends, edits or discards it. Each decision is recorded on
   * the server (/ward/offline-resolve) before this device drops or re-sends anything. */
  var OFF_KIND_PATH = { vitals: "/ward/vitals", "nursing-task-done": "/ward/nursing-task-act", note: "/ward/note", mar: "/ward/mar", icu: "/ward/icu-record", fluid: "/ward/fluid" };
  var OFF = null, offPrev = null;
  function isOnline() { try { return G.navigator.onLine !== false; } catch (e) { return true; } }
  function offlineKey() {
    var s = "";
    try { var a = new Uint8Array(16); G.crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) s += (a[i] + 256).toString(16).slice(1); }
    catch (e) { s = Date.now().toString(16) + Math.random().toString(16).slice(2); }
    return "off-" + s;
  }
  /* Who owns what this device holds: the signed-in person, read from their own credential. Ownership on the
   * device only; the server authorises every send. A different person signing in never sees or sends it. */
  function offlineActor() {
    var t = staffTok();
    if (t) {
      try { var b = G.atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")), i = b.lastIndexOf("."); return i > 0 ? "staff:" + b.slice(0, i) : null; } catch (e) { return null; }
    }
    try { if (G.firebase && firebase.auth && firebase.auth().currentUser) return "fb:" + firebase.auth().currentUser.uid; } catch (e) {}
    return null;
  }
  function outbox() {
    if (OFF || !G.WARD_OFFLINE) return OFF;
    OFF = G.WARD_OFFLINE.deviceFor({ api: API, headers: authHeaders, actor: offlineActor, onChange: offlineChanged });
    OFF.load();
    return OFF;
  }
  function offlineChanged(s) {
    var prev = offPrev; offPrev = s; st.offline = s;
    // Something that was waiting has reached the record: re-read the open chart so it shows what the server holds.
    if (prev && prev.syncing && !s.syncing && s.waiting < prev.waiting && st.sel && st.view === "chart") { loadChart(); return; }
    if (st.view === "offline") { paint(); return; }
    var bar = typeof document !== "undefined" && document.getElementById ? document.getElementById("wOffBar") : null;
    if (bar) bar.outerHTML = offlineBar(st);
  }
  function syncOutbox() { var box = outbox(); if (box) box.sync().then(function () {}, function () {}); }
  function bedsideWrite(kind, body, opts, onAnswer, failMsg) {
    body.idempotencyKey = body.idempotencyKey || offlineKey();
    var box = outbox();
    var keep = function () {
      if (!box) { st.busy = false; st.err = failMsg + " No connection, and this device cannot keep it: record it on paper."; paint(); return; }
      box.enqueue(kind, body, { label: opts.label, patientId: opts.patientId, expectedVersion: opts.expectedVersion }).then(function () {
        st.busy = false; st.err = ""; st.refusal = null;
        st.note = "No connection. " + opts.label + " saved on this device, not yet sent: it is NOT in the record until it is sent, and it sends when the connection returns.";
        if (opts.onKept) opts.onKept();
        paint();
      }, function (e) { st.busy = false; st.err = failMsg + " " + ((e && e.message) || "It could not be kept on this device") + "."; paint(); });
    };
    if (box && !isOnline()) { st.busy = true; paint(); keep(); return; }
    apiPost(OFF_KIND_PATH[kind], body).then(onAnswer, keep);
  }

  var HOSPITAL_DEPARTMENTS = [
    "General Medicine", "General Surgery", "Emergency Medicine", "Intensive Care Unit (ICU)",
    "Cardiology", "Cardiothoracic Surgery", "Neurology", "Neurosurgery",
    "Orthopaedics", "Paediatrics", "Neonatology (NICU)", "Obstetrics & Gynaecology",
    "Oncology (Medical)", "Surgical Oncology", "Radiation Oncology", "Haematology",
    "Nephrology", "Urology", "Gastroenterology", "Surgical Gastroenterology",
    "Pulmonology / Respiratory Medicine", "Endocrinology", "Rheumatology",
    "Dermatology", "Psychiatry", "ENT (Otorhinolaryngology)", "Ophthalmology",
    "Anaesthesiology & Pain Medicine", "Palliative Care", "Physical Medicine & Rehabilitation",
    "Infectious Diseases", "Geriatrics", "Plastic & Reconstructive Surgery",
    "Vascular Surgery", "Transplant Surgery", "Pathology", "Microbiology", "Radiology"
  ];

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
        '</div><button class="w-x" data-w-act="dismiss" aria-label="Dismiss">' + ms("close") + "</button></div>";
    }
    if (state.err) return emBanner + '<div class="w-err">' + ms("error") + "<p>" + esc(state.err) + '</p><button class="w-x" data-w-act="dismiss" aria-label="Dismiss">' + ms("close") + "</button></div>";
    if (state.note) return emBanner + '<div class="w-ok">' + ms("check_circle") + "<p>" + esc(state.note) + '</p><button class="w-x" data-w-act="dismiss" aria-label="Dismiss">' + ms("close") + "</button></div>";
    return emBanner;
  }

  /* G2: what this device holds, on every screen. Hidden only when online with nothing held. */
  function offlineBar(state) {
    var s = state.offline, WO = G.WARD_OFFLINE;
    if (!s || !WO || (s.online && !s.waiting && !s.conflicts && !s.refused && !s.readFailed && !s.authNeeded)) return '<div id="wOffBar"></div>';
    var back = (s.conflicts || 0) + (s.refused || 0);
    return '<div id="wOffBar" class="w-hint warn" role="status">' + ms(s.online ? "sync_problem" : "cloud_off") + "<b>" + esc(WO.label(s).text) + "</b>" +
      (s.waiting ? " &middot; " + esc(s.waiting) + " saved on this device, not yet sent" : (!s.online ? " &middot; bedside entries will be kept on this device" : "")) +
      (s.refused ? " &middot; " + esc(s.refused) + " refused" : "") +
      ' <button class="w-btn ghost sm" data-w-act="offlinereview">' + (back ? "Review (" + back + ")" : "Show") + "</button></div>";
  }
  var OFF_SKIP = /^(orgId|idempotencyKey|expectedVersion|expectedOrderVersion|meta|writtenBy|history|resourceType|patientId|encounterId|id|tenantId|source|patient)$/;
  /* PURE. [path, value] for each plain value in an entry or a record, for the side by side and the editor. */
  function offFlat(o, prefix, out) {
    out = out || [];
    if (!o || typeof o !== "object") return out;
    Object.keys(o).forEach(function (k) {
      if (OFF_SKIP.test(k)) return;
      var v = o[k], p = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object") offFlat(v, p, out); else if (v !== undefined && v !== null && v !== "") out.push([p, v]);
    });
    return out;
  }
  function offRows(pairs) {
    return pairs.length ? '<ul class="w-mini">' + pairs.map(function (kv) { return "<li><b>" + esc(kv[0]) + "</b> <span>" + esc(kv[1]) + "</span></li>"; }).join("") + "</ul>" : '<p class="w-empty">Nothing to show.</p>';
  }
  function offEdId(id, path) { return "wOffEd_" + id + "_" + path.replace(/[^A-Za-z0-9]/g, "_"); }
  function offlineItemHtml(it, state) {
    var WO = G.WARD_OFFLINE, conflict = it.state === "conflict", part = WO.EDITABLE[it.kind];
    var mine = offRows(offFlat(it.body, "", []));
    var now = conflict
      ? (it.current ? offRows(offFlat(it.current, "", [])) : '<p class="w-hint">The server did not send the record with its answer.</p>') +
        (it.currentVersion != null ? '<p class="w-dt-times">' + (it.kind === "mar" ? "order" : "record") + " version now " + esc(it.currentVersion) + (it.expectedVersion != null ? ", you saw version " + esc(it.expectedVersion) : "") + "</p>" : "")
      : '<p class="w-hint warn">' + ms("block") + "Refused: " + esc(it.reason) + "</p>";
    var editing = state.offEdit === it.id && part;
    var editor = editing ? '<div class="w-card"><div class="w-card-h">' + ms("edit") + "<h3>Edit your entry</h3></div><div class=\"w-grid\">" +
      offFlat(it.body[part], "", []).map(function (kv) { return '<label class="w-f"><span>' + esc(kv[0]) + '</span><input id="' + esc(offEdId(it.id, kv[0])) + '" type="text" value="' + esc(kv[1]) + '"></label>'; }).join("") +
      '</div><button class="w-btn go" data-w-act="offlineeditsend:' + esc(it.id) + '">' + ms("send") + "Send edited entry</button></div>" : "";
    return '<div class="w-card"><div class="w-card-h">' + ms(conflict ? "sync_problem" : "block") + "<h3>" + esc(it.label) + "</h3></div>" +
      '<p class="w-hint warn">' + esc(WO.itemText(it)) + "</p>" +
      '<p class="w-dt-times">charted on this device ' + when(it.createdAt) + " &middot; never in the record</p>" +
      '<div class="w-grid"><div><h4>Your entry</h4>' + mine + "</div><div><h4>" + (conflict ? "The record now" : "The server's answer") + "</h4>" + now + "</div></div>" + editor +
      '<label class="w-f"><span>Why (recorded with your decision; needed to resend or edit)</span><input id="wOffWhy_' + esc(it.id) + '" type="text" autocomplete="off"></label>' +
      '<div class="w-actions">' +
      (conflict ? '<button class="w-btn go" data-w-act="offlineresend:' + esc(it.id) + '">' + ms("send") + "Resend mine</button>" : "") +
      (part && !editing ? '<button class="w-btn ghost" data-w-act="offlineedit:' + esc(it.id) + '">' + ms("edit") + "Edit</button>" : "") +
      '<button class="w-btn ghost" data-w-act="offlinediscard:' + esc(it.id) + '">' + ms("delete") + "Discard</button></div></div>";
  }
  function offlineView(state) {
    var s = state.offline, WO = G.WARD_OFFLINE;
    var head = '<div class="w-chart-h"><button class="w-ic" data-w-act="offlineback" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Saved on this device</b><small>entries that are not in the record yet</small></div>" +
      '<button class="w-ic" data-w-act="offlinesync" title="Send now">' + ms("sync") + "</button></div>";
    if (!WO) return head + '<p class="w-hint warn">' + ms("error") + "This device cannot keep bedside entries offline. Record on paper when there is no connection.</p>";
    if (!s) return head + '<p class="w-empty">Reading what this device holds&hellip;</p>';
    if (s.readFailed) return head + '<p class="w-hint warn">' + ms("error") + "What this device holds could not be read. Do not read this as nothing waiting: tell the nurse in charge and check the paper record.</p>";
    var queued = s.queued || [], items = s.items || [];
    return head +
      (s.authNeeded ? '<p class="w-hint warn">' + ms("lock") + "Sign in again to send what is waiting.</p>" : "") +
      '<div class="w-card"><div class="w-card-h">' + ms("schedule_send") + "<h3>Waiting to send (" + queued.length + ")</h3></div>" +
      (queued.length ? '<ul class="w-mini">' + queued.map(function (q) {
        return '<li class="w-mini-row"><div><b>' + esc(q.label) + '</b><div class="w-dt-times">charted ' + when(q.createdAt) + " &middot; saved on this device, not yet sent</div></div></li>";
      }).join("") + "</ul>" : '<p class="w-empty">Nothing is waiting to send.</p>') + "</div>" +
      "<h3>Came back from the server (" + items.length + ")</h3>" +
      (items.length ? items.map(function (it) { return offlineItemHtml(it, state); }).join("") : '<p class="w-empty">Nothing came back in conflict or refused.</p>');
  }
  /* G2: the person's decision, recorded on the server first; only then does the device act on it. */
  function offlineChoice(id, choice) {
    var WO = G.WARD_OFFLINE, box = outbox(), s = st.offline;
    var it = s && (s.items || []).filter(function (x) { return x.id === id; })[0];
    if (!it || !box) { st.err = "That entry is no longer on this device."; paint(); return; }
    var why = val("wOffWhy_" + id), edit;
    if (choice !== "discard" && why.length < 5) { st.err = "Say why your entry should stand, in a few words. It is recorded with your decision."; paint(); return; }
    if (choice === "edit") {
      edit = JSON.parse(JSON.stringify(it.body[WO.EDITABLE[it.kind]]));
      offFlat(edit, "", []).forEach(function (kv) {
        var el = document.getElementById(offEdId(id, kv[0])); if (!el) return;
        var ks = kv[0].split("."), o = edit; for (var k = 0; k < ks.length - 1; k++) o = o[ks[k]];
        o[ks[ks.length - 1]] = String(el.value);
      });
    }
    if (choice === "discard") {
      var sure = true;
      try { sure = G.confirm("Discard this " + it.label + "? It was never in the record and it will be gone from this device. Your decision is recorded."); } catch (e) {}
      if (!sure) return;
    }
    st.busy = true; paint();
    apiPost("/ward/offline-resolve", { orgId: st.orgId, kind: it.kind, choice: choice, idempotencyKey: it.idempotencyKey, patientId: it.patientId, error: it.error,
      expectedVersion: it.expectedVersion, currentVersion: it.currentVersion, reason: why, createdAt: it.createdAt })
      .then(function (r) {
        if (!r || !r.ok) { settle(r); if (!st.err && !st.refusal) st.err = "Your decision was not recorded, so nothing changed on this device."; paint(); return; }
        var act = choice === "discard" ? box.discard(id) : box.keepMine(id, why, it.currentVersion, choice === "edit" ? edit : undefined);
        return act.then(function () {
          st.busy = false; st.offEdit = null; st.err = "";
          st.note = choice === "discard" ? "Discarded. It was never in the record." : "Queued again: saved on this device, not yet sent.";
          paint();
          if (choice !== "discard") syncOutbox();
        }, function (e) { st.busy = false; st.err = (e && e.message) || "What this device holds could not be changed."; paint(); });
      }, function () { st.busy = false; st.err = "No connection: your decision could not be recorded, so nothing changed. Try again when online."; paint(); });
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
  function filterRoster(patients, cls, q, extra) {
    var needle = String(q || "").trim().toLowerCase();
    extra = extra || {};
    return (patients || []).filter(function (p) {
      if (cls && p.class !== cls) return false;
      if (extra.ward && p.ward !== extra.ward) return false;
      if (extra.doctor && p.doctor && p.doctor.toLowerCase().indexOf(extra.doctor.toLowerCase()) === -1) return false;
      if (extra.stay) {
        var day = stayDay(p.admittedAt);
        var dayNum = parseInt((day || "").replace("day ", ""), 10) || 0;
        if (extra.stay === "short" && dayNum > 3) return false;
        if (extra.stay === "medium" && (dayNum <= 3 || dayNum > 7)) return false;
        if (extra.stay === "long" && dayNum <= 7) return false;
      }
      if (!needle) return true;
      return [p.name, p.mrn, p.bed, p.ward, p.patientId, p.doctor].some(function (v) { return v != null && String(v).toLowerCase().indexOf(needle) >= 0; });
    });
  }
  function rosterHtml(state) {
    var all = state.patients || [];
    var extra = state.rosterFilters || {};
    var shown = filterRoster(all, state.cls, state.q, extra);
    var counts = {}; all.forEach(function (p) { counts[p.class] = (counts[p.class] || 0) + 1; });
    var uniqueWards = [];
    all.forEach(function (p) { if (p.ward && uniqueWards.indexOf(p.ward) === -1) uniqueWards.push(p.ward); });
    uniqueWards.sort();

    var filterRow = '<div class="w-roster-filter-bar" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; align-items:center;">' +
      '<label style="font-size:12px; color:var(--on-surface-variant); display:inline-flex; align-items:center; gap:4px;">' + ms("filter_alt") + 'Ward: ' +
        '<select id="wRosterWardFilter" data-w-act="rosterfilter:ward" style="padding:4px 8px; border-radius:6px; border:1px solid var(--outline-variant); font-size:12px; background:var(--sc-low); color:var(--on-surface);">' +
          '<option value="">All Wards</option>' +
          uniqueWards.map(function (w) { return '<option value="' + esc(w) + '"' + (extra.ward === w ? " selected" : "") + ">" + esc(w) + "</option>"; }).join("") +
        '</select>' +
      '</label>' +
      '<label style="font-size:12px; color:var(--on-surface-variant); display:inline-flex; align-items:center; gap:4px;">' + ms("schedule") + 'Stay: ' +
        '<select id="wRosterStayFilter" data-w-act="rosterfilter:stay" style="padding:4px 8px; border-radius:6px; border:1px solid var(--outline-variant); font-size:12px; background:var(--sc-low); color:var(--on-surface);">' +
          '<option value="">Any duration</option>' +
          '<option value="short"' + (extra.stay === "short" ? " selected" : "") + '>1-3 days</option>' +
          '<option value="medium"' + (extra.stay === "medium" ? " selected" : "") + '>4-7 days</option>' +
          '<option value="long"' + (extra.stay === "long" ? " selected" : "") + '>&gt; 7 days</option>' +
        '</select>' +
      '</label>' +
    '</div>';

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
    return '<p class="w-count">' + shown.length + " of " + all.length + (all.length === 1 ? " patient" : " patients") + (wards.length ? " · " + wards.length + (wards.length === 1 ? " ward" : " wards") : "") + "</p>" + filterRow + chips + (groups || empty);
  }
  /* Unfinished work on the ward, from /ward/metrics. A count the server could not read arrives as
   * null and is shown as "not readable", never as 0. */
  function wardStatusHtml(m) {
    var head = '<div class="w-card"><div class="w-card-h">' + ms("monitoring") + "<h3>Ward status</h3></div>";
    if (!m) return "";
    if (m.busy) return head + '<p class="w-empty">Loading ward status...</p></div>';
    if (!m.ok || !m.metrics) return head + '<p class="w-hint warn">' + ms("error") + "Ward status could not be loaded. Do not read this as nothing open.</p></div>";
    var x = m.metrics, o = x.open || {};
    var n = function (v) { return v == null ? '<span class="w-st overdue">not readable</span>' : esc(v); };
    var row = function (label, v) { return "<li><b>" + label + "</b><span>" + n(v) + "</span></li>"; };
    var oldest = x.oldestUnacknowledgedCritical;
    return head +
      (m.partial ? '<p class="w-hint warn">' + ms("warning") + "Some records could not be read with your role (" + esc((m.unreadable || []).join(", ")) + "). Those counts are left blank.</p>" : "") +
      "<p><b>" + n(x.openItems) + "</b> open items &middot; " + n(x.patients) + " patients &middot; " + n(x.occupiedBeds) + " beds occupied &middot; " + n(x.unplaced) + " without a bed</p>" +
      '<ul class="w-mini">' +
      row("Critical results not acknowledged", o.criticalResults) +
      row("of those, escalated", o.criticalResultsEscalated) +
      row("Doses in progress", o.dosesInFlight) +
      row("Handovers not received", o.handoversWaiting) +
      row("Home medicines not decided", o.medicinesUndecided) +
      row("Stays with no medication history", o.staysWithNoMedicationHistory) +
      row("Orders not checked by pharmacy", o.ordersNotPharmacyVerified) +
      "</ul>" +
      (oldest ? '<p class="w-hint warn">' + ms("priority_high") + "Oldest unacknowledged critical result: " + esc(oldest.display || "") + ", reported " + esc(String(oldest.reportedAt || "").slice(0, 16).replace("T", " ")) + "</p>" : "") +
      "</div>";
  }
  function listView(state) {
    var leftTools =
      wardStatusHtml(state.wardMetrics) +
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
      // P1.14: quality and safety measures with the case list behind each number (analytics.view, server-checked).
      '<button class="w-btn ghost" data-w-act="qualityview" title="Quality and safety measures, each with its case list">' + ms("query_stats") + "Quality and safety</button>" +
      '<button class="w-btn ghost" data-w-act="downtime" title="Printable sheet for when the system is unavailable">' + ms("print") + "Downtime pack</button></div></div>" +
      xchgCard(state) + cosignCard(state) + qualityCard(state) + overrideCard(state);

    var rightRoster =
      '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>Ward round" + (state.ward ? ": " + esc(state.ward) : "") + "</h3>" +
      '<button class="w-ic" data-w-act="reload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-filter"><input id="wQ" type="search" autocomplete="off" placeholder="Search name, MRN, bed or doctor" value="' + esc(state.q || "") + '">' +
      '<input id="wWard" type="text" placeholder="Ward (blank = all)" value="' + esc(state.ward) + '">' +
      '<button class="w-btn ghost" data-w-act="setward" type="button">Apply</button></div>' +
      '<div id="wRoster">' + rosterHtml(state) + "</div></div>";

    return '<div class="w-split-layout">' +
      '<aside class="w-col-tools">' + leftTools + '</aside>' +
      '<main class="w-col-roster">' + rightRoster + '</main>' +
      '</div>';
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
        return '<button class="w-bedcell occ" data-w-act="openbedpatient:' + esc(o.encounterId || o.patientId || "") + '" title="Open patient chart"><b>' + esc(o.bed) + '</b><span>' + esc(o.name || o.mrn || o.patientId) + "</span></button>";
      }).join("");
      // Which free cell is highlighted as "picked" - a UI selection compare against what the board
      // itself already reported as free, never a computation of whether a bed IS free.
      var isPicked = function (b) { return !!t && t.ward === w.ward && String(t.bed) === String(b); };
      var free = w.bedsKnown ? (w.free || []).map(function (b) {
        return '<button class="w-bedcell free' + (isPicked(b) ? " picked" : "") + '" data-w-act="pickbed:' + esc(w.ward) + "|" + esc(b) + '"><b>' + esc(b) + "</b><span>Free</span></button>";
      }).join("") : '<div class="w-bedcell unknown"><span>Bed list not configured</span></div>';
      var unplaced = (w.unplaced || []).map(function (o) {
        return '<div class="w-bedcell occ"><b>-</b><span>' + esc(o.name || o.mrn || o.patientId) + " (no bed assigned)</span></div>";
      }).join("");
      return '<div class="w-wardrow"><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;"><h4>' + esc(w.ward) + "<small style=\"margin-left:8px;\">" + esc((w.occupied || []).length) + " occupied" + (w.bedsKnown ? " &middot; " + esc((w.free || []).length) + " free" : "") + "</small></h4></div>" +
        '<div class="w-bedgrid">' + occ + free + unplaced + "</div></div>";
    }).join("");

    var lookup = state.mrnLookup;
    var admitPanel = !t ? "" :
      '<div class="w-card admit"><div class="w-card-h">' + ms("bed") + "<h3>Admit to " + esc(t.ward) + ", bed " + esc(t.bed) + "</h3>" +
        '<button class="w-ic" data-w-act="unpickbed" title="Choose a different bed">' + ms("close") + "</button></div>" +
        (state.edAdmitDept ? '<p class="w-hint" style="background:#e8f4fd; border:1px solid #b6d4fe; color:#0c5460; padding:8px 12px; border-radius:8px; margin-bottom:12px;">' + ms("info") + 'Admitting from ED to <b>' + esc(state.edAdmitDept) + '</b></p>' : "") +
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      var sexAge = (p.gender ? ' &middot; <b>' + esc(p.gender).toUpperCase() + (p.ageYears ? ', ' + esc(p.ageYears) + 'y' : '') + '</b>'
        : '');
      return "<li>" + '<button class="w-bed" data-w-act="openEd:' + esc(p.encounterId) + '">' +
        '<span class="w-bed-no' + (p.acuity == null ? " untriaged" : " acuity-" + esc(p.acuity)) + '">' + (p.acuity == null ? ms("priority_high") : esc(p.acuity)) + "</span>" +
        '<span class="w-bed-b"><b>' + esc(p.mrn || p.patientId) + "</b>" + sexAge + "<small>" + esc(p.chiefComplaint || "No chief complaint recorded") + " &middot; arrived " + when(p.arrivedAt) + "</small>" +
        edReassessLine(p.reassessment) + "</span>" +
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
        (lookup.ageYears != null ? " &middot; <b>" + esc(lookup.ageYears) + "y</b>" : "") + (lookup.gender ? " &middot; <b>" + esc(lookup.gender) + "</b>" : "") + "</span>" +
        '<button class="w-btn tiny go" data-w-act="edarriveknown">' + ms("check") + "This is the patient - arrival</button></div>" : "") +
      "</div>" +
      '<div class="w-sub"><h4>' + ms("person_off") + "Unidentified patient</h4>" +
      '<p class="w-hint">' + ms("info") + "Assigns a provisional MRN (EMERG-UNKNOWN or TRAUMA-UNKNOWN), pending identification and a later merge." + "</p>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Sex</span><select id="wEdSex"><option value="unknown">Not known</option><option value="male">Male</option><option value="female">Female</option></select></label>' +
      '<label class="w-f"><span>Chief complaint</span><input id="wEdUnkCc" type="text" autocomplete="off" placeholder="e.g. found down, unresponsive"></label>' +
      "</div>" +
      '<label class="w-chk" style="margin: 8px 0;"><input type="checkbox" id="wEdIsTrauma"> Trauma arrival (marks as TRAUMA-UNKNOWN)</label>' +
      '<button class="w-btn warn" data-w-act="edarriveunknown">' + ms("person_add") + "Arrive as unidentified</button></div>" +
      "</div>";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Emergency department</b></div>" +
      '<button class="w-btn tiny go" data-w-act="edarrivalopen">' + ms("add_circle") + "Arrival</button>" +
      '<button class="w-ic" data-w-act="edboard" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card">' +
      (state.edErr ? '<p class="w-hint warn">' + ms("error") + esc(state.edErr) + " Do not read this as an empty department.</p>"
        : state.ed == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading the ED board.</p>"
        : (state.ed.overdueReassessments ? '<p class="w-hint warn">' + ms("alarm") + esc(state.ed.overdueReassessments) + " patient" + (state.ed.overdueReassessments === 1 ? " is" : "s are") + " overdue for reassessment.</p>" : "") +
          (rows && state.ed.reassessIntervalsSet === false ? '<p class="w-hint">' + ms("info") + "This hospital has not set reassessment intervals, so no reassessment times are shown.</p>" : "") +
          (rows ? '<ul class="w-q w-ed-board">' + rows + "</ul>"
            : '<p class="w-empty">No patients currently in the ED.</p>')) +
      "</div>" + arrivalPanel;
  }

  /* One line saying when this patient must be looked at again. Every state is its own sentence: an
   * hour the server could not work out is "not known" with its reason, and a hospital with no interval
   * gets "no reassessment interval set" - never "not due", which would promise a clock nobody set. */
  function edReassessLine(r) {
    if (!r) return "";
    if (r.state === "overdue") return '<small class="w-st overdue">' + ms("alarm") + "Reassessment overdue by " + esc(r.minutesOverdue) + " min (was due " + when(r.dueAt) + ")</small>";
    if (r.state === "due") return "<small>Reassessment due " + when(r.dueAt) + "</small>";
    if (r.state === "no-interval") return "<small>No reassessment interval set</small>";
    if (r.state === "not-known") return '<small class="w-st">' + esc(r.text) + "</small>";
    if (r.state === "closed") return "<small>Visit closed, no reassessment due</small>";
    return "";
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
    if (!c) return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><div><b>Case</b></div></div><div class=\"w-card\"><p class=\"w-empty\">Loading&hellip;</p></div>";

    var header = '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(c.patientMrn || c.patientId) + "</b><small>" + esc(c.procedure) + " &middot; " + esc(c.laterality) + " &middot; " + esc(STAGE_WORDS[c.stage] || c.stage) + "</small></div>" +
      '<button class="w-ic" data-w-act="surgeryload" title="Refresh">' + ms("refresh") + "</button></div>" +
      /* ABANDONING A CASE. A case that is not going ahead - the patient deteriorated, the list overran,
       * the consent was withdrawn - has to be ended on the record, with a reason, or it sits on the
       * theatre board as a case somebody is still expecting. Offered only while the case is live; a
       * signed-out or already-abandoned case has nothing to abandon. */
      (c.stage !== "signed-out" && c.stage !== "abandoned"
        ? '<div class="w-noprint" style="margin:6px 0"><button class="w-btn ghost sm" data-w-act="surgeryabandon:' + esc(c.id) + '">' + ms("close") + "This case is not going ahead</button></div>"
        : "") +
      (c.stage === "abandoned" && abandonReasonOf(c)
        ? '<p class="w-hint warn">' + ms("warning") + "Abandoned: " + esc(abandonReasonOf(c)) + "</p>"
        : "");

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
      '<div class="w-prob"><div style="position:relative; flex:1; display:inline-flex; align-items:center;"><input id="wProbText" type="text" autocomplete="off" placeholder="Diagnosis, in words" value="' + esc(state.probText || "") + '" style="width:100%; padding-right:60px;"><div style="position:absolute; right:4px; top:50%; transform:translateY(-50%);">' + micBtn("wProbText") + '</div></div>' +
      '<input id="wProbCode" type="text" autocomplete="off" placeholder="ICD code (optional)" value="' + esc(state.probCode || "") + '">' +
      '<select id="wProbVs">' + opts + "</select>" +
      '<button class="w-btn ghost" data-w-act="icd">' + ms("search") + "Find code</button>" +
      '<button class="w-btn" data-w-act="problem">' + ms("save") + "Record</button></div>" +
      /* THE CODE IS PICKED BY A PERSON, NEVER DERIVED. The search offers candidates and attaches
       * nothing: no result is preselected, not even when there is exactly one, because a single
       * result is not the same as the right one. Until somebody clicks, the diagnosis is text. */
      '<div id="wIcdCandidates">' +
      (state.icd === null ? '<p class="w-hint">' + ms("info") + "Searching…</p>" : "") +
      (Array.isArray(state.icd)
        ? (state.icd.length
          ? '<ul class="w-icd">' + state.icd.map(function (c, i) {
              return '<li><button class="w-icd-p" data-w-act="icdpick:' + i + '"><b>' + esc(c.code) + "</b><span>" + esc(c.title) + "</span><small>" + esc(c.system || "") + "</small></button></li>";
            }).join("") + "</ul>"
          : '<p class="w-hint">' + ms("info") + "No matching code. Record it in words: an uncoded diagnosis is honest, a guessed code is not.</p>")
        : "") +
      "</div>" +
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
  /* THE FILTERS. A stay of any length is unreadable as one undifferentiated list, and the question a
   * reader actually arrives with is narrow: "just the notes", "just the tests". The counts are shown
   * on each filter so an empty one is visibly empty rather than looking like a broken screen.
   *
   * "everything" is first and is the default, because a filter that silently hides half a chart is
   * far more dangerous than a long list - a doctor who does not realise a filter is on is a doctor
   * reading an incomplete history and not knowing it. The active filter is also restated above the
   * list for the same reason. */
  var TIMELINE_FILTERS = [
    ["", "Everything"],
    ["note", "Notes"],
    ["investigation", "Tests ordered"],
    ["result", "Results"],
    ["medication", "Medicines"],
    ["observation", "Vitals"],
    ["problem", "Diagnoses"],
    ["procedure", "Procedures"],
    ["critical", "Critical events"],
    ["allergy", "Allergies"],
    ["visit", "Admission and discharge"],
    ["billing", "Billing"],
    ["registration", "Registration"],
  ];
  /* DATE. "What happened today" and "what happened on the day they deteriorated" are the two
   * questions a long stay actually gets asked, and neither is answerable by scrolling. The ranges
   * are relative rather than a date picker because that is how the question is asked out loud;
   * a specific day is reachable by narrowing and reading. */
  var TIMELINE_WHEN = [
    ["", "Any time"],
    ["24h", "Last 24 hours"],
    ["72h", "Last 3 days"],
    ["7d", "Last week"],
  ];
  function timelineSince(range) {
    var hours = range === "24h" ? 24 : range === "72h" ? 72 : range === "7d" ? 168 : 0;
    if (!hours) return null;
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
  }
  function timelineFilterBar(state) {
    var all = state.timeline || [];
    var cur = state.timelineFilter || "";
    var curWhen = state.timelineWhen || "";
    var since = timelineSince(curWhen);
    // The counts are counted AFTER the date range, so a kind that has nothing in the chosen window
    // reads as empty rather than promising rows the list will not show.
    var inRange = since ? all.filter(function (e) { return e.at >= since; }) : all;
    // A kind with nothing in it at all is not offered: thirteen buttons of which nine are empty is
    // a worse screen than four that mean something. "Everything" always stays.
    var offered = TIMELINE_FILTERS.filter(function (f) {
      if (!f[0]) return true;
      if (f[0] === cur) return true;   // never yank the active filter out from under the reader
      return inRange.some(function (e) { return e.category === f[0]; });
    });
    return '<div class="w-tl-search"><input id="wTlQ" type="search" placeholder="Search this history - a drug, a word from a note, a person" value="' + esc(state.timelineQuery || "") + '">' +
      '<button class="w-btn ghost sm" data-w-act="timelinesearch">' + ms("search") + "Search</button>" +
      (state.timelineQuery ? '<button class="w-btn ghost sm" data-w-act="timelinesearchclear">' + ms("close") + "Clear</button>" : "") +
      "</div>" +
      '<div class="w-tl-filters">' + offered.map(function (f) {
      var n = f[0] ? inRange.filter(function (e) { return e.category === f[0]; }).length : inRange.length;
      return '<button class="w-tl-f' + (cur === f[0] ? " on" : "") + '" data-w-act="timelinefilter:' + esc(f[0] || "all") + '">' +
        esc(f[1]) + " <i>" + esc(n) + "</i></button>";
    }).join("") + "</div>" +
    '<div class="w-tl-filters w-tl-when">' + TIMELINE_WHEN.map(function (w) {
      return '<button class="w-tl-f' + (curWhen === w[0] ? " on" : "") + '" data-w-act="timelinewhen:' + esc(w[0] || "any") + '">' +
        esc(w[1]) + "</button>";
    }).join("") + "</div>";
  }
  /* SEARCH. "When did we start the co-amoxiclav" is asked far more often than any filter answers,
   * and on a three-week stay it is unanswerable by scrolling. It searches what the reader can
   * actually see - the line itself and the words behind it - rather than the raw record, because a
   * search that matched hidden fields would return rows whose match nobody can find. */
  function timelineMatches(e, q) {
    if (!q) return true;
    var hay = String(e.label || "");
    if (e.who) hay += " " + e.who;
    if (e.category) hay += " " + e.category;
    (e.body || []).forEach(function (b) { hay += " " + (b.heading || "") + " " + (b.text || ""); });
    return hay.toLowerCase().indexOf(q) >= 0;
  }
  function timelineFiltered(state) {
    var all = state.timeline || [];
    var f = state.timelineFilter || "";
    var since = timelineSince(state.timelineWhen || "");
    var q = String(state.timelineQuery || "").trim().toLowerCase();
    return all.filter(function (e) {
      if (f && e.category !== f) return false;
      if (since && e.at < since) return false;
      if (q && !timelineMatches(e, q)) return false;
      return true;
    });
  }

  /* One row of the stay. Shared by the card on the chart and the full-page Timeline, so the two can
   * never drift into telling the story differently.
   *
   * The colour is the CATEGORY the server assigned, never anything decided here - a screen that
   * works out for itself what kind of event something is will eventually disagree with the record. */
  /* VOICE DICTATION SUPPORT (BUG-MU08NPGV-0MZX) */
  /* P2.8: voice -> text in the box -> the clinician reads and edits -> save -> submit -> sign. The
   * transcript only ever lands in an editable field; nothing is saved or signed by speaking.
   * PRIVACY: dictation is a patient's clinical story, so it runs ON THIS DEVICE ONLY
   * (processLocally). A browser that would stream the audio to an outside speech service is refused
   * rather than used quietly. Language is Indian English or Hindi, remembered per browser. */
  var _activeRec = null;
  var DICT_LANGS = { "en-IN": "EN", "hi-IN": "\u0939\u093f" };
  function dictLang() {
    var l = ""; try { l = localStorage.getItem("wsqDictLang") || ""; } catch (e) {}
    return DICT_LANGS[l] ? l : "en-IN";
  }
  function dictSay(msg) {
    if (typeof G !== "undefined" && G.toast) G.toast(msg); else alert(msg);
  }
  var DICT_ERRORS = {
    "not-allowed": "The microphone is blocked for this site. Allow it in the browser and try again.",
    "service-not-allowed": "The microphone is blocked for this site. Allow it in the browser and try again.",
    "no-speech": "Nothing was heard. Nothing was added.",
    "audio-capture": "No microphone was found.",
    "language-not-supported": "This language cannot be converted on this device.",
  };
  function startDictation(targetId) {
    var SpeechRec = (typeof window !== "undefined") && (window.SpeechRecognition || window.webkitSpeechRecognition);
    var target = document.getElementById(targetId);
    if (!target) return;
    if (_activeRec) {
      try { _activeRec.stop(); } catch (e) {}
      _activeRec = null;
      var b0 = document.querySelector('[data-w-act="dictate:' + targetId + '"]');
      if (b0) b0.classList.remove("recording");
      return;
    }
    // Without the on-device check there is no way to promise the audio stays here, so refuse.
    if (!SpeechRec || typeof SpeechRec.available !== "function") {
      dictSay("Voice typing needs a browser that converts speech on this device (Chrome 139 or newer). Speech is never sent to an outside service.");
      return;
    }
    var lang = dictLang();
    var opts = { langs: [lang], processLocally: true, quality: "dictation" };
    SpeechRec.available(opts).then(function (status) {
      if (status === "downloadable" || status === "downloading") {
        dictSay("Downloading the speech pack for this language to this device. Try again in a minute.");
        if (status === "downloadable" && typeof SpeechRec.install === "function") {
          SpeechRec.install(opts).then(function (ok) {
            dictSay(ok ? "Speech pack ready. Tap the microphone again." : "The speech pack could not be downloaded. Type instead.");
          }, function () { dictSay("The speech pack could not be downloaded. Type instead."); });
        }
        return;
      }
      if (status !== "available") {
        dictSay("This device cannot convert " + (lang === "hi-IN" ? "Hindi" : "English") + " speech locally. Type instead.");
        return;
      }
      listen(SpeechRec, lang, target, targetId);
    }, function () {
      dictSay("Voice typing could not start. Type instead.");
    });
  }
  function listen(SpeechRec, lang, target, targetId) {
    var btn = document.querySelector('[data-w-act="dictate:' + targetId + '"]');
    try {
      var rec = new SpeechRec();
      rec.processLocally = true;
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = lang;
      if (btn) btn.classList.add("recording");
      rec.onresult = function (event) {
        var transcript = "";
        for (var i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (!transcript) return;
        if (target.value && !/\s$/.test(target.value)) target.value += " ";
        target.value += transcript;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        dictSay("Dictated text added. Read and correct it before saving; nothing is saved or signed until you do.");
      };
      rec.onerror = function (ev) {
        if (btn) btn.classList.remove("recording");
        _activeRec = null;
        var code = ev && ev.error;
        if (code !== "aborted") dictSay(DICT_ERRORS[code] || "Voice typing stopped (" + (code || "unknown") + "). Nothing was added.");
      };
      rec.onend = function () {
        if (btn) btn.classList.remove("recording");
        _activeRec = null;
      };
      _activeRec = rec;
      rec.start();
    } catch (e) {
      if (btn) btn.classList.remove("recording");
      _activeRec = null;
      dictSay("Voice typing could not start. Type instead.");
    }
  }
  function micBtn(targetId) {
    var lang = dictLang();
    return '<span style="display:inline-flex; gap:2px;"><button type="button" class="w-mic-btn" data-w-act="dictate:' + esc(targetId) + '" title="Voice typing on this device">' + ms("mic") + '</button>' +
      '<button type="button" class="w-mic-btn" data-w-act="dictlang" title="Voice typing language: ' + (lang === "hi-IN" ? "Hindi" : "English") + '">' + DICT_LANGS[lang] + '</button></span>';
  }
  function toggleDictLang() {
    var next = dictLang() === "en-IN" ? "hi-IN" : "en-IN";
    try { localStorage.setItem("wsqDictLang", next); } catch (e) {}
    var label = DICT_LANGS[next], title = "Voice typing language: " + (next === "hi-IN" ? "Hindi" : "English");
    var els = document.querySelectorAll('[data-w-act="dictlang"]');
    for (var i = 0; i < els.length; i++) { els[i].textContent = label; els[i].title = title; }
    dictSay("Voice typing language: " + (next === "hi-IN" ? "Hindi" : "English") + ".");
  }

  /* Group concurrent observations (vitals) within 2 minutes into a single row (BUG-MU08MEQI-JZH1) */
  function groupTimelineEvents(events) {
    if (!events || !events.length) return [];
    var out = [];
    var curVitals = null;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var isObs = (e.category === "observation" || e.resourceType === "Observation");
      var isVital = isObs && (/pulse|heart|hr|bp|sbp|dbp|spo2|temp|respir|rr|vital/i.test(String(e.label || "")) || e.code === "vitals");
      if (!isVital) {
        if (curVitals) { out.push(curVitals); curVitals = null; }
        out.push(e);
        continue;
      }
      var t = e.at ? new Date(e.at).getTime() : 0;
      if (curVitals) {
        var diff = Math.abs(t - curVitals._t);
        if (diff <= 120000) {
          curVitals._items.push(e);
          continue;
        } else {
          out.push(curVitals);
          curVitals = null;
        }
      }
      curVitals = Object.assign({}, e, {
        _t: t,
        _items: [e]
      });
    }
    if (curVitals) out.push(curVitals);
    return out.map(function (e) {
      if (e._items && e._items.length > 1) {
        var labels = e._items.map(function (it) { return it.label; }).join(" · ");
        var crit = e._items.some(function (it) { return it.critical; });
        return Object.assign({}, e, {
          label: "Vital signs set: " + labels,
          critical: crit
        });
      }
      return e;
    });
  }

  /* EXPAND AND COLLAPSE. A note's full text is exactly what a reader wants when they are reading
   * that note and exactly what drowns the list when they are scanning for something else. So a row
   * with words behind it shows the first line and opens on a click.
   *
   * Collapsed is the default, and the preview is the real first line rather than an ellipsis, so a
   * reader can skim the assessments of a whole stay without opening one. */
  function timelineRow(e, open) {
    var parts = e.body || [];
    var body = "";
    if (parts.length) {
      if (open) {
        body = parts.map(function (b) {
          return '<div class="w-tl-b"><b>' + esc(b.heading) + "</b> " + esc(b.text) + "</div>";
        }).join("");
      } else {
        var first = String(parts[0].text || "");
        var preview = first.length > 140 ? first.slice(0, 140) + "…" : first;
        body = '<div class="w-tl-b w-tl-peek">' + esc(preview) + "</div>";
      }
    }
    /* THE REPORT BUTTON, BESIDE THE ORDER THAT ASKED FOR IT. An order whose report is back is one
     * click from being read; one still waiting says so in those words, rather than looking exactly
     * like the finished one and leaving the reader to guess. */
    var station = "";
    if (e.resourceType === "ServiceRequest") {
      station = e.reportReady
        ? '<button class="w-btn ghost sm" data-w-act="timelinereport:' + esc(e.reportId || "") + '">' +
          ms(e.reportIsImaging ? "labs" : "description") + "Open the report</button>"
        : '<span class="w-st due">waiting for the report</span>';
    }
    return '<li class="w-tl-' + esc(e.category || "other") + (e.critical ? " w-tl-crit" : "") + '">' +
      '<span class="w-tl-t">' + when(e.at) + "</span>" +
      '<span class="w-tl-k">' + esc(e.category || e.resourceType) + "</span>" +
      "<span>" + esc(e.label) +
      (e.critical ? ' <span class="w-st escalate">critical</span>' : "") +
      body +
      (parts.length
        ? '<button class="w-tl-x" data-w-act="timelineopen:' + esc(e.id || "") + '">' +
          ms(open ? "expand_less" : "expand_more") + (open ? "Show less" : "Read it all") + "</button>"
        : "") +
      "</span>" +
      (station ? '<span class="w-tl-a">' + station + "</span>" : "") +
      '<button class="w-tl-x" data-w-act="timelinedetail:' + esc(e.resourceType || "") + "~" + esc(e.id || "") + '">' +
        ms("fact_check") + "Show the record</button>" +
      "</li>";
  }
  /* THE RECORD BEHIND A LINE, AND EVERY VERSION OF IT.
   *
   * A version that was overtaken before it ever took effect is marked as such rather than listed as
   * though it had stood: "this was prescribed and corrected an hour later" and "this stood all week"
   * are different facts, and showing only the latest version makes them look identical. */
  function detailPanel(state) {
    var d = state.recordDetail;
    if (!d) return "";
    if (d.loading) return '<div class="w-card"><p class="w-hint">' + ms("info") + "Opening the record…</p></div>";
    if (!d.ok) {
      return '<div class="w-card"><div class="w-card-h">' + ms("error") + "<h3>The record could not be opened</h3>" +
        '<button class="w-ic" data-w-act="timelinedetailclose" aria-label="Close">' + ms("close") + "</button></div>" +
        '<p class="w-hint warn">' + esc(d.detail || d.error || "Not available.") + "</p></div>";
    }
    var versions = (d.versions || []).slice().reverse().map(function (v) {
      return "<li>" +
        '<span class="w-st ' + (v.current ? "" : v.stood ? "" : "escalate") + '">v' + esc(v.version) + (v.current ? " · current" : "") + "</span> " +
        (v.byName ? esc(v.byName) : "somebody") +
        (v.onBehalfOf ? " on behalf of " + esc(v.onBehalfOf) : "") +
        " &middot; " + when(v.recordedAt) +
        (v.effectiveAt && v.effectiveAt !== v.recordedAt ? " &middot; took effect " + when(v.effectiveAt) : "") +
        (v.source && v.source !== "wardsynq-native" ? " &middot; from " + esc(v.source) : "") +
        (v.supersededBeforeEffective ? ' <span class="w-st escalate">overtaken before it took effect - this was never what the record said</span>' : "") +
        (v.amendedAt ? ' <span class="w-st due">corrected</span>' : "") +
        (v.changed ? '<div class="w-dt-times">changed: ' + esc(v.changed.join(", ")) + "</div>" : "") +
        (!v.current ? (d.readers && d.readers[v.version] ? readersHtml(d.readers[v.version])
          : ' <button class="w-btn ghost sm" data-w-act="readers:' + esc(v.version) + '">' + ms("group") + "Who saw this version</button>") : "") +
        "</li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("fact_check") + "<h3>" + esc(d.resourceType) + "</h3>" +
      '<button class="w-ic" data-w-act="timelinedetailclose" title="Close">' + ms("close") + "</button></div>" +
      '<div class="w-dt-times">' + esc(d.recordId) + " &middot; " + esc(d.versionCount) + " version" + (d.versionCount === 1 ? "" : "s") + "</div>" +
      (d.readLogFailed ? '<p class="w-hint warn">' + ms("warning") + "Your opening of this record could not be logged, so you will not be told if it is later corrected.</p>" : "") +
      (versions ? '<div class="w-sub"><h4>Versions, newest first</h4><ul class="w-mini">' + versions + "</ul></div>" : "") +
      '<div class="w-sub"><h4>What the record says now</h4>' + reportValue(d.record) + "</div>" +
      "</div>";
  }

  function timelineGapHint(state) {
    return state.timelineGap ? '<p class="w-hint warn">' + ms("warning") + esc(state.timelineGap) + " record" + (state.timelineGap === 1 ? "" : "s") + " on this chart carry no timestamp and are not shown here.</p>" : "";
  }
  /* The card on the chart is a GLANCE and is deliberately never filtered: the filters belong to the
   * full history, where somebody is reading rather than scanning, and a filtered glance would be a
   * chart quietly showing less than it appears to. */
  function timelineCard(state) {
    var t = state.timeline;
    if (t == null) return "";
    var openIds = state.timelineOpen || {};
    var rows = groupTimelineEvents(t).map(function (e) { return timelineRow(e, !!openIds[e.id]); }).join("");
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
  /* Opening the report an order produced. The investigations screen is where results are read, and
   * this takes the reader there with the report already picked out, rather than building a second
   * place to read a result that could drift from the first. */
  /* Opens the record behind a timeline line. The argument carries the type and the id together
   * because a record id alone does not say what it is, and the record service refuses a type it
   * was not given. */
  function timelineDetail(arg) {
    var parts = String(arg || "").split("~");
    var type = parts[0], id = parts.slice(1).join("~");
    if (!type || !id) return;
    st.recordDetail = { loading: true };
    paint();
    apiGet("/ward/record-detail?orgId=" + encodeURIComponent(st.orgId) +
      "&type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id))
      .then(function (r) { st.recordDetail = r || { ok: false, error: "no_response" }; paint(); if (r && r.ok) logDecisiveRead(r); })
      .catch(function () { st.recordDetail = { ok: false, detail: "Could not open that record." }; paint(); });
  }
  /* Opening a record's detail is a decisive read (read-log.js): logged so that if this version is
   * later corrected, the person who opened it can be told. A failed log is said on the panel. */
  function logDecisiveRead(d) {
    var rec = d.record || {}, cur = (d.versions || []).filter(function (v) { return v.current; })[0];
    var patientId = rec.patientId || (st.sel && st.sel.patientId);
    if (!patientId || !cur) return;
    var val = rec.value != null ? (typeof rec.value === "object" ? (rec.value.value != null ? rec.value.value + (rec.value.unit ? " " + rec.value.unit : "") : JSON.stringify(rec.value)) : rec.value) : (rec.status || "");
    apiPost("/ward/read", { orgId: st.orgId, patientId: patientId, valueId: d.recordId, version: cur.version, value: String(val).slice(0, 200), kind: "opened", context: d.resourceType })
      .then(function (r) { if (!(r && r.ok) && st.recordDetail === d) { d.readLogFailed = true; paint(); } })
      .catch(function () { if (st.recordDetail === d) { d.readLogFailed = true; paint(); } });
  }
  function loadReaders(version) {
    var d = st.recordDetail; if (!d || !d.ok) return;
    var vs = d.versions || [], i = -1;
    for (var k = 0; k < vs.length; k++) if (String(vs[k].version) === String(version)) i = k;
    var next = vs[i + 1];
    if (i < 0 || !next) return;
    var patientId = (d.record && d.record.patientId) || (st.sel && st.sel.patientId);
    d.readers = d.readers || {};
    d.readers[version] = { busy: true }; paint();
    apiGet("/ward/readers?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(patientId) + "&valueId=" + encodeURIComponent(d.recordId) +
      "&supersededVersion=" + encodeURIComponent(version) + "&correctedAt=" + encodeURIComponent(next.recordedAt || "") + "&label=" + encodeURIComponent(d.resourceType || ""))
      .then(function (r) { d.readers[version] = r && r.ok ? r : { ok: false, detail: r && (r.detail || r.error) }; paint(); })
      .catch(function () { d.readers[version] = { ok: false }; paint(); });
  }
  function readersHtml(x) {
    if (!x) return "";
    if (x.busy) return '<div class="w-dt-times">Looking up who saw this version...</div>';
    if (!x.ok) return '<p class="w-hint warn">' + ms("error") + "Could not find out who saw this version" + (x.detail ? ": " + esc(x.detail) : "") + ". Do not read this as nobody.</p>";
    var people = (x.people || []).map(function (p) {
      return "<li><b>" + esc(p.person) + "</b><span>" + esc(p.kind) + " " + when(p.readAt) + (p.actedOn ? ' <span class="w-st overdue">acted on it</span>' : "") + "</span></li>";
    }).join("");
    return (people ? '<ul class="w-mini">' + people + "</ul>" : "") + '<p class="w-hint">' + ms("info") + esc(x.note || "") + "</p>";
  }
  function timelineOpenReport(reportId) {
    if (!reportId) return;
    /* Results are read in the Investigations card on the chart - there is no separate results
     * screen, and adding one would be a second place to read a result that could drift from the
     * first. So this goes to the chart and marks the report the reader asked for. */
    st.highlightReportId = reportId;
    st.view = "chart";
    paint();
    loadInvestigations();
  }
  function timelineNoteSave() {
    var s = st.sel; if (!s) return;
    var text = val("wTlNote");
    if (!text) { st.noteErr = "A note needs words."; paint(); return; }
    var kind = val("wTlNoteKind") || "clinical";
    var prefix = "";
    if (kind === "instruction" || kind === "both") {
      var targets = [];
      if (checked("wNoteRecNurse")) targets.push("Nurse");
      if (checked("wNoteRecResident")) targets.push("Resident");
      if (checked("wNoteRecLab")) targets.push("Laboratory");
      if (checked("wNoteRecPharm")) targets.push("Pharmacy");
      if (checked("wNoteRecBilling")) targets.push("Billing");
      var tgtStr = targets.length ? targets.join(", ") : "Care team";
      prefix = (kind === "both" ? "[Clinical note and instruction for " : "[Instruction for ") + tgtStr + "]: ";
    }
    var fullText = prefix + text;
    st.noteDraft = text;               // survives the repaint, and every refusal below
    st.busy = true; st.noteErr = ""; paint();
    /* "progress" is the built-in free-text template every hospital has without configuring one
     * (functions/_wardsynq/note-templates.js). A hospital that defines its own `progress` template
     * replaces it, and this keeps working. */
    bedsideWrite("note", { orgId: st.orgId, templateId: "progress", encounterId: s.encounterId, patientId: s.patientId, sections: { narrative: fullText }, at: new Date().toISOString() },
      { label: kind === "instruction" ? "Instruction" : "Note", patientId: s.patientId, onKept: function () { st.noteDraft = ""; } },
      function (r) {
        if (settle(r, r && r.written ? (kind === "instruction" ? "Instruction written on the chart. No one is notified by this; tell the team directly if it is urgent." : kind === "both" ? "Note and instruction recorded." : "Note added.") : null)) {
          st.noteDraft = "";           // on the record now, so the draft has done its job
          var el = document.getElementById("wTlNote"); if (el) el.value = "";
          // Re-read rather than repaint from what the browser believes.
          loadChart();
        } else paint();
      }, "Could not save that note.");
  }
  function filterLabel(v) {
    for (var i = 0; i < TIMELINE_FILTERS.length; i++) if (TIMELINE_FILTERS[i][0] === v) return TIMELINE_FILTERS[i][1];
    return v;
  }
  function timelineView(state) {
    var s = state.sel || {};
    var t = state.timeline;
    var shown = timelineFiltered(state);
    var openIds = state.timelineOpen || {};
    var rows = groupTimelineEvents(shown).map(function (e) { return timelineRow(e, !!openIds[e.id]); }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(s.name || s.patientId || "Patient") + "</b><small>" +
        (s.mrn ? esc(s.mrn) + " &middot; " : "") + "clinical history</small></div>" +
      '<button class="w-ic" data-w-act="timelineload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Add a clinical note / instruction</h3></div>" +
      '<p class="w-hint">Record clinical findings, care updates, or actionable instructions to nurses, residents, pharmacy or billing.</p>' +
      '<div class="w-grid" style="margin-bottom:8px;">' +
      '<label class="w-f"><span>Entry purpose</span>' +
        '<select id="wTlNoteKind" onchange="var r=document.getElementById(\'wTlRecipients\'); if(r) r.style.display=(this.value===\'clinical\'?\'none\':\'flex\');">' +
          '<option value="clinical">Clinical Note only</option>' +
          '<option value="instruction">Instruction only (written on the chart)</option>' +
          '<option value="both">Both Clinical Note &amp; Instruction</option>' +
        '</select>' +
      '</label></div>' +
      '<div id="wTlRecipients" style="display:none; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:10px; padding:8px 12px; background:var(--w-surface-2, rgba(0,0,0,0.03)); border-radius:6px;">' +
        '<small style="font-weight:600; color:var(--w-ink-dim, #5b7083); width:100%; display:block; margin-bottom:4px;">Addressed to (shown on the chart; no notification is sent):</small>' +
        '<label class="w-f-check" style="margin-right:12px;"><input type="checkbox" id="wNoteRecNurse" checked> Nurse</label>' +
        '<label class="w-f-check" style="margin-right:12px;"><input type="checkbox" id="wNoteRecResident" checked> Resident</label>' +
        '<label class="w-f-check" style="margin-right:12px;"><input type="checkbox" id="wNoteRecLab"> Laboratory</label>' +
        '<label class="w-f-check" style="margin-right:12px;"><input type="checkbox" id="wNoteRecPharm"> Pharmacy</label>' +
        '<label class="w-f-check" style="margin-right:12px;"><input type="checkbox" id="wNoteRecBilling"> Billing</label>' +
      '</div>' +
      /* The words survive a repaint. A refused save used to clear the box, so a clinician who was
       * told "your role cannot do that" also lost the note they had just written - the one moment
       * the text is most worth keeping, because the fix is to fetch someone who CAN sign it, not to
       * type it again. st.noteDraft is held across paints and only cleared on a successful save. */
      '<div style="position:relative;"><textarea id="wTlNote" class="w-input" rows="5" placeholder="Admitted with community-acquired pneumonia. Started on co-amoxiclav 1.2 g IV TDS. Observations improving, remains on 2 L oxygen.">' + esc(state.noteDraft || "") + '</textarea><div style="position:absolute; right:8px; top:8px;">' + micBtn("wTlNote") + '</div></div>' +
      (state.noteErr ? '<p class="w-hint warn">' + ms("warning") + esc(state.noteErr) + "</p>" : "") +
      '<button class="w-btn" data-w-act="timelinenote">' + ms("save") + "Save note / instruction</button></div>" +
      detailPanel(state) +
      '<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>History &middot; " + (t ? t.length : 0) + "</h3></div>" +
      (t == null ? "" : timelineFilterBar(state)) +
      /* The active filter is restated in words above the list. A reader who does not notice a
       * filter is on is reading an incomplete history and does not know it, which is worse than a
       * long list. */
      (t != null && state.timelineFilter
        ? '<p class="w-hint">' + ms("info") + "Showing only " + esc(filterLabel(state.timelineFilter)).toLowerCase() +
          " - " + esc(shown.length) + " of " + esc(t.length) + ". " +
          '<button class="w-btn ghost sm" data-w-act="timelinefilter:all">Show everything</button></p>'
        : "") +
      (t == null ? '<p class="w-empty">Loading the history.</p>'
        : rows ? '<ul class="w-timeline">' + rows + "</ul>"
        : state.timelineFilter ? '<p class="w-empty">Nothing of that kind on this stay.</p>'
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
    var grid = !g && state.flowsheetFailed ? '<p class="w-hint warn">' + ms("error") + "The flowsheet could not be loaded. Do not read this as nothing charted.</p>"
      : !g ? '<p class="w-empty">Loading the flowsheet…</p>'
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
      : '<div class="w-news2 risk-' + esc(n.score.risk || "low") + '"><b>' + esc(n.score.total) + "</b><span>" + esc(n.tool) + " &middot; " + esc(n.score.risk || "") + " risk</span>" +
        // A NEWS2 score is computed, never stored (news2-view.js), so there is no escalation record to link:
        // the signal names the patient and the deterioration category instead.
        (n.patientId && n.score.risk && n.score.risk !== "low" ? '<button class="w-btn tiny ghost" data-w-act="incidentsignalnews2:' + esc(n.patientId) + '">' + ms("report") + "Raise safety signal</button>" : "") + "</div>";

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
        '<div class="w-dose-a">' + (d.readFailed ? '<small class="w-st overdue">Could not read whether this dose was given. Reload before acting.</small>'
          : acts || '<small class="w-empty">No further action.</small>') + "</div></li>";
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

    /* P2.16: the next dose to act on, kept in view on a tablet round. Picked from the server's own due
     * times and the display-only NEXT table above; it claims nothing when the round is empty (loading
     * and empty look the same here) and names no dose at all when any dose could not be read. */
    var nextDose = null, unread = false;
    (state.due || []).forEach(function (d) {
      if (d.readFailed) unread = true;
      else if (nextFor(d.status).length && (!nextDose || Date.parse(d.dueAt) < Date.parse(nextDose.dueAt))) nextDose = d;
    });
    var nextLine = unread ? '<span class="w-next warn">Next due not known: a dose could not be read. Reload before acting.</span>'
      : nextDose ? '<span class="w-next' + (nextDose.overdue ? " warn" : "") + '">Next due: <b>' + esc(nextDose.drug) + "</b> " + dose(nextDose.dose) + " &middot; " + when(nextDose.dueAt) +
        (nextDose.overdue ? " &middot; overdue" : "") + (nextDose.status ? " &middot; " + esc(String(nextDose.status).toLowerCase()) : "") + "</span>" : "";
    return '<div class="w-card w-mar"><div class="w-card-h">' + ms("pill") + "<h3>Medication round</h3>" + nextLine +
      '<button class="w-ic" data-w-act="round" title="Reload the round">' + ms("refresh") + "</button></div>" +
      '<div class="w-mar-body"><div class="w-mar-ctl">' +
      '<div class="w-filter"><input id="wFrom" type="datetime-local" aria-label="Round window from" value="' + esc(state.from) + '">' +
      '<input id="wTo" type="datetime-local" aria-label="Round window to" value="' + esc(state.to) + '">' +
      '<button class="w-btn ghost" data-w-act="round">Load</button></div>' +
      '<div class="w-scan"><label class="w-f"><span>Wristband scan</span><input id="wScanP" type="text" autocomplete="off" placeholder="Patient barcode"></label>' +
      '<label class="w-f"><span>Drug scan</span><input id="wScanD" type="text" autocomplete="off" placeholder="Drug barcode"></label>' +
      /* The second nurse. The hospital's own high-alert list decides which drugs need one, and the
       * SERVER refuses without it - insulin, heparin, opioids. Before this field existed the refusal
       * was correct and unanswerable: a nurse at the bedside had no way to name the witness, so a
       * high-alert dose could not be given from this screen at all. The field is always shown, never
       * shown only for drugs the browser thinks are high-alert: that would be a second copy of the
       * formulary living in the UI. */
      '<label class="w-f"><span>Second nurse <i>high-alert drugs only</i></span><input id="wWitness" type="text" autocomplete="off" placeholder="Witness ID"></label></div></div>' +
      '<div class="w-mar-doses">' +
      (state.roundWarning ? '<p class="w-hint warn">' + ms("error") + esc(state.roundWarning) + "</p>" : "") +
      (rows ? '<ul class="w-doses">' + rows + "</ul>" : state.roundWarning && !(state.due || []).length ? "" : '<p class="w-empty">No doses fall in this window.</p>') +
      (prn ? '<div class="w-sub"><h4>' + ms("touch_app") + 'As needed (PRN)</h4><p class="w-hint">Given on the patient’s need. These are never due at a time.</p><ul class="w-mini">' + prn + "</ul></div>" : "") +
      (unsched ? '<div class="w-sub warn"><h4>' + ms("help") + 'Not on the round</h4><p class="w-hint">The frequency on these orders could not be read, so no dose times were computed. They need a look.</p><ul class="w-mini">' + unsched + "</ul></div>" : "") +
      (state.truncated ? '<p class="w-hint">' + ms("warning") + "More doses fall in this window than can be listed. Narrow it.</p>" : "") +
      "</div></div></div>";
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
      '<label class="w-f"><span>Drug</span><input id="wMoDrug" type="text" autocomplete="off" placeholder="e.g. Thiamine, Paracetamol" value="' + esc(o.drug || "") + '"></label>' +
      '<label class="w-f"><span>Dose</span><input id="wMoValue" type="text" inputmode="decimal" autocomplete="off" value="' + esc(o.value || "") + '"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wMoUnit" type="text" autocomplete="off" placeholder="mg" value="' + esc(o.unit || "") + '"></label>' +
      '<label class="w-f"><span>Route</span><input id="wMoRoute" type="text" autocomplete="off" placeholder="oral / IV" value="' + esc(o.route || "") + '"></label>' +
      '<label class="w-f"><span>Frequency</span><input id="wMoFreq" type="text" autocomplete="off" placeholder="e.g. BD, 8th hourly" value="' + esc(o.frequency || "") + '"></label>' +
      "</div>" +
      '<div class="w-sub" style="margin-top:10px;"><h4>' + ms("water_drop") + "IV Infusion / Diluent Builder (optional)</h4>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Carrier / Diluent</span><select id="wMoDiluent" onchange="var d=document.getElementById(\'wMoDiluentVal\');if(d&&this.value)d.value=this.value;">' +
      '<option value="">None (direct / bolus)</option>' +
      '<option value="100 mL D25">100 mL D25 (25% Dextrose)</option>' +
      '<option value="100 mL NS">100 mL 0.9% Normal Saline (NS)</option>' +
      '<option value="500 mL NS">500 mL 0.9% Normal Saline (NS)</option>' +
      '<option value="500 mL RL">500 mL Ringer Lactate (RL)</option>' +
      '<option value="500 mL D5W">500 mL 5% Dextrose (D5W)</option>' +
      '<option value="100 mL D5W">100 mL 5% Dextrose (D5W)</option>' +
      '<option value="250 mL NS">250 mL Normal Saline (NS)</option>' +
      '</select></label>' +
      '<label class="w-f"><span>Carrier details</span><input id="wMoDiluentVal" type="text" placeholder="e.g. 100 mL D25"></label>' +
      '<label class="w-f"><span>Infusion duration</span><input id="wMoInfDuration" type="text" placeholder="e.g. 3 hrs"></label>' +
      "</div></div>" +
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
      /* Arriving from the timeline's "Open the report" button, the report asked for is marked -
       * a card that scrolls to a list of eight results and highlights none of them has not really
       * opened anything. */
      var picked = state.highlightReportId && r.id === state.highlightReportId;
      return '<li' + (picked ? ' class="w-res-on"' : "") + "><b>" + esc(r.display) + "</b> <span>" + esc(r.status || "") + "</span>" +
        (picked ? ' <span class="w-st due">the one you opened</span>' : "") +
        (r.conclusion ? '<div class="w-res-conc"><b>Impression:</b> ' + esc(r.conclusion) + "</div>" : "") +
        "<small>" + when(r.reportedAt) + "</small></li>";
    }).join("");

    return '' +
      '<div class="w-card"><div class="w-card-h">' + ms("science") + "<h3>Investigations</h3>" +
      '<button class="w-ic" data-w-act="investigations" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Test</span><input id="wInvCode" type="text" autocomplete="off" placeholder="e.g. Chest X-ray, CBC" value="' + esc(o.display || "") + '"></label>' +
      '<label class="w-f"><span>Category</span><select id="wInvCat">' + INV_CATEGORY.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (o.category === c[0] ? " selected" : "") + ">" + esc(c[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Priority</span><select id="wInvPri">' + INV_PRIORITY.map(function (c) { return '<option value="' + esc(c[0]) + '"' + (o.priority === c[0] ? " selected" : "") + ">" + esc(c[1]) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      '<label class="w-f"><span>Reason (optional)</span><input id="wInvReason" type="text" autocomplete="off"></label>' +
      '<button class="w-btn" data-w-act="investigation">' + ms("send") + "Order</button>" +
      (rows ? '<div class="w-sub"><h4>' + ms("checklist") + "On order</h4><ul class=\"w-mini\">" + rows + "</ul></div>" : "") +
      (results ? '<div class="w-sub"><h4>' + ms("fact_check") + "Results &amp; Imaging Reports</h4><ul class=\"w-mini w-results\">" + results + "</ul></div>" : "") +
      "</div>";
  }

  function chartView(state) {
    var s = state.sel || {};
    var isEd = s.class === "ED";
    var isIcu = s.class === "ICU";
    var isMaternity = s.class === "MATERNITY";
    var isPediatric = s.class === "PEDIATRICS" || s.class === "NICU";
    var isNicu = s.class === "NICU";
    var edDemog = s.gender ? (" &middot; <b>" + esc(s.gender).toUpperCase() + (s.ageYears ? ", " + esc(s.ageYears) + "y" : "") + "</b>")
      : "";
    var header = isEd
      ? '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
        "<div><b>" + esc(s.mrn || s.patientId || "") + "</b><small>" + ms("emergency", true) + "ED" + edDemog +
        (s.chiefComplaint ? " &middot; " + esc(s.chiefComplaint) : "") + " &middot; arrived " + when(s.arrivedAt) + "</small></div>" +
        '<button class="w-btn ghost" data-w-act="careplan" title="Goals for this visit and whether each was met">' + ms("flag") + "Care plan</button>" +
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>"
      : '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
        "<div><b>" + esc(s.name || s.patientId || "") + "</b><small>" + (s.name && s.mrn ? esc(s.mrn) + " &middot; " : "") + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + " &middot; admitted " + when(s.admittedAt) + "</small></div>" +
        '<button class="w-btn" data-w-act="consultation" title="Examine, diagnose, prescribe, order and write up - saved together">' + ms("edit_note") + "Consultation</button>" +
        '<button class="w-btn" data-w-act="workspace" title="Everything about this patient on one screen">' + ms("fact_check") + "Workspace</button>" +
        '<button class="w-btn ghost" data-w-act="medrec" title="What this patient was already taking, and what happens to each medicine">' + ms("medication") + "Medicines on arrival</button>" +
        '<button class="w-btn ghost" data-w-act="ordersets" title="A hospital-approved group of orders, each checked on its own">' + ms("checklist") + "Order sets</button>" +
        '<button class="w-btn ghost" data-w-act="pathways" title="Clinical pathways, step progress and enrolments">' + ms("alt_route") + "Pathways</button>" +
        '<button class="w-btn ghost" data-w-act="specialty" title="Specialty framework, templates and tools for this stay">' + ms("local_hospital") + "Specialty</button>" +
        '<button class="w-btn ghost" data-w-act="infusions" title="Running drips, estimated volumes, and the care plan">' + ms("monitor_heart") + "Drips</button>" +
        '<button class="w-btn ghost" data-w-act="careplan" title="Goals for this stay and whether each was met">' + ms("flag") + "Care plan</button>" +
        '<button class="w-btn ghost" data-w-act="tags" title="Issue a wristband and check the band on the patient">' + ms("how_to_reg") + "Wristband</button>" +
        '<button class="w-btn ghost" data-w-act="patientsurgery" title="Operations for this patient and where each one stands">' + ms("fact_check") + "Operations</button>" +
        '<button class="w-btn ghost" data-w-act="wounds" title="Chart a wound and follow it over time">' + ms("healing") + "Wounds</button>" +
        '<button class="w-btn ghost" data-w-act="risks" title="Falls, pressure and whatever else this hospital assesses">' + ms("fact_check") + "Risk</button>" +
        '<button class="w-btn ghost" data-w-act="immunizations" title="Vaccines given, or not given and why">' + ms("vaccines") + "Immunizations</button>" +
        '<button class="w-btn ghost" data-w-act="people" title="Next of kin, guardian, emergency contact, and whether this patient has died">' + ms("person") + "Contacts</button>" +
        '<button class="w-btn ghost" data-w-act="documents" title="Consent forms, referral letters, outside reports">' + ms("description") + "Documents</button>" +
        '<button class="w-btn ghost" data-w-act="forms" title="Triage, nursing assessments, checklists this hospital uses">' + ms("assignment") + "Forms</button>" +
        '<button class="w-btn ghost" data-w-act="referrals" title="Refer this patient to another specialty or facility, and follow the reply">' + ms("send") + "Referrals</button>" +
        '<button class="w-btn ghost" data-w-act="move" title="Transfer to another ward or bed">' + ms("swap_horiz") + "Transfer</button>" +
        '<button class="w-btn ghost" data-w-act="timeline" title="The whole clinical history on one page, and where you add a clinical note">' + ms("history") + "Timeline</button>" +
        '<button class="w-btn ghost" data-w-act="summary" title="Discharge summary">' + ms("description") + "Summary</button>" +
        '<button class="w-btn ghost" data-w-act="wardcloseopen" title="End this stay and record where the patient went">' + ms("home") + "Discharge</button>" +
        '<button class="w-btn ghost" data-w-act="followup" title="Ask for this patient to be seen again">' + ms("schedule") + "Follow-up</button>" +
        '<button class="w-btn ghost" data-w-act="oncologyopen" title="ONCqis link, diagnosis, adverse events, chemo administration">' + ms("labs") + "Oncology</button>" +
        '<button class="w-btn ghost" data-w-act="cardiologyopen" title="KardiQ X link and ECG reference">' + ms("monitor_heart") + "Cardiology</button>" +
        '<button class="w-btn ghost" data-w-act="radiologyopen" title="Imaging worklist, protocol and report">' + ms("medical_information") + "Radiology</button>" +
        '<button class="w-btn ghost" data-w-act="pharmacyopen" title="Verification queue and dispense">' + ms("medication") + "Pharmacy</button>" +
        '<button class="w-btn ghost" data-w-act="txopen" title="Transfusion request, crossmatch, bedside verification">' + ms("bloodtype") + "Blood bank</button>" +
        '<button class="w-btn ghost" data-w-act="consentopen" title="What this patient has agreed to and refused">' + ms("fact_check") + "Consent</button>" +
        '<button class="w-btn ghost" data-w-act="ipsopen" title="The International Patient Summary another hospital would receive for this patient">' + ms("summarize") + "IPS summary</button>" +
        '<button class="w-btn ghost" data-w-act="completionopen" title="What is still outstanding on this chart">' + ms("checklist") + "Chart check</button>" +
        '<button class="w-btn ghost" data-w-act="roiopen" title="Third-party requests to release this record">' + ms("outbox") + "ROI</button>" +
        '<button class="w-btn ghost" data-w-act="tpaopen" title="Claims and pre-authorisations">' + ms("gavel") + "TPA</button>" +
        '<button class="w-btn ghost" data-w-act="billingopen" title="Charges, invoices and claims - no collection here">' + ms("request_quote") + "Billing</button>" +
        '<button class="w-btn ghost" data-w-act="pcopy" title="The copy this patient can be given">' + ms("assignment_ind") + "Patient copy</button></div>";

    var edTopCards = isEd ? (vitalsCard() + noteCard(state)) : "";
    var standardVitalsAndNote = isEd ? "" : (noteCard(state) + vitalsCard());

    return header +
      criticalsCard(state) + (isEd ? (triageCard(state) + edTopCards) : "") + (isMaternity ? pregnancyCard(state) + meowsCard(state) : "") +
      (isPediatric ? ageBandCard(state) : "") +
      problemsCard(state) + activeMedsCard(state) + timelineCard(state) + maikCard(state) + standardVitalsAndNote + flowsheetCard(state) +
      (isIcu ? icuTrendsCard(state) + icuScoresCard(state) + icuAbgCard(state) + icuVentCard(state) + icuSedationCard(state) + icuPressorCard(state) + icuRoundCard(state) : "") +
      fluidCard(state) +
      (isMaternity ? labourCard() + bloodLossCard(state) : "") +
      (isNicu ? neonatalCard() + linesCard(state) : "") +
      ((isEd || isMaternity || isIcu) ? resusCard(state) : "") + (isIcu ? deviceCard(state) : "") +
      medOrderCard(state) + marCard(state) + outboxCard(state) + investigationsCard(state) + pathologyCard(state) +
      (isMaternity ? deliveryCard(state) : "") +
      (isEd ? edProceduresCard(state) + dispositionCard(state) : "");
  }

  /* TRIAGE. The acuity is a human's choice, made once, shown plainly once made - and this card
   * NEVER computes one from the vitals sitting right below it on the same chart. The words each
   * level maps to are ORG content (ACUITY_WORDS is this build's own unapproved seed labelling, not
   * a claim about ESI/CTAS/any named scale); a hospital that has adopted a real one configures its
   * own words the same way note-templates.js already lets it configure its own headings. */
  function triageCard(state) {
    var s = state.sel || {};
    var opts = Object.keys(ACUITY_WORDS).map(function (k) { return '<option value="' + k + '">' + esc(ACUITY_WORDS[k]) + "</option>"; }).join("");
    if (s.acuity != null) {
      /* TRIAGE IS A HISTORY. The current acuity is shown first; every earlier triage stays underneath
       * with who, when and why it changed, and a re-triage (which is also how a reassessment is
       * recorded) asks for its reason. */
      var rec = state.edRecord;
      var history = rec == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading the triage history.</p>"
        : rec.failed ? '<p class="w-hint warn">' + ms("error") + "Could not load the triage history or reassessment time. Do not read this as no earlier triage.</p>"
        : !(rec.triages || []).length ? '<p class="w-empty">No triage history recorded.</p>'
        : '<ul class="w-mini">' + rec.triages.map(function (t) {
          return '<li class="w-mini-row"><div><b>' + (t.retriage ? "Re-triaged" : "Triaged") + ": " + esc(ACUITY_WORDS[t.acuity] || t.acuity) + "</b>" +
            (t.retriage && t.previousAcuity != null ? " (was " + esc(t.previousAcuity) + ")" : "") +
            '<div class="w-dt-times">' + when(t.triagedAt) + (t.triagedBy ? " &middot; by " + esc(t.triagedBy) : "") +
            (t.chiefComplaint ? " &middot; " + esc(t.chiefComplaint) : "") + "</div>" +
            (t.reason ? '<div class="w-dt-times"><b>Reason:</b> ' + esc(t.reason) + "</div>" : "") + "</div></li>";
        }).join("") + "</ul>";
      var reassess = rec && !rec.failed && rec.reassessment ? '<p class="w-hint' + (rec.reassessment.state === "overdue" ? " warn" : "") + '">' + edReassessLine(rec.reassessment) + "</p>" : "";
      return '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Triage</h3></div>" +
        '<div class="w-news2 risk-' + (s.acuity <= 2 ? "high" : s.acuity === 3 ? "medium" : "low") + '"><b>' + esc(s.acuity) + "</b><span>" + esc(ACUITY_WORDS[s.acuity] || "") + "</span></div>" +
        '<p class="w-hint">' + ms("info") + "Triaged " + when(s.triagedAt) + ". Not clinically validated content - this hospital's own scale." + "</p>" +
        reassess + history +
        '<div class="w-sub"><h4>Re-triage or reassess</h4>' +
        '<label class="w-f"><span>Acuity now</span><select id="wRetriageAcuity"><option value="">Choose&hellip;</option>' + opts + "</select></label>" +
        '<label class="w-f"><span>Reason (required)</span><input id="wRetriageReason" placeholder="For example: reassessed, no change"></label>' +
        '<button class="w-btn" data-w-act="retriage">' + ms("save") + "Record re-triage</button></div></div>";
    }
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
        /* A waived element is a DECISION, not an omission: it is never shown as overdue or counting down,
         * which would make a deliberate "not appropriate" read as forgotten care. */
        return "<li" + (e.done || e.notApplicable ? "" : e.overdue ? ' class="overdue"' : "") + '><div class="w-dose-h"><b>' + esc(e.label) + "</b>" +
          (e.done ? '<span class="w-st administered">done ' + when(e.doneAt) + "</span>"
            : e.notApplicable ? '<span class="w-st">not appropriate' + (e.notApplicableReason || e.reason ? ": " + esc(e.notApplicableReason || e.reason) : "") + "</span>"
            : e.overdue ? '<span class="w-st overdue">overdue</span>' : '<span class="w-st">' + esc(Math.round(e.minutesRemaining || 0)) + " min left</span>") +
          "</div>" +
          (!e.done && !e.notApplicable ? '<div class="w-dose-a"><button class="w-btn tiny go" data-w-act="resusmark:' + esc(b.bundleId) + "|" + esc(e.key) + '">' + ms("task_alt") + "Mark done</button>" +
            /* NOT DONE, ON PURPOSE. A bundle element that is deliberately not given - fluids withheld in
             * heart failure, antibiotics already running - used to have no way to say so, so it sat as
             * undone for ever and the bundle read as a failure of care rather than a decision. A waiver
             * needs a reason, and it is recorded as a waiver, never as done. */
            '<button class="w-btn tiny ghost" data-w-act="resuswaive:' + esc(b.bundleId) + "|" + esc(e.key) + '">' + ms("block") + "Not appropriate</button></div>" : "") +
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
  /* ED PROCEDURES. What was done, where, by whom and when, and what went wrong. The time is asked for
   * and never filled in with "now": a drain written up an hour later belongs at the hour it went in. */
  function edProceduresCard(state) {
    var rec = state.edRecord;
    var list = rec == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading procedures.</p>"
      : rec.failed ? '<p class="w-hint warn">' + ms("error") + "Could not load procedures. Do not read this as none done.</p>"
      : !(rec.procedures || []).length ? '<p class="w-empty">No procedures recorded for this ED visit.</p>'
      : '<ul class="w-mini">' + rec.procedures.map(function (p) {
        return '<li class="w-mini-row"><div><b>' + esc(p.name) + "</b>" + (p.site ? " &middot; " + esc(p.site) : "") +
          '<div class="w-dt-times">' + when(p.performedAt) + " &middot; by " + esc(p.performedBy) + "</div>" +
          (p.notes ? '<div class="w-dt-times">' + esc(p.notes) + "</div>" : "") +
          '<div class="w-dt-times"><b>Complications:</b> ' + (p.complications ? esc(p.complications) : "none recorded") + "</div></div></li>";
      }).join("") + "</ul>";
    return '<div class="w-card"><div class="w-card-h">' + ms("healing") + "<h3>Procedures</h3></div>" + list +
      '<div class="w-sub"><h4>Record a procedure</h4><div class="w-grid">' +
      '<label class="w-f"><span>Procedure</span><input id="wProcName" placeholder="For example: chest drain"></label>' +
      '<label class="w-f"><span>Site</span><input id="wProcSite"></label>' +
      '<label class="w-f"><span>Performed by</span><input id="wProcBy"></label>' +
      '<label class="w-f"><span>When</span><input id="wProcAt" type="datetime-local"></label></div>' +
      '<label class="w-f"><span>Notes</span><textarea id="wProcNotes" rows="2"></textarea></label>' +
      '<label class="w-f"><span>Complications</span><input id="wProcComp" placeholder="Leave empty if none"></label>' +
      '<button class="w-btn" data-w-act="edprocsave">' + ms("save") + "Record procedure</button></div></div>";
  }

  function dispositionCard(state) {
    /* REFERRAL from the ED goes through the SAME referral route and record the Referrals screen uses
     * (referral.js); this is only a shorter way to reach it from where the decision is made. */
    var d = state.referrals;
    var refs = d == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading referrals.</p>"
      : d.failed ? '<p class="w-hint warn">' + ms("error") + "Could not load referrals. Do not read this as none.</p>"
      : (d.referrals || []).length ? '<ul class="w-mini">' + d.referrals.map(referralRow).join("") + "</ul>"
      : '<p class="w-empty">No referrals for this patient.</p>';
    var referral = '<div class="w-sub"><h4>' + ms("send") + "Refer</h4>" + refs +
      '<div class="w-grid"><label class="w-f"><span>To (specialty)</span><input id="wRefSpecialty" placeholder="For example: Cardiology"></label>' +
      '<label class="w-f"><span>How soon</span><select id="wRefUrgency"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label>' +
      '<label class="w-f"><span>Where</span><select id="wRefKind"><option value="internal">This hospital</option><option value="external">Another facility</option></select></label>' +
      '<label class="w-f"><span>Facility (if another)</span><input id="wRefFacility"></label></div>' +
      '<label class="w-f"><span>Reason</span><input id="wRefReason"></label>' +
      '<label class="w-f"><span>Clinical summary for the receiving team</span><textarea id="wRefSummary" rows="2"></textarea></label>' +
      '<button class="w-btn ghost" data-w-act="refcreate">' + ms("send") + "Send referral</button></div>";
    return '<div class="w-card"><div class="w-card-h">' + ms("exit_to_app") + "<h3>Disposition</h3></div>" +
      '<p class="w-hint">' + ms("info") + "Ends this ED visit. The chart stays exactly as it is - nothing here is hidden or removed." + "</p>" +
      '<div class="w-dose-a">' +
      '<button class="w-btn" data-w-act="dispositionadmit">' + ms("bed") + "Admit</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:home">' + ms("home") + "Home</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:transferred">' + ms("local_shipping") + "Transfer</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:lwbs">' + ms("directions_walk") + "LWBS</button>" +
      '<button class="w-btn ghost" data-w-act="disposition:deceased">' + ms("healing") + "Deceased</button>" +
      "</div>" + referral + "</div>";
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

    /* D5: WHAT THE PORTAL WILL SHOW, drawn by the portal's own renderer (portal.js dischargeSection) from the
     * server's own answer (patient-record.js portalPreview, the portal's function over the same facts), so
     * the preview cannot drift from the patient's page. Staff only: never printed on the handout. */
    var P = G.WSQPortal, pv = r.portalPreview, pscope = state.pcopyScope === "full" ? "full" : "patient-copy";
    var portalPreview = '<section class="w-dt-p w-noprint" data-w-portal-preview="' + pscope + '"><h3>What the patient portal will show</h3>' +
      (!pv ? '<p class="w-hint warn">' + ms("error") + "Could not work out what the portal will show. Do not assume it matches this page.</p>"
        : !P ? '<p class="w-hint warn">' + ms("error") + "The portal preview cannot be drawn on this screen. Reload the page before recording the handover.</p>"
        : (pv.checked ? "" : '<p class="w-hint warn">' + ms("warning") + "Results and diagnoses could not be checked just now, so the portal would withhold every one of them.</p>") +
          '<p class="w-dt-times">' + (r.release ? "The discharge summary as the patient's own portal access now shows it" : "The discharge summary as the patient's own portal access will show it once you record this handover") +
          ", in English. A family member sees only what their access allows.</p>" + P.dischargeSection("ok", pv.scopes[pscope])) + "</section>";

    return '<div class="w-dt">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      '<button class="w-btn" data-w-act="printpack">' + ms("print") + "Print</button>" +
      /* P2: what the patient portal shows of a signed discharge summary this handover releases. The patient
       * copy is the default; a full summary still withholds what this page withholds. */
      '<label class="w-f"><span>Discharge summary in the portal</span><select id="wPcopyScope">' +
        '<option value="patient-copy">Patient copy (stay, medicines, care instructions)</option>' +
        '<option value="full"' + (pscope === "full" ? " selected" : "") + '>Full summary (all sections; withheld entries stay withheld)</option></select></label>' +
      '<button class="w-btn ghost" data-w-act="pcopyGive" title="Record that you gave this to the patient">' + ms("how_to_reg") + "Record handover</button>" +
      '<button class="w-btn ghost" data-w-act="pcopy">' + ms("refresh") + "Refresh</button></div>" +
      '<header class="w-dt-h"><h2>Your record</h2>' +
      "<p><b>" + esc(p.name || r.patientId || "") + "</b>" + (p.mrn ? " &middot; " + esc(p.mrn) : "") + (p.dob ? " &middot; " + esc(p.dob) : "") + "</p>" +
      /* Two audiences, and they are never mixed. `statements` is addressed to the patient and
       * prints. `clinicianWarnings` is w-noprint: a line reading "not for the patient" printed on
       * the patient's own copy would be the most careless thing on the page. */
      (r.statements || []).map(function (s) { return '<p class="w-dt-warn">' + esc(s) + "</p>"; }).join("") +
      (r.clinicianWarnings || []).map(function (s) { return '<p class="w-dt-gap w-noprint">' + esc(s) + "</p>"; }).join("") +
      (r.release ? '<p class="w-ok w-noprint">Handover recorded at ' + when(r.release.at) + "." +
        ((r.release.dischargeSummaries || []).length ? " Discharge summary released to the portal as the " + (r.release.dischargeScope === "full" ? "full summary." : "patient copy.") : "") + "</p>" : "") +
      "</header>" + portalPreview +
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
  /* P2.5 IPS SUMMARY (functions/_wardsynq/fhir-ips.js): the document /ward/fhir/Patient/{id}/$summary returns,
   * read back section by section. null = loading, failed = the whole summary could not be had. Within it
   * a section that could not be read and a section with nothing recorded are different sentences, and
   * neither is ever shown as "no known allergies". Entries are drawn from the resources in the Bundle
   * with esc(), never from the server's narrative HTML. */
  function ipsView(state) {
    var d = state.ips;
    var bar = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button><h3>International Patient Summary</h3>" +
      '<button class="w-ic" data-w-act="ipsopen" title="Refresh">' + ms("refresh") + "</button></div>";
    if (d === null || d === undefined) return '<div class="w-card">' + bar + '<p class="w-empty">Loading the summary...</p></div>';
    if (d.failed) return '<div class="w-card">' + bar + '<p class="w-hint warn">' + ms("error") + "The summary could not be produced: " + esc(d.failed) + ". Nothing is known from this screen about this patient's problems, allergies, medicines or vaccines.</p></div>";
    var byRef = {};
    (d.entry || []).forEach(function (e) { if (e.resource) byRef[e.resource.resourceType + "/" + e.resource.id] = e.resource; });
    var comp = (d.entry && d.entry[0] && d.entry[0].resource) || {};
    var label = function (r) {
      var cc = r.code || r.medicationCodeableConcept || r.vaccineCode || {};
      var name = cc.text || (cc.coding && cc.coding[0] && (cc.coding[0].display || cc.coding[0].code)) || r.resourceType;
      var q = r.valueQuantity, v = q ? " " + q.value + (q.unit ? " " + q.unit : "") : (r.valueString ? " " + r.valueString : "");
      if (r.resourceType === "Immunization" && r.status === "not-done") v = " - not given" + (r.statusReason && r.statusReason.text ? ": " + r.statusReason.text : "");
      var when = r.effectiveDateTime || r.authoredOn || r.recordedDate || r.occurrenceDateTime || "";
      return esc(name + v) + (when ? ' <span class="w-dt-times">' + esc(String(when).slice(0, 10)) + "</span>" : "");
    };
    var sections = (comp.section || []).map(function (s) {
      var body;
      var why = s.emptyReason && s.emptyReason.coding && s.emptyReason.coding[0] && s.emptyReason.coding[0].code;
      if (why) body = '<p class="w-warn">' + ms("error") + (why === "withheld" ? "Not shown: your access does not include this section." : "Could not be read. This is not the same as none.") + "</p>";
      else if (s.emptyReason) body = '<p class="w-empty">None recorded in this record. That is not a statement that the patient has none.</p>';
      else body = '<ul class="w-mini">' + (s.entry || []).map(function (e) { var r = byRef[e.reference]; return '<li class="w-mini-row"><div>' + (r ? label(r) : esc(e.reference)) + "</div></li>"; }).join("") + "</ul>";
      return '<div class="w-sub"><h4>' + esc(s.title) + "</h4>" + body + "</div>";
    }).join("");
    return '<div class="w-card">' + bar + '<p class="w-dt-times">Generated ' + when(d.timestamp) + (comp.author && comp.author[0] ? " by " + esc(comp.author[0].display || "") : "") + "</p>" + sections + "</div>";
  }
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
  var TPA_CHANNEL_WORDS = { not_configured: "not configured, nothing sent", queued: "queued for the manual process", sent: "sent, not yet acknowledged", acknowledged: "acknowledged by the payer", failed: "failed" };
  function tpaPayerName(payers, id) {
    for (var i = 0; i < (payers || []).length; i++) if (payers[i].id === id) return payers[i].name;
    return id ? id + " (not configured)" : "no payer recorded";
  }
  function tpaPayerSelect(id, payers) {
    return '<select id="' + id + '"><option value="">No payer</option>' + (payers || []).map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name) + " &middot; " + esc(p.adapter) +
        (p.adapter === "fhir-claim" && !p.endpointConfigured ? " (no endpoint)" : "") + "</option>";
    }).join("") + "</select>";
  }
  function tpaView(state) {
    if (!state.tpa) return '<div class="w-card"><h3>TPA / Claims</h3><p class="w-empty">Loading claims&hellip;</p></div>';
    var t = state.tpa;
    if (t.failed) {
      return '<div class="w-card"><div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
        "<h3>TPA / Claims</h3><button class=\"w-btn ghost\" data-w-act=\"tpaopen\">" + ms("refresh") + "Retry</button></div>" +
        '<p class="w-hint warn">' + ms("warning") + "Claims could not be read. This is not the same as this patient having none.</p></div>";
    }
    var warnMap = t.payerWarnings || {};
    var claimRows = (t.claims || []).map(function (c) {
      var actions = "";
      var stl = c.settlement;
      if (c.state === "coded") actions = '<button class="w-btn ghost sm" data-w-act="claimsubmit:' + esc(c.id) + '">' + ms("send") + "Submit</button>";
      else if (c.state === "submitted" || c.state === "queried") {
        actions = '<button class="w-btn ghost sm" data-w-act="claimadjudicate:' + esc(c.id) + '">' + ms("gavel") + "Adjudicate</button>" +
          '<button class="w-btn ghost sm" data-w-act="claimack:' + esc(c.id) + '">' + ms("mark_email_read") + "Acknowledged</button>" +
          '<button class="w-btn ghost sm" data-w-act="claimsettle:' + esc(c.id) + '">' + ms("payments") + "Settle</button>" +
          '<button class="w-btn ghost sm" data-w-act="claimdeny:' + esc(c.id) + '">' + ms("cancel") + "Deny</button>";
      } else if (c.state === "denied") actions = '<button class="w-btn ghost sm" data-w-act="claimresubmit:' + esc(c.id) + '">' + ms("refresh") + "Resubmit</button>";
      else if (c.state === "paid" && stl && stl.balanceWith !== "patient" && stl.outstandingAmount > 0) {
        actions = '<button class="w-btn ghost sm" data-w-act="claimbalance:' + esc(c.id) + '">' + ms("person") + "Move balance to patient</button>";
      }
      var resubs = (c.submissions || []).filter(function (x) { return x.resubmission; });
      var warns = warnMap[c.id] || [];
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
        '<div class="w-dt-times">payer: ' + esc(tpaPayerName(t.payers, c.payerId)) + (c.payerReference ? " &middot; payer ref " + esc(c.payerReference) : "") + "</div>" +
        (c.adapter ? '<div class="w-dt-times">payer channel: ' + esc(TPA_CHANNEL_WORDS[c.adapter.state] || c.adapter.state) + (c.adapter.note ? " - " + esc(c.adapter.note) : "") + "</div>" : "") +
        (resubs.length ? '<div class="w-dt-times">resubmitted ' + resubs.length + " time" + (resubs.length > 1 ? "s" : "") + ": " + resubs.map(function (x) { return esc(x.reason || "no reason recorded"); }).join("; ") + "</div>" : "") +
        (stl ? '<div class="w-dt-times">settled: paid ' + esc(stl.paidAmount) +
          (stl.approvedAmount != null ? " of " + esc(stl.approvedAmount) + " approved" : " (approved amount not recorded)") +
          (stl.shortPaidAmount ? " &middot; short " + esc(stl.shortPaidAmount) + ": " + esc(stl.shortPaymentReason) : "") +
          (stl.disallowances && stl.disallowances.length ? " &middot; disallowed: " + stl.disallowances.map(function (d) { return esc(d.reason) + (d.amount != null ? " (" + esc(d.amount) + ")" : ""); }).join("; ") : "") +
          (stl.outstandingAmount != null ? " &middot; outstanding " + esc(stl.outstandingAmount) : " &middot; outstanding unknown") +
          " &middot; balance with " + esc(stl.balanceWith) + (stl.patientBalance ? " (" + esc(stl.patientBalance.amount) + ": " + esc(stl.patientBalance.reason) + ")" : "") + "</div>" : "") +
        (warns.length ? warns.map(function (w) { return '<div class="w-warn">' + esc(w) + "</div>"; }).join("") : "") +
        "</div>" + (actions ? '<div class="w-mini-row-act">' + actions + "</div>" : "") + "</li>";
    }).join("");
    var authRows = (t.preAuthorisations || []).map(function (a) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(a.state) + '">' + esc(a.state) + "</span> " +
        "<b>" + esc(a.treatment) + "</b>" + (a.scheme ? " &middot; " + esc(a.scheme) : "") +
        (a.authorizedAmount != null ? " &middot; " + esc(a.authorizedAmount) : "") +
        (a.reason ? " &middot; " + esc(a.reason) : "") +
        (a.payerId ? '<div class="w-dt-times">payer: ' + esc(tpaPayerName(t.payers, a.payerId)) + (a.adapter ? " &middot; " + esc(TPA_CHANNEL_WORDS[a.adapter.state] || a.adapter.state) + (a.adapter.note ? " - " + esc(a.adapter.note) : "") : "") + "</div>" : "") +
        '<div class="w-dt-times">' + esc(a.note || "") + "</div></div></li>";
    }).join("");
    var estRows = (t.estimates || []).map(function (e) {
      return '<li class="w-mini-row"><div><span class="w-st">estimate</span> <b>' + esc(e.estimatedAmount) + " " + esc(e.currency || "") + "</b>" +
        " &middot; " + esc(tpaPayerName(t.payers, e.payerId)) + " &middot; " + when(e.at) +
        '<div class="w-dt-times">' + (e.lines || []).map(function (l) { return esc(l.code) + " x" + esc(l.quantity) + " = " + esc(l.amount); }).join(", ") + "</div>" +
        ((e.unpriced || []).length ? '<div class="w-warn">Not priced, not in the total: ' + e.unpriced.map(function (l) { return esc(l.code); }).join(", ") + "</div>" : "") +
        '<div class="w-dt-times">' + esc(e.note || "") + "</div></div></li>";
    }).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>TPA / Claims</h3><button class=\"w-btn ghost\" data-w-act=\"tpaopen\">" + ms("refresh") + "Refresh</button></div>" +
      '<div class="w-sub"><h4>Claims</h4>' +
      (claimRows ? "<ul class=\"w-mini\">" + claimRows + "</ul>" : '<p class="w-empty">No claim has been coded for this patient.</p>') +
      '<input id="wTpaCodes" placeholder="Codes to claim, comma-separated">' +
      tpaPayerSelect("wTpaPayer", t.payers) +
      '<input id="wTpaPolicy" placeholder="Policy number (optional)">' +
      '<button class="w-btn" data-w-act="claimcode">' + ms("receipt_long") + "Code claim</button></div>" +
      '<div class="w-sub"><h4>Pre-authorisations</h4>' +
      (authRows ? "<ul class=\"w-mini\">" + authRows + "</ul>" : '<p class="w-empty">No pre-authorisation has been recorded for this patient.</p>') +
      '<input id="wTpaTreatment" placeholder="Treatment">' +
      '<input id="wTpaScheme" placeholder="Scheme (optional)">' +
      '<select id="wTpaAuthState">' + PREAUTH_STATES.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wTpaAuthReason" placeholder="Reason (required if refused)">' +
      '<input id="wTpaAuthAmount" placeholder="Authorized amount (if approved)">' +
      tpaPayerSelect("wTpaAuthPayer", t.payers) +
      '<input id="wTpaAuthRequested" placeholder="Requested amount (sent with a requested pre-auth)">' +
      '<button class="w-btn" data-w-act="preauth">' + ms("fact_check") + "Record</button></div>" +
      '<div class="w-sub"><h4>Estimates</h4>' +
      (t.estimatesUnreadable ? '<p class="w-hint warn">' + ms("warning") + "Estimates could not be read.</p>"
        : estRows ? "<ul class=\"w-mini\">" + estRows + "</ul>" : '<p class="w-empty">No estimate has been prepared for this patient.</p>') +
      '<input id="wTpaEstLines" placeholder="Tariff lines, e.g. BED x3, CONSULT">' +
      tpaPayerSelect("wTpaEstPayer", t.payers) +
      '<button class="w-btn" data-w-act="estimate">' + ms("calculate") + "Prepare estimate</button>" +
      '<p class="w-hint">' + ms("info") + "An estimate is priced from the hospital tariff. It is not a bill and not a payer approval.</p></div>" +
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Billing</h3><button class=\"w-btn ghost\" data-w-act=\"billingopen\">" + ms("refresh") + "Refresh</button></div>" +
      (b.outstandingBalance != null ? '<p class="w-dt-times">Outstanding: ' + esc(b.outstandingBalance) + "</p>" : "") +
      '<div class="w-sub"><h4>Invoices</h4>' + (!state.billing ? '<p class="w-empty">Loading...</p>' : b.invoices === null ? '<p class="w-hint warn">' + ms("error") + "Invoices could not be loaded. Do not read this as none.</p>"
        : invRows ? "<ul class=\"w-mini\">" + invRows + "</ul>" : '<p class="w-empty">No invoice has been raised for this patient.</p>') + "</div>" +
      '<div class="w-sub"><h4>Claims</h4>' + (!state.billing ? '<p class="w-empty">Loading...</p>' : b.claims === null ? '<p class="w-hint warn">' + ms("error") + "Claims could not be loaded. Do not read this as none.</p>"
        : claimRows ? "<ul class=\"w-mini\">" + claimRows + "</ul>" : '<p class="w-empty">No claim has been coded for this patient.</p>') + "</div>" +
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
    var totals = state.balanceFailed ? '<p class="w-hint warn">' + ms("error") + "Fluid balance could not be loaded. Do not read this as nothing charted.</p>"
      : !b ? '<p class="w-empty">No fluid charted for this period.</p>'
      : '<div class="w-bal">' +
          '<div class="w-bal-c"><span>In</span><b>' + esc(b.intake) + " mL</b></div>" +
          '<div class="w-bal-c"><span>Out</span><b>' + esc(b.output) + " mL</b></div>" +
          '<div class="w-bal-c net"><span>Balance</span><b>' + (b.balance > 0 ? "+" : "") + esc(b.balance) + " mL</b></div>" +
        "</div>" +
        (b.complete
          ? '<p class="w-hint">' + ms("check_circle") + "Every hour of this period has an entry.</p>"
          : '<p class="w-hint warn">' + ms("error") + esc(b.gaps.length) + " of the last " + esc(b.gaps.length + b.hours.length) +
            " hours have nothing charted. Read this balance as incomplete.</p>");
    var inOpts = opts(FLUID_IN);
    var outOpts = opts(FLUID_OUT);
    var curDir = state.fluidDir || "intake";
    return '<div class="w-card"><div class="w-card-h">' + ms("water_drop") + "<h3>Fluid balance</h3>" +
      '<button class="w-ic" data-w-act="balance" title="Refresh">' + ms("refresh") + "</button></div>" +
      totals +
      '<div class="w-fluid"><select id="wFDir" onchange="var k=document.getElementById(\'wFKind\');if(k){k.innerHTML=this.value===\'output\'?\'' + outOpts.replace(/'/g, "\\'") + '\':\'' + inOpts.replace(/'/g, "\\'") + '\';}">' +
      '<option value="intake"' + (curDir === "intake" ? " selected" : "") + '>Intake</option>' +
      '<option value="output"' + (curDir === "output" ? " selected" : "") + '>Output</option></select>' +
      '<select id="wFKind">' + (curDir === "output" ? outOpts : inOpts) + "</select>" +
      '<input id="wFVal" type="text" inputmode="decimal" placeholder="mL" autocomplete="off">' +
      '<button class="w-btn" data-w-act="fluid">' + ms("add") + "Chart</button></div>" +
      '<p class="w-hint">Volumes are recorded in mL. Intake includes IV, oral, NG. Output includes urine, drain, vomit, stool, blood loss.</p></div>';
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
      (state.devices === false ? '<p class="w-hint warn">' + ms("error") + "Devices could not be loaded. Do not read this as no monitor attached.</p>"
        : state.devices == null ? '<p class="w-empty">Loading devices...</p>'
        : rows ? '<ul class="w-devices">' + rows + "</ul>" : '<p class="w-empty">No monitor currently associated with this patient.</p>') +
      '<div class="w-filter"><input id="wDevId" type="text" placeholder="Device ID" autocomplete="off">' +
      '<input id="wDevTag" type="text" placeholder="Scan asset tag" autocomplete="off">' +
      '<input id="wDevWrist" type="text" placeholder="Scan wristband" autocomplete="off">' +
      '<button class="w-btn" data-w-act="deviceassociate">' + ms("sensors") + "Associate</button></div>" +
      '<p class="w-hint">' + ms("info") + "Both codes must be scanned and must match this patient - a device found in the room is not the same as a device confirmed on the patient." + "</p></div>";
  }


  /* ---- ICU (P1.12). Everything below renders what functions/_wardsynq/icu-care.js returned from
   * /ward/icu and computes nothing clinical of its own: the SOFA, the dose and the sepsis screen are
   * the server's, with the server's reasons. Loading, failed and empty are three different sentences
   * on every card, because on an ICU chart "no gas on record" and "the gases did not load" lead to
   * opposite decisions. */
  function icuState(state, what) {
    if (state.icu === false) return '<p class="w-hint warn">' + ms("error") + "The ICU record could not be loaded. Do not read this as no " + what + " on record.</p>";
    if (state.icu == null) return '<p class="w-empty">Loading the ICU record...</p>';
    return "";
  }
  function icuHead(icon, title) {
    return '<div class="w-card"><div class="w-card-h">' + ms(icon) + "<h3>" + title + "</h3>" +
      '<button class="w-ic" data-w-act="icuload" title="Refresh">' + ms("refresh") + "</button></div>";
  }
  function icuWhen() {
    return '<label class="w-f"><span>Time (blank is now)</span><input id="wIcuAt" type="datetime-local" autocomplete="off"></label>';
  }
  function icuNum(id, label) {
    return '<label class="w-f"><span>' + label + '</span><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off"></label>';
  }

  /* SPARKLINES. One small inline SVG per vital from the flowsheet grid already on this chart (no
   * library, no second read). An hour nobody charted is a BREAK in the line: points are joined only
   * between neighbouring charted hours, so a gap is never drawn as a straight line that implies
   * somebody measured something in between. */
  var ICU_TRENDS = [["8867-4", "Heart rate"], ["BP", "Blood pressure"], ["59408-5", "SpO2"], ["8310-5", "Temperature"], ["9279-1", "Respiratory rate"]];
  function sparkline(series) {
    var W = 160, H = 32, all = [];
    series.forEach(function (cells) { cells.forEach(function (c) { if (!c.empty && typeof c.value === "number") all.push(c.value); }); });
    if (!all.length) return "";
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), span = hi - lo || 1;
    var out = "";
    series.forEach(function (cells) {
      var n = cells.length, seg = [], segs = [];
      cells.forEach(function (c, i) {
        if (c.empty || typeof c.value !== "number") { if (seg.length) segs.push(seg); seg = []; return; }
        var x = n > 1 ? (i / (n - 1)) * (W - 4) + 2 : W / 2, y = H - 2 - ((c.value - lo) / span) * (H - 4);
        seg.push(x.toFixed(1) + "," + y.toFixed(1));
      });
      if (seg.length) segs.push(seg);
      segs.forEach(function (s) {
        out += s.length > 1 ? '<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + s.join(" ") + '"/>'
          : '<circle r="1.8" fill="currentColor" cx="' + s[0].split(",")[0] + '" cy="' + s[0].split(",")[1] + '"/>';
      });
    });
    return '<svg class="w-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="trend">' + out + "</svg>";
  }
  function icuTrendsCard(state) {
    var g = state.flowsheet;
    var body;
    if (state.flowsheetFailed) body = '<p class="w-hint warn">' + ms("error") + "The flowsheet could not be loaded, so no trends can be drawn. Do not read this as stable.</p>";
    else if (!g) body = '<p class="w-empty">Loading trends...</p>';
    else {
      var byCode = {};
      (g.rows || []).forEach(function (r) { byCode[r.code] = r; });
      var rows = ICU_TRENDS.map(function (t) {
        var series = t[0] === "BP" ? [byCode["8480-6"], byCode["8462-4"]].filter(Boolean) : [byCode[t[0]]].filter(Boolean);
        var cells = series.length ? series.map(function (r) { return r.cells || []; }) : [];
        var svg = cells.length ? sparkline(cells) : "";
        var last = null;
        series.forEach(function (r, k) { var cs = (r.cells || []).filter(function (c) { return !c.empty; }); if (cs.length) last = (last ? last + "/" : "") + cs[cs.length - 1].value; });
        return "<li><b>" + esc(t[1]) + "</b>" + (svg ? svg + "<span>" + esc(last) + "</span>" : "<span>Nothing charted in this window.</span>") + "</li>";
      }).join("");
      body = '<ul class="w-mini">' + rows + "</ul>" +
        '<p class="w-hint">' + ms("info") + "Last 24 hours. A break in a line is an hour nobody charted; it is not filled in.</p>";
    }
    return '<div class="w-card"><div class="w-card-h">' + ms("show_chart") + "<h3>Trends</h3>" +
      '<button class="w-ic" data-w-act="flowsheet" title="Refresh">' + ms("refresh") + "</button></div>" + body + "</div>";
  }

  function icuScoresCard(state) {
    var head = icuHead("monitor_heart", "Sepsis screen and SOFA");
    var wait = icuState(state, "score"); if (wait) return head + wait + "</div>";
    var sp = state.icu.sepsis || {}, so = state.icu.sofa || {};
    var spCls = sp.result === "screen-positive" ? "risk-high" : sp.result === "cannot-screen" ? "na" : "risk-low";
    var comps = (so.components || []).map(function (c) {
      return "<li><b>" + esc(c.label) + "</b><span>" + (c.score == null ? "not scored: " + esc(c.reason) : esc(c.score) + (c.from ? " (" + esc(c.from) + ")" : "") + (c.caution ? " " + esc(c.caution) : "")) + "</span></li>";
    }).join("");
    return head +
      '<div class="w-news2 ' + spCls + '"><b>Sepsis</b><span>' + esc(sp.say || "") + "</span></div>" +
      (sp.result === "screen-positive" ? '<p class="w-hint warn">' + ms("emergency") + "If a clinician suspects sepsis, the Code Sepsis bundle can be started from the Resuscitation card. Nothing has been started.</p>" : "") +
      '<div class="w-news2 ' + (so.total == null ? "na" : so.partial ? "risk-medium" : "risk-low") + '"><b>' + (so.total == null ? "SOFA" : esc(so.total)) + "</b><span>" + esc(so.say || "") + "</span></div>" +
      (comps ? '<ul class="w-mini">' + comps + "</ul>" : "") +
      '<p class="w-hint">' + ms("info") + esc(state.icu.advisory || "") + "</p></div>";
  }

  function icuAbgCard(state) {
    var head = icuHead("bloodtype", "Blood gas");
    var wait = icuState(state, "blood gas");
    var cur = !wait && state.icu.abg && state.icu.abg.current;
    var shown = wait || (!cur ? '<p class="w-empty">No blood gas on record.</p>' : (function () {
      var i = cur.interpretation || {};
      return '<p class="w-hint">' + esc(cur.sampleType || "") + " " + when(cur.at) + ": pH " + esc(cur.ph == null ? "-" : cur.ph) + ", pCO2 " + esc(cur.pco2 == null ? "-" : cur.pco2) +
        ", pO2 " + esc(cur.po2 == null ? "-" : cur.po2) + ", HCO3 " + esc(cur.hco3 == null ? "-" : cur.hco3) + ", BE " + esc(cur.baseExcess == null ? "-" : cur.baseExcess) +
        ", lactate " + esc(cur.lactate == null ? "-" : cur.lactate) + ", FiO2 " + esc(cur.fio2 == null ? "-" : Math.round(cur.fio2 * 100) + "%") + "</p>" +
        (i.interpretable ? "<p><b>" + esc(i.primary) + "</b>" + (i.compensation ? ". " + esc(i.compensation) : "") + "</p>" : '<p class="w-hint warn">' + ms("warning") + esc(i.reason) + "</p>") +
        (i.caution ? '<p class="w-hint warn">' + esc(i.caution) + "</p>" : "") +
        "<p>" + (i.pf != null ? "P/F ratio " + esc(i.pf) + (i.pfBand ? " (" + esc(i.pfBand) + ")" : "") : esc(i.pfReason || "")) + "</p>";
    })());
    return head + shown +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Sample</span><select id="wAbgType"><option value="">Choose...</option><option value="arterial">Arterial</option><option value="venous">Venous</option></select></label>' +
      icuNum("wAbgPh", "pH") + icuNum("wAbgPco2", "pCO2 (mmHg)") + icuNum("wAbgPo2", "pO2 (mmHg)") + icuNum("wAbgHco3", "HCO3 (mmol/L)") +
      icuNum("wAbgBe", "Base excess") + icuNum("wAbgLac", "Lactate (mmol/L)") + icuNum("wAbgFio2", "FiO2 (%)") + icuWhen() +
      "</div>" + '<button class="w-btn" data-w-act="icuabg">' + ms("save") + "Record gas</button></div>";
  }

  function icuVentCard(state) {
    var head = icuHead("air", "Ventilator settings");
    var wait = icuState(state, "ventilator setting");
    var v = !wait && state.icu.ventilator;
    var line = function (x) {
      return esc(x.mode) + (x.tidalVolumeMl != null ? ", Vt " + esc(x.tidalVolumeMl) + " mL" : "") + (x.rate != null ? ", rate " + esc(x.rate) : "") +
        (x.peep != null ? ", PEEP " + esc(x.peep) : "") + (x.fio2 != null ? ", FiO2 " + Math.round(x.fio2 * 100) + "%" : "") +
        (x.peakPressure != null ? ", peak " + esc(x.peakPressure) : "") + (x.plateauPressure != null ? ", plateau " + esc(x.plateauPressure) : "");
    };
    var shown = wait || (!v.current ? '<p class="w-empty">No ventilator settings on record.</p>'
      : "<p><b>Now:</b> " + line(v.current) + " <small>" + when(v.current.at) + "</small></p>" +
        (v.history.length > 1 ? '<ul class="w-mini">' + v.history.slice(1).map(function (x) { return "<li>" + line(x) + "<span>" + when(x.at) + "</span></li>"; }).join("") + "</ul>" : ""));
    var modes = ((state.icu && state.icu.ventModes) || ["VC-AC", "PC-AC", "SIMV", "PSV", "CPAP", "PRVC", "APRV", "NIV-BiPAP", "HFNC", "other"]).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");
    return head + shown +
      '<div class="w-grid"><label class="w-f"><span>Mode</span><select id="wVentMode"><option value="">Choose...</option>' + modes + "</select></label>" +
      icuNum("wVentVt", "Tidal volume (mL)") + icuNum("wVentRate", "Rate") + icuNum("wVentPeep", "PEEP") + icuNum("wVentFio2", "FiO2 (%)") +
      icuNum("wVentPeak", "Peak pressure") + icuNum("wVentPlat", "Plateau pressure") + icuWhen() + "</div>" +
      '<button class="w-btn" data-w-act="icuvent">' + ms("save") + "Record settings</button></div>";
  }

  function icuSedationCard(state) {
    var head = icuHead("bedtime", "Sedation");
    var wait = icuState(state, "sedation score");
    var sd = !wait && state.icu.sedation;
    var shown = wait || (!sd.current ? '<p class="w-empty">No RASS on record.</p>'
      : '<p class="w-hint' + (sd.status && sd.status.onTarget === false ? " warn" : "") + '">' + esc(sd.status.say) + " <small>" + when(sd.current.at) + "</small></p>" +
        (sd.current.gcs != null ? "<p>GCS " + esc(sd.current.gcs) + "</p>" : ""));
    var opts = ""; for (var r = 4; r >= -5; r--) opts += '<option value="' + r + '">' + (r > 0 ? "+" + r : r) + "</option>";
    return head + shown +
      '<div class="w-grid"><label class="w-f"><span>RASS</span><select id="wSedRass"><option value="">Choose...</option>' + opts + "</select></label>" +
      '<label class="w-f"><span>Target from</span><select id="wSedLo"><option value="">None</option>' + opts + "</select></label>" +
      '<label class="w-f"><span>Target to</span><select id="wSedHi"><option value="">None</option>' + opts + "</select></label>" +
      icuNum("wSedGcs", "GCS (optional)") + icuWhen() + "</div>" +
      '<button class="w-btn" data-w-act="icused">' + ms("save") + "Record sedation</button></div>";
  }

  function icuPressorCard(state) {
    var head = icuHead("vaccines", "Vasopressors");
    var wait = icuState(state, "vasopressor");
    var list = !wait && state.icu.vasopressors;
    var shown = wait || (!list.length ? '<p class="w-empty">No vasoactive infusion on record.</p>'
      : '<ul class="w-mini">' + list.map(function (p) {
        return "<li><b>" + esc(p.drug) + (p.running ? "" : " (stopped)") + "</b><span>" +
          (p.dose && p.dose.value != null ? esc(p.dose.value) + " mcg/kg/min (" + esc(p.dose.workings) + ")" : "Dose not worked out: " + esc(p.dose && p.dose.reason)) +
          "</span></li>";
      }).join("") + "</ul>" +
        '<p class="w-hint">' + ms("info") + "The concentration is what was recorded when the infusion was charted in Drips. It is never assumed.</p>");
    return head + shown + "</div>";
  }

  function icuRoundCard(state) {
    var head = icuHead("fact_check", "ICU round checklist");
    var wait = icuState(state, "round");
    var latest = !wait && state.icu.rounds && state.icu.rounds.latest;
    var words = { yes: "Yes", no: "No", "not-applicable": "Not applicable", "not-assessed": "Not assessed" };
    var shown = wait || (!latest ? '<p class="w-empty">No round checklist recorded.</p>'
      : '<p class="w-hint">Last round ' + when(latest.at) + (latest.by ? " by " + esc(latest.by) : "") + ": " + esc(latest.assessed) + " of " + esc(latest.of) + " assessed.</p>" +
        '<ul class="w-mini">' + latest.items.map(function (i) { return "<li><b>" + esc(i.label) + "</b><span>" + esc(words[i.answer] || i.answer) + (i.note ? ": " + esc(i.note) : "") + "</span></li>"; }).join("") + "</ul>");
    var items = (state.icu && state.icu.roundItems) || [];
    var form = items.length ? '<div class="w-grid">' + items.map(function (i) {
      return '<label class="w-f"><span>' + esc(i.label) + '</span><select id="wRound_' + esc(i.key) + '"><option value="">Not assessed</option><option value="yes">Yes</option><option value="no">No</option><option value="not-applicable">Not applicable</option></select></label>';
    }).join("") + icuWhen() + "</div>" + '<button class="w-btn" data-w-act="icuround">' + ms("save") + "Record round</button>" : "";
    return head + shown + form + '<p class="w-hint">' + ms("info") + "An item left blank is recorded as not assessed, never as no.</p></div>";
  }

  /* PREGNANCY EPISODE. Gravida/para/gestation, recorded exactly as entered - para only ever changes
   * on its own when a real delivery is recorded (migrate-maternity.js), never edited here. */
  function pregnancyCard(state) {
    var p = state.maternity && state.maternity.pregnancy;
    var ms_ = state.maternity && state.maternity.status;
    /* A failed load is not "no pregnancy recorded". On a maternity ward that difference decides
     * whether somebody asks about a pregnancy at all. */
    var pregFailed = state.maternity && state.maternity.pregFailed;
    return '<div class="w-card"><div class="w-card-h">' + ms("pregnant_woman") + "<h3>Pregnancy</h3>" +
      '<button class="w-ic" data-w-act="maternityload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (ms_ && ms_.reason ? '<p class="w-hint' + (ms_.state === "postpartum" ? " warn" : "") + '">' + ms("info") + esc(ms_.reason) + "</p>" : "") +
      (state.maternity && state.maternity.statusFailed ? '<p class="w-hint warn">' + ms("warning") + "Pregnancy status could not be read.</p>" : "") +
      (pregFailed ? '<p class="w-hint warn">' + ms("warning") + "The pregnancy record could not be loaded. Do not read this as no pregnancy.</p>" : "") +
      (p ? '<p class="w-hint">' + ms("info") + "Gravida " + esc(p.gravida == null ? "?" : p.gravida) + ", para " + esc(p.para == null ? "?" : p.para) +
        (p.gestationWeeks != null ? ", " + esc(p.gestationWeeks) + " weeks gestation" : "") + (p.edd ? ", EDD " + esc(p.edd) : "") + "</p>" : pregFailed ? "" : '<p class="w-empty">No pregnancy episode recorded.</p>') +
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
    if (m === false) return '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>MEOWS</h3>" + '<button class="w-ic" data-w-act="maternityload" title="Refresh">' + ms("refresh") + "</button></div>" + '<p class="w-hint warn">' + ms("error") + "The observations could not be read, so MEOWS was not worked out. Do not read this as no trigger. Check the patient.</p></div>";
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
    var lossesRaw = state.maternity && state.maternity.losses;
    var losses = lossesRaw || [];
    var rows = losses.map(function (l) {
      return "<li><b>" + esc(l.ml) + " mL</b><span>" + esc(l.method) + (l.quantitative ? "" : " (visual - plausibly " + esc(l.plausibleActualMl) + " mL)") + "</span></li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("water_drop") + "<h3>Blood loss</h3></div>" +
      (lossesRaw === false ? '<p class="w-hint warn">' + ms("error") + "Blood loss could not be loaded. Do not read this as none recorded.</p>"
        : rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No blood loss recorded.</p>') +
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
    // Not knowing whether she has delivered is not the same as knowing she has not: no form to record one.
    if (d === false) return '<div class="w-card"><div class="w-card-h">' + ms("child_care") + "<h3>Delivery</h3>" + '<button class="w-ic" data-w-act="maternityload" title="Refresh">' + ms("refresh") + "</button></div>" + '<p class="w-hint warn">' + ms("error") + "The delivery record could not be read. Refresh before recording a delivery, so it is not recorded twice.</p></div>";
    var linksFailed = state.maternity && state.maternity.links === false;
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
      (linksFailed ? '<p class="w-hint warn">' + ms("error") + "Linked newborns could not be loaded. Do not read this as none.</p>" : newbornRows ? '<ul class="w-mini">' + newbornRows + "</ul>" : "") +
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
      /* THE MOST A CHILD MAY HAVE. Weight times the mg/kg rule, capped at the adult maximum - a heavy
       * teenager's weight-based dose can exceed what an adult is ever given. The engine's own reasons
       * are shown, and "no weight recorded" is a refusal to calculate, never a number. */
      '<h4>' + ms("calculate") + "Maximum dose for this child</h4>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>mg per kg (from the drug rule)</span><input id="wLimMgKg" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Adult maximum mg (optional)</span><input id="wLimAdult" type="text" inputmode="decimal" autocomplete="off"></label>' +
      "</div>" +
      '<button class="w-btn ghost" data-w-act="childdoselimit">' + ms("calculate") + "Work out the maximum</button>" +
      (state.limitResult
        ? (state.limitResult.limitMg == null
            ? '<p class="w-hint warn">' + ms("warning") + esc((state.limitResult.reasons || []).map(function (r) { return r.message; }).join("; ") || "No maximum could be worked out.") + "</p>"
            : '<p class="w-hint' + (state.limitResult.cappedByAdult ? " warn" : "") + '">' + ms("info") + "Maximum " + esc(state.limitResult.limitMg) + " mg" +
              ((state.limitResult.reasons || []).length ? " - " + esc(state.limitResult.reasons.map(function (r) { return r.message; }).join("; ")) : "") + "</p>")
        : "") +
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
      (state.lines === false ? '<p class="w-hint warn">' + ms("error") + "Lines could not be loaded. Do not read this as no lines in place.</p>"
        : state.lines == null ? '<p class="w-empty">Loading lines...</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No lines recorded.</p>') +
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
  var ONCO_PROTOCOLS = {
    "AC": { name: "AC (Doxorubicin + Cyclophosphamide)", drug: "Doxorubicin" },
    "AC-T": { name: "AC-T (Doxorubicin + Cyclophosphamide -> Paclitaxel)", drug: "Paclitaxel" },
    "mFOLFOX6": { name: "mFOLFOX6 (Oxaliplatin + Leucovorin + 5-FU)", drug: "Oxaliplatin" },
    "FOLFIRI": { name: "FOLFIRI (Irinotecan + Leucovorin + 5-FU)", drug: "Irinotecan" },
    "R-CHOP": { name: "R-CHOP (Rituximab + CHOP)", drug: "Rituximab" },
    "ABVD": { name: "ABVD (Hodgkin Lymphoma)", drug: "Doxorubicin" },
    "Carbo-Pac": { name: "Carboplatin + Paclitaxel", drug: "Carboplatin" }
  };

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

    /* A part of this history that could not be read is said above everything, never shown as empty. */
    var partialWarn = state.oncology && state.oncology.warning
      ? '<p class="w-hint warn">' + ms("warning") + esc(state.oncology.warning) + "</p>" : "";
    return partialWarn + '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Oncology</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="oncologyload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("science") + "<h3>Chemotherapy Protocols Catalog</h3></div>" +
      '<p class="w-hint">Standardized evidence-based oncology regimens. Select to pre-fill regimen details:</p>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px;">' +
      Object.keys(ONCO_PROTOCOLS).map(function (k) {
        var p = ONCO_PROTOCOLS[k];
        return '<button class="w-btn ghost sm" data-w-act="oncoproto:' + esc(k) + '" title="' + esc(p.name) + '">' + ms("medication") + esc(k) + '</button>';
      }).join("") + "</div></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("link") + "<h3>ONCqis plan link</h3></div>" +
      (linkRows ? '<ul class="w-mini">' + linkRows + "</ul>" : '<p class="w-empty">No ONCqis plan linked.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>ONCqis plan id</span><input id="wOncoPlanId" type="text" autocomplete="off" value="' + esc(state.oncoPlanId || "") + '"></label>' +
      '<label class="w-f"><span>Regimen</span><input id="wOncoRegimen" type="text" autocomplete="off" value="' + esc(state.oncoRegimen || "") + '"></label>' +
      '<label class="w-f"><span>Protocol version</span><input id="wOncoVersion" type="text" autocomplete="off" value="' + esc(state.oncoVersion || "") + '"></label>' +
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

  function cardioNote(text, okMsg, failMsg) {
    var s = st.sel || {};
    st.busy = true; paint();
    apiPost("/ward/note", { orgId: st.orgId, templateId: "progress", encounterId: s.encounterId, sections: { narrative: text } })
      .then(function (r) { settle(r, r && r.written ? okMsg : null); if (!r || !r.written) st.err = st.err || failMsg; paint(); })
      .catch(function () { st.busy = false; st.err = failMsg; paint(); });
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

    /* A part of this history that could not be read is said above everything, never shown as empty. */
    var partialWarn = state.cardiology && state.cardiology.warning
      ? '<p class="w-hint warn">' + ms("warning") + esc(state.cardiology.warning) + "</p>" : "";
    return partialWarn + '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      '<p class="w-hint">' + ms("warning") + "KardiQ X is self-declared clinically unvalidated, regulatory-pending. This records its AI verdict as external, unvalidated output - never a validated clinical finding." + "</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("ecg_heart") + "<h3>2D Echocardiography</h3></div>" +
      '<p class="w-hint">' + ms("info") + "Saved as a note on the patient's timeline, where earlier echo reports are read." + "</p>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>LVEF (%)</span><input id="wCardioEf" type="text" inputmode="numeric" placeholder="e.g. 55-60"></label>' +
      '<label class="w-f"><span>RWMA</span><input id="wCardioRwma" type="text" placeholder="e.g. None / Hypokinesia in LAD territory"></label>' +
      '<label class="w-f"><span>Valvular assessment</span><input id="wCardioValves" type="text" placeholder="e.g. Mild MR, Normal Aortic/Tricuspid"></label>' +
      '<label class="w-f"><span>PASP (mmHg)</span><input id="wCardioPasp" type="text" placeholder="e.g. 28 mmHg"></label>' +
      '<label class="w-f"><span>Pericardial effusion</span><input id="wCardioPericardial" type="text" placeholder="e.g. None / Trivial"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cardioechosave">' + ms("save") + "Record 2D Echo</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("monitor_heart") + "<h3>Coronary Angiography (CAG) / Cath Lab</h3></div>" +
      '<p class="w-hint">' + ms("info") + "Saved as a note on the patient's timeline. A vessel left blank is written as not reported, never as normal." + "</p>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Access route</span><select id="wCardioCagAccess"><option value="Right Radial">Right Radial</option><option value="Left Radial">Left Radial</option><option value="Femoral">Femoral</option></select></label>' +
      '<label class="w-f"><span>LMCA</span><input id="wCardioLmc" placeholder="e.g. Normal / 50% ostial"></label>' +
      '<label class="w-f"><span>LAD</span><input id="wCardioLad" placeholder="e.g. 90% mid stenosis"></label>' +
      '<label class="w-f"><span>LCx</span><input id="wCardioLcx" placeholder="e.g. Normal"></label>' +
      '<label class="w-f"><span>RCA</span><input id="wCardioRca" placeholder="e.g. 70% proximal"></label>' +
      '<label class="w-f"><span>Intervention / Stents</span><input id="wCardioStents" placeholder="e.g. DES to mid LAD, TIMI III flow"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cardiocagsave">' + ms("save") + "Record Angiogram Report</button></div>";
  }

  /* TASK 3.2: the radiologist's actual workflow, not the generic order/result list - a worklist of
   * this patient's imaging orders, the contrast/allergy protocol context ALREADY built
   * (radiology-protocol.js) but never reachable from any screen before this, and report entry
   * through the SAME state machine (radiology-report.js) that already keeps a preliminary reading on
   * the record and flags a changed impression as a discrepancy. NO IMAGE VIEWER: DICOM/PACS does not
   * exist in this build, and a screen that pretended otherwise would be worse than one that says so. */
  /* P1.10. The launch link into the hospital's own viewer, and the structured template form. Both
   * come from GET imaging-studies. Loading, failed and "no link, because X" are three different
   * sentences: an absent button must never read as "there are no images". */
  function radViewerHtml(entry, loading, failed) {
    if (loading) return '<p class="w-empty">Checking for images&hellip;</p>';
    if (failed) return '<p class="w-hint warn">' + ms("warning") + "Could not check for images. That is not the same as there being none.</p>";
    if (!entry) return '<p class="w-hint warn">' + ms("visibility_off") + "IMAGE SOURCE UNAVAILABLE. This order is not visible to the image lookup.</p>";
    var sd = entry.study, v = entry.viewer || {};
    var studyLine = sd
      ? "<p><b>Study on record</b>: " + esc(sd.modality || "modality not recorded") + (sd.started ? " &middot; " + esc(sd.started) : "") +
        (sd.accessionNumber ? " &middot; accession " + esc(sd.accessionNumber) : "") + (sd.instanceCount != null ? " &middot; " + esc(sd.instanceCount) + " images" : "") + "</p>"
      : '<p class="w-empty">No study from the PACS has been matched to this order yet.</p>';
    var link = v.available
      ? '<a class="w-btn go" href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">' + ms("open_in_new") + "Open images</a>"
      : '<p class="w-hint warn">' + ms("visibility_off") + "No image link. " + esc(v.detail || "The viewer is not available.") + "</p>";
    return studyLine + link;
  }
  function radTemplateFor(templates, id) {
    for (var i = 0; i < (templates || []).length; i++) if (templates[i].id === id) return templates[i];
    return null;
  }
  function radTemplateHtml(templates, chosenId, prefix) {
    if (!templates || !templates.length) return '<p class="w-hint">' + ms("info") + "No structured report templates are configured for this hospital; free text only.</p>";
    var t = radTemplateFor(templates, chosenId);
    var pick = '<label class="w-f"><span>Template</span><select id="' + prefix + 'Tpl">' +
      '<option value="">Free text</option>' + templates.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (t && t.id === x.id ? " selected" : "") + ">" + esc(x.name) + " (v" + esc(x.version) + ")</option>";
      }).join("") + "</select></label>" +
      '<button class="w-btn ghost tiny" data-w-act="radtemplate:' + prefix + '">' + ms("check") + "Use template</button>";
    if (!t) return pick;
    return pick + t.sections.map(function (sec) {
      var id = prefix + "Sec_" + esc(sec.key);
      var input = sec.options
        ? '<select id="' + id + '"><option value="">-</option>' + sec.options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + "</option>"; }).join("") + "</select>"
        : '<textarea id="' + id + '" rows="2"></textarea>';
      return '<label class="w-f"><span>' + esc(sec.label) + (sec.required ? " *" : "") + "</span>" + input + "</label>";
    }).join("") + '<p class="w-hint">' + ms("info") + "Findings may be left blank: your section entries become the findings as written. The impression is yours to write.</p>";
  }
  function radTemplatePayload(templates, chosenId, prefix) {
    var t = radTemplateFor(templates, chosenId); if (!t) return {};
    var sections = {};
    t.sections.forEach(function (sec) { var v = val(prefix + "Sec_" + sec.key); if (v) sections[sec.key] = v; });
    return { templateId: t.id, templateVersion: t.version, sections: sections };
  }
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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

        '<div class="w-card"><div class="w-card-h">' + ms("image") + "<h3>Study images</h3></div>" +
        radViewerHtml(radStudyEntry(rad.studies, picked), rad.studies === undefined, !!rad.studiesFailed) +
        '<p class="w-hint">' + ms("info") + "Images open in the hospital's own viewer. WardSynQ holds the report, never the pixels.</p>" +
        "</div>" +

        '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Report</h3></div>" +
        '<div class="w-grid">' +
        '<label class="w-f"><span>Modality</span><input id="wRadModality" type="text" autocomplete="off" placeholder="e.g. CT, XR, US, MR"></label>' +
        '<label class="w-f"><span>Status</span><select id="wRadStatus"><option value="preliminary">Preliminary</option><option value="final">Final</option><option value="corrected">Corrected</option></select></label>' +
        "</div>" +
        radTemplateHtml(rad.templates, rad.templateId, "wRad") +
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
        " &middot; " + when(d.dispensedAt) + "</span>" +
        /* A medicine handed back - the patient was discharged, the order stopped, the wrong strength
         * went up - has to come back onto the record, or the stock count believes it is still out on
         * the ward. Returned ones say so and are never returned twice. */
        (d.returnedAt
          ? ' <span class="w-st">returned ' + when(d.returnedAt) + (d.returnReason ? ": " + esc(d.returnReason) : "") + "</span>"
          : ' <button class="w-btn ghost tiny" data-w-act="dispensereturn:' + esc(d.dispenseId) + '">' + ms("undo") + "Returned</button>") +
        "</li>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
  function fefoResultHtml(f) {
    if (!f) return "";
    if (f.busy) return '<p class="w-empty">Working out batches...</p>';
    if (!f.ok) return '<p class="w-hint warn">' + ms("error") + esc(f.detail || f.message || "No advice could be given: " + (f.error || "the server could not be reached") + ".") + "</p>";
    var picks = (f.picks || []).map(function (p) {
      return "<li><b>Batch " + esc(p.batch) + "</b><span>take " + esc(p.take) + " " + esc(f.unit) + " &middot; expires " + esc(p.expiry) + "</span></li>";
    }).join("");
    var skipped = (f.excluded || []).map(function (x) {
      return "<li><b>Batch " + esc(x.batch) + "</b><span>" + esc(x.onHand) + " " + esc(f.unit) + ' <span class="w-st overdue">' + esc(x.why) + "</span> &middot; do not issue</span></li>";
    }).join("");
    return (picks ? '<ul class="w-mini">' + picks + "</ul>" : '<p class="w-hint warn">' + ms("warning") + "No usable batch is in stock.</p>") +
      (f.shortfall > 0 ? '<p class="w-hint warn">' + ms("warning") + "Short by " + esc(f.shortfall) + " " + esc(f.unit) + ".</p>" : "") +
      (skipped ? "<p><b>Left out</b></p>" + '<ul class="w-mini">' + skipped + "</ul>" : "") +
      '<p class="w-hint">' + ms("info") + esc(f.note || "") + "</p>";
  }
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Inventory</b></div>" +
      '<button class="w-ic" data-w-act="inventoryload" title="Refresh">' + ms("refresh") + "</button></div>" +

      (s && s.negative && s.negative.length ? '<p class="w-hint warn">' + ms("error") + esc(s.negativeWarning) + "</p>" : "") +
      (s && s.mixedUnitsWarning ? '<p class="w-hint warn">' + ms("warning") + esc(s.mixedUnitsWarning) + "</p>" : "") +

      (s && s.truncatedWarning ? '<p class="w-hint warn">' + ms("warning") + esc(s.truncatedWarning) + "</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("inventory_2") + "<h3>Stock levels</h3></div>" +
      (inv.failed ? '<p class="w-hint warn">' + ms("error") + "Stock could not be loaded. Do not read this as no stock.</p>"
        : !s ? '<p class="w-empty">Loading stock...</p>'
        : levelRows ? '<ul class="w-mini">' + levelRows + "</ul>" : '<p class="w-empty">No stock movements recorded yet.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("event_busy") + "<h3>Near expiry</h3></div>" +
      (inv.failed ? '<p class="w-hint warn">' + ms("error") + "Not loaded.</p>"
        : !s ? '<p class="w-empty">Loading...</p>'
        : expiringRows ? '<ul class="w-mini">' + expiringRows + "</ul>" : '<p class="w-empty">Nothing expiring soon.</p>') +
      "</div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("low_priority") + "<h3>Which batch to use</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Drug</span><input id="wFefoCode" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Quantity</span><input id="wFefoQty" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wFefoUnit" type="text" autocomplete="off" placeholder="e.g. tablet"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="stockfefo">' + ms("search") + "Suggest batches</button>" +
      fefoResultHtml(inv.fefo) + "</div>" +

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
      '<button class="w-btn go" data-w-act="stockadjust">' + ms("edit") + "Adjust</button>" +
      '<button class="w-btn go" data-w-act="stockwaste">' + ms("delete") + "Wastage</button>" +
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
  function maikHistoryHtml(h) {
    if (!h) return '<button class="w-btn ghost sm" data-w-act="maikhistory">' + ms("history") + "Earlier MaiK answers for this patient</button>";
    if (h.busy) return '<p class="w-empty">Loading earlier answers...</p>';
    if (!h.ok) return '<p class="w-hint warn">' + ms("error") + "Earlier answers could not be loaded. Do not read this as none.</p>";
    if (!(h.interactions || []).length) return '<p class="w-empty">MaiK has not been asked about this patient before.</p>';
    var c = h.counts || {};
    return "<p><b>Earlier answers</b> &middot; " + esc(c.pending || 0) + " waiting for review, " + esc((c.accepted || 0) + (c.edited || 0)) + " kept, " + esc(c.rejected || 0) + " rejected</p>" +
      '<ul class="w-mini">' + h.interactions.map(function (x, n) {
        var state = (x.review && x.review.state) || "pending";
        return "<li><b>" + esc(x.task || "question") + "</b><span>" + esc(String(x.requestedAt || "").slice(0, 16).replace("T", " ")) + " &middot; " +
          '<span class="w-st ' + (state === "pending" ? "due" : "") + '">' + esc(state === "pending" ? "waiting for review" : state) + "</span> " +
          '<button class="w-btn ghost sm" data-w-act="maikopen:' + n + '">Open</button></span></li>';
      }).join("") + "</ul>";
  }
  var MAIK_TASKS = [["admission-summary", "Summarise this admission"], ["explain-deterioration", "Explain deterioration"],
    ["unresolved-issues", "Unresolved issues"], ["prepare-rounds", "Prepare rounds"], ["overnight-events", "Overnight events"],
    ["explain-labs", "Explain abnormal labs"], ["medication-risks", "Medication risks"], ["referral-summary", "Referral summary"]];
  function maikCard(state) {
    var m = state.maik || {};
    var s = state.sel;
    if (!s) return "";
    var i = m.interaction;
    var busy = m.busy === true;

    var head = '<div class="w-card"><div class="w-card-h">' + ms("neurology") + "<h3>MaiK</h3>" +
      (i ? '<button class="w-ic" data-w-act="maikclear" title="Clear">' + ms("close") + "</button>" : "") + "</div>";

    if (m.err) head += '<p class="w-hint warn">' + ms("warning") + "No answer was produced. " + esc(m.err) + "</p>";

    if (!i) {
      return head +
        '<p class="w-hint">MaiK reads this patient\'s chart as you, and can propose text for you to accept, edit or reject. It cannot sign, prescribe or change anything by itself.</p>' +
        '<div class="w-maik-acts">' +
        '<button class="w-btn" data-w-act="maikask:summarise"' + (busy ? " disabled" : "") + ">" + ms("summarize") + "Summarise this chart</button>" +
        '<button class="w-btn ghost" data-w-act="maikask:draft-note"' + (busy ? " disabled" : "") + ">" + ms("edit_note") + "Draft a progress note</button>" +
        "</div>" +
        /* P2.2 copilot tasks. Each passes the system's computed findings to MaiK as facts; none writes anything. */
        '<div class="w-maik-acts">' + MAIK_TASKS.map(function (t) {
          return '<button class="w-btn ghost sm" data-w-act="maikask:' + t[0] + '"' + (busy ? " disabled" : "") + ">" + esc(t[1]) + "</button>";
        }).join("") + "</div>" +
        (busy ? '<p class="w-empty">Asking MaiK&hellip;</p>' : "") +
        maikHistoryHtml(m.history) +
        "</div>";
    }

    var provCount = (i.contextProvenance || []).length;
    var external = (i.contextDocuments || []).filter(function (d) { return d && d.origin && d.origin !== "wardsynq-native"; });
    var flagged = ((i.security || {}).injectionFindings || []).length;
    var reviewed = i.review && i.review.state && i.review.state !== "pending";

    /* THE WITHHELD CASE IS NOT AN ERROR MESSAGE. The clinician is told the answer was stopped and
     * why, because a screen that silently shows nothing looks like a model that had nothing to say. */
    /* P2.2: FACTS FROM THE RECORD first, each a link to the record it rests on; MaiK's reasoning after,
     * under its own heading, so the two can never be read as one voice. */
    var f = i.facts;
    var facts = !f ? "" : '<div class="w-maik-facts"><b>' + ms("fact_check") + "Facts from the record</b>" +
      (f.unavailable ? '<p class="w-hint warn">' + ms("error") + "The computed findings could not be produced (" + esc(f.unavailable) + "). MaiK was told so.</p>"
        : ((f.signals || []).length ? '<ul class="w-mini">' + f.signals.map(function (x) {
            return "<li><b>" + esc(x.label) + "</b> " + esc(x.summary) + '<div class="w-hint">' + (evidenceLinks(x.evidence) || "no record ids") + "</div></li>";
          }).join("") + "</ul>" : '<p class="w-hint">No surveillance rule is currently true for this patient.</p>') +
          ((f.abnormalLabs || []).length ? '<p class="w-hint">Outside the recorded range: ' + evidenceLinks(f.abnormalLabs) + "</p>" : "") +
          ((f.notEvaluated || []).length ? '<p class="w-hint">Not evaluated: ' + f.notEvaluated.map(function (n) { return esc(n.ruleId); }).join(", ") + "</p>" : "")) +
      '<p class="w-hint">Records MaiK read: ' + ((i.contextProvenance || []).map(function (c) {
        return '<button class="w-btn tiny ghost" data-w-act="timelinedetail:' + esc(c.resourceType) + "~" + esc(c.id) + '">' + esc(c.resourceType) + "</button>";
      }).join(" ") || "none") + "</p></div>";
    var body = facts + (f ? '<b class="w-maik-h">' + ms("neurology") + "MaiK's reasoning</b>" : "") + (i.output
      ? '<div class="w-maik-out">' + esc(i.output).replace(/\n/g, "<br>") + "</div>"
      : '<p class="w-hint warn">' + ms("block") + "MaiK's answer was withheld before anybody saw it" +
        (i.withheld && i.withheld.violations ? " (" + esc(i.withheld.violations.join(", ")) + ")" : "") +
        ". Nothing was shown and nothing was written.</p>");

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

    return head + body + prov + preview + acts + (f ? detailPanel(state) : "") + "</div>";
  }

  /* The bench, in the order work actually moves: to be collected, in transit, awaiting a result,
   * and whatever has gone critical. Counts sit in every heading because "12 specimens uncollected"
   * is the number a shift decides on, and an empty section names WHAT is empty rather than saying
   * "None", which reads as a rendering failure. */
  /* RESULT ENTRY. Values are recorded exactly as typed - a number where it is a number, text where it
   * is not, never coerced either way (lab-result.js's own rule). Rows the server rejects are shown by
   * name with the reason, rather than the save being reported as a success for the rows that landed:
   * a potassium that silently failed to save is a potassium nobody acts on. */
  var LAB_TEMPLATES = {
    cbc: { name: "CBC / Hemogram", tests: [
      { test: "Hemoglobin", unit: "g/dL", range: "13.0 - 17.0" },
      { test: "TLC / Total Leucocyte Count", unit: "/cumm", range: "4,000 - 11,000" },
      { test: "Platelet Count", unit: "lakhs/cumm", range: "1.5 - 4.5" },
      { test: "RBC Count", unit: "mil/cumm", range: "4.5 - 5.5" },
      { test: "Neutrophils", unit: "%", range: "40 - 75" },
      { test: "Lymphocytes", unit: "%", range: "20 - 45" },
      { test: "Eosinophils", unit: "%", range: "1 - 6" },
      { test: "Monocytes", unit: "%", range: "2 - 10" },
      { test: "PCV / Packed Cell Volume", unit: "%", range: "36 - 50" },
      { test: "ESR", unit: "mm/hr", range: "0 - 20" }
    ]},
    lft: { name: "Liver Function Test (LFT)", tests: [
      { test: "Bilirubin (Total)", unit: "mg/dL", range: "0.2 - 1.2" },
      { test: "Bilirubin (Direct)", unit: "mg/dL", range: "0.0 - 0.3" },
      { test: "SGOT / AST", unit: "U/L", range: "5 - 40" },
      { test: "SGPT / ALT", unit: "U/L", range: "5 - 40" },
      { test: "Alkaline Phosphatase (ALP)", unit: "U/L", range: "30 - 120" },
      { test: "Total Protein", unit: "g/dL", range: "6.0 - 8.3" },
      { test: "Serum Albumin", unit: "g/dL", range: "3.5 - 5.0" },
      { test: "Serum Globulin", unit: "g/dL", range: "2.0 - 3.5" }
    ]},
    rft: { name: "Renal Function Test (RFT / KFT)", tests: [
      { test: "Blood Urea", unit: "mg/dL", range: "15 - 40" },
      { test: "Serum Creatinine", unit: "mg/dL", range: "0.6 - 1.2" },
      { test: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", range: "7 - 20" },
      { test: "Serum Uric Acid", unit: "mg/dL", range: "3.5 - 7.2" }
    ]},
    lytes: { name: "Serum Electrolytes", tests: [
      { test: "Sodium (Na+)", unit: "mEq/L", range: "135 - 145" },
      { test: "Potassium (K+)", unit: "mEq/L", range: "3.5 - 5.0" },
      { test: "Chloride (Cl-)", unit: "mEq/L", range: "96 - 106" },
      { test: "Bicarbonate (HCO3-)", unit: "mEq/L", range: "22 - 29" }
    ]},
    lipid: { name: "Lipid Profile", tests: [
      { test: "Total Cholesterol", unit: "mg/dL", range: "< 200" },
      { test: "Triglycerides", unit: "mg/dL", range: "< 150" },
      { test: "HDL Cholesterol", unit: "mg/dL", range: "> 40" },
      { test: "LDL Cholesterol", unit: "mg/dL", range: "< 100" },
      { test: "VLDL Cholesterol", unit: "mg/dL", range: "< 30" }
    ]},
    fever: { name: "Fever Profile", tests: [
      { test: "Malarial Parasite (Smear/Card)", unit: "", range: "Negative" },
      { test: "Widal / Typhidot", unit: "", range: "Negative" },
      { test: "Dengue NS1 Antigen", unit: "", range: "Negative" },
      { test: "Dengue IgM / IgG", unit: "", range: "Negative" },
      { test: "Urine Routine (Pus cells)", unit: "/hpf", range: "0 - 5" },
      { test: "C-Reactive Protein (CRP)", unit: "mg/L", range: "< 6.0" }
    ]},
    coag: { name: "Coagulation Profile (PT/INR)", tests: [
      { test: "Prothrombin Time (PT)", unit: "sec", range: "11 - 14" },
      { test: "Control PT", unit: "sec", range: "11 - 13" },
      { test: "INR", unit: "", range: "0.8 - 1.2" },
      { test: "aPTT", unit: "sec", range: "25 - 35" }
    ]},
    abg: { name: "Arterial Blood Gas (ABG)", tests: [
      { test: "pH", unit: "", range: "7.35 - 7.45" },
      { test: "pCO2", unit: "mmHg", range: "35 - 45" },
      { test: "pO2", unit: "mmHg", range: "80 - 100" },
      { test: "HCO3-", unit: "mEq/L", range: "22 - 26" },
      { test: "Base Excess", unit: "mEq/L", range: "-2 to +2" },
      { test: "SaO2", unit: "%", range: "95 - 100" }
    ]}
  };

  function labIsImaging(order) {
    if (!order) return false;
    var cat = String(order.category || "").toLowerCase();
    var txt = String(order.display || order.code || "").toLowerCase();
    return cat === "imaging" || /x-?ray|chest x|computed tomography|\bct\b|mri|magnetic resonance|ultrasound|\busg\b|radiology|mammograph/i.test(txt);
  }

  function labResultForm(state) {
    var f = state.labResultFor;
    if (!f) return "";
    var r = state.labResultOutcome;
    var isImg = labIsImaging(f);
    var tmplBar = '<div class="w-chips" style="margin: 8px 0 12px 0;">' +
      '<small style="align-self:center; font-weight:600; color:var(--w-ink-dim, #5b7083); margin-right:4px;">Quick Templates:</small>' +
      '<button class="w-chip" data-w-act="labtmpl:cbc" type="button">CBC</button>' +
      '<button class="w-chip" data-w-act="labtmpl:lft" type="button">LFT</button>' +
      '<button class="w-chip" data-w-act="labtmpl:rft" type="button">RFT / KFT</button>' +
      '<button class="w-chip" data-w-act="labtmpl:lytes" type="button">Electrolytes</button>' +
      '<button class="w-chip" data-w-act="labtmpl:lipid" type="button">Lipid Profile</button>' +
      '<button class="w-chip" data-w-act="labtmpl:fever" type="button">Fever Profile</button>' +
      '<button class="w-chip" data-w-act="labtmpl:coag" type="button">PT / INR</button>' +
      '<button class="w-chip" data-w-act="labtmpl:abg" type="button">ABG</button>' +
      '</div>';
    var imgNotice = isImg ? '<div class="w-card warn" style="margin-bottom:12px;"><div class="w-card-h">' + ms("radiology") + '<h3>Imaging / Radiology Study</h3></div>' +
      '<p>' + esc(f.display || f.code) + ' is an imaging order. Plain radiographs and scans are reported on the Radiology Board with PACS viewer and report impressions.</p>' +
      '<div class="w-dose-a"><button class="w-btn go sm" data-w-act="radboard">' + ms("arrow_forward") + 'Open Radiology Board</button></div></div>' : "";
    var rows = "";
    for (var i = 0; i < 10; i++) {
      rows += '<div class="w-grid">' +
        '<label class="w-f"><span>Test</span><input id="wLrTest' + i + '"' + (i === 0 ? ' value="' + esc(f.display || f.code || "") + '"' : "") + '></label>' +
        '<label class="w-f"><span>Result</span><input id="wLrVal' + i + '"></label>' +
        '<label class="w-f"><span>Unit</span><input id="wLrUnit' + i + '"></label>' +
        '<label class="w-f"><span>Reference range</span><input id="wLrRange' + i + '" placeholder="as the analyser reports it"></label></div>';
    }
    return '<div class="w-card"><div class="w-card-h">' + ms("edit_note") + "<h3>Result for " + esc(f.display || f.code) + "</h3>" +
      '<button class="w-ic" data-w-act="labresultclose" title="Close">' + ms("close") + "</button></div>" +
      imgNotice + tmplBar +
      '<p class="w-hint">' + ms("info") + "Type each value, unit and range exactly as the analyser reported it. Nothing is converted or rounded. A template only names the tests; rows left without a value are not sent." + "</p>" +
      rows +
      '<select id="wLrStatus"><option value="final">Final</option><option value="preliminary">Preliminary</option><option value="corrected">Corrected (replaces a final result)</option></select>' +
      '<textarea id="wLrConc" rows="2" placeholder="Comment or conclusion (optional)"></textarea>' +
      '<button class="w-btn" data-w-act="labresultsave">' + ms("send") + "Release result</button>" +
      (r && r.rejected && r.rejected.length
        ? '<p class="w-hint warn">' + ms("warning") + "Not saved: " + esc(r.rejected.map(function (x) { return (x.test || "row " + (x.index + 1)) + " (" + x.reason + ")"; }).join(", ")) + "</p>"
        : "") +
      "</div>";
  }
  function labVerifyRow(x) {
    var obs = (x.observations || []).map(function (o) {
      var why = [];
      if (o.critical) why.push("flagged critical by the analyser");
      if (o.deltaBreach) why.push("changed more than expected since the last result");
      if (!o.autoVerified) why.push("did not pass autoverification");
      return "<div>" + esc(o.display) + ": <b>" + esc(o.value) + (o.unit ? " " + esc(o.unit) : "") + "</b>" +
        (o.referenceRange && (o.referenceRange.text || o.referenceRange.low != null) ? " (range " + esc(o.referenceRange.text || (o.referenceRange.low + "-" + o.referenceRange.high)) + ")" : " (no range reported)") +
        (why.length ? ' <span class="w-st due">' + esc(why.join("; ")) + "</span>" : "") + "</div>";
    }).join("");
    return '<li><div class="w-crit-h"><b>' + esc(x.panel || "Result") + "</b></div>" +
      '<div class="w-crit-m">' + ms("person") + labWho(x.patientId) + " &middot; entered by " + esc(x.releasedBy || "unknown") + (x.reportedAt ? " " + when(x.reportedAt) : "") + "</div>" + obs +
      (x.unreadObservations ? '<p class="w-hint warn">' + ms("error") + esc(x.unreadObservations) + " value(s) could not be read. Do not verify until they load.</p>" : "") +
      (x.mine ? '<p class="w-hint">' + ms("info") + "You entered this, so somebody else must verify it.</p>"
        : (x.unreadObservations ? "" : '<button class="w-btn go sm" data-w-act="labverify:' + esc(x.reportId) + '">' + ms("verified") + "Verify</button>") +
          '<button class="w-btn ghost sm" data-w-act="labreturn:' + esc(x.reportId) + '">' + ms("undo") + "Return for re-entry</button>") +
      "</li>";
  }
  function labBoardView(state) {
    if (!state.labBoard) {
      return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><div><b>Laboratory</b><small>hospital-wide</small></div></div>" +
        '<p class="w-empty">Loading the laboratory board...</p>';
    }
    var b = state.labBoard;
    var dept = state.labDept || "all";
    var none = function (what) { return '<p class="w-empty">' + esc(what) + "</p>"; };
    var stateOf = function (s) { return (s && s.collection && s.collection.state) || "none"; };
    var spec = (b.specimens || []).filter(function (s) { return !labIsImaging(s); });
    var uncollected = spec.filter(function (s) { return stateOf(s) === "none" || stateOf(s) === "failed"; });
    var inTransit = spec.filter(function (s) { return stateOf(s) === "collected"; });
    var pri = function (s) { return s.priority === "stat" ? "overdue" : s.priority === "urgent" ? "failed" : ""; };
    var specRow = function (s) {
      return '<li class="' + pri(s) + '"><div class="w-crit-h"><b>' + esc(s.display || s.code) + "</b>" +
        (s.priority && s.priority !== "routine" ? '<span class="w-st ' + esc(s.priority) + '">' + esc(String(s.priority).toUpperCase()) + "</span>" : "") +
        "</div><div class=\"w-crit-m\">" + ms("person") + labWho(s.patientId) +
        (s.category ? " &middot; " + esc(s.category) : "") + "</div></li>";
    };
    /* A test awaiting a result used to be a line with nothing to do: the laboratory board listed what
     * was waiting and gave the laboratory no way to report it. The button opens the entry form for
     * that one request, so a result is always reported AGAINST the order that asked for it. */
    var pendRow = function (p) {
      return '<li><div class="w-crit-h"><b>' + esc(p.display || p.code) + "</b></div>" +
        '<div class="w-crit-m">' + ms("person") + labWho(p.patientId) + "</div>" +
        '<button class="w-btn ghost sm" data-w-act="labresultopen:' + esc(p.serviceRequestId) + '">' + ms("edit_note") + "Enter result</button>" +
        '<button class="w-btn ghost sm" data-w-act="cultureopen:' + esc(p.serviceRequestId) + '">' + ms("coronavirus") + "Culture</button>" +
        '<button class="w-btn ghost sm" data-w-act="histoopen:' + esc(p.serviceRequestId) + '">' + ms("description") + "Histopathology</button></li>";
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

    var deptTabs = '<div class="w-chips" role="tablist" style="margin-bottom:12px;">' +
      '<button class="w-chip' + (dept === "all" ? " on" : "") + '" data-w-act="labdept:all" type="button">All Laboratories</button>' +
      '<button class="w-chip' + (dept === "hema_bio" ? " on" : "") + '" data-w-act="labdept:hema_bio" type="button">Biochemistry &amp; Hematology</button>' +
      '<button class="w-chip' + (dept === "path" ? " on" : "") + '" data-w-act="labdept:path" type="button">Pathology &amp; Histology</button>' +
      '<button class="w-chip' + (dept === "micro" ? " on" : "") + '" data-w-act="labdept:micro" type="button">Microbiology</button>' +
      '</div>';

    var showHemaBio = dept === "all" || dept === "hema_bio";
    var showPath = dept === "all" || dept === "path";
    var showMicro = dept === "all" || dept === "micro";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Laboratory</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="labboardload" title="Refresh">' + ms("refresh") + "</button></div>" +
      deptTabs +
      (b.errors && b.errors.length
        ? '<div class="w-card warn"><div class="w-card-h">' + ms("error") + "<h3>Could not be read</h3></div>" +
          "<p>" + esc(b.errors.join(", ")) + ". What is shown below is incomplete.</p></div>"
        : "") +
      (showHemaBio ? card("colorize", "Awaiting collection", uncollected.length, uncollected.map(specRow).join(""), "No specimens awaiting collection.") : "") +
      (showHemaBio ? card("local_shipping", "Collected, awaiting the laboratory", inTransit.length, inTransit.map(function (sp) {
        var id = sp.collection && sp.collection.specimenId;
        return specRow(sp).replace(/<\/li>$/, "") +
          (id
            ? '<button class="w-btn ghost sm" data-w-act="specreceived:' + esc(id) + '">' + ms("check") + "Received</button>" +
              '<button class="w-btn ghost sm" data-w-act="specfailed:' + esc(id) + '">' + ms("close") + "Failed</button>"
            : "") + "</li>";
      }).join(""), "Nothing in transit.") : "") +
      (showHemaBio ? labResultForm(state) : "") +
      (showHemaBio && (b.toVerify || []).length ? card("verified", "Awaiting verification", b.toVerify.length, b.toVerify.map(labVerifyRow).join(""), "") : "") +
      (showHemaBio ? card("biotech", "Awaiting a result", (b.pending || []).length, (b.pending || []).map(pendRow).join(""), "No tests awaiting a result.") : "") +
      card("priority_high", "Critical results", (b.criticals || []).length, (b.criticals || []).map(critRow).join(""), "No open critical results.") +
      (showMicro ? (cultureForm(state) + card("coronavirus", "Cultures in progress", (b.cultures || []).length, (b.cultures || []).map(function (c) {
        return '<li><div class="w-crit-h"><b>' + esc(c.panel || "Culture") + "</b>" + '<span class="w-st due">' + esc(CULTURE_STAGE_WORDS[c.stage] || c.stage) + "</span>" +
          (c.critical ? '<span class="w-st overdue">positive blood culture</span>' : "") + "</div>" +
          '<div class="w-crit-m">' + ms("person") + labWho(c.patientId) + " &middot; " + esc((c.specimen && c.specimen.type) || "") + "</div>" +
          '<button class="w-btn ghost sm" data-w-act="cultureopen:' + esc(c.serviceRequestId) + '">' + ms("edit_note") + "Update stage</button></li>";
      }).join(""), "No cultures in progress.")) : "") +
      (showPath ? (histoForm(state) + card("description", "Histopathology reports", (b.histopathology || []).length, (b.histopathology || []).map(function (h) {
        var signed = h.status === "final" || h.status === "corrected";
        return '<li><div class="w-crit-h"><b>' + esc(h.panel || "Histopathology") + "</b>" +
          '<span class="w-st ' + (signed ? "" : "due") + '">' + (signed ? "signed" : h.awaitingVerification ? "awaiting verification" : "not signed") + "</span></div>" +
          '<div class="w-crit-m">' + ms("person") + labWho(h.patientId) + (h.diagnosis ? " &middot; " + esc(h.diagnosis) : "") + "</div>" +
          (signed ? '<button class="w-btn ghost sm" data-w-act="histoaddendum:' + esc(h.reportId) + '">' + ms("post_add") + "Add addendum</button>" : "") + "</li>";
      }).join(""), "No histopathology reports.")) : "");
  }

  /* MICROBIOLOGY ENTRY (P1.9). One form per stage update; every save is a new version of the same
   * report. A susceptibility left on "not tested" is not sent at all, so nothing becomes S by default. */
  var CULTURE_STAGE_WORDS = { received: "Received", incubating: "Incubating", "growth-detected": "Growth detected", identification: "Identification",
    "no-growth": "No growth so far", final: "Final" };
  var CULTURE_ABX_ROWS = 8, CULTURE_ORG_SLOTS = 2;
  function cultureForm(state) {
    var f = state.cultureFor;
    if (!f) return "";
    var c = f.existing || {};
    var orgs = c.organisms || [];
    var sel = function (id, opts, cur) {
      return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
    };
    var input = function (id, label, v, ph) {
      return '<label class="w-f"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(v == null ? "" : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + "></label>";
    };
    var stages = [["received", "Received"], ["incubating", "Incubating"], ["growth-detected", "Growth detected (preliminary, Gram stain)"], ["identification", "Organism identified"], ["no-growth", "No growth at N hours"], ["final", "Final"]];
    var orgHtml = "";
    for (var k = 0; k < CULTURE_ORG_SLOTS; k++) {
      var o = orgs[k] || {}, sus = o.susceptibilities || [];
      var abx = "";
      for (var r = 0; r < CULTURE_ABX_ROWS; r++) {
        var s = sus[r] || {};
        abx += '<div class="w-grid">' + input("wCuAbx" + k + "_" + r, "Antibiotic", s.antibiotic) +
          '<label class="w-f"><span>Result</span>' + sel("wCuRes" + k + "_" + r, [["", "Not tested"], ["S", "S"], ["I", "I"], ["R", "R"], ["SDD", "SDD"]], s.result || "") + "</label>" +
          input("wCuMic" + k + "_" + r, "MIC", s.mic) + input("wCuMicU" + k + "_" + r, "MIC unit", s.micUnit) + input("wCuMeth" + k + "_" + r, "Method", s.method) + "</div>";
      }
      orgHtml += '<div class="w-sub"><h4>' + ms("coronavirus") + "Organism " + (k + 1) + "</h4>" +
        '<div class="w-grid">' + input("wCuOrg" + k, "Organism", o.name) + input("wCuQty" + k, "Quantity or colony count", o.quantity) +
        input("wCuBp" + k, "Breakpoint standard", o.breakpointStandard, "as reported, e.g. CLSI M100 2025") + "</div>" + abx + "</div>";
    }
    var spec = c.specimen || {};
    return '<div class="w-card"><div class="w-card-h">' + ms("coronavirus") + "<h3>Culture: " + esc(f.display || f.code || "") + "</h3>" +
      '<button class="w-ic" data-w-act="cultureclose" title="Close">' + ms("close") + "</button></div>" +
      '<p class="w-hint">' + ms("info") + "Each save is a new stage on the same report. Leave an antibiotic on Not tested unless it was tested. Leave the breakpoint standard empty if it was not reported.</p>" +
      '<div class="w-grid">' + input("wCuSpec", "Specimen type", spec.type, "e.g. Blood, Urine, CSF") + input("wCuSite", "Site", spec.site) +
      input("wCuColl", "Collected at", c.collectedAt, "YYYY-MM-DDTHH:MM") + input("wCuRecv", "Received at", c.receivedAt, "YYYY-MM-DDTHH:MM") + "</div>" +
      '<div class="w-grid"><label class="w-f"><span>Stage</span>' + sel("wCuStage", stages, c.stage || "received") + "</label>" +
      input("wCuGram", "Gram stain", c.gramStain) + input("wCuNoGrowth", "No growth at hours", c.noGrowthHours) + "</div>" +
      orgHtml +
      '<textarea id="wCuComment" rows="2" placeholder="Comment (optional)">' + esc(c.comment || "") + "</textarea>" +
      '<label class="w-f"><span><input type="checkbox" id="wCuCorrect"> This corrects a final culture</span></label>' +
      '<button class="w-btn" data-w-act="culturesave">' + ms("send") + "Save stage</button></div>";
  }
  function histoForm(state) {
    var f = state.histoFor;
    if (!f) return "";
    var area = function (id, label, rows) { return '<label class="w-f"><span>' + esc(label) + '</span><textarea id="' + id + '" rows="' + rows + '"></textarea></label>'; };
    return '<div class="w-card"><div class="w-card-h">' + ms("description") + "<h3>Histopathology: " + esc(f.display || f.code || "") + "</h3>" +
      '<button class="w-ic" data-w-act="histoclose" title="Close">' + ms("close") + "</button></div>" +
      '<p class="w-hint">' + ms("info") + "Once signed, the report is not edited. Anything added later is an addendum.</p>" +
      '<label class="w-f"><span>Specimen</span><input id="wHpSpec"></label>' +
      area("wHpClin", "Clinical details", 2) + area("wHpMacro", "Macroscopic", 3) + area("wHpMicro", "Microscopic", 4) +
      area("wHpDx", "Diagnosis", 2) + '<label class="w-f"><span>Coded diagnosis (optional, as coded by the pathologist)</span><input id="wHpCode"></label>' +
      '<select id="wHpStatus"><option value="preliminary">Save unsigned (preliminary)</option><option value="final">Sign (final)</option></select>' +
      '<button class="w-btn" data-w-act="histosave">' + ms("send") + "Save report</button></div>";
  }

  /* THE CHART'S CULTURES AND HISTOPATHOLOGY. Loading, failed and empty are three different sentences.
   * A susceptibility that was not reported is "not tested", never a blank that could be read as S.
   * The antibiotic review is advisory: it lists, it flags, and it changes nothing. */
  function pathologyCard(state) {
    var p = state.pathology;
    var head = '<div class="w-card"><div class="w-card-h">' + ms("coronavirus") + "<h3>Cultures and histopathology</h3>" +
      '<button class="w-ic" data-w-act="pathologyload" title="Refresh">' + ms("refresh") + "</button></div>";
    if (p === false) return head + '<p class="w-hint warn">' + ms("error") + "Cultures and histopathology could not be loaded. Do not read this as none.</p></div>";
    if (!p) return head + '<p class="w-empty">Loading cultures and histopathology...</p></div>';
    var cultures = p.cultures || [], histo = p.histopathology || [];
    if (!cultures.length && !histo.length) return head + '<p class="w-empty">No cultures or histopathology reports for this patient.</p></div>';

    var cultureHtml = cultures.map(function (c) {
      var orgs = c.organisms || [];
      var names = [], seen = {};
      orgs.forEach(function (o) { (o.susceptibilities || []).forEach(function (s) { var k = String(s.antibiotic).toLowerCase(); if (!seen[k]) { seen[k] = 1; names.push(s.antibiotic); } }); });
      var cell = function (o, name) {
        var hit = null;
        (o.susceptibilities || []).forEach(function (s) { if (String(s.antibiotic).toLowerCase() === String(name).toLowerCase()) hit = s; });
        if (!hit) return "<td><i>not tested</i></td>";
        return "<td><b>" + esc(hit.result) + "</b>" + (hit.mic ? " (MIC " + esc(hit.mic) + (hit.micUnit ? " " + esc(hit.micUnit) : "") + ")" : "") + (hit.method ? " <small>" + esc(hit.method) + "</small>" : "") + "</td>";
      };
      var table = names.length
        ? '<div style="overflow-x:auto"><table class="w-tbl"><thead><tr><th>Antibiotic</th>' + orgs.map(function (o) { return "<th>" + esc(o.name) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          names.map(function (n) { return "<tr><td>" + esc(n) + "</td>" + orgs.map(function (o) { return cell(o, n); }).join("") + "</tr>"; }).join("") + "</tbody></table></div>"
        : (orgs.length ? "<p class=\"w-hint\">No susceptibilities reported yet.</p>" : "");
      return "<li><div class=\"w-crit-h\"><b>" + esc(c.panel || "Culture") + "</b>" +
        (c.status === "preliminary" ? '<span class="w-st due">PRELIMINARY</span>' : c.status === "corrected" ? '<span class="w-st overdue">CORRECTED</span>' : '<span class="w-st">Final</span>') +
        (c.critical ? '<span class="w-st overdue">positive blood culture</span>' : "") + "</div>" +
        '<div class="w-crit-m">' + esc((c.specimen && c.specimen.type) || "") + (c.specimen && c.specimen.site ? ", " + esc(c.specimen.site) : "") +
        " &middot; " + esc(CULTURE_STAGE_WORDS[c.stage] || c.stage || "") + (c.stage === "no-growth" || (c.stage === "final" && c.noGrowthHours) ? " at " + esc(c.noGrowthHours) + " hours" : "") +
        " &middot; " + when(c.reportedAt) + "</div>" +
        (c.gramStain ? "<div>Gram stain: " + esc(c.gramStain) + "</div>" : "") +
        orgs.map(function (o) {
          return "<div><b>" + esc(o.name) + "</b>" + (o.quantity ? " &middot; " + esc(o.quantity) : "") +
            " &middot; " + (o.breakpointStandard ? "Breakpoints: " + esc(o.breakpointStandard) : "breakpoint standard not reported") + "</div>";
        }).join("") + table + (c.comment ? "<div>" + esc(c.comment) + "</div>" : "") + "</li>";
    }).join("");

    var abx = p.antibioticOrders;
    var review = !cultures.length ? ""
      : abx == null ? '<p class="w-hint warn">' + ms("error") + "Active medication orders could not be read, so no antibiotic review was done.</p>"
      : !abx.length ? '<p class="w-hint">No active orders for an antibiotic on these panels. Other active medicines are not screened here.</p>'
      : '<ul class="w-mini">' + abx.map(function (a) {
          return "<li><b>" + esc(a.drug) + "</b>" + (a.flag
            ? ' <span class="w-st overdue">' + esc(a.flag) + "</span><div>" + a.resistant.map(function (x) { return esc(x.organism) + (x.preliminary ? " (preliminary)" : ""); }).join(", ") + " reported R to " + esc(a.antibiotic) + "</div>"
            : " <span>no organism reported R to " + esc(a.antibiotic) + "</span>") + "</li>";
        }).join("") + "</ul><p class=\"w-hint\">Advisory only. Other active medicines are not screened here.</p>";

    var histoHtml = histo.map(function (h) {
      var sec = function (label, v) { return v ? "<div><b>" + esc(label) + ":</b> " + esc(v) + "</div>" : ""; };
      return "<li><div class=\"w-crit-h\"><b>" + esc(h.panel || "Histopathology") + "</b>" +
        (h.status === "final" || h.status === "corrected" ? '<span class="w-st">Signed</span>' : '<span class="w-st due">PRELIMINARY' + (h.awaitingVerification ? ", awaiting verification" : "") + "</span>") + "</div>" +
        '<div class="w-crit-m">Reported by ' + esc(h.reportedBy || "unknown") + (h.verifiedBy ? ", verified by " + esc(h.verifiedBy) : "") + " &middot; " + when(h.reportedAt) + "</div>" +
        sec("Specimen", h.specimen) + sec("Clinical details", h.clinicalDetails) + sec("Macroscopic", h.macroscopic) + sec("Microscopic", h.microscopic) +
        sec("Diagnosis", h.diagnosis) + sec("Coded diagnosis", h.codedDiagnosis) +
        (h.addenda || []).map(function (a) { return '<div class="w-sub"><b>Addendum</b> ' + esc(a.by) + " &middot; " + when(a.at) + "<div>" + esc(a.text) + "</div></div>"; }).join("") + "</li>";
    }).join("");

    return head +
      (cultures.length ? '<div class="w-sub"><h4>' + ms("coronavirus") + "Cultures</h4><ul class=\"w-crits\">" + cultureHtml + "</ul></div>" +
        '<div class="w-sub"><h4>' + ms("medication") + "Active antibiotic orders</h4>" + review + "</div>" : "") +
      (histo.length ? '<div class="w-sub"><h4>' + ms("description") + "Histopathology</h4><ul class=\"w-crits\">" + histoHtml + "</ul></div>" : "") + "</div>";
  }
  /* What the background escalation did for a loop nobody acknowledged. "Not delivered" is said as
   * plainly as "delivered": a hospital with no notification channel must see that nobody was paged. */
  function critEscalationsHtml(list, notices) {
    if (!list || !list.length) return "";
    return '<div class="w-crit-m">' + list.map(function (x) {
      var n = x.notification || {};
      // S3 P0: a push accepted by the phone gateways is SENT, which is neither delivered nor nobody told.
      var pushed = (notices || []).filter(function (m) { return m && m.level === x.level; }).map(function (m) { return m.sent || 0; }).pop();
      return ms("campaign") + (x.level === "escalate" ? "Escalated" : "Overdue") + " " + when(x.at) + " after " + esc(x.minutesOpen) + " min: " +
        (n.delivered ? "notification delivered" : pushed ? "sent to " + esc(pushed) + " phone(s), not yet confirmed" : '<b>nobody was notified</b> (' + esc(n.reason === "NO_CHANNEL" ? "no notification channel is set up" : (n.reason || "delivery failed")) + ")");
    }).join("<br>") + "</div>";
  }
  /* S3 P0: a result whose push reached nobody says so on the board, in words, never as a quiet gap. */
  var CRIT_NOTICE_WHY = { NO_RECIPIENT: "nobody could be found to tell", NO_DEVICE: "nobody it was sent to has a phone registered for alerts", PUSH_NOT_CONFIGURED: "push is not configured on the server", SMS_NOT_CONFIGURED: "no phone confirmed and the SMS fallback is not configured", NO_MOBILE: "no phone confirmed and nobody has an alert mobile", SMS_FAILED: "no phone confirmed and the SMS could not be sent" };
  function critNoticeHtml(c) {
    var why = [];
    (c.notifications || []).forEach(function (n) { if (n && n.reason && !(n.sms && n.sms.sent)) why.push(n.reason); if (n && n.sms && n.sms.reason) why.push(n.sms.reason); });
    if (!why.length) return "";
    return '<div class="w-crit-m warn">' + ms("notifications_off") + "<b>Alert did not reach anyone:</b> " + esc(CRIT_NOTICE_WHY[why[why.length - 1]] || why[why.length - 1]) + "</div>";
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
        critEscalationsHtml(c.escalations, c.notifications) + critNoticeHtml(c) +
        (c.state === "open" ? '<button class="w-btn tiny go" data-w-act="ackboard:' + esc(c.loopId) + '">' + ms("task_alt") + "Acknowledge</button>" : "") +
        '<button class="w-btn tiny ghost" data-w-act="incidentsignal:CriticalResultLoop~' + esc(c.loopId) + '">' + ms("report") + "Raise safety signal</button>" +
      "</li>";
    }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Critical results</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="critsboardload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("priority_high") + "<h3>Open loops" + (Array.isArray(state.critsBoard) ? " &middot; " + loops.length : "") + "</h3></div>" +
      '<p class="w-hint">Acknowledging records that you have seen this and what you did. It is not a way to clear the list.</p>' +
      (state.critsBoard === false ? '<p class="w-hint warn">' + ms("error") + "Critical results could not be loaded. Do not read this as none open. Check the laboratory system directly.</p>"
        : state.critsBoard == null ? '<p class="w-empty">Loading open critical results...</p>'
        : rows ? '<ul class="w-crits">' + rows + "</ul>" : '<p class="w-empty">No open critical results anywhere right now.</p>') +
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
    st.view = "labboard"; st.labBoard = null; paint(); loadLabBoard();
  }
  /* Four reads, and a failure in ANY of them is recorded BY NAME rather than left as an empty list.
   * On this screen "nothing outstanding" and "could not tell" must never look the same: one of them
   * means a specimen is sitting somewhere and nobody knows it. Same discipline as loadIntegration. */
  function loadLabBoard() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId);
    var out = { specimens: [], pending: [], criticals: [], toVerify: [], cultures: [], histopathology: [], errors: [] };
    var read = function (name, path, fn) {
      return apiGet(path).then(function (r) {
        if (r && r.ok) fn(r); else out.errors.push(name);
      }).catch(function () { out.errors.push(name); });
    };
    return Promise.all([
      read("specimens", "/ward/collections?" + q + "&scope=hospital", function (r) { out.specimens = r.requests || []; }),
      read("tests awaiting a result", "/ward/pending-tests?" + q + "&scope=hospital", function (r) { out.pending = r.pending || []; }),
      read("results awaiting verification", "/ward/results-to-verify?" + q, function (r) { out.toVerify = r.results || []; if (r.partialWarning) out.errors.push(r.partialWarning); }),
      read("cultures in progress", "/ward/cultures-in-progress?" + q, function (r) { out.cultures = r.cultures || []; out.histopathology = r.histopathology || []; if (r.partialWarning) out.errors.push(r.partialWarning); }),
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
    var out = { requested: [], reported: prev.reported || [], criticals: [], errors: [], picked: prev.picked || null,
      studies: prev.studies, studiesFailed: prev.studiesFailed, templates: prev.templates, templateId: prev.templateId };
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
    st.radBoard.picked = orderId || null;
    st.radBoard.studies = undefined; st.radBoard.studiesFailed = false;
    paint();
    if (orderId) loadRadiologyStudies(st.radBoard, "serviceRequestId=" + encodeURIComponent(orderId));
  }
  function radBoardReportSave() {
    var b = st.radBoard, picked = b && b.picked; if (!picked) return;
    var modality = val("wRadBModality"), status = val("wRadBStatus"), findings = val("wRadBFindings"), impression = val("wRadBImpression");
    var critical = !!(document.getElementById("wRadBCritical") || {}).checked;
    var tplPayload = radTemplatePayload(b.templates, b.templateId, "wRadB");
    if (!findings && !tplPayload.templateId) { st.err = "Say what was seen; the impression may follow."; paint(); return; }
    var row = null;
    for (var i = 0; i < (b.requested || []).length; i++) { if (b.requested[i].orderId === picked) { row = b.requested[i]; break; } }
    st.busy = true; paint();
    apiPost("/ward/report-imaging", Object.assign({ orgId: st.orgId, serviceRequestId: picked, modality: modality || undefined, status: status || "preliminary", findings: findings || undefined, impression: impression || undefined, critical: critical }, tplPayload))
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
  function radBoardFormHtml(row, b) {
    b = b || {};
    return '<div class="w-sub"><h4>' + ms("edit_note") + "File report &middot; " + esc((row && row.name) || "Unknown patient") + (row && row.mrn ? " (" + esc(row.mrn) + ")" : "") + "</h4>" +
      radViewerHtml(radStudyEntry(b.studies, row && row.orderId), b.studies === undefined, !!b.studiesFailed) +
      radTemplateHtml(b.templates, b.templateId, "wRadB") +
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Radiology</b><small>hospital-wide</small></div>" +
      '<button class="w-ic" data-w-act="radboardload" title="Refresh">' + ms("refresh") + "</button></div>" +

      (errs.length ? '<p class="w-hint warn">' + ms("warning") + "Some of this could not be read (" + esc(errs.join(", ")) +
        "). What is shown below is incomplete: do not read an empty section here as nothing outstanding.</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("list") + "<h3>Requested &middot; " + requested.length + "</h3></div>" +
      '<p class="w-hint">This hospital does not record a separate acquisition step for imaging: a study stays on this list from the order until it is reported here, whether or not it has been scanned yet.</p>' +
      (unreachable("imaging worklist") ? '<p class="w-empty warn">The imaging worklist could not be read.</p>'
        : reqRows ? '<ul class="w-crits">' + reqRows + "</ul>"
        : '<p class="w-empty">No studies awaiting acquisition or a report.</p>') +
      (pickedRow ? radBoardFormHtml(pickedRow, b) : "") +
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
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
        "<div><b>Patient flow</b><small>hospital-wide</small></div>" +
        '<button class="w-ic" data-w-act="flowload" title="Refresh">' + ms("refresh") + "</button></div>" +
        (state.flow && state.flow.err ? '<p class="w-hint warn">' + ms("error") + "Patient flow could not be loaded: " + esc(state.flow.err) + ". Do not read this as an empty hospital.</p>"
          : '<p class="w-empty">' + (state.flow && state.flow.loaded ? "Nothing to show yet." : "Loading&hellip;") + "</p>");
    }
    var bottleneckWords = { unplaced_patients: "unplaced patients on", ed_untriaged: "ED patients not yet triaged", beds_blocked: "beds blocked", beds_in_cleaning_turnover: "beds in cleaning turnover", stays_with_open_items: "stays with open items" };
    var bottlenecks = (f.bottlenecks || []).map(function (b) {
      return "<li><b>" + esc(b.count) + "</b> " + esc(bottleneckWords[b.kind] || b.kind) + (b.ward ? " " + esc(b.ward) : "") + "</li>";
    }).join("");
    var fd = f.drill || {};
    var fc = function (key, n, label) { return drillCount(n, label, fd[key], "flowdrill:" + key); };
    var openRows = (f.staysWithOpenItems || []).map(function (s) {
      return "<li><b>" + esc(s.openItems) + "</b> open item" + (s.openItems === 1 ? "" : "s") + '<span>' + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") + (s.lengthOfStayDays != null ? " &middot; day " + esc(s.lengthOfStayDays) : "") + "</span>" +
        (s.encounterId ? '<button class="w-btn ghost tiny" data-w-act="cmdopen:' + esc(s.encounterId) + '">Open chart</button>' : "") + "</li>";
    }).join("");
    var transferRows = (f.recentTransfers || []).map(function (t) {
      return "<li>" + esc((t.movedFrom && t.movedFrom.ward) || "?") + " &rarr; " + esc(t.ward || "?") + '<span>' + when(t.movedAt) + (t.moveReason ? " &middot; " + esc(t.moveReason) : "") + "</span>" +
        (t.encounterId ? '<button class="w-btn ghost tiny" data-w-act="cmdopen:' + esc(t.encounterId) + '">Open chart</button>' : "") + "</li>";
    }).join("");
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Patient flow</b><small>hospital-wide &middot; " + when(f.computedAt) + "</small></div>" +
      '<button class="w-ic" data-w-act="flowload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (state.flow.drill ? drillListHtml("Behind the count: " + state.flow.drill, fd[state.flow.drill], /^ed/.test(state.flow.drill) ? "edboard" : "bedmgmt", "flowdrillclose") : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("emergency") + "<h3>ED</h3></div>" +
      '<div class="w-actions">' + fc("edArrivals", f.ed.arrivals, "in the department") + fc("edUntriaged", f.ed.untriaged, "not yet triaged") + "</div></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>Beds</h3></div>" +
      '<div class="w-actions">' + fc("occupied", f.beds.occupied, "occupied") + fc("unplaced", f.beds.unplacedPatients, "admitted with no bed yet") + "</div>" +
      "<p class=\"w-hint\">Available " + esc(f.beds.states.available) + " &middot; Reserved " + esc(f.beds.states.reserved) +
      " &middot; Blocked " + esc(f.beds.states.blocked) + " &middot; Cleaning " + esc(f.beds.states.cleaning) + " &middot; Maintenance " + esc(f.beds.states.maintenance) + "</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("schedule") + "<h3>Admissions pending</h3></div>" +
      "<p>" + esc(f.admissionsPending.waiting) + " waiting &middot; longest wait " + esc(f.admissionsPending.longestWaitHours) + " h</p></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("task_alt") + "<h3>Discharge</h3></div>" +
      '<div class="w-actions">' + fc("dischargeCandidates", f.dischargeCandidates, f.dischargeCandidates === 1 ? "stay with nothing outstanding right now" : "stays with nothing outstanding right now") + "</div>" +
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
      (section.status === "ok" ? body(section.data) + '<p class="w-dt-times">Computed ' + when(section.generatedAt) + "</p>"
        : '<p class="w-hint warn">' + ms("warning") + esc(section.error || "unavailable") + (section.detail ? ": " + esc(section.detail) : "") + '<br><small>This section is UNAVAILABLE, not zero - the rest of this screen is unaffected.</small></p>') +
      "</div>";
  }
  /* P1.13 DRILL-DOWN. A count with ids behind it is a button that lists them; a count with none
   * says "detail not available" instead of linking to an empty list. */
  var DRILL_BOARDS = { flow: "bedmgmt", criticals: "critsboard", lis: "labboard", labTat: "labboard", radiology: "radboard", icu: "bedmgmt", pharmacy: "inventoryboard", opdQueue: "", staffing: "" };
  var BOARD_WORDS = { bedmgmt: "Bed management", critsboard: "Critical results board", labboard: "Lab board", radboard: "Radiology board", inventoryboard: "Inventory", edboard: "ED board" };
  function drillCount(n, label, d, act) {
    if (n == null) return '<span class="w-hint">' + esc(label) + ": not known</span>";
    if (!d) return "<b>" + esc(n) + "</b> " + esc(label) + ' <small class="w-hint">(detail not available)</small>';
    return '<button class="w-btn ghost tiny" data-w-act="' + esc(act) + '"><b>' + esc(n) + "</b> " + esc(label) + "</button>";
  }
  function twinCount(section, sKey, dKey, n, label) {
    var d = section && section.data && section.data.drill && section.data.drill[dKey];
    return drillCount(n, label, d, "twindrill:" + sKey + "." + dKey);
  }
  function drillListHtml(title, d, board, closeAct) {
    var rows = ((d && d.items) || []).map(function (it) {
      return "<li><b>" + esc(it.label || it.identity || it.patientId || "") + "</b><span>" +
        esc([it.ward, it.bed ? "bed " + it.bed : "", it.minutes != null ? it.minutes + " min" : "", it.waitingHours != null ? it.waitingHours + " h waiting" : "", it.shift || "", it.unit || ""].filter(Boolean).join(" \u00b7 ")) + "</span>" +
        (it.encounterId ? '<button class="w-btn ghost tiny" data-w-act="cmdopen:' + esc(it.encounterId) + '">Open chart</button>' : "") + "</li>";
    }).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("list") + "<h3>" + esc(title) + "</h3>" +
      '<button class="w-ic" data-w-act="' + esc(closeAct) + '" title="Close">' + ms("close") + "</button></div>" +
      (!d ? '<p class="w-hint">Detail not available for this count.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">None.</p>') +
      (d && d.truncated ? '<p class="w-hint warn">Showing ' + esc(d.items.length) + " of " + esc(d.total) + ". The list is cut short; open the board for all of them.</p>" : "") +
      (board ? '<div class="w-actions"><button class="w-btn ghost tiny" data-w-act="' + esc(board) + '">' + esc(BOARD_WORDS[board] || board) + "</button></div>" : "") +
      "</div>";
  }
  function twinDrillHtml(t, dr) {
    if (!dr) return "";
    var sec = t.sections[dr.section];
    var d = sec && sec.data && sec.data.drill && sec.data.drill[dr.key];
    var board = dr.section === "flow" && /^ed/.test(dr.key) ? "edboard" : DRILL_BOARDS[dr.section];
    return drillListHtml("Behind the count: " + dr.section + " " + dr.key, d, board, "twindrillclose");
  }
  function pct(x) { return x == null ? "not known" : Math.round(x * 100) + "%"; }
  function twinView(state) {
    var tw = state.twin || {};
    var t = tw.snapshot;
    if (!t) {
      return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
        "<div><b>Digital twin</b><small>hospital-wide</small></div>" +
        '<button class="w-ic" data-w-act="twinload" title="Refresh">' + ms("refresh") + "</button></div>" +
        '<div class="w-actions"><button class="w-btn ghost" data-w-act="trends">' + ms("query_stats") + "Trends</button></div>" +
        (tw.loaded && tw.err ? '<p class="w-hint warn">' + ms("error") + "The hospital snapshot could not be loaded: " + esc(tw.err) + ". Do not read this as zero.</p>"
          : '<p class="w-empty">' + (tw.loaded ? "Nothing to show yet." : "Loading&hellip;") + "</p>");
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

    var flowDrill = function (key, n, label) {
      var d = s.flow && s.flow.data && s.flow.data.flow && s.flow.data.flow.drill && s.flow.data.flow.drill[key];
      return drillCount(n, label, d, "twindrill:flow." + key);
    };
    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Digital twin</b><small>" + esc(t.sectionsOk) + "/" + esc(t.sectionsTotal) + " sections &middot; " + when(t.generatedAt) + "</small></div>" +
      '<button class="w-ic" data-w-act="twinload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-actions"><button class="w-btn ghost" data-w-act="trends" title="These measures over days, weeks or months, by ward">' + ms("query_stats") + "Trends</button></div>" +
      twinDrillHtml(t, tw.drill) +

      twinSectionCard("hub", "Flow &amp; capacity", s.flow, function (d) {
        var f = d.flow;
        return '<div class="w-actions">' + flowDrill("occupied", f.beds.occupied, "occupied") + flowDrill("edArrivals", f.ed.arrivals, "in ED") + flowDrill("dischargeCandidates", f.dischargeCandidates, "ready to leave") + "</div>";
      }) +
      twinSectionCard("monitor_heart", "Clinical operations", s.clinicalOps, function (d) {
        var m = d.metrics;
        return "<p>" + drillCount(m.open.criticalResults, "open critical result(s)") + " &middot; " + drillCount(m.open.dosesInFlight, "dose(s) in flight") + " &middot; " + drillCount(m.openItems, "open item(s)") + "</p>";
      }) +
      twinSectionCard("priority_high", "Critical results", s.criticals, function (d) {
        return '<div class="w-actions">' + twinCount(s.criticals, "criticals", "open", d.open, "open loop(s)") + "</div>";
      }) +
      twinSectionCard("bed", "ICU", s.icu, function (d) {
        return '<div class="w-actions">' + twinCount(s.icu, "icu", "occupied", d.occupied, "in ICU") +
          twinCount(s.icu, "icu", "ventilated", d.ventilatedRecorded, "ventilator charted in 12 h") +
          twinCount(s.icu, "icu", "vasopressors", d.vasopressorsRecorded, "on a vasoactive order") + "</div>" +
          '<p class="w-hint">Ventilation and vasopressors count what is charted. A patient with nothing charted is not known, not "off".</p>' +
          (d.encounterReadCapped || d.recordsCapped ? '<p class="w-hint warn">Read limit reached: these counts may be low.</p>' : "");
      }) +
      twinSectionCard("groups", "OPD queue today", s.opdQueue, function (d) {
        return "<p>" + drillCount(d.waiting, "waiting") + " &middot; " + drillCount(d.inConsultation, "in consultation") + " &middot; " + esc(d.sessions) + " session(s)</p>" +
          '<p class="w-hint">' + esc(d.drillNotAvailable || "") + "</p>";
      }) +
      twinSectionCard("badge", "Staffing now", s.staffing, function (d) {
        if (!d.rosterConfigured) return '<p class="w-hint">Not known: ' + esc(d.reason || "no roster") + ".</p>";
        var gaps = (d.gaps || []).map(function (g) { return "<li><b>" + esc(g.role) + "</b><span>" + esc(g.shift) + (g.unit ? " &middot; " + esc(g.unit) : "") + " &middot; short " + esc(g.short) + " (have " + esc(g.have) + " of " + esc(g.need) + ")</span></li>"; }).join("");
        return '<div class="w-actions">' + twinCount(s.staffing, "staffing", "onDuty", d.onDutyNow, "on duty now") + "</div>" +
          "<p>" + (d.requiredNow == null ? "No shift is running right now." : esc(d.requiredNow) + " required by the running shift(s)") + "</p>" +
          (gaps ? '<p class="w-hint warn">Gaps</p><ul class="w-mini">' + gaps + "</ul>" : '<p class="w-empty">No gaps against the roster minimum.</p>') +
          (d.partial ? '<p class="w-hint warn">The roster read was cut short; gaps may be incomplete.</p>' : "");
      }) +
      twinSectionCard("science", "Lab turnaround (7 days)", s.labTat, function (d) {
        return (d.sampleSize ? "<p>Median <b>" + esc(d.medianMinutes) + " min</b> &middot; 90th percentile <b>" + esc(d.p90Minutes) + " min</b></p>" : '<p class="w-empty">No reported requests with both times in the last 7 days. No figure is shown.</p>') +
          '<div class="w-actions">' + twinCount(s.labTat, "labTat", "slowest", d.sampleSize, "in the sample") + "</div>" +
          '<p class="w-hint">' + esc(d.excludedTotal) + " excluded for a missing or impossible time.</p>" +
          (d.capped ? '<p class="w-hint warn">Read limit reached: older requests may be missing.</p>' : "");
      }) +
      twinSectionCard("radiology", "Radiology backlog", s.radiology, function (d) {
        return '<div class="w-actions">' + twinCount(s.radiology, "radiology", "waiting", d.waiting, "not yet reported") + "</div>" +
          "<p>" + (d.oldestWaitingSince ? "Oldest waiting since " + when(d.oldestWaitingSince) + " (" + esc(d.oldestWaitingHours) + " h)" : "Oldest wait not known") + "</p>" +
          (d.orderTimeMissing ? '<p class="w-hint">' + esc(d.orderTimeMissing) + " order(s) have no recorded time.</p>" : "");
      }) +
      twinSectionCard("surgical", "Theatre utilisation (24 h)", s.otUtilisation, function (d) {
        if (!d.theatresConfigured) return '<p class="w-hint">Not known: no theatres are set up for this hospital.</p>';
        return "<p>Overall <b>" + pct(d.overallUtilisation) + "</b> of " + esc(d.theatresConfigured) + " theatre(s)</p>" +
          '<ul class="w-mini">' + (d.perTheatre || []).map(function (x) { return "<li><b>" + esc(x.name) + "</b><span>" + pct(x.utilisation) + " &middot; " + esc(x.bookedMinutes) + " min booked</span></li>"; }).join("") + "</ul>";
      }) +
      twinSectionCard("emergency", "Emergency", s.emergency, function (d) {
        return d.any ? "<p>" + esc(d.active.length) + " active declaration(s): " + esc(d.active.map(function (a) { return a.kind; }).join(", ")) + "</p>" : '<p class="w-empty">None active.</p>';
      }) +
      twinSectionCard("event_busy", "Blackouts", s.blackouts, function (d) {
        return d.blackouts.length ? "<p>" + esc(d.blackouts.length) + " active blackout(s)</p>" : '<p class="w-empty">None active.</p>';
      }) +
      twinSectionCard("medication", "Pharmacy", s.pharmacy, function (d) {
        var low = (d.stock || []).filter(function (r) { return r.belowReorder; });
        return "<p>" + esc(d.dispenseCount) + " dispensed &middot; " + esc(d.pendingVerification) + " pending verification &middot; " + esc(low.length) + " below reorder</p>" +
          (low.length ? '<ul class="w-mini">' + low.map(function (r) { return "<li><b>" + esc(r.display || r.code || "") + "</b><span>level " + esc(r.level) + " &middot; reorder at " + esc(r.reorderAt) + "</span></li>"; }).join("") + "</ul>" +
            '<div class="w-actions"><button class="w-btn ghost tiny" data-w-act="inventoryboard">Inventory</button></div>' : "");
      }) +
      twinSectionCard("folder_shared", "HIM", s.him, function (d) {
        return "<p>" + drillCount(d.incompleteCharts, "incomplete chart(s)") + " of " + esc(d.chartsChecked) + " checked</p>";
      }) +
      twinSectionCard("science", "Diagnostics (LIS)", s.lis, function (d) {
        return '<div class="w-actions">' + twinCount(s.lis, "lis", "outstanding", d.outstanding, "outstanding specimens") + "</div><p>of " + esc(d.checked) + " checked</p>";
      }) +
      (t.financeWithheld ? '<div class="w-card"><div class="w-card-h">' + ms("lock") + "<h3>Finance</h3></div><p class=\"w-hint\">Billing and claims need billing rights, so they are not shown.</p></div>" : "") +
      twinSectionCard("payments", "Billing", s.billing, function (d) {
        return "<p>" + drillCount(d.invoiceCount, "invoice(s)") + " &middot; charged " + esc(d.charged) + " &middot; collected " + esc(d.collected) + " &middot; outstanding " + esc(d.outstanding) + "</p>";
      }) +
      twinSectionCard("request_quote", "Claims", s.claims, function (d) {
        return "<p>" + drillCount(d.claimCount, "claim(s)") + " &middot; pending " + esc(d.pending) + " &middot; denied " + esc(d.denied) + " &middot; outstanding " + esc(d.outstandingAmount) + "</p>";
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
      "</div>" +
      twinForecastHtml(tw.forecast) +
      twinAsOfHtml(tw.asOf);
  }
  var TWIN_METRICS = [["bed-demand", "Bed demand"], ["discharge-volume", "Discharges"], ["ed-load", "Emergency arrivals"], ["critical-backlog", "Critical results waiting"], ["diagnostic-workload", "Lab and imaging work"], ["pharmacy-workload", "Pharmacy dispensing"], ["blood-demand", "Blood demand"], ["ot-delays", "Theatre delays"]];
  function twinForecastHtml(f) {
    var body = "";
    if (f && f.busy) body = '<p class="w-empty">Working out the forecast...</p>';
    else if (f && f.error === "insufficient_data") body = '<p class="w-hint">' + ms("info") + "Not enough past days of data to forecast this yet. No number is shown rather than a guess.</p>";
    else if (f && f.error === "not_built") body = '<p class="w-hint">' + ms("info") + "This forecast is not built: " + esc(f.detail || "") + "</p>";
    else if (f && !f.ok) body = '<p class="w-hint warn">' + ms("error") + "The forecast could not be worked out" + (f.detail ? ": " + esc(f.detail) : "") + ".</p>";
    else if (f && f.prediction) {
      var p = f.prediction, u = p.uncertainty || {};
      body = '<p class="w-hint warn"><b>' + esc(p.label) + "</b></p>" +
        "<p><b>" + esc(p.pointEstimate) + "</b> per day expected over the next " + esc(p.horizonDays) + " day" + (p.horizonDays === 1 ? "" : "s") +
        " (likely range " + esc(u.lowerBound) + " to " + esc(u.upperBound) + ")</p>" +
        '<p class="w-dt-times">From ' + esc(p.inputWindow && p.inputWindow.sampleSize) + " days of records, " + esc(String(p.inputWindow && p.inputWindow.from || "").slice(0, 10)) + " to " + esc(String(p.inputWindow && p.inputWindow.to || "").slice(0, 10)) + ". A plain average, not a fitted model.</p>";
    }
    return '<div class="w-card"><div class="w-card-h">' + ms("trending_up") + "<h3>Forecast</h3></div>" +
      '<div class="w-actions">' + TWIN_METRICS.map(function (m) { return '<button class="w-btn ghost tiny" data-w-act="twinpredict:' + m[0] + '">' + esc(m[1]) + "</button>"; }).join("") + "</div>" +
      body + "</div>";
  }
  function twinAsOfHtml(a) {
    var body = "";
    if (a && a.busy) body = '<p class="w-empty">Rebuilding the past state...</p>';
    else if (a && !a.ok) body = '<p class="w-hint warn">' + ms("error") + (a.error === "permission" || a.status === 403 || a.error === "forbidden" ? "Looking back in time needs hospital admin rights." : "Could not rebuild that moment" + (a.detail ? ": " + esc(a.detail) : "") + ".") + "</p>";
    else if (a && a.reconstruction) {
      var s = a.reconstruction.state || {};
      var label = { EmergencyActivation: "Emergencies declared", Blackout: "Scheduling blocks", CriticalResultLoop: "Critical results" };
      body = "<p>As it stood at <b>" + when(a.reconstruction.at) + "</b></p>" + '<ul class="w-mini">' + Object.keys(s).map(function (k) {
        var x = s[k] || {};
        return "<li><b>" + esc(label[k] || k) + "</b><span>" + (x.status === "unavailable" ? '<span class="w-st overdue">could not be read</span>'
          : esc(x.count) + (x.status === "partial" ? ' <span class="w-st due">incomplete' + (x.unreadable ? ": " + esc(x.unreadable) + " unreadable" : "") + (x.capped ? ": only the latest 500 checked" : "") + "</span>" : "")) + "</span></li>";
      }).join("") + "</ul>" +
        '<p class="w-dt-times">Not rebuilt: ' + esc((a.reconstruction.notReconstructed || []).join(", ")) + "</p>";
    }
    return '<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>Look back in time</h3></div>" +
      '<div class="w-filter"><input id="wTwinAt" type="datetime-local"><button class="w-btn ghost" data-w-act="twinasof">Show</button></div>' +
      body + "</div>";
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      '<button class="w-btn go" data-w-act="blackoutadd">' + ms("block") + "Block period</button></div>";
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
  /* WHAT HAS NOT BEEN BILLED YET, AND CLAIMS WORTH A SECOND LOOK.
   * Unbilled charges are the priced items no invoice has picked up; unpriced ones are shown too, because
   * an item with no price is not free, it is a gap in the price list. The coding watchlist lists claims
   * whose clinical coding changed after a payer refused them - each may be a legitimate correction, and
   * each is shown so a person decides. Both say when they could not be loaded. */
  function cashExtras(c) {
    var ch = c.charges, w = c.watch;
    var chBody = !ch ? '<p class="w-empty">Loading.</p>'
      : ch.failed ? '<p class="w-hint warn">' + ms("warning") + "Unbilled charges could not be loaded. Do not read this as nothing to bill.</p>"
      : '<ul class="w-mini">' +
          (ch.priced || []).map(function (i) { return "<li>" + esc(i.display || i.code) + " &middot; " + esc(i.amount) + "</li>"; }).join("") +
          (ch.unpriced || []).map(function (i) { return '<li><span class="w-st due">no price set</span> ' + esc(i.display || i.code) + "</li>"; }).join("") +
        "</ul>" +
        (ch.tariffWarning ? '<p class="w-hint warn">' + ms("warning") + esc(ch.tariffWarning) + "</p>" : "") +
        (!(ch.priced || []).length && !(ch.unpriced || []).length ? '<p class="w-empty">Nothing waiting to be billed.</p>' : "");
    var wBody = !w ? '<p class="w-empty">Loading.</p>'
      : w.failed ? '<p class="w-hint warn">' + ms("warning") + "The coding watchlist could not be loaded.</p>"
      : (w.count ? '<p class="w-hint warn">' + ms("warning") + esc(w.reading) + "</p>" : '<p class="w-empty">No claims need a second look.</p>');
    return '<div class="w-card"><div class="w-card-h">' + ms("receipt_long") + "<h3>Not billed yet</h3></div>" + chBody + "</div>" +
      '<div class="w-card"><div class="w-card-h">' + ms("fact_check") + "<h3>Claims worth a second look</h3></div>" + wBody + "</div>";
  }
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
      var links = c.payLinks === undefined ? "" : c.payLinks === null ? '<p class="w-hint">Loading payment links...</p>'
        : c.payLinks === false ? '<p class="w-hint warn">' + ms("warning") + "Payment links could not be loaded. Do not read this as none sent.</p>"
        : c.payLinks.filter(function (l) { return l.invoiceId === inv.invoiceId; }).map(function (l) {
          return '<p class="w-hint' + (l.status === "flagged" ? " warn" : "") + '">' + ms("link") + "<b>" + esc(PAY_LINK_WORDS[l.status] || l.status) + "</b> " + esc(l.amount) + " " + esc(l.currency) + " via " + esc(l.provider) +
            (l.url ? ' &middot; <a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.url) + "</a>" : "") +
            (l.flag ? " &middot; " + esc(PAY_FLAG_WORDS[l.flag.reason] || l.flag.reason) : "") + "</p>";
        }).join("");
      return '<div class="w-sub"><h4>' + esc(inv.invoiceId) + '<span class="w-st ' + esc(inv.status) + '">' + esc(INVOICE_STATUS_WORDS[inv.status] || inv.status) + "</span></h4>" +
        "<p>Charged " + esc(inv.charged) + " &middot; Paid in " + esc(inv.paidIn) + " &middot; Balance " + esc(inv.balance) + (inv.creditBalance ? " &middot; Credit " + esc(inv.creditBalance) : "") + "</p>" +
        (eventRows ? '<ul class="w-mini">' + eventRows + "</ul>" : "") +
        (receiptRows ? "<h4>Receipts</h4><ul class=\"w-mini\">" + receiptRows + "</ul>" : "") + links +
        (live ? '<div class="w-actions">' +
          '<button class="w-btn tiny go" data-w-act="invpay:' + esc(inv.invoiceId) + '">' + ms("payments") + "Collect payment</button>" +
          (inv.balance > 0 ? '<button class="w-btn tiny ghost" data-w-act="invpaylink:' + esc(inv.invoiceId) + '">' + ms("link") + "Online payment link</button>" : "") +
          '<button class="w-btn tiny ghost" data-w-act="invdeposit:' + esc(inv.invoiceId) + '">' + ms("savings") + "Deposit</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invdiscount:' + esc(inv.invoiceId) + '">' + ms("percent") + "Discount</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invrefund:' + esc(inv.invoiceId) + '">' + ms("undo") + "Refund</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invadjust:' + esc(inv.invoiceId) + '">' + ms("tune") + "Adjustment</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invwriteoff:' + esc(inv.invoiceId) + '">' + ms("remove_circle") + "Write off</button>" +
          '<button class="w-btn tiny ghost" data-w-act="invvoid:' + esc(inv.invoiceId) + '">' + ms("block") + "Cancel this bill</button>" +
          "</div>" : "") + "</div>";
    }).join("");

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Cashier</b><small>financial collection only - no clinical detail</small></div>" +
      '<button class="w-ic" data-w-act="cashload" title="Refresh">' + ms("refresh") + "</button></div>" +
      (c.err ? '<p class="w-hint warn">' + ms("warning") + esc(c.err) + "</p>" : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("search") + "<h3>Find patient</h3></div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>MRN</span><input id="wCashMrn" type="text" autocomplete="off" value="' + esc(c.mrn || "") + '"></label>' +
      "</div>" +
      '<button class="w-btn go" data-w-act="cashlookup">' + ms("search") + "Look up</button>" +
      /* THE SECOND LINE IS THE MRN, NOT THE RECORD ID. A cashier checks a patient against the number
       * on their bill or their card, and "opd-pat-smd-6teqzm-00025" is neither: it is this system's
       * own internal key, meaningless to hold up against anything a patient is carrying. c.mrn is
       * exactly what she just typed to find this person, so it costs nothing extra to show back. */
      (c.patientId ? "<p><b>" + esc(c.patientName || c.patientId) + "</b><br><small>" + esc(c.mrn || c.patientId) + "</small></p>" : "") + "</div>" +

      (c.patientId ? '<div class="w-card"><div class="w-card-h">' + ms("account_balance") + "<h3>Outstanding balance</h3></div>" +
        "<p><b>" + esc(c.outstandingBalance == null ? "-" : c.outstandingBalance) + "</b></p>" +
        '<button class="w-btn" data-w-act="cashraise">' + ms("receipt_long") + "Raise invoice from today's charges</button>" +
        (c.invoicesFailed
          ? '<p class="w-hint warn">' + ms("warning") + "The bills could not be loaded. Do not read this as nothing owed.</p>"
          : (invRows || '<p class="w-empty">No invoices for this patient yet.</p>')) + "</div>" : "") +
      (c.patientId ? cashExtras(c) : "") +

      '<div class="w-card"><div class="w-card-h">' + ms("payments") + "<h3>Post an amount</h3></div>" +
      '<p class="w-hint">Applies to whichever invoice button above you use. A discount, an adjustment and a write-off all require a reason; a plain payment or deposit does not.</p>' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Amount</span><input id="wCashAmount" type="text" inputmode="decimal" autocomplete="off"></label>' +
      '<label class="w-f"><span>Reason (where required)</span><input id="wCashReason" type="text" autocomplete="off"></label>' +
      '<label class="w-f"><span>Reference (optional)</span><input id="wCashReference" type="text" autocomplete="off"></label>' +
      "</div>" +
      /* HOW THE MONEY WAS TAKEN, for a payment or a deposit. Only the fields that method actually
       * needs are asked for, so a cashier taking cash is not faced with a UTR box. The server is the
       * one that refuses an incomplete collection; this just asks for the right things first.
       *
       * There is deliberately no "confirmed by the card machine" tick. A payment recorded here is
       * recorded as typed in, and only a card terminal's own reply can ever mark it confirmed - a
       * screen that let a cashier claim that would make the day's takings unreconcilable. */
      '<div class="w-sub"><h4>How was it paid</h4>' +
      '<select id="wCashMethod">' + CASH_METHODS.map(function (m) {
        return '<option value="' + esc(m[0]) + '"' + (state.cashMethod === m[0] ? " selected" : "") + ">" + esc(m[1]) + "</option>";
      }).join("") + "</select>" +
      '<button class="w-btn ghost sm" data-w-act="cashmethod">Use this method</button>' +
      '<div class="w-grid">' + (CASH_METHOD_NEEDS[state.cashMethod || "cash"] || []).map(function (f) {
        return '<label class="w-f"><span>' + esc(CASH_FIELD_WORDS[f] || f) + '</span><input id="wPay_' + esc(f) + '" type="text" autocomplete="off"></label>';
      }).join("") + "</div>" +
      '<p class="w-hint">' + ms("info") + "This records what the slip, screen or drawer says. It is never marked as confirmed by a card machine from here." + "</p></div>" +
      "</div>";
  }
  var PAY_LINK_WORDS = { open: "Payment link sent, not paid yet", paid: "Paid online, confirmed by the gateway", flagged: "Online payment needs reconciling" };
  var PAY_FLAG_WORDS = {
    amount_or_currency_mismatch: "the gateway reported a different amount or currency, so the bill was not marked paid",
    gateway_says_not_paid: "the gateway does not confirm the payment, so the bill was not marked paid",
    second_payment_on_paid_request: "a second payment arrived on an already paid link",
    payment_not_on_gateway_record: "the payment is not on the gateway's record, so the bill was not marked paid",
    invoice_void: "the bill was cancelled before the payment arrived",
    invoice_missing: "the bill could not be found when the payment arrived",
  };
  var CASH_METHODS = [["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["neft", "NEFT"], ["rtgs", "RTGS"],
    ["imps", "IMPS"], ["bank-transfer", "Bank transfer"], ["cheque", "Cheque"], ["online", "Online"], ["other", "Other"]];
  /* Mirrors what wardsynq-payment-methods.js requires, so the right boxes appear. The server's copy
   * is the authority; if the two ever disagree, the server refuses and says what is missing. */
  var CASH_METHOD_NEEDS = {
    cash: ["counter", "cashier"], upi: ["reference"], card: ["terminal", "reference"],
    neft: ["utr", "bank", "payer"], rtgs: ["utr", "bank", "payer"], imps: ["utr", "bank", "payer"],
    "bank-transfer": ["utr", "bank", "payer"], cheque: ["reference", "bank"], online: ["reference"], other: ["reference"],
  };
  var CASH_FIELD_WORDS = {
    counter: "Counter", cashier: "Cashier", reference: "Reference", terminal: "Card machine",
    utr: "UTR number", bank: "Bank", payer: "Paid by",
  };

  /* TASK 3.5: the blood bank workstation. wardsynq-transfusion.js (HAZ-BLD-01) already enforces
   * everything hazardous here - ABO/RhD compatibility, a crossmatch bound to one patient, and a
   * two-person bedside check that re-derives compatibility from the physical unit rather than the
   * paperwork. This screen adds NO logic: it shows the server's own verdict/failure reasons verbatim
   * and never lets the bedside-check button submit without both scans and both names present -
   * NO ONE-CLICK TRANSFUSE, enforced here as well as on the server. */
  var TXN_PHASE_WORDS = { requested: "Requested", crossmatched: "Crossmatched", issued: "Issued", checked: "Bedside check passed", transfusing: "Transfusing", completed: "Completed", stopped: "STOPPED" };
  /* TRACING A BLOOD UNIT. Every movement of one bag - issued, checked, transfused, returned - from the
   * record, in order. Asked when a reaction is reported or a donor is recalled, and the answer has to
   * be complete: a trace that silently skipped a step is a trace that hides the step that mattered. */
  function bloodTraceBlock(state) {
    var t = state.bloodTrace;
    return '<div class="w-card"><div class="w-card-h">' + ms("search") + "<h3>Trace a blood unit</h3></div>" +
      '<input id="wTxTraceUnit" placeholder="Unit number on the bag">' +
      '<button class="w-btn ghost" data-w-act="bloodtrace">' + ms("search") + "Trace</button>" +
      (t == null ? ""
        : !t.ok ? '<p class="w-hint warn">' + ms("warning") + "The trace could not be read. Do not treat this unit as untraced.</p>"
        : (t.trace && t.trace.length)
          ? '<ul class="w-mini">' + t.trace.map(function (x) {
              return "<li>" + when(x.at) + " &middot; <b>" + esc(x.event || x.phase || "") + "</b>" +
                (x.patientId ? " &middot; patient " + esc(x.patientId) : "") + (x.by || x.actorId ? " &middot; " + esc(x.by || x.actorId) : "") +
                (x.detail ? " &middot; " + esc(typeof x.detail === "string" ? x.detail : JSON.stringify(x.detail)) : "") + "</li>";
            }).join("") + "</ul>"
          : '<p class="w-empty">No record of unit ' + esc(t.unitId) + ".</p>") +
      "</div>";
  }
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

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Blood bank</b><small>" + esc((state.sel && state.sel.patientId) || "") + "</small></div>" +
      '<button class="w-ic" data-w-act="txload" title="Refresh">' + ms("refresh") + "</button></div>" +

      '<div class="w-card"><div class="w-card-h">' + ms("bloodtype") + "<h3>Requests</h3></div>" +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No transfusion requested for this patient.</p>') +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Component</span><select id="wTxComponent">' +
        '<option value="red-cells">Packed Red Blood Cells (PRBC / Red cells)</option>' +
        '<option value="whole-blood">Whole Blood</option>' +
        '<option value="plasma">Fresh Frozen Plasma (FFP / Plasma)</option>' +
        '<option value="platelets">Platelets (RDP / SDP)</option>' +
        '<option value="cryoprecipitate">Cryoprecipitate</option>' +
        '<option value="granulocytes">Granulocytes</option>' +
        '<option value="other">Other Component</option>' +
      '</select></label>' +
      '<label class="w-f"><span>Units</span><input id="wTxUnits" type="text" inputmode="numeric" autocomplete="off" value="1"></label>' +
      '<label class="w-f"><span>Required Urgency</span><select id="wTxUrgency">' +
        '<option value="immediate">Stat / Immediate (&lt; 30 min - Life threatening)</option>' +
        '<option value="urgent" selected>Urgent (Within 2-4 hours)</option>' +
        '<option value="routine">Routine (Next 6-12 hours)</option>' +
        '<option value="preop">Pre-operative reserve</option>' +
      '</select></label>' +
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

      (ep ? ('<div class="w-card"><div class="w-card-h">' + ms("history") + "<h3>Ledger</h3></div>" + (ledgerRows ? '<ul class="w-mini">' + ledgerRows + "</ul>" : "") + "</div>") : "") +
      bloodTraceBlock(state);
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
        '<button class="w-btn tiny ghost" data-w-act="incidentsignal:CriticalResultLoop~' + esc(c.loopId) + '">' + ms("report") + "Raise safety signal</button>" +
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
  /* reportsView() deliberately renders every report's own body generically (see the comment above
   * REPORT_LABELS) - key: value, no bespoke layout per report. But some reports (patient flow, whose
   * "flow" field is one big nested computation) put a structured object or array under that key, and
   * JSON.stringify-ing it produced one unbroken line of raw JSON stretching the width of the page -
   * unreadable, and looking like the screen was broken rather than just generic. This nests instead
   * of flattening: an object becomes its own bulleted key: value list, an array becomes a bulleted
   * list of its items, recursively - still nothing bespoke to any one report, just readable at any
   * depth. */
  /* THE CONSULTATION: ONE SCREEN, ONE SAVE.
   *
   * Everything below can already be written one piece at a time from the chart, and those buttons
   * are staying - a nurse recording a set of observations should not have to open a consultation.
   * What this screen adds is the act as the clinician actually performs it: examine, diagnose,
   * prescribe, order, write it up, once, and press save once.
   *
   * The reason it is worth a screen of its own is what the old way did on failure. Five buttons
   * meant five separate saves, each reporting into the same single error line, and whichever reply
   * landed last won - so a refused prescription could be painted over by a successful note and the
   * doctor would walk away believing the drug was ordered. Here the server takes all five together,
   * checks the whole lot against what this person may write BEFORE it writes any of it, and if it
   * cannot finish it says exactly which pieces reached the chart and which were never attempted.
   * This screen shows that answer literally rather than reducing it to "saved" or "failed". */
  function consultationResultView(r) {
    if (!r) return "";
    if (r.ok) return '<div class="w-sub"><h4>Saved</h4><p>' + esc(r.written) + " item" + (r.written === 1 ? "" : "s") + " written to the chart.</p></div>";
    if (r.refused && r.refused.length) {
      return '<div class="w-sub"><h4>Not saved - and nothing was written</h4>' +
        "<p>This role may not write every part of this consultation, so none of it was saved. The chart is unchanged.</p><ul class=\"w-mini\">" +
        r.refused.map(function (x) { return "<li>" + esc(x.detail) + "</li>"; }).join("") +
        "</ul>" + (r.allowed && r.allowed.length ? "<p>You could save just: " + esc(r.allowed.join(", ")) + ".</p>" : "") + "</div>";
    }
    /* EVERY OTHER FAILURE IS SAID, and it is all-or-nothing now: the server saves a consultation in one
     * transaction, so a failure means none of it is on the chart and what was typed is still here to
     * fix and save again. This used to return "" for anything but a refusal or a partial save, so a
     * consultation that failed outright showed no sign at all that it had not been saved. */
    return '<div class="w-sub"><h4>Not saved - nothing from this consultation is on the chart</h4>' +
      "<p>" + esc(r.detail || r.message || r.error || "The consultation could not be saved.") + "</p>" +
      (r.failedAt ? "<p><b>The part that failed:</b> " + esc(r.failedAt) + "</p>" : "") +
      "<ul class=\"w-mini\">" + (r.results || []).filter(function (x) { return !x.ok; })
        .map(function (x) { return "<li>" + esc(x.piece) + ": " + esc(x.detail || x.error) + "</li>"; }).join("") + "</ul>" +
      "<p>What you typed is still here. Fix the part that failed and save again.</p></div>";
  }

  /* THE HALF-FILLED CONSULTATION HAS TO SURVIVE A REPAINT.
   *
   * This screen is one long form, and every repaint rebuilds it from scratch - so without this, a
   * doctor who typed the vitals, the drug and half the note and then pressed "Find the code" would
   * watch the whole lot vanish. Any repaint at all did it: the busy spinner, a background refresh,
   * anything. The values are snapshotted off the DOM before a repaint and rendered back in.
   *
   * Deliberately NOT kept once the consultation is saved or the screen is left: a draft that
   * outlives its patient is how one patient's findings end up typed into another's chart. close()
   * clears it with everything else. */
  var C_FIELDS = ["wcProbText", "wcProbCode", "wcProbVs", "wcMoDrug", "wcMoValue", "wcMoUnit",
    "wcMoRoute", "wcMoFreq", "wcInvCode", "wcInvReason", "wcInvPri", "wcNoteTpl", "wcNoteText",
    "wc_o2", "wc_acvpu"];
  function cDraft(d, id) { return (d && d[id]) || ""; }
  /* Options for one of the consultation's dropdowns, with whatever was already chosen marked
   * selected - a select rebuilt without this silently snaps back to its first option, which on the
   * oxygen box means a repaint turns "on oxygen" into "not recorded". */
  function cOpts(d, id, pairs) {
    var cur = cDraft(d, id);
    return pairs.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("");
  }
  function cSnapshot() {
    var d = st.cDraft || {};
    VITALS.forEach(function (f) { var el = document.getElementById("wc_" + f.k); if (el) d["wc_" + f.k] = el.value; });
    C_FIELDS.forEach(function (id) { var el = document.getElementById(id); if (el) d[id] = el.value; });
    st.cDraft = d;
  }

  function consultationView(state) {
    var d = state.cDraft || {};
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var vf = VITALS.map(function (v) {
      var unit = v.u !== null ? v.u : v.k === "weight" ? weightUnitLabel() : tempUnitLabel();
      return '<label class="w-f"><span>' + esc(v.l) + " <i>" + esc(unit) + "</i></span>" +
        '<input id="wc_' + v.k + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(cDraft(d, "wc_" + v.k)) + '"></label>';
    }).join("");
    var tpls = cOpts(d, "wcNoteTpl", [["", "Choose a template…"]].concat((state.templates || []).map(function (t) {
      return [t.id, t.name || t.id];
    })));
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Consultation</h3></div>" +
      '<p class="w-hint">' + ms("info") + "Fill in only what you did. Empty sections are not saved. Everything here is saved together, in one go." + "</p>" +

      '<div class="w-sub"><h4>Observations</h4><div class="w-grid">' + vf + "</div>" +
      '<div class="w-fluid"><label class="w-f"><span>Supplemental oxygen</span>' +
      '<select id="wc_o2">' + cOpts(d, "wc_o2", [["", "Not recorded"], ["0", "Breathing air"], ["1", "On oxygen"]]) + "</select></label>" +
      '<label class="w-f"><span>Consciousness <i>ACVPU</i></span><select id="wc_acvpu">' +
      cOpts(d, "wc_acvpu", ACVPU) + "</select></label></div></div>" +

      /* The code search is the SAME one the chart's own diagnosis box uses. It is offered here and
       * never required: a coded diagnosis is better, an uncoded one is honest, and a guessed code is
       * neither. Nothing auto-selects, not even on a single result - a person picks, exactly as on
       * the chart, because one result is not the same as the right one. */
      '<div class="w-sub"><h4>Diagnosis</h4>' +
      '<input id="wcProbText" placeholder="The problem, in words" value="' + esc(cDraft(d, "wcProbText")) + '">' +
      '<input id="wcProbCode" placeholder="Code (optional)" value="' + esc(cDraft(d, "wcProbCode")) + '">' +
      '<button class="w-btn ghost sm" data-w-act="cfindcode">' + ms("search") + "Find the code</button>" +
      (state.cIcd === null ? '<p class="w-hint">' + ms("info") + "Searching…</p>" : "") +
      (Array.isArray(state.cIcd)
        ? (state.cIcd.length
          ? '<ul class="w-icd">' + state.cIcd.map(function (c, i) {
              return '<li><button class="w-icd-p" data-w-act="cicdpick:' + i + '"><b>' + esc(c.code) + "</b><span>" + esc(c.title) + "</span><small>" + esc(c.system || "") + "</small></button></li>";
            }).join("") + "</ul>"
          : '<p class="w-hint">' + ms("info") + "No matching code. Record it in words: an uncoded diagnosis is honest, a guessed code is not.</p>")
        : "") +
      '<select id="wcProbVs">' + cOpts(d, "wcProbVs", [["", "Clinical certainty (select)..."], ["provisional", "Provisional"], ["differential", "Differential"], ["confirmed", "Confirmed"]]) + "</select></div>" +

      '<div class="w-sub"><h4>Prescription</h4>' +
      '<input id="wcMoDrug" placeholder="Drug" value="' + esc(cDraft(d, "wcMoDrug")) + '">' +
      '<div class="w-grid"><label class="w-f"><span>Dose</span><input id="wcMoValue" inputmode="decimal" value="' + esc(cDraft(d, "wcMoValue")) + '"></label>' +
      '<label class="w-f"><span>Unit</span><input id="wcMoUnit" value="' + esc(cDraft(d, "wcMoUnit")) + '"></label></div>' +
      '<input id="wcMoRoute" placeholder="Route (optional)" value="' + esc(cDraft(d, "wcMoRoute")) + '">' +
      '<input id="wcMoFreq" placeholder="How often (optional)" value="' + esc(cDraft(d, "wcMoFreq")) + '">' +
      '<p class="w-hint">Drug, dose and unit go together. Any one of them on its own is not enough to prescribe.</p></div>' +

      '<div class="w-sub"><h4>Test to order</h4>' +
      '<input id="wcInvCode" placeholder="Name of the test" value="' + esc(cDraft(d, "wcInvCode")) + '">' +
      '<input id="wcInvReason" placeholder="Why (optional)" value="' + esc(cDraft(d, "wcInvReason")) + '">' +
      '<select id="wcInvPri">' + cOpts(d, "wcInvPri", [["", "Routine"], ["urgent", "Urgent"], ["stat", "Immediately"]]) + "</select></div>" +

      '<div class="w-sub"><h4>Note</h4>' +
      '<select id="wcNoteTpl">' + tpls + "</select>" +
      '<textarea id="wcNoteText" rows="4" placeholder="What you found and what you decided">' + esc(cDraft(d, "wcNoteText")) + "</textarea>" +
      '<p class="w-hint">A note needs a template chosen before it can be written.</p></div>' +

      consultationResultView(state.consultationResult) +
      '<button class="w-btn" data-w-act="consultationsave">' + ms("save") + "Save the whole consultation</button>" +
      "</div>";
  }

  /* APPROVALS. The door that has to exist because the formulary's lock is now real.
   *
   * A restricted drug needs an approval reference, and until now the prescriber invented one, which
   * meant the lock was decoration. Now the reference has to name an approval that actually exists,
   * so there has to be somewhere to ask for one and somewhere for the person who grants it to say
   * yes. This is that place.
   *
   * The chain is shown in full, oldest first, including approvals that were later withdrawn -
   * nothing here ever edits or hides what already happened, because "it was approved and then taken
   * back" is exactly the thing somebody reviewing a case later needs to be able to see. */
  var APPROVAL_SUBJECTS = [
    ["RestrictedMedication", "A restricted medicine"],
    ["PurchaseOrder", "A purchase order"],
    ["StockRequisition", "A stock request"],
    ["Discharge", "A discharge"],
    ["Invoice", "A bill"],
    ["Incident", "An incident"],
  ];
  function approvalRow(v) {
    var stateLabel = v.state === "approved" ? "approved" : v.state === "rejected" ? "turned down" : "waiting";
    var stateClass = v.state === "approved" ? "" : v.state === "rejected" ? "escalate" : "due";
    var hist = (v.history || []).map(function (h) {
      var what = h.kind === "request" ? "asked" : (h.decision === "approved" ? "approved" : h.decision === "rejected" ? "turned down" : "took back");
      return "<li>" + esc(what) + " by " + esc(h.by) + " &middot; " + when(h.at) + (h.reason ? " &middot; " + esc(h.reason) : "") + "</li>";
    }).join("");
    return '<li class="w-mini-row"><div>' +
      '<span class="w-st ' + esc(stateClass) + '">' + esc(stateLabel) + "</span> " +
      "<b>" + esc(v.subjectId) + "</b> &middot; " + esc(v.subjectType) +
      " &middot; " + esc(v.approvals) + " of " + esc(v.required) + " approved" +
      (v.withdrawn ? " &middot; something was taken back" : "") +
      '<div class="w-dt-times">' + esc(v.reason || "") + "</div>" +
      (hist ? '<ul class="w-mini">' + hist + "</ul>" : "") +
      '<div class="w-dt-times">Reference: ' + esc(v.verificationId) + "</div>" +
      "</div><div class=\"w-mini-row-act\">" +
      (v.state === "pending"
        ? '<button class="w-btn ghost sm" data-w-act="approvalyes:' + esc(v.verificationId) + '">' + ms("check") + "Approve</button>" +
          '<button class="w-btn ghost sm" data-w-act="approvalno:' + esc(v.verificationId) + '">' + ms("block") + "Turn down</button>"
        : "") +
      "</div></li>";
  }
  function approvalsView(state) {
    var rows = (state.approvals || []).map(approvalRow).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Approvals</h3><button class=\"w-btn ghost\" data-w-act=\"approvals\">" + ms("refresh") + "Refresh</button></div>" +
      '<div class="w-sub"><h4>Ask for an approval</h4>' +
      '<select id="wApSubjType">' +
      APPROVAL_SUBJECTS.map(function (a) { return '<option value="' + esc(a[0]) + '">' + esc(a[1]) + "</option>"; }).join("") +
      "</select>" +
      '<input id="wApSubjId" placeholder="Which one - for a medicine, the drug name exactly as prescribed">' +
      '<textarea id="wApReason" rows="2" placeholder="Why it is needed"></textarea>' +
      '<p class="w-hint">' + ms("info") + "The name has to match the drug exactly, or the approval will not cover the prescription. Whoever asks cannot also be the one who approves." +
      "</p><button class=\"w-btn\" data-w-act=\"approvalask\">" + ms("send") + "Ask</button></div>" +
      (state.approvals !== null
        ? (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No approvals on the ledger.</p>')
        : "") +
      "</div>";
  }

  /* PURCHASING. The pharmacy's own screen: raise an order, get it approved, book the stock in.
   *
   * How much of an order has arrived is never shown from a stored field - the server adds up the
   * deliveries booked against it every time it is asked, the same way a stock level is a sum of
   * movements rather than a counter. So a part-delivered order is not a state somebody forgot to
   * update; it is what the arithmetic says.
   *
   * Over-delivery and a delivery in the wrong unit are SHOWN, not hidden: in both cases the boxes
   * are physically on the shelf, and a screen that quietly dropped them would be a screen whose
   * numbers nobody could trust. */
  function poLineRow(l) {
    return "<li>" + esc(l.item) + " &middot; " +
      (l.ordered === null ? "quantity unusable" : esc(l.received) + " of " + esc(l.ordered) + " " + esc(l.unit)) +
      (l.over ? ' <span class="w-st escalate">' + esc(l.over) + " more than ordered</span>" : "") +
      (l.unusable ? ' <span class="w-st escalate">' + esc(l.unusable) + "</span>" : "") +
      (l.receivedInOtherUnits ? ' <span class="w-st due">also ' + l.receivedInOtherUnits.map(function (o) { return esc(o.quantity) + " " + esc(o.unit); }).join(", ") + ", not counted here</span>" : "") +
      "</li>";
  }
  function rupeesOf(paise) { return "Rs " + (Math.round(Number(paise) || 0) / 100).toFixed(2); }
  function poRow(o) {
    var label = { "awaiting-approval": "waiting for approval", rejected: "turned down", open: "ordered, nothing in yet",
      "part-received": "part delivered", received: "all in", cancelled: "cancelled" }[o.state] || o.state;
    var cls = o.state === "received" ? "" : o.state === "rejected" || o.state === "cancelled" ? "escalate" : "due";
    return '<li class="w-mini-row"><div>' +
      '<span class="w-st ' + esc(cls) + '">' + esc(label) + "</span> " +
      "<b>" + esc(o.vendor) + "</b>" +
      '<div class="w-dt-times">raised by ' + esc(o.raisedBy) + " &middot; " + when(o.raisedAt) +
      " &middot; approvals " + esc(o.approval && o.approval.approvals || 0) + " of " + esc(o.approval && o.approval.required || 1) +
      " &middot; " + (o.totalPaise == null ? "total not known (a line has no price)" : "total " + rupeesOf(o.totalPaise)) + "</div>" +
      '<ul class="w-mini">' + (o.lines || []).map(poLineRow).join("") + "</ul>" +
      '<div class="w-dt-times">Reference: ' + esc(o.purchaseOrderId) + "</div></div>" +
      '<div class="w-mini-row-act">' +
      (o.state === "awaiting-approval"
        ? '<button class="w-btn ghost sm" data-w-act="poask:' + esc(o.purchaseOrderId) + '">' + ms("send") + "Ask for approval</button>"
        : "") +
      (o.state === "open" || o.state === "part-received"
        ? '<button class="w-btn ghost sm" data-w-act="poreceive:' + esc(o.purchaseOrderId) + '">' + ms("add") + "Book stock in</button>"
        : "") +
      "</div></li>";
  }
  function purchasingView(state) {
    var rows = (state.purchaseOrders || []).map(poRow).join("");
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Purchasing</h3><button class=\"w-btn ghost\" data-w-act=\"purchasing\">" + ms("refresh") + "Refresh</button></div>" +
      '<div class="w-sub"><h4>Raise an order</h4>' +
      '<input id="wPoVendor" placeholder="Supplier">' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Item</span><input id="wPoItem"></label>' +
      '<label class="w-f"><span>How many</span><input id="wPoQty" inputmode="decimal"></label>' +
      '<label class="w-f"><span>Counted in</span><input id="wPoUnit" placeholder="box, strip, vial"></label>' +
      '<label class="w-f"><span>Price per unit (Rs)</span><input id="wPoPrice" inputmode="decimal" placeholder="optional"></label>' +
      "</div>" +
      '<p class="w-hint">' + ms("info") + "One item per order for now. The unit is recorded as you type it and is never converted, so a delivery in a different unit will not count against this line. " +
      "Without a price the order total is unknown, and the hospital's strictest approval level applies." +
      "</p><button class=\"w-btn\" data-w-act=\"poraise\">" + ms("save") + "Raise</button></div>" +
      (state.purchaseOrdersFailed ? '<p class="w-hint warn">' + ms("error") + "Purchase orders could not be loaded. Do not read this as none." + (state.purchaseOrders ? " The list below may be out of date." : "") + "</p>" : "") +
      (state.purchaseOrders == null ? (state.purchaseOrdersFailed ? "" : '<p class="w-empty">Loading purchase orders...</p>')
        : rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No purchase orders.</p>') +
      "</div>";
  }

  /* WHO TO RING, AND WHETHER THIS PATIENT HAS DIED.
   *
   * Both are facts about a person rather than findings about a body, so they share a screen. The
   * contact list is the one a ward reaches for at the worst moment of a stay, which is why a
   * patient with nobody recorded is told about loudly here and not left as an empty list.
   *
   * Removed contacts stay on the screen, struck through. A number that was quietly deleted last
   * month is indistinguishable from one that was never there, and the difference matters when
   * somebody is trying to work out who was told what. */
  var RELATIONSHIPS = ["spouse", "parent", "child", "sibling", "grandparent", "grandchild",
    "guardian", "friend", "neighbour", "carer", "employer", "other"];
  function personRow(p) {
    var roles = [p.nextOfKin ? "next of kin" : "", p.guardian ? "guardian" : "", p.emergencyContact ? "emergency contact" : ""]
      .filter(Boolean).join(", ");
    return '<li class="w-mini-row' + (p.active ? "" : " w-gone") + '"><div>' +
      "<b>" + esc(p.name) + "</b> &middot; " + esc(p.relationship) +
      (p.phone ? ' &middot; <a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + "</a>" : "") +
      (roles ? ' <span class="w-st due">' + esc(roles) + "</span>" : "") +
      (p.active ? "" : ' <span class="w-st">removed</span>') +
      '<div class="w-dt-times">recorded by ' + esc(p.recordedBy) + " &middot; " + when(p.recordedAt) +
      (p.active ? "" : " &middot; removed by " + esc(p.removedBy || "") + " " + when(p.removedAt) +
        (p.removedReason ? " &middot; " + esc(p.removedReason) : "")) + "</div>" +
      (p.note ? "<div>" + esc(p.note) + "</div>" : "") +
      "</div><div class=\"w-mini-row-act\">" +
      (p.active ? '<button class="w-btn ghost sm" data-w-act="personremove:' + esc(p.relatedPersonId) + '">' + ms("close") + "Remove</button>" : "") +
      "</div></li>";
  }
  function peopleView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.people;
    var rows = d && d.people ? d.people.map(personRow).join("") : "";
    /* The deceased block sits at the TOP, because it changes how everything below it should be
     * read - and because somebody about to telephone a family needs to know before they dial. */
    var deceased = "";
    if (d && d.deceased) {
      deceased = '<div class="w-sub w-dead"><h4>' + ms("warning") + "This patient is recorded as deceased</h4>" +
        "<p>Died " + when(d.deceased.at) +
        (d.deceased.cause ? " &middot; " + esc(d.deceased.cause) : "") +
        (d.deceased.certifiedBy ? " &middot; certified by " + esc(d.deceased.certifiedBy) : "") + "</p>" +
        '<div class="w-dt-times">recorded by ' + esc(d.deceased.recordedBy) + " &middot; " + when(d.deceased.recordedAt) + "</div>" +
        '<p class="w-hint">' + ms("info") + "The chart stays open and readable. Recording what happened after a death is normal work." +
        "</p><button class=\"w-btn ghost\" data-w-act=\"deathwithdraw\">" + ms("undo") + "This is the wrong patient</button></div>";
    } else if (d && d.deceasedCorrected) {
      deceased = '<div class="w-sub"><h4>A death recorded against this patient was withdrawn</h4>' +
        "<p>" + esc(d.deceasedCorrected.reason) + "</p>" +
        '<div class="w-dt-times">by ' + esc(d.deceasedCorrected.by) + " &middot; " + when(d.deceasedCorrected.at) + "</div></div>";
    }
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Contacts and status</h3>" +
      '<button class="w-ic" data-w-act="people" title="Refresh">' + ms("refresh") + "</button></div>" +
      deceased +
      (d && d.warning ? '<p class="w-hint warn">' + ms("warning") + esc(d.warning) + " Nobody can be telephoned about this patient.</p>" : "") +
      '<div class="w-sub"><h4>Add somebody to contact</h4>' +
      '<input id="wPerName" placeholder="Their name">' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>How they are related</span><select id="wPerRel">' +
      RELATIONSHIPS.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="w-f"><span>Telephone</span><input id="wPerPhone" inputmode="tel"></label>' +
      "</div>" +
      '<label class="w-f" style="flex-direction:row;align-items:center"><input id="wPerKin" type="checkbox" style="width:auto;margin:0 8px 0 0"><span>Next of kin</span></label>' +
      '<label class="w-f" style="flex-direction:row;align-items:center"><input id="wPerGuard" type="checkbox" style="width:auto;margin:0 8px 0 0"><span>Guardian</span></label>' +
      '<label class="w-f" style="flex-direction:row;align-items:center"><input id="wPerEmg" type="checkbox" style="width:auto;margin:0 8px 0 0"><span>Emergency contact</span></label>' +
      '<p class="w-hint">' + ms("info") + "A next of kin or emergency contact needs a number - this is the name somebody rings." +
      "</p><button class=\"w-btn\" data-w-act=\"personadd\">" + ms("save") + "Add</button></div>" +
      (d ? (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">Nobody recorded yet.</p>') : "") +
      (d && !d.deceased
        ? '<div class="w-sub"><h4>Record a death</h4>' +
          '<p class="w-hint">' + ms("warning") + "This is a clinical statement and it is recorded permanently against this patient. Check you have the right person." +
          "</p><button class=\"w-btn ghost\" data-w-act=\"deathrecord\">" + ms("report") + "Record that this patient has died</button></div>"
        : "") +
      "</div>";
  }

  /* THE WORKSPACE — everything about this patient a doctor needs before they decide anything, on
   * one screen, composed from what the chart already loaded.
   *
   * IT IS A PROJECTION AND OWNS NOTHING. Every block below reads state the chart already fetched
   * through the governed routes; there is no new endpoint, no second copy and no separate idea of
   * what is true. Delete this screen and nothing becomes impossible - the doctor just goes back to
   * reading nine cards to answer one question.
   *
   * THE RULE THAT MATTERS MOST: AN EMPTY BLOCK AND AN UNLOADED BLOCK MUST NEVER LOOK ALIKE.
   * An empty allergy box reads as "no known allergies" to every clinician alive. So a block whose
   * data did not load says so, in those words, and never renders as blank calm. This is the same
   * reasoning the chart already applies to critical results ("do not read this chart as clear").
   */
  function wsBlock(title, icon, body, notLoaded, act) {
    return '<div class="w-ws-b"><h4>' + ms(icon) + esc(title) +
      (act ? '<button class="w-btn ghost sm" data-w-act="' + esc(act) + '">Open</button>' : "") + "</h4>" +
      (notLoaded
        ? '<p class="w-hint warn">' + ms("warning") + "Not loaded. Do not read this as empty.</p>"
        : body) +
      "</div>";
  }
  function wsList(rows, emptyWords) {
    return rows && rows.length ? '<ul class="w-mini">' + rows.join("") + "</ul>"
      : '<p class="w-empty">' + esc(emptyWords) + "</p>";
  }
  function workspaceView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var tl = state.timeline;
    var ev = function (cat) { return (tl || []).filter(function (e) { return e.category === cat; }); };

    /* Allergies come off the timeline, which is the governed chart read - there is no separate
     * allergy endpoint, and inventing one would be a second source of truth for the single fact a
     * prescriber most needs to be right about. */
    var allergies = ev("allergy").map(function (e) {
      return '<li class="w-ws-alert">' + esc(e.label) + "</li>";
    });
    var openCriticals = (state.criticals || []).filter(function (c) { return c.state === "open"; });
    var criticalRows = openCriticals.map(function (c) {
      return '<li class="w-ws-alert"><b>' + esc(c.display || c.code) + "</b>" +
        (c.value != null ? " " + esc(c.value) + (c.unit ? " " + esc(c.unit) : "") : "") +
        " &middot; nobody has acknowledged this yet</li>";
    });
    var problemRows = (state.problems || []).filter(function (p) { return p.clinicalStatus !== "resolved"; })
      .map(function (p) { return "<li>" + esc(p.display || p.code) + (p.verificationStatus ? ' <span class="w-st">' + esc(p.verificationStatus) + "</span>" : "") + "</li>"; });
    var medRows = (state.activeMeds || []).map(function (m) {
      return "<li><b>" + esc(m.drug) + "</b>" +
        (m.dose && m.dose.value != null ? " " + esc(m.dose.value) + esc(m.dose.unit || "") : "") +
        (m.route ? " " + esc(m.route) : "") + (m.frequency ? " " + esc(m.frequency) : "") + "</li>";
    });
    var resultRows = ev("result").slice(0, 5).map(function (e) {
      return "<li" + (e.critical ? ' class="w-ws-alert"' : "") + ">" + esc(e.label) + "</li>";
    });
    var pendingRows = ev("investigation").filter(function (e) { return e.reportReady === false; })
      .map(function (e) { return "<li>" + esc(e.label) + ' <span class="w-st due">waiting</span></li>'; });
    var noteRows = ev("note").slice(0, 3).map(function (e) {
      var first = e.body && e.body[0] ? String(e.body[0].text || "") : "";
      return "<li>" + esc(e.label) + (first ? '<div class="w-dt-times">' + esc(first.length > 120 ? first.slice(0, 120) + "…" : first) + "</div>" : "") + "</li>";
    });

    var n = state.news2;
    var vitals = n && n.total != null
      ? "<p><b>Early warning score " + esc(n.total) + "</b>" + (n.incomplete ? ' <span class="w-st escalate">incomplete - some observations were never recorded</span>' : "") + "</p>"
      : '<p class="w-empty">No score yet.</p>';

    var people = state.people;
    var deceased = people && people.deceased
      ? '<div class="w-card w-dead"><h4>' + ms("warning") + "This patient is recorded as deceased</h4><p>Died " + when(people.deceased.at) + "</p></div>"
      : "";

    return '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>" + esc(s.name || s.patientId || "Patient") + "</b><small>" +
        (s.mrn ? esc(s.mrn) + " &middot; " : "") + esc(s.ward || "") + (s.bed ? " &middot; bed " + esc(s.bed) : "") +
        " &middot; admitted " + when(s.admittedAt) + "</small></div>" +
      '<button class="w-ic" data-w-act="workspace" title="Refresh">' + ms("refresh") + "</button></div>" +
      deceased +
      '<div class="w-card">' +
      /* The three that change what a prescriber may safely do come first and are never collapsed. */
      '<div class="w-ws-top">' +
      wsBlock("Allergies", "warning", wsList(allergies, "None recorded."), tl == null, "") +
      wsBlock("Critical results", "priority_high", wsList(criticalRows, "None outstanding."), state.criticals == null, "critsboard") +
      wsBlock("Current medicines", "medication", wsList(medRows, "None active."), state.activeMeds == null, "round") +
      "</div>" +
      '<div class="w-ws-grid">' +
      wsBlock("Active problems", "fact_check", wsList(problemRows, "None recorded."), state.problems == null, "") +
      wsBlock("Latest observations", "monitor_heart", vitals, state.news2 === undefined, "flowsheet") +
      wsBlock("Recent results", "science", wsList(resultRows, "None yet."), tl == null, "investigations") +
      wsBlock("Waiting for a result", "hourglass_top", wsList(pendingRows, "Nothing outstanding."), tl == null, "") +
      wsBlock("Recent notes", "edit_note", wsList(noteRows, "None yet."), tl == null, "timeline") +
      wsBlock("Contacts", "person", people
        ? (people.hasEmergencyContact ? "<p>" + esc((people.people || []).filter(function (x) { return x.active; }).length) + " recorded.</p>"
          : '<p class="w-hint warn">' + ms("warning") + "Nobody can be telephoned about this patient.</p>")
        : "", !people, "people") +
      "</div>" +
      '<div class="w-ws-do">' +
      '<button class="w-btn" data-w-act="consultation">' + ms("edit_note") + "Start a consultation</button>" +
      '<button class="w-btn ghost" data-w-act="timeline">' + ms("history") + "Full history</button>" +
      '<button class="w-btn ghost" data-w-act="open:' + esc(s.encounterId || "") + '">' + ms("fact_check") + "Full chart</button>" +
      "</div></div>";
  }

  /* THE SAFETY INBOX — what needs a person, across the ward, ordered by urgency.
   *
   * An action queue, not a dashboard. Every row names the patient, says what is wrong and how long
   * it has been wrong, and goes straight to where it is dealt with. A screen that displays safety
   * items without offering the action is a screen people learn to scroll past.
   *
   * THE LOUDEST THING HERE IS A LIST THAT MIGHT BE INCOMPLETE. A safety inbox that quietly dropped
   * the patients it could not read, or stopped at a cap, would be worse than not having one: it
   * reads as a quiet ward. So the warning sits ABOVE the list, in those words, and the patients
   * that could not be checked are named. */
  var INBOX_ROLES = [
    ["", "Everything"], ["doctor", "Doctors"], ["nurse", "Nursing"],
    ["pharmacy", "Pharmacy"], ["lab", "Laboratory"],
  ];
  var INBOX_LEVEL = { escalate: "needs somebody now", overdue: "overdue", due: "due" };
  function inboxRow(it) {
    var lvl = (it.escalation && it.escalation.level) || "due";
    var p = it.patient || {};
    var act = it.type === "critical-result" && it.sourceRef && it.sourceRef.loopId
      ? '<button class="w-btn ghost sm" data-w-act="ackboard:' + esc(it.sourceRef.loopId) + '">' + ms("check") + "Acknowledge</button>"
      : "";
    return '<li class="w-mini-row w-ib-' + esc(lvl) + '"><div>' +
      '<span class="w-st ' + (lvl === "escalate" ? "escalate" : "due") + '">' + esc(INBOX_LEVEL[lvl] || lvl) + "</span> " +
      "<b>" + esc(p.name || p.patientId || "Patient") + "</b>" +
      (p.bed ? " &middot; bed " + esc(p.bed) : "") + (p.ward ? " &middot; " + esc(p.ward) : "") +
      "<div>" + esc(it.detail || it.type) + "</div>" +
      '<div class="w-dt-times">' + esc(it.type) +
      (it.since ? " &middot; since " + when(it.since) : "") +
      (it.escalation && it.escalation.hoursOpen != null ? " &middot; " + esc(it.escalation.hoursOpen) + "h" : "") +
      "</div></div>" +
      '<div class="w-mini-row-act">' + act +
      '<button class="w-btn ghost sm" data-w-act="inboxopen:' + esc(p.patientId || "") + '">' + ms("fact_check") + "Open patient</button>" +
      "</div></li>";
  }
  function safetyInboxView(state) {
    var d = state.inbox;
    var rows = d && d.items ? d.items.map(inboxRow).join("") : "";
    var cur = state.inboxRole || "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Safety inbox</h3>" +
      '<button class="w-ic" data-w-act="safetyinbox" title="Refresh">' + ms("refresh") + "</button></div>" +
      /* The incompleteness warning comes FIRST and is not a footnote. */
      (d && d.warning ? '<p class="w-hint warn">' + ms("warning") + esc(d.warning) + "</p>" : "") +
      (d && d.failed && d.failed.length
        ? '<p class="w-hint warn">' + ms("warning") + "Could not check: " +
          esc(d.failed.map(function (f) { return (f.name || f.patientId) + " (" + f.what + ")"; }).join(", ")) + "</p>"
        : "") +
      (d && d.note ? '<p class="w-hint">' + ms("info") + esc(d.note) + "</p>" : "") +
      '<div class="w-tl-filters">' + INBOX_ROLES.map(function (r) {
        return '<button class="w-tl-f' + (cur === r[0] ? " on" : "") + '" data-w-act="inboxrole:' + esc(r[0] || "all") + '">' + esc(r[1]) + "</button>";
      }).join("") + "</div>" +
      (d
        ? '<p class="w-hint">' + ms("info") +
          esc(d.items.length) + " for this role &middot; " + esc(d.escalated) + " need somebody now &middot; " +
          esc(d.totalOnWard) + " outstanding on the ward &middot; " + esc(d.scanned) + " patients checked</p>"
        : "") +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        /* "Nothing outstanding" is only ever said when the list is actually complete. */
        : (d.warning || (d.failed && d.failed.length))
          ? '<p class="w-hint warn">' + ms("warning") + "Nothing found in what could be checked - but the check was incomplete.</p>"
          : '<p class="w-empty">Nothing outstanding for this role.</p>') +
      "</div>";
  }

  /* SHIFT HANDOVER. The module behind this has existed, complete and tested, with nothing calling
   * it - which meant a ward running WardSynQ had signed notes and no way for one nurse to hand a
   * patient to another. Handover failure is one of the best-documented causes of harm in hospitals:
   * the information existed, somebody knew it, and it did not survive the change of shift.
   *
   * THE SCREEN IS THE INCOMING SHIFT'S LIST. What is WAITING is the default and the point; received
   * handovers are available but are not what somebody opens this for. Oldest first, because the one
   * that has been waiting longest is the one most likely to be lost.
   *
   * NOTHING HERE CLOSES A LOOP BY ITSELF. The server refuses a handover received by the person who
   * gave it, and this screen does not pretend otherwise - it shows the refusal as it comes back. */
  var SBAR_FIELDS = [
    ["situation", "Situation", "What is happening with this patient right now"],
    ["background", "Background", "What brought them here and what matters from before"],
    ["assessment", "Assessment", "What you think is going on"],
    ["recommendation", "Recommendation", "What the next shift should do"],
  ];
  function handoverRow(h, state) {
    var waiting = h.state === "waiting";
    var name = "";
    (state.list || []).forEach(function (p) { if (p.patientId === h.patientId) name = p.name || ""; });
    var sec = SBAR_FIELDS.map(function (f) {
      var text = (h.sections || {})[f[0]];
      return text ? '<div class="w-tl-b"><b>' + esc(f[1]) + "</b> " + esc(text) + "</div>" : "";
    }).join("");
    return '<li class="w-mini-row' + (waiting ? " w-ib-overdue" : "") + '"><div>' +
      '<span class="w-st ' + (waiting ? "due" : "") + '">' + (waiting ? "waiting to be taken" : "taken") + "</span> " +
      "<b>" + esc(name || h.patientId) + "</b>" +
      '<div class="w-dt-times">given by ' + esc(h.givenBy || "") + " &middot; " + when(h.givenAt) +
      (h.receivedBy ? " &middot; taken by " + esc(h.receivedBy) + " " + when(h.receivedAt) : "") + "</div>" +
      sec +
      /* Said plainly rather than left as a blank section: a handover that silently assembled its
       * own background from the chart would be a handover nobody actually gave. */
      (h.sbarStated != null && h.sbarStated < 4 ? '<div class="w-dt-times">' + esc(4 - h.sbarStated) + " of the four parts were left blank.</div>" : "") +
      "</div><div class=\"w-mini-row-act\">" +
      (waiting ? '<button class="w-btn ghost sm" data-w-act="handovertake:' + esc(h.handoverId) + '">' + ms("check") + "Take this patient</button>" : "") +
      "</div></li>";
  }
  function handoverView(state) {
    var d = state.handovers;
    var showing = state.handoverState || "waiting";
    var rows = d && d.handovers ? d.handovers.map(function (h) { return handoverRow(h, state); }).join("") : "";
    var s = state.sel;
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Shift handover</h3>" +
      '<button class="w-ic" data-w-act="handovers" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-tl-filters">' +
      '<button class="w-tl-f' + (showing === "waiting" ? " on" : "") + '" data-w-act="handovershow:waiting">Waiting to be taken' +
        (d && d.waiting ? " <i>" + esc(d.waiting) + "</i>" : "") + "</button>" +
      '<button class="w-tl-f' + (showing === "all" ? " on" : "") + '" data-w-act="handovershow:all">All</button>' +
      "</div>" +
      (s
        ? '<div class="w-sub"><h4>Hand over ' + esc(s.name || s.patientId) + "</h4>" +
          SBAR_FIELDS.map(function (f) {
            return '<label class="w-f"><span>' + esc(f[1]) + "</span>" +
              '<textarea id="wHo_' + esc(f[0]) + '" rows="2" placeholder="' + esc(f[2]) + '"></textarea></label>';
          }).join("") +
          '<p class="w-hint">' + ms("info") + "A part you leave blank is recorded as not stated. Nothing is filled in from the chart on your behalf." +
          "</p><button class=\"w-btn\" data-w-act=\"handovergive\">" + ms("send") + "Hand over</button></div>"
        : '<p class="w-hint">' + ms("info") + "Open a patient from the ward list to hand them over.</p>") +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">' + (showing === "waiting" ? "Nothing waiting to be taken." : "No handovers recorded.") + "</p>") +
      "</div>";
  }

  /* MEDICINES RECONCILIATION. Another complete module with nothing calling it - which meant a ward
   * had no way to record what a patient was already taking when they arrived, or to decide what
   * happens to each of those medicines. That gap is one of the commonest sources of avoidable harm
   * on admission and discharge.
   *
   * TAKING the history and DECIDING what happens to each medicine are separate acts on purpose, and
   * the server gates them separately: a nurse or pharmacist sits with the patient and writes down
   * what they take; deciding the fate of each medicine is prescribing-adjacent and needs emr.treat.
   * This screen shows both and lets the server refuse what it refuses.
   *
   * COMPLETE MEANS EVERY MEDICINE HAS A DECISION, computed by the module, never a button somebody
   * presses. So the screen reports the count of undecided medicines rather than a tick. */
  var MEDREC_DECISIONS = [
    ["continued", "Continue"], ["stopped", "Stop"], ["changed", "Changed"], ["held", "Hold"],
  ];
  var MEDREC_STAGES = [["admission", "On admission"], ["discharge", "At discharge"]];
  function medRecRow(m, stage) {
    var decided = m.decision && m.decision !== "undecided";
    return '<li class="w-mini-row' + (decided ? "" : " w-ib-overdue") + '"><div>' +
      "<b>" + esc(m.drug || m.key) + "</b>" +
      (m.dose ? " &middot; " + esc(m.dose) : "") +
      ' <span class="w-st ' + (decided ? "" : "due") + '">' + esc(decided ? m.decision : "not decided") + "</span>" +
      (m.reason ? '<div class="w-dt-times">' + esc(m.reason) + "</div>" : "") +
      "</div><div class=\"w-mini-row-act\">" +
      (decided ? "" : MEDREC_DECISIONS.map(function (d) {
        return '<button class="w-btn ghost sm" data-w-act="medrecdecide:' + esc(stage) + "~" + esc(m.key) + "~" + esc(d[0]) + '">' + esc(d[1]) + "</button>";
      }).join("")) +
      "</div></li>";
  }
  function medRecView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.medRec;
    var blocks = d && d.reconciliations ? d.reconciliations.map(function (r) {
      var rows = (r.medicines || []).map(function (m) { return medRecRow(m, r.stage); }).join("");
      return '<div class="w-sub"><h4>' + esc(r.stage === "discharge" ? "At discharge" : "On admission") +
        (r.source ? " &middot; from " + esc(r.source) : "") + "</h4>" +
        /* Never a tick: the module computes completeness from the medicines themselves. */
        (r.empty ? '<p class="w-empty">No medicines recorded.</p>'
          : r.undecided
            ? '<p class="w-hint warn">' + ms("warning") + esc(r.undecided) + " medicine" + (r.undecided === 1 ? "" : "s") + " still undecided.</p>"
            : '<p class="w-hint">' + ms("check") + "Every medicine has a decision.</p>") +
        (rows ? '<ul class="w-mini">' + rows + "</ul>" : "") + "</div>";
    }).join("") : "";

    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Medicines on arrival</h3>" +
      '<button class="w-ic" data-w-act="medrec" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-sub"><h4>Record what this patient was taking</h4>' +
      '<select id="wMrStage">' + MEDREC_STAGES.map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wMrSource" placeholder="Who told you - the patient, a carer, their own list, the pharmacy">' +
      '<textarea id="wMrMeds" rows="4" placeholder="One medicine a line, as they said it. For example:&#10;Metformin 500mg twice a day&#10;Amlodipine 5mg in the morning"></textarea>' +
      '<p class="w-hint">' + ms("info") + "Write them down as the patient says them. Nothing here corrects a name or a dose, and nothing is filled in from the chart." +
      "</p><button class=\"w-btn\" data-w-act=\"medrecstart\">" + ms("save") + "Record the history</button></div>" +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : blocks ? blocks
        : '<p class="w-empty">No medicines history recorded for this stay.</p>') +
      "</div>";
  }

  /* WOUND CARE. Another finished module nothing called. Pressure ulcers acquired in hospital are a
   * reportable harm and a legal exposure, and a ward with no way to chart one has no way to show
   * that it did not cause it either.
   *
   * TWO PROPERTIES THE MODULE GUARANTEES AND THIS SCREEN MUST NOT UNDO:
   *   - a wound's WORST stage is carried forward and never lowered by a later, better reading
   *   - where it came from is fixed at the first assessment and cannot be edited afterwards
   * Both are shown, because a screen that displayed only the latest stage would let a wound that
   * reached stage 4 read as stage 2 today, which is exactly the number a hospital is accountable
   * for getting right. */
  var WOUND_KINDS = [["pressure", "Pressure"], ["surgical", "Surgical"], ["traumatic", "Traumatic"],
    ["diabetic-foot", "Diabetic foot"], ["venous", "Venous"], ["other", "Other"]];
  var WOUND_STAGES = [["", "Not staged"], ["1", "Stage 1"], ["2", "Stage 2"], ["3", "Stage 3"],
    ["4", "Stage 4"], ["unstageable", "Unstageable"], ["deep-tissue", "Deep tissue injury"]];
  var WOUND_ORIGINS = [["present-on-admission", "Already there when they arrived"],
    ["acquired-here", "Developed here"], ["unknown", "Not known"]];
  function woundRow(w) {
    var c = w.comparison || {};
    return '<li class="w-mini-row' + (w.origin === "acquired-here" ? " w-ib-overdue" : "") + '"><div>' +
      "<b>" + esc(w.site) + "</b> &middot; " + esc(w.kind) +
      ' <span class="w-st">' + esc(w.stage ? "stage " + w.stage : "not staged") + "</span>" +
      /* Never hidden behind the current reading. */
      (w.worstStage && w.worstStage !== w.stage
        ? ' <span class="w-st escalate">worst it has been: stage ' + esc(w.worstStage) + "</span>"
        : "") +
      (w.origin === "acquired-here" ? ' <span class="w-st escalate">developed here</span>' : "") +
      '<div class="w-dt-times">' + esc(w.assessments) + " assessment" + (w.assessments === 1 ? "" : "s") +
      " &middot; first " + when(w.firstAssessedAt) + " &middot; last " + when(w.lastAssessedAt) + "</div>" +
      (c.verdict ? "<div>" + esc(c.verdict) + "</div>" : "") +
      "</div></li>";
  }
  function woundView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.wounds;
    var rows = d && d.wounds ? d.wounds.map(woundRow).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Wounds</h3><button class=\"w-ic\" data-w-act=\"wounds\" title=\"Refresh\">" + ms("refresh") + "</button></div>" +
      (d && d.acquiredHere
        ? '<p class="w-hint warn">' + ms("warning") + esc(d.acquiredHere) + " wound" + (d.acquiredHere === 1 ? "" : "s") + " developed here.</p>"
        : "") +
      '<div class="w-sub"><h4>Chart a wound</h4>' +
      '<input id="wWdSite" placeholder="Where on the body">' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Kind</span><select id="wWdKind">' + WOUND_KINDS.map(function (k) { return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Stage</span><select id="wWdStage">' + WOUND_STAGES.map(function (k) { return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Where it came from</span><select id="wWdOrigin">' + WOUND_ORIGINS.map(function (k) { return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Length cm</span><input id="wWdL" inputmode="decimal"></label>' +
      '<label class="w-f"><span>Width cm</span><input id="wWdW" inputmode="decimal"></label>' +
      '<label class="w-f"><span>Depth cm</span><input id="wWdD" inputmode="decimal"></label>' +
      "</div>" +
      '<input id="wWdDressing" placeholder="Dressing used (optional)">' +
      '<textarea id="wWdNote" rows="2" placeholder="Anything else worth recording"></textarea>' +
      '<p class="w-hint">' + ms("info") + "Where a wound came from is set the first time it is charted and cannot be changed afterwards. A worse stage is never lowered by a later reading." +
      "</p><button class=\"w-btn\" data-w-act=\"woundchart\">" + ms("save") + "Record</button></div>" +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">No wounds charted.</p>') +
      "</div>";
  }

  /* RISK ASSESSMENT. The tools are the HOSPITAL's - falls, pressure, VTE, whatever it configured -
   * and this screen renders whatever it was given rather than knowing any of them. A hospital that
   * has configured none gets told that, instead of an empty page that reads as "no risks". */
  function riskRow(a) {
    var due = a.reassessment && a.reassessment.due;
    var actions = (a.actions || []).filter(function (x) { return !x.completedAt; });
    return '<li class="w-mini-row' + (due ? " w-ib-overdue" : "") + '"><div>' +
      "<b>" + esc(a.toolName || a.toolId) + "</b>" +
      (a.score != null ? " &middot; score " + esc(a.score) : "") +
      (a.band ? ' <span class="w-st ' + (a.band === "high" ? "escalate" : "due") + '">' + esc(a.band) + "</span>" : "") +
      (due ? ' <span class="w-st escalate">reassessment overdue</span>' : "") +
      '<div class="w-dt-times">assessed ' + when(a.assessedAt) + (a.assessedBy ? " by " + esc(a.assessedBy) : "") + "</div>" +
      (actions.length
        ? '<ul class="w-mini">' + actions.map(function (x) {
            return "<li>" + esc(x.action || x.key) +
              ' <button class="w-btn ghost sm" data-w-act="riskdone:' + esc(a.assessmentId) + "~" + esc(x.action || x.key) + '">' + ms("check") + "Done</button></li>";
          }).join("") + "</ul>"
        : "") +
      "</div></li>";
  }
  function riskView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.risks, tools = state.riskTools;
    var rows = d && d.assessments ? d.assessments.map(riskRow).join("") : "";
    var toolList = tools && tools.tools ? tools.tools : [];
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Risk assessments</h3><button class=\"w-ic\" data-w-act=\"risks\" title=\"Refresh\">" + ms("refresh") + "</button></div>" +
      (tools && !toolList.length
        ? '<p class="w-hint">' + ms("info") + "This hospital has configured no risk tools, so none can be carried out here."
          + " That is a setting, not an assessment that everything is fine.</p>"
        : "") +
      (toolList.length
        ? '<div class="w-sub"><h4>Carry one out</h4>' +
          '<select id="wRkTool">' + toolList.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + "</option>"; }).join("") + "</select>" +
          '<p class="w-hint">' + ms("info") + "The questions belong to the tool the hospital configured. Nothing here scores anything itself." +
          "</p><button class=\"w-btn\" data-w-act=\"riskopen\">" + ms("fact_check") + "Open the tool</button></div>"
        : "") +
      (state.riskForm ? riskFormBlock(state) : "") +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">No assessments recorded.</p>') +
      "</div>";
  }
  function riskFormBlock(state) {
    var f = state.riskForm;
    var qs = (f.questions || []).map(function (q) {
      var opts = (q.options || []).map(function (o) {
        return '<option value="' + esc(o.value != null ? o.value : o.key) + '">' + esc(o.label || o.key) + "</option>";
      }).join("");
      return '<label class="w-f"><span>' + esc(q.text || q.key) + "</span>" +
        (opts ? '<select id="wRq_' + esc(q.key) + '"><option value="">Not answered</option>' + opts + "</select>"
              : '<input id="wRq_' + esc(q.key) + '" inputmode="decimal">') + "</label>";
    }).join("");
    return '<div class="w-sub"><h4>' + esc(f.name || f.id) + "</h4>" + qs +
      '<p class="w-hint">' + ms("info") + "A question left unanswered is recorded as unanswered. The score the server returns says whether it is complete." +
      "</p><button class=\"w-btn\" data-w-act=\"risksave\">" + ms("save") + "Record the assessment</button>" +
      '<button class="w-btn ghost" data-w-act="riskcancel">Cancel</button></div>';
  }

  /* BREAK-GLASS. Emergency access to one patient's chart, on the record. The module behind this
   * was complete and unreachable, which meant the only emergency route into a chart a clinician did
   * not hold access to was a borrowed login - the one outcome break-glass exists to prevent, because
   * a borrowed login leaves no name.
   *
   * THIS SCREEN DOES NOT SOFTEN IT. The declaration asks for a reason in the clinician's own words
   * (not a menu - a menu becomes "other" within a month), states that access is read-only, for this
   * patient only, and expires on its own, and says plainly that it is reviewed. The review log shows
   * every declaration, who made it, why, how many times the chart was read under it, and whether
   * anybody was told. */
  function breakGlassRow(g) {
    return '<li class="w-mini-row' + (g.active ? " w-ib-escalate" : "") + '"><div>' +
      '<span class="w-st ' + (g.active ? "escalate" : "") + '">' + (g.active ? "active" : g.revokedAt ? "withdrawn" : "expired") + "</span> " +
      "<b>" + esc(g.actorId) + "</b>" + (g.role ? " &middot; " + esc(g.role) : "") +
      "<div>" + esc(g.reason) + "</div>" +
      '<div class="w-dt-times">patient ' + esc(g.patientId) + " &middot; declared " + when(g.grantedAt) +
      " &middot; " + (g.active ? "expires " : "ended ") + when(g.revokedAt || g.expiresAt) +
      " &middot; chart read " + esc(g.reads || 0) + " time" + (g.reads === 1 ? "" : "s") + "</div>" +
      /* Whether anybody was told, on the review surface itself - "declared and paged" and "declared
       * and told nobody" must be distinguishable without cross-referencing anything. */
      /* Breaking glass granted access that could not be used: nothing opened the chart the grant was
       * for. An active grant now opens it - read only, only what the emergency scope allows, and every
       * read counted on the grant itself. */
      (g.active ? '<button class="w-btn ghost sm" data-w-act="emergencychart:' + esc(g.patientId) + '">' + ms("fact_check") + "Open the chart (read only)</button>" : "") +
      '<div class="w-dt-times">' + (g.notification && g.notification.sent
        ? "notified: " + esc(g.notification.to || "yes")
        : "nobody was notified automatically") + "</div>" +
      "</div></li>";
  }
  function breakGlassView(state) {
    var d = state.breakGlass;
    var s = state.sel;
    var rows = d && d.grants ? d.grants.map(breakGlassRow).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Emergency access</h3>" +
      '<button class="w-ic" data-w-act="breakglass" title="Refresh">' + ms("refresh") + "</button></div>" +
      (s
        ? '<div class="w-sub w-dead"><h4>' + ms("warning") + "Break glass for " + esc(s.name || s.patientId) + "</h4>" +
          "<p>Use this only when a patient needs care now and you do not hold access to their chart.</p>" +
          '<ul class="w-mini"><li>Read only. It gives you no ability to write anything.</li>' +
          "<li>This patient only.</li>" +
          "<li>It ends on its own and cannot be extended - a second emergency is a second declaration.</li>" +
          "<li>Your name, your reason and every time you open the chart are recorded and reviewed.</li></ul>" +
          '<textarea id="wBgReason" rows="3" placeholder="In your own words: what is the emergency, and why you need this chart now"></textarea>' +
          '<button class="w-btn" data-w-act="breakglassdeclare">' + ms("warning") + "Break glass</button></div>"
        : '<p class="w-hint">' + ms("info") + "Open a patient from the ward list to request emergency access to their chart.</p>") +
      (state.emergencyChart
        ? '<div class="w-sub w-dead"><h4>' + ms("warning") + "Emergency read-only chart</h4>" +
          (state.emergencyChart.ok ? reportValue(state.emergencyChart.chart) : '<p class="w-hint warn">' + esc(state.emergencyChart.detail || state.emergencyChart.error || "Could not open the chart.") + "</p>") +
          "</div>"
        : "") +
      '<div class="w-sub"><h4>Review log</h4>' +
      (d && d.active ? '<p class="w-hint warn">' + ms("warning") + esc(d.active) + " emergency access grant" + (d.active === 1 ? " is" : "s are") + " active now.</p>" : "") +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">No emergency access has been declared.</p>') +
      "</div></div>";
  }

  /* ORDER SETS. A hospital-approved bundle - "community-acquired pneumonia, admission" - so the
   * admitting doctor at three in the morning does not forget the second blood culture. Also one of
   * the easiest ways to hurt somebody, because a set applies many decisions very fast.
   *
   * THE RULE THIS SCREEN EXISTS TO KEEP: A SET WRITES NO ORDERS. Applying it sends EACH chosen item
   * through the same door a hand-written order goes through, one at a time, so every item gets the
   * allergy check, the interaction check, the dose ceiling and the formulary. A set that ordered in
   * bulk would be a hole through every one of those, and invisible, because the orders would look
   * ordinary.
   *
   * NOTHING IS ORDERED THAT THE DOCTOR DID NOT SEE. Every item is listed with its default choice
   * shown, and only ticked items are sent. When some items are refused - an allergy, a restricted
   * drug - the others are NOT rolled back and the refused ones are NOT retried: the screen says
   * exactly which landed and which did not, and records that, because a doctor who believes a set
   * went through whole is a doctor who does not go back for the antibiotic that was blocked. */
  function orderSetsView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.orderSets;
    var pick = state.orderSetPick;
    var sets = d && d.sets ? d.sets : [];
    var res = state.orderSetResult;
    var chooser = sets.length
      ? '<select id="wOsSet">' + sets.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (pick && pick.id === x.id ? " selected" : "") + ">" + esc(x.name) + " (v" + esc(x.version) + ")</option>";
        }).join("") + '</select><button class="w-btn ghost sm" data-w-act="ordersetpick">' + ms("fact_check") + "Show what is in it</button>"
      : "";
    var items = pick ? (pick.items || []).map(function (it, i) {
      var on = it.defaultSelected !== false;
      var what = it.kind === "medication"
        ? esc(it.drug) + (it.dose ? " " + esc(it.dose.value) + esc(it.dose.unit || "") : "") + (it.route ? " " + esc(it.route) : "") + (it.frequency ? " " + esc(it.frequency) : "")
        : esc(it.display || it.code);
      return '<label class="w-f" style="flex-direction:row;align-items:center">' +
        '<input id="wOsItem_' + esc(it.key) + '" type="checkbox" style="width:auto;margin:0 8px 0 0"' + (on ? " checked" : "") + ">" +
        "<span>" + (it.kind === "medication" ? "Medicine: " : "Test: ") + what + "</span></label>";
    }).join("") : "";
    var result = "";
    if (res) {
      result = '<div class="w-sub' + (res.failed && res.failed.length ? " w-dead" : "") + '"><h4>' +
        (res.failed && res.failed.length ? "Part of this set was NOT ordered" : "Every chosen item was ordered") + "</h4>" +
        (res.applied && res.applied.length ? "<p><b>Ordered:</b> " + esc(res.applied.join(", ")) + "</p>" : "") +
        (res.failed && res.failed.length
          ? '<ul class="w-mini">' + res.failed.map(function (f) { return "<li><b>" + esc(f.key) + "</b> - " + esc(f.detail || f.error) + "</li>"; }).join("") + "</ul>" +
            '<p class="w-hint warn">' + ms("warning") + "These were refused by the ordinary safety checks and have not been ordered. Nothing was retried.</p>"
          : "") +
        (res.deselected && res.deselected.length ? '<p class="w-dt-times">Left out by you: ' + esc(res.deselected.join(", ")) + "</p>" : "") +
        "</div>";
    }
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Order sets</h3></div>" +
      (d && !sets.length ? '<p class="w-hint">' + ms("info") + "This hospital has not set up any order sets.</p>" : "") +
      (d == null ? '<p class="w-empty">Loading.</p>' : chooser) +
      (pick
        ? '<div class="w-sub"><h4>' + esc(pick.name) + "</h4>" +
          (pick.description ? "<p>" + esc(pick.description) + "</p>" : "") +
          '<p class="w-hint">' + ms("info") + "Untick anything this patient should not have. Each ticked item is then ordered on its own, with the same checks as any order you write by hand." + "</p>" +
          items +
          '<button class="w-btn" data-w-act="ordersetapply">' + ms("send") + "Order the ticked items</button></div>"
        : "") +
      result + "</div>";
  }

  /* CLINICAL PATHWAYS (P2.12). Bedside pathway progress and enrolments.
   * Progress is read directly from the clinical record: steps are evaluated against actual orders,
   * observations, and forms. Overriding a step requires a mandatory clinical reason. */
  var PW_STEP_STATUS = { met: "Met", missed: "Missed", "not-evaluated": "Not evaluated", pending: "Pending", overridden: "Overridden" };
  function pathwaysView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.pathwaysData;
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Clinical pathways - " + esc(s.name || s.patientId) + "</h3>" +
      '<button class="w-ic" data-w-act="pathways" title="Refresh">' + ms("refresh") + "</button></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Loading clinical pathways...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load clinical pathways. Do not read this as no pathways.</p></div>";

    var enrolments = (d.progress && d.progress.enrolments) || [];
    var available = (d.available && d.available.pathways) || [];
    var enrolList = enrolments.length ? enrolments.map(function (en) {
      var pw = en.pathway || {};
      var steps = (en.steps || []).map(function (st) {
        var isDone = st.status === "met" || st.status === "overridden";
        var isAlert = st.status === "missed";
        var badgeCls = isDone ? "done" : isAlert ? "overdue" : "due";
        var ovr = st.override;
        var act = (!isDone) ? '<button class="w-btn ghost sm" data-w-act="pwoverride:' + esc(en.id) + "~" + esc(st.key) + '">Override step</button>' : "";
        return '<li class="w-mini-row"><div><span class="w-st ' + badgeCls + '">' + esc(PW_STEP_STATUS[st.status] || st.status) + "</span> " +
          "<b>" + esc(st.title || st.key) + "</b> (" + esc(st.kind) + ")" +
          (st.withinMinutes ? ' <span class="w-dt-times">&middot; target within ' + esc(st.withinMinutes) + "m</span>" : "") +
          (ovr ? '<div class="w-dt-times"><b>Override reason:</b> ' + esc(ovr.reason) + (ovr.by ? " (by " + esc(ovr.by) + ")" : "") + "</div>" : "") +
          '</div><div class="w-mini-row-act">' + act + "</div></li>";
      }).join("");
      return '<div class="w-sub"><h4>' + esc(pw.title || en.id) + " (v" + esc(pw.version || 1) + ")</h4>" +
        '<p class="w-dt-times">Enrolled ' + when(en.enrolledAt) + (en.enrolledBy ? " by " + esc(en.enrolledBy) : "") + (pw.owner ? " &middot; Owner: " + esc(pw.owner) : "") + "</p>" +
        '<ul class="w-mini">' + steps + "</ul></div>";
    }).join("") : '<p class="w-empty">No active clinical pathways for this patient.</p>';

    var availList = available.length ? '<div class="w-sub"><h4>Available pathways to enrol</h4><ul class="w-mini">' +
      available.map(function (p) {
        return '<li class="w-mini-row"><div><b>' + esc(p.title) + "</b> (v" + esc(p.version) + ")" +
          (p.owner ? '<div class="w-dt-times">Owner: ' + esc(p.owner) + (p.reviewDate ? " &middot; Review: " + esc(p.reviewDate) : "") + "</div>" : "") +
          '</div><div class="w-mini-row-act"><button class="w-btn sm" data-w-act="pwenrol:' + esc(p.key) + "~" + esc(p.version) + '">' + ms("add") + "Enrol</button></div></li>";
      }).join("") + "</ul></div>" : '<p class="w-hint">No hospital pathways are currently published.</p>';

    return '<div class="w-card">' + head +
      '<div class="w-sub"><h4>Active pathway progress</h4>' + enrolList + "</div>" +
      availList + "</div>";
  }

  /* SPECIALTY FRAMEWORK (P2.11). Hospital specialty profile for the admission class/specialty. */
  function specialtyView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.specialtyData;
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Specialty framework - " + esc(s.name || s.patientId) + "</h3>" +
      '<button class="w-ic" data-w-act="specialty" title="Refresh">' + ms("refresh") + "</button></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Loading specialty profile...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load specialty profile.</p></div>";
    if (!d.configured || !d.specialty) return '<div class="w-card">' + head + '<p class="w-empty">No specialty profile configured for admission class "' + esc(s.class || "General") + '".</p></div>';

    var sp = d.specialty;
    var sets = (sp.orderSets || []).map(function (x) { return '<button class="w-btn ghost sm" data-w-act="ordersets">' + esc(x.name || x.id) + "</button>"; }).join(" ");
    var tpls = (sp.templates || []).map(function (x) { return '<span class="w-chip">' + esc(x.title || x.id) + "</span>"; }).join(" ");
    var calcs = (sp.calculators || []).map(function (x) { return '<button class="w-btn ghost sm" data-w-act="risks">' + esc(x.name || x.id) + "</button>"; }).join(" ");
    var pws = (sp.pathways || []).map(function (x) { return '<button class="w-btn ghost sm" data-w-act="pathways">' + esc(x.title || x.key) + "</button>"; }).join(" ");

    return '<div class="w-card">' + head +
      '<div class="w-sub"><h4>' + esc(sp.name || sp.key) + "</h4>" +
      (sp.description ? "<p>" + esc(sp.description) + "</p>" : "") +
      '<div style="margin-top:12px"><b>Order sets:</b> ' + (sets || '<span class="w-dt-times">None</span>') + "</div>" +
      '<div style="margin-top:8px"><b>Note templates:</b> ' + (tpls || '<span class="w-dt-times">None</span>') + "</div>" +
      '<div style="margin-top:8px"><b>Calculators / risk tools:</b> ' + (calcs || '<span class="w-dt-times">None</span>') + "</div>" +
      '<div style="margin-top:8px"><b>Pathways:</b> ' + (pws || '<span class="w-dt-times">None</span>') + "</div>" +
      "</div></div>";
  }

  /* THE BED WAITING LIST. admission-request.js was complete and unreachable, so a doctor who decided
   * a patient needed a bed had nowhere to say so except out loud - and a request made out loud is
   * the one that is forgotten when the shift changes.
   *
   * THE LIST IS RANKED BY THE MODULE, NOT HERE: urgency first, then how long they have waited. How
   * long is shown in hours on every row, because "waiting" says nothing about whether it has been
   * twenty minutes or two days.
   *
   * A REQUEST IS CLOSED DELIBERATELY, NEVER AGED OUT. Admitted or cancelled, with a reason for a
   * cancellation, because a patient who quietly drops off a bed list is a patient nobody admitted. */
  var ADM_URGENCY = [["emergency", "Emergency"], ["urgent", "Urgent"], ["soon", "Soon"], ["elective", "Elective"]];
  function admReqRow(r) {
    var hot = r.urgency === "emergency" || r.urgency === "urgent";
    return '<li class="w-mini-row' + (r.state === "waiting" && hot ? " w-ib-escalate" : r.state === "waiting" ? " w-ib-overdue" : "") + '"><div>' +
      '<span class="w-st ' + (hot ? "escalate" : "due") + '">' + esc(r.urgency) + "</span> " +
      "<b>" + esc(r.mrn || r.patientId) + "</b>" + (r.specialty ? " &middot; " + esc(r.specialty) : "") + (r.ward ? " &middot; for " + esc(r.ward) : "") +
      "<div>" + esc(r.reason || "") + "</div>" +
      '<div class="w-dt-times">asked by ' + esc(r.requestedBy) + " &middot; " + when(r.requestedAt) +
      (r.state === "waiting" ? " &middot; waiting " + esc(r.waitingHours) + "h" : " &middot; " + esc(r.state) + (r.closeReason ? ": " + esc(r.closeReason) : "")) +
      "</div></div>" +
      '<div class="w-mini-row-act">' +
      (r.state === "waiting"
        ? '<button class="w-btn ghost sm" data-w-act="admreqclose:' + esc(r.requestId) + '~admitted">' + ms("bed") + "Admitted</button>" +
          '<button class="w-btn ghost sm" data-w-act="admreqclose:' + esc(r.requestId) + '~cancelled">' + ms("close") + "Cancel</button>"
        : "") +
      "</div></li>";
  }
  function admReqView(state) {
    var d = state.admReqs;
    var rows = d && d.requests ? d.requests.map(admReqRow).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Waiting for a bed</h3>" +
      '<button class="w-ic" data-w-act="admreqs" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-sub"><h4>Ask for a bed</h4>' +
      '<input id="wArMrn" placeholder="Patient MRN">' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>How soon</span><select id="wArUrg">' + ADM_URGENCY.map(function (u) { return '<option value="' + esc(u[0]) + '">' + esc(u[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Specialty</span><input id="wArSpec"></label>' +
      '<label class="w-f"><span>Ward (optional)</span><input id="wArWard"></label>' +
      "</div>" +
      '<textarea id="wArReason" rows="2" placeholder="Why this patient needs to come in"></textarea>' +
      '<button class="w-btn" data-w-act="admreqask">' + ms("send") + "Ask for a bed</button></div>" +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">Nobody is waiting for a bed.</p>') +
      "</div>";
  }

  /* INFUSIONS AND THE CARE PLAN. Both modules were complete and unreachable.
   *
   * THE VOLUME IS AN ESTIMATE AND THE SCREEN SAYS SO. infusion.js integrates the charted rates, which
   * assumes the pump ran at the last charted rate for every minute since. If it occluded at 02:00 and
   * nobody noticed until 06:00, the total is four hours too high - and the fluid balance, and then a
   * resuscitation decision, is built on it. So the module's own caveat is shown beside every total,
   * and a drip nobody has charted for hours is marked at the top and on its row.
   *
   * AN UNCHARTED INFUSION IS NOT A STOPPED ONE. A pump nobody charted is still shown as running, with
   * the stale warning, rather than quietly reading as finished. */
  var INFUSION_EVENTS = [["started", "Started"], ["rate-changed", "Rate changed"], ["paused", "Paused"], ["resumed", "Resumed"], ["stopped", "Stopped"]];
  function infusionRow(i) {
    var v = i.volume || {};
    return '<li class="w-mini-row' + (v.stale ? " w-ib-escalate" : i.running ? " w-ib-overdue" : "") + '"><div>' +
      '<span class="w-st ' + (i.running ? "due" : "") + '">' + (i.running ? "running" : "not running") + "</span> " +
      "<b>" + esc(i.drug || i.orderId) + "</b>" +
      (v.lastRatePerHour != null ? " &middot; " + esc(v.lastRatePerHour) + " mL/h" : "") +
      (v.ml != null ? " &middot; about " + esc(v.ml) + " mL so far" : "") +
      (v.stale ? '<div class="w-hint warn">' + ms("warning") + esc(v.staleDetail) + "</div>" : "") +
      (v.assumption ? '<div class="w-dt-times">' + esc(v.assumption) + "</div>" : "") +
      '<div class="w-dt-times">started ' + when(i.startedAt) + " &middot; last charted " + when(i.lastChartedAt) + "</div>" +
      "</div><div class=\"w-mini-row-act\">" +
      '<button class="w-btn ghost sm" data-w-act="infusionchart:' + esc(i.orderId) + '">' + ms("edit_note") + "Chart</button>" +
      "</div></li>";
  }
  function infusionView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.infusions;
    var rows = d && d.infusions ? d.infusions.map(infusionRow).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Drips and care plan</h3>" +
      '<button class="w-ic" data-w-act="infusions" title="Refresh">' + ms("refresh") + "</button></div>" +
      (d && d.stale ? '<p class="w-hint warn">' + ms("warning") + esc(d.stale) + " running infusion" + (d.stale === 1 ? " has" : "s have") + " not been charted for hours. Check the pumps.</p>" : "") +
      (d && d.note ? '<p class="w-hint">' + ms("info") + esc(d.note) + "</p>" : "") +
      '<div class="w-sub"><h4>Infusions</h4>' +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">No infusions charted.</p>') +
      "</div>" +
      /* The care plan: what the team is trying to achieve and when it will be looked at again. A goal
       * with no review date is a goal nobody comes back to, so the date is asked for with it. */
      '<div class="w-sub"><h4>Care plan</h4>' + carePlanForm() +
      '<button class="w-btn ghost" data-w-act="careplan">' + ms("flag") + "Open the care plan and its progress</button></div>" +
      "</div>";
  }
  function carePlanForm() {
    return '<input id="wCpTitle" placeholder="What this plan is for">' +
      '<textarea id="wCpGoals" rows="3" placeholder="One goal a line: the goal | how you will know it was met"></textarea>' +
      '<label class="w-f"><span>Review by</span><input id="wCpReview" type="date"></label>' +
      '<p class="w-hint">' + ms("info") + "A goal with no review date is a goal nobody comes back to. Goals already on the plan are kept." +
      "</p><button class=\"w-btn\" data-w-act=\"careplansave\">" + ms("save") + "Save the care plan</button>";
  }

  /* THE CARE PLAN, READ BACK. A plan could be saved and never seen again, so nobody could tell whether
   * a goal had been met. Loading, failed and "no plan written" are three different sentences: the last
   * is the one a ward has to act on, and a failed read must never look like it. */
  var GOAL_WORDS = { active: "In progress", met: "Met", "not-met": "Not met", cancelled: "Cancelled" };
  function carePlanView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.carePlan;
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Care plan</h3>" +
      '<button class="w-ic" data-w-act="careplan" title="Refresh">' + ms("refresh") + "</button></div>";
    var body;
    if (d == null) body = '<p class="w-hint">' + ms("hourglass_empty") + "Loading the care plan.</p>";
    else if (d.failed) body = '<p class="w-hint warn">' + ms("error") + "Could not load the care plan. Do not read this as no plan.</p>";
    else if (!d.plan) body = '<p class="w-empty">No care plan has been written for this stay yet.</p>';
    else {
      var p = d.plan, rv = p.review || {};
      var review = rv.state === "stale" ? '<p class="w-hint warn">' + ms("alarm") + "Review overdue by " + esc(rv.overdueDays) + " day" + (rv.overdueDays === 1 ? "" : "s") + " (was due " + when(p.reviewBy) + ").</p>"
        : rv.state === "current" ? '<p class="w-hint">' + ms("event") + "Next review by " + when(p.reviewBy) + ".</p>"
        : rv.state === "no-review-date" ? '<p class="w-hint warn">' + ms("warning") + "No review date set, so nobody is due to look at this plan again.</p>"
        : '<p class="w-hint">' + ms("info") + "This plan is closed.</p>";
      var goals = (p.goals || []).length ? '<ul class="w-mini">' + p.goals.map(function (g) {
        var acts = ["met", "not-met", "cancelled"].filter(function (x) { return x !== g.state; }).map(function (x) {
          return '<button class="w-btn ghost sm" data-w-act="cpprog:' + esc(g.key) + "~" + x + '">' + GOAL_WORDS[x] + "</button>";
        }).join("");
        return '<li class="w-mini-row"><div><span class="w-st ' + (g.state === "met" ? "done" : g.state === "not-met" ? "overdue" : g.state === "active" ? "due" : "") + '">' + esc(GOAL_WORDS[g.state] || g.state) + "</span> <b>" + esc(g.title) + "</b>" +
          '<div class="w-dt-times"><b>How we will know:</b> ' + esc(g.measure) + (g.targetDate ? " &middot; by " + when(g.targetDate) : "") + "</div>" +
          (g.decidedAt ? '<div class="w-dt-times">' + esc(GOAL_WORDS[g.state] || g.state) + " " + when(g.decidedAt) + (g.decidedBy ? " &middot; by " + esc(g.decidedBy) : "") + "</div>" : "") +
          (g.outcomeNote ? '<div class="w-dt-times"><b>Note:</b> ' + esc(g.outcomeNote) + "</div>" : "") +
          '</div><div class="w-mini-row-act">' + acts + "</div></li>";
      }).join("") + "</ul>" : '<p class="w-empty">This plan has no goals.</p>';
      var c = p.counts || {};
      body = '<div class="w-sub"><h4>' + esc(p.title || "Care plan") + "</h4>" +
        '<p class="w-dt-times">' + esc(c.active || 0) + " in progress &middot; " + esc(c.met || 0) + " met &middot; " + esc(c["not-met"] || 0) + " not met &middot; " + esc(c.cancelled || 0) + " cancelled" +
        (p.lastReviewedAt ? " &middot; last reviewed " + when(p.lastReviewedAt) + (p.lastReviewedBy ? " by " + esc(p.lastReviewedBy) : "") : " &middot; never reviewed") + "</p>" +
        review + goals +
        '<div class="w-filter"><label class="w-f"><span>Next review by</span><input id="wCpNextReview" type="date"></label>' +
        '<button class="w-btn ghost" data-w-act="cpreview">' + ms("task_alt") + "Record plan reviewed</button></div></div>";
    }
    return '<div class="w-card">' + head + body +
      '<div class="w-sub"><h4>' + (d && d.plan ? "Add goals" : "Write the care plan") + "</h4>" + carePlanForm() + "</div></div>";
  }

  /* DUPLICATE RECORDS. mpi-view.js and identity-merge.js were complete and unreachable, so a records
   * officer who suspected one patient had two records had no way to find the other, and no way to
   * join them. Two records for one person is a real hazard: the allergy is on one and the
   * prescription goes to the other.
   *
   * A MATCH IS A SUGGESTION, NEVER A DECISION. Every candidate shows WHICH fields agreed and which
   * disagreed, in the module's own words - a score with no reasons is a number nobody can argue
   * with. Merging is a person's act, with a reason, confirmed, and reversible: the module stores a
   * merge as a claim that moves no clinical data, which is what makes "undo" honest.
   *
   * AN EMPTY RESULT FROM A PARTIAL SEARCH IS NOT "NO DUPLICATE". When the search hit its cap the
   * module says so, and that sentence sits above the results, because the failure it prevents is
   * registering a patient a second time on the strength of a search that never looked. */
  function mpiCandidateRow(c, subjectId) {
    return '<li class="w-mini-row"><div>' +
      '<span class="w-st ' + (c.band === "probable" || c.band === "certain" ? "escalate" : "due") + '">' + esc(c.band || "possible") + "</span> " +
      "<b>" + esc(c.name || c.patientId) + "</b>" + (c.mrn ? " &middot; " + esc(c.mrn) : "") +
      (c.dob ? " &middot; born " + esc(c.dob) : "") + (c.sex ? " &middot; " + esc(c.sex) : "") +
      '<div class="w-dt-times">score ' + esc(c.score) +
      (c.agreed && c.agreed.length ? " &middot; agreed: " + esc(c.agreed.join(", ")) : "") +
      (c.disagreed && c.disagreed.length ? " &middot; disagreed: " + esc(c.disagreed.join(", ")) : "") + "</div>" +
      "</div><div class=\"w-mini-row-act\">" +
      /* No "Undo" here: a search match is not a merge, and undoing a merge that never happened only
       * ever failed. Undo lives on the history below, against joins that actually exist. */
      (subjectId && subjectId !== c.patientId
        ? '<button class="w-btn ghost sm" data-w-act="mpimerge:' + esc(subjectId) + "~" + esc(c.patientId) + '">' + ms("fact_check") + "Same person - merge</button>"
        : "") +
      "</div></li>";
  }
  /* MERGE HISTORY of the open record: what it was joined into, what was joined into it, and every
   * undo, with who and why. Not loaded, failed and empty are three different sentences. */
  function mpiHistory(state, subjectId) {
    var h = state.mpiIdentity;
    if (h == null) return '<p class="w-hint">' + ms("hourglass_empty") + "Loading the merge history of this record...</p>";
    if (h.failed) return '<p class="w-hint warn">' + ms("error") + "Could not load the merge history. Do not read this as never merged.</p>";
    var idn = h.identity;
    if (!idn) return '<p class="w-hint warn">' + ms("warning") + "The clinical record is not switched on for this hospital, so there is no merge history to show.</p>";
    var links = idn.links || [];
    var rows = links.map(function (l) {
      var live = l.state === "merged";
      var other = l.survivorId === subjectId ? l.mergedId : l.survivorId;
      var what = l.survivorId === subjectId ? "Record " + esc(other) + " was joined into this one" : "This record was joined into " + esc(other);
      return '<li class="w-mini-row"><div>' +
        '<span class="w-st ' + (live ? "escalate" : "done") + '">' + (live ? "joined" : "undone") + "</span> " + what +
        '<div class="w-dt-times">' + esc(l.mergedBy || "unknown") + " &middot; " + when(l.mergedAt) + (l.reason ? " &middot; " + esc(l.reason) : "") + "</div>" +
        (live ? "" : '<div class="w-dt-times">Undone by ' + esc(l.unmergedBy || "unknown") + " &middot; " + when(l.unmergedAt) + (l.unmergeReason ? " &middot; " + esc(l.unmergeReason) : "") + "</div>") +
        '</div><div class="w-mini-row-act">' +
        (live ? '<button class="w-btn ghost sm" data-w-act="mpiunmerge:' + esc(l.survivorId) + "~" + esc(l.mergedId) + '">' + ms("undo") + "Undo this merge</button>" : "") +
        "</div></li>";
    }).join("");
    return (h.partialWarning ? '<p class="w-hint warn">' + ms("warning") + esc(h.partialWarning) + "</p>" : "") +
      (idn.isMerged ? '<p class="w-hint warn">' + ms("warning") + "This record has been merged into " + esc(idn.mergedInto) + ". The complete chart is under that record.</p>" : "") +
      (rows ? '<ul class="w-mini">' + rows + "</ul>"
        : h.partial ? '<p class="w-hint warn">' + ms("warning") + "No merges found in what was checked, but the check was partial.</p>"
        : '<p class="w-empty">This record has never been merged with another.</p>');
  }
  /* MERGE PREVIEW: both records side by side, every field that differs marked, before anything is
   * written. The server ran every check to produce it, so this is what the join would really do. */
  function mpiPreviewCard(p) {
    var F = [["name", "Name"], ["mrn", "MRN"], ["dob", "Date of birth"], ["sex", "Sex"]];
    var rows = F.map(function (f) {
      var a = p.survivor[f[0]] || "", b = p.merged[f[0]] || "";
      var differs = String(a).toLowerCase() !== String(b).toLowerCase();
      return "<tr" + (differs ? ' class="w-diff"' : "") + "><th>" + f[1] + "</th><td>" + esc(a || "-") + "</td><td>" + esc(b || "-") + "</td><td>" + (differs ? ms("warning") + "differs" : "") + "</td></tr>";
    }).join("");
    return '<div class="w-sub"><h4>Check before joining these records</h4>' +
      '<div style="overflow-x:auto"><table class="w-tbl"><tr><th></th><th>Keeps (' + esc(p.survivor.patientId) + ")</th><th>Joins it (" + esc(p.merged.patientId) + ")</th><th></th></tr>" + rows + "</table></div>" +
      '<p class="w-hint">' + ms("info") + "No clinical data is moved or deleted. Both records stay as they are, and this can be undone.</p>" +
      '<label class="w-f"><span>What establishes these are the same person?</span><textarea id="wMpiReason" rows="2" placeholder="For example: same Aadhaar, same mobile, confirmed with the patient"></textarea></label>' +
      '<button class="w-btn" data-w-act="mpimergeconfirm">' + ms("fact_check") + "Join these records</button> " +
      '<button class="w-btn ghost" data-w-act="mpimergecancel">Cancel</button></div>';
  }
  /* PATIENT DOCUMENTS (documents.js). A consent form, a referral letter, an outside report.
   *
   * NOT LOADED, FAILED, STORAGE OFF AND NONE are four different sentences: a consent that failed to load
   * must never read as "no consent on file". A withdrawn document stays in the list, struck through, with
   * the reason - that it was once filed against this patient is itself part of the record. Opening a file
   * asks the server for a five-minute link for this person only; there is no public address to copy. */
  var DOC_TYPE_LABEL = { "consent": "Consent", "referral-letter": "Referral letter", "outside-report": "Outside report", "outside-imaging": "Outside imaging", "id-proof": "ID proof", "insurance": "Insurance", "prescription-outside": "Outside prescription", "other": "Other" };
  function documentsView(state) {
    var d = state.docs;
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Documents</h3></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Loading this patient's documents...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load this patient's documents. Do not read this as none on file.</p></div>";
    var rows = (d.documents || []).map(function (x) {
      var withdrawn = x.status !== "current";
      return '<li class="w-mini-row"><div>' +
        '<span class="w-st ' + (withdrawn ? "missed" : "done") + '">' + esc(DOC_TYPE_LABEL[x.docType] || x.docType) + "</span> " +
        (withdrawn ? "<s>" + esc(x.title) + "</s>" : "<b>" + esc(x.title) + "</b>") + " &middot; version " + esc(x.version) +
        '<div class="w-dt-times">' + esc(x.uploadedBy) + " &middot; " + when(x.uploadedAt) + " &middot; " + esc(Math.max(1, Math.round((x.sizeBytes || 0) / 1024))) + " KB</div>" +
        (x.status === "entered-in-error" ? '<div class="w-dt-times">Withdrawn: ' + esc(x.withdrawnReason || "") + " (" + esc(x.withdrawnBy || "") + ")</div>" : "") +
        (x.status === "purged" ? '<div class="w-dt-times">File deleted after its retention period, ' + when(x.purgedAt) + "</div>" : "") +
        docPortalReleases(x) +
        '</div><div class="w-mini-row-act">' +
        (x.status !== "purged" && d.storageConfigured ? '<button class="w-btn ghost sm" data-w-act="docopen:' + esc(x.id) + "~" + esc(x.version) + '">' + ms("open_in_new") + "Open</button>" : "") +
        (x.version > 1 ? '<button class="w-btn ghost sm" data-w-act="docversions:' + esc(x.id) + '">' + ms("history") + "Versions</button>" : "") +
        (!withdrawn ? '<button class="w-btn ghost sm" data-w-act="docnewversion:' + esc(x.id) + "~" + esc(x.version) + '">' + ms("upload") + "New version</button>" +
          '<button class="w-btn ghost sm" data-w-act="docwithdraw:' + esc(x.id) + '">' + ms("block") + "Withdraw</button>" +
          /* P2: this exact version, to the patient portal. The server refuses a withdrawn, purged or
           * past-retention document whatever this screen offers. */
          '<button class="w-btn ghost sm" data-w-act="docrelease:' + esc(x.id) + "~" + esc(x.version) + '">' + ms("send") + "Release to patient portal</button>" : "") +
        /* Offered only once the hospital's retention period is over; the server refuses it before then,
         * and to anyone but an administrator, whatever this screen shows. */
        (x.status !== "purged" && d.storageConfigured && x.retainUntil && new Date(x.retainUntil).getTime() <= Date.now()
          ? '<button class="w-btn ghost sm" data-w-act="docpurge:' + esc(x.id) + '">' + ms("delete") + "Delete file (retention ended)</button>" : "") +
        "</div>" +
        (state.docVersions && state.docVersions.id === x.id ? docVersionsBlock(state.docVersions) : "") +
        "</li>";
    }).join("");
    var target = state.docNewVersion;
    var form = !d.storageConfigured
      ? '<p class="w-hint warn">' + ms("warning") + "Document storage is not set up for this hospital yet, so documents cannot be uploaded or opened. Ask the hospital administrator.</p>"
      : '<div class="w-sub"><h4>' + (target ? "Upload a new version" : "Add a document") + "</h4>" +
        (target ? '<p class="w-hint">' + ms("info") + "The earlier version is kept and can still be opened.</p>" :
          '<label class="w-f"><span>Type</span><select id="wDocType">' + Object.keys(DOC_TYPE_LABEL).map(function (k) { return '<option value="' + k + '">' + DOC_TYPE_LABEL[k] + "</option>"; }).join("") + "</select></label>") +
        '<label class="w-f"><span>Title</span><input id="wDocTitle" maxlength="160" placeholder="For example: Consent for central line"></label>' +
        '<label class="w-f"><span>File (PDF or photo, up to 10 MB)</span><input id="wDocFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></label>' +
        '<button class="w-btn" data-w-act="docupload">' + ms("upload") + (target ? "Upload new version" : "Upload") + "</button>" +
        (target ? ' <button class="w-btn ghost" data-w-act="docnewversioncancel">Cancel</button>' : "") + "</div>";
    return '<div class="w-card">' + head + form +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No documents on file for this patient.</p>') + "</div>";
  }
  /* G5: which versions of this document went to the patient portal (documents.js portalReleasesOf). false = the
   * releases could not be read, which must never read as "not released"; an older server sends nothing, and
   * nothing is claimed. */
  var DOC_RELEASE_SCOPE = { "patient-portal": "Patient portal (the patient, and any family member granted documents)" };
  function docPortalReleases(x) {
    var list = x.portalReleases;
    if (list === false) return '<p class="w-hint warn">' + ms("error") + "Could not load which versions were released to the patient portal. Do not read this as never released.</p>";
    if (!list) return "";
    if (!list.length) return '<div class="w-dt-times">Not released to the patient portal.</div>';
    return '<div class="w-sub"><h4>Released to the patient portal</h4><ul class="w-mini">' + list.map(function (r) {
      var state = r.current ? '<span class="w-st done">Current version</span>'
        : '<span class="w-st missed">Not current: ' + (x.status === "entered-in-error" ? "document withdrawn" : x.status === "purged" ? "file deleted" : "version " + esc(x.version) + " is newer") + "</span>";
      return '<li class="w-mini-row"><div>Version ' + esc(r.version) + " " + state +
        '<div class="w-dt-times">' + when(r.at) + " &middot; by " + esc(r.releasedBy || "unknown") + " &middot; " + esc(DOC_RELEASE_SCOPE[r.scope] || r.scope) + "</div>" +
        '<div class="w-dt-times">Release ' + esc(r.releaseId) + (r.reason ? " &middot; Reason: " + esc(r.reason) : "") + (r.consentRef ? " &middot; Consent " + esc(r.consentRef) : "") + "</div></div></li>";
    }).join("") + "</ul></div>";
  }
  function docVersionsBlock(v) {
    if (v.failed) return '<p class="w-hint warn">' + ms("error") + "Could not load the earlier versions.</p>";
    if (!v.versions) return '<p class="w-hint">' + ms("hourglass_empty") + "Loading versions...</p>";
    var releasable = v.versions.length && v.versions[v.versions.length - 1].status === "current";
    return '<ul class="w-mini">' + v.versions.map(function (x) {
      return '<li class="w-mini-row"><div>Version ' + esc(x.version) + " &middot; " + esc(x.title) + ' <span class="w-dt-times">' + esc(x.uploadedBy) + " &middot; " + when(x.uploadedAt) + "</span></div>" +
        '<div class="w-mini-row-act">' + (x.status !== "purged" ? '<button class="w-btn ghost sm" data-w-act="docopen:' + esc(x.id) + "~" + esc(x.version) + '">' + ms("open_in_new") + "Open</button>" : "") +
        (releasable && x.status === "current" ? '<button class="w-btn ghost sm" data-w-act="docrelease:' + esc(x.id) + "~" + esc(x.version) + '">' + ms("send") + "Release to patient portal</button>" : "") + "</div></li>";
    }).reverse().join("") + "</ul>";
  }
  /* REFERRALS (referral.js). Each referral shows its one current state and the actions that state
   * allows; the server decides who may take each (a referrer cannot accept their own), this screen only
   * offers them. Not loaded, failed and none are three different sentences. */
  var REF_LABEL = { requested: "Waiting to be accepted", accepted: "Accepted", scheduled: "Appointment booked", seen: "Seen", responded: "Reply received", closed: "Closed", declined: "Declined", cancelled: "Cancelled" };
  var REF_ACTIONS = { requested: ["accept", "decline", "cancel"], accepted: ["schedule", "seen"], scheduled: ["schedule", "seen"], seen: ["respond"], responded: ["close"], declined: ["close"] };
  var REF_ACT_LABEL = { accept: "Accept", decline: "Decline", cancel: "Cancel", schedule: "Book appointment", seen: "Mark seen", respond: "Send reply", close: "Close" };
  function referralRow(x) {
    return '<li class="w-mini-row"><div>' +
      '<span class="w-st ' + (x.urgency === "emergency" ? "escalate" : x.urgency === "urgent" ? "due" : "done") + '">' + esc(x.urgency) + "</span> " +
      "<b>" + esc(x.specialty) + "</b>" + (x.kind === "external" ? " at " + esc(x.destinationFacility) : "") + " &middot; " + esc(REF_LABEL[x.status] || x.status) +
      '<div class="w-dt-times">' + esc(x.reason) + " &middot; from " + esc(x.referringProvider) + " &middot; " + when(x.requestedAt) +
      (x.appointmentAt ? " &middot; appointment " + when(x.appointmentAt) : "") + "</div>" +
      '<div class="w-dt-times">' + esc(x.clinicalSummary) + "</div>" +
      (x.response ? '<div class="w-dt-times"><b>Reply:</b> ' + esc(x.response) + "</div>" : "") +
      (x.declineReason ? '<div class="w-dt-times"><b>Declined:</b> ' + esc(x.declineReason) + "</div>" : "") +
      '</div><div class="w-mini-row-act">' + (REF_ACTIONS[x.status] || []).map(function (a) {
        return '<button class="w-btn ghost sm" data-w-act="refact:' + esc(x.id) + "~" + a + "~" + esc(x.version) + '">' + REF_ACT_LABEL[a] + "</button>";
      }).join("") + "</div></li>";
  }
  function referralsView(state) {
    var d = state.referrals, inbox = state.view === "referralinbox";
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>" + (inbox ? "Referral inbox" : "Referrals") + "</h3></div>";
    var filter = inbox ? '<div class="w-sub"><div class="w-grid"><label class="w-f"><span>Specialty</span><input id="wRefSpec" value="' + esc(state.refSpecialty || "") + '" placeholder="All specialties"></label>' +
      '<label class="w-f"><span>Show</span><select id="wRefView"><option value="">Referrals to a specialty</option><option value="sent"' + (state.refView === "sent" ? " selected" : "") + ">Referrals I sent</option></select></label></div>" +
      '<button class="w-btn" data-w-act="refinboxload">' + ms("search") + "Show</button></div>" : "";
    var form = inbox ? "" : '<div class="w-sub"><h4>Refer this patient</h4>' +
      '<div class="w-grid"><label class="w-f"><span>To (specialty)</span><input id="wRefSpecialty" placeholder="For example: Cardiology"></label>' +
      '<label class="w-f"><span>How soon</span><select id="wRefUrgency"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label>' +
      '<label class="w-f"><span>Where</span><select id="wRefKind"><option value="internal">This hospital</option><option value="external">Another facility</option></select></label>' +
      '<label class="w-f"><span>Facility (if another)</span><input id="wRefFacility"></label></div>' +
      '<label class="w-f"><span>Reason</span><input id="wRefReason"></label>' +
      '<label class="w-f"><span>Clinical summary for the receiving team</span><textarea id="wRefSummary" rows="3"></textarea></label>' +
      '<button class="w-btn" data-w-act="refcreate">' + ms("send") + "Send referral</button></div>";
    var body = d == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading referrals...</p>"
      : d.failed ? '<p class="w-hint warn">' + ms("error") + "Could not load referrals. Do not read this as none.</p>"
      : (d.partialWarning ? '<p class="w-hint warn">' + ms("warning") + esc(d.partialWarning) + "</p>" : "") +
        ((d.referrals || []).length ? '<ul class="w-mini">' + d.referrals.map(referralRow).join("") + "</ul>"
          : '<p class="w-empty">' + (inbox ? "No open referrals here." : "No referrals for this patient.") + "</p>");
    return '<div class="w-card">' + head + filter + form + body + "</div>";
  }
  /* HOSPITAL FORMS (wardsynq-forms.js). The screen draws the published form and hides fields whose condition
   * is not met, as a courtesy; the server re-checks everything, computes calculated fields itself and refuses
   * an invalid response with every field error. Not loaded, failed and none are different sentences. */
  /* P1.6 NURSE WORKLIST. Sickest and most overdue first (the server sorts). A patient whose schedule or score
   * could not be read says so on the row; a score that could not be worked out has no number. */
  /* P2.3 SURVEILLANCE BOARD. Loading, failed and empty are three different sentences. A patient whose signals
   * could not be computed says so on the row; a rule that was not evaluated is listed, never read as normal.
   * Evidence opens the record itself. Nothing here pages anyone or changes an order. */
  function evidenceLinks(evidence) {
    return (evidence || []).filter(function (e) { return e && e.id; }).map(function (e) {
      return '<button class="w-btn tiny ghost" data-w-act="timelinedetail:' + esc(e.resourceType) + "~" + esc(e.id) + '">' + ms("link") +
        esc(e.resourceType) + (e.value != null && typeof e.value !== "object" ? " " + esc(String(e.value)) + (e.unit ? " " + esc(e.unit) : "") : "") +
        (e.at ? " &middot; " + esc(when(e.at)) : "") + "</button>";
    }).join(" ");
  }
  function surveillanceView(state) {
    var d = state.surveillance;
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Surveillance</h3>" +
      '<button class="w-btn ghost sm" data-w-act="surveillance">' + ms("refresh") + "Refresh</button></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Checking every patient on the ward...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load surveillance. Do not read this as no signals.</p></div>";
    var intro = '<p class="w-hint">' + ms("info") + esc(d.monitoring || "Signals are computed from the record and shown. Nothing has been paged.") + "</p>" +
      (d.partialWarning ? '<p class="w-hint warn">' + ms("warning") + esc(d.partialWarning) + "</p>" : "") +
      ((d.notBuilt || []).length ? '<p class="w-hint">' + ms("block") + "Not built: " + d.notBuilt.map(function (n) { return esc(n.ruleId) + " (" + esc(n.reason) + ")"; }).join("; ") + "</p>" : "");
    var failed = (d.rows || []).filter(function (r) { return r.failed; });
    var withSignals = (d.rows || []).filter(function (r) { return !r.failed && (r.signals || []).length; });
    var body;
    if (!(d.rows || []).length) body = '<p class="w-empty">No patients on this ward, so nothing was checked.</p>';
    else {
      body = failed.map(function (r, _) {
        var p = r.patient || {};
        return '<div class="w-card"><b>' + esc(p.name || r.patientId) + (p.bed ? " &middot; bed " + esc(p.bed) : "") + '</b><p class="w-hint warn">' + ms("error") +
          "Signals could not be computed for this patient (" + esc(r.failed) + "). Do not read this as no signals.</p></div>";
      }).join("") +
      (withSignals.length ? withSignals.map(function (r) {
        var p = r.patient || {}, ri = d.rows.indexOf(r);
        return '<div class="w-card"><div class="w-card-h">' + ms("person") + "<h3>" + esc(p.name || r.patientId) + (p.bed ? " &middot; bed " + esc(p.bed) : "") + "</h3></div>" +
          '<ul class="w-mini">' + r.signals.map(function (sg, si) {
            var acks = sg.acknowledgements || [];
            return '<li class="w-surv"><b>' + esc(sg.label) + "</b> " + esc(sg.summary) +
              '<div class="w-hint">Since ' + esc(sg.firstSeenAt ? when(sg.firstSeenAt) : "unknown") + " &middot; rule: " + esc(sg.source) + "</div>" +
              '<div class="w-hint">Evidence: ' + (evidenceLinks(sg.evidence) || "no record ids") + "</div>" +
              (acks.length ? '<div class="w-hint">' + ms("task_alt") + acks.map(function (a) { return "Acknowledged by " + esc(a.by) + " at " + esc(when(a.at)) + ": " + esc(a.note); }).join("<br>") + "</div>"
                : '<div class="w-hint warn">' + ms("pending") + "Not acknowledged</div>") +
              '<div class="w-maik-acts"><button class="w-btn tiny" data-w-act="survack:' + ri + "~" + si + '">' + ms("check") + "Acknowledge</button>" +
              (sg.incidentSource ? ' <button class="w-btn tiny ghost" data-w-act="incidentsignal:' + esc(sg.incidentSource.resourceType) + "~" + esc(sg.incidentSource.id) + '">' + ms("report") + "Raise safety signal</button>" : "") +
              "</div></li>";
          }).join("") + "</ul>" +
          ((r.notEvaluated || []).length ? '<p class="w-hint">Not evaluated: ' + r.notEvaluated.map(function (n) { return esc(n.ruleId) + " (" + esc(n.reason) + ")"; }).join("; ") + "</p>" : "") +
          "</div>";
      }).join("") : "") +
      (!withSignals.length && !failed.length ? '<p class="w-empty">No active signals on this ward. Rules that could not be evaluated for a patient are listed below.</p>' : "") +
      (d.rows || []).filter(function (r) { return !r.failed && !(r.signals || []).length && (r.notEvaluated || []).length; }).map(function (r) {
        var p = r.patient || {};
        return '<p class="w-hint">' + esc(p.name || r.patientId) + ": no active signals; not evaluated: " + r.notEvaluated.map(function (n) { return esc(n.ruleId); }).join(", ") + "</p>";
      }).join("");
    }
    return '<div class="w-card">' + head + intro + "</div>" + detailPanel(state) + body;
  }
  function nurseWorklistView(state) {
    var d = state.nurseWorklist;
    var bar = function (next) {
      return '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Nurse worklist</h3>" + (next || "") +
        '<button class="w-btn ghost sm" data-w-act="nurseworklist">' + ms("refresh") + "Refresh</button></div>";
    };
    if (d == null) return '<div class="w-card w-nw">' + bar() + '<p class="w-hint">' + ms("hourglass_empty") + "Loading the ward...</p></div>";
    if (d.failed) return '<div class="w-card w-nw">' + bar() + '<p class="w-hint warn">' + ms("error") + "Could not load the worklist. Do not read this as nothing due.</p></div>";
    var mine = state.nwScope === "mine";
    var toggle = '<div class="w-sub w-noprint"><button class="w-btn ' + (mine ? "" : "ghost ") + 'sm" data-w-act="nwscope:mine">Mine</button> <button class="w-btn ' + (mine ? "ghost " : "") + 'sm" data-w-act="nwscope:ward">Whole ward</button></div>';
    var shown = mine ? d.rows.filter(function (r) { return r.assignment && r.assignment.nurseId && r.assignment.nurseId === d.me; }) : d.rows;
    /* P2.16: the shift's "next due" line, kept in the sticky bar. The server's own per-row counts, added
     * up; a row whose counts could not be read is counted as unreadable, never as zero. */
    var dueOver = 0, dueSoon = 0, dueUnread = 0;
    shown.forEach(function (r) { if (r.overdue == null || r.dueSoon == null) dueUnread++; else { dueOver += r.overdue; dueSoon += r.dueSoon; } });
    var head = bar(shown.length ? '<span class="w-next' + (dueOver || dueUnread ? " warn" : "") + '">Next due: ' + esc(dueOver) + " overdue &middot; " + esc(dueSoon) + " in the next 4 hours" +
      (dueUnread ? " &middot; " + esc(dueUnread) + (dueUnread === 1 ? " patient" : " patients") + " could not be read" : "") + "</span>" : "");
    var rows = shown.map(function (r) {
      var p = r.patient || {}, n = r.news2;
      var score = !n ? "" : !n.scorable ? '<span class="w-st due">Score: not enough observations</span>' : '<span class="w-st ' + (n.risk === "high" ? "escalate" : n.risk === "medium" ? "due" : "done") + '">NEWS ' + esc(n.total) + (n.risk ? " " + esc(n.risk) : "") + "</span>";
      return '<li class="w-mini-row"><div><b>' + esc(p.name || r.patientId) + "</b>" + (p.bed ? " &middot; bed " + esc(p.bed) : "") + " " + score +
        '<div class="w-dt-times">' + (r.overdue == null ? "" : (r.overdue ? '<span class="w-st escalate">' + esc(r.overdue) + " dose" + (r.overdue === 1 ? "" : "s") + " overdue</span> " : "No doses overdue &middot; ") + esc(r.dueSoon) + " due in the next 4 hours") + "</div>" +
        nursingRowLine(r) +
        (r.escalation ? '<div class="w-hint warn">' + ms("notifications_active") + esc(r.escalation.text) + "</div>" : "") +
        (r.problems.length ? '<div class="w-hint warn">' + ms("error") + esc(r.problems.join("; ")) + "</div>" : "") +
        "</div>" + (p.encounterId ? '<div class="w-mini-row-act"><button class="w-btn ghost sm" data-w-act="nursingpatient:' + esc(r.patientId) + "~" + esc(p.encounterId) + '">Nursing</button> <button class="w-btn ghost sm" data-w-act="open:' + esc(p.encounterId) + '">Open chart</button></div>' : "") + "</li>";
    }).join("");
    return '<div class="w-card w-nw">' + head + toggle + (d.partialWarning ? '<p class="w-hint warn">' + ms("warning") + esc(d.partialWarning) + "</p>" : "") +
      (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">' + (mine && d.rows.length ? "No patients on this ward are assigned to you." : "No patients on this ward.") + "</p>") + "</div>";
  }
  /* The nursing columns of a worklist row. A piece the server could not read is null and is never shown as
   * zero or "not due": the row's problem line already says what failed. */
  function nursingRowLine(r) {
    var a = r.assignment, v = r.vitals, bits = [];
    if (a) bits.push(a.nurseId ? "Nurse: " + esc(a.nurseLabel || a.nurseId) + (a.shift ? " (" + esc(a.shift) + ")" : "") : "No nurse assigned");
    if (r.tasksOverdue != null) bits.push(r.tasksOverdue ? '<span class="w-st escalate">' + esc(r.tasksOverdue) + " task" + (r.tasksOverdue === 1 ? "" : "s") + " overdue</span>" : esc(r.tasksOpen) + " open task" + (r.tasksOpen === 1 ? "" : "s"));
    if (v) bits.push(v.state === "overdue" ? '<span class="w-st escalate">' + esc(v.text) + "</span>" : esc(v.text) + (v.dueAt ? " " + when(v.dueAt) : ""));
    return bits.length ? '<div class="w-dt-times">' + bits.join(" &middot; ") + "</div>" : "";
  }
  /* P1.6 NURSING PANEL for one patient: assigned nurse, observation frequency, and the shift's tasks. Loading,
   * failed and empty are different sentences. */
  function nursingPatientView(state) {
    var np = state.nursingPanel || {}, d = np.data, wl = state.nurseWorklist || {};
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Nursing: " + esc(np.name || np.patientId || "") + "</h3></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Loading tasks and observations...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load this patient's nursing tasks. Do not read this as nothing due.</p></div>";
    var problems = (d.problems || []).length ? '<p class="w-hint warn">' + ms("error") + esc(d.problems.join("; ")) + "</p>" : "";
    var a = d.assignment, staff = wl.staff;
    var who = function (id) { var m = (staff || []).filter(function (x) { return x.identity === id; })[0]; return m ? m.label : id; };
    var assign = '<div class="w-sub"><h4>Assigned nurse</h4>' +
      (a == null ? '<p class="w-hint warn">Assignment not known.</p>' : "<p>" + (a.nurseId ? esc(a.nurseLabel || a.nurseId) + (a.shift ? " (" + esc(a.shift) + ")" : "") + " since " + when(a.assignedAt) : "No nurse assigned.") + "</p>") +
      (staff == null ? '<p class="w-hint warn">The staff list could not be loaded, so nobody can be picked.</p>'
        : '<label class="w-f"><span>Nurse</span><select id="wNaNurse"><option value="">-</option>' + staff.map(function (m) { return '<option value="' + esc(m.identity) + '">' + esc(m.label) + " (" + esc(m.role) + ")</option>"; }).join("") + "</select></label>" +
          '<label class="w-f"><span>Shift</span><input id="wNaShift" placeholder="Day, Night"></label>' +
          '<button class="w-btn sm" data-w-act="nurseassign:assign">Assign</button>') +
      (a && a.nurseId ? ' <button class="w-btn ghost sm" data-w-act="nurseassign:unassign">Unassign</button>' : "") + "</div>";
    var v = d.vitals, opts = ["", "1", "2", "4", "6", "12"];
    var obs = '<div class="w-sub"><h4>Observations</h4>' +
      (v == null ? '<p class="w-hint warn">Observation schedule not known.</p>' : "<p>" + (v.state === "overdue" ? '<span class="w-st escalate">' + esc(v.text) + "</span>" : esc(v.text)) + (v.dueAt ? " " + when(v.dueAt) : "") + (v.lastAt ? " &middot; last recorded " + when(v.lastAt) : "") + "</p>") +
      '<label class="w-f"><span>Every</span><select id="wObsEvery">' + opts.map(function (h) { return '<option value="' + h + '"' + (v && String(v.everyHours || "") === h ? " selected" : "") + ">" + (h ? h + " hours" : "No frequency") + "</option>"; }).join("") + "</select></label>" +
      '<button class="w-btn sm" data-w-act="obsfreqsave">Save frequency</button></div>';
    var tasks = d.tasks == null ? '<p class="w-hint warn">Tasks not known.</p>'
      : d.tasks.length ? '<ul class="w-mini">' + d.tasks.map(function (t) {
          var st2 = t.status === "open" ? (t.overdue ? '<span class="w-st escalate">Overdue</span>' : '<span class="w-st due">Open</span>')
            : t.status === "done" ? '<span class="w-st done">Done by ' + esc(who(t.doneBy)) + " " + when(t.doneAt) + "</span>"
            : '<span class="w-st">Cancelled: ' + esc(t.cancelReason) + "</span>";
          return '<li class="w-mini-row"><div><b>' + esc(t.title) + "</b> " + st2 + '<div class="w-dt-times">Due ' + when(t.dueAt) + " &middot; added by " + esc(who(t.createdBy)) + "</div></div>" +
            (t.status === "open" ? '<div class="w-mini-row-act"><button class="w-btn sm" data-w-act="ntaskact:' + esc(t.id) + "~done~" + esc(t.version) + '">Done</button> <button class="w-btn ghost sm" data-w-act="ntaskact:' + esc(t.id) + "~cancel~" + esc(t.version) + '">Cancel</button></div>' : "") + "</li>";
        }).join("") + "</ul>"
      : '<p class="w-empty">No tasks for this patient.</p>';
    var add = '<div class="w-sub"><label class="w-f"><span>New task</span><input id="wNtTitle" placeholder="What needs doing"></label>' +
      '<label class="w-f"><span>Due</span><input id="wNtDue" type="datetime-local"></label><button class="w-btn sm" data-w-act="ntaskadd">Add task</button></div>';
    return '<div class="w-card">' + head + problems + assign + obs + '<div class="w-sub"><h4>Tasks</h4>' + tasks + add + "</div></div>";
  }
  function formVisible(cond, a) {
    if (!cond) return true;
    if (cond.all) return cond.all.every(function (c) { return formVisible(c, a); });
    if (cond.any) return cond.any.some(function (c) { return formVisible(c, a); });
    var v = a[cond.field], filled = !(v == null || v === "" || (v && v.length === 0));
    return cond.op === "filled" ? filled : cond.op === "empty" ? !filled : cond.op === "eq" ? v === cond.value : cond.op === "ne" ? v !== cond.value
      : cond.op === "in" ? (cond.value || []).indexOf(v) >= 0 : cond.op === "gt" ? +v > +cond.value : cond.op === "gte" ? +v >= +cond.value : cond.op === "lt" ? +v < +cond.value : cond.op === "lte" ? +v <= +cond.value : false;
  }
  function formFieldHtml(f, a, err) {
    var id = "wFf_" + f.key, v = a[f.key];
    var input = f.type === "textarea" ? '<textarea id="' + id + '" data-w-formfield="' + esc(f.key) + '" rows="3">' + esc(v || "") + "</textarea>"
      : f.type === "boolean" ? '<select id="' + id + '" data-w-formfield="' + esc(f.key) + '"><option value="">-</option><option value="true"' + (v === true ? " selected" : "") + '>Yes</option><option value="false"' + (v === false ? " selected" : "") + ">No</option></select>"
      : f.type === "single_choice" ? '<select id="' + id + '" data-w-formfield="' + esc(f.key) + '"><option value="">-</option>' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (v === o.value ? " selected" : "") + ">" + esc(o.label || o.value) + "</option>"; }).join("") + "</select>"
      : f.type === "multi_choice" ? f.options.map(function (o) { return '<label><input type="checkbox" data-w-formmulti="' + esc(f.key) + '" value="' + esc(o.value) + '"' + ((v || []).indexOf(o.value) >= 0 ? " checked" : "") + "> " + esc(o.label || o.value) + "</label>"; }).join(" ")
      : f.type === "calculated" ? "<i>Worked out when saved</i>"
      : '<input id="' + id + '" data-w-formfield="' + esc(f.key) + '" type="' + (f.type === "number" || f.type === "integer" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text") + '" value="' + esc(v == null ? "" : v) + '">';
    return '<label class="w-f"><span>' + esc(f.label) + (f.required ? " *" : "") + "</span>" + input + (err ? '<em class="w-hint warn">' + esc(err) + "</em>" : "") + "</label>";
  }
  function formsView(state) {
    var d = state.formDefs, r = state.formResponses, sel = state.formSel, a = state.formAnswers || {}, errs = (state.formResult && state.formResult.errors) || {};
    var head = '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button><h3>Forms</h3></div>";
    if (d == null) return '<div class="w-card">' + head + '<p class="w-hint">' + ms("hourglass_empty") + "Loading this hospital's forms...</p></div>";
    if (d.failed) return '<div class="w-card">' + head + '<p class="w-hint warn">' + ms("error") + "Could not load the hospital's forms.</p></div>";
    var picker = d.published.length ? '<div class="w-sub"><h4>Fill in a form</h4>' + d.published.map(function (f) { return '<button class="w-btn ghost sm" data-w-act="formpick:' + esc(f.key) + '">' + esc(f.title) + " (v" + esc(f.version) + ")</button>"; }).join(" ") + "</div>"
      : '<p class="w-empty">This hospital has not published any forms yet.</p>';
    var form = "";
    if (sel) {
      form = '<div class="w-sub"><h4>' + esc(sel.title) + " (version " + esc(sel.version) + ")</h4>" + (sel.sections || []).map(function (s) {
        return "<h5>" + esc(s.title) + "</h5>" + (s.fields || []).filter(function (f) { return formVisible(f.showWhen, a); }).map(function (f) { return formFieldHtml(f, a, errs[f.key]); }).join("");
      }).join("") + '<button class="w-btn" data-w-act="formsubmit">' + ms("save") + "Save form</button></div>";
    }
    var past = r == null ? '<p class="w-hint">' + ms("hourglass_empty") + "Loading completed forms...</p>"
      : r.failed ? '<p class="w-hint warn">' + ms("error") + "Could not load completed forms. Do not read this as none.</p>"
      : r.responses.length ? '<ul class="w-mini">' + r.responses.map(function (x) { return '<li class="w-mini-row"><div><b>' + esc(x.formTitle) + "</b> v" + esc(x.formVersion) + ' <span class="w-dt-times">' + esc(x.completedBy) + " &middot; " + when(x.completedAt) + "</span><div class=\"w-dt-times\">" + esc(Object.keys(x.answers).map(function (k) { return k + ": " + JSON.stringify(x.answers[k]); }).join("; ")) + "</div></div></li>"; }).join("") + "</ul>"
      : '<p class="w-empty">No completed forms for this patient.</p>';
    return '<div class="w-card">' + head + picker + form + "<h4>Completed</h4>" + past + "</div>";
  }
  function mpiView(state) {
    var d = state.mpi;
    var s = state.sel;
    var subjectId = s ? s.patientId : "";
    var rows = d && d.candidates ? d.candidates.map(function (c) { return mpiCandidateRow(c, subjectId); }).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Duplicate records</h3></div>" +
      '<div class="w-sub"><h4>' + (s ? "Look for other records of " + esc(s.name || s.patientId) : "Find a patient who may already have a record") + "</h4>" +
      (s ? "" :
        '<input id="wMpiName" placeholder="Name">' +
        '<div class="w-grid"><label class="w-f"><span>Date of birth</span><input id="wMpiDob" type="date"></label>' +
        '<label class="w-f"><span>Sex</span><select id="wMpiSex"><option value="">Not known</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>' +
        '<label class="w-f"><span>MRN (optional)</span><input id="wMpiMrn"></label></div>') +
      '<button class="w-btn" data-w-act="mpisearch">' + ms("search") + "Search</button>" +
      '<p class="w-hint">' + ms("info") + "A match is a suggestion. Nothing is joined until a person decides, gives a reason, and confirms." + "</p></div>" +
      (state.mpiPreview ? mpiPreviewCard(state.mpiPreview) : "") +
      (s ? '<div class="w-sub"><h4>Merge history</h4>' + mpiHistory(state, subjectId) + "</div>" : "") +
      /* Above the results, not below them. */
      (d && d.partialWarning ? '<p class="w-hint warn">' + ms("warning") + esc(d.partialWarning) + "</p>" : "") +
      (d == null ? ""
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : d.partial
          ? '<p class="w-hint warn">' + ms("warning") + "Nothing found in what was searched - but the search was partial, so this is not proof of a new patient.</p>"
          : '<p class="w-empty">No other record looks like this one. Checked ' + esc(d.comparedAgainst || 0) + " records.</p>") +
      "</div>";
  }

  /* WRISTBANDS. identity-tag.js was complete and unreachable, so there was no way to issue a band, and
   * no way to check that the patient in the bed is the patient on the chart - which is the check that
   * stops a drug, a transfusion or an operation going to the wrong person.
   *
   * A MISMATCH IS THE LOUDEST THING ON THIS SCREEN. "Scanned band does not match" is shown as a stop,
   * in red, in words, and it does not fade: somebody who scanned the wrong band and missed a quiet
   * notice is exactly the failure this exists to catch.
   *
   * A BAND IS NEVER DELETED. Replaced, lost or ended, the old one stays in the history with who ended it
   * and why, because "which band was this patient wearing on Tuesday" is a question that gets asked. */
  var TAG_TYPE_WORDS = [["wristband", "Wristband"], ["qr", "QR code"], ["nfc", "NFC tag"]];
  function tagRow(t) {
    var active = t.status === "active";
    return '<li class="w-mini-row' + (active ? "" : " w-gone") + '"><div>' +
      '<span class="w-st ' + (active ? "" : "due") + '">' + esc(t.status) + "</span> " +
      "<b>" + esc(t.tagType) + "</b> &middot; " + esc(t.code) +
      '<div class="w-dt-times">issued ' + when(t.assignedAt) + (t.assignedBy ? " by " + esc(t.assignedBy) : "") +
      (t.endedAt ? " &middot; ended " + when(t.endedAt) + (t.endedBy ? " by " + esc(t.endedBy) : "") + (t.endedReason ? ": " + esc(t.endedReason) : "") : "") +
      "</div></div><div class=\"w-mini-row-act\">" +
      (active
        ? '<button class="w-btn ghost sm" data-w-act="tagreplace:' + esc(t.id) + '">Replace</button>' +
          '<button class="w-btn ghost sm" data-w-act="taglost:' + esc(t.id) + '">Lost</button>' +
          '<button class="w-btn ghost sm" data-w-act="tagend:' + esc(t.id) + '">End</button>'
        : "") +
      "</div></li>";
  }
  function tagsView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.tags, v = state.tagVerify;
    var rows = d && d.tags ? d.tags.slice().reverse().map(tagRow).join("") : "";
    var verdict = "";
    if (v) {
      verdict = v.matches
        ? '<div class="w-sub"><h4>' + ms("check") + "This band belongs to " + esc(s.name || s.patientId) + "</h4></div>"
        : '<div class="w-sub w-dead"><h4>' + ms("warning") + "STOP - this band does not match " + esc(s.name || s.patientId) + "</h4>" +
          "<p>" + esc(v.reason || "The scanned code is not this patient's active band.") + "</p>" +
          "<p>Do not give anything to this patient until the mismatch is resolved.</p></div>";
    }
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Wristband</h3>" +
      '<button class="w-ic" data-w-act="tags" title="Refresh">' + ms("refresh") + "</button></div>" +
      verdict +
      '<div class="w-sub"><h4>Check the band on the patient</h4>' +
      '<input id="wTgScan" placeholder="Scan or type the code on the band">' +
      '<button class="w-btn" data-w-act="tagverify">' + ms("fact_check") + "Check</button></div>" +
      (d && d.active && !d.active.length ? '<p class="w-hint warn">' + ms("warning") + "This patient has no active band.</p>" : "") +
      '<div class="w-sub"><h4>Issue a band</h4>' +
      '<div class="w-grid"><label class="w-f"><span>Kind</span><select id="wTgType">' +
      TAG_TYPE_WORDS.map(function (k) { return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label class="w-f"><span>Code on the band</span><input id="wTgCode"></label></div>' +
      '<button class="w-btn ghost" data-w-act="tagassign">' + ms("save") + "Issue</button></div>" +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<div class="w-sub"><h4>Bands, newest first</h4><ul class="w-mini">' + rows + "</ul></div>"
        : '<p class="w-empty">No band has ever been issued.</p>') +
      "</div>";
  }

  /* A PATIENT'S OPERATIONS. Every surgical case for this patient, newest first, with its stage - so a
   * ward doctor can see that the patient is booked for theatre, or was abandoned yesterday, without
   * going to the theatre board and hunting for them. */
  /* Why a case was abandoned is not a field on the case - wardsynq-surgical.js records it as the
   * detail of the ledger entry that ended it, so it is read from there. */
  function abandonReasonOf(c) {
    var l = (c && c.ledger) || [];
    for (var i = l.length - 1; i >= 0; i--) if (l[i] && l[i].event === "abandoned") return l[i].detail || "";
    return "";
  }
  function patientSurgeryView(state) {
    var s = state.sel;
    if (!s) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.patientCases;
    var rows = d && d.cases ? d.cases.map(function (c) {
      return '<li class="w-mini-row"><div>' +
        '<span class="w-st ' + (c.stage === "abandoned" ? "escalate" : "due") + '">' + esc(STAGE_WORDS[c.stage] || c.stage) + "</span> " +
        "<b>" + esc(c.procedure) + "</b>" + (c.site ? " &middot; " + esc(c.site) : "") + (c.laterality ? " " + esc(c.laterality) : "") +
        (abandonReasonOf(c) ? '<div class="w-dt-times">' + esc(abandonReasonOf(c)) + "</div>" : "") +
        "</div><div class=\"w-mini-row-act\">" +
        '<button class="w-btn ghost sm" data-w-act="opensurgery:' + esc(c.id) + '">Open</button>' +
        "</div></li>";
    }).join("") : "";
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<h3>Operations</h3></div>" +
      (d == null ? '<p class="w-empty">Loading.</p>'
        : rows ? '<ul class="w-mini">' + rows + "</ul>"
        : '<p class="w-empty">No operations recorded for this patient.</p>') +
      "</div>";
  }

  /* IMMUNIZATIONS (G6). The vaccine is typed as it was given: there is no vaccine picker, because a
   * catalogue shipped with the product would be wrong for most of the places it is used. A code is
   * optional and needs its code system. Not given is recorded with a reason, and a withdrawn entry
   * stays on screen, struck through, with who withdrew it and why.
   *
   * THREE STATES, NEVER TWO. null is still loading, false is a load that failed, and only a loaded
   * empty list says none recorded - a vaccine history that failed to load must never read as "none". */
  function immunizationRow(i) {
    var gone = i.status === "entered-in-error";
    return '<li class="w-mini-row' + (gone ? " w-gone" : "") + '"><div>' +
      "<b>" + esc(i.vaccine) + "</b>" +
      (i.vaccineCode ? " &middot; " + esc(i.vaccineCodeSystem || "") + " " + esc(i.vaccineCode) : "") +
      " &middot; " + esc(i.occurredOn) +
      (i.doseNumber ? " &middot; dose " + esc(i.doseNumber) : "") +
      (i.status === "not-done" ? ' <span class="w-st due">not given</span>' : "") +
      (gone ? ' <span class="w-st">withdrawn</span>' : "") +
      (i.primarySource ? "" : ' <span class="w-st">reported, not given here</span>') +
      (i.statusReason ? "<div>Reason: " + esc(i.statusReason) + "</div>" : "") +
      '<div class="w-dt-times">' +
      [i.lotNumber ? "lot " + esc(i.lotNumber) : "", i.site ? esc(i.site) : "", i.route ? esc(i.route) : "",
        i.performerName ? "given by " + esc(i.performerName) : i.performerId ? "given by " + esc(i.performerId) : ""].filter(Boolean).join(" &middot; ") +
      (i.lotNumber || i.site || i.route || i.performerName || i.performerId ? " &middot; " : "") +
      "recorded by " + esc(i.recordedBy) + " " + when(i.recordedAt) +
      (gone ? " &middot; withdrawn by " + esc(i.errorBy || "") + " " + when(i.errorAt) + " &middot; " + esc(i.errorReason || "") : "") + "</div>" +
      (i.note ? "<div>" + esc(i.note) + "</div>" : "") +
      '</div><div class="w-mini-row-act">' +
      (gone ? "" : '<button class="w-btn ghost sm" data-w-act="immerror:' + esc(i.immunizationId) + '">' + ms("undo") + "Wrong entry</button>") +
      "</div></li>";
  }
  function immunizationsView(state) {
    if (!state.sel) return '<div class="w-card"><p class="w-empty">Open a patient first.</p></div>';
    var d = state.immunizations;
    var list = d === null || d === undefined ? '<p class="w-empty">Loading immunizations.</p>'
      : d === false ? '<p class="w-hint warn">' + ms("warning") + "Could not load immunizations. This is not the same as none recorded.</p>"
      : (d.immunizations || []).length ? '<ul class="w-mini">' + d.immunizations.map(immunizationRow).join("") + "</ul>"
      : '<p class="w-empty">No immunizations recorded in this record. That is not a statement that the patient has had none.</p>';
    return '<div class="w-card">' +
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back">' + ms("arrow_back") + "</button>" +
      "<h3>Immunizations</h3>" +
      '<button class="w-ic" data-w-act="immunizations" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-sub"><h4>Record a vaccine</h4>' +
      '<input id="wImVac" placeholder="Vaccine, as written on the vial or card">' +
      '<div class="w-grid">' +
      '<label class="w-f"><span>Date given</span><input id="wImDate" type="date"></label>' +
      '<label class="w-f"><span>Dose number</span><input id="wImDose" inputmode="numeric"></label>' +
      '<label class="w-f"><span>Given or not</span><select id="wImStatus"><option value="completed">Given</option><option value="not-done">Not given</option></select></label>' +
      '<label class="w-f"><span>Reason, if not given</span><input id="wImReason"></label>' +
      '<label class="w-f"><span>Lot number</span><input id="wImLot"></label>' +
      '<label class="w-f"><span>Site</span><input id="wImSite" placeholder="e.g. left deltoid"></label>' +
      '<label class="w-f"><span>Route</span><input id="wImRoute" placeholder="e.g. intramuscular"></label>' +
      '<label class="w-f"><span>Given by (if not you)</span><input id="wImBy"></label>' +
      '<label class="w-f"><span>Code (optional)</span><input id="wImCode"></label>' +
      '<label class="w-f"><span>Code system</span><select id="wImSys"><option value="">none</option><option value="cvx">CVX</option><option value="snomed">SNOMED CT</option><option value="atc">ATC</option></select></label>' +
      "</div>" +
      '<label class="w-f" style="flex-direction:row;align-items:center"><input id="wImReported" type="checkbox" style="width:auto;margin:0 8px 0 0"><span>Reported by the patient or a card, not given here</span></label>' +
      '<button class="w-btn" data-w-act="immadd">' + ms("save") + "Record</button></div>" +
      list + "</div>";
  }

  function reportValue(v) {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v !== "object") return esc(v);
    if (Array.isArray(v)) {
      return v.length ? "<ul class=\"w-mini-flat\">" + v.map(function (item) { return "<li>" + reportValue(item) + "</li>"; }).join("") + "</ul>" : "none";
    }
    var keys = Object.keys(v);
    return keys.length ? "<ul class=\"w-mini-flat\">" + keys.map(function (k) { return "<li><b>" + esc(k) + ":</b> " + reportValue(v[k]) + "</li>"; }).join("") + "</ul>" : "none";
  }
  function reportsView(state) {
    var r = state.reports || {};
    var sections = Object.keys(REPORT_LABELS).map(function (key) {
      var rep = r[key];
      if (!rep) return "";
      if (!rep.ok) return '<div class="w-sub"><h4>' + esc(REPORT_LABELS[key]) + "</h4><p class=\"w-empty\">Could not load: " + esc(rep.detail || rep.error || "unknown error") + "</p></div>";
      var body = Object.keys(rep).filter(function (k) { return ["ok", "mode", "tenantId", "dataSource", "period", "filters", "generatedAt", "scope"].indexOf(k) < 0; })
        .map(function (k) { var v = rep[k]; return "<li><b>" + esc(k) + ":</b> " + reportValue(v) + "</li>"; }).join("");
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

  /* Incident reporting: file -> triage -> RCA -> CAPA -> close (functions/_wardsynq/incidents.js,
   * wardsynq/wardsynq-incidents.js). The engine side of this has held a careful lifecycle since it
   * was written - near-miss as a first-class report, an RCA that refuses "human error" as a root
   * cause, a CAPA that refuses education-only actions - and NOTHING ON SCREEN EVER CALLED IT. Every
   * one of the 159 demonstration staff, including safety_officer whose entire job this is, had no
   * way to file or investigate an incident anywhere in the product. This is the front door.
   *
   * FILING IS BROAD; INVESTIGATING IS NOT (same split the route table already enforces). The filing
   * form below is shown to anyone who reaches this screen at all (incident.report is the tile's own
   * gate); the ledger under it only ever populates for incident.investigate - loadIncidents() reads
   * it silently, like the co-sign worklist, because a reporter lacking that cap is not a reporter
   * doing anything wrong and must never see their own filing refused for a screen they didn't ask
   * to open. */
  var INCIDENT_SEVERITY = [
    ["near-miss", "Near miss - caught before it reached the patient"], ["no-harm", "Reached the patient, no harm"],
    ["minor", "Minor harm"], ["moderate", "Moderate harm"], ["major", "Major harm"],
    ["catastrophic", "Catastrophic - death or permanent severe harm"],
  ];
  var INCIDENT_LIKELIHOOD = [["rare", "Rare"], ["unlikely", "Unlikely"], ["possible", "Possible"], ["likely", "Likely"], ["frequent", "Frequent"]];
  var INCIDENT_STRENGTH = [
    ["", "Let the record infer it"], ["FORCING_FUNCTION", "Forcing function or constraint: the error becomes impossible"],
    ["AUTOMATION", "Automation or computerisation"], ["SIMPLIFICATION", "Simplification or standardisation"],
    ["CHECKLIST", "Checklist or independent verification"], ["EDUCATION", "Education, training or reminder"],
  ];
  var INCIDENT_CATEGORY = [
    ["fall", "Fall"], ["medication-error", "Medication error"], ["pressure-injury", "Pressure injury"],
    ["healthcare-associated-infection", "Healthcare-associated infection"], ["patient-identification", "Patient identification"],
    ["blood-transfusion", "Blood or transfusion"], ["clinical-procedure", "Clinical procedure"], ["diagnosis-or-result", "Diagnosis or result"],
    ["deterioration-not-recognised", "Deterioration not recognised"], ["medical-device", "Medical device"], ["documentation", "Documentation"],
    ["behaviour-or-violence", "Behaviour or violence"], ["other", "Other"],
  ];
  var INCIDENT_STAGE = { signal: "signal", confirmed: "confirmed", rejected: "rejected", "under-investigation": "under investigation", closed: "closed" };
  function categoryOptions(first) {
    return '<option value="">' + esc(first) + "</option>" + INCIDENT_CATEGORY.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(c[1]) + "</option>"; }).join("");
  }
  function categoryLabel(v) { for (var i = 0; i < INCIDENT_CATEGORY.length; i++) if (INCIDENT_CATEGORY[i][0] === v) return INCIDENT_CATEGORY[i][1]; return v ? v : "no category"; }
  function incidentRow(inc) {
    var stage = inc.stage || "signal";
    var capaRows = (inc.capas || []).map(function (c) {
      return '<li class="w-mini-row"><div><span class="w-st ' + esc(c.state === "complete" ? "" : "due") + '">' + esc(c.state) + "</span> " +
        esc(c.action) + " &middot; " + esc(c.owner) + " &middot; due " + esc(c.dueBy) +
        (c.strengthLabel ? '<div class="w-dt-times">' + esc(c.strengthLabel) + (c.weak ? " - weak on its own" : "") + "</div>" : "") +
        (c.state === "complete" ? '<div class="w-dt-times">completed by ' + esc(c.completedBy) + ": " + esc(c.evidence) + "</div>" : "") + "</div>" +
        (c.state !== "complete"
          ? '<div class="w-mini-row-act"><input id="wIncCapaBy_' + esc(c.id) + '" placeholder="Your name" style="width:110px">' +
            '<input id="wIncCapaEvidence_' + esc(c.id) + '" placeholder="What shows it is done">' +
            '<button class="w-btn ghost sm" data-w-act="incidentcapacomplete:' + esc(inc.id) + "~" + esc(c.id) + '">' + ms("task_alt") + "Complete</button></div>"
          : "") + "</li>";
    }).join("");
    /* CONFIRM: only a signal is decided, and only an investigator's decision is accepted by the server.
     * RCA and actions appear once it is confirmed; a rejected signal offers nothing further. */
    var confirmForm = stage === "signal"
      ? '<div class="w-sub"><h4>Confirm or reject this signal</h4>' +
        '<select id="wIncOutcome_' + esc(inc.id) + '"><option value="">Decision…</option><option value="confirmed">Confirmed incident</option><option value="not-an-incident">Not an incident</option><option value="duplicate">Duplicate of another report</option></select>' +
        '<select id="wIncConfCat_' + esc(inc.id) + '">' + categoryOptions(inc.category ? "Keep: " + categoryLabel(inc.category) : "Category (needed to confirm)…") + "</select>" +
        '<input id="wIncDupOf_' + esc(inc.id) + '" placeholder="Duplicate of incident id (for a duplicate)">' +
        '<input id="wIncConfReason_' + esc(inc.id) + '" placeholder="Reason for the decision">' +
        '<button class="w-btn ghost" data-w-act="incidentconfirm:' + esc(inc.id) + '">' + ms("fact_check") + "Record decision</button></div>"
      : "";
    var next = inc.state === "reported" && stage !== "rejected"
      ? '<div class="w-sub"><h4>Triage</h4><select id="wIncLk_' + esc(inc.id) + '"><option value="">Likelihood of recurrence…</option>' +
        INCIDENT_LIKELIHOOD.map(function (l) { return '<option value="' + esc(l[0]) + '">' + esc(l[1]) + "</option>"; }).join("") + "</select>" +
        '<button class="w-btn ghost" data-w-act="incidenttriage:' + esc(inc.id) + '">' + ms("fact_check") + "Triage</button></div>"
      : "";
    var rcaForm = stage === "confirmed"
      ? '<div class="w-sub"><h4>Root cause analysis</h4>' +
        '<textarea id="wIncRoot_' + esc(inc.id) + '" rows="2" placeholder="What about the system made this error easy, likely or invisible - not who made it"></textarea>' +
        '<input id="wIncMethod_' + esc(inc.id) + '" placeholder="Method (optional, e.g. 5 whys, fishbone)">' +
        '<input id="wIncFactors_' + esc(inc.id) + '" placeholder="Contributing factors, comma-separated (optional)">' +
        '<button class="w-btn ghost" data-w-act="incidentrca:' + esc(inc.id) + '">' + ms("fact_check") + "Record RCA</button></div>"
      : "";
    var capaAdd = (inc.state === "investigating" || inc.state === "actions-open")
      ? '<div class="w-sub"><h4>Add a corrective or preventive action</h4>' +
        '<input id="wIncCapaAction_' + esc(inc.id) + '" placeholder="What will change">' +
        '<input id="wIncCapaOwner_' + esc(inc.id) + '" placeholder="Owner">' +
        '<input id="wIncCapaDue_' + esc(inc.id) + '" type="date">' +
        '<select id="wIncCapaStrength_' + esc(inc.id) + '">' + INCIDENT_STRENGTH.map(function (s) { return '<option value="' + esc(s[0]) + '">' + esc(s[1]) + "</option>"; }).join("") + "</select>" +
        '<button class="w-btn ghost" data-w-act="incidentcapaadd:' + esc(inc.id) + '">' + ms("add") + "Add action</button></div>"
      : "";
    return '<li class="w-mini-row"><div>' +
      '<span class="w-st ' + esc(stage === "closed" || stage === "rejected" ? "" : inc.severity === "catastrophic" || inc.severity === "major" ? "escalate" : "due") + '">' + esc(INCIDENT_STAGE[stage] || stage) + "</span> " +
      "<b>" + esc(inc.severity) + "</b> &middot; " + esc(categoryLabel(inc.category)) + (inc.sac ? " &middot; SAC " + esc(inc.sac.sac) + " - " + esc(inc.sac.response) : "") +
      (inc.anonymous ? " &middot; anonymous" : "") +
      '<div class="w-dt-times">' + esc(inc.what) + "</div>" +
      '<div class="w-dt-times">reported ' + when(inc.reportedAt) + (inc.patientId ? " &middot; patient " + esc(inc.patientId) : "") + "</div>" +
      (inc.source ? '<div class="w-dt-times">raised from ' + esc(inc.source.resourceType) + " " + esc(inc.source.id) + "</div>" : "") +
      (inc.confirmation ? '<div class="w-dt-times">decision: ' + esc(inc.confirmation.outcome) + (inc.confirmation.duplicateOf ? " of " + esc(inc.confirmation.duplicateOf) : "") + " - " + esc(inc.confirmation.reason) + "</div>" : "") +
      (inc.rca ? '<div class="w-dt-times">root cause: ' + esc(inc.rca.rootCause) + "</div>" : "") +
      (capaRows ? "<ul class=\"w-mini\">" + capaRows + "</ul>" : "") + confirmForm + next + rcaForm + capaAdd +
      '</div><div class="w-mini-row-act">' +
      (stage === "confirmed" || stage === "under-investigation" ? '<button class="w-btn ghost sm" data-w-act="incidentclose:' + esc(inc.id) + '">' + ms("done_all") + "Attempt close</button>" : "") +
      "</div></li>";
  }
  function incidentsView(state) {
    var h = state.incidentHealth;
    var healthBlock = h
      ? '<div class="w-sub"><h4>Reporting health</h4><p>' + esc(h.reading) + "</p>" +
        "<p>" + esc(h.signals) + " signals &middot; " + esc(h.confirmed) + " confirmed &middot; " + esc(h.rejected) + " rejected &middot; " +
        esc(h.withRootCause) + " with a root cause &middot; " + esc(h.completedCapas) + " actions completed</p>" +
        "<p>" + esc(h.total) + " total &middot; " + esc(h.openCapas) + " open actions" +
        (h.overdueCapas && h.overdueCapas.length ? " &middot; " + esc(h.overdueCapas.length) + " overdue" : "") +
        (h.actionReading ? " &middot; " + esc(h.actionReading) : "") + "</p></div>"
      : "";
    var log = (state.incidentLog || []).map(incidentRow).join("");
    return '<div class="w-card"><div class="w-card-h">' + ms("report") + "<h3>Safety and incidents</h3>" +
      '<button class="w-ic" data-w-act="incidents" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-sub"><h4>Report an incident</h4>' +
      '<textarea id="wIncWhat" rows="2" placeholder="What happened, in your own words"></textarea>' +
      '<select id="wIncSeverity"><option value="">What actually reached the patient…</option>' +
      INCIDENT_SEVERITY.map(function (s) { return '<option value="' + esc(s[0]) + '">' + esc(s[1]) + "</option>"; }).join("") + "</select>" +
      '<input id="wIncWhen" type="datetime-local" placeholder="When (optional, default now)">' +
      '<input id="wIncPatient" placeholder="Patient MRN (optional)">' +
      '<select id="wIncCategory">' + categoryOptions("What kind of event (optional)…") + "</select>" +
      '<label class="w-f" style="flex-direction:row;align-items:center"><input id="wIncAnon" type="checkbox" style="width:auto;margin:0 8px 0 0"><span>File anonymously</span></label>' +
      '<p class="w-hint">' + ms("info") + "A named report defaults to you; anonymous means exactly that - nobody, including the record, is told who filed it." +
      "</p><button class=\"w-btn\" data-w-act=\"incidentreport\">" + ms("outbox") + "Report</button></div>" +
      (state.incidentLog !== null
        ? (healthBlock + (log ? "<ul class=\"w-mini\">" + log + "</ul>" : '<p class="w-empty">No incidents on the ledger.</p>'))
        : "") +
      "</div>";
  }

  /* P1.14 QUALITY AND SAFETY (functions/_wardsynq/quality.js qualitySafetyReport). Every measure shows its
   * numerator, denominator and period, and opens the case list behind it. Loading, failed and not
   * computable are three different screens: none of them is a zero. */
  var QS_PERIODS = [7, 30, 90, 365];
  function qsValue(m) {
    if (!m.computable) return '<p class="w-hint warn">' + ms("help") + "Not computable: " + esc(m.reason) + "</p>";
    var parts = [];
    if (m.unit === "days" || m.unit === "minutes") {
      if (!m.denominator) return '<p class="w-hint">' + ms("info") + "No cases in this period.</p>";
      parts.push("median " + esc(m.median) + " " + esc(m.unit) + ", mean " + esc(m.mean) + " over " + esc(m.denominator));
      if (m.excludedMissingTimestamp) parts.push(esc(m.excludedMissingTimestamp) + " excluded: missing a timestamp");
    } else if (m.rate === null) {
      parts.push(esc(m.numerator) + " of " + esc(m.denominator) + " - no rate: " + esc(m.note || "no cases in this period"));
    } else if (m.unit === "per 1000 bed-days") {
      parts.push("<b>" + esc(m.rate) + "</b> per 1000 bed-days (" + esc(m.numerator) + " over " + esc(m.denominator) + " bed-days)");
    } else {
      parts.push("<b>" + esc(Math.round(m.rate * 1000) / 10) + "%</b> (" + esc(m.numerator) + " of " + esc(m.denominator) + ")");
    }
    if (m.excluded) parts.push(esc(m.excluded) + " excluded");
    if (m.stillRunning) parts.push(esc(m.stillRunning) + " bundle(s) still running, not counted");
    if (m.woundRecords != null) parts.push(esc(m.woundRecords) + " hospital-acquired stage 2+ pressure wound record(s), shown beside the rate");
    return "<p>" + parts.join(" &middot; ") + "</p>" + (m.note2 ? '<p class="w-hint">' + ms("info") + esc(m.note2) + "</p>" : "");
  }
  function qsCases(m) {
    var list = (m.cases || []).concat(m.woundCases || []);
    if (!list.length) return '<p class="w-empty">No cases behind this measure in the period.</p>';
    return '<ul class="w-mini">' + list.map(function (c) {
      return '<li class="w-mini-row"><div>' + esc(c.id) + (c.patientId ? " &middot; patient " + esc(c.patientId) : "") +
        (c.minutes != null ? " &middot; " + esc(c.minutes) + " min" : "") + (c.bedDays != null ? " &middot; " + esc(c.bedDays) + " bed-days" : "") +
        (c.day ? " &middot; " + esc(c.day) : "") + (c.stage ? " &middot; stage " + esc(c.stage) : "") + "</div></li>";
    }).join("") + "</ul>";
  }
  function qualitySafetyView(state) {
    var q = state.qs, days = state.qsDays || 30;
    var head = '<div class="w-card"><div class="w-card-h">' + ms("query_stats") + "<h3>Quality and safety</h3>" +
      '<button class="w-ic" data-w-act="qsdays:' + esc(days) + '" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-tools">' + QS_PERIODS.map(function (d) {
        return '<button class="w-btn ' + (d === days ? "" : "ghost ") + 'sm" data-w-act="qsdays:' + d + '">Last ' + d + " days</button>";
      }).join("") + "</div>";
    if (!q || q.busy) return head + '<p class="w-empty">Loading measures...</p></div>';
    if (!q.ok) {
      return head + '<p class="w-hint warn">' + ms("error") + (q.status === 403
        ? "Your role cannot read quality measures (analytics rights needed)."
        : "The measures could not be loaded. Do not read this as nothing to report.") + "</p></div>";
    }
    if (q.skipped) return head + '<p class="w-hint">' + ms("info") + "The WardSynQ record is not switched on for this hospital, so there is nothing to measure.</p></div>";
    var s = q.safety;
    var safety = s
      ? '<div class="w-sub"><h4>Safety pipeline</h4><ul class="w-mini">' +
        "<li><b>Signals awaiting a decision</b><span>" + esc(s.signals) + "</span></li>" +
        "<li><b>Confirmed incidents</b><span>" + esc(s.confirmed) + "</span></li>" +
        "<li><b>Rejected or duplicate</b><span>" + esc(s.rejected) + "</span></li>" +
        "<li><b>Confirmed, with a root cause recorded</b><span>" + esc(s.withRootCause) + "</span></li>" +
        "<li><b>Corrective actions open</b><span>" + esc(s.capasOpen) + "</span></li>" +
        "<li><b>Corrective actions completed</b><span>" + esc(s.capasCompleted) + "</span></li></ul></div>"
      : '<p class="w-hint warn">' + ms("error") + "Incident records could not be read with your role, so the safety pipeline is not shown.</p>";
    var rows = (q.measures || []).map(function (m) {
      var open = state.qsOpen === m.id;
      return '<li class="w-mini-row"><div><h4>' + esc(m.title) + "</h4>" + qsValue(m) + (open ? qsCases(m) : "") + "</div>" +
        (m.computable ? '<div class="w-mini-row-act"><button class="w-btn ghost sm" data-w-act="qscases:' + esc(m.id) + '">' + ms("list") + (open ? "Hide cases" : "Cases") + "</button></div>" : "") + "</li>";
    }).join("");
    return head + '<p class="w-hint">' + ms("info") + esc(String(q.period && q.period.from || "").slice(0, 10)) + " to " + esc(String(q.period && q.period.to || "").slice(0, 10)) +
      ". Measures of the system; case lists name records and patients, never a clinician. Definitions: functions/_wardsynq/quality.js.</p>" +
      safety + (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No measures returned.</p>') + "</div>";
  }

  /* P2.10 TRENDS (functions/_wardsynq/trends.js), reached from the digital twin. A metric over time, then
   * one bucket by ward, then the record ids behind one ward. `data` is null while loading and false when it
   * failed; a bucket the server could not compute has a null value and is drawn as a GAP in the line and
   * written out in the table with its reason, never plotted as zero. */
  var TREND_BUCKETS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
  function trendValue(p, unit) {
    if (p.value == null) return null;
    var v = unit === "%" ? Math.round(p.value * 1000) / 10 + "%" : esc(p.value) + (unit === "amount" ? "" : " " + esc(unit));
    return p.p90 != null ? "median " + v + ", p90 " + esc(p.p90) + " " + esc(unit) : v;
  }
  function trendCell(p, unit) {
    var v = trendValue(p, unit);
    return (v != null ? "<b>" + v + "</b>" : '<span class="w-hint warn">no value: ' + esc(p.reason || "not known") + "</span>") +
      (p.numerator != null || p.denominator != null ? " <small>(" + esc(p.numerator == null ? "-" : p.numerator) + (p.denominator != null ? " / " + esc(p.denominator) : "") + ")</small>" : "") +
      (p.unacknowledged ? " <small>" + esc(p.unacknowledged) + " unacknowledged</small>" : "") +
      (p.excluded ? " <small>" + esc(p.excluded) + " excluded</small>" : "") +
      (p.pending ? " <small>" + esc(p.pending) + " pending</small>" : "") +
      (p.byCategory ? " <small>" + esc(Object.keys(p.byCategory).map(function (k) { return k + " " + p.byCategory[k]; }).join(", ")) + "</small>" : "") +
      (p.coverage === "partial" ? ' <span class="w-st due">' + (p.inProgress ? "in progress" : "partial") + "</span>" : "");
  }
  function trendChart(points, unit) {
    var W = 600, H = 160, vals = points.map(function (p) { return p.value; }).filter(function (v) { return typeof v === "number"; });
    if (!vals.length) return '<p class="w-hint warn">' + ms("warning") + "No bucket in this range has a value, so there is nothing to draw. The table below says why for each one.</p>";
    var hi = Math.max.apply(null, vals.concat([0])) || 1, n = points.length, segs = [], seg = [], dots = "";
    points.forEach(function (p, i) {
      if (typeof p.value !== "number") { if (seg.length) segs.push(seg); seg = []; return; }
      var x = n > 1 ? (i / (n - 1)) * (W - 20) + 10 : W / 2, y = H - 10 - (p.value / hi) * (H - 20);
      seg.push(x.toFixed(1) + "," + y.toFixed(1));
      dots += '<circle r="4" fill="currentColor" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" data-w-act="trendbucket:' + i + '"><title>' + esc(p.label) + ": " + esc(p.value) + "</title></circle>";
    });
    if (seg.length) segs.push(seg);
    var lines = segs.map(function (s) { return s.length > 1 ? '<polyline class="w-trend-line" fill="none" stroke="currentColor" stroke-width="2" points="' + s.join(" ") + '"/>' : ""; }).join("");
    return '<div style="overflow-x:auto"><svg class="w-trend" width="100%" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="trend, ' + esc(unit) + '">' +
      '<line x1="0" y1="' + (H - 10) + '" x2="' + W + '" y2="' + (H - 10) + '" stroke="currentColor" stroke-opacity="0.2"/>' + lines + dots + "</svg></div>" +
      '<p class="w-dt-times">0 to ' + esc(unit === "%" ? Math.round(hi * 1000) / 10 + "%" : hi + " " + unit) + ". A break in the line is a bucket with no value, not a zero.</p>";
  }
  function trendsView(state) {
    var t = state.trends || {}, d = t.data;
    var metrics = t.metrics || [{ id: t.metric, title: t.metric }];
    var head = '<div class="w-chart-h"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
      "<div><b>Trends</b><small>hospital-wide, over time</small></div>" +
      '<button class="w-ic" data-w-act="trendsload" title="Refresh">' + ms("refresh") + "</button></div>" +
      '<div class="w-card"><div class="w-filter">' +
      '<select id="wTrMetric" aria-label="Metric">' + metrics.map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === t.metric ? " selected" : "") + ">" + esc(m.title) + (m.finance ? " (billing)" : "") + "</option>"; }).join("") + "</select>" +
      '<input id="wTrFrom" type="date" aria-label="From" value="' + esc(t.from || "") + '">' +
      '<input id="wTrTo" type="date" aria-label="To" value="' + esc(t.to || "") + '">' +
      '<select id="wTrBucket" aria-label="Bucket">' + TREND_BUCKETS.map(function (b) { return '<option value="' + b[0] + '"' + (b[0] === t.bucket ? " selected" : "") + ">" + b[1] + "</option>"; }).join("") + "</select>" +
      '<button class="w-btn" data-w-act="trendsload">' + ms("query_stats") + "Show</button></div></div>";
    if (d === null || d === undefined) return head + '<p class="w-empty">Loading the trend&hellip;</p>';
    if (d === false) {
      return head + '<p class="w-hint warn">' + ms("error") + (t.status === "billing_view_required" ? "This is a billing series and your role has no billing rights."
        : t.status === 403 ? "Your role cannot read this trend." : "The trend could not be loaded" + (t.err ? ": " + esc(t.err) : "") + ".") +
        " Do not read this as zero.</p>";
    }
    var def = d.definition || {}, unit = def.unit || "";
    var points = (d.series && d.series[0] && d.series[0].points) || [];
    var how = '<details class="w-card"><summary>' + ms("help") + "How this is counted</summary><ul class=\"w-mini\">" +
      "<li><b>Numerator</b><span>" + esc(def.numerator) + "</span></li><li><b>Denominator</b><span>" + esc(def.denominator) + "</span></li>" +
      "<li><b>Included</b><span>" + esc(def.inclusion) + "</span></li><li><b>Excluded</b><span>" + esc(def.exclusion) + "</span></li>" +
      "<li><b>Ward</b><span>" + esc(def.wardAttribution) + "</span></li>" +
      "<li><b>Clock</b><span>" + esc(d.range && (d.range.timeZone || "UTC offset " + d.range.utcOffsetMinutes + " minutes")) + "</span></li></ul></details>";
    var warn = (d.warning ? '<p class="w-hint warn">' + ms("warning") + esc(d.warning) + "</p>" : "") +
      (d.unreadable && d.unreadable.length ? '<p class="w-hint warn">' + ms("block") + "Not readable: " + esc(d.unreadable.join(", ")) + ". Buckets that need them have no value.</p>" : "");
    var rows = points.map(function (p, i) {
      return "<tr><td>" + esc(p.label) + "</td><td>" + trendCell(p, unit) + "</td><td>" +
        (p.value != null || p.numerator ? '<button class="w-btn ghost tiny" data-w-act="trendbucket:' + i + '">By ward</button>' : "") + "</td></tr>";
    }).join("");
    var main = '<div class="w-card"><div class="w-card-h">' + ms("query_stats") + "<h3>" + esc(def.title) + "</h3></div>" +
      (points.length ? trendChart(points, unit) + '<div style="overflow-x:auto"><table class="w-tbl"><thead><tr><th>Bucket</th><th>Value (numerator / denominator)</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<p class="w-empty">No buckets in this range.</p>') + "</div>";
    return head + warn + main + trendWardHtml(t, unit) + trendEventsHtml(t) + detailPanel(state) + how;
  }
  function trendWardHtml(t, unit) {
    var w = t.ward; if (!w) return "";
    var h = '<div class="w-card"><div class="w-card-h">' + ms("bed") + "<h3>By ward: " + esc(w.label) + "</h3>" +
      '<button class="w-ic" data-w-act="trendwardclose" title="Close">' + ms("close") + "</button></div>";
    if (w.data === null) return h + '<p class="w-empty">Loading the wards&hellip;</p></div>';
    if (w.data === false) return h + '<p class="w-hint warn">' + ms("error") + "The ward breakdown could not be loaded" + (w.err ? ": " + esc(w.err) : "") + ". Do not read this as zero.</p></div>";
    var rows = (w.data.series || []).map(function (s, i) {
      var p = (s.points || []).filter(function (x) { return x.key === w.key; })[0];
      if (!p) return "";
      return "<tr><td>" + esc(s.group) + "</td><td>" + trendCell(p, unit) + "</td><td>" +
        (p.value != null || p.numerator ? '<button class="w-btn ghost tiny" data-w-act="trendevents:' + i + '">Records</button>' : "") + "</td></tr>";
    }).join("");
    return h + (rows ? '<div style="overflow-x:auto"><table class="w-tbl"><thead><tr><th>Ward</th><th>Value</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
      : '<p class="w-empty">No ward had anything in this bucket.</p>') + "</div>";
  }
  function trendEventsHtml(t) {
    var e = t.events; if (!e) return "";
    var h = '<div class="w-card"><div class="w-card-h">' + ms("list") + "<h3>Records: " + esc(e.ward) + "</h3>" +
      '<button class="w-ic" data-w-act="trendeventsclose" title="Close">' + ms("close") + "</button></div>";
    if (e.data === null) return h + '<p class="w-empty">Loading the records&hellip;</p></div>';
    if (e.data === false) return h + '<p class="w-hint warn">' + ms("error") + (e.status === 403 ? "You do not have access to this ward's records." : "The records could not be loaded" + (e.err ? ": " + esc(e.err) : "") + ".") + "</p></div>";
    var ev = e.data.events || { items: [] };
    var rows = ev.items.map(function (x) {
      /* G7: a stay ward by ward, each piece with its length. A running piece says so rather than showing a length. */
      var segs = x.segments ? '<div class="w-dt-times">' + (x.transferred ? "Transferred: " : "One ward: ") + x.segments.map(function (g) {
        return esc(g.ward || "(no ward)") + (g.bed ? " bed " + esc(g.bed) : "") + " " + esc(g.days) + " day" + (g.days === 1 ? "" : "s") + (g.running ? " so far (still there)" : "");
      }).join(", then ") + "</div>" : "";
      return '<li class="w-mini-row"><div>' + esc(x.resourceType) + " &middot; " + esc(x.id) + segs + '</div><div class="w-mini-row-act"><button class="w-btn ghost sm" data-w-act="timelinedetail:' + esc(x.resourceType) + "~" + esc(x.id) + '">Open</button></div></li>';
    }).join("");
    return h + (rows ? '<ul class="w-mini">' + rows + "</ul>" : '<p class="w-empty">No records behind this bucket on this ward.</p>') +
      (ev.truncated ? '<p class="w-hint warn">Showing ' + esc(ev.items.length) + " of " + esc(ev.total) + ", or the read was capped. The list is not complete.</p>" : "") + "</div>";
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
      '<div class="w-dt-bar w-noprint"><button class="w-ic" data-w-act="back" aria-label="Back">' + ms("arrow_back") + "</button>" +
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
    return '<div class="w-shell"><header class="w-top"><button class="w-ic" data-w-act="close" aria-label="Close the ward">' + ms("close") + "</button>" +
      '<span class="w-title">WardSynQ &middot; Inpatient</span>' +
      /* A demonstration hospital says so on the chart itself. Demo and real records are separate
       * tenants, but that separation is invisible to somebody reading a screen over a shoulder, and
       * a fabricated patient that reads as a real one is the whole hazard. */
      (state.demo ? '<span class="w-demo" title="Fabricated patients, for demonstration. Nothing here is a real person or a real clinical record.">DEMO</span>' : "") +
      (state.busy ? '<span class="w-busy">' + ms("progress_activity") + "</span>" : "<span></span>") +
      '<button class="w-ic" data-w-act="keys" aria-label="Keyboard shortcuts" aria-keyshortcuts="?">' + ms("keyboard") + "</button></header>" +
      '<div class="w-canvas">' + banner(state) + offlineBar(state) +
      (state.view === "offline" ? offlineView(state)
        : state.view === "chart" ? chartView(state)
        : state.view === "downtime" ? downtimeView(state)
        : state.view === "reports" ? reportsView(state)
        : state.view === "purchasing" ? purchasingView(state)
        : state.view === "approvals" ? approvalsView(state)
        : state.view === "patientsurgery" ? patientSurgeryView(state)
        : state.view === "tags" ? tagsView(state)
        : state.view === "mpi" ? mpiView(state)
        : state.view === "documents" ? documentsView(state)
        : state.view === "forms" ? formsView(state)
        : state.view === "nurseworklist" ? nurseWorklistView(state)
        : state.view === "surveillance" ? surveillanceView(state)
        : state.view === "nursingpatient" ? nursingPatientView(state)
        : state.view === "referrals" || state.view === "referralinbox" ? referralsView(state)
        : state.view === "infusions" ? infusionView(state)
        : state.view === "careplan" ? carePlanView(state)
        : state.view === "pathways" ? pathwaysView(state)
        : state.view === "specialty" ? specialtyView(state)
        : state.view === "admreqs" ? admReqView(state)
        : state.view === "ordersets" ? orderSetsView(state)
        : state.view === "breakglass" ? breakGlassView(state)
        : state.view === "wounds" ? woundView(state)
        : state.view === "risks" ? riskView(state)
        : state.view === "medrec" ? medRecView(state)
        : state.view === "handover" ? handoverView(state)
        : state.view === "safetyinbox" ? safetyInboxView(state)
        : state.view === "workspace" ? workspaceView(state)
        : state.view === "people" ? peopleView(state)
        : state.view === "immunizations" ? immunizationsView(state)
        : state.view === "consultation" ? consultationView(state)
        : state.view === "incidents" ? incidentsView(state)
        : state.view === "qualitysafety" ? qualitySafetyView(state)
        : state.view === "emergencyadmin" ? emergencyAdminView(state)
        : state.view === "pcopy" ? pcopyView(state)
        : state.view === "consent" ? consentView(state)
        : state.view === "ips" ? ipsView(state)
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
        : state.view === "trends" ? trendsView(state)
        : state.view === "scheduling" ? schedulingView(state)
        : state.view === "cashier" ? cashierView(state)
        : listView(state)) + "</div></div>";
  }

  // ---- controller --------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdWard"); if (!el) { el = document.createElement("div"); el.id = "smdWard"; document.body.appendChild(el); } return el; }
  function paint() {
    var sy = (typeof window !== "undefined" && window.scrollY != null) ? window.scrollY : 0;
    var el = root();
    el.innerHTML = _render(st);
    /* Focus is deliberately NOT restored to the pressed button after a repaint: a second Enter would
     * then repeat a write, and a reloaded round can put a different dose at the same index. */
    markShortcuts(el);
    if (typeof window !== "undefined" && sy > 0) {
      window.scrollTo(0, sy);
    }
  }

  function loadWard() {
    st.busy = true; paint();
    return apiGet("/ward/list?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { if (settle(r)) { st.patients = r.patients || []; if (r.region) st.region = r.region; } st.loaded = true; paint(); return Promise.all([loadCosigns(), loadQuality(), loadOverrides(), loadExceptions(), loadEmergencyStatus(), loadWardMetrics()]); })
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
    edArrive({ unknown: { sex: sex, isTrauma: checked("wEdIsTrauma") }, chiefComplaint: cc || undefined });
  }
  function recordTriage() {
    var s = st.sel; if (!s) return;
    var acuity = val("wTriageAcuity");
    if (!acuity) { st.err = "Choose an acuity level."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/ed-triage", { orgId: st.orgId, encounterId: s.encounterId, acuity: Number(acuity) })
      .then(function (r) {
        if (settle(r, "Triaged.")) { s.acuity = Number(acuity); s.triagedAt = new Date().toISOString(); paint(); loadEdRecord(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record triage."; paint(); });
  }
  function recordRetriage() {
    var s = st.sel; if (!s) return;
    var acuity = val("wRetriageAcuity"), reason = val("wRetriageReason");
    if (!acuity) { st.err = "Choose the acuity now."; paint(); return; }
    if (!reason) { st.err = "Say why this patient is being triaged again."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/ed-triage", { orgId: st.orgId, encounterId: s.encounterId, acuity: Number(acuity), reason: reason })
      .then(function (r) {
        if (settle(r, "Re-triage recorded.")) { s.acuity = Number(acuity); s.triagedAt = new Date().toISOString(); paint(); loadEdRecord(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record the re-triage."; paint(); });
  }
  /* The ED half of the chart: triage history, reassessment time, procedures. null while loading,
   * {failed:true} when it could not be read, so the cards can tell those apart from "none". */
  function loadEdRecord() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.edRecord = null;
    return apiGet("/ward/ed-record?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(s.encounterId))
      .then(function (r) { st.edRecord = r && r.ok ? r : { failed: true }; paint(); })
      .catch(function () { st.edRecord = { failed: true }; paint(); });
  }
  function edProcedureSave() {
    var s = st.sel; if (!s) return;
    var name = val("wProcName"), by = val("wProcBy"), at = val("wProcAt");
    if (!name) { st.err = "Say which procedure was done."; paint(); return; }
    if (!by) { st.err = "Say who performed it."; paint(); return; }
    var atMs = at ? new Date(at).getTime() : NaN;
    if (isNaN(atMs)) { st.err = "Say when it was done."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/ed-procedure", { orgId: st.orgId, encounterId: s.encounterId, procedure: {
      name: name, site: val("wProcSite"), performedBy: by, performedAt: new Date(atMs).toISOString(), notes: val("wProcNotes"), complications: val("wProcComp") } })
      .then(function (r) { if (settle(r, r && r.ok ? "Procedure recorded." : null)) loadEdRecord(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the procedure."; paint(); });
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
  function childDoseLimitCheck() {
    var mgkg = val("wLimMgKg"), weight = val("wAgeWeight"), adult = val("wLimAdult");
    /* Numbers only, never guessed: a mistyped weight is the commonest way a child's dose goes wrong. */
    var num = /^\d+(\.\d+)?$/;
    if (!num.test(mgkg)) { st.err = "Enter the mg per kg as a plain number."; paint(); return; }
    if (adult && !num.test(adult)) { st.err = "The adult maximum has to be a plain number, or left blank."; paint(); return; }
    st.limitResult = null; st.busy = true; paint();
    apiPost("/ward/dose-ceiling", {
      orgId: st.orgId, mgPerKg: Number(mgkg),
      weightKg: num.test(weight) ? Number(weight) : undefined,
      adultMaxMg: adult ? Number(adult) : undefined,
      band: st.ageBand && st.ageBand.band,
    })
      .then(function (r) { st.busy = false; if (r && r.ok) st.limitResult = r.result; else settle(r, null); paint(); })
      .catch(function () { st.busy = false; st.err = "Could not work out the maximum."; paint(); });
  }
  function resusWaive(bundleId, key) {
    var reason = "";
    try { reason = G.prompt("Why is this not appropriate for this patient?") || ""; } catch (e) { return; }
    if (!reason.trim()) { st.err = "A waiver needs a clinical reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/resus-waive", { orgId: st.orgId, bundleId: bundleId, key: key, reason: reason.trim() })
      .then(function (r) { if (settle(r, "Recorded as not appropriate.")) loadResus(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
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
      .then(function (r) { if (st.sel !== s) return; st.devices = (r && r.ok) ? (r.devices || []) : false; paint(); })
      .catch(function () { if (st.sel !== s) return; st.devices = false; paint(); });
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

  // ---- ICU bedside record (P1.12) -----------------------------------------------------------
  function loadIcu() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/icu?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { if (st.sel !== s) return; st.icu = (r && r.ok) ? r : false; paint(); })
      .catch(function () { if (st.sel !== s) return; st.icu = false; paint(); });
  }
  function icuAtValue() {
    var raw = val("wIcuAt"); if (!raw) return undefined;
    var d = new Date(raw); return isNaN(d.getTime()) ? "bad" : d.toISOString();
  }
  function icuRecord(kind, values, okMsg) {
    var s = st.sel; if (!s) return;
    var at = icuAtValue();
    if (at === "bad") { st.err = "The time is not a date."; paint(); return; }
    st.busy = true; paint();
    bedsideWrite("icu", { orgId: st.orgId, kind: kind, patientId: s.patientId, encounterId: s.encounterId, at: at || new Date().toISOString(), values: values },
      { label: "ICU " + kind, patientId: s.patientId },
      function (r) {
        if (r && !r.ok && r.error === "invalid_values") {
          st.busy = false;
          st.err = "Not recorded: " + (r.problems || []).map(function (p) { return p.field + " " + p.reason; }).join("; ") + ".";
          paint(); return;
        }
        if (settle(r, okMsg)) loadIcu(); else paint();
      }, "Could not record that.");
  }
  function icuAbg() {
    icuRecord("abg", { sampleType: val("wAbgType"), ph: val("wAbgPh"), pco2: val("wAbgPco2"), po2: val("wAbgPo2"), hco3: val("wAbgHco3"),
      baseExcess: val("wAbgBe"), lactate: val("wAbgLac"), fio2: val("wAbgFio2") }, "Blood gas recorded.");
  }
  function icuVent() {
    icuRecord("ventilator", { mode: val("wVentMode"), tidalVolumeMl: val("wVentVt"), rate: val("wVentRate"), peep: val("wVentPeep"), fio2: val("wVentFio2"),
      peakPressure: val("wVentPeak"), plateauPressure: val("wVentPlat") }, "Ventilator settings recorded.");
  }
  function icuSedation() {
    icuRecord("sedation", { rass: val("wSedRass"), targetLow: val("wSedLo"), targetHigh: val("wSedHi"), gcs: val("wSedGcs") }, "Sedation recorded.");
  }
  function icuRound() {
    var items = {};
    ((st.icu && st.icu.roundItems) || []).forEach(function (i) { var a = val("wRound_" + i.key); if (a) items[i.key] = a; });
    icuRecord("round", { items: items }, "Round recorded.");
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
      /* Where the woman is in pregnancy or the puerperium - "day 2 postpartum, haemorrhage risk is
       * highest now" - read from the obstetric engine rather than worked out on screen. */
      apiGet("/ward/maternity-status?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.status = r && r.ok ? r.status : null; st.maternity.statusFailed = !(r && r.ok); }, function () { st.maternity.statusFailed = true; }),
      apiGet("/ward/pregnancy-get?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.pregFailed = !(r && r.ok); if (r && r.ok) st.maternity.pregnancy = r.pregnancy; }),
      apiGet("/ward/meows?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.meows = r && r.ok ? r.meows : false; }, function () { st.maternity.meows = false; }),
      apiGet("/ward/blood-loss-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.losses = r && r.ok ? (r.losses || []) : false; }, function () { st.maternity.losses = false; }),
      apiGet("/ward/delivery-get?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.delivery = r && r.ok ? r.delivery : false; }, function () { st.maternity.delivery = false; }),
      apiGet("/ward/family-links?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)).then(function (r) { st.maternity.links = r && r.ok ? (r.links || []) : false; }, function () { st.maternity.links = false; }),
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
        st.busy = false;
        st.note = r.recognition && r.recognition.prompt
          ? "Recorded. " + r.recognition.reasons.join("; ") + (r.recognition.code ? " - consider starting " + r.recognition.code + "." : "")
          : "Recorded.";
        // Saved, but the deterioration check could not run: said as a warning, never as an all-clear.
        if (r.warning) st.err = r.warning;
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
      .then(function (r) { if (st.sel !== s) return; st.lines = (r && r.ok) ? (r.lines || []) : false; paint(); })
      .catch(function () { if (st.sel !== s) return; st.lines = false; paint(); });
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
      .then(function (r) { st.oncology = { timeline: r && r.ok ? r.timeline : null, warning: r && r.ok ? (r.warning || null) : "This history could not be loaded. Do not read it as empty." }; paint(); })
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
      .then(function (r) { st.cardiology = { timeline: r && r.ok ? r.timeline : null, warning: r && r.ok ? (r.warning || null) : "This history could not be loaded. Do not read it as empty." }; paint(); })
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
  function radStudyEntry(list, serviceRequestId) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].serviceRequestId === serviceRequestId) return list[i];
    return null;
  }
  function loadRadiologyStudies(target, query) {
    return apiGet("/ward/imaging-studies?orgId=" + encodeURIComponent(st.orgId) + "&" + query)
      .then(function (r) {
        if (r && r.ok) { target.studies = r.orders || []; target.templates = r.templates || []; target.studiesFailed = false; }
        else { target.studies = null; target.studiesFailed = true; }
        paint();
      })
      .catch(function () { target.studies = null; target.studiesFailed = true; paint(); });
  }
  function radTemplatePick(prefix) {
    var chosen = val(prefix + "Tpl");
    if (prefix === "wRadB") { if (st.radBoard) st.radBoard.templateId = chosen; }
    else { if (!st.radiology) st.radiology = {}; st.radiology.templateId = chosen; }
    paint();
  }
  function loadRadiology() {
    if (!st.radiology) st.radiology = {};
    paint();
    if (st.sel && st.sel.patientId) loadRadiologyStudies(st.radiology, "patientId=" + encodeURIComponent(st.sel.patientId));
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
    var tplPayload = radTemplatePayload(st.radiology.templates, st.radiology.templateId, "wRad");
    if (!findings && !tplPayload.templateId) { st.err = "Say what was seen; the impression may follow."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/report-imaging", Object.assign({ orgId: st.orgId, serviceRequestId: picked, modality: modality || undefined, status: status || "preliminary", findings: findings || undefined, impression: impression || undefined, critical: critical }, tplPayload))
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
  function maikHistory() {
    var sel = st.sel; if (!sel) return;
    st.maik = st.maik || {}; st.maik.history = { busy: true }; paint();
    apiGet("/ward/maik-interactions?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(sel.patientId))
      .then(function (r) { if (st.sel !== sel) return; st.maik.history = r && r.ok ? r : { ok: false }; paint(); })
      .catch(function () { if (st.sel !== sel) return; st.maik.history = { ok: false }; paint(); });
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
    st.view = "critsboard"; st.critsBoard = null; paint(); loadCritsBoard();
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
      .then(function (r) { st.critsBoard = (r && r.ok) ? (r.loops || []) : false; paint(); })
      .catch(function () { st.critsBoard = false; paint(); });
  }
  function acknowledgeBoard(loopId) {
    var why = ""; try { why = G.prompt("What did you do about this result?") || ""; } catch (e) {}
    if (!why.trim()) { st.err = "An acknowledgement records what was done. It needs a sentence."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/acknowledge", { orgId: st.orgId, loopId: loopId, action: why.trim() })
      /* Acknowledging reloads whichever list the person is actually looking at. The same action is
       * reachable from the criticals board and from the safety inbox, and reloading the board from
       * the inbox would leave the row the person just acted on still sitting there. */
      .then(function (r) {
        if (settle(r, "Acknowledged.")) {
          if (st.view === "safetyinbox") loadSafetyInbox(); else loadCritsBoard();
        } else paint();
      })
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
    /* A FAILED LOAD IS NOT "NO INVOICES". This used to set the list to empty on any failure, so a
     * cashier facing a network error was told the patient owed nothing - and may have let them leave.
     * The list is now null when it could not be read, and the screen says so. The unbilled charges and
     * the coding watchlist load alongside, each with the same rule. */
    var q = "orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.cashier.patientId);
    apiGet("/ward/charges?" + q)
      .then(function (r) { st.cashier.charges = r && r.ok ? r : { failed: true }; paint(); })
      .catch(function () { st.cashier.charges = { failed: true }; paint(); });
    apiGet("/ward/upcoding?" + q)
      .then(function (r) { st.cashier.watch = r && r.ok ? r : { failed: true }; paint(); })
      .catch(function () { st.cashier.watch = { failed: true }; paint(); });
    // Online payment links (owner S2). null = loading, false = could not be read: never "no links".
    st.cashier.payLinks = null;
    apiGet("/ward/payment-requests?" + q)
      .then(function (r) { st.cashier.payLinks = r && r.ok ? (r.requests || []) : false; paint(); })
      .catch(function () { st.cashier.payLinks = false; paint(); });
    return apiGet("/ward/invoices?" + q)
      .then(function (r) {
        if (r && r.ok) { st.cashier.invoices = r.invoices || []; st.cashier.outstandingBalance = r.outstandingBalance; st.cashier.invoicesFailed = false; }
        else { st.cashier.invoices = []; st.cashier.outstandingBalance = null; st.cashier.invoicesFailed = true; }
        paint();
      })
      .catch(function () { st.cashier.invoices = []; st.cashier.outstandingBalance = null; st.cashier.invoicesFailed = true; paint(); });
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
  /* A LINK IS NOT A PAYMENT. Asking for one records nothing on the bill; the bill is marked paid only
   * when the gateway's signed notice arrives and the gateway confirms it (payment-links.js). */
  function cashPayLink(invoiceId) {
    st.cashier.err = ""; st.busy = true; paint();
    apiPost("/ward/invoice-payment-link", { orgId: st.orgId, invoiceId: invoiceId })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) { loadCashier(); return; }
        st.cashier.err = (r && (r.message || r.detail || r.error)) || "No payment link was made.";
        paint();
      })
      .catch(function () { st.busy = false; st.cashier.err = "Could not reach the server. No payment link was made."; paint(); });
  }
  var CASH_ACTION_ROUTE = { pay: "invoice-payment", deposit: "invoice-deposit", discount: "invoice-discount", refund: "invoice-refund", adjust: "invoice-adjustment", writeoff: "invoice-writeoff" };
  function cashPost(invoiceId, kind) {
    var amount = val("wCashAmount"), reason = val("wCashReason"), reference = val("wCashReference");
    if (!amount || Number(amount) <= 0) { st.cashier.err = "Enter a positive amount."; paint(); return; }
    var route = CASH_ACTION_ROUTE[kind];
    st.cashier.err = ""; st.busy = true; paint();
    /* A payment or deposit carries HOW it was taken. The other actions (discount, refund,
     * adjustment, write-off) are not collections and carry nothing. */
    var body = { orgId: st.orgId, invoiceId: invoiceId, amount: Number(amount), reason: reason || undefined, reference: reference || undefined };
    if (kind === "pay" || kind === "deposit") {
      var method = st.cashMethod || "cash";
      var details = {};
      (CASH_METHOD_NEEDS[method] || []).forEach(function (f) { var v = val("wPay_" + f); if (v) details[f] = v; });
      body.method = method;
      body.paymentDetails = details;
    }
    apiPost("/ward/" + route, body)
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
  function trendsOpen() {
    var day = function (msAgo) { var x = new Date(Date.now() - msAgo); return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2); };
    st.view = "trends"; st.recordDetail = null;
    st.trends = { metric: "admissions", bucket: "day", from: day(29 * 86400000), to: day(0), data: null, ward: null, events: null };
    paint(); loadTrends();
  }
  function trendsPath(t) {
    return "/ward/trends?orgId=" + encodeURIComponent(st.orgId) + "&metric=" + encodeURIComponent(t.metric) +
      "&from=" + encodeURIComponent(t.from) + "&to=" + encodeURIComponent(t.to) + "&bucket=" + encodeURIComponent(t.bucket);
  }
  function trendFailure(target, r) {
    target.data = false;
    target.status = r && r.detail === "billing_view_required" ? "billing_view_required" : (r && (r.error === "forbidden" || r.error === "permission" || r.error === "out_of_scope")) ? 403 : null;
    target.err = (r && (r.message || r.detail || r.error)) || "no response";
  }
  function loadTrends() {
    var t = st.trends; if (!t) return;
    t.metric = val("wTrMetric") || t.metric; t.from = val("wTrFrom") || t.from; t.to = val("wTrTo") || t.to; t.bucket = val("wTrBucket") || t.bucket;
    t.data = null; t.ward = null; t.events = null; st.recordDetail = null; paint();
    apiGet(trendsPath(t))
      .then(function (r) { if (st.trends !== t) return; if (r && r.metrics) t.metrics = r.metrics; if (r && r.ok) t.data = r; else trendFailure(t, r); paint(); })
      .catch(function () { if (st.trends !== t) return; t.data = false; t.err = "Could not reach the server."; paint(); });
  }
  function trendBucket(i) {
    var t = st.trends, p = t && t.data && t.data.series && t.data.series[0] && t.data.series[0].points[i]; if (!p) return;
    var w = { key: p.key, label: p.label, data: null };
    t.ward = w; t.events = null; st.recordDetail = null; paint();
    apiGet(trendsPath(t) + "&groupBy=ward")
      .then(function (r) { if (t.ward !== w) return; if (r && r.ok) w.data = r; else trendFailure(w, r); paint(); })
      .catch(function () { if (t.ward !== w) return; w.data = false; w.err = "Could not reach the server."; paint(); });
  }
  function trendEventsLoad(i) {
    var t = st.trends, w = t && t.ward, s = w && w.data && w.data.series && w.data.series[i]; if (!s) return;
    var e = { ward: s.group, data: null };
    t.events = e; st.recordDetail = null; paint();
    apiGet("/ward/trend-events?orgId=" + encodeURIComponent(st.orgId) + "&metric=" + encodeURIComponent(t.metric) + "&from=" + encodeURIComponent(t.from) +
      "&to=" + encodeURIComponent(t.to) + "&bucket=" + encodeURIComponent(t.bucket) + "&key=" + encodeURIComponent(w.key) + "&ward=" + encodeURIComponent(s.group))
      .then(function (r) { if (t.events !== e) return; if (r && r.ok) e.data = r; else trendFailure(e, r); paint(); })
      .catch(function () { if (t.events !== e) return; e.data = false; e.err = "Could not reach the server."; paint(); });
  }
  function loadTwin() {
    if (!st.twin) st.twin = {};
    st.twin.copilot = null; st.twin.sim = null; st.twin.drill = null;
    return apiGet("/ward/twin?orgId=" + encodeURIComponent(st.orgId) + "&finance=1")
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
  /* A command-center row opens the chart through the SAME "open" path the ward list uses. A patient
   * not on the loaded list (the list may be filtered to one ward) is looked for hospital-wide once;
   * one who is on no inpatient list (an ED attendance, say) is told so, never opened half-filled. */
  function commandOpenChart(encounterId) {
    if (!encounterId) return;
    var onList = function () { for (var i = 0; i < (st.patients || []).length; i++) { if (st.patients[i].encounterId === encounterId) return true; } return false; };
    if (onList()) { dispatch("open:" + encounterId); return; }
    apiGet("/ward/list?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        if (r && r.ok && r.patients) { st.ward = ""; st.patients = r.patients; }
        if (onList()) { dispatch("open:" + encounterId); return; }
        st.err = "That patient is not on an inpatient ward list. Open the board for them instead."; paint();
      })
      .catch(function () { st.err = "Could not reach the ward list to open that chart."; paint(); });
  }
  function flowCommandOpen() {
    st.view = "flowcommand"; st.flow = {}; paint(); loadFlowCommand();
  }
  function loadFlowCommand() {
    if (!st.flow) st.flow = {};
    return apiGet("/ward/patient-flow?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.flow.flow = (r && r.ok && r.flow) || null; st.flow.err = (r && !r.ok) ? (r.detail || r.error || "refused") : ""; st.flow.loaded = true; paint(); })
      .catch(function () { st.flow.loaded = true; st.flow.err = "could not reach the server"; paint(); });
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
    st.inventory.failed = false;
    return apiGet("/ward/stock?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.inventory.stock = (r && r.ok) ? r : null; st.inventory.failed = !(r && r.ok); paint(); })
      .catch(function () { st.inventory.stock = null; st.inventory.failed = true; paint(); });
  }
  function stockFefo() {
    var code = val("wFefoCode"), qty = val("wFefoQty"), unit = val("wFefoUnit");
    if (!code || !qty || !unit) { st.err = "Enter the drug, the quantity and the unit."; paint(); return; }
    if (!st.inventory) st.inventory = {};
    st.inventory.fefo = { busy: true }; paint();
    apiGet("/ward/stock-fefo?orgId=" + encodeURIComponent(st.orgId) + "&code=" + encodeURIComponent(code) + "&unit=" + encodeURIComponent(unit) + "&quantity=" + encodeURIComponent(qty))
      .then(function (r) { st.inventory.fefo = r || { ok: false }; paint(); })
      .catch(function () { st.inventory.fefo = { ok: false }; paint(); });
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
    var component = val("wTxComponent"), units = val("wTxUnits"), indication = val("wTxIndication"), urgency = val("wTxUrgency");
    st.busy = true; paint();
    var fullIndication = (indication || "") + (urgency ? (indication ? " " : "") + "[Urgency: " + urgency + "]" : "");
    apiPost("/ward/transfusion-request", { orgId: st.orgId, patientId: s.patientId, mrn: s.mrn, encounterId: s.encounterId, component: component, units: units ? Number(units) : 1, indication: fullIndication || undefined, urgency: urgency || undefined })
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
    var dept = "";
    try {
      var promptMsg = "Admit to which department / specialty?\nAvailable departments:\n" + HOSPITAL_DEPARTMENTS.slice(0, 16).join(", ") + "...\n(Or type any department):";
      dept = G.prompt(promptMsg, "General Medicine") || "";
    } catch (e) {}
    if (dept && dept.trim()) {
      st.edAdmitDept = dept.trim();
    }
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
    var knownWards = (st.board && st.board.wards || []).map(function (w) { return w.ward; });
    var allOptions = knownWards.concat(HOSPITAL_DEPARTMENTS).filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
    try {
      var transferMsg = "Transfer to which ward or department?\nOptions:\n" + allOptions.slice(0, 14).join(", ") + "...";
      ward = G.prompt(transferMsg, s.ward || "") || "";
      if (!ward.trim()) return;
      bed = G.prompt("Which bed in " + ward.trim() + "? (leave blank if awaiting one)", "") || "";
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
      .then(function (r) { if (st.sel !== s) return; st.balanceFailed = !(r && r.ok); if (r && r.ok) st.balance = r.balance; paint(); })
      .catch(function () { if (st.sel !== s) return; st.balanceFailed = true; paint(); });
  }
  function chartFluid() {
    var s = st.sel; if (!s) return;
    var v = val("wFVal");
    if (!v) { st.err = "How much?"; paint(); return; }
    st.busy = true; paint();
    var clearFluid = function () { var el = document.getElementById("wFVal"); if (el) el.value = ""; };
    bedsideWrite("fluid", {
      orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId,
      entries: [{ direction: val("wFDir"), kind: val("wFKind"), value: v, at: new Date().toISOString() }],
    }, { label: "Fluid entry", patientId: s.patientId, onKept: clearFluid }, function (r) {
      // A rejected row is the answer, not something to hide behind a success message.
      if (r && r.rejected && r.rejected.length && !r.written) { st.busy = false; st.err = "Not recorded: " + r.rejected[0].reason.replace(/_/g, " ") + "."; paint(); return; }
      if (settle(r, "Charted.")) { clearFluid(); loadBalance(); }
      else paint();
    }, "Could not chart that.");
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
        if (settle(r)) { st.due = r.due || []; st.prn = r.prn || []; st.unscheduled = r.unscheduled || []; st.truncated = !!r.truncated; st.roundWarning = r.warning || ""; }
        else { st.due = []; st.prn = []; st.unscheduled = []; st.roundWarning = "The round could not be loaded. Do not read this as no doses due."; }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not load the round."; st.due = []; st.roundWarning = "The round could not be loaded. Do not read this as no doses due."; paint(); });
  }
  /* Prescribing writes a MedicationOrder through the SAME door the round already reads from; the
   * refusal - formulary, restricted, incomplete - is the server's own and shown verbatim, exactly
   * like every other refusal on this screen. Nothing about the dose is computed here. */
  function orderMedication() {
    var s = st.sel; if (!s) return;
    var drug = val("wMoDrug"), value = val("wMoValue"), unit = val("wMoUnit"), route = val("wMoRoute"), frequency = val("wMoFreq");
    var diluent = val("wMoDiluentVal"), duration = val("wMoInfDuration");
    if (!drug || !value || !unit) { st.err = "Drug, dose and unit are required."; paint(); return; }
    if (diluent || duration) {
      var infNote = " in " + (diluent || "diluent") + (duration ? " over " + duration : "");
      route = route ? (route + " (IV Infusion" + infNote + ")") : ("IV Infusion" + infNote);
      if (!frequency && duration) frequency = "over " + duration;
    }
    st.busy = true; paint();
    apiPost("/ward/medication-order", {
      orgId: st.orgId,
      order: { patientId: s.patientId, encounterId: s.encounterId, drug: drug, dose: { value: value, unit: unit }, route: route || undefined, frequency: frequency || undefined },
    }).then(function (r) {
      if (settle(r, r && r.written ? "Prescribed " + drug + "." : null)) {
        ["wMoDrug", "wMoValue", "wMoUnit", "wMoRoute", "wMoFreq", "wMoDiluentVal", "wMoInfDuration"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
        var dEl = document.getElementById("wMoDiluent"); if (dEl) dEl.value = "";
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
          return { id: d.id, display: (d.code && (d.code.text || (d.code.coding && d.code.coding[0] && d.code.coding[0].display))) || "Result",
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
      .then(function (r) { if (st.sel !== s) return; if (r && r.ok) { st.flowsheet = r.grid; st.flowsheetFailed = false; } else st.flowsheetFailed = true; paint(); })
      .catch(function () { if (st.sel !== s) return; st.flowsheetFailed = true; paint(); });
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
  function purchasingOpen() {
    st.view = "purchasing"; st.purchaseOrders = null; paint(); loadPurchaseOrders();
  }
  function loadPurchaseOrders() {
    st.busy = true; paint();
    return apiGet("/ward/purchase-orders?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.busy = false; st.purchaseOrdersFailed = !(r && r.ok); if (r && r.ok) st.purchaseOrders = r.orders || []; paint(); })
      .catch(function () { st.busy = false; st.purchaseOrdersFailed = true; paint(); });
  }
  function poRaise() {
    var vendor = val("wPoVendor"), item = val("wPoItem"), qty = val("wPoQty"), unit = val("wPoUnit"), price = val("wPoPrice");
    if (!vendor) { st.err = "Say who this is being ordered from."; paint(); return; }
    if (!item || !qty || !unit) { st.err = "An order line needs the item, how many, and what they are counted in."; paint(); return; }
    if (price && !/^\d+(\.\d{1,2})?$/.test(price)) { st.err = "Write the price in rupees, for example 125.50."; paint(); return; }
    var line = { item: item, quantity: qty, unit: unit };
    if (price) line.unitPricePaise = Math.round(Number(price) * 100);
    st.busy = true; paint();
    apiPost("/ward/purchase-order", { orgId: st.orgId, vendor: vendor, lines: [line] })
      .then(function (r) {
        if (settle(r, r && r.ok ? r.detail : null)) {
          ["wPoVendor", "wPoItem", "wPoQty", "wPoUnit", "wPoPrice"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          loadPurchaseOrders();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not raise that order."; paint(); });
  }
  /* Asking for the order's approval uses the SAME chain a restricted medicine uses - there is one
   * approval mechanism in WardSynQ, not one per feature, which is the entire point of building it
   * generically rather than bolting a second `approved` flag onto purchase orders. */
  function poAskApproval(id) {
    var reason = prompt("Why is this order needed?") || "";
    if (!reason) { st.err = "Say why it is needed."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/approval-request", { orgId: st.orgId, subjectType: "PurchaseOrder", subjectId: id, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? "Asked. Somebody else has to approve it." : null)) loadPurchaseOrders(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not ask for approval."; paint(); });
  }
  function poReceive(id) {
    var item = prompt("Which item arrived?") || "";
    if (!item) return;
    var qty = prompt("How many?") || "";
    if (!qty) return;
    var unit = prompt("Counted in what? (box, strip, vial)") || "";
    if (!unit) return;
    st.busy = true; paint();
    apiPost("/ward/goods-receive", { orgId: st.orgId, purchaseOrderId: id, item: item, quantity: qty, unit: unit })
      .then(function (r) {
        // r.detail carries the over-delivery / wrong-unit warning when there is one; it is shown
        // rather than swallowed, because both mean real stock the record has to account for.
        if (settle(r, r && r.ok ? (r.detail || "Booked in.") : null)) loadPurchaseOrders();
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not book that in."; paint(); });
  }

  function approvalsOpen() {
    st.view = "approvals"; st.approvals = null; paint(); loadApprovals();
  }
  function loadApprovals() {
    st.busy = true; paint();
    return apiGet("/ward/approvals?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.approvals = r.verifications || [];
        paint();
      })
      .catch(function () { st.busy = false; paint(); });
  }
  function approvalAsk() {
    var subjectType = val("wApSubjType"), subjectId = val("wApSubjId"), reason = val("wApReason");
    if (!subjectId) { st.err = "Say which one this is about."; paint(); return; }
    if (!reason) { st.err = "Say why it is needed."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/approval-request", { orgId: st.orgId, subjectType: subjectType, subjectId: subjectId, reason: reason })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Asked. It needs " + r.required + " approval" + (r.required === 1 ? "" : "s") + " from somebody else." : null)) {
          ["wApSubjId", "wApReason"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          loadApprovals();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not ask for that."; paint(); });
  }
  function approvalDecide(id, decision) {
    var reason = decision === "rejected" ? (prompt("Why are you turning this down?") || "") : "";
    // A turn-down with no reason is one nobody can act on, so it is not sent.
    if (decision === "rejected" && !reason) { st.err = "A turn-down needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/approval-decide", { orgId: st.orgId, verificationId: id, decision: decision, reason: reason || undefined })
      .then(function (r) {
        if (settle(r, r && r.ok ? (r.state === "approved" ? "Approved." : r.state === "rejected" ? "Turned down." : "Recorded - it still needs " + (r.required - r.approvals) + " more.") : null)) loadApprovals();
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  /* Opening the workspace loads everything it shows, in parallel, through the routes that already
   * exist. Each loader reports its own failure the way it always has; nothing here swallows one to
   * make the screen look tidy. */
  function patientSurgeryOpen() {
    var s = st.sel; if (!s) { st.err = "Open a patient first."; paint(); return; }
    st.view = "patientsurgery"; st.patientCases = null; paint();
    apiGet("/ward/surgery-list?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) {
        if (r && r.ok) st.patientCases = r;
        else { st.patientCases = null; st.err = "Could not load operations. Do not read this as none recorded."; }
        paint();
      })
      .catch(function () { st.err = "Could not load operations."; paint(); });
  }
  function surgeryAbandon(caseId) {
    if (!caseId) return;
    var reason = "";
    try { reason = G.prompt("Why is this case not going ahead?") || ""; } catch (e) {}
    if (!reason) { st.err = "Abandoning a case needs a reason."; paint(); return; }
    if (!confirm("End this case on the record as not going ahead?")) return;
    st.busy = true; paint();
    apiPost("/ward/surgery-abandon", { orgId: st.orgId, caseId: caseId, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? "Recorded as not going ahead." : null)) loadSurgeryCase(caseId); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  var WARD_DISPOSITIONS = [["home", "home"], ["transferred", "to another hospital"], ["left-against-advice", "left against medical advice"], ["died", "died"]];
  function wardDischarge() {
    var s = st.sel; if (!s) return;
    var pick = "";
    try {
      pick = G.prompt("Where did " + (s.name || "the patient") + " go? Type: " + WARD_DISPOSITIONS.map(function (d) { return d[0]; }).join(", ")) || "";
      pick = String(pick).trim().toLowerCase();
    } catch (e) {}
    var known = WARD_DISPOSITIONS.filter(function (d) { return d[0] === pick; })[0];
    if (!known) { st.err = "Say where the patient went: " + WARD_DISPOSITIONS.map(function (d) { return d[0]; }).join(", ") + "."; paint(); return; }
    /* A death is not recorded from here: it is a clinical statement with its own confirmation and its
     * own record, on the Contacts and status screen. Ending the stay as "died" without it would leave
     * the patient alive on their own record. */
    if (known[0] === "died") { st.err = "Record the death first on the Contacts screen, then close the stay."; paint(); return; }
    if (!confirm("End this stay: " + (s.name || s.patientId) + " went " + known[1] + "?\n\nThe bed is released.")) return;
    st.busy = true; paint();
    apiPost("/ward/discharge", { orgId: st.orgId, encounterId: s.encounterId, disposition: known[0] })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Stay ended. The bed is free." : null)) { st.sel = null; st.view = "list"; loadWard(); }
        else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not end the stay."; paint(); });
  }
  function followUpRequest() {
    var s = st.sel; if (!s) return;
    var reason = "", dueBy = "";
    try { reason = G.prompt("Why should this patient be seen again?") || ""; } catch (e) {}
    if (!reason) { st.err = "A follow-up needs a reason."; paint(); return; }
    try { dueBy = G.prompt("Seen by when? (YYYY-MM-DD)") || ""; } catch (e) {}
    /* A follow-up with no date is one nobody books, so the date is required and must be a real date. */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueBy).trim())) { st.err = "Give a date like 2026-10-01."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/follow-up", {
      orgId: st.orgId,
      patientId: s.patientId,
      encounterId: s.encounterId,
      reason: reason,
      dueBy: String(dueBy).trim()
    })
      .then(function (r) {
        settle(r, r && r.ok ? "Follow-up requested." : null);
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not request that follow-up."; paint(); });
  }

  function invoiceVoid(invoiceId) {
    if (!invoiceId) return;
    var reason = "";
    try { reason = G.prompt("Why is this bill being cancelled?") || ""; } catch (e) {}
    if (!reason) { st.err = "Cancelling a bill needs a reason."; paint(); return; }
    if (!confirm("Cancel this bill? It stays on the record as cancelled.")) return;
    st.busy = true; paint();
    apiPost("/ward/invoice-void", { orgId: st.orgId, invoiceId: invoiceId, reason: reason })
      .then(function (r) { st.busy = false; if (r && r.ok) loadCashier(); else { st.cashier.err = (r && (r.detail || r.error)) || "Could not cancel that bill."; paint(); } })
      .catch(function () { st.busy = false; st.cashier.err = "Could not reach the server."; paint(); });
  }

  function dispenseReturn(dispenseId) {
    if (!dispenseId) return;
    var reason = "";
    try { reason = G.prompt("Why was it returned?") || ""; } catch (e) {}
    if (!reason) { st.err = "A return needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/dispense-return", { orgId: st.orgId, dispenseId: dispenseId, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? "Recorded as returned." : null)) loadPharmacy(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that return."; paint(); });
  }
  function bloodTrace() {
    var unit = val("wTxTraceUnit");
    if (!unit) { st.err = "Enter the unit number from the bag."; paint(); return; }
    st.bloodTrace = null; st.busy = true; paint();
    apiGet("/ward/transfusion-trace?orgId=" + encodeURIComponent(st.orgId) + "&unitId=" + encodeURIComponent(unit))
      .then(function (r) { st.busy = false; st.bloodTrace = r && r.ok ? r : { ok: false }; paint(); })
      .catch(function () { st.busy = false; st.bloodTrace = { ok: false }; paint(); });
  }

  function specimenOutcomeAct(specimenId, state) {
    if (!specimenId) return;
    var reason = "";
    if (state === "failed") {
      try { reason = G.prompt("Why did it fail? Clotted, haemolysed, insufficient, never arrived...") || ""; } catch (e) {}
      if (!reason) { st.err = "A failed sample needs a reason, so the ward knows what to do differently."; paint(); return; }
    }
    st.busy = true; paint();
    apiPost("/ward/specimen-outcome", { orgId: st.orgId, specimenId: specimenId, state: state, failureReason: reason || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? (state === "failed" ? "Recorded as failed. The order needs a new sample." : "Received.") : null)) loadLabBoard(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  /* Microbiology and histopathology entry (P1.9). A culture is opened from a pending request or from
   * its in-progress row, where the form starts from the stage already on the record. */
  function cultureOpen(srId) {
    var b = st.labBoard || {}, found = null, existing = null;
    (b.pending || []).forEach(function (p) { if (p.serviceRequestId === srId) found = p; });
    (b.cultures || []).forEach(function (c) { if (c.serviceRequestId === srId) { existing = c; found = found || { serviceRequestId: srId, display: c.panel, patientId: c.patientId }; } });
    if (!found) { st.err = "That request is no longer on the board. Refresh the board."; paint(); return; }
    st.histoFor = null; st.labResultFor = null;
    st.cultureFor = Object.assign({}, found, { existing: existing }); paint();
  }
  function cultureSave() {
    var f = st.cultureFor; if (!f) return;
    var organisms = [];
    for (var k = 0; k < CULTURE_ORG_SLOTS; k++) {
      var name = val("wCuOrg" + k);
      var sus = [];
      for (var r = 0; r < CULTURE_ABX_ROWS; r++) {
        var a = val("wCuAbx" + k + "_" + r), res = val("wCuRes" + k + "_" + r);
        if (!a || !res) continue; // not tested is not sent
        sus.push({ antibiotic: a, result: res, mic: val("wCuMic" + k + "_" + r) || undefined, micUnit: val("wCuMicU" + k + "_" + r) || undefined, method: val("wCuMeth" + k + "_" + r) || undefined });
      }
      if (!name) { if (sus.length) { st.err = "Organism " + (k + 1) + " has susceptibilities but no name."; paint(); return; } continue; }
      organisms.push({ name: name, quantity: val("wCuQty" + k) || undefined, breakpointStandard: val("wCuBp" + k) || undefined, susceptibilities: sus });
    }
    var box = document.getElementById("wCuCorrect");
    st.busy = true; paint();
    apiPost("/ward/culture-report", {
      orgId: st.orgId, serviceRequestId: f.serviceRequestId, stage: val("wCuStage"),
      specimen: { type: val("wCuSpec"), site: val("wCuSite") || undefined },
      collectedAt: val("wCuColl") || undefined, receivedAt: val("wCuRecv") || undefined, gramStain: val("wCuGram") || undefined,
      noGrowthHours: val("wCuNoGrowth") || undefined, organisms: organisms, comment: val("wCuComment") || undefined,
      correction: !!(box && box.checked),
    }).then(function (r) {
      if (settle(r, "Culture stage saved.")) {
        if (r.criticalCheck && !r.criticalCheck.checked) st.err = "Saved, but the critical-result alert for this positive blood culture could NOT be opened. Phone the ward now.";
        else if (r.criticalCheck && r.criticalCheck.opened) st.note = "Positive blood culture. The critical-result alert has been opened.";
        st.cultureFor = null; loadLabBoard();
      } else paint();
    }).catch(function () { st.busy = false; st.err = "Could not reach the server."; paint(); });
  }
  function histoOpen(srId) {
    var b = st.labBoard || {}, found = null;
    (b.pending || []).forEach(function (p) { if (p.serviceRequestId === srId) found = p; });
    if (!found) { st.err = "That request is no longer on the board. Refresh the board."; paint(); return; }
    st.cultureFor = null; st.labResultFor = null; st.histoFor = found; paint();
  }
  function histoSave() {
    var f = st.histoFor; if (!f) return;
    st.busy = true; paint();
    apiPost("/ward/histopathology-report", {
      orgId: st.orgId, serviceRequestId: f.serviceRequestId, status: val("wHpStatus") || "preliminary", specimen: val("wHpSpec"),
      clinicalDetails: val("wHpClin") || undefined, macroscopic: val("wHpMacro") || undefined, microscopic: val("wHpMicro") || undefined,
      diagnosis: val("wHpDx") || undefined, codedDiagnosis: val("wHpCode") || undefined,
    }).then(function (r) {
      if (settle(r, r && r.awaitingVerification ? "On the chart as preliminary. Another member of the laboratory must verify it." : "Histopathology report saved.")) { st.histoFor = null; loadLabBoard(); }
      else paint();
    }).catch(function () { st.busy = false; st.err = "Could not reach the server."; paint(); });
  }
  function histoAddendum(reportId) {
    var text = window.prompt("Addendum. The signed report is not changed.") || "";
    if (!text.trim()) { st.err = "An addendum needs words."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/histopathology-addendum", { orgId: st.orgId, reportId: reportId, text: text })
      .then(function (r) { if (settle(r, "Addendum added.")) loadLabBoard(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not reach the server."; paint(); });
  }
  function loadPathology() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.pathology = null; paint();
    return apiGet("/ward/pathology-reports?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.pathology = r && r.ok ? r : false; paint(); })
      .catch(function () { st.pathology = false; paint(); });
  }
  function labResultOpen(srId) {
    var b = st.labBoard || {};
    var found = null;
    (b.pending || []).forEach(function (p) { if (p.serviceRequestId === srId) found = p; });
    if (!found) { st.err = "That test is no longer waiting for a result. Refresh the board."; paint(); return; }
    st.labResultFor = found; st.labResultOutcome = null; paint();
  }
  function labTemplateApply(k) {
    var tmpl = LAB_TEMPLATES[k];
    if (!tmpl || !tmpl.tests) return;
    tmpl.tests.forEach(function (t, i) {
      if (i >= 10) return;
      var elT = document.getElementById("wLrTest" + i);
      var elU = document.getElementById("wLrUnit" + i);
      var elR = document.getElementById("wLrRange" + i);
      // A template names the tests only. Unit and range are shown as hints, never filled in: an
      // adult reference range or a mg/dL unit typed for the analyser is a wrong result waiting to be
      // released, so both stay what the laboratory's own analyser printed.
      if (elT) { elT.value = t.test; elT.setAttribute("data-tmpl", t.test); }
      if (elU) { elU.value = ""; elU.placeholder = t.unit || ""; }
      if (elR) { elR.value = ""; elR.placeholder = t.range ? "e.g. " + t.range + ", use the analyser's" : "as the analyser reports it"; }
    });
  }
  function labResultSave() {
    var f = st.labResultFor; if (!f) return;
    var tests = [];
    for (var i = 0; i < 10; i++) {
      var t = val("wLrTest" + i), v = val("wLrVal" + i), u = val("wLrUnit" + i), rg = val("wLrRange" + i);
      if (!t && !v) continue;
      // A blank row a template named is simply unused. A test typed by hand without a value is still
      // sent, so the server names it as not saved rather than it vanishing here.
      var elT = document.getElementById("wLrTest" + i);
      if (!v && elT && elT.getAttribute("data-tmpl") === t) continue;
      tests.push({ test: t, value: v, unit: u || undefined, range: rg || undefined });
    }
    if (!tests.length) { st.err = "Enter at least one result."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/release-result", {
      orgId: st.orgId, serviceRequestId: f.serviceRequestId, patientId: f.patientId, encounterId: f.encounterId,
      tests: tests, status: val("wLrStatus") || "final", conclusion: val("wLrConc") || undefined,
    })
      .then(function (r) {
        st.busy = false;
        st.labResultOutcome = r || null;
        /* Whether the result was checked against the critical limits is said on every release. A check
         * that failed is a warning, never silence. */
        if (r && r.ok && r.criticalCheck && !r.criticalCheck.checked) {
          st.err = "Result saved, but it could NOT be checked against the critical limits. Review it for critical values now.";
        } else if (r && r.ok && r.criticalCheck && r.criticalCheck.opened) {
          st.err = r.criticalCheck.opened + " critical value" + (r.criticalCheck.opened === 1 ? "" : "s") + " in this result. The critical-result alert has been opened.";
        }
        if (r && r.ok && !(r.rejected && r.rejected.length)) {
          st.labResultFor = null;
          st.note = r.awaitingVerification ? "On the chart as preliminary. Another member of the laboratory must verify it." : "Result released.";
          if (r.deltaBreaches) st.note += " " + r.deltaBreaches + " value" + (r.deltaBreaches === 1 ? " changed" : "s changed") + " more than expected since the last result: check the sample identity.";
          loadLabBoard();
        } else if (r && r.ok) {
          st.err = "Some rows were not saved. They are listed below the form.";
          loadLabBoard();
        } else settle(r, null);
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not release that result."; paint(); });
  }

  function tagsOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "tags"; st.tags = null; st.tagVerify = null; paint(); loadTags();
  }
  function loadTags() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/tag-log?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) {
        if (r && r.ok) st.tags = r;
        else { st.tags = null; st.err = "Could not load wristbands. Do not read this as no band issued."; }
        paint();
      })
      .catch(function () { st.tags = null; st.err = "Could not load wristbands."; paint(); });
  }
  function tagVerify() {
    var s = st.sel; if (!s) return;
    var code = val("wTgScan");
    if (!code) { st.err = "Scan or type the code on the band."; paint(); return; }
    st.tagVerify = null; st.busy = true; paint();
    apiPost("/ward/tag-verify", { orgId: st.orgId, patientId: s.patientId, tagType: "wristband", scannedCode: code })
      .then(function (r) {
        st.busy = false;
        /* Only a definite server answer is shown as a verdict. A failed CHECK is not a match and is not
         * shown as one: it is an error, and the band has not been checked. */
        if (r && r.ok) st.tagVerify = { matches: !!r.matches, reason: r.reason || null };
        else { st.tagVerify = null; st.err = "The band could not be checked. Treat it as unchecked."; }
        paint();
      })
      .catch(function () { st.busy = false; st.tagVerify = null; st.err = "The band could not be checked. Treat it as unchecked."; paint(); });
  }
  function tagAssign() {
    var s = st.sel; if (!s) return;
    var code = val("wTgCode");
    if (!code) { st.err = "Type the code printed on the band."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/tag-assign", { orgId: st.orgId, patientId: s.patientId, tagType: val("wTgType"), code: code })
      .then(function (r) { if (settle(r, r && r.ok ? "Band issued." : null)) loadTags(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not issue that band."; paint(); });
  }
  function tagEnd(kind, tagId) {
    if (!tagId) return;
    var reason = "", newCode = "";
    if (kind === "replace") { try { newCode = G.prompt("Code on the new band") || ""; } catch (e) {} if (!newCode) return; }
    try { reason = G.prompt("Why?") || ""; } catch (e) {}
    if (!reason) { st.err = "Ending or replacing a band needs a reason."; paint(); return; }
    var route = kind === "replace" ? "/ward/tag-replace" : kind === "lost" ? "/ward/tag-lost" : "/ward/tag-deactivate";
    var body = { orgId: st.orgId, tagId: tagId, reason: reason };
    if (kind === "replace") body.newCode = newCode;
    st.busy = true; paint();
    apiPost(route, body)
      .then(function (r) { if (settle(r, r && r.ok ? "Recorded." : null)) { st.tagVerify = null; loadTags(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  function mpiOpen() {
    st.view = "mpi"; st.mpi = null; st.mpiIdentity = null; paint();
    loadMpiIdentity();
  }
  function loadMpiIdentity() {
    var s = st.sel; if (!s) return;
    st.mpiIdentity = null; paint();
    apiGet("/ward/identity?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.mpiIdentity = r && r.ok ? r : { failed: true }; paint(); })
      .catch(function () { st.mpiIdentity = { failed: true }; paint(); });
  }
  function mpiSearch() {
    var s = st.sel;
    var body = { orgId: st.orgId };
    if (s) body.patientId = s.patientId;
    else {
      body.name = val("wMpiName"); body.dob = val("wMpiDob") || undefined;
      body.sex = val("wMpiSex") || undefined; body.mrn = val("wMpiMrn") || undefined;
      if (!body.name && !body.mrn) { st.err = "Give at least a name or an MRN to search on."; paint(); return; }
    }
    st.busy = true; paint();
    apiPost("/ward/id-match", body)
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.mpi = r;
        else { st.mpi = null; settle(r, null); }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not search for duplicates."; paint(); });
  }
  function mpiMergePreview(arg) {
    var parts = String(arg || "").split("~");
    if (!parts[0] || !parts[1]) return;
    st.busy = true; st.mpiPreview = null; paint();
    apiPost("/ward/merge", { orgId: st.orgId, survivorId: parts[0], mergedId: parts[1], dryRun: true })
      .then(function (r) {
        st.busy = false;
        if (r && r.ok && r.dryRun && r.survivor && r.merged) st.mpiPreview = r;
        else if (r && r.ok && r.skipped === "already_merged") st.note = "These two records are already joined.";
        else settle(r, null);
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not prepare the merge preview. Nothing was joined."; paint(); });
  }
  function mpiMergeConfirm() {
    var p = st.mpiPreview; if (!p) return;
    var reason = val("wMpiReason");
    if (reason.length < 10) { st.err = "Say what establishes these are the same person (at least a short sentence)."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/merge", { orgId: st.orgId, survivorId: p.survivor.patientId, mergedId: p.merged.patientId, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? "Records joined." : null)) { st.mpiPreview = null; loadMpiIdentity(); mpiSearch(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not join the records. Nothing was changed."; paint(); });
  }
  function mpiMerge(arg, undo) {
    var parts = String(arg || "").split("~");
    var survivorId = parts[0], mergedId = parts[1];
    if (!survivorId || !mergedId) return;
    var reason = "";
    try { reason = G.prompt(undo ? "Why is this merge being undone?" : "Why are these the same person? What did you check?") || ""; } catch (e) {}
    if (!reason) { st.err = (undo ? "Undoing" : "Merging") + " records needs a reason."; paint(); return; }
    if (!confirm(undo
      ? "Undo the merge of these two records?"
      : "Join these two records as one person?\n\nNo clinical data is moved or deleted, and this can be undone.")) return;
    st.busy = true; paint();
    apiPost(undo ? "/ward/unmerge" : "/ward/merge", { orgId: st.orgId, survivorId: survivorId, mergedId: mergedId, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? (undo ? "Merge undone." : "Records joined.") : null)) { loadMpiIdentity(); mpiSearch(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not do that."; paint(); });
  }

  function infusionOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "infusions"; st.infusions = null; paint(); loadInfusions();
  }
  function loadInfusions() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return apiGet("/ward/infusions?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.infusions = r;
        else { st.infusions = null; st.err = "Could not load infusions. Do not read this as none running."; }
        paint();
      })
      .catch(function () { st.busy = false; st.infusions = null; st.err = "Could not load infusions. Do not read this as none running."; paint(); });
  }
  function infusionChart(orderId) {
    if (!orderId) return;
    var event = "", rate = "", reason = "";
    try {
      event = G.prompt("What happened? started, rate-changed, paused, resumed, or stopped") || "";
      event = String(event).trim().toLowerCase();
    } catch (e) {}
    var known = INFUSION_EVENTS.some(function (x) { return x[0] === event; });
    if (!known) { st.err = "Say started, rate-changed, paused, resumed or stopped."; paint(); return; }
    if (event === "started" || event === "rate-changed" || event === "resumed") {
      try { rate = G.prompt("Rate now, in mL per hour") || ""; } catch (e) {}
      /* A rate that is not plainly a number is refused here too, not coerced: a pump rate read wrong
       * by a factor of ten is a real dose error. The server refuses it independently. */
      if (!/^\d+(\.\d+)?$/.test(String(rate).trim())) { st.err = "The rate has to be a plain number of mL per hour."; paint(); return; }
    }
    /* THE BAG'S CONCENTRATION, as written on its label, so an ICU chart can work out a weight-based
     * dose from the rate. Optional and never defaulted: left blank, no dose is worked out, and the
     * ICU card says why. Anything that is not "amount unit in volume mL" is refused, not guessed. */
    var concentration;
    if (event === "started" || event === "rate-changed") {
      var conc = "";
      try { conc = G.prompt("Bag concentration, as on the label, e.g. 4 mg in 50 mL (leave blank if not needed)") || ""; } catch (e) {}
      conc = String(conc).trim();
      if (conc) {
        var cm = /^(\d+(?:\.\d+)?)\s*([a-zA-Z\u00b5\u03bc]+)\s+in\s+(\d+(?:\.\d+)?)\s*ml$/i.exec(conc);
        if (!cm) { st.err = "Write the concentration as amount, unit, in, volume in mL, for example 4 mg in 50 mL."; paint(); return; }
        concentration = { amount: Number(cm[1]), unit: cm[2], volumeMl: Number(cm[3]) };
      }
    }
    if (event === "paused" || event === "stopped") {
      try { reason = G.prompt("Why?") || ""; } catch (e) {}
    }
    st.busy = true; paint();
    apiPost("/ward/infusion", {
      orgId: st.orgId, orderId: orderId, event: event,
      ratePerHour: rate ? Number(rate) : undefined, reason: reason || undefined, concentration: concentration,
    })
      .then(function (r) { if (settle(r, r && r.ok ? "Charted." : null)) { loadInfusions(); if (st.sel && st.sel.class === "ICU") loadIcu(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not chart that."; paint(); });
  }
  function carePlanSave() {
    var s = st.sel; if (!s) return;
    var title = val("wCpTitle"), goalsText = val("wCpGoals"), reviewBy = val("wCpReview");
    if (!title) { st.err = "Say what this plan is for."; paint(); return; }
    /* Each line is "goal | how you will know it was met". The server refuses a goal with no measure,
     * and this form used to send bare lines, so every plan saved from it was refused. */
    var lines = goalsText.split("\n").map(function (g) { return g.trim(); }).filter(Boolean);
    if (!lines.length) { st.err = "A care plan needs at least one goal."; paint(); return; }
    var typed = [], bad = "";
    lines.forEach(function (l) {
      var i = l.indexOf("|");
      var t = i < 0 ? "" : l.slice(0, i).trim(), m = i < 0 ? "" : l.slice(i + 1).trim();
      if (!t || !m) bad = bad || l; else typed.push({ title: t, measure: m });
    });
    if (bad) { st.err = "Each goal needs how you will know it was met. Write the goal, then |, then the measure: " + bad; paint(); return; }
    if (!reviewBy) { st.err = "Say when this plan will be reviewed."; paint(); return; }
    st.busy = true; paint();
    /* SAVING REPLACES THE GOAL LIST, so the current plan is read first and its goals are kept. A goal
     * that is no longer wanted is marked cancelled on the care plan screen, where the reason shows. If
     * the current plan cannot be read nothing is saved: saving blind could drop goals already on it. */
    apiGet("/ward/plan?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(s.encounterId))
      .then(function (cur) {
        if (!(cur && cur.ok)) { st.busy = false; st.err = "Could not read the current care plan, so nothing was saved."; paint(); return; }
        var goals = ((cur.plan && cur.plan.goals) || []).map(function (g) { return { title: g.title, measure: g.measure, targetDate: g.targetDate || undefined, note: g.note || undefined }; });
        var have = {}; goals.forEach(function (g) { have[String(g.title).toLowerCase()] = true; });
        typed.forEach(function (g) { if (!have[g.title.toLowerCase()]) goals.push(g); });
        return apiPost("/ward/care-plan", { orgId: st.orgId, encounterId: s.encounterId, title: title, goals: goals, reviewBy: reviewBy })
          .then(function (r) {
            if (settle(r, r && r.ok ? "Care plan saved." : null)) {
              ["wCpTitle", "wCpGoals", "wCpReview"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
              if (st.view === "careplan") loadCarePlan(); else loadChart();
            } else paint();
          });
      })
      .catch(function () { st.busy = false; st.err = "Could not save the care plan."; paint(); });
  }
  function carePlanOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "careplan"; st.carePlan = null; paint(); loadCarePlan();
  }
  function loadCarePlan() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.carePlan = null;
    return apiGet("/ward/plan?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(s.encounterId))
      .then(function (r) { st.carePlan = r && r.ok ? r : { failed: true }; paint(); })
      .catch(function () { st.carePlan = { failed: true }; paint(); });
  }
  function carePlanProgress(arg) {
    var s = st.sel; if (!s) return;
    var p = String(arg || "").split("~"), key = p[0], state = p[1], note = "";
    if (state === "not-met" || state === "cancelled") {
      try { note = G.prompt(state === "not-met" ? "Why was this goal not met?" : "Why is this goal no longer wanted?") || ""; } catch (e) {}
      if (state === "not-met" && !note.trim()) return;
    }
    st.busy = true; paint();
    apiPost("/ward/progress", { orgId: st.orgId, encounterId: s.encounterId, key: key, state: state, note: note.trim() || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? "Progress recorded." : null)) loadCarePlan(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record progress."; paint(); });
  }
  function carePlanReview() {
    var s = st.sel; if (!s) return;
    var next = val("wCpNextReview");
    if (!next) { st.err = "Say when the plan will be reviewed next."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/progress", { orgId: st.orgId, encounterId: s.encounterId, review: true, reviewBy: next })
      .then(function (r) { if (settle(r, r && r.ok ? "Review recorded." : null)) loadCarePlan(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the review."; paint(); });
  }

  function admReqOpen() {
    st.view = "admreqs"; st.admReqs = null; paint(); loadAdmReqs();
  }
  function loadAdmReqs() {
    st.busy = true; paint();
    return apiGet("/ward/waiting-list?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.admReqs = r;
        else { st.admReqs = null; st.err = "Could not load the bed waiting list. Do not read this as nobody waiting."; }
        paint();
      })
      .catch(function () { st.busy = false; st.admReqs = null; st.err = "Could not load the bed waiting list. Do not read this as nobody waiting."; paint(); });
  }
  function admReqAsk() {
    var mrn = val("wArMrn"), reason = val("wArReason");
    if (!mrn) { st.err = "Say which patient, by MRN."; paint(); return; }
    if (!reason) { st.err = "Say why this patient needs to come in."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/request-admission", {
      orgId: st.orgId, mrn: mrn, urgency: val("wArUrg"), specialty: val("wArSpec") || undefined,
      ward: val("wArWard") || undefined, reason: reason,
    })
      .then(function (r) {
        if (settle(r, r && r.ok ? "On the waiting list." : null)) {
          ["wArMrn", "wArSpec", "wArWard", "wArReason"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          loadAdmReqs();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not ask for that bed."; paint(); });
  }
  function admReqClose(arg) {
    var parts = String(arg || "").split("~");
    var id = parts[0], state = parts[1];
    if (!id || !state) return;
    var reason = "";
    if (state === "cancelled") {
      try { reason = G.prompt("Why is this request being cancelled?") || ""; } catch (e) {}
      /* A patient who drops off a bed list with no reason is a patient nobody admitted. */
      if (!reason) { st.err = "A cancellation needs a reason."; paint(); return; }
    }
    st.busy = true; paint();
    apiPost("/ward/close-admission-request", { orgId: st.orgId, requestId: id, state: state, reason: reason || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? "Closed." : null)) loadAdmReqs(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not close that request."; paint(); });
  }

  function orderSetsOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "ordersets"; st.orderSets = null; st.orderSetPick = null; st.orderSetResult = null; paint();
    apiGet("/ward/order-sets?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        if (r && r.ok) st.orderSets = r;
        else { st.orderSets = null; st.err = "Could not load order sets."; }
        paint();
      })
      .catch(function () { st.err = "Could not load order sets."; paint(); });
  }
  function orderSetPick() {
    var id = val("wOsSet");
    var found = null;
    ((st.orderSets && st.orderSets.sets) || []).forEach(function (x) { if (x.id === id) found = x; });
    st.orderSetPick = found; st.orderSetResult = null; paint();
  }
  /* Resolve the ticked items on the server, then send each through the ORDINARY ordering route in
   * turn. Sequential on purpose: parallel orders against one patient race each other for the record
   * version, and the interaction check on order three has to see orders one and two. */
  function orderSetApply() {
    var s = st.sel, pick = st.orderSetPick;
    if (!s || !pick) return;
    var select = [];
    (pick.items || []).forEach(function (it) {
      var el = document.getElementById("wOsItem_" + it.key);
      if (el && el.checked) select.push(it.key);
    });
    if (!select.length) { st.err = "Nothing is ticked."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/prepare-set", { orgId: st.orgId, setId: pick.id, patientId: s.patientId, encounterId: s.encounterId, select: select })
      .then(function (prep) {
        if (!prep || !prep.ok) { st.busy = false; settle(prep, null); paint(); return null; }
        var applied = [], failed = [];
        var chain = Promise.resolve();
        (prep.requests || []).forEach(function (req) {
          chain = chain.then(function () {
            var call = req.kind === "medication"
              ? apiPost("/ward/medication-order", { orgId: st.orgId, order: req.order })
              : apiPost("/ward/investigation", { orgId: st.orgId, encounterId: req.order.encounterId, code: req.order.code, display: req.order.display });
            return call.then(function (r) {
              if (r && r.ok) applied.push(req.key);
              else failed.push({ key: req.key, error: (r && r.error) || "refused", detail: r && (r.detail || (r.reasons && r.reasons.join(", "))) });
            }).catch(function () { failed.push({ key: req.key, error: "unreachable", detail: "Could not reach the server for this item." }); });
          });
        });
        return chain.then(function () {
          var result = { applied: applied, failed: failed, deselected: prep.deselected || [] };
          /* Recorded whatever happened, including a set that landed in part - that is the case a
           * later reader most needs to find. */
          return apiPost("/ward/applied-set", {
            orgId: st.orgId, setId: prep.setId, setName: prep.setName, setVersion: prep.setVersion,
            patientId: s.patientId, encounterId: s.encounterId,
            applied: applied, failed: failed, deselected: prep.deselected || [],
          }).then(function () { return result; }, function () { return result; });
        });
      })
      .then(function (result) {
        st.busy = false;
        if (result) { st.orderSetResult = result; st.orderSetPick = null; loadChart(); }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not apply that order set."; paint(); });
  }

  function loadPathways() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "pathways"; st.pathwaysData = null; paint();
    Promise.all([
      apiGet("/ward/pathways?orgId=" + encodeURIComponent(st.orgId)),
      apiGet("/ward/pathway-progress?patientId=" + encodeURIComponent(st.sel.patientId))
    ]).then(function (res) {
      st.pathwaysData = { available: res[0] && res[0].ok ? res[0] : null, progress: res[1] && res[1].ok ? res[1] : null };
      paint();
    }).catch(function () {
      st.pathwaysData = { failed: true };
      paint();
    });
  }

  function pathwayEnrol(arg) {
    var s = st.sel;
    if (!s) return;
    var parts = String(arg || "").split("~");
    apiPost("/ward/pathway-enrol", {
      orgId: st.orgId,
      patientId: s.patientId,
      encounterId: s.encounterId || s.id || "",
      pathwayKey: parts[0],
      pathwayVersion: parts[1]
    }).then(function (r) {
      if (settle(r, "Patient enrolled on pathway.")) loadPathways();
      else paint();
    }).catch(function () {
      st.err = "Could not enrol patient on pathway.";
      paint();
    });
  }

  function pathwayOverride(arg) {
    var s = st.sel;
    if (!s) return;
    var parts = String(arg || "").split("~");
    var reason = window.prompt("Clinical reason for overriding this pathway step (mandatory):");
    if (!reason || reason.trim().length < 5) {
      alert("A reason of at least 5 characters is required to override a pathway step.");
      return;
    }
    apiPost("/ward/pathway-override", {
      orgId: st.orgId,
      patientId: s.patientId,
      enrolmentId: parts[0],
      stepKey: parts[1],
      reason: reason.trim()
    }).then(function (r) {
      if (settle(r, "Step override recorded.")) loadPathways();
      else paint();
    }).catch(function () {
      st.err = "Could not record step override.";
      paint();
    });
  }

  function loadSpecialty() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "specialty"; st.specialtyData = null; paint();
    apiGet("/ward/specialty?class=" + encodeURIComponent(st.sel.class || "") + "&specialty=" + encodeURIComponent(st.sel.specialty || ""))
      .then(function (r) {
        st.specialtyData = r && r.ok ? r : { failed: true };
        paint();
      }).catch(function () {
        st.specialtyData = { failed: true };
        paint();
      });
  }

  function breakGlassOpen() {
    st.view = "breakglass"; st.breakGlass = null; paint(); loadBreakGlass();
  }
  function loadBreakGlass() {
    st.busy = true; paint();
    return apiGet("/ward/break-glass-log?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.breakGlass = r;
        else { st.breakGlass = null; st.err = "Could not load the emergency access log. Do not read this as none declared."; }
        paint();
      })
      .catch(function () { st.busy = false; st.breakGlass = null; st.err = "Could not load the emergency access log."; paint(); });
  }
  function emergencyChartOpen(patientId) {
    if (!patientId) return;
    st.emergencyChart = null; st.busy = true; paint();
    apiGet("/ward/emergency-chart?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(patientId))
      .then(function (r) { st.busy = false; st.emergencyChart = r || { ok: false, error: "no_response" }; paint(); })
      .catch(function () { st.busy = false; st.emergencyChart = { ok: false, detail: "Could not open the chart." }; paint(); });
  }
  function breakGlassDeclare() {
    var s = st.sel; if (!s) { st.err = "Open a patient first."; paint(); return; }
    var reason = val("wBgReason");
    if (!reason) { st.err = "Break-glass needs a reason in your own words."; paint(); return; }
    /* Asked twice, because this is recorded against the clinician's name and reviewed. */
    if (!confirm("Break glass for " + (s.name || s.patientId) + "?\n\nYour name and reason will be recorded and reviewed.")) return;
    st.busy = true; paint();
    apiPost("/ward/break-glass", { orgId: st.orgId, patientId: s.patientId, reason: reason })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Emergency access granted. It is read-only and ends on its own." : null)) {
          var el = document.getElementById("wBgReason"); if (el) el.value = "";
          loadBreakGlass();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not declare emergency access."; paint(); });
  }

  function woundOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "wounds"; st.wounds = null; paint(); loadWounds();
  }
  function loadWounds() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return apiGet("/ward/wounds?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.wounds = r;
        else { st.wounds = null; st.err = "Could not load wounds. Do not read this as none charted."; }
        paint();
      })
      .catch(function () { st.busy = false; st.wounds = null; st.err = "Could not load wounds. Do not read this as none charted."; paint(); });
  }
  function woundChart() {
    var s = st.sel; if (!s) return;
    var site = val("wWdSite");
    if (!site) { st.err = "Say where on the body."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/wound", {
      orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId,
      site: site, kind: val("wWdKind"), stage: val("wWdStage") || undefined, origin: val("wWdOrigin"),
      lengthCm: val("wWdL") || undefined, widthCm: val("wWdW") || undefined, depthCm: val("wWdD") || undefined,
      dressing: val("wWdDressing") || undefined, note: val("wWdNote") || undefined,
    })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Charted." : null)) {
          ["wWdSite", "wWdL", "wWdW", "wWdD", "wWdDressing", "wWdNote"].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.value = "";
          });
          loadWounds();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not chart that wound."; paint(); });
  }

  function riskOpenView() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "risks"; st.risks = null; st.riskForm = null; paint(); loadRisks();
  }
  function loadRisks() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return Promise.all([
      apiGet("/ward/risks?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId)),
      apiGet("/ward/risk-tools?orgId=" + encodeURIComponent(st.orgId)),
    ]).then(function (rs) {
      st.busy = false;
      if (rs[0] && rs[0].ok) st.risks = rs[0];
      else { st.risks = null; st.err = "Could not load risk assessments. Do not read this as none recorded."; }
      st.riskTools = (rs[1] && rs[1].ok) ? rs[1] : { tools: [] };
      paint();
    }).catch(function () { st.busy = false; st.risks = null; st.err = "Could not load risk assessments."; paint(); });
  }
  function riskOpenTool() {
    var id = val("wRkTool");
    var tools = (st.riskTools && st.riskTools.tools) || [];
    var found = null;
    tools.forEach(function (t) { if (t.id === id) found = t; });
    if (!found) { st.err = "That tool is not configured."; paint(); return; }
    st.riskForm = found; paint();
  }
  function riskSave() {
    var s = st.sel; if (!s || !st.riskForm) return;
    var answers = {};
    (st.riskForm.questions || []).forEach(function (q) {
      var v = val("wRq_" + q.key);
      if (v !== "") answers[q.key] = v;
    });
    st.busy = true; paint();
    apiPost("/ward/assess", { orgId: st.orgId, toolId: st.riskForm.id, encounterId: s.encounterId, answers: answers })
      .then(function (r) {
        if (settle(r, r && r.ok ? (r.incomplete ? "Recorded, with unanswered questions." : "Recorded.") : null)) {
          st.riskForm = null; loadRisks();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that assessment."; paint(); });
  }
  function riskActionDone(arg) {
    var parts = String(arg || "").split("~");
    var assessmentId = parts[0], action = parts.slice(1).join("~");
    if (!assessmentId || !action) return;
    var note = "";
    try { note = G.prompt("Anything to record about doing this? (optional)") || ""; } catch (e) {}
    st.busy = true; paint();
    apiPost("/ward/risk-action", { orgId: st.orgId, assessmentId: assessmentId, action: action, note: note || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? "Recorded." : null)) loadRisks(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }

  function medRecOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "medrec"; st.medRec = null; paint(); loadMedRec();
  }
  function loadMedRec() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return apiGet("/ward/med-reconciliation?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(s.encounterId))
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.medRec = r;
        else { st.medRec = null; st.err = "Could not load the medicines history. Do not read this as none recorded."; }
        paint();
      })
      .catch(function () { st.busy = false; st.medRec = null; st.err = "Could not load the medicines history. Do not read this as none recorded."; paint(); });
  }
  function medRecStart() {
    var s = st.sel; if (!s) return;
    var text = val("wMrMeds");
    if (!text) { st.err = "Write down what the patient is taking."; paint(); return; }
    /* One medicine a line, exactly as typed. Nothing here parses a dose out of the words: a parser
     * that guessed "500mg" from a line and got it wrong would put a made-up dose on the record. */
    var medicines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return { drug: l }; });
    if (!medicines.length) { st.err = "Write down what the patient is taking."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/med-history", {
      orgId: st.orgId, encounterId: s.encounterId, stage: val("wMrStage") || "admission",
      source: val("wMrSource") || undefined, medicines: medicines,
    })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Recorded. Each medicine still needs a decision." : null)) {
          var el = document.getElementById("wMrMeds"); if (el) el.value = "";
          loadMedRec();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }
  function medRecDecide(arg) {
    var s = st.sel; if (!s) return;
    var parts = String(arg || "").split("~");
    var stage = parts[0], key = parts[1], decision = parts[2];
    if (!stage || !key || !decision) return;
    var reason = "";
    /* The module requires a reason for the decisions that change what the patient takes; asking for
     * one on every decision is simpler than encoding that rule twice, and the server is still the
     * one that enforces it. */
    try { reason = G.prompt("Why? (required for stopping or changing a medicine)") || ""; } catch (e) {}
    st.busy = true; paint();
    apiPost("/ward/med-decide", {
      orgId: st.orgId, encounterId: s.encounterId, stage: stage, key: key,
      decision: decision, reason: reason || undefined,
    })
      .then(function (r) { if (settle(r, r && r.ok ? "Decided." : null)) loadMedRec(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that decision."; paint(); });
  }

  function handoverOpen() {
    st.view = "handover"; st.handovers = null; paint(); loadHandovers();
  }
  function loadHandovers() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId) + "&state=" + encodeURIComponent(st.handoverState || "waiting");
    return apiGet("/ward/handovers?" + q)
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.handovers = r;
        // An unreachable list is not an empty shift. Same reasoning as the safety inbox.
        else { st.handovers = null; st.err = "Could not load handovers. Do not read this as nothing waiting."; }
        paint();
      })
      .catch(function () { st.busy = false; st.handovers = null; st.err = "Could not load handovers. Do not read this as nothing waiting."; paint(); });
  }
  function handoverGive() {
    var s = st.sel; if (!s) { st.err = "Open a patient first."; paint(); return; }
    var sbar = {}, any = false;
    SBAR_FIELDS.forEach(function (f) { var v = val("wHo_" + f[0]); if (v) { sbar[f[0]] = v; any = true; } });
    if (!any) { st.err = "A handover with nothing in it is not a handover."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/handover", { orgId: st.orgId, encounterId: s.encounterId, sbar: sbar })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Handed over. It stays waiting until somebody else takes it." : null)) {
          SBAR_FIELDS.forEach(function (f) { var el = document.getElementById("wHo_" + f[0]); if (el) el.value = ""; });
          loadHandovers();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that handover."; paint(); });
  }
  function handoverTake(id) {
    var note = "";
    try { note = G.prompt("Anything to add as you take this patient? (optional)") || ""; } catch (e) {}
    st.busy = true; paint();
    apiPost("/ward/receive-handover", { orgId: st.orgId, handoverId: id, note: note || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? "Taken." : null)) loadHandovers(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not take that handover."; paint(); });
  }

  function safetyInboxOpen() {
    st.view = "safetyinbox"; st.inbox = null; paint(); loadSafetyInbox();
  }
  function loadSafetyInbox() {
    st.busy = true; paint();
    var q = "orgId=" + encodeURIComponent(st.orgId);
    if (st.inboxRole) q += "&role=" + encodeURIComponent(st.inboxRole);
    return apiGet("/ward/safety-inbox?" + q)
      .then(function (r) {
        st.busy = false;
        if (r && r.ok) st.inbox = r;
        /* A failed LOAD is not an empty inbox. Said in the same words the list itself uses, because
         * the reader has to end up with the same belief either way: this is not a quiet ward. */
        else { st.inbox = null; st.err = "Could not load the safety inbox. Do not read this as a quiet ward."; }
        paint();
      })
      .catch(function () { st.busy = false; st.inbox = null; st.err = "Could not load the safety inbox. Do not read this as a quiet ward."; paint(); });
  }
  /* Opening the patient an item belongs to. It goes to the workspace rather than the raw chart,
   * because somebody acting on a safety item needs the context around it before they act. */
  function inboxOpenPatient(patientId) {
    if (!patientId) return;
    var found = null;
    (st.list || []).forEach(function (p) { if (p.patientId === patientId) found = p; });
    if (!found) { st.err = "That patient is not on the current ward list. Refresh the ward."; paint(); return; }
    st.sel = found;
    workspaceOpen();
  }

  function workspaceOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "workspace"; paint();
    loadChart(); loadNews2(); loadPeople();
  }

  /* Reads what is typed into the drawn form back into st.formAnswers, typed by field: numbers as numbers,
   * yes/no as booleans. Values of fields that are no longer shown are left out. */
  /* A form answer changed: re-read the answers and redraw, so a follow-up question appears the moment the
   * answer it depends on is given. "change" (not "input") so typing in a text box never loses focus. */
  function onFormChange(ev) {
    var t = ev && ev.target;
    /* D5: the Patient copy screen's portal preview follows the scope the clinician is about to release. */
    if (st.view === "pcopy" && t && t.id === "wPcopyScope") { st.pcopyScope = t.value === "full" ? "full" : "patient-copy"; paint(); return; }
    if (st.view !== "forms" || !st.formSel || !t || !(t.hasAttribute("data-w-formfield") || t.hasAttribute("data-w-formmulti"))) return;
    readFormAnswers(); paint();
  }
  function readFormAnswers() {
    var f = st.formSel; if (!f) return;
    var a = {};
    (f.sections || []).forEach(function (s) { (s.fields || []).forEach(function (fd) {
      if (fd.type === "calculated") return;
      if (fd.type === "multi_choice") {
        var boxes = document.querySelectorAll('[data-w-formmulti="' + fd.key + '"]'), picked = [];
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(boxes[i].value);
        if (picked.length) a[fd.key] = picked; return;
      }
      var v = val("wFf_" + fd.key); if (v === "") return;
      a[fd.key] = fd.type === "number" || fd.type === "integer" ? Number(v) : fd.type === "boolean" ? v === "true" : v;
    }); });
    st.formAnswers = a;
  }
  function loadReferrals() {
    var path = st.view === "referralinbox"
      ? "/ward/referral-inbox?orgId=" + encodeURIComponent(st.orgId) + "&specialty=" + encodeURIComponent(st.refSpecialty || "") + "&view=" + encodeURIComponent(st.refView || "")
      : "/ward/referrals?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel ? st.sel.patientId : "");
    return apiGet(path)
      .then(function (r) { st.referrals = r && r.ok ? r : { failed: true }; if (!(r && r.ok)) settle(r, null); paint(); })
      .catch(function () { st.referrals = { failed: true }; paint(); });
  }
  function referralCreate() {
    var s = st.sel; if (!s) return;
    var body = { orgId: st.orgId, patientId: s.patientId, encounterId: s.encounterId || undefined, specialty: val("wRefSpecialty"), urgency: val("wRefUrgency"),
      kind: val("wRefKind"), destinationFacility: val("wRefFacility"), reason: val("wRefReason"), clinicalSummary: val("wRefSummary") };
    st.busy = true; paint();
    apiPost("/ward/referral-create", body)
      .then(function (r) { if (settle(r, r && r.ok ? "Referral sent." : null)) loadReferrals(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not send the referral."; paint(); });
  }
  function loadSurveillance() {
    st.view = "surveillance"; st.surveillance = null; st.recordDetail = null; paint();
    apiGet("/ward/surveillance?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.surveillance = r && r.ok ? r : { failed: true }; if (!(r && r.ok)) settle(r, null); paint(); })
      .catch(function () { st.surveillance = { failed: true }; paint(); });
  }
  function survAck(arg) {
    var p = String(arg || "").split("~"), d = st.surveillance, row = d && d.rows && d.rows[Number(p[0])], sg = row && row.signals && row.signals[Number(p[1])];
    if (!sg) return;
    var note = ""; try { note = G.prompt("Acknowledge: " + sg.label + ". What was done or decided?") || ""; } catch (e) {}
    if (note.trim().length < 3) { st.err = "An acknowledgement needs a note."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/surveillance-ack", { orgId: st.orgId, patientId: row.patientId, encounterId: row.encounterId, signalId: sg.id, note: note.trim() })
      .then(function (r) { if (settle(r, "Acknowledged. The signal stays until the record changes.")) loadSurveillance(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the acknowledgement."; paint(); });
  }
  function loadNurseWorklist() {
    st.view = "nurseworklist"; st.nurseWorklist = null; paint();
    apiGet("/ward/nurse-worklist?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) { st.nurseWorklist = r && r.ok ? r : { failed: true }; if (!(r && r.ok)) settle(r, null); paint(); })
      .catch(function () { st.nurseWorklist = { failed: true }; paint(); });
  }
  function nursingPanelOpen(arg) {
    var p = String(arg || "").split("~"), row = ((st.nurseWorklist && st.nurseWorklist.rows) || []).filter(function (r) { return r.patientId === p[0]; })[0];
    st.view = "nursingpatient"; st.nursingPanel = { patientId: p[0], encounterId: p[1], name: row && row.patient ? row.patient.name : "", data: null }; paint();
    loadNursingPanel();
  }
  function loadNursingPanel() {
    var np = st.nursingPanel; if (!np) return;
    apiGet("/ward/nursing-patient?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(np.patientId) + "&encounterId=" + encodeURIComponent(np.encounterId))
      .then(function (r) { if (st.nursingPanel !== np) return; np.data = r && r.ok ? r : { failed: true }; if (!(r && r.ok)) settle(r, null); paint(); })
      .catch(function () { np.data = { failed: true }; paint(); });
  }
  function nursingVersion(k) { var d = st.nursingPanel && st.nursingPanel.data; return d && d[k] && d[k].version != null ? d[k].version : 0; }
  function nursingPost(path, body, okMsg) {
    var np = st.nursingPanel; if (!np) return;
    body.orgId = st.orgId; body.encounterId = np.encounterId;
    st.busy = true; paint();
    apiPost(path, body)
      .then(function (r) { if (settle(r, r && r.ok ? okMsg : null)) { np.data = null; paint(); loadNursingPanel(); } else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not save. Nothing was changed."; paint(); });
  }
  function referralAct(arg) {
    var p = String(arg || "").split("~"), id = p[0], action = p[1], version = Number(p[2]);
    var body = { orgId: st.orgId, referralId: id, action: action, expectedVersion: version };
    var ask = function (q) { try { return G.prompt(q) || ""; } catch (e) { return ""; } };
    if (action === "decline" || action === "cancel") { body.reason = ask(action === "decline" ? "Why is this referral declined? The referring team will see this." : "Why is this referral cancelled?"); if (!body.reason.trim()) return; }
    if (action === "respond") { body.response = ask("Your reply to the referring team:"); if (!body.response.trim()) return; }
    if (action === "schedule") { body.appointmentAt = ask("Appointment date and time (for example 2026-09-20 10:30):"); if (!body.appointmentAt.trim()) return; body.appointmentAt = body.appointmentAt.trim().replace(" ", "T"); }
    st.busy = true; paint();
    apiPost("/ward/referral-act", body)
      .then(function (r) { if (settle(r, r && r.ok ? "Referral updated." : null)) loadReferrals(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not update the referral."; paint(); });
  }
  function documentsOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "documents"; st.docs = null; st.docVersions = null; st.docNewVersion = null; paint(); loadDocuments();
  }
  function loadDocuments() {
    var s = st.sel; if (!s) return Promise.resolve();
    return apiGet("/ward/documents?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.docs = r && r.ok ? r : { failed: true }; if (!(r && r.ok)) settle(r, null); paint(); })
      .catch(function () { st.docs = { failed: true }; paint(); });
  }
  function documentUpload() {
    var s = st.sel, input = document.getElementById("wDocFile");
    var file = input && input.files && input.files[0];
    var title = val("wDocTitle"), target = st.docNewVersion;
    if (!file) { st.err = "Choose a file first."; paint(); return; }
    if (!title) { st.err = "Give the document a title."; paint(); return; }
    if (file.size > 10 * 1024 * 1024) { st.err = "Files are limited to 10 MB."; paint(); return; }
    var docType = target ? "" : val("wDocType");
    var reader = new FileReader();
    reader.onload = function () {
      var body = { orgId: st.orgId, title: title, contentType: file.type, dataBase64: String(reader.result || "") };
      if (target) { body.documentId = target.id; body.expectedVersion = target.version; body.docType = (st.docs.documents.filter(function (x) { return x.id === target.id; })[0] || {}).docType; }
      else { body.patientId = s.patientId; body.encounterId = s.encounterId || undefined; body.docType = docType; }
      st.busy = true; paint();
      apiPost("/ward/document-upload", body)
        .then(function (r) { if (settle(r, r && r.ok ? (target ? "New version uploaded." : "Document uploaded.") : null)) { st.docNewVersion = null; st.docVersions = null; loadDocuments(); } else paint(); })
        .catch(function () { st.busy = false; st.err = "Could not upload. Nothing was saved."; paint(); });
    };
    reader.onerror = function () { st.err = "Could not read that file."; paint(); };
    reader.readAsDataURL(file);
  }
  function documentOpen(arg) {
    var p = String(arg || "").split("~");
    // Opened now, filled in when the link arrives: a window opened after a network wait is blocked as a popup.
    var win = null; try { win = G.open("", "_blank"); } catch (e) {}
    apiPost("/ward/document-link", { orgId: st.orgId, documentId: p[0], version: Number(p[1]) })
      .then(function (r) {
        if (r && r.ok && r.url) { if (win) win.location.href = API.replace(/\/api\/queue$/, "") + r.url; else G.location.href = r.url; return; }
        if (win) try { win.close(); } catch (e) {}
        settle(r, null); paint();
      })
      .catch(function () { if (win) try { win.close(); } catch (e) {} st.err = "Could not open the document."; paint(); });
  }
  function documentVersionsLoad(id) {
    st.docVersions = { id: id }; paint();
    apiGet("/ward/document-versions?orgId=" + encodeURIComponent(st.orgId) + "&documentId=" + encodeURIComponent(id))
      .then(function (r) { st.docVersions = r && r.ok ? { id: id, versions: r.versions } : { id: id, failed: true }; paint(); })
      .catch(function () { st.docVersions = { id: id, failed: true }; paint(); });
  }
  function documentPurge(id) {
    if (!confirm("Delete the stored file for every version of this document?\n\nThe record that it existed, who uploaded it and when stays. This cannot be undone.")) return;
    st.busy = true; paint();
    apiPost("/ward/document-purge", { orgId: st.orgId, documentId: id })
      .then(function (r) { if (settle(r, r && r.ok ? "File deleted. The record of the document is kept." : null)) loadDocuments(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not delete the file."; paint(); });
  }
  function documentWithdraw(id) {
    var reason = "";
    try { reason = G.prompt("Why is this document being withdrawn? (For example: scanned under the wrong patient.) The file is kept.") || ""; } catch (e) {}
    if (!reason.trim()) return;
    st.busy = true; paint();
    apiPost("/ward/document-withdraw", { orgId: st.orgId, documentId: id, reason: reason.trim() })
      .then(function (r) { if (settle(r, r && r.ok ? "Document withdrawn. The file is kept." : null)) loadDocuments(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not withdraw the document."; paint(); });
  }
  function documentRelease(arg) {
    var p = String(arg || "").split("~"), reason = "";
    try { reason = G.prompt("Release version " + p[1] + " of this document to the patient portal?\n\nSay why, or give the consent reference. The patient, and any family member granted documents, will be able to download it.") || ""; } catch (e) {}
    if (!reason.trim()) return;
    st.busy = true; paint();
    apiPost("/ward/document-release", { orgId: st.orgId, documentId: p[0], version: Number(p[1]), reason: reason.trim() })
      // Reloaded, so the document's release list shows this release rather than the list from before it.
      .then(function (r) { if (settle(r, r && r.ok ? "Released to the patient portal." : null)) loadDocuments(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not release the document. Nothing was released."; paint(); });
  }
  function immunizationsOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "immunizations"; st.immunizations = null; paint(); loadImmunizations();
  }
  function loadImmunizations() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return apiGet("/ward/immunizations?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.busy = false; st.immunizations = r && r.ok ? r : false; paint(); })
      .catch(function () { st.busy = false; st.immunizations = false; paint(); });
  }
  function immunizationAdd() {
    var s = st.sel; if (!s) return;
    var vaccine = val("wImVac");
    if (!vaccine) { st.err = "Write the vaccine as it was given."; paint(); return; }
    var reported = checked("wImReported");
    var imm = {
      vaccine: vaccine, occurredOn: val("wImDate"), doseNumber: val("wImDose") || undefined, status: val("wImStatus") || "completed",
      statusReason: val("wImReason") || undefined, lotNumber: val("wImLot") || undefined, site: val("wImSite") || undefined,
      route: val("wImRoute") || undefined, performerName: val("wImBy") || undefined,
      vaccineCode: val("wImCode") || undefined, vaccineCodeSystem: val("wImSys") || undefined,
      primarySource: !reported, encounterId: s.encounterId || undefined,
    };
    st.busy = true; paint();
    apiPost("/ward/immunization", { orgId: st.orgId, patientId: s.patientId, immunization: imm })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Recorded." : null)) {
          ["wImVac", "wImDate", "wImDose", "wImReason", "wImLot", "wImSite", "wImRoute", "wImBy", "wImCode"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          loadImmunizations();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that. Nothing was saved."; paint(); });
  }
  function immunizationError(id) {
    var reason = prompt("Why is this entry wrong? It stays on the record, marked as withdrawn.") || "";
    if (!reason) return;
    st.busy = true; paint();
    apiPost("/ward/immunization-error", { orgId: st.orgId, immunizationId: id, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? "Withdrawn. It stays on the record." : null)) loadImmunizations(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not withdraw that."; paint(); });
  }

  function peopleOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.view = "people"; st.people = null; paint(); loadPeople();
  }
  function loadPeople() {
    var s = st.sel; if (!s) return Promise.resolve();
    st.busy = true; paint();
    return apiGet("/ward/related-people?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(s.patientId))
      .then(function (r) { st.busy = false; if (r && r.ok) st.people = r; paint(); })
      .catch(function () { st.busy = false; paint(); });
  }
  function personAdd() {
    var s = st.sel; if (!s) return;
    var name = val("wPerName");
    if (!name) { st.err = "A contact needs a name."; paint(); return; }
    var person = {
      name: name, relationship: val("wPerRel"), phone: val("wPerPhone"),
      nextOfKin: checked("wPerKin"), guardian: checked("wPerGuard"), emergencyContact: checked("wPerEmg"),
    };
    st.busy = true; paint();
    apiPost("/ward/related-person", { orgId: st.orgId, patientId: s.patientId, person: person })
      .then(function (r) {
        if (settle(r, r && r.ok ? "Recorded." : null)) {
          ["wPerName", "wPerPhone"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          ["wPerKin", "wPerGuard", "wPerEmg"].forEach(function (id) { var el = document.getElementById(id); if (el) el.checked = false; });
          loadPeople();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not record that contact."; paint(); });
  }
  function personRemove(id) {
    var reason = prompt("Why is this contact being removed? (optional)") || "";
    st.busy = true; paint();
    apiPost("/ward/related-person-remove", { orgId: st.orgId, relatedPersonId: id, reason: reason || undefined })
      .then(function (r) { if (settle(r, r && r.ok ? "Removed. It stays on the record." : null)) loadPeople(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not remove that."; paint(); });
  }
  /* Recording a death asks twice, on purpose, and the second ask names the patient. A mis-click on
   * a ward list is exactly how the wrong person gets recorded dead, and the server refuses anything
   * that does not carry an explicit confirmation - this is the screen half of that. */
  function deathRecord() {
    var s = st.sel; if (!s) return;
    var who = s.name || s.patientId;
    if (!confirm("Record that " + who + " has died?\n\nThis is recorded permanently against this patient.")) return;
    var at = prompt("When did they die? Leave blank for now.\n(YYYY-MM-DD HH:MM)") || "";
    var cause = prompt("Cause, if known (optional)") || "";
    var certifiedBy = prompt("Certified by (optional)") || "";
    var iso = "";
    if (at) {
      var parsed = new Date(at.replace(" ", "T"));
      if (isNaN(parsed.getTime())) { st.err = "That date could not be read. Nothing was recorded."; paint(); return; }
      iso = parsed.toISOString();
    }
    st.busy = true; paint();
    apiPost("/ward/deceased", {
      orgId: st.orgId, patientId: s.patientId, confirm: true,
      deceased: { at: iso || undefined, cause: cause || undefined, certifiedBy: certifiedBy || undefined },
    })
      .then(function (r) { if (settle(r, r && r.ok ? "Recorded." : null)) loadPeople(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record that."; paint(); });
  }
  function deathWithdraw() {
    var s = st.sel; if (!s) return;
    var reason = prompt("Why is this being withdrawn?") || "";
    if (!reason) { st.err = "A withdrawal needs a reason."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/deceased-correct", { orgId: st.orgId, patientId: s.patientId, reason: reason })
      .then(function (r) { if (settle(r, r && r.ok ? r.detail : null)) loadPeople(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not withdraw that."; paint(); });
  }

  function consultationOpen() {
    if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
    st.consultationResult = null; st.cDraft = null; st.cIcd = undefined;
    st.view = "consultation";
    paint();
    // The note section cannot offer a template it has not been told about.
    if (!st.templates) loadTemplates();
  }

  /* Collects whatever the clinician actually filled in and sends it as ONE consultation. Sections
   * left blank are not sent at all, so an empty box never becomes an empty record. Nothing here is
   * validated beyond "is this section filled in enough to mean anything" - every real rule, from
   * the formulary to the dose ceiling to who may prescribe at all, is the server's, and its refusal
   * is shown as it came back. */
  function saveWholeConsultation() {
    var s = st.sel; if (!s) return;
    /* Snapshot BEFORE any of the checks below, because every one of them ends in paint() - so
     * without this, telling a doctor "a prescription needs the drug, the dose and the unit" would
     * also wipe the vitals and the note they had already typed. */
    cSnapshot();
    var body = { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId };

    var v = {}, anyVital = false;
    VITALS.forEach(function (f) { var x = val("wc_" + f.k); if (x) { v[f.k] = x; anyVital = true; } });
    // The units the boxes were LABELLED with travel with the values, exactly as the vitals card does.
    if (v.temp) v.tempUnit = st.region === "US" ? "F" : "C";
    if (v.weight) v.weightUnit = st.region === "US" ? "lb" : "kg";
    var o2 = val("wc_o2"); if (o2 !== "") { v.o2 = o2; anyVital = true; }
    var ac = val("wc_acvpu"); if (ac) { v.acvpu = ac; anyVital = true; }
    if (anyVital) body.vitals = [v];

    var probText = val("wcProbText"), probCode = val("wcProbCode");
    if (probText || probCode) {
      body.problems = [{ patientId: s.patientId, encounterId: s.encounterId, display: probText, code: probCode,
        verificationStatus: val("wcProbVs") || undefined }];
    }

    var drug = val("wcMoDrug"), dv = val("wcMoValue"), du = val("wcMoUnit");
    if (drug || dv || du) {
      /* Refused HERE rather than sent, because a half-written prescription is the one section where
       * sending what was typed and letting the server sort it out is the wrong answer: the whole
       * consultation would be refused for a typo, after the doctor had filled in everything else. */
      if (!drug || !dv || !du) { st.err = "A prescription needs the drug, the dose and the unit. Fill all three, or clear them."; paint(); return; }
      body.medications = [{ patientId: s.patientId, encounterId: s.encounterId, drug: drug,
        dose: { value: dv, unit: du }, route: val("wcMoRoute") || undefined, frequency: val("wcMoFreq") || undefined }];
    }

    var inv = val("wcInvCode");
    if (inv) body.investigations = [{ display: inv, code: inv, priority: val("wcInvPri") || undefined, reason: val("wcInvReason") || undefined }];

    var tpl = val("wcNoteTpl"), noteText = val("wcNoteText");
    if (tpl || noteText) {
      if (!tpl) { st.err = "Choose a template for the note, or clear the note."; paint(); return; }
      body.note = { templateId: tpl, sections: { narrative: noteText } };
    }

    if (!body.vitals && !body.problems && !body.medications && !body.investigations && !body.note) {
      st.err = "Nothing was filled in."; paint(); return;
    }

    st.busy = true; st.consultationResult = null; paint();
    apiPost("/ward/consultation", body)
      .then(function (r) {
        st.busy = false;
        /* The server's own per-piece answer is kept and rendered in full. This deliberately does NOT
         * go through settle(): settle reduces a reply to one success line or one error line, which
         * is precisely the flattening that let a refused prescription hide behind a saved note. */
        st.consultationResult = r || null;
        if (r && r.ok) {
          st.err = "";
          clearConsultationFields();
          // What was just written has to be re-read, or the chart under this screen still shows the
          // ward as it was before the consultation happened.
          loadChart(); loadFlowsheet(); loadNews2(); loadRound();
        } else if (!r) {
          st.err = "Could not save the consultation.";
        } else {
          st.err = "";
        }
        paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not save the consultation."; paint(); });
  }

  function consultationFindCode() {
    cSnapshot();
    var q = cDraft(st.cDraft, "wcProbText");
    if (!q) { st.err = "Type the diagnosis first, then search for its code."; paint(); return; }
    st.cIcd = null; paint();
    icdSearch(q)
      .then(function (rows) { st.cIcd = rows; paint(); })
      // A code service that is down must never stop a diagnosis being recorded. The words still
      // work, and the screen says so rather than leaving a spinner up.
      .catch(function () { st.cIcd = []; st.err = "The code search is unavailable. Record the diagnosis in words."; paint(); });
  }
  function consultationPickCode(i) {
    var c = (st.cIcd || [])[i];
    if (!c) return;
    cSnapshot();
    st.cDraft.wcProbCode = c.code;
    // The official title becomes the words, so the record says what the code actually means rather
    // than what somebody typed on the way to finding it.
    st.cDraft.wcProbText = c.title;
    st.cIcd = undefined;
    paint();
  }

  function clearConsultationFields() {
    // The draft goes with them, or the next repaint puts the saved consultation straight back.
    st.cDraft = null; st.cIcd = undefined;
    VITALS.forEach(function (f) { var el = document.getElementById("wc_" + f.k); if (el) el.value = ""; });
    ["wc_o2", "wc_acvpu", "wcProbText", "wcProbCode", "wcProbVs", "wcMoDrug", "wcMoValue", "wcMoUnit",
      "wcMoRoute", "wcMoFreq", "wcInvCode", "wcInvReason", "wcInvPri", "wcNoteTpl", "wcNoteText"]
      .forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
  }

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
    var clearNote = function () { tpl.sections.forEach(function (sec) { var el = document.getElementById("wNote_" + sec.key); if (el) el.value = ""; }); };
    bedsideWrite("note", { orgId: st.orgId, templateId: tpl.id, encounterId: s.encounterId, patientId: s.patientId, sections: sections, at: new Date().toISOString() },
      { label: (tpl.name || "Note"), patientId: s.patientId, onKept: clearNote },
      function (r) {
        if (settle(r, r && r.incomplete ? null : "Note saved.")) {
          st.noteResult = r;
          clearNote();
          loadCosigns();
        }
        paint();
      }, "Could not save the note.");
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
  function loadWardMetrics() {
    st.wardMetrics = { busy: true };
    return apiGet("/ward/metrics?orgId=" + encodeURIComponent(st.orgId) + (st.ward ? "&ward=" + encodeURIComponent(st.ward) : ""))
      .then(function (r) { st.wardMetrics = r && r.ok ? r : { ok: false, error: r && r.error }; paint(); })
      .catch(function () { st.wardMetrics = { ok: false }; paint(); });
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
  function loadQualitySafety(days) {
    st.view = "qualitysafety"; st.qsDays = days || st.qsDays || 30; st.qs = { busy: true }; paint();
    return apiGet("/ward/quality-safety?orgId=" + encodeURIComponent(st.orgId) + "&days=" + st.qsDays)
      .then(function (r) { st.qs = r && r.ok ? r : { ok: false, status: r && r.__status, error: r && r.error }; if (r && (r.error === "permission" || r.error === "forbidden")) st.qs.status = 403; paint(); })
      .catch(function () { st.qs = { ok: false }; paint(); });
  }
  function incidentConfirm(id) {
    var outcome = val("wIncOutcome_" + id), reason = val("wIncConfReason_" + id), category = val("wIncConfCat_" + id), dup = val("wIncDupOf_" + id);
    if (!outcome) { st.err = "Pick a decision."; paint(); return; }
    if (!reason) { st.err = "A decision needs a reason."; paint(); return; }
    if (outcome === "duplicate" && !dup) { st.err = "Name the incident this duplicates."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-confirm", { orgId: st.orgId, incidentId: id, outcome: outcome, reason: reason, category: category || undefined, duplicateOf: dup || undefined })
      .then(function (r) { if (settle(r, "Decision recorded.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the decision."; paint(); });
  }
  /* Raising a signal from where it was noticed. The severity question is the same one the report form asks. */
  function askSignal() {
    var what = window.prompt("What happened? A sentence is enough.");
    if (!what || what.length < 3) return null;
    var severity = window.prompt("What reached the patient? near-miss, no-harm, minor, moderate, major or catastrophic", "near-miss");
    if (!severity) return null;
    severity = String(severity).trim().toLowerCase();
    if (!INCIDENT_SEVERITY.some(function (x) { return x[0] === severity; })) { st.err = "Severity must be one of near-miss, no-harm, minor, moderate, major, catastrophic."; paint(); return null; }
    return { what: what, severity: severity };
  }
  function incidentSignal(resourceType, id) {
    var a = askSignal(); if (!a) return;
    st.busy = true; paint();
    apiPost("/ward/incident-signal", { orgId: st.orgId, what: a.what, severity: a.severity, source: { resourceType: resourceType, id: id } })
      .then(function (r) { settle(r, r && r.written ? "Safety signal raised. An investigator will confirm or reject it." : null); paint(); })
      .catch(function () { st.busy = false; st.err = "Could not raise the signal."; paint(); });
  }
  function incidentSignalNews2(patientId) {
    var a = askSignal(); if (!a) return;
    st.busy = true; paint();
    apiPost("/ward/incident-report", { orgId: st.orgId, what: a.what, severity: a.severity, patientId: patientId, category: "deterioration-not-recognised" })
      .then(function (r) { settle(r, r && r.written ? "Safety signal raised. An investigator will confirm or reject it." : null); paint(); })
      .catch(function () { st.busy = false; st.err = "Could not raise the signal."; paint(); });
  }
  function incidentsOpen() {
    st.view = "incidents"; st.incidentLog = null; st.incidentHealth = null; paint(); loadIncidents();
  }
  function loadIncidents() {
    st.busy = true; paint();
    return apiGet("/ward/incident-log?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        st.busy = false;
        // The ledger is incident.investigate only; filing is incident.report and nearly every
        // clinical role holds it. A reporter without the ledger cap did nothing wrong by opening
        // this screen to file - so a refused ledger read stays silent, same reasoning as the
        // co-sign worklist elsewhere in this file, and st.incidentLog simply stays null (the
        // view's own signal to show the filing form alone, not a ledger that never loaded).
        if (r && r.ok) { st.incidentLog = r.incidents || []; st.incidentHealth = r.health || null; }
        paint();
      })
      .catch(function () { st.busy = false; paint(); });
  }
  function reportIncidentAction() {
    var what = val("wIncWhat"), severity = val("wIncSeverity"), whenAt = val("wIncWhen"), patientId = val("wIncPatient"), category = val("wIncCategory");
    var anonEl = document.getElementById("wIncAnon");
    var anon = !!(anonEl && anonEl.checked);
    if (!what || what.length < 3) { st.err = "Describe what happened, in a sentence or two."; paint(); return; }
    if (!severity) { st.err = "Pick what actually reached the patient."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-report", { orgId: st.orgId, what: what, severity: severity, when: whenAt || undefined, anonymous: anon, patientId: patientId || undefined, category: category || undefined })
      .then(function (r) {
        if (settle(r, r && r.written ? "Reported." : null)) {
          ["wIncWhat", "wIncWhen", "wIncPatient"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
          if (anonEl) anonEl.checked = false;
          loadIncidents();
        } else paint();
      })
      .catch(function () { st.busy = false; st.err = "Could not file the report."; paint(); });
  }
  function incidentTriage(id) {
    var likelihood = val("wIncLk_" + id);
    if (!likelihood) { st.err = "Pick a likelihood before triaging."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-triage", { orgId: st.orgId, incidentId: id, likelihood: likelihood })
      .then(function (r) { if (settle(r, "Triaged.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not triage."; paint(); });
  }
  function incidentRca(id) {
    var rootCause = val("wIncRoot_" + id), method = val("wIncMethod_" + id);
    var factors = val("wIncFactors_" + id).split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (!rootCause) { st.err = "An RCA needs a root cause."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-rca", { orgId: st.orgId, incidentId: id, rootCause: rootCause, method: method || undefined, contributingFactors: factors })
      .then(function (r) { if (settle(r, "Root cause recorded.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the root cause."; paint(); });
  }
  function incidentCapaAdd(id) {
    var action = val("wIncCapaAction_" + id), owner = val("wIncCapaOwner_" + id), dueBy = val("wIncCapaDue_" + id), strength = val("wIncCapaStrength_" + id);
    if (!action || !owner || !dueBy) { st.err = "A corrective action needs the action, an owner and a due date."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-capa", { orgId: st.orgId, incidentId: id, action: action, owner: owner, dueBy: dueBy, strength: strength || undefined })
      .then(function (r) { if (settle(r, "Action added.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not add the action."; paint(); });
  }
  function incidentCapaComplete(id, capaId) {
    var by = val("wIncCapaBy_" + capaId), evidence = val("wIncCapaEvidence_" + capaId);
    if (!by || !evidence) { st.err = "Completing an action needs who did it and what shows it was done."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/incident-capa-complete", { orgId: st.orgId, incidentId: id, capaId: capaId, by: by, evidence: evidence })
      .then(function (r) { if (settle(r, "Action completed.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not complete the action."; paint(); });
  }
  function incidentClose(id) {
    var by = window.prompt("Your name, to close this incident:");
    if (!by) return;
    st.busy = true; paint();
    apiPost("/ward/incident-close", { orgId: st.orgId, incidentId: id, by: by })
      .then(function (r) { if (settle(r, "Closed.")) loadIncidents(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not close the incident."; paint(); });
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
    // A scope chosen for one patient is never carried to the next: each starts at the patient copy.
    if (st.pcopyFor !== st.sel.patientId) { st.pcopyScope = null; st.pcopyFor = st.sel.patientId; }
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
    var scope = val("wPcopyScope") || "patient-copy";   // read before paint() redraws the select
    st.pcopyScope = scope; st.busy = true; paint();
    return apiPost("/ward/patient-release", { orgId: st.orgId, patientId: st.sel.patientId, dischargeScope: scope })
      /* The response carries the document it recorded, so the page then on screen is the page that
       * was released - not the one loaded some minutes earlier that the record may have moved past. */
      .then(function (r) { if (settle(r)) { st.pcopy = r; st.ok = "Handover recorded."; } paint(); })
      .catch(function () { st.busy = false; st.err = "Could not record the handover."; paint(); });
  }
  function ipsOpen() {
    if (!st.sel || !st.sel.patientId) return;
    st.view = "ips"; st.ips = null; paint();
    var pid = st.sel.patientId;
    return apiGet("/ward/fhir/Patient/" + encodeURIComponent(pid) + "/$summary?orgId=" + encodeURIComponent(st.orgId))
      .then(function (r) {
        if (!st.sel || st.sel.patientId !== pid) return;
        st.ips = r && r.resourceType === "Bundle" ? r
          : { failed: (r && r.issue && r.issue[0] && r.issue[0].diagnostics) || (r && r.error) || "no answer from the server" };
        paint();
      })
      .catch(function () { st.ips = { failed: "could not reach the ward" }; paint(); });
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
          invoices: (inv && inv.ok) ? inv.invoices : null, outstandingBalance: (inv && inv.ok) ? inv.outstandingBalance : null,
          claims: (cl && cl.ok) ? cl.claims : null,
        };
        if (!(inv && inv.ok) && !(cl && cl.ok)) st.err = "Could not load billing.";
        paint();
      })
      .catch(function () { st.busy = false; st.billing = { invoices: null, claims: null }; st.err = "Could not load billing."; paint(); });
  }
  function tpaOpen() {
    st.view = "tpa"; st.tpa = null; paint(); loadTpa();
  }
  function loadTpa() {
    if (!st.sel || !st.sel.patientId) return;
    st.busy = true; paint();
    return apiGet("/ward/claims?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId))
      .then(function (r) { st.busy = false; st.tpa = (r && r.ok) ? r : { failed: true }; paint(); })
      .catch(function () { st.busy = false; st.tpa = { failed: true }; paint(); });
  }
  function claimCodeAction() {
    if (!st.sel || !st.sel.patientId || !st.sel.encounterId) return;
    var codes = val("wTpaCodes").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!codes.length) { st.err = "Enter at least one code to claim."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/claim", { orgId: st.orgId, patientId: st.sel.patientId, encounterId: st.sel.encounterId, codes: codes, payerId: val("wTpaPayer") || undefined, policyNumber: val("wTpaPolicy") || undefined })
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
  function claimAckAction(claimId) {
    var ref = window.prompt("The payer's acknowledgement reference:");
    if (!ref) return;
    claimActionCall(claimId, "acknowledge", { payerReference: ref });
  }
  /* Settlement records what the payer paid and why any of it was short. The balance stays on the
   * claim; moving it to the patient is the separate button below, never a side effect of this. */
  function claimSettleAction(claimId) {
    var paid = window.prompt("Amount the payer actually paid:");
    if (paid == null || paid === "") return;
    var shortReason = window.prompt("Payer's reason for any short payment (blank if paid in full):");
    var dis = window.prompt("Disallowances, as reason:amount; reason:amount (blank if none):");
    var disallowances = (dis || "").split(";").map(function (x) {
      var i = x.lastIndexOf(":"); var reason = (i > 0 ? x.slice(0, i) : x).trim(); var amt = i > 0 ? Number(x.slice(i + 1)) : null;
      return { reason: reason, amount: amt };
    }).filter(function (d) { return d.reason; });
    claimActionCall(claimId, "settle", { paidAmount: Number(paid), shortPaymentReason: shortReason || undefined, disallowances: disallowances });
  }
  function claimBalanceAction(claimId) {
    var amount = window.prompt("Amount to move to the patient's account:");
    if (!amount) return;
    var reason = window.prompt("Why this balance is the patient's to pay:");
    if (!reason) { st.err = "Moving a balance to the patient needs a reason."; paint(); return; }
    claimActionCall(claimId, "balance-to-patient", { amount: Number(amount), reason: reason });
  }
  function estimateAction() {
    if (!st.sel || !st.sel.patientId) return;
    var lines = val("wTpaEstLines").split(",").map(function (x) {
      var m = x.trim().split(/\s+x\s*/i);
      return { code: (m[0] || "").trim(), quantity: m[1] ? Number(m[1]) : 1 };
    }).filter(function (l) { return l.code; });
    if (!lines.length) { st.err = "Enter at least one tariff line."; paint(); return; }
    st.busy = true; paint();
    apiPost("/ward/claim-estimate", { orgId: st.orgId, patientId: st.sel.patientId, lines: lines, payerId: val("wTpaEstPayer") || undefined })
      .then(function (r) { if (settle(r, "Estimate prepared.")) loadTpa(); else paint(); })
      .catch(function () { st.busy = false; st.err = "Could not prepare that estimate."; paint(); });
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
      payerId: val("wTpaAuthPayer") || undefined,
      requestedAmount: val("wTpaAuthRequested") ? Number(val("wTpaAuthRequested")) : undefined,
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
    var clearVitals = function () {
      VITALS.forEach(function (f) { var el = document.getElementById("wv_" + f.k); if (el) el.value = ""; });
      ["wv_o2", "wv_acvpu"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
    };
    bedsideWrite("vitals", { orgId: st.orgId, encounterId: s.encounterId, patientId: s.patientId, vitals: v, recordedAt: new Date().toISOString() },
      { label: "Vitals", patientId: s.patientId, onKept: clearVitals }, function (r) {
        // `written: 0` with ok:true is the server saying nothing was numeric. Say so plainly rather
        // than showing a success message for a save that recorded nothing.
        if (settle(r, r && r.written ? "Recorded " + r.written + " observation" + (r.written === 1 ? "" : "s") + "." : null)) {
          if (r && !r.written) st.err = "Nothing was recorded - no field held a plain number.";
          else {
            clearVitals();
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
      }, "Could not record vitals.");
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
    /* G2: the order as the nurse saw it on the round. The eMAR refuses the step if the order has changed
     * since, which is what makes a dose charted offline safe to send later. */
    if (d.orderVersion != null) body.expectedOrderVersion = d.orderVersion;
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
    bedsideWrite("mar", body, { label: (d.drug || "Dose") + " " + action, patientId: s.patientId, expectedVersion: d.orderVersion },
      function (r) {
        if (r && r.error === "order_changed") { st.busy = false; st.err = "Not recorded: this order changed after the round was loaded. Reload the round and check the order before giving or charting."; paint(); return; }
        if (settle(r, r && r.to ? action + ": " + r.from + " → " + r.to : null)) loadRound(); else paint();
      }, "Could not reach the eMAR.");
  }

  /* P2.16 THE KEYBOARD LAYER. ONE declarative map, and nothing in it writes.
   *
   * Every entry moves focus, shows this list, or sends an EXISTING navigation verb through dispatch(),
   * the same path a click takes. A write (verify, administer, acknowledge, save, sign) is never bound:
   * at a bedside a stray key must not do what a deliberate press does. test/ward-keyboard.test.mjs
   * drives every entry and fails on any POST.
   *
   * No shortcut fires while typing in a field; Escape there only leaves the field. A key that would
   * repaint is refused while the screen holds unsaved typing, because a repaint discards it. */
  var SHORTCUTS = [
    { keys: "/", label: "Search patients, or filter the ward", focus: ["wQ", "wWard", "wTlQ"] },
    { keys: "g w", label: "Go to the ward list", go: "list" },
    { keys: "g c", label: "Go to the critical results board", act: "critsboard" },
    { keys: "g l", label: "Go to the laboratory board", act: "labboard" },
    { keys: "n", label: "Notes and timeline", act: "timeline", on: "chart" },
    { keys: "o", label: "Order sets", act: "ordersets", on: "chart" },
    { keys: "r", label: "Results and investigations", card: "investigations", on: "chart" },
    { keys: "v", label: "Vitals and flowsheet", card: "flowsheet", on: "chart" },
    { keys: "?", label: "Show these shortcuts", sheet: true },
    { keys: "Escape", label: "Close the open panel, or go back", esc: true }
  ];
  /* What Escape closes, innermost first: each panel's own close verb, used only while that close button
   * is on screen. With none of them open, Escape is Back. */
  var ESC_CLOSES = ["labresultclose", "cultureclose", "histoclose", "timelinedetailclose", "trendeventsclose", "trendwardclose",
    "twindrillclose", "flowdrillclose", "edarrivalclose", "surgerybookclose", "unpickbed", "riskcancel", "docnewversioncancel", "mpimergecancel"];
  function typingIn(t) {
    var tag = t && t.tagName ? String(t.tagName).toUpperCase() : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(t && t.isContentEditable);
  }
  /* Pure: the entry a key press means on this view; {g:true} for the first half of a chord, {blur:true}
   * for Escape inside a field, null for anything else. */
  function keyIntent(e, view, gPending) {
    if (!e || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
    if (typingIn(e.target)) return e.key === "Escape" ? { blur: true } : null;
    if (!gPending && e.key === "g") return { g: true };
    var combo = gPending ? "g " + e.key : e.key;
    for (var i = 0; i < SHORTCUTS.length; i++) {
      if (SHORTCUTS[i].keys === combo && (!SHORTCUTS[i].on || SHORTCUTS[i].on === view)) return SHORTCUTS[i];
    }
    return null;
  }
  function announce(msg) {
    var live = document.getElementById("wKeysLive");
    if (!live) {
      live = document.createElement("div"); live.id = "wKeysLive";
      live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
      live.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;";
      var r = root(); r.parentNode.insertBefore(live, r);
    }
    live.textContent = "";
    setTimeout(function () { live.textContent = msg; }, 30);
  }
  function keySheetHtml() {
    return '<div class="w-card-h"><h3 id="wKeysTitle">Keyboard shortcuts</h3><button class="w-ic" data-w-act="keysclose" aria-label="Close shortcuts">' + ms("close") + "</button></div>" +
      "<dl>" + SHORTCUTS.map(function (s) {
        return "<div><dt>" + s.keys.split(" ").map(function (k) { return "<kbd>" + esc(k === "Escape" ? "Esc" : k) + "</kbd>"; }).join(" then ") + "</dt><dd>" + esc(s.label) + (s.on ? " (on a chart)" : "") + "</dd></div>";
      }).join("") + "</dl>" +
      '<p class="w-hint">Shortcuts only move around. Nothing is saved, given or signed from the keyboard, and no shortcut works while you are typing in a field.</p>';
  }
  function showKeys() {
    var sh = document.getElementById("wKeys");
    if (!sh) {
      sh = document.createElement("div"); sh.id = "wKeys"; sh.className = "w-keys";
      sh.setAttribute("role", "dialog"); sh.setAttribute("aria-labelledby", "wKeysTitle");
      root().appendChild(sh);
    }
    sh.innerHTML = keySheetHtml();
    var b = sh.querySelector && sh.querySelector('[data-w-act="keysclose"]'); if (b) { try { b.focus(); } catch (e) {} }
    announce("Keyboard shortcuts shown. Escape closes them.");
  }
  function hideKeys() { var sh = document.getElementById("wKeys"); if (sh && sh.parentNode) sh.parentNode.removeChild(sh); }
  /* Typing a repaint would throw away. A search box is excluded: the roster search is live and kept in st. */
  function unsavedTyping(r) {
    if (st.view === "consultation" && st.cDraft) { for (var k in st.cDraft) if (st.cDraft[k]) return true; }
    var els = r.querySelectorAll ? r.querySelectorAll("input, textarea, select") : [];
    for (var i = 0; i < els.length; i++) {
      var x = els[i], t = String(x.type || "").toLowerCase();
      if (t === "search" || x.id === "wQ" || x.id === "wWard") continue;
      if (t === "checkbox" || t === "radio") { if (x.checked !== x.defaultChecked) return true; continue; }
      if (String(x.tagName).toUpperCase() === "SELECT") {
        var di = 0; for (var j = 0; j < x.options.length; j++) if (x.options[j].defaultSelected) di = j;
        if (x.selectedIndex !== di) return true; continue;
      }
      if (x.value !== x.defaultValue) return true;
    }
    return false;
  }
  function runShortcut(s) {
    var r = root();
    if (s.sheet) { showKeys(); return; }
    if (s.esc && document.getElementById("wKeys")) { hideKeys(); announce("Shortcuts closed."); return; }
    if (s.focus) {
      for (var i = 0; i < s.focus.length; i++) {
        var f = document.getElementById(s.focus[i]);
        if (f && r.contains(f)) { f.focus(); announce(s.label); return; }
      }
      announce("There is no search on this screen."); return;
    }
    if (s.card) {
      var c = r.querySelector('[data-w-act="' + s.card + '"]');
      if (!c) { announce(s.label + " is not on this screen."); return; }
      try { c.scrollIntoView({ block: "start" }); c.focus({ preventScroll: true }); } catch (e) {}
      announce(s.label + ". Focus is on its refresh button."); return;
    }
    if (unsavedTyping(r)) { announce("This screen has unsaved entries. Save or clear them first: moving now would discard them."); return; }
    hideKeys();
    if (s.esc) {
      for (var j = 0; j < ESC_CLOSES.length; j++) {
        if (r.querySelector('[data-w-act="' + ESC_CLOSES[j] + '"]')) { dispatch(ESC_CLOSES[j]); announce("Closed."); return; }
      }
      if (st.view !== "list") { dispatch("back"); announce("Back."); }
      return;
    }
    if (s.go === "list") {
      // ponytail: walks the existing Back verb (at most six hops) rather than a second reset path.
      for (var hop = 0; st.view !== "list" && hop < 6; hop++) dispatch("back");
      if (!st.loaded) loadWard();
      announce(s.label); return;
    }
    dispatch(s.act); announce(s.label);
  }
  var _gAt = 0;
  function onKey(e) {
    var r = document.getElementById("smdWard");
    if (!r || !r.classList.contains("on")) return;
    // The forced acknowledgement screen and the sheets opened over the ward own the keyboard.
    if (document.getElementById("wsq-alert")) return;
    var dc = document.getElementById("smdDischarge"); if (dc && dc.classList.contains("on")) return;
    var t = e.target;
    if (t && t !== document.body && t !== document.documentElement && t !== document && !r.contains(t)) return;
    var gPending = !!_gAt && Date.now() - _gAt < 1500; _gAt = 0;
    var s = keyIntent(e, st.view, gPending);
    if (!s) return;
    if (s.g) { _gAt = Date.now(); announce("Go to: w ward list, c critical results, l laboratory board."); return; }
    e.preventDefault();
    if (s.blur) { try { t.blur(); } catch (x) {} return; }
    runShortcut(s);
  }
  /* The single-key shortcuts are stated on the controls they reach, for screen readers. */
  function markShortcuts(el) {
    if (!el.querySelectorAll) return;
    SHORTCUTS.forEach(function (s) {
      if (s.keys.length !== 1) return;
      var sel = s.act || s.card ? '[data-w-act="' + (s.act || s.card) + '"]' : s.focus ? s.focus.map(function (id) { return "#" + id; }).join(",") : "";
      if (!sel) return;
      var hit = el.querySelectorAll(sel);
      for (var i = 0; i < hit.length; i++) hit[i].setAttribute("aria-keyshortcuts", s.keys);
    });
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
    if (cmd === "keys") { showKeys(); return; }
    if (cmd === "keysclose") { hideKeys(); return; }
    if (cmd === "dismiss") { st.err = ""; st.note = ""; st.refusal = null; paint(); return; }
    if (cmd === "offlinereview") { outbox(); st.offBack = st.view === "offline" ? st.offBack : st.view; st.view = "offline"; st.offEdit = null; paint(); return; }
    if (cmd === "offlineback") { st.view = st.offBack || (st.sel ? "chart" : "list"); st.offEdit = null; paint(); return; }
    if (cmd === "offlinesync") { syncOutbox(); return; }
    if (cmd === "offlineedit") { st.offEdit = arg; paint(); return; }
    if (cmd === "offlineresend") { offlineChoice(arg, "resend"); return; }
    if (cmd === "offlineeditsend") { offlineChoice(arg, "edit"); return; }
    if (cmd === "offlinediscard") { offlineChoice(arg, "discard"); return; }
    if (cmd === "reload") { loadWard(); return; }
    if (cmd === "setward") { st.ward = val("wWard"); loadWard(); return; }
    if (cmd === "setcls") { st.cls = arg; var r0 = document.getElementById("wRoster"); if (r0) r0.innerHTML = rosterHtml(st); else paint(); return; }
    if (cmd === "back") {
      /* The patient's copy is opened FROM a chart, so back returns to that chart rather than
       * throwing the selection away - and the copy itself is always dropped, because a page with
       * one patient's diagnoses left on screen is how the next person gets handed the wrong one. */
      if (st.view === "pcopy") { st.view = "chart"; st.pcopy = null; paint(); return; }
      if (st.view === "consent") { st.view = "chart"; st.consent = null; paint(); return; }
      if (st.view === "ips") { st.view = "chart"; st.ips = null; paint(); return; }
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
      if (st.view === "trends") { st.trends = null; st.recordDetail = null; twinOpen(); return; }
      if (st.view === "scheduling") { st.scheduling = {}; st.view = "list"; paint(); return; }
      if (st.view === "cashier") { st.cashier = {}; st.view = "list"; paint(); return; }
      if (st.view === "reports") { st.reports = {}; st.view = "list"; paint(); return; }
      if (st.view === "purchasing") { st.purchaseOrders = null; st.view = "list"; paint(); return; }
      if (st.view === "approvals") { st.approvals = null; st.view = "list"; paint(); return; }
      if (st.view === "patientsurgery") { st.patientCases = null; st.view = "chart"; paint(); return; }
      if (st.view === "tags") { st.tags = null; st.tagVerify = null; st.view = "chart"; paint(); return; }
      if (st.view === "mpi") { st.mpi = null; st.view = st.sel ? "chart" : "list"; paint(); return; }
      if (st.view === "nurseworklist") { st.nurseWorklist = null; st.view = "list"; paint(); return; }
      if (st.view === "surveillance") { st.surveillance = null; st.recordDetail = null; st.view = "list"; paint(); return; }
      if (st.view === "nursingpatient") { st.nursingPanel = null; loadNurseWorklist(); return; }
      if (st.view === "forms") { st.formDefs = null; st.formSel = null; st.formAnswers = null; st.formResult = null; st.view = st.sel ? "chart" : "list"; paint(); return; }
      if (st.view === "referrals") { st.referrals = null; st.view = st.sel ? "chart" : "list"; paint(); return; }
      if (st.view === "referralinbox") { st.referrals = null; st.view = "list"; paint(); return; }
      if (st.view === "documents") { st.docs = null; st.docVersions = null; st.docNewVersion = null; st.view = st.sel ? "chart" : "list"; paint(); return; }
      if (st.view === "infusions") { st.infusions = null; st.view = "chart"; paint(); return; }
      if (st.view === "careplan") { st.carePlan = null; st.view = "chart"; paint(); return; }
      if (st.view === "pathways") { st.pathwaysData = null; st.view = "chart"; paint(); return; }
      if (st.view === "specialty") { st.specialtyData = null; st.view = "chart"; paint(); return; }
      if (st.view === "admreqs") { st.admReqs = null; st.view = "list"; paint(); return; }
      if (st.view === "ordersets") { st.orderSets = null; st.orderSetPick = null; st.orderSetResult = null; st.view = "chart"; paint(); return; }
      if (st.view === "breakglass") { st.breakGlass = null; st.view = st.sel ? "chart" : "list"; paint(); return; }
      if (st.view === "wounds") { st.wounds = null; st.view = "chart"; paint(); return; }
      if (st.view === "risks") { st.risks = null; st.riskForm = null; st.view = "chart"; paint(); return; }
      if (st.view === "medrec") { st.medRec = null; st.view = "chart"; paint(); return; }
      if (st.view === "handover") { st.handovers = null; st.view = "list"; paint(); return; }
      if (st.view === "safetyinbox") { st.inbox = null; st.view = "list"; paint(); return; }
      if (st.view === "workspace") { st.view = "chart"; paint(); return; }
      if (st.view === "people") { st.people = null; st.view = "chart"; paint(); return; }
      if (st.view === "immunizations") { st.immunizations = null; st.view = "chart"; paint(); return; }
      if (st.view === "consultation") { st.consultationResult = null; st.cDraft = null; st.cIcd = undefined; st.view = "chart"; paint(); return; }
      if (st.view === "incidents") { st.incidentLog = null; st.incidentHealth = null; st.view = "list"; paint(); return; }
      if (st.view === "qualitysafety") { st.qs = null; st.qsOpen = null; st.view = "list"; paint(); return; }
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
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.pathology = null; st.resusBundles = null;
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
      st.sel = p; st.view = "chart"; st.roundWarning = ""; st.due = []; st.prn = []; st.unscheduled = []; st.problems = []; st.criticals = []; st.balance = null; st.balanceFailed = false; st.outbox = [];
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.pathology = null; st.timeline = null; st.activeMeds = null;
      st.timelineFilter = ""; st.highlightReportId = null; st.timelineWhen = ""; st.timelineOpen = null; st.timelineQuery = ""; st.recordDetail = null;
      st.err = ""; st.note = ""; st.refusal = null; st.devices = null; st.maternity = null; st.ageBand = null; st.lines = null; st.rateResult = null; st.oncology = null; st.cardiology = null; st.radiology = null; st.pharmacy = null; st.transfusion = null;
      st.icu = null; st.flowsheetFailed = false; st.resusBundles = null;
      /* TASK 8.5: MaiK is cleared with the rest of the chart. An answer about the previous patient
       * left on screen beside a new patient's observations is the wrong-patient error with extra
       * steps, and it is the one this panel could most easily cause. */
      st.maik = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations(); loadPathology();
      if (p.class === "ICU") { loadDevices(); loadIcu(); loadResus(); }
      if (p.class === "MATERNITY") loadMaternity();
      if (p.class === "PEDIATRICS" || p.class === "NICU") loadAgeBand();
      if (p.class === "NICU") loadLines();
      return;
    }
    if (cmd === "openEd") {
      var pe = null;
      for (var k2 = 0; k2 < ((st.ed && st.ed.patients) || []).length; k2++) { if (st.ed.patients[k2].encounterId === arg) { pe = st.ed.patients[k2]; break; } }
      if (!pe) return;
      st.sel = Object.assign({ class: "ED" }, pe); st.view = "chart"; st.roundWarning = ""; st.due = []; st.prn = []; st.unscheduled = []; st.problems = []; st.criticals = []; st.balance = null; st.balanceFailed = false; st.outbox = [];
      st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.pathology = null; st.resusBundles = null;
      st.edRecord = null; st.referrals = null;
      st.err = ""; st.note = ""; st.refusal = null;
      defaultWindow();
      st.noteTemplateId = ""; st.noteResult = null;
      /* MaiK's panel is cleared when the chart changes. An answer about the previous patient left on
       * screen beside a new patient's observations is the wrong-patient error with extra steps. */
      st.maik = null;
      paint(); loadChart(); loadRound(); loadBalance(); loadOutbox(); loadTemplates(); loadFlowsheet(); loadNews2(); loadInvestigations(); loadPathology(); loadResus(); loadEdRecord(); loadReferrals(); return;
    }
    if (cmd === "edboard") { loadEd(); return; }
    if (cmd === "inventoryboard") { inventoryOpen(); return; }
    if (cmd === "inventoryload") { loadInventory(); return; }
    if (cmd === "maikask") { maikAsk(arg); return; }
    if (cmd === "maikreview") { maikReview(arg); return; }
    if (cmd === "maikedit") { st.maik.editing = true; paint(); return; }
    if (cmd === "maikclear") { st.maik = null; paint(); return; }
    if (cmd === "maikhistory") { maikHistory(); return; }
    if (cmd === "maikopen") {
      var hx = st.maik && st.maik.history, picked = hx && hx.interactions && hx.interactions[Number(arg)];
      if (picked) { st.maik.interaction = picked; st.maik.err = ""; paint(); }
      return;
    }
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
    if (cmd === "radtemplate") { radTemplatePick(arg); return; }
    if (cmd === "ackboard") { acknowledgeBoard(arg); return; }
    if (cmd === "bedmgmt") { bedMgmtOpen(); return; }
    if (cmd === "flowcommand") { flowCommandOpen(); return; }
    if (cmd === "flowload") { loadFlowCommand(); return; }
    if (cmd === "twin") { twinOpen(); return; }
    if (cmd === "twinload") { loadTwin(); return; }
    if (cmd === "twindrill") { var dp = arg.split("."); st.twin = st.twin || {}; st.twin.drill = { section: dp[0], key: dp[1] || "" }; paint(); return; }
    if (cmd === "twindrillclose") { if (st.twin) st.twin.drill = null; paint(); return; }
    if (cmd === "trends") { trendsOpen(); return; }
    if (cmd === "trendsload") { loadTrends(); return; }
    if (cmd === "trendbucket") { trendBucket(Number(arg)); return; }
    if (cmd === "trendevents") { trendEventsLoad(Number(arg)); return; }
    if (cmd === "trendwardclose") { if (st.trends) { st.trends.ward = null; st.trends.events = null; } st.recordDetail = null; paint(); return; }
    if (cmd === "trendeventsclose") { if (st.trends) st.trends.events = null; st.recordDetail = null; paint(); return; }
    if (cmd === "flowdrill") { st.flow = st.flow || {}; st.flow.drill = arg; paint(); return; }
    if (cmd === "flowdrillclose") { if (st.flow) st.flow.drill = null; paint(); return; }
    if (cmd === "cmdopen") { commandOpenChart(arg); return; }
    if (cmd === "twinask") { twinAsk(); return; }
    if (cmd === "twincopilotreview") { twinCopilotReview(arg); return; }
    if (cmd === "twinsim") { twinSimulate(arg); return; }
    if (cmd === "twinpredict") {
      st.twin = st.twin || {}; st.twin.forecast = { busy: true }; paint();
      apiGet("/ward/twin-predict?orgId=" + encodeURIComponent(st.orgId) + "&metric=" + encodeURIComponent(arg))
        .then(function (r) { st.twin.forecast = r || { ok: false }; paint(); })
        .catch(function () { st.twin.forecast = { ok: false }; paint(); });
      return;
    }
    if (cmd === "twinasof") {
      var atv = val("wTwinAt");
      if (!atv) { st.err = "Pick a date and time to look back to."; paint(); return; }
      st.twin = st.twin || {}; st.twin.asOf = { busy: true }; paint();
      apiGet("/ward/twin-reconstruct?orgId=" + encodeURIComponent(st.orgId) + "&at=" + encodeURIComponent(new Date(atv).toISOString()))
        .then(function (r) { st.twin.asOf = r || { ok: false }; paint(); })
        .catch(function () { st.twin.asOf = { ok: false }; paint(); });
      return;
    }
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
    if (cmd === "invpaylink") { cashPayLink(arg); return; }
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
    if (cmd === "stockfefo") { stockFefo(); return; }
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
    if (cmd === "childdoselimit") { childDoseLimitCheck(); return; }
    if (cmd === "resuswaive") { var rw = arg.indexOf("|"); if (rw > 0) resusWaive(arg.slice(0, rw), arg.slice(rw + 1)); return; }
    if (cmd === "resusmark") { var rm = arg.indexOf("|"); if (rm > 0) resusMark(arg.slice(0, rm), arg.slice(rm + 1)); return; }
    if (cmd === "resusvoid") { resusVoid(arg); return; }
    if (cmd === "deviceload") { loadDevices(); return; }
    if (cmd === "icuload") { loadIcu(); return; }
    if (cmd === "icuabg") { icuAbg(); return; }
    if (cmd === "icuvent") { icuVent(); return; }
    if (cmd === "icused") { icuSedation(); return; }
    if (cmd === "icuround") { icuRound(); return; }
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
    if (cmd === "incidents") { incidentsOpen(); return; }
    if (cmd === "qualityview") { st.qsOpen = null; loadQualitySafety(); return; }
    if (cmd === "qsdays") { loadQualitySafety(Number(arg) || 30); return; }
    if (cmd === "qscases") { st.qsOpen = st.qsOpen === arg ? null : arg; paint(); return; }
    if (cmd === "timelinefilter") { st.timelineFilter = arg === "all" ? "" : arg; paint(); return; }
    if (cmd === "timelinewhen") { st.timelineWhen = arg === "any" ? "" : arg; paint(); return; }
    if (cmd === "timelinesearch") { st.timelineQuery = val("wTlQ"); paint(); return; }
    if (cmd === "timelinesearchclear") { st.timelineQuery = ""; paint(); return; }
    if (cmd === "timelinedetail") { timelineDetail(arg); return; }
    if (cmd === "timelinedetailclose") { st.recordDetail = null; paint(); return; }
    if (cmd === "readers") { loadReaders(arg); return; }
    if (cmd === "timelineopen") {
      if (!st.timelineOpen) st.timelineOpen = {};
      if (st.timelineOpen[arg]) delete st.timelineOpen[arg]; else st.timelineOpen[arg] = 1;
      paint(); return;
    }
    if (cmd === "timelinereport") { timelineOpenReport(arg); return; }
    if (cmd === "cashmethod") { st.cashMethod = val("wCashMethod") || "cash"; paint(); return; }
    if (cmd === "patientsurgery") { patientSurgeryOpen(); return; }
    if (cmd === "surgeryabandon") { surgeryAbandon(arg); return; }
    if (cmd === "wardcloseopen") { wardDischarge(); return; }
    if (cmd === "followup") { followUpRequest(); return; }
    if (cmd === "invvoid") { invoiceVoid(arg); return; }
    if (cmd === "dispensereturn") { dispenseReturn(arg); return; }
    if (cmd === "bloodtrace") { bloodTrace(); return; }
    if (cmd === "dictate") { startDictation(arg); return; }
    if (cmd === "dictlang") { toggleDictLang(); return; }
    if (cmd === "rosterfilter") {
      st.rosterFilters = st.rosterFilters || {};
      if (arg === "ward") {
        var elW = document.getElementById("wRosterWardFilter");
        st.rosterFilters.ward = elW ? elW.value : "";
      } else if (arg === "stay") {
        var elS = document.getElementById("wRosterStayFilter");
        st.rosterFilters.stay = elS ? elS.value : "";
      }
      var r0 = document.getElementById("wRoster"); if (r0) r0.innerHTML = rosterHtml(st); else paint();
      return;
    }
    if (cmd === "openbedpatient") {
      var pat = (st.patients || []).find(function (p) { return p.encounterId === arg || p.patientId === arg || p.mrn === arg; });
      if (pat && pat.encounterId) { loadRound(pat.encounterId); return; }
      if (arg.indexOf("enc-") === 0 || arg.indexOf("encounter-") === 0) { loadRound(arg); return; }
      apiGet("/ward/encounter?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(arg))
        .then(function (r) { if (r && r.encounter && r.encounter.encounterId) loadRound(r.encounter.encounterId); else { st.err = "Patient chart not found for that bed."; paint(); } })
        .catch(function () { st.err = "Could not open patient chart."; paint(); });
      return;
    }
    if (cmd === "cardioechosave") {
      var ef = val("wCardioEf"), rwma = val("wCardioRwma"), valves = val("wCardioValves"), pasp = val("wCardioPasp"), peri = val("wCardioPericardial");
      if (!ef && !rwma && !valves) { st.err = "Enter at least LVEF, RWMA or valve assessment."; paint(); return; }
      var echoText = "2D echocardiography: LVEF " + (ef ? ef + "%" : "not reported") + (rwma ? " | RWMA: " + rwma : "") + (valves ? " | Valves: " + valves : "") + (pasp ? " | PASP: " + pasp : "") + (peri ? " | Pericardium: " + peri : "");
      cardioNote(echoText, "2D echo saved as a note on the chart.", "Could not save the 2D echo.");
      return;
    }
    if (cmd === "cardiocagsave") {
      var access = val("wCardioCagAccess") || "Radial", lm = val("wCardioLmc"), lad = val("wCardioLad"), lcx = val("wCardioLcx"), rca = val("wCardioRca"), stnt = val("wCardioStents");
      if (!lad && !rca && !stnt && !lm) { st.err = "Enter vessel findings or intervention."; paint(); return; }
      var nr = "not reported";
      var cagText = "Coronary angiogram (" + access + "): LMCA " + (lm || nr) + " | LAD " + (lad || nr) + " | LCx " + (lcx || nr) + " | RCA " + (rca || nr) + (stnt ? " | Intervention: " + stnt : "");
      cardioNote(cagText, "Angiogram report saved as a note on the chart.", "Could not save the angiogram report.");
      return;
    }
    if (cmd === "oncoproto") {
      var proto = ONCO_PROTOCOLS[arg];
      if (proto) {
        st.oncoRegimen = proto.name;
        st.oncoVersion = "";
        st.oncoDrug = proto.drug;
        var elReg = document.getElementById("wOncoRegimen"); if (elReg) elReg.value = proto.name;
        var elVer = document.getElementById("wOncoVersion"); if (elVer) elVer.value = "";
        var elDrug = document.getElementById("wOncoDrug"); if (elDrug) elDrug.value = proto.drug;
        st.note = "Regimen " + arg + " filled in. Type the protocol version from the ONCqis plan.";
        paint();
      }
      return;
    }
    if (cmd === "specreceived") { specimenOutcomeAct(arg, "received"); return; }
    if (cmd === "specfailed") { specimenOutcomeAct(arg, "failed"); return; }
    if (cmd === "labresultopen") { labResultOpen(arg); return; }
    if (cmd === "labresultsave") { labResultSave(); return; }
    if (cmd === "labtmpl") { labTemplateApply(arg); return; }
    if (cmd === "labdept") { st.labDept = arg; paint(); return; }
    if (cmd === "labverify" || cmd === "labreturn") {
      var reason = cmd === "labreturn" ? (window.prompt("What needs checking or re-entering?") || "") : "";
      if (cmd === "labreturn" && !reason.trim()) { st.err = "Say what needs checking."; paint(); return; }
      st.busy = true; paint();
      apiPost("/ward/verify-result", { orgId: st.orgId, reportId: arg, decision: cmd === "labverify" ? "verify" : "return", reason: reason || undefined })
        .then(function (r) { if (settle(r, cmd === "labverify" ? "Verified. The result is final." : "Returned for re-entry.")) loadLabBoard(); else paint(); })
        .catch(function () { st.busy = false; st.err = "Could not reach the server."; paint(); });
      return;
    }
    if (cmd === "labresultclose") { st.labResultFor = null; st.labResultOutcome = null; paint(); return; }
    if (cmd === "cultureopen") { cultureOpen(arg); return; }
    if (cmd === "culturesave") { cultureSave(); return; }
    if (cmd === "cultureclose") { st.cultureFor = null; paint(); return; }
    if (cmd === "histoopen") { histoOpen(arg); return; }
    if (cmd === "histosave") { histoSave(); return; }
    if (cmd === "histoclose") { st.histoFor = null; paint(); return; }
    if (cmd === "histoaddendum") { histoAddendum(arg); return; }
    if (cmd === "pathologyload") { loadPathology(); return; }
    if (cmd === "tags") { tagsOpen(); return; }
    if (cmd === "tagverify") { tagVerify(); return; }
    if (cmd === "tagassign") { tagAssign(); return; }
    if (cmd === "tagreplace") { tagEnd("replace", arg); return; }
    if (cmd === "taglost") { tagEnd("lost", arg); return; }
    if (cmd === "tagend") { tagEnd("end", arg); return; }
    if (cmd === "mpi") { mpiOpen(); return; }
    if (cmd === "nurseworklist") { loadNurseWorklist(); return; }
    if (cmd === "surveillance") { loadSurveillance(); return; }
    if (cmd === "survack") { survAck(arg); return; }
    if (cmd === "nwscope") { st.nwScope = arg === "mine" ? "mine" : "ward"; paint(); return; }
    if (cmd === "nursingpatient") { nursingPanelOpen(arg); return; }
    if (cmd === "nurseassign") { nursingPost("/ward/nurse-assign", arg === "unassign" ? { action: "unassign", expectedVersion: nursingVersion("assignment") } : { action: "assign", nurseId: val("wNaNurse"), shift: val("wNaShift"), expectedVersion: nursingVersion("assignment") }, arg === "unassign" ? "Nurse unassigned." : "Nurse assigned."); return; }
    if (cmd === "obsfreqsave") { nursingPost("/ward/obs-frequency", { everyHours: val("wObsEvery"), expectedVersion: nursingVersion("vitals") }, "Observation frequency saved."); return; }
    if (cmd === "ntaskadd") { nursingPost("/ward/nursing-task", { patientId: (st.nursingPanel || {}).patientId, title: val("wNtTitle"), dueAt: val("wNtDue") ? new Date(val("wNtDue")).toISOString() : "" }, "Task added."); return; }
    if (cmd === "ntaskact") {
      var ta = String(arg || "").split("~"), tb = { taskId: ta[0], action: ta[1], expectedVersion: Number(ta[2]) };
      if (ta[1] === "cancel") { try { tb.reason = G.prompt("Why is this task cancelled?") || ""; } catch (e) { tb.reason = ""; } if (!tb.reason.trim()) return; }
      if (ta[1] === "done" && st.nursingPanel) {
        var np = st.nursingPanel;
        tb.orgId = st.orgId; tb.encounterId = np.encounterId;
        st.busy = true; paint();
        bedsideWrite("nursing-task-done", tb, { label: "Nursing task done", patientId: np.patientId, expectedVersion: tb.expectedVersion },
          function (r) { if (settle(r, r && r.ok ? "Task done." : null)) { np.data = null; paint(); loadNursingPanel(); } else paint(); },
          "Could not save. Nothing was changed.");
        return;
      }
      nursingPost("/ward/nursing-task-act", tb, "Task cancelled.");
      return;
    }
    if (cmd === "forms") {
      if (!st.sel) { st.err = "Open a patient first."; paint(); return; }
      st.view = "forms"; st.formDefs = null; st.formResponses = null; st.formSel = null; st.formAnswers = {}; st.formResult = null; paint();
      apiGet("/forms/definitions?orgId=" + encodeURIComponent(st.orgId)).then(function (r) { st.formDefs = r && r.ok ? r : { failed: true }; paint(); }).catch(function () { st.formDefs = { failed: true }; paint(); });
      apiGet("/ward/form-responses?orgId=" + encodeURIComponent(st.orgId) + "&patientId=" + encodeURIComponent(st.sel.patientId)).then(function (r) { st.formResponses = r && r.ok ? r : { failed: true }; paint(); }).catch(function () { st.formResponses = { failed: true }; paint(); });
      return;
    }
    if (cmd === "formpick") { st.formSel = ((st.formDefs && st.formDefs.published) || []).filter(function (f) { return f.key === arg; })[0] || null; st.formAnswers = {}; st.formResult = null; paint(); return; }
    if (cmd === "formsubmit") {
      readFormAnswers();
      st.busy = true; paint();
      apiPost("/ward/form-submit", { orgId: st.orgId, patientId: st.sel.patientId, encounterId: st.sel.encounterId || undefined, formKey: st.formSel.key, formVersion: st.formSel.version, answers: st.formAnswers })
        .then(function (r) { st.formResult = r; if (settle(r, r && r.ok ? "Form saved." : null)) { st.formSel = null; st.formAnswers = {}; dispatch("forms"); } else paint(); })
        .catch(function () { st.busy = false; st.err = "Could not save the form."; paint(); });
      return;
    }
    if (cmd === "referrals") { if (!st.sel) { st.err = "Open a patient first."; paint(); return; } st.view = "referrals"; st.referrals = null; paint(); loadReferrals(); return; }
    if (cmd === "referralinbox") { st.view = "referralinbox"; st.referrals = null; paint(); loadReferrals(); return; }
    if (cmd === "refinboxload") { st.refSpecialty = val("wRefSpec"); st.refView = val("wRefView"); st.referrals = null; paint(); loadReferrals(); return; }
    if (cmd === "refcreate") { referralCreate(); return; }
    if (cmd === "refact") { referralAct(arg); return; }
    if (cmd === "mpisearch") { mpiSearch(); return; }
    if (cmd === "mpimerge") { mpiMergePreview(arg); return; }
    if (cmd === "mpimergeconfirm") { mpiMergeConfirm(); return; }
    if (cmd === "mpimergecancel") { st.mpiPreview = null; paint(); return; }
    if (cmd === "mpiunmerge") { mpiMerge(arg, true); return; }
    if (cmd === "infusions") { infusionOpen(); return; }
    if (cmd === "infusionchart") { infusionChart(arg); return; }
    if (cmd === "careplansave") { carePlanSave(); return; }
    if (cmd === "careplan") { carePlanOpen(); return; }
    if (cmd === "cpprog") { carePlanProgress(arg); return; }
    if (cmd === "cpreview") { carePlanReview(); return; }
    if (cmd === "pathways") { loadPathways(); return; }
    if (cmd === "pwenrol") { pathwayEnrol(arg); return; }
    if (cmd === "pwoverride") { pathwayOverride(arg); return; }
    if (cmd === "specialty") { loadSpecialty(); return; }
    if (cmd === "retriage") { recordRetriage(); return; }
    if (cmd === "edprocsave") { edProcedureSave(); return; }
    if (cmd === "admreqs") { admReqOpen(); return; }
    if (cmd === "admreqask") { admReqAsk(); return; }
    if (cmd === "admreqclose") { admReqClose(arg); return; }
    if (cmd === "ordersets") { orderSetsOpen(); return; }
    if (cmd === "ordersetpick") { orderSetPick(); return; }
    if (cmd === "ordersetapply") { orderSetApply(); return; }
    if (cmd === "breakglass") { breakGlassOpen(); return; }
    if (cmd === "breakglassdeclare") { breakGlassDeclare(); return; }
    if (cmd === "emergencychart") { emergencyChartOpen(arg); return; }
    if (cmd === "wounds") { woundOpen(); return; }
    if (cmd === "woundchart") { woundChart(); return; }
    if (cmd === "risks") { riskOpenView(); return; }
    if (cmd === "riskopen") { riskOpenTool(); return; }
    if (cmd === "risksave") { riskSave(); return; }
    if (cmd === "riskcancel") { st.riskForm = null; paint(); return; }
    if (cmd === "riskdone") { riskActionDone(arg); return; }
    if (cmd === "medrec") { medRecOpen(); return; }
    if (cmd === "medrecstart") { medRecStart(); return; }
    if (cmd === "medrecdecide") { medRecDecide(arg); return; }
    if (cmd === "handovers") { handoverOpen(); return; }
    if (cmd === "handovershow") { st.handoverState = arg; loadHandovers(); return; }
    if (cmd === "handovergive") { handoverGive(); return; }
    if (cmd === "handovertake") { handoverTake(arg); return; }
    if (cmd === "safetyinbox") { safetyInboxOpen(); return; }
    if (cmd === "inboxrole") { st.inboxRole = arg === "all" ? "" : arg; loadSafetyInbox(); return; }
    if (cmd === "inboxopen") { inboxOpenPatient(arg); return; }
    if (cmd === "workspace") { workspaceOpen(); return; }
    if (cmd === "people") { peopleOpen(); return; }
    if (cmd === "immunizations") { immunizationsOpen(); return; }
    if (cmd === "immadd") { immunizationAdd(); return; }
    if (cmd === "immerror") { immunizationError(arg); return; }
    if (cmd === "documents") { documentsOpen(); return; }
    if (cmd === "docupload") { documentUpload(); return; }
    if (cmd === "docopen") { documentOpen(arg); return; }
    if (cmd === "docversions") { documentVersionsLoad(arg); return; }
    if (cmd === "docnewversion") { var nv = String(arg || "").split("~"); st.docNewVersion = { id: nv[0], version: Number(nv[1]) }; paint(); return; }
    if (cmd === "docnewversioncancel") { st.docNewVersion = null; paint(); return; }
    if (cmd === "docwithdraw") { documentWithdraw(arg); return; }
    if (cmd === "docrelease") { documentRelease(arg); return; }
    if (cmd === "docpurge") { documentPurge(arg); return; }
    if (cmd === "personadd") { personAdd(); return; }
    if (cmd === "personremove") { personRemove(arg); return; }
    if (cmd === "deathrecord") { deathRecord(); return; }
    if (cmd === "deathwithdraw") { deathWithdraw(); return; }
    if (cmd === "consultation") { consultationOpen(); return; }
    if (cmd === "approvals") { approvalsOpen(); return; }
    if (cmd === "purchasing") { purchasingOpen(); return; }
    if (cmd === "poraise") { poRaise(); return; }
    if (cmd === "poask") { poAskApproval(arg); return; }
    if (cmd === "poreceive") { poReceive(arg); return; }
    if (cmd === "approvalask") { approvalAsk(); return; }
    if (cmd === "approvalyes") { approvalDecide(arg, "approved"); return; }
    if (cmd === "approvalno") { approvalDecide(arg, "rejected"); return; }
    if (cmd === "consultationsave") { saveWholeConsultation(); return; }
    if (cmd === "cfindcode") { consultationFindCode(); return; }
    if (cmd === "cicdpick") { consultationPickCode(Number(arg)); return; }
    if (cmd === "incidentreport") { reportIncidentAction(); return; }
    if (cmd === "incidenttriage") { incidentTriage(arg); return; }
    if (cmd === "incidentrca") { incidentRca(arg); return; }
    if (cmd === "incidentcapaadd") { incidentCapaAdd(arg); return; }
    if (cmd === "incidentcapacomplete") { var incp = arg.split("~"); incidentCapaComplete(incp[0], incp[1]); return; }
    if (cmd === "incidentclose") { incidentClose(arg); return; }
    if (cmd === "incidentconfirm") { incidentConfirm(arg); return; }
    if (cmd === "incidentsignal") { var sigp = arg.split("~"); incidentSignal(sigp[0], sigp[1]); return; }
    if (cmd === "incidentsignalnews2") { incidentSignalNews2(arg); return; }
    if (cmd === "emergencyadmin") { emergencyAdminOpen(); return; }
    if (cmd === "emergencydeclare") { emergencyDeclareAction(); return; }
    if (cmd === "emergencydeactivate") { emergencyDeactivateAction(arg); return; }
    if (cmd === "emergencyreconcile") { emergencyReconcileAction(arg); return; }
    if (cmd === "printpack") { try { G.print(); } catch (e) {} return; }
    if (cmd === "pcopy") { loadPatientCopy(); return; }
    if (cmd === "pcopyGive") { givePatientCopy(); return; }
    if (cmd === "consentopen") { consentOpen(); return; }
    if (cmd === "ipsopen") { ipsOpen(); return; }
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
    if (cmd === "claimack") { claimAckAction(arg); return; }
    if (cmd === "claimsettle") { claimSettleAction(arg); return; }
    if (cmd === "claimbalance") { claimBalanceAction(arg); return; }
    if (cmd === "estimate") { estimateAction(); return; }
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
  var _probDebounce = null;
  function onInput(e) {
    if (!e.target) return;
    if (e.target.id === "wQ") {
      st.q = String(e.target.value || "");
      var r0 = document.getElementById("wRoster"); if (r0) r0.innerHTML = rosterHtml(st);
      return;
    }
    if (e.target.id === "wProbText") {
      var q = String(e.target.value || "").trim();
      st.probText = e.target.value;
      if (_probDebounce) clearTimeout(_probDebounce);
      if (q.length < 2) {
        st.icd = undefined;
        var icdEl0 = document.getElementById("wIcdCandidates");
        if (icdEl0) icdEl0.innerHTML = "";
        return;
      }
      _probDebounce = setTimeout(function () {
        icdSearch(q).then(function (rows) {
          st.icd = rows;
          var icdEl = document.getElementById("wIcdCandidates");
          if (icdEl) {
            icdEl.innerHTML = (rows && rows.length) ? (
              '<ul class="w-icd">' + rows.map(function (c, i) {
                return '<li><button class="w-icd-p" data-w-act="icdpick:' + i + '"><b>' + esc(c.code) + "</b><span>" + esc(c.title) + "</span><small>" + esc(c.system || "") + "</small></button></li>";
              }).join("") + "</ul>"
            ) : '<p class="w-hint">' + ms("info") + "No matching code. Record it in words: an uncoded diagnosis is honest, a guessed code is not.</p>";
          }
        }).catch(function () {});
      }, 300);
    }
  }
  function open(opts) {
    opts = opts || {};
    // The remembered workplace before the last hospital this screen showed: after a switch (the alert
    // screen's "Switch to <hospital>", or the OPD chooser) the ward must open the hospital now chosen.
    st.orgId = opts.orgId || rememberedOrgId() || st.orgId;
    if (opts.demo !== undefined) st.demo = !!opts.demo;
    if (!st.orgId) { try { G.toast && G.toast("The ward needs a hospital."); } catch (e) {} return; }
    st.view = "list"; st.sel = null; st.loaded = false; st.err = ""; st.note = ""; st.refusal = null;
    outbox();
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("change", onFormChange); el.addEventListener("change", onFormChange);
    // Live search: re-render only the roster so the search box keeps focus and its caret.
    el.removeEventListener("input", onInput); el.addEventListener("input", onInput);
    document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey);
    paint();
    /* A HOSPITAL ACT LOADS ITS OWN SCREEN, NOT THE WARD ROSTER TOO.
     *
     * open() used to call loadWard() unconditionally, even when the shell asked for a specific
     * hospital-wide board (opts.act). The roster read needs the same record scope as the ward list
     * and plenty of roles - cashier, pharmacy, the front desk - do not hold it. So a cashier opening
     * Billing and cashier watched the ward roster fail first ("cash.01@demo.wardsynq.test may not
     * read Encounter"), which set the ONE shared error banner, and then landed on her own working
     * cashier screen with somebody else's refusal still printed across the top of it. Her screen was
     * fine; the request she never made was not.
     *
     * Every hospital act already loads itself (loadBoard, loadEd, cashierOpen, loadReports, ...), so
     * the roster read is only needed when no act is given - opening the plain ward list. */
    if (!(opts.act && HOSPITAL_ACTS.indexOf(opts.act) >= 0)) loadWard();
    // A hospital-level view requested by the shell (bed board, ED, twin...). Only the verbs the ward
    // list's own toolbar offers: a chart-scoped verb needs a selected patient and is not honoured.
    if (opts.act && HOSPITAL_ACTS.indexOf(opts.act) >= 0) dispatch(opts.act);
  }
  var HOSPITAL_ACTS = ["board", "edboard", "surgeryboard", "inventoryboard", "critsboard", "labboard", "radboard", "bedmgmt", "flowcommand", "twin", "trends", "scheduling", "cashier", "reports", "emergencyadmin", "integration", "downtime", "incidents", "approvals", "purchasing", "safetyinbox", "handovers", "breakglass", "admreqs", "mpi", "referralinbox", "nurseworklist", "surveillance", "qualityview"];
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
    try { document.removeEventListener("keydown", onKey); } catch (e) {}
    st.list = null; st.sel = null; st.timeline = null; st.activeMeds = null; st.timelineGap = 0;
    st.timelineFilter = ""; st.highlightReportId = null; st.timelineWhen = ""; st.timelineOpen = null; st.timelineQuery = ""; st.recordDetail = null;
    st.flowsheet = null; st.news2 = null; st.investigations = null; st.results = null; st.pathology = null;
    st.due = null; st.problems = null; st.labBoard = null; st.radBoard = null; st.critsBoard = null;
    st.incidentLog = null; st.incidentHealth = null; st.qs = null; st.qsOpen = null;
    st.consultationResult = null;
    st.approvals = null;
    st.purchaseOrders = null;
    /* The half-typed consultation is cleared with everything else: a draft that outlives its
     * patient is how one patient's findings end up in another's chart. */
    st.cDraft = null; st.cIcd = undefined;
    st.people = null;
    st.inbox = null; st.inboxRole = "";
    st.handovers = null; st.handoverState = "";
    st.medRec = null;
    st.wounds = null; st.risks = null; st.riskForm = null; st.riskTools = null;
    st.breakGlass = null; st.emergencyChart = null;
    st.orderSets = null; st.orderSetPick = null; st.orderSetResult = null;
    st.admReqs = null;
    st.infusions = null;
    st.mpi = null;
    st.tags = null; st.tagVerify = null;
    st.patientCases = null;
    st.labResultFor = null; st.labResultOutcome = null;
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

  G.WARD = { filterRoster: filterRoster, open: open, close: close, _render: _render, _st: st, _offlineChoice: offlineChoice, _bedsideWrite: bedsideWrite, _dispatch: function (a) { dispatch(a); }, _nextFor: nextFor, _problem: problem, _pathologyCard: pathologyCard, _labTemplateApply: labTemplateApply, _startDictation: startDictation, _keys: SHORTCUTS, _keyIntent: keyIntent, _onKey: onKey, _runShortcut: runShortcut };
})();
