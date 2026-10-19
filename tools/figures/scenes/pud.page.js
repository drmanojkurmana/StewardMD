/* Peptic ulcer scene: stomach site, magnified wall, acid attack, H. pylori, NSAID, crater, bleeding and perforation. */
const L = { wall: $("wallg"), vessel: $("vesselg"), tint: $("tint"), stom: $("stomSlot"), crater: $("craterg"), site: $("siteg"), bac: $("bac"), pari: $("paric"), nsaid: $("nsaidg"), block: $("blockg"), flow: $("acidflow"), bracket: $("bracket"), parts: $("parts"), over: $("over"), panel: $("panel") };
const MT = 178, SUBT = 262, MUST = 326, SEROSA = 382;
const sm = { Hp: 0.5, Ns: 0.5, Ac: 0.6, Def: 0.4, U: 0.4, Bleed: 0, Perf: 0, Comp: 0, cx: 560, acidSupp: 0, erad: 0, stopN: 0, sx: 189, sy: 202 };
const acc = { acid: 0, bic: 0, blood: 0, leak: 0, abx: 0 };
let wallEls = {}, craterEls = {}, mucusPill = null, gg = {};
let stomO = null, capEl = null, capKey = "";
let trFlow = null, siteAntrum = [189, 202], siteOut = [185, 342];
const rbcs = [], bacs = [], nsaids = [], paris = [], docks = [], blockers = [], flowDots = [];
let siteRing = null, sitePulse = null;
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
  wallEls.mucosa = mk("rect", { class: "pud-mucosa", x: 336, y: MT, width: 610, height: SUBT - MT }, L.wall);
  wallEls.sub = mk("rect", { class: "pud-sub", x: 336, y: SUBT, width: 610, height: MUST - SUBT }, L.wall);
  wallEls.muscle = mk("rect", { class: "pud-muscle", x: 336, y: MUST, width: 610, height: SEROSA - MUST }, L.wall);
  for (let i = 0; i < 6; i++) { const x = 380 + i * 105; mk("path", { class: "pud-pit", d: "M" + x + " 182C" + (x + 8) + " 204 " + (x - 8) + " 224 " + (x + 2) + " 248" }, L.wall); }
  wallEls.mucus = mk("rect", { class: "pud-mucus", x: 336, y: 158, width: 610, height: 20, rx: 8 }, L.wall);
  wallEls.vessel = mk("rect", { class: "pud-vessel", x: 336, y: 296, width: 610, height: 24, rx: 12 }, L.vessel);
  for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.6 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(340, 942), y: rnd(-4, 4), v: rnd(0.8, 1.2), rot: rnd(-14, 14) }); }
  craterEls.shape = mk("path", { class: "pud-crater" }, L.crater);
  craterEls.rimL = mk("path", { class: "pud-rim" }, L.crater);
  craterEls.rimR = mk("path", { class: "pud-rim" }, L.crater);
  craterEls.base = mk("ellipse", { class: "pud-rim" }, L.crater);
}
function initOrgans() {
  stomO = organ(L.stom, "stomach", 185, 245, 215, {});
  const P = stomO.ports;
  siteAntrum = P.antrum.slice(); siteOut = P.out.slice();
  L.flow.setAttribute("d", "M" + f1(P.pylorus[0]) + " " + f1(P.pylorus[1]) + " C260 195 300 155 340 118");
  L.bracket.setAttribute("d", "M" + f1(stomO.x + 99) + " 172 L336 148 M" + f1(stomO.x + 99) + " 312 L336 366");
  trFlow = track([P.pylorus, [260, 195], [305, 152], [340, 118]]);
  for (let i = 0; i < 6; i++) flowDots.push({ e: mk("circle", { class: "sc-p p-acid", r: 2.6 }, L.parts), u: i / 6 });
  siteRing = mk("circle", { class: "pud-site", r: 10.5 }, L.site);
  sitePulse = mk("circle", { class: "pud-site", r: 14 }, L.site);
  sitePulse.setAttribute("opacity", "0.45");
}
function initActors() {
  for (let i = 0; i < 14; i++) { const g = mk("g", { class: "cl cl-hp" }, L.bac); mk("ellipse", { class: "cl-b", rx: 6, ry: 2.8 }, g); mk("path", { class: "fibrin", d: "M6 0C10 -3 12 -6 15 -7" }, g); bacs.push({ g, x: 360 + i * 40, y: 0, ph: i * 1.7, s: 0 }); }
  [[375, 216], [420, 228], [895, 216]].forEach(([x, y], i) => {
    const g = cell(L.pari, { cls: "pari", r: 13, nuc: 0.34, seed: i + 4, wob: 0.12 });
    const nub = mk("circle", { class: "pud-nub", r: 2.6, cx: 0, cy: -15 }, g);
    const dock = { x, y: y - 15, nub, taken: null };
    docks.push(dock); paris.push({ g, x, y, dock });
  });
  for (let i = 0; i < 3; i++) { const e = mk("circle", { class: "pud-block", r: 6 }, L.block); e.setAttribute("opacity", "0"); blockers.push({ e, st: 0, x: 0, y: 0, dock: null }); }
  for (let i = 0; i < 4; i++) { const g = mk("g", {}, L.nsaid); mk("rect", { class: "pud-nsaidtab", x: -9, y: -4, width: 18, height: 8, rx: 4 }, g); mk("rect", { class: "pud-nsaidhalf", x: 0, y: -4, width: 9, height: 8, rx: 4 }, g); nsaids.push({ g, x: 600 + i * 70, y: 108 + (i % 2) * 30, ph: i * 1.3 }); }
}
function capText(d, uw, cw2) {
  let s;
  if (d === 1) s = "Acid blocker plugs the pumps on parietal cells. Acid falls and the crater " + (uw === "healing" ? "heals." : "shrinks.");
  else if (d === 2) s = "Eradication clears H. pylori germs. Swelling settles and the ulcer " + (uw === "healing" ? "heals." : "shrinks.");
  else if (d === 3) s = "NSAID stopped. The mucus shield grows back and the ulcer " + (uw === "healing" ? "heals." : "shrinks.");
  else s = "No treatment. Acid keeps digging, so the crater stays " + uw + ".";
  if (cw2 === "present") s += " Bleeding and leak threaten.";
  else if (cw2 === "at risk" && d !== 0) s += " Bleeding or leak can still break through.";
  return s;
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["hp", "H. pylori", "g-bac", "H. pylori germs living in the mucus layer. They inflame the wall and weaken its shield."], ["ns", "NSAID", "g-nsaid", "NSAID effect: blocking repair signals thins mucus, cuts bicarbonate and slows healing."], ["ac", "Acid", "g-acid", "Acid and pepsin from parietal cells. Harmless on an intact shield, harmful once the shield fails."], ["def", "Defence", "g-def", "Mucus and bicarbonate shield, blood flow and repair. Higher means better protected."], ["ul", "Ulcer", "g-ulcer", "Depth of the crater eaten through the lining."], ["co", "Complication", "g-bad", "Bleeding from a vessel in the crater base, or perforation through the whole wall."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Stomach", 243, 205, 150, 100, "The stomach. Acid and food mix here. The dashed bracket marks the patch of wall magnified on the right.");
  pill(o, "Acid", 440, 110, 430, 64, "Acid and pepsin in the lumen. Made by pumps in parietal cells. Harmless on a shielded wall, harmful once the shield fails.");
  pill(o, "H. pylori", 600, 166, 605, 100, "H. pylori germs living in the mucus. They inflame the wall and weaken its shield.");
  pill(o, "NSAID tablet", 790, 118, 800, 100, "An NSAID tablet. It blocks the signals that keep mucus, bicarbonate and repair going.");
  mucusPill = pill(o, "Mucus defence", 395, 158, 395, 400, "The mucus and bicarbonate shield. It holds acid away from the surface. Thin here means weak.");
  craterEls.pill = pill(o, "Ulcer", 560, 280, 560, 400, "The ulcer crater. Acid and pepsin dig it through the lining. Shallow craters heal, deep ones threaten vessels.");
  pill(o, "Blood vessel", 745, 309, 745, 400, "A small vessel feeding the wall. A deep crater can open it and bleed into the lumen.");
  craterEls.perfPill = pill(o, "Perforation", 640, 390, 860, 352, "Perforation. The crater has passed through the whole wall, so gut contents leak out."); craterEls.perfPill.style.opacity = 0;
  capEl = mk("text", { class: "pud-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, "open", "none");
}
function init() { initWall(); initOrgans(); initActors(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Hp = lerp(sm.Hp, m.Hp, k2); sm.Ns = lerp(sm.Ns, m.Ns, k2); sm.Ac = lerp(sm.Ac, m.Ac, k1); sm.Def = lerp(sm.Def, m.Def, k2); sm.U = lerp(sm.U, m.U, k2); sm.Bleed = lerp(sm.Bleed, m.Bleed, k2); sm.Perf = lerp(sm.Perf, m.Perf, k2); sm.Comp = lerp(sm.Comp, m.Comp, k2); sm.cx = lerp(sm.cx, m.cx, k2); sm.acidSupp = lerp(sm.acidSupp, m.acidSupp, k1); sm.erad = lerp(sm.erad, m.erad, k1); sm.stopN = lerp(sm.stopN, m.stopN, k1);
  const tgt = level === 1 ? siteOut : siteAntrum;
  sm.sx = lerp(sm.sx, tgt[0], k2); sm.sy = lerp(sm.sy, tgt[1], k2);
  const mucT = 8 + 24 * sm.Def, mucY = MT - mucT;
  wallEls.mucus.setAttribute("y", f1(mucY)); wallEls.mucus.setAttribute("height", f1(mucT)); wallEls.mucus.setAttribute("opacity", (0.35 + 0.6 * sm.Def).toFixed(2));
  const vh = 20 + 8 * sm.Def;
  wallEls.vessel.setAttribute("height", f1(vh));
  const cw = 46 + 64 * sm.U, bot = 196 + 150 * sm.U + 40 * sm.Perf, cx = sm.cx;
  craterEls.shape.setAttribute("d", "M" + f1(cx - cw) + " " + f1(mucY + 2) + "C" + f1(cx - cw * 0.7) + " " + f1(bot - 40) + " " + f1(cx - 16) + " " + f1(bot - 8) + " " + f1(cx) + " " + f1(bot) + "C" + f1(cx + 16) + " " + f1(bot - 8) + " " + f1(cx + cw * 0.7) + " " + f1(bot - 40) + " " + f1(cx + cw) + " " + f1(mucY + 2) + "Z");
  craterEls.rimL.setAttribute("d", "M" + f1(cx - cw - 8) + " " + f1(mucY + 4) + "L" + f1(cx - cw + 6) + " " + f1(mucY + 2));
  craterEls.rimR.setAttribute("d", "M" + f1(cx + cw - 6) + " " + f1(mucY + 2) + "L" + f1(cx + cw + 8) + " " + f1(mucY + 4));
  craterEls.base.setAttribute("cx", f1(cx)); craterEls.base.setAttribute("cy", f1(bot - 3)); craterEls.base.setAttribute("rx", f1(12 + 15 * sm.U)); craterEls.base.setAttribute("ry", "4"); craterEls.base.setAttribute("opacity", (0.25 + 0.6 * sm.U).toFixed(2));
  L.tint.setAttribute("cx", f1(cx)); L.tint.setAttribute("cy", f1(mucY + 58)); L.tint.setAttribute("rx", f1(110 + 40 * sm.U));
  L.tint.setAttribute("opacity", clamp(sm.Hp * 0.3 + sm.Ns * 0.25 + sm.Ac * 0.35).toFixed(2));
  const ringR = level === 2 ? 14 : 10.5;
  siteRing.setAttribute("cx", f1(sm.sx)); siteRing.setAttribute("cy", f1(sm.sy)); siteRing.setAttribute("r", f1(ringR));
  sitePulse.setAttribute("cx", f1(sm.sx)); sitePulse.setAttribute("cy", f1(sm.sy)); sitePulse.setAttribute("r", f1(ringR + 4 + 2 * Math.sin(tm / 300)));
  flowDots.forEach((fd, i) => { fd.u = (fd.u + dt * (0.22 + 0.3 * sm.Ac)) % 1; const q = trFlow.at(fd.u); fd.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); fd.e.setAttribute("opacity", clamp(sm.Ac * 1.6).toFixed(2)); });
  bacs.forEach((b, i) => { const near = 0.55 + 0.45 * Math.exp(-Math.pow((b.x - cx) / 200, 2)); b.s = lerp(b.s, sm.Hp * near, Math.min(1, dt * 1.4)); place(b.g, b.x + Math.sin(tm / 700 + b.ph) * 5, mucY - 6 + Math.sin(tm / 520 + b.ph) * 2.5, Math.sin(tm / 800 + b.ph) * 22, Math.max(0.01, b.s)); b.g.style.opacity = b.s > 0.05 ? 1 : 0; });
  paris.forEach((p) => { place(p.g, p.x, p.y + Math.sin(tm / 900 + p.x) * 1.5, 0, 1 - 0.28 * sm.acidSupp); p.g.style.opacity = (1 - 0.35 * sm.acidSupp).toFixed(2); });
  blockers.forEach((b) => {
    if (b.st === 0 && sm.acidSupp > 0.5) { const d = docks.find((dd) => !dd.taken); if (d) { d.taken = b; b.dock = d; b.st = 1; b.x = rnd(380, 900); b.y = 72; b.e.setAttribute("opacity", "1"); } }
    else if (b.st === 1) { b.x = lerp(b.x, b.dock.x, Math.min(1, dt * 2.2)); b.y = lerp(b.y, b.dock.y, Math.min(1, dt * 2.2)); b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); if (Math.hypot(b.dock.x - b.x, b.dock.y - b.y) < 6) b.st = 2; if (sm.acidSupp < 0.5) { b.st = 3; } }
    else if (b.st === 2) { b.e.setAttribute("transform", "translate(" + f1(b.dock.x + Math.sin(tm / 500) * 1.5) + " " + f1(b.dock.y) + ")"); if (sm.acidSupp < 0.5) b.st = 3; }
    else if (b.st === 3) { b.y -= 30 * dt; b.e.setAttribute("transform", "translate(" + f1(b.x) + " " + f1(b.y) + ")"); const op = +(b.e.getAttribute("opacity") || 1) - dt * 1.2; b.e.setAttribute("opacity", op.toFixed(2)); if (op <= 0) { b.st = 0; if (b.dock) { b.dock.taken = null; b.dock = null; } } }
  });
  nsaids.forEach((n) => { const rise = -70 * sm.stopN; place(n.g, n.x + Math.sin(tm / 800 + n.ph) * 6, n.y + Math.cos(tm / 650 + n.ph) * 4 + rise, Math.sin(tm / 900 + n.ph) * 14, 1); n.g.style.opacity = clamp(sm.Ns * 1.5).toFixed(2); });
  rbcs.forEach((r) => { r.x += r.v * (40 + 34 * sm.Def) * dt; if (r.x > 948) { r.x = 340; r.y = rnd(-4, 4); } place(r.g, r.x, 296 + vh / 2 + r.y * vh / 24, r.rot, 1); r.g.style.opacity = (Math.abs(r.x - cx) < cw * 0.7 && bot > 292 ? 0.25 : 1); });
  acc.acid += dt * (0.4 + 10.5 * sm.Ac); while (acc.acid >= 1) { acc.acid--; const two = Math.random() < 0.35, p = free(two ? pepP : acidP); if (p) emit(p, rnd(360, 920), rnd(72, 140), rnd(-5, 5), rnd(24, 40), 0); }
  [acidP, pepP].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt + (cx - p.x) * dt * 0.12 * sm.U; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > bot - 4 && Math.abs(p.x - cx) < cw) kill(p); else if (p.y > mucY - 2 && Math.abs(p.x - cx) >= cw) kill(p); }));
  acc.bic += dt * (2 + 8 * sm.Def); while (acc.bic >= 1) { acc.bic--; const p = free(bicP); if (p) emit(p, rnd(360, 940), MT - 2, rnd(-3, 3), -rnd(10, 18), 0); }
  bicP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  acc.blood += dt * sm.Bleed * 11; while (acc.blood >= 1) { acc.blood--; const p = free(bloodP); if (p) emit(p, cx + rnd(-14, 14), Math.min(bot, 312), rnd(-8, 8), -rnd(28, 48), 0); }
  bloodP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y < 92) kill(p); });
  acc.leak += dt * sm.Perf * 9; while (acc.leak >= 1) { acc.leak--; const p = free(leakP); if (p) emit(p, cx + rnd(-10, 10), Math.min(430, bot + 6), rnd(-6, 6), rnd(20, 34), 0); }
  leakP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.4).toFixed(2)); if (p.t > 1.4 || p.y > 434) kill(p); });
  acc.abx += dt * sm.erad * 3.5; while (acc.abx >= 1) { acc.abx--; const p = free(abxP); if (p) emit(p, rnd(360, 480), rnd(90, 130), rnd(34, 46), rnd(22, 30), 0); }
  abxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (p.y > mucY - 4 || p.t > 5) kill(p); });
  if (craterEls.pill) { const lp = craterEls.pill.children[0], dd = craterEls.pill.children[1]; lp.setAttribute("d", "M" + f1(cx) + " " + f1(bot - 6) + "L560 408"); dd.setAttribute("cx", f1(cx)); dd.setAttribute("cy", f1(bot - 6)); }
  if (mucusPill) { const lp = mucusPill.children[0], dd = mucusPill.children[1]; lp.setAttribute("d", "M395 " + f1(mucY + 4) + "L395 408"); dd.setAttribute("cx", "395"); dd.setAttribute("cy", f1(mucY + 4)); }
  if (craterEls.perfPill) { const lp2 = craterEls.perfPill.children[0], dd2 = craterEls.perfPill.children[1]; lp2.setAttribute("d", "M" + f1(cx) + " " + f1(Math.min(430, bot + 8)) + "L860 360"); dd2.setAttribute("cx", f1(cx)); dd2.setAttribute("cy", f1(Math.min(430, bot + 8))); craterEls.perfPill.style.opacity = clamp(sm.Perf * 1.6).toFixed(2); }
  gg.hp.set(sm.Hp, wordOf(sm.Hp, 0.2, 0.55, ["cleared", "present", "heavy"])); gg.ns.set(sm.Ns, wordOf(sm.Ns, 0.2, 0.55, ["none", "some", "strong"])); gg.ac.set(sm.Ac, wordOf(sm.Ac, 0.3, 0.62, ["low", "normal", "high"]));
  gg.def.set(sm.Def, wordOf(sm.Def, 0.35, 0.62, ["weak", "thinned", "intact"])); gg.ul.set(sm.U, wordOf(sm.U, 0.3, 0.62, ["healing", "open", "deep"])); gg.co.set(sm.Comp, wordOf(sm.Comp, 0.22, 0.5, ["none", "at risk", "present"]));
  const key = drug + "|" + level + "|" + m.words[0] + "|" + m.words[2];
  if (key !== capKey) { capKey = key; const s = capText(drug, m.words[0], m.words[2]); if (capEl.textContent !== s) capEl.textContent = s; }
}
run({ init, step });
