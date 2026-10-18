/* Urea cycle scene: protein makes ammonia, beads carry substrate round the liver
 * cycle, a block stops it, urea flows to the kidney organ, ammonia reaches the
 * brain organ. Restriction shrinks the protein pile, a scavenger opens a green
 * bypass to the kidney, dialysis connects a pulsing filter machine that traps
 * ammonia. Tracks to the organs are built from organ ports in initOrgans. */
const WW = SC.W;
const layers = { nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel") };
const E = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const mainTrack = track([[118, 210], [262, 178], [315, 158], [420, 158], [505, 214], [582, 272], [505, 332], [652, 302]]);
const ornTrack = track([[505, 332], [368, 332], [408, 196]]);
const ureaTrack0 = track([[652, 302], [742, 302], [805, 328]]);
let ureaTrack = ureaTrack0, scavTrack = ureaTrack0, dialTrack = ureaTrack0;
let brainO = null, kidneyO = null, capEl = null, capDrug = -1;
let brainBox = [760, 900, 115, 195];
function initOrgans() {
  brainO = organ($("brainSlot"), "brain", 830, 160, 150, {});
  kidneyO = organ($("kidneySlot"), "kidney", 825, 330, 100, {});
  const BP = brainO.ports, KP = kidneyO.ports;
  const kin = KP.in || KP.pelvis || KP.cortex;
  $("ureaV").setAttribute("d", "M652 302 L720 300 L" + f1(kin[0]) + " " + f1(kin[1]));
  const ktop = [kidneyO.x, Math.round(kidneyO.y - kidneyO.h / 2)];
  $("scavline").setAttribute("d", "M300 178 C460 105 650 115 760 190 L" + f1(ktop[0]) + " " + f1(ktop[1]));
  const car = BP.carotid || BP.in;
  $("bloodline").setAttribute("d", "M710 200 C745 195 765 190 " + f1(car[0]) + " " + f1(car[1]));
  $("brainGlow").setAttribute("cx", f1(brainO.x));
  $("brainGlow").setAttribute("cy", f1(brainO.y));
  const pp = BP.parenchyma;
  brainBox = [Math.round(pp[0] - 72), Math.round(pp[0] + 72), Math.round(pp[1] - 48), Math.round(pp[1] + 48)];
  ureaTrack = track([[652, 302], [720, 300], kin]);
  scavTrack = track([[300, 178], [460, 105], [650, 115], [760, 190], ktop]);
  dialTrack = track([[730, 270], [800, 295], [880, 315], [907, 326]]);
}
function capText(d) {
  if (d === 1) return "Less protein means less ammonia is made. The brain clears.";
  if (d === 2) return "Scavenger carries nitrogen out past the blocked cycle. The brain clears.";
  if (d === 3) return "Dialysis filters ammonia from the blood. The brain clears.";
  return "No treatment. Ammonia builds up and reaches the brain.";
}
const flowP = pool(26, () => mk("circle", { class: "sc-p p-flow", r: 3 }, layers.parts));
const nh3P = pool(22, () => mk("path", { class: "sc-p p-nh3", d: "M0 -3.4L3 2.4L-3 2.4Z" }, layers.parts));
const ureaP = pool(14, () => mk("circle", { class: "sc-p p-urea", r: 2.8 }, layers.parts));
const ornP = pool(8, () => mk("circle", { class: "sc-p p-orn", r: 2.6 }, layers.parts));
const scavP = pool(10, () => mk("rect", { class: "sc-p p-scav", x: -2.4, y: -2.4, width: 4.8, height: 4.8, rx: 1 }, layers.parts));
const protP = pool(8, () => mk("rect", { class: "sc-p p-prot", x: -5, y: -2.6, width: 10, height: 5.2, rx: 2 }, layers.parts));
const dialP = pool(8, () => mk("rect", { class: "sc-p p-dial", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, layers.parts));
flowP.forEach((p, i) => { p.u = i / flowP.length; });
ureaP.forEach((p, i) => { p.u = i / ureaP.length; });
ornP.forEach((p, i) => { p.u = i / ornP.length; });
scavP.forEach((p, i) => { p.u = i / scavP.length; });
dialP.forEach((p, i) => { p.u = i / dialP.length; });
protP.forEach((p, i) => { p.x = rnd(60, 170); p.y = rnd(178, 248); p.vx = rnd(-12, 12); p.vy = rnd(-9, 9); p.a = rnd(0, 180); });
nh3P.forEach((p, i) => { const brain = i % 2 === 0; p.x = brain ? rnd(760, 900) : rnd(268, 462); p.y = brain ? rnd(115, 195) : rnd(132, 238); p.vx = rnd(-14, 14); p.vy = rnd(-10, 10); p.k = brain ? 1 : 0; });
function initNodes() {
  const N = layers.nodes;
  const prot = mk("g", {}, N); cell(prot, { cls: "bac", r: 22, nuc: 0.35, seed: 3, wob: 0.12 }); prot.setAttribute("transform", "translate(110 210)");
  E.prot = prot;
  [[315, 158], [420, 158], [505, 214], [582, 272], [505, 332], [368, 332], [652, 302]].forEach(([x, y]) => { mk("circle", { class: "ur-node", cx: x, cy: y, r: 12 }, N); });
  E.block = mk("g", { opacity: "0" }, N);
  mk("path", { class: "ur-block", d: "M-10 -10L10 10M10 -10L-10 10", transform: "translate(420 158)" }, E.block);
  E.dialG = mk("g", { opacity: "0" }, N);
  mk("path", { class: "ur-tube", d: "M872 312 L882 318" }, E.dialG);
  mk("path", { class: "ur-tube", d: "M872 348 L882 342" }, E.dialG);
  mk("rect", { class: "ur-mach", x: 880, y: 290, width: 54, height: 72, rx: 8 }, E.dialG);
  mk("rect", { class: "ur-machin", x: 887, y: 298, width: 40, height: 30, rx: 4 }, E.dialG);
  E.dialCore = mk("circle", { class: "ur-machin", cx: 907, cy: 348, r: 5 }, E.dialG);
  E.brainFx = mk("g", { opacity: "0" }, N);
  mk("path", { class: "ur-block", d: "M775 118l4 8l9 1l-6 6l2 9l-8 -5l-8 5l2 -9l-6 -6l9 -1Z" }, E.brainFx);
  mk("path", { class: "ur-block", d: "M860 180l3 6l7 1l-5 5l1 7l-6 -4l-6 4l1 -7l-5 -5l7 -1Z" }, E.brainFx);
}
const gg = {};
const rxPills = {};
function setVis(g, v) { if (!g) return; g.style.opacity = v.toFixed(2); g.style.pointerEvents = v < 0.05 ? "none" : "auto"; }
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [170, 370, 570, 770];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The body";
  [["nh3", "Ammonia", "g-nh3", "Ammonia from protein breakdown. It is toxic, especially to the brain, and builds up when the urea cycle cannot keep up."], ["flux", "Cycle flux", "g-cit", "How fast substrate moves round the urea cycle in the liver. A partial or complete defect slows or blocks it."], ["urea", "Urea", "g-urea", "Urea made by the cycle. It travels in the blood to the kidney and leaves in urine. It falls when the cycle is blocked."], ["brain", "Brain effect", "g-nh3", "Ammonia reaching the brain. High ammonia can cause drowsiness, confusion and coma."]].forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Protein", 110, 210, 110, 100, "Protein from food and body. Breaking it down releases ammonia, which the liver cycle should clear.");
  pill(ox, "Ammonia", 300, 205, 255, 100, "Ammonia, a waste product. Red pieces show it building up when the blocked cycle cannot keep up.");
  pill(ox, "Blocked step", 420, 158, 430, 80, "The blocked step of the urea cycle in the liver. When it fails, ammonia builds up and urea falls.");
  pill(ox, "Urea", 652, 302, 665, 250, "Urea made by the cycle. It leaves the liver cell, travels in the blood and is excreted by the kidney.");
  pill(ox, "Brain", 795, 125, 830, 70, "The brain. When ammonia builds up in the blood it reaches the brain and impairs thinking and alertness.");
  pill(ox, "Kidney", 790, 360, 780, 420, "The kidney. It filters urea from the blood into urine.");
  rxPills.restr = pill(ox, "Less protein", 110, 240, 110, 285, "Eating less protein means less ammonia is made, so less reaches the blocked cycle.");
  rxPills.scav = pill(ox, "Scavenger", 560, 112, 640, 80, "A scavenger medicine gives nitrogen another way out in urine, past the blocked cycle.");
  rxPills.dial = pill(ox, "Dialysis", 906, 325, 872, 420, "Dialysis passes blood through a filter machine that traps ammonia during a crisis.");
  capEl = mk("text", { class: "ur-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { NH3: 0.1, Flux: 0.9, Urea: 0.9, Brain: 0.1, restr: 0, scav: 0, dial: 0, act: 1 };
const KEYS = Object.keys(sm);
function init() { initOrgans(); initNodes(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  KEYS.forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const defect = 1 - sm.act;
  E.block.setAttribute("opacity", clamp(defect * 1.4).toFixed(2));
  E.dialG.setAttribute("opacity", sm.dial.toFixed(2));
  E.dialCore.setAttribute("r", (4.5 + 1.5 * Math.sin(tm / 300)).toFixed(2));
  E.brainFx.setAttribute("opacity", sm.Brain.toFixed(2));
  $("brainGlow").setAttribute("opacity", (sm.Brain * 0.45).toFixed(2));
  const bl = $("bloodline"); bl.setAttribute("opacity", (0.1 + 0.75 * sm.NH3).toFixed(2)); bl.setAttribute("stroke-width", f1(2.5 + 4 * sm.NH3));
  const sv = $("scavline"); sv.setAttribute("opacity", (0.12 + 0.8 * sm.scav).toFixed(2)); sv.setAttribute("stroke-width", f1(1.4 + 2.5 * sm.scav));
  const uv = $("ureaV"); uv.setAttribute("opacity", (0.25 + 0.6 * sm.Urea).toFixed(2)); uv.setAttribute("stroke-width", f1(3 + 8 * sm.Urea));
  place(E.prot, 110, 210, 0, 1 - 0.4 * sm.restr);
  /* food pieces near the protein pile shrink away with restriction */
  const wantProt = Math.round(protP.length * (1 - 0.65 * sm.restr));
  protP.forEach((p, i) => { if (i >= wantProt) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 55 || p.x > 175) p.vx *= -1; if (p.y < 172 || p.y > 252) p.vy *= -1; p.x = clamp(p.x, 55, 175); p.y = clamp(p.y, 172, 252); place(p.e, p.x, p.y, p.a, 1); });
  /* main substrate flow: count and speed follow cycle flux */
  const wantFlow = Math.round(sm.Flux * flowP.length);
  flowP.forEach((p, i) => { if (i >= wantFlow) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.055 * (0.35 + sm.Flux); if (p.u > 1) p.u -= 1; const q = mainTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* urea from liver to the kidney organ */
  const wantUrea = Math.round(sm.Urea * ureaP.length);
  ureaP.forEach((p, i) => { if (i >= wantUrea) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.09; if (p.u > 1) p.u -= 1; const q = ureaTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* ornithine returning to the mitochondrion */
  const wantOrn = Math.round(sm.Flux * ornP.length);
  ornP.forEach((p, i) => { if (i >= wantOrn) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.07; if (p.u > 1) p.u -= 1; const q = ornTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* alternative nitrogen exit with a scavenger */
  const wantScav = Math.round(sm.scav * scavP.length);
  scavP.forEach((p, i) => { if (i >= wantScav) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.08; if (p.u > 1) p.u -= 1; const q = scavTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* dialysis stream: blood ammonia trapped by the filter machine */
  const wantDial = Math.round(sm.dial * dialP.length);
  dialP.forEach((p, i) => { if (i >= wantDial) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.u += dt * 0.3; if (p.u > 1) p.u -= 1; const q = dialTrack.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(45)"); });
  /* ammonia wandering in mitochondrion and brain; count follows blood ammonia */
  const wantNh3 = Math.round(sm.NH3 * nh3P.length);
  nh3P.forEach((p, i) => { if (i >= wantNh3) { p.e.setAttribute("opacity", "0"); return; } p.e.setAttribute("opacity", "1"); p.x += p.vx * dt; p.y += p.vy * dt; if (p.k) { if (p.x < brainBox[0] || p.x > brainBox[1]) p.vx *= -1; if (p.y < brainBox[2] || p.y > brainBox[3]) p.vy *= -1; p.x = clamp(p.x, brainBox[0], brainBox[1]); p.y = clamp(p.y, brainBox[2], brainBox[3]); } else { if (p.x < 260 || p.x > 470) p.vx *= -1; if (p.y < 128 || p.y > 242) p.vy *= -1; p.x = clamp(p.x, 260, 470); p.y = clamp(p.y, 128, 242); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); });
  setVis(rxPills.restr, clamp(sm.restr)); setVis(rxPills.scav, clamp(sm.scav)); setVis(rxPills.dial, clamp(sm.dial));
  gg.nh3.set(sm.NH3, wordOf(sm.NH3, 0.3, 0.6, ["normal", "raised", "high"]));
  gg.flux.set(sm.Flux, wordOf(sm.Flux, 0.35, 0.7, ["very low", "reduced", "normal"]));
  gg.urea.set(sm.Urea, wordOf(sm.Urea, 0.35, 0.7, ["very low", "reduced", "normal"]));
  gg.brain.set(sm.Brain, wordOf(sm.Brain, 0.3, 0.6, ["clear", "affected", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
