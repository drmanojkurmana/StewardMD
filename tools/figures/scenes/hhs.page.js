/* HHS scene: some insulin without ketones, very high glucose, osmotic diuresis, cell shrinkage, brain effect and clot risk. */
const CY = SC.CY, WW = SC.W;
const layers = { cells: $("cells"), sparks: $("sparks"), clots: $("clots"), parts: $("parts"), marks: $("marks"), tr: $("tr"), over: $("over"), panel: $("panel"), lumen: $("lumen"), panc: $("pancSlot"), liver: $("liverSlot"), brain: $("brainSlot"), kidney: $("kidneySlot") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0, dwell: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.dwell = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts);
const dropPath = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
const sm = { G: 0.7, Osm: 0.7, De: 0.6, Ke: 0.1, Imp: 0.4, Alert: 0.6, T: 0.4, Eloss: 0.4, fl: 0, ins: 0, el: 0, tp: 0, a: 0.7 };
let hh = 28, sparkPh = 0;

/* ---- organs: pancreas, liver, brain and kidney replace the old blob art ---- */
let pancO = null, liverO = null, brainO = null, brainWrap = null, kidneyO = null, capEl = null, capDrug = -1;
/* particle anchor points, set from the real organ bounds in initOrgans */
let secX = 115, secY = 198, livL = 344, livB = 218, livR = 486;
function capText(d) {
  if (d === 1) return "Fluids refill the vessels and dilute the blood. Sugar is still high, so insulin comes next.";
  if (d === 2) return "Insulin lowers sugar but the vessels stay empty. Water loss stays bad.";
  if (d === 3) return "Fluids first, then insulin. Vessels refill and sugar falls.";
  if (d === 4) return "Full treatment. Fluids, insulin, salts and clot prevention together. Alertness returns.";
  return "No treatment. Sugar stays very high, water pours away in urine, and the brain gets drowsy.";
}
function initOrgans() {
  pancO = organ(layers.panc, "pancreas", 125, 150, 150, {});
  liverO = organ(layers.liver, "liver", 405, 150, 170, {});
  brainWrap = mk("g", {}, layers.brain);
  brainO = organ(brainWrap, "brain", 790, 150, 180, {});
  kidneyO = organ(layers.kidney, "kidney", 645, 392, 60, {});
  secX = pancO.x - 10; secY = pancO.y + pancO.h / 2 - 4;
  livL = liverO.x - liverO.w / 2 + 24; livB = liverO.y + liverO.h / 2 - 2; livR = liverO.x + liverO.w / 2 - 4;
}

