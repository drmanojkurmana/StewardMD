/* Thyroid feedback axis scene: hypothalamus TRH, pituitary TSH, thyroid hormone, feedback brake, treatment overlays and the gauges. */
const L = { brain: $("brainSlot"), pit: $("pitSlot"), thy: $("thySlot"), folls: $("folls"), tisBox: $("tisBox"), cells: $("cells"), parts: $("parts"), docks: $("docks"), over: $("over"), panel: $("panel"), hypo: $("hypo"), glandGlow: $("glandGlow"), tisGlow: $("tisGlow"), fbMain: $("fbMain"), tbP: $("tbP"), tbH: $("tbH"), ringG: $("ringG"), ringP: $("ringP") };
let brainO = null, pitO = null, thyO = null, tisFill = null, capEl = null, capKey = -1;
let trTRH = null, trTSH = null, trT4 = null, trBlk = null, trFBP = null, trFBH = null;
const sm = { H: 0.5, P: 0.5, G: 0.5, gs: 0.5, ps: 1, rp: 1, rh: 1, rep: 0, blk: 0, rmG: 0, rmP: 0 };
const acc = { trh: 0, tsh: 0, t4: 0, fb: 0, cap: 0, blk: 0 };
let dtCur = 0.016;

function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, u: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, k) { p.on = true; p.u = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function movePool(pl, tr, sp) {
  pl.forEach((p) => {
    if (!p.on) return;
    const T = typeof tr === "function" ? tr(p) : tr;
    p.u += (sp / T.len) * dtCur;
    if (p.u >= 1) { kill(p); return; }
    const q = T.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
  });
}

const trhP = pool(10, () => mk("circle", { class: "sc-p ex-rel", r: 2.6 }, L.parts));
const tshP = pool(12, () => mk("rect", { class: "sc-p ex-pit", x: -2.6, y: -2.6, width: 5.2, height: 5.2, rx: 1 }, L.parts));
const t4P = pool(20, () => mk("path", { class: "sc-p ex-end", d: "M0 -3.4L3.4 0L0 3.4L-3.4 0Z" }, L.parts));
const fbP = pool(16, () => mk("circle", { class: "ex-fbp", r: 2.2 }, L.parts));
const blkP = pool(8, () => mk("path", { class: "sc-p ex-dock", d: "M0 -4.5L4.5 0L0 4.5L-4.5 0Z" }, L.parts));
const capP = pool(8, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -5, y: -2.5, width: 10, height: 5, rx: 2.5 }, g); mk("rect", { class: "ex-cap2", x: 0, y: -2.5, width: 5, height: 5, rx: 2.5 }, g); return g; });

/* blocker parking spots on the two lobes, from the real lobe ports */
const dockList = [];
function initDocks() {
  const offs = [[-14, -30], [0, -34], [14, -30], [-19, 0], [19, 0], [-10, 32], [10, 32]];
  [thyO.ports.lobeL, thyO.ports.lobeR].forEach((c) => {
    offs.forEach((o, i) => {
      const g = mk("g", { transform: "translate(" + f1(c[0] + o[0]) + " " + f1(c[1] + o[1]) + ")" }, L.docks);
      mk("path", { class: "sc-p ex-dock", d: "M0 -6L6 0L0 6L-6 0Z" }, g);
      g.setAttribute("opacity", "0");
      dockList.push({ g, x: c[0] + o[0], y: c[1] + o[1], ph: i * 1.1 + c[0] });
    });
  });
}

/* hormone making follicles clustered in the two lobes, from the real lobe ports */
const follList = [];
function initFolls() {
  const offs = [[-14, -24], [-5, -28], [5, -26], [13, -20], [-17, -8], [-7, -11], [4, -9], [14, -4], [-16, 8], [-5, 6], [6, 8], [15, 11], [-10, 22], [0, 24], [10, 24]];
  [thyO.ports.lobeL, thyO.ports.lobeR].forEach((c, li) => {
    offs.forEach((o, i) => {
      const g = mk("g", {}, L.folls);
      mk("circle", { class: "ex-foll", cx: f1(c[0] + o[0]), cy: f1(c[1] + o[1]), r: 4 + ((i + li) % 3) }, g);
      follList.push(g);
    });
  });
}

/* body tissue box with cells */
const tisCells = [];
function initTis() {
  mk("rect", { class: "ex-tis-o", x: 740, y: 225, width: 120, height: 110, rx: 14 }, L.tisBox);
  tisFill = mk("rect", { class: "ex-tis", x: 740, y: 225, width: 120, height: 110, rx: 14, opacity: "0.4" }, L.tisBox);
  [["eos", 772, 258, 7, 11], ["rbc", 818, 278, 7, 23], ["lymph", 793, 308, 6, 35]].forEach(([cls, x, y, r, sd]) => {
    const g = cell(L.cells, { cls, r, nuc: 0.45, seed: sd, wob: 0.12 });
    g.setAttribute("transform", "translate(" + x + " " + y + ")");
    tisCells.push({ g, x, y, sd });
  });
}

