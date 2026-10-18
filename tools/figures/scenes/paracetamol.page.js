/* Paracetamol scene: gut absorption, brain central action, liver NAPQI and NAC rescue. */
const layers = { parts: $("parts"), cells: $("cells"), heps: $("heps"), over: $("over"), panel: $("panel") };
let gutO = null, liverO = null, brainO = null, capEl = null, capKey = "";
let trDrug = null, trIn = null, trBlood = null, trPain = null;
let cellsBox = [330, 450, 250, 330], liverBox = [340, 570, 200, 340], gutBox = [90, 215, 250, 375];
let recepX = 780, recepY = 185;
const cypX = 300, cypY = 375, nacX = 620, nacY = 369;
function initOrgans() {
  gutO = organ($("gutSlot"), "bowel", 150, 310, 150, {});
  liverO = organ($("liverSlot"), "liver", 455, 255, 225, {});
  brainO = organ($("brainSlot"), "brain", 795, 195, 185, {});
  const GP = gutO.ports, LP = liverO.ports, BP = brainO.ports;
  const go = GP.out, pp = LP.porta, hv = LP.hepvein;
  $("vesselDrug").setAttribute("d", "M" + f1(go[0]) + " " + f1(go[1]) + " L" + f1(pp[0]) + " " + f1(pp[1]));
  $("vesselBlood").setAttribute("d", "M" + f1(hv[0]) + " " + f1(hv[1])
    + " C" + f1(hv[0] + 60) + " " + f1(hv[1] - 40) + " " + f1(hv[0] + 140) + " " + f1(hv[1] - 40)
    + " " + f1(BP.carotid[0]) + " " + f1(BP.carotid[1]));
  const tint = $("injTint");
  tint.setAttribute("cx", f1(liverO.x)); tint.setAttribute("cy", f1(liverO.y));
  tint.setAttribute("rx", f1(liverO.w * 0.48)); tint.setAttribute("ry", "72");
  trDrug = track([go, [(go[0] + pp[0]) / 2, (go[1] + pp[1]) / 2], pp]);
  trIn = track([pp, [(pp[0] + hv[0]) / 2, (pp[1] + hv[1]) / 2 - 10], hv]);
  trBlood = track([hv, [hv[0] + 60, hv[1] - 40], [hv[0] + 140, hv[1] - 40], BP.carotid]);
  const par = BP.parenchyma;
  recepX = par[0]; recepY = par[1];
  trPain = track([[890, 335], [860, 300], [830, 250], par]);
  const lobe = LP.lobe, coils = GP.coils;
  cellsBox = [Math.round(lobe[0] - 50), Math.round(lobe[0] + 70), Math.round(lobe[1] - 40), Math.round(lobe[1] + 45)];
  liverBox = [Math.round(liverO.x - 110), Math.round(liverO.x + 110), Math.round(liverO.y - 70), Math.round(liverO.y + 75)];
  gutBox = [Math.round(coils[0] - 65), Math.round(coils[0] + 65), Math.round(coils[1] - 60), Math.round(coils[1] + 60)];
}
function capText(l, d) {
  if (d === 1) {
    if (l === 0) return "Therapeutic dose. NAC adds little here. The liver clears the small NAPQI load.";
    return "Overdose. NAC restores glutathione. NAPQI is cleared and liver cells recover.";
  }
  if (d === 2) {
    if (l === 0) return "Therapeutic dose. Charcoal traps drug in the gut. Less reaches the brain, so pain eases less.";
    return "Overdose. Charcoal traps drug in the gut. Less reaches the liver, so injury is less.";
  }
  if (l === 0) return "Therapeutic dose. Drug reaches the brain and eases pain. The liver clears the small NAPQI load.";
  if (l === 1) return "Overdose. Glutathione runs out and free NAPQI injures liver cells.";
  return "Late overdose. Glutathione is gone and free NAPQI injures liver cells widely.";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, fate: 0, max: 1 }; }); }
