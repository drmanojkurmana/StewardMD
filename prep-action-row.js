/* Shared Report / Share / Bookmark action row + Report-reason sheet + ID metadata chips.
 * One component for lessons, pearls, MCQs and KB items (window.PREP_ACTION; Node: module.exports).
 * Report payload: { itemId, itemType, subject, module, reason, text, appVersion } posted to
 * /api/prep/flag (legacy fields itemId/subject/module/reason unchanged, so old clients keep working).
 * Offline: reports queue in localStorage and retry on the next online event or flushQueue() call. */
(function (root) {
  "use strict";
  var REASONS = [
    ["wrong-fact", "Wrong or outdated fact"],
    ["wrong-answer", "Wrong answer or explanation"],
    ["unclear", "Unclear or confusing"],
    ["image-problem", "Image or diagram problem"],
    ["typo", "Typo or formatting"],
    ["offensive", "Offensive or inappropriate"],
    ["other", "Other"]
  ];
  var LEGACY = { "wrong-key": "wrong-answer", outdated: "wrong-fact" };
  var MAX_TEXT = 500, QUEUE_KEY = "smd-report-queue-v1";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function reasonLabel(code) { for (var i = 0; i < REASONS.length; i++) if (REASONS[i][0] === code) return REASONS[i][1]; return ""; }
  function validReason(code) { return !!reasonLabel(code) || !!LEGACY[code]; }
  function validate(reason, text) {
    var t = String(text || "").trim();
    if (!validReason(reason)) return { ok: false, error: "Choose what is wrong." };
    if (t.length > MAX_TEXT) return { ok: false, error: "Keep it under " + MAX_TEXT + " characters." };
    if (reason === "other" && !t) return { ok: false, error: "A short note is needed for Other." };
    return { ok: true, text: t };
  }
  function buildPayload(item, reason, text, appVersion) {
    item = item || {};
    var v = validate(reason, text);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, payload: {
      itemId: String(item.itemId || item.id || ""), itemType: String(item.itemType || item.type || "question"),
      subject: String(item.subject || ""), module: String(item.module || ""),
      reason: LEGACY[reason] ? reason : reason, text: v.text,
      appVersion: String(appVersion || (typeof window !== "undefined" && window.SMD_APP_VERSION) || "web")
    } };
  }
  function readQueue(store) { try { var q = JSON.parse((store || localStorage).getItem(QUEUE_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function writeQueue(q, store) { try { (store || localStorage).setItem(QUEUE_KEY, JSON.stringify(q.slice(-50))); } catch (e) {} }
  function queueReport(payload, store) { var q = readQueue(store); q.push({ payload: payload, at: Date.now() }); writeQueue(q, store); return q.length; }
  /* The existing report path needs a signed-in user (functions/api/prep/flag.js identify());
   * attach the same Bearer token prep.js sendReport uses when the auth bridge is present. */
  function authHeaders(fetchFn) {
    if (fetchFn) return Promise.resolve({ "Content-Type": "application/json" });
    try {
      var u = typeof window !== "undefined" && window.SMD_AUTH && window.SMD_AUTH.currentUser;
      if (u && u.getIdToken) return Promise.resolve(u.getIdToken()).then(function (tok) {
        var h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok; return h;
      }, function () { return { "Content-Type": "application/json" }; });
    } catch (e) {}
    return Promise.resolve({ "Content-Type": "application/json" });
  }
  function postFlag(payload, fetchFn) {
    var f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
    if (!f) return Promise.reject(new Error("no fetch"));
    return authHeaders(fetchFn).then(function (h) { return f("/api/prep/flag", { method: "POST", headers: h, body: JSON.stringify(payload) }); });
  }
  /* send(payload, fetchFn, store) -> "sent" | "queued". Never throws; offline keeps the report. */
  function send(payload, fetchFn, store) {
    var f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
    if (!f || (typeof navigator !== "undefined" && navigator.onLine === false)) { queueReport(payload, store); return Promise.resolve("queued"); }
    return postFlag(payload, fetchFn)
      .then(function (r) { if (r && r.ok === false && r.status >= 400 && r.status !== 401 && r.status !== 429) { queueReport(payload, store); return "queued"; } return "sent"; },
        function () { queueReport(payload, store); return "queued"; });
  }
  function flushQueue(fetchFn, store) {
    var q = readQueue(store); if (!q.length) return Promise.resolve(0);
    var f = fetchFn || (typeof fetch !== "undefined" ? fetch : null); if (!f) return Promise.resolve(0);
    var sent = 0, left = [];
    return q.reduce(function (p, entry) { return p.then(function () {
      return postFlag(entry.payload, fetchFn)
        .then(function (r) { if (!r || r.ok !== false) sent++; else left.push(entry); }, function () { left.push(entry); });
    }); }, Promise.resolve()).then(function () { writeQueue(left, store); return sent; });
  }
  var ICONS = {
    report: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 21V4"/><path d="M4 5h11l-2 4 2 4H4"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    bookmark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    bookmarkOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>'
  };
  /* meta: [{label, value}] rendered as one tappable copy chip each, grouped on a single metadata line. */
  function metaHtml(meta) {
    if (!meta || !meta.length) return "";
    return '<p class="pn-act-meta">' + meta.filter(function (m) { return m && m.value; }).map(function (m) {
      return '<button type="button" class="pn-act-chip" data-copy-id="' + esc(m.value) + '" data-pearl-copy="' + esc(m.value) + '" aria-label="Copy ' + esc(m.label || "ID") + " " + esc(m.value) + '">' +
        '<span class="pn-act-chip-k">' + esc(m.label || "ID") + '</span> <span class="pn-act-chip-v">' + esc(m.value) + '</span></button>';
    }).join("") + '<span class="pn-act-copied" role="status" aria-live="polite"></span></p>';
  }
  function actionRowHtml(opts) {
    opts = opts || {};
    var bm = !!opts.bookmarked;
    /* Pearl rows speak data-pearl-act only (prep-pearl.js owns them); other surfaces speak the
     * generic data-action-* events from bind(), so one click is never handled twice. */
    var ra = opts.pearl ? ' data-pearl-act="report"' : " data-action-report";
    var sa = opts.pearl ? ' data-pearl-act="share"' : " data-action-share";
    var ba = opts.pearl ? ' data-pearl-act="bookmark"' : " data-action-bookmark";
    return '<div class="pn-act-row" role="group" aria-label="Item actions">' +
      '<button type="button" class="pn-act-btn"' + ra + ">" + ICONS.report + "<span>Report</span></button>" +
      (opts.shareId ? '<button type="button" class="pn-act-btn" data-act="id-share" data-v="' + esc(opts.shareId) + '">' + ICONS.share + "<span>Share</span></button>"
        : '<button type="button" class="pn-act-btn"' + sa + ">" + ICONS.share + "<span>Share</span></button>") +
      '<button type="button" class="pn-act-btn' + (bm ? " on" : "") + '"' + ba + ' aria-pressed="' + bm + '">' + (bm ? ICONS.bookmarkOn : ICONS.bookmark) + "<span>" + (bm ? "Saved" : "Bookmark") + "</span></button></div>" + metaHtml(opts.meta);
  }
  function reportSheetHtml(item) {
    item = item || {};
    return '<div class="pn-rpt-sheet" role="dialog" aria-modal="true" aria-label="Report this item"><div class="pn-rpt-card">' +
      '<h2 class="pn-rpt-t">What is wrong?</h2><p class="pn-rpt-sub">Your report goes to the StewardMD team with the item ID only.</p>' +
      '<form class="pn-rpt-form" data-item-id="' + esc(item.itemId || item.id || "") + '" data-item-type="' + esc(item.itemType || item.type || "question") + '" data-subject="' + esc(item.subject || "") + '" data-module="' + esc(item.module || "") + '">' +
      REASONS.map(function (r, i) { return '<label class="pn-rpt-opt"><input type="radio" name="pn-rpt-reason" value="' + r[0] + '"' + (i === 0 ? "" : "") + '><span>' + esc(r[1]) + "</span></label>"; }).join("") +
      '<label class="pn-rpt-note-t" for="pnRptText">Add a note (optional)</label>' +
      '<textarea id="pnRptText" name="pn-rpt-text" class="pn-rpt-text" rows="3" maxlength="' + MAX_TEXT + '" placeholder="For example, the dose on line 2…" aria-describedby="pnRptCount pnRptErr"></textarea>' +
      '<p class="pn-rpt-count" id="pnRptCount" aria-live="polite">0 / ' + MAX_TEXT + '</p><p class="pn-rpt-err" id="pnRptErr" role="alert" hidden></p>' +
      '<div class="pn-rpt-actions"><button type="button" class="pn-act-btn pn-rpt-cancel" data-rpt-cancel>Cancel</button>' +
      '<button type="submit" class="pn-rpt-send">Send report</button></div></form>' +
      '<div class="pn-rpt-done" hidden><p class="pn-rpt-ok" role="status">Thank you. Report received.</p>' +
      '<button type="button" class="pn-act-btn" data-rpt-close>Done</button></div></div></div>';
  }
  var lastTrigger = null;
  function closeSheet(doc) { var old = doc.querySelector(".pn-rpt-sheet"); if (old && old.parentNode) old.parentNode.removeChild(old); if (lastTrigger && lastTrigger.focus) { try { lastTrigger.focus(); } catch (e) {} } lastTrigger = null; }
  function openSheet(doc, item, onSend) {
    lastTrigger = doc.activeElement || null; closeSheet(doc);
    var w = doc.createElement("div"); w.innerHTML = reportSheetHtml(item);
    var el = w.firstChild; doc.body.appendChild(el);
    var form = el.querySelector(".pn-rpt-form"), text = el.querySelector(".pn-rpt-text"), count = el.querySelector(".pn-rpt-count"), err = el.querySelector(".pn-rpt-err");
    text.addEventListener("input", function () { count.textContent = text.value.length + " / " + MAX_TEXT; });
    el.querySelector("[data-rpt-cancel]").addEventListener("click", function () { closeSheet(doc); });
    var done = function () { form.hidden = true; el.querySelector(".pn-rpt-done").hidden = false; var b = el.querySelector("[data-rpt-close]"); b.addEventListener("click", function () { closeSheet(doc); }); if (b.focus) b.focus(); };
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var picked = form.querySelector("input[name=pn-rpt-reason]:checked");
      var built = buildPayload({ itemId: form.getAttribute("data-item-id"), itemType: form.getAttribute("data-item-type"), subject: form.getAttribute("data-subject"), module: form.getAttribute("data-module") }, picked ? picked.value : "", text.value);
      if (!built.ok) { err.textContent = built.error; err.hidden = false; return; }
      err.hidden = true;
      var sendBtn = form.querySelector(".pn-rpt-send"); sendBtn.disabled = true; sendBtn.setAttribute("aria-busy", "true"); sendBtn.textContent = "Sending…";
      var finish = function () { done(); if (onSend) onSend(built.payload); };
      if (onSend && onSend.handlesSend) { finish(); return; }
      send(built.payload).then(finish, finish);
    });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll("button, input, textarea"), list = [];
      for (var i = 0; i < f.length; i++) if (!f[i].disabled && !f[i].hidden) list.push(f[i]);
      if (!list.length) return;
      var firstEl = list[0], lastEl = list[list.length - 1];
      if (e.shiftKey && doc.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && doc.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    });
    var first = el.querySelector("input[name=pn-rpt-reason]"); if (first && first.focus) first.focus();
    return el;
  }
  function bind(doc) {
    doc.addEventListener("click", function (e) {
      var t = e.target, chip = t.closest && t.closest("[data-copy-id]");
      if (chip) {
        var txt = chip.getAttribute("data-copy-id"), live = chip.parentNode && chip.parentNode.querySelector(".pn-act-copied");
        if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(txt);
        if (live) { live.textContent = "Copied"; setTimeout(function () { live.textContent = ""; }, 1500); }
        return;
      }
      var rep = t.closest && t.closest("[data-action-report]");
      if (rep) doc.dispatchEvent(new CustomEvent("pn-report-open", { detail: { trigger: rep } }));
      var sh = t.closest && t.closest("[data-action-share]");
      if (sh) doc.dispatchEvent(new CustomEvent("pn-action-share", { detail: { trigger: sh } }));
      var bk = t.closest && t.closest("[data-action-bookmark]");
      if (bk) { var on = bk.getAttribute("aria-pressed") === "true"; bk.setAttribute("aria-pressed", String(!on)); bk.classList.toggle("on", !on); var lab = bk.querySelector("span"); if (lab) lab.textContent = !on ? "Saved" : "Bookmark"; doc.dispatchEvent(new CustomEvent("pn-action-bookmark", { detail: { trigger: bk, bookmarked: !on } })); }
    });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(doc); });
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("online", function () { flushQueue(); });
  }
  if (typeof document !== "undefined") bind(document);
  var api = { REASONS: REASONS, LEGACY: LEGACY, MAX_TEXT: MAX_TEXT, QUEUE_KEY: QUEUE_KEY, reasonLabel: reasonLabel, validReason: validReason, validate: validate, buildPayload: buildPayload, readQueue: readQueue, queueReport: queueReport, send: send, flushQueue: flushQueue, actionRowHtml: actionRowHtml, metaHtml: metaHtml, reportSheetHtml: reportSheetHtml, openSheet: openSheet, closeSheet: closeSheet };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PREP_ACTION = api;
})(typeof window !== "undefined" ? window : globalThis);
