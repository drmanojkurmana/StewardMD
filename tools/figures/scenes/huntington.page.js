/* Huntington scene: expanded repeat, mutant protein, striatal neuron loss, indirect pathway failure and the clinical signs. */
const L = { gene: $("gene"), neurons: $("neurons"), clinic: $("clinic"), circuit: $("circuit"), parts: $("parts"), over: $("over"), panel: $("panel"), stri: $("stri") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const muts = pool(26, () => mk("path", { class: "sc-p p-mut", d: "M0 -3.4L3 0L0 3.4L-3 0Z" }, L.parts));
const sigs = pool(22, () => mk("circle", { class: "sc-p p-sig", r: 2.6 }, L.parts));
const neuronPos = [[428, 142], [482, 130], [536, 146], [420, 184], [478, 180], [538, 190], [440, 226], [496, 226], [548, 224]];
let neurons = [], childBeads = [], figG, brainG, faceG, mouthP, gg = {};
const sm = { Mut: 0.4, Loss: 0.2, Ind: 0.2, Chor: 0.2, CogD: 0.2, Cog: 0.8, Psy: 0.2, Func: 0.8, symp: 0, couns: 0, supp: 0 };
const acc = { mut: 0, sig: 0 };
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
function initClinic() {
  figG = mk("g", {}, L.clinic);
  mk("circle", { class: "hd-head", cx: 0, cy: -20, r: 8 }, figG);
  mk("path", { class: "hd-fig", d: "M0 -12L0 10M0 -5L-15 -11M0 -5L15 -14M0 10L-11 25M0 10L12 23" }, figG);
  brainG = cell(L.clinic, { cls: "brain", r: 23, nuc: 0.4, seed: 4, wob: 0.16 });
  faceG = mk("g", {}, L.clinic);
  mk("circle", { class: "hd-face", cx: 0, cy: 0, r: 21 }, faceG);
  mk("circle", { class: "hd-eye", cx: -7, cy: -4, r: 2 }, faceG); mk("circle", { class: "hd-eye", cx: 7, cy: -4, r: 2 }, faceG);
  mouthP = mk("path", { class: "hd-mouth", d: "M-8 7Q0 13 8 7" }, faceG);
  place(brainG, 730, 210, 0, 1); place(faceG, 730, 290, 0, 1); place(figG, 730, 128, 0, 1);
}
function initCircuit() {
  const nodes = [[110, "D2", "hd-n-msn", "Striatum", "Striatal medium spiny neurons of the indirect pathway. Their loss is the core brain change in Huntington disease."], [260, "GPe", "hd-n-gpe", "GPe", "Globus pallidus externa. Normally held in check by striatal neurons; when they are lost it becomes overactive."], [390, "STN", "hd-n-stn", "STN", "Subthalamic nucleus. Overactive GPe suppresses it, so it drives the output nuclei less."], [520, "GPi", "hd-n-gpi", "GPi", "Globus pallidus interna, an output nucleus. With less drive from STN it brakes the thalamus less."], [650, "Thal", "hd-n-thal", "Thalamus", "Thalamus. Released from its brake, it overdrives the cortex."], [790, "Ctx", "hd-n-ctx", "Cortex", "Motor cortex. Excess drive produces unwanted involuntary movements: chorea."]];
  const kinds = ["inh", "inh", "exc", "inh", "exc"];
  nodes.forEach(([x, ab, cls, name, tip], i) => {
    if (i < 5) { const nx = nodes[i + 1][0]; mk("path", { class: "hd-arrow", d: "M" + (x + 23) + " 375L" + (nx - 25) + " 375" }, L.circuit);
      if (kinds[i] === "inh") mk("path", { class: "hd-inhib", d: "M" + (nx - 25) + " 367L" + (nx - 25) + " 383" }, L.circuit);
      else { const tri = mk("polygon", { class: "hd-node", points: (nx - 25) + ",375 " + (nx - 33) + ",370 " + (nx - 33) + ",380" }, L.circuit); tri.setAttribute("fill", "var(--anatomy-strong)"); }
      const s = mk("text", { class: "hd-sign", x: (x + nx) / 2, y: 362 }, L.circuit); s.textContent = kinds[i] === "inh" ? "-" : "+"; }
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.circuit);
    mk("circle", { class: "hd-node " + cls, cx: x, cy: 375, r: 22 }, g);
    const t = mk("text", { class: "hd-sign", x: x, y: 379 }, g); t.textContent = ab;
    const c = mk("text", { class: "hd-cap sc-lab", x: x, y: 414 }, L.circuit); c.textContent = name;
  });
}
function init() {
  initGene(); initClinic(); initCircuit();
  neurons = neuronPos.map(([x, y], i) => { const g = cell(L.neurons, { cls: "msn", r: 14, nuc: 0.38, seed: i + 2, wob: 0.13 }); place(g, x, y, 0, 1); return { g, x, y, i }; });
  const o = L.over;
  pill(o, "HTT gene", 150, 128, 150, 92, "The huntingtin gene (HTT). A CAG repeat inside it is expanded in Huntington disease.");
  pill(o, "CAG repeat", 150, 198, 150, 228, "A repeated CAG stretch in the gene. Longer, expanded repeats make a faulty huntingtin protein.");
  pill(o, "Anticipation", 160, 292, 175, 328, "Autosomal dominant inheritance: each child can inherit the expansion. Repeats often grow between generations, so symptoms may start earlier in the child.");
  pill(o, "Mutant protein", 292, 150, 315, 95, "Mutant huntingtin protein. It gradually harms vulnerable neurons, above all striatal medium spiny neurons.");
  pill(o, "Spiny neurons", 490, 160, 500, 90, "Medium spiny neurons of the striatum (caudate and putamen). They are lost as the disease advances.");
  pill(o, "Chorea", 742, 122, 835, 102, "Chorea: brief, jerky, involuntary movements that flow between body parts. A hallmark movement sign.");
  pill(o, "Thinking", 742, 204, 835, 182, "Thinking and planning slow and become less flexible. Memory and judgement decline later.");
  pill(o, "Mood", 742, 284, 835, 262, "Mood and behaviour change: low mood, apathy, irritability and anxiety are common, sometimes years before chorea.");
  pill(o, "Indirect pathway", 390, 368, 395, 330, "The indirect pathway is the braking circuit of the basal ganglia. Losing its striatal neurons releases movement.");
  const sp = pill(o, "Symptomatic drugs", 748, 138, 835, 142, "Drugs that ease chorea and some mood symptoms. They do not restore lost neurons."); sp.setAttribute("id", "hd-symp"); sp.style.opacity = 0;
  const co = pill(o, "Counselling", 132, 296, 285, 285, "Genetic counselling: inheritance, testing choices, family planning and support for relatives at risk."); co.setAttribute("id", "hd-couns"); co.style.opacity = 0;
  const su = pill(o, "Supportive care", 748, 296, 835, 302, "Supportive care: physiotherapy, speech and swallowing help, nutrition, occupational and social support."); su.setAttribute("id", "hd-supp"); su.style.opacity = 0;
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 448, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["mut", "Mutant", "g-mut", "Mutant huntingtin burden in vulnerable neurons."], ["loss", "Neuron loss", "g-loss", "Loss of striatal medium spiny neurons."], ["ind", "Indirect", "g-ind", "Failure of the indirect (braking) pathway of the basal ganglia."], ["chor", "Chorea", "g-chor", "Unwanted involuntary movements released by the failing brake."], ["cog", "Thinking", "g-good", "Thinking, planning and memory still preserved."], ["func", "Function", "g-good", "Day to day function and independence."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, 486, 52, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Mut", "Loss", "Ind", "Chor", "CogD", "Cog", "Psy", "Func", "symp", "couns", "supp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "Mut" || q === "symp" || q === "couns" || q === "supp" ? k1 : k2); });
  L.stri.setAttribute("rx", f1(118 - 16 * sm.Loss)); L.stri.setAttribute("ry", f1(78 - 11 * sm.Loss)); L.stri.setAttribute("opacity", (1 - 0.35 * sm.Loss).toFixed(2));
  neurons.forEach((n) => { const dying = clamp((sm.Loss - (n.i / 9) * 0.65) * 3), s = 1 - dying * 0.82; n.g.style.opacity = (0.16 + 0.84 * s).toFixed(2); place(n.g, n.x, n.y, Math.sin(tm / 700 + n.i) * 6, 0.3 + 0.7 * s); });
  childBeads.forEach((b, i) => b.setAttribute("opacity", (0.55 + 0.45 * Math.sin(tm / 500 + i)).toFixed(2)));
  acc.mut += dt * sm.Mut * 7; while (acc.mut >= 1) { acc.mut--; const p = free(muts), n = pick(neuronPos); if (p) emit(p, 248, rnd(138, 168), 0, 0, neuronPos.indexOf(n)); }
  muts.forEach((p) => { if (!p.on) return; const tg = neuronPos[p.k], dx = tg[0] - p.x, dy = tg[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 52 * dt; p.y += (dy / d) * 52 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 15) kill(p); });
  acc.sig += dt * (1.6 + sm.Ind * 6); while (acc.sig >= 1) { acc.sig--; const p = free(sigs); if (p) emit(p, 134, 375, 68 + sm.Ind * 65, 0, 0); }
  sigs.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " 375)"); if (p.x > 786) kill(p); });
  const j = sm.Chor;
  place(figG, 730 + Math.sin(tm / 130) * j * 4, 128 + Math.cos(tm / 170) * j * 3, Math.sin(tm / 150) * j * 9, 1);
  place(brainG, 730, 210, Math.sin(tm / 900) * 3, 1 - 0.16 * sm.CogD);
  brainG.style.opacity = (1 - 0.3 * sm.CogD).toFixed(2);
  place(faceG, 730, 290, 0, 1);
  mouthP.setAttribute("d", "M-8 7Q0 " + f1(13 - sm.Psy * 13) + " 8 7");
  $("hd-symp").style.opacity = sm.symp.toFixed(2); $("hd-couns").style.opacity = sm.couns.toFixed(2); $("hd-supp").style.opacity = sm.supp.toFixed(2);
  gg.mut.set(sm.Mut, wordOf(sm.Mut, 0.35, 0.65, ["low", "raised", "high"]));
  gg.loss.set(sm.Loss, wordOf(sm.Loss, 0.25, 0.6, ["none", "some", "severe"]));
  gg.ind.set(sm.Ind, wordOf(sm.Ind, 0.25, 0.6, ["working", "weak", "failed"]));
  gg.chor.set(sm.Chor, wordOf(sm.Chor, 0.25, 0.6, ["none", "mild", "marked"]));
  gg.cog.set(sm.Cog, wordOf(sm.Cog, 0.35, 0.65, ["lost", "impaired", "preserved"]));
  gg.func.set(sm.Func, wordOf(sm.Func, 0.35, 0.65, ["poor", "reduced", "good"]));
}
run({ init, step });
