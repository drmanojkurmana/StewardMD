/* wardsynq/site/bug-reporter.js - On-spot bug reporting widget for WardSynQ.
 *
 * Self-contained ES5 script. Injects a floating red "Report Bug" button on every page and tab.
 * Allows pointing to the exact element on screen where a bug occurs, collects runtime diagnostics
 * (view, route, active patient, console errors, DOM target), saves to localStorage, and streams to
 * the local AI bug collector at http://127.0.0.1:4499/api/bug.
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

  // ---- Storage -----------------------------------------------------------------------------
  var STORAGE_KEY = "wardsynq_bug_log";
  function getStoredBugs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveBug(bug) {
    try {
      var list = getStoredBugs();
      list.unshift(bug);
      if (list.length > 50) list = list.slice(0, 50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
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
          ctx.patient = {
            id: G.WARD.state.sel.id || G.WARD.state.sel.patientId,
            name: G.WARD.state.sel.name,
            bed: G.WARD.state.sel.bed,
            admissionClass: G.WARD.state.sel.class
          };
        }
      }
    }

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
    banner.innerHTML = '<span>🎯 Click on the exact button, card, or element where the bug is</span><button id="wsqBugCancelPick" style="background:#fff;color:#d32f2f;border:none;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:700;cursor:pointer;">Esc to Cancel</button>';
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
    fab.innerHTML = '<span style="font-size:16px;line-height:1;">🐞</span><span>Report Bug</span><span id="wsqBugBadge" style="display:none;background:#ffea00;color:#000;border-radius:10px;padding:1px 6px;font-size:11px;font-weight:800;margin-left:2px;">0</span>';

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
      (ctx.patient ? " › Patient: " + (ctx.patient.name || ctx.patient.id) : "");

    modal = document.createElement("div");
    modal.id = "wsqBugModal";
    modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";

    var targetSnippet = pickedElement
      ? '<div style="background:#ffebee;border:1px solid #ffcdd2;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;color:#b71c1c;">' +
        '<b>🎯 Target Element:</b> <code>' + esc(pickedElement.selector) + '</code>' +
        (pickedElement.snippet ? ' - <i>"' + esc(pickedElement.snippet) + '"</i>' : '') +
        (pickedElement.parentContext ? ' in <b>' + esc(pickedElement.parentContext) + '</b>' : '') +
        ' <button id="wsqClearTarget" style="float:right;background:none;border:none;color:#b71c1c;text-decoration:underline;cursor:pointer;font-size:12px;">Clear</button></div>'
      : '<div style="margin-bottom:12px;"><button id="wsqPickElBtn" type="button" style="background:#f5f5f5;border:1px dashed #d32f2f;color:#d32f2f;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;">🎯 Point to Exact Element on Screen</button></div>';

    var errorNotice = consoleBuffer.length > 0
      ? '<div style="background:#fff3e0;border:1px solid #ffe0b2;padding:6px 10px;border-radius:6px;margin-bottom:12px;font-size:12px;color:#e65100;">⚠️ <b>' + consoleBuffer.length + ' runtime error(s)</b> captured from console will be attached automatically.</div>'
      : '';

    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:100%;max-width:540px;box-shadow:0 12px 36px rgba(0,0,0,0.3);overflow:hidden;animation:wsqPop 0.2s ease;">' +
        '<div style="background:#d32f2f;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;">' +
          '<div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;"><span>🐞</span><span>Report a Bug on This Spot</span></div>' +
          '<button id="wsqBugClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;">&times;</button>' +
        '</div>' +
        '<div style="padding:16px 20px;max-height:80vh;overflow-y:auto;box-sizing:border-box;">' +
          '<div style="font-size:12px;color:#666;margin-bottom:8px;"><b>📍 Location:</b> ' + esc(locationSummary) + '</div>' +
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
              '<button id="wsqViewLogsBtn" type="button" style="background:none;border:none;color:#1976d2;text-decoration:underline;cursor:pointer;font-size:13px;padding:6px 0;">View Past Bugs (' + getStoredBugs().length + ')</button>' +
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
  function submitBug(description, severity, ctx, target) {
    var statusEl = modal.querySelector("#wsqBugStatus");
    statusEl.style.display = "block";
    statusEl.style.color = "#666";
    statusEl.textContent = "Recording bug report...";

    var bugId = "BUG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    var report = {
      id: bugId,
      timestamp: new Date().toISOString(),
      description: description,
      severity: severity,
      location: (ctx.page || "shell") + (ctx.tab ? " / " + ctx.tab : "") + (ctx.wardView ? " / " + ctx.wardView : ""),
      context: ctx,
      targetElement: target,
      errors: consoleBuffer.slice(),
      userAgent: navigator.userAgent,
      screen: { width: G.innerWidth, height: G.innerHeight, dpr: G.devicePixelRatio }
    };

    // 1. Save to localStorage
    saveBug(report);

    // 2. Generate Markdown for instant clipboard paste
    var md = formatBugMarkdown(report);
    var copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md);
        copied = true;
      }
    } catch (e) {}

    // 3. Post to local bug listener (http://127.0.0.1:4499/api/bug)
    var localPromise = fetch("http://127.0.0.1:4499/api/bug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      mode: "cors"
    }).then(function (r) { return r.json(); }).catch(function () { return null; });

    // Close and show notification
    Promise.race([localPromise, new Promise(function (res) { setTimeout(res, 500); })]).then(function (res) {
      closeModal();
      var deliveredMsg = res && res.ok
        ? "✅ Bug recorded and streamed directly to AI log file (debug-bugs.jsonl)!"
        : "✅ Bug recorded! " + (copied ? "Summary copied to clipboard for AI chat." : "Saved to local bug logs.");
      showToast(deliveredMsg);
    });
  }

  function formatBugMarkdown(b) {
    var lines = [
      "### 🐞 Bug Report: " + b.id,
      "- **Severity**: " + b.severity.toUpperCase(),
      "- **Location**: " + b.location,
      "- **URL**: " + b.context.url
    ];
    if (b.context.patient) lines.push("- **Active Patient**: " + (b.context.patient.name || b.context.patient.id) + " (Bed: " + (b.context.patient.bed || "none") + ")");
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
  function openLogsViewer() {
    var list = getStoredBugs();
    if (modal) modal.style.display = "none";

    var v = document.createElement("div");
    v.id = "wsqBugLogsViewer";
    v.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif;";

    var rows = list.length ? list.map(function (b) {
      return '<div style="border-bottom:1px solid #eee;padding:10px 0;">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;color:#888;">' +
          '<b>' + esc(b.id) + '</b> <span>' + esc(b.timestamp.slice(0, 19).replace("T", " ")) + '</span>' +
        '</div>' +
        '<div style="font-weight:600;font-size:14px;color:#333;margin:4px 0;">' + esc(b.description) + '</div>' +
        '<div style="font-size:12px;color:#666;">📍 ' + esc(b.location) + (b.targetElement ? ' &middot; <code>' + esc(b.targetElement.selector) + '</code>' : '') + '</div>' +
        '<button class="wsqCopyBugBtn" data-id="' + esc(b.id) + '" style="margin-top:6px;background:#f5f5f5;border:1px solid #ccc;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer;">📋 Copy Markdown</button>' +
      '</div>';
    }).join("") : '<p style="color:#888;text-align:center;padding:24px 0;">No bugs recorded yet.</p>';

    v.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:100%;max-width:600px;max-height:85vh;box-shadow:0 12px 36px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;">' +
        '<div style="background:#f5f5f5;border-bottom:1px solid #ddd;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;">' +
          '<h3 style="margin:0;font-size:16px;color:#333;">Logged Bugs (' + list.length + ')</h3>' +
          '<button id="wsqCloseLogsViewer" style="background:none;border:none;font-size:20px;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div style="padding:16px;flex:1;overflow-y:auto;">' + rows + '</div>' +
        '<div style="background:#fafafa;border-top:1px solid #eee;padding:10px 16px;display:flex;justify-content:space-between;">' +
          '<button id="wsqClearAllLogs" style="background:none;border:none;color:#d32f2f;cursor:pointer;font-size:12px;">Clear All Logs</button>' +
          '<button id="wsqCloseLogsBtn" style="background:#333;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(v);

    function closeLogs() {
      if (v && v.parentNode) v.parentNode.removeChild(v);
      if (modal) modal.style.display = "flex";
    }

    v.querySelector("#wsqCloseLogsViewer").onclick = closeLogs;
    v.querySelector("#wsqCloseLogsBtn").onclick = closeLogs;

    v.querySelectorAll(".wsqCopyBugBtn").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-id");
        var b = list.filter(function (x) { return x.id === id; })[0];
        if (b && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(formatBugMarkdown(b));
          btn.textContent = "✅ Copied!";
          setTimeout(function () { btn.textContent = "📋 Copy Markdown"; }, 1500);
        }
      };
    });

    v.querySelector("#wsqClearAllLogs").onclick = function () {
      if (confirm("Clear all logged bug reports?")) {
        localStorage.removeItem(STORAGE_KEY);
        closeLogs();
        if (modal) openModal();
      }
    };
  }

  // ---- Toast feedback ----------------------------------------------------------------------
  function showToast(msg) {
    var t = document.getElementById("wsqBugToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "wsqBugToast";
      t.style.cssText = "position:fixed;bottom:70px;right:18px;z-index:2147483647;background:#212121;color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,0.3);max-width:320px;line-height:1.4;transition:opacity 0.2s ease;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    t.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      t.style.opacity = "0";
      setTimeout(function () { t.style.display = "none"; }, 250);
    }, 4000);
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

  // Expose global API
  G.WSQ_BUG_REPORTER = {
    open: openModal,
    pick: function () { startPicking(function (p) { openModal(p); }); },
    getLogs: getStoredBugs,
    getErrors: function () { return consoleBuffer.slice(); }
  };
})();
