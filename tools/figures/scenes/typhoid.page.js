/* Typhoid scene: dirty water, bowel invasion over Peyer patches, macrophage ride to blood, rose spots, ulcer, perforation, gallbladder carrier. */
const layers = { bac: $("bac"), vbac: $("vbac"), rbc: $("rbcs"), macs: $("macs"), parts: $("parts"), rose: $("rose"), gb: $("gbdots"), ulcer: $("ulcer"), over: $("over"), panel: $("panel"), heat: $("heat"), gutHot: $("gutHot") };
let bowelO = null, liverO = null, capEl = null, capDrug = -1;
let coilPt = [305, 220], gallPt = [853, 175];
let trToBlood = null, trSkin = null, trGall = null;
function capText(d) {
  if (d === 1) return "Antibiotic kills bacteria in bowel and blood. Fever, spots and ulcers fade.";
  if (d === 2) return "Fluids alone support the patient. Bacteria stay in the blood.";
  if (d === 3) return "Surgery closes the perforation. It does not clear bacteria elsewhere.";
  return "No treatment. Bacteria spread from bowel to blood and the bowel breaks down.";
}
/* tracks are built in initOrgans from the bowel and liver ports (see below) */
function initOrgans() {
  bowelO = organ($("bowelSlot"), "bowel", 300, 215, 240, {});
  liverO = organ($("liverSlot"), "liver", 845, 145, 170, {});
  coilPt = bowelO.ports.coils; gallPt = liverO.ports.gall;
  const out = bowelO.ports.out;
  trToBlood = track([out, [450, 336], [528, 327]]);
  trSkin = track([[630, 312], [630, 262], [632, 220]]);
  trGall = track([[898, 314], [902, 250], gallPt]);
}
/* ---- bowel bacteria ---- */
const BAC_N = 30, bac = [];
function initBac() { for (let i = 0; i < BAC_N; i++) { const rod = i % 3 === 0, g = mk("g", { class: "cl cl-bac" }, layers.bac);
  mk(rod ? "ellipse" : "circle", rod ? { class: "cl-b", rx: 6, ry: 3.2 } : { class: "cl-b", r: 3.8 }, g);
  bac.push({ g, x: rnd(215, 395), y: rnd(130, 308), a: rnd(0, 6.28), s: 0, rot: rnd(0, 180) }); } }
