/* capno-line driver (ES5). Transit time of a sidestream sampling line: volume / flow, 1.2 mm bore. The screen shows
   the CO2 at the monitor, which is the CO2 at the Y-piece one transit time earlier. */
var DRIVER = (function () {
  var BORE_CM = 0.12, ET = 38, PERIOD = 5, TI = PERIOD / 3;
  function transit(lengthM, flowMlMin) {
    var vol = Math.PI * Math.pow(BORE_CM / 2, 2) * lengthM * 100; // mL
    return { volume: vol, delay: vol / flowMlMin * 60, length: lengthM, flow: flowMlMin };
  }
  function model(s) { var d = transit(+s.len, +s.flow); d.fgf = 1; d.share = d.flow / 1000; return d; }
  // CO2 at the Y-piece at time t: zero while breathing in, a quick rise and a plateau while breathing out.
  function co2(t) {
    var c = ((t % PERIOD) + PERIOD) % PERIOD;
    if (c < TI) return c < 0.25 ? ET * (1 - c / 0.25) * 0.9 : 0;
    var u = c - TI;
    return u < 0.3 ? ET * 0.9 * u / 0.3 : ET * (0.9 + 0.1 * Math.min(1, (u - 0.3) / (PERIOD - TI - 0.3)));
  }
  function frame(api, s, d, t, dt, still) {
    var now = still ? TI + 1.2 + d.delay : t + 8, c = ((now % PERIOD) + PERIOD) % PERIOD, insp = c < TI, i;
    api.morph("lung", insp ? 0.5 - 0.5 * Math.cos(Math.PI * c / TI) : 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (c - TI) / 1.4)));
    // parcels: the gas in the line now left the Y-piece between now - delay and now; red where it carried CO2
    for (i = 0; i < 8; i++) {
      var u = (i + 0.5) / 8, left = now - u * d.delay, on = co2(left) > ET * 0.5;
      api.show("b" + i, on); if (on) api.at("b" + i, api.along(api.data.line, u));
    }
    var pts = "", n = 54, k;
    for (k = 0; k <= n; k++) { var tt = now - 10 + 10 * k / n - d.delay, y = 28 - co2(tt) / 40 * 24; pts += (k ? "L" : "M") + k + " " + (Math.round(y * 10) / 10); }
    api.d("trace", pts);
    api.text("et", ET + " mmHg");
    return "Transit " + (Math.round(d.delay * 10) / 10) + " s · " + d.flow + " mL/min sampled";
  }
  function say(d) {
    return "A " + d.length + " m line holds " + Math.round(d.volume * 10) / 10 + " mL; sampling " + d.flow + " mL/min, the trace runs " + Math.round(d.delay * 10) / 10 +
      " s late. At 1 L/min fresh gas that sampling is " + Math.round(d.share * 100) + "% of the flow unless the monitor returns it.";
  }
  return {
    defaults: { len: 3, flow: 150 },
    controls: [
      { key: "len", label: "Sampling line length", type: "seg", options: [["2", "2 m"], ["3", "3 m"], ["6", "6 m"]] },
      { key: "flow", label: "Sampling flow", type: "seg", options: [["50", "50 mL/min"], ["150", "150 mL/min"], ["200", "200 mL/min"]] }
    ],
    model: model, frame: frame, say: say, transit: transit
  };
})();
