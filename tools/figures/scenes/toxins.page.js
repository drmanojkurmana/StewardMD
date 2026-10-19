/* Bacterial toxins scene: germ on its home organ, toxin drifts to one cell target, signals onward to the suffering organ. */
const LY = { stage: $("stage"), parts: $("parts"), over: $("over"), panel: $("panel") };
const LPOS = [150, 258], RPOS = [808, 258], CELLC = [480, 250], CELLL = [414, 250], CELLR = [546, 250];
const INFO = [
  { oL: "lung", site: "Airway", siteInfo: "Airway: the germ grows in the throat and releases toxin into the blood.", toxin: "Diphtheria toxin", target: "EF-2 and ribosome", tgt: "Cell target: EF-2, a helper for building proteins. Toxin blocks it, so protein building stops.", kind: 0, cut: "ef2", oR: "heart", eff: "Myocarditis", org: "Heart", orgInfo: "Heart: toxin travelling in blood injures heart muscle.", glow: "R", cap0: "Toxin stops protein building and injures the heart." },
  { oL: "lung", site: "Airway", siteInfo: "Airway: the germ clings to airway linings and releases toxin.", toxin: "Pertussis toxin", target: "Gi protein", tgt: "Cell target: Gi, a brake on cAMP. Toxin disables the brake, so cAMP rises.", kind: 1, cut: null, oR: "vessel", eff: "Lymphocytosis", org: "Blood", orgInfo: "Blood: disturbed signals pull extra lymphocytes into the blood.", glow: "P", cap0: "Toxin raises cAMP and white cells flood the blood." },
  { oL: "bowel", site: "Gut", siteInfo: "Gut: the germ stays in the small gut and releases toxin onto the lining.", toxin: "Cholera toxin", target: "Gs protein", tgt: "Cell target: Gs, a switch for cAMP. Toxin locks it on, so chloride and water pour out.", kind: 1, cut: null, oR: "colon", eff: "Watery diarrhoea", org: "Colon", orgInfo: "Colon: salt and water leave the gut lining faster than the body can take them back.", glow: "B", cap0: "Toxin locks the gut switch on and water pours out." },
  { oL: "bowel", site: "Gut", siteInfo: "Gut: toxin making E. coli grows in the gut and releases Shiga toxin.", toxin: "Shiga toxin", target: "Ribosome RNA", tgt: "Cell target: the large ribosome subunit. Toxin cuts its RNA, so protein building stops.", kind: 0, cut: "shiga", oR: "kidney", eff: "Kidney failure", org: "Kidney", orgInfo: "Kidney: injured vessel linings clog small vessels and the kidneys fail.", glow: "R", cap0: "Toxin shreds ribosomes and the kidneys fail." },
  { oL: "bowel", site: "Gut", siteInfo: "Gut: C. difficile settles in the gut and releases two toxins.", toxin: "TcdA and TcdB toxins", target: "Rho proteins", tgt: "Cell target: Rho switches that hold the cell skeleton up. Toxin freezes them, so the cell collapses.", kind: 2, cut: null, oR: "colon", eff: "Colitis", org: "Colon", orgInfo: "Colon: collapsed lining cells inflame the colon wall.", glow: "R", cap0: "Toxin wrecks the colon wall. Colitis follows." },
  { oL: "skin", site: "Wound", siteInfo: "Wound: spores enter through broken skin and release toxin.", toxin: "Tetanus toxin", target: "SNARE proteins", tgt: "Cell target: SNARE proteins that release calming signals. Toxin cuts them, so muscles cannot relax.", kind: 3, cut: null, oR: "muscle", eff: "Rigid spasms", org: "Muscle", orgInfo: "Muscle: without calming signals the muscle locks rigid in spasms.", glow: "O", cap0: "Toxin blocks the off switch. Muscles lock rigid." },
  { oL: "bowel", site: "Gut", siteInfo: "Gut: the germ grows in food or the infant gut and releases toxin.", toxin: "Botulinum toxin", target: "SNARE proteins", tgt: "Cell target: SNARE proteins that release acetylcholine. Toxin cuts them, so muscle cannot switch on.", kind: 3, cut: null, oR: "muscle", eff: "Floppy weakness", org: "Muscle", orgInfo: "Muscle: without nerve release the muscle goes limp and weak.", glow: "P", cap0: "Toxin blocks nerve release. Muscles go limp." },
];
const TREATN = ["", "Antitoxin", "Antibiotic", "Both together"];
const TRINFO = ["", "Antitoxin: Y shaped antibodies that grab free toxin before it enters cells.", "Antibiotic: kills the germs making toxin. Supportive care protects the body meanwhile.", "Both together: antitoxin traps toxin while antibiotic clears the germs."];
const TRCAP = { 1: "Antitoxin traps free toxin. Less reaches the target.", 2: "Antibiotic kills the germs. Less toxin is made.", 3: "Antitoxin traps toxin while antibiotic kills germs. The body recovers." };
function capFor(tox, drug) {
  if (drug === 2 && tox === 3) return "Antibiotics do not help Shiga toxin and may worsen harm. Care stays supportive.";
  if (drug === 0) return "No treatment. " + INFO[tox].cap0;
  return TRCAP[drug];
}
const OEXIT = { lung: "hilumR", bowel: "out", skin: "out" };
const OENTRY = { heart: "in", vessel: "in", colon: "descending", kidney: "in", muscle: "in" };
function aport(o, key) { const p = o.ports || {}; return p[key] || p.out || p.in || [o.x, o.y]; }
function pathD(tr) { let d = ""; for (let i = 0; i <= 14; i++) { const q = tr.at(i / 14); d += (i ? "L" : "M") + f1(q.x) + " " + f1(q.y); } return d; }
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0, st: 0, ti: -1 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y) { p.on = true; p.x = x; p.y = y; p.t = 0; p.u = 0; p.st = 0; p.ti = -1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const toxP = pool(26, () => mk("circle", { class: "sc-p p-tox", r: 3, fill: "none" }, LY.parts));
const sigP = pool(20, () => mk("circle", { class: "sc-p p-sig", r: 2.4, fill: "none" }, LY.parts));
const watP = pool(30, () => mk("circle", { class: "sc-p p-wat", r: 3, fill: "none" }, LY.parts));
const lymP = pool(24, () => mk("circle", { class: "sc-p p-lym", r: 2.6, fill: "none" }, LY.parts));
const pufP = pool(12, () => mk("circle", { class: "sc-p p-puf", r: 2, fill: "none" }, LY.parts));

let orgL = {}, orgR = {}, hostG = null, effGlow = null, toxinNameEl = null, effNameEl = null, capEl = null;
let vesL = null, vesR = null, trTox = null, trSig = null, exitPt = [200, 300], entryPt = [720, 258];
let watAnchor = [808, 330], lymTop = [808, 170], lymBot = [808, 340], vesXY = [480, 238];
const targetGs = [];
let shigaCut = null, ef2dot = null, campG = null, lockGlow = null, intactG = null, brokenG = null, snareCut = null, vesicle = null;
const chainDots = [];
const traps = [], caps = [], bacs = [];
let siteP = null, toxPillG = null, tgtPill = null, effP = null, treatG = null, treatT = null, treatLead = null, treatDot = null;
const gg = {};
const sm = { Act: 0.6, Hit: 0.6, Dys: 0.5, Clin: 0.5, anti: 0, abx: 0, treat: 0 };
const acc = { tox: 0, sig: 0, wat: 0, lym: 0, puf: 0 };
let lastTox = -1;

function buildOrgans() {
  const L = $("orgL"), R = $("orgR");
  orgL.lung = organ(L, "lung", LPOS[0], LPOS[1], 175, {});
  orgL.bowel = organ(L, "bowel", LPOS[0], LPOS[1], 180, {});
  orgL.skin = organ(L, "skin", LPOS[0], LPOS[1], 165, {});
  orgR.heart = organ(R, "heart", RPOS[0], RPOS[1], 170, {});
  orgR.vessel = organ(R, "vessel", RPOS[0], RPOS[1], 110, {});
  orgR.colon = organ(R, "colon", RPOS[0], RPOS[1], 180, {});
  orgR.kidney = organ(R, "kidney", RPOS[0], RPOS[1], 150, {});
  orgR.muscle = organ(R, "muscle", RPOS[0], RPOS[1], 185, {});
  Object.keys(orgL).forEach((k) => { orgL[k].g.style.display = "none"; });
  Object.keys(orgR).forEach((k) => { orgR[k].g.style.display = "none"; });
  vesL = $("vesL"); vesR = $("vesR");
}
function buildHost() {
  const H = $("hostSlot");
  hostG = cell(H, { cls: "lymph", r: 66, nuc: 0.42, seed: 7, wob: 0.08 }); place(hostG, CELLC[0], CELLC[1], 0, 1);
  const r = mk("g", { fill: "none" }, H);
  mk("path", { class: "tx-mrna", d: "M-58 27Q0 36 58 27", fill: "none" }, r);
  mk("ellipse", { class: "tx-ribo", cx: 0, cy: -8, rx: 40, ry: 17, fill: "none" }, r);
  mk("ellipse", { class: "tx-ribo2", cx: 0, cy: 14, rx: 26, ry: 11, fill: "none" }, r);
  ef2dot = mk("circle", { class: "tx-ef2", cx: -20, cy: -8, r: 5, fill: "none", opacity: "0" }, r);
  shigaCut = mk("path", { class: "tx-cut", d: "M-14 -18L4 2M4 -18L-14 2", fill: "none", opacity: "0" }, r);
  for (let i = 0; i < 5; i++) chainDots.push(mk("circle", { class: "tx-chain", cx: 46 + i * 8, cy: -8, r: 3, fill: "none", opacity: "0" }, r));
  place(r, CELLC[0], CELLC[1] + 2, 0, 1); targetGs.push(r);
  const gp = mk("g", { fill: "none" }, H);
  mk("rect", { class: "tx-memb", x: -56, y: -34, width: 112, height: 10, rx: 5, fill: "none" }, gp);
  mk("path", { class: "tx-snare", d: "M-18 -34v-14M-18 -48l-6 -6M-18 -48l6 -6", fill: "none" }, gp);
  mk("circle", { class: "tx-gp", cx: 8, cy: -2, r: 17, fill: "none" }, gp);
  lockGlow = mk("circle", { class: "tx-lock", cx: 8, cy: -2, r: 23, fill: "none", opacity: "0" }, gp);
  campG = mk("g", { fill: "none", opacity: "0.9" }, gp);
  [[-28, 22], [-8, 30], [14, 26], [32, 20], [0, 18]].forEach((pt) => mk("circle", { class: "tx-camp", cx: pt[0], cy: pt[1], r: 3, fill: "none" }, campG));
  place(gp, CELLC[0], CELLC[1] + 2, 0, 1); targetGs.push(gp);
  const rh = mk("g", { fill: "none" }, H);
  intactG = mk("g", { fill: "none" }, rh);
  mk("path", { class: "tx-actin", d: "M-52 -18Q-26 -26 0 -18T52 -18", fill: "none" }, intactG);
  mk("path", { class: "tx-actin", d: "M-52 2Q-26 -6 0 2T52 2", fill: "none" }, intactG);
  mk("path", { class: "tx-actin", d: "M-52 22Q-26 14 0 22T52 22", fill: "none" }, intactG);
  brokenG = mk("g", { fill: "none", opacity: "0" }, rh);
  mk("path", { class: "tx-cutact", d: "M-52 -18Q-26 -26 0 -18M14 -20T52 -18", fill: "none" }, brokenG);
  mk("path", { class: "tx-cutact", d: "M-52 2Q-26 -6 0 2M14 0T52 2", fill: "none" }, brokenG);
  mk("path", { class: "tx-cutact", d: "M-52 22Q-26 14 0 22M14 20T52 22", fill: "none" }, brokenG);
  mk("path", { class: "tx-cut", d: "M2 -24L14 -12M14 -24L2 -12", fill: "none" }, brokenG);
  mk("path", { class: "tx-cut", d: "M2 16L14 28M14 16L2 28", fill: "none" }, brokenG);
  [[-24, -8], [8, 10], [28, -14]].forEach((pt) => mk("circle", { class: "tx-rho", cx: pt[0], cy: pt[1], r: 8, fill: "none" }, rh));
  place(rh, CELLC[0], CELLC[1], 0, 1); targetGs.push(rh);
  const sn = mk("g", { fill: "none" }, H);
  mk("rect", { class: "tx-memb", x: -56, y: 20, width: 112, height: 9, rx: 4, fill: "none" }, sn);
  vesicle = mk("circle", { class: "tx-ves", cx: 0, cy: -12, r: 20, fill: "none" }, sn);
  mk("path", { class: "tx-snare", d: "M-8 4L0 20L8 4M8 4L0 20L-8 4", fill: "none" }, sn);
  snareCut = mk("path", { class: "tx-cut", d: "M-12 8L12 16M12 8L-12 16", fill: "none", opacity: "0" }, sn);
  place(sn, CELLC[0], CELLC[1], 0, 1); targetGs.push(sn);
}
function buildActors() {
  const T = $("trapSlot");
  for (let i = 0; i < 5; i++) {
    const g = mk("g", { fill: "none", opacity: "0" }, T);
    mk("path", { class: "tx-y", d: "M0 12L0 1M0 1L-8 -9M0 1L8 -9", fill: "none" }, g);
    traps.push({ g, x: 0, y: 0, n: 0 });
  }
  const B = $("bacSlot");
  for (let i = 0; i < 10; i++) {
    const g = mk("g", { fill: "none" }, B);
    mk("ellipse", { class: "tx-bac", cx: 0, cy: 0, rx: 9, ry: 5, fill: "none" }, g);
    mk("ellipse", { class: "tx-bac2", cx: -2, cy: -1, rx: 4, ry: 2.2, fill: "none" }, g);
    bacs.push({ g, x: rnd(78, 222), y: rnd(196, 322), a: rnd(0, 6.28) });
  }
  for (let i = 0; i < 3; i++) {
    const g = mk("g", { fill: "none", opacity: "0" }, B);
    mk("rect", { class: "tx-capA", x: -11, y: -5, width: 22, height: 10, rx: 5, fill: "none" }, g);
    mk("rect", { class: "tx-capB", x: 0, y: -5, width: 11, height: 10, rx: 5, fill: "none" }, g);
    place(g, 100 + i * 50, 186 + (i % 2) * 8, -20 + i * 18, 1.1);
    caps.push({ g, y: 186 + (i % 2) * 8, x: 100 + i * 50 });
  }
  effGlow = mk("ellipse", { class: "tx-glowB", cx: RPOS[0], cy: RPOS[1], rx: 80, ry: 70, fill: "none", opacity: "0" }, $("glowSlot"));
  const N = $("nameSlot");
  toxinNameEl = mk("text", { class: "tx-name", x: 480, y: 108, "text-anchor": "middle", fill: "none" }, N);
  effNameEl = mk("text", { class: "tx-eff", x: 808, y: 424, "text-anchor": "middle", fill: "none" }, N);
}
function buildOver() {
  const O = LY.over;
  siteP = pill(O, "Airway", 150, 186, 140, 120, "");
  toxPillG = pill(O, "Toxin", 300, 268, 305, 340, "");
  tgtPill = pill(O, "Cell target", 480, 318, 480, 368, "");
  effP = pill(O, "Muscle", 808, 184, 808, 120, "");
  treatG = pill(O, "Both together", 340, 235, 350, 150, "");
  treatT = treatG.querySelector("text"); treatLead = treatG.querySelector("path"); treatDot = treatG.querySelector("circle");
  treatG.setAttribute("opacity", "0");
  capEl = mk("text", { class: "tx-cap", x: 30, y: 428, fill: "none" }, O);
}
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14, fill: "none" }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8, fill: "none" }, P); t.textContent = "What happens";
  [["act", "Toxin action", "g-bac", "How actively toxin is reaching and entering the target cell."], ["hit", "Target hit", "g-cyt", "How strongly the precise cell target is disabled or switched on."], ["dys", "Cell dysfunction", "g-clot", "How badly the cell stops working normally."], ["clin", "Clinical effect", "g-bad", "How severe the body level effect is."]]
    .forEach((row, i) => { gg[row[0]] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, row[2], row[1], row[3]); });
}
function pillText(g, s) { const t = g.querySelector("text"); if (t && t.textContent !== s) t.textContent = s; }
function onModel(m) {
  const d = INFO[m.tox];
  Object.keys(orgL).forEach((k) => { orgL[k].g.style.display = k === d.oL ? "" : "none"; });
  Object.keys(orgR).forEach((k) => { orgR[k].g.style.display = k === d.oR ? "" : "none"; });
  const L = orgL[d.oL], R = orgR[d.oR];
  pillText(siteP, d.site); siteP.dataset.info = d.siteInfo;
  pillText(effP, d.org); effP.dataset.info = d.orgInfo;
  tgtPill.dataset.info = d.tgt;
  toxPillG.dataset.info = "Toxin (" + d.toxin + "): drifts from the germ to the target cell.";
  treatG.dataset.info = TRINFO[m.drug];
  pillText(treatG, TREATN[m.drug]);
  if (toxinNameEl.textContent !== d.toxin) toxinNameEl.textContent = d.toxin;
  if (effNameEl.textContent !== d.eff) effNameEl.textContent = d.eff;
  targetGs.forEach((g, i) => { g.style.display = i === d.kind ? "" : "none"; });
  effGlow.setAttribute("class", "tx-glow" + d.glow);
  effGlow.setAttribute("cx", f1(R.x)); effGlow.setAttribute("cy", f1(R.y));
  effGlow.setAttribute("rx", f1(R.w * 0.52)); effGlow.setAttribute("ry", f1(R.h * 0.5));
  exitPt = aport(L, OEXIT[d.oL]); entryPt = aport(R, OENTRY[d.oR]);
  const mx = (a, b, t, bow) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + bow];
  trTox = track([exitPt, mx(exitPt, CELLL, 0.33, 26), mx(exitPt, CELLL, 0.66, 26), CELLL]);
  trSig = track([CELLR, mx(CELLR, entryPt, 0.33, -24), mx(CELLR, entryPt, 0.66, -24), entryPt]);
  vesL.setAttribute("d", pathD(trTox)); vesR.setAttribute("d", pathD(trSig));
  [0.22, 0.4, 0.58, 0.74, 0.88].forEach((u, i) => { const q = trTox.at(u); traps[i].x = q.x; traps[i].y = q.y; traps[i].n = 0; place(traps[i].g, q.x, q.y, 0, 1); });
  const tl = traps[2];
  treatLead.setAttribute("d", "M" + f1(tl.x) + " " + f1(tl.y) + "L350 158");
  treatDot.setAttribute("cx", f1(tl.x)); treatDot.setAttribute("cy", f1(tl.y));
  watAnchor = [R.x, R.y + R.h * 0.4]; lymTop = [R.x, R.y - R.h * 0.42]; lymBot = [R.x, R.y + R.h * 0.42];
  vesXY = [CELLC[0], CELLC[1] - 12];
  const c = capFor(m.tox, m.drug);
  if (capEl.textContent !== c) capEl.textContent = c;
  if (m.tox !== lastTox) {
    toxP.forEach((p) => { if (p.on) kill(p); });
    watP.forEach((p) => { if (p.on) kill(p); }); lymP.forEach((p) => { if (p.on) kill(p); }); pufP.forEach((p) => { if (p.on) kill(p); });
  }
}
function init() { buildOrgans(); buildHost(); buildActors(); buildOver(); initPanel(); }
function step(dt, m) {
  const d = INFO[m.tox];
  const kk = Math.min(1, dt * 2.2);
  sm.Act = lerp(sm.Act, m.Act, kk); sm.Hit = lerp(sm.Hit, m.Hit, kk); sm.Dys = lerp(sm.Dys, m.Dys, kk); sm.Clin = lerp(sm.Clin, m.Clin, kk);
  sm.anti = lerp(sm.anti, (m.drug === 1 || m.drug === 3) ? 1 : 0, kk);
  sm.abx = lerp(sm.abx, (m.drug === 2 || m.drug === 3) ? 1 : 0, kk);
  sm.treat = lerp(sm.treat, m.drug > 0 ? 1 : 0, kk);
  bacs.forEach((b, i) => {
    if (!b.g) return;
    b.a += rnd(-1.2, 1.2) * dt; b.x += Math.cos(b.a) * 10 * dt; b.y += Math.sin(b.a) * 10 * dt;
    if (b.x < 74 || b.x > 226) b.a = Math.PI - b.a; if (b.y < 192 || b.y > 326) b.a = -b.a;
    b.x = clamp(b.x, 74, 226); b.y = clamp(b.y, 192, 326);
    const sc = 1 - 0.62 * sm.abx;
    place(b.g, b.x, b.y, Math.sin(tm / 700 + i) * 24, sc);
    b.g.setAttribute("opacity", (1 - 0.85 * sm.abx).toFixed(2));
  });
  caps.forEach((c) => { if (!c || !c.g) return; c.g.setAttribute("opacity", sm.abx.toFixed(2)); place(c.g, c.x, c.y + Math.sin(tm / 600 + c.x) * 3, 0, 1.1); });
  traps.forEach((tr, i) => { tr.g.setAttribute("opacity", sm.anti.toFixed(2)); place(tr.g, tr.x, tr.y + Math.sin(tm / 550 + i * 1.7) * 2.5, Math.sin(tm / 800 + i) * 8, 0.9 + 0.15 * sm.anti); });
  treatG.setAttribute("opacity", sm.treat.toFixed(2));
  place(hostG, CELLC[0] + Math.sin(tm / 1500) * 2, CELLC[1] + Math.cos(tm / 1900) * 2, Math.sin(tm / 2300) * 3, 1);
  vesicle.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 500) * 2) + ")");
  const L = orgL[d.oL], R = orgR[d.oR];
  place(L.g, L.x, L.y, 0, 1);
  if (m.tox === 0) place(R.g, R.x, R.y, Math.sin(tm / 900) * 2, 1 + 0.045 * sm.Clin * Math.sin(tm / 280));
  else if (m.tox === 5) place(R.g, R.x + Math.sin(tm / 55) * 6 * sm.Clin, R.y, Math.sin(tm / 47) * 6 * sm.Clin, 1);
  else place(R.g, R.x, R.y, 0, 1);
  effGlow.setAttribute("opacity", (0.06 + 0.4 * sm.Clin).toFixed(2));
  shigaCut.setAttribute("opacity", m.tox === 3 ? sm.Hit.toFixed(2) : "0");
  ef2dot.setAttribute("opacity", m.tox === 0 ? sm.Hit.toFixed(2) : "0");
  if (d.kind === 1) { campG.setAttribute("opacity", (0.12 + 0.88 * sm.Hit).toFixed(2)); lockGlow.setAttribute("opacity", sm.Hit.toFixed(2)); }
  if (d.kind === 2) { intactG.setAttribute("opacity", (1 - sm.Hit).toFixed(2)); brokenG.setAttribute("opacity", sm.Hit.toFixed(2)); }
  snareCut.setAttribute("opacity", d.kind === 3 ? sm.Hit.toFixed(2) : "0");
  if (d.kind === 0) { const vis = 1 + Math.round((1 - sm.Hit) * 4); chainDots.forEach((c, i) => c.setAttribute("opacity", i < vis ? "1" : "0.12")); }
  acc.tox += dt * (1.5 + 8.5 * sm.Act);
  while (acc.tox >= 1) { acc.tox--; const p = freeP(toxP); if (p) { emit(p, exitPt[0] + rnd(-8, 8), exitPt[1] + rnd(-8, 8)); p.e.setAttribute("class", "sc-p p-tox"); } }
  toxP.forEach((p) => {
    if (!p.on) return;
    if (p.st === 2) {
      p.t += dt; const tr = traps[p.ti];
      place(p.e, tr.x + 7, tr.y + 4 + p.t * 4, 0, 1);
      p.e.setAttribute("opacity", Math.max(0, 1 - p.t / 1.5).toFixed(2));
      if (p.t > 1.5) { if (tr.n > 0) tr.n--; p.e.setAttribute("class", "sc-p p-tox"); kill(p); }
      return;
    }
    p.t += dt; p.u += (dt * 95) / trTox.len; const q = trTox.at(Math.min(1, p.u));
    p.x = q.x; p.y = q.y; place(p.e, p.x, p.y, 0, 1);
    if (sm.anti > 0.25 && p.u > 0.12 && p.u < 0.95) {
      for (let i = 0; i < traps.length; i++) {
        const tr = traps[i];
        if (tr.n < 2 && Math.abs(p.x - tr.x) < 15 && Math.abs(p.y - tr.y) < 15 && Math.random() < 0.55) {
          p.st = 2; p.ti = i; tr.n++; p.e.setAttribute("class", "sc-p p-toxT"); break;
        }
      }
      if (p.st === 2) return;
    }
    if (p.u >= 1 || p.t > 8) { p.e.setAttribute("class", "sc-p p-tox"); kill(p); }
  });
  acc.sig += dt * (0.5 + 6 * sm.Hit);
  while (acc.sig >= 1) { acc.sig--; const p = freeP(sigP); if (p) emit(p, CELLR[0] + rnd(-6, 6), CELLR[1] + rnd(-8, 8)); }
  sigP.forEach((p) => { if (!p.on) return; p.t += dt; p.u += (dt * 85) / trSig.len; const q = trSig.at(Math.min(1, p.u)); place(p.e, q.x, q.y, 0, 1); if (p.u >= 1 || p.t > 6) kill(p); });
  if (m.tox === 2) {
    acc.wat += dt * 26 * sm.Clin * sm.Clin;
    while (acc.wat >= 1) { acc.wat--; const p = freeP(watP); if (p) { emit(p, watAnchor[0] + rnd(-22, 22), watAnchor[1]); p.vx = rnd(-15, 15); p.vy = rnd(70, 130); } }
  }
  watP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - watAnchor[1]) / 90).toFixed(2)); if (p.y > 405 || p.t > 3) kill(p); });
  if (m.tox === 1) {
    acc.lym += dt * (1.5 + 9 * sm.Clin);
    while (acc.lym >= 1) { acc.lym--; const p = freeP(lymP); if (p) { emit(p, lymTop[0] + rnd(-13, 13), lymTop[1]); p.vy = rnd(22, 42); } }
  }
  lymP.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", clamp(1 - (p.y - lymTop[1]) / (lymBot[1] - lymTop[1] + 20)).toFixed(2)); if (p.y > lymBot[1] + 18 || p.t > 8) kill(p); });
  if (d.kind === 3) {
    acc.puf += dt * 7 * (1 - sm.Hit);
    while (acc.puf >= 1) { acc.puf--; const p = freeP(pufP); if (p) { emit(p, vesXY[0] + rnd(-8, 8), vesXY[1]); p.vx = rnd(10, 30); p.vy = rnd(-25, -5); } }
  }
  pufP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; place(p.e, p.x, p.y, 0, 1); p.e.setAttribute("opacity", Math.max(0, 1 - p.t / 1.2).toFixed(2)); if (p.t > 1.2) kill(p); });
  gg.act.set(sm.Act, wordOf(sm.Act, 0.25, 0.6, ["low", "moderate", "high"])); gg.hit.set(sm.Hit, wordOf(sm.Hit, 0.25, 0.6, ["low", "moderate", "high"]));
  gg.dys.set(sm.Dys, wordOf(sm.Dys, 0.25, 0.55, ["little", "some", "marked"])); gg.clin.set(sm.Clin, wordOf(sm.Clin, 0.25, 0.55, ["mild", "moderate", "severe"]));
  lastTox = m.tox;
}
run({ init, step, onModel });
