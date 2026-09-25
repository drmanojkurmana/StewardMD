/* StewardMD - kits sharing, wave 2 (window.SMD_SHARE). Client for /api/kits/* (functions/_kits_share.js).
 *
 *   Inbox       referrals and handovers received and sent; accept, decline, acknowledge (with the
 *               I-PASS read-back), withdraw. Case rooms: de-identified threads with invited colleagues.
 *   Compose     a referral letter or handover from Clinical Documents, sent to a colleague's StewardMD ID.
 *               Both doctors must be registration-verified; the server enforces it.
 *   Unit kit    the hospital's own additions to a kit (notes, order sets, local test names, contacts),
 *               shown inside the kit; owners and heads of department edit and publish versions.
 *   History     kit values saved per patient across visits (the antenatal card), OPD only.
 *   Reviews     the review desk sends its decisions to the owner.
 *
 * Flag smd_kits_share, default OFF (?share=1 turns it on for this device, ?share=0 off). The server
 * route is also off until KITS_SHARE_ON=1. Nothing here is stored on the phone except the flag; lists
 * and messages are fetched when opened and dropped when the sheet closes. Patient ids go in POST bodies,
 * never URLs. Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function toast(m) { try { var f = G.toast || G.SMD_toast; if (f) f(m); } catch (e) {} }
  function flagOn() {
    try {
      var q = (G.location && (G.location.search.match(/[?&]share=([^&]+)/) || [])[1]);
      if (q === "1" || q === "true") return true; if (q === "0" || q === "false") return false;
      return !!(G.localStorage && G.localStorage.getItem("smd_kits_share") === "1");
    } catch (e) { return false; }
  }
  function fmt(ms_) { try { var d = new Date(ms_); return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); } catch (e) { return ""; } }
  var ERR = {
    verify_required: "Only registration-verified doctors can share patient information. Verify your registration first.",
    recipient_not_found: "No StewardMD doctor has that ID. Check it with your colleague.", recipient_not_verified: "That doctor has not verified their registration yet, so patient information cannot be sent to them.",
    cannot_send_to_self: "That is your own StewardMD ID.", rate_limited: "Too many in a short time. Try again in a while.", auth_required: "Sign in to use this.",
    disabled: "Sharing is not switched on yet.", readback_required: "Read the plan back in your own words to acknowledge the handover.", reason_required: "Give the reason for referral or your question.",
    patient_required: "Add the patient's name or age.", rows_required: "Add at least one patient to the handover.", title_and_question_required: "Give the case a title and your question.",
    not_allowed: "You cannot do that here.", owner_only: "Only the doctor who opened the case can do that.", case_closed: "This case is closed.", empty: "Nothing to save yet.",
    changed_retry: "It changed while you were looking. Try again.", too_large: "That is too long to send."
  };
  function errText(e) { return ERR[e] || "Could not reach StewardMD. Check your connection and try again."; }

  /* ------------------------------------------------------------------ network */
  function fbUser() { try { var a = G.SMD_AUTH || (G.firebase && G.firebase.auth && G.firebase.auth()); return a && a.currentUser; } catch (e) { return null; } }
  function token() {
    var t = G.SMD_IDTOKEN && G.SMD_IDTOKEN(); if (t) return Promise.resolve(t);
    var u = fbUser(); if (!u || !u.getIdToken) return Promise.resolve(null);
    return new Promise(function (res) { var done = false; setTimeout(function () { if (!done) { done = true; res(null); } }, 6000); u.getIdToken().then(function (x) { if (!done) { done = true; res(x); } }, function () { if (!done) { done = true; res(null); } }); });
  }
  function api(method, path, body) {
    return token().then(function (t) {
      if (!t) return { status: 401, body: { error: "auth_required" } };
      var init = { method: method, headers: { Authorization: "Bearer " + t } };
      if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
      // Relative on purpose: native-bridge.js sends relative /api/* through CapacitorHttp (no CORS); an
      // absolute https://stewardmd.in/api URL would go out as a browser request and fail the preflight.
      return fetch("/api/kits/" + path, init).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j || {} }; }, function () { return { status: r.status, body: {} }; }); });
    }).catch(function () { return { status: 0, body: { error: "network" } }; });
  }

  /* ------------------------------------------------------------------ sheet */
  var S = { view: "inbox", tab: "in", list: null, cases: null, cur: null, compose: null, busy: false, unitEdit: null, me: "" };
  function sheet() {
    var el = D.getElementById("smdShare");
    if (!el) {
      el = D.createElement("div"); el.id = "smdShare"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Colleagues");
      el.innerHTML = '<div class="kit-sheet"><header class="kit-sheet-top"><button type="button" class="kit-x" data-sh-act="close" aria-label="Close colleagues">' + ms("close") + '</button><h1>Colleagues</h1><span></span></header><div class="kit-sheet-body"></div></div>';
      D.body.appendChild(el);
    }
    return el;
  }
  function show() { sheet().classList.add("on"); render(); }
  function close() { var el = D && D.getElementById("smdShare"); if (el) el.classList.remove("on"); S.list = null; S.cases = null; S.cur = null; S.compose = null; S.unitEdit = null; S.view = "inbox"; }
  function body() { return sheet().querySelector(".kit-sheet-body"); }
  function pill(st) {
    var map = { sent: "Sent", seen: "Seen", accepted: "Accepted", declined: "Declined", acknowledged: "Acknowledged", withdrawn: "Withdrawn", open: "Open", closed: "Closed" };
    return '<span class="rv-pill' + (st === "accepted" || st === "acknowledged" ? " ok" : "") + '">' + esc(map[st] || st) + "</span>";
  }
  function field(id, label, val, type, hint) {
    if (type === "textarea") return '<label class="kit-field wide" for="' + id + '"><span class="kit-fl">' + esc(label) + '</span><textarea id="' + id + '" rows="4" class="kit-inp" placeholder="' + esc(hint || "") + '">' + esc(val || "") + "</textarea></label>";
    return '<label class="kit-field wide" for="' + id + '"><span class="kit-fl">' + esc(label) + '</span><input id="' + id + '" class="kit-inp" autocomplete="off" value="' + esc(val || "") + '" placeholder="' + esc(hint || "") + '"></label>';
  }
  function val(id) { var el = D.getElementById(id); return el ? String(el.value || "").trim() : ""; }
  function kv(label, v) { return v ? "<p><b>" + esc(label) + ":</b> " + esc(v).replace(/\n/g, "<br>") + "</p>" : ""; }

  function render() {
    var el = D && D.getElementById("smdShare"); if (!el || !el.classList.contains("on")) return;
    var b = body(), html = "";
    if (S.view === "inbox") html = inboxHtml();
    else if (S.view === "msg") html = msgHtml();
    else if (S.view === "compose") html = composeHtml();
    else if (S.view === "case") html = caseHtml();
    else if (S.view === "newcase") html = newCaseHtml();
    else if (S.view === "unit") html = unitEditHtml();
    b.innerHTML = '<div class="kit dl sh">' + html + "</div>";
  }
  function back() { return '<button type="button" class="kit-link" data-sh-act="inbox">' + ms("arrow_back") + "Colleagues</button>"; }

  /* inbox */
  function loadInbox() {
    S.list = null; S.cases = null; render();
    api("GET", "msg/list").then(function (r) { S.list = r.status === 200 ? r.body : { error: r.body.error }; render(); });
    api("GET", "case/list").then(function (r) { S.cases = r.status === 200 ? r.body.cases : []; render(); });
  }
  // Your own StewardMD ID, so you can give it to colleagues (minted on first open if you had none).
  function meHtml() {
    return S.me ? '<p class="kit-muted sh-me">Your StewardMD ID: <b>' + esc(S.me) + '</b> <button type="button" class="kit-link" data-sh-act="copyid">' + ms("content_copy") + "Copy</button><br>Colleagues can send to this ID or to your sign-in email.</p>"
      : '<p class="kit-muted sh-me">Colleagues can send to your sign-in email. Your StewardMD ID appears here once it is ready.</p>';
  }
  function loadMe() {
    try { var id = G.SMD_STEWARD_ID && G.SMD_STEWARD_ID.my && G.SMD_STEWARD_ID.my(); if (id) { S.me = id; return; } } catch (e) {}
    try { if (G.SMD_STEWARD_ID && G.SMD_STEWARD_ID.ensure) G.SMD_STEWARD_ID.ensure({}, function (x) { if (x) { S.me = x; render(); } }); } catch (e) {}
  }
  function copyText(t) {
    var ok = false;
    try { var ta = D.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; D.body.appendChild(ta); ta.select(); ok = D.execCommand("copy"); D.body.removeChild(ta); } catch (e) {}
    if (!ok) { try { G.navigator.clipboard.writeText(t); ok = true; } catch (e) {} }
    toast(ok ? "Copied " + t + "." : "Your StewardMD ID is " + t + ".");
  }
  function inboxHtml() {
    var tabs = [["in", "Received"], ["out", "Sent"], ["cases", "Case rooms"]];
    var h = meHtml() + '<div class="kit-row" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="kit-seg' + (S.tab === t[0] ? " on" : "") + '" data-sh-act="tab:' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>";
    if (S.tab === "cases") {
      h += '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="newcase">' + ms("forum") + "Ask colleagues about a case</button></div>";
      if (!S.cases) return h + '<p class="kit-muted">Loading…</p>';
      if (!S.cases.length) return h + '<p class="kit-muted">No case rooms yet. Open one to ask colleagues from other branches for an opinion, without patient identifiers.</p>';
      return h + '<div class="rv-list">' + S.cases.map(function (c) {
        return '<button type="button" class="rv-row" data-sh-act="case:' + esc(c.id) + '"><span class="rv-t">' + esc(c.title) + '</span><span class="rv-s">' + esc(c.ownerName) + ", " + c.posts + " repl" + (c.posts === 1 ? "y" : "ies") + ", " + esc(fmt(c.updatedAt)) + "</span><span>" + pill(c.status) + "</span></button>";
      }).join("") + "</div>";
    }
    if (!S.list) return h + '<p class="kit-muted">Loading…</p>';
    if (S.list.error) return h + '<p class="kit-muted">' + esc(errText(S.list.error)) + "</p>";
    var rows = S.tab === "in" ? S.list.inbox : S.list.sent;
    if (!rows.length) return h + '<p class="kit-muted">' + (S.tab === "in" ? "Nothing received. Referrals and handovers sent to you appear here." : "Nothing sent. Send a referral letter or a handover from Documents.") + "</p>";
    return h + '<div class="rv-list">' + rows.map(function (m) {
      var who = S.tab === "in" ? m.fromName + (m.fromRegNo ? " (Reg. No. " + m.fromRegNo + ")" : "") : "To " + (m.toName || m.toLabel);
      return '<button type="button" class="rv-row" data-sh-act="msg:' + esc(m.id) + '"><span class="rv-t">' + (m.kind === "referral" ? "Referral" : "Handover") + (m.urgency && m.urgency !== "Routine" ? ": " + esc(m.urgency) : "") + '</span><span class="rv-s">' + esc(who) + ", " + esc(fmt(m.createdAt)) + "</span><span>" + pill(m.status) + "</span></button>";
    }).join("") + "</div>";
  }

  /* one message */
  function openMsg(id) {
    S.view = "msg"; S.cur = null; render();
    api("POST", "msg/read", { id: id }).then(function (r) { S.cur = r.status === 200 ? r.body.msg : { error: r.body.error || "not_found" }; render(); });
  }
  function msgHtml() {
    var m = S.cur; if (!m) return back() + '<p class="kit-muted">Loading…</p>';
    if (m.error) return back() + '<p class="kit-muted">' + (m.error === "not_found" ? "This item has expired or was withdrawn." : esc(errText(m.error))) + "</p>";
    var p = m.payload || {}, h = back() + '<h2 class="dl-h">' + (m.kind === "referral" ? "Referral" : "Shift handover") + "</h2>" + pill(m.status) +
      '<p class="kit-muted">' + (m.dir === "in" ? "From " + esc(m.fromName) + (m.fromRegNo ? ", Reg. No. " + esc(m.fromRegNo) : "") : "To " + esc(m.toName || m.toLabel)) + ", " + esc(fmt(m.createdAt)) + ". Expires " + esc(fmt(m.expiresAt)) + ".</p>";
    if (m.kind === "referral") {
      var pt = p.patient || {};
      h += '<section class="kit-card">' + kv("Patient", [pt.name, pt.age ? pt.age + (/^\d+$/.test(pt.age) ? " years" : "") : "", pt.sex].filter(Boolean).join(", ")) + kv("Urgency", m.urgency) + kv("Reason for referral", p.reason) +
        kv("History and findings", p.history) + kv("Investigations so far", p.investigations) + kv("Treatment given", p.treatment) + kv("Question", p.question) + kv("Specialty kit summary", p.kitSummary) + "</section>";
    } else {
      h += '<section class="kit-card">' + kv("Ward or unit", p.unit) + kv("Shift", p.shift) + (p.rows || []).map(function (r) {
        return '<div class="sh-row"><b>' + esc(r.bed || "Patient") + "</b>" + (r.sev ? " " + pill(r.sev) : "") + kv("Summary", r.summary) + kv("Actions", r.actions) + kv("If this happens", r.cont) + "</div>";
      }).join("") + "</section>";
    }
    if (m.reply) h += '<section class="kit-card">' + kv((m.kind === "handover" ? "Read-back" : "Reply") + " from " + m.reply.by, m.reply.note) + "</section>";
    var final = ["accepted", "declined", "acknowledged", "withdrawn"].indexOf(m.status) >= 0;
    if (!final && m.dir === "in") {
      h += m.kind === "referral"
        ? field("sh_note", "Reply (optional)", "", "textarea", "e.g. Bed arranged, send the patient to labour ward") + '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="st:accepted">' + ms("check") + 'Accept</button><button type="button" class="kit-clear" data-sh-act="st:declined">Decline</button></div>'
        : field("sh_note", "Read the plan back (I-PASS synthesis)", "", "textarea", "In your own words: who is sick, what is due, what to do if it changes") + '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="st:acknowledged">' + ms("task_alt") + "Acknowledge handover</button></div>";
    }
    if (!final && m.dir === "out") h += '<div class="kit-row"><button type="button" class="kit-clear" data-sh-act="st:withdrawn">Withdraw</button></div>';
    return h;
  }

  /* compose referral / handover */
  function composeHtml() {
    var c = S.compose, p = c.payload || {};
    var what = c.kind === "referral"
      ? kv("Patient", [p.patient && p.patient.name, p.patient && p.patient.age, p.patient && p.patient.sex].filter(Boolean).join(", ")) + kv("Reason", p.reason) + kv("Question", p.question) + (p.kitSummary ? kv("Specialty kit summary", p.kitSummary) : "")
      : kv("Ward or unit", p.unit) + kv("Patients", String((p.rows || []).length));
    return back() + '<h2 class="dl-h">' + (c.kind === "referral" ? "Send the referral in StewardMD" : "Send the handover in StewardMD") + "</h2>" +
      '<p class="kit-muted">Goes only to the doctor whose StewardMD ID or email you enter, if their registration is verified. Encrypted, and deleted after ' + (c.kind === "referral" ? "31 days" : "3 days") + ".</p>" +
      '<section class="kit-card">' + what + "</section>" + field("sh_to", "Colleague's StewardMD ID or email", c.to || "", "text", "SMD-XXXXXX or name@hospital.in") +
      (c.kind === "referral" ? '<label class="kit-check"><input type="checkbox" id="sh_consent"><span>The patient agreed to this referral being sent to this doctor.</span></label>' : "") +
      '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="send"' + (S.busy ? " disabled" : "") + ">" + ms("send") + "Send</button></div>";
  }
  function send() {
    var c = S.compose, raw = val("sh_to"), isEmail = EMAIL_RE.test(raw), to = isEmail ? raw.toLowerCase() : raw.toUpperCase();
    if (!isEmail && !/^(SMD-)?[A-Z0-9]{6}$/.test(to)) { toast("Enter the StewardMD ID (like SMD-AB12CD) or the email your colleague signs in with."); return; }
    if (c.kind === "referral" && !(D.getElementById("sh_consent") || {}).checked) { toast("Confirm the patient agreed to the referral."); return; }
    S.busy = true; render();
    api("POST", "msg/send", { kind: c.kind, to: isEmail ? { email: to } : { smdId: to }, kitId: c.kitId || "", urgency: c.urgency || "", payload: c.payload }).then(function (r) {
      S.busy = false;
      if (r.status === 200) { toast(c.kind === "referral" ? "Referral sent." : "Handover sent. You will see when it is acknowledged."); S.compose = null; S.view = "inbox"; S.tab = "out"; loadInbox(); }
      else { c.to = to; render(); toast(errText(r.body.error)); }
    });
  }

  /* case rooms */
  function openCase(id) { S.view = "case"; S.cur = null; render(); api("POST", "case/read", { id: id }).then(function (r) { S.cur = r.status === 200 ? r.body : { error: r.body.error || "not_found" }; render(); }); }
  function caseHtml() {
    var c = S.cur; if (!c) return back() + '<p class="kit-muted">Loading…</p>';
    if (c.error) return back() + '<p class="kit-muted">' + (c.error === "not_found" ? "This case room has expired or you are not in it." : esc(errText(c.error))) + "</p>";
    var k = c.case, h = back() + '<h2 class="dl-h">' + esc(k.title) + "</h2>" + pill(k.status) + '<p class="kit-muted">Opened by ' + esc(k.ownerName) + ". Members: " + esc(c.members.map(function (m) { return m.name || "a colleague"; }).join(", ")) + ".</p>" +
      '<section class="kit-card">' + kv("Question", k.question) + kv("Summary", k.summary) + "</section>" +
      c.posts.map(function (p) { return '<div class="sh-post' + (p.mine ? " mine" : "") + '"><b>' + esc(p.by) + "</b> <span class=\"kit-muted\">" + esc(fmt(p.at)) + "</span><p>" + esc(p.text).replace(/\n/g, "<br>") + "</p></div>"; }).join("");
    if (k.status === "open") {
      h += field("sh_reply", "Your reply", "", "textarea", "No names, numbers or photos that identify the patient") + '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="reply">' + ms("reply") + "Reply</button></div>";
      if (k.role === "owner") h += field("sh_inv", "Invite more colleagues (StewardMD IDs or emails, separated by commas)", "", "text", "SMD-AB12CD, name@hospital.in") +
        '<div class="kit-row"><button type="button" class="kit-pill" data-sh-act="invite">' + ms("person_add") + 'Invite</button><button type="button" class="kit-clear" data-sh-act="closecase">Close the case</button></div>';
    }
    return h;
  }
  function newCaseHtml() {
    var c = S.compose || {};
    return back() + '<h2 class="dl-h">Ask colleagues about a case</h2><p class="kit-muted">De-identified: no name, hospital number, phone, address or photo. The server removes identifier-like text too. Only the colleagues you invite can read it.</p>' +
      field("sh_title", "Title", c.title || "", "text", "e.g. Recurrent pleural effusion, cytology negative") + field("sh_q", "Your question", "", "textarea", "What would you like their opinion on?") +
      field("sh_sum", "Summary", c.summary || "", "textarea", "Age, sex, key history, findings and results") + field("sh_inv", "Invite colleagues (StewardMD IDs or emails, separated by commas)", "", "text", "SMD-AB12CD, name@hospital.in") +
      '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="createcase"' + (S.busy ? " disabled" : "") + ">" + ms("forum") + "Open the case room</button></div>";
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // StewardMD IDs or emails, separated by commas or spaces.
  function ids(s) { return String(s || "").split(/[\s,;]+/).map(function (x) { return EMAIL_RE.test(x) ? x.toLowerCase() : x.toUpperCase(); }).filter(function (x) { return EMAIL_RE.test(x) || /^(SMD-)?[A-Z0-9]{6}$/.test(x); }); }
  var WHY = { recipient_not_found: "no StewardMD doctor with that ID", recipient_not_verified: "registration not verified yet", cannot_send_to_self: "that is your own ID", room_full: "the room is full" };
  function notFoundText(nf) { return nf && nf.length ? " Not added: " + nf.map(function (x) { return x.smdId + " (" + (WHY[x.error] || "could not be added") + ")"; }).join("; ") + "." : ""; }

  /* unit version editor */
  function unitEditHtml() {
    var u = S.unitEdit, c = u.content || {};
    var os = (c.orderSets || []).map(function (o) { return o.label + ": " + o.tests.join(", "); }).join("\n");
    var inv = (c.investigations || []).map(function (x) { return x.label; }).join("\n");
    return back() + '<h2 class="dl-h">' + esc(u.orgName) + ": your version of " + esc(u.kitLabel) + '</h2><p class="kit-muted">Adds to the kit for every doctor in ' + esc(u.orgName) + ". Each publish is a new version; earlier versions are kept. No patient information.</p>" +
      field("sh_notes", "Unit notes (local protocol, where things are, who to call)", c.notes || "", "textarea") +
      field("sh_os", "Order sets, one per line: Name: test, test, test", os, "textarea", "Pre-eclampsia panel: CBC, LFT, RFT, urine protein") +
      field("sh_invs", "Local test names, one per line (as your lab lists them)", inv, "textarea") +
      field("sh_contacts", "Contacts, one per line", (c.contacts || []).join("\n"), "textarea", "On-call obstetrician: ext 2345") +
      field("sh_reason", "Reason for this version", u.reason || "", "text", "e.g. Unit meeting 20 September") +
      '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="publish"' + (S.busy ? " disabled" : "") + ">" + ms("publish") + "Publish</button>" +
      (u.version ? '<button type="button" class="kit-clear" data-sh-act="retire">Withdraw the unit version</button>' : "") + "</div>";
  }
  function lines(s) { return String(s || "").split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean); }

  /* ------------------------------------------------------------------ events */
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-sh-act]"); if (!b || !b.closest("#smdShare")) return;
    var act = b.getAttribute("data-sh-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "inbox") { S.view = "inbox"; S.cur = null; loadInbox(); return; }
    if (cmd === "copyid") { if (S.me) copyText(S.me); return; }
    if (cmd === "tab") { S.tab = arg; render(); return; }
    if (cmd === "msg") { openMsg(arg); return; }
    if (cmd === "case") { openCase(arg); return; }
    if (cmd === "newcase") { S.view = "newcase"; S.compose = S.compose || {}; render(); return; }
    if (cmd === "send") { send(); return; }
    if (cmd === "st") {
      var note = val("sh_note");
      if (arg === "acknowledged" && !note) { toast(errText("readback_required")); return; }
      api("POST", "msg/status", { id: S.cur.id, status: arg, note: note }).then(function (r) { if (r.status === 200) { toast("Done."); openMsg(S.cur.id); } else toast(errText(r.body.error)); });
      return;
    }
    if (cmd === "reply") {
      var t = val("sh_reply"); if (!t) return;
      api("POST", "case/post", { id: S.cur.case.id, text: t }).then(function (r) { if (r.status === 200) openCase(S.cur.case.id); else toast(errText(r.body.error)); });
      return;
    }
    if (cmd === "invite") {
      api("POST", "case/invite", { id: S.cur.case.id, smdIds: ids(val("sh_inv")) }).then(function (r) { if (r.status === 200) { toast(r.body.invited + " invited." + notFoundText(r.body.notFound)); openCase(S.cur.case.id); } else toast(errText(r.body.error)); });
      return;
    }
    if (cmd === "closecase") { api("POST", "case/close", { id: S.cur.case.id }).then(function (r) { if (r.status === 200) openCase(S.cur.case.id); else toast(errText(r.body.error)); }); return; }
    if (cmd === "createcase") {
      // Read every field BEFORE render(): render rebuilds the form.
      var c = S.compose || {}, req = { title: val("sh_title"), question: val("sh_q"), summary: val("sh_sum"), kitId: c.kitId || "", invite: ids(val("sh_inv")) };
      c.title = req.title; c.summary = req.summary; S.busy = true; render();
      api("POST", "case/create", req).then(function (r) {
        S.busy = false;
        if (r.status === 200) { toast("Case room opened. " + r.body.invited + " invited." + notFoundText(r.body.notFound)); S.compose = null; openCase(r.body.id); }
        else { render(); toast(errText(r.body.error)); }
      });
      return;
    }
    if (cmd === "publish") {
      if (!val("sh_reason")) { toast("Give the reason for this version."); return; }
      var u = S.unitEdit, content = {
        notes: val("sh_notes"), contacts: lines(val("sh_contacts")),
        investigations: lines(val("sh_invs")).map(function (x) { return { label: x }; }),
        orderSets: lines(val("sh_os")).map(function (l) { var k = l.indexOf(":"); return k < 0 ? null : { label: l.slice(0, k).trim(), tests: l.slice(k + 1).split(",").map(function (x) { return x.trim(); }).filter(Boolean) }; }).filter(Boolean)
      };
      var reason = val("sh_reason"); u.content = content; u.reason = reason; S.busy = true; render();
      api("POST", "unit/publish", { orgId: u.orgId, kitId: u.kitId, content: content, reason: reason }).then(function (r) {
        S.busy = false;
        if (r.status === 200) { toast("Version " + r.body.version + " published for " + u.orgName + "."); UNIT[u.kitId] = null; close(); if (G.SMD_KITS && G.SMD_KITS.refresh) G.SMD_KITS.refresh(); }
        else { u.content = content; render(); toast(errText(r.body.error)); }
      });
      return;
    }
    if (cmd === "retire") {
      var u2 = S.unitEdit, why = val("sh_reason"); if (!why) { toast("Give the reason."); return; }
      api("POST", "unit/retire", { orgId: u2.orgId, kitId: u2.kitId, reason: why }).then(function (r) { if (r.status === 200) { toast("Unit version withdrawn."); UNIT[u2.kitId] = null; close(); if (G.SMD_KITS && G.SMD_KITS.refresh) G.SMD_KITS.refresh(); } else toast(errText(r.body.error)); });
    }
  }
  if (D && D.addEventListener && !G.__smdShareWired) { G.__smdShareWired = true; D.addEventListener("click", onClick, false); }

  /* ------------------------------------------------------------------ public API used by other modules */
  var UNIT = {}, HIST = {};
  /** Promise of { versions, canPublish } for a kit (cached per kit for this session). */
  function unitFor(kitId) {
    if (!flagOn()) return Promise.resolve(null);
    if (!UNIT[kitId]) UNIT[kitId] = api("GET", "unit?kit=" + encodeURIComponent(kitId)).then(function (r) { return r.status === 200 ? r.body : null; });
    return UNIT[kitId];
  }
  function editUnit(opts) {
    S.unitEdit = { orgId: opts.orgId, orgName: opts.orgName, kitId: opts.kitId, kitLabel: opts.kitLabel || opts.kitId, version: opts.version || 0, content: opts.content || {} };
    S.view = "unit"; show();
  }
  /** Kit history: POST bodies only; results kept in memory for this consult. */
  function histAdd(patientId, kitId, entry) { return api("POST", "hist/add", { patientId: patientId, kitId: kitId, entry: entry }).then(function (r) { HIST[patientId + "|" + kitId] = null; return r; }); }
  function histRead(patientId, kitId) {
    var k = patientId + "|" + kitId;
    if (!HIST[k]) HIST[k] = api("POST", "hist/read", { patientId: patientId, kitId: kitId }).then(function (r) { return r.status === 200 ? r.body.entries : { error: r.body.error }; });
    return HIST[k];
  }
  function forgetSession() { UNIT = {}; HIST = {}; }
  function forgetPatient() { HIST = {}; }   // a new consult: the previous patient's history is dropped
  function compose(opts) { S.compose = { kind: opts.kind, payload: opts.payload || {}, kitId: opts.kitId || "", urgency: opts.urgency || "" }; S.view = "compose"; show(); }
  function newCase(opts) { S.compose = { title: "", summary: (opts && opts.summary) || "", kitId: (opts && opts.kitId) || "" }; S.view = "newcase"; S.tab = "cases"; show(); }
  function openInbox(tab) { S.view = "inbox"; if (tab) S.tab = tab; loadMe(); show(); loadInbox(); }
  function openFromPush(d) {
    if (!flagOn() || !d) return false;
    if (d.caseId) { S.tab = "cases"; show(); openCase(d.caseId); return true; }
    if (d.id) { show(); openMsg(d.id); return true; }
    openInbox(); return true;
  }
  function sendReviews(decisions) { return api("POST", "reviews", { decisions: decisions }); }

  var API = { on: flagOn, openInbox: openInbox, compose: compose, newCase: newCase, unitFor: unitFor, editUnit: editUnit, histAdd: histAdd, histRead: histRead,
    forgetSession: forgetSession, forgetPatient: forgetPatient, openFromPush: openFromPush, sendReviews: sendReviews, close: close, errText: errText, _state: function () { return S; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_SHARE = API;
})(typeof window !== "undefined" ? window : globalThis);
