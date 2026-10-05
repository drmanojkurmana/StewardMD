/* smd-num.js — value-change motion + loading skeleton helper (window.SMD_NUM, window.SMD_SKEL).
 * ---------------------------------------------------------------------------
 * SMD_NUM.set(el, value, opts)  updates a number element IN PLACE.
 *   opts.kind   "counter" (default): only the digits that changed roll (200ms, strong ease-out).
 *               "clinical": whole-value swap (old out 120ms, new in 180ms). The screen NEVER shows a
 *               number that is neither the old value nor the final value: doses, scores and labs must
 *               not tween through values that never existed.
 *   opts.format optional formatter, value -> string.
 *   opts.live   true: polite live region (only where the number is a status).
 * First render, same value, reduced motion, no WAAPI, or localStorage smd_num_motion="0" = instant swap.
 * A new set() mid-animation cancels the running one and retargets from what is on screen.
 * A11y: at rest the value is in the DOM exactly ONCE (plain text in the visual layer, readable by AT and
 * by textContent). Only while a roll runs does a visually hidden node carry the final text and the
 * animated layer go aria-hidden; the hidden copy is emptied when the roll settles.
 *
 * SMD_SKEL: skeleton shown only if loading takes longer than 300ms; container gets aria-busy.
 *   SMD_SKEL.start(container, SMD_SKEL.html("list")) -> stop()      (JS-managed container)
 *   SMD_SKEL.html(shape, opts)                                      (string renderers: CSS-delayed 300ms)
 * Styles live in motion.css (.smd-num*, .smd-skel*). ES5, no deps. */
