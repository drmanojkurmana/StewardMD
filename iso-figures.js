/* StewardMD isometric figures: the small runtime that mounts the equipment figures built by tools/iso/build.mjs.
   ES5, buildless IIFE. The figures themselves (iso-fig-<id>.js) are static SVG drawn at build time with the vendored
   Anatomy kit (tools/iso/kit, MIT), plus a hand-written ES5 driver whose pure model sets every number the figure shows.
   This file only places them, moves their parts and draws the card. Nothing here is loaded for a figure until a page
   asks for one, so a module that never shows a figure pays for this file alone.

   A host writes SMD_ISO.slot(id, opts) into its markup; a MutationObserver mounts every slot that appears (repaints
   included). A host that owns the inputs (Narke's circuit explorer) passes controls: false and calls
   SMD_ISO.set(id, state) when they change.
   Kill switch: localStorage smd_iso = "0" or ?iso=0 for this load; slot() then returns "".
   Node: module.exports = the pure helpers (test/iso-figures.test.mjs). */
(function (G) {
  "use strict";
  var V = "iso2";
  var NUM = /(-?\d*\.?\d+(?:e[-+]?\d+)?)/;

  /* ================= pure helpers ================= */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fmt(n) { var s = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""); return s === "-0" ? "0" : s; }
  // Screen point of a world point through the figure's basis {o, x, y, z} (each a 2D vector per world unit).
  function proj(B, p) { return [B.o[0] + p[0] * B.x[0] + p[1] * B.y[0] + p[2] * B.z[0], B.o[1] + p[0] * B.x[1] + p[1] * B.y[1] + p[2] * B.z[1]]; }
  function shift(B, d) { return [d[0] * B.x[0] + d[1] * B.y[0] + d[2] * B.z[0], d[0] * B.x[1] + d[1] * B.y[1] + d[2] * B.z[1]]; }
  function pathOf(B, pts, closed) {
    var out = "";
    for (var i = 0; i < pts.length; i++) { var q = proj(B, pts[i]); out += (i ? "L" : "M") + fmt(q[0]) + " " + fmt(q[1]); }
    return out + (closed ? "Z" : "");
  }
  // A morph is a list of keyframes at fractions m.f; keyframes with the same text skeleton (m.k[i].t) are blended
  // number by number, otherwise the nearer keyframe is shown. Returns the markup at fraction f.
  function morphAt(m, f) {
    var n = m.f.length, i = 0;
    f = clamp(f, m.f[0], m.f[n - 1]);
    while (i < n - 2 && f > m.f[i + 1]) i++;
    var a = m.k[i], b = m.k[Math.min(i + 1, n - 1)], span = m.f[Math.min(i + 1, n - 1)] - m.f[i];
    var u = span > 0 ? (f - m.f[i]) / span : 0;
    if (a.t !== b.t) return join(m.t[(u < 0.5 ? a : b).t], (u < 0.5 ? a : b).n, null, 0);
    return join(m.t[a.t], a.n, b.n, u);
  }
  function join(texts, an, bn, u) {
    var out = texts[0];
    for (var i = 0; i < an.length; i++) {
      var v = an[i];
      if (bn && bn[i] !== v) v = fmt(+an[i] + (+bn[i] - +an[i]) * u);
      out += v + texts[i + 1];
    }
    return out;
  }
  // The point a fraction u of the way along a world polyline (by length).
  function along(pts, u) {
    var i, len = [0], total = 0;
    for (i = 1; i < pts.length; i++) { total += Math.sqrt(Math.pow(pts[i][0] - pts[i - 1][0], 2) + Math.pow(pts[i][1] - pts[i - 1][1], 2) + Math.pow(pts[i][2] - pts[i - 1][2], 2)); len.push(total); }
    var want = clamp(u, 0, 1) * total;
    for (i = 1; i < pts.length; i++) if (len[i] >= want) break;
    i = Math.min(i, pts.length - 1);
    var seg = len[i] - len[i - 1], w = seg > 0 ? (want - len[i - 1]) / seg : 0, a = pts[i - 1], b = pts[i];
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
  }
  function split(markup) {
    var parts = markup.split(NUM), texts = [], nums = [];
    for (var i = 0; i < parts.length; i++) (i % 2 ? nums : texts).push(parts[i]);
    return { texts: texts, nums: nums };
  }
  var PURE = { clamp: clamp, fmt: fmt, proj: proj, shift: shift, pathOf: pathOf, morphAt: morphAt, split: split, along: along, V: V };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }

  /* ================= browser ================= */
  var D = G.document, FIGS = (G.SMD_ISO_FIGS = G.SMD_ISO_FIGS || {}), loading = {}, live = [], cssDone = false;

  function enabled() {
    try {
      var q = (G.location.search.match(/[?&]iso=([^&]+)/) || [])[1];
      if (q != null) return !(q === "0" || q === "off" || q === "false");
      return G.localStorage.getItem("smd_iso") !== "0";
    } catch (e) { return true; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function base() { return G.SMD_ISO_BASE || "/"; }
  function css() {
    if (cssDone || D.querySelector("link[data-smd-iso]")) { cssDone = true; return; }
    var l = D.createElement("link");
    l.rel = "stylesheet"; l.href = base() + "iso-figures.css?v=" + V; l.setAttribute("data-smd-iso", "1");
    D.head.appendChild(l); cssDone = true;
  }
  function load(id) {
    if (FIGS[id]) return Promise.resolve(FIGS[id]);
    if (!/^[a-z0-9-]+$/.test(id)) return Promise.reject(new Error("bad figure id"));
    if (loading[id]) return loading[id];
    loading[id] = new Promise(function (res, rej) {
      var s = D.createElement("script");
      s.src = base() + "iso-fig-" + id + ".js?v=" + V; s.async = true;
      s.onload = function () { if (FIGS[id]) res(FIGS[id]); else { loading[id] = null; rej(new Error(id)); } };
      s.onerror = function () { loading[id] = null; rej(new Error(id)); };
      D.head.appendChild(s);
    });
    return loading[id];
  }

  // opts: { state: {...}, controls: false (the host owns the inputs), hide: ["key", ...] (hide some), theme: "light"|"dark" }
  function slot(id, opts) {
    if (!enabled() || !/^[a-z0-9-]+$/.test(String(id))) return "";
    var o = opts || {};
    return '<div class="smd-iso-slot" data-smd-iso="' + esc(id) + '"' + (o.state ? " data-iso-state='" + esc(JSON.stringify(o.state)) + "'" : "") +
      (o.controls === false ? ' data-iso-controls="0"' : "") + (o.hide && o.hide.length ? ' data-iso-hide="' + esc(o.hide.join(",")) + '"' : "") + (o.theme ? ' data-iso-theme="' + esc(o.theme) + '"' : "") + "></div>";
  }

  function mountAll(root) {
    if (!enabled()) return;
    var list = (root || D).querySelectorAll ? (root || D).querySelectorAll("[data-smd-iso]:not([data-iso-on])") : [];
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }
  function mount(el) {
    if (el.getAttribute("data-iso-on")) return;
    el.setAttribute("data-iso-on", "loading");
    css();
    var id = el.getAttribute("data-smd-iso");
    load(id).then(function (F) { build(el, F); }, function () {
      el.setAttribute("data-iso-on", "failed");
      el.innerHTML = "";
    });
  }

  function control(c, val, fid) {
    var lid = "isoc-" + fid + "-" + c.key;
    if (c.type === "seg") {
      return '<div class="smd-iso-c"><span class="smd-iso-cl" id="' + lid + '">' + esc(c.label) + '</span><span class="smd-iso-seg" role="group" aria-labelledby="' + lid + '">' +
        c.options.map(function (op) {
          return '<button type="button" data-iso-k="' + esc(c.key) + '" data-iso-v="' + esc(op[0]) + '" aria-pressed="' + (String(val) === String(op[0])) + '">' + esc(op[1]) + "</button>";
        }).join("") + "</span></div>";
    }
    var shown = c.show ? c.show(val) : String(val);
    return '<label class="smd-iso-c"><span class="smd-iso-cl"><span>' + esc(c.label) + '</span><output data-iso-out="' + esc(c.key) + '">' + esc(shown) + "</output></span>" +
      '<input type="range" data-iso-k="' + esc(c.key) + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + val + '" aria-valuetext="' + esc(shown) + '"></label>';
  }

  function build(el, F) {
    var R = F.driver, st = {}, k, n = live.length + 1;
    for (k in R.defaults) st[k] = R.defaults[k];
    try { var given = JSON.parse(el.getAttribute("data-iso-state") || "null"); if (given) for (k in given) st[k] = given[k]; } catch (e) {}
    var hide = (el.getAttribute("data-iso-hide") || "").split(",");
    var controls = (R.controls || []).filter(function (c) { return hide.indexOf(c.key) < 0; });
    var ctl = el.getAttribute("data-iso-controls") !== "0" && controls.length;
    var theme = el.getAttribute("data-iso-theme");
    el.innerHTML = '<figure class="smd-iso"' + (theme ? ' data-theme="' + esc(theme) + '"' : "") + ">" +
      '<div class="smd-iso-card"><div class="smd-iso-top" aria-hidden="true"><span>' + esc(F.fig || "Fig") + "</span><span>" + esc(F.title) + "</span></div>" +
      '<div class="smd-iso-stage">' + F.svg + "</div>" +
      '<div class="smd-iso-bot"><span class="smd-iso-hint">' + esc(F.hint || "") + '</span><span class="smd-iso-read" data-iso-read></span></div></div>' +
      (ctl ? '<div class="smd-iso-ctl">' + controls.map(function (c) { return control(c, st[c.key], F.id + n); }).join("") + "</div>" : "") +
      '<figcaption class="smd-iso-cap">' + (F.keys && F.keys.length ? '<span class="smd-iso-keys">' + F.keys.map(function (x) {
        return '<span class="smd-iso-key"><i data-mark="' + esc(x.mark) + '"></i>' + esc(x.label) + "</span>";
      }).join("") + "</span>" : "") + "<span>" + esc(F.caption) + "</span>" +
      '<span class="smd-iso-mark">' + esc(F.review === "ai_drafted" ? "AI draft, awaiting specialist review. A teaching model, not a device manual." : "") + "</span>" +
      (F.sources && F.sources.length ? '<details class="smd-iso-src"><summary>Sources and model</summary><ul>' + F.sources.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
        "</ul>" + (F.model ? "<p>" + esc(F.model) + "</p>" : "") + "</details>" : "") +
      '<span class="smd-iso-say" aria-live="polite" data-iso-say></span></figcaption></figure>';
    el.setAttribute("data-iso-on", "1");
    var svg = el.querySelector("svg"), parts = {}, nodes = svg.querySelectorAll("[data-iso-part]");
    for (var i = 0; i < nodes.length; i++) parts[nodes[i].getAttribute("data-iso-part")] = nodes[i];
    var M = {};
    for (k in (F.morphs || {})) M[k] = F.morphs[k];
    var inst = { el: el, F: F, st: st, parts: parts, last: {}, t: 0, prev: 0, raf: 0, seen: false, id: F.id };
    var api = {
      B: F.basis, data: F.data || {}, along: along, clamp: clamp,
      proj: function (p) { return proj(F.basis, p); },
      path: function (pts, closed) { return pathOf(F.basis, pts, closed); },
      move: function (name, d) {
        var p = parts[name]; if (!p) return;
        var s = shift(F.basis, d), v = "translate(" + (Math.round(s[0] * 100) / 100) + " " + (Math.round(s[1] * 100) / 100) + ")";
        if (inst.last["m" + name] !== v) { p.setAttribute("transform", v); inst.last["m" + name] = v; }
      },
      morph: function (name, f) {
        var p = parts[name], m = M[name]; if (!p || !m) return;
        var q = Math.round(clamp(f, 0, 1) * 400) / 400;
        if (inst.last["f" + name] === q) return;
        inst.last["f" + name] = q; p.innerHTML = morphAt(m, q);
      },
      d: function (name, d) { var p = parts[name]; if (p && inst.last["d" + name] !== d) { p.setAttribute("d", d); inst.last["d" + name] = d; } },
      attr: function (name, a, v) { var p = parts[name]; if (p && inst.last[a + name] !== v) { p.setAttribute(a, v); inst.last[a + name] = v; } },
      show: function (name, on) { api.attr(name, "visibility", on ? "visible" : "hidden"); },
      opacity: function (name, o) { api.attr(name, "opacity", String(Math.round(clamp(o, 0, 1) * 100) / 100)); },
      at: function (name, p) {
        var q = proj(F.basis, p), c = parts[name]; if (!c) return;
        var v = fmt(q[0]) + "," + fmt(q[1]);
        if (inst.last["c" + name] !== v) { c.setAttribute("cx", fmt(q[0])); c.setAttribute("cy", fmt(q[1])); inst.last["c" + name] = v; }
      },
      text: function (name, s) { var p = parts[name]; if (p && p.textContent !== s) p.textContent = s; }
    };
    inst.api = api;
    inst.still = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
    live.push(inst);
    if (ctl) wire(inst);
    paint(inst, 0);
    say(inst);
    if ("IntersectionObserver" in G) {
      new G.IntersectionObserver(function (es) { inst.seen = es[es.length - 1].isIntersecting; run(inst); }, { rootMargin: "80px 0px" }).observe(el);
    } else { inst.seen = true; run(inst); }
  }

  function paint(inst, dt) {
    var R = inst.F.driver, d = R.model(inst.st);
    var text = R.frame(inst.api, inst.st, d, inst.t, dt, !!inst.still) || "";
    var r = inst.el.querySelector("[data-iso-read]");
    if (r && r.textContent !== text) r.textContent = text;
  }
  function say(inst) {
    var R = inst.F.driver, s = inst.el.querySelector("[data-iso-say]");
    if (s && R.say) s.textContent = R.say(R.model(inst.st), inst.st);
  }
  function run(inst) {
    if (inst.raf || !inst.seen || inst.still || !D.body.contains(inst.el)) { if (inst.still) paint(inst, 0); return; }
    inst.prev = 0;
    inst.raf = G.requestAnimationFrame(function tick(now) {
      if (!inst.seen || !D.body.contains(inst.el)) { inst.raf = 0; return; }
      var dt = inst.prev ? Math.min((now - inst.prev) / 1000, 1 / 20) : 1 / 60;
      inst.prev = now; inst.t += dt;
      paint(inst, dt);
      inst.raf = G.requestAnimationFrame(tick);
    });
  }
  function wire(inst) {
    var R = inst.F.driver, box = inst.el.querySelector(".smd-iso-ctl");
    function byKey(k) { for (var i = 0; i < R.controls.length; i++) if (R.controls[i].key === k) return R.controls[i]; return null; }
    box.addEventListener("input", function (e) {
      var k = e.target.getAttribute("data-iso-k"), c = byKey(k); if (!c) return;
      var v = +e.target.value; inst.st[k] = v;
      var shown = c.show ? c.show(v) : String(v), o = box.querySelector('[data-iso-out="' + k + '"]');
      if (o) o.textContent = shown; e.target.setAttribute("aria-valuetext", shown);
      paint(inst, 0);
      say(inst);
    });
    box.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-iso-k]") : null; if (!b) return;
      var k = b.getAttribute("data-iso-k"), c = byKey(k), v = b.getAttribute("data-iso-v"); if (!c) return;
      inst.st[k] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v;
      var bs = box.querySelectorAll('button[data-iso-k="' + k + '"]');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-pressed", String(bs[i] === b));
      paint(inst, 0);
      say(inst);
    });
  }
  // Host-driven state: every mounted instance of id takes the new values (a slot written later carries its own).
  function set(id, state) {
    var k, any = false;
    live.forEach(function (inst) {
      if (inst.id !== id || !D.body.contains(inst.el)) return;
      for (k in state) inst.st[k] = state[k];
      any = true; paint(inst, 0); say(inst);
    });
    return any;
  }
  function sweep() { live = live.filter(function (inst) { return D.body.contains(inst.el); }); }

  function start() {
    if (!enabled() || !D.body) return;
    mountAll(D);
    if ("MutationObserver" in G) {
      var queued = false;
      new G.MutationObserver(function () {
        if (queued) return; queued = true;
        (G.requestAnimationFrame || G.setTimeout)(function () { queued = false; sweep(); mountAll(D); });
      }).observe(D.body, { childList: true, subtree: true });
    }
  }
  G.SMD_ISO = { V: V, enabled: enabled, slot: slot, set: set, load: load, mountAll: mountAll, pure: PURE };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})(typeof window !== "undefined" ? window : this);
