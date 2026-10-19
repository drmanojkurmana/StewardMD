/* Nephrotic scene: kidney and a magnified filter, protein leak to urine, low albumin, oedema, lipids, clot and infection risk, gauges. */
const WW = SC.W;
const CX = 330, CY = 215;
const layers = { kidney: $("kidneySlot"), glom: $("glom"), vess: $("vess"), tiss: $("tiss"), risk: $("risk"), parts: $("parts"), over: $("over"), panel: $("panel"), oed: $("oedema") };
let kidneyO = null, connTrack = null, capEl = null, capDrug = -1;
const podBase = [], pods = [], depBase = [], depDots = [], artPts = [];
const tissCells = [], bacCells = [];
let teethG = null, effBand = null, depG = null, scarG = null, clotG = null, artEl = null;
function capText(d) {
  if (d === 1) return "Steroid calms the podocytes. The filter seals and the leak slows.";
  if (d === 2) return "ACE inhibitor eases pressure in the filter. Diuretic drains oedema fluid.";
  if (d === 3) return "Immune therapy damps the immune attack. Deposits fade and the leak slows.";
  return "No treatment. Protein pours through the leaky filter into the urine.";
}
function initKidney() {
  kidneyO = organ(layers.kidney, "kidney", 108, 178, 128, { flip: true });
  const H = kidneyO.ports.hilum || kidneyO.ports.in, O = kidneyO.ports.out;
  $("connVess").setAttribute("d", "M" + f1(H[0]) + " " + f1(H[1]) + " C" + f1(H[0] + 84) + " " + f1(H[1] - 48) + " 320 94 " + f1(430) + " 113");
  $("ureter").setAttribute("d", "M" + f1(O[0]) + " " + f1(O[1]) + " L" + f1(O[0]) + " " + f1(O[1] + 54));
  connTrack = track([H, [H[0] + 84, H[1] - 48], [320, 94], [430, 113]]);
}
function initGlom() {
  artEl = mk("path", { class: "np-art", d: "M" + (CX - 86) + " " + CY + "L" + (CX - 28) + " " + CY }, layers.glom);
  artPts.push([CX - 68, CY - 6], [CX - 48, CY + 7], [CX - 60, CY + 7]);
  [[-18, -12], [16, -20], [-2, 14], [-30, 18], [30, 12]].forEach(([dx, dy], i) => { const c = cell(layers.glom, { cls: "tuft", r: 26, nuc: 0.32, seed: i * 2 + 1, wob: 0.1 }); place(c, CX + dx, CY + dy, i * 24, 1); });
  mk("circle", { class: "np-gbm", cx: CX, cy: CY, r: 70 }, layers.glom);
  effBand = mk("circle", { class: "np-eff", cx: CX, cy: CY, r: 76 }, layers.glom);
  teethG = mk("g", {}, layers.glom);
  for (let i = 0; i < 28; i++) { const a = (i / 28) * 6.283, x1 = CX + Math.cos(a) * 70, y1 = CY + Math.sin(a) * 70, x2 = CX + Math.cos(a) * 81, y2 = CY + Math.sin(a) * 81; mk("path", { class: "np-tooth", d: "M" + f1(x1) + " " + f1(y1) + "L" + f1(x2) + " " + f1(y2) }, teethG); }
  depG = mk("g", { opacity: "0" }, layers.glom);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283 + 0.2, x = CX + Math.cos(a) * 78, y = CY + Math.sin(a) * 78, d = mk("circle", { class: "np-dep", cx: f1(x), cy: f1(y), r: 4.2 }, depG); depDots.push(d); depBase.push([x, y]); }
  scarG = mk("g", { opacity: "0" }, layers.glom);
  const scarPath = mk("path", { class: "np-scar", d: "M" + (CX + 15) + " " + (CY + 35) + "L" + (CX + 60) + " " + (CY + 45) + "L" + (CX + 48) + " " + (CY + 72) + "L" + (CX + 5) + " " + (CY + 58) + "Z" }, scarG); scarPath.style.opacity = "1";
  mk("path", { class: "fibrin", d: "M" + (CX + 20) + " " + (CY + 45) + "L" + (CX + 50) + " " + (CY + 65) + "M" + (CX + 50) + " " + (CY + 42) + "L" + (CX + 22) + " " + (CY + 64) }, scarG);
  for (let i = 0; i < 6; i++) { const a = i * 1.047, x = CX + Math.cos(a) * 96, y = CY + Math.sin(a) * 96, c = cell(layers.glom, { cls: "pod", r: 12, nuc: 0.42, seed: i * 3 + 2, wob: 0.14 }); place(c, x, y, i * 40, 1); pods.push(c); podBase.push([x, y]); }
  clotG = mk("g", {}, layers.risk);
  for (let j = 0; j < 6; j++) cell(clotG, { cls: "plt2", r: 6, x: Math.cos(j * 1.4) * 11, y: Math.sin(j * 2) * 6, seed: j + 3, wob: 0.15, n: 7 });
  for (let j = 0; j < 5; j++) mk("path", { class: "fibrin", d: "M" + f1(560 + rnd(-20, 20)) + " " + f1(370 + rnd(-12, 12)) + "L" + f1(560 + rnd(-20, 20)) + " " + f1(370 + rnd(-12, 12)) }, clotG);
  [[745, 362], [790, 382], [835, 360], [865, 388], [800, 398]].forEach(([x, y], i) => { const b = cell(layers.risk, { cls: "bac", r: 8, nuc: 0.3, seed: i * 2 + 5, wob: 0.16 }); place(b, x, y, i * 35, 1); bacCells.push(b); });
  [[500, 225], [600, 252], [700, 222], [800, 252], [880, 225], [650, 270]].forEach(([x, y], i) => { const c = cell(layers.tiss, { cls: "endo", r: 14, nuc: 0.3, seed: i * 2 + 8, wob: 0.1 }); place(c, x, y, 0, 1); tissCells.push({ g: c, x, y }); });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, lane: 0 }; }); }
