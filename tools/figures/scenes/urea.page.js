/* Urea cycle scene: substrates flow through mitochondrial and cytosol steps, ornithine returns, urea goes to the kidney, ammonia reaches the brain in a defect. */
const WW = SC.W;
const layers = { nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const mainTrack = track([[118, 210], [262, 178], [315, 158], [420, 158], [505, 214], [582, 272], [505, 332], [652, 302]]);
const ureaTrack = track([[652, 302], [742, 302], [805, 328]]);
const ornTrack = track([[505, 332], [368, 332], [408, 196]]);
const scavTrack = track([[300, 178], [460, 110], [640, 120], [742, 286], [805, 328]]);
const flowP = pool(26, () => mk("circle", { class: "sc-p p-flow", r: 3 }, layers.parts));
const nh3P = pool(22, () => mk("path", { class: "sc-p p-nh3", d: "M0 -3.4L3 2.4L-3 2.4Z" }, layers.parts));
const ureaP = pool(14, () => mk("circle", { class: "sc-p p-urea", r: 2.8 }, layers.parts));
const ornP = pool(8, () => mk("circle", { class: "sc-p p-orn", r: 2.6 }, layers.parts));
const scavP = pool(10, () => mk("rect", { class: "sc-p p-scav", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
flowP.forEach((p, i) => { p.u = i / flowP.length; });
ureaP.forEach((p, i) => { p.u = i / ureaP.length; });
ornP.forEach((p, i) => { p.u = i / ornP.length; });
scavP.forEach((p, i) => { p.u = i / scavP.length; });
nh3P.forEach((p, i) => { const brain = i % 2 === 0; p.x = brain ? rnd(748, 912) : rnd(268, 462); p.y = brain ? rnd(92, 158) : rnd(132, 238); p.vx = rnd(-14, 14); p.vy = rnd(-10, 10); p.k = brain ? 1 : 0; });
function initNodes() {
  const N = layers.nodes;
  const prot = mk("g", {}, N); cell(prot, { cls: "bac", r: 22, nuc: 0.35, seed: 3, wob: 0.12 }); prot.setAttribute("transform", "translate(110 210)");
  E.prot = prot;
  [[315, 158], [420, 158]].forEach(([x, y]) => { mk("path", { class: "ur-enz", d: "M0 -13L13 0L0 13L-13 0Z", transform: "translate(" + x + " " + y + ")" }, N); });
  [[505, 214, "p-cit"], [582, 272, "p-cit"], [505, 332, "p-cit"]].forEach(([x, y]) => { mk("circle", { class: "ur-node", cx: x, cy: y, r: 11 }, N); });
  mk("circle", { class: "ur-node", cx: 368, cy: 332, r: 10 }, N);
  mk("circle", { class: "ur-node", cx: 652, cy: 302, r: 10 }, N);
  mk("ellipse", { class: "ur-node", cx: 830, cy: 132, rx: 34, ry: 20 }, N);
  mk("ellipse", { class: "ur-node", cx: 830, cy: 336, rx: 38, ry: 26 }, N);
  E.block = mk("g", { opacity: "0" }, N);
  mk("path", { class: "ur-block", d: "M-10 -10L10 10M10 -10L-10 10", transform: "translate(420 158)" }, E.block);
  E.dialG = mk("g", { opacity: "0" }, N);
  mk("rect", { class: "ur-mach", x: 884, y: 292, width: 36, height: 52, rx: 6 }, E.dialG);
  mk("rect", { class: "ur-machin", x: 890, y: 300, width: 24, height: 24, rx: 3 }, E.dialG);
  mk("circle", { class: "ur-machin", cx: 902, cy: 334, r: 5 }, E.dialG);
  E.brainFx = mk("g", { opacity: "0" }, N);
  mk("path", { class: "ur-block", d: "M790 108l4 8l9 1l-6 6l2 9l-8 -5l-8 5l2 -9l-6 -6l9 -1Z" }, E.brainFx);
  mk("path", { class: "ur-block", d: "M852 146l3 6l7 1l-5 5l1 7l-6 -4l-6 4l1 -7l-5 -5l7 -1Z" }, E.brainFx);
}
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [170, 370, 570, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["nh3", "Ammonia", "g-nh3", "Ammonia from protein breakdown. It is toxic, especially to the brain, and builds up when the urea cycle cannot keep up (hyperammonaemia)."], ["flux", "Cycle flux", "g-cit", "How fast substrate is moving through the urea cycle steps in the liver. A partial or complete enzyme defect slows or blocks it."], ["urea", "Urea", "g-urea", "Urea made by the cycle. It travels in the blood to the kidney and leaves in urine. It falls when the cycle is blocked."], ["brain", "Brain effect", "g-nh3", "Ammonia reaching the brain. High ammonia can cause drowsiness, confusion and coma."]].forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Protein", 110, 188, 110, 108, "Protein from food and body protein. Breaking down protein and amino acids releases ammonia.");
  pill(ox, "Ammonia", 262, 168, 205, 100, "Ammonia released by protein breakdown. It enters the mitochondrion of the liver cell to start the urea cycle.");
  pill(ox, "CPS", 315, 144, 318, 100, "Carbamoyl phosphate synthetase, the first enzyme, inside the mitochondrion. It combines ammonia with carbon dioxide to make carbamoyl phosphate.");
  pill(ox, "OTC", 420, 144, 425, 100, "Ornithine transcarbamylase, inside the mitochondrion. It combines carbamoyl phosphate with ornithine to make citrulline. This is the enzyme most often defective.");
  pill(ox, "Citrulline", 505, 200, 560, 160, "Citrulline made in the mitochondrion. It leaves the mitochondrion and continues through the cycle in the cytosol.");
  pill(ox, "Arg-succinate", 582, 258, 645, 215, "Argininosuccinate, made in the cytosol from citrulline. It is then split to form arginine.");
  pill(ox, "Arginine", 505, 318, 475, 378, "Arginine in the cytosol. Arginase splits it into urea and ornithine, completing one turn of the cycle.");
  pill(ox, "Ornithine", 368, 318, 285, 378, "Ornithine regenerated from arginine. It travels back into the mitochondrion to combine with the next carbamoyl phosphate.");
  pill(ox, "Urea", 652, 290, 690, 250, "Urea made by the cycle. It leaves the liver cell, travels in the blood and is excreted by the kidney.");
  pill(ox, "Brain", 800, 112, 830, 185, "The brain. When ammonia builds up in the blood it reaches the brain and impairs brain function (hyperammonaemia).");
  pill(ox, "Kidney", 800, 306, 830, 232, "The kidney. It filters urea from the blood and excretes it in urine. In a severe crisis, dialysis can clear ammonia here instead.");
  rxPills.restr = pill(ox, "Less protein", 110, 232, 110, 278, "Protein restriction: eating less protein reduces how much ammonia protein breakdown produces, so less reaches the blocked cycle.");
  rxPills.scav = pill(ox, "Scavenger", 560, 128, 640, 100, "A nitrogen scavenger provides an alternative route for nitrogen to leave the body in urine, bypassing the blocked urea cycle.");
  rxPills.dial = pill(ox, "Dialysis", 884, 344, 855, 412, "Dialysis: blood is passed through an artificial filter that directly clears ammonia (and urea) when levels are dangerously high.");
}
const sm = { NH3: 0.1, Flux: 0.9, Urea: 0.9, Brain: 0.1, restr: 0, scav: 0, dial: 0, act: 1 };
const KEYS = Object.keys(sm);
function init() { initNodes(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const defect = 1 - sm.act;
  E.block.setAttribute("opacity", clamp(defect * 1.4).toFixed(2));
  E.block.setAttribute("transform", "scale(1)");
  E.dialG.setAttribute("opacity", sm.dial.toFixed(2));
  E.brainFx.setAttribute("opacity", sm.Brain.toFixed(2));
  place(E.prot, 110, 210, 0, 1 - 0.25 * sm.restr);
  /* main substrate flow: count and speed follow cycle flux */
  const wantFlow = Math.round(sm.Flux * flowP.length);
  flowP.forEach((p, i) => { if (i >= wantFlow) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.055 * (0.35 + sm.Flux); if (p.u > 1) p.u -= 1; const q = mainTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* urea from liver to kidney */
  const wantUrea = Math.round(sm.Urea * ureaP.length);
  ureaP.forEach((p, i) => { if (i >= wantUrea) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.09; if (p.u > 1) p.u -= 1; const q = ureaTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* ornithine returning to the mitochondrion */
  const wantOrn = Math.round(sm.Flux * ornP.length);
  ornP.forEach((p, i) => { if (i >= wantOrn) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.07; if (p.u > 1) p.u -= 1; const q = ornTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* alternative nitrogen exit with a scavenger */
  const wantScav = Math.round(sm.scav * scavP.length);
  scavP.forEach((p, i) => { if (i >= wantScav) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.08; if (p.u > 1) p.u -= 1; const q = scavTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* ammonia wandering in mitochondrion and brain; count follows blood ammonia */
  const wantNh3 = Math.round(sm.NH3 * nh3P.length);
  nh3P.forEach((p, i) => { if (i >= wantNh3) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; p.y += p.vy * dt; if (p.k) { if (p.x < 742 || p.x > 918) p.vx *= -1; if (p.y < 88 || p.y > 162) p.vy *= -1; p.x = clamp(p.x, 742, 918); p.y = clamp(p.y, 88, 162); } else { if (p.x < 260 || p.x > 470) p.vx *= -1; if (p.y < 128 || p.y > 242) p.vy *= -1; p.x = clamp(p.x, 260, 470); p.y = clamp(p.y, 128, 242); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  setVis(rxPills.restr, clamp(sm.restr)); setVis(rxPills.scav, clamp(sm.scav)); setVis(rxPills.dial, clamp(sm.dial));
  gg.nh3.set(sm.NH3, wordOf(sm.NH3, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.flux.set(sm.Flux, wordOf(sm.Flux, 0.35, 0.7, ["very low", "reduced", "normal"]));
  gg.urea.set(sm.Urea, wordOf(sm.Urea, 0.35, 0.7, ["very low", "reduced", "normal"]));
  gg.brain.set(sm.Brain, wordOf(sm.Brain, 0.3, 0.6, ["clear", "affected", "severe"]));
}
run({ init, step });
