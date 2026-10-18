/* Hydrocephalus scene: CSF made in the lateral ventricle, flowing through the third and fourth ventricles to the subarachnoid space and the arachnoid villi. */
const layers = { vent: $("vent"), chor: $("choroid"), parts: $("parts"), over: $("over"), panel: $("panel"), brain: $("brainShape"), lat: $("ventLat"), third: $("ventThird"), fourth: $("ventFourth"), block: $("blockMark"), villiFail: $("villiMark"), etvMark: $("etvMark"), shuntTube: $("shuntTube"), abdomen: $("abdomen"), triad: $("triadG"), press: $("pressG") };
const trkMain = track([[230, 155], [280, 180], [318, 205], [330, 240], [340, 278], [375, 318], [410, 340], [480, 330], [560, 260], [585, 180], [560, 110], [505, 72]]);
const trkEtv = track([[330, 252], [372, 282], [410, 318], [428, 338]]);
const trkShunt = track([[268, 158], [380, 92], [620, 78], [760, 118], [798, 220], [805, 318]]);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, mode: 0, ang: 0 }; }); }
const csf = pool(38, () => mk("circle", { class: "sc-p p-csf", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, mode) { p.on = true; p.mode = mode; p.u = 0; p.t = 0; p.k = 0; p.ang = -1.1; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Cerebrospinal fluid";
  [["prod", "Production", "g-fl", "CSF is made continuously by the choroid plexus, mainly in the lateral ventricles."], ["flow", "Flow", "g-fl", "Flow from the lateral ventricles to the third ventricle, through the cerebral aqueduct to the fourth ventricle, then out into the subarachnoid space."], ["abs", "Absorption", "g-good", "CSF is absorbed through arachnoid villi into the venous sinus blood."], ["vent", "Ventricles", "g-bad", "Size of the ventricles. They enlarge when CSF builds up faster than it can leave or be absorbed."], ["pres", "Pressure", "g-bad", "Pressure inside the skull. A fast build up raises it; a slow build up in older adults may leave pressure near normal, as in normal pressure hydrocephalus."], ["sym", "Symptoms", "g-bad", "Effects of the build up: headache, vomiting and blurred vision when pressure rises fast, or the gait, thinking and bladder triad of normal pressure hydrocephalus when it creeps up."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Choroid plexus", 232, 152, 118, 82, "Choroid plexus: a frill of blood vessels in the ventricles that makes cerebrospinal fluid.");
  pill(ox, "Lateral ventricle", 272, 174, 118, 178, "Lateral ventricle: the large CSF space in each cerebral hemisphere. CSF leaves it through a small opening to the third ventricle.");
  pill(ox, "Third ventricle", 330, 238, 150, 282, "Third ventricle: the midline CSF space between the two halves of the diencephalon.");
  pill(ox, "Fourth ventricle", 375, 318, 150, 352, "Fourth ventricle: the CSF space in front of the cerebellum. From here CSF passes out into the subarachnoid space around the brain and cord.");
  pill(ox, "Aqueduct", 348, 282, 478, 282, "Cerebral aqueduct: the narrow channel through the midbrain from the third to the fourth ventricle. It blocks easily, causing obstructive hydrocephalus.");
  pill(ox, "Arachnoid villi", 505, 72, 500, 118, "Arachnoid villi: small tufts of the arachnoid that poke into the venous sinus and let CSF drain into the blood. If they fail, CSF still reaches them but is not absorbed: communicating hydrocephalus.");
  pill(ox, "Venous sinus", 552, 64, 700, 82, "Venous sinus: a channel of venous blood along the top of the brain that receives the absorbed CSF.");
  pill(ox, "Subarachnoid space", 585, 242, 492, 360, "Subarachnoid space: the CSF filled space around the brain under the arachnoid membrane. CSF flows here from the fourth ventricle.");
  const sp = pill(ox, "Shunt", 712, 112, 724, 132, "A shunt is a tube from a ventricle, usually to the abdomen, that drains CSF past any block or failed absorption."); sp.setAttribute("id", "shunt-pill");
  const ep = pill(ox, "ETV stoma", 344, 272, 455, 308, "Endoscopic third ventriculostomy: a small hole made in the floor of the third ventricle so CSF can bypass a blocked aqueduct and reach the subarachnoid space."); ep.setAttribute("id", "etv-pill");
  const pp = pill(ox, "Peritoneum", 805, 338, 805, 428, "Peritoneum: the lining of the abdomen, where a shunt commonly drains CSF so it is absorbed into the blood."); pp.setAttribute("id", "peri-pill");
}
const sm = { prod: 0.7, flow: 0.8, absorb: 0.8, vent: 0.3, downVent: 0.3, pressure: 0.3, symptoms: 0.2, block: 0, villiFail: 0, shunt: 0, etv: 0, triad: 0 };
const acc = { csf: 0 };
function init() {
  for (let i = 0; i < 7; i++) { const c = mk("circle", { class: "hc-chorDot", r: 5 - (i % 3), cx: f1(218 + (i % 4) * 11), cy: f1(146 + Math.floor(i / 4) * 13 + (i % 2) * 4) }, layers.chor); c.setAttribute("opacity", "0.95"); }
  initPanel();
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.prod = lerp(sm.prod, m.prod, k2); sm.flow = lerp(sm.flow, m.flow, k2); sm.absorb = lerp(sm.absorb, m.absorb, k2);
  sm.vent = lerp(sm.vent, m.vent, k2); sm.downVent = lerp(sm.downVent, m.downVent, k2); sm.pressure = lerp(sm.pressure, m.pressure, k1);
  sm.symptoms = lerp(sm.symptoms, m.symptoms, k2); sm.block = lerp(sm.block, m.blockVis, k1); sm.villiFail = lerp(sm.villiFail, m.villiFail, k1);
  sm.shunt = lerp(sm.shunt, m.shunt, k1); sm.etv = lerp(sm.etv, m.etv, k1); sm.triad = lerp(sm.triad, m.triad, k2);
  const sLat = 0.62 + sm.vent * 0.78, sDown = 0.62 + sm.downVent * 0.78;
  layers.lat.setAttribute("transform", "translate(255 165) scale(" + sLat.toFixed(3) + ")");
  layers.third.setAttribute("transform", "translate(330 238) scale(" + sLat.toFixed(3) + ")");
  layers.fourth.setAttribute("transform", "translate(375 318) scale(" + sDown.toFixed(3) + ")");
  layers.brain.setAttribute("rx", f1(258 - 12 * sm.pressure)); layers.brain.setAttribute("ry", f1(154 - 7 * sm.pressure));
  layers.block.setAttribute("opacity", sm.block.toFixed(2)); layers.villiFail.setAttribute("opacity", sm.villiFail.toFixed(2));
  layers.etvMark.setAttribute("opacity", sm.etv.toFixed(2)); layers.shuntTube.setAttribute("opacity", (sm.shunt * 0.95).toFixed(2));
  layers.abdomen.setAttribute("opacity", (0.25 + 0.75 * sm.shunt).toFixed(2));
  layers.triad.setAttribute("opacity", sm.triad.toFixed(2)); layers.press.setAttribute("opacity", (clamp(sm.pressure - 0.35) * (1 - sm.triad)).toFixed(2));
  $("shunt-pill").style.opacity = sm.shunt.toFixed(2); $("etv-pill").style.opacity = sm.etv.toFixed(2); $("peri-pill").style.opacity = sm.shunt.toFixed(2);
  layers.chor.setAttribute("transform", "translate(" + f1(Math.sin(tm / 700) * 1.5) + " " + f1(Math.cos(tm / 900) * 1.2) + ")");
  acc.csf += dt * (2 + sm.prod * 7);
  while (acc.csf >= 1) { acc.csf--; const p = freeP(csf); if (p) { const mode = sm.shunt > 0.45 && Math.random() < 0.55 ? 2 : (sm.etv > 0.45 && sm.block > 0.3 ? 1 : 0); emitP(p, mode); } }
  csf.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    if (p.mode === 2) {
      p.u += dt * 0.16; const q = trkShunt.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { killP(p); return; }
    } else if (p.mode === 1) {
      p.u += dt * 0.14; const q = trkEtv.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { p.mode = 0; p.u = 0.46; p.t = 0; }
    } else if (p.mode === 3) {
      p.ang += dt * 0.22; p.x = 325 + Math.cos(p.ang) * 272; p.y = 230 + Math.sin(p.ang) * 162;
      p.e.setAttribute("opacity", clamp(1.2 - p.t / 3).toFixed(2)); if (p.t > 3.4) { killP(p); return; }
    } else {
      const blocked = sm.block > 0.35 && sm.etv < 0.35;
      p.u += dt * 0.075 * (0.35 + sm.flow);
      if (blocked && p.u > 0.31) { p.u = 0.31; if (!p.k) { p.k = 1; p.t = 0; } if (p.t > 1.8) { killP(p); return; } }
      const q = trkMain.at(p.u); p.x = q.x; p.y = q.y;
      if (p.u >= 1) { if (Math.random() < sm.absorb) { killP(p); return; } p.mode = 3; p.t = 0; p.ang = -1.2; }
    }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  gg.prod.set(sm.prod, wordOf(sm.prod, 0.4, 0.7, ["low", "steady", "steady"]));
  gg.flow.set(sm.flow, wordOf(sm.flow, 0.3, 0.65, ["blocked", "slow", "flowing"]));
  gg.abs.set(sm.absorb, wordOf(sm.absorb, 0.3, 0.65, ["poor", "reduced", "good"]));
  gg.vent.set(sm.vent, wordOf(sm.vent, 0.3, 0.65, ["normal", "enlarged", "gross"]));
  gg.pres.set(sm.pressure, wordOf(sm.pressure, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.sym.set(sm.symptoms, wordOf(sm.symptoms, 0.3, 0.6, ["none", "some", "marked"]));
}
run({ init, step });