const prot = pool(28, () => mk("circle", { class: "sc-p p-prot", r: 3 }, layers.parts));
const drops = pool(24, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const igg = pool(12, () => mk("circle", { class: "sc-p p-igg", r: 2.6 }, layers.parts));
const connP = pool(8, () => mk("circle", { class: "sc-p p-alb", r: 3 }, layers.parts));
const rxp = pool(14, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "rx-a", x: -4.5, y: -2.2, width: 9, height: 4.4, rx: 2.2 }, g); mk("rect", { class: "rx-b", x: 0, y: -2.2, width: 4.5, height: 4.4, rx: 2.2 }, g); return g; });
rxp.forEach((p) => { p.half = p.e.childNodes[1]; p.tgt = null; p.mode = 0; p.op = 1; p.kind = 0; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function lanePool(n, build, laneBase) { const pl = pool(n, build); pl.forEach((p, i) => { p.x = rnd(438, 922); p.lane = laneBase + (i % 3) * 10; p.vx = rnd(28, 46); }); return pl; }
const albP = lanePool(18, () => mk("circle", { class: "sc-p p-alb", r: 3 }, layers.parts), -12);
const lipP = lanePool(14, () => mk("circle", { class: "sc-p p-lip", r: 4 }, layers.parts), 4);
function rideLane(pl, dt, frac, cy) { const want = Math.round(clamp(frac) * pl.length); pl.forEach((p, i) => { const on = i < want; if (!on) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; if (p.x > 922) p.x = 438; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(cy + p.lane) + ")"); }); }
const RXCOL = { 1: "var(--c-good)", 2: "var(--c-fl)", 3: "var(--c-ab)" };
function rxAnchors(d) { return d === 1 ? podBase : d === 2 ? artPts : d === 3 ? depBase : null; }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 260, 410, 560, 710, 860];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient and urine";
  [["leak", "Protein leak", "g-alb", "Albumin escaping through the damaged filter into the urine. Treatment that repairs the filter or eases pressure inside it cuts the leak."],
    ["alb", "Albumin", "g-good", "Blood albumin. It falls as albumin is lost in the urine, so less water is held inside the blood vessel."],
    ["oed", "Oedema", "g-fl", "Fluid that has left the blood and collected in the tissues because blood albumin is low. A diuretic helps remove it."],
    ["lip", "Lipids", "g-lip", "Blood lipids. The liver makes more lipid carrying particles in response to the protein loss, so lipids rise."],
    ["clot", "Clot risk", "g-clot", "Risk of a blood clot. Defence and regulatory proteins are lost in the urine while the liver makes more clotting proteins."],
    ["inf", "Infection risk", "g-dep", "Risk of infection. Antibodies and other defence proteins are lost in the urine, so defence against bacteria is weaker."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Kidney", 128, 148, 108, 78, "The kidney. Blood is filtered in millions of tiny filters called glomeruli.");
  pill(ox, "Filter", 268, 153, 300, 110, "One filter, magnified. Blood passes the filter wall and too much protein slips through.");
  pill(ox, "Podocytes", 282, 132, 215, 120, "Podocytes hug the filter wall. When their feet spread flat the barrier leaks. A steroid calms them.");
  pill(ox, "Protein in urine", 330, 360, 255, 360, "Protein leaking into the urine. Heavy protein loss defines this syndrome.");
  pill(ox, "Albumin", 560, 115, 560, 62, "Albumin travelling in the blood. Lost in the urine, so blood levels fall.");
  pill(ox, "Oedema", 700, 240, 760, 170, "Oedema. With albumin low, fluid leaves the blood and pools in the tissues.");
  pill(ox, "Clot", 560, 370, 500, 300, "A clot forming in a small vein. Lost regulatory proteins and extra liver made clotting proteins raise the risk.");
  pill(ox, "Weak defence", 790, 370, 830, 300, "Weak defence. Antibodies lost in the urine leave bacteria harder to fight. Immune therapy targets the deposits, not the bacteria.");
  capEl = mk("text", { class: "np-capline", x: 30, y: 432 }, ox); capEl.textContent = capText(0);
}
const urineTrack = track([[CX, CY + 81], [CX, 398]]);
const sm = { leak: 0.7, efface: 0.7, albumin: 0.4, oedema: 0.6, lipids: 0.6, clot: 0.6, infection: 0.6, deposits: 0.1, sclerosis: 0.1, steroid: 0, ace: 0, immuno: 0 };
const KEYS = Object.keys(sm);
const acc = { prot: 0, drop: 0, igg: 0, rx: 0 };
function init() { initKidney(); initGlom(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  teethG.setAttribute("opacity", clamp(1 - sm.efface).toFixed(2));
  effBand.setAttribute("opacity", (sm.efface * 0.75).toFixed(2));
  const depVis = sm.deposits * (1 - 0.75 * sm.immuno);
  depG.setAttribute("opacity", clamp(depVis).toFixed(2));
  depDots.forEach((d) => d.setAttribute("r", f1(4.2 * (1 - 0.6 * sm.immuno))));
  scarG.setAttribute("opacity", sm.sclerosis.toFixed(2));
  if (scarG.firstChild) scarG.firstChild.style.opacity = sm.sclerosis > 0.05 ? "1" : "0";
  pods.forEach((p, i) => { p.style.opacity = i === 1 ? (1 - 0.75 * sm.sclerosis).toFixed(2) : "1"; });
  artEl.setAttribute("stroke-width", f1(4.5 + 5 * sm.ace));
  layers.oed.setAttribute("opacity", (sm.oedema * 0.5).toFixed(2));
  tissCells.forEach((c, i) => { const spread = 1 + sm.oedema * 0.1; place(c.g, 680 + (c.x - 680) * spread, c.y + Math.sin(tm / 900 + i) * 1.5, 0, 1); });
  place(clotG, 560, 370, 0, 0.25 + 0.95 * sm.clot); clotG.style.opacity = sm.clot > 0.08 ? "1" : "0";
  bacCells.forEach((b, i) => { const s = 0.45 + 0.75 * sm.infection; place(b, [745, 790, 835, 865, 800][i], [362, 382, 360, 388, 398][i], i * 35 + Math.sin(tm / 500 + i) * 8, s); });
  rideLane(albP, dt, sm.albumin, 115);
  rideLane(lipP, dt, sm.lipids, 115);
  const wantConn = Math.round(clamp(sm.albumin) * connP.length);
  connP.forEach((p, i) => { p.u = (p.u + dt * 0.22) % 1; const q = connTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); p.e.setAttribute("opacity", i < wantConn ? "1" : "0"); });
  acc.prot += dt * sm.leak * 7; while (acc.prot >= 1) { acc.prot--; const p = free(prot); if (p) emit(p, CX, CY + 81, 0, 0); }
  prot.forEach((p) => { if (!p.on) return; p.u += dt * (0.14 + 0.12 * sm.leak); if (p.u >= 1) { kill(p); return; } const q = urineTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.drop += dt * sm.oedema * 8; while (acc.drop >= 1) { acc.drop--; const p = free(drops); if (p) emit(p, rnd(450, 910), 150, rnd(-3, 3), rnd(18, 30)); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 282) kill(p); });
  acc.igg += dt * (1 - sm.infection) * 3.2; while (acc.igg >= 1) { acc.igg--; const p = free(igg); if (p) emit(p, 615, rnd(352, 398), rnd(22, 36), rnd(-5, 5)); }
  igg.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 915) kill(p); });
  acc.rx += dt * (drug ? 3 : 0); while (acc.rx >= 1) { acc.rx--; const p = free(rxp); if (p && drug) { emit(p, rnd(620, 700), 56, 0, 0); p.kind = drug; p.mode = 1; p.op = 1; p.tgt = pick(rxAnchors(drug) || podBase); p.half.setAttribute("fill", RXCOL[drug]); } }
  rxp.forEach((p) => {
    if (!p.on) return;
    if (p.kind !== drug) { p.op -= dt * 2; if (p.op <= 0) { kill(p); return; } p.e.setAttribute("opacity", p.op.toFixed(2)); return; }
    if (p.mode === 1) { const s = Math.min(1, dt * 2.5); p.x += (p.tgt[0] - p.x) * s; p.y += (p.tgt[1] - p.y) * s; p.t += dt;
      if (Math.hypot(p.tgt[0] - p.x, p.tgt[1] - p.y) < 7) { p.mode = 2; p.t = 0; } }
    else { p.t += dt; p.x = p.tgt[0] + Math.sin(tm / 300 + p.tgt[1]) * 1.5; p.y = p.tgt[1] + Math.cos(tm / 340 + p.tgt[0]) * 1.5;
      if (p.t > 4) { p.op -= dt; if (p.op <= 0) { kill(p); return; } } }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.mode === 1 ? p.t * 160 : 20 * Math.sin(tm / 500)) + ")");
    p.e.setAttribute("opacity", p.op.toFixed(2));
  });
  gg.leak.set(sm.leak, wordOf(sm.leak, 0.3, 0.62, ["mild", "heavy", "very heavy"]));
  gg.alb.set(sm.albumin, wordOf(sm.albumin, 0.4, 0.7, ["low", "reduced", "near normal"]));
  gg.oed.set(sm.oedema, wordOf(sm.oedema, 0.3, 0.62, ["none", "present", "marked"]));
  gg.lip.set(sm.lipids, wordOf(sm.lipids, 0.35, 0.65, ["normal", "raised", "high"]));
  gg.clot.set(sm.clot, wordOf(sm.clot, 0.3, 0.62, ["low", "raised", "high"]));
  gg.inf.set(sm.infection, wordOf(sm.infection, 0.3, 0.62, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
