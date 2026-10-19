/* Atherosclerosis scene: heart-fed artery, LDL entry and oxidation, monocytes and foam cells, smooth muscle cap, core, rupture and clot. */
const TOP = 198, BOT = 318, CX = 610, PW = 115, AX0 = 262, AX1 = 936;
const L = { art: $("art"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
const bumpH = () => 6 + 52 * sm.Bulk;
const prof = (x) => { const u = (x - CX) / PW; return Math.abs(u) < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * u) : 0; };
const surf = (x) => BOT - bumpH() * prof(x);
const sm = { Ldl: 0.4, Ox: 0.3, Foam: 0.3, Core: 0.2, Cap: 0.5, Smc: 0.4, Bulk: 0.4, Vuln: 0.3, Rupt: 0, Thr: 0, Narrow: 0.3, Flow: 0.7, Endo: 0.4, stat: 0, ap: 0, risk: 0 };
const gg = {};
let art = {}, rbcs = [], foam = [], smcCap = [], monos = [], endoTop = [], aortaXY = [132, 130], inletXY = [AX0, 258], trFeed = null;
let capEl = null, capDrug = -1, heartO = null;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const ldlP = pool(26, () => mk("circle", { class: "sc-p p-ldl", r: 3 }, L.parts));
const oxP = pool(18, () => mk("path", { class: "sc-p p-ox", d: "M0 -3.2L3.2 0L0 3.2L-3.2 0Z" }, L.parts));
const pltP = pool(16, () => mk("ellipse", { class: "sc-p p-plt", rx: 4.4, ry: 2.6 }, L.parts));
const statP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "at-rxA", x: -5, y: -2.6, width: 10, height: 5.2, rx: 2.6 }, g); mk("rect", { class: "at-rxB", x: 0, y: -2.6, width: 5, height: 5.2, rx: 2.6 }, g); return g; });
const acc = { ldl: 0, ox: 0, plt: 0 };
function capText(d) {
  if (d === 1) return "Statin lowers LDL in the blood. Less enters, the core shrinks and the cap steadies.";
  if (d === 2) return "Antiplatelet coats platelets. The clot after rupture stays smaller.";
  if (d === 3) return "Risk factor control calms the lining. Less LDL enters and less is oxidised.";
  if (d === 4) return "Combined treatment. The plaque shrinks, the cap steadies and the clot stays small.";
  return "No treatment. LDL enters the wall and the plaque grows.";
}

