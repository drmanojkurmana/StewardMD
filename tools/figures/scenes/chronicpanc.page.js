/* Chronic pancreatitis scene: repeated injury, fibrosis, duct stones, acinar and islet loss, malabsorption and gauges. */
const WW = SC.W;
const layers = { cells: $("cells"), stones: $("stones"), islets: $("islets"), parts: $("parts"), over: $("over"), panel: $("panel"), inj: $("inj"), halo: $("painHalo"), fibg: $("fibg") };
/* ---- acinar cells ---- */
const acini = [[255, 240], [320, 292], [385, 238], [450, 292], [515, 238], [580, 292], [645, 238], [690, 285]].map(([x, y], i) => {
  const g = cell(layers.cells, { cls: "acinar", r: 16, nuc: 0.38, seed: i * 2 + 1, wob: 0.12 });
  for (let j = 0; j < 3; j++) mk("circle", { class: "cp-gran", r: 1.7, cx: rnd(-7, 7), cy: rnd(-6, 6) }, g);
  return { g, x, y, ph: i * 1.7 };
});
/* ---- duct stones ---- */
const stoneEls = [[380, 268], [460, 268], [540, 268], [615, 268], [675, 268]].map(([x, y], i) => {
  const g = mk("g", {}, layers.stones); mk("circle", { class: "cp-stone", r: 6 + (i % 3) * 1.4 }, g); mk("circle", { class: "cp-stone-h", cx: -2, cy: -2, r: 2.2 }, g);
  return { g, x, y, k: 0.35 + i * 0.16 };
});
/* ---- islet clusters ---- */
const isletEls = [[335, 222], [495, 318], [605, 222], [420, 318]].map(([x, y], i) => {
  const g = mk("g", {}, layers.islets);
  for (let j = 0; j < 5; j++) mk("circle", { class: "cp-islet", r: 3.4, cx: Math.cos(j * 1.9 + i) * 6, cy: Math.sin(j * 1.9 + i) * 5 }, g);
  return { g, x, y };
});
/* ---- particle pools (items expose p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const enz = pool(30, () => mk("circle", { class: "sc-p p-enzp", r: 2.4 }, layers.parts));
const fat = pool(24, () => mk("path", { class: "sc-p p-fatp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const injp = pool(22, () => mk("path", { class: "sc-p p-injp", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts));
const alc = pool(8, () => mk("path", { class: "sc-p p-injp", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const gene = pool(8, () => mk("rect", { class: "sc-p p-enzp", x: -2, y: -2, width: 4, height: 4, rx: 1 }, layers.parts));
const insul = pool(14, () => mk("circle", { class: "sc-p p-fatp", r: 2.2 }, layers.parts));
const caps = pool(8, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["fib", "Fibrosis", "g-fib", "Scar tissue (fibrosis) replacing normal pancreas after repeated injury. It distorts the gland and the duct."], ["stones", "Stones", "g-stone", "Stones and plugs in the pancreatic duct. They block drainage and can drive pain."], ["enz", "Enzymes", "g-enz", "Digestive enzyme flow from acinar cells into the gut. It falls as acinar tissue is lost."], ["fat", "Fat in stool", "g-fatg", "Undigested fat passed in the stool (steatorrhoea) when enzyme flow is too low. It causes weight loss."], ["insul", "Insulin", "g-islet", "Insulin from islet cells. As islets are lost, sugar control fails and diabetes can develop."], ["pain", "Pain", "g-paing", "Pain from inflammation, a blocked duct, stones and nerve involvement. Often strongest before the burnt out stage."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Alcohol", 132, 138, 120, 88, "Alcohol is the commonest cause of repeated pancreatic injury in adults. Stopping alcohol slows further injury.");
  pill(ox, "Genetic variant", 270, 132, 270, 88, "Inherited variants, for example in trypsinogen or in enzyme inhibitor genes, raise susceptibility so injury starts earlier and progresses faster.");
  pill(ox, "Repeated injury", 385, 238, 430, 88, "Repeated episodes of acinar injury and repair. Each round leaves more scar tissue and fewer working cells.");
  pill(ox, "Fibrosis", 360, 250, 240, 180, "Fibrosis: collagen scar laid down after repeated injury. It stiffens and shrinks the gland and narrows the duct.");
  pill(ox, "Duct stones", 460, 268, 460, 180, "Stones form in the main pancreatic duct as protein plugs calcify. They obstruct flow and raise pressure behind the block.");
  pill(ox, "Acinar loss", 515, 238, 620, 180, "Acinar cells make digestive enzymes. As they are lost, enzyme secretion falls and food, especially fat, is poorly digested.");
  pill(ox, "Islet loss", 605, 222, 800, 180, "Islets make insulin. Their loss is usually late, causing diabetes that can be hard to control because other islet hormones are lost too.");
  pill(ox, "Steatorrhoea", 818, 336, 240, 395, "Pale, oily, hard to flush stools from undigested fat when enzyme flow is too low.");
  pill(ox, "Weight loss", 872, 336, 415, 395, "Weight loss from malabsorption and from eating less because eating brings on pain.");
  pill(ox, "Diabetes", 605, 222, 575, 395, "Diabetes from loss of insulin making islet tissue, usually in the burnt out stage.");
  pill(ox, "Pain", 560, 292, 735, 395, "Persistent upper abdominal pain, often going through to the back. A major burden in established disease.");
  const ep = pill(ox, "Enzyme replacement", 782, 292, 848, 240, "Replacement enzymes taken with food mix with the meal in the gut and restore fat digestion, easing steatorrhoea and weight loss."); ep.setAttribute("id", "enz-pill");
  const dp = pill(ox, "Drainage", 675, 268, 848, 290, "Endoscopic or surgical drainage clears stones and opens a blocked duct, lowering pressure and pain."); dp.setAttribute("id", "dr-pill");
  const pp = pill(ox, "Pain control", 500, 300, 848, 368, "Pain control and stopping alcohol: easing pain and removing the ongoing cause of injury."); pp.setAttribute("id", "pc-pill");
}
const sm = { fib: 0.4, stones: 0.3, sec: 0.5, dig: 0.5, insul: 0.6, pain: 0.5, steat: 0.4, injury: 0.4, enz: 0, painTx: 0, drain: 0 };
const acc = { enz: 0, fat: 0, inj: 0, alc: 0, gene: 0, insul: 0, cap: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.fib = lerp(sm.fib, m.fib, k2); sm.stones = lerp(sm.stones, m.stones, k2); sm.sec = lerp(sm.sec, m.sec, k2); sm.dig = lerp(sm.dig, m.dig, k2); sm.insul = lerp(sm.insul, m.insul, k2); sm.pain = lerp(sm.pain, m.pain, k1); sm.steat = lerp(sm.steat, m.steat, k2); sm.injury = lerp(sm.injury, m.injury, k2);
  sm.enz = lerp(sm.enz, m.enz, k1); sm.painTx = lerp(sm.painTx, m.painTx, k1); sm.drain = lerp(sm.drain, m.drain, k1);
  layers.inj.setAttribute("opacity", (sm.injury * 0.32).toFixed(2));
  layers.halo.setAttribute("opacity", (sm.pain * 0.26).toFixed(2));
  Array.from(layers.fibg.children).forEach((p, i) => { p.style.opacity = (sm.fib * (0.45 + 0.1 * (i % 3))).toFixed(2); });
  acini.forEach((c, i) => { const s = 0.55 + 0.45 * sm.sec; place(c.g, c.x + Math.sin(tm / 1600 + c.ph) * 2, c.y + Math.cos(tm / 1900 + c.ph) * 2, Math.sin(tm / 2800 + c.ph) * 5, s); c.g.style.opacity = (0.35 + 0.65 * sm.sec).toFixed(2); });
  stoneEls.forEach((s) => place(s.g, s.x, s.y, 0, Math.max(0.03, sm.stones * s.k + sm.stones * 0.45)));
  isletEls.forEach((s, i) => { place(s.g, s.x, s.y, 0, Math.max(0.05, sm.insul)); s.g.style.opacity = (0.25 + 0.75 * sm.insul).toFixed(2); });
  /* alcohol drops drift to the tail */
  acc.alc += dt * (sm.painTx > 0.5 ? 0.25 : 1.5); while (acc.alc >= 1) { acc.alc--; const p = free(alc); if (p) emit(p, rnd(118, 160), rnd(160, 182), 0, 0, 0); }
  alc.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (215 - p.x) * dt * 0.8 + 10 * dt; p.y += (250 - p.y) * dt * 0.8; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* genetic susceptibility markers drift to acinar cells */
  acc.gene += dt * 1.1; while (acc.gene >= 1) { acc.gene--; const p = free(gene); if (p) emit(p, rnd(258, 282), rnd(158, 172), 0, 0, 0); }
  gene.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (340 - p.x) * dt * 0.7; p.y += (240 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); if (p.t > 3) kill(p); });
  /* injury sparks inside acinar cells */
  acc.inj += dt * sm.injury * 11; while (acc.inj >= 1) { acc.inj--; const p = free(injp), c = pick(acini); if (p && c) emit(p, c.x + rnd(-9, 9), c.y + rnd(-7, 7), rnd(-22, 22), rnd(-20, 20), 0); }
  injp.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 205, 725); p.y = clamp(p.y, 205, 335); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.1) / 0.8).toFixed(2)); if (p.t > 1.9) kill(p); });
  /* enzyme flow: acini to duct, along duct, down duodenum to gut */
  acc.enz += dt * sm.dig * 9; while (acc.enz >= 1) { acc.enz--; const p = free(enz), c = pick(acini); if (p && c) emit(p, c.x, c.y, 0, 0, 0); }
  enz.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += (268 - p.y) * dt * 3.2; p.x += rnd(-3, 3) * dt; if (Math.abs(p.y - 268) < 5) p.k = 1; } else if (p.k === 1) { p.x += 62 * dt; p.y = 268 + Math.sin(tm / 300 + p.x) * 2; if (p.x > 728) p.k = 2; } else { p.x = 775 + Math.sin(p.t * 2) * 14; p.y += 42 * dt; p.t += dt; if (p.y > 332) kill(p); } p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 24, 936)) + " " + f1(clamp(p.y, 54, 430)) + ")"); });
  /* insulin dots leave islets toward the gut and body */
  acc.insul += dt * sm.insul * 5; while (acc.insul >= 1) { acc.insul--; const p = free(insul), s = pick(isletEls); if (p && s) emit(p, s.x, s.y, rnd(18, 30), rnd(-6, 6), 0); }
  insul.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 1.6) / 1).toFixed(2)); if (p.t > 2.6 || p.x > 930) kill(p); });
  /* fat droplets in the gut: absorbed when digestion works, otherwise carried on */
  acc.fat += dt * 5.5; while (acc.fat >= 1) { acc.fat--; const p = free(fat); if (p) emit(p, 752, 336 + rnd(-5, 5), rnd(34, 46), 0, 0); }
  fat.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; const absorbed = sm.dig > 0.55 && p.x > 815; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (absorbed ? 0.4 : 1).toFixed(2) + ")"); p.e.setAttribute("opacity", absorbed ? clamp(1 - (p.x - 815) / 45).toFixed(2) : "1"); if (p.x > 902 || (absorbed && p.x > 862)) kill(p); });
  /* enzyme replacement capsules enter the duodenum */
  acc.cap += dt * sm.enz * 2.4; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, 758, 214, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x = 775 + Math.sin(p.t * 1.7) * 13; p.y += 30 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.4) / 1.2).toFixed(2)); if (p.t > 4.6 || p.y > 338) kill(p); });
  /* treatment pills fade with their treatment */
  $("enz-pill").style.opacity = sm.enz.toFixed(2); $("dr-pill").style.opacity = sm.drain.toFixed(2); $("pc-pill").style.opacity = sm.painTx.toFixed(2);
  /* gauges */
  gg.fib.set(sm.fib, wordOf(sm.fib, 0.3, 0.6, ["patchy", "wide", "dense"])); gg.stones.set(sm.stones, wordOf(sm.stones, 0.3, 0.6, ["none", "some", "many"])); gg.enz.set(sm.sec, wordOf(sm.sec, 0.3, 0.6, ["lost", "reduced", "preserved"]));
  gg.fat.set(sm.steat, wordOf(sm.steat, 0.3, 0.6, ["none", "some", "lots"])); gg.insul.set(sm.insul, wordOf(sm.insul, 0.3, 0.6, ["lost", "reduced", "preserved"])); gg.pain.set(sm.pain, wordOf(sm.pain, 0.3, 0.6, ["mild", "moderate", "severe"]));
}
run({ init, step });
