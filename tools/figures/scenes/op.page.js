/* Organophosphate scene: blocked AChE, acetylcholine build up, muscarinic and nicotinic receptors, patient signs and gauges. */
const layers = { syn: $("syn"), parts: $("parts"), fx: $("fx"), over: $("over"), panel: $("panel") };
/* ---- presynaptic terminal and vesicles ---- */
const term = cell(layers.syn, { cls: "pre", r: 54, nuc: 0.3, seed: 3, wob: 0.08 });
place(term, 200, 148, 0, 1);
const ves = [];
for (let i = 0; i < 8; i++) { const c = mk("circle", { class: "op-ves", r: 6 }, layers.syn); ves.push({ c, ph: i * 0.9 }); }
/* ---- AChE enzymes in the cleft, with a blocked cross ---- */
const enz = [[105, 262], [180, 282], [255, 258], [330, 282], [405, 258], [480, 280]].map(([x, y]) => {
  const g = mk("g", {}, layers.syn);
  mk("path", { class: "op-enz", d: "M0 -8L2.4 -2.4L8 -2L3.4 2L5.4 8L0 4.6L-5.4 8L-3.4 2L-8 -2L-2.4 -2.4Z" }, g);
  const xg = mk("g", { class: "op-enzx" }, g); mk("path", { d: "M-6 -6L6 6M6 -6L-6 6", fill: "none" }, xg);
  place(g, x, y, 0, 1); return { g, xg, x, y };
});
/* ---- receptors on the receiving cell (muscarinic left, nicotinic right) ---- */
const recM = [110, 150, 190, 230].map((x) => { const g = mk("g", {}, layers.syn);
  mk("path", { class: "op-recM", d: "M" + x + " 330L" + x + " 318M" + x + " 318L" + (x - 6) + " 308M" + x + " 318L" + (x + 6) + " 308" }, g);
  const cap = mk("circle", { class: "op-cap", cx: x, cy: 312, r: 5, opacity: "0" }, g); return { g, cap }; });
const recN = [360, 400, 440, 480].map((x) => { const g = mk("g", {}, layers.syn);
  mk("rect", { class: "op-recN", x: x - 7, y: 306, width: 14, height: 24, rx: 3 }, g); return { g }; });
