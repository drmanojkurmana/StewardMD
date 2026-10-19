/* Paracetamol scene: gut absorption, safe routes to the kidney, CYP to NAPQI, glutathione store, centrilobular necrosis. */
const layers = { gut: $("gutCells"), hep: $("hepG"), parts: $("parts"), over: $("over"), panel: $("panel") };
let gutO = null, liverO = null, kidneyO = null, capEl = null, capKey = "";
let trDrug = null, trSafeA = null, trSafeB = null;
let gutBox = [88, 208, 218, 318], cluster = [450, 250], cyp = [505, 285], napNode = [555, 290], nacNode = [600, 255], tank = [600, 296, 130, 34];
function initOrgans() {
  gutO = organ($("gutSlot"), "bowel", 145, 265, 150, {});
  liverO = organ($("liverSlot"), "liver", 455, 235, 225, {});
  kidneyO = organ($("kidneySlot"), "kidney", 815, 215, 130, {});
  const GP = gutO.ports, LP = liverO.ports, KP = kidneyO.ports;
  const go = GP.out, pp = LP.porta, hv = LP.hepvein, kin = KP.in, kout = KP.out;
  const midD = [(go[0] + pp[0]) / 2, (go[1] + pp[1]) / 2 + 4];
  $("vesselDrug").setAttribute("d", "M" + f1(go[0]) + " " + f1(go[1]) + " L" + f1(midD[0]) + " " + f1(midD[1]) + " L" + f1(pp[0]) + " " + f1(pp[1]));
  const mx = (hv[0] + kin[0]) / 2, my = (hv[1] + kin[1]) / 2;
  const nx = -(kin[1] - hv[1]), ny = kin[0] - hv[0], nl = Math.hypot(nx, ny) || 1;
  const mA = [mx + nx / nl * 10, my + ny / nl * 10], mB = [mx - nx / nl * 10, my - ny / nl * 10];
  $("vesselSafe").setAttribute("d", "M" + f1(hv[0]) + " " + f1(hv[1])
    + " C" + f1(hv[0] + 90) + " " + f1(hv[1] - 8) + " " + f1(kin[0] - 90) + " " + f1(kin[1] - 8)
    + " " + f1(kin[0]) + " " + f1(kin[1]));
  trDrug = track([go, midD, pp]);
  trSafeA = track([hv, mA, kin]);
  trSafeB = track([hv, mB, kin]);
  const coils = GP.coils;
  gutBox = [Math.round(coils[0] - 60), Math.round(coils[0] + 60), Math.round(coils[1] - 50), Math.round(coils[1] + 50)];
  cluster = [liverO.x - 5, liverO.y + 15];
  cyp = [liverO.x + 50, liverO.y + 50];
  napNode = [liverO.x + 100, liverO.y + 55];
  nacNode = [tank[0], 255];
  const tint = $("injTint");
  tint.setAttribute("cx", f1(liverO.x)); tint.setAttribute("cy", f1(cluster[1]));
  tint.setAttribute("rx", f1(liverO.w * 0.48)); tint.setAttribute("ry", "72");
  const glow = $("txGlow");
  glow.setAttribute("cx", f1(liverO.x)); glow.setAttribute("cy", f1(liverO.y));
  glow.setAttribute("rx", f1(liverO.w * 0.52)); glow.setAttribute("ry", "92");
  $("cyp").setAttribute("cx", f1(cyp[0])); $("cyp").setAttribute("cy", f1(cyp[1]));
  $("napqiNode").setAttribute("points", f1(napNode[0]) + "," + f1(napNode[1] - 14) + " " + f1(napNode[0] + 14) + "," + f1(napNode[1])
    + " " + f1(napNode[0]) + "," + f1(napNode[1] + 14) + " " + f1(napNode[0] - 14) + "," + f1(napNode[1]));
  $("nacNode").setAttribute("cx", f1(nacNode[0])); $("nacNode").setAttribute("cy", f1(nacNode[1]));
  $("tank").setAttribute("x", tank[0]); $("tank").setAttribute("y", tank[1]);
  $("tank").setAttribute("width", tank[2]); $("tank").setAttribute("height", tank[3]);
  $("tankFill").setAttribute("x", f1(tank[0] + 6)); $("tankFill").setAttribute("y", f1(tank[1] + 6));
}
function capText(l, d) {
  if (d === 1) {
    if (l === 2) return "Late failure. Charcoal comes too late. It cannot undo liver injury.";
    if (l === 1) return "Overdose. Charcoal traps drug in the gut. Less reaches the liver, so injury is less.";
    return "Therapeutic dose. Charcoal traps some drug in the gut. Less is absorbed.";
  }
  if (d === 2) {
    if (l === 0) return "Therapeutic dose. NAC adds little here. The liver clears the small NAPQI load.";
    if (l === 1) return "Overdose. NAC restores glutathione. NAPQI is cleared and liver cells survive.";
    return "Late failure. NAC restores some glutathione, but many cells have already died.";
  }
  if (d === 3) {
    if (l === 0) return "Therapeutic dose. A new liver is not needed. The liver clears the load.";
    if (l === 1) return "Overdose. A new liver replaces the injured one. It works normally.";
    return "Late failure. A new liver replaces the failed one. It works normally.";
  }
  if (l === 0) return "Therapeutic dose. Safe routes clear the drug. Almost no NAPQI forms.";
  if (l === 1) return "Overdose. Safe routes are full and glutathione runs out. Free NAPQI kills liver cells.";
  return "Late failure. Glutathione is gone and many liver cells have died. The liver fails.";
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null, fate: 0 }; }); }
const para = pool(24, () => mk("circle", { class: "sc-p p-para", r: 3.6 }, layers.parts));
const safeP = pool(26, () => mk("circle", { class: "sc-p p-safe", r: 3.2 }, layers.parts));
const napP = pool(20, () => mk("path", { class: "sc-p p-napqi", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const nacP = pool(12, () => mk("circle", { class: "sc-p p-nac", r: 2.8 }, layers.parts));
const charP = pool(12, () => mk("circle", { class: "sc-p p-charp", r: 3.4 }, layers.parts));
const urineP = pool(10, () => mk("circle", { class: "sc-p p-safe", r: 3 }, layers.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- tablets in the gut ---- */
const tabs = [];
function initTabs() {
  for (let i = 0; i < 6; i++) {
    const g = mk("g", {}, layers.gut);
    mk("rect", { class: "p-pill", x: -9, y: -4, width: 18, height: 8, rx: 4 }, g);
    mk("rect", { class: "p-pill2", x: 0, y: -4, width: 9, height: 8, rx: 4 }, g);
    tabs.push({ g, i, rot: i * 37 });
  }
}
/* ---- liver cells around a central vein, over the liver ---- */
const heps = [];
let vein = null;
function initHeps() {
  [[-18, -20, 13], [20, -16, 12], [-40, 10, 13], [38, 14, 12], [0, 42, 13]].forEach(([dx, dy, r], i) => {
    const g = cell(layers.hep, { cls: "hep", r, nuc: 0.38, seed: i * 3 + 2, wob: 0.1 });
    const dist = Math.hypot(dx, dy);
    const ov = mk("circle", { class: "pc-nec", r: (r * 0.62).toFixed(1), opacity: "0" }, g);
    heps.push({ g, ov, dx, dy, dist, ph: i * 1.7 });
  });
  vein = mk("circle", { class: "pc-vein", r: 8 }, layers.hep);
}
/* ---- labels and gauges ---- */
const gg = {};
let charPill = null, nacPill = null, txPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The liver";
  [["safe", "Safe routes", "g-safe", "Glucuronidation and sulphation: the main safe exits. They have large capacity but fill up in overdose."],
    ["nap", "Free NAPQI", "g-nap", "NAPQI left over after glutathione runs out. It binds liver cell proteins and kills the cells."],
    ["gsh", "Glutathione", "g-gsh", "The store in liver cells that clears NAPQI. Overdose empties it and NAC refills it."],
    ["nec", "Necrosis", "g-nec", "Death of liver cells, worst around the central vein where NAPQI formation is greatest."],
    ["fun", "Liver function", "g-fun", "How well the liver works. It falls when necrosis spreads and returns with a new liver."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over, coils = gutO.ports.coils, kout = kidneyO.ports.out;
  const safeMid = trSafeB.at(0.5);
  pill(ox, "Gut", coils[0] - 28, coils[1] - 63, 105, 150, "Gut: tablets dissolve here. Paracetamol passes into blood heading for the liver.");
  pill(ox, "Liver", liverO.x - 5, liverO.y - 90, 455, 100, "Liver: most paracetamol leaves by safe routes. A small part becomes NAPQI.");
  pill(ox, "Safe routes", safeMid.x, safeMid.y, 600, 100, "Safe routes to the kidney: glucuronidation and sulphation. They fill up in overdose.");
  pill(ox, "Kidney", kidneyO.x - 15, kidneyO.y - 20, 815, 100, "Kidney: safe products leave the blood here and pass out in urine.");
  pill(ox, "NAPQI", napNode[0], napNode[1], 620, 405, "NAPQI: the reactive product of the CYP pathway. Glutathione clears it unless the store runs out.");
  pill(ox, "Glutathione", tank[0] + 65, tank[1] + 34, 665, 362, "Glutathione store. It clears NAPQI, but overdose empties it and NAC refills it.");
  pill(ox, "Liver cells", cluster[0], cluster[1], 300, 405, "Liver cells around the central vein. Free NAPQI kills the nearest cells first.");
  charPill = pill(ox, "Charcoal", coils[0] + 22, coils[1] + 22, 110, 368, "Charcoal traps paracetamol in the gut so less reaches the liver.");
  nacPill = pill(ox, "NAC", nacNode[0], nacNode[1], 700, 255, "NAC refills glutathione so NAPQI is cleared.");
  txPill = pill(ox, "New liver", liverO.x + 112, liverO.y, 700, 200, "A new liver replaces the failed one. It works normally.");
  charPill.style.opacity = "0"; nacPill.style.opacity = "0"; txPill.style.opacity = "0";
  capEl = mk("text", { class: "pc-cap", x: 30, y: 432 }, ox); capEl.textContent = capText(1, 0);
}
const sm = { D: 0.8, sat: 1, prod: 0.43, gsh: 0.45, freeN: 0.3, nec: 0.35, fun: 0.55, chr: 0, nac: 0, txp: 0 };
const acc = { para: 0, nac: 0, chr: 0 };
function init() { initOrgans(); initTabs(); initHeps(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  sm.D = lerp(sm.D, m.D, k2); sm.sat = lerp(sm.sat, m.sat, k2); sm.prod = lerp(sm.prod, m.prod, k2);
  sm.gsh = lerp(sm.gsh, m.gsh, k1); sm.freeN = lerp(sm.freeN, m.freeN, k2); sm.nec = lerp(sm.nec, m.nec, k2);
  sm.fun = lerp(sm.fun, m.fun, k1); sm.chr = lerp(sm.chr, m.chr, k1); sm.nac = lerp(sm.nac, m.nac, k1); sm.txp = lerp(sm.txp, m.txp, k1);
  /* tablets: more with load, dimmed and buried when charcoal traps them */
  tabs.forEach((tb, i) => {
    const vis = i < Math.round(1 + sm.D * 5);
    const bx = gutBox[0] + 30 + (i % 3) * 30, by = gutBox[2] + 32 + Math.floor(i / 3) * 32;
    place(tb.g, bx + Math.sin(tm / 800 + i) * 2, by + Math.cos(tm / 900 + i) * 2, tb.rot, vis ? 1 : 0.12);
    tb.g.style.opacity = vis ? (1 - sm.chr * 0.45).toFixed(2) : 0.12;
  });
  /* liver injury tint, transplant glow, glutathione tank */
  $("injTint").setAttribute("opacity", (sm.nec * 0.4).toFixed(2));
  $("txGlow").setAttribute("opacity", (sm.txp * 0.85).toFixed(2));
  const gf = $("tankFill");
  gf.setAttribute("width", f1((tank[2] - 12) * clamp(sm.gsh)));
  gf.style.fill = sm.gsh < 0.3 ? "#e5484d" : sm.gsh < 0.65 ? "#e9b84a" : "";
  /* nodes pulse with their pathway */
  const cypS = 1 + 0.3 * sm.prod * Math.sin(tm / 300);
  $("cyp").setAttribute("r", f1(9 * cypS));
  const nacS = 1 + 0.15 * sm.nac * Math.sin(tm / 320);
  $("nacG").setAttribute("transform", "translate(" + f1(nacNode[0]) + " " + f1(nacNode[1]) + ") scale(" + nacS.toFixed(3) + ") translate(" + f1(-nacNode[0]) + " " + f1(-nacNode[1]) + ")");
  /* liver cells wobble; nearest the vein die first */
  heps.forEach((hp) => {
    place(hp.g, cluster[0] + hp.dx + Math.sin(tm / 1500 + hp.ph) * 1.5, cluster[1] + hp.dy + Math.cos(tm / 1800 + hp.ph) * 1.5, 0, 1);
    hp.ov.setAttribute("opacity", (clamp(sm.nec * (1.3 - hp.dist / 60)) * 0.92).toFixed(2));
  });
  place(vein, cluster[0], cluster[1], 0, 1);
  vein.style.opacity = (0.25 + 0.75 * sm.fun).toFixed(2);
  /* paracetamol: wander the gut, then ride to the liver and split by saturation */
  acc.para += dt * (1.5 + sm.D * 6) * (1 - 0.4 * sm.chr);
  while (acc.para >= 1) {
    acc.para--;
    const p = freeP(para);
    if (p) {
      emit(p, gutBox[0] + rnd(15, 105), gutBox[2] + rnd(12, 88));
      p.vx = rnd(-8, 8); p.vy = rnd(-8, 8); p.st = 0; p.e.setAttribute("class", "sc-p p-para");
      p.fate = Math.random() < 0.7 * sm.chr ? 3 : 0;
    }
  }
  const safeProb = clamp(0.92 - 0.8 * sm.sat);
  para.forEach((p) => {
    if (!p.on) return;
    if (p.st === 0) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.x = clamp(p.x, gutBox[0], gutBox[1]); p.y = clamp(p.y, gutBox[2], gutBox[3]);
      place(p.e, p.x, p.y, 0, 1);
      if (p.t > 0.9) {
        if (p.fate === 3) { p.st = 5; p.e.setAttribute("class", "sc-p p-charp"); }
        else { p.tr = trDrug; p.u = 0; p.st = 1; }
      }
    } else if (p.st === 1) {
      p.u += dt * 90 / p.tr.len;
      const q = p.tr.at(Math.min(1, p.u));
      place(p.e, q.x, q.y, 0, 1);
      if (p.u >= 1) {
        if (Math.random() < safeProb) {
          const s = freeP(safeP);
          if (s) { emit(s, q.x, q.y); s.tr = Math.random() < 0.5 ? trSafeA : trSafeB; s.u = 0; s.st = 1; }
        } else {
          const s = freeP(napP);
          if (s) { emit(s, cyp[0] + rnd(-5, 5), cyp[1] + rnd(-5, 5)); s.fate = Math.random() < clamp(sm.gsh * 1.15) ? 0 : 1; s.st = 0; }
        }
        kill(p);
      }
    } else {
      p.t += dt * 0.5; p.y += 26 * dt;
      place(p.e, p.x + Math.sin(tm / 300 + p.y) * 2, p.y, 0, 1);
      p.e.setAttribute("opacity", clamp(1.2 - p.t / 2.4).toFixed(2));
      if (p.t > 2.6 || p.y > gutBox[3] + 14) kill(p);
    }
  });
  /* safe products ride to the kidney, then leave in urine */
  safeP.forEach((p) => {
    if (!p.on) return;
    p.u += dt * 95 / p.tr.len;
    const q = p.tr.at(Math.min(1, p.u));
    place(p.e, q.x, q.y, 0, 1);
    if (p.u >= 1) {
      kill(p);
      const u = freeP(urineP), kout = kidneyO.ports.out;
      if (u) { emit(u, kout[0] + rnd(-6, 10), kout[1]); u.vy = rnd(50, 70); }
    }
  });
  urineP.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.y += p.vy * dt;
    place(p.e, p.x, p.y, 0, 1);
    p.e.setAttribute("opacity", clamp(1 - (p.y - 290) / 70).toFixed(2));
    if (p.y > 366) kill(p);
  });
  /* NAPQI: cleared into the store, or on to the liver cells */
  const tankC = [tank[0] + 65, tank[1] + 17];
  napP.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    const tx = p.fate === 0 ? tankC[0] : cluster[0], ty = p.fate === 0 ? tankC[1] : cluster[1];
    p.x += (tx - p.x) * dt * 1.6; p.y += (ty - p.y) * dt * 1.6;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")");
    if (Math.hypot(tx - p.x, ty - p.y) < 14 || p.t > 5) kill(p);
  });
  /* NAC particles stream from the NAC node into the store */
  acc.nac += dt * sm.nac * 8;
  while (acc.nac >= 1) { acc.nac--; const p = freeP(nacP); if (p) emit(p, nacNode[0] + rnd(-8, 8), nacNode[1] + rnd(-8, 8)); }
  nacP.forEach((p) => {
    if (!p.on) return;
    p.x += (tankC[0] - p.x) * dt * 1.5; p.y += (tankC[1] - p.y) * dt * 1.5;
    place(p.e, p.x, p.y, 0, 1);
    if (Math.hypot(tankC[0] - p.x, tankC[1] - p.y) < 12) kill(p);
  });
  /* charcoal grains held in the gut */
  acc.chr += dt * sm.chr * 7;
  while (acc.chr >= 1) { acc.chr--; const p = freeP(charP); if (p) emit(p, gutBox[0] + rnd(10, 110), gutBox[2] + rnd(8, 92)); }
  charP.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    place(p.e, p.x + Math.sin(tm / 300 + p.y) * 3, p.y, 0, 1);
    p.e.setAttribute("opacity", (sm.chr * clamp(1.4 - p.t / 3)).toFixed(2));
    if (p.t > 4) kill(p);
  });
  /* treatment pills show only with their treatment */
  charPill.style.opacity = sm.chr.toFixed(2);
  nacPill.style.opacity = sm.nac.toFixed(2);
  txPill.style.opacity = sm.txp.toFixed(2);
  /* gauges */
  gg.safe.set(sm.sat, wordOf(sm.sat, 0.5, 0.85, ["plenty", "busy", "full"]));
  gg.nap.set(sm.freeN, wordOf(sm.freeN, 0.12, 0.38, ["none", "some", "high"]));
  gg.gsh.set(sm.gsh, wordOf(sm.gsh, 0.3, 0.65, ["depleted", "low", "ample"]));
  gg.nec.set(sm.nec, wordOf(sm.nec, 0.2, 0.55, ["none", "some", "widespread"]));
  gg.fun.set(sm.fun, wordOf(sm.fun, 0.35, 0.7, ["failed", "impaired", "normal"]));
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
