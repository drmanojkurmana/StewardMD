/* Fetal circulation scene: placenta to lungs story, organ hearts and lungs, drug action on the ductus, closing shunts and gauges. */
const LY = { flow: $("flow"), marks: $("marks"), over: $("over"), panel: $("panel") };
function mixc(s) { const a = [91, 141, 217], b = [229, 72, 77], t = clamp(s); return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")"; }
function capText(d, l) {
  if (d === 1) return ["Prostaglandin holds the duct open. Blood keeps skipping the lungs.", "Prostaglandin holds the duct open. Less blood reaches the open lungs.", "Prostaglandin holds the duct open. Used blood bypasses the lungs again."][l];
  if (d === 2) return ["Indomethacin clamps the duct. Before birth this strains the right heart.", "Indomethacin clamps the duct shut. More blood reaches the lungs.", "Indomethacin keeps the duct shut. Full flow goes through the lungs."][l];
  return ["No treatment. Before birth most blood skips the lungs through shortcuts.", "No treatment. The first breath fills the lungs and the shortcuts start to shut.", "No treatment. The shortcuts are shut and all blood visits the lungs."][l];
}
/* ---- organs, vessels and routes ---- */
let livO = null, heaO = null, lunL = null, lunR = null;
let ductTr = null, ductMid = [530, 125], ductN = [1, 0], foMid = [490, 260];
function line(pts) { return "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"); }
function initOrgans() {
  livO = organ($("liverSlot"), "liver", 330, 338, 120, { cls: "hot" });
  livO.g.setAttribute("tabindex", "0");
  livO.g.setAttribute("data-info", "Liver and ductus venosus: most cord blood skips past the liver through a shortcut to the heart.");
  heaO = organ($("heartSlot"), "heart", 490, 275, 150, { cls: "hot" });
  heaO.g.setAttribute("tabindex", "0");
  heaO.g.setAttribute("data-info", "Heart: before birth the right side sends most blood through the duct while rich blood crosses to the left.");
  lunL = organ($("lungSlot"), "lung", 355, 118, 75, { cls: "hot" });
  lunL.g.setAttribute("tabindex", "0");
  lunL.g.setAttribute("data-info", "Lungs: closed and stiff before birth, so little blood enters. The first breath opens them and flow rises.");
  lunR = organ($("lungSlot"), "lung", 612, 118, 75, { cls: "hot" });
  lunR.g.setAttribute("tabindex", "0");
  lunR.g.setAttribute("data-info", "Lungs: closed and stiff before birth, so little blood enters. The first breath opens them and flow rises.");
  const livP = livO.ports.porta, livOut = livO.ports.out;
  const hIn = heaO.ports.in, hIVC = heaO.ports.ivc, hPu = heaO.ports.pulm, hAo = heaO.ports.aorta;
  const hilL = lunL.ports.in, hilR = lunR.ports.in;
  foMid = [heaO.x, heaO.y - 15];
  const foR = [foMid[0] + 32, foMid[1]], foL = [foMid[0] - 32, foMid[1]];
  const P = {
    umb: [[213, 362], [265, 358], livP],
    dv: [livOut, [380, 318], [425, 345], hIVC],
    pa: [hPu, [430, 150], hilL],
    pab: [hPu, [560, 160], hilR],
    pv: [hilL, [400, 150], hIn],
    pvb: [hilR, [560, 150], hIn],
    ao: [hAo, [505, 110], [515, 80], [530, 59], [600, 58], [690, 58], [690, 160], [690, 300], [690, 360], [715, 372]],
    duct: [hPu, [528, 150], [536, 108], [542, 59]],
    fo: [foR, foL],
    ret: [[700, 398], [600, 415], [520, 395], hIVC],
    umbArt: [[720, 398], [560, 408], [400, 410], [280, 402], [205, 388]],
    lung: [hPu, [430, 150], hilL, [400, 150], hIn],
  };
  const ids = { umb: "vUmb", dv: "vDV", pa: "vPA", pab: "vPAb", pv: "vPV", pvb: "vPVb", ao: "vAo", duct: "vDuct", fo: "vFO", ret: "vRet", umbArt: "vUmbArt" };
  const TR = { lung: track(P.lung) };
  Object.keys(ids).forEach((k) => { $(ids[k]).setAttribute("d", line(P[k])); TR[k] = track(P[k]); });
  LY.marks.appendChild($("vFO"));
  ductTr = track(P.duct);
  const dm = ductTr.at(0.5);
  ductMid = [dm.x, dm.y];
  const ar = dm.a * Math.PI / 180;
  ductN = [-Math.sin(ar), Math.cos(ar)];
  return TR;
}
/* ---- bloodstream particles ---- */
let RTS = [], dots = [];
function initDots(TR) {
  const defs = [
    ["umb", 6], ["dv", 5], ["fo", 5], ["lung", 7], ["pab", 4], ["duct", 6], ["ao", 8], ["ret", 4], ["umbArt", 4],
  ];
  defs.forEach(([k, n]) => {
    const r = { k, tr: TR[k] };
    RTS.push(r);
    for (let i = 0; i < n; i++) { const e = mk("circle", { class: "p-blood", r: 3.1 }, LY.flow); dots.push({ e, r, u: (i + 0.5) / n, sp: rnd(0.85, 1.15) }); }
  });
}
/* ---- drug action art on the ductus ---- */
let indoGlow = null, pgeGlow = null, clampEl = null, strainEl = null, lungHaloL = null, lungHaloR = null;
let indoDots = [], pgeDots = [];
function initMarks() {
  indoGlow = mk("ellipse", { class: "fc-glow-i", cx: f1(ductMid[0]), cy: f1(ductMid[1]), rx: 95, ry: 60, opacity: "0" }, LY.marks);
  pgeGlow = mk("ellipse", { class: "fc-glow-p", cx: f1(ductMid[0]), cy: f1(ductMid[1]), rx: 95, ry: 60, opacity: "0" }, LY.marks);
  strainEl = mk("ellipse", { class: "fc-strain", cx: f1(heaO.x), cy: f1(heaO.y), rx: 72, ry: 60, opacity: "0" }, LY.marks);
  lungHaloL = mk("ellipse", { class: "fc-lunghalo", cx: f1(lunL.x), cy: f1(lunL.y), rx: 52, ry: 58, opacity: "0" }, LY.marks);
  lungHaloR = mk("ellipse", { class: "fc-lunghalo", cx: f1(lunR.x), cy: f1(lunR.y), rx: 52, ry: 58, opacity: "0" }, LY.marks);
  const c0 = [ductMid[0] - ductN[0] * 11, ductMid[1] - ductN[1] * 11], c1 = [ductMid[0] + ductN[0] * 11, ductMid[1] + ductN[1] * 11];
  clampEl = mk("path", { class: "fc-clamp", d: "M" + f1(c0[0]) + " " + f1(c0[1]) + "L" + f1(c1[0]) + " " + f1(c1[1]), opacity: "0" }, LY.marks);
  for (let i = 0; i < 6; i++) {
    const u = 0.2 + 0.12 * i, q = ductTr.at(u);
    const ix = q.x + ductN[0] * 9, iy = q.y + ductN[1] * 9, px = q.x - ductN[0] * 9, py = q.y - ductN[1] * 9;
    const a = mk("circle", { class: "sc-p p-indo", r: 4.5, opacity: "0" }, LY.marks);
    place(a, ix, iy, 0, 1); indoDots.push(a);
    const b = mk("circle", { class: "sc-p p-pge", r: 4.5, opacity: "0" }, LY.marks);
    place(b, px, py, 0, 1); pgeDots.push(b);
  }
}
/* ---- labels and gauges ---- */
const gg = {};
let capEl = null, capKey = "";
function initPanel() {
  const P = LY.panel, y0 = 478, h = 52, xs = [100, 270, 440, 610, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The baby";
  [["lung", "Lung flow", "g-lung", "How much blood flows through the lungs. It is low before birth because lung resistance is high, and rises steeply when the lungs expand."],
   ["resist", "Lung resist.", "g-bad", "Resistance in the unexpanded fetal lungs. It is high before birth and falls with the first breaths, letting blood into the lungs."],
   ["duct", "Ductus open", "g-duct", "How open the ductus arteriosus is. It carries right ventricular blood past the lungs before birth and normally closes after birth. Prostaglandin keeps it open; indomethacin promotes closure."],
   ["foram", "Foramen open", "g-foram", "How open the foramen ovale is. It lets umbilical blood cross from right to left atrium before birth and is pressed shut when left atrial pressure rises."],
   ["sat", "Saturation", "g-sat", "Oxygen saturation of blood reaching the body. It is mixed before birth because of the fetal shunts and becomes normal once the lungs take over."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = LY.over;
  pill(ox, "Lungs", lunL.ports.in[0], lunL.ports.in[1], 400, 64, "Lungs: closed and stiff before birth, so little blood enters. The first breath opens them and flow rises.");
  pill(ox, "Ductus", ductMid[0], ductMid[1], 440, 95, "Ductus: a shortcut from the lung artery to the aorta. Prostaglandin holds it open. Indomethacin clamps it shut.");
  pill(ox, "Aorta", 690, 160, 810, 150, "Aorta: carries blood to the body. Before birth it fills through the foramen stream and the duct.");
  pill(ox, "Foramen", foMid[0], foMid[1], 488, 150, "Foramen: a flap door between the upper chambers. Rich blood crosses to the left before birth, then it presses shut.");
  pill(ox, "Heart", 475, 350, 540, 394, "Heart: before birth the right side sends most blood through the duct while rich blood crosses to the left.");
  pill(ox, "Placenta", 145, 345, 145, 394, "Placenta: gives oxygen rich blood through the cord vein and takes used blood back.");
  pill(ox, "Liver", 305, 350, 335, 394, "Liver and ductus venosus: most cord blood skips past the liver through a shortcut to the heart.");
  pill(ox, "Body", 715, 379, 755, 394, "Body: uses oxygen from aorta blood and sends used blood back to the heart and placenta.");
  capEl = mk("text", { class: "fc-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { lung: 0.62, resist: 0.48, duct: 0.58, foramen: 0.32, umbil: 0.3, dv: 0.35, satArt: 0.84, satRA: 0.5, satLA: 0.88, satPA: 0.34, rvLoad: 0.6, pge: 0, indo: 0 };
function init() {
  const TR = initOrgans();
  initDots(TR);
  initMarks();
  initPanel();
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["lung", "resist", "duct", "foramen", "umbil", "dv", "satArt", "satRA", "satLA", "satPA", "rvLoad"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.pge = lerp(sm.pge, drug === 1 ? 1 : 0, k1);
  sm.indo = lerp(sm.indo, drug === 2 ? 1 : 0, k1);
  /* vessels follow physiology */
  const vU = $("vUmb"), vD = $("vDV"), vP = $("vPA"), vDuct = $("vDuct"), vAo = $("vAo");
  if (vU) { vU.style.opacity = (0.15 + 0.85 * sm.umbil).toFixed(2); vU.setAttribute("stroke-width", f1(3 + 5 * sm.umbil)); }
  if (vD) { vD.style.opacity = (0.12 + 0.88 * sm.dv).toFixed(2); vD.setAttribute("stroke-width", f1(3 + 5 * sm.dv)); vD.style.stroke = mixc(0.9); }
  if (vP) { vP.setAttribute("stroke-width", f1(4 + 6 * sm.lung)); vP.style.stroke = mixc(sm.satPA); }
  const vPb = $("vPAb"); if (vPb) { vPb.setAttribute("stroke-width", f1(4 + 5 * sm.lung)); vPb.style.stroke = mixc(sm.satPA); }
  const vPv = $("vPV"); if (vPv) { vPv.style.opacity = (0.25 + 0.75 * sm.lung).toFixed(2); vPv.style.stroke = mixc(sm.satLA); }
  const vPv2 = $("vPVb"); if (vPv2) { vPv2.style.opacity = (0.25 + 0.75 * sm.lung).toFixed(2); vPv2.style.stroke = mixc(sm.satLA); }
  if (vAo) { vAo.style.stroke = mixc(sm.satArt); }
  const vArt = $("vUmbArt"); if (vArt) { vArt.style.opacity = (0.15 + 0.85 * sm.umbil).toFixed(2); }
  const vVein = $("vRet"); if (vVein) vVein.style.stroke = mixc(0.1);
  if (vDuct) { vDuct.style.opacity = (0.1 + 0.9 * sm.duct).toFixed(2); vDuct.setAttribute("stroke-width", f1(2.5 + 5 * sm.duct)); }
  const fo = $("vFO"); if (fo) fo.style.opacity = sm.foramen.toFixed(2);
  $("plac").style.opacity = (0.3 + 0.7 * sm.umbil).toFixed(2);
  $("bodyRect").style.fill = mixc(clamp(0.15 + 0.75 * sm.satArt));
  /* drug action on the ductus: blockers sit on the wall, the channel clamps or is held open */
  const pulse = 0.5 + 0.5 * Math.sin(tm / 480);
  indoGlow.setAttribute("opacity", (sm.indo * (0.3 + 0.08 * pulse)).toFixed(2));
  pgeGlow.setAttribute("opacity", (sm.pge * (0.3 + 0.08 * pulse)).toFixed(2));
  clampEl.setAttribute("opacity", sm.indo.toFixed(2));
  strainEl.setAttribute("opacity", (clamp(sm.rvLoad - 0.55, 0, 1) * 0.5).toFixed(2));
  const lh = (0.08 + 0.42 * sm.lung).toFixed(2);
  lungHaloL.setAttribute("opacity", lh); lungHaloR.setAttribute("opacity", lh);
  indoDots.forEach((e, i) => { e.setAttribute("opacity", sm.indo.toFixed(2)); });
  pgeDots.forEach((e, i) => { e.setAttribute("opacity", sm.pge.toFixed(2)); });
  /* bloodstream particles */
  dots.forEach((p) => {
    const k = p.r.k;
    const fl = k === "umb" || k === "umbArt" ? sm.umbil : k === "dv" ? sm.dv : k === "fo" ? sm.foramen : k === "lung" || k === "pab" ? sm.lung : k === "duct" ? sm.duct * (0.35 + 0.65 * sm.resist + 0.3) : k === "ao" ? 0.85 : 0.7;
    p.u = (p.u + dt * (0.05 + 0.16 * fl) * p.sp) % 1;
    const q = p.r.tr.at(p.u);
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y));
    let sat = 0.3;
    if (k === "umb" || k === "dv" || k === "fo") sat = 0.9;
    else if (k === "lung") sat = p.u < 0.5 ? sm.satPA : sm.satLA;
    else if (k === "pab") sat = sm.satPA;
    else if (k === "duct") sat = 0.22;
    else if (k === "ao") sat = sm.satArt;
    else sat = 0.1;
    p.e.style.fill = mixc(sat);
    const vis = k === "umb" || k === "umbArt" ? sm.umbil : k === "dv" ? sm.dv : k === "fo" ? sm.foramen : k === "lung" || k === "pab" ? (0.15 + 0.85 * sm.lung) : k === "duct" ? sm.duct : 0.9;
    p.e.setAttribute("opacity", clamp(vis * 1.3).toFixed(2));
  });
  /* gauges */
  gg.lung.set(sm.lung, wordOf(sm.lung, 0.35, 0.7, ["low", "rising", "high"]));
  gg.resist.set(sm.resist, wordOf(sm.resist, 0.35, 0.7, ["low", "falling", "high"]));
  gg.duct.set(sm.duct, wordOf(sm.duct, 0.25, 0.65, ["closed", "closing", "open"]));
  gg.foram.set(sm.foramen, wordOf(sm.foramen, 0.25, 0.65, ["closed", "closing", "open"]));
  gg.sat.set(sm.satArt, wordOf(sm.satArt, 0.75, 0.9, ["mixed", "improving", "normal"]));
  const key = drug + ":" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
