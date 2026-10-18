/* Paracetamol scene: safe conjugation, a small NAPQI stream, glutathione detox, saturation, centrilobular necrosis. */
const layers = { gut: $("gutCells"), liver: $("liverCells"), parts: $("parts"), over: $("over"), panel: $("panel") };
/* ---- hepatocytes in a row, centre cells are centrilobular ---- */
const heps = [];
function initHeps() {
  for (let i = 0; i < 8; i++) {
    const x = 292 + i * 52, y = 362;
    const c = cell(layers.liver, { cls: "hep", r: 20, nuc: 0.38, seed: i * 3 + 2, wob: 0.1 });
    place(c, x, y, 0, 1);
    const ov = mk("circle", { class: "pc-nec", cx: x, cy: y, r: 13, opacity: "0" }, layers.liver);
    heps.push({ c, ov, x, y, cent: 1 - Math.abs(i - 3.5) / 3.5 });
  }
  mk("circle", { class: "pc-vein", cx: 480, cy: 362, r: 9 }, layers.liver);
}
/* ---- tablets in the gut ---- */
const tabs = [];
function initTabs() {
  for (let i = 0; i < 6; i++) {
    const g = mk("g", {}, layers.gut);
    mk("rect", { class: "p-pill", x: -9, y: -4, width: 18, height: 8, rx: 4 }, g);
    mk("rect", { class: "p-pill2", x: 0, y: -4, width: 9, height: 8, rx: 4 }, g);
    tabs.push({ g, x: 92 + (i % 3) * 28, y: 188 + Math.floor(i / 3) * 34, rot: i * 37, i });
  }
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, lane: 0 }; }); }
const para = pool(24, () => mk("circle", { class: "sc-p p-para", r: 3.6 }, layers.parts));
const safeP = pool(26, () => mk("circle", { class: "sc-p p-safe", r: 3.2 }, layers.parts));
const napP = pool(20, () => mk("path", { class: "sc-p p-napqi", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const nacP = pool(12, () => mk("circle", { class: "sc-p p-nac", r: 2.8 }, layers.parts));
const charP = pool(12, () => mk("circle", { class: "p-char", r: 3.4 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, lane) { p.on = true; p.x = x; p.y = y; p.t = 0; p.lane = lane || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The liver";
  [["safe", "Safe pathways", "g-safe", "Glucuronidation and sulphation: the main safe routes that make paracetamol water soluble for excretion."], ["nap", "Free NAPQI", "g-nap", "NAPQI left over after glutathione is used up. This reactive product binds to hepatocyte proteins."], ["gsh", "Glutathione", "g-gsh", "Glutathione store in hepatocytes. It joins to NAPQI and makes it harmless, but the store is limited."], ["nec", "Necrosis", "g-nec", "Death of hepatocytes, worst around the central vein (centrilobular), where NAPQI formation is greatest."], ["fun", "Liver function", "g-fun", "How well the liver is working overall. It falls when necrosis is widespread and may recover or need replacement."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Paracetamol", 120, 148, 120, 96, "Paracetamol tablets taken by mouth and absorbed from the gut into blood reaching the liver.");
  pill(ox, "Glucuronidation", 380, 120, 400, 108, "Glucuronidation: the main safe pathway in adults. Paracetamol is joined to glucuronic acid and excreted.");
  pill(ox, "Sulphation", 380, 174, 400, 164, "Sulphation: another safe pathway. It has a smaller capacity and saturates earlier in overdose.");
  pill(ox, "CYP pathway", 505, 236, 500, 216, "A small fraction is oxidised by cytochrome P450 enzymes to the reactive product NAPQI.");
  pill(ox, "NAPQI", 590, 236, 610, 216, "NAPQI: a reactive toxic product. Normally tiny amounts are detoxified at once by glutathione.");
  pill(ox, "Glutathione", 360, 284, 360, 278, "Glutathione store. It detoxifies NAPQI, but in overdose the store runs out and free NAPQI accumulates.");
  pill(ox, "Hepatocytes", 624, 344, 620, 328, "Liver cells (hepatocytes). Free NAPQI binds their proteins and they die, worst near the central vein.");
  pill(ox, "Safe products", 810, 114, 815, 96, "Glucuronide and sulphate products: water soluble, harmless, and excreted in urine.");
  pill(ox, "Liver failure", 815, 264, 815, 252, "Liver failure: when necrosis is widespread the liver cannot do its jobs. This is a late, life threatening stage.");
  const cp = pill(ox, "Charcoal", 120, 262, 120, 322, "Activated charcoal in the gut, given early, binds paracetamol and reduces how much is absorbed.");
  cp.setAttribute("id", "char-pill");
  const np = pill(ox, "NAC", 492, 306, 560, 282, "N-acetylcysteine (NAC): provides cysteine to rebuild glutathione, so more NAPQI can be detoxified.");
  np.setAttribute("id", "nac-pill");
  const tp = pill(ox, "Transplant", 815, 344, 815, 368, "Liver transplant: replaces a liver that has failed and cannot recover. A last resort, not an antidote.");
  tp.setAttribute("id", "tx-pill");
}
const sm = { D: 0.3, sat: 0.4, prod: 0.1, gsh: 0.9, freeN: 0, nec: 0, fun: 1, chr: 0, nac: 0, txp: 0 };
const acc = { para: 0, safe: 0, nap: 0, nac: 0, chr: 0 };
function init() { initTabs(); initHeps(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.D = lerp(sm.D, m.D, k2); sm.sat = lerp(sm.sat, m.sat, k2); sm.prod = lerp(sm.prod, m.prod, k2);
  sm.gsh = lerp(sm.gsh, m.gsh, k1); sm.freeN = lerp(sm.freeN, m.freeN, k2); sm.nec = lerp(sm.nec, m.nec, k2);
  sm.fun = lerp(sm.fun, m.fun, k1); sm.chr = lerp(sm.chr, m.chr, k1); sm.nac = lerp(sm.nac, m.nac, k1); sm.txp = lerp(sm.txp, m.txp, k1);
  /* tablets: more visible with dose, trapped and still with charcoal */
  tabs.forEach((tb, i) => { const vis = i < Math.round(1 + sm.D * 5); const sc = vis ? 1 : 0.12; place(tb.g, tb.x + Math.sin(tm / 800 + i) * 2, tb.y + Math.cos(tm / 900 + i) * 2, tb.rot, sc); tb.g.style.opacity = vis ? (1 - sm.chr * 0.35).toFixed(2) : 0.12; });
  /* glutathione tank fill and failure glow */
  const gf = $("gshFill"); if (gf) { gf.setAttribute("width", f1(168 * clamp(sm.gsh))); gf.setAttribute("opacity", (0.35 + 0.65 * clamp(sm.gsh)).toFixed(2)); }
  const fg = $("failGlow"); if (fg) fg.setAttribute("opacity", (clamp(1 - sm.fun) * 0.85).toFixed(2));
  const lv = $("liverGlow"); if (lv) lv.setAttribute("opacity", (sm.txp * 0.7).toFixed(2));
  /* hepatocyte necrosis, centre first */
  heps.forEach((hp) => { const s = clamp(sm.nec * (0.35 + 0.85 * hp.cent)); hp.ov.setAttribute("opacity", (s * 0.9).toFixed(2)); hp.ov.setAttribute("r", f1(6 + 11 * s)); });
  /* paracetamol: gut to liver entry, then split by lane */
  acc.para += dt * (1.5 + sm.D * 6);
  while (acc.para >= 1) { acc.para--; const p = freeP(para); if (p) { const r = Math.random(); const lane = r < sm.sat * 0.62 ? (Math.random() < 0.6 ? 0 : 1) : 2; emit(p, 150, 210, lane); } }
  para.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.x < 282) { p.x += 62 * dt; p.y += (210 - p.y) * dt * 2; }
    else { const ly = [138, 192, 252][p.lane]; p.y += (ly - p.y) * Math.min(1, dt * 4); p.x += 74 * dt;
      if (p.lane < 2 && p.x > 560) { const s = freeP(safeP); if (s) emit(s, p.x, p.y, p.lane); kill(p); }
      else if (p.lane === 2 && p.x > 556) { const s = freeP(napP); if (s) { emit(s, 584, 252, Math.random() < clamp(sm.gsh * 1.15) ? 0 : 1); } kill(p); } }
    if (p.x > 700) kill(p);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* safe products to the exit nodes */
  safeP.forEach((p) => { if (!p.on) return; const ty = p.lane === 0 ? 138 : 192; p.x += 88 * dt; p.y += (ty - p.y) * Math.min(1, dt * 5); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 806) kill(p); });
  /* NAPQI: detox to the tank, or on to hepatocytes */
  napP.forEach((p) => { if (!p.on) return; p.t += dt;
    if (p.lane === 0) { p.x += (368 - p.x) * dt * 1.6; p.y += (312 - p.y) * dt * 1.6; if (Math.hypot(368 - p.x, 312 - p.y) < 14) kill(p); }
    else { p.x += (480 - p.x) * dt * 1.1; p.y += (356 - p.y) * dt * 1.1; if (Math.hypot(480 - p.x, 356 - p.y) < 16) kill(p); }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.t > 5) kill(p); });
  /* NAC particles drifting to the glutathione tank */
  acc.nac += dt * sm.nac * 5; while (acc.nac >= 1) { acc.nac--; const p = freeP(nacP); if (p) emit(p, 548, 292, 0); }
  nacP.forEach((p) => { if (!p.on) return; p.x += (390 - p.x) * dt * 1.4; p.y += (312 - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (Math.hypot(390 - p.x, 312 - p.y) < 12) kill(p); });
  /* charcoal specks binding in the gut */
  acc.chr += dt * sm.chr * 6; while (acc.chr >= 1) { acc.chr--; const p = freeP(charP); if (p) emit(p, rnd(78, 162), rnd(172, 248), 0); }
  charP.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x + Math.sin(tm / 300 + p.y) * 3) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", (sm.chr * clamp(1.4 - p.t / 3)).toFixed(2)); if (p.t > 4) kill(p); });
  /* treatment pills fade with their treatment */
  const cp2 = $("char-pill"); if (cp2) cp2.style.opacity = sm.chr.toFixed(2);
  const np2 = $("nac-pill"); if (np2) np2.style.opacity = sm.nac.toFixed(2);
  const tp2 = $("tx-pill"); if (tp2) tp2.style.opacity = sm.txp.toFixed(2);
  /* gauges */
  gg.safe.set(sm.sat, wordOf(sm.sat, 0.35, 0.7, ["plenty", "busy", "saturated"]));
  gg.nap.set(sm.freeN, wordOf(sm.freeN, 0.12, 0.38, ["none", "some", "high"]));
  gg.gsh.set(sm.gsh, wordOf(sm.gsh, 0.3, 0.65, ["depleted", "low", "ample"]));
  gg.nec.set(sm.nec, wordOf(sm.nec, 0.2, 0.55, ["none", "some", "widespread"]));
  gg.fun.set(sm.fun, wordOf(sm.fun, 0.35, 0.7, ["failed", "impaired", "normal"]));
}
run({ init, step });
