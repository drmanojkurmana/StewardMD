/* Graves and Hashimoto scene: pituitary TSH, plasma cell antibodies, the thyroid gland, eye and body tissues, and the gauges. */
const layers = { thy: $("thy"), folls: $("folls"), lymphs: $("lymphs"), pit: $("pit"), plasma: $("plasma"), parts: $("parts"), over: $("over"), panel: $("panel"), eyeHalo: $("eyeHalo"), eyeball: $("eyeball"), heartG: $("heartG") };
const tshTr = track([[152, 108], [230, 94], [330, 118], [424, 178]]);
const abTr = track([[152, 308], [240, 305], [340, 282], [424, 252]]);
const abEyeTr = track([[536, 178], [620, 128], [690, 116], [742, 114]]);
const hormTr = track([[548, 226], [640, 246], [700, 268], [742, 286]]);
const rxTr = track([[640, 352], [590, 312], [545, 272]]);
/* follicles inside the two lobes */
const follList = [];
function initFolls() {
  const offs = [[-34, -38], [-12, -46], [10, -40], [30, -30], [-40, -12], [-16, -18], [8, -14], [32, -6], [-36, 12], [-12, 8], [12, 12], [34, 16], [-24, 34], [0, 36], [22, 36], [-8, -2]];
  [430, 530].forEach((cx, li) => { offs.forEach((o, i) => { const g = mk("g", {}, layers.folls); mk("circle", { class: "gr-foll", cx: cx + o[0], cy: 235 + o[1], r: 7 + ((i + li) % 3) }, g); follList.push(g); }); });
  const fibs = [];
  for (let i = 0; i < 6; i++) fibs.push(mk("path", { class: "gr-fib", d: "M" + (404 + i * 16) + " " + (196 + (i % 3) * 22) + "l34 " + (18 - (i % 3) * 14) + "l28 " + ((i % 2) * 16 - 8) }, layers.lymphs));
  layers._fibs = fibs;
}
const lymphList = [];
function initLymphs() {
  const offs = [[-28, -28], [0, -34], [26, -20], [-14, -6], [16, 2], [-30, 18], [4, 22], [28, 28], [-6, -20], [12, -28]];
  [430, 530].forEach((cx) => { offs.forEach((o) => { const g = cell(layers.lymphs, { cls: "lymph", r: 6, nuc: 0.5, seed: lymphList.length + 3, wob: 0.14 }); g.setAttribute("transform", "translate(" + (cx + o[0]) + " " + (235 + o[1]) + ")"); lymphList.push(g); }); });
}
let pitCell = null, plasmaCell = null, ablRing = null, rxPillEl = null;
function initNodes() {
  pitCell = cell(layers.pit, { cls: "mac", r: 26, nuc: 0.4, seed: 4, wob: 0.12 });
  plasmaCell = cell(layers.plasma, { cls: "bcell", r: 24, nuc: 0.45, seed: 8, wob: 0.13 });
  ablRing = mk("ellipse", { class: "gr-fib", cx: 480, cy: 235, rx: 92, ry: 78, opacity: "0", style: "stroke:var(--c-bad);stroke-width:1.6;stroke-dasharray:5 4;fill:none" }, layers.over);
}
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0 }; }); }
const tshP = pool(14, () => mk("circle", { class: "sc-p p-tshp", r: 2.6 }, layers.parts));
const abP = pool(22, () => { const g = mk("g", {}, layers.parts); mk("path", { class: "p-ab-y", d: "M0 5L0 -1M0 -1L-4 -6M0 -1L4 -6" }, g); return g; });
const hormP = pool(22, () => mk("path", { class: "sc-p p-horm", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, layers.parts));
const capsP = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emitP(p, k) { p.on = true; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function movePool(pl, tr, sp, rot) { pl.forEach((p) => { if (!p.on) return; const T = typeof tr === "function" ? tr(p) : tr; p.u += (sp / T.len) * dtCur; if (p.u >= 1) { killP(p); return; } const q = T.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")" + (rot ? " rotate(" + f1(q.a + 90) + ")" : "")); }); }
let dtCur = 0.016;
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["ab", "Antibody", "g-ab", "The autoantibody pattern: a stimulating TSH receptor antibody in Graves, and a thyroid peroxidase antibody pattern in Hashimoto."], ["dmg", "Damage", "g-dmg", "Loss of working follicles from lymphocytic destruction and fibrosis. Low in Graves, high in late Hashimoto."], ["horm", "Hormone", "g-thy", "Thyroid hormone reaching the body. High speeds tissues up; low slows them down."], ["tsh", "TSH", "g-fl", "Pituitary thyroid stimulating hormone. Suppressed when hormone is high, high when the gland cannot respond."], ["gland", "Gland", "g-good", "Size of the thyroid gland. Enlarged as a goitre in Graves and early Hashimoto, small and shrunken in late Hashimoto."], ["eye", "Eye signs", "g-eye", "Graves eye disease: autoimmune inflammation behind the eye pushes it forward. It does not follow hormone alone and may persist after the gland is removed."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Pituitary", 125, 89, 125, 60, "Anterior pituitary: it makes TSH. Thyroid hormone feeds back and turns TSH down, so TSH is suppressed in Graves and raised when a Hashimoto gland cannot respond.");
  pill(ox, "TSH", 290, 104, 290, 68, "TSH, thyroid stimulating hormone. In Graves the gland ignores the low TSH because a stimulating antibody switches its receptor on. In Hashimoto a high TSH cannot rescue destroyed follicles.");
  pill(ox, "Plasma cell", 125, 289, 125, 245, "Plasma cell: an antibody making cell of the immune system. Autoimmunity here is aimed at the thyroid, at its TSH receptor in Graves and at thyroid peroxidase in Hashimoto.");
  pill(ox, "Antibodies", 265, 300, 265, 338, "Autoantibodies travelling to the gland. The stimulating kind switches the TSH receptor on in Graves. In Hashimoto, antibodies mark a lymphocytic attack that destroys follicles.");
  pill(ox, "Thyroid gland", 480, 172, 480, 118, "Thyroid gland in front of the windpipe. It grows as a goitre when stimulated or infiltrated, and shrinks when follicles are lost or the gland is removed.");
  pill(ox, "Lymphocytes", 450, 258, 370, 385, "Lymphocytes inside the gland. In Hashimoto they infiltrate and destroy follicles; in late disease fibrous tissue replaces working gland.");
  pill(ox, "Hormone", 665, 252, 665, 205, "Thyroid hormone leaving the gland for body tissues. It sets metabolic pace and feeds back on the pituitary to lower TSH.");
  pill(ox, "Eye", 800, 149, 800, 178, "The eye. In Graves, autoimmune inflammation behind the eye expands tissue and muscle and pushes the eye forward. This can persist even when hormone is controlled.");
  pill(ox, "Body tissues", 800, 330, 800, 368, "Body tissues, shown by the heart. Too much thyroid hormone speeds and drives them; too little slows them down.");
  rxPillEl = pill(ox, "Treatment", 600, 318, 660, 382, "The treatment chosen in the menu. An antithyroid medicine blocks hormone making, radioiodine or surgery removes the gland, and levothyroxine replaces missing hormone.");
}
const WW = SC.W;
const sm = { Ab: 0.9, D: 0.16, cap: 1, stim: 1, anti: 0, abl: 0, levo: 0, H: 0.9, P: 0.1, gs: 0.88, Eye: 0.8, rx: 0 };
const acc = { tsh: 0, ab: 0, horm: 0, cap: 0 };
function init() { initFolls(); initLymphs(); initNodes(); initPanel(); }
function step(dt, m) {
  dtCur = dt;
  const k = Math.min(1, dt * 0.8);
  ["Ab", "D", "cap", "stim", "anti", "abl", "levo", "H", "P", "gs", "Eye"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  sm.rx = lerp(sm.rx, (m.anti || m.abl || m.levo) ? 1 : 0, k);
  /* gland size and follicle survival */
  const gsScale = 0.72 + 0.45 * sm.gs;
  const gtr = "translate(480 235) scale(" + gsScale.toFixed(3) + ") translate(-480 -235)";
  layers.thy.setAttribute("transform", gtr); layers.folls.setAttribute("transform", gtr); layers.lymphs.setAttribute("transform", gtr);
  follList.forEach((g, i) => { g.style.opacity = (i / follList.length < sm.cap ? 0.95 : 0.1).toFixed(2); });
  lymphList.forEach((g, i) => { g.style.opacity = (i / lymphList.length < sm.D ? 1 : 0).toFixed(2); });
  if (layers._fibs) layers._fibs.forEach((f) => f.setAttribute("opacity", (sm.D * 0.7).toFixed(2)));
  if (ablRing) ablRing.setAttribute("opacity", (sm.abl * 0.9).toFixed(2));
  if (rxPillEl) { rxPillEl.style.opacity = sm.rx.toFixed(2); rxPillEl.style.pointerEvents = sm.rx > 0.3 ? "auto" : "none"; }
  /* pituitary and plasma cell activity */
  place(pitCell, 125 + Math.sin(tm / 1600) * 2, 115 + Math.cos(tm / 1800) * 1.5, 0, 0.85 + 0.3 * sm.P);
  place(plasmaCell, 125 + Math.sin(tm / 1500 + 2) * 2, 315 + Math.cos(tm / 1700) * 1.5, 0, 0.85 + 0.3 * sm.Ab);
  /* eye: forward push and inflamed halo with Graves activity */
  layers.eyeHalo.setAttribute("opacity", (sm.Eye * 0.32).toFixed(2));
  layers.eyeball.setAttribute("transform", "translate(" + f1(800 + sm.Eye * 12) + " 115) scale(" + (1 + sm.Eye * 0.08).toFixed(3) + ") translate(-800 -115)");
  /* heart and tissues follow hormone */
  const beat = 1 + (0.025 + 0.05 * sm.H) * Math.sin(tm / Math.max(120, 620 - 380 * sm.H));
  layers.heartG.setAttribute("transform", "translate(800 295) scale(" + beat.toFixed(3) + ") translate(-800 -295)");
  /* particles */
  acc.tsh += dt * sm.P * 6; while (acc.tsh >= 1) { acc.tsh--; const p = freeP(tshP); if (p) emitP(p); }
  acc.ab += dt * sm.Ab * 7; while (acc.ab >= 1) { acc.ab--; const p = freeP(abP); if (p) emitP(p, sm.Eye > 0.3 && Math.random() < 0.28 ? 1 : 0); }
  acc.horm += dt * sm.H * 8; while (acc.horm >= 1) { acc.horm--; const p = freeP(hormP); if (p) emitP(p); }
  acc.cap += dt * (sm.anti * 3 + sm.levo * 3); while (acc.cap >= 1) { acc.cap--; const p = freeP(capsP); if (p) emitP(p, sm.levo > sm.anti ? 1 : 0); }
  movePool(tshP, tshTr, 52, false);
  movePool(abP, (p) => (p.k ? abEyeTr : abTr), 58, true);
  movePool(hormP, hormTr, 58, false);
  movePool(capsP, (p) => (p.k ? hormTr : rxTr), 52, false);
  /* gauges */
  gg.ab.set(sm.Ab, wordOf(sm.Ab, 0.3, 0.65, ["low", "raised", "high"])); gg.dmg.set(sm.D, wordOf(sm.D, 0.3, 0.65, ["little", "some", "severe"])); gg.horm.set(sm.H, wordOf(sm.H, 0.35, 0.65, ["low", "normal", "high"]));
  gg.tsh.set(sm.P, wordOf(sm.P, 0.35, 0.62, ["suppressed", "normal", "high"])); gg.gland.set(sm.gs, wordOf(sm.gs, 0.35, 0.65, ["small", "normal", "enlarged"])); gg.eye.set(sm.Eye, sm.Eye < 0.3 ? "absent" : "present");
}
run({ init, step });
