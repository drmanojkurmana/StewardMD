/* Fluidlyte scene: brain water shifts, blood salt and water, kidney output, cell potassium, heart ECG and gauges. */
const WW = SC.W;
const layers = { brain: $("brain"), parts: $("parts"), heart: $("heart"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { Na: 0.5, Wat: 0.5, K: 0.5, Bw: 0.5, Hr: 0, t1: 0, t2: 0, t3: 0, t4: 0 };
const acc = { salt: 0, wat: 0, bk: 0, urine: 0, kin: 0, kout: 0, kloss: 0, krepl: 0, brain: 0 };

/* ---- brain cells ---- */
const brainG = mk("g", {}, layers.brain);
mk("path", { class: "fly-axon", d: "M-8 -6L-88 -48M8 -8L88 -50M-10 8L-88 50M10 8L88 48M-20 14L-58 32M20 12L58 28" }, brainG);
cell(brainG, { cls: "endo", r: 52, nuc: 0.34, seed: 3, wob: 0.1, x: 0, y: 0 });
cell(brainG, { cls: "endo", r: 22, nuc: 0.4, seed: 7, wob: 0.12, x: -62, y: 34 });
cell(brainG, { cls: "endo", r: 18, nuc: 0.4, seed: 11, wob: 0.12, x: 62, y: 30 });
const brainBase = mk("g", {}, layers.brain);
mk("path", { class: "fly-cap", d: "M30 234C84 226 132 240 188 233C228 228 264 226 298 232" }, brainBase);
[58, 118, 178, 238, 282].forEach((x, i) => mk("circle", { class: "fly-rbc", cx: x, cy: i % 2 ? 236 : 231, r: 3.4 }, brainBase));
layers.brain.insertBefore(brainBase, brainG);
cell(brainG, { cls: "endo", r: 16, nuc: 0.38, seed: 19, wob: 0.12, x: -96, y: -36 });
cell(brainG, { cls: "endo", r: 15, nuc: 0.38, seed: 23, wob: 0.12, x: 96, y: -40 });
cell(brainG, { cls: "endo", r: 12, nuc: 0.38, seed: 29, wob: 0.12, x: 38, y: -66 });
cell(brainG, { cls: "endo", r: 11, nuc: 0.38, seed: 31, wob: 0.12, x: 0, y: 58 });
cell(brainG, { cls: "endo", r: 12, nuc: 0.38, seed: 37, wob: 0.12, x: -102, y: 14 });
cell(brainG, { cls: "endo", r: 11, nuc: 0.38, seed: 41, wob: 0.12, x: 106, y: 6 });
cell(brainG, { cls: "endo", r: 9, nuc: 0.38, seed: 43, wob: 0.12, x: -54, y: 58 });
cell(brainG, { cls: "endo", r: 8, nuc: 0.38, seed: 47, wob: 0.12, x: 54, y: 62 });
const BRAIN = { x: 164, y: 162 };
/* ---- body cell ---- */
const CELL = { x: 186, y: 334 };
const cellBody = cell(layers.parts, { cls: "mac", r: 52, nuc: 0.3, seed: 5, wob: 0.08, x: CELL.x, y: CELL.y });
const kDots = Array.from({ length: 16 }, () => ({ e: mk("circle", { class: "sc-p p-k2", r: 3.2, cx: 0, cy: 0 }, layers.parts), a: rnd(0, 6.28), r: rnd(8, 42) }));
kDots.forEach((d) => { d.e.setAttribute("cx", f1(CELL.x + Math.cos(d.a) * d.r)); d.e.setAttribute("cy", f1(CELL.y + Math.sin(d.a) * d.r * 0.8)); });
const gates = [336, 356, 376, 396].map((y) => ({ y, l: mk("rect", { class: "fly-gate", x: 244, y: y - 6, width: 7, height: 12, rx: 2 }, layers.parts), r: mk("rect", { class: "fly-gate", x: 251, y: y - 6, width: 7, height: 12, rx: 2 }, layers.parts) }));
const kStop = mk("g", { opacity: "0" }, layers.parts);
mk("circle", { class: "fly-stop", cx: 258, cy: 316, r: 8 }, kStop);
mk("path", { class: "fly-stop", d: "M253 321L263 311" }, kStop);
/* ---- kidney ---- */
const kid = mk("g", {}, layers.parts);
mk("ellipse", { class: "fly-kidney", cx: 790, cy: 158, rx: 44, ry: 56 }, kid);
mk("ellipse", { class: "fly-kidney", cx: 804, cy: 158, rx: 18, ry: 30, style: "fill:var(--anatomy-paper)" }, kid);
mk("path", { class: "fly-tube", d: "M830 200L830 244" }, layers.parts);
/* ---- vessel contents ---- */
const salt = pool(26, () => mk("path", { class: "sc-p p-salt", d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts));
const wat = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bk = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 2.6 }, layers.parts));
/* ---- brain water, urine, potassium fluxes ---- */
const brainW = pool(14, () => mk("path", { class: "p-fl fly-w", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const urine = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const kinP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const koutP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const klossP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const kreplP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
/* ---- treatment icons ---- */
const tr1 = mk("g", { id: "tr-w" }, layers.parts);
mk("path", { class: "fly-icon", d: "M52 372h36v28a18 11 0 0 1-36 0Z" }, tr1);
mk("path", { class: "fly-stop", d: "M58 380L82 394M82 380L58 394" }, tr1);
const tr2 = mk("g", { id: "tr-s" }, layers.parts);
mk("rect", { class: "fly-icon", x: 206, y: 384, width: 32, height: 26, rx: 6 }, tr2);
mk("path", { class: "sc-p p-salt", d: "M222 393l3.4 4l-3.4 4l-3.4-4Z" }, tr2);
const tr3 = mk("g", { id: "tr-k" }, layers.parts);
mk("rect", { class: "fly-ico2", x: 332, y: 388, width: 40, height: 26, rx: 6 }, tr3);
mk("circle", { class: "sc-p p-k2", cx: 352, cy: 401, r: 5 }, tr3);
const tr4 = mk("g", { id: "tr-x" }, layers.parts);
mk("rect", { class: "fly-ico2", x: 452, y: 388, width: 56, height: 26, rx: 6 }, tr4);
mk("path", { class: "fly-ico2", d: "M462 401h24m-6-5l6 5l-6 5" }, tr4);
/* ---- heart and ECG ---- */
const heartG = mk("g", {}, layers.heart);
const heartP = mk("path", { class: "fly-heart", d: "M0 22C-30 0 -34 -22 -18 -30C-8 -34 -1 -30 0 -24C1 -30 8 -34 18 -30C34 -22 30 0 0 22Z" }, heartG);
const ecgPath = mk("path", { class: "fly-ecg", d: "M720 365h210" }, layers.heart);
mk("rect", { class: "sc-lumen", x: 712, y: 306, width: 226, height: 110, rx: 10, style: "fill:none;stroke:var(--anatomy-mid)" }, layers.heart);
let simT = 0;
function ecgY(ph, K) {
  const dd = (c) => { const d = Math.abs(ph - c); return Math.min(d, 1 - d); };
  const g = (c, w, a) => a * Math.exp(-(dd(c) * dd(c)) / (2 * w * w));
  const wLow = clamp((0.4 - K) * 3), wHigh = clamp((K - 0.6) * 3), wN = clamp(1 - wLow - wHigh);
  const wide = 1 + wHigh * 1.6;
  return g(0.12, 0.02, 0.1) - g(0.28, 0.008 * wide, 0.12) + g(0.30, 0.007 * wide, 1) - g(0.32, 0.008 * wide, 0.2)
    + g(0.52, 0.03, 0.28) * wN + (g(0.52, 0.03, 0.08) + g(0.66, 0.02, 0.16)) * wLow + g(0.5, 0.016, 0.8) * wHigh;
}

const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["na", "Sodium", "g-na", "Blood sodium concentration: salt relative to water. Low when water outweighs salt, high when water is missing."],
   ["br", "Brain water", "g-br", "Water inside brain cells. Low sodium lets water in and the brain swells; high sodium draws water out and the brain shrinks."],
   ["kr", "Potassium", "g-kr", "Blood potassium. Most potassium lives inside cells; the blood level turns low with losses and high when the kidney fails or potassium leaves cells."],
   ["hr", "Heart rhythm", "g-hr", "How safe the heartbeat looks. Low potassium flattens the trace, high potassium peaks it and then widens it, which can stop the heart."],
   ["wa", "Body water", "g-wa", "Total body water relative to salt. High when intake outweighs losses or the kidney holds water; low with poor intake and ongoing losses."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Brain cells", 164, 122, 120, 80, "Brain cells. In low sodium, water moves in and they swell; in high sodium, water leaves and they shrink.");
  pill(ox, "Salt in blood", 400, 140, 400, 92, "Salt dissolved in blood water. Its concentration is what sodium disorders are about: salt relative to water.");
  pill(ox, "Kidney", 790, 112, 790, 84, "Kidney. It passes more or less water and holds or loses salt to balance what the body takes in and loses.");
  pill(ox, "Body water", 842, 232, 892, 234, "Water leaving in urine. The kidney raises or lowers this flow to adjust body water.");
  pill(ox, "Cell membrane", 255, 330, 330, 292, "Cell membrane. Potassium crosses it through channels; treatments move potassium in or out across it.");
  pill(ox, "Potassium store", 130, 352, 78, 356, "Potassium stored inside body cells. The store runs low in low potassium and overloads the blood in high potassium.");
  pill(ox, "Heart", 648, 345, 620, 300, "Heart. It feels potassium first: the beat turns unsteady and then dangerous as potassium moves away from normal.");
  pill(ox, "ECG trace", 830, 360, 845, 294, "ECG trace. Low potassium flattens it with a small extra wave; high potassium peaks it, then widens and slows it.");
  pill(ox, "Less water", 70, 398, 80, 431, "Limiting water intake. Helps low sodium from water excess by letting concentration recover.");
  pill(ox, "Saline", 222, 404, 222, 431, "Saline: salt with water. Helps low sodium by adding salt back toward normal.");
  pill(ox, "Potassium", 352, 410, 355, 431, "Potassium replacement. Refills the store in low potassium.");
  pill(ox, "Shift and remove", 480, 410, 475, 431, "Shift potassium into cells and remove it from the body. Brings high potassium down.");
  const lg = mk("g", {}, ox);
  [["p-salt", "salt", 348], ["p-fl", "water", 412], ["p-k2", "potassium", 492]].forEach(([c, n, x]) => {
    if (c === "p-fl") mk("path", { class: c, d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z", transform: "translate(" + x + " 256)" }, lg);
    else mk("circle", { class: "sc-p " + c, cx: x, cy: 256, r: 3 }, lg);
    const tx = mk("text", { class: "sc-lab", x: x + 9, y: 259 }, lg); tx.textContent = n;
  });
}

function init() { initPanel(); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.Na = lerp(sm.Na, m.Na, k2); sm.Wat = lerp(sm.Wat, m.Wat, k2); sm.K = lerp(sm.K, m.K, k2);
  sm.Bw = lerp(sm.Bw, m.Bw, k2); sm.Hr = lerp(sm.Hr, m.Hr, k2);
  const fix = drug === 5 ? level + 1 : drug;
  sm.t1 = lerp(sm.t1, fix === 1 ? 1 : 0, k1); sm.t2 = lerp(sm.t2, fix === 2 ? 1 : 0, k1);
  sm.t3 = lerp(sm.t3, fix === 3 ? 1 : 0, k1); sm.t4 = lerp(sm.t4, fix === 4 ? 1 : 0, k1);
  /* brain swell */
  brainG.setAttribute("transform", "translate(" + BRAIN.x + " " + BRAIN.y + ") scale(" + (0.8 + 0.45 * sm.Bw).toFixed(3) + ")");
  /* brain water flux */
  acc.brain += dt * (0.5 + Math.abs(sm.Bw - 0.5) * 10);
  while (acc.brain >= 1) { acc.brain--; const p = free(brainW);
    if (p) { const a = rnd(0, 6.28), out = sm.Bw < 0.48, r0 = out ? 60 : 110;
      emit(p, BRAIN.x + Math.cos(a) * r0, BRAIN.y + Math.sin(a) * r0 * 0.7, 0, 0, out ? 1 : 0); } }
  brainW.forEach((p) => { if (!p.on) return; const dx = BRAIN.x - p.x, dy = BRAIN.y - p.y, d = Math.hypot(dx, dy) || 1, sp = p.k === 1 ? -34 : 34;
    p.x += (dx / d) * sp * dt; p.y += (dy / d) * sp * dt; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if ((p.k === 0 && d < 40) || (p.k === 1 && d > 130) || p.t > 5) kill(p); });
  /* vessel: salt and water counts show concentration; fullness shows volume */
  const vol = clamp(0.5 + (sm.Wat - 0.5) * 0.5 + (0.5 - Math.abs(sm.Na - 0.5)) * 0.3, 0.35, 1);
  const hh = 36 * (0.7 + 0.5 * vol);
  layers.lumen.setAttribute("y", f1(164 - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  const flow = 40;
  acc.salt += dt * (1 + sm.Na * 8); while (acc.salt >= 1) { acc.salt--; const p = free(salt); if (p) emit(p, 344, 164 + rnd(-hh + 8, hh - 8), flow + rnd(0, 20), 0, 0); }
  salt.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 606) kill(p); });
  acc.wat += dt * (1 + sm.Wat * 7); while (acc.wat >= 1) { acc.wat--; const p = free(wat); if (p) emit(p, 344, 164 + rnd(-hh + 8, hh - 8), flow * 0.8, 0, 0); }
  wat.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  acc.bk += dt * (1 + sm.K * 6); while (acc.bk >= 1) { acc.bk--; const p = free(bk); if (p) emit(p, 344, 164 + rnd(-hh + 10, hh - 10), flow * 0.9, 0, 0); }
  bk.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  /* urine follows body water */
  acc.urine += dt * (0.6 + sm.Wat * 7); while (acc.urine >= 1) { acc.urine--; const p = free(urine); if (p) emit(p, 830 + rnd(-6, 6), 212, 0, 34, 0); }
  urine.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 244) kill(p); });
  /* cell potassium store and gates */
  const nk = Math.round(sm.K * kDots.length);
  kDots.forEach((d, i) => d.e.setAttribute("opacity", i < nk ? "1" : "0.12"));
  const open = Math.max(sm.t3, sm.t4) > 0.4;
  gates.forEach((g) => { g.l.setAttribute("x", f1(244 - (open ? 4 : 0))); g.r.setAttribute("x", f1(251 + (open ? 4 : 0)));
    g.l.classList.toggle("open", open); g.r.classList.toggle("open", open); });
  kStop.setAttribute("opacity", clamp((sm.Hr - 0.3) * 1.6).toFixed(2));
  acc.kin += dt * sm.t4 * 5; while (acc.kin >= 1) { acc.kin--; const p = free(kinP); if (p) emit(p, 300 + rnd(-6, 6), 360 + rnd(-30, 30), -60, 0, 0); }
  kinP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 240) kill(p); });
  acc.kout += dt * Math.max(0, sm.K - 0.55) * (1 - sm.t4) * 6; while (acc.kout >= 1) { acc.kout--; const p = free(koutP); if (p) emit(p, 240, 360 + rnd(-30, 30), 50, 0, 0); }
  koutP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 330) kill(p); });
  acc.kloss += dt * Math.max(0, 0.5 - sm.K) * 5; while (acc.kloss >= 1) { acc.kloss--; const p = free(klossP); if (p) emit(p, 280 + rnd(-30, 30), 410, 0, 26, 0); }
  klossP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 436) kill(p); });
  acc.krepl += dt * sm.t3 * 5; while (acc.krepl >= 1) { acc.krepl--; const p = free(kreplP); if (p) emit(p, 352, 388, -30, -30, 0); }
  kreplP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 330) kill(p); });
  /* treatment icons light up */
  $("tr-w").style.opacity = (0.3 + 0.7 * sm.t1).toFixed(2); $("tr-s").style.opacity = (0.3 + 0.7 * sm.t2).toFixed(2);
  $("tr-k").style.opacity = (0.3 + 0.7 * sm.t3).toFixed(2); $("tr-x").style.opacity = (0.3 + 0.7 * sm.t4).toFixed(2);
  /* heart beat and ECG */
  const period = 1.1 * (1 + sm.Hr * 0.5);
  const beat = Math.floor(simT / period), inFlat = sm.Hr > 0.65 && beat % 4 === 3;
  simT += dt * (inFlat ? 0.25 : 1);
  const phNow = (simT / period) % 1;
  const rNow = inFlat ? 0.1 : ecgY(phNow, sm.K);
  heartG.setAttribute("transform", "translate(648 352) scale(" + (1 + 0.1 * clamp(rNow, 0, 1)).toFixed(3) + ")");
  let d = "", N = 110;
  for (let i = 0; i <= N; i++) { const x = 722 + (i / N) * 206, ph = (((simT - (N - i) * 0.022) / period) % 1 + 1) % 1;
    const b = Math.floor((simT - (N - i) * 0.022) / period), fl = sm.Hr > 0.65 && ((b % 4) + 4) % 4 === 3;
    const y = 372 - (fl ? 0.06 : ecgY(ph, sm.K)) * 44 + Math.sin(tm / 300 + i) * sm.Hr * 1.5;
    d += (i === 0 ? "M" : "L") + f1(x) + " " + f1(y); }
  ecgPath.setAttribute("d", d);
  /* gauges */
  gg.na.set(sm.Na, wordOf(sm.Na, 0.35, 0.65, ["low", "normal", "high"]));
  gg.br.set(sm.Bw, wordOf(sm.Bw, 0.35, 0.65, ["shrunken", "normal", "swollen"]));
  gg.kr.set(sm.K, wordOf(sm.K, 0.35, 0.65, ["low", "normal", "high"]));
  gg.hr.set(sm.Hr, wordOf(sm.Hr, 0.35, 0.65, ["steady", "unsteady", "danger"]));
  gg.wa.set(sm.Wat, wordOf(sm.Wat, 0.35, 0.65, ["dry", "balanced", "overloaded"]));
}
run({ init, step });
