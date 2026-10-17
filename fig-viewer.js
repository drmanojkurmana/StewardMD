/* Interactive figure viewer (window.SMD_FIG). ES5.
 * Opens a self-contained figure page (prep/figures/<name>.html, built with the Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt)
 * full screen over whatever is open, in the app's theme: <name>.html is the dark build, <name>-light.html the light one.
 *   SMD_FIG.open({ src: "prep/figures/beta-blockers.html", title, from: element, query: "d=2&name=Metoprolol" })
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
  var COLOR_CSS = "body.iso{--anatomy-mono:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,system-ui,sans-serif;--k-mem:#4c8dff;--k-src:#2fd4a0;--k-mid:#4fb3ff;--k-out:#ffb43a;--k-bad:#ff6b7a;--k-enz:#a78bfa;--k-rec:#34d399;--k-gp:#8b7bff;--k-vs:#ffb86b}" +
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
    ".smdc-r{display:flex;gap:10px;align-items:baseline;padding:9px 14px;border-top:1px solid var(--anatomy-faint);font:15px/1.35 system-ui,-apple-system,sans-serif;color:var(--anatomy-text)}" +
    ".smdc-r b{flex:none;min-width:92px;font:600 12px system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--anatomy-muted)}.smdc-r span{color:var(--anatomy-strong);font-weight:600}.smdc-r.on{background:color-mix(in srgb,var(--k-mid) 10%,transparent)}" +
    "[data-readout]{display:none!important}";
  /* with and without the drug: a two-way switch, and both readouts side by side */
  function compare(doc) {
    var sel = doc.getElementById("drug"), ro = doc.querySelector("[data-readout]"), lv = doc.getElementById("level"), host = doc.querySelector(".iso-plate-corners");
    if (!sel || !ro || !host || sel.options.length < 2) return;
    var st = doc.createElement("style"); st.textContent = CMP_CSS; doc.body.appendChild(st);
    var box = doc.createElement("div"); box.className = "smdc";
    box.innerHTML = '<div class="smdc-t" role="group" aria-label="Show without or with the drug"><button type="button" data-w="0">Without drug</button><button type="button" data-w="1">With drug</button></div>' +
      '<div class="smdc-r" data-r="0"><b>Without</b><span></span></div><div class="smdc-r" data-r="1"><b>With</b><span></span></div>';
    host.parentNode.insertBefore(box, host);
    var last = sel.value !== "0" ? sel.value : "1", busy = false, ts = box.querySelectorAll(".smdc-t button"), rows = box.querySelectorAll(".smdc-r");
    function fire() { sel.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true })); }
    function read(v) { var cur = sel.value; busy = true; sel.value = v; fire(); var t = ro.textContent; sel.value = cur; fire(); busy = false; return t; }
    function paint() {
      var on = sel.value !== "0"; if (on) last = sel.value;
      ts[0].setAttribute("aria-pressed", on ? "false" : "true"); ts[1].setAttribute("aria-pressed", on ? "true" : "false");
      var w = read("0"), d = on ? ro.textContent : read(last), dn = sel.options[+last] ? sel.options[+last].text : "drug";
      rows[0].querySelector("span").textContent = w; rows[1].querySelector("span").textContent = d; rows[1].querySelector("b").textContent = "With";
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
        return "\u2665 " + c2 + (strong ? (up ? " increased (\u2191)" : " decreased (\u2193)") : (up ? " not increased" : " not decreased"));
      }
      var pre = /heart/i.test(core) ? "\u2665 " : "";
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
  function appMode(doc, win) {
    if (!doc || !doc.body || doc.getElementById("smdAppCss")) return;
    var st = doc.createElement("style"); st.id = "smdAppCss"; st.textContent = APP_CSS + COLOR_CSS; doc.body.appendChild(st);
    var vp = doc.querySelector('meta[name="viewport"]'); if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover");
    var info = doc.getElementById("info"); if (info) info.textContent = "Tap a labelled part for a one-line explanation.";
    var src = doc.querySelector(".bio-sources");
    if (src && !src.querySelector("details")) {
      var dt = doc.createElement("details"), sm = doc.createElement("summary"); sm.textContent = "What the figure shows, and how sure we are";
      dt.appendChild(sm); while (src.firstChild) dt.appendChild(src.firstChild); src.appendChild(dt);
    }
    /* a tap on a labelled part shows its explanation (touch has no hover) */
    Array.prototype.forEach.call(doc.querySelectorAll(".hot"), function (h) { h.addEventListener("touchend", function () { try { h.focus(); } catch (e) {} }, { passive: true }); });
    legend(doc); arrows(doc); compare(doc); zoomer(doc, win);
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
    function size() { W = st.clientWidth; var r = vb ? vb.height / vb.width : 0.67; H = Math.round(W * r); st.style.height = H + "px"; clamp(); paint(); }
    function clamp() { S.s = Math.max(1, Math.min(MAX, S.s)); S.x = Math.min(0, Math.max(W - W * S.s, S.x)); S.y = Math.min(0, Math.max(H - H * S.s, S.y)); }
    function paint() { inn.style.transform = "translate(" + S.x + "px," + S.y + "px) scale(" + S.s + ")"; st.style.touchAction = S.s > 1.01 ? "none" : "pan-y"; }
    function zoomAt(px, py, ns) { ns = Math.max(1, Math.min(MAX, ns)); var k = ns / S.s; S.x = px - (px - S.x) * k; S.y = py - (py - S.y) * k; S.s = ns; clamp(); paint(); }
    function mk(t, label, fn) { var b = doc.createElement("button"); b.type = "button"; b.textContent = t; b.setAttribute("aria-label", label); b.addEventListener("click", fn); bt.appendChild(b); }
    mk("\u2212", "Zoom out", function () { zoomAt(W / 2, H / 2, S.s / 1.6); });
    mk("+", "Zoom in", function () { zoomAt(W / 2, H / 2, S.s * 1.6); });
    var g = null, last = 0, lp = null;
    function pt(e, i) { var r = st.getBoundingClientRect(), t = e.touches[i]; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
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
    win.addEventListener("resize", size); size();
    S._api = { zoomAt: zoomAt, size: size, state: S };
    win.__smdZoom = S;
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
    el.innerHTML = '<div class="smdfig-top"><p>' + esc(o.title || "Interactive figure") + '' + '</p><button type="button" class="smdfig-x" aria-label="Close the figure">&#10005;</button></div>' +
      '<div class="smdfig-sc"><iframe class="smdfig-fr" title="' + esc(o.title || "Interactive figure") + '" src="' + esc(pageOf(src, dark) + (q ? "?" + q : "")) + '" sandbox="allow-scripts allow-same-origin"></iframe></div>';
    var fr = el.querySelector("iframe");
    fr.addEventListener("load", function () { try { appMode(fr.contentDocument, fr.contentWindow); } catch (e) {} });
    el.querySelector(".smdfig-x").addEventListener("click", close);
    var key = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
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
      return { id: String(f.id), title: String(f.title || "Interactive figure"), blurb: String(f.blurb || ""), page: String(f.page), drugs: f.drugs || {}, rx: rx, weak: weak, ctx: ctx };
    });
  }
  function ready() {
    if (REG) return Promise.resolve(REG);
    if (regP) return regP;
    var base = (G.SMD_PREP_BASE || "/prep/").replace(/prep\/$/, "");
    regP = G.fetch((base || "/") + "prep/figures/figures.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { REG = build(j); return REG; }, function () { REG = []; return REG; });
    return regP;
  }
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
  G.SMD_FIG = { open: open, close: close, isOpen: function () { return !!cur; }, _re: FIG_RE, ready: ready, matchText: matchText, forDrug: forDrug, forDrugs: forDrugs, openFig: openFig, chipHtml: chipHtml, _build: build };
  ready();
})(typeof window !== "undefined" ? window : this);
