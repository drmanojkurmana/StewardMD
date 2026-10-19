/* Methotrexate scene: DHFR plugged in the tumour cell, THF rescue, and the harmed organs. */
const L = { tum: $("tumSlot"), org: $("orgSlot"), parts: $("parts"), over: $("over"), panel: $("panel") };
const TC = [225, 262], TR = 105;
const sm = { K: 0, Ms: 0, Gu: 0, Lv: 0, Lu: 0, Kd: 0, on: 0, pro: 0 };
const acc = { fol: 0, mtx: 0, thf: 0, leu: 0, res: 0, bleb: 0, spk: 0, crk: 0, cry: 0, flu: 0 };
let tumG, dauG, dnaG, plugE, blockE, hazeE, livE, gg = {}, capEl = null, capKey = "";
let marCells = [], soreE = [], fatDots = [];
let trMtx, trFol, trThf, trLeu, fol, mtx, thf, leu, res, bleb, spk, crk, cry, flu;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d, l) {
  if (d === 2) return ["Leucovorin gives ready THF past the block and fluids flush the kidney. Tumour kill goes on.", "Healthy tissues recover on rescue while the tumour keeps dying.", "Even late on, rescue guards marrow, gut and kidney. Other harms stay lower."][l];
  if (d === 1) return ["Methotrexate plugs DHFR. THF runs out and tumour DNA copying stalls.", "THF stays low. The tumour dies back while marrow, gut, liver, lung and kidney suffer.", "Late courses kill more tumour but every harm builds."][l];
  return ["No treatment. Folate flows through DHFR and the tumour cell copies its DNA.", "No treatment. The tumour keeps dividing and nothing else changes.", "No treatment. The tumour grows on, with no benefit and no harm."][l];
}
function buildDNA(g) {
  let left = "", right = "", rungs = "";
  for (let y = -30; y <= 30; y += 4) {
    const x = 11 * Math.cos((y / 30) * Math.PI * 2);
    left += (y === -30 ? "M" : "L") + f1(x) + " " + y;
    right += (y === -30 ? "M" : "L") + f1(-x) + " " + y;
    if (((y + 30) / 4) % 3 === 0) rungs += "M" + f1(x) + " " + y + "L" + f1(-x) + " " + y;
  }
  mk("path", { class: "oc-rung", d: rungs }, g);
  mk("path", { class: "oc-dna", d: left }, g);
  mk("path", { class: "oc-dna", d: right }, g);
}
const DROP = "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z";
function init() {
  tumG = cell(L.tum, { cls: "tum", r: TR, nuc: 0.55, seed: 3, wob: 0.08, x: TC[0], y: TC[1] });
  dnaG = mk("g", { transform: "translate(5 10)" }, tumG); buildDNA(dnaG);
  /* DHFR enzyme with its pocket, plugged by drug */
  const ez = mk("g", {}, L.tum);
  mk("rect", { class: "oc-enz", x: 187, y: 173, width: 76, height: 30, rx: 9 }, ez);
  mk("ellipse", { class: "oc-pock", cx: 225, cy: 175, rx: 11, ry: 5.5 }, ez);
  const ezT = mk("text", { class: "sc-lab", x: 225, y: 193, "text-anchor": "middle" }, ez); ezT.textContent = "DHFR";
  plugE = mk("path", { class: "oc-plug", d: "M225 164L236 175L225 186L214 175Z", opacity: "0" }, ez);
  blockE = mk("rect", { class: "oc-block", x: 183, y: 169, width: 84, height: 38, rx: 12, opacity: "0" }, ez);
  const fT = mk("text", { class: "sc-lab", x: 248, y: 160 }, L.tum); fT.textContent = "folate";
  const hT = mk("text", { class: "sc-lab", x: 248, y: 228 }, L.tum); hT.textContent = "THF";
  dauG = cell(L.tum, { cls: "tum", r: 28, nuc: 0.5, seed: 5, wob: 0.1, x: 415, y: 352 });
  /* marrow bone with blood cells that run low */
  const bg = mk("g", {}, L.org);
  mk("rect", { class: "oc-bone", x: 505, y: 132, width: 110, height: 88, rx: 18 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 505, cy: 176, rx: 15, ry: 48 }, bg);
  mk("ellipse", { class: "oc-bone", cx: 615, cy: 176, rx: 15, ry: 48 }, bg);
  mk("rect", { class: "oc-cav", x: 520, y: 152, width: 80, height: 48, rx: 13 }, bg);
  const mpos = [[534, 166, "rbc"], [556, 161, "neut"], [578, 166, "plt"], [591, 179, "rbc"], [545, 187, "neut"], [568, 190, "plt"]];
  mpos.forEach(([x, y, cls], i) => marCells.push({ g: cell(bg, { cls, r: 7, nuc: cls === "plt" ? 0 : 0.4, seed: i + 11, wob: 0.12, x, y }), x, y }));
  /* gut that turns sore, kidney that grows crystals, liver and lung */
  organ(L.org, "bowel", 700, 172, 85, { h: 75 });
  [[688, 168, 9, 6], [706, 178, 7, 5], [714, 164, 6, 4]].forEach(([x, y, rx, ry]) => soreE.push(mk("ellipse", { class: "oc-sore", cx: x, cy: y, rx, ry, opacity: "0" }, L.org)));
  organ(L.org, "kidney", 852, 172, 64, { h: 85 });
  organ(L.org, "liver", 600, 335, 130, {});
  livE = mk("ellipse", { class: "oc-liv", cx: 600, cy: 335, rx: 48, ry: 30, opacity: "0" }, L.org);
  [[575, 322], [590, 330], [608, 322], [620, 335], [588, 345], [605, 348]].forEach(([x, y]) => fatDots.push(mk("circle", { class: "oc-fat", cx: x, cy: y, r: 3, opacity: "0" }, L.org)));
  organ(L.org, "lung", 830, 335, 120, {});
  hazeE = mk("ellipse", { class: "oc-haze", cx: 830, cy: 335, rx: 50, ry: 36, opacity: "0" }, L.org);
  /* tracks and particle pools */
  trMtx = track([[16, 330], [90, 312], [150, 250], [190, 190]]);
  trFol = track([[225, 148], [225, 170]]);
  trThf = track([[225, 206], [225, 238]]);
  trLeu = track([[16, 420], [250, 424], [470, 380], [560, 300], [545, 195]]);
  fol = pool(10, () => mk("circle", { class: "sc-p p-fol", r: 2.6 }, L.parts));
  mtx = pool(12, () => mk("path", { class: "sc-p p-mtx", d: "M0 -4L4 0L0 4L-4 0Z" }, L.parts));
  thf = pool(10, () => mk("circle", { class: "sc-p p-thf", r: 2.6 }, L.parts));
  leu = pool(12, () => mk("circle", { class: "p-leu", r: 4.5 }, L.parts));
  res = pool(10, () => mk("circle", { class: "p-leu", r: 4 }, L.parts));
  bleb = pool(12, () => mk("circle", { class: "sc-p p-bleb", r: 3.4 }, L.parts));
  spk = pool(10, () => mk("circle", { class: "sc-p p-spk", r: 2.2 }, L.parts));
  crk = pool(10, () => mk("circle", { class: "sc-p p-crk", r: 2.6 }, L.parts));
  cry = pool(14, () => mk("path", { class: "p-crys", d: "M0 -3.5L3 2.5L-3 2.5Z" }, L.parts));
  flu = pool(10, () => mk("path", { class: "p-flush", d: DROP }, L.parts));
  /* labels, caption, gauges */
  const ox = L.over;
  pill(ox, "Methotrexate", 100, 302, 80, 400, "Methotrexate looks like folate but cannot be used. It plugs the DHFR enzyme so the cell cannot make THF.");
  pill(ox, "DHFR", 263, 188, 340, 108, "Dihydrofolate reductase turns folate into THF, which builds purines and thymidine for DNA. Blocked, the cell cannot copy its DNA.");
  pill(ox, "Tumour DNA", 230, 302, 225, 404, "Without purines and thymidine the tumour cell cannot copy its DNA, so it stops dividing and dies.");
  pill(ox, "Marrow", 560, 148, 560, 92, "Marrow cells divide fast, so without THF they die and red cells, white cells and platelets all fall.");
  pill(ox, "Gut sore", 700, 158, 700, 92, "Mouth and gut lining renew fast, so without THF the lining breaks down into painful sores.");
  pill(ox, "Kidney", 852, 155, 852, 92, "Methotrexate crystals settle in acid urine and block kidney tubules. Fluids and alkali urine flush them out.");
  pill(ox, "Liver", 560, 318, 512, 268, "The liver stores methotrexate, and over many courses the stored drug scars it.");
  pill(ox, "Lung", 830, 312, 898, 268, "An immune reaction to methotrexate inflames the air sacs, causing dry cough and breathlessness.");
  capEl = mk("text", { class: "oc-cap", x: 30, y: 443 }, ox); capEl.textContent = capText(drug, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 470 }, P); t.textContent = "Benefit and harm together";
  [["kill", "Tumour kill", "g-good", "How much tumour dies for lack of THF. Rises with each course."], ["mar", "Marrow low", "g-neu", "Marrow cells divide fast, so without THF they die and blood counts fall. Leucovorin guards them."], ["gut", "Gut sore", "g-bad", "Mouth and gut lining renew fast, so without THF the lining breaks into sores. Leucovorin guards it."], ["liv", "Liver harm", "g-eos", "The liver stores methotrexate, and over many courses the stored drug scars it."], ["lun", "Lung harm", "g-cyt", "An immune reaction to methotrexate inflames the air sacs, causing dry cough and breathlessness."], ["kid", "Kidney harm", "g-fl", "Drug crystals settle in acid urine and block kidney tubules. Fluids and alkali urine flush them out."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, 478, 70, 18, cls, name, tip); });
}
function step(dt, m) {
  const k2 = Math.min(1, dt * 1.2);
  sm.K = lerp(sm.K, m.K, k2); sm.Ms = lerp(sm.Ms, m.Ms, k2); sm.Gu = lerp(sm.Gu, m.Gu, k2); sm.Lv = lerp(sm.Lv, m.Lv, k2); sm.Lu = lerp(sm.Lu, m.Lu, k2); sm.Kd = lerp(sm.Kd, m.Kd, k2); sm.on = lerp(sm.on, m.on, k2); sm.pro = lerp(sm.pro, m.pro, k2);
  /* folate feeds DHFR, drug plugs it, THF output runs dry */
  acc.fol += dt * 4;
  while (acc.fol >= 1) { acc.fol--; const p = free(fol); if (p) emit(p, 0, 0, 0, 0, 0); }
  fol.forEach((p) => { if (!p.on) return; p.u += dt * 1.1; if (p.u >= 1) { kill(p); return; } const q = trFol.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.mtx += dt * sm.on * 5;
  while (acc.mtx >= 1) { acc.mtx--; const p = free(mtx); if (p) emit(p, 0, 0, 0, 0, 0); }
  mtx.forEach((p) => { if (!p.on) return; p.u += dt * 0.5; if (p.u >= 1) { kill(p); return; } const q = trMtx.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(p.u * 160) + ")"); });
  plugE.setAttribute("opacity", sm.on.toFixed(2));
  blockE.setAttribute("opacity", sm.on.toFixed(2));
  acc.thf += dt * (1 - sm.K) * 5;
  while (acc.thf >= 1) { acc.thf--; const p = free(thf); if (p) emit(p, 0, 0, 0, 0, 0); }
  thf.forEach((p) => { if (!p.on) return; p.u += dt * 0.8; if (p.u >= 1) { kill(p); return; } const q = trThf.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* tumour DNA fades, blebs fly off, the daughter cell stalls */
  dnaG.setAttribute("opacity", (1 - 0.65 * sm.K).toFixed(2));
  acc.bleb += dt * sm.K * 5;
  while (acc.bleb >= 1) { acc.bleb--; const p = free(bleb); if (p) { const a = rnd(0, 6.28); emit(p, TC[0] + Math.cos(a) * TR, TC[1] + Math.sin(a) * TR, Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
  bleb.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  const dg = 1 - sm.K;
  place(dauG, 415, 352, 0, Math.max(dg, 0.001)); dauG.style.opacity = dg > 0.05 ? 1 : 0;
  /* leucovorin bypass runs past the block to the marrow, and into marrow and gut */
  acc.leu += dt * sm.pro * 4;
  while (acc.leu >= 1) { acc.leu--; const p = free(leu); if (p) emit(p, 0, 0, 0, 0, 0); }
  leu.forEach((p) => { if (!p.on) return; p.u += dt * 0.25; if (p.u >= 1) { kill(p); return; } const q = trLeu.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  acc.res += dt * sm.pro * 4;
  while (acc.res >= 1) { acc.res--; const p = free(res); if (p) { const gut = Math.random() < 0.5; emit(p, gut ? 700 + rnd(-20, 20) : 560 + rnd(-28, 28), 116, 0, rnd(22, 30), 0); } }
  res.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.y - 116) / 90).toFixed(2)); if (p.y > 205) kill(p); });
  /* marrow cells run low */
  const keep = (1 - 0.85 * sm.Ms) * marCells.length;
  marCells.forEach((c, i) => { const s = clamp(keep - i); place(c.g, c.x, c.y, 0, Math.max(s, 0.001)); c.g.style.opacity = s > 0.05 ? 1 : 0; });
  /* gut sores glow and sparkle */
  const so = sm.Gu * (0.75 + 0.25 * Math.sin(tm / 350));
  soreE.forEach((e) => e.setAttribute("opacity", so.toFixed(2)));
  acc.spk += dt * sm.Gu * 6;
  while (acc.spk >= 1) { acc.spk--; const p = free(spk); if (p) emit(p, 700 + rnd(-30, 30), 172 + rnd(-24, 24), 0, 0, 0); }
  spk.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) kill(p); });
  /* kidney crystals settle, fluids flush them out */
  acc.cry += dt * sm.Kd * 6;
  while (acc.cry >= 1) { acc.cry--; const p = free(cry); if (p) emit(p, 852 + rnd(-16, 16), 140 + rnd(-6, 6), 0, rnd(12, 20), 0); }
  cry.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y * 6) + ")"); if (p.y > 205) kill(p); });
  acc.flu += dt * sm.pro * 7;
  while (acc.flu >= 1) { acc.flu--; const p = free(flu); if (p) emit(p, 852 + rnd(-16, 16), 136, 0, rnd(80, 100), 0); }
  flu.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 208) kill(p); });
  /* liver stores harm, lung hazes and crackles */
  livE.setAttribute("opacity", (sm.Lv * 0.55).toFixed(2));
  fatDots.forEach((e) => e.setAttribute("opacity", sm.Lv.toFixed(2)));
  hazeE.setAttribute("opacity", (sm.Lu * 0.5).toFixed(2));
  acc.crk += dt * sm.Lu * 4;
  while (acc.crk >= 1) { acc.crk--; const p = free(crk); if (p) emit(p, 830 + rnd(-40, 40), 335 + rnd(-28, 28), 0, 0, 0); }
  crk.forEach((p) => { if (!p.on) return; p.t += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 1.4).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t > 0.9) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
  gg.kill.set(sm.K, wordOf(sm.K, 0.25, 0.6, ["low", "medium", "high"]));
  gg.mar.set(sm.Ms, wordOf(sm.Ms, 0.3, 0.65, ["ok", "low", "very low"]));
  gg.gut.set(sm.Gu, wordOf(sm.Gu, 0.3, 0.65, ["ok", "sore", "raw"]));
  gg.liv.set(sm.Lv, wordOf(sm.Lv, 0.2, 0.4, ["ok", "some", "much"]));
  gg.lun.set(sm.Lu, wordOf(sm.Lu, 0.2, 0.4, ["ok", "some", "much"]));
  gg.kid.set(sm.Kd, wordOf(sm.Kd, 0.2, 0.55, ["ok", "crystals", "blocked"]));
}
run({ init, step });
