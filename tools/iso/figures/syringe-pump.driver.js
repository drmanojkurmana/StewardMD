/* syringe-pump driver (ES5). Plunger speed = rate / barrel area; slack in the drive delays the first flow.
   Time lapse: 1 second on screen is 1 hour. A host (Neonatal infusions) passes { rate } in mL/h; the figure then
   shows that rate and never changes it. */
var DRIVER = (function () {
  var RATES = [0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 50];
  function rateOf(s) { var r = +s.rate; return r > 0 && isFinite(r) ? r : RATES[Math.max(0, Math.min(RATES.length - 1, Math.round(s.rateI)))]; }
  function model(s) {
    var size = String(s.size) === "10" || String(s.size) === "20" ? String(s.size) : "50";
    var z = FIG.data.sizes[size], rate = rateOf(s), slack = Math.max(0, +s.slack || 0);
    var mmh = rate * z.mmPerMl;
    return { size: size, ml: z.ml, rate: rate, slack: slack, mmh: mmh, hours: z.ml / rate, delayMin: slack > 0 ? slack / mmh * 60 : 0, mmPerMl: z.mmPerMl };
  }
  function r(n) { return n >= 100 ? String(Math.round(n)) : n >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100); }
  function frame(api, s, d, t, dt, still) {
    var sizes = ["50", "20", "10"], i, z = FIG.data.sizes[d.size];
    for (i = 0; i < 3; i++) {
      var on = sizes[i] === d.size;
      api.show("pl" + sizes[i], on); api.show("liq" + sizes[i], on); api.show("bar" + sizes[i], on); api.show("cl" + sizes[i], on);
    }
    var delayH = d.slack / d.mmh, cycle = delayH + d.hours + 1.2, h = still ? 0 : t % cycle;
    var gap = Math.max(0, d.slack - d.mmh * h), deliv = Math.max(0, Math.min(d.ml, (h - delayH) * d.rate));
    var f = 1 - deliv / d.ml, travel = f * d.ml * d.mmPerMl;
    api.move("pl" + d.size, [travel, 0, 0]);
    api.morph("liq" + d.size, f);
    api.move("push", [z.thumb + travel + gap - FIG.data.pushX, 0, 0]);
    api.show("drop", gap === 0 && deliv < d.ml && (h * d.rate) % 1 < 0.2 && !still);
    api.text("rate", r(d.rate) + " mL/h");
    api.text("size", d.ml + " mL syringe");
    return r(d.mmh) + " mm/h · " + (gap > 0 ? "taking up slack" : deliv >= d.ml ? "empty" : r(deliv) + " of " + d.ml + " mL given");
  }
  function say(d) {
    return d.rate + " mL/h in a " + d.ml + " mL syringe: the plunger moves " + r(d.mmh) + " mm an hour and empties in " + r(d.hours) + " hours." +
      (d.slack > 0 ? " " + d.slack + " mm of slack delays the first flow by about " + r(d.delayMin) + " minutes." : "");
  }
  return {
    defaults: { rateI: 3, size: "50", slack: 0 },
    controls: [
      { key: "rateI", label: "Rate", type: "range", min: 0, max: RATES.length - 1, step: 1, show: function (v) { return RATES[v] + " mL/h"; } },
      { key: "size", label: "Syringe", type: "seg", options: [["50", "50 mL"], ["20", "20 mL"], ["10", "10 mL"]] },
      { key: "slack", label: "Slack in the drive at the start", type: "seg", options: [["0", "None"], ["0.5", "0.5 mm"], ["1", "1 mm"]] }
    ],
    model: model, frame: frame, say: say, RATES: RATES
  };
})();
