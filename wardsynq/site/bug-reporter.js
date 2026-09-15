/* wardsynq/site/bug-reporter.js - On-spot bug reporting widget for WardSynQ.
 *
 * Self-contained ES5 script. Injects a floating red "Report Bug" button on every page and tab.
 * Allows pointing to the exact element on screen where a bug occurs, collects runtime diagnostics
 * (view, route, active patient id and bed, console errors, DOM target) and sends the report to the
 * hospital's server (POST /api/queue/ward/bug-report, functions/_wardsynq/bug-reports.js), where the
 * hospital admin works through it (Admin Center > Bug reports) and removes it only once solved.
 *
 * THE DEVICE IS AN OUTBOX, NOT THE STORE. A report is kept in localStorage (wardsynq_bug_log) marked
 * unsent until the server confirms it with the server's own id. Unsent reports are retried on every
 * page load, when the connection comes back, and every minute while any are waiting (which covers
 * signing in). Reports saved here before this change carry no sent mark and are uploaded the same way,
 * once: the server treats the client report id as idempotent. Only SENT copies are ever trimmed or
 * cleared from this device. The toast says which of the two happened, never "sent" when it was not.
 *
 * The developer collector at http://127.0.0.1:4499/api/bug still gets a best-effort copy; the server
 * is the source of truth.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.__WSQ_BUG_REPORTER_INITIALIZED__) return;
  window.__WSQ_BUG_REPORTER_INITIALIZED__ = true;

  var G = window;
  var consoleBuffer = [];
  var MAX_BUFFER = 25;

  // ---- Capture console errors & unhandled exceptions --------------------------------------
  var origError = console.error;
  console.error = function () {
    try {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === "object") { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      });
      consoleBuffer.push({ type: "error", time: new Date().toISOString(), text: args.join(" ") });
      if (consoleBuffer.length > MAX_BUFFER) consoleBuffer.shift();
      updateBadge();
    } catch (e) {}
    if (origError) origError.apply(console, arguments);
  };

  G.addEventListener("error", function (ev) {
    try {
      consoleBuffer.push({
        type: "uncaught", time: new Date().toISOString(),
        text: (ev.message || "Error") + " at " + (ev.filename || "") + ":" + (ev.lineno || 0) + ":" + (ev.colno || 0),
        stack: ev.error && ev.error.stack ? String(ev.error.stack) : null
      });
      if (consoleBuffer.length > MAX_BUFFER) consoleBuffer.shift();
      updateBadge();
    } catch (e) {}
  });

  G.addEventListener("unhandledrejection", function (ev) {
    try {
      var reason = ev.reason;
      var text = (reason instanceof Error) ? (reason.stack || reason.message) : String(reason);
      consoleBuffer.push({ type: "unhandledrejection", time: new Date().toISOString(), text: text });
      if (consoleBuffer.length > MAX_BUFFER) consoleBuffer.shift();
      updateBadge();
    } catch (e) {}
  });

  // ---- Storage: the outbox ------------------------------------------------------------------
  var STORAGE_KEY = "wardsynq_bug_log";
  var MAX_SENT_KEPT = 50;   // sent copies only: the server holds those. Unsent reports are never trimmed.
  function getStoredBugs() {
    try { var l = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  }
  /** Writes the list, keeping every unsent report and the newest sent copies. False when the device refused. */
  function putStoredBugs(list) {
    var kept = [], sent = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].sent) { if (sent >= MAX_SENT_KEPT) continue; sent++; }
      kept.push(list[i]);
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(kept)); return true; } catch (e) { return false; }
  }
  function saveBug(bug) {
    var list = getStoredBugs();
    list.unshift(bug);
    return putStoredBugs(list);
  }
  /** Re-reads before writing, so a report another tab added meanwhile is not lost. */
  function updateBug(id, patch) {
    var list = getStoredBugs();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k]; }
    }
    putStoredBugs(list);
  }
  function unsentBugs() { return getStoredBugs().filter(function (b) { return b && !b.sent; }); }

  // ---- Which hospital and which credential ----------------------------------------------------
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function currentOrg() {
    try { if (G.WSQ && G.WSQ.state && G.WSQ.state.orgId) return String(G.WSQ.state.orgId); } catch (e) {}
    try { if (G.WARD && G.WARD._st && G.WARD._st.orgId) return String(G.WARD._st.orgId); } catch (e) {}
    try { if (G.SMD_HOSPITAL_AUTH && G.SMD_HOSPITAL_AUTH.currentOrg()) return String(G.SMD_HOSPITAL_AUTH.currentOrg()); } catch (e) {}
    return lsGet("smd_opd_hospital");
  }
  /* The same credential ward.js sends (hospital-auth.js decides when it is loaded): the staff session for this
   * hospital, else the StewardMD account. Pages without hospital-auth.js (opd.html) read the stored ones. */
  function authHeaders(orgId) {
    if (G.SMD_HOSPITAL_AUTH) return G.SMD_HOSPITAL_AUTH.headersFor(orgId);
    var tok = lsGet("smd_opd_staff_tok");
    if (tok) return Promise.resolve({ "Content-Type": "application/json", "X-Staff-Token": tok });
    var p = null;
    try { if (G.firebase && G.firebase.auth && G.firebase.auth().currentUser) p = G.firebase.auth().currentUser.getIdToken(); } catch (e) {}
    return Promise.resolve(p).then(function (t) { var h = { "Content-Type": "application/json" }; if (t) h.Authorization = "Bearer " + t; return h; }, function () { return { "Content-Type": "application/json" }; });
  }
  function signedIn(h) { return !!(h && (h["X-Staff-Token"] || h.Authorization)); }
  function readJson(r) {
    return r.json().then(function (j) { j = j || {}; j.__status = r.status; return j; }, function () { return { ok: false, error: "bad_response", __status: r.status }; });
  }

  // ---- Sending ---------------------------------------------------------------------------------
  function payloadOf(bug, orgId) {
    return { orgId: orgId, clientReportId: bug.id, description: bug.description, severity: bug.severity, location: bug.location,
      context: bug.context, target: bug.targetElement, errors: bug.errors, userAgent: bug.userAgent, screen: bug.screen, clientReportedAt: bug.timestamp };
  }
  /** One report to the server. Resolves { ok, serverId } or { ok: false, reason }; never rejects. */
  function sendOne(bug) {
    var orgId = bug.orgId || currentOrg();
    var now = new Date().toISOString();
    var fail = function (reason) { updateBug(bug.id, { lastError: reason, lastTriedAt: now }); return { ok: false, reason: reason }; };
    if (!orgId) return Promise.resolve(fail("no hospital is open on this device"));
    return authHeaders(orgId).then(function (h) {
      if (!signedIn(h)) return { ok: false, reason: "not signed in" };
      return fetch("/api/queue/ward/bug-report", { method: "POST", headers: h, credentials: "include", body: JSON.stringify(payloadOf(bug, orgId)) }).then(readJson);
    }).then(function (j) {
      if (j && j.ok && j.report && j.report.id) {
        updateBug(bug.id, { sent: true, serverId: j.report.id, serverStatus: j.report.status, sentAt: now, orgId: orgId, lastError: null });
        return { ok: true, serverId: j.report.id };
      }
      return fail((j && (j.reason || j.message || j.error)) || "the server did not accept it");
    }, function () { return fail("no connection to the server"); });
  }
  var flushing = null;
  /** Every unsent report, one at a time. Resolves { sent, waiting }. */
  function flushOutbox() {
    if (flushing) return flushing;
    var queue = unsentBugs(), sent = 0;
    if (!queue.length) return Promise.resolve({ sent: 0, waiting: 0 });
    var step = function (i) {
      if (i >= queue.length) return Promise.resolve();
      return sendOne(queue[i]).then(function (r) { if (r.ok) sent++; return step(i + 1); });
    };
    var done = function () { flushing = null; return { sent: sent, waiting: unsentBugs().length }; };
    flushing = step(0).then(done, done);
    return flushing;
  }

  // ---- Context Discovery -------------------------------------------------------------------
  function getContext() {
    var ctx = {
      url: G.location.href,
      path: G.location.pathname,
      hash: G.location.hash,
      page: "unknown",
      tab: null,
      patient: null,
      wardView: null,
      user: null
    };

    // 1. Check Shell (WSQ)
    if (G.WSQ && G.WSQ.state) {
      ctx.page = G.WSQ.state.page || "shell-home";
      ctx.tab = G.WSQ.state.tab || G.WSQ.state.arg || null;
      ctx.orgId = G.WSQ.state.orgId || null;
      if (G.WSQ.state.who) ctx.user = { id: G.WSQ.state.who.id, role: G.WSQ.state.who.role };
    }

    // 2. Check Ward overlay (WARD)
    var wardEl = document.getElementById("smdWard");
    if (wardEl && wardEl.style.display !== "none" && G.WARD) {
      ctx.surface = "ward";
      if (G.WARD.state) {
        ctx.wardView = G.WARD.state.view || "ward";
        if (G.WARD.state.sel) {
          // Id and bed only: a report is read by people who are not this patient's clinicians.
          ctx.patient = {
            id: G.WARD.state.sel.id || G.WARD.state.sel.patientId,
            bed: G.WARD.state.sel.bed
          };
        }
      }
    }

    if (!ctx.orgId) ctx.orgId = currentOrg() || null;

    // 3. Active tab in DOM
    var activeNav = document.querySelector('[aria-current="page"], .rail a.active, .w-tab.active, [data-tab].active');
    if (activeNav) ctx.activeNavText = activeNav.textContent ? activeNav.textContent.trim() : null;

    return ctx;
  }

  // ---- Element Inspector (Pick on spot) -----------------------------------------------------
  var picking = false;
  var pickedElement = null;
  var highlightOverlay = null;

  function createHighlightOverlay() {
    if (highlightOverlay) return highlightOverlay;
    var el = document.createElement("div");
    el.id = "wsqBugHighlight";
    el.style.cssText = "position:absolute;pointer-events:none;z-index:2147483645;border:2px dashed #e53935;background:rgba(229,57,53,0.12);transition:all 0.05s ease;display:none;border-radius:3px;";
    document.body.appendChild(el);
    return el;
  }

  function startPicking(onPicked) {
    picking = true;
    var ov = createHighlightOverlay();
    ov.style.display = "block";

    // Floating instruction banner
    var banner = document.createElement("div");
    banner.id = "wsqBugBanner";
    banner.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483646;background:#d32f2f;color:#fff;padding:10px 22px;border-radius:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.35);display:flex;align-items:center;gap:12px;cursor:default;";
    banner.innerHTML = '<span>Click on the exact button, card, or element where the bug is</span><button id="wsqBugCancelPick" style="background:#fff;color:#d32f2f;border:none;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;">Esc to Cancel</button>';
    document.body.appendChild(banner);

    function move(e) {
      if (!picking) return;
      var t = e.target;
      if (!t || t === banner || banner.contains(t) || t === ov || t.id === "wsqBugFab" || (t.closest && t.closest("#wsqBugModal"))) return;
      var r = t.getBoundingClientRect();
      ov.style.top = (r.top + G.scrollY) + "px";
      ov.style.left = (r.left + G.scrollX) + "px";
      ov.style.width = r.width + "px";
      ov.style.height = r.height + "px";
    }

    function click(e) {
      if (!picking) return;
      var t = e.target;
      if (t === banner || banner.contains(t) || (t.closest && t.closest("#wsqBugModal")) || t.id === "wsqBugFab") return;
      e.preventDefault();
      e.stopPropagation();
      stop();
      pickedElement = describeElement(t);
      if (onPicked) onPicked(pickedElement);
    }

    function key(e) {
      if (e.key === "Escape") { stop(); if (onPicked) onPicked(null); }
    }

    function stop() {
      picking = false;
      ov.style.display = "none";
      if (banner.parentNode) banner.parentNode.removeChild(banner);
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    }

    banner.querySelector("#wsqBugCancelPick").onclick = stop;
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  }

  function describeElement(el) {
    if (!el) return null;
    var tag = el.tagName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var classes = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    var text = (el.innerText || el.textContent || "").trim().slice(0, 60);
    var parentHeader = null;
    var headingEl = el.closest(".card, .w-card, .sec, section, form");
    if (headingEl) {
      var h = headingEl.querySelector("h1, h2, h3, h4, .title");
      if (h) parentHeader = h.textContent.trim().slice(0, 50);
    }
    return {
      selector: tag + id + classes,
      tag: tag,
      id: el.id || null,
      snippet: text,
      parentContext: parentHeader,
      outerHtml: el.outerHTML ? el.outerHTML.slice(0, 160) : ""
    };
  }

  // ---- UI: Floating Red Action Button (FAB) -------------------------------------------------
  var fab = null;
  var badge = null;

  function updateBadge() {
    if (!badge) return;
    if (consoleBuffer.length > 0) {
      badge.textContent = consoleBuffer.length;
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }

  function injectFab() {
    if (document.getElementById("wsqBugFab")) return;

    fab = document.createElement("button");
    fab.id = "wsqBugFab";
    fab.title = "Report a bug on this page or element";
    fab.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#d32f2f;color:#fff;border:2px solid #ffffff;border-radius:24px;padding:9px 15px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,0.35);cursor:pointer;display:flex;align-items:center;gap:6px;outline:none;user-select:none;transition:transform 0.15s ease,background 0.15s ease;";
    fab.innerHTML = '<span>Report Bug</span><span id="wsqBugBadge" style="display:none;background:#ffea00;color:#000;border-radius:10px;padding:1px 6px;font-size:11px;font-weight:800;margin-left:2px;">0</span>';

    fab.onmouseenter = function () { fab.style.transform = "scale(1.05)"; fab.style.background = "#b71c1c"; };
    fab.onmouseleave = function () { fab.style.transform = "scale(1)"; fab.style.background = "#d32f2f"; };
    fab.onclick = function () { openModal(); };

    document.body.appendChild(fab);
    badge = document.getElementById("wsqBugBadge");
    updateBadge();
  }

  // ---- Modal Dialog ------------------------------------------------------------------------
  var modal = null;

  function openModal(prepicked) {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    if (prepicked) pickedElement = prepicked;

    var ctx = getContext();
    var locationSummary = (ctx.surface === "ward" ? "Ward (" + (ctx.wardView || "main") + ")" : "Shell (" + (ctx.page || "door") + ")") +
      (ctx.tab ? " › Tab: " + ctx.tab : "") +
      (ctx.patient ? " › Patient: " + (ctx.patient.id || "") + (ctx.patient.bed ? " (bed " + ctx.patient.bed + ")" : "") : "");

    modal = document.createElement("div");
    modal.id = "wsqBugModal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";

    var targetSnippet = pickedElement
      ? '<div style="background:#ffebee;border:1px solid #ffcdd2;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;color:#b71c1c;">' +
        '<b>Target element:</b> <code>' + esc(pickedElement.selector) + '</code>' +
        (pickedElement.snippet ? ' - <i>"' + esc(pickedElement.snippet) + '"</i>' : '') +
        (pickedElement.parentContext ? ' in <b>' + esc(pickedElement.parentContext) + '</b>' : '') +
        ' <button id="wsqClearTarget" style="float:right;background:none;border:none;color:#b71c1c;text-decoration:underline;cursor:pointer;font-size:12px;">Clear</button></div>'
      : '<div style="margin-bottom:12px;"><button id="wsqPickElBtn" type="button" style="background:#f5f5f5;border:1px dashed #d32f2f;color:#d32f2f;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;">Point to Exact Element on Screen</button></div>';

    var errorNotice = consoleBuffer.length > 0
      ? '<div style="background:#fff3e0;border:1px solid #ffe0b2;padding:6px 10px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#e65100;"><b>' + consoleBuffer.length + ' runtime error(s)</b> captured from console will be attached automatically.</div>'
      : '';

    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:100%;max-width:540px;box-shadow:0 12px 36px rgba(0,0,0,0.3);overflow:hidden;animation:wsqPop 0.2s ease;">' +
        '<div style="background:#d32f2f;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;">' +
          '<div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;"><span>Report a Bug on This Spot</span></div>' +
          '<button id="wsqBugClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>' +
        '</div>' +
        '<div style="padding:16px 20px;max-height:80vh;overflow-y:auto;box-sizing:border-box;">' +
          '<div style="font-size:12px;color:#666;margin-bottom:8px;"><b>Location:</b> ' + esc(locationSummary) + '</div>' +
          targetSnippet +
          errorNotice +
          '<div style="margin-bottom:12px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#333;">What went wrong? (What happened vs what you expected)</label>' +
            '<textarea id="wsqBugDesc" rows="4" style="width:100%;box-sizing:border-box;border:1.5px solid #ccc;border-radius:6px;padding:10px;font-size:14px;font-family:inherit;" placeholder="Describe the issue at this spot..."></textarea>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
            '<div>' +
              '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:#333;">Severity</label>' +
              '<select id="wsqBugSev" style="width:100%;border:1.5px solid #ccc;border-radius:6px;padding:6px;font-size:13px;">' +
                '<option value="minor">Minor / UI defect</option>' +
                '<option value="major" selected>Major / Feature broken</option>' +
                '<option value="blocker">Blocker / Crash</option>' +
              '</select>' +
            '</div>' +
            '<div style="display:flex;align-items:flex-end;">' +
              '<button id="wsqViewLogsBtn" type="button" style="background:none;border:none;color:#1976d2;text-decoration:underline;cursor:pointer;font-size:13px;padding:6px 0;">View Past Bugs' + (unsentBugs().length ? " (" + unsentBugs().length + " waiting to send)" : "") + '</button>' +
            '</div>' +
          '</div>' +
          '<div id="wsqBugStatus" style="font-size:13px;margin-bottom:12px;display:none;"></div>' +
          '<div style="display:flex;justify-content:flex-end;gap:10px;">' +
            '<button id="wsqBugCancel" type="button" style="background:#f5f5f5;border:1px solid #ccc;padding:9px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">Cancel</button>' +
            '<button id="wsqBugSubmit" type="button" style="background:#d32f2f;color:#fff;border:none;padding:9px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(211,47,47,0.4);">Submit Bug Report</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector("#wsqBugClose").onclick = closeModal;
    modal.querySelector("#wsqBugCancel").onclick = closeModal;

    var pickBtn = modal.querySelector("#wsqPickElBtn");
    if (pickBtn) {
      pickBtn.onclick = function () {
        modal.style.display = "none";
        startPicking(function (picked) {
          openModal(picked);
        });
      };
    }

    var clearBtn = modal.querySelector("#wsqClearTarget");
    if (clearBtn) {
      clearBtn.onclick = function () {
        pickedElement = null;
        openModal(null);
      };
    }

    modal.querySelector("#wsqViewLogsBtn").onclick = function () {
      openLogsViewer();
    };

    modal.querySelector("#wsqBugSubmit").onclick = function () {
      var desc = (modal.querySelector("#wsqBugDesc").value || "").trim();
      if (!desc) {
        alert("Please provide a short description of the bug.");
        modal.querySelector("#wsqBugDesc").focus();
        return;
      }
      var sev = modal.querySelector("#wsqBugSev").value;
      submitBug(desc, sev, ctx, pickedElement);
    };

    // Auto focus description
    setTimeout(function () {
      var ta = modal.querySelector("#wsqBugDesc");
      if (ta) ta.focus();
    }, 100);
  }

  function closeModal() {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    pickedElement = null;
  }

  // ---- Submission --------------------------------------------------------------------------
  var SEND_WAIT_MS = 10000;
  /**
   * Keeps the report on this device first, then sends it. Resolves { sent, saved, message }, where message is
   * the truth about where the report is. Exposed for test/wardsynq-bug-outbox.test.mjs.
   */
  function recordReport(description, severity, ctx, target) {
    var bugId = "BUG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    var report = {
      id: bugId,
      timestamp: new Date().toISOString(),
      description: description,
      severity: severity,
      location: (ctx.page || "shell") + (ctx.tab ? " / " + ctx.tab : "") + (ctx.wardView ? " / " + ctx.wardView : ""),
      context: ctx,
      orgId: ctx.orgId || null,
      targetElement: target,
      errors: consoleBuffer.slice(),
      userAgent: navigator.userAgent,
      screen: { width: G.innerWidth, height: G.innerHeight, dpr: G.devicePixelRatio },
      sent: false
    };
    var saved = saveBug(report);

    // Best-effort copies for the developer: the clipboard and the local collector. Neither counts as sent.
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(formatBugMarkdown(report)).then(null, function () {}); } catch (e) {}
    try {
      fetch("http://127.0.0.1:4499/api/bug", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), mode: "cors" }).then(null, function () {});
    } catch (e) {}

    var timer = null;
    var timedOut = new Promise(function (res) { timer = setTimeout(function () { res({ ok: false, pending: true }); }, SEND_WAIT_MS); });
    return Promise.race([sendOne(report), timedOut]).then(function (r) {
      clearTimeout(timer);
      if (r.ok) return { sent: true, saved: saved, message: "Bug report sent to the hospital's server (reference " + String(r.serverId).slice(0, 12) + ")." };
      if (!saved) return { sent: false, saved: false, message: "Bug report NOT sent (" + (r.reason || "no answer yet") + ") and this device could not keep it. Copy the details before closing." };
      if (r.pending) return { sent: false, saved: true, message: "Bug report saved on this device. The server has not answered yet; it will keep trying. View Past Bugs shows when it arrives." };
      return { sent: false, saved: true, message: "Bug report saved on this device and NOT sent yet (" + r.reason + "). It will be sent automatically when you are online and signed in." };
    });
  }

  function submitBug(description, severity, ctx, target) {
    var statusEl = modal.querySelector("#wsqBugStatus");
    var btn = modal.querySelector("#wsqBugSubmit");
    statusEl.style.display = "block";
    statusEl.style.color = "#666";
    statusEl.textContent = "Sending bug report...";
    if (btn) btn.disabled = true;
    recordReport(description, severity, ctx, target).then(function (res) {
      closeModal();
      showToast(res.message, res.sent);
    });
  }

  function formatBugMarkdown(b) {
    var lines = [
      "### Bug Report: " + b.id,
      "- **Severity**: " + b.severity.toUpperCase(),
      "- **Location**: " + b.location,
      "- **URL**: " + b.context.url
    ];
    if (b.context.patient) lines.push("- **Active Patient**: " + (b.context.patient.id || "") + " (Bed: " + (b.context.patient.bed || "none") + ")");
    if (b.targetElement) {
      lines.push("- **Target Element**: `" + b.targetElement.selector + "`" + (b.targetElement.snippet ? ' ("' + b.targetElement.snippet + '")' : ""));
      if (b.targetElement.parentContext) lines.push("- **Parent Component**: " + b.targetElement.parentContext);
    }
    lines.push("- **Description**: " + b.description);
    if (b.errors && b.errors.length) {
      lines.push("- **Recent Console Errors (" + b.errors.length + ")**:");
      b.errors.slice(-5).forEach(function (e) {
        lines.push("  - `" + e.time.slice(11, 19) + "`: " + e.text);
      });
    }
    return lines.join("\n");
  }

  // ---- Logs Viewer Modal -------------------------------------------------------------------
  var STATUS_LABEL = { open: "Open", in_progress: "In progress", solved: "Solved", removed: "Solved and archived" };
  function pill(text, bg, fg) {
    return '<span style="display:inline-block;background:' + bg + ";color:" + fg + ';border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700;">' + esc(text) + "</span>";
  }
  /* server: null = loading, false = could not be loaded (failMessage says why), or the server's answer. An unloaded
   * list never reads as an empty one. Exposed for test/wardsynq-bug-outbox.test.mjs. */
  function logsHtml(local, server, failMessage) {
    var waiting = local.filter(function (b) { return b && !b.sent; });
    var row = function (id, when, desc, where, badge, extra, copyId) {
      return '<div style="border-bottom:1px solid #eee;padding:10px 0;">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#888;"><b>' + esc(id) + "</b> <span>" + esc(String(when || "").slice(0, 19).replace("T", " ")) + "</span></div>" +
        '<div style="margin:4px 0;">' + badge + "</div>" +
        '<div style="font-weight:600;font-size:14px;color:#333;margin:4px 0;">' + esc(desc) + "</div>" +
        '<div style="font-size:12px;color:#666;">' + esc(where) + "</div>" + (extra || "") +
        (copyId ? '<button class="wsqCopyBugBtn" data-id="' + esc(copyId) + '" style="margin-top:6px;background:#f5f5f5;border:1px solid #ccc;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">Copy Markdown</button>' : "") +
      "</div>";
    };
    var html = waiting.map(function (b) {
      return row(b.id, b.timestamp, b.description, b.location, pill("Waiting to send", "#fff3e0", "#e65100"),
        '<div style="font-size:12px;color:#e65100;margin-top:4px;">Saved on this device only.' + (b.lastError ? " Last try: " + esc(b.lastError) + "." : "") + "</div>", b.id);
    }).join("");
    if (server === null) {
      html += '<p style="color:#666;padding:12px 0;">Loading reports from the server...</p>';
    } else if (server === false) {
      html += '<p style="color:#b71c1c;padding:12px 0;">Reports on the server could not be loaded: ' + esc(failMessage || "no answer") + ". Their status is unknown here.</p>";
      html += local.filter(function (b) { return b && b.sent; }).map(function (b) {
        return row(b.id, b.timestamp, b.description, b.location, pill("Sent to the server", "#e8f5e9", "#1b5e20"), "", b.id);
      }).join("");
    } else {
      var reports = server.reports || [];
      html += reports.map(function (r) {
        var badge = r.status === "solved" || r.status === "removed" ? pill(STATUS_LABEL[r.status], "#e8f5e9", "#1b5e20")
          : r.status === "in_progress" ? pill(STATUS_LABEL[r.status], "#e3f2fd", "#0d47a1") : pill(STATUS_LABEL[r.status] || r.status, "#ffebee", "#b71c1c");
        var extra = r.solution && r.solution.note ? '<div style="font-size:12px;color:#1b5e20;margin-top:4px;">How it was solved: ' + esc(r.solution.note) + "</div>" : "";
        if (server.manager && r.reporter) extra += '<div style="font-size:12px;color:#888;margin-top:2px;">Reported by ' + esc(r.reporter.name || r.reporter.id) + "</div>";
        return row(r.clientReportId || r.id, r.reportedAt, r.description, r.location, badge, extra, null);
      }).join("");
      if (!reports.length && !waiting.length) html += '<p style="color:#888;text-align:center;padding:24px 0;">No bug reports yet.</p>';
    }
    return html;
  }

  function openLogsViewer() {
    if (modal) modal.style.display = "none";
    var server = null, failMessage = "";

    var v = document.createElement("div");
    v.id = "wsqBugLogsViewer";
    v.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";

    function closeLogs() {
      if (v && v.parentNode) v.parentNode.removeChild(v);
      if (modal) modal.style.display = "flex";
    }

    function paint() {
      var list = getStoredBugs();
      var manage = server && server.manager && G.WSQ && typeof G.WSQ.go === "function";
      v.innerHTML =
        '<div style="background:#fff;border-radius:12px;width:100%;max-width:600px;max-height:85vh;box-shadow:0 12px 36px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;">' +
          '<div style="background:#f5f5f5;border-bottom:1px solid #ddd;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;">' +
            '<h3 style="margin:0;font-size:16px;color:#333;">Bug reports</h3>' +
            '<button id="wsqCloseLogsViewer" aria-label="Close" style="background:none;border:none;font-size:20px;cursor:pointer;">&times;</button>' +
          "</div>" +
          '<div style="padding:16px;flex:1;overflow-y:auto;">' + logsHtml(list, server, failMessage) + "</div>" +
          '<div style="background:#fafafa;border-top:1px solid #eee;padding:10px 16px;display:flex;justify-content:space-between;gap:8px;">' +
            '<button id="wsqClearAllLogs" style="background:none;border:none;color:#d32f2f;cursor:pointer;font-size:12px;">Clear sent copies from this device</button>' +
            (manage ? '<button id="wsqManageBugs" style="background:none;border:1px solid #1976d2;color:#1976d2;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;">Manage all reports</button>' : "") +
            '<button id="wsqCloseLogsBtn" style="background:#333;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;">Close</button>' +
          "</div>" +
        "</div>";
      v.querySelector("#wsqCloseLogsViewer").onclick = closeLogs;
      v.querySelector("#wsqCloseLogsBtn").onclick = closeLogs;
      var mg = v.querySelector("#wsqManageBugs");
      if (mg) mg.onclick = function () { closeLogs(); closeModal(); G.WSQ.go("admin", "bugs"); };
      v.querySelectorAll(".wsqCopyBugBtn").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-id");
          var b = list.filter(function (x) { return x.id === id; })[0];
          if (b && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(formatBugMarkdown(b)).then(function () {
              btn.textContent = "Copied";
              setTimeout(function () { btn.textContent = "Copy Markdown"; }, 1500);
            }, function () {});
          }
        };
      });
      v.querySelector("#wsqClearAllLogs").onclick = function () {
        if (confirm("Clear the copies of reports already sent to the server from this device? Reports waiting to be sent are kept.")) {
          putStoredBugs(unsentBugs());
          paint();
        }
      };
    }

    document.body.appendChild(v);
    paint();

    // Send what is waiting first, so the server's list includes it.
    flushOutbox().then(function () {
      var orgId = currentOrg();
      if (!orgId) { server = false; failMessage = "no hospital is open on this device"; return paint(); }
      return authHeaders(orgId).then(function (h) {
        if (!signedIn(h)) return { ok: false, message: "not signed in" };
        return fetch("/api/queue/ward/bug-reports?orgId=" + encodeURIComponent(orgId) + "&status=all", { headers: h, credentials: "include" }).then(readJson);
      }).then(function (j) {
        if (j && j.ok) server = j; else { server = false; failMessage = (j && (j.message || j.error)) || "refused"; }
        paint();
      }, function () { server = false; failMessage = "no connection to the server"; paint(); });
    });
  }

  // ---- Toast feedback ----------------------------------------------------------------------
  function showToast(msg, good) {
    var t = document.getElementById("wsqBugToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "wsqBugToast";
      t.style.cssText = "position:fixed;bottom:70px;right:18px;z-index:2147483647;background:#212121;color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.3);max-width:320px;line-height:1.4;transition:opacity 0.2s ease;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = good ? "#1b5e20" : "#212121";
    t.style.opacity = "1";
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      t.style.opacity = "0";
      setTimeout(function () { t.style.display = "none"; }, 250);
    }, good ? 4000 : 9000);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFab);
  } else {
    injectFab();
  }

  /* Retry what is waiting: shortly after load (a signed-in account restores itself asynchronously), when the
   * connection returns, and every minute while anything is waiting, which is how a later sign-in is noticed. */
  setTimeout(flushOutbox, 2000);
  G.addEventListener("online", function () { flushOutbox(); });
  setInterval(function () { if (unsentBugs().length) flushOutbox(); }, 60000);

  // Expose global API
  G.WSQ_BUG_REPORTER = {
    open: openModal,
    pick: function () { startPicking(function (p) { openModal(p); }); },
    getLogs: getStoredBugs,
    getErrors: function () { return consoleBuffer.slice(); },
    flush: flushOutbox,
    _record: recordReport,
    _logsHtml: logsHtml
  };
})();
