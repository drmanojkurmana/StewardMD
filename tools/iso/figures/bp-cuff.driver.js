/* bp-cuff driver (ES5). One measurement: pump to 30 above systolic in 2 s, deflate at the chosen rate, beats at the
   heart rate. A beat sounds when the cuff pressure at that beat is at or below systolic and above diastolic; the
   reading is the cuff pressure at the first and the last sounding beat (AHA 2019). Pure model in reading(). */
var DRIVER = (function () {
  var PHASE = 0.37; // where the first beat falls after the let-down starts, as a share of one beat
  function reading(sbp, dbp, hr, rate) {
    var top = Math.ceil((sbp + 30) / 10) * 10, period = 60 / hr, floor = Math.max(0, dbp - 12), beats = [], first = null, last = null, n, t, p;
    var down = (top - floor) / rate;
    for (n = 0; ; n++) {
      t = (PHASE + n) * period; if (t > down) break;
      p = top - rate * t;
      var sound = p <= sbp && p > dbp;
      beats.push({ t: t, p: p, sound: sound, flow: p < sbp });
      if (sound) { if (first == null) first = p; last = p; }
    }
    return { top: top, period: period, down: down, beats: beats, sys: first == null ? null : Math.round(first), dia: last == null ? null : Math.round(last), floor: floor };
  }
  function model(s) {
    var sbp = +s.sbp, dbp = Math.min(+s.dbp, sbp - 10), r = reading(sbp, dbp, +s.hr, +s.rate);
    r.sbp = sbp; r.dbp = dbp; r.hr = +s.hr; r.rate = +s.rate;
    r.inflate = 2; r.dump = 1; r.cycle = r.inflate + r.down + r.dump + 2.5;
    return r;
  }
  function pressure(d, t) {
    if (t < d.inflate) return d.top * t / d.inflate;
    t -= d.inflate;
    if (t < d.down) return d.top - d.rate * t;
    t -= d.down;
    if (t < d.dump) return d.floor * (1 - t / d.dump);
    return 0;
  }
  function frame(api, s, d, t, dt, still) {
    var c = still ? d.inflate + (d.top - (d.sbp + d.dbp) / 2) / d.rate : t % d.cycle, p = pressure(d, c), i;
    var a = (-150 + Math.min(300, p)) * Math.PI / 180, g = api.data.gauge;
    api.d("needle", api.path([[g[0] - Math.sin(a) * 4, g[1] + Math.cos(a) * 4, g[2]], [g[0] + Math.sin(a) * g[3], g[1] - Math.cos(a) * g[3], g[2]]]));
    api.morph("cuff", p / 300);
    api.morph("bulb", c < d.inflate ? 0.5 - 0.5 * Math.cos(c / d.inflate * 4 * 2 * Math.PI) : 0);
    // the latest beat, in or out of the let-down
    var period = d.period, td = c - d.inflate, since, beat = null;
    if (td >= 0 && td < d.down) for (i = d.beats.length - 1; i >= 0; i--) if (d.beats[i].t <= td) { beat = d.beats[i]; break; }
    since = beat ? td - beat.t : (c % period);
    var flow = beat ? beat.flow : p < d.sbp, sound = beat && beat.sound && since < 0.4;
    for (i = 0; i < 3; i++) {
      var w = (since - i * 0.08) / 0.4, on = sound && w > 0 && w < 1;
      api.show("snd" + i, on);
      if (on) { api.attr("snd" + i, "r", String(Math.round((7 + 22 * w) * 10) / 10)); api.opacity("snd" + i, 1 - w); }
      var u = since / 0.45 - i * 0.18;
      api.show("pu" + i, u > 0 && u < 1 && (i === 0 || flow));
      if (u > 0 && u < 1) api.at("pu" + i, api.along(i === 0 ? api.data.prox : api.data.dist, i === 0 ? u : Math.min(1, u * 1.2)));
    }
    if (c >= d.inflate + d.down) return "Read " + (d.sys == null ? "none" : d.sys + "/" + d.dia) + " · set " + d.sbp + "/" + d.dbp;
    return "Cuff " + Math.round(p) + " mmHg" + (c < d.inflate ? " · pumping" : sound ? " · sound" : " · silent");
  }
  function say(d) {
    if (d.sys == null) return "Letting down at " + d.rate + " mmHg a second, no beat fell between systolic and diastolic: no reading.";
    return "Letting down at " + d.rate + " mmHg a second with " + d.hr + " beats a minute, this reads " + d.sys + "/" + d.dia + " against a true " + d.sbp + "/" + d.dbp +
      ": the cuff falls " + Math.round(d.rate * d.period * 10) / 10 + " mmHg between beats.";
  }
  return {
    defaults: { sbp: 120, dbp: 80, hr: 72, rate: 3 },
    controls: [
      { key: "rate", label: "Let-down rate", type: "seg", options: [["2", "2 mmHg/s"], ["3", "3 mmHg/s"], ["5", "5 mmHg/s"], ["10", "10 mmHg/s"]] },
      { key: "hr", label: "Heart rate", type: "range", min: 40, max: 140, step: 2, show: function (v) { return v + " per min"; } },
      { key: "sbp", label: "True systolic", type: "range", min: 90, max: 200, step: 2, show: function (v) { return v + " mmHg"; } },
      { key: "dbp", label: "True diastolic", type: "range", min: 40, max: 120, step: 2, show: function (v) { return v + " mmHg"; } }
    ],
    model: model, frame: frame, say: say, reading: reading
  };
})();
