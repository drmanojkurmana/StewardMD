/* chest-drain driver (ES5). Pressures in cmH2O relative to the room. The seal bottle's air space is at 0 off
   suction and -20 on suction (the vent tube's depth). Quiet breathing: drain pressure -4 at the end of expiration and
   -10 at the end of inspiration; on suction the swing is shown damped to a third (illustrative). A small air leak
   lifts expiration above the 2 cm seal (bubbles on expiration); a large leak keeps it above in both phases. */
var DRIVER = (function () {
  var SEAL = 2, SUCTION = 20, PERIOD = 4, TI = 1.5;
  function phases(leak, suction) {
    var pb = suction ? -SUCTION : 0, damp = suction ? 1 / 3 : 1, exp, insp;
    if (leak === "large") { exp = pb + 3; insp = pb + 2.4; }
    else if (leak === "small") { exp = pb + 2.6; insp = pb - 6 * damp; }
    else { exp = pb - 4 * damp; insp = pb - 10 * damp; }
    function at(p) { return { p: p, column: Math.max(-SEAL, Math.min(12, pb - p)), bubbles: p - pb > SEAL }; }
    return { pb: pb, exp: at(exp), insp: at(insp), suctionBubbles: !!suction };
  }
  function model(s) {
    var leak = s.leak === "small" || s.leak === "large" ? s.leak : "none", suction = String(s.suction) === "1";
    var ph = phases(leak, suction);
    ph.leak = leak; ph.suction = suction;
    ph.swing = Math.round(Math.abs(ph.insp.column - ph.exp.column) * 10) / 10;
    ph.when = ph.exp.bubbles && ph.insp.bubbles ? "all the time" : ph.exp.bubbles ? "on expiration" : "none";
    return ph;
  }
  function ease(u) { return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u))); }
  function frame(api, s, d, t, dt, still) {
    var c = still ? TI : t % PERIOD, insp = c < TI, w = insp ? ease(c / TI) : 1 - ease((c - TI) / (PERIOD - TI) * 1.6);
    var col = d.exp.column + (d.insp.column - d.exp.column) * w, U = api.data.U, se = api.data.seal, su = api.data.suct, i;
    var zc = se[3] + col * U;
    api.morph("col", (zc - se[2]) / (api.data.zmax - se[2]));
    var bubbling = !still && (insp ? d.insp.bubbles : d.exp.bubbles);
    for (i = 0; i < 5; i++) {
      var u = (t * 1.3 + i / 5) % 1;
      api.show("bs" + i, bubbling);
      if (bubbling) api.at("bs" + i, [se[0] + Math.sin(i * 2.1) * 2.5, 0, se[2] + u * (se[3] - se[2])]);
      api.show("bv" + i, d.suctionBubbles && !still);
      if (d.suctionBubbles) api.at("bv" + i, [su[0] + Math.sin(i * 1.7) * 2, 0, su[2] + ((t * 0.8 + i / 5) % 1) * (su[3] - su[2])]);
    }
    for (i = 0; i < 3; i++) { var f = (t * 0.12 + i / 3) % 1; api.show("fl" + i, !still); api.at("fl" + i, api.along(api.data.line, f)); }
    var p = d.exp.p + (d.insp.p - d.exp.p) * w;
    return (insp ? "In" : "Out") + " · drain " + (Math.round(p * 10) / 10) + " cmH2O · " + (bubbling ? "bubbling" : "no bubbles");
  }
  function say(d) {
    return "Swing " + d.swing + " cmH2O; bubbling in the water seal: " + d.when + (d.suction ? "; suction set at 20 cmH2O by the vent tube, bubbling gently" : "") + ".";
  }
  return {
    defaults: { leak: "none", suction: "0" },
    controls: [
      { key: "leak", label: "Air leak from the lung", type: "seg", options: [["none", "None"], ["small", "Small"], ["large", "Large"]] },
      { key: "suction", label: "Suction", type: "seg", options: [["0", "Off"], ["1", "On, 20 cmH2O"]] }
    ],
    model: model, frame: frame, say: say, phases: phases
  };
})();