/* ---- a body cell stays a tissue cell; it visibly shrinks as water leaves it ---- */
const bodycell = cell(layers.cells, { cls: "bodycell", r: 18, seed: 13, wob: 0.1, x: 625, y: 185 });
const sparks = [[700, 96], [735, 82], [778, 84], [812, 104], [690, 128], [820, 140]].map(([x, y], i) => { const p = mk("path", { class: "hhs-spark", d: "M0 -7L2 0L0 7M-5 -3L0 0L5 -3" }, layers.sparks); p.setAttribute("transform", "translate(" + x + " " + y + ") rotate(" + (i * 37) + ")"); return p; });
/* block marks where insulin keeps ketone making and sugar release switched off */
const blocks = [[488, 150], [446, 212]].map(([x, y]) => { const g = mk("g", { opacity: "0" }, layers.marks); mk("circle", { class: "hhs-x", cx: x, cy: y, r: 7 }, g); mk("path", { class: "hhs-x", d: "M" + (x - 5) + " " + (y + 5) + "L" + (x + 5) + " " + (y - 5) }, g); return g; });
/* ---- blood cells and clot clumps ---- */
const rbcs = Array.from({ length: 14 }, () => { const g = mk("g", { class: "cl cl-rbc" }, layers.parts); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); return { e: g, x: rnd(20, 940), r: rnd(-0.75, 0.75), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }; });
const clumps = [[300, 1], [520, -1], [700, 1], [850, -1]].map(([x, side], i) => { const g = mk("g", {}, layers.clots); for (let j = 0; j < 5; j++) cell(g, { cls: "plt", r: 5 + (j % 3), x: Math.cos(j * 1.4) * 8, y: Math.sin(j * 2) * 5 * -side, seed: j + i * 3, wob: 0.15, n: 7 }); return { e: g, x, side }; });
/* ---- treatment sources ---- */
const bag = mk("g", { id: "tr-fl" }, layers.tr); mk("path", { class: "hhs-icon", d: "M50 380h40v32a18 11 0 0 1-40 0Z" }, bag); mk("path", { class: "hhs-icon", d: "M66 380v-6h8v6" }, bag); mk("path", { class: "p-fl", d: "M70 392c4 5 5 8 5 10a5 5 0 0 1-10 0c0-2 1-5 5-10Z" }, bag);
const syr = mk("g", { id: "tr-ins" }, layers.tr); mk("rect", { class: "hhs-ico2", x: 160, y: 386, width: 52, height: 15, rx: 3 }, syr); mk("path", { class: "hhs-ico2", d: "M212 391h18v4h-18Z" }, syr); mk("path", { class: "hhs-ico2", d: "M176 386v15M188 386v15M200 386v15" }, syr);
const ebag = mk("g", { id: "tr-el" }, layers.tr); mk("path", { class: "hhs-ico3", d: "M290 380h40v32a18 11 0 0 1-40 0Z" }, ebag); mk("path", { class: "hhs-ico3", d: "M306 380v-6h8v6" }, ebag); mk("circle", { class: "sc-p p-k", cx: 310, cy: 398, r: 5 }, ebag);
const shield = mk("g", { id: "tr-tp" }, layers.tr); mk("path", { class: "hhs-ico4", d: "M440 378l20 8v14c0 14-9 22-20 28-11-6-20-14-20-28v-14Z" }, shield); mk("path", { class: "hhs-ico4", d: "M432 402l6 6 12-13" }, shield);
/* ---- pools ---- */
const gl = Array.from({ length: 30 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(20, 940), r: rnd(-0.8, 0.8) }));
const insp = pool(12, () => mk("path", { class: "sc-p p-ins", d: "M0 -3.4L3 -1.7L3 1.7L0 3.4L-3 1.7L-3 -1.7Z" }, layers.parts));
const gprod = pool(10, dot("p-gluc", 3));
const ketTry = pool(8, dia("p-ket"));
const cellWater = pool(16, () => mk("path", { class: "p-fl", d: dropPath }, layers.parts));
const ivp = pool(16, () => mk("path", { class: "p-iv", d: dropPath }, layers.parts));
const tinsp = pool(10, () => mk("path", { class: "sc-p p-ins", d: "M0 -3.4L3 -1.7L3 1.7L0 3.4L-3 1.7L-3 -1.7Z" }, layers.parts));
const elp = pool(10, dot("p-k", 3.2));
const wat = pool(22, () => mk("path", { class: "p-fl", d: dropPath }, layers.parts));
const salt = pool(10, dot("p-salt", 2.6));
const TUBE = track(SC.tube);
const ng = Array.from({ length: 12 }, () => ({ e: dot("p-gluc", 3)(), u: Math.random() }));
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gl", "Blood glucose. It stays very high because insulin is too little or works too poorly, even though some insulin is present."], ["osm", "Osmolality", "g-osm", "How concentrated the blood is. Glucose and dehydration concentrate it, and water is pulled out of cells."], ["de", "Dehydration", "g-dehy", "Water lost in urine over days. It is the main problem in this state and fluids correct it."], ["ke", "Ketones", "g-ket", "Ketones stay low in this state because some insulin still prevents fat breakdown into ketone acids. That is the contrast with ketoacidosis."], ["al", "Alertness", "g-alert", "Alertness falls as concentrated blood pulls water out of brain cells, from drowsy toward severely impaired."], ["cl", "Clot risk", "g-clot", "Concentrated, slow blood and being unwell raise the risk of clots. Clot prevention lowers it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pancreas", 125, 100, 115, 82, "Pancreas in type 2 diabetes. It still releases some insulin, but too little to control sugar.");
  pill(ox, "Some insulin", 115, 235, 210, 208, "Some insulin reaches the blood. Enough to switch off ketone making, not enough to control sugar.");
  pill(ox, "Liver", 405, 82, 420, 62, "Liver. With too little working insulin it keeps releasing sugar, while ketone making stays switched off.");
  pill(ox, "Brain", 790, 80, 838, 60, "Brain. Concentrated blood pulls water out of brain cells, so thinking slows and the patient gets drowsy.");
  pill(ox, "Body cell", 625, 185, 625, 218, "A body cell. Water leaves it for the concentrated blood, so the cell shrinks as dehydration worsens.");
  pill(ox, "Kidney", 617, 388, 690, 360, "Kidney. Sugar left in the urine drags water and salts out with it. This is osmotic diuresis.");
  pill(ox, "Lost in urine", 922, 418, 872, 436, "Water and salts lost in urine over days. This loss is the main problem in this state.");
  pill(ox, "Treatment", 140, 384, 140, 428, "Treatment when given. Fluids refill the vessels, insulin lowers sugar, salts are replaced, clots are prevented.");
  const lg = mk("g", {}, ox); [["p-gluc", "glucose", 286], ["p-ins", "insulin", 378], ["p-ket", "ketone", 462], ["p-fl", "water", 548]].forEach(([c, n, x]) => { if (c === "p-fl") mk("path", { class: "p-fl", d: dropPath, transform: "translate(" + x + " 246)" }, lg); else if (c === "p-ket") mk("path", { class: "sc-p " + c, d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z", transform: "translate(" + x + " 246)" }, lg); else mk("circle", { class: "sc-p " + c, cx: x, cy: 246, r: 3 }, lg); const tx = mk("text", { class: "sc-lab", x: x + 8, y: 249 }, lg); tx.textContent = n; });
  capEl = mk("text", { class: "hhs-cap", x: 30, y: 30 }, ox); capEl.textContent = capText(0);
}
function init() { initOrgans(); initPanel(); }
const acc = { insp: 0, gp: 0, ket: 0, cw: 0, iv: 0, tin: 0, el: 0, wat: 0, salt: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.G = lerp(sm.G, m.G, k2); sm.Osm = lerp(sm.Osm, m.Osm, k2); sm.De = lerp(sm.De, m.De, k2); sm.Ke = lerp(sm.Ke, m.Ke, k2); sm.Imp = lerp(sm.Imp, m.Imp, k2); sm.Alert = lerp(sm.Alert, m.Alert, k2); sm.T = lerp(sm.T, m.T, k2); sm.Eloss = lerp(sm.Eloss, m.Eloss, k2);
  sm.fl = lerp(sm.fl, m.fl, k1); sm.ins = lerp(sm.ins, m.ins, k1); sm.el = lerp(sm.el, m.el, k1); sm.tp = lerp(sm.tp, m.tp, k1); sm.a = m.a;
  hh = 32 * (1 - 0.34 * sm.De) + 2 * Math.sin(tm / 900);
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  const flow = 52 * (1 - 0.45 * sm.De) * (1 - 0.25 * sm.T);
  /* blood glucose crowd and red cells */
  const wg = Math.round(sm.G * gl.length);
  gl.forEach((p, i) => { p.x += flow * dt; if (p.x > 940) { p.x = 20; p.r = rnd(-0.8, 0.8); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * (hh - 6)) + ")"); p.e.setAttribute("opacity", i < wg ? "1" : "0"); });
  rbcs.forEach((p) => { p.x += p.v * flow * dt; if (p.x > 952) { p.x = 8; p.r = rnd(-0.75, 0.75); } place(p.e, p.x, CY + p.r * (hh - 10), p.rot + Math.sin(tm / 500 + p.x) * 8, 1); });
  clumps.forEach((c, i) => { const s = clamp((sm.T - 0.08 * i) * 1.7); place(c.e, c.x, CY + c.side * (hh - 13), 0, 0.15 + 0.85 * s); c.e.style.opacity = s > 0.05 ? 1 : 0; });
  /* endogenous insulin: secreted by the pancreas, travels in blood to the liver */
  acc.insp += dt * 2.2; while (acc.insp >= 1) { acc.insp--; const p = free(insp); if (p) emit(p, secX, secY, 0, 42, 0); }
  insp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y > CY - 4) { p.k = 1; p.y = CY + rnd(-5, 5); } } else if (p.k === 1) { p.x += (p.x < livL ? 82 : -82) * dt; if (Math.abs(p.x - livL) < 8) p.k = 2; } else { p.y -= 58 * dt; if (p.y < 210) kill(p); } at(p); });
  /* block marks: ketone making stays switched off, more so with treatment insulin */
  blocks.forEach((g) => g.setAttribute("opacity", (0.35 + 0.65 * sm.ins).toFixed(2)));
  /* liver glucose out, throttled when treatment insulin sits on the liver */
  acc.gp += dt * (0.4 + sm.G) * 3.2 * (1 - 0.6 * sm.ins); while (acc.gp >= 1) { acc.gp--; const p = free(gprod); if (p) emit(p, 440 + rnd(-8, 8), 208, 0, 46, 0); }
  gprod.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > CY - hh) kill(p); });
  /* ketone attempts start at the liver edge and die at the block mark */
  acc.ket += dt * 1.3; while (acc.ket >= 1) { acc.ket--; const p = free(ketTry); if (p) emit(p, 468, 152 + rnd(-5, 5), 44, -2, 0); }
  ketTry.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; at(p); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.x - 484) / 18).toFixed(2)); if (p.x > 502) kill(p); });
  /* water leaves the body cell and the brain toward the concentrated blood */
  place(bodycell, 625, 185, 0, 1 - 0.3 * sm.De);
  brainWrap.setAttribute("transform", "translate(790 150) scale(" + (1 - 0.06 * sm.Imp).toFixed(3) + ") translate(-790 -150)");
  sparkPh += dt * (0.4 + 2.2 * sm.Alert); sparks.forEach((s, i) => { s.style.opacity = clamp(sm.Alert * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(sparkPh * 2 + i * 1.3)))).toFixed(2); });
  acc.cw += dt * sm.Osm * 5; while (acc.cw >= 1) { acc.cw--; const p = free(cellWater); if (p) emit(p, (Math.random() < 0.5 ? 625 : 765) + rnd(-10, 14), 198 + rnd(0, 16), rnd(-4, 6), 34, 0); }
  cellWater.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > CY - hh - 2) kill(p); });
  /* kidney: glucose in the tube drags water and electrolytes out */
  const wn = Math.round(sm.G * ng.length); ng.forEach((p, i) => { p.u = (p.u + dt * 0.1) % 1; const a2 = TUBE.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a2.x) + " " + f1(a2.y) + ")"); p.e.setAttribute("opacity", i < wn ? "1" : "0"); });
  acc.wat += dt * sm.G * (1 - 0.55 * sm.fl) * 6; while (acc.wat >= 1) { acc.wat--; const p = free(wat), a2 = TUBE.at(rnd(0.15, 0.9)); if (p) emit(p, clamp(a2.x, 580, 936), clamp(a2.y + 8, 360, 428), rnd(-3, 3), 20, 0); }
  wat.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; at(p); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.y - 404) / 30).toFixed(2)); if (p.t > 1.5 || p.y > 438) kill(p); });
  acc.salt += dt * sm.Eloss * 3; while (acc.salt >= 1) { acc.salt--; const p = free(salt), a2 = TUBE.at(rnd(0.2, 0.85)); if (p) emit(p, clamp(a2.x, 580, 936), clamp(a2.y + 8, 360, 428), rnd(-4, 4), 17, 0); }
  salt.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.t > 1.4 || p.y > 438) kill(p); });
  /* treatment sources: icons light up, particles run into the blood */
  $("tr-fl").style.opacity = (0.3 + 0.7 * sm.fl).toFixed(2); $("tr-ins").style.opacity = (0.3 + 0.7 * sm.ins).toFixed(2); $("tr-el").style.opacity = (0.3 + 0.7 * sm.el).toFixed(2); $("tr-tp").style.opacity = (0.3 + 0.7 * sm.tp).toFixed(2);
  acc.iv += dt * sm.fl * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivp); if (p) emit(p, 70, 372, 34, -48, 0); }
  ivp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < CY + hh - 4) { p.k = 1; p.vx = flow * 1.25; p.vy = 0; p.y = CY + rnd(-hh + 8, hh - 8); } } else p.x += p.vx * dt; at(p); if (p.x > 944) kill(p); });
  /* treatment insulin: travels to the liver, sits on it, then sugar release fades */
  acc.tin += dt * sm.ins * 2.6; while (acc.tin >= 1) { acc.tin--; const p = free(tinsp); if (p) { emit(p, 190, 380, 0, -48, 0); p.tx = livL + rnd(-6, 24); } }
  tinsp.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 4) { p.k = 1; p.y = CY + rnd(-5, 5); } }
    else if (p.k === 1) { p.x += 86 * dt; if (p.x >= p.tx) { p.k = 2; p.x = p.tx; p.dwell = 0; } }
    else if (p.k === 2) { p.dwell += dt; p.x = p.tx + Math.sin(tm / 200 + p.tx) * 1.5; if (p.dwell > 0.9) p.k = 3; }
    else { p.y -= 56 * dt; if (p.y < 208) kill(p); }
    at(p);
  });
  acc.el += dt * sm.el * 2.8; while (acc.el >= 1) { acc.el--; const p = free(elp); if (p) emit(p, 310, 372, 0, -48, 0); }
  elp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 5) { p.k = 1; p.y = CY + rnd(-7, 7); } } else p.x += flow * 1.1 * dt; at(p); if (p.x > 944) kill(p); });
  /* gauges and the plain-language caption */
  gg.gl.set(sm.G, wordOf(sm.G, 0.4, 0.7, ["controlled", "high", "very high"])); gg.osm.set(sm.Osm, wordOf(sm.Osm, 0.35, 0.65, ["normal", "raised", "very high"])); gg.de.set(sm.De, wordOf(sm.De, 0.3, 0.6, ["corrected", "moderate", "severe"]));
  gg.ke.set(sm.Ke, wordOf(sm.Ke, 0.3, 0.6, ["low", "low", "low"])); gg.al.set(sm.Alert, m.words[3]); gg.cl.set(sm.T, wordOf(sm.T, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