const para = pool(26, () => mk("circle", { class: "sc-p p-para", r: 3.2 }, layers.parts));
const pain = pool(14, () => mk("circle", { class: "sc-p p-pain", r: 2.6 }, layers.parts));
const nap = pool(22, () => mk("path", { class: "sc-p p-nap", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const gshp = pool(16, () => mk("circle", { class: "sc-p p-gsh", r: 2.4 }, layers.parts));
const nacp = pool(14, () => mk("circle", { class: "sc-p p-nacp", r: 2.6 }, layers.parts));
const charp = pool(10, () => mk("circle", { class: "sc-p p-charp", r: 3 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- central receptor with docked drug dots, in the brain ---- */
let recep = null;
const dockDots = [];
function initBrain() {
  const g = mk("g", {}, layers.cells);
  mk("circle", { class: "pm-recep", r: 16 }, g);
  for (let i = 0; i < 3; i++) { const t = (i / 3) * 6.28; dockDots.push(mk("circle", { class: "pm-dock", r: 4, cx: f1(Math.cos(t) * 16), cy: f1(Math.sin(t) * 16), opacity: "0" }, g)); }
  recep = { g };
  place(recep.g, recepX, recepY, 0, 1);
}
/* ---- hepatocytes with an injury overlay each, over the liver ---- */
const heps = [];
function initHeps() {
  const lobe = liverO.ports.lobe;
  [[-28, -16, 13], [12, -22, 12], [-6, 14, 13], [30, 8, 11]].forEach(([dx, dy, r], i) => {
    const g = cell(layers.heps, { cls: "hep", r, nuc: 0.4, seed: i * 3 + 1, wob: 0.1 });
    place(g, lobe[0] + dx, lobe[1] + dy, 0, 1);
    const inj = mk("circle", { class: "pm-inj", r: (r * 0.62).toFixed(1), opacity: "0" }, g);
    heps.push({ g, x: lobe[0] + dx, y: lobe[1] + dy, inj, ph: i * 1.7 });
  });
}
/* ---- gauges and labels ---- */
const gg = {};
let charPill = null, nacPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["pain", "Pain", "g-pain", "Pain still felt after the drug acts in the brain. Charcoal lowers absorption, so pain eases less."],
    ["fever", "Fever", "g-fever", "Fever still present after the brain set point is lowered."],
    ["sw", "Swelling", "g-sw", "Swelling at the inflamed site. It changes little because the effect outside the brain is weak."],
    ["nap", "Free NAPQI", "g-nap", "Reactive NAPQI not yet cleared by glutathione. High levels injure liver cells."],
    ["gsh", "Glutathione", "g-gsh", "The liver store that clears NAPQI. Overdose empties it and N-acetylcysteine restores it."],
    ["inj", "Liver injury", "g-inj", "Liver cell injury from free NAPQI. Grows as glutathione runs out and eases with rescue."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  const mid = trDrug.at(0.5);
  pill(ox, "Gut", gutO.ports.coils[0], gutO.ports.coils[1], 105, 215, "Gut: drug is absorbed here into the blood.");
  pill(ox, "Drug", mid.x, mid.y, 290, 252, "Absorbed drug travels in blood to the brain and the liver.");
  pill(ox, "Liver", liverO.ports.out[0], liverO.ports.out[1], 455, 108, "Liver: most drug leaves by safe routes. A small part becomes NAPQI.");
  pill(ox, "Brain", brainO.ports.frontal[0], brainO.ports.frontal[1], 805, 88, "Brain: drug docks on central targets, so pain eases and fever falls.");
  pill(ox, "NAPQI", (cypX + cellsBox[0]) / 2, (cypY + cellsBox[2]) / 2, 300, 402, "NAPQI: toxic unless glutathione clears it. Free NAPQI injures liver cells.");
  pill(ox, "Glutathione", 460, 360, 460, 398, "Glutathione store that clears NAPQI. Overdose empties it.");
  charPill = pill(ox, "Charcoal", 95, 350, 95, 402, "Charcoal traps drug in the gut so less is absorbed.");
  nacPill = pill(ox, "NAC", nacX, nacY, 700, 348, "NAC restores glutathione so NAPQI is cleared.");
  capEl = mk("text", { class: "pm-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 0);
}
const sm = { D: 0.45, cent: 0.9, pain: 0.31, fever: 0.29, inflam: 0.73, prod: 0.06, gsh: 0.93, freeN: 0, inj: 0, nac: 0, chr: 0 };
const acc = { para: 0, pain: 0, nap: 0, gsh: 0, nac: 0, char: 0 };
function init() { initOrgans(); initBrain(); initHeps(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.D = lerp(sm.D, m.D, k); sm.cent = lerp(sm.cent, m.cent, k); sm.pain = lerp(sm.pain, m.pain, k); sm.fever = lerp(sm.fever, m.fever, k);
  sm.inflam = lerp(sm.inflam, m.inflam, k); sm.prod = lerp(sm.prod, m.prod, k); sm.gsh = lerp(sm.gsh, m.gsh, k);
  sm.freeN = lerp(sm.freeN, m.freeN, k); sm.inj = lerp(sm.inj, m.inj, k); sm.nac = lerp(sm.nac, m.nac, k); sm.chr = lerp(sm.chr, m.chr, k);
  /* static nodes follow the model */
  $("injTint").setAttribute("opacity", (sm.inj * 0.5).toFixed(2));
  dockDots.forEach((d, i) => d.setAttribute("opacity", (sm.cent * (0.55 + 0.45 * Math.abs(Math.sin(tm / 600 + i * 2.1)))).toFixed(2)));
  recep.g.style.opacity = (0.35 + 0.65 * sm.cent).toFixed(2);
  const gf = $("gshFill");
  gf.setAttribute("width", f1(178 * sm.gsh));
  gf.style.fill = sm.gsh < 0.3 ? "#e5484d" : sm.gsh < 0.65 ? "#e9b84a" : "";
  $("charDots").setAttribute("opacity", sm.chr.toFixed(2));
  const cypS = 1 + 0.3 * sm.prod * Math.sin(tm / 300);
  $("cyp").setAttribute("transform", "translate(" + cypX + " " + cypY + ") scale(" + cypS.toFixed(3) + ") translate(-" + cypX + " -" + cypY + ")");
  const nacS = 1 + 0.12 * sm.nac * Math.sin(tm / 320);
  $("nacNode").setAttribute("transform", "translate(" + nacX + " " + nacY + ") scale(" + nacS.toFixed(3) + ") translate(-" + nacX + " -" + nacY + ")");
  charPill.style.opacity = sm.chr.toFixed(2); nacPill.style.opacity = sm.nac.toFixed(2);
  heps.forEach((hp) => { place(hp.g, hp.x + Math.sin(tm / 1500 + hp.ph) * 1.5, hp.y + Math.cos(tm / 1800 + hp.ph) * 1.5, 0, 1); hp.inj.setAttribute("opacity", sm.inj.toFixed(2)); });
  /* drug from the gut: onward to the liver, some through to the brain */
  acc.para += dt * (1 + sm.D * 9); while (acc.para >= 1) { acc.para--; const p = free(para); if (p) { emit(p, (gutBox[0] + gutBox[1]) / 2 + rnd(-25, 25), (gutBox[2] + gutBox[3]) / 2 + rnd(-20, 20), rnd(-8, 8), rnd(-8, 8), 0); p.st = 0; p.t = 0; p.e.setAttribute("class", "sc-p p-para");
    if (Math.random() < 0.7 * sm.chr) p.fate = 3; else { p.fate = 0; if (Math.random() < 0.3) p.k = 1; } } }
  para.forEach((p) => { if (!p.on) return;
    if (p.st === 0) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, gutBox[0], gutBox[1]); p.y = clamp(p.y, gutBox[2], gutBox[3]); place(p.e, p.x, p.y, 0, 1);
      if (p.t > 0.9) { if (p.fate === 3) { p.st = 5; p.e.setAttribute("class", "sc-p p-charp"); } else { p.tr = trDrug; p.u = 0; p.st = 1; } } }
    else if (p.st === 1 || p.st === 2 || p.st === 6) { if (p.st === 1) p.tr = p.tr || trDrug; p.u += dt * 90 / p.tr.len; const q = p.tr.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1);
      if (p.u >= 1) { if (p.st === 1 && p.k === 1) { p.tr = trIn; p.u = 0; p.st = 2; }
        else if (p.st === 1) { p.st = 3; p.t = 0; p.vx = rnd(-10, 10); p.vy = rnd(-8, 8); }
        else if (p.st === 2) { p.tr = trBlood; p.u = 0; p.st = 6; }
        else { p.st = 7; p.t = 0; } } }
    else if (p.st === 3) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, liverBox[0], liverBox[1]); p.y = clamp(p.y, liverBox[2], liverBox[3]); place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4) kill(p); }
    else if (p.st === 7) { p.t += dt; place(p.e, recepX + Math.sin(tm / 300 + p.t * 5) * 3, recepY + Math.cos(tm / 340 + p.t * 5) * 3, 0, 1); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4) kill(p); }
    else { p.x += p.vx * dt * 0.3; p.y += 30 * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - gutBox[2]) / 60).toFixed(2)); if (p.y > gutBox[3] - 4) kill(p); } });
  /* pain signals run toward the brain and fade where the drug blocks them */
  acc.pain += dt * (0.4 + sm.pain * 7); while (acc.pain >= 1) { acc.pain--; const p = free(pain); if (p) { emit(p, 0, 0, 0, 0, 0); p.u = 0; p.max = 1 - 0.72 * sm.cent; p.e.setAttribute("opacity", "1"); } }
  pain.forEach((p) => { if (!p.on) return; p.u += dt * 0.45; const q = trPain.at(Math.min(1, Math.max(0, p.u))); const fr = clamp(p.u / Math.max(0.05, p.max));
    place(p.e, q.x, q.y, 0, 1.05 - 0.65 * fr); p.e.setAttribute("opacity", clamp((p.max - p.u) / 0.2).toFixed(2)); if (p.u >= p.max) kill(p); });
  /* NAPQI from CYP toward liver cells, cleared faster with NAC */
  acc.nap += dt * (0.4 + sm.prod * 12); while (acc.nap >= 1) { acc.nap--; const p = free(nap); if (p) emit(p, cypX + rnd(-6, 6), cypY + rnd(-6, 6), rnd(35, 60), rnd(-25, 5), 0); }
  const napLife = 6 - 4 * sm.nac;
  nap.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; const fr = clamp(p.t / napLife);
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 280, 620)) + " " + f1(clamp(p.y, 220, 415)) + ") rotate(" + f1(tm / 6) + ") scale(" + (1 - 0.55 * fr).toFixed(3) + ")");
    p.e.setAttribute("opacity", clamp(1 - (fr - 0.55) / 0.45).toFixed(2)); if (p.t > napLife || p.x > cellsBox[1] - 15) kill(p); });
  /* glutathione drift from the tank to the cells */
  acc.gsh += dt * (0.5 + sm.gsh * 7); while (acc.gsh >= 1) { acc.gsh--; const p = free(gshp); if (p) emit(p, 470 + rnd(-60, 70), 360 + rnd(-6, 8), -rnd(25, 45), rnd(-6, 6), 0); }
  gshp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 300, 560)) + " " + f1(clamp(p.y, 250, 380)) + ")"); if (p.t > 5 || p.x < cellsBox[1] - 10) kill(p); });
  /* NAC particles from the NAC node to the store and the cells */
  acc.nac += dt * sm.nac * 10; while (acc.nac >= 1) { acc.nac--; const p = free(nacp); if (p) emit(p, nacX + rnd(-8, 8), nacY + rnd(-8, 8), -rnd(35, 60), rnd(-12, 8), 0); }
  nacp.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 330, 640)) + " " + f1(clamp(p.y, 250, 400)) + ")"); if (p.x < cellsBox[0] + 20) kill(p); });
  /* charcoal grains held in the gut */
  acc.char += dt * sm.chr * 8; while (acc.char >= 1) { acc.char--; const p = free(charp); if (p) emit(p, (gutBox[0] + gutBox[1]) / 2 + rnd(-30, 30), (gutBox[2] + gutBox[3]) / 2 + rnd(-25, 25), rnd(-6, 6), rnd(-6, 6), 0); }
  charp.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt + rnd(-8, 8) * dt, gutBox[0], gutBox[1]); p.y = clamp(p.y + p.vy * dt + rnd(-8, 8) * dt, gutBox[2], gutBox[3]); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3) kill(p); });
  /* gauges */
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.35, 0.62, ["eased", "partly eased", "still present"]));
  gg.fever.set(sm.fever, wordOf(sm.fever, 0.35, 0.6, ["down", "settling", "still high"]));
  gg.sw.set(sm.inflam, wordOf(sm.inflam, 0.4, 0.65, ["less", "some", "stays"]));
  gg.nap.set(sm.freeN, wordOf(sm.freeN, 0.12, 0.38, ["none", "some", "high"]));
  gg.gsh.set(sm.gsh, wordOf(sm.gsh, 0.3, 0.65, ["depleted", "low", "ample"]));
  gg.inj.set(sm.inj, wordOf(sm.inj, 0.2, 0.55, ["none", "some", "widespread"]));
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
