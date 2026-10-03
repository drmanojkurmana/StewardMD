/* StewardMD - Neonatal hub (window.SMD_NEO_HUB). Flag smd_neo, DEFAULT ON (Beta). vault/modules/Neonatal.md.
 *
 * Plain-language pass (owner 2026-10-01: "make it more user friendly, easily understood by anyone, without
 * removing any function"): tools grouped by task with everyday names, one line on every screen saying what it
 * does, the baby shown in words, abbreviations explained once in a glossary, answers before workings.
 *
 * One NICU workspace: the baby record (neo-patient.js) is pinned at the top of every screen and
 * editable in one tap; the tools (neo-*.js) register here and read the same record. Shared pieces:
 * lazy data loader for data/neo/*.json, Draft badge, source line (title, licence, verbatim quote),
 * "No data on file", independent second check for high-alert drugs, Copy / Print (infusion-actions.js
 * SMD_PRINT, WebView-safe). Nothing here stores patient data: the record is memory only.
 *
 * Tool contract: register({ id, flag, title, sub, icon, kw, render(body, api), order }).
 *   render gets a fresh container each time the screen opens and on every record change.
 * z-index 10040: under the dose calculator (10050), so "Dose" can open it on top and closing it
 * returns here.
 */
(function (G) {
  "use strict";
  var D = G.document, FL = function () { return G.SMD_NEO_FLAGS; };
  var VER = "neo3";
  var TOOLS = [], root = null, cur = "home", curOpts = null, editing = false;

  function on() { return !!(FL() && FL().on()); }
  function featureOn(f) { return !!(FL() && (f ? FL().feature(f) : FL().on())); }

  /* ---------------- helpers ---------------- */
  function clean(s) { return String(s == null ? "" : s).replace(/[–—−]/g, "-"); }
  function esc(s) { return clean(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // Privacy mode (privacy-mode.js): wrap a patient name so it can be masked on screen; plain esc() without it.
  function phi(kind, v, html) { var P = G.SMD_PRIVACY_MODE; return P ? P.wrap(kind, v, html) : (html == null ? esc(v) : html); }
  function fmt(v, dp) { if (v == null || !isFinite(v)) return ""; var p = Math.pow(10, dp == null ? 2 : dp); return (Math.round(v * p) / p).toLocaleString("en-IN", { maximumFractionDigits: dp == null ? 2 : dp }); }
  var cache = {}, pend = {};
  function data(name) {
    if (cache[name]) return Promise.resolve(cache[name]);
    if (pend[name]) return pend[name];
    pend[name] = fetch("/data/neo/" + name + ".json?v=" + VER).then(function (r) { if (!r.ok) throw new Error(name + " " + r.status); return r.json(); })
      .then(function (j) { cache[name] = j; delete pend[name]; return j; }, function (e) { delete pend[name]; throw e; });
    return pend[name];
  }
  /* A file that is missing or unreadable resolves to null: the screen shows "No data on file". */
  function dataOrNull(name) { return data(name).then(null, function () { return null; }); }
  function badge(doc) {
    var rv = (doc && doc.review) || {};
    if (rv.status && rv.status !== "ai_drafted" && rv.by) return '<span class="nh-ok">Reviewed by ' + esc(rv.by) + (rv.date ? ", " + esc(rv.date) : "") + "</span>";
    return '<span class="nh-draft" title="AI-drafted from the cited sources; not yet approved by a neonatologist">Draft</span>';
  }
  function srcLine(doc, item) {
    if (!doc || !item || !item.src) return "";
    var s = (doc.sources || {})[item.src] || {};
    return '<details class="nh-src"><summary>Where this comes from</summary><div style="font-weight:600;color:var(--nh-ink)">' + esc(s.title || item.src) + "</div>" +
      (item.quote ? '<blockquote>"' + esc(item.quote) + '"</blockquote>' : "") +
      '<div class="nh-srcm">' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.publisher || s.url) + "</a>" : "") + (s.licence ? " · Licence: " + esc(s.licence) : "") + (s.accessed ? " · Accessed " + esc(s.accessed) : "") + "</div></details>";
  }
  function noData(what) { return '<div class="nh-none">No data on file' + (what ? " for " + esc(what) : "") + ".</div>"; }
  function note(t, kind) { return '<div class="nh-note' + (kind ? " " + kind : "") + '">' + esc(t) + "</div>"; }
  function haptic() { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS.light) G.SMD_HAPTICS.light(); } catch (e) {} }
  function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }

  /* Independent second check for high-alert drugs: Copy and Print stay disabled until it is ticked.
   * The tick lives only in this screen's DOM; nothing is stored. */
  function secondCheckHtml(drugName) {
    return '<div class="nh-2c" data-2c="1"><b>High-alert drug.</b> Get an independent second check of ' + esc(drugName) + ": dose, concentration and pump rate, before giving it." +
      '<label class="nh-2cl"><input type="checkbox" data-2c-tick="1"> A second clinician checked it independently</label></div>';
  }
  /* Copy / Print bar. lines: array of strings; the sheet uses them verbatim. */
  function actionsHtml(id) { return '<div class="nh-acts" data-acts="' + esc(id) + '"><button type="button" class="nh-btn" data-act="copy">Copy</button><button type="button" class="nh-btn" data-act="print">Print</button></div>'; }
  var sheets = {};
  function setSheet(id, sheet) { sheets[id] = sheet; }
  function sheetText(sh) {
    var when = ""; try { when = new Date().toLocaleString(); } catch (e) {}
    return "StewardMD: " + sh.title + "\n\n" + sh.lines.join("\n") + "\n\nDraft neonatal decision support, not yet clinician-approved. Verify every value before use." + (when ? "\n" + when : "");
  }
  function doAct(btn) {
    var bar = btn.closest("[data-acts]"), id = bar && bar.getAttribute("data-acts"), sh = sheets[id]; if (!sh) return;
    var scope = btn.closest(".nh-card") || root, chk = scope.querySelector("[data-2c-tick]");
    if (chk && !chk.checked) { toast("High-alert drug: tick the independent second check first."); var box = scope.querySelector("[data-2c]"); if (box) box.classList.add("nh-shake"); return; }
    var P = G.SMD_PRINT;
    if (btn.getAttribute("data-act") === "copy") {
      var txt = sheetText(sh);
      // A clipboard permission prompt can leave the promise pending (headless, some WebViews): give up after 2 s.
      Promise.race([P && P.copy ? P.copy(txt) : Promise.resolve(false), new Promise(function (r) { setTimeout(function () { r(false); }, 2000); })]).then(function (ok) { var o = btn.textContent; btn.textContent = ok ? "Copied" : "Copy failed"; setTimeout(function () { btn.textContent = o; }, 1500); });
    } else if (P && P.print) {
      P.print({ title: sh.title, tag: sh.tag || "Neonatal", lines: sh.lines, strong: /^(dose|give|draw up|set pump|rate|result|gir|bag):/i, footer: "Draft neonatal decision support, not yet approved by a neonatologist. Verify every dose, concentration and rate before use." });
    }
  }

  /* ---------------- styles ---------------- */
  function css() {
    if (D.getElementById("nhCss")) return;
    var s = D.createElement("style"); s.id = "nhCss";
    var rules = [
      "#neoHub{--nh-bg:#f4f7f6;--nh-panel:#fff;--nh-ink:#12202a;--nh-mut:#5b6b75;--nh-line:#dce4e2;--nh-acc:#0f766e;--nh-acc-soft:#e3f2ef;--nh-warn:#9a5b00;--nh-warn-soft:#fff3dd;--nh-bad:#b42318;--nh-bad-soft:#fdecea;--nh-f:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--nh-mono:ui-monospace,'SF Mono',Menlo,monospace;position:fixed;inset:0;z-index:10040;background:var(--nh-bg);color:var(--nh-ink);font:15px/1.45 var(--nh-f);display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}",
      "#neoHub[hidden]{display:none!important}",
      "body.dark #neoHub,body.v3-dark #neoHub{--nh-bg:#0d1417;--nh-panel:#151f23;--nh-ink:#e3ecea;--nh-mut:#93a4a8;--nh-line:#26363b;--nh-acc:#37b8a6;--nh-acc-soft:#153430;--nh-warn:#f0b454;--nh-warn-soft:#352812;--nh-bad:#ff7b6e;--nh-bad-soft:#3a1714}",
      "#neoHub *{box-sizing:border-box}",
      "#neoHub .nh-top{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;border-bottom:1px solid var(--nh-line);background:var(--nh-panel)}",
      "#neoHub .nh-x{border:0;background:none;color:var(--nh-acc);font:600 16px var(--nh-f);padding:6px 4px;min-height:44px;min-width:44px;cursor:pointer;text-align:left}",
      "#neoHub .nh-t{flex:1;min-width:0;font:700 17px var(--nh-f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#neoHub .nh-body{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 30px);display:flex;flex-direction:column;gap:12px}",
      "#neoHub .nh-baby{position:sticky;top:-12px;z-index:2;background:var(--nh-panel);border:1px solid var(--nh-line);border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px -6px rgba(0,0,0,.4)}",
      "#neoHub .nh-bsum{flex:1;min-width:0;font:600 14px var(--nh-f);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}#neoHub .nh-bsum small{display:block;font:500 12px var(--nh-f);color:var(--nh-mut)}",
      "#neoHub .nh-card{background:var(--nh-panel);border:1px solid var(--nh-line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;min-width:0}",
      "#neoHub h3{margin:0;font:700 13px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:var(--nh-mut);display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      "#neoHub .nh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
      "#neoHub label{display:flex;flex-direction:column;gap:4px;font:600 12.5px var(--nh-f);color:var(--nh-mut);min-width:0}",
      "#neoHub .nh-u{display:flex;align-items:center;gap:6px}#neoHub .nh-u input{flex:1;min-width:0}#neoHub .nh-u span{flex:0 0 auto;font:600 13px var(--nh-f);color:var(--nh-mut)}",
      "#neoHub input,#neoHub select{width:100%;font:500 16px var(--nh-f);color:var(--nh-ink);background:var(--nh-bg);border:1.5px solid var(--nh-line);border-radius:10px;padding:10px 11px;min-height:44px;-webkit-appearance:none;appearance:none;min-width:0}",
      "#neoHub input[type=checkbox]{width:22px;height:22px;min-height:0;padding:0;-webkit-appearance:checkbox;appearance:auto;flex:0 0 auto}",
      "#neoHub input:focus,#neoHub select:focus{outline:none;border-color:var(--nh-acc)}",
      "#neoHub .nh-full{grid-column:1/-1}",
      "#neoHub .nh-seg{display:flex;border:1.5px solid var(--nh-line);border-radius:10px;overflow:hidden;min-height:44px}#neoHub .nh-seg button{flex:1;border:0;background:var(--nh-bg);color:var(--nh-ink);font:600 14px var(--nh-f);cursor:pointer;min-height:44px}#neoHub .nh-seg button+button{border-left:1.5px solid var(--nh-line)}#neoHub .nh-seg button[aria-pressed=true]{background:var(--nh-acc);color:#fff}",
      // Tabs that wrap (growth has six): a grid of pills, never a sideways scroll at 360 px.
      "#neoHub .nh-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}#neoHub .nh-tabs button{border:1.5px solid var(--nh-line);border-radius:10px;background:var(--nh-bg);color:var(--nh-ink);font:600 13.5px var(--nh-f);min-height:44px;padding:4px 6px;cursor:pointer;line-height:1.2}#neoHub .nh-tabs button[aria-pressed=true]{background:var(--nh-acc);border-color:var(--nh-acc);color:#fff}",
      "#neoHub .nh-btn{border:1.5px solid var(--nh-acc);color:var(--nh-acc);background:transparent;border-radius:10px;font:600 14px var(--nh-f);padding:8px 12px;min-height:44px;cursor:pointer}#neoHub .nh-btn.pri{background:var(--nh-acc);color:#fff}",
      "#neoHub .nh-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
      "#neoHub .nh-tool{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;border:1px solid var(--nh-line);background:var(--nh-panel);color:var(--nh-ink);border-radius:14px;padding:12px;min-height:84px;cursor:pointer;font:700 15px var(--nh-f);min-width:0}#neoHub .nh-tool small{font:500 12.5px var(--nh-f);color:var(--nh-mut)}#neoHub .nh-tool .material-symbols-rounded{color:var(--nh-acc);font-size:24px}",
      "#neoHub .nh-beta{display:inline-block;vertical-align:middle;font:700 10px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--nh-acc);border-radius:6px;padding:3px 6px;margin-left:4px}",
      "#neoHub .nh-draft{font:700 10.5px var(--nh-f);letter-spacing:.05em;text-transform:uppercase;color:var(--nh-warn);background:var(--nh-warn-soft);border-radius:999px;padding:3px 8px}",
      "#neoHub .nh-ok{font:700 10.5px var(--nh-f);color:var(--nh-acc);background:var(--nh-acc-soft);border-radius:999px;padding:3px 8px}",
      "#neoHub .nh-val{font:700 24px/1.2 var(--nh-f);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}#neoHub .nh-lbl{font:700 11px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:var(--nh-acc)}",
      "#neoHub .nh-work{font:500 13px/1.45 var(--nh-f);color:var(--nh-mut);overflow-wrap:anywhere}",
      "#neoHub .nh-intro{font:500 14px/1.45 var(--nh-f);color:var(--nh-ink);background:var(--nh-acc-soft);border-radius:12px;padding:10px 12px}",
      "#neoHub .nh-sec{font:700 12px var(--nh-f);letter-spacing:.06em;text-transform:uppercase;color:var(--nh-mut);margin:6px 2px -2px}",
      "#neoHub .nh-facts.sm{gap:2px 6px}#neoHub .nh-facts.sm .nh-fact{border:0;background:none;padding:0;font-size:13px;white-space:normal}#neoHub .nh-facts.sm .nh-fact+.nh-fact::before{content:\"\\00b7  \";color:var(--nh-mut)}#neoHub .nh-facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}#neoHub .nh-fact{font:600 12.5px var(--nh-f);color:var(--nh-ink);background:var(--nh-bg);border:1px solid var(--nh-line);border-radius:999px;padding:3px 9px;white-space:nowrap}#neoHub .nh-fact.miss{color:var(--nh-warn);border-color:var(--nh-warn-soft);background:var(--nh-warn-soft)}",
      "#neoHub .nh-hint{font:500 12px var(--nh-f);color:var(--nh-mut);margin-top:-2px}",
      "#neoHub .nh-answer{background:var(--nh-acc-soft);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:4px}#neoHub .nh-answer .nh-val{color:var(--nh-ink)}",
      "#neoHub .nh-gloss dt{font:700 13px var(--nh-f);margin-top:8px}#neoHub .nh-gloss dd{margin:2px 0 0;font:500 13px/1.45 var(--nh-f);color:var(--nh-mut)}",
      "#neoHub details>summary{cursor:pointer;min-height:36px;display:flex;align-items:center;font:600 13.5px var(--nh-f);color:var(--nh-acc)}",
      "#neoHub .nh-chip{display:inline-block;font:700 11px var(--nh-f);border-radius:999px;padding:2px 8px;white-space:nowrap}#neoHub .nh-chip.calc{color:#fff;background:var(--nh-acc)}#neoHub .nh-chip.mono{color:var(--nh-acc);background:var(--nh-acc-soft)}#neoHub .nh-chip.info{color:var(--nh-warn);background:var(--nh-warn-soft)}#neoHub .nh-chip.none{color:var(--nh-mut);background:var(--nh-bg);border:1px solid var(--nh-line)}",
      "#neoHub .nh-row{border-top:1px solid var(--nh-line);padding-top:10px;display:flex;flex-direction:column;gap:6px;min-width:0}#neoHub .nh-row:first-child{border-top:0;padding-top:0}",
      "#neoHub .nh-note{font:500 13px var(--nh-f);color:var(--nh-warn);background:var(--nh-warn-soft);border-radius:9px;padding:7px 10px}#neoHub .nh-note.bad{color:var(--nh-bad);background:var(--nh-bad-soft);font-weight:700}#neoHub .nh-note.info{color:var(--nh-mut);background:var(--nh-bg)}",
      "#neoHub .nh-none{font:600 14px var(--nh-f);color:var(--nh-mut);background:var(--nh-bg);border:1px dashed var(--nh-line);border-radius:10px;padding:10px 12px}",
      "#neoHub .nh-src{font:500 12.5px/1.5 var(--nh-f);color:var(--nh-mut);border-left:3px solid var(--nh-line);padding-left:9px}#neoHub .nh-src summary{cursor:pointer;min-height:32px;display:flex;align-items:center}#neoHub .nh-src blockquote{margin:6px 0;font:500 12.5px/1.5 var(--nh-mono);overflow-wrap:anywhere}#neoHub .nh-srcm{overflow-wrap:anywhere}#neoHub .nh-src a{color:var(--nh-acc)}",
      "#neoHub .nh-2c{font:500 13.5px var(--nh-f);color:var(--nh-bad);background:var(--nh-bad-soft);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}#neoHub .nh-2cl{flex-direction:row;align-items:center;gap:10px;color:var(--nh-ink);font:600 14px var(--nh-f)}",
      "#neoHub .nh-shake{animation:nhShake .3s}@keyframes nhShake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}",
      "#neoHub .nh-acts{display:flex;gap:10px}#neoHub .nh-acts .nh-btn{flex:1}",
      "#neoHub .nh-err{font:600 13.5px var(--nh-f);color:var(--nh-bad);background:var(--nh-bad-soft);border-radius:10px;padding:9px 12px}",
      "#neoHub .nh-tbl{width:100%;border-collapse:collapse;font:500 13.5px var(--nh-f);font-variant-numeric:tabular-nums}#neoHub .nh-tbl th,#neoHub .nh-tbl td{text-align:left;padding:7px 6px;border-top:1px solid var(--nh-line);vertical-align:top;overflow-wrap:anywhere}#neoHub .nh-tbl th{font:700 11.5px var(--nh-f);color:var(--nh-mut);text-transform:uppercase;letter-spacing:.04em}#neoHub .nh-tbl tr.hit td{background:var(--nh-acc-soft)}",
      "#neoHub .nh-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}",
      "#neoHub .nh-list{display:flex;flex-direction:column;min-width:0}#neoHub .nh-li>span{min-width:0;overflow-wrap:anywhere}#neoHub .nh-li>.nh-chip{flex-shrink:0}#neoHub .nh-li{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;border:0;border-top:1px solid var(--nh-line);background:none;color:var(--nh-ink);font:600 15px var(--nh-f);padding:11px 2px;min-height:44px;cursor:pointer;width:100%}#neoHub .nh-li:first-child{border-top:0}#neoHub .nh-li small{font:500 12.5px var(--nh-f);color:var(--nh-mut)}",
      "#neoHub svg{max-width:100%;height:auto;display:block}",
      "#neoHub .nh-foot{font:500 12px var(--nh-f);color:var(--nh-mut);text-align:center;padding:4px 8px}",
      "@media(min-width:720px){#neoHub .nh-body{max-width:760px;margin:0 auto;width:100%}#neoHub .nh-tools{grid-template-columns:repeat(3,minmax(0,1fr))}}"
    ];
    // The same look for the neonatal block the dose calculator embeds (.neo-blk inside #doseCalc).
    var blk = rules.filter(function (r) { return /^#neoHub /.test(r) && !/nh-top|nh-body|nh-baby|nh-x|nh-t\{/.test(r); }).map(function (r) { return r.replace(/#neoHub /g, ".neo-blk "); });
    blk.push(".neo-blk{--nh-bg:#f4f7f6;--nh-panel:#fff;--nh-ink:#12202a;--nh-mut:#5b6b75;--nh-line:#dce4e2;--nh-acc:#0f766e;--nh-acc-soft:#e3f2ef;--nh-warn:#9a5b00;--nh-warn-soft:#fff3dd;--nh-bad:#b42318;--nh-bad-soft:#fdecea;--nh-f:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--nh-mono:ui-monospace,'SF Mono',Menlo,monospace;display:flex;flex-direction:column;gap:10px;min-width:0}");
    blk.push("body.dark .neo-blk,body.v3-dark .neo-blk{--nh-bg:#0d1417;--nh-panel:#151f23;--nh-ink:#e3ecea;--nh-mut:#93a4a8;--nh-line:#26363b;--nh-acc:#37b8a6;--nh-acc-soft:#153430;--nh-warn:#f0b454;--nh-warn-soft:#352812;--nh-bad:#ff7b6e;--nh-bad-soft:#3a1714}");
    s.textContent = rules.concat(blk).join("\n");
    D.head.appendChild(s);
  }

  /* ---------------- baby record ---------------- */
  function neo() { return G.SMD_NEO; }
  /* The baby in words: what was entered and what follows from it, as chips anyone can read. */
  function facts(d) {
    var f = [];
    f.push(d.ga ? ["Born at " + d.ga.w + " weeks" + (d.ga.d ? " " + d.ga.d + " days" : ""), 0] : ["Add weeks at birth", 1]);
    if (d.pnaDays != null) f.push([(d.pnaDays < 4 ? d.pnaHours + " hours old" : d.pnaDays + " days old") + " (day " + d.dol + " of life)", 0]); else f.push(["Add date of birth", 1]);
    if (d.pma) f.push(["Corrected age " + d.pma.w + " weeks" + (d.pma.d ? " " + d.pma.d + " days" : ""), 0]);
    f.push(d.weightG != null ? [Math.round(d.weightG).toLocaleString("en-IN") + " g today", 0] : ["Add today's weight", 1]);
    if (d.birthWeightG != null) f.push([Math.round(d.birthWeightG).toLocaleString("en-IN") + " g at birth", 0]);
    if (d.sex) f.push([d.sex === "M" ? "Boy" : "Girl", 0]);
    return f;
  }
  function babyBar() {
    var N = neo(), d = N ? N.derived() : null, has = N && N.has();
    var head = has ? "Baby" : "No baby added yet";
    var chips = has ? '<div class="nh-facts' + (cur !== "home" && !editing ? " sm" : "") + '">' + facts(d).map(function (x) { return '<span class="nh-fact' + (x[1] ? " miss" : "") + '">' + esc(x[0]) + "</span>"; }).join("") + "</div>" : "<small>Add the baby once. Every tool uses these details.</small>";
    var err = d && d.errors.length ? '<small style="color:var(--nh-bad)">' + esc(d.errors[0]) + "</small>" : "";
    return '<div class="nh-baby" data-nh="babybar"><div class="nh-bsum">' + esc(head) + chips + err + '<span hidden>' + esc(N ? N.summary() : "") + '</span></div><button type="button" class="nh-btn' + (has ? "" : " pri") + '" data-nh="edit">' + (editing ? "Done" : has ? "Edit" : "Add baby") + "</button></div>";
  }
  function recordHtml() {
    var r = neo().get();
    function f(k, label, unit, ph, hint, mode) { return '<label>' + label + '<span class="nh-u"><input id="nh_' + k + '" data-rec="' + k + '" inputmode="' + (mode || "numeric") + '" autocomplete="off" value="' + esc(r[k]) + '" placeholder="' + esc(ph || "") + '">' + (unit ? "<span>" + unit + "</span>" : "") + "</span>" + (hint ? '<span class="nh-hint">' + hint + "</span>" : "") + "</label>"; }
    var d = neo().derived();
    return '<section class="nh-card" data-nh="record" aria-labelledby="nhRec"><h3 id="nhRec">Baby details</h3>' +
      '<div class="nh-hint" style="margin:0">Fill in what you know. Tools tell you if they need something else.</div><div class="nh-grid">' +
      f("gaW", "Weeks of pregnancy at birth", "weeks", "e.g. 30", "Gestational age (GA)") + f("gaD", "and days", "days", "0 to 6", "Extra days, 0 to 6") +
      '<label>Date of birth<input id="nh_dob" data-rec="dob" type="date" value="' + esc(r.dob) + '"></label>' +
      '<label>Time of birth<input id="nh_tob" data-rec="tob" type="time" value="' + esc(r.tob) + '"><span class="nh-hint">Gives age in hours (jaundice)</span></label>' +
      f("weightG", "Weight today", "grams", "e.g. 1250", "In grams, not kg") + f("birthWeightG", "Birth weight", "grams", "e.g. 1180", "In grams") +
      '<label class="nh-full">Sex<span class="nh-seg" role="group" aria-label="Sex"><button type="button" data-sex="M" aria-pressed="' + (r.sex === "M") + '">Boy</button><button type="button" data-sex="F" aria-pressed="' + (r.sex === "F") + '">Girl</button></span></label>' +
      "</div>" + (d.errors.length ? d.errors.map(function (e) { return '<div class="nh-err">' + esc(e) + "</div>"; }).join("") : "") +
      '<div class="nh-work" data-nh="derived">' + derivedTxt(d) + "</div>" +
      '<button type="button" class="nh-btn pri" data-nh="edit">Done</button>' +
      '<div class="nh-acts"><button type="button" class="nh-btn" data-nh="prefill">Use an ICU or OPD patient</button><button type="button" class="nh-btn" data-nh="clear">Clear</button></div>' +
      '<div class="nh-foot">Kept only on this phone, in memory. Cleared when you close the app or tap Clear.</div></section>';
  }
  function derivedTxt(d) {
    var p = [];
    if (d.pnaHours != null) p.push("Age: " + d.pnaHours + " hours, " + d.pnaDays + " days (day " + d.dol + " of life)" + (d.timed ? "" : ". Add the time of birth for exact hours"));
    if (d.pma) p.push("Corrected age (PMA, weeks at birth plus age): " + d.pma.w + " weeks " + d.pma.d + " days");
    if (d.corrected && !d.corrected.beforeTerm) p.push("Corrected age after term: " + d.corrected.text);
    return p.length ? "<b>Worked out for you</b><br>" + p.map(esc).join("<br>") : "";
  }

  /* ---------------- screens ---------------- */
  function visibleTools() { return TOOLS.filter(function (t) { return featureOn(t.flag); }).sort(function (a, b) { return (a.order || 99) - (b.order || 99); }); }
  function toolById(id) { for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].id === id) return TOOLS[i]; return null; }
  /* Everyday names, groups and a one-line "what this does" for every tool (the tool files keep their ids). */
  var FRIENDLY = {
    dose: { g: "Medicines", t: "Drug doses", s: "Any drug, dose for this baby", i: "Search any drug. You get the newborn dose for this baby, worked out from the baby's weight and age, with where it comes from. If there is no newborn dose on file, it says so." },
    prep: { g: "Medicines", t: "Prepare a dose", s: "Which vial, how to mix, how much to draw", i: "Enter the dose. It picks a vial and tells you how much fluid to add, how many mL to draw up and how many vials you need." },
    inf: { g: "Medicines", t: "Drip rates", s: "Dose to pump rate (mL/h) and back", i: "For drips such as dopamine or morphine: turn a dose into a pump rate in mL per hour, or a pump rate back into a dose." },
    tdm: { g: "Medicines", t: "Drug levels", s: "Vancomycin and gentamicin levels", i: "Enter blood levels to see the vancomycin exposure (AUC) or check a gentamicin level against the target." },
    fluids: { g: "Fluids and feeding", t: "Fluids and sugar", s: "Sugar rate (GIR), daily fluids, make a bag", i: "Work out how much sugar the drip gives (GIR), how much fluid a day, and how to mix a bag from the bottles you have." },
    growth: { g: "Check and chart", t: "Growth", s: "Centiles, weight gain, milestones, reflexes", i: "See where weight, length and head size sit on the growth charts, how fast the baby is gaining, and which milestones to expect." },
    bili: { g: "Check and chart", t: "Jaundice", s: "Bilirubin on the treatment chart", i: "Enter the bilirubin level and the age in hours. It shows whether the baby needs phototherapy or more, on the AAP or NICE chart." },
    scores: { g: "Check and chart", t: "Scores", s: "Withdrawal, pain, gestation, cooling", i: "Bedside scores for newborns: withdrawal (Finnegan), pain and sedation (N-PASS), gestation (Capurro), infection (Rodwell), cooling criteria and more." },
    ref: { g: "Check and chart", t: "Normal values", s: "Heart rate, breathing, CSF, blood", i: "Normal ranges for this baby's age: heart rate, breathing rate, spinal fluid (CSF) and blood counts." },
    proc: { g: "Procedures", t: "Lines and tubes", s: "UVC, UAC, breathing tube, PICC, exchange", i: "How far to insert an umbilical line or breathing tube, PICC length, exchange transfusion volume, and step-by-step guides." }
  };
  var GROUPS = ["Medicines", "Fluids and feeding", "Check and chart", "Procedures"];
  function homeHtml() {
    var ts = visibleTools(), h = '<div class="nh-intro">Newborn and NICU tools in one place. Add the baby above once, then pick a tool. Every number shows where it comes from. <b>Beta:</b> written with AI from published sources, not yet checked by a neonatologist. Always double-check.</div>';
    GROUPS.concat(["Other"]).forEach(function (g) {
      var mine = ts.filter(function (t) { return (FRIENDLY[t.id] ? FRIENDLY[t.id].g : "Other") === g; }); if (!mine.length) return;
      h += '<div class="nh-sec">' + esc(g) + '</div><div class="nh-tools">' + mine.map(function (t) { return '<button type="button" class="nh-tool" data-tool="' + esc(t.id) + '"><span class="material-symbols-rounded" aria-hidden="true">' + esc(t.icon || "child_care") + "</span>" + esc(t.title) + "<small>" + esc(t.sub || "") + "</small></button>"; }).join("") + "</div>";
    });
    return h + glossaryHtml();
  }
  function glossaryHtml() {
    var G2 = [["GA (gestational age)", "Weeks of pregnancy when the baby was born. A baby born at 34 weeks 5 days counts as 34 weeks."], ["PNA (postnatal age)", "How old the baby is now, in days or hours since birth."], ["Day of life", "The first 24 hours is day 1."], ["PMA (corrected age)", "Weeks at birth plus age now. A baby born at 30 weeks who is 2 weeks old is 32 weeks PMA."], ["GIR", "How much sugar the drip gives, in mg per kg per minute."], ["TSB", "Total serum bilirubin, the jaundice blood test."], ["mL/h", "Pump rate: millilitres per hour."], ["Draft", "Written with AI from the source shown, not yet approved by a neonatologist."]];
    return '<details class="nh-card nh-gloss"><summary>What do these words mean?</summary><dl>' + G2.map(function (x) { return "<dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd>"; }).join("") + "</dl></details>";
  }
  var API = null;
  function render() {
    if (!root) return;
    var body = root.querySelector(".nh-body"), t = cur !== "home" ? toolById(cur) : null;
    root.querySelector(".nh-t").innerHTML = esc(t ? t.title : "Neonatal") + ' <span class="nh-beta" title="Beta: AI-drafted from cited sources, awaiting neonatologist review">Beta</span>';
    root.querySelector("[data-nh=back]").textContent = t ? "‹ All tools" : "‹ Close";
    body.innerHTML = babyBar() + (editing ? recordHtml() : "") + '<div data-nh="screen"></div>';
    var scr = body.querySelector("[data-nh=screen]");
    if (!t) { scr.innerHTML = homeHtml(); return; }
    if (t.intro) scr.insertAdjacentHTML("beforebegin", '<div class="nh-intro" data-nh="intro">' + esc(t.intro) + "</div>");
    try { t.render(scr, API, curOpts || {}); } catch (e) { scr.innerHTML = '<div class="nh-err">This tool could not open. ' + esc(e && e.message) + "</div>"; }
  }
  function refreshRecordOnly() {
    if (!root) return;
    var bar = root.querySelector("[data-nh=babybar]"); if (bar) bar.outerHTML = babyBar();
    var rc = root.querySelector("[data-nh=record]");
    if (rc) {
      var d = neo().derived();
      var dv = rc.querySelector("[data-nh=derived]"); if (dv) dv.innerHTML = derivedTxt(d);
      rc.querySelectorAll(".nh-err").forEach(function (e) { e.remove(); });
      if (d.errors.length && dv) dv.insertAdjacentHTML("beforebegin", d.errors.map(function (e) { return '<div class="nh-err">' + esc(e) + "</div>"; }).join(""));
    }
    var t = cur !== "home" ? toolById(cur) : null, scr = root.querySelector("[data-nh=screen]");
    if (t && scr && t.onRecord) { try { t.onRecord(scr, API); } catch (e) {} }
    else if (t && scr) { try { t.render(scr, API, curOpts || {}); } catch (e) {} }
  }

  function openPicker() {
    var list = [];
    try { list = (G.SMD_DOSECALC && G.SMD_DOSECALC.listPatients) ? G.SMD_DOSECALC.listPatients() : []; } catch (e) {}
    var scr = root.querySelector("[data-nh=screen]");
    scr.innerHTML = '<section class="nh-card"><h3>Fill from a patient</h3>' + (list.length ? '<div class="nh-list">' + list.map(function (x, i) { return '<button type="button" class="nh-li" data-pi="' + i + '"><span>' + phi("name", x.label, esc(x.label)) + "<br><small>" + esc([x.src, x.sub].filter(Boolean).join(" · ")) + "</small></span></button>"; }).join("") + "</div>" : '<div class="nh-none">No ICU or OPD patient open on this device. Enter the baby by hand.</div>') + '<button type="button" class="nh-btn" data-nh="back2">Back</button></section>';
    scr._list = list;
  }

  function onClick(e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest("[data-nh=back]")) { if (cur !== "home") { cur = "home"; curOpts = null; render(); } else close(); return; }
    if (t.closest("[data-nh=edit]")) { editing = !editing; if (!editing) { var bd = root.querySelector(".nh-body"); if (bd) bd.scrollTop = 0; } haptic(); render(); if (editing) setTimeout(function () { var x = D.getElementById(neo().get().gaW ? "nh_weightG" : "nh_gaW"); if (x) x.focus(); }, 40); return; }
    if (t.closest("[data-nh=clear]")) { neo().clear(); render(); return; }
    if (t.closest("[data-nh=prefill]")) { openPicker(); return; }
    if (t.closest("[data-nh=back2]")) { render(); return; }
    var pi = t.closest("[data-pi]"); if (pi) { var sc = root.querySelector("[data-nh=screen]"), x = sc._list && sc._list[+pi.getAttribute("data-pi")]; if (x) neo().fromPatient(x.patient); render(); return; }
    var sx = t.closest("[data-sex]"); if (sx && sx.closest("[data-nh=record]")) { var r = neo().get(); neo().set({ sex: r.sex === sx.getAttribute("data-sex") ? "" : sx.getAttribute("data-sex") }); haptic(); render(); return; }
    var tl = t.closest("[data-tool]"); if (tl) { go(tl.getAttribute("data-tool")); return; }
    var ac = t.closest("[data-act]"); if (ac && ac.closest("[data-acts]")) { doAct(ac); return; }
  }
  function onInput(e) {
    var t = e.target, k = t && t.getAttribute && t.getAttribute("data-rec");
    if (!k) return;
    var part = {}; part[k] = t.value; neo().set(part);
    refreshRecordOnly();
  }
  function go(id, opts) { if (!toolById(id)) return; cur = id; curOpts = opts || null; haptic(); render(); var b = root.querySelector(".nh-body"); if (b) b.scrollTop = 0; }

  function open(toolId, opts) {
    if (!on()) { toast("Neonatal layer is off. Turn it on in Settings > Experimental Features."); return; }
    css();
    if (!root) {
      root = D.createElement("div"); root.id = "neoHub"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Neonatal tools");
      root.innerHTML = '<div class="nh-top"><button type="button" class="nh-x" data-nh="back" aria-label="Back">‹ Close</button><div class="nh-t">Neonatal</div></div><div class="nh-body"></div>';
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("change", onInput);
      D.body.appendChild(root);
    }
    root.hidden = false; D.body.classList.add("smd-neohub-open");
    cur = toolId && toolById(toolId) && featureOn(toolById(toolId).flag) ? toolId : "home"; curOpts = opts || null;
    editing = !neo().has() && cur === "home";
    render();
  }
  function close() { if (root) root.hidden = true; D.body.classList.remove("smd-neohub-open"); editing = false; }
  function isOpen() { return !!(root && !root.hidden); }

  function register(t) {
    if (!t || !t.id || toolById(t.id)) return;
    var F = FRIENDLY[t.id]; if (F) { t.techTitle = t.title; t.title = F.t; t.sub = F.s; t.intro = F.i; t.kw = (t.kw || "") + " " + t.techTitle; }
    TOOLS.push(t); if (isOpen() && cur === "home") render(); }
  function searchItems() {
    if (!on()) return [];
    return [{ id: "neo", title: "Neonatal tools", sub: "NICU: dosing, infusions, fluids, growth, bilirubin", kw: "neonatal nicu newborn neonate preterm baby", open: function () { open(); } }].concat(visibleTools().map(function (t) {
      return { id: "neo:" + t.id, title: t.title, sub: "Neonatal · " + (t.sub || ""), kw: "neonatal nicu newborn " + (t.kw || ""), open: function () { open(t.id); } };
    }));
  }

  API = { css: css, data: data, dataOrNull: dataOrNull, esc: esc, clean: clean, fmt: fmt, badge: badge, srcLine: srcLine, noData: noData, note: note, secondCheckHtml: secondCheckHtml, actionsHtml: actionsHtml, setSheet: setSheet, go: go, neo: function () { return neo().derived(); }, record: function () { return neo(); }, featureOn: featureOn, toast: toast, root: function () { return root; } };
  G.SMD_NEO_HUB = { open: open, close: close, isOpen: isOpen, register: register, on: on, api: API, searchItems: searchItems, tools: visibleTools, VER: VER };
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen() && !(G.SMD_DOSECALC && D.getElementById("doseCalc") && !D.getElementById("doseCalc").hidden)) close(); }, false);
})(window);
