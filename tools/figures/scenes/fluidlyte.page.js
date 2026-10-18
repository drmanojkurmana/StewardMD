/* Fluidlyte scene: water sets sodium and brain size, potassium sets the heartbeat.
 * Brain, kidney and heart are organ() art with vessels and particles on real ports.
 * Each treatment animates its mechanism: blocked water intake, salt infusion,
 * potassium refill drip, and gate opening with shift plus kidney removal. */
const WW = SC.W;
const layers = { brain: $("brainSlot"), kid: $("kidSlot"), heart: $("heartSlot"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), glowB: $("brainGlow"), glowH: $("heartGlow"), ringH: $("heartRing"), washB: $("brainWash"), washC: $("cellWash"), washH: $("heartWash"), pipe: $("toKidney"), ureter: $("ureter"), warn: $("warnSign") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const sm = { Na: 0.5, Wat: 0.5, K: 0.5, Bw: 0.5, Hr: 0, t1: 0, t2: 0, t3: 0, t4: 0 };
const acc = { salt: 0, wat: 0, bk: 0, brain: 0, urine: 0, krem: 0, kin: 0, kout: 0, kloss: 0, krepl: 0, saltIn: 0, watIn: 0 };
let brainO = null, kidO = null, heartO = null, kidIn = [735, 140], kidOut = [786, 220], trKid = null;
let capEl = null, capKey = "";

/* ---- organs, vessels on real ports ---- */
const BRAINC = { x: 164, y: 152 }, HEARTC = { x: 648, y: 356 };
function initOrgans() {
  brainO = organ(layers.brain, "brain", BRAINC.x, BRAINC.y, 175, {});
  kidO = organ(layers.kid, "kidney", 790, 150, 125, {});
  heartO = organ(layers.heart, "heart", HEARTC.x, HEARTC.y, 108, {});
  const KP = kidO.ports;
  kidIn = KP.in || KP.vein; kidOut = KP.out;
  layers.pipe.setAttribute("d", "M606 150 C650 150 " + f1(kidIn[0] - 34) + " " + f1(kidIn[1]) + " " + f1(kidIn[0]) + " " + f1(kidIn[1]));
  layers.ureter.setAttribute("d", "M" + f1(kidOut[0]) + " " + f1(kidOut[1]) + " L" + f1(kidOut[0]) + " 244");
  trKid = track([[606, 150], [648, 150], kidIn]);
}

/* ---- one short caption that follows the state (success matches the model readouts) ---- */
function capText(lv, drug, fix) {
  const prob = [
    "No treatment. Extra water dilutes blood salt and the brain swells.",
    "No treatment. Missing water concentrates salt and the brain shrinks.",
    "No treatment. Low potassium drains the cell store and the beat turns unsteady.",
    "No treatment. High potassium turns the heartbeat dangerous."
  ];
  const mech = { 1: "Less water raises salt concentration.", 2: "Salty fluid adds salt to the blood.", 3: "Potassium refills the cell store.", 4: "Treatment shifts potassium into cells and out in urine." };
  if (!fix) return prob[lv];
  const ok = drug === 5 || (lv === 0 && (fix === 1 || fix === 2)) || (lv === 2 && fix === 3) || (lv === 3 && fix === 4);
  if (ok) {
    if (lv === 0) return fix === 2 ? "Salty fluid adds salt back and the swelling eases." : "Less water lets salt concentration recover and the swelling eases.";
    if (lv === 1) return "Matched fluids bring salt and water back toward normal and the brain recovers.";
    if (lv === 2) return "Potassium refills the cell store and the heartbeat steadies.";
    return "Treatment shifts potassium into cells and out in urine, so the beat steadies.";
  }
  return mech[fix] + " It does not fix this problem.";
}

/* ---- vessel contents ---- */
const salt = pool(26, () => mk("path", { class: "sc-p p-salt", d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts));
const wat = pool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const bk = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 2.6 }, layers.parts));
const sup = pool(6, () => mk("path", { class: "sc-p p-salt", d: "M0 -3L2.8 0L0 3L-2.8 0Z" }, layers.parts));
/* ---- brain water, urine, potassium fluxes ---- */
const brainW = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const urine = pool(16, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const kRem = pool(8, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const kinP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const koutP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const klossP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const kreplP = pool(10, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
const saltIn = pool(8, () => mk("path", { class: "sc-p p-salt", d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts));
const watIn = pool(8, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const heartK = pool(6, () => mk("circle", { class: "sc-p p-k2", r: 3 }, layers.parts));
heartK.forEach((p, i) => { p.on = true; p.a = rnd(0, 6.28); p.x = HEARTC.x + rnd(-50, 50); p.y = HEARTC.y + rnd(-36, 36); p.e.setAttribute("opacity", "0"); });

/* ---- body cell, membrane, gates, potassium store ---- */
const CELL = { x: 150, y: 352 };
const cellBody = cell(layers.parts, { cls: "mac", r: 54, nuc: 0.3, seed: 5, wob: 0.08, x: CELL.x, y: CELL.y });
mk("path", { class: "fly-mem", d: "M208 318L208 410" }, layers.parts);
const kDots = Array.from({ length: 20 }, () => ({ e: mk("circle", { class: "sc-p p-k2", r: 3.4, cx: 0, cy: 0 }, layers.parts), a: rnd(0, 6.28), r: rnd(8, 42) }));
const gates = [336, 356, 376, 396].map((y) => ({ y, l: mk("rect", { class: "fly-gate", x: 202, y: y - 6, width: 7, height: 12, rx: 2 }, layers.parts), r: mk("rect", { class: "fly-gate", x: 209, y: y - 6, width: 7, height: 12, rx: 2 }, layers.parts) }));

/* ---- treatment icons (hover explains each) ---- */
function hotIcon(id, info) { const g = mk("g", { id, class: "hot", tabindex: "0", "data-info": info }, layers.parts); return g; }
let barG = null, bagG = null, potG = null, shfG = null;
function initIcons() {
  const w = hotIcon("tr-w", "Less water. Drinking less lets the salt level recover when extra water diluted it.");
  mk("path", { class: "fly-icon", d: "M408 58h24v12a12 8 0 0 1-24 0Z" }, w);
  barG = mk("g", {}, layers.parts);
  mk("path", { class: "fly-cross", d: "M400 100L440 100M410 92L430 108M430 92L410 108" }, barG);
  bagG = hotIcon("tr-s", "Salty fluid. It adds salt back when blood salt is low.");
  mk("rect", { class: "fly-icon", x: 530, y: 58, width: 34, height: 30, rx: 6 }, bagG);
  mk("path", { class: "fly-mem", d: "M547 88L547 118" }, bagG);
  potG = hotIcon("tr-k", "Potassium. It refills the cell store when blood potassium is low.");
  mk("rect", { class: "fly-ico2", x: 48, y: 378, width: 40, height: 26, rx: 6 }, potG);
  mk("circle", { class: "sc-p p-k2", cx: 68, cy: 391, r: 5 }, potG);
  shfG = hotIcon("tr-x", "Shift and remove. It moves potassium into cells and flushes it out in urine when potassium is high.");
  mk("rect", { class: "fly-ico2", x: 300, y: 384, width: 60, height: 26, rx: 6 }, shfG);
  mk("path", { class: "fly-mem", d: "M310 397h32m-7-5l7 5l-7 5" }, shfG);
  mk("path", { class: "fly-mem", d: "M350 397h-32m7-5l-7 5l7 5" }, shfG);
}

/* ---- heart trace ---- */
const ecgPath = mk("path", { class: "fly-ecg", d: "M732 365h196" }, layers.parts);
mk("rect", { class: "sc-lumen", x: 724, y: 306, width: 204, height: 110, rx: 10, style: "fill:none;stroke:var(--anatomy-mid)" }, layers.parts);
const warnG = layers.warn;
mk("path", { class: "fly-warn", d: "M706 296L720 320L692 320Z" }, warnG);
mk("path", { class: "fly-warn", d: "M706 304L706 311" }, warnG);
mk("circle", { class: "fly-warn-fill", cx: 706, cy: 315, r: 1.8 }, warnG);
let simT = 0;
function ecgY(ph, K) {
  const dd = (c) => { const d = Math.abs(ph - c); return Math.min(d, 1 - d); };
  const g = (c, wd, a) => a * Math.exp(-(dd(c) * dd(c)) / (2 * wd * wd));
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
   ["hr", "Heart rhythm", "g-hr", "How safe the heartbeat looks. Low potassium flattens the trace, high potassium peaks it and then widens it, which can end the beat."],
   ["wa", "Body water", "g-wa", "Total body water relative to salt. High when intake outweighs losses or the kidney holds water; low with poor intake and ongoing losses."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Brain", 100, 140, 80, 232, "Brain cells. Too much water moves in and they swell. Too little water leaves and they shrink.");
  pill(ox, "Blood", 470, 150, 470, 75, "Blood. Salt, water and potassium flow here. Salt level means salt relative to water.");
  pill(ox, "Kidney", 748, 178, 700, 232, "Kidney. It lets out more or less water and holds or loses salt.");
  pill(ox, "Urine", kidOut[0], 238, 800, 255, "Urine. Water and waste leaving the body. More flows when the kidney lets water go.");
  pill(ox, "Body cell", 105, 345, 80, 292, "Body cell. Most potassium lives inside cells like this one.");
  pill(ox, "Cell gate", 208, 366, 330, 292, "Channel. Potassium crosses the membrane here. Shift treatment opens it wide.");
  pill(ox, "Heart", 615, 325, 600, 292, "Heart. Potassium outside its normal range disturbs the beat.");
  pill(ox, "Heartbeat", 825, 350, 845, 292, "Heartbeat trace. Low potassium flattens it. High potassium peaks it, then widens it.");
  capEl = mk("text", { class: "fly-cap", x: 30, y: 436 }, ox);
  capEl.textContent = capText(0, 0, 0);
}

function init() { initOrgans(); initIcons(); initPanel(); sup.forEach((p, i) => { p.on = true; p.u = i / sup.length; p.e.setAttribute("opacity", "1"); }); }

function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.Na = lerp(sm.Na, m.Na, k2); sm.Wat = lerp(sm.Wat, m.Wat, k2); sm.K = lerp(sm.K, m.K, k2);
  sm.Bw = lerp(sm.Bw, m.Bw, k2); sm.Hr = lerp(sm.Hr, m.Hr, k2);
  const fix = drug === 5 ? level + 1 : drug;
  sm.t1 = lerp(sm.t1, fix === 1 ? 1 : 0, k1); sm.t2 = lerp(sm.t2, fix === 2 ? 1 : 0, k1);
  sm.t3 = lerp(sm.t3, fix === 3 ? 1 : 0, k1); sm.t4 = lerp(sm.t4, fix === 4 ? 1 : 0, k1);
  /* brain swells or shrinks, glows when sick */
  const sb = 0.86 + 0.30 * sm.Bw;
  brainO.g.setAttribute("transform", "translate(" + BRAINC.x + " " + BRAINC.y + ") scale(" + sb.toFixed(3) + ")");
  layers.glowB.setAttribute("opacity", (clamp(Math.abs(sm.Bw - 0.5) * 1.6) * 0.5).toFixed(2));
  layers.washB.setAttribute("opacity", (clamp(Math.abs(sm.Bw - 0.5) * 2.4) * 0.3).toFixed(2));
  /* kidney works the water out */
  kidO.g.setAttribute("transform", "translate(790 150) scale(" + (0.94 + 0.12 * sm.Wat).toFixed(3) + ")");
  /* brain water flux meets the organ edge */
  acc.brain += dt * (0.5 + Math.abs(sm.Bw - 0.5) * 10);
  while (acc.brain >= 1) { acc.brain--; const p = free(brainW);
    if (p) { const inward = sm.Bw >= 0.5;
      if (inward) emit(p, 300 + rnd(-4, 10), 152 + rnd(-15, 15), -34, 0, 0);
      else emit(p, 252 + rnd(-4, 4), 152 + rnd(-15, 15), 34, 0, 1); } }
  brainW.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if ((p.k === 0 && p.x < 252) || (p.k === 1 && p.x > 305) || p.t > 5) kill(p); });
  /* vessel: salt and water counts show concentration, fullness shows volume */
  const vol = clamp(0.5 + (sm.Wat - 0.5) * 0.5 + (0.5 - Math.abs(sm.Na - 0.5)) * 0.3, 0.35, 1);
  const hh = 22 + 34 * vol;
  layers.lumen.setAttribute("y", f1(150 - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  const flow = 40;
  acc.salt += dt * (1 + sm.Na * 8); while (acc.salt >= 1) { acc.salt--; const p = free(salt); if (p) emit(p, 344, 150 + rnd(-hh + 8, hh - 8), flow + rnd(0, 20), 0, 0); }
  salt.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 606) kill(p); });
  acc.wat += dt * (1 + sm.Wat * 7); while (acc.wat >= 1) { acc.wat--; const p = free(wat); if (p) emit(p, 344, 150 + rnd(-hh + 8, hh - 8), flow * 0.8, 0, 0); }
  wat.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  acc.bk += dt * (1 + sm.K * 6); while (acc.bk >= 1) { acc.bk--; const p = free(bk); if (p) emit(p, 344, 150 + rnd(-hh + 10, hh - 10), flow * 0.9, 0, 0); }
  bk.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  /* blood supply runs along the pipe into the kidney artery port */
  sup.forEach((p) => { p.u = (p.u + dt * 0.22) % 1; const q = trKid.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")"); });
  /* water intake from above, trapped at the barrier when water is limited */
  acc.watIn += dt * (0.5 + 5.5 * (1 - sm.t1));
  while (acc.watIn >= 1) { acc.watIn--; const p = free(watIn); if (p) emit(p, 420 + rnd(-6, 6), 54, 0, 55, 0); }
  watIn.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.t += dt;
    if (sm.t1 > 0.5 && p.y >= 96) { p.e.setAttribute("opacity", clamp(1 - (p.y - 96) / 20).toFixed(2)); if (p.y > 116) kill(p); }
    else if (p.y >= 150 - hh + 4 || p.t > 4) kill(p);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  barG.setAttribute("opacity", sm.t1.toFixed(2));
  /* saline pours salt in from the bag */
  acc.saltIn += dt * 6 * sm.t2;
  while (acc.saltIn >= 1) { acc.saltIn--; const p = free(saltIn); if (p) emit(p, 547 + rnd(-3, 3), 92, 0, 50, 0); }
  saltIn.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.t += dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y >= 150 - hh + 4 || p.t > 4) kill(p); });
  /* urine follows body water down the ureter */
  acc.urine += dt * (0.6 + sm.Wat * 7); while (acc.urine >= 1) { acc.urine--; const p = free(urine); if (p) emit(p, kidOut[0] + rnd(-4, 4), kidOut[1], 0, 34, 0); }
  urine.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 244) kill(p); });
  /* removal treatment flushes potassium out through the kidney */
  acc.krem += dt * 7 * sm.t4; while (acc.krem >= 1) { acc.krem--; const p = free(kRem); if (p) emit(p, kidOut[0] + rnd(-4, 4), kidOut[1], 0, 34, 0); }
  kRem.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 244) kill(p); });
  /* cell potassium store, membrane gates, fluxes */
  const cs = 0.92 + 0.2 * sm.K;
  place(cellBody, CELL.x, CELL.y, 0, cs);
  const nk = Math.round(sm.K * kDots.length);
  kDots.forEach((d, i) => { d.e.setAttribute("cx", f1(CELL.x + Math.cos(d.a) * d.r * cs)); d.e.setAttribute("cy", f1(CELL.y + Math.sin(d.a) * d.r * cs * 0.8)); d.e.setAttribute("opacity", i < nk ? "1" : "0.12"); });
  layers.washC.setAttribute("opacity", (clamp(Math.abs(sm.K - 0.5) * 2.4) * 0.3).toFixed(2));
  const open = sm.t4 > 0.4;
  gates.forEach((g) => { g.l.setAttribute("x", f1(202 - (open ? 4 : 0))); g.r.setAttribute("x", f1(209 + (open ? 4 : 0)));
    g.l.classList.toggle("open", open); g.r.classList.toggle("open", open); });
  acc.kin += dt * sm.t4 * 5; while (acc.kin >= 1) { acc.kin--; const p = free(kinP); if (p) emit(p, 300 + rnd(-6, 6), 352 + rnd(-25, 25), -60, 0, 0); }
  kinP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x < 216) kill(p); });
  acc.kout += dt * Math.max(0, sm.K - 0.55) * (1 - sm.t4) * 6; while (acc.kout >= 1) { acc.kout--; const p = free(koutP); if (p) emit(p, 216, 352 + rnd(-25, 25), 50, 0, 0); }
  koutP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 330) kill(p); });
  acc.kloss += dt * Math.max(0, 0.5 - sm.K) * 5; while (acc.kloss >= 1) { acc.kloss--; const p = free(klossP); if (p) emit(p, 150 + rnd(-30, 30), 396, 0, 26, 0); }
  klossP.forEach((p) => { if (!p.on) return; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 420) kill(p); });
  acc.krepl += dt * sm.t3 * 5; while (acc.krepl >= 1) { acc.krepl--; const p = free(kreplP); if (p) emit(p, 88, 391, 25, -12, 0); }
  kreplP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 100) kill(p); });
  /* treatment icons light up with their mechanism */
  bagG.style.opacity = (0.35 + 0.65 * sm.t2).toFixed(2); potG.style.opacity = (0.35 + 0.65 * sm.t3).toFixed(2); shfG.style.opacity = (0.35 + 0.65 * sm.t4).toFixed(2);
  /* potassium bathes the heart when abnormal; heart, trace and alarm follow */
  heartK.forEach((p) => { p.a += rnd(-1.4, 1.4) * dt; p.x += Math.cos(p.a) * 11 * dt; p.y += Math.sin(p.a) * 11 * dt;
    if (p.x < 592 || p.x > 704) p.a = Math.PI - p.a; if (p.y < 316 || p.y > 396) p.a = -p.a;
    p.x = clamp(p.x, 592, 704); p.y = clamp(p.y, 316, 396);
    place(p.e, p.x, p.y, 0, 0); p.e.setAttribute("opacity", clamp(Math.abs(sm.K - 0.5) * 2.2).toFixed(2)); });
  const period = 1.1 * (1 + sm.Hr * 0.5);
  const beat = Math.floor(simT / period), inFlat = sm.Hr > 0.65 && beat % 4 === 3;
  simT += dt * (inFlat ? 0.25 : 1);
  const phNow = (simT / period) % 1;
  const rNow = inFlat ? 0.1 : ecgY(phNow, sm.K);
  heartO.g.setAttribute("transform", "translate(" + HEARTC.x + " " + HEARTC.y + ") scale(" + (1 + 0.07 * clamp(rNow, 0, 1)).toFixed(3) + ")");
  layers.ringH.setAttribute("opacity", (clamp((sm.Hr - 0.25) * 1.6) * 0.85).toFixed(2));
  layers.glowH.setAttribute("opacity", (clamp((sm.Hr - 0.25) * 1.6) * 0.35).toFixed(2));
  layers.washH.setAttribute("opacity", (clamp(sm.Hr * 1.5) * 0.32).toFixed(2));
  layers.warn.setAttribute("opacity", clamp((sm.Hr - 0.4) * 2.5).toFixed(2));
  ecgPath.setAttribute("class", sm.Hr > 0.5 ? "fly-ecg-bad" : "fly-ecg");
  let d = "", N = 100;
  for (let i = 0; i <= N; i++) { const x = 732 + (i / N) * 186, ph = (((simT - (N - i) * 0.022) / period) % 1 + 1) % 1;
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
  const key = level + ":" + drug;
  if (key !== capKey) { capKey = key; const tx = capText(level, drug, fix); if (capEl.textContent !== tx) capEl.textContent = tx; }
}
run({ init, step });
