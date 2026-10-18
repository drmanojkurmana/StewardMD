/* Type 1 and type 2 diabetes: beta cells under attack or strain, insulin and glucose in the blood, liver output and uptake by muscle and fat. */
const L = { pancSlot: $("pancSlot"), liverSlot: $("liverSlot"), muscleSlot: $("muscleSlot"), insBeam: $("insBeam"), gluBeam: $("gluBeam"), insCloud: $("insCloud"), upGlow: $("upGlow"), livAct: $("livAct"), rbcs: $("rbcs"), cells: $("cells"), parts: $("parts"), drugG: $("drugG"), over: $("over"), panel: $("panel") };
const VY = 309;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const insP = pool(46, () => mk("circle", { class: "sc-p p-ins", r: 3 }, L.parts));
const gluP = pool(54, () => mk("circle", { class: "sc-p p-glu", r: 3.2 }, L.parts));
const sigP = pool(10, () => mk("path", { class: "sc-p p-sig", d: "M0 -4L3.4 0L0 4L-3.4 0Z" }, L.parts));
let pancO = null, liverO = null, muscleO = null, trSig = null;
let isletX = 172, isletY = 182, liverX = 758, liverBotY = 229, muscleX = 662, muscleY = 396;
let atkX = 46, atkY = 202;
let haloEl = null, penG = null, tabG = null, gateEl = null, sigBeam = null, resG = null, doorG = null, capEl = null, capKey = "";
const betas = [], tcells = [], rbcs = [];
const gg = {};
function initOrgans() {
  pancO = organ(L.pancSlot, "pancreas", 172, 182, 220, { h: 80 });
  liverO = organ(L.liverSlot, "liver", 758, 165, 230, { h: 120 });
  muscleO = organ(L.muscleSlot, "muscle", 662, 396, 150, { h: 70 });
  isletX = pancO.x; isletY = pancO.y; liverX = liverO.x;
  liverBotY = Math.round(liverO.y + liverO.h / 2 + 4);
  muscleX = muscleO.x; muscleY = muscleO.y;
  L.insBeam.setAttribute("d", "M" + f1(isletX) + " " + f1(isletY + pancO.h / 2) + " L" + f1(isletX) + " " + f1(VY));
  L.gluBeam.setAttribute("d", "M" + f1(liverX) + " " + f1(liverBotY) + " L" + f1(liverX) + " " + f1(VY + 6));
  L.livAct.setAttribute("cx", f1(liverX)); L.livAct.setAttribute("cy", f1(liverO.y));
  L.livAct.setAttribute("rx", f1(liverO.w * 0.44)); L.livAct.setAttribute("ry", f1(liverO.h * 0.44));
  const gl = muscleX - muscleO.w / 2, gr = 906;
  L.upGlow.setAttribute("cx", f1((gl + gr) / 2)); L.upGlow.setAttribute("rx", f1((gr - gl) / 2));
  trSig = track([[70, 362], [102, 326], [124, 262], [isletX - 28, isletY + 12]]);
}
function initCells() {
  haloEl = mk("circle", { class: "dm-halo", cx: f1(isletX), cy: f1(isletY), r: 42, opacity: "0" }, L.cells);
  const br = Math.max(14, Math.min(20, pancO.h * 0.2));
  const spots = [[0, 0]];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.2832; spots.push([Math.cos(a) * (br + 8), Math.sin(a) * (br + 6)]); }
  spots.forEach(([dx, dy], i) => { const g = cell(L.cells, { cls: "bcell", r: 10, nuc: 0.35, seed: i + 3, wob: 0.1 }); place(g, isletX + dx, isletY + dy, 0, 1); betas.push({ g, dx, dy }); });
  const offs = [[-pancO.w / 2 - 16, -pancO.h * 0.25], [pancO.w / 2 + 16, -pancO.h * 0.55 - 10], [-pancO.w / 2 - 16, pancO.h * 0.25], [pancO.w * 0.25, pancO.h / 2 + 22]];
  offs.forEach(([dx, dy], i) => { const g = cell(L.cells, { cls: "lymph", r: 13, nuc: 0.5, seed: i + 30, wob: 0.12 }); tcells.push({ g, x: isletX + dx, y: isletY + dy, ph: i * 1.7 }); });
  atkX = tcells[2].x; atkY = tcells[2].y;
  for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(20, 940), y: rnd(292, 326), v: rnd(0.8, 1.2) }); }
}
function initDevices() {
  penG = mk("g", { opacity: "0" }, L.drugG);
  mk("rect", { class: "dm-pen", x: 325, y: 232, width: 90, height: 26, rx: 13 }, penG);
  mk("rect", { class: "dm-penfill", x: 335, y: 239, width: 52, height: 12, rx: 6 }, penG);
  mk("path", { class: "dm-needle", d: "M370 258L370 282" }, penG);
  mk("path", { class: "dm-penstream", d: "M370 282L370 302" }, penG);
  tabG = mk("g", { opacity: "0" }, L.drugG);
  [[700, 150], [745, 136], [790, 156]].forEach(([x, y]) => {
    mk("rect", { class: "dm-met", x: f1(x - 13), y: f1(y - 6.5), width: 26, height: 13, rx: 6.5 }, tabG);
    mk("path", { class: "dm-metscore", d: "M" + f1(x) + " " + f1(y - 6.5) + "L" + f1(x) + " " + f1(y + 6.5) }, tabG);
  });
  gateEl = mk("rect", { class: "dm-gate", x: f1(liverX - 28), y: 252, width: 56, height: 12, rx: 6, opacity: "0" }, L.drugG);
  sigBeam = mk("path", { class: "dr-beam dm-sigbeam", d: "M70 362 C100 330 120 262 " + f1(isletX - 28) + " " + f1(isletY + 12), opacity: "0" }, L.drugG);
  resG = mk("g", {}, L.over);
  [[muscleX, muscleY], [850, 399]].forEach(([x, y]) => { mk("path", { class: "res-x", d: "M" + f1(x - 7) + " " + f1(y - 7) + "l14 14M" + f1(x + 7) + " " + f1(y - 7) + "l-14 14" }, resG); });
  doorG = mk("g", {}, L.over);
  [muscleX - 45, muscleX - 15, muscleX + 15, muscleX + 45].forEach((x) => { mk("path", { class: "dm-door", d: "M" + f1(x) + " " + f1(muscleY - muscleO.h / 2) + "l0 -10" }, doorG); });
  [815, 865].forEach((x) => { mk("path", { class: "dm-door", d: "M" + f1(x) + " 366l0 -10" }, doorG); });
}
function initPanel() {
  const P = L.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What is happening";
  [["beta", "Beta cells", "g-beta", "Working beta cells in the islet. Destroyed in type 1, strained then tired in type 2."], ["ins", "Insulin", "g-ins", "Insulin reaching the blood: made by beta cells, replaced by the pen, boosted by incretin therapy when beta cells remain."], ["res", "Resistance", "g-res", "Insulin resistance in muscle, fat and liver. High in type 2, near normal in type 1."], ["liv", "Liver output", "g-glu", "Sugar released by the liver. Insulin and metformin switch it down."], ["upt", "Uptake", "g-good", "Sugar taken up by muscle and fat. Needs insulin and insulin sensitivity."], ["glu", "Blood sugar", "g-bad", "Sugar carried in the blood. Raised when liver output beats uptake."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, y0 + 2, 52, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Pancreas", pancO.ports.tail[0], pancO.ports.tail[1], 110, 84, "Pancreas: the organ that holds the insulin making islets.");
  pill(o, "Beta cells", isletX, isletY, 360, 120, "Beta cells make and release insulin. In type 1 they are destroyed; in type 2 they first overwork, then tire.");
  pill(o, "Attack", atkX, atkY, 96, 262, "In type 1, immune cells attack and destroy beta cells. There is little attack in type 2.");
  pill(o, "Insulin", 480, VY, 480, 250, "Insulin in the blood: it switches off liver output and lets muscle and fat take up sugar.");
  pill(o, "Liver", liverO.ports.lobe[0], liverO.ports.lobe[1], 755, 84, "The liver stores sugar and releases it into the blood. Insulin switches this release off.");
  pill(o, "Blood sugar", liverX, 262, 862, 250, "Sugar carried in the blood. It stays high when liver output beats uptake.");
  pill(o, "Muscle and fat", muscleO.ports.belly[0], muscleO.ports.belly[1], 672, 340, "Muscle and fat take up sugar when insulin acts. In type 2 they resist insulin, so uptake falls.");
  capEl = mk("text", { class: "dm-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0, 1);
}
function capText(d, t) {
  if (d === 1) {
    if (t === 0) return "Insulin given. It replaces the missing insulin and lowers blood sugar.";
    return "Insulin given. It switches off liver output and moves sugar into muscle and fat.";
  }
  if (d === 2) {
    if (t === 0) return "Metformin quiets the liver, but it cannot replace missing insulin.";
    return "Metformin quiets the liver. Less sugar pours into the blood.";
  }
  if (d === 3) {
    if (t === 0) return "Incretin therapy needs working beta cells, so it helps little here.";
    return "Incretin therapy helps working beta cells release more insulin.";
  }
  if (t === 0) return "No treatment. The attack destroyed beta cells, so almost no insulin is made.";
  return "No treatment. Insulin cannot keep up, so blood sugar stays high.";
}
const sm = { B: 0.6, A: 0, R: 0.5, I: 0.5, H: 0.5, U: 0.3, G: 0.6, ins: 0, met: 0, inc: 0 };
const acc = { ins: 0, glu: 0, sig: 0 };
function init() { initOrgans(); initCells(); initDevices(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.B = lerp(sm.B, m.B, k); sm.A = lerp(sm.A, m.A, k); sm.R = lerp(sm.R, m.R, k); sm.I = lerp(sm.I, m.I, k); sm.H = lerp(sm.H, m.H, k); sm.U = lerp(sm.U, m.U, k); sm.G = lerp(sm.G, m.G, k); sm.ins = lerp(sm.ins, m.ins, k); sm.met = lerp(sm.met, m.met, k); sm.inc = lerp(sm.inc, m.inc, k);
  const pulse = 1 + 0.12 * sm.inc * Math.sin(tm / 300);
  betas.forEach((b) => { const s = (0.25 + 0.75 * sm.B) * pulse; place(b.g, isletX + b.dx, isletY + b.dy, 0, s); b.g.style.opacity = (0.25 + 0.75 * sm.B).toFixed(2); });
  tcells.forEach((c) => { const pull = sm.A * 16; place(c.g, c.x + Math.sin(tm / 700 + c.ph) * 3 + (isletX - c.x) / 60 * pull, c.y + Math.cos(tm / 800 + c.ph) * 3 + (isletY - c.y) / 60 * pull, 0, 0.4 + 0.6 * sm.A); c.g.style.opacity = (0.08 + 0.92 * sm.A).toFixed(2); });
  resG.setAttribute("opacity", (0.1 + 0.8 * sm.R).toFixed(2));
  doorG.setAttribute("opacity", (0.15 + 0.75 * (1 - sm.R)).toFixed(2));
  penG.setAttribute("opacity", sm.ins.toFixed(2));
  penG.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 500) * 2 * sm.ins) + ")");
  tabG.setAttribute("opacity", sm.met.toFixed(2));
  tabG.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 550) * 2 * sm.met) + ")");
  gateEl.setAttribute("opacity", sm.met.toFixed(2));
  sigBeam.setAttribute("opacity", (sm.inc * 0.85).toFixed(2));
  haloEl.setAttribute("opacity", (sm.inc * (0.45 + 0.2 * Math.sin(tm / 300))).toFixed(2));
  L.gluBeam.setAttribute("stroke-width", f1(2 + 6 * sm.H));
  L.gluBeam.setAttribute("opacity", (0.25 + 0.55 * sm.H).toFixed(2));
  L.insBeam.setAttribute("opacity", (0.2 + 0.65 * sm.I).toFixed(2));
  L.insCloud.setAttribute("opacity", (sm.ins * 0.55).toFixed(2));
  L.upGlow.setAttribute("opacity", (0.06 + 0.5 * sm.U).toFixed(2));
  L.livAct.setAttribute("opacity", (sm.met * 0.5).toFixed(2));
  rbcs.forEach((r) => { r.x += r.v * 55 * dt; if (r.x > 950) r.x = 12; place(r.g, r.x, r.y, Math.sin(tm / 600 + r.x) * 8, 1); });
  acc.ins += dt * (0.5 + sm.I * 7 + sm.ins * 9);
  while (acc.ins >= 1) { acc.ins--; const p = free(insP); if (p) { if (sm.ins > 0.4 && Math.random() < 0.55) emit(p, 370 + rnd(-8, 8), 286, 0, 0, 1); else emit(p, isletX + rnd(-14, 14), isletY + pancO.h / 2, rnd(-4, 4), 30, 0); } }
  insP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= VY) { p.k = 1; p.y = VY; } }
    else { p.x += 62 * dt; p.y = VY + Math.sin(tm / 300 + p.x / 40) * 6; if (p.x > 936 || p.t > 9) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 18, 942)) + " " + f1(clamp(p.y, 56, 428)) + ")"); });
  acc.glu += dt * (0.25 + sm.H * 8 + sm.G * 2);
  while (acc.glu >= 1) { acc.glu--; const p = free(gluP); if (p) emit(p, liverX + rnd(-18, 18), liverBotY, rnd(-4, 4), 26, 0); }
  gluP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y >= VY) { p.k = 1; p.y = VY; p.vx = Math.random() < 0.5 ? -58 : 58; } }
    else if (p.k === 1) { p.x += p.vx * dt; p.y = VY + Math.cos(tm / 340 + p.x / 50) * 6; const inTissue = (p.x > 585 && p.x < 745) || (p.x > 775 && p.x < 925); if (inTissue && Math.random() < dt * sm.U * 1.9) p.k = 2; if (p.x < 24 || p.x > 936 || p.t > 11) kill(p); }
    else { p.y += 34 * dt; if (p.y > 424) kill(p); }
    if (p.on) p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 18, 942)) + " " + f1(clamp(p.y, 56, 428)) + ")"); });
  acc.sig += dt * sm.inc * 5;
  while (acc.sig >= 1) { acc.sig--; const p = free(sigP); if (p) emit(p, 70, 362, 0, 0, 3); }
  sigP.forEach((p) => { if (!p.on) return; p.t += dt * 0.4; const q = trSig.at(Math.min(1, p.t)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, tm / 6, 1); if (p.t >= 1) kill(p); });
  gg.beta.set(sm.B, wordOf(sm.B, 0.25, 0.6, ["few left", "reduced", "working"])); gg.ins.set(sm.I, wordOf(sm.I, 0.25, 0.6, ["low", "reduced", "high"]));
  gg.res.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["low", "raised", "high"])); gg.liv.set(sm.H, wordOf(sm.H, 0.3, 0.6, ["low", "raised", "high"]));
  gg.upt.set(sm.U, wordOf(sm.U, 0.3, 0.55, ["low", "reduced", "good"])); gg.glu.set(sm.G, wordOf(sm.G, 0.35, 0.65, ["controlled", "raised", "high"]));
  const key = drug + ":" + m.t;
  if (key !== capKey) { capKey = key; const s = capText(drug, m.t); if (capEl.textContent !== s) capEl.textContent = s; }
}
run({ init, step });
