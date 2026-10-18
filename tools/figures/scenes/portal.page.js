/* Portal hypertension scene: scarred liver, portal and splenic veins, collaterals to oesophageal varices, ascites, spleen, brain and the treatment icons. */
const WW = SC.W;
const layers = { fluid: $("fluid"), organs: $("organs"), vari: $("vari"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const free = (pl) => pl.find((p) => !p.on);
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts);
const drop = () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts);
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0 }; }); }
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { P: 0.7, Sc: 0.5, St: 0, Vz: 0.6, Rk: 0.5, As: 0.5, Sp: 0.6, Am: 0.5, E: 0.4, bb: 0, bl: 0, di: 0, la: 0, ti: 0, a: 0.7, bleed: 0 };
const acc = { bl: 0, am: 0, leak: 0, bld: 0 };
let ph = 0;

/* ---- organs ---- */
const liver = cell(layers.organs, { cls: "cirr", r: 104, nuc: 0, seed: 4, wob: 0.1, x: 436, y: 330 });
const nodes = [[388, 292, 17], [430, 268, 14], [480, 284, 16], [512, 322, 13], [372, 336, 14], [420, 318, 18], [470, 330, 15], [398, 372, 14], [450, 384, 15], [500, 366, 12], [348, 300, 11], [486, 252, 9], [356, 366, 9]];
const fibG = mk("g", {}, layers.organs);
nodes.forEach(([x, y, r]) => { mk("circle", { class: "pv-nod", cx: x, cy: y, r }, layers.organs); });
[[404, 280, 418, 304, 410, 330], [452, 276, 450, 300, 444, 326], [498, 300, 490, 318, 480, 340], [386, 318, 396, 346, 404, 364], [436, 350, 446, 366, 462, 372], [500, 340, 498, 356, 504, 372], [366, 316, 372, 334, 378, 352]].forEach((c) => mk("path", { class: "pv-fib", d: "M" + c[0] + " " + c[1] + "Q" + c[2] + " " + c[3] + " " + c[4] + " " + c[5] }, fibG));
mk("path", { class: "pv-sin", d: "M334 338L360 370L410 395L470 370L500 330L530 292L548 285" }, layers.organs);
const stent = mk("g", { opacity: "0" }, layers.organs); mk("path", { class: "pv-stent", d: "M340 336L380 328L440 318L500 302L548 285" }, stent); mk("path", { class: "pv-mesh", d: "M340 336L380 328L440 318L500 302L548 285" }, stent);
const spl = cell(layers.organs, { cls: "spl", r: 40, nuc: 0.0, seed: 6, wob: 0.1, x: 100, y: 140 });
const plts = Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, r = 8 + (i % 4) * 7; return mk("circle", { class: "pv-plt", r: 2.6, cx: 100 + r * Math.cos(a), cy: 140 + r * Math.sin(a) * 0.9 }, layers.organs); });
const ast = cell(layers.organs, { cls: "ast", r: 22, nuc: 0.35, seed: 8, wob: 0.14, x: 864, y: 136 });
const bam = Array.from({ length: 10 }, (_, i) => { const a = i * 1.9, r = 30 + (i % 3) * 6; return mk("path", { class: "sc-p p-am", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z", transform: "translate(" + f1(864 + r * Math.cos(a) * 1.15) + " " + f1(136 + r * Math.sin(a) * 0.9) + ")" }, layers.organs); });
const aring = mk("circle", { class: "pv-stop", cx: 864, cy: 136, r: 30, opacity: "0" }, layers.organs);
/* ---- fluid in the abdomen ---- */
const poolR = mk("path", { class: "pv-pool", opacity: "0.32" }, layers.fluid), surf = mk("path", { class: "pv-surf", opacity: "0.8" }, layers.fluid);
/* ---- varices ---- */
const vxs = [[684, 140], [684, 172], [684, 204]].map(([x, y]) => ({ x, y, e: mk("circle", { class: "pv-vx", cx: x, cy: y, r: 6 }, layers.vari), b: mk("circle", { class: "pv-band", cx: x, cy: y, r: 10, opacity: "0" }, layers.vari) }));
/* ---- treatment icons ---- */
const ICX = [340, 397, 454, 511, 568], ICY = 152;
const ic = (x) => mk("g", {}, layers.tr);
const gBB = ic(); mk("rect", { class: "pv-ic", x: ICX[0] - 15, y: ICY - 7, width: 30, height: 14, rx: 7 }, gBB); mk("path", { class: "pv-ic", d: "M" + ICX[0] + " " + (ICY - 7) + "V" + (ICY + 7) }, gBB);
const gBL = ic(); mk("circle", { class: "pv-ic", cx: ICX[1], cy: ICY, r: 12 }, gBL); mk("circle", { class: "pv-ic", cx: ICX[1], cy: ICY, r: 5 }, gBL);
const gDI = ic(); mk("path", { class: "pv-ic", d: "M" + ICX[2] + " " + (ICY - 14) + "C" + (ICX[2] + 12) + " " + (ICY - 2) + " " + (ICX[2] + 14) + " " + (ICY + 4) + " " + (ICX[2] + 14) + " " + (ICY + 6) + "A14 11 0 0 1 " + (ICX[2] - 14) + " " + (ICY + 6) + "C" + (ICX[2] - 14) + " " + (ICY + 4) + " " + (ICX[2] - 12) + " " + (ICY - 2) + " " + ICX[2] + " " + (ICY - 14) + "Z" }, gDI);
const gLA = ic(); mk("rect", { class: "pv-ic", x: ICX[3] - 11, y: ICY - 4, width: 22, height: 20, rx: 4 }, gLA); mk("rect", { class: "pv-ic", x: ICX[3] - 5, y: ICY - 14, width: 10, height: 10, rx: 2 }, gLA);
const gTI = ic(); mk("rect", { class: "pv-ic", x: ICX[4] - 17, y: ICY - 8, width: 34, height: 16, rx: 4 }, gTI); mk("path", { class: "pv-ic", d: "M" + (ICX[4] - 8) + " " + (ICY - 8) + "L" + (ICX[4] - 2) + " " + (ICY + 8) + "M" + (ICX[4] + 2) + " " + (ICY - 8) + "L" + (ICX[4] + 8) + " " + (ICY + 8) }, gTI);
const icons = [gBB, gBL, gDI, gLA, gTI];
const rings = [[240, 350, 16], [684, 172, 22], [790, 400, 24], [100, 350, 26], [440, 318, 18]].map(([x, y, r]) => ({ r, e: mk("circle", { class: "pv-ring", cx: x, cy: y, r, opacity: "0" }, layers.marks) }));
const gutStop = mk("g", { opacity: "0" }, layers.marks); mk("circle", { class: "pv-stop", cx: 100, cy: 300, r: 8 }, gutStop); mk("path", { class: "pv-stop", d: "M95 305L105 295" }, gutStop);
/* ---- tracks ---- */
const PRE = { gut: [[100, 350], [184, 350], [262, 340]], spl: [[120, 150], [184, 162], [230, 240], [262, 330]] };
const LIVE = [[334, 338], [360, 370], [410, 395], [470, 370], [500, 330], [530, 292], [548, 285]];
const TIPR = [[334, 338], [380, 328], [440, 318], [500, 302], [548, 285]];
const COLL = [[262, 300], [262, 110], [300, 96], [610, 96], [650, 108], [668, 130], [672, 170], [670, 210], [672, 250]];
const OUT = [[590, 250], [700, 250], [863, 250]];
function mkTrack(src, route, kind) {
  let pts = PRE[src].slice();
  const preLen = track(pts.concat([[300, 340]])).len;
  if (route === "L") pts = pts.concat([[300, 340]], LIVE, OUT);
  else if (route === "T") pts = pts.concat([[300, 340]], TIPR, OUT);
  else pts = pts.concat(COLL, [[863, 250]]);
  pts.push(kind === "a" ? [863, 196] : [940, 250]);
  const tr = track(pts);
  let mid = 0; if (route === "L") { const i = pts.findIndex((q) => q[0] === 470 && q[1] === 370); mid = track(pts.slice(0, i + 1)).len; }
  tr.pre = preLen; tr.mid = mid; return tr;
}
const TRK = {};
["gut", "spl"].forEach((s) => ["L", "T", "C"].forEach((r) => ["b", "a"].forEach((k) => { TRK[s + r + k] = mkTrack(s, r, k); })));
const blood = Array.from({ length: 84 }, () => ({ e: dot("p-bl", 3)(), on: false, tr: null, d: 0, ox: 0, oy: 0, r: "L" }));
const amm = Array.from({ length: 64 }, () => ({ e: dia("p-am")(), on: false, tr: null, d: 0, ox: 0, oy: 0, r: "L", cut: 0 }));
blood.concat(amm).forEach((p) => p.e.setAttribute("opacity", "0"));
const leak = pool(30, drop), bld = pool(16, dot("p-blood", 2.8)), pa = pool(1, dot("p-am", 1));
function routeOf() { const u = Math.random(); return u < sm.St ? "T" : u < sm.St + sm.Sc ? "C" : "L"; }
function spawn(arr, kind) {
  const p = free(arr); if (!p) return;
  const src = kind === "a" ? "gut" : Math.random() < 0.6 ? "gut" : "spl", r = routeOf();
  p.tr = TRK[src + r + kind]; p.r = r; p.d = 0; p.on = true; p.cut = 0;
  p.ox = src === "gut" ? rnd(-34, 40) : rnd(-14, 14); p.oy = src === "gut" ? rnd(-42, 40) : rnd(-14, 14);
  if (kind === "a" && r === "L" && Math.random() > 0.1 + 0.35 * sm.Ld) p.cut = p.tr.mid;
}
function move(p, dt, flow, kind) {
  if (!p.on) return;
  const tr = p.tr, pre = p.d < tr.pre;
  const sp = flow * (pre ? 1 - 0.45 * sm.P : p.r === "L" ? 0.6 : 1.05);
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
  pill(ox, "Spleen", 100, 140, 100, 218, "Spleen. Blood backs up from the splenic vein, so it enlarges (splenomegaly) and traps platelets, which can lower the platelet count (hypersplenism).");
  pill(ox, "Mesenteric veins", 100, 380, 100, 420, "Veins draining the intestines. Their blood, rich in absorbed nutrients and gut-made ammonia, runs to the liver through the portal vein.");
  pill(ox, "Portal vein", 232, 342, 236, 392, "Portal vein. It carries blood from gut and spleen to the liver. In portal hypertension it dilates, the pressure inside is high, and flow into the liver slows.");
  pill(ox, "Cirrhotic liver", 450, 330, 450, 238, "Cirrhotic liver. Scar bands and regenerating nodules squeeze the sinusoids and the liver's vessels also constrict, so resistance to portal flow rises.");
  pill(ox, "Hepatic vein", 566, 268, 600, 232, "Hepatic vein. It carries the filtered blood out of the liver towards the heart. Less blood takes this route when the liver is resistant.");
  pill(ox, "Collateral veins", 440, 96, 440, 74, "Portosystemic collaterals: small veins that open up to carry portal blood around the liver straight into the systemic veins. They relieve pressure a little, but they bypass the liver's filter.");
  pill(ox, "Varices", 690, 156, 730, 64, "Oesophageal varices: swollen collateral veins in the lower oesophagus wall. They have thin walls under high pressure and can rupture and bleed severely.");
  pill(ox, "Brain cells", 846, 150, 812, 214, "Brain cells (astrocytes). Ammonia that skips the liver reaches the brain, swells these cells and disturbs brain function: hepatic encephalopathy.");
  pill(ox, "Ascites", 860, 410, 860, 318, "Ascites: fluid that weeps from the liver surface and gut vessels into the abdominal cavity.");
  pill(ox, "Beta-blocker", ICX[0], 170, ICX[0], 188, "Non-selective beta-blocker: lowers portal inflow and pressure. Used to prevent a first or repeat variceal bleed.");
  pill(ox, "Band ligation", ICX[1], 170, ICX[1], 206, "Endoscopic band ligation: rubber bands placed on varices through an endoscope make them clot and shrivel. It removes varices but does not lower portal pressure.");
  pill(ox, "Diuretics", ICX[2], 170, ICX[2], 188, "Diuretics with salt restriction: clear ascites by making the kidney excrete salt and water. They do not lower portal pressure.");
  pill(ox, "Lactulose", ICX[3], 170, ICX[3], 206, "Lactulose: an unabsorbed sugar that speeds the gut and reduces ammonia absorption, to treat or prevent encephalopathy.");
  pill(ox, "TIPS", ICX[4], 170, ICX[4], 188, "TIPS: a stent placed through the liver between the portal and hepatic veins. It lowers portal pressure and treats refractory ascites or bleeding, but sends more ammonia past the liver and can worsen encephalopathy.");
  const lg = mk("g", {}, ox); [["p-bl", "blood", 200, 0], ["p-am", "ammonia", 270, 1]].forEach(([c, n, x, d]) => { if (d) mk("path", { class: "sc-p " + c, d: "M" + x + " 49L" + (x + 3.2) + " 52.6L" + x + " 56.2L" + (x - 3.2) + " 52.6Z" }, lg); else mk("circle", { class: "sc-p " + c, cx: x, cy: 53, r: 3 }, lg); const tx = mk("text", { class: "sc-lab", x: x + 8, y: 56 }, lg); tx.textContent = n; });
  const dp = mk("path", { class: "p-fl", d: "M350 49C352 52 353 54 353 55A3 3 0 0 1 347 55C347 54 348 52 350 49Z" }, lg); const tx2 = mk("text", { class: "sc-lab", x: 358, y: 56 }, lg); tx2.textContent = "fluid";
}
function init() { initPanel(); }
const wl = (w, h, x, t, y) => 0;
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["P", "Sc", "St", "Vz", "Rk", "As", "Sp", "Am", "E"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  ["bb", "bl", "di", "la", "ti"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  sm.a = m.a; sm.Ld = m.Ld; ph += dt;
  /* vessels */
  $("v-portal").setAttribute("stroke-width", f1(13 + 13 * sm.P)); $("v-spl").setAttribute("stroke-width", f1(8 + 8 * sm.P));
  $("v-coll").setAttribute("stroke-width", f1(3 + 10 * sm.Sc));
  /* liver scarring */
  fibG.setAttribute("opacity", (0.2 + 0.8 * sm.a).toFixed(2)); stent.setAttribute("opacity", sm.ti.toFixed(2));
  place(liver, 436, 330, 0, 1);
  /* spleen */
  const sc = 0.78 + 0.55 * sm.Sp; place(spl, 100, 140, 0, sc); const wp = Math.round(sm.Sp * plts.length);
  plts.forEach((c, i) => { c.setAttribute("opacity", i < wp ? "1" : "0.1"); });
  /* varices and bleeding */
  vxs.forEach((v, i) => { const r = 4 + 11 * sm.Vz * (1 - 0.05 * i); v.e.setAttribute("r", f1(r)); v.b.setAttribute("r", f1(r + 3.5)); v.b.setAttribute("opacity", sm.bl.toFixed(2)); });
  acc.bld += dt * Math.max(0, sm.Rk - 0.45) * 9; while (acc.bld >= 1) { acc.bld--; const p = free(bld), v = pick(vxs); if (p) emit(p, v.x + 6, v.y, rnd(2, 10), rnd(10, 26)); }
  bld.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; at(p); if (p.y > 220 || p.x > 736) kill(p); });
  sm.bleed = lerp(sm.bleed, Math.max(0, sm.Rk - 0.45) * 1.4, k1);
  $("bleedtint").setAttribute("opacity", Math.min(0.7, sm.bleed).toFixed(2));
  /* ascites pool */
  const top = 436 - (10 + 90 * sm.As), x0 = 586, x1 = 940;
  let d = "M" + x0 + " " + f1(top), s = "M" + x0 + " " + f1(top);
  for (let x = x0 + 10; x <= x1; x += 10) { const y = top + 1.8 * Math.sin(x / 26 + ph * 1.3); d += "L" + x + " " + f1(y); s += "L" + x + " " + f1(y); }
  poolR.setAttribute("d", d + "L" + x1 + " 436L" + x0 + " 436Z"); surf.setAttribute("d", s);
  acc.leak += dt * sm.As * 6; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, 552, rnd(296, 330), rnd(30, 52), rnd(8, 22)); }
  leak.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; at(p); if (p.y > top || p.x > 930) kill(p); });
  /* blood and ammonia */
  const flow = 52;
  acc.bl += dt * (3.0 + 0.6 * (1 - sm.P)); while (acc.bl >= 1) { acc.bl--; spawn(blood, "b"); }
  acc.am += dt * 2.0 * (1 - 0.65 * sm.la); while (acc.am >= 1) { acc.am--; spawn(amm, "a"); }
  blood.forEach((p) => move(p, dt, flow, "b")); amm.forEach((p) => move(p, dt, flow, "a"));
  /* brain */
  sm.pulse = Math.max(0, (sm.pulse || 0) - dt * 2);
  place(ast, 864, 136, 0, 1 + 0.4 * sm.E + 0.05 * sm.pulse); ast.setAttribute("opacity", (1 - 0.5 * sm.E).toFixed(2));
  const wb = Math.round(sm.E * bam.length); bam.forEach((c, i) => { c.setAttribute("opacity", i < wb ? "1" : "0"); });
  aring.setAttribute("opacity", (sm.E > 0.55 ? 0.5 + 0.4 * Math.sin(ph * 4) : 0).toFixed(2));
  /* treatment glow and pulses */
  const act = [sm.bb, sm.bl, sm.di, sm.la, sm.ti];
  icons.forEach((g, i) => { g.style.opacity = (0.3 + 0.7 * act[i]).toFixed(2); });
  [sm.bb, sm.bl, sm.di, sm.la, sm.ti].forEach((a, i) => { const rg = rings[i], u = (ph * 0.5 + i * 0.2) % 1; rg.e.setAttribute("r", f1(rg.r * (0.5 + u))); rg.e.setAttribute("opacity", (a * (1 - u) * 0.9).toFixed(2)); });
  gutStop.setAttribute("opacity", sm.la.toFixed(2));
  /* gauges */
  const W5 = m.words;
  gg.pp.set(sm.P, wordOf(sm.P, 0.35, 0.7, ["lowered", "raised", "very high"])); gg.vx.set(sm.Rk, wordOf(sm.Rk, 0.2, 0.5, ["low", "moderate", "high"])); gg.as.set(sm.As, wordOf(sm.As, 0.25, 0.6, ["little", "moderate", "large"]));
  gg.sp.set(sm.Sp, wordOf(sm.Sp, 0.45, 0.75, ["normal", "enlarged", "very large"])); gg.he.set(sm.E, wordOf(sm.E, 0.3, 0.6, ["minimal", "mild", "overt"]));
}
run({ init, step });
