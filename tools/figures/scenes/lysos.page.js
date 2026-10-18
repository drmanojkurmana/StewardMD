/* Lysosomal storage scene: substrate flows from cytosol into the lysosome, enzyme step, stored substrate, swollen cells and gauges. */
const layers = { swell: $("swell"), lyso: $("lysoG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LC = [430, 245];
/* ---- lysosome, source vesicle, exit box, swollen cells ---- */
const lysoCell = (() => { const g = mk("g", {}, layers.lyso); cell(g, { cls: "mac", r: 104, nuc: 0, seed: 7, wob: 0.07 }); place(g, LC[0], LC[1], 0, 1); return g; })();
const enz = [];
for (let i = 0; i < 5; i++) { const pos = [[-42, -28], [0, -46], [42, -24], [-28, 34], [32, 38]][i]; const g = mk("g", {}, layers.lyso);
  mk("path", { class: "enz-p", d: "M0 5L0 -2M-4 -7L0 -2L4 -7" }, g); place(g, LC[0] + pos[0], LC[1] + pos[1], i * 28, 1); enz.push(g); }
const xmark = (() => { const g = mk("g", {}, layers.lyso); mk("path", { class: "xmark", d: "M-13 -13L13 13M13 -13L-13 13" }, g); place(g, LC[0], LC[1] + 2, 0, 1); return g; })();
const stored = [];
for (let i = 0; i < 36; i++) { const a = i * 2.4, r = 12 + (i % 6) * 13, g = mk("g", {}, layers.lyso); mk("circle", { class: "stored", r: 4.2 }, g);
  const x = LC[0] + Math.cos(a) * r * 0.92, y = LC[1] + Math.sin(a) * r * 0.78; place(g, x, y, 0, 1); g.style.opacity = 0; stored.push(g); }
const swellCells = [[758, 356], [830, 356], [902, 356]].map(([x, y], i) => { const g = mk("g", {}, layers.swell); cell(g, { cls: "mac", r: 20, nuc: 0.4, seed: 20 + i, wob: 0.12 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
function initStatic() {
  const g = mk("g", {}, layers.lyso);
  mk("circle", { class: "ves", cx: 110, cy: 240, r: 27 }, g);
  mk("circle", { class: "stored", cx: 102, cy: 232, r: 4 }, g); mk("circle", { class: "stored", cx: 118, cy: 248, r: 4 }, g); mk("circle", { class: "stored", cx: 116, cy: 230, r: 3 }, g);
  mk("rect", { class: "out-b", x: 632, y: 218, width: 68, height: 44, rx: 10 }, g);
  mk("path", { style: "stroke:var(--anatomy-mid);stroke-width:1.4;fill:none;stroke-dasharray:4 4", d: "M140 240L318 240M545 240L626 240" }, g);
  mk("path", { style: "stroke:var(--anatomy-mid);stroke-width:1.4;fill:none", d: "M318 240l-9 -5v10Z" }, g);
  mk("path", { style: "stroke:var(--anatomy-mid);stroke-width:1.4;fill:none", d: "M626 240l-9 -5v10Z" }, g);
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, k: 0 }; }); }
const subs = pool(26, () => mk("circle", { class: "sc-p p-sub", r: 3.4 }, layers.parts));
const frags = pool(22, () => mk("circle", { class: "sc-p p-frag", r: 2.3 }, layers.parts));
const erts = pool(12, () => mk("rect", { class: "sc-p p-ert", x: -3, y: -3, width: 6, height: 6, rx: 1.5 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
let ertPill = null, srtPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell and organs";
  [["enz", "Enzyme", "g-good", "How much working enzyme reaches the lysosome. Enzyme replacement raises this for blood-fed organs."], ["acc", "Substrate", "g-bad", "Substrate stored inside lysosomes because it cannot be broken down."], ["sw", "Swelling", "g-cyt", "Cells swell as their lysosomes fill with stored substrate."], ["org", "Organs", "g-bad", "Enlargement of organs such as liver and spleen, or injury to heart and kidney, depending on the disease."], ["neu", "Nerves", "g-cyt", "Nerve and brain involvement. It is strongest in Tay-Sachs and Niemann-Pick disease and least reached by replaced enzyme."], ["fn", "Function", "g-good", "How well cells and organs still work."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const O = layers.over;
  pill(O, "Substrate in", 110, 212, 110, 120, "Substrate made in the cytosol (lipids and glycogen from cell turnover) is delivered to the lysosome for breakdown. Substrate reduction lowers this inflow.");
  pill(O, "Lysosome", 355, 165, 235, 120, "Lysosome: the acid recycling compartment of the cell. Its enzymes break down lipids and glycogen. One missing enzyme leaves one substrate stored.");
  pill(O, "Enzyme step", 455, 220, 575, 120, "The enzyme step for this disease. Without the enzyme the substrate passes this step unchanged and stays stored.");
  pill(O, "Fragments out", 665, 218, 770, 120, "When the enzyme works, substrate is cut into small fragments that leave the lysosome and are reused by the cell.");
  pill(O, "Swollen cells", 830, 330, 830, 288, "Tissue cells whose lysosomes are stuffed with stored substrate. They swell and work poorly, and organs made of them enlarge.");
  ertPill = pill(O, "Enzyme replacement", 480, 335, 620, 382, "Enzyme replacement: a working copy of the missing enzyme is taken up into lysosomes. It reaches liver, spleen and other blood-fed organs well, and the brain poorly.");
  srtPill = pill(O, "Substrate reduction", 180, 252, 220, 382, "Substrate reduction: less substrate is made in the cytosol, so less arrives at the lysosome and storage slows. It does not restore the missing enzyme.");
  ertPill.setAttribute("id", "ert-pill"); srtPill.setAttribute("id", "srt-pill");
}
const sm = { E: 0.4, Acc: 0.5, Sw: 0.5, Org: 0.4, Neuro: 0.2, Func: 0.6, ert: 0, srt: 0, inflow: 1 };
const acc = { sub: 0, frag: 0, ert: 0 };
function init() { initStatic(); initPanel(); }
function onModel(m) {
  const d = SC.diseases[m.level !== undefined ? m.level : 0] || SC.diseases[0];
  const t1 = $("disTitle"), t2 = $("disSub");
  if (t1) t1.textContent = d.name + ": " + d.enzyme;
  if (t2) t2.textContent = "Substrate: " + d.substrate + " · Main sites: " + d.sites;
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k1); sm.Acc = lerp(sm.Acc, m.Acc, k2); sm.Sw = lerp(sm.Sw, m.Sw, k2); sm.Org = lerp(sm.Org, m.Org, k2); sm.Neuro = lerp(sm.Neuro, m.Neuro, k2); sm.Func = lerp(sm.Func, m.Func, k2); sm.ert = lerp(sm.ert, m.ert, k1); sm.srt = lerp(sm.srt, m.srt, k1); sm.inflow = lerp(sm.inflow, m.inflow, k1);
  /* lysosome scale and stored dots */
  place(lysoCell, LC[0], LC[1], 0, 1 + 0.13 * sm.Acc);
  stored.forEach((g, i) => { g.style.opacity = (i / stored.length < sm.Acc ? clamp(0.35 + sm.Acc) : 0).toFixed(2); });
  enz.forEach((g, i) => { g.style.opacity = clamp(0.15 + sm.E).toFixed(2); const pos = [[-42, -28], [0, -46], [42, -24], [-28, 34], [32, 38]][i]; place(g, LC[0] + pos[0] * (1 + 0.13 * sm.Acc), LC[1] + pos[1] * (1 + 0.13 * sm.Acc), i * 28 + Math.sin(tm / 400 + i) * 8, 0.8 + 0.3 * sm.E); });
  xmark.style.opacity = clamp(1 - sm.E).toFixed(2); place(xmark, LC[0], LC[1] + 2, 0, 1);
  swellCells.forEach((c) => { place(c.g, c.x + Math.sin(tm / 1400 + c.i) * 1.5, c.y, 0, 1 + 0.5 * sm.Sw); });
  /* substrate inflow: cytosol vesicle to lysosome */
  acc.sub += dt * 6.5 * sm.inflow; while (acc.sub >= 1) { acc.sub--; const p = free(subs); if (p) emit(p, 138, 240 + rnd(-7, 7), 62, 0); }
  subs.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 18) * 3 * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")"); if (p.x > 405) kill(p); });
  /* fragments out when the enzyme works */
  acc.frag += dt * 7 * sm.E * sm.inflow; while (acc.frag >= 1) { acc.frag--; const p = free(frags); if (p) emit(p, 538, 240 + rnd(-8, 8), 58, rnd(-4, 4)); }
  frags.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")"); if (p.x > 628) kill(p); });
  /* replacement enzyme arrives at the lysosome */
  acc.ert += dt * sm.ert * 5; while (acc.ert >= 1) { acc.ert--; const p = free(erts); if (p) emit(p, 562, 162, -52, 34); }
  erts.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ") rotate(" + f1(p.t * 80) + ")"); if (p.x < 478 || p.t > 2) kill(p); });
  if (ertPill) ertPill.style.opacity = sm.ert.toFixed(2);
  if (srtPill) srtPill.style.opacity = sm.srt.toFixed(2);
  /* gauges */
  gg.enz.set(sm.E, wordOf(sm.E, 0.25, 0.6, ["missing", "low", "working"])); gg.acc.set(sm.Acc, wordOf(sm.Acc, 0.25, 0.6, ["none", "some", "marked"])); gg.sw.set(sm.Sw, wordOf(sm.Sw, 0.25, 0.6, ["normal", "swollen", "very swollen"]));
  gg.org.set(sm.Org, wordOf(sm.Org, 0.2, 0.5, ["none", "mild", "marked"])); gg.neu.set(sm.Neuro, wordOf(sm.Neuro, 0.2, 0.5, ["none", "some", "marked"])); gg.fn.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
}
run({ init, step, onModel });
