/* Tokós digital calipers: measure bpm range and time span on the CTG strip. ES5.
   Positions are viewBox units of the inline trace SVG (layout from tokos/decks/ctg.json), mapped from
   the pointer through getScreenCTM().inverse(), so zoom and pan never change a reading. */
(function (G) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var WORDS = {
    en: { nb: " ", range: "Range", span: "Span", min: "min", s: "s", reduced: "reduced (below 5)", normal: "normal (5 to 25)", increased: "increased (above 25)",
      short: "too short for a deceleration (15\u00a0s or less)", decel: "deceleration length (over 15\u00a0s, up to 3\u00a0min)", prolonged: "prolonged (over 3, up to 5\u00a0min)", over5: "over 5\u00a0min" },
    hi: { nb: "\u00a0", range: "रेंज", span: "अवधि", min: "मिनट", s: "सेकंड", reduced: "कम (5 से कम)", normal: "सामान्य (5 से 25)", increased: "अधिक (25 से ऊपर)",
      short: "डिसेलेरेशन के लिए बहुत छोटा (15\u00a0सेकंड या कम)", decel: "डिसेलेरेशन की अवधि (15\u00a0सेकंड से अधिक, 3\u00a0मिनट तक)", prolonged: "लंबा (3 से अधिक, 5\u00a0मिनट तक)", over5: "5\u00a0मिनट से अधिक" }
  };
  function yForBpm(L, bpm) { return L.yTop + L.hFhr - ((Math.min(Math.max(bpm, L.fhrMin), L.fhrMax) - L.fhrMin) / (L.fhrMax - L.fhrMin)) * L.hFhr; }
  function bpmAt(L, y) { return L.fhrMax - ((y - L.yTop) / L.hFhr) * (L.fhrMax - L.fhrMin); }
  function secAt(L, x) { return ((x - L.padL) / L.plotW) * L.durationSec; }
  function deltaBpm(L, y1, y2) { return Math.round(Math.abs(bpmAt(L, y1) - bpmAt(L, y2))); }
  function deltaSec(L, x1, x2) { return Math.round(Math.abs(secAt(L, x2) - secAt(L, x1))); }
  function readout(L, st, lang) {
    var w = WORDS[lang === "hi" ? "hi" : "en"];
    if (st.mode === "bpm") {
      var d = deltaBpm(L, st.y1, st.y2);
      return w.range + ": " + d + " bpm, " + (d < 5 ? w.reduced : d > 25 ? w.increased : w.normal);
    }
    var s = deltaSec(L, st.x1, st.x2), m = Math.floor(s / 60), r = s % 60;
    // FIGO 2015: a deceleration lasts more than 15 s; prolonged is more than 3 min; more than 5 min is pathological
    var label = s <= 15 ? w.short : s <= 180 ? w.decel : s <= 300 ? w.prolonged : w.over5;
    // number and unit are glued with w.nb (a non-breaking space in Hindi) so "83 सेकंड" never wraps apart
    return w.span + ": " + (m ? m + w.nb + w.min + " " : "") + r + w.nb + w.s + " (" + s + w.nb + w.s + "), " + label;
  }
  function toViewBox(svg, clientX, clientY) {
    var p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function attach(svg, L, onChange) {
    var st = { mode: "bpm", y1: yForBpm(L, 160), y2: yForBpm(L, 110), x1: L.padL + L.plotW * 0.4, x2: L.padL + L.plotW * 0.5 };
    var g = G.document.createElementNS(NS, "g"); g.setAttribute("class", "tk-cal"); svg.appendChild(g);
    function mk() {
      var vis = G.document.createElementNS(NS, "line"), hit = G.document.createElementNS(NS, "line");
      vis.setAttribute("class", "tk-cal-line"); hit.setAttribute("class", "tk-cal-hit");
      g.appendChild(vis); g.appendChild(hit);
      hit.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault(); // the stage must not pan while a caliper moves
        try { hit.setPointerCapture(e.pointerId); } catch (x) {}
        function move(ev) {
          var p = toViewBox(svg, ev.clientX, ev.clientY), f = hit.getAttribute("data-key"); // y1/y2 in bpm mode, x1/x2 in time mode
          if (st.mode === "bpm") st[f] = Math.min(Math.max(p.y, L.yTop), L.yTop + L.hFhr);
          else st[f] = Math.min(Math.max(p.x, L.padL), L.padL + L.plotW);
          draw("drag", f);
        }
        function up() { hit.removeEventListener("pointermove", move); hit.removeEventListener("pointerup", up); hit.removeEventListener("pointercancel", up); }
        hit.addEventListener("pointermove", move); hit.addEventListener("pointerup", up); hit.addEventListener("pointercancel", up);
      });
      return [vis, hit];
    }
    var a = mk(), b = mk();
    function place(pair, v) {
      pair.forEach(function (l) {
        if (st.mode === "bpm") { l.setAttribute("x1", L.padL); l.setAttribute("x2", L.padL + L.plotW); l.setAttribute("y1", v); l.setAttribute("y2", v); }
        else { l.setAttribute("y1", L.yTop); l.setAttribute("y2", L.yTop + L.hFhr); l.setAttribute("x1", v); l.setAttribute("x2", v); }
      });
    }
    // onChange(st, reason, key): reason is "drag" when the learner moved line `key` by pointer
    function draw(reason, key) {
      a[1].setAttribute("data-key", st.mode === "bpm" ? "y1" : "x1"); b[1].setAttribute("data-key", st.mode === "bpm" ? "y2" : "x2");
      place(a, st.mode === "bpm" ? st.y1 : st.x1); place(b, st.mode === "bpm" ? st.y2 : st.x2);
      if (onChange) onChange(st, reason, key);
    }
    draw();
    return {
      setMode: function (m) { st.mode = m === "time" ? "time" : "bpm"; draw(); },
      set: function (k, v) { st[k] = v; draw(); },
      state: function () { return st; },
      readout: function (lang) { return readout(L, st, lang); },
      destroy: function () { if (g.parentNode) g.parentNode.removeChild(g); }
    };
  }
  var API = { WORDS: WORDS, yForBpm: yForBpm, bpmAt: bpmAt, secAt: secAt, deltaBpm: deltaBpm, deltaSec: deltaSec, readout: readout, toViewBox: toViewBox, attach: attach };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_CALIPERS = API;
})(typeof window !== "undefined" ? window : this);
