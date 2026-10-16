/* PrepNucleus "Create a module with MaiK" (students) and the owner's Author screen. window.PREP_QGEN. ES5.
   Loaded by prep-loader.js after prep-create.js (optional). Draws through PREP._host; prep.js forwards every data-act
   starting "g-" here. Server: POST /api/ai/prep-qgen (functions/api/ai/_prep-qgen.js, engine functions/_prep-qgen.js).
   Vault: PrepNucleus.md "MaiK modules (qgen)".

   Visibility: the entry rows (Tests > QBank, Menu) show only when the server's status says the feature is on for this
   account (status.on and status.student, or status.owner for the Author row). localStorage smd_prep_qgen = "0" (or
   ?qgen=0) hides both on this phone.

   A student's module is a PRIVATE deck (prep-decks.js): manifest source.type "maik", items in the app's schema with
   qg { g: grounded 1|0, v: "ok", u: 1 when not from the student's own notes }. So it opens like every deck (the mode
   sheet with Learning or Test Mode and the timer), works offline once made, is mirrored to the app's files and backed
   up encrypted to the account with the other decks. It never enters the shared bank and has no share IDs. The manifest
   keeps the page range a PDF module was made from, and the grounding text is backed up with the deck, so more
   questions stay grounded after a restore. A module is
   made 5 questions a request (generate, code gates, an independent check that solves each question blind); what passes
   is saved after every request, so stopping or losing the connection keeps what was made. A round that fails is tried
   once more after a few seconds with the same idempotency key (the server replays instead of remaking); when the app
   was locked or the network dropped, the rest goes on by itself once the app is back or the network returns.

   Owner (server ownerOK, never a client list): Author screen = pick exam, subject, module (or a new name), paste or
   choose a source, count; up to 10 runs here (flagged items kept for review), more goes to the Batch API (half price,
   polled here). Review: approve, edit, drop each item, approve all unflagged; "Stage for publishing" stores the
   reviewed set on the server and shows the one command that publishes it (tools/prep-qgen.mjs publish). The app never
   publishes to the shared bank itself (immutable caches, overlay registration and the Share ID index need the tool). */
