/* vaporizer driver (ES5). Splitting ratio of a variable-bypass vaporizer at 760 mmHg and 20 C (Morgan and
   Mikhail): vapour V = C F / (1 - C); chamber carrier Fc = V (760 - SVP) / SVP; bypass = F - Fc. */
var DRIVER = (function () {
  var AGENTS = {
    sevo: { name: "Sevoflurane", svp: 157, perMl: 182, max: 8 },
    iso: { name: "Isoflurane", svp: 238, perMl: 195, max: 5 }
  };
  var PATM = 760, FLOWS = [0.5, 1, 2, 3, 4, 6, 8, 10];
  function split(agent, pct, fgf) {
    var A = AGENTS[agent], c = Math.max(0, Math.min(A.max, pct)) / 100, V = c * fgf / (1 - c), Fc = V * (PATM - A.svp) / A.svp;
    return { agent: agent, name: A.name, pct: c * 100, fgf: fgf, vapour: V, chamber: Fc, bypass: fgf - Fc, ratio: Fc > 0 ? (fgf - Fc) / Fc : null, liquidMlH: V * 1000 * 60 / A.perMl, max: A.max };
  }
  function model(s) { var ag = s.agent === "iso" ? "iso" : "sevo"; return split(ag, +s.pct, FLOWS[Math.max(0, Math.min(FLOWS.length - 1, Math.round(s.fgfI)))]); }
  function ml(v) { return Math.round(v * 1000) + " mL/min"; }
  function frame(api, s, d, t, dt, still) {
    var g = api.data.dial, a = (-120 + Math.min(d.max, d.pct) * 30) * Math.PI / 180, i, share = d.fgf > 0 ? d.chamber / d.fgf : 0;
    api.d("pointer", api.path([[g[0] + Math.sin(a) * 6, g[1] - Math.cos(a) * 6, g[2]], [g[0] + Math.sin(a) * g[3], g[1] - Math.cos(a) * g[3], g[2]]]));
    api.text("agent", d.name.toUpperCase());
    var speed = 0.18 + 0.05 * Math.log(d.fgf + 1), clock = still ? 0.3 : t * speed;
    for (i = 0; i < 6; i++) { api.show("gi" + i, true); api.at("gi" + i, api.along(api.data.inlet, (clock + i / 6) % 1)); }
    for (i = 0; i < 10; i++) { api.show("gb" + i, true); api.at("gb" + i, api.along(api.data.bypass, (clock * 0.9 + i / 10) % 1)); }
    // chamber parcels: as many as the chamber's share of the flow (at least one while the dial is on), slower, blue after the liquid
    var nc = d.pct > 0 ? Math.max(1, Math.min(6, Math.round(share * 60))) : 0;
    for (i = 0; i < 6; i++) {
      var u = (clock * 0.45 + i / 6) % 1;
      api.show("gc" + i, i < nc);
      if (i < nc) { api.at("gc" + i, api.along(api.data.chamber, u)); api.attr("gc" + i, "data-tone", u > 0.42 ? "blue" : "green"); }
    }
    return d.pct > 0 ? "Chamber " + ml(d.chamber) + " · bypass " + ml(d.bypass) : "Dial at 0: all through the bypass";
  }
  function say(d) {
    if (!(d.pct > 0)) return d.name + " dial at 0: all " + d.fgf + " L/min goes through the bypass.";
    return d.name + " " + d.pct + "% at " + d.fgf + " L/min: " + ml(d.chamber) + " goes through the chamber and " + ml(d.bypass) + " through the bypass, a split of 1 to " +
      Math.round(d.ratio) + "; it uses about " + Math.round(d.liquidMlH * 10) / 10 + " mL of liquid an hour.";
  }
  return {
    defaults: { agent: "sevo", pct: 2, fgfI: 2 },
    controls: [
      { key: "agent", label: "Agent", type: "seg", options: [["sevo", "Sevoflurane"], ["iso", "Isoflurane"]] },
      { key: "pct", label: "Dial", type: "range", min: 0, max: 8, step: 0.5, show: function (v) { return v + "%"; } },
      { key: "fgfI", label: "Fresh gas flow", type: "range", min: 0, max: FLOWS.length - 1, step: 1, show: function (v) { return FLOWS[v] + " L/min"; } }
    ],
    model: model, frame: frame, say: say, split: split, AGENTS: AGENTS
  };
})();
