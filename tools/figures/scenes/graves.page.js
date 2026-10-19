/* Graves and Hashimoto scene: pituitary TSH, plasma cell antibodies, the thyroid gland, eye and body, and the gauges. */
const layers = { thy: $("thySlot"), folls: $("folls"), lymphs: $("lymphs"), docks: $("docks"), pit: $("pit"), plasma: $("plasma"), parts: $("parts"), over: $("over"), panel: $("panel"), eyeHalo: $("eyeHalo"), eyeSlot: $("eyeSlot"), heartSlot: $("heartSlot"), glandGlow: $("glandGlow"), bodyGlow: $("bodyGlow") };
let tshTr = null, abTr = null, abEyeTr = null, hormTr = null, rxTr = null;
let thyO = null, eyeO = null, heartO = null;
let pitCell = null, plasmaCell = null, ablRing = null, capEl = null, capKey = "";
let lobeL = [432, 235], lobeR = [528, 235], thyTop = [515, 160], eyeIn = [748, 115];
const heartEdge = [745, 290];
function setD(el, pts) {
  el.setAttribute("d", "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"));
}
function initOrgans() {
  thyO = organ(layers.thy, "thyroid", 480, 235, 220, {});
  eyeO = organ(layers.eyeSlot, "eye", 810, 115, 150, {});
  heartO = organ(layers.heartSlot, "heart", 800, 305, 120, {});
  const TP = thyO.ports, EP = eyeO.ports;
  lobeL = TP.lobeL; lobeR = TP.lobeR; thyTop = TP.in; eyeIn = EP.in;
  const tshPts = [[150, 110], [260, 100], [380, 115], thyTop];
  const abPts = [[150, 312], [260, 305], [340, 280], [lobeL[0], lobeL[1] + 17]];
  const abEyePts = [[lobeR[0] + 17, lobeR[1] - 50], [630, 135], [700, 118], eyeIn];
  const hormPts = [[lobeR[0], lobeR[1] + 15], [620, 260], [690, 275], heartEdge];
  const rxPts = [[640, 362], [600, 325], [556, 296]];
  tshTr = track(tshPts); abTr = track(abPts); abEyeTr = track(abEyePts); hormTr = track(hormPts); rxTr = track(rxPts);
  setD($("tshT"), tshPts); setD($("abT"), abPts); setD($("abEyeT"), abEyePts); setD($("hormT"), hormPts); setD($("rxT"), rxPts);
}
/* follicles clustered in the two lobes, from the real lobe ports */
const follList = [];
function initFolls() {
  const offs = [[-29, -32], [-10, -39], [9, -34], [26, -26], [-34, -10], [-14, -15], [7, -12], [27, -5], [-31, 10], [-10, 7], [10, 10], [29, 14], [-20, 29], [0, 31], [19, 31], [-7, -2]];
  [lobeL, lobeR].forEach((c, li) => {
    offs.forEach((o, i) => {
      const g = mk("g", {}, layers.folls);
      mk("circle", { class: "gr-foll", cx: f1(c[0] + o[0]), cy: f1(c[1] + o[1]), r: 6 + ((i + li) % 3) }, g);
      follList.push(g);
    });
  });
  const fibs = [];
  for (let i = 0; i < 6; i++) fibs.push(mk("path", { class: "gr-fib", d: "M" + (404 + i * 16) + " " + (196 + (i % 3) * 22) + "l34 " + (18 - (i % 3) * 14) + "l28 " + ((i % 2) * 16 - 8) }, layers.lymphs));
  layers._fibs = fibs;
}
const lymphList = [];
function initLymphs() {
  const offs = [[-24, -24], [0, -29], [22, -17], [-12, -5], [14, 2], [-26, 15], [4, 19], [24, 24], [-5, -17], [10, -24]];
  [lobeL, lobeR].forEach((c) => {
    offs.forEach((o) => {
      const g = cell(layers.lymphs, { cls: "lymph", r: 6, nuc: 0.5, seed: lymphList.length + 3, wob: 0.14 });
      g.setAttribute("transform", "translate(" + f1(c[0] + o[0]) + " " + f1(c[1] + o[1]) + ")");
      lymphList.push(g);
    });
  });
}
/* parked blockers: antithyroid drug sitting on hormone making spots */
const dockList = [];
function initDocks() {
  const offs = [[-30, -45], [0, -52], [30, -45], [-38, 0], [38, 0], [-25, 45], [25, 45]];
  [lobeL, lobeR].forEach((c) => {
    offs.forEach((o, i) => {
      const g = mk("g", { transform: "translate(" + f1(c[0] + o[0]) + " " + f1(c[1] + o[1]) + ")" }, layers.docks);
      mk("path", { class: "sc-p p-blockT", d: "M0 -6L6 0L0 6L-6 0Z" }, g);
      g.setAttribute("opacity", "0");
      dockList.push({ g, x: c[0] + o[0], y: c[1] + o[1], ph: i * 1.1 + c[0] });
    });
  });
}
function initNodes() {
  pitCell = cell(layers.pit, { cls: "mac", r: 26, nuc: 0.4, seed: 4, wob: 0.12 });
  plasmaCell = cell(layers.plasma, { cls: "bcell", r: 24, nuc: 0.45, seed: 8, wob: 0.13 });
  ablRing = mk("ellipse", { class: "gr-fib", cx: 480, cy: 235, rx: 100, ry: 85, opacity: "0", style: "stroke:var(--c-bad);stroke-width:1.6;stroke-dasharray:5 4;fill:none" }, layers.over);
}
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0 }; }); }
const tshP = pool(14, () => mk("circle", { class: "sc-p p-tshp", r: 2.6 }, layers.parts));
const abP = pool(22, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "p-ab-y", d: "M0 5L0 -1M0 -1L-4 -6M0 -1L4 -6" }, g); return g; });
const hormP = pool(26, () => mk("path", { class: "sc-p p-horm", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const antiP = pool(12, () => mk("path", { class: "sc-p p-blockT", d: "M0 -5L5 0L0 5L-5 0Z" }, layers.parts));
const levoP = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-levo2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, k) { p.on = true; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function movePool(pl, tr, sp, rot) { pl.forEach((p) => { if (!p.on) return; const T = typeof tr === "function" ? tr(p) : tr; p.u += (sp / T.len) * dtCur; if (p.u >= 1) { killP(p); return; } const q = T.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")" + (rot ? " rotate(" + f1(q.a + 90) + ")" : "")); }); }
let dtCur = 0.016;
function capText(l, d) {
  const T = [
    ["No treatment. Antibody switches the gland on. Hormone runs high.",
      "Surgery or radioiodine removes the gland. Hormone falls. Eye signs can persist.",
      "Levothyroxine adds to already high hormone. The body stays overdriven.",
      "Antithyroid medicine blocks new hormone. Hormone settles toward normal."],
    ["No treatment. Lymphocytes destroy follicles. Hormone slips while TSH rises.",
      "Removing the gland removes the little hormone it still made.",
      "Levothyroxine replaces missing hormone. TSH settles back.",
      "Antithyroid medicine blocks the little hormone left. The deficit deepens."],
    ["No treatment. Little gland left. Hormone stays low and TSH stays high.",
      "The gland is already gone. Removal changes little now.",
      "Levothyroxine replaces missing hormone. The body picks back up.",
      "Antithyroid medicine blocks the little hormone left. The deficit deepens."]];
  return T[l][d];
}
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ab", "Antibody", "g-ab", "The autoantibody pattern: a stimulating TSH receptor antibody in Graves, and a thyroid peroxidase antibody pattern in Hashimoto."], ["dmg", "Damage", "g-dmg", "Loss of working follicles from lymphocytic destruction and fibrosis. Low in Graves, high in late Hashimoto."], ["horm", "Hormone", "g-thy", "Thyroid hormone reaching the body. High speeds tissues up; low slows them down."], ["tsh", "TSH", "g-fl", "Pituitary thyroid stimulating hormone. Suppressed when hormone is high, high when the gland cannot respond."], ["gland", "Gland", "g-good", "Size of the thyroid gland. Enlarged as a goitre in Graves and early Hashimoto, small and shrunken in late Hashimoto."], ["eye", "Eye signs", "g-eye", "Graves eye disease: autoimmune inflammation behind the eye pushes it forward. It does not follow hormone alone and may persist after the gland is removed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pituitary", 125, 100, 125, 60, "Pituitary: it makes TSH. Thyroid hormone feeds back and turns TSH down, so TSH is suppressed in Graves and raised when a Hashimoto gland cannot respond.");
  pill(ox, "Plasma cell", 125, 289, 125, 245, "Plasma cell: an antibody making cell of the immune system. Its antibodies head for the thyroid, and in Graves also for the eye.");
  pill(ox, "Antibodies", 265, 298, 265, 338, "Autoantibodies travelling to the gland. The stimulating kind switches the TSH receptor on in Graves. In Hashimoto, antibodies mark a lymphocytic attack that destroys follicles.");
  pill(ox, "Thyroid", 480, 172, 480, 112, "Thyroid gland in front of the windpipe. It grows as a goitre when stimulated or infiltrated, and shrinks when follicles are lost or the gland is removed.");
  pill(ox, "Lymphocytes", 450, 258, 370, 385, "Lymphocytes inside the gland. In Hashimoto they infiltrate and destroy follicles; in late disease fibrous tissue replaces working gland.");
  pill(ox, "Hormone", 640, 263, 640, 216, "Thyroid hormone leaving the gland for body tissues. It sets metabolic pace and feeds back on the pituitary to lower TSH.");
  pill(ox, "Eye", 845, 130, 810, 185, "The eye. In Graves, autoimmune inflammation behind the eye expands tissue and muscle and pushes the eye forward. This can persist even when hormone is controlled.");
  pill(ox, "Body", 800, 330, 800, 392, "Body tissues, shown by the heart. Too much thyroid hormone speeds and drives them; too little slows them down.");
  capEl = mk("text", { class: "gr-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 0);
}
const WW = SC.W;
const sm = { Ab: 0.9, D: 0.16, cap: 1, stim: 1, anti: 0, abl: 0, levo: 0, H: 0.9, P: 0.1, gs: 0.88, Eye: 0.8, block: 0 };
const acc = { tsh: 0, ab: 0, horm: 0, anti: 0, levo: 0 };
function init() { initOrgans(); initFolls(); initLymphs(); initDocks(); initNodes(); initPanel(); }
function step(dt, m) {
  dtCur = dt;
  const k = Math.min(1, dt * 0.8);
  ["Ab", "D", "cap", "stim", "anti", "abl", "levo", "H", "P", "gs", "Eye"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  sm.block = lerp(sm.block, m.anti, Math.min(1, dt * 1.2));
  /* gland size and follicle survival */
  const gsScale = 0.72 + 0.45 * sm.gs;
  const gtr = "translate(480 235) scale(" + gsScale.toFixed(3) + ") translate(-480 -235)";
  layers.thy.setAttribute("transform", gtr); layers.folls.setAttribute("transform", gtr); layers.lymphs.setAttribute("transform", gtr); layers.docks.setAttribute("transform", gtr);
  follList.forEach((g, i) => { g.style.opacity = (i / follList.length < sm.cap ? 0.95 : 0.1).toFixed(2); });
  lymphList.forEach((g, i) => { g.style.opacity = (i / lymphList.length < sm.D ? 1 : 0).toFixed(2); });
  if (layers._fibs) layers._fibs.forEach((f) => f.setAttribute("opacity", (sm.D * 0.7).toFixed(2)));
  if (ablRing) ablRing.setAttribute("opacity", (sm.abl * 0.9).toFixed(2));
  layers.thy.setAttribute("opacity", (1 - 0.25 * sm.abl).toFixed(2));
  /* activation glow on the gland shrinks and fades as blockers park on it */
  const act = sm.stim * (1 - 0.75 * sm.block);
  layers.glandGlow.setAttribute("rx", f1(70 + 55 * act));
  layers.glandGlow.setAttribute("ry", f1(58 + 47 * act));
  layers.glandGlow.setAttribute("opacity", (act * 0.5).toFixed(2));
  /* parked blockers sit on hormone making spots and gently pulse */
  dockList.forEach((b) => { b.g.setAttribute("opacity", sm.block.toFixed(2)); place(b.g, b.x, b.y, 0, 0.9 + 0.1 * Math.sin(tm / 500 + b.ph)); });
  /* pituitary and plasma cell activity */
  place(pitCell, 125 + Math.sin(tm / 1600) * 2, 115 + Math.cos(tm / 1800) * 1.5, 0, 0.85 + 0.3 * sm.P);
  place(plasmaCell, 125 + Math.sin(tm / 1500 + 2) * 2, 315 + Math.cos(tm / 1700) * 1.5, 0, 0.85 + 0.3 * sm.Ab);
  /* eye: forward push and inflamed halo with Graves activity */
  layers.eyeHalo.setAttribute("opacity", (sm.Eye * 0.32).toFixed(2));
  layers.eyeSlot.setAttribute("transform", "translate(" + f1(sm.Eye * 10) + " 0) translate(810 115) scale(" + (1 + sm.Eye * 0.08).toFixed(3) + ") translate(-810 -115)");
  /* heart and tissues follow hormone; the body glow grows with hormone */
  const beat = 1 + (0.025 + 0.05 * sm.H) * Math.sin(tm / Math.max(120, 620 - 380 * sm.H));
  const base = 0.92 + 0.14 * sm.H;
  layers.heartSlot.setAttribute("transform", "translate(800 305) scale(" + (base * beat).toFixed(3) + ") translate(-800 -305)");
  layers.bodyGlow.setAttribute("rx", f1(70 + 45 * sm.H));
  layers.bodyGlow.setAttribute("ry", f1(70 + 50 * sm.H));
  layers.bodyGlow.setAttribute("opacity", (0.08 + 0.22 * sm.H).toFixed(2));
  /* particles */
  acc.tsh += dt * sm.P * 6; while (acc.tsh >= 1) { acc.tsh--; const p = freeP(tshP); if (p) emitP(p); }
  acc.ab += dt * sm.Ab * 7; while (acc.ab >= 1) { acc.ab--; const p = freeP(abP); if (p) emitP(p, sm.Eye > 0.3 && Math.random() < 0.28 ? 1 : 0); }
  acc.horm += dt * sm.H * 9; while (acc.horm >= 1) { acc.horm--; const p = freeP(hormP); if (p) emitP(p); }
  acc.anti += dt * sm.anti * 4; while (acc.anti >= 1) { acc.anti--; const p = freeP(antiP); if (p) emitP(p); }
  acc.levo += dt * sm.levo * 4; while (acc.levo >= 1) { acc.levo--; const p = freeP(levoP); if (p) emitP(p, 1); }
  movePool(tshP, tshTr, 52, false);
  movePool(abP, (p) => (p.k ? abEyeTr : abTr), 58, true);
  movePool(hormP, hormTr, 58, false);
  movePool(antiP, rxTr, 52, false);
  movePool(levoP, hormTr, 58, false);
  /* gauges */
  gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.65, ["low", "raised", "high"])); gg.dmg.set(sm.D, wordOf(sm.D, 0.3, 0.65, ["little", "some", "severe"])); gg.horm.set(sm.H, wordOf(sm.H, 0.35, 0.65, ["low", "normal", "high"]));
  gg.tsh.set(sm.P, wordOf(sm.P, 0.35, 0.62, ["suppressed", "normal", "high"])); gg.gland.set(sm.gs, wordOf(sm.gs, 0.35, 0.65, ["small", "normal", "enlarged"])); gg.eye.set(sm.Eye, sm.Eye < 0.3 ? "absent" : "present");
  const key = level * 10 + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
