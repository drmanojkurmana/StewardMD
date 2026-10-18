/* Autonomic scene: two outflows, ganglia, transmitters, five target organs and gauges. */
const LY = { fibres: $("fibres"), nodes: $("nodes"), organs: $("organs"), parts: $("parts"), over: $("over"), panel: $("panel") };
const ROWS = [
  { id: "eye", y: 105, name: "Eye" },
  { id: "heart", y: 170, name: "Heart" },
  { id: "lungs", y: 235, name: "Lungs" },
  { id: "gut", y: 300, name: "Gut" },
  { id: "bladder", y: 365, name: "Bladder" },
];
function line(parent, x1, y1, x2, y2, cls) { return mk("line", { class: cls, x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2) }, parent); }
function path(parent, d, cls) { return mk("path", { class: cls, d: d }, parent); }
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const achPreSym = pool(12, () => mk("circle", { class: "sc-p p-achs", r: 2.6 }, LY.parts));
const achPrePara = pool(22, () => mk("circle", { class: "sc-p p-achp", r: 2.6 }, LY.parts));
const naPost = pool(34, () => mk("circle", { class: "sc-p p-na", r: 2.4 }, LY.parts));
const achPost = pool(26, () => mk("circle", { class: "sc-p p-achm", r: 2.4 }, LY.parts));
const gutDots = [], drops = pool(10, () => mk("path", { class: "ans-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, LY.parts));
const organEls = {};
let pupilEl = null, heartEl = null, airwayEl = null, bladderEl = null;
const marks = {};
const gg = {};
const sm = { sym: 0, para: 1, heart: 0.1, pupil: 0.08, airway: 0.3, gut: 0.9, bladder: 0.9, vessel: 0.2 };
const acc = { preS: 0, preP: 0, na: 0, ach: 0, drop: 0 };
function nicMarks(parent, cx, cy) {
  for (let j = 0; j < 3; j++) { const a = -0.7 + j * 0.7; mk("path", { class: "ans-nic", d: "M" + f1(cx + Math.cos(a) * 12) + " " + f1(cy + Math.sin(a) * 12) + "l" + f1(Math.cos(a) * 5) + " " + f1(Math.sin(a) * 5) }, parent); }
}
function buildNodes() {
  const N = LY.nodes, F = LY.fibres;
  mk("ellipse", { class: "ans-brain", cx: 93, cy: 88, rx: 42, ry: 24 }, N);
  mk("rect", { class: "ans-cord", x: 80, y: 110, width: 26, height: 262, rx: 13 }, N);
  path(F, "M232 105L232 365", "ans-chain");
  path(F, "M124 84C150 88 168 110 168 150L168 365", "ans-vagus");
  path(F, "M96 362C120 386 148 384 168 365", "ans-paraline");
  ROWS.forEach((r) => {
    line(F, 106, r.y - 6, 221, r.y - 6, "ans-symline");
    line(F, 168, r.y + 10, 612, r.y + 10, "ans-paraline");
    line(F, 243, r.y - 8, 786, r.y - 8, "ans-symline");
    line(F, 638, r.y + 10, 786, r.y + 10, "ans-paraline");
    const gs = mk("circle", { class: "ans-gang-sym", cx: 232, cy: r.y - 6, r: 11 }, N); nicMarks(N, 232, r.y - 6);
    const gp = mk("circle", { class: "ans-gang-para", cx: 625, cy: r.y + 10, r: 11 }, N); nicMarks(N, 625, r.y + 10);
    mk("rect", { class: "ans-rec-sym", x: 782, y: r.y - 12, width: 8, height: 8, rx: 2 }, N);
    mk("circle", { class: "ans-rec-para", cx: 786, cy: r.y + 10, r: 4.4 }, N);
  });
}
function buildOrgans() {
  const O = LY.organs;
  ROWS.forEach((r) => {
    const g = mk("g", {}, O); organEls[r.id] = g;
    if (r.id === "eye") {
      mk("ellipse", { class: "ans-eye", cx: 820, cy: r.y, rx: 36, ry: 22 }, g);
      mk("circle", { class: "ans-iris", cx: 820, cy: r.y, r: 15 }, g);
      pupilEl = mk("circle", { class: "ans-pupil", cx: 820, cy: r.y, r: 5 }, g);
    } else if (r.id === "heart") {
      heartEl = mk("path", { class: "ans-heart", d: "M820 190C806 176 788 182 788 194C788 208 820 224 820 224C820 224 852 208 852 194C852 182 834 176 820 190Z" }, g);
    } else if (r.id === "lungs") {
      mk("path", { class: "ans-lung", d: "M812 218C800 226 796 246 800 262C802 270 814 268 816 258L818 238Z" }, g);
      mk("path", { class: "ans-lung", d: "M828 218C840 226 844 246 840 262C838 270 826 268 824 258L822 238Z" }, g);
      mk("rect", { class: "ans-airway", x: 817, y: 210, width: 6, height: 18, rx: 3 }, g);
      airwayEl = mk("circle", { class: "ans-airway", cx: 820, cy: 244, r: 7 }, g);
    } else if (r.id === "gut") {
      path(g, "M792 288C810 278 830 288 848 284M792 302C812 294 828 306 848 300M794 316C812 308 830 318 846 312", "ans-gut");
      for (let i = 0; i < 3; i++) { const d = mk("circle", { class: "ans-gutdot", cx: 796 + i * 18, cy: 292 + i * 9, r: 3 }, g); gutDots.push({ e: d, off: i * 0.33 }); }
    } else if (r.id === "bladder") {
      bladderEl = mk("path", { class: "ans-bladder", d: "M820 338C838 338 848 352 848 366C848 382 836 392 820 392C804 392 792 382 792 366C792 352 802 338 820 338Z" }, g);
      mk("rect", { class: "ans-airway", x: 816, y: 392, width: 8, height: 12, rx: 3 }, g);
    }
  });
}
function addMark(id, drugs, ax, ay, text, tx, ty, tip, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(ax - 6) + " " + f1(ay) + "l4 5l8 -10" }, g); }
  else { mk("circle", { class: "mk-c", cx: f1(ax), cy: f1(ay), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(ax - 4) + " " + f1(ay - 4) + "l8 8M" + f1(ax + 4) + " " + f1(ay - 4) + "l-8 8" }, g); }
  pill(g, text, ax, ay, tx, ty, tip);
  g.style.display = "none"; marks[id] = { g, drugs }; return g;
}
function buildLabels() {
  const O = LY.over;
  pill(O, "Brainstem", 93, 70, 88, 54, "Brainstem and cord: the central origin. Parasympathetic fibres leave with cranial nerves, sympathetic fibres leave the thoracolumbar cord.");
  pill(O, "Vagus nerve", 168, 120, 190, 58, "Vagus nerve: the long parasympathetic preganglionic fibre to ganglia near the heart, lungs and gut. Sacral fibres supply the bladder and lower gut.");
  pill(O, "Sympathetic chain", 232, 99, 305, 58, "Sympathetic chain: thoracolumbar outflow. Short preganglionic fibres relay here, then long postganglionic fibres reach the organs.");
  pill(O, "Ganglion near organ", 625, 115, 625, 58, "Parasympathetic ganglion close to or inside the target organ, so the postganglionic fibre is short. Sympathetic ganglia sit in the chain instead.");
  pill(O, "Target organs", 820, 80, 825, 58, "Five targets read the balance: eye, heart, airways, gut and bladder. Each gets both outflows, with opposite effects.");
  pill(O, "ACh to nicotinic", 175, 164, 420, 136, "Every preganglionic fibre, sympathetic and parasympathetic, releases acetylcholine. In the ganglion it acts on nicotinic receptors to fire the next fibre.");
  pill(O, "NA to alpha, beta", 420, 162, 420, 201, "Sympathetic postganglionic fibres release noradrenaline onto alpha and beta adrenoceptors. Alpha tightens vessels and widens the pupil, beta speeds the heart and opens airways.");
  pill(O, "ACh to muscarinic", 560, 245, 420, 266, "Parasympathetic postganglionic fibres release acetylcholine onto muscarinic receptors. That slows the heart, narrows pupil and airways, moves gut and empties the bladder.");
  pill(O, "Eye", 856, 105, 900, 105, "Eye and pupil: sympathetic widens the pupil, parasympathetic narrows it and focuses for near vision.");
  pill(O, "Heart", 856, 170, 900, 170, "Heart: sympathetic beta receptors speed and strengthen the beat, parasympathetic muscarinic receptors slow it.");
  pill(O, "Lungs", 856, 235, 900, 235, "Lungs and airways: sympathetic beta receptors open the airways, parasympathetic muscarinic receptors narrow them and add secretions.");
  pill(O, "Gut", 852, 300, 894, 300, "Gut: parasympathetic muscarinic activity moves food along, sympathetic activity slows motility and digestion.");
  pill(O, "Bladder", 856, 365, 906, 365, "Bladder: parasympathetic contracts the detrusor to empty, sympathetic relaxes it and closes the outlet to store urine.");
  addMark("beta", [1], 786, 162, "Beta blocked", 560, 140, "A beta blocker blocks beta receptors, so noradrenaline arrives but the heart and airways respond less. Alpha and muscarinic effects remain.", false);
  addMark("musc", [2], 786, 310, "Muscarinic blocked", 560, 336, "A muscarinic antagonist blocks muscarinic receptors, so parasympathetic acetylcholine arrives but cannot act. The pupil widens, gut slows and bladder holds.", false);
  addMark("alpha", [3], 786, 97, "Alpha boosted", 560, 140, "An alpha agonist stimulates alpha receptors directly: vessels tighten and the pupil widens, without needing more sympathetic firing.", true);
}
function buildPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "What the organs do";
  [["heart", "Heart rate", "g-bad", "Heart rate and force: beta sympathetic speeds it, muscarinic parasympathetic slows it."], ["pupil", "Pupil size", "g-sym", "Pupil size: alpha sympathetic widens it, muscarinic parasympathetic narrows it."], ["airway", "Airways", "g-fl", "Airway openness: beta sympathetic opens airways, muscarinic parasympathetic narrows them."], ["gut", "Gut activity", "g-para", "Gut motility: muscarinic parasympathetic moves it, sympathetic slows it."], ["bladder", "Bladder", "g-para", "Bladder readiness to empty: muscarinic contracts the detrusor, sympathetic relaxes it and closes the outlet."], ["vessel", "Vessel tone", "g-sym", "Vessel tone and pressure tendency: alpha sympathetic tightens vessels, with little parasympathetic supply to most vessels."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 118 + i * 142, y0 + 2, 52, 18, cls, name, tip); });
}
function init() { buildNodes(); buildOrgans(); buildLabels(); buildPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.sym = lerp(sm.sym, m.a, k); sm.para = lerp(sm.para, m.para, k); sm.heart = lerp(sm.heart, m.heart, k); sm.pupil = lerp(sm.pupil, m.pupil, k);
  sm.airway = lerp(sm.airway, m.airway, k); sm.gut = lerp(sm.gut, m.gut, k); sm.bladder = lerp(sm.bladder, m.bladder, k); sm.vessel = lerp(sm.vessel, m.vessel, k);
  Object.keys(marks).forEach((id) => { marks[id].g.style.display = marks[id].drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  acc.preS += dt * (2 + 7 * Math.max(sm.sym, sm.para)); while (acc.preS >= 1) { acc.preS--; const r = pick(ROWS), p = freeP(achPreSym); if (p) emit(p, 108, r.y - 6, 62, 0, r.y - 6); }
  achPreSym.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 220) kill(p); });
  acc.preP += dt * (2 + 8 * sm.para); while (acc.preP >= 1) { acc.preP--; const r = pick(ROWS), p = freeP(achPrePara); if (p) emit(p, 170, r.y + 10, 78, 0, r.y + 10); }
  achPrePara.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 612) kill(p); });
  acc.na += dt * (1 + 13 * sm.sym); while (acc.na >= 1) { acc.na--; const r = pick(ROWS), p = freeP(naPost); if (p) emit(p, 246, r.y - 8, 92, 0, r.y - 8); }
  naPost.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 784) kill(p); });
  acc.ach += dt * (1 + 12 * sm.para); while (acc.ach >= 1) { acc.ach--; const r = pick(ROWS), p = freeP(achPost); if (p) emit(p, 640, r.y + 10, 92, 0, r.y + 10); }
  achPost.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 784) kill(p); });
  if (pupilEl) pupilEl.setAttribute("r", f1(3.5 + 9 * sm.pupil));
  if (heartEl) { const s = 1 + 0.07 * Math.sin(tm / Math.max(90, 300 - 170 * sm.heart)) * (0.4 + sm.heart); heartEl.setAttribute("transform", "translate(820 197) scale(" + s.toFixed(3) + ") translate(-820 -197)"); }
  if (airwayEl) airwayEl.setAttribute("r", f1(4 + 6 * sm.airway));
  gutDots.forEach((d, i) => { const u = (tm / 1000 * (0.08 + 0.5 * sm.gut) + d.off) % 1; d.e.setAttribute("cx", f1(794 + u * 52)); d.e.setAttribute("cy", f1(290 + (i % 3) * 10 + Math.sin(u * 9 + i) * 3)); });
  if (bladderEl) { const s = 1 - 0.13 * sm.bladder; bladderEl.setAttribute("transform", "translate(820 365) scale(1 " + s.toFixed(3) + ") translate(-820 -365)"); }
  acc.drop += dt * sm.bladder * 3.2; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p && sm.bladder > 0.55) emit(p, 820 + rnd(-3, 3), 406, 0, 16, 0); }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 434) kill(p); });
  gg.heart.set(sm.heart, wordOf(sm.heart, 0.35, 0.65, ["slow", "steady", "fast"])); gg.pupil.set(sm.pupil, wordOf(sm.pupil, 0.35, 0.65, ["small", "midsize", "wide"]));
  gg.airway.set(sm.airway, wordOf(sm.airway, 0.35, 0.65, ["narrow", "normal", "wide"])); gg.gut.set(sm.gut, wordOf(sm.gut, 0.35, 0.65, ["slow", "steady", "active"]));
  gg.bladder.set(sm.bladder, wordOf(sm.bladder, 0.35, 0.65, ["held", "partly", "ready"])); gg.vessel.set(sm.vessel, wordOf(sm.vessel, 0.35, 0.65, ["relaxed", "steady", "tight"]));
}
run({ init, step });