function initOrgans() {
  brainO = organ(L.brain, "brain", 150, 235, 175, {});
  pitO = organ(L.pit, "ganglion", 360, 250, 72, {});
  thyO = organ(L.thy, "thyroid", 590, 250, 150, {});
  const stalk = pitO.ports.in, pitOut = pitO.ports.out, thyIn = thyO.ports.in, thyOut = thyO.ports.out;
  trTRH = track([[155, 263], [225, 260], [280, 252], stalk]);
  trTSH = track([pitOut, [445, 258], [530, 235], thyIn]);
  trT4 = track([thyOut, [645, 307], [695, 304], [740, 300]]);
  trBlk = track([[590, 118], [590, 160], [590, 190], [590, 212]]);
  trFBP = track([[770, 335], [770, 392], [360, 392], [360, 292]]);
  trFBH = track([[770, 335], [770, 392], [200, 392], [200, 316]]);
  initFolls();
  initDocks();
  initTis();
}

function capText(l, d, tis) {
  if (d === 1) return "Replacement hormone tops up the blood. Tissues " + tis + ".";
  if (d === 2) return "Blocker sits on the gland. Less hormone leaves. Tissues " + tis + ".";
  if (d === 3) {
    if (l === 4 || l === 5) return "Source removed. The excess stops. Tissues " + tis + ".";
    return "Nothing to remove. The axis runs as before. Tissues " + tis + ".";
  }
  if (d === 4) return "Source out and hormone replaced. Tissues " + tis + ".";
  if (l === 0) return "No treatment. The axis holds steady. Tissues " + tis + ".";
  if (l === 1) return "No treatment. The gland cannot answer. Tissues " + tis + ".";
  if (l === 2) return "No treatment. The pituitary cannot drive. Tissues " + tis + ".";
  if (l === 3) return "No treatment. The brain signal is missing. Tissues " + tis + ".";
  if (l === 4) return "No treatment. The gland runs on its own. Tissues " + tis + ".";
  return "No treatment. A pituitary growth drives on. Tissues " + tis + ".";
}

