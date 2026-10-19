/* Interactive figure viewer (window.SMD_FIG). ES5.
 * Opens a self-contained figure page (prep/figures/<name>.html, built with the Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt)
 * full screen over whatever is open, in the app's theme: <name>.html is the dark build, <name>-light.html the light one.
 *   SMD_FIG.open({ src: "prep/figures/beta-blockers.html", title, from: element, query: "d=2&name=Metoprolol" })
 *   A Pause / Play button in the top bar drives the figure's own #pause button and remembers the choice.
 *   SMD_FIG.close() -> true when one was open;  SMD_FIG.isOpen()
 * The page is our own static file (same origin), so it runs in an iframe that fills the sheet and scrolls only up and down.
 * appMode() restyles it to feel like part of the app (no frame, no hover text, big controls) and makes the drawing fit the screen
 * width, with pinch, double-tap and +/- zoom and one-finger pan once zoomed, so nothing ever scrolls sideways.
 */
(function (G) {
  "use strict";
  var D = G.document; if (!D) return;
  var FIG_RE = /^prep\/figures\/[a-z0-9-]{2,60}\.html$/, cur = null;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function css() {
    if (D.getElementById("smdFigCss")) return;
    var st = D.createElement("style"); st.id = "smdFigCss";
    st.textContent = ".smdfig{position:fixed;inset:0;z-index:2000;display:flex;flex-direction:column;background:#111;color:#eee;font:15px/1.4 system-ui,sans-serif}" +
      ".smdfig.lt{background:#f6f7f5;color:#14202b}" +
      ".smdfig-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px 16px}" +
      ".smdfig-top p{margin:0;font-weight:600}.smdfig-x{min-width:44px;min-height:44px;border:0;border-radius:22px;background:rgba(128,128,128,.25);color:inherit;font:600 20px/1 system-ui;cursor:pointer}" +
      ".smdfig-sc{flex:1;min-height:0;overflow:hidden}.smdfig-fr{display:block;width:100%;height:100%;border:0}" +
      ".smdfig-tools{display:flex;align-items:center;gap:8px}.smdfig-pp{min-height:44px;padding:0 16px;border:0;border-radius:22px;background:rgba(128,128,128,.25);color:inherit;font:600 14px system-ui;cursor:pointer}.smdfig-pp[hidden]{display:none}.smdfig-pp:focus-visible{outline:2px solid currentColor;outline-offset:2px}" +
      ".smdfig-ms{position:absolute;left:0;right:0;bottom:0;max-height:78%;overflow:auto;-webkit-overflow-scrolling:touch;background:#161616;color:#eee;border-top:1px solid rgba(128,128,128,.35);border-radius:16px 16px 0 0;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 18px);box-shadow:0 -8px 30px rgba(0,0,0,.35)}" +
      ".smdfig.lt .smdfig-ms{background:#fbfbfa;color:#14202b;box-shadow:0 -8px 30px rgba(0,0,0,.12)}.smdfig-ms[hidden]{display:none}" +
      ".smdfig-ms .ms-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px}.smdfig-ms h2{margin:0;font:650 17px/1.3 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}" +
      ".smdfig-ms{--ms-t:#f2b84b;--ms-g:#6aa7ff;--ms-m:#b48cff;--ms-f:#4fd1a5;--ms-i:#ff8fa3;--ms-a:#ff7a59}.smdfig.lt .smdfig-ms{--ms-t:#9a6200;--ms-g:#1f5fbf;--ms-m:#6a3fc4;--ms-f:#0f7a5c;--ms-i:#b4234a;--ms-a:#b8421d}" +
      ".smdfig-ms dl{margin:0;display:grid;grid-template-columns:1fr;gap:10px}.smdfig-ms .ms-r{border-radius:12px;padding:11px 13px 12px;border-left:4px solid var(--c);background:color-mix(in srgb,var(--c) 9%,transparent)}" +
      ".smdfig-ms dt{display:flex;align-items:center;gap:8px;margin:0 0 5px;font:700 11.5px/1.2 -apple-system,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--c)}" +
      ".smdfig-ms dt i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--c);color:#111;font:700 11px/1 -apple-system,system-ui,sans-serif;letter-spacing:0}.smdfig.lt .smdfig-ms dt i{color:#fff}" +
      ".smdfig-ms dd{margin:0;font:15.5px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}.smdfig-ms mark{background:color-mix(in srgb,var(--c) 24%,transparent);color:inherit;font-weight:650;border-radius:4px;padding:0 3px;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
      ".smdfig-ms .ms-r.ms-a{margin-top:2px}" +
      ".smdfig-ms p.ms-note{margin:12px 0 0;font:12px/1.4 -apple-system,system-ui,sans-serif;opacity:.6}.smdfig-ms .ms-x{min-height:44px;min-width:44px;border:0;border-radius:22px;background:rgba(128,128,128,.25);color:inherit;font:600 14px system-ui;cursor:pointer;padding:0 14px}" +
      ".smdfig-h{display:block;font-weight:400;font-size:12px;opacity:.7}.smdfig-x:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
    D.head.appendChild(st);
  }

  /* ---- app mode: runs on the figure page inside the iframe (same origin) ---- */
  var APP_CSS = "html,body{overflow-x:hidden;max-width:100%;-webkit-text-size-adjust:100%;overscroll-behavior-x:none}body{-webkit-tap-highlight-color:transparent;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 24px)}" +
    ".iso-page{width:auto;margin:0;padding:6px 14px 0}.iso-figure{margin:0}" +
    ".iso-plate{padding:0;box-shadow:none;background:none}.iso-plate-corners{position:static;display:block;margin:0 0 8px;inset:auto}" +
    ".iso-plate-corner{position:static;display:none}.iso-plate-corner[data-readout]{display:block;white-space:normal;font:600 16px/1.3 system-ui,-apple-system,sans-serif;letter-spacing:0;color:var(--anatomy-strong);padding:10px 14px;border-radius:14px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-faint)}" +
    ".iso-legend{margin:8px 0 0}.iso-caption{font:12px/1.5 system-ui,-apple-system,sans-serif;color:var(--anatomy-muted)}" +
    ".smdz-st{position:relative;overflow:hidden;border-radius:16px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-faint);touch-action:pan-y;-webkit-user-select:none;user-select:none}" +
    ".smdz-in{transform-origin:0 0;will-change:transform}.dr-svg{padding:0}.dr-fig,.iso-svg{display:block;width:100%;height:auto}" +
    ".smdz-bt{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin:8px 0 0}.smdz-bt span{margin-right:auto;font:13px system-ui,sans-serif;color:var(--anatomy-muted)}.smdz-bt button{min-width:44px;min-height:44px;border:0;border-radius:22px;background:var(--anatomy-card);color:var(--anatomy-strong);font:600 20px/1 system-ui;box-shadow:0 0 0 1px var(--anatomy-faint)}" +
    ".dr-controls{display:flex;flex-direction:column;align-items:stretch;gap:16px;margin:16px 0 8px;font:600 14px/1.3 system-ui,-apple-system,sans-serif}" +
    ".dr-range{gap:8px;align-items:stretch}.dr-range input{width:100%;height:36px;margin:0}.dr-ticks{font:12px system-ui,sans-serif}" +
    ".dr-range select{width:100%;min-height:48px;font:16px system-ui,-apple-system,sans-serif;padding:0 12px;border-radius:12px;color:var(--anatomy-strong);background:var(--anatomy-card);border:1px solid var(--anatomy-mid)}" +
    "#pause{width:100%;min-height:44px;border-radius:12px;font:600 14px system-ui;color:var(--anatomy-strong);background:var(--anatomy-card);border:1px solid var(--anatomy-faint)}" +
    ".dr-status{font:13px/1.4 system-ui,sans-serif;margin:4px 0}" +
    ".dr-info{position:sticky;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:3;min-height:0;margin:12px 0;padding:12px 14px;border:0;border-radius:14px;background:var(--anatomy-top);box-shadow:0 0 0 1px var(--anatomy-faint),0 6px 18px rgba(0,0,0,.28);font:14px/1.45 system-ui,-apple-system,sans-serif}" +
    ".bio-sources{margin:12px 0 0}.bio-sources summary{font:600 14px system-ui,sans-serif;color:var(--anatomy-text);min-height:44px;display:flex;align-items:center;cursor:pointer}.bio-sources h2{display:none}.hot{cursor:pointer}";

  /* colour layer: membranes blue, start/step/result/damage each their own hue, so the parts can be told apart at a glance */
  var COLOR_CSS = "body{--k-mem:#4c8dff;--k-src:#2fd4a0;--k-mid:#4fb3ff;--k-out:#ffb43a;--k-bad:#ff6b7a;--k-enz:#a78bfa;--k-rec:#34d399;--k-gp:#8b7bff;--k-vs:#ffb86b}" +
    "body[data-theme='light']{--k-mem:#2563eb;--k-src:#0f9f76;--k-mid:#0a7fd1;--k-out:#d98300;--k-bad:#dc3545;--k-enz:#6d4fd6;--k-rec:#16a05f;--k-gp:#5b46d6;--k-vs:#d9772b}" +
    ".dr-n-source .bio-blob-base{fill:color-mix(in srgb,var(--k-src) 42%,var(--anatomy-shade-2))}.dr-n-source .bio-blob-edge{stroke:var(--k-src)}" +
    ".dr-n-mid .bio-blob-base{fill:color-mix(in srgb,var(--k-mid) 38%,var(--anatomy-shade-2))}.dr-n-mid .bio-blob-edge{stroke:var(--k-mid)}" +
    ".dr-n-calc .bio-blob-base{fill:color-mix(in srgb,var(--k-out) 46%,var(--anatomy-shade-2))}.dr-n-calc .bio-blob-edge{stroke:var(--k-out)}" +
    ".dr-n-inv .bio-blob-base{fill:color-mix(in srgb,var(--k-bad) 44%,var(--anatomy-shade-2))}.dr-n-inv .bio-blob-edge{stroke:var(--k-bad)}" +
    ".dr-enz-r{fill:color-mix(in srgb,var(--k-enz) 26%,var(--anatomy-paper));stroke:var(--k-enz)}" +
    ".dr-flowline{stroke:color-mix(in srgb,var(--k-mid) 80%,var(--anatomy-mid))}.dr-flowhead{stroke:var(--k-mid)}" +
    ".dr-memband,.dr-memfill{fill:color-mix(in srgb,var(--k-mem) 55%,var(--anatomy-shade-1))}.dr-memedge{stroke:var(--k-mem);stroke-width:1.2}" +
    ".dr-cell{fill:color-mix(in srgb,var(--k-mem) 9%,var(--anatomy-shade-3));stroke:var(--k-mem)}.dr-head{stroke:var(--k-mem);fill:color-mix(in srgb,var(--k-mem) 16%,var(--anatomy-paper))}" +
    ".bio-membrane-base{fill:color-mix(in srgb,var(--k-mem) 50%,var(--anatomy-shade-1))}" +
    ".dr-rec .dr-hx,.dr-rec .dr-hx-hi{stroke:var(--k-rec)}.dr-rec .dr-hx{fill:color-mix(in srgb,var(--k-rec) 32%,var(--anatomy-shade-2))}" +
    ".dr-bg .bio-blob-base,.dr-alpha .bio-blob-base{fill:color-mix(in srgb,var(--k-gp) 40%,var(--anatomy-shade-2))}.dr-bg .bio-blob-edge,.dr-alpha .bio-blob-edge{stroke:var(--k-gp)}" +
    ".dr-ac .bio-blob-base{fill:color-mix(in srgb,var(--k-mid) 38%,var(--anatomy-shade-2))}.dr-ac .bio-blob-edge{stroke:var(--k-mid)}" +
    ".dr-pkac .bio-blob-base{fill:color-mix(in srgb,var(--k-out) 38%,var(--anatomy-shade-2))}.dr-pkac .bio-blob-edge{stroke:var(--k-out)}" +
    ".dr-ves .bio-blob-base{fill:color-mix(in srgb,var(--k-vs) 40%,var(--anatomy-shade-2))}.dr-ves .bio-blob-edge{stroke:var(--k-vs)}" +
    ".dr-vdot,.dr-da{fill:var(--k-vs)}.dr-rail-green{stroke:var(--k-rec)}.dr-rail-head.dr-rail-green{fill:var(--k-rec)}.dr-rail-red{stroke:var(--k-bad)}.dr-rail-head.dr-rail-red{fill:var(--k-bad)}" +
    ".dr-cur{stroke:var(--k-mid);stroke-width:2.2}.dr-cur2{stroke:var(--k-mid)}.dr-zone{fill:color-mix(in srgb,var(--k-mem) 12%,var(--anatomy-shade-3))}.dr-ghost{stroke:var(--anatomy-mid)}" +
    ".smdk{display:flex;flex-wrap:wrap;gap:8px 14px;margin:10px 0 0;font:12.5px/1.2 system-ui,-apple-system,sans-serif;color:var(--anatomy-text)}.smdk span{display:inline-flex;align-items:center;gap:6px}.smdk i{width:14px;height:14px;border-radius:50%;display:inline-block;border:2px solid currentColor}";
  function legend(doc) {
    var items = null;
    if (doc.querySelector(".dr-n-source")) items = [["Start", "--k-src"], ["Step", "--k-mid"], ["Result", "--k-out"], ["Damage", "--k-bad"], ["Enzyme or receptor step", "--k-enz"]];
    else if (doc.querySelector(".dr-memband, .dr-memedge")) items = [["Cell membrane", "--k-mem"], ["Receptor", "--k-rec"], ["G protein", "--k-gp"], ["Enzyme", "--k-mid"], ["Vesicle", "--k-vs"]];
    else if (doc.querySelector(".dr-cur")) items = [["With the drug class", "--k-mid"], ["Normal (dashed)", "--anatomy-mid"]];
    var host = doc.querySelector(".iso-legend"); if (!items || !host) return;
    var d = doc.createElement("div"); d.className = "smdk"; d.setAttribute("aria-hidden", "true");
    d.innerHTML = items.map(function (it) { return '<span style="color:var(' + it[1] + ')"><i></i><b style="font-weight:500;color:var(--anatomy-text)">' + it[0] + "</b></span>"; }).join("");
    host.appendChild(d);
  }

  var CMP_CSS = ".smdc{margin:0 0 10px;border-radius:14px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-faint);overflow:hidden}" +
    ".smdc-t{display:flex;padding:4px;gap:4px}.smdc-t button{flex:1;min-height:44px;border:0;border-radius:10px;background:transparent;color:var(--anatomy-text);font:600 15px system-ui,-apple-system,sans-serif}" +
    ".smdc-t button[aria-pressed='true']{background:var(--anatomy-top);color:var(--anatomy-strong);box-shadow:0 0 0 1px var(--anatomy-faint),0 2px 6px rgba(0,0,0,.18)}" +
    ".smdc-r{display:flex;flex-direction:column;gap:3px;padding:9px 14px 10px;border-top:1px solid var(--anatomy-faint);font:15px/1.35 system-ui,-apple-system,sans-serif;color:var(--anatomy-text)}" +
    ".smdc-r b{flex:none;font:600 12px system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--anatomy-muted)}.smdc-r span{color:var(--anatomy-strong);font-weight:600}.smdc-r.on{background:color-mix(in srgb,var(--k-mid) 10%,transparent)}" +
    "[data-readout]{display:none!important}";
  /* with and without the drug: a two-way switch, and both readouts side by side */
  function compare(doc) {
    var sel = doc.getElementById("drug"), ro = doc.querySelector("[data-readout]"), lv = doc.getElementById("level"), host = doc.querySelector(".iso-plate-corners");
    if (!sel || !ro || !host || sel.options.length < 2) return;
    var st = doc.createElement("style"); st.textContent = CMP_CSS; doc.body.appendChild(st);
    var box = doc.createElement("div"); box.className = "smdc";
    var LW = sel.getAttribute("data-without") || "Without drug", LD = sel.getAttribute("data-with") || "With drug";
    box.innerHTML = '<div class="smdc-t" role="group" aria-label="Show without or with"><button type="button" data-w="0"></button><button type="button" data-w="1"></button></div>' +
      '<div class="smdc-r" data-r="0"><b>Without</b><span></span></div><div class="smdc-r" data-r="1"><b>With</b><span></span></div>';
    box.querySelector('[data-w="0"]').textContent = LW; box.querySelector('[data-w="1"]').textContent = LD;
    host.parentNode.insertBefore(box, host);
    var last = sel.value !== "0" ? sel.value : "1", busy = false, ts = box.querySelectorAll(".smdc-t button"), rows = box.querySelectorAll(".smdc-r");
    function fire() { sel.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true })); }
    function read(v) { var cur = sel.value; busy = true; sel.value = v; fire(); var t = ro.textContent; sel.value = cur; fire(); busy = false; return t; }
    function paint() {
      var on = sel.value !== "0"; if (on) last = sel.value;
      ts[0].setAttribute("aria-pressed", on ? "false" : "true"); ts[1].setAttribute("aria-pressed", on ? "true" : "false");
      var w = read("0"), d = on ? ro.textContent : read(last), dn = sel.options[+last] ? sel.options[+last].text : "drug";
      rows[0].querySelector("span").innerHTML = withIcons(w); rows[1].querySelector("span").innerHTML = withIcons(d); rows[1].querySelector("b").textContent = "With";
      rows[0].className = "smdc-r" + (on ? "" : " on"); rows[1].className = "smdc-r" + (on ? " on" : "");
      rows[1].title = dn;
    }
    ts[0].addEventListener("click", function () { if (sel.value !== "0") last = sel.value; sel.value = "0"; fire(); });
    ts[1].addEventListener("click", function () { sel.value = last || "1"; fire(); });
    sel.addEventListener("change", function () { if (!busy) setTimeout(paint, 0); });
    if (lv) { lv.addEventListener("input", function () { if (!busy) setTimeout(paint, 0); }); lv.addEventListener("change", function () { if (!busy) setTimeout(paint, 0); }); }
    paint();
  }
  /* "heart rate and force \u2191" reads as "\u2665 Heart rate and force increased (\u2191)": a heart for heart text, the arrow in brackets.
     Output lines (.dr-out) follow the drawing: when the drug leaves them dim, the text says it was not raised or lowered. */
  function arrows(doc) {
    var svg = doc.querySelector("svg.dr-fig, svg.iso-svg"); if (!svg) return;
    var busy = false;
    function xform(x, strong) {
      var up = x.indexOf("\u2191") > -1, core = x.replace(/\s*[\u2191\u2193]\s*/g, " ").trim(), a = up ? "\u2191" : "\u2193";
      if (/^heart rate/i.test(core)) {
        var c2 = core.charAt(0).toUpperCase() + core.slice(1);
        return c2 + (strong ? (up ? " increased (\u2191)" : " decreased (\u2193)") : (up ? " not increased" : " not decreased"));
      }
      var pre = "";
      return pre + core + (strong ? " (" + a + ")" : (up ? " (not raised)" : " (not lowered)"));
    }
    function fix() {
      if (busy) return; busy = true;
      Array.prototype.forEach.call(svg.querySelectorAll("text"), function (t) {
        if (t.children.length) return;
        var o = t.getAttribute("data-o"), x = o || t.textContent;
        if (!/[\u2191\u2193]/.test(x)) return;
        if (!o) { if (/\([\u2191\u2193]\)/.test(x)) return; t.setAttribute("data-o", x); }
        var out = /\bdr-out\b/.test(t.getAttribute("class") || ""), op = out ? parseFloat(t.style.opacity || "1") : 1;
        var y = xform(x, !out || op >= 0.55);
        if (y !== t.textContent) t.textContent = y;
      });
      busy = false;
    }
    fix();
    try { new doc.defaultView.MutationObserver(fix).observe(svg, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] }); } catch (e) {}
  }

  /* ---- organ icons (drawn, 24 x 24) and premium type ---- */
  var IC = {
heart:'<path class="a" d="M32 57C14 43 6 33 6 22 6 13 13 8 21 8c5 0 9 3 11 7 2-4 6-7 11-7 8 0 15 5 15 14 0 11-8 21-26 35z"/><path class="b" d="M32 15c-1 14 2 29 0 42C16 45 8 35 7 24c3 9 12 15 25 16z"/><path class="a" d="M25 14c-1-7 4-11 10-10 6 1 8 6 8 11" fill="none" stroke-width="5"/><path class="d" d="M43 8c3-1 7 0 9 3M21 9c-3-2-7 0-8 3" fill="none"/><path class="c" d="M12 18c2-5 6-7 10-6M34 24c1 6 0 12-1 17" fill="none"/><path class="d" d="M24 24c3 3 3 8 1 12M44 22c-2 4-2 9 1 13" fill="none"/>',
lungs:'<path class="a" d="M26 20c-8 1-15 14-17 28-1 7 3 11 8 10 6-1 10-5 10-12V20z"/><path class="a" d="M38 20c8 1 15 14 17 28 1 7-3 11-8 10-6-1-10-5-10-12V20z"/><path class="b" d="M26 20c-8 1-15 14-17 28 5-4 12-4 17 0zM38 20c8 1 15 14 17 28-5-4-12-4-17 0z"/><path class="c" d="M32 4v22M32 26l-9 9M32 26l9 9M23 35l-5 7M23 35l6 6M41 35l5 7M41 35l-6 6" fill="none" stroke-width="2.4"/><path class="d" d="M18 42l-4 5M46 42l4 5M20 30l-3 3M44 30l3 3" fill="none"/>',
kidney:'<path class="a" d="M38 5C21 5 9 17 9 32s12 27 29 27c8 0 11-6 8-11-3-6-8-9-8-16s5-10 8-16c3-5 0-11-8-11z"/><path class="b" d="M38 5C21 5 9 17 9 32c6-6 14-9 22-9 4 0 8 1 13 3-3-7 0-12 2-17 1-3 0-4-8-4z"/><path class="c" d="M20 22c4-3 9-4 13-3M18 36c4 3 9 4 14 3M20 46c5 3 10 3 14 1" fill="none"/><path class="d" d="M46 30h9c3 0 5 2 5 5v22" fill="none" stroke-width="4"/>',
brain:'<path class="a" d="M10 35C5 25 11 10 26 8c8-4 20-2 26 6 8 4 9 16 3 22-2 8-9 12-16 10l-1 8H27v-8C18 46 13 42 10 35z"/><path class="b" d="M10 35C5 25 11 10 26 8c-8 8-9 20-5 30-5 0-9-1-11-3z"/><path class="c" d="M24 14c4 4 3 9 7 11s3 8-1 10M38 12c-3 4-2 8 2 10s5 6 3 11M46 20c1 4 5 5 6 9M16 28c4 0 7-2 9-5" fill="none"/><path class="d" d="M38 46c6 2 12-1 13-7" fill="none"/>',
liver:'<path class="a" d="M5 26c0-9 8-14 19-12l28 5c7 2 9 8 5 16-7 14-19 20-33 17C13 50 5 42 5 26z"/><path class="b" d="M5 26c0-9 8-14 19-12l8 1c-6 10-6 22-1 36C13 50 5 42 5 26z"/><path class="c" d="M30 16c1 8 3 15 8 21" fill="none"/><path class="d" d="M20 28c4 3 10 4 15 3" fill="none"/><path class="a" d="M38 46c0 6 6 10 11 6 2-2 0-8-4-9z"/>',
stomach:'<path class="a" d="M22 5c0 7 5 9 13 12 12 4 19 11 19 23 0 11-8 18-20 18-12 0-20-8-20-19 0-8 6-12 6-18 0-6-3-11 2-16z"/><path class="b" d="M22 5c0 7 5 9 13 12 12 4 19 11 19 23-8-5-16-5-24-2-8 3-12 8-12 14-6-14 6-20 6-30 0-6-3-12-2-17z"/><path class="c" d="M28 24c5 2 9 5 12 9M24 34c6 0 11 2 15 6M26 44c5-1 9 0 12 2" fill="none"/><path class="d" d="M15 6h10" fill="none" stroke-width="5"/>',
gut:'<path class="s1" d="M10 15h37c8 0 8 14 0 14H18c-9 0-9 14 0 14h31c9 0 9 12 0 12H13"/><path class="s2" d="M10 15h37c8 0 8 14 0 14H18c-9 0-9 14 0 14h31c9 0 9 12 0 12H13"/>',
bone:'<g transform="rotate(-45 32 32)"><rect class="a" x="13" y="26.5" width="38" height="11" rx="5"/><circle class="a" cx="11" cy="25" r="6.5"/><circle class="a" cx="11" cy="39" r="6.5"/><circle class="a" cx="53" cy="25" r="6.5"/><circle class="a" cx="53" cy="39" r="6.5"/><path class="b" d="M13 33h38v4.500a5 5 0 01-5 0H18a5 5 0 01-5 0z"/><path class="c" d="M18 29.500h28" fill="none"/><path class="d" d="M8 25h5M8 39h5M51 25h5M51 39h5" fill="none"/></g>',
bladder:'<path class="a" d="M32 56c-17 0-21-14-17-24 3-7 9-9 9-17V8h16v7c0 8 6 10 9 17 4 10 0 24-17 24z"/><path class="b" d="M15 32c3-7 9-9 9-17V8l8 0c-3 12-1 30 0 48-17 0-21-14-17-24z"/><path class="c" d="M24 8v8M40 8v8" fill="none" stroke-width="3"/><path class="d" d="M24 38c4 4 12 4 16 0" fill="none"/><path class="a" d="M32 56v6" fill="none" stroke-width="4"/>',
uterus:'<path class="a" d="M22 20c0-8 5-13 10-13s10 5 10 13c0 12 5 22-4 31-3 3-9 3-12 0-9-9-4-19-4-31z"/><path class="b" d="M22 20c0-8 5-13 10-13-3 14-2 30 1 44-3 0-6-1-8-3-9-9-4-19-4-31z"/><path class="c" d="M22 19c-6-2-10-6-14-6M42 19c6-2 10-6 14-6" fill="none" stroke-width="3"/><circle class="a" cx="8" cy="14" r="4"/><circle class="a" cx="56" cy="14" r="4"/><path class="d" d="M27 28c3 2 7 2 10 0" fill="none"/>',
thyroid:'<path class="a" d="M32 18c-9-8-22-4-23 8-1 11 7 20 17 20 4 0 6-3 6-7zM32 18c9-8 22-4 23 8 1 11-7 20-17 20-4 0-6-3-6-7z"/><path class="b" d="M32 18c-9-8-22-4-23 8 4-4 10-5 15-3 4 1 6 4 8 8zM32 18c9-8 22-4 23 8-4-4-10-5-15-3-4 1-6 4-8 8z"/><path class="c" d="M32 18v22" fill="none" stroke-width="3"/><path class="d" d="M30 6v10M34 6v10M30 50v10M34 50v10" fill="none"/>',
vessel:'<circle class="a" cx="32" cy="32" r="28"/><circle class="b" cx="32" cy="32" r="22"/><circle class="a" cx="32" cy="32" r="15"/><circle class="e" cx="32" cy="32" r="11"/><ellipse class="r" cx="28" cy="30" rx="4.5" ry="2.8"/><ellipse class="r" cx="36" cy="35" rx="4.5" ry="2.8"/><ellipse class="r" cx="34" cy="27" rx="3.6" ry="2.4"/><path class="c" d="M12 24c3-8 10-13 18-14" fill="none"/>',
eye:'<circle class="a" cx="36" cy="32" r="24"/><path class="b" d="M36 8c13 0 24 11 24 24S49 56 36 56c9-6 11-18 7-27-2-7-4-14-7-21z"/><path class="a" d="M12 32c0-9 5-14 11-17v34c-6-3-11-8-11-17z"/><ellipse class="e" cx="24" cy="32" rx="5" ry="12"/><path class="c" d="M20 20c-3 2-5 6-5 12M23 16v32" fill="none"/><path class="d" d="M26 18c6 2 10 6 12 14M26 46c6-2 10-6 12-14" fill="none"/>',
muscle:'<path class="a" d="M4 32c0-9 9-14 20-14h16c11 0 20 5 20 14S51 46 40 46H24C13 46 4 41 4 32z"/><path class="b" d="M4 32c0-9 9-14 20-14h16c11 0 20 5 20 14-12-3-24-2-56 0z"/><path class="c" d="M12 24v16M20 21v22M28 20v24M36 20v24M44 21v22M52 24v16" fill="none"/><ellipse class="e" cx="20" cy="26" rx="3.5" ry="1.8"/><ellipse class="e" cx="46" cy="38" rx="3.5" ry="1.8"/>',
neuron:'<path class="a" d="M32 22c-6 0-10 4-10 10s4 10 10 10 10-4 10-10-4-10-10-10z"/><path class="a" d="M26 25L12 12M12 12l-6-2M12 12l2-7M24 38L10 50M10 50l-5 1M10 50l2 6M38 25l12-12M50 13l6-1M50 13l-1-7" fill="none" stroke-width="3"/><path class="a" d="M40 36l16 18" fill="none" stroke-width="3.4"/><circle class="b" cx="58" cy="57" r="4"/><circle class="e" cx="31" cy="31" r="4.6"/><path class="c" d="M25 28c2-4 6-6 10-5" fill="none"/>',
skin:'<rect class="a" x="4" y="6" width="56" height="9" rx="3"/><rect class="b" x="4" y="15" width="56" height="26"/><rect class="a" x="4" y="41" width="56" height="17" rx="3"/><path class="c" d="M38 15V1" fill="none" stroke-width="2.4"/><path class="d" d="M36 15c0 8 1 16 4 20" fill="none" stroke-width="3"/><ellipse class="e" cx="30" cy="26" rx="6" ry="9"/><circle class="e" cx="46" cy="30" r="3"/><circle class="e" cx="14" cy="28" r="3"/>',
joint:'<path class="a" d="M14 3h22v13c0 9-4 12-11 12S14 25 14 16z"/><path class="a" d="M10 46h30c4 0 7 3 7 7v9H8v-9c0-4 0-7 2-7z" transform="translate(0 -1)"/><path class="b" d="M13 31h24v6H13z"/><path class="c" d="M16 14c0-4 2-7 6-8" fill="none"/><path class="d" d="M44 18c5 2 8 8 8 16M44 44c4-3 7-6 8-10" fill="none" stroke-width="2"/>',
cell:'<ellipse class="a" cx="32" cy="32" rx="28" ry="22"/><ellipse class="b" cx="32" cy="32" rx="22" ry="16"/><circle class="e" cx="36" cy="30" r="8"/><circle class="d" cx="22" cy="38" r="3"/><circle class="d" cx="44" cy="40" r="2.4"/>'
};
  var IC_RE = [["eye", /\beye|aqueous|intraocular|retina|pupil/i], ["heart", /heart|cardiac|myocyte|ventric|atri(?:al|um)|sinoatrial|\bAV\b|\bSA\b/i], ["lungs", /airway|lung|bronch|respirat|breath|pulmon|alveol/i], ["kidney", /kidney|renal|nephron|tubule|collecting duct|urine/i],
    ["neuron", /neuron|nerve|synap|axon/i], ["brain", /brain|cognit|seizure|cortex|mood|manic|alertness|consciousness|dementia/i], ["liver", /liver|hepat/i], ["stomach", /stomach|gastric|parietal|\bacid\b|nausea|vomit/i], ["gut", /\bgut\b|bowel|intestin|stool|lumen|colon/i],
    ["bone", /\bbone|osteo/i], ["bladder", /bladder|detrusor/i], ["uterus", /uter|labou?r|womb/i], ["thyroid", /thyroid/i], ["skin", /\bskin|acne|follicle|sebum/i], ["joint", /\bjoint|gout|arthritis|synovi/i], ["vessel", /vessel|blood pressure|vascular|clot/i], ["muscle", /muscle|spasm|\btone\b|contraction/i]];
  var IC_CSS = ".smdi .a,svg.smdi-h .a{fill:color-mix(in srgb,var(--ic) 62%,var(--anatomy-paper));stroke:var(--ic);stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round}.smdi .b,svg.smdi-h .b{fill:color-mix(in srgb,var(--ic) 40%,var(--anatomy-shade-0));stroke:none;opacity:.55}.smdi .c,svg.smdi-h .c{fill:none;stroke:#fff;stroke-opacity:.5;stroke-width:1.5;stroke-linecap:round}.smdi .d,svg.smdi-h .d{fill:none;stroke:var(--ic);stroke-opacity:.9;stroke-width:1.1;stroke-linecap:round}.smdi .e,svg.smdi-h .e{fill:color-mix(in srgb,var(--ic) 30%,var(--anatomy-shade-0));stroke:var(--ic);stroke-width:1}.smdi .r,svg.smdi-h .r{fill:#ef4444;stroke:#7f1d1d;stroke-width:.6}.smdi .s1,svg.smdi-h .s1{fill:none;stroke:var(--ic);stroke-width:10;stroke-linecap:round;stroke-linejoin:round}.smdi .s2,svg.smdi-h .s2{fill:none;stroke:color-mix(in srgb,var(--ic) 55%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round;stroke-linejoin:round}.smdi{pointer-events:none}svg.smdi-h{width:1.5em;height:1.5em;vertical-align:-.4em;margin-right:.15em;display:inline-block;overflow:visible}" +
    ".ic-heart{--ic:#ef4444}.ic-lungs{--ic:#f472b6}.ic-kidney{--ic:#d9622b}.ic-brain{--ic:#c084fc}.ic-liver{--ic:#c2763a}.ic-stomach{--ic:#fb923c}.ic-gut{--ic:#f5b342}.ic-bone{--ic:#cbd5e1}.ic-bladder{--ic:#e3b92e}.ic-uterus{--ic:#fb7185}.ic-thyroid{--ic:#a78bfa}.ic-vessel{--ic:#f87171}.ic-muscle{--ic:#f97316}.ic-eye{--ic:#38bdf8}.ic-neuron{--ic:#e879f9}.ic-skin{--ic:#fdba74}.ic-joint{--ic:#94a3b8}.ic-cell{--ic:#4c8dff}" +
    "@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-variable.woff2) format('woff2')}@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:200 800;font-display:swap;src:url(/assets/fonts/bricolage-grotesque.woff2) format('woff2')}" +
    "body.iso{--anatomy-mono:'Inter Variable',-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif;--k-disp:'Bricolage Grotesque','Inter Variable',-apple-system,system-ui,sans-serif}" +
    ".dr-label{letter-spacing:0;font-weight:450}.dr-label.dr-name,.dr-step{font-weight:560}.dr-prot,.dr-nl{font-family:var(--k-disp);font-weight:600;letter-spacing:.005em}.dr-title,.dr-out{font-family:var(--k-disp);font-weight:650;letter-spacing:.005em}.dr-sub{letter-spacing:.01em}" +
    ".dr-chip text,.dr-enz text{font-family:'Inter Variable',system-ui,sans-serif}" + ".smds-head{fill:var(--k-mem);fill-opacity:.9}.smds-head.smds-in{fill-opacity:.65}.smds-tail{fill:none;stroke:var(--k-mem);stroke-opacity:.5;stroke-width:.9;stroke-linecap:round}.smds-nuc{fill:color-mix(in srgb,var(--k-gp) 55%,transparent);stroke:var(--k-gp);stroke-width:1}" +
    ".smds-src .smds-head,.smds-src .smds-tail{fill:var(--k-src);stroke:var(--k-src)}.smds-src .smds-tail{fill:none}.smds-cargo{fill:var(--k-vs);stroke:none}.smds-tissue{fill:none;stroke:var(--k-out);stroke-opacity:.55;stroke-width:1.3;stroke-dasharray:1 3.2;stroke-linecap:round}.smds-cell{fill:color-mix(in srgb,var(--k-out) 38%,transparent);stroke:var(--k-out);stroke-opacity:.7;stroke-width:.8}.smds-hole{fill:none;stroke:var(--k-bad);stroke-width:2;stroke-dasharray:7 5;stroke-linecap:round}" +
    ".smds-rec rect{fill:color-mix(in srgb,var(--k-rec) 45%,var(--anatomy-paper));stroke:var(--k-rec);stroke-width:1.2}.smds-mid~.bio-blob-edge{opacity:.4}g.dr-node:has(.smds) .bio-blob-edge{opacity:.35}g.dr-node:has(.smds) .bio-blob-highlight{opacity:.25}";
  function iconKey(t) { for (var i = 0; i < IC_RE.length; i++) if (IC_RE[i][1].test(t)) return IC_RE[i][0]; return null; }
  function iconHtml(k) { return '<svg class="smdi-h ic-' + k + '" viewBox="0 0 64 64" aria-hidden="true">' + IC[k] + "</svg>"; }
  /* in text shown in HTML (the comparison rows): put the drawn icon before the first word of each organ */
  function withIcons(txt) {
    var out = String(txt).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), used = {};
    IC_RE.forEach(function (r) { if (used[r[0]]) return; var m = r[1].exec(out); if (m && m[0].length > 2) { used[r[0]] = 1; out = out.slice(0, m.index) + iconHtml(r[0]) + out.slice(m.index); } });
    return out;
  }
  /* in the drawing: an icon just left of output lines, cell titles and result nodes whose text names an organ */
  function organIcons(doc) {
    var svg = doc.querySelector("svg.dr-fig, svg.iso-svg"); if (!svg) return;
    var busy = false, NS = "http://www.w3.org/2000/svg";
    function place() {
      if (busy) return; busy = true;
      Array.prototype.forEach.call(svg.querySelectorAll("text.dr-out, text.dr-title, .dr-n-calc text.dr-nl, .dr-n-calc text.dr-prot"), function (t) {
        if (t.closest && t.closest(".smds-art")) return;
        var k = iconKey(t.textContent), g = t.previousSibling, has = g && g.nodeType === 1 && g.getAttribute && g.getAttribute("data-ic") !== null;
        if (!k) { if (has) g.parentNode.removeChild(g); return; }
        var bb; try { bb = t.getBBox(); } catch (e) { return; } if (!bb || !bb.width) return;
        if (!has) { g = doc.createElementNS(NS, "g"); g.setAttribute("data-ic", ""); t.parentNode.insertBefore(g, t); }
        var sz = Math.max(20, Math.min(30, bb.height * 1.9)), tr = "translate(" + (bb.x - sz - 4).toFixed(1) + " " + (bb.y + bb.height / 2 - sz / 2).toFixed(1) + ") scale(" + (sz / 64).toFixed(3) + ")";
        var cl = "smdi ic-" + k; if (g.getAttribute("class") !== cl) { g.setAttribute("class", cl); g.innerHTML = IC[k]; }
        if (g.getAttribute("transform") !== tr) g.setAttribute("transform", tr);
        var op = t.style.opacity || "1"; if (g.style.opacity !== op) g.style.opacity = op;
      });
      busy = false;
    }
    place();
    try { new doc.defaultView.MutationObserver(place).observe(svg, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] }); } catch (e) {}
    try { if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { place(); setTimeout(place, 250); }); } catch (e) {}
  }

  /* ---- scenery: cells with a real lipid bilayer, vesicles, tissue, and receptors crossing the membrane (flow-chart figures) ---- */
  var MEM_RE = /receptor|channel|transporter|pump|exchang|ENaC|NKCC|NCC\b|SGLT|URAT|NPC1L1|P2Y12|SERT|reuptake|NHE|ATPase|M3|AT1|V1|V2|NK1|MT1|alpha-|beta-|GABA-A|NMDA|5-HT|D2|H1|CysLT|GLUT|aquaporin|TRP|integrin|IL-6/i;
  function scenery(doc) {
    var svg = doc.querySelector("svg.dr-fig, svg.iso-svg"); if (!svg || !svg.querySelector("g.dr-node")) return;
    var NS = "http://www.w3.org/2000/svg";
    function el(n, a, p) { var e = doc.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
    function ring(cx, cy, a, b, gap) { var pts = [], t = 0, g = 0; while (t < 6.2832 && g++ < 400) { pts.push([cx + a * Math.cos(t), cy + b * Math.sin(t), t]); var ds = Math.sqrt(a * a * Math.sin(t) * Math.sin(t) + b * b * Math.cos(t) * Math.cos(t)); t += gap / Math.max(ds, 1); } return pts; }
    function heads(pts, r) { var d = ""; pts.forEach(function (q) { d += "M" + (q[0] + r).toFixed(1) + " " + q[1].toFixed(1) + "a" + r + " " + r + " 0 1 0 " + (-2 * r) + " 0a" + r + " " + r + " 0 1 0 " + (2 * r) + " 0"; }); return d; }
    Array.prototype.forEach.call(svg.querySelectorAll("g.dr-node"), function (g) {
      var cls = g.getAttribute("class") || "", base = g.querySelector("path.bio-blob-base"), blob = g.querySelector("g.bio-blob"); if (!base || !blob || g.querySelector(".smds")) return;
      var bb = base.getBBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2, a = bb.width / 2 - 1.5, b = bb.height / 2 - 1.5;
      var kind = /dr-n-source/.test(cls) ? "src" : /dr-n-calc/.test(cls) ? "out" : /dr-n-inv/.test(cls) ? "bad" : "mid";
      var gs = el("g", { "class": "smds smds-" + kind, "pointer-events": "none" });
      var oa = a, ob = b, ia = a - 5.5, ib = Math.max(b - 5.5, 5);
      var o = ring(cx, cy, oa, ob, 6.2), n = ring(cx, cy, ia, ib, 6.2);
      if (kind === "mid" || kind === "src") {
        el("path", { "class": "smds-tail", d: o.map(function (q, i) { var w = n[Math.min(n.length - 1, Math.round(i * (n.length - 1) / Math.max(1, o.length - 1)))]; return "M" + q[0].toFixed(1) + " " + q[1].toFixed(1) + "L" + w[0].toFixed(1) + " " + w[1].toFixed(1); }).join("") }, gs);
        el("path", { "class": "smds-head", d: heads(o, 1.7) }, gs);
        if (kind === "mid") el("path", { "class": "smds-head smds-in", d: heads(n, 1.5) }, gs);
        if (kind === "src") { [[-0.86, -0.1], [-0.8, 0.22], [0.84, -0.12], [0.78, 0.2]].forEach(function (c) { el("circle", { "class": "smds-cargo", cx: (cx + c[0] * ia).toFixed(1), cy: (cy + c[1] * ib).toFixed(1), r: 2.1 }, gs); }); }
        else { el("ellipse", { "class": "smds-nuc", cx: (cx + ia * 0.74).toFixed(1), cy: cy.toFixed(1), rx: 5.5, ry: Math.max(3, ib * 0.5) }, gs); }
      } else if (kind === "out") {
        el("ellipse", { "class": "smds-tissue", cx: cx, cy: cy, rx: (a - 3.5).toFixed(1), ry: (b - 3.5).toFixed(1) }, gs);
        [[-0.7, -0.3], [-0.5, 0.35], [0.66, -0.25], [0.52, 0.38], [0.8, 0.05], [-0.82, 0.08]].forEach(function (c) { el("ellipse", { "class": "smds-cell", cx: (cx + c[0] * a * 0.9).toFixed(1), cy: (cy + c[1] * b * 0.9).toFixed(1), rx: 4.2, ry: 3 }, gs); });
      } else {
        el("ellipse", { "class": "smds-hole", cx: cx, cy: cy, rx: (a - 2).toFixed(1), ry: (b - 2).toFixed(1) }, gs);
      }
      blob.parentNode.insertBefore(gs, blob.nextSibling);
      var lt = g.querySelector("text.dr-nl, text.dr-prot"), key = lt ? iconKey(lt.textContent) : null;
      if (key) {
        var sz = Math.min(58, b * 2 + 12), ag = el("g", { "class": "smdi ic-" + key, transform: "translate(" + (cx - a + 8).toFixed(1) + " " + (cy - sz / 2).toFixed(1) + ") scale(" + (sz / 64).toFixed(3) + ")" }, null);
        ag.innerHTML = IC[key]; g.insertBefore(ag, lt);
        Array.prototype.forEach.call(g.querySelectorAll("text"), function (tx) { tx.setAttribute("transform", "translate(" + Math.round(sz / 2 - 2) + " 0)"); });
        g.setAttribute("class", cls + " smds-art");
      }
    });
    /* a receptor, channel or transporter step: three helices crossing the cell's membrane where the arrow enters */
    Array.prototype.forEach.call(svg.querySelectorAll("g.dr-enz"), function (pill) {
      var t = pill.querySelector("text"), info = pill.getAttribute("data-info") || ""; if (!t || !MEM_RE.test(t.textContent)) return;
      var ln = pill.previousSibling, guard = 0; while (ln && guard++ < 6 && !(ln.getAttribute && /flowline/.test(ln.getAttribute("class") || ""))) ln = ln.previousSibling;
      if (!ln || !ln.getAttribute) return;
      var nums = (ln.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g); if (!nums || nums.length < 4) return;
      var x1 = +nums[0], y1 = +nums[1], x2 = +nums[nums.length - 2], y2 = +nums[nums.length - 1], ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      var gr = el("g", { "class": "smds-rec", "pointer-events": "none", transform: "translate(" + x2.toFixed(1) + " " + y2.toFixed(1) + ") rotate(" + ang.toFixed(1) + ")" });
      [-7, 0, 7].forEach(function (dy) { el("rect", { x: -11, y: dy - 2.8, width: 22, height: 5.6, rx: 2.8 }, gr); });
      svg.appendChild(gr);
    });
  }
  /* Touch has no hover: a tap on a labelled part shows its one-line explanation and keeps it until another part is tapped. */
  function tapInfo(doc, win) {
    var info = doc.getElementById("info"); if (!info || info.getAttribute("data-tap")) return;
    info.setAttribute("data-tap", "1");
    if (/hover or focus/i.test(info.textContent)) info.textContent = "Tap a labelled part for a one-line explanation.";
    var idle = info.textContent, last = null;
    ["pointerleave", "blur"].forEach(function (t) {
      doc.addEventListener(t, function (e) { if (e.target && e.target.closest && e.target.closest("[data-info]") && (t === "blur" || e.pointerType === "touch")) e.stopImmediatePropagation(); }, true);
    });
    doc.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
      if (last) last.classList.remove("is-hot");
      if (!el) { last = null; info.textContent = idle; return; }
      last = el; el.classList.add("is-hot"); info.textContent = el.getAttribute("data-info");
    });
  }
  function appMode(doc, win) {
    if (!doc || !doc.body || doc.getElementById("smdAppCss")) return;
    var st = doc.createElement("style"); st.id = "smdAppCss"; st.textContent = APP_CSS + COLOR_CSS + IC_CSS; doc.body.appendChild(st);
    var vp = doc.querySelector('meta[name="viewport"]'); if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
    var info = doc.getElementById("info"); if (info) info.textContent = "Tap a labelled part for a one-line explanation.";
    var src = doc.querySelector(".bio-sources");
    if (src && !src.querySelector("details")) {
      var dt = doc.createElement("details"), sm = doc.createElement("summary"); sm.textContent = "What the figure shows, and how sure we are";
      dt.appendChild(sm); while (src.firstChild) dt.appendChild(src.firstChild); src.appendChild(dt);
    }
    /* a tap on a labelled part shows its explanation (touch has no hover) */
    Array.prototype.forEach.call(doc.querySelectorAll(".hot"), function (h) { h.addEventListener("touchend", function () { try { h.focus(); } catch (e) {} }, { passive: true }); });
    legend(doc); arrows(doc); scenery(doc); organIcons(doc); compare(doc); layout(doc, win); zoomer(doc, win);
  }
  /* One-screen layout: readout and figure fill the sheet, the controls sit in a dock under the figure, the small print is a footer. */
  var LAY_CSS = "html,body{height:100%}body{position:relative;display:flex;flex-direction:column;height:100dvh;overflow:hidden;padding:0!important}" +
    ".iso-page{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:6px 12px 0!important}" +
    ".iso-figure{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}.iso-plate{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative}" +
    ".iso-plate-corners{flex:none}.smdz-st{flex:1 1 auto;min-height:90px;display:flex;justify-content:flex-start}.smdz-in{flex:none}" +
    ".smdz-bt{position:absolute;right:8px;bottom:8px;margin:0}.smdz-bt span{display:none}.smdz-bt button{min-width:36px;min-height:36px;font-size:18px;opacity:.9}" +
    ".iso-legend{flex:none;margin:4px 0 0}.iso-legend .iso-caption{display:none}" +
    ".smdc{flex:none;margin:0 0 6px;display:grid;grid-template-columns:1fr 1fr}.smdc-t{grid-column:1/3;padding:3px}.smdc-t button{min-height:34px;font-size:14px}" +
    ".smdc-r{padding:6px 12px;font-size:13px;gap:1px;border-top:1px solid var(--anatomy-faint)}.smdc-r b{font-size:10px}" +
    "@media (max-width:640px){.smdc{grid-template-columns:1fr}.smdc-t{grid-column:1}}" +
    ".smd-why{flex:0 0 auto;max-height:24vh;overflow:auto;margin:0 0 6px;display:grid;gap:3px;--w-t:#f2b84b;--w-m:#b48cff;--w-f:#4fd1a5;--w-i:#ff8fa3;--w-a:#ff7a59}body[data-theme='light'] .smd-why{--w-t:#9a6200;--w-m:#6a3fc4;--w-f:#0f7a5c;--w-i:#b4234a;--w-a:#b8421d}" +
    ".smd-why p{margin:0;padding:4px 10px;border-left:4px solid var(--c);border-radius:6px;background:color-mix(in srgb,var(--c) 11%,transparent);font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--anatomy-text)}" +
    ".smd-why b{font:700 10px system-ui;letter-spacing:.05em;text-transform:uppercase;color:var(--c);margin-right:6px}.smd-why mark{background:none;color:var(--anatomy-strong);font-weight:700}" +
    "@media (min-width:900px){.smd-why p{font-size:14px}}" +
    ".smd-dock{flex:0 0 auto;padding:8px 12px 4px;border-top:1px solid var(--anatomy-faint);background:var(--anatomy-card)}" +
    ".smd-dock .dr-controls{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin:0;font:600 13px/1.25 system-ui,-apple-system,sans-serif}" +
    "@media (max-width:640px){.smd-dock .dr-controls{grid-template-columns:1fr}}" +
    ".smd-dock .dr-range{gap:2px}.smd-dock .dr-range input{height:28px}.smd-dock .dr-range select{min-height:38px;font-size:15px}.smd-dock .dr-ticks{font-size:11px}" +
    ".smd-dock #pause{display:none}.smd-dock .dr-status{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);margin:0}" +
    ".smd-dock .dr-info{position:static;margin:6px 0 0;padding:7px 12px;font-size:13px;line-height:1.35;box-shadow:0 0 0 1px var(--anatomy-faint)}" +
    ".smd-foot{flex:0 0 auto;padding:2px 12px calc(env(safe-area-inset-bottom,0px) + 3px);font:8px/1.4 system-ui,-apple-system,sans-serif;color:var(--anatomy-muted)}" +
    ".smd-foot .bio-sources{margin:0}.smd-foot .bio-sources summary{font:600 8px system-ui,sans-serif;min-height:0;display:inline-flex;color:var(--anatomy-muted)}" +
    ".smd-foot details[open]{max-height:38vh;overflow:auto;font-size:12px;line-height:1.45;padding-top:4px}.smd-foot details[open] summary{font-size:11px}" +
    ".smdc .smdc-r{display:none}.smdc-t{grid-column:1/3}" +
    "@media (min-width:800px) and (min-aspect-ratio:5/4){body{display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-rows:minmax(0,1fr) auto}.iso-page{grid-column:1;grid-row:1/3}" +
    ".smd-dock{grid-column:2;grid-row:1;overflow:auto;border-top:0;border-left:1px solid var(--anatomy-faint);padding:10px 14px}.smd-foot{grid-column:2;grid-row:2;background:var(--anatomy-card)}" +
    ".smd-dock .dr-controls{grid-template-columns:1fr}.smd-why{max-height:none;margin-bottom:10px}.smd-why p{font-size:14px}}" +
    ".smd-help{position:absolute;inset:0;z-index:9;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}" +
    ".smd-help div{max-width:340px;margin:16px;padding:18px 20px;border-radius:18px;background:var(--anatomy-card);color:var(--anatomy-strong);box-shadow:0 0 0 1px var(--anatomy-faint),0 12px 40px rgba(0,0,0,.4);font:15px/1.45 system-ui,-apple-system,sans-serif}" +
    ".smd-help b{display:block;font-size:17px;margin-bottom:8px}.smd-help ol{margin:0 0 12px;padding-left:20px}.smd-help li{margin:4px 0}" +
    ".smd-help button{width:100%;min-height:44px;border:0;border-radius:12px;background:var(--k-mid,#4fb3ff);color:#04121c;font:700 15px system-ui}";
  /* "What is happening": the figure's Mechanism mastery entry, one short colour coded line each, with the treatment line shown when a treatment is on. */
  function explain(doc, win, dock) {
    var id = (String(win.location.pathname).match(/\/([a-z0-9-]+?)(?:-light)?\.html$/) || [])[1]; if (!id) return;
    msReady().then(function (all) {
      var m = all[id]; if (!m || !doc.body) return;
      function first(t) { t = String(t || ""); var i = t.search(/[.!?](\s|$)/); return i > 0 ? t.slice(0, i + 1) : t; }
      function fm(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>"); }
      var box = doc.createElement("div"); box.className = "smd-why"; box.setAttribute("aria-label", "What is happening");
      box.innerHTML = [["trigger", "Cause", "--w-t"], ["mechanism", "What it does", "--w-m"], ["manifestation", "Result", "--w-f"]].map(function (r) { return '<p style="--c:var(' + r[2] + ')"><b>' + r[1] + "</b>" + fm(first(m[r[0]])) + "</p>"; }).join("") +
        '<p class="smd-why-i" style="--c:var(--w-i)" hidden><b>Treatment</b>' + fm(first(m.intervention)) + "</p>" +
        (m.adverse ? '<p class="smd-why-i smd-why-a" style="--c:var(--w-a)" hidden><b>Side effects</b>' + fm(first(m.adverse)) + "</p>" : "");
      dock.insertBefore(box, dock.firstChild);
      var sel = doc.getElementById("drug"), tis = box.querySelectorAll(".smd-why-i");
      function sync() { var on = !!(sel && sel.value !== "0"); Array.prototype.forEach.call(tis, function (t) { t.hidden = !on; }); }
      if (sel) { sel.addEventListener("change", sync); sync(); }
    });
  }
  function layout(doc, win) {
    var st = doc.createElement("style"); st.id = "smdLayoutCss"; st.textContent = LAY_CSS; doc.body.appendChild(st);
    var ctl = doc.querySelector(".dr-controls"), stat = doc.getElementById("status"), info = doc.getElementById("info"), src = doc.querySelector(".bio-sources");
    if (!ctl) return;
    var dock = doc.createElement("div"); dock.className = "smd-dock";
    ctl.parentNode.insertBefore(dock, ctl);
    [ctl, stat, info].forEach(function (n) { if (n) dock.appendChild(n); });
    try { explain(doc, win, dock); } catch (e) {}
    var cap = doc.querySelector(".iso-caption"), foot = doc.createElement("div"); foot.className = "smd-foot";
    foot.appendChild(doc.createTextNode(((cap && cap.textContent) || "Schematic, not to scale.") + " Best experienced on iPad. "));
    if (src) foot.appendChild(src);
    doc.body.appendChild(dock); doc.body.appendChild(foot);
    var lv = doc.querySelector("#level"), lbl = lv && lv.closest("label") && lv.closest("label").querySelector("span");
    if (lbl && !/drag/i.test(lbl.textContent)) lbl.textContent = lbl.textContent + " (drag)";
    var KEY = "smdFigHelp", seen = false; try { seen = G.localStorage.getItem(KEY) === "1"; } catch (e) {}
    if (!seen) {
      var h = doc.createElement("div"); h.className = "smd-help";
      h.innerHTML = "<div><b>How to use this figure</b><ol><li>Drag the slider to make the disease worse or milder.</li><li>Pick a treatment and watch what changes.</li><li>Tap any label to read what it is.</li></ol><button type=\"button\">Got it</button></div>";
      h.querySelector("button").addEventListener("click", function () { h.remove(); try { G.localStorage.setItem(KEY, "1"); } catch (e) {} });
      doc.body.appendChild(h);
    }
  }
  function zoomer(doc, win) {
    var box = doc.querySelector(".dr-svg") || doc.querySelector(".iso-plate"), svg = box && box.querySelector("svg");
    if (!svg) return;
    var vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
    var st = doc.createElement("div"), inn = doc.createElement("div"), bt = doc.createElement("div");
    st.className = "smdz-st"; inn.className = "smdz-in"; bt.className = "smdz-bt";
    box.parentNode.insertBefore(st, box); inn.appendChild(box); st.appendChild(inn); st.parentNode.insertBefore(bt, st.nextSibling);
    var hint = doc.createElement("span"); hint.textContent = "Pinch or double-tap to zoom"; bt.appendChild(hint);
    var S = { s: 1, x: 0, y: 0 }, MAX = 4, W = 0, H = 0;
    var FW = 0, FH = 0, OX = 0;
    function size() {
      W = st.clientWidth; var r = vb ? vb.height / vb.width : 0.67, avail = st.clientHeight || Math.round(W * r);
      FW = Math.min(W, Math.floor(avail / r)); FH = Math.round(FW * r); H = FH; OX = Math.floor((W - FW) / 2);
      inn.style.width = FW + "px"; inn.style.marginLeft = OX + "px"; clamp(); paint();
    }
    function clamp() {
      S.s = Math.max(1, Math.min(MAX, S.s));
      var cw = FW * S.s, ch = FH * S.s;
      S.x = cw + 2 * OX > W ? Math.min(-OX, Math.max(W - OX - cw, S.x)) : 0;
      S.y = ch > st.clientHeight ? Math.min(0, Math.max(st.clientHeight - ch, S.y)) : 0;
    }
    function paint() { inn.style.transform = "translate(" + S.x + "px," + S.y + "px) scale(" + S.s + ")"; st.style.touchAction = S.s > 1.01 ? "none" : "pan-y"; }
    function zoomAt(px, py, ns) { ns = Math.max(1, Math.min(MAX, ns)); var k = ns / S.s; S.x = px - (px - S.x) * k; S.y = py - (py - S.y) * k; S.s = ns; clamp(); paint(); }
    function mk(t, label, fn) { var b = doc.createElement("button"); b.type = "button"; b.textContent = t; b.setAttribute("aria-label", label); b.addEventListener("click", fn); bt.appendChild(b); }
    mk("\u2212", "Zoom out", function () { zoomAt(FW / 2, FH / 2, S.s / 1.6); });
    mk("+", "Zoom in", function () { zoomAt(FW / 2, FH / 2, S.s * 1.6); });
    var g = null, last = 0, lp = null;
    function pt(e, i) { var r = st.getBoundingClientRect(), t = e.touches[i]; return { x: t.clientX - r.left - OX, y: t.clientY - r.top }; }
    st.addEventListener("touchstart", function (e) {
      if (e.target && e.target.closest && e.target.closest(".smdz-bt")) return;
      if (e.touches.length === 2) { var a = pt(e, 0), b = pt(e, 1); g = { k: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s: S.s, x: S.x, y: S.y }; }
      else if (e.touches.length === 1) {
        var p = pt(e, 0), now = Date.now();
        if (now - last < 320 && lp && Math.abs(lp.x - p.x) < 30 && Math.abs(lp.y - p.y) < 30) { zoomAt(p.x, p.y, S.s > 1.2 ? 1 : 2.4); last = 0; g = null; return; }
        last = now; lp = p; g = { k: S.s > 1.01 ? "pan" : "tap", x: p.x, y: p.y, sx: S.x, sy: S.y };
      }
    }, { passive: true });
    st.addEventListener("touchmove", function (e) {
      if (!g) return;
      if (g.k !== "pinch" && e.touches.length === 1) { var q = pt(e, 0); if (Math.abs(q.x - g.x) > 10 || Math.abs(q.y - g.y) > 10) last = 0; }
      if (g.k === "pinch" && e.touches.length === 2) {
        var a = pt(e, 0), b = pt(e, 1), d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var ns = Math.max(1, Math.min(MAX, g.s * d / g.d)), k = ns / g.s;
        S.s = ns; S.x = mx - (g.mx - g.x) * k; S.y = my - (g.my - g.y) * k; clamp(); paint(); e.preventDefault();
      } else if (g.k === "pan" && e.touches.length === 1) {
        var p = pt(e, 0); S.x = g.sx + (p.x - g.x); S.y = g.sy + (p.y - g.y); clamp(); paint(); e.preventDefault();
      }
    }, { passive: false });
    st.addEventListener("touchend", function (e) { if (e.touches.length === 0 && g && g.k !== "tap") g = null; });
    win.addEventListener("resize", size); if (win.ResizeObserver) new win.ResizeObserver(size).observe(st); size();
    S._api = { zoomAt: zoomAt, size: size, state: S };
    win.__smdZoom = S;
  }
  /* Pause / Play in the viewer's top bar. The figure page has its own #pause button (below the controls); this one drives it, mirrors its
   * state and remembers the choice (localStorage smdFigPaused) so a viewer who prefers stillness gets figures that open paused. */
  function motionToggle(el, doc, win) {
    var btn = el.querySelector(".smdfig-pp:not(.smdfig-ms-btn)"), pg = doc && doc.getElementById("pause"); if (!btn || !pg) return;
    var KEY = "smdFigPaused";
    function paused() { return pg.getAttribute("aria-pressed") === "true"; }
    function sync() { var p = paused(); btn.textContent = p ? "Play" : "Pause"; btn.setAttribute("aria-pressed", String(p)); btn.setAttribute("aria-label", p ? "Play the motion" : "Pause the motion"); }
    var want = null; try { want = G.localStorage.getItem(KEY); } catch (e) {}
    if (want === "1" && !paused()) pg.click();
    btn.hidden = false; sync();
    btn.addEventListener("click", function () { pg.click(); });
    if (win.MutationObserver) new win.MutationObserver(function () { sync(); try { G.localStorage.setItem(KEY, paused() ? "1" : "0"); } catch (e) {} }).observe(pg, { attributes: true, attributeFilter: ["aria-pressed"] });
  }
  /* Mechanism mastery (prep/figures/mastery.json): Trigger, Target, Mechanism, Manifestation, Intervention (with its adverse effects) for a figure,
   * shown in a sheet over the figure from the "Steps" button. The button appears only when the figure has an entry. */
  var MS = null, msP = null;
  function msReady() {
    if (MS) return Promise.resolve(MS);
    if (msP) return msP;
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    msP = G.fetch((base || "/") + "prep/figures/mastery.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { MS = (j && j.items) || {}; return MS; }, function () { MS = {}; return MS; });
    return msP;
  }
  var MS_ROWS = [["trigger", "1  Trigger", "What starts the process"], ["target", "2  Target", "The cell, receptor, enzyme or pathway affected"], ["mechanism", "3  Mechanism", "What happens at the molecular or cellular level"],
    ["manifestation", "4  Manifestation", "How it explains the symptoms, signs and tests"], ["intervention", "5  Intervention", "The drug or step that targets the mechanism"]];
  function masteryPanel(el, src) {
    var id = (src.match(/\/([a-z0-9-]+)\.html$/) || [])[1], btn = el.querySelector(".smdfig-ms-btn"); if (!id || !btn) return;
    msReady().then(function (all) {
      var m = all[id]; if (!m || !D.body.contains(el)) return;
      var sheet = D.createElement("section"); sheet.className = "smdfig-ms"; sheet.hidden = true; sheet.setAttribute("aria-label", "Mechanism mastery");
      function fmt(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>"); }
      var ROW = { trigger: "--ms-t", target: "--ms-g", mechanism: "--ms-m", manifestation: "--ms-f", intervention: "--ms-i" };
      sheet.innerHTML = '<div class="ms-head"><h2>Mechanism mastery</h2><button type="button" class="ms-x">Close</button></div><dl>' + MS_ROWS.map(function (r, n) {
        return '<div class="ms-r" style="--c:var(' + ROW[r[0]] + ')"><dt><i>' + (n + 1) + "</i>" + esc(r[1].replace(/^\d\s+/, "")) + "</dt><dd>" + fmt(m[r[0]] || "") + "</dd></div>" +
          (r[0] === "intervention" && m.adverse ? '<div class="ms-r ms-a" style="--c:var(--ms-a)"><dt><i>!</i>Adverse effects that follow from the action</dt><dd>' + fmt(m.adverse) + "</dd></div>" : "");
      }).join("") + '</dl><p class="ms-note">AI-assisted summary, awaiting clinician review.</p>';
      el.appendChild(sheet); btn.hidden = false;
      function set(on) { sheet.hidden = !on; btn.setAttribute("aria-expanded", String(on)); if (on) { try { sheet.querySelector(".ms-x").focus(); } catch (e) {} } }
      btn.addEventListener("click", function () { set(sheet.hidden); });
      sheet.querySelector(".ms-x").addEventListener("click", function () { set(false); try { btn.focus(); } catch (e) {} });
    });
  }
  function pageOf(src, dark) {
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    return (base || "/") + (dark ? src : src.replace(/\.html$/, "-light.html"));
  }
  function close() {
    if (!cur) return false;
    try { cur.el.parentNode && cur.el.parentNode.removeChild(cur.el); } catch (e) {}
    D.removeEventListener("keydown", cur.key, true);
    var from = cur.from; cur = null;
    try { if (from && from.focus) from.focus(); } catch (e) {}
    return true;
  }
  function open(o) {
    o = o || {};
    var src = String(o.src || "");
    if (!FIG_RE.test(src) || cur) return false;
    css();
    var dark = D.body.classList.contains("dark"), q = String(o.query || "").replace(/[^A-Za-z0-9=&%._ -]/g, "").slice(0, 120);
    var el = D.createElement("div");
    el.className = "smdfig" + (dark ? "" : " lt"); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", String(o.title || "Interactive figure"));
    el.innerHTML = '<div class="smdfig-top"><p>' + esc(o.title || "Interactive figure") + '' + '</p><span class="smdfig-tools"><button type="button" class="smdfig-pp smdfig-ms-btn" aria-expanded="false" hidden>Steps</button><button type="button" class="smdfig-pp" aria-pressed="false" hidden>Pause</button><button type="button" class="smdfig-x" aria-label="Close the figure">&#10005;</button></span></div>' +
      '<div class="smdfig-sc"><iframe class="smdfig-fr" title="' + esc(o.title || "Interactive figure") + '" src="' + esc(pageOf(src, dark) + (q ? "?" + q : "")) + '" sandbox="allow-scripts allow-same-origin"></iframe></div>';
    var fr = el.querySelector("iframe");
    fr.addEventListener("load", function () { try { appMode(fr.contentDocument, fr.contentWindow); } catch (e) {} try { tapInfo(fr.contentDocument, fr.contentWindow); } catch (e) {} try { motionToggle(el, fr.contentDocument, fr.contentWindow); } catch (e) {} });
    el.querySelector(".smdfig-x").addEventListener("click", close);
    try { masteryPanel(el, String(o.src || "")); } catch (e) {}
    var key = function (e) { if (e.key === "Escape") { e.stopPropagation(); var ms = el.querySelector(".smdfig-ms"); if (ms && !ms.hidden) { ms.hidden = true; var mb = el.querySelector(".smdfig-ms-btn"); if (mb) mb.setAttribute("aria-expanded", "false"); } else close(); } };
    D.addEventListener("keydown", key, true);
    D.body.appendChild(el);
    cur = { el: el, from: o.from || null, key: key };
    try { el.querySelector(".smdfig-x").focus(); } catch (e) {}
    return true;
  }
  /* ---- registry (prep/figures/figures.json): one figure, every place it helps ----
   * A figure lists the drug names it explains (name -> preset query) and class phrases. The same text match serves the Drugs
   * page (forDrug), MCQ explanations, lesson steps and Knowledge Library articles (matchText on the text shown there).
   * Names match whole words, case-insensitive; a class phrase counts as a hit too. Nothing shows until the registry is loaded. */
  var REG = null, regP = null;
  function esc2(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function build(j) {
    var figs = (j && j.figures) || [];
    return figs.filter(function (f) { return f && FIG_RE.test(String(f.page || "")); }).map(function (f) {
      var names = Object.keys(f.drugs || {});
      var parts = names.map(esc2).concat((f.terms || []).map(String));
      var rx = null; try { rx = parts.length ? new RegExp("(?:^|[^a-z])(" + parts.join("|") + ")(?![a-z])", "gi") : null; } catch (e) { rx = null; }
      var weak = {}; (f.weak || []).forEach(function (w) { weak[String(w).toLowerCase()] = 1; });
      var ctx = null; try { ctx = f.ctx ? new RegExp(f.ctx, "i") : null; } catch (e) { ctx = null; }
      return { id: String(f.id), title: String(f.title || "Interactive figure"), blurb: String(f.blurb || ""), page: String(f.page), scene: f.scene === true, drugs: f.drugs || {}, rx: rx, weak: weak, ctx: ctx };
    });
  }
  function ready() {
    if (REG) return Promise.resolve(REG);
    if (regP) return regP;
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    regP = G.fetch((base || "/") + "prep/figures/figures.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { REG = build(j); return REG; }, function () { REG = []; return REG; });
    return regP;
  }
  /* list() -> every registered figure { id, title, blurb, page, scene } in registry order ([] until ready()); the iLearn page reads it. */
  function list() { return (REG || []).map(function (f) { return { id: f.id, title: f.title, blurb: f.blurb, page: f.page, scene: f.scene }; }); }
  function byId(id) { for (var i = 0; REG && i < REG.length; i++) if (REG[i].id === id) return REG[i]; return null; }
  /* matchText(text, max) -> [{ id, title, blurb, hits, query }] most hits first (sync; [] until ready()). query presets the figure
     to the first drug of that figure named in the text. */
  function matchText(text, max) {
    var t = String(text || ""), out = [];
    (REG || []).forEach(function (f) {
      if (!f.rx) return;
      f.rx.lastIndex = 0;
      var m, hits = 0, first = "";
      while ((m = f.rx.exec(t))) { var nm = String(m[1]).toLowerCase(); if (f.weak[nm] && f.ctx && !f.ctx.test(t)) continue; hits++; if (!first && f.drugs[nm]) first = f.drugs[nm] + "&name=" + encodeURIComponent(nm.charAt(0).toUpperCase() + nm.slice(1)); if (hits > 50) break; }
      if (hits) out.push({ id: f.id, title: f.title, blurb: f.blurb, hits: hits, query: first });
    });
    out.sort(function (a, b) { return b.hits - a.hits; });
    return out.slice(0, max || 1);
  }
  /* forDrugs(name) -> every figure that names this drug (the generic's first word), each with its preset query; [] when none. */
  function forDrugs(name) {
    var w = String(name || "").toLowerCase().replace(/[^a-z ]/g, " ").trim().split(/\s+/)[0] || "", out = [];
    for (var i = 0; REG && w && i < REG.length; i++) if (REG[i].drugs[w]) out.push({ id: REG[i].id, title: REG[i].title, blurb: REG[i].blurb, name: w, query: REG[i].drugs[w] + "&name=" + encodeURIComponent(w.charAt(0).toUpperCase() + w.slice(1)) });
    return out;
  }
  function forDrug(name) { return forDrugs(name)[0] || null; }
  function openFig(id, query, from) {
    var f = byId(id); if (!f) return false;
    return open({ src: f.page, title: f.title, from: from, query: query || "" });
  }
  /* chipHtml(m): the "See how it works" button for a matchText hit; the host's click handler calls openFig(data-f, data-q). */
  function chipHtml(m, cls, act) {
    if (!m) return "";
    return '<button type="button" class="' + esc(cls || "smdfig-chip") + '" data-act="' + (act || "fig-open") + '" data-f="' + esc(m.id) + '" data-q="' + esc(m.query || "") + '"><span aria-hidden="true">&#9654;</span> <b>' + esc(m.title) + "</b></button>";
  }
  G.SMD_FIG = { mastery: function (id) { return (MS || {})[id] || null; }, masteryReady: msReady, list: list, open: open, close: close, isOpen: function () { return !!cur; }, _re: FIG_RE, ready: ready, matchText: matchText, forDrug: forDrug, forDrugs: forDrugs, openFig: openFig, chipHtml: chipHtml, _build: build };
  ready();
})(typeof window !== "undefined" ? window : this);