mk("circle", { class: "op-opdrop", cx: 465, cy: 105, r: 9 }, layers.syn);
mk("path", { class: "op-opdrop", d: "M465 88C472 100 476 106 476 112A11 11 0 0 1 454 112C454 106 458 100 465 88Z" }, layers.syn);
/* ---- patient sign rows on the right ---- */
const rows = [
  ["Eye: small pupil", "mus", "Muscarinic: the pupil constricts (miosis) and vision blurs."],
  ["Mouth: drooling", "mus", "Muscarinic: saliva and tears increase (the S and L of SLUDGE)."],
  ["Gut: cramps, stool", "mus", "Muscarinic: gut cramps, urination and loose stool (the rest of SLUDGE)."],
  ["Airways: wheeze", "mus", "Muscarinic: airways narrow and fill with secretions (bronchospasm)."],
  ["Heart: slow pulse", "mus", "Muscarinic: the heart slows (bradycardia)."],
  ["Breathing effort", "bre", "Breathing fails from airway secretions and spasm plus weak breathing muscles."],
  ["Muscle: weak", "weak", "Nicotinic: skeletal muscle first twitches, then weakens and is paralysed."],
].map(([name, kind, tip], i) => {
  const y = 102 + i * 44, g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, layers.fx);
  mk("rect", { class: "op-bar-bg", x: 24, y: -1, width: 336, height: 34, rx: 8, transform: "translate(584 " + (y - 16) + ")" }, g);
  const dot = mk("circle", { cx: 622, cy: y, r: 7, class: kind === "weak" ? "op-bar weak" : kind === "bre" ? "op-bar" : "op-bar mus" }, g);
  const t = mk("text", { class: "op-rowlab", x: 640, y: y + 4 }, g); t.textContent = name;
  mk("rect", { class: "op-bar-bg", x: 800, y: y - 5, width: 124, height: 10, rx: 5 }, g);
  const bar = mk("rect", { class: kind === "weak" ? "op-bar weak" : kind === "bre" ? "op-bar" : "op-bar mus", x: 800, y: y - 5, width: 0, height: 10, rx: 5 }, g);
  return { g, dot, bar, kind, y };
});
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const ach = pool(36, () => mk("circle", { class: "sc-p p-ach", r: 3 }, layers.parts));
const opx = pool(14, () => mk("path", { class: "sc-p p-opx", d: "M0 -4L4 0L0 4L-4 0Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const acc = { ach: 0, op: 0 };
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The synapse and the patient";
  [["enz", "AChE blocked", "g-enz", "How much acetylcholinesterase is blocked by the organophosphate. An oxime can free it again."],
   ["ach", "Acetylcholine", "g-ach", "Acetylcholine in the cleft. It rises when the enzyme that breaks it down is blocked."],
   ["mus", "SLUDGE signs", "g-mus", "Muscarinic overdrive: drooling, tears, passing urine and stool, gut cramps, small pupils, wheeze and a slow heart. Atropine blocks this."],
   ["nic", "Nicotinic", "g-nic", "Nicotinic overdrive at muscle junctions: twitching first, then weakness. Atropine does not help here."],
   ["weak", "Weakness", "g-weak", "Muscle weakness and paralysis as nicotinic receptors are overwhelmed."],
   ["bre", "Breathing", "g-bad", "Breathing strain from secretions and narrowed airways plus weak breathing muscles."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  const atrP = pill(ox, "Atropine", 150, 314, 120, 398, "Atropine sits on muscarinic receptors and blocks them. SLUDGE signs ease, but the enzyme stays blocked and muscle stays weak.");
  atrP.setAttribute("id", "atr-pill");
  const oxP = pill(ox, "Oxime", 330, 278, 400, 398, "An oxime pulls the organophosphate off acetylcholinesterase, so the enzyme can break down acetylcholine again.");
  oxP.setAttribute("id", "ox-pill");
  pill(ox, "Nerve ending", 200, 104, 115, 90, "The nerve ending releases acetylcholine from small vesicles into the synaptic cleft.");
  pill(ox, "Organophosphate", 465, 105, 460, 90, "The organophosphate poison. It binds acetylcholinesterase and switches it off.");
  pill(ox, "Acetylcholine", 265, 262, 370, 205, "Acetylcholine carries the signal across the cleft. Normally an enzyme breaks it down at once; here it builds up.");
  pill(ox, "AChE enzyme", 350, 278, 465, 240, "Acetylcholinesterase (AChE) splits acetylcholine and ends the signal. Blocked by the poison, shown with a cross; an oxime can free it.");
  pill(ox, "Muscarinic receptor", 150, 314, 150, 365, "Muscarinic receptors drive glands, gut, pupil, airways and heart rate: the SLUDGE signs. Atropine blocks them.");
  pill(ox, "Nicotinic receptor", 405, 314, 400, 365, "Nicotinic receptors drive skeletal muscle. Too much acetylcholine makes muscle twitch, then fail.");
}
const sm = { E: 0.5, Ach: 0.5, Mus: 0.4, Nic: 0.5, Weak: 0.2, Fasc: 0.2, Breath: 0.3, atr: 0, ox: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.E = lerp(sm.E, m.E, k2); sm.Ach = lerp(sm.Ach, m.Ach, k2); sm.Mus = lerp(sm.Mus, m.Mus, k2); sm.Nic = lerp(sm.Nic, m.Nic, k2);
  sm.Weak = lerp(sm.Weak, m.Weak, k2); sm.Fasc = lerp(sm.Fasc, m.Fasc, k2); sm.Breath = lerp(sm.Breath, m.Breath, k1); sm.atr = lerp(sm.atr, m.atr, k1); sm.ox = lerp(sm.ox, m.ox, k1);
  place(term, 200 + Math.sin(tm / 1600) * 2, 148 + Math.cos(tm / 1900) * 2, 0, 1);
  ves.forEach((v, i) => { const u = (tm / 2400 + v.ph) % 1; const x = 178 + (i % 4) * 15 + Math.sin(tm / 500 + i) * 2, y = 120 + u * 62; v.c.setAttribute("cx", f1(x)); v.c.setAttribute("cy", f1(y)); v.c.setAttribute("opacity", (0.35 + 0.65 * (1 - u)).toFixed(2)); });
  enz.forEach((e, i) => { e.xg.setAttribute("opacity", sm.E.toFixed(2)); const s = 1 + 0.12 * (1 - sm.E) * Math.sin(tm / 280 + i); place(e.g, e.x, e.y, Math.sin(tm / 900 + i) * 8, s); });
  recM.forEach((r, i) => { r.g.style.opacity = (0.45 + 0.55 * sm.Mus).toFixed(2); r.cap.setAttribute("opacity", sm.atr.toFixed(2)); });
  recN.forEach((r, i) => { const j = sm.Fasc * Math.sin(tm / 90 + i * 1.7) * 2.2; r.g.setAttribute("transform", "translate(" + f1(j) + " 0)"); r.g.style.opacity = (0.45 + 0.55 * sm.Nic).toFixed(2); });
  /* acetylcholine dots fill the cleft in proportion to the build up */
  const want = Math.round(sm.Ach * ach.length);
  ach.forEach((p, i) => { const on = i < want;
    if (on && !p.on) emit(p, rnd(70, 500), rnd(238, 298), rnd(-14, 14), rnd(-8, 8), 0);
    if (!on && p.on) kill(p);
    if (!p.on) return;
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 62 || p.x > 518) p.vx *= -1; if (p.y < 236 || p.y > 300) p.vy *= -1; p.x = clamp(p.x, 62, 518); p.y = clamp(p.y, 236, 300);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* organophosphate diamonds drift from the drop to an enzyme */
  acc.op += dt * (0.4 + sm.E * 3) * (sm.ox ? 0.3 : 1);
  while (acc.op >= 1) { acc.op--; const p = free(opx); if (p) emit(p, 465 + rnd(-6, 6), 118, 0, 0, Math.floor(Math.random() * enz.length)); }
  opx.forEach((p) => { if (!p.on) return; const e = enz[p.k], dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    p.x += (dx / d) * 42 * dt; p.y += (dy / d) * 42 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (d < 12 || sm.ox > 0.7) kill(p); });
  /* patient rows */
  rows.forEach((r) => { const v = r.kind === "mus" ? sm.Mus : r.kind === "bre" ? sm.Breath : sm.Weak;
    r.bar.setAttribute("width", f1(124 * clamp(v)));
    const shake = r.kind === "weak" ? sm.Fasc * Math.sin(tm / 80) * 2 : 0;
    r.dot.setAttribute("transform", "translate(" + f1(shake) + " 0)"); r.dot.setAttribute("r", f1(r.kind === "mus" && r.y === 102 ? 7 - 3.5 * sm.Mus : 7)); });
  $("atr-pill").style.opacity = sm.atr.toFixed(2); $("ox-pill").style.opacity = sm.ox.toFixed(2);
  gg.enz.set(sm.E, wordOf(sm.E, 0.3, 0.65, ["little", "partly", "mostly"]));
  gg.ach.set(sm.Ach, wordOf(sm.Ach, 0.35, 0.65, ["normal", "raised", "very high"]));
  gg.mus.set(sm.Mus, wordOf(sm.Mus, 0.3, 0.6, ["mild", "moderate", "marked"]));
  gg.nic.set(sm.Nic, wordOf(sm.Nic, 0.35, 0.65, ["normal", "raised", "very high"]));
  gg.weak.set(sm.Weak, wordOf(sm.Weak, 0.25, 0.55, ["none", "some", "paralysed"]));
  gg.bre.set(sm.Breath, wordOf(sm.Breath, 0.3, 0.6, ["steady", "strained", "failing"]));
}
run({ init, step });
