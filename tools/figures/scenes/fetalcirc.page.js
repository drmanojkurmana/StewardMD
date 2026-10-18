/* Fetal circulation scene: placental, foramen, lung, ductus and systemic blood streams, closing shunts and gauges. */
const Lyr = { flow: $("flow"), over: $("over"), panel: $("panel") };
function mixc(s) { const a = [91, 141, 217], b = [229, 72, 77], t = clamp(s); return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")"; }
/* ---- particle routes ---- */
const ROUTES = [
  { pts: [[195, 350], [285, 335], [360, 325], [430, 300], [500, 275], [535, 248]], flowKey: "umbil", n: 6, kind: "umb" },
  { pts: [[533, 233], [492, 233], [440, 233]], flowKey: "foramen", n: 5, kind: "foram" },
  { pts: [[533, 315], [560, 240], [585, 140], [430, 115], [390, 135], [425, 180], [440, 208]], flowKey: "lung", n: 8, kind: "lung" },
  { pts: [[570, 175], [585, 140], [560, 105], [525, 72], [620, 70], [690, 70], [690, 220]], flowKey: "duct", n: 6, kind: "duct" },
  { pts: [[405, 325], [368, 290], [365, 165], [365, 70], [690, 70], [690, 360], [740, 372]], flowKey: "satArt", n: 8, kind: "aorta" },
  { pts: [[720, 398], [580, 418], [540, 360], [535, 332]], flowKey: "bodyRet", n: 5, kind: "ret" },
  { pts: [[665, 390], [450, 425], [230, 400], [192, 386]], flowKey: "umbil", n: 4, kind: "umbArt" },
];
ROUTES.forEach((r) => { r.tr = track(r.pts); });
const dots = [];
ROUTES.forEach((r, ri) => { for (let i = 0; i < r.n; i++) { const e = mk("circle", { class: "p-blood", r: 3.1 }, Lyr.flow); dots.push({ e, ri, u: (i + 0.5) / r.n, sp: rnd(0.85, 1.15) }); } });
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = Lyr.panel, y0 = 478, h = 52, xs = [100, 270, 440, 610, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The baby";
  [["lung", "Lung flow", "g-lung", "How much blood flows through the lungs. It is low before birth because lung resistance is high, and rises steeply when the lungs expand."],
   ["resist", "Lung resist.", "g-bad", "Resistance in the unexpanded fetal lungs. It is high before birth and falls with the first breaths, letting blood into the lungs."],
   ["duct", "Ductus open", "g-duct", "How open the ductus arteriosus is. It carries right ventricular blood past the lungs before birth and normally closes after birth. Prostaglandin keeps it open; indomethacin promotes closure."],
   ["foram", "Foramen open", "g-foram", "How open the foramen ovale is. It lets umbilical blood cross from right to left atrium before birth and is pressed shut when left atrial pressure rises."],
   ["sat", "Saturation", "g-sat", "Oxygen saturation of blood reaching the body. It is mixed before birth because of the fetal shunts and becomes normal once the lungs take over."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = Lyr.over;
  pill(ox, "Aorta", 365, 110, 165, 105, "Aorta: carries blood from the left ventricle to the body. Before birth it is filled mainly through the foramen ovale stream and the ductus.");
  pill(ox, "Ductus arteriosus", 555, 102, 760, 62, "Ductus arteriosus: a channel from the pulmonary artery to the aorta. Before birth it bypasses the high resistance lungs; after birth it constricts and closes. Prostaglandin keeps it open and indomethacin promotes closure.");
  pill(ox, "Lungs", 595, 108, 760, 102, "Lungs: collapsed with high resistance before birth, so they receive little blood. At the first breath they expand, resistance falls and flow rises.");
  pill(ox, "Foramen ovale", 486, 231, 235, 200, "Foramen ovale: a flap opening between the atria. It lets oxygen rich umbilical blood cross to the left heart before birth and is pressed shut when left atrial pressure rises after birth.");
  pill(ox, "Ductus venosus", 395, 312, 300, 385, "Ductus venosus: a channel past the liver carrying umbilical vein blood into the inferior vena cava toward the right atrium. It closes after birth.");
  pill(ox, "Umbilical vein", 245, 338, 255, 288, "Umbilical vein: carries oxygen rich blood from the placenta toward the liver, ductus venosus and right atrium. It constricts when placental flow ends at birth.");
  pill(ox, "Placenta", 145, 340, 130, 298, "Placenta: the source of oxygen rich blood before birth. It receives oxygen poor blood back through the umbilical arteries.");
  pill(ox, "Body", 720, 378, 755, 330, "Body tissues: receive aortic blood and return oxygen poor blood to the right atrium. Colour follows arterial saturation.");
}
const sm = { lung: 0.16, resist: 0.92, duct: 0.92, foramen: 0.9, umbil: 0.95, dv: 0.9, satArt: 0.66, satRA: 0.7, satLA: 0.7, satPA: 0.3, rvLoad: 0.8 };
const chEls = {};
function init() {
  initPanel();
  ["LA", "RA", "LV", "RV"].forEach((c) => { chEls[c] = $("ch" + c); });
  chEls.body = $("bodyRect"); chEls.plac = $("plac"); chEls.lungL = $("lungL"); chEls.lungR = $("lungR");
}
function satWord(s) { return s > 0.82 ? "oxygen rich" : s > 0.55 ? "mixed" : "oxygen poor"; }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["lung", "resist", "duct", "foramen", "umbil", "dv", "satArt", "satRA", "satLA", "satPA", "rvLoad"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* chamber, body and node colours */
  chEls.LA.style.fill = mixc(sm.satLA); chEls.LV.style.fill = mixc(sm.satArt);
  chEls.RA.style.fill = mixc(sm.satRA); chEls.RV.style.fill = mixc(sm.satRA);
  chEls.RV.style.strokeWidth = (1 + 2.5 * sm.rvLoad).toFixed(2);
  chEls.body.style.fill = mixc(clamp(0.15 + 0.75 * sm.satArt));
  chEls.plac.style.opacity = (0.3 + 0.7 * sm.umbil).toFixed(2);
  const lsc = (0.8 + 0.32 * sm.lung).toFixed(3);
  [chEls.lungL, chEls.lungR].forEach((e) => { const cx = +e.getAttribute("cx"), cy = +e.getAttribute("cy"); e.setAttribute("transform", "translate(" + f1(cx) + " " + f1(cy) + ") scale(" + lsc + ") translate(" + f1(-cx) + " " + f1(-cy) + ")"); e.style.opacity = (0.5 + 0.5 * sm.lung).toFixed(2); });
  /* vessels and shunts */
  const vU = $("vUmb"), vD = $("vDV"), vP = $("vPA"), vDuct = $("vDuct"), vAo = $("vAo"), vArt = $("vUmbArt");
  if (vU) { vU.style.opacity = (0.15 + 0.85 * sm.umbil).toFixed(2); vU.setAttribute("stroke-width", f1(3 + 5 * sm.umbil)); }
  if (vD) { vD.style.opacity = (0.12 + 0.88 * sm.dv).toFixed(2); vD.setAttribute("stroke-width", f1(3 + 5 * sm.dv)); vD.style.stroke = mixc(0.9); }
  if (vP) { vP.setAttribute("stroke-width", f1(4 + 6 * sm.lung)); vP.style.stroke = mixc(sm.satPA); }
  const vPb = $("vPAb"); if (vPb) { vPb.setAttribute("stroke-width", f1(4 + 5 * sm.lung)); vPb.style.stroke = mixc(sm.satPA); }
  const vPv = $("vPV"); if (vPv) { vPv.style.opacity = (0.25 + 0.75 * sm.lung).toFixed(2); vPv.style.stroke = mixc(sm.satLA); }
  if (vAo) { vAo.style.stroke = mixc(sm.satArt); }
  if (vArt) { vArt.style.opacity = (0.15 + 0.85 * sm.umbil).toFixed(2); }
  const vVein = $("vVein"); if (vVein) vVein.style.stroke = mixc(0.1);
  if (vDuct) { vDuct.style.opacity = (0.1 + 0.9 * sm.duct).toFixed(2); vDuct.setAttribute("stroke-width", f1(2.5 + 5 * sm.duct)); }
  const fo = $("defFO"); if (fo) fo.style.opacity = sm.foramen.toFixed(2);
  $("satLA").textContent = satWord(sm.satLA); $("satLV").textContent = satWord(sm.satArt);
  $("satRA").textContent = satWord(sm.satRA); $("satRV").textContent = satWord(sm.satRA);
  /* bloodstream particles */
  dots.forEach((p) => {
    const r = ROUTES[p.ri];
    const fl = r.flowKey === "umbil" ? sm.umbil : r.flowKey === "foramen" ? sm.foramen : r.flowKey === "lung" ? sm.lung : r.flowKey === "duct" ? sm.duct * (0.35 + 0.65 * sm.resist + 0.3) : r.flowKey === "satArt" ? 0.85 : 0.7;
    p.u = (p.u + dt * (0.05 + 0.16 * fl) * p.sp) % 1;
    const q = r.tr.at(p.u);
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y));
    let sat = 0.3;
    if (r.kind === "umb" || r.kind === "foram") sat = 0.9;
    else if (r.kind === "lung") sat = p.u < 0.45 ? sm.satPA : sm.satLA;
    else if (r.kind === "duct") sat = 0.22;
    else if (r.kind === "aorta") sat = sm.satArt;
    else sat = 0.1;
    p.e.style.fill = mixc(sat);
    const vis = r.kind === "umb" || r.kind === "umbArt" ? sm.umbil : r.kind === "foram" ? sm.foramen : r.kind === "lung" ? (0.15 + 0.85 * sm.lung) : r.kind === "duct" ? sm.duct : 0.9;
    p.e.setAttribute("opacity", clamp(vis * 1.3).toFixed(2));
  });
  /* gauges */
  gg.lung.set(sm.lung, wordOf(sm.lung, 0.35, 0.7, ["low", "rising", "high"]));
  gg.resist.set(sm.resist, wordOf(sm.resist, 0.35, 0.7, ["low", "falling", "high"]));
  gg.duct.set(sm.duct, wordOf(sm.duct, 0.25, 0.65, ["closed", "closing", "open"]));
  gg.foram.set(sm.foramen, wordOf(sm.foramen, 0.25, 0.65, ["closed", "closing", "open"]));
  gg.sat.set(sm.satArt, wordOf(sm.satArt, 0.75, 0.9, ["mixed", "improving", "normal"]));
}
run({ init, step });
