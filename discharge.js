/* discharge.js - WardSynQ discharge summary workstation (window.DISCHARGE).
 *
 * Buildless ES5 IIFE, the house pattern: a self-mounting fixed overlay (#smdDischarge), a PURE
 * _render(state) -> HTML, one delegated handler on data-d-act, and the same authHeaders /
 * fetchRetry / apiGet / apiPost transport against /api/queue. Material Symbols, no emoji.
 *
 * It is a DOCUMENT, not a dashboard. The layout is a clinical workstation: an identity band that
 * never leaves the screen, a numbered document column a clinician reads top to bottom, and a rail
 * carrying the things that decide whether it can be signed. On a tablet or phone the rail folds
 * above the document, because what is outstanding must be seen before the sign-off, not beside it.
 *
 * WHAT THIS SCREEN PROMISES
 *
 * 1. IT NEVER INVENTS CLINICAL INFORMATION. Every section is either assembled by the server from
 *    the record or typed by a clinician. There is no third source. "Not recorded." is rendered as
 *    an explicit absence, not as blank space that could read as an oversight.
 *
 * 2. THE RECORD'S WORDS AND THE CLINICIAN'S ARE NEVER CONFUSED. The server tells us which sections
 *    a human wrote (`editedSections`) and sends the freshly assembled text alongside. An edited
 *    section is marked, and what the record itself says stays one tap away for comparison. The
 *    screen never decides this for itself: it would have to guess, and guessing here is inventing.
 *
 * 3. A SIGNED SUMMARY IS FINISHED. Signing is irreversible, and the screen says so before it
 *    happens. Afterwards every edit affordance is gone - not disabled, gone - and the document
 *    renders as the signed artifact with its signature block. A correction is a new signed version,
 *    which is the server's rule, and the screen states it rather than offering a Save that fails.
 *
 * 4. OUTSTANDING WORK IS SHOWN BEFORE SIGN-OFF, NOT AFTER. Doses in flight, open investigations,
 *    still-active orders and unconfirmed diagnoses sit next to the sign button. None of them block
 *    a discharge - a ward has real reasons to send a patient home with a result pending - but
 *    nobody should discover them by reading the summary later.
 *
 * 5. IT ASKS FOR NOTHING IT CANNOT DO. The server says whether this viewer may author, and the
 *    screen offers only that. Authority is still enforced server-side on every write.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var API = "/api/queue";
  var LS_STAFF = "smd_opd_staff_tok";

  var st = {
    orgId: "", encounterId: "", patientId: "",
    patient: null, encounter: null,
    assembled: {}, sections: {}, edited: [], pending: [],
    signed: false, signedBy: null, noteId: null, version: null, recordedAt: null,
    canAuthor: false, hasDraft: false,
    editing: "", compare: {},           // which section is open for editing; which show the record's version
    busy: false, loaded: false, err: "", note: "", refusal: null,
    print: null, printLang: ""          // the hospital's print settings; the second language picked for this print
  };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  // aria-hidden: the icon name is a font ligature, not words; without it "verified Sign and finalise" was the button's name (LT-31).
  function ms(name, fill) { return '<span class="material-symbols-outlined' + (fill ? " fill" : "") + '" aria-hidden="true">' + name + "</span>"; }
  /* THE STAFF LANGUAGE, as ward.js (owner decision 2026-09-15): every string this screen writes goes through wT (plain),
   * wTH (inside markup) or wTD (a dialog) with its English inline, keys "ward.dc-*" in the ward.js block of
   * wardsynq/site/i18n.js. Without i18n.js, or with English picked, the English is exactly what it was. Recorded and
   * assembled clinical text is never translated, and the PRINTED summary stays English (its second language is
   * print-lang.js). A failure keeps its English under the translation. */
  var HAS = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var EN_OF = {};
  function wLang() { var I = G.WSQI18n, s = G.WSQ && G.WSQ.state; return I && s && s.navLang ? I.normalize(s.navLang) : "en"; }
  function wTr(key) { var I = G.WSQI18n, L = wLang(), c = L !== "en" && I && I._catalogs[L]; return c && HAS(c, key) ? String(c[key]) : null; }
  function wFill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return HAS(vars, k) ? "" + vars[k] : m; }) : s; }
  function wT(key, en, vars) { var tr = wTr(key); if (tr == null) return wFill(en, vars); var s = wFill(tr, vars), e = wFill(en, vars); if (s !== e) EN_OF[s] = e; return s; }
  function wTH(key, en, vars) { var tr = wTr(key); return tr == null ? wFill(en, vars) : wFill(String(tr).replace(/&(?![a-z]+;|#\d+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), vars); }
  function wTD(key, en, vars) { var tr = wTr(key), e = wFill(en, vars); return tr == null ? e : wFill(tr, vars) + "\n\n" + e; }
  /* The English under a failure this screen translated; "" for a server's own words or in English. */
  function wEnglishOf(text) { return text && wLang() !== "en" && HAS(EN_OF, text) ? '<span class="en-orig" lang="en">' + esc(EN_OF[text]) + "</span>" : ""; }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value == null ? "" : el.value) : ""; }
  function confirmed(m) { try { return !!(G.confirm && G.confirm(m)); } catch (e) { return false; } }

  /* The eight sections the assembler produces, in the order a discharge summary is read. Allergies
   * sit high because that is where a receiving clinician looks first, not where the data model
   * happens to put them. The keys are the assembler's own; this list never invents a ninth. */
  var SECTIONS = [
    { k: "admission", n: "Admission and stay", icon: "hotel" },
    { k: "diagnoses", n: "Diagnoses", icon: "clinical_notes", note: "From the problem list, not from prose." },
    { k: "allergies", n: "Allergies", icon: "warning" },
    { k: "vitals", n: "Clinical course", icon: "monitor_heart", note: "First and last recorded observations. A summary is not a flowsheet." },
    { k: "investigations", n: "Investigations", icon: "science" },
    { k: "medications", n: "Medications", icon: "medication", note: "What was ordered, and how many doses were actually given." },
    { k: "assessment", n: "Assessment", icon: "assignment" },
    { k: "plan", n: "Plan and follow-up", icon: "event_upcoming" }
  ];
  var NOT_RECORDED = "Not recorded.";
  function sectionName(sec) {
    switch (sec.k) {
      case "admission": return wT("ward.dc-sec-admission", "Admission and stay");
      case "diagnoses": return wT("ward.dc-sec-diagnoses", "Diagnoses");
      case "allergies": return wT("ward.dc-sec-allergies", "Allergies");
      case "vitals": return wT("ward.dc-sec-vitals", "Clinical course");
      case "investigations": return wT("ward.dc-sec-investigations", "Investigations");
      case "medications": return wT("ward.dc-sec-medications", "Medications");
      case "assessment": return wT("ward.dc-sec-assessment", "Assessment");
      case "plan": return wT("ward.dc-sec-plan", "Plan and follow-up");
      default: return sec.n;
    }
  }
  function sectionNote(sec) {
    switch (sec.k) {
      case "diagnoses": return wT("ward.dc-note-diagnoses", "From the problem list, not from prose.");
      case "vitals": return wT("ward.dc-note-vitals", "First and last recorded observations. A summary is not a flowsheet.");
      case "medications": return wT("ward.dc-note-medications", "What was ordered, and how many doses were actually given.");
      default: return sec.note;
    }
  }

  // ---- transport (identical to queue.js / ward.js) -----------------------------------------
  function staffTok() { try { return localStorage.getItem(LS_STAFF) || ""; } catch (e) { return ""; } }
  function fbToken() {
    try { if (G.SMD_AUTH && G.SMD_AUTH.token) return Promise.resolve(G.SMD_AUTH.token()); } catch (e) {}
    try { if (G.firebase && firebase.auth && firebase.auth().currentUser) return firebase.auth().currentUser.getIdToken(); } catch (e) {}
    return Promise.resolve(null);
  }
  /* S3 ID-01, as ward.js: a staff token only for the hospital it was minted for (hospital-auth.js), else the
   * account bearer. Pages without that file keep the old rule. */
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
  function apiGet(p) { return authHeaders().then(function (h) { return fetchRetry(API + p, { headers: h, credentials: "include" }); }).then(function (r) { return r.json(); }); }
  function apiPost(p, b) { return authHeaders().then(function (h) { return fetchRetry(API + p, { method: "POST", headers: h, credentials: "include", body: JSON.stringify(b || {}) }); }).then(function (r) { return r.json(); }); }

  /* The server's own words for a failure. A refusal keeps its reason codes; everything else keeps
   * the server's message, because "this discharge summary is signed" is actionable and "something
   * went wrong" is not. */
  function problem(r) {
    if (!r) return { err: wT("ward.dc-no-response", "No response from the server.") };
    if (r.ok) return null;
    if (r.error === "governance") return { refusal: { reasons: r.reasons || [], detail: wT("ward.dc-record-service-refused", "The record service refused this write.") } };
    if (r.error === "already_signed") return { err: r.detail || wT("ward.dc-already-signed", "This summary is signed and cannot be redrafted.") };
    return { err: r.message || r.detail || r.error || wT("ward.dc-request-failed", "Request failed.") };
  }
  function settle(r, okMsg) {
    st.busy = false; st.err = ""; st.refusal = null; st.note = "";
    var p = problem(r);
    if (p) { st.err = p.err || ""; st.refusal = p.refusal || null; return false; }
    if (okMsg) st.note = okMsg;
    return true;
  }

  // ---- pure helpers -------------------------------------------------------------------------
  /* THE HOSPITAL'S CLOCK, NOT UTC AND NOT THE BROWSER'S (LT-19). Through the shared print helper
   * (wardsynq/site/print-lang.js WSQPrint.date) with the hospital's own time zone or offset from the
   * server, so this screen and the printed summary can never show one instant two ways. */
  function when(iso, withTime, clock) {
    if (!iso) return null;
    if (G.WSQPrint && G.WSQPrint.date) return G.WSQPrint.date(iso, clock || st.print, withTime);
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
    var o = { day: "2-digit", month: "short", year: "numeric" };
    if (withTime !== false) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return d.toLocaleString([], o);
  }
  /* The assembled sections carry instants as ISO text ("Admitted: 2026-09-15T15:23:31.058Z."), which is
   * what the signed record keeps. They are READ in the hospital's clock: only a full instant with its zone
   * is rewritten, so a date, a dose or anything a clinician typed is never touched. */
  var ISO_INSTANT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
  function localTimes(text, clock) {
    return String(text == null ? "" : text).replace(ISO_INSTANT, function (iso) { return when(iso, true, clock) || iso; });
  }
  function initials(n) {
    n = String(n || "").trim(); if (!n) return "?";
    var p = n.split(/\s+/);
    return ((p[0][0] || "") + (p[1] ? p[1][0] : (p[0][1] || ""))).toUpperCase();
  }
  /* Both take the state explicitly. _render must be PURE (state -> HTML) - the same contract
   * queue.js states - and a helper that reaches into module state instead of its argument quietly
   * breaks it: the screen would still work, because paint() happens to pass `st`, while any other
   * render of any other state silently produced the wrong document. */
  function isEdited(s, k) { return ((s && s.edited) || []).indexOf(k) >= 0; }
  function textOf(s, k) {
    var v = s && s.sections && s.sections[k];
    if (v == null || v === "") v = s && s.assembled && s.assembled[k];
    return v == null ? "" : String(v);
  }
  function stayDays(a, b) {
    var s = Date.parse(a), e = Date.parse(b || "");
    if (!isFinite(s)) return null;
    return Math.max(0, Math.round(((isFinite(e) ? e : Date.now()) - s) / 86400000));
  }

  // ---- render: identity + status ------------------------------------------------------------
  function identity(s) {
    var p = s.patient || {}, e = s.encounter || {};
    var los = stayDays(e.admittedAt, e.dischargedAt);
    var facts = [
      p.mrn ? { l: "MRN", v: p.mrn, mono: true } : null,
      p.sex ? { l: wT("ward.dc-sex", "Sex"), v: p.sex } : null,
      e.ward ? { l: wT("ward.dc-ward", "Ward"), v: e.bed ? wT("ward.dc-ward-bed", "{ward}, bed {bed}", { ward: e.ward, bed: e.bed }) : e.ward } : null,
      { l: wT("ward.dc-admitted", "Admitted"), v: when(e.admittedAt, true, s.print) || wT("ward.dc-not-recorded-lc", "not recorded") },
      { l: wT("ward.dc-discharged", "Discharged"), v: when(e.dischargedAt, true, s.print) || wT("ward.dc-not-yet", "not yet") },
      los === null ? null : { l: wT("ward.dc-stay", "Stay"), v: los === 1 ? wT("ward.dc-stay-day", "{n} day", { n: los }) : wT("ward.dc-stay-days", "{n} days", { n: los }) }
    ].filter(Boolean).map(function (f) {
      return '<div class="d-fact"><dt>' + esc(f.l) + "</dt><dd" + (f.mono ? ' class="mono"' : "") + ">" + esc(f.v) + "</dd></div>";
    }).join("");
    return '<div class="d-identity"><div class="d-idmain">' +
      '<span class="d-avatar" aria-hidden="true">' + esc(initials(p.name)) + "</span>" +
      "<div><h2>" + esc(p.name || s.patientId || wT("ward.dc-unnamed-patient", "Unnamed patient")) + "</h2>" +
      // An unmerged trauma record must never read as a confirmed identity on a document that leaves
      // the hospital.
      (p.provisional ? '<span class="d-chip warning">' + ms("help") + wTH("ward.dc-provisional-identity", "Provisional identity, not yet merged") + "</span>" : "") +
      '<div class="d-encstate">' + encounterState(e) + "</div></div></div>" +
      '<dl class="d-facts">' + facts + "</dl></div>";
  }
  function encounterState(e) {
    if (e.status === "finished") return '<span class="d-chip done">' + ms("logout") + wTH("ward.dc-discharged", "Discharged") + (e.disposition ? " &middot; " + esc(e.disposition) : "") + "</span>";
    // Drafting a summary for a patient still on the ward is legitimate - it is how a planned
    // discharge is prepared - but the document must say the stay is still open.
    return '<span class="d-chip info">' + ms("bed") + wTH("ward.dc-still-admitted", "Still admitted &middot; the stay is open") + "</span>";
  }

  /* WHO SIGNED, as every chart screen names staff (ward.js staffWho): "Name (employee id)", the whole identity on hover
   * and on a tap. signedBy is the signer's sign-in id ("cfa:...", "fb:...", a staff ID), never shown as it is. Without
   * ward.js on the page an account id or a mobile number reads as "a clinician account". */
  function signerHtml(s) {
    var W = G.WARD, id = String(s.signedBy || "");
    if (!id) return wTH("ward.dc-clinician", "clinician");
    if (W && W._who) return W._who(id, null);
    return esc(signerText(s));
  }
  function signerText(s) {
    var W = G.WARD, id = String(s.signedBy || "");
    if (!id) return wT("ward.dc-clinician", "clinician");
    if (W && W._whoText) return W._whoText(id);
    return /^(fb|cfa|ghis):/.test(id) || /^\+?[\d\s().-]{7,}$/.test(id) ? wT("ward.a-clinician-account", "a clinician account") : id;
  }

  function signatureBlock(s) {
    if (!s.signed) return "";
    return '<div class="d-signed">' + ms("verified") +
      "<div><b>" + wTH("ward.dc-signed", "Signed") + "</b><span>" + signerHtml(s) + (s.recordedAt ? " &middot; " + esc(when(s.recordedAt, true, s.print)) : "") +
      "</span><small>" + wTH("ward.dc-version-immutable", "This version is immutable. A correction is a new signed version, not a change to this one.") + "</small></div>" +
      '<span class="d-ver">v' + esc(s.version == null ? "?" : s.version) + "</span></div>";
  }

  // ---- render: the document -----------------------------------------------------------------
  function sectionBody(sec, s) {
    var k = sec.k, body = textOf(s, k), edited = isEdited(s, k), absent = body === NOT_RECORDED || !body;

    if (s.editing === k) {
      return '<div class="d-edit">' +
        '<textarea id="dEdit" class="d-ta" rows="8" spellcheck="true">' + esc(body) + "</textarea>" +
        '<div class="d-editbar">' +
          '<button class="d-btn primary" data-d-act="save">' + ms("save") + wTH("ward.dc-save-section", "Save section") + "</button>" +
          '<button class="d-btn ghost" data-d-act="cancel">' + wTH("ward.dc-cancel", "Cancel") + "</button>" +
          (edited ? '<button class="d-btn ghost" data-d-act="revert:' + esc(k) + '" title="' + wTH("ward.dc-revert-title", "Return this section to tracking the record") + '">' + ms("undo") + wTH("ward.dc-revert-to-record", "Revert to record") + "</button>" : "") +
        "</div>" +
        '<p class="d-hint">' + ms("info") + wTH("ward.dc-saved-text-replaces", "Saved text replaces this section only. Every other section keeps refreshing from the record.") + "</p>" +
      "</div>";
    }

    var out = '<div class="d-body' + (absent ? " absent" : "") + '">' + (absent ? wTH("ward.dc-not-recorded", "Not recorded.") : esc(localTimes(body, s.print))) + "</div>";
    // What the record says, beside what the clinician wrote. This is the whole point of keeping both.
    if (edited) {
      var open = !!s.compare[k];
      out += '<button class="d-compare" data-d-act="compare:' + esc(k) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        ms(open ? "expand_less" : "expand_more") + (open ? wTH("ward.dc-hide-record", "Hide what the record says") : wTH("ward.dc-show-record", "Show what the record says")) + "</button>" +
        (open ? '<div class="d-source"><span class="d-srclabel">' + ms("database") + wTH("ward.dc-assembled-from-record", "Assembled from the record") + "</span><div class=\"d-body absent-src\">" + (s.assembled && s.assembled[k] && s.assembled[k] !== NOT_RECORDED ? esc(localTimes(s.assembled[k], s.print)) : wTH("ward.dc-not-recorded", "Not recorded.")) + "</div></div>" : "");
    }
    return out;
  }

  function section(sec, i, s) {
    var k = sec.k, edited = isEdited(s, k);
    var badge = edited
      ? '<span class="d-chip edit">' + ms("edit_note") + wTH("ward.dc-clinician-edited", "Clinician edited") + "</span>"
      : '<span class="d-chip src">' + ms("database") + wTH("ward.dc-from-record", "From record") + "</span>";
    var canEdit = s.canAuthor && !s.signed && s.editing !== k;
    return '<section class="d-sec' + (edited ? " is-edited" : "") + '" id="dsec-' + esc(k) + '">' +
      '<header class="d-sech"><span class="d-num">' + (i + 1) + "</span>" +
        "<h3>" + ms(sec.icon) + esc(sectionName(sec)) + "</h3>" + badge +
        (canEdit ? '<button class="d-ic" data-d-act="edit:' + esc(k) + '" title="' + wTH("ward.dc-correct-this-section", "Correct this section") + '">' + ms("edit") + "</button>" : "") +
      "</header>" +
      (sec.note && !s.signed ? '<p class="d-secnote">' + esc(sectionNote(sec)) + "</p>" : "") +
      sectionBody(sec, s) +
    "</section>";
  }

  function provenance(s) {
    var text = (s.sections && s.sections.provenance) || (s.assembled && s.assembled.provenance) || "";
    if (!text) return "";
    return '<section class="d-sec d-prov"><header class="d-sech"><h3>' + ms("fact_check") + wTH("ward.dc-provenance", "Provenance") + "</h3></header>" +
      '<div class="d-body">' + esc(text) + "</div>" +
      (s.edited && s.edited.length
        ? '<p class="d-provedit">' + ms("edit_note") + wTH("ward.dc-corrected-by-clinician", "Corrected by a clinician: {sections}. The rest is assembled from the record.", {
            sections: esc(s.edited.map(function (k) { var f = SECTIONS.filter(function (x) { return x.k === k; })[0]; return f ? (wLang() === "en" ? f.n.toLowerCase() : sectionName(f)) : k; }).join(", ")) }) + "</p>"
        : '<p class="d-provedit">' + ms("database") + wTH("ward.dc-nothing-edited", "Every section above is assembled from the record. Nothing has been edited.") + "</p>") +
    "</section>";
  }

  // ---- render: the rail ----------------------------------------------------------------------
  function pendingLabel(kind) {
    return kind === "dose" ? wT("ward.dc-pending-dose", "Dose not finished") : kind === "investigation" ? wT("ward.dc-pending-investigation", "Result pending")
      : kind === "medication" ? wT("ward.dc-pending-medication", "Order still active") : kind === "problem" ? wT("ward.dc-pending-problem", "Diagnosis unconfirmed") : kind;
  }
  function pendingCard(s) {
    var rows = (s.pending || []).map(function (p) {
      var what = p.drug || p.display || p.orderId || p.id;
      return '<li><span class="d-pk">' + esc(pendingLabel(p.kind)) + "</span>" +
        "<b>" + esc(what) + "</b>" + (p.status ? '<span class="d-pstat">' + esc(p.status) + "</span>" : "") +
        (p.dose && p.dose.value != null ? '<span class="d-pstat">' + esc(p.dose.value + " " + (p.dose.unit || "")) + "</span>" : "") + "</li>";
    }).join("");
    if (!rows) {
      return '<div class="d-card"><h4>' + ms("check_circle") + wTH("ward.dc-outstanding", "Outstanding") + "</h4>" +
        '<p class="d-ok">' + ms("check") + wTH("ward.dc-nothing-left-open", "Nothing is left open on this stay.") + "</p></div>";
    }
    // Amber, not red. It has to be seen, not alarmed about.
    return '<div class="d-card warn"><h4>' + ms("pending_actions") + wTH("ward.dc-outstanding", "Outstanding") + " &middot; " + s.pending.length + "</h4>" +
      '<p class="d-cardnote">' + wTH("ward.dc-open-orders-stop-discharge", "Open orders and pending results stop the discharge until a treating clinician records why the patient may go with them. It should be a decision, not a discovery.") + "</p>" +
      '<ul class="d-pending">' + rows + "</ul></div>";
  }
  function indexCard(s) {
    var rows = SECTIONS.map(function (sec, i) {
      return '<a class="d-idx' + (isEdited(s, sec.k) ? " is-edited" : "") + '" href="#dsec-' + esc(sec.k) + '">' +
        '<span class="d-num sm">' + (i + 1) + "</span>" + esc(sectionName(sec)) +
        (isEdited(s, sec.k) ? ms("edit_note") : "") + "</a>";
    }).join("");
    return '<div class="d-card"><h4>' + ms("list") + wTH("ward.dc-sections", "Sections") + "</h4><nav class=\"d-index\">" + rows + "</nav></div>";
  }
  function statusCard(s) {
    if (s.signed) return '<div class="d-card">' + signatureBlock(s) + "</div>";
    var lines = [
      s.hasDraft ? { i: "edit_document", t: wT("ward.dc-draft-saved", "Draft saved"), m: "v" + (s.version == null ? "?" : s.version) }
                 : { i: "auto_awesome_motion", t: wT("ward.dc-not-yet-drafted", "Not yet drafted"), m: wT("ward.dc-assembled-not-saved", "Assembled from the record, not saved") },
      { i: "person", t: s.canAuthor ? wT("ward.dc-you-may-sign", "You may sign this") : wT("ward.dc-read-only-for-you", "Read only for you"), m: s.canAuthor ? "" : wT("ward.dc-authoring-needs-treating", "Authoring a discharge summary needs a treating clinician.") }
    ];
    return '<div class="d-card"><h4>' + ms("draft") + wTH("ward.dc-status", "Status") + "</h4>" +
      lines.map(function (l) { return '<div class="d-stat">' + ms(l.i) + "<div><b>" + esc(l.t) + "</b>" + (l.m ? "<span>" + esc(l.m) + "</span>" : "") + "</div></div>"; }).join("") +
      "</div>";
  }

  // ---- render: banners + action bar ----------------------------------------------------------
  function banner(s) {
    if (s.refusal) {
      var rs = (s.refusal.reasons || []).map(function (r) { return "<li>" + esc(typeof r === "string" ? r : (r.code || "")) + "</li>"; }).join("");
      var refused = wTH("ward.dc-refused", "Refused");
      return '<div class="d-banner warn">' + ms("gpp_maybe") + "<div><b>" + refused + (refused !== "Refused" ? '<span class="en-orig" lang="en">Refused</span>' : "") + "</b>" + (rs ? "<ul>" + rs + "</ul>" : "") +
        (s.refusal.detail ? "<p>" + esc(s.refusal.detail) + wEnglishOf(s.refusal.detail) + "</p>" : "") + '</div><button class="d-x" data-d-act="dismiss">' + ms("close") + "</button></div>";
    }
    if (s.err) return '<div class="d-banner err">' + ms("error") + "<p>" + esc(s.err) + wEnglishOf(s.err) + '</p><button class="d-x" data-d-act="dismiss">' + ms("close") + "</button></div>";
    if (s.note) return '<div class="d-banner ok">' + ms("check_circle") + "<p>" + esc(s.note) + '</p><button class="d-x" data-d-act="dismiss">' + ms("close") + "</button></div>";
    return "";
  }

  function actionbar(s) {
    if (s.signed) {
      // Signed off: the locked idiom the assessment screen already uses. No Save, because offering
      // one that must fail is worse than not offering it.
      return '<div class="d-actions locked"><div class="d-lock">' + ms("lock") + "<span>" + wTH("ward.dc-signed-off", "Signed off") + "</span></div>" +
        '<div class="d-lockmsg">' + ms("verified") + (s.signedBy ? wTH("ward.dc-signed-by-locked", "Signed by {by} &middot; this version is locked", { by: signerHtml(s) }) : wTH("ward.dc-signed-locked", "Signed &middot; this version is locked")) + "</div>" +
        langPicker(s) + '<button class="d-btn ghost" data-d-act="print">' + ms("print") + wTH("ward.dc-print", "Print") + "</button></div>";
    }
    if (!s.canAuthor) {
      return '<div class="d-actions"><p class="d-hint">' + ms("info") + wTH("ward.dc-read-only-hint", "You can read this summary. Authoring and signing it needs a treating clinician.") + "</p>" +
        langPicker(s) + '<button class="d-btn ghost" data-d-act="print">' + ms("print") + wTH("ward.dc-print", "Print") + "</button></div>";
    }
    var n = (s.pending || []).length;
    return '<div class="d-actions">' +
      langPicker(s) + '<button class="d-btn ghost" data-d-act="print">' + ms("print") + wTH("ward.dc-print", "Print") + "</button>" +
      '<button class="d-btn" data-d-act="draft" title="' + wTH("ward.dc-save-draft-title", "Save the assembled summary as a draft") + '">' + ms("save") + (s.hasDraft ? wTH("ward.dc-refresh-draft", "Refresh draft") : wTH("ward.dc-save-draft", "Save draft")) + "</button>" +
      '<button class="d-btn sign" data-d-act="sign">' + ms("verified") + wTH("ward.dc-sign-and-finalise", "Sign and finalise") + "</button>" +
      (n ? '<span class="d-actwarn">' + ms("pending_actions") + wTH("ward.dc-n-outstanding", "{n} outstanding", { n: n }) + "</span>" : "") +
    "</div>";
  }

  function _render(s) {
    if (!s.loaded && !s.err) {
      return '<div class="d-shell">' + topbar(s) + '<div class="d-canvas"><div class="d-loading">' + ms("hourglass_top") + "<p>" + wTH("ward.dc-reading-the-record", "Reading the record…") + "</p></div></div></div>";
    }
    if (!s.encounter && s.err) {
      return '<div class="d-shell">' + topbar(s) + '<div class="d-canvas">' + banner(s) + "</div></div>";
    }
    return '<div class="d-shell">' + topbar(s) +
      '<div class="d-canvas"><div class="d-wrap">' +
        '<div class="d-main">' + banner(s) + identity(s) + signatureBlock(s) +
          SECTIONS.map(function (sec, i) { return section(sec, i, s); }).join("") +
          provenance(s) +
        "</div>" +
        '<aside class="d-rail">' + statusCard(s) + pendingCard(s) + indexCard(s) + "</aside>" +
      "</div></div>" + actionbar(s) + "</div>";
  }
  function topbar(s) {
    return '<header class="d-top"><button class="d-ic" data-d-act="close" title="' + wTH("ward.dc-close", "Close") + '">' + ms("arrow_back") + "</button>" +
      '<div class="d-toptitle"><b>' + wTH("ward.discharge-summary", "Discharge summary") + "</b><span>WardSynQ</span></div>" +
      (s.busy ? '<span class="d-busy">' + ms("progress_activity") + "</span>" : "<span></span>") + "</header>";
  }

  // ---- controller ----------------------------------------------------------------------------
  function root() { var el = document.getElementById("smdDischarge"); if (!el) { el = document.createElement("div"); el.id = "smdDischarge"; document.body.appendChild(el); } return el; }
  function repaintIfOpen() { var el = document.getElementById("smdDischarge"); if (el && el.classList.contains("on")) paint(); }
  function paint() {
    var r = root(), prev = r.querySelector(".d-canvas"), top = prev ? prev.scrollTop : 0;
    r.innerHTML = _render(st);
    // The signer named by staffWho is looked up with the ward's one staff lookup, and this overlay repainted when it answers.
    if (G.WARD && G.WARD._whoFetch) G.WARD._whoFetch(repaintIfOpen, st.orgId);
    var next = r.querySelector(".d-canvas"); if (next && top) next.scrollTop = top;
    var ta = document.getElementById("dEdit"); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function applyRead(r) {
    st.patient = r.patient || null;
    st.encounter = r.encounter || null;
    st.patientId = r.patientId || st.patientId;
    st.assembled = r.assembled || {};
    st.canAuthor = !!r.canAuthor;
    st.pending = r.pending || [];
    var stored = r.stored;
    st.hasDraft = !!stored;
    st.sections = stored ? (stored.sections || {}) : (r.assembled || {});
    st.edited = stored ? (stored.editedSections || []) : [];
    st.signed = !!(stored && stored.signed);
    st.signedBy = stored ? stored.signedBy : null;
    st.noteId = stored ? stored.noteId : null;
    st.version = stored ? stored.version : null;
    st.recordedAt = stored ? stored.recordedAt : null;
    st.print = r.print || null;          // { languagesEnabled, timeZone, utcOffsetMinutes } from the hospital's settings
  }

  function load(msg) {
    st.busy = true; paint();
    return apiGet("/ward/discharge-summary?orgId=" + encodeURIComponent(st.orgId) + "&encounterId=" + encodeURIComponent(st.encounterId))
      .then(function (r) { if (settle(r, msg)) applyRead(r); st.loaded = true; paint(); })
      .catch(function () { st.busy = false; st.loaded = true; st.err = wT("ward.dc-could-not-reach-record", "Could not reach the record."); paint(); });
  }

  /** Saves the whole current section set, with `patch` applied. The server re-assembles the rest. */
  function draft(patch, msg) {
    st.busy = true; paint();
    var body = { orgId: st.orgId, encounterId: st.encounterId };
    if (patch) body.sections = patch;
    return apiPost("/ward/discharge-summary", body)
      .then(function (r) { if (settle(r, msg)) { st.editing = ""; return load(msg); } paint(); })
      .catch(function () { st.busy = false; st.err = wT("ward.dc-could-not-save-draft", "Could not save the draft."); paint(); });
  }

  function sign() {
    var n = (st.pending || []).length;
    var warn = !n ? "" : "\n\n" + (n === 1 ? wTD("ward.dc-sign-one-outstanding", "There is 1 item still outstanding on this stay. Signing does not resolve them.") : wTD("ward.dc-sign-n-outstanding", "There are {n} items still outstanding on this stay. Signing does not resolve them.", { n: n }));
    if (!confirmed(wTD("ward.dc-sign-confirm", "Sign this discharge summary?\n\nIt becomes part of the permanent record and CANNOT be edited. A correction afterwards is a new signed version.") + warn)) return;
    st.busy = true; paint();
    apiPost("/ward/sign-discharge-summary", { orgId: st.orgId, encounterId: st.encounterId })
      .then(function (r) { if (settle(r)) return load(wT("ward.dc-signed-now-immutable", "Signed. This version is now immutable.")); paint(); })
      .catch(function () { st.busy = false; st.err = wT("ward.dc-could-not-sign", "Could not sign the summary."); paint(); });
  }

  /* Printed as its own document, not as the screen with the chrome hidden: a summary handed to a
   * patient must not depend on the app's theme, and @media print on a dark-mode overlay is exactly
   * how that goes wrong. The markup is plain and self-contained. */
  /* A SECOND LANGUAGE IS OPTIONAL AND ENGLISH STAYS WHOLE (owner decision 2026-09-15, wardsynq/site/print-lang.js).
   * With a language picked, `tr(...)` asides are added between the English blocks, carrying only catalog words:
   * the headings and labels, the authority line, and the signature wording. Every section's text is recorded or
   * assembled clinical text, so its aside says it is printed in English only. Without one, tr() is "". */
  function printable(s) {
    s = s || st;                       // the controller prints what is on screen; callers may pass a state
    var p = s.patient || {}, e = s.encounter || {};
    var WP = G.WSQPrint, lang = WP && WP.enabled(s.print) && WP.valid(s.printLang) ? s.printLang : "";
    var tr = function (html) { return lang ? WP.aside(lang, html) : ""; };
    var T = function (k) { return lang ? esc(WP.t(k, lang)) : ""; };
    var pd = function (iso) { return WP ? WP.date(iso, s.print, true) : when(iso); };   // the hospital's clock, "15 Sep 2026, 09:05"
    var rows = [
      ["Patient", p.name || s.patientId, "patient"], ["MRN", p.mrn], ["Sex", p.sex, "sex"],
      ["Ward", e.ward ? e.ward + (e.bed ? ", bed " + e.bed : "") : null, "ward"],
      ["Admitted", pd(e.admittedAt), "admitted"], ["Discharged", pd(e.dischargedAt), "discharged"]
    ].filter(function (r) { return r[1]; });
    var head = rows.map(function (r) { return '<div class="p-f"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>"; }).join("");
    var headTr = rows.filter(function (r) { return r[2]; }).map(function (r) { return esc(r[0]) + ": " + T("print.dc.field." + r[2]); }).join(" &middot; ");
    var body = SECTIONS.map(function (sec, i) {
      return '<section><h2>' + (i + 1) + ". " + esc(sec.n) + (isEdited(s, sec.k) ? ' <em>clinician edited</em>' : "") + "</h2><p>" + esc(localTimes(textOf(s, sec.k) || NOT_RECORDED, s.print)) + "</p></section>" +
        tr("<h2>" + (i + 1) + ". " + T("print.dc.section." + sec.k) + "</h2><p>" + T("print.tr.englishOnly") + "</p>");
    }).join("");
    var prov = (s.sections && s.sections.provenance) || (s.assembled && s.assembled.provenance) || "";
    var sig = s.signed
      ? '<div class="p-sig"><div class="ln"></div><span>Signed by ' + esc(signerText(s)) + (s.recordedAt ? " on " + esc(pd(s.recordedAt)) : "") + " &middot; version " + esc(s.version) + "</span></div>" +
        tr("<p>" + T("print.dc.signedBy") + "</p>")
      : '<div class="p-sig"><div class="ln"></div><span>Signature</span><p class="p-draft">UNSIGNED DRAFT - not a final discharge summary.</p></div>' +
        tr('<p class="p-draft">' + T("print.dc.unsigned") + "</p>");
    return "<h1>Discharge summary</h1><div class=\"p-head\">" + head + "</div>" +
      tr("<h2>" + T("print.dc.title") + "</h2>" + (lang ? WP.authority("dc", lang) : "") + "<p>" + headTr + "</p>") + body +
      (prov ? '<section class="p-prov"><h2>Provenance</h2><p>' + esc(prov) + "</p></section>" + tr("<h2>" + T("print.dc.provenance") + "</h2><p>" + T("print.tr.englishOnly") + "</p>") : "") + sig;
  }
  function doPrint() {
    var w = root().querySelector(".d-print");
    if (!w) { w = document.createElement("div"); w.className = "d-print"; root().appendChild(w); }
    var go = function () { w.innerHTML = printable(); try { G.print(); } catch (e) {} };
    // The picked language's catalog is loaded first, so the paper never goes out half in English by accident.
    if (st.printLang && G.WSQPrint) G.WSQPrint.ensureLoaded(st.printLang, go); else go();
  }
  /* Offered only when the hospital turned it on (Admin > Hospital). Off means no picker at all. */
  function langPicker(s) {
    var WP = G.WSQPrint;
    return WP && WP.enabled(s.print) ? '<label class="d-lang"><span>' + wTH("ward.dc-second-language-print", "Second language on the print") + "</span>" + WP.picker("dPrintLang", s.printLang || "") + "</label>" : "";
  }

  function onClick(e) {
    // A tap on the signer says name, employee id and role (touch screens have no hover), as on every chart screen.
    var w = e.target.closest && e.target.closest('[data-w-act^="whoinfo:"]');
    if (w && G.WARD && G.WARD._whoInfo) { G.WARD._whoInfo(w.getAttribute("data-w-act").slice(8)); return; }
    var b = e.target.closest && e.target.closest("[data-d-act]"); if (!b) return;
    var a = b.getAttribute("data-d-act"), i = a.indexOf(":"), cmd = i < 0 ? a : a.slice(0, i), arg = i < 0 ? "" : a.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "dismiss") { st.err = ""; st.note = ""; st.refusal = null; paint(); return; }
    if (cmd === "compare") { st.compare[arg] = !st.compare[arg]; paint(); return; }
    if (cmd === "edit") { st.editing = arg; paint(); return; }
    if (cmd === "cancel") { st.editing = ""; paint(); return; }
    if (cmd === "print") { doPrint(); return; }
    if (cmd === "draft") { draft(null, wT("ward.dc-draft-saved-from-record", "Draft saved from the record.")); return; }
    if (cmd === "sign") { sign(); return; }
    if (cmd === "save") {
      var k = st.editing; if (!k) return;
      var patch = {}; patch[k] = val("dEdit");
      draft(patch, wT("ward.dc-section-saved", "Section saved."));
      return;
    }
    if (cmd === "revert") {
      var text = (st.assembled && st.assembled[arg]) || NOT_RECORDED;
      if (!confirmed(wTD("ward.dc-discard-correction", "Discard your correction to this section and return it to the record's own text?"))) return;
      var rp = {}; rp[arg] = text;
      draft(rp, wT("ward.dc-section-returned", "Section returned to the record."));
      return;
    }
  }

  function onChange(e) {
    if (!e.target || e.target.id !== "dPrintLang") return;
    st.printLang = e.target.value;
    if (G.WSQPrint) G.WSQPrint.ensureLoaded(st.printLang);
  }

  function open(opts) {
    opts = opts || {};
    st.orgId = opts.orgId || st.orgId || "";
    st.encounterId = opts.encounterId || "";
    st.patientId = opts.patientId || "";
    if (!st.orgId || !st.encounterId) { try { G.toast && G.toast(wT("ward.dc-needs-an-admission", "A discharge summary needs an admission.")); } catch (e) {} return; }
    st.loaded = false; st.err = ""; st.note = ""; st.refusal = null; st.editing = ""; st.compare = {}; st.printLang = "";
    var el = root(); el.classList.add("on");
    el.removeEventListener("click", onClick); el.addEventListener("click", onClick);
    el.removeEventListener("change", onChange); el.addEventListener("change", onChange);
    paint(); load();
  }
  function close() { var el = root(); el.classList.remove("on"); el.innerHTML = ""; }

  G.DISCHARGE = { open: open, close: close, _render: _render, _st: st, _sections: SECTIONS, _problem: problem, _printable: printable };
})();
