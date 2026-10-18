/* Hepatorenal syndrome scene: scarred liver, wide gut vessels, empty arteries, hormonal drive, a squeezed but normal kidney, ascites and urine salt. */
const layers = { fluid: $("fluid"), gut: $("gutG"), raas: $("raasG"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, ri: -1 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; if (p.ri >= 0) { recs[p.ri].who = null; p.ri = -1; } p.e.setAttribute("opacity", "0"); }

/* ---- organs from the shared library; vessels and particles meet their ports ---- */
let liverO = null, kidneyO = null, bladderO = null, capEl = null, capDrug = -1;
function initOrgans() {
  liverO = organ($("liverSlot"), "liver", 140, 175, 180, {});
  kidneyO = organ($("kidneySlot"), "kidney", 700, 330, 120, {});
  bladderO = organ($("bladderSlot"), "bladder", 860, 370, 64, {});
}
function capText(d) {
  if (d === 1) return "Albumin plus a vessel tightener. Gut vessels narrow, filling improves and the kidney eases.";
  if (d === 2) return "Harmful drugs stopped. With triggers gone, the squeeze on the kidney eases a little.";
  if (d === 3) return "A new liver. The cirrhosis is gone, so vessels relax and the kidney recovers.";
  return "No treatment. Wide gut vessels leave the arteries empty and the kidney squeezed.";
}

/* ---- gut bed, artery, hormonal hub, scars, receptors, squeeze markers ---- */
let gut = null, gutV = null, hub = null, nodG = null, artFill = null, sqzL = null, sqzR = null, ascPool = null, ascSurf = null;
const recs = [];
const RECXY = [[425, 150], [485, 150], [425, 190], [485, 190]];
function initBody() {
  gut = cell(layers.gut, { cls: "gut", r: 46, nuc: 0.3, seed: 7, wob: 0.16, x: 455, y: 170 });
  gutV = mk("g", {}, layers.gut);
  [[-26, -14, 0, 8], [-8, -22, 12, 4], [14, -16, 26, 6], [-18, 12, 2, 20], [10, 14, 28, 18]].forEach(([a, b, c, d]) => mk("path", { class: "hr-gutv", d: "M" + (455 + a) + " " + (170 + b) + "Q" + (455 + c) + " " + (170 + (b + d) / 2) + " " + (455 + c) + " " + (170 + d) }, gutV));
  mk("rect", { class: "hr-art", x: 560, y: 150, width: 150, height: 46, rx: 23 }, layers.gut);
  artFill = mk("rect", { x: 582, y: 156, width: 80, height: 34, rx: 17, fill: "var(--c-rbc)", opacity: "0.4" }, layers.gut);
  hub = cell(layers.raas, { cls: "raas", r: 36, nuc: 0.4, seed: 9, wob: 0.12, x: 830, y: 155 });
  nodG = mk("g", {}, layers.parts);
  [[110, 140, 11], [150, 130, 9], [180, 150, 10], [120, 190, 10], [165, 195, 8], [95, 170, 7]].forEach(([x, y, r]) => mk("circle", { class: "hr-nod", cx: x, cy: y, r }, nodG));
  RECXY.forEach(([x, y]) => { const ring = mk("circle", { class: "hr-rec", cx: x, cy: y, r: 5.5 }, layers.parts); recs.push({ x, y, ring, who: null }); });
  sqzL = mk("path", { class: "hr-sqz", d: "M630 308L630 328" }, layers.parts);
  sqzR = mk("path", { class: "hr-sqz", d: "M650 308L650 328" }, layers.parts);
  ascPool = mk("path", { class: "hr-pool", opacity: "0.32" }, layers.fluid);
  ascSurf = mk("path", { class: "hr-surf", opacity: "0.85" }, layers.fluid);
}

/* ---- red cells on the portal and arterial segments ---- */
const prbcs = [], arbcs = [];
function initCells() {
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    prbcs.push({ g, x: rnd(234, 404), y: rnd(-6, 6), v: rnd(0.85, 1.15), rot: rnd(-15, 15) });
  }
  for (let i = 0; i < 8; i++) {
    const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g);
    arbcs.push({ g, x: rnd(566, 706), y: rnd(-9, 9), v: rnd(0.85, 1.15), rot: rnd(-15, 15) });
  }
}

