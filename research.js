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
  }

  function navigate(screenName, params, isBack) {
    if (!isBack && currentScreen && currentScreen !== screenName) {
      navStack.push({ screen: currentScreen, params: {} });
    }
    currentScreen = screenName;
    renderShell();

    var body = root.querySelector("#rmdScreenBody");
    if (!body) return;

    if (screenName === "projects" && SMD.screens && SMD.screens.projects) {
      SMD.screens.projects.render(body);
    } else if (screenName === "studies" && SMD.screens && SMD.screens.studies) {
      SMD.screens.studies.render(body);
    } else if (screenName === "run" && SMD.screens && SMD.screens.run) {
      SMD.screens.run.render(body);
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
