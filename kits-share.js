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
 *   Contacts    saved colleagues (server-side, filled in by every referral, handover and case room, or
 *               added by ID, email or an invite link https://stewardmd.in/add/SMD-XXXXXX). Refer, hand
 *               over or ask about a case straight from a contact.
 *
 * Flag smd_kits_share, default ON since the owner turned wave 2 on (2026-09-25). Off for this device
 * with localStorage smd_kits_share = "0" or ?share=0 (one load). The server route has its own kill
 * switch, env KITS_SHARE_ON = "0". Nothing here is stored on the phone except the flag; lists
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
      return !(G.localStorage && G.localStorage.getItem("smd_kits_share") === "0");
    } catch (e) { return true; }
  }
  function fmt(ms_) { try { var d = new Date(ms_); return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); } catch (e) { return ""; } }
  var ERR = {
    verify_required: "Only registration-verified doctors can share patient information. Verify your registration first.",
    recipient_not_found: "No StewardMD doctor has that ID. Check it with your colleague.", recipient_not_verified: "That doctor has not verified their registration yet, so patient information cannot be sent to them.",
    cannot_send_to_self: "That is your own StewardMD ID.", rate_limited: "Too many in a short time. Try again in a while.", auth_required: "Sign in to use this.",
    disabled: "Sharing is not switched on yet.", readback_required: "Read the plan back in your own words to acknowledge the handover.", reason_required: "Give the reason for referral or your question.",
    patient_required: "Add the patient's name or age.", rows_required: "Add at least one patient to the handover.", title_and_question_required: "Give the case a title and your question.",
    not_allowed: "You cannot do that here.", owner_only: "Only the doctor who opened the case can do that.", case_closed: "This case is closed.", empty: "Nothing to save yet.",
    changed_retry: "It changed while you were looking. Try again.", too_large: "That is too long to send.", recipient_required: "Enter the StewardMD ID or the email your colleague signs in with."
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
  var S = { view: "inbox", tab: "in", list: null, cases: null, contacts: null, cur: null, compose: null, busy: false, unitEdit: null, me: "", pendingAdd: "" };
  // A colleague picked in Contacts before Documents opens: the next compose goes to them. Expires so a
  // forgotten pick never addresses a later, unrelated referral.
  var PRESET = null;
  function preset() { if (PRESET && Date.now() - PRESET.at > 30 * 60 * 1000) PRESET = null; return PRESET; }
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
  function close() { var el = D && D.getElementById("smdShare"), was = !!(el && el.classList.contains("on")); if (el) el.classList.remove("on"); if (was) refreshBadge(true); S.list = null; S.cases = null; S.contacts = null; S.cur = null; S.compose = null; S.unitEdit = null; S.view = "inbox"; S.pendingAdd = ""; S.sentKind = null; S.caseInv = null; }
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
    else if (S.view === "contact") html = contactHtml();
    // A list that arrives while the doctor is typing (contacts, inbox) re-renders the view: carry over
    // whatever was typed into fields of the same view, and the focus, so nothing is lost mid-word.
    var keep = {}, fid = "", fs = null, ae = D.activeElement;
    if (b.getAttribute("data-view") === S.view) {
      Array.prototype.forEach.call(b.querySelectorAll("input[id],textarea[id]"), function (el) { keep[el.id] = el.type === "checkbox" ? el.checked : el.value; });
      if (ae && ae.id && b.contains(ae)) { fid = ae.id; try { fs = [ae.selectionStart, ae.selectionEnd]; } catch (e) {} }
    }
    b.setAttribute("data-view", S.view);
    b.innerHTML = '<div class="kit dl sh">' + html + "</div>";
    Object.keys(keep).forEach(function (id) { var el = D.getElementById(id); if (!el || !b.contains(el)) return; if (el.type === "checkbox") el.checked = keep[id]; else el.value = keep[id]; });
    if (fid) { var f = D.getElementById(fid); if (f && b.contains(f)) { try { f.focus(); if (fs && fs[0] != null) f.setSelectionRange(fs[0], fs[1]); } catch (e) {} } }
  }
  function back() { return '<button type="button" class="kit-link" data-sh-act="inbox">' + ms("arrow_back") + "Colleagues</button>"; }

  /* inbox */
  function loadInbox() {
    S.list = null; S.cases = null; render();
    api("GET", "msg/list").then(function (r) { S.list = r.status === 200 ? r.body : { error: r.body.error }; render(); });
    api("GET", "case/list").then(function (r) { S.cases = r.status === 200 ? r.body.cases : []; render(); });
    loadContacts();
  }
  function loadContacts() { return api("GET", "contact/list").then(function (r) { S.contacts = r.status === 200 ? r.body.contacts : []; render(); return S.contacts; }); }
  // Your own StewardMD ID, so you can give it to colleagues (minted on first open if you had none).
  function meHtml() {
    var nudge = S.sentKind ? '<div class="sh-nudge"><span>' + ms("check_circle") + (S.sentKind === "referral" ? "Referral" : "Handover") + ' sent.</span><button type="button" class="kit-link" data-sh-act="wa-nudge">' + ms("chat") + "Tell them on WhatsApp</button></div>" : "";
    if (!S.me) return nudge + '<section class="sh-me"><p class="kit-muted">Colleagues can add you with the email you sign in with. Your StewardMD ID appears here once it is ready.</p></section>';
    return nudge + '<section class="sh-me"><div class="sh-me-top"><div class="sh-me-id"><span class="sh-kicker">Your StewardMD ID</span><b>' + esc(S.me) + "</b></div>" +
      '<button type="button" class="sh-icon" data-sh-act="copyid" aria-label="Copy your StewardMD ID">' + ms("content_copy") + "</button></div>" +
      '<p class="kit-muted">Colleagues add you with this ID or your sign-in email.</p>' +
      '<div class="sh-me-acts"><button type="button" class="kit-add" data-sh-act="wa-invite">' + ms("chat") + 'Invite on WhatsApp</button><button type="button" class="kit-clear" data-sh-act="share-id" aria-label="Share your invite link">' + ms("ios_share") + "Share</button></div></section>";
  }
  /* SMD-08 (QA sheet 2026-09-27): reach colleagues through WhatsApp. Only an invite (your ID and the
   * app link) or a nudge ("I sent you a referral, open StewardMD") ever goes to WhatsApp: patient
   * details stay inside StewardMD, because a wa.me link carries its text in the URL and CLAUDE.md
   * forbids PHI in URLs or messages. The invite link https://stewardmd.in/add/<ID> opens the app on
   * "Add this colleague" (Universal Link / App Link), or the store page for someone without it. */
  var APP_LINK = "https://stewardmd.in/";
  function inviteLink() { return APP_LINK + "add/" + encodeURIComponent(S.me); }
  function inviteText() { return "Add me on StewardMD so we can send each other referrals and handovers. My StewardMD ID is " + S.me + ". Tap to add me: " + inviteLink(); }
  function nudgeText(kind) { return "I have sent you a " + (kind === "referral" ? "referral" : "handover") + " on StewardMD. Open the app to see it: " + APP_LINK; }
  function waOpen(text) {
    var u = "https://wa.me/?text=" + encodeURIComponent(text);
    try { var w = G.open(u, "_blank", "noopener"); if (w) return; } catch (e) {}
    try { G.location.href = u; } catch (e) {}
  }
  function shareText(text) {
    var P = G.Capacitor && G.Capacitor.Plugins;
    if (G.SMD_IS_NATIVE && P && P.Share && P.Share.share) { P.Share.share({ title: "StewardMD", text: text, dialogTitle: "Share" }).catch(function () {}); return; }
    if (G.navigator && G.navigator.share) { G.navigator.share({ title: "StewardMD", text: text }).catch(function () {}); return; }
    copyText(text);
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
  function freshCount(rows) { var n = 0; (rows || []).forEach(function (r) { if (r.fresh) n++; }); return n; }
  function counts() { return { "in": S.list && !S.list.error ? freshCount(S.list.inbox) : 0, out: S.list && !S.list.error ? freshCount(S.list.sent) : 0, cases: freshCount(S.cases), contacts: 0 }; }
  /** Unread items for a Home badge: received not yet opened, answers to what you sent, case rooms with news. */
  function unread() {
    return Promise.all([api("GET", "msg/list"), api("GET", "case/list")]).then(function (r) {
      return (r[0].status === 200 ? freshCount(r[0].body.inbox) + freshCount(r[0].body.sent) : 0) + (r[1].status === 200 ? freshCount(r[1].body.cases) : 0);
    });
  }
  function emptyHtml(icon, title, sub, acts) {
    return '<div class="sh-empty">' + '<span class="sh-empty-ic">' + ms(icon) + "</span><b>" + esc(title) + "</b><p>" + esc(sub) + "</p>" + (acts ? '<div class="kit-row">' + acts + "</div>" : "") + "</div>";
  }
  function quickActs() {
    return '<div class="sh-acts">' +
      '<button type="button" data-sh-act="start:referral">' + ms("outgoing_mail") + "<span>Refer a patient</span></button>" +
      '<button type="button" data-sh-act="start:handover">' + ms("swap_horiz") + "<span>Hand over</span></button>" +
      '<button type="button" data-sh-act="newcase">' + ms("forum") + "<span>Ask about a case</span></button></div>";
  }
  function initials(n) { var p = String(n || "").replace(/^(Dr\.?|Prof\.?)\s+/i, "").trim().split(/\s+/); return ((p[0] || "?").charAt(0) + (p[1] ? p[1].charAt(0) : "")).toUpperCase(); }
  function contactSub(c) {
    var bits = [];
    if (c.regNo) bits.push("Reg. No. " + c.regNo);
    else if (c.label) bits.push(c.label);
    if (c.via === "added_you") bits.push("added you");
    return bits.join(", ");
  }
  function contactsHtml() {
    var h = "";
    if (S.pendingAdd) h += '<section class="sh-add-card"><b>Add ' + esc(S.pendingAdd) + ' to your contacts?</b><p class="kit-muted">A colleague shared this StewardMD ID with you. Once added, you can send them referrals and handovers in one tap.</p>' +
      '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="addpending"' + (S.busy ? " disabled" : "") + ">" + ms("person_add") + 'Add colleague</button><button type="button" class="kit-clear" data-sh-act="dropadd">Not now</button></div></section>';
    h += '<div class="sh-addrow"><label class="kit-field wide" for="sh_add"><span class="kit-fl">Add a colleague</span><input id="sh_add" class="kit-inp" autocomplete="off" autocapitalize="characters" placeholder="SMD-XXXXXX or name@hospital.in"></label>' +
      '<button type="button" class="kit-add" data-sh-act="addcontact" aria-label="Add colleague"' + (S.busy ? " disabled" : "") + ">" + ms("person_add") + "Add</button></div>";
    if (!S.contacts) return h + '<p class="kit-muted">Loading…</p>';
    if (!S.contacts.length) return h + emptyHtml("group_add", "No colleagues yet", "Add a colleague by their StewardMD ID, or invite them on WhatsApp. Anyone you send to, or who sends to you, is added here too.", "");
    return h + '<div class="rv-list">' + S.contacts.map(function (c) {
      return '<button type="button" class="rv-row sh-person" data-sh-act="contact:' + esc(c.id) + '"><span class="sh-av" aria-hidden="true">' + esc(initials(c.name)) + '</span><span class="sh-pt"><span class="rv-t">' + esc(c.name || c.label || "Colleague") + '</span><span class="rv-s">' + esc(contactSub(c)) + "</span></span>" + ms("chevron_right") + "</button>";
    }).join("") + "</div>";
  }
  function contactById(id) { return (S.contacts || []).filter(function (c) { return c.id === id; })[0] || null; }
  function contactHtml() {
    var c = contactById(S.cur && S.cur.contactId); if (!c) return back() + '<p class="kit-muted">This colleague is no longer in your contacts.</p>';
    return back() + '<div class="sh-person-head"><span class="sh-av lg" aria-hidden="true">' + esc(initials(c.name)) + '</span><div><h2 class="dl-h">' + esc(c.name || c.label || "Colleague") + '</h2><p class="kit-muted">' + esc([c.regNo ? "Reg. No. " + c.regNo : "", c.label].filter(Boolean).join(", ")) + "</p></div></div>" +
      '<div class="sh-acts">' +
      '<button type="button" data-sh-act="cstart:referral">' + ms("outgoing_mail") + "<span>Refer a patient</span></button>" +
      '<button type="button" data-sh-act="cstart:handover">' + ms("swap_horiz") + "<span>Hand over</span></button>" +
      '<button type="button" data-sh-act="cstart:case">' + ms("forum") + "<span>Ask about a case</span></button></div>" +
      '<p class="kit-muted">Patient details go only inside StewardMD, encrypted, and only once both of you have verified your registration.</p>' +
      '<div class="kit-row"><button type="button" class="kit-clear" data-sh-act="rmcontact">' + ms("person_remove") + "Remove from contacts</button></div>";
  }
  function inboxHtml() {
    var n = counts(), tabs = [["in", "Received"], ["out", "Sent"], ["cases", "Cases"], ["contacts", "Contacts"]];
    var h = meHtml() + quickActs() + '<div class="sh-tabs" role="tablist">' + tabs.map(function (t) {
      var on = S.tab === t[0], k = n[t[0]];
      return '<button type="button" role="tab" class="sh-tab' + (on ? " on" : "") + '" data-sh-act="tab:' + t[0] + '" aria-selected="' + on + '">' + t[1] + (k ? '<span class="sh-badge" aria-label="' + k + ' new">' + k + "</span>" : "") + "</button>";
    }).join("") + "</div>";
    if (S.tab === "contacts") return h + contactsHtml();
    if (S.tab === "cases") {
      if (!S.cases) return h + '<p class="kit-muted">Loading…</p>';
      if (!S.cases.length) return h + emptyHtml("forum", "No case rooms yet", "Ask colleagues from other branches for an opinion, without patient identifiers.", '<button type="button" class="kit-add" data-sh-act="newcase">' + ms("forum") + "Ask about a case</button>");
      return h + '<div class="rv-list">' + S.cases.map(function (c) {
        return '<button type="button" class="rv-row' + (c.fresh ? " fresh" : "") + '" data-sh-act="case:' + esc(c.id) + '"><span class="rv-t">' + (c.fresh ? '<i class="sh-dot" aria-label="New"></i>' : "") + esc(c.title) + '</span><span class="rv-s">' + esc(c.ownerName) + ", " + c.posts + " repl" + (c.posts === 1 ? "y" : "ies") + ", " + esc(fmt(c.updatedAt)) + "</span><span>" + pill(c.status) + "</span></button>";
      }).join("") + "</div>";
    }
    if (!S.list) return h + '<p class="kit-muted">Loading…</p>';
    if (S.list.error) return h + emptyHtml(S.list.error === "auth_required" ? "login" : "cloud_off", S.list.error === "auth_required" ? "Sign in to see referrals and handovers" : "Could not load", errText(S.list.error), '<button type="button" class="kit-clear" data-sh-act="inbox">' + ms("refresh") + "Try again</button>");
    var rows = S.tab === "in" ? S.list.inbox : S.list.sent;
    if (!rows.length) return h + (S.tab === "in"
      ? emptyHtml("inbox", "Nothing received yet", "Referrals and handovers colleagues send you appear here, and you get a notification.", S.me ? '<button type="button" class="kit-clear" data-sh-act="wa-invite">' + ms("chat") + "Invite a colleague</button>" : "")
      : emptyHtml("send", "Nothing sent yet", "Send a referral letter or a shift handover to a colleague. You will see when they read and answer it.", '<button type="button" class="kit-add" data-sh-act="start:referral">' + ms("outgoing_mail") + 'Refer a patient</button><button type="button" class="kit-clear" data-sh-act="start:handover">' + ms("swap_horiz") + "Hand over</button>"));
    return h + '<div class="rv-list">' + rows.map(function (m) {
      var who = S.tab === "in" ? m.fromName + (m.fromRegNo ? " (Reg. No. " + m.fromRegNo + ")" : "") : "To " + (m.toName || m.toLabel);
      return '<button type="button" class="rv-row' + (m.fresh ? " fresh" : "") + '" data-sh-act="msg:' + esc(m.id) + '"><span class="rv-t">' + (m.fresh ? '<i class="sh-dot" aria-label="New"></i>' : "") + (m.kind === "referral" ? "Referral" : "Handover") + (m.urgency && m.urgency !== "Routine" ? ": " + esc(m.urgency) : "") + '</span><span class="rv-s">' + esc(who) + ", " + esc(fmt(m.createdAt)) + "</span><span>" + pill(m.status) + "</span></button>";
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
      '<section class="kit-card">' + what + "</section>" + (c.contact
        ? '<div class="sh-to"><span class="sh-av" aria-hidden="true">' + esc(initials(c.contact.name)) + '</span><div class="sh-pt"><span class="kit-fl">To</span><b>' + esc(c.contact.name || "Colleague") + '</b></div><button type="button" class="kit-link" data-sh-act="tochange">Change</button></div>'
        : field("sh_to", "Colleague's StewardMD ID or email", c.to || "", "text", "SMD-XXXXXX or name@hospital.in") + chipsHtml("topick", null)) +
      (c.kind === "referral" ? '<label class="kit-check"><input type="checkbox" id="sh_consent"' + (c.consent ? " checked" : "") + '><span>The patient agreed to this referral being sent to this doctor.</span></label>' : "") +
      '<div class="kit-row"><button type="button" class="kit-add" data-sh-act="send"' + (S.busy ? " disabled" : "") + ">" + ms("send") + "Send</button></div>";
  }
  /** Your contacts as tap targets: act "topick" fills the recipient, "ctog"/"itog" toggle an invite. */
  function chipsHtml(act, sel) {
    if (!S.contacts || !S.contacts.length) return "";
    return '<div class="sh-chips" aria-label="Your contacts">' + S.contacts.slice(0, 12).map(function (c) {
      var on = sel && sel[c.id];
      return '<button type="button" class="kit-seg sh-chip' + (on ? " on" : "") + '" data-sh-act="' + act + ":" + esc(c.id) + '"' + (sel ? ' aria-pressed="' + !!on + '"' : "") + ">" + (on ? ms("check") : "") + esc(c.name || c.label || "Colleague") + "</button>";
    }).join("") + "</div>";
  }
  function keepCompose() { var c = S.compose; if (!c) return; var t = D.getElementById("sh_to"), k = D.getElementById("sh_consent"); if (t) c.to = t.value; if (k) c.consent = k.checked; }
  function send() {
    var c = S.compose, raw = c.contact ? "" : val("sh_to"), isEmail = EMAIL_RE.test(raw), to = isEmail ? raw.toLowerCase() : raw.toUpperCase();
    if (!c.contact && !isEmail && !/^(SMD-)?[A-Z0-9]{6}$/.test(to)) { toast("Enter the StewardMD ID (like SMD-AB12CD) or the email your colleague signs in with."); return; }
    if (c.kind === "referral" && !(D.getElementById("sh_consent") || {}).checked) { toast("Confirm the patient agreed to the referral."); return; }
    keepCompose(); S.busy = true; render();
    api("POST", "msg/send", { kind: c.kind, to: c.contact ? { contact: c.contact.id } : isEmail ? { email: to } : { smdId: to }, kitId: c.kitId || "", urgency: c.urgency || "", payload: c.payload }).then(function (r) {
      S.busy = false;
      if (r.status === 200) { toast(c.kind === "referral" ? "Referral sent." : "Handover sent. You will see when it is acknowledged."); S.sentKind = c.kind === "referral" ? "referral" : "handover"; S.compose = null; S.view = "inbox"; S.tab = "out"; loadInbox(); }
      else { if (!c.contact) c.to = to; render(); toast(errText(r.body.error)); }
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
      if (k.role === "owner") h += field("sh_inv", "Invite more colleagues (StewardMD IDs or emails, separated by commas)", "", "text", "SMD-AB12CD, name@hospital.in") + chipsHtml("itog", S.caseInv || {}) +
        '<div class="kit-row"><button type="button" class="kit-pill" data-sh-act="invite">' + ms("person_add") + 'Invite</button><button type="button" class="kit-clear" data-sh-act="closecase">Close the case</button></div>';
    }
    return h;
  }
  function keepCase() {
    var c = S.compose; if (!c) return;
    ["sh_title:title", "sh_q:question", "sh_sum:summary", "sh_inv:invText"].forEach(function (p) { var k = p.split(":"), el = D.getElementById(k[0]); if (el) c[k[1]] = el.value; });
  }
  function newCaseHtml() {
    var c = S.compose || {};
    return back() + '<h2 class="dl-h">Ask colleagues about a case</h2><p class="kit-muted">De-identified: no name, hospital number, phone, address or photo. The server removes identifier-like text too. Only the colleagues you invite can read it.</p>' +
      field("sh_title", "Title", c.title || "", "text", "e.g. Recurrent pleural effusion, cytology negative") + field("sh_q", "Your question", c.question || "", "textarea", "What would you like their opinion on?") +
      field("sh_sum", "Summary", c.summary || "", "textarea", "Age, sex, key history, findings and results") +
      (S.contacts && S.contacts.length ? '<span class="kit-fl">Invite from your contacts</span>' + chipsHtml("ctog", c.inv || {}) : "") +
      field("sh_inv", S.contacts && S.contacts.length ? "Or add others (StewardMD IDs or emails, separated by commas)" : "Invite colleagues (StewardMD IDs or emails, separated by commas)", c.invText || "", "text", "SMD-AB12CD, name@hospital.in") +
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
    if (cmd === "inbox") { S.view = "inbox"; S.cur = null; S.caseInv = null; loadInbox(); return; }
    if (cmd === "copyid") { if (S.me) copyText(S.me); return; }
    if (cmd === "start") { startDoc(arg, null); return; }
    if (cmd === "contact") { S.view = "contact"; S.cur = { contactId: arg }; render(); return; }
    if (cmd === "cstart") {
      var pc = contactById(S.cur && S.cur.contactId); if (!pc) return;
      if (arg === "case") { var inv0 = {}; inv0[pc.id] = 1; S.compose = { title: "", summary: "", kitId: "", inv: inv0 }; S.view = "newcase"; render(); return; }
      startDoc(arg, pc); return;
    }
    if (cmd === "addcontact" || cmd === "addpending") {
      var raw = cmd === "addpending" ? S.pendingAdd : val("sh_add"), em = EMAIL_RE.test(raw), who = em ? raw.toLowerCase() : raw.toUpperCase().replace(/\s+/g, "");
      if (!em && !/^(SMD-)?[A-Z0-9]{6}$/.test(who)) { toast(errText("recipient_required")); return; }
      if (!em && who.indexOf("SMD-") !== 0) who = "SMD-" + who;
      S.busy = true; render();
      api("POST", "contact/add", { to: em ? { email: who } : { smdId: who } }).then(function (r) {
        S.busy = false;
        if (r.status === 200) {
          var nm = r.body.contact.name || who; S.pendingAdd = "";
          toast((r.body.already ? nm + " is already in your contacts." : nm + " added.") + (r.body.contact.verified ? "" : " They have not verified their registration yet, so patient details can be sent once they do."));
          var inp = D.getElementById("sh_add"); if (inp) inp.value = "";
          loadContacts();
        } else { render(); toast(errText(r.body.error)); }
      });
      return;
    }
    if (cmd === "dropadd") { S.pendingAdd = ""; render(); return; }
    if (cmd === "rmcontact") {
      var rc = contactById(S.cur && S.cur.contactId); if (!rc) return;
      api("POST", "contact/remove", { id: rc.id }).then(function (r) { if (r.status === 200) { toast((rc.name || "Colleague") + " removed from your contacts."); S.view = "inbox"; S.tab = "contacts"; S.cur = null; loadContacts(); } else toast(errText(r.body.error)); });
      return;
    }
    if (cmd === "topick") { var tc = contactById(arg); if (tc && S.compose) { keepCompose(); S.compose.contact = { id: tc.id, name: tc.name || tc.label }; render(); } return; }
    if (cmd === "tochange") { if (S.compose) { keepCompose(); S.compose.contact = null; render(); } return; }
    if (cmd === "ctog") { keepCase(); var cc = S.compose = S.compose || {}; cc.inv = cc.inv || {}; if (cc.inv[arg]) delete cc.inv[arg]; else cc.inv[arg] = 1; render(); return; }
    if (cmd === "itog") { var iv = D.getElementById("sh_inv"), keep = iv ? iv.value : ""; S.caseInv = S.caseInv || {}; if (S.caseInv[arg]) delete S.caseInv[arg]; else S.caseInv[arg] = 1; render(); iv = D.getElementById("sh_inv"); if (iv) iv.value = keep; return; }
    if (cmd === "wa-invite") { if (S.me) waOpen(inviteText()); return; }
    if (cmd === "share-id") { if (S.me) shareText(inviteText()); return; }
    if (cmd === "wa-nudge") { waOpen(nudgeText(S.sentKind)); S.sentKind = null; render(); return; }
    if (cmd === "tab") { S.tab = arg; render(); return; }
    if (cmd === "msg") { openMsg(arg); return; }
    if (cmd === "case") { openCase(arg); return; }
    if (cmd === "newcase") { S.view = "newcase"; S.compose = S.compose || {}; if (!S.contacts) loadContacts(); render(); return; }
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
      var ivc = Object.keys(S.caseInv || {}), ivs = ids(val("sh_inv")); if (!ivc.length && !ivs.length) { toast("Pick a contact or enter a StewardMD ID or email."); return; }
      api("POST", "case/invite", { id: S.cur.case.id, smdIds: ivs, contacts: ivc }).then(function (r) { if (r.status === 200) { S.caseInv = null; toast(r.body.invited + " invited." + notFoundText(r.body.notFound)); openCase(S.cur.case.id); } else toast(errText(r.body.error)); });
      return;
    }
    if (cmd === "closecase") { api("POST", "case/close", { id: S.cur.case.id }).then(function (r) { if (r.status === 200) openCase(S.cur.case.id); else toast(errText(r.body.error)); }); return; }
    if (cmd === "createcase") {
      // Read every field BEFORE render(): render rebuilds the form.
      var c = S.compose || {}, req = { title: val("sh_title"), question: val("sh_q"), summary: val("sh_sum"), kitId: c.kitId || "", invite: ids(val("sh_inv")), inviteContacts: Object.keys(c.inv || {}) };
      keepCase(); S.busy = true; render();
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
  function compose(opts) {
    var p = preset(); PRESET = null;
    S.compose = { kind: opts.kind, payload: opts.payload || {}, kitId: opts.kitId || "", urgency: opts.urgency || "", contact: p ? { id: p.id, name: p.name } : null };
    S.view = "compose"; show(); if (!S.contacts) loadContacts();
  }
  /** Leave Colleagues for Documents with the colleague (if any) remembered for the Send step. */
  function startDoc(kind, contact) {
    PRESET = contact ? { id: contact.id, name: contact.name || contact.label || "your colleague", at: Date.now() } : null;
    close();
    if (G.SMD_DOCS && G.SMD_DOCS.open) G.SMD_DOCS.open({ type: kind === "handover" ? "handover" : "referral" }); else toast("Documents is loading. Try again in a moment.");
  }
  /** Name of the colleague the next Send goes to, for the Documents button label ("Send to Dr Bala"). */
  function presetName() { var p = preset(); return p ? p.name : ""; }
  function clearPreset() { PRESET = null; }   // Documents closed without sending: forget the colleague
  function newCase(opts) { S.compose = { title: "", summary: (opts && opts.summary) || "", kitId: (opts && opts.kitId) || "" }; S.view = "newcase"; S.tab = "cases"; show(); if (!S.contacts) loadContacts(); }
  function openInbox(tab) { S.view = "inbox"; if (tab) S.tab = tab; loadMe(); show(); loadInbox(); }
  /** An invite link (https://stewardmd.in/add/SMD-XXXXXX) opened the app: offer to add that colleague. */
  function openAdd(smdId) {
    var id = String(smdId || "").toUpperCase().replace(/\s+/g, ""); if (id && id.indexOf("SMD-") !== 0) id = "SMD-" + id;
    if (!flagOn() || !/^SMD-[A-Z0-9]{6}$/.test(id)) return false;
    S.pendingAdd = id; S.view = "inbox"; S.tab = "contacts"; loadMe(); show(); loadInbox(); return true;
  }
  function openFromPush(d) {
    if (!flagOn() || !d) return false;
    if (d.contacts) { openInbox("contacts"); return true; }
    if (d.caseId) { S.tab = "cases"; show(); openCase(d.caseId); return true; }
    if (d.id) { show(); openMsg(d.id); return true; }
    openInbox(); return true;
  }
  function sendReviews(decisions) { return api("POST", "reviews", { decisions: decisions }); }

  /* Home badge: the Colleagues tile shows how many items are new (unread received, answers to what you
   * sent, case rooms with replies). Refreshed on launch, on return to the foreground and when the sheet
   * closes; at most once a minute, and never without a signed-in token (api() answers 401 locally). */
  var lastBadge = 0;
  function paintBadge(n) {
    var tiles = D && D.querySelectorAll ? D.querySelectorAll('[data-act="kxinbox"]') : [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], b = t.querySelector(".sh-home-badge");
      if (!n) { if (b) b.parentNode.removeChild(b); t.setAttribute("aria-label", "Colleagues"); continue; }
      if (!b) {
        b = D.createElement("span"); b.className = "sh-home-badge"; b.setAttribute("aria-hidden", "true");
        b.style.cssText = "position:absolute;top:6px;right:6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#ba1a1a;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;pointer-events:none;z-index:1";
        try { if (G.getComputedStyle(t).position === "static") t.style.position = "relative"; } catch (e) {}
        t.appendChild(b);
      }
      b.textContent = n > 99 ? "99+" : String(n);
      t.setAttribute("aria-label", "Colleagues, " + n + " new");
    }
  }
  function refreshBadge(force) {
    if (!flagOn() || (!force && Date.now() - lastBadge < 60000)) return;
    lastBadge = Date.now();
    unread().then(paintBadge, function () {});
  }
  if (D && D.addEventListener && !G.__smdShareBadge) {
    G.__smdShareBadge = true;
    D.addEventListener("visibilitychange", function () { if (D.visibilityState === "visible") refreshBadge(false); });
    setTimeout(function () { refreshBadge(true); }, 4000);
  }

  var API = { on: flagOn, openInbox: openInbox, openAdd: openAdd, presetName: presetName, clearPreset: clearPreset, unread: unread, compose: compose, newCase: newCase, unitFor: unitFor, editUnit: editUnit, histAdd: histAdd, histRead: histRead,
    forgetSession: forgetSession, forgetPatient: forgetPatient, openFromPush: openFromPush, sendReviews: sendReviews, close: close, errText: errText, _state: function () { return S; } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_SHARE = API;
})(typeof window !== "undefined" ? window : globalThis);