(function () {
  "use strict";
  var W = window, D = document;
  var EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
  var DELAY = 300;

  function motionOff() {
    try { if (W.localStorage && W.localStorage.getItem("smd_num_motion") === "0") return true; } catch (e) {}
    try { if (W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches) return true; } catch (e2) {}
    return false;
  }
  function str(v, o) {
    if (o && typeof o.format === "function") { try { return String(o.format(v)); } catch (e) {} }
    return v == null ? "" : String(v);
  }
  function mk(cls, text) {
    var n = D.createElement("span");
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function addClass(el, c) { if ((" " + (el.className || "") + " ").indexOf(" " + c + " ") < 0) el.className = ((el.className || "") + " " + c).replace(/^\s+/, ""); }

  // Build (once per element) the sr + visual layers. Existing children are replaced.
  function layers(el, o) {
    var st = el.__smdNum;
    if (st) return st;
    st = el.__smdNum = { text: null, shown: null, anims: [], vis: mk("smd-num-vis"), sr: mk("smd-num-sr"), token: 0 };
    clear(el);
    el.appendChild(st.sr);
    el.appendChild(st.vis);
    addClass(el, "smd-num");
    if (el.style) el.style.fontVariantNumeric = "tabular-nums";
    if (o && o.live) { el.setAttribute("aria-live", "polite"); el.setAttribute("aria-atomic", "true"); }
    return st;
  }
  function cancelAnims(st) {
    var a = st.anims; st.anims = []; st.token++;
    for (var i = 0; i < a.length; i++) { try { a[i].onfinish = null; a[i].cancel(); } catch (e) {} }
  }
  // At rest: one copy of the value (visual layer, exposed to AT). Never leave the sr copy filled too,
  // or host.textContent reads "250k250k" wherever the CSS that hides .smd-num-sr is absent or ignored.
  function paint(st, text) {
    clear(st.vis);
    st.vis.appendChild(D.createTextNode ? D.createTextNode(text) : mk("", text));
    st.shown = text;
    st.sr.textContent = "";
    st.vis.removeAttribute("aria-hidden");
  }
  // While a roll runs the visual layer holds partial glyphs, so AT reads the final value from sr instead.
  function busy(st, text) {
    st.sr.textContent = text;
    st.vis.setAttribute("aria-hidden", "true");
  }
  function run(st, node, from, to, dur, delay) {
    var a;
    try { a = node.animate([from, to], { duration: dur, delay: delay || 0, easing: EASE, fill: "both" }); } catch (e) { return null; }
    st.anims.push(a);
    return a;
  }
  // Calls done() once every animation in `list` has finished (or immediately if there is none).
  function whenAll(st, list, done) {
    var token = st.token, left = 0, i;
    for (i = 0; i < list.length; i++) if (list[i]) left++;
    if (!left) { done(); return; }
    function fin() { if (st.token !== token) return; if (--left === 0) done(); }
    for (i = 0; i < list.length; i++) if (list[i]) list[i].onfinish = fin;
  }

  function counter(st, from, to) {
    var off = to.length - from.length, anims = [], i;
    clear(st.vis);
    for (i = 0; i < to.length; i++) {
      var oc = i - off >= 0 ? from.charAt(i - off) : null, nc = to.charAt(i);
      if (oc === nc) { st.vis.appendChild(mk("", nc)); continue; }
      var slot = mk("smd-num-slot"), nu = mk("", nc), od = null;
      if (oc != null) { od = mk("", oc); slot.appendChild(od); }
      slot.appendChild(nu);
      st.vis.appendChild(slot);
      if (od) anims.push(run(st, od, { transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-0.55em)", opacity: 0 }, 200));
      anims.push(run(st, nu, { transform: "translateY(0.55em)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }, 200));
    }
    st.shown = to;
    whenAll(st, anims, function () { st.anims = []; paint(st, to); });
  }
  function clinical(st, from, to) {
    var out = mk("", from);
    clear(st.vis); st.vis.appendChild(out);
    var a = run(st, out, { transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-4px)", opacity: 0 }, 120);
    whenAll(st, [a], function () {
      st.anims = [];
      var nu = mk("", to);
      clear(st.vis); st.vis.appendChild(nu);
      st.shown = to;
      var b = run(st, nu, { transform: "translateY(4px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }, 180);
      whenAll(st, [b], function () { st.anims = []; paint(st, to); });
    });
  }

  var NUM = {
    set: function (el, value, opts) {
      if (!el) return;
      var o = opts || {}, text = str(value, o), st = el.__smdNum, first;
      if (st && (st.vis.parentNode !== el || st.sr.parentNode !== el)) { cancelAnims(st); st = el.__smdNum = null; }   // host re-rendered its children
      first = !st;
      st = layers(el, o);
      if (!first && st.text === text) return;
      var from = st.shown;                       // what is on screen right now (old value, or old target mid-roll)
      cancelAnims(st);
      st.text = text;
      if (first || from == null || from === text || motionOff() || !st.vis.animate) { paint(st, text); return; }
      busy(st, text);                            // assistive tech gets the final value for the whole roll
      if (o.kind === "clinical") clinical(st, from, text); else counter(st, from, text);
    },
    // test/debug helpers
    text: function (el) { return el && el.__smdNum ? el.__smdNum.text : null; }
  };

  // ---- skeleton -------------------------------------------------------------
  function bar(cls) { return '<div class="smd-skel ' + cls + '"></div>'; }
  var SKEL = {
    DELAY: DELAY,
    // shape: "list" (avatar rows), "card", "lines" (default), "block". opts: rows, label (sr text; plain, trusted), late:false
    html: function (shape, opts) {
      var o = opts || {}, n = o.rows || 4, s = "", i;
      if (shape === "list") for (i = 0; i < n; i++) s += '<div class="smd-skel-row">' + bar("smd-skel-circle") + '<div class="smd-skel-col">' + bar("smd-skel-line") + bar("smd-skel-line smd-skel-sm") + "</div></div>";
      else if (shape === "card") for (i = 0; i < n; i++) s += bar("smd-skel-block");
      else if (shape === "block") s = bar("smd-skel-block");
      else for (i = 0; i < n; i++) s += bar("smd-skel-line" + (i === n - 1 ? " smd-skel-sm" : i % 3 === 2 ? " smd-skel-lg" : ""));
      return '<div class="smd-skel-wrap' + (o.late === false ? "" : " smd-skel-late") + '" aria-busy="true">' + (o.label ? '<span class="smd-sr">' + o.label + "</span>" : "") + '<div aria-hidden="true">' + s + "</div></div>";
    },
    // Marks `container` busy now; shows `html` only if still loading after opts.delay (300ms). Returns stop().
    start: function (container, html, opts) {
      if (!container) return function () {};
      var delay = opts && opts.delay != null ? opts.delay : DELAY, node = null, done = false, t;
      container.setAttribute("aria-busy", "true");
      t = W.setTimeout(function () {
        if (done) return;
        var h = D.createElement("div");
        h.className = "smd-skel-host";
        h.innerHTML = html;
        node = h;
        container.appendChild(h);
      }, delay);
      return function stop() {
        if (done) return;
        done = true; W.clearTimeout(t);
        if (node && node.parentNode) node.parentNode.removeChild(node);
        container.removeAttribute("aria-busy");
      };
    }
  };

  // ---- numeric input hints (B11) --------------------------------------------
  // ~60 renderers emit <input type="number"> without inputmode. One delegated listener gives them the
  // decimal pad (integer pad when step is a whole number) and a Next/Done return key. Attribute-only.
  function hint(e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || t.type !== "number") return;
    if (!t.getAttribute("inputmode")) { var step = t.getAttribute("step"); t.setAttribute("inputmode", step && /^\d+$/.test(step) ? "numeric" : "decimal"); }
    if (!t.getAttribute("enterkeyhint")) t.setAttribute("enterkeyhint", "done");
  }
  try { D.addEventListener("focusin", hint, true); } catch (e3) {}

  W.SMD_NUM = NUM;
  W.SMD_SKEL = SKEL;
})();
