/* Lysosomal storage scene: supply flows into the lysosome, one missing enzyme stores it,
 * swollen cells and liver, heart and brain show the body result. Enzyme replacement docks
 * working copies onto the empty enzyme slots; substrate reduction shuts a gate on supply. */
const layers = { glow: $("glowG"), supply: $("supplyG"), lyso: $("lysoG"), cells: $("cellG"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LYS = { x: 415, y: 250, r: 95 };
const SUP = { x: 110, y: 255, r: 25 };
const GATE_X = 215, PIPE_Y = 255, LYS_L = 320, OUT_X0 = 512, OUT_X1 = 618;
const ERT_FROM = [360, 70], ERT_TO = [398, 162];
const LIVER = { x: 810, y: 155, w: 140 }, HEART = { x: 810, y: 272, w: 92 }, BRAIN = { x: 810, y: 372, w: 140 };
const SLOTS = [[-40, -30], [2, -48], [55, -68], [-28, 32], [32, 36]];
/* ---- organs, drawn with the shared organ art and anchored by their ports ---- */
let liverO = null, heartO = null, brainO = null, brainGlow = null;
const organDots = { liver: [], heart: [], brain: [] };
let liverWash = null, heartWash = null, brainWash = null;
function dotsFor(parent, pts, r) {
  return pts.map(([dx, dy]) => { const c = mk("circle", { class: "stored", r: r, cx: f1(dx), cy: f1(dy) }, parent); c.style.opacity = "0"; return c; });
}
function initOrgans() {
  brainGlow = mk("ellipse", { class: "br-glow", cx: BRAIN.x, cy: BRAIN.y, rx: 95, ry: 70 }, layers.glow);
  brainGlow.setAttribute("opacity", "0");
  liverO = organ($("liverSlot"), "liver", LIVER.x, LIVER.y, LIVER.w, {});
  heartO = organ($("heartSlot"), "heart", HEART.x, HEART.y, HEART.w, {});
  brainO = organ($("brainSlot"), "brain", BRAIN.x, BRAIN.y, BRAIN.w, {});
  liverWash = mk("circle", { class: "og-wash", r: 52, cx: 0, cy: 0 }, liverO.g); liverWash.style.opacity = "0";
  heartWash = mk("circle", { class: "og-wash", r: 34, cx: 0, cy: 0 }, heartO.g); heartWash.style.opacity = "0";
  brainWash = mk("circle", { class: "br-wash", r: 52, cx: 0, cy: 0 }, brainO.g); brainWash.style.opacity = "0";
  organDots.liver = dotsFor(liverO.g, [[-20, -10], [-6, -16], [10, -12], [20, -2], [6, 10], [-12, 8], [-2, 2], [14, 14]], 3);
  organDots.heart = dotsFor(heartO.g, [[-12, -8], [0, -12], [12, -6], [-4, 4], [10, 8], [-14, 6]], 2.6);
  organDots.brain = dotsFor(brainO.g, [[-20, -10], [-6, -16], [10, -12], [20, -2], [6, 10], [-12, 8], [-2, 2], [14, 14]], 3);
}
/* ---- supply: vesicle, inflow pipe, reduction gate, trapped cluster ---- */
let gateEl = null;
const trapped = [];
function initSupply() {
  const g = layers.supply;
  mk("path", { class: "pipe", d: "M135 " + PIPE_Y + "L" + LYS_L + " " + PIPE_Y }, g);
  mk("path", { class: "arr", d: "M" + (LYS_L - 8) + " " + (PIPE_Y - 6) + "L" + LYS_L + " " + PIPE_Y + "L" + (LYS_L - 8) + " " + (PIPE_Y + 6) + "Z" }, g);
  mk("circle", { class: "ves", cx: SUP.x, cy: SUP.y, r: SUP.r }, g);
  mk("circle", { class: "stored", cx: SUP.x - 7, cy: SUP.y - 5, r: 4 }, g);
  mk("circle", { class: "stored", cx: SUP.x + 6, cy: SUP.y + 2, r: 4 }, g);
  mk("circle", { class: "stored", cx: SUP.x + 1, cy: SUP.y - 11, r: 3 }, g);
  mk("path", { class: "pipe-out", d: "M" + OUT_X0 + " 250L" + OUT_X1 + " 250" }, g);
  mk("path", { class: "arr", d: "M" + (OUT_X1 - 8) + " 244L" + OUT_X1 + " 250L" + (OUT_X1 - 8) + " 256Z" }, g);
  gateEl = mk("rect", { class: "gate", x: GATE_X - 5, y: PIPE_Y - 22, width: 10, height: 44, rx: 3 }, g);
  gateEl.setAttribute("opacity", "0");
  [[-32, -14], [-22, 10], [-30, 2], [-14, -6], [-12, 14], [-24, -2]].forEach(([dx, dy], i) => {
    const c = mk("circle", { class: "stored", r: 3.6, cx: GATE_X + dx, cy: PIPE_Y + dy }, g);
    c.style.opacity = "0"; trapped.push({ e: c, x: GATE_X + dx, y: PIPE_Y + dy, i });
  });
}
/* ---- lysosome: body, storage wash, stored dots, enzyme slots, missing mark ---- */
let lysoBody = null, lysoWash = null, xmark = null;
const stored = [], nativeEnz = [], dockedEnz = [];
function initLyso() {
  lysoBody = cell(layers.lyso, { cls: "mac", r: LYS.r, nuc: 0, seed: 7, wob: 0.07 });
  place(lysoBody, LYS.x, LYS.y, 0, 1);
  lysoWash = mk("circle", { class: "ly-wash", r: 78, cx: LYS.x, cy: LYS.y }, layers.lyso);
  lysoWash.style.opacity = "0.2";
  for (let i = 0; i < 40; i++) {
    const a = i * 2.4, rr = 10 + (i % 8) * 8.5;
    const c = mk("circle", { class: "stored", r: 4.5, cx: f1(LYS.x + Math.cos(a) * rr * 0.95), cy: f1(LYS.y + Math.sin(a) * rr * 0.8) }, layers.lyso);
    c.style.opacity = "0"; stored.push(c);
  }
  SLOTS.forEach(([dx, dy], i) => {
    const n = mk("g", {}, layers.lyso);
    mk("path", { class: "enz-p", d: "M0 5L0 -2M-4 -7L0 -2L4 -7" }, n);
    place(n, LYS.x + dx, LYS.y + dy, i * 28, 1); nativeEnz.push(n);
    const d = mk("g", {}, layers.lyso);
    mk("path", { class: "enz-dock", d: "M0 6L0 -2M-5 -8L0 -2L5 -8" }, d);
    place(d, LYS.x + dx, LYS.y + dy, i * 28, 1.1); d.setAttribute("opacity", "0"); dockedEnz.push(d);
  });
  xmark = mk("g", {}, layers.lyso);
  mk("path", { class: "xmark", d: "M-14 -14L14 14M14 -14L-14 14" }, xmark);
  place(xmark, LYS.x, LYS.y + 2, 0, 1);
}
/* ---- tissue cells that swell ---- */
const tissue = [];
function initCells() {
  [[655, 195], [655, 305]].forEach(([x, y], i) => {
    const g = mk("g", {}, layers.cells);
    cell(g, { cls: "mac", r: 22, nuc: 0.4, seed: 20 + i, wob: 0.12 });
    const w = mk("circle", { class: "ly-wash", r: 15, cx: 0, cy: 0 }, g);
    w.style.opacity = "0.2";
    place(g, x, y, 0, 1); tissue.push({ g, x, y, w, i });
  });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, hold: 0 }; }); }
