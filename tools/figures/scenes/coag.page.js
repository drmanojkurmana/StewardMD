/* Coagulation scene: platelet plug and fibrin at an injury, the clotting cascade, small vessels in DIC, and the gauges. */
const L = { inj: $("inj"), mini: $("mini"), casc: $("casc"), over: $("over"), panel: $("panel") };
const X0 = 24, X1 = 466, LT = 160, LB = 268, GAP0 = 196, GAP1 = 296, GC = 246;
const sm = { Cf: 0, pl: 0, thr: 0, M: 0, Pl: 1, Fg: 1, Bl: 0.1, Th: 0.1, ext: 0, intr: 0, X: 0, F: 1, T: 0.5, hep: 0, warf: 0, doac: 0, apl: 0, cause: 0 };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
let rbcs = [], plts = [], slots = [], links = [], strands = [], tfs = [], vwfs = [], dd, plm, endo = [], nodes = {}, edges = [], marks = {}, schists = [], clots = [], bleed;
/* ---- injury site ---- */
function initInjury() {
  mk("rect", { class: "sc-lum", x: X0, y: LT, width: X1 - X0, height: LB - LT }, L.inj);
  /* walls: endothelial cells, with a break over the gap */
  for (let x = 38; x < X1; x += 26) { const inGap = x > GAP0 - 8 && x < GAP1 + 8; const g = cell(L.inj, { cls: "endo", r: 11, nuc: 0.3, seed: x, wob: 0.06, n: 8 });
    place(g, x, LT - 12, inGap ? (x < GC ? -28 : 28) : 0, inGap ? 0.8 : 1); if (inGap) { g.setAttribute("opacity", "0.55"); } if (x > GAP0 - 12 && x < GAP1 + 12) { /* damaged edge */ } if (inGap && x > GAP0 + 18 && x < GAP1 - 18) g.setAttribute("opacity", "0"); }
  for (let x = 38; x < X1; x += 26) { const g = cell(L.inj, { cls: "endo", r: 11, nuc: 0.3, seed: x + 5, wob: 0.06, n: 8 }); place(g, x, LB + 12, 0, 1); }
  /* exposed collagen, tissue factor, vWF */
  mk("path", { class: "cg-col", d: "M" + (GAP0 + 6) + " " + (LT - 4) + "q8 -6 16 0t16 0t16 0t16 0t16 0t16 0" }, L.inj);
  for (let i = 0; i < 6; i++) { const x = GAP0 + 14 + i * 15, p = mk("path", { class: "cg-tf", d: "M" + x + " " + (LT - 16) + "l4 4l-4 4l-4 -4Z" }, L.inj); tfs.push(p); }
  for (let i = 0; i < 7; i++) { const x = GAP0 + 10 + i * 13; vwfs.push(mk("path", { class: "cg-vwf", d: "M" + x + " " + (LT - 2) + "l2 8l-2 8" }, L.inj)); }
  /* red cells */
  const rg = mk("g", {}, L.inj);
  for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, rg); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.6 }, g); rbcs.push({ g, x: rnd(X0, X1), y: rnd(LT + 40, LB - 12), v: rnd(0.8, 1.2) }); }
  /* plug slots (mound under the break) */
  const rows = [[8, 7, LT + 8], [7, 8, LT + 19], [6, 9, LT + 30], [5, 10, LT + 41], [3, 12, LT + 51]];
  rows.forEach(([n, dx, y], r) => { for (let i = 0; i < n; i++) slots.push({ x: GC + (i - (n - 1) / 2) * (dx + 4.4), y, r }); });
  slots.forEach((s, i) => { s.nb = i > 0 && slots[i - 1].r === s.r ? i - 1 : -1; s.up = -1; for (let j = i - 1; j >= 0; j--) if (slots[j].r === s.r - 1 && Math.abs(slots[j].x - s.x) < 11) { s.up = j; break; } });
  const lg = mk("g", {}, L.inj);
  slots.forEach((s, i) => { ["nb", "up"].forEach((k) => { if (s[k] >= 0) links.push({ e: mk("path", { class: "cg-link", d: "M" + f1(s.x) + " " + f1(s.y) + "L" + f1(slots[s[k]].x) + " " + f1(slots[s[k]].y) }, lg), i }); }); });
  const fg = mk("g", {}, L.inj);
  for (let i = 0; i < 30; i++) { const a = slots[Math.floor(rnd(0, slots.length))], b = slots[Math.floor(rnd(0, slots.length))], reach = rnd(0, 28);
    strands.push({ e: mk("path", { class: "cg-fib", d: "M" + f1(a.x + rnd(-6, 6)) + " " + f1(a.y - reach * 0.3) + "L" + f1(b.x + rnd(-14, 14)) + " " + f1(b.y + reach * 0.5) }, fg), th: i / 30 }); }
  const pg = mk("g", {}, L.inj);
  for (let i = 0; i < 30; i++) { const g = mk("g", {}, pg), c = cell(g, { cls: "plt", r: 5, seed: i, wob: 0.16, n: 7 }); const sp = mk("path", { class: "cg-spike", opacity: "0", d: "M-8 0L-4 0M8 0L4 0M0 -8L0 -4M0 8L0 4M-6 -6L-3 -3M6 6L3 3M6 -6L3 -3M-6 6L-3 3" }, g);
    plts.push({ g, c, sp, x: rnd(X0, X1), y: rnd(LT + 14, LB - 12), v: rnd(0.9, 1.15), px: 0, py: 0, k: 0, ph: rnd(0, 6) }); }
  dd = pool(12, () => mk("rect", { class: "sc-p p-dd", x: -2, y: -2, width: 4, height: 4, rx: 1 }, L.inj));
  plm = pool(5, () => mk("circle", { class: "sc-p p-plm", r: 2.6 }, L.inj));
}
/* ---- cascade ---- */
const NODES = [["tf", "TF + VIIa", 560, 100, 1, "Tissue factor from the damaged tissue binds factor VIIa. This starts the extrinsic arm, which the PT test follows."],
  ["xii", "XII", 770, 100, 0, "Factor XII: contact activation starts the intrinsic arm, which the aPTT test follows."], ["xi", "XI", 770, 152, 0, "Factor XI, activated by XIIa (and later by thrombin)."],
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
    if (vk) { mk("circle", { class: "cg-vk", cx: x + w / 2 - 2, cy: y - 14, r: 7 }, g); const k = mk("text", { class: "cg-vkt", x: x + w / 2 - 2, y: y - 11.5, "text-anchor": "middle" }, g); k.textContent = "K"; }
    nodes[id] = { r, x, y, w }; });
  const xm = (id, x, y) => { const g = mk("g", { opacity: "0" }, L.casc); mk("circle", { class: "cg-xc", cx: x, cy: y, r: 8 }, g); mk("path", { class: "cg-xp", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); marks[id] = g; return g; };
  xm("hepx", 722, 262); xm("hepii", 718, 318); xm("doacx", 604, 262); xm("doacii", 604, 318); xm("warf7", 616, 100); xm("warf9", 828, 204); xm("warfx", 614, 276); xm("warfii", 714, 334);
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
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [120, 280, 440, 600, 760];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: W_ - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["cf", "Clot", "g-clot", "Clot formation at the injury: platelet plug plus fibrin mesh."], ["pl", "Platelets", "g-plt", "Platelet count. Falls when platelets are used up in DIC."], ["fg", "Fibrinogen", "g-fg", "Fibrinogen, the clotting factor that becomes fibrin. Falls in DIC, so clots are weak and bleeding follows."],
    ["bl", "Bleeding risk", "g-bad", "Risk of bleeding: low platelets and fibrinogen, plus anticoagulant or antiplatelet effect."], ["th", "Clotting risk", "g-cyt", "Risk of unwanted clots: micro-clots in DIC, or a strong clotting drive with no treatment."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = L.over;
  pill(ox, "Endothelial break", 192, 150, 110, 100, "The lining of the vessel is broken, exposing what lies beneath.");
  pill(ox, "Collagen and tissue factor", 262, 150, 380, 100, "Exposed collagen holds platelets. Tissue factor from the damaged tissue starts the clotting cascade.");
  pill(ox, "Platelet plug", GC, 176, 238, 100, "Platelets stick (von Willebrand factor and GPIb), activate and clump together through fibrinogen bridges (GPIIb/IIIa). This is primary haemostasis.");
  pill(ox, "Fibrin mesh", 284, 196, 390, 214, "Thrombin turns fibrinogen into fibrin strands that weave through and reinforce the plug.");
  pill(ox, "Plasmin and D-dimer", GC - 20, 228, 120, 242, "Plasmin gradually dissolves fibrin (fibrinolysis), releasing fragments such as D-dimer.");
  pill(ox, "PT arm", 506, 330, 520, 410, "PT follows the extrinsic and common arms (tissue factor, VII, X, V, II, fibrinogen). Warfarin lengthens it.");
  pill(ox, "aPTT arm", 922, 330, 880, 410, "aPTT follows the intrinsic and common arms (XII, XI, IX, VIII, X, V, II, fibrinogen). Unfractionated heparin lengthens it.");
  pill(ox, "Micro-clots", 310, 381, 330, 436, "In DIC, clots form in small vessels everywhere, block them, and use up platelets and factors.");
  pill(ox, "Vitamin K factors", 806, 90, 860, 62, "Factors II, VII, IX and X (marked K) need vitamin K to work. Warfarin lowers them.");
  const hp = pill(ox, "Heparin: antithrombin", 722, 262, 842, 262, "Heparin acts through antithrombin to block factor Xa and thrombin."); hp.setAttribute("id", "pl-hep");
  const wp = pill(ox, "Warfarin: fewer K factors", 616, 106, 690, 148, "Warfarin lowers factors II, VII, IX and X."); wp.setAttribute("id", "pl-warf");
  const dp = pill(ox, "Xa or thrombin blocked", 604, 290, 470, 292, "Direct oral anticoagulants block factor Xa or thrombin directly."); dp.setAttribute("id", "pl-doac");
  const ap = pill(ox, "Antiplatelet", 200, 230, 150, 214, "Antiplatelet drugs block platelet activation (for example P2Y12 or aspirin) or aggregation (GPIIb/IIIa)."); ap.setAttribute("id", "pl-apl");
  const rp = pill(ox, "Factors replaced, cause treated", 330, 406, 330, 456, "Replacing platelets and clotting factors and treating the trigger lets clotting settle."); rp.setAttribute("id", "pl-rep");
}
const W_ = SC.W;
function init() { initInjury(); initCascade(); initMini(); initPanel(); }
const acc = { dd: 0, plm: 0, bl: 0 };
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.6);
  ["Cf", "pl", "thr", "M", "Pl", "Fg", "Bl", "Th", "ext", "intr", "X", "F", "T", "hep", "warf", "doac", "apl", "cause"].forEach((k) => { sm[k] = lerp(sm[k], m[k], k2); });
  /* red cells flow */
  const flow = 1 - 0.25 * sm.pl;
  rbcs.forEach((r) => { r.x += r.v * 54 * flow * dt; if (r.x > X1 - 6) { r.x = X0 + 4; r.y = rnd(LT + 40, LB - 12); } place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 10, 1); });
  /* platelets: flowing, or in the plug */
  const n = Math.round(sm.pl * slots.length);
  plts.forEach((p, i) => { const inPlug = i < n; p.k = lerp(p.k, inPlug ? 1 : 0, Math.min(1, dt * 1.6));
    if (p.k < 0.04) { p.x += p.v * 60 * flow * dt; if (p.x > X1 + 10) { p.x = X0 - 10; p.y = rnd(LT + 14, LB - 12); } p.px = p.x; p.py = p.y + Math.sin(tm / 700 + p.ph) * 3; }
    const s = slots[i % slots.length], tx = inPlug ? s.x : p.px, ty = inPlug ? s.y : p.py;
    const x = lerp(p.px, tx, p.k), y = lerp(p.py, ty, p.k); if (inPlug) { p.x = Math.max(p.x, s.x); }
    place(p.g, x, y, tm / 40 * p.k, 1 + 0.35 * p.k); p.sp.setAttribute("opacity", p.k.toFixed(2)); });
  /* vWF threads, TF, aggregation links, fibrin */
  vwfs.forEach((v) => v.setAttribute("opacity", (0.25 + 0.75 * clamp(sm.T * 1.2)).toFixed(2))); tfs.forEach((v) => v.setAttribute("opacity", (0.25 + 0.75 * clamp(sm.T * 1.3 - 0.1)).toFixed(2)));
  links.forEach((l) => l.e.setAttribute("opacity", (l.i < n ? clamp(sm.pl * (1 - 0.8 * sm.apl)) : 0).toFixed(2)));
  strands.forEach((s) => s.e.setAttribute("opacity", clamp((sm.thr * 1.15 - s.th) * 3.2).toFixed(2)));
  /* fibrinolysis: plasmin dots work on the mesh, D-dimer drifts off */
  acc.dd += dt * sm.thr * 1.6; while (acc.dd >= 1) { acc.dd--; const p = free(dd); if (p) emit(p, rnd(GC - 40, GC + 40), rnd(LT + 20, LT + 60), rnd(-6, 6), rnd(20, 40), 0); }
  dd.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (p.vx + 28) * dt; p.y += p.vy * 0.4 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.6).toFixed(2)); if (p.t > 2.6 || p.x > X1) kill(p); });
  acc.plm += dt * sm.thr * 0.8; while (acc.plm >= 1) { acc.plm--; const p = free(plm); if (p) emit(p, rnd(GC - 50, GC + 50), LT + 70, 0, 0, 0); }
  plm.forEach((p) => { if (!p.on) return; p.t += dt; p.x += Math.sin(p.t * 3) * 10 * dt; p.y -= 10 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3) kill(p); });
  /* cascade: node glow and arrow flow */
  const act = { tf: sm.ext, xii: sm.intr, xi: sm.intr * 0.9 + sm.thr * 0.1, ix: sm.intr * (0.5 + 0.5 * sm.F) , x: sm.X, ii: sm.thr, fg: sm.thr, xiii: sm.thr * 0.9 };
  for (const id in nodes) nodes[id].r.style.setProperty("--act", clamp(act[id]).toFixed(2));
  edges.forEach((e) => { e.off -= dt * (6 + 36 * clamp(act[e.a])); e.p.setAttribute("stroke-dashoffset", f1(e.off)); e.p.style.opacity = (0.25 + 0.75 * clamp(act[e.a] * 1.3)).toFixed(2); });
  marks.hepx.setAttribute("opacity", sm.hep.toFixed(2)); marks.hepii.setAttribute("opacity", sm.hep.toFixed(2)); marks.doacx.setAttribute("opacity", sm.doac.toFixed(2)); marks.doacii.setAttribute("opacity", sm.doac.toFixed(2));
  ["warf7", "warf9", "warfx", "warfii"].forEach((k) => marks[k].setAttribute("opacity", sm.warf.toFixed(2)));
  $("pl-hep").style.opacity = sm.hep.toFixed(2); $("pl-warf").style.opacity = sm.warf.toFixed(2); $("pl-doac").style.opacity = sm.doac.toFixed(2); $("pl-apl").style.opacity = sm.apl.toFixed(2); $("pl-rep").style.opacity = sm.cause.toFixed(2);
  /* small vessels: micro-clots block flow, red cells fragment, bleeding when platelets and fibrinogen are gone */
  const mflow = clamp(1 - 0.85 * sm.M);
  schists.forEach((s, i) => { s.x += s.v * 48 * mflow * dt; if (s.x > 456) { s.x = 28; s.y = rnd(368, 392); } place(s.g, s.x, s.y, Math.sin(tm / 450 + i) * 12, 1); const f = sm.M > 0.45 && i % 2 === 0; s.sc.setAttribute("opacity", f ? 1 : 0); s.body.setAttribute("opacity", f ? 0 : 1); });
  clots.forEach((c) => { const s = clamp((sm.M - 0.1 * c.i) * 2.2); place(c.g, c.x, c.y, 0, 0.1 + 0.9 * s); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  const ooze = clamp((sm.Bl - 0.3) * 2.2) * clamp(sm.M * 2); acc.bl += dt * ooze * 5; while (acc.bl >= 1) { acc.bl--; const p = free(bleed); if (p) emit(p, rnd(40, 450), 414, rnd(-3, 3), rnd(16, 26), 0); }
  bleed.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2)); if (p.t > 1.8) kill(p); });
  /* gauges */
  gg.cf.set(sm.Cf, wordOf(sm.Cf, 0.3, 0.62, ["weak", "forming", "strong"])); gg.pl.set(sm.Pl, wordOf(sm.Pl, 0.4, 0.75, ["low", "reduced", "normal"])); gg.fg.set(sm.Fg, wordOf(sm.Fg, 0.4, 0.75, ["low", "reduced", "normal"]));
  gg.bl.set(sm.Bl, wordOf(sm.Bl, 0.32, 0.58, ["low", "raised", "high"])); gg.th.set(sm.Th, wordOf(sm.Th, 0.32, 0.58, ["low", "raised", "high"]));
}
run({ init, step });