(function (G) {
  "use strict";

  /* ================= pure ================= */
  var PER = 5, COUNTS = [10, 20, 30], PAGE_CAP = 60, GROUND_MAX = 60000, OWNER_GROUND_MAX = 200000, EXTRA_ROUNDS = 2;
  var EXAMS = [["neet-pg", "NEET-PG"], ["ini-cet", "INI-CET"], ["neet-ss", "NEET-SS"], ["usmle", "USMLE"]];
  var DIFFS = [["mix", "Exam mix"], ["easy", "Easy"], ["moderate", "Moderate"], ["hard", "Hard"]];
  var MT_ROUND = 6000;   // MaiK Tokens a round (generate + check, 5 questions), from the first live rounds (Rs 2.6 to 3.1)
  var QRETRY_MS = 3000;    // one retry of a failed round after this long, same round and key; then it waits for resume
  // What the server's refusals mean, in the app's words.
  var MSG = {
    "sign-in": "Sign in to create a module with MaiK.",
    "not-configured": "Creating modules with MaiK is not switched on yet.",
    "off": "Creating modules with MaiK is not available right now.",
    "daily-modules": "You have created today's free modules. Make more tomorrow.",
    "module-full": "This module has all its questions.",
    "budget": "MaiK modules have reached today's limit for everyone. Try again tomorrow.",
    "ai-cost-cap": "You have used today's free MaiK Tokens. Add MaiK Tokens to keep creating modules.",
    "rate": "Too fast. Wait a few seconds and try again.",
    "circuit-breaker": "MaiK modules are paused for a short while. Try again later.",
    "device-cap": "This phone has used MaiK a lot today. Try again after midnight.",
    "busy": "MaiK is busy right now. Try again in a minute.",
    "ai-timeout": "MaiK took too long. Try again.",
    "ai-failed": "MaiK could not write questions this time. Try again.",
    "offline": "You are offline. Connect and try again.",
    "too-large": "The notes are too long. Use a shorter part, up to about 25 pages of text.",
    "bad-input": "Something in the request was not accepted. Check the topic and notes and try again."
  };
  /* online: navigator.onLine read at the moment of the failure. "offline" only when the phone says so right then;
     a failure with the network up (a lock suspending the request, a dropped response) is ai-failed, still retryable. */
  function codeOf(status, j, online) {
    if (!status) return online === true ? "ai-failed" : "offline";
    var r = j && j.reason, e = j && j.error;
    if (status === 401) return "sign-in";
    if (status === 429) return MSG[r] ? r : "rate";
    if (status === 503) return e === "not-configured" ? "not-configured" : "busy";
    if (status === 403) return "off";
    if (status === 504) return "ai-timeout";
    if (status === 413) return "too-large";
    if (status === 400) return "bad-input";
    return "ai-failed";
  }
  function msgOf(code) { return MSG[code] || MSG["ai-failed"]; }
  // Retryable here: a later try can work without the student changing anything.
  function retryable(code) { return ["offline", "busy", "ai-timeout", "ai-failed", "rate", "circuit-breaker"].indexOf(code) >= 0; }
  /* nextN(target, made, rounds): how many to ask for next (0 = stop). A few rounds beyond target / 5 make up for
     questions the checks dropped. */
  function nextN(target, made, rounds) {
    if (made >= target) return 0;
    if (rounds >= Math.ceil(target / PER) + EXTRA_ROUNDS) return 0;
    return Math.min(PER, target - made);
  }
  function diffOf(id) { for (var i = 0; i < DIFFS.length; i++) if (DIFFS[i][0] === id) return DIFFS[i]; return DIFFS[0]; }
  function examLabel(id) { for (var i = 0; i < EXAMS.length; i++) if (EXAMS[i][0] === id) return EXAMS[i][1]; return "NEET-PG"; }
  // The app's exam tab -> the exam profile a module is written for (FMGE uses NEET-PG's, like Make a deck).
  function examFor(tab) { return EXAMS.some(function (x) { return x[0] === tab; }) ? tab : "neet-pg"; }
  /* avoid(items): the stems already in the module, newest last (the server keeps the last 60). */
  function avoidOf(items) { return (items || []).map(function (it) { return String(it.q || "").slice(0, 400); }).filter(Boolean).slice(-60); }
  function fmtN(n) { try { return Number(n).toLocaleString("en-IN"); } catch (e) { return String(n); } }
  function leftLine(st) {
    if (!st || !st.caps) return "";
    if (st.owner) return "Owner: no daily limit";
    var n = st.left == null ? st.caps.modulesPerDay : st.left;
    return n + " of " + st.caps.modulesPerDay + " free " + (st.caps.modulesPerDay === 1 ? "module" : "modules") + " left today";
  }
  // A review item's state for the owner: "ok" approved, "drop", or "" (not decided). Flagged items start undecided.
  function bulkApprove(list) { var n = 0; (list || []).forEach(function (r) { if (!r.st && r.it.qg && r.it.qg.v === "ok") { r.st = "ok"; n++; } }); return n; }
  function approved(list) { return (list || []).filter(function (r) { return r.st === "ok"; }).map(function (r) { return r.it; }); }
  var WHY = { disagree: "The checker chose a different answer", "multiple-best": "More than one option may be right", "factual-doubt": "A fact may be wrong", outdated: "May be outdated", "not-in-source": "Not supported by the source", "no-verdict": "Not checked" };

  var PURE = { nextN: nextN, codeOf: codeOf, msgOf: msgOf, retryable: retryable, avoidOf: avoidOf, leftLine: leftLine, bulkApprove: bulkApprove, approved: approved, examFor: examFor, PER: PER, COUNTS: COUNTS, MSG: MSG, WHY: WHY, QRETRY_MS: QRETRY_MS };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = PURE; return; }

  /* ================= state ================= */
  var LS_FLAG = "smd_prep_qgen", LS_AUTHOR = "smd_prep_qgen_author", LS_PAGES = "smd_prep_qgen_pages";
  var status = null, statusAt = 0, statusP = null;
  var cs = { kind: "topic", topic: "", text: "", count: 10, diff: "mix", exam: "neet-pg", pdf: null, spec: "", busy: "", err: "", own: false,
    pgFrom: "", pgTo: "", adv: false, outline: null, olBusy: false, prev: null };
  /* Per-PDF history in local storage: { "<name>|<bytes>": { windows: [[from, to]], last: { from, to } } }. Only page
     numbers are kept, never file contents. */
  function readHist() { try { return JSON.parse(G.localStorage.getItem(LS_PAGES) || "{}") || {}; } catch (e) { return {}; } }
  function histFor(key) { var h = readHist(); return (key && h[key]) || { windows: [], last: null }; }
  function markDone(key, from, to) {
    if (!key || !(from >= 1) || !(to >= from)) return;
    try {
      var h = readHist(), e = h[key] || { windows: [], last: null }, seen = false;
      e.windows.forEach(function (w) { if (w[0] === from && w[1] === to) seen = true; });
      if (!seen) e.windows.push([from, to]);
      e.windows.sort(function (a, b) { return a[0] - b[0]; });
      e.last = { from: from, to: to };
      h[key] = e;
      G.localStorage.setItem(LS_PAGES, JSON.stringify(h));
    } catch (e2) {}
  }
  var job = null;          // the module being made
  var au = null;           // the owner's Author draft
  var pdfUi = "#qgCreateView";   // the screen the shared PDF picker is on: Create a module, or the owner's Author
  function DK() { return G.PREP_DECKS; }
  function SR() { return G.PREP_SRC; }
  function flagOn() {
    if (G.SMD_PREP_QGEN === false) return false;   // suites that assert "no request to /api/ai" turn it off
    try { var q = (G.location.search.match(/[?&]qgen=([^&]+)/) || [])[1]; if (q != null) return q !== "0"; return G.localStorage.getItem(LS_FLAG) !== "0"; } catch (e) { return true; }
  }
  function user() { var a = G.SMD_AUTH; return a && a.currentUser ? a.currentUser : null; }
  function token() { var u = user(); return u && u.getIdToken ? Promise.resolve(u.getIdToken()).then(null, function () { return null; }) : Promise.resolve(null); }
  function apiUrl() { return (G.SMD_API_BASE || "") + (G.SMD_PREP_QGEN_API || "/api/ai/prep-qgen"); }
  /* call(body, ms) -> Promise({ status, json, abort? }); status 0 = no connection, cut off, or timed out (abort set
     when our own wait ran out, so the loop can say "took too long" instead of "offline"). */
  function call(body, ms) {
    return token().then(function (tok) {
      var h = { "Content-Type": "application/json" };
      if (tok) h.Authorization = "Bearer " + tok;
      var ac = G.AbortController ? new G.AbortController() : null, t = ac ? G.setTimeout(function () { ac.abort(); }, ms || 125000) : null;
      return G.fetch(apiUrl(), { method: "POST", headers: h, body: JSON.stringify(body), signal: ac ? ac.signal : undefined }).then(function (r) {
        if (t) G.clearTimeout(t);
        return r.json().then(function (j) { return { status: r.status, json: j }; }, function () { return { status: r.status, json: {} }; });
      }, function (e) { if (t) G.clearTimeout(t); return { status: 0, abort: !!(e && e.name === "AbortError"), json: {} }; });
    });
  }
  /* navigator.onLine read fresh at the moment of a failure, never a stored flag (a lock suspends the request while the
     phone still reports online). true, false, or undefined when the phone says nothing. */
  function onlineNow() { try { return G.navigator && G.navigator.onLine; } catch (e) { return undefined; } }
  function refresh(host, force) {
    // Only a signed-in account can create, so a guest never asks (and the rows stay hidden until sign-in).
    if (!flagOn() || !user()) return Promise.resolve(null);
    if (!force && status && Date.now() - statusAt < 300000) return Promise.resolve(status);
    if (statusP) return statusP;
    statusP = call({ op: "status" }, 15000).then(function (r) {
      statusP = null;
      if (r.status !== 200 || !r.json || typeof r.json.on !== "boolean") return status;
      var was = JSON.stringify(status);
      status = r.json; statusAt = Date.now();
      // The rows appear without a reload: repaint the Tests or Menu screen when what it shows changed.
      if (host && was !== JSON.stringify(status)) { var top = host.stackTop && host.stackTop(); if (top && (top === host.screens.mocks || top === host.screens.menu)) host.rerender(); }
      return status;
    });
    return statusP;
  }
  function canCreate() { return flagOn() && !!status && !!status.on && !!(status.student || status.owner); }
  function isOwner() { return flagOn() && !!status && !!status.on && !!status.owner; }
  function sub() { var l = leftLine(status); return "Your own private module from a topic or your notes" + (l && !(status && status.owner) ? " · " + l : ""); }
  function onTop(sel, host) { var r = host.root(); return !!(r && r.querySelector(sel)); }
  function idem() { var b = new Uint8Array(12); try { G.crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 12; i++) b[i] = Math.floor(Math.random() * 256); } var s = ""; for (var j = 0; j < b.length; j++) s += ("0" + b[j].toString(16)).slice(-2); return "qg" + s; }
  function newMod() { return "gen_" + DK().sha12("maik:" + Date.now() + ":" + Math.random() + ":" + cs.topic); }
  function chip(act, v, label, on) { return '<button type="button" class="pn-chip' + (on ? " on" : "") + '" aria-pressed="' + !!on + '" data-act="' + act + '" data-v="' + v + '">' + label + "</button>"; }
  function seg(label, id, html) { return '<p class="pc-lbl" id="' + id + '">' + label + '</p><div class="pn-wrap pc-seg" role="group" aria-labelledby="' + id + '">' + html + "</div>"; }
  function ON(el, ev, fn) { if (el && !el["_qg" + ev]) { el["_qg" + ev] = 1; el.addEventListener(ev, fn); } }

  /* ================= student: create ================= */
  function openCreate(host) {
    cs.err = ""; cs.busy = "";
    if (!cs.exam || cs.exam === "neet-pg") cs.exam = examFor(host.exam().id);
    refresh(host, true);
    host.push(function () { renderCreate(host); });
  }
  function pdfPicker(host, esc) {
    var busy = cs.busy || (au && pdfUi === "#qgAuthView" && au.busy);
    return '<button type="button" class="pc-drop" data-act="g-pick"' + (busy ? " disabled" : "") + '><span class="pn-ic sm" style="--h:174" aria-hidden="true">' + host.ico("dl") + "</span><span><b>" + (cs.pdf ? esc(cs.pdf.name) : "Choose a PDF") + "</b><small>" + (cs.pdf ? fmtN(cs.pdf.pages) + " pages" : "A chapter or your notes, up to " + PAGE_CAP + " pages") + "</small></span></button>" +
      '<input type="file" id="qgFile" accept="application/pdf,.pdf" hidden aria-hidden="true" tabindex="-1">' +
      (cs.pdf ? pagesBlock(host, esc) : "");
  }
  function renderCreate(host) {
    pdfUi = "#qgCreateView";
    var esc = host.esc, st = status || {}, ll = leftLine(st), out = !st.owner && st.caps && st.left === 0;
    var srcHtml;
    if (cs.kind === "topic") srcHtml = "";
    else if (cs.kind === "notes") srcHtml = '<label class="pc-lbl" for="qgText">Your notes</label><textarea id="qgText" name="notes" class="pc-in pc-ta" rows="8" placeholder="Paste a chapter or your notes. Questions will come only from this text…">' + esc(cs.text) + "</textarea>" +
      '<p class="pn-mut pn-small" id="qgChars">' + fmtN(cs.text.length) + " of " + fmtN(GROUND_MAX) + " characters</p>";
    else srcHtml = pdfPicker(host, esc);
    var grounded = cs.kind !== "topic";
    host.paint(host.bar("Create a module", "With MaiK", "back") + '<div class="pn-body qg-create" id="qgCreateView">' +
      (out ? '<section class="pn-panel qg-limit" role="status"><p class="qg-limh">Today\'s free modules are used</p><p class="pn-mut">You can create ' + st.caps.modulesPerDay + " modules with MaiK a day. Come back tomorrow, or practise the modules you made in Your decks.</p></section>" : "") +
      seg("Make it from", "qgSrcL", chip("g-src", "topic", "A topic", cs.kind === "topic") + chip("g-src", "notes", "My notes", cs.kind === "notes") + chip("g-src", "pdf", "A PDF", cs.kind === "pdf")) +
      '<label class="pc-lbl" for="qgTopic">' + (grounded ? "Module name" : "Topic") + '</label><input id="qgTopic" name="topic" class="pc-in" maxlength="120" autocomplete="off" enterkeyhint="done" placeholder="' + (grounded ? "For example: Thyroid cancer notes…" : "For example: Diabetic ketoacidosis…") + '" value="' + esc(cs.topic) + '">' +
      srcHtml +
      '<p class="pn-mut pn-small qg-src-note">' + (grounded ? "Questions come only from your text and are checked against it." : "MaiK writes from standard textbook knowledge. These questions are not from the PrepNucleus library, so they are marked as such.") + "</p>" +
      seg("Questions", "qgNL", COUNTS.map(function (n) { return chip("g-count", n, String(n), cs.count === n); }).join("")) +
      seg("Difficulty", "qgDL", DIFFS.map(function (d) { return chip("g-diff", d[0], d[1], cs.diff === d[0]); }).join("")) +
      seg("Exam", "qgEL", EXAMS.map(function (x) { return chip("g-exam", x[0], x[1], cs.exam === x[0]); }).join("")) +
      (grounded ? '<button type="button" class="pc-check" data-act="g-own" aria-pressed="' + cs.own + '"><span class="pc-box" aria-hidden="true">' + (cs.own ? host.ico("check") : "") + "</span><span>These are my own notes, or material I am allowed to use for study.</span></button>" : "") +
      (cs.busy ? '<section class="pn-panel pc-readp" role="status" aria-live="polite"><span class="pc-spin" aria-hidden="true"></span><p class="pn-load">' + esc(cs.busy) + "</p></section>" : "") +
      (cs.err ? '<p class="pn-err" role="alert" id="qgErr" tabindex="-1">' + esc(cs.err) + "</p>" : "") +
      '<div class="qg-foot"><button type="button" class="pn-btn pri" data-act="g-go"' + (cs.busy || out || (cs.kind === "pdf" && cs.pdf && !winNow().sel) ? " disabled" : "") + ">" + (out ? "Back tomorrow" : goLabel()) + "</button>" +
      '<p class="pn-mut pn-small" id="qgLeft">' + esc(ll ? ll + ". " : "") + "Uses about " + fmtN(MT_ROUND * Math.ceil(cs.count / PER)) + " MaiK Tokens.</p></div>" +
      '<p class="pn-mut pn-small qg-safe">MaiK writes practice questions for revision, and a second check answers each one before it is saved. Mistakes are still possible: these are not official exam questions, and clinical decisions need current guidance. Your module stays private to you.</p>' +
      "</div>", cs.err ? "#qgErr" : null);
    var r = host.root();
    if (!r) return;
    var ti = r.querySelector("#qgTopic"), ta = r.querySelector("#qgText");
    ON(ti, "input", function () { cs.topic = ti.value; });
    ON(ta, "input", function () { cs.text = ta.value; var c = r.querySelector("#qgChars"); if (c) c.textContent = fmtN(cs.text.length) + " of " + fmtN(GROUND_MAX) + " characters"; });
    bindPdf(host, r);
    queuePrev(host);
  }
  function bindPdf(host, r) {
    var fi = r.querySelector("#qgFile"), fr = r.querySelector("#qgFrom"), to = r.querySelector("#qgTo"), av = r.querySelector("#qgAdv"), ch = r.querySelector("#qgChap");
    var fromTo = function () {
      cs.pgFrom = fr.value; cs.pgTo = to.value;
      var w = winNow();
      if (w.sel) cs.spec = SR().windowSpec(w.from, w.to);
      paintWindow(host);
      queuePrev(host);
    };
    ON(fr, "input", fromTo);
    ON(to, "input", fromTo);
    ON(av, "input", function () { cs.spec = av.value; paintWindow(host); queuePrev(host); });
    ON(ch, "change", function () {
      var c = cs.outline && cs.outline[+ch.value];
      if (!c) return;
      applyWindow(host, c.page, Math.min(cs.pdf.pages, c.page + PAGE_CAP - 1));
    });
    ON(fi, "change", function () { if (fi.files && fi.files[0]) pickPdf(fi.files[0], host); });
  }
  function createErr(host, m) { cs.err = m; cs.busy = ""; if (pdfUi === "#qgAuthView") au.err = m; if (onTop(pdfUi, host)) host.rerender(); }
  /* ---------- the page selector (owner 2026-10-15): From/To digits fields, not a typed range ----------
     The iOS number pad has no hyphen or comma, so a single "Pages" box cannot take a range. Two number fields work
     with that pad; the typed multi-range box ("752-780, 800-830") sits behind an Advanced toggle with a full
     keyboard. A valid window is mirrored into cs.spec ("752-811"), so the module request is byte-for-byte the same
     as before and the server needs no change. */
  // The current choice: { sel, from, to, count, multi? } or { error, fix?, swap? }.
  function winNow() {
    var S = SR();
    if (!S || !cs.pdf) return { error: "" };
    if (cs.adv) {
      var r = S.selFromSpec(cs.spec, cs.pdf.pages, PAGE_CAP);
      if (r.error) return { error: r.error };
      return { sel: r.sel, from: r.sel[0], to: r.sel[r.sel.length - 1], count: r.sel.length,
        multi: (r.sel[r.sel.length - 1] - r.sel[0] + 1) !== r.sel.length };
    }
    var w = S.clampWindow(cs.pgFrom, cs.pgTo, cs.pdf.pages, PAGE_CAP);
    if (w.error) return w;
    return { sel: w.sel, from: w.from, to: w.to, count: w.count, multi: false };
  }
  function goLabel() {
    if (cs.kind !== "pdf" || !cs.pdf) return "Create " + cs.count + " questions";
    var w = winNow();
    if (!w.sel) return "Create " + cs.count + " questions";
    if (w.multi) return "Create module from " + w.count + " pages";
    // No "pages N" here: the on-screen book scrubber (emoji-icons.js PAGE_RE, owner anti-citation rule) removes
    // "pages 752" style locators from rendered text, so the window reads as bare numbers ("of total" survives).
    return "Create module from " + w.from + " to " + w.to;
  }
  function fitLine(esc, sel) {
    if (!sel || !sel.length) return "";
    var fit = SR().fitBytes(sel, cs.pdf.bytes || 0, cs.pdf.pages || 0);
    return fit.cut ? '<p class="pn-mut pn-small">' + esc(SR().fitMsg(fit.sel)) + "</p>" : "";
  }
  function doneBlock(esc) {
    var S = SR(), total = cs.pdf.pages, h = histFor(S.pdfHistKey(cs.pdf.name, cs.pdf.bytes));
    if (!h.windows.length) return "";
    var chips = h.windows.map(function (w) { return '<span class="qg-done" aria-label="' + w[0] + " to " + w[1] + " of " + total + ' done">' + w[0] + "-" + w[1] + " of " + total + " done</span>"; }).join("");
    var all = [];
    h.windows.forEach(function (w) { for (var p = w[0]; p <= w[1]; p++) all.push(p); });
    (winNow().sel || []).forEach(function (p) { if (all.indexOf(p) < 0) all.push(p); });
    var nx = S.nextWindow(all, total, PAGE_CAP);
    var next = nx ? '<button type="button" class="pn-chip" data-act="g-next">Make the next module: ' + nx.from + " to " + nx.to + "</button>"
      : '<p class="pn-mut pn-small">That is the whole book.</p>';
    return '<div class="qg-donewrap">' + chips + "</div>" + next;
  }
  function chapBlock(esc, total) {
    if (!cs.outline || !cs.outline.length) return cs.olBusy ? '<p class="pn-mut pn-small">Reading the chapters…</p>' : "";
    var opts = cs.outline.map(function (c, i) { return '<option value="' + i + '">' + esc(c.title) + " · " + c.page + " of " + total + "</option>"; }).join("");
    return '<label class="pc-lbl" for="qgChap">Jump to chapter</label><select id="qgChap" class="pc-in"><option value="">Pick a chapter…</option>' + opts + "</select>";
  }
  function pagesBlock(host, esc) {
    var w = winNow(), total = cs.pdf.pages;
    var fields = cs.adv
      ? '<label class="pc-lbl" for="qgAdv">Pages (advanced)</label><input id="qgAdv" name="pages" class="pc-in" inputmode="text" spellcheck="false" autocomplete="off" enterkeyhint="done" placeholder="752-780, 800-830" value="' + esc(cs.spec) + '">'
      : '<div class="qg-pgrow"><div><label class="pc-lbl" for="qgFrom">From page</label><input id="qgFrom" name="from" class="pc-in" inputmode="numeric" pattern="[0-9]*" spellcheck="false" autocomplete="off" enterkeyhint="next" placeholder="752" value="' + esc(cs.pgFrom) + '"></div>' +
        '<div><label class="pc-lbl" for="qgTo">To page</label><input id="qgTo" name="to" class="pc-in" inputmode="numeric" pattern="[0-9]*" spellcheck="false" autocomplete="off" enterkeyhint="done" placeholder="811" value="' + esc(cs.pgTo) + '"></div></div>';
    var fix = "";
    if (w.fix) fix = '<button type="button" class="pn-chip" data-act="g-fix">Use ' + w.fix.from + " to " + w.fix.to + "</button>";
    else if (w.swap) fix = '<button type="button" class="pn-chip" data-act="g-swap">Swap to ' + w.swap.from + "-" + w.swap.to + "</button>";
    return '<p class="pc-lbl" id="qgPgL">Pages</p><div class="qg-pg" role="group" aria-labelledby="qgPgL">' +
      '<p class="pn-mut pn-small">Pick up to ' + PAGE_CAP + " pages. Make another module for the next part.</p>" +
      doneBlock(esc) +
      fields +
      '<p class="qg-count" id="qgCount" role="status" aria-live="polite">' + (w.sel ? "<b>" + w.count + "</b> of " + PAGE_CAP + " pages selected" : "0 of " + PAGE_CAP + " pages selected") + "</p>" +
      (w.error ? '<p class="pn-err qg-pgerr" id="qgPgMsg" role="alert">' + esc(w.error) + "</p>" : '<p class="pc-lbl qg-pgok" id="qgPgMsg">' + (w.sel ? w.from + " to " + w.to + " of " + total : "") + "</p>") +
      (fix ? '<div class="pn-wrap" id="qgFixWrap">' + fix + "</div>" : "") +
      fitLine(esc, w.sel) +
      (cs.adv ? "" : '<div class="qg-step" role="group" aria-label="Move the window"><button type="button" class="pn-chip" data-act="g-step" data-v="-10" aria-label="Back 10 pages">- 10</button><button type="button" class="pn-chip" data-act="g-step" data-v="10" aria-label="Forward 10 pages">+ 10</button><button type="button" class="pn-chip" data-act="g-step" data-v="60">Next 60</button></div>') +
      chapBlock(esc, total) +
      '<div id="qgPrev">' + (cs.prev && cs.prev.html ? cs.prev.html : "") + "</div>" +
      '<button type="button" class="pn-chip qg-adv" data-act="g-adv" aria-pressed="' + cs.adv + '">' + (cs.adv ? "Hide advanced" : "Advanced: several ranges") + "</button>" +
      "</div>";
  }
  /* Refresh the counter, the message, the fix button and the Create label after a keystroke, without a repaint
     (a repaint would drop the keyboard focus). Structural changes still rerender. */
  function paintWindow(host) {
    var r = host.root(), esc = host.esc;
    if (!r || !r.querySelector(pdfUi) || !cs.pdf) return;
    var w = winNow();
    var c = r.querySelector("#qgCount");
    if (c) c.innerHTML = w.sel ? "<b>" + w.count + "</b> of " + PAGE_CAP + " pages selected" : "0 of " + PAGE_CAP + " pages selected";
    var m = r.querySelector("#qgPgMsg");
    if (m) {
      if (w.error) { m.className = "pn-err qg-pgerr"; m.setAttribute("role", "alert"); m.textContent = w.error; }
      else { m.className = "pc-lbl qg-pgok"; m.removeAttribute("role"); m.textContent = w.from + " to " + w.to + " of " + cs.pdf.pages; }
    }
    var fw = r.querySelector("#qgFixWrap"), html = "";
    if (w.fix) html = '<button type="button" class="pn-chip" data-act="g-fix">Use ' + w.fix.from + " to " + w.fix.to + "</button>";
    else if (w.swap) html = '<button type="button" class="pn-chip" data-act="g-swap">Swap to ' + w.swap.from + "-" + w.swap.to + "</button>";
    if (fw && html) fw.innerHTML = html;
    else if (fw) fw.parentNode && fw.parentNode.removeChild(fw);
    else if (html && m && m.parentNode) m.parentNode.insertAdjacentHTML("afterend", '<div class="pn-wrap" id="qgFixWrap">' + html + "</div>");
    var go = r.querySelector('[data-act="g-go"], [data-act="g-arun"]');
    if (go && !cs.busy && !(au && au.busy)) {
      var bad = !w.sel;
      go.disabled = !!bad;
      if (go.getAttribute("data-act") === "g-go") go.textContent = goLabel();
    }
  }
  // Set the window from numbers (chapter jump, stepper, fix, next-module): inputs, spec and paint, then previews.
  function applyWindow(host, from, to) {
    cs.adv = false; cs.pgFrom = String(from); cs.pgTo = String(to);
    cs.spec = SR().windowSpec(from, to);
    var r = host.root();
    if (r) {
      var f = r.querySelector("#qgFrom"), t = r.querySelector("#qgTo");
      if (!f || !t) { host.rerender(); queuePrev(host); return; }
      f.value = cs.pgFrom; t.value = cs.pgTo;
    }
    paintWindow(host);
    queuePrev(host);
  }
  /* First-lines + thumbnail preview of the From and To pages, so the choice can be confirmed. Two pages at most,
     low resolution, one fetch at a time; a failure hides the previews, never an error. */
  var prevTimer = 0;
  function queuePrev(host) {
    try { if (prevTimer) G.clearTimeout(prevTimer); } catch (e) {}
    prevTimer = G.setTimeout(function () { prevTimer = 0; ensurePrev(host); }, 350);
  }
  function prevHtml(esc, prev, total) {
    // "Page 10 of 100": the one page-locator shape the book scrubber keeps (like the deck picker's labels).
    var fig = function (p, x) {
      if (!x || (!x.img && !x.lines)) return "";
      return '<figure class="qg-pv">' + (x.img ? '<img src="' + x.img + '" alt="Page ' + p + " of " + total + ' preview" loading="lazy">' : "") +
        "<figcaption>Page " + p + " of " + total + (x.lines ? "</figcaption><p>" + esc(x.lines) + "</p>" : "</figcaption>") + "</figure>";
    };
    var a = fig(prev.from, prev.f), b = (prev.to !== prev.from) ? fig(prev.to, prev.t) : "";
    return (a || b) ? '<div class="qg-prev" aria-label="Preview of the chosen pages">' + a + b + "</div>" : "";
  }
  function ensurePrev(host) {
    var S = SR(), r = host.root(), esc = host.esc;
    if (!S || !cs.pdf || !r || !r.querySelector("#qgPrev")) return;
    var w = winNow();
    if (!w.sel) { cs.prev = null; var q = r.querySelector("#qgPrev"); if (q) q.innerHTML = ""; return; }
    var key = cs.pdf.name + "|" + cs.pdf.bytes + "|" + (cs.adv ? "a:" + cs.spec : w.from + "-" + w.to);
    if (cs.prev && cs.prev.key === key) { var q0 = r.querySelector("#qgPrev"); if (q0 && cs.prev.html !== q0.innerHTML) q0.innerHTML = cs.prev.html; return; }
    var doc = cs.pdf.doc, from = w.from, to = w.to;
    cs.prev = { key: key, from: from, to: to, html: (cs.prev && cs.prev.from === from && cs.prev.to === to) ? cs.prev.html : "" };
    var pages = from === to ? [from] : [from, to];
    S.readPdfPages(doc, pages, null).then(function (rd) {
      var lines = {};
      (rd.pages || []).forEach(function (pg) {
        var tx = (pg.lines || []).map(function (l) { return l.tx; }).join(" ").replace(/\s+/g, " ").trim();
        lines[pg.p] = tx.slice(0, 160);
      });
      var jobs = pages.map(function (p) { return S.renderThumb(doc, p, 160).then(function (u) { return u; }, function () { return ""; }); });
      return Promise.all(jobs).then(function (imgs) {
        if (!cs.pdf || cs.pdf.doc !== doc || !winNow().sel) return;
        var cur = winNow(), key2 = cs.pdf.name + "|" + cs.pdf.bytes + "|" + (cs.adv ? "a:" + cs.spec : cur.from + "-" + cur.to);
        if (key2 !== key) return;
        var prev = { key: key, from: from, to: to, f: { img: imgs[0], lines: lines[from] || "" }, t: { img: imgs[1] || "", lines: lines[to] || "" } };
        prev.html = prevHtml(esc, prev, cs.pdf.pages);
        cs.prev = prev;
        var rr = host.root(), q = rr && rr.querySelector("#qgPrev");
        if (q) q.innerHTML = prev.html;
      });
    }, function () {});
  }
  function pickPdf(file, host) {
    if (!SR()) return createErr(host, "PDFs cannot be read here. Paste the text instead.");
    cs.err = ""; cs.pdf = null; cs.busy = "Opening the PDF…"; host.rerender();
    SR().openPdf(file).then(function (pdf) {
      cs.busy = ""; cs.pdf = pdf; cs.spec = SR().defaultPages(pdf.pages);
      var m = String(cs.spec).match(/^(\d+)(?:-(\d+))?$/);
      cs.adv = false; cs.pgFrom = (m && m[1]) || ""; cs.pgTo = (m && m[2]) || cs.pgFrom;
      cs.outline = null; cs.olBusy = true; cs.prev = null;
      if (pdfUi === "#qgAuthView") { if (!au.topic) { au.topic = pdf.name.replace(/\.pdf$/i, "").slice(0, 150); saveAuthor(); } }
      else if (!cs.topic) cs.topic = pdf.name.replace(/\.pdf$/i, "").slice(0, 120);
      if (onTop(pdfUi, host)) host.rerender();
      SR().readOutline(pdf.doc).then(function (list) {
        if (!cs.pdf || cs.pdf.doc !== pdf.doc) return;
        cs.outline = list; cs.olBusy = false;
        if (onTop(pdfUi, host)) host.rerender();
      });
    }, function () { createErr(host, "This PDF could not be opened. It may be protected by a password or damaged."); });
  }
  /* The grounding: pasted notes, or the chosen PDF pages read on this phone (same reader as Make a deck).
     Resolves { text, pages } (pages = the PDF page numbers used, else null: the manifest keeps them). */
  function readGround(host) {
    if (cs.kind === "topic") return Promise.resolve({ text: "", pages: null });
    if (cs.kind === "notes") return Promise.resolve({ text: cs.text, pages: null });
    if (!cs.pdf) return Promise.reject(new Error("Choose a PDF first."));
    // Window mode reads the From/To fields, never a stale typed spec (e.g. left behind by the Advanced toggle).
    var spec = cs.spec;
    if (!cs.adv) {
      var w0 = winNow();
      if (!w0.sel) return Promise.reject(new Error(w0.error || "Pick the pages to use first."));
      spec = SR().windowSpec(w0.from, w0.to);
    }
    var res = SR().selFromSpec(spec, cs.pdf.pages, PAGE_CAP);
    var pages = res && res.sel ? res.sel : res && res.pages ? res.pages : null;
    if (!pages || !pages.length) return Promise.reject(new Error((res && res.error) || "Type the pages to use, for example 1-12, up to " + PAGE_CAP + "."));
    if (pages.length > PAGE_CAP) return Promise.reject(new Error("Up to " + PAGE_CAP + " pages in one module."));
    pages = SR().fitBytes(pages, cs.pdf.bytes || 0, cs.pdf.pages || 0).sel;
    cs.busy = "Reading page 1 of " + pages.length + "…"; host.rerender();
    var say = function (t) { var el = host.root() && host.root().querySelector(pdfUi + " .pc-readp .pn-load"); if (el) el.textContent = t; };
    return SR().readPdfPages(cs.pdf.doc, pages, function (d, n) { if (d < n) say("Reading page " + (d + 1) + " of " + n + "…"); }).then(function (rd) {
      cs.busy = "";
      var doc = SR().buildDoc(rd.pages || []), text = (doc.sents || []).map(function (s) { return s.tx; }).join(" ");
      if (text.replace(/\s+/g, "").length < 200) {
        var skipped = (rd.skipped || []).map(function (s) { return s.why; });
        var bare = !(rd.pages || []).some(function (pg) { return ((pg.lines || []).length > 0); });
        if (bare && skipped.length && skipped.every(function (w) { return w === "no-text"; }))
          throw new Error("These pages look scanned: there is no readable text on them. Try other pages, or paste the text instead.");
        throw new Error("These pages have too little text to make questions from. Try other pages.");
      }
      markDone(SR().pdfHistKey(cs.pdf.name, cs.pdf.bytes), pages[0], pages[pages.length - 1]);
      return { text: text, pages: pages };
    });
  }
  function go(host) {
    cs.err = "";
    if (job && !job.done) return createErr(host, "A module is being made. Wait for it to finish first.");
    if (!user()) return createErr(host, MSG["sign-in"]);
    var topic = String(cs.topic || "").trim();
    if (topic.length < 3) return createErr(host, cs.kind === "topic" ? "Type a topic first." : "Give the module a name.");
    if (cs.kind !== "topic" && !cs.own) return createErr(host, "Confirm that these are your own notes or material you may use.");
    if (cs.kind === "notes" && cs.text.replace(/\s+/g, "").length < 200) return createErr(host, "Paste a little more text: at least a paragraph or two.");
    if (G.navigator && G.navigator.onLine === false) return createErr(host, MSG.offline);
    var scrub = SR() && SR().prepScrub ? SR().prepScrub : function (x) { return x; };
    readGround(host).then(function (g) {
      var ground = scrub(String(g.text || "")).slice(0, GROUND_MAX);
      start(host, { title: topic.slice(0, 120), topic: topic.slice(0, 120), ground: ground, pages: g.pages || null, exam: cs.exam, diff: cs.diff, target: cs.count });
      cs.topic = ""; cs.text = ""; cs.pdf = null; cs.spec = ""; cs.own = false;
      cs.pgFrom = ""; cs.pgTo = ""; cs.adv = false; cs.outline = null; cs.olBusy = false; cs.prev = null;
    }, function (e) { createErr(host, (e && e.message) || "The pages could not be read."); });
  }

  /* ================= the job ================= */
  function start(host, o) {
    job = { mod: o.mod || newMod(), title: o.title, topic: o.topic, ground: o.ground, pages: o.pages || null, note: o.note || "", exam: o.exam, diff: o.diff, target: o.target, base: o.base || 0,
      made: 0, dropped: 0, rounds: 0, stage: "write", stopReq: false, done: false, code: "", mt: 0, items: o.items || [], m: o.m || null };
    if (onTop("#qgCreateView", host)) host.back();
    host.push(function () { renderProgress(host); });
    loop(host);
  }
  function loop(host) {
    var j = job;
    if (!j || j.done) return;
    if (j.stopReq) return finish(host, "");
    var n = nextN(j.target, j.made, j.rounds);
    if (!n) return finish(host, "");
    j.rounds++; j.stage = "write"; upd(host);
    if (!j.idem) j.idem = idem();   // one key per round: the retry reuses it, so the server replays instead of remaking
    // The checking step runs on the server in the same request; show it after a while so the stage list is honest.
    var tCheck = G.setTimeout(function () { if (job === j && !j.done) { j.stage = "check"; upd(host); } }, 14000);
    call({ op: "gen", mod: j.mod, topic: j.topic, ground: j.ground || undefined, exam: j.exam, diff: j.diff, n: n, round: j.base + j.rounds, avoid: avoidOf(j.items), idem: j.idem }).then(function (r) {
      G.clearTimeout(tCheck);
      if (job !== j) return;
      if (r.status !== 200) {
        var c = r.abort ? "ai-timeout" : codeOf(r.status, r.json, onlineNow());
        if (retryable(c) && !j.retried) {   // once more after a short delay, same round and key; then it waits for resume
          j.retried = true; j.rounds--; j.stage = "write"; upd(host);
          G.setTimeout(function () { if (job === j && !j.done) loop(host); }, QRETRY_MS);
          return;
        }
        return finish(host, c);
      }
      j.idem = null; j.retried = false;
      var got = (r.json.items || []).filter(function (it) { return it && it.qg && it.qg.v === "ok" && it.o && it.o.length === 4; });
      j.dropped += (r.json.dropped || []).length;
      j.mt += (r.json.usage && r.json.usage.mt) || 0; j.mtUsed = (j.mtUsed || 0) + ((r.json.usage && r.json.usage.mt) || 0);
      if (r.json.left) { if (status) status.left = r.json.left.modules; j.room = r.json.left.questions; }
      j.stage = "save"; upd(host);
      return save(j, got).then(function (nSaved) {
        j.made += nSaved; upd(host);
        if (r.json.left && r.json.left.questions === 0) return finish(host, "");
        loop(host);
      }, function () { finish(host, "save"); });
    });
  }
  /* Save a round into the module's deck: the manifest on the first accepted round, then the items. Items already
     in the module (a replayed round after a retry or resume) are left out, so a question is never saved twice.
     Resolves with how many were newly saved, which is what the progress counts. */
  function save(j, got) {
    var seen = {};
    j.items.forEach(function (it) { if (it && it.id) seen[it.id] = 1; });
    got = (got || []).filter(function (it) { if (!it || !it.id || seen[it.id]) return false; seen[it.id] = 1; return true; });
    if (!got.length) return Promise.resolve(0);
    var D = DK(), now = Date.now();
    got.forEach(function (it) { it.deckId = j.mod; it._s = "deck"; it._m = "deck-" + j.mod; it.t = "gen"; });
    j.items = j.items.concat(got);
    var m = j.m || D.newManifest({ id: j.mod, title: j.title, exam: j.exam, profileV: 1, pv: "qg1", model: "maik", source: { type: "maik", name: j.topic, pages: null, sha: j.mod }, now: now });
    var S = SR();
    if (j.pages && j.pages.length && S && S.pageSpan) { m.source.pages = S.pageSpan(j.pages); if (S.selSpec) m.source.sel = S.selSpec(j.pages); }
    m.qgen = { g: j.ground ? 1 : 0, topic: j.topic, diff: j.diff, target: Math.max((m.qgen && m.qgen.target) || 0, j.base + j.target) };
    m.diff = j.diff === "mix" ? "mix" : j.diff;
    m.stats.generated += got.length; m.stats.accepted += got.length;
    m.cost.mt = (m.cost.mt || 0) + j.mt; j.mt = 0;
    m.topics = D.topicsFor(j.mod, j.items, [{ id: "gen", title: j.title }]);
    j.m = m;
    var src = j.ground ? D.putSrc({ deckId: j.mod, name: j.topic, type: "maik", sents: [], ground: j.ground }) : Promise.resolve();
    return Promise.all([D.putItems(got), src]).then(function () { return D.putDeck(m); }).then(function () { D.changed(j.mod); return got.length; });
  }
  function finish(host, code) {
    var j = job; if (!j) return;
    j.done = true; j.code = code || ""; j.stage = "";
    if (onTop("#qgProgView", host)) host.rerender();
  }
  /* Pick up the failed round where it stopped: same round number and key, a fresh retry, the saved questions kept
     (the next round's avoid list carries them, and save() drops any replayed question already in the module). */
  function resume(host) {
    if (!job || !job.done || !retryable(job.code) || job.stopReq) return;
    job.done = false; job.code = ""; job.stopReq = false; job.rounds = Math.max(0, job.rounds - 1); job.retried = false;
    if (onTop("#qgProgView", host)) host.rerender();
    loop(host);
  }
  // Back from a lock or the background, or the network returning: a round cut off by a retryable error goes on by
  // itself. No resume while still hidden, or still offline after an offline stop (the online event retries that).
  function maybeResume() {
    if (G.document && G.document.visibilityState === "hidden") return;
    if (!job || !job.done || !retryable(job.code) || job.stopReq) return;
    if (job.code === "offline" && onlineNow() === false) return;
    var h = G.PREP && G.PREP._host;
    if (h) resume(h);
  }
  if (G.document && G.document.addEventListener) {
    G.document.addEventListener("visibilitychange", maybeResume);
    G.document.addEventListener("resume", maybeResume);
  }
  if (G.addEventListener) { G.addEventListener("pageshow", maybeResume); G.addEventListener("online", maybeResume); }
  var STAGES = [["write", "Writing questions"], ["check", "Checking each answer"], ["save", "Saving to your module"]];
  function stageHtml(j) {
    var at = -1; STAGES.forEach(function (s, i) { if (s[0] === j.stage) at = i; });
    return '<ol class="pc-stages" aria-hidden="true">' + STAGES.map(function (s, i) { return '<li class="' + (i < at ? "done" : i === at ? "on" : "") + '">' + s[1] + "</li>"; }).join("") + "</ol>";
  }
  function upd(host) {
    var r = host.root(), j = job;
    if (!r || !j || !r.querySelector("#qgProgView") || j.done) return;
    var set = function (sel, t) { var el = r.querySelector(sel); if (el) el.textContent = t; };
    set("#qgCount", String(j.made));
    var b = r.querySelector("#qgBarI"); if (b) b.style.transform = "scaleX(" + Math.min(1, j.made / j.target).toFixed(3) + ")";
    var s = r.querySelector("#qgStages"); if (s) s.innerHTML = stageHtml(j);
    set("#qgPhase", (STAGES.filter(function (x) { return x[0] === j.stage; })[0] || ["", ""])[1]);
  }
  function renderProgress(host) {
    var j = job, esc = host.esc;
    if (!j) return host.back();
    var body, title;
    if (!j.done) {
      title = "Making your module";
      body = '<section class="pn-panel pc-progp"><p class="pc-dfig"><b class="pn-big" id="qgCount">' + j.made + '</b><span class="pn-mut">of ' + j.target + " questions ready</span></p>" +
        '<span class="pn-prog pc-bar" aria-hidden="true"><i id="qgBarI" style="transform:scaleX(' + Math.min(1, j.made / j.target).toFixed(3) + ')"></i></span>' +
        '<p class="pc-sr" id="qgPhase" aria-live="polite">' + esc((STAGES.filter(function (x) { return x[0] === j.stage; })[0] || ["", ""])[1]) + "</p>" +
        '<div id="qgStages">' + stageHtml(j) + "</div></section>" +
        '<p class="pn-mut pn-small">Five questions at a time: each is written, checked by answering it blind, and saved. What is ready stays saved if you stop or lose the connection.</p>' +
        '<button type="button" class="pn-btn" data-act="g-stop"' + (j.stopReq ? " disabled" : "") + ">" + (j.stopReq ? "Stopping after these five" : "Stop") + "</button>";
    } else {
      var n = j.made, has = j.m ? DK().questionCount(j.m) : 0, short = n < j.target, err = j.code && j.code !== "save" ? msgOf(j.code) : j.code === "save" ? "The questions could not be saved on this phone." : "";
      title = n ? (short ? "Module partly made" : "Module ready") : "Module not made";
      var lim = !n && !has && /^(daily-modules|budget|ai-cost-cap|device-cap)$/.test(j.code);
      body = (lim ? "" : '<section class="pn-panel pn-score pc-res qg-res"><p class="pn-big" id="qgMade">' + n + '</p><p class="pn-mut">' + (n === 1 ? "question" : "questions") + " ready" + (has > n ? " · " + has + " in the module" : "") + "</p>" +
        (j.dropped ? '<p class="pn-mut pn-small">' + (j.dropped === 1 ? "1 question was left out because it did not pass the checks." : j.dropped + " questions were left out because they did not pass the checks.") + "</p>" : "") +
        (j.mtUsed ? '<p class="pn-mut pn-small" id="qgMt">Used ' + fmtN(j.mtUsed) + " MaiK Tokens.</p>" : "") + "</section>") +
        (j.note ? '<p class="pn-mut" id="qgNote">' + esc(j.note) + "</p>" : "") +
        (lim && j.code === "daily-modules" ? '<section class="pn-panel qg-limit" role="alert" id="qgErr" tabindex="-1"><p class="qg-limh">Today\'s free modules are used</p><p class="pn-mut">You can create ' + ((status && status.caps && status.caps.modulesPerDay) || 3) + " modules with MaiK a day. Your modules so far are in Your decks.</p></section>" : "") +
        (err && !(lim && j.code === "daily-modules") ? '<p class="pn-err" role="alert" id="qgErr" tabindex="-1">' + esc(err) + "</p>" : "") +
        (!err && short && !j.stopReq ? '<p class="pn-mut">Fewer questions passed the checks than asked for. You can add more from the module.</p>' : "") +
        (j.stopReq ? '<p class="pn-mut">Stopped. What was made is saved.</p>' : "") +
        (n || has ? '<button type="button" class="pn-btn pri" data-act="g-prac" data-d="' + esc(j.mod) + '">' + host.ico("play") + " Start practising</button>" +
          '<button type="button" class="pn-btn" data-act="g-open" data-d="' + esc(j.mod) + '">Open the module</button>' : "") +
        (j.code && retryable(j.code) ? '<button type="button" class="pn-btn" data-act="g-retry">Try again</button>' : "") +
        '<button type="button" class="pn-btn" data-act="g-done">Done</button>';
    }
    host.paint(host.bar(title, esc(j.title), "back") + '<div class="pn-body" id="qgProgView">' + body + "</div>", j.done && j.code ? "#qgErr" : null);
  }

  /* More questions for a module already made (the deck screen's button). */
  function more(host, deckId) {
    var D = DK();
    Promise.all([D.getDeck(deckId), D.items(deckId), D.getSrc(deckId).then(null, function () { return null; })]).then(function (a) {
      var m = a[0]; if (!m || !m.qgen) return host.toast("This module is not on this phone any more.");
      var items = a[1] || [], have = items.length, room = Math.max(0, 30 - have);
      if (!room) return host.toast(MSG["module-full"]);
      if (job && !job.done) return host.toast("A module is being made. Wait for it to finish first.");
      job = null;
      var ground = (a[2] && a[2].ground) || "";
      var note = m.qgen.g && !ground ? "The notes this module was made from are gone from this phone. The new questions below come from general knowledge instead." : "";
      if (note) host.toast("The original notes are gone from this phone. Using general knowledge.");
      start(host, { mod: deckId, title: m.title, topic: m.qgen.topic || m.title, ground: ground, exam: m.exam, diff: m.qgen.diff || "mix", target: Math.min(10, room), base: Math.ceil(have / PER), items: items, m: m, note: note });
    });
  }

  /* Report from the runner (prep.js sendReport): hide it in this module on this phone, count it on the server. */
  function report(it, why) {
    try {
      it.qg.rep = why;
      var D = DK(); if (D && it.deckId) D.items(it.deckId).then(function (list) { var mine = (list || []).filter(function (x) { return x.id === it.id; }); if (mine.length) { mine[0].qg.rep = why; return D.putItems(mine); } });
    } catch (e) {}
    call({ op: "report", mod: it.deckId || String(it._m || "").replace(/^deck-/, ""), id: it.id, why: why }, 15000);
  }
  /* The honest line under a MaiK question's explanation. */
  function provLine(it) {
    if (!it || !it.qg) return "";
    return '<p class="pn-mut pn-small qg-prov">' + (it.qg.u ? "Created with MaiK from general knowledge, not from the PrepNucleus library. Check before you rely on it." : "Created with MaiK from your notes.") + "</p>";
  }

  /* ================= owner: Author ================= */
  function loadAuthor() { try { var v = JSON.parse(G.localStorage.getItem(LS_AUTHOR) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  function saveAuthor() { try { G.localStorage.setItem(LS_AUTHOR, JSON.stringify(au)); } catch (e) {} }
  function newAuthor(host) { return { kind: "topic", targets: [], pub: null, psub: "", exam: examFor(host.exam().id), subject: "", module: "", newName: "", topic: "", text: "", n: 10, diff: "mix", list: [], job: null, stage: null, err: "", busy: "", usage: null }; }
  function openAuthor(host) {
    if (!isOwner()) return host.toast("Owner access only");
    au = loadAuthor() || newAuthor(host);
    au.err = ""; au.busy = ""; au.kind = au.kind || "topic"; au.targets = au.targets || [];
    host.push(function () { renderAuthor(host); });
    if (au.job && au.job.stage !== "done") poll(host);
  }
  function subjectsFor(host) { try { return host.subjectsOf(au.exam === "neet-ss" ? "neet-ss" : au.exam === "usmle" ? "usmle" : "neet-pg") || []; } catch (e) { return []; } }
  function plain(v) { return String(v && typeof v === "object" ? (v.en || "") : v == null ? "" : v); }
  function renderAuthor(host) {
    pdfUi = "#qgAuthView";
    var esc = host.esc, subs = subjectsFor(host), ix = au.subject ? host.ix()[au.subject] : null;
    if (au.subject && !ix) host.loadIndex(au.subject).then(function () { if (onTop("#qgAuthView", host)) host.rerender(); });
    var mods = ix ? (ix.topics || []).filter(function (t) { return t.group !== "mixed"; }) : [];
    var opt = function (v, label, on) { return '<option value="' + esc(v) + '"' + (on ? " selected" : "") + ">" + esc(label) + "</option>"; };
    var pend = au.list.filter(function (r) { return !r.st; }).length, ok = au.list.filter(function (r) { return r.st === "ok"; }).length;
    var jobHtml = au.job ? '<section class="pn-panel qg-job" aria-live="polite"><p><b>Batch job</b> · ' + esc(au.job.stage) + " · " + au.job.n + " asked" + (au.job.made ? " · " + au.job.made + " made" : "") + "</p>" +
      (au.job.est ? '<p class="pn-mut pn-small">Estimated $' + au.job.est.toFixed(2) + " at batch prices</p>" : "") +
      (au.job.stage !== "done" ? '<button type="button" class="pn-btn" data-act="g-apoll">Check now</button>' : "") + "</section>" : "";
    host.paint(host.bar("Author", "Owner only", "back") + '<div class="pn-body qg-author" id="qgAuthView">' +
      seg("Exam", "qgAEL", EXAMS.map(function (x) { return chip("g-aexam", x[0], x[1], au.exam === x[0]); }).join("")) +
      '<label class="pc-lbl" for="qgASub">Subject</label><select id="qgASub" name="subject" class="pc-in">' + opt("", "Choose a subject", !au.subject) + subs.map(function (s) { return opt(s.id, plain(s.name) || s.id, au.subject === s.id); }).join("") + "</select>" +
      '<label class="pc-lbl" for="qgAMod">Module</label><select id="qgAMod" name="module" class="pc-in"' + (au.subject ? "" : " disabled") + ">" + opt("", au.subject ? "A new module (name below)" : "Choose a subject first", !au.module) + mods.map(function (t) { return opt(t.id, plain(t.title) || t.id, au.module === t.id); }).join("") + "</select>" +
      (!au.module ? '<label class="pc-lbl" for="qgANew">New module name</label><input id="qgANew" name="module-name" class="pc-in" maxlength="80" autocomplete="off" value="' + esc(au.newName) + '">' : "") +
      seg("Make it from", "qgASrcL", chip("g-asrc", "topic", "A topic", au.kind === "topic") + chip("g-asrc", "notes", "Notes", au.kind === "notes") + chip("g-asrc", "pdf", "A PDF", au.kind === "pdf")) +
      '<label class="pc-lbl" for="qgATopic">Topic for MaiK</label><input id="qgATopic" name="topic" class="pc-in" maxlength="150" autocomplete="off" value="' + esc(au.topic) + '">' +
      (au.kind === "notes" ? '<label class="pc-lbl" for="qgAText">Notes (every question must be answerable from them)</label><textarea id="qgAText" name="source" class="pc-in pc-ta" rows="7" placeholder="Paste the source chunks…">' + esc(au.text) + "</textarea>" +
        '<p class="pn-mut pn-small">' + fmtN(au.text.length) + " of " + fmtN(OWNER_GROUND_MAX) + " characters</p>" : "") +
      (au.kind === "pdf" ? pdfPicker(host, esc) : "") +
      '<label class="pc-lbl" for="qgAN">How many questions</label><input id="qgAN" name="count" class="pc-in" type="number" inputmode="numeric" min="1" max="400" value="' + au.n + '">' +
      '<p class="pn-mut pn-small">Up to 10 run now. More go to the batch queue at half price and arrive within a few hours.</p>' +
      seg("Difficulty", "qgADL", DIFFS.map(function (d) { return chip("g-adiff", d[0], d[1], au.diff === d[0]); }).join("")) +
      ((au.busy || cs.busy) ? '<section class="pn-panel pc-readp" role="status" aria-live="polite"><span class="pc-spin" aria-hidden="true"></span><p class="pn-load">' + esc(au.busy || cs.busy) + "</p></section>" : "") +
      (au.err ? '<p class="pn-err" role="alert" id="qgAErr" tabindex="-1">' + esc(au.err) + "</p>" : "") +
      '<button type="button" class="pn-btn pri" data-act="g-arun"' + (au.busy || cs.busy || (au.kind === "pdf" && (!cs.pdf || !winNow().sel)) ? " disabled" : "") + ">" + (au.n > 10 ? "Queue " + au.n + " questions" : "Write " + au.n + " questions") + "</button>" +
      jobHtml +
      (au.usage ? '<p class="pn-mut pn-small" id="qgAUse">Last run: $' + Number(au.usage.usd || 0).toFixed(4) + " · " + fmtN(au.usage.inTok + au.usage.cacheRead + au.usage.cacheWrite) + " tokens in, " + fmtN(au.usage.outTok) + " out</p>" : "") +
      (au.list.length ? '<button type="button" class="pn-mod" data-act="g-areview"><span class="pn-mb"><b>Review ' + au.list.length + " questions</b><small>" + ok + " approved · " + pend + " to decide</small></span>" + host.ico("chev") + "</button>" : "") +
      (au.stage ? '<section class="pn-panel qg-stage"><p><b>Staged for publishing</b> (' + au.stage.n + ' questions)</p><p class="pn-mut pn-small">Run this on the Mac to publish:</p><code class="qg-cmd" id="qgCmd">' + esc(au.stage.cmd) + '</code><button type="button" class="pn-btn" data-act="g-acopy">Copy the command</button></section>' : "") +
      "</div>", au.err ? "#qgAErr" : null);
    var r = host.root(); if (!r) return;
    var bind = function (sel, key, num) { var el = r.querySelector(sel); ON(el, "input", function () { au[key] = num ? Math.max(1, Math.min(400, parseInt(el.value, 10) || 1)) : el.value; saveAuthor(); }); };
    bind("#qgANew", "newName"); bind("#qgATopic", "topic"); bind("#qgAText", "text"); bind("#qgAN", "n", true);
    var sSel = r.querySelector("#qgASub"), mSel = r.querySelector("#qgAMod");
    ON(sSel, "change", function () { au.subject = sSel.value; au.module = ""; saveAuthor(); host.rerender(); });
    // The DOM is patched in place, so a listener outlives this render: read the module list fresh, never from a closure.
    ON(mSel, "change", function () { au.module = mSel.value; var ix2 = au.subject ? host.ix()[au.subject] : null; if (au.module && !au.topic && ix2) { var t = (ix2.topics || []).filter(function (x) { return x.id === au.module; })[0]; if (t) au.topic = plain(t.title) || t.id; } saveAuthor(); host.rerender(); });
    var nIn = r.querySelector("#qgAN"); ON(nIn, "change", function () { host.rerender(); });
    if (au.kind === "pdf") { bindPdf(host, r); queuePrev(host); }
  }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
  function authorBank(host) {
    if (!au.subject || !au.module) return [];
    var out = [host.modulePath(au.subject, au.module)];
    (host.overlaysOf(au.subject) || []).forEach(function (set) { out.push("overlay/" + set + "/" + au.subject + "/" + au.module + ".json"); });
    return out.slice(0, 6);
  }
  function authorErr(host, m) { au.err = m; au.busy = ""; saveAuthor(); if (onTop("#qgAuthView", host)) host.rerender(); }
  function authorRun(host) {
    au.err = "";
    if (!au.subject) return authorErr(host, "Choose a subject.");
    if (!au.module && slug(au.newName).length < 2) return authorErr(host, "Choose a module or name a new one.");
    if (String(au.topic).trim().length < 3) return authorErr(host, "Type the topic for MaiK.");
    if (au.kind === "notes" && au.text.replace(/\s+/g, "").length < 200) return authorErr(host, "The notes are very short. Paste more, or use a topic only.");
    if (au.kind === "pdf") {
      if (!cs.pdf) return authorErr(host, "Choose a PDF first.");
      pdfUi = "#qgAuthView"; cs.kind = "pdf"; au.busy = "Reading the PDF…"; host.rerender();
      return readGround(host).then(function (g) {
        var scrub = SR() && SR().prepScrub ? SR().prepScrub : function (x) { return x; };
        return authorGo(host, scrub(String(g.text || "")).slice(0, OWNER_GROUND_MAX));
      }, function (e) { authorErr(host, (e && e.message) || "The pages could not be read."); });
    }
    return authorGo(host, au.kind === "notes" ? au.text : "");
  }
  function authorGo(host, ground) {
    var mod = au.mod || (au.mod = newMod());
    var base = { topic: au.topic.trim().slice(0, 150), ground: ground || undefined, exam: au.exam, diff: au.diff, bank: authorBank(host) };
    if (au.n > 10) {
      au.busy = "Queueing " + au.n + " questions…"; host.rerender();
      return call(Object.assign({ op: "bsubmit", n: au.n, mod: mod, subject: au.subject, module: au.module || slug(au.newName), title: au.module || au.newName }, base), 60000).then(function (r) {
        au.busy = "";
        if (r.status !== 200) return authorErr(host, msgOf(codeOf(r.status, r.json)) + (r.json && r.json.message ? " " + r.json.message : ""));
        au.job = { id: r.json.job.id, stage: r.json.job.stage, n: au.n, made: 0, est: r.json.estimate && r.json.estimate.usd };
        saveAuthor(); host.rerender(); poll(host);
      });
    }
    var left = au.n, round = 0;
    var next = function () {
      if (left <= 0) { au.busy = ""; saveAuthor(); return host.rerender(); }
      var n = Math.min(PER, left); round++;
      au.busy = "Writing and checking, round " + round + " of " + Math.ceil(au.n / PER) + "…"; host.rerender();
      return call(Object.assign({ op: "gen", mod: mod, n: n, round: round, avoid: avoidOf(au.list.map(function (x) { return x.it; })), idem: idem() }, base)).then(function (r) {
        if (r.status !== 200) return authorErr(host, msgOf(codeOf(r.status, r.json)));
        (r.json.items || []).forEach(function (it) { au.list.push({ it: it, st: "" }); });
        au.usage = r.json.usage; left -= n; saveAuthor(); return next();
      });
    };
    return next();
  }
  var pollT = null;
  function poll(host) {
    if (pollT) { G.clearTimeout(pollT); pollT = null; }
    if (!au || !au.job || au.job.stage === "done") return;
    call({ op: "bpoll", job: au.job.id }, 60000).then(function (r) {
      if (r.status !== 200) { au.err = msgOf(codeOf(r.status, r.json)); }
      else {
        au.err = ""; au.job.stage = r.json.job.stage; au.job.made = r.json.job.made;
        if (r.json.usage) au.usage = r.json.usage;
        if (r.json.job.stage === "done") (r.json.items || []).forEach(function (it) { au.list.push({ it: it, st: "" }); });
      }
      saveAuthor();
      if (onTop("#qgAuthView", host)) host.rerender();
      if (au.job && au.job.stage !== "done" && onTop("#qgAuthView", host)) pollT = G.setTimeout(function () { poll(host); }, 30000);
    });
  }
  function renderReview(host) {
    var esc = host.esc, L = ["A", "B", "C", "D"], ok = au.list.filter(function (r) { return r.st === "ok"; }).length;
    host.paint(host.bar("Review", ok + " of " + au.list.length + " approved", "back") + '<div class="pn-body qg-review" id="qgRevView">' +
      '<div class="qg-revtop"><button type="button" class="pn-btn" data-act="g-abulk">Approve all unflagged</button>' +
      '<button type="button" class="pn-btn pri" data-act="g-astage"' + (ok ? "" : " disabled") + ">Stage " + ok + " for publishing</button></div>" +
      publishHtml(host, esc, ok) +
      (au.err ? '<p class="pn-err" role="alert" id="qgRErr" tabindex="-1">' + esc(au.err) + "</p>" : "") +
      '<ol class="qg-items">' + au.list.slice(0, au.show || 50).map(function (r, i) {
        var it = r.it, fl = it.qg && it.qg.v !== "ok";
        var ed = r.ed;
        return '<li class="pn-panel qg-item' + (r.st === "ok" ? " is-ok" : r.st === "drop" ? " is-drop" : "") + '" data-i="' + i + '">' +
          '<p class="qg-meta"><span class="qg-n">' + (i + 1) + "</span>" + (fl ? '<span class="qg-flag">' + host.ico("flag") + " " + esc((it.qg.why || []).map(function (w) { return WHY[w] || w; }).join(", ")) + "</span>" : '<span class="qg-pass">' + host.ico("check") + " Passed the checks</span>") +
          (it.qg && it.qg.u ? '<span class="qg-u">Not from a source</span>' : "") + "</p>" +
          (ed ? '<label class="pc-lbl" for="qgE' + i + '">Question</label><textarea id="qgE' + i + '" class="pc-in pc-ta qg-edq" data-i="' + i + '" rows="4">' + esc(it.q) + "</textarea>" : '<p class="qg-q">' + esc(it.q) + "</p>") +
          '<ol class="qg-opts">' + it.o.map(function (o, k) { return '<li class="' + (k === it.a ? "key" : "") + '"><span class="pn-l">' + L[k] + "</span><span>" + esc(o) + (k === it.a ? '<span class="pc-sr"> (answer)</span>' : "") + (fl && it.qg.pick === k && k !== it.a ? ' <small class="qg-pick">checker chose this</small>' : "") + "</span></li>"; }).join("") + "</ol>" +
          (ed ? '<label class="pc-lbl" for="qgX' + i + '">Explanation</label><textarea id="qgX' + i + '" class="pc-in pc-ta qg-edx" data-i="' + i + '" rows="4">' + esc(it.exp) + "</textarea>" : '<p class="pn-mut pn-small qg-exp">' + esc(it.exp) + "</p>") +
          (it.qg && it.qg.note ? '<p class="pn-small qg-note">Checker: ' + esc(it.qg.note) + "</p>" : "") +
          '<div class="qg-acts"><button type="button" class="pn-chip' + (r.st === "ok" ? " on" : "") + '" aria-pressed="' + (r.st === "ok") + '" data-act="g-aok" data-i="' + i + '">Approve</button>' +
          '<button type="button" class="pn-chip' + (ed ? " on" : "") + '" aria-pressed="' + !!ed + '" data-act="g-aedit" data-i="' + i + '">' + (ed ? "Done editing" : "Edit") + "</button>" +
          '<button type="button" class="pn-chip' + (r.st === "drop" ? " on" : "") + '" aria-pressed="' + (r.st === "drop") + '" data-act="g-adrop" data-i="' + i + '">Drop</button></div></li>';
      }).join("") + "</ol>" +
      (au.list.length > (au.show || 50) ? '<button type="button" class="pn-btn" data-act="g-amore">Show ' + Math.min(50, au.list.length - (au.show || 50)) + " more of " + au.list.length + "</button>" : "") +
      (au.list.length ? '<button type="button" class="pn-btn pc-danger" data-act="g-aclear">Clear this review</button>' : '<p class="pn-mut">Nothing to review yet.</p>') + "</div>", au.err ? "#qgRErr" : null);
    var r = host.root(); if (!r) return;
    var ps = r.querySelector("#qgPSub"), pm = r.querySelector("#qgPMod");
    ON(ps, "change", function () { au.psub = ps.value; au.pmod = ""; saveAuthor(); host.rerender(); });
    ON(pm, "change", function () { au.pmod = pm.value; saveAuthor(); host.rerender(); });
    Array.prototype.forEach.call(r.querySelectorAll(".qg-edq, .qg-edx"), function (ta) {
      ON(ta, "input", function () { var row = au.list[+ta.getAttribute("data-i")]; if (!row) return; if (ta.className.indexOf("qg-edq") >= 0) row.it.q = ta.value; else row.it.exp = ta.value; row.it.qg.ed = 1; saveAuthor(); });
    });
  }
  /* ---------- publish to students: one reviewed set into one or many subject modules ---------- */
  function targetLabel(host, t) {
    var sub = null; try { (host.subjectsOf(au.exam === "neet-ss" ? "neet-ss" : au.exam === "usmle" ? "usmle" : "neet-pg") || []).forEach(function (x) { if (x.id === t.subject) sub = x; }); } catch (e) {}
    return t.title ? (sub ? plain(sub.name) + " · " : "") + t.title : t.subject + " / " + t.module;
  }
  function publishHtml(host, esc, ok) {
    var subs = subjectsFor(host), ps = au.psub || au.subject || "", ix = ps ? host.ix()[ps] : null;
    if (ps && !ix) host.loadIndex(ps).then(function () { if (onTop("#qgRevView", host)) host.rerender(); });
    var mods = ix ? (ix.topics || []).filter(function (t) { return t.group !== "mixed"; }) : [];
    var opt = function (v, label, on) { return '<option value="' + esc(v) + '"' + (on ? " selected" : "") + ">" + esc(label) + "</option>"; };
    if (!au.targets.length && au.subject && au.module && !au.pub) {
      var t0 = null; (host.ix()[au.subject] && host.ix()[au.subject].topics || []).forEach(function (t) { if (t.id === au.module) t0 = t; });
      au.targets.push({ subject: au.subject, module: au.module, title: t0 ? plain(t0.title) : "" });
    }
    return '<section class="pn-panel qg-pub"><p><b>Publish to all students</b></p>' +
      '<p class="pn-mut pn-small">Live at once, no app update. The same questions can go into several subjects and modules.</p>' +
      (au.targets.length ? '<div class="pn-wrap" role="group" aria-label="Chosen modules">' + au.targets.map(function (t, i) {
        return '<button type="button" class="pn-chip on" data-act="g-atdel" data-i="' + i + '" aria-label="Remove ' + esc(targetLabel(host, t)) + '">' + esc(targetLabel(host, t)) + " ×</button>"; }).join("") + "</div>" : '<p class="pn-mut pn-small">Choose at least one module below.</p>') +
      '<label class="pc-lbl" for="qgPSub">Subject</label><select id="qgPSub" class="pc-in">' + opt("", "Choose a subject", !ps) + subs.map(function (s2) { return opt(s2.id, plain(s2.name) || s2.id, ps === s2.id); }).join("") + "</select>" +
      '<label class="pc-lbl" for="qgPMod">Module</label><select id="qgPMod" class="pc-in"' + (ps ? "" : " disabled") + ">" + opt("", ps ? "Choose a module" : "Choose a subject first", !au.pmod) + mods.map(function (t) { return opt(t.id, plain(t.title) || t.id, au.pmod === t.id); }).join("") + "</select>" +
      '<button type="button" class="pn-btn" data-act="g-atadd"' + (ps && au.pmod ? "" : " disabled") + ">Add this module</button>" +
      '<button type="button" class="pn-btn pri" data-act="g-apub"' + (ok && au.targets.length && !au.busy ? "" : " disabled") + ">Publish " + ok + " to " + au.targets.length + " module" + (au.targets.length === 1 ? "" : "s") + "</button>" +
      (au.pub ? '<p class="pn-small" role="status">Published ' + au.pub.n + " questions to " + au.pub.targets.length + " module" + (au.pub.targets.length === 1 ? "" : "s") + '. <button type="button" class="pn-chip" data-act="g-aundo">Take them down</button></p>' : "") + "</section>";
  }
  function publish(host) {
    var items = approved(au.list);
    if (!items.length || !au.targets.length) return;
    if (G.confirm && !G.confirm("Publish " + items.length + " questions to " + au.targets.length + " module(s)? Every student sees them at once.")) return;
    au.err = ""; au.busy = "Publishing…"; host.rerender();
    call({ op: "publish", targets: au.targets.map(function (t) { return { subject: t.subject, module: t.module }; }), items: items }, 60000).then(function (r) {
      au.busy = "";
      if (r.status !== 200) { au.err = r.json && r.json.reason === "module-full" ? "A module would pass 300 added questions." : msgOf(codeOf(r.status, r.json)); saveAuthor(); return host.rerender(); }
      au.pub = { batch: r.json.batch, n: r.json.n, targets: au.targets.slice() };
      au.list = au.list.filter(function (x) { return x.st !== "ok"; });
      saveAuthor(); host.rerender(); host.toast(r.json.n + " questions are live.");
    });
  }
  function unpublish(host) {
    if (!au.pub) return;
    if (G.confirm && !G.confirm("Take this batch down from every module it reached?")) return;
    au.busy = "Taking down…"; host.rerender();
    call({ op: "unpublish", batch: au.pub.batch, targets: au.pub.targets.map(function (t) { return { subject: t.subject, module: t.module }; }) }, 60000).then(function (r) {
      au.busy = "";
      if (r.status !== 200) { au.err = msgOf(codeOf(r.status, r.json)); saveAuthor(); return host.rerender(); }
      au.pub = null; saveAuthor(); host.rerender(); host.toast("Taken down.");
    });
  }
  function stage(host) {
    var items = approved(au.list);
    if (!items.length) return;
    au.err = ""; au.busy = "Staging…";
    call({ op: "stage", title: au.module || au.newName, exam: au.exam, subject: au.subject, module: au.module || slug(au.newName), items: items }, 60000).then(function (r) {
      au.busy = "";
      if (r.status !== 200) { au.err = msgOf(codeOf(r.status, r.json)); saveAuthor(); return host.rerender(); }
      au.stage = { id: r.json.stageId, cmd: r.json.cmd, n: r.json.n };
      au.list = au.list.filter(function (x) { return x.st !== "ok"; });
      saveAuthor(); host.back(); host.toast(r.json.n + " questions staged.");
    });
  }

  /* ================= events ================= */
  function act(a, el, host) {
    var v = el && el.getAttribute("data-v"), i = el ? +el.getAttribute("data-i") : -1;
    if (a === "g-new") { if (!canCreate()) return host.toast(msgOf("off")); return openCreate(host); }
    if (a === "g-src") { cs.kind = v === "notes" || v === "pdf" ? v : "topic"; cs.err = ""; return host.rerender(); }
    if (a === "g-count") { cs.count = +v || 10; return host.rerender(); }
    if (a === "g-diff") { cs.diff = diffOf(v)[0]; return host.rerender(); }
    if (a === "g-exam") { cs.exam = v; return host.rerender(); }
    if (a === "g-own") { cs.own = !cs.own; if (cs.own && /^Confirm/.test(cs.err)) cs.err = ""; return host.rerender(); }
    if (a === "g-pick") { var f = host.root() && host.root().querySelector("#qgFile"); if (f) f.click(); return; }
    if (a === "g-adv" && cs.pdf) {
      cs.adv = !cs.adv;
      if (cs.adv) { var w0 = winNow(); if (w0.sel && !w0.multi) cs.spec = SR().windowSpec(w0.from, w0.to); }
      else { var r0 = SR().selFromSpec(cs.spec, cs.pdf.pages, PAGE_CAP); if (r0.sel && r0.sel.length) { cs.pgFrom = String(r0.sel[0]); cs.pgTo = String(r0.sel[r0.sel.length - 1]); cs.spec = SR().windowSpec(r0.sel[0], r0.sel[r0.sel.length - 1]); } }
      host.rerender();
      return;
    }
    if (a === "g-fix" && cs.pdf) { var w1 = winNow(); if (w1.fix) applyWindow(host, w1.fix.from, w1.fix.to); return; }
    if (a === "g-swap" && cs.pdf) { var w2 = winNow(); if (w2.swap) applyWindow(host, w2.swap.from, w2.swap.to); return; }
    if (a === "g-step" && cs.pdf) {
      var d = +(el && el.getAttribute("data-v")) || 0, w3 = winNow(), total = cs.pdf.pages;
      if (!w3.sel) return;
      var size = w3.multi ? w3.count : (w3.to - w3.from + 1), from;
      if (d === PAGE_CAP) { var nx = SR().nextWindow(w3.sel, total, PAGE_CAP); if (!nx) { cs.err = ""; host.rerender(); return host.toast("That is the end of the book."); } from = nx.from; }
      else from = Math.min(Math.max(1, w3.from + d), Math.max(1, total - size + 1));
      applyWindow(host, from, Math.min(total, from + size - 1));
      return;
    }
    if (a === "g-next" && cs.pdf) {
      var S = SR(), h = histFor(S.pdfHistKey(cs.pdf.name, cs.pdf.bytes)), all = [];
      h.windows.forEach(function (ww) { for (var p = ww[0]; p <= ww[1]; p++) all.push(p); });
      (winNow().sel || []).forEach(function (p) { if (all.indexOf(p) < 0) all.push(p); });
      var nx2 = S.nextWindow(all, cs.pdf.pages, PAGE_CAP);
      if (!nx2) return host.toast("That is the whole book.");
      applyWindow(host, nx2.from, nx2.to);
      return;
    }
    if (a === "g-go") return go(host);
    if (a === "g-stop") { if (job && !job.done) { job.stopReq = true; host.rerender(); } return; }
    if (a === "g-retry") { resume(host); return; }
    if (a === "g-done") return host.back();
    if (a === "g-prac" || a === "g-open") {
      var d = el.getAttribute("data-d");
      if (onTop("#qgProgView", host)) { host.back(); }
      if (!G.PREP_C) return;
      return G.PREP_C.act(a === "g-prac" ? "c-prac" : "c-open", el, host);
    }
    if (a === "g-more") return more(host, el.getAttribute("data-d"));
    // owner
    if (a === "g-author") return openAuthor(host);
    if (!au) return;
    if (a === "g-aexam") { au.exam = v; au.subject = ""; au.module = ""; saveAuthor(); return host.rerender(); }
    if (a === "g-adiff") { au.diff = diffOf(v)[0]; saveAuthor(); return host.rerender(); }
    if (a === "g-arun") return authorRun(host);
    if (a === "g-apoll") return poll(host);
    if (a === "g-areview") { au.err = ""; return host.push(function () { renderReview(host); }); }
    if (a === "g-aok" && au.list[i]) { au.list[i].st = au.list[i].st === "ok" ? "" : "ok"; saveAuthor(); return host.rerender(); }
    if (a === "g-adrop" && au.list[i]) { au.list[i].st = au.list[i].st === "drop" ? "" : "drop"; saveAuthor(); return host.rerender(); }
    if (a === "g-aedit" && au.list[i]) { au.list[i].ed = !au.list[i].ed; saveAuthor(); return host.rerender(); }
    if (a === "g-abulk") { var n = bulkApprove(au.list); saveAuthor(); host.rerender(); return host.toast(n + " approved."); }
    if (a === "g-astage") return stage(host);
    if (a === "g-asrc") { au.kind = v === "notes" || v === "pdf" ? v : "topic"; au.err = ""; pdfUi = "#qgAuthView"; saveAuthor(); return host.rerender(); }
    if (a === "g-atadd") {
      var psb = au.psub || au.subject, ixp = host.ix()[psb], tp = null; ((ixp && ixp.topics) || []).forEach(function (t) { if (t.id === au.pmod) tp = t; });
      if (!psb || !au.pmod) return;
      if (!au.targets.some(function (t) { return t.subject === psb && t.module === au.pmod; })) {
        if (au.targets.length >= 12) return host.toast("Up to 12 modules in one go.");
        au.targets.push({ subject: psb, module: au.pmod, title: tp ? plain(tp.title) : "" });
      }
      au.pmod = ""; saveAuthor(); return host.rerender();
    }
    if (a === "g-atdel") { au.targets.splice(i, 1); saveAuthor(); return host.rerender(); }
    if (a === "g-apub") return publish(host);
    if (a === "g-aundo") return unpublish(host);
    if (a === "g-amore") { au.show = (au.show || 50) + 50; return host.rerender(); }
    if (a === "g-aclear") { if (G.confirm && !G.confirm("Clear every question in this review? Staged questions are kept on the server.")) return; au.list = []; au.mod = null; saveAuthor(); return host.back(); }
    if (a === "g-acopy") { var c = au.stage && au.stage.cmd; try { G.navigator.clipboard.writeText(c).then(function () { host.toast("Copied."); }, function () { host.toast("Select the command and copy it."); }); } catch (e) { host.toast("Select the command and copy it."); } return; }
  }

  G.PREP_QGEN = { act: act, refresh: refresh, canCreate: canCreate, isOwner: isOwner, sub: sub, report: report, provLine: provLine, more: more,
    status: function () { return status; }, _pure: PURE, _cs: cs, _job: function () { return job; }, _au: function () { return au; },
    _setStatus: function (s) { status = s; statusAt = Date.now(); } };
})(typeof window !== "undefined" ? window : this);