const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [130, 305, 480, 655, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The thyroid axis at a glance";
  [["H", "Releasing hormone", "g-cyt", "TRH from the hypothalamus. High when thyroid hormone is low; low when hormone is high or the hypothalamus fails."],
   ["P", "Pituitary hormone", "g-fl", "TSH from the pituitary. High when the gland fails or a growth escapes; low when hormone is high or the pituitary fails."],
   ["G", "End hormone", "g-eos", "Thyroid hormone in blood. The signal the body feels. Low slows tissues; high overdrives them."],
   ["gs", "Gland size", "g-neu", "Thyroid size. TSH keeps the gland grown, so it shrinks without TSH and enlarges when driven hard."],
   ["br", "Feedback brake", "g-bad", "How strongly thyroid hormone tells the top of the axis to stand down. Weak when hormone is low or the target cannot respond."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  mk("text", { class: "sc-zone", x: 34, y: 70 }, o).textContent = "THYROID AXIS";
  pill(o, "Hypothalamus", 155, 263, 88, 116, "Hypothalamus: a brain control centre. It releases TRH and senses thyroid hormone, turning its own signal down when hormone is high.");
  pill(o, "TRH", 250, 256, 250, 150, "TRH: the hypothalamic signal. A short hop to the pituitary tells it to release TSH.");
  pill(o, "Pituitary", 372, 252, 360, 116, "Pituitary: TRH makes it release TSH. Thyroid hormone feeds back and turns TSH down. A growth here can escape that brake.");
  pill(o, "TSH", 480, 250, 480, 150, "TSH: the pituitary signal. It travels in blood to the thyroid and keeps the gland grown.");
  pill(o, "Thyroid", 590, 205, 590, 150, "Thyroid gland: TSH drives it to make thyroid hormone. Without TSH it shrinks; driven hard it enlarges.");
  pill(o, "T4 and T3", 655, 305, 660, 180, "Thyroid hormone leaving the gland for the body. It sets metabolic pace and feeds back to lower TSH and TRH.");
  pill(o, "Body tissues", 800, 280, 800, 180, "Body tissues: thyroid hormone sets their pace. Too little slows them; too much overdrives them.");
  pill(o, "Feedback brake", 570, 392, 570, 372, "Negative feedback: thyroid hormone acts on the pituitary and the brain to turn their signals down. The line fades when the brake is weak.");
  capEl = mk("text", { class: "ex-cap", x: 30, y: 425 }, o); capEl.textContent = capText(1, 0, "balanced");
}

function init() { initOrgans(); initPanel(); }

function step(dt, m) {
  dtCur = dt;
  const k = Math.min(1, dt * 0.8);
  ["H", "P", "G", "gs", "ps", "rp", "rh", "rep", "blk", "rmG", "rmP"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k); });
  const br = sm.G;
  /* organs grow, shrink, dim and ghost with the model */
  const gsS = 0.55 + 0.5 * sm.gs, gtr = "translate(590 250) scale(" + gsS.toFixed(3) + ") translate(-590 -250)";
  L.thy.setAttribute("transform", gtr); L.folls.setAttribute("transform", gtr); L.docks.setAttribute("transform", gtr);
  L.thy.setAttribute("opacity", (1 - 0.85 * sm.rmG).toFixed(2));
  L.folls.setAttribute("opacity", (1 - 0.85 * sm.rmG).toFixed(2));
  L.ringG.setAttribute("opacity", sm.rmG.toFixed(2));
  const psS = 0.5 + 0.5 * sm.ps;
  L.pit.setAttribute("transform", "translate(360 250) scale(" + psS.toFixed(3) + ") translate(-360 -250)");
  L.pit.setAttribute("opacity", (1 - 0.85 * sm.rmP).toFixed(2));
  L.ringP.setAttribute("opacity", sm.rmP.toFixed(2));
  L.brain.setAttribute("opacity", (0.55 + 0.45 * sm.rh).toFixed(2));
  L.hypo.setAttribute("r", (4.5 + 2.5 * sm.H).toFixed(1));
  L.hypo.setAttribute("opacity", (0.45 + 0.55 * sm.H).toFixed(2));
  /* driven gland glows with TSH; tissues glow and fill with hormone */
  L.glandGlow.setAttribute("opacity", (clamp(sm.P * (1 - sm.rmG)) * 0.5).toFixed(2));
  L.glandGlow.setAttribute("rx", f1(70 + 50 * sm.P));
  L.glandGlow.setAttribute("ry", f1(58 + 42 * sm.P));
  L.tisGlow.setAttribute("opacity", (0.05 + 0.3 * br).toFixed(2));
  L.tisGlow.setAttribute("rx", f1(80 + 30 * br));
  tisFill.setAttribute("opacity", (0.1 + 0.7 * br).toFixed(2));
  tisCells.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 1500 + c.sd) * 2, c.y + Math.cos(tm / 1800 + c.sd) * 1.5, 0, 0.9 + 0.15 * br); });
  follList.forEach((g, i) => { g.style.opacity = (0.25 + 0.7 * sm.G).toFixed(2); });
  /* feedback lines and brake bars follow the brake */
  L.fbMain.setAttribute("stroke-opacity", (0.12 + 0.88 * br).toFixed(2));
  L.tbP.setAttribute("stroke-opacity", clamp(0.12 + br * sm.rp).toFixed(2));
  L.tbH.setAttribute("stroke-opacity", clamp(0.12 + br * sm.rh).toFixed(2));
  /* parked blockers sit on the gland and pulse */
  dockList.forEach((b) => { b.g.setAttribute("opacity", sm.blk.toFixed(2)); place(b.g, b.x, b.y, 0, 0.9 + 0.1 * Math.sin(tm / 500 + b.ph)); });
  /* hormone particles follow the smoothed signals */
  acc.trh += dt * sm.H * 6; while (acc.trh >= 1) { acc.trh--; const p = free(trhP); if (p) emit(p); }
  acc.tsh += dt * sm.P * 6; while (acc.tsh >= 1) { acc.tsh--; const p = free(tshP); if (p) emit(p); }
  acc.t4 += dt * sm.G * 8; while (acc.t4 >= 1) { acc.t4--; const p = free(t4P); if (p) emit(p); }
  acc.fb += dt * sm.G * 3.5;
  while (acc.fb >= 1) {
    acc.fb--;
    const kk = Math.random() < 0.5 ? 0 : 1, p = free(fbP);
    if (p && Math.random() < (kk ? sm.rh : sm.rp) * 0.9 + 0.1) emit(p, kk);
  }
  acc.cap += dt * sm.rep * 5; while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p); }
  acc.blk += dt * sm.blk * 3; while (acc.blk >= 1) { acc.blk--; const p = free(blkP); if (p) emit(p); }
  movePool(trhP, trTRH, 46);
  movePool(tshP, trTSH, 52);
  movePool(t4P, trT4, 56);
  movePool(fbP, (p) => (p.k ? trFBH : trFBP), 60);
  movePool(capP, trT4, 50);
  movePool(blkP, trBlk, 60);
  /* gauges */
  gg.H.set(sm.H, wordOf(sm.H, 0.3, 0.7, ["low", "normal", "high"]));
  gg.P.set(sm.P, wordOf(sm.P, 0.3, 0.7, ["low", "normal", "high"]));
  gg.G.set(sm.G, wordOf(sm.G, 0.3, 0.7, ["low", "normal", "high"]));
  gg.gs.set(sm.gs, wordOf(sm.gs, 0.2, 0.7, ["small", "normal", "large"]));
  gg.br.set(br, wordOf(br, 0.3, 0.7, ["weak", "normal", "strong"]) + (sm.rp < 0.4 || sm.rh < 0.4 ? ", not heeded" : ""));
  const key = level * 10 + drug;
  if (key !== capKey) { capKey = key; const t = capText(level, drug, m.words[2]); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