const trSig = track([[806, 186], [772, 238], [750, 290], [736, 328]]);
const trUreter = track([[690, 405], [730, 418], [790, 395], [827, 350]]);
const trTox = track([[640, 200], [660, 250], [688, 300], [712, 326]]);
const trBlock = RECXY.map(([rx, ry]) => track([[600, 173], [(600 + rx) / 2, (173 + ry) / 2 - 12], [rx, ry]]));

/* ---- particle pools ---- */
const nos = pool(16, () => mk("circle", { class: "p-no", r: 3 }, layers.parts));
const sig = pool(20, () => mk("path", { class: "sc-p p-raas", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts));
const urine = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const salt = pool(10, () => mk("circle", { class: "sc-p p-salt", r: 2 }, layers.parts));
const leak = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const albP = pool(10, () => mk("circle", { class: "sc-p p-alb", r: 2.6 }, layers.parts));
const blk = pool(8, () => mk("circle", { class: "sc-p p-block", r: 4 }, layers.parts));
const diur = pool(8, () => mk("circle", { class: "sc-p p-diur", r: 2.6 }, layers.parts));
const tox = pool(8, () => mk("path", { class: "sc-p p-tox", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, layers.parts));

const gg = {};
let tAlb, tHalt, tTxp;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["portal", "Portal", "g-portal", "Pressure in the portal vein system. It rises as the scarred liver resists flow and widened gut inflow stays high."], ["fill", "Filling", "g-good", "Effective arterial filling. Gut vessels widen and blood pools there, so the arterial side feels empty despite extra total fluid."], ["raas", "RAAS drive", "g-raas", "Renin angiotensin and sympathetic nerve activity. The body switches these on to defend pressure when filling falls."], ["sqz", "Renal squeeze", "g-bad", "How tightly the kidney arteries are squeezed by that hormonal and nerve drive."], ["kid", "Kidney", "g-good", "Kidney filtration. It falls from poor blood flow, not from damaged tissue: the kidney here is structurally normal."], ["salt", "Urine salt", "g-fl", "Salt appearing in the urine. The squeezed kidney holds on to salt, so urine salt is very low in hepatorenal syndrome."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Cirrhotic liver", 120, 150, 130, 84, "Cirrhotic liver. Scarring and nodules resist blood flow through the liver, so portal pressure rises.");
  pill(ox, "Portal pressure", 315, 171, 300, 84, "Portal pressure. Pressure builds in the portal vein as the liver resists flow and gut inflow stays high.");
  pill(ox, "Gut vessels widen", 455, 150, 470, 84, "Splanchnic arteries in the gut widen, driven in part by nitric oxide. Blood pools there instead of filling the arterial circulation.");
  pill(ox, "Arterial filling", 605, 158, 650, 84, "Effective arterial filling. The arterial side is underfilled even though total body fluid is up, because so much blood sits in the widened gut vessels.");
  pill(ox, "RAAS and nerves", 824, 128, 830, 84, "Renin angiotensin system and sympathetic nerves. Underfilling switches them on to defend blood pressure, at the cost of squeezing the kidney.");
  pill(ox, "Nitric oxide", 455, 195, 470, 228, "Nitric oxide. A vessel widening signal made in excess in cirrhosis. It helps open the gut arteries and begin the underfilling.");
  pill(ox, "Kidney squeeze", 628, 315, 520, 262, "Renal vasoconstriction. Hormonal and nerve signals squeeze the kidney arteries hard, so filtration falls.");
  pill(ox, "Kidney", 736, 335, 845, 255, "The kidney. Structurally normal tissue that fails only because its blood supply is squeezed: a functional kidney failure.");
  pill(ox, "Ascites", 200, 375, 140, 352, "Ascites. Fluid in the abdomen from high portal pressure plus kidney retention of salt and water.");
  pill(ox, "Urine salt", 790, 390, 780, 415, "Urine salt. Very little salt reaches the urine because the kidney is holding on to salt tightly.");
  tAlb = pill(ox, "Albumin plus tightener", 680, 160, 640, 228, "Albumin expands the effective arterial volume and a vasoconstrictor tightens the widened gut arteries. Together they ease the squeeze on the kidney.");
  tAlb.style.opacity = 0;
  tHalt = pill(ox, "Stop harmful drugs", 700, 290, 845, 300, "Stopping diuretics and other kidney toxins removes triggers that reduce filling or injure the kidney and can tip the balance into failure.");
  tHalt.style.opacity = 0;
  tTxp = pill(ox, "New liver", 120, 205, 130, 228, "Liver transplant. A working liver removes the cirrhosis and portal hypertension that drive the whole chain, so the kidney can recover.");
  tTxp.style.opacity = 0;
  capEl = mk("text", { class: "hr-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { P: 0.6, D: 0.5, U: 0.4, R: 0.5, Rc: 0.4, K: 0.6, Asc: 0.5, UNa: 0.4, alb: 0, halt: 0, txp: 0, a: 0.7, dock: 0 };
const acc = { no: 0, sig: 0, ur: 0, salt: 0, leak: 0, alb: 0, blk: 0, diur: 0, tox: 0 };
function init() { initOrgans(); initBody(); initCells(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["P", "D", "U", "R", "Rc", "Asc", "UNa", "alb", "halt", "txp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.K = lerp(sm.K, m.K, k2); sm.a = m.a;
  /* docked tightener share, eases toward the occupied receptor count */
  let docked = 0; recs.forEach((r) => { if (r.who) docked++; });
  sm.dock = lerp(sm.dock, docked / recs.length, Math.min(1, dt * 2));
  /* vessels and organs */
  $("v-portal").setAttribute("stroke-width", f1(9 + 13 * sm.P));
  $("v-renal").setAttribute("stroke-width", f1(13 - 9 * sm.Rc));
  nodG.setAttribute("opacity", ((0.25 + 0.75 * sm.a) * (1 - 0.92 * sm.txp)).toFixed(2));
  const gs = 1 + 0.28 * sm.D * (1 - 0.8 * sm.dock);
  place(gut, 455, 170, Math.sin(tm / 2400) * 4, gs);
  gutV.setAttribute("opacity", (0.35 + 0.65 * sm.D * (1 - 0.5 * sm.dock)).toFixed(2));
  gutV.setAttribute("transform", "translate(" + f1(455 * (1 - gs)) + " " + f1(170 * (1 - gs)) + ") scale(" + gs.toFixed(3) + ")");
  recs.forEach((r) => { r.ring.setAttribute("stroke-width", r.who ? "2.6" : "1.6"); r.ring.setAttribute("opacity", (r.who ? 1 : 0.55 + 0.35 * sm.alb).toFixed(2)); });
  artFill.setAttribute("opacity", (0.18 + 0.6 * (1 - sm.U)).toFixed(2));
  artFill.setAttribute("width", f1(40 + 66 * (1 - sm.U)));
  place(hub, 830, 155, Math.sin(tm / 2000) * 5, 1 + 0.07 * sm.R * Math.sin(tm / 280));
  const gap = 10 - 7 * sm.Rc;
  sqzL.setAttribute("d", "M" + f1(634 - gap) + " 308L" + f1(634 - gap) + " 328");
  sqzR.setAttribute("d", "M" + f1(646 + gap) + " 308L" + f1(646 + gap) + " 328");
  sqzL.setAttribute("opacity", (0.25 + 0.75 * sm.Rc).toFixed(2)); sqzR.setAttribute("opacity", (0.25 + 0.75 * sm.Rc).toFixed(2));
  /* ascites pool, kept inside the stage */
  const topY = 436 - (8 + 74 * sm.Asc);
  let d = "M36 " + f1(topY), s = "M36 " + f1(topY);
  for (let x = 46; x <= 436; x += 10) { const y = topY + 1.6 * Math.sin(x / 24 + tm / 700); d += "L" + x + " " + f1(y); s += "L" + x + " " + f1(y); }
  ascPool.setAttribute("d", d + "L436 436L36 436Z"); ascSurf.setAttribute("d", s);
  /* red cells: portal vein into the liver, arterial stretch past the gut */
  const spdA = 46 * clamp(0.3 + 0.7 * (1 - sm.U));
  prbcs.forEach((r) => { r.x -= r.v * 40 * dt; if (r.x < 234) { r.x = 404; r.y = rnd(-6, 6); } place(r.g, r.x, 170 + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  arbcs.forEach((r) => { r.x += r.v * spdA * dt; if (r.x > 706) { r.x = 566; r.y = rnd(-9, 9); } place(r.g, r.x, 173 + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* nitric oxide drifting out of the gut vessels, faded by the docked tightener */
  acc.no += dt * sm.D * (1 - 0.7 * sm.dock) * 7; while (acc.no >= 1) { acc.no--; const p = free(nos); if (p) emit(p, 455 + rnd(-30, 30), 170 + rnd(-26, 26), rnd(-16, 16), rnd(-16, 16)); }
  nos.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 383, 527); p.y = clamp(p.y + p.vy * dt, 103, 239); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.7).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* vasoconstrictor: travel to a free receptor, sit on it, then let go */
  acc.blk += dt * sm.alb * 2.2; while (acc.blk >= 1) { acc.blk--; const ri = recs.findIndex((r) => !r.who); const p = free(blk); if (ri >= 0 && p) { p.ri = ri; recs[ri].who = p; p.tr = trBlock[ri]; p.u = 0; emit(p, 600, 173, 0, 0); p.ri = ri; recs[ri].who = p; } }
  blk.forEach((p) => {
    if (!p.on) return;
    if (p.tr) { p.u += dt * 0.9; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.tr = null; p.t = 0; } }
    else { p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.y) * 1.5) + " " + f1(p.y) + ")"); if (p.t > 5 || sm.alb < 0.5) kill(p); }
  });
  /* albumin support flowing in the artery */
  acc.alb += dt * sm.alb * 7; while (acc.alb >= 1) { acc.alb--; const p = free(albP); if (p) emit(p, 566, 173 + rnd(-12, 12), rnd(52, 68), 0); }
  albP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 706) kill(p); });
  /* harmful triggers, present until they are stopped */
  acc.diur += dt * (1 - sm.halt) * 3.2; while (acc.diur >= 1) { acc.diur--; const p = free(diur); if (p) emit(p, 600 + rnd(0, 70), 100, rnd(-3, 3), rnd(36, 48)); }
  diur.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y >= 158) kill(p); });
  acc.tox += dt * (1 - sm.halt) * 2.4; while (acc.tox >= 1) { acc.tox--; const p = free(tox); if (p) { emit(p, 640, 182, 0, 0); p.u = 0; } }
  tox.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; const q = trTox.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", p.u >= 1 ? "0" : "1"); if (p.u >= 1) kill(p); });
  /* hormonal and nerve signals travelling to the kidney */
  acc.sig += dt * sm.R * 9; while (acc.sig >= 1) { acc.sig--; const p = free(sig); if (p) { emit(p, 806, 186, 0, 0); p.u = 0; } }
  sig.forEach((p) => { if (!p.on) return; p.u += dt * 0.55; const q = trSig.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", p.u >= 1 ? "0" : "1"); if (p.u >= 1) kill(p); });
  /* urine and the salt inside it, kidney to bladder then out */
  acc.ur += dt * sm.K * 5; while (acc.ur >= 1) { acc.ur--; const p = free(urine); if (p) { emit(p, 690, 405, 0, 0); p.u = 0; p.k = 0; } }
  urine.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.u += dt * 0.8; const q = trUreter.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.k = 1; p.x = 860; p.y = 411; p.vx = rnd(-2, 2); p.vy = rnd(8, 16); } }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 415) / 22).toFixed(2)); if (p.y > 436) kill(p); }
  });
  acc.salt += dt * sm.K * sm.UNa * 6; while (acc.salt >= 1) { acc.salt--; const p = free(salt); if (p) { emit(p, 690, 405, 0, 0); p.u = 0; p.k = 0; } }
  salt.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.u += dt * 0.8; const q = trUreter.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) { p.k = 1; p.x = 860; p.y = 411; p.vx = rnd(-2, 2); p.vy = rnd(8, 16); } }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 415) / 22).toFixed(2)); if (p.y > 436) kill(p); }
  });
  /* ascites leak drops falling into the pool */
  acc.leak += dt * sm.Asc * 5; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, rnd(80, 400), 252, rnd(-3, 3), rnd(24, 38)); }
  leak.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt, 40, 432); p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > topY - 2) kill(p); });
  tAlb.style.opacity = sm.alb.toFixed(2); tHalt.style.opacity = sm.halt.toFixed(2); tTxp.style.opacity = sm.txp.toFixed(2);
  /* gauges */
  gg.portal.set(sm.P, wordOf(sm.P, 0.35, 0.7, ["mild", "raised", "very high"]));
  gg.fill.set(1 - sm.U, wordOf(1 - sm.U, 0.35, 0.65, ["low", "reduced", "maintained"]));
  gg.raas.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["quiet", "active", "very active"]));
  gg.sqz.set(sm.Rc, wordOf(sm.Rc, 0.3, 0.6, ["relaxed", "tight", "very tight"]));
  gg.kid.set(sm.K, wordOf(sm.K, 0.35, 0.7, ["failing", "struggling", "working"]));
  gg.salt.set(sm.UNa, wordOf(sm.UNa, 0.3, 0.6, ["very low", "low", "present"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
