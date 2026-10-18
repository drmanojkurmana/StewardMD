/* Atherosclerosis scene: LDL entry and oxidation, monocytes and foam cells, smooth muscle cap, core, rupture and clot. */
const TOP = 198, BOT = 318, CX = 480, PW = 110, AX0 = 24, AX1 = 936;
const L = { art: $("art"), parts: $("parts"), cells: $("cells"), over: $("over"), panel: $("panel") };
const bumpH = () => 6 + 52 * sm.Bulk;
const prof = (x) => { const u = (x - CX) / PW; return Math.abs(u) < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * u) : 0; };
const surf = (x) => BOT - bumpH() * prof(x);
const sm = { Ldl: 0.4, Ox: 0.3, Foam: 0.3, Core: 0.2, Cap: 0.5, Smc: 0.4, Bulk: 0.4, Vuln: 0.3, Rupt: 0, Thr: 0, Narrow: 0.3, Flow: 0.7, Endo: 0.4, stat: 0, ap: 0, risk: 0 };
const gg = {};
let art = {}, marks = {}, rbcs = [], foam = [], smcCap = [], monos = [], endoTop = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const ldlP = pool(26, () => mk("circle", { class: "sc-p p-ldl", r: 3 }, L.parts));
const oxP = pool(18, () => mk("path", { class: "sc-p p-ox", d: "M0 -3.2L3.2 0L0 3.2L-3.2 0Z" }, L.parts));
const xmark = (parent, x, y, id) => { const g = mk("g", { id, opacity: "0" }, parent); mk("circle", { class: "at-xc", cx: x, cy: y, r: 8 }, g); mk("path", { class: "at-xp", d: "M" + (x - 4) + " " + (y - 4) + "L" + (x + 4) + " " + (y + 4) + "M" + (x + 4) + " " + (y - 4) + "L" + (x - 4) + " " + (y + 4) }, g); return g; };
const acc = { ldl: 0, ox: 0 };

