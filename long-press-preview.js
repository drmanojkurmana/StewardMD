/* StewardMD — long-press previews with quick actions (long-press-preview.js).
 *
 * Press and hold a list row that has its own action buttons (a ward patient card with "Call", a
 * queue row with Add / View, ...): the row sinks slightly under the finger, then lifts out of the
 * page with a medium haptic, the page behind blurs and dims, and a menu of that row's actions
 * appears beside it ("Open" first, then each of the row's own buttons). Choosing one presses the
 * real control; tapping outside puts the row back. Like an iOS context menu.
 *
 * Actions are only ever the row's own controls, so nothing new can be done from here (no copy, no
 * share: no-copy.js keeps PHI off the clipboard, and that stays true). Rows with no inner controls
 * keep their normal behaviour. Excluded: home's tool grid (its long-press rearranges), inputs,
 * MaiK's companion, [data-no-peek]. Kill switch: localStorage smd_peek=0. */
(function () {
  "use strict";
  var HOLD_MS = 430, SLOP = 8;
  // Menu goes below the row when it fits, else above; clamped inside the screen.
  function placeMenu(rowRect, menuH, vh, pad) {
    pad = pad || 12;
    var below = rowRect.bottom * 1.0 + 10;
    if (below + menuH <= vh - pad) return { top: below, side: "below" };
    var above = rowRect.top - 10 - menuH;
    if (above >= pad) return { top: above, side: "above" };
    return { top: Math.max(pad, vh - pad - menuH), side: "over" };
  }
  function labelOf(text, aria, title) {
    var t = String(aria || title || text || "").replace(/\s+/g, " ").trim();
    return t.length >= 1 && t.length <= 32 ? t : "";
  }
  var seam = { placeMenu: placeMenu, labelOf: labelOf, HOLD_MS: HOLD_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_peek") === "0") return; } catch (e) {}
  window.SMD_PEEK_SEAM = seam;

  var ROW = "button,a[href],[role='button'],[onclick],[data-act]";
  var EXCLUDE = "#rnavToolsGrid,.rnav-tile,.rnav-tab,input,textarea,select,[contenteditable],[data-no-peek],[class*='maik-comp'],#maikSheet";
  var CTRL = "button,a[href],[role='button'],[onclick]";

  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function shown(el) {
    if (!el.getClientRects().length) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) { var cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return false; }
    return true;
  }
  function actionsOf(row) {
    var out = [], c = row.querySelectorAll(CTRL);
    for (var i = 0; i < c.length && out.length < 6; i++) {
      var b = c[i]; if (b === row || !shown(b) || b.disabled) continue;
      var l = labelOf(b.textContent, b.getAttribute("aria-label"), b.getAttribute("title"));
      if (l) out.push({ label: l, el: b });
    }
    return out;
  }
  function rowFor(t) {
    if (!t || !t.closest || t.closest(EXCLUDE)) return null;
    var row = t.closest(ROW); if (!row) return null;
    // A press on an inner control is that control's; walk up to the row that contains it.
    function rowish(el) { var r = el.getBoundingClientRect(); return r.width >= innerWidth * 0.7 && r.height >= 44 && r.height <= 260; }
    var outer = row.parentElement && row.parentElement.closest(ROW);
    if (outer && !outer.closest(EXCLUDE) && rowish(outer)) row = outer;
    return rowish(row) ? row : null;
  }

  /* ---- overlay ---- */
  var ov = null;
  function close(then) {
    if (!ov) { if (then) then(); return; }
    var o = ov; ov = null;
    o.back.style.opacity = "0"; o.menu.style.opacity = "0"; o.menu.style.transform = "scale(.9)";
    o.clone.style.transition = "transform .24s cubic-bezier(.32,.72,0,1),box-shadow .24s"; o.clone.style.transform = "none"; o.clone.style.boxShadow = "none";
    setTimeout(function () {
      o.root.remove(); o.row.style.visibility = "";
      if (then) then();
    }, reduced() ? 0 : 230);
  }
  function open(row, acts) {
    var r = row.getBoundingClientRect(), cs = getComputedStyle(row);
    var dark = document.body.classList.contains("dark") || document.body.classList.contains("v3-dark");
    var root = document.createElement("div");
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Actions");
    root.style.cssText = "position:fixed;inset:0;z-index:2147482500;touch-action:none";
    var back = document.createElement("div");
    back.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,.18);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);opacity:0;transition:opacity .24s linear";
    root.appendChild(back);
    // The lifted row: a visual copy (inert, no ids, no handlers) with the row's own box styling.
    var clone = row.cloneNode(true);
    clone.removeAttribute("id"); clone.removeAttribute("onclick");
    [].forEach.call(clone.querySelectorAll("[id],[onclick]"), function (n) { n.removeAttribute("id"); n.removeAttribute("onclick"); });
    clone.setAttribute("aria-hidden", "true"); clone.inert = true;
    ["backgroundColor", "backgroundImage", "border", "borderRadius", "padding", "color", "fontFamily", "fontSize", "lineHeight", "textAlign", "display", "flexDirection", "alignItems", "justifyContent", "gap"].forEach(function (k) { clone.style[k] = cs[k]; });
    if (cs.backgroundColor === "rgba(0, 0, 0, 0)") clone.style.backgroundColor = dark ? "#1c1f24" : "#fff";
    clone.style.position = "absolute"; clone.style.left = r.left + "px"; clone.style.top = r.top + "px";
    clone.style.width = r.width + "px"; clone.style.height = r.height + "px"; clone.style.margin = "0"; clone.style.boxSizing = "border-box";
    clone.style.transformOrigin = "50% 50%"; clone.style.willChange = "transform"; clone.style.pointerEvents = "none";
    root.appendChild(clone);
    // Menu
    var menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    var bg = dark ? "rgba(44,46,52,.86)" : "rgba(250,250,252,.88)", ink = dark ? "#f2f4f7" : "#0f172a", sep = dark ? "rgba(255,255,255,.10)" : "rgba(15,23,42,.10)";
    menu.style.cssText = "position:absolute;min-width:220px;max-width:min(300px,calc(100vw - 24px));border-radius:14px;overflow:hidden;background:" + bg +
      ";-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);box-shadow:0 12px 40px rgba(0,0,0,.22);opacity:0;transform:scale(.86);transition:opacity .18s linear,transform .32s cubic-bezier(.32,1.2,.5,1)";
    var all = [{ label: "Open", el: row, primary: true }].concat(acts);
    all.forEach(function (a, i) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = a.label;
      b.style.cssText = "display:block;width:100%;text-align:left;border:0;background:transparent;color:" + ink + ";font:" + (a.primary ? 600 : 400) +
        " 16px/1.25 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:13px 16px;cursor:pointer" + (i ? ";border-top:.5px solid " + sep : "");
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        close(function () { try { a.el.click(); } catch (x) {} });
      });
      menu.appendChild(b);
    });
    root.appendChild(menu);
    back.addEventListener("click", function () { close(); });
    document.body.appendChild(root);
    var mh = menu.offsetHeight, mw = menu.offsetWidth, pl = placeMenu(r, mh, innerHeight);
    var left = Math.min(Math.max(12, r.left + 8), innerWidth - 12 - mw);
    menu.style.left = left + "px"; menu.style.top = pl.top + "px";
    menu.style.transformOrigin = (pl.side === "above" ? "0 100%" : "0 0");
    row.style.visibility = "hidden";
    ov = { root: root, back: back, menu: menu, clone: clone, row: row };
    void root.offsetWidth;
    back.style.opacity = "1"; menu.style.opacity = "1"; menu.style.transform = "scale(1)";
    clone.style.transition = reduced() ? "none" : "transform .34s cubic-bezier(.32,1.25,.5,1),box-shadow .3s";
    clone.style.transform = "scale(1.035)"; clone.style.boxShadow = "0 18px 44px rgba(0,0,0,.24)";
    try { menu.firstChild.focus({ preventScroll: true }); } catch (x) {}
  }
  document.addEventListener("keydown", function (e) { if (ov && e.key === "Escape") close(); }, true);

  /* ---- press-and-hold ---- */
  var p = null, swallowUntil = 0;
  function cancel() { if (!p) return; clearTimeout(p.t1); clearTimeout(p.t2); p.row.style.transition = "transform .2s cubic-bezier(.32,.72,0,1)"; p.row.style.transform = ""; p = null; }
  document.addEventListener("pointerdown", function (e) {
    if (ov || p || e.pointerType === "mouse" || !e.isPrimary) return;
    var row = rowFor(e.target); if (!row) return;
    var acts = actionsOf(row); if (!acts.length) return;
    p = { row: row, acts: acts, x: e.clientX, y: e.clientY };
    p.t1 = setTimeout(function () {   // the sink: tells the finger something will happen
      if (!p || reduced()) return;
      p.row.style.transition = "transform " + (HOLD_MS - 150) + "ms cubic-bezier(.4,0,.2,1)"; p.row.style.transform = "scale(.97)";
    }, 150);
    p.t2 = setTimeout(function () {
      if (!p) return;
      var row2 = p.row, a = p.acts; p = null;
      row2.style.transition = "none"; row2.style.transform = "";
      swallowUntil = Date.now() + 800;
      try { window.SMD_HAPTICS && SMD_HAPTICS.medium(); } catch (x) {}
      open(row2, a);
    }, HOLD_MS);
  }, true);
  document.addEventListener("pointermove", function (e) { if (p && (Math.abs(e.clientX - p.x) > SLOP || Math.abs(e.clientY - p.y) > SLOP)) cancel(); }, true);
  document.addEventListener("pointerup", cancel, true);
  document.addEventListener("pointercancel", cancel, true);
  // Only a scroll that moves THIS row cancels (an auto-scrolling carousel elsewhere must not).
  document.addEventListener("scroll", function (e) {
    var t = e.target; if (p && t && (t === document || (t.contains && t.contains(p.row)))) cancel();
  }, { capture: true, passive: true });
  // The finger lifting after the menu opened must not "tap" anything: not the row underneath, and not
  // the backdrop now under the finger (which would close the menu the instant it opened).
  document.addEventListener("click", function (e) {
    if (Date.now() < swallowUntil) { e.stopImmediatePropagation(); e.preventDefault(); swallowUntil = 0; }
  }, true);
  document.addEventListener("contextmenu", function (e) { if (Date.now() < swallowUntil) e.preventDefault(); }, true);
})();
