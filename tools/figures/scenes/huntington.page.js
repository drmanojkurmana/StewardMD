/* Huntington scene: expanded repeat, mutant protein into the striatum, brake circuit failure and signs.
 * VMAT2 blocker caps dopamine stores, dopamine blocker caps D2 receptors, supportive care steadies daily life. */
const L = { gene: $("gene"), neurons: $("neurons"), circuit: $("circuit"), clinic: $("clinic"), parts: $("parts"), over: $("over"), panel: $("panel"), slot: $("brainSlot"), stri: $("stri"), mutPath: $("mutPath"), shade: $("blockShade"), glow: $("moveGlow") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, t: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const muts = pool(24, () => mk("path", { class: "sc-p p-mut", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, L.parts));
const sigs = pool(26, () => mk("circle", { class: "sc-p p-sig", r: 2.8 }, L.parts));
let brainO = null, striC = [487, 201], mutTrack = null, sigTrack = null;
let neurons = [], childBeads = [], figG = null, mouthP = null, bubbles = [], gg = {}, capEl = null, capDrug = -1;
let d1caps = [], d2caps = [], walker = null;
const sm = { Mut: 0.4, Loss: 0.2, Ind: 0.2, Chor: 0.2, CogD: 0.2, Cog: 0.8, Psy: 0.2, Func: 0.8, d1: 0, d2: 0, d3: 0 };
const acc = { mut: 0, sig: 0 };
const FIG = [810, 140], FACE = [810, 290];
const NODES = [[170, "D2", "hd-n-msn", "Striatum"], [360, "GPe", "hd-n-gpe", "GPe"], [550, "GPi", "hd-n-gpi", "Output"], [740, "Move", "hd-n-ctx", "Movement"]];
function initOrgans() {
  brainO = organ(L.slot, "brain", 490, 205, 220, {});
  const par = brainO.ports.parenchyma;
  striC = [Math.round(par[0] + 15), Math.round(par[1] + 10)];
  L.stri.setAttribute("cx", striC[0]); L.stri.setAttribute("cy", striC[1]);
  L.shade.setAttribute("cx", striC[0]); L.shade.setAttribute("cy", striC[1]);
  L.mutPath.setAttribute("d", "M250 190 L340 186 L" + striC[0] + " " + striC[1]);
  mutTrack = track([[250, 190], [340, 186], striC]);
  sigTrack = track(NODES.map(([x]) => [x, 368]));
}
function initGene() {
  let d1 = "", d2 = "";
  for (let x = 65; x <= 235; x += 5) { const y1 = 140 + Math.sin((x - 65) / 170 * 6.28 * 2) * 17, y2 = 140 - Math.sin((x - 65) / 170 * 6.28 * 2) * 17; d1 += (x === 65 ? "M" : "L") + x + " " + f1(y1); d2 += (x === 65 ? "M" : "L") + x + " " + f1(y2); }
  mk("path", { class: "hd-dna", d: d1 }, L.gene); mk("path", { class: "hd-dna", d: d2 }, L.gene);
  for (let x = 82; x <= 218; x += 17) mk("path", { class: "hd-rung", d: "M" + x + " " + f1(140 + Math.sin((x - 65) / 170 * 12.56) * 17) + "L" + x + " " + f1(140 - Math.sin((x - 65) / 170 * 12.56) * 17) }, L.gene);
  for (let i = 0; i < 19; i++) mk("circle", { class: "hd-bead", cx: 67 + i * 9, cy: 198, r: 3.4 }, L.gene);
  const t1 = mk("text", { class: "sc-lab", x: 34, y: 262 }, L.gene); t1.textContent = "parent";
  const t2 = mk("text", { class: "sc-lab", x: 34, y: 296 }, L.gene); t2.textContent = "child";
  for (let i = 0; i < 9; i++) mk("circle", { class: "hd-bead2", cx: 96 + i * 9, cy: 258, r: 3.2 }, L.gene);
  for (let i = 0; i < 16; i++) { const b = mk("circle", { class: "hd-bead", cx: 96 + i * 9, cy: 292, r: 3.2 }, L.gene); childBeads.push(b); }
  mk("path", { class: "hd-link", d: "M78 266L78 284" }, L.gene);
}
function initNeurons() {
  const offs = [[-32, -15], [-2, -19], [30, -14], [-30, 13], [0, 17], [32, 14]];
  neurons = offs.map(([dx, dy], i) => { const g = cell(L.neurons, { cls: "msn", r: 13, nuc: 0.38, seed: i + 2, wob: 0.13 }); place(g, striC[0] + dx, striC[1] + dy, 0, 1); return { g, x: striC[0] + dx, y: striC[1] + dy, i }; });
}
function initCircuit() {
  const tips = ["Striatal D2 neurons. They fail first. Dopamine blockers sit on their receptors.", "Globus pallidus externa. Freed from striatal control, it overbrakes the next step.", "Output nucleus. Underdriven, it brakes movement less. The middle step of the circuit is folded in here.", "Movement. Released from its brake, extra motion leaks out as chorea."];
  NODES.forEach(([x, ab, cls, name], i) => {
    if (i < 3) { const nx = NODES[i + 1][0];
      mk("path", { class: "hd-arrow", d: "M" + (x + 22) + " 368L" + (nx - 22) + " 368" }, L.circuit);
      mk("path", { class: "hd-inhib", d: "M" + (nx - 22) + " 361L" + (nx - 22) + " 375" }, L.circuit);
      const s = mk("text", { class: "hd-ab", x: (x + nx) / 2, y: 360 }, L.circuit); s.textContent = "-"; }
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": tips[i] }, L.circuit);
    mk("circle", { class: "hd-node " + cls, cx: x, cy: 368, r: 20 }, g);
    const t = mk("text", { class: "hd-ab", x: x, y: 373 }, g); t.textContent = ab;
    const c = mk("text", { class: "sc-lab", x: x, y: 404, "text-anchor": "middle" }, L.circuit); c.textContent = name;
  });
  for (let i = 0; i < 7; i++) { const x = 215 + i * 16.7;
    mk("circle", { class: "sc-p p-sig", cx: f1(x), cy: 359, r: 3 }, L.circuit);
    const c = mk("circle", { class: "sc-p p-block", cx: f1(x), cy: 359, r: 4.6 }, L.circuit); c.setAttribute("opacity", "0"); d1caps.push(c); }
  for (let i = 0; i < 6; i++) { const a = i * 1.047, nx = 170 + Math.cos(a) * 20, ny = 368 + Math.sin(a) * 20;
    mk("circle", { class: "sc-p p-sig", cx: f1(nx), cy: f1(ny), r: 2.5 }, L.circuit);
    const c = mk("circle", { class: "sc-p p-block", cx: f1(170 + Math.cos(a) * 26), cy: f1(368 + Math.sin(a) * 26), r: 4 }, L.circuit); c.setAttribute("opacity", "0"); d2caps.push(c); }
}
function initClinic() {
  figG = mk("g", {}, L.clinic);
  mk("circle", { class: "hd-head", cx: 0, cy: -20, r: 8 }, figG);
  mk("path", { class: "hd-fig", d: "M0 -12L0 10M0 -5L-15 -11M0 -5L15 -14M0 10L-11 25M0 10L12 23" }, figG);
  place(figG, FIG[0], FIG[1], 0, 1);
  walker = mk("g", { opacity: "0" }, L.clinic);
  mk("path", { class: "hd-aid", d: "M788 150L788 196M832 150L832 196M788 152L832 152" }, walker);
  mk("circle", { class: "hd-wheel", cx: 788, cy: 199, r: 3.2 }, walker);
  mk("circle", { class: "hd-wheel", cx: 832, cy: 199, r: 3.2 }, walker);
  [[793, 228, 4], [812, 214, 6.5], [835, 199, 9.5]].forEach(([x, y, r]) => { bubbles.push(mk("circle", { class: "hd-bub", cx: x, cy: y, r: r }, L.clinic)); });
  const faceG = mk("g", {}, L.clinic);
  mk("circle", { class: "hd-face", cx: 0, cy: 0, r: 21 }, faceG);
  mk("circle", { class: "hd-eye", cx: -7, cy: -4, r: 2 }, faceG); mk("circle", { class: "hd-eye", cx: 7, cy: -4, r: 2 }, faceG);
  mouthP = mk("path", { class: "hd-mouth", d: "M-8 7Q0 13 8 7" }, faceG);
  place(faceG, FACE[0], FACE[1], 0, 1);
}
function capText(d) {
  if (d === 1) return "VMAT2 blocker traps dopamine in terminals. Less signal gets through. Chorea eases.";
  if (d === 2) return "Dopamine blocker sits on D2 receptors. The overdrive signal fades. Chorea eases.";
  if (d === 3) return "Supportive care steadies daily life. Neurons are still lost, but function holds up.";
  return "No treatment. Mutant protein harms striatal neurons. The brake fails and chorea grows.";
}
function initPanel() {
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["mut", "Mutant", "g-mut", "Faulty huntingtin burden in vulnerable neurons. No treatment here lowers it."], ["loss", "Neurons", "g-loss", "Loss of striatal spiny neurons. No treatment here brings them back."], ["chor", "Chorea", "g-chor", "Extra involuntary movement leaking through the failed brake."], ["cog", "Thinking", "g-good", "Planning, focus and memory still preserved."], ["func", "Daily life", "g-good", "Day to day function and independence."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 150 + i * 160, 486, 52, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "HTT gene", 150, 140, 150, 100, "The huntingtin gene. An expanded repeat inside it causes the disease.");
  pill(o, "CAG repeat", 150, 198, 150, 232, "A repeated stretch in the gene. It often grows when passed on, so signs can start earlier in the next generation.");
  pill(o, "Mutant protein", 367, 195, 310, 252, "Faulty huntingtin protein. It travels to the striatum and slowly harms its neurons.");
  pill(o, "Spiny neurons", striC[0], striC[1] - 38, 500, 100, "Medium spiny neurons of the striatum. They die first, and no drug here brings them back.");
  pill(o, "Brake circuit", 455, 368, 455, 330, "The indirect pathway brakes movement. Losing striatal input releases the brake.");
  pill(o, "Chorea", 814, 132, 884, 102, "Brief jerky involuntary movements that flow between body parts.");
  pill(o, "Thinking and mood", 828, 292, 872, 344, "Planning and focus fade, and mood often dips years before chorea.");
  capEl = mk("text", { class: "hd-capmain", x: 30, y: 428 }, o); capEl.textContent = capText(0);
}
function init() { initOrgans(); initGene(); initNeurons(); initCircuit(); initClinic(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Mut", "Loss", "Ind", "Chor", "CogD", "Cog", "Psy", "Func", "d1", "d2", "d3"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "Mut" || q === "d1" || q === "d2" || q === "d3" ? k1 : k2); });
  L.stri.setAttribute("rx", f1(62 - 9 * sm.Loss)); L.stri.setAttribute("ry", f1(40 - 6 * sm.Loss));
  L.stri.setAttribute("opacity", (1 - 0.3 * sm.Loss).toFixed(2));
  L.shade.setAttribute("opacity", clamp(0.3 * sm.d1 + 0.22 * sm.d2).toFixed(2));
  L.glow.setAttribute("opacity", (sm.Chor * 0.35).toFixed(2));
  neurons.forEach((n) => { const dying = clamp((sm.Loss - (n.i / 6) * 0.6) * 2.6), s = 1 - dying * 0.82; n.g.style.opacity = (0.16 + 0.84 * s).toFixed(2); place(n.g, n.x, n.y, Math.sin(tm / 700 + n.i) * 6, 0.3 + 0.7 * s); });
  childBeads.forEach((b, i) => b.setAttribute("opacity", (0.55 + 0.45 * Math.sin(tm / 500 + i)).toFixed(2)));
  acc.mut += dt * sm.Mut * 7; while (acc.mut >= 1) { acc.mut--; const p = free(muts); if (p) emit(p, rnd(238, 262), rnd(178, 202)); }
  muts.forEach((p) => { if (!p.on) return; p.u += dt * 52 / mutTrack.len; const q = mutTrack.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.u >= 1) kill(p); });
  const blk = clamp(0.55 * sm.d1 + 0.35 * sm.d2);
  acc.sig += dt * (1.2 + sm.Ind * 6.5) * (1 - blk); while (acc.sig >= 1) { acc.sig--; const p = free(sigs); if (p) { emit(p, 170, 368); p.e.setAttribute("opacity", (1 - 0.5 * blk).toFixed(2)); } }
  sigs.forEach((p) => { if (!p.on) return; p.u += dt * (60 + sm.Ind * 80) / sigTrack.len; const q = sigTrack.at(Math.min(1, p.u)); p.x = q.x; p.y = q.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.u >= 1) kill(p); });
  const j = sm.Chor;
  place(figG, FIG[0] + Math.sin(tm / 130) * j * 5, FIG[1] + Math.cos(tm / 170) * j * 4, Math.sin(tm / 150) * j * 10, 1);
  bubbles.forEach((b, i) => { b.setAttribute("opacity", (0.25 + 0.75 * sm.Cog).toFixed(2)); });
  mouthP.setAttribute("d", "M-8 7Q0 " + f1(13 - sm.Psy * 13) + " 8 7");
  d1caps.forEach((c) => c.setAttribute("opacity", sm.d1.toFixed(2)));
  d2caps.forEach((c) => c.setAttribute("opacity", sm.d2.toFixed(2)));
  walker.setAttribute("opacity", sm.d3.toFixed(2));
  gg.mut.set(sm.Mut, wordOf(sm.Mut, 0.35, 0.65, ["low", "raised", "high"]));
  gg.loss.set(sm.Loss, wordOf(sm.Loss, 0.25, 0.65, ["none", "some", "severe"]));
  gg.chor.set(sm.Chor, wordOf(sm.Chor, 0.25, 0.6, ["none", "mild", "marked"]));
  gg.cog.set(sm.Cog, wordOf(sm.Cog, 0.35, 0.65, ["lost", "impaired", "preserved"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
