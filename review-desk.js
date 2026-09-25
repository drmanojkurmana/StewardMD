/* StewardMD - Clinical review desk (window.SMD_REVIEW).
 *
 * Everything clinical in the app that was compiled with AI assistance (Knowledge Library protocols,
 * specialty kits, consent templates) carries review.status "ai_drafted" and says "pending clinical
 * review" until a named clinician reviews it. This desk is where a reviewer does that: list, read,
 * decide (approve, approve with minor edits, needs changes), comment, then export the decisions as one
 * signed-by-name JSON file through the share sheet. The owner applies an export with
 *   node scripts/apply-reviews.mjs <file.json>
 * which sets review.status "reviewed" and the reviewer on each approved item and writes "needs
 * changes" feedback to vault/handoff/review-feedback.md. Nothing is uploaded from here (wave 2 syncs it).
 * Decisions are kept on this phone (content ids and comments only, never patient data).
 * Flag: smd_review_desk (default ON, reachable from Home > Add Tool > Review content). Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var LS_KEY = "smd_review_decisions";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }
  var DECISIONS = [["approve", "Approve as it is"], ["approve-minor", "Approve after the minor edits I describe"], ["changes", "Needs changes before use"]];
  var KINDS = [["protocol", "Protocols"], ["kit", "Specialty kits"], ["consent", "Consent templates"]];

  function loadDecisions() { try { var o = JSON.parse((G.localStorage && G.localStorage.getItem(LS_KEY)) || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
  function saveDecisions(o) { try { G.localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {} }
  /** Pure: the export file for a set of decisions. */
  function buildExport(dec, reviewer, now) {
    var list = Object.keys(dec).sort().map(function (k) { var d = dec[k], p = k.split(":"); return { kind: p[0], id: p.slice(1).join(":"), decision: d.decision, comment: d.comment || "", at: d.at }; });
    return { schema: 1, app: "StewardMD review desk", exportedAt: now || new Date().toISOString(), reviewer: { name: reviewer.name || "", regNo: reviewer.regNo || "", speciality: reviewer.speciality || "", verified: !!reviewer.verified }, decisions: list };
  }

  var S = { kind: "protocol", sel: "", items: { protocol: null, kit: null, consent: null }, reviewer: { name: "", regNo: "", speciality: "", verified: false }, q: "" };
  function loadItems(kind) {
    if (S.items[kind]) return Promise.resolve(S.items[kind]);
    var p = kind === "protocol" ? (G.SMD_KBPROTO && G.SMD_KBPROTO.loadIndex ? G.SMD_KBPROTO.loadIndex().then(function (idx) { return (idx.protocols || []).map(function (x) { return { id: x.id, title: x.title, sub: (G.SMD_KBPROTO.subjectLabel ? G.SMD_KBPROTO.subjectLabel(x.subject) : x.subject), status: x.status }; }); }) : Promise.resolve([]))
      : kind === "kit" ? (G.SMD_KITS && G.SMD_KITS.loadKits ? G.SMD_KITS.loadKits().then(function (b) { return (b.kits || []).map(function (k) { return { id: k.id, title: k.label, sub: (k.sections || []).length + " sections, " + (k.tools || []).length + " tools", status: (k.review || {}).status }; }); }) : Promise.resolve([]))
      : (G.SMD_DOCS && G.SMD_DOCS.load ? G.SMD_DOCS.load().then(function (b) { return (b.consent || []).map(function (c) { return { id: c.id, title: c.title.en, sub: "English, Telugu, Hindi", status: (c.review || {}).status }; }); }) : Promise.resolve([]));
    return p.then(function (list) { S.items[kind] = list; return list; }, function () { return []; });
  }
  function reviewer() {
    var r = S.reviewer;
    if (!r.name) { try { var p = G.SMD_ACCOUNT && G.SMD_ACCOUNT.profile && G.SMD_ACCOUNT.profile(); r.name = (p && (p.name || p.displayName)) || ""; } catch (e) {} }
    return r;
  }
  function statusPill(st) { return st === "reviewed" || st === "approved" ? '<span class="rv-pill ok">' + (st === "approved" ? "Approved" : "Reviewed") + "</span>" : '<span class="rv-pill">Pending review</span>'; }
  function decPill(d) { if (!d) return ""; var lab = { approve: "You approved", "approve-minor": "You approved with edits", changes: "You asked for changes" }[d.decision]; return '<span class="rv-pill mine">' + esc(lab) + "</span>"; }

  function render() {
    var el = D && D.getElementById("smdReview"); if (!el) return;
    var body = el.querySelector(".kit-sheet-body"), top = body.scrollTop, dec = loadDecisions(), n = Object.keys(dec).length, html;
    var tabs = '<div class="kit-row" role="tablist">' + KINDS.map(function (k) { return '<button type="button" role="tab" class="kit-seg' + (S.kind === k[0] ? " on" : "") + '" data-rv-act="kind:' + k[0] + '" aria-selected="' + (S.kind === k[0]) + '">' + k[1] + "</button>"; }).join("") + "</div>";
    var list = S.items[S.kind];
    if (!list) { loadItems(S.kind).then(render); html = tabs + '<p class="kit-muted">Loading…</p>'; }
    else if (S.sel) {
      var it = list.filter(function (x) { return x.id === S.sel; })[0] || { id: S.sel, title: S.sel }, d = dec[S.kind + ":" + S.sel] || {}, r = reviewer();
      html = '<button type="button" class="kit-link" data-rv-act="back">' + ms("arrow_back") + "Back to the list</button><h2 class=\"dl-h\">" + esc(it.title) + "</h2>" + statusPill(it.status) +
        '<div class="kit-row"><button type="button" class="kit-pill" data-rv-act="read">' + ms("menu_book") + "Read it</button></div>" +
        '<div class="kit-grid"><label class="kit-field wide" for="rv_dec"><span class="kit-fl">Your decision</span><select id="rv_dec" class="kit-inp"><option value=""></option>' +
        DECISIONS.map(function (x) { return '<option value="' + x[0] + '"' + (d.decision === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>" +
        '<label class="kit-field wide" for="rv_comment"><span class="kit-fl">Comments (which section, what to change, with your source)</span><textarea id="rv_comment" rows="5" class="kit-inp">' + esc(d.comment || "") + "</textarea></label>" +
        '<label class="kit-field" for="rv_name"><span class="kit-fl">Reviewer name</span><input id="rv_name" class="kit-inp" value="' + esc(r.name) + '"></label>' +
        '<label class="kit-field" for="rv_reg"><span class="kit-fl">Registration number' + (r.verified ? " (verified)" : "") + '</span><input id="rv_reg" class="kit-inp" value="' + esc(r.regNo) + '"' + (r.verified ? " readonly" : "") + "></label></div>" +
        '<div class="kit-row"><button type="button" class="kit-add" data-rv-act="save">' + ms("task_alt") + "Save decision</button>" + (d.decision ? '<button type="button" class="kit-clear" data-rv-act="undo">Remove my decision</button>' : "") + "</div>";
    } else {
      var q = S.q.toLowerCase(), shown = list.filter(function (x) { return !q || (x.title + " " + x.id).toLowerCase().indexOf(q) >= 0; });
      html = '<p class="kit-muted">Read each item, then approve it or say what needs to change. Your decisions stay on this phone until you export them.</p>' +
        '<div class="kit-row"><button type="button" class="kit-add" data-rv-act="export"' + (n ? "" : " disabled") + ">" + ms("ios_share") + "Export " + n + " decision" + (n === 1 ? "" : "s") + "</button>" +
        (G.SMD_SHARE && G.SMD_SHARE.on && G.SMD_SHARE.on() ? '<button type="button" class="kit-pill" data-rv-act="sync"' + (n ? "" : " disabled") + ">" + ms("cloud_upload") + "Send to StewardMD</button>" : "") + "</div>" + tabs +
        '<label class="kit-field wide" for="rv_q"><span class="kit-fl">Search</span><input id="rv_q" type="search" class="kit-inp" value="' + esc(S.q) + '" autocomplete="off"></label>' +
        '<p class="kit-muted">' + shown.length + " of " + list.length + "</p><div class=\"rv-list\">" + shown.map(function (x) {
          return '<button type="button" class="rv-row" data-rv-act="sel:' + esc(x.id) + '"><span class="rv-t">' + esc(x.title) + '</span><span class="rv-s">' + esc(x.sub || "") + "</span><span>" + statusPill(x.status) + decPill(dec[S.kind + ":" + x.id]) + "</span></button>";
        }).join("") + "</div>";
    }
    body.innerHTML = '<div class="kit dl">' + html + "</div>"; body.scrollTop = top;
  }
  function flagOn() {
    try { var q = (G.location.search.match(/[?&]review=([^&]+)/) || [])[1]; if (q === "1" || q === "true") return true; if (q === "0" || q === "false") return false; return G.localStorage.getItem("smd_review_desk") !== "0"; } catch (e) { return true; }
  }
  function open() {
    if (!D || !flagOn()) return;
    var el = D.getElementById("smdReview");
    if (!el) {
      el = D.createElement("div"); el.id = "smdReview"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Clinical review");
      el.innerHTML = '<div class="kit-sheet"><header class="kit-sheet-top"><button type="button" class="kit-x" data-rv-act="close" aria-label="Close review desk">' + ms("close") + '</button><h1>Clinical review</h1><span></span></header><div class="kit-sheet-body"></div></div>';
      D.body.appendChild(el);
    }
    el.classList.add("on"); D.documentElement.classList.add("kit-lock");
    if (G.SMD_RX && G.SMD_RX.verifiedInfo) G.SMD_RX.verifiedInfo().then(function (v) { if (v && v.verified && v.regNo) { S.reviewer.regNo = v.regNo; S.reviewer.verified = true; } }, function () {});
    render();
  }
  function close() { var el = D && D.getElementById("smdReview"); if (el) el.classList.remove("on"); if (!(D.getElementById("smdKit") || {}).classList || !D.getElementById("smdKit").classList.contains("on")) D.documentElement.classList.remove("kit-lock"); }
  function share(text, name) {
    var C = G.Capacitor, P = (C && C.Plugins) || {}, native = false;
    try { native = !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.isNative)); } catch (e) {}
    if (native && P.Filesystem && P.Share) {
      P.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" }).then(function (r) { return P.Share.share({ title: "StewardMD review", url: r.uri, dialogTitle: "Send your review" }); }).catch(function () { toast("Could not open the share sheet."); });
      return;
    }
    try { G.navigator.clipboard.writeText(text).then(function () { toast("Review copied. Paste it into an email to the StewardMD team."); }, function () { toast("Copy is blocked here."); }); } catch (e) { toast("Copy is blocked here."); }
  }
  function onClick(e) {
    var b = e.target && e.target.closest && e.target.closest("[data-rv-act]"); if (!b || !b.closest("#smdReview")) return;
    var act = b.getAttribute("data-rv-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { close(); return; }
    if (cmd === "kind") { S.kind = arg; S.sel = ""; render(); return; }
    if (cmd === "sel") { S.sel = arg; render(); D.querySelector("#smdReview .kit-sheet-body").scrollTop = 0; return; }
    if (cmd === "back") { S.sel = ""; render(); return; }
    if (cmd === "read") {
      D.documentElement.classList.add("kit-lock");   // closing a kit drops it; the Library needs it to sit on top
      if (S.kind === "protocol" && G.SMD_KBPROTO) G.SMD_KBPROTO.open({ id: S.sel });
      else if (S.kind === "kit" && G.SMD_KITS) G.SMD_KITS.open({ kit: S.sel });
      else if (S.kind === "consent" && G.SMD_DOCS) G.SMD_DOCS.open({ type: "consent", consentId: S.sel });
      return;
    }
    if (cmd === "save") {
      var dv = D.getElementById("rv_dec").value, cm = D.getElementById("rv_comment").value.trim();
      S.reviewer.name = D.getElementById("rv_name").value.trim(); if (!S.reviewer.verified) S.reviewer.regNo = D.getElementById("rv_reg").value.trim();
      if (!dv) { toast("Choose a decision."); return; }
      if (dv !== "approve" && !cm) { toast("Say what needs to change."); return; }
      if (!S.reviewer.name) { toast("Add your name as the reviewer."); return; }
      var dec = loadDecisions(); dec[S.kind + ":" + S.sel] = { decision: dv, comment: cm, at: new Date().toISOString() }; saveDecisions(dec);
      toast("Decision saved on this phone."); S.sel = ""; render(); return;
    }
    if (cmd === "undo") { var d2 = loadDecisions(); delete d2[S.kind + ":" + S.sel]; saveDecisions(d2); render(); return; }
    if (cmd === "sync" && G.SMD_SHARE) {
      var sx = buildExport(loadDecisions(), reviewer());
      G.SMD_SHARE.sendReviews(sx.decisions).then(function (r) { toast(r.status === 200 ? "Sent " + r.body.count + " decision" + (r.body.count === 1 ? "" : "s") + " to StewardMD." : G.SMD_SHARE.errText(r.body.error)); });
      return;
    }
    if (cmd === "export") {
      var ex = buildExport(loadDecisions(), reviewer());
      if (!ex.reviewer.name) { toast("Open an item and add your name first."); return; }
      share(JSON.stringify(ex, null, 2), "stewardmd-review-" + ex.exportedAt.slice(0, 10) + ".json");
    }
  }
  function onInput(e) { var el = e.target; if (el && el.id === "rv_q") { S.q = el.value; var pos = el.selectionStart; render(); var q = D.getElementById("rv_q"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } } }
  if (D && D.addEventListener && !G.__smdReviewWired) { G.__smdReviewWired = true; D.addEventListener("click", onClick, false); D.addEventListener("input", onInput, false); }

  var API = { open: open, close: close, _buildExport: buildExport, DECISIONS: DECISIONS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_REVIEW = API;
})(typeof window !== "undefined" ? window : globalThis);