const subs = pool(26, () => mk("circle", { class: "sc-p p-sub", r: 3.4 }, layers.parts));
const frags = pool(22, () => mk("circle", { class: "sc-p p-frag", r: 2.3 }, layers.parts));
const erts = pool(12, () => mk("rect", { class: "sc-p p-ert", x: -3, y: -3, width: 6, height: 6, rx: 1.5 }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.hold = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels, caption and gauges ---- */
const gg = {};
let capEl = null, enzPill = null;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The cell and organs";
  [["enz", "Enzyme", "g-good", "How much working enzyme reaches the lysosome. Enzyme replacement raises this for blood-fed organs."], ["acc", "Substrate", "g-bad", "Substrate stored inside lysosomes because it cannot be broken down."], ["sw", "Swelling", "g-cyt", "Cells swell as their lysosomes fill with stored substrate."], ["org", "Organs", "g-bad", "Enlargement of organs such as liver and spleen, or injury to heart and kidney, depending on the disease."], ["neu", "Nerves", "g-cyt", "Nerve and brain involvement. It is strongest in Tay-Sachs and Niemann-Pick disease and least reached by replaced enzyme."], ["fn", "Function", "g-good", "How well cells and organs still work."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const O = layers.over;
  pill(O, "Supply", SUP.x, SUP.y, 110, 108, "Supply: substrate made in the cell (lipids and glycogen from cell turnover) is delivered to the lysosome. Substrate reduction lowers this inflow.");
  pill(O, "Lysosome", 348, 182, 300, 108, "Lysosome: the acid recycling compartment of the cell. Its enzymes break down lipids and glycogen. One missing enzyme leaves one substrate stored.");
  enzPill = pill(O, "Enzyme", 470, 182, 480, 108, "The enzyme step for this disease. Without the enzyme the substrate passes this step unchanged and stays stored.");
  pill(O, "Cells", 655, 195, 640, 108, "Tissue cells whose lysosomes are stuffed with stored substrate. They swell and work poorly, and organs made of them enlarge.");
  pill(O, "Liver", 742, 155, 695, 150, "Liver: enlarges in Gaucher and Niemann-Pick disease as storage filled cells build up.");
  pill(O, "Heart", 766, 272, 738, 272, "Heart: thickens and weakens in Pompe and Fabry disease as glycogen or lipid storage builds up.");
  pill(O, "Brain", 882, 368, 915, 338, "Brain and nerves: injured in Tay-Sachs, Niemann-Pick and Fabry disease. Replaced enzyme reaches the brain poorly.");
  capEl = mk("text", { class: "ly-cap", x: 30, y: 428 }, O);
}
const sm = { E: 0.4, Acc: 0.5, Sw: 0.5, Org: 0.4, Neuro: 0.2, Func: 0.6, ert: 0, srt: 0, inflow: 1 };
const acc = { sub: 0, frag: 0, ert: 0 };
function init() { initOrgans(); initSupply(); initLyso(); initCells(); initPanel(); }
function onModel(m) {
  const L = m.level !== undefined ? m.level : 0;
  const d = SC.diseases[L] || SC.diseases[0];
  if (enzPill) enzPill.setAttribute("data-info", "Missing here: " + d.enzyme + ". Its substrate, " + d.substrate + ", cannot be broken down. Main sites: " + d.sites + ".");
  if (capEl) capEl.textContent = d.caps[drug] || d.caps[0];
}
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.E = lerp(sm.E, m.E, k); sm.Acc = lerp(sm.Acc, m.Acc, k); sm.Sw = lerp(sm.Sw, m.Sw, k);
  sm.Org = lerp(sm.Org, m.Org, k); sm.Neuro = lerp(sm.Neuro, m.Neuro, k); sm.Func = lerp(sm.Func, m.Func, k);
  sm.ert = lerp(sm.ert, m.ert, k); sm.srt = lerp(sm.srt, m.srt, k); sm.inflow = lerp(sm.inflow, m.inflow, k);
  /* lysosome fills and drains */
  place(lysoBody, LYS.x, LYS.y, 0, 1 + 0.13 * sm.Acc);
  lysoWash.style.opacity = (0.05 + 0.85 * sm.Acc).toFixed(2);
  stored.forEach((c, i) => { c.style.opacity = (i / stored.length < sm.Acc ? clamp(0.35 + sm.Acc) : 0).toFixed(2); });
  nativeEnz.forEach((n, i) => { n.style.opacity = clamp(0.15 + sm.E).toFixed(2); });
  dockedEnz.forEach((d, i) => { d.setAttribute("opacity", sm.ert.toFixed(2)); d.setAttribute("transform", "translate(" + f1(LYS.x + SLOTS[i][0]) + " " + f1(LYS.y + SLOTS[i][1]) + ") rotate(" + f1(i * 28 + Math.sin(tm / 500 + i) * 4) + ") scale(1.1)"); });
  xmark.setAttribute("opacity", clamp(1 - sm.E).toFixed(2));
  /* swollen tissue cells */
  tissue.forEach((c) => { place(c.g, c.x + Math.sin(tm / 1400 + c.i) * 1.5, c.y, 0, 1 + 0.5 * sm.Sw); c.w.style.opacity = (0.08 + 0.6 * sm.Acc).toFixed(2); });
  /* organs swell, store and glow with disease, shrink back with treatment */
  place(liverO.g, LIVER.x, LIVER.y, 0, 1 + 0.32 * sm.Org);
  place(heartO.g, HEART.x, HEART.y, 0, 1 + 0.32 * sm.Org);
  place(brainO.g, BRAIN.x, BRAIN.y, 0, 1 + 0.26 * sm.Neuro);
  liverWash.style.opacity = (0.65 * sm.Org).toFixed(2);
  heartWash.style.opacity = (0.65 * sm.Org).toFixed(2);
  brainWash.style.opacity = (0.6 * sm.Neuro).toFixed(2);
  brainGlow.setAttribute("opacity", (0.5 * sm.Neuro).toFixed(2));
  organDots.liver.forEach((c, i) => { c.style.opacity = (i / organDots.liver.length < sm.Org ? 0.9 : 0).toFixed(2); });
  organDots.heart.forEach((c, i) => { c.style.opacity = (i / organDots.heart.length < sm.Org ? 0.9 : 0).toFixed(2); });
  organDots.brain.forEach((c, i) => { c.style.opacity = (i / organDots.brain.length < sm.Neuro ? 0.9 : 0).toFixed(2); });
  /* substrate reduction shuts the gate and traps particles */
  gateEl.setAttribute("opacity", sm.srt.toFixed(2));
  trapped.forEach((c) => { c.e.style.opacity = (sm.srt * (0.55 + 0.45 * Math.sin(tm / 600 + c.i * 1.7))).toFixed(2); });
  /* substrate inflow, trapped at the gate while reduction is on */
  acc.sub += dt * 6.5 * sm.inflow;
  while (acc.sub >= 1) {
    acc.sub--; const p = free(subs);
    if (p) { emit(p, 138, PIPE_Y + rnd(-7, 7), 62, 0); p.trap = Math.random() < 0.55 * sm.srt; }
  }
  subs.forEach((p) => {
    if (!p.on) return;
    if (p.trap && p.x >= GATE_X - 8) {
      p.hold += dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + p.hold * 26) + ")");
      p.e.setAttribute("opacity", clamp(1 - p.hold / 0.7).toFixed(2));
      if (p.hold > 0.7) kill(p); return;
    }
    p.x += p.vx * dt; p.y += Math.sin(tm / 300 + p.x / 18) * 3 * dt;
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")");
    if (p.x > LYS_L - 4) kill(p);
  });
  /* fragments out when the enzyme works */
  acc.frag += dt * 7 * sm.E * sm.inflow;
  while (acc.frag >= 1) { acc.frag--; const p = free(frags); if (p) emit(p, OUT_X0 + 4, 250 + rnd(-8, 8), 58, rnd(-4, 4)); }
  frags.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ")");
    if (p.x > OUT_X1 - 6) kill(p);
  });
  /* replacement enzyme copies fly in and dock on the empty slots */
  acc.ert += dt * sm.ert * 5;
  while (acc.ert >= 1) { acc.ert--; const p = free(erts); if (p) emit(p, ERT_FROM[0] + rnd(-8, 8), ERT_FROM[1], 35, 84); }
  erts.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const dx = ERT_TO[0] - p.x, dy = ERT_TO[1] - p.y;
    p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 930)) + " " + f1(clamp(p.y, 60, 425)) + ") rotate(" + f1(p.t * 80) + ")");
    if (dx * dx + dy * dy < 300 || p.t > 1.4) kill(p);
  });
  /* gauges */
  gg.enz.set(sm.E, wordOf(sm.E, 0.12, 0.5, ["missing", "low", "working"])); gg.acc.set(sm.Acc, wordOf(sm.Acc, 0.25, 0.6, ["none", "some", "marked"])); gg.sw.set(sm.Sw, wordOf(sm.Sw, 0.25, 0.6, ["normal", "swollen", "very swollen"]));
  gg.org.set(sm.Org, wordOf(sm.Org, 0.2, 0.5, ["none", "mild", "marked"])); gg.neu.set(sm.Neuro, wordOf(sm.Neuro, 0.2, 0.5, ["none", "some", "marked"])); gg.fn.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
}
run({ init, step, onModel });
