/* Portal hypertension scene: scarred liver, bowel, portal and splenic veins, collaterals through a vessel segment to oesophageal varices, ascites, spleen, brain and the treatment mechanisms. */
const WW = SC.W;
const layers = { fluid: $("fluid"), organs: $("organs"), vari: $("vari"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const VD = (pts) => "M" + pts.map((q) => f1(q[0]) + " " + f1(q[1])).join("L");
const free = (pl) => pl.find((p) => !p.on);
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts);
const drop = () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts);
const sq = (cls) => () => mk("rect", { class: "sc-p " + cls, x: -3, y: -3, width: 6, height: 6, rx: 1.5 }, layers.parts);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { P: 0.7, Sc: 0.5, St: 0, Vz: 0.6, Rk: 0.5, As: 0.5, Sp: 0.6, Am: 0.5, E: 0.4, bb: 0, bl: 0, di: 0, la: 0, ti: 0, a: 0.7, bleed: 0 };
const acc = { bl: 0, am: 0, leak: 0, bld: 0, dr: 0 };
let ph = 0;

/* ---- organs (real anatomy; vessels and particles anchor to their ports) ---- */
let liverO = null, spleenO = null, brainO = null, bowelO = null, vesselO = null, PARA = [852, 127];
let PORTA = [400, 411], HEPOUT = [412, 225], HILUM = [94, 165], BRAININ = [879, 193], GUT0 = [140, 402], VIN = [700, 57], VOUT = [700, 232];
const nodes = [[388, 292, 17], [430, 268, 14], [480, 284, 16], [512, 322, 13], [372, 336, 14], [420, 318, 18], [470, 330, 15], [398, 372, 14], [450, 384, 15], [500, 366, 12], [348, 300, 11], [486, 252, 9], [356, 366, 9]];
let fibG = null, stent = null;
let plts = [], ast = null, bam = [], aring = null;
const RECP = [[160, 393], [190, 379], [220, 365], [250, 348]];
let recG = null;
const blocks = [];
function initOrgans() {
  liverO = organ(layers.organs, "liver", 436, 322, 240, {});
  spleenO = organ(layers.organs, "spleen", 100, 140, 120, {});
  brainO = organ(layers.organs, "brain", 864, 136, 150, {});
  bowelO = organ(layers.organs, "bowel", 100, 338, 132, {});
  vesselO = organ(layers.organs, "vessel", 700, 145, 70, {});
  PORTA = liverO.ports.porta; HEPOUT = liverO.ports.out; HILUM = spleenO.ports.hilum; BRAININ = brainO.ports.in; PARA = brainO.ports.parenchyma;
  GUT0 = bowelO.ports.out; VIN = vesselO.ports.in; VOUT = vesselO.ports.out;
  /* drawn vessels meet the real anatomy at the live ports */
  $("v-portal").setAttribute("d", VD([GUT0, [250, 348], PORTA]));
  $("v-spl").setAttribute("d", VD([HILUM, [150, 205], [250, 348]]));
  $("v-coll").setAttribute("d", VD([[250, 348], [258, 300], [262, 200], [262, 110], [300, 96], [610, 96], VIN, VOUT, [879, 250]]));
  $("v-hep").setAttribute("d", VD([HEPOUT, [590, 250], [940, 250]]));
  $("v-brain").setAttribute("d", VD([[BRAININ[0], 250], BRAININ]));
  nodes.forEach(([x, y, r]) => { mk("circle", { class: "pv-nod", cx: x, cy: y, r }, layers.organs); });
  fibG = mk("g", {}, layers.organs);
  [[404, 280, 418, 304, 410, 330], [452, 276, 450, 300, 444, 326], [498, 300, 490, 318, 480, 340], [386, 318, 396, 346, 404, 364], [436, 350, 446, 366, 462, 372], [500, 340, 498, 356, 504, 372], [366, 316, 372, 334, 378, 352]].forEach((c) => mk("path", { class: "pv-fib", d: "M" + c[0] + " " + c[1] + "Q" + c[2] + " " + c[3] + " " + c[4] + " " + c[5] }, fibG));
  mk("path", { class: "pv-sin", d: VD([PORTA, [420, 340], [440, 310], [452, 280], HEPOUT]) }, layers.organs);
  stent = mk("g", { opacity: "0" }, layers.organs);
  mk("path", { class: "pv-stent", d: "M" + f1(PORTA[0]) + " " + f1(PORTA[1] - 3) + "L" + f1(HEPOUT[0]) + " " + f1(HEPOUT[1] + 2) }, stent);
  mk("path", { class: "pv-mesh", d: "M" + f1(PORTA[0]) + " " + f1(PORTA[1] - 3) + "L" + f1(HEPOUT[0]) + " " + f1(HEPOUT[1] + 2) }, stent);
  plts = Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, r = 8 + (i % 4) * 7; return mk("circle", { class: "pv-plt", r: 2.6, cx: 100 + r * Math.cos(a), cy: 140 + r * Math.sin(a) * 0.9 }, layers.organs); });
  ast = cell(layers.organs, { cls: "ast", r: 22, nuc: 0.35, seed: 8, wob: 0.14 });
  bam = Array.from({ length: 10 }, (_, i) => { const a = i * 1.9, r = 30 + (i % 3) * 6; return mk("path", { class: "sc-p p-am", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z", transform: "translate(" + f1(PARA[0] + r * Math.cos(a) * 1.15) + " " + f1(PARA[1] + r * Math.sin(a) * 0.9) + ")" }, layers.organs); });
  aring = mk("circle", { class: "pv-stop", cx: PARA[0], cy: PARA[1], r: 30, opacity: "0" }, layers.organs);
  recG = mk("g", {}, layers.organs);
  RECP.forEach(([x, y]) => mk("circle", { class: "pv-rec", cx: x, cy: y, r: 4 }, recG));
  RECP.forEach(() => { const e = mk("rect", { class: "pv-block", x: -5, y: -3.5, width: 10, height: 7, rx: 3, opacity: "0" }, layers.organs); blocks.push(e); });
}
/* ---- stage caption ---- */
let capEl = null, capDrug = -1;
function capText(d) {
  if (d === 1) return "Beta-blocker sits on its receptors. Inflow slows, pressure falls and varices shrink.";
  if (d === 2) return "Band ligation strangles the varices. Bleeding risk falls but pressure stays high.";
  if (d === 3) return "Diuretics with salt restriction. Extra fluid leaves and ascites shrinks.";
  if (d === 4) return "Lactulose traps ammonia in the gut. Less reaches the brain.";
  if (d === 5) return "TIPS stent bypasses the liver. Pressure falls but more ammonia reaches the brain.";
  if (d === 6) return "Beta-blocker plus band ligation. Lower pressure and smaller varices together.";
  return "No treatment. High pressure swells varices, fluid gathers and toxins reach the brain.";
}
/* ---- fluid in the abdomen ---- */
const poolR = mk("path", { class: "pv-pool", opacity: "0.32" }, layers.fluid), surf = mk("path", { class: "pv-surf", opacity: "0.8" }, layers.fluid);
/* ---- varices ---- */
const vxs = [[684, 140], [684, 172], [684, 204]].map(([x, y]) => ({ x, y, e: mk("circle", { class: "pv-vx", cx: x, cy: y, r: 6 }, layers.vari), b: mk("circle", { class: "pv-band", cx: x, cy: y, r: 10, opacity: "0" }, layers.vari) }));
/* ---- treatment icons ---- */
const ICX = [340, 397, 454, 511, 568], ICY = 152;
const ic = () => mk("g", {}, layers.tr);
const gBB = ic(); mk("rect", { class: "pv-ic", x: ICX[0] - 15, y: ICY - 7, width: 30, height: 14, rx: 7 }, gBB); mk("path", { class: "pv-ic", d: "M" + ICX[0] + " " + (ICY - 7) + "V" + (ICY + 7) }, gBB);
const gBL = ic(); mk("circle", { class: "pv-ic", cx: ICX[1], cy: ICY, r: 12 }, gBL); mk("circle", { class: "pv-ic", cx: ICX[1], cy: ICY, r: 5 }, gBL);
const gDI = ic(); mk("path", { class: "pv-ic", d: "M" + ICX[2] + " " + (ICY - 14) + "C" + (ICX[2] + 12) + " " + (ICY - 2) + " " + (ICX[2] + 14) + " " + (ICY + 4) + " " + (ICX[2] + 14) + " " + (ICY + 6) + "A14 11 0 0 1 " + (ICX[2] - 14) + " " + (ICY + 6) + "C" + (ICX[2] - 14) + " " + (ICY + 4) + " " + (ICX[2] - 12) + " " + (ICY - 2) + " " + ICX[2] + " " + (ICY - 14) + "Z" }, gDI);
const gLA = ic(); mk("rect", { class: "pv-ic", x: ICX[3] - 11, y: ICY - 4, width: 22, height: 20, rx: 4 }, gLA); mk("rect", { class: "pv-ic", x: ICX[3] - 5, y: ICY - 14, width: 10, height: 10, rx: 2 }, gLA);
const gTI = ic(); mk("rect", { class: "pv-ic", x: ICX[4] - 17, y: ICY - 8, width: 34, height: 16, rx: 4 }, gTI); mk("path", { class: "pv-ic", d: "M" + (ICX[4] - 8) + " " + (ICY - 8) + "L" + (ICX[4] - 2) + " " + (ICY + 8) + "M" + (ICX[4] + 2) + " " + (ICY - 8) + "L" + (ICX[4] + 8) + " " + (ICY + 8) }, gTI);
const icons = [gBB, gBL, gDI, gLA, gTI];
const rings = [[205, 370, 16], [684, 172, 22], [790, 400, 24], [103, 341, 26], [406, 318, 18]].map(([x, y, r]) => ({ r, e: mk("circle", { class: "pv-ring", cx: x, cy: y, r, opacity: "0" }, layers.marks) }));
const gutMark = mk("g", { opacity: "0" }, layers.marks); mk("circle", { class: "pv-stop", cx: 100, cy: 300, r: 8 }, gutMark); mk("path", { class: "pv-stop", d: "M95 305L105 295" }, gutMark);
/* ---- tracks (built from live organ ports so flow meets real anatomy) ---- */
let TRK = {}, PRE = null, LIVE = null, TIPR = null, COLL = null, OUT = null, SIGTR = null;
function mkTrack(src, route, kind) {
  const pre = PRE[src], j = pre.findIndex((q) => q[0] === 250 && q[1] === 348);
  let pts;
  if (route === "L") pts = pre.concat(LIVE.slice(1), OUT);
  else if (route === "T") pts = pre.concat(TIPR.slice(1), OUT);
  else pts = pre.slice(0, j + 1).concat(COLL.slice(1), [[879, 250]]);
  pts.push(kind === "a" ? [BRAININ[0], BRAININ[1]] : [940, 250]);
  const tr = track(pts);
  tr.pre = track(pts.slice(0, route === "C" ? j + 1 : pre.length)).len;
  tr.mid = 0;
  if (route === "L") { const mi = pts.findIndex((q) => q[0] === 440 && q[1] === 310); tr.mid = track(pts.slice(0, mi + 1)).len; }
  return tr;
}
function initTracks() {
  PRE = { gut: [GUT0.slice(), [250, 348], PORTA.slice()], spl: [HILUM.slice(), [150, 205], [250, 348], PORTA.slice()] };
  LIVE = [PORTA.slice(), [420, 340], [440, 310], [452, 280], HEPOUT.slice()];
  TIPR = [PORTA.slice(), HEPOUT.slice()];
  COLL = [[250, 348], [258, 300], [262, 200], [262, 110], [300, 96], [610, 96], VIN.slice(), VOUT.slice(), [879, 250]];
  OUT = [[590, 250], [700, 250], [879, 250]];
  TRK = {};
  ["gut", "spl"].forEach((s) => ["L", "T", "C"].forEach((r) => ["b", "a"].forEach((k) => { TRK[s + r + k] = mkTrack(s, r, k); })));
  SIGTR = track([GUT0.slice(), [250, 348], PORTA.slice()]);
}
const blood = Array.from({ length: 84 }, () => ({ e: dot("p-bl", 3)(), on: false, tr: null, d: 0, ox: 0, oy: 0, r: "L" }));
const amm = Array.from({ length: 64 }, () => ({ e: dia("p-am")(), on: false, tr: null, d: 0, ox: 0, oy: 0, r: "L", cut: 0 }));
blood.concat(amm).forEach((p) => p.e.setAttribute("opacity", "0"));
const leak = pool(30, drop), bld = pool(16, dot("p-blood", 2.8)), stool = pool(12, sq("p-nh4")), drain = pool(12, drop);
const sigs = Array.from({ length: 6 }, (_, i) => ({ e: dot("p-sig", 2.6)(), u: i / 6 }));
function routeOf() { const u = Math.random(); return u < sm.St ? "T" : u < sm.St + sm.Sc ? "C" : "L"; }
function spawn(arr, kind) {
  const p = free(arr); if (!p) return;
  const src = kind === "a" ? "gut" : Math.random() < 0.6 ? "gut" : "spl", r = routeOf();
  p.tr = TRK[src + r + kind]; p.r = r; p.d = 0; p.on = true; p.cut = 0;
  const st = (src === "gut" ? GUT0 : HILUM);
  p.ox = src === "gut" ? rnd(-30, 20) : rnd(-14, 14); p.oy = src === "gut" ? rnd(-40, 18) : rnd(-14, 14);
  p.x = st[0]; p.y = st[1];
  if (kind === "a" && r === "L" && Math.random() > 0.1 + 0.35 * sm.Ld) p.cut = p.tr.mid;
}
function move(p, dt, flow, kind) {
  if (!p.on) return;
  const tr = p.tr, pre = p.d < tr.pre;
  const sp = flow * (pre ? 1 - 0.45 * sm.P : p.r === "L" ? 0.6 : p.r === "T" ? 1.35 : 1.05);
  p.d += sp * dt; p.ox *= Math.max(0, 1 - dt * 1.8); p.oy *= Math.max(0, 1 - dt * 1.8);
  if (p.cut && p.d >= p.cut) { p.on = false; p.e.setAttribute("opacity", "0"); return; }
  if (p.d >= tr.len) { p.on = false; p.e.setAttribute("opacity", "0"); if (kind === "a") sm.pulse = 1; return; }
  const q = tr.at(p.d / tr.len);
  p.e.setAttribute("transform", "translate(" + f1(q.x + p.ox) + " " + f1(q.y + p.oy) + ")"); p.e.setAttribute("opacity", "1");
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pp", "Portal pressure", "g-pp", "Pressure in the portal vein system. It is raised because the scarred liver resists the flow, and because widened gut arteries push more blood in."], ["vx", "Bleeding risk", "g-vx", "Risk that oesophageal or gastric varices rupture. It rises with pressure and with the size of the varices."], ["as", "Ascites", "g-as", "Fluid in the abdomen. High pressure in the gut capillaries, low albumin and kidney retention of salt and water all contribute."], ["sp", "Spleen size", "g-spl", "The spleen swells as pressure backs up in the splenic vein. It traps platelets, which can lower the platelet count (hypersplenism)."], ["he", "Encephalopathy", "g-he", "Confusion and a slowed brain from gut-derived toxins, mainly ammonia, that reach the brain because the liver does not clear them."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Spleen", 100, 127, 100, 218, "Spleen. Blood backs up in the splenic vein, so the spleen enlarges and traps platelets.");
  pill(ox, "Gut", 103, 341, 100, 420, "Gut. Blood from the intestines, rich in gut-made ammonia, runs to the liver through the portal vein.");
  pill(ox, "Portal vein", 250, 348, 250, 392, "Portal vein. It carries blood from gut and spleen to the liver. Here it dilates and flow into the liver slows.");
  pill(ox, "Liver", 436, 302, 450, 238, "Liver in cirrhosis. Scar bands and nodules squeeze its vessels, so resistance to portal flow rises.");
  pill(ox, "Collaterals", 440, 96, 440, 74, "Collaterals. Small veins that open up to carry portal blood around the liver, bypassing its filter.");
  pill(ox, "Varices", 684, 172, 700, 272, "Varices. Swollen veins in the lower gullet wall with thin walls that can rupture and bleed.");
  pill(ox, "Brain", PARA[0], PARA[1], 864, 214, "Brain. Ammonia that skips the liver reaches the brain, swells support cells and clouds thinking.");
  pill(ox, "Ascites", 860, 404, 860, 318, "Ascites. Fluid that weeps from the liver surface and gut vessels into the belly.");
  const lg = mk("g", {}, ox); [["p-bl", "blood", 200, 0], ["p-am", "ammonia", 270, 1]].forEach(([c, n, x, d]) => { if (d) mk("path", { class: "sc-p " + c, d: "M" + x + " 49L" + (x + 3.2) + " 52.6L" + x + " 56.2L" + (x - 3.2) + " 52.6Z" }, lg); else mk("circle", { class: "sc-p " + c, cx: x, cy: 53, r: 3 }, lg); const tx = mk("text", { class: "sc-lab", x: x + 8, y: 56 }, lg); tx.textContent = n; });
  const dp = mk("path", { class: "p-fl", d: "M350 49C352 52 353 54 353 55A3 3 0 0 1 347 55C347 54 348 52 350 49Z" }, lg); const tx2 = mk("text", { class: "sc-lab", x: 358, y: 56 }, lg); tx2.textContent = "fluid";
  capEl = mk("text", { class: "pv-cap", x: 210, y: 430 }, ox); capEl.textContent = capText(0);
}
function init() { initOrgans(); initTracks(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 1.4);
  ["P", "Sc", "St", "Vz", "Rk", "As", "Sp", "Am", "E"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  ["bb", "bl", "di", "la", "ti"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  sm.a = m.a; sm.Ld = m.Ld; ph += dt;
  /* vessels widen with pressure, collaterals with shunted flow */
  $("v-portal").setAttribute("stroke-width", f1(13 + 13 * sm.P)); $("v-spl").setAttribute("stroke-width", f1(8 + 8 * sm.P));
  $("v-coll").setAttribute("stroke-width", f1(3 + 10 * sm.Sc));
  $("v-coll").setAttribute("opacity", (0.35 + 0.65 * sm.Sc).toFixed(2));
  /* liver scarring and the TIPS stent */
  fibG.setAttribute("opacity", (0.2 + 0.8 * sm.a).toFixed(2));
  stent.setAttribute("opacity", (0.35 + 0.65 * sm.ti).toFixed(2));
  if (stent.firstChild) stent.firstChild.setAttribute("stroke-width", f1(13 + 2 * Math.sin(ph * 5) * sm.ti));
  /* spleen swells and traps platelets */
  const sc = 0.78 + 0.55 * sm.Sp; place(spleenO.g, 100, 140, 0, sc); const wp = Math.round(sm.Sp * plts.length);
  plts.forEach((c, i) => { c.setAttribute("opacity", i < wp ? "1" : "0.1"); });
  /* beta-blocker docks on its receptors; the inflow signal fades downstream */
  recG.setAttribute("opacity", (0.35 + 0.65 * Math.max(sm.bb, 0.4)).toFixed(2));
  blocks.forEach((b, i) => {
    const R = RECP[i], x = lerp(ICX[0], R[0], sm.bb), y = lerp(ICY, R[1], sm.bb);
    b.setAttribute("transform", "translate(" + f1(x) + " " + f1(y) + ")"); b.setAttribute("opacity", sm.bb.toFixed(2));
  });
  sigs.forEach((s, i) => {
    s.u = (s.u + dt * 70 / SIGTR.len) % 1; const q = SIGTR.at(s.u);
    s.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    s.e.setAttribute("opacity", (0.85 * (1 - 0.8 * sm.bb)).toFixed(2));
  });
  /* varices swell, bands strangle them, bleeding follows risk */
  vxs.forEach((v, i) => {
    const r = 4 + 11 * sm.Vz * (1 - 0.05 * i); v.e.setAttribute("r", f1(r)); v.b.setAttribute("r", f1(r + 3.5)); v.b.setAttribute("opacity", sm.bl.toFixed(2));
    v.e.setAttribute("class", sm.bl > 0.5 ? "pv-vx is-band" : "pv-vx");
  });
  acc.bld += dt * Math.max(0, sm.Rk - 0.45) * 9; while (acc.bld >= 1) { acc.bld--; const p = free(bld), v = pick(vxs); if (p) emit(p, v.x + 6, v.y, rnd(2, 10), rnd(10, 26)); }
  bld.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > 220 || p.x > 736) kill(p); });
  sm.bleed = lerp(sm.bleed, Math.max(0, sm.Rk - 0.45) * 1.4, k1);
  $("bleedtint").setAttribute("opacity", Math.min(0.7, sm.bleed).toFixed(2));
  /* ascites pool and the diuretic drain stream */
  const top = 436 - (10 + 90 * sm.As), x0 = 586, x1 = 940;
  let d = "M" + x0 + " " + f1(top), s = "M" + x0 + " " + f1(top);
  for (let x = x0 + 10; x <= x1; x += 10) { const y = top + 1.8 * Math.sin(x / 26 + ph * 1.3); d += "L" + x + " " + f1(y); s += "L" + x + " " + f1(y); }
  poolR.setAttribute("d", d + "L" + x1 + " 436L" + x0 + " 436Z"); surf.setAttribute("d", s);
  acc.leak += dt * sm.As * 6; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, 552, rnd(296, 330), rnd(30, 52), rnd(8, 22)); }
  leak.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; at(p); if (p.y > top || p.x > 930) kill(p); });
  acc.dr += dt * (2 + 8 * sm.As) * sm.di; while (acc.dr >= 1) { acc.dr--; const p = free(drain); if (p) emit(p, rnd(620, 900), top + 6, rnd(-6, 6), rnd(24, 44)); }
  drain.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); p.e.setAttribute("opacity", clamp(1 - (p.y - top - 30) / 70).toFixed(2)); if (p.y > 434) kill(p); });
  /* blood and ammonia; lactulose diverts ammonia into trapped stool */
  const flow = 52 * (1 - 0.25 * sm.bb);
  acc.bl += dt * (3.0 + 0.6 * (1 - sm.P)); while (acc.bl >= 1) { acc.bl--; spawn(blood, "b"); }
  acc.am += dt * 2.0 * (1 - 0.3 * sm.la); while (acc.am >= 1) {
    acc.am--;
    if (Math.random() < 0.55 * sm.la) { const t = free(stool); if (t) emit(t, rnd(60, 150), rnd(320, 368), rnd(-6, 6), rnd(25, 45)); }
    else spawn(amm, "a");
  }
  blood.forEach((p) => move(p, dt, flow, "b")); amm.forEach((p) => move(p, dt, flow, "a"));
  stool.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt; at(p); p.e.setAttribute("opacity", clamp(1 - (p.y - 395) / 30).toFixed(2)); if (p.y > 425) kill(p); });
  /* brain: astrocyte swells at its parenchyma anchor, ammonia gathers, alarm at overt */
  sm.pulse = Math.max(0, (sm.pulse || 0) - dt * 2);
  place(ast, PARA[0] + Math.sin(ph * 0.6) * 2, PARA[1], Math.sin(ph * 0.4) * 4, 1 + 0.4 * sm.E + 0.05 * sm.pulse); ast.setAttribute("opacity", (1 - 0.5 * sm.E).toFixed(2));
  const wb = Math.round(sm.E * bam.length); bam.forEach((c, i) => { c.setAttribute("opacity", i < wb ? "1" : "0"); });
  aring.setAttribute("opacity", (sm.E > 0.55 ? 0.5 + 0.4 * Math.sin(ph * 4) : 0).toFixed(2));
  /* treatment glow and pulses */
  const act = [sm.bb, sm.bl, sm.di, sm.la, sm.ti];
  icons.forEach((g, i) => { g.style.opacity = (0.3 + 0.7 * act[i]).toFixed(2); });
  [sm.bb, sm.bl, sm.di, sm.la, sm.ti].forEach((a, i) => { const rg = rings[i], u = (ph * 0.5 + i * 0.2) % 1; rg.e.setAttribute("r", f1(rg.r * (0.5 + u))); rg.e.setAttribute("opacity", (a * (1 - u) * 0.9).toFixed(2)); });
  gutMark.setAttribute("opacity", sm.la.toFixed(2));
  /* gauges and caption */
  gg.pp.set(sm.P, wordOf(sm.P, 0.35, 0.7, ["lowered", "raised", "very high"])); gg.vx.set(sm.Rk, wordOf(sm.Rk, 0.2, 0.5, ["low", "moderate", "high"])); gg.as.set(sm.As, wordOf(sm.As, 0.25, 0.6, ["little", "moderate", "large"]));
  gg.sp.set(sm.Sp, wordOf(sm.Sp, 0.45, 0.75, ["normal", "enlarged", "very large"])); gg.he.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["minimal", "mild", "overt"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
