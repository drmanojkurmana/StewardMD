/* Schizophrenia scene: four dopamine pathways, D2 gates, movement and prolactin effects. */
const layers = { nodes: $("nodes"), gates: $("gates"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LANES = [135, 210, 285, 360];
const TRK = LANES.map((y) => track([[178, y], [752, y]]));
const UB = (470 - 178) / 574;
const NODEDEF = [
  ["vta1", "vta", 150, 135, 28, "VTA", "Ventral tegmental area (VTA): dopamine neurons that supply the mesolimbic and mesocortical pathways."],
  ["vta2", "vta", 150, 210, 28, "VTA", "Ventral tegmental area (VTA): the same dopamine cell group, drawn again for the mesocortical lane. Its cortical signal is too weak in schizophrenia."],
  ["nigra", "nigra", 150, 285, 28, "Nigra", "Substantia nigra: dopamine neurons of the nigrostriatal pathway. This pathway starts near normal; trouble comes from blocking it."],
  ["arc", "arc", 150, 360, 28, "Arcuate", "Arcuate nucleus of the hypothalamus: dopamine neurons of the tuberoinfundibular pathway. Their dopamine normally restrains prolactin."],
  ["limb", "limb", 790, 135, 38, "Limbic", "Limbic area including the nucleus accumbens. Excess dopamine signal here is linked to positive symptoms."],
  ["pfc", "pfc", 790, 210, 38, "Prefrontal", "Prefrontal cortex. Too little dopamine signal here is linked to negative and cognitive symptoms."],
  ["stri", "stri", 790, 285, 38, "Striatum", "Striatum: the movement control target of the nigrostriatal pathway. D2 blockade here causes extrapyramidal movement effects."],
  ["pit", "pit", 790, 360, 38, "Pituitary", "Pituitary gland. Dopamine normally holds prolactin down; D2 blockade releases that restraint and prolactin rises."],
];
const nodeG = {};
const gates = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, x: 0, y: 0, vx: 0, vy: 0, pass: false, lane: 0 }; }); }
const daML = pool(12, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const daMC = pool(12, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const daNS = pool(12, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const daTI = pool(12, () => mk("circle", { class: "sc-p p-da", r: 2.8 }, layers.parts));
const DAP = [daML, daMC, daNS, daTI];
const prlP = pool(10, () => mk("circle", { class: "sc-p p-prl", r: 2.6 }, layers.parts));
const drugP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-drug", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, lane) { p.on = true; p.u = 0; p.pass = false; p.lane = lane; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function moveLane(pl, dt, blk) { pl.forEach((p) => { if (!p.on) return; p.u += dt * 85 / TRK[p.lane].len; if (!p.pass && p.u >= UB) { p.pass = true; if (Math.random() < blk) { killP(p); return; } } const q = TRK[p.lane].at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y + Math.sin(tm / 300 + p.lane * 2) * 1.5) + ")"); if (p.u >= 1) killP(p); }); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "Symptoms and effects";
  [["block", "D2 block", "g-szblock", "How strongly D2 receptors are blocked. The slider sets untreated, treated or over-blocked; the treatment choice sets how broadly that blockade falls across pathways."], ["meso", "Meso excess", "g-szmeso", "Effective dopamine signal in the mesolimbic pathway. High signal drives positive symptoms; D2 blockade brings it down."], ["pos", "Positive sx", "g-szpos", "Positive symptoms: delusions, hallucinations and disorganised thought. They ease as mesolimbic blockade increases."], ["cort", "Cortical", "g-szcort", "Dopamine signal reaching the prefrontal cortex. It stays low; D2 blockade does not restore it, so negative and cognitive symptoms persist."], ["eps", "Movement fx", "g-szeps", "Extrapyramidal movement effects from nigrostriatal D2 blockade: dystonia, parkinsonism, akathisia and tardive dyskinesia with time."], ["prl", "Prolactin", "g-szprl", "Prolactin from the pituitary. Dopamine normally restrains it, so tuberoinfundibular D2 blockade lets it rise."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mesolimbic", 320, 135, 320, 111, "Mesolimbic pathway: ventral tegmental area to limbic areas including the nucleus accumbens. Excess dopamine signal here is linked to positive symptoms.");
  pill(ox, "Mesocortical", 320, 210, 320, 186, "Mesocortical pathway: ventral tegmental area to prefrontal cortex. Too little dopamine signal here is linked to negative and cognitive symptoms.");
  pill(ox, "Nigrostriatal", 320, 285, 320, 261, "Nigrostriatal pathway: substantia nigra to striatum. It controls movement and starts near normal. Blocking it causes extrapyramidal effects.");
  pill(ox, "Tuberoinfundibular", 320, 360, 320, 336, "Tuberoinfundibular pathway: arcuate nucleus of the hypothalamus to the pituitary. Its dopamine normally restrains prolactin release.");
  pill(ox, "D2 blockade", 470, 117, 470, 94, "D2 receptor blockade. An antipsychotic sits on D2 receptors in every pathway at once, which is why benefit and adverse effects arrive together.");
  pill(ox, "Positive sx", 826, 135, 888, 135, "Positive symptoms: delusions, hallucinations and disorganised thought, driven by mesolimbic excess and eased by D2 blockade.");
  pill(ox, "Negative sx", 826, 210, 888, 210, "Negative and cognitive symptoms: blunted affect, avolition, social withdrawal and poor thinking. They persist because cortical dopamine stays low.");
  pill(ox, "Movement", 826, 285, 888, 285, "Movement output of the striatum. Nigrostriatal D2 blockade disturbs it, causing extrapyramidal side effects.");
  pill(ox, "Prolactin", 826, 360, 888, 360, "Prolactin release from the pituitary. It rises when tuberoinfundibular D2 blockade removes dopamine restraint.");
}
const sm = { Bm: 0, Bc: 0, Bn: 0, Bt: 0, ML: 0.95, MC: 0.26, NS: 0.95, TI: 0.92, PRL: 0.14, EPS: 0.05 };
const acc = { ml: 0, mc: 0, ns: 0, ti: 0, prl: 0, drug: 0 };
function init() {
  NODEDEF.forEach(([id, cls, x, y, r, lab, tip]) => {
    const g = cell(layers.nodes, { cls, r, nuc: 0.32, seed: x * 0.01 + y * 0.02, wob: 0.08 });
    g.setAttribute("class", g.getAttribute("class") + " hot"); g.setAttribute("tabindex", "0"); g.setAttribute("data-info", tip);
    const tt = mk("text", { class: "sz-node-t", x: 0, y: 3, "text-anchor": "middle" }, g); tt.textContent = lab;
    place(g, x, y, 0, 1); nodeG[id] = g;
  });
  LANES.forEach((y, i) => {
    const g = mk("g", { class: "hot", tabindex: "0", "data-info": "D2 receptor gate on this pathway. It grows as blockade rises; dopamine dots stopped here never reach the target." }, layers.gates);
    const bar = mk("rect", { class: "sz-gate", x: 465, y: y - 4, width: 10, height: 8, rx: 3, opacity: "0.18" }, g);
    mk("circle", { class: "sz-rec", cx: 470, cy: y, r: 4 }, g);
    gates.push({ bar, y, i });
  });
  initPanel();
}
function step(dt, m) {
  const k = Math.min(1, dt * 1.4);
  sm.Bm = lerp(sm.Bm, m.Bm, k); sm.Bc = lerp(sm.Bc, m.Bc, k); sm.Bn = lerp(sm.Bn, m.Bn, k); sm.Bt = lerp(sm.Bt, m.Bt, k);
  sm.ML = lerp(sm.ML, m.ML, k); sm.MC = lerp(sm.MC, m.MC, k); sm.NS = lerp(sm.NS, m.NS, k); sm.TI = lerp(sm.TI, m.TI, k); sm.PRL = lerp(sm.PRL, m.PRL, k); sm.EPS = lerp(sm.EPS, m.EPS, k);
  const blks = [sm.Bm, sm.Bc, sm.Bn, sm.Bt];
  gates.forEach((gt, i) => { const bh = 8 + 28 * blks[i]; gt.bar.setAttribute("y", f1(gt.y - bh / 2)); gt.bar.setAttribute("height", f1(bh)); gt.bar.setAttribute("opacity", (0.18 + 0.82 * blks[i]).toFixed(2)); });
  place(nodeG.limb, 790, 135, 0, 0.92 + 0.16 * sm.ML * Math.max(0, Math.sin(tm / 380)));
  place(nodeG.pfc, 790, 210, 0, 0.92 + 0.14 * sm.MC * Math.max(0, Math.sin(tm / 460)));
  place(nodeG.stri, 790 + Math.sin(tm / 42) * sm.EPS * 3, 285, 0, 0.92 + 0.1 * sm.NS);
  place(nodeG.pit, 790, 360, 0, 0.9 + 0.28 * sm.PRL);
  place(nodeG.vta1, 150, 135, 0, 0.95 + 0.08 * Math.max(0, Math.sin(tm / 400)));
  place(nodeG.vta2, 150, 210, 0, 0.95 + 0.06 * Math.max(0, Math.sin(tm / 520)));
  const raws = [0.95, 0.3, 0.9, 0.9];
  acc.ml += dt * raws[0] * 9; acc.mc += dt * raws[1] * 9; acc.ns += dt * raws[2] * 9; acc.ti += dt * raws[3] * 9;
  [daML, daMC, daNS, daTI].forEach((pl, lane) => { let a = lane === 0 ? acc.ml : lane === 1 ? acc.mc : lane === 2 ? acc.ns : acc.ti; while (a >= 1) { a--; const p = freeP(pl); if (p) emitP(p, lane); } if (lane === 0) acc.ml = a; else if (lane === 1) acc.mc = a; else if (lane === 2) acc.ns = a; else acc.ti = a; });
  moveLane(daML, dt, sm.Bm); moveLane(daMC, dt, sm.Bc); moveLane(daNS, dt, sm.Bn); moveLane(daTI, dt, sm.Bt);
  acc.prl += dt * sm.PRL * 6; while (acc.prl >= 1) { acc.prl--; const p = freeP(prlP); if (p) { p.on = true; p.x = 826; p.y = 360 + rnd(-6, 6); p.vx = rnd(22, 30); p.vy = rnd(-5, 5); p.e.setAttribute("opacity", "1"); } }
  prlP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 846) killP(p); });
  acc.drug += dt * (drug > 0 ? 3 : 0); while (acc.drug >= 1) { acc.drug--; const p = freeP(drugP); if (p) { p.on = true; p.lane = Math.floor(Math.random() * 4); p.x = 470 + rnd(-8, 8); p.y = LANES[p.lane] - 28; p.e.setAttribute("opacity", "1"); } }
  drugP.forEach((p) => { if (!p.on) return; p.y += 30 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(20)"); if (p.y > LANES[p.lane] - 8) killP(p); });
  gg.block.set(Math.max(sm.Bm, sm.Bc, sm.Bn, sm.Bt), wordOf(Math.max(sm.Bm, sm.Bc, sm.Bn, sm.Bt), 0.2, 0.6, ["none", "partial", "strong"]));
  gg.meso.set(sm.ML, wordOf(sm.ML, 0.35, 0.65, ["low", "raised", "high"]));
  gg.pos.set(m.Pos, wordOf(m.Pos, 0.35, 0.65, ["controlled", "moderate", "marked"]));
  gg.cort.set(sm.MC, wordOf(sm.MC, 0.35, 0.7, ["low", "reduced", "near normal"]));
  gg.eps.set(sm.EPS, wordOf(sm.EPS, 0.25, 0.55, ["none", "some", "marked"]));
  gg.prl.set(sm.PRL, wordOf(sm.PRL, 0.3, 0.6, ["normal", "raised", "high"]));
}
run({ init, step });
