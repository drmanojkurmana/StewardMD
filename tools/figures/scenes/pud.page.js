/* Peptic ulcer scene: mucus defence, H. pylori, NSAID effect, acid attack, crater, bleeding and perforation. */
const L = { wall: $("wallg"), vessel: $("vesselg"), crater: $("craterg"), bac: $("bac"), pari: $("paric"), nsaid: $("nsaidg"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { Hp: 0.5, Ns: 0.5, Ac: 0.6, Def: 0.4, U: 0.4, Bleed: 0, Perf: 0, Comp: 0, cx: 300, acidSupp: 0, erad: 0, stopN: 0 };
const acc = { acid: 0, bic: 0, blood: 0, leak: 0, abx: 0 };
let wallEls = {}, craterEls = {}, gg = {}, treatPills = [];
const rbcs = [], bacs = [], nsaids = [], paris = [];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const acidP = pool(30, () => mk("circle", { class: "sc-p p-acid", r: 2.5 }, L.parts));
const pepP = pool(16, () => mk("path", { class: "sc-p p-pep", d: "M0 -3L3 2L-3 2Z" }, L.parts));
const bicP = pool(22, () => mk("circle", { class: "sc-p p-bic", r: 2 }, L.parts));
const bloodP = pool(26, () => mk("circle", { class: "sc-p p-blood", r: 2.6 }, L.parts));
const leakP = pool(20, () => mk("circle", { class: "sc-p p-leak", r: 2.4 }, L.parts));
const abxP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
function initWall() {
  wallEls.mucosa = mk("rect", { class: "pud-mucosa", x: 14, y: 232, width: 932, height: 76 }, L.wall);
  wallEls.sub = mk("rect", { class: "pud-sub", x: 14, y: 308, width: 932, height: 72 }, L.wall);
  wallEls.muscle = mk("rect", { class: "pud-muscle", x: 14, y: 380, width: 932, height: 60 }, L.wall);
  for (let i = 0; i < 9; i++) { const x = 70 + i * 105; mk("path", { class: "pud-pit", d: "M" + x + " 236C" + (x + 8) + " 258 " + (x - 8) + " 278 " + (x + 2) + " 302" }, L.wall); }
  wallEls.mucus = mk("rect", { class: "pud-mucus", x: 14, y: 214, width: 932, height: 18, rx: 8 }, L.wall);
  wallEls.vessel = mk("rect", { class: "pud-vessel", x: 14, y: 348, width: 932, height: 26, rx: 13 }, L.vessel);
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(20, 940), y: rnd(-5, 5), v: rnd(0.8, 1.2), rot: rnd(-14, 14) }); }
  craterEls.shape = mk("path", { class: "pud-crater" }, L.crater);
  craterEls.rimL = mk("path", { class: "pud-rim" }, L.crater);
  craterEls.rimR = mk("path", { class: "pud-rim" }, L.crater);
  craterEls.base = mk("ellipse", { class: "pud-rim" }, L.crater);
}
function initActors() {
  for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-hp" }, L.bac); mk("ellipse", { class: "cl-b", rx: 6, ry: 2.8 }, g); mk("path", { class: "fibrin", d: "M6 0C10 -3 12 -6 15 -7" }, g); bacs.push({ g, x: 60 + (i * 49) % 850, y: 0, ph: i * 1.7, s: 0 }); }
  [[180, 272], [255, 282], [690, 272], [765, 282]].forEach(([x, y], i) => { const g = cell(L.pari, { cls: "pari", r: 13, nuc: 0.34, seed: i + 4, wob: 0.12 }); paris.push({ g, x, y }); });
  for (let i = 0; i < 5; i++) { const g = mk("g", {}, L.nsaid); mk("rect", { class: "pud-nsaidtab", x: -9, y: -4, width: 18, height: 8, rx: 4 }, g); mk("rect", { class: "pud-nsaidhalf", x: 0, y: -4, width: 9, height: 8, rx: 4 }, g); nsaids.push({ g, x: 540 + i * 62, y: 118 + (i % 2) * 34, ph: i * 1.3 }); }
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["hp", "H. pylori", "g-bac", "Helicobacter pylori living in the mucus layer. It inflames the mucosa and disturbs acid control."], ["ns", "NSAID", "g-nsaid", "NSAID effect: blocking prostaglandins thins mucus, cuts bicarbonate and slows repair."], ["ac", "Acid", "g-acid", "Acid and pepsin from parietal cells. Harmless on intact defence, damaging once defence is breached."], ["def", "Defence", "g-def", "Mucus and bicarbonate layer, mucosal blood flow and repair. Higher is better protected."], ["ul", "Ulcer", "g-ulcer", "Depth of the crater eroded through the mucosa."], ["co", "Complication", "g-bad", "Bleeding from a vessel in the crater base, or perforation through the whole wall."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Acid and pepsin", 170, 128, 150, 96, "Acid and pepsin in the lumen. They digest the crater deeper once the mucus defence is breached.");
  pill(o, "H. pylori", 360, 216, 335, 96, "Helicobacter pylori: curved bacteria living in the mucus. They inflame the mucosa and weaken its defence.");
  pill(o, "NSAID", 610, 118, 565, 96, "An NSAID taken by mouth. It blocks prostaglandins, so mucus, bicarbonate and repair all fall.");
  pill(o, "Mucus layer", 800, 220, 775, 96, "The mucus and bicarbonate layer. It holds acid away from the surface cells and is the first defence to fail.");
  pill(o, "Parietal cell", 180, 272, 175, 410, "Parietal cell in a gastric gland. It secretes acid into the lumen. Acid suppression acts here.");
  craterEls.pill = pill(o, "Ulcer crater", 300, 292, 390, 410, "The ulcer crater: a break eroded through the mucosa by acid and pepsin. Shallow craters heal; deep ones reach vessels or the outer wall.");
  pill(o, "Blood vessel", 640, 361, 625, 410, "A blood vessel under the mucosa. A deep crater can erode into it and bleed into the lumen.");
  craterEls.perfPill = pill(o, "Perforation", 465, 420, 830, 152, "Perforation: the crater passes through the whole wall, muscle and outer coat, so lumen contents leak out."); craterEls.perfPill.style.opacity = 0;
  const tp1 = pill(o, "Acid blocker", 205, 258, 470, 152, "Acid suppression: parietal cells make far less acid, so pepsin quiets and the crater can heal."); tp1.setAttribute("id", "tp-acid"); tp1.style.opacity = 0;
  const tp2 = pill(o, "Eradication", 350, 210, 470, 152, "Eradication therapy: antibiotics clear Helicobacter pylori, so inflammation settles and ulcers are less likely to return."); tp2.setAttribute("id", "tp-erad"); tp2.style.opacity = 0;
  const tp3 = pill(o, "NSAID stopped", 610, 132, 470, 152, "Stopping the NSAID: prostaglandins return, mucus and bicarbonate recover, and repair restarts."); tp3.setAttribute("id", "tp-nsaid"); tp3.style.opacity = 0;
  treatPills = [tp1, tp2, tp3];
}
function init() { initWall(); initActors(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Hp = lerp(sm.Hp, m.Hp, k2); sm.Ns = lerp(sm.Ns, m.Ns, k2); sm.Ac = lerp(sm.Ac, m.Ac, k1); sm.Def = lerp(sm.Def, m.Def, k2); sm.U = lerp(sm.U, m.U, k2); sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.Perf = lerp(sm.Perf, m.Perf, k2); sm.Comp = lerp(sm.Comp, m.Comp, k2); sm.cx = lerp(sm.cx, m.cx, k2); sm.acidSupp = lerp(sm.acidSupp, m.acidSupp, k1); sm.erad = lerp(sm.erad, m.erad, k1); sm.stopN = lerp(sm.stopN, m.stopN, k1);
  const mucT = 6 + 20 * sm.Def, mucY = 232 - mucT;
  wallEls.mucus.setAttribute("y", f1(mucY)); wallEls.mucus.setAttribute("height", f1(mucT)); wallEls.mucus.setAttribute("opacity", (0.35 + 0.6 * sm.Def).toFixed(2));
  const cw = 52 + 58 * sm.U, bot = 238 + 148 * sm.U + 34 * sm.Perf, cx = sm.cx;
  craterEls.shape.setAttribute("d", "M" + f1(cx - cw) + " " + f1(mucY + 2) + "C" + f1(cx - cw * 0.7) + " " + f1(bot - 40) + " " + f1(cx - 16) + " " + f1(bot - 8) + " " + f1(cx) + " " + f1(bot) + "C" + f1(cx + 16) + " " + f1(bot - 8) + " " + f1(cx + cw * 0.7) + " " + f1(bot - 40) + " " + f1(cx + cw) + " " + f1(mucY + 2) + "Z");
  craterEls.rimL.setAttribute("d", "M" + f1(cx - cw - 8) + " " + f1(mucY + 4) + "L" + f1(cx - cw + 6) + " " + f1(mucY + 2));
  craterEls.rimR.setAttribute("d", "M" + f1(cx + cw - 6) + " " + f1(mucY + 2) + "L" + f1(cx + cw + 8) + " " + f1(mucY + 4));
  craterEls.base.setAttribute("cx", f1(cx)); craterEls.base.setAttribute("cy", f1(bot - 3)); craterEls.base.setAttribute("rx", f1(14 + 16 * sm.U)); craterEls.base.setAttribute("ry", "4"); craterEls.base.setAttribute("opacity", (0.25 + 0.6 * sm.U).toFixed(2));
  bacs.forEach((b, i) => { const near = 0.55 + 0.45 * Math.exp(-Math.pow((b.x - cx) / 190, 2)); b.s = lerp(b.s, sm.Hp * near, Math.min(1, dt * 1.4)); place(b.g, b.x + Math.sin(tm / 700 + b.ph) * 5, mucY - 4 + Math.sin(tm / 520 + b.ph) * 2.5, Math.sin(tm / 800 + b.ph) * 22, Math.max(0.01, b.s)); b.g.style.opacity = b.s > 0.05 ? 1 : 0; });
  paris.forEach((p, i) => place(p.g, p.x, p.y + Math.sin(tm / 900 + i) * 1.5, 0, 1 - 0.25 * sm.acidSupp));
  nsaids.forEach((n, i) => { place(n.g, n.x + Math.sin(tm / 800 + n.ph) * 6, n.y + Math.cos(tm / 650 + n.ph) * 4, Math.sin(tm / 900 + n.ph) * 14, 1); n.g.style.opacity = clamp(sm.Ns * 1.4).toFixed(2); });
  rbcs.forEach((r) => { r.x += r.v * (46 + 30 * sm.Def) * dt; if (r.x > 952) { r.x = 18; r.y = rnd(-5, 5); } place(r.g, r.x, 361 + r.y, r.rot, 1); r.g.style.opacity = (Math.abs(r.x - cx) < cw * 0.7 && bot > 344 ? 0.25 : 1); });
  acc.acid += dt * sm.Ac * 13; while (acc.acid >= 1) { acc.acid--; const two = Math.random() < 0.35, p = free(two ? pepP : acidP); if (p) emit(p, rnd(50, 930), rnd(78, 150), rnd(-5, 5), rnd(24, 40), 0); }
  [acidP, pepP].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (cx - p.x) * dt * 0.12 * sm.U; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > bot - 4 && Math.abs(p.x - cx) < cw) kill(p); else if (p.y > mucY - 2 && Math.abs(p.x - cx) >= cw) kill(p); }));
  acc.bic += dt * sm.Def * 8; while (acc.bic >= 1) { acc.bic--; const p = free(bicP); if (p) emit(p, rnd(40, 940), 230, rnd(-3, 3), -rnd(10, 18), 0); }
  bicP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.blood += dt * sm.Bleed * 11; while (acc.blood >= 1) { acc.blood--; const p = free(bloodP); if (p) emit(p, cx + rnd(-14, 14), Math.min(bot, 352), rnd(-8, 8), -rnd(28, 48), 0); }
  bloodP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y < 92) kill(p); });
  acc.leak += dt * sm.Perf * 9; while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, cx + rnd(-10, 10), Math.min(432, bot + 6), rnd(-6, 6), rnd(20, 34), 0); }
  leakP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y > 436) kill(p); });
  acc.abx += dt * sm.erad * 3; while (acc.abx >= 1) { acc.abx--; const p = free(abxP); if (p) emit(p, rnd(60, 180), rnd(110, 160), 30, 18, 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3) / 1.4).toFixed(2)); if (p.t > 4.4) kill(p); });
  if (craterEls.pill) { const lp = craterEls.pill.children[0], dt2 = craterEls.pill.children[1]; lp.setAttribute("d", "M" + f1(cx) + " " + f1(bot - 8) + "L390 418"); dt2.setAttribute("cx", f1(cx)); dt2.setAttribute("cy", f1(bot - 8)); }
  if (craterEls.perfPill) { const lp2 = craterEls.perfPill.children[0], dt3 = craterEls.perfPill.children[1]; lp2.setAttribute("d", "M" + f1(cx) + " " + f1(Math.min(434, bot + 10)) + "L830 160"); dt3.setAttribute("cx", f1(cx)); dt3.setAttribute("cy", f1(Math.min(434, bot + 10))); craterEls.perfPill.style.opacity = clamp(sm.Perf * 1.6).toFixed(2); }
  $("tp-acid").style.opacity = sm.acidSupp.toFixed(2); $("tp-erad").style.opacity = sm.erad.toFixed(2); $("tp-nsaid").style.opacity = sm.stopN.toFixed(2);
  gg.hp.set(sm.Hp, wordOf(sm.Hp, 0.2, 0.55, ["cleared", "present", "heavy"])); gg.ns.set(sm.Ns, wordOf(sm.Ns, 0.2, 0.55, ["none", "some", "strong"])); gg.ac.set(sm.Ac, wordOf(sm.Ac, 0.3, 0.62, ["low", "normal", "high"]));
  gg.def.set(sm.Def, wordOf(sm.Def, 0.35, 0.62, ["weak", "thinned", "intact"])); gg.ul.set(sm.U, wordOf(sm.U, 0.3, 0.62, ["healing", "open", "deep"])); gg.co.set(sm.Comp, wordOf(sm.Comp, 0.22, 0.5, ["none", "at risk", "present"]));
}
run({ init, step });
