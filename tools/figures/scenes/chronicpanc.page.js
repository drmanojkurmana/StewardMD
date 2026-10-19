/* Chronic pancreatitis scene: repeated injury scars the gland, duct stones block
 * enzyme flow, acinar and islet loss cause malabsorption and diabetes. */
const WW = SC.W;
const layers = { cells: $("cells"), stones: $("stones"), scars: $("scars"), parts: $("parts"), over: $("over"), panel: $("panel"), glow: $("glow"), halo: $("halo"), duct: $("duct"), duo: $("duo"), sheen: $("sheen") };
let pancO = null, ductTr = null, gutTr = null, capEl = null, capDrug = -1;
let tailP = [240, 272], outP = [620, 272], bodyP = [430, 272], ductX0 = 240, ductLen = 380, ductCy = 272;
const acini = [], stoneEls = [], isletEls = [], scarEls = [];
function initOrgans() {
  pancO = organ($("pancSlot"), "pancreas", 430, 272, 460, {});
  const P = pancO.ports;
  tailP = P.tail || P.in; outP = P.out; bodyP = P.body || [pancO.x, pancO.y];
  const cy = pancO.y, L = pancO.x - pancO.w / 2, Wd = pancO.w;
  ductCy = cy; ductX0 = tailP[0]; ductLen = Math.max(80, outP[0] - tailP[0]);
  layers.duct.setAttribute("d", "M" + f1(tailP[0]) + " " + f1(tailP[1]) + " C" + f1(L + Wd * 0.4) + " " + f1(cy - 14) + " " + f1(L + Wd * 0.6) + " " + f1(cy + 14) + " " + f1(outP[0]) + " " + f1(outP[1]));
  ductTr = track([tailP, [L + Wd * 0.4, cy - 8], [L + Wd * 0.65, cy + 8], outP]);
  gutTr = track([outP, [outP[0] + 55, outP[1] + 22], [748, 312], [795, 330]]);
  layers.duo.setAttribute("d", "M" + f1(outP[0] + 28) + " " + f1(outP[1] - 52) + "C" + f1(outP[0] + 72) + " " + f1(outP[1] - 28) + " " + f1(outP[0] + 72) + " " + f1(outP[1] + 28) + " " + f1(outP[0] + 30) + " " + f1(outP[1] + 56));
  const hh = pancO.h / 2;
  [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.84, 0.92].forEach((f, i) => {
    const x = L + f * Wd, y = cy + (i % 2 ? -1 : 1) * Math.max(10, hh * 0.32);
    const g = cell(layers.cells, { cls: "acinar", r: 15, nuc: 0.38, seed: i * 2 + 1, wob: 0.12 });
    for (let j = 0; j < 3; j++) mk("circle", { class: "cp-gran", r: 1.7, cx: rnd(-7, 7), cy: rnd(-6, 6) }, g);
    acini.push({ g, x, y, ph: i * 1.7 });
  });
  [0.16, 0.3, 0.44, 0.58, 0.72, 0.86].forEach((f, i) => {
    const x = L + f * Wd, y = cy + (i % 2 ? 12 : -12);
    scarEls.push(mk("path", { class: "cp-scar", d: "M" + f1(x - 26) + " " + f1(y + 10) + "L" + f1(x + 26) + " " + f1(y - 10) }, layers.scars));
  });
  [0.28, 0.42, 0.55, 0.68, 0.8].forEach((t, i) => {
    const q = ductTr.at(t);
    const g = mk("g", {}, layers.stones);
    mk("circle", { class: "cp-stone", r: 5.5 + (i % 3) * 1.3 }, g);
    mk("circle", { class: "cp-stone-h", cx: -2, cy: -2, r: 2 }, g);
    stoneEls.push({ g, x: q.x, y: q.y + (i % 2 ? 4 : -4), k: 0.4 + i * 0.15 });
  });
  [0.24, 0.44, 0.64, 0.82].forEach((f, i) => {
    const x = L + f * Wd, y = cy + (i % 2 ? -1 : 1) * Math.max(16, hh * 0.42);
    const g = mk("g", {}, layers.cells);
    for (let j = 0; j < 5; j++) mk("circle", { class: "cp-islet", r: 3.2, cx: Math.cos(j * 1.9 + i) * 6, cy: Math.sin(j * 1.9 + i) * 5 }, g);
    isletEls.push({ g, x, y });
  });
}
function capText(d) {
  if (d === 1) return "Enzyme capsules taken with food digest fat in the gut. Stools improve but pain stays.";
  if (d === 2) return "Stopping alcohol halts new injury and pain control eases pain. Old scars stay.";
  if (d === 3) return "Drainage clears stones from the duct so juices flow and pressure pain eases.";
  return "No treatment. Repeated injury scars the gland, fat passes into stools, pain stays.";
}
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, v: 0 }; }); }
const enz = pool(30, () => mk("circle", { class: "sc-p p-enzp", r: 2.4 }, layers.parts));
const fat = pool(24, () => mk("path", { class: "sc-p p-fatp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const injp = pool(22, () => mk("path", { class: "sc-p p-injp", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const alc = pool(8, () => mk("path", { class: "sc-p p-injp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const gene = pool(8, () => mk("rect", { class: "sc-p p-enzp", x: -2, y: -2, width: 4, height: 4, rx: 1 }, layers.parts));
const insul = pool(14, () => mk("circle", { class: "sc-p p-insp", r: 2.2 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-cap", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-cap2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.v = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["fib", "Fibrosis", "g-fib", "Scar tissue replacing working gland after repeated injury. It does not heal back with treatment."], ["stones", "Stones", "g-stone", "Stones and plugs in the pancreatic duct. They block flow and raise pain. Drainage clears them."], ["enz", "Enzymes", "g-enz", "Digestive enzyme flow made by acinar cells. It falls as acinar tissue is lost."], ["fat", "Fat in stool", "g-fatg", "Undigested fat passed in the stool when enzymes are too low. Enzyme capsules with food improve it."], ["insul", "Insulin", "g-islet", "Insulin from islet cells. As islets are lost, sugar control fails."], ["pain", "Pain", "g-paing", "Pain from pressure behind blocks, stones and irritated nerves. Often strongest before the burnt out stage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Alcohol", 140, 140, 110, 80, "Alcohol triggers repeated bouts of injury. Stopping it slows further damage.");
  pill(ox, "Genes", 268, 140, 268, 80, "Inherited gene variants make injury start earlier and scarring run faster.");
  pill(ox, "Pancreas", 400, 240, 440, 140, "The pancreas makes enzymes for digestion and insulin for sugar control.");
  pill(ox, "Scarring", 330, 265, 250, 190, "Scar tissue replaces working gland after repeated injury. It stays after treatment.");
  pill(ox, "Stones", 560, 272, 620, 190, "Protein plugs in the duct harden into stones that block flow and raise pain.");
  pill(ox, "Gut", 810, 336, 835, 295, "Without enough enzymes, fat stays in the gut and passes as oily stools.");
  pill(ox, "Pain", 620, 305, 700, 392, "Pain comes from pressure behind blocks, stones and irritated nerves.");
  capEl = mk("text", { class: "cp-cap", x: 30, y: 425 }, ox); capEl.textContent = capText(0);
}
const sm = { fib: 0.4, stones: 0.3, sec: 0.5, dig: 0.5, insul: 0.6, pain: 0.5, steat: 0.4, injury: 0.4, enz: 0, painTx: 0, drain: 0 };
const acc = { enz: 0, fat: 0, inj: 0, alc: 0, gene: 0, insul: 0, cap: 0 };
function init() { initOrgans(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.fib = lerp(sm.fib, m.fib, k2); sm.stones = lerp(sm.stones, m.stones, k2); sm.sec = lerp(sm.sec, m.sec, k2); sm.dig = lerp(sm.dig, m.dig, k2); sm.insul = lerp(sm.insul, m.insul, k2); sm.pain = lerp(sm.pain, m.pain, k1); sm.steat = lerp(sm.steat, m.steat, k2); sm.injury = lerp(sm.injury, m.injury, k2);
  sm.enz = lerp(sm.enz, m.enz, k1); sm.painTx = lerp(sm.painTx, m.painTx, k1); sm.drain = lerp(sm.drain, m.drain, k1);
  layers.glow.setAttribute("opacity", (sm.injury * 0.45).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.pain * 0.4).toFixed(2));
  layers.duct.setAttribute("stroke-width", f1(4 + 3.5 * sm.drain));
  layers.duct.setAttribute("opacity", (0.55 + 0.3 * clamp(sm.dig)).toFixed(2));
  layers.sheen.setAttribute("opacity", (sm.steat * 0.55).toFixed(2));
  scarEls.forEach((e, i) => { e.style.opacity = (sm.fib * (0.45 + 0.1 * (i % 3))).toFixed(2); });
  acini.forEach((c, i) => { const s = 0.55 + 0.45 * sm.sec; place(c.g, c.x + Math.sin(tm / 1600 + c.ph) * 2, c.y + Math.cos(tm / 1900 + c.ph) * 2, Math.sin(tm / 2800 + c.ph) * 5, s); c.g.style.opacity = (0.35 + 0.65 * sm.sec).toFixed(2); });
  stoneEls.forEach((s) => place(s.g, s.x, s.y, 0, Math.max(0.03, sm.stones * (0.45 + s.k))));
  isletEls.forEach((s) => { place(s.g, s.x, s.y, 0, Math.max(0.05, sm.insul)); s.g.style.opacity = (0.25 + 0.75 * sm.insul).toFixed(2); });
  /* alcohol drops drift to the tail of the gland, and stop when alcohol stops */
  acc.alc += dt * (sm.painTx > 0.5 ? 0.2 : 1.6); while (acc.alc >= 1) { acc.alc--; const p = free(alc); if (p) emit(p, rnd(118, 160), rnd(160, 182), 0, 0, 0); }
  alc.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (tailP[0] - p.x) * dt * 0.8 + 10 * dt; p.y += (tailP[1] - p.y) * dt * 0.8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* gene markers drift to the body of the gland */
  acc.gene += dt * 1.1; while (acc.gene >= 1) { acc.gene--; const p = free(gene); if (p) emit(p, rnd(258, 282), rnd(158, 172), 0, 0, 0); }
  gene.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (bodyP[0] - p.x) * dt * 0.7; p.y += (bodyP[1] - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (p.t > 3) kill(p); });
  /* injury sparks inside acinar cells */
  acc.inj += dt * sm.injury * 11; while (acc.inj >= 1) { acc.inj--; const p = free(injp), c = pick(acini); if (p && c) emit(p, c.x + rnd(-9, 9), c.y + rnd(-7, 7), rnd(-22, 22), rnd(-20, 20), 0); }
  injp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 205, 725); p.y = clamp(p.y, 205, 335); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.1) / 0.8).toFixed(2)); if (p.t > 1.9) kill(p); });
  /* enzyme flow: acini join the duct, run it, then leave for the gut. Stones stall the run. */
  acc.enz += dt * (0.5 + sm.dig * 9); while (acc.enz >= 1) { acc.enz--; const p = free(enz), c = pick(acini); if (p && c) emit(p, c.x, c.y, 0, 0, 0); }
  enz.forEach((p) => {
    if (!p.on) return;
    if (p.k === 0) { p.y += (ductCy - p.y) * dt * 2.5; p.x += 10 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 54, 430)) + ")");
      if (Math.abs(p.y - ductCy) < 6) { p.k = 1; p.u = clamp((p.x - ductX0) / ductLen); } }
    else if (p.k === 1) { p.u += dt * 60 * (0.35 + 0.65 * sm.dig) * (1 - 0.4 * sm.stones) / Math.max(60, ductTr.len); const q = ductTr.at(clamp(p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (sm.stones > 0.45 && p.u > 0.3 && p.u < 0.8 && Math.random() < dt * 1.5) kill(p); else if (p.u >= 1) { p.k = 2; p.v = 0; } }
    else if (p.k === 2) { p.v += dt * 90 / Math.max(60, gutTr.len); const q = gutTr.at(clamp(p.v)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.v >= 1) { p.k = 3; p.t = 0; } }
    else { p.t += dt; p.x += 30 * dt; p.y += 8 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 54, 430)) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 0.4) / 0.6).toFixed(2)); if (p.t > 1 || p.x > 900) kill(p); }
  });
  /* insulin dots leave islets toward the body */
  acc.insul += dt * sm.insul * 5; while (acc.insul >= 1) { acc.insul--; const p = free(insul), s = pick(isletEls); if (p && s) emit(p, s.x, s.y, rnd(18, 30), rnd(-6, 6), 0); }
  insul.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 1).toFixed(2)); if (p.t > 2.6 || p.x > 930) kill(p); });
  /* fat droplets in the gut: absorbed when digestion works, otherwise carried on */
  acc.fat += dt * 5.5; while (acc.fat >= 1) { acc.fat--; const p = free(fat); if (p) emit(p, 752, 336 + rnd(-5, 5), rnd(34, 46), 0, 0); }
  fat.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; const absorbed = sm.dig > 0.55 && p.x > 815; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (absorbed ? 0.4 : 1).toFixed(2) + ")"); p.e.setAttribute("opacity", absorbed ? clamp(1 - (p.x - 815) / 45).toFixed(2) : "1"); if (p.x > 902 || (absorbed && p.x > 862)) kill(p); });
  /* enzyme replacement capsules fall into the gut */
  acc.cap += dt * sm.enz * 2.4; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, 790, 214, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x = 790 + Math.sin(p.t * 1.7) * 13; p.y = 214 + 30 * p.t; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6 || p.y > 338) kill(p); });
  /* gauges */
  gg.fib.set(sm.fib, wordOf(sm.fib, 0.3, 0.6, ["patchy", "wide", "dense"])); gg.stones.set(sm.stones, wordOf(sm.stones, 0.3, 0.6, ["none", "some", "many"])); gg.enz.set(sm.sec, wordOf(sm.sec, 0.3, 0.6, ["lost", "reduced", "preserved"]));
  gg.fat.set(sm.steat, wordOf(sm.steat, 0.3, 0.6, ["none", "some", "lots"])); gg.insul.set(sm.insul, wordOf(sm.insul, 0.3, 0.6, ["lost", "reduced", "preserved"])); gg.pain.set(sm.pain, wordOf(sm.pain, 0.3, 0.6, ["mild", "moderate", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
