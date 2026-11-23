/* StewardMD - ResearchMD Shell (window.SMD_RESEARCH).
 * ES5 only, buildless, mobile-first.
 * Shell overlay (#researchMD with [hidden]{display:none!important}),
 * navigation, house dark green palette, and screen mounting.
 */
(function (G) {
  "use strict";

  var D = G.document;
  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};

  var FLAG = "smd_research";
  var root = null;
  var currentScreen = "projects";
  var navStack = [];

  /* Escaping helper: one shared helper for all ResearchMD screens per contract. */
  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  SMD.esc = esc;

  /* Phase 2 API client: calls stewardmd.in/api/research/v1 per the frozen
   * contracts (docs/research/contracts/phase-2). Firebase ID token from
   * SMD_AUTH when present; errors normalize to {code, status, current}. */
  function apiRequest(method, path, body) {
    var headers = { "Accept": "application/json" };
    var opts = { method: method, headers: headers };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    var tokenP;
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      tokenP = (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { tokenP = Promise.resolve(null); }
    return Promise.resolve(tokenP).then(function (token) {
      if (token) headers["Authorization"] = "Bearer " + token;
      return G.fetch("/api/research" + path, opts);
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) {
          var env = (data && data.error) || {};
          var err = new Error(env.message || ("Request failed (HTTP " + res.status + "). Retry, or check the project role."));
          err.status = res.status;
          err.code = env.code || ("http_" + res.status);
          err.current = data && data.current;
          err.requestId = env.requestId;
          throw err;
        }
        return data || {};
      });
    }).catch(function (e) {
      if (e && e.code) throw e;
      var net = new Error("Cannot reach the research service. Check the connection and retry.");
      net.code = "network";
      net.status = 0;
      throw net;
    });
  }

  function apiUpload(path, formData) {
    var headers = { "Accept": "application/json" };
    var tokenP;
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      tokenP = (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { tokenP = Promise.resolve(null); }
    return Promise.resolve(tokenP).then(function (token) {
      if (token) headers["Authorization"] = "Bearer " + token;
      return G.fetch("/api/research" + path, { method: "POST", headers: headers, body: formData });
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) {
          var env = (data && data.error) || {};
          var err = new Error(env.message || ("Upload failed (HTTP " + res.status + "). Retry with a smaller file."));
          err.status = res.status;
          err.code = env.code || ("http_" + res.status);
          throw err;
        }
        return data || {};
      });
    }).catch(function (e) {
      if (e && e.code) throw e;
      var net = new Error("Cannot reach the research service. Check the connection and retry.");
      net.code = "network";
      net.status = 0;
      throw net;
    });
  }

  SMD.api = { request: apiRequest, upload: apiUpload };

  /* Shared Phase 2 screen helpers (one escaping helper above, one date
   * formatter, one error banner, one download path). */
  function fmtTs(ts) {
    if (!ts) return "";
    try {
      var d = new Date(ts);
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function errHtml(err, retryAttr) {
    var e = err || {};
    var h = '<div class="rmd-banner rmd-banner-error" role="alert">';
    h += '<strong>' + esc(e.message || "Something went wrong.") + '</strong>';
    if (e.code) h += '<span class="rmd-banner-code">Code: ' + esc(e.code) + (e.status ? " (HTTP " + e.status + ")" : "") + '</span>';
    if (retryAttr) h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="' + esc(retryAttr) + '">Retry</button>';
    h += '</div>';
    return h;
  }

  function loadingHtml(label) {
    return '<div class="rmd-loading" aria-live="polite">' + esc(label || "Loading") + '&#8230;</div>';
  }

  function reasonLabel(code, reasons) {
    if (!code) return "";
    for (var i = 0; i < (reasons || []).length; i++) {
      if (reasons[i].code === code) return reasons[i].label || code;
    }
    return code;
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = D.createElement("a");
    a.href = url;
    a.download = filename;
    D.body.appendChild(a);
    a.click();
    D.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  SMD.p2 = {
    fmtTs: fmtTs,
    errHtml: errHtml,
    loadingHtml: loadingHtml,
    reasonLabel: reasonLabel,
    downloadText: downloadText
  };

  /* Feature flag: DEFAULT OFF. On per device with ?research=1 or localStorage.smd_research = "1" */
  function on() {
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]research=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(FLAG) === "1";
      }
    } catch (e) {}
    return false;
  }

  function injectCSS() {
    if (!D || D.getElementById("rmdCss")) return;
    var s = D.createElement("style");
    s.id = "rmdCss";
    s.textContent = [
      "/* ResearchMD Shell & Overlay */",
      "#researchMD {",
      "  --rmd-bg: #f4f7f6;",
      "  --rmd-panel: #ffffff;",
      "  --rmd-ink: #12202a;",
      "  --rmd-mut: #5b6b75;",
      "  --rmd-line: #dce4e2;",
      "  --rmd-acc: #0f766e;",
      "  --rmd-acc-soft: #e3f2ef;",
      "  --rmd-acc-dark: #094e48;",
      "  --rmd-warn: #9a5b00;",
      "  --rmd-warn-soft: #fff3dd;",
      "  --rmd-bad: #b42318;",
      "  --rmd-bad-soft: #fdecea;",
      "  --rmd-fill: rgba(118, 118, 128, 0.12);",
      "  --rmd-f: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;",
      "  --rmd-mono: ui-monospace, 'SF Mono', Menlo, monospace;",
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 10050;",
      "  background: var(--rmd-bg);",
      "  color: var(--rmd-ink);",
      "  font: 14.5px/1.45 var(--rmd-f);",
      "  display: flex;",
      "  flex-direction: column;",
      "  -webkit-font-smoothing: antialiased;",
      "  box-sizing: border-box;",
      "}",
      "/* Crucial house overlay rule: [hidden] MUST beat display:flex */",
      "#researchMD[hidden] {",
      "  display: none !important;",
      "}",
      "body.dark #researchMD, body.v3-dark #researchMD {",
      "  --rmd-bg: #0d1417;",
      "  --rmd-panel: #151f23;",
      "  --rmd-ink: #e3ecea;",
      "  --rmd-mut: #93a4a8;",
      "  --rmd-line: #26363b;",
      "  --rmd-acc: #37b8a6;",
      "  --rmd-acc-soft: #153430;",
      "  --rmd-acc-dark: #227b6f;",
      "  --rmd-warn: #f0b454;",
      "  --rmd-warn-soft: #352812;",
      "  --rmd-bad: #ff7b6e;",
      "  --rmd-bad-soft: #3a1714;",
      "  --rmd-fill: rgba(118, 118, 128, 0.26);",
      "}",
      "#researchMD * { box-sizing: border-box; }",
      "/* Top Shell Bar */",
      "#researchMD .rmd-shell-top {",
      "  display: grid;",
      "  grid-template-columns: auto 1fr auto;",
      "  align-items: center;",
      "  gap: 12px;",
      "  padding: calc(env(safe-area-inset-top, 0px) + 6px) 14px 8px;",
      "  background: var(--rmd-panel);",
      "  border-bottom: 1px solid var(--rmd-line);",
      "  position: relative;",
      "  z-index: 10;",
      "}",
      "#researchMD .rmd-shell-nav { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-nav-back {",
      "  border: 0; background: none; color: var(--rmd-acc); font: 500 15px var(--rmd-f);",
      "  display: inline-flex; align-items: center; gap: 4px; padding: 6px 4px; cursor: pointer;",
      "  min-height: 40px;",
      "}",
      "#researchMD .rmd-shell-brand { display: flex; align-items: baseline; gap: 8px; }",
      "#researchMD .rmd-shell-brand strong { font: 700 17px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-shell-brand span { font: 500 12.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-shell-right { display: flex; align-items: center; gap: 10px; justify-content: flex-end; }",
      "#researchMD .rmd-sync-pill {",
      "  font: 600 11.5px var(--rmd-f); border-radius: 999px; padding: 3px 9px;",
      "  display: inline-flex; align-items: center; gap: 5px; text-transform: uppercase; letter-spacing: 0.04em;",
      "}",
      "#researchMD .rmd-sync-synced { color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-sync-queue { color: var(--rmd-warn); background: var(--rmd-warn-soft); }",
      "#researchMD .rmd-sync-conflict { color: var(--rmd-bad); background: var(--rmd-bad-soft); }",
      "#researchMD .rmd-shell-close {",
      "  border: 0; background: none; color: var(--rmd-acc); font: 400 16px var(--rmd-f);",
      "  padding: 6px 10px; cursor: pointer; min-height: 40px; display: inline-flex; align-items: center;",
      "}",
      "/* Body Screen Mount */",
      "#researchMD .rmd-shell-body {",
      "  flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;",
      "  display: flex; flex-direction: column;",
      "}",
      "/* Common Components: Buttons, Badges, Cards */",
      "#researchMD .rmd-btn {",
      "  display: inline-flex; align-items: center; justify-content: center; gap: 6px;",
      "  border: 0; border-radius: 8px; padding: 8px 14px; font: 600 14px var(--rmd-f); cursor: pointer;",
      "  transition: opacity 0.15s ease, background 0.15s ease; touch-action: manipulation;",
      "}",
      "#researchMD .rmd-btn:active { opacity: 0.7; }",
      "#researchMD .rmd-btn-primary { background: var(--rmd-acc); color: #fff; }",
      "#researchMD .rmd-btn-subtle { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-btn-sm { padding: 5px 10px; font-size: 13px; border-radius: 6px; }",
      "#researchMD .rmd-btn-block { width: 100%; }",
      "#researchMD .rmd-btn-close { border: 0; background: none; color: var(--rmd-mut); font: 400 24px/1 var(--rmd-f); cursor: pointer; padding: 4px 8px; }",
      "#researchMD .rmd-badge { font: 600 11.5px var(--rmd-f); border-radius: 6px; padding: 2px 7px; display: inline-block; }",
      "#researchMD .rmd-badge-pill { border-radius: 999px; background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-badge-soft { background: var(--rmd-fill); color: var(--rmd-mut); }",
      "#researchMD .rmd-badge-neutral { background: var(--rmd-line); color: var(--rmd-ink); }",
      "#researchMD .rmd-role-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-version-tag { font: 600 11px var(--rmd-mono); color: var(--rmd-mut); background: var(--rmd-fill); padding: 2px 6px; border-radius: 4px; }",
      "#researchMD .rmd-status-pill { border: 0; border-radius: 999px; padding: 3px 9px; font: 600 11.5px var(--rmd-f); cursor: pointer; }",
      "#researchMD .rmd-status-verified { background: var(--rmd-acc-soft); color: var(--rmd-acc); }",
      "#researchMD .rmd-status-unverified { background: var(--rmd-warn-soft); color: var(--rmd-warn); }",
      "#researchMD .rmd-card { background: var(--rmd-panel); border-radius: 12px; border: 1px solid var(--rmd-line); padding: 16px; display: flex; flex-direction: column; gap: 12px; }",
      "#researchMD .rmd-card-heading { margin: 0; font: 600 15px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-form { display: flex; flex-direction: column; gap: 12px; }",
      "#researchMD .rmd-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }",
      "#researchMD .rmd-field { display: flex; flex-direction: column; gap: 5px; }",
      "#researchMD .rmd-field label { font: 600 12.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-req { color: var(--rmd-bad); }",
      "#researchMD .rmd-field-hint { font: 400 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD input[type=text], #researchMD input[type=number], #researchMD select, #researchMD textarea {",
      "  width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f);",
      "  color: var(--rmd-ink); background: var(--rmd-panel); outline: none;",
      "}",
      "#researchMD input:focus, #researchMD select:focus, #researchMD textarea:focus { border-color: var(--rmd-acc); box-shadow: 0 0 0 2px var(--rmd-acc-soft); }",
      "#researchMD .rmd-icon-btn { border: 0; background: none; color: var(--rmd-mut); cursor: pointer; padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; }",
      "#researchMD .rmd-icon-btn:hover { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-icon-danger:hover { color: var(--rmd-bad); }",
      "/* Empty states */",
      "#researchMD .rmd-empty-state { text-align: center; padding: 48px 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-empty-icon { color: var(--rmd-acc); opacity: 0.8; }",
      "#researchMD .rmd-empty-state h3 { margin: 0; font: 600 17px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-empty-state p { margin: 0; max-width: 400px; font-size: 13.5px; }",
      "/* Projects Screen */",
      "#researchMD .rmd-projects-screen { padding: 16px 20px 40px; display: flex; flex-direction: column; gap: 20px; max-width: 1080px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-screen-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }",
      "#researchMD .rmd-screen-title { margin: 0; font: 700 20px var(--rmd-f); }",
      "#researchMD .rmd-screen-subtitle { margin: 2px 0 0; font: 400 13.5px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-project-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }",
      "#researchMD .rmd-project-card { cursor: pointer; transition: transform 0.1s ease, box-shadow 0.15s ease; }",
      "#researchMD .rmd-project-card:hover { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-card-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-project-title { margin: 0; font: 600 16px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-project-q { margin: 0; font: 400 13px var(--rmd-f); color: var(--rmd-mut); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
      "#researchMD .rmd-project-meta { display: flex; align-items: center; justify-content: space-between; font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); border-top: 1px solid var(--rmd-line); padding-top: 10px; margin-top: 2px; }",
      "#researchMD .rmd-meta-val { font-weight: 700; color: var(--rmd-ink); }",
      "#researchMD .rmd-card-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; }",
      "/* Studies Screen & Two-Pane Layout */",
      "#researchMD .rmd-studies-screen { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; }",
      "#researchMD .rmd-studies-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-topbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }",
      "#researchMD .rmd-topbar-proj-info { display: flex; align-items: baseline; gap: 8px; min-width: 0; }",
      "#researchMD .rmd-topbar-proj-title { margin: 0; font: 600 16px var(--rmd-f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      "#researchMD .rmd-topbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }",
      "#researchMD .rmd-phone-seg { display: none; background: var(--rmd-fill); padding: 3px; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-seg-btn { flex: 1; border: 0; background: none; font: 500 13px var(--rmd-f); color: var(--rmd-mut); padding: 7px; border-radius: 6px; cursor: pointer; }",
      "#researchMD .rmd-seg-btn.rmd-seg-active { background: var(--rmd-panel); color: var(--rmd-ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }",
      "#researchMD .rmd-split-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }",
      "#researchMD .rmd-pane-left { flex: 0 0 42%; border-right: 1px solid var(--rmd-line); display: flex; flex-direction: column; overflow-y: auto; background: var(--rmd-panel); min-width: 320px; }",
      "#researchMD .rmd-pane-right { flex: 1; overflow-y: auto; padding: 18px 22px 40px; background: var(--rmd-bg); }",
      "#researchMD .rmd-pane-header { padding: 12px 16px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-filter-tabs { display: flex; gap: 6px; }",
      "#researchMD .rmd-chip { border: 0; background: var(--rmd-fill); color: var(--rmd-mut); font: 500 12.5px var(--rmd-f); border-radius: 999px; padding: 4px 10px; cursor: pointer; }",
      "#researchMD .rmd-chip.rmd-chip-active { background: var(--rmd-acc); color: #fff; font-weight: 600; }",
      "#researchMD .rmd-studies-list { display: flex; flex-direction: column; }",
      "#researchMD .rmd-study-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--rmd-line); cursor: pointer; transition: background 0.1s ease; }",
      "#researchMD .rmd-study-row:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-study-row-selected { background: var(--rmd-acc-soft); outline: 2px solid var(--rmd-acc); outline-offset: -2px; }",
      "#researchMD .rmd-study-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }",
      "#researchMD .rmd-study-row-title-bar { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-study-label { font-size: 14.5px; color: var(--rmd-ink); }",
      "#researchMD .rmd-study-data-str { font: 500 12.5px var(--rmd-mono); color: var(--rmd-mut); }",
      "#researchMD .rmd-study-loc-str { font: 400 12px var(--rmd-f); color: var(--rmd-mut); display: flex; align-items: center; gap: 4px; }",
      "#researchMD .rmd-study-row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }",
      "/* Detail & Form Cards */",
      "#researchMD .rmd-detail-card, #researchMD .rmd-form-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 16px; max-width: 720px; margin: 0 auto; }",
      "#researchMD .rmd-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--rmd-line); padding-bottom: 14px; }",
      "#researchMD .rmd-detail-title { margin: 4px 0 0; font: 700 19px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-detail-header-actions { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-section-block { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-section-label { margin: 0; font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.05em; color: var(--rmd-mut); }",
      "#researchMD .rmd-data-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-data-box-row { display: flex; gap: 8px; font-size: 13.5px; }",
      "#researchMD .rmd-data-box-lbl { color: var(--rmd-mut); min-width: 110px; }",
      "#researchMD .rmd-2x2-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13.5px; }",
      "#researchMD .rmd-grid-cell { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 6px; padding: 8px 10px; }",
      "#researchMD .rmd-grid-cell span { display: block; font-size: 11.5px; color: var(--rmd-mut); margin-bottom: 2px; }",
      "#researchMD .rmd-provenance-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }",
      "#researchMD .rmd-prov-row { display: flex; gap: 8px; }",
      "#researchMD .rmd-prov-lbl { color: var(--rmd-mut); min-width: 70px; font-weight: 500; }",
      "#researchMD .rmd-quote-block { background: var(--rmd-fill); border: 1px solid var(--rmd-line); padding: 10px 12px; margin-top: 6px; border-radius: 6px; }",
      "#researchMD .rmd-quote-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; color: var(--rmd-acc); margin-bottom: 4px; }",
      "#researchMD .rmd-quote-block blockquote { margin: 0; font-style: italic; color: var(--rmd-ink); font-size: 13px; line-height: 1.45; }",
      "#researchMD .rmd-verify-block { border-top: 1px solid var(--rmd-line); padding-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }",
      "#researchMD .rmd-verify-status-box { display: flex; align-items: center; gap: 10px; }",
      "#researchMD .rmd-verify-status-box strong { font-size: 13.5px; }",
      "#researchMD .rmd-verify-status-box p { margin: 0; font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-verify-ok { color: var(--rmd-acc); }",
      "#researchMD .rmd-verify-warn { color: var(--rmd-warn); }",
      "#researchMD .rmd-sub-card { background: var(--rmd-fill); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-locator-section { border-top: 1px solid var(--rmd-line); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-checkbox-field { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-check-label { display: flex; align-items: center; gap: 8px; font: 500 13.5px var(--rmd-f); color: var(--rmd-ink); cursor: pointer; }",
      "#researchMD .rmd-check-note { margin: 3px 0 0 24px; font-size: 11.5px; color: var(--rmd-mut); }",
      "/* Run Meta-Analysis Screen */",
      "#researchMD .rmd-run-screen { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; overflow-y: auto; }",
      "#researchMD .rmd-run-layout { display: grid; grid-template-columns: 310px 1fr; gap: 18px; padding: 18px 22px 40px; max-width: 1280px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-run-settings-panel { display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-eligibility-box { background: var(--rmd-fill); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }",
      "#researchMD .rmd-elig-stat { font-weight: 500; }",
      "#researchMD .rmd-elig-warn { font-size: 12px; color: var(--rmd-warn); display: flex; align-items: center; gap: 5px; }",
      "#researchMD .rmd-results-wrap { display: flex; flex-direction: column; gap: 16px; }",
      "#researchMD .rmd-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }",
      "#researchMD .rmd-kpi-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-kpi-highlight { border-color: var(--rmd-acc); background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-kpi-lbl { font: 600 11.5px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); }",
      "#researchMD .rmd-kpi-highlight .rmd-kpi-lbl { color: var(--rmd-acc); }",
      "#researchMD .rmd-kpi-val { font: 700 22px/1.2 var(--rmd-f); color: var(--rmd-ink); font-variant-numeric: tabular-nums; }",
      "#researchMD .rmd-kpi-sub { font: 500 12px var(--rmd-mono); color: var(--rmd-mut); }",
      "#researchMD .rmd-notices-box { background: var(--rmd-warn-soft); border: 1px solid var(--rmd-warn); border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }",
      "#researchMD .rmd-notice-item { display: flex; align-items: center; gap: 8px; font: 500 12.5px var(--rmd-f); color: var(--rmd-warn); }",
      "#researchMD .rmd-forest-card { overflow: hidden; padding: 18px 20px; }",
      "#researchMD .rmd-forest-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }",
      "#researchMD .rmd-forest-legend { display: flex; align-items: center; gap: 16px; font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-legend-item { display: flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-leg-box { width: 10px; height: 10px; background: var(--rmd-acc); border-radius: 1px; display: inline-block; }",
      "#researchMD .rmd-leg-diamond { width: 10px; height: 10px; background: var(--rmd-acc); transform: rotate(45deg); display: inline-block; }",
      "#researchMD .rmd-svg-scroll-container { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }",
      "/* Modals */",
      "#researchMD .rmd-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10060; display: flex; align-items: center; justify-content: center; padding: 16px; }",
      "#researchMD .rmd-modal-card { background: var(--rmd-panel); border-radius: 14px; width: 100%; max-width: 500px; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); max-height: 90vh; overflow-y: auto; }",
      "#researchMD .rmd-modal-wide { max-width: 680px; }",
      "#researchMD .rmd-modal-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--rmd-line); padding-bottom: 10px; }",
      "#researchMD .rmd-modal-header h3 { margin: 0; font: 700 17px var(--rmd-f); }",
      "#researchMD .rmd-modal-warn { border-bottom-color: var(--rmd-warn); }",
      "#researchMD .rmd-warn-hdr-icon { color: var(--rmd-warn); flex-shrink: 0; margin-right: 8px; }",
      "#researchMD .rmd-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--rmd-line); padding-top: 12px; margin-top: 6px; }",
      "/* 409 Conflict Dialog */",
      "#researchMD .rmd-conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }",
      "#researchMD .rmd-conflict-col { background: var(--rmd-fill); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-conflict-tag { font: 600 11px var(--rmd-f); text-transform: uppercase; color: var(--rmd-mut); }",
      "#researchMD .rmd-conflict-col h4 { margin: 0; font: 600 15px var(--rmd-f); }",
      "#researchMD .rmd-conflict-values { font: 500 12.5px var(--rmd-mono); color: var(--rmd-ink); }",
      "#researchMD .rmd-conflict-quote { font-style: italic; font-size: 12px; color: var(--rmd-mut); background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 6px; padding: 8px 10px; }",
      "#researchMD .rmd-conflict-ver { font-size: 12px; color: var(--rmd-mut); }",
      "/* Responsive Breakpoints: Tablet (>= 768px) vs Phone (< 768px) */",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-split-layout { flex-direction: column; }",
      "  #researchMD .rmd-pane-left { flex: 1; border-right: 0; min-width: 0; }",
      "  #researchMD .rmd-pane-right { flex: 1; padding: 14px; }",
      "  #researchMD .rmd-phone-seg { display: flex; }",
      "  #researchMD .rmd-phone-hidden { display: none !important; }",
      "  #researchMD .rmd-run-layout { grid-template-columns: 1fr; padding: 12px 14px; }",
      "  #researchMD .rmd-conflict-grid { grid-template-columns: 1fr; }",
      "}",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-project-grid { grid-template-columns: 1fr 1fr; }",
      "}",
      "@media (min-width: 1024px) {",
      "  #researchMD .rmd-project-grid { grid-template-columns: 1fr 1fr 1fr; }",
      "}",
      "/* Phase 2: shell screen tabs */",
      "#researchMD .rmd-shell-tabs { display: flex; gap: 6px; padding: 8px 14px; overflow-x: auto; background: var(--rmd-panel); border-bottom: 1px solid var(--rmd-line); scrollbar-width: none; }",
      "#researchMD .rmd-shell-tabs::-webkit-scrollbar { display: none; }",
      "#researchMD .rmd-tab { flex: 0 0 auto; border: 0; background: none; font: 500 13px var(--rmd-f); color: var(--rmd-mut); padding: 7px 12px; border-radius: 999px; cursor: pointer; min-height: 34px; touch-action: manipulation; }",
      "#researchMD .rmd-tab:hover { background: var(--rmd-fill); color: var(--rmd-ink); }",
      "#researchMD .rmd-tab-active { background: var(--rmd-acc-soft); color: var(--rmd-acc); font-weight: 600; }",
      "#researchMD button:focus-visible, #researchMD a:focus-visible { outline: 2px solid var(--rmd-acc); outline-offset: 2px; }",
      "/* Phase 2: shared screen scaffolding */",
      "#researchMD .rmd-p2-screen { padding: 16px 16px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1080px; margin: 0 auto; width: 100%; }",
      "#researchMD .rmd-p2-cols { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }",
      "#researchMD .rmd-banner { border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; align-items: flex-start; }",
      "#researchMD .rmd-banner-error { background: var(--rmd-bad-soft); border: 1px solid var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-banner-warn { background: var(--rmd-warn-soft); border: 1px solid var(--rmd-warn); color: var(--rmd-warn); }",
      "#researchMD .rmd-banner-info { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); color: var(--rmd-acc); }",
      "#researchMD .rmd-banner-code { font: 500 11.5px var(--rmd-mono); opacity: 0.85; }",
      "#researchMD .rmd-loading { padding: 32px 16px; text-align: center; color: var(--rmd-mut); font-size: 13.5px; }",
      "#researchMD .rmd-muted { color: var(--rmd-mut); }",
      "#researchMD .rmd-mono-sm { font: 500 12px var(--rmd-mono); overflow-wrap: anywhere; }",
      "#researchMD .rmd-row-btn { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--rmd-line); background: none; padding: 12px 16px; cursor: pointer; font: 400 14px var(--rmd-f); color: var(--rmd-ink); touch-action: manipulation; }",
      "#researchMD .rmd-row-btn:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-row-selected { background: var(--rmd-acc-soft); outline: 2px solid var(--rmd-acc); outline-offset: -2px; }",
      "#researchMD .rmd-row-title { font-weight: 600; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }",
      "#researchMD .rmd-row-meta { font-size: 12px; color: var(--rmd-mut); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-item-title { margin: 0; font: 600 16px/1.4 var(--rmd-f); overflow-wrap: anywhere; }",
      "#researchMD .rmd-item-meta { font-size: 12.5px; color: var(--rmd-mut); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
      "#researchMD .rmd-abstract-box { background: var(--rmd-fill); border-radius: 8px; padding: 12px 14px; max-height: 240px; overflow-y: auto; overscroll-behavior: contain; font-size: 13.5px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }",
      "/* Phase 2: protocol */",
      "#researchMD .rmd-field-list { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-field-list-row { display: flex; gap: 8px; align-items: center; }",
      "#researchMD .rmd-field-list-row input { flex: 1; min-width: 0; }",
      "#researchMD .rmd-lock-box { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }",
      "#researchMD .rmd-lock-hash { font: 500 12px var(--rmd-mono); overflow-wrap: anywhere; color: var(--rmd-ink); }",
      "#researchMD .rmd-proto-view { display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }",
      "#researchMD .rmd-proto-view dt { font: 600 12px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); margin-top: 6px; }",
      "#researchMD .rmd-proto-view dd { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }",
      "#researchMD .rmd-proto-view ul { margin: 2px 0 0; padding-left: 18px; }",
      "/* Phase 2: screening votes */",
      "#researchMD .rmd-vote-bar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }",
      "#researchMD .rmd-vote-btn { border: 1px solid var(--rmd-line); border-radius: 10px; min-height: 54px; font: 600 15px var(--rmd-f); cursor: pointer; touch-action: manipulation; background: var(--rmd-panel); color: var(--rmd-ink); }",
      "#researchMD .rmd-vote-btn:active { opacity: 0.7; }",
      "#researchMD .rmd-vote-include { background: var(--rmd-acc-soft); border-color: var(--rmd-acc); color: var(--rmd-acc); }",
      "#researchMD .rmd-vote-exclude { background: var(--rmd-bad-soft); border-color: var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-vote-uncertain { background: var(--rmd-warn-soft); border-color: var(--rmd-warn); color: var(--rmd-warn); }",
      "#researchMD .rmd-vote-btn[disabled] { opacity: 0.45; cursor: default; }",
      "#researchMD .rmd-reason-grid { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-reason-chip { border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); border-radius: 999px; padding: 8px 14px; font: 500 13px var(--rmd-f); cursor: pointer; min-height: 38px; touch-action: manipulation; }",
      "#researchMD .rmd-reason-chip:hover { border-color: var(--rmd-bad); color: var(--rmd-bad); }",
      "#researchMD .rmd-votes-box { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-vote-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; background: var(--rmd-fill); border-radius: 8px; padding: 8px 12px; }",
      "#researchMD .rmd-vote-who { font: 600 11.5px var(--rmd-f); text-transform: uppercase; letter-spacing: 0.04em; color: var(--rmd-mut); min-width: 52px; }",
      "#researchMD .rmd-peer-hidden { color: var(--rmd-mut); font-style: italic; }",
      "#researchMD .rmd-decision-include { color: var(--rmd-acc); font-weight: 600; }",
      "#researchMD .rmd-decision-exclude { color: var(--rmd-bad); font-weight: 600; }",
      "#researchMD .rmd-decision-uncertain { color: var(--rmd-warn); font-weight: 600; }",
      "#researchMD .rmd-progress-line { font: 500 12.5px var(--rmd-f); color: var(--rmd-mut); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }",
      "/* Phase 2: PRISMA */",
      "#researchMD .rmd-prisma-svg { width: 100%; min-width: 560px; height: auto; display: block; }",
      "#researchMD .rmd-count-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }",
      "#researchMD .rmd-count-table td { padding: 8px 10px; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-count-table td:last-child { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }",
      "/* Phase 2: responsive */",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-p2-cols { grid-template-columns: minmax(300px, 380px) 1fr; }",
      "  #researchMD .rmd-p2-screen { padding: 20px 22px 56px; }",
      "}",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-vote-btn { min-height: 58px; }",
      "}",
      "/* Phase 3: PDF viewer (offline word-box render) */",
      "#researchMD .rmd-pdf-layout { display: grid; grid-template-columns: 1fr; gap: 16px; padding: 16px; flex: 1; min-height: 0; overflow-y: auto; }",
      "#researchMD .rmd-pdf-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }",
      "#researchMD .rmd-pdf-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }",
      "#researchMD .rmd-pdf-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
      "#researchMD .rmd-pdf-pageind { font: 500 13px var(--rmd-f); color: var(--rmd-mut); display: inline-flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-pdf-pageind input { width: 64px; padding: 5px 8px; }",
      "#researchMD .rmd-pdf-scroll { overflow: auto; max-width: 100%; max-height: 72vh; background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 0; -webkit-overflow-scrolling: touch; }",
      "#researchMD .rmd-pdf-page { position: relative; overflow: hidden; background: #fbfaf7; margin: 0 auto; box-shadow: 0 1px 4px rgba(0,0,0,0.18); }",
      "#researchMD .rmd-pdf-word { position: absolute; white-space: nowrap; color: #16202a; font-family: Georgia, 'Times New Roman', serif; line-height: 1; cursor: text; }",
      "#researchMD .rmd-pdf-highlight { position: absolute; border: 2px solid #37b8a6; background: rgba(55,184,166,0.22); border-radius: 2px; pointer-events: none; }",
      "#researchMD .rmd-pdf-ocr { margin: 0; }",
      "#researchMD .rmd-pdf-hint { font-size: 12px; margin: 0; }",
      "/* Phase 3: extraction form */",
      "#researchMD .rmd-extract-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
      "#researchMD .rmd-extract-form-body { padding: 14px 16px 40px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }",
      "#researchMD .rmd-extract-field { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; background: var(--rmd-panel); }",
      "#researchMD .rmd-extract-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-extract-field-head label { font: 600 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-extract-field-actions { display: flex; flex-wrap: wrap; gap: 6px; }",
      "#researchMD .rmd-extract-noquote { font-size: 12px; margin: 0; }",
      "#researchMD .rmd-extract-save-row { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-suggestion { border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--rmd-fill); }",
      "#researchMD .rmd-suggestion-head { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-suggestion-val { font: 600 15px var(--rmd-mono); color: var(--rmd-ink); }",
      "#researchMD .rmd-audit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; border-bottom: 1px solid var(--rmd-line); padding: 7px 0; }",
      "/* Phase 3: risk of bias */",
      "#researchMD .rmd-rob-tools { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-rob-domain { border: 1px solid var(--rmd-line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 9px; background: var(--rmd-panel); }",
      "#researchMD .rmd-rob-domain-label { margin: 0; font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-rob-sq { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-rob-sq-row { display: grid; grid-template-columns: 1fr 84px; gap: 8px; align-items: center; }",
      "#researchMD .rmd-rob-sq-text { font-size: 12px; color: var(--rmd-mut); line-height: 1.35; }",
      "#researchMD .rmd-rob-stars { display: flex; gap: 6px; flex-wrap: wrap; }",
      "#researchMD .rmd-rob-summary { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-rob-summary-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-rob-summary-label { font-size: 12.5px; color: var(--rmd-ink); }",
      "#researchMD .rmd-light { font: 600 11.5px var(--rmd-f); border-radius: 999px; padding: 3px 10px; border: 1px solid transparent; white-space: nowrap; }",
      "#researchMD .rmd-light-low { background: var(--rmd-acc-soft); color: var(--rmd-acc); border-color: var(--rmd-acc); }",
      "#researchMD .rmd-light-mid { background: var(--rmd-warn-soft); color: var(--rmd-warn); border-color: var(--rmd-warn); }",
      "#researchMD .rmd-light-high { background: var(--rmd-bad-soft); color: var(--rmd-bad); border-color: var(--rmd-bad); }",
      "#researchMD .rmd-light-none { background: var(--rmd-fill); color: var(--rmd-mut); border-color: var(--rmd-line); }",
      "#researchMD .rmd-rob-overall { font-size: 13.5px; display: flex; align-items: center; gap: 8px; margin: 8px 0 0; }",
      "#researchMD .rmd-rob-source { font-size: 11.5px; margin: 6px 0 0; }",
      "#researchMD .rmd-rob-consensus { border-top: 1px solid var(--rmd-line); padding-top: 12px; }",
      "#researchMD .rmd-rob-summary-pane { display: flex; flex-direction: column; gap: 16px; }",
      "/* Phase 3: data import */",
      "#researchMD .rmd-data-checks { display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-data-check { display: grid; grid-template-columns: auto auto auto 1fr; gap: 8px; align-items: center; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }",
      "#researchMD .rmd-data-check-error { background: var(--rmd-bad-soft); }",
      "#researchMD .rmd-data-check-warning { background: var(--rmd-warn-soft); }",
      "#researchMD .rmd-data-check-msg { color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-data-versions { display: flex; flex-direction: column; }",
      "#researchMD .rmd-data-dict-cols { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-data-dict-col { display: grid; grid-template-columns: 1fr 110px auto; gap: 8px; align-items: center; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 8px 10px; }",
      "#researchMD .rmd-data-dict-name { color: var(--rmd-ink); }",
      "#researchMD .rmd-data-req { font-size: 12px; white-space: nowrap; }",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-pdf-layout { grid-template-columns: minmax(0, 1fr) 300px; padding: 18px 22px 40px; }",
      "}",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-extract-selects { grid-template-columns: 1fr; }",
      "  #researchMD .rmd-data-check { grid-template-columns: auto auto 1fr; }",
      "  #researchMD .rmd-data-check-msg { grid-column: 1 / -1; }",
      "  #researchMD .rmd-data-dict-col { grid-template-columns: 1fr auto; }",
      "  #researchMD .rmd-data-dict-col select { grid-column: 1 / -1; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  function getSyncBadgeHtml(syncState, queueCount) {
    if (syncState === "conflict") {
      return '<span class="rmd-sync-pill rmd-sync-conflict" id="rmdSyncBadge"><svg width="8" height="8" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg> Conflict 409</span>';
    }
    if (syncState === "queue" && queueCount > 0) {
      return '<span class="rmd-sync-pill rmd-sync-queue" id="rmdSyncBadge"><svg width="8" height="8" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg> Queue (' + queueCount + ')</span>';
    }
    return '<span class="rmd-sync-pill rmd-sync-synced" id="rmdSyncBadge"><svg width="8" height="8" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg> Synced</span>';
  }

  function renderShell() {
    if (!root) {
      root = D.createElement("div");
      root.id = "researchMD";
      root.setAttribute("hidden", "true");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "ResearchMD");
      D.body.appendChild(root);
    }

    var store = SMD.store;
    var syncState = store ? store.getState().syncState : "synced";
    var queueCount = store ? store.getQueue().length : 0;
    var showBack = currentScreen !== "projects" && navStack.length > 0;

    var h = [];
    h.push('<div class="rmd-shell-top">');
    h.push('  <div class="rmd-shell-nav">');
    if (showBack) {
      h.push('    <button type="button" class="rmd-nav-back" data-rmd="back">');
      h.push('      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"></polyline></svg>');
      h.push('      <span>Back</span>');
      h.push('    </button>');
    } else {
      h.push('    <div class="rmd-shell-brand">');
      h.push('      <strong>ResearchMD</strong>');
      h.push('      <span>Meta-Analysis</span>');
      h.push('    </div>');
    }
    h.push('  </div>');

    h.push('  <div class="rmd-shell-center"></div>');

    h.push('  <div class="rmd-shell-right">');
    h.push(getSyncBadgeHtml(syncState, queueCount));
    h.push('    <button type="button" class="rmd-shell-close" data-rmd="close" aria-label="Close ResearchMD">Close</button>');
    h.push('  </div>');
    h.push('</div>');

    if (currentScreen !== "projects") {
      var tabs = [
        ["studies", "Studies"],
        ["protocol", "Protocol"],
        ["search", "Search"],
        ["screening", "Screening"],
        ["conflicts", "Conflicts"],
        ["prisma", "PRISMA"],
        ["pdf", "PDF"],
        ["extract", "Extract"],
        ["rob", "Risk of Bias"],
        ["data", "Data"],
        ["run", "Run"],
        ["grade", "GRADE"],
        ["manuscript", "Manuscript"],
        ["checklist", "Checklist"],
        ["ipd", "IPD"],
        ["credits", "Credits"],
        ["institution", "Institution"],
        ["templates", "Templates"],
        ["journals", "Journals"]
      ];
      h.push('<nav class="rmd-shell-tabs" aria-label="Research screens">');
      for (var t = 0; t < tabs.length; t++) {
        var active = currentScreen === tabs[t][0];
        h.push('<button type="button" class="rmd-tab' + (active ? ' rmd-tab-active' : '') + '" data-rmd-tab="' + tabs[t][0] + '"' + (active ? ' aria-current="page"' : '') + '>' + tabs[t][1] + '</button>');
      }
      h.push('</nav>');
    }

    h.push('<div class="rmd-shell-body" id="rmdScreenBody"></div>');

    root.innerHTML = h.join("\n");
    bindShellEvents();
  }

  function bindShellEvents() {
    if (!root) return;

    var closeBtn = root.querySelector('[data-rmd="close"]');
    if (closeBtn) {
      closeBtn.onclick = function () {
        close();
      };
    }

    var backBtn = root.querySelector('[data-rmd="back"]');
    if (backBtn) {
      backBtn.onclick = function () {
        if (navStack.length > 0) {
          var prev = navStack.pop();
          navigate(prev.screen, prev.params, true);
        } else {
          navigate("projects", {}, true);
        }
      };
    }

    var tabBtns = root.querySelectorAll("[data-rmd-tab]");
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].onclick = function () {
        var name = this.getAttribute("data-rmd-tab");
        if (name && name !== currentScreen) navigate(name, {});
      };
    }
  }

  function navigate(screenName, params, isBack) {
    if (!isBack && currentScreen && currentScreen !== screenName) {
      navStack.push({ screen: currentScreen, params: {} });
    }
    currentScreen = screenName;
    renderShell();

    var body = root.querySelector("#rmdScreenBody");
    if (!body) return;

    var screen = SMD.screens && SMD.screens[screenName];
    if (screen && screen.render) {
      screen.render(body);
    } else if (SMD.screens && SMD.screens.projects) {
      SMD.screens.projects.render(body);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" || e.keyCode === 27) {
      close();
    }
  }

  function open(opts) {
    injectCSS();
    if (SMD.store) SMD.store.init();

    if (opts && opts.projectId && SMD.store) {
      SMD.store.setActiveProject(opts.projectId);
      currentScreen = "studies";
    } else if (opts && opts.screen) {
      currentScreen = opts.screen;
    } else {
      currentScreen = (SMD.store && SMD.store.getActiveProject()) ? "studies" : "projects";
    }
    navStack = [];

    renderShell();
    if (root) {
      root.removeAttribute("hidden");
    }
    if (D.body) {
      D.body.classList.add("smd-research-open");
    }

    navigate(currentScreen, opts || {});
    if (D) D.addEventListener("keydown", onKeyDown);

    // Subscribe to store updates to keep sync badge and screen updated
    if (SMD.store) {
      SMD.store.subscribe(function (state) {
        var badge = root ? root.querySelector("#rmdSyncBadge") : null;
        if (badge && badge.parentNode) {
          badge.outerHTML = getSyncBadgeHtml(state.syncState, (state.offlineQueue || []).length);
        }
        if (currentScreen === "studies" && root) {
          var body = root.querySelector("#rmdScreenBody");
          if (body && SMD.screens && SMD.screens.studies) {
            SMD.screens.studies.render(body);
          }
        }
      });
    }
  }

  function close() {
    if (root) {
      root.setAttribute("hidden", "true");
    }
    if (D.body) {
      D.body.classList.remove("smd-research-open");
    }
    if (D) D.removeEventListener("keydown", onKeyDown);
  }

  var SHELL = {
    version: "rmd1",
    on: on,
    open: open,
    close: close,
    navigate: navigate,
    esc: esc
  };

  for (var k in SHELL) {
    SMD[k] = SHELL[k];
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SMD;
  }

})(typeof window !== "undefined" ? window : globalThis);
