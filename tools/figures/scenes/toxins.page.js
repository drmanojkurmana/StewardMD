/* Bacterial toxins scene: toxin traffic from bacterium to host target, then signals to the clinical effect. */
const LY = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
const INFO = [
  { src: "C. diphtheriae", toxin: "Diphtheria toxin", target: "EF-2 + ribosome", a1: "ADP-ribosylates EF-2", a2: "protein synthesis stops", eT: "Pseudomembrane", e1: "grey airway membrane", e2: "plus myocarditis", kind: 0, g: "" },
  { src: "B. pertussis", toxin: "Pertussis toxin", target: "Gi protein", a1: "ADP-ribosylates Gi", a2: "cAMP rises", eT: "Lymphocytosis", e1: "many lymphocytes", e2: "plus whooping cough", kind: 1, g: "Gi" },
  { src: "V. cholerae", toxin: "Cholera toxin", target: "Gs protein", a1: "locks Gs switched on", a2: "cAMP rises, chloride leaves", eT: "Secretory diarrhoea", e1: "chloride and water loss", e2: "from the gut lining", kind: 1, g: "Gs" },
  { src: "E. coli (Shiga)", toxin: "Shiga toxin", target: "60S ribosomal RNA", a1: "cleaves ribosomal RNA", a2: "protein synthesis stops", eT: "Haemolytic uraemic", e1: "syndrome (HUS)", e2: "endothelium injured", kind: 0, g: "" },
  { src: "C. difficile", toxin: "TcdA and TcdB toxins", target: "Rho GTPases", a1: "glucosylates Rho", a2: "cytoskeleton collapses", eT: "Colitis", e1: "colon wall inflamed", e2: "diarrhoea and pain", kind: 2, g: "" },
  { src: "C. tetani", toxin: "Tetanus toxin", target: "SNARE: synaptobrevin", a1: "cleaves SNARE proteins", a2: "inhibitory signals blocked", eT: "Spastic paralysis", e1: "muscles cannot relax", e2: "rigid spasms", kind: 3, g: "" },
  { src: "C. botulinum", toxin: "Botulinum toxin", target: "SNARE: nerve terminal", a1: "cleaves SNARE proteins", a2: "acetylcholine blocked", eT: "Flaccid paralysis", e1: "muscles cannot contract", e2: "weakness descends", kind: 3, g: "" },
];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, k) { p.on = true; p.x = x; p.y = y; p.t = 0; p.k = k || 0; p.st = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const toxP = pool(26, () => mk("circle", { class: "sc-p p-tox", r: 3 }, LY.parts));
const sigP = pool(20, () => mk("circle", { class: "sc-p p-sig", r: 2.4 }, LY.parts));

let bacG, hostNuc, srcEl, toxinEl, targetEl, act1El, act2El, effTEl, eff1El, eff2El, gLabelEl, shigaCut, effIcon;
const targetGs = [];
let tgtPill = null;
const treatIcons = {}, treatPills = {};
const gg = {};
const sm = { Act: 0.6, Hit: 0.6, Dys: 0.5, Clin: 0.5, anti: 0, abx: 0, vacc: 0 };
const acc = { tox: 0, sig: 0 };

function buildStage() {
  const S = LY.stage;
  mk("rect", { class: "tx-host", x: 290, y: 100, width: 360, height: 290, rx: 26 }, S);
  mk("rect", { class: "tx-card", x: 690, y: 120, width: 240, height: 240, rx: 16 }, S);
  hostNuc = cell(S, { cls: "lymph", r: 25, nuc: 0.45, seed: 7, wob: 0.08 }); place(hostNuc, 592, 152, 0, 1);
  bacG = mk("g", {}, S);
  mk("rect", { class: "tx-bac", x: -44, y: -17, width: 88, height: 34, rx: 17 }, bacG);
  [-24, 0, 24].forEach((x) => mk("ellipse", { class: "tx-bac2", cx: x, cy: 0, rx: 7, ry: 5 }, bacG));
  [-30, -12, 30].forEach((x) => mk("path", { class: "tx-snare", d: "M" + x + " -17l-4 -9M" + x + " 17l-4 9" }, bacG));
  place(bacG, 140, 225, -12, 1);
  srcEl = mk("text", { class: "tx-src", x: 140, y: 272 }, S);
  toxinEl = mk("text", { class: "tx-toxname", x: 465, y: 134 }, S);
  targetEl = mk("text", { class: "tx-sub", x: 465, y: 302 }, S);
  act1El = mk("text", { class: "tx-sub", x: 465, y: 328 }, S);
  act2El = mk("text", { class: "tx-sub", x: 465, y: 347 }, S);
  effTEl = mk("text", { class: "tx-effT", x: 810, y: 158 }, S);
  effIcon = cell(S, { cls: "endo", r: 27, nuc: 0.35, seed: 11, wob: 0.09 }); place(effIcon, 810, 212, 0, 1);
  eff1El = mk("text", { class: "tx-sub", x: 810, y: 272 }, S);
  eff2El = mk("text", { class: "tx-sub", x: 810, y: 291 }, S);
  /* target 0: ribosome */
  const r = mk("g", {}, S);
  mk("path", { class: "tx-mrna", d: "M-58 27Q0 36 58 27" }, r);
  mk("ellipse", { class: "tx-ribo", cx: 0, cy: -8, rx: 40, ry: 17 }, r);
  mk("ellipse", { class: "tx-ribo2", cx: 0, cy: 14, rx: 26, ry: 11 }, r);
  shigaCut = mk("path", { class: "tx-cut", d: "M-14 -18L4 2M4 -18L-14 2" }, r);
  place(r, 465, 238, 0, 1); targetGs.push(r);
  /* target 1: G protein at a membrane */
  const gp = mk("g", {}, S);
  mk("rect", { class: "tx-memb", x: -56, y: -34, width: 112, height: 10, rx: 5 }, gp);
  mk("path", { class: "tx-snare", d: "M-18 -34v-14M-18 -48l-6 -6M-18 -48l6 -6" }, gp);
  mk("circle", { class: "tx-gp", cx: 8, cy: -2, r: 17 }, gp);
  gLabelEl = mk("text", { class: "tx-src", x: 8, y: 2 }, gp);
  [[-28, 22], [-8, 30], [14, 26], [32, 20], [0, 18]].forEach((pt) => mk("circle", { class: "tx-camp", cx: pt[0], cy: pt[1], r: 3 }, gp));
  place(gp, 465, 242, 0, 1); targetGs.push(gp);
  /* target 2: Rho and actin */
  const rh = mk("g", {}, S);
  mk("path", { class: "tx-actin", d: "M-52 -18Q-26 -26 0 -18T52 -18" }, rh);
  mk("path", { class: "tx-actin", d: "M-52 2Q-26 -6 0 2T52 2" }, rh);
  mk("path", { class: "tx-actin", d: "M-52 22Q-26 14 0 22T52 22" }, rh);
  [[-24, -8], [8, 10], [28, -14]].forEach((pt) => mk("circle", { class: "tx-rho", cx: pt[0], cy: pt[1], r: 8 }, rh));
  place(rh, 465, 240, 0, 1); targetGs.push(rh);
  /* target 3: SNARE and vesicle */
  const sn = mk("g", {}, S);
  mk("rect", { class: "tx-memb", x: -56, y: 20, width: 112, height: 9, rx: 4 }, sn);
  mk("circle", { class: "tx-ves", cx: 0, cy: -12, r: 20 }, sn);
  mk("path", { class: "tx-snare", d: "M-8 4L0 20L8 4M8 4L0 20L-8 4" }, sn);
  mk("path", { class: "tx-cut", d: "M-12 8L12 16M12 8L-12 16" }, sn);
  place(sn, 465, 240, 0, 1); targetGs.push(sn);
  /* treatment icons */
  const ay = mk("g", {}, S); mk("path", { class: "tx-y", d: "M0 10L0 0M0 0L-7 -8M0 0L7 -8" }, ay); place(ay, 232, 222, 0, 1.5); ay.setAttribute("opacity", "0"); treatIcons.anti = ay;
  const ab = mk("g", {}, S); mk("rect", { class: "p-pill", x: -11, y: -5, width: 22, height: 10, rx: 5 }, ab); mk("rect", { class: "p-pill2", x: 0, y: -5, width: 11, height: 10, rx: 5 }, ab); place(ab, 140, 225, 35, 1.2); ab.setAttribute("opacity", "0"); treatIcons.abx = ab;
  const sh = mk("path", { class: "tx-shield", d: "M118 192Q140 182 162 192V224Q162 254 140 264Q118 254 118 224Z" }, S); sh.setAttribute("opacity", "0"); treatIcons.vacc = sh;
}
function buildOver() {
  const O = LY.over;
  pill(O, "Toxin", 185, 225, 140, 150, "Toxin released by the bacterium. It travels to a host cell and attacks one precise target inside or on that cell.");
  pill(O, "Bacterium", 115, 242, 60, 315, "The bacterium making the toxin. Use the toxin slider to change which organism and toxin are shown.");
  pill(O, "Host cell", 465, 100, 465, 80, "The host cell the toxin hijacks: a throat, gut, blood vessel, colon, immune or nerve cell depending on the toxin.");
  tgtPill = pill(O, "Cell target", 465, 214, 465, 165, "The exact molecule the toxin attacks inside the host cell.");
  pill(O, "Clinical effect", 885, 315, 860, 398, "What the cell damage or signalling causes in the body: membrane, diarrhoea, colitis, blood or muscle effects.");
  const g1 = mk("g", {}, O); pill(g1, "Antitoxin", 225, 220, 245, 165, "Antitoxin binds free toxin before it enters cells. It cannot undo toxin already inside a cell, so timing matters."); treatPills.anti = g1;
  const g2 = mk("g", {}, O); pill(g2, "Antibiotic", 175, 240, 240, 355, "An antibiotic reduces the bacteria making toxin. Supportive care protects the airway, heart, gut and kidneys meanwhile."); treatPills.abx = g2;
  const g3 = mk("g", {}, O); pill(g3, "Vaccination", 125, 200, 80, 112, "Vaccination teaches the immune system to neutralise the toxin before disease starts. It prevents rather than treats."); treatPills.vacc = g3;
  Object.keys(treatPills).forEach((key) => treatPills[key].setAttribute("opacity", "0"));
}
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "What happens";
  [["act", "Toxin action", "g-bac", "How actively toxin is reaching and entering host cells."], ["hit", "Target hit", "g-cyt", "How strongly the precise cell target (EF-2, a G protein, ribosomal RNA, Rho or SNARE) is disabled or switched."], ["dys", "Cell dysfunction", "g-clot", "How badly the host cell stops working normally: no protein, too much cAMP, a collapsed skeleton or blocked vesicles."], ["clin", "Clinical effect", "g-bad", "How severe the body level effect is, from membrane and diarrhoea to colitis, HUS or paralysis."]]
    .forEach((row, i) => { gg[row[0]] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, row[2], row[1], row[3]); });
}
function onModel(m) {
  const d = INFO[m.tox];
  srcEl.textContent = d.src; toxinEl.textContent = d.toxin; targetEl.textContent = d.target; act1El.textContent = d.a1; act2El.textContent = d.a2;
  effTEl.textContent = d.eT; eff1El.textContent = d.e1; eff2El.textContent = d.e2; gLabelEl.textContent = d.g;
  targetGs.forEach((g, i) => { g.style.display = i === d.kind ? "" : "none"; });
  shigaCut.setAttribute("opacity", m.tox === 3 ? "1" : "0");
  if (tgtPill) tgtPill.dataset.info = "Cell target: " + d.target + ". " + d.a1 + ", so " + d.a2 + ".";
}
function init() { buildStage(); buildOver(); initPanel(); }
function step(dt, m) {
  const kk = Math.min(1, dt * 2.2);
  sm.Act = lerp(sm.Act, m.Act, kk); sm.Hit = lerp(sm.Hit, m.Hit, kk); sm.Dys = lerp(sm.Dys, m.Dys, kk); sm.Clin = lerp(sm.Clin, m.Clin, kk);
  sm.anti = lerp(sm.anti, m.drug === 1 ? 1 : 0, kk); sm.abx = lerp(sm.abx, m.drug === 2 ? 1 : 0, kk); sm.vacc = lerp(sm.vacc, m.drug === 3 ? 1 : 0, kk);
  place(bacG, 140, 225, -12 + Math.sin(tm / 700) * 3, 1 + 0.03 * Math.sin(tm / 400));
  place(hostNuc, 592, 152, 0, 1 + 0.08 * sm.Dys * Math.sin(tm / 320));
  place(effIcon, 810, 212, Math.sin(tm / 600) * 5, 0.7 + 0.5 * sm.Clin);
  targetGs.forEach((g, i) => { if (i === INFO[m.tox].kind) place(g, 465, 240 + Math.sin(tm / 800 + i) * 2, 0, 1 + 0.06 * sm.Hit * Math.sin(tm / 300)); });
  treatIcons.anti.setAttribute("opacity", sm.anti.toFixed(2)); treatIcons.abx.setAttribute("opacity", sm.abx.toFixed(2)); treatIcons.vacc.setAttribute("opacity", sm.vacc.toFixed(2));
  treatPills.anti.setAttribute("opacity", sm.anti.toFixed(2)); treatPills.abx.setAttribute("opacity", sm.abx.toFixed(2)); treatPills.vacc.setAttribute("opacity", sm.vacc.toFixed(2));
  acc.tox += dt * sm.Act * 7; while (acc.tox >= 1) { acc.tox--; const p = freeP(toxP); if (p) emit(p, 188, 225 + rnd(-10, 10), 0); }
  toxP.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.st === 0 ? 296 : 458, ty = p.st === 0 ? 232 : 240, dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy) || 1, sp = 95;
    p.x += (dx / dd) * sp * dt; p.y += (dy / dd) * sp * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (dd < 8) { if (p.st === 0) p.st = 1; else kill(p); } if (p.t > 7) kill(p); });
  acc.sig += dt * sm.Hit * 6; while (acc.sig >= 1) { acc.sig--; const p = freeP(sigP); if (p) emit(p, 520, 238 + rnd(-12, 12), 0); }
  sigP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += 82 * dt; p.y += (212 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 688 || p.t > 5) kill(p); });
  gg.act.set(sm.Act, wordOf(sm.Act, 0.25, 0.6, ["low", "moderate", "high"])); gg.hit.set(sm.Hit, wordOf(sm.Hit, 0.25, 0.6, ["low", "moderate", "high"]));
  gg.dys.set(sm.Dys, wordOf(sm.Dys, 0.25, 0.55, ["little", "some", "marked"])); gg.clin.set(sm.Clin, wordOf(sm.Clin, 0.25, 0.55, ["mild", "moderate", "severe"]));
}
run({ init, step, onModel });