function init() {
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
  for (let i = 0; i < 24; i++) { const g = cell(eg, { cls: "endo2", r: 13, nuc: 0.3, seed: i + 5, wob: 0.06, n: 8 }); endoTop.push({ g, x: AX0 + (i + 0.5) * ((AX1 - AX0) / 24) }); }
  const mg = mk("g", {}, L.cells);
  for (let i = 0; i < 10; i++) { const g = cell(mg, { cls: "smc", r: 9, nuc: 0.32, seed: i + 30, wob: 0.1, n: 8 }); place(g, 70 + i * 88, i % 2 ? 382 : 360, i * 18, 1); }
  const rg = mk("g", {}, L.cells);
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(AX0, AX1), y: rnd(0.08, 0.9), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  const ng = mk("g", {}, L.cells);
  for (let i = 0; i < 4; i++) { const g = cell(ng, { cls: "mono", r: 10, nuc: 0.45, seed: i + 21, wob: 0.12 }); monos.push({ g, i }); }
  marks.stat = xmark(L.art, 365, 238, "x-stat"); marks.ap = xmark(L.art, 518, 262, "x-ap"); marks.risk = xmark(L.art, 620, 196, "x-risk");
  const o = L.over;
  pill(o, "Endothelium", 200, TOP, 150, 92, "The single-cell lining of the artery. Injury and risk factors make it sticky and leaky, so LDL and monocytes can enter.");
  pill(o, "LDL", 365, 238, 310, 92, "Low-density lipoprotein cholesterol carried in the blood. It enters the wall and is retained there. A statin lowers this entry.");
  pill(o, "Monocyte", 430, 248, 470, 92, "A white blood cell that follows signals into the wall, becomes a macrophage and takes up oxidised LDL.");
  pill(o, "Foam cell", CX - 40, BOT + 10, 140, 424, "A macrophage stuffed with oxidised LDL. Foam cells build the fatty streak and, when they die, feed the necrotic lipid core.");
  pill(o, "Lipid core", CX + 10, BOT + 16, 310, 424, "The necrotic lipid core: dead foam cells and free lipid. A large core under a thin cap makes a plaque vulnerable.");
  pill(o, "Fibrous cap", CX, BOT - 30, 480, 424, "Smooth muscle cells migrate into the intima and lay down collagen, forming the fibrous cap. Thick means stable, thin means vulnerable, broken means rupture.");
  pill(o, "Smooth muscle", 590, 368, 650, 424, "Smooth muscle cells from the media. They migrate toward the surface and make the collagen of the fibrous cap.");
  pill(o, "Thrombus", 515, 262, 830, 424, "Platelets and fibrin clot on the ruptured cap. It can narrow or block the artery. An antiplatelet drug makes this clot smaller.");
  const ps = pill(o, "Statin", 365, 238, 600, 92, "A statin lowers LDL, so less enters and less is oxidised, the core grows more slowly and the cap is steadier."); ps.setAttribute("id", "p-stat"); ps.style.opacity = 0;
  const pa = pill(o, "Antiplatelet", 518, 262, 712, 92, "An antiplatelet drug stops platelets clumping, so the clot after rupture stays smaller. It does not shrink the plaque."); pa.setAttribute("id", "p-ap"); pa.style.opacity = 0;
  const pr = pill(o, "Risk control", 620, TOP, 856, 92, "Risk factor control: not smoking and controlling blood pressure, blood sugar and lipids. Less endothelial injury and less oxidation."); pr.setAttribute("id", "p-risk"); pr.style.opacity = 0;
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
  endoTop.forEach((e, i) => { place(e.g, e.x, TOP - 2 + Math.sin(tm / 900 + i) * 0.7, 0, 1); e.g.style.setProperty("--act", sm.Endo.toFixed(2)); });
  monos.forEach((mo) => { const tt = ((tm / 7000) + mo.i / 4) % 1, x = 280 + tt * 175, y = 242 + tt * tt * 52 + Math.sin(tm / 500 + mo.i * 2) * 3; place(mo.g, x, y, Math.sin(tm / 600 + mo.i) * 10, 0.6 + 0.4 * sm.Foam); });
  const vf = 58 * clamp(sm.Flow + 0.12);
  rbcs.forEach((r) => { r.x += r.v * vf * dt; if (r.x > AX1 + 10) { r.x = AX0 - 10; r.y = rnd(0.08, 0.9); } const topY = TOP + 10, botY = Math.max(topY + 6, surf(r.x) - th * 0.7 - 12); place(r.g, r.x, topY + r.y * (botY - topY), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.ldl += dt * sm.Ldl * 7; while (acc.ldl >= 1) { acc.ldl--; const p = free(ldlP); if (p) emit(p, AX0 + 4, rnd(TOP + 22, BOT - 46), rnd(46, 64), 0, Math.random() < 0.55 ? 1 : 0); }
  ldlP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; if (p.k === 1 && p.x > CX - 95 && p.x < CX + 35) { p.y += 40 * dt; if (p.y > surf(p.x) + 16) { kill(p); return; } } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > AX1 - 4 || p.t > 9) kill(p); });
  acc.ox += dt * sm.Ox * 5; while (acc.ox >= 1) { acc.ox--; const p = free(oxP); if (p) { const x = CX + rnd(-72, 72); emit(p, x, surf(x) + rnd(10, 22), rnd(-5, 5), rnd(-3, 3), 0); } }
  oxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, CX - 88, CX + 88); p.y = clamp(p.y + p.vy * dt, surf(p.x) + 6, BOT + 22); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6) kill(p); });
  marks.stat.setAttribute("opacity", sm.stat.toFixed(2)); marks.ap.setAttribute("opacity", sm.ap.toFixed(2)); marks.risk.setAttribute("opacity", sm.risk.toFixed(2));
  $("p-stat").style.opacity = sm.stat.toFixed(2); $("p-ap").style.opacity = sm.ap.toFixed(2); $("p-risk").style.opacity = sm.risk.toFixed(2);
  gg.ldl.set(sm.Ldl, wordOf(sm.Ldl, 0.3, 0.6, ["low", "entering", "high"])); gg.ox.set(sm.Ox, wordOf(sm.Ox, 0.25, 0.55, ["low", "present", "high"])); gg.foam.set(sm.Foam, wordOf(sm.Foam, 0.3, 0.6, ["few", "building", "many"]));
  gg.core.set(sm.Core, wordOf(sm.Core, 0.25, 0.55, ["small", "growing", "large"])); gg.cap.set(sm.Cap, wordOf(sm.Cap, 0.3, 0.6, ["thin", "medium", "thick"])); gg.clot.set(sm.Thr, wordOf(sm.Thr, 0.12, 0.45, ["none", "small", "large"]));
}
run({ init, step });
