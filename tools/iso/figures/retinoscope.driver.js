/* retinoscope driver (ES5). Uses window.OPHTHALMOS_RETINO (effective + reflex) when Ophthalmos has loaded it,
   otherwise LOCAL, the same relation for a sphere: F = refraction - lens + working distance in dioptres (67 cm 1.50 D, 50 cm 2.00 D, as Ophthalmos uses); with motion for
   F > 0, against for F < 0, neutral below 0.2 D (test/iso-figures.test.mjs checks the two agree). */
var DRIVER = (function () {
  var NEUTRAL = 0.2, WDS = { 67: 1.5, 50: 2, 100: 1 }; // the working distances Ophthalmos uses (cm: D)
  function LOCAL(rx, lens, wdD) {
    var F = rx - lens + wdD, mag = Math.abs(F);
    return { F: F, mag: mag, motion: mag < NEUTRAL ? "neutral" : F >= 0 ? "with" : "against", bright: 0.3 + 0.7 / (1 + 0.1 * mag * mag), fill: Math.max(0, 1 - mag / 0.6) };
  }
  function model(s) {
    var rx = +s.rx, lens = +s.lens, wd = WDS[s.wd] ? +s.wd : 67, wdD = WDS[wd], R = typeof window !== "undefined" && window.OPHTHALMOS_RETINO, r;
    if (R && R.effective && R.reflex) {
      var F = R.effective({ s: rx, c: 0, ax: 180 }, { s: lens, c: 0, ax: 180 }, wdD), x = R.reflex(F, 90);
      r = { F: F[0], mag: x.mag, motion: x.motion, bright: x.bright, fill: x.fill };
    } else r = LOCAL(rx, lens, wdD);
    r.rx = rx; r.lens = lens; r.wd = wd; r.wdD = wdD; r.gross = rx + wdD;
    return r;
  }
  function sgn(v) { var t = (Math.round(v * 100) / 100).toFixed(2); return (v > 0 ? "+" : v < 0 ? "" : "") + t; }
  function frame(api, s, d, t, dt, still) {
    var sw = still ? 0.6 : Math.sin(t * 1.7), x = sw * 11;
    api.attr("streak", "x", String(Math.round((x - 1) * 10) / 10));
    var band, w, dir = d.motion === "with" ? 1 : -1;
    if (d.motion === "neutral") { band = 0; w = 16; }
    else { var speed = Math.min(3, 1.2 / Math.max(0.25, d.mag)); band = dir * sw * 5.6 * speed; w = 2.2 + 6 * d.fill + 2 / (1 + d.mag); }
    api.attr("reflex", "x", String(Math.round((band - w / 2) * 10) / 10));
    api.attr("reflex", "width", String(Math.round(w * 10) / 10));
    api.opacity("reflex", d.motion === "neutral" ? 0.9 : 0.25 + 0.6 * d.bright);
    var f = api.data.frame, c = api.data.collar, a = c[2] + Math.max(-6, Math.min(6, d.rx)) * 0.09;
    var pt = function (sv, r) { return [f.o[0] + f.a[0] * sv + (f.u[0] * Math.cos(a) + f.v[0] * Math.sin(a)) * r, f.o[1] + f.a[1] * sv + (f.u[1] * Math.cos(a) + f.v[1] * Math.sin(a)) * r, f.o[2] + f.a[2] * sv + (f.u[2] * Math.cos(a) + f.v[2] * Math.sin(a)) * r]; };
    api.d("rxmark", api.path([pt(c[0] - 6, c[1]), pt(c[0] - 1, c[1])]));
    api.text("lens", sgn(d.lens) + " D");
    api.text("wd", "working distance " + d.wd + " cm (" + sgn(d.wdD) + " D)");
    return d.motion === "neutral" ? "Neutral · refraction " + sgn(d.lens - d.wdD) + " D" : (d.motion === "with" ? "With motion · add plus" : "Against motion · add minus");
  }
  function say(d) {
    if (d.motion === "neutral") return "Neutral with a " + sgn(d.lens) + " D lens at " + d.wd + " cm: the refraction is " + sgn(d.lens) + " minus " + sgn(d.wdD) + ", " + sgn(d.lens - d.wdD) + " D.";
    return (d.motion === "with" ? "With motion: add plus. " : "Against motion: add minus. ") + "Neutral would be at a " + sgn(d.gross) + " D lens.";
  }
  return {
    defaults: { rx: 2, lens: 0, wd: 67 },
    controls: [
      { key: "rx", label: "The eye's refraction", type: "range", min: -6, max: 6, step: 0.5, show: function (v) { return sgn(+v) + " D"; } },
      { key: "lens", label: "Trial lens", type: "range", min: -6, max: 8, step: 0.25, show: function (v) { return sgn(+v) + " D"; } },
      { key: "wd", label: "Working distance", type: "seg", options: [["67", "67 cm"], ["50", "50 cm"], ["100", "1 m"]] }
    ],
    model: model, frame: frame, say: say, LOCAL: LOCAL
  };
})();
