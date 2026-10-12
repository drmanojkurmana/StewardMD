/* circle-system driver (ES5). The numbers are the Narke circuit model's: window.NARKE_MODELS.circuit when Narke has
   loaded it, otherwise LOCAL below, the same equations (test/iso-figures.test.mjs checks the two agree on a grid).
   Motion is illustrative: 12 breaths a minute, I:E 1:2, hand ventilation (the bag empties as the lung fills). */
var DRIVER = (function () {
  var FGF = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];
  var E = { fresh: 1, partial: 0.5, exhausted: 0 };
  var K = 863, VDVT = 0.3, RUNAWAY = 100, RR = 12;
  function r1(x) { return Math.round(x * 10) / 10; }
  function LOCAL(fgf, ve, vco2, absorber) {
    var e = E[absorber], reb = Math.max(0, (ve - fgf) / ve), k = reb * (1 - e);
    var mixed = K * (vco2 / 1000) / ve, alv = K * (vco2 / 1000) / (ve * (1 - VDVT));
    var pi = k >= 1 ? Infinity : k * mixed / (1 - k);
    return { rebreathedFraction: Math.round(reb * 1000) / 1000, inspiredCO2: pi === Infinity ? null : r1(pi),
      endTidalCO2: pi === Infinity ? null : r1(pi + alv), runaway: pi > RUNAWAY };
  }
  function model(s) {
    var fgf = FGF[Math.max(0, Math.min(FGF.length - 1, Math.round(s.fgfI)))], ve = +s.ve, ab = E[s.absorber] == null ? "fresh" : s.absorber;
    var N = typeof window !== "undefined" && window.NARKE_MODELS && window.NARKE_MODELS.circuit;
    var st = N ? N.state({ fgf: fgf, ve: ve, absorber: ab }) : LOCAL(fgf, ve, 200, ab);
    var pi = st.inspiredCO2, pet = st.endTidalCO2;
    return { fgf: fgf, ve: ve, absorber: ab, used: 1 - E[ab], pi: pi, pet: pet, reb: st.rebreathedFraction, runaway: !!st.runaway || pi == null,
      share: st.runaway || pi == null ? 0.85 : pet ? Math.min(0.85, pi / pet) : 0, period: 60 / RR, vt: ve / RR, source: N ? "narke" : "local" };
  }
  function ease(u) { return u < 0 ? 0 : u > 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u); }
  function out(u) { return u <= 0 ? 0 : u >= 1 ? 1 : (1 - Math.exp(-4 * u)) / (1 - Math.exp(-4)); }
  function frame(api, s, d, t, dt, still) {
    var T = d.period, ti = T / 3, ph = still ? ti * 0.7 : t % T, n = Math.floor(t / T), insp = ph < ti;
    var u = insp ? ph / ti : (ph - ti) / (T - ti);
    var fill = insp ? ease(u) : 1 - out(u), amp = Math.max(0.35, Math.min(1, d.vt / 0.8));
    api.morph("lung", 0.08 + 0.92 * fill * amp);
    var refill = insp ? 0 : Math.min(1, u * 1.6);
    api.morph("bag", Math.max(0.1, 0.92 - 0.62 * amp * (insp ? ease(u) : 1 - refill)));
    api.move("ivalve", [0, 0, insp ? 3.4 * Math.sin(Math.PI * Math.min(1, u * 1.2)) : 0]);
    api.move("evalve", [0, 0, !insp && u < 0.75 ? 3.4 * Math.sin(Math.PI * u / 0.75) : 0]);
    api.morph("used", d.used);
    api.show("used", d.used > 0);
    var fm = api.data.fm, lz = (Math.log(d.fgf) - Math.log(0.25)) / (Math.log(10) - Math.log(0.25));
    api.move("bobbin", [0, 0, lz * (fm[1] - fm[0])]);
    var N = 7, gi = 0.5 * (n + (insp ? ease(u) : 1)), ge = 0.5 * (n + (insp ? 0 : out(u))), i, p;
    for (i = 0; i < N; i++) {
      p = (i / N + gi) % 1;
      api.at("gi" + i, api.along(api.data.insp, p)); api.show("gi" + i, true);
      api.attr("gi" + i, "data-tone", (i + 0.5) / N <= d.share ? "red" : "green");
      p = (i / N + ge) % 1;
      api.at("ge" + i, api.along(api.data.exp, p)); api.show("ge" + i, true);
    }
    var spill = !insp && u > 0.55 && !still;
    for (i = 0; i < 3; i++) {
      var w = spill ? ((u - 0.55) / 0.45 + i / 3) % 1 : 0;
      api.at("gs" + i, api.along(api.data.apl, w)); api.show("gs" + i, spill); api.opacity("gs" + i, Math.min(1, d.fgf / d.ve + 0.25) * (1 - w));
    }
    return (insp ? "Inspiration" : "Expiration") + " · " + d.fgf + " L/min · PICO2 " + (d.runaway ? "rising" : d.pi + " mmHg");
  }
  function say(d) {
    return "Fresh gas " + d.fgf + " L/min, minute ventilation " + d.ve + " L/min: " + Math.round(d.reb * 100) + "% of each breath is rebreathed; inspired CO2 " +
      (d.runaway ? "keeps rising" : d.pi + " mmHg, end-tidal " + d.pet + " mmHg") + ".";
  }
  return {
    defaults: { fgfI: 3, ve: 6, absorber: "fresh" },
    controls: [
      { key: "fgfI", label: "Fresh gas flow", type: "range", min: 0, max: FGF.length - 1, step: 1, show: function (v) { return FGF[v] + " L/min"; } },
      { key: "ve", label: "Minute ventilation", type: "range", min: 3, max: 15, step: 0.5, show: function (v) { return v + " L/min"; } },
      { key: "absorber", label: "Absorber", type: "seg", options: [["fresh", "Working"], ["partial", "Half used"], ["exhausted", "Exhausted"]] }
    ],
    model: model, frame: frame, say: say, LOCAL: LOCAL, FGF: FGF
  };
})();
