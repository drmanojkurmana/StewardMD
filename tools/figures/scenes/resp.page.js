/* Respiratory mechanics scene: real lung anatomy, breath, airway muscle, mucus, sacs, surfactant and the pressure volume curve. */
const layers = { trap: $("trapG"), sac: $("sacG"), tube: $("tubeG"), parts: $("parts"), over: $("over"), panel: $("panel"), pv: $("pvG"), diaph: $("diaph") };
let lungO = null, capEl = null, capKey = "";
let TR = [260, 94], CA = [260, 250], HL = [243, 276], HR = [276, 276], AP = [200, 186], APR = [322, 199];
let trL = null, trR = null, trapEl = null;
const bronchi = [], bands = [], bandPts = [], mucs = [], sacs = [], scars = [];
const L2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function initOrgans() {
  lungO = organ($("lungSlot"), "lung", 262, 250, 240, {});
  const P = lungO.ports;
  TR = P.trachea; CA = P.carina; HL = P.hilumL; HR = P.hilumR; AP = P.apex; APR = P.apexR;
  const T = layers.tube;
  mk("path", { class: "rp-trach", d: "M" + f1(TR[0]) + " " + f1(TR[1]) + "L" + f1(CA[0]) + " " + f1(CA[1]) }, T);
  [HL, HR].forEach((H) => {
    bronchi.push(mk("path", { class: "rp-bronchT", d: "M" + f1(CA[0]) + " " + f1(CA[1]) + "L" + f1(H[0]) + " " + f1(H[1]) }, T));
    const dx = H[0] - CA[0], dy = H[1] - CA[1], n = Math.max(1, Math.hypot(dx, dy)), px = (-dy / n) * 9, py = (dx / n) * 9;
    [0.35, 0.55, 0.75].forEach((t) => {
      const c = L2(CA, H, t);
      bands.push(mk("path", { class: "rp-band", d: "M" + f1(c[0] - px) + " " + f1(c[1] - py) + "L" + f1(c[0] + px) + " " + f1(c[1] + py) }, T));
      bandPts.push(c);
    });
    const mc = L2(CA, H, 0.62), g = mk("g", {}, T);
    mk("circle", { class: "rp-muc", cx: 0, cy: 0, r: 7 }, g);
    mk("circle", { class: "rp-muc", cx: 5, cy: 3, r: 4.5 }, g);
    place(g, mc[0], mc[1], 0, 1); mucs.push({ g, x: mc[0], y: mc[1] });
  });
  [[AP[0] - 30, AP[1] - 10, 20], [AP[0] + 5, AP[1] + 22, -25], [APR[0] + 28, APR[1] - 6, -20], [APR[0] - 8, APR[1] + 26, 25], [AP[0] - 8, AP[1] + 44, 10]].forEach(([x, y, r]) => {
    const t = (r * Math.PI) / 180, dx = Math.cos(t) * 11, dy = Math.sin(t) * 11;
    const e = mk("path", { class: "rp-scar", d: "M" + f1(x - dx) + " " + f1(y - dy) + "L" + f1(x + dx) + " " + f1(y + dy) }, T);
    e.setAttribute("opacity", "0"); scars.push(e);
  });
  trapEl = mk("ellipse", { class: "rp-trap", cx: 260, cy: 332, rx: 118, ry: 52 }, layers.trap);
  trapEl.setAttribute("opacity", "0");
  const mouth = [TR[0], 56];
  trL = track([mouth, TR, CA, HL, [HL[0] - 28, HL[1] + 72]]);
  trR = track([mouth, TR, CA, HR, [HR[0] + 28, HR[1] + 72]]);
  airs.forEach((p) => { p.tr = p.i % 2 ? trR : trL; });
  surfRiders.forEach((p) => { p.tr = p.i % 2 ? trR : trL; });
}
/* ---- air sacs dotted with surfactant, scattered through the lower lobes ---- */
const OFFS = [[-58, 28], [-32, 44], [-52, 66], [-18, 66], [-44, 92], [-8, 92]];
function initSacs() {
  [HL, HR].forEach((H, side) => {
    OFFS.forEach(([ox, oy]) => {
      const x = H[0] + (side ? -ox : ox), y = H[1] + oy;
      const g = mk("g", {}, layers.sac);
      mk("circle", { class: "rp-alv", r: 13 }, g);
      const sg = mk("g", {}, g), n = sacs.length;
      for (let j = 0; j < 5; j++) { const t = (j / 5) * 6.283 + n; mk("circle", { class: "rp-surf", r: 2, cx: f1(Math.cos(t) * 10), cy: f1(Math.sin(t) * 10) }, sg); }
      sg.setAttribute("opacity", "0.25");
      place(g, x, y, 0, 1);
      sacs.push({ g, sg, x, y, c: ((n * 37) % 10) / 9 });
    });
  });
}
/* ---- particle pools ---- */
function poolDot(n, cls, r) {
  return Array.from({ length: n }, (_, i) => {
    const e = mk("circle", { class: cls, r }, layers.parts);
    e.setAttribute("opacity", "0");
    return { e, i, o: (i % 13) * 0.062, jx: rnd(-4, 4), u: (i % 8) / 8, tr: null };
  });
}
const airs = poolDot(26, "sc-p p-airp", 3);
const bronDots = poolDot(6, "sc-p p-bron", 3.2);
const surfRiders = poolDot(8, "sc-p p-surfP", 2.6);
/* ---- pressure volume panel ---- */
const PV = { ox: 592, oy: 330, w: 296, h: 198 };
let pvCurve = null, pvDot = null;
function pvPoint(t, compN, Vt, swing) {
  const maxVol = clamp(0.35 + 0.65 * Vt), presEnd = clamp(1.12 - 0.6 * compN + 0.18 * swing, 0.3, 1);
  return { x: PV.ox + t * maxVol * PV.w, y: PV.oy - Math.pow(t, 1.3) * presEnd * PV.h };
}
function pvPath(compN, Vt, swing) {
  let d = "";
  for (let i = 0; i <= 20; i++) { const p = pvPoint(i / 20, compN, Vt, swing); d += (i ? "L" : "M") + f1(p.x) + " " + f1(p.y); }
  return d;
}
function initPV() {
  const P = layers.pv;
  mk("path", { class: "rp-axis", d: "M" + PV.ox + " " + (PV.oy - PV.h - 12) + "L" + PV.ox + " " + PV.oy + "L" + (PV.ox + PV.w + 14) + " " + PV.oy }, P);
  mk("path", { class: "rp-ref", d: pvPath(0.65, 0.59, 0.58) }, P);
  pvCurve = mk("path", { class: "rp-curve", d: "" }, P);
  pvDot = mk("circle", { class: "rp-dot", r: 5, cx: PV.ox, cy: PV.oy }, P);
  const tv = mk("text", { class: "sc-lab", x: 740, y: 354, "text-anchor": "middle" }, P); tv.textContent = "Volume";
  const tp = mk("text", { class: "sc-lab", x: 566, y: 226, "text-anchor": "middle", transform: "rotate(-90 566 226)" }, P); tp.textContent = "Pressure";
  const lg = mk("text", { class: "rp-legend", x: 612, y: 148 }, P); lg.textContent = "dashed is normal";
  [["Muscles pull the chest open", 378], ["Air flows in as sacs stretch", 396], ["Stiff lungs need more pressure", 414]].forEach(([s, y]) => { const t = mk("text", { class: "rp-step", x: 544, y }, P); t.textContent = s; });
}
function capText(l, d) {
  if (d === 1) return ["Surfactant concept. Healthy sacs already open well.", "Surfactant coats the sacs. They open evenly with less work.", "Surfactant concept. Tension falls but tight airways remain."][l];
  if (d === 2) return ["Bronchodilator. Open airways stay open.", "Bronchodilator. Airways widen but stiff sacs still resist.", "Bronchodilator relaxes airway muscle. Trapped air escapes."][l];
  return ["No treatment. Healthy lungs fill easily with each breath.", "No treatment. Stiff sacs barely open and need hard work.", "No treatment. Tight airways trap stale air in big sacs."][l];
}
/* ---- labels, gauges and the state caption ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The breath";
  [["comp", "Compliance", "g-comp", "How easily the lung stretches for a given pressure change. Low in stiff fibrotic lungs, high when elastic tissue is lost."], ["res", "Resistance", "g-res", "How hard it is to push air through the airways. High when muscle squeeze and mucus narrow the bronchi."], ["flow", "Airflow", "g-flow", "Air flow into the lung. It rises when resistance falls or the lung opens more easily."], ["rec", "Recoil", "g-rec", "Elastic recoil: the lung springing back. High in fibrosis, lost in emphysema."], ["ten", "Tension", "g-ten", "Surface tension at the wet sac surface. Surfactant lowers it and stops small sacs collapsing."], ["eff", "Effort", "g-eff", "Work needed for the breath. It rises when the lung is stiff or the airways are narrow."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, midL = L2(CA, HL, 0.55), plugR = L2(CA, HR, 0.62);
  pill(ox, "Windpipe", TR[0], TR[1] + 28, 442, 80, "Windpipe and bronchi carry air to the sacs. Narrowing here raises resistance and slows flow.");
  pill(ox, "Airway muscle", midL[0], midL[1], 96, 208, "Airway muscle rings squeeze the bronchi in asthma. A bronchodilator relaxes them and the tubes widen.");
  pill(ox, "Mucus plug", plugR[0], plugR[1], 430, 246, "Sticky mucus plugs narrow the airway in obstructive disease and shrink with treatment.");
  pill(ox, "Air sacs", HL[0] - 52, HL[1] + 66, 96, 332, "Air sacs stretch as air enters. Stiff sacs open poorly and unevenly. Floppy sacs overfill and trap air.");
  pill(ox, "Surfactant", HR[0] + 52, HR[1] + 66, 430, 348, "Surfactant coats the wet sac surface. It stops small sacs collapsing so all sacs open evenly.");
  pill(ox, "Breathing muscle", 330, 404, 428, 404, "The breathing muscle flattens down to pull air in. It works harder when lungs are stiff or airways are narrow.");
  pill(ox, "Pressure curve", 700, 263, 838, 108, "Pressure volume curve: pressure needed for each volume. The dashed curve is the normal pattern.");
  capEl = mk("text", { class: "rp-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { compN: 0.65, R: 0.25, tension: 0.48, recoil: 0.55, flow: 0.65, Vt: 0.59, swing: 0.58, surf: 0, bron: 0, fib: 0, obs: 0 };
function init() { initOrgans(); initSacs(); initPV(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 2.2);
  sm.compN = lerp(sm.compN, m.compN, kk); sm.R = lerp(sm.R, m.R, kk); sm.tension = lerp(sm.tension, m.tension, kk); sm.recoil = lerp(sm.recoil, m.recoil, kk); sm.flow = lerp(sm.flow, m.flow, kk); sm.Vt = lerp(sm.Vt, m.Vt, kk); sm.swing = lerp(sm.swing, m.swing, kk); sm.surf = lerp(sm.surf, m.surf, kk); sm.bron = lerp(sm.bron, m.bron, kk);
  sm.fib = lerp(sm.fib, m.a < 0.7 ? 1 : 0, kk); sm.obs = lerp(sm.obs, m.a > 1.2 ? 1 : 0, kk);
  const constr = clamp((sm.R - 0.2) / 0.68), trap = sm.obs * (1 - 0.8 * sm.bron);
  const b = 0.5 - 0.5 * Math.cos(tm * 0.0017);
  const volB = b * sm.Vt, dMove = b * clamp(0.55 + 0.45 * sm.swing);
  /* chest and lung expand with the breath; the breathing muscle flattens down, less so when air is trapped */
  const ls = 1 + 0.028 * volB;
  lungO.g.setAttribute("transform", "translate(262 250) scale(" + ls.toFixed(4) + ")");
  const endY = 412 - 6 * trap + 5 * dMove, midY = 352 + 30 * dMove + 26 * trap;
  layers.diaph.setAttribute("d", "M168 " + f1(endY) + "Q262 " + f1(midY) + " 356 " + f1(endY));
  /* bronchi widen and muscle bands fade as the bronchodilator parks on them */
  bronchi.forEach((p) => p.setAttribute("stroke-width", f1(11.5 - 7 * constr)));
  bands.forEach((e) => { e.setAttribute("opacity", (0.25 + 0.6 * constr * (1 - 0.7 * sm.bron)).toFixed(2)); e.setAttribute("stroke-width", f1(1.6 + 1.8 * constr)); });
  mucs.forEach((mc) => {
    const sc = Math.max(0.001, (0.35 + 0.65 * sm.obs) * (1 - 0.75 * sm.bron));
    place(mc.g, mc.x, mc.y, 0, sc);
    mc.g.setAttribute("opacity", (0.3 + 0.7 * clamp(sc)).toFixed(2));
  });
  trapEl.setAttribute("opacity", (trap * 0.55).toFixed(2));
  scars.forEach((e) => e.setAttribute("opacity", (sm.fib * 0.85).toFixed(2)));
  /* sacs swell with the breath; fibrotic sacs collapse unevenly until surfactant evens them out */
  const base = 0.7 + 0.5 * sm.compN;
  sacs.forEach((s) => {
    const unev = 1 - sm.fib * (1 - sm.surf) * 0.55 * s.c;
    place(s.g, s.x, s.y, 0, base * (0.85 + 0.4 * volB) * unev);
    s.sg.setAttribute("opacity", (0.25 + 0.75 * sm.surf).toFixed(2));
  });
  /* air streams in; past the squeeze point it thins out until the airway opens */
  airs.forEach((p) => {
    const u = clamp(b * 1.18 - p.o, 0.02, 0.98), pt = p.tr.at(u);
    p.e.setAttribute("transform", "translate(" + f1(pt.x + p.jx * (u < 0.5 ? 0.4 : 1)) + " " + f1(pt.y) + ")");
    p.e.setAttribute("opacity", ((0.45 + 0.55 * sm.flow) * (u > 0.6 ? 1 - constr * 0.85 : 1)).toFixed(2));
  });
  /* bronchodilator dots ride down and sit on the muscle bands; surfactant rides down to the sacs */
  bronDots.forEach((p, i) => {
    const c = bandPts[i % bandPts.length];
    place(p.e, c[0] + Math.sin(tm / 600 + i * 2) * 1.5, c[1] + Math.cos(tm / 700 + i) * 1.5, 0, 1);
    p.e.setAttribute("opacity", sm.bron < 0.03 ? "0" : sm.bron.toFixed(2));
  });
  surfRiders.forEach((p) => {
    p.u += dt * (0.14 + 0.3 * sm.flow); if (p.u > 1) p.u -= 1;
    const pt = p.tr.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ")");
    p.e.setAttribute("opacity", (sm.surf * (p.u > 0.88 ? (1 - p.u) / 0.12 : 1)).toFixed(2));
  });
  /* pressure volume curve and the moving breath point */
  if (pvCurve) { pvCurve.setAttribute("d", pvPath(sm.compN, sm.Vt, sm.swing)); const dp = pvPoint(b, sm.compN, sm.Vt, sm.swing); pvDot.setAttribute("cx", f1(dp.x)); pvDot.setAttribute("cy", f1(dp.y)); }
  gg.comp.set(sm.compN, wordOf(sm.compN, 0.4, 0.75, ["low", "normal", "high"])); gg.res.set(sm.R, wordOf(sm.R, 0.35, 0.65, ["low", "raised", "high"])); gg.flow.set(sm.flow, wordOf(sm.flow, 0.4, 0.6, ["low", "reduced", "good"]));
  gg.rec.set(sm.recoil, wordOf(sm.recoil, 0.35, 0.65, ["low", "normal", "high"])); gg.ten.set(sm.tension, wordOf(sm.tension, 0.35, 0.55, ["low", "normal", "high"])); gg.eff.set(sm.swing, wordOf(sm.swing, 0.45, 0.7, ["low", "raised", "high"]));
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
