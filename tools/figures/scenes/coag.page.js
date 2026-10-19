/* Coagulation scene: a torn vessel with platelet plug and fibrin, the clotting cascade, small vessels in DIC, and the gauges. */
const L = { ves: $("vesSlot"), inj: $("inj"), mini: $("mini"), casc: $("casc"), over: $("over"), panel: $("panel") };
let VTOP = 75, VBOT = 330, wallX = 194;
const VX = 150;
const sm = { Cf: 0.5, pl: 0, thr: 0, M: 0, Pl: 1, Fg: 1, Bl: 0.1, Th: 0.1, ext: 0, intr: 0, X: 0, F: 1, T: 0.5, hep: 0, warf: 0, doac: 0, apl: 0, cause: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
let vesO = null, tearG = null;
const gg = {};
let rbcs = [], plts = [], slots = [], links = [], strands = [], tfs = [], vwfs = [], dd, plm, repP, nodes = {}, edges = [], marks = {}, kdots = {}, hepD = [], doacD = [], aplD = [], schists = [], clots = [], bleed;
/* ---- torn vessel: real vessel anatomy, with the tear and the plug mound on its wall ---- */
function initInjury() {
  vesO = organ(L.ves, "vessel", VX, 200, 110, {});
  const P = vesO.ports;
  VTOP = Math.round(P.lumen[1]) + 2; VBOT = Math.round(P.out[1]) - 7; wallX = Math.round(P.wall[0]);
  tearG = mk("g", {}, L.inj);
  mk("polygon", { class: "cg-tear", points: f1(wallX - 8) + ",156 " + f1(wallX + 8) + ",156 " + f1(wallX + 1) + ",180 " + f1(wallX + 8) + ",204 " + f1(wallX - 8) + ",204" }, tearG);
  mk("path", { class: "cg-col", d: "M" + f1(wallX + 3) + " 158c8 6-8 12 0 18c8 6-8 12 0 18c8 6-8 12 0 18" }, tearG);
  for (let i = 0; i < 5; i++) { const y = 162 + i * 10, p = mk("path", { class: "cg-tf", d: "M" + f1(wallX + 7) + " " + y + "l4 4l-4 4l-4 -4Z" }, tearG); tfs.push(p); }
  for (let i = 0; i < 6; i++) { const y = 160 + i * 8; vwfs.push(mk("path", { class: "cg-vwf", d: "M" + f1(wallX + 2) + " " + y + "q6 2 12 0" }, tearG)); }
  /* red cells drift down the lumen */
  const rg = mk("g", {}, L.inj);
  for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.6 }, g); rbcs.push({ g, x: rnd(VX - 14, VX + 14), y: rnd(VTOP, VBOT), v: rnd(0.8, 1.2) }); }
  /* plug slots: a mound growing out from the tear */
  const cols = [[8, 0], [7, 1], [6, 2], [5, 3], [3, 4]];
  cols.forEach(([n, c]) => { const x = wallX + 16 + c * 14; for (let i = 0; i < n; i++) slots.push({ x, y: 180 + (i - (n - 1) / 2) * 9.5, c }); });
  slots.forEach((s, i) => { s.nb = -1; s.up = -1;
    for (let j = i - 1; j >= 0; j--) if (slots[j].c === s.c) { s.nb = j; break; }
    for (let j = i - 1; j >= 0; j--) if (slots[j].c === s.c - 1 && Math.abs(slots[j].y - s.y) < 11) { s.up = j; break; } });
  const lg = mk("g", {}, L.inj);
  slots.forEach((s, i) => { ["nb", "up"].forEach((k) => { if (s[k] >= 0) links.push({ e: mk("path", { class: "cg-link", d: "M" + f1(s.x) + " " + f1(s.y) + "L" + f1(slots[s[k]].x) + " " + f1(slots[s[k]].y) }, lg), i }); }); });
  const fg = mk("g", {}, L.inj);
  for (let i = 0; i < 30; i++) { const a = slots[Math.floor(rnd(0, slots.length))], b = slots[Math.floor(rnd(0, slots.length))];
    strands.push({ e: mk("path", { class: "cg-fib", d: "M" + f1(a.x + rnd(-6, 6)) + " " + f1(a.y - 8) + "L" + f1(b.x + rnd(-10, 10)) + " " + f1(b.y + 8) }, fg), th: i / 30 }); }
  const pg = mk("g", {}, L.inj);
  for (let i = 0; i < 30; i++) { const g = mk("g", {}, pg), c = cell(g, { cls: "plt", r: 5, seed: i, wob: 0.16, n: 7 }); const sp = mk("path", { class: "cg-spike", opacity: "0", d: "M-8 0L-4 0M8 0L4 0M0 -8L0 -4M0 8L0 4M-6 -6L-3 -3M6 6L3 3M6 -6L3 -3M-6 6L-3 3" }, g);
    const bx = rnd(VX - 12, VX + 12), y = rnd(80, 325);
    plts.push({ g, sp, bx, y, px: bx, py: y, v: rnd(0.9, 1.15), k: 0, ph: rnd(0, 6) }); }
  dd = pool(12, () => mk("rect", { class: "sc-p p-dd", x: -2, y: -2, width: 4, height: 4, rx: 1 }, L.inj));
  plm = pool(5, () => mk("circle", { class: "sc-p p-plm", r: 2.6 }, L.inj));
  /* drug blockers parked on their targets: heparin on Xa and thrombin, DOAC on Xa, antiplatelet on the plug */
  [[648, 253], [660, 252], [672, 253], [642, 309], [660, 307], [678, 309]].forEach(([x, y]) => { hepD.push(mk("circle", { class: "sc-p p-hep", r: 3, opacity: "0", cx: x, cy: y }, L.casc)); });
  [[640, 253], [680, 253], [640, 271], [680, 271]].forEach(([x, y]) => { doacD.push(mk("circle", { class: "sc-p p-doac", r: 4.5, opacity: "0", cx: x, cy: y }, L.casc)); });
  [0, 5, 10, 15, 20, 25].forEach((i) => { const s = slots[i]; aplD.push(mk("path", { class: "sc-p p-apl", d: "M0 -4L3.2 0L0 4L-3.2 0Z", opacity: "0", transform: "translate(" + f1(s.x) + " " + f1(s.y - 9) + ")" }, L.inj)); });
  repP = pool(12, () => { const g = mk("g", {}, L.inj); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
}
/* ---- cascade ---- */
const NODES = [["tf", "TF + VIIa", 560, 100, 1, "Tissue factor from the damaged tissue binds factor VIIa. This begins the extrinsic arm, which the PT test follows."],
  ["xii", "XII", 770, 100, 0, "Factor XII: contact activation begins the intrinsic arm, which the aPTT test follows."], ["xi", "XI", 770, 152, 0, "Factor XI, activated by XIIa (and later by thrombin)."],
  ["ix", "IXa + VIIIa", 770, 204, 1, "Factors IX and VIII together turn on factor X. Missing VIII or IX is haemophilia A or B."],
  ["x", "Xa + Va", 660, 262, 1, "The common arm. Factor X with V (prothrombinase) makes thrombin. Heparin and the direct oral anticoagulants that block Xa act here."],
  ["ii", "Thrombin (IIa)", 660, 318, 1, "Thrombin: the central enzyme. It makes fibrin, activates platelets and factors V, VIII, XI and XIII. Heparin (through antithrombin) and the direct thrombin inhibitors act here."],
  ["fg", "Fibrinogen to fibrin", 560, 378, 0, "Soluble fibrinogen becomes fibrin strands that weave into a mesh."], ["xiii", "XIIIa crosslinks", 780, 378, 0, "Factor XIII cross-links fibrin so the clot is firm and stable."]];
const EDGES = [["tf", "x", 560, 114, 660, 248], ["xii", "xi", 770, 114, 770, 138], ["xi", "ix", 770, 166, 770, 190], ["ix", "x", 770, 218, 690, 248], ["x", "ii", 660, 276, 660, 304], ["ii", "fg", 640, 332, 580, 364], ["ii", "xiii", 690, 332, 760, 364]];
function initCascade() {
  /* brackets for the PT and aPTT arms */
  mk("path", { class: "cg-br pt", d: "M506 90V332" }, L.casc); mk("path", { class: "cg-br ap", d: "M922 90V332" }, L.casc);
  EDGES.forEach((e) => { const p = mk("path", { class: "cg-ar", d: "M" + e[2] + " " + e[3] + "L" + e[4] + " " + e[5] }, L.casc); edges.push({ p, a: e[0], off: 0 }); });
  mk("path", { class: "cg-fb", d: "M708 320C860 310 850 200 800 158" }, L.casc);
  NODES.forEach(([id, t, x, y, vk, tip]) => { const w = Math.max(70, t.length * 7 + 18), g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.casc);
    const r = mk("rect", { class: "cg-node", x: x - w / 2, y: y - 14, width: w, height: 28, rx: 9 }, g); const tx = mk("text", { class: "cg-nt", x, y: y + 4, "text-anchor": "middle" }, g); tx.textContent = t;
    if (vk) kdots[id] = mk("circle", { class: "cg-vk", cx: x + w / 2 - 2, cy: y - 14, r: 7 }, g);
    nodes[id] = { r, x, y, w }; });
  const xm = (id, x, y) => { const g = mk("g", { opacity: "0" }, L.casc); mk("circle", { class: "cg-xc", cx: x, cy: y, r: 10 }, g); mk("path", { class: "cg-xp", d: "M" + (x - 4.5) + " " + (y - 4.5) + "l9 9M" + (x + 4.5) + " " + (y - 4.5) + "l-9 9" }, g); marks[id] = g; return g; };
  xm("hepx", 722, 262); xm("hepii", 730, 320); xm("doacx", 604, 262); xm("warf7", 616, 100); xm("warf9", 832, 206); xm("warfx", 614, 276); xm("warfii", 714, 334);
}
/* ---- small vessels in DIC ---- */
function initMini() {
  mk("rect", { class: "sc-lum", x: 24, y: 358, width: 442, height: 44 }, L.mini);
  mk("rect", { class: "cg-wall", x: 24, y: 346, width: 442, height: 12 }, L.mini); mk("rect", { class: "cg-wall", x: 24, y: 402, width: 442, height: 12 }, L.mini);
  const t = mk("text", { class: "sc-zone sc-dim", x: 34, y: 336 }, L.mini); t.textContent = "SMALL VESSELS ELSEWHERE";
  for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.mini); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); const sc = mk("path", { class: "cg-schist", d: "M-6 -4L6 -2L-1 5Z", opacity: "0" }, g); schists.push({ g, sc, x: rnd(30, 460), y: rnd(368, 392), v: rnd(0.8, 1.2), body: g.firstChild }); }
  [[110, 380], [210, 378], [310, 381], [390, 379], [440, 380]].forEach(([x, y], i) => { const g = mk("g", {}, L.mini); for (let j = 0; j < 7; j++) cell(g, { cls: "plt", r: 5 + (j % 3) * 0.6, x: Math.cos(j * 1.3) * 9, y: Math.sin(j * 2.1) * 6, seed: j + i, wob: 0.15, n: 7 }); for (let j = 0; j < 5; j++) mk("path", { class: "cg-fib", d: "M" + f1(rnd(-16, 16)) + " " + f1(rnd(-9, 9)) + "L" + f1(rnd(-16, 16)) + " " + f1(rnd(-9, 9)) }, g); clots.push({ g, x, y, i }); });
  bleed = pool(14, () => mk("path", { class: "sc-p p-bl", d: "M0 -3C2 -.5 2.6 .8 2.6 1.8A2.6 2.6 0 0 1 -2.6 1.8C-2.6 .8 -2 -.5 0 -3Z" }, L.mini));
}
/* ---- labels, caption and gauges ---- */
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Heparin sits on Xa and thrombin. Less fibrin forms.";
  if (d === 2) return "Warfarin lowers vitamin K factors. The cascade runs weak.";
  if (d === 3) return "This drug blocks Xa itself. Thrombin and fibrin fall.";
  if (d === 4) return "Antiplatelet drugs keep platelets from clumping.";
  if (d === 5) return "Cause treated and factors replaced. Micro-clots clear.";
  return "No treatment. The tear seeds a plug and a fibrin mesh.";
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [120, 280, 440, 600, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W_ - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cf", "Clot", "g-clot", "Clot formation at the injury: platelet plug plus fibrin mesh."], ["pl", "Platelets", "g-plt", "Platelet count. Falls when platelets are used up in DIC."], ["fg", "Fibrinogen", "g-fg", "Fibrinogen, the clotting factor that becomes fibrin. Falls in DIC, so clots are weak and bleeding follows."],
    ["bl", "Bleeding risk", "g-bad", "Risk of bleeding: low platelets and fibrinogen, plus anticoagulant or antiplatelet effect."], ["th", "Clotting risk", "g-cyt", "Risk of unwanted clots: micro-clots in DIC, or a strong clotting drive with no treatment."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Torn wall", wallX, 164, 330, 110, "The vessel wall is torn, exposing collagen and tissue factor that begin clotting.");
  pill(ox, "Platelet plug", wallX + 56, 182, 350, 190, "Platelets stick to the tear, switch on and clump through fibrinogen bridges. This plug is primary haemostasis.");
  pill(ox, "Fibrin mesh", wallX + 68, 206, 355, 250, "Thrombin turns fibrinogen into fibrin strands that weave through the plug and hold it firm.");
  pill(ox, "PT arm", 506, 330, 520, 410, "PT follows the tissue factor arm and the common arm. Warfarin lengthens it.");
  pill(ox, "aPTT arm", 922, 330, 880, 410, "aPTT follows the contact arm and the common arm. Heparin lengthens it.");
  pill(ox, "Thrombin makes fibrin", 640, 332, 700, 436, "Thrombin is the central enzyme. It turns fibrinogen into fibrin and switches platelets on.");
  pill(ox, "Micro-clots", 310, 381, 330, 352, "In DIC, tiny clots block small vessels everywhere and use up platelets and factors, so bleeding follows.");
  capEl = mk("text", { class: "cg-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0);
}
const W_ = SC.W;
function init() { initInjury(); initCascade(); initMini(); initPanel(); }
const acc = { dd: 0, plm: 0, bl: 0, rep: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.6);
  ["Cf", "pl", "thr", "M", "Pl", "Fg", "Bl", "Th", "ext", "intr", "X", "F", "T", "hep", "warf", "doac", "apl", "cause"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k2); });
  /* red cells drift down the lumen */
  const flow = 1 - 0.25 * sm.pl;
  rbcs.forEach((r) => { r.y += r.v * 54 * flow * dt; if (r.y > VBOT) { r.y = VTOP; r.x = rnd(VX - 14, VX + 14); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.y) * 10, 1); });
  /* platelets: flowing, or in the plug */
  const n = Math.round(sm.pl * slots.length);
  plts.forEach((p, i) => { const inPlug = i < n; p.k = lerp(p.k, inPlug ? 1 : 0, Math.min(1, dt * 1.6));
    if (p.k < 0.04) { p.y += p.v * 60 * flow * dt; if (p.y > VBOT + 8) { p.y = VTOP; p.bx = rnd(VX - 12, VX + 12); } p.px = p.bx + Math.sin(tm / 700 + p.ph) * 3; p.py = p.y; }
    const s = slots[i % slots.length]; if (inPlug) { p.py = Math.max(p.py, s.y); }
    const x = lerp(p.px, s.x, p.k), y = lerp(p.py, s.y, p.k);
    place(p.g, x, y, tm / 40 * p.k, 1 + 0.35 * p.k); p.sp.setAttribute("opacity", (p.k * (1 - 0.85 * sm.apl)).toFixed(2)); });
  /* the tear heals over once the cause is treated */
  tearG.setAttribute("opacity", (1 - 0.65 * sm.cause).toFixed(2));
  vwfs.forEach((v) => v.setAttribute("opacity", (0.25 + 0.75 * clamp(sm.T * 1.2)).toFixed(2))); tfs.forEach((v) => v.setAttribute("opacity", (0.25 + 0.75 * clamp(sm.T * 1.3 - 0.1)).toFixed(2)));
  links.forEach((l) => l.e.setAttribute("opacity", (l.i < n ? clamp(sm.pl * (1 - 0.8 * sm.apl)) : 0).toFixed(2)));
  strands.forEach((s) => s.e.setAttribute("opacity", (clamp((sm.thr * 1.15 - s.th) * 3.2) * (0.35 + 0.65 * sm.Cf)).toFixed(2)));
  /* fibrinolysis: plasmin dots work on the mesh, D-dimer drifts off */
  acc.dd += dt * sm.thr * 1.6; while (acc.dd >= 1) { acc.dd--; const p = free(dd); if (p) emit(p, rnd(wallX + 16, wallX + 76), rnd(150, 210), rnd(-6, 6), rnd(20, 40), 0); }
  dd.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.vx + 28) * dt; p.y += p.vy * 0.4 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > 340) kill(p); });
  acc.plm += dt * sm.thr * 0.8; while (acc.plm >= 1) { acc.plm--; const p = free(plm); if (p) emit(p, rnd(wallX + 16, wallX + 76), rnd(190, 215), 0, 0, 0); }
  plm.forEach((p) => { if (!p.on) return; p.t += dt; p.x += Math.sin(p.t * 3) * 10 * dt; p.y -= 10 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  /* drug blockers sit on their targets; vitamin K dots fade as warfarin lowers those factors */
  hepD.forEach((e) => e.setAttribute("opacity", sm.hep.toFixed(2)));
  doacD.forEach((e) => e.setAttribute("opacity", sm.doac.toFixed(2)));
  aplD.forEach((e) => e.setAttribute("opacity", sm.apl.toFixed(2)));
  for (const id in kdots) kdots[id].setAttribute("opacity", (1 - 0.7 * sm.warf).toFixed(2));
  /* cascade: node glow and arrow flow */
  const act = { tf: sm.ext, xii: sm.intr, xi: sm.intr * 0.9 + sm.thr * 0.1, ix: sm.intr * (0.5 + 0.5 * sm.F), x: sm.X, ii: sm.thr, fg: sm.thr, xiii: sm.thr * 0.9 };
  for (const id in nodes) nodes[id].r.style.setProperty("--act", clamp(act[id]).toFixed(2));
  edges.forEach((e) => { e.off -= dt * (6 + 36 * clamp(act[e.a])); e.p.setAttribute("stroke-dashoffset", f1(e.off)); e.p.style.opacity = (0.25 + 0.75 * clamp(act[e.a] * 1.3)).toFixed(2); });
  marks.hepx.setAttribute("opacity", sm.hep.toFixed(2)); marks.hepii.setAttribute("opacity", sm.hep.toFixed(2)); marks.doacx.setAttribute("opacity", sm.doac.toFixed(2));
  ["warf7", "warf9", "warfx", "warfii"].forEach((k) => marks[k].setAttribute("opacity", sm.warf.toFixed(2)));
  /* replacement products enter from above when the cause is treated */
  acc.rep += dt * sm.cause * 5; while (acc.rep >= 1) { acc.rep--; const p = free(repP); if (p) { if (Math.random() < 0.5) emit(p, rnd(VX - 10, VX + 10), VTOP - 3, rnd(-4, 4), rnd(70, 95), 0); else emit(p, -8, rnd(365, 395), 78, 0, 1); } }
  repP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); if ((p.k === 0 && p.y > VBOT + 2) || (p.k === 1 && p.x > 460)) kill(p); });
  /* small vessels: micro-clots block flow, red cells fragment, bleeding when platelets and fibrinogen are gone */
  const mflow = clamp(1 - 0.85 * sm.M);
  schists.forEach((s, i) => { s.x += s.v * 48 * mflow * dt; if (s.x > 456) { s.x = 28; s.y = rnd(368, 392); } place(s.g, s.x, s.y, Math.sin(tm / 450 + i) * 12, 1); const f = sm.M > 0.45 && i % 2 === 0; s.sc.setAttribute("opacity", f ? 1 : 0); s.body.setAttribute("opacity", f ? 0 : 1); });
  clots.forEach((c) => { const s = clamp((sm.M - 0.1 * c.i) * 2.2); place(c.g, c.x, c.y, 0, 0.1 + 0.9 * s); c.g.style.opacity = s > 0.4 ? 1 : 0; });
  const ooze = clamp((sm.Bl - 0.3) * 2.2) * clamp(sm.M * 2); acc.bl += dt * ooze * 5; while (acc.bl >= 1) { acc.bl--; const p = free(bleed); if (p) emit(p, rnd(40, 450), 414, rnd(-3, 3), rnd(16, 26), 0); }
  bleed.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  /* gauges */
  gg.cf.set(sm.Cf, wordOf(sm.Cf, 0.3, 0.62, ["weak", "forming", "strong"])); gg.pl.set(sm.Pl, wordOf(sm.Pl, 0.4, 0.75, ["low", "reduced", "normal"])); gg.fg.set(sm.Fg, wordOf(sm.Fg, 0.4, 0.75, ["low", "reduced", "normal"]));
  gg.bl.set(sm.Bl, wordOf(sm.Bl, 0.32, 0.58, ["low", "raised", "high"])); gg.th.set(sm.Th, wordOf(sm.Th, 0.32, 0.58, ["low", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