function init() {
  heartO = organ($("heartSlot"), "heart", 132, 238, 150, {});
  const ap = heartO.ports.aorta || heartO.ports.out;
  aortaXY = [ap[0], ap[1]];
  inletXY = [AX0, TOP + (BOT - TOP) / 2];
  $("feed").setAttribute("d", "M" + f1(aortaXY[0]) + " " + f1(aortaXY[1])
    + " C" + f1(aortaXY[0] + 60) + " " + f1(aortaXY[1] + 40) + " " + f1(AX0 - 70) + " " + f1(TOP - 30) + " " + f1(inletXY[0]) + " " + f1(inletXY[1]));
  trFeed = track([aortaXY, [aortaXY[0] + 60, aortaXY[1] + 40], [AX0 - 70, TOP - 30], inletXY]);
  let ib = ""; for (let x = AX0; x <= AX1; x += 8) ib += (x === AX0 ? "M" : "L") + x + " " + TOP; $("inj").setAttribute("d", ib);
  art.lum = mk("rect", { class: "at-lum", x: AX0, y: TOP, width: AX1 - AX0, height: BOT - TOP }, L.art);
  art.wallT = mk("rect", { class: "at-wall", x: AX0, y: 118, width: AX1 - AX0, height: TOP - 118 }, L.art);
  art.mediaT = mk("rect", { class: "at-media", x: AX0, y: 132, width: AX1 - AX0, height: 34 }, L.art);
  art.wallB = mk("path", { class: "at-wall" }, L.art);
  art.plaque = mk("path", { class: "at-plaque" }, L.art);
  art.core = mk("ellipse", { class: "at-core", cx: CX, cy: BOT + 14, rx: 55, ry: 13 }, L.art);
  const fg = mk("g", {}, L.cells);
  [[-58, 2], [-36, 12], [-14, 3], [8, 13], [30, 4], [52, 12], [66, 5]].forEach(([u, v], i) => { const g = cell(fg, { cls: "foam", r: 7, nuc: 0.28, seed: i + 3, wob: 0.08, n: 8 }); mk("circle", { class: "at-vac", cx: -2, cy: -1, r: 2.2 }, g); foam.push({ g, u, v }); });
  [[-42], [-6], [34]].forEach(([u], i) => { const g = cell(fg, { cls: "smc", r: 6.5, nuc: 0.3, seed: i + 11, wob: 0.1, n: 8 }); smcCap.push({ g, u }); });
  art.capL = mk("path", { class: "at-cap" }, L.art); art.capR = mk("path", { class: "at-cap" }, L.art);
  art.thr = mk("path", { class: "at-thr" }, L.art);
  art.intT = mk("path", { class: "at-intima", d: "M" + AX0 + " " + TOP + "H" + AX1 }, L.art);
  art.intB = mk("path", { class: "at-intima" }, L.art);
  const eg = mk("g", {}, L.cells);
  for (let i = 0; i < 20; i++) { const g = cell(eg, { cls: "endo2", r: 13, nuc: 0.3, seed: i + 5, wob: 0.06, n: 8 }); endoTop.push({ g, x: AX0 + (i + 0.5) * ((AX1 - AX0) / 20) }); }
  const mg = mk("g", {}, L.cells);
  for (let i = 0; i < 8; i++) { const g = cell(mg, { cls: "smc", r: 9, nuc: 0.32, seed: i + 30, wob: 0.1, n: 8 }); place(g, AX0 + 60 + i * 78, i % 2 ? 384 : 362, i * 18, 1); }
  const rg = mk("g", {}, L.cells);
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(AX0, AX1), y: rnd(0.08, 0.9), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  const ng = mk("g", {}, L.cells);
  for (let i = 0; i < 4; i++) { const g = cell(ng, { cls: "mono", r: 10, nuc: 0.45, seed: i + 21, wob: 0.12 }); monos.push({ g, i }); }
  const o = L.over;
  pill(o, "Heart", 132, 150, 120, 92, "Heart: every beat pumps blood, carrying LDL and platelets, into the arteries. This artery is one branch of that flow.");
  pill(o, "Artery", 330, 172, 320, 92, "Artery cut open along its length. Blood flows left to right. Risk factors injure the lining, letting LDL and monocytes enter the wall.");
  pill(o, "LDL", 480, 226, 505, 92, "Low-density lipoprotein carried in the blood. It enters the wall and is retained there. A statin blocks this entry.");
  pill(o, "Foam cells", CX - 40, 352, 200, 424, "Macrophages stuffed with oxidised LDL, grown from monocytes that entered the wall. Foam cells build the fatty streak and feed the core when they die.");
  pill(o, "Lipid core", CX + 10, 366, 380, 424, "The necrotic lipid core: dead foam cells and free lipid. A large core under a thin cap makes a plaque vulnerable.");
  pill(o, "Fibrous cap", CX, 344, 560, 424, "Smooth muscle cells migrate into the wall and lay down collagen, forming the fibrous cap. Thick means stable, thin means vulnerable, broken means rupture.");
  pill(o, "Clot", CX, 316, 760, 424, "Platelets and fibrin clot on the ruptured cap. It can narrow or block the artery. An antiplatelet drug coats platelets so the clot stays smaller.");
  capEl = $("capline"); capEl.textContent = capText(0);
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The artery";
  [["ldl", "LDL entry", "g-ldl", "How much LDL is entering and being retained in the wall. A statin and risk factor control bring this down."], ["ox", "Oxidised LDL", "g-ox", "LDL changed by oxidation in the wall. It is what macrophages take up to become foam cells."], ["foam", "Foam cells", "g-foam", "Macrophages loaded with oxidised LDL. They build the fatty streak and feed the core when they die."], ["core", "Lipid core", "g-core", "The necrotic lipid core under the cap. Bigger means more vulnerable."], ["cap", "Cap strength", "g-good", "Thickness and strength of the fibrous cap made by smooth muscle cells. Thick is stable, thin is vulnerable."], ["clot", "Clot", "g-clot", "Platelet and fibrin clot after the cap ruptures. An antiplatelet drug keeps it smaller."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Ldl", "Ox", "Foam", "Core", "Cap", "Smc", "Bulk", "Vuln", "Rupt", "Thr", "Narrow", "Flow", "Endo", "stat", "ap", "risk"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "Flow" || q === "Narrow" ? k1 : k2); });
  let wb = "M" + AX0 + " " + (BOT + 84) + "L" + AX0 + " " + BOT; for (let x = AX0; x <= AX1; x += 6) wb += "L" + x + " " + f1(surf(x)); wb += "L" + AX1 + " " + BOT + "L" + AX1 + " " + (BOT + 84) + "Z"; art.wallB.setAttribute("d", wb);
  let ib = ""; for (let x = AX0; x <= AX1; x += 6) ib += (x === AX0 ? "M" : "L") + x + " " + f1(surf(x)); art.intB.setAttribute("d", ib);
  let pq = "M" + (CX - PW - 10) + " " + (BOT + 30); for (let x = CX - PW - 10; x <= CX + PW + 10; x += 6) pq += "L" + x + " " + f1(surf(x)); pq += "L" + (CX + PW + 10) + " " + (BOT + 30) + "Z"; art.plaque.setAttribute("d", pq);
  art.plaque.setAttribute("opacity", clamp(0.25 + sm.Bulk).toFixed(2));
  art.core.setAttribute("rx", f1(58 * clamp(sm.Core * 1.4))); art.core.setAttribute("ry", f1(13 * clamp(sm.Core * 1.4))); art.core.setAttribute("opacity", clamp(sm.Core * 1.6).toFixed(2));
  foam.forEach((fc) => { const x = CX + fc.u; place(fc.g, x, surf(x) + 14 + fc.v, 0, clamp(sm.Foam * 1.1)); fc.g.style.opacity = sm.Foam > 0.12 ? 1 : 0; });
  smcCap.forEach((sc) => { const x = CX + sc.u; place(sc.g, x, surf(x) + 7, 0, clamp(sm.Smc)); sc.g.style.opacity = sm.Smc > 0.15 ? 1 : 0; });
  const gap = sm.Rupt > 0.04 ? 6 + sm.Rupt * 34 : 0, cw = (2 + sm.Cap * 7).toFixed(1);
  const capD = (xa, xb) => { let d = ""; for (let x = xa; x <= xb; x += 5) d += (x === xa ? "M" : "L") + x + " " + f1(surf(x) - 0.5); return d; };
  art.capL.setAttribute("d", capD(CX - PW, gap ? CX - gap : CX + PW)); art.capR.setAttribute("d", gap ? capD(CX + gap, CX + PW) : "");
  art.capL.setAttribute("stroke-width", cw); art.capR.setAttribute("stroke-width", cw);
  const th = sm.Thr * 46; let td = "M" + (CX - 88) + " " + f1(surf(CX - 88)); for (let x = CX - 88; x <= CX + 88; x += 6) { const u = (x - CX) / 88; td += "L" + x + " " + f1(surf(x) - th * Math.max(0, 1 - u * u)); } td += "L" + (CX + 88) + " " + f1(surf(CX + 88)) + "Z"; art.thr.setAttribute("d", td); art.thr.setAttribute("opacity", clamp(sm.Thr * 1.5).toFixed(2));
  $("inj").setAttribute("opacity", clamp(sm.Endo * 1.1).toFixed(2));
  endoTop.forEach((e, i) => { place(e.g, e.x, TOP - 2 + Math.sin(tm / 900 + i) * 0.7, 0, 1); e.g.style.setProperty("--act", sm.Endo.toFixed(2)); });
  monos.forEach((mo) => { const tt = ((tm / 7000) + mo.i / 4) % 1, x = 340 + tt * 200, y = 242 + tt * tt * 52 + Math.sin(tm / 500 + mo.i * 2) * 3; place(mo.g, x, y, Math.sin(tm / 600 + mo.i) * 10, 0.6 + 0.4 * sm.Foam); mo.g.style.opacity = (0.35 + 0.65 * clamp(sm.Foam + sm.Endo * 0.4)).toFixed(2); });
  const vf = 58 * clamp(sm.Flow + 0.12);
  rbcs.forEach((r) => { r.x += r.v * vf * dt; if (r.x > AX1 + 10) { r.x = AX0 - 10; r.y = rnd(0.08, 0.9); } const topY = TOP + 10, botY = Math.max(topY + 6, surf(r.x) - th * 0.7 - 12); place(r.g, r.x, topY + r.y * (botY - topY), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* statin capsules park along the entry zone and block LDL */
  statP.forEach((p, i) => { if (sm.stat > 0.05) { const x = CX - 80 + (i % 5) * 40, y = surf(x) - 6 - Math.floor(i / 5) * 12; place(p.e, x, y, Math.sin(tm / 700 + i * 2) * 10, 1); p.e.setAttribute("opacity", sm.stat.toFixed(2)); } else p.e.setAttribute("opacity", "0"); });
  acc.ldl += dt * sm.Ldl * 7; while (acc.ldl >= 1) { acc.ldl--; const p = free(ldlP); if (p) emit(p, AX0 + 4, rnd(TOP + 22, BOT - 46), rnd(46, 64), 0, Math.random() < 0.55 ? 1 : 0); }
  ldlP.forEach((p) => { if (!p.on || p.k === 2) return; p.t += dt; p.x += p.vx * dt; if (p.k === 1 && p.x > CX - 95 && p.x < CX + 35) { p.y += 40 * dt; if (p.y > surf(p.x) + 16) { if (sm.stat > 0.5) { p.k = 2; } else { kill(p); return; } } } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > AX1 - 4 || p.t > 9) kill(p); });
  /* blocked LDL bounces off the statin guarded wall and rejoins the flow */
  ldlP.forEach((p) => { if (!p.on || p.k !== 2) return; p.t += dt; p.y -= 60 * dt; p.x += 30 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < TOP + 16) { p.k = 0; p.y = TOP + 16; } if (p.x > AX1 - 4 || p.t > 9) kill(p); });
  acc.ox += dt * sm.Ox * 5; while (acc.ox >= 1) { acc.ox--; const p = free(oxP); if (p) { const x = CX + rnd(-72, 72); emit(p, x, surf(x) + rnd(10, 22), rnd(-5, 5), rnd(-3, 3), 0); } }
  oxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, CX - 88, CX + 88); p.y = clamp(p.y + p.vy * dt, surf(p.x) + 6, BOT + 22); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  /* platelets ride the flow; they pile onto the rupture unless coated by antiplatelet */
  acc.plt += dt * (2 + 5 * clamp(sm.Rupt * 2)); while (acc.plt >= 1) { acc.plt--; const p = free(pltP); if (p) { emit(p, AX0 + 4, rnd(TOP + 14, BOT - 30), rnd(52, 70), 0, 0); p.e.setAttribute("class", sm.ap > 0.5 ? "sc-p p-pltC" : "sc-p p-plt"); } }
  pltP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt;
    if (p.k === 0 && gap && p.x > CX - gap - 30 && p.x < CX + gap + 30 && Math.random() < (sm.ap > 0.5 ? 0.004 : 0.05)) { p.k = 1; p.t = 0; p.x = CX + rnd(-gap, gap); p.y = surf(p.x) - rnd(4, th + 10); }
    if (p.k === 0) p.e.setAttribute("class", sm.ap > 0.5 ? "sc-p p-pltC" : "sc-p p-plt");
    if (p.k === 1) { p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 600 + p.x) * 1.5) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); return; }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 500 + p.x) * 3) + ")"); if (p.x > AX1 - 4 || p.t > 9) kill(p); });
  gg.ldl.set(sm.Ldl, wordOf(sm.Ldl, 0.3, 0.6, ["low", "entering", "high"])); gg.ox.set(sm.Ox, wordOf(sm.Ox, 0.25, 0.55, ["low", "present", "high"])); gg.foam.set(sm.Foam, wordOf(sm.Foam, 0.3, 0.6, ["few", "building", "many"]));
  gg.core.set(sm.Core, wordOf(sm.Core, 0.25, 0.55, ["small", "growing", "large"])); gg.cap.set(sm.Cap, wordOf(sm.Cap, 0.3, 0.6, ["thin", "medium", "thick"])); gg.clot.set(sm.Thr, wordOf(sm.Thr, 0.12, 0.45, ["none", "small", "large"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