/* ---- bloodstream bacteria ---- */
const VB_N = 16, vbac = [];
function initVbac() { for (let i = 0; i < VB_N; i++) { const g = mk("g", { class: "cl cl-bac" }, layers.vbac); mk("circle", { class: "cl-b", r: 3.6 }, g); vbac.push({ g, x: rnd(530, 920), y: rnd(312, 342), v: rnd(0.7, 1.3), s: 0 }); } }
/* ---- red cells in the bloodstream ---- */
const rbcs = [];
function initRbc() { for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8.5, ry: 5 }, g); mk("ellipse", { class: "cl-s", rx: 3.2, ry: 1.6 }, g); rbcs.push({ g, x: rnd(520, 940), y: rnd(310, 344), v: rnd(0.8, 1.2), rot: rnd(-18, 18) }); } }
/* ---- macrophages: two in Peyer patches, one travelling in blood ---- */
const macs = [[272, 286], [352, 292]].map(([x, y], i) => { const g = mk("g", {}, layers.macs); cell(g, { cls: "mac", r: 21, nuc: 0.42, seed: i * 3 + 1, wob: 0.13 }); return { g, x, y, ph: i * 2.2 }; });
const bloodMac = (() => { const g = mk("g", {}, layers.macs); cell(g, { cls: "mac", r: 17, nuc: 0.42, seed: 7, wob: 0.13 }); return { g, x: 560, y: 327 }; })();
/* ---- bacteria riding bowel to blood, blood to skin, blood to gallbladder ---- */
const gutRun = [], skinRun = [], gallRun = [];
function initRun() {
  for (let i = 0; i < 4; i++) gutRun.push({ e: mk("circle", { class: "sc-p p-tybac", r: 3.2, opacity: "0" }, layers.parts), u: i / 4 });
  for (let i = 0; i < 4; i++) skinRun.push({ e: mk("circle", { class: "sc-p p-tybac", r: 3, opacity: "0" }, layers.parts), u: i / 4 });
  for (let i = 0; i < 3; i++) gallRun.push({ e: mk("circle", { class: "sc-p p-tybac", r: 3, opacity: "0" }, layers.parts), u: i / 3 });
}
function ride(pl, tr, vis, dt, rate) { pl.forEach((p) => { p.u = (p.u + dt * rate) % 1; const q = tr.at(p.u); p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", vis.toFixed(2)); }); }
/* ---- rose spots and gallbladder bacteria ---- */
const roseSpots = [[585, 105], [625, 135], [665, 100], [700, 140], [600, 175], [655, 180], [695, 185], [630, 200]].map(([x, y]) => { const c = mk("circle", { class: "ty-rose", cx: x, cy: y, r: rnd(5, 8) }, layers.rose); return c; });
const gbDots = [];
function initGb() { [[-10, 30], [4, 38], [-2, 22], [12, 32]].forEach(([dx, dy]) => gbDots.push(mk("circle", { class: "sc-p p-tybac", cx: f1(gallPt[0] + dx), cy: f1(gallPt[1] + dy), r: 3 }, layers.gb))); }
/* ---- ulcer, perforation hole and surgical stitches ---- */
const ulcerG = mk("g", {}, layers.ulcer);
mk("ellipse", { class: "ty-ulcer-rim", cx: 382, cy: 300, rx: 20, ry: 11 }, ulcerG);
const ulcerHole = mk("ellipse", { class: "ty-ulcer-hole", cx: 382, cy: 300, rx: 11, ry: 6 }, ulcerG);
const stitchG = mk("g", { id: "stitches", opacity: "0" }, layers.ulcer);
[-12, 0, 12].forEach((dx) => { mk("path", { class: "ty-stitch", d: "M" + (382 + dx - 5) + " 292L" + (382 + dx + 5) + " 308M" + (382 + dx - 5) + " 308L" + (382 + dx + 5) + " 292" }, stitchG); });
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const pillsRx = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const drops = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const leaks = pool(14, () => mk("circle", { class: "ty-leak", r: 3 }, layers.parts));
const freePl = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bac", "Bacteraemia", "g-bac", "Bacteria circulating in the blood after spreading from the bowel in macrophages."], ["fev", "Fever", "g-bad", "Fever that climbs in steps early on, stays high, then settles as the infection is controlled."], ["rose", "Rose spots", "g-eos", "Faint pink spots on the trunk that appear as bacteria reach the skin in the blood."], ["ulc", "Bowel ulcer", "g-clot", "Ulceration over the Peyer patches of the small bowel as they swell and break down."], ["perf", "Perforation", "g-bad", "A hole through the ulcerated bowel wall, spilling bowel contents and needing urgent surgery."], ["car", "Carrier", "g-fl", "Bacteria sheltering in the gallbladder after recovery, shed on and off in stool."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Dirty water", 82, 117, 84, 64, "Dirty water carries Salmonella Typhi. It survives the stomach and reaches the small bowel.");
  pill(ox, "Skin spots", 640, 135, 635, 64, "Faint pink spots on the trunk. They appear when bacteria in the blood reach the skin.");
  pill(ox, "Gallbladder", gallPt[0] + 5, gallPt[1] + 37, 850, 252, "The gallbladder can shelter Salmonella Typhi after recovery, so carriers shed bacteria in stool.");
  pill(ox, "Small bowel", 195, 240, 175, 368, "Small bowel: Salmonella Typhi invades the lining, mainly over the Peyer patches near its end.");
  pill(ox, "Peyer patch", 332, 302, 300, 408, "Peyer patches: lymphoid tissue in the bowel wall. Macrophages here take up bacteria but fail to kill them, so bacteria ride on.");
  pill(ox, "Ulcer", 382, 300, 430, 368, "Ulceration over a swollen Peyer patch. The surface breaks down and the wall thins.");
  pill(ox, "Bloodstream", 700, 327, 700, 282, "Bloodstream: bacteria carried in macrophages enter the blood and spread to skin and the gallbladder.");
  const pf = pill(ox, "Perforation", 386, 316, 470, 408, "Perforation: the thinned ulcer gives way and bowel contents leak out. This is an emergency needing surgery."); pf.setAttribute("id", "perf-pill");
  capEl = mk("text", { class: "ty-cap", x: 30, y: 434 }, ox); capEl.textContent = capText(0);
}
const sm = { B: 0.4, F: 0.3, R: 0.1, U: 0.1, Pf: 0, Car: 0, abx: 0, flu: 0, surg: 0 };
const acc = { pill: 0, drop: 0, leak: 0 };
function init() { initOrgans(); initBac(); initVbac(); initRbc(); initRun(); initGb(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.B = lerp(sm.B, m.B, k2); sm.F = lerp(sm.F, m.F, k2); sm.R = lerp(sm.R, m.R, k2); sm.U = lerp(sm.U, m.U, k2); sm.Pf = lerp(sm.Pf, m.Pf, k1); sm.Car = lerp(sm.Car, m.Car, k2); sm.abx = lerp(sm.abx, m.abx, k1); sm.flu = lerp(sm.flu, m.flu, k1); sm.surg = lerp(sm.surg, m.surg, k1);
  /* antibiotic shrinks the pathogens it reaches, in bowel and in blood */
  const shr = 1 - 0.72 * sm.abx, dim = (1 - 0.3 * sm.abx).toFixed(2);
  /* bowel bacteria wander inside the bowel and fade as they are killed */
  const want = Math.round((0.35 + 0.65 * sm.B) * BAC_N);
  bac.forEach((b, i) => { const on = i < want; b.s = lerp(b.s, on ? 1 : 0, Math.min(1, dt * (on ? 1.4 : 2.4 + sm.abx * 3)));
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 8 * dt; b.y += Math.sin(b.a) * 8 * dt; b.x = clamp(b.x, 215, 395); b.y = clamp(b.y, 130, 308);
    place(b.g, b.x, b.y, b.rot + Math.sin(tm / 600 + i) * 16, Math.max(0.001, b.s * shr)); b.g.style.opacity = b.s > 0.04 ? dim : 0; });
  /* macrophages bob in the patches; the blood macrophage ferries along the vessel */
  macs.forEach((mm) => place(mm.g, mm.x + Math.sin(tm / 1500 + mm.ph) * 3, mm.y + Math.cos(tm / 1700 + mm.ph) * 2, Math.sin(tm / 2400 + mm.ph) * 6, 1 + 0.05 * sm.B * Math.sin(tm / 300)));
  bloodMac.x += dt * (26 + 30 * sm.B); if (bloodMac.x > 918) bloodMac.x = 548;
  place(bloodMac.g, bloodMac.x, 327 + Math.sin(tm / 700) * 3, Math.sin(tm / 900) * 8, 1); bloodMac.g.style.opacity = sm.B > 0.06 ? 1 : 0;
  /* vessel bacteria and red cells flow; vessel bacteria shrink on antibiotic */
  const vwant = Math.round(sm.B * VB_N);
  vbac.forEach((p, i) => { const on = i < vwant; p.s = lerp(p.s, on ? 1 : 0, Math.min(1, dt * 2)); p.x += p.v * 55 * dt; if (p.x > 935) { p.x = 528; p.y = rnd(312, 342); } place(p.g, p.x, p.y, 0, Math.max(0.001, p.s * shr)); p.g.style.opacity = p.s > 0.04 ? dim : 0; });
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > 945) { r.x = 525; r.y = rnd(310, 344); } place(r.g, r.x, r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* spread dots ride bowel to blood, blood to skin, blood to gallbladder */
  ride(gutRun, trToBlood, 0.15 + 0.85 * sm.B * (1 - 0.5 * sm.abx), dt, 0.22);
  ride(skinRun, trSkin, sm.R, dt, 0.3);
  ride(gallRun, trGall, sm.Car, dt, 0.2);
  /* rose spots, carrier dots, fever heat and bowel inflammation follow their gauges */
  layers.rose.style.opacity = (0.08 + 0.92 * sm.R).toFixed(2);
  layers.gb.style.opacity = (0.1 + 0.9 * sm.Car).toFixed(2);
  gbDots.forEach((d) => d.setAttribute("r", f1(3 * (1 - 0.55 * sm.abx))));
  layers.heat.setAttribute("opacity", (sm.F * 0.5).toFixed(2));
  layers.gutHot.setAttribute("opacity", (sm.U * 0.45).toFixed(2));
  /* ulcer crater and perforation hole grow; stitches appear with surgery */
  const us = 0.25 + 0.75 * sm.U; ulcerG.setAttribute("transform", "translate(" + f1(382 * (1 - us)) + " " + f1(300 * (1 - us)) + ") scale(" + us.toFixed(3) + ")"); ulcerG.style.opacity = sm.U > 0.05 ? 1 : 0;
  stitchG.setAttribute("opacity", (sm.surg * clamp(sm.U * 1.5)).toFixed(2));
  $("perf-pill").style.opacity = sm.Pf > 0.08 || sm.surg > 0.3 ? 1 : 0.25;
  /* antibiotic capsules travel to the bowel coils and into the bloodstream */
  acc.pill += dt * sm.abx * 2.6; while (acc.pill >= 1) { acc.pill--; const p = freePl(pillsRx); if (p) emit(p, rnd(60, 100), 150, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  pillsRx.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 548 : coilPt[0], ty = p.k ? 327 : coilPt[1];
    p.x += (tx - p.x) * dt * 0.55 + 10 * dt; p.y += (ty - p.y) * dt * 0.65;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.5).toFixed(2)); if (p.t > 5) kill(p); });
  /* fluids stream through the vessel */
  acc.drop += dt * sm.flu * 7; while (acc.drop >= 1) { acc.drop--; const p = freePl(drops); if (p) emit(p, 526, rnd(312, 342), 95, 0, 0); }
  drops.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 938) kill(p); });
  /* perforation leak drips below the bowel */
  acc.leak += dt * sm.Pf * 8; while (acc.leak >= 1) { acc.leak--; const p = freePl(leaks); if (p) emit(p, 382 + rnd(-8, 8), 314, rnd(-4, 4), rnd(16, 26), 0); }
  leaks.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* gauges; fever word reflects the stepwise course */
  gg.bac.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["cleared", "present", "high"])); gg.fev.set(sm.F, wordOf(sm.F, 0.3, 0.6, ["settling", "raised", "high"])); gg.rose.set(sm.R, wordOf(sm.R, 0.2, 0.5, ["none", "few", "many"]));
  gg.ulc.set(sm.U, wordOf(sm.U, 0.25, 0.6, ["intact", "swollen", "ulcerated"])); gg.perf.set(sm.Pf, wordOf(sm.Pf, 0.15, 0.4, ["none", "at risk", "leaked"])); gg.car.set(sm.Car, wordOf(sm.Car, 0.2, 0.5, ["unlikely", "possible", "likely"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
